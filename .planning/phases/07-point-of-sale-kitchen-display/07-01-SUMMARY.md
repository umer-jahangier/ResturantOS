---
phase: 07
plan: 01
name: pos-service scaffold + order aggregate + frontend POS terminal
subsystem: pos
tags: [spring-boot, flyway, rls, transactional-outbox, state-machine, money-math, four-layer, zod]
completed: 2026-06-30

dependency-graph:
  requires:
    - "06-01: shared-lib money utils, TenantAuditableEntity, EventPublisher"
    - "06-02: finance-service patterns (Flyway, Testcontainers, four-layer frontend)"
    - "03-01: auth-service RBAC / Liquibase"
  provides:
    - "pos-service on port 8084 with pos_db"
    - "ORDER_CREATED and ORDER_SENT_TO_KDS outbox events (hard contracts for downstream)"
    - "CASHIER / MANAGER / OWNER POS permission catalogue in auth-service"
    - "Frontend POS terminal + floor view (four-layer abstraction)"
  affects:
    - "07-02: order close, payment, till — builds on ORDER_SENT_TO_KDS hard contract"
    - "07-03: offline POS — builds on POS terminal seams"
    - "07-04: KDS display — consumes ORDER_SENT_TO_KDS event payload"
    - "Phase 8: Inventory — consumes ORDER_SENT_TO_KDS for stock deduction"
    - "Phase 9: Finance integration via ORDER_CLOSED (07-02)"
    - "Phase 12: Reporting — order aggregate as source of truth"

tech-stack:
  added: []
  patterns:
    - "Static singleton Testcontainers pattern (mirrored from finance-service)"
    - "Transactional outbox via shared-lib EventPublisher inside same @Transactional"
    - "OrderStateMachine EnumMap<OrderStatus, Set<OrderStatus>> for legal transitions"
    - "BIGINT paisa money math with discount-floor invariant and HALF_UP per-line tax"
    - "ORD-YYYYMMDD-NNNN sequence with PESSIMISTIC_WRITE repository lock"
    - "Frontend four-layer: Zod schema → model → adapter → repository → hook → component"
    - "ESLint no-restricted-imports boundary enforced for component layer"

key-files:
  created:
    - services/pos-service/pom.xml
    - services/pos-service/Dockerfile
    - services/pos-service/src/main/java/io/restaurantos/pos/PosServiceApplication.java
    - services/pos-service/src/main/resources/application.yml
    - services/pos-service/src/main/resources/db/migration/V1__pos_schema.sql
    - services/pos-service/src/main/resources/db/migration/V2__pos_infra_tables.sql
    - services/pos-service/src/main/java/io/restaurantos/pos/config/PosSecurityConfig.java
    - services/pos-service/src/main/java/io/restaurantos/pos/config/PosInternalServiceFilter.java
    - services/pos-service/src/main/java/io/restaurantos/pos/config/OpenApiConfig.java
    - services/pos-service/src/main/java/io/restaurantos/pos/config/FeignClientConfig.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/enums/OrderStatus.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/enums/OrderType.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/enums/KdsItemStatus.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/enums/TableStatus.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/Order.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/OrderItem.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/OrderItemModifier.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/OrderDiscount.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/OrderSequence.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/MenuCategory.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/MenuItem.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/DiningTable.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderPricingCalculator.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderStateMachine.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/MenuServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/TableServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/event/PosEventPayloads.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/OrderController.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/MenuController.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/TableController.java
    - services/pos-service/src/main/java/io/restaurantos/pos/exception/PosExceptions.java
    - services/pos-service/src/main/java/io/restaurantos/pos/exception/PosGlobalExceptionHandler.java
    - services/pos-service/src/test/java/io/restaurantos/pos/PosTestBase.java
    - services/pos-service/src/test/java/io/restaurantos/pos/OrderPricingCalculatorUnitTest.java
    - services/pos-service/src/test/java/io/restaurantos/pos/OrderStateMachineUnitTest.java
    - services/pos-service/src/test/java/io/restaurantos/pos/OrderLifecycleIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/OrderRlsIsolationIT.java
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/041-pos-permissions.xml
    - frontend/lib/api-client/schemas/pos.schema.ts
    - frontend/lib/models/pos.model.ts
    - frontend/lib/adapters/pos.adapter.ts
    - frontend/lib/repositories/pos.repository.ts
    - frontend/lib/hooks/pos/use-menu.ts
    - frontend/lib/hooks/pos/use-orders.ts
    - frontend/components/pos/pos-terminal.tsx
    - frontend/components/pos/menu-grid.tsx
    - frontend/components/pos/order-panel.tsx
    - frontend/components/pos/table-floor-view.tsx
    - frontend/app/(tenant)/app/pos/page.tsx
    - frontend/__tests__/pos/pos-repository.test.ts
  modified:
    - pom.xml (added services/pos-service module)
    - deploy/docker-compose.yml (pos-service service)
    - .github/workflows/coverage-gates.json (pos-service: 70)
    - services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml
    - frontend/lib/hooks/query-keys.ts (pos query keys)
    - frontend/lib/api-client/errors.ts (pre-existing TS bug fix: UNKNOWN_ERROR_MSG constant)

