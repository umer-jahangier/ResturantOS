---
phase: 10-purchasing-accounts-payable
plan: 12
subsystem: ui
tags: [react, tanstack-query, zod, msw, purchasing, purchase-orders, react-hook-form]

# Dependency graph
requires:
  - phase: 10-10
    provides: "GET /api/v1/purchasing/purchase-orders list endpoint (commit 23a6339), PurchaseOrderDto shape read directly from source"
  - phase: 10-11
    provides: "5-tab purchasing shell whose Purchase Orders tab pointed at a route that 404'd until this plan"
  - phase: 10-09
    provides: "vendor.po.create/approve/send/vendor.grn.receive @PreAuthorize gating, 403 (not 500) on denial"
  - phase: 10-07
    provides: "OPA approval-limit + distinct-approver rule; 403 APPROVAL_LIMIT_EXCEEDED / DUPLICATE_APPROVER on approve"
provides:
  - "PO list page (/app/purchasing/purchase-orders) — the first inbound link purchase-orders/[id] has ever had"
  - "Create-PO dialog (vendor + dynamic line array) producing a DRAFT PO"
  - "Full action bar on PO detail: Submit, Approve, Reject (reason dialog), Withdraw, Send, conditional on po.status"
  - "PoStatusBadge for all 8 PoStatus values"
  - "Per-line goods receipt (MockGrnReceivePanel) — genuine partial receipt is now expressible"
  - "usePurchaseOrders + 6 PO-lifecycle mutation hooks in use-purchasing.ts, all list/detail-cache-consistent"
