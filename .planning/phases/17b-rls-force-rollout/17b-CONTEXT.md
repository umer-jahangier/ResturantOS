---
phase: 17b-rls-force-rollout
status: executed
created: 2026-08-07
severity: critical
class: cross-tenant-data-exposure
---

# Phase 17b — FORCE RLS rollout (pos / purchasing / kitchen) — CONTEXT

## Summary

33 tables across `pos_db`, `purchasing_db` and `kitchen_db` had `relrowsecurity = true`
but `relforcerowsecurity = false`, and every one of them was **owned by the exact role its
service connects as** (`pos_user`, `purchasing_user`, `kitchen_user`). PostgreSQL exempts a
table's owner from that table's own RLS policies unless the table is additionally `FORCE`d,
so the `tenant_isolation` policies were decorative: **every tenant could read and write every
other tenant's rows**. This phase forces RLS on all 33 tables and adds tenant predicates to
the two query paths that were reachable with a caller-supplied identifier.

This is a live cross-tenant read **and** write defect, not a hardening exercise.

## Verified current state — measured, not inferred

Measured on the live stack on 2026-08-07 before any change.

### The flag audit

```
pos_db          16 of 16 RLS tables NOT forced   (owner pos_user)
purchasing_db   14 of 14 RLS tables NOT forced   (owner purchasing_user)
kitchen_db       3 of  3 RLS tables NOT forced   (owner kitchen_user)
```

`inventory_db` (18/18), `auth_db` (6/6), `user_db` (1/1), `finance_db` (8/8), `hr_db` (15/15),
`crm_db` (6/6), `reporting_db` (1/1) and `file_db` (1/1) were already correct. Three services
were out of step with an established convention — not a design decision.

### The roles genuinely cannot bypass RLS by any other means

```
pos_user        | super=false | bypassrls=false
purchasing_user | super=false | bypassrls=false
kitchen_user    | super=false | bypassrls=false
```

So owner-bypass was the sole mechanism, and `FORCE` is the exact and complete remedy.

### Every table already had a usable policy

All 33 carry exactly one `PERMISSIVE` policy for `ALL` commands, keyed
`tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID`. None
specifies `WITH CHECK`, so Postgres reuses the `USING` expression for `INSERT`/`UPDATE`
checks — writes are covered as well as reads. **`FORCE` is therefore a pure tightening: no
policy predicate needed to change.**

### The leak, reproduced at the database as the real application role

```
SET ROLE pos_user;                       -- non-superuser, non-bypassrls, owner of the tables
SELECT set_config('app.current_tenant_id','d108c2e6-…',false);
menu_items VISIBLE total=78              -- across 16 tenants
menu_items OWN tenant=4
menu_items FOREIGN=74
```

Same story elsewhere: `purchasing_user` at Floating Terrace (which owns **1** vendor) saw
**14** vendors and **63** purchase orders; `kitchen_user` (which owns **25** tickets and **2**
stations) saw **112** tickets and **28** stations.

### The leak, reproduced over real HTTP with two tenants

Floating Terrace manager against Control Bistro's data:

| Probe | Before |
|---|---|
| `GET /api/v1/pos/menu/items/admin` | **78** items returned; tenant owns **6** |
| `GET /api/v1/pos/menu/items/{control-item}` | **200** — body included `"Chicken Karahi … Control Bistro (isolation test tenant) · tenant 5ae760de"` |
| `POST /api/v1/pos/orders/{id}/items` with a Control menu item | **200**, line accepted and **priced at the foreign tenant's 145000 paisa** |
| `GET /api/v1/purchasing/vendors` | `totalCount: 14`; tenant owns **1** |

## Why forcing is safe — confirmed empirically before rollout, not assumed

`shared-lib`'s `TenantAwareDataSourcePostProcessor` is a `BeanPostProcessor` that wraps
**every** `DataSource` bean in `TenantAwareDataSource`, which issues
`set_config('app.current_tenant_id', …, false)` on each JDBC checkout and resets it on
`close()`. All three services depend on `shared-lib` and inherit it via
`TenantDataSourceAutoConfiguration`.

Reading that code is not proof that it is live in these three services, so the precondition was
tested directly: `menu_items` alone was forced on the running system and the admin listing was
re-issued. It went from **78 rows to exactly the 6 the caller's tenant owns, with no error** —
demonstrating the GUC really is set on pos-service's connections. Only then was the rollout
completed.

