---
phase: 35-hr-usability
plan: 03
subsystem: auth
tags: [opa, rego, liquibase, rbac, permissions, tenant-scoping, branch-isolation]

requires:
  - phase: 18b-hr-authz
    provides: "HrAuthorizationService, the nine branch-isolated hr.rego rules, and the real-OPA HrTestBase"
  - phase: 13-access-repair
    provides: "13-07's measurement that permissions and role_permissions are global while roles is tenant-scoped"
provides:
  - "hr.config.view and hr.config.manage permission codes, granted to existing tenants by construction"
  - "hr.rego config_view / config_manage — the only two HR rules scoped by tenant alone"
  - "HrAuthorizationService.authorizeConfigView(tenantId) / authorizeConfigManage(tenantId)"
affects: [35-05, 35-06, 35-08, 35-11, 35-12]

tech-stack:
  added: []
  patterns:
    - "A read permission is DERIVED from an existing one (who holds hr.employee.view), so later role additions inherit it automatically"
    - "A money-critical write permission is ENUMERATED, so the holder set cannot grow by accident"
    - "An authorization method omits a parameter the policy ignores, rather than accepting and discarding it"

key-files:
  created:
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/046-hr-config-permissions.xml
    - services/hr-service/src/test/java/io/restaurantos/hr/HrConfigAuthorizationIT.java
  modified:
    - services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml
    - policies/restaurantos/hr.rego
    - policies/tests/hr_test.rego
    - services/hr-service/src/main/java/io/restaurantos/hr/authz/HrAuthorizationService.java
    - services/hr-service/src/test/java/io/restaurantos/hr/HrTestBase.java

key-decisions:
  - "Two codes, not one: a manager must read the department list to fill an employee form without thereby being able to rewrite the tax table"
  - "hr.config.view is derived from hr.employee.view holders; hr.config.manage is enumerated to OWNER and TENANT_ADMIN"
  - "config_view/config_manage use same_tenant alone — an owner's token carries one branch, so a branch predicate would let them edit the department list only while switched to that branch"
  - "authorizeConfig* takes no branch parameter at all, so a caller cannot pass one and believe it is enforced"
  - "No per-tenant backfill written, because role_permissions is a global (role_code, permission_code) table — verified, not assumed"

patterns-established:
  - "A deliberate cross-branch allow gets a test whose NAME says it is deliberate, so a future reader does not 'fix' it"

requirements-completed: [AUTHZ-01, AUTHZ-02, HR-01, HR-02]

coverage:
  - id: D1
    description: "An owner or tenant admin of an EXISTING tenant can reach the new HR configuration screens with no developer action"
    requirement: AUTHZ-01
    verification:
      - kind: integration
        ref: "scratch-schema replay of 045+046 — hr.config.view to ACCOUNTANT/MANAGER/OWNER/TENANT_ADMIN, hr.config.manage to OWNER/TENANT_ADMIN"
        status: pass
      - kind: integration
        ref: "services/auth-service AuthTenantProvisioningIT (26 tests) + PermissionCatalogClosureTest"
        status: pass
    human_judgment: false
  - id: D2
    description: "HR configuration is authorised tenant-wide, not branch-wide"
    requirement: AUTHZ-02
    verification:
      - kind: unit
        ref: "policies/tests/hr_test.rego#test_config_view_allowed_across_branches_deliberately"
        status: pass
      - kind: integration
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/HrConfigAuthorizationIT.java#configIsAllowedAcrossBranchesDeliberately"
        status: pass
    human_judgment: false
  - id: D3
    description: "Employee, attendance, leave and payroll remain branch-isolated exactly as 18b left them"
    requirement: AUTHZ-02
    verification:
      - kind: unit
        ref: "policies/tests/hr_test.rego#test_all_operational_actions_still_deny_cross_branch (all nine actions)"
        status: pass
      - kind: integration
        ref: "services/hr-service EmployeeBranchIsolationIT (4 tests, unchanged)"
        status: pass
    human_judgment: false
  - id: D4
    description: "hr-service asks OPA before serving or mutating configuration, rather than carrying a second permission check"
    requirement: AUTHZ-01
    verification:
      - kind: unit
        ref: "services/authorization-service PolicyReachabilityTest — every rego rule resolves to a Java caller"
        status: pass
      - kind: integration
        ref: "HrConfigAuthorizationIT#denialOriginatesFromThePolicy"
        status: pass
    human_judgment: false
  - id: D5
    description: "A real owner opens the HR settings screens in a browser without a 403"
    verification: []
    human_judgment: true
    rationale: "No HR settings screen exists yet — 35-11 and 35-12 build them. End-to-end proof through the gateway belongs to 35-14."

