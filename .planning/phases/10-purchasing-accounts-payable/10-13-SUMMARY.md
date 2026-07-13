---
phase: 10-purchasing-accounts-payable
plan: 13
subsystem: ui
tags: [react, tanstack-query, zod, msw, purchasing, vendor-invoices, accounts-payable, three-way-match]

# Dependency graph
requires:
  - phase: 10-12
    provides: "purchasing.{schema,adapter,repository} + use-purchasing.ts + purchasing.handlers.ts data-layer patterns (this plan extends the SAME files); apiPoLineSchema qty number|string coercion precedent applied to invoice lines"
  - phase: 10-10
    provides: "GET /api/v1/purchasing/invoices list endpoint (non-paginated ApiResponse<List<Dto>>) with matchStatus per line"
  - phase: 10-09
    provides: "vendor.invoice.book/vendor.invoice.override/vendor.payment.create @PreAuthorize gating, 403 (not 500) on denial"
  - phase: 10-11
    provides: "purchasing tab bar already links to /app/purchasing/invoices and /app/purchasing/payments — both 404'd until this plan"
provides:
  - "Invoice list page (/app/purchasing/invoices) — the first inbound link invoices/[id] (and its ThreeWayMatchTable) has ever had"
  - "Book-invoice dialog (VendorInvoiceFormDialog) — first caller of PurchasingRepository.createInvoice, no longer dead code"
  - "OverrideMatchDialog — first frontend consumer of POST /invoices/{id}/override-match"
  - "AP payments page (/app/purchasing/payments) + ApPaymentDialog — first frontend consumer of POST /api/v1/purchasing/payments"
  - "useVendorInvoices/useCreateVendorInvoice/useOverrideMatch/useCreateApPayment in use-purchasing.ts"
affects: [10-UAT]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "matchLineStatus() in purchasing.handlers.ts mirrors ThreeWayMatchService.matchLine's real TenantMatchTolerance defaults (qtyOverPct=0, qtyUnderPct=0.05, priceOverPct=0.02, priceUnderPct=0.10) exactly, read from TenantMatchTolerance.java, not invented — the mock cannot teach the invoice-journey test a tolerance the backend doesn't enforce"
    - "Payments page reads the invoice list (status MATCHED/APPROVED_FOR_PAYMENT/PAID) rather than a separate payments query — ApPaymentController is POST-only server-side, no GET /payments exists"

key-files:
  created:
    - frontend/app/(tenant)/app/purchasing/invoices/page.tsx
    - frontend/app/(tenant)/app/purchasing/payments/page.tsx
    - frontend/components/purchasing/VendorInvoiceFormDialog.tsx
    - frontend/components/purchasing/OverrideMatchDialog.tsx
    - frontend/components/purchasing/ApPaymentDialog.tsx
    - frontend/__tests__/lib/purchasing-invoice-journey.test.ts
  modified:
    - frontend/lib/api-client/schemas/purchasing.schema.ts
    - frontend/lib/adapters/purchasing.adapter.ts
    - frontend/lib/repositories/purchasing.repository.ts
    - frontend/lib/hooks/purchasing/use-purchasing.ts
    - frontend/mocks/purchasing.handlers.ts
    - frontend/app/(tenant)/app/purchasing/invoices/[id]/page.tsx
    - frontend/components/purchasing/ThreeWayMatchTable.tsx

