package executionjobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	queueutil "github.com/rhythm-monitoring/rhythm/internal/queue"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

const (
	scheduledStream = "rhythm:execution:scheduled"
	manualStream    = "rhythm:execution:manual"
	consumerGroup   = "rhythm-api-workers"
)

type Runner interface {
	ExecuteQueued(context.Context, string, runs.QueueRequest) (runs.Run, error)
}

type Service struct {
	pool              *pgxpool.Pool
	redis             redis.UniversalClient
	runner            Runner
	logger            *slog.Logger
	workerID          string
	concurrency       int
	globalSlots       chan struct{}
	manualSlots       chan struct{}
	memoryStopPercent int
	dispatchOnce      sync.Once
	workerOnce        sync.Once
}

func (s *Service) SetMemoryStopPercent(percent int) {
	if percent >= 50 && percent <= 95 {
		s.memoryStopPercent = percent
	}
}

type claimOutcome uint8

const (
	claimUnavailable claimOutcome = iota
	claimReady
	claimHandled
)

func New(pool *pgxpool.Pool, redisClient redis.UniversalClient, runner Runner, logger *slog.Logger, concurrency int) *Service {
	if concurrency <= 0 {
		concurrency = 32
	}
	manualCapacity := max(1, concurrency/5)
	hostname, _ := os.Hostname()
	workerID := hostname + "-" + strconv.Itoa(os.Getpid())
	return &Service{
		pool: pool, redis: redisClient, runner: runner, logger: logger,
		workerID: workerID, concurrency: concurrency,
		globalSlots: make(chan struct{}, concurrency),
		manualSlots: make(chan struct{}, manualCapacity),
	}
}

func (s *Service) Start(ctx context.Context) {
	s.StartDispatcher(ctx)
	s.StartWorkers(ctx)
}

func (s *Service) StartDispatcher(ctx context.Context) {
	s.dispatchOnce.Do(func() {
		go s.dispatchOutbox(ctx)
		go s.reclaimExpired(ctx)
		go s.cleanupStalePending(ctx)
	})
}

func (s *Service) StartWorkers(ctx context.Context) {
	s.workerOnce.Do(func() {
		for _, stream := range []string{scheduledStream, manualStream} {
			if err := s.redis.XGroupCreateMkStream(ctx, stream, consumerGroup, "0").Err(); err != nil && !isBusyGroup(err) {
				s.logger.Error("create execution consumer group", "stream", stream, "error", err)
			}
		}
		go s.consume(ctx, scheduledStream, false)
		go s.consume(ctx, manualStream, true)
	})
}

func (s *Service) dispatchOutbox(ctx context.Context) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for {
				count, err := s.publishOutboxBatch(ctx, 500)
				if err != nil {
					s.logger.Error("publish execution outbox", "error", err)
					break
				}
				if count < 500 {
					break
				}
			}
		}
	}
}

