# Browser end-to-end test harness for RestaurantOS

**Status:** scaffolded, installed, and running green against the live dev stack.
**Date:** 2026-08-07. **Branch:** `phase-13-access-repair`.
**Author's discipline note:** every claim about this repo below is followed by the file I read
or the command I ran. Where I could not verify something, it says so in bold.

---

## 0. TL;DR

| | |
|---|---|
| Tool | **Playwright** — already a devDependency, already wired into CI, already used by 15 specs |
| Version | `@playwright/test@1.61.1` (installed, unchanged — no new package was added) |
| What I built | 4 fixture modules, 1 setup project, 3 journey specs, a restructured `playwright.config.ts` |
| What I ran | `pnpm e2e` → **1 passed**. `pnpm e2e:journeys` → **30 passed (22.2s)**, three consecutive clean runs |
| Journeys automatable today | **4 of the 8** requested. Four have no UI to drive — see §5 |
| Blocking dependency | `scripts/README-seed.md` **does not exist** (§6.1) |
| Defects the harness found | **6**, four of them product bugs (§8) |

---

## 1. Recommendation: Playwright, and it is not a close call

### 1.1 It is already here

`frontend/package.json` already carries `"@playwright/test": "^1.61.1"` in `devDependencies`
and `"e2e": "playwright test"` in `scripts`. `frontend/playwright.config.ts` has existed since
Phase 4 (its header says "D6/W1 scaffold"). `.github/workflows/ci.yml:357-385` already has an
`e2e` job that installs the chromium browser and runs it. `frontend/e2e/` already holds **15
live-stack specs** (`pos-settlement.spec.ts` alone is 33KB). `.playwright-mcp/` holds 183
artifacts from earlier Playwright-MCP driving sessions.

Choosing Cypress would mean deleting all of that. So the real question is not "which tool" but
"why is the Playwright that is already here not producing value" — answered in §2.

### 1.2 Why it fits *this* stack specifically

Five properties of RestaurantOS make Playwright the right fit, and three of them Cypress
cannot do at all:

**(a) The suite must hold many identities at once.** There are 18 tenant personas plus a
SuperAdmin (`scripts/seed_restaurantos.py:188-202`, three tenants × six roles). Playwright's
`browser.newContext({ storageState })` gives one test several fully isolated signed-in
browsers simultaneously — which is exactly what "waiter fires an order, kitchen bumps it,
cashier settles it" needs in a single test. Cypress runs one browser, one origin, one session
per spec; multi-actor journeys have to be faked.

**(b) The frontend and the gateway are different origins.** `frontend/lib/env.ts:6` points the
axios client at `http://localhost:8080` while the app is served from `:3000` — there is no
Next.js rewrite (`frontend/next.config.ts` has none). Cypress's origin model has historically
fought this; Playwright does not care.

**(c) Assertions must be made at the API boundary, not only in the DOM.** The nav hides items
whose feature flag is absent — but `useNavItemVisible` **fails open** on a feature-fetch error
(`frontend/lib/hooks/auth/use-nav-visibility.ts:26-31`, `failOpenOnError`). A DOM-only
assertion could therefore pass with the flags endpoint completely broken. Playwright's
`APIRequestContext` lets the same test assert the gateway really returns `403
FEATURE_DISABLED` — verified live, §4.3.

**(d) Real credentials, real second factors, real cookies.** Minting TOTP codes and replaying
`HttpOnly` cookies wants full Node in the test process. Playwright's test process *is* Node.

**(e) The existing seed script is Python + stdlib.** Playwright's `@playwright/test` needs no
runtime companion; the TOTP helper I wrote is 60 lines of `node:crypto` mirroring the seed
script's `totp_now()` exactly (`scripts/seed_restaurantos.py:393-399`). No new dependency.

### 1.3 Versions and the exact install state

Nothing was installed. The package was already present and the browser binaries already
cached:

```
$ pnpm exec playwright --version        →  Version 1.61.1
$ node -p "require('@playwright/test/package.json').version"  →  1.61.1
$ ls ~/Library/Caches/ms-playwright/    →  chromium-1223  chromium-1228
                                           chromium_headless_shell-1223/1228  ffmpeg-1011
$ node -v  →  v24.12.0        $ pnpm -v  →  11.9.0
```

Pin for CI (`.github/workflows/ci.yml` already sets `NODE_VERSION: "22"`):

```jsonc
"devDependencies": { "@playwright/test": "1.61.1" }   // drop the ^ — browser binaries are
                                                     // version-locked to the package
```

and the browser install step CI already runs:
`pnpm --dir frontend exec playwright install --with-deps chromium`.

---

## 2. Why the existing Playwright setup produced nothing, and what I changed

`frontend/playwright.config.ts` before this work had `testDir: "./e2e"` and **one** project.
`pnpm e2e` therefore ran all 16 specs — the one backend-free smoke test *and* the 15
live-stack specs that hard-code `cashier@demo.local` / `Cashier#2026` / tenant `demo`
(`e2e/pos-settlement.spec.ts:26-29`). In CI, where no stack exists, 15 of 16 could only fail —
and the job carries `continue-on-error: true` (`ci.yml:362`). A permanently-red, permanently-
ignored job is worse than no job.

**The restructure** (`frontend/playwright.config.ts`, rewritten) splits this into four
projects, three of them opt-in:

| Project | testDir | Gate | Needs |
|---|---|---|---|
| `smoke` | `e2e/smoke` | always | nothing — this is the CI path |
| `auth-setup` | `e2e/setup` | `E2E_STACK=1` | live stack + seeded DB |
| `journeys` | `e2e/journeys` | `E2E_STACK=1`, `dependencies: ["auth-setup"]` | live stack + seeded DB |
| `legacy` | `e2e/*.spec.ts` (top level only) | `E2E_LEGACY=1` | live stack + the old `demo` tenant |

`pnpm e2e` is now `playwright test --project=smoke`. **CI needs no change** — the job command
is unchanged and now runs exactly the one test it can actually run. The 15 legacy specs are
preserved and discoverable (`E2E_LEGACY=1 playwright test --project=legacy --list` → *Total:
17 tests in 13 files*), not deleted.

New scripts in `frontend/package.json`:

```jsonc
"e2e":           "playwright test --project=smoke",
"e2e:journeys":  "E2E_STACK=1 playwright test --project=journeys",
"e2e:setup":     "E2E_STACK=1 playwright test --project=auth-setup",
"e2e:legacy":    "E2E_LEGACY=1 playwright test --project=legacy",
"e2e:typecheck": "tsc --noEmit -p e2e/tsconfig.json"
```