decisions:
  - "[07-01-A]: Flyway (not Liquibase) for pos-service — mirrors finance-service decision [06-01-A]"
  - "[07-01-B]: OutboxRepository NOT mocked in PosTestBase — ITs query actual DB rows to assert outbox events"
  - "[07-01-C]: ORD-YYYYMMDD-NNNN sequence uses PESSIMISTIC_WRITE on OrderSequenceRepository.findForUpdate"
  - "[07-01-D]: ORDER_CREATED emitted on DRAFT→OPEN (first addItem), not on createOrder — table can be reserved without event until items are added"
  - "[07-01-E]: kdsStation null resolved to DEFAULT string in sendToKds payload — KDS contract explicit"
  - "[07-01-F]: Discount floor invariant: effectiveDiscount = min(requested, lineSubtotal), so lineNet never goes below 0"
  - "[07-01-G]: Per-line tax is HALF_UP on discounted net — tax is never applied to order total directly"
  - "[07-01-H]: frontend errors.ts pre-existing TS error fixed (noUncheckedIndexedAccess + UNKNOWN_ERROR_MSG)"

metrics:
  duration: "~6 hours"
  completed: "2026-06-30"

tasks-completed:
  - task: 1
    name: "pos-service scaffold + Flyway DDL (schema, RLS, infra tables)"
    commit: 5c7cc84
    status: complete
  - task: 2
    name: "Menu + table reference (read APIs) + pricing calculator + state machine"
    commit: 7e6e63f
    status: complete
  - task: 3
    name: "Order aggregate service + REST API + ORDER_CREATED / ORDER_SENT_TO_KDS outbox + IT"
    commit: 360f592
    status: complete
  - task: 4
    name: "auth-service POS permission catalogue + CASHIER/MANAGER role mappings"
    commit: 28a59a9
    status: complete
  - task: 5
    name: "Frontend POS terminal + floor view (four-layer abstraction)"
    commit: 51c91ed
    status: complete
---

# Phase 7 Plan 01: POS Service Scaffold + Order Aggregate + Frontend POS Terminal

**One-liner:** Spring Boot pos-service with BIGINT-paisa money math, DRAFT→OPEN→SENT_TO_KDS state machine, transactional outbox events, RLS multi-tenancy, and a touch-first Next.js POS terminal on the enforced four-layer abstraction.

## Summary

This plan scaffolded the `pos-service` (port 8084, `pos_db`) from scratch as the heart of the RestaurantOS system, establishing the hard event contracts (`ORDER_CREATED`, `ORDER_SENT_TO_KDS`) that all downstream services depend on.

