package postgres

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/notifications"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

type WarmEvidenceStore interface {
	Get(context.Context, string) (io.ReadCloser, error)
}

type RunRepository struct {
	pool      *pgxpool.Pool
	warmStore WarmEvidenceStore
}

func NewRunRepository(pool *pgxpool.Pool) *RunRepository { return &RunRepository{pool: pool} }

func (r *RunRepository) SetWarmEvidenceStore(store WarmEvidenceStore) { r.warmStore = store }

func (r *RunRepository) Save(ctx context.Context, run runs.Run) error {
	return r.save(ctx, run, run.Steps, run.Events)
}

func (r *RunRepository) SaveDelta(ctx context.Context, run runs.Run, steps []runs.StepRun, events []runs.RunEvent) error {
	return r.save(ctx, run, steps, events)
}

func (r *RunRepository) save(ctx context.Context, run runs.Run, changedSteps []runs.StepRun, changedEvents []runs.RunEvent) error {
	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin run persistence: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()
	executionContext, _ := json.Marshal(run.ExecutionContext)
	alertImpact, _ := json.Marshal(run.AlertImpact)
	setupScript, _ := json.Marshal(run.SetupScript)
	apiResponseTimeMS := runAPIResponseTime(run)
	preparationMS, postProcessingMS, networkMS, retryBackoffMS, retryCount := runTimingTotals(run)
	_, err = transaction.Exec(ctx, `
		INSERT INTO monitor_runs (id, monitor_id, revision_id, status, trigger_type, trigger_source, agent_id,
			failure_category, failure_reason, failed_step_id, queue_delay_ms, warning_count, duration_ms, api_response_time_ms,
			preparation_time_ms,post_processing_time_ms,network_time_ms,retry_backoff_time_ms,retry_count,
			started_at, ended_at, created_at, execution_context_json, alert_impact_json, setup_script_json)
		VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,'')::uuid,NULLIF($8,''),NULLIF($9,''),NULLIF($10,''),$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
		ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status, trigger_source=EXCLUDED.trigger_source, agent_id=EXCLUDED.agent_id,
		failure_category=EXCLUDED.failure_category, failure_reason=EXCLUDED.failure_reason, failed_step_id=EXCLUDED.failed_step_id,
		queue_delay_ms=EXCLUDED.queue_delay_ms, warning_count=EXCLUDED.warning_count, duration_ms=EXCLUDED.duration_ms,
		api_response_time_ms=COALESCE(EXCLUDED.api_response_time_ms, monitor_runs.api_response_time_ms),
		preparation_time_ms=EXCLUDED.preparation_time_ms,post_processing_time_ms=EXCLUDED.post_processing_time_ms,
		network_time_ms=EXCLUDED.network_time_ms,retry_backoff_time_ms=EXCLUDED.retry_backoff_time_ms,retry_count=EXCLUDED.retry_count,
		started_at=EXCLUDED.started_at, ended_at=EXCLUDED.ended_at, execution_context_json=EXCLUDED.execution_context_json,
		alert_impact_json=EXCLUDED.alert_impact_json, setup_script_json=EXCLUDED.setup_script_json`,
		run.ID, run.MonitorID, run.RevisionID, run.Status, run.TriggerType, run.TriggerSource,
		run.AgentID, run.FailureCategory, run.FailureReason, run.FailedStepID, run.QueueDelayMS, run.WarningCount,
		run.DurationMS, apiResponseTimeMS, preparationMS, postProcessingMS, networkMS, retryBackoffMS, retryCount,
		run.StartedAt, run.EndedAt, run.CreatedAt, executionContext, alertImpact, setupScript)
	if err != nil {
		return fmt.Errorf("insert monitor run: %w", err)
	}
	for _, step := range changedSteps {
		requestSummary, _ := json.Marshal(step.RequestSummary)
		responseSummary, _ := json.Marshal(step.ResponseSummary)
		timing, _ := json.Marshal(step.Timing)
		tlsSummary, _ := json.Marshal(step.TLS)
		proxySummary, _ := json.Marshal(step.Proxy)
		extractors, _ := json.Marshal(step.Extractors)
		assertions, _ := json.Marshal(step.Assertions)
		outputs, _ := json.Marshal(step.Outputs)
		preRequestScript, _ := json.Marshal(step.PreRequestScript)
		testScript, _ := json.Marshal(step.TestScript)
		_, err := transaction.Exec(ctx, `
			INSERT INTO monitor_step_runs (id, monitor_run_id, step_definition_id, step_order, step_name, step_type,
				status, attempt_count, request_summary_json, response_summary_json, timing_json, tls_summary_json, proxy_summary_json, extractor_results_json,
				assertion_results_json, output_metadata_json, failure_category, error_message,
				started_at, ended_at, duration_ms, pre_request_script_json, test_script_json)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NULLIF($17,''),NULLIF($18,''),$19,$20,$21,$22,$23)
			ON CONFLICT (id) DO UPDATE SET
				status=EXCLUDED.status, attempt_count=EXCLUDED.attempt_count,
				request_summary_json=EXCLUDED.request_summary_json, response_summary_json=EXCLUDED.response_summary_json,
				timing_json=EXCLUDED.timing_json, tls_summary_json=EXCLUDED.tls_summary_json,
				proxy_summary_json=EXCLUDED.proxy_summary_json, extractor_results_json=EXCLUDED.extractor_results_json,
				assertion_results_json=EXCLUDED.assertion_results_json, output_metadata_json=EXCLUDED.output_metadata_json,
				failure_category=EXCLUDED.failure_category, error_message=EXCLUDED.error_message,
				started_at=EXCLUDED.started_at, ended_at=EXCLUDED.ended_at, duration_ms=EXCLUDED.duration_ms,
				pre_request_script_json=EXCLUDED.pre_request_script_json, test_script_json=EXCLUDED.test_script_json`,
			step.ID, run.ID, step.StepDefinitionID, step.StepOrder, step.StepName, step.StepType, step.Status,
			max(step.AttemptCount, 1), requestSummary, responseSummary, timing, tlsSummary, proxySummary, extractors, assertions, outputs, step.FailureCategory,
			step.ErrorMessage, step.StartedAt, step.EndedAt, step.DurationMS, preRequestScript, testScript)
		if err != nil {
			return fmt.Errorf("insert monitor step run: %w", err)
		}
		attemptBatch := &pgx.Batch{}
		for _, attempt := range step.Attempts {
			attemptRequest, _ := json.Marshal(attempt.RequestSummary)
			attemptResponse, _ := json.Marshal(attempt.ResponseSummary)
			attemptTiming, _ := json.Marshal(attempt.Timing)
			attemptTLS, _ := json.Marshal(attempt.TLS)
			attemptProxy, _ := json.Marshal(attempt.Proxy)
			redirects, _ := json.Marshal(attempt.Redirects)
			attemptBatch.Queue(`
				INSERT INTO step_attempts(id,step_run_id,attempt_number,status,response_status,failure_category,error_message,request_summary_json,response_summary_json,timing_json,tls_summary_json,proxy_summary_json,redirects_json,retry_backoff_ms,started_at,ended_at,duration_ms)
				VALUES($1,$2,$3,$4,NULLIF($5,0),NULLIF($6,''),NULLIF($7,''),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
				ON CONFLICT (step_run_id, attempt_number) DO UPDATE SET
					status=EXCLUDED.status, response_status=EXCLUDED.response_status,
					failure_category=EXCLUDED.failure_category, error_message=EXCLUDED.error_message,
					request_summary_json=EXCLUDED.request_summary_json, response_summary_json=EXCLUDED.response_summary_json,
					timing_json=EXCLUDED.timing_json, tls_summary_json=EXCLUDED.tls_summary_json,
					proxy_summary_json=EXCLUDED.proxy_summary_json, redirects_json=EXCLUDED.redirects_json,
					retry_backoff_ms=EXCLUDED.retry_backoff_ms, started_at=EXCLUDED.started_at,
					ended_at=EXCLUDED.ended_at, duration_ms=EXCLUDED.duration_ms`,
				attempt.ID, step.ID, attempt.AttemptNumber, attempt.Status, attempt.ResponseStatus, attempt.FailureCategory, attempt.ErrorMessage, attemptRequest, attemptResponse, attemptTiming, attemptTLS, attemptProxy, redirects, attempt.RetryBackoffMS, attempt.StartedAt, attempt.EndedAt, attempt.DurationMS)
		}
		if attemptBatch.Len() > 0 {
			results := transaction.SendBatch(ctx, attemptBatch)
			for range attemptBatch.Len() {
				if _, err := results.Exec(); err != nil {
					_ = results.Close()
					return fmt.Errorf("insert step attempt batch: %w", err)
				}
			}
			if err := results.Close(); err != nil {
				return fmt.Errorf("close step attempt batch: %w", err)
			}
		}
	}
	eventBatch := &pgx.Batch{}
	for _, event := range changedEvents {
		details, _ := json.Marshal(event.Details)
		eventBatch.Queue(`
			INSERT INTO run_events(id,monitor_run_id,step_run_id,sequence,event_type,status,step_definition_id,attempt_number,category,message,details_json,occurred_at,duration_ms)
			VALUES($1,$2,NULLIF($3,'')::uuid,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,0),NULLIF($9,''),$10,$11,$12,$13)
			ON CONFLICT (monitor_run_id, sequence) DO UPDATE SET
				step_run_id=EXCLUDED.step_run_id, event_type=EXCLUDED.event_type, status=EXCLUDED.status,
				step_definition_id=EXCLUDED.step_definition_id, attempt_number=EXCLUDED.attempt_number,
				category=EXCLUDED.category, message=EXCLUDED.message, details_json=EXCLUDED.details_json,
				occurred_at=EXCLUDED.occurred_at, duration_ms=EXCLUDED.duration_ms`,
			event.ID, run.ID, event.StepRunID, event.Sequence, event.Type, event.Status, event.StepID, event.AttemptNumber, event.Category, event.Message, details, event.OccurredAt, event.DurationMS)
	}
	if eventBatch.Len() > 0 {
		results := transaction.SendBatch(ctx, eventBatch)
		for range eventBatch.Len() {
			if _, err := results.Exec(); err != nil {
				_ = results.Close()
				return fmt.Errorf("insert run event batch: %w", err)
			}
		}
		if err := results.Close(); err != nil {
			return fmt.Errorf("close run event batch: %w", err)
		}
	}
	if run.TriggerType != "MANUAL_DRAFT" && isTerminal(run.Status) {
		claimed, claimErr := transaction.Exec(ctx, `
			UPDATE monitor_runs SET terminal_processed_at=NOW()
			WHERE id=$1 AND terminal_processed_at IS NULL`, run.ID)
		if claimErr != nil {
			return fmt.Errorf("claim terminal run processing: %w", claimErr)
		}
		if claimed.RowsAffected() > 0 {
			if err := evaluateAlertState(ctx, transaction, run); err != nil {
				return fmt.Errorf("evaluate alert state: %w", err)
			}
			if err := updateHourlyRollup(ctx, transaction, run, apiResponseTimeMS); err != nil {
				return fmt.Errorf("update monitor metric rollup: %w", err)
			}
			if err := updateCurrentHealth(ctx, transaction, run); err != nil {
				return fmt.Errorf("update monitor current health: %w", err)
			}
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit run persistence: %w", err)
	}
	return nil
}

func (r *RunRepository) Enqueue(ctx context.Context, run runs.Run, request runs.QueueRequest) error {
	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin durable run enqueue: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()

	executionContext, _ := json.Marshal(run.ExecutionContext)
	alertImpact, _ := json.Marshal(run.AlertImpact)
	setupScript, _ := json.Marshal(run.SetupScript)
	if _, err := transaction.Exec(ctx, `
		INSERT INTO monitor_runs (
			id, monitor_id, revision_id, status, trigger_type, trigger_source,
			failure_category, failure_reason, failed_step_id, queue_delay_ms,
			warning_count, duration_ms, started_at, ended_at, created_at,
			execution_context_json, alert_impact_json, setup_script_json
		) VALUES (
			$1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),
			$10,$11,$12,$13,$14,$15,$16,$17,$18
		)`,
		run.ID, run.MonitorID, run.RevisionID, run.Status, run.TriggerType, run.TriggerSource,
		run.FailureCategory, run.FailureReason, run.FailedStepID, run.QueueDelayMS,
		run.WarningCount, run.DurationMS, run.StartedAt, run.EndedAt, run.CreatedAt,
		executionContext, alertImpact, setupScript,
	); err != nil {
		return fmt.Errorf("insert queued monitor run: %w", err)
	}
	for _, event := range run.Events {
		details, _ := json.Marshal(event.Details)
		if _, err := transaction.Exec(ctx, `
			INSERT INTO run_events (
				id, monitor_run_id, step_run_id, sequence, event_type, status,
				step_definition_id, attempt_number, category, message,
				details_json, occurred_at, duration_ms
			) VALUES (
				$1,$2,NULLIF($3,'')::uuid,$4,$5,NULLIF($6,''),NULLIF($7,''),
				NULLIF($8,0),NULLIF($9,''),$10,$11,$12,$13
			)`,
			event.ID, run.ID, event.StepRunID, event.Sequence, event.Type, event.Status,
			event.StepID, event.AttemptNumber, event.Category, event.Message,
			details, event.OccurredAt, event.DurationMS,
		); err != nil {
			return fmt.Errorf("insert queued run event: %w", err)
		}
	}

	jobID, err := id.NewUUID()
	if err != nil {
		return err
	}
	outboxID, err := id.NewUUID()
	if err != nil {
		return err
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("encode execution job: %w", err)
	}
	queueClass := "manual"
	priority := 200
	streamName := "rhythm:execution:manual"
	if request.TriggerType == "SCHEDULED" {
		queueClass = "scheduled"
		priority = 10
		streamName = "rhythm:execution:scheduled"
	}
	var persistedJobID string
	err = transaction.QueryRow(ctx, `
		INSERT INTO execution_jobs (
			id, run_id, job_type, queue_class, priority, payload_json,
			deduplication_key, available_at, created_at, updated_at
		) VALUES (
			$1,$2,'API_MONITOR_RUN',$3,$4,$5,NULLIF($6,''),$7,$7,$7
		)
		ON CONFLICT (deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING
		RETURNING id::text`,
		jobID, run.ID, queueClass, priority, payload, request.Deduplication, request.QueuedAt,
	).Scan(&persistedJobID)
	if errors.Is(err, pgx.ErrNoRows) {
		return runs.ErrAlreadyQueued
	}
	if err != nil {
		return fmt.Errorf("insert execution job: %w", err)
	}
	outboxPayload, _ := json.Marshal(map[string]string{"jobId": persistedJobID})
	if _, err := transaction.Exec(ctx, `
		INSERT INTO execution_job_outbox (id, job_id, stream_name, payload_json)
		VALUES ($1,$2,$3,$4)`,
		outboxID, persistedJobID, streamName, outboxPayload,
	); err != nil {
		return fmt.Errorf("insert execution outbox record: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit durable run enqueue: %w", err)
	}
	return nil
}

func (r *RunRepository) RequestCancel(ctx context.Context, runID string) (bool, error) {
	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()
	now := time.Now().UTC()
	command, err := transaction.Exec(ctx, `
		UPDATE monitor_runs
		SET cancel_requested_at=$2,
			status=CASE WHEN status IN ('QUEUED','STARTING') THEN 'CANCELLED' ELSE status END,
			ended_at=CASE WHEN status IN ('QUEUED','STARTING') THEN $2 ELSE ended_at END,
			failure_category=CASE WHEN status IN ('QUEUED','STARTING') THEN 'RUN_CANCELLED' ELSE failure_category END,
			failure_reason=CASE WHEN status IN ('QUEUED','STARTING') THEN 'Execution was cancelled before it started.' ELSE failure_reason END
		WHERE id=$1
		  AND status NOT IN ('SUCCESS','SUCCESS_WITH_WARNINGS','FAILED','TIMED_OUT','CANCELLED','ABORTED')`,
		runID, now,
	)
	if err != nil {
		return false, err
	}
	if command.RowsAffected() == 0 {
		return false, transaction.Commit(ctx)
	}
	if _, err := transaction.Exec(ctx, `
		UPDATE execution_jobs
		SET cancel_requested_at=$2,
			status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END,
			completed_at=CASE WHEN status='QUEUED' THEN $2 ELSE completed_at END,
			updated_at=$2
		WHERE run_id=$1 AND status IN ('QUEUED','LEASED')`,
		runID, now,
	); err != nil {
		return false, err
	}
	if err := transaction.Commit(ctx); err != nil {
		return false, err
	}
	return true, nil
}

func runAPIResponseTime(run runs.Run) *int64 {
	if run.APIResponseTimeMS != nil {
		value := *run.APIResponseTimeMS
		return &value
	}
	var total int64
	recorded := false
	for _, step := range run.Steps {
		value, ok := numericTiming(step.Timing["apiResponseTimeMs"])
		if !ok {
			continue
		}
		total += value
		recorded = true
	}
	if !recorded {
		return nil
	}
	return &total
}

func runTimingTotals(run runs.Run) (preparation, postProcessing, network, retryBackoff int64, retryCount int) {
	for _, step := range run.Steps {
		if value, ok := numericTiming(step.Timing["preparationMs"]); ok {
			preparation += value
		}
		if value, ok := numericTiming(step.Timing["postProcessingMs"]); ok {
			postProcessing += value
		}
		if value, ok := numericTiming(step.Timing["networkTotalMs"]); ok {
			network += value
		}
		if value, ok := numericTiming(step.Timing["retryBackoffMs"]); ok {
			retryBackoff += value
		}
		retryCount += max(0, step.AttemptCount-1)
	}
	return
}

func numericTiming(value any) (int64, bool) {
	switch typed := value.(type) {
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	case float64:
		return int64(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func updateCurrentHealth(ctx context.Context, tx pgx.Tx, run runs.Run) error {
	operationalStatus := "FAILING"
	reason := "The latest execution requires attention."
	switch run.Status {
	case runs.StatusSuccess:
		operationalStatus, reason = "HEALTHY", "The latest execution succeeded."
	case runs.StatusSuccessWithWarnings:
		operationalStatus, reason = "DEGRADED", "The latest execution completed with warnings."
	case runs.StatusCancelled:
		operationalStatus, reason = "NO_SIGNAL", "The latest execution was cancelled."
	}
	apiResponse := runAPIResponseTime(run)
	_, err := tx.Exec(ctx, `
		INSERT INTO monitor_current_health (
			monitor_id, operational_status, status_reason, last_run_id,
			last_run_status, last_run_at, last_duration_ms, last_api_response_time_ms,
			success_count_24h, run_count_24h, success_rate_24h,
			active_alert_count, next_run_at, updated_at
		)
		SELECT
			$1,$2,$3,$4,$5,$6,$7,$8,
			stats.success_count,
			stats.run_count,
			100.0 * stats.success_count / NULLIF(stats.run_count, 0),
			(SELECT COUNT(*) FROM alerts WHERE monitor_id=$1 AND state IN ('OPEN','ACKNOWLEDGED','ERROR')),
			(SELECT next_run_at FROM monitor_schedules WHERE monitor_id=$1 AND active=TRUE ORDER BY updated_at DESC LIMIT 1),
			NOW()
		FROM (
			SELECT
				COALESCE(SUM(success_count),0)::bigint AS success_count,
				COALESCE(SUM(sample_count),0)::bigint AS run_count
			FROM monitor_metric_rollups_hourly
			WHERE monitor_id=$1
			  AND bucket_start>=date_trunc('hour',NOW()-INTERVAL '24 hours')
		) stats
		ON CONFLICT (monitor_id) DO UPDATE SET
			operational_status=EXCLUDED.operational_status,
			status_reason=EXCLUDED.status_reason,
			last_run_id=EXCLUDED.last_run_id,
			last_run_status=EXCLUDED.last_run_status,
			last_run_at=EXCLUDED.last_run_at,
			last_duration_ms=EXCLUDED.last_duration_ms,
			last_api_response_time_ms=EXCLUDED.last_api_response_time_ms,
			success_count_24h=EXCLUDED.success_count_24h,
			run_count_24h=EXCLUDED.run_count_24h,
			success_rate_24h=EXCLUDED.success_rate_24h,
			active_alert_count=EXCLUDED.active_alert_count,
			next_run_at=EXCLUDED.next_run_at,
			updated_at=EXCLUDED.updated_at`,
		run.MonitorID, operationalStatus, reason, run.ID, run.Status, run.CreatedAt,
		run.DurationMS, apiResponse,
	)
	return err
}

func updateHourlyRollup(ctx context.Context, tx pgx.Tx, run runs.Run, apiResponse *int64) error {
	if run.Status == runs.StatusCancelled {
		return nil
	}
	success := int64(0)
	failure := int64(0)
	timeout := int64(0)
	if run.Status == runs.StatusSuccess || run.Status == runs.StatusSuccessWithWarnings {
		success = 1
	} else {
		failure = 1
	}
	if run.Status == runs.StatusTimedOut {
		timeout = 1
	}
	apiValue := int64(0)
	hasAPIValue := apiResponse != nil
	if apiResponse != nil {
		apiValue = *apiResponse
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO monitor_metric_rollups_hourly (
			monitor_id, revision_id, bucket_start, sample_count, success_count,
			failure_count, timeout_count, api_response_sum_ms,
			api_response_min_ms, api_response_max_ms, api_response_values_ms
		) VALUES (
			$1,$2,date_trunc('hour',$3::timestamptz),1,$4,$5,$6,
			CASE WHEN $7 THEN $8 ELSE 0 END,
			CASE WHEN $7 THEN $8 ELSE NULL END,
			CASE WHEN $7 THEN $8 ELSE NULL END,
			CASE WHEN $7 THEN jsonb_build_array($8) ELSE '[]'::jsonb END
		)
		ON CONFLICT (monitor_id, bucket_start) DO UPDATE SET
			sample_count=monitor_metric_rollups_hourly.sample_count+1,
			success_count=monitor_metric_rollups_hourly.success_count+EXCLUDED.success_count,
			failure_count=monitor_metric_rollups_hourly.failure_count+EXCLUDED.failure_count,
			timeout_count=monitor_metric_rollups_hourly.timeout_count+EXCLUDED.timeout_count,
			api_response_sum_ms=monitor_metric_rollups_hourly.api_response_sum_ms+EXCLUDED.api_response_sum_ms,
			api_response_min_ms=CASE
				WHEN EXCLUDED.api_response_min_ms IS NULL THEN monitor_metric_rollups_hourly.api_response_min_ms
				ELSE LEAST(monitor_metric_rollups_hourly.api_response_min_ms, EXCLUDED.api_response_min_ms)
			END,
			api_response_max_ms=CASE
				WHEN EXCLUDED.api_response_max_ms IS NULL THEN monitor_metric_rollups_hourly.api_response_max_ms
				ELSE GREATEST(monitor_metric_rollups_hourly.api_response_max_ms, EXCLUDED.api_response_max_ms)
			END,
			api_response_values_ms=monitor_metric_rollups_hourly.api_response_values_ms || EXCLUDED.api_response_values_ms,
			updated_at=NOW()`,
		run.MonitorID, run.RevisionID, run.CreatedAt, success, failure, timeout, hasAPIValue, apiValue,
	)
	return err
}

func isTerminal(status runs.Status) bool {
	switch status {
	case runs.StatusSuccess, runs.StatusSuccessWithWarnings, runs.StatusFailed, runs.StatusTimedOut, runs.StatusCancelled, runs.StatusAborted:
		return true
	default:
		return false
	}
}

func evaluateAlertState(ctx context.Context, tx pgx.Tx, run runs.Run) error {
	failureThreshold, recoveryThreshold, severity := 3, 2, "CRITICAL"
	err := tx.QueryRow(ctx, `SELECT failure_threshold, recovery_threshold, severity FROM monitor_alert_policies WHERE monitor_id=$1`, run.MonitorID).Scan(&failureThreshold, &recoveryThreshold, &severity)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	limit := max(failureThreshold, recoveryThreshold)
	rows, err := tx.Query(ctx, `SELECT status FROM monitor_runs WHERE monitor_id=$1 AND trigger_type <> 'MANUAL_DRAFT' ORDER BY created_at DESC LIMIT $2`, run.MonitorID, limit)
	if err != nil {
		return err
	}
	defer rows.Close()
	statuses := make([]runs.Status, 0, limit)
	for rows.Next() {
		var status runs.Status
		if err := rows.Scan(&status); err != nil {
			return err
		}
		statuses = append(statuses, status)
	}
	consecutiveFailures, consecutiveSuccesses := 0, 0
	for _, status := range statuses {
		if status == runs.StatusSuccess {
			break
		}
		consecutiveFailures++
	}
	for _, status := range statuses {
		if status != runs.StatusSuccess {
			break
		}
		consecutiveSuccesses++
	}
	key := "monitor:" + run.MonitorID
	if run.Status != runs.StatusSuccess && consecutiveFailures >= failureThreshold {
		alertID, err := id.NewUUID()
		if err != nil {
			return err
		}
		var monitorName string
		if err := tx.QueryRow(ctx, `SELECT name FROM monitors WHERE id=$1`, run.MonitorID).Scan(&monitorName); err != nil {
			return err
		}
		var persistedAlertID string
		err = tx.QueryRow(ctx, `INSERT INTO alerts (id,monitor_id,deduplication_key,state,severity,title,description,failure_category,failed_step_id,consecutive_failures,first_triggered_at,last_triggered_at,created_at,updated_at) VALUES ($1,$2,$3,'OPEN',$4,$5,$6,NULLIF($7,''),NULLIF($8,''),$9,$10,$10,$10,$10) ON CONFLICT (deduplication_key) WHERE state IN ('OPEN','ACKNOWLEDGED') DO UPDATE SET last_triggered_at=EXCLUDED.last_triggered_at, updated_at=EXCLUDED.updated_at, consecutive_failures=EXCLUDED.consecutive_failures, failure_category=EXCLUDED.failure_category, failed_step_id=EXCLUDED.failed_step_id, description=EXCLUDED.description RETURNING id::text`, alertID, run.MonitorID, key, severity, monitorName+" is failing", run.FailureReason, run.FailureCategory, run.FailedStepID, consecutiveFailures, run.CreatedAt).Scan(&persistedAlertID)
		if err != nil {
			return err
		}
		return notifications.Enqueue(ctx, tx, persistedAlertID, "ALERT_OPENED", run.CreatedAt)
	}
	if run.Status == runs.StatusSuccess && consecutiveSuccesses >= recoveryThreshold {
		rows, err := tx.Query(ctx, `UPDATE alerts SET state='RESOLVED', resolved_at=$2, updated_at=$2 WHERE deduplication_key=$1 AND state IN ('OPEN','ACKNOWLEDGED') RETURNING id::text`, key, run.CreatedAt)
		if err != nil {
			return err
		}
		alertIDs := []string{}
		for rows.Next() {
			var alertID string
			if err := rows.Scan(&alertID); err != nil {
				rows.Close()
				return err
			}
			alertIDs = append(alertIDs, alertID)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		for _, alertID := range alertIDs {
			if err := notifications.Enqueue(ctx, tx, alertID, "ALERT_RECOVERED", run.CreatedAt); err != nil {
				return err
			}
		}
		return nil
	}
	return nil
}

func (r *RunRepository) List(ctx context.Context, monitorID string, limit int) ([]runs.Run, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, monitor_id::text, revision_id::text, status, trigger_type, COALESCE(trigger_source,''),COALESCE(agent_id::text,''),
			COALESCE(failure_category,''), COALESCE(failure_reason,''), COALESCE(failed_step_id,''), queue_delay_ms, warning_count, duration_ms,
			started_at, ended_at, created_at, execution_context_json, alert_impact_json, setup_script_json
		FROM monitor_runs WHERE monitor_id = $1 ORDER BY created_at DESC LIMIT $2`, monitorID, limit)
	if err != nil {
		return nil, fmt.Errorf("list monitor runs: %w", err)
	}
	defer rows.Close()
	items := make([]runs.Run, 0)
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, run)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := attachListAPIResponseTimes(ctx, r.pool, items); err != nil {
		return nil, err
	}
	return items, nil
}

func attachListAPIResponseTimes(ctx context.Context, pool *pgxpool.Pool, items []runs.Run) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, len(items))
	byID := make(map[string]int, len(items))
	for index, item := range items {
		ids[index] = item.ID
		byID[item.ID] = index
	}
	rows, err := pool.Query(ctx, `
		SELECT monitor_run_id::text,
			SUM(CASE WHEN timing_json ? 'apiResponseTimeMs' THEN (timing_json->>'apiResponseTimeMs')::bigint END)
		FROM monitor_step_runs
		WHERE monitor_run_id = ANY($1::uuid[])
		GROUP BY monitor_run_id`, ids)
	if err != nil {
		return fmt.Errorf("list run api response times: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var runID string
		var apiResponse pgtype.Int8
		if err := rows.Scan(&runID, &apiResponse); err != nil {
			return fmt.Errorf("scan run api response time: %w", err)
		}
		index, ok := byID[runID]
		if !ok || !apiResponse.Valid {
			continue
		}
		value := apiResponse.Int64
		items[index].APIResponseTimeMS = &value
	}
	return rows.Err()
}

func (r *RunRepository) MetricPoints(ctx context.Context, monitorID string, since time.Time, limit int) ([]runs.HistoryMetricPoint, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT mr.id::text, mr.status, COALESCE(mr.failure_category,''), mr.created_at, mr.duration_ms, mr.queue_delay_ms, mr.warning_count,
			SUM(CASE WHEN sr.timing_json ? 'apiResponseTimeMs' THEN (sr.timing_json->>'apiResponseTimeMs')::bigint END),
			COALESCE(SUM(CASE WHEN sr.timing_json ? 'preparationMs' THEN (sr.timing_json->>'preparationMs')::bigint ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN sr.timing_json ? 'postProcessingMs' THEN (sr.timing_json->>'postProcessingMs')::bigint ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN sr.timing_json ? 'networkTotalMs' THEN (sr.timing_json->>'networkTotalMs')::bigint ELSE 0 END),0),
			COALESCE(SUM(CASE WHEN sr.timing_json ? 'retryBackoffMs' THEN (sr.timing_json->>'retryBackoffMs')::bigint ELSE 0 END),0),
			COALESCE(SUM(GREATEST(sr.attempt_count-1,0)),0)
		FROM monitor_runs mr
		LEFT JOIN monitor_step_runs sr ON sr.monitor_run_id=mr.id
		WHERE mr.monitor_id=$1 AND mr.created_at >= $2
		GROUP BY mr.id
		ORDER BY mr.created_at DESC
		LIMIT $3`, monitorID, since, limit)
	if err != nil {
		return nil, fmt.Errorf("load run metric points: %w", err)
	}
	defer rows.Close()
	points := make([]runs.HistoryMetricPoint, 0)
	for rows.Next() {
		var point runs.HistoryMetricPoint
		var apiResponse pgtype.Int8
		if err := rows.Scan(&point.RunID, &point.Status, &point.FailureCategory, &point.CreatedAt, &point.ExecutionDurationMS, &point.QueueDelayMS, &point.WarningCount, &apiResponse, &point.PreparationMS, &point.PostProcessingMS, &point.NetworkTotalMS, &point.RetryBackoffMS, &point.RetryCount); err != nil {
			return nil, fmt.Errorf("scan run metric point: %w", err)
		}
		if apiResponse.Valid {
			value := apiResponse.Int64
			point.APIResponseTimeMS = &value
		}
		points = append(points, point)
	}
	return points, rows.Err()
}

func (r *RunRepository) MetricSummary(ctx context.Context, monitorID string, since time.Time, duration time.Duration) (runs.HistoryMetrics, error) {
	if duration > 30*24*time.Hour {
		return r.metricRollupSummary(ctx, monitorID, since, duration)
	}
	end := time.Now().UTC()
	result := runs.HistoryMetrics{
		WindowStart:        since,
		WindowEnd:          end,
		StatusDistribution: map[string]int{},
		FailureCategories:  map[string]int{},
		Points:             []runs.HistoryMetricPoint{},
	}
	switch {
	case duration <= 24*time.Hour:
		result.Window = "24h"
	case duration <= 7*24*time.Hour:
		result.Window = "7d"
	case duration <= 30*24*time.Hour:
		result.Window = "30d"
	default:
		result.Window = "90d"
	}
	batch := &pgx.Batch{}
	batch.Queue(`
		WITH base AS (
			SELECT status,api_response_time_ms,duration_ms,queue_delay_ms,
				COALESCE(preparation_time_ms,0) preparation_time_ms,
				COALESCE(post_processing_time_ms,0) post_processing_time_ms,
				created_at
			FROM monitor_runs
			WHERE monitor_id=$1 AND created_at>=$2
			  AND status NOT IN ('QUEUED','STARTING','RUNNING','CANCELLED','SKIPPED')
		), distribution AS (
			SELECT
				percentile_cont(0.50) WITHIN GROUP (ORDER BY api_response_time_ms) AS p50,
				percentile_cont(0.75) WITHIN GROUP (ORDER BY api_response_time_ms) AS p75,
				percentile_cont(0.90) WITHIN GROUP (ORDER BY api_response_time_ms) AS p90,
				percentile_cont(0.95) WITHIN GROUP (ORDER BY api_response_time_ms) AS p95,
				percentile_cont(0.99) WITHIN GROUP (ORDER BY api_response_time_ms) AS p99
			FROM base WHERE api_response_time_ms IS NOT NULL
		)
		SELECT
			COUNT(*),
			COUNT(api_response_time_ms),
			COUNT(*) FILTER (WHERE status IN ('SUCCESS','SUCCESS_WITH_WARNINGS')),
			COUNT(*) FILTER (WHERE status NOT IN ('SUCCESS','SUCCESS_WITH_WARNINGS')),
			COUNT(*) FILTER (WHERE status='TIMED_OUT'),
			COALESCE(AVG(api_response_time_ms),0),
			COALESCE(STDDEV_POP(api_response_time_ms),0),
			COALESCE(MIN(api_response_time_ms),0),
			COALESCE(distribution.p50,0),COALESCE(distribution.p75,0),
			COALESCE(distribution.p90,0),COALESCE(distribution.p95,0),
			COALESCE(distribution.p99,0),COALESCE(MAX(api_response_time_ms),0),
			COALESCE(AVG(duration_ms),0),COALESCE(AVG(queue_delay_ms),0),
			COALESCE(AVG(preparation_time_ms),0),COALESCE(AVG(post_processing_time_ms),0),
			COALESCE((array_agg(api_response_time_ms ORDER BY created_at DESC)
				FILTER (WHERE api_response_time_ms IS NOT NULL))[1],0),
			COALESCE((array_agg(api_response_time_ms ORDER BY created_at DESC)
				FILTER (WHERE api_response_time_ms IS NOT NULL))[2],0),
			COUNT(*) FILTER (
				WHERE api_response_time_ms>distribution.p95
				  AND api_response_time_ms-distribution.p50>=100
				  AND api_response_time_ms>=distribution.p50*1.25
			)
		FROM base CROSS JOIN distribution
		GROUP BY distribution.p50,distribution.p75,distribution.p90,distribution.p95,distribution.p99`,
		monitorID, since)
	batch.Queue(`
		SELECT status,COUNT(*) FROM monitor_runs
		WHERE monitor_id=$1 AND created_at>=$2
		GROUP BY status`, monitorID, since)
	batch.Queue(`
		SELECT failure_category,COUNT(*) FROM monitor_runs
		WHERE monitor_id=$1 AND created_at>=$2 AND failure_category IS NOT NULL
		GROUP BY failure_category`, monitorID, since)
	results := r.pool.SendBatch(ctx, batch)
	defer results.Close()
	var runCount, measuredCount, successCount, errorCount, timeoutCount, spikeCount int
	var averageResponse, standardDeviation float64
	var minValue, p50, p75, p90, p95, p99, maxValue float64
	var averageExecution, averageQueue, averagePreparation, averagePost float64
	var latest, previous int64
	err := results.QueryRow().Scan(
		&runCount, &measuredCount, &successCount, &errorCount, &timeoutCount,
		&averageResponse, &standardDeviation, &minValue, &p50, &p75, &p90,
		&p95, &p99, &maxValue, &averageExecution, &averageQueue,
		&averagePreparation, &averagePost, &latest, &previous, &spikeCount,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		err = nil
	}
	if err != nil {
		return runs.HistoryMetrics{}, fmt.Errorf("load monitor metric summary: %w", err)
	}
	statusRows, err := results.Query()
	if err != nil {
		return runs.HistoryMetrics{}, err
	}
	for statusRows.Next() {
		var key string
		var value int
		if err := statusRows.Scan(&key, &value); err != nil {
			statusRows.Close()
			return runs.HistoryMetrics{}, err
		}
		result.StatusDistribution[key] = value
	}
	statusRows.Close()
	failureRows, err := results.Query()
	if err != nil {
		return runs.HistoryMetrics{}, err
	}
	for failureRows.Next() {
		var key string
		var value int
		if err := failureRows.Scan(&key, &value); err != nil {
			failureRows.Close()
			return runs.HistoryMetrics{}, err
		}
		result.FailureCategories[key] = value
	}
	failureRows.Close()
	result.Summary.RunCount = runCount
	result.Summary.MeasuredRunCount = measuredCount
	result.Summary.AverageResponseMS = int64(averageResponse)
	result.Summary.StandardDeviationMS = standardDeviation
	result.Summary.LatestResponseMS = latest
	result.Summary.AverageExecutionMS = int64(averageExecution)
	result.Summary.AverageQueueDelayMS = int64(averageQueue)
	result.Summary.AveragePreparationMS = int64(averagePreparation)
	result.Summary.AveragePostProcessMS = int64(averagePost)
	result.Summary.SpikeCount = spikeCount
	result.Summary.RunsPerHour = math.Round((float64(runCount)/duration.Hours())*100) / 100
	if runCount > 0 {
		result.Summary.SuccessRate = math.Round(float64(successCount)/float64(runCount)*1000) / 10
		result.Summary.ErrorRate = math.Round(float64(errorCount)/float64(runCount)*1000) / 10
		result.Summary.TimeoutRate = math.Round(float64(timeoutCount)/float64(runCount)*1000) / 10
	}
	if previous > 0 {
		result.Summary.LatestChangePercent = math.Round(float64(latest-previous)/float64(previous)*1000) / 10
	}
	result.Percentiles = runs.PercentileMetrics{
		MinMS: int64(minValue), P50MS: int64(p50), P75MS: int64(p75),
		P90MS: int64(p90), P95MS: int64(p95), P99MS: int64(p99), MaxMS: int64(maxValue),
	}
	return result, nil
}

func (r *RunRepository) metricRollupSummary(
	ctx context.Context,
	monitorID string,
	since time.Time,
	duration time.Duration,
) (runs.HistoryMetrics, error) {
	result := runs.HistoryMetrics{
		Window: "90d", WindowStart: since, WindowEnd: time.Now().UTC(),
		StatusDistribution: map[string]int{}, FailureCategories: map[string]int{},
		Points: []runs.HistoryMetricPoint{},
	}
	var runCount, measuredCount, successCount, failureCount, timeoutCount, spikeCount int
	var averageResponse, standardDeviation, minValue, p50, p75, p90, p95, p99, maxValue float64
	var latest, previous int64
	err := r.pool.QueryRow(ctx, `
		WITH hourly AS (
			SELECT *
			FROM monitor_metric_rollups_hourly
			WHERE monitor_id=$1 AND bucket_start>=$2
		), totals AS (
			SELECT
				COALESCE(SUM(sample_count),0)::bigint sample_count,
				COALESCE(SUM(success_count),0)::bigint success_count,
				COALESCE(SUM(failure_count),0)::bigint failure_count,
				COALESCE(SUM(timeout_count),0)::bigint timeout_count
			FROM hourly
		), values AS (
			SELECT element.value::double precision value,hourly.bucket_start,element.ordinality
			FROM hourly
			CROSS JOIN LATERAL jsonb_array_elements_text(hourly.api_response_values_ms)
				WITH ORDINALITY AS element(value,ordinality)
		), distribution AS (
			SELECT COUNT(*)::bigint measured_count,COALESCE(AVG(value),0) average_value,
				COALESCE(STDDEV_POP(value),0) standard_deviation,
				COALESCE(MIN(value),0) minimum_value,
				COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY value),0) p50,
				COALESCE(percentile_cont(0.75) WITHIN GROUP (ORDER BY value),0) p75,
				COALESCE(percentile_cont(0.90) WITHIN GROUP (ORDER BY value),0) p90,
				COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY value),0) p95,
				COALESCE(percentile_cont(0.99) WITHIN GROUP (ORDER BY value),0) p99,
				COALESCE(MAX(value),0) maximum_value
			FROM values
		), recent AS (
			SELECT COALESCE((array_agg(value ORDER BY bucket_start DESC,ordinality DESC))[1],0) latest,
				COALESCE((array_agg(value ORDER BY bucket_start DESC,ordinality DESC))[2],0) previous
			FROM values
		)
		SELECT totals.sample_count,distribution.measured_count,totals.success_count,
			totals.failure_count,totals.timeout_count,distribution.average_value,
			distribution.standard_deviation,distribution.minimum_value,
			distribution.p50,distribution.p75,distribution.p90,distribution.p95,
			distribution.p99,distribution.maximum_value,recent.latest,recent.previous,
			(SELECT COUNT(*) FROM values
			 WHERE value>distribution.p95
			   AND value-distribution.p50>=100
			   AND value>=distribution.p50*1.25)
		FROM totals CROSS JOIN distribution CROSS JOIN recent`,
		monitorID, since,
	).Scan(
		&runCount, &measuredCount, &successCount, &failureCount, &timeoutCount,
		&averageResponse, &standardDeviation, &minValue, &p50, &p75, &p90,
		&p95, &p99, &maxValue, &latest, &previous, &spikeCount,
	)
	if err != nil {
		return runs.HistoryMetrics{}, fmt.Errorf("load monitor rollup summary: %w", err)
	}
	result.Summary.RunCount = runCount
	result.Summary.MeasuredRunCount = measuredCount
	result.Summary.AverageResponseMS = int64(averageResponse)
	result.Summary.StandardDeviationMS = standardDeviation
	result.Summary.LatestResponseMS = latest
	result.Summary.SpikeCount = spikeCount
	result.Summary.RunsPerHour = math.Round((float64(runCount)/duration.Hours())*100) / 100
	if runCount > 0 {
		result.Summary.SuccessRate = math.Round(float64(successCount)/float64(runCount)*1000) / 10
		result.Summary.ErrorRate = math.Round(float64(failureCount)/float64(runCount)*1000) / 10
		result.Summary.TimeoutRate = math.Round(float64(timeoutCount)/float64(runCount)*1000) / 10
	}
	if previous > 0 {
		result.Summary.LatestChangePercent = math.Round(float64(latest-previous)/float64(previous)*1000) / 10
	}
	result.Percentiles = runs.PercentileMetrics{
		MinMS: int64(minValue), P50MS: int64(p50), P75MS: int64(p75),
		P90MS: int64(p90), P95MS: int64(p95), P99MS: int64(p99), MaxMS: int64(maxValue),
	}
	if successCount > 0 {
		result.StatusDistribution[string(runs.StatusSuccess)] = successCount
	}
	if failureCount-timeoutCount > 0 {
		result.StatusDistribution[string(runs.StatusFailed)] = failureCount - timeoutCount
	}
	if timeoutCount > 0 {
		result.StatusDistribution[string(runs.StatusTimedOut)] = timeoutCount
	}
	return result, nil
}

func (r *RunRepository) MetricSeries(ctx context.Context, monitorID string, since time.Time, duration time.Duration, maxPoints int) ([]runs.HistoryMetricPoint, error) {
	if duration > 30*24*time.Hour {
		return r.metricRollupSeries(ctx, monitorID, since, duration, maxPoints)
	}
	bucketSeconds := int(math.Ceil(duration.Seconds() / float64(maxPoints)))
	bucketSeconds = max(1, bucketSeconds)
	rows, err := r.pool.Query(ctx, `
		WITH raw AS (
			SELECT *
			FROM monitor_runs
			WHERE monitor_id=$1 AND created_at>=$2
			  AND status NOT IN ('QUEUED','STARTING','RUNNING')
		), distribution AS (
			SELECT
				percentile_cont(0.50) WITHIN GROUP (ORDER BY api_response_time_ms) AS p50,
				percentile_cont(0.95) WITHIN GROUP (ORDER BY api_response_time_ms) AS p95
			FROM raw WHERE api_response_time_ms IS NOT NULL
		), base AS (
			SELECT raw.*,distribution.p50,distribution.p95,
				date_bin(make_interval(secs=>$3),created_at,TIMESTAMPTZ '2000-01-01') AS bucket
			FROM raw CROSS JOIN distribution
		), ranked AS (
			SELECT *,
				ROW_NUMBER() OVER (
					PARTITION BY bucket
					ORDER BY api_response_time_ms DESC NULLS LAST,created_at DESC,id DESC
				) AS bucket_rank
			FROM base
		)
		SELECT id::text,status,COALESCE(failure_category,''),created_at,
			api_response_time_ms,duration_ms,COALESCE(preparation_time_ms,0),
			COALESCE(post_processing_time_ms,0),COALESCE(network_time_ms,0),
			COALESCE(retry_backoff_time_ms,0),queue_delay_ms,COALESCE(retry_count,0),
			warning_count,
			COALESCE(api_response_time_ms>p95
			  AND api_response_time_ms-p50>=100
			  AND api_response_time_ms>=p50*1.25,FALSE)
		FROM ranked WHERE bucket_rank=1
		ORDER BY created_at`, monitorID, since, bucketSeconds)
	if err != nil {
		return nil, fmt.Errorf("load projected monitor metric series: %w", err)
	}
	defer rows.Close()
	points := make([]runs.HistoryMetricPoint, 0, maxPoints)
	for rows.Next() {
		var point runs.HistoryMetricPoint
		var apiResponse pgtype.Int8
		if err := rows.Scan(
			&point.RunID, &point.Status, &point.FailureCategory, &point.CreatedAt,
			&apiResponse, &point.ExecutionDurationMS, &point.PreparationMS,
			&point.PostProcessingMS, &point.NetworkTotalMS, &point.RetryBackoffMS,
			&point.QueueDelayMS, &point.RetryCount, &point.WarningCount, &point.Spike,
		); err != nil {
			return nil, err
		}
		if apiResponse.Valid {
			value := apiResponse.Int64
			point.APIResponseTimeMS = &value
		}
		points = append(points, point)
	}
	return points, rows.Err()
}

func (r *RunRepository) metricRollupSeries(
	ctx context.Context,
	monitorID string,
	since time.Time,
	duration time.Duration,
	maxPoints int,
) ([]runs.HistoryMetricPoint, error) {
	bucketSeconds := max(3600, int(math.Ceil(duration.Seconds()/float64(maxPoints))))
	rows, err := r.pool.Query(ctx, `
		SELECT date_bin(make_interval(secs=>$3),bucket_start,TIMESTAMPTZ '2000-01-01') bucket,
			SUM(sample_count)::bigint,SUM(success_count)::bigint,
			SUM(failure_count)::bigint,SUM(timeout_count)::bigint,
			SUM(api_response_sum_ms)::bigint,
			SUM(jsonb_array_length(api_response_values_ms))::bigint
		FROM monitor_metric_rollups_hourly
		WHERE monitor_id=$1 AND bucket_start>=$2
		GROUP BY bucket
		ORDER BY bucket`, monitorID, since, bucketSeconds)
	if err != nil {
		return nil, fmt.Errorf("load monitor rollup series: %w", err)
	}
	defer rows.Close()
	points := make([]runs.HistoryMetricPoint, 0, maxPoints)
	for rows.Next() {
		var point runs.HistoryMetricPoint
		var sampleCount, successCount, failureCount, timeoutCount, responseSum, measuredCount int64
		if err := rows.Scan(
			&point.CreatedAt, &sampleCount, &successCount, &failureCount,
			&timeoutCount, &responseSum, &measuredCount,
		); err != nil {
			return nil, err
		}
		switch {
		case failureCount > 0:
			point.Status = runs.StatusFailed
		case successCount > 0:
			point.Status = runs.StatusSuccess
		default:
			point.Status = runs.StatusSkipped
		}
		if timeoutCount == sampleCount && sampleCount > 0 {
			point.Status = runs.StatusTimedOut
		}
		if measuredCount > 0 {
			value := responseSum / measuredCount
			point.APIResponseTimeMS = &value
		}
		points = append(points, point)
	}
	return points, rows.Err()
}

func (r *RunRepository) MetricPointsBetween(ctx context.Context, monitorID, revisionID string, from, to time.Time, limit int) ([]runs.HistoryMetricPoint, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT mr.id::text,mr.revision_id::text,mr.status,COALESCE(mr.failure_category,''),mr.created_at,mr.duration_ms,mr.queue_delay_ms,mr.warning_count,
			COALESCE(sr.step_definition_id,''),COALESCE(sr.step_name,''),COALESCE(sr.step_type,''),COALESCE(sr.status,''),COALESCE(sr.timing_json,'{}'::jsonb)
		FROM monitor_runs mr
		LEFT JOIN monitor_step_runs sr ON sr.monitor_run_id=mr.id
		WHERE mr.monitor_id=$1 AND mr.revision_id=$2 AND mr.created_at >= $3 AND mr.created_at < $4
		ORDER BY mr.created_at ASC,sr.step_order ASC
		LIMIT $5`, monitorID, revisionID, from, to, limit*100)
	if err != nil {
		return nil, fmt.Errorf("load deployment metric points: %w", err)
	}
	defer rows.Close()
	points := make([]runs.HistoryMetricPoint, 0)
	byID := map[string]int{}
	for rows.Next() {
		var runID, stepID, stepName, stepType, stepStatus string
		var point runs.HistoryMetricPoint
		var timingJSON []byte
		if err := rows.Scan(&runID, &point.RevisionID, &point.Status, &point.FailureCategory, &point.CreatedAt, &point.ExecutionDurationMS, &point.QueueDelayMS, &point.WarningCount, &stepID, &stepName, &stepType, &stepStatus, &timingJSON); err != nil {
			return nil, err
		}
		index, exists := byID[runID]
		if !exists {
			point.RunID = runID
			points = append(points, point)
			index = len(points) - 1
			byID[runID] = index
		}
		if stepID == "" {
			continue
		}
		var timing map[string]any
		_ = json.Unmarshal(timingJSON, &timing)
		if _, recorded := timing["apiResponseTimeMs"]; !recorded {
			continue
		}
		value := metricTimingMilliseconds(timing, "apiResponseTimeMs")
		stepPoint := runs.HistoryStepMetricPoint{StepDefinitionID: stepID, StepName: stepName, StepType: stepType, Status: runs.Status(stepStatus), APIResponseTimeMS: &value}
		points[index].Steps = append(points[index].Steps, stepPoint)
		if points[index].APIResponseTimeMS == nil {
			zero := int64(0)
			points[index].APIResponseTimeMS = &zero
		}
		*points[index].APIResponseTimeMS += value
	}
	if len(points) > limit {
		points = points[len(points)-limit:]
	}
	return points, rows.Err()
}

