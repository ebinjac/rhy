package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/monitors"
)

const monitorSelect = `
	SELECT
		m.id::text, m.name, m.slug, COALESCE(m.description, ''), COALESCE(m.owner_id, ''), m.tags,
		COALESCE(m.environment_id::text, ''), m.state,
		CASE WHEN m.state = 'ARCHIVED' OR NOT m.enabled THEN 'PAUSED' WHEN run_stats.last_status = 'SUCCESS' THEN 'HEALTHY' WHEN run_stats.last_status IN ('FAILED','TIMED_OUT') THEN 'FAILING' ELSE 'UNKNOWN' END,
		m.enabled, COALESCE(m.current_draft_revision_id::text, ''), COALESCE(m.latest_published_revision_id::text, ''),
		COALESCE(jsonb_array_length(COALESCE(revision.definition_json->'steps', '[]'::jsonb)), 0),
		COALESCE(schedule.schedule_type, ''), COALESCE(schedule.expression, ''), COALESCE(schedule.interval_seconds, 0),
		m.created_by, m.updated_by, m.created_at, m.updated_at,
		run_stats.success_rate, run_stats.last_duration_ms, run_stats.last_run_at
	FROM monitors m
	LEFT JOIN monitor_revisions revision ON revision.id = COALESCE(m.current_draft_revision_id, m.latest_published_revision_id)
	LEFT JOIN monitor_schedules schedule ON schedule.monitor_id = m.id AND schedule.active = TRUE
	LEFT JOIN LATERAL (
		SELECT
			100.0 * COUNT(*) FILTER (WHERE status = 'SUCCESS') / NULLIF(COUNT(*), 0) AS success_rate,
			(ARRAY_AGG(duration_ms ORDER BY created_at DESC))[1] AS last_duration_ms,
			MAX(created_at) AS last_run_at,
			(ARRAY_AGG(status ORDER BY created_at DESC))[1] AS last_status
		FROM monitor_runs WHERE monitor_id = m.id AND created_at >= NOW() - INTERVAL '24 hours'
	) run_stats ON TRUE
`

type MonitorRepository struct {
	pool *pgxpool.Pool
}

func NewMonitorRepository(pool *pgxpool.Pool) *MonitorRepository {
	return &MonitorRepository{pool: pool}
}

func (r *MonitorRepository) List(ctx context.Context) ([]monitors.Monitor, error) {
	rows, err := r.pool.Query(ctx, monitorSelect+` WHERE m.deleted_at IS NULL ORDER BY m.name`)
	if err != nil {
		return nil, fmt.Errorf("list monitors: %w", err)
	}
	defer rows.Close()
	items := make([]monitors.Monitor, 0)
	for rows.Next() {
		monitor, err := scanMonitor(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, monitor)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate monitors: %w", err)
	}
	return items, nil
}

func (r *MonitorRepository) Get(ctx context.Context, monitorID string) (monitors.Monitor, error) {
	monitor, err := scanMonitor(r.pool.QueryRow(ctx, monitorSelect+` WHERE m.id = $1 AND m.deleted_at IS NULL`, monitorID))
	if errors.Is(err, pgx.ErrNoRows) {
		return monitors.Monitor{}, monitors.ErrNotFound
	}
	return monitor, err
}

