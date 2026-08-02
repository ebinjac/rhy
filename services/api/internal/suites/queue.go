package suites

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/rhythm-monitoring/rhythm/internal/id"
	queueutil "github.com/rhythm-monitoring/rhythm/internal/queue"
)

const (
	deploymentExecutionStream = "rhythm:execution:deployment"
	deploymentConsumerGroup   = "rhythm-deployment-workers"
	suiteExecutionStream      = "rhythm:execution:suite"
	suiteConsumerGroup        = "rhythm-suite-workers"
)

func (s *Service) ConfigureQueue(redisClient redis.UniversalClient, logger *slog.Logger, concurrency int) {
	if redisClient == nil {
		return
	}
	if _, ok := s.repository.(*PostgresRepository); !ok {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	if concurrency < 1 {
		concurrency = 4
	}
	hostname, _ := os.Hostname()
	s.queueRedis = redisClient
	s.queueLog = logger
	s.workerID = fmt.Sprintf("%s-%d", hostname, os.Getpid())
	s.queueSlots = make(chan struct{}, concurrency)
}

func (s *Service) StartQueueWorkers(ctx context.Context) {
	if s.queueRedis == nil {
		return
	}
	s.queueOnce.Do(func() {
		if err := s.queueRedis.XGroupCreateMkStream(ctx, deploymentExecutionStream, deploymentConsumerGroup, "0").Err(); err != nil &&
			!strings.Contains(err.Error(), "BUSYGROUP") {
			s.queueLog.Error("create deployment consumer group", "error", err)
		}
		if err := s.queueRedis.XGroupCreateMkStream(ctx, suiteExecutionStream, suiteConsumerGroup, "0").Err(); err != nil &&
			!strings.Contains(err.Error(), "BUSYGROUP") {
			s.queueLog.Error("create suite consumer group", "error", err)
		}
		go s.consumeDeploymentJobs(ctx)
		go s.consumeSuiteJobs(ctx)
		go s.reapExpiredDeploymentJobs(ctx)
		go s.reapExpiredSuiteJobs(ctx)
	})
}

func (r *PostgresRepository) CreateQueuedDeploymentRun(ctx context.Context, run DeploymentRun) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	progress, _ := json.Marshal(run.Progress)
	deployment, _ := json.Marshal(run.Deployment)
	configuration, _ := json.Marshal(run.Configuration)
	snapshot, _ := json.Marshal(run.SuiteSnapshot)
	report, _ := json.Marshal(run.Report)
	if _, err = tx.Exec(ctx, `
		INSERT INTO deployment_validation_runs(
			id,suite_id,status,phase,gate_decision,progress_json,deployment_json,
			configuration_json,suite_snapshot_json,report_json,failure_reason,
			created_by,started_at,created_at,updated_at
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
		run.ID, run.SuiteID, run.Status, run.Phase, run.GateDecision, progress,
		deployment, configuration, snapshot, report, run.FailureReason,
		run.CreatedBy, run.StartedAt, run.CreatedAt, run.UpdatedAt); err != nil {
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
	payload, _ := json.Marshal(map[string]any{"deploymentRunId": run.ID, "recoverySafe": false})
	if _, err = tx.Exec(ctx, `
		INSERT INTO execution_jobs(
			id,deployment_run_id,job_type,queue_class,priority,status,payload_json,
			available_at,created_at,updated_at
		) VALUES($1,$2,'DEPLOYMENT_VALIDATION','deployment',100,'QUEUED',$3,$4,$4,$4)`,
		jobID, run.ID, payload, run.CreatedAt); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO execution_job_outbox(id,job_id,stream_name,payload_json)
		VALUES($1::uuid,$2::uuid,$3,jsonb_build_object('jobId',$2::text))`,
		outboxID, jobID, deploymentExecutionStream); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type queuedSuitePayload struct {
	Actor string   `json:"actor"`
	Input RunInput `json:"input"`
}

func (s *Service) QueueRunWithInput(ctx context.Context, suiteID, actor string, input RunInput) (SuiteRun, error) {
	if s.queueRedis == nil {
		return s.RunWithInput(ctx, suiteID, actor, input)
	}
	suite, err := s.repository.Get(ctx, suiteID)
	if err != nil {
		return SuiteRun{}, err
	}
	if input.TriggerType == "" {
		input.TriggerType = "MANUAL"
	}
	runID, err := id.NewUUID()
	if err != nil {
		return SuiteRun{}, err
	}
	now := s.now()
	run := SuiteRun{
		ID: runID, SuiteID: suite.ID, Status: "QUEUED", GateDecision: "PENDING",
		TriggerType: input.TriggerType, TriggerSource: actor, Results: []CheckResult{},
		StartedAt: now, CreatedAt: now,
	}
	repository := s.repository.(*PostgresRepository)
	if err := repository.CreateQueuedSuiteRun(ctx, run, queuedSuitePayload{Actor: actor, Input: input}); err != nil {
		return SuiteRun{}, err
	}
	return run, nil
}

func (r *PostgresRepository) CreateQueuedSuiteRun(ctx context.Context, run SuiteRun, payload queuedSuitePayload) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	results, _ := json.Marshal(run.Results)
	if _, err = tx.Exec(ctx, `
		INSERT INTO validation_suite_runs(
			id,suite_id,status,gate_decision,trigger_type,trigger_source,
			results_json,started_at,duration_ms,created_at
		) VALUES($1,$2,$3,$4,$5,NULLIF($6,''),$7,$8,0,$9)`,
		run.ID, run.SuiteID, run.Status, run.GateDecision, run.TriggerType,
		run.TriggerSource, results, run.StartedAt, run.CreatedAt); err != nil {
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
	encodedPayload, _ := json.Marshal(payload)
	if _, err = tx.Exec(ctx, `
		INSERT INTO execution_jobs(
			id,suite_run_id,job_type,queue_class,priority,status,payload_json,
			available_at,created_at,updated_at
		) VALUES($1,$2,'VALIDATION_SUITE','suite',90,'QUEUED',$3,$4,$4,$4)`,
		jobID, run.ID, encodedPayload, run.CreatedAt); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
		INSERT INTO execution_job_outbox(id,job_id,stream_name,payload_json)
		VALUES($1::uuid,$2::uuid,$3,jsonb_build_object('jobId',$2::text))`,
		outboxID, jobID, suiteExecutionStream); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) consumeDeploymentJobs(ctx context.Context) {
	consumer := s.workerID + "-deployment"
	for ctx.Err() == nil {
		streams, err := s.queueRedis.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group: deploymentConsumerGroup, Consumer: consumer,
			Streams: []string{deploymentExecutionStream, ">"},
			Count:   8, Block: 2 * time.Second,
		}).Result()
		if errors.Is(err, redis.Nil) || errors.Is(err, context.Canceled) {
			continue
		}
		if err != nil {
			s.queueLog.Error("read deployment stream", "error", err)
			continue
		}
		for _, stream := range streams {
			for _, message := range stream.Messages {
				jobID, _ := message.Values["jobId"].(string)
				if jobID == "" {
					_ = queueutil.AcknowledgeAndDelete(ctx, s.queueRedis, deploymentExecutionStream, deploymentConsumerGroup, message.ID)
					continue
				}
				select {
				case s.queueSlots <- struct{}{}:
					go s.processDeploymentJob(ctx, message.ID, jobID)
				case <-ctx.Done():
					return
				}
			}
		}
	}
}

func (s *Service) consumeSuiteJobs(ctx context.Context) {
	consumer := s.workerID + "-suite"
	for ctx.Err() == nil {
		streams, err := s.queueRedis.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group: suiteConsumerGroup, Consumer: consumer,
			Streams: []string{suiteExecutionStream, ">"},
			Count:   8, Block: 2 * time.Second,
		}).Result()
		if errors.Is(err, redis.Nil) || errors.Is(err, context.Canceled) {
			continue
		}
		if err != nil {
			s.queueLog.Error("read suite stream", "error", err)
			continue
		}
		for _, stream := range streams {
			for _, message := range stream.Messages {
				jobID, _ := message.Values["jobId"].(string)
				if jobID == "" {
					_ = queueutil.AcknowledgeAndDelete(ctx, s.queueRedis, suiteExecutionStream, suiteConsumerGroup, message.ID)
					continue
				}
				select {
				case s.queueSlots <- struct{}{}:
					go s.processSuiteJob(ctx, message.ID, jobID)
				case <-ctx.Done():
					return
				}
			}
		}
	}
}

func (s *Service) processSuiteJob(parent context.Context, messageID, jobID string) {
	defer func() { <-s.queueSlots }()
	runID, payload, claimed, err := s.claimSuiteJob(parent, jobID)
	if err != nil {
		s.queueLog.Error("claim suite job", "jobId", jobID, "error", err)
		return
	}
	if !claimed {
		_ = queueutil.AcknowledgeAndDelete(parent, s.queueRedis, suiteExecutionStream, suiteConsumerGroup, messageID)
		return
	}
	run, err := s.GetRun(parent, runID)
	if err != nil {
		s.failSuiteRun(context.WithoutCancel(parent), runID, "Validation suite evidence could not be loaded.")
		_ = s.completeSuiteJob(context.WithoutCancel(parent), jobID, err, false)
		_ = queueutil.AcknowledgeAndDelete(context.WithoutCancel(parent), s.queueRedis, suiteExecutionStream, suiteConsumerGroup, messageID)
		return
	}
	suite, err := s.Get(parent, run.SuiteID)
	if err != nil {
		s.failSuiteRun(context.WithoutCancel(parent), runID, "The validation suite definition is no longer available.")
		_ = s.completeSuiteJob(context.WithoutCancel(parent), jobID, err, false)
		_ = queueutil.AcknowledgeAndDelete(context.WithoutCancel(parent), s.queueRedis, suiteExecutionStream, suiteConsumerGroup, messageID)
		return
	}
	if payload.Actor == "" {
		payload.Actor = run.TriggerSource
	}
	runCtx, cancel := context.WithCancel(parent)
	defer cancel()
	done := make(chan struct{})
	cancelRequested := make(chan struct{}, 1)
	go s.watchSuiteJob(runCtx, done, jobID, cancel, cancelRequested)
	_, runErr := s.executeSuiteRun(runCtx, suite, payload.Actor, payload.Input, run)
	close(done)
	if parent.Err() != nil {
		return
	}
	cancelled := len(cancelRequested) > 0
	if runErr != nil {
		s.failSuiteRun(context.WithoutCancel(parent), runID, "Validation suite results could not be persisted.")
	}
	if err := s.completeSuiteJob(context.WithoutCancel(parent), jobID, runErr, cancelled); err != nil {
		s.queueLog.Error("complete suite job", "jobId", jobID, "runId", runID, "error", err)
		return
	}
	if err := queueutil.AcknowledgeAndDelete(context.WithoutCancel(parent), s.queueRedis, suiteExecutionStream, suiteConsumerGroup, messageID); err != nil {
		s.queueLog.Error("acknowledge suite job", "jobId", jobID, "error", err)
	}
}

func (s *Service) processDeploymentJob(parent context.Context, messageID, jobID string) {
	defer func() { <-s.queueSlots }()
	runID, claimed, err := s.claimDeploymentJob(parent, jobID)
	if err != nil {
		s.queueLog.Error("claim deployment job", "jobId", jobID, "error", err)
		return
	}
	if !claimed {
		_ = queueutil.AcknowledgeAndDelete(parent, s.queueRedis, deploymentExecutionStream, deploymentConsumerGroup, messageID)
		return
	}
	run, err := s.GetDeploymentRun(parent, runID)
	if err != nil {
		completionContext := context.WithoutCancel(parent)
		if completeErr := s.completeDeploymentJob(completionContext, jobID, err, false); completeErr != nil {
			s.queueLog.Error("complete unloadable deployment job", "jobId", jobID, "runId", runID, "error", completeErr)
			return
		}
		if ackErr := queueutil.AcknowledgeAndDelete(completionContext, s.queueRedis, deploymentExecutionStream, deploymentConsumerGroup, messageID); ackErr != nil {
			s.queueLog.Error("acknowledge unloadable deployment job", "jobId", jobID, "error", ackErr)
		}
		return
	}
	runCtx, cancel := context.WithCancel(parent)
	defer cancel()
	done := make(chan struct{})
	cancelRequested := make(chan struct{}, 1)
	go s.watchDeploymentJob(runCtx, done, jobID, cancel, cancelRequested)
	s.processDeployment(runCtx, run)
	close(done)
	if parent.Err() != nil {
		return
	}
	cancelled := len(cancelRequested) > 0
	if err := s.completeDeploymentJob(context.WithoutCancel(parent), jobID, nil, cancelled); err != nil {
		s.queueLog.Error("complete deployment job", "jobId", jobID, "runId", runID, "error", err)
		return
	}
	if err := queueutil.AcknowledgeAndDelete(context.WithoutCancel(parent), s.queueRedis, deploymentExecutionStream, deploymentConsumerGroup, messageID); err != nil {
		s.queueLog.Error("acknowledge deployment job", "jobId", jobID, "error", err)
	}
}

func (s *Service) claimSuiteJob(ctx context.Context, jobID string) (string, queuedSuitePayload, bool, error) {
	repository := s.repository.(*PostgresRepository)
	tx, err := repository.pool.Begin(ctx)
	if err != nil {
		return "", queuedSuitePayload{}, false, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var runID, status string
	var encoded []byte
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(suite_run_id::text,''),status,payload_json
		FROM execution_jobs
		WHERE id=$1 AND job_type='VALIDATION_SUITE'
		FOR UPDATE`, jobID).Scan(&runID, &status, &encoded)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", queuedSuitePayload{}, false, nil
	}
	if err != nil {
		return "", queuedSuitePayload{}, false, err
	}
	var payload queuedSuitePayload
	if err := json.Unmarshal(encoded, &payload); err != nil {
		return "", queuedSuitePayload{}, false, err
	}
	if status != "QUEUED" {
		return runID, payload, false, tx.Commit(ctx)
	}
	command, err := tx.Exec(ctx, `
		UPDATE execution_jobs
		SET status='LEASED',lease_owner=$2,lease_expires_at=NOW()+INTERVAL '90 seconds',
			attempt_count=attempt_count+1,started_at=COALESCE(started_at,NOW()),updated_at=NOW()
		WHERE id=$1 AND status='QUEUED' AND cancel_requested_at IS NULL`, jobID, s.workerID)
	if err != nil {
		return "", queuedSuitePayload{}, false, err
	}
	if command.RowsAffected() == 1 {
		if _, err = tx.Exec(ctx, `
			UPDATE validation_suite_runs
			SET status='RUNNING',started_at=NOW()
			WHERE id=$1 AND status='QUEUED'`, runID); err != nil {
			return "", queuedSuitePayload{}, false, err
		}
	}
	return runID, payload, command.RowsAffected() == 1, tx.Commit(ctx)
}

