-- NLQ Service V3 — per-tenant AI provider + API key (Program C).
--
-- WHY THIS EXISTS: before this migration, ClaudeClient read ONE fleet-wide key from deploy config
-- (`restaurantos.nlq.anthropic.api-key`). Every tenant's NLQ traffic billed to one Anthropic
-- account with no per-tenant attribution, quota or isolation. That is a multi-tenancy defect, not
-- just a missing feature.
--
-- VERSION NUMBER: V3 is claimed in .planning/MIGRATION-REGISTER.md. `origin/Mufazzal` carries a
-- DIFFERENT V3 (`V3__tenant_ai_config.sql`) for the same feature, unmerged and never applied.
-- Read the register's "nlq-service V3 double-claim" section before touching this number. Taking
-- V4 to dodge the clash would recreate the V28 out-of-order hazard, which is worse.

-- ── nlq_tenant_ai_settings ──────────────────────────────────────────────────────
--
-- One row per tenant that has ever configured AI. NO ROW = the tenant uses the platform's deploy
-- key, which is the pre-existing behaviour and must keep working (requirement 4).
--
-- THE KEY IS STORED AS CIPHERTEXT AND NOTHING ELSE. There is no plaintext column, no reversible
-- "hint" column, and the only key-derived value the API may ever return is api_key_last4.
-- api_key_fingerprint answers "is this the same key you already had" WITHOUT decrypting, so the
-- idempotency check on a re-save never materialises the plaintext.
CREATE TABLE nlq_tenant_ai_settings (
    tenant_id            UUID         PRIMARY KEY,

    -- 'ANTHROPIC' only in v1. The column is VARCHAR rather than an enum type so adding a provider
    -- is a code change plus a CHECK change, not a type migration under load.
    provider             VARCHAR(20)  NOT NULL,

    -- AES-256-GCM, 12-byte IV prefixed, produced by shared-lib EncryptionService.
    -- NULL = the tenant cleared their key and has reverted to the platform key.
    api_key_ciphertext   BYTEA,

    -- The ONLY key-derived value that is ever returned over the wire. Four characters.
    api_key_last4        VARCHAR(4),

    -- sha256(key) hex. Never returned by the API — it is a server-side equality probe only.
    -- VARCHAR, not CHAR. Postgres CHAR(n) is blank-padded, so a fingerprint read back would
    -- carry trailing spaces and an equality check against a freshly-computed digest would
    -- fail — the exact question this column exists to answer. It also made Hibernate refuse
    -- to start: it maps String to varchar and found bpchar.
    api_key_fingerprint  VARCHAR(64),

    -- UNSET   : no tenant key, using the platform key
    -- UNVERIFIED: saved, but the save-time probe could not reach the provider (outage) —
    --             we refuse to claim a key is good when we could not check it
    -- VERIFIED : the provider accepted it at save time
    -- REJECTED : the provider refused it (401/403), either at save or later at query time.
    --            Set from a REQUIRES_NEW transaction so it survives the failing outer one —
    --            otherwise the screen keeps reporting VERIFIED forever, which is precisely the
    --            "structurally present, behaviourally absent" defect this codebase keeps shipping.
    key_state            VARCHAR(16)  NOT NULL DEFAULT 'UNSET',

    last_verified_at     TIMESTAMPTZ,
    last_rejected_at     TIMESTAMPTZ,

    created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_by           UUID,

    CONSTRAINT nlq_tenant_ai_settings_provider_chk
        CHECK (provider IN ('ANTHROPIC')),

    CONSTRAINT nlq_tenant_ai_settings_key_state_chk
        CHECK (key_state IN ('UNSET', 'UNVERIFIED', 'VERIFIED', 'REJECTED')),

    -- last4 and ciphertext live and die together. Prevents a half-cleared row that shows the
    -- owner "•••• 4242" while the resolver has already fallen back to the platform key.
    CONSTRAINT nlq_tenant_ai_settings_last4_chk
        CHECK ((api_key_ciphertext IS NULL) = (api_key_last4 IS NULL)),

    -- A row with no ciphertext cannot claim a key is VERIFIED/UNVERIFIED/REJECTED — those states
    -- describe a key, and there isn't one.
    CONSTRAINT nlq_tenant_ai_settings_state_agrees_chk
        CHECK ((api_key_ciphertext IS NULL) = (key_state = 'UNSET'))
);

-- RLS: ENABLE **and** FORCE. FORCE is the load-bearing half — nlq_user owns this table, and
-- without FORCE the owner bypasses every policy, which is how 33 tables in this codebase shipped
-- with RLS that read correctly and never ran (see .planning task #15).
--
-- NULLIF(..., '') is deliberate: a connection that never set app.current_tenant_id gets NULL, the
-- comparison is NULL, and zero rows match — it fails closed instead of erroring on a bad cast
-- (auth changeset 087 standardised this).
--
-- RLS IS DEFENCE IN DEPTH HERE, NOT THE BOUNDARY. Every repository method carries an explicit
-- tenant_id predicate. If the GUC were ever empty and RLS silently returned zero rows, the failure
-- mode would be "the tenant's saved key is invisible, so we quietly bill the platform" — a silent
-- billing leak. The explicit predicate makes that impossible; RLS then catches anything the
-- predicate misses.
ALTER TABLE nlq_tenant_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON nlq_tenant_ai_settings
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
ALTER TABLE nlq_tenant_ai_settings FORCE ROW LEVEL SECURITY;

-- ── nlq_ai_settings_events ──────────────────────────────────────────────────────
--
-- Append-only: who changed the AI credential, and when. That is the question asked after an
-- incident, and nlq-service has no other audit surface for it (nlq_query_log is per-query).
--
-- DELIBERATELY CARRIES NO KEY MATERIAL — not the key, not the fingerprint, not even the last 4.
-- An audit table is the classic place a credential leaks into: it is long-lived, widely readable,
-- and nobody re-reads its columns after the review that added them.
CREATE TABLE nlq_ai_settings_events (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID         NOT NULL,
    actor_user_id  UUID,
    action         VARCHAR(24)  NOT NULL,
    at             TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT nlq_ai_settings_events_action_chk
        CHECK (action IN ('KEY_SET', 'KEY_ROTATED', 'KEY_CLEARED', 'KEY_REJECTED'))
);

ALTER TABLE nlq_ai_settings_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON nlq_ai_settings_events
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
ALTER TABLE nlq_ai_settings_events FORCE ROW LEVEL SECURITY;

CREATE INDEX idx_nlq_ai_settings_events_tenant_at
    ON nlq_ai_settings_events (tenant_id, at DESC);
