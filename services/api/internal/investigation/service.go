package investigation

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/dynatrace"
	"github.com/rhythm-monitoring/rhythm/internal/elf"
	"github.com/rhythm-monitoring/rhythm/internal/id"
)

type ELFRunner interface {
	Run(ctx context.Context, queryID, actor string, input elf.ProbeInput, evaluate bool) (elf.RunSummary, error)
}

type DynatraceQuerier interface {
	Query(ctx context.Context, applicationID, bindingID string, input dynatrace.QueryInput, actor string) (dynatrace.Run, error)
}

type databaseExec interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, arguments ...any) pgx.Row
	Query(ctx context.Context, sql string, arguments ...any) (pgx.Rows, error)
}

type Service struct {
	pool      *pgxpool.Pool
	elf       ELFRunner
	dynatrace DynatraceQuerier
	logger    *slog.Logger
	now       func() time.Time
	store     backend
}

func New(pool *pgxpool.Pool, elfRunner ELFRunner, dynatraceQuerier DynatraceQuerier, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		pool:      pool,
		elf:       elfRunner,
		dynatrace: dynatraceQuerier,
		logger:    logger,
		now:       func() time.Time { return time.Now().UTC() },
		store:     &pgBackend{pool: pool},
	}
}

func (s *Service) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			if err := s.processOne(ctx); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, pgx.ErrNoRows) {
				s.logger.Error("investigation dispatch", "error", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func Enqueue(ctx context.Context, tx pgx.Tx, alertID, monitorID, runID string, now time.Time) {
	enqueue(ctx, tx, alertID, monitorID, runID, now)
}

func EnqueueWithPool(ctx context.Context, pool *pgxpool.Pool, alertID, monitorID, runID string, now time.Time) {
	enqueue(ctx, pool, alertID, monitorID, runID, now)
}

func enqueue(ctx context.Context, db databaseExec, alertID, monitorID, runID string, now time.Time) {
	alertID = strings.TrimSpace(alertID)
	if alertID == "" {
		return
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	monitorID = strings.TrimSpace(monitorID)
	runID = strings.TrimSpace(runID)
	if monitorID == "" {
		_ = db.QueryRow(ctx, `SELECT COALESCE(monitor_id::text,'') FROM alerts WHERE id=$1`, alertID).Scan(&monitorID)
	}
	monitorID = strings.TrimSpace(monitorID)
	if monitorID == "" {
		return
	}
	var definition []byte
	err := db.QueryRow(ctx, `
		SELECT r.definition_json
		FROM monitors m
		JOIN monitor_revisions r ON r.id = m.latest_published_revision_id
		WHERE m.id=$1`, monitorID).Scan(&definition)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			slog.Error("investigation load published definition", "alertId", alertID, "monitorId", monitorID, "error", err)
		}
		return
	}
	parsed := map[string]any{}
	if len(definition) > 0 {
		if err := json.Unmarshal(definition, &parsed); err != nil {
			slog.Error("investigation decode definition", "alertId", alertID, "error", err)
			return
		}
	}
	checks := ParseChecks(parsed)
	if len(checks) == 0 {
		return
	}
	var applicationID string
	_ = db.QueryRow(ctx, `
		SELECT application_id::text
		FROM application_monitor_links
		WHERE monitor_id=$1
		LIMIT 1`, monitorID).Scan(&applicationID)
	rows := pendingFromPlaybook(checks, alertID, monitorID, runID, strings.TrimSpace(applicationID), now)
	for _, row := range rows {
		if err := insertPending(ctx, db, row); err != nil {
			slog.Error("investigation enqueue", "alertId", alertID, "checkId", row.CheckID, "error", err)
		}
	}
}

func insertPending(ctx context.Context, db databaseExec, row Result) error {
	if row.Evidence == nil {
		row.Evidence = map[string]any{}
	}
	evidence, _ := json.Marshal(row.Evidence)
	serviceIDs, _ := json.Marshal(row.ServiceIDs)
	_, err := db.Exec(ctx, `
		INSERT INTO alert_investigation_results(
			id, alert_id, check_id, monitor_id, run_id, kind, label, query_id,
			application_id, environment_binding_id, service_ids, status, attempt,
			position, summary, evidence, created_at, updated_at
		) VALUES (
			$1,$2::uuid,$3,NULLIF($4,'')::uuid,NULLIF($5,'')::uuid,$6,$7,NULLIF($8,''),
			NULLIF($9,''),NULLIF($10,''),$11,$12,$13,$14,$15,$16,$17,$17
		)
		ON CONFLICT (alert_id, check_id, attempt) DO NOTHING`,
		row.ID, row.AlertID, row.CheckID, row.MonitorID, row.RunID, row.Kind, row.Label, row.QueryID,
		row.ApplicationID, row.EnvironmentBindingID, serviceIDs, row.Status, row.Attempt,
		row.Position, row.Summary, evidence, row.CreatedAt,
	)
	return err
}

func (s *Service) ListByAlert(ctx context.Context, alertID string) (Report, error) {
	if s == nil {
		return Report{AlertID: alertID, Items: []Item{}}, nil
	}
	if s.store != nil {
		results, err := s.store.listLatest(ctx, alertID)
		if err != nil {
			return Report{}, err
		}
		return reportFromResults(alertID, results), nil
	}
	results, err := listLatest(ctx, s.pool, alertID)
	if err != nil {
		return Report{}, err
	}
	return reportFromResults(alertID, results), nil
}

func (s *Service) ListByRun(ctx context.Context, runID string) (Report, error) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return Report{Items: []Item{}}, nil
	}
	if s.store != nil {
		alertID, err := s.store.alertForRun(ctx, runID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return Report{RunID: runID, Items: []Item{}}, nil
			}
			return Report{}, err
		}
		report, err := s.ListByAlert(ctx, alertID)
		if err != nil {
			return Report{}, err
		}
		report.RunID = runID
		return report, nil
	}
	var alertID string
	err := s.pool.QueryRow(ctx, `
		SELECT alert_id::text
		FROM alert_investigation_results
		WHERE run_id=$1
		ORDER BY created_at DESC
		LIMIT 1`, runID).Scan(&alertID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = s.pool.QueryRow(ctx, `
			SELECT a.id::text
			FROM alerts a
			JOIN monitor_runs r ON r.monitor_id = a.monitor_id
			WHERE r.id=$1 AND a.state IN ('OPEN','ACKNOWLEDGED')
			ORDER BY a.updated_at DESC
			LIMIT 1`, runID).Scan(&alertID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return Report{RunID: runID, Items: []Item{}}, nil
	}
	if err != nil {
		return Report{}, err
	}
	report, err := s.ListByAlert(ctx, alertID)
	if err != nil {
		return Report{}, err
	}
	report.RunID = runID
	return report, nil
}

