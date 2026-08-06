---
phase: 13-platform-tenant-access-repair
plan: 06
subsystem: auth-provisioning
tags: [provisioning, auth-tenants, rbac, rls, role-validation, b2, d-04, d-05, d-13]
status: complete
requires:
  - running dev stack (postgres, redis, rabbitmq, eureka) + gateway, auth-service, user-service
  - "13-02: BranchRoleAdminService.assign returning RoleAssignmentResult, is_primary, PermissionResolver.resolveForTenant"
  - "13-01: scripts/e2e/_phase13-lib.sh"
provides:
  - "POST /internal/auth/tenants (register the auth-side tenant row; idempotent upsert)"
  - "PATCH /internal/auth/tenants/{tenantId}/status (platform status vocabulary)"
  - "extended POST /internal/auth/tenants/{tenantId}/provision-admin (branchId, roleCode, fullName)"
  - AuthTenantProvisioningService (register / setStatus / toAuthStatus)
  - RoleCatalog.requireKnown + UnknownRoleCodeException (400 UNKNOWN_ROLE_CODE)
  - RoleRepository.findByCode
  - scripts/e2e/phase13-auth-provisioning-seam-e2e.sh
affects:
  - "13-10: the saga calls all three endpoints; contracts below are the ones to code against"
  - every branch-role assignment (role codes are now validated on the only write path)
  - platform-admin-service's existing provisionAdmin call, which now REQUIRES branchId + roleCode
tech-stack:
  added: []
  patterns:
    - validate a caller-supplied code in ONE helper, never per controller
    - set the RLS GUC as the first statement in the transaction, before any read or write
    - pin a structural premise (this table has no RLS) with a test, not a comment
    - an idempotent upsert must be asserted by replaying it, not by reasoning about it
    - prove a verification harness can fail before trusting that it passed
key-files:
  created:
    - services/auth-service/src/main/java/io/restaurantos/auth/service/AuthTenantProvisioningService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/RoleCatalog.java
    - services/auth-service/src/main/java/io/restaurantos/auth/exception/UnknownRoleCodeException.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/AuthTenantProvisioningIT.java
    - scripts/e2e/phase13-auth-provisioning-seam-e2e.sh
  modified:
    - services/auth-service/src/main/java/io/restaurantos/auth/service/ProvisioningAdminService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/BranchRoleAdminService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/AuthProvisioningInternalController.java
    - services/auth-service/src/main/java/io/restaurantos/auth/repository/RoleRepository.java
    - services/auth-service/src/test/java/io/restaurantos/auth/service/ProvisioningAdminServiceImpersonateTest.java
decisions: [D-04, D-05, D-12, D-13, D-29a, D-30]
requirements: [PLATFORM-01, AUTH-01, USER-02, USER-03]
metrics:
  duration: ~4h
  completed: 2026-08-07
  tasks: 3
  commits: 3
---

# Phase 13 Plan 06: Auth Provisioning Seam — Summary

The two writes that made blocker B2 fatal now exist and are proven against a database that
actually enforces RLS: the `auth_tenants` row login resolves by slug, and the OWNER branch-role
assignment without which the provisioned admin cannot log in at all. A misspelled role code no
longer persists.

**One finding you need before 13-10 and 13-15: a freshly provisioned OWNER cannot complete a login
in one step.** It is not a defect and it is not left failing — details in "The OWNER login" below.

## Contracts for plan 13-10

All three are under `/internal/auth/**`, gated by `InternalServiceFilter`'s constant-time secret,
and **unrouted at the gateway** (asserted live: 404). No gateway route was added.

### `POST /internal/auth/tenants`

```json
{"tenantId": "<uuid>", "slug": "<lowercase-slug>", "name": "Brand Name"}
```

→ **200** (on create *and* on replay — see below)

```json
{"data": {"tenantId": "...", "slug": "...", "name": "...", "status": "ACTIVE", "created": true},
 "meta": null, "warnings": []}
```

