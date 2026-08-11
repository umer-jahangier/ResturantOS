---
phase: 28-station-pos-profiles
plan: 01
subsystem: auth
tags: [jwt, liquibase, rls, permissions, stations, rbac]

requires:
  - phase: 13-access-repair
    provides: "user_branch_roles, the role ceiling, BranchRoleAdminService's tenant-GUC and 404-for-foreign-tenant posture"
  - phase: 19b
    provides: "pos.tables.admin and its two-changeSet grant-then-verify shape (changelog 083)"
provides:
  - "auth_db table `user_station_assignments` — which stations a user works, per branch, FORCE RLS"
  - "JWT claim contract: attributes['stations'] = sorted List<String> of station CODES; ABSENT means unrestricted"
  - "PUT/GET /api/v1/users/{id}/stations (user-service) → /internal/auth/users/{id}/stations (auth-service)"
  - "Permission `pos.terminals.admin`, granted to OWNER/TENANT_ADMIN/MANAGER — consumed by plan 28-04"
affects: [28-04, 28-07, 28-11, 28-14]

tech-stack:
  added: []
  patterns:
    - "A view-scope claim rides the existing `attributes` map rather than gaining a positional JWT component"
    - "Absent-key is the ONLY encoding of 'unrestricted'; an empty list is never produced"
    - "A replace-semantics assignment reactivates rows in place rather than delete-then-insert, because the unique constraint makes the naive form fail only on the second edit"

key-files:
  created:
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/085-pos-terminals-admin-permission.xml
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/086-user-station-assignments.xml
    - services/auth-service/src/main/java/io/restaurantos/auth/entity/UserStationAssignmentEntity.java
    - services/auth-service/src/main/java/io/restaurantos/auth/repository/UserStationAssignmentRepository.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/StationAssignmentAdminService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/request/StationAssignmentRequest.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/response/StationAssignmentResponse.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/StationAssignmentClaimIT.java
  modified:
    - services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml
    - services/auth-service/src/main/java/io/restaurantos/auth/service/PermissionResolver.java
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/AuthInternalController.java
    - services/user-service/src/main/java/io/restaurantos/user/controller/UserAdminController.java
    - services/user-service/src/main/java/io/restaurantos/user/service/UserAdminService.java
    - services/user-service/src/main/java/io/restaurantos/user/client/AuthInternalClient.java
    - services/user-service/src/main/java/io/restaurantos/user/dto/BranchDtos.java
    - services/auth-service/src/test/java/io/restaurantos/auth/service/PermissionResolverTest.java

key-decisions:
  - "The claim key is the string `stations` and its value is a sorted List<String> of station CODES. Declared once as PermissionResolver.STATION_SCOPE_CLAIM so a rename cannot leave producer and consumer disagreeing — which would not throw, it would silently un-scope every cook."
  - "The table stores the CODE, not a station UUID. pos_db and auth_db are separate databases, so a UUID would be a foreign key that can neither be declared nor enforced; and the code is already the routing key on tickets and on the KDS socket, and cannot be renamed."
  - "Station codes are NOT validated against pos-service. auth-service has no route into pos_db. An unknown code filters a user to a station producing no tickets — visible within a shift and self-correcting; a synchronous cross-service check would instead break user editing whenever pos-service redeploys."
  - "The station endpoints require no X-Acting-User-Id, unlike every other internal write. That header exists to apply the ROLE CEILING; a station assignment grants nothing and only narrows, so there is no ceiling to compute."
  - "Gated on rbac.role.manage (the same gate as branch-role assignment), not on rbac.user.manage and not on pos.terminals.admin. D-28-02 puts the station picker in the same form as the role picker."

patterns-established:
  - "Claim-minting is asserted by driving the three real endpoints (login, refresh, switch-branch), never by calling the resolver — a mint path that stopped forwarding attributes would neither fail to compile nor throw"
  - "The unrestricted default is asserted as key ABSENCE, explicitly, as its own named test"

