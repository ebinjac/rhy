ALTER TABLE application_environment_bindings
    ALTER COLUMN environment_profile_id DROP NOT NULL,
    ADD COLUMN environment_name TEXT NOT NULL DEFAULT '',
    ADD COLUMN environment_type TEXT NOT NULL DEFAULT '';

UPDATE application_environment_bindings b
SET environment_name = p.name,
    environment_type = p.profile_type
FROM configuration_profiles p
WHERE p.id = b.environment_profile_id;

CREATE UNIQUE INDEX application_environment_bindings_default_idx
    ON application_environment_bindings(application_id)
    WHERE environment_profile_id IS NULL;
