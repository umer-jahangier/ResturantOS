---
phase: 13-platform-tenant-access-repair
plan: 04
subsystem: auth-passwords
tags: [passwords, validation, shared-lib, rbac, bcrypt, sessions, test-harness]
status: complete
requires:
  - running dev stack (postgres, redis, rabbitmq, eureka) + gateway, auth-service
provides:
  - "@StrongPassword + StrongPasswordValidator (shared-lib, io.restaurantos.shared.validation)"
  - PasswordPolicyService (5 methods — exact signatures below; 13-08/13-09/13-13 call these)
  - PasswordChangeService.changeOwnPassword
  - "POST /api/v1/auth/change-password (JWT required, NOT public at the gateway)"
  - ChangePasswordRequest
  - PASSWORD_CHANGED outbox event ({userId, tenantId} only)
  - scripts/e2e/phase13-password-change-e2e.sh
  - "loopback-bound IT harness (auth-service + gateway) — unblocks integration testing on macOS"
affects:
  - every module (shared-lib gains jakarta.validation-api at compile scope — API only, no provider)
  - the password reset flow (now delegates instead of owning the rules)
  - the gateway and auth-service test harnesses
tech-stack:
  added:
    - "jakarta.validation:jakarta.validation-api (shared-lib, compile) — API only, deliberately not the starter"
    - "spring-boot-starter-validation (shared-lib, TEST scope only)"
  patterns:
    - a strength rule belongs where a password is CHOSEN, never where one is PRESENTED
    - a violation message is a function of the unmet rule set and of nothing else
    - the DTO has no field for the target, so the endpoint cannot be pointed at another account
    - assert an oracle is closed by comparing two response BODIES, not two statuses
    - bind test servers to loopback so the host firewall is out of the path
key-files:
  created:
    - shared-lib/src/main/java/io/restaurantos/shared/validation/StrongPassword.java
    - shared-lib/src/main/java/io/restaurantos/shared/validation/StrongPasswordValidator.java
    - shared-lib/src/test/java/io/restaurantos/shared/validation/StrongPasswordValidatorTest.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/PasswordPolicyService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/PasswordChangeService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/PasswordChangeController.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/request/ChangePasswordRequest.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/PasswordChangeIT.java
    - scripts/e2e/phase13-password-change-e2e.sh
  modified:
    - shared-lib/pom.xml
    - services/auth-service/src/main/java/io/restaurantos/auth/service/PasswordResetService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/request/PasswordResetConfirmRequest.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/request/LoginRequest.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/request/TotpBootstrapRequest.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/BaseIntegrationTest.java
    - gateway/src/test/java/io/restaurantos/gateway/JwtGlobalFilterTest.java
    - gateway/src/test/java/io/restaurantos/gateway/filter/JwtGlobalFilterWsUpgradeTest.java
    - gateway/src/test/java/io/restaurantos/gateway/FeatureFlagFilterIT.java
    - gateway/src/test/java/io/restaurantos/gateway/GatewayRoutingIT.java
    - scripts/DEV-STACK-RUNBOOK.md
decisions: [D-15, D-20, D-30]
requirements: [AUTH-01, AUTH-06]
metrics:
  duration: ~3h
  completed: 2026-08-06
  tasks: 3
  commits: 8
---

# Phase 13 Plan 04: Password Policy & Self-Service Change — Summary

A logged-in user can change their own password through the real gateway, one strength rule now
governs every field where a password is chosen, and the reuse/history/revocation rules the reset
flow privately owned are shared rather than duplicated.

Along the way this plan root-caused and fixed the integration-test failure that blocked honest
verification across this repo on macOS — including the gateway `PrematureCloseException` that plan
13-01 investigated, time-boxed and explicitly left open. That was not in the plan; without it, none
of the numbers below could have been taken.

## The exact PasswordPolicyService signatures

Plans **13-08**, **13-09** and **13-13** call these. All are instance methods on a `@Service`, and
all must be called inside a transaction that also writes the new hash.

