package sahara

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/id"
)

type Config struct {
	IngestURL string
	Timeout   time.Duration
}

type Service struct {
	pool   *pgxpool.Pool
	cfg    Config
	logger *slog.Logger
	client *http.Client
	now    func() time.Time
}

type databaseExec interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

func New(pool *pgxpool.Pool, cfg Config, logger *slog.Logger) *Service {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Service{
		pool:   pool,
		cfg:    cfg,
		logger: logger,
		client: &http.Client{Timeout: timeout},
		now:    func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			if err := s.processOne(ctx); err != nil && !errors.Is(err, context.Canceled) {
				s.logger.Error("sahara dispatch", "error", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// Enqueue records a Sahara dispatch for a newly opened alert. Duplicate
// (alert, event) rows are ignored so already-open polls do not re-fire.
func Enqueue(ctx context.Context, tx pgx.Tx, alertID string, now time.Time) {
	enqueue(ctx, tx, alertID, now)
}

func EnqueueWithPool(ctx context.Context, pool *pgxpool.Pool, alertID string, now time.Time) {
	enqueue(ctx, pool, alertID, now)
}

func enqueue(ctx context.Context, db databaseExec, alertID string, now time.Time) {
	alertID = strings.TrimSpace(alertID)
	if alertID == "" {
		return
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	identifier, err := id.NewUUID()
	if err != nil {
		slog.Error("sahara enqueue id", "alertId", alertID, "error", err)
		return
	}
	_, err = db.Exec(ctx, `
		INSERT INTO sahara_dispatches(id,alert_id,event_type,status,next_attempt_at,created_at,updated_at)
		VALUES($1,$2::uuid,'ALERT_OPENED','PENDING',$3,$3,$3)
		ON CONFLICT (alert_id, event_type) DO NOTHING`, identifier, alertID, now)
	if err != nil {
		slog.Error("sahara enqueue", "alertId", alertID, "error", err)
	}
}

type dispatch struct {
	ID       string
	Alert    AlertContext
	App      *ApplicationSettings
	Attempts int
}

func (s *Service) processOne(ctx context.Context) error {
	if strings.TrimSpace(s.cfg.IngestURL) == "" {
		return nil
	}
	item, err := s.claim(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	event, skip := Prepare(item.App, s.cfg.IngestURL, item.Alert)
	now := s.now()
	if skip != "" {
		_, updateErr := s.pool.Exec(context.WithoutCancel(ctx), `
			UPDATE sahara_dispatches
			SET status='SKIPPED', last_error=$2, event_unique_id=$3, updated_at=$4
			WHERE id=$1`, item.ID, skip, event.EventUniqueID, now)
		return updateErr
	}
	err = s.DispatchEvent(ctx, event)
	if err == nil {
		_, updateErr := s.pool.Exec(context.WithoutCancel(ctx), `
			UPDATE sahara_dispatches
			SET status='SENT', sent_at=$2, last_error=NULL, event_unique_id=$3, updated_at=$2
			WHERE id=$1`, item.ID, now, event.EventUniqueID)
		return updateErr
	}
	s.logger.Error("sahara ingest failed", "dispatchId", item.ID, "alertId", item.Alert.AlertID, "error", err)
	attempts := item.Attempts + 1
	status := "PENDING"
	if attempts >= 5 {
		status = "FAILED"
	}
	next := now.Add(time.Duration(1<<min(attempts, 6)) * time.Minute)
	_, updateErr := s.pool.Exec(context.WithoutCancel(ctx), `
		UPDATE sahara_dispatches
		SET status=$2, attempts=$3, last_error=$4, next_attempt_at=$5, event_unique_id=$6, updated_at=$7
		WHERE id=$1`, item.ID, status, attempts, truncateError(err), next, event.EventUniqueID, now)
	if updateErr != nil {
		return updateErr
	}
	return fmt.Errorf("sahara ingest failed: %w", err)
}

func (s *Service) claim(ctx context.Context) (dispatch, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return dispatch{}, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	var item dispatch
	var appID *string
	var enabled *bool
	var assignment, reporter, envAffected, generator, defaultSev, appName *string
	var evidence []byte
	err = tx.QueryRow(ctx, `
		SELECT d.id::text, d.attempts,
			a.id::text, a.source_type,
			COALESCE(a.monitor_id::text,''), COALESCE(a.browser_monitor_id::text,''),
			COALESCE(NULLIF(m.name,''), NULLIF(bm.name,''), NULLIF(a.external_monitor_name,''), NULLIF(a.title,''), 'Alert'),
			a.severity, a.title, COALESCE(a.description,''), COALESCE(a.failure_category,''),
			COALESCE(a.last_triggered_at, a.created_at, NOW()), COALESCE(a.evidence, '{}'::jsonb),
			app.id::text, app.sahara_enabled, app.sahara_assignment_group, app.sahara_reporter_group,
			app.sahara_environment_affected, app.sahara_event_generator, app.sahara_default_severity, app.name
		FROM sahara_dispatches d
		JOIN alerts a ON a.id = d.alert_id
		LEFT JOIN monitors m ON m.id = a.monitor_id
		LEFT JOIN browser_monitors bm ON bm.id = a.browser_monitor_id
		LEFT JOIN applications app ON app.id = COALESCE(
			a.application_id,
			(SELECT aml.application_id FROM application_monitor_links aml WHERE aml.monitor_id = a.monitor_id LIMIT 1)
		)
		WHERE d.status='PENDING' AND d.next_attempt_at <= NOW()
		ORDER BY d.created_at
		FOR UPDATE OF d SKIP LOCKED
		LIMIT 1`).Scan(
		&item.ID, &item.Attempts,
		&item.Alert.AlertID, &item.Alert.SourceType,
		&item.Alert.MonitorID, &item.Alert.BrowserMonitorID, &item.Alert.MonitorName,
		&item.Alert.Severity, &item.Alert.Title, &item.Alert.Description, &item.Alert.FailureCategory,
		&item.Alert.OccurredAt, &evidence,
		&appID, &enabled, &assignment, &reporter, &envAffected, &generator, &defaultSev, &appName,
	)
	if err != nil {
		return dispatch{}, err
	}
	item.Alert.RunID = runIDFromEvidence(evidence)
	if item.Alert.RunID == "" && item.Alert.MonitorID != "" {
		var runID string
		if lookupErr := tx.QueryRow(ctx, `
			SELECT id::text FROM monitor_runs
			WHERE monitor_id=$1
			ORDER BY created_at DESC
			LIMIT 1`, item.Alert.MonitorID).Scan(&runID); lookupErr == nil {
			item.Alert.RunID = runID
		}
	}
	if appID != nil && enabled != nil {
		item.App = &ApplicationSettings{
			Enabled:             *enabled,
			Name:                deref(appName),
			AssignmentGroup:     deref(assignment),
			ReporterGroup:       deref(reporter),
			EnvironmentAffected: deref(envAffected),
			EventGenerator:      deref(generator),
			DefaultSeverity:     deref(defaultSev),
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE sahara_dispatches SET status='SENDING', updated_at=NOW() WHERE id=$1`, item.ID); err != nil {
		return dispatch{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return dispatch{}, err
	}
	return item, nil
}

func (s *Service) DispatchEvent(ctx context.Context, event Event) error {
	return s.post(ctx, event)
}

type TestEventInput struct {
	AssignmentGroup     string `json:"assignmentGroup"`
	ReporterGroup       string `json:"reporterGroup"`
	EnvironmentAffected string `json:"environmentAffected"`
	Severity            string `json:"severity"`
	Summary             string `json:"summary"`
	Description         string `json:"description"`
	EventGenerator      string `json:"eventGenerator"`
}

var (
	ErrIngestNotConfigured = errors.New("Sahara ingest URL is not configured")
	ErrAssignmentRequired  = errors.New("assignment group is required")
)

type IngestStatus struct {
	Configured bool   `json:"configured"`
	Host       string `json:"host,omitempty"`
	Scheme     string `json:"scheme,omitempty"`
}

func (s *Service) IngestStatus() IngestStatus {
	if s == nil {
		return IngestStatus{}
	}
	raw := strings.TrimSpace(s.cfg.IngestURL)
	if raw == "" {
		return IngestStatus{}
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		return IngestStatus{}
	}
	return IngestStatus{Configured: true, Host: parsed.Host, Scheme: parsed.Scheme}
}

func (s *Service) SendTestEvent(ctx context.Context, input TestEventInput) (Event, error) {
	if s == nil || strings.TrimSpace(s.cfg.IngestURL) == "" {
		return Event{}, ErrIngestNotConfigured
	}
	assignment := strings.TrimSpace(input.AssignmentGroup)
	if assignment == "" {
		return Event{}, ErrAssignmentRequired
	}
	summary := strings.TrimSpace(input.Summary)
	if summary == "" {
		summary = "Rhythm Sahara ingest test"
	}
	description := strings.TrimSpace(input.Description)
	if description == "" {
		description = "This is a real Rhythm outbound Sahara test event."
	}
	now := time.Now().UTC()
	if s.now != nil {
		now = s.now()
	}
	alertID, err := id.NewUUID()
	if err != nil {
		alertID = fmt.Sprintf("test-%d", now.UnixNano())
	}
	ticketSeverity := strings.TrimSpace(input.Severity)
	event, skip := Prepare(&ApplicationSettings{
		Enabled:             true,
		Name:                "Rhythm",
		AssignmentGroup:     assignment,
		ReporterGroup:       strings.TrimSpace(input.ReporterGroup),
		EnvironmentAffected: strings.TrimSpace(input.EnvironmentAffected),
		EventGenerator:      strings.TrimSpace(input.EventGenerator),
		DefaultSeverity:     ticketSeverity,
	}, s.cfg.IngestURL, AlertContext{
		AlertID:     alertID,
		MonitorID:   "test-notifications",
		MonitorName: "Test Notifications",
		SourceType:  "RHYTHM_MONITOR",
		Severity:    alertSeverityFromTicket(ticketSeverity),
		Title:       summary,
		Description: description,
		OccurredAt:  now,
	})
	if skip != "" {
		return Event{}, fmt.Errorf("sahara test skipped: %s", skip)
	}
	s.logger.Info("test sahara event",
		"host", s.IngestStatus().Host,
		"assignmentGroup", assignment,
		"eventUniqueId", event.EventUniqueID,
		"summaryLen", len(summary),
		"descriptionLen", len(description),
	)
	if err = s.DispatchEvent(ctx, event); err != nil {
		return event, err
	}
	return event, nil
}

func (s *Service) post(ctx context.Context, event Event) error {
	target, err := url.Parse(strings.TrimSpace(s.cfg.IngestURL))
	if err != nil || target.Host == "" || (target.Scheme != "https" && target.Scheme != "http") {
		return errors.New("sahara ingest URL is invalid")
	}
	encoded, err := json.Marshal(event)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target.String(), bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64*1024))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("sahara ingest returned status %d", response.StatusCode)
	}
	return nil
}

func runIDFromEvidence(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	var evidence map[string]any
	if err := json.Unmarshal(raw, &evidence); err != nil {
		return ""
	}
	for _, key := range []string{"browserRunId", "runId"} {
		if value, ok := evidence[key].(string); ok {
			if trimmed := strings.TrimSpace(value); trimmed != "" {
				return trimmed
			}
		}
	}
	return ""
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func truncateError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > 240 {
		message = message[:240]
	}
	return message
}
