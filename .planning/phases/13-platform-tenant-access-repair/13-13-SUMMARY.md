---
phase: 13-platform-tenant-access-repair
plan: 13
subsystem: admin-password-reset
status: complete
tags: [passwords, admin-reset, d-16, d-18, d-31, sc4, audit-actor, role-ceiling, rls, feign-errors]
requires:
  - running dev stack (postgres, redis, rabbitmq, eureka) + gateway, auth-service, user-service, platform-admin-service
  - "13-04: PasswordPolicyService — appendCurrentPasswordToHistory, revokeActiveRefreshSessions, clearLockout, setTenantGuc"
  - "13-06: ProvisioningAdminService.generateTempPassword, the tenant-GUC-first transaction pattern"
  - "13-08: the forced-change gate that makes must_change_password binding at login"
  - "13-09: the reset-token lifecycle, invalidateOutstanding, and D-31 (delivery ships disabled)"
  - "13-11: X-Acting-User-Id, RoleCeiling.permits / requireMayAdminister, findByIdForTenant"
  - "13-12: UpstreamErrorDecoder's three rules, UserAdminController's gating pattern"
provides:
  - "POST /api/v1/users/{userId}/reset-password — tenant tier, rbac.manage | rbac.user.manage"
  - "POST /api/v1/platform/tenants/{tenantId}/users/{userId}/reset-password — platform tier, SUPER_ADMIN"
  - "POST /internal/auth/users/{userId}/password-reset — the one routine both tiers call"
  - "AdminPasswordResetService + ActorTier{TENANT,PLATFORM} + AdminResetResult"
  - "AdminPasswordResetInternalController"
  - "AdminPasswordResetPayload — ADMIN_PASSWORD_RESET on auth.topic / auth.user.password_reset_by_admin"
  - "PasswordPolicyService.invalidateOutstandingTokens(userId) — retires BOTH purposes"
  - "PlatformUserAdminController + PlatformUserAdminService (NEW classes; PlatformAdminController untouched)"
  - "PlatformAdminExceptionHandler now maps FeignException — platform-admin had no Feign error handling at all"
  - "UserAdminDtos.AdminResetRequest / AdminResetResult"
  - scripts/e2e/phase13-admin-reset-e2e.sh
affects:
  - "13-15: THE seed script's only way to set a persona's password. Contract in §3."
  - "Phase 14: the tenant-admin UI's 'reset password' action codes against §3's shapes"
  - "every platform-admin delegating call: an upstream 4xx now surfaces as a 4xx, not a 500"
tech-stack:
  added: []
  patterns:
    - one guard with the tier as an argument, so a rule cannot drift between two public surfaces
    - name an audit field for the ROLE it plays, not for what it is, when two arguments share a type
    - assert the audit row on a PERSISTED row; a publisher can be called correctly with the wrong argument
    - check for a leaked credential by VALUE, not by key name — a key-set check passes against a rename
    - the absence of a field is the enforcement; a body field naming the actor is one a caller can fill in
    - plant a non-zero counter before asserting it was cleared, or the assertion is vacuous
    - a command substitution is a subshell, so a function called as "$( … )" cannot set a variable
key-files:
  created:
    - shared-lib/src/main/java/io/restaurantos/shared/event/payload/AdminPasswordResetPayload.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/AdminPasswordResetService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/AdminPasswordResetInternalController.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/AdminPasswordResetIT.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/PlatformUserAdminController.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/PlatformUserAdminService.java
    - services/platform-admin-service/src/test/java/io/restaurantos/platform/PlatformUserAdminIT.java
    - scripts/e2e/phase13-admin-reset-e2e.sh
  modified:
    - services/auth-service/src/main/java/io/restaurantos/auth/service/PasswordPolicyService.java
    - services/user-service/src/main/java/io/restaurantos/user/controller/UserAdminController.java
    - services/user-service/src/main/java/io/restaurantos/user/service/UserAdminService.java
    - services/user-service/src/main/java/io/restaurantos/user/client/AuthInternalClient.java
    - services/user-service/src/main/java/io/restaurantos/user/dto/UserAdminDtos.java
    - services/user-service/src/test/java/io/restaurantos/user/integration/UserAdminIT.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/client/AuthInternalClient.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/exception/PlatformAdminExceptionHandler.java
    - Docs/known-gaps/notification-delivery.md
