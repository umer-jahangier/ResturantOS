---
phase: 13-platform-tenant-access-repair
plan: 07
subsystem: auth-rbac
tags: [rbac, role-catalog, permissions, d-14, d-13, rls, privilege-escalation, gateway-routing, grant-drift]
status: complete
requires:
  - running dev stack (postgres, redis, rabbitmq, eureka) + gateway, auth-service, user-service
  - "13-02: the WAITER role, and the rbac.user.manage / rbac.role.manage / branch.manage split"
  - "13-06: RoleCatalog.requireKnown + 400 UNKNOWN_ROLE_CODE on the only branch-role write path"
  - "13-01: scripts/e2e/_phase13-lib.sh"
provides:
  - "GET /api/v1/roles — the roles the CALLER may assign, each with code, name, system flag and sorted permission codes"
  - "GET /api/v1/permissions — the whole permission vocabulary, grouped by module"
  - RoleCatalogService (listAssignableRoles / listPermissionsByModule)
  - RoleCatalogController
  - RoleCatalogDtos (RoleEntry, AssignableRoles, PermissionEntry, PermissionModule)
  - PermissionRepository
  - RoleRepository.findVisibleToTenant
  - RolePermissionRepository.findRolePermissionPairs
  - "gateway role-catalog-route (general rate limit, authCircuitBreaker)"
  - "changeset 057: OWNER holds the whole permission catalogue; TENANT_ADMIN all but rbac.manage"
  - scripts/e2e/phase13-role-catalog-e2e.sh
affects:
  - "13-12: the public user API consumes both endpoints, and owns BOTH open findings below"
  - "13-15: the seed script can discover valid role codes instead of hardcoding them"
  - "every role assignment: changeset 057 gives OWNER and TENANT_ADMIN one permission each they lacked"
tech-stack:
  added: []
  patterns:
    - derive an authorization rule from the data it is about, never from a list in code
    - enforce tenant isolation in the QUERY as well as the RLS policy, because Testcontainers runs as a superuser and the policy is inert there
    - report a withheld thing as a COUNT, so it does not vanish silently and does not republish what was withheld
    - build a shell JSON body from key/value ARGUMENTS, so no call site contains a brace to expand
    - pair every negative assertion with a control that fails if the predicate under test is broken
key-files:
  created:
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/RoleCatalogController.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/RoleCatalogService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/repository/PermissionRepository.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/response/RoleCatalogDtos.java
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/057-repair-administration-role-grant-drift.xml
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/RoleCatalogIT.java
    - gateway/src/test/java/io/restaurantos/gateway/filter/RoleCatalogRouteTest.java
    - scripts/e2e/phase13-role-catalog-e2e.sh
  modified:
    - services/auth-service/src/main/java/io/restaurantos/auth/repository/RoleRepository.java
    - services/auth-service/src/main/java/io/restaurantos/auth/repository/RolePermissionRepository.java
    - services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml
    - gateway/src/main/resources/application.yml
    - gateway/src/main/java/io/restaurantos/gateway/filter/JwtGlobalFilter.java
decisions: [D-13, D-14, D-29a, D-30]
requirements: [USER-02, USER-03, GW-02]
metrics:
  duration: ~40m
  completed: 2026-08-07
  tasks: 3
  commits: 5
---

# Phase 13 Plan 07: Role & Permission Catalog — Summary

A tenant admin can now discover the role codes 13-06 made mandatory, through the real gateway, and
is offered only roles it could hold itself. Two things are **left failing on purpose**, both
measured over live HTTP rather than asserted from source, and both belong to 13-12.

## The two endpoint paths (13-12 and 13-15 consume these)

| Method | Path | Gate | Answers |
|---|---|---|---|
| `GET` | `/api/v1/roles` | `hasAnyAuthority('rbac.manage', 'rbac.user.manage')` | the roles **this caller may assign** |
| `GET` | `/api/v1/permissions` | same | the whole permission vocabulary, grouped by module |