---

## 3. What was actually built

```
frontend/
├── playwright.config.ts                      (rewritten — 4 projects)
├── eslint.config.mjs                         (+ e2e/** override, see §3.5)
├── .gitignore                                (+ /e2e/.auth/)
├── package.json                              (+ 4 scripts)
└── e2e/
    ├── fixtures/
    │   ├── totp.ts            RFC-6238 TOTP in node:crypto + secret loading
    │   ├── personas.ts        the 18 personas + 3 tenants, derived exactly as the seed does
    │   ├── gateway.ts         real-gateway calls, rate-limit pacing, transient retry
    │   └── auth.fixture.ts    the extended `test` every journey imports
    ├── setup/
    │   └── auth.setup.ts      resolves slugs, mints 19 storage states
    ├── journeys/
    │   ├── persona-access-matrix.spec.ts     20 tests
    │   ├── step-up-totp.spec.ts               4 tests
    │   └── tenant-feature-gating.spec.ts      3 tests
    └── smoke/
        └── smoke.spec.ts      (moved from e2e/, unchanged)
```

### 3.1 The auth model, verified rather than assumed

This is the load-bearing design decision, so here is the evidence chain.

The access token is **memory-only** — `frontend/lib/auth/session.ts:5-8` says so and the
zustand store holds it with no persistence. There is nothing token-shaped to snapshot. What a
browser actually needs to come back signed-in is exactly two cookies:

| Cookie | Set by | Attributes | Source |
|---|---|---|---|
| `refresh_token` | auth-service | `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`, 30-day | `services/auth-service/.../AuthController.java:84-90` |
| `has_session` | client JS | non-HttpOnly UX marker, `Path=/` | `frontend/lib/auth/session.ts:13-20` |

On load, `SessionProvider` reads `has_session`, calls `POST /api/v1/auth/refresh` with the
HttpOnly cookie and rehydrates
(`frontend/components/providers/session-provider.tsx:44-70`). So a storage state carrying
those two cookies **is** a logged-in browser.

Two facts made this safe, and both were read in source, not guessed:

- **The refresh token is NOT rotated.** `AuthServiceImpl.refresh` (L153-176) validates the
  session and signs a new access token; it never re-issues or revokes the refresh token.
  `RefreshSessionService.validate` (L49-56) is a pure read with no `save()`, and
  `RefreshSessionEntity` carries no `@Version`. N parallel workers replaying one state cannot
  trip reuse detection.
- **The cookie crosses the port boundary.** It is set by `:8080` and needed by a page on
  `:3000`. Cookies ignore port, and `SameSite=Strict` is satisfied because both are the same
  *site*. Verified empirically — the minted state contains
  `('refresh_token','localhost','/api/v1/auth')` and every persona rehydrates.

**What storage state can never carry: `totp_verified`.** `AuthServiceImpl.refresh:160-168`
mints it **false**, deliberately — the comment explains that an hour-grade proof of possession
must not ride a 30-day credential. Consequence, and it is absolute: *any journey ending in a
step-up-gated action must drive the login form with a live code.* `uiLoginWithTotp()` exists
for that and `step-up-totp.spec.ts` pins the constraint with an assertion, so the day it
changes the suite says so.

### 3.2 Two ways in, on purpose

```ts
const page = await as(persona("saffron", "cashier"));  // replay — no login request at all
await uiLoginWithTotp(page, OWNER, slug);              // the real form + a live TOTP code
const t = await token(persona("zaitoon", "manager"));  // bearer via refresh, never via login
```

`token()` refreshes rather than logs in for a measured reason — see §8.2.

### 3.3 Tenant slugs are resolved, never hard-coded

The persona is `owner@saffron.local` but the tenant slug is `saffron-grill` — the slug is
minted by platform-admin-service from the brand name, not derived from the email. `auth.setup.ts`
logs in as the SuperAdmin, reads `GET /api/v1/platform/tenants`, joins on `brandName`, and
writes `e2e/.auth/tenants.json`. Every spec reads that. A re-provisioned tenant changes one
generated file rather than silently pointing the suite at nothing.

### 3.4 `?tenant=` is always explicit

`frontend/.env.local` sets `NEXT_PUBLIC_DEFAULT_TENANT_SLUG=test`, and `frontend/proxy.ts:35-43`
rewrites a bare `/login` to that tenant *and hides the restaurant field*. A multi-tenant suite
that relied on the default would silently test one tenant three times. Every form login in the
harness passes `?tenant=<resolved slug>`.

### 3.5 One lint change was required

Playwright fixtures take a callback named `use`. `react-hooks/rules-of-hooks` matches on the
identifier and reported five false positives in `auth.fixture.ts`. Since `e2e/**` is already
excluded from the app's `tsconfig.json` and has its own `e2e/tsconfig.json`, I disabled only
that rule for `e2e/**/*.ts` in `frontend/eslint.config.mjs`. Everything else still lints.
`pnpm lint` → **0 errors** (9 pre-existing warnings, all in `components/**`, unrelated).

---

## 4. What I actually ran, and the real output

### 4.1 Final verification, 2026-08-07 01:31 UTC

```
$ pnpm e2e:typecheck
$ tsc --noEmit -p e2e/tsconfig.json          (clean, no output)

$ pnpm e2e                                   # smoke, backend-free — the CI path
  ✓  1 [smoke] › e2e/smoke/smoke.spec.ts:7:5 › unauthenticated /app/dashboard redirects to /login (546ms)
  1 passed (1.4s)

$ pnpm e2e:journeys                          # auth-setup + 30 journeys, live stack
  30 passed (22.2s)
```

Expanded, from the 01:19 UTC run (7 workers — the machine default):