- **Always 200, never 201.** A retried saga step should not have to treat two codes as one success,
  and an upsert is not a creation on its replay. `created` carries the distinction for anyone who
  wants it.
- Keyed on `tenantId`. A changed slug updates the row in place and releases the old slug.
- **`status` is set to ACTIVE only on creation.** A replay never touches it, because the saga can
  re-run this step at any time and suspension is the platform's primary non-payment lever — forcing
  ACTIVE would let one retry silently reinstate a suspended tenant.
- Slug is lower-cased and trimmed, and must match `^[a-z0-9][a-z0-9-]{0,99}$`. That is exactly what
  `ProvisioningService.slugify` emits, so it is a no-op for the saga and a guard against a
  hand-written caller registering `Acme` and then finding nobody can log in at `acme`.
- **409 `STATE_INVALID`** when the slug is held by a *different* tenant, or the slug is malformed.

### `PATCH /internal/auth/tenants/{tenantId}/status`

```json
{"status": "SUSPENDED"}        // the PLATFORM vocabulary
```

→ **200** `{"data": {"tenantId": "...", "slug": "...", "status": "SUSPENDED", "loginAllowed": false}}`

- **404** if the tenant was never registered (a status change for an unregistered tenant is a saga
  ordering bug; creating the row silently would hide it).
- **409 `STATE_INVALID`** for a status outside the closed set.

### `POST /internal/auth/tenants/{tenantId}/provision-admin`

```json
{"email": "...", "branchId": "<uuid>", "roleCode": "OWNER", "fullName": "optional"}
```

→ **201**

```json
{"data": {"userId": "...", "tempPassword": "...", "branchId": "...", "roleCode": "OWNER",
          "mustChangePassword": true}, "meta": null, "warnings": []}
```

- `userId` and `tempPassword` keep their names and position directly under `data`, so the saga's
  existing `extractTempPassword` still works. The other three keys are additive.
- **`branchId` and `roleCode` are now REQUIRED.** The saga's current call sends only `{email}` and
  will therefore 400 until 13-10 updates it. That is deliberate: accepting the old shape would
  manufacture exactly the unusable account this endpoint exists to stop producing.
- **400 `UNKNOWN_ROLE_CODE`** (naming the code) — nothing is written.
- **409 `STATE_INVALID`** — email already exists in the tenant, or branch id missing at the service
  layer.

## The platform → auth status mapping

platform-admin-service has six statuses; `auth_tenants` has two *meanings*, because
`AuthServiceImpl.login` asks it one question: `"ACTIVE".equals(status)`.

| Platform status | Written to `auth_tenants.status` | Login allowed |
|---|---|---|
| `ACTIVE` | `ACTIVE` | **yes** |
| `PENDING_SETUP` | `PENDING_SETUP` | no |
| `SUSPENDED` | `SUSPENDED` | no |
| `CANCELLED` | `CANCELLED` | no |
| `PURGED` | `PURGED` | no |
| `PROVISIONING_FAILED` | `PROVISIONING_FAILED` | no |
| anything else | *nothing — 409* | — |

The value is carried across **verbatim** rather than collapsed to a single `INACTIVE`, so an
operator reading `auth_db` can see *why* a tenant cannot log in. All six fit the `VARCHAR(20)`
column (`PROVISIONING_FAILED` is 19 characters). The set is **closed**: an unrecognised status is
rejected, not passed through and not guessed at. Passing one through would be harmless today and
catastrophic the day someone adds a seventh whose name is ACTIVE-like; rejecting makes that addition
a loud event. The mapping lives in one method, `AuthTenantProvisioningService.toAuthStatus`.

## How I convinced myself this works against a database that really enforces RLS

The plan warned that superusers hide RLS defects on new internal write paths, and it was right —
there was one, on the path this plan extends.

**The RED, measured against the running dev stack before any change.** `auth_user` on the live
`auth_db` is `rolsuper=false rolbypassrls=false`. Driving the existing endpoint:

```
POST /internal/auth/tenants/a0000001-…/provision-admin   →  HTTP 500
{"error":{"code":"INTERNAL_ERROR", …}}
rows written: 0
```

Reproduced directly to name it:

```
INSERT INTO users (…) VALUES (…);
ERROR:  new row violates row-level security policy for table "users"
```

`users` is `FORCE ROW LEVEL SECURITY` on `app.current_tenant_id`, there is no JWT on `/internal/**`,
so `JwtAuthenticationFilter` never populates `TenantContext` and `TenantAwareDataSource` set no GUC.
**`provisionAdmin` had never once worked against a database that enforces RLS** — the same class of
defect 13-02 found on two other methods (`ab7e59a`); this one was missed then. Every test passed
regardless, because Testcontainers' Postgres user is a SUPERUSER. Fixed by making `setTenantGuc` the
first statement in the transaction.

**Three independent things now hold it in place:**

1. **Measured DDL, not assumed.** `auth_tenants`: `relrowsecurity=false, relforcerowsecurity=false`
   — so `AuthTenantProvisioningService` setting *no* GUC is correct rather than a repeat of the same
   bug. `users`, `roles`, `user_branch_roles`: all `true/true`.
2. **The premise is pinned by a test, not a comment.**
   `AuthTenantProvisioningIT.authTenants_isNotRowLevelSecurityScoped` reads `pg_class` and fails if
   anyone ever enables RLS on that table — at which point the javadoc explaining why no GUC is set
   would otherwise become an actively misleading lie.
3. **The writes are asserted over live HTTP against `auth_user`.** The seam script provisions an
   admin through the real endpoint and then reads the row back with the GUC set, as `auth_user`:
   `OWNER:true:true`. A superuser-backed test cannot vouch for that; this can.

`auth_tenants` deliberately sets no GUC and the javadoc says why — it is the pre-tenant-context
lookup login performs *before* any tenant context can exist.

## The OWNER login — read this before 13-10 and 13-15

A freshly provisioned OWNER is answered **`401 TOTP_ENROLLMENT_REQUIRED`**, not a token.