```jsonc
// GET /api/v1/roles
{"data": [{"code": "WAITER", "name": "Waiter", "system": true,
           "permissions": ["pos.kds.view", "pos.menu.view", "pos.order.create", …]}],
 "meta": null,
 "warnings": [{"code": "ROLES_WITHHELD_ABOVE_CEILING",
               "message": "1 role(s) were withheld because they grant permissions you do not hold…"}]}

// GET /api/v1/permissions
{"data": [{"module": "branch",
           "permissions": [{"code": "branch.manage", "module": "branch", "description": "…"}]}],
 "meta": null, "warnings": []}
```

Everything is sorted — roles by code, permissions by module then code — so two reads are diffable.
Measured live: **7 roles offered to a tenant admin, 10 modules, 65 permission codes.**

## The gateway routing decision

**A dedicated `role-catalog-route`, not an extra prefix on `auth-route`.** The plan preferred
folding it into the auth route and named the escape hatch; this is the escape hatch.

`auth-route`'s budget is `replenishRate=2/s, burst=RATE_LIMIT_AUTH_PER_MIN=100`, deliberately tight
because it fronts a credential endpoint. That bucket is keyed on **IP**, and a restaurant's back
office is one NAT'd IP. Putting an admin page's two catalog reads in it means catalog traffic spends
**login's** tokens, and the failure that produces is not a slow role picker — it is nobody in the
building being able to log in. The new route takes the general `default-filters` budget (600/min).

Same `authCircuitBreaker` as `auth-route` and `jwks-route`: the upstream *is* auth-service and its
health is one fact, not three. Its existing 5s time limiter already covers a cold-JIT first call, so
no new resilience4j instance was needed and `GatewayResilienceConfigTest` stays green.

Both the bare path and the `/**` form are listed in the predicate. `PathPattern` does treat `/foo/**`
as matching `/foo`, but these two endpoints **are** the bare paths — a routing rule whose
correctness rests on a subtlety of the matcher, for the only requests it will ever serve, is not
worth the two entries it costs to remove the question.

Nothing was added to `PUBLIC_PATHS`, `TENANT_OPTIONAL_PATHS` or `RouteFeatureMap`.
`RoleCatalogRouteTest` asserts all three negatives **by name**, each with a control assertion so it
cannot pass by the predicate under test being broken. `JwtGlobalFilter.isPublicPath` drops from
private to package-private for that, mirroring `isTenantOptionalPath`.

## The ceiling — the plan did not ask for this, and the alternative is a hole

**A role is returned only if every permission it grants is one the caller already holds.**

Without it the picker is a privilege-escalation control. TENANT_ADMIN deliberately does not hold
`rbac.manage` — 13-02 split the authority precisely so that it would not — but it does hold
`rbac.role.manage`. Offered OWNER, it could assign OWNER to an account it controls, log in as that
account, and hold the umbrella permission its own role was designed to withhold.

**Derived from `role_permissions`, never enumerated.** A hardcoded "TENANT_ADMIN may not assign
OWNER" would be right today and wrong the moment someone adds a role, which is the drift class this
repo has hit five times over permission codes alone. Proved by mutation against the live database:

```
baseline (TENANT_ADMIN without rbac.manage) → 7 roles, ROLES_WITHHELD_ABOVE_CEILING
+ INSERT ('TENANT_ADMIN','rbac.manage')     → 8 roles including OWNER, no warning
- DELETE it again                            → 7 roles, warning back
```

`role_permissions` back to 232 rows afterwards, split intact.

**Withheld roles are reported as a COUNT, never as names.** Naming them republishes exactly what the
ceiling withholds; a bare silence turns "why is OWNER missing from my picker" into a support ticket.

**It fails closed, and loudly** — which is how it found a real bug within a minute of first running.

## The bug the ceiling found: OWNER could not assign CASHIER

