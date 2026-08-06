---
phase: 13-platform-tenant-access-repair
plan: 05
subsystem: platform-auth
tags: [platform-admin, auth, bcrypt, lockout, liquibase, credential-rotation, b1, sc1]
status: complete
requires:
  - running dev stack (postgres, redis, rabbitmq, eureka) + gateway, auth-service, platform-admin-service
  - "13-01: JwtSigningService.signPlatformToken, POST /internal/auth/platform-token, gateway PUBLIC_PATHS + platform-auth-route"
provides:
  - "POST /api/v1/platform/auth/login (public at the gateway, rate-limited by platform-auth-route)"
  - PlatformAuthService (verifies platform_users credentials; the first production caller of PlatformUserRepository.findByEmail)
  - PlatformAuthController
  - PlatformAuthenticationFailedException + PlatformAuthExceptionHandler (one constant 401 body)
  - "AuthInternalClient.platformToken"
  - "PlatformDtos.PlatformLoginRequest / PlatformLoginResponse"
  - "PasswordEncoder bean in platform-admin-service (BCrypt cost 12)"
  - "changeset 910: superadmin@softxlogic.com seeded active; superadmin@restaurantos.io deactivated"
  - "platform_login helper in scripts/e2e/_phase13-lib.sh"
  - scripts/e2e/phase13-superadmin-e2e.sh
affects:
  - every platform-admin-service endpoint (they are now reachable by a human)
  - "13-06/13-07/13-11/13-12/13-15: platform_login replaces mint_platform_token as the way to drive the platform API"
tech-stack:
  added: []
  patterns:
    - a credential refusal body is a compile-time constant, not a per-request assembly
    - one bcrypt comparison on every path, real hash or dummy, so timing carries no signal
    - verify the password BEFORE the cheap checks, so the cheap checks leak nothing
    - assert two failures are the same failure by comparing bodies, never by comparing statuses
key-files:
  created:
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/PlatformAuthController.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/PlatformAuthService.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/exception/PlatformAuthenticationFailedException.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/exception/PlatformAuthExceptionHandler.java
    - services/platform-admin-service/src/main/resources/db/changelog/v1.0.0/910-rotate-platform-superadmin.xml
    - services/platform-admin-service/src/test/java/io/restaurantos/platform/PlatformAuthIT.java
    - scripts/e2e/phase13-superadmin-e2e.sh
  modified:
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/client/AuthInternalClient.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/config/PlatformSecurityConfig.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/dto/PlatformDtos.java
    - services/platform-admin-service/src/main/resources/db/changelog/db.changelog-master.xml
    - scripts/e2e/_phase13-lib.sh
decisions: [D-01, D-03, D-26, D-30]
requirements: [PLATFORM-01, PLATFORM-02, PLATFORM-07, AUTH-02]
metrics:
  duration: ~2h
  completed: 2026-08-06
  tasks: 3
  commits: 5
---

# Phase 13 Plan 05: Platform Login & Credential Rotation — Summary

**Blocker B1 is closed.** A SuperAdmin logs in with `superadmin@softxlogic.com` / `Test@123!`
through the real gateway, receives a tenant-less RS256 token, and reaches every platform admin
endpoint with it. Proved live: **21 assertions, 0 failures, exit 0, three consecutive runs.**

The credential whose password is committed in this repository no longer authenticates.

## The whole of B1, and where each cause died

| # | Cause | Closed by |
|---|-------|-----------|
| 1 | No login endpoint reads `platform_users` — `findByEmail` had zero production callers | **this plan**, `a90228e` |
| 2 | `JwtAuthenticationFilter` built authorities from `permissions` only | 13-01, `12efa18` |
| 3 | `TenantResolutionSupport` errors on a tenant-less token; the gateway turns that into 401 | 13-01, `566b1a7` |

All three are now closed *and jointly proven by one live request*: a password typed at the edge
comes back as a token that a `@PreAuthorize("hasAuthority('SUPER_ADMIN')")` method accepts.

## Key facts to carry forward

