CREATE TABLE rhythm.alert_investigation_results (
    id UUID PRIMARY KEY,
    alert_id UUID NOT NULL REFERENCES rhythm.alerts(id) ON DELETE CASCADE,
    check_id TEXT NOT NULL,
    monitor_id UUID REFERENCES rhythm.monitors(id) ON DELETE SET NULL,
    run_id UUID REFERENCES rhythm.monitor_runs(id) ON DELETE SET NULL,
    kind TEXT NOT NULL CHECK (kind IN ('ELF_QUERY','DYNATRACE')),
    label TEXT NOT NULL DEFAULT '',
    query_id TEXT,
    application_id TEXT,
    environment_binding_id TEXT,
    service_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','PASSED','FAILED','ERROR','SKIPPED')),
    attempt INTEGER NOT NULL DEFAULT 1,
    position INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL DEFAULT '',
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_error TEXT,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (alert_id, check_id, attempt)
);
CREATE INDEX alert_investigation_results_pending_idx
    ON rhythm.alert_investigation_results (status, created_at)
    WHERE status IN ('PENDING','RUNNING');
CREATE INDEX alert_investigation_results_alert_idx
    ON rhythm.alert_investigation_results (alert_id, position, check_id, attempt DESC);
CREATE INDEX alert_investigation_results_run_idx
    ON rhythm.alert_investigation_results (run_id)
    WHERE run_id IS NOT NULL;