affects: [10-13, 10-UAT]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useMutation<TData, ApiError, TVariables> generic pinning in lib/hooks/** lets components branch on ApiError.code/.status without importing @/lib/api-client (04-02-C pattern; precedent was use-switch-branch.ts, now also used by all 5 PO action mutations)"
    - "MSW in-memory PO store (purchaseOrders array + per-line receivedByLine map) driving list/create/submit/withdraw/approve/reject/send/mock-receive so a full DRAFT->SENT->PARTIALLY_RECEIVED lifecycle is exercisable through MSW without a real backend"

key-files:
  created:
    - frontend/app/(tenant)/app/purchasing/purchase-orders/page.tsx
    - frontend/components/purchasing/PurchaseOrderFormDialog.tsx
    - frontend/components/purchasing/PoStatusBadge.tsx
    - frontend/__tests__/lib/purchasing-po-journey.test.ts
  modified:
    - frontend/lib/api-client/schemas/purchasing.schema.ts
    - frontend/lib/adapters/purchasing.adapter.ts
    - frontend/lib/repositories/purchasing.repository.ts
    - frontend/lib/hooks/purchasing/use-purchasing.ts
    - frontend/app/(tenant)/app/purchasing/purchase-orders/[id]/page.tsx
    - frontend/components/purchasing/MockGrnReceivePanel.tsx
    - frontend/mocks/purchasing.handlers.ts

key-decisions:
  - "CreatePurchaseOrderRequest.Line (read from the Java DTO, not guessed from plan prose) has NO description field and DOES have uom: {ingredientId, qty, uom, unitPricePaisa}. Schema built against the real DTO."
  - "PurchaseOrderDto.LineDto has no received-to-date field. MockGrnReceivePanel therefore cannot show a running per-line received total — every input defaults to the line's ordered qty ('Receive all in full' convenience) and the user lowers it to express a partial. Flagged for 10-13/next verification pass."
  - "No ingredient-list endpoint/hook exists in scope; PurchaseOrderFormDialog's line rows take a free-text ingredientId (UUID) input rather than a picker."
  - "Fixed a latent bug in apiPoLineSchema.qty: it was z.string() but PurchaseOrderDto.LineDto.qty is a BigDecimal with no custom Jackson serializer, so the real backend returns a JSON number, not a string. Coerced to accept number|string (Rule 1 auto-fix)."
  - "Extended apiPurchaseOrderSchema with notes/requesterId/submittedAt/requiredTiers/tiersApproved (present on the real DTO, absent from the pre-10-12 schema) so the tiers-approved indicator and 403 handling could be built without further schema plans."
  - "poListParamsSchema documents the list query shape as a type only; GET params are not literally .parse()'d (only response bodies are, per FE-08) — the repository builds the params object directly and passes it to axios, matching the existing get() helper pattern."

patterns-established:
  - "Detail-page action bar renders one primary action set per po.status (DRAFT/PENDING_APPROVAL/APPROVED), keeping the close-PO block (built in an earlier plan) untouched and appended below it — a reusable shape for any other status-machine detail page."

# Metrics
duration: ~2h (including two git-race incidents in a concurrently-executed shared working tree)
completed: 2026-07-13
---

# Phase 10 Plan 12: Purchase Order User Journey Summary

**Built the PO list page (first inbound link `purchase-orders/[id]` has ever had), a create-PO dialog, a full status-conditional action bar (submit/approve/reject/withdraw/send) with 10-07 403-code-aware toasts, and rewrote `MockGrnReceivePanel` from a single broadcast qty to genuine per-line inputs — closing UAT gaps 2, 3, 12, and 13.**

## Performance

- **Duration:** ~2h
- **Completed:** 2026-07-13
- **Tasks:** 3/3 completed
- **Files modified:** 11 (4 created, 7 modified)

## Accomplishments

- **Data layer (Task 1):** `purchasing.schema.ts` gained `PO_STATUSES`/`poStatusSchema`, the missing `PurchaseOrderDto` fields (`notes`/`requesterId`/`submittedAt`/`requiredTiers`/`tiersApproved`), `createPurchaseOrderInputSchema` built against the real `CreatePurchaseOrderRequest` Java DTO (which has `uom`, not `description`), `poListParamsSchema`, and `rejectPoInputSchema`. `purchasing.repository.ts` gained `listPurchaseOrders`/`createPurchaseOrder`/`submitPurchaseOrder`/`withdrawPurchaseOrder`/`approvePurchaseOrder`/`rejectPurchaseOrder`/`sendPurchaseOrder`, every one `.parse()`ing through `apiPurchaseOrderSchema`. `use-purchasing.ts` gained `usePurchaseOrders` plus 6 mutations, all invalidating both the single-PO and list query keys, with the 5 action mutations pinned to `useMutation<PurchaseOrder, ApiError, _>` so components branch on `error.code` without importing the api-client. `purchasing.handlers.ts` grew an in-memory PO store backing list/create/submit/withdraw/approve/reject/send, including a 409 `DUPLICATE_APPROVER` mock mirroring 10-07's distinct-approver rule.
- **UI (Task 2):** `purchase-orders/page.tsx` — branch-scoped list with a status filter, "New Purchase Order" button, loading skeleton, empty state; every row links to `purchase-orders/{id}`. `PurchaseOrderFormDialog.tsx` — vendor select (`useVendors`) + `useFieldArray` dynamic line rows + live `MoneyDisplay` total, converting rupees input to `unitPricePaisa` on submit. `PoStatusBadge.tsx` — one badge per `PoStatus`. `purchase-orders/[id]/page.tsx` — action bar conditional on `po.status` (Submit / Approve+Reject+Withdraw / Send), a tiers-approved indicator, a reject-reason dialog, and human copy for the two 10-07 403 codes (`APPROVAL_LIMIT_EXCEEDED`/`DUPLICATE_APPROVER`) via toasts.
- **Per-line receipt (Task 3):** `MockGrnReceivePanel.tsx` rewritten from a single `qty` state broadcast to every line (`po.lines.map(l => ({poLineId: l.id, receivedQty: qty}))`) to one row per PO line with an independent input, a "Receive all in full" convenience button, and per-line validation (0 ≤ qty ≤ ordered). `purchasing.handlers.ts` mock-receive now honours each `{poLineId, receivedQty}` pair independently and the primary fixture PO grew a second line so a genuine two-line partial receipt is testable. `purchasing-po-journey.test.ts` round-trips the real repository/hook code end to end, including a regression pin asserting two DISTINCT `receivedQty` values reach the request body.

## Task Commits

Each task was committed atomically:

1. **Task 1: Purchasing data layer for the PO journey** — `147d6e1` (feat)
2. **Task 2: PO list page + create dialog + detail action bar** — `be249de` (feat)
3. **Task 3: Per-line goods receipt + PO journey test** — `65cea59` (feat)

_No TDD tasks in this plan; no refactor-only commits needed._

## Files Created/Modified

- `frontend/lib/api-client/schemas/purchasing.schema.ts` — `PoStatus` enum, `PurchaseOrderDto` field completion, `createPurchaseOrderInputSchema`/`poListParamsSchema`/`rejectPoInputSchema`, `apiPoLineSchema.qty` number|string coercion fix
- `frontend/lib/adapters/purchasing.adapter.ts` — `PurchaseOrderInput`/`RejectPoInput` types
- `frontend/lib/repositories/purchasing.repository.ts` — 7 new PO repository functions
- `frontend/lib/hooks/purchasing/use-purchasing.ts` — `usePurchaseOrders` + 6 mutations, `ApiError`-pinned generics
- `frontend/app/(tenant)/app/purchasing/purchase-orders/page.tsx` — PO list page (new)
- `frontend/app/(tenant)/app/purchasing/purchase-orders/[id]/page.tsx` — action bar added
- `frontend/components/purchasing/PurchaseOrderFormDialog.tsx` — create-PO dialog (new)
- `frontend/components/purchasing/PoStatusBadge.tsx` — status badge (new)
- `frontend/components/purchasing/MockGrnReceivePanel.tsx` — per-line receipt rewrite
- `frontend/mocks/purchasing.handlers.ts` — PO store + list/create/action/mock-receive handlers
- `frontend/__tests__/lib/purchasing-po-journey.test.ts` — 6-test round-trip suite (new)

## Decisions Made

- **`apiPoLineSchema.qty` bug fix:** `PurchaseOrderDto.LineDto.qty` is a Java `BigDecimal` with no custom Jackson serializer in `shared-lib`'s `SharedAutoConfiguration.sharedObjectMapper()` — it serializes as a JSON *number*, not a string. The pre-existing schema had `qty: z.string()`, which would fail `.parse()` against the real backend. Coerced to `z.union([z.string(), z.number()]).transform(String)`. This was a Rule-1 auto-fix; MSW mocks already used string literals so no test caught it before.
- **`CreatePurchaseOrderRequest` shape read from source, not plan prose:** the plan text guessed `{ingredientId, description, qty, unitPricePaisa}`; the actual DTO is `{ingredientId, qty, uom, unitPricePaisa}` — no `description`, has `uom`. Built the schema against the real DTO.
- **No ingredient picker exists in scope** — `PurchaseOrderFormDialog` line rows take a free-text `ingredientId` UUID input. A real ingredient-select is out of scope for this plan (no `useIngredients` hook/endpoint exists anywhere in the frontend yet).
- **`useMutation<PurchaseOrder, ApiError, _>` generics on all 5 PO action mutations**, following the `use-switch-branch.ts` precedent (04-02-C), so `purchase-orders/[id]/page.tsx` can call `error.code`/`error.message` in `onError` without importing `@/lib/api-client` (ESLint boundary rule enforced).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `apiPoLineSchema.qty` type mismatch with real backend serialization**
- **Found during:** Task 1, reading `PurchaseOrderDto.LineDto` and `SharedAutoConfiguration.sharedObjectMapper()` to confirm the wire contract per the plan's "do not guess the wire shape" instruction.
- **Issue:** `qty: z.string()` would reject the real backend's JSON-number BigDecimal serialization at `.parse()` time.
- **Fix:** `qty` now accepts `z.union([z.string(), z.number()]).transform(String)`.
- **Files modified:** `frontend/lib/api-client/schemas/purchasing.schema.ts`.
- **Commit:** `147d6e1`.

No other bugs, missing-critical-functionality, or blocking issues encountered; no architectural (Rule 4) questions arose.

## Issues Encountered

- **Concurrent multi-agent git contention (environment, not a plan deviation):** this session's repository was being edited live by at least one sibling plan executor (10-14, finance frontend) in the same working tree at the same time. Two race conditions occurred:
  1. My Task 3 `git add` + `git commit` swept in 4 already-staged files belonging to 10-14 (`finance/expenses/page.tsx`, `ExpenseFormDialog.tsx`, `finance/layout.tsx`, `sidebar-nav-items.ts`). Fixed non-destructively with `git reset --soft HEAD~1` (undoes only the commit, keeps the working tree/index) followed by `git reset HEAD -- <their files>` to unstage them back to their pre-commit state, then re-staging only my 3 files.
  2. Before my corrected commit could land, the sibling process's own commit (and at least one of its own reset/retry cycles) transiently swept in my 3 files, then reset them back out again — visible as `HEAD` moving under me mid-session (`git commit` even failed once with `fatal: cannot lock ref 'HEAD'` from a literal concurrent write). No content was lost at any point (verified by re-diffing file content against `HEAD` after every unexpected `git log` change); the final state is a clean, single commit (`65cea59`) containing exactly my 3 Task 3 files.
  - **Takeaway for future concurrent gap-closure waves:** when multiple plan executors are known to run in parallel against the same working tree (as documented in this plan's own context block), commit immediately after `git add` with no intervening tool calls, and always re-verify `git status`/`git show --stat HEAD` right after a commit returns success — a returned commit hash is not a reliable signal of that commit's final file set in this environment.
- **No real click-path performed.** Per the plan's acceptance criterion (lesson 10-06-A: MSW-green is not sufficient), a genuine browser click-through with a running gateway/auth-service/purchasing-service stack and a MANAGER login was the intended verification. This execution environment has Docker infra up (`postgres`/`redis`/`opa`/`eureka`/`config-server`/`minio`/`mailpit`) but **no application services running** (`auth-service`/`gateway`/`purchasing-service`/frontend dev server) and **no browser-automation tool available to this agent**. A backend-service boot attempt failed fast on a missing `deploy/.env` (`ERROR: deploy/.env missing. Run: bash deploy/generate-keys.sh`), and standing up the full stack plus seeding a MANAGER session was out of scope for a bounded gap-closure session. What WAS verified instead: `tsc --noEmit` clean, `eslint` clean (zero new errors — only pre-existing, unrelated errors in untouched files), `next build` succeeds with `/app/purchasing/purchase-orders` and `/app/purchasing/purchase-orders/[id]` both compiling, and a 6-test MSW round-trip suite exercising the real repository/hook/schema code (not a mocked repository) against contracts read directly from the backend Java source. **This falls short of the plan's explicit acceptance bar** — flagging honestly rather than claiming a click-path that did not happen. The next session with a running full stack (or a browser tool) should perform the actual click-through described in the plan's Task 2/Task 3 `<verify>` blocks before this gap is considered closed for UAT purposes.

## Verification Results

- `cd frontend && npx tsc --noEmit` — clean after every task, including the final state.
- `cd frontend && npx eslint lib components mocks app` (and the full `npx eslint .`) — zero new errors; the only errors present are pre-existing and in files this plan never touched (`components/finance/JournalEntryForm.tsx`, `components/finance/PeriodCloseModal.tsx`, `components/providers/session-provider.tsx` — all `react-hooks/set-state-in-effect` or the boundary rule, unrelated to purchasing). One warning in a file this plan created (`PurchaseOrderFormDialog.tsx:98`, React Compiler skipping `form.watch()` memoization) — same class of pre-existing warning as `components/ui/data-table.tsx`'s `useReactTable()`, not an error.
- `cd frontend && npx next build` — succeeds; route table includes `○ /app/purchasing/purchase-orders` (static) and `ƒ /app/purchasing/purchase-orders/[id]` (dynamic).
- `cd frontend && npx vitest run __tests__/lib/purchasing-po-journey.test.ts` — 6/6 green: list-parses-every-row, DRAFT→PENDING_APPROVAL→APPROVED→SENT round-trip, withdraw+reject-requires-reason, distinct-per-line-receivedQty regression pin, real per-line partial receive → `PARTIALLY_RECEIVED` (not `FULLY_RECEIVED`), 403 `APPROVAL_LIMIT_EXCEEDED` surfacing as a typed `ApiError` through `useApprovePurchaseOrder`.
- `cd frontend && npx vitest run` (full suite, at final HEAD) — 112/115 passed; the 3 failures are the pre-existing, documented environmental timeouts (`login-form.test.tsx` ×2, `eslint-boundary.test.ts` ×1) called out in this plan's own context block as "do NOT chase" — none in purchasing-scoped files.
- `grep -n "receivedQty" frontend/components/purchasing/MockGrnReceivePanel.tsx` → `po.lines.map((l) => ({ poLineId: l.id, receivedQty: qtyByLine[l.id] ?? "0" }))` — a per-line input binding (`qtyByLine[l.id]`), not a single shared `qty` state. Matches the plan's verification step 3.
- **Real click-path: NOT performed this session** — see "Issues Encountered" above. This is the one acceptance criterion left open.

## Next Phase Readiness

- **For 10-13 (extends these same files):** `use-purchasing.ts`/`purchasing.repository.ts`/`purchasing.schema.ts`/`purchasing.handlers.ts` seams are clean — `PurchasingRepository.createInvoice` remains untouched dead code (no hook, no caller), as instructed. `poListParamsSchema`/`rejectPoInputSchema`/`createPurchaseOrderInputSchema` are new exports 10-13 can reuse rather than re-deriving.
- **Backend gap to flag for the next verification pass:** `PurchaseOrderDto.LineDto` has no received-to-date field, so the UI cannot show "42 of 100 kg received so far" — only ordered qty. If a future UAT case wants that visibility, it needs a backend DTO change (a `receivedQty`/`grnQtyToDate` field), not a frontend one.
- **Real click-path verification is still owed** — the next session with a live backend stack (or browser-automation access) should run the plan's Task 2/Task 3 manual click-path steps verbatim before UAT tests 2, 3, 12, 13 are marked resolved rather than merely "unblocked in code."
- No blockers introduced for 10-13 or later purchasing/finance work; the git-contention incident (see Issues Encountered) resolved cleanly with no lost work, and both this plan's and the sibling 10-14 plan's final commits are separately clean and correctly scoped as of `HEAD`.
