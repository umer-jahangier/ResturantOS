# 15c-01 — Browser E2E harness: SUMMARY

**Status:** delivered and **executed against the live stack**.
**Reference run:** 2026-08-07, branch `phase-13-access-repair`, local dev stack.
**Command:** `E2E_STACK=1 pnpm --dir frontend exec playwright test --project=journeys --workers=3`

```
56 tests    50 passed    5 failed    1 did not run    45.0s
```

Every number on this page is the output of a command run in the state being reported.

---

## 1. What was built

| Artifact | Purpose |
|---|---|
| `e2e/fixtures/observability.ts` | Console-error + failed-request guard, auto-attached to every page |
| `e2e/fixtures/known-defects.ts` | Registry of found-but-unfixed product defects, with evidence |
| `e2e/fixtures/nav-matrix.ts` | Independent role→visibility specification (hand-written from live tokens) |
| `e2e/fixtures/isolation.ts` | Per-run ids + `withRestored` for mutated seeded data |
| `e2e/journeys/role-visibility-matrix.spec.ts` | **6 personas × (nav present + nav absent + forbidden route)** |
| `e2e/journeys/superadmin-tenant-lifecycle.spec.ts` | Create tenant → change tier → toggle module → module vanishes for that tenant's user |
| `e2e/journeys/tenant-admin-user-provisioning.spec.ts` | Create user → assign role → forced change → scoped nav |
| `e2e/journeys/pos-waiter-to-kitchen.spec.ts` | Waiter fires an order; kitchen bumps it |
| `e2e/journeys/accessibility-smoke.spec.ts` | axe-core on 3 screens, reported by severity |
| `e2e/journeys/known-defects.spec.ts` | Pins each known defect so a FIX turns the suite red |
| `scripts/e2e/browser-e2e.sh` | The single runner, with an environment preflight |
| `.github/workflows/ci.yml` → `browser-e2e` | `needs: [lint]`; typecheck + lint + smoke; full suite opt-in |

Existing chain untouched: `lint → test → build → schema-sync/e2e/deploy-prod` all still
declare the same `needs`. Harness typechecks (`e2e:typecheck`), lints and is Prettier-clean.

**Runner:** `pnpm --dir frontend run e2e:all` (or `bash scripts/e2e/browser-e2e.sh`).

---

## 2. Application defects found

All seven were found by driving the product, not by reading it. **None was worked around by
adjusting a test to pass.** Each is registered with impact + evidence and pinned.

### 🔴 E2E-D2 — `/platform/**` is authenticated but not authorized

Any signed-in tenant user — verified with OWNER, WAITER **and KITCHEN_STAFF (2 permissions)** —
renders the SuperAdmin shell at `/platform/dashboard`.

*Precisely:* **no tenant data is exposed today.** The gateway does refuse
`/api/v1/platform/**` for a tenant token (Phase 13 SC1 asserts it), and the page currently
there is a nine-line placeholder that fetches nothing. The finding is that the **route group
has no authorization layer at all**: `proxy.ts:53-61` checks only for the `has_session`
cookie (and its own comment says it is not a security boundary), and
`app/(platform)/layout.tsx` has no guard. The moment a real control-plane page lands there,
it renders for every tenant user.
**Remedy:** guard the `(platform)` layout on a platform-typed token; redirect tenant sessions.

### 🔴 E2E-D4 — the POS live-orders WebSocket is refused for *every* user

POS real-time order sync **never connects**. Measured: 4 failed handshakes in the first 10s of
one `/app/pos` load, each a console error, reproduced with a CASHIER holding an open till and
all 14 POS permissions — so it is not permission-dependent. The terminal silently falls back
to polling.

