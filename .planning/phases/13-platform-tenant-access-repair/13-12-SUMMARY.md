---
phase: 13-platform-tenant-access-repair
plan: 12
subsystem: public-tenant-admin-user-api
tags: [user-lifecycle, b3, sc3, d-11, d-13, error-decoder, tenant-isolation, role-ceiling, feign, rls]
status: complete
requires:
  - running dev stack (postgres, redis, rabbitmq, eureka) + gateway, auth-service, user-service, platform-admin-service
  - "13-11: the six /internal/auth/users endpoints, X-Acting-User-Id, RoleCeiling.permits, login's is_active check"
  - "13-07: GET /api/v1/roles (the ceiling-aware picker) and its two reported findings"
  - "13-02: the rbac.user.manage / rbac.role.manage authority split, one-active-role-per-branch"
  - "13-08: the forced-change gate that makes must_change_password binding"
  - "13-10: the provisioning saga, which is what makes a SECOND real tenant possible"
provides:
  - "GET    /api/v1/users — one page of the caller's own tenant, page metadata"
  - "GET    /api/v1/users/{userId} — profile + active assignments (404 across tenants)"
  - "POST   /api/v1/users — 201 + a one-time temporary password"
  - "PATCH  /api/v1/users/{userId} — fullName / locale / active; a password field is REJECTED"
  - "POST   /api/v1/users/{userId}/deactivate — flag off + sessions revoked"
  - "POST   /api/v1/users/{userId}/reactivate — flag on"
  - "GET    /api/v1/users/{userId}/permissions — MOVED from GET /api/v1/users/{userId}"
  - "UpstreamErrorDecoder — 4xx keeps its status and code; 5xx never becomes a 4xx; nothing internal leaks"
  - "UpstreamExceptionHandler — @Order(HIGHEST_PRECEDENCE), beats GlobalExceptionHandler's Exception.class"
  - "JdkHttpFeignClient — a PATCH-capable Feign transport with no new dependency"
  - "UserAdminDtos — the public request/response shapes Phase 14 codes against"
  - "BranchRoleAdminService.assign now refuses another tenant's user with 404, in application code"
  - scripts/e2e/phase13-tenant-admin-users-e2e.sh
affects:
  - "13-15: the seed script can create every persona through this API instead of writing rows"
  - "Phase 14: the tenant-admin UI codes against the shapes in §4"
  - "every user-service Feign call: upstream 4xx now surfaces as a 4xx, not a 500"
  - "GET /api/v1/users/{id} is a BREAKING change; its one caller (phase13-roles-e2e.sh) was updated"
tech-stack:
  added: []
  patterns:
    - an undecoded upstream refusal is indistinguishable from a server fault, and both look the same on a dashboard
    - a 5xx downgraded to a 4xx tells a caller to rewrite a correct request and hides an outage
    - refuse the 4xx that describe YOUR misconfiguration rather than echoing them at the client
    - "@Order on a @RestControllerAdvice is load-bearing when another advice handles Exception.class"
    - a security boundary held up by a database constraint disappears when the constraint does
    - two distinguishable refusals are an enumeration oracle whatever their status codes say
    - "@DynamicPropertySource ordering across a class hierarchy is not something to rely on"
    - prove isolation against two genuinely provisioned tenants, never against a fabricated id