func (s *Service) publishOutboxBatch(ctx context.Context, limit int) (int, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	rows, err := tx.Query(ctx, `
		SELECT id::text, job_id::text, stream_name
		FROM execution_job_outbox
		WHERE published_at IS NULL AND available_at<=NOW()
		ORDER BY created_at
		FOR UPDATE SKIP LOCKED
		LIMIT $1`, limit)
	if err != nil {
		return 0, err
	}
	type item struct{ id, jobID, stream string }
	items := make([]item, 0, limit)
	for rows.Next() {
		var candidate item
		if err := rows.Scan(&candidate.id, &candidate.jobID, &candidate.stream); err != nil {
			rows.Close()
			return 0, err
		}
		items = append(items, candidate)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	if len(items) == 0 {
		return 0, tx.Commit(ctx)
	}
	_, publishErr := s.redis.Pipelined(ctx, func(pipe redis.Pipeliner) error {
		for _, candidate := range items {
			pipe.XAdd(ctx, &redis.XAddArgs{
				Stream: candidate.stream,
				Values: map[string]any{"jobId": candidate.jobID},
				MaxLen: 100000,
				Approx: true,
			})
		}
		return nil
	})
	ids := make([]string, 0, len(items))
	for _, candidate := range items {
		ids = append(ids, candidate.id)
	}
	if publishErr != nil {
		_, _ = tx.Exec(ctx, `
			UPDATE execution_job_outbox
			SET publish_attempts=publish_attempts+1,last_error=$2
			WHERE id=ANY($1::uuid[])`, ids, safeError(publishErr))
		return 0, publishErr
	}
	if _, err := tx.Exec(ctx, `
		UPDATE execution_job_outbox
		SET published_at=NOW(),publish_attempts=publish_attempts+1,last_error=NULL
		WHERE id=ANY($1::uuid[])`, ids); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(items), nil
}

func (s *Service) consume(ctx context.Context, stream string, manual bool) {
	consumerName := s.workerID + "-" + queueSuffix(stream)
	readCount := int64(min(256, s.concurrency))
	for ctx.Err() == nil {
		if cgroupMemoryPressure(s.memoryStopPercent) {
			timer := time.NewTimer(500 * time.Millisecond)
			select {
			case <-ctx.Done():
				if !timer.Stop() {
					<-timer.C
				}
				return
			case <-timer.C:
				continue
			}
		}
		result, err := s.redis.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group: consumerGroup, Consumer: consumerName,
			Streams: []string{stream, ">"}, Count: readCount, Block: 2 * time.Second,
		}).Result()
		if errors.Is(err, redis.Nil) || errors.Is(err, context.Canceled) {
			continue
		}
		if err != nil {
			s.logger.Error("read execution stream", "stream", stream, "error", err)
			continue
		}
		for _, batch := range result {
			for _, message := range batch.Messages {
				jobID, _ := message.Values["jobId"].(string)
				if jobID == "" {
					_ = queueutil.AcknowledgeAndDelete(ctx, s.redis, stream, consumerGroup, message.ID)
					continue
				}
				if manual {
					select {
					case s.manualSlots <- struct{}{}:
					case <-ctx.Done():
						return
					}
				}
				select {
				case s.globalSlots <- struct{}{}:
					go s.process(ctx, stream, message.ID, jobID, manual)
				case <-ctx.Done():
					if manual {
						<-s.manualSlots
					}
					return
				}
			}
		}
	}
}

func cgroupMemoryPressure(stopPercent int) bool {
	if stopPercent <= 0 {
		return false
	}
	current, currentErr := readCgroupUint("/sys/fs/cgroup/memory.current")
	maximum, maximumErr := readCgroupUint("/sys/fs/cgroup/memory.max")
	if currentErr != nil || maximumErr != nil || maximum == 0 {
		current, currentErr = readCgroupUint("/sys/fs/cgroup/memory/memory.usage_in_bytes")
		maximum, maximumErr = readCgroupUint("/sys/fs/cgroup/memory/memory.limit_in_bytes")
	}
	if currentErr != nil || maximumErr != nil || maximum == 0 {
		return false
	}
	return current*100 >= maximum*uint64(stopPercent)
}

func readCgroupUint(path string) (uint64, error) {
	contents, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	raw := strings.TrimSpace(string(contents))
	if raw == "max" {
		return 0, errors.New("unbounded cgroup memory")
	}
	return strconv.ParseUint(raw, 10, 64)
}

func (s *Service) process(parent context.Context, stream, messageID, jobID string, manual bool) {
	defer func() {
		<-s.globalSlots
		if manual {
			<-s.manualSlots
		}
	}()
	runID, request, outcome, err := s.claim(parent, jobID)
	if err != nil {
		s.logger.Error("claim execution job", "jobId", jobID, "error", err)
		return
	}
	if outcome != claimReady {
		_ = queueutil.AcknowledgeAndDelete(parent, s.redis, stream, consumerGroup, messageID)
		return
	}
	runCtx, cancel := context.WithCancel(parent)
	defer cancel()
	cancelDone := make(chan struct{})
	go s.watchCancellation(runCtx, cancelDone, jobID, cancel)
	_, runErr := s.runner.ExecuteQueued(runCtx, runID, request)
	close(cancelDone)
	cancelled := errors.Is(runCtx.Err(), context.Canceled)
	if completeErr := s.complete(context.WithoutCancel(parent), jobID, runID, runErr, cancelled); completeErr != nil {
		s.logger.Error("complete execution job", "jobId", jobID, "runId", runID, "error", completeErr)
		return
	}
	if err := queueutil.AcknowledgeAndDelete(context.WithoutCancel(parent), s.redis, stream, consumerGroup, messageID); err != nil {
		s.logger.Error("acknowledge execution job", "jobId", jobID, "error", err)
	}
}

