---
phase: 12-reporting-dashboards-nlq
plan: 16
subsystem: frontend
tags: [websocket, gateway, dashboard, kds, realtime, vitest]

# Dependency graph
requires:
  - phase: 12-12
    provides: gateway-side ?token= JWT WS auth on /api/v1/reporting/dashboard/** and /api/v1/kitchen/**
provides:
  - Single wsUrl()/resolveWsBaseUrl() resolver as the one source of truth for all browser WS URLs
  - All three browser WS hooks (dashboard, KDS, POS orders) routed through it, targeting the real gateway (:8080) instead of the Next dev server (:3000)
  - Unit tests + a static guard that fails if any hook reintroduces an unset NEXT_PUBLIC_*_WS_URL fallback
  - Real-browser verification that Test 3 (RPT-02) and Test 4 now pass end-to-end
affects: [12-UAT, 12-VERIFICATION, reporting-dashboard, kitchen-display]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Browser WS base URL resolution centralized in frontend/lib/hooks/ws-base-url.ts (resolveWsBaseUrl/wsUrl), consuming NEXT_PUBLIC_WS_BASE_URL as a full ws:// base without re-prepending a scheme, with a same-origin window.location fallback for production behind Nginx."
    - "vitest.config.ts test.env sets NEXT_PUBLIC_WS_BASE_URL so module-level env captures in statically-imported hooks see the gateway base during tests."

key-files:
  created:
    - frontend/lib/hooks/ws-base-url.ts
    - frontend/__tests__/lib/ws-base-url.test.ts
    - frontend/__tests__/reporting/use-dashboard-socket.test.tsx
    - frontend/__tests__/kds/use-kds-socket.test.tsx
  modified:
    - frontend/lib/hooks/reporting/use-dashboard-socket.ts
    - frontend/lib/hooks/kds/use-kds-socket.ts
    - frontend/lib/hooks/pos/use-pos-orders-socket.ts
    - frontend/vitest.config.ts
    - services/finance-service/src/main/resources/db/migration/V7__posted_source_events.sql (renamed from V5, out-of-plan Flyway collision fix)

key-decisions:
  - "wsUrl() reads process.env.NEXT_PUBLIC_WS_BASE_URL directly (not env.ts's defaulted object) so an unset var yields the same-origin fallback in production, never a silently-wrong localhost:3000 target."
  - "Static guard test reads the three hook source files off disk and regex-checks for NEXT_PUBLIC_\\w*_WS_URL / bare window.location.host usage, so the historical regression class cannot silently reappear."

patterns-established:
  - "Any future browser WS hook must build its URL via wsUrl() from ws-base-url.ts, never its own NEXT_PUBLIC_*_WS_URL env var."

# Metrics
duration: ~20min (Tasks 1-2) + real-stack verification session
completed: 2026-07-21
---

# Phase 12 Plan 16: Browser WS hooks routed through the real gateway Summary

**All three browser WebSocket hooks (dashboard, KDS, POS orders) now resolve their URL from `NEXT_PUBLIC_WS_BASE_URL` via a shared `wsUrl()` resolver, closing the Test 3 (RPT-02) and Test 4 UAT gaps where sockets silently targeted the non-proxying Next dev server (`localhost:3000`) instead of the real gateway (`:8080`).**

## Performance

- **Duration:** Tasks 1-2 landed in a single ~20min pass (commits `81af698`, `a14846a`); Task 3's real-browser checkpoint was verified in a separate orchestrator session.
- **Tasks:** 3/3 complete (2 auto + 1 checkpoint:human-verify, approved)
- **Files modified:** 8 frontend files (4 created, 4 modified) + 1 unrelated out-of-plan Flyway rename

## Accomplishments

- Created `frontend/lib/hooks/ws-base-url.ts` — the single source of truth for the browser WS base URL, consuming the full `ws://`/`wss://` base from `NEXT_PUBLIC_WS_BASE_URL` without re-prepending a scheme, with a same-origin `window.location` fallback for production behind Nginx.
- Routed all three hooks (`use-dashboard-socket.ts`, `use-kds-socket.ts`, `use-pos-orders-socket.ts`) through `wsUrl()`, deleting the broken `protocol`/`host = process.env.NEXT_PUBLIC_*_WS_URL ?? window.location.host` blocks that referenced env vars set nowhere in the repo.
- Added unit tests proving the resolver targets `ws://localhost:8080` (not `localhost:3000`) and correctly falls back to same-origin in production, plus a static guard that reads the three hook source files off disk and fails if any of them ever reintroduces an unset `NEXT_PUBLIC_*_WS_URL` reference or a bare `window.location.host` socket URL.
- Real-browser proof (Task 3, verified by the orchestrator against the live dev stack): both the dashboard and KDS sockets now handshake `101 Switching Protocols` against the real gateway at `:8080`, the dashboard status indicator reads "Live" (previously stuck "Reconnecting…"), and a live POS order closed through the real gateway pushed updated KPI tiles (Revenue Rs 110.00 / Orders 1 / Tax Rs 10.00 / AOV Rs 110.00) to the dashboard with NO page refresh, landing well inside the 5s budget.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add a shared wsUrl() resolver and route all three WS hooks through it** - `81af698` (fix)
2. **Task 2: Unit tests + static guard so the localhost:3000 regression can never return** - `a14846a` (test)
3. **Task 3: Real-browser proof — dashboard + KDS sockets reach the gateway and push within 5s** - checkpoint:human-verify, **APPROVED** (no additional commit; verification-only)

**Plan metadata:** (this commit) `docs(12-16): complete browser WS-target gap-closure plan`

## Files Created/Modified

- `frontend/lib/hooks/ws-base-url.ts` - `resolveWsBaseUrl()`/`wsUrl()` — the single source of truth for browser WS base URLs
- `frontend/lib/hooks/reporting/use-dashboard-socket.ts` - dashboard socket URL now built via `wsUrl()`
- `frontend/lib/hooks/kds/use-kds-socket.ts` - KDS socket URL now built via `wsUrl()`
- `frontend/lib/hooks/pos/use-pos-orders-socket.ts` - POS orders socket URL now built via `wsUrl()`
- `frontend/vitest.config.ts` - `test.env.NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8080` so module-level captures see the gateway base in tests
- `frontend/__tests__/lib/ws-base-url.test.ts` - resolver unit tests + the static regression guard
- `frontend/__tests__/reporting/use-dashboard-socket.test.tsx` - dashboard socket URL/onmessage tests
- `frontend/__tests__/kds/use-kds-socket.test.tsx` - KDS socket URL tests
- `services/finance-service/src/main/resources/db/migration/V7__posted_source_events.sql` (renamed from `V5__posted_source_events.sql`) - out-of-plan Flyway version-collision fix, see Deviations

## Decisions Made

- `wsUrl()` reads the raw `process.env.NEXT_PUBLIC_WS_BASE_URL` (not `env.ts`'s defaulted object) so an unset var yields the same-origin fallback in production rather than a defaulted dev value leaking into a prod build.
- The static guard test is file-content-based (reads the three hook `.ts` files off disk and regexes them), not just behavioral, so a future edit that reintroduces the regression pattern fails loudly even before running the hook in a browser.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] finance-service Flyway migration version collision**

- **Found during:** Task 3 (real-browser proof) — finance-service could not start at all
- **Issue:** Two Flyway migrations both claimed version 5 (`V5__expenses.sql` from plan 10-05, `V5__posted_source_events.sql` from Phase 09), landed via separate branches: `Found more than one migration with version 5`. This blocked finance-service from starting, which in turn blocked the Task 3 proof — POS order-close calls finance-service for the accounting-period check and fails closed (423) if finance is unreachable.
- **Fix:** Verified against the live `flyway_schema_history` table that `V5__expenses.sql` was the one already applied and that the `posted_source_events` table did not yet exist. Renamed the unapplied file to `V7__posted_source_events.sql` (V6 was already taken) so it applies cleanly on top of the existing history with no baseline needed.
- **Files modified:** `services/finance-service/src/main/resources/db/migration/V5__posted_source_events.sql` → `V7__posted_source_events.sql` (file rename only, no content change)
- **Verification:** finance-service now starts, registers with Eureka, and Flyway records V7 as applied; the subsequent POS order-close accounting-period check succeeded, unblocking the Task 3 dashboard proof.
- **Committed in:** `a29a75b` (separate commit, not part of a 12-16 task, since it fixes an unrelated finance-service migration collision rather than any 12-16 task file)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to unblock the Task 3 real-browser proof (POS order-close calls finance-service synchronously); no scope creep into 12-16's own frontend WS-routing scope.

## Issues Encountered

- **Cold Resilience4j `lb://` pool on the gateway.** Both the dashboard and KDS WS proofs required a brief warmup: the first WS upgrade request after an idle gateway period got answered with the SERVICE_UNAVAILABLE circuit-breaker fallback (503) instead of a real upstream connection, until the load-balanced route pool warmed up. This is pre-existing dev-stack behavior (not introduced or fixed by this plan) — noted here as an operational caveat for anyone re-running this proof after the gateway has been idle.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Test 3 (RPT-02) and Test 4 from `12-UAT.md` are now genuinely closed: both sockets reach the real gateway, handshake 101, and push live data within budget, with unit tests + a static guard preventing regression.
- This was the last of the four 12-10 gap-closure plans (12-12, 12-13, 12-14, 12-15) to receive a real-browser/real-stack proof of its specific fix — 12-16 is the browser-side half of 12-12's gateway-side WS auth work, and both are now proven end-to-end together.
- A phase-level UAT/verification re-pass over all of Phase 12's gap-closure plans (12-12 through 12-16) remains the appropriate next step to formally flip RPT-02 back to Complete in REQUIREMENTS.md.

---
*Phase: 12-reporting-dashboards-nlq*
*Completed: 2026-07-21*
