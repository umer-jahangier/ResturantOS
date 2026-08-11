---
phase: 16b
plan: "01"
subsystem: auth
status: complete
tags: [auth, platform, refresh-token, rotation, rls, security]
requires:
  - 16a-01 (email-first login — gave the SuperAdmin a browser path at all)
  - 19c-01 (the console that made the missing session visible, and pinned it)
provides:
  - a short-lived, single-use rotating refresh session for platform (SuperAdmin) users
  - reuse detection that revokes the session family
  - a control-plane standing check, so deactivating a SuperAdmin still ends their access
affects:
  - auth-service (login, refresh, refresh_sessions schema)
  - platform-admin-service (one new read-only internal endpoint)
  - frontend session rehydration (adapter only)
tech-stack:
  added: []
  patterns: [single-use-rotation, reuse-detection, tenant-namespace-of-one, fail-closed-renewal]
key-files:
  created:
    - services/auth-service/src/main/java/io/restaurantos/auth/entity/RefreshScope.java
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/084-platform-refresh-scope.xml
    - services/auth-service/src/test/java/io/restaurantos/auth/service/PlatformRefreshRotationTest.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/PlatformRefreshReuseIT.java
  modified:
    - services/auth-service/src/main/java/io/restaurantos/auth/service/AuthServiceImpl.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/RefreshSessionService.java
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/AuthController.java
    - services/auth-service/src/main/java/io/restaurantos/auth/client/PlatformCredentialClient.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/PlatformAuthService.java
    - frontend/lib/adapters/auth.adapter.ts
decisions:
  - "30-minute platform refresh TTL, not the tenant path's 7 days"
  - "single-use rotation with family revocation on reuse, as the compensating control for widening the window at all"
  - "reuse the refresh_sessions table via a scope discriminator + reserved nil-UUID tenant, rather than a parallel table with a second SECURITY DEFINER function"
  - "re-check the control plane on every rotation, because a rotating session never logs in again"
metrics:
  duration: ~2h
  completed: 2026-08-11
commits:
  - 22badb0 feat(16b-01) — the feature
  - 37e67ab fix(16b-01) — a rollback bug the live check caught
---

# Phase 16b Plan 01: Platform refresh session Summary

A SuperAdmin session now survives a reload, a deep link and a new tab, via a 30-minute single-use
rotating refresh token — a deliberately narrower bound than the 15-minutes-and-no-renewal it
replaces, not the removal of one.

---

## The problem, and that it is gone

Measured live, same command, before and after:

```
BEFORE  Set-Cookie: refresh_token=;                                            Max-Age=604800
AFTER   Set-Cookie: refresh_token=H7DdkufqoFaX0Wrt2_FC9zFi4XmcBmVuyNQ5cyIcEOw; Max-Age=1800
                                                            HttpOnly; SameSite=Strict; Path=/api/v1/auth
```

The empty value came from two places at once, and both are fixed: `platformLoginResult` returned
`new LoginResult(body, null)`, and `AuthController.login` piped that null straight into
`refreshCookie(...)` unconditionally — so "no refresh token" was rendered as *a cookie that exists
and does not work*, which is the worst of the three options. The controller now writes **no**
`Set-Cookie` for a null token. Both login paths issue a real one today, so that guard is unreachable
— it stays so the next path that forgets produces an honest absence rather than quietly recreating
this bug.

**Acceptance test, in a real browser:** sign in at `/login` as `superadmin@softxlogic.com` with no
tenant slug → reload → still signed in. `superadmin-console.spec.ts` test F, passing.

---

## The security bound, restated rather than removed

The javadoc above `platformLoginResult` said a control-plane token "lives 15 minutes and has no
renewal path, which is the only bound on a leaked SuperAdmin credential while `platform_users` still
has no second-factor column", and warned that a 30-day refresh "would quietly remove that bound".
**It has been rewritten, not left standing** — a comment asserting there is no renewal path, above
code with a renewal path, is worse than no comment because the next reader trusts it.

What the new comment says, and what the code does:

| | Tenant path (unchanged) | Platform path (new) |
|---|---|---|
| Refresh TTL | 7 days (`JWT_REFRESH_TTL_SECONDS=604800`, read from the running JVM) | **30 minutes** |
| Rotation | none — reusable for its whole life | **single-use** |
| Replay | accepted | **refused, and the whole session family revoked** |
| Renewal re-checks the control plane | n/a | **every rotation** |

