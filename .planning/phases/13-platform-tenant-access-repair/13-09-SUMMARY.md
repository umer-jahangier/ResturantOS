---
phase: 13-platform-tenant-access-repair
plan: 09
subsystem: auth-passwords
tags: [passwords, reset, outbox, redaction, rls, cooldown, non-enumeration, d-18, d-19, d-21, d-31, sc4]
status: complete
requires:
  - running dev stack (postgres, redis, rabbitmq, eureka) + gateway, auth-service, user-service
  - "13-04: PasswordPolicyService.clearLockout, @StrongPassword, PasswordChangeService"
  - "13-08: issueSingleUseToken / redeemSingleUseToken / invalidateOutstanding / purpose column"
provides:
  - "PasswordResetRequestedPayload (shared-lib typed event record: {userId, email, tokenId})"
  - "PasswordResetDeliveryProperties — restaurantos.auth.password-reset.delivery-mode (default disabled), .cooldown (default 15m)"
  - "PasswordResetService.RequestOutcome {ACCEPTED, DELIVERY_DISABLED}"
  - "RESET_DELIVERY_DISABLED warning code on POST /api/v1/auth/reset-password/request"
  - "PasswordPolicyService.lastIssuedAt / lockForIssuance"
  - "PasswordResetTokenRepository.findTopByUserIdAndPurposeOrderByCreatedAtDesc"
  - "IssuedToken gains tokenId — a non-secret handle for an issued token"
  - "BaseIntegrationTest.mintResetToken — a raw RESET token by construction, for tests that can no longer read one out of an event"
  - Docs/known-gaps/notification-delivery.md
  - scripts/e2e/phase13-reset-hardening-e2e.sh
affects:
  - "13-13: admin-initiated reset reuses this issuance path, inherits the cooldown and the advisory lock, and must decide whether an ADMIN reset is subject to the same cooldown"
  - "13-15: the seed run gets DISABLED reset unless it sets PASSWORD_RESET_DELIVERY_MODE=outbox — and it does not need to, because no persona recovers by email"
  - "any future notification-service consumer: the event no longer carries the token"
tech-stack:
  added: []
  patterns:
    - the assertion that catches a leaked secret hashes the payload, so it never has to hold the secret
    - put the strongest assertion FIRST, because assertions that pin values make later ones unfalsifiable
    - a control on both sides, or an equality assertion also passes against an endpoint that does nothing for anybody
    - a rate limit that announces itself is an oracle with a rate limiter attached
    - fail closed in the constructor, not only in the yaml
    - restore shared fixtures on BOTH sides of a test, because run order is the filesystem's
key-files:
  created:
    - shared-lib/src/main/java/io/restaurantos/shared/event/payload/PasswordResetRequestedPayload.java
    - services/auth-service/src/main/java/io/restaurantos/auth/config/PasswordResetDeliveryProperties.java
    - services/auth-service/src/test/java/io/restaurantos/auth/config/PasswordResetDeliveryPropertiesTest.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/PasswordResetHardeningIT.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/PasswordResetDeliveryDisabledIT.java
    - Docs/known-gaps/notification-delivery.md
    - scripts/e2e/phase13-reset-hardening-e2e.sh
  modified:
    - services/auth-service/src/main/java/io/restaurantos/auth/service/PasswordResetService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/PasswordPolicyService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/repository/PasswordResetTokenRepository.java
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/PasswordResetController.java
    - services/auth-service/src/main/resources/application.yml
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/BaseIntegrationTest.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/PasswordResetIT.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/ForcedPasswordChangeIT.java
    - services/notification-service/README.md
decisions: [D-18, D-19, D-21, D-31]
requirements: [AUTH-06]
metrics:
  duration: ~1h
  completed: 2026-08-07
  tasks: 3
  commits: 6
---

# Phase 13 Plan 09: Password-Reset Hardening — Summary

The raw reset token is out of the outbox, a reset genuinely unlocks the account, one account holds
one live token and can only ask for it so often, and the forgot-password flow no longer pretends to
send an email it has no way to send.

## The four numbers a later plan needs

