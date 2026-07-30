DROP INDEX IF EXISTS application_environment_bindings_default_idx;

DELETE FROM application_environment_bindings
WHERE environment_profile_id IS NULL;

ALTER TABLE application_environment_bindings
    DROP COLUMN environment_name,
    DROP COLUMN environment_type,
    ALTER COLUMN environment_profile_id SET NOT NULL;
