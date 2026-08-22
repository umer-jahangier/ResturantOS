-- Privileged fixups that Liquibase structurally cannot perform.
--
-- Liquibase runs as the SERVICE role (auth_user), and auth_user is a member of no
-- roles. Postgres only lets you assign object ownership to a role you belong to, so
-- anything needing superuser ownership can never be expressed as a changeset. This
-- file is where those live. It is applied by the deploy pipeline, as the superuser,
-- AFTER the rollout so the objects it adjusts already exist.
--
-- Everything here MUST be idempotent: it runs on every deploy.
--
-- ── The defect this repairs ──────────────────────────────────────────────────
-- /api/v1/auth/refresh returned 401 "Invalid refresh session" for EVERY user, on the
-- FIRST replay of a freshly minted token, reproducible with curl and no browser.
--
-- Refresh has a genuine chicken-and-egg: it must learn which tenant a token belongs
-- to BEFORE it can set app.current_tenant_id. The design solves that with
-- auth_lookup_refresh_tenant(), a SECURITY DEFINER function (changeset 052) — the
-- right idea. But SECURITY DEFINER executes as the function's OWNER, that owner was
-- auth_user, and refresh_sessions carries FORCE ROW LEVEL SECURITY, which applies to
-- precisely that role. With no GUC set, NULLIF(current_setting(...),'')::uuid is NULL
-- and tenant_isolation matches nothing. So the lookup that exists to ESCAPE tenant
-- scoping was itself gated BY tenant scoping. Measured as auth_user with no GUC:
-- 0 rows visible, function returns NULL.
--
-- This does NOT widen isolation. The table stays invisible to a tenantless
-- connection; only the narrow token-hash -> tenant_id lookup is let through, and an
-- unknown hash still returns NULL rather than becoming an oracle. The second block
-- asserts both properties on every deploy rather than trusting that the first ran.

DO $do$
DECLARE su TEXT := current_user;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auth_lookup_refresh_tenant') THEN
        RAISE EXCEPTION 'auth_lookup_refresh_tenant is absent - changeset 052 did not run';
    END IF;
    EXECUTE format('ALTER FUNCTION auth_lookup_refresh_tenant(text) OWNER TO %I', su);
    -- NOT optional: ALTER ... OWNER resets the ACL, so auth_user loses EXECUTE and a
    -- second 401 hides behind the first.
    EXECUTE 'GRANT EXECUTE ON FUNCTION auth_lookup_refresh_tenant(text) TO auth_user';
END
$do$;

DO $do$
DECLARE h TEXT; t UUID; direct INT;
BEGIN
    SELECT token_hash INTO h FROM refresh_sessions ORDER BY created_at DESC LIMIT 1;
    IF h IS NULL THEN
        RAISE NOTICE 'no refresh_sessions row yet - repair applied, assertion skipped';
        RETURN;
    END IF;

    SET LOCAL ROLE auth_user;
    SELECT auth_lookup_refresh_tenant(h) INTO t;
    SELECT count(*) INTO direct FROM refresh_sessions WHERE token_hash = h;
    RESET ROLE;

    IF t IS NULL THEN
        RAISE EXCEPTION 'refresh bootstrap STILL broken: lookup returned NULL as auth_user';
    END IF;
    IF direct <> 0 THEN
        RAISE EXCEPTION 'tenant isolation WIDENED: a tenantless connection saw % refresh row(s)', direct;
    END IF;
    RAISE NOTICE 'refresh bootstrap OK - tenant resolved, table still isolated';
END
$do$;