decisions: [D-16, D-18, D-31]
requirements: [AUTH-06, USER-02, PLATFORM-05]
metrics:
  duration: ~2h
  completed: 2026-08-07
  tasks: 3
  commits: 3
---

# Phase 13 Plan 13: Administrator-Initiated Password Reset — Summary

**ROADMAP SC4 is complete.** An administrator resets another user's password at both tiers, the
reset genuinely unlocks a genuinely locked account, and the forced-change flag governs the next
login. Proved by `scripts/e2e/phase13-admin-reset-e2e.sh` — **48 PASS / 0 FAIL, exit 0, twice
consecutively** — every assertion through the real gateway against the RLS-enforcing database, with
the audit row read out of `event_outbox` rather than out of a response.

And because 13-09 (D-31) resolved that self-service forgot-password ships **disabled** — no consumer
exists, so no email can be sent — **this is the only working way to set a user's password in the
platform.** 13-15's seed script has no alternative.

---

## 1. The assertion that is the whole of D-18

```
[control] the victim can log in immediately before the lockout ......... 200
wrong-password attempt statuses: 401 401 401 401 401 423
the CORRECT password is now refused .................................... 423   ← genuinely locked
[control] the database shows a planted counter and a live lockout ...... 3|true
the tenant admin resets the locked user's password ..................... 200
read back from the ENFORCING database: 0|true|true ..................... counter, lockout, forced-change
the next login is the FORCED-CHANGE refusal, NOT the lockout ........... 403 PASSWORD_CHANGE_REQUIRED
the temporary password redeems the forced change ....................... 200
and the user is back in the product .................................... 200
the temporary password is spent ........................................ 401
```

A `423` on the seventh line would mean the reset "worked" and left the user exactly where they were
— locked out, having already done the only thing the error told them to do. That one line is the
difference between a reset and a no-op, and it is made from a **genuinely** locked account: five
real wrong passwords through the gateway, with a control proving the *correct* password was then
refused `423`.

**One piece of stagecraft, stated because it would otherwise be a vacuous pass.**
`handleFailedPassword` *zeroes* `failed_login_count` at the moment it trips the lock, so a genuinely
locked account already reads `0` there and "0 afterwards" would pass against a reset that did
nothing at all. The script plants `failed_login_count = 3` by SQL first and asserts on that — the
same trick 13-09 needed for the same column, for the same reason. The `locked_until` half needs no
help: the real lockout path set it.

---

## 2. The audit row names the REAL actor, and it is asserted on a PERSISTED row

13-14 found `ImpersonationService` could never write its audit row at all — an id assigned to a
`@GeneratedValue` entity made Spring Data call `merge()`, so every impersonation `409`'d while
recording itself — and before that, both impersonation controllers passed the **target** in the
acting-administrator position, so every row said a user had impersonated themselves. Two different
defects, one class: **anything that stops at the publisher is green against both.**

So every audit assertion here reads `event_outbox`. Live:

```
the reset wrote a PERSISTED audit row .................................. yes
the audit row names the TARGET whose password changed .................. 5948ad30-…
the acting administrator and the target are DIFFERENT values ........... eca6bbf2-… vs 5948ad30-…
the row says which tier acted .......................................... PLATFORM
the reason the operator gave is recorded verbatim ...................... "support ticket 4711"
the tenant tier's first row names the OWNER who made the call .......... fd634f53-…|TENANT
```

The two ids are **separate fields named for the ROLE they play** — `actingAdministratorId` and
`targetUserId` — not for what they are. The impersonation defect survived precisely because the two
arguments had the same type and a plausible name; naming them for their role is the cheapest thing
that makes a transposition read as wrong. The `AdminPasswordResetIT` case is chosen so the two are
genuinely different people, and the live case is stronger still: at the platform tier they are ids
from **different databases**.

### No credential material, checked by value

