---
phase: 16a-unified-login
plan: 01
subsystem: authentication
status: complete
tags: [auth, login, multi-tenant, account-enumeration, totp, rls, security-definer, platform-admin, playwright]
requires:
  - "13-05: POST /api/v1/platform/auth/login and PlatformAuthService (the endpoint that had no UI)"
  - "13-01: PlatformTokenService + /internal/auth/platform-token in auth-service"
  - "13-08: POST /api/v1/auth/change-password/forced (public at the gateway)"
  - "058: per-tenant case-insensitive email uniqueness — cross-tenant reuse stays legal"
  - "052 + deploy/scripts/verify-security-definer-owners.sh: the SECURITY DEFINER ownership pattern"
  - "running dev stack (postgres, redis, rabbitmq, eureka, gateway, auth, platform-admin, frontend)"
provides:
  - "POST /api/v1/auth/login accepts email + password with NO tenantSlug — one endpoint for everyone"
  - "LoginIdentityResolver — verifies the credential, THEN resolves where it authenticated"
  - "auth_lookup_login_candidates(TEXT) — the cross-tenant candidate lookup (changeset 081)"
  - "PlatformCredentialClient + POST /internal/platform/auth/verify — the control-plane half"
  - "PlatformAuthService.verifyCredential — extracted so both platform login paths share one check"
  - "409 TENANT_SELECTION_REQUIRED — the chooser, listing only tenants the password matched"
  - "LoginResponse.tokenType (access|platform) + nullable tenantId/branchId"
  - "one login form: email-first, TOTP step-up, chooser, platform routing"
  - "/login/change-password — the forced-change screen that had never existed"
  - "UserRepository.findByTenantAndEmail — the login lookup no longer relies on RLS alone"
  - "deploy/init/06-auth-login-candidates-owner.sql + a verifier entry for the new function"
affects:
  - "frontend/proxy.ts no longer rewrites /login — NEXT_PUBLIC_DEFAULT_TENANT_SLUG is inert on the login path"
  - "Session.tenantId/branchId are nullable; Session gains tokenType"
  - "auth-service now makes one outbound call (to platform-admin-service) on tenant-less logins"
  - "auth-service integration tests: the whole module's ITs were erroring and now run"
tech-stack:
  added: []
  patterns:
    - "verify-then-resolve: no account fact is disclosed before a bcrypt comparison succeeds"
    - "resolve-then-delegate: the unified path re-enters the ordinary login rather than reimplementing it"
    - "constant refusal across services: {matched:false} at HTTP 200 on the internal seam"
    - "SECURITY DEFINER function + post-migration ownership verification (extends 052's pattern)"
key-files:
  created:
    - services/auth-service/src/main/java/io/restaurantos/auth/service/LoginIdentityResolver.java
    - services/auth-service/src/main/java/io/restaurantos/auth/client/PlatformCredentialClient.java
    - services/auth-service/src/main/java/io/restaurantos/auth/exception/TenantSelectionRequiredException.java
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/081-login-candidate-lookup.xml
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/UnifiedLoginIT.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/PlatformInternalAuthController.java
    - deploy/init/06-auth-login-candidates-owner.sql
    - frontend/app/(auth)/login/change-password/page.tsx
    - frontend/components/auth/forced-password-change-form.tsx
    - frontend/lib/hooks/auth/use-forced-password-change.ts
    - frontend/e2e/journeys/unified-login.spec.ts
  modified:
    - services/auth-service/src/main/java/io/restaurantos/auth/service/AuthServiceImpl.java
    - services/auth-service/src/main/java/io/restaurantos/auth/repository/UserRepository.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/request/LoginRequest.java
    - services/auth-service/src/main/java/io/restaurantos/auth/dto/response/LoginResponse.java
    - services/auth-service/src/main/java/io/restaurantos/auth/exception/AuthExceptionHandler.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/LoginEventPublisher.java
    - services/auth-service/src/main/resources/application.yml
    - services/auth-service/src/test/resources/application.yml
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/PlatformAuthService.java
    - deploy/scripts/verify-security-definer-owners.sh
    - frontend/proxy.ts
    - frontend/components/auth/login-form.tsx
    - frontend/lib/models/auth.model.ts
    - frontend/lib/adapters/auth.adapter.ts
    - frontend/lib/api-client/schemas/auth.schema.ts
    - frontend/lib/errors/api-error.ts
    - frontend/lib/repositories/session.repository.ts
    - frontend/lib/hooks/auth/use-current-user.ts
    - frontend/mocks/handlers.ts
