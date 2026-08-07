-- ============================================================================
-- 17b-01 — Close the cross-tenant leak in kitchen_db by FORCEing RLS
-- ============================================================================
-- WHY
-- kds_stations, kds_tickets and kds_ticket_items each had `ENABLE ROW LEVEL
-- SECURITY` and a tenant policy on `app.current_tenant_id`, and all are OWNED by
-- `kitchen_user` — the role kitchen-service connects as. PostgreSQL exempts the
-- owner from its own policies unless FORCE is set, so tenant isolation was inert.
--
-- Measured before this migration (as kitchen_user with the tenant GUC set to
-- Floating Terrace, which owns 25 tickets and 2 stations): `kds_tickets` returned
-- 112 rows and `kds_stations` returned 28.
--
-- Note the KDS HTTP endpoints take an explicit branchId and filter on it in the
-- service layer, which masked the hole for those specific reads. The hole was still
-- real: any query path not carrying that filter — a native query, an event consumer,
-- a lookup by ticket or order id — saw every tenant's tickets.
--
-- WHY THIS IS SAFE
-- shared-lib's TenantAwareDataSourcePostProcessor wraps every DataSource bean in
-- TenantAwareDataSource, setting `app.current_tenant_id` per JDBC checkout.
-- kitchen-service additionally consumes RabbitMQ events through
-- TenantAwareMessageProcessor, which establishes the same TenantContext before the
-- handler runs — so consumer paths carry a tenant too.
--
-- SCOPE: FORCE only — no policy predicate is modified. The branch-aware policies in
-- deploy/pending-migrations/phase2-branch-tenant-rls remain out of scope.
-- IDEMPOTENT: FORCE is a no-op when already set; each table is to_regclass-guarded.
-- ============================================================================

DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'kds_stations',
        'kds_ticket_items',
        'kds_tickets'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE 'skip %: table not present', t;
            CONTINUE;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM pg_policies
                       WHERE schemaname = 'public' AND tablename = t) THEN
            RAISE EXCEPTION 'refusing to FORCE %: no RLS policy exists on it', t;
        END IF;

        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

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
