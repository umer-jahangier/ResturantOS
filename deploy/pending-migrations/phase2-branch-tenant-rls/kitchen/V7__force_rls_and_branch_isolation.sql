-- ============================================================
-- Phase 2 — Activate RLS enforcement + branch isolation (kitchen_db)
-- DEFERRED: not in the live db/migration path. Apply deliberately per
-- deploy/pending-migrations/phase2-branch-tenant-rls/README.md, then restart kitchen-service.
-- ============================================================

-- ── 1) FORCE RLS ─────────────────────────────────────────────────────────────
-- kitchen_user owns these tables and the app connects as kitchen_user; without
-- FORCE the owner bypasses RLS. Tenant policies already exist (created in V1).
ALTER TABLE kds_stations     FORCE ROW LEVEL SECURITY;
ALTER TABLE kds_tickets      FORCE ROW LEVEL SECURITY;
ALTER TABLE kds_ticket_items FORCE ROW LEVEL SECURITY;

-- ── 2) Branch-aware RLS on the branch-local tables ───────────────────────────
-- KDS stations and tickets are inherently branch-local (a kitchen display serves
-- exactly one branch); cross-branch access is never legitimate. Permissive when the
-- branch GUC is unset → tenant-only fallback. kds_ticket_items stays tenant-only
-- (its branch is derived through the parent ticket).

DROP POLICY IF EXISTS kds_stations_tenant_isolation ON kds_stations;
CREATE POLICY kds_stations_tenant_branch_isolation ON kds_stations
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
        AND (
            NULLIF(current_setting('app.current_branch_id', TRUE), '') IS NULL
            OR branch_id = NULLIF(current_setting('app.current_branch_id', TRUE), '')::UUID
        )
    );

DROP POLICY IF EXISTS kds_tickets_tenant_isolation ON kds_tickets;
CREATE POLICY kds_tickets_tenant_branch_isolation ON kds_tickets
    USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID
        AND (
            NULLIF(current_setting('app.current_branch_id', TRUE), '') IS NULL
            OR branch_id = NULLIF(current_setting('app.current_branch_id', TRUE), '')::UUID
        )
    );
