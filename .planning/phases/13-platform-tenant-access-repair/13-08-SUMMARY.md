---
phase: 13-platform-tenant-access-repair
plan: 08
subsystem: auth-passwords
tags: [passwords, forced-change, single-use-tokens, rls, liquibase, login-gate, d-17, d-29a, sc4]
status: complete
requires:
  - running dev stack (postgres, redis, rabbitmq, eureka) + gateway, auth-service, user-service
  - "13-01: /api/v1/auth/change-password/forced already in the gateway's PUBLIC_PATHS, fully qualified"
  - "13-04: PasswordPolicyService, PasswordChangeService.changeOwnPassword, @StrongPassword"
  - "13-06: provision-admin sets must_change_password; scripts/e2e/_phase13-lib.sh"
provides:
  - "POST /api/v1/auth/change-password/forced (PUBLIC at gateway and service; change token + current password)"
  - "403 PASSWORD_CHANGE_REQUIRED login refusal carrying a change token in error.details"
  - PasswordChangeRequiredException
  - ForcedPasswordChangeRequest
  - "PasswordPolicyService.TokenPurpose / IssuedToken / RedeemedToken / issueSingleUseToken / redeemSingleUseToken / hashToken"
  - "PasswordResetTokenRepository.claimIfRedeemable / invalidateOutstanding / findByTokenHashAndPurpose"
  - "changeset 061: password_reset_tokens.purpose + check constraint + hash/purpose index"
  - "forced_change and change_token_from helpers in scripts/e2e/_phase13-lib.sh"
  - scripts/e2e/phase13-forced-change-e2e.sh
  - "a WORKING forgot-password flow — reset-confirm had never once succeeded against an RLS-enforcing database"
affects:
  - "every login in the platform: AuthServiceImpl.login gains a branch before permission resolution"
  - "13-10: the saga must treat 403 PASSWORD_CHANGE_REQUIRED as provisioning SUCCESS"
  - "13-11: every created user carries the flag, so every created user's first login is refused"
  - "13-15: each persona must complete a forced change; the recipe is in the seam script"
  - "13-09: it inherits a reset path that WORKS, is purpose-scoped, and invalidates outstanding tokens"
tech-stack:
  added: []
  patterns:
    - single use is a conditional UPDATE, never a read-then-write
    - a token carries its own tenant routing prefix, so a public flow needs no privileged DB object
    - failing the password POLICY is recoverable; failing AUTHENTICATION spends the token
    - measure a security control against the RLS-enforcing database, never against Testcontainers' superuser
    - two gates on one account are met one at a time, each with its own code and status
key-files:
  created:
    - services/auth-service/src/main/java/io/restaurantos/auth/exception/PasswordChangeRequiredException.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/request/ForcedPasswordChangeRequest.java
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/061-password-token-purpose.xml
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/ForcedPasswordChangeIT.java
    - scripts/e2e/phase13-forced-change-e2e.sh
  modified:
    - services/auth-service/src/main/java/io/restaurantos/auth/service/AuthServiceImpl.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/PasswordPolicyService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/PasswordChangeService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/PasswordResetService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/PasswordChangeController.java
    - services/auth-service/src/main/java/io/restaurantos/auth/exception/AuthExceptionHandler.java
    - services/auth-service/src/main/java/io/restaurantos/auth/entity/PasswordResetTokenEntity.java
    - services/auth-service/src/main/java/io/restaurantos/auth/repository/PasswordResetTokenRepository.java
    - services/auth-service/src/main/java/io/restaurantos/auth/config/SecurityConfig.java
    - services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/AuthTenantProvisioningIT.java
    - scripts/e2e/_phase13-lib.sh
    - scripts/e2e/phase13-auth-provisioning-seam-e2e.sh
    - scripts/e2e/phase13-role-catalog-e2e.sh
decisions: [D-17, D-12, D-29a, D-30]
requirements: [AUTH-01, AUTH-06]
metrics:
  duration: ~3h
  completed: 2026-08-07
  tasks: 3
  commits: 6
---

# Phase 13 Plan 08: Forced Password Change at Login — Summary