duration: 34min
completed: 2026-08-12
status: complete
---

# Phase 35 Plan 03: HR Configuration Authority Summary

**Two permission codes that reach existing tenants by construction, two rego rules that are tenant-scoped on purpose, and an enforcement point that refuses to accept a branch it would only ignore — with the nine operational rules provably untouched.**

## Performance

- **Duration:** 34 min (including ~10 min blocked on a sibling agent's mid-refactor compile break)
- **Started:** 2026-08-11T23:53Z
- **Completed:** 2026-08-12T00:12Z
- **Tasks:** 3
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments

- HR configuration has an authority. Without it the wave-2 screens would be unreachable or unguarded, and three wave-2 plans would each have invented their own answer to "who may edit the tax table".
- The grant reaches tenants that already exist — the failure mode the plan named as "the same blocker in a new costume".
- Branch isolation from phase 18b is provably unchanged, asserted for all nine actions rather than left to be inferred from an absence.

## The contract wave 2 binds to

| Code | Held by | Rego action | Scope |
|---|---|---|---|
| `hr.config.view` | ACCOUNTANT, MANAGER, OWNER, TENANT_ADMIN | `config_view` | tenant |
| `hr.config.manage` | OWNER, TENANT_ADMIN | `config_manage` | tenant |

**Java entry points:** `HrAuthorizationService.authorizeConfigView(UUID tenantId)` and `authorizeConfigManage(UUID tenantId)`. Neither takes a branch.

**Two codes, not one.** Every dropdown in this phase reads one of these lists, so anyone who can fill an employee form must be able to read the department list. Editing the tax table must not follow from that. Collapsed into one code, the choice would be between a manager who cannot use a dropdown and a manager who can rewrite the tax slabs.

## Task Commits

1. **Task 1: two permission codes granted to existing roles** — `2c9b9d18` (feat)
2. **Task 2: two rego rules, tenant-scoped on purpose** — `07db3860` (feat)
3. **Task 3: the hr-service enforcement point** — `d2bbbdc6` (feat)

## Decisions Made

**`hr.config.view` is derived, `hr.config.manage` is enumerated.** The view grant is a `SELECT ... WHERE permission_code = 'hr.employee.view'`, so a role granted employee-view by a *later* changeset picks up config-read automatically instead of silently acquiring a form whose dropdowns 403. The manage grant is an explicit two-role list precisely so the holder set cannot grow by accident — it is deliberately **not** derived from `hr.employee.manage`, which a branch MANAGER holds.

**The config methods take no branch parameter.** Accepting one and ignoring it would let a caller pass a branch and believe it was being enforced — the same class of defect as the pre-18b call sites that "looked enforced and denied nothing".

## Deviations from Plan

**1. [Plan inaccuracy] There is no backfill block in 045 to copy.**

The plan's Task 1 said to read "the block near its end that backfills permissions onto roles in tenants that already exist" and called it "the part that matters most here". No such block exists — 045's two trailing `<sql>` statements are idempotent grants to OWNER and TENANT_ADMIN, not a per-tenant backfill.

The requirement behind it is nonetheless satisfied, and this was **verified rather than reasoned about**: `role_permissions` is `(role_code, permission_code)` with **no `tenant_id`**, and a JWT's permission union comes from `RolePermissionRepository#findPermissionCodesByRoleCodes` over role *codes*. 13-07-SUMMARY had already measured which of the three tables is tenant-scoped (`roles`) and which are not (`permissions`, `role_permissions`). So a grant to OWNER reaches every existing tenant's owner the moment the changeset applies; there is nothing to backfill.

**Operational caveat worth stating:** a user holding an already-issued access token does not gain the permission until their next login or refresh, because the union is baked into the JWT at issue time. That is existing behaviour for every permission, not something introduced here — but it means "log out and back in" is the answer if an owner reports a 403 immediately after deploy.

**2. [Plan inaccuracy] The `= 9` grep check needed the comment reworded.**

Task 2's verify asserts `grep -c same_tenant_and_branch hr.rego` equals 9. My explanatory comment originally used the literal token in prose, making it 10. Reworded to "without the branch conjunction" so the count still means "nine branch-isolated rules". The check now passes and still measures what it was meant to.

**3. Filename `046-` collides numerically with `046-nlq-permissions.xml`.**

Both now exist. This is fine and has precedent (`045-reporting-permissions.xml` and `045-hr-permissions.xml` already coexist) — Liquibase keys on filename + changeset id, not on the numeric prefix. A comment in the master changelog records this so it does not look like a mistake.

---

**Total deviations:** 0 code deviations; 3 plan corrections.

## Issues Encountered

**Blocked ~10 minutes by a sibling agent's in-flight ADMS refactor.** `AttlogParseOutcome`, `AdmsController` and then `AdmsIngestIT` were mid-edit and uncompilable, and javac compiles all test sources together — so no hr-service test could run regardless of which file it lived in. Waited and retried rather than touching their files; it resolved itself. One further transient failure (`Unable to load class EncryptedStringConverter`) was a concurrent build rewriting `shared-lib/target/classes` mid-read, and passed on retry.

**Everything here was mutation-checked or replayed, not assumed:**

- **The grant shape** was replayed in a scratch database that reproduces 045's end state, then the two `046` statements run against it. Result: `hr.config.view` → ACCOUNTANT, MANAGER, OWNER, TENANT_ADMIN; `hr.config.manage` → OWNER, TENANT_ADMIN. CASHIER and WAITER receive neither. Re-running both blocks left the counts at 4 and 2, so the changeset is idempotent.
- **The rego scoping** was mutation-checked: giving `config_view` the branch conjunction — exactly the "fix" a future reader might make on seeing a cross-branch allow in an HR policy — fails `test_config_view_allowed_across_branches_deliberately`, which is named to tell them why not to.
- **Reachability** is proven by `PolicyReachabilityTest`, which resolves every rego rule to a Java caller. This matters more than usual here: `hr.rego` spent an entire phase as a dead letter with 28 passing tests and no caller, and two new rules with no caller would have been the same defect again.

**What this plan did NOT do:** no controller calls `authorizeConfigView`/`authorizeConfigManage` yet. They exist for 35-05, 35-06 and 35-08 to call. `PolicyReachabilityTest` is satisfied by the `HrAuthorizationService` methods themselves, so a rule with a method but no controller still passes — the endpoint-level proof arrives with those plans.

## User Setup Required

None. The permissions apply on the next auth-service migration.

**If an owner sees a 403 on an HR settings screen immediately after this deploys, the fix is to sign out and back in** — the permission is granted, but their current access token predates it.

## Next Phase Readiness

- **35-05** (`HrConfigController`), **35-06** (`TaxConfigController`), **35-08** (`SalaryComponentController`) — call `authorizeConfigView` on reads and `authorizeConfigManage` on writes. Do not add a second permission check of your own; OPA is the authority.
- **35-09/35-11/35-12** — the frontend must expect `403 PERMISSION_DENIED` for a MANAGER opening the tax screen, and should not offer the navigation entry at all. `hr.config.view` is the correct gate for showing the dropdowns.

**Concern:** the two codes are now granted but nothing consumes them, so a mistake in the grant would not surface until wave 2. The scratch-schema replay is what stands in for that, and it is weaker than a real end-to-end sign-in. 35-14's cold-start script is where that gets closed properly.

## Self-Check: PASSED

Both created files present on disk; all three task commits present in git history.

---
*Phase: 35-hr-usability*
*Completed: 2026-08-12*
