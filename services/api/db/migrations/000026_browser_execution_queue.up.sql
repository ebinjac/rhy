ALTER TABLE browser_runs
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;

ALTER TABLE execution_jobs
    ADD COLUMN IF NOT EXISTS browser_run_id UUID REFERENCES browser_runs(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS execution_jobs_browser_run_idx
    ON execution_jobs (browser_run_id)
    WHERE browser_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS browser_runs_active_idx
    ON browser_runs (status, created_at)
    WHERE status IN ('QUEUED', 'STARTING', 'RUNNING', 'ANALYZING');

