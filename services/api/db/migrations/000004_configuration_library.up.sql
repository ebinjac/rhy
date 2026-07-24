CREATE TABLE configuration_profiles (
    id UUID PRIMARY KEY,
    kind VARCHAR(50) NOT NULL CHECK (kind IN ('ENVIRONMENT','SECRET_REFERENCE','CERTIFICATE','PROXY','AUTH')),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    profile_type VARCHAR(100) NOT NULL,
    config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(255) NOT NULL,
    updated_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (kind, name)
);
CREATE INDEX configuration_profiles_kind_idx ON configuration_profiles(kind, active, name);