func (s *Service) watchSuiteJob(
	ctx context.Context,
	done <-chan struct{},
	jobID string,
	cancel context.CancelFunc,
	cancelRequested chan<- struct{},
) {
	repository := s.repository.(*PostgresRepository)
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
			err := repository.pool.QueryRow(ctx, `
				UPDATE execution_jobs
				SET lease_expires_at=NOW()+INTERVAL '90 seconds',updated_at=NOW()
				WHERE id=$1 AND status='LEASED' AND lease_owner=$2
				RETURNING cancel_requested_at IS NOT NULL`, jobID, s.workerID).Scan(&requested)
			if errors.Is(err, pgx.ErrNoRows) {
				cancel()
				return
			}
			if err != nil {
				s.queueLog.Warn("refresh suite lease", "jobId", jobID, "error", err)
				continue
			}
			if requested {
				select {
				case cancelRequested <- struct{}{}:
				default:
				}
				cancel()
				return
			}
		}
	}
}

func (s *Service) completeSuiteJob(ctx context.Context, jobID string, runErr error, cancelled bool) error {
	repository := s.repository.(*PostgresRepository)
	status := "SUCCEEDED"
	if cancelled {
		status = "CANCELLED"
	} else if runErr != nil {
		status = "FAILED"
	}
	_, err := repository.pool.Exec(ctx, `
		UPDATE execution_jobs
		SET status=$2,completed_at=NOW(),lease_owner=NULL,lease_expires_at=NULL,
			last_error=NULLIF($3,''),updated_at=NOW()
		WHERE id=$1 AND lease_owner=$4`,
		jobID, status, safeError(runErr), s.workerID)
	return err
}

