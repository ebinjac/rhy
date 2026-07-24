CREATE TABLE deployment_validation_runs (
    id UUID PRIMARY KEY,
    suite_id UUID NOT NULL REFERENCES validation_suites(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    gate_decision TEXT NOT NULL DEFAULT 'PENDING',
    progress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    deployment_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    configuration_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    suite_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_reason TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    baseline_started_at TIMESTAMPTZ,
    baseline_ended_at TIMESTAMPTZ,
    sampling_started_at TIMESTAMPTZ,
    sampling_ended_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE deployment_validation_samples (
    id UUID PRIMARY KEY,
    deployment_run_id UUID NOT NULL REFERENCES deployment_validation_runs(id) ON DELETE CASCADE,
    monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    monitor_run_id UUID REFERENCES monitor_runs(id) ON DELETE SET NULL,
    sample_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    failure_category TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(deployment_run_id, monitor_id, sample_number)
);

CREATE INDEX deployment_validation_runs_suite_created_idx ON deployment_validation_runs(suite_id, created_at DESC);
CREATE INDEX deployment_validation_runs_status_created_idx ON deployment_validation_runs(status, created_at DESC);
CREATE INDEX deployment_validation_runs_deployment_id_idx ON deployment_validation_runs((deployment_json->>'deploymentId')) WHERE deployment_json->>'deploymentId' <> '';
CREATE INDEX deployment_validation_runs_application_idx ON deployment_validation_runs((deployment_json->>'applicationId'), created_at DESC);
CREATE INDEX deployment_validation_samples_monitor_idx ON deployment_validation_samples(monitor_id, created_at DESC);
CREATE INDEX deployment_validation_samples_monitor_run_idx ON deployment_validation_samples(monitor_run_id) WHERE monitor_run_id IS NOT NULL;