```
the audit payload contains no password material at all ................. pass
nor the password the user subsequently chose ........................... pass
the temporary password does not appear in any auth-service log ......... pass
no idempotency record captured the temp password ....................... 0
the stored value is a bcrypt hash and is not the password itself ....... t
```

Checked by **value**, not by key name. A key-set assertion passes against a payload that
republishes the credential under a harmless name — 13-09 falsified exactly that by republishing a
raw token under the key `tokenId`, and the key-set check stayed green.

The idempotency assertion is there because 13-10 found `platform_db.idempotency_keys.response_json`
is a plain text column that nothing ever purges. **Neither endpoint takes an idempotency key**, and
the platform one says in its javadoc why it must not grow one. A repeated reset is harmless and
honest: it mints a new temporary password and audits a second row, which is what actually happened.

---

## 3. The contracts — 13-15 and Phase 14 code against these

```jsonc
// TENANT TIER — gate: hasAnyAuthority('rbac.manage','rbac.user.manage')
POST /api/v1/users/{userId}/reset-password
  {"reason":"staff member forgot their password"}
→ 200 {"data":{"userId":"…","email":"…","tempPassword":"…","mustChangePassword":true}}

// PLATFORM TIER — gate: hasAuthority('SUPER_ADMIN')
POST /api/v1/platform/tenants/{tenantId}/users/{userId}/reset-password
  {"reason":"support ticket 4711"}
→ 200 {"data":{"userId":"…","email":"…","tempPassword":"…","mustChangePassword":true}}

// INTERNAL — the one routine both call. Headers: X-Internal-Service, X-Tenant-Id, X-Acting-User-Id
POST /internal/auth/users/{userId}/password-reset
  {"actorTier":"TENANT"|"PLATFORM","reason":"…"}
```

| Condition | Answer |
|---|---|
| missing / blank `reason` | **400** `VALIDATION_FAILED` — required at both tiers |
| target in another tenant, or nowhere | **404** `NOT_FOUND` — identical bodies, so the pair is not an oracle |
| tenant-tier caller aiming above its ceiling | **403** `ROLE_CEILING_EXCEEDED` |
| caller lacking the authority | **403** · anonymous | **401** |
| tenant token on the platform endpoint | **403** |
| upstream fault | **502** `UPSTREAM_ERROR` |

**Neither request DTO declares an acting-administrator field, and the absence IS the enforcement**
(T-13-13-G). The actor is the verified JWT's subject — `TenantContext.getUserId()` at the tenant
tier, `JwtClaims.subject()` at the platform tier. Asserted live and by test: a body naming an
impostor produces a request in which that id appears in **no position at all**.