The consumer path was verified the same way after rollout: a POS order sent to the kitchen
produced a `kds_tickets` row carrying the correct `tenant_id`, so
`TenantAwareMessageProcessor` establishes tenant context for RabbitMQ consumers too — they
are not silently blocked by forced RLS.

## Why this shipped undetected

**Testcontainers runs PostgreSQL as a superuser, and superusers bypass RLS unconditionally.**
No integration test in this repository can observe the owner-bypass, so the entire suite is
blind to this defect class. `deploy/pending-migrations/phase2-branch-tenant-rls/README.md`
names `OrderRlsIsolationIT` as the canary that "currently fails because of the owner-bypass" —
it does not fail under Testcontainers, because there the connecting role is a superuser and
RLS never applies either way. A green suite was never evidence here, and all proof in this
phase is taken from the live databases and over real HTTP instead.

## Prior art — this was known and deliberately deferred

`deploy/pending-migrations/phase2-branch-tenant-rls/` contains an unapplied package
(`pos/V7`, `kitchen/V7`, `pos/V8`) that diagnosed this exact owner-bypass and was
intentionally parked outside the live `db/migration` folders. It was never activated.

That package is **not** what shipped here, for three reasons:

1. It covers **14** pos tables; pos now has **16** — `stations` (V7) and `till_review_actions`
   (V9) were added after it was written and are missing from it.
2. It has **no purchasing coverage at all**, yet purchasing is 14 of the 33 leaking tables.
3. It bundles `FORCE` together with **branch-aware policy rewrites** (`DROP POLICY` /
   `CREATE POLICY tenant_branch_isolation`), which changes access semantics and carries a
   regression surface unrelated to closing the leak.

## Locked decisions

- **D-01** — Fix is `FORCE ROW LEVEL SECURITY` on all 33 tables. Not the "non-owner app role"
  alternative: that needs new roles, new grants, and credential changes in `deploy/.env` plus
  every service's datasource config, and it would leave the leak open for the whole of that
  rollout. `FORCE` is a single, reversible, in-database change with an existing precedent in
  six other databases.
- **D-02** — **`FORCE` only. No policy predicate is modified.** Branch-level RLS stays out of
  scope and the parked package stays parked. Mixing a semantics change into a security fix is
  how a security fix gets rolled back.
- **D-03** — Migrations are per-service Flyway files following each service's existing numbering
  (`pos V11`, `purchasing V7`, `kitchen V8`), matching the tool already configured in all three
  (`spring.flyway.enabled: true`, `baseline-on-migrate: false`).
- **D-04** — Migrations are idempotent and self-verifying: each guards on `to_regclass`, refuses
  to force a table that has **no policy** (which would deny the owner everything and cause an
  outage rather than isolation), and ends with a block that raises if any RLS-enabled table in
  the database is still unforced. A partially-applied rollout is a live leak, so it must not be
  able to report success.
- **D-05** — Belt-and-braces tenant predicates are added only where a **caller-supplied
  identifier** reaches a lookup: `findByClientOrderId` and the `addItem` menu-item resolution.
  The remaining unscoped finders are RLS-enforced by design, and are now genuinely enforced.

## Constraints / conventions honored

- Follows the established FORCE-RLS convention already documented for inventory
  (`ENABLE` + `FORCE` + NULLIF-guarded `tenant_isolation`).
- No policy is disabled or weakened anywhere. Where a query returned nothing under forced RLS,
  the query is what gets fixed.
- Owner-bypass is not used as a workaround in any migration or query.
- Proof is taken as a non-superuser role against the live databases and over real HTTP, never
  from a green Testcontainers run.

## Out of scope

- Branch-level RLS policies (`deploy/pending-migrations/phase2-branch-tenant-rls`) — unchanged
  and still unapplied.
- The other 13 databases — audited and already correct; not modified.
- `services/auth-service`, `services/hr-service`, `services/audit-service`, `shared-lib`,
  `frontend/` — concurrent work by others, deliberately untouched.
- Adding tenant predicates to every RLS-reliant finder in the three services — reported in the
  audit table in the SUMMARY, but not changed: RLS is the designed enforcement layer and mass
  query rewrites carry more regression risk than they retire.
