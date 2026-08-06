---
phase: 13-platform-tenant-access-repair
plan: 11
subsystem: auth-user-lifecycle
tags: [user-lifecycle, b3, d-11, d-12, d-13, rls, role-ceiling, privilege-escalation, internal-seam, liquibase, email-uniqueness]
status: complete
requires:
  - running dev stack (postgres, redis, rabbitmq, eureka) + gateway, auth-service, user-service
  - "13-02: BranchRoleAdminService.assign, one-active-role-per-branch, is_primary, the rbac.user.manage / rbac.role.manage split"
  - "13-06: RoleCatalog.requireKnown, the tenant GUC as the first statement of an internal transaction, the temp-password generator"
  - "13-07: the role ceiling on GET /api/v1/roles, derived from role_permissions"
  - "13-04: PasswordPolicyService.revokeActiveRefreshSessions"
  - "13-08: the forced-change gate that makes must_change_password binding"
provides:
  - "GET  /internal/auth/users — paginated, activeOnly filter, case-insensitive search"
  - "GET  /internal/auth/users/{userId} — profile + active assignments (404 across tenants)"
  - "POST /internal/auth/users — create with a one-time temp password and an optional branch role"
  - "PATCH /internal/auth/users/{userId} — fullName / locale / active; a password field is REJECTED"
  - "POST /internal/auth/users/{userId}/deactivate — flag off + refresh sessions revoked"
  - "POST /internal/auth/users/{userId}/reactivate — flag on, sessions NOT restored"
  - "X-Acting-User-Id — the caller-identity seam on /internal/auth/**, REQUIRED on every privilege-bearing write"
  - "RoleCeiling (permits / requireAssignable / requireMayAdminister) — one owner of the ceiling rule, shared with the picker"
  - "BranchRoleAdminService.assignAsActingUser — the only networked assign path"
  - "UserLifecycleService, UserLifecycleInternalController, CreateUserRequest, UpdateUserRequest, UserDtos"
  - "UserRepository.findPageForTenant / findByIdForTenant / findLiveByTenantAndLowercasedEmail"
  - "changeset 058: duplicate repair + UNIQUE (tenant_id, lower(email)) WHERE deleted_at IS NULL + a list index"
  - "AuthServiceImpl now refuses an inactive or tombstoned account at login and at TOTP bootstrap"
  - scripts/e2e/phase13-user-lifecycle-e2e.sh
affects:
  - "13-12: builds its public surface on the six endpoints and MUST send X-Acting-User-Id; one finding left for it, below"
  - "13-13: admin-initiated reset targets users created here"
  - "13-15: the seed script can create personas through a real API instead of writing rows"
  - "every branch-role assignment: POST /internal/auth/users/{id}/branch-roles now REQUIRES an acting user"
tech-stack:
  added: []
  patterns:
    - put the security check where the data it needs lives, not where the caller is
    - a header that carries an IDENTITY is safe; one that carries an ENTITLEMENT is not — recompute
    - an optional security header fails open silently; make it required and refuse its absence
    - enforce tenant isolation in the QUERY as well as the RLS policy, because Testcontainers is a superuser
    - repair data first, verify convergence with a RAISE that names the likely cause, then create the constraint
    - stand RLS down to NO FORCE inside the migration transaction for a repair that spans every tenant
    - reject a dangerous unknown field rather than letting Jackson drop it
key-files:
  created:
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/058-users-tenant-email-uniqueness.xml
    - services/auth-service/src/main/java/io/restaurantos/auth/service/UserLifecycleService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/RoleCeiling.java
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/UserLifecycleInternalController.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/request/CreateUserRequest.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/request/UpdateUserRequest.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/response/UserDtos.java
    - services/auth-service/src/main/java/io/restaurantos/auth/exception/RoleCeilingExceededException.java
    - services/auth-service/src/main/java/io/restaurantos/auth/exception/ActingUserRequiredException.java
    - services/auth-service/src/main/java/io/restaurantos/auth/exception/InvalidUserRequestException.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/UserLifecycleIT.java
    - scripts/e2e/phase13-user-lifecycle-e2e.sh
  modified:
    - services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml
    - services/auth-service/src/main/java/io/restaurantos/auth/repository/UserRepository.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/AuthServiceImpl.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/BranchRoleAdminService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/RoleCatalogService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/AuthInternalController.java
    - services/auth-service/src/main/java/io/restaurantos/auth/exception/AuthExceptionHandler.java
    - services/auth-service/src/test/java/io/restaurantos/auth/AuthInternalBranchRoleIT.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/AuthTenantProvisioningIT.java
    - gateway/src/main/java/io/restaurantos/gateway/filter/StripInternalHeaderFilter.java
    - gateway/src/test/java/io/restaurantos/gateway/JwtGlobalFilterTest.java
    - services/user-service/src/main/java/io/restaurantos/user/client/AuthInternalClient.java
    - services/user-service/src/main/java/io/restaurantos/user/service/UserAdminService.java
    - scripts/e2e/phase13-roles-e2e.sh
    - scripts/e2e/phase13-role-catalog-e2e.sh
    - scripts/e2e/phase13-password-change-e2e.sh
    - scripts/e2e/phase13-feature-gating-e2e.sh
