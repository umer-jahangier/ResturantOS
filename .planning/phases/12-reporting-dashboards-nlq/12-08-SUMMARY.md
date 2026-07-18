---
phase: 12-reporting-dashboards-nlq
plan: 08
subsystem: frontend
tags: [nextjs, react, tanstack-query, zod, websocket, reporting, fbr, dashboard]

requires:
  - phase: 12-05
    provides: ReportController (7 named reports + FBR Tax Summary), reporting.report.view/reporting.report.fbr permissions
  - phase: 12-06
    provides: DashboardController REST snapshot + DashboardWebSocketHandler (pinned WS URL/DashboardTileDto contract), reporting.dashboard.view permission
provides:
  - Four-layer reporting data plumbing (reporting.schema.ts -> reporting.adapter.ts -> reporting.model.ts -> reporting.repository.ts -> use-reports.ts)
  - /app/reports (catalog browser), /app/reports/[code] (report runner), /app/reports/fbr (FBR Tax Summary) pages
  - /app/dashboard/realtime page + useDashboardSocket WS hook (REST-snapshot initial paint + live merge into the same TanStack cache key)
  - MSW handlers for every reporting endpoint (frontend/mocks/reporting.ts), registered in mocks/server.ts
affects: [12-09, 12-10]

tech-stack:
  added: []
  patterns:
    - "Report rows are genuinely dynamic (List<Map<String,Object>>) — modeled as a Zod object with two known nullable keys (cogs_paisa/gross_margin_paisa, real snake_case ClickHouse column aliases) plus .catchall(z.unknown()) for everything else, so honest-NULL enforcement is possible without inventing a fixed row shape the backend doesn't have."
    - "useDashboardSocket clones use-kds-socket.ts's effect-local-closure-state + exponential-backoff pattern verbatim, but writes each frame into queryClient.setQueryData under the SAME key useDashboardTiles reads (queryKeys.reporting.dashboardTiles(branchId)) — WS push and REST snapshot are one cache entry, not two competing states."

key-files:
  created:
    - frontend/lib/api-client/schemas/reporting.schema.ts
    - frontend/lib/adapters/reporting.adapter.ts
    - frontend/lib/models/reporting.model.ts
    - frontend/lib/repositories/reporting.repository.ts
    - frontend/lib/hooks/reporting/use-reports.ts
    - frontend/lib/hooks/reporting/use-dashboard-socket.ts
    - frontend/mocks/reporting.ts
    - frontend/app/(tenant)/app/reports/page.tsx
    - frontend/app/(tenant)/app/reports/[code]/page.tsx
    - frontend/app/(tenant)/app/reports/fbr/page.tsx
    - frontend/app/(tenant)/app/dashboard/realtime/page.tsx
    - frontend/components/reporting/ReportTable.tsx
    - frontend/components/reporting/FbrTaxSummaryCard.tsx
    - frontend/components/reporting/DashboardTileGrid.tsx
    - frontend/__tests__/reporting/reporting-journey.test.ts
  modified:
    - frontend/lib/hooks/query-keys.ts
    - frontend/mocks/server.ts
    - frontend/components/shared/sidebar-nav-items.ts

key-decisions:
  - "sidebar-nav-items.ts lives at frontend/components/shared/sidebar-nav-items.ts, not frontend/lib/navigation/sidebar-nav-items.ts as the plan frontmatter's files_modified list assumed — followed the real file location (codebase reality over plan prose, per repo precedent 10-12-A/10-15-A)."
  - "ReportCatalog's real ClickHouse column aliases (cogs_paisa, gross_margin_paisa) are snake_case, not camelCase as some plan prose implied — the Zod row schema and MSW fixtures use the real snake_case names, read directly from ReportCatalog.java's SQL, not guessed."
  - "New Reports / Realtime Dashboard nav items deliberately carry NO `feature` key (12-01 left /api/v1/reporting/ out of RouteFeatureMap on purpose — basic reporting is core, not FEATURE_REPORTING_ADVANCED-gated) — gated on reporting.report.view / reporting.dashboard.view permissions only, added to both the flat tenantNavItems list and the grouped navGroups Reporting section."
  - "useDashboardSocket keeps a local tiles useState in addition to writing the shared TanStack cache key, so the hook's own return value is self-contained and reactive without depending on another component also being subscribed via useQuery."

