# Phase 2 — DB-level tenant + branch isolation (DEFERRED / not yet applied)

These migrations activate **row-level security enforcement** and add **branch-aware
isolation** at the database layer. They are **intentionally kept out of the live
`db/migration` folders** so a normal service restart does **not** auto-apply them —
apply them deliberately (below) when you are ready to verify the activation, not in
the middle of unrelated testing.

Until these are applied, branch/tenant isolation is enforced at the **service layer**
(the `requireOwnBranch` guards added in Phase 1 + the Phase 2 sweep). Those guards are
live and tested and do not depend on this package.

## Why this exists — the finding

On the running databases, every pos/kitchen domain table was `rls_enabled = true` but
`rls_forced = false`, and the tables are **owned by the same role the app connects as**
(`pos_user` / `kitchen_user`). PostgreSQL **bypasses RLS for a table's owner** unless the
table is `FORCE`d, so tenant RLS was **inert for the app in production** — the only tenant
scoping actually in effect was the Hibernate `tenantFilter` (an ORM filter that native
queries bypass).

`finance_db` tables are already `FORCE`d and run correctly, which is the proof that the
shared-lib GUC mechanism (`app.current_tenant_id` set per connection) works with FORCE
without breaking the app. This package brings pos + kitchen to parity and adds branch
scoping.

## What the shared-lib change already did (already live)

`TenantAwareDataSource` / `TenantGucHelper` now set **`app.current_branch_id`** on every
connection alongside `app.current_tenant_id` (transaction-local). This is harmless on its
own — nothing reads the branch GUC until the branch policies below are applied.

## Contents

| File | DB | Effect |
|------|----|--------|
| `pos/V7__force_rls_and_branch_isolation.sql` | pos_db | `FORCE` RLS on all 14 tables; branch-aware policy on the 4 branch-local tables |
| `pos/V8__payments_refunds_branch_id.sql` | pos_db | Add + backfill `branch_id` on `order_payments` / `order_refunds` (requires the companion code changes below) |
| `kitchen/V7__force_rls_and_branch_isolation.sql` | kitchen_db | `FORCE` RLS on the 3 tables; branch-aware policy on `kds_stations` / `kds_tickets` |

`finance_db` needs nothing (already `FORCE`d).

### Design note — why `orders`/`order_items`/`order_payments`/`order_refunds` stay tenant-only at the DB layer

A blanket branch RLS policy on `orders` would break the legitimate **`pos.order.view.all`**
cross-branch read (enforced today in `OrderServiceImpl.listOrderSummaries`). So those tables
get `FORCE` (tenant enforcement) but keep the **tenant-only** policy; their branch scoping
stays in the service layer where the view-all permission is honoured. The branch-aware DB
policy is applied only to tables where cross-branch access is never legitimate
(`till_sessions`, `dining_tables`, `order_sequences`, `branch_menu_overrides`,
`kds_stations`, `kds_tickets`).

The branch policies are **permissive when the branch GUC is unset** — so any flow that runs
without a branch context (reporting, admin, system jobs) falls back to tenant-only scoping
rather than returning zero rows.

## Companion code changes required for `V8` (payments/refunds branch_id)

`V8` makes `branch_id` `NOT NULL`, so the entities and write paths must set it **before**
applying, or new inserts fail:

- `OrderPayment` entity: add `@Column(name = "branch_id") private UUID branchId;` (+ getter/setter)
- `OrderRefund` entity: same
- `PaymentServiceImpl.recordPayment(...)`: set `payment.setBranchId(order.getBranchId())`
- `RefundServiceImpl` (refund creation): set `refund.setBranchId(order.getBranchId())`

Apply `V8` and these code changes together in the same deployment.

## Activation steps

1. Pick a quiet window (this changes DB behavior for the whole service on restart).
2. Copy each SQL file into that service's `src/main/resources/db/migration/` folder,
   renaming to the next free `V<N>__…` for that service (pos is currently at V6,
   kitchen at V6 — so V7/V8 are free, but re-check before copying).
3. For `V8`, land the companion entity/service code changes in the same build.
4. Restart the service; Flyway applies the migration on startup.
5. Run the verification queries below.

## Verification (after applying)

```sql
-- 1) FORCE is now on (expect rls_forced = t for all rows):
SELECT relname, relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND relrowsecurity ORDER BY 1;

-- 2) Tenant isolation now actually enforced against the app owner. As pos_user, with a
--    tenant GUC set, a row from a different tenant must NOT be visible:
--    SELECT set_config('app.current_tenant_id', '<tenantA>', false);
--    SELECT count(*) FROM orders;   -- only tenantA's orders

-- 3) Branch isolation on a branch-local table (set both GUCs to branch A, query a
--    branch-B till → 0 rows):
--    SELECT set_config('app.current_branch_id', '<branchA>', false);
--    SELECT count(*) FROM till_sessions WHERE branch_id = '<branchB>';  -- expect 0
```

The pos integration test `OrderRlsIsolationIT.order_created_under_tenantA_not_visible_under_tenantB`
currently **fails** because of the owner-bypass (RLS not forced); once `V7` is applied (or the
non-owner-role option below is used), that test passes — it is the canary for this activation.

## Alternative: non-owner app role (instead of FORCE)

The production-standard alternative is to have the app connect as a role that is **not** the
table owner; `ENABLE` RLS then applies to the app while migrations (run as the owner) still
bypass it. That avoids `FORCE` entirely but requires: creating e.g. `pos_app` /
`kitchen_app` roles, granting them `SELECT/INSERT/UPDATE/DELETE` on the domain tables, and
changing `POS_DB_USER` / `KITCHEN_DB_USER` (and passwords) in `deploy/.env` + each service's
datasource config. Same restart + verification applies. If you choose this route, the branch
policies in `V7` are still needed; only the `FORCE` statements become unnecessary.

## Rollback

```sql
-- pos_db
ALTER TABLE <each table> NO FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_branch_isolation ON till_sessions;
CREATE POLICY tenant_isolation ON till_sessions
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
-- …repeat restore for dining_tables, order_sequences, branch_menu_overrides
-- (kitchen analogously; drop tenant_branch_isolation, recreate <table>_tenant_isolation)
```