```
Running 30 tests using 7 workers
  ✓ [auth-setup] resolve tenant slugs from the platform API (315ms)
  ✓ [auth-setup] mint a storage state for every seeded persona (11.2s)
  ✓ [auth-setup] mint a storage state for the SuperAdmin (539ms)
  ✓ [journeys] persona access matrix › an unauthenticated browser never sees the app shell (1.4s)
  ✓ [journeys] persona access matrix › saffron.owner (OWNER) reaches the tenant shell (3.1s)
  ✓ [journeys] persona access matrix › saffron.manager (MANAGER) … (2.6s)
  ✓ [journeys] persona access matrix › saffron.cashier (CASHIER) … (2.6s)
  ✓ [journeys] persona access matrix › saffron.waiter (WAITER) … (3.0s)
  ✓ [journeys] persona access matrix › saffron.kitchen (KITCHEN_STAFF) … (1.8s)
  ✓ [journeys] persona access matrix › saffron.accountant (ACCOUNTANT) … (3.0s)
  ✓ … the same six for zaitoon.* and marina.*  (18 in total)
  ✓ [journeys] persona access matrix › nav is role-scoped: manager sees Till Review, cashier does not (1.6s)
  ✓ [journeys] per-tenant feature gating › gateway: FEATURE_CRM off for Zaitoon, on for Saffron (309ms)
  ✓ [journeys] per-tenant feature gating › flags endpoint reflects the seeded divergence (290ms)
  ✓ [journeys] per-tenant feature gating › nav: the Customers entry follows the tenant's entitlement (1.4s)
  ✓ [journeys] TOTP step-up › A · owner signs in through the form with a live code (2.2s)
  ✓ [journeys] TOTP step-up › A2 · a wrong code is refused and the user stays on /login (1.2s)
  ✓ [journeys] TOTP step-up › B/C · totp_verified is minted at login and dropped at refresh (1.6s)
  ✓ [journeys] TOTP step-up › D · uiLoginWithTotp helper drives the same flow (977ms)
  30 passed (25.1s)
```

Stability: three consecutive runs at `--workers=4` with **no cooldown** — 19.6s, 19.7s, 20.2s,
all 30 green. That matters, because the first parallel attempts were not (§4.4).

### 4.1a Concurrent modification by another agent — state at hand-off

**Read this before re-running.** Between 01:36 and 01:39 UTC, after my last independently
verified green run, another agent in the parallel swarm added two files to the harness I built
and wired them into my fixture and specs:

```
frontend/e2e/fixtures/observability.ts   (new — a strict console/network guard)
frontend/e2e/fixtures/known-defects.ts   (new — DEFECTS registry + tolerate())
```

The guard is good work: it attaches to every page opened via `as()` and `context`, and fails a
test on any un-declared 4xx/5xx or console error, forcing specs to say
`obs.expect403(url, 'why')`. It immediately surfaced a real defect (§8.9). It also adapted my
`persona-access-matrix.spec.ts` and `step-up-totp.spec.ts` to declare their by-design refusals.

The guard briefly regressed one test at 01:38 UTC (`step-up-totp › D`, rejected for a
`401 TOTP_REQUIRED` the spec already declared) and the other agent fixed it within two minutes.

**Verified state at hand-off (01:40 UTC): `pnpm e2e:typecheck` clean, `pnpm e2e` 1 passed,
`pnpm e2e:journeys` 31 passed (24.5s)** — the extra test over my 30 is their
`known-defects` pin.

**My own last independent verification, 01:31 UTC, before those files existed: 30/30, and three
consecutive `--workers=4` runs at 19.6s / 19.7s / 20.2s with no cooldown.** Everything in §4.1
and §4.4 below was measured against that state.

### 4.2 Ground truth established before writing a line of test code

```
$ curl POST :8080/api/v1/platform/auth/login  superadmin@softxlogic.com / Test@123!
  200 — roles ["SUPER_ADMIN"], token_type "platform", totp_verified false

$ for each saffron persona: POST :8080/api/v1/auth/login
  cashier@saffron.local     → 200 OK
  waiter@saffron.local      → 200 OK
  manager@saffron.local     → 200 OK
  kitchen@saffron.local     → 200 OK
  owner@saffron.local       → 401 TOTP_REQUIRED
  accountant@saffron.local  → 401 TOTP_REQUIRED

$ node <TOTP from .seed-state/totp/owner@saffron.local> → 456614
  owner@saffron.local → 200 OK
  totp_verified = true | roles = ['OWNER'] | perms = 65 | set-cookie: refresh_token
```

JWT claim shape (there is no top-level `tenantId`/`branchId` — they are snake_case):

```json
{"jti","sub","tenant_id","branch_id","roles":["MANAGER"],"permissions":[49 codes],
 "attributes":{},"totp_verified":false,"iat","exp"}
```

### 4.3 Feature divergence, measured

```
saffron  (STARTER  + FEATURE_NLQ override ON):
  CRM FINANCE HR INVENTORY KDS LOYALTY NLQ PAYROLL POS VENDOR                        (10)
zaitoon  (GROWTH   + FEATURE_CRM override OFF):
  ANALYTICS AUDIT_EXPORT CUSTOM_ROLES ECOMMERCE FINANCE HR INVENTORY KDS LOT_TRACKING
  LOYALTY MULTI_BRANCH NLQ PAYROLL POS REPORTING_ADVANCED VENDOR WHATSAPP…           (17)

$ GET /api/v1/crm/customers  as manager@zaitoon → 403 {"code":"FEATURE_DISABLED"}
$ GET /api/v1/crm/customers  as manager@saffron → 503 (crm-service down; NOT 403)
```

The spec asserts `not.toBe(403)` for the entitled tenant, never `toBe(200)` — the feature gate
runs at the edge before routing, so an entitled tenant whose service is down is still correctly
entitled. Asserting 200 would fail for a reason unrelated to entitlement.

### 4.4 The failures on the way, because they are the interesting part

| Attempt | Result | Cause |
|---|---|---|
| 4 workers, no isolation | 25 passed, **5 failed** | `POST /auth/refresh → 429` — shared credential bucket |
| + `extraHTTPHeaders: X-Forwarded-For` on browser contexts | 7 passed, **23 failed** | **CORS**: gateway allows only `content-type, x-request-id`; Chromium blocked every cross-origin call |
| + XFF on APIRequestContext only | 27 passed, **3 failed** | same-user concurrent logins → `409 CONCURRENT_MODIFICATION` |
| + serial step-up + `token()` via refresh | 28 passed, **1 failed** | residual same-user race |
| + `page.route()` XFF injection | **30 passed**, ×3 runs | — |

Every one of those five is documented in the code where it bites, with the measurement.

---

## 5. The journey list, prioritised — and which are possible today

I probed each entry point in a real browser as the role that owns it, rather than inferring
from the presence of a route file. **This project has repeatedly shipped code that was
structurally present and completely dead**, so "the page exists" is not evidence.

Probe results (Playwright, seeded personas, live stack, `waitUntil: "domcontentloaded"`):

