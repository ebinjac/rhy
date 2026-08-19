CREATE TABLE rhythm.ai_provider_settings (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL CHECK (provider_type IN ('COMPASS360','OPENROUTER_DEMO')),
    environment TEXT NOT NULL DEFAULT 'development',
    base_url TEXT NOT NULL,
    completion_path TEXT NOT NULL DEFAULT '/v1/completions',
    default_model TEXT NOT NULL,
    approved_models JSONB NOT NULL DEFAULT '[]'::jsonb,
    required_capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
    proxy_url TEXT NOT NULL DEFAULT '',
    timeout_seconds INTEGER NOT NULL DEFAULT 120 CHECK (timeout_seconds BETWEEN 5 AND 120),
    max_concurrency INTEGER NOT NULL DEFAULT 4 CHECK (max_concurrency BETWEEN 1 AND 32),
    max_tool_rounds INTEGER NOT NULL DEFAULT 8 CHECK (max_tool_rounds BETWEEN 1 AND 8),
    max_input_tokens INTEGER NOT NULL DEFAULT 16000 CHECK (max_input_tokens BETWEEN 256 AND 131072),
    max_output_tokens INTEGER NOT NULL DEFAULT 4096 CHECK (max_output_tokens BETWEEN 128 AND 32768),
    daily_request_limit INTEGER NOT NULL DEFAULT 1000 CHECK (daily_request_limit BETWEEN 1 AND 1000000),
    encrypted_api_key TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_test_status TEXT NOT NULL DEFAULT 'NOT_TESTED',
    last_test_message TEXT NOT NULL DEFAULT '',
    last_test_latency_ms BIGINT,
    last_tested_at TIMESTAMPTZ,
    created_by TEXT NOT NULL,
    updated_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ai_provider_settings_one_active_idx
    ON rhythm.ai_provider_settings ((active)) WHERE active;

CREATE TABLE rhythm.ai_conversations (
    id UUID PRIMARY KEY,
    owner_hash TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New investigation',
    context_type TEXT NOT NULL DEFAULT '',
    context_id TEXT NOT NULL DEFAULT '',
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_conversations_owner_updated_idx
    ON rhythm.ai_conversations (owner_hash, updated_at DESC, id DESC);
CREATE INDEX ai_conversations_expiry_idx
    ON rhythm.ai_conversations (expires_at);

CREATE TABLE rhythm.ai_messages (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES rhythm.ai_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('USER','ASSISTANT','TOOL')),
    content_masked TEXT NOT NULL DEFAULT '',
    citations JSONB NOT NULL DEFAULT '[]'::jsonb,
    provider_name TEXT NOT NULL DEFAULT '',
    model_name TEXT NOT NULL DEFAULT '',
    finish_reason TEXT NOT NULL DEFAULT '',
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'COMPLETE' CHECK (status IN ('STREAMING','COMPLETE','FAILED','CANCELLED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_messages_conversation_created_idx
    ON rhythm.ai_messages (conversation_id, created_at, id);

CREATE TABLE rhythm.ai_tool_calls (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES rhythm.ai_conversations(id) ON DELETE CASCADE,
    message_id UUID REFERENCES rhythm.ai_messages(id) ON DELETE SET NULL,
    provider_call_id TEXT NOT NULL DEFAULT '',
    tool_name TEXT NOT NULL,
    arguments_masked JSONB NOT NULL DEFAULT '{}'::jsonb,
    result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL CHECK (status IN ('STARTED','COMPLETED','FAILED','POLICY_BLOCKED')),
    duration_ms BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_tool_calls_conversation_idx
    ON rhythm.ai_tool_calls (conversation_id, created_at);

CREATE TABLE rhythm.ai_action_proposals (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES rhythm.ai_conversations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','REJECTED','EXPIRED','DRIFTED')),
    expires_at TIMESTAMPTZ NOT NULL,
    confirmed_by TEXT,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_action_proposals_conversation_idx
    ON rhythm.ai_action_proposals (conversation_id, created_at DESC);
CREATE INDEX ai_action_proposals_expiry_idx
    ON rhythm.ai_action_proposals (status, expires_at) WHERE status = 'PENDING';

CREATE TABLE rhythm.ai_validation_runs (
    id UUID PRIMARY KEY,
    proposal_id UUID NOT NULL REFERENCES rhythm.ai_action_proposals(id) ON DELETE RESTRICT,
    conversation_id UUID NOT NULL REFERENCES rhythm.ai_conversations(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
    requested_by TEXT NOT NULL,
    result_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX ai_validation_runs_conversation_idx
    ON rhythm.ai_validation_runs (conversation_id, created_at DESC);

CREATE TABLE rhythm.ai_proactive_insights (
    id UUID PRIMARY KEY,
    insight_type TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary_masked TEXT NOT NULL,
    citations JSONB NOT NULL DEFAULT '[]'::jsonb,
    provider_setting_id UUID REFERENCES rhythm.ai_provider_settings(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ai_proactive_insights_resource_idx
    ON rhythm.ai_proactive_insights (resource_type, resource_id, created_at DESC);
CREATE INDEX ai_proactive_insights_expiry_idx
    ON rhythm.ai_proactive_insights (expires_at);

CREATE TABLE rhythm.ai_message_feedback (
    message_id UUID PRIMARY KEY REFERENCES rhythm.ai_messages(id) ON DELETE CASCADE,
    owner_hash TEXT NOT NULL,
    rating TEXT NOT NULL CHECK (rating IN ('HELPFUL','NOT_HELPFUL')),
    comment TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rhythm.ai_usage_daily (
    usage_date DATE NOT NULL,
    provider_setting_id UUID NOT NULL REFERENCES rhythm.ai_provider_settings(id) ON DELETE CASCADE,
    request_count BIGINT NOT NULL DEFAULT 0,
    prompt_tokens BIGINT NOT NULL DEFAULT 0,
    completion_tokens BIGINT NOT NULL DEFAULT 0,
    error_count BIGINT NOT NULL DEFAULT 0,
    latency_ms BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (usage_date, provider_setting_id)
);
