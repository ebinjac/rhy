ALTER TABLE applications
    ADD COLUMN alert_emails JSONB NOT NULL DEFAULT '[]'::jsonb;
