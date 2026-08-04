---
phase: 12-reporting-dashboards-nlq
plan: 14
subsystem: auth
tags: [rls, tenant-guc, transactional, impersonation, jwt, feign, auth-service, platform-admin]

requires:
  - phase: 12-reporting-dashboards-nlq
    provides: "12-10 real-stack E2E proof that surfaced GAP C (§1g) — the real impersonation-issuance endpoint 500ing"
provides:
  - "ProvisioningAdminService.impersonate is @Transactional and sets the RLS tenant GUC (set_config) as the first statement before findById"
  - "tenantId threaded platform-admin ImpersonationService -> auth-service AuthProvisioningInternalController -> ProvisioningAdminService.impersonate"
  - "Regression test pinning both the GUC-before-findById ordering AND the @Transactional boundary (reflection check — green impossible without the annotation)"
affects: ["12-reporting-dashboards-nlq (consolidated real-stack proof)", "any future internal endpoint touching RLS-scoped tables"]

tech-stack:
  added: []
  patterns:
    - "Transaction-local RLS GUC (set_config(..., true)) must be the first statement inside an @Transactional method that also performs an RLS-scoped read — reused from 2099ac0 / AuthServiceImpl / BranchAssignmentService pattern"
    - "Reflection-based @Transactional-presence assertion as a regression guard where a pure InOrder mock check cannot detect a missing transaction boundary"

key-files:
  created:
    - services/auth-service/src/test/java/io/restaurantos/auth/service/ProvisioningAdminServiceImpersonateTest.java
  modified:
    - services/auth-service/src/main/java/io/restaurantos/auth/service/ProvisioningAdminService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/AuthProvisioningInternalController.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/ImpersonationService.java

key-decisions:
  - "Added @Transactional to impersonate(...) (it previously had none) — required so the transaction-local set_config GUC and the later findById SELECT execute on the same pooled connection."
  - "Guarded the GUC set with `if (tenantId != null)` so any older/未migrated caller that omits tenantId keeps prior (broken-for-RLS but non-crashing) behavior; the real platform-admin caller now always sends it."
  - "Reused the existing set_config('app.current_tenant_id', :tid, true) EntityManager native-query pattern already used by AuthServiceImpl/BranchAssignmentService/RefreshSessionService/etc. — no TenantAwareDataSource re-roll."

patterns-established:
  - "Reflection assertion (Method.isAnnotationPresent(Transactional.class)) as an explicit regression guard for transaction-boundary-dependent RLS GUC correctness, alongside a Mockito InOrder ordering check."

duration: 25min
completed: 2026-07-18
---

# Phase 12 Plan 14: Impersonation Tenant-GUC + Transactional Fix Summary

**Closed GAP C (12-E2E-EVIDENCE §1g): `ProvisioningAdminService.impersonate` now sets the RLS tenant GUC inside a real `@Transactional` boundary (added — it had none) before `findById`, and the target tenantId is threaded end-to-end from platform-admin's `ImpersonationService` through the auth-service Feign seam.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-18
- **Tasks:** 2 of 3 (Task 3 — real-stack proof — intentionally deferred per orchestrator instruction)
- **Files modified:** 3 (main) + 1 (test, new)

## Accomplishments

- `ProvisioningAdminService.impersonate` signature extended to `(UUID tenantId, UUID targetUserId, UUID impersonatedBy, int expiresInSeconds)`, annotated `@Transactional`, and sets `set_config('app.current_tenant_id', tenantId, true)` via `EntityManager.createNativeQuery` as the FIRST statement inside the method, before `userRepository.findById` and `permissionResolver.resolveDefault`.
- `AuthProvisioningInternalController.ImpersonateRequest` now carries `tenantId` and passes it through to the service call.
- Platform-admin's `ImpersonationService.impersonate` now sends `tenantId` in the Feign request body Map to auth-service (`AuthInternalClient.impersonate`) — no `AuthInternalClient`/`Feign` interface change needed since it already accepted `Map<String,Object>`.
- New unit test `ProvisioningAdminServiceImpersonateTest` with two complementary assertions:
  1. **Ordering** — Mockito `InOrder` proves the GUC native query (`createNativeQuery` → `setParameter("tid", ...)` → `getSingleResult`) runs before `userRepository.findById`, and the method returns a correctly signed `ImpersonateResult`.
  2. **Transactional boundary** — reflection assertion that `impersonate(UUID, UUID, UUID, int)` is annotated `@Transactional`. **Verified empirically**: temporarily removed `@Transactional` from the source, re-ran the test suite, confirmed the boundary test fails (`Expecting value to be true but was false`); restored the annotation, re-ran, confirmed both tests pass again. This proves a green run is impossible without the fix.

## Task Commits

1. **Task 1: Thread tenantId through the seam and set the tenant GUC before findById** - `ee53dd6` (fix)
2. **Task 2: Test — impersonate sets the tenant GUC before the RLS lookup** - `c1722f8` (test)

_Task 3 (real-stack proof) intentionally not executed in this run — see "Next Phase Readiness" below for the exact runnable command block._

## Files Created/Modified

