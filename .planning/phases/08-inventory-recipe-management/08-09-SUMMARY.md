---
phase: 08-inventory-recipe-management
plan: 09
subsystem: auth
tags: [opa, rego, spring-security, jwt, authorization, inventory]

# Dependency graph
requires:
  - phase: 08-inventory-recipe-management (plan 01)
    provides: services/inventory-service Maven module (port 8085), foundation the security config attaches to
provides:
  - policies/restaurantos/inventory.rego (package restaurantos.inventory) — default-deny OPA policy granting on inventory.item.view / inventory.item.manage with same_tenant_and_branch
  - policies/tests/inventory_test.rego — 100%-covering Rego test suite (opa test policies/ -> PASS 104/104)
  - InventoryAuthorizationService (authorizeView/authorizeManage seam every Wave-3+ inventory controller injects)
  - InventorySecurityConfig (AuthorizationService bean, JWT filter chain, /internal/** + /actuator/** + swagger permits)
  - InventoryInternalServiceFilter (X-Internal-Service constant-time secret guard on /internal/**)
affects: [08-03, 08-04, 08-06, 08-07, 08-08 (all Wave-3+ inventory controllers wire into this seam)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-service OPA authorization seam: {Service}AuthorizationService wraps shared-lib AuthorizationService.authorize(module, action, resource); {Service}SecurityConfig declares the sole AuthorizationService bean (OpaClient stays auto-configured by SharedAutoConfiguration); {Service}InternalServiceFilter guards /internal/** — inventory-service now matches kitchen-service's exact wiring shape."

key-files:
  created:
    - policies/restaurantos/inventory.rego
    - policies/tests/inventory_test.rego
    - services/inventory-service/src/main/java/io/restaurantos/inventory/authz/InventoryAuthorizationService.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/config/InventorySecurityConfig.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/config/InventoryInternalServiceFilter.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/InventoryAuthorizationServiceTest.java
  modified: []

key-decisions:
  - "inventory.rego's read (inventory.item.view) allow rule IS guarded by input.action == \"inventory.item.view\", matching kds.rego's actual on-disk shape byte-for-byte — not the un-guarded snippet quoted in 08-RESEARCH.md's \"OPA policy\" section. The un-guarded version would let any principal holding only inventory.item.view pass an inventory.item.manage action check (first rule never inspects input.action), which directly contradicts this plan's own required acceptance criterion (\"view-only user... DENIED the inventory.item.manage action\") and the parallel kds.rego precedent. Treated as a Rule 1 bug-fix against the plan's cited source snippet, not a deviation from intent — the frontmatter's own \"exactly like the kds view rule\" language (which IS action-guarded in the real file) takes precedence over the miscopied RESEARCH.md excerpt."
  - "InventorySecurityConfig omits the kitchen-service-specific `.requestMatchers(\"/api/v1/kitchen/kds/**\").permitAll()` HTTP-level carve-out (that exists solely for kitchen-service's WebSocket handshake); inventory-service has no WebSocket surface, so it is not mirrored."
  - "opa CLI was not on PATH; ran opa test via `docker run openpolicyagent/opa:1.17.1` against the mounted policies/ directory (image was already present locally) rather than skipping the verification — actual pass/coverage results observed, not assumed."

patterns-established:
  - "Pattern: per-service OPA seam (AuthorizationService wrapper + SecurityConfig + InternalServiceFilter) is now proven twice (kitchen-service, inventory-service) — future services should copy this same three-file shape rather than reinventing it."

requirements-completed: [INV-01]

coverage:
  - id: D1
    description: "policies/restaurantos/inventory.rego grants on inventory.item.view (read) and inventory.item.manage (write) with same_tenant_and_branch, default-deny otherwise, mirroring kds.rego's exact action-guarded shape"
    requirement: "INV-01"
    verification:
      - kind: other
        ref: "docker run openpolicyagent/opa:1.17.1 test /policies/ -v -> PASS: 104/104 (all inventory_test.rego cases pass)"
        status: pass
    human_judgment: false
  - id: D2
    description: "opa test policies/ --coverage reports 100% coverage for inventory.rego (and the whole policies/ tree, unchanged for other modules)"
    requirement: "INV-01"
    verification:
      - kind: other
        ref: "docker run openpolicyagent/opa:1.17.1 test /policies/ --coverage --format json -> inventory.rego coverage: 100, overall coverage: 100, not_covered_lines: 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "InventoryAuthorizationService.authorizeView/authorizeManage delegate to shared AuthorizationService.authorize(\"inventory\", <action>, resource) and are fail-closed (rethrow PermissionDeniedException on deny)"
    requirement: "INV-01"
    verification:
      - kind: unit
        ref: "services/inventory-service/src/test/java/io/restaurantos/inventory/InventoryAuthorizationServiceTest.java (3 tests) -> Tests run: 3, Failures: 0, Errors: 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "InventorySecurityConfig exposes the AuthorizationService bean (no duplicate OpaClient bean), the JWT filter chain, and permits /internal/** so Wave 3+ controllers and the internal GRN endpoint work"
    requirement: "INV-01"
    verification:
      - kind: other
        ref: "mvn -pl services/inventory-service -am test-compile -q -> exit 0 (compiles against SharedAutoConfiguration's OpaClient without redeclaration)"
        status: pass
    human_judgment: false

# Metrics
duration: 3min
completed: 2026-07-19
status: complete
---

# Phase 8 Plan 09: Inventory Authorization Foundation (OPA + Service Seam) Summary

**inventory.rego OPA policy (default-deny, view/manage on seeded permission codes, 100% Rego coverage) plus the inventory-service Spring Security wiring — InventoryAuthorizationService, InventorySecurityConfig, InventoryInternalServiceFilter — that every Wave-3+ inventory controller enforces against.**

## Performance

- **Duration:** ~3 min (commit-to-commit)
- **Started:** 2026-07-19T00:13:11+05:00 (first task commit)
- **Completed:** 2026-07-19T00:14:48+05:00 (final task commit)
- **Tasks:** 2/2
- **Files modified:** 6 (all created)

## Accomplishments
- `policies/restaurantos/inventory.rego`: package `restaurantos.inventory`, `default allow := false`, two action-guarded allow rules (`inventory.item.view` / `inventory.item.manage`) each requiring `common.has_permission` + `common.same_tenant_and_branch` — grants only on the already-seeded permission codes, no new auth-service Liquibase change
- `policies/tests/inventory_test.rego`: 15 test cases covering INVENTORY_MANAGER (both actions allowed), view-only (view allowed / manage denied), no-permissions (both denied), unrelated permissions (both denied), cross-branch denial, and cross-tenant denial — all with both permissions present, proving tenant/branch isolation independent of permission grants
- Verified via `docker run openpolicyagent/opa:1.17.1`: `opa test policies/` → **PASS: 104/104**; `opa test policies/ --coverage --format json` → **100% coverage, 0 not-covered lines** across the whole `policies/` tree including the new files
- `InventoryAuthorizationService` (`@Service`): `authorizeView(tenantId, branchId)` / `authorizeManage(tenantId, branchId)` build an `OpaInput.Resource("inventory_item", ...)` and call `authorizationService.authorize("inventory", <action>, resource)` — byte-for-byte the same shape as `KdsAuthorizationService`
- `InventorySecurityConfig` (`@Configuration @EnableMethodSecurity`): `JwksKeyProvider` bean, `JwtAuthenticationFilter` bean, the sole `AuthorizationService` bean (`OpaClient` left to `SharedAutoConfiguration`), and a `SecurityFilterChain` that disables CSRF, sets STATELESS sessions, permits `/internal/**` + `/actuator/**` + swagger, authenticates everything else, and chains `InventoryInternalServiceFilter` before `JwtAuthenticationFilter`
- `InventoryInternalServiceFilter`: constant-time `X-Internal-Service` secret check on `/internal/**` only, mirrors `KitchenInternalServiceFilter` verbatim (package retargeted)
- `InventoryAuthorizationServiceTest`: plain Mockito unit test (`@ExtendWith(MockitoExtension.class)`, no Spring context, no `InventoryTestBase` dependency) proving `authorizeView`/`authorizeManage` pass the correct module/action/tenant/branch via `ArgumentCaptor`, and that a mocked `PermissionDeniedException` from the shared service rethrows unchanged (fail-closed) — 3/3 pass

## Task Commits

Each task was committed atomically:

1. **Task 1: inventory.rego OPA policy + inventory_test.rego (100% coverage)** - `7a0bd80` (feat)
2. **Task 2: InventoryAuthorizationService seam + InventorySecurityConfig + InventoryInternalServiceFilter** - `f2584b5` (feat)

**Plan metadata:** committed separately below (docs: complete plan)

## Files Created/Modified
- `policies/restaurantos/inventory.rego` - Default-deny OPA policy for `inventory.item.view`/`inventory.item.manage`, tenant+branch scoped
- `policies/tests/inventory_test.rego` - 15 test cases driving 100% Rego coverage of `inventory.rego`
- `services/inventory-service/src/main/java/io/restaurantos/inventory/authz/InventoryAuthorizationService.java` - `authorizeView`/`authorizeManage` seam wrapping shared `AuthorizationService`
- `services/inventory-service/src/main/java/io/restaurantos/inventory/config/InventorySecurityConfig.java` - JWT filter chain + `AuthorizationService` bean + `/internal/**` permit
- `services/inventory-service/src/main/java/io/restaurantos/inventory/config/InventoryInternalServiceFilter.java` - `X-Internal-Service` constant-time secret filter for `/internal/**`
- `services/inventory-service/src/test/java/io/restaurantos/inventory/InventoryAuthorizationServiceTest.java` - Unit proof of the seam's module/action wiring + fail-closed behavior

## Decisions Made
- Kept both `inventory.rego` allow rules action-guarded (`input.action == "inventory.item.view"` / `"inventory.item.manage"`), matching `kds.rego`'s real on-disk shape rather than the un-guarded snippet quoted in `08-RESEARCH.md`. The un-guarded version would fail this plan's own required test (view-only principal denied the manage action) — see "Deviations" below.
- Did not add a WebSocket-handshake HTTP-level permit (kitchen-service's `/api/v1/kitchen/kds/**` carve-out) to `InventorySecurityConfig` — inventory-service has no WebSocket surface in this phase.
- Verified `opa test` via `docker run openpolicyagent/opa:1.17.1` since the `opa` CLI is not installed on this machine's PATH; the image was already present locally (`docker images` confirmed `openpolicyagent/opa:1.17.1`), so no new pull/install was required.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Kept the read (inventory.item.view) allow rule action-guarded, correcting 08-RESEARCH.md's un-guarded example snippet**
- **Found during:** Task 1 (inventory.rego authoring)
- **Issue:** `08-RESEARCH.md`'s "OPA policy" section quotes a candidate `inventory.rego` body whose first `allow` rule has no `input.action ==` guard (only `has_permission("inventory.item.view")` + `same_tenant_and_branch`). The plan's own task 1 `<action>` text also describes this as "no input.action guard, exactly like the kds view rule" — but the actual `policies/restaurantos/kds.rego` on disk DOES guard its view rule with `input.action == "pos.kds.view"`. Implementing the un-guarded version would mean a principal holding only `inventory.item.view` would pass the OPA check even when `input.action == "inventory.item.manage"` (the first rule never inspects `action` at all), directly violating this plan's own required acceptance criterion: "inventory_test.rego proves a view-only principal is DENIED the inventory.item.manage action."
- **Fix:** Wrote both allow rules with an `input.action ==` guard (mirroring the real `kds.rego` file, not the RESEARCH.md excerpt or the plan prose describing it). Verified: `test_view_only_denied_manage` passes; a view-only principal is allowed the view action and denied the manage action.
- **Files modified:** `policies/restaurantos/inventory.rego`
- **Verification:** `opa test policies/` → PASS 104/104 including `test_view_only_denied_manage`; `opa test policies/ --coverage` → 100%
- **Committed in:** `7a0bd80` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug-fix against a miscopied source snippet)
**Impact on plan:** Necessary for correctness — the un-guarded alternative would ship a policy that fails the plan's own acceptance criteria and creates a real privilege-escalation gap for view-only principals. No scope creep; the fix stays entirely within `inventory.rego`'s two allow rules.

## Issues Encountered
None beyond the deviation above. Docker path-translation quirk under Git Bash on Windows (bind-mount paths silently rewritten) required `MSYS_NO_PATHCONV=1` when invoking `docker run -v` — noted here in case a future executor on this same Windows/Git-Bash environment hits the same "no such file or directory" error against a path that visibly exists.

## User Setup Required
None - no external service configuration required. The `opa` CLI itself is not installed on this machine, but `openpolicyagent/opa:1.17.1` was already present as a local Docker image, so verification ran without any new install. CI (`.github/workflows/ci.yml`) already invokes `opa test policies/ --coverage` directly (presumably with `opa` on the CI runner's PATH), so no CI change is needed.

## Next Phase Readiness
- The inventory OPA seam is real and testable: `inventory.rego` (default-deny, tenant+branch scoped, 100% covered) plus `InventoryAuthorizationService` (fail-closed, unit-proven) plus `InventorySecurityConfig` (the `AuthorizationService` bean + JWT chain + `/internal/**` permit) plus `InventoryInternalServiceFilter` (secret-guarded `/internal/**`).
- Wave 3+ inventory controllers (08-03/04/06/07/08) can now inject `InventoryAuthorizationService` and call `authorizeView`/`authorizeManage` at the top of each endpoint to get real 403 enforcement, exactly as `KdsController` does with `KdsAuthorizationService`.
- No blockers. The one open item flagged for downstream plans: if any Wave-3+ write endpoint needs a permission code finer-grained than the coarse `inventory.item.manage` (e.g. separate codes for receipts vs. transfers vs. counts), that requires a new auth-service Liquibase changeset and is explicitly out of scope for this plan (per its own prohibitions) — the planner for that plan should flag it as a cross-service dependency, not silently reuse `inventory.item.manage` for everything without confirming that's the intended grain.

---
*Phase: 08-inventory-recipe-management*
*Completed: 2026-07-19*

## Self-Check: PASSED

All 6 created files verified present on disk; both task commit hashes (`7a0bd80`, `f2584b5`) verified present in `git log --oneline --all`.