decisions: [D-1, D-2, D-3, D-4, D-5, D-6, D-7, D-8, D-9, D-10, D-11]
metrics:
  duration: "~2h"
  completed: 2026-08-07
  tasks: 1
  backend_tests: "auth-service 166/166, platform-admin-service 78/78"
  frontend_tests: "571/571 vitest, 32/32 playwright journeys"
---

# Phase 16a Plan 01: Unified Email-First Login — Summary

**One line:** `POST /api/v1/auth/login` now takes an email and a password and nothing else — the
server verifies the credential first and only then works out whether it belongs to a tenant user or
to the SuperAdmin — so there is one login form, no tenant field, and the SuperAdmin can sign in
through a browser for the first time.

## 1. What you asked for, and what it does now

| | Before | Now |
|---|---|---|
| `localhost:3000` | 307 → `/login?tenant=test` (a slug that does not exist) | 307 → `/login` |
| Login form | Email + password + **required** restaurant slug | Email + password |
| SuperAdmin in a browser | **impossible** — no route existed | same form, lands on `/platform/dashboard` |
| `manager@terrace.local` | had to know `floating-terrace` | types nothing but email + password |
| `owner@terrace.local` (TOTP) | had to know the slug, then the code | asked for the code only when the server asks, password preserved |
| Email used in two tenants | not expressible | chooser listing only where the password matched |
| Wrong password vs unknown email | identical | identical, and now asserted |

Both of your complaints were correct, and the second one was the deeper defect. The redirect was the
symptom; the requirement that a human name their own tenancy was the design error.

## 2. The design, and the one rule it is built around

> **Resolution happens after password verification, never before.**

`LoginIdentityResolver` gathers every account that could hold the address (an internal lookup that
never reaches a response), bcrypt-compares the password against each, and only then decides what to
name. `Resolution.matches()` contains **only** tenants where the comparison succeeded. A tenant that
holds the address under a different password is absent from the chooser and is indistinguishable
from one that never heard of the address.

Flow:
1. Email + password, no tenant.
2. auth-service checks tenant candidates locally and asks platform-admin-service about the control
   plane (PLATFORM-07 — only that service may read `platform_db`).
3. **Exactly one match** → issue that token and route accordingly (`platform` → `/platform/…`,
   otherwise `/app/…`, decided from `tokenType` in the response, not from the form).
4. **More than one** → `409 TENANT_SELECTION_REQUIRED` listing only the matches.
5. **None** → the same generic `401 UNAUTHENTICATED / "Invalid credentials"` as before.

`?tenant=` and subdomain resolution still work as **hints** that skip resolution. They prefill a
clearable field; nothing rewrites the URL. `TenantResolutionSupport` in the gateway is untouched.

**The unified path does not reimplement the login.** It resolves a slug and re-enters the original
`loginToTenant`, which is unchanged apart from its name — so deactivation refusal, forced-change
gate, TOTP step-up, lockout accounting, refresh session and login events are the same code, not a
copy. Cost: the winning candidate's password is hashed twice (~500ms vs ~250ms). Deliberate; the
alternative is a "already verified" flag threaded into the login, which is how a bypass gets built.

## 3. Live end-to-end proof

All against the running stack through the gateway on :8080 and the browser on :3000.

**Gateway, real credentials:**

```
POST /api/v1/auth/login {"email":"manager@terrace.local","password":"Terrace#Manager1"}
  → 200, tenant_id=d108c2e6…, branch_id=34cd6f62…, roles=[MANAGER]

POST /api/v1/auth/login {"email":"superadmin@softxlogic.com","password":"Test@123!"}
  → 200 {"userId":"eca6bbf2-ce62-5d16-8f4c-d052521d16ad",
         "tenantId":null,"branchId":null,"tokenType":"platform","expiresInSeconds":900}

POST /api/v1/auth/login {"email":"owner@terrace.local","password":"Terrace#Owner1"}
  → 401 {"code":"TOTP_REQUIRED"}
POST … + "totpCode":"947183"   (python3 scripts/generate_totp.py owner@terrace.local)
  → 200
```

**The enumeration guardrail, three inputs, one answer:**

```
unknown address            → 401 {"error":{"code":"UNAUTHENTICATED","message":"Invalid credentials","details":[],"traceId":"unknown"}}
real address, wrong pw     → 401 {"error":{"code":"UNAUTHENTICATED","message":"Invalid credentials","details":[],"traceId":"unknown"}}
superadmin, wrong pw       → 401 {"error":{"code":"UNAUTHENTICATED","message":"Invalid credentials","details":[],"traceId":"unknown"}}
```