The number the old comment named as unacceptable is **1,440× larger** than the one chosen. Exposure
on a leaked SuperAdmin credential goes from "15 minutes, nothing to renew with" to "30 minutes of
idle life, renewable only by a party that has not been detected racing the real operator".

**The half of the old comment that is still true is still true:** `platform_users` has no TOTP
column, `signPlatformToken` still hard-codes `totp_verified: false`, and there is still no second
factor behind a SuperAdmin password. Rotation-with-reuse-detection is the compensating control
*until TOTP for platform users lands*, and both the javadoc and `application.yml` say so at the
point where someone would be tempted to raise the number.

---

## How a tenant-less session lives in a tenant-scoped table

`refresh_sessions.tenant_id` is `NOT NULL` under `FORCE ROW LEVEL SECURITY` with
`USING (tenant_id = current_setting('app.current_tenant_id')::uuid)`. A platform user has no tenant.

**Chosen:** a `scope` discriminator column, with platform rows carrying the reserved nil UUID.

**`NULL` was rejected**, and not on taste — it breaks three things:
1. RLS reads `NULL = <uuid>` as false, so the row would be **invisible to everything, forever**;
2. `auth_lookup_refresh_tenant` would return NULL, which `bootstrapTenantGuc` treats as "invalid
   refresh session" — unredeemable by construction;
3. `verify-security-definer-owners.sh` samples an *arbitrary* `refresh_sessions` row and asserts the
   function returns non-NULL. Sampling a platform row would have turned a healthy deployment gate red.

**A separate `platform_refresh_sessions` table was rejected** because it needs its own SECURITY
DEFINER lookup function — a new function of exactly the class changeset 081's ownership guard exists
to protect, and a second copy of the trap documented there.

The payoff of the chosen shape: **changeset 084 creates, alters and reassigns no function at all.**
Changeset 052's function keeps working unmodified because the sentinel is a real, non-NULL uuid.

### That the RLS still does real work — measured as `auth_user`, not as superuser

Testcontainers runs as SUPERUSER and bypasses RLS, so no integration test can support this claim.
Run against the live `auth_db` as the real service role (`rolsuper=f`, `rolbypassrls=f`,
`current_setting('is_superuser')=off`):

```
--- A) inside a REAL TENANT context ---
 platform_rows_visible_from_tenant | 0        <- platform sessions invisible to a tenant
 tenant_rows_visible_from_tenant   | 384

--- B) inside the PLATFORM sentinel context ---
 tenant_rows_visible_from_platform   | 0      <- tenant sessions invisible to the control plane
 platform_rows_visible_from_platform | 7

--- C) with NO tenant GUC at all ---
 visible_with_no_guc | 0
```

The sentinel is not a bypass; it is a tenant namespace of exactly one that nothing else can enter
(`gen_random_uuid()` cannot produce it, no `auth_tenants` row holds it).

And the correlation is enforced by the database, not by convention — both cross-filings are refused,
as `auth_user`:

```
D) PLATFORM session filed under a real tenant     -> ERROR: violates check constraint "chk_refresh_sessions_scope"
E) TENANT session filed under the platform sentinel -> ERROR: violates check constraint "chk_refresh_sessions_scope"
```

`deploy/scripts/verify-security-definer-owners.sh` after the migration:

```
OK  auth_db: public.auth_lookup_refresh_tenant   owner=postgres, definer context resolves a real row as auth_user
OK  auth_db: public.auth_lookup_login_candidates owner=postgres, definer context resolves a real row as auth_user
```

(The script's overall exit is non-zero on a **pre-existing, unrelated** `hr_db.resolve_device`
failure — different database, different service, zero diff from this phase. Evidence in
`deferred-items.md`.)

---

## The guardrail, both directions, over real HTTP

```
── platform refresh ──
   claims: token_type=platform   tenant_id absent    roles=['SUPER_ADMIN']
   VERDICT: a platform refresh minted a PLATFORM token

── tenant refresh ──
   claims: token_type=None       tenant_id=d108c2e6-a70d-49c8-acdc-37531fd752d8
   VERDICT: a tenant refresh did NOT yield a platform token
   Set-Cookie on tenant refresh: 0   <- tenant path unchanged, still does not rotate
   second use of the same tenant token: 200  <- still reusable, as before
```

Three independent things must fail together for a cross-mint: the `scope` branch (which runs before
anything reads the session), the CHECK constraint, and RLS. Asserted in both directions by
`PlatformRefreshRotationTest`, which holds the tenant minter and asserts it was **never called** —
something an integration test cannot do, since it can only inspect the token that came out.

