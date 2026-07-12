---
phase: 07
plan: 02
subsystem: pos-service-write-side
tags: [tills, split-tender, idempotency, opa, order-lifecycle, feign, flyway, msw]
depends_on: ["07-01"]
provides:
  - Till session open/close with variance reconciliation
  - Split-tender payment validation and ORDER_CLOSED event
  - OPA-gated void and refund operations with approval thresholds
  - Internal /orders/open-count endpoint for Finance period locking
  - Frontend payment panel, till bar, void/refund dialogs with tests
affects: ["07-03", "07-04"]
tech-stack:
  added: []
  patterns:
    - Idempotency pattern (IdempotencyService + Idempotency-Key header)
    - Fail-closed Feign circuit breaker (FinancePeriodClient → PeriodLockedException)
    - OPA approval_limit_paisa threshold policy (rego)
    - Split-tender remainder-to-first-share algorithm
    - Transactional outbox for all write-side domain events
key-files:
  created:
    - services/pos-service/src/main/resources/db/migration/V3__pos_tills_payments.sql
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/enums/PaymentMethod.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/enums/TillStatus.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/TillSession.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/OrderPayment.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/OrderRefund.java
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/TillSessionRepository.java
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/OrderPaymentRepository.java
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/OrderRefundRepository.java
    - services/pos-service/src/main/java/io/restaurantos/pos/feign/FinancePeriodClient.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/TillService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/TillServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/SplitTenderCalculator.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/PaymentService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/PaymentServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/RefundService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/RefundServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/authz/PosAuthorizationService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/event/PosClosePayloads.java
    - services/pos-service/src/main/java/io/restaurantos/pos/event/PosVoidRefundPayloads.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/OpenTillRequest.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/CloseTillRequest.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/TillSessionDto.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/CloseOrderRequest.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/VoidOrderRequest.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/RefundRequest.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/TillController.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/PaymentController.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/InternalPosController.java
    - services/pos-service/src/test/java/io/restaurantos/pos/TillReconciliationIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/SplitTenderCalculatorUnitTest.java
    - services/pos-service/src/test/java/io/restaurantos/pos/OrderCloseIdempotencyIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/PeriodLockCloseIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/VoidRefundOpaIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/OpenOrdersCountInternalIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/KitchenRoleDeniedPosIT.java
    - frontend/lib/hooks/pos/use-till.ts
    - frontend/lib/hooks/pos/use-payments.ts
    - frontend/components/pos/payment-panel.tsx
    - frontend/components/pos/till-session-bar.tsx
    - frontend/components/pos/void-refund-dialog.tsx
    - frontend/__tests__/pos/payment-panel.test.tsx
  modified:
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/OrderController.java
    - services/pos-service/src/main/java/io/restaurantos/pos/config/PosSecurityConfig.java
    - services/pos-service/src/main/java/io/restaurantos/pos/exception/PosExceptions.java
    - services/pos-service/src/main/java/io/restaurantos/pos/exception/PosGlobalExceptionHandler.java
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/OrderRepository.java
    - services/pos-service/src/test/java/io/restaurantos/pos/PosTestBase.java
    - policies/restaurantos/pos.rego
    - policies/tests/pos_test.rego
    - frontend/lib/models/pos.model.ts
    - frontend/lib/api-client/schemas/pos.schema.ts
    - frontend/lib/adapters/pos.adapter.ts
    - frontend/lib/repositories/pos.repository.ts
    - frontend/lib/hooks/query-keys.ts
decisions:
  - id: D1
    summary: Fail-closed FinancePeriodClient — unreachable Finance treated as LOCKED
    rationale: Safety-first; never close an order against a potentially locked period
  - id: D2
    summary: Split-tender remainder goes to first share only (never distributed evenly)
    rationale: Avoids floating-point cents across splits; deterministic and auditable
  - id: D3
    summary: OpaClient mocked via @MockitoBean in integration tests, not live OPA server
    rationale: Focused service-level authorization testing without OPA infrastructure dependency
  - id: D4
    summary: InternalPosController returns bare Long (not ApiResponse-wrapped)
    rationale: Must match Finance-service's PosInternalClient Feign contract exactly
  - id: D5
    summary: variance_paisa as GENERATED ALWAYS AS DB column, read via @Generated(INSERT)
    rationale: Ensures variance computed atomically in DB, not susceptible to app-layer rounding