```
OWNER          /app/hr/payroll        → h1 "Payroll runs"          ✓
ACCOUNTANT     /app/finance/periods   → h1 "Accounting Periods"    ✓
KITCHEN_STAFF  /app/kitchen           → /app/kitchen/DEFAULT, h1 "DEFAULT"  ✓
MANAGER        /app/reports           → h1 "Reports"               ✓
WAITER         /app/pos               → renders, but "Your till is closed"; 403 on /api/v1/pos/tills  ✗
CASHIER        /app/pos/tills         → page never settles (service worker + socket)   ⚠
```

### P0 — build these first; they work today

| # | Journey | Entry | Notes |
|---|---|---|---|
| 1 | **Persona access matrix** (18 personas reach the shell) | `/app/dashboard` | **DONE** — `persona-access-matrix.spec.ts` |
| 2 | **TOTP step-up login** | `/login` | **DONE** — `step-up-totp.spec.ts` |
| 3 | **Per-tenant feature gating**, UI + gateway | `/app/dashboard`, `/api/v1/crm/**` | **DONE** — `tenant-feature-gating.spec.ts` |
| 4 | **Kitchen bumps a ticket** | `/app/kitchen/[stationCode]` | KDS reachable as KITCHEN_STAFF. Rich `data-testid` coverage already exists (`kds-ticket-card`, `kds-column-*`, `column-move-*`, `station-tile-*` — 80 test ids across `components/kds/**` and `components/pos/**`). Needs a seeded open ticket. |
| 5 | **Manager views reports** | `/app/reports`, `/app/reports/[code]` | Reachable, h1 "Reports". Lowest-risk read-only journey; good visual-regression anchor. |
| 6 | **Cashier settles cash with an open till** | `/app/pos/tills` → `/app/pos/orders/[id]/charge` | The most valuable money-path journey. **Must** use `prepareForPos()` + `domcontentloaded` (§8.5). Substantial prior art in `e2e/pos-settlement.spec.ts`. |

### P1 — blocked on a product fix, not on the harness

| # | Journey | Blocker |
|---|---|---|
| 7 | **Waiter takes an order to KDS** | The POS UI still gates the waiter behind "Your till is closed — Orders can't be created without an open drawer", and `GET /api/v1/pos/tills` returns **403** for WAITER. D-30 changed pos-service so the till binds opportunistically at order creation, but **the POS frontend was not updated**. See §8.1. |
| 8 | **Forced password change** | No frontend implementation at all. `grep -rn "PASSWORD_CHANGE_REQUIRED\|change-password" frontend/lib frontend/components frontend/app` → **zero matches**. §8.3. |

### P2 — blocked: there is no UI

| # | Journey | Evidence |
|---|---|---|
| 9 | **SuperAdmin creates a tenant, toggles modules** | `app/(platform)/platform/dashboard/page.tsx` is 9 lines returning `<h1>Platform Dashboard</h1><p>SuperAdmin shell placeholder.</p>`. There is **no platform login page** and `grep -rn "api/v1/platform" frontend/lib frontend/components frontend/app` → **zero matches**. Also empirically: the platform login returns **no `refresh_token` cookie**, so it cannot even be entered by replaying cookies (the setup project records `hasRefreshCookie: false`). |
| 10 | **Tenant onboarding** | Same — provisioning is API-only. |
| 11 | **Admin creates a user; that user logs in** | `frontend/lib/repositories/` has 12 repositories and **no `user.repository.ts`**; `grep -rn "api/v1/users\|api/v1/roles" frontend/…` → **zero matches**. The second half ("that user logs in") is already covered by journey 1. |

Until 9–11 have a UI, **drive them through the API inside a Playwright spec**, then assert the
browser-visible consequence. E.g. create a tenant via `POST /api/v1/platform/tenants`, then
assert a browser signed in as its owner sees the right nav. That is honest — it tests what
exists — and the spec converts to a real UI journey later by swapping the setup half.

### P2 — worth adding once the above land

12. **Cross-tenant isolation, in a browser.** Sign in as `manager@saffron`, navigate to a
    Zaitoon resource id, assert 403/404 and no data. This is the one journey that directly
    exercises the FORCE RLS story end to end, and nothing currently covers it.
13. **Rate-limit behaviour at production settings**, run serially with default
    `RATE_LIMIT_AUTH_PER_MIN` (§6.3).
14. **Branch switch** — `key={branchId}` remounts page content
    (`app/(tenant)/layout.tsx:96`); assert no stale cross-branch data survives.
15. **Offline POS** — `pos-offline.spec.ts` already exists as legacy; fold in.

---

## 6. The four hard problems, answered

### 6.1 Seeded persona credentials

**`scripts/README-seed.md` does not exist.** `scripts/seed_restaurantos.py:66-69` promises it —
*"Every credential is DEVELOPMENT-ONLY and is documented in `scripts/README-seed.md`"* — and
`ls scripts/README-seed.md` → *No such file or directory*. **This is a real dependency and it
is open.**

The harness does not wait for it. Credentials are *derived* the same way the seed derives them
(`e2e/fixtures/personas.ts`), so the code is the contract:

```
email    = `${local}@${tenantKey}.local`                        seed L204-205
password = `${Capitalise(tenant)}#${Capitalise(local)}1`         seed L208-216
tenants  = saffron | zaitoon | marina                            seed L130-172
locals   = owner manager cashier waiter kitchen accountant       seed L188-202
SuperAdmin = superadmin@softxlogic.com / Test@123!               seed L119-120
```

⇒ `owner@saffron.local` / `Saffron#Owner1`, `cashier@zaitoon.local` / `Zaitoon#Cashier1`, …
All 18 verified by login through the real gateway.

**When `README-seed.md` lands it must not restate these — it must point at
`persona_password()`.** Two hand-maintained copies of a credential table is how the suite
starts lying.

Slugs are *not* derived — they are resolved from the live platform API at setup time (§3.3).

### 6.2 TOTP-enrolled accounts (OWNER, and also ACCOUNTANT)

The brief says OWNER requires step-up. **Measured: ACCOUNTANT does too** — both are refused
`401 TOTP_REQUIRED` on a password-only login, and `.seed-state/totp/` holds exactly six
secrets: `owner@{saffron,zaitoon,marina}` and `accountant@{…}`. `requiresTotpStepUp` fires on
`finance.period.close` and `hr.payroll.approve`, which both roles hold (13-CONTEXT.md:78-95,
D-29a).

**How the harness handles it:**

