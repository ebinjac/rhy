CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

ALTER TABLE monitor_runs
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS terminal_processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS api_response_time_ms BIGINT,
    ADD COLUMN IF NOT EXISTS preparation_time_ms BIGINT,
    ADD COLUMN IF NOT EXISTS post_processing_time_ms BIGINT,
    ADD COLUMN IF NOT EXISTS network_time_ms BIGINT,
    ADD COLUMN IF NOT EXISTS retry_backoff_time_ms BIGINT,
    ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE execution_job_outbox
    ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS alerts_operational_filter_idx
    ON alerts (state, severity, source_type, application_id, service_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_filter_idx
    ON audit_events (outcome, action, created_at DESC);
CREATE INDEX IF NOT EXISTS elf_runs_operational_filter_idx
    ON elf_runs (application_id, service_id, status, decision, created_at DESC);
CREATE INDEX IF NOT EXISTS dynatrace_runs_operational_filter_idx
    ON dynatrace_runs (environment_binding_id, service_id, status, decision, created_at DESC);
CREATE INDEX IF NOT EXISTS browser_runs_operational_filter_idx
    ON browser_runs (status, trigger_type, created_at DESC, monitor_id);
CREATE INDEX IF NOT EXISTS deployment_validation_runs_filter_idx
    ON deployment_validation_runs (status, gate_decision, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_deliveries_claim_idx
    ON notification_deliveries (next_attempt_at, created_at)
    WHERE status IN ('PENDING', 'RETRY');
