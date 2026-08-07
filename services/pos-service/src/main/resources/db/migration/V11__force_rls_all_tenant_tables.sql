-- ============================================================================
-- 17b-01 — Close the cross-tenant leak in pos_db by FORCEing row level security
-- ============================================================================
-- WHY
-- Every table below already had `ENABLE ROW LEVEL SECURITY` and a `tenant_isolation`
-- policy keyed on `app.current_tenant_id`. All of them are OWNED by `pos_user`, and
-- pos-service connects as `pos_user`. PostgreSQL exempts a table's owner from that
-- table's own RLS policies unless the table is additionally FORCEd — so the policies
-- were decorative and every tenant could read and write every other tenant's rows.
--
-- Measured before this migration (as pos_user, with app.current_tenant_id set to a
-- single tenant): `SELECT count(*) FROM menu_items` returned 78 rows across 16
-- tenants when the GUC's tenant owned 4. Over HTTP, a Floating Terrace manager could
-- GET another tenant's menu item (200) and add it to its own order (200, priced at
-- the foreign tenant's price).
--
-- WHY THIS IS SAFE
-- shared-lib's TenantAwareDataSourcePostProcessor wraps every DataSource bean in
-- TenantAwareDataSource, which sets `app.current_tenant_id` on each JDBC checkout.
-- inventory_db, finance_db, auth_db, hr_db and crm_db already run FORCEd on the same
-- mechanism. Confirmed empirically for pos-service before this migration was written:
-- FORCEing menu_items alone took the admin listing from 78 rows to exactly the 6 the
-- caller's tenant owns, with no error — so the GUC is genuinely set on this service's
-- connections.
--
-- SCOPE
-- FORCE only. This deliberately does NOT change any policy definition. Branch-level
-- RLS (deploy/pending-migrations/phase2-branch-tenant-rls) remains out of scope and
-- unapplied; it alters policy predicates and carries its own regression surface.
--
-- IDEMPOTENT: FORCE is a no-op when already set, and each table is guarded by
-- to_regclass so a re-run on a partially-migrated database cannot fail.
-- ============================================================================

DO $$
DECLARE
    t text;
    -- Every table in pos_db carrying a tenant_id + tenant_isolation policy.
    -- Verified against pg_class/pg_policies at authoring time (16 tables).
    tables text[] := ARRAY[
        'branch_menu_overrides',
        'dining_tables',
        'menu_categories',
        'menu_items',
        'modifier_groups',
        'modifiers',
        'order_discounts',
        'order_item_modifiers',
        'order_items',
        'order_payments',
        'order_refunds',
        'order_sequences',
        'orders',
        'stations',
        'till_review_actions',
        'till_sessions'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE 'skip %: table not present', t;
            CONTINUE;
        END IF;

        -- Guard: FORCEing a table that has no policy would deny ALL access to the
        -- owner, taking the service down rather than isolating it. Fail loudly at
        -- migration time instead of silently shipping an outage.
        IF NOT EXISTS (SELECT 1 FROM pg_policies
                       WHERE schemaname = 'public' AND tablename = t) THEN
            RAISE EXCEPTION 'refusing to FORCE %: no RLS policy exists on it', t;
        END IF;

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- ── Self-verification ────────────────────────────────────────────────────────
-- Fail the migration if any RLS-enabled table in this database is still unforced.
-- A silently-partial rollout here is a live cross-tenant leak, so it must not be
-- possible for this migration to report success while one is left open.
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