1. **Secrets come from the seed's own state directory.** `.seed-state/totp/<email>`, a raw
   32-char base32 string, mode 0600, gitignored at repo root
   (`.gitignore`: `.seed-state/`). They are minted by auth-service at `/2fa/bootstrap` and are
   **not derivable** — losing the directory means re-enrolment
   (`seed_restaurantos.py --phase personas --repair`). `loadTotpSecret()` returns null rather
   than throwing so the caller can name *which* persona is unusable and how to fix it.
2. **Codes are computed in-process**, `node:crypto` HMAC-SHA1, 30s step, 6 digits — the exact
   twin of `totp_now()`. No `pyotp`, no `otplib`, no new dependency.
3. **Window-edge flake is designed out.** `totpStable()` refuses to hand back a code with
   under 3s left in its window; it waits for the next one. A code minted at T and validated at
   T+1s in a different window is the classic TOTP flake.
4. **Two paths, and the difference is not cosmetic.** `apiLoginPersona()` supplies a code
   automatically when the persona is enrolled — used by setup to mint storage states.
   `uiLoginWithTotp()` drives the real two-submit form: submit → server refuses
   `TOTP_REQUIRED` → `onError` reveals the field
   (`components/auth/login-form.tsx:95-101`) → fill → submit.
5. **The step-up ceiling is pinned by an assertion**, not a comment. `step-up-totp.spec.ts`
   test B/C proves `totp_verified` is `true` after a coded login and `false` after a refresh.
   The failure message explains that if this ever flips, every storage-state fixture silently
   gains step-up rights.

**Consequence for the journey list:** payroll approval and accounting-period close **cannot**
use `as()`. They must call `uiLoginWithTotp()`.

### 6.3 The gateway's login rate limit

The number in the brief is right but incomplete. From
`gateway/src/main/resources/application.yml:78-84`:

```yaml
- name: RequestRateLimiter          # route: /api/v1/auth/**
  args:
    redis-rate-limiter.replenishRate: 2                                # 2 tokens/sec
    redis-rate-limiter.burstCapacity: ${RATE_LIMIT_AUTH_PER_MIN:100}   # burst 100
    key-resolver: "#{@ipKeyResolver}"                                  # per SOURCE IP
```

Four things follow, three of which are not obvious:

**(a) It is not just `/login`.** The whole `/api/v1/auth/**` route is on that bucket — including
`POST /auth/refresh`, which `SessionProvider` calls on **every full page load**, and
`GET /api/v1/auth/tenants/<slug>`, which `useTenantBrand` calls on every page load too. **Every
navigation costs two credential-bucket tokens.** A 30-test suite at ~2 navigations each is
~120 tokens against a burst of 100. Measured: 5 of 30 journeys failed with
`POST /api/v1/auth/refresh → 429`.

**(b) The 429 is indistinguishable from an expired session, to the product.**
`refreshSession()` catches everything and calls `clearSession()`
(`frontend/lib/auth/session.ts:71-80`), so the user is bounced to
`/login?reason=session_expired`. See §8.4 — this is a product bug, not just a test problem.

**(c) The bucket is client-selectable.** `RateLimitConfig.ipKeyResolver` (L41-54) reads
`X-Forwarded-For` unconditionally and takes `split(",")[0]`. Measured:

```
130 logins, fixed X-Forwarded-For: 203.0.113.7  → first 429 at request 67
immediately, X-Forwarded-For: 198.51.100.9      → 401 (fresh bucket)
immediately, X-Forwarded-For: 198.51.100.10     → 401 (fresh bucket)
```

This is **not** a production bypass as deployed: `deploy/nginx/nginx.conf:68` uses
`proxy_set_header X-Forwarded-For $remote_addr` — a *replace*, not `$proxy_add_x_forwarded_for`
— so the client value is overwritten. It **would** be a bypass of the credential brute-force
throttle (T-13-01-BF) on any path that reaches the gateway without that nginx. See §8.6.

**(d) So the harness isolates buckets per worker — three different ways, for three reasons.**

| Traffic | Mechanism | Why not the others |
|---|---|---|
| `APIRequestContext` (setup, `gateway`, `token`) | `extraHTTPHeaders: { X-Forwarded-For }` | server-to-server, no CORS |
| Browser (`as()`, default `context`) | `context.route()` → `route.continue({ headers })` | `extraHTTPHeaders` on a browser context triggers a preflight the gateway rejects (`Access-Control-Allow-Headers: content-type, x-request-id`) — measured: 5 failures → 23 |
| `auth-setup` project | its own fixed `10.63.200.1` | 19 logins would otherwise leave journeys-worker-0 inheriting a drained budget |

Plus belt and braces: `paceLogin()` spaces logins ≥550ms, and `withTransientRetry` backs off on
429 for six attempts.

**For CI / staging** — behind nginx the header trick correctly stops working. Set
`E2E_WORKER_IP=0` and raise the limit on the environment under test:

```yaml
env:
  RATE_LIMIT_AUTH_PER_MIN: "5000"   # already a documented knob; NOT a code change
  E2E_WORKER_IP: "0"
```

and keep **one serial spec** that asserts the limiter still works at default settings, so
raising it in CI never hides its removal.

### 6.4 Test-data isolation between runs

The seed is **idempotent by construction** — every id it controls is a `uuid5` over a stable
name, in the same namespace `scripts/onboarding.py` uses, and server-assigned resources are
looked up and reconciled rather than duplicated (`seed_restaurantos.py:44-49`). A second run
changes nothing material. So the base state is a fixed point, not a growing pile.

That gives four layers, which is what "no gaps" actually requires:

**L1 — Identity isolation is total, and free.** Every persona gets its own
`BrowserContext` with its own cookie jar. There is no shared login, no `beforeAll` sign-in, no
possibility of test A's session leaking into test B.

**L2 — Storage states are per-run, never committed.** `e2e/.auth/` is gitignored (they contain
live refresh tokens). `auth-setup` regenerates all 19 every run and `journeys` depends on it,
so a stale token is structurally impossible. Each state carries a `__meta` block (persona,
role, tenantSlug, tenantId, branchId, mintedAt) for debugging.

**L3 — Reads are safe on shared data; writes must be self-naming.** All three current specs are
read-only, so they are trivially re-runnable — proven by three consecutive clean runs. For the
write journeys (order → KDS → settle):

- **Never assert on absolute counts.** "3 orders exist" breaks on run 2. Capture the count
  before, assert the delta.
- **Name every created row with the test's own run id.** Recommend a `runId` worker fixture,
  `e2e-${Date.now().toString(36)}-${workerIndex}`, embedded in every customer name, order note
  and vendor name, so a failed run leaves identifiable, greppable debris.