`must_change_password` now governs login. A temporary credential that is never forced to change is
a permanent credential, and until this plan the flag was written at provisioning and read nowhere —
so every admin the platform has ever provisioned kept its temporary password forever.

Along the way this plan found and fixed a second, larger thing that was not in it: **the
forgot-password flow had never once worked against a database that enforces row-level security.**
Details in "The bug that was not in the plan" below.

## The four facts 13-15 depends on

| Fact | Value |
|---|---|
| Refusal code | **`PASSWORD_CHANGE_REQUIRED`**, HTTP **403** |
| Forced-change path | **`POST /api/v1/auth/change-password/forced`** (public at the gateway AND at the service) |
| Change-token TTL | **10 minutes** (`PasswordPolicyService.TokenPurpose.FORCED_CHANGE`) |
| Harness helper | `forced_change <changeToken> <currentPassword> <newPassword>` — prints **status on line 1, body on the rest** |

Its companion, also in `_phase13-lib.sh`: `change_token_from <loginRefusalBody>` extracts the token
from the refusal, and returns 1 (printing nothing) when the response is not a forced-change refusal.

The refusal body:

```jsonc
{"error": {"code": "PASSWORD_CHANGE_REQUIRED",
           "message": "Password change required before this account can be used",
           "details": [{"field": "changeToken", "issue": "<tenantId>.<43 chars>"},
                       {"field": "expiresAt",   "issue": "2026-08-07T00:12:34.567Z"}],
           "traceId": "…"}}
```

No access token, no permission claim, no refresh token, **no `Set-Cookie`** — all four asserted over
live HTTP, not inspected.

## What happens when an account needs BOTH gates

A freshly provisioned OWNER carries a temporary password *and* holds `rbac.manage` with no enrolled
factor (D-29a). It meets both obligations, one at a time, in this order:

```
login #1   403 PASSWORD_CHANGE_REQUIRED     (D-17, this plan)
           -> POST /change-password/forced  200
login #2   401 TOTP_ENROLLMENT_REQUIRED     (D-29a, untouched)
           -> POST /2fa/bootstrap + /verify  200
login #3   200, a real token with 65 permission codes
```

Measured live, in that sequence, by `phase13-auth-provisioning-seam-e2e.sh`, and pinned as an
integration test by `AuthTenantProvisioningIT.provisionAdmin_asOwner_getsPastBranchResolutionAndIsAskedToEnrolTotp`.

**Neither gate is suppressed and the order is deliberate.** Enrolling a second factor while the
first is still a temporary password *that whoever provisioned the account also knows* would bind
that factor under a credential the admin does not exclusively control. Password first, then factor.

The two are also kept distinguishable at the wire level on purpose — different code, different
status (403 vs 401). A client that retried a 401 by re-prompting for the password would loop
forever against a forced-change gate, which is exactly why it is not a 401.

## Why the login is refused rather than given a restricted token

The plan offered two designs and this is the recorded rationale for the one taken, restated because
it is the load-bearing decision: an access token with an emptied permission list and a marker claim
is **still a structurally valid access token** to every filter, gateway rule and `@PreAuthorize`
expression in twenty services. Its safety would depend on every current *and future* authorization
check treating an empty permission list as a refusal — an invariant nobody can hold. A refusal is
checkable in exactly one place, and this plan added exactly one place.

Consequence, accepted and now proven rather than assumed: **every caller that provisions a user must
expect its first login to be refused.** Three integration tests and one live script had to learn
this during the plan (below).

## How I satisfied myself the change token cannot be replayed

The endpoint is public, so its own proof has to be at least as strong as the login it stands in for.
Six independent properties, each measured rather than reasoned about:

1. **Two proofs, not one.** A single-use change token AND the current password. The token alone is
   useless; the password alone cannot reach the endpoint. The account comes from the token, never
   from the request — `ForcedPasswordChangeRequest` has no field naming an account, and the IT sends
   `userId` and `email` naming a *different* user and asserts that user's hash is byte-identical
   afterwards.
2. **256 bits of entropy**, `SecureRandom`, and **only the SHA-256 is persisted**. Asserted twice:
   the IT scans every row of the token table for the raw value and for its hash; the live script
   queries `token_hash = '<the raw token>'` and gets 0 rows.
