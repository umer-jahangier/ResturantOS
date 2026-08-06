---
phase: 13-platform-tenant-access-repair
plan: 02
subsystem: auth-rbac
tags: [rbac, roles, permissions, liquibase, rls, totp, waiter, tenant-admin]
status: complete
requires:
  - running dev stack (postgres, redis, rabbitmq, eureka, opa) + gateway, auth-service, user-service, pos-service
provides:
  - permission codes rbac.user.manage, rbac.role.manage, branch.manage
  - WAITER system role
  - partial unique index uk_user_branch_roles_one_active on (user_id, branch_id) WHERE is_active
  - user_branch_roles.is_primary + uk_user_branch_roles_one_primary
  - BranchRoleAdminService.RoleAssignmentResult (assignment + displacedRoleCode)
  - BranchRoleAssignWriteResponse on POST /internal/auth/users/{id}/branch-roles
  - PermissionResolver.resolveForTenant
  - scripts/e2e/phase13-roles-e2e.sh
affects:
  - every login (PermissionResolver default-branch selection)
  - every role assignment (auth-service internal write path)
  - user-service branch + user administration gates
  - rbac.rego allow rule
tech-stack:
  added: []
  patterns:
    - repair data first, then create the constraint; let the constraint be the assertion
    - stand RLS down to NO FORCE inside the migration transaction rather than scoping a repair to one tenant
    - enumerate permission codes in Rego, never prefix-match, so the catalog-closure scan can see them
    - assert a role's boundary (what it must NOT hold) from the changelog, not only its seed
key-files:
  created:
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/055-waiter-role-and-tenant-admin-authority.xml
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/056-one-active-role-per-branch.xml
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/response/BranchRoleAssignWriteResponse.java
    - services/auth-service/src/test/java/io/restaurantos/auth/WaiterRoleGrantsTest.java
    - services/auth-service/src/test/java/io/restaurantos/auth/RoleCatalogSeedIT.java
    - services/auth-service/src/test/java/io/restaurantos/auth/OneActiveRolePerBranchIT.java
    - services/auth-service/src/test/java/io/restaurantos/auth/DuplicateActiveRoleRepairIT.java
    - services/auth-service/src/test/java/io/restaurantos/auth/service/PermissionResolverTest.java
    - scripts/e2e/phase13-roles-e2e.sh
  modified:
    - services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml
    - services/auth-service/src/main/java/io/restaurantos/auth/entity/UserBranchRoleEntity.java
    - services/auth-service/src/main/java/io/restaurantos/auth/repository/UserBranchRoleRepository.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/BranchRoleAdminService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/BranchSwitchService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/PermissionResolver.java
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/AuthInternalController.java
    - services/user-service/src/main/java/io/restaurantos/user/controller/UserAdminController.java
    - services/user-service/src/main/java/io/restaurantos/user/controller/BranchController.java
    - services/user-service/src/main/java/io/restaurantos/user/client/AuthInternalClient.java
    - services/user-service/src/main/java/io/restaurantos/user/service/UserAdminService.java
    - policies/restaurantos/rbac.rego
    - policies/tests/rbac_test.rego
decisions: [D-22, D-23, D-24, D-29, D-30]
requirements: [USER-01, USER-02, AUTH-01]
metrics:
  duration: ~3h
  completed: 2026-08-06
  tasks: 3
  commits: 4
---

# Phase 13 Plan 02: Role Catalog Repair — Summary

WAITER exists and cannot touch the till; TENANT_ADMIN can administer users and branches without the
umbrella RBAC permission; two active roles at one branch are now impossible at the schema level; and
the hardcoded dev HQ UUID is gone from the login path. Two things this plan set out to prove are
**left failing on purpose**, and both are described in full below.

## The exact permission code strings

Later plans in this phase reference these verbatim.

| Code | Module | Granted to | Gates |
|---|---|---|---|
| `rbac.user.manage` | `rbac` | OWNER, TENANT_ADMIN | `GET /api/v1/users/{id}` |
| `rbac.role.manage` | `rbac` | OWNER, TENANT_ADMIN | `POST`/`DELETE /api/v1/users/{id}/branch-roles` |
| `branch.manage` | `branch` | OWNER, TENANT_ADMIN | `POST`/`PUT`/`DELETE /api/v1/branches` |

`rbac.manage` is unchanged: still in the catalog, still granted to OWNER, still withheld from
TENANT_ADMIN, and still accepted as an alternative on all six gates so OWNER's authority is
untouched.

**WAITER's grants:** `pos.order.create`, `pos.order.update`, `pos.order.view`,
`pos.order.send_to_kds`, `pos.menu.view`, `pos.tables.manage`, `pos.kds.view`.

## Task 1 — WAITER, and splitting tenant-administration authority

