# Phase 10 Verification Report

**Phase:** 10-purchasing-accounts-payable  
**Status:** passed (re-scored 2026-07-12 after gap closure — see below)  
**Verified:** 2026-07-01 (original); 2026-07-12 (re-audit + gap closure)

## Must-haves

| Truth | Status | Evidence |
|-------|--------|----------|
| Vendor bank account encrypted, masked in API | ✓ | `VendorIT`, `VendorService` |
| PO lifecycle + OPA approval | ✓ | `PurchaseOrderApprovalIT` |
| Mock receive → STOCK_RECEIVED + GR/IR JE | ✓ | `GrnReceiptSimulatorIT` |
| Three-way match via `GrnDataPort` mock | ✓ | `ThreeWayMatchIT`, `PurchasingMockE2EIT` |
| Invoice match + AP payment JEs | ✓ | `PurchasingMockE2EIT.f1_fullFlow` |
| F4 no GRN → MISMATCHED | ✓ | `PurchasingMockE2EIT.f4_noGrn_mismatched` |
| F6 price drift + override | ✓ | `PurchasingMockE2EIT.f6_priceDrift_mismatchedUntilOverride` |
| AP aging endpoint (FIN-05) | ✓ | `ApArController`, `ApAgingService` |
| MSW purchasing fixtures | ✓ | `frontend/mocks/purchasing.handlers.ts` |
| MockGrnReceivePanel + ThreeWayMatchTable | ✓ | frontend components |

## Gaps / follow-ups

- Vendor catalogue REST API not exposed (table exists)
- Spend-by-category analytics (PUR-06) — scorecard only; category breakdown deferred → **10-03**
- Additional frontend pages (PO list, payments, analytics) — minimal routes; expand in verify-work

## Gaps found later (2026-07-12 replan audit)

**Root cause:** this report scored the 11 must-haves it was given, not the requirement TEXT. The
must-haves were narrower than the requirements, so any clause they omitted was never checked and
silently passed. The "11/11 passed" score above measured the wrong thing — it never checked PUR-02's
CLOSED terminal state, PUR-05's third scorecard metric, or FIN-05's expense-approval clause, because
none of those were in the must-haves it was handed. THREE requirements shipped incomplete this way:

- **PUR-02 — PO `CLOSED` transition missing.** ROADMAP SC#2 requires DRAFT→…→CLOSED. `PoStatus.CLOSED`
  was declared in the enum but was dead code — no service, controller, or IT ever set it; the lifecycle
  stopped at FULLY_RECEIVED (`GrnReceiptSimulator.updatePoReceiveStatus`). The "PO lifecycle + OPA
  approval ✓" row above verified DRAFT→SENT only.
  **Closed by 10-04**: `PurchaseOrderService.close(id, reason)` — free close from FULLY_RECEIVED,
  OPA-gated (`vendor.po.close`) mandatory-reason short-close from PARTIALLY_RECEIVED, `V3__po_close.sql`,
  `POST /{id}/close`, `PurchaseOrderCloseIT` (5 tests), Close PO UI on the PO detail page.
  `grep -rn "PoStatus.CLOSED" services/purchasing-service/src/main/java/` now returns a real assignment
  (`PurchaseOrderService.java:120`) — was zero before.
- **PUR-05 — price variance never built.** PUR-05 requires THREE metrics: lead-time adherence, fill
  rate, and **price variance per vendor**. `VendorScorecardDto` shipped with only on-time %, fill rate,
  total spend, and PO count; `VendorAnalyticsService.scorecard()` computed no variance. A repo-wide grep
  for `priceVariance|price_variance` returned ZERO hits — it wasn't even a known deferred gap, it fell
  out of scope before 10-01 shipped and the "Vendor scorecard ✓" row rubber-stamped 2 of 3 metrics.
  **Closed by 10-03 Task 4**: `VendorScorecardDto.priceVariancePct` +
  `VendorAnalyticsService.computePriceVariancePct()` — a spend-weighted mean of per-line
  `(invoiceUnitPricePaisa/poUnitPricePaisa - 1)*100`, reusing `ThreeWayMatchService`'s exact priceRatio
  math. `VendorScorecardIT` (weighted-mean assertion) and `grep -rn "priceVariancePct"
  services/purchasing-service/src/main/java/` now return real hits.
- **FIN-05 — OPA-limited expense approval never built.** FIN-05 is "AP/AR tracked; **expense approval
  respects OPA approval limits**." Only the AP-aging half shipped. There was no Expense entity, no
  ExpenseService/Controller anywhere, and no code path called OPA with an expense action — the
  `finance.expense.approve` permission sat in auth-service's seed with ZERO consumers.
  10-RESEARCH.md:217 explicitly specified this and no plan picked it up. The "AP aging endpoint
  (FIN-05) ✓" row scored the requirement on half its text.
  **Closed by 10-05**: `Expense` entity + `V5__expenses.sql`, `finance.feign.AuthorizationClient`
  (finance-service's first OPA/authorization-service consumer), `ExpenseService.approve()` double-gated
  on RBAC (`finance.expense.approve` authority) + OPA approval-limit check (deny → 403
  `EXPENSE_APPROVAL_LIMIT_EXCEEDED`), balanced JE auto-post on approval via the existing idempotent
  `autoPostInternal`. `ExpenseApprovalIT` (4 tests) and `grep -rn "finance.expense.approve"
  services/finance-service/src/main/java/` now return real `@PreAuthorize` + OPA-call consumers.

**Also caught in the same audit, not requirement-blocking:** PUR-06 (spend by vendor and category with
period comparison) had been left `Pending` in the traceability table with no owning plan — it is a
distinct requirement from PUR-05's scorecard (per-vendor performance metrics) and had no API at all.
**Closed by 10-03 Task 1/3**: `GET /api/v1/purchasing/analytics/spend` (byVendor + byCategory +
deltaPaisa/deltaPct vs. a prior period) plus the `/app/purchasing/analytics` UI. `SpendAnalyticsIT`
proves the aggregation.

## Score

**11/11** of the must-haves as originally scoped — but that score was measuring the wrong thing.
Re-scored against the requirement text after gap closure: **7/7** of PUR-01..06 + FIN-05 are now
genuinely Complete, each backed by a named green IT (confirmed 2026-07-12 against a live Docker Postgres
testcontainer: purchasing-service 18/18 IT green including `SpendAnalyticsIT`, `VendorScorecardIT`,
`PurchaseOrderCloseIT`; finance-service `ExpenseApprovalIT` 4/4 green) and a source-level grep for the
specific clause each requirement adds. Final status re-derived from actual coverage in **10-06** — see
`.planning/REQUIREMENTS.md`.
