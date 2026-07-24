DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS monitor_schedules;
ALTER TABLE monitors DROP CONSTRAINT IF EXISTS monitors_latest_published_revision_fk;
ALTER TABLE monitors DROP CONSTRAINT IF EXISTS monitors_current_draft_revision_fk;
DROP TABLE IF EXISTS monitor_revisions;
DROP TABLE IF EXISTS monitors;
DROP TABLE IF EXISTS environments;
