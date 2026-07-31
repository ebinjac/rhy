DROP INDEX IF EXISTS browser_runs_active_idx;
DROP INDEX IF EXISTS execution_jobs_browser_run_idx;
ALTER TABLE execution_jobs DROP COLUMN IF EXISTS browser_run_id;
ALTER TABLE browser_runs DROP COLUMN IF EXISTS cancel_requested_at;