Changeset 036 defines OWNER as holding every permission and TENANT_ADMIN as every permission except
`rbac.manage`, and implements that by `SELECT`ing from `permissions` **at the moment 036 runs**.
Changeset 034 was edited after it had already run on existing databases, so:

- a **fresh** database declares `pos.order.void.own` in 034 and 036's SELECT picks it up for both;
- a database that ran the **original** 034 receives that code later, from 049's repair — which
  grants it to MANAGER and CASHIER only. Neither administration role ever gets it.

Measured on the live dev `auth_db`, 65 permissions in the catalogue: **OWNER 64, TENANT_ADMIN 63,
and the single missing code identical for both.**

Nothing about voiding was broken — every gate and Rego rule allows a void on `.own` **or** `.any`,
and both roles hold `.any`. What broke is anything that *reasons over the grant lattice*. Under the
ceiling rule this one absent row made CASHIER and MANAGER unassignable **by OWNER**, on the grounds
that a cashier can void their own order and the owner of the restaurant cannot:

```
before 057   5 roles offered to a tenant admin, 3 withheld  (OWNER + CASHIER + MANAGER)
after  057   7 roles offered,                   1 withheld  (OWNER, correctly)
```

**Changeset 057** repairs it in the 049 shape — `INSERT … SELECT … ON CONFLICT DO NOTHING`, a no-op
on a fresh database and a repair on one that could not. Applied to the live `auth_db` by Liquibase
running as `auth_user` (`NOSUPERUSER NOBYPASSRLS`): `exectype=EXECUTED`, `role_permissions`
**230 → 232** rows, exactly the two predicted, TENANT_ADMIN still without `rbac.manage`. A `DO`
block `RAISE`s with the reason if it does not converge, and
`RoleCatalogIT.theAdministrationRolesHoldTheWholeCatalogue` fails on the branch that adds a
permission without back-granting it — which is where the picker would otherwise start quietly
withholding roles. No rollback: reversing it means revoking permissions the changelog says these
roles hold, and on a fresh database it could not tell 036's rows from its own.

## Row-level security: the plan's premise was two-thirds right

The plan instructed the javadoc to say all three tables are global and need no tenant GUC. Measured
on the live `auth_db` rather than assumed:

| table | `relrowsecurity` | `relforcerowsecurity` |
|---|---|---|
| `permissions` | false | false |
| `role_permissions` | false | false |
| **`roles`** | **true** | **true** |

`roles` is RLS-scoped under
`tenant_id IS NULL OR tenant_id = NULLIF(current_setting('app.current_tenant_id',true),'')::uuid`
(changesets 032 and 053). So the javadoc says that instead. Both endpoints arrive with a JWT, so
`JwtAuthenticationFilter` has populated `TenantContext` and `TenantAwareDataSource` has already set
the GUC; the service sets none itself, for the same reason `RoleCatalog` does not — a class that
sets the GUC for its own read lets a caller skip it on the surrounding work while still passing.

**And it does not rely on that policy for isolation.** `RoleRepository.findVisibleToTenant` carries
the `tenant_id` predicate in the query. Testcontainers' Postgres user is a SUPERUSER, so the policy
is **inert in every integration test in this repository** — a catalog leaning on it alone would be
untested by construction, which is exactly how `ab7e59a` and `7609a0d` shipped broken. Two
independent controls, one of them assertable in CI, and the live script asserts the other by writing
a neighbouring tenant's role **with that tenant's GUC** (without it the INSERT is refused and the
isolation assertion would prove nothing) and then confirming the row exists and the response
excludes it.

## Left failing, deliberately — both are 13-12's

### 1. A TENANT_ADMIN can still *assign* OWNER

```
POST /api/v1/users/{id}/branch-roles  {"roleCode":"OWNER"}   →  200
{"data":{…,"roleCode":"OWNER","displacedRoleCode":"CASHIER"}}
```

The catalog withholds the role. The write path does not check. That account can then log in holding
`rbac.manage`.

