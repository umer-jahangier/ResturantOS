-- ============================================================
-- Phase 2 — Activate RLS enforcement + branch isolation (pos_db)
-- DEFERRED: not in the live db/migration path. Apply deliberately per
-- deploy/pending-migrations/phase2-branch-tenant-rls/README.md, then restart pos-service.
-- Idempotent where practical (DROP POLICY IF EXISTS); FORCE is naturally idempotent.
-- ============================================================

-- ── 1) FORCE RLS on every tenant-scoped table ────────────────────────────────
-- pos_user OWNS these tables and the app connects as pos_user; without FORCE the
-- owner bypasses RLS, leaving tenant isolation inert for the app. Tenant policies
-- already exist (created in V1/V3) — FORCE simply makes them apply to the owner too.
ALTER TABLE menu_categories        FORCE ROW LEVEL SECURITY;
ALTER TABLE menu_items             FORCE ROW LEVEL SECURITY;
ALTER TABLE modifier_groups        FORCE ROW LEVEL SECURITY;
ALTER TABLE modifiers              FORCE ROW LEVEL SECURITY;
ALTER TABLE orders                 FORCE ROW LEVEL SECURITY;
ALTER TABLE order_items            FORCE ROW LEVEL SECURITY;
ALTER TABLE order_item_modifiers   FORCE ROW LEVEL SECURITY;
ALTER TABLE order_discounts        FORCE ROW LEVEL SECURITY;
ALTER TABLE order_payments         FORCE ROW LEVEL SECURITY;
ALTER TABLE order_refunds          FORCE ROW LEVEL SECURITY;
ALTER TABLE till_sessions          FORCE ROW LEVEL SECURITY;
ALTER TABLE dining_tables          FORCE ROW LEVEL SECURITY;
ALTER TABLE branch_menu_overrides  FORCE ROW LEVEL SECURITY;
ALTER TABLE order_sequences        FORCE ROW LEVEL SECURITY;

-- ── 2) Branch-aware RLS on the branch-LOCAL tables ───────────────────────────
-- Cross-branch access is never legitimate for these, so enforce branch at the DB.
-- Permissive when app.current_branch_id is unset → tenant-only fallback preserves
-- reporting/admin/system flows that run without a branch context.
--
-- NOT applied to orders/order_items/order_payments/order_refunds: the
-- pos.order.view.all permission is a legitimate cross-branch read, enforced in the
-- service layer (OrderServiceImpl.listOrderSummaries + requireOwnBranch). Those
-- tables keep the tenant-only policy (now FORCEd above).

DROP POLICY IF EXISTS tenant_isolation ON till_sessions;
CREATE POLICY tenant_branch_isolation ON till_sessions
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
        AND (
            NULLIF(current_setting('app.current_branch_id', TRUE), '') IS NULL
            OR branch_id = NULLIF(current_setting('app.current_branch_id', TRUE), '')::UUID
        )
    );

DROP POLICY IF EXISTS tenant_isolation ON dining_tables;
CREATE POLICY tenant_branch_isolation ON dining_tables
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
        AND (
            NULLIF(current_setting('app.current_branch_id', TRUE), '') IS NULL
            OR branch_id = NULLIF(current_setting('app.current_branch_id', TRUE), '')::UUID
        )
    );

DROP POLICY IF EXISTS tenant_isolation ON order_sequences;
CREATE POLICY tenant_branch_isolation ON order_sequences
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
        AND (
            NULLIF(current_setting('app.current_branch_id', TRUE), '') IS NULL
            OR branch_id = NULLIF(current_setting('app.current_branch_id', TRUE), '')::UUID
        )
    );

DROP POLICY IF EXISTS tenant_isolation ON branch_menu_overrides;
CREATE POLICY tenant_branch_isolation ON branch_menu_overrides
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
        AND (
            NULLIF(current_setting('app.current_branch_id', TRUE), '') IS NULL
            OR branch_id = NULLIF(current_setting('app.current_branch_id', TRUE), '')::UUID
        )
    );
