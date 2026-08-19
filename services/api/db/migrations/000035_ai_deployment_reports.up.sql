CREATE TABLE rhythm.ai_deployment_reports (
    id UUID PRIMARY KEY,
    deployment_run_id UUID NOT NULL UNIQUE REFERENCES rhythm.deployment_validation_runs(id) ON DELETE CASCADE,
    markdown TEXT NOT NULL,
    provider_name TEXT NOT NULL DEFAULT '',
    model_name TEXT NOT NULL DEFAULT '',
    generated_by TEXT NOT NULL DEFAULT '',
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_deployment_reports_generated_idx
    ON rhythm.ai_deployment_reports (generated_at DESC);