The check needs **the caller's** permission set (only user-service has it, from the JWT) and **the
target role's** (only auth-service has it, from `role_permissions`). Closing it therefore means
propagating caller identity across the `/internal/auth/**` seam **13-06 published three commits ago
and 13-10 is about to code against** — a breaking change to a cross-service contract, which is a
deviation Rule 4 decision rather than an executor's. It is reported with a live measurement instead
of smuggled in, and the script FAILs on it so it cannot be forgotten.

**Recommended fix (for 13-12, which owns the public user API).** Enforce in `BranchRoleAdminService`,
not user-service: give `POST /internal/auth/users/{id}/branch-roles` an acting-user identity and
recompute that user's permissions server-side via `PermissionResolver.resolveForTenant` — better
than trusting a forwarded claim, because it cannot be stale. Make it **required** rather than
optional; an optional header that disables a security check when omitted fails open, silently.
`provisionAdmin` is unaffected: it calls `assign` in-process, not through the endpoint, and is
genuinely system context. 13-02's `phase13-roles-e2e.sh` would need its `assign_role` helper updated
at the same time.

### 2. 13-06's `400 UNKNOWN_ROLE_CODE` reaches the client as `500`

```
internal:  POST /internal/auth/users/{id}/branch-roles  {"roleCode":"NOT_A_REAL_ROLE"}  →  400  ✅
public:    POST /api/v1/users/{id}/branch-roles          same body                       →  500  ❌
           {"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred"}}
```

`AuthInternalClient` has no `ErrorDecoder`, so `FeignException.BadRequest` falls through
user-service's generic handler. The plan's acceptance criterion "a code absent from the catalog is
rejected with 400" holds on the door 13-06 built and is lost on the door a client uses, and a role
picker cannot distinguish "you chose a bad role" from "the platform broke". One `ErrorDecoder` (or
an `@ExceptionHandler(FeignException.class)` that re-emits 4xx) fixes it — in user-service, which
this plan does not own.

## The harness

`scripts/e2e/phase13-role-catalog-e2e.sh` — **26 PASS / 2 FAIL, exit 1**, reproduced back to back
and again after restarting both services onto their current jars. Exit 1 with the gateway pointed at
a dead port too, so a failure to reach anything is not reported as success.

**It enrols its own second factor.** The tenant-admin persona's factor is cleared and re-enrolled
over the **public** `/2fa/bootstrap` → `/2fa/bootstrap/verify` endpoints, then stepped up (D-29a,
13-06's recipe, TOTP in pure stdlib because `pyotp` is not installed and `T-13-07-SC` forbids
installing one). 13-02's script needed `generate_totp.py --enroll` run by hand first and **skipped**
its administration assertions when that had not happened — a verification script whose most
important assertions silently do not run. Nothing about the step-up rule is weakened: the persona
still enrols and still presents a code.

It reuses 13-02's tenant-admin and waiter personas by addressing the **same deterministic uuid5
rows**, rather than creating a parallel set that would drift from them. The disposable assignment
target is cleaned in an `EXIT` trap *and* before starting — a run killed midway would otherwise make
the next run's "already exists" look like a defect in the code under test. Verified afterwards: 0
rows left behind, on both tenants.

**A shell bug worth recording, because 13-02's stated remedy for it is not sufficient.** 13-02
documented that `-d "{\"a\":1,\"b\":2}"` written inline is brace-expanded and prescribed "build the
body in a variable first". That does not fix it: inside `"$( … )"` the substitution's contents are
re-parsed *after* the backslashes are stripped, so `X="$(json "{\"a\":\"1\"}")"` hands the helper a
string whose quotes have already been consumed, leaving the braces and comma bare. First run of this
script: three `JSONDecodeError`s and `curl: option : blank argument`. `json_obj` now builds the
object from key/value **arguments**, so no call site contains a brace at all.

## Deviations from plan

**1. [Rule 2 — security] The ceiling filter.** Not in the plan; without it the catalog is a
privilege-escalation control. Full detail above. Commit `8523a21`.