**What a reset does, in one place:** new temporary password (the shared generator, so
`TempPasswordPolicyTest`'s 2000-draw property keeps holding) · `must_change_password = true` ·
`failed_login_count = 0` · `locked_until = null` · previous hash appended to history · every
outstanding single-use token retired · every unrevoked refresh session revoked · one audit event.

### For 13-15 specifically

Provisioning already returns a temp password for a tenant's first admin, and `POST /api/v1/users`
returns one for each created persona — so the seed's normal path is **create → forced change**, and
it needs this endpoint only to *repair* a persona whose password it has lost, or to set one for an
account it did not create. `PASSWORD_RESET_DELIVERY_MODE` does not need changing; 13-09 already said
so and this plan is why that remains true.

---

## 4. One routine, two entry points — and what is deliberately NOT forked

The tier is an **argument**, not a second implementation:

| | tenant tier | platform tier |
|---|---|---|
| gate | `rbac.manage` \| `rbac.user.manage` | `SUPER_ADMIN` |
| actor id space | `auth_db.users` | `platform_db.platform_users` |
| role ceiling | **applies** | **exempt** (T-13-13-F, accepted) |
| tenant | from the verified JWT | from the path |

**The ceiling is `RoleCeiling.requireMayAdminister` — 13-11's method, not a copy.** Setting somebody's
password is strictly stronger than editing their profile (it is taking their account), so the rule
that already bounds "may I deactivate the OWNER" must bound this. Reusing it means a tenant admin is
refused the OWNER by *derivation from `role_permissions`*, not by a hardcoded role name that would
be wrong the moment a role is added.

**The platform tier is exempt on the merits, and there is also nothing to compare against.** A
platform id holds no `user_branch_roles`, so a ceiling check would resolve the empty permission set
and refuse *every* platform reset. More importantly, the case that most needs a platform reset is
exactly the one no tenant can resolve for itself: a tenant that has lost its OWNER's password, where
the ceiling correctly refuses every remaining insider. `PlatformUserAdminService`'s javadoc states
what the capability costs — a SuperAdmin can take over any account in any tenant — and lists the
four things that compensate rather than pretending a check exists.

**`PlatformAdminController` was not modified.** Verified: `git diff --name-only` against the plan's
base names it zero times. `PlatformUserAdminController` is a new class carrying the same
`SUPER_ADMIN` annotation spelled out rather than inherited, because an authorization annotation that
arrives by inheritance is one a reader of the file cannot see.

---

## 5. 13-09's open question, answered

> *"Whether an ADMIN-initiated reset should be subject to the same cooldown — 13-13's decision."*

**It is not, and it cannot be: this routine issues no token at all.** It sets a password directly,
so `issueSingleUseToken` — where the cooldown and its advisory lock live — is never reached.

That is also the right answer on the merits. The cooldown exists to bound how many messages one
*account* can be made to receive by an anonymous caller, and to keep the refusal from becoming an
account-existence oracle. Neither applies to a call that is authenticated, authorised, tier-gated,
reason-bearing and audited by name. What bounds an admin reset instead is the authority gate at each
tier, the role ceiling, the gateway's per-IP budget on the route, and the audit row — which names
who, whom and why, every time.

---

## 6. Row-level security — how I convinced myself, against a real enforcing database

`users` is `ENABLE` + `FORCE ROW LEVEL SECURITY` and the live `auth_user` is `NOSUPERUSER
NOBYPASSRLS`, while **Testcontainers' Postgres user is a SUPERUSER, so the policy is inert in every
integration test in this repository.** Six paths this phase shipped green-and-broken that way. Three
independent things, only one of which is a test:

**(a) The GUC is the first statement of the transaction.** `setTenantGuc` precedes every RLS-scoped
read and write in `AdminPasswordResetService.reset`, so the GUC and the statements share one
connection.

**(b) The tenant predicate is in the QUERY too.** The target is resolved with 13-11's
`findByIdForTenant`, which carries `tenant_id = :tenantId`. Two independent controls, and this is
the half CI can assert — `AdminPasswordResetIT` writes the neighbouring tenant's row *with that
tenant's GUC set*, asserts it exists, then asserts it is unreachable and that its `password_hash` is
byte-identical afterwards. Without the control, "the neighbour was not found" is satisfied by an
INSERT the policy refused.

**(c) The live script runs against the enforcing database**, where auth-service's runtime connects
as `auth_user`. It provisions **two real tenants** through the platform API, both with real admins
who have really logged in, and asserts the boundary in both directions with a control:

```
tenant A → reset tenant B's admin ............... 404   (control: B's admin still logs in with its OWN password)
an id that exists NOWHERE ....................... 404   (identical, so the pair is not an oracle)
the 404 body names B's email or tenant id? ...... no
```

A cross-tenant assertion against a fabricated UUID proves only that a random id is not found, which
is true of a completely broken API. Every negative here is paired with the positive that makes it
mean something.

**What a mistake here would have looked like:** not an error. An RLS-hidden row means "user not
found", which means a *refusal* — this path fails **closed**, unlike 13-09's cooldown, which failed
open. That is a smaller danger and it is stated rather than glossed: the assertion that could
distinguish a GUC bug from a correct refusal is the **positive** one, the tenant-tier reset
answering 200 and the columns reading back `0|true|true` from the enforcing database.

---

## 7. Deviations from plan

**1. [Rule 2 — security, beyond the plan] `PasswordPolicyService.invalidateOutstandingTokens`.** An
account being reset by an administrator is frequently one somebody has lost control of. A `RESET`
token minted before the reset would let whoever holds it choose a new password and — because
reset-confirm clears `must_change_password` (13-09) — walk straight past the forced-change gate the
reset just raised. The takeover would survive the undoing. Both purposes are retired, unlike
`issueSingleUseToken`'s deliberately narrower per-purpose retirement. Commit `e4f9c88`.

**2. [Rule 3 — blocking, caused by this plan] `PlatformAdminExceptionHandler` now maps
`FeignException`.** platform-admin-service had **no Feign error handling of any kind**, so this
service's first delegating write would have reported an upstream `404` as `500 INTERNAL_ERROR` —
the exact hole 13-12 measured and closed in user-service, open here the moment platform-admin grew a
call like this. Same three rules: a 4xx keeps its status and code; a 5xx never becomes a 4xx; and
`401` / `INTERNAL_AUTH_REQUIRED` / `ACTING_USER_REQUIRED` read as **502**, because all three
describe *our* misconfiguration and echoing them would ask an authenticated SuperAdmin to go and
obtain an authority over a fault they cannot see. `FeignException.getMessage()` names the internal
scheme, host, port and path; it is logged, never returned — asserted by content. Commit `7e83b43`.

**3. [Rule 2 — one policy, one implementation] The reuse rule is deliberately NOT applied.**
`rejectIfPasswordReused` exists to stop a *human* cycling back to a password they have used before.
The value here is 16 random characters from `SecureRandom` that nobody chose and nobody will
retype, and refusing a reset because a generated string collided with history would be an outage
with no cause a user could act on. History is still **appended**, so the rule keeps applying to
every password the human subsequently chooses. Stated because "why does the admin reset skip a check
the other three password paths run" is otherwise a reasonable thing to suspect of being an oversight.

**4. [Design, worth defending] `TenantContext.set(tenantId, null, null, null)` before publishing.**
`DomainEventPublisher` reads the outbox row's `tenant_id` from `TenantContext`, and an internal
request carries no JWT, so nothing populates it — without this the publish throws and the whole
reset rolls back. `PasswordResetService.request` does the same for the same reason. The **user id is
deliberately left null**: at the platform tier the acting id belongs to a different database, and
putting a foreign id space into a tenant-scoped context would make anything that later reads it draw
a false conclusion. Who did it is recorded where it belongs — in the payload, beside the tier that
says which id space it is.

**5. [Scope — files beyond the plan's list] Four.** `shared-lib/.../AdminPasswordResetPayload.java`
(the plan asked for a typed payload record but did not list the file),
`services/user-service/.../dto/UserAdminDtos.java` (the public request/response shapes),
`services/platform-admin-service/.../exception/PlatformAdminExceptionHandler.java` (deviation 2), and
`Docs/known-gaps/notification-delivery.md` (deviation 6).

**6. [Beyond the plan] `Docs/known-gaps/notification-delivery.md` updated.** 13-09 wrote that
document naming plan 13-13 as the recovery path that replaces the disabled flow. That path now
exists, so the document says so, gives both endpoint paths, and names the script that measures it.
A gap document that describes a promised alternative as though it were still promised is worse than
one that is out of date, because a reader cannot tell which.

**7. [Out of plan scope, no source touched] Three services rebuilt and restarted; a fourth
un-wedged.** auth-service, user-service and platform-admin-service were restarted onto their new
jars. Separately, **pos-service was found wedged** — process alive, listening on 8084, registered
`UP` in Eureka, and answering nothing at all including `/actuator/health`, so the gateway routed to
it and got `503`. That accounted for two of the failures in `phase13-roles-e2e.sh`. Restarted; it
answered `200` afterwards and both assertions passed. Noted rather than diagnosed, as instructed. I
also note that `phase13-reset-hardening-e2e.sh` restarts auth-service twice by design (13-09), which
is why the auth-service process serving the final checks (PID 25918, 05:03:20) is not the one I
started (20089, 04:55:28) — same jar, and both newer than it.

**8. [Out of plan scope, no tracked file touched] macOS `" 2"` duplicate class files under
`*/target/`** broke surefire twice with `TestFixtures 2 (wrong name: …)`. The failure 13-01, 13-03,
13-04, 13-09 and 13-12 all recorded. Deleted only paths inside `target/`.

---

## 8. The 13-12 loose end, closed

13-12 changed the moved permissions path in `scripts/e2e/phase13-roles-e2e.sh` and **did not run
it**, reporting no number. Run here:

```
bash scripts/e2e/phase13-roles-e2e.sh → 23 PASS / 1 FAIL
PASS: tenant admin may read a user's resolved permissions (200)   ← 13-12's edit, verified
```

**Its edit is correct.** The script went 19/4 (13-11's recorded state) → **23/1**. Two of the four
were the wedged pos-service (deviation 7) and cleared on restart; one was consequent on the third.

**The one remaining failure is 13-02's documented "left failing #1" (D-29a):** the tenant admin is
challenged `TOTP_REQUIRED`, because that script — unlike 13-07's and unlike the one this plan wrote
— does not enrol its own second factor and still expects `generate_totp.py --enroll` to have been
run by hand. Not mine, not touched, and unchanged in cause since 13-02 recorded it.

---

## 9. Verification actually run

Every number is from a command executed in the state being reported, with
`JAVA_HOME=openjdk@25`, `TESTCONTAINERS_RYUK_DISABLED=true`,
`TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`.

| Suite | Result | Baseline |
|---|---|---|
| `mvn -pl services/auth-service -am verify` | **BUILD SUCCESS** | — |
| ├ auth-service unit | **28/28** | unchanged |
| ├ auth-service IT | **157/157** | was 150 (+7 `AdminPasswordResetIT`) |
| └ shared-lib | unit **38/38**, IT **11/11** | unchanged |
| `mvn -pl services/user-service verify` | **BUILD SUCCESS** | — |
| ├ user-service unit | **16/16** | unchanged |
| └ user-service IT | **33/33** | was 29 (`UserAdminIT` 18 → 22) |
| `mvn -pl services/platform-admin-service verify` | **BUILD SUCCESS** — IT **78/78** | was 70 (+8 `PlatformUserAdminIT`) |
| `mvn -pl gateway -am verify` | **BUILD SUCCESS** — unit **52/52**, IT **22/22** | unchanged; no gateway file touched |
| `opa test policies/` | **139/139** | unchanged; no `.rego` touched |
| `bash scripts/e2e/phase13-admin-reset-e2e.sh` | **48 PASS / 0 FAIL, exit 0**, twice | new |
| `bash scripts/e2e/phase13-role-catalog-e2e.sh` | **28 PASS / 0 FAIL** | held |
| `bash scripts/e2e/phase13-tenant-admin-users-e2e.sh` | **56 PASS / 0 FAIL** | held |
| `bash scripts/e2e/phase13-user-lifecycle-e2e.sh` | **48 PASS / 0 FAIL** | held |
| `bash scripts/e2e/phase13-reset-hardening-e2e.sh` | **31 PASS / 0 FAIL** | held |
| `bash scripts/e2e/phase13-superadmin-e2e.sh` | **21 PASS / 0 FAIL** | held |
| `bash scripts/e2e/phase13-subscription-e2e.sh` | **51 PASS / 0 FAIL** | held (see below) |
| `bash scripts/e2e/phase13-roles-e2e.sh` | **23 PASS / 1 FAIL** | was 19/4 — §8 |
| trap cleanup | **0** tenants, **0** disposable users | — |

`phase13-subscription-e2e.sh` failed once at setup with "the SuperAdmin could not log in", run
immediately after five other scripts. A direct `POST /api/v1/platform/auth/login` seconds later
answered **200**, and a re-run after a 20-second pause was **51/0**. Consistent with the gateway's
`platform-auth-route` budget rather than with anything this plan touched — `platform_login` retries
only on the `SERVICE_UNAVAILABLE` body, not on a 429. Reported rather than quietly re-run.

### The RED, measured rather than asserted

| Gate | Measured RED |
|---|---|
| Task 1 (`AdminPasswordResetIT`, endpoint absent) | **7 run, 4 failures + 1 error** — every reset `404` |
| Task 1, after the endpoint existed | **500** — `TenantContext is empty` from `DomainEventPublisher` (deviation 4) |
| Task 3 (the live script) | **43 PASS / 5 FAIL, exit 1** — three harness bugs, §10 |

**The RED passes, named — because a red that flatters itself is how a vacuous test ships:**

- `reset_aTargetInAnotherTenantIsNotFound` **passed for the wrong reason** in RED: with no endpoint,
  *everything* is 404, so the assertion was satisfied by the absence of the feature it tests. It only
  became meaningful once the sibling assertions went green.
- `reset_isRefusedWithoutTheInternalSecret` was **genuinely correct** in RED — it guards
  `InternalServiceFilter`, which already existed and which this plan must not disturb.

### The harness can fail, demonstrated rather than claimed

Three runs in this session reported `FAIL` lines and a non-zero exit: the live script's first two
(unbound variable, then 43/5), and `AdminPasswordResetIT`'s two RED runs.

---

## 10. Three harness bugs found by running it, each a false signal about the product

Recorded because each reported a defect that was not there.

1. **`boolean::text` is `'true'`, not `'t'`.** `psql -qtA` *displays* a boolean as `t`, but
   concatenating with `||` casts it first — so `SELECT failed_login_count || '|' || (locked_until IS
   NULL)` yields `0|true`. Two assertions reported the lockout state as wrong when it was exactly
   right.
2. **`enrol_and_login` is always called as `"$( … )"`, which is a SUBSHELL.** Its
   `LAST_TOTP_SECRET=$secret` could never reach the parent shell, so every later step-up login was
   sent with an empty TOTP code and answered `401 TOTP_REQUIRED` — which reads exactly like "the
   password is wrong". **Three assertions reported password corruption that had not happened**,
   including "the refused reset left the OWNER's password untouched". Secrets are now written to a
   file, one per address.
3. **That OWNER control was `assert_not_status 401`,** which an account requiring step-up satisfies
   whether or not its password changed — so it could not distinguish the two cases it existed to
   distinguish. Now a positive `assert_status 200` with a real TOTP code.

Every one of these was found by running the script, and each had to be diagnosed before its
assertion meant anything. That density is the point.

---

## 11. Left open, and not claimed to work

1. **`phase13-roles-e2e.sh`'s TOTP failure is still open** — 13-02's D-29a item. The fix is to make
   that script enrol its own factor the way 13-07's and this plan's do. One assertion, not mine.
2. **The gateway rate limit on the two new public routes is inherited, not measured.** They ride the
   existing `/api/v1/users/**` and `/api/v1/platform/**` route budgets. 13-04, 13-08 and 13-09 all
   flagged the same unmeasured inheritance for their own paths, and the subscription-script blip in
   §9 is the first time this session that a budget appears to have actually bitten.
3. **`ADMIN_PASSWORD_RESET` has no consumer**, like every other event on `auth.topic`. It is durable
   in `event_outbox`, which is what an audit trail needs, but nothing alerts on it. A SuperAdmin
   resetting a tenant OWNER is exactly the event an operator would want pushed rather than queried.
4. **Concurrency is not exercised.** Two simultaneous resets of the same user would both succeed and
   the second temporary password would win — harmless (the loser is simply not the stored hash) but
   unmeasured, and the same gap 13-09 recorded for its advisory lock.
5. **The tier discriminator is trusted from the calling service.** Like `X-Acting-User-Id`, it is
   unreachable from a client — no gateway route, a shared-secret filter, and both callers send a
   constant — but a *third* internal caller written without reading
   `AdminPasswordResetService.ActorTier` could send `PLATFORM` and switch the ceiling off. There is
   no server-side way to verify it, because the two id spaces live in different databases. Stated so
   it is a decision rather than an oversight.

---

## Known stubs

**None.** Every symbol this plan created is wired and exercised — by an integration test, a live HTTP
assertion, or both. No placeholder, no hardcoded empty value, no component without a data source.

## Threat flags

Where each register entry is closed:

- **T-13-13-A** (reset as an account-takeover primitive) — gated by the tier-appropriate authority
  at each door, tenant scope from the verified JWT, and a tenant-tier caller cannot reset above its
  own ceiling. All four tenant-tier refusals asserted live, the ceiling one **with a control proving
  the same caller CAN reset ordinary staff** — without it the 403 is satisfied by a caller who
  simply lacks the authority.
- **T-13-13-B** (cross-tenant reset) — GUC first in the transaction **and** the tenant predicate in
  the query; 404 for another tenant and identically for an id that exists nowhere; proved against a
  second genuinely provisioned tenant, with a control showing that tenant's admin still logs in with
  its own password afterwards.
- **T-13-13-C** (audit naming the wrong actor) — actor and target are distinct typed fields named
  for their roles, asserted distinct in an IT and in the live outbox read, at a tier where they are
  ids from different databases. The actor comes only from the verified principal; a body naming an
  impostor puts that id in no position at all, asserted at both tiers.
- **T-13-13-D** (temporary password handling) — returned once to the authorised administrator;
  asserted absent from the audit payload **by value**, from the auth-service log, from
  `idempotency_keys.response_json`, and from `password_hash`; `toString()` redacted on all four
  result records; the forced-change flag bounds its life, proved by walking
  lock → reset → refusal → change → login → the temp password now 401.
- **T-13-13-E** (reset used to lock a rival out) — `reason` is `@NotBlank` at both tiers and
  re-checked after trimming in the service; refused with 400 live at both, with nothing delegated;
  recorded verbatim in the event.
- **T-13-13-F** (platform tier resetting any tenant user) — **accepted**, deliberately, and stated
  in `PlatformUserAdminService`'s javadoc rather than glossed. Compensated by the audit event, the
  `SUPER_ADMIN` gate, the short non-refreshable platform token, the rate-limited route, and the
  forced-change flag that stops the operator's credential working once the tenant's own person uses
  it.
- **T-13-13-G** (acting-administrator id from the request body) — neither public DTO declares such a
  field, so there is nothing for Jackson to bind and no branch that could honour one. Asserted at
  both tiers with a body naming an impostor.
- **T-13-13-SC** — did not arise. **No package of any kind was installed, in any ecosystem**, and no
  Maven dependency was added. The one place a dependency was the obvious answer — JSON parsing in
  the new Feign error handler — used the `ObjectMapper` already on the classpath.

## GitNexus, per CLAUDE.md

The index is stale (last built at `5fba4a9`) and was **not** refreshed, for the reason 13-01 through
13-12 all gave: `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files, which
13-01 had to revert. The MCP tools were not available in this session and I am not reporting a
result I did not obtain; the pre-tool hook surfaced related symbols on several calls and confirmed
`generateTempPassword`'s only caller was `provisionAdmin`. Blast radius was established by reading:

| Target | Change | Risk actually taken |
|---|---|---|
| `PasswordPolicyService` | **additive** — one new method | LOW. No existing signature or behaviour changed; the full auth IT suite (157) ran green, including every password and login class. |
| `RoleCeiling` | **not changed** — reused | LOW, and that is the point: forking it was the available mistake. |
| `UserAdminController` / `UserAdminService` | one endpoint added | LOW — additive; `UserAdminIT` 22/22 and three live scripts. |
| `PlatformAdminExceptionHandler` | new `@ExceptionHandler` | **MEDIUM** — it now intercepts every `FeignException` in the service, including provisioning's. Hence the full platform IT suite (78) and `ProvisioningSagaIT` green, plus `phase13-subscription-e2e.sh` 51/0. |
| `PlatformAdminController` | **untouched** | — verified zero times in `git diff --name-only`. |

`detect_changes` was not used and I am **not** reporting a clean result from it; 13-07, 13-11 and
13-12 all recorded that it answers "No changes detected" against a dirty tree, so its silence
carries no information. Scope was reviewed with `git status --short` before each commit and every
commit names its files explicitly.

## Self-Check: PASSED

All 8 created files exist on disk. All 3 commits exist in `git log`: `e4f9c88` (the auth-service
routine), `7e83b43` (both entry points), `3460568` (the live script).
