---
phase: 08-inventory-recipe-management
plan: 08
subsystem: inventory
tags: [spring-boot, jpa, postgres, rls, rabbitmq, scheduled, opa, java25]

# Dependency graph
requires:
  - phase: 08-inventory-recipe-management (plan 03)
    provides: Stock-domain entities/repositories (findForUpdate PESSIMISTIC_WRITE, FEFO lot-walk ordering), IngredientBranchStock.reorder_point
  - phase: 08-inventory-recipe-management (plan 09)
    provides: InventoryAuthorizationService (authorizeManage OPA seam)
  - phase: 08-inventory-recipe-management (plan 01)
    provides: InventoryEventPayloads (CountVariancePostedPayload/LowStockAlertPayload/ExpiryAlertPayload), transactional outbox, @EnableScheduling on InventoryServiceApplication
provides:
  - StockCount/StockCountLine entities + StockCountRepository/StockCountLineRepository
  - StockCountService.postCount — count-sheet variance posting under findForUpdate PESSIMISTIC_WRITE (sorted-lock, Pitfall 6), COUNT_VARIANCE movement (HALF_UP cost), reorder-breach LOW_STOCK_ALERT helper, COUNT_VARIANCE_POSTED via transactional outbox
  - StockCountController (/api/v1/inventory/counts) — OPA-gated (authorizeManage, T-8-AC)
  - ExpirySweepService — nightly @Scheduled FEFO expiry sweep (configurable lead-days/cron), EXPIRY_ALERT via transactional outbox
  - StockLotRepository.findDistinctTenantIdsWithExpiringLots — the sweep's tenant-discovery query
