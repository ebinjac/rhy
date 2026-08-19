DROP TABLE IF EXISTS sahara_dispatches;

ALTER TABLE applications
    DROP COLUMN IF EXISTS sahara_enabled,
    DROP COLUMN IF EXISTS sahara_assignment_group,
    DROP COLUMN IF EXISTS sahara_reporter_group,
    DROP COLUMN IF EXISTS sahara_environment_affected,
    DROP COLUMN IF EXISTS sahara_event_generator,
    DROP COLUMN IF EXISTS sahara_default_severity;
