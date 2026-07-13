---
phase: 10-purchasing-accounts-payable
plan: 15
subsystem: ui
tags: [react, tanstack-query, zod, msw, purchasing, analytics]

# Dependency graph
requires:
  - phase: 10-12
    provides: "useSpendAnalytics(branchId, from, to) / useVendorScorecard(vendorId, branchId) hooks already keyed on their params"
  - phase: 10-13
    provides: "purchasing.repository.ts / purchasing.schema.ts contract for /analytics/spend and /analytics/scorecard"
provides:
  - "Period picker (This month / Last month / Last 90 days / This quarter / Custom) driving the spend analytics tables"
  - "Vendor selector driving the vendor scorecard (no longer pinned to vendors[0])"
  - "Comparison-window header (compareFrom/compareTo) shown above the spend tables"
  - "Render-path test proving selected period/vendor values reach the outbound request and update the DOM"
affects: [10-UAT, purchasing-frontend]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Page-level 'store info from previous render' state sync (setState during render, not in useEffect) used to keep previous query data visible across a query-key change, without needing TanStack's placeholderData option on a hook file out of scope to edit"

key-files:
  created:
    - frontend/components/purchasing/PeriodPicker.tsx
    - frontend/__tests__/lib/purchasing-analytics-controls.test.tsx
  modified:
    - frontend/app/(tenant)/app/purchasing/analytics/page.tsx
    - frontend/components/purchasing/VendorScorecardCard.tsx

key-decisions:
  - "No shadcn Select/date primitives exist in this codebase (no @radix-ui/react-select installed) despite the plan's wording; built PeriodPicker and the vendor selector on native <select>/<input type=date> styled to match the existing Input component instead of adding a new dependency."
  - "use-purchasing.ts (owned by 10-12/10-13) has no placeholderData option to opt into keepPreviousData; implemented the 'keep previous data visible while refetching' requirement at the page level via a small useKeepPreviousData hook using React's render-time state-sync pattern (not useEffect, per project ESLint rule react-hooks/set-state-in-effect)."
  - "Backend/schema field names are compareFrom/compareTo, not resolvedCompareFrom/resolvedCompareTo as the plan text said; used the actual schema field names."
  - "purchasing-analytics-controls.test.ts was renamed to .test.tsx because it needed JSX to mount the real page (vitest's include glob already covers both extensions, so no config change needed)."

patterns-established:
  - "useKeepPreviousData<T>(latest): keeps rendering the last successful query result across a query-key change (e.g. period switch) by calling setState conditionally during render — avoids editing a hook file owned by another plan and avoids useEffect."

# Metrics
duration: 35min
completed: 2026-07-13
---

# Phase 10 Plan 15: Purchasing Analytics Period + Vendor Controls Summary

**Added a period picker (5 presets incl. custom) and a vendor selector to `/app/purchasing/analytics`, wired into the pre-existing `useSpendAnalytics`/`useVendorScorecard` hooks with no data-layer changes, closing UAT gaps 10/14/15.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-13
- **Completed:** 2026-07-13
- **Tasks:** 2 (plan) + 1 follow-up test hardening
- **Files modified:** 4 (2 created, 2 modified; 1 test renamed .ts→.tsx)

