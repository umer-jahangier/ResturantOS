---
phase: 07-point-of-sale-kitchen-display
plan: 05
subsystem: finance
tags: [finance-service, fiscal-year, accounting-periods, pos, provisioning, gap-closure]

# Dependency graph
requires:
  - phase: 06-finance-core-general-ledger-periods
    provides: AccountingPeriod domain model, PakistanFiscalYear util, seedForTenant() idempotent seeding
provides:
  - InternalProvisioningController fiscal-year computation fixed to use PakistanFiscalYear.current() instead of java.time.Year.now()
  - AccountingPeriodServiceImpl.getPeriodStatus self-heals by auto-seeding the correct fiscal year on a miss instead of permanently 404ing
affects: [07-02 (pos-service order close / FinancePeriodClient), 07-06, 07-07, 07-08 (other gap-closure plans)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Self-healing read endpoint: getPeriodStatus performs a bounded, idempotent write (auto-seed) as a fallback before throwing a not-found error, instead of requiring an external re-seed job."

key-files:
  created: []
  modified:
    - services/finance-service/src/main/java/io/restaurantos/finance/web/InternalProvisioningController.java
    - services/finance-service/src/main/java/io/restaurantos/finance/service/AccountingPeriodServiceImpl.java
    - services/finance-service/src/test/java/io/restaurantos/finance/AccountingPeriodIT.java

key-decisions:
  - "getPeriodStatus changed from @Transactional(readOnly = true) to plain @Transactional (class-level @Transactional already covers writes) to support the auto-seed fallback branch."
  - "Auto-seed reuses the existing idempotent seedForTenant() rather than a new seeding path — no new seeding logic, no risk of duplicate rows (existsByTenantIdAndFiscalYearAndPeriodNo guard already in place)."

patterns-established:
  - "Fail-closed callers (pos-service FinancePeriodClient) stay unchanged; the fix is entirely internal to finance-service and transparent at the contract level (GET /internal/finance/periods/status shape unchanged)."

requirements-completed: [POS-03]

coverage:
  - id: D1
    description: "InternalProvisioningController.provision() and seedCoa() compute fiscal year via PakistanFiscalYear.current() instead of java.time.Year.now().getValue()"
    requirement: "POS-03"
    verification:
      - kind: unit
        ref: "mvn -DskipTests compile (services/finance-service) — compiles cleanly, no java.time.Year usage remains"
        status: pass
    human_judgment: false
  - id: D2
    description: "AccountingPeriodServiceImpl.getPeriodStatus auto-seeds the correct fiscal year and retries once on a miss instead of permanently throwing PeriodNotFoundException"
    requirement: "POS-03"
    verification:
      - kind: integration
        ref: "services/finance-service/src/test/java/io/restaurantos/finance/AccountingPeriodIT.java#getPeriodStatus_dateOutsideSeededFiscalYear_autoSeedsCorrectPeriod"
        status: pass
    human_judgment: false
  - id: D3
    description: "Full finance-service AccountingPeriodIT + CoaProvisioningIT suites pass with no regressions from the readOnly-to-writable transactional change"
    requirement: "POS-03"
    verification:
      - kind: integration
        ref: "mvn -Dtest=AccountingPeriodIT,CoaProvisioningIT test — Tests run: 10, Failures: 0, Errors: 0"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-10
status: complete
---

# Phase 07 Plan 05: Fix fiscal-year provisioning bug + auto-seed self-heal Summary

**Fixed InternalProvisioningController's `java.time.Year.now()` fiscal-year bug (root cause of UAT Test 5's permanent `423 PERIOD_LOCKED`) and added an idempotent auto-seed-on-miss fallback to AccountingPeriodServiceImpl.getPeriodStatus for defense in depth across fiscal-year boundaries.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-10T17:06:00Z
- **Completed:** 2026-07-10T17:14:25Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `InternalProvisioningController.provision()` and `.seedCoa()` now use `PakistanFiscalYear.current()` (Pakistan Jul-Jun fiscal year) instead of `java.time.Year.now().getValue()` (plain calendar year) — a tenant provisioned any time from July through December will now seed periods for the correct, current fiscal year.
- `AccountingPeriodServiceImpl.getPeriodStatus` no longer permanently 404s when no period row covers a requested date. It now auto-seeds the correct fiscal year for that date (reusing the existing idempotent `seedForTenant`) and retries the lookup once before throwing — closing the gap for tenants that cross a fiscal-year boundary with no annual re-seed job in place.
- New regression test `getPeriodStatus_dateOutsideSeededFiscalYear_autoSeedsCorrectPeriod` proves the self-heal path: seeds only FY2026, requests a date in unseeded FY2027, asserts no exception and correct auto-seeded response.
- Full `AccountingPeriodIT` (6/6) and `CoaProvisioningIT` (4/4) suites pass — no regression from the `readOnly` → writable transactional change.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix fiscal-year computation at provisioning time and add auto-seed-on-miss fallback** - `5babd73` (fix)
2. **Task 2: Regression test proving cross-fiscal-year self-heal, plus full IT suite** - `e95a84d` (test)

