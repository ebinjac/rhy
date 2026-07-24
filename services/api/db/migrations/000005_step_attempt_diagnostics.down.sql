DROP TABLE IF EXISTS step_attempts;
ALTER TABLE monitor_step_runs DROP COLUMN IF EXISTS proxy_summary_json;
ALTER TABLE monitor_step_runs DROP COLUMN IF EXISTS tls_summary_json;