- **Money is BIGINT paisa.** Assert on integers. A journey that reads `Rs 1,234.50` off the
  page and parses it to a float has already lost; read the paisa integer from the API response
  the page was rendering, or assert the exact rendered string.

**L4 — Tenant partitioning as the outer isolation ring.** Three seeded tenants with FORCE RLS
between them. Recommendation: **give destructive journeys their own tenant.** Marina
(ENTERPRISE, all features) is the natural sacrifice; keep Saffron and Zaitoon read-mostly so
the feature-gating and access-matrix specs stay deterministic. This is stronger than any
truncate-between-tests scheme because it is enforced by the database, not by test discipline.

**Explicitly rejected: truncating tables between runs.** Sixteen services own their own
databases with FORCE RLS keyed on `current_setting('app.current_tenant_id')`. A truncate
script would need superuser or a per-service RLS-aware path, would drift from the seed, and
would make the harness a second source of truth about schema. The idempotent seed already
solves it.

**Where the seed and the harness must stay in sync:** if `PERSONAS` or `TENANTS` changes in
`seed_restaurantos.py`, `e2e/fixtures/personas.ts` must change too. Cheap guard worth adding:
a test that reads the Python constants and diffs them against the TS ones.

---

## 7. Visual regression: yes, but scoped, and not yet

**Recommendation: add Playwright's built-in `toHaveScreenshot()`, on a deliberately short list
of surfaces, in a separate project — and do not buy a service.**

### Why built-in

- Zero new dependency, zero vendor, no image upload of a multi-tenant app's screens to a third
  party. Given per-tenant branding and real customer-shaped seed data, that last point is not
  a small consideration.
- Playwright's comparator (pixelmatch) with `maxDiffPixelRatio` is sufficient for catching
  layout collapse, missing chrome, and theme regressions — which is what actually breaks.
- Percy/Chromatic/Applitools earn their price on **cross-browser × cross-viewport** matrices
  and on review workflow. This suite runs one browser (`projects: [chromium]`) against a
  self-hosted stack. Revisit only if the matrix genuinely expands.

### Why not yet, and what must be true first

Four properties of this app make naïve screenshots a flake factory. Each has a fix:

| Hazard | Evidence | Fix |
|---|---|---|
| Theme is viewer-dependent | `@teispace/next-themes`, `/api/theme`, `components/shared/theme-toggle` | Pin `colorScheme` per snapshot project; snapshot light and dark as separate named shots |
| Per-tenant brand colour injects a stylesheet | `app/(tenant)/layout.tsx:17-49` reads `tenant-theme-settings` from localStorage | Snapshot one tenant per surface, or clear the key in an init script |
| Animation | `framer-motion`, `PageTransition`, `tw-animate-css`, `react-countup` | `toHaveScreenshot({ animations: "disabled" })` — and note `react-countup` on the dashboard KPIs makes them **unsnapshotable** until settled; mask them |
| Live/relative data | KDS ticket age chips (`data-testid="kds-ticket-age"`), "3 unread" notifications, timestamps | `mask:` those locators |

### Concrete plan

```ts
// playwright.config.ts — a fifth project, gated on E2E_VISUAL=1
{
  name: "visual",
  testDir: "./e2e/visual",
  dependencies: ["auth-setup"],
  use: { ...devices["Desktop Chrome"], colorScheme: "light" },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" } },
}
```

Snapshot **six surfaces**, not sixty — one per shell state that a CSS change can destroy:

1. `/login` (branded, tenant resolved) — the only page an unauthenticated user sees
2. `/app/dashboard` as MANAGER — full sidebar + top bar, mask the CountUp KPIs
3. `/app/dashboard` as KITCHEN_STAFF — the reduced shell, proves the role branch
4. `/app/kitchen/[station]` — dark board, the highest-contrast layout in the app
5. `/app/reports` — table-dense, most likely to break on a Tailwind bump
6. `/app/dashboard` at the mobile breakpoint — `MobileBottomNav` + collapsed sidebar

Baselines are committed under `e2e/visual/__screenshots__/`. **Generate them in CI, in the
Linux container, never on macOS** — font rendering differs enough to make every local run red.
A `--update-snapshots` job on demand plus an artifact-uploaded HTML report is the whole review
workflow; that is the piece a paid service would otherwise be sold for.

**Sequencing:** do this *after* the P0 journeys land. A screenshot of a page whose behaviour
is unverified is a photograph of an unknown.

---

## 8. Defects the harness found

These were all found by driving the real thing. None would have surfaced from unit tests, and
four are product bugs rather than test-environment noise.

### 8.1 The waiter cannot take an order in the UI — D-30 landed in the backend only ⚠️ HIGH

Probed as `waiter@saffron.local` at `/app/pos`. The page renders the shell and then:

> **Your till is closed** — "Open your till from the bar above — recording the counted starting
> float — before taking any orders. Orders can't be created without an open drawer."

with `GET /api/v1/pos/tills` returning **403** (WAITER holds `pos.order.create` and
`pos.order.view` but not `pos.till.open` — 14 permission codes, verified).

D-30 (13-CONTEXT.md, and `13-16-PLAN.md`) explicitly changed `OrderServiceImpl.createOrder` so
the till binds *opportunistically* and only `PaymentMethod.CASH` settlement requires one —
precisely so a waiter could take an order. **The POS frontend still enforces the old rule.**
The seed script's own note says "13-16 must land before 13-15, or the seed script's waiter
persona cannot complete an order"; the backend half landed, the UI half did not.

This is the exact failure shape the audit calls out: the repair is present in code and
unreachable in practice.

### 8.2 Two concurrent logins by the same user → 409 CONCURRENT_MODIFICATION ⚠️ HIGH

Reproduced in isolation:

```
4 simultaneous logins, SAME user   → 1×200, 3×409 CONCURRENT_MODIFICATION
4 simultaneous logins, DIFFERENT users → 4×200
```

Root cause, traced: `AuthServiceImpl.login:122-126` sets `failedLoginCount(0)`,
`lockedUntil(null)`, `lastLoginAt(now)` and calls `userRepository.save(user)` on an entity
carrying `@Version` (`UserEntity.java:59`). The loser of the race throws
`OptimisticLockingFailureException`, which `GlobalExceptionHandler:174-179` maps to **409
"This record changed while you were editing it — reload and try again"**.