key-files:
  created:
    - services/user-service/src/main/java/io/restaurantos/user/client/UpstreamErrorDecoder.java
    - services/user-service/src/main/java/io/restaurantos/user/client/UpstreamClientException.java
    - services/user-service/src/main/java/io/restaurantos/user/client/UpstreamServiceException.java
    - services/user-service/src/main/java/io/restaurantos/user/client/JdkHttpFeignClient.java
    - services/user-service/src/main/java/io/restaurantos/user/config/UpstreamExceptionHandler.java
    - services/user-service/src/main/java/io/restaurantos/user/dto/UserAdminDtos.java
    - services/user-service/src/main/java/io/restaurantos/user/service/InvalidUserRequestException.java
    - services/user-service/src/test/java/io/restaurantos/user/client/UpstreamErrorDecoderTest.java
    - services/user-service/src/test/java/io/restaurantos/user/integration/UserAdminIT.java
    - scripts/e2e/phase13-tenant-admin-users-e2e.sh
  modified:
    - services/user-service/src/main/java/io/restaurantos/user/client/AuthInternalClient.java
    - services/user-service/src/main/java/io/restaurantos/user/client/FeignInternalConfig.java
    - services/user-service/src/main/java/io/restaurantos/user/service/UserAdminService.java
    - services/user-service/src/main/java/io/restaurantos/user/controller/UserAdminController.java
    - services/user-service/src/test/java/io/restaurantos/user/BaseUserIT.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/BranchRoleAdminService.java
    - services/auth-service/src/test/java/io/restaurantos/auth/AuthInternalBranchRoleIT.java
    - scripts/e2e/phase13-roles-e2e.sh
decisions: [D-11, D-13, D-30]
requirements: [USER-01, USER-02, USER-03]
metrics:
  duration: ~3h
  completed: 2026-08-07
  tasks: 2
  commits: 4
---

# Phase 13 Plan 12: The Public Tenant-Admin User API — Summary

Blocker B3 is closed. A tenant admin lists, fetches, creates, edits, deactivates and reactivates
users through `/api/v1/users`, assigns per-branch roles from a catalog, and cannot touch another
tenant or mint a role above their own — proved by 56 live assertions across **two genuinely
provisioned tenants**, and by 18 integration tests that carry real RS256 tokens through the real
filter chain.

And the thing this plan was told mattered most: **`scripts/e2e/phase13-role-catalog-e2e.sh` is
28 PASS / 0 FAIL**, from 26/2. The two failing assertions were right; the mapping was wrong.

---

## 1. The error decoder — the single most important task

### The RED, measured before the change

```
internal  POST /internal/auth/users/{id}/branch-roles {"roleCode":"NOT_A_REAL_ROLE"} → 400 UNKNOWN_ROLE_CODE
public    POST /api/v1/users/{id}/branch-roles         same body                     → 500 INTERNAL_ERROR

internal  POST /internal/auth/users/{id}/branch-roles {"roleCode":"OWNER"}           → 403 ROLE_CEILING_EXCEEDED
public    POST /api/v1/users/{id}/branch-roles         same body                     → 500 INTERNAL_ERROR
```

`AuthInternalClient` had no `ErrorDecoder`, so `FeignException` — an ordinary `RuntimeException` as
far as `GlobalExceptionHandler` is concerned — fell into `handleUnexpected` and came back as 500.
Both refusals were **correct and fail-closed**; only their status was wrong. That is worse than it
sounds: a privilege-escalation attempt and a database outage were indistinguishable to the caller
*and* on a dashboard, and a role picker could say nothing true about either.

### Three rules, each with a paired control in `UpstreamErrorDecoderTest` (13 tests)

**1. A 4xx keeps its status and its `error.code`.** 400 `UNKNOWN_ROLE_CODE`, 403
`ROLE_CEILING_EXCEEDED`, 404 `NOT_FOUND`, 409 `STATE_INVALID` all cross unchanged, carried by
`UpstreamClientException` and re-emitted by `UpstreamExceptionHandler`.

**2. A 5xx never becomes a 4xx.** `UpstreamServiceException` always answers **502 `UPSTREAM_ERROR`**.
Downgrading a server fault to a client fault tells the caller to rewrite a correct request forever
and removes a real outage from every 5xx alert in the platform. Asserted both ways: upstream 500 and
503 are 502, and no 4xx test passes by accident because each names the class it expects.

**3. Nothing internal leaks.** Only the upstream's own structured `error.message` crosses.
`FeignException.getMessage()` names the internal scheme, host, port and path and is logged, never
returned. An **undecodable** body — an HTML proxy page, a truncated one — yields
`UPSTREAM_REJECTED` and a fixed message rather than being echoed; a null or empty body does not
throw out of the decoder. No stack trace reaches a client. Asserted by content, not by shape: the
403 body is checked to contain neither `127.0.0.1`, nor `8081`, nor `/internal/auth`, nor
`AuthInternalClient`.