| Fact | Value |
|---|---|
| Delivery mode property | **`restaurantos.auth.password-reset.delivery-mode`**, default **`disabled`** (env `PASSWORD_RESET_DELIVERY_MODE`) |
| Per-account cooldown | **`restaurantos.auth.password-reset.cooldown`**, default **`15m`** (env `PASSWORD_RESET_COOLDOWN`) |
| Event payload | `PasswordResetRequestedPayload{userId, email, tokenId}` on `auth.topic` / `auth.user.password_reset_requested` / `PASSWORD_RESET_REQUESTED` |
| Disabled-mode response | `200` with `warnings[0].code = "RESET_DELIVERY_DISABLED"` |

**13-15 does not need to change the mode.** No seed persona recovers by email; every persona gets
its password through provisioning plus the forced change (13-08) or an admin reset (13-13). If a
future seed run does need `outbox`, it is one environment variable and a restart — the mode is read
at startup, deliberately, because a flow that can be switched on by a request can be switched on by
an *attacker's* request.

## D-19 — the raw token is out of the outbox, and here is how that is actually proved

The payload was `{userId, email, token}` with `token` the **raw** value, written into
`event_outbox` beside auth-service's own SHA-256 of the same string. The hashing was decorative:
the credential was durable, replicated to every consumer of `auth.topic`, and in every backup, so
read access to any of those was account takeover for anyone who had ever requested a reset —
without touching `password_reset_tokens` at all.

It now carries identity plus **`tokenId`**, the row handle. That confers nothing on its own:
redemption needs the raw token, and reading the token from the handle needs database access to
`auth_db`, which is already the trust level required to read the hash (T-13-09-G, accepted).

**The assertion.** For every string in the persisted payload, `SHA-256(string) != token_hash`,
where `token_hash` is the value the *same request* wrote to `password_reset_tokens`. It never holds
the raw token — that is the point, and it is why the test survives the design it is testing. Made
against the database in `PasswordResetHardeningIT` and again in the live script.

Three things about that assertion are deliberate and were each learned by measurement:

1. **It reads `event_outbox`, not a mock.** The publisher was called *correctly*, with the wrong
   argument. Anything that stopped at `EventPublisher` would have been green against the defect.
2. **It runs FIRST, before the shape assertions.** The shape assertions pin `userId`, `email` and
   `tokenId` to expected values; after they pass, the hash loop *cannot* fail. It would be a green
   that proves nothing about itself. Discovered by running the falsification below and watching the
   wrong assertion fire.
3. **It was falsified.** With the raw token republished under the key `tokenId` — so the key-set
   check still passes — the loop fails and names the offending value:
   ```
   [payload value 'a0000001-….W57TNwAAGMfNaldKxHRVALEfgRR7hTYM2eLxfYNduCU' hashes to the stored token hash]
   Expecting actual: "de286d36…3ff4b1" not to be equal to: "de286d36…3ff4b1"
   ```

**The event is a typed record in `shared-lib`,** not a `Map`. Its consumer does not exist, which
makes the type *more* important rather than less: the seam is dead, so nothing would fail today if
a producer-side rename silently changed the shape. That is the documented lesson of the 2026-08-02
integration repair — "green tests over four dead seams" — and this is the same seam, still dead.

## D-18 — a reset now genuinely unlocks, and clears the forced-change flag too