func (s *Service) failSuiteRun(ctx context.Context, runID, reason string) {
	repository := s.repository.(*PostgresRepository)
	_, _ = repository.pool.Exec(ctx, `
		UPDATE validation_suite_runs
		SET status='FAILED',gate_decision='BLOCK',ended_at=NOW(),
			duration_ms=GREATEST(0,EXTRACT(EPOCH FROM (NOW()-started_at))*1000)::bigint,
			results_json=jsonb_build_array(jsonb_build_object(
				'kind','SYSTEM','status','FAILED','required',true,
				'failureCategory','SUITE_WORKER_LOST','failureReason',$2
			))
		WHERE id=$1 AND status IN ('QUEUED','RUNNING','CANCELLING')`, runID, reason)
}

func (s *Service) claimDeploymentJob(ctx context.Context, jobID string) (string, bool, error) {
	repository := s.repository.(*PostgresRepository)
	tx, err := repository.pool.Begin(ctx)
	if err != nil {
		return "", false, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	var runID, status string
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(deployment_run_id::text,''),status
		FROM execution_jobs
		WHERE id=$1 AND job_type='DEPLOYMENT_VALIDATION'
		FOR UPDATE`, jobID).Scan(&runID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	if status != "QUEUED" {
		return runID, false, tx.Commit(ctx)
	}
	command, err := tx.Exec(ctx, `
		UPDATE execution_jobs
		SET status='LEASED',lease_owner=$2,lease_expires_at=NOW()+INTERVAL '90 seconds',
			attempt_count=attempt_count+1,started_at=COALESCE(started_at,NOW()),updated_at=NOW()
		WHERE id=$1 AND status='QUEUED' AND cancel_requested_at IS NULL`, jobID, s.workerID)
	if err != nil {
		return "", false, err
	}
	return runID, command.RowsAffected() == 1, tx.Commit(ctx)
}

func (s *Service) watchDeploymentJob(
	ctx context.Context,
	done <-chan struct{},
	jobID string,
	cancel context.CancelFunc,
	cancelRequested chan<- struct{},
) {
	repository := s.repository.(*PostgresRepository)
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
			err := repository.pool.QueryRow(ctx, `
				UPDATE execution_jobs
				SET lease_expires_at=NOW()+INTERVAL '90 seconds',updated_at=NOW()
				WHERE id=$1 AND status='LEASED' AND lease_owner=$2
				RETURNING cancel_requested_at IS NOT NULL`, jobID, s.workerID).Scan(&requested)
			if errors.Is(err, pgx.ErrNoRows) {
				cancel()
				return
			}
			if err != nil {
				s.queueLog.Warn("refresh deployment lease", "jobId", jobID, "error", err)
				continue
			}
			if requested {
				select {
				case cancelRequested <- struct{}{}:
				default:
				}
				cancel()
				return
			}
		}
	}
}

func (s *Service) completeDeploymentJob(ctx context.Context, jobID string, runErr error, cancelled bool) error {
	repository := s.repository.(*PostgresRepository)
	status := "SUCCEEDED"
	if cancelled {
		status = "CANCELLED"
	} else if runErr != nil {
		status = "FAILED"
	}
	_, err := repository.pool.Exec(ctx, `
		UPDATE execution_jobs
		SET status=$2,completed_at=NOW(),lease_owner=NULL,lease_expires_at=NULL,
			last_error=NULLIF($3,''),updated_at=NOW()
		WHERE id=$1 AND lease_owner=$4`,
		jobID, status, safeError(runErr), s.workerID)
	return err
}

func (s *Service) cancelQueuedDeployment(ctx context.Context, runID string) (DeploymentRun, error) {
	repository := s.repository.(*PostgresRepository)
	tx, err := repository.pool.Begin(ctx)
	if err != nil {
		return DeploymentRun{}, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	command, err := tx.Exec(ctx, `
		UPDATE deployment_validation_runs
		SET cancel_requested_at=NOW(),status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE 'CANCELLING' END,
			phase=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE 'CANCELLING' END,updated_at=NOW(),
			gate_decision=CASE WHEN status='QUEUED' THEN 'BLOCK' ELSE gate_decision END,
			failure_reason=CASE WHEN status='QUEUED' THEN 'Validation was cancelled before execution.' ELSE failure_reason END,
			ended_at=CASE WHEN status='QUEUED' THEN NOW() ELSE ended_at END
		WHERE id=$1 AND status NOT IN ('COMPLETED','CANCELLED','FAILED')`, runID)
	if err != nil {
		return DeploymentRun{}, err
	}
	if command.RowsAffected() == 0 {
		return DeploymentRun{}, errors.New("deployment validation is already complete")
	}
	if _, err = tx.Exec(ctx, `
		UPDATE execution_jobs
		SET cancel_requested_at=NOW(),
			status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END,
			completed_at=CASE WHEN status='QUEUED' THEN NOW() ELSE completed_at END,
			updated_at=NOW()
		WHERE deployment_run_id=$1 AND status IN ('QUEUED','LEASED')`, runID); err != nil {
		return DeploymentRun{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return DeploymentRun{}, err
	}
	return s.GetDeploymentRun(ctx, runID)
}

func (s *Service) RequestCancel(ctx context.Context, runID string) (SuiteRun, error) {
	if s.queueRedis == nil {
		if !s.Cancel(runID) {
			return SuiteRun{}, errors.New("validation suite run is not active")
		}
		return SuiteRun{ID: runID, Status: "CANCELLING", GateDecision: "PENDING"}, nil
	}
	repository := s.repository.(*PostgresRepository)
	tx, err := repository.pool.Begin(ctx)
	if err != nil {
		return SuiteRun{}, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	command, err := tx.Exec(ctx, `
		UPDATE validation_suite_runs
		SET cancel_requested_at=NOW(),
			status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE 'CANCELLING' END,
			gate_decision=CASE WHEN status='QUEUED' THEN 'BLOCK' ELSE gate_decision END,
			ended_at=CASE WHEN status='QUEUED' THEN NOW() ELSE ended_at END,
			duration_ms=CASE WHEN status='QUEUED' THEN 0 ELSE duration_ms END
		WHERE id=$1 AND status IN ('QUEUED','RUNNING')`, runID)
	if err != nil {
		return SuiteRun{}, err
	}
	if command.RowsAffected() == 0 {
		return SuiteRun{}, errors.New("validation suite run is already complete")
	}
	if _, err = tx.Exec(ctx, `
		UPDATE execution_jobs
		SET cancel_requested_at=NOW(),
			status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END,
			completed_at=CASE WHEN status='QUEUED' THEN NOW() ELSE completed_at END,
			updated_at=NOW()
		WHERE suite_run_id=$1 AND status IN ('QUEUED','LEASED')`, runID); err != nil {
		return SuiteRun{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return SuiteRun{}, err
	}
	return s.GetRun(ctx, runID)
}

func (s *Service) reapExpiredSuiteJobs(ctx context.Context) {
	repository := s.repository.(*PostgresRepository)
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tx, err := repository.pool.Begin(ctx)
			if err != nil {
				continue
			}
			rows, err := tx.Query(ctx, `
				SELECT id::text,COALESCE(suite_run_id::text,'')
				FROM execution_jobs
				WHERE job_type='VALIDATION_SUITE' AND status='LEASED' AND lease_expires_at<NOW()
				ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED LIMIT 20`)
			if err != nil {
				_ = tx.Rollback(ctx)
				continue
			}
			type expiredJob struct{ jobID, runID string }
			expired := make([]expiredJob, 0, 20)
			for rows.Next() {
				var item expiredJob
				if rows.Scan(&item.jobID, &item.runID) == nil {
					expired = append(expired, item)
				}
			}
			rows.Close()
			for _, item := range expired {
				_, _ = tx.Exec(ctx, `
					UPDATE execution_jobs
					SET status='FAILED',completed_at=NOW(),lease_owner=NULL,lease_expires_at=NULL,
						last_error='Suite worker lease expired; validation was not replayed.',updated_at=NOW()
					WHERE id=$1`, item.jobID)
				_, _ = tx.Exec(ctx, `
					UPDATE validation_suite_runs
					SET status='FAILED',gate_decision='BLOCK',ended_at=NOW(),
						duration_ms=GREATEST(0,EXTRACT(EPOCH FROM (NOW()-started_at))*1000)::bigint,
						results_json=jsonb_build_array(jsonb_build_object(
							'kind','SYSTEM','status','FAILED','required',true,
							'failureCategory','SUITE_WORKER_LOST',
							'failureReason','The suite worker lease expired. Partial evidence was preserved and the workflow was not replayed.'
						))
					WHERE id=$1 AND status IN ('QUEUED','RUNNING','CANCELLING')`, item.runID)
			}
			_ = tx.Commit(ctx)
		}
	}
}

func (s *Service) reapExpiredDeploymentJobs(ctx context.Context) {
	repository := s.repository.(*PostgresRepository)
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tx, err := repository.pool.Begin(ctx)
			if err != nil {
				continue
			}
			rows, err := tx.Query(ctx, `
				SELECT id::text,COALESCE(deployment_run_id::text,'')
				FROM execution_jobs
				WHERE job_type='DEPLOYMENT_VALIDATION' AND status='LEASED' AND lease_expires_at<NOW()
				ORDER BY lease_expires_at FOR UPDATE SKIP LOCKED LIMIT 20`)
			if err != nil {
				_ = tx.Rollback(ctx)
				continue
			}
			type expiredJob struct{ jobID, runID string }
			expired := make([]expiredJob, 0, 20)
			for rows.Next() {
				var item expiredJob
				if rows.Scan(&item.jobID, &item.runID) == nil {
					expired = append(expired, item)
				}
			}
			rows.Close()
			for _, item := range expired {
				_, _ = tx.Exec(ctx, `
					UPDATE execution_jobs
					SET status='FAILED',completed_at=NOW(),lease_owner=NULL,lease_expires_at=NULL,
						last_error='Deployment worker lease expired; validation was not replayed.',updated_at=NOW()
					WHERE id=$1`, item.jobID)
				_, _ = tx.Exec(ctx, `
					UPDATE deployment_validation_runs
					SET status='FAILED',phase='FAILED',gate_decision='BLOCK',ended_at=NOW(),updated_at=NOW(),
						failure_reason='The deployment worker lease expired. Partial evidence was preserved and the workflow was not replayed.'
					WHERE id=$1 AND status NOT IN ('COMPLETED','CANCELLED','FAILED')`, item.runID)
			}
			_ = tx.Commit(ctx)
		}
	}
}