func (r *MonitorRepository) Create(ctx context.Context, monitor monitors.Monitor, revision monitors.Revision) (monitors.Monitor, error) {
	transaction, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return monitors.Monitor{}, fmt.Errorf("begin monitor creation: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()

	tags, err := json.Marshal(monitor.Tags)
	if err != nil {
		return monitors.Monitor{}, fmt.Errorf("encode monitor tags: %w", err)
	}
	definition, err := json.Marshal(revision.Definition)
	if err != nil {
		return monitors.Monitor{}, fmt.Errorf("encode monitor definition: %w", err)
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO monitors (
			id, name, slug, description, owner_id, tags, environment_id, state, enabled,
			created_by, updated_by, created_at, updated_at
		) VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, NULLIF($7, '')::uuid, $8, $9, $10, $11, $12, $13)`,
		monitor.ID, monitor.Name, monitor.Slug, monitor.Description, monitor.OwnerID, tags, monitor.EnvironmentID,
		monitor.State, monitor.Enabled, monitor.CreatedBy, monitor.UpdatedBy, monitor.CreatedAt, monitor.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return monitors.Monitor{}, monitors.ErrConflict
		}
		return monitors.Monitor{}, fmt.Errorf("insert monitor: %w", err)
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO monitor_revisions (
			id, monitor_id, revision_number, status, schema_version, definition_json, change_summary,
			published_by, published_at, created_by, created_at
		) VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, ''), $9, $10, $11)`,
		revision.ID, revision.MonitorID, revision.RevisionNumber, revision.Status, revision.SchemaVersion, definition,
		revision.ChangeSummary, revision.PublishedBy, revision.PublishedAt, revision.CreatedBy, revision.CreatedAt,
	)
	if err != nil {
		return monitors.Monitor{}, fmt.Errorf("insert draft revision: %w", err)
	}
	if _, err := transaction.Exec(ctx, `UPDATE monitors SET current_draft_revision_id = $1 WHERE id = $2`, revision.ID, monitor.ID); err != nil {
		return monitors.Monitor{}, fmt.Errorf("attach draft revision: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return monitors.Monitor{}, fmt.Errorf("commit monitor creation: %w", err)
	}
	return monitor, nil
}

func (r *MonitorRepository) Update(ctx context.Context, monitor monitors.Monitor, expectedUpdatedAt time.Time) (monitors.Monitor, error) {
	tags, err := json.Marshal(monitor.Tags)
	if err != nil {
		return monitors.Monitor{}, fmt.Errorf("encode monitor tags: %w", err)
	}
	command, err := r.pool.Exec(ctx, `
		UPDATE monitors SET
			name = $2, slug = $3, description = $4, owner_id = NULLIF($5, ''), tags = $6,
			environment_id = NULLIF($7, '')::uuid, updated_by = $8, updated_at = $9
		WHERE id = $1 AND deleted_at IS NULL AND updated_at = $10`,
		monitor.ID, monitor.Name, monitor.Slug, monitor.Description, monitor.OwnerID, tags,
		monitor.EnvironmentID, monitor.UpdatedBy, monitor.UpdatedAt, expectedUpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return monitors.Monitor{}, monitors.ErrConflict
		}
		return monitors.Monitor{}, fmt.Errorf("update monitor: %w", err)
	}
	if command.RowsAffected() == 0 {
		var exists bool
		if err := r.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM monitors WHERE id = $1 AND deleted_at IS NULL)`, monitor.ID).Scan(&exists); err != nil {
			return monitors.Monitor{}, fmt.Errorf("check monitor after update: %w", err)
		}
		if !exists {
			return monitors.Monitor{}, monitors.ErrNotFound
		}
		return monitors.Monitor{}, monitors.ErrPreconditionFailed
	}
	return r.Get(ctx, monitor.ID)
}

func (r *MonitorRepository) UpdateDraft(ctx context.Context, monitorID string, definition map[string]any, actorID string, updatedAt time.Time) (monitors.Monitor, monitors.Revision, error) {
	encoded, err := json.Marshal(definition)
	if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("encode draft definition: %w", err)
	}
	transaction, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("begin draft update: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()
	var revisionID string
	if err := transaction.QueryRow(ctx, `SELECT current_draft_revision_id::text FROM monitors WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, monitorID).Scan(&revisionID); errors.Is(err, pgx.ErrNoRows) {
		return monitors.Monitor{}, monitors.Revision{}, monitors.ErrNotFound
	} else if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("lock monitor draft: %w", err)
	}
	command, err := transaction.Exec(ctx, `UPDATE monitor_revisions SET definition_json = $2 WHERE id = $1 AND status = 'DRAFT'`, revisionID, encoded)
	if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("update draft definition: %w", err)
	}
	if command.RowsAffected() == 0 {
		return monitors.Monitor{}, monitors.Revision{}, monitors.ErrConflict
	}
	if _, err := transaction.Exec(ctx, `UPDATE monitors SET updated_by = $2, updated_at = $3 WHERE id = $1`, monitorID, actorID, updatedAt); err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("touch monitor draft: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("commit draft update: %w", err)
	}
	monitor, err := r.Get(ctx, monitorID)
	if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, err
	}
	revision, err := r.GetRevision(ctx, monitorID, revisionID)
	return monitor, revision, err
}