requirements-completed: [P28-SC6]

coverage:
  - id: D1
    description: "pos.terminals.admin exists in the permission catalogue and is held by OWNER, TENANT_ADMIN and MANAGER, with a migration that RAISEs if the grant lands on zero roles"
    requirement: P28-SC6
    verification:
      - kind: unit
        ref: "services/auth-service/src/test/java/io/restaurantos/auth/PermissionCatalogClosureTest.java — 2 tests"
        status: pass
      - kind: integration
        ref: "AuthLoginIT — boots the full Liquibase chain including 085/086 from empty"
        status: pass
    human_judgment: false
  - id: D2
    description: "user_station_assignments exists, tenant-isolated with ENABLE + FORCE row level security and a (tenant,user) index"
    requirement: P28-SC6
    verification:
      - kind: integration
        ref: "StationAssignmentClaimIT — every write runs with the tenant GUC set inside the writing transaction, the shape a FORCEd table requires"
        status: pass
    human_judgment: false
  - id: D3
    description: "A user's station codes travel in the access token's attributes map, re-resolved on login, on refresh and on branch switch"
    requirement: P28-SC6
    verification:
      - kind: integration
        ref: "StationAssignmentClaimIT#loginMintsTheAttribute, #refreshRereadsFromTheDatabase_ratherThanCopyingThePreviousToken, #branchSwitchMintsForTheTargetBranch_notTheOneTheCallerCameFrom"
        status: pass
    human_judgment: false
  - id: D4
    description: "A user with no station assignment produces NO station key at all — the encoding that makes 'sees everything' the do-nothing default"
    requirement: P28-SC6
    verification:
      - kind: integration
        ref: "StationAssignmentClaimIT#unassignedUser_hasNoStationKeyAtAll_notAnEmptyList, #replacingWithAnEmptySet_returnsTheUserToUnrestricted"
        status: pass
    human_judgment: false
  - id: D5
    description: "A tenant admin can attach zero or more station codes to a user, per branch, through the same API family that attaches a branch role"
    requirement: P28-SC6
    verification:
      - kind: integration
        ref: "StationAssignmentClaimIT — 8 write-path tests including idempotency, re-add-after-remove, cross-tenant indistinguishability and branch-less refusal"
        status: pass
    human_judgment: false

duration: 62min
completed: 2026-08-11
status: complete
---

# Phase 28 Plan 01: Station assignment on the identity — Summary

**A user's stations are now part of who they are: `attributes['stations']` on every token auth-service mints, written through the same admin API family that assigns a branch role, with absence — not emptiness — meaning "sees everything".**

## Performance

- **Duration:** ~62 min
- **Tasks:** 3 of 3
- **Files modified:** 16 (8 created, 8 modified)
- **Commits:** `8fc0346`, `f6c70200`, `83592487`

## Accomplishments

- **The claim contract, spelled out.** `attributes["stations"]` holds a **sorted `List<String>` of station CODES**. The key name is declared once, as `PermissionResolver.STATION_SCOPE_CLAIM`, because plan 28-07 reads it in kitchen-service and plan 28-11 writes it from the browser, and a disagreement between them would not throw — it would silently un-scope every cook in the product.
- **All three mint paths carry it, and that is asserted by driving all three.** `AuthServiceImpl`'s login mint, its refresh mint and `BranchSwitchService` each already forward `resolved.attributes()` to the signer, so extending `buildForAssignment` was enough. The test drives `/login`, `/refresh` and `/switch-branch` rather than the resolver, because the thing that can regress is the forwarding, not the resolution. The refresh case adds a station *after* the first token is minted and asserts the refreshed token sees it — a refresh that copied claims off the old token would pass a weaker test.
- **`user_station_assignments`, ENABLEd *and* FORCEd.** Postgres exempts a table's owner from its own policies under a bare `ENABLE`; that exemption is what phase 17b spent a phase closing across pos_db. The new table gets both, plus a `tenant_isolation` policy on the `app.current_tenant_id` GUC, plus an explicit `tenantId` predicate on every repository finder — because Testcontainers runs as a superuser and the policy is inert in CI, so the predicate is the only part of the isolation a test can actually assert.
- **The write path is a replace, and it survives a change of mind.** Rows not named are deactivated in place; rows re-added are reactivated in place. A delete-then-insert would have passed every test that assigns once and failed the first time an administrator removed a station and then put it back, because the `(tenant, user, branch, code)` unique constraint rejects the second row. There is a named test for exactly that sequence.
- **`pos.terminals.admin` landed early, on purpose.** `PermissionCatalogClosureTest` scans `@PreAuthorize` across every service and fails the build on a permission no changelog defines, so plan 28-04's controller cannot reference it until it exists. Granted explicitly to OWNER/TENANT_ADMIN/MANAGER (never by catalogue-wide `SELECT`, which is point-in-time and retro-grants nothing), with 083's verification changeSet that `RAISE`s if the grant lands on zero roles.