`confirm` delegates to `PasswordPolicyService.clearLockout` (13-04's routine, not a second copy)
and also clears `must_change_password`.

**The second one was not in the plan and is worth defending.** `PasswordChangeService.changeOwnPassword`
already clears it; reset did not. Leaving that asymmetry means a user who completes a reset is
refused on their very next login with `PASSWORD_CHANGE_REQUIRED` and made to change a password they
chose seconds earlier — which reads as a broken reset, and is exactly the two-paths-that-drift shape
this phase's audit is about. **The 13-08 gate is not weakened:** nothing here clears the flag for a
password the user did not choose, and the flag's purpose — stopping a temporary credential from
becoming permanent — is satisfied by definition when the user picks the replacement themselves under
a proof of control of their own address.

Proved live from a **genuinely** locked account: five wrong passwords through the gateway until the
correct password is refused `423`, then a reset, then `200` on the next login with no wait.

**One deliberate piece of stagecraft, stated because it would otherwise be a vacuous pass.**
`handleFailedPassword` *zeroes* `failed_login_count` at the moment it trips the lock, so a genuinely
locked account already has `0` there and "0 afterwards" would pass against a reset that did nothing.
The script plants `failed_login_count = 3` by SQL before the reset and asserts on that. The
`locked_until` half needs no help — it is set by the real lockout path.

## D-21 — one live token, and a cooldown that cannot be used as an oracle

Issuing already retired outstanding tokens (13-08 gave the reset path that for free). What was
missing was any bound on *how often* one account can be made to issue.

Fifteen minutes by default — half the token's own thirty-minute life, so someone who genuinely lost
the first message can ask again while the first is still live. It **complements** the gateway's
per-IP budget on `auth-route` (`replenishRate=2/s, burst=100`) rather than replacing it: that bounds
what one SOURCE can generate; this bounds what one ACCOUNT can be made to receive, which is the
thing a distributed caller would otherwise multiply without limit.

**The refusal is silent and byte-identical to a successful issuance.** A 429, a "try again in 12
minutes", any observable difference at all, is an account-existence oracle with a rate limiter
attached: request twice and the second answer tells you whether the first landed on a real account.
Asserted by comparing **bodies**, not statuses, in both the IT and the live script.

### The advisory lock, and why check-then-act was not good enough

`lockForIssuance` takes `pg_advisory_xact_lock(hashtext('password-token-issuance:' || userId))`
before the cooldown read. Without it both the cooldown and the single-live-token rule are
check-then-act: two simultaneous requests each read "no recent issuance", each retire the other's
not-yet-inserted row (retiring nothing), and each insert — **two live tokens and two events**, which
is precisely what T-13-09-C and T-13-09-D exist to prevent. The window is small, and an attacker
choosing when to send two requests does not need it to be large.

An **advisory** key rather than a row lock, for two reasons: there is no row to lock on an account's
first request, and locking the `users` row would let an anonymous caller block that user's *logins*
by hammering this endpoint — turning a denial-of-service control into a denial-of-service vector.
Contention is bounded by the cooldown itself: a serialised queue of requests for one account issues
at most one token per window however long the queue is.

**This is the one property in the plan that is reasoned rather than measured.** I did not build a
concurrent harness to demonstrate the race, so what is asserted is the sequential behaviour; the
lock is a defence whose necessity is argued from the transaction semantics, in the same way 13-08
argued `claimIfRedeemable` under READ COMMITTED. Stated rather than glossed.

## D-31 — the notification question, resolved by saying so rather than by pretending

`services/notification-service` is an active Maven module with **zero source files** — verified for
the record: `pom.xml` and `README.md`, nothing else, and `find services/notification-service/src
-name '*.java'` finds no directory at all. Nothing consumes `PASSWORD_RESET_REQUESTED`.

Before this plan the endpoint answered `200`, minted a live credential, wrote an event nobody read,
and left the user waiting for a message that was never coming. It was not broken in any way a
monitor could see; it was doing exactly what it was written to do, and what it was written to do was
nothing.

**Decision: email delivery is out of scope for this milestone, the flow ships disabled, and the
endpoint says so.** A real consumer means SMTP or a provider, per-tenant sender configuration,
bounce handling and templates — none of it in scope. A **fake** consumer that logs and drops is
strictly worse than none, because it makes a dead flow look alive to everyone who reads the code
afterwards. **No stub was created.** The gap is `Docs/known-gaps/notification-delivery.md`, which
records what the event now carries, what a future consumer must do to fetch the token over an
internal channel, and — in bold — that it must never solve the problem by putting the token back
into the event.

`services/notification-service/README.md` already carried a placeholder asking to be linked once
that document existed. It is linked, and told that the flow now ships disabled with a startup
warning. That README edit is the only thing this plan touched in that module; no source file was
added.

### Why the disabled response is safe to be different

Turning a flow off is the easiest way in the world to build an account-existence oracle: refuse for
unknown addresses, accept for known ones. The disabled branch is safe **because it is a property of
the deployment, not of the address** — and structurally so: it returns before the tenant is
resolved and before any row is read, so it cannot differ by address, by tenant, or in the time it
takes to produce. Asserted live for a known address, an unknown address **and a tenant that does not
exist**, all three byte-identical.

`RequestOutcome` has exactly two values and neither names an account condition. There is no
`NO_SUCH_ACCOUNT` and no `COOLDOWN` for a future edit to accidentally return.

## The RLS question, answered directly

**The prompt asked how I convinced myself this works against a real RLS-enforcing database rather
than against Testcontainers' superuser. Here is the answer.**

This plan adds exactly **one** new row-level-security-scoped read to the reset path: the cooldown
lookup, `findTopByUserIdAndPurposeOrderByCreatedAtDesc`, on `password_reset_tokens`, which is
`FORCE ROW LEVEL SECURITY` on `app.current_tenant_id`. It is issued inside `issueUnlessWithinCooldown`,
which runs after `request()` has already called `setTenantGuc(tenantId)` — before the user lookup
and therefore before this one.

**A mistake here fails silently OPEN, which is worse than the failures this phase has already
found.** An RLS-hidden row means "no recent issuance", which means "issue", which means the cooldown
simply does not exist — no error, no log line, and a green integration suite, because
Testcontainers' Postgres user is a SUPERUSER and superusers bypass row security entirely. That is
the same blind spot that let 13-02's branch-role write, 13-06's user INSERT and 13-08's
reset-confirm all ship broken.

So the proof is not the integration test. It is
`scripts/e2e/phase13-reset-hardening-e2e.sh` asserting, against the live `auth_db` whose owner
`auth_user` is `NOSUPERUSER NOBYPASSRLS`, that **two rapid requests leave exactly one token row**:

```
PASS: two rapid requests minted exactly ONE token — the cooldown is enforced server-side (1)
PASS: and exactly one reset token is live for the account (1)
```

If the cooldown read came back empty under the policy, that count is 2 and the assertion fails. It
is the only assertion in this plan that can distinguish the two cases, and it cannot be made in
Testcontainers.

The `confirm` path adds no new query — `clearLockout` and `setMustChangePassword` mutate an entity
already loaded through 13-08's fixed path, and the existing `save` persists them. That the whole
sequence works against the enforcing database is nonetheless measured rather than assumed: the live
script redeems a token and gets `200`, then logs in with the new password and gets `200`, then reads
`failed_login_count`, `locked_until` and `must_change_password` back out of the database and finds
`0|true|false`.

The advisory lock touches no table and is not subject to RLS.

## Deviations from plan

**1. [Rule 1 — bug caused by this plan] Two IT classes went red for a reason unrelated to either.**
`PasswordResetHardeningIT` left the shared demo cashier holding a password of its own choosing, and
failsafe's default run order is the filesystem's, so `StepUpLoginIT` and `RoleCatalogIT` started
failing with "Invalid credentials" on a credential the fixture says is correct. Both reset IT
classes now restore the cashier on **both** sides of every test. Commit `f99b337`.

**2. [Rule 3 — blocking, caused by this plan] Three ITs recovered their raw token by reading it out
of the outbox payload** — which worked only because the defect was there. All three now mint one
through the production issuance path (`BaseIntegrationTest.mintResetToken`). One of them was a
**false green waiting to happen**: `ForcedPasswordChangeIT`'s missing field made `asText()` return
`""`, the empty string failed bean validation, and "a reset token is refused at the forced endpoint"
went `401` → `400` — still a refusal, and it would have kept passing on a status-*class* assertion.
Commit `f99b337`.

**3. [Rule 2 — one policy, one implementation] `confirm` also clears `must_change_password`.** Not
in the plan's behaviour list. Reasoned above.

**4. [Scope — one extra IT class] `PasswordResetDeliveryDisabledIT` is a second file** where the
plan named one. The two modes need two Spring contexts and the disabled one must carry **no**
`@TestPropertySource` at all, so that it measures `application.yml` as shipped rather than a mode a
test asked for. `PasswordResetIT` and `PasswordResetHardeningIT` repeat the outbox property string
verbatim so they share one context rather than starting a third.

**5. [Scope — one extra unit test] `PasswordResetDeliveryPropertiesTest`,** covering the fail-closed
defaults and the startup warning's content. The warning is a plan requirement and an IT is the wrong
instrument for a boot-time log line.

**6. [Rule 1 — bug, mine, in the file I was editing] `PasswordResetService`'s class javadoc claimed
redemption "resolves the tenant through a SECURITY DEFINER function".** That design was written,
applied and **withdrawn** inside 13-08 and the javadoc was not updated with it. Corrected. A comment
describing a design the code does not have is worse than no comment, and this one described the most
load-bearing decision in the file. Commit `65ad09b`.

**7. [Rule 3 — path casing] The gap document is at `Docs/known-gaps/…`, not `docs/…`.** The plan
names it in lower case; this repository's documentation directory is `Docs`. On macOS the file was
created at the requested path and committed at the real one, leaving every reference I had written
resolvable only on a case-insensitive filesystem. All normalised. Commit `65ad09b`.

**8. [Out of plan scope, no source touched] The e2e script restarts auth-service twice.** The
delivery mode is read at startup by design, so proving both modes live requires it. Nothing else is
restarted, and the box is left on the shipped default.

**9. [Out of plan scope, no tracked file touched] macOS `" 2"` / `" 3"` duplicate class files under
`*/target/`** broke `mvn verify` twice with `TestFixtures 2 (wrong name: …)`. The same failure
13-01, 13-03 and 13-04 all recorded. Deleted only paths inside `target/`. Note for whoever chases
this properly: they are regenerated **during** the build, not before it, so a pre-build clean is not
enough — `test-compile`, delete, then `verify` is what works.

## Three harness bugs found by running the script, each a false signal about the product

Recorded because each one reported a defect that was not there, and the density of assertions is
what exposed them.

1. **The lockout columns were read after a deliberately wrong login**, which increments
   `failed_login_count` back to 1. Reported as `expected 0|t|f, got 1|true|false` — I nearly wrote it
   up as a product defect. They are now read in the state the *reset* left them, with nothing in
   between.
2. **Five wrong-password requests are not five recorded failures.** Four were answered by the
   gateway's own `SERVICE_UNAVAILABLE` fallback on a cold `lb://` pool, so the account never locked:
   `wrong-password attempt statuses: 503 503 503 503 401 …`. The script now submits until the
   threshold trips and **prints the statuses**, so a failure here is diagnosable from the output
   alone.
3. **Eureka holds a killed instance's lease for up to 90 seconds**, so the gateway round-robins
   between a live instance and a dead one and a streak of successes can pass by luck — the next run
   died in setup with `SERVICE_UNAVAILABLE`. Readiness now waits for Eureka to report exactly **one**
   UP instance, then waits out the gateway's own registry-fetch interval, then requires ten
   consecutive application-level answers.

## Left open, and not claimed to work

### 1. The cooldown race is argued, not measured

See the advisory-lock section. The sequential behaviour is asserted; the concurrent behaviour the
lock exists for is not exercised by any test. A two-process harness firing simultaneous requests at
one account would close it.

### 2. Whether an ADMIN-initiated reset should be subject to the same cooldown — 13-13's decision

13-13 reuses `issueSingleUseToken` and will inherit `lockForIssuance` if it calls through the same
path. It should **decide** whether an administrator resetting a user's password is rate-limited the
same way a public request is. Arguments both ways: an admin is authenticated and audited, so the
oracle concern does not apply; but an admin account that is compromised is exactly the one you want
bounded. Not decided here because 13-13 owns that file.

### 3. `tokenId` in the event is accepted risk, not zero risk

T-13-09-G. The handle is useless without database access to `auth_db`. But it does mean a consumer
of `auth.topic` learns that a *particular row* exists and can correlate it with an email address.
That is strictly less than the credential, and strictly more than nothing. Accepted, and recorded so
it is a decision rather than an oversight.

### 4. Nothing consumes the event, so the payload's fitness is untested

`tokenId` is the right handle for a consumer that fetches over an internal channel — **and that
internal endpoint does not exist.** Writing it is the hard part of closing this gap (it hands out a
live credential, so it has to be single-fetch, short-lived, and refuse a spent handle), and the gap
document says so. Until it is written, the payload's shape is a well-reasoned guess.

### 5. The gateway rate limit on the reset routes is still inherited, not measured

`/api/v1/auth/reset-password/**` goes through `auth-route` (`replenishRate=2/s, burst=100`). The
per-account cooldown is now measured; the per-IP budget it complements is not. 13-04 and 13-08 both
flagged the same unmeasured inheritance for their own paths. Still unmeasured.

## Known stubs

**None, and this plan is specifically about not creating one.** `services/notification-service`
contains `pom.xml` and `README.md` and nothing else, before and after. Every symbol this plan created
is wired and exercised by a unit test, an integration test, a live HTTP assertion, or all three.

## Threat flags

None beyond the plan's register. Where each entry is closed:

- **T-13-09-A** (raw token in the outbox) — the payload carries identity plus a row handle; proved by
  hashing every string in the persisted payload against the token_hash the same request wrote, in
  the IT **and** live, with the assertion falsified against a deliberately reintroduced defect.
- **T-13-09-B** (enumeration through the request endpoint) — every branch returns one body; asserted
  by byte-equality for a known address, an unknown address, a cooldown refusal and an unknown
  tenant, with a control proving the known address really did issue.
- **T-13-09-C** (unbounded requests per account) — a 15-minute per-account cooldown independent of
  the gateway's per-IP budget, plus the advisory lock; the cooldown measured against the
  RLS-enforcing database.
- **T-13-09-D** (multiple concurrently valid tokens) — issuing retires outstanding ones (13-08),
  asserted in the IT by checking the previous row's `used_at` is set and the new one's is not, and
  live by counting live rows.
- **T-13-09-E** (a reset that leaves the account locked) — `clearLockout` through the shared routine,
  proved from a genuinely locked account with a planted non-zero counter so the assertion is not
  vacuous.
- **T-13-09-F** (a recovery flow that silently does nothing) — disabled by default, logged at
  startup naming the property, surfaced as `RESET_DELIVERY_DISABLED`, documented as a named gap; no
  stub consumer created.
- **T-13-09-G** (the handle) — accepted; see "Left open" #3.
- **T-13-09-SC** — did not arise. **No package of any kind was installed**, in any ecosystem, and no
  Maven dependency was added.

## Verification actually run

Every number is from a command executed in the state being reported, with
`JAVA_HOME=openjdk@25`, `TESTCONTAINERS_RYUK_DISABLED=true`,
`TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`.

| Suite | Result | Baseline |
|---|---|---|
| `mvn -pl services/auth-service verify` | **BUILD SUCCESS** | — |
| ├ auth-service unit | **28/28** | was 24 (+4 `PasswordResetDeliveryPropertiesTest`) |
| └ auth-service IT | **121/121** | was 112 (+7 hardening, +2 disabled-mode) |
| `mvn -pl gateway verify` | unit **51/51**, IT **15/15** | unchanged; no gateway file touched |
| `mvn -pl shared-lib -am verify` | unit **38/38**, IT **11/11** | unchanged |
| `mvn -T1C -DskipTests test-compile` (whole reactor) | **SUCCESS** | — |
| `opa test policies/` | **139/139** | unchanged; no `.rego` touched |
| `bash scripts/e2e/phase13-reset-hardening-e2e.sh` | **31 PASS / 0 FAIL, exit 0**, three times | new |
| `bash scripts/e2e/phase13-forced-change-e2e.sh` | **25 PASS / 0 FAIL** | unchanged |
| `bash scripts/e2e/phase13-password-change-e2e.sh` | **22 PASS / 0 FAIL** | unchanged |
| `bash scripts/e2e/phase13-auth-provisioning-seam-e2e.sh` | **20 PASS / 0 FAIL** | unchanged |
| `bash scripts/e2e/phase13-superadmin-e2e.sh` | **21 PASS / 0 FAIL** | unchanged |
| `bash scripts/e2e/phase13-role-catalog-e2e.sh` | **26 PASS / 2 FAIL** | unchanged — the two known 13-12 findings, neither touched |
| all six local services `/actuator/health` | **200** | — |

### The RED for each TDD gate, measured rather than asserted

| Gate | Measured RED |
|---|---|
| Task 1 (`PasswordResetHardeningIT`) | **4 run, 2 failures** — payload key set `[userId, email, token]`; `failed_login_count` 4 after a completed reset |
| Task 2 (+`PasswordResetDeliveryDisabledIT`, +properties test) | **13 run, 3 failures** — both disabled-mode cases; two rapid requests mint two tokens |
| Falsification of the decisive assertion | with the raw token republished under key `tokenId`: **fails, naming the value** |

**The RED passes, named — because a red that flatters itself is how a vacuous test ships:**

- `resetToken_isStoredHashedAndStillRedeemable` and `resetConfirm_keepsTheBehaviourItAlreadyHad` —
  **genuinely** correct in RED. They guard 13-08's and 13-04's work, which this plan must not
  disturb, and should pass on both sides.
- `resetRequest_unknownEmail_isIndistinguishableAndInert` — likewise. Non-enumeration is one of the
  few things the audit rates as well built.
- `resetRequest_afterTheCooldown_issuesAndRetiresTheOutstandingToken` — **passed for the wrong
  reason.** With no cooldown both requests issue, so the ageing half of the test was not exercised at
  all. A real guard for T-13-09-D and a vacuous one for the cooldown, until the cooldown existed.

`PasswordResetDeliveryPropertiesTest` passed on its first run: it and the record it tests were
written together, so it is a genuine test-first unit with no measurable RED, which is stated rather
than dressed up.

**Human-check satisfied from timestamps and queries, not from my say-so:** auth-service jar built
`02:57:26`, the process serving the final run started `02:58:31` — newer than its jar. After the
run, `PASSWORD_RESET_DELIVERY_MODE` appears **0** times in the process environment, a live request
answers `RESET_DELIVERY_DISABLED`, and the throwaway tenant leaves **0 users, 0 tenants, 0 tokens**.

**The harness can fail, demonstrated rather than claimed.** Three runs in this session reported
`FAIL` lines and a non-zero exit before the three harness bugs above were fixed — including the very
first run, which correctly caught a real ordering error in its own assertions.

### GitNexus, run before editing (per CLAUDE.md)

| Target | Upstream | Risk |
|---|---|---|
| `issueResetToken` | 1 direct (`PasswordResetService.request`), 2 total, 0 processes | **LOW** |
| `PasswordResetService` | 2 (`PasswordResetController` IMPORTS + constructor) | **LOW** |
| `PasswordResetService.confirm` | 1 (`PasswordResetController.confirm`) | **LOW** |

The low scores are honest here, unlike 13-01's and 13-08's: this service genuinely has one caller,
which is a controller, and the flow is public and self-contained. The riskiest edit in the plan is
not in this service at all — it is the extra component on `PasswordPolicyService.IssuedToken`, whose
other consumer is `AuthServiceImpl.enforceForcedPasswordChange`, i.e. every login in the platform.
That is why it is purely additive (a new record component, no signature changed) and why the full
`AuthLoginIT` / `StepUpLoginIT` / `ForcedPasswordChangeIT` / `AuthTenantProvisioningIT` set was run
green rather than only the reset suites.

The index is **stale** (last built at `5fba4a9`). Not refreshed, for the reason 13-01 through 13-08
all gave: `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files, which 13-01 had
to revert. `detect_changes -s compare -b 5fba4a9` was run and is **not usable for this plan's
scope** — a second agent executing 13-10 committed to this branch during the run, so the comparison
against the pre-plan commit mixes both plans' work plus 70 earlier commits. Scope was reviewed with
`git diff --stat` per commit instead; every file is in this plan's declared surface or is named as a
deviation above, and nothing outside `services/auth-service`, `shared-lib`,
`services/notification-service/README.md`, `Docs/` and `scripts/e2e/phase13-reset-hardening-e2e.sh`
was touched.

## A note on the shared working tree

A second agent was executing **13-10** in this same checkout throughout. Its changes to
`services/platform-admin-service` and `services/user-service` appeared in `git status` mid-run and
were never staged by me; every commit here names its files explicitly. Its commits are interleaved
with mine in the branch history. The `deploy/` and `scripts/*.sh` files the operator was editing
were not touched — the only file added under `scripts/` is the new
`scripts/e2e/phase13-reset-hardening-e2e.sh`.

## Self-Check: PASSED

All 7 created files exist on disk. All 6 commits exist in `git log`:
`4f04093`, `f99b337`, `5540bb9`, `570e87e`, `e9c49bf`, `65ad09b`.