decisions: [D-11, D-12, D-13, D-30]
requirements: [USER-02, USER-03, AUTH-01]
metrics:
  duration: ~4h
  completed: 2026-08-07
  tasks: 3
  commits: 5
---

# Phase 13 Plan 11: User Lifecycle & Per-Tenant Email Uniqueness — Summary

A tenant can now create a cashier who can actually log in and use the product — the thing blocker B3
denied. And the privilege-escalation hole 13-07 measured and left open is closed, in auth-service,
proved by refusing it over a real network hop and over the public door with a real tenant-admin JWT.

---

## 1. The escalation — closed, and how

### The RED, measured in this state before any change

Against the running stack, with the shared secret and **no identity whatsoever**:

```
POST /internal/auth/users/{waiter}/branch-roles   {"branchId":"…","roleCode":"OWNER"}
→ HTTP 200
{"roleCode":"OWNER","displacedRoleCode":"WAITER","primary":true, …}
```

That account holds `rbac.manage` — precisely what 13-02's authority split exists to withhold from a
tenant admin — and whoever assigned it can then log in as it. (The waiter's WAITER assignment was
restored immediately; verified back to `WAITER t t`.)

### The seam: `X-Acting-User-Id`

**Authoritative component: the calling service, from a verified JWT.** user-service reads it from
`TenantContext`, which `JwtAuthenticationFilter` populated from the token's subject. It is never
read from a request.

Three independent things stop a client supplying it, and the third is the one the brief asked for:

1. the gateway maps **no route** to `/internal/**` — asserted live at **404**;
2. `InternalServiceFilter`'s constant-time shared secret — asserted live at **403** without it;
3. **`StripInternalHeaderFilter` now deletes `X-Acting-User-Id`** from every inbound request,
   unconditionally and before authentication, exactly as it already does for `X-Internal-Service`
   and `X-TOTP-Verified`. No route exposes `/internal/**` today, so this is belt to that route
   table's braces — a route added later by someone who has not read the file cannot reopen it.

**The header carries an IDENTITY, never an ENTITLEMENT.** auth-service recomputes what that user may
do from `user_branch_roles` and `role_permissions` on every call. A forwarded permission list would
be a claim about authority made by the party whose authority is in question, and it can be stale — a
role revoked a second ago is still in a token minted a minute ago. Recomputing costs two queries and
cannot be lied to.

**Required, not optional.** Absence is `403 ACTING_USER_REQUIRED`, distinct from
`INTERNAL_AUTH_REQUIRED` (no secret) and from `ROLE_CEILING_EXCEEDED` (identity present, authority
insufficient). 13-07 named the failure mode: an optional header that disables a security check when
omitted fails open, silently, and would be omitted by the first caller written by someone who had
not read this. An id that resolves to nobody yields the **empty** permission set, which permits only
a role granting nothing — so naming a random UUID is a refusal, not a bypass.

### The rule has one owner

`RoleCeiling.permits(callerPermissions, rolePermissions)` is now called by **both**
`RoleCatalogService.listAssignableRoles` (the picker, 13-07) and the write path. A picker that hides
a role the write path accepts is a hint, not a control — which is exactly what it was. Derived from
`role_permissions`, never enumerated, so adding a role needs no code change and cannot disagree.

Applied in three places, all in auth-service:

| Operation | Rule |
|---|---|
| assign a branch role | the target role's permissions ⊆ the acting user's |
| create a user **with** a role | same, checked **before** a password is generated or a row written |
| update / deactivate / reactivate | the **target's** current roles ⊆ the acting user's |

The last one is beyond the brief and is a Rule 2 addition. Granting is not the only way authority
leaks: a TENANT_ADMIN who can *deactivate* the OWNER can lock the only holder of `rbac.manage` out
of their own tenant. Asserted live and in an IT.