The obvious fix for "TENANT_ADMIN can administer nothing" was to grant it `rbac.manage`. That would
have been wrong quietly: `AuthServiceImpl.requiresTotpStepUp` triggers on exactly that code, so the
grant would have forced TOTP enrolment on every tenant admin as an invisible side effect of an
authorization change. The split avoids adding that trigger. OWNER keeps `rbac.manage` and therefore
keeps step-up, which is intended.

**The two role-writes take `rbac.role.manage` and the read takes `rbac.user.manage`** — the plan said
to point all three UserAdminController gates at the user-administration code. Gating role assignment
on the user code would defeat the split: anyone able to edit a user could then grant themselves
OWNER. Both codes are held by the same two roles today, so this changes nothing now; it is what makes
a narrower custom role possible later without re-auditing these endpoints.

`pos.menu.view` and `pos.tables.manage` are granted beyond the four codes the plan named, because
`MenuController` and `TableController` already gate on them and a waiter who cannot see the menu or
seat a table is not a waiter. Nothing from the till, void, refund, payment or discount families.

**`WaiterRoleGrantsTest` asserts the boundary, not the seed.** It scans every changeset in the
changelog for a WAITER grant in either syntax and fails on the branch that widens the role —
including one written months from now that knows nothing about this file. It needs no database, so
an environment that will not run integration tests cannot skip it. `RoleCatalogSeedIT` asserts the
same facts against a database that has actually run the changelog, because a changelog can be correct
and still not have run (that divergence is what changeset 049 exists to repair).

## Task 2 — one active role per branch

**Repair first, then the index.** Retention rule: for each `(user_id, branch_id)` with more than one
active row, **keep the greatest `(updated_at, id)`** — the most recently touched assignment, ties
broken by the greater id. Losers are soft-deactivated, never deleted; `auth_db` has no audit table
reachable from a changeset, so the row and its `updated_at` are the only record the repair happened.

**The migration had to stand RLS down, and this is the part that would have failed silently.**
`user_branch_roles` is `FORCE ROW LEVEL SECURITY` on a tenant GUC; Liquibase runs as `auth_user`
(`NOSUPERUSER NOBYPASSRLS`), and FORCE binds the table owner too. Measured on the real dev database:

```
owner=auth_user  forcerls=true  current_user=auth_user  superuser=false
rows visible with no tenant GUC ....... 0
rows visible after NO FORCE ........... 18        (superuser count: 18)
forcerls after ROLLBACK ............... true
```

A naive repair `UPDATE` would have matched **0 of 18 rows**, reported success, and left the
duplicates for the index to trip over. Setting a GUC is not an option — the repair spans every
tenant. So the changeset drops to `NO FORCE`, repairs, and restores `FORCE`, all inside the one
transaction Liquibase gives a changeset. A `DO` block then `RAISE`s with a sentence naming RLS if any
duplicate survived, so the operator is told what happened instead of deducing it from a constraint
violation. **Verified by mutation**: changing the repair to a no-op makes `DuplicateActiveRoleRepairIT`
fail with that message, not with an index error — then reverted.

`is_primary` replaces `PermissionResolver.HQ_BRANCH_ID`: one dev tenant's branch UUID that decided
the default branch for every user in every tenant, and that matches nothing at all on a freshly
provisioned tenant because the provisioning saga never marks the first branch HQ.

`assign()` now replaces rather than adds and returns what it displaced — assigning a second role at a
branch is a *revocation* of the first, and an administrator told nothing gets a 200 identical to a
first assignment. The deactivation is flushed before the insert: Hibernate orders inserts ahead of
updates within a flush, so otherwise a legitimate replacement would fail against the new index.

The repository's `Optional` finder is gone. That `Optional` is what turned a duplicated row into
`IncorrectResultSizeDataAccessException` on the login path — a 500 on a credential endpoint, caused
by a row an administrator was allowed to write.

### Migration applied to the real dev database, with real duplicates

Three active rows were planted for one `(user, branch)` pair with staggered `updated_at`, then
auth-service was restarted so Liquibase ran as `auth_user` under FORCE RLS. All six changesets
applied; result:

| id | role | updated_at | is_active | is_primary |
|---|---|---|---|---|
| `d00000f3` | MANAGER | 2026-08-05 (latest) | **t** | **t** |
| `d00000f1` | CASHIER | stamped at repair time | f | f |
| `d00000f2` | ACCOUNTANT | stamped at repair time | f | f |

Remaining duplicate pairs: **0**. Both indexes present. Every user has exactly one primary among
their active rows. `relforcerowsecurity` back to `t`. The probe rows were removed afterwards.

### GitNexus impact (run before editing, per CLAUDE.md)

