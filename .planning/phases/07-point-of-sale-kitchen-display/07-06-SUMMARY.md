---
phase: 07-point-of-sale-kitchen-display
plan: 06
subsystem: pos
tags: [jpa, hibernate, opa, till-reconciliation, void-order, gap-closure]

# Dependency graph
requires:
  - phase: 07-point-of-sale-kitchen-display
    provides: OrderServiceImpl, TillServiceImpl, TillSession entity, PosAuthorizationService (07-01, 07-02)
provides:
  - Order.cashierId/tillSessionId populated at creation from the authenticated caller
  - TillSession.variancePaisa correctly refreshed after UPDATE (not just INSERT)
  - Regression tests proving the till-close open-orders gate and OPA void.own created_by check are reachable end-to-end
affects: [pos-service till reconciliation, pos-service void/refund authorization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hibernate @Generated(event = {INSERT, UPDATE}) required for DB-computed columns touched by both insert and update paths"

key-files:
  created: []
  modified:
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/TillSession.java
    - services/pos-service/src/test/java/io/restaurantos/pos/TillReconciliationIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/VoidRefundOpaIT.java

key-decisions:
  - "OrderServiceImpl.createOrder resolves the caller's OPEN till via TillSessionRepository.findByCashierIdAndStatus — no till open is a legitimate state (e.g. MANAGER creating an order) and does not throw"
  - "TillSession.variancePaisa @Generated event array now includes both INSERT and UPDATE so Hibernate re-fetches the DB-computed column after closeTill's UPDATE"

patterns-established: []

requirements-completed: [POS-04, POS-06]

coverage:
  - id: D1
    description: "OrderServiceImpl.createOrder sets both cashierId and tillSessionId from the authenticated caller's context"
    requirement: "POS-04"
    verification:
      - kind: integration
        ref: "TillReconciliationIT#closeTill_withOrderCreatedViaOrderService_linksTillSessionAndCashier_blocksClose"
        status: pass
    human_judgment: false
  - id: D2
    description: "TillSession.variancePaisa is non-null in the close response whenever both inputs are populated"
    requirement: "POS-04"
    verification:
      - kind: integration
        ref: "TillReconciliationIT#closeTill_withAllOrdersTerminal_computesVariance_and_TILL_CLOSED_event"
        status: pass
    human_judgment: false
  - id: D3
    description: "A cashier's own OPEN order created via the real OrderService now blocks their till's close (end-to-end, not a hand-built fixture)"
    requirement: "POS-04"
    verification:
      - kind: integration
        ref: "TillReconciliationIT#closeTill_withOrderCreatedViaOrderService_linksTillSessionAndCashier_blocksClose"
        status: pass
    human_judgment: false
  - id: D4
    description: "VoidRefundOpaIT proves the OPA resource input carries the real cashier id as created_by, not a permanently-null value"
    requirement: "POS-06"
    verification:
      - kind: integration
        ref: "VoidRefundOpaIT#cashier_voids_own_OPEN_order_withOpaAllow_succeeds"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-10
status: complete
---

# Phase 07 Plan 06: Order-Cashier-Till Linkage Gap Closure Summary

**Fixed the single root cause behind two UAT gaps — `OrderServiceImpl.createOrder` never populated `Order.cashierId`/`Order.tillSessionId`, which silently broke both the till-close open-orders gate and OPA's void.own `created_by` check.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-10T17:15:00Z
- **Completed:** 2026-07-10T17:34:00Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments
- `OrderServiceImpl.createOrder` now sets `cashierId` from `tenantContext.getUserId()` and links `tillSessionId` to the caller's currently OPEN till session (if any exists), fixing a permanent no-op in `TillServiceImpl.closeTill`'s "reject if orders still open" gate.
- `TillSession.variancePaisa`'s `@Generated` annotation now covers both `INSERT` and `UPDATE` events, so Hibernate re-fetches the DB-computed column after `closeTill`'s UPDATE — the close response's `variancePaisa` is no longer silently null.
- Added a true end-to-end regression test (`closeTill_withOrderCreatedViaOrderService_linksTillSessionAndCashier_blocksClose`) that creates an order through the real `OrderService.createOrder` path (not a hand-built fixture) and asserts it is correctly linked and blocks till close.
- Closed a test-coverage blind spot in `VoidRefundOpaIT` — the existing `any()` OPA mock could never fail even with a permanently-null `created_by`; added an `ArgumentCaptor` assertion that proves OPA actually receives the real cashier id.

## Task Commits

Each task was committed atomically:

1. **Task 1: Populate Order.cashierId/tillSessionId at creation; fix TillSession variance staleness** - `c9372f6` (fix)
2. **Task 2: Regression tests for till gate, variance, and void.own createdBy propagation** - `61618b7` (test)

_Note: Task 1 combined a bug fix in two files under a single `fix` commit per plan scope; Task 2 is test-only._

## Files Created/Modified
- `services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java` - Injected `TillSessionRepository`; `createOrder` now sets `cashierId`/`tillSessionId` from the authenticated caller
- `services/pos-service/src/main/java/io/restaurantos/pos/domain/model/TillSession.java` - `variancePaisa` `@Generated` event array now includes `UPDATE`
- `services/pos-service/src/test/java/io/restaurantos/pos/TillReconciliationIT.java` - Added `variancePaisa` assertion + new end-to-end till-linkage regression test
- `services/pos-service/src/test/java/io/restaurantos/pos/VoidRefundOpaIT.java` - Added `ArgumentCaptor`-based assertion on OPA's `resource.createdBy`

## Decisions Made
- Followed the file's existing `Order finalOrder = order;` pattern (already used in `closeOrder`) to satisfy Java's effectively-final lambda capture rule for `Optional.ifPresent` in `createOrder`, since `order` is reassigned later in the method by `orderRepository.save(order)`.
- Placed new imports (`OpaInput`, `ArgumentCaptor`) at their alphabetically-correct positions among existing imports in `VoidRefundOpaIT.java` rather than appending them, matching the file's existing import ordering convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking compile error] Lambda effectively-final violation in createOrder**
- **Found during:** Task 1
- **Issue:** The plan's literal instruction to call `order.setCashierId(...)`/`order.setTillSessionId(...)` inside an `Optional.ifPresent` lambda failed to compile — `order` is reassigned later in the method (`order = orderRepository.save(order);`), which disqualifies it from effective finality for the entire method scope, not just up to the reassignment point.
- **Fix:** Introduced `Order newOrder = order;` immediately before the lambda block (mirroring the file's own `Order finalOrder = order;` pattern already used in `closeOrder`), and captured `newOrder` in the lambda instead.
- **Files modified:** `services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java`
- **Verification:** `mvn -q -DskipTests compile` succeeds
- **Committed in:** `c9372f6` (part of task commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking compile error)
**Impact on plan:** Purely mechanical fix required to make the plan's specified behavior compile under Java's lambda-capture rules; no behavioral change from what the plan intended.

## Issues Encountered

**Local test environment required manual env-var overrides not touched in this plan's file scope.** The working tree carried pre-existing, out-of-scope uncommitted changes (from a prior manual UAT session) to `services/pos-service/src/main/resources/application.yml` that added `restaurantos.opa.url: ${OPA_URL}` with no default, and a locally running RabbitMQ broker (`restaurantos-rabbitmq` container) configured with non-default credentials. Both caused `mvn verify` on the two target test classes to fail to boot the Spring context — unrelated to the code changes in this plan. Per this plan's sequential-execution constraints, that `application.yml` was left completely untouched; instead the test run was executed with `OPA_URL`, `RABBITMQ_USERNAME`, and `RABBITMQ_PASSWORD` set as shell environment variables only (matching the running container's actual credentials, discovered via `docker inspect`). With those env vars set, both `TillReconciliationIT` (5/5) and `VoidRefundOpaIT` (6/6) pass with 0 failures/errors. The `mvn ... verify` goal separately failed at the `spring-boot-maven-plugin:repackage` step because a running `pos-service` process (from `.dev-pids-uat.json`, also pre-existing/out-of-scope) held the built jar open on Windows — this is a packaging-step file-lock issue, not a test failure; the equivalent `mvn ... test` goal (test phase only, no repackage) completed cleanly with the same 11/11 passing tests.

## User Setup Required

None - no external service configuration required. (Note: the local dev environment's `OPA_URL` and RabbitMQ credentials env vars, described above under Issues Encountered, are pre-existing environmental configuration from a manual UAT session — not something this plan introduces or requires going forward.)

## Next Phase Readiness

Both UAT gaps this plan targeted are closed at the code level:
- Till-close's open-orders gate is now reachable (order.tillSessionId populated at creation).
- OPA's void.own `created_by == user.id` check can now actually match (order.cashierId populated at creation).

The companion auth-service gap-closure plan (permission-seeding half of UAT Test 7 — granting `pos.order.void.own` to CASHIER) is a separate, already-referenced plan and is not part of this plan's scope.

---
*Phase: 07-point-of-sale-kitchen-display*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: .planning/phases/07-point-of-sale-kitchen-display/07-06-SUMMARY.md
- FOUND: commit c9372f6
- FOUND: commit 61618b7
- FOUND: services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java
- FOUND: services/pos-service/src/main/java/io/restaurantos/pos/domain/model/TillSession.java
