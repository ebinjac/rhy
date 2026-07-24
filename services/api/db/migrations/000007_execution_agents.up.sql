CREATE TABLE agents (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    agent_group_id TEXT,
    version TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    max_concurrency INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrency BETWEEN 1 AND 1000),
    active_runs INTEGER NOT NULL DEFAULT 0 CHECK (active_runs >= 0),
    last_heartbeat_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agents_routing_idx ON agents (status, agent_group_id, active_runs, last_heartbeat_at DESC);
ALTER TABLE monitor_runs ADD COLUMN agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;
