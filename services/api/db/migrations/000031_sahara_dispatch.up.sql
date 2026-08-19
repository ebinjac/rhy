ALTER TABLE applications
    ADD COLUMN sahara_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN sahara_assignment_group TEXT NOT NULL DEFAULT '',
    ADD COLUMN sahara_reporter_group TEXT NOT NULL DEFAULT '',
    ADD COLUMN sahara_environment_affected TEXT NOT NULL DEFAULT '',
    ADD COLUMN sahara_event_generator TEXT NOT NULL DEFAULT '',
    ADD COLUMN sahara_default_severity TEXT NOT NULL DEFAULT '';

CREATE TABLE sahara_dispatches (
    id UUID PRIMARY KEY,
    alert_id UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL DEFAULT 'ALERT_OPENED' CHECK (event_type IN ('ALERT_OPENED')),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENDING','SENT','FAILED','SKIPPED')),
    event_unique_id TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (alert_id, event_type)
);
CREATE INDEX sahara_dispatches_pending_idx ON sahara_dispatches (status, next_attempt_at);
