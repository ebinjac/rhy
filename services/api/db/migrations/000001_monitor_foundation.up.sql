CREATE TABLE environments (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    variables_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE monitors (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    owner_id VARCHAR(255),
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    environment_id UUID REFERENCES environments(id) ON DELETE SET NULL,
    agent_group_id UUID,
    state VARCHAR(50) NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'PUBLISHED', 'ENABLED', 'DISABLED', 'ARCHIVED')),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    current_draft_revision_id UUID,
    latest_published_revision_id UUID,
    deleted_at TIMESTAMPTZ,
    created_by VARCHAR(255) NOT NULL,
    updated_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE monitor_revisions (
    id UUID PRIMARY KEY,
    monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL CHECK (revision_number > 0),
    status VARCHAR(50) NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED')),
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    definition_json JSONB NOT NULL,
    change_summary TEXT,
    published_by VARCHAR(255),
    published_at TIMESTAMPTZ,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (monitor_id, revision_number)
);

ALTER TABLE monitors
    ADD CONSTRAINT monitors_current_draft_revision_fk
        FOREIGN KEY (current_draft_revision_id) REFERENCES monitor_revisions(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT monitors_latest_published_revision_fk
        FOREIGN KEY (latest_published_revision_id) REFERENCES monitor_revisions(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE monitor_schedules (
    id UUID PRIMARY KEY,
    monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    schedule_type VARCHAR(50) NOT NULL CHECK (schedule_type IN ('CRON', 'INTERVAL', 'MANUAL')),
    expression VARCHAR(255),
    interval_seconds INTEGER CHECK (interval_seconds > 0),
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    jitter_seconds INTEGER NOT NULL DEFAULT 0 CHECK (jitter_seconds >= 0),
    concurrency_policy VARCHAR(50) NOT NULL DEFAULT 'SKIP_IF_RUNNING' CHECK (concurrency_policy IN ('SKIP_IF_RUNNING', 'QUEUE', 'ALLOW')),
    missed_run_policy VARCHAR(50) NOT NULL DEFAULT 'SKIP' CHECK (missed_run_policy IN ('SKIP', 'RUN_ONCE')),
    next_run_at TIMESTAMPTZ,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (schedule_type = 'CRON' AND expression IS NOT NULL AND interval_seconds IS NULL) OR
        (schedule_type = 'INTERVAL' AND interval_seconds IS NOT NULL AND expression IS NULL) OR
        (schedule_type = 'MANUAL' AND expression IS NULL AND interval_seconds IS NULL)
    )
);

CREATE TABLE audit_events (
    id UUID PRIMARY KEY,
    actor_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    outcome VARCHAR(50) NOT NULL,
    before_summary_json JSONB,
    after_summary_json JSONB,
    correlation_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX monitors_state_idx ON monitors (state) WHERE deleted_at IS NULL;
CREATE INDEX monitors_environment_idx ON monitors (environment_id) WHERE deleted_at IS NULL;
CREATE INDEX monitor_revisions_monitor_created_idx ON monitor_revisions (monitor_id, created_at DESC);
CREATE UNIQUE INDEX monitor_revisions_one_draft_idx ON monitor_revisions (monitor_id) WHERE status = 'DRAFT';
CREATE UNIQUE INDEX monitor_schedules_one_active_idx ON monitor_schedules (monitor_id) WHERE active = TRUE;
CREATE INDEX monitor_schedules_due_idx ON monitor_schedules (next_run_at) WHERE active = TRUE;
CREATE INDEX audit_events_resource_idx ON audit_events (resource_type, resource_id, created_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_id, created_at DESC);
