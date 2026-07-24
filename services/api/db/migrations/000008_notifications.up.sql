ALTER TABLE configuration_profiles DROP CONSTRAINT configuration_profiles_kind_check;
ALTER TABLE configuration_profiles ADD CONSTRAINT configuration_profiles_kind_check CHECK (kind IN ('ENVIRONMENT','SECRET_REFERENCE','CERTIFICATE','PROXY','AUTH','NOTIFICATION'));

CREATE TABLE notification_deliveries (
    id UUID PRIMARY KEY,
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES configuration_profiles(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('ALERT_OPENED','ALERT_RECOVERED')),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (alert_id, channel_id, event_type)
);
CREATE INDEX notification_deliveries_pending_idx ON notification_deliveries (status, next_attempt_at);
