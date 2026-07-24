ALTER TABLE monitor_step_runs DROP COLUMN IF EXISTS pre_request_script_json;
ALTER TABLE monitor_runs DROP COLUMN IF EXISTS setup_script_json;