3. **Single use is a conditional `UPDATE`, not a read-then-write.**
   `claimIfRedeemable(hash, purpose, now)` sets `used_at` only `WHERE used_at IS NULL AND expires_at
   > now`, and the caller treats a rowcount other than 1 as refusal. Under READ COMMITTED, two
   concurrent redemptions of the same token cannot both succeed: the second blocks on the first's
   row lock, re-evaluates its `WHERE` against the committed new version, and reports 0 rows. A
   read-check-write would have let both through.
4. **Ten-minute expiry**, a third of the reset token's thirty. A reset token has to survive a human
   noticing an email; this one's entire useful life is the seconds between a refused login and a
   submitted form.
5. **Issuing retires the outstanding one.** Without it, every refused login would mint another live
   credential and leave the previous ones alive, so an attacker who saw one once would keep a usable
   window open by doing nothing. Asserted: token A then token B ⇒ A is refused, B works.
6. **A wrong current password SPENDS the token.** The claim is committed via
   `noRollbackFor = AuthenticationFailedException`, so an attacker holding a stolen token gets one
   guess rather than ten minutes of them. It costs a legitimate fumbler nothing — a change token is
   only ever issued to someone who has *just* supplied the correct password, so they log in again.

And the deliberate asymmetry that makes (6) safe to have:

| The caller got wrong | Result | Token afterwards |
|---|---|---|
| the new password's **strength** | 400 `VALIDATION_FAILED` (bean validation, before any service) | **still spendable** |
| the new password **reuses a recent one** | 400 `PASSWORD_REUSE` (transaction rolls back, claim with it) | **still spendable** |
| the **current password** | 401 `Invalid credentials` (`noRollbackFor` commits the claim) | **spent** |

Failing the *policy* is a fumble and must be recoverable, or a user who mistypes is locked out of
their own recovery. Failing *authentication* is an attack signal and must cost something. All three
rows are asserted, in both the IT and the live script.

## The account-existence oracle, closed and measured

A flag that changes what a login says is an oracle unless the branch sits after the password check.
It does, and this is asserted by comparing **bodies**, never statuses:

```
wrong password, FLAGGED account      401  {"code":"UNAUTHENTICATED","details":[],"message":"Invalid credentials"}
wrong password, UNFLAGGED account    401  … identical …
wrong password, NO SUCH ACCOUNT      401  … identical …
a fabricated change token            401  … identical …
```

The last line matters as much as the first: the forced endpoint's own generic refusal is the same
string every other authentication failure in the service uses, so a public endpoint that mutates
credentials tells an anonymous caller nothing at all. Every token defect — malformed, wrong tenant,
absent, wrong purpose, expired, already spent, superseded — produces that one body.
`everyDefectInAPresentedToken_producesOneIdenticalFailure` byte-compares four of them **and carries
a control that a valid token still returns 200**, so it cannot pass against an endpoint that simply
refuses everything.

## Exactly one password path is public, and it is asserted from outside

`/api/v1/auth/change-password/forced` is registered:

- at the **gateway** — by 13-01, in its fully qualified form, because `isPublicPath` matches with
  `startsWith` and the bare `/api/v1/auth/change-password` would sweep in the authenticated
  self-service endpoint 13-04 added at exactly that path. **This plan changed no gateway file at all**
  (`git diff 28ee723..HEAD -- gateway/` is 0 lines);
- at the **service** — new here, as an exact-path matcher pinned to `HttpMethod.POST`, not the `/**`
  prefix, so a future `/change-password/anything` cannot inherit `permitAll`. Same reasoning 13-05
  recorded for the platform login matcher.

Live, through the gateway, in the final state:

```
POST /api/v1/auth/change-password         no token   ->  401   (the chain refuses entry)
POST /api/v1/auth/change-password/forced  no token   ->  401   "Invalid credentials"
                                                             (the APPLICATION answering on the merits)
```

Those two are a pair on purpose. The 401 on the bare path could equally mean "the whole prefix is
closed", so the forced path is exercised anonymously beside it as the control. That pair is what
would catch someone "tidying" the gateway list.

## The bug that was not in the plan: forgot-password had never worked

