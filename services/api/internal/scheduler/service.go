package scheduler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	cronlib "github.com/robfig/cron/v3"

	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/monitors"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

type Config struct {
	ID                string     `json:"id,omitempty"`
	MonitorID         string     `json:"monitorId,omitempty"`
	Type              string     `json:"type"`
	Expression        string     `json:"expression,omitempty"`
	IntervalSeconds   int        `json:"intervalSeconds,omitempty"`
	Timezone          string     `json:"timezone"`
	JitterSeconds     int        `json:"jitterSeconds"`
	ConcurrencyPolicy string     `json:"concurrencyPolicy"`
	MissedRunPolicy   string     `json:"missedRunPolicy"`
	Active            bool       `json:"active"`
	NextRunAt         *time.Time `json:"nextRunAt,omitempty"`
}

type ValidationError struct{ Message string }

func (e ValidationError) Error() string { return e.Message }

type Service struct {
	pool         *pgxpool.Pool
	monitors     *monitors.Service
	runs         *runs.Service
	logger       *slog.Logger
	parser       cronlib.Parser
	batchSize    int
	pollInterval time.Duration
}

func New(pool *pgxpool.Pool, redisClient redis.UniversalClient, monitorService *monitors.Service, runService *runs.Service, logger *slog.Logger) *Service {
	return NewWithOptions(pool, redisClient, monitorService, runService, logger, 1000, 500*time.Millisecond)
}

func NewWithOptions(pool *pgxpool.Pool, _ redis.UniversalClient, monitorService *monitors.Service, runService *runs.Service, logger *slog.Logger, batchSize int, pollInterval time.Duration) *Service {
	if batchSize <= 0 {
		batchSize = 1000
	}
	if pollInterval <= 0 {
		pollInterval = 500 * time.Millisecond
	}
	return &Service{pool: pool, monitors: monitorService, runs: runService, logger: logger, parser: cronlib.NewParser(cronlib.Minute | cronlib.Hour | cronlib.Dom | cronlib.Month | cronlib.Dow), batchSize: batchSize, pollInterval: pollInterval}
}

func (s *Service) Configure(ctx context.Context, monitorID string, input Config) (Config, error) {
	monitor, err := s.monitors.Get(ctx, monitorID)
	if err != nil {
		return Config{}, err
	}
	input.MonitorID = monitorID
	input.Type = strings.ToUpper(strings.TrimSpace(input.Type))
	if input.Timezone == "" {
		input.Timezone = "UTC"
	}
	if input.ConcurrencyPolicy == "" {
		input.ConcurrencyPolicy = "SKIP_IF_RUNNING"
	}
	if input.MissedRunPolicy == "" {
		input.MissedRunPolicy = "SKIP"
	}
	if err := s.validate(input); err != nil {
		return Config{}, err
	}
	var existingID string
	lookupErr := s.pool.QueryRow(ctx, `SELECT id::text FROM monitor_schedules WHERE monitor_id=$1 ORDER BY updated_at DESC LIMIT 1`, monitorID).Scan(&existingID)
	if lookupErr == nil {
		input.ID = existingID
	} else if !errors.Is(lookupErr, pgx.ErrNoRows) {
		return Config{}, lookupErr
	}
	if input.ID == "" {
		input.ID, err = id.NewUUID()
		if err != nil {
			return Config{}, err
		}
	}
	input.Active = monitor.Enabled && input.Type != "MANUAL"
	now := time.Now().UTC()
	if input.Active {
		next, err := s.next(input, now, true)
		if err != nil {
			return Config{}, err
		}
		input.NextRunAt = &next
	} else {
		input.NextRunAt = nil
	}
	if lookupErr == nil {
		_, err = s.pool.Exec(ctx, `UPDATE monitor_schedules SET schedule_type=$2, expression=NULLIF($3,''), interval_seconds=NULLIF($4,0), timezone=$5, jitter_seconds=$6, concurrency_policy=$7, missed_run_policy=$8, next_run_at=$9, active=$10, updated_at=$11 WHERE id=$1`, input.ID, input.Type, input.Expression, input.IntervalSeconds, input.Timezone, input.JitterSeconds, input.ConcurrencyPolicy, input.MissedRunPolicy, input.NextRunAt, input.Active, now)
	} else {
		_, err = s.pool.Exec(ctx, `INSERT INTO monitor_schedules (id, monitor_id, schedule_type, expression, interval_seconds, timezone, jitter_seconds, concurrency_policy, missed_run_policy, next_run_at, active, created_at, updated_at) VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,0),$6,$7,$8,$9,$10,$11,$12,$12)`, input.ID, monitorID, input.Type, input.Expression, input.IntervalSeconds, input.Timezone, input.JitterSeconds, input.ConcurrencyPolicy, input.MissedRunPolicy, input.NextRunAt, input.Active, now)
	}
	if err != nil {
		return Config{}, fmt.Errorf("save monitor schedule: %w", err)
	}
	return s.Get(ctx, monitorID)
}