func (s *Service) claim(ctx context.Context, jobID string) (string, runs.QueueRequest, claimOutcome, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", runs.QueueRequest{}, claimUnavailable, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var runID, status string
	var payload []byte
	var available bool
	err = tx.QueryRow(ctx, `
		SELECT run_id::text,status,payload_json,available_at<=NOW()
		FROM execution_jobs
		WHERE id=$1
		FOR UPDATE`, jobID).Scan(&runID, &status, &payload, &available)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", runs.QueueRequest{}, claimUnavailable, nil
	}
	if err != nil {
		return "", runs.QueueRequest{}, claimUnavailable, err
	}
	var request runs.QueueRequest
	if err := json.Unmarshal(payload, &request); err != nil {
		return "", runs.QueueRequest{}, claimUnavailable, fmt.Errorf("decode execution payload: %w", err)
	}
	if status != "QUEUED" || !available {
		return runID, request, claimUnavailable, tx.Commit(ctx)
	}
	policy := request.ConcurrencyPolicy
	if policy == "" {
		policy = "ALLOW"
	}
	if policy != "ALLOW" {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, request.MonitorID); err != nil {
			return "", runs.QueueRequest{}, claimUnavailable, err
		}
		var active bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM execution_jobs
				WHERE id<>$1
				  AND status='LEASED'
				  AND payload_json->>'monitorId'=$2
			)`, jobID, request.MonitorID).Scan(&active); err != nil {
			return "", runs.QueueRequest{}, claimUnavailable, err
		}
		if active {
			if policy == "SKIP_IF_RUNNING" {
				if err := s.skipOverlapping(ctx, tx, jobID, runID); err != nil {
					return "", runs.QueueRequest{}, claimUnavailable, err
				}
			} else {
				if err := s.deferOverlapping(ctx, tx, jobID); err != nil {
					return "", runs.QueueRequest{}, claimUnavailable, err
				}
			}
			return runID, request, claimHandled, tx.Commit(ctx)
		}
	}
	command, err := tx.Exec(ctx, `
		UPDATE execution_jobs
		SET status='LEASED',lease_owner=$2,lease_expires_at=NOW()+INTERVAL '90 seconds',
			attempt_count=attempt_count+1,started_at=COALESCE(started_at,NOW()),updated_at=NOW()
		WHERE id=$1 AND status='QUEUED' AND cancel_requested_at IS NULL`, jobID, s.workerID)
	if err != nil {
		return "", runs.QueueRequest{}, claimUnavailable, err
	}
	if command.RowsAffected() == 0 {
		return runID, request, claimUnavailable, tx.Commit(ctx)
	}
	return runID, request, claimReady, tx.Commit(ctx)
}

func (s *Service) skipOverlapping(ctx context.Context, tx pgx.Tx, jobID, runID string) error {
	if _, err := tx.Exec(ctx, `
		UPDATE execution_jobs
		SET status='SUCCEEDED',completed_at=NOW(),last_error=NULL,updated_at=NOW()
		WHERE id=$1`, jobID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE monitor_runs
		SET status='SKIPPED',ended_at=NOW(),
			duration_ms=GREATEST(0,EXTRACT(EPOCH FROM (NOW()-created_at))*1000)::bigint,
			failure_category='CONCURRENCY_POLICY',
			failure_reason='Skipped because an earlier execution of this monitor is still active.'
		WHERE id=$1 AND status IN ('QUEUED','STARTING')`, runID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO run_events(
			id,monitor_run_id,sequence,event_type,status,category,message,details_json,occurred_at,duration_ms
		)
		SELECT gen_random_uuid(),$1,COALESCE(MAX(sequence),0)+1,'RUN_SKIPPED','SKIPPED',
			'CONCURRENCY_POLICY','Skipped because an earlier execution is still active.',
			'{"policy":"SKIP_IF_RUNNING"}'::jsonb,NOW(),0
		FROM run_events WHERE monitor_run_id=$1`, runID)
	return err
}

func (s *Service) deferOverlapping(ctx context.Context, tx pgx.Tx, jobID string) error {
	if _, err := tx.Exec(ctx, `
		UPDATE execution_jobs
		SET available_at=NOW()+INTERVAL '1 second',updated_at=NOW()
		WHERE id=$1`, jobID); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO execution_job_outbox(id,job_id,stream_name,payload_json,available_at)
		VALUES(gen_random_uuid(),$1,$2,jsonb_build_object('jobId',$1::text),NOW()+INTERVAL '1 second')
		ON CONFLICT(job_id) DO UPDATE SET
			stream_name=EXCLUDED.stream_name,payload_json=EXCLUDED.payload_json,
			available_at=EXCLUDED.available_at,published_at=NULL,last_error=NULL`,
		jobID, scheduledStream)
	return err
}

