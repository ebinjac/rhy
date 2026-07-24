CREATE TABLE elf_settings (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    base_url TEXT NOT NULL,
    dashboard_url TEXT NOT NULL DEFAULT '',
    default_index_pattern TEXT NOT NULL,
    timeout_seconds INTEGER NOT NULL DEFAULT 10 CHECK (timeout_seconds BETWEEN 1 AND 30),
    allowed_index_patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
    tls_profile_id UUID,
    proxy_profile_id UUID,
    auth_mode TEXT NOT NULL DEFAULT 'NONE',
    username TEXT NOT NULL DEFAULT '',
    credential_secret_ref TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE applications (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    owner TEXT NOT NULL DEFAULT '',
    environment TEXT NOT NULL DEFAULT '',
    default_index_pattern TEXT NOT NULL DEFAULT '',
    default_time_field TEXT NOT NULL DEFAULT '@timestamp',
    masking_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
    semantic_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE application_services (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    index_pattern TEXT NOT NULL DEFAULT '',
    time_field TEXT NOT NULL DEFAULT '',
    semantic_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(application_id, name)
);

CREATE TABLE application_monitor_links (
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(application_id, monitor_id)
);

CREATE TABLE elf_queries (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    application_id UUID NOT NULL REFERENCES applications(id),
    service_id UUID REFERENCES application_services(id),
    index_override TEXT NOT NULL DEFAULT '',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    current_revision_id UUID,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE elf_query_revisions (
    id UUID PRIMARY KEY,
    query_id UUID NOT NULL REFERENCES elf_queries(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    search_body JSONB NOT NULL,
    default_window_seconds INTEGER NOT NULL DEFAULT 900 CHECK (default_window_seconds BETWEEN 60 AND 2592000),
    check_kind TEXT NOT NULL DEFAULT 'HIT_COUNT',
    criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    gate_mode TEXT NOT NULL DEFAULT 'BLOCKING',
    discovered_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
    semantic_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(query_id, revision_number)
);

ALTER TABLE elf_queries ADD CONSTRAINT elf_queries_current_revision_fk
    FOREIGN KEY (current_revision_id) REFERENCES elf_query_revisions(id);

CREATE TABLE elf_runs (
    id UUID PRIMARY KEY,
    query_id UUID REFERENCES elf_queries(id) ON DELETE SET NULL,
    revision_id UUID REFERENCES elf_query_revisions(id) ON DELETE SET NULL,
    suite_run_id UUID REFERENCES validation_suite_runs(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    decision TEXT NOT NULL DEFAULT 'PENDING',
    gate_mode TEXT NOT NULL DEFAULT 'BLOCKING',
    application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
    service_id UUID REFERENCES application_services(id) ON DELETE SET NULL,
    resolved_index TEXT NOT NULL,
    time_from TIMESTAMPTZ NOT NULL,
    time_to TIMESTAMPTZ NOT NULL,
    hit_count BIGINT NOT NULL DEFAULT 0,
    open_search_took_ms BIGINT NOT NULL DEFAULT 0,
    round_trip_ms BIGINT NOT NULL DEFAULT 0,
    shard_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    aggregations JSONB NOT NULL DEFAULT '{}'::jsonb,
    samples JSONB NOT NULL DEFAULT '[]'::jsonb,
    sample_expires_at TIMESTAMPTZ,
    truncation JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_category TEXT NOT NULL DEFAULT '',
    failure_reason TEXT NOT NULL DEFAULT '',
    debug_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX elf_queries_application_updated_idx ON elf_queries(application_id, updated_at DESC);
CREATE INDEX elf_query_revisions_query_revision_idx ON elf_query_revisions(query_id, revision_number DESC);
CREATE INDEX elf_runs_query_created_idx ON elf_runs(query_id, created_at DESC);
CREATE INDEX elf_runs_samples_expiry_idx ON elf_runs(sample_expires_at) WHERE sample_expires_at IS NOT NULL;
