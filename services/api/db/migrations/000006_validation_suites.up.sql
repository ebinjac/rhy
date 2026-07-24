CREATE TABLE validation_suites (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    environment TEXT NOT NULL DEFAULT '',
    stages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    parallelism INTEGER NOT NULL DEFAULT 1 CHECK (parallelism BETWEEN 1 AND 20),
    fail_fast BOOLEAN NOT NULL DEFAULT TRUE,
    timeout_seconds INTEGER NOT NULL DEFAULT 900 CHECK (timeout_seconds BETWEEN 1 AND 86400),
    baseline_policy TEXT NOT NULL DEFAULT 'NONE',
    notification_policy TEXT NOT NULL DEFAULT 'NONE',
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE validation_suite_runs (
    id UUID PRIMARY KEY,
    suite_id UUID NOT NULL REFERENCES validation_suites(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    gate_decision TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    trigger_source TEXT,
    results_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX validation_suite_runs_suite_created_idx ON validation_suite_runs (suite_id, created_at DESC);