| Target | Upstream | Risk |
|---|---|---|
| `PermissionResolver` | 5 direct | MEDIUM |
| `selectDefaultBranch` | 11, affecting the **login** and **refresh** processes | LOW (understated) |
| `UserBranchRoleRepository` | 11 direct 8 | MEDIUM |
| `UserBranchRoleEntity` | 10 | MEDIUM |
| `BranchRoleAdminService` | 2 | LOW |

The one that mattered was not in any risk score: `AuthInternalController` serialised
`UserBranchRoleEntity` straight to the wire, so the assign response shape is a public contract. Hence
a flat DTO carrying the same JSON field names plus `displacedRoleCode`, rather than nesting the
entity under a new key. The index was stale (last built at `5fba4a9`); I did not refresh it, because
`gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files, which plan 13-01 had to
revert. `detect_changes` against the pre-plan commit: **22 files, 40 symbols, 0 affected processes,
risk LOW** — no unexpected file.

## Task 3 — proved over live HTTP

`scripts/e2e/phase13-roles-e2e.sh`: **22 PASS / 2 FAIL** against the running stack, with
auth-service, user-service, gateway, pos-service and platform-admin-service all rebuilt and
restarted first (the plan's human-check).

Green: WAITER's four order-taking codes present and **no** `pos.till.*`, `pos.order.void*` or
`pos.order.refund*` in the issued token; 403 on till-open; TENANT_ADMIN's token carries all three new
codes and **not** `rbac.manage`; branch list 200, branch create 201, branch delete 204, and the
waiter 403'd on the same branch-create request (the contrast is what makes the 201 mean anything);
user-permissions read 200; second assignment reports `displacedRoleCode` and the next login's `roles`
claim is single-valued.

## Left failing, deliberately

### 1. TENANT_ADMIN is still challenged for TOTP — and it is not `rbac.manage`

The split worked: the token does not carry `rbac.manage`, and the script asserts that. But
`requiresTotpStepUp` fires on `rbac.manage` **or** `finance.period.close` **or**
`hr.payroll.approve`, and TENANT_ADMIN holds the latter two — changeset 030 grants it "every
permission except `rbac.manage`", and 045-hr adds payroll approval. Confirmed directly:

```
SELECT permission_code FROM role_permissions WHERE role_code='TENANT_ADMIN'
  AND permission_code IN ('rbac.manage','finance.period.close','hr.payroll.approve');
  →  finance.period.close
     hr.payroll.approve
