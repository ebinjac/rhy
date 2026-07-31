ALTER TABLE validation_suite_runs
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;

ALTER TABLE execution_jobs
    ADD COLUMN IF NOT EXISTS suite_run_id UUID
        REFERENCES validation_suite_runs(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS execution_jobs_suite_run_idx
    ON execution_jobs (suite_run_id)
    WHERE suite_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS validation_suite_runs_active_idx
    ON validation_suite_runs (status, created_at)
    WHERE status IN ('QUEUED', 'RUNNING', 'CANCELLING');
