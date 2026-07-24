package scheduler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	pool     *pgxpool.Pool
	redis    *redis.Client
	monitors *monitors.Service
	runs     *runs.Service
	logger   *slog.Logger
	parser   cronlib.Parser
}

func New(pool *pgxpool.Pool, redisClient *redis.Client, monitorService *monitors.Service, runService *runs.Service, logger *slog.Logger) *Service {
	return &Service{pool: pool, redis: redisClient, monitors: monitorService, runs: runService, logger: logger, parser: cronlib.NewParser(cronlib.Minute | cronlib.Hour | cronlib.Dom | cronlib.Month | cronlib.Dow)}
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
		next, err := s.next(input, now)
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

func (s *Service) next(config Config, after time.Time) (time.Time, error) {
	location, _ := time.LoadLocation(config.Timezone)
	switch config.Type {
	case "INTERVAL":
		return after.Add(time.Duration(config.IntervalSeconds) * time.Second), nil
	case "CRON":
		schedule, err := s.parser.Parse(config.Expression)
		if err != nil {
			return time.Time{}, err
		}
		return schedule.Next(after.In(location)).UTC(), nil
	default:
		return time.Time{}, ValidationError{Message: "Manual schedules have no next run."}
	}
}

type job struct {
	MonitorID         string    `json:"monitorId"`
	ScheduleID        string    `json:"scheduleId"`
	ConcurrencyPolicy string    `json:"concurrencyPolicy"`
	DueAt             time.Time `json:"dueAt"`
}

func (s *Service) Start(ctx context.Context) {
	go s.poll(ctx)
	go s.consume(ctx)
}

func (s *Service) poll(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
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
	rows, err := tx.Query(ctx, `SELECT s.id::text, s.monitor_id::text, s.schedule_type, COALESCE(s.expression,''), COALESCE(s.interval_seconds,0), s.timezone, s.jitter_seconds, s.concurrency_policy, s.missed_run_policy, s.active, s.next_run_at FROM monitor_schedules s JOIN monitors m ON m.id=s.monitor_id WHERE s.active=TRUE AND s.next_run_at<=NOW() AND m.enabled=TRUE AND m.deleted_at IS NULL ORDER BY s.next_run_at FOR UPDATE OF s SKIP LOCKED LIMIT 25`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var due []Config
	for rows.Next() {
		var item Config
		if err := rows.Scan(&item.ID, &item.MonitorID, &item.Type, &item.Expression, &item.IntervalSeconds, &item.Timezone, &item.JitterSeconds, &item.ConcurrencyPolicy, &item.MissedRunPolicy, &item.Active, &item.NextRunAt); err != nil {
			return err
		}
		due = append(due, item)
	}
	for _, item := range due {
		if item.NextRunAt == nil {
			continue
		}
		payload, _ := json.Marshal(job{MonitorID: item.MonitorID, ScheduleID: item.ID, ConcurrencyPolicy: item.ConcurrencyPolicy, DueAt: *item.NextRunAt})
		key := fmt.Sprintf("rhythm:schedule:%s:%d", item.ID, item.NextRunAt.Unix())
		claimed, err := s.redis.SetNX(ctx, key, "queued", 7*24*time.Hour).Result()
		if err != nil {
			return err
		}
		if claimed {
			if err := s.redis.LPush(ctx, "rhythm:runs:due", payload).Err(); err != nil {
				return err
			}
		}
		next, err := s.next(item, *item.NextRunAt)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE monitor_schedules SET next_run_at=$2, updated_at=NOW() WHERE id=$1`, item.ID, next); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Service) consume(ctx context.Context) {
	for ctx.Err() == nil {
		result, err := s.redis.BRPop(ctx, 2*time.Second, "rhythm:runs:due").Result()
		if err == redis.Nil || errors.Is(err, context.Canceled) {
			continue
		}
		if err != nil {
			s.logger.Error("schedule dequeue failed", "error", err)
			continue
		}
		var item job
		if err := json.Unmarshal([]byte(result[1]), &item); err != nil {
			s.logger.Error("invalid scheduled job", "error", err)
			continue
		}
		release, acquired, err := s.acquireRunLock(ctx, item)
		if err != nil {
			s.logger.Error("scheduled concurrency lock failed", "monitorId", item.MonitorID, "scheduleId", item.ScheduleID, "error", err)
			continue
		}
		if !acquired {
			s.logger.Info("scheduled run skipped because monitor is already running", "monitorId", item.MonitorID, "scheduleId", item.ScheduleID, "policy", item.ConcurrencyPolicy)
			continue
		}
		if _, err := s.runs.RunScheduled(ctx, item.MonitorID, item.ScheduleID); err != nil {
			s.logger.Error("scheduled run failed", "monitorId", item.MonitorID, "scheduleId", item.ScheduleID, "error", err)
		}
		if release != nil {
			release()
			release = nil
		}
	}
}

func (s *Service) acquireRunLock(ctx context.Context, item job) (func(), bool, error) {
	policy := strings.ToUpper(strings.TrimSpace(item.ConcurrencyPolicy))
	if policy == "" {
		policy = "SKIP_IF_RUNNING"
	}
	if policy == "ALLOW" {
		return nil, true, nil
	}
	lockKey := "rhythm:monitor-running:" + item.MonitorID
	token, err := id.NewUUID()
	if err != nil {
		return nil, false, err
	}
	for {
		acquired, err := s.redis.SetNX(ctx, lockKey, token, 24*time.Hour).Result()
		if err != nil {
			return nil, false, err
		}
		if acquired {
			release := func() {
				const unlock = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`
				if err := s.redis.Eval(context.Background(), unlock, []string{lockKey}, token).Err(); err != nil {
					s.logger.Error("scheduled concurrency unlock failed", "monitorId", item.MonitorID, "error", err)
				}
			}
			return release, true, nil
		}
		if policy != "QUEUE" {
			return nil, false, nil
		}
		select {
		case <-ctx.Done():
			return nil, false, ctx.Err()
		case <-time.After(time.Second):
		}
	}
}
