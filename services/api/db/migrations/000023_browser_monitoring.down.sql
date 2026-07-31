DROP INDEX IF EXISTS alerts_browser_monitor_idx;
DELETE FROM alerts WHERE source_type = 'RHYTHM_BROWSER_MONITOR';
ALTER TABLE alerts DROP COLUMN IF EXISTS browser_monitor_id;
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_source_type_check;
ALTER TABLE alerts
    ADD CONSTRAINT alerts_source_type_check
    CHECK (source_type IN ('RHYTHM_MONITOR', 'OPENSEARCH_ALERTING'));
DROP TABLE IF EXISTS browser_auth_sessions;
DROP TABLE IF EXISTS browser_visual_baselines;
DROP TABLE IF EXISTS browser_artifacts;
DROP TABLE IF EXISTS browser_step_runs;
DROP TABLE IF EXISTS browser_runs;
ALTER TABLE browser_monitors DROP CONSTRAINT IF EXISTS browser_monitors_published_revision_fk;
ALTER TABLE browser_monitors DROP CONSTRAINT IF EXISTS browser_monitors_draft_revision_fk;
DROP TABLE IF EXISTS browser_monitor_revisions;
DROP TABLE IF EXISTS browser_monitors;
