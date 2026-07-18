---
phase: 12-reporting-dashboards-nlq
plan: 13
subsystem: auth
tags: [rls, tenant-isolation, jwt, internal-auth, feign, user-service, fbr]

# Dependency graph
requires:
  - phase: 12-reporting-dashboards-nlq
    provides: 12-05 (FBR Tax Summary report calling user-service's internal branch-detail endpoint for ntn/fbrStrn), 12-10 (real-stack E2E proof that discovered GAP B — ntn/fbrStrn NULL live)
provides:
  - user-service's GET /internal/users/branches/{branchId} now resolves the RLS tenant GUC from the forwarded caller JWT's tenant claim (TenantContext) when X-Tenant-Id is absent, instead of silently skipping the GUC
  - unit-level regression coverage pinning JWT-fallback and header-precedence for this endpoint
affects: [12-reporting-dashboards-nlq (real-stack proof — consolidated orchestrator run), 10-25 (InternalServiceFilter/internal-auth hardening — same bug class)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Internal-auth seam: prefer an explicit tenant-scoping header when present, else derive tenant from TenantContext (already populated by JwtAuthenticationFilter from the forwarded caller JWT's tenant_id claim) — removes dependence on a header a caller may omit."

key-files:
  created:
    - services/user-service/src/test/java/io/restaurantos/user/controller/BranchInternalControllerTenantContextTest.java
  modified:
    - services/user-service/src/main/java/io/restaurantos/user/controller/BranchInternalController.java

key-decisions:
  - "X-Tenant-Id header still takes precedence when present (back-compat with provisioning-saga callers) — TenantContext is a fallback, not a replacement."
  - "Reused the existing setTenantGuc(UUID) set_config('app.current_tenant_id', ...) helper — no TenantAwareDataSource re-roll, no new wiring (TenantContext/EntityManager were already constructor fields)."
  - "createBranch and getBranchesByTenant were left unchanged — they already receive an explicit tenant argument and were never part of GAP B."
  - "Task 3 (real-stack fleet bring-up + through-gateway curl proof) was explicitly out of scope for this execution per orchestrator instruction — a consolidated proof run covering 12-12/12-13/12-14 together avoids colliding fleet bring-ups on the 8GB dev host. Left PENDING with the exact runnable command block below."

patterns-established:
  - "Pattern: Internal-service endpoints that require RLS tenant scoping should resolve the tenant from (header ?? JWT claim already on TenantContext), not header-only — applicable to any other /internal/* endpoint found to have the same fragile-header dependency (see 10-25)."

# Metrics
duration: 25min
completed: 2026-07-19
---

# Phase 12 Plan 13: FBR RLS Tenant GUC — JWT-Claim Fallback Summary

**`BranchInternalController.getBranch` now derives the RLS tenant GUC from the forwarded JWT's tenant claim (via TenantContext) when X-Tenant-Id is absent, closing the internal-auth seam that caused FBR's ntn/fbrStrn to be NULL live.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-19T09:20:00Z
- **Completed:** 2026-07-19T09:50:00Z
- **Tasks:** 2 of 3 (Task 3 — real-stack fleet proof — explicitly deferred per scope instruction)
- **Files modified:** 2 (1 main, 1 new test)

## Accomplishments

- Root-caused and closed GAP B (12-E2E-EVIDENCE.md §1f): `getBranch` previously set the RLS tenant GUC ONLY when an optional `X-Tenant-Id` header was present. reporting-service's internal Feign call authenticates fine (the `990026a` `forwardCallerJwt()` fix works) but does not reliably send that header, so the GUC was never set, the RLS-scoped `branches` SELECT matched zero rows, user-service threw `invalid input syntax for type uuid: ""`, and the FBR report degraded to `ntn=null, fbrStrn=null`.
- Fixed by falling back to `TenantContext.getTenantId()` — already populated on the request thread by `JwtAuthenticationFilter` from the forwarded caller JWT's `tenant_id` claim — when the header is absent. Header still wins when present (back-compat).
- Added `BranchInternalControllerTenantContextTest`: 3 unit tests (mocked `BranchService`/`TenantContext`/`EntityManager`) proving (1) no-header-but-JWT-tenant-present now sets the GUC and returns the branch, (2) header-present-with-different-JWT-tenant still prefers the header, (3) neither source present skips the GUC without error (matches prior semantics for a fully-absent tenant).
- `mvn -pl services/user-service compile` and the targeted test both green; `mvn -pl services/user-service test` (unit-only; `*IT.java` excluded by surefire's default include pattern) confirms no regression to the existing suite.

## Task Commits

Each task was committed atomically:

1. **Task 1: Derive the tenant GUC from the forwarded JWT claim in getBranch** - `9a4ed0a` (fix)
2. **Task 2: Test — getBranch resolves tenant from TenantContext when the header is absent** - `2f9f28f` (test)

**Plan metadata:** (this commit, `docs(12-13): ...`)

Task 3 (real-stack proof) intentionally not executed this run — see "Next Phase Readiness" below.

## Files Created/Modified

- `services/user-service/src/main/java/io/restaurantos/user/controller/BranchInternalController.java` - `getBranch` now computes `effectiveTenant = (tenantId != null) ? tenantId : tenantContext.getTenantId().orElse(null)` and sets the GUC from that before the RLS-scoped `branchService.get(branchId)` call.
- `services/user-service/src/test/java/io/restaurantos/user/controller/BranchInternalControllerTenantContextTest.java` - new unit test (mocked collaborators, no Spring context/DB) pinning JWT-fallback, header-precedence, and the no-tenant-anywhere edge case.

## Decisions Made

- Kept the existing `setTenantGuc(UUID)` helper untouched (already does `set_config('app.current_tenant_id', ..., true)` + `tenantContext.set(...)`) — did not re-roll `TenantAwareDataSource`, per plan constraint.
- Header precedence preserved deliberately: some callers (provisioning saga) still send `X-Tenant-Id` explicitly and that must keep working unchanged.
- Did not touch `createBranch`/`getBranchesByTenant` — both already receive an explicit tenant and are unaffected by GAP B.

## Deviations from Plan

None - Tasks 1 and 2 executed exactly as written. Task 3 was explicitly excluded from this execution's scope per the orchestrator's `<critical_scope_instruction>` (consolidated real-stack proof to be run once, after 12-12/12-13/12-14 all land, to avoid colliding fleet bring-ups / OOM on the 8GB dev host) — this is a scope instruction, not a deviation from the plan's intent.

## Issues Encountered

None. Compile and targeted test both passed on first attempt; no transient Maven "Stream closed" errors encountered.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

**Code + unit coverage for GAP B is complete and committed.** The real-stack proof (Task 3) is **PENDING** — to be run by the consolidated orchestrator pass covering 12-12, 12-13, and 12-14 together (each gap plan's fix brought up in the same single fleet bring-up, since the 8GB host cannot sustain multiple parallel fleets). The exact runnable proof, unchanged from the plan:

```bash
# 1. Confirm demo branch NTN/STRN are seeded (data gap vs. code gap check)
psql <user_db> -c "SELECT id, ntn, fbr_strn FROM branches WHERE id='b0000001-0000-4000-8000-000000000001'"

# 2. Bring up ONLY what's needed (Docker infra via scripts/dev-stack-up.sh, then host-run JVMs:
#    auth-service, user-service [rebuilt with this fix], reporting-service, gateway)

# 3. Real login as owner@demo.local through the gateway to mint a real JWT, then:
curl -s "http://localhost:8080/api/v1/reporting/reports/fbr-tax-summary?from=<..>&to=<..>" \
  -H "Authorization: Bearer <owner jwt>"
# Assert: ntn != null, fbrStrn != null, branchName != null, dataNotes no longer contains
# "Branch NTN/STRN header unavailable"

# 4. Confirm user-service logs show NO `invalid input syntax for type uuid: ""` for the
#    /internal/users/branches/{branchId} call during this run.
```

No blockers for merging this code change; it is a strict superset fix (adds a fallback path, changes no existing precedence) and is covered by regression tests. Concern for the consolidated proof run: ensure only one fleet is up at a time on the shared 8GB host to avoid port/memory collisions with sibling gap plans 12-12 and 12-14.

---
*Phase: 12-reporting-dashboards-nlq*
*Completed: 2026-07-19*
