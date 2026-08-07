-- ============================================================================
-- 17b-01 — Close the cross-tenant leak in purchasing_db by FORCEing RLS
-- ============================================================================
-- WHY
-- All 14 tables below already had `ENABLE ROW LEVEL SECURITY` and a
-- `tenant_isolation` policy on `app.current_tenant_id`, and all are OWNED by
-- `purchasing_user` — the role purchasing-service connects as. PostgreSQL exempts a
-- table's owner from its own RLS policies unless FORCE is also set, so the policies
-- never applied to the application.
--
-- Measured before this migration (as purchasing_user with the tenant GUC set to
-- Floating Terrace, which owns 1 vendor): `SELECT count(*) FROM vendors` returned 14
-- and `purchase_orders` returned 63. Over HTTP, GET /api/v1/purchasing/vendors
-- reported totalCount 14 to a tenant owning one.
--
-- WHY THIS IS SAFE
-- shared-lib's TenantAwareDataSourcePostProcessor wraps every DataSource bean in
-- TenantAwareDataSource, setting `app.current_tenant_id` per JDBC checkout;
-- inventory_db and finance_db already run FORCEd on that same mechanism.
--
-- SCOPE: FORCE only — no policy predicate is modified.
-- IDEMPOTENT: FORCE is a no-op when already set; each table is to_regclass-guarded.
-- ============================================================================

DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'ap_payment_allocations',
        'ap_payments',
        'mock_grn_receipts',
        'po_approval_records',
        'po_approval_tiers',
        'purchase_order_lines',
        'purchase_orders',
        'vendor_catalogues',
        'vendor_categories',
        'vendor_invoice_lines',
        'vendor_invoices',
        'vendor_item_prices',
        'vendor_items',
        'vendors'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF to_regclass('public.' || t) IS NULL THEN
            RAISE NOTICE 'skip %: table not present', t;
            CONTINUE;
        END IF;

        -- FORCEing a policy-less table denies the owner everything — an outage, not
        -- isolation. Fail at migration time rather than ship that.
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
