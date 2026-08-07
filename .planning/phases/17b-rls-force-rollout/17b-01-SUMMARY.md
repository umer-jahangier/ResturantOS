---
phase: 17b-rls-force-rollout
plan: 01
subsystem: data-isolation
tags: [security, rls, multi-tenancy, postgres, cross-tenant-leak]
status: complete
severity: critical
requires:
  - shared-lib TenantAwareDataSourcePostProcessor (already live)
provides:
  - FORCE ROW LEVEL SECURITY on all 33 previously-unforced tables
  - tenant-scoped idempotency + menu-item lookups on the POS order write path
  - the first regression tests in this repo able to detect owner-bypass RLS
affects:
  - services/pos-service
  - services/purchasing-service
  - services/kitchen-service
tech-stack:
  added: []
  patterns: [idempotent self-verifying flyway migration, non-superuser RLS canary test]
key-files:
  created:
    - services/pos-service/src/main/resources/db/migration/V11__force_rls_all_tenant_tables.sql
    - services/purchasing-service/src/main/resources/db/migration/V7__force_rls_all_tenant_tables.sql
    - services/kitchen-service/src/main/resources/db/migration/V8__force_rls_all_tenant_tables.sql
    - services/pos-service/src/test/java/io/restaurantos/pos/RlsForcedInvariantIT.java
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/RlsForcedInvariantIT.java
    - services/kitchen-service/src/test/java/io/restaurantos/kitchen/RlsForcedInvariantIT.java
  modified:
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/OrderRepository.java
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/MenuItemRepository.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java
decisions: [D-01, D-02, D-03, D-04, D-05]
metrics:
  tables_forced: 33
  tests_run: 338
  tests_failed: 0
completed: 2026-08-07
---

# Phase 17b Plan 01: FORCE RLS rollout (pos / purchasing / kitchen) Summary

Closed a live cross-tenant read **and** write exposure by forcing RLS on 33 owner-bypassed
tables across `pos_db`, `purchasing_db` and `kitchen_db`, and added the first tests in this
repository capable of detecting the defect class.

## The defect, independently reproduced before any change

The reported flag audit was confirmed exactly: 33 tables with `relrowsecurity = true`,
`relforcerowsecurity = false`, each owned by the role its service connects as.

`pos_user`, `purchasing_user` and `kitchen_user` were verified `rolsuper = false` and
`rolbypassrls = false`, so **owner-bypass was the only mechanism in play** and `FORCE` is the
exact, complete remedy.

**At the database, as the real application role:**

```
SET ROLE pos_user;
SELECT set_config('app.current_tenant_id','d108c2e6-…',false);
menu_items VISIBLE total=78 | OWN tenant=4 | FOREIGN=74
```

| Role @ Floating Terrace | Owned | Visible before |
|---|---|---|
| `pos_user` — `menu_items` | 6 | **78** |
| `purchasing_user` — `vendors` | 1 | **14** |
| `purchasing_user` — `purchase_orders` | 12 | **63** |
| `kitchen_user` — `kds_tickets` | 25 | **112** |
| `kitchen_user` — `kds_stations` | 2 | **28** |

**Over real HTTP, two tenants:**

| Probe | Before | After |
|---|---|---|
| `GET /pos/menu/items/admin` (terrace) | **78** items | **8** — all terrace's own |
| `GET /pos/menu/items/{control-item}` | **200** — returned `"Chicken Karahi … Control Bistro (isolation test tenant) · tenant 5ae760de"` | **404** |
| `POST /pos/orders/{id}/items` with a control item | **200**, line accepted, **priced at the foreign 145000 paisa** | **404** |
| `GET /purchasing/vendors` (terrace) | `totalCount: 14` | `totalCount: 1` |

Bidirectional after the fix — terrace sees 8/8 own, control sees 3/3 own, each gets **200** on
its own item and **404** on the other's, in both directions.

## Safety precondition — tested, not assumed

The mandate to confirm the GUC wiring before forcing was taken literally. Rather than infer it
from `TenantAwareDataSourcePostProcessor`, `menu_items` alone was forced on the running system
and the admin listing re-issued: **78 rows → exactly the 6 the caller's tenant owned, no
error**. Only then was the rest rolled out.

