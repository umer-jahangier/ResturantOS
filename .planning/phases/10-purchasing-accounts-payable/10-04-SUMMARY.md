---
phase: 10-purchasing-accounts-payable
plan: 04
subsystem: purchasing
tags: [purchase-order, po-close, opa, feign, event-publisher, flyway, msw, react-query]

# Dependency graph
requires:
  - phase: 10-02
    provides: "PurchaseOrderService/PoApprovalService lifecycle (create/submit/approve/reject/send) and GrnReceiptSimulator's FULLY_RECEIVED/PARTIALLY_RECEIVED transitions this plan closes onto"
provides:
  - "PurchaseOrderService.close(id, reason) — the PUR-02 terminal CLOSED state, real (no longer dead enum value)"
  - "POST /api/v1/purchasing/purchase-orders/{id}/close endpoint"
  - "PO_CLOSED outbox event (purchasing.topic / purchasing.po.closed)"
  - "V3__po_close.sql (closed_at, closed_by, close_reason columns)"
  - "Close PO UI on the PO detail page (MSW-backed)"
affects: [10-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PurchaseOrderService now injects AuthorizationClient + EventPublisher directly (previously only PoApprovalService did) — OPA-gated PO close mirrors PoApprovalService.assertOpaAllows exactly (action vendor.po.close vs vendor.po.approve)"

key-files:
  created:
    - services/purchasing-service/src/main/resources/db/migration/V3__po_close.sql
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/dto/ClosePurchaseOrderRequest.java
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/PurchaseOrderCloseIT.java
    - frontend/__tests__/lib/purchasing-close.test.ts
  modified:
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/domain/model/PurchaseOrder.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/dto/PurchaseOrderDto.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/PurchaseOrderService.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/PurchaseOrderController.java
    - frontend/lib/api-client/schemas/purchasing.schema.ts
    - frontend/lib/repositories/purchasing.repository.ts
    - frontend/lib/hooks/purchasing/use-purchasing.ts
    - frontend/mocks/purchasing.handlers.ts
    - "frontend/app/(tenant)/app/purchasing/purchase-orders/[id]/page.tsx"

key-decisions:
  - "Allowed source states -> CLOSED: FULLY_RECEIVED (free) and PARTIALLY_RECEIVED (short-close, reason mandatory + OPA action vendor.po.close). All other states, including already-CLOSED, throw InvalidPoStateException — no idempotent no-op."
  - "No finance JE posted on close — it's a workflow terminal state; GR/IR and AP postings already happened at receipt/invoice-match time."
  - "Close is out of scope for cancelling a SENT PO with zero receipts and for reopening a CLOSED PO — both still throw InvalidPoStateException, unchanged."

patterns-established:
  - "PurchaseOrderDto grew from 11 to 13 components (closedAt, closeReason) with exactly one construction site (toDto()) — future DTO extensions should keep following this single-call-site discipline."

# Metrics
duration: 50min
completed: 2026-07-12
---

# Phase 10 Plan 04: PO Close Transition (PUR-02 Gap Closure) Summary

**Made `PoStatus.CLOSED` a real, reachable, OPA-gated terminal state — PurchaseOrderService.close() with full-close from FULLY_RECEIVED and mandatory-reason short-close from PARTIALLY_RECEIVED (action `vendor.po.close`), a new POST /{id}/close endpoint, a PO_CLOSED outbox event, and a Close PO button on the PO detail page.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-07-12T07:27:12+10:00 (first task commit)
- **Completed:** 2026-07-12T08:16:54+10:00 (last task commit)
- **Tasks:** 3/3 completed
- **Files modified:** 13 (4 created backend, 1 created frontend test, 8 modified)

## Accomplishments

- `PurchaseOrderService.close(UUID id, String reason)` transitions FULLY_RECEIVED -> CLOSED freely and PARTIALLY_RECEIVED -> CLOSED (short-close) only with a non-blank reason AND OPA allow on action `vendor.po.close`; every other source state throws `InvalidPoStateException`.
- `grep -rn "PoStatus.CLOSED" services/purchasing-service/src/main/java/` now returns a real assignment (`PurchaseOrderService.java:120`) — was previously zero (dead enum value).
- `PurchaseOrderCloseIT` (5 tests) proves the full matrix: full-receive->close->CLOSED, partial-without-reason rejected, partial+reason+OPA-allow->CLOSED, partial+OPA-deny->`ApprovalLimitExceededException`, close-from-SENT->`InvalidPoStateException`.
- Full purchasing-service IT suite (18 tests across 8 IT classes: VendorIT, GrnReceiptSimulatorIT, PurchaseOrderApprovalIT, VendorScorecardIT, PurchaseOrderCloseIT, PurchasingMockE2EIT, ThreeWayMatchIT, SpendAnalyticsIT) **actually executed** via `mvn failsafe:integration-test failsafe:verify` against a live Docker Postgres testcontainer — BUILD SUCCESS, 0 failures, 0 errors. No regression from the added V3 migration or the DTO/constructor signature changes.
- PO detail page now shows a "Close PO" button when status is FULLY_RECEIVED or PARTIALLY_RECEIVED; short-close collects a mandatory reason via a controlled input and disables the button until filled. MSW handler mirrors the backend state guard (409 on invalid state or missing reason).

## Task Commits

Each task was committed atomically:

1. **Task 1: V3 migration + PurchaseOrderService.close() + close endpoint** - `a377b2b` (feat)
2. **Task 2: PurchaseOrderCloseIT** - `c4cd5a0` (test)
3. **Task 3: Close action on PO detail + MSW** - `b5ed29f` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `services/purchasing-service/src/main/resources/db/migration/V3__po_close.sql` - adds `closed_at`, `closed_by`, `close_reason` (all nullable) to `purchase_orders`
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/domain/model/PurchaseOrder.java` - closedAt/closedBy/closeReason fields
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/dto/PurchaseOrderDto.java` - closedAt/closeReason components (13 total, single construction site `toDto()`)
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/dto/ClosePurchaseOrderRequest.java` - new `(String reason)` record
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/PurchaseOrderService.java` - constructor now injects `AuthorizationClient` + `EventPublisher`; adds `close()`, `assertOpaAllowsClose()`, `publishPoClosed()`
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/PurchaseOrderController.java` - `POST /{id}/close`
- `services/purchasing-service/src/test/java/io/restaurantos/purchasing/PurchaseOrderCloseIT.java` - 5-test IT covering the full close matrix
- `frontend/lib/api-client/schemas/purchasing.schema.ts` - `closedAt`/`closeReason` added to `apiPurchaseOrderSchema`
- `frontend/lib/repositories/purchasing.repository.ts` - `closePurchaseOrder(poId, reason?)`
- `frontend/lib/hooks/purchasing/use-purchasing.ts` - `useClosePurchaseOrder(poId)` mutation
- `frontend/mocks/purchasing.handlers.ts` - `POST .../purchase-orders/:poId/close` handler with the same state guard as the backend
- `frontend/app/(tenant)/app/purchasing/purchase-orders/[id]/page.tsx` - Close PO button + reason input for short-close, closed banner
- `frontend/__tests__/lib/purchasing-close.test.ts` - repository-level MSW round-trip test (invalid-state reject, missing-reason reject, short-close success)

## Decisions Made

See `key-decisions` in frontmatter. No new architectural decisions beyond what the plan already specified — implemented as designed.

## Deviations from Plan

None - plan executed exactly as written. One small addition beyond the plan's explicit file list: `frontend/__tests__/lib/purchasing-close.test.ts` was added (not in the plan's `files_modified`) to give the frontend Close PO flow the same kind of automated MSW round-trip coverage the existing `purchasing-spend-analytics.test.ts` gives spend analytics, since the plan's own verification step ("PO detail page closes a received PO against MSW with no backend") had no existing automated check to lean on. This is additive test coverage only, not a scope change.

## Issues Encountered

- `pnpm tsc --noEmit` at the repo root surfaces 3 pre-existing type errors in `frontend/lib/api-client/errors.ts` (lines 129/134/137, `USER_FACING_BY_CODE` string-indexing under strict optional typing). This file is untouched by this plan (confirmed via `git diff HEAD` — zero diff) and the errors predate this session (last touched in commit `e79cdbd`/`b02cadc`). None of the 5 files this plan modified produce any tsc errors — the pre-existing failure is isolated to `errors.ts` and out of this plan's scope (not owned by 10-04, not one of the 4 shared frontend files 10-03 also touched). Left unfixed; flagged here for whichever plan owns `errors.ts` cleanup.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- ROADMAP Phase 10 Success Criterion #2 (`DRAFT->PENDING_APPROVAL->APPROVED->SENT->...->CLOSED`) is now TRUE end-to-end and IT-proven.
- PUR-02 genuinely satisfied: the CLOSED terminal state is reachable, tested (backend IT + frontend MSW round-trip), and surfaced in the UI.
- `.planning/REQUIREMENTS.md` intentionally NOT touched — 10-06 owns all requirement-doc reconciliation after 10-03/10-04/10-05 land.
- Pre-existing `frontend/lib/api-client/errors.ts` tsc errors (see Issues Encountered) are a latent, unrelated repo-wide concern worth a follow-up ticket; not a blocker for Phase 10 sign-off since they don't touch purchasing.
