ALTER TABLE monitor_step_runs ADD COLUMN tls_summary_json JSONB;
ALTER TABLE monitor_step_runs ADD COLUMN proxy_summary_json JSONB;

CREATE TABLE step_attempts (
    id UUID PRIMARY KEY,
    step_run_id UUID NOT NULL REFERENCES monitor_step_runs(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL,
    response_status INTEGER,
    failure_category VARCHAR(100),
    error_message TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    duration_ms BIGINT NOT NULL,
    UNIQUE (step_run_id, attempt_number)
);
CREATE INDEX step_attempts_step_idx ON step_attempts(step_run_id, attempt_number);