affects: [Phase 9 (finance) — COUNT_VARIANCE_POSTED is event-only, Phase 9 posts the GL entry; notification-service — LOW_STOCK_ALERT/EXPIRY_ALERT downstream consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Multi-tenant @Scheduled sweep over an RLS-FORCE domain table: resolve the distinct tenant set visible under the ambient TenantContext, then per-tenant push the RLS GUC onto the ALREADY-OPEN transaction via TenantGucHelper.apply (not a fresh tenantContext.set + reliance on TenantAwareDataSource's checkout-time write, which only fires once per connection acquisition) — avoids the Spring self-invocation @Transactional pitfall of annotating a same-class-called per-tenant method."
    - "ThreadLocalTenantContext.restore(null) is a no-op, not a clear — any try/finally that snapshots-then-restores across a background/scheduled boundary MUST explicitly tenantContext.clear() when the snapshot was null, or the just-set tenant leaks onto the pooled/scheduler thread."

key-files:
  created:
    - services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/StockCount.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/StockCountLine.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/StockCountRepository.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/StockCountLineRepository.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/dto/StockCountDtos.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/service/StockCountService.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/web/StockCountController.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/service/ExpirySweepService.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/StockCountIT.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/LowStockAlertIT.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/StockCountAccessControlIT.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/ExpirySweepIT.java
  modified:
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/StockLotRepository.java

key-decisions:
  - "StockCountLineRepository added (Rule 2, not in plan's files_modified) — every other line-entity in this phase (StockTransferLine) has its own flat-FK repository, not a JPA @OneToMany cascade collection; StockCountLine needed the same to be persistable at all, and the codebase-wide convention (separate repository per line entity) was followed for consistency."
  - "ExpirySweepService.sweep() is the SOLE @Transactional boundary (never a per-tenant self-invoked @Transactional method) — Spring's proxy silently skips @Transactional on same-class method calls, and switching RLS tenant mid-transaction requires TenantGucHelper.apply (transaction-local set_config) on the already-open connection, not a fresh tenantContext.set relying on TenantAwareDataSource's connection-checkout-time GUC write (which only fires once per checkout, not per loop iteration)."
  - "Documented (not silently worked around) a genuine architecture constraint: stock_lots carries FORCE ROW LEVEL SECURITY and inventory-service's DB role is NOSUPERUSER NOBYPASSRLS, so the sweep's distinct-tenant discovery query is itself bound by the same RLS policy as every other query on the table — it can only see tenants visible under whatever TenantContext is ALREADY ambient when sweep() is invoked. In the real cron path (no ambient context on a background thread) this means the discovery query finds zero tenants and the sweep is presently a no-op across a cold multi-tenant fleet. Closing this fully would require a Rule-4 architectural change (a cross-tenant registry or a BYPASSRLS service account) outside this plan's stated scope; ExpirySweepIT proves the sweep's per-tenant filtering logic correctly via direct invocation with an ambient single-tenant test context, exactly matching the plan's own acceptance criteria ('direct invocation with a fixed clock', not real end-to-end cross-tenant cron dispatch)."

patterns-established:
  - "Pattern: StockCountService's publishLowStockAlertIfBreached helper mirrors DepletionService's inline reorder-point check verbatim — any future stock-mutating service should extract the same small helper rather than re-inlining the breach comparison."

requirements-completed: [INV-06]

coverage:
  - id: D1
    description: "StockCount/StockCountLine entities + StockCountRepository/StockCountLineRepository, mapped to the V1 stock_counts/stock_count_lines schema"
    requirement: "INV-06"
    verification:
      - kind: unit
        ref: "mvn -pl services/inventory-service -am test-compile (exit 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "StockCountService.postCount computes per-ingredient variance (counted vs system qty) under findForUpdate PESSIMISTIC_WRITE + sorted-ingredientId locking, adjusts qty_on_hand, writes a COUNT_VARIANCE movement with variance_cost_paisa = round(varianceQty x avg_cost_paisa) HALF_UP, sets the count POSTED, and publishes COUNT_VARIANCE_POSTED through the transactional outbox"
    requirement: "INV-06"
    verification:
      - kind: integration
        ref: "StockCountIT — 2/2 pass (countedQty>systemQty raises qty + positive variance movement + outbox row; countedQty<systemQty lowers qty + negative variance) — live Testcontainers Postgres"
        status: pass
    human_judgment: false
  - id: D3
    description: "An adjustment (via count post) driving qty_on_hand to or below the ingredient's reorder_point publishes LOW_STOCK_ALERT; staying above does not"
    requirement: "INV-06"
    verification:
      - kind: integration
        ref: "LowStockAlertIT — 2/2 pass (breach-at-reorder-point publishes exactly 1 LOW_STOCK_ALERT; staying above publishes 0) — live Testcontainers Postgres"
        status: pass
    human_judgment: false
  - id: D4
    description: "StockCountController enforces InventoryAuthorizationService.authorizeManage on POST /counts (T-8-AC) — a JWT without inventory.item.manage is denied 403 with zero COUNT_VARIANCE movements/outbox rows written; an INVENTORY_MANAGER JWT succeeds"
    requirement: "INV-06"
    verification:
      - kind: integration
        ref: "StockCountAccessControlIT — 2/2 pass (view-only 403 + zero movements/outbox rows; INVENTORY_MANAGER 200 + exactly 1 movement) — MockMvc + real Spring Security dispatch, live Testcontainers Postgres"
        status: pass
    human_judgment: false
  - id: D5
    description: "ExpirySweepService: a public sweep(today, leadDays) method plus a @Scheduled nightlySweep() trigger (configurable cron default '0 0 2 * * *', lead-days default 3) publishes EXPIRY_ALERT for stock_lots with expiry_date <= today+leadDays AND qty>0; lots beyond the window or with qty=0 produce none"
    requirement: "INV-06"
    verification:
      - kind: integration
        ref: "ExpirySweepIT — 2/2 pass (mixed-expiry/qty fixture: exactly 2 of 4 seeded lots qualify and publish EXPIRY_ALERT; a no-qualifying-lots case publishes zero) — direct invocation with a fixed LocalDate, live Testcontainers Postgres"
        status: pass
    human_judgment: false
  - id: D6
    description: "Cross-tenant sweep dispatch in the real (non-test) @Scheduled cron path — the distinct-tenant discovery query is bound by the same FORCE RLS policy as every other stock_lots query and can only see tenants visible under an ALREADY-ambient TenantContext, which does not exist on a cold background scheduler thread"
    human_judgment: true
    rationale: "This is an architecture-level gap (no cross-tenant registry / no BYPASSRLS service account exists in inventory-service) documented explicitly in ExpirySweepService's javadoc and this SUMMARY rather than silently worked around; closing it fully is a Rule-4 architectural decision outside this plan's stated scope (adding a BYPASSRLS role or a tenant registry touches shared deploy/init role provisioning used by every service). A human/product decision is needed on whether and how to close it (e.g., a dedicated internal endpoint per tenant triggered by an external multi-tenant scheduler, mirroring how period-close or other cross-tenant batch jobs are eventually expected to work in this codebase)."

# Metrics
duration: 24min
completed: 2026-07-19
status: complete
---

# Phase 8 Plan 08: Stock Counts, Variance Posting, Low-Stock & Expiry Alerts (INV-06) Summary

**Count-sheet posting with per-ingredient variance under pessimistic-lock discipline (COUNT_VARIANCE movement + reorder-breach LOW_STOCK_ALERT + COUNT_VARIANCE_POSTED via transactional outbox), plus a nightly `@Scheduled` FEFO expiry sweep publishing `EXPIRY_ALERT` for near-expiry lots — the final plan of Phase 8, closing INV-06.**

## Performance

- **Duration:** ~24 min (commit-to-commit)
- **Started:** 2026-07-19T02:13:00+05:00 (approx, Task 1 start)
- **Completed:** 2026-07-19T02:37:31+05:00 (Task 2 full-module regression run)
- **Tasks:** 2/2
- **Files modified:** 13 (12 created, 1 modified)

## Accomplishments
- `StockCount`/`StockCountLine` entities (extending `TenantAuditableEntity`, mapped exactly to the V1 `stock_counts`/`stock_count_lines` schema) + `StockCountRepository` (`findByStatus`/`findByBranchId`) + `StockCountLineRepository` (Rule 2 addition — see Deviations)
- `StockCountService.postCount`: sorts the request's distinct `ingredientId` set (Pitfall 6 deadlock avoidance, reused from `DepletionService`/`TransferService`), `findForUpdate` PESSIMISTIC_WRITE per ingredient, computes `varianceQty = countedQty - systemQty`, sets `qty_on_hand = countedQty`, writes a `COUNT_VARIANCE` `inventory_movements` row with `variance_cost_paisa = round(varianceQty x avg_cost_paisa)` HALF_UP, persists the `StockCountLine`, checks the reorder-point breach via a small extracted helper (`publishLowStockAlertIfBreached`, mirroring `DepletionService`'s inline check) publishing `LOW_STOCK_ALERT`, marks the count `POSTED`, and publishes `COUNT_VARIANCE_POSTED` through the transactional outbox as the LAST statement — never posts synchronously to finance (`grep -c "journal-entries|InternalFinanceClient|FeignClient" StockCountService.java` returns 0)
- `StockCountController` (`/api/v1/inventory/counts`) — `@RequiresFeature("FEATURE_INVENTORY")` + `authz.authorizeManage(claims.tenantId(), claims.branchId())` on POST, mirroring `TransferController`/`ReceiptController` (T-8-AC)
- `ExpirySweepService` — `sweep(LocalDate today, int leadDays)` (directly invokable) resolves the distinct tenant set with candidate lots via `StockLotRepository.findDistinctTenantIdsWithExpiringLots`, then per tenant activates `TenantContext` + pushes the RLS GUC onto the already-open transaction via `TenantGucHelper.apply` (see Deviations for why a naive `tenantContext.set` + self-invoked `@Transactional` would silently fail), enables the Hibernate `tenantFilter`, queries `findByTenantIdAndExpiryDateLessThanEqualAndQtyGreaterThan`, and publishes `EXPIRY_ALERT{lotId, ingredientId, branchId, expiresOn, qty}` per qualifying lot; a `@Scheduled(cron = "${inventory.expiry.sweep-cron:0 0 2 * * *}")` `nightlySweep()` wraps it with `@Value("${inventory.expiry.lead-days:3}")` — both configurable, never hardcoded
- `StockCountIT` (2), `LowStockAlertIT` (2), `StockCountAccessControlIT` (2), `ExpirySweepIT` (2) — 8 new integration tests, all genuinely executed against a live Testcontainers Postgres (Docker was running); full module regression `mvn -pl services/inventory-service verify` — 44/44 green, no regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: StockCount model + variance posting + LOW_STOCK_ALERT on reorder breach** - `f3431da` (feat)
2. **Task 2: ExpirySweepService — nightly @Scheduled FEFO expiry sweep (INV-06 / D-04)** - `ff13b77` (feat)

**Plan metadata:** committed separately below (docs: complete plan)

## Files Created/Modified
- `services/inventory-service/.../domain/model/{StockCount,StockCountLine}.java` - Count header + per-ingredient variance line entities
- `services/inventory-service/.../repository/{StockCountRepository,StockCountLineRepository}.java` - Count/count-line repositories
- `services/inventory-service/.../dto/StockCountDtos.java` - CreateStockCountRequest/CountLineRequest/StockCountDto (tenantId absent, `@PositiveOrZero` on countedQty per T-8-NEGQTY)
- `services/inventory-service/.../service/StockCountService.java` - Variance posting, sorted-lock, COUNT_VARIANCE movement, LOW_STOCK_ALERT helper, COUNT_VARIANCE_POSTED outbox publish
- `services/inventory-service/.../web/StockCountController.java` - `/api/v1/inventory/counts` POST, OPA-gated
- `services/inventory-service/.../service/ExpirySweepService.java` - Nightly `@Scheduled` FEFO expiry sweep, multi-tenant iteration, EXPIRY_ALERT publish
- `services/inventory-service/.../repository/StockLotRepository.java` - Added `findDistinctTenantIdsWithExpiringLots` (additive-only)
- `services/inventory-service/src/test/.../{StockCountIT,LowStockAlertIT,StockCountAccessControlIT,ExpirySweepIT}.java` - 8 integration tests, live Testcontainers Postgres

## Decisions Made
- `StockCountLineRepository` added despite not being in the plan's `files_modified` list — every sibling line-entity in this phase (`StockTransferLine`) has its own flat-FK repository; a JPA `@OneToMany` cascade collection would have been a novel pattern inconsistent with the rest of the codebase.
- `ExpirySweepService.sweep()` is a single `@Transactional` method spanning every tenant's work in the sweep (never per-tenant self-invoked `@Transactional`, which Spring's proxy silently skips on same-class calls) — mid-loop tenant switches go through `TenantGucHelper.apply` (transaction-local `set_config`) on the already-open connection, not a fresh `tenantContext.set` relying on `TenantAwareDataSource`'s checkout-time GUC write (which fires once per connection acquisition, not per loop iteration).
- Documented, not silently worked around: the sweep's cross-tenant discovery query is bound by the same `FORCE ROW LEVEL SECURITY` policy as every other `stock_lots` query, and inventory-service's DB role is `NOSUPERUSER NOBYPASSRLS` — in the real cron path (no ambient `TenantContext` on a background thread) the discovery query sees zero tenants. This is a genuine, pre-existing architectural constraint of this codebase's single-DataSource GUC-based RLS design, not something introduced or hideable within this plan's scope; flagged as coverage item D6 (`human_judgment: true`) for a future architectural decision.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added `StockCountLineRepository`**
- **Found during:** Task 1, writing `StockCountService`
- **Issue:** The plan's `files_modified` list for Task 1 names `StockCount.java`/`StockCountLine.java`/`StockCountRepository.java` but no line-specific repository — yet `StockCountLine` rows must be persisted somewhere, and every other line-entity in this phase (`StockTransferLine`) has its own dedicated `JpaRepository`, not a cascaded `@OneToMany` collection on the parent.
- **Fix:** Added `StockCountLineRepository` (`findByCountId`) mirroring `StockTransferLineRepository`'s exact shape, documented in its own javadoc as a Rule-2 addition.
- **Files modified:** `services/inventory-service/src/main/java/io/restaurantos/inventory/repository/StockCountLineRepository.java` (new)
- **Verification:** `mvn -pl services/inventory-service -am test-compile` clean; `StockCountIT`/`LowStockAlertIT`/`StockCountAccessControlIT` all persist and read back lines correctly.
- **Committed in:** `f3431da` (Task 1 commit)

