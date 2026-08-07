# Phase 16a: Unified Email-First Login — Context

**Gathered:** 2026-08-07
**Status:** Executed (16a-01)
**Source:** user report + live verification against the running dev stack
**Branch:** `phase-13-access-repair`

<domain>
## Phase Boundary

The user's report, verbatim:

> "I'm not able to login as superadmin — when I open localhost:3000 it redirects to
> `/login?tenant=test`. The login route should be the same for everyone, and why does any user need
> to mention tenancy when they're already using their email and password?"

Both halves are correct, and the second is the more important one. Measured before this phase:

```
GET  http://localhost:3000/           →  307  →  /login?tenant=test
GET  /api/v1/auth/tenants/test        →  404   (the slug names no tenant)
POST /api/v1/auth/login {no tenantSlug}
                                      →  400 VALIDATION_FAILED "tenantSlug must not be blank"
frontend/app/(platform)/**            →  a dashboard placeholder and no route that can reach it
grep -r "platform/auth/login" frontend/  →  (no matches)
```

Three independent defects, each sufficient on its own to produce the symptom:

1. **`frontend/proxy.ts:35-43`** rewrote every bare `/login` to carry
   `NEXT_PUBLIC_DEFAULT_TENANT_SLUG`, and `frontend/.env.local` pinned that to `test` — a slug that
   no longer exists. A dev convenience became a hard redirect nobody could escape, because deleting
   the query string simply got it back.
2. **`frontend/components/auth/login-form.tsx:68-70`** *required* a tenant slug and refused to
   submit without one, so the human had to supply an identifier the product never gave them.
3. **There was no SuperAdmin path in the UI at all.** Plan 13-05 built
   `POST /api/v1/platform/auth/login` and proved it working (`scripts/e2e/phase13-superadmin-e2e.sh`,
   21/0), and the frontend never got a route to it. The SuperAdmin literally could not log in
   through a browser.

**In scope:** one login form taking email + password with no tenant; server-side resolution of
where that credential authenticated; the platform (control-plane) path through the same form and
endpoint; the multi-tenant chooser; the TOTP step-up on that path; removal of the forced redirect;
and the forced-password-change screen the 403 had always pointed at and which had never existed.

**Out of scope (deliberately):**
- The platform console itself. `/platform/dashboard` is still the 13-05 placeholder; this phase
  makes it *reachable*, it does not build it.
- Platform MFA. `platform_users` has no TOTP column (a named, accepted gap since 13-CONTEXT).
- The app-shell brand (`useTenantBrand`), which reads the same stale env var — see Deferred.
- Anything in the gateway. **No path was added to `PUBLIC_PATHS` and `TENANT_OPTIONAL_PATHS` was
  not widened**; see D-2.
</domain>

<decisions>
## Implementation Decisions

### D-1 (LOCKED) — Resolution happens AFTER password verification, never before

This is the decision the whole phase is built around, and every other one is downstream of it.

The obvious way to build a unified login is to look up which tenants hold an address, present them,
then ask for the password. That is an **account-enumeration oracle with a form around it**: anyone
can type an address and learn whether it exists and where, with no credential at all. For a
multi-tenant restaurant platform "which groups does this person work for" is itself the disclosure.

So the order is inverted and is not negotiable:

1. gather candidates — an internal lookup that never reaches a response;
2. bcrypt-compare the submitted password against each candidate;
3. only then decide what, if anything, to name.

`LoginIdentityResolver.Resolution.matches()` therefore contains **only tenants whose stored hash the
password actually matched**. A tenant that holds the address under a different password is absent,
and from outside is indistinguishable from one that never heard of the address.

Every path also performs at least one cost-12 bcrypt comparison — against a real hash where a
candidate exists, against the shared `DUMMY_HASH` where none does — so "no account anywhere" does
not return in microseconds while "wrong password" costs ~250ms. **Measured through the gateway:**
unknown address 0.469/0.472/0.472s, known address + wrong password 0.476/0.479/0.485s.

Residual, stated rather than left to be found: wall time still correlates weakly with *how many*
tenants hold an address (N comparisons). Closing that completely means padding every login to a
fixed candidate count, which multiplies the cost of every honest login and hands an unauthenticated
endpoint a fixed expensive workload to demand. It is bounded instead — `MAX_CANDIDATES = 8` — and
what leaks is a small integer, never an identity.

### D-2 (LOCKED) — The unified endpoint is `POST /api/v1/auth/login`, not a new path

`tenantSlug` became optional on the endpoint that already exists.

The alternative — a new `/api/v1/auth/login/unified` — would have needed a `PUBLIC_PATHS` entry, a
new gateway route, and its own rate-limit bucket, and would have left two credential endpoints to
keep in agreement. The brief forbids the first and the phase-13 audit is a catalogue of what the
last one costs.