```

So **must_have truth #2 as written — "and therefore without being forced into TOTP step-up at
login" — is not satisfied, and cannot be by this plan's means.** Making it green needs one of:

1. drop `finance.period.close` / `hr.payroll.approve` from `requiresTotpStepUp` — forbidden, and
   correctly so: those are the money-moving actions step-up exists for;
2. revoke those two codes from TENANT_ADMIN — a real reduction of the role's authority, and a
   decision to take deliberately rather than smuggle in as a side effect of an RBAC repair;
3. accept that a tenant admin enrols TOTP, and make enrolment part of user creation.

**Option 3 looks right to me** — a tenant admin who can close an accounting period and approve
payroll should have a second factor — but it is your call, and it changes what 13-04/13-05 must do at
user creation. The script continues past the failure with a stepped-up token so the administration
half is still proved live rather than left unmeasured.

### 2. A WAITER is authorized to take an order and pos-service refuses it anyway

```
POST /api/v1/pos/orders  →  409
{"title":"NO_OPEN_TILL","detail":"Cashier has no open till session; open a till before taking orders"}
```

`OrderService` requires the **creating user** to hold an open till session. A WAITER cannot obtain
one — `pos.till.open` is withheld, which is the entire reason the role exists. The grants are right
and the workflow is impossible. Fixing it means changing where pos-service demands a till (a waiter
should ring against the branch's till, or the till should be required only at payment) — an
architectural change to a service outside this plan's file list, so it is reported, not made. This
belongs in the multi-POS-terminal work (Phase 16) or as a scoped fix before the seed script in 13-14
claims a working waiter persona.

## Deviations from plan

**1. [Rule 1 — bug] The internal role-write path never set the tenant GUC.** Found by running the
real endpoint against the real stack. `POST /internal/auth/users/{id}/branch-roles` — the only write
path for `user_branch_roles`, and the door user-service delegates every role assignment through — has
never worked against a database that enforces RLS: *"new row violates row-level security policy for
table user_branch_roles"*. There is no JWT on `/internal/**`, so `JwtAuthenticationFilter` never
populates `TenantContext` and `TenantAwareDataSource` sets no GUC. It passed every test because
Testcontainers' Postgres user is a superuser and superusers bypass row security — the suite was green
against a database that could not reproduce the failure. `BranchAssignmentService` and
`BranchSwitchService` already compensate by hand; these two methods were missed. Commit `ab7e59a`.

**2. [Rule 1 — bug] `GET /internal/auth/users/{id}/permissions` had the same hole**, and answered
"user has no active branch assignments" — the message for a locked-out user — about a user whose rows
were present. Its javadoc already claimed `X-Tenant-Id` was required; it never declared the header.
Now optional (pre-existing callers keep their behaviour rather than starting to 400) and sent by
user-service's Feign client. Commit `ab7e59a`.

**3. [Rule 2 — verifiability] Four test files not in the plan.** `WaiterRoleGrantsTest` (the
boundary assertion you asked for, which fails if anyone later widens the role via any changeset),
`RoleCatalogSeedIT`, `DuplicateActiveRoleRepairIT` (migration against real duplicates — every other
test runs against an empty database where the repair has nothing to repair, so the repair could have
been a total no-op and the suite would still be green), and `PermissionResolverTest` (the resolver's
surplus-row branch is unreachable through the database now that the index exists).

**4. [Scope] Changeset 056 is included AFTER the 900-series seeds** despite its number. The
`is_primary` backfill has to observe every `user_branch_roles` row the changelog itself writes; run
before the seeds it would leave every seeded persona with no primary on a fresh database, making the
fresh-install and upgrade paths behave differently. Explained in a comment at the include.

**5. [Rule 1 — bug, in my own harness] Two ways the e2e script lied before I fixed it.** Reporting
both because a verification script that can quietly test the wrong thing is worse than none:
- `-d "{\"a\":1,\"b\":2}"` written inline inside `"$( … )"` is **brace-expanded**. `set -x` showed
  curl running *twice* with two malformed fragments, and both statuses arriving in `assert_status` as
  the actual status *and* the description. It reported `FAIL: 400 — expected 403, got 400` for a
  request that, sent correctly, returns 403. All bodies are built in variables now.
- `assert_not_status 403` passed on a gateway **503** — an authorization success reported for a
  request that never reached the service. `assert_authorized` rejects 401/403/404/5xx/000.
- Also: `set -e` killed the script at the first failing assertion, so the first run printed one FAIL
  and silently skipped everything after it. errexit is now dropped for the assertion phase only.

**6. [Out of plan scope, no source touched] pos-service and gateway had to be restarted.** `mvn
package` rewrote their jars under running JVMs, which produced `NoClassDefFoundError:
ch.qos.logback.classic.spi.ThrowableProxy` and a gateway 503 that briefly looked like an application
failure. Restarted onto the current jars; nothing changed in either service.

## Known stubs

None. Every symbol this plan created is wired and exercised — by an integration test, a live HTTP
assertion, or both.

## Threat flags

None beyond the plan's register. `T-13-02-A` is covered by `RoleCatalogSeedIT` plus the live
tenant-admin assertions; `T-13-02-B` by the positive-and-negative token assertions plus the live 403
on till-open; `T-13-02-C` by the documented retention rule and the soft deactivate; `T-13-02-D` by
the index plus `PermissionResolverTest`; `T-13-02-E` by OWNER retaining `rbac.manage` (asserted in
`RoleCatalogSeedIT`); `T-13-02-F` by four enumerated Rego rules, a deny case for a holder of
administration-adjacent-but-wrong codes, and coverage held at 100%. `T-13-02-SC` did not arise — no
package was installed.

One flag worth recording: `finance.period.close` and `hr.payroll.approve` on TENANT_ADMIN are a
*pre-existing* authority question this plan surfaced rather than introduced (see "Left failing" #1).

## Verification actually run

Every number is from a command executed in the state being reported.

| Suite | Result |
|---|---|
| `mvn -pl services/auth-service verify` | unit **21/21**, IT **45/45**, BUILD SUCCESS |
| `mvn -pl services/user-service verify` | unit **3/3**, IT **11/11**, BUILD SUCCESS |
| `opa test policies/` | **139/139**, coverage **100%** (was 132/132) |
| `mvn -T1C -DskipTests package` | all modules SUCCESS |
| `bash scripts/e2e/phase13-roles-e2e.sh` | **22 PASS / 2 FAIL** — both failures are the findings above |
| Liquibase on the real dev `auth_db` | all 6 changesets applied as `auth_user` under FORCE RLS; 3 planted duplicates → 1 survivor by the stated rule; 0 duplicate pairs remain |
| `detect_changes` vs pre-plan commit | 22 files, 40 symbols, 0 affected processes, risk LOW |

The auth-service IT baseline before this plan was 31; the 45 includes the 14 tests added here. The
`PrematureCloseException` / POST-IT failures plan 13-01 reported did **not** recur — with
`JAVA_HOME=openjdk@25` the whole suite is green, which confirms that diagnosis.

## Self-Check: PASSED

All 9 created files exist on disk. All 4 commits (`97b7f03`, `bb493bf`, `b02f576`, `ab7e59a`) exist
in `git log`.
