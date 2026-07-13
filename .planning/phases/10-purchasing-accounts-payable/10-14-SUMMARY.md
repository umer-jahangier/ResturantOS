---
phase: 10-purchasing-accounts-payable
plan: 14
subsystem: frontend
tags: [nextjs, tanstack-query, zod, finance, expenses, ap-aging, msw, gap-closure]

# Dependency graph
requires:
  - phase: 10-10
    provides: "GET /api/v1/finance/expenses (list) + GET /api/v1/finance/ap/aging real backend endpoints; non-paginated ApiResponse<List<Dto>> contract (10-10-A)"
  - phase: 10-11
    provides: "sidebar-nav-items.ts FeatureFlag typing + drift test (fails build if a nav item's feature string isn't a real backend flag) + purchasing tab-bar pattern this plan's finance tab bar copies"
  - phase: 10-05
    provides: "ExpenseService create/approve/reject + OPA approval-limit gate (EXPENSE_APPROVAL_LIMIT_EXCEEDED) this plan's UI surfaces"
  - phase: 10-09
    provides: "AccessDeniedException -> 403 handler (finance-service inherits shared-lib's GlobalExceptionHandler)"
provides:
  - "FIN-05 frontend: /app/finance/expenses (create/approve/reject inbox) and /app/finance/ap-aging (bucketed AP report) -- UAT tests 16 and 9 are now executable from the UI, not only from an integration test"
  - "finance.{schema,adapter,repository}.ts + use-finance.ts: Zod-validated data layer for expense CRUD/approve/reject and AP aging"
  - "mocks/finance.handlers.ts: MSW fixtures modelling the OPA approval-limit gate for dev/test"