Ordering inside is load-bearing three times: **GUC first** (everything after reads a FORCE-RLS
table, including the acting user's own assignments — without it a legitimate OWNER silently reduces
to the empty ceiling); **role-code validation before the subset test** (an unknown code has no
permission rows and would pass `containsAll(∅)` vacuously, reporting a typo as an authorization
success — pinned by a test); **the ceiling before the write** (a refused assignment must not have
already displaced the role the target held — also asserted).

`BranchRoleAdminService.assign` stays unbounded but is **in-process only**, for
`ProvisioningAdminService.provisionAdmin`, which creates a tenant's first admin before any human in
that tenant exists. `assignAsActingUser` is the only path the controller reaches.

### Proved refused, at both doors

**Internal**, from `scripts/e2e/phase13-user-lifecycle-e2e.sh`:

```
no acting user            → 403 ACTING_USER_REQUIRED
acting = CASHIER, OWNER   → 403 ROLE_CEILING_EXCEEDED
                            "…it grants 1 permission(s) you do not hold yourself"
rows written              → 0
acting = OWNER, MANAGER   → 200      ← the control
```

**Public**, through the real gateway with a real TENANT_ADMIN JWT (user-service's log):

```
feign.FeignException$Forbidden: [403] during [POST] to
  http://127.0.0.1:8081/internal/auth/users/…/branch-roles
{"error":{"code":"ROLE_CEILING_EXCEEDED",
          "message":"You cannot assign the role OWNER: it grants 1 permission(s)
                     you do not hold yourself"}}
```

**The message names the role and a COUNT, never the permission codes** — naming them republishes
exactly what the ceiling withholds. Same rule 13-07 recorded for withheld role names; asserted (the
body must not contain `rbac.manage`).

---

## 2. Row-level security — how I convinced myself, against a real enforcing database

`users` is `ENABLE` + `FORCE ROW LEVEL SECURITY`, measured on the live `auth_db`, and `auth_user` is
`rolsuper=false rolbypassrls=false`. Testcontainers' Postgres user is a SUPERUSER, so **the policy is
inert in every integration test in this repository.** Three independent things, and only one of them
is a test:

**(a) The GUC is the first statement of every transaction.** `UserLifecycleService` sets it before
any RLS-scoped read or write, so the GUC and the statements share one connection — the shape of the
five defects this phase has already found, `provisionAdmin` among them.

**(b) The tenant predicate is in the QUERY too.** Every finder in `UserRepository` carries
`tenant_id = :tenantId`. Two independent controls, one of which CI can assert. Every isolation
assertion — IT and script alike — writes the neighbouring tenant's row **with that tenant's GUC set**
and confirms it exists before asserting it is not returned, and pairs it with the same endpoint
returning it for its own tenant. Without the control, "the neighbour is absent" is satisfied by an
INSERT the policy refused.

**(c) The live script runs against the enforcing database.** auth-service's runtime and its
Liquibase both connect as `auth_user`, so a missing GUC is a 500, not a silent pass. It measured:
cross-tenant fetch **404**, absent from the list, present in the neighbour's own list.

**The migration needed the same treatment, and it would have failed silently without it.** Measured
as `auth_user`, on the live database:

```
repair UPDATEs with RLS still FORCED, no tenant GUC .......  UPDATE 0 / UPDATE 0
the same UPDATEs inside the NO FORCE bracket ..............  UPDATE 1
```

A naive repair matches **zero** of the rows it must repair and reports success. `users` is FORCE, and
FORCE binds the table owner (`auth_user` owns it), and a repair spanning every tenant cannot set one
tenant's GUC. So changeset 058 brackets itself in `NO FORCE` / `FORCE` inside the one transaction
Liquibase gives a changeset — the pattern 13-02 established for `user_branch_roles`. Verified
afterwards on the live database: `relrowsecurity=t relforcerowsecurity=t`.

---

## 3. Per-tenant email uniqueness — what it was, what it is, and which rule picked the survivor

### What it was: **unique per tenant already, and case-sensitive**

Measured, not assumed (`\d users` on the live `auth_db`):

```
"uk_users_tenant_email" UNIQUE CONSTRAINT, btree (tenant_id, email)
```

So email is **neither globally unique nor unconstrained** — it has been per-tenant since changeset
020. The plan asked which of the three it was; it is the middle one, and the interesting gap is
elsewhere: **the constraint is case-sensitive and login is not.** `AuthServiceImpl.login`
lower-cases before `findByEmail`, so `Bob@x` and `bob@x` may coexist in one tenant while the code
treats them as one account — and whichever row is not stored lower-case is simply unreachable at
login. 13-06 fixed the write side of that for provisioning; this closes it in the schema, where a
race cannot get past it.

### The decision, recorded rather than made

**One human MAY still hold an account in two tenants under one address.** Correct for a multi-tenant
SaaS — a consultant working for two restaurant groups is one person with one inbox — and login
requires a tenant slug alongside the address, so `(tenant, email)` is what identifies an account.
Nothing here widens or narrows it. Asserted live: the same address in another tenant is accepted; a
case variant in the *same* tenant is **409**.

**`uk_users_tenant_email` is kept.** For live rows the new index is strictly stricter (any pair
violating case-sensitive uniqueness also violates case-insensitive uniqueness), so the old one is
redundant there — but not for soft-deleted rows, which the new index excludes by design. Dropping a
unique constraint on `users` to save one index buys nothing.

**The predicate is `deleted_at IS NULL`, deliberately NOT `is_active`.** Deactivation is reversible
and must stay so: if a deactivated user's address were released, reactivating them would collide
with whoever took it, and the operator would find out at the moment they were trying to give someone
their job back. A deactivated user keeps their address reserved.

### Duplicates: none live, and the repair still exists and was proved

The live `auth_db` had **0** duplicate `(tenant_id, lower(email))` groups and **0** mixed-case
addresses across 16 users, so the repair is a no-op there. A migration whose repair has never
repaired anything is not evidence, so it was proved against the live database inside a rolled-back
transaction with three planted case variants:

| id | email | full_name | last_login_at | updated_at | outcome |
|---|---|---|---|---|---|
| `…0001` | `Dupe@demo.local` | Never Used | — | −1d | tombstoned |
| `…0002` | `dupe@demo.local` | Has Logged In | −2d | −5d | **survivor** |
| `…0003` | `DUPE@demo.local` | Newest Untouched | — | now | tombstoned |
| `…0004` | `dupe@demo.local` (other tenant) | — | — | now | untouched |

**The retention rule: the greatest `(last_login_at, updated_at, id)`, NULL `last_login_at` last.**
In words — *the account someone has actually logged into wins*; if none or several have, the most
recently touched wins; ties break on the greater id so the rule is total and gives the same answer
on every replica. "Has been used" is the first key rather than "is newest" because these duplicates
are case variants of **one person's address**: the row with login history carries their password,
their TOTP secret and their audit trail, and picking the other would silently lock out a working
account in favour of an empty duplicate. Note that the rule chose the *oldest* `updated_at` row here
— which is the point.

**Losers are tombstoned, never deleted**: `is_active=false` **and** `deleted_at=now()`. The row
survives in full, so every audit, order and journal reference still resolves; `deleted_at` is what
releases the address so the survivor can hold the lower-cased form. Survivors are then lower-cased,
guarded against the unconditional `uk_users_tenant_email`.

Also proved in that transaction: re-running the repair is `UPDATE 0` (idempotent); a fourth live
case variant is refused by the index; the cross-tenant insert is accepted.

**The verify changeset runs BEFORE the index, not after** — an index violation says
`Key (tenant_id, lower(email)) is duplicated`, which is true and useless for working out why a
repair that reported success left duplicates. The `DO` block `RAISE`s with row-level security named
as the likely cause.

**Applied to the live `auth_db` by Liquibase running as `auth_user`:** all three changesets
`EXECUTED`; `uk_users_tenant_email_ci` and `idx_users_tenant_active_email` present; `users` back to
`t/t`.

**Numbered 058, not 057** — 13-07 had already taken 057. Included last in the master changelog, after
the 900-series seeds, for the same reason 056 is: the repair must observe every `users` row the
changelog itself writes.

No index was added for the search term. Search is a case-insensitive CONTAINS with a leading
wildcard and cannot use a b-tree; the honest alternative is a `pg_trgm` GIN index, and installing an
extension is not something a changeset does silently (`T-13-11-SC`). The fallback scan is bounded by
one tenant's user count and by the hard page-size cap.

---

## 4. The endpoint contracts — 13-12, 13-13 and 13-15 code against these

All under `/internal/auth/users`, gated by the internal secret, **unrouted at the gateway** (404,
asserted live). Tenant from `X-Tenant-Id`, consistent with the existing internal branch-role
endpoints. `X-Acting-User-Id` is **required on every write**, not on the two reads.

| Method | Path | Acting user | Answers |
|---|---|---|---|
| `GET` | `/internal/auth/users` | — | one page of this tenant's users |
| `GET` | `/internal/auth/users/{userId}` | — | profile + active assignments |
| `POST` | `/internal/auth/users` | **required** | 201 + a one-time temp password |
| `PATCH` | `/internal/auth/users/{userId}` | **required** | 200 + the updated resource |
| `POST` | `/internal/auth/users/{userId}/deactivate` | **required** | 200 + the updated resource |
| `POST` | `/internal/auth/users/{userId}/reactivate` | **required** | 200 + the updated resource |

### List

`?page=0&size=50&activeOnly=false&search=` — `size` is capped at **200** (default 50); a caller
asking for more gets the cap rather than an error, and `totalCount` tells them how many there are.

```jsonc
{"data": [{"id":"…","email":"…","fullName":"…","locale":"en","active":true,
           "mustChangePassword":false,"totpEnabled":false,
           "lastLoginAt":"…","createdAt":"…"}],
 "meta": {"page":{"cursor":"0","nextCursor":"1","limit":50}, "totalCount": 11},
 "warnings": []}
```

**The cursor fields carry the page NUMBER.** `PageMeta` is shaped for cursor pagination and this is
offset pagination; putting the number where a cursor goes keeps one envelope for every list in the
platform rather than inventing a second, and `nextCursor` is `null` on the last page — which is the
question a client actually asks. **The sort is fixed at `(email, id)` and is not a parameter**: an
unstable sort makes page 2 omit and repeat rows, and offering the choice lets a caller select an
order no index serves.

### Get / update / deactivate response

```jsonc
{"data": {"user": { …UserSummary… },
          "assignments": [{"branchId":"…","roleCode":"CASHIER",
                           "primary":true,"approvalLimitPaisa":null}]},
 "meta": null, "warnings": []}
```

Assignments are sorted primary-first then by role code then branch id, so two reads are diffable.
An **empty** array is the visible form of an account that cannot log in at all.

### Create

```jsonc
// request — there is NO password field, and the absence is the enforcement
{"email":"…","fullName":"…","locale":"en","branchId":"…","roleCode":"CASHIER"}

// 201
{"data": {"id":"…","email":"…","tempPassword":"zEHaY&6?CzqWe8p2",
          "mustChangePassword":true,"branchId":"…",
          "assignedRoleCode":"CASHIER","loginable":true},
 "meta": null, "warnings": []}
```

- `branchId` and `roleCode` travel together — either both or neither. One without the other is
  **400 `VALIDATION_FAILED`** and creates nothing.
- Both absent is legal and means "create the account, assign later"; `loginable:false` says so
  directly rather than letting it be discovered at that user's first login.
- Unknown role code → **400 `UNKNOWN_ROLE_CODE`**, naming the code, nothing written.
- Duplicate address in the tenant → **409 `STATE_INVALID`** (a conflict with data that exists;
  distinct from the 400s, which no input can fix).
- Above the acting user's ceiling → **403 `ROLE_CEILING_EXCEEDED`**, nothing written.
- `tempPassword` **crosses back exactly once**. Asserted live: the stored value is a bcrypt hash and
  is not the password; `event_outbox` contains it **0** times. `CreatedUser.toString()` is
  overridden to `<redacted>` because a record's generated one prints every component.

### Update

Patch semantics — a null field is left alone, so a client rendering three fields cannot blank a
fourth. `active` is a boxed `Boolean` for that reason; a primitive would default to `false` and every
profile edit would deactivate the user. Flipping `active` here delegates to the same code path as
`/deactivate`, so it cannot deactivate someone while leaving their sessions alive.

**A body carrying a password is refused with 400, not ignored.** Jackson's default is to drop
unknown keys and answer 200, leaving an administrator certain they set a password the platform has
never heard of — discovered only when the user cannot log in with it. Caught by `@JsonAnySetter`, so
`password`, `newPassword`, `passwordHash` and `temp_password` all trip it while an ordinary unknown
field is still tolerated (asserted, both directions). **The submitted value is never stored and
never echoed** — it is a credential the caller just put on the wire, and echoing it would put it in
a log or a browser console too.

### Deactivate / reactivate

Flag flip + refresh-session revocation. **Never deletes** — the row and its assignments survive, so
audit, order and journal references stay resolvable and reactivation restores the role they had.
**Reactivation deliberately does not restore sessions**: those may have been on a device the person
no longer has, and one login is the point at which the platform re-establishes who is holding the
account. Already-issued **access** tokens stay valid until they expire — stateless by design, no
revocation list; the residual window is the access-token TTL, the same bound
`PasswordPolicyService` documents for a password change.

---

## 5. The defect this plan closed on the way past: **login never read `is_active`**

`users.is_active` has existed since changeset 020 and `AuthServiceImpl.login` **never checked it**.
Deactivating a user therefore did nothing at all to their ability to log in; only revoking their
refresh sessions did, and that merely shortened the window to their next password login. No test
caught it because until this plan nothing set the flag. The plan told me to confirm login refuses an
inactive user and to close it here if it does not — it did not.

**The refusal runs AFTER the bcrypt comparison.** Placed before it, a deactivated account would be
refused without a hash ever being computed, and the several-hundred-millisecond difference is a
reliable oracle for "this address had an account here and it was switched off" — usable by anyone,
with no credential at all. Reached only once the password has been verified, the work is identical
either way. The message is the same generic `"Invalid credentials"` every other refusal uses. The
failure **is** published with the user id, because unlike a wrong password this one names a real
account whose correct password someone just supplied — the event an operator wants after removing an
employee. `deleted_at` is checked alongside, so changeset 058's tombstones are not accounts.

Applied to `authenticateForTotpBootstrap` too: a bootstrap accepting a deactivated account would let
a removed employee enrol a second factor on it, which is a stronger foothold than the login it
stands in for.

**Not covered, and named rather than left to be found:** `refresh` does not re-check the flag. It is
closed in practice because deactivation revokes every unrevoked session in the same transaction, so
there is no session left to refresh — but a session created between the flag flip and the revoke
would survive. Logged in `deferred-items.md`.

---

## 6. Deviations from plan

**1. [Rule 2 — security] The whole acting-user seam and the ceiling on the write path.** Not in the
plan's task list; it is the brief's required addition. Full detail in §1. Commit `ef7c54e`.

**2. [Rule 2 — security] The ceiling applied to update / deactivate as well as to granting.** Beyond
the brief. A TENANT_ADMIN who can deactivate the OWNER locks the only holder of `rbac.manage` out of
their own tenant. Commit `b862e01`.

**3. [Rule 1 — bug] Login never read `is_active`.** §5. Commit `b862e01`.

**4. [Rule 3 — fixing what this change broke] user-service forwards `X-Acting-User-Id`.** Two files
outside auth-service, and stated here because the brief asked me to name any excursion. Making the
header required is a breaking change to a published internal contract (the same shape 13-06 made to
`provision-admin`), and without the other half every caller of the public
`POST /api/v1/users/{id}/branch-roles` receives 403 — a regression on a path that worked. Measured:
`phase13-role-catalog-e2e.sh` went 26/2 → **19/9** with the seam half-wired, and back to **26/2**
once forwarded. The value comes from `TenantContext`, i.e. the verified JWT's subject. I did **not**
add the Feign `ErrorDecoder` — that is 13-07's already-reported finding #2 and 13-12 owns the file.
Commit `95757a1`.

**5. [Scope — file list] Changeset numbered 058, not 057.** 13-07 took 057 three commits earlier.

**6. [Scope — file list] Five files beyond the plan's list**, each named above:
`gateway/.../StripInternalHeaderFilter.java` + its test (the strip the brief asked for),
`services/auth-service/.../RoleCeiling.java` and three exception types, and the four existing e2e
scripts whose seeding goes through the endpoint that now requires an identity.

**7. [Plan text corrected] "First determine whether email is unique globally, per tenant, or
unconstrained."** It is **per tenant already**, and has been since changeset 020. The plan's framing
implied the constraint might not exist; the real gap was case sensitivity. §3.

**8. [TDD — not followed, and saying so]** Task 2 is marked `tdd="true"` and I wrote
`UserLifecycleService` before `UserLifecycleIT`, so there is no RED commit for the lifecycle itself.
What I did measure first, and report above with its exact response body, is the **escalation** RED
against the running stack — which is the part of this plan where a red mattered. The lifecycle's
tests are genuine (22 of them, each negative with a control) but they were written green.

**9. [Out of plan scope] auth-service, user-service and the gateway were rebuilt; auth-service and
user-service were restarted** onto their new jars, so every live number below comes from a process
newer than its jar. auth-service's restart is also what applied changeset 058. The gateway was
already running a jar newer than my change (13-14 had restarted it at 03:31; my gateway edit is
covered by its own unit test rather than by a live assertion).

---

## 7. Verification actually run

Every number is from a command executed in the state being reported, with
`JAVA_HOME=openjdk@25`, `TESTCONTAINERS_RYUK_DISABLED=true`,
`TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`.

| Suite | Result |
|---|---|
| `mvn -pl services/auth-service -am verify` | **BUILD SUCCESS** |
| ├ auth-service unit | **28/28** |
| ├ auth-service IT | **148/148** (was 121) |
| │  ├ `UserLifecycleIT` | **22/22** (new) |
| │  ├ `AuthInternalBranchRoleIT` | **12/12** (was 7; +5 ceiling tests) |
| │  ├ `AuthTenantProvisioningIT` | 26/26 |
| │  ├ `AuthLoginIT` | 3/3 |
| │  ├ `RoleCatalogIT` | 11/11 |
| │  └ `TempPasswordPolicyTest` (unit) | **3/3** — kept green, untouched |
| └ shared-lib | unit **38/38**, IT **11/11** |
| `mvn -pl gateway -am verify` | **BUILD SUCCESS** — unit **52/52** (was 51), IT **22/22** |
| `mvn -pl services/user-service verify` | **BUILD SUCCESS** — unit **3/3**, IT **11/11** |
| `opa test policies/` | **139/139** (no `.rego` touched) |
| `bash scripts/e2e/phase13-user-lifecycle-e2e.sh` | **48 PASS / 0 FAIL, exit 0** — two consecutive runs |
| same script, `GATEWAY` at a dead port | **38 PASS / 8 FAIL, exit 1** — the harness can fail |
| trap cleanup | **0** `e2e-lifecycle-%` rows left, both tenants |
| `bash scripts/e2e/phase13-role-catalog-e2e.sh` | **26 PASS / 2 FAIL** — 13-07's exact baseline restored |
| Live escalation RED, before the change | **200**, `roleCode:OWNER`, `displacedRoleCode:WAITER` |
| Live escalation, after — internal | **403** `ROLE_CEILING_EXCEEDED`, 0 rows written |
| Live escalation, after — public, real TENANT_ADMIN JWT | auth-service **403** `ROLE_CEILING_EXCEEDED` (user-service maps it to 500 — finding below) |
| Changeset 058 on live `auth_db` as `auth_user` (NOSUPERUSER NOBYPASSRLS) | 3 changesets `EXECUTED`, both indexes present, `users` back to FORCE |
| 058 repair vs 3 planted case variants (rolled back) | 1 survivor by the stated rule, 2 tombstoned, **0 deleted**; re-run `UPDATE 0`; 4th variant refused; cross-tenant insert accepted |
| 058 repair **without** the NO FORCE bracket, as `auth_user` | **UPDATE 0 / UPDATE 0** — a naive repair silently repairs nothing |
| Live RLS posture | `users`, `roles`, `user_branch_roles`, `refresh_sessions` all **true/true** |

### Not green, and not mine

`bash scripts/e2e/phase13-roles-e2e.sh` — **19 PASS / 4 FAIL**, reproduced on two consecutive runs.
Its 13-02 baseline was 22/2. **All four are outside this plan and none touches the branch-role write
path** — its three assign assertions (`displacedRoleCode`, the single-valued roles claim, the
symmetric restore) all **PASS**, which is what my change to its seeding could have broken:

- two `503`s from the gateway on pos-service routes (pos-service is running; this is the
  cold-breaker / registration condition the runbook describes — noted, not diagnosed);
- `TOTP_REQUIRED` for the tenant admin — 13-02's documented "left failing #1" (D-29a); that script
  still needs `generate_totp.py --enroll` run by hand, unlike 13-07's, which enrols its own;
- a downstream `CONFLICT` on branch creation, consequent on the TOTP failure.

I did **not** prove these four by paired comparison against a stashed tree, so I am reporting them
as unproven-but-attributed rather than as confirmed pre-existing.

### GitNexus, run before editing (per CLAUDE.md)

The index is stale (last built at `5fba4a9`) and was **not** refreshed, for the reason 13-01 through
13-07 all gave: `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files, which
13-01 had to revert. The MCP tools were not available in this session and I am not reporting a
result I did not obtain. Blast radius was established by reading instead, and the two edits that
carried real risk are recorded here:

| Target | Change | Risk actually taken |
|---|---|---|
| `UserRepository` | **additive** — `findByEmail` untouched | LOW. `findByEmail` is on the login path; its signature and semantics are unchanged. |
| `BranchRoleAdminService.assign` | **not changed**; a new bounded entry point added above it | LOW in code, MEDIUM in contract — the *controller* now refuses a headerless request, which is the breaking change, and every caller is enumerated in commit `95757a1`. |
| `RoleCatalogService` | one predicate extracted to `RoleCeiling.permits` | LOW — `RoleCatalogIT` 11/11 unchanged. |
| `AuthServiceImpl.login` | one refusal added after the password check | **HIGH by position** — every authentication in the system runs through it. Hence the placement argument in §5 and `AuthLoginIT` + the live login/deactivate/reactivate chain. |

`detect_changes` was not used and I am not reporting a clean result from it; 13-07 recorded that it
answers "No changes detected" against a dirty tree, so its silence carries no information. Scope was
reviewed with `git diff --cached --stat` before each commit and every commit names its files.

---

## 8. Left for 13-12 — one finding, and the contract to implement

### The finding (unchanged from 13-07, and now the only thing between here and a green picker)

```
internal:  POST /internal/auth/users/{id}/branch-roles  {"roleCode":"OWNER"}   → 403 ROLE_CEILING_EXCEEDED  ✅
public:    POST /api/v1/users/{id}/branch-roles          same body             → 500 INTERNAL_ERROR         ❌
```

`AuthInternalClient` has no `ErrorDecoder`, so `FeignException.Forbidden` (and `BadRequest`) fall
through user-service's generic handler. **The refusal is correct and fail-closed; only its status is
wrong** — but a role picker cannot distinguish "you may not assign that" from "the platform broke".
One `ErrorDecoder`, or an `@ExceptionHandler(FeignException.class)` that re-emits 4xx with the
upstream body, fixes it and also closes 13-07's `400 UNKNOWN_ROLE_CODE → 500`. In user-service,
which 13-12 owns.

### The contract 13-12 must implement

1. **Send `X-Acting-User-Id` on every lifecycle write**, from `TenantContext.getUserId()` — the
   verified JWT's subject. `assignRole` already does; the five new calls must. Never from a body.
2. **Take the tenant from the gateway-injected tenant header**, as today. Do not add a second way.
3. **A client-side ceiling check is optional and is not the enforcement.** auth-service enforces it
   server-side and cannot be bypassed by anything reaching the internal port. A duplicate check in
   user-service buys a nicer message and nothing else; if you add one, derive it the same way (from
   `GET /api/v1/roles`, which already applies the ceiling) rather than hardcoding a role name.
4. **Map the errors through**: 400 `UNKNOWN_ROLE_CODE` / `VALIDATION_FAILED`, 403
   `ROLE_CEILING_EXCEEDED` / `ACTING_USER_REQUIRED`, 404 `NOT_FOUND`, 409 `STATE_INVALID`.
5. **Keep the public DTOs distinct from `UserDtos`** even where they coincide, so a later internal
   change is not automatically a public API break.

---

## Known stubs

None. Every symbol this plan created is wired and exercised — by an integration test, a live HTTP
assertion, or both.

## Threat flags

Where each register entry is closed:

- **T-13-11-A** (cross-tenant reads) — GUC first in every transaction **and** the tenant predicate
  in every query; asserted by ITs (where the policy is inert) and by the live script (where it is
  not), each with a control proving the neighbour's row exists and is returned for its own tenant.
  Cross-tenant fetch is **404**, and the body is asserted to contain neither the neighbour's address
  nor its tenant id.
- **T-13-11-B** (tenant id supplied by the caller) — unchanged and now stronger: `/internal/**` is
  secret-gated and unrouted (both asserted live), and 13-12 derives the tenant from the verified JWT.
- **T-13-11-C** (caller-supplied password) — create declares no such field; update **rejects** a body
  carrying one, across four field spellings, with a control that ordinary unknown fields still pass,
  and asserts nothing at all from the rejected body was applied.
- **T-13-11-D** (unvalidated role code) — `RoleCatalog.requireKnown` on both doors, **before** the
  ceiling test so an unknown code cannot pass vacuously; 400 naming the code; nothing written.
- **T-13-11-E** (temp password) — returned once; asserted absent from `password_hash` and from
  `event_outbox`; `toString()` redacted; the forced-change flag bounds its life, proved by walking
  the refusal-change-login chain.
- **T-13-11-F** (hard delete) — deactivation is a flag flip; the row **and** its assignment are
  asserted to survive, live and in an IT.
- **T-13-11-G** (a deactivated user retaining access) — login now refuses inactive accounts (a
  defect this plan found and closed), sessions revoked 1 → 0, and reactivation restores access, all
  asserted live with a control login beforehand.
- **T-13-11-H** (unbounded lists) — pagination mandatory, page size capped at 200 (asserted), and
  `idx_users_tenant_active_email` added in changeset 058.
- **T-13-11-SC** — did not arise. **No package of any kind was installed**, in any ecosystem. The
  search index that would have wanted `pg_trgm` was deliberately not added for that reason.

One flag beyond the register, and it is a **new trust boundary this plan creates**: `X-Acting-User-Id`
crossing the internal seam. It is an identity, not an entitlement; it is asserted by the calling
service from a verified JWT; it is stripped at the gateway; and auth-service recomputes the
authority it implies rather than trusting it. All four properties are asserted — the strip by a
gateway unit test with a control header that survives, the rest live.

## Self-Check: PASSED

All 12 created files exist on disk. All 5 commits (`cf16234`, `ef7c54e`, `b862e01`, `95757a1`,
`34d7f28`) exist in `git log`.