## The claim contract, for plans 28-07 and 28-11

```
JWT claim:  attributes.stations
Java const: io.restaurantos.auth.service.PermissionResolver.STATION_SCOPE_CLAIM  ==  "stations"
Type:       List<String>, sorted ascending, de-duplicated, upper-cased
Absent:     the user has NO station restriction — they see every station at their branch
Empty list: NEVER PRODUCED. If a consumer ever sees one, that is a bug upstream, not a scope.
```

New endpoints:

```
PUT  /api/v1/users/{userId}/stations      body {branchId, stationCodes[]}   gate rbac.role.manage
GET  /api/v1/users/{userId}/stations                                        gate rbac.user.manage
   → PUT/GET /internal/auth/users/{userId}/stations   (X-Internal-Service + X-Tenant-Id)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `PermissionResolverTest` would not compile after the constructor gained a dependency**
- **Found during:** Task 2
- **Issue:** `PermissionResolver`'s constructor gained `UserStationAssignmentRepository`; the existing unit test constructs it directly and broke the test compile for the whole module.
- **Fix:** Added a stubbed repository returning an empty list — which is exactly the state every user in the product is in, so those six branch-selection cases still measure what they were written to measure.
- **Files modified:** `services/auth-service/src/test/java/io/restaurantos/auth/service/PermissionResolverTest.java`
- **Commit:** `f6c70200`

### Environment notes (not deviations, but load-bearing for the rest of this phase)

- Maven must run on JDK 25 (`JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home`); `/usr/libexec/java_home -v 25` does **not** resolve it on this machine.
- Testcontainers needs `TESTCONTAINERS_RYUK_DISABLED=true` **and** `TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2` exported. `~/.testcontainers.properties` sets both and neither was honoured by the failsafe fork; passing them as environment variables works. Without the host override, `BaseIntegrationTest.awaitPostgresReady` fails with `EOFException` through colima's loopback forward.
- `mvn test -Dtest=SomethingIT` runs nothing — confirmed. Use `mvn verify -Dit.test=`.

## Threat Flags

None. No new network surface beyond the two endpoints named above, both gated by pre-existing permissions on a pre-existing controller; no new trust boundary; no new package.

## Self-Check: PASSED

All eight created files present on disk; all three commits (`8fc0346`, `f6c70200`, `83592487`) resolve in `git log`.

## Verification

| Check | Result |
|---|---|
| `PermissionCatalogClosureTest` | 2/2 pass |
| `StationAssignmentClaimIT` (15 planned behaviours, 16 tests) | 16/16 pass |
| `BranchSwitchIT`, `UnifiedLoginIT`, `TotpFlowIT`, `RefreshLogoutIT`, `AuthInternalBranchRoleIT` | 27/27 pass |
| auth-service unit suite | 36/36 pass |
| user-service build + tests | pass |
| Liquibase 085/086 from empty | applied via `AuthLoginIT` boot |