**Measured on the live dev `auth_db`, whose owner `auth_user` is `NOSUPERUSER NOBYPASSRLS`, before
touching anything:**

```
POST /api/v1/auth/reset-password/request                 ->  200
the row, read directly with the tenant GUC set           ->  present, used_at NULL, unexpired
POST /api/v1/auth/reset-password/confirm  same token     ->  401
                                                             "Invalid or expired reset token"
```

`PasswordResetService.confirm` looked the token up by hash **before** establishing the tenant GUC.
`password_reset_tokens` is `FORCE ROW LEVEL SECURITY` on that GUC, and the flow is public — no JWT,
so `JwtAuthenticationFilter` never populates `TenantContext` and `TenantAwareDataSource` sets
nothing. The policy hid the row from the only lookup that had to find it.

The whole integration suite passed regardless, because **Testcontainers' Postgres user is a
SUPERUSER and superusers bypass row security entirely** — the same blind spot that let 13-02's
branch-role write and 13-06's user INSERT ship broken. This is the third instance in one phase.

Fixed, and proved in the state being reported:

```
after   reset-password/confirm with a valid token   ->  200
        the new password                            ->  200
        the old password                            ->  401
```

The cross-purpose test carries **controls in both directions** — a reset token is refused at the
forced endpoint *and* still works at reset-confirm; a change token is refused at reset-confirm *and*
still works at the forced endpoint. Without those controls both refusals would also have passed
against the broken-for-everything path, which is precisely how this defect stayed invisible.

### And the reason the obvious fix does not work — read this before writing another public flow

The first attempt copied changeset 052's `auth_lookup_refresh_tenant`, the existing idiom for
resolving a tenant before the GUC can exist. It was written, applied to the live database, and
**withdrawn**, because it returned NULL for a row that was demonstrably there:

```
auth_lookup_refresh_tenant         owner = postgres    rolbypassrls = true
auth_lookup_password_token_tenant  owner = auth_user   rolbypassrls = false
```

`SECURITY DEFINER` runs a function as its **owner**, and `FORCE ROW LEVEL SECURITY` subjects even
the table's owner to the policy. **052 works only because some earlier migration run created it as a
superuser.** Liquibase today runs as `auth_user`, so identical DDL produced a powerless function.

> **A landmine for whoever owns deployment, and it is not this plan's to disarm.** The
> **refresh and logout** paths depend on that ownership accident. Reprovision `auth_db` such that
> Liquibase creates 052's function as `auth_user`, and `/api/v1/auth/refresh` and `/logout` break
> exactly the way reset was broken — silently, with a generic 401, with the entire integration suite
> still green. 052 is left untouched. Verified live in the current environment: refresh answers 200,
> so nothing is broken *today*.