func (s *Service) Get(ctx context.Context, monitorID string) (Config, error) {
	var result Config
	err := s.pool.QueryRow(ctx, `SELECT id::text, monitor_id::text, schedule_type, COALESCE(expression,''), COALESCE(interval_seconds,0), timezone, jitter_seconds, concurrency_policy, missed_run_policy, active, next_run_at FROM monitor_schedules WHERE monitor_id=$1 ORDER BY updated_at DESC LIMIT 1`, monitorID).Scan(&result.ID, &result.MonitorID, &result.Type, &result.Expression, &result.IntervalSeconds, &result.Timezone, &result.JitterSeconds, &result.ConcurrencyPolicy, &result.MissedRunPolicy, &result.Active, &result.NextRunAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Config{}, monitors.ErrNotFound
	}
	return result, err
}

func (s *Service) validate(config Config) error {
	if _, err := time.LoadLocation(config.Timezone); err != nil {
		return ValidationError{Message: "Timezone is invalid."}
	}
	if config.JitterSeconds < 0 || config.JitterSeconds > 3600 {
		return ValidationError{Message: "Jitter must be between 0 and 3,600 seconds."}
	}
	if config.ConcurrencyPolicy != "SKIP_IF_RUNNING" && config.ConcurrencyPolicy != "QUEUE" && config.ConcurrencyPolicy != "ALLOW" {
		return ValidationError{Message: "Concurrency policy is invalid."}
	}
	if config.MissedRunPolicy != "SKIP" && config.MissedRunPolicy != "CATCH_UP" {
		return ValidationError{Message: "Missed-run policy must be SKIP or CATCH_UP."}
	}
	switch config.Type {
	case "MANUAL":
		return nil
	case "INTERVAL":
		if config.IntervalSeconds < 10 {
			return ValidationError{Message: "Interval must be at least 10 seconds."}
		}
	case "CRON":
		if _, err := s.parser.Parse(config.Expression); err != nil {
			return ValidationError{Message: "Cron expression must contain five valid fields."}
		}
	default:
		return ValidationError{Message: "Schedule type must be MANUAL, INTERVAL, or CRON."}
	}
	return nil
}

func (s *Service) next(config Config, after time.Time, initial bool) (time.Time, error) {
	location, _ := time.LoadLocation(config.Timezone)
	switch config.Type {
	case "INTERVAL":
		next := after.Add(time.Duration(config.IntervalSeconds) * time.Second)
		if initial {
			next = next.Add(deterministicJitter(config.ID, config.JitterSeconds))
		}
		return next, nil
	case "CRON":
		schedule, err := s.parser.Parse(config.Expression)
		if err != nil {
			return time.Time{}, err
		}
		return schedule.Next(after.In(location)).UTC().Add(deterministicJitter(config.ID, config.JitterSeconds)), nil
	default:
		return time.Time{}, ValidationError{Message: "Manual schedules have no next run."}
	}
}

func (s *Service) Start(ctx context.Context) {
	go s.poll(ctx)
}

func (s *Service) poll(ctx context.Context) {
	ticker := time.NewTicker(s.pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.enqueueDue(ctx); err != nil {
				s.logger.Error("schedule poll failed", "error", err)
			}
		}
	}
}