affects: [10-18]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-row mutation hooks (useApproveExpense(id)/useRejectExpense(id) called inside a dedicated ExpenseRow sub-component, never inside the parent's .map() callback) so rules-of-hooks holds for a table where each row can independently approve/reject -- same shape as 10-12's PO detail-page action bar, extended to a list."
    - "Finance module layout gained a purchasing-style tab bar (frontend/app/(tenant)/app/finance/layout.tsx) -- previously it had none; copied verbatim from frontend/app/(tenant)/app/purchasing/layout.tsx's TABS/usePathname/cn shape."

key-files:
  created:
    - frontend/lib/hooks/finance/use-finance.ts
    - frontend/mocks/finance.handlers.ts
    - frontend/components/finance/ExpenseFormDialog.tsx
    - frontend/components/finance/ApAgingTable.tsx
    - "frontend/app/(tenant)/app/finance/expenses/page.tsx"
    - "frontend/app/(tenant)/app/finance/ap-aging/page.tsx"
    - frontend/__tests__/lib/finance-expense-journey.test.ts
  modified:
    - frontend/lib/api-client/schemas/finance.schema.ts
    - frontend/lib/adapters/finance.adapter.ts
    - frontend/lib/repositories/finance.repository.ts
    - frontend/lib/models/finance.model.ts
    - frontend/lib/hooks/query-keys.ts
    - frontend/mocks/server.ts
    - "frontend/app/(tenant)/app/finance/layout.tsx"
    - frontend/components/shared/sidebar-nav-items.ts

key-decisions:
  - "apiExpenseSchema built against ExpenseDto.java verbatim, not plan prose: wire field is rejectReason (not rejectionReason), and description/approvedBy/approvedAt/rejectReason are all nullable."
  - "apiApAgingBucketSchema has no invoice-count field -- ApAgingBucketDto.java carries only label/minDays/maxDays/amountPaisa. Earlier plan prose assumed an invoice count per bucket; the Java DTO wins and the table renders label/day-range/amount only."
  - "List endpoints consumed as a plain z.array(apiExpenseSchema), no PageMeta, per 10-10-A -- FinanceRepository.listExpenses never expects a paginated envelope."
  - "mocks/server.ts (not mocks/handlers.ts, despite the plan's file list) is the actual MSW handler-registration point; financeHandlers is spread in there alongside the existing purchasingHandlers. Documented as a deviation below."

patterns-established:
  - "A per-row action table (approve/reject inline, not on a detail page) needs its own row sub-component so id-scoped TanStack mutation hooks are called consistently across renders -- reusable for any future approver-inbox-style list."

# Metrics
duration: 70min
completed: 2026-07-13
---

# Phase 10 Plan 14: FIN-05 Frontend (Expense Journey + AP Aging) Summary

**Built the FIN-05 frontend gap: an expense create/approve/reject inbox and a bucketed AP aging report, both wired to 10-10's real backend endpoints -- UAT tests 16 and 9 are now executable by a human in the browser, not only by an integration test.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3
- **Files modified:** 15 (11 created, 8 modified — some files touched across more than one task)

## Accomplishments

- Closed the structural gap the UAT flagged: `GET /api/v1/finance/ap/aging` had zero frontend consumers and there was no expense UI at all (create, approve, or reject) — 10-05 shipped a fully OPA-gated `ExpenseService` that no human could invoke from the app.
- `/app/finance/expenses` is a real approver's inbox: default filter is `PENDING_APPROVAL`, per-row Approve/Reject actions, a mandatory-reason reject dialog, and — the actual point of the requirement — a 403 `EXPENSE_APPROVAL_LIMIT_EXCEEDED` renders an explicit "This expense exceeds your approval limit" toast, not a generic failure message.
- `/app/finance/ap-aging` renders all four buckets (Current / 31-60 / 61-90 / Over 90) with a total row; the Over-90 bucket uses the destructive semantic token so overdue money is visually obvious, per 04-04-B.
- The finance module layout gained a tab bar for the first time (Accounts / Journal Entries / General Ledger / Periods / Expenses / AP Aging), copied verbatim from purchasing's tab-bar shape — previously finance had no in-module nav at all, only sidebar links.
- Sidebar nav gained Expenses and AP Aging entries under the existing Finance group, both gated by the real `FEATURE_FINANCE` flag (10-11's drift test — which fails the build if a nav item references a feature string the backend doesn't grant — passed unchanged).
- Zod schemas were built directly against the Java DTOs (`ExpenseDto`, `CreateExpenseRequest`, `ApAgingReportDto`, `ApAgingBucketDto`), not plan prose, catching two places where the plan text was wrong: the wire field is `rejectReason` (not `rejectionReason`), and `ApAgingBucketDto` has no invoice-count field at all.
- `finance-expense-journey.test.ts` exercises the real repository/hook/adapter/Zod stack through MSW (not a stubbed fetch) — 7/7 green — and specifically asserts the over-limit approval failure by its `ApiError.code`, not merely that it threw, so a regression that turned this into a generic error would be caught.

## Task Commits

1. **Task 1: Finance data layer for expenses + AP aging** — `b34e200` (feat)
2. **Task 2: Expenses page (create/approve/reject) + finance nav tabs** — `9e2202b` (feat)
3. **Task 3: AP aging page + expense journey test** — `b0052bd` (feat)

## Files Created/Modified

- `frontend/lib/api-client/schemas/finance.schema.ts` — `apiExpenseSchema`/`apiExpenseListSchema`/`apiCreateExpenseSchema`/`rejectExpenseInputSchema`/`apiApAgingBucketSchema`/`apiApAgingSchema`, built against the Java DTOs
- `frontend/lib/adapters/finance.adapter.ts` — `adaptExpense`/`adaptApAgingBucket`/`adaptApAging`
- `frontend/lib/repositories/finance.repository.ts` — `listExpenses`/`createExpense`/`approveExpense`/`rejectExpense`/`getApAging`, all `.parse()`-first; zero `purchasing` references (verified by grep)
- `frontend/lib/models/finance.model.ts` — `Expense`/`ExpenseStatus`/`CreateExpenseInput`/`ApAging`/`ApAgingBucket`
- `frontend/lib/hooks/query-keys.ts` — `finance.expenses`/`finance.apAging` keys
- `frontend/lib/hooks/finance/use-finance.ts` (new) — `useExpenses`/`useCreateExpense`/`useApproveExpense`/`useRejectExpense`/`useApAging`; mutations pin `TError` to `ApiError` so components branch on `error.code` via TanStack's mutation-error type inference
- `frontend/mocks/finance.handlers.ts` (new) — MSW fixtures including an OPA approval-limit simulation (over-limit approve -> 403 `EXPENSE_APPROVAL_LIMIT_EXCEEDED`, expense stays `PENDING_APPROVAL`)
- `frontend/mocks/server.ts` — registered `financeHandlers` alongside the pre-existing `handlers`/`purchasingHandlers`
- `frontend/components/finance/ExpenseFormDialog.tsx` (new) — create form, modelled on `VendorFormDialog`'s dialog + `createZodResolver` + mutation shape; reuses `useAccounts({type:"EXPENSE"})` for the account select (no second CoA fetch path)
- `frontend/app/(tenant)/app/finance/expenses/page.tsx` (new) — approver's inbox; `ExpenseRow` is its own component so per-row `useApproveExpense`/`useRejectExpense` obey rules of hooks
- `frontend/components/finance/ApAgingTable.tsx` (new) — four buckets + total row, Over-90 uses the destructive token
- `frontend/app/(tenant)/app/finance/ap-aging/page.tsx` (new) — loading skeleton, "No outstanding payables" empty state
- `frontend/app/(tenant)/app/finance/layout.tsx` — added the tab bar (previously none existed)
- `frontend/components/shared/sidebar-nav-items.ts` — Expenses/AP Aging nav entries under the Finance group
- `frontend/__tests__/lib/finance-expense-journey.test.ts` (new) — 7 tests, real repository/hook round-trip through MSW

## Decisions Made

- **Schema built against the Java source, not plan prose.** `ExpenseDto.java`'s wire field is `rejectReason`; `ApAgingBucketDto.java` has no invoice-count field. Both corrected from what the plan's `<action>` text assumed, per the plan's own explicit instruction to read the DTOs first.
- **Non-paginated list schema**, per 10-10-A: `apiExpenseListSchema = z.array(apiExpenseSchema)`, no `PageMeta`.
- **`mocks/server.ts` is the real registration point** for MSW handlers, not `mocks/handlers.ts` as the plan's file list stated — `handlers.ts` only holds the auth/feature-flag fixtures; `purchasingHandlers`/`financeHandlers` are separately imported and spread into `setupServer(...)` in `server.ts`. Touched `server.ts` instead (Rule 3 — blocking issue: the new mocks were otherwise dead code, never intercepted).

## Deviations from Plan

- **[Rule 3 — Blocking] `mocks/server.ts` touched instead of `mocks/handlers.ts`.** The plan's file list named `frontend/mocks/handlers.ts` as the shared file this plan touches; the actual shared registration point (where `purchasingHandlers` was already being spread into `setupServer(...)`) is `mocks/server.ts`. Without this, `financeHandlers` would never be intercepted by MSW and the journey test would fail with `onUnhandledRequest: "error"`. `mocks/handlers.ts` itself was left untouched — no conflict with 10-12/10-13.
- **[Rule 1 — schema correction] `rejectReason` not `rejectionReason`, and `ApAgingBucketDto` has no invoice-count field.** Both caught by reading `ExpenseDto.java`/`ApAgingBucketDto.java` directly per the plan's own instruction; documented above and in the schema file's comments so a future reader doesn't "fix" this back to the wrong shape.

## Issues Encountered

- **Shared-environment git races during commit.** Multiple sibling plan-executor agents (10-08, 10-12) were committing to the same working tree concurrently. Two of this plan's three commits were caught staging sibling files (`frontend/__tests__/lib/purchasing-po-journey.test.ts`, `.planning/phases/10-purchasing-accounts-payable/10-08-SUMMARY.md`, `frontend/components/purchasing/MockGrnReceivePanel.tsx`, `frontend/mocks/purchasing.handlers.ts`) picked up between `git add` and `git commit` by a concurrent `git add -A`-style operation from another agent. Both were caught before pushing/finalizing, fixed via `git reset --soft HEAD~1` + re-add + `git commit -m "..." -- <exact paths>` (pathspec-scoped commit, which only commits the named paths regardless of what else is staged). Final commits (`b34e200`, `9e2202b`, `b0052bd`) contain only this plan's files, verified via `git show --stat`.
- **Transient tsc/build failures from environment contention, not code.** `npx tsc --noEmit` intermittently failed with `TS6053: File '.next/dev/types/...' not found` (a concurrent `next dev` process mid-rewriting `.next/`); `npx next build` intermittently failed with `ENOTEMPTY` on `.next/standalone/node_modules/...` (a concurrent build racing the same directory) and once hit the 2-minute tool timeout under load. All resolved on retry with clean output — not caused by this plan's code.
- **Real click-path could not be completed — backend dev stack was down for reasons unrelated to this plan.** At verification time: `gateway` (port 8080) health was `DOWN` — `.dev-logs/gateway.log` showed a RabbitMQ `ACCESS_REFUSED` authentication failure (RabbitMQ's container had been recently restarted per STATE.md's Issues Encountered from 10-10, and the long-running gateway process never reconnected with valid credentials). `finance-service` (port 8086) `/actuator/health` returned `500` — `.dev-logs/finance-service.log` showed `NoClassDefFoundError: org.hibernate.engine.jdbc.spi.SQLExceptionLogging` and `ClassNotFoundException: org.apache.hc.core5.util.TimeValue$1`, i.e. the long-running dev JVM process is running against a stale/partially-rebuilt fat jar whose classpath no longer matches its dependencies (unrelated to any file this plan touched — this plan is frontend-only). Restarting either shared, long-running process risked disrupting 10-08's concurrent real-OPA integration test run against the same finance-service. **What was actually verified instead:** `finance-expense-journey.test.ts` exercises the real `FinanceRepository` -> real Zod `.parse()` -> real adapter -> a real `axios` request intercepted by MSW at the HTTP layer (not a stubbed repository function) -- the same code path a browser session would run, minus the live backend and JWT. `npx tsc --noEmit`, `npx eslint`, and `npx next build` are all clean, and the build's route manifest confirms `/app/finance/expenses` and `/app/finance/ap-aging` are real, statically-generated routes. A genuine browser click-path against the live backend remains unverified in this session and should be the first thing checked once the shared dev stack (gateway/finance-service) is restarted with a clean rebuild.

## User Setup Required

- **Restart the shared dev backend stack before attempting a real click-path.** `gateway` needs valid RabbitMQ credentials after the RabbitMQ container restart (or a full `docker compose` cycle); `finance-service` needs a clean `mvn -pl services/finance-service clean package` + JVM restart to pick up its current dependency classpath (its running jar is stale, throwing `NoClassDefFoundError`/`ClassNotFoundException` on Hibernate/httpclient5 classes it should have). Neither issue was introduced by this plan.

## Next Phase Readiness

- FIN-05 is now fully wired end-to-end from a backend and frontend-code standpoint: `ExpenseController`/`ApArController` (10-05, 10-10) -> `FinanceRepository`/`use-finance.ts` (this plan) -> `/app/finance/expenses` and `/app/finance/ap-aging` pages (this plan). UAT tests 9 and 16 are executable once the dev stack is healthy.
- **10-18 (AR, wave 5) extension seam:** this plan deliberately kept `finance.schema.ts`/`finance.adapter.ts`/`finance.repository.ts`/`use-finance.ts` additive (new exports appended, nothing renamed or restructured) so 10-18 can extend the same four files with House Accounts + AR Aging schemas/hooks without touching expense/AP-aging code. The finance tab bar (`frontend/app/(tenant)/app/finance/layout.tsx`) is a plain array (`TABS`) — adding an "AR Aging" or "House Accounts" tab is a one-line addition, not a restructure. `mocks/finance.handlers.ts` is similarly additive — 10-18 can append new `http.*` handlers to the same exported array.
- No blockers for 10-18. The one thing it should verify first: the dev backend stack (gateway + finance-service) needs a restart/rebuild before any plan can do a real browser click-path — this was true before this plan started and remains true after.

---
*Phase: 10-purchasing-accounts-payable*
*Completed: 2026-07-13*