patterns-established:
  - "A WS hook that shares its target's TanStack Query key with a companion REST-snapshot hook (rather than returning its own competing state) is the reusable pattern for any future realtime-plus-initial-paint feature."

duration: ~35min
completed: 2026-07-18
---

# Phase 12 Plan 08: Reporting Frontend Summary

**Named-reports browser + `[code]` runner + FBR Tax Summary page + a realtime KPI dashboard driven by 12-06's WebSocket, all behind the enforced four-layer API boundary — cogs/margin render as an honest em-dash and a negative FBR net payable is labelled a refundable credit, never a rendering bug.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3/3 complete
- **Files created:** 15, modified: 3

## Accomplishments

- **Four-layer data plumbing** (`reporting.schema.ts` → `reporting.adapter.ts` → `reporting.model.ts`
  → `reporting.repository.ts` → `use-reports.ts`) built directly from the real Java DTOs
  (`ReportDefinition`, `ReportResultDto`, `FbrTaxSummaryDto`, `DashboardTileDto`) rather than plan
  prose — money fields are `z.number().int()` (never `.nonnegative()` on `netPayablePaisa`, which
  may legitimately be negative), and `cogs_paisa`/`gross_margin_paisa` (the real snake_case
  ClickHouse column aliases from `ReportCatalog.salesByItem()`) are `z.number().nullable()`, never
  `.default(0)`.
- **`/app/reports`** — catalog grouped by category, linking to `/app/reports/{code}`.
  **`/app/reports/[code]`** — native `<input type="date">` range picker (no Select/date-picker
  library, per the established 10-15-A convention) + `ReportTable`, which renders dynamic columns
  generically, money via `MoneyDisplay`, and any `null` cell (specifically
  `cogs_paisa`/`gross_margin_paisa`) as an em-dash with a `dataNotes`-driven info banner — never a
  misleading 0.
- **`/app/reports/fbr`** — `FbrTaxSummaryCard` shows the branch header (name/NTN/STRN, degrading to
  a muted note if unavailable), taxable sales + output tax, taxable purchases + input tax, and net
  payable as the headline. A negative `netPayablePaisa` is labelled "Refundable input-tax credit"
  and rendered as a positive amount with an explanatory note — never `-PKR 1,234.00` under "Net
  Payable".
- **`/app/dashboard/realtime`** — `useDashboardTiles` (REST snapshot) paints instantly on mount;
  `useDashboardSocket` (cloned from `use-kds-socket.ts`'s proven JWT-in-query-param +
  exponential-backoff pattern, KDS beep dropped) then keeps it live, merging every pushed frame into
  the SAME TanStack cache key the snapshot hook reads. `DashboardTileGrid` is a responsive 3/1-col
  grid with a "updated Ns ago" timestamp per tile and a connection indicator that is a
  green/amber dot **plus** a text label (not colour alone).
- **MSW handlers** (`mocks/reporting.ts`, registered in `mocks/server.ts`) back all four endpoints
  with real hex-UUID fixtures, a default negative-`netPayablePaisa` FBR fixture, and a
  `sales-by-item` fixture row with `cogs_paisa`/`gross_margin_paisa` NULL so both the journey test
  and manual dev exercise the honest-degradation path by default.
- **`sidebar-nav-items.ts`** — added Reports + Realtime Dashboard entries (both the flat
  `tenantNavItems` list and the grouped `navGroups` Reporting section) with deliberately NO
  `feature` key (12-01 left `/api/v1/reporting/` out of `RouteFeatureMap` on purpose — basic
  reporting is core, not `FEATURE_REPORTING_ADVANCED`-gated), permission-gated on
  `reporting.report.view` / `reporting.dashboard.view` instead.

## Verification

- `npx tsc --noEmit` (frontend root) → clean, zero errors, zero `any`.
- `npx eslint .` → zero errors/warnings in every file this plan created or modified. (8 pre-existing
  errors elsewhere — `components/kds/station-picker.tsx`, `components/providers/session-provider.tsx`,
  `lib/hooks/kds/use-kds-clock.tsx` — predate this plan, traced via `git log` to `6fb928a`
  (07.3-10), untouched by 12-08.)