| Fact | Value |
|---|---|
| Login path | `POST /api/v1/platform/auth/login` |
| Token TTL | **900s** (`restaurantos.auth.platform-token-ttl-seconds`, 13-01's default) |
| SuperAdmin uuid | **`eca6bbf2-ce62-5d16-8f4c-d052521d16ad`** — uuid5, ns `6ba7b810-9dad-11d1-80b4-00c04fd430c8`, name `restaurantos/platform/user/superadmin@softxlogic.com` |
| Lockout | 5 failures / 15 min, Redis key `platform:auth:fail:<lowercased-email>` |
| Refusal body | `{"error":{"code":"UNAUTHENTICATED","message":"Invalid credentials","details":[],"traceId":"unknown"}}` — a constant |
| Harness helper | `platform_login <email> <password>` in `scripts/e2e/_phase13-lib.sh` |

**Later plans should use `platform_login`, not `mint_platform_token`.** The latter still works and is
still the right tool for negative tests, but a plan that drives the platform API with the internal
secret has proven nothing about whether a human can log in — which is precisely the gap B1 lived in
for months inside a phase marked complete.

## Task 1 — the login endpoint (D-01, D-26)

**Where it lives, and why.** platform-admin-service verifies the credential because PLATFORM-07 says
only it may read `platform_db`; auth-service signs the token because it holds the RSA private key.
Two hops, one signer, neither boundary widened. Putting the login in auth-service would have needed
a second datasource onto the control plane or a cross-service credential read.

**Why every refusal is the same refusal.** Unknown email, wrong password, deactivated account,
non-SuperAdmin role and lockout all throw one reason-less exception that renders as one constant
body, and all perform **exactly one bcrypt comparison** — against the real hash where an account was
found, against a fixed dummy hash where it was not. Without the dummy, an unknown email returns in
microseconds while a wrong password costs the ~250ms of cost 12; that gap alone enumerates the
platform user table. Same idiom as `AuthServiceImpl`, deliberately.

**The ordering that is easy to get backwards.** The password is verified *before* the active flag and
the role are examined. Checking them first is free, so it would tell an attacker that an address
belongs to a deactivated or SUPPORT-role account without knowing its password. As implemented, a
SUPPORT user who supplies the correct password gets the identical body an unknown address gets — and
the signer is never asked for a token, which the test asserts with a WireMock `verify(0, ...)` rather
than by checking that no token appears in the response.

**Why the refusal body is a compile-time constant rather than assembled per request.** The trace id
in every other error body here is written by `JwtAuthenticationFilter`, which does not run for an
unauthenticated request — so whether `MDC.get("traceId")` is empty depends on what the Tomcat worker
thread did *previously*. Two failed logins could differ by a stale id. Fixing the body at exactly the
value the dynamic form produces on an empty MDC makes "indistinguishable" a structural property
instead of an empirical observation, and keeps the wire shape identical to every other error in the
platform. Correlation is not lost: the service logs the refusal with its reason, the platform user id
where one exists, and the source address.

`@Order(HIGHEST_PRECEDENCE)` on the advice is load-bearing — shared-lib's `GlobalExceptionHandler`
has a catch-all `Exception` handler, and unordered `@RestControllerAdvice` beans fall back to
bean-registration order, which is not a contract.

**Lockout, and what it costs.** `platform_users` has no lockout columns, so the counter is in Redis
with the same 5/15-min budget auth-service applies to tenant users. Two consequences are recorded in
the javadoc rather than left to be discovered:

- it is **not durable** — a Redis flush, failover or eviction resets every platform account's lockout
  state. The gateway's rate limit is an independent brake that does not share this failure mode;
- Redis being unreachable **fails open**. Failing closed would turn a cache outage into a total
  control-plane lockout, and the platform API is the tool an operator would use to fix things.

Two smaller rulings, both asserted: the counter key is the **lowercased** email, or `Admin@x` and
`admin@x` would each get their own five attempts; and a correct password for a deactivated or
wrong-role account neither increments nor clears the counter — incrementing would let a correct
password lock an account, and clearing would make "the counter reset" an oracle.

**No cookie, no refresh token**, asserted on success and on failure. A long-lived platform refresh
credential would be the highest-value token in the system.

### The RED, measured

`PlatformAuthIT` against the absent endpoint: **13 run, 5 failures.** The other 8 passed *vacuously* —
`anyRequest().authenticated()` already returns one identical 401 body for every case the negative
tests compare, so the byte-equality assertions were trivially satisfiable. `login_isNotBehindTheServicesOwnJwtGate`
exists to make that visible and is one of the 5 real failures. Worth stating plainly: the equality
assertions only became meaningful in GREEN.

## Task 2 — the credential rotation (D-03)

Changeset `910-001` inserts `superadmin@softxlogic.com` with the deterministic uuid5 above.
`910-002` sets `superadmin@restaurantos.io` inactive rather than deleting it —
`impersonation_log.admin_user_id` references `platform_users(id)`, so a delete would either fail the
constraint or orphan the audit trail, and a missing row is indistinguishable from a database the
seed never ran against. `PlatformAuthService` refuses inactive users through the generic 401, so this
is a real revocation, asserted live.

**No plaintext appears in 910, not even in a comment.** That practice — the hash in the changeset and
the password in the comment three lines above it — is exactly what is being retired. The header names
where the credential *is* documented (13-CONTEXT, the phase seed script) and states that all of those
plus this hash must be rotated before any production deployment.

`Test@123!` passes the shared `@StrongPassword` policy as it now stands (floor 8, all four character
classes), so the specified credential is settable through validated paths. 13-04 flagged this as an
open decision at floor 12; the floor is 8 today and I did not touch it.

The idempotency test deletes the `DATABASECHANGELOG` rows for 910 before re-running, because
otherwise Liquibase skips the changesets on their tracking rows alone and the `sqlCheck`
preconditions — the part that can actually be wrong — never execute.

## Task 3 — SC1 proved live (D-30)

`scripts/e2e/phase13-superadmin-e2e.sh` — **21 PASS / 0 FAIL, exit 0, three consecutive runs.**

Every assertion targets `${GATEWAY}`. Not one reads a source file; not one talks to a service port.

| Assertion | Result |
|---|---|
| `POST /api/v1/platform/auth/login` with the CONTEXT credentials | **200** + access token |
| No `Set-Cookie`; body contains no refresh credential | PASS |
| Decoded claims: no `tenant_id`, no `branch_id`, `SUPER_ADMIN`, `token_type: platform` | PASS ×4 |
| `GET /api/v1/platform/tenants` | **200**, real tenant list |
| `GET /api/v1/platform/tenants/{id}` | **200** (asserted not-401 and not-403) |
| `GET /api/v1/platform/tenants/{id}/features` | **200** |
| Login as `superadmin@restaurantos.io` with its committed password | **401** |
| Wrong-password body **==** unknown-email body (string comparison) | PASS |
| Deactivated-account body **==** unknown-email body | PASS |
| `cashier@demo.local` token on both platform endpoints | **403** ×2 |
| No token / garbage token on the platform API | **401** ×2 |
| `platform-auth-route` throttles the login endpoint | **429** |

**Human-check satisfied from timestamps, not from my say-so:** platform-admin jar built 22:47, its
process started 22:50; auth-service jar 22:16 and gateway jar 22:17, both processes started 23:07.
Every process is newer than its jar.

## Verification actually run

Every number is from a command executed in the state being reported, with
`JAVA_HOME=openjdk@25`, `TESTCONTAINERS_RYUK_DISABLED=true`,
`TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`.

| Suite | Result |
|---|---|
| `mvn -pl services/platform-admin-service -am verify` | **BUILD SUCCESS** (shared-lib + platform-admin) |
| ├ platform-admin ITs | **40/40** (was 22; `PlatformAuthIT` adds 18) |
| │  ├ `PlatformAuthIT` | **18/18** |
| │  ├ `PlatformDbIsolationIT` | 9/9 |
| │  ├ `TenantLifecycleIT` | 6/6 |
| │  ├ `FeatureFlagInvalidationIT` | 3/3 |
| │  └ `ProvisioningSagaIT$FinanceSeedFailureTests` | 4/4 |
| ├ platform-admin unit (`FeatureCodeClosureTest`) | 4/4 |
| └ shared-lib | unit 37/37, IT 11/11 |
| `bash scripts/e2e/phase13-superadmin-e2e.sh` | **21 PASS / 0 FAIL, exit 0** ×3 consecutive |
| `opa test policies/` | **139/139** (no `.rego` touched) |
| Live `platform_users` after restart | new account active w/ the deterministic id; old account `is_active=f` |
| `detect_changes` vs `9f3fa4b` (the commit before this plan) | 21 files, 36 symbols, **0 affected processes, risk LOW** |

`detect_changes`'s 21 files include the uncommitted `services/pos-service` test edits belonging to
13-16, which is running concurrently in this working tree. They are not this plan's.

### GitNexus impact, run before editing (per CLAUDE.md)

| Target | Upstream | Risk |
|---|---|---|
| `PlatformUserRepository` | **0** | LOW |
| `PlatformSecurityConfig` | 0 | LOW |
| `PlatformAdminController` | 0 | LOW |
| `PlatformDtos` | 2 (`PlatformAdminController`, `PlatformInternalController` — IMPORTS) | LOW |
| `AuthInternalClient` (platform-admin one, disambiguated) | — | LOW |

The zero on `PlatformUserRepository` is not the graph understating things, as it was for the
`GlobalFilter` results in 13-01 and 13-03. It is the audit finding itself, rendered as a number:
nothing called it. That is now 1.

The index is stale (last built at `5fba4a9`). Not refreshed, for the reason 13-01 through 13-04 all
gave: `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files, which 13-01 had to
revert.

## Deviations from plan

**1. [Scope — file list] `PlatformUserRepository.java` needed no change.** The plan listed it as
modified. `findByEmail` was already there and already correct; the defect was the absence of a
caller, not the absence of the method.

**2. [Rule 2 — security] Two new files not in the plan's list:
`PlatformAuthenticationFailedException` and `PlatformAuthExceptionHandler`.** The plan said to return
a generic 401 but named no mechanism. Reusing `RestaurantOsException` would have produced a **400**
via shared-lib's handler, with a body echoing the exception's code and message — i.e. exactly the
per-reason body the plan's own prohibition forbids. The constant-body advice is the smallest change
that makes the prohibition structural rather than incidental.

**3. [Rule 2 — security] `permitAll` is registered fully-qualified and pinned to POST**, not as the
prefix `/api/v1/platform/auth/**`. A prefix would let a later plan add a platform password-reset or
token-exchange endpoint underneath and silently inherit `permitAll` — the same mistake 13-01 avoided
at the gateway by registering `/api/v1/auth/change-password/forced` rather than the bare path.

**4. [Rule 2 — verifiability] Five IT cases beyond the plan's six behaviours**, each closing a way
the others could pass vacuously: the signer is never *asked* for a token on the unknown-email and
SUPPORT paths (`verify(0, ...)`, not "no token in the body"); the lockout counter has a TTL, so it
cannot be a permanent lockout; a success clears the counter; email lookup is case-insensitive while
the lockout key is not case-*sensitive*; and `login_isNotBehindTheServicesOwnJwtGate`, which is the
only thing distinguishing "the endpoint refused you" from "the endpoint does not exist".

**5. [Rule 1 — bug in my own harness] The SC1 script could fail when run twice back to back.**
Sections 1-6 share one per-IP token bucket with section 7, which empties it by design, so a second
consecutive run could report a 429 as a login defect. Observed once — exit 1 between two exit-0 runs —
and fixed (`f58006e`) rather than explained away: a verification script that fails intermittently
teaches people to re-run it until it is green, which is worse than not having one. The same commit
collapses the status and body curls into one request; two meant every body assertion concerned a
*different* response from the status assertion beside it, which against a lockout-aware endpoint is
not the same experiment.

**6. [Out of plan scope, no source touched] Three services restarted.** `auth-service` was wedged on
arrival at task 3 — `/actuator/health` answered in 4ms while *every* other path, including a
nonexistent one, hung indefinitely; a thread dump showed a fresh exec thread created per request that
parked with 0.04ms of CPU and never ran. This is **not** the wildcard-bind firewall symptom the
runbook documents (that one is path-independent, and health worked). It was not diagnosed further —
it is not this plan's code and the operator's standing instruction is to restart. `user-service` was
found in the identical state afterwards and behaved identically: dead before the restart, answering
after it. The gateway was restarted alongside auth-service. `platform-admin-service` was rebuilt and
restarted for the plan's own human-check. **`pos-service` was deliberately left alone** — 13-16 is
working in it concurrently.

## Named gaps and accepted risks

### 1. Platform accounts have no MFA (T-13-05-F, accepted)

`platform_users` has no TOTP column, so there is no second factor on the highest-privilege account in
the system. 13-CONTEXT defers platform MFA explicitly; this is the named, accepted gap, compensated
by per-account lockout, the gateway rate limit, and a 900-second non-refreshable token.

**Consequence for D-29a:** the platform login has **no enrolment-required branch**, because there is
nothing to enrol. It therefore does not express "enrolment required" as a generic 401 — it cannot
express it at all. When the column lands, that outcome must be an explicit code
(`PLATFORM_TOTP_ENROLLMENT_REQUIRED`, mirroring auth-service's tenant-side
`TOTP_ENROLLMENT_REQUIRED`), never folded into the generic refusal. D-29a's requirement to enrol
tenant admins at creation is unaffected by this plan and remains 13-15's obligation.

### 2. The lockout counter is not durable

Redis-only, by the reasoning above. A durable column is the right follow-up and should land together
with platform MFA — both are `platform_users` migrations and both are cheap to do once.

### 3. `ProvisioningSagaIT`'s three outer tests run zero (pre-existing, not mine)

`ProvisioningSagaIT` declares 6 `@Test` methods. Failsafe reports `Tests run: 0` for the outer class
and `Tests run: 4` for its `@Nested FinanceSeedFailureTests` — so **three saga tests, including
`provisionTenant_happyPath_...`, are silently not executing.** Confirmed pre-existing: the totals
reconcile exactly (9 + 6 + 3 + 4 = 22, the count 13-04 recorded, and 22 + my 18 = 40), and the file is
untouched by this branch. Flagged rather than fixed — it belongs to the provisioning repair
(13-06/13-07) — but it is worth flagging loudly, because a test class that reports success while
running none of its headline cases is the exact failure mode this phase's audit was written about.

### 4. Rate limiting is the only brake if Redis is down

Stated at the site. The two brakes are independent by construction, but they are not independent of
*Redis existing at all* in the sense an operator might assume: the gateway limiter uses Redis too,
just a different key space and a different client. A total Redis outage removes both.

## Known stubs

None. Every symbol this plan created is wired and exercised — by an integration test, a live HTTP
assertion, or both.

## Threat flags

None beyond the plan's register. Where each entry is closed:

- **T-13-05-A** (credential check) — bcrypt cost 12; one comparison on every path, dummy where no
  account exists; five IT cases comparing bodies for byte-equality; Redis lockout with a TTL
  assertion. Also live: wrong-password and deactivated bodies compared as strings through the gateway.
- **T-13-05-B** (internal minting channel) — unchanged from 13-01; asserted there by a 403 on a
  missing/wrong secret and a 404 through the gateway. This plan adds no new route to `/internal/**`.
- **T-13-05-C** (credential stuffing) — live **429** on `platform-auth-route`, plus per-account
  lockout independent of the per-IP limit.
- **T-13-05-D** (SUPPORT/BILLING elevation) — role checked before minting; asserted by IT with
  `WIREMOCK.verify(0, ...)` on the signer, which is stronger than checking the response.
- **T-13-05-E** (committed password) — changeset 910; live 401 for the old credential; no plaintext
  in the new changeset.
- **T-13-05-F** (no platform MFA) — **accepted**, named above.
- **T-13-05-G** (repudiation) — success and every refusal logged with the reason, the platform user id
  where known and the source address. No password material is logged; the exception carries no
  message and no stack trace.
- **T-13-05-SC** — did not arise. **No package of any kind was installed**, in any ecosystem.

## Self-Check: PASSED

All 7 created files exist on disk. All 5 commits exist in `git log`:
`d26c2aa`, `a90228e`, `dbe108a`, `5fc6441`, `f58006e`.