metrics:
  duration: "~4 hours"
  completed: "2026-06-30"
---

# Phase 7 Plan 02: Tills, Split-Tender, ORDER_CLOSED, OPA Summary

**One-liner:** Till session lifecycle with split-tender ORDER_CLOSED event, idempotency, fail-closed Finance period lock, OPA void/refund thresholds, and internal open-count endpoint for Finance.

## What Was Built

### Task 1 — Tills + Payments DDL + Entities + Finance Feign Client

Created Flyway **V3** migration adding three tables:

- `till_sessions` with `variance_paisa GENERATED ALWAYS AS (declared - expected) STORED`, partial unique index `uq_open_till_per_cashier` (status='OPEN'), RLS enabled.
- `order_payments` and `order_refunds` with RLS and FK to `orders(id)`.
- `ALTER TABLE orders ADD CONSTRAINT fk_orders_till FOREIGN KEY (till_session_id) REFERENCES till_sessions(id)`.

Added JPA entities (`TillSession`, `OrderPayment`, `OrderRefund`) extending `TenantAuditableEntity`, with `@Generated(INSERT)` on `variancePaisa`. Added Spring Data repositories with JPQL aggregate queries (`sumAmountByOrderId`). Created `FinancePeriodClient` Feign client with Resilience4j `@CircuitBreaker` fallback that throws `PeriodLockedException` (fail-closed).

### Task 2 — Till Open/Close + Reconciliation + TILL_OPENED/TILL_CLOSED Events

Implemented `TillServiceImpl` with:
- `openTill` — checks for existing OPEN till per cashier (409 `TillAlreadyOpenException`), creates session, publishes `TILL_OPENED` event.
- `closeTill` — blocks if any order in session is not CLOSED/VOIDED (409 `TillHasOpenOrdersException`), computes expected CASH from session payments, sets declared closing float, publishes `TILL_CLOSED` event with variance.

Added `TillController` (`POST /api/v1/pos/tills`, `POST /{id}/close`, `GET /{id}`). Integration test `TillReconciliationIT` covers open, duplicate-open 409, premature-close 409, and clean close with variance check.

### Task 3 — Split-Tender + Idempotent ORDER_CLOSED + Period-Lock 423

`SplitTenderCalculator` (pure service): `validateExact` throws `PaymentMismatchException` (422) on mismatch; `equalSplit` puts remainder entirely on first share. `OrderServiceImpl.closeOrder` implements the full idempotent flow:

1. `IdempotencyService.checkAndLock` — replay-safe.
2. Payment sum validation via `SplitTenderCalculator.validateExact`.
3. `FinancePeriodClient.assertPeriodOpen` — throws `PeriodLockedException` (423) if LOCKED, CLOSED, or unreachable.
4. State machine transition → CLOSED, table released → AVAILABLE.
5. Publishes `ORDER_CLOSED` outbox event with exact payload contract including payments and items.

`PaymentController` adds `/orders/{id}/close` (Idempotency-Key required) and `/orders/{id}/split` preview.

Tests: `SplitTenderCalculatorUnitTest`, `OrderCloseIdempotencyIT` (idempotency replay check), `PeriodLockCloseIT` (LOCKED and FeignException → 423).

### Task 4 — Voids + Refunds (OPA Thresholds) + Internal Open-Count

`PosAuthorizationService` wraps `AuthorizationService`; OPA input built with `approval_limit_paisa` from JWT claims. `voidOrder` enforces `void.own` vs `void.any` based on creator/status. `RefundServiceImpl` enforces `pos.order.refund` with `approval_limit_paisa >= refundPaisa` threshold in Rego.