- `npx vitest run` → **260/260 tests pass** (full suite), including the new
  `__tests__/reporting/reporting-journey.test.ts` (5/5): `listReports_roundTrips`,
  `runReport_parsesNullCogs` (asserts `cogs_paisa`/`gross_margin_paisa` are `null`, never `0`),
  `fbrSummary_roundTrips` (negative `netPayablePaisa` survives unclamped) plus a missing-NTN
  degradation case, `dashboardTiles_roundTrips` (exactly one of `valuePaisa`/`valueNumber`
  populated per tile; no invented `open-tills` tile).
- `npm run build` (`next build`) → compiles successfully; `/app/reports`, `/app/reports/[code]`,
  `/app/reports/fbr`, `/app/dashboard/realtime` all appear in the route manifest.

**No live gateway/WebSocket click-path was performed** — there was no running backend stack in this
session. The evidence above (MSW round-trip + tsc/lint/vitest/build all green) is what is claimed;
per 10-13-H's established precedent, a click-path that was not actually exercised is never claimed
as having been performed.

## Task Commits

1. **Task 1: Four-layer data plumbing (schema/adapter/model/repository/hook + MSW)** — `c956b1c` (feat)
2. **Task 2: Reports browser + [code] runner + FBR page + nav items** — `6bf3d2e` (feat)
3. **Task 3: Realtime dashboard WS hook + tile grid + journey test** — `c07c404` (feat)

## Files Created/Modified

- `frontend/lib/api-client/schemas/reporting.schema.ts` — Zod schemas mirroring the real Java DTOs
- `frontend/lib/adapters/reporting.adapter.ts` / `frontend/lib/models/reporting.model.ts` — Layer-2
- `frontend/lib/repositories/reporting.repository.ts` — `.parse()`-before-adapt repository
- `frontend/lib/hooks/reporting/use-reports.ts` / `use-dashboard-socket.ts` — Layer-3 hooks
- `frontend/lib/hooks/query-keys.ts` — added `reporting.*` branch-scoped keys
- `frontend/mocks/reporting.ts` + `frontend/mocks/server.ts` — MSW fixtures + registration
- `frontend/app/(tenant)/app/reports/{page.tsx,[code]/page.tsx,fbr/page.tsx}` — the three pages
- `frontend/app/(tenant)/app/dashboard/realtime/page.tsx` — realtime dashboard
- `frontend/components/reporting/{ReportTable,FbrTaxSummaryCard,DashboardTileGrid}.tsx`
- `frontend/components/shared/sidebar-nav-items.ts` — Reports + Realtime Dashboard nav entries
- `frontend/__tests__/reporting/reporting-journey.test.ts` — 5 MSW-round-trip tests

## Decisions Made

See `key-decisions` in frontmatter — summarized: followed the real `sidebar-nav-items.ts` file
location over plan frontmatter's assumed path; used the real snake_case ClickHouse column aliases
(`cogs_paisa`/`gross_margin_paisa`) read directly from `ReportCatalog.java`; left the new nav items
ungated on any feature flag per 12-01's deliberate `RouteFeatureMap` exclusion.

## Deviations from Plan

None — plan executed exactly as written. All "traps" the plan warned about (money serialization,
nullable COGS, dynamic row shape, negative net payable, missing NTN/STRN, dropped open-tills tile,
no Select/date-picker library) were read from the real backend source and handled correctly on the
first pass; no Rule 1/2/3 auto-fixes were needed.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The four-layer reporting plumbing, `mocks/server.ts`, and `sidebar-nav-items.ts` are left in a
  clean, append-friendly state for 12-09 (NLQ frontend), which shares both files but was not touched
  by this plan (no NLQ page built here, per the coordination note).
- 12-10 (E2E verification) can rely on the MSW-backed test evidence recorded above; a real
  gateway/WebSocket click-path (order-close → tile update within 5s) remains to be exercised against
  a live stack, as no stack was running in this session.

---
*Phase: 12-reporting-dashboards-nlq*
*Completed: 2026-07-18*
