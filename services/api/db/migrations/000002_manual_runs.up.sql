CREATE TABLE monitor_runs (
    id UUID PRIMARY KEY,
    monitor_id UUID NOT NULL REFERENCES monitors(id),
    revision_id UUID NOT NULL REFERENCES monitor_revisions(id),
    status VARCHAR(50) NOT NULL CHECK (status IN ('QUEUED', 'STARTING', 'RUNNING', 'SUCCESS', 'SUCCESS_WITH_WARNINGS', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'ABORTED', 'SKIPPED')),
    trigger_type VARCHAR(50) NOT NULL,
    trigger_source VARCHAR(255),
    idempotency_key VARCHAR(255),
    failure_category VARCHAR(100),
    failure_reason TEXT,
    failed_step_id VARCHAR(255),
    warning_count INTEGER NOT NULL DEFAULT 0,
    duration_ms BIGINT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX monitor_runs_idempotency_idx ON monitor_runs (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX monitor_runs_monitor_created_idx ON monitor_runs (monitor_id, created_at DESC);

CREATE TABLE monitor_step_runs (
    id UUID PRIMARY KEY,
    monitor_run_id UUID NOT NULL REFERENCES monitor_runs(id) ON DELETE CASCADE,
    step_definition_id VARCHAR(255) NOT NULL,
    step_order INTEGER NOT NULL,
    step_name VARCHAR(255) NOT NULL,
    step_type VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 1,
    request_summary_json JSONB,
    response_summary_json JSONB,
    timing_json JSONB,
    extractor_results_json JSONB,
    assertion_results_json JSONB,
    output_metadata_json JSONB,
    failure_category VARCHAR(100),
    error_message TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_ms BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX monitor_step_runs_run_order_idx ON monitor_step_runs (monitor_run_id, step_order);