func (s *Service) Rerun(ctx context.Context, alertID, checkID, actor string) (Item, error) {
	alertID = strings.TrimSpace(alertID)
	checkID = strings.TrimSpace(checkID)
	if alertID == "" || checkID == "" {
		return Item{}, ErrNotFound
	}
	var latest Result
	var err error
	if s.store != nil {
		latest, err = s.store.latestByCheck(ctx, alertID, checkID)
	} else {
		latest, err = latestByCheck(ctx, s.pool, alertID, checkID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrNotFound
	}
	if err != nil {
		return Item{}, err
	}
	identifier, err := id.NewUUID()
	if err != nil {
		return Item{}, err
	}
	now := s.now()
	next := latest
	next.ID = identifier
	next.Status = StatusRunning
	next.Attempt = latest.Attempt + 1
	next.Summary = ""
	next.LastError = ""
	next.StartedAt = nil
	next.EndedAt = nil
	next.Evidence = map[string]any{}
	next.CreatedAt = now
	next.UpdatedAt = now
	if s.store != nil {
		if err := s.store.insertPending(ctx, next); err != nil {
			return Item{}, err
		}
	} else if err := insertPending(ctx, s.pool, next); err != nil {
		return Item{}, err
	}
	_ = s.processResult(ctx, next, actor)
	if s.store != nil {
		latest, err = s.store.latestByCheck(ctx, alertID, checkID)
	} else {
		latest, err = latestByCheck(ctx, s.pool, alertID, checkID)
	}
	if err != nil {
		return itemFromResult(next), nil
	}
	return itemFromResult(latest), nil
}

func reportFromResults(alertID string, results []Result) Report {
	items := make([]Item, 0, len(results))
	runID := ""
	for _, result := range results {
		items = append(items, itemFromResult(result))
		if runID == "" {
			runID = result.RunID
		}
	}
	return Report{AlertID: alertID, RunID: runID, Items: items}
}

func (s *Service) processOne(ctx context.Context) error {
	var item Result
	var err error
	if s.store != nil {
		item, err = s.store.claim(ctx)
	} else {
		item, err = claimPending(ctx, s.pool)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return s.processResult(ctx, item, "system")
}

func (s *Service) processResult(ctx context.Context, item Result, actor string) error {
	now := s.now()
	item.Status = StatusRunning
	item.StartedAt = &now
	item.UpdatedAt = now
	if err := s.complete(ctx, item); err != nil {
		return err
	}
	status, summary, evidence, lastError := s.execute(ctx, item, actor)
	ended := s.now()
	item.Status = status
	item.Summary = summary
	item.Evidence = evidence
	item.LastError = lastError
	item.EndedAt = &ended
	item.UpdatedAt = ended
	return s.complete(ctx, item)
}

func (s *Service) complete(ctx context.Context, item Result) error {
	if s.store != nil {
		return s.store.complete(ctx, item)
	}
	return completeResult(ctx, s.pool, item)
}

func (s *Service) execute(ctx context.Context, item Result, actor string) (status, summary string, evidence map[string]any, lastError string) {
	reason := skipReason(item, s.elf != nil, s.dynatrace != nil)
	if reason != "" {
		if s.logger != nil {
			s.logger.Info("investigation skipped", "alertId", item.AlertID, "checkId", item.CheckID, "reason", reason)
		}
		return StatusSkipped, reason, map[string]any{"reason": reason}, reason
	}
	to := s.now()
	from := to.Add(-15 * time.Minute)
	if item.RunID != "" {
		if runAt, ok := s.runTime(ctx, item.RunID); ok {
			to = runAt
			from = runAt.Add(-15 * time.Minute)
		}
	}
	switch item.Kind {
	case KindELFQuery:
		summary, err := s.elf.Run(ctx, item.QueryID, actor, elf.ProbeInput{From: &from, To: &to}, true)
		status, text, evidence := mapELFResult(summary, err)
		if err != nil {
			return status, text, evidence, truncateSummary(err.Error())
		}
		return status, text, evidence, ""
	case KindDynatrace:
		serviceID := ""
		if len(item.ServiceIDs) > 0 {
			serviceID = item.ServiceIDs[0]
		}
		run, err := s.dynatrace.Query(ctx, item.ApplicationID, item.EnvironmentBindingID, dynatrace.QueryInput{
			ServiceID: serviceID,
			TimeFrom:  from,
			TimeTo:    to,
		}, actor)
		status, text, evidence := mapDynatraceResult(run, err)
		if err != nil {
			return status, text, evidence, truncateSummary(err.Error())
		}
		return status, text, evidence, ""
	default:
		return StatusSkipped, "Unsupported investigation check.", map[string]any{}, "Unsupported investigation check."
	}
}

func (s *Service) runTime(ctx context.Context, runID string) (time.Time, bool) {
	if s.store != nil {
		return s.store.runTime(ctx, runID)
	}
	var value time.Time
	err := s.pool.QueryRow(ctx, `SELECT created_at FROM monitor_runs WHERE id=$1`, runID).Scan(&value)
	if err != nil {
		return time.Time{}, false
	}
	return value.UTC(), true
}

var ErrNotFound = errors.New("investigation check not found")

func listLatest(ctx context.Context, db databaseExec, alertID string) ([]Result, error) {
	rows, err := db.Query(ctx, `
		SELECT DISTINCT ON (check_id)
			id::text, alert_id::text, check_id, COALESCE(monitor_id::text,''), COALESCE(run_id::text,''),
			kind, label, COALESCE(query_id,''), COALESCE(application_id,''), COALESCE(environment_binding_id,''),
			service_ids, status, attempt, position, summary, evidence, COALESCE(last_error,''),
			started_at, ended_at, created_at, updated_at
		FROM alert_investigation_results
		WHERE alert_id=$1
		ORDER BY check_id, attempt DESC`, alertID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Result{}
	for rows.Next() {
		item, err := scanResult(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sortResults(items)
	return items, nil
}

func latestByCheck(ctx context.Context, db databaseExec, alertID, checkID string) (Result, error) {
	row := db.QueryRow(ctx, `
		SELECT id::text, alert_id::text, check_id, COALESCE(monitor_id::text,''), COALESCE(run_id::text,''),
			kind, label, COALESCE(query_id,''), COALESCE(application_id,''), COALESCE(environment_binding_id,''),
			service_ids, status, attempt, position, summary, evidence, COALESCE(last_error,''),
			started_at, ended_at, created_at, updated_at
		FROM alert_investigation_results
		WHERE alert_id=$1 AND check_id=$2
		ORDER BY attempt DESC
		LIMIT 1`, alertID, checkID)
	return scanResult(row)
}

func claimPending(ctx context.Context, pool *pgxpool.Pool) (Result, error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	row := tx.QueryRow(ctx, `
		SELECT id::text, alert_id::text, check_id, COALESCE(monitor_id::text,''), COALESCE(run_id::text,''),
			kind, label, COALESCE(query_id,''), COALESCE(application_id,''), COALESCE(environment_binding_id,''),
			service_ids, status, attempt, position, summary, evidence, COALESCE(last_error,''),
			started_at, ended_at, created_at, updated_at
		FROM alert_investigation_results
		WHERE status='PENDING'
		ORDER BY created_at
		FOR UPDATE SKIP LOCKED
		LIMIT 1`)
	item, err := scanResult(row)
	if err != nil {
		return Result{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE alert_investigation_results SET status='RUNNING', started_at=NOW(), updated_at=NOW() WHERE id=$1`, item.ID); err != nil {
		return Result{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Result{}, err
	}
	item.Status = StatusRunning
	return item, nil
}

func completeResult(ctx context.Context, db databaseExec, item Result) error {
	if item.Evidence == nil {
		item.Evidence = map[string]any{}
	}
	evidence, _ := json.Marshal(item.Evidence)
	_, err := db.Exec(ctx, `
		UPDATE alert_investigation_results
		SET status=$2, summary=$3, evidence=$4, last_error=NULLIF($5,''),
			started_at=$6, ended_at=$7, updated_at=$8
		WHERE id=$1`,
		item.ID, item.Status, item.Summary, evidence, item.LastError,
		item.StartedAt, item.EndedAt, item.UpdatedAt,
	)
	return err
}

type resultScanner interface {
	Scan(dest ...any) error
}

func scanResult(row resultScanner) (Result, error) {
	var item Result
	var serviceIDs []byte
	var evidence []byte
	var started, ended *time.Time
	err := row.Scan(
		&item.ID, &item.AlertID, &item.CheckID, &item.MonitorID, &item.RunID,
		&item.Kind, &item.Label, &item.QueryID, &item.ApplicationID, &item.EnvironmentBindingID,
		&serviceIDs, &item.Status, &item.Attempt, &item.Position, &item.Summary, &evidence, &item.LastError,
		&started, &ended, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return Result{}, err
	}
	_ = json.Unmarshal(serviceIDs, &item.ServiceIDs)
	if item.ServiceIDs == nil {
		item.ServiceIDs = []string{}
	}
	_ = json.Unmarshal(evidence, &item.Evidence)
	if item.Evidence == nil {
		item.Evidence = map[string]any{}
	}
	item.StartedAt = started
	item.EndedAt = ended
	return item, nil
}

func sortResults(items []Result) {
	for i := 0; i < len(items); i++ {
		for j := i + 1; j < len(items); j++ {
			if items[j].Position < items[i].Position || (items[j].Position == items[i].Position && items[j].CreatedAt.Before(items[i].CreatedAt)) {
				items[i], items[j] = items[j], items[i]
			}
		}
	}
}

type backend interface {
	insertPending(ctx context.Context, row Result) error
	listLatest(ctx context.Context, alertID string) ([]Result, error)
	latestByCheck(ctx context.Context, alertID, checkID string) (Result, error)
	claim(ctx context.Context) (Result, error)
	complete(ctx context.Context, item Result) error
	alertForRun(ctx context.Context, runID string) (string, error)
	runTime(ctx context.Context, runID string) (time.Time, bool)
}

type pgBackend struct {
	pool *pgxpool.Pool
}

func (p *pgBackend) insertPending(ctx context.Context, row Result) error {
	return insertPending(ctx, p.pool, row)
}
func (p *pgBackend) listLatest(ctx context.Context, alertID string) ([]Result, error) {
	return listLatest(ctx, p.pool, alertID)
}
func (p *pgBackend) latestByCheck(ctx context.Context, alertID, checkID string) (Result, error) {
	return latestByCheck(ctx, p.pool, alertID, checkID)
}
func (p *pgBackend) claim(ctx context.Context) (Result, error) {
	return claimPending(ctx, p.pool)
}
func (p *pgBackend) complete(ctx context.Context, item Result) error {
	return completeResult(ctx, p.pool, item)
}
func (p *pgBackend) alertForRun(ctx context.Context, runID string) (string, error) {
	var alertID string
	err := p.pool.QueryRow(ctx, `
		SELECT alert_id::text
		FROM alert_investigation_results
		WHERE run_id=$1
		ORDER BY created_at DESC
		LIMIT 1`, runID).Scan(&alertID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = p.pool.QueryRow(ctx, `
			SELECT a.id::text
			FROM alerts a
			JOIN monitor_runs r ON r.monitor_id = a.monitor_id
			WHERE r.id=$1 AND a.state IN ('OPEN','ACKNOWLEDGED')
			ORDER BY a.updated_at DESC
			LIMIT 1`, runID).Scan(&alertID)
	}
	return alertID, err
}
func (p *pgBackend) runTime(ctx context.Context, runID string) (time.Time, bool) {
	var value time.Time
	err := p.pool.QueryRow(ctx, `SELECT created_at FROM monitor_runs WHERE id=$1`, runID).Scan(&value)
	if err != nil {
		return time.Time{}, false
	}
	return value.UTC(), true
}