Why it matters outside the test: restaurants share accounts. One `cashier@…` login on two
tills, or a manager opening the app on a phone and a terminal, hits this — and is told to
"reload the record they were editing", which is nonsense to the user. The write is also pure
bookkeeping; nothing about it needs to be version-checked.

**Suggested fix:** do the login-bookkeeping write as an unversioned targeted `UPDATE`
(`@Modifying @Query("update UserEntity set lastLoginAt=…, failedLoginCount=0 where id=…")`),
or catch the optimistic-lock failure at that one call site and proceed — the token has already
been earned by then.

Harness workaround (narrow, and it does not hide the defect anywhere else): the login helpers
retry a 409 whose body contains `CONCURRENT_MODIFICATION`, `step-up-totp.spec.ts` runs
`mode: "serial"`, and specs get bearer tokens via `tokenViaRefresh()` — refresh has no such
hazard (`RefreshSessionService.validate` is a pure read, no `@Version`).

### 8.3 The forced-password-change flow has no frontend ⚠️ MEDIUM

`grep -rn "PASSWORD_CHANGE_REQUIRED\|change-password" frontend/lib frontend/components frontend/app`
→ **zero matches**. `frontend/lib/errors/api-error.ts` has `isTotpRequired()`,
`isTotpEnrollmentRequired()`, `isAccountLocked()`, `isUnauthenticated()` — and nothing for
`PASSWORD_CHANGE_REQUIRED`. `login-form.tsx`'s `onError` chain therefore falls through to the
generic branch and shows the raw server message.

The backend side is complete and well-tested (13-08-SUMMARY.md: 403 `PASSWORD_CHANGE_REQUIRED`,
change token in `error.details[field=changeToken].issue`, 10-minute TTL, single-use,
`POST /api/v1/auth/change-password/forced`). A newly provisioned user therefore **cannot
complete their first login in a browser** — only via curl or the seed script.

Requested journey #7 is blocked on building this UI.

### 8.4 A rate-limited refresh is reported to the user as an expired session ⚠️ MEDIUM

`refreshSession()` (`frontend/lib/auth/session.ts:71-80`) wraps the call in a bare
`try/catch`, and any failure calls `clearSession()`. `SessionProvider` then routes to
`/login?reason=session_expired`. Observed repeatedly in this work: a `429` on
`POST /api/v1/auth/refresh` logs the user out.

In production a restaurant is one NAT'd IP. Six staff on tablets, each page load spending two
credential-bucket tokens (§6.3a), can plausibly reach `replenishRate: 2/s` at open — and the
symptom is *everyone gets logged out*, not *things are slow*. Two independent fixes, both
cheap:

1. **Move `/api/v1/auth/refresh` (and `/auth/tenants/{slug}`) off the credential bucket.**
   Neither is a credential-guessing surface; the tight budget exists for `/login`. This is the
   same reasoning `application.yml:103-115` already applies to the role-catalog route, with the
   same justification written out.
2. **Distinguish 429 from 401 in `refreshSession()`** — back off and retry rather than clearing
   the session.

### 8.5 The POS page never settles, and closing its context hangs 🔧 HARNESS

`page.goto("/app/pos")` with the default `waitUntil: "load"` never resolves; the page shows
"Polling — reconnecting" and `context.close()` then hangs the test to its timeout (90s in the
probe that found it). `/app/pos` registers a service worker (`app/(tenant)/app/pos/layout.tsx`)
and holds a socket that degrades to polling.

The pre-existing `e2e/pos-settlement.spec.ts:60-80` independently arrived at the same
workaround. I lifted it into `prepareForPos(context)` in the fixture; any POS/KDS journey must
call it **and** navigate with `{ waitUntil: "domcontentloaded" }`. Worth an
`expect.configure`-style lint or a doc note, because it will be rediscovered painfully
otherwise.

### 8.6 The per-IP rate limiter's key is client-controlled 🔒 SECURITY (env-dependent)

`RateLimitConfig.ipKeyResolver:41-54` reads `X-Forwarded-For` with no trusted-proxy check and
takes the first element. Measured in §6.3c: rotating the header gives an unlimited credential
budget.

**As deployed today this is mitigated**, because `deploy/nginx/nginx.conf:68` *replaces* the
header rather than appending. It becomes a live bypass of T-13-01-BF the moment the gateway is
reachable without that nginx in front — a k8s ingress, a debug port-forward, an internal LB.
Given the brute-force throttle on the SuperAdmin credential endpoint is the control it
protects, resolving the key from `remoteAddress` unless the peer is in `trusted-proxies` is
worth doing regardless.

### 8.7 The app shell shows the wrong tenant's brand ⚠️ MEDIUM (multi-tenant correctness)