OWNER holds `rbac.manage`; `AuthServiceImpl.requiresTotpStepUp` fires on it; the new account has no
enrolled secret. This is **D-29a working exactly as decided** ("TOTP enrolment becomes part of
tenant-admin creation, so the admin has a factor before they first need it"), so I did not suppress
it, weaken the step-up rule, or change the role's grants.

**For blocker B2 this is good news, and the reason is structural.** `enforceTotpStepUp` runs *after*
`permissionResolver.resolveDefault`. So reaching TOTP_ENROLLMENT_REQUIRED is itself proof that the
branch assignment resolved — the failure B2 is about happens strictly earlier. The test and the
script both assert on that distinction rather than on a status code: the response must **not**
contain `no active branch assignments` and must **not** be a credential rejection.

**What later plans must do about it:**

- **13-10** — the saga must not treat a 401 from a post-provisioning login smoke-check as a
  provisioning failure. A token, a TOTP-enrolment demand, and (once 13-08 lands) a forced-change
  response all mean provisioning succeeded.
- **13-15** — the seed script's tenant-admin personas need TOTP enrolled or their login verification
  fails on exactly the persona that matters most. 13-05 already flagged this; it is now demonstrated
  end to end. The seam script contains a working, dependency-free recipe: `POST
  /api/v1/auth/2fa/bootstrap` → parse `secret` out of the `otpauthUri` → `POST
  /api/v1/auth/2fa/bootstrap/verify` with a code → login with `totpCode`. Both bootstrap paths are
  public at the gateway and re-verify the password on every call.

The script walks that whole flow and ends holding a real token with `roles: [OWNER]` and **64**
permission codes.

## Task-by-task

### Task 1 — the tenant row (D-04)

`AuthTenantProvisioningService.register` / `setStatus`, plus two endpoints. Both timestamps are set
explicitly: the entity declares them non-null with no auditing callback, and a JPA insert never
omits a column, so the changelog defaults never apply.

The slug collision is detected with an explicit `findBySlug` and raised as `STATE_INVALID`, rather
than left to the unique index — a `DataIntegrityViolationException` reaches the saga as a generic
409 `CONFLICT` it cannot distinguish from any other integrity failure.

**RED:** 13 run, **9 real failures**. Three of the four "passes" were vacuous and are worth naming:
the two `403` gate assertions and the `404` unknown-tenant assertion all hold against an endpoint
that does not exist, because `InternalServiceFilter` runs before routing. Only
`authTenants_isNotRowLevelSecurityScoped` was a genuine green.

### Task 2 — the admin who can log in (D-05, D-12, D-13)

`provisionAdmin` now writes the user **and** the assignment in one transaction, delegating to
`BranchRoleAdminService.assign` rather than writing the row itself, so 13-02's
one-active-role-per-branch and primary-flag invariants keep their single owner. `assign` marks a
user's first assignment primary, which is what makes the new admin's default branch deterministic
after 13-02 removed the hardcoded HQ uuid.

**The rollback assertion is not decorative.** Two plausible mistakes are invisible on the happy
path: `assign` reached with `REQUIRES_NEW`, or the failure caught so "provisioning makes progress".
Either leaves a user with no assignment — an account that looks provisioned and cannot log in, which
is precisely B2. Forcing the second write to fail needs a stub (`@MockitoSpyBean`), because there is
no *input* that passes role validation and then fails at the database — itself a good property.

**D-13** is applied in `RoleCatalog.requireKnown`, called from both doors that accept a caller
-supplied code, rather than duplicated per controller. Ordering inside `assign` matters twice:
*after* the GUC (a tenant's own custom role is invisible without it and would be rejected as
unknown) and *before* the displacement loop (a rejected assignment must not revoke the role the user
already holds — asserted).

Two things the plan did not ask for, both Rule 2:

- **An empty role catalog is reported as a misconfigured database, not a bad role code.** System
  roles are seeded by changeset 035 under Liquibase context `seed` (`LIQUIBASE_CONTEXTS`, default
  `seed`). A deployment narrowing that variable gets an empty `roles` table, at which point this new
  validation would reject *every* code including OWNER and make provisioning impossible for every
  tenant — while reporting "unknown role code: OWNER" and sending an operator after a typo that is
  not there. Costs one query, on the failure path only.
- **`findByCode` returns a `List`, not an `Optional`.** The unique constraint is `(tenant_id, code)`,
  so a code can legitimately exist twice — once as a system role with a null tenant, once as a
  tenant override — and the RLS policy makes both visible at once. An `Optional` finder would throw
  `IncorrectResultSizeDataAccessException` instead of validating, which is the exact failure 13-02
  had to remove from the login path.

**Rule 1, beyond the RLS fix:** the email was stored verbatim while login lower-cases before lookup,
so an admin provisioned as `Owner@x` could never be found — another silently-unusable account. Now
normalised on write, and the duplicate check sees through casing.

**RED:** 25 run, **10 failures**.

### Task 3 — proved live (D-30)

`scripts/e2e/phase13-auth-provisioning-seam-e2e.sh` — **19 PASS / 0 FAIL, exit 0, three consecutive
runs**, with auth-service rebuilt (jar 00:04) and restarted (pid 44308, 00:05:02) first, so the
process is newer than its jar.

Deterministic uuid5 tenant id and a fixed slug, cleaned both in an `EXIT` trap and at start-up (a
run killed between steps would otherwise leave rows that make "already exists" look like a defect).
Verified afterwards: 0 rows left behind.

TOTP is computed in pure stdlib — `pyotp` is not installed on this machine's `python3`, and
`T-13-06-SC` forbids installing a package to make a verification script run.

**I verified the harness can fail before trusting that it passed.** With `GATEWAY` pointed at a dead
port: 5 FAILs, **exit 1**, trap still cleaned up.

## Deviations from plan

**1. [Rule 1 — bug] `provisionAdmin` never set the RLS tenant GUC.** Not in the plan; found by
driving the real endpoint against the real stack, which returned 500 and wrote nothing. Full detail
above. Commit `7609a0d`.

**2. [Rule 1 — bug] The provisioned email was stored without normalisation.** Login lower-cases
before lookup. Commit `7609a0d`.

**3. [Rule 2 — availability] The empty-role-catalog guard.** Described above. Commit `7609a0d`.

**4. [Scope — file list] `AuthInternalController.java` was listed as modified and was not touched.**
The plan said to apply role validation "in every path that accepts a role code from a caller: … and
the branch-role assign endpoint on `AuthInternalController`". Validation went into
`BranchRoleAdminService.assign` instead — one line further down the same call chain. That covers the
controller *and* every future caller of the only sanctioned write path, whereas a check in the
controller would have to be re-added by whoever writes the next one. Same reasoning 13-01 recorded
for authority derivation.

**5. [Scope — new files] Three files beyond the plan's list:** `RoleCatalog` (the validation helper
the plan asked for, given its own class so both call sites share it), `UnknownRoleCodeException`
(the plan's behaviours require **400** naming the code, but the codebase's `StateInvalidException`
maps to **409**; this mirrors 13-01's `InvalidPlatformRoleException`, which maps to 400 via
`handleBase`), and `deferred-items.md`.