Consequences, all of them wanted:
- **nothing added to `PUBLIC_PATHS`** — the path has been public since Phase 3;
- **the existing `auth-route` rate limit applies unchanged** (replenish 2/s, burst 100, per IP) —
  the same bucket as before and at least as strict as `platform-auth-route`;
- **every existing caller is unaffected.** A request naming a tenant takes the byte-for-byte path it
  always took; the unified branch is reached only when no tenant was named.

### D-3 (LOCKED) — Resolve, then re-enter the ordinary tenant login. Do not reimplement it

Everything that makes a tenant login correct happens *after* the password check: the deactivation
refusal, the forced-change gate, the TOTP step-up, the failed-count reset, the refresh session, the
login-succeeded event. A unified path that duplicated any of it would be a second credential path,
and "two credential paths that agreed on day one and drifted after" is the recurring finding of the
audit that produced phase 13.

So `unifiedLogin` does exactly one thing — turn "no slug" into "this slug" — and calls
`loginToTenant`, which is the original method under a new name and otherwise untouched.

**The cost, stated:** the winning candidate's password is bcrypt-compared twice, so a unified login
takes ~500ms rather than ~250ms. That is the price of one credential path instead of two, and it is
the right trade — the alternative is a "trust me, it was already checked" flag threaded into the
login, which is how an authentication bypass gets built one refactor later.

### D-4 (LOCKED) — Platform credentials are verified by platform-admin-service, minted by auth-service

PLATFORM-07: only platform-admin-service connects to `platform_db`. auth-service cannot read
`platform_users`, so it asks over a new internal endpoint
`POST /internal/platform/auth/verify`, guarded by the existing `X-Internal-Service` constant-time
check and mapped by no gateway route.

That endpoint returns an **identity, not a credential**. auth-service already holds the RSA private
key and already mints control-plane tokens (`PlatformTokenService`), so having the verifier mint one
would send the login on a third hop back to the service that asked. Same split 13-05 drew, same
reason.

`PlatformAuthService.verifyCredential` was **extracted from** `login`, not copied: both the public
platform login and the unified login run the identical lockout window, dummy-hash comparison, active
check and mintable-role check.

Every refusal — unknown address, wrong password, deactivated, non-mintable role, lockout — returns
the single constant `{matched:false}` at **HTTP 200**. Not a 401: a status that differed between
"no such platform user" and "wrong password" would hand auth-service a distinction it would then have
to remember not to forward, and the only reliable way not to forward a distinction is not to receive
one.

### D-5 (LOCKED) — A control-plane outage must not take every restaurant's staff offline

`PlatformCredentialClient.verify` never throws. Connection refused, read timeout, 5xx, a rotated
secret and a malformed body all become `NO_MATCH` plus a WARN, and the tenant half of the login
proceeds.

Failing the whole login instead would convert a control-plane incident into a total one. The cost is
that a SuperAdmin cannot sign in during such an outage — which is already true, since the console
they would sign in to *is* the service that is down. It also never turns an outage into a refusal
that names a reason, so the form cannot be used to probe the control plane's health.

Timeouts are explicit (2s connect, 5s read) because a login is a synchronous user-facing request:
an unbounded client turns one dead peer into thread-pool exhaustion in this one. **That exact
failure was then observed elsewhere in the stack during verification — see the summary's findings.**

### D-6 (LOCKED) — The chooser is a 409 on the error channel, and lists only what matched

Cross-tenant email reuse is legal and stays legal (changeset 058 kept it deliberately: one human may
work for two restaurant groups under one inbox). When the password verifies in more than one place
the server cannot choose, so it asks.

`409 TENANT_SELECTION_REQUIRED`, with one `details` entry per option — `field` = the slug to echo
back, `issue` = the display name. **Not a 200:** nothing was issued, and a success-shaped body
containing no session is exactly what a client eventually mistakes for one. Same reasoning that
keeps `PASSWORD_CHANGE_REQUIRED` off `LoginResponse`.

Picking an option re-submits the same credential with that slug and **re-verifies it in full**.
There is no selection token and no server-side pending-login state, so nothing can be replayed into
a session the credential did not earn. Two requests total — comfortably inside the 2/s bucket, and
no speculative logins.

The platform option rides the same chooser under the reserved slug `@platform`, which cannot collide
with an `auth_tenants.slug`.

### D-7 (LOCKED) — `?tenant=` and the subdomain stay as HINTS. Nothing rewrites the URL

The forced redirect is gone. `?tenant=` and the subdomain still resolve (`TenantResolutionSupport`
in the gateway is untouched) and now **prefill a visible, clearable field** instead of being imposed.

A hint that rewrites the URL is not a hint — a user who deletes the query string is handed it back.
The restaurant field is otherwise an advanced disclosure behind "Use a restaurant identifier
instead", not a step in the normal flow.

`NEXT_PUBLIC_DEFAULT_TENANT_SLUG` is now read by nothing on the login path. **The user does not need
to change `frontend/.env.local` for login to work.**