func (s *Service) enqueueDue(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	rows, err := tx.Query(ctx, `
		SELECT s.id::text,s.monitor_id::text,s.schedule_type,COALESCE(s.expression,''),
			COALESCE(s.interval_seconds,0),s.timezone,s.jitter_seconds,s.concurrency_policy,
			s.missed_run_policy,s.active,s.next_run_at,m.name,COALESCE(m.environment_id::text,''),
			m.latest_published_revision_id::text,r.revision_number,r.definition_json
		FROM monitor_schedules s
		JOIN monitors m ON m.id=s.monitor_id
		JOIN monitor_revisions r ON r.id=m.latest_published_revision_id
		WHERE s.active=TRUE AND s.next_run_at<=NOW() AND m.enabled=TRUE AND m.deleted_at IS NULL
		ORDER BY s.next_run_at FOR UPDATE OF s SKIP LOCKED LIMIT $1`, s.batchSize)
	if err != nil {
		return err
	}
	defer rows.Close()
	type dueSchedule struct {
		Config
		MonitorName, EnvironmentID, RevisionID string
		RevisionNumber                         int
		Definition                             runs.Definition
	}
	var due []dueSchedule
	for rows.Next() {
		var item dueSchedule
		var definitionJSON []byte
		if err := rows.Scan(&item.ID, &item.MonitorID, &item.Type, &item.Expression, &item.IntervalSeconds, &item.Timezone, &item.JitterSeconds, &item.ConcurrencyPolicy, &item.MissedRunPolicy, &item.Active, &item.NextRunAt, &item.MonitorName, &item.EnvironmentID, &item.RevisionID, &item.RevisionNumber, &definitionJSON); err != nil {
			return err
		}
		if err := json.Unmarshal(definitionJSON, &item.Definition); err != nil {
			return fmt.Errorf("decode scheduled monitor definition: %w", err)
		}
		due = append(due, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()
	batch := &pgx.Batch{}
	queuedAt := time.Now().UTC()
	queuedCommands := 0
	for _, item := range due {
		if item.NextRunAt == nil {
			continue
		}
		runID, err := id.NewUUID()
		if err != nil {
			return err
		}
		eventID, err := id.NewUUID()
		if err != nil {
			return err
		}
		jobID, err := id.NewUUID()
		if err != nil {
			return err
		}
		outboxID, err := id.NewUUID()
		if err != nil {
			return err
		}
		deduplication := fmt.Sprintf("schedule:%s:%d", item.ID, item.NextRunAt.UTC().Unix())
		request := runs.QueueRequest{
			MonitorID: item.MonitorID, RevisionID: item.RevisionID, ActorID: item.ID, Mode: "published", TriggerType: "SCHEDULED",
			ScheduleID: item.ID, ConcurrencyPolicy: item.ConcurrencyPolicy,
			Deduplication: deduplication, QueuedAt: queuedAt, RecoverySafe: false,
			Snapshot: &runs.ExecutionSnapshot{MonitorName: item.MonitorName, EnvironmentID: item.EnvironmentID,
				RevisionID: item.RevisionID, RevisionNumber: item.RevisionNumber, Definition: item.Definition},
		}
		payload, _ := json.Marshal(request)
		executionContext, _ := json.Marshal(map[string]any{
			"monitorName": item.MonitorName, "environmentId": item.EnvironmentID,
			"revisionId": item.RevisionID, "revisionNumber": item.RevisionNumber,
		})
		batch.Queue(`
			INSERT INTO monitor_runs(
				id,monitor_id,revision_id,status,trigger_type,trigger_source,warning_count,
				queue_delay_ms,created_at,execution_context_json,alert_impact_json,setup_script_json)
			VALUES($1,$2,$3,'QUEUED','SCHEDULED',$4,0,0,$5,$6,'{}'::jsonb,'{}'::jsonb)`,
			runID, item.MonitorID, item.RevisionID, item.ID, queuedAt, executionContext)
		batch.Queue(`
			INSERT INTO run_events(id,monitor_run_id,sequence,event_type,status,message,details_json,occurred_at,duration_ms)
			VALUES($1,$2,1,'RUN_QUEUED','QUEUED','Run accepted and queued for execution.','{}'::jsonb,$3,0)`,
			eventID, runID, queuedAt)
		batch.Queue(`
			INSERT INTO execution_jobs(
				id,run_id,job_type,queue_class,priority,status,payload_json,deduplication_key,
				available_at,created_at,updated_at)
			VALUES($1,$2,'API_MONITOR_RUN','scheduled',10,'QUEUED',$3,$4,$5,$5,$5)`,
			jobID, runID, payload, deduplication, queuedAt)
		batch.Queue(`
			INSERT INTO execution_job_outbox(id,job_id,stream_name,payload_json,available_at)
			VALUES($1::uuid,$2::uuid,'rhythm:execution:scheduled',jsonb_build_object('jobId',($2::uuid)::text),$3)`,
			outboxID, jobID, queuedAt)
		nextFrom := *item.NextRunAt
		initial := false
		if item.MissedRunPolicy == "SKIP" && time.Since(*item.NextRunAt) > s.pollInterval {
			nextFrom = time.Now().UTC()
			initial = item.Type == "INTERVAL"
		}
		next, err := s.next(item.Config, nextFrom, initial)
		if err != nil {
			return err
		}
		batch.Queue(`UPDATE monitor_schedules SET next_run_at=$2,updated_at=$3 WHERE id=$1`, item.ID, next, queuedAt)
		queuedCommands += 5
	}
	if queuedCommands > 0 {
		results := tx.SendBatch(ctx, batch)
		for range queuedCommands {
			if _, err := results.Exec(); err != nil {
				_ = results.Close()
				return fmt.Errorf("batch scheduled run enqueue: %w", err)
			}
		}
		if err := results.Close(); err != nil {
			return fmt.Errorf("close scheduled enqueue batch: %w", err)
		}
	}
	return tx.Commit(ctx)
}

func deterministicJitter(scheduleID string, maximumSeconds int) time.Duration {
	if maximumSeconds <= 0 {
		return 0
	}
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(scheduleID))
	return time.Duration(hash.Sum32()%uint32(maximumSeconds+1)) * time.Second
}