**6. [Scope] `ProvisioningAdminServiceImpersonateTest` needed a constructor update** — two new
collaborators, passed as nulls since `impersonate` does not use them, keeping that test about the
GUC-ordering it exists to pin.

**7. [Out of plan scope, no tracked file touched] 332 macOS `" 2"` duplicate files under `target/`**
broke the final `mvn verify` with `io/restaurantos/auth/integration/TestFixtures 2 (wrong name: …)`.
Same stale build output 13-01 hit (its deviation #6). Deleted only the `" 2"` paths inside `target/`;
confirmed first that no tracked or untracked file outside `target/` matched.

**8. [Out of plan scope] auth-service restarted** onto the new jar for task 3's human-check.
user-service and gateway were left alone — neither was rebuilt.

## Verification actually run

Every number is from a command executed in the state being reported, with
`JAVA_HOME=openjdk@25`, `TESTCONTAINERS_RYUK_DISABLED=true`,
`TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`.

| Suite | Result |
|---|---|
| `mvn -pl services/auth-service -am verify` | **BUILD SUCCESS** |
| ├ auth-service unit | **24/24** |
| ├ auth-service IT | **85/85** (was 59; `AuthTenantProvisioningIT` adds 26) |
| │  ├ `AuthTenantProvisioningIT` | **26/26** |
| │  ├ `AuthLoginIT` | 3/3 |
| │  ├ `AuthInternalBranchRoleIT` | 7/7 |
| │  └ `TempPasswordPolicyTest` (unit) | **3/3** — `78351de` kept green, untouched |
| └ shared-lib | unit **38/38**, IT **11/11** |
| `bash scripts/e2e/phase13-auth-provisioning-seam-e2e.sh` | **19 PASS / 0 FAIL, exit 0** ×3 consecutive |
| same script, `GATEWAY` at a dead port | **5 FAIL, exit 1** — the harness can fail |
| `opa test policies/` | **139/139** (no `.rego` touched) |
| Live `provision-admin` BEFORE the fix, vs `auth_user` (NOSUPERUSER NOBYPASSRLS) | **500**, 0 rows — `new row violates row-level security policy for table "users"` |
| Live RLS posture | `auth_tenants` false/false; `users`, `roles`, `user_branch_roles` true/true |
| `detect_changes` before each commit | 1 file / 6 files, **0 affected processes, risk LOW** |

### Not green, and not mine

Both verified by stashing this plan's changes and re-running:

- **`user-service` `UserAdminDelegationIT`** — intermittent `NoHttpResponse` on WireMock's admin
  API. The first paired comparison looked like causation (3/3 fail with my changes, 1/1 pass
  without); re-running the **pre-plan tree three times gave 1 pass / 2 failures**, so it is flaky and
  unrelated. This plan touches no user-service file.
- **`platform-admin-service`** — **40 run, 5 failures, 11 errors**, *identical* with and without this
  plan's changes. Every error is the silent-EOF symptom against WireMock. Its ITs stub auth-service
  rather than calling it, so nothing here can reach them.

Both are the wildcard-bind / macOS Application Firewall condition the runbook documents, in test
harnesses that bind WireMock rather than Tomcat. Logged with the one-line remedy in
`deferred-items.md`; not fixed, because both files are outside this plan's scope.

`ProvisioningSagaIT`'s `Tests run: 0` display artifact was left alone as instructed.

### GitNexus impact, run before editing (per CLAUDE.md)

| Target | Upstream | Risk |
|---|---|---|
| `ProvisioningAdminService` | 2 (`AuthProvisioningInternalController` file + constructor) | LOW |
| `BranchRoleAdminService` | 2 (`AuthInternalController` file + constructor) | LOW |
| `RoleRepository` | **0** | LOW |
| `AuthTenantRepository` | 7 (6 direct: `PasswordResetService`, `AuthServiceImpl`, …) | MEDIUM |
| `AuthProvisioningInternalController` | 0 | LOW |

The MEDIUM on `AuthTenantRepository` is the one that mattered and it is understated in the same way
13-01's `GlobalFilter` result was: `AuthServiceImpl.login` is a *reader* of this table on every
single login, so the real blast radius of changing what gets written to `auth_tenants` is every
authentication in the system. Treated accordingly — hence the status mapping being a closed set, the
before/after login contrast on suspension, and the "does not reactivate" replay test.

The index is stale (last built at `5fba4a9`). Not refreshed, for the reason 13-01 through 13-05 all
gave: `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files, which 13-01 had to
revert.

## Known stubs

None. Every symbol this plan created is wired and exercised — by an integration test, a live HTTP
assertion, or both.

## Threat flags

None beyond the plan's register. Where each entry is closed:

- **T-13-06-A** (internal endpoints) — `InternalServiceFilter`'s constant-time secret is untouched
  and unweakened; no gateway route was added. Asserted live: **403** with no secret, **404** through
  the gateway. Plus two IT gate cases.
- **T-13-06-B** (unvalidated role code) — `RoleCatalog.requireKnown` on both doors; 400 naming the
  code; asserted to leave no rows and not to displace an existing assignment; a known code still
  succeeds, so the validator cannot pass by rejecting everything. Live: 400 + no user row + a login
  that 401s.
- **T-13-06-C** (temp password) — returned once in the response; never logged, never persisted
  plaintext, never in an event payload. A comment at the site says so, and the result record carries
  a warning not to log it whole. 13-10's live script still owes the outbox grep.
- **T-13-06-D** (admin with no assignment) — one transaction, proved by a rollback test that stubs
  the second write, and live by reading back `OWNER:true:true` as `auth_user`.
- **T-13-06-E** (slug collision) — explicit `findBySlug`, 409 `STATE_INVALID` naming the slug;
  asserted to leave nothing behind and not to overwrite the incumbent.
- **T-13-06-F** (status mapping) — one method, closed set, all five non-ACTIVE statuses asserted to
  refuse a login *after* the same account logged in successfully; an unrecognised status is rejected
  and not written.
- **T-13-06-SC** — did not arise. **No package of any kind was installed**, in any ecosystem; the
  TOTP helper is pure stdlib precisely to keep it that way.

One flag worth recording: **the extended `provision-admin` is a breaking change to an existing
internal contract.** platform-admin-service's saga still sends `{email}` alone and will now receive
400 until 13-10 lands. Deliberate, and stated in the contract section above.

## Self-Check: PASSED

All 5 created files exist on disk. All 3 commits (`107e1a2`, `7609a0d`, `ebc611b`) exist in
`git log`.