### D-8 (LOCKED) — `LoginResponse.tenantId` / `branchId` become nullable, with `tokenType` as the discriminator

A platform user belongs to no tenant — that is the point of `platform_users`, and the reason
`TENANT_OPTIONAL_PATHS` exists. Inventing a tenant id for them would put a lie in the response and
make "which console do I open?" unanswerable from the body.

`tokenType` carries the same string the JWT carries in its `token_type` claim (`platform` /
`access`), populated from the mint rather than assembled separately, so a client can route without
decoding the token and the two cannot disagree. It is **required** in the Zod schema: accepting its
absence would only let a real contract regression through the parse silently.

### D-9 (LOCKED) — Omitting the slug must not be a brute-force bypass

The tenant login locks an account at five failures. A unified path that resolved without touching
`failed_login_count` would mean an attacker simply stops sending a slug and guesses forever.

Every candidate whose comparison fails takes the accounting `AuthServiceImpl.handleFailedPassword`
applies, through that same method, and publishes the same failed-login event.

Uncomfortable consequence, recorded rather than hidden: one unified attempt against an address held
in three tenants costs one failure in each — correct, since the attempt really was against all
three, but it means a persistent attacker can lock accounts they cannot enter. That was already true
of the slug-bearing endpoint one tenant at a time; the gateway rate limit is the brake on doing it
at scale.

A lock is reported (`423`) **only when the password matched** a locked account. Someone who does not
know the password gets the generic refusal, so a lock cannot be used to discover that an address
exists. Same rule `refuseDeactivatedAccount` already follows.

### D-10 (LOCKED) — The failed unified attempt is logged for audit, without the password

`LoginEventPublisher.logUnifiedRefusal(email, ip)` — a distinct line from `logUnknownTenant`, because
nobody typed a tenant and reusing that line would have printed `slug=null` on every failed email-first
attempt and taught whoever greps the logs that "unknown tenant" means nothing.

No AMQP event: `publishFailed` carries a `tenantId` and lands in a tenant's own trail, and a
credential that matched no tenant has no trail to belong to. Attributing it to one would put a
fabricated tenant id in the audit record. Per-candidate failures that *did* touch a real account are
published individually, where the tenant is known.

The password is not a parameter of that method and must never become one.

### D-11 (RESOLVED mid-execution) — The cross-tenant lookup needs a definer context, and fails silently without one

`users` is `FORCE ROW LEVEL SECURITY` and `auth_user` is `NOSUPERUSER NOBYPASSRLS`, so without a
tenant GUC the table reads as empty — and there is no single tenant to set it to, which is the whole
problem. Changeset 081 adds a narrow `SECURITY DEFINER` function, the same shape changeset 052 uses
for the refresh-token lookup, rather than standing the policy down for every other query.

**FORCE binds the function's owner too.** Liquibase runs as `auth_user`, so the function is created
owned by `auth_user` and returns **zero rows** — no error. Measured on the live database, same body,
owner the only difference: `auth_user` → 0 rows, `postgres` → 1 row. The ownership fixup is therefore
part of this phase in both of the places the repo already uses for it
(`deploy/init/06-*.sql` and `deploy/scripts/verify-security-definer-owners.sh`, which runs *after*
migrations and asserts behaviour rather than ownership).

Found by deploying and watching a correct password get a 401, not by review.
</decisions>

<open-questions>
## Deferred, with owners

- **W-16a-01 — the app-shell brand reads the same stale env var.** `lib/hooks/use-tenant-brand.ts`
  resolves the shell's brand from `NEXT_PUBLIC_DEFAULT_TENANT_SLUG`, so it shows *one* tenant's name
  regardless of who is signed in, and today falls back to "RestaurantOS" because `test` 404s. Wrong
  in a multi-tenant product independently of this phase. Owner: design-system workstream.
- **W-16a-02 — pos-service and inventory-service wedge permanently when platform-admin-service
  blips.** Diagnosed live during verification with a thread dump; see the summary. Owner: the
  concurrent shared-lib timeout workstream, which is fixing the identical defect on the OPA path.
- **W-16a-03 — `UserRepository.findByEmail` still has no tenant predicate** at its two remaining
  callers (`ProvisioningAdminService`, `PasswordResetService`). The two login callers were fixed;
  these two are the same latent shape. Owner: next access-repair pass.
- **W-16a-04 — platform sessions do not survive a reload.** A control-plane token has no refresh
  credential by design (D-4/13-05), so `/platform/**` after F5 has no token. Harmless while the
  console is a placeholder; blocking the moment it holds real pages. Owner: whoever builds the
  console.
- **W-16a-05 — platform MFA.** `platform_users` has no TOTP column, so the SuperAdmin has no second
  factor. Pre-existing and named in 13-CONTEXT; the unified form changes nothing about it.
</open-questions>
