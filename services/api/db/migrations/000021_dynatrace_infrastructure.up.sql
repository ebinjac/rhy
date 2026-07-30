CREATE TABLE application_environment_bindings (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    environment_profile_id UUID NOT NULL REFERENCES configuration_profiles(id),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(application_id, environment_profile_id)
);

CREATE TABLE dynatrace_application_configs (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    environment_binding_id UUID NOT NULL REFERENCES application_environment_bindings(id) ON DELETE CASCADE,
    connection_profile_id UUID NOT NULL REFERENCES configuration_profiles(id),
    credential_secret_ref TEXT NOT NULL DEFAULT '',
    platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
    management_zones JSONB NOT NULL DEFAULT '[]'::jsonb,
    metric_mappings JSONB NOT NULL DEFAULT '{}'::jsonb,
    baseline_window_seconds INTEGER NOT NULL DEFAULT 86400,
    stabilization_seconds INTEGER NOT NULL DEFAULT 600,
    post_window_seconds INTEGER NOT NULL DEFAULT 900,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    revision_number INTEGER NOT NULL DEFAULT 1,
    last_test_status TEXT NOT NULL DEFAULT 'NOT_TESTED',
    last_test_error TEXT NOT NULL DEFAULT '',
    last_test_at TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(application_id, environment_binding_id)
);

CREATE TABLE dynatrace_service_configs (
    id UUID PRIMARY KEY,
    application_config_id UUID NOT NULL REFERENCES dynatrace_application_configs(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES application_services(id) ON DELETE CASCADE,
    credential_secret_ref TEXT NOT NULL DEFAULT '',
    platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
    management_zones JSONB NOT NULL DEFAULT '[]'::jsonb,
    metric_mappings JSONB NOT NULL DEFAULT '{}'::jsonb,
    inherit_resources BOOLEAN NOT NULL DEFAULT TRUE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(application_config_id, service_id)
);

CREATE TABLE dynatrace_resource_mappings (
    id UUID PRIMARY KEY,
    application_config_id UUID NOT NULL REFERENCES dynatrace_application_configs(id) ON DELETE CASCADE,
    service_id UUID REFERENCES application_services(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    mapping_type TEXT NOT NULL,
    value TEXT NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE dynatrace_rules (
    id UUID PRIMARY KEY,
    application_config_id UUID NOT NULL REFERENCES dynatrace_application_configs(id) ON DELETE CASCADE,
    service_id UUID REFERENCES application_services(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    metric TEXT NOT NULL,
    statistic TEXT NOT NULL,
    operator TEXT NOT NULL,
    threshold DOUBLE PRECISION NOT NULL,
    comparison TEXT NOT NULL DEFAULT 'ABSOLUTE',
    scope TEXT NOT NULL DEFAULT 'SERVICE',
    gate_mode TEXT NOT NULL DEFAULT 'ADVISORY',
    minimum_coverage_percent DOUBLE PRECISION,
    consecutive_points INTEGER NOT NULL DEFAULT 1,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE dynatrace_config_revisions (
    id UUID PRIMARY KEY,
    application_config_id UUID NOT NULL REFERENCES dynatrace_application_configs(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    snapshot JSONB NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(application_config_id, revision_number)
);

CREATE TABLE dynatrace_runs (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    environment_binding_id UUID NOT NULL REFERENCES application_environment_bindings(id) ON DELETE CASCADE,
    application_config_id UUID NOT NULL REFERENCES dynatrace_application_configs(id) ON DELETE CASCADE,
    config_revision_id UUID REFERENCES dynatrace_config_revisions(id) ON DELETE SET NULL,
    service_id UUID REFERENCES application_services(id) ON DELETE SET NULL,
    deployment_run_id UUID REFERENCES deployment_validation_runs(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    decision TEXT NOT NULL DEFAULT 'PENDING',
    platform TEXT NOT NULL DEFAULT '',
    time_from TIMESTAMPTZ NOT NULL,
    time_to TIMESTAMPTZ NOT NULL,
    resource_count INTEGER NOT NULL DEFAULT 0,
    covered_resource_count INTEGER NOT NULL DEFAULT 0,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    resources JSONB NOT NULL DEFAULT '[]'::jsonb,
    rule_results JSONB NOT NULL DEFAULT '[]'::jsonb,
    request_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_category TEXT NOT NULL DEFAULT '',
    failure_reason TEXT NOT NULL DEFAULT '',
    correlation_id TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX application_environment_bindings_app_idx
    ON application_environment_bindings(application_id, updated_at DESC);
CREATE INDEX dynatrace_configs_app_environment_idx
    ON dynatrace_application_configs(application_id, environment_binding_id);
CREATE INDEX dynatrace_resource_mappings_config_service_idx
    ON dynatrace_resource_mappings(application_config_id, service_id);
CREATE INDEX dynatrace_rules_config_service_idx
    ON dynatrace_rules(application_config_id, service_id);
CREATE INDEX dynatrace_runs_application_created_idx
    ON dynatrace_runs(application_id, created_at DESC);
CREATE INDEX dynatrace_runs_deployment_idx
    ON dynatrace_runs(deployment_run_id) WHERE deployment_run_id IS NOT NULL;