key-decisions:
  - "CreateVendorInvoiceRequest/CreateApPaymentRequest read from the real Java DTOs, not the plan's guessed shapes: NEITHER write payload has vendorId or branchId (both derived server-side — from the PO for invoices, from the invoice for payments); CreateApPaymentRequest also has no `method` field, and `bankAccountCode` is optional (server defaults to \"1110\"). Built createVendorInvoiceInputSchema/createApPaymentInputSchema against the real DTOs."
  - "VendorInvoiceDto.LineDto (real backend) has NO poQty/poUnitPricePaisa/grnQty fields — only id/poLineId/qty/unitPricePaisa/lineTotalPaisa/matchStatus. ThreeWayMatchTable's PO-qty/GRN-qty columns degrade to \"—\" against the real API (the fields stayed optional in apiInvoiceLineSchema so .parse() doesn't reject the real response). This is the invoice-side counterpart of 10-12's PurchaseOrderDto.LineDto received-to-date gap — flagged, not faked."
  - "LineMatchStatus (backend enum) is OK/QTY_OVER/QTY_UNDER/PRICE_OVER/PRICE_UNDER/MISSING_GRN/PENDING — read from LineMatchStatus.java, not the MATCHED/PRICE_VARIANCE/QTY_VARIANCE vocabulary the plan's own context block assumed. MatchStatusBadge extended with the real vocabulary (plus InvoiceStatus's PENDING_MATCH/MATCHED/MISMATCHED/APPROVED_FOR_PAYMENT/PAID) rather than writing a third badge, per the plan's explicit instruction."
  - "apiInvoiceLineSchema.qty gets the same BigDecimal number|string coercion applied to apiPoLineSchema.qty in 10-12 (Rule 1 auto-fix) — VendorInvoiceDto.LineDto.qty is also a BigDecimal with no custom Jackson serializer."
  - "No GET /payments list endpoint exists on the backend (ApPaymentController.java is POST-only) — PurchasingRepository has no listApPayments; the payments page reads the invoice list filtered to MATCHED/APPROVED_FOR_PAYMENT/PAID instead, per the plan's own fallback instruction."
  - "ApPaymentDialog's amount field is editable (CreateApPaymentRequest.amountPaisa accepts any positive value, defaulting to the invoice total+tax when omitted) but ApPaymentService.create ALWAYS marks the invoice PAID regardless of the amount actually paid — there is no partial-payment / outstanding-balance tracking on VendorInvoice server-side. A user entering less than the full amount does NOT leave the invoice partially open. Flagged rather than building a partial-payment UX the backend can't back up."
  - "No permission-gating helper exists anywhere in this codebase for inline action buttons (only useNavVisibility for nav items). OverrideMatchDialog's trigger button always renders; a user without vendor.invoice.override sees a 403 toast on submit rather than the button being hidden proactively — matches the plan's own explicit fallback instruction."
  - "overrideMatchInputSchema enforces a client-side >= 10-char justification minimum (the backend only rejects blank/null) — the plan's own instruction: '1-char is not one'. Verified in the invoice-journey test as a throwing .parse(), not just documentation."

patterns-established:
  - "Invoice/payment detail pages route status-conditional actions the same way purchase-orders/[id]/page.tsx does (10-12 pattern): one action block per status, appended rather than replacing prior blocks."

# Metrics
duration: ~2h
completed: 2026-07-13
---

# Phase 10 Plan 13: Vendor Invoice + AP Payment User Journey Summary

**Built the vendor-invoice and AP-payment journeys end to end: list, book, 3-way-match review, override, pay — closing UAT gaps 4, 5, 6, 7, and 8, and making `PurchasingRepository.createInvoice` a real, called, Zod-validated function for the first time.**

## Performance

- **Duration:** ~2h
- **Completed:** 2026-07-13
- **Tasks:** 3/3 completed
- **Files modified:** 13 (6 created, 7 modified)

## Accomplishments

