DROP INDEX IF EXISTS deployment_validation_runs_active_idx;
DROP INDEX IF EXISTS execution_jobs_deployment_run_idx;
ALTER TABLE execution_jobs DROP COLUMN IF EXISTS deployment_run_id;
ALTER TABLE deployment_validation_runs DROP COLUMN IF EXISTS cancel_requested_at;