*Root cause, exactly:* `JwtGlobalFilter.java:112-118` allows the `?token=` query parameter
only for `/api/v1/reporting/dashboard/` and `/api/v1/kitchen/`. The POS socket is
`/api/v1/pos/ws/orders/{branchId}`, so the upgrade falls through to the `Authorization`-header
branch — which a browser's native WebSocket API cannot set, which is why the query-param
fallback exists. The **frontend is correct**; it does send `?token=`.
**Remedy:** add `/api/v1/pos/ws/` to `WS_UPGRADE_PATHS`.
*Note: the prior harness author observed the symptom ("degrades to Polling — reconnecting and
never settles") and worked around it without diagnosing it.*

### 🔴 E2E-D6 — a new user cannot complete its first sign-in in the browser

Every user created by a tenant admin gets a temporary password with `must_change_password`.
The server correctly refuses first login with `403 PASSWORD_CHANGE_REQUIRED` and issues a
single-use `changeToken`. **Nothing in the frontend consumes it.** `login-form.tsx:94-132`
handles TOTP, enrollment, lockout and 401, then falls through to *"Something went wrong.
Please try again."* A repo-wide search for `PASSWORD_CHANGE_REQUIRED` or `change-password`
outside `e2e/` returns **zero** frontend matches; there is no change-password route or page.

This is why it stayed invisible: the seed script proves the **API** works — and it does.
**Remedy:** branch on the 403, carry the token to a `/change-password` screen, POST to the
existing endpoint.

### 🟠 E2E-D1 — the ACCOUNTANT dashboard 403s on its own landing page

Reproduced on all three tenants. A live ACCOUNTANT token carries 24 permissions whose only
`pos.*` entry is `pos.order.view`. `tenant-dashboard.tsx:282-291` branches on that permission
alone, routing ACCOUNTANT into `OperationsDashboard`, which calls `useMenuItems()` and
`useTables()` unconditionally → `GET /api/v1/pos/menu/items` → **403, twice** (React Query
retries). The menu-derived stat renders as if the menu were empty — a wrong number, not an
absent one.

### 🟠 E2E-D7 — WCAG AA contrast failures on two of three main screens

axe-core, `wcag2a/2aa/21a/21aa`:

| Screen | critical | serious | verdict |
|---|---|---|---|
| `/app/dashboard` | 0 | 0 | **clean** |
| `/app/pos` | 0 | **1** (`color-contrast`, 3 nodes) | fails |
| `/app/reports` | 0 | **1** (`color-contrast`, 3 nodes) | fails |

### 🟡 E2E-D5 — a lifecycle precondition returns 500, not 409

`DELETE /api/v1/platform/tenants/{id}` on a non-CANCELLED tenant → `500 INTERNAL_ERROR`
/ *"An unexpected error occurred"*. The precondition is **correct** (cancel must precede
purge) but the caller is told nothing, so wrong-order calls are indistinguishable from a
broken server in logs and alerting. `TenantLifecycleService.purge` throws
`IllegalStateException`, which the shared handler does not map (it maps
`IllegalArgumentException` → 400).
**Remedy:** map to 409 with the required status in the message.

### 🟡 E2E-D3 — the SuperAdmin tenant-management UI does not exist

`platformNavItems` advertises `/platform/tenants`; nothing implements it (dead link).
`app/(platform)/` contains only a layout and a placeholder. There is **no UI at any URL** for
creating a tenant, changing a tier, or toggling a module.

---

## 3. Findings that are NOT product defects

**Duplicate "Sign in" accessible name on `/login`.** `getByRole('button', {name:'Sign in'})`
now resolves to **2 elements** — a strict-mode violation that broke a previously passing test.
Two controls sharing one accessible name is a genuine a11y/UX problem, but this is **in-flight
work by a concurrent agent** (email-first login) and is reported rather than pinned.

**Environment (not defects, and not test failures):**
- **auth-service lost its Eureka lease** after a concurrent build replaced its jar under the
  running JVM (`NoClassDefFoundError` → dead heartbeat → eviction). Health stayed 200; the
  gateway 503'd every auth route. Restarted; recovered in ~90s.
- **platform-admin-service** 503'd through the gateway for ~2 minutes after a concurrent
  restart while the LB cache expired.
- One `auth-setup` timeout at Playwright's 30s default. Fixed properly: the project now has a
  180s budget, with the arithmetic documented — **the pacing that keeps 19 logins under the
  rate limit was not removed to fit.**

---

## 4. The 5 failing tests, and what each means

| Failing test | Cause | Class |
|---|---|---|
| `axe: POS terminal` | 1 serious contrast violation | **product** (E2E-D7) |
| `axe: reports browser` | 1 serious contrast violation | **product** (E2E-D7) |
| `unauthenticated browser never sees the app shell` | 2 buttons named "Sign in" | **product, in-flight** |
| `E2E-D3 pin` | guard counted the asserted 404 as unexpected | **harness** — fixed in this commit |
| `waiter fires an order, kitchen bumps it` | see below | **harness, incomplete** |

**The POS→KDS journey is the one genuinely unfinished item.** It now proves: the waiter's
click creates and fires a real order; pos-service reports `SENT_TO_KDS`; and a kitchen ticket
**for that order id** arrives (polled — it is eventually consistent over RabbitMQ). It fails at
the last step, selecting the per-item advance control on the board. Three harness bugs were
found and fixed getting this far (a missing `branchId` query param; the KDS endpoint returning
a **bare** `{content:[...]}` rather than the `{data,...}` envelope every other endpoint uses;
`/app/kitchen` being the station picker while the columns live at `/app/kitchen/{stationCode}`).
**No product defect is implied by this failure** — it is an incomplete test.

---

## 5. What is proved, and what is not

**Proved, in a browser, against the real stack:**
- All 18 seeded personas reach the app shell with a genuinely rehydrated session.
- **All six roles see exactly their permitted navigation** — asserted item-by-item in both
  directions, so over-granting fails the suite, not just under-granting.
- Five of six roles are correctly **refused** a forbidden route; the sixth is E2E-D2.
- A SuperAdmin module toggle **removes the item from that tenant's user's sidebar** and the
  gateway then refuses the route `FEATURE_DISABLED` — both layers, which fail separately.
- A created user gets a real role, is forced to change its password, and afterwards sees a
  WAITER's app and nothing more.
- Tier changes persist and are read back.
- TOTP step-up works in the form, and `totp_verified` is dropped at refresh by design.

**Not proved:**
- The KDS bump (above).
- The cashier till/settlement journey — **not written**; time was spent diagnosing E2E-D2/D4/D6
  and two environment outages. The RBAC half is covered (`a WAITER cannot open a till` passes).
- The manager report-renders-non-empty journey — **not written**.
- Anything against the new `floating-terrace` seed. The suite currently targets the
  saffron/zaitoon/marina personas, which were live and passing throughout this run. Migration
  is a `personas.ts` + `nav-matrix.ts` change plus re-measuring six permission sets.
- No load, concurrency or performance claim.