## Rotation and replay, over real HTTP

```
1. login                             -> 200, refresh_token=H7Ddkufq…  Max-Age=1800
2. refresh with it                   -> 200, refresh_token=htOAi15X…  (rotated: YES)
3. replay the OLD token              -> 401
   and the successor is revoked too  -> 401
```

Step 3's second line is the point: a detected replay does not merely refuse the request, it takes
down every live platform session for that user. Log line from the run:

```
WARN [platform-refresh] REUSE DETECTED for platform user eca6bbf2-… — a refresh token was presented
     after it had already been redeemed. Revoked 4 live platform session(s); the operator and any
     holder of the copied cookie must both re-authenticate.
```

Rotation is a **conditional UPDATE** (`... WHERE token_hash = ? AND revoked_at IS NULL`), not
read-then-write: two concurrent redemptions of one token would otherwise both observe it live, both
revoke it, and both mint a successor — the exact replay this refuses, passing silently under
concurrency.

---

## A defect this work introduced, and that only the live check caught

**Reuse detection revoked the family and then rolled the revocation back.**

First live run, after the feature was written and all tests were green:

```
3. replay the old token               -> 401
3b. successor after reuse detection   -> 200   <-- wrong
```

`refresh` is `@Transactional`; `AuthenticationFailedException` is a `RuntimeException`; Spring rolled
back the revocation the method had just performed. The alarm fired in the log, the request was
refused, and the copied cookie kept working — **reuse detection reduced to theatre**, which matters
more than usual here because the 30-minute TTL was justified by it.

Fixed with `noRollbackFor`, the same shape as the `PasswordChangeRequiredException` entry already
documented on `login()` and found the same way — by exercising the real thing.

**No unit test could have caught it.** `PlatformRefreshRotationTest` stayed green throughout: a mock
faithfully records a call whose effect is later undone. `PlatformRefreshReuseIT` is the regression
guard, and it was *verified to be one* — reverting `noRollbackFor` makes it fail on exactly that
assertion, restoring it makes it pass:

```
[ERROR] PlatformRefreshReuseIT.replayingASpentPlatformToken_revokesTheWholeFamily_andTheRevocationSurvivesTheRollback:77
        [a detected replay must revoke every live platform session for that user, and the revocation
         must COMMIT — the refusal is a RuntimeException out of a @Transactional method, so without
         noRollbackFor this write is undone]
```

---

## Deviations from plan

### [Rule 2 — missing critical functionality] A rotating session would have outlived deactivation

**Found during:** writing `refreshPlatform`, when it needed the platform role and the session row
did not carry it.

**Issue:** the obvious fix — store the role on the session row — has a consequence that is worse
than the problem it solves. A rotating session **never logs in again**, so `verifyCredential` (the
only thing that has ever checked `platform_users.is_active`) would never run for that operator
again. Deactivating a SuperAdmin would have stopped ending their access: they would keep rotating
indefinitely for as long as they kept clicking. That is strictly worse than the 15-minute token this
phase replaced, and it would have been the one way this work made security *worse*.

**Fix:** one narrow, read-only internal endpoint on platform-admin-service —
`GET /internal/platform/auth/users/{id}/standing` → `{renewable, role}` — called on every rotation.

**This is the one place I edited `platform-admin-service`, and it was genuinely required.** PLATFORM-07
says only that service reads `platform_db`, so auth-service cannot check `is_active` itself. The
endpoint takes an id and **no credential** (the caller has already proved possession of a live,
unspent refresh token); it mints nothing; and `renewable` is computed inside `PlatformAuthService`
from the same two conditions `verifyCredential` applies, so the policy is not re-implemented in a
second place — the drift complaint that produced phase 13.

It **fails closed**, unlike `verify`. `verify` swallows outages because it sits on the shared login
path and propagating there would take every restaurant's staff offline; nothing of the sort is true
here, since the only thing a platform refresh leads to is the console served by the very service
that would be down.

**Verified live** (with the SuperAdmin restored immediately afterwards):

```
standing (active)                     -> {"renewable":true,"role":"SUPER_ADMIN"}
UPDATE platform_users SET is_active=false
standing (deactivated)                -> {"renewable":false,"role":null}
rotate with a still-unspent token     -> 401     <- deactivation ends the session
UPDATE platform_users SET is_active=true
login                                 -> 200     <- restored
unknown platform user id              -> {"renewable":false,"role":null}
no X-Internal-Service header          -> 403
```