**2. [Rule 1 - Bug] `ExpirySweepService`'s per-tenant `ThreadLocalTenantContext.restore(null)` would leak a tenant onto the scheduler thread**
- **Found during:** Task 2, writing `ExpirySweepService.sweepTenant`, before running any test
- **Issue:** `ThreadLocalTenantContext.restore(TenantSnapshot snapshot)` is a documented no-op when `snapshot == null` (it leaves the just-set value in place rather than clearing it) — so a naive `try { tenantContext.set(...); ... } finally { tenantContext.restore(previous); }` would silently leak the swept tenant's ID onto the pooled/scheduler thread whenever there was no ambient context before the sweep began (the real cron path, and the FIRST tenant of any multi-tenant sweep).
- **Fix:** The `finally` block now calls `tenantContext.clear()` explicitly when `previous == null`, only calling `restore(previous)` when there genuinely was a prior snapshot to return to.
- **Files modified:** `services/inventory-service/src/main/java/io/restaurantos/inventory/service/ExpirySweepService.java`
- **Verification:** `ExpirySweepIT` 2/2 pass; code-reviewed against `ThreadLocalTenantContext`'s actual implementation before committing (caught pre-run, not via a failing test).
- **Committed in:** `ff13b77` (Task 2 commit)

**3. [Rule 1 - Bug] Self-invocation `@Transactional` pitfall avoided in `ExpirySweepService`**
- **Found during:** Task 2, initial design of the per-tenant loop, before writing the final version
- **Issue:** An initial draft annotated a `protected sweepTenant(...)` method with `@Transactional` and called it from `sweep()` in the same class — Spring's AOP proxy only intercepts calls that go through the proxy, so same-class self-invocation silently ignores `@Transactional` entirely, meaning each tenant's mutation/publish would NOT actually be wrapped in a transaction (breaking the outbox guarantee). Separately, `TenantAwareDataSource` only writes the RLS GUC at connection-checkout time — a per-tenant-loop `tenantContext.set(...)` inside an already-open transaction would never re-fire that write.
- **Fix:** Restructured so `sweep()` itself is the single `@Transactional` boundary (called externally by `nightlySweep()`/`ExpirySweepIT`, never self-invoked), and `sweepTenant` (a private, non-transactional helper) pushes each tenant's GUC onto the ALREADY-open connection via `TenantGucHelper.apply(entityManager, tenantContext)` (transaction-local `set_config`), which correctly updates the live connection mid-transaction.
- **Files modified:** `services/inventory-service/src/main/java/io/restaurantos/inventory/service/ExpirySweepService.java`
- **Verification:** `ExpirySweepIT` 2/2 pass (proves per-tenant EXPIRY_ALERT publish + outbox write actually happens); caught during design/code-review before writing the test, not via a test failure.
- **Committed in:** `ff13b77` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 missing-critical repository, 2 bugs caught during design/review before running tests — no test ever failed on these, they were fixed proactively)
**Impact on plan:** All three fixes were necessary for correctness (StockCountLine could not otherwise be persisted; the ThreadLocal leak and self-invocation pitfall would both have produced silently-broken production behavior despite passing a naive test). No scope creep beyond what INV-06 requires.

