ALTER TABLE monitor_runs ADD COLUMN queue_delay_ms BIGINT NOT NULL DEFAULT 0;
ALTER TABLE monitor_runs ADD COLUMN execution_context_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE monitor_runs ADD COLUMN alert_impact_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE step_attempts ADD COLUMN request_summary_json JSONB;
ALTER TABLE step_attempts ADD COLUMN response_summary_json JSONB;
ALTER TABLE step_attempts ADD COLUMN timing_json JSONB;
ALTER TABLE step_attempts ADD COLUMN tls_summary_json JSONB;
ALTER TABLE step_attempts ADD COLUMN proxy_summary_json JSONB;
ALTER TABLE step_attempts ADD COLUMN redirects_json JSONB;
ALTER TABLE step_attempts ADD COLUMN retry_backoff_ms BIGINT NOT NULL DEFAULT 0;

CREATE TABLE run_events (
    id UUID PRIMARY KEY,
    monitor_run_id UUID NOT NULL REFERENCES monitor_runs(id) ON DELETE CASCADE,
    step_run_id UUID REFERENCES monitor_step_runs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    status VARCHAR(50),
    step_definition_id VARCHAR(255),
    attempt_number INTEGER,
    category VARCHAR(100),
    message TEXT NOT NULL,
    details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    UNIQUE (monitor_run_id, sequence)
);

CREATE INDEX run_events_run_sequence_idx ON run_events(monitor_run_id, sequence);
CREATE INDEX monitor_step_runs_baseline_idx ON monitor_step_runs(step_definition_id, monitor_run_id, duration_ms);