func metricTimingMilliseconds(values map[string]any, key string) int64 {
	value, ok := values[key]
	if !ok {
		return 0
	}
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case json.Number:
		parsed, _ := typed.Int64()
		return parsed
	default:
		return 0
	}
}

func (r *RunRepository) ListRecent(ctx context.Context, limit int) ([]runs.Run, error) {
	rows, err := r.pool.Query(ctx, `SELECT id::text,monitor_id::text,revision_id::text,status,trigger_type,COALESCE(trigger_source,''),COALESCE(agent_id::text,''),COALESCE(failure_category,''),COALESCE(failure_reason,''),COALESCE(failed_step_id,''),queue_delay_ms,warning_count,duration_ms,started_at,ended_at,created_at,execution_context_json,alert_impact_json,setup_script_json FROM monitor_runs ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []runs.Run{}
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, run)
	}
	return items, rows.Err()
}

func (r *RunRepository) Get(ctx context.Context, runID string) (runs.Run, error) {
	run, err := scanRun(r.pool.QueryRow(ctx, `
		SELECT id::text, monitor_id::text, revision_id::text, status, trigger_type, COALESCE(trigger_source,''),COALESCE(agent_id::text,''),
			COALESCE(failure_category,''), COALESCE(failure_reason,''), COALESCE(failed_step_id,''), queue_delay_ms, warning_count, duration_ms,
			started_at, ended_at, created_at, execution_context_json, alert_impact_json, setup_script_json FROM monitor_runs WHERE id = $1`, runID))
	if errors.Is(err, pgx.ErrNoRows) {
		return runs.Run{}, runs.ErrNotFound
	}
	if err != nil {
		return runs.Run{}, err
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, step_definition_id, step_order, step_name, step_type, status, attempt_count,
			request_summary_json, response_summary_json, timing_json, tls_summary_json, proxy_summary_json, extractor_results_json,
			assertion_results_json, output_metadata_json, COALESCE(failure_category,''), COALESCE(error_message,''),
			started_at, ended_at, duration_ms, pre_request_script_json, test_script_json
		FROM monitor_step_runs WHERE monitor_run_id = $1 ORDER BY step_order`, runID)
	if err != nil {
		return runs.Run{}, fmt.Errorf("list step runs: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var step runs.StepRun
		var requestJSON, responseJSON, timingJSON, tlsJSON, proxyJSON, extractorJSON, assertionJSON, outputJSON, preRequestScriptJSON, testScriptJSON []byte
		var startedAt, endedAt pgtype.Timestamptz
		if err := rows.Scan(&step.ID, &step.StepDefinitionID, &step.StepOrder, &step.StepName, &step.StepType, &step.Status, &step.AttemptCount,
			&requestJSON, &responseJSON, &timingJSON, &tlsJSON, &proxyJSON, &extractorJSON, &assertionJSON, &outputJSON,
			&step.FailureCategory, &step.ErrorMessage, &startedAt, &endedAt, &step.DurationMS, &preRequestScriptJSON, &testScriptJSON); err != nil {
			return runs.Run{}, fmt.Errorf("scan step run: %w", err)
		}
		step.RunID = runID
		decodeJSON(requestJSON, &step.RequestSummary)
		decodeJSON(responseJSON, &step.ResponseSummary)
		decodeJSON(timingJSON, &step.Timing)
		decodeJSON(tlsJSON, &step.TLS)
		decodeJSON(proxyJSON, &step.Proxy)
		decodeJSON(extractorJSON, &step.Extractors)
		decodeJSON(assertionJSON, &step.Assertions)
		decodeJSON(outputJSON, &step.Outputs)
		decodeJSON(preRequestScriptJSON, &step.PreRequestScript)
		decodeJSON(testScriptJSON, &step.TestScript)
		if startedAt.Valid {
			value := startedAt.Time
			step.StartedAt = &value
		}
		if endedAt.Valid {
			value := endedAt.Time
			step.EndedAt = &value
		}
		run.Steps = append(run.Steps, step)
	}
	if len(run.Steps) > 0 {
		stepIDs := make([]string, len(run.Steps))
		stepIndex := make(map[string]int, len(run.Steps))
		for index := range run.Steps {
			stepIDs[index] = run.Steps[index].ID
			stepIndex[run.Steps[index].ID] = index
		}
		attemptRows, err := r.pool.Query(ctx, `
			SELECT step_run_id::text,id::text,attempt_number,status,COALESCE(response_status,0),
				COALESCE(failure_category,''),COALESCE(error_message,''),request_summary_json,
				response_summary_json,timing_json,tls_summary_json,proxy_summary_json,redirects_json,
				retry_backoff_ms,started_at,ended_at,duration_ms
			FROM step_attempts
			WHERE step_run_id = ANY($1::uuid[])
			ORDER BY step_run_id, attempt_number`, stepIDs)
		if err != nil {
			return runs.Run{}, err
		}
		for attemptRows.Next() {
			var stepRunID string
			var attempt runs.AttemptRun
			var requestJSON, responseJSON, timingJSON, tlsJSON, proxyJSON, redirectsJSON []byte
			if err := attemptRows.Scan(&stepRunID, &attempt.ID, &attempt.AttemptNumber, &attempt.Status, &attempt.ResponseStatus, &attempt.FailureCategory, &attempt.ErrorMessage, &requestJSON, &responseJSON, &timingJSON, &tlsJSON, &proxyJSON, &redirectsJSON, &attempt.RetryBackoffMS, &attempt.StartedAt, &attempt.EndedAt, &attempt.DurationMS); err != nil {
				attemptRows.Close()
				return runs.Run{}, err
			}
			decodeJSON(requestJSON, &attempt.RequestSummary)
			decodeJSON(responseJSON, &attempt.ResponseSummary)
			decodeJSON(timingJSON, &attempt.Timing)
			decodeJSON(tlsJSON, &attempt.TLS)
			decodeJSON(proxyJSON, &attempt.Proxy)
			decodeJSON(redirectsJSON, &attempt.Redirects)
			if index, ok := stepIndex[stepRunID]; ok {
				run.Steps[index].Attempts = append(run.Steps[index].Attempts, attempt)
			}
		}
		if err := attemptRows.Err(); err != nil {
			attemptRows.Close()
			return runs.Run{}, err
		}
		attemptRows.Close()
	}
	eventRows, err := r.pool.Query(ctx, `SELECT id::text,sequence,event_type,COALESCE(status,''),COALESCE(step_run_id::text,''),COALESCE(step_definition_id,''),COALESCE(attempt_number,0),COALESCE(category,''),message,details_json,occurred_at,duration_ms FROM run_events WHERE monitor_run_id=$1 ORDER BY sequence`, runID)
	if err != nil {
		return runs.Run{}, err
	}
	defer eventRows.Close()
	for eventRows.Next() {
		var event runs.RunEvent
		var details []byte
		if err := eventRows.Scan(&event.ID, &event.Sequence, &event.Type, &event.Status, &event.StepRunID, &event.StepID, &event.AttemptNumber, &event.Category, &event.Message, &details, &event.OccurredAt, &event.DurationMS); err != nil {
			return runs.Run{}, err
		}
		decodeJSON(details, &event.Details)
		run.Events = append(run.Events, event)
	}
	if err := eventRows.Err(); err != nil {
		return runs.Run{}, err
	}
	if len(run.Steps) == 0 && r.warmStore != nil {
		restored, restoredOK, err := r.restoreWarmEvidence(ctx, runID)
		if err != nil {
			return runs.Run{}, err
		}
		if restoredOK {
			return restored, nil
		}
	}
	return run, nil
}

func (r *RunRepository) restoreWarmEvidence(ctx context.Context, runID string) (runs.Run, bool, error) {
	var objectKey string
	err := r.pool.QueryRow(ctx, `
		SELECT object_key FROM warm_evidence_manifests
		WHERE run_id=$1 AND restore_state='AVAILABLE' AND expires_at>NOW()`, runID).Scan(&objectKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return runs.Run{}, false, nil
	}
	if err != nil {
		return runs.Run{}, false, err
	}
	reader, err := r.warmStore.Get(ctx, objectKey)
	if err != nil {
		return runs.Run{}, false, fmt.Errorf("open warm run evidence: %w", err)
	}
	defer reader.Close()
	compressed, err := gzip.NewReader(reader)
	if err != nil {
		return runs.Run{}, false, fmt.Errorf("decompress warm run evidence: %w", err)
	}
	defer compressed.Close()
	var restored runs.Run
	decoder := json.NewDecoder(io.LimitReader(compressed, 32<<20))
	if err := decoder.Decode(&restored); err != nil {
		return runs.Run{}, false, fmt.Errorf("decode warm run evidence: %w", err)
	}
	return restored, true, nil
}

func (r *RunRepository) GetSummary(ctx context.Context, runID string) (runs.Run, error) {
	run, err := scanRun(r.pool.QueryRow(ctx, `
		SELECT id::text, monitor_id::text, revision_id::text, status, trigger_type,
			COALESCE(trigger_source,''),COALESCE(agent_id::text,''),
			COALESCE(failure_category,''),COALESCE(failure_reason,''),
			COALESCE(failed_step_id,''),queue_delay_ms,warning_count,duration_ms,
			started_at,ended_at,created_at,execution_context_json,alert_impact_json,setup_script_json
		FROM monitor_runs WHERE id=$1`, runID))
	if errors.Is(err, pgx.ErrNoRows) {
		return runs.Run{}, runs.ErrNotFound
	}
	return run, err
}

func (r *RunRepository) GetDiagnosticsSummary(ctx context.Context, runID string) (runs.Run, runs.RunAnalysis, error) {
	run, err := r.GetSummary(ctx, runID)
	if err != nil {
		return runs.Run{}, runs.RunAnalysis{}, err
	}
	rows, err := r.pool.Query(ctx, `
		SELECT step_definition_id,step_name,status,attempt_count,duration_ms,timing_json
		FROM monitor_step_runs
		WHERE monitor_run_id=$1
		ORDER BY step_order`, runID)
	if err != nil {
		return runs.Run{}, runs.RunAnalysis{}, err
	}
	defer rows.Close()
	analysis := runs.RunAnalysis{}
	hasAPIResponseTiming := false
	for rows.Next() {
		var stepDefinitionID, stepName string
		var status runs.Status
		var attemptCount int
		var durationMS int64
		var timingJSON []byte
		if err := rows.Scan(&stepDefinitionID, &stepName, &status, &attemptCount, &durationMS, &timingJSON); err != nil {
			return runs.Run{}, runs.RunAnalysis{}, err
		}
		timing := map[string]any{}
		decodeJSON(timingJSON, &timing)
		apiResponseMS := metricTimingMilliseconds(timing, "apiResponseTimeMs")
		if _, recorded := timing["apiResponseTimeMs"]; recorded {
			hasAPIResponseTiming = true
		}
		analysis.StepTimeMS += durationMS
		analysis.APIResponseTimeMS += apiResponseMS
		analysis.NetworkTimeMS += metricTimingMilliseconds(timing, "networkTotalMs")
		analysis.PreparationTimeMS += metricTimingMilliseconds(timing, "preparationMs")
		analysis.PostProcessingMS += metricTimingMilliseconds(timing, "postProcessingMs")
		analysis.RetryTimeMS += metricTimingMilliseconds(timing, "retryBackoffMs")
		analysis.RetryCount += max(0, attemptCount-1)
		switch status {
		case runs.StatusFailed, runs.StatusTimedOut, runs.StatusAborted:
			analysis.FailedSteps++
		case runs.StatusSkipped:
			analysis.SkippedSteps++
		default:
			analysis.CompletedSteps++
		}
		if apiResponseMS > analysis.SlowestStepMS {
			analysis.SlowestStepID = stepDefinitionID
			analysis.SlowestStepName = stepName
			analysis.SlowestStepMS = apiResponseMS
		}
		phase, phaseMS := projectedSlowestTimingPhase(timing)
		if phaseMS > analysis.SlowestPhaseMS {
			analysis.SlowestPhase = phase
			analysis.SlowestPhaseMS = phaseMS
		}
	}
	if err := rows.Err(); err != nil {
		return runs.Run{}, runs.RunAnalysis{}, err
	}
	analysis.OverheadMS = max(int64(0), run.DurationMS-analysis.StepTimeMS)
	if hasAPIResponseTiming {
		run.APIResponseTimeMS = &analysis.APIResponseTimeMS
	}
	return run, analysis, nil
}

func projectedSlowestTimingPhase(timing map[string]any) (string, int64) {
	phase, longest := "", int64(0)
	for _, key := range []string{"dnsMs", "proxyConnectMs", "connectMs", "tlsHandshakeMs", "requestWriteMs", "serverWaitMs", "downloadMs"} {
		value := metricTimingMilliseconds(timing, key)
		if value > longest {
			phase, longest = key, value
		}
	}
	return phase, longest
}

func (r *RunRepository) GetStep(ctx context.Context, runID, stepRunID string) (runs.StepRun, error) {
	var step runs.StepRun
	var requestJSON, responseJSON, timingJSON, tlsJSON, proxyJSON, extractorJSON, assertionJSON, outputJSON, preRequestScriptJSON, testScriptJSON []byte
	var startedAt, endedAt pgtype.Timestamptz
	err := r.pool.QueryRow(ctx, `
		SELECT id::text,step_definition_id,step_order,step_name,step_type,status,attempt_count,
			request_summary_json,response_summary_json,timing_json,tls_summary_json,proxy_summary_json,
			extractor_results_json,assertion_results_json,output_metadata_json,
			COALESCE(failure_category,''),COALESCE(error_message,''),
			started_at,ended_at,duration_ms,pre_request_script_json,test_script_json
		FROM monitor_step_runs
		WHERE monitor_run_id=$1 AND id=$2`, runID, stepRunID).Scan(
		&step.ID, &step.StepDefinitionID, &step.StepOrder, &step.StepName, &step.StepType,
		&step.Status, &step.AttemptCount, &requestJSON, &responseJSON, &timingJSON,
		&tlsJSON, &proxyJSON, &extractorJSON, &assertionJSON, &outputJSON,
		&step.FailureCategory, &step.ErrorMessage, &startedAt, &endedAt, &step.DurationMS,
		&preRequestScriptJSON, &testScriptJSON,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if existsErr := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM monitor_runs WHERE id=$1)`, runID).Scan(&exists); existsErr != nil {
			return runs.StepRun{}, existsErr
		}
		return runs.StepRun{}, runs.ErrNotFound
	}
	if err != nil {
		return runs.StepRun{}, err
	}
	step.RunID = runID
	decodeJSON(requestJSON, &step.RequestSummary)
	decodeJSON(responseJSON, &step.ResponseSummary)
	decodeJSON(timingJSON, &step.Timing)
	decodeJSON(tlsJSON, &step.TLS)
	decodeJSON(proxyJSON, &step.Proxy)
	decodeJSON(extractorJSON, &step.Extractors)
	decodeJSON(assertionJSON, &step.Assertions)
	decodeJSON(outputJSON, &step.Outputs)
	decodeJSON(preRequestScriptJSON, &step.PreRequestScript)
	decodeJSON(testScriptJSON, &step.TestScript)
	if startedAt.Valid {
		value := startedAt.Time
		step.StartedAt = &value
	}
	if endedAt.Valid {
		value := endedAt.Time
		step.EndedAt = &value
	}
	attemptRows, err := r.pool.Query(ctx, `
		SELECT id::text,attempt_number,status,COALESCE(response_status,0),
			COALESCE(failure_category,''),COALESCE(error_message,''),request_summary_json,
			response_summary_json,timing_json,tls_summary_json,proxy_summary_json,redirects_json,
			retry_backoff_ms,started_at,ended_at,duration_ms
		FROM step_attempts WHERE step_run_id=$1 ORDER BY attempt_number`, stepRunID)
	if err != nil {
		return runs.StepRun{}, err
	}
	defer attemptRows.Close()
	for attemptRows.Next() {
		var attempt runs.AttemptRun
		var attemptRequestJSON, attemptResponseJSON, attemptTimingJSON, attemptTLSJSON, attemptProxyJSON, redirectsJSON []byte
		if err := attemptRows.Scan(
			&attempt.ID, &attempt.AttemptNumber, &attempt.Status, &attempt.ResponseStatus,
			&attempt.FailureCategory, &attempt.ErrorMessage, &attemptRequestJSON,
			&attemptResponseJSON, &attemptTimingJSON, &attemptTLSJSON, &attemptProxyJSON,
			&redirectsJSON, &attempt.RetryBackoffMS, &attempt.StartedAt, &attempt.EndedAt,
			&attempt.DurationMS,
		); err != nil {
			return runs.StepRun{}, err
		}
		decodeJSON(attemptRequestJSON, &attempt.RequestSummary)
		decodeJSON(attemptResponseJSON, &attempt.ResponseSummary)
		decodeJSON(attemptTimingJSON, &attempt.Timing)
		decodeJSON(attemptTLSJSON, &attempt.TLS)
		decodeJSON(attemptProxyJSON, &attempt.Proxy)
		decodeJSON(redirectsJSON, &attempt.Redirects)
		step.Attempts = append(step.Attempts, attempt)
	}
	return step, attemptRows.Err()
}

func (r *RunRepository) ListEvents(ctx context.Context, runID string, afterSequence, limit int) ([]runs.RunEvent, int, bool, error) {
	var total int
	if err := r.pool.QueryRow(ctx, `SELECT COUNT(*) FROM run_events WHERE monitor_run_id=$1`, runID).Scan(&total); err != nil {
		return nil, 0, false, err
	}
	if total == 0 {
		var exists bool
		if err := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM monitor_runs WHERE id=$1)`, runID).Scan(&exists); err != nil {
			return nil, 0, false, err
		}
		if !exists {
			return nil, 0, false, runs.ErrNotFound
		}
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id::text,sequence,event_type,COALESCE(status,''),
			COALESCE(step_run_id::text,''),COALESCE(step_definition_id,''),
			COALESCE(attempt_number,0),COALESCE(category,''),message,
			details_json,occurred_at,duration_ms
			FROM run_events
			WHERE monitor_run_id=$1 AND sequence>$2
			ORDER BY sequence
			LIMIT $3`, runID, afterSequence, limit+1)
	if err != nil {
		return nil, 0, false, err
	}
	defer rows.Close()
	events := make([]runs.RunEvent, 0, limit+1)
	for rows.Next() {
		var event runs.RunEvent
		var details []byte
		if err := rows.Scan(&event.ID, &event.Sequence, &event.Type, &event.Status,
			&event.StepRunID, &event.StepID, &event.AttemptNumber, &event.Category,
			&event.Message, &details, &event.OccurredAt, &event.DurationMS); err != nil {
			return nil, 0, false, err
		}
		decodeJSON(details, &event.Details)
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, false, err
	}
	hasMore := len(events) > limit
	if hasMore {
		events = events[:limit]
	}
	return events, total, hasMore, nil
}

func scanRun(row rowScanner) (runs.Run, error) {
	var run runs.Run
	var startedAt, endedAt pgtype.Timestamptz
	var executionContext, alertImpact, setupScript []byte
	if err := row.Scan(&run.ID, &run.MonitorID, &run.RevisionID, &run.Status, &run.TriggerType, &run.TriggerSource,
		&run.AgentID, &run.FailureCategory, &run.FailureReason, &run.FailedStepID, &run.QueueDelayMS, &run.WarningCount, &run.DurationMS,
		&startedAt, &endedAt, &run.CreatedAt, &executionContext, &alertImpact, &setupScript); err != nil {
		return runs.Run{}, err
	}
	if startedAt.Valid {
		value := startedAt.Time
		run.StartedAt = &value
	}
	if endedAt.Valid {
		value := endedAt.Time
		run.EndedAt = &value
	}
	decodeJSON(executionContext, &run.ExecutionContext)
	decodeJSON(alertImpact, &run.AlertImpact)
	decodeJSON(setupScript, &run.SetupScript)
	return run, nil
}

func (r *RunRepository) StepDurations(ctx context.Context, monitorID, revisionID, stepDefinitionID, excludeRunID string, limit int, _ bool) ([]int64, error) {
	rows, err := r.pool.Query(ctx, `SELECT (sr.timing_json->>'apiResponseTimeMs')::bigint FROM monitor_step_runs sr JOIN monitor_runs mr ON mr.id=sr.monitor_run_id WHERE mr.monitor_id=$1 AND ($2='' OR mr.revision_id::text=$2) AND sr.step_definition_id=$3 AND mr.id::text<>$4 AND mr.status='SUCCESS' AND sr.status='SUCCESS' AND sr.timing_json ? 'apiResponseTimeMs' ORDER BY mr.created_at DESC LIMIT $5`, monitorID, revisionID, stepDefinitionID, excludeRunID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := []int64{}
	for rows.Next() {
		var value int64
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func decodeJSON(value []byte, target any) {
	if len(value) > 0 && string(value) != "null" {
		_ = json.Unmarshal(value, target)
	}
}