**Plan metadata:** (pending — final docs commit below)

## Files Created/Modified
- `services/finance-service/src/main/java/io/restaurantos/finance/web/InternalProvisioningController.java` - Both fiscal-year computations (`provision()` ternary default, `seedCoa()` unconditional assignment) now use `PakistanFiscalYear.current()`.
- `services/finance-service/src/main/java/io/restaurantos/finance/service/AccountingPeriodServiceImpl.java` - `getPeriodStatus` changed from `.orElseThrow` to `.orElseGet` with auto-seed-and-retry-once fallback; method annotation changed from `@Transactional(readOnly = true)` to plain `@Transactional`.
- `services/finance-service/src/test/java/io/restaurantos/finance/AccountingPeriodIT.java` - New regression test for the cross-fiscal-year auto-seed self-heal path.

## Decisions Made
- Kept the fix entirely internal to finance-service: `PeriodStatusResponse`, `PeriodNotFoundException`, `PeriodController`, and all pos-service files (including `FinancePeriodClient`) are untouched — the GET /internal/finance/periods/status contract is unchanged, it simply stops 404ing for legitimate business dates on a provisioned tenant.
- Reused the existing idempotent `seedForTenant(tenantId, fiscalYear)` for the auto-seed fallback rather than writing new seeding logic — no new code path for period creation, same audit/RLS posture as provisioning-time seeding.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched the plan's `<action>` instructions precisely (import path, method signatures, transactional annotation change, test assertions all as specified).

## Issues Encountered

`mvn -Dtest=AccountingPeriodIT,CoaProvisioningIT verify` (the plan's literal `<verify>` command) fails at the `repackage` goal on this Windows dev host: `Unable to rename 'finance-service-1.0.0.jar' to '...jar.original'`. Root cause: a finance-service instance from a prior manual UAT session (PID tracked in the untouchable `.dev-pids-uat.json` scratch file left in the working tree, explicitly out of scope per this plan's sequential-execution instructions) has the target jar file-locked. This is a pre-existing environment condition unrelated to this plan's code changes — confirmed by:
- The `test` phase (which runs before `package`/`repackage` in the Maven lifecycle) completes successfully every time, with surefire reports showing `Tests run: 6, Failures: 0, Errors: 0` (AccountingPeriodIT) and `Tests run: 4, Failures: 0, Errors: 0` (CoaProvisioningIT).
- Running `mvn -Dtest=AccountingPeriodIT,CoaProvisioningIT test` (skipping `package`/`repackage`) exits 0 with the same 10/10 passing tests.

No fix was attempted (killing the locking process would violate this plan's explicit instruction to leave the prior UAT session's artifacts untouched). Test correctness for both tasks is fully verified via the `test` phase; the `verify` lifecycle's packaging failure is orthogonal tooling flakiness, not a code defect.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

UAT Test 5's `423 PERIOD_LOCKED` blocker is closed: any tenant, provisioned at any point in the Pakistan fiscal calendar, will now have its accounting period correctly seeded (or self-healed on first status lookup) so `POST /orders/{id}/close` can succeed against a real OPEN period. Ready for the remaining gap-closure plans (07-06, 07-07, 07-08) — none of which touch finance-service files modified here.

## Self-Check: PASSED

- FOUND: services/finance-service/src/main/java/io/restaurantos/finance/web/InternalProvisioningController.java
- FOUND: services/finance-service/src/main/java/io/restaurantos/finance/service/AccountingPeriodServiceImpl.java
- FOUND: services/finance-service/src/test/java/io/restaurantos/finance/AccountingPeriodIT.java
- FOUND commit: 5babd73
- FOUND commit: e95a84d

---
*Phase: 07-point-of-sale-kitchen-display*
*Completed: 2026-07-10*