func (s *Service) watchCancellation(ctx context.Context, done <-chan struct{}, jobID string, cancel context.CancelFunc) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-done:
			return
		case <-ticker.C:
			var requested bool
			err := s.pool.QueryRow(ctx, `
				UPDATE execution_jobs
				SET lease_expires_at=NOW()+INTERVAL '90 seconds',updated_at=NOW()
				WHERE id=$1 AND status='LEASED' AND lease_owner=$2
				RETURNING cancel_requested_at IS NOT NULL`, jobID, s.workerID).Scan(&requested)
			if errors.Is(err, pgx.ErrNoRows) {
				cancel()
				return
			}
			if err != nil {
				s.logger.Warn("refresh execution lease", "jobId", jobID, "error", err)
				continue
			}
			if requested {
				cancel()
				return
			}
		}
	}
}

func (s *Service) complete(ctx context.Context, jobID, runID string, runErr error, cancelled bool) error {
	status := "SUCCEEDED"
	if cancelled {
		status = "CANCELLED"
	} else if runErr != nil {
		status = "FAILED"
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := tx.Exec(ctx, `
		UPDATE execution_jobs
		SET status=$2,completed_at=NOW(),lease_owner=NULL,lease_expires_at=NULL,
			last_error=NULLIF($3,''),updated_at=NOW()
		WHERE id=$1 AND lease_owner=$4`,
		jobID, status, safeError(runErr), s.workerID,
	); err != nil {
		return err
	}
	if runErr != nil {
		if _, err := tx.Exec(ctx, `
			UPDATE monitor_runs
			SET status='ABORTED',failure_category='WORKER_LOST',
				failure_reason='Execution stopped before a terminal result could be recorded.',
				ended_at=NOW(),duration_ms=GREATEST(0,EXTRACT(EPOCH FROM (NOW()-created_at))*1000)::bigint
			WHERE id=$1 AND status NOT IN ('SUCCESS','SUCCESS_WITH_WARNINGS','FAILED','TIMED_OUT','CANCELLED','ABORTED')`,
			runID,
		); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Service) reclaimExpired(ctx context.Context) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.reclaimExpiredBatch(ctx); err != nil {
				s.logger.Error("reclaim expired execution leases", "error", err)
			}
		}
	}
}

