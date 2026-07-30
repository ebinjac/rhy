package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rhythm-monitoring/rhythm/internal/id"
	"github.com/rhythm-monitoring/rhythm/internal/notifications"
	"github.com/rhythm-monitoring/rhythm/internal/runs"
)

type RunRepository struct{ pool *pgxpool.Pool }

func NewRunRepository(pool *pgxpool.Pool) *RunRepository { return &RunRepository{pool: pool} }

func (r *RunRepository) Save(ctx context.Context, run runs.Run) error {
	transaction, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin run persistence: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.Background()) }()
	executionContext, _ := json.Marshal(run.ExecutionContext)
	alertImpact, _ := json.Marshal(run.AlertImpact)
	setupScript, _ := json.Marshal(run.SetupScript)
	_, err = transaction.Exec(ctx, `
		INSERT INTO monitor_runs (id, monitor_id, revision_id, status, trigger_type, trigger_source, agent_id,
			failure_category, failure_reason, failed_step_id, queue_delay_ms, warning_count, duration_ms, started_at, ended_at, created_at, execution_context_json, alert_impact_json, setup_script_json)
		VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,'')::uuid,NULLIF($8,''),NULLIF($9,''),NULLIF($10,''),$11,$12,$13,$14,$15,$16,$17,$18,$19)
		ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status, trigger_source=EXCLUDED.trigger_source, agent_id=EXCLUDED.agent_id,
		failure_category=EXCLUDED.failure_category, failure_reason=EXCLUDED.failure_reason, failed_step_id=EXCLUDED.failed_step_id,
		queue_delay_ms=EXCLUDED.queue_delay_ms, warning_count=EXCLUDED.warning_count, duration_ms=EXCLUDED.duration_ms,
		started_at=EXCLUDED.started_at, ended_at=EXCLUDED.ended_at, execution_context_json=EXCLUDED.execution_context_json,
		alert_impact_json=EXCLUDED.alert_impact_json, setup_script_json=EXCLUDED.setup_script_json`,
		run.ID, run.MonitorID, run.RevisionID, run.Status, run.TriggerType, run.TriggerSource,
		run.AgentID, run.FailureCategory, run.FailureReason, run.FailedStepID, run.QueueDelayMS, run.WarningCount, run.DurationMS, run.StartedAt, run.EndedAt, run.CreatedAt, executionContext, alertImpact, setupScript)
	if err != nil {
		return fmt.Errorf("insert monitor run: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM run_events WHERE monitor_run_id=$1`, run.ID); err != nil {
		return fmt.Errorf("replace run events: %w", err)
	}
	if _, err := transaction.Exec(ctx, `DELETE FROM monitor_step_runs WHERE monitor_run_id=$1`, run.ID); err != nil {
		return fmt.Errorf("replace run steps: %w", err)
	}
	for _, step := range run.Steps {
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
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NULLIF($17,''),NULLIF($18,''),$19,$20,$21,$22,$23)`,
			step.ID, run.ID, step.StepDefinitionID, step.StepOrder, step.StepName, step.StepType, step.Status,
			max(step.AttemptCount, 1), requestSummary, responseSummary, timing, tlsSummary, proxySummary, extractors, assertions, outputs, step.FailureCategory,
			step.ErrorMessage, step.StartedAt, step.EndedAt, step.DurationMS, preRequestScript, testScript)
		if err != nil {
			return fmt.Errorf("insert monitor step run: %w", err)
		}
		for _, attempt := range step.Attempts {
			attemptRequest, _ := json.Marshal(attempt.RequestSummary)
			attemptResponse, _ := json.Marshal(attempt.ResponseSummary)
			attemptTiming, _ := json.Marshal(attempt.Timing)
			attemptTLS, _ := json.Marshal(attempt.TLS)
			attemptProxy, _ := json.Marshal(attempt.Proxy)
			redirects, _ := json.Marshal(attempt.Redirects)
			_, err := transaction.Exec(ctx, `INSERT INTO step_attempts(id,step_run_id,attempt_number,status,response_status,failure_category,error_message,request_summary_json,response_summary_json,timing_json,tls_summary_json,proxy_summary_json,redirects_json,retry_backoff_ms,started_at,ended_at,duration_ms)VALUES($1,$2,$3,$4,NULLIF($5,0),NULLIF($6,''),NULLIF($7,''),$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, attempt.ID, step.ID, attempt.AttemptNumber, attempt.Status, attempt.ResponseStatus, attempt.FailureCategory, attempt.ErrorMessage, attemptRequest, attemptResponse, attemptTiming, attemptTLS, attemptProxy, redirects, attempt.RetryBackoffMS, attempt.StartedAt, attempt.EndedAt, attempt.DurationMS)
			if err != nil {
				return fmt.Errorf("insert step attempt: %w", err)
			}
		}
	}
	for _, event := range run.Events {
		details, _ := json.Marshal(event.Details)
		_, err := transaction.Exec(ctx, `INSERT INTO run_events(id,monitor_run_id,step_run_id,sequence,event_type,status,step_definition_id,attempt_number,category,message,details_json,occurred_at,duration_ms)VALUES($1,$2,NULLIF($3,'')::uuid,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,0),NULLIF($9,''),$10,$11,$12,$13)`, event.ID, run.ID, event.StepRunID, event.Sequence, event.Type, event.Status, event.StepID, event.AttemptNumber, event.Category, event.Message, details, event.OccurredAt, event.DurationMS)
		if err != nil {
			return fmt.Errorf("insert run event: %w", err)
		}
	}
	if run.TriggerType != "MANUAL_DRAFT" && isTerminal(run.Status) {
		if err := evaluateAlertState(ctx, transaction, run); err != nil {
			return fmt.Errorf("evaluate alert state: %w", err)
		}
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit run persistence: %w", err)
	}
	return nil
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
	for index := range run.Steps {
		attemptRows, err := r.pool.Query(ctx, `SELECT id::text,attempt_number,status,COALESCE(response_status,0),COALESCE(failure_category,''),COALESCE(error_message,''),request_summary_json,response_summary_json,timing_json,tls_summary_json,proxy_summary_json,redirects_json,retry_backoff_ms,started_at,ended_at,duration_ms FROM step_attempts WHERE step_run_id=$1 ORDER BY attempt_number`, run.Steps[index].ID)
		if err != nil {
			return runs.Run{}, err
		}
		for attemptRows.Next() {
			var attempt runs.AttemptRun
			var requestJSON, responseJSON, timingJSON, tlsJSON, proxyJSON, redirectsJSON []byte
			if err := attemptRows.Scan(&attempt.ID, &attempt.AttemptNumber, &attempt.Status, &attempt.ResponseStatus, &attempt.FailureCategory, &attempt.ErrorMessage, &requestJSON, &responseJSON, &timingJSON, &tlsJSON, &proxyJSON, &redirectsJSON, &attempt.RetryBackoffMS, &attempt.StartedAt, &attempt.EndedAt, &attempt.DurationMS); err != nil {
				attemptRows.Close()
				return runs.Run{}, err
			}
			decodeJSON(requestJSON, &attempt.RequestSummary)
			decodeJSON(responseJSON, &attempt.ResponseSummary)
			decodeJSON(timingJSON, &attempt.Timing)
			decodeJSON(tlsJSON, &attempt.TLS)
			decodeJSON(proxyJSON, &attempt.Proxy)
			decodeJSON(redirectsJSON, &attempt.Redirects)
			run.Steps[index].Attempts = append(run.Steps[index].Attempts, attempt)
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
	return run, eventRows.Err()
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
