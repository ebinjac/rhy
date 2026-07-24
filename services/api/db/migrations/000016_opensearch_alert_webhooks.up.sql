ALTER TABLE alerts ALTER COLUMN monitor_id DROP NOT NULL;
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_state_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_state_check CHECK (state IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED', 'ERROR'));
ALTER TABLE alerts ADD COLUMN source_type VARCHAR(50) NOT NULL DEFAULT 'RHYTHM_MONITOR' CHECK (source_type IN ('RHYTHM_MONITOR', 'OPENSEARCH_ALERTING'));
ALTER TABLE alerts ADD COLUMN application_id UUID REFERENCES applications(id) ON DELETE SET NULL;
ALTER TABLE alerts ADD COLUMN service_id UUID REFERENCES application_services(id) ON DELETE SET NULL;
ALTER TABLE alerts ADD COLUMN receiver_id UUID;
ALTER TABLE alerts ADD COLUMN external_monitor_id VARCHAR(255);
ALTER TABLE alerts ADD COLUMN external_monitor_name VARCHAR(255);
ALTER TABLE alerts ADD COLUMN external_monitor_type VARCHAR(80);
ALTER TABLE alerts ADD COLUMN external_trigger_id VARCHAR(255);
ALTER TABLE alerts ADD COLUMN external_trigger_name VARCHAR(255);
ALTER TABLE alerts ADD COLUMN external_alert_id VARCHAR(255);
ALTER TABLE alerts ADD COLUMN bucket_key VARCHAR(500);
ALTER TABLE alerts ADD COLUMN upstream_state VARCHAR(50);
ALTER TABLE alerts ADD COLUMN hit_count BIGINT;
ALTER TABLE alerts ADD COLUMN evidence JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE alerts ADD COLUMN dashboard_url TEXT;
ALTER TABLE alerts ADD COLUMN last_received_at TIMESTAMPTZ;
ALTER TABLE alerts ADD COLUMN last_reconciled_at TIMESTAMPTZ;
ALTER TABLE alerts ADD COLUMN sample_expires_at TIMESTAMPTZ;

CREATE TABLE opensearch_alert_receivers (
    id UUID PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    service_id UUID REFERENCES application_services(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    dashboard_url TEXT NOT NULL DEFAULT '',
    expected_monitor_types JSONB NOT NULL DEFAULT '["QUERY_LEVEL","BUCKET_LEVEL","DOCUMENT_LEVEL"]'::jsonb,
    reconciliation_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (reconciliation_interval_seconds BETWEEN 30 AND 3600),
    token_hash VARCHAR(64) NOT NULL,
    previous_token_hash VARCHAR(64),
    previous_token_expires_at TIMESTAMPTZ,
    last_delivery_at TIMESTAMPTZ,
    last_reconciled_at TIMESTAMPTZ,
    last_reconciliation_status VARCHAR(50) NOT NULL DEFAULT 'NOT_RUN',
    last_reconciliation_error VARCHAR(500) NOT NULL DEFAULT '',
    created_by VARCHAR(255),
    updated_by VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE alerts ADD CONSTRAINT alerts_receiver_id_fkey FOREIGN KEY (receiver_id) REFERENCES opensearch_alert_receivers(id) ON DELETE SET NULL;

CREATE TABLE opensearch_alert_deliveries (
    id UUID PRIMARY KEY,
    receiver_id UUID NOT NULL REFERENCES opensearch_alert_receivers(id) ON DELETE CASCADE,
    body_hash VARCHAR(64) NOT NULL,
    schema_version VARCHAR(80) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('ACCEPTED', 'PROCESSED', 'REJECTED', 'DUPLICATE')),
    event_count INTEGER NOT NULL DEFAULT 0,
    safe_error VARCHAR(500) NOT NULL DEFAULT '',
    normalized_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE alert_events (
    id UUID PRIMARY KEY,
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    event_type VARCHAR(80) NOT NULL,
    upstream_state VARCHAR(50),
    summary VARCHAR(500) NOT NULL DEFAULT '',
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE opensearch_alert_reconciliation_runs (
    id UUID PRIMARY KEY,
    receiver_id UUID NOT NULL REFERENCES opensearch_alert_receivers(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED')),
    alerts_seen INTEGER NOT NULL DEFAULT 0,
    alerts_changed INTEGER NOT NULL DEFAULT 0,
    safe_error VARCHAR(500) NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX opensearch_alert_deliveries_receiver_body_idx ON opensearch_alert_deliveries(receiver_id, body_hash);
CREATE INDEX opensearch_alert_receivers_application_idx ON opensearch_alert_receivers(application_id, service_id, updated_at DESC);
CREATE INDEX opensearch_alert_deliveries_receiver_received_idx ON opensearch_alert_deliveries(receiver_id, received_at DESC);
CREATE INDEX alert_events_alert_occurred_idx ON alert_events(alert_id, occurred_at DESC);
CREATE INDEX alerts_source_state_idx ON alerts(source_type, state, updated_at DESC);
CREATE INDEX alerts_application_state_idx ON alerts(application_id, service_id, state, updated_at DESC);
CREATE INDEX alerts_external_identity_idx ON alerts(receiver_id, external_monitor_id, external_trigger_id, external_alert_id);

