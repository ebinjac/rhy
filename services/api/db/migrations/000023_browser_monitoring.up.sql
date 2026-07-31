CREATE TABLE browser_monitors (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
    service_id UUID REFERENCES application_services(id) ON DELETE SET NULL,
    environment_profile_id UUID REFERENCES configuration_profiles(id) ON DELETE SET NULL,
    state TEXT NOT NULL DEFAULT 'DRAFT',
    health TEXT NOT NULL DEFAULT 'NO_SIGNAL',
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    current_draft_revision_id UUID,
    latest_published_revision_id UUID,
    frequency_seconds INTEGER NOT NULL DEFAULT 900 CHECK (frequency_seconds BETWEEN 60 AND 2592000),
    next_run_at TIMESTAMPTZ,
    last_run_at TIMESTAMPTZ,
    last_status TEXT NOT NULL DEFAULT '',
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE browser_monitor_revisions (
    id UUID PRIMARY KEY,
    monitor_id UUID NOT NULL REFERENCES browser_monitors(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    schema_version INTEGER NOT NULL DEFAULT 1,
    definition JSONB NOT NULL,
    change_summary TEXT NOT NULL DEFAULT '',
    published_by TEXT NOT NULL DEFAULT '',
    published_at TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(monitor_id, revision_number)
);

ALTER TABLE browser_monitors
    ADD CONSTRAINT browser_monitors_draft_revision_fk
    FOREIGN KEY (current_draft_revision_id) REFERENCES browser_monitor_revisions(id) ON DELETE SET NULL;

ALTER TABLE browser_monitors
    ADD CONSTRAINT browser_monitors_published_revision_fk
    FOREIGN KEY (latest_published_revision_id) REFERENCES browser_monitor_revisions(id) ON DELETE SET NULL;

CREATE TABLE browser_runs (
    id UUID PRIMARY KEY,
    monitor_id UUID NOT NULL REFERENCES browser_monitors(id) ON DELETE CASCADE,
    revision_id UUID NOT NULL REFERENCES browser_monitor_revisions(id) ON DELETE RESTRICT,
    status TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    trigger_source TEXT NOT NULL DEFAULT '',
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    browser_name TEXT NOT NULL DEFAULT 'chromium',
    browser_version TEXT NOT NULL DEFAULT '',
    agent_image_version TEXT NOT NULL DEFAULT '',
    viewport JSONB NOT NULL DEFAULT '{}'::jsonb,
    execution_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    graph_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    visual_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    network_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    console_events JSONB NOT NULL DEFAULT '[]'::jsonb,
    events JSONB NOT NULL DEFAULT '[]'::jsonb,
    failure_category TEXT NOT NULL DEFAULT '',
    failure_reason TEXT NOT NULL DEFAULT '',
    failed_step_id TEXT NOT NULL DEFAULT '',
    queue_delay_ms BIGINT NOT NULL DEFAULT 0,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE browser_step_runs (
    id UUID PRIMARY KEY,
    browser_run_id UUID NOT NULL REFERENCES browser_runs(id) ON DELETE CASCADE,
    step_definition_id TEXT NOT NULL,
    step_order INTEGER NOT NULL,
    name TEXT NOT NULL,
    step_type TEXT NOT NULL,
    status TEXT NOT NULL,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    locator_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    check_results JSONB NOT NULL DEFAULT '[]'::jsonb,
    timing JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_category TEXT NOT NULL DEFAULT '',
    failure_reason TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ
);

CREATE TABLE browser_artifacts (
    id UUID PRIMARY KEY,
    browser_run_id UUID REFERENCES browser_runs(id) ON DELETE CASCADE,
    monitor_id UUID NOT NULL REFERENCES browser_monitors(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    byte_size BIGINT NOT NULL,
    capture_state TEXT NOT NULL DEFAULT 'CAPTURED',
    masked BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE browser_visual_baselines (
    id UUID PRIMARY KEY,
    monitor_id UUID NOT NULL REFERENCES browser_monitors(id) ON DELETE CASCADE,
    revision_id UUID NOT NULL REFERENCES browser_monitor_revisions(id) ON DELETE CASCADE,
    checkpoint_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    artifact_id UUID NOT NULL REFERENCES browser_artifacts(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'PROPOSED',
    browser_version TEXT NOT NULL DEFAULT '',
    agent_image_version TEXT NOT NULL DEFAULT '',
    viewport JSONB NOT NULL DEFAULT '{}'::jsonb,
    approved_by TEXT NOT NULL DEFAULT '',
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE browser_auth_sessions (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    application_id UUID REFERENCES applications(id) ON DELETE CASCADE,
    environment_profile_id UUID REFERENCES configuration_profiles(id) ON DELETE SET NULL,
    mode TEXT NOT NULL,
    allowed_origins JSONB NOT NULL DEFAULT '[]'::jsonb,
    encrypted_state BYTEA,
    status TEXT NOT NULL DEFAULT 'NOT_CAPTURED',
    expires_at TIMESTAMPTZ,
    last_validated_at TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE alerts
    ADD COLUMN browser_monitor_id UUID REFERENCES browser_monitors(id) ON DELETE CASCADE;
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_source_type_check;
ALTER TABLE alerts
    ADD CONSTRAINT alerts_source_type_check
    CHECK (source_type IN ('RHYTHM_MONITOR', 'RHYTHM_BROWSER_MONITOR', 'OPENSEARCH_ALERTING'));

CREATE INDEX browser_monitors_schedule_idx
    ON browser_monitors(next_run_at) WHERE enabled = TRUE;
CREATE INDEX browser_monitors_application_idx
    ON browser_monitors(application_id, updated_at DESC);
CREATE INDEX browser_revisions_monitor_idx
    ON browser_monitor_revisions(monitor_id, revision_number DESC);
CREATE INDEX browser_runs_monitor_created_idx
    ON browser_runs(monitor_id, created_at DESC);
CREATE INDEX browser_runs_metrics_baseline_idx
    ON browser_runs(monitor_id, revision_id, browser_version, created_at DESC)
    WHERE status IN ('SUCCESS', 'SUCCESS_WITH_WARNINGS');
CREATE INDEX browser_step_runs_run_order_idx
    ON browser_step_runs(browser_run_id, step_order);
CREATE INDEX browser_artifacts_expiry_idx
    ON browser_artifacts(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX browser_baselines_lookup_idx
    ON browser_visual_baselines(monitor_id, checkpoint_id, status);
CREATE UNIQUE INDEX browser_baselines_approved_unique_idx
    ON browser_visual_baselines(monitor_id, fingerprint)
    WHERE status = 'APPROVED';
CREATE INDEX alerts_browser_monitor_idx
    ON alerts(browser_monitor_id, updated_at DESC)
    WHERE browser_monitor_id IS NOT NULL;