The role also comes back **from `platform_db` rather than from the session row**, so a demotion takes
effect at the next rotation rather than being frozen for the session's life.

### [Rule 1 — bug] The rollback defect above

Documented in full in its own section. Commit `37e67ab`.

### [Rule 3 — blocking] Stale duplicate build artifacts

`target/classes` and `target/test-classes` held ~100 space-suffixed copies (`TestFixtures 2.class`,
`AuthServiceApplication 2.class`, `… 3.class`) that broke two builds outright with errors naming a
"wrong name" class and no hint of the cause. Nothing in `src/` is affected and none are tracked.
Cleared for auth-service because it blocked verification; **not swept repo-wide** — logged in
`deferred-items.md`, since other services will hit the same wall.

---

## The frontend change, named as requested

**One file of substance:** `frontend/lib/adapters/auth.adapter.ts`. `adaptTokenSession` hard-coded
`tokenType: "access"`, with a comment reasoning that refresh was a tenant-only path "by
construction" because "a platform token has no refresh session (auth-service issues none)". That
reasoning was sound and **its premise is now false**. Left alone, a SuperAdmin who reloaded would
have rehydrated into a session labelled `access` with `tenantId: ""` — a platform user wearing a
tenant session's clothes, defeating `isPlatformSession`. It now reads `token_type` from the JWT and
normalises `""` → `null`.

Two one-line supports: `decodeJwt` exposes `tokenType` (defaulting to `"access"` when the claim is
absent, which is every tenant token), and `DecodedClaims` gains the field.

**`SessionProvider` itself needed no change** — it already called `/auth/refresh` on every load and
was simply always failing.

---

## Tests

| Suite | Result |
|---|---|
| auth-service (36 unit + 132 integration) | **168 passed**, 0 failures |
| platform-admin-service | **89 passed**, 0 failures |
| Browser — `superadmin-console` (A–F) + `unified-login` (A–E) | **14 passed** |
| `frontend` `tsc --noEmit` | 0 errors |

Unchanged-by-design paths specifically re-run: `UnifiedLoginIT` (9), `StepUpLoginIT` (5),
`ForcedPasswordChangeIT` (16), `PasswordChangeIT` (14), `RefreshLogoutIT`, `BranchSwitchIT`,
`AuthLoginIT`. Tenant login, TOTP step-up, forced-change and lockout are untouched.

**Every live claim in this document was measured with `scripts/check-stale-jars.sh` reporting
`stale=0` first.** That mattered: a `mvn verify` run repackaged both jars *underneath* the running
JVMs, the script caught it (`STALE auth-service … jar built 7m AFTER the process started`,
`STALE platform-admin-service … 15m AFTER`), and both services were restarted and every live check
re-run before anything here was written down. The broken platform-admin JVM was throwing
`NoClassDefFoundError` and hanging requests — a failure that would have read as "the new endpoint
doesn't work".

---

## 19c's pin and workaround: both deleted

- **Test F** no longer asserts the defect. It asserts the fix: sign in, reload, reload **again**
  (the second reload is deliberate — it proves the *successor* token is redeemable, which a
  single-reload test would not), then deep-link by URL.
- **`openTenant`'s click-through workaround** — its javadoc said `page.goto` "would fail, and not
  because of anything on this page" — is gone. The clicking remains as a deliberate choice (it
  exercises the tenant list's links); deep linking is asserted directly in test F.

**Not edited, on purpose:** `.planning/phases/19c-superadmin-console/deferred-items.md` item 1 still
describes this as open. It is outside this phase's file ownership. Its resolution is this document.

---

## Known stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-auth-surface | `PlatformInternalAuthController.java` | New internal endpoint `GET /internal/platform/auth/users/{id}/standing`. Read-only, mints nothing, takes no credential, gated by the existing `X-Internal-Service` constant-time check, mapped by no gateway route. Strictly less powerful than the `/verify` endpoint beside it. Verified refused (403) without the header. |
| threat_flag: widened-credential-lifetime | `AuthServiceImpl.java` | A platform session is now renewable, where it previously was not. Deliberate and bounded (30 min, single-use, family revocation, control-plane re-check on every rotation); the reasoning and its expiry condition — TOTP for `platform_users` — are on the record in the rewritten javadoc. |

## Self-Check: PASSED

All files listed in `key-files` exist on disk; both commits (`22badb0`, `37e67ab`) are present in
`git log`.