**2. [Rule 2 — security] Tenant isolation enforced in the query, not only by RLS.** The plan's
javadoc instruction would have left the only control inert under every test in the repository.
Commit `8523a21`.

**3. [Rule 1 — bug] Changeset 057, the OWNER/TENANT_ADMIN grant drift.** Not in the plan, and not
findable without the ceiling rule. Commit `8a2ac3d`.

**4. [Scope — file list] Three files beyond the plan's list.** `gateway/.../JwtGlobalFilter.java`
(one modifier, so the "these paths are not public" assertion can exist),
`gateway/src/test/.../RoleCatalogRouteTest.java`, and
`db/changelog/v1.0.0/057-*.xml` + its `db.changelog-master.xml` include.

**5. [Plan text corrected] "These tables are global … so no tenant GUC is required."** True for two
of the three; `roles` is `FORCE ROW LEVEL SECURITY`. Measured, and the javadoc says the measured
thing.

**6. [Rule 4 — declined, reported instead] The assign-side ceiling and the Feign 400→500.** Both
described above. Both need user-service or a cross-service contract change; both are 13-12's.

**7. [Out of plan scope, no tracked file touched] 20 macOS `" 2"` duplicate files under `target/`**
broke `mvn verify` with `io/restaurantos/auth/integration/TestFixtures 2 (wrong name: …)` — the same
stale build output 13-01 (deviation #6) and 13-06 (deviation #7) hit. Deleted only the `" 2"` paths
**inside `target/`**, having first confirmed no *tracked* file matches (`git ls-files | grep " 2\."`
is empty; the matches outside `target/` are all under `frontend/.next`, `frontend/coverage` and
`.gitnexus`, none of them touched).

**8. [Out of plan scope] auth-service and gateway rebuilt and restarted** — twice for auth-service
(once for the code, once for changeset 057), and once more for both at the end so the reported e2e
numbers come from processes newer than their jars. `mvn verify` rewrites the fat jar under the
running JVM, which is the `NoClassDefFoundError` the runbook describes. user-service was **not**
rebuilt or restarted; nothing in it changed.

## Verification actually run

Every number is from a command executed in the state being reported, with
`JAVA_HOME=openjdk@25`, `TESTCONTAINERS_RYUK_DISABLED=true`,
`TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`.

| Suite | Result |
|---|---|
| `mvn -pl services/auth-service -am verify` | **BUILD SUCCESS** |
| ├ auth-service unit | **24/24** |
| ├ auth-service IT | **96/96** (was 85; `RoleCatalogIT` adds 11) |
| │  └ `RoleCatalogIT` | **11/11** |
| └ shared-lib | unit **38/38**, IT **11/11** |
| `mvn -pl gateway -am verify` | **BUILD SUCCESS** — unit **51/51**, IT **15/15** |
| ├ `GatewayRoutingIT` | 5/5 |
| ├ `FeatureFlagFilterIT` | 10/10 |
| ├ `GatewayResilienceConfigTest` | 3/3 |
| └ `RoleCatalogRouteTest` | **8/8** |
| `PermissionCatalogClosureTest` with the new gate expressions | **2/2** |
| `opa test policies/` | **139/139**, coverage **100.00%** (no `.rego` touched) |
| `bash scripts/e2e/phase13-role-catalog-e2e.sh` | **26 PASS / 2 FAIL, exit 1** — both failures are the findings above; reproduced on a second consecutive run and again after restarting both services |
| same script, `GATEWAY` at a dead port | **exit 1** — the harness cannot report success against nothing |
| RED before implementing | **10 run, 7 real failures**; the other three passed vacuously (see below) |
| Changeset 057 on the live `auth_db` as `auth_user` (NOSUPERUSER NOBYPASSRLS) | `exectype=EXECUTED`, `role_permissions` 230 → 232, OWNER/TENANT_ADMIN missing-count 1 → 0, `rbac.manage` still off TENANT_ADMIN |
| Live RLS posture | `permissions` false/false, `role_permissions` false/false, `roles` **true/true** |
| Ceiling mutation, live | grant `rbac.manage` → OWNER appears, warning gone; revert → OWNER gone, warning back; 232 rows restored |
| Trap cleanup | 0 target users, 0 neighbour roles, 0 `CATALOG_PROBE_*` roles left on either tenant |

### The RED's three vacuous passes, named

Worth recording because 13-06 found the same shape and it is how a red can flatter itself:
`withoutAToken_return401` (the security chain 401s before routing, so it holds for any absent path),
`carriesNoUserTenantOrAssignmentData` (a 404 body contains no tenant id either) and
`neverReturnsAnotherTenantsRole` (an empty list contains nothing). Only once the endpoints answered
200 did those three start measuring anything.

### GitNexus, run before editing (per CLAUDE.md)

| Target | Upstream | Risk |
|---|---|---|
| `RolePermissionRepository` | 3 (2 direct: `PermissionResolver` file + constructor) | LOW |
| `RoleRepository` | **0** | LOW |

Both were **additive only** — no existing method's signature or behaviour changed — so
`PermissionResolver`'s presence on the login path is not in the blast radius.

**`gitnexus detect-changes` could not be used and I am not reporting a clean result from it.** It
answered `No changes detected` for `--scope unstaged`, `all`, `staged` and `compare --base-ref HEAD`
alike, against a working tree with three staged modifications — so its silence carries no
information. The index is stale (last built at `5fba4a9`) and was not refreshed, for the reason
13-01 through 13-06 all gave: `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill
files, which 13-01 had to revert. Scope was reviewed with `git diff --cached --stat` before each
commit instead, and every commit's file list is in its message.

## Known stubs

None. Every symbol this plan created is wired and exercised — by an integration test, a live HTTP
assertion, or both.

## Threat flags

Where each register entry is closed:

- **T-13-07-A** (the catalog enumerates the authorization surface) — both endpoints gated on
  `hasAnyAuthority('rbac.manage','rbac.user.manage')`; live **401** anonymous and **403** for a
  waiter on each, plus the same two cases as ITs, plus `RoleCatalogRouteTest` asserting neither path
  is in `PUBLIC_PATHS` with a control that the predicate still recognises a genuinely public one.
- **T-13-07-B** (cross-tenant leakage) — upgraded from `accept` to `mitigate`: the register assumed
  the tables were global and `roles` is not. Enforced in the query *and* by the RLS policy; asserted
  by an IT (where the policy is inert) and by the live script (where it is not), both with a control
  proving the neighbour's row exists. Responses additionally asserted to contain no tenant id, user
  id, branch id or email.
- **T-13-07-C** (catalog drifting from what assignment accepts) — both read the same three tables;
  the live script assigns **every one of the seven advertised codes** and asserts an unknown code is
  refused. The closure between the two responses is asserted live as well.
- **T-13-07-D** (N+1 on the role list) — exactly two queries, asserted by spying both repositories
  and **re-asserting after inserting twelve more roles**, so "bounded" means bounded rather than
  "small today".
- **T-13-07-E** (feature-gating role discovery) — `RoleCatalogRouteTest` asserts `RouteFeatureMap`
  returns nothing for either path, with a control that it still gates `/api/v1/finance/`.
- **T-13-07-SC** — did not arise. **No package of any kind was installed**, in any ecosystem; the
  TOTP helper is pure stdlib precisely to keep it that way.

One flag beyond the register, recorded above and unresolved: **the write path has no ceiling check**,
so the escalation the catalog closes on the read side is open on the write side. It is measured live
and left RED rather than claimed fixed.

## Self-Check: PASSED

All 8 created files exist on disk. All 5 commits (`71007ae`, `8523a21`, `057ad15`, `8a2ac3d`,
`a5a0800`) exist in `git log`.
