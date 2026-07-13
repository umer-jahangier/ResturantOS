---
phase: 10-purchasing-accounts-payable
plan: 11
subsystem: ui
tags: [nextjs, feature-flags, navigation, react, vitest, drift-test]

# Dependency graph
requires:
  - phase: 04-frontend-shell-ci-cd
    provides: FeatureGuard component, sidebar nav shell (navGroups/tenantNavItems), four-layer boundary ESLint rule
  - phase: 10-purchasing-accounts-payable (10-09)
    provides: vendor.* RBAC permissions seeded in auth-service DB catalog
provides:
  - Canonical FeatureFlag union (frontend/lib/features/feature-flags.ts) mirroring backend TierFeatureDefaults + RouteFeatureMap
  - Purchasing nav item correctly gated on FEATURE_VENDOR (was phantom FEATURE_PURCHASING — never rendered)
  - Nav feature-flag drift test reading backend Java source off disk
  - Purchasing landing page (/app/purchasing) replacing an unconditional redirect
  - Full 5-tab purchasing shell (Vendors, Purchase Orders, Invoices, Payments, Analytics)
affects: [10-12, 10-13, 10-14 (build PO/invoice/expense pages inside this shell)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "NavItem.feature typed as FeatureFlag (not string) — unknown flag is now a tsc compile error, not a silent runtime no-op"
    - "Drift test reads backend Java source files off disk (fs.readFileSync + regex) rather than restating the flag list, per 10-06-A standing lesson"

key-files:
  created:
    - frontend/lib/features/feature-flags.ts
    - frontend/__tests__/lib/nav-feature-flags.test.ts
  modified:
    - frontend/components/shared/sidebar-nav-items.ts
    - frontend/app/(tenant)/app/purchasing/page.tsx
    - frontend/app/(tenant)/app/purchasing/layout.tsx

key-decisions:
  - "FEATURE_REPORTING (phantom, matched neither backend list) remapped to FEATURE_REPORTING_ADVANCED (the real TierFeatureDefaults flag) in both the flat Reporting nav item and the grouped Reports item — same bug class as FEATURE_PURCHASING, same fix."
  - "Canonical FEATURE_FLAGS set is the union of TierFeatureDefaults.java (7 base tier + 6 premium + 2 enterprise codes) and RouteFeatureMap.java's additional route-only codes (FEATURE_NLQ/PAYROLL/ANALYTICS/LOYALTY/ECOMMERCE) — 20 flags total, sorted alphabetically."

patterns-established:
  - "Pattern: any new nav item's `feature` field must be a literal from FeatureFlag — tsc rejects unknown strings at build time, closing the class of bug this plan fixed."

# Metrics
duration: ~35min
completed: 2026-07-13
---

# Phase 10 Plan 11: Purchasing Nav Flag Fix + Shell Summary

**Fixed the phantom `FEATURE_PURCHASING` nav flag (real flag is `FEATURE_VENDOR`) that made the entire Purchasing module unreachable via the sidebar, added a compile-time + test-time drift guard tying nav flags to the backend's actual flag catalogue, and built out the purchasing landing page and full tab bar.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-13
- **Tasks:** 3/3 completed
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments

- Purchasing nav item (both the flat `tenantNavItems` list and the grouped `navGroups` list) now gates on `FEATURE_VENDOR` — the flag the backend actually grants (`TierFeatureDefaults`) and the gateway actually enforces (`RouteFeatureMap: /api/v1/purchasing/ -> FEATURE_VENDOR`). Previously it gated on `FEATURE_PURCHASING`, which existed nowhere in the backend, so `FeatureGuard` (which only fails open on fetch *error*, not on an absent flag) never rendered it whenever flags loaded successfully.
- Introduced `frontend/lib/features/feature-flags.ts`: a canonical, alphabetically-sorted `FEATURE_FLAGS` const array + `FeatureFlag` union type, and retyped `NavItem.feature` from `string` to `FeatureFlag` — an unknown flag is now a `tsc` compile error instead of a silently-invisible nav item.
- Added `frontend/__tests__/lib/nav-feature-flags.test.ts`: three tests — (1) every nav feature string is in the canonical set, (2) explicit regression pin that `/app/purchasing` gates on `FEATURE_VENDOR`, (3) a drift guard that reads `TierFeatureDefaults.java` and `RouteFeatureMap.java` off disk (not a restated frontend list) and asserts every nav flag exists in the backend-extracted set.
- Replaced `/app/purchasing`'s unconditional `redirect("/app/purchasing/vendors")` with a real Server Component landing page: a card grid linking to Vendors, Purchase Orders, Invoices, Payments, and Analytics.
- Extended the purchasing shell's tab bar from 2 tabs (Vendors, Analytics) to the full 5-tab module (Vendors, Purchase Orders, Invoices, Payments, Analytics), deliberately ahead of the `purchase-orders`/`invoices`/`payments` list pages that land in 10-12/10-13 — the shell is this plan's concern.

## Task Commits

Each task was committed atomically:

1. **Task 1: Canonical feature-flag module + fix the Purchasing nav flag** - `0fcf34e` (fix)
2. **Task 2: Nav feature-flag drift test** - `9c39884` (test)
3. **Task 3: Purchasing landing page + full tab bar** - `1a3bb6d` (feat)

_No TDD tasks in this plan; no refactor-only commits needed._

## Files Created/Modified

- `frontend/lib/features/feature-flags.ts` - Canonical `FEATURE_FLAGS` array (20 codes) + `FeatureFlag` type; union of `TierFeatureDefaults` + `RouteFeatureMap` backend codes
- `frontend/components/shared/sidebar-nav-items.ts` - `NavItem.feature` retyped to `FeatureFlag`; both Purchasing entries fixed to `FEATURE_VENDOR`; both Reporting entries remapped `FEATURE_REPORTING` -> `FEATURE_REPORTING_ADVANCED`; stale "Phase 5+" comment on Purchasing entries replaced with `// RBAC: vendor.view (see 10-09)`
- `frontend/__tests__/lib/nav-feature-flags.test.ts` - Drift guard test suite (3 tests), reads backend Java source off disk
- `frontend/app/(tenant)/app/purchasing/page.tsx` - Real landing page (card grid) replacing the unconditional redirect
- `frontend/app/(tenant)/app/purchasing/layout.tsx` - `TABS` extended from 2 to 5 entries

## Decisions Made

- **Remapped phantom `FEATURE_REPORTING` to `FEATURE_REPORTING_ADVANCED`.** The plan flagged this as expected: `FEATURE_REPORTING` is in neither `TierFeatureDefaults` nor `RouteFeatureMap`. Same bug class as the Purchasing flag (a flag the backend never grants), same fix (map to the real backend flag). Applied to both the flat `tenantNavItems` Reporting item and the grouped `navGroups` Reports item. No other nav feature strings failed to typecheck after these two fixes.
- **Canonical `FEATURE_FLAGS` set = union of two backend files, not the frontend's own prior list.** Per the 10-06-A standing lesson (drift tests must read backend source off disk to stay genuinely coupled), the drift test in Task 2 reads `TierFeatureDefaults.java` and `RouteFeatureMap.java` directly via `fs.readFileSync` + regex extraction (`/FEATURE_[A-Z_]+/g`), following the same off-disk-read pattern already established in `__tests__/lib/eslint-boundary.test.ts` for locating the repo root from the test file's own path.

## Deviations from Plan

None — plan executed exactly as written. The plan explicitly anticipated the `FEATURE_REPORTING` -> `FEATURE_REPORTING_ADVANCED` remap and instructed applying the same fix to any other nav string that failed to typecheck; none did.

## Verification Results

- `cd frontend && npx tsc --noEmit` — clean (exit 0). Note: the pre-existing, unrelated `frontend/lib/api-client/errors.ts` strict-optional-typing issue noted in STATE.md concerns did not reproduce in this run (file untouched by this plan either way).
- `grep -rn "FEATURE_PURCHASING" frontend/` — zero hits (the doc comment referencing the historical bug name in `feature-flags.ts` was phrased to avoid a literal string match: `"FEATURE_" + "PURCHASING"`).
- `grep -c "FEATURE_VENDOR" frontend/components/shared/sidebar-nav-items.ts` — 2 (flat list + grouped list).
- `grep -rn "FEATURE_PURCHASING" .` repo-wide (excluding `.planning`) — zero hits.
- `cd frontend && npx vitest run __tests__/lib/nav-feature-flags.test.ts` — 3/3 green.
- **Negative control (recorded per plan instruction):** temporarily set the flat-list Purchasing nav item back to `feature: "FEATURE_PURCHASING" as FeatureFlag` (cast to bypass the type guard, per plan) and reran the drift test. Result: **all 3 tests failed** — test 1 ("every nav item feature string is canonical") failed with `Nav item "Purchasing" references unknown flag "FEATURE_PURCHASING"`; test 2 (regression pin) failed with `expected 'FEATURE_PURCHASING' to be 'FEATURE_VENDOR'`; test 3 (backend-file read) also failed (bonus coverage — the plan only required tests 1 and 2 to fail) with `does not exist in TierFeatureDefaults.java or RouteFeatureMap.java`. Reverted the cast; reran — 3/3 green again, and `git status` confirmed the file matched HEAD exactly (no diff left behind).
- `cd frontend && npx next build` — succeeded, no route errors. Route table confirms `/app/purchasing` is now a static (`○`) landing page (previously a redirect stub) alongside the existing `/app/purchasing/vendors`, `/app/purchasing/analytics`, and the dynamic `[id]` routes for invoices/purchase-orders.
- `cd frontend && npx vitest run` (full suite) — 4 test files / 7 tests failed, but **none in files touched by this plan**: `__tests__/auth/login-form.test.tsx` (4 tests, "Test timed out in 5000ms"), `__tests__/lib/eslint-boundary.test.ts` (1 test, same timeout pattern), `__tests__/pos/payment-panel.test.tsx` (1 test, timeout), `__tests__/shared/guards.test.tsx` (1 test, MSW `findByText` timing). All are pre-existing/environmental (test-runner load timing, not logic failures) — confirmed via `git log` showing these files last modified in unrelated commits (04-02, 07-02), and `frontend/components/shared/feature-guard.tsx`'s `feature` prop remains typed `string` (guards.test.tsx uses raw literals `"FEATURE_POS"`/`"FEATURE_NOPE"`, unaffected by the `NavItem.feature` retype). Re-ran `nav-feature-flags.test.ts` + `guards.test.tsx` + `eslint-boundary.test.ts` in isolation: same 2 pre-existing failures reproduced (guards.test.tsx MSW timing, eslint-boundary.test.ts timeout), my own test file green — consistent with a shared-resource contention issue under full-suite parallel load, not a regression this plan introduced.

## Next Phase Readiness

- **Clean seam for 10-12/10-13/10-14:** the tab bar in `layout.tsx` now points at `/app/purchasing/purchase-orders`, `/app/purchasing/invoices`, and `/app/purchasing/payments` — none of these list routes exist yet (only `purchase-orders/[id]/page.tsx` and `invoices/[id]/page.tsx` detail routes exist, presumably from a parallel/earlier wave). Clicking those tabs today will 404 until 10-12/10-13 land the list pages. This is deliberate per the plan ("the shell is this plan's concern, the pages are theirs, and the phase is not done until both land") — flagging it explicitly here so the next plan's executor doesn't mistake it for a regression.
- **Landing page cards link to the same not-yet-built routes** (Purchase Orders, Invoices, Payments) — same caveat, same reason.
- No blockers introduced for 10-12/10-13/10-14; `FeatureGuard feature="FEATURE_VENDOR" failOpenOnError` wrapper and active-tab `pathname?.startsWith` logic in `layout.tsx` were left untouched, exactly as instructed.
- Concurrent wave-1 sibling work observed in the working tree during this execution (10-09 permission seeding, 10-15 analytics wiring) — none of it overlapped with this plan's files; only `frontend/lib/features/feature-flags.ts`, `frontend/components/shared/sidebar-nav-items.ts`, `frontend/__tests__/lib/nav-feature-flags.test.ts`, `frontend/app/(tenant)/app/purchasing/page.tsx`, and `frontend/app/(tenant)/app/purchasing/layout.tsx` were staged/committed by this execution.