**What was done instead:** the token carries its own tenant routing prefix,
`<tenantId>.<256 random bits, base64url>`. No privileged database object, nothing that depends on
who ran a migration. It costs no isolation — the tenant id is not a secret (the caller typed the
tenant's slug to get here), the GUC only ever *narrows* what the policy makes visible, and the
stored hash is of the **whole** token, so editing the prefix changes the hash and matches nothing,
in the attacker's tenant or anyone else's. Cross-tenant redemption is impossible by construction
rather than by a check.

The withdrawn changeset had been applied to this dev box only, minutes earlier, and to no other
environment; the function was dropped and its `DATABASECHANGELOG` row deleted, so the changelog on
disk is the changelog that ran. The purpose column, its check constraint and its index are untouched
and still `EXECUTED`.

## Changeset 061, and why one table rather than two

`password_reset_tokens` gains `purpose VARCHAR(20) NOT NULL DEFAULT 'RESET'`, a check constraint
restricting it to `RESET | FORCED_CHANGE`, and a `(token_hash, purpose)` index. One table means one
RLS policy to get right, one grant, one expiry sweep for whoever eventually writes one, and one
place to look when a token leaks. Two tables means two of each, and the second drifts — which is the
failure mode this phase's audit is about. The cost is a discriminator, and unlike a second table it
is enforced by the database.

The check constraint is the point of the column: without it, `purpose` is free text and a typo
(`FORCED-CHANGE`) produces a token nothing can ever redeem — an outage that looks like a
token-generation bug. With it, the typo fails at the INSERT, in the service that made it.

Applied to the live `auth_db` by Liquibase running as `auth_user`: both/one changesets `EXECUTED`,
the column defaulted every pre-existing row to `RESET`, the constraint and index exist.

**A naming note recorded in the file:** changeset id `auth-1.0.0-061-enable-rls-password-reset-tokens`
already lives *inside* `060-create-password-reset-tokens.xml`. Liquibase keys on
(id, author, filename) so there is no collision, but the new id is suffixed differently so a human
reading `DATABASECHANGELOG` can tell them apart.

## `LoginResponse` was deliberately left untouched

The plan said to add a forced-change field "only if a genuine consumer needs it; if not, say so".
No consumer needs one: a forced-change login never produces a `LoginResponse` at all — it throws
before that type is constructed. Adding a field there would create a client that reads a token out
of a success-shaped body which is never populated on the path that has a token. **A field nobody
reads is the exact shape of the dead flag this plan exists to fix.**

## Deviations from plan

**1. [Rule 1 — bug] The forgot-password RLS defect.** Not in the plan; found by driving the real
endpoint against the real stack. Full detail above. Commits `ee1473e`, `2cbf9bb`.

**2. [Rule 1 — my own design, corrected by measurement] The SECURITY DEFINER function was
implemented, applied and withdrawn.** Recorded as its own commit rather than squashed, because the
reason it fails is a fact about this deployment that the next person needs. Commit `2cbf9bb`.

**3. [Rule 3 — blocking, caused by this plan] Three `AuthTenantProvisioningIT` cases went red.**
They provision an admin — which sets the flag — and assert on a login that used to return a token.
Updated, not relaxed; each is stronger afterwards, and one became the canonical two-gate proof.
Commit `cd38909`.

**4. [Rule 3 — blocking, caused by this plan] 13-06's live seam script went 19 PASS → 14 PASS /
1 FAIL.** Its provisioned OWNER now meets the forced-change gate before it can enrol TOTP. Repaired
with the new `forced_change` helper — which is exactly what the helper exists for. Now **20 PASS /
0 FAIL**. Commit `8a61853`.

**5. [Rule 1 — bug, caused by this plan] Two harnesses' cleanup blocks left their whole throwaway
tenant behind.** `password_reset_tokens` now accumulates `FORCED_CHANGE` rows and has an FK to
`users`, so the `users` DELETE aborted on `fk_password_reset_tokens_user` and, under
`ON_ERROR_STOP=1`, took the rest of the cleanup with it. Found by running the scripts, not by reading
them. Both now delete tokens first. Commit `8a61853`.

**6. [Rule 2 — one policy, one implementation] `PasswordResetService` now shares the token
lifecycle** rather than keeping private `generateToken`/`hashToken`, per the plan's instruction that
"the reset path and the change path cannot drift in how they hash". It therefore inherits
`invalidateOutstanding` — which 13-CONTEXT lists as a LOCKED requirement for reset and assigns to
13-09. **13-09 will find that half of its job already done and the rest untouched:** the raw reset
token still goes into the outbox payload in plaintext, deliberately, because half-fixing it would
rob that plan of the defect it was told about. The per-account request cooldown is likewise not
implemented.

**7. [Scope — file list] `LoginResponse.java` was listed as modified and was not touched.**
Reasoned above.

**8. [Out of plan scope, no source touched] auth-service rebuilt and restarted three times** — once
for changeset 061, once for the withdrawal, once at the end so the reported numbers come from a
process newer than its jar. The gateway was **not** rebuilt or restarted; nothing in it changed.

## Left open, and not claimed to work

### 1. The TOTP bootstrap endpoints still accept a temporary password

`/api/v1/auth/2fa/bootstrap` verifies the password and does not consult `must_change_password`, so a
flagged account can enrol a factor before changing its password. Deliberately not gated:

- it would break 13-06's seam script and any flow that enrols before changing, and neither the plan
  nor CONTEXT asks for it;
- it closes nothing real. Whoever holds the temporary password owns the account either way — they
  can complete the forced change themselves. That is inherent to a credential delivered out of band,
  and it is what the forced change is *for*: bounding how long that window stays open, not removing
  it.

Worth a deliberate decision by whoever owns 13-13 (admin-initiated reset), which creates the same
window on purpose.

### 2. The refresh/logout RLS landmine

Named above. Not fixed here, because 052 is not this plan's file and the correct remedy is a
deployment decision (create the function as a superuser, or convert it to the routing-prefix scheme
this plan uses). It is not broken today in this environment.

### 3. Rate limiting on the forced endpoint is inherited, not measured

`/api/v1/auth/change-password/forced` goes through `auth-route`, whose per-IP budget is
`replenishRate=2/s, burst=100`. T-13-08-F leans on it as one of three brakes on token brute-forcing
(the others being 256 bits of entropy and the ten-minute expiry, both of which are decisive on their
own). 13-04 flagged the same unmeasured inheritance for the bare path; still unmeasured.

## Known stubs

None. Every symbol this plan created is wired and exercised — by an integration test, a live HTTP
assertion, or both.

## Threat flags

None beyond the plan's register. Where each entry is closed:

- **T-13-08-A** (elevation via the public endpoint) — two proofs required; the account comes from the
  token and the DTO has no field for one, asserted by sending `userId` **and** `email` naming another
  account and checking that account's hash is byte-identical afterwards; one generic failure for
  every token defect, asserted by byte-comparison with a control.
- **T-13-08-B** (forced-change response as an account oracle) — the branch runs only after a
  successful password comparison; three response bodies compared for byte-equality in the IT and two
  more live.
- **T-13-08-C** (change-token replay) — conditional-UPDATE single use, issue-invalidates-outstanding,
  ten-minute expiry; all three asserted, plus the deliberate spend-on-wrong-password.
- **T-13-08-D** (change token at rest) — SHA-256 only; asserted by scanning the token table for the
  raw value in the IT and by a `token_hash = '<raw>'` count of 0 live. The raw value appears in the
  refusal response and nowhere else: 0 occurrences in the outbox, 0 in the running service log.
- **T-13-08-E** (cross-purpose redemption) — purpose discriminator with a database check constraint;
  hash and purpose matched in one statement; refused in **both** directions, each with a control
  proving the legitimate direction still works.
- **T-13-08-F** (brute-forcing the token) — 256 bits, ten-minute expiry, one attempt per token
  (property 6), plus the auth route's per-IP limit. The rate limit is the only one of the four not
  independently measured.
- **T-13-08-G** (forced change lost from the audit trail) — `USER_LOGIN_SUCCEEDED` still fires on the
  refusal, because the credential really was correct; asserted in the IT, which also checks the
  envelope carries no token and no password. The change itself emits 13-04's `PASSWORD_CHANGED`.
- **T-13-08-SC** — did not arise. **No package of any kind was installed**, in any ecosystem, and no
  Maven dependency was added.

## Verification actually run

Every number is from a command executed in the state being reported, with
`JAVA_HOME=openjdk@25`, `TESTCONTAINERS_RYUK_DISABLED=true`,
`TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`.

| Suite | Result |
|---|---|
| `mvn -pl services/auth-service,gateway -am verify` | **BUILD SUCCESS**, all 4 modules |
| ├ shared-lib | unit 38/38, IT 11/11 |
| ├ auth-service unit | **24/24** (unchanged) |
| ├ auth-service IT | **112/112** (was 96; `ForcedPasswordChangeIT` adds 16) |
| │  ├ `ForcedPasswordChangeIT` | **16/16** |
| │  ├ `AuthTenantProvisioningIT` | 26/26 (3 rewritten) |
| │  ├ `PasswordChangeIT` | 14/14 |
| │  ├ `PasswordResetIT` | 1/1 |
| │  └ `TempPasswordPolicyTest` | **3/3** — `78351de` kept green, untouched |
| ├ gateway unit | **51/51** (unchanged; no gateway file touched) |
| └ gateway IT | **15/15** |
| `mvn -T1C -DskipTests test-compile` (whole reactor) | **SUCCESS** |
| `opa test policies/` | **139/139** (no `.rego` touched) |
| `bash scripts/e2e/phase13-forced-change-e2e.sh` | **25 PASS / 0 FAIL, exit 0**, twice consecutively |
| same script, `GATEWAY` at a dead port | **17 FAIL, exit 1** — the harness can fail |
| `bash scripts/e2e/phase13-auth-provisioning-seam-e2e.sh` | **20 PASS / 0 FAIL, exit 0** (was 19; +1 assertion) |
| `bash scripts/e2e/phase13-password-change-e2e.sh` | **22 PASS / 0 FAIL, exit 0** (unchanged) |
| `bash scripts/e2e/phase13-superadmin-e2e.sh` | **21 PASS / 0 FAIL, exit 0** (unchanged) |
| `bash scripts/e2e/phase13-role-catalog-e2e.sh` | **26 PASS / 2 FAIL, exit 1** — the two known 13-12 findings, neither touched |
| Live reset-confirm, before → after | **401 → 200** |
| Live changeset 061 as `auth_user` (NOSUPERUSER NOBYPASSRLS) | `EXECUTED`; column, check constraint and index present |
| Password/token material in the running auth-service log | **0** occurrences of either password, `$2a$`, `$2b$`, `changeToken` |
| Token rows left behind after every script's trap | **0** |

The RED for the TDD gate, measured rather than asserted:

| Gate | Measured RED |
|---|---|
| `ForcedPasswordChangeIT` | **16 run, 13 failures**, with the gate call removed from `login` and all else in place |

The three RED passes, named — because a red that flatters itself is how 13-06 and 13-07 both nearly
shipped a vacuous test:

- `anAccountWithoutTheFlag_logsInExactlyAsBefore` — **genuinely** correct in RED; it is the
  regression guard and should pass on both sides;
- `wrongCredentialsForAFlaggedAccount_…` — **vacuous**: with no gate, a wrong password is generic for
  every account, so the bodies match trivially;
- `theForcedEndpointIsReachableWithNoTokenAtAll_…` — **vacuous** in the same way: the endpoint
  answers, but nothing has yet minted a token to present to it.

**The RED was measured after the implementation existed, by removing the gate**, not before it was
written. The token infrastructure and the endpoint had to exist for the test to compile at all. That
is a weaker TDD gate than writing the test first and it is stated rather than glossed.

**Human-check satisfied from timestamps, not from my say-so:** auth-service jar built 01:44:58,
process started 01:49:19; gateway jar 00:38:41, process started 00:56:46. Both processes are newer
than their jars, and the gateway's jar predates this plan entirely — which is itself the proof that
no gateway change was needed.

### GitNexus, run before editing (per CLAUDE.md)

| Target | Upstream | Risk |
|---|---|---|
| `AuthService` (interface) | 5 direct | **MEDIUM** |
| `AuthServiceImpl` | 0 | LOW |

**The MEDIUM is the honest number and the LOW is not.** `AuthServiceImpl.login` has exactly one
caller, `AuthController.login` — and that one caller is every authentication in the platform, for
every tenant user, on every request that starts a session. The index is stale (last built at
`5fba4a9`) and reports 0 upstream for the class, which understates it the same way 13-01's and
13-06's results did.

Treated accordingly: the change is **purely additive at the signature level** — no method signature
altered, no interface change, one new private method and one new constructor argument — and the
regression surface is covered by `anAccountWithoutTheFlag_logsInExactlyAsBefore` plus the untouched
`AuthLoginIT`, `StepUpLoginIT`, `BranchSwitchIT`, `RefreshLogoutIT` and `TotpFlowIT`, all green.

The index was not refreshed, for the reason 13-01 through 13-07 all gave: `gitnexus analyze`
rewrites `CLAUDE.md`, `AGENTS.md` and six skill files, which 13-01 had to revert. Scope was reviewed
with `git diff --stat` before each commit instead; `28ee723..HEAD` is 19 files, and every one is in
this plan's declared surface or is named as a deviation above.

## Self-Check: PASSED

All 5 created files exist on disk. All 6 commits exist in `git log`:
`41be1b4`, `ee1473e`, `a70f5e0`, `cd38909`, `2cbf9bb`, `8a61853`.
