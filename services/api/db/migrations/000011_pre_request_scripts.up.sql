ALTER TABLE monitor_runs ADD COLUMN setup_script_json JSONB;
ALTER TABLE monitor_step_runs ADD COLUMN pre_request_script_json JSONB;