`useTenantBrand()` (`frontend/lib/hooks/use-tenant-brand.ts:18-35`) resolves the brand from
`NEXT_PUBLIC_DEFAULT_TENANT_SLUG` — a **build-time** environment variable — not from the
signed-in user's `tenant_id`. Observed in a page snapshot: a Saffron Grill cashier's sidebar
reads **"Lume"** (the `test` tenant's brand) while the top bar correctly reads "Saffron Grill
HQ".

In a multi-tenant deployment every tenant sees whatever brand the deployment's default slug
points at, and one tenant's brand name is disclosed in another tenant's chrome. It also costs
an extra credential-bucket token per page load (§6.3a). Fix: resolve from the session's
`tenant_id`, not from `env`.

### 8.8 Transient 502/503 during service churn 🔧 ENVIRONMENT

`POST /api/v1/platform/auth/login` returned **502 UPSTREAM_ERROR** for ~40s while
`platform-admin-service:8096/actuator/health` returned **200** and the process was alive. The
cause was an auth-service restart (`auth-service.log`: `Started AuthServiceApplication in
15.279 seconds` at 06:30:26) — platform login delegates the password check to auth-service via
`AuthInternalClient`, and Eureka had not yet converged. This is the same shape as the open
"services wedge while /actuator/health still returns 200" item.

Harness response: `withTransientRetry` retries 429/502/503 six times with linear backoff
(~21s). **That is not enough to cover a cold start plus a 30s Eureka heartbeat** — a CI job
must wait for real readiness before starting the suite, not rely on retries. See §9.

---

### 8.9 The tenant dashboard fetches the branch menu for roles that cannot read it ⚠️ LOW

Surfaced by the observability guard another agent added mid-session (§4.1a). Loading
`/app/dashboard` as `accountant@saffron.local` fires
`GET /api/v1/pos/menu/items?branchId=…` **twice**, and both come back
`403 PERMISSION_DENIED`. ACCOUNTANT holds no `pos.menu` read permission, so the refusal is
correct — **the request is the defect.** `components/dashboard/tenant-dashboard.tsx` issues it
unconditionally rather than gating on the session's permissions, the way the sidebar already
does via `useNavItemVisible`.

Cost is small (two wasted round trips and two console errors per load) but it is the exact
pattern that makes a strict network guard unusable, and it will keep re-appearing as new roles
are added. Gate the query on `pos.menu.view` / `pos.order.view` the way the nav is gated.

## 9. Wiring it into CI

**No change is needed to the existing `e2e` job.** It runs `pnpm --dir frontend run e2e`, which
is now smoke-only — the same one test it could ever pass, minus the 15 that could never pass.
Recommend also dropping `continue-on-error: true` from `ci.yml:362`, since the job is now
honest and a red one means something.

The journeys job needs a full 16-service stack, which today's CI does not stand up. When it
does (`deploy/docker-compose.yml` + the seed), this is the shape:

```yaml
  e2e-journeys:
    name: E2E journeys (Playwright, live stack)
    needs: [build]
    runs-on: ubuntu-latest
    timeout-minutes: 40
    env:
      RATE_LIMIT_AUTH_PER_MIN: "5000"  # §6.3 — the suite is not a brute-force attempt
      E2E_WORKER_IP: "0"               # behind nginx the XFF trick correctly stops working
    steps:
      - uses: actions/checkout@v4
      - run: corepack enable
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: pnpm, cache-dependency-path: frontend/pnpm-lock.yaml }
      - run: pnpm --dir frontend install --frozen-lockfile
      - run: pnpm --dir frontend exec playwright install --with-deps chromium

      - name: Bring up the stack
        run: make -C deploy up        # or docker compose -f deploy/docker-compose.yml up -d

      # NOT a fixed sleep, and NOT reliant on the harness's own retries (§8.8):
      - name: Wait for real readiness
        run: |
          for i in $(seq 1 60); do
            code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
              http://localhost:8080/api/v1/platform/auth/login \
              -H 'Content-Type: application/json' \
              -d '{"email":"superadmin@softxlogic.com","password":"Test@123!"}')
            [ "$code" = "200" ] && exit 0
            sleep 5
          done
          echo "gateway never served a platform login"; exit 1

      - name: Seed (idempotent; verifies every persona itself)
        run: python3 scripts/seed_restaurantos.py

      - name: E2E typecheck
        run: pnpm --dir frontend run e2e:typecheck

      - name: Journeys
        run: pnpm --dir frontend run e2e:journeys

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: frontend/playwright-report/
```

Notes: the readiness gate probes the *actual first call the suite makes*, not
`/actuator/health` — §8.8 is exactly why. The seed is idempotent and its verify phase is the
acceptance gate for the environment, so running it unconditionally is correct.

---

## 10. Dependencies and open items

1. **`scripts/README-seed.md` — MISSING.** Promised by `seed_restaurantos.py:66-69`. When it
   lands it must reference `persona_password()` rather than restate a credential table.
2. **No CI environment stands up the stack.** Until `deploy/docker-compose.yml` runs in CI, the
   journeys project is a local/staging tool. This is the single biggest gap between "a harness
   exists" and "the UI is verified with no gaps".
3. **P1/P2 journeys are blocked on product work**, not on the harness — §5. Platform admin UI,
   user-admin UI, forced-password-change UI, and the POS waiter gate.
4. **Seed ↔ fixture drift** has no guard yet. `e2e/fixtures/personas.ts` mirrors
   `seed_restaurantos.py` by hand; a diff test would close it.
5. **`.seed-state/totp/` is machine-local and irreplaceable.** Losing it costs a
   `--phase personas --repair` run, not a disaster, but a fresh CI runner has no secrets and
   **must** run the seed (which enrols and writes them) before the journeys project.
6. Referenced but deliberately not re-researched here (parallel swarm owns them): FBR
   e-invoicing, thermal printing, biometric attendance, ERP module gaps, cross-module
   integration gaps, UI/UX visual direction, frontend component stack, tenant configurability,
   overall testing strategy. Where visual regression touches UI/UX direction (§7), that
   research is the authority on *what* the surfaces should look like; this document only says
   how to pin them.

---

## Appendix A — files created or changed

**Created**
```
frontend/e2e/fixtures/totp.ts
frontend/e2e/fixtures/personas.ts
frontend/e2e/fixtures/gateway.ts
frontend/e2e/fixtures/auth.fixture.ts
frontend/e2e/setup/auth.setup.ts
frontend/e2e/journeys/persona-access-matrix.spec.ts
frontend/e2e/journeys/step-up-totp.spec.ts
frontend/e2e/journeys/tenant-feature-gating.spec.ts
```

**Changed**
```
frontend/playwright.config.ts     rewritten — 4 projects, opt-in gates
frontend/package.json             +4 scripts; `e2e` scoped to --project=smoke
frontend/eslint.config.mjs        react-hooks/rules-of-hooks off for e2e/**
frontend/.gitignore               + /e2e/.auth/
frontend/e2e/smoke.spec.ts        → frontend/e2e/smoke/smoke.spec.ts (git mv, content unchanged)
```

**Untouched:** all 15 legacy specs, every service, the gateway, the seed script, `ci.yml`.

## Appendix B — running it

```bash
# prerequisites: dev stack up (gateway :8080), DB seeded, frontend dev server or none
python3 scripts/seed_restaurantos.py          # idempotent; verifies all 19 principals

cd frontend
pnpm e2e             # smoke only, no backend needed          → 1 test
pnpm e2e:setup       # mint 19 storage states + tenants.json  → 3 tests
pnpm e2e:journeys    # auth-setup + the browser suite         → 30 tests, ~22s
pnpm e2e:legacy      # the 15 pre-existing specs (demo tenant)
pnpm e2e:typecheck   # isolated e2e tsconfig

# knobs
E2E_GATEWAY_URL=…          default http://localhost:8080
PLAYWRIGHT_BASE_URL=…      default http://localhost:3000
E2E_WORKER_IP=0            disable per-worker XFF isolation (required behind nginx)
E2E_XFF_SALT=<0-249>       shift the worker IP range for concurrent runs on one host
E2E_LOGIN_INTERVAL_MS      default 550
E2E_TRANSIENT_ATTEMPTS     default 6
SEED_STATE_DIR             default <repo>/.seed-state
```