### The three 4xx that are deliberately NOT passed through

| Upstream | Meaning | Answered |
|---|---|---|
| `401` | our `X-Internal-Service` secret was rejected | **502** |
| `403 INTERNAL_AUTH_REQUIRED` | we did not send the secret | **502** |
| `403 ACTING_USER_REQUIRED` | we failed to forward the caller's identity (13-11 made it mandatory) | **502** |

None of these describes anything the caller did or can change; all three describe user-service being
misconfigured. Echoing them would ask an authenticated tenant admin to log in again, or to go and
obtain an authority, over a fault they cannot see and cannot fix. They read as 502, loudly, in our
own logs.

### Two placement decisions that are load-bearing

**`@Order(Ordered.HIGHEST_PRECEDENCE)` on the advice.** `GlobalExceptionHandler` declares
`@ExceptionHandler(Exception.class)`, which matches everything, and Spring resolves by walking the
advice beans *in order* and taking the first with a matching method. Unordered, this handler wins or
loses on bean discovery order — not something to leave to chance for a handler whose entire job is
to stop refusals being reported as 500s.

**The decoder is declared inside `FeignInternalConfig`**, a Feign `configuration` class rather than a
`@Configuration` class, so it binds to this client and lives in its child context. Declared globally
it would silently replace the decoder of any Feign client added later, which is that client's
decision to make.

`@ExceptionHandler(FeignException.class)` is also present, for the calls that never produce a
response at all — connect refused, read timeout, `RetryableException` after the last attempt. The
error decoder is not consulted for those, and without it a dead auth-service would be reported to
the client identically to a bug in this service.

**Result: `phase13-role-catalog-e2e.sh` 26/2 → 28/0**, run twice, with both previously failing
assertions unchanged.

---

## 2. Row-level security — how I convinced myself, against a real enforcing database

`users` and `user_branch_roles` are `ENABLE` + `FORCE ROW LEVEL SECURITY` and `auth_user` is
`NOSUPERUSER NOBYPASSRLS`. **Testcontainers' Postgres user is a SUPERUSER, so the policy is inert in
every integration test in this repository** — `UserAdminIT` included, and that file says so in its
own class comment rather than implying otherwise. Three independent things, only one of which is a
test:

**(a) The tenant predicate is in the QUERY, not only in the policy.** Every finder this surface
reaches carries `tenant_id = :tenantId` (13-11's `findPageForTenant` / `findByIdForTenant`), and the
guard this plan added to `BranchRoleAdminService.assign` uses `findByIdForTenant` for exactly that
reason. The predicate is the half CI can assert; the policy is the half only a real database can.

**(b) `UserAdminIT` asserts the half user-service is responsible for** — *which tenant id was sent
upstream* — and does not pretend to assert more. The stub matches only tenant A, so a request
carrying anything else 404s rather than silently passing, and there is a separate control asserting
the foreign tenant id appears in **no** outbound request's URL or body at all.

**(c) `phase13-tenant-admin-users-e2e.sh` runs against the enforcing database**, where auth-service's
runtime and its Liquibase both connect as `auth_user`. It provisions **two real tenants** through the
platform API and asserts **all five verbs** across the boundary, each with a control:

```
tenant A → GET        tenant B's admin ........ 404   (control: 200 for tenant B itself)
tenant A → PATCH      tenant B's admin ........ 404
tenant A → deactivate tenant B's admin ........ 404
tenant A → reactivate tenant B's admin ........ 404
tenant A → assign a role to tenant B's admin .. 404   ← was 409; see §5
tenant B's list contains tenant A's user? ..... no    (control: it DOES contain its own)
tenant B's admin still fetchable afterwards ... 200
the 404 body names B's email or tenant id? .... no
```

A cross-tenant test against a fabricated identifier proves only that a random id is not found, which
is true of a completely broken API. Every negative here is paired with the positive that makes it
mean something.

---

## 3. The role ceiling — reused, not forked

The plan asked for a ceiling check in user-service. **I did not add one**, and the reason is the one
13-11 and the brief both state: `RoleCeiling.permits` is the single owner of the rule and is already
shared by the role picker (13-07) and the write path (13-11) so the two cannot drift. The rule
compares the target role's permission set with the acting user's, and **only auth-service holds
either table** — `role_permissions` and `user_branch_roles` are its. A copy in user-service could
only be a hardcoded role name, which drifts the moment a role is added and would be a second, weaker
statement of a rule that already has an owner.

What user-service does instead is the half it can: forward the caller's identity from the verified
JWT so auth-service *can* evaluate the ceiling, and surface the refusal with its real status so a
picker can say something true about it. That is the whole of §1.

Proved live, by a **real TENANT_ADMIN** rather than by the provisioned OWNER — OWNER holds
`rbac.manage`, so OWNER granting OWNER is legitimate and refusing it would be the bug:

```
OWNER creates a TENANT_ADMIN ..................................... 201  (its own ceiling permits it)
that TENANT_ADMIN: forced change → TOTP enrolment → real token ... ok
control: it CAN list users ....................................... 200  (so the 403 below is the ceiling,
                                                                          not a missing authority)
TENANT_ADMIN creates a user with roleCode OWNER .................. 403 ROLE_CEILING_EXCEEDED
  body contains "rbac.manage"? ................................... no   (names the role and a COUNT)
  a user row was left behind? .................................... no
TENANT_ADMIN assigns OWNER to an existing user ................... 403 ROLE_CEILING_EXCEEDED
```

---

## 4. The endpoint contracts — Phase 14 and 13-15 code against these

All under `/api/v1/users`, routed at the gateway by the pre-existing
`Path=/api/v1/users/**, /api/v1/branches/**` rule. **No gateway change was needed.**

| Method | Path | Gate | Answers |
|---|---|---|---|
| `GET` | `/api/v1/users` | `rbac.manage` \| `rbac.user.manage` | one page of this tenant's users |
| `GET` | `/api/v1/users/{userId}` | same | profile + active assignments |
| `POST` | `/api/v1/users` | same | **201** + a one-time temp password |
| `PATCH` | `/api/v1/users/{userId}` | same | 200 + the updated resource |
| `POST` | `/api/v1/users/{userId}/deactivate` | same | 200 + the updated resource |
| `POST` | `/api/v1/users/{userId}/reactivate` | same | 200 + the updated resource |
| `GET` | `/api/v1/users/{userId}/permissions` | same | computed permissions |
| `POST` | `/api/v1/users/{userId}/branch-roles` | `rbac.manage` \| **`rbac.role.manage`** | assignment + `displacedRoleCode` |
| `DELETE` | `/api/v1/users/{userId}/branch-roles` | same | 204 |

The role writes take the *role* code and everything else the *user* code, deliberately: gating role
assignment on the user-administration code would defeat 13-02's split, because anyone able to edit a
user could then grant themselves OWNER. Both codes are held by the same two roles today, so this
changes nothing now — it is what makes a narrower custom role possible later without re-auditing
these endpoints.

### List

`?page=0&size=50&activeOnly=false&search=` — `size` is capped at **200** upstream (default 50); a
caller asking for more gets the cap and `meta.totalCount` tells them how many there are. The sort is
fixed at `(email, id)` upstream and is not a parameter. **The cursor fields carry the page NUMBER**,
so one envelope serves every list in the platform; `nextCursor` is `null` on the last page.

```jsonc
{"data": [{"id":"…","email":"…","fullName":"…","locale":"en","active":true,
           "mustChangePassword":false,"totpEnabled":false,
           "lastLoginAt":"…","createdAt":"…"}],
 "meta": {"page":{"cursor":"0","nextCursor":"1","limit":50}, "totalCount": 11},
 "warnings": []}
```

### Get / update / deactivate / reactivate

```jsonc
{"data": {"user": { …UserSummary… },
          "assignments": [{"branchId":"…","roleCode":"CASHIER",
                           "primary":true,"approvalLimitPaisa":null}]},
 "meta": null, "warnings": []}
```

An **empty** `assignments` array is the visible form of an account that cannot log in at all.

### Create

```jsonc
// request — NO tenant field and NO password field, and both absences are the enforcement
{"email":"…","fullName":"…","locale":"en","branchId":"…","roleCode":"CASHIER"}

// 201
{"data": {"id":"…","email":"…","tempPassword":"zEHaY&6?CzqWe8p2",
          "mustChangePassword":true,"branchId":"…",
          "assignedRoleCode":"CASHIER","loginable":true},
 "meta": null, "warnings": []}
```

- `branchId` and `roleCode` travel together; one without the other is 400 and creates nothing.
- Both absent is legal and means "create the account, assign later"; `loginable:false` says so
  directly rather than letting it be discovered at that user's first login.
- Unknown role code → **400 `UNKNOWN_ROLE_CODE`**, naming the code, nothing written.
- Duplicate address in the tenant → **409 `STATE_INVALID`**.
- Above the caller's ceiling → **403 `ROLE_CEILING_EXCEEDED`**, nothing written.
- `tempPassword` crosses back **once**. `CreatedUser.toString()` is overridden to `<redacted>`
  because a record's generated one prints every component, and nothing in this service logs it.

### Update

Patch semantics — a null field is left alone, so a client rendering three fields cannot blank a
fourth. `active` is a boxed `Boolean` for that reason; a primitive would default to `false` and every
profile edit would deactivate the user.

**A body carrying a password is refused with 400, not ignored** — across `password`, `newPassword`,
`passwordHash` and `temp_password`, caught by `@JsonAnySetter` so it covers what a caller actually
sent rather than a fixed list. The value is discarded at parse time and is never stored, logged or
echoed; only the field *name* reaches the message. Asserted live (400, the response does not contain
the submitted value) and in an IT (nothing at all was forwarded upstream).

### Errors

`400 VALIDATION_FAILED` / `UNKNOWN_ROLE_CODE` · `401 UNAUTHENTICATED` · `403 PERMISSION_DENIED` /
`ROLE_CEILING_EXCEEDED` · `404 NOT_FOUND` · `409 STATE_INVALID` · `502 UPSTREAM_ERROR`.

### One breaking change

`GET /api/v1/users/{userId}` returned a **permission map** and now returns the **user**. Permissions
moved to `GET /api/v1/users/{userId}/permissions`, which matches the internal contract, where they
have always lived at `/internal/auth/users/{userId}/permissions`. A public user API whose "get a
user" returns a permission map is not a contract a UI can be written against, and there is only one
obvious path for a user. The **only** caller was `scripts/e2e/phase13-roles-e2e.sh:327`, updated in
the same commit.

---

## 5. Three defects found and closed on the way past

### (a) Cross-tenant role assignment was refused only by a database foreign key

The live script asserts all five verbs across the boundary. Four answered 404. The fifth answered:

```
409 {"code":"CONFLICT","message":"This conflicts with existing data"}
```

`BranchRoleAdminService.assign` **never checked that the target user belongs to the tenant.** Nothing
in application code did. The write was stopped by a foreign key, and the message it produced is the
one written for a duplicate vendor code.

Fail-closed, but by accident, and it is the wrong kind of accident: a security boundary held up by a
constraint disappears the day someone drops or defers that constraint, and no part of that change
would look like a security change to whoever reviews it. Closed with an explicit guard — the target
must be a live user **of this tenant** or it is a 404.

**404 and not 403**, matching every other cross-tenant answer in this service: a 403 confirms the id
names a real account somewhere, which lets a tenant admin walk ids and learn the size and shape of
the rest of the platform without reading a row. Verified in both directions — a user id that exists
**nowhere** now answers identically to another tenant's, because two distinguishable refusals are an
oracle whatever their status codes say. Two new ITs, one with a control proving the neighbour's row
really exists.

*This is the one excursion outside `services/user-service`, and it is named here because the brief
asked me to name any.* `BranchRoleAdminService.assign`'s only in-process caller is
`ProvisioningAdminService.provisionAdmin`, which `saveAndFlush()`es the admin into the same tenant
immediately before calling it, so the guard cannot break provisioning — and `AuthTenantProvisioningIT`
26/26 confirms it.

### (b) Feign's default transport cannot send PATCH at all

`feign.Client.Default` is built on `HttpURLConnection`, whose method list is fixed and excludes
PATCH. auth-service's profile update is `PATCH /internal/auth/users/{userId}` — deliberately, because
every field is optional. So the first call to the public update endpoint failed with:

```
java.net.ProtocolException: Invalid HTTP method: PATCH
```

arriving as a `FeignException`, i.e. indistinguishable from auth-service being down. **Caught by
`UserAdminIT`, and only because that test asserts a 200 rather than merely "not a 4xx".**

The usual fix is `feign-hc5` or `feign-okhttp`. `T-13-12-SC` forbids adding a package without a
legitimacy audit and a blocking human checkpoint, and **an HTTP client is exactly the dependency an
attacker would like to be the one who supplies**. `JdkHttpFeignClient` is ~50 lines on
`java.net.http.HttpClient`, which the JDK has shipped since 11 and which supports arbitrary methods.
It follows **no redirects** — a redirect from an internal service would replay the request,
including the shared secret and the acting-user identity, at whatever location it named — and it
filters the headers the JDK client refuses to have set for it (`content-length` among them, which
Feign populates on every request with a body). Scoped to `FeignInternalConfig`, so another Feign
client added later keeps the default and its own decision.

### (c) `BaseUserIT`'s `@DynamicPropertySource` silently overrode its subclass's

Seventeen `UserAdminIT` tests reported **401 with a perfectly valid token**. Spring collects
`@DynamicPropertySource` methods by walking the class hierarchy, and the base class's registration
for the same key won — so the JWKS URI pointed at the dead placeholder port and every token failed
verification. The two upstream URIs are now overridable statics evaluated lazily at context refresh,
with no ordering question at all. `UserAdminDelegationIT` had the same latent bug in its override of
`restaurantos.auth-service.uri` and never noticed, because it does not actually call the endpoints.

---

## 6. Deviations from plan

**1. [Deliberate omission — the brief overrides the plan text] No client-side role ceiling.** The
plan's task asked for one in `UserAdminService`. The brief and 13-11 both say `RoleCeiling.permits`
has one owner and must not be forked, and a copy in user-service could only hardcode a role name.
Full reasoning in §3; the prohibition is still satisfied and is asserted twice live.

**2. [Rule 1 — bug, outside `services/user-service`] The cross-tenant assign guard in auth-service.**
§5(a). The brief asked me to stay in user-service; this is the one file outside it, and it was a
finding of this plan's own e2e script against a prohibition this plan owns. Commit `6efe9e2`.

**3. [Rule 3 — fixing what this change broke] `JdkHttpFeignClient`.** §5(b). Nothing could call
`PATCH` before this plan, so the defect was unreachable and therefore unfound.

**4. [Rule 1 — bug, in a test harness] `BaseUserIT`'s property-source override.** §5(c).

**5. [Breaking change, one caller, updated] `GET /api/v1/users/{id}`** now returns the user;
permissions moved to `…/permissions`. §4.

**6. [Rule 2 — security, beyond the plan] The password-field rejection on the public PATCH.** The
public DTO is a separate type from auth-service's, so Jackson would have dropped a `password` key and
answered 200 even though auth-service refuses it. Replicated here, with the value discarded at parse
time.

**7. [Out of plan scope] user-service and auth-service were rebuilt and restarted** onto their new
jars, so every live number below comes from a process newer than its jar. The gateway was not
touched and not restarted.

**8. [Process — a staging-area race, reported rather than hidden]** The error-decoder commit was
prepared as `git add …` then `git commit …` in two calls. A concurrent agent committed in that
window and **swept my six staged files into its commit `b7f799b`** ("style(frontend): prettier
login-form"). The work is intact and in history; only its attribution is wrong. I did **not** rewrite
that commit: it is referenced by the other agent's own summary, and rewriting shared history under a
concurrent agent is worse than a mis-attributed commit message. Every later commit stages and commits
in a single shell invocation to close the window. The affected files are `UpstreamErrorDecoder`,
`UpstreamClientException`, `UpstreamServiceException`, `UpstreamExceptionHandler`,
`FeignInternalConfig` and `UpstreamErrorDecoderTest`.

**9. [Housekeeping]** Stale macOS `" 2"`-suffixed class files under `services/auth-service/target/`
broke surefire with `wrong name: io/restaurantos/auth/integration/TestFixtures`. Deleted inside
`target/` only; no tracked file matches.

---

## 7. Verification actually run

Every number is from a command executed in the state being reported, with
`JAVA_HOME=openjdk@25`, `TESTCONTAINERS_RYUK_DISABLED=true`,
`TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`.

| Suite | Result |
|---|---|
| `mvn -pl services/user-service verify` | **BUILD SUCCESS** |
| ├ user-service unit | **16/16** (was 3/3) |
| │  └ `UpstreamErrorDecoderTest` | **13/13** (new) |
| └ user-service IT | **29/29** (was 11/11) |
| &nbsp;&nbsp;&nbsp;└ `UserAdminIT` | **18/18** (new) |
| `mvn -pl services/auth-service -am verify` | **BUILD SUCCESS** |
| ├ auth-service unit | **28/28** |
| ├ auth-service IT | **150/150** (was 148) |
| │  ├ `AuthInternalBranchRoleIT` | **14/14** (was 12; +2 cross-tenant) |
| │  ├ `UserLifecycleIT` | 22/22 |
| │  └ `AuthTenantProvisioningIT` | 26/26 |
| └ shared-lib | unit **38/38**, IT **11/11** |
| `mvn -pl gateway -am verify` | **BUILD SUCCESS** — unit **52/52**, IT **22/22** |
| `opa test policies/` | **139/139** (no `.rego` touched) |
| `bash scripts/e2e/phase13-tenant-admin-users-e2e.sh` | **56 PASS / 0 FAIL, exit 0** |
| trap cleanup | **0** tenant rows left, both tenants |
| `bash scripts/e2e/phase13-role-catalog-e2e.sh` | **28 PASS / 0 FAIL** — was 26/2 |
| `bash scripts/e2e/phase13-user-lifecycle-e2e.sh` | **48 PASS / 0 FAIL** — 13-11's baseline held |
| Live RED, before the decoder — unknown role, public door | **500 INTERNAL_ERROR** |
| Live RED, before the decoder — TENANT_ADMIN assigns OWNER | **500 INTERNAL_ERROR** |
| Live GREEN, after — same two requests | **400 UNKNOWN_ROLE_CODE**, **403 ROLE_CEILING_EXCEEDED** |
| Live RED — cross-tenant assign, before the guard | **409 CONFLICT** "This conflicts with existing data" |
| Live RED — nonexistent user id, before the guard | **409 CONFLICT** (measured, so the oracle question was answered rather than assumed) |
| Live GREEN — both, after the guard | **404 NOT_FOUND**, identical |

### Observed and not diagnosed

The first run of `phase13-role-catalog-e2e.sh` immediately after restarting user-service reported
**23/5**: five assignments answered **503** from the gateway before the `lb://` pool warmed. A run
20 seconds later was 28/0, and so was every run after. This is the cold-breaker condition the runbook
describes; noted, not diagnosed, as instructed.

### The three e2e suites I did NOT run

`phase13-roles-e2e.sh` (13-11 recorded it at 19/4, all four outside that plan), and the phase-12
scripts. I changed one line in `phase13-roles-e2e.sh` — the moved permissions path — and did not run
it, so **I am not reporting a number for it**. It is the one thing in this plan whose effect I
asserted by reading rather than by running, and it is named here rather than left to be found.

### GitNexus, per CLAUDE.md

The index is stale (last built at `5fba4a9`) and was **not** refreshed, for the reason 13-01 through
13-11 all gave: `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files, which 13-01
had to revert. The MCP tools were not available in this session and I am not reporting a result I did
not obtain; the hook surfaced related symbols on several calls and those are recorded where they
mattered. Blast radius was established by reading, and the two edits carrying real risk are:

| Target | Change | Risk actually taken |
|---|---|---|
| `UserAdminController.getUserPermissions` | **path moved** | MEDIUM in contract — one caller, enumerated and updated in the same commit. |
| `BranchRoleAdminService.assign` | **guard added** | MEDIUM — every branch-role write and the provisioning saga run through it. Hence the two new ITs, `AuthTenantProvisioningIT` 26/26, and three live scripts. |
| `FeignInternalConfig` | decoder + transport replaced | LOW in code, MEDIUM in blast radius — every user-service→auth-service call. Covered by 13 unit tests, 18 ITs and three live scripts. |

`detect_changes` was not used and I am **not** reporting a clean result from it; 13-07 and 13-11 both
recorded that it answers "No changes detected" against a dirty tree, so its silence carries no
information. Scope was reviewed with `git diff --cached --stat` before each commit and every commit
names its files.

---

## Known stubs

None. Every symbol this plan created is wired and exercised — by a unit test, an integration test, a
live HTTP assertion, or all three.

## Threat flags

- **T-13-12-A** (tenant scope spoofing) — scope comes only from `TenantContext`, populated from a
  signature-verified JWT. The public request DTOs declare no tenant field, so a body carrying one is
  dropped. Asserted three ways: the tenant *sent upstream* is the caller's; the foreign id appears in
  **no** outbound request's URL or body; and live, a create body naming tenant B produced a user whose
  token carries tenant A.
- **T-13-12-B** (cross-tenant access) — all five verbs, against two genuinely provisioned tenants,
  each with a control. §2. One defect found and closed: §5(a).
- **T-13-12-C** (a tenant admin minting the highest role) — enforced by auth-service's single-owner
  `RoleCeiling`, exercised live by a real TENANT_ADMIN with a control proving it holds the
  administration authority, and asserted to write nothing. §3.
- **T-13-12-D** (missing authorization on new endpoints) — every method carries the same gate; 403 for
  an authenticated caller without it and 401 anonymous, asserted for every verb in an IT (with the
  control that nothing was delegated upstream) and live.
- **T-13-12-E** (temp password in the create response) — returned once to an authorised admin,
  `toString()` redacted, nothing in user-service logs it; 13-11 asserted it is absent from
  `password_hash` and from `event_outbox`. Its life is bounded by the forced-change flag, which the
  live script exercises by walking create → refusal → change → login.
- **T-13-12-F** (upstream 400 collapsing into a 500) — the whole of §1. Closed, and asserted by test
  and live at both doors.
- **T-13-12-G** (administrative changes without attribution) — `X-Acting-User-Id` is forwarded on
  every lifecycle write from the token's subject. Asserted with a client that *sends* the header
  itself: the forwarded value is the token's, not the client's, and the gateway strips it at the edge
  as a second independent control.
- **T-13-12-SC** — did not arise. **No package of any kind was installed, in any ecosystem.** The one
  place a dependency was the obvious answer — a PATCH-capable HTTP client — was solved with the JDK
  instead, for that reason. §5(b).

## Self-Check: PASSED

All 10 created files exist on disk. All 4 commits exist in `git log`: `1a57d8a` (the public API),
`6efe9e2` (the auth-service guard), `6b18678` (the e2e script), and the error-decoder work, which is
in `b7f799b` for the reason recorded in deviation 8.