```java
public static final int HISTORY_DEPTH = 5;

public void rejectIfPasswordReused(UserEntity user, String newPassword)   // throws PasswordReuseException
public void appendCurrentPasswordToHistory(UserEntity user)               // BEFORE overwriting the hash
public void revokeActiveRefreshSessions(UUID userId)
public void clearLockout(UserEntity user)                                 // does NOT save; caller writes
public void setTenantGuc(UUID tenantId)                                   // transaction-local, before the first RLS read
```

Two of these have an ordering constraint that is easy to get wrong and silent when you do:

- `appendCurrentPasswordToHistory` files the entity's **current** hash. Called after the new hash is
  set, it records the brand-new password as a historical one — losing the entry that mattered and
  making the *next* change fail its own reuse check against a password the user never had before.
  It takes the entity rather than a hash so there is one way to get this wrong instead of two.
- `setTenantGuc` must precede the first row-level-security-scoped read of the transaction, so the
  GUC and the read land on the same connection. This repo has a documented prior bug of exactly
  that shape (`TenantAwareDataSource`'s class javadoc).

`clearLockout` is new behaviour that neither path had. 13-09 wires it into reset; this plan wired it
into change. Without it a user who resets or changes their password stays locked out, having already
done the only thing the error told them to do.

## Task 1 — one strength rule (D-20)

**The policy:** ≥ 12 characters (overridable per use site via `min`), ≤ 128, and at least one
lowercase letter, one uppercase letter, one digit and one non-alphanumeric character. Before this,
the entirety of this platform's password policy was `@Size(min = 8, max = 128)` on one field.

**Every DTO in the repository that accepts a password, and what each got.** Found by searching all
of `services/*/src/main/java`, `shared-lib`, `gateway` and `frontend/` for password-shaped fields;
this is the complete list, not a sample.

| DTO | Field | Applied? | Why |
|---|---|---|---|
| `PasswordResetConfirmRequest` | `newPassword` | **`@StrongPassword`** | a password being chosen; replaced the bare `@Size(min=8)` |
| `ChangePasswordRequest` (new) | `newPassword` | **`@StrongPassword`** | a password being chosen |
| `ChangePasswordRequest` (new) | `currentPassword` | `@NotBlank` only | an existing credential |
| `LoginRequest` | `password` | **deliberately not**, with a comment at the site | an existing credential |
| `TotpBootstrapRequest` | `password` | **deliberately not**, with a comment at the site | an existing credential |

The frontend has no new-password submission surface at all today (Phase 14), so there is nothing
there to apply it to — which is also why "server-side or nowhere" is not a trade-off here.

**Why the two omissions are commented rather than merely omitted.** A strength rule on a login field
validates a credential the user already has against a policy that did not exist when they chose it.
Every account predating a tightening then fails validation *before the encoder is consulted*, so not
even the correct password gets in — a total, self-inflicted lockout served as a 400. TOTP bootstrap
is the same field in a worse place: 13-02's finding means tenant admins are exactly the accounts
that must be able to enrol a second factor. Both sites now carry a paragraph saying so, so the
absence reads as a decision rather than an oversight.

### The information-disclosure property, and how it is actually asserted

The violation message is assembled from constants only. The submitted value decides *which*
fragments apply and is never concatenated into anything — which also means the template handed to
`buildConstraintViolationWithTemplate` can never contain attacker text, and that matters more than
it looks: a provider interpolates `{...}` and `${...}` in a message template, so building one from
user input is an expression-injection sink.

The test checks this two ways, because the obvious check alone is weak — a message quoting only the
value's *length* would pass a substring scan while still leaking:

1. no 3-gram or longer of the submitted value appears in the message (inputs deliberately built from
   characters that do not occur in English words, so a false positive against "least"/"contain"
   cannot make a real test get weakened);
2. **two different values breaking the same rules produce byte-identical messages**, and a 3-char
   and a 9-char value produce identical messages. That is the invariant the scan rests on: the
   message is a function of the unmet rule set and of nothing else.

### Why shared-lib got the API and not the starter

shared-lib is on all 20 modules' compile classpath, so anything added there is added to every one of
them. Pulling `spring-boot-starter-validation` would put hibernate-validator on every classpath and
switch method/argument validation on in services that do not have it today — a silent behaviour
change to services this plan never ran.

Verified rather than assumed: `ValidationAutoConfiguration` does **not** ship in
`spring-boot-autoconfigure`; it lives in `spring-boot-validation`, which only the starter pulls in.
So in a module without the starter the auto-configuration class is not on the classpath at all.
Confirmed on the resolved trees: `audit-service` gains `jakarta.validation-api:3.1.1` and no
provider; `gateway` and `pos-service` already had both at the identical version, so nothing
conflicts. The implementation is test-scope in shared-lib, because the constraint's real contract is
what a live provider does with it.

**Other rulings, each recorded in the javadoc:**

- **Whitespace counts as the non-alphanumeric character.** Refusing passphrases pushes users towards
  shorter, denser strings, which is the wrong direction.
- **Case detection is `Character.isUpperCase`, not an ASCII range**, and iteration is by code point,
  so a non-ASCII password is classified rather than rejected. A letter that is neither upper- nor
  lower-case (Chinese, Arabic, Hebrew) satisfies none of the four classes and is simply not counted.
- **The maximum is a resource bound, not a strength one, and the javadoc says so.** bcrypt reads at
  most **72 bytes** and silently ignores the rest, so two passwords sharing a 72-byte prefix are the
  same password to the encoder. 128 is a request-shaped cap well clear of that, not a claim about
  security. Checked that Spring Security 7's `BCryptPasswordEncoder`/`BCrypt` has no length guard
  that would throw on a 73-128 char value, so the cap cannot produce a 500.
- **`min` is overridable, the maximum is not.** A looser maximum has no legitimate use.

## Task 2 — the change endpoint (D-15)

`POST /api/v1/auth/change-password` requires **two** authorities. The access token establishes who
is asking; the current password establishes they are not merely holding a stolen token. Drop either
and a leaked token becomes a permanent takeover, because the change locks the real owner out.

`PasswordResetService` now delegates and keeps no private copy of the reuse check, the history
append, the revocation or the GUC setter. The audit's recurring finding is two code paths that agree
on day one and drift afterwards; "reset enforces reuse but self-service change does not" is exactly
that shape, with the added property that the weaker path is the one users take voluntarily.

**Deliberate omissions, each commented at the site:**

- **No failed-attempt accounting on a wrong current password.** Incrementing `failedLoginCount` here
  would let anyone holding a valid access token lock its owner out of their own account by guessing
  badly — turning a read-only token leak into a denial of service. Rate limiting for this path
  belongs at the gateway, where it already exists for the credential routes. Stated as a trade, not
  smuggled in.
- **The endpoint is absent from auth-service's `permitAll` list and from the gateway's
  `PUBLIC_PATHS`.** 13-01 registered only the fully-qualified `/api/v1/auth/change-password/forced`
  there, because `isPublicPath` uses `startsWith` and the bare path would have exposed this one too.
  Both files say so at the site; the live script asserts the 401.

### GitNexus impact (run before editing, per CLAUDE.md)

| Target | Upstream | Risk |
|---|---|---|
| `PasswordResetService` | 2 (`PasswordResetController` IMPORTS + ACCESSES) | LOW |
| `rejectIfPasswordReused` | 2 (its own `confirm`, then the controller) | LOW |
| `revokeActiveRefreshSessions` | 2 (same) | LOW |
| `RefreshSessionRepository` | 5 (adds `RefreshSessionService`) | LOW |
| `PasswordHistoryRepository` | 3 | LOW |

Nothing HIGH or CRITICAL, and in this case the low score is honest rather than understated (unlike
13-01's and 13-03's `GlobalFilter` results): the four extracted methods were `private` on a class
with exactly one caller, which is precisely why they had been able to be the whole policy without
anyone noticing.

The index is stale (last built at `5fba4a9`). Not refreshed, for the same reason 13-01, 13-02 and
13-03 gave: `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files, which 13-01
had to revert.

`detect_changes` vs the pre-plan commit `5fa1ef6`: **11 files, 17 symbols, 0 affected processes,
risk LOW.** The only real symbol changes are in `PasswordResetService` (`confirm`, `request`, the
constructor, the removed privates) — exactly the expected surface. The `BaseIntegrationTest` symbols
are line-shift artefacts of an added comment. No unexpected file.

## Task 3 — proved over live HTTP

`scripts/e2e/phase13-password-change-e2e.sh`: **22 PASS / 0 FAIL, exit 0**, run twice consecutively.
auth-service and gateway jars built at 22:03; their processes started at 22:06 — the plan's
human-check is satisfiable from `ls -l` and `ps -eo lstart`, not from my say-so.

Assertions that could not have been made by reading source:

| Assertion | Result |
|---|---|
| bare `/api/v1/auth/change-password`, no token, through the gateway | **401** — not public |
| garbage bearer token | **401** |
| wrong current password | **401**, and body **byte-identical** to a login failure with traceId stripped |
| a refused attempt leaves the old password working | 200 |
| weak new password **with a wrong current password too** | **400 VALIDATION_FAILED**, not 401 — so validation ran first |
| that refusal echoes neither submitted value | PASS |
| reusing the current password | **400 PASSWORD_REUSE** |
| valid change | **200**; old password then 401, new password 200 |
| changing **back** to the previous password | **400 PASSWORD_REUSE** |
| pre-change refresh session | refused (401) |
| pre-change **access** token | **200**, residual window measured at **900s** |

The "changing back" assertion is the only live proof the history row was actually written: the
current-password check alone would refuse it only if it were still the current password, and it is
not.

Both halves of the session story are asserted, not just the convenient one. An access token is
stateless with no revocation list, so one minted before the change stays valid until it expires.
That is intended, and measuring it makes the window a known fact rather than something discovered
during an incident.

**Live outbox check**, beyond the script:

```
PASSWORD_CHANGED -> {"userId": "e7bed67b-…", "tenantId": "a0000001-…"}
rows in auth event_outbox containing 'Cashier#2026' | 'Zx9!qwrtBn4%' | '$2a$' | '$2b$'  →  0
occurrences of password material in the restarted auth-service log                      →  0
```

## The blocker that was not in the plan, and what it turned out to be

**The plan could not be verified at all when it started.** `AuthLoginIT` — untouched code, JDK 25,
the java binary already approved in `socketfilterfw --listapps` — failed **21/21 across 7
consecutive runs** with `HTTP/1.1 header parser received no bytes` and total silence server-side.
The stated baseline of 45/45 was not reproducible on this machine at this moment.

`DEV-STACK-RUNBOOK.md` documents this symptom and attributes it to Maven launching on JDK 26. That
diagnosis is correct and incomplete. **There is a second cause: the wildcard bind.** Spring Boot
binds the test server to the wildcard address, so an integration test's listener is LAN-reachable;
macOS's Application Firewall filters incoming connections to wildcard-bound sockets per binary, and
one it decides against is accepted and closed with **zero bytes written** — hence a client-side EOF
and nothing in any server log. Loopback traffic is never filtered.

Measured, alternating on the same commit:

| Harness | Before | After |
|---|---|---|
| `AuthLoginIT` (servlet) | 7 runs → 21/21 network errors | 4 runs → 0 network errors |
| gateway `JwtGlobalFilterTest` + `WsUpgradeTest` (reactive) | 18/18 errors | 43/43 green, 3 runs |
| gateway `FeatureFlagFilterIT` + `GatewayRoutingIT` | 15/15 errors | 15/15 green |

This is **not** the firewall workaround the runbook forbids: it approves no binary and disables
nothing, it takes the firewall out of the path. An integration test has no business being reachable
off-box regardless. CI (Linux, no ALF) is unaffected.

**It closes an item 13-01 left explicitly open** — "the gateway `PrematureCloseException` … deserves
its own investigation; I time-boxed mine and reported what I ruled out". Everything 13-01 ruled out
(client HTTP version, hostname, test ordering) was correctly ruled out. The consequence is that the
**five gateway cases 13-01 committed but could not execute** — the tenant-optional platform-path
assertions that are the security-critical half of its change — now actually run, and pass.

Ruled out along the way: a raw `Socket` self-connect inside a JVM on that exact binary returns
`HTTP/1.1 200`, so it is not the JDK, the loopback stack or the socket layer; and `--getstealthmode`
/ `--getblockall` are both off, so it is not a blanket firewall posture.

Fixed in `auth-service`'s IT base class and the four gateway test classes — the suites this plan had
to run and could verify. **Every other service's IT base class still binds to the wildcard.** The
runbook now names the cause, the fix and that remaining exposure.

## Deviations from plan

**1. [Rule 3 — blocking] The IT harness fix above.** Not in the plan's file list. Without it no
number in this document could have been taken. Committed separately (`031d074`, `44cf19d`,
`780c742`) so it can be reviewed, kept or reverted independently of the plan's substance.

**2. [Rule 2 — preventing a foreseeable regression] `TotpBootstrapRequest` also carries the
"do not add `@StrongPassword` here" comment.** The plan named only `LoginRequest`. It is the same
field in the same category, and — because 13-02's finding makes TOTP enrolment mandatory for tenant
admins — the more damaging of the two places to get it wrong.

**3. [Rule 2 — verifiability] Four IT cases beyond the plan's seven behaviours**, each closing a way
the others could pass vacuously: a `userId`/`email` in the request body naming another account is
inert while the *caller's* password is what changes (T-13-04-A asserted rather than inspected); a
successful change does not revoke a different user's sessions (a "revoke everything" bug passes
every other session assertion); no password value or bcrypt prefix appears in any event the change
emits; and the reset path still rejects a weak new password after the extraction.

**4. [Rule 1 — bug in my own harness, found by the harness disagreeing with itself]** The e2e
script's `post_change` assigned the HTTP status to a global, and every call site is a command
substitution — which is a **subshell**, so the assignment died with it and the parent kept reporting
the status of the last call made outside one. Four assertions reported a confident `401` while their
body assertions, **on the very same responses**, correctly read `400 VALIDATION_FAILED` and
`400 PASSWORD_REUSE`. Only the density of the assertions made the contradiction visible. Same defect
class as the brace-expansion bug 13-02 had to fix in its own harness. Status and body are now
returned together and split by the caller, with the reasoning recorded at the function.

**5. [Rule 1 — bug in my own test] `PasswordChangeIT` planted a lockout before logging in**, and
login refuses a locked account. Invisible during the RED (the test failed earlier, for the intended
reason) and only surfaced once the endpoint existed. Fixed in the `feat` commit and called out
there.

**6. [Out of plan scope — build hygiene, no source touched] 83 macOS `" 2"` / `" 3"` duplicate
files under `*/target/`** made surefire fail with
`io/restaurantos/shared/integration/TestFixtures 2 (wrong name: …)`. The same failure 13-01 and
13-03 both recorded. Deleted only paths inside `target/`; no tracked file touched.

**7. [Out of plan scope, no source touched] Services restarted.** `mvn clean package` rewrote jars
under running JVMs. auth-service and gateway were restarted deliberately (the human-check);
**pos-service** was then serving `500` on `/actuator/health` with an empty body and was restarted
rather than diagnosed, per the operator's standing instruction. All six locally-running services
answer 200 at the end of this plan.

## Left open, and not claimed to work

### 1. ~48% of generated temp passwords would fail the policy this plan just introduced

`ProvisioningAdminService.generateTempPassword()` draws 16 characters uniformly from a 57-character
alphabet containing only **three** symbols (`!@#`) and eight digits. Measured over 200 000 draws:

```
failing @StrongPassword: 47.7%    (missing a symbol 42.1%, missing a digit 8.9%)
```

**Nothing is broken today.** A temp password is generated and hashed server-side and then presented
at login, and neither path is validated — the constraint only applies where a password is *chosen*
through the two DTOs. But it means the platform issues credentials its own policy would reject, and
that becomes visible the moment **13-08** (forced change) or **13-13** (admin-initiated reset) puts
a generated password anywhere near a validated field.

Not fixed here: `ProvisioningAdminService` is not in this plan's file list and belongs to the
provisioning repair (13-06/13-07). The fix is small — draw one character from each required class
first, then fill and shuffle — and should be made deliberately by whoever owns that file.

### 2. `Test@123!` cannot be set through any validated path, and this needs your decision

You asked to be told plainly rather than have the rule quietly weakened or the seed quietly changed.
Verified against the new policy, every literal credential in the seeds and scripts:

| Password | Where | Verdict |
|---|---|---|
| `Test@123!` | the SuperAdmin credential in 13-CONTEXT | **REJECTED — 9 chars** |
| `Test@0110!` | `scripts/` | **REJECTED — 10 chars** |
| `Owner#2026` | `900-seed-auth-dev-data.xml`, `TestFixtures` | **REJECTED — 10 chars** |
| `Chef#2026` | seed + `TestFixtures` | **REJECTED — 9 chars** |
| `Cashier#2026`, `Manager#2026`, `Accountant#2026`, `Manager1#2026`, `Finance#2026`, `ChangeMe#2026` | seeds | OK |
| `SuperAdmin@restaurantos#2024` | `900-seed-platform-users.xml` | OK (but 13-CONTEXT says it must not remain usable) |

**Every one of them still works today**, including `Test@123!`. Seeds write a bcrypt hash directly,
and `LoginRequest` deliberately carries no strength rule — which is the whole reason it carries
none. The four rejected values are rejected only if someone tries to **set** them through
`change-password` or `reset-password/confirm`.

The consequence is concrete and lands on **13-15**: a seed script that sets passwords by writing
hashes is fine, but a seed script that sets them by *driving the change-password API* cannot produce
`Test@123!`, `Owner#2026` or `Chef#2026`. Three options, none of which I took unilaterally:

1. keep the rule and lengthen the seed credentials (e.g. `Test@123!Demo`, `Owner#2026!ab`) —
   changes the credentials you specified;
2. keep the rule and have 13-15 write hashes directly for these personas — keeps the credentials,
   but the seed no longer exercises the endpoint;
3. lower `min` — I would argue against it; 12 is already the floor, and the annotation's `min` is
   overridable per use site precisely so a policy change never has to be global.

### 3. The strength rule is not applied at the two places that do not exist yet

`13-08`'s forced-change DTO and `13-13`'s admin-reset DTO must carry `@StrongPassword` on their
new-password fields. There is no automated guard forcing them to — a closure test of the
`PermissionCatalogClosureTest` / `FeatureCodeClosureTest` shape would be the right instrument
("every DTO field named `*ewPassword` carries the constraint"), and I did not write one because
there are two such fields today and both are correct. If a third and fourth land in this phase, it
becomes worth writing.

### 4. Rate limiting on change-password is inherited, not verified

The decision not to do failed-attempt accounting rests on the gateway rate-limiting the credential
routes. `/api/v1/auth/change-password` goes through the `auth-route`, not the dedicated
`platform-auth-route`; I did not measure its burst capacity. Worth confirming before this is relied
on as the only brake on current-password guessing by a token holder.

## Known stubs

None. Every symbol this plan created is wired and exercised — by a unit test, an integration test,
a live HTTP assertion, or all three.

## Threat flags

None beyond the plan's register. Each entry and where it is closed:

- **T-13-04-A** (target selection) — the DTO has no user-id field; asserted live-ish in
  `PasswordChangeIT` by sending `userId` **and** `email` naming another account and checking that
  account's hash is byte-identical afterwards while the caller's password is what changed.
- **T-13-04-B** (current-password verification) — verified with the injected bcrypt-cost-12 encoder
  before any write; failure throws the shared generic exception.
- **T-13-04-C** (validation/error messages) — the strength message names unmet rules only, proven by
  the fragment scan *and* the identical-message invariant; the failure body is compared byte for
  byte against a login failure both in the IT and live.
- **T-13-04-D** (password material in logs/events) — the event carries two ids; asserted in the IT
  by scanning every new outbox envelope for both plaintexts and three bcrypt prefixes, and
  confirmed against the live database (0 rows) and the live service log (0 occurrences).
- **T-13-04-E** (session survival) — all refresh sessions revoked in the same transaction; the
  residual access-token window asserted explicitly and measured at 900s.
- **T-13-04-F** (unbounded length) — 128-char maximum, with the javadoc distinguishing it from
  bcrypt's 72-byte truncation.
- **T-13-04-G** (reset/change divergence) — one policy service; the reset service holds no private
  copy, and `PasswordResetIT` still passes against the delegated implementation.
- **T-13-04-SC** — did not arise for application code: no npm/pip/cargo package was installed. Two
  Maven dependencies were added to shared-lib, both first-party Jakarta/Spring artifacts already
  resolved elsewhere in this reactor at the identical version.

## Verification actually run

Every number below is from a command executed in the state being reported, with
`JAVA_HOME=openjdk@25`, `TESTCONTAINERS_RYUK_DISABLED=true`,
`TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`.

| Suite | Result | Baseline |
|---|---|---|
| `mvn -pl shared-lib,services/auth-service,gateway,services/user-service,services/platform-admin-service -am verify` | **BUILD SUCCESS**, all 6 modules | — |
| ├ shared-lib | unit **37/37**, IT 11/11 | was 10 unit |
| ├ auth-service | unit 21/21, IT **59/59** | was 45 IT |
| ├ gateway | unit **43/43**, IT **15/15** | red on arrival; see above |
| ├ user-service | unit 3/3, IT 11/11 | unchanged |
| └ platform-admin-service | unit 5/5, IT **22/22** | unchanged |
| `mvn -T1C clean package -DskipTests` | **21/21 modules SUCCESS** | — |
| `mvn -T1C -DskipTests test-compile` (final tree) | **21/21 modules SUCCESS** | — |
| `opa test policies/` | **139/139** (no `.rego` touched) | unchanged |
| `bash scripts/e2e/phase13-password-change-e2e.sh` | **22 PASS / 0 FAIL**, exit 0, twice | — |
| live `event_outbox` scan for password material | **0 rows** | — |
| `detect_changes` vs `5fa1ef6` | 11 files, 17 symbols, 0 processes, risk LOW | — |

The RED for each TDD gate, measured rather than asserted:

| Gate | Measured RED |
|---|---|
| `StrongPasswordValidatorTest` | 27 run, **19 failures** against a validator that accepts everything |
| `PasswordChangeIT` | 14 run, **11 failures**; the 3 passes are the two no-token 401s and the reset-path check, which pass for reasons unrelated to the endpoint |

Also confirmed unchanged: `/api/v1/auth/change-password` is **not** in the gateway's `PUBLIC_PATHS`
(only the fully-qualified `/forced` variant 13-01 registered), and not in auth-service's `permitAll`
list.

## Self-Check: PASSED

All 9 created files exist on disk. All 8 commits exist in `git log`:
`9fa5ca9`, `08bdacf`, `031d074`, `3936bf8`, `82a9ba9`, `867995b`, `44cf19d`, `780c742`.