- `services/auth-service/src/main/java/io/restaurantos/auth/service/ProvisioningAdminService.java` — added `EntityManager` field/constructor param, `@Transactional` on `impersonate`, `setTenantGuc(tenantId)` helper called as the first statement (guarded on `tenantId != null`), extended signature to accept `tenantId`.
- `services/auth-service/src/main/java/io/restaurantos/auth/controller/AuthProvisioningInternalController.java` — `ImpersonateRequest` record extended with `tenantId`; passes it to `provisioningAdminService.impersonate(...)`.
- `services/platform-admin-service/src/main/java/io/restaurantos/platform/service/ImpersonationService.java` — Feign request body Map now includes `"tenantId", tenantId.toString()`.
- `services/auth-service/src/test/java/io/restaurantos/auth/service/ProvisioningAdminServiceImpersonateTest.java` (new) — GUC-before-findById ordering test + `@Transactional`-presence reflection test.

## Decisions Made

- **`@Transactional` addition is load-bearing, not cosmetic.** Because `set_config(..., true)` is transaction-local, without a real `@Transactional` boundary on `impersonate`, Spring's default (non-transactional) JPA repository calls can each check out a different pooled connection, silently reproducing the exact "GUC set but RLS SELECT sees no tenant" bug (2099ac0 bug class) this plan closes. Confirmed via a failing-test experiment (see above) rather than by inspection alone.
- Kept the `tenantId != null` guard rather than making the parameter mandatory at the Java-type level, to avoid breaking any older/unknown caller path that predates this fix — but the real (only known) caller, platform-admin, now always sends it.
- Reused the established `set_config` + `EntityManager.createNativeQuery` idiom already present in `AuthServiceImpl`, `BranchAssignmentService`, `RefreshSessionService`, `BranchSwitchService`, `TwoFactorService`, `PasswordResetService` — no new abstraction introduced, no `TenantAwareDataSource` re-roll.

## Deviations from Plan

None — plan executed exactly as specified for Tasks 1 and 2. Task 3 (real-stack proof) was explicitly deferred per the orchestrator's scope instruction (siblings 12-12/12-13 run concurrently on the same 8GB host; the orchestrator runs one consolidated real-stack proof afterward to avoid port/OOM collisions).

## Issues Encountered

None. `mvn -pl services/auth-service,services/platform-admin-service -am compile` succeeded cleanly on the first attempt after the edits; no other callers of the changed `ProvisioningAdminService.impersonate` signature existed in the codebase (grep confirmed only the controller calls it; platform-admin's own `ImpersonationService.impersonate` — a different, unchanged-signature method — is what `PlatformAdminController`/`PlatformInternalController` call).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Code + unit test level (this plan): DONE and green.**
- `mvn -q -pl services/auth-service,services/platform-admin-service -am compile` → clean.
- `mvn -q -Dtest=ProvisioningAdminServiceImpersonateTest test` (run from `services/auth-service`) → `Tests run: 2, Failures: 0, Errors: 0`.

**Task 3 (real-stack proof): PENDING — deferred to the orchestrator's consolidated real-stack run** (not executed here per explicit scope instruction; do NOT bring up the fleet in this plan). Exact runnable command block for whoever runs the consolidated proof:

```bash
# 1. Bring up infra + host-run JVMs (auth-service rebuilt with this fix; user-service,
#    authorization-service, nlq-service, gateway as needed; platform-admin-service only if
#    driving the outer /tenants/{id}/impersonate path).
scripts/dev-stack-up.sh   # postgres, redis, eureka, config-server, clickhouse
# nohup java -jar services/auth-service/target/auth-service-*.jar -Xmx300m & disown
# (repeat health-gated for the other services needed)

# 2. Call the real issuance endpoint for an existing user (was 500ing per §1g):
curl -s -i -X POST "http://localhost:<auth-port>/internal/auth/users/c0000002-0000-4000-8000-000000000002/impersonate" \
  -H "X-Internal-Service: <secret>" -H "Content-Type: application/json" \
  -d '{"tenantId":"a0000001-0000-4000-8000-000000000001","impersonatedBy":"ea07bc72-7c5c-4734-87d2-75ae388b5fd7","expiresInSeconds":1800}'
# Expect: HTTP 200 + non-empty data.token (NOT 500 "Target user not found")

# 3. Use the real impersonation token against the gateway:
curl -s -X POST http://localhost:8080/api/v1/nlq/query \
  -H "Authorization: Bearer <real impersonation jwt>" \
  -d '{"question":"impersonated issuance e2e"}'

# 4. Assert the stamp landed:
psql <nlq_db> -c "SELECT question, user_id, impersonated_by FROM nlq_query_log WHERE question='impersonated issuance e2e'"
# Expect: impersonated_by == ea07bc72-7c5c-4734-87d2-75ae388b5fd7, user_id == impersonated target
```

No blockers for the consolidated run — the code path is compiled, unit-tested, and the `@Transactional` boundary is verified to be regression-proof.

---
*Phase: 12-reporting-dashboards-nlq*
*Completed: 2026-07-18*