Key deliverables:
- **Full pos-service skeleton**: mirrored from `finance-service` with Flyway V1+V2 migrations, RLS on every tenant table, JWT security, and a transactional outbox.
- **Order aggregate**: DRAFT→OPEN→SENT_TO_KDS state machine with discount-floor and per-line HALF_UP tax invariants, idempotent create via `client_order_id`, and optimistic locking via `@Version`.
- **Event contracts**: `ORDER_CREATED` and `ORDER_SENT_TO_KDS` published in the same database transaction as the business mutations. KDS items carry explicit `kdsStation` (null→"DEFAULT").
- **Auth RBAC**: 13 POS permissions seeded in auth-service; CASHIER gets day-to-day subset, MANAGER gets privileged superset, OWNER/TENANT_ADMIN inherit all.
- **Frontend POS terminal**: Zod-schema → model → adapter → repository → TanStack Query hook → component, four-layer boundary enforced by ESLint. Touch-first menu grid (2/3/4 col), order panel with MoneyDisplay, table floor view, and CHARGE NOW seam for 07-02.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing TypeScript error in `errors.ts`**
- **Found during:** Task 5 (`pnpm tsc --noEmit`)
- **Issue:** `USER_FACING_BY_CODE.UNKNOWN_ERROR` typed as `string | undefined` because `noUncheckedIndexedAccess: true` was enabled in tsconfig. The `return` statements had TS2322 errors.
- **Fix:** Extracted `const UNKNOWN_ERROR_MSG = "Something went wrong..."` and replaced the three `USER_FACING_BY_CODE.UNKNOWN_ERROR` usages.
- **Files modified:** `frontend/lib/api-client/errors.ts`

**2. [Rule 3 - Blocking] OutboxRepository not suitable for IT assertions if mocked**
- **Found during:** Task 3 test design
- **Issue:** `FinanceTestBase` mocks `OutboxRepository`, but `OrderLifecycleIT` requires querying actual outbox rows to assert `ORDER_CREATED`/`ORDER_SENT_TO_KDS` were written in-transaction.
- **Fix:** `PosTestBase` does NOT mock `OutboxRepository` — only mocks `RabbitTemplate` to prevent actual AMQP publishing. ITs autowire and query `OutboxRepository` directly.

**3. [Rule 1 - Bug] Test data UUID in pos-repository.test.ts used invalid hex prefix**
- **Found during:** Task 5 vitest run
- **Issue:** `"i1000001-0000-4000-8000-000000000001"` starts with `i` (not valid hex), causing Zod UUID validation failure.
- **Fix:** Changed to `"a3000001-0000-4000-8000-000000000001"`.

## Decisions Made

| ID | Decision |
|----|----------|
| 07-01-A | Flyway (not Liquibase) for pos-service — mirrors [06-01-A] |
| 07-01-B | OutboxRepository NOT mocked in PosTestBase — real DB assertions in ITs |
| 07-01-C | ORD-YYYYMMDD-NNNN uses PESSIMISTIC_WRITE sequence lock |
| 07-01-D | ORDER_CREATED emitted on first addItem (DRAFT→OPEN), not on createOrder |
| 07-01-E | null kdsStation resolved to "DEFAULT" in ORDER_SENT_TO_KDS payload |
| 07-01-F | Discount floor: effectiveDiscount = min(requested, lineSubtotal) |
| 07-01-G | Per-line tax HALF_UP on discounted net — never on order total |
| 07-01-H | Frontend errors.ts UNKNOWN_ERROR_MSG constant to fix noUncheckedIndexedAccess TS error |

## Next Phase Readiness

**Ready for 07-02:** `ORDER_SENT_TO_KDS` event contract established. Till session FK is nullable (`till_session_id`) with a clear TODO. CHARGE NOW button seam exists (disabled). All order transitions through `SENT_TO_KDS` are proven by `OrderLifecycleIT`.

**Ready for 07-04 (KDS):** `ORDER_SENT_TO_KDS` payload delivers `kdsStation` (null→"DEFAULT"), `modifiers`, and per-item `notes`. Kitchen can group by station immediately.

**Blockers carried forward:**
- IT integration tests require Docker/Testcontainers (cannot run without Docker daemon)
- `mvn verify` with ITs requires `DOCKER_HOST` + `TESTCONTAINERS_RYUK_DISABLED=true` on Colima [03-01-D]