func (r *MonitorRepository) Publish(ctx context.Context, monitorID string, published monitors.Revision, nextDraft monitors.Revision, actorID string, updatedAt time.Time) (monitors.Monitor, monitors.Revision, error) {
	definition, err := json.Marshal(nextDraft.Definition)
	if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("encode next draft: %w", err)
	}
	transaction, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("begin publish: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()
	var currentDraftID string
	if err := transaction.QueryRow(ctx, `SELECT current_draft_revision_id::text FROM monitors WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, monitorID).Scan(&currentDraftID); errors.Is(err, pgx.ErrNoRows) {
		return monitors.Monitor{}, monitors.Revision{}, monitors.ErrNotFound
	} else if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("lock monitor for publish: %w", err)
	}
	if currentDraftID != published.ID {
		return monitors.Monitor{}, monitors.Revision{}, monitors.ErrConflict
	}
	command, err := transaction.Exec(ctx, `
		UPDATE monitor_revisions SET status = 'PUBLISHED', change_summary = NULLIF($2, ''), published_by = $3, published_at = $4
		WHERE id = $1 AND status = 'DRAFT'`, published.ID, published.ChangeSummary, published.PublishedBy, published.PublishedAt)
	if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("freeze published revision: %w", err)
	}
	if command.RowsAffected() == 0 {
		return monitors.Monitor{}, monitors.Revision{}, monitors.ErrConflict
	}
	_, err = transaction.Exec(ctx, `
		INSERT INTO monitor_revisions (id, monitor_id, revision_number, status, schema_version, definition_json, created_by, created_at)
		VALUES ($1, $2, $3, 'DRAFT', $4, $5, $6, $7)`, nextDraft.ID, monitorID, nextDraft.RevisionNumber, nextDraft.SchemaVersion, definition, nextDraft.CreatedBy, nextDraft.CreatedAt)
	if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("create next draft: %w", err)
	}
	_, err = transaction.Exec(ctx, `
		UPDATE monitors SET current_draft_revision_id = $2, latest_published_revision_id = $3,
			state = CASE WHEN enabled THEN 'ENABLED' ELSE 'PUBLISHED' END, updated_by = $4, updated_at = $5
		WHERE id = $1`, monitorID, nextDraft.ID, published.ID, actorID, updatedAt)
	if err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("attach published revision: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return monitors.Monitor{}, monitors.Revision{}, fmt.Errorf("commit publish: %w", err)
	}
	monitor, err := r.Get(ctx, monitorID)
	return monitor, published, err
}

func (r *MonitorRepository) SetState(ctx context.Context, monitorID string, state monitors.State, enabled bool, actorID string, updatedAt time.Time) (monitors.Monitor, error) {
	command, err := r.pool.Exec(ctx, `
		UPDATE monitors SET state = $2, enabled = $3, updated_by = $4, updated_at = $5
		WHERE id = $1 AND deleted_at IS NULL`, monitorID, state, enabled, actorID, updatedAt)
	if err != nil {
		return monitors.Monitor{}, fmt.Errorf("change monitor state: %w", err)
	}
	if command.RowsAffected() == 0 {
		return monitors.Monitor{}, monitors.ErrNotFound
	}
	if !enabled {
		if _, err := r.pool.Exec(ctx, `UPDATE monitor_schedules SET active = FALSE, updated_at = $2 WHERE monitor_id = $1 AND active = TRUE`, monitorID, updatedAt); err != nil {
			return monitors.Monitor{}, fmt.Errorf("deactivate monitor schedule: %w", err)
		}
	} else {
		if _, err := r.pool.Exec(ctx, `UPDATE monitor_schedules SET active = schedule_type <> 'MANUAL', next_run_at = CASE WHEN schedule_type = 'MANUAL' THEN NULL ELSE NOW() END, updated_at = $2 WHERE monitor_id = $1`, monitorID, updatedAt); err != nil {
			return monitors.Monitor{}, fmt.Errorf("activate monitor schedule: %w", err)
		}
	}
	return r.Get(ctx, monitorID)
}

func (r *MonitorRepository) SoftDelete(ctx context.Context, monitorID, actorID string, deletedAt time.Time) error {
	command, err := r.pool.Exec(ctx, `
		UPDATE monitors SET deleted_at = $2, enabled = FALSE, updated_by = $3, updated_at = $2
		WHERE id = $1 AND deleted_at IS NULL`, monitorID, deletedAt, actorID)
	if err != nil {
		return fmt.Errorf("soft-delete monitor: %w", err)
	}
	if command.RowsAffected() == 0 {
		return monitors.ErrNotFound
	}
	return nil
}

func (r *MonitorRepository) PermanentDelete(ctx context.Context, monitorIDs []string) (int64, error) {
	uuidIDs := make([]pgtype.UUID, 0, len(monitorIDs))
	for _, monitorID := range monitorIDs {
		var uuid pgtype.UUID
		if err := uuid.Scan(monitorID); err != nil {
			return 0, monitors.ErrNotFound
		}
		uuidIDs = append(uuidIDs, uuid)
	}
	transaction, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return 0, fmt.Errorf("begin permanent monitor deletion: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()

	var existing int64
	if err := transaction.QueryRow(ctx, `SELECT COUNT(*) FROM monitors WHERE id = ANY($1::uuid[])`, uuidIDs).Scan(&existing); err != nil {
		return 0, fmt.Errorf("find monitors for permanent deletion: %w", err)
	}
	if existing != int64(len(monitorIDs)) {
		return 0, monitors.ErrNotFound
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM alerts WHERE monitor_id = ANY($1::uuid[])`, uuidIDs); err != nil {
		return 0, fmt.Errorf("delete monitor alerts: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM monitor_runs WHERE monitor_id = ANY($1::uuid[])`, uuidIDs); err != nil {
		return 0, fmt.Errorf("delete monitor runs: %w", err)
	}
	command, err := transaction.Exec(ctx, `DELETE FROM monitors WHERE id = ANY($1::uuid[])`, uuidIDs)
	if err != nil {
		return 0, fmt.Errorf("delete monitors permanently: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit permanent monitor deletion: %w", err)
	}
	return command.RowsAffected(), nil
}

func (r *MonitorRepository) ListRevisions(ctx context.Context, monitorID string) ([]monitors.Revision, error) {
	var exists bool
	if err := r.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM monitors WHERE id = $1 AND deleted_at IS NULL)`, monitorID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check monitor: %w", err)
	}
	if !exists {
		return nil, monitors.ErrNotFound
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, monitor_id::text, revision_number, status, schema_version, definition_json,
			COALESCE(change_summary, ''), COALESCE(published_by, ''), published_at, created_by, created_at
		FROM monitor_revisions WHERE monitor_id = $1 ORDER BY revision_number DESC`, monitorID)
	if err != nil {
		return nil, fmt.Errorf("list monitor revisions: %w", err)
	}
	defer rows.Close()
	items := make([]monitors.Revision, 0)
	for rows.Next() {
		var revision monitors.Revision
		var definition []byte
		var publishedAt pgtype.Timestamptz
		if err := rows.Scan(&revision.ID, &revision.MonitorID, &revision.RevisionNumber, &revision.Status, &revision.SchemaVersion, &definition, &revision.ChangeSummary, &revision.PublishedBy, &publishedAt, &revision.CreatedBy, &revision.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan monitor revision: %w", err)
		}
		if err := json.Unmarshal(definition, &revision.Definition); err != nil {
			return nil, fmt.Errorf("decode monitor revision: %w", err)
		}
		if publishedAt.Valid {
			value := publishedAt.Time
			revision.PublishedAt = &value
		}
		items = append(items, revision)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate monitor revisions: %w", err)
	}
	return items, nil
}

