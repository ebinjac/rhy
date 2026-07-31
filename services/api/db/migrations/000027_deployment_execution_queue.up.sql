ALTER TABLE deployment_validation_runs
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;

ALTER TABLE execution_jobs
    ADD COLUMN IF NOT EXISTS deployment_run_id UUID
        REFERENCES deployment_validation_runs(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS execution_jobs_deployment_run_idx
    ON execution_jobs (deployment_run_id)
    WHERE deployment_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS deployment_validation_runs_active_idx
    ON deployment_validation_runs (status, updated_at)
    WHERE status IN (
        'QUEUED', 'RUNNING', 'CAPTURING_BASELINE', 'SAMPLING_MONITORS',
        'SAMPLING_BROWSER_MONITORS', 'WAITING_FOR_STABILIZATION',
        'RUNNING_DYNATRACE', 'RUNNING_ELF', 'CHECKING_ALERTS', 'ANALYZING',
        'CANCELLING'
    );