func (s *Service) reclaimExpiredBatch(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	rows, err := tx.Query(ctx, `
		SELECT id::text,run_id::text,queue_class,
			COALESCE((payload_json->>'recoverySafe')::boolean,FALSE)
		FROM execution_jobs
		WHERE job_type='API_MONITOR_RUN'
		  AND status='LEASED' AND lease_expires_at<NOW()
		ORDER BY lease_expires_at
		FOR UPDATE SKIP LOCKED
		LIMIT 100`)
	if err != nil {
		return err
	}
	type expired struct {
		jobID, runID, queueClass string
		recoverySafe             bool
	}
	items := make([]expired, 0, 100)
	for rows.Next() {
		var item expired
		if err := rows.Scan(&item.jobID, &item.runID, &item.queueClass, &item.recoverySafe); err != nil {
			rows.Close()
			return err
		}
		items = append(items, item)
	}
	rows.Close()
	for _, item := range items {
		if !item.recoverySafe {
			if _, err := tx.Exec(ctx, `
				UPDATE execution_jobs
				SET status='FAILED',completed_at=NOW(),lease_owner=NULL,lease_expires_at=NULL,
					last_error='Worker lease expired; non-idempotent work was not replayed.',updated_at=NOW()
				WHERE id=$1`, item.jobID); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				UPDATE monitor_runs
				SET status='ABORTED',failure_category='WORKER_LOST',
					failure_reason='The worker lease expired. Rhythm did not replay the request because recovery was not explicitly safe.',
					ended_at=NOW(),duration_ms=GREATEST(0,EXTRACT(EPOCH FROM (NOW()-created_at))*1000)::bigint
				WHERE id=$1 AND status NOT IN ('SUCCESS','SUCCESS_WITH_WARNINGS','FAILED','TIMED_OUT','CANCELLED','ABORTED')`,
				item.runID); err != nil {
				return err
			}
			continue
		}
		stream := manualStream
		if item.queueClass == "scheduled" {
			stream = scheduledStream
		}
		if _, err := tx.Exec(ctx, `
			UPDATE execution_jobs
			SET status='QUEUED',lease_owner=NULL,lease_expires_at=NULL,available_at=NOW(),updated_at=NOW()
			WHERE id=$1`, item.jobID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO execution_job_outbox (id,job_id,stream_name,payload_json)
			VALUES ($1::uuid,$1,$2,jsonb_build_object('jobId',$1::text))
			ON CONFLICT (job_id) DO UPDATE SET
				stream_name=EXCLUDED.stream_name,available_at=NOW(),published_at=NULL,last_error=NULL`,
			item.jobID, stream); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Service) cleanupStalePending(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, target := range []struct {
				stream string
				group  string
			}{
				{scheduledStream, consumerGroup},
				{manualStream, consumerGroup},
				{"rhythm:execution:browser", "rhythm-browser-dispatchers"},
				{"rhythm:execution:deployment", "rhythm-deployment-workers"},
				{"rhythm:execution:suite", "rhythm-suite-workers"},
			} {
				if err := s.cleanupStalePendingBatch(ctx, target.stream, target.group); err != nil &&
					!strings.Contains(err.Error(), "NOGROUP") {
					s.logger.Warn("clean stale stream deliveries", "stream", target.stream, "error", err)
				}
			}
		}
	}
}

func (s *Service) cleanupStalePendingBatch(ctx context.Context, stream, group string) error {
	pending, err := s.redis.XPendingExt(ctx, &redis.XPendingExtArgs{
		Stream: stream,
		Group:  group,
		Start:  "-",
		End:    "+",
		Count:  100,
		Idle:   2 * time.Minute,
	}).Result()
	if err != nil {
		return err
	}
	for _, delivery := range pending {
		messages, rangeErr := s.redis.XRangeN(ctx, stream, delivery.ID, delivery.ID, 1).Result()
		if rangeErr != nil {
			return rangeErr
		}
		if len(messages) == 0 {
			if err := queueutil.AcknowledgeAndDelete(ctx, s.redis, stream, group, delivery.ID); err != nil {
				return err
			}
			continue
		}
		jobID, _ := messages[0].Values["jobId"].(string)
		if jobID == "" {
			if err := queueutil.AcknowledgeAndDelete(ctx, s.redis, stream, group, delivery.ID); err != nil {
				return err
			}
			continue
		}
		var status string
		var leaseExpiresAt *time.Time
		queryErr := s.pool.QueryRow(ctx, `
			SELECT status,lease_expires_at
			FROM execution_jobs
			WHERE id=$1`, jobID).Scan(&status, &leaseExpiresAt)
		if queryErr != nil && !errors.Is(queryErr, pgx.ErrNoRows) {
			return queryErr
		}
		leaseActive := queryErr == nil && status == "LEASED" &&
			leaseExpiresAt != nil && leaseExpiresAt.After(time.Now())
		if leaseActive {
			continue
		}
		if err := queueutil.AcknowledgeAndDelete(ctx, s.redis, stream, group, delivery.ID); err != nil {
			return err
		}
	}
	return nil
}

func isBusyGroup(err error) bool {
	return err != nil && len(err.Error()) >= 9 && err.Error()[:9] == "BUSYGROUP"
}

func queueSuffix(stream string) string {
	if stream == scheduledStream {
		return "scheduled"
	}
	return "manual"
}

func safeError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > 500 {
		return message[:500]
	}
	return message
}