The consumer path was checked the same way afterwards: a POS order sent to the kitchen produced
a `kds_tickets` row with the correct `tenant_id`, confirming `TenantAwareMessageProcessor`
establishes tenant context for RabbitMQ consumers — they are not silently blocked by FORCE.

## What was built

**Three idempotent, self-verifying Flyway migrations** (`pos V11`, `purchasing V7`,
`kitchen V8`) — each guards every table on `to_regclass`, **refuses to force a table that has
no policy** (which would deny the owner everything and cause an outage rather than isolation),
and ends with a block that raises if any RLS-enabled table in that database is still unforced.
A partially-applied rollout is a live leak, so the migration cannot report success while one
remains open.

Idempotency is proven, not claimed: pos-service was restarted after the SQL had already been
applied, and **Flyway ran V11 through its normal startup path against an already-forced
database and recorded `success=true`**.

**Two belt-and-braces query fixes** on the paths reachable with a caller-supplied identifier:

- `OrderRepository.findByClientOrderId` → `findByTenantIdAndClientOrderId`. This was an
  idempotency **oracle**: `clientOrderId` is client-supplied, so posting another tenant's value
  returned that tenant's full order — items and totals — as a "replayed" 200. Single caller
  (`createOrder`), so a small blast radius, but on the order-creation critical path.
- `MenuItemRepository.findByIdAndTenantId`, used by `OrderServiceImpl.addItem` in place of the
  inherited `findById`. This was the proven cross-tenant **write** vector.

Idempotency behaviour is preserved — a replayed `clientOrderId` still returns the same order id
(verified live).

**Three regression tests** (`RlsForcedInvariantIT` per service) — see below.

## The test gap this closes

Testcontainers runs PostgreSQL as a **superuser**, and superusers bypass RLS unconditionally.
Every existing integration test therefore ran in a world where RLS never applied at all — which
is exactly why 33 tables shipped with inert isolation and nothing caught it. A green suite was
never evidence here.

The new tests work around that in two ways:

1. **Schema invariant** (all three services) — asserts no table is `ENABLE`d without `FORCE`.
   Superuser-independent, and catches a *new* table being added with `ENABLE` only.