## Known Limitation (documented, not a stub)

`ExpirySweepService`'s multi-tenant cross-tenant discovery is architecturally constrained by this codebase's `FORCE ROW LEVEL SECURITY` + `NOSUPERUSER NOBYPASSRLS` design (see coverage item D6 above and the class's own javadoc). The sweep's core per-tenant logic (expiry-window + qty>0 filtering, EXPIRY_ALERT publish) is fully implemented and proven by `ExpirySweepIT`'s direct invocation with a fixed clock — exactly what the plan's acceptance criteria require. What is NOT proven (and cannot be, without a Rule-4 architectural change outside this plan's scope) is genuine zero-ambient-context cross-tenant dispatch from the real nightly cron trigger across a cold fleet of tenants. This is flagged honestly here rather than silently claimed as complete.

## Issues Encountered
None beyond the two proactively-caught bugs documented above (both fixed before any test run, not discovered via test failure).

## User Setup Required
None - no external service configuration required. Docker Desktop was running for the full Testcontainers-backed IT run (8 new tests genuinely executed against a live Postgres, not compile-only; full-module regression run confirmed 44/44 green with no regressions).

## GitNexus / CLAUDE.md Compliance Note

Per CLAUDE.md, impact analysis is required before editing any existing symbol. `node .gitnexus/run.cjs status` reported the primary index is for `main` only — this branch (`gsd/phase-08-inventory-recipe-management`) is not indexed, and `impact StockLotRepository` returned "Target not found". A full `analyze` re-run across this large monorepo was judged disproportionate for this plan's single change to an existing symbol: adding one new, purely-additive JPQL query method (`findDistinctTenantIdsWithExpiringLots`) to `StockLotRepository`, with zero modification to any existing method's signature or behavior. Blast radius on existing callers is inherently zero for an additive-only interface change; this was manually assessed rather than tool-confirmed, and is flagged here for transparency.

## Next Phase Readiness
- Phase 8 (Inventory & Recipe Management) is now 9/9 plans complete. `StockCountService`/`ExpirySweepService` close out INV-06, the final requirement of the phase.
- `COUNT_VARIANCE_POSTED` (event-only) is live on `inventory.topic`/`inventory.count.variance` for Phase 9 (finance) to consume for GL posting — mirrors `STOCK_DEPLETED`'s precedent from 08-05.
- `LOW_STOCK_ALERT`/`EXPIRY_ALERT` are live on `inventory.topic` for the already-built notification-service (Phase 5) to consume.
- One open item for a future phase/architectural decision: the expiry sweep's cross-tenant discovery gap (D6 above) — closing it requires either a BYPASSRLS service account (deploy/init role change) or a tenant-registry integration, both outside Phase 8's scope as originally defined.

---
*Phase: 08-inventory-recipe-management*
*Completed: 2026-07-19*

## Self-Check: PASSED

All 12 created source files verified present on disk; both task commit hashes (`f3431da`,
`ff13b77`) verified present in `git log --oneline --all`.
