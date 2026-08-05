-- NLQ Service V3 — per-tenant AI / LLM configuration (BYOK multi-provider)
--
-- Stores the tenant's chosen provider (ANTHROPIC / OPENAI / GEMINI), their API key
-- (AES-GCM encrypted via shared-lib's EncryptedStringConverter, never plaintext), and
-- optional model overrides for SQL generation and narration.
--
-- RLS ENABLED + FORCED with the standard tenant_isolation policy (same as nlq_query_log
-- in V1). Only the owning tenant's rows are visible — a tenant can never read/modify
-- another tenant's API key, even with a direct SQL injection through NLQ (the NLQ
-- validator would reject it anyway, but defence-in-depth).

CREATE TABLE tenant_ai_config (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL UNIQUE,
    provider          VARCHAR(20) NOT NULL DEFAULT 'ANTHROPIC',
    api_key_encrypted BYTEA NOT NULL,
    model_sql         VARCHAR(100),
    model_narrative   VARCHAR(100),
    enabled           BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_ai_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_ai_config
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
ALTER TABLE tenant_ai_config FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_ai_config TO nlq_user;