2. **Behavioural canary** (pos) — creates a `NOSUPERUSER NOBYPASSRLS` role, makes it the
   **owner** of `menu_items` (production's exact shape), and asserts it cannot see another
   tenant's rows while still seeing its own.

**These were mutation-tested.** With `menu_items` temporarily removed from the migration, both
failed with the real diagnosis — `Expecting empty but was: ["menu_items"]` and *"The owning role
saw another tenant's menu_items…"* — then passed again once restored. A guard that cannot fail
is worthless, so this was verified rather than assumed.

## Repository audit — all 28 repositories in the three services

Every `@Query` and derived finder was extracted and classified.

| Service | Repos | Finders with a tenant predicate | Relying on RLS |
|---|---|---|---|
| pos | 12 | 3 | ~30 |
| purchasing | 12 | 21 | ~10 |
| kitchen | 4 | 0 | 12 |

**Fixed (2)** — the two above, both reachable with a caller-supplied identifier.

**Deliberately not changed** — the remainder rely on RLS by design, which is the architecture;
they were inert only because RLS was inert. Rewriting ~50 finders would carry more regression
risk than it retires. That this is now genuinely enforced was verified on paths left unpatched:

- `MenuServiceImpl.findById` (menu item **update**): terrace updating control's item → **404**,
  and control's row confirmed byte-for-byte unchanged (`Chicken Karahi | 145000`).
- `OrderRepository.findById` (order read): terrace reading control's order → **404**.

Two notable finders worth recording, both now correct under FORCE:

- `OrderRepository.countOpenOrdersByBusinessDateRange` — a **native** query whose javadoc says
  "for the current tenant via RLS". With RLS inert it counted *every* tenant's open orders.
- `OrderRepository` already carried a comment stating pos_db was "`ENABLE` (not `FORCE`) … so
  RLS is inert on this connection" — the owner-bypass was known and written down at least as
  far back as that method.

## Prior art

`deploy/pending-migrations/phase2-branch-tenant-rls/` contained an unapplied package that
diagnosed this exact bypass and was parked outside the live migration folders. It was **not**
used: it covers 14 pos tables (pos now has 16 — `stations` and `till_review_actions` came
later), has **no purchasing coverage at all** despite purchasing being 14 of the 33, and bundles
`FORCE` with branch-aware policy rewrites. That package remains unapplied and untouched.

## Verification

**`mvn -pl services/pos-service,services/purchasing-service,services/kitchen-service verify`
→ BUILD SUCCESS, exit 0.**

```
purchasing-service ... SUCCESS   18 unit + 108 IT
pos-service .......... SUCCESS   60 unit + 122 IT
kitchen Service ...... SUCCESS   30
Total 338 tests, 0 failures, 0 errors
```

**POS flows over HTTP, end to end after the change:** waiter creates order → adds own item →
idempotent replay returns the same order id → send-to-KDS 200 → serve 200 → **cashier settles
CASH 200** → order `CLOSED` → payment row persisted with the correct tenant → KDS ticket written
by the event consumer with the correct tenant.

The silent-empty-result failure mode was specifically hunted and not found: every read that
should return data still does (terrace 8/8 menu items, 2 stations, 1 vendor, purchase orders and
tickets HTTP 200), and every read that should be blocked returns **404**, never an empty 200.

## Deviations from plan

**1. [Rule 2 — missing critical functionality] Added regression tests**
The plan called for migrations and query fixes. No test in the repo could detect this defect
class, which is the direct reason it shipped; leaving that gap open would invite recurrence.
Three `RlsForcedInvariantIT` classes were added and mutation-tested.

**2. [Rule 1 — bug] Cleared 37 stale macOS `" 2"` duplicates**
The first `verify` failed with `Unable to find a single main class … [PosServiceApplication 2,
PosServiceApplication]`. An initial sweep scoped to `*/target/*` missed them; `mvn clean` on the
three modules cleared all 37.

## Incident caused during execution — pos-service required a restart

`mvn clean` + `verify` replaced `services/pos-service/target/pos-service-1.0.0.jar` **underneath
the running dev instance**, which had been launched as `java -jar` from that path. The JVM kept
answering `/actuator/health` with `200` while every real endpoint returned no response at all
(`curl` exit code 000) — health checks stayed green while the service was actually dead, which
is worth knowing independently of this phase.

Resolved by restarting it via `scripts/local-service-env.sh`. That restart is what exercised the
real Flyway path and proved the migration idempotent. purchasing and kitchen were checked and
were unaffected (both answering `403` on real endpoints, i.e. serving normally).

## Findings reported, not acted on

**Residual cross-tenant contamination — 26 `order_items` across 22 orders** reference a menu
item belonging to a different tenant than the order. All were created today between
`00:30:55Z` and `02:23:48Z` — the window in which the leak was being demonstrated, not
long-standing production damage. Affected tenants include `test`, `zaitoon-kitchen`,
`floating-terrace` and three tenant ids with no row in `platform_db.tenants`.

This is **not** cleaned up here: it is another agent's evidence, deleting 22 orders is
destructive and irreversible, and it is out of this phase's scope. The one contaminated order
this phase created while proving the leak (`cc165d68…`, a terrace order holding control's
"Chicken Karahi") **was** removed.

Detection query:

```sql
SELECT count(*) FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN menu_items mi ON mi.id = oi.menu_item_id
WHERE mi.tenant_id <> o.tenant_id;
```

**Gateway 503s from a flapping circuit breaker** were seen intermittently throughout, on
untouched services too (`inventory` returned 503 while `purchasing` returned 200 in the same
sweep). Confirmed unrelated to RLS: a 24/24 interleaved burst across both tenants returned 200
every time, and the foreign-item probe returned a consistent 404 on 5 consecutive attempts.
Attributable to the concurrent restarts in `auth-service` / `hr-service` / `audit-service`.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path, file access pattern or trust-boundary schema change.
This phase only tightens an existing boundary.

## Self-Check: PASSED

All six created files verified present on disk; all three modified files verified to contain
the intended changes; `mvn verify` exit 0 across all three services; all 33 tables confirmed
`relforcerowsecurity = true` in the live databases.
