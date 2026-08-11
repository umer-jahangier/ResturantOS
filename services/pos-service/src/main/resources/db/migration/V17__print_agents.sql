-- ============================================================================
-- 26-11 — print_agents: the identity of a machine that prints
-- ============================================================================
-- WHY THIS TABLE EXISTS AT ALL
--
-- RestaurantOS runs in a datacentre. The printers sit on the restaurant's LAN
-- behind NAT. There is no route from the cloud to port 9100 and there never will
-- be — that is a topology fact, not a firewall rule (26-CONTEXT, D-26-06).
-- Everything that reaches a printer must be initiated from INSIDE the restaurant.
--
-- So the print agent polls outbound, and to poll it needs an identity. This table
-- is that identity. Without it a cloud-hosted RestaurantOS prints nothing at all.
--
-- ══ Why the credential is NOT in branches.receipt_config ══
--
-- `receipt_config` is returned VERBATIM to the printing settings screen by
-- 26-02's GET endpoint. A credential stored there would be readable by every user
-- who can open that screen, and would travel in every response that carries the
-- printer registry. It lives here instead, as a hash, in a table nothing renders.
--
-- ══ Why the credential is self-describing about its tenant ══
--
-- This table is FORCE ROW LEVEL SECURITY like every other tenant table. That
-- creates a genuine ordering problem: the agent authenticates BEFORE anything
-- knows which tenant it belongs to, and under forced RLS a query issued with no
-- `app.current_tenant_id` returns ZERO ROWS rather than erroring. A lookup by
-- credential alone would therefore always find nothing, and would look exactly
-- like a wrong password.
--
-- The credential string therefore CARRIES its tenant id and a non-secret lookup
-- id, so the filter can set the tenant GUC before the lookup and let RLS scope it.
-- That is safe because neither value is the secret: claiming a tenant you do not
-- hold a credential for finds a row you cannot match the hash of, or no row at
-- all. The tenant and branch that get used downstream are read from the ROW, never
-- from the string the client sent.
--
-- ══ Why lookup_id exists ══
--
-- bcrypt hashes are salted, so a credential cannot be found BY its hash. Without a
-- lookup id, resolving one would mean bcrypt-comparing against every agent of the
-- tenant — at cost factor 12 that is ~100 ms EACH, which turns a poll into a
-- denial-of-service vector against our own service.
--
-- ══ RLS ══
--
-- ENABLE, policy, then FORCE, in this migration — the V13 pattern, for the V13
-- reason: pos-service connects as the role that OWNS these tables and PostgreSQL
-- exempts an owner from its own policies unless FORCE is set. Closes with V11's
-- own any-unforced-table self-check.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS or guarded by a catalog check.
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_agents (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID         NOT NULL,
    -- An agent belongs to exactly ONE branch. That is the whole authorisation
    -- model: the credential resolves to a branch and grants nothing else.
    branch_id           UUID         NOT NULL,
    -- What a manager typed so they can tell two tills apart six months from now.
    label               VARCHAR(120) NOT NULL,
    -- The non-secret half of the credential string. Globally unique so a lookup
    -- needs no scan; carries no entropy requirement because it authenticates
    -- nothing on its own.
    lookup_id           VARCHAR(32)  NOT NULL,
    -- bcrypt, cost 12 — the SAME encoder auth-service uses for passwords. Not a
    -- second scheme chosen here: one hashing decision in the product, made once.
    credential_hash     VARCHAR(120) NOT NULL,
    -- Set on revoke. The row is NEVER deleted: an operator asking "did this till
    -- ever have an agent, and when did we turn it off" deserves an answer.
    revoked_at          TIMESTAMPTZ,
    -- Observability for the settings screen: an agent that has never polled looks
    -- identical to a working one without this.
    last_seen_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_by          UUID,
    deleted_at          TIMESTAMPTZ
);

-- ── RLS: enabled AND forced, here, in the same migration ─────────────────────
ALTER TABLE print_agents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'print_agents'
                     AND policyname = 'tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON print_agents
            USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
    END IF;
END $$;

ALTER TABLE print_agents FORCE ROW LEVEL SECURITY;

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- The authentication lookup. UNIQUE across the whole table, not per tenant: the
-- lookup id is generated from a CSPRNG and a collision would mean two tenants'
-- agents shared a handle.
CREATE UNIQUE INDEX IF NOT EXISTS uq_print_agents_lookup
    ON print_agents (lookup_id);

-- The settings screen's list for one branch.
CREATE INDEX IF NOT EXISTS idx_print_agents_branch
    ON print_agents (tenant_id, branch_id, created_at);

-- ── Self-verification ────────────────────────────────────────────────────────
DO $$
DECLARE
    unforced text;
BEGIN
    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO unforced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity;

    IF unforced IS NOT NULL THEN
        RAISE EXCEPTION 'RLS enabled but NOT forced on: % — cross-tenant leak remains open', unforced;
    END IF;
END $$;