func (r *MonitorRepository) GetRevision(ctx context.Context, monitorID, revisionID string) (monitors.Revision, error) {
	var revision monitors.Revision
	var definition []byte
	var publishedAt pgtype.Timestamptz
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, monitor_id::text, revision_number, status, schema_version, definition_json,
			COALESCE(change_summary, ''), COALESCE(published_by, ''), published_at, created_by, created_at
		FROM monitor_revisions WHERE monitor_id = $1 AND id = $2`, monitorID, revisionID).Scan(
		&revision.ID, &revision.MonitorID, &revision.RevisionNumber, &revision.Status, &revision.SchemaVersion,
		&definition, &revision.ChangeSummary, &revision.PublishedBy, &publishedAt, &revision.CreatedBy, &revision.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return monitors.Revision{}, monitors.ErrNotFound
	}
	if err != nil {
		return monitors.Revision{}, fmt.Errorf("get monitor revision: %w", err)
	}
	if err := json.Unmarshal(definition, &revision.Definition); err != nil {
		return monitors.Revision{}, fmt.Errorf("decode monitor revision: %w", err)
	}
	if publishedAt.Valid {
		value := publishedAt.Time
		revision.PublishedAt = &value
	}
	return revision, nil
}

type rowScanner interface {
	Scan(...any) error
}

func scanMonitor(row rowScanner) (monitors.Monitor, error) {
	var monitor monitors.Monitor
	var tags []byte
	var scheduleType string
	var scheduleExpression string
	var intervalSeconds int
	var successRate pgtype.Float8
	var lastDuration pgtype.Int8
	var lastRunAt pgtype.Timestamptz
	if err := row.Scan(
		&monitor.ID, &monitor.Name, &monitor.Slug, &monitor.Description, &monitor.OwnerID, &tags,
		&monitor.EnvironmentID, &monitor.State, &monitor.Health, &monitor.Enabled,
		&monitor.CurrentDraftRevisionID, &monitor.LatestPublishedRevisionID, &monitor.StepCount,
		&scheduleType, &scheduleExpression, &intervalSeconds,
		&monitor.CreatedBy, &monitor.UpdatedBy, &monitor.CreatedAt, &monitor.UpdatedAt,
		&successRate, &lastDuration, &lastRunAt,
	); err != nil {
		return monitors.Monitor{}, err
	}
	if err := json.Unmarshal(tags, &monitor.Tags); err != nil {
		return monitors.Monitor{}, fmt.Errorf("decode monitor tags: %w", err)
	}
	monitor.ScheduleSummary = scheduleSummary(scheduleType, scheduleExpression, intervalSeconds)
	if successRate.Valid {
		monitor.SuccessRate24h = &successRate.Float64
	}
	if lastDuration.Valid {
		monitor.LastLatencyMS = &lastDuration.Int64
	}
	if lastRunAt.Valid {
		monitor.LastRunAt = &lastRunAt.Time
	}
	return monitor, nil
}

func scheduleSummary(scheduleType, expression string, intervalSeconds int) string {
	switch scheduleType {
	case "CRON":
		return expression
	case "INTERVAL":
		return "Every " + formatIntervalDuration(intervalSeconds)
	case "MANUAL":
		return "Manual only"
	default:
		return ""
	}
}

// formatIntervalDuration renders compact cadence labels like "5m" instead of Go's "5m0s".
func formatIntervalDuration(intervalSeconds int) string {
	if intervalSeconds <= 0 {
		return "0s"
	}
	hours := intervalSeconds / 3600
	minutes := (intervalSeconds % 3600) / 60
	seconds := intervalSeconds % 60
	var parts []string
	if hours > 0 {
		parts = append(parts, fmt.Sprintf("%dh", hours))
	}
	if minutes > 0 {
		parts = append(parts, fmt.Sprintf("%dm", minutes))
	}
	if seconds > 0 || len(parts) == 0 {
		parts = append(parts, fmt.Sprintf("%ds", seconds))
	}
	return strings.Join(parts, "")
}

func isUniqueViolation(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == "23505"
}
