package migrations

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed *.up.sql
var files embed.FS

func Up(ctx context.Context, pool *pgxpool.Pool) error {
	connection, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire migration connection: %w", err)
	}
	defer connection.Release()

	if _, err := connection.Exec(ctx, `SELECT pg_advisory_lock(hashtext('rhythm_schema_migrations'))`); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer func() {
		_, _ = connection.Exec(context.Background(), `SELECT pg_advisory_unlock(hashtext('rhythm_schema_migrations'))`)
	}()
	// Rhythm owns a dedicated schema. Existing pre-schema installations are
	// upgraded in place before any new migration is evaluated. Extension-owned
	// objects are deliberately excluded from the move.
	if _, err := connection.Exec(ctx, `CREATE SCHEMA IF NOT EXISTS rhythm`); err != nil {
		return fmt.Errorf("ensure rhythm schema: %w", err)
	}
	if _, err := connection.Exec(ctx, `
		DO $migration$
		DECLARE item record;
		BEGIN
			IF to_regclass('rhythm.schema_migrations') IS NULL
			   AND to_regclass('public.schema_migrations') IS NOT NULL THEN
				FOR item IN
					SELECT c.relname, c.relkind
					FROM pg_class c
					JOIN pg_namespace n ON n.oid=c.relnamespace
					WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m')
					  AND c.relname NOT IN ('databasechangelog','databasechangeloglock')
					  AND NOT EXISTS (
						SELECT 1 FROM pg_depend d
						WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'
					  )
				LOOP
					EXECUTE format(
						CASE item.relkind WHEN 'S' THEN 'ALTER SEQUENCE public.%I SET SCHEMA rhythm'
						WHEN 'v' THEN 'ALTER VIEW public.%I SET SCHEMA rhythm'
						WHEN 'm' THEN 'ALTER MATERIALIZED VIEW public.%I SET SCHEMA rhythm'
						ELSE 'ALTER TABLE public.%I SET SCHEMA rhythm' END,
						item.relname
					);
				END LOOP;
			END IF;
		END $migration$;
		SET search_path TO rhythm, public
	`); err != nil {
		return fmt.Errorf("prepare rhythm schema: %w", err)
	}

	if _, err := connection.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS rhythm.schema_migrations (
			version TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`); err != nil {
		return fmt.Errorf("ensure migration table: %w", err)
	}

	entries, err := fs.ReadDir(files, ".")
	if err != nil {
		return fmt.Errorf("read embedded migrations: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".up.sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var applied bool
		if err := connection.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM rhythm.schema_migrations WHERE version = $1)`, name).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if applied {
			continue
		}
		contents, err := files.ReadFile(name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		transaction, err := connection.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", name, err)
		}
		if _, err := transaction.Exec(ctx, string(contents)); err != nil {
			_ = transaction.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
		if _, err := transaction.Exec(ctx, `INSERT INTO rhythm.schema_migrations (version) VALUES ($1)`, name); err != nil {
			_ = transaction.Rollback(ctx)
			return fmt.Errorf("record migration %s: %w", name, err)
		}
		if err := transaction.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}
	}
	return nil
}