`InternalPosController` returns bare `Long` (no `ApiResponse` wrapper) at `GET /internal/orders/open-count?periodStart=&periodEnd=` matching Finance's Feign contract exactly.

`pos.rego` extended with `pos.order.refund`, `pos.order.discount.override`, `pos.order.split_bill` rules. `pos_test.rego` achieves 100% coverage including KITCHEN_STAFF denial, CASHIER refund denial, MANAGER approval_limit threshold.

Tests: `VoidRefundOpaIT` (mock OPA, idempotency), `OpenOrdersCountInternalIT` (date range counting), `KitchenRoleDeniedPosIT` (role-only JWT denied).

### Task 5 — Frontend Payment + Till + Void/Refund UI

Extended the four-layer POS abstraction:

- **Schemas**: `apiTillSessionSchema`, `apiOrderPaymentSchema`, `apiCloseOrderSchema` in `pos.schema.ts`.
- **Adapter**: `adaptTillSession` in `pos.adapter.ts`.
- **Repository**: `openTill`, `closeTill`, `closeOrder`, `voidOrder`, `refundOrder` — all with `Idempotency-Key` headers via `crypto.randomUUID()`.
- **Hooks**: `useTillSession`, `useOpenTill`, `useCloseTill`; `useCloseOrder`, `useVoidOrder`, `useRefundOrder`.
- **Components**:
  - `payment-panel.tsx` — split-tender table with running remaining balance, "CHARGE NOW" (`h-14 bg-emerald-600`) disabled unless `remaining === 0`, receipt confirmation on success.
  - `till-session-bar.tsx` — open/close till modals with variance preview.
  - `void-refund-dialog.tsx` — void form (reason required) and full/partial refund form, both guarded by `PermissionGuard`.
- **Tests**: `payment-panel.test.tsx` — 3 passing Vitest tests: button disabled when remaining > 0, button enabled when sum equals total, Idempotency-Key UUID header verified via MSW interceptor.

## Decisions Made

| ID | Decision |
|----|----------|
| D1 | Fail-closed FinancePeriodClient — Finance unreachable → PeriodLockedException |
| D2 | Split-tender remainder assigned to first share only (deterministic, auditable) |
| D3 | OpaClient mocked via @MockitoBean in ITs rather than running live OPA server |
| D4 | InternalPosController returns bare Long matching Finance's Feign contract exactly |
| D5 | variance_paisa as GENERATED ALWAYS AS DB column, not computed in application layer |

## Deviations from Plan

None — plan executed exactly as written. Minor adjustments:
- Used `ApiResponse.ok()` (not `ApiResponse.success()`) matching actual `shared-lib` API.
- Added missing `import static org.assertj.core.api.Assertions.assertThat` to `KitchenRoleDeniedPosIT`.
- Used PowerShell-compatible commands (`;` separator, `working_directory` param) throughout.
- OPA CLI invoked via Docker (`docker run openpolicyagent/opa:latest`) since `opa` not on PATH.

## Commits

| Hash | Task | Description |
|------|------|-------------|
| `90abb27` | Task 1 | tills+payments DDL, entities, repositories, FinancePeriodClient |
| `f560c0b` | Task 2 | till open/close service, controller, reconciliation IT tests |
| `5d39f28` | Task 3 | split-tender calculator, idempotent ORDER_CLOSED, period-lock 423 |
| `b7b6621` | Task 4 | voids+refunds OPA thresholds, internal open-orders-count, pos.rego coverage |
| `28260fa` | Task 5 | frontend payment + till + void/refund UI and tests |

## Next Phase Readiness

**07-03 (KDS — Kitchen Display System)** can proceed:
- `ORDER_SENT_TO_KDS` already published from 07-01.
- `ORDER_CLOSED`, `ORDER_VOIDED` events now published; KDS can subscribe.
- `orders.status` state machine includes `PARTIAL_READY`, `READY`, `SERVED` states for KDS transitions.
- `InternalPosController.getOpenOrderCount` ready for Finance to query during period close.