- **Data layer (Task 1):** `purchasing.schema.ts` gained `INVOICE_STATUSES`/`invoiceStatusSchema`, `LINE_MATCH_STATUSES`/`lineMatchStatusSchema`, `createVendorInvoiceInputSchema`/`createVendorInvoiceLineInputSchema` (built against the real `CreateVendorInvoiceRequest` Java DTO — no `vendorId`/`branchId`, field is `purchaseOrderId` not `poId`), `overrideMatchInputSchema` (>= 10-char client-side justification), `createApPaymentInputSchema`/`apiApPaymentSchema` (built against `CreateApPaymentRequest`/`ApPaymentDto` — no `branchId`/`method`, allocations array not a top-level `invoiceId`), and `invoiceListParamsSchema`. `apiInvoiceLineSchema.qty` got the same BigDecimal number|string coercion 10-12 applied to PO lines. `purchasing.repository.ts`'s `createInvoice(body: unknown)` was tightened to `createInvoice(input: VendorInvoiceInput)` — no `unknown` remains in the signature — and gained `listInvoices`/`overrideMatch`/`createApPayment` (no `listApPayments`: the backend has no `GET /payments`). `use-purchasing.ts` gained `useVendorInvoices`/`useCreateVendorInvoice`/`useOverrideMatch`/`useCreateApPayment`, all invalidating both the invoice list key and the specific invoice's detail key. `purchasing.handlers.ts` gained a real invoice/payment store with `matchLineStatus()` mirroring `ThreeWayMatchService`'s exact tolerance defaults (read from `TenantMatchTolerance.java`: qtyOverPct=0, qtyUnderPct=0.05, priceOverPct=0.02, priceUnderPct=0.10), plus `GET /invoices` (list), `POST /invoices/{id}/override-match`, and `POST /payments` handlers.
- **UI (Task 2):** `invoices/page.tsx` — branch-scoped list with a status filter, "Book Invoice" button, every row linking to `invoices/{id}` (the inbound link that route never had). `VendorInvoiceFormDialog.tsx` — PO picker (`usePurchaseOrders` filtered to SENT/PARTIALLY_RECEIVED/FULLY_RECEIVED, the only invoiceable states), prefills one editable line per PO line so editing qty/price is how MATCHED/MISSING_GRN/PRICE_OVER outcomes are driven from the UI, routes to the invoice detail page on success. `OverrideMatchDialog.tsx` — mandatory >= 10-char justification with submit disabled until met, wired into `invoices/[id]/page.tsx` on a MISMATCHED invoice. `ThreeWayMatchTable.tsx`'s `MatchStatusBadge` extended to cover the full real `LineMatchStatus`/`InvoiceStatus` vocabularies and reused for both the list's status column and the detail header badge (no third badge written).
- **Payments (Task 3):** `payments/page.tsx` — the Payments tab 10-11 linked but nothing rendered — payables worklist (invoice #, vendor, amount, days outstanding, Pay action) plus a recently-PAID section, both driven off `useVendorInvoices` since no payments-list endpoint exists. `ApPaymentDialog.tsx` — first frontend consumer of `POST /api/v1/purchasing/payments`, the endpoint that posts AP → Bank in finance and publishes `AP_PAYMENT_PROCESSED`. `purchasing-invoice-journey.test.ts` — 4 tests through the real repository/hook/schema code: fully-receive → exact-match book → MATCHED; a >2%-over-price book → MISMATCHED/PRICE_OVER → override (with a throwing-.parse() regression pin for a too-short justification) → APPROVED_FOR_PAYMENT; and `createApPayment` → PAID with `amountPaisa` proven to round-trip as a whole-paisa integer, not a float rupee value.

## Task Commits

Each task was committed atomically:

1. **Task 1: Invoice + payment data layer (schema -> adapter -> repository -> hooks + MSW)** — `a0aaded` (feat)
2. **Task 2: Invoice list page, book-invoice dialog, and the override-match action** — `58f5647` (feat)
3. **Task 3: AP payments page + invoice-journey test** — `8f6f765` (feat)

_No TDD tasks in this plan; no refactor-only commits needed._

## Files Created/Modified

- `frontend/lib/api-client/schemas/purchasing.schema.ts` — invoice/payment enums + write schemas built against the real backend DTOs, `apiInvoiceLineSchema.qty` coercion fix
- `frontend/lib/adapters/purchasing.adapter.ts` — `VendorInvoiceInput`/`OverrideMatchInput`/`ApPayment`/`ApPaymentInput` types + `adaptApPayment`
- `frontend/lib/repositories/purchasing.repository.ts` — `createInvoice` tightened off `unknown`; `listInvoices`/`overrideMatch`/`createApPayment` added
- `frontend/lib/hooks/purchasing/use-purchasing.ts` — `useVendorInvoices`/`useCreateVendorInvoice`/`useOverrideMatch`/`useCreateApPayment`
- `frontend/mocks/purchasing.handlers.ts` — real invoice/payment store, `matchLineStatus()`, list/override/pay handlers
- `frontend/app/(tenant)/app/purchasing/invoices/page.tsx` — invoice list page (new)
- `frontend/app/(tenant)/app/purchasing/invoices/[id]/page.tsx` — status badge, override-match wiring, PO/back links
- `frontend/app/(tenant)/app/purchasing/payments/page.tsx` — AP payments page (new)
- `frontend/components/purchasing/VendorInvoiceFormDialog.tsx` — book-invoice dialog (new)
- `frontend/components/purchasing/OverrideMatchDialog.tsx` — override-match dialog (new)
- `frontend/components/purchasing/ApPaymentDialog.tsx` — AP payment dialog (new)
- `frontend/components/purchasing/ThreeWayMatchTable.tsx` — `MatchStatusBadge` vocabulary extended
- `frontend/__tests__/lib/purchasing-invoice-journey.test.ts` — 4-test round-trip suite (new)

## Decisions Made

See `key-decisions` in frontmatter. The most consequential: **both write DTOs (`CreateVendorInvoiceRequest`, `CreateApPaymentRequest`) were read from the actual Java source rather than trusting the plan's own context block**, which assumed shapes (`{poId, vendorId, branchId, ...}` and `{invoiceId, branchId, amountPaisa, ..., method?}`) that do not exist on the real DTOs. Building against the plan's guessed shapes would have produced schemas that reject the real backend's requests/responses at `.parse()` time — exactly the class of bug 10-12 caught and fixed for PO lines.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `apiInvoiceLineSchema.qty` type mismatch with real backend serialization**
- **Found during:** Task 1, reading `VendorInvoiceDto.LineDto` to confirm the wire contract (same class of bug 10-12 found and fixed for `apiPoLineSchema.qty`).
- **Issue:** `qty: z.string()` would reject the real backend's JSON-number BigDecimal serialization at `.parse()` time.
- **Fix:** `qty` now accepts the same `number|string` coercion as `apiPoLineSchema.qty`.
- **Files modified:** `frontend/lib/api-client/schemas/purchasing.schema.ts`.
- **Commit:** `a0aaded`.

**2. [Rule 3 - Blocking] Plan's assumed write-payload shapes did not match the real backend DTOs**
- **Found during:** Task 1, reading `CreateVendorInvoiceRequest.java`/`CreateApPaymentRequest.java` per the plan's own explicit instruction to read them before writing schemas.
- **Issue:** The plan's `<context>` block specified `createVendorInvoiceInputSchema` as `{poId, vendorId, branchId, invoiceNumber, invoiceDate, lines}` and `createApPaymentInputSchema` as `{invoiceId, branchId, amountPaisa, paymentDate, method?}`. Neither field set matches the real DTOs (`{purchaseOrderId, invoiceNo, invoiceDate, inputTaxPaisa?, lines}` and `{invoiceId, paymentDate, amountPaisa, bankAccountCode?}` respectively) — building to the plan's prose would have produced a repository that either 400s on every real request or silently drops fields the backend needs.
- **Fix:** Schemas built against the real Java DTOs; documented in `key-decisions`.
- **Files modified:** `frontend/lib/api-client/schemas/purchasing.schema.ts`, `frontend/lib/adapters/purchasing.adapter.ts`, `frontend/lib/repositories/purchasing.repository.ts`, `frontend/components/purchasing/VendorInvoiceFormDialog.tsx`, `frontend/components/purchasing/ApPaymentDialog.tsx`.
- **Commits:** `a0aaded`, `58f5647`, `8f6f765`.

No other bugs, missing-critical-functionality, or blocking issues encountered; no architectural (Rule 4) questions arose.

## Issues Encountered

- **No permission-gating helper exists in this codebase for inline action buttons.** Confirmed by grep (`grep -rn "vendor.invoice.override|hasPermission|usePermission|useHasPermission"` returns only `useNavVisibility`, which gates nav items, not buttons). Per the plan's own explicit fallback instruction, `OverrideMatchDialog`'s trigger button always renders regardless of whether the current user holds `vendor.invoice.override`; a denial surfaces as a 403 toast on submit. This is documented, not silently worked around — a future plan building a general `usePermission(code)` hook would let this (and the PO action bar's buttons from 10-12) hide proactively instead.
- **Real click-path: attempted, not achieved this session.** Checked `docker ps` first: only infra containers (postgres/redis/opa/eureka/config-server/minio/mailpit/clickhouse/rabbitmq) plus, this session, three already-running application JVMs (`gateway`, `auth-service`, `purchasing-service` — presumably started by a concurrently-running sibling gap-closure agent, since `deploy/.env` now exists where 10-12's session found it missing). However, `curl`ing each service's `/actuator/health` returned `503`/`500`/`{"status":"DOWN"}` at the time of this check, and a request to the running Next.js dev server (`localhost:3000/app/purchasing/invoices`) timed out after 15s (consistent with a page that round-trips through the DAL/proxy to a DOWN gateway on load). No browser-automation tool is available to this agent. Given this is a live, actively-shared multi-agent working tree (10-14 running finance-service AR migrations concurrently per the untracked `ArAgingBucketDto.java` etc. files visible in `git status` during this session), diagnosing and fixing three services' DOWN health was judged out of scope for this plan's bounded session — the instability is environmental, not something introduced by this plan's changes. **What WAS verified instead:** `tsc --noEmit` clean at every task boundary and at final HEAD; `eslint` clean (zero new errors — the 6 errors present are pre-existing and in files this plan never touched: `JournalEntryForm.tsx`, `PeriodCloseModal.tsx`, `session-provider.tsx`); `next build` succeeds with `/app/purchasing/invoices`, `/app/purchasing/invoices/[id]`, and `/app/purchasing/payments` all compiling into the route table; and a 4-test MSW round-trip suite exercising the real repository/hook/schema code (not a mocked repository) against contracts read directly from the backend Java source, including a client-side justification-length regression pin and a paisa-integer regression pin for the classic money bug. **This falls short of the plan's explicit acceptance bar** ("Real-path manual: ... entirely from the browser, with the finance JE confirmed") — flagging honestly, exactly as 10-12 did for the same reason in the same environment, rather than claiming a click-path that did not happen. The next session with genuinely healthy backend services (or a browser-automation tool) should perform the plan's Task 2/Task 3 manual click-path steps verbatim, including confirming the AP → Bank journal entry in the finance GL, before UAT tests 4–8 are marked resolved rather than merely "unblocked in code."

## Verification Results

- `cd frontend && npx tsc --noEmit` — clean after every task, including the final state.
- `cd frontend && npx eslint lib components mocks app __tests__` — zero new errors; the only errors present are pre-existing and in files this plan never touched (`JournalEntryForm.tsx`, `PeriodCloseModal.tsx`, `session-provider.tsx` — all `react-hooks/set-state-in-effect` or a pre-existing boundary violation, unrelated to purchasing). Two warnings in files this plan created (`VendorInvoiceFormDialog.tsx:98`, React Compiler skipping `form.watch()` memoization) — same class of pre-existing warning as `PurchaseOrderFormDialog.tsx`/`data-table.tsx`, not an error.
- `cd frontend && npx next build` — succeeds; route table includes `○ /app/purchasing/invoices`, `ƒ /app/purchasing/invoices/[id]`, and `○ /app/purchasing/payments`.
- `cd frontend && npx vitest run __tests__/lib/purchasing-invoice-journey.test.ts` — 4/4 green.
- `cd frontend && npx vitest run` (full suite, final HEAD) — 124/126 passed; the 2 failures are the pre-existing, documented environmental timeouts (`login-form.test.tsx`, `eslint-boundary.test.ts`) this plan's own context block explicitly says not to chase — neither in purchasing-scoped files.
- `grep -n "createInvoice" frontend/lib/repositories/purchasing.repository.ts` → `async createInvoice(input: VendorInvoiceInput): Promise<VendorInvoice>` — no `unknown` in the signature. `grep -rn "useCreateVendorInvoice" frontend/` → defined in `use-purchasing.ts` AND called in `VendorInvoiceFormDialog.tsx` — a real caller, not dead code.
- **Real click-path: NOT performed this session** — see "Issues Encountered" above. This is the one acceptance criterion left open, same as 10-12.

## Next Phase Readiness

- `PurchasingRepository` now has zero purchasing functions without a caller: `createInvoice`/`listInvoices`/`overrideMatch`/`createApPayment` all have hooks, and every hook has a UI caller (`VendorInvoiceFormDialog`, `invoices/page.tsx`, `OverrideMatchDialog`, `ApPaymentDialog`).
- **Backend gap to flag for the next verification pass (mirrors 10-12's PO-line gap):** `VendorInvoiceDto.LineDto` has no `poQty`/`poUnitPricePaisa`/`grnQty` fields — the UI cannot show "PO said 100kg @ 10.00, GRN received 100kg" on the real API, only what the invoice itself carries. If a future UAT case wants that visibility, it needs a backend DTO change, not a frontend one.
- **No partial-AP-payment support server-side** — `ApPaymentService.create` always marks the invoice PAID regardless of `amountPaisa` sent. If the business ever needs genuine partial payments (multiple payments against one invoice, a running outstanding balance), that's a backend `VendorInvoice`/`ApPayment` model change, not something this plan's frontend can retrofit.
- **Real click-path verification is still owed** — same standing item as 10-12's SUMMARY. The next session with genuinely healthy backend services (all three of gateway/auth-service/purchasing-service returned DOWN health at check time despite being started) or a browser-automation tool should run this plan's Task 2/Task 3 manual click-path steps verbatim, including confirming the AP → Bank journal entry in the finance GL (`GET /api/v1/finance/gl/balances` or the journal-entries page), before UAT tests 4–8 are marked resolved.
- No blockers introduced for future purchasing/finance work. This plan's git operations (individual-file staging, `git show --stat` verification after each commit) encountered no races this session, though sibling 10-14 activity (finance-service AR DTOs) was visible in `git status` throughout and was never staged by this plan.