ALTER TABLE monitor_runs
    ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS terminal_processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS api_response_time_ms BIGINT,
    ADD COLUMN IF NOT EXISTS preparation_time_ms BIGINT,
    ADD COLUMN IF NOT EXISTS post_processing_time_ms BIGINT,
    ADD COLUMN IF NOT EXISTS network_time_ms BIGINT,
    ADD COLUMN IF NOT EXISTS retry_backoff_time_ms BIGINT,
    ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE execution_jobs (
    id UUID PRIMARY KEY,
    run_id UUID REFERENCES monitor_runs(id) ON DELETE CASCADE,
    job_type VARCHAR(80) NOT NULL,
    queue_class VARCHAR(40) NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    status VARCHAR(30) NOT NULL DEFAULT 'QUEUED'
        CHECK (status IN ('QUEUED', 'LEASED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'DEAD_LETTER')),
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    deduplication_key VARCHAR(255),
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    lease_owner VARCHAR(255),
    lease_expires_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    cancel_requested_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX execution_jobs_run_idx
    ON execution_jobs (run_id) WHERE run_id IS NOT NULL;
CREATE UNIQUE INDEX execution_jobs_deduplication_idx
    ON execution_jobs (deduplication_key) WHERE deduplication_key IS NOT NULL;
CREATE INDEX execution_jobs_claim_idx
    ON execution_jobs (queue_class, priority, available_at, created_at)
    WHERE status = 'QUEUED';
CREATE INDEX execution_jobs_lease_idx
    ON execution_jobs (lease_expires_at)
    WHERE status = 'LEASED';
CREATE INDEX execution_jobs_cancel_idx
    ON execution_jobs (cancel_requested_at)
    WHERE cancel_requested_at IS NOT NULL AND status IN ('QUEUED', 'LEASED');

CREATE TABLE execution_job_outbox (
    id UUID PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES execution_jobs(id) ON DELETE CASCADE,
    stream_name VARCHAR(120) NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    publish_attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    published_at TIMESTAMPTZ,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (job_id)
);

CREATE INDEX execution_job_outbox_pending_idx
    ON execution_job_outbox (available_at, created_at)
    WHERE published_at IS NULL;

CREATE TABLE monitor_current_health (
    monitor_id UUID PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
    operational_status VARCHAR(40) NOT NULL DEFAULT 'NO_SIGNAL',
    status_reason VARCHAR(255) NOT NULL DEFAULT 'No completed execution has been recorded.',
    last_run_id UUID REFERENCES monitor_runs(id) ON DELETE SET NULL,
    last_run_status VARCHAR(50),
    last_run_at TIMESTAMPTZ,
    last_duration_ms BIGINT,
    last_api_response_time_ms BIGINT,
    success_count_24h BIGINT NOT NULL DEFAULT 0,
    run_count_24h BIGINT NOT NULL DEFAULT 0,
    success_rate_24h DOUBLE PRECISION,
    active_alert_count INTEGER NOT NULL DEFAULT 0,
    next_run_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO monitor_current_health (
    monitor_id,
    operational_status,
    status_reason,
    last_run_id,
    last_run_status,
    last_run_at,
    last_duration_ms,
    last_api_response_time_ms,
    success_count_24h,
    run_count_24h,
    success_rate_24h,
    active_alert_count,
    next_run_at,
    updated_at
)
SELECT
    m.id,
    CASE
        WHEN m.state = 'ARCHIVED' OR NOT m.enabled THEN 'PAUSED'
        WHEN latest.status = 'SUCCESS' THEN 'HEALTHY'
        WHEN latest.status = 'SUCCESS_WITH_WARNINGS' THEN 'DEGRADED'
        WHEN latest.status IN ('FAILED', 'TIMED_OUT', 'ABORTED') THEN 'FAILING'
        ELSE 'NO_SIGNAL'
    END,
    CASE
        WHEN m.state = 'ARCHIVED' OR NOT m.enabled THEN 'Monitoring is paused.'
        WHEN latest.status = 'SUCCESS' THEN 'The latest execution succeeded.'
        WHEN latest.status = 'SUCCESS_WITH_WARNINGS' THEN 'The latest execution completed with warnings.'
        WHEN latest.status IN ('FAILED', 'TIMED_OUT', 'ABORTED') THEN 'The latest execution requires attention.'
        ELSE 'No completed execution has been recorded.'
    END,
    latest.id,
    latest.status,
    latest.created_at,
    latest.duration_ms,
    latest.api_response_time_ms,
    COALESCE(stats.success_count, 0),
    COALESCE(stats.run_count, 0),
    CASE
        WHEN COALESCE(stats.run_count, 0) = 0 THEN NULL
        ELSE 100.0 * stats.success_count / stats.run_count
    END,
    COALESCE(alerts.active_count, 0),
    schedule.next_run_at,
    NOW()
FROM monitors m
LEFT JOIN LATERAL (
    SELECT id, status, created_at, duration_ms, api_response_time_ms
    FROM monitor_runs
    WHERE monitor_id = m.id
      AND status IN ('SUCCESS', 'SUCCESS_WITH_WARNINGS', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'ABORTED')
    ORDER BY created_at DESC, id DESC
    LIMIT 1
) latest ON TRUE
LEFT JOIN LATERAL (
    SELECT
        COUNT(*) FILTER (WHERE status IN ('SUCCESS', 'SUCCESS_WITH_WARNINGS')) AS success_count,
        COUNT(*) AS run_count
    FROM monitor_runs
    WHERE monitor_id = m.id
      AND created_at >= NOW() - INTERVAL '24 hours'
      AND status IN ('SUCCESS', 'SUCCESS_WITH_WARNINGS', 'FAILED', 'TIMED_OUT', 'ABORTED')
) stats ON TRUE
LEFT JOIN LATERAL (
    SELECT COUNT(*) AS active_count
    FROM alerts
    WHERE monitor_id = m.id AND state IN ('OPEN', 'ACKNOWLEDGED', 'ERROR')
) alerts ON TRUE
LEFT JOIN LATERAL (
    SELECT next_run_at
    FROM monitor_schedules
    WHERE monitor_id = m.id AND active = TRUE
    ORDER BY updated_at DESC
    LIMIT 1
) schedule ON TRUE
WHERE m.deleted_at IS NULL
ON CONFLICT (monitor_id) DO NOTHING;

CREATE INDEX monitor_current_health_status_idx
    ON monitor_current_health (operational_status, updated_at DESC);
CREATE INDEX monitor_current_health_last_run_idx
    ON monitor_current_health (last_run_at DESC);

CREATE TABLE monitor_metric_rollups_hourly (
    monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    revision_id UUID REFERENCES monitor_revisions(id) ON DELETE SET NULL,
    bucket_start TIMESTAMPTZ NOT NULL,
    sample_count BIGINT NOT NULL DEFAULT 0,
    success_count BIGINT NOT NULL DEFAULT 0,
    failure_count BIGINT NOT NULL DEFAULT 0,
    timeout_count BIGINT NOT NULL DEFAULT 0,
    api_response_sum_ms BIGINT NOT NULL DEFAULT 0,
    api_response_min_ms BIGINT,
    api_response_max_ms BIGINT,
    api_response_values_ms JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (monitor_id, bucket_start)
);

CREATE INDEX monitor_metric_rollups_hourly_time_idx
    ON monitor_metric_rollups_hourly (bucket_start DESC, monitor_id);

CREATE TABLE monitor_metric_rollups_daily (
    monitor_id UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    bucket_start DATE NOT NULL,
    sample_count BIGINT NOT NULL DEFAULT 0,
    success_count BIGINT NOT NULL DEFAULT 0,
    failure_count BIGINT NOT NULL DEFAULT 0,
    timeout_count BIGINT NOT NULL DEFAULT 0,
    api_response_sum_ms BIGINT NOT NULL DEFAULT 0,
    api_response_min_ms BIGINT,
    api_response_max_ms BIGINT,
    api_response_values_ms JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (monitor_id, bucket_start)
);

CREATE INDEX monitor_metric_rollups_daily_time_idx
    ON monitor_metric_rollups_daily (bucket_start DESC, monitor_id);

CREATE TABLE warm_evidence_manifests (
    run_id UUID PRIMARY KEY REFERENCES monitor_runs(id) ON DELETE CASCADE,
    object_key VARCHAR(1024) NOT NULL,
    checksum_sha256 VARCHAR(64) NOT NULL,
    compressed_size_bytes BIGINT NOT NULL,
    evidence_from TIMESTAMPTZ NOT NULL,
    evidence_to TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    restore_state VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (restore_state IN ('AVAILABLE', 'RESTORING', 'EXPIRED', 'POLICY_BLOCKED'))
);

CREATE INDEX warm_evidence_manifests_expiry_idx
    ON warm_evidence_manifests (expires_at);

CREATE INDEX monitor_runs_status_created_idx
    ON monitor_runs (status, created_at DESC);
CREATE INDEX monitor_runs_revision_created_idx
    ON monitor_runs (monitor_id, revision_id, created_at DESC);
CREATE INDEX monitor_runs_terminal_time_idx
    ON monitor_runs (created_at DESC, monitor_id)
    WHERE status IN ('SUCCESS', 'SUCCESS_WITH_WARNINGS', 'FAILED', 'TIMED_OUT', 'CANCELLED', 'ABORTED');
CREATE INDEX monitor_step_runs_definition_time_idx
    ON monitor_step_runs (step_definition_id, monitor_run_id);
CREATE INDEX run_events_time_idx
    ON run_events (monitor_run_id, occurred_at, sequence);
