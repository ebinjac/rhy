CREATE TABLE monitor_alert_policies (
    monitor_id UUID PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
    failure_threshold INTEGER NOT NULL DEFAULT 3 CHECK (failure_threshold > 0),
    recovery_threshold INTEGER NOT NULL DEFAULT 2 CHECK (recovery_threshold > 0),
    severity VARCHAR(50) NOT NULL DEFAULT 'CRITICAL' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    cooldown_seconds INTEGER NOT NULL DEFAULT 300 CHECK (cooldown_seconds >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE alerts (
    id UUID PRIMARY KEY,
    monitor_id UUID NOT NULL REFERENCES monitors(id),
    deduplication_key VARCHAR(255) NOT NULL,
    state VARCHAR(50) NOT NULL CHECK (state IN ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'SUPPRESSED')),
    severity VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    failure_category VARCHAR(100),
    failed_step_id VARCHAR(255),
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    first_triggered_at TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(255),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX alerts_active_dedup_idx ON alerts (deduplication_key) WHERE state IN ('OPEN', 'ACKNOWLEDGED');
CREATE INDEX alerts_monitor_created_idx ON alerts (monitor_id, created_at DESC);
CREATE INDEX alerts_state_idx ON alerts (state, updated_at DESC);