## Accomplishments
- The spend-by-vendor and spend-by-category tables now refetch for any user-chosen period (This month / Last month / Last 90 days / This quarter / Custom from-to), and the page shows the resolved `compareFrom`–`compareTo` window so the delta column is interpretable.
- The vendor scorecard is now per-vendor: a `Select` fed by `useVendors()` drives `useVendorScorecard(vendorId, branchId)`, defaulting to the first vendor (so the page isn't empty on load) but never overriding an explicit user pick. All three PUR-05 metrics (on-time delivery, fill rate, price variance) stay visible together per UAT test 15.
- Confirmed `SpendAnalyticsTable` already rendered `—` for a null `deltaPct` (10-03-A) — no fix needed there.
- Added MSW request-param assertions (repository level) AND a full page-mount render test (real render path, per standing lesson 10-06-A) proving the selected period/vendor actually reach the outbound query params and change what's on screen — not just that the controls render.

## Task Commits

Each task was committed atomically:

1. **Task 1: PeriodPicker + wire the spend tables to it** - `e55d880` (feat)
2. **Task 2: Vendor selector on the scorecard + controls test** - `81a4d44` (feat)
3. **Follow-up: real-render-path test hardening** - `0cc12df` (test)

_No separate plan-metadata commit was requested by the orchestrator for this run; see this SUMMARY + STATE.md update as the closing artifact._

## Files Created/Modified
- `frontend/components/purchasing/PeriodPicker.tsx` - controlled period selector (5 presets), exports `thisMonthRange()` for the page's initial state
- `frontend/app/(tenant)/app/purchasing/analytics/page.tsx` - page-level period/vendor state, wires both into the existing hooks, shows the comparison window, keeps previous data visible during refetch
- `frontend/components/purchasing/VendorScorecardCard.tsx` - takes `vendorId`/`scorecard`/`isLoading` props instead of reaching into `vendors[0]`; explicit no-vendor / loading / no-data states
- `frontend/__tests__/lib/purchasing-analytics-controls.test.tsx` - MSW outbound-param assertions (period/vendor/null-deltaPct) plus a real page-render test exercising both controls end to end

## Decisions Made
- No shadcn `Select` primitive exists in this repo (no `@radix-ui/react-select` dependency); built both selectors as styled native `<select>`/`<input type="date">` elements matching the existing `Input` component's Tailwind classes, rather than adding a new library.
- Implemented "keep previous data visible while refetching" at the page level (`useKeepPreviousData`, a render-time state-sync helper) instead of editing `use-purchasing.ts` to add `placeholderData: keepPreviousData` — that file is owned by 10-12/10-13 and out of scope per the plan's explicit fence.
- Used the schema's actual field names `compareFrom`/`compareTo` (the plan text referenced `resolvedCompareFrom`/`resolvedCompareTo`, which do not exist in `apiSpendAnalyticsSchema`).
- Renamed the controls test file from `.test.ts` to `.test.tsx` since it needed to mount JSX for the real-render-path check; vitest's `include` glob already matches both extensions so no config change was needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Renamed test file .ts → .tsx to allow JSX**
- **Found during:** Task 2 follow-up (adding the real-render-path test)
- **Issue:** The plan named the file `purchasing-analytics-controls.test.ts`, but esbuild's `.ts` loader cannot parse JSX, and mounting the real page (required by standing lesson 10-06-A) needs JSX.
- **Fix:** `git mv` to `.tsx`; no other config changes needed.
- **Files modified:** `frontend/__tests__/lib/purchasing-analytics-controls.test.tsx`
- **Verification:** `npx vitest run` green, `npx tsc --noEmit` clean.
- **Committed in:** `0cc12df`

**2. [Rule 3 - Blocking] Built selectors on native elements instead of a nonexistent shadcn Select**
- **Found during:** Task 1
- **Issue:** Plan said "use the existing shadcn Select ... primitives"; no such component or `@radix-ui/react-select` dependency exists in this codebase.
- **Fix:** Styled native `<select>`/`<input type="date">` to match the existing `Input` component's visual language; zero new dependencies added.
- **Files modified:** `frontend/components/purchasing/PeriodPicker.tsx`, `frontend/app/(tenant)/app/purchasing/analytics/page.tsx`
- **Verification:** `npx tsc --noEmit`, `npx eslint .`, `npx next build` all clean; real-render-path test interacts with these controls via `userEvent.selectOptions` successfully.
- **Committed in:** `e55d880`, `81a4d44`

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking, no architectural changes)
**Impact on plan:** Both deviations were mechanical adaptations to what actually exists in the codebase vs. what the plan assumed; no scope creep, no data-layer changes, no files outside the plan's declared `<files>` lists were touched except the necessary test-file extension rename.

## Issues Encountered
- Full `npx vitest run` across the whole frontend suite has 4 pre-existing, unrelated failing/flaky test files (`__tests__/pos/payment-panel.test.tsx`, `__tests__/shared/guards.test.tsx`, `__tests__/lib/eslint-boundary.test.ts`, and one auth test) — timeouts/flakiness unrelated to purchasing and to files this plan touched. Re-running them in isolation showed intermittent pass/fail (environment load, not a regression introduced here). Left untouched — out of this plan's scope/ownership.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- UAT tests 10, 14 and 15 should now re-verify as pass: the analytics page's period and vendor are both real, page-level, user-driven controls that reach the existing backend query params, with a render-path test as evidence.
- No blockers for downstream purchasing plans; `purchasing.repository.ts`, `use-purchasing.ts`, `purchasing.schema.ts`, and `purchasing.handlers.ts` were not modified, so 10-12/10-13 (if still pending) remain unaffected by this plan.
- A parallel sibling plan (10-11) was touching `components/shared/sidebar-nav-items.ts` and the purchasing shell/layout/tabs during this execution; those files were not touched here.

---
*Phase: 10-purchasing-accounts-payable*
*Completed: 2026-07-13*