Byte-identical bodies, identical status, no tenant named anywhere. Timing, 3 samples each through
the gateway:

```
unknown address : 0.469s 0.472s 0.472s
wrong password  : 0.476s 0.479s 0.485s
```

~7ms apart on ~470ms — far below the ~250ms a bcrypt costs, which is what the dummy-hash padding
exists to hide.

**Browser (Playwright, `frontend/e2e/journeys/unified-login.spec.ts`), real Chrome against the real
stack — 5/5:**

```
✓ A · /login is not rewritten to a default tenant, and asks for no restaurant
✓ B · the SuperAdmin signs in from that same form and reaches the platform console
✓ C · a tenant manager signs in with no tenant and reaches the tenant app
✓ D · a step-up account is challenged for TOTP and completes, without retyping its password
✓ E · an unknown address and a wrong password are indistinguishable
```

**No regression in the existing harness — 32/32** (`persona-access-matrix` all 18 personas,
`step-up-totp` all 4 cases including the suite's own `uiLoginWithTotp` helper, plus the 5 above).

## 4. Guardrails, each one asserted rather than asserted-to

| Requirement | Where it is held | Where it is proven |
|---|---|---|
| No account-enumeration oracle | `LoginIdentityResolver` — matches populated only after a successful compare | `UnifiedLoginIT.unknownEmailAndWrongPassword_areByteForByteIdentical`, `…namesNeither`, journey E, live curl above |
| TOTP step-up not weakened | unified path delegates to `loginToTenant`; `enforceTotpStepUp` untouched | `StepUpLoginIT` (5), `step-up-totp.spec.ts` (4), journey D, live curl |
| Rate limit at least as strict | reuses `auth-route` (replenish 2/s, burst 100, per IP) — no new route, no new bucket | unchanged gateway config; chooser costs 2 requests, asserted in `login-form.test.tsx` |
| Failed attempt logged, password never | `LoginEventPublisher.logUnifiedRefusal(email, ip)` | method takes no password parameter; per-candidate failures still publish `USER_LOGIN_FAILED` |
| Nothing added to `PUBLIC_PATHS` | the endpoint is `/api/v1/auth/login`, public since Phase 3 | `JwtGlobalFilter` untouched in this plan |
| `TENANT_OPTIONAL_PATHS` not widened | still the single `/api/v1/platform` entry | `JwtGlobalFilter` untouched in this plan |
| Brute force via the slug-less path | every failed candidate takes `handleFailedPassword` | `UnifiedLoginIT.failedUnifiedAttempts_incrementTheSameLockoutCounterAsASlugBearingOne` |
| Existing callers unaffected | a named tenant takes the original path byte for byte | `UnifiedLoginIT.slugBearingLoginIsUnchanged`, `AuthLoginIT`, all 17 seeded principals |

## 5. Four defects found while doing this — all pre-existing, all reported with evidence

### 5.1 The forced-password-change screen did not exist (fixed here)

13-08 built `POST /api/v1/auth/change-password/forced` and made it public; 13-06 and 13-11 set
`must_change_password` on every provisioned and every created account. So every newly provisioned
user — **including the first admin of every new tenant** — hit a `403 PASSWORD_CHANGE_REQUIRED` that
the browser had no screen for. `grep -rn "PASSWORD_CHANGE_REQUIRED" frontend/` returned nothing. They
could not sign in and nothing told them why.

`/login/change-password` now exists and the 403 routes to it carrying the single-use token. It sends
the user back to `/login` afterwards rather than into the app, because that endpoint issues no token
and pretending otherwise would fabricate a session.

### 5.2 Every auth-service integration test was erroring (fixed here)

`AuthLoginIT` and the rest failed at context startup with
`Could not resolve placeholder 'spring.application.name'`. Cause:
`services/auth-service/src/test/resources/application.yml` **shadows** the main one (Spring Boot
takes the first `application.yml` on the classpath and `target/test-classes` precedes
`target/classes`), so the name set for production was invisible to tests — while
`SharedAutoConfiguration.domainEventPublisher` binds it with no default since 15-01 (7081429).

Identified as pre-existing by running `AuthLoginIT`, which this plan does not touch, and seeing the
identical failure. One line added to the test resource. **auth-service now runs 166/166.**

### 5.3 The login lookup rested entirely on RLS, and 500s if that control is absent (fixed here)

`UserRepository.findByEmail` returns an `Optional` over a table where the address is unique only
*per tenant*, and carried no tenant predicate — correct only for as long as the RLS policy is the
thing narrowing the result. Under Testcontainers' superuser the policy is inert, so a cross-tenant
duplicate made the **ordinary slug-bearing login** answer `HTTP 500` (`NonUniqueResultException`).

Not a live defect (the production role is `NOSUPERUSER NOBYPASSRLS`), but the correctness of login
rested on a control no test in the repository can exercise. Added `findByTenantAndEmail` — the same
two-independent-controls shape `findPageForTenant` and `findByIdForTenant` already document — and
used it at both login call sites. The other two callers are logged as **W-16a-03**.

### 5.4 pos-service and inventory-service wedge permanently when platform-admin-service blips (NOT fixed — reported)

**Triggered by my restarting platform-admin-service to deploy this change.** After it, 23 existing
journeys failed on `503 SERVICE_UNAVAILABLE` from `/api/v1/pos/**`, while pos-service reported
`{"status":"UP"}` on `/actuator/health` and business endpoints hung until curl timed out.

A thread dump of pos-service (pid 27635) shows the mechanism exactly:

```
"http-nio-8084-exec-109"  TIMED_WAITING
  at org.apache.hc.core5.concurrent.BasicFuture.get(BasicFuture.java:120)
  at org.apache.hc.core5.pool.StrictConnPool$1.get(StrictConnPool.java:183)
  …
  at io.restaurantos.shared.feature.PlatformAdminFeatureResolver.enabledFeatures(…:38)
  at io.restaurantos.shared.feature.RedisFeatureFlagService.isEnabled(…:59)
  at io.restaurantos.shared.feature.FeatureFlagAspect.checkFeature(…:21)
  at io.restaurantos.pos.web.OrderController$$SpringCGLIB$$0.listOrders(<generated>)
```

**39 Tomcat workers** parked waiting for a connection from an exhausted pool, all on the feature-flag
call to platform-admin-service, which has no timeout. A momentary peer outage exhausts the pool and
the service never recovers — health stays green, so nothing restarts it. Measured across the stack:
pos 21 wedged threads, inventory 4, everything else 0.

This is the *same* defect the concurrent shared-lib workstream is fixing on the OPA path
(`SharedAutoConfiguration.OPA_TIMEOUT`, "a hung OPA is the case with no exception to catch"), on a
second unbounded client that fix does not cover. **Not fixed here** — pos-service and shared-lib are
concurrent territory. Recovered the environment by restarting the two wedged services, after which
all 32 journeys pass. Logged as **W-16a-02**.

### 5.5 The new SECURITY DEFINER function was silently inert (found by deploying, fixed here)

Changeset 081 creates `auth_lookup_login_candidates` as `SECURITY DEFINER` so it can read across
tenants. Liquibase runs as `auth_user`, `users` is `FORCE ROW LEVEL SECURITY`, and **FORCE binds the
owner too** — so the function returned zero rows and every email-first login was refused with the
(correctly generic) "Invalid credentials". No error, no symptom to read.

Measured on the live database, same body, owner the only difference:

```
owned by auth_user -> 0 rows
owned by postgres  -> 1 row
```

Registered in both places the repo already keeps this: `deploy/init/06-auth-login-candidates-owner.sql`
for a from-scratch provision, and `deploy/scripts/verify-security-definer-owners.sh` which runs after
migrations and asserts behaviour, not ownership. Its output on the live database:

```
FIX   auth_db: public.auth_lookup_login_candidates owned by 'auth_user' -> postgres
OK    auth_db: public.auth_lookup_login_candidates owner=postgres, definer context resolves a real row as auth_user
checked=4 repaired=1 failed=0
```

`auth_lookup_refresh_tenant` (052) has the identical shape and works only because something once
created it on a `postgres` connection — the trap that verifier was written for, sprung again.

## 6. `frontend/.env.local` — no change needed

`NEXT_PUBLIC_DEFAULT_TENANT_SLUG=test` was read **only** by the redirect in `proxy.ts`, which this
plan removed. Nothing on the login path reads it now, so the stale value is inert and
**you do not need to edit `frontend/.env.local` for login to work.**

The one place it still matters is unrelated to login: `frontend/lib/hooks/use-tenant-brand.ts:19`
uses it to brand the app shell, so the shell currently shows "RestaurantOS" (the `test` lookup 404s
and falls back). If you want the shell branded, that hook needs to read the *signed-in* tenant rather
than an env var — which is the real fix, since one env var cannot be right for a multi-tenant
product. Logged as **W-16a-01**. If you would rather silence it in the meantime, change that line to
a live slug such as `floating-terrace`; nothing about login depends on it either way.

## 7. Deviations from plan

- **[Rule 2 — missing critical functionality] Built the forced-password-change screen.** The brief
  required routing the 403 to it; it did not exist, so the route had nowhere to go. §5.1.
- **[Rule 3 — blocking] Fixed `spring.application.name` in the auth-service test resource.** Without
  it no integration test in the module could start, so the guardrail could not be asserted. §5.2.
- **[Rule 1 — bug] Added `UserRepository.findByTenantAndEmail`.** A cross-tenant duplicate — which
  this plan makes reachable — 500'd the ordinary login. §5.3.
- **[Rule 3 — blocking] Ownership fixup for changeset 081.** The feature was silently non-functional
  without it. §5.5.
- **[Rule 1 — bug, self-inflicted, caught by the browser run] Renamed the advanced disclosure link.**
  It read "Sign in to a specific restaurant", which made `getByRole("button", {name: "Sign in"})` —
  used by `e2e/fixtures/auth.fixture.ts` for every persona login in the suite — ambiguous, breaking
  journeys unrelated to this control. Now "Use a restaurant identifier instead".
- **`PlatformCredentialClient` builds its own `RestClient`** rather than injecting a
  `RestClient.Builder`: auth-service has no such bean and the first draft made the entire application
  context fail to start. Caught by `UnifiedLoginIT` before it could reach a running service.
- **Not fixed, reported:** §5.4 (concurrent territory), W-16a-01/03/04/05.

## 8. Tests

**Backend — `services/auth-service` 166/166, `services/platform-admin-service` 78/78.**

`UnifiedLoginIT` (9 new), in order of what they defend:
- `unknownEmailAndWrongPassword_areByteForByteIdentical` — status, code, message and the *absence*
  of `details` compared field by field. "Both are 401" is also what a leak in the body looks like.
- `wrongPasswordAgainstAnAddressHeldInTwoTenants_namesNeither` — the enumeration guard restated as
  the property it must hold, against a real duplicate.
- `matchingInTwoTenants_returnsAChooserNamingOnlyTheMatches` — 409, exactly the two slugs, no token
  and no `Set-Cookie`.
- `oneMatchingTenant_logsInWithNoSlugAndIssuesTheSameSessionAsTheSlugBearingPath` — the refresh
  cookie is the proof it really re-entered the ordinary login rather than minting its own token.
- `choosingFromTheChooser_completesTheLogin`, `blankSlugIsTreatedAsAbsent`,
  `slugBearingLoginIsUnchanged`, `failedUnifiedAttempts_incrementTheSameLockoutCounterAsASlugBearingOne`,
  `platformServiceUnreachable_stillLogsTenantUsersIn`.

Three of these failed first with "expected 200" while each passed in isolation — shared lockout
counters and a leftover duplicate row from earlier cases. Fixed by resetting both in `@BeforeEach`
so the outcome is a property of the test and not of JUnit's method order.

**Frontend — 571/571 vitest** (5 new in `login-form.test.tsx`: submits with no `tenantSlug` key at
all; platform token routes to `/platform/dashboard`; chooser renders and completes in exactly two
requests; 403 routes to the forced-change screen carrying the token; a hint prefills and is
clearable), **32/32 Playwright journeys**, `tsc --noEmit` clean, `eslint` 0 errors,
`prettier --check` clean on every file this plan touches.

The chooser has no browser journey because no cross-tenant duplicate address exists in the dev
database; it is covered by an integration test against a real duplicate and by a unit test against
the real 409 shape.

## 9. Self-Check: PASSED

Files created — all present:
`LoginIdentityResolver.java`, `PlatformCredentialClient.java`, `TenantSelectionRequiredException.java`,
`081-login-candidate-lookup.xml`, `UnifiedLoginIT.java`, `PlatformInternalAuthController.java`,
`06-auth-login-candidates-owner.sql`, `login/change-password/page.tsx`,
`forced-password-change-form.tsx`, `use-forced-password-change.ts`, `unified-login.spec.ts`.

Claims re-verified after the final edit: gateway logins for manager / superadmin / owner+TOTP,
identical refusals, 166/166 + 78/78 backend, 571/571 vitest, 32/32 Playwright.
