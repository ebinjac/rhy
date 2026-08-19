package postgres

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CheckRequiredSchema accepts either the Liquibase change-set ID (for Hydra)
// or the embedded Go migration filename (for local Compose). This lets the
// same application image refuse readiness against an older database without
// making either migration engine silently mutate the schema at startup.
func CheckRequiredSchema(ctx context.Context, pool *pgxpool.Pool, required string) error {
	required = strings.TrimSpace(required)
	if required == "" {
		return nil
	}
	var migrationTable, liquibaseTable *string
	if err := pool.QueryRow(ctx, `
		SELECT to_regclass('rhythm.schema_migrations')::text,
		       COALESCE(to_regclass('rhythm.databasechangelog'), to_regclass('public.databasechangelog'))::text
	`).Scan(&migrationTable, &liquibaseTable); err != nil {
		return fmt.Errorf("inspect schema migration metadata: %w", err)
	}
	if migrationTable != nil {
		var applied bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM schema_migrations
				WHERE version = $1 OR version = $1 || '.up.sql'
			)
		`, required).Scan(&applied); err != nil {
			return fmt.Errorf("check embedded migration %s: %w", required, err)
		}
		if applied {
			return nil
		}
	}
	if liquibaseTable != nil {
		var applied bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM databasechangelog WHERE id = $1)
		`, strings.TrimSuffix(required, ".up.sql")).Scan(&applied); err != nil {
			return fmt.Errorf("check Liquibase change set %s: %w", required, err)
		}
		if applied {
			return nil
		}
	}
	return errors.New("database schema is older than required revision " + required)
}

func Open(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	return OpenWithOptions(ctx, databaseURL, PoolOptions{})
}

type PoolOptions struct {
	MaxConnections  int32
	MinConnections  int32
	TransactionPool bool
	// SkipInitialPing lets long-running services open their listener before
	// PostgreSQL is reachable. The pool reconnects lazily and /readyz continues
	// to report the dependency outage. One-shot commands such as migrations keep
	// the default fail-fast behavior.
	SkipInitialPing bool
}

func OpenWithOptions(ctx context.Context, databaseURL string, options PoolOptions) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse PostgreSQL configuration: %w", err)
	}
	if options.MaxConnections > 0 {
		config.MaxConns = options.MaxConnections
	}
	if options.MinConnections >= 0 {
		config.MinConns = options.MinConnections
	}
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnIdleTime = 5 * time.Minute
	config.HealthCheckPeriod = 30 * time.Second
	config.ConnConfig.ConnectTimeout = 5 * time.Second
	config.ConnConfig.RuntimeParams["statement_timeout"] = strconv.Itoa(int((15 * time.Second).Milliseconds()))
	config.ConnConfig.RuntimeParams["lock_timeout"] = strconv.Itoa(int((5 * time.Second).Milliseconds()))
	config.ConnConfig.RuntimeParams["idle_in_transaction_session_timeout"] = strconv.Itoa(int((30 * time.Second).Milliseconds()))
	config.ConnConfig.RuntimeParams["application_name"] = "rhythm"
	config.ConnConfig.RuntimeParams["search_path"] = "rhythm,public"
	if options.TransactionPool {
		// PgBouncer transaction pooling cannot retain session-scoped prepared
		// statements. Simple protocol keeps every query transaction-local.
		config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create PostgreSQL pool: %w", err)
	}
	if options.SkipInitialPing {
		return pool, nil
	}
	pingContext, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingContext); err != nil {
		pool.Close()
		return nil, fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	return pool, nil
}
