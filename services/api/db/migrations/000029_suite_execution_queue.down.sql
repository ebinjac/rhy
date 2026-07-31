DROP INDEX IF EXISTS validation_suite_runs_active_idx;
DROP INDEX IF EXISTS execution_jobs_suite_run_idx;
ALTER TABLE execution_jobs DROP COLUMN IF EXISTS suite_run_id;
ALTER TABLE validation_suite_runs DROP COLUMN IF EXISTS cancel_requested_at;
