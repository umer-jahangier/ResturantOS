-- Cross-tenant registry for the nightly expiry sweep (D6 gap-closure, 08-VERIFICATION.md).
--
-- ExpirySweepService's real @Scheduled cron trigger runs with NO ambient TenantContext on the
-- background scheduler thread. Its tenant-discovery step previously queried stock_lots directly
-- (FORCE ROW LEVEL SECURITY, per V1) — under inventory-service's NOSUPERUSER NOBYPASSRLS role that
-- discovery query is bound by the same RLS policy as every other query on the table, so with no GUC
-- set it returned zero tenants, every night, for every tenant, forever.
--
-- This table is RLS-EXEMPT (mirrors V2__shared_infra_tables.sql's convention exactly: relay/
-- idempotency-style infra tables run outside tenant request context, so they carry no tenant
-- isolation policy at all) — it is NOT a domain table and NEVER stores tenant-scoped business data,
-- only the fact that a tenant exists. No BYPASSRLS grant, no FORCE-RLS relaxation on any domain
-- table: tenant isolation on stock_lots/ingredient_branch_stock/etc. is completely untouched.
--
-- Upserted (idempotent, ON CONFLICT DO NOTHING, same transaction as the stock write) by every
-- write path that FIRST persists tenant-scoped stock for a tenant — see TenantRegistryService.
CREATE TABLE inventory_tenant_registry (
    tenant_id  UUID PRIMARY KEY,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON inventory_tenant_registry TO inventory_user;
