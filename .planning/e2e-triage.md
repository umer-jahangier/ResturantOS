# E2E journey triage — dev.restaurantos.softxlogic.com

Produced 2026-08-22 from two full runs of `--project=journeys` against the live dev deployment.
Read-only: **no source, spec or fixture was modified.**

---

## 0. Read this first — the baseline was contaminated, and by how much

I ran the suite twice.

| run | command | result |
|---|---|---|
| **R1** (as briefed) | `--project=journeys` (default parallelism) | **48 failed · 35 passed · 1 skipped · 27 did not run** (111 total) |
| **R2** (authoritative) | `--project=journeys --workers=1` | **39 failed · 46 passed · 1 skipped · 25 did not run** (111 total) |

`auth-setup` was re-minted first and passed 3/3 both times.

**Nine R1 failures were the harness fighting itself, not the product.** The briefing's
`E2E_WORKER_IP=0` disables the per-worker `X-Forwarded-For` isolation that
`e2e/fixtures/auth.fixture.ts:59-67` exists to provide. The gateway's `/api/v1/auth/**` bucket is
`replenish 2/s, burst 100, keyed per source IP`, and **every page load spends two tokens**
(`SessionProvider` → `POST /auth/refresh`, `useTenantBrand` → `GET /auth/tenants/<id>`). With all
workers on one bucket the suite 429s itself; `auth.fixture.ts:47-56` says so verbatim, including
the remedy: *"For staging, set E2E_WORKER_IP=0 and raise RATE_LIMIT_AUTH_PER_MIN on that
environment instead."* **That has not been done on dev.**

Cleared purely by serialising (i.e. **not defects, do not work on these**):
`role-visibility-matrix` CASHIER/WAITER/KITCHEN_STAFF/ACCOUNTANT nav ×4 · `role-visibility-matrix`
CASHIER/KITCHEN_STAFF/ACCOUNTANT "is refused" ×3 · `responsive` "dialogs render as bottom sheets"
· `reduced-motion` "the POS terminal is still".

**It also produced a false green.** In R1, `role-visibility-matrix › OWNER is refused
/platform/dashboard` reported *"Expected to fail, but passed"* — which reads as "E2E-D2 is fixed,
retire the marker". It is not. Under R2 the OWNER **does** render `/platform/dashboard` and the
test fails-as-expected. The R1 "pass" was the 429 bouncing the owner to `/login`, which the
spec's `waitForURL(u => !u.startsWith('/platform'))` race scores as "redirected → refused". **Do
not retire E2E-D2.** Same for E2E-D6 (`tenant-admin-user-provisioning:148`) — it still
fails-as-expected under R2.

**Action for whoever owns the environment:** raise `RATE_LIMIT_AUTH_PER_MIN` on dev, or run the
suite with `--workers=1`. Until then every number from a parallel run is unusable.

### A fourth verdict was unavoidable

The brief allows (a) real-defect / (b) fixed-locally / (c) stale-test. Ten failures are none of
those: they are **deployment configuration or seed state on dev**, where both the deployed code
and the local code are correct and the test is right to complain. Forcing them into (a) would
send someone to edit source that has no bug. They are marked **(d) environment** and each one
names the knob.

### Verdict tally over the 39 authoritative (R2) failures

| verdict | count |
|---|---|
| **(c) stale-test** | 20 |
| **(d) environment / seed / infra** | 10 |
| **(a) real defect in deployed code** | 6 |
| **(b) fixed locally, pending deploy** | 3 |

---

## 1. The four items the brief flagged — answered

### 1.1 "the skip link must be the FIRST tab stop" ×4 → **(c) STALE TEST. The product is correct.**

I measured it directly on `/app/purchasing/purchase-orders` as `terrace.manager`:

```
A. fresh-load Tab                       -> A[skip-to-content]      ← correct
B. element at (2,2)                     =  DIV.flex items-center gap-2 border-b px-3 py-4
B. after body-click(2,2)+blur, Tab      -> BUTTON[Switch branch]   ← the failure
C. first focusable in DOM order         -> A[skip-to-content]      ← correct
```

The skip link **is** first in the DOM and **is** the first Tab stop for a real keyboard user.
`app/(tenant)/layout.tsx:177` renders `<SkipLink />` above `<Sidebar>` (and `:127` for the
operator shell); `origin/main` — what dev is running — has it at the same place. The
`persona-access-matrix` page snapshot confirms it live: the a11y tree opens with
`link "Skip to content"` *before* `complementary "Sidebar"`.

The defect is in the spec's own preamble, `accessibility.spec.ts:129-131`:

```ts
await page.locator("body").click({ position: { x: 2, y: 2 } });
await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
await page.keyboard.press("Tab");
```

Point (2,2) lands on the sidebar's brand row. Clicking a non-focusable element sets Chrome's
**sequential focus navigation starting point** to it, and `blur()` does not reset that. The next
Tab therefore resumes *after the sidebar*, skipping the skip link, which is earlier in the DOM.
The spec's own header says this file **has never been run**; this is its first result.

The same preamble is inside `tabsToMain()` (`accessibility.spec.ts:88-90`), so the headline
"tabs to `<main>`" number is measured the same broken way. Both need the click dropped (or moved
to a point below all chrome, or replaced with a fresh `goto`).

`data-testid="skip-to-content"` and the assertion itself are correct and must be kept.

### 1.2 `unexpected value "inactive"` ×5 → not a status enum. Playwright's own wording.

`Received: inactive` is what `expect(locator).toBeFocused()` prints when the element is not
`document.activeElement`. Four of the five are §1.1. The fifth is
`command-palette.spec.ts:50` (§3.6) — a genuine focus-restoration finding.

### 1.3 role-visibility-matrix, 9 failures → **not a permission regression.**

Serialised, 8 of the 9 pass. Only two remain, and neither is over-granting:

* `OWNER sees exactly its permitted navigation` → leaked `["General", "Users"]`. **(c).**
  `e2e/fixtures/nav-matrix.ts:64-68` still lists `General` and `Users` in `NEVER_VISIBLE` as
  *"comingSoon — no page"*. Plan 19-01 built both pages and removed `comingSoon`:
  `components/shared/sidebar-nav-items.ts:513-524` ("*the page now exists
  (`app/(tenant)/app/settings/page.tsx`), so `comingSoon` is gone*") and `:558-566`
  ("*the href moves off the never-built `/app/settings/users` … and `comingSoon` is gone*").
  Both are gated: General on `rbac.manage|branch.manage`, Users on `rbac.manage|rbac.user.manage`
  — the exact expressions the backend `@PreAuthorize`s. An OWNER holding `rbac.manage` **should**
  see them. The matrix is stale; the product is right.
* `OWNER is refused /platform/dashboard` → **expected-failure, E2E-D2 still reproduces.** Leave
  the `test.fail()` marker (§0).

"*the gating pass never completed for OWNER: its anchor nav item POS never…*" appeared 3× in R1
and **zero times in R2** — it was the 429 bounce, exactly as the message's own last line
suggests.

Separately worth a downstream ticket: `nav-matrix.ts`'s docblock says *"TENANT IS FIXED TO
SAFFRON"* and quotes permission counts read from saffron, but the spec runs
`const TENANT = "terrace"`. The matrix's evidence and its subject no longer match.

### 1.4 "the portalled overlay must carry data-slot" → **(c) STALE TEST.**

`data-slot="dialog-overlay"` is present and correct — `components/ui/dialog.tsx:52`, identical in
`origin/main`. The overlay is absent because **there is no command palette on `/app/pos`**:
`CommandPalette` is mounted only by `components/shared/top-bar.tsx:540`, and the operator shell
removes `<TopBar>` from the DOM entirely (`app/(tenant)/layout.tsx:107-146` — "*no 255px sidebar,
no breadcrumb, **no global search**, no notification bell*"). UI-SPEC §4.1 says that is
deliberate. The spec's own comment at `operational-zone-containment.spec.ts:229-231` — "*the
palette is reachable unconditionally on the POS route*" — was written before the operator shell
and is now false. The test needs a different portal on the POS route (the void/refund dialog, or
the till panel), not a `data-slot` fix.

---

## 2. THE TRIAGE TABLE — all 39 authoritative failures

Ordered by root cause so a fix clears a block at a time.

### Block A · the dashboard `<h1>` was rewritten (8 failures) — **(c) stale-test**

The dashboard `<h1>` is `preset.question`, never the literal "Dashboard".
`components/dashboard/dashboard-shell.tsx:133-135` renders `{preset.question}`; `origin/main`'s
line 37 does the same. Live proof from the OWNER snapshot:
`heading "Is the business healthy?" [level=1]` (`presets.ts:215`). KITCHEN_STAFF's is
`"What needs me in the next five minutes?"` (`presets.ts:299`), not `"Kitchen"`.
Stable hooks that **do** exist: `data-testid="dashboard"`, `data-preset`, `data-testid="dashboard-dateline"`.

| spec · test | error | verdict | evidence |
|---|---|---|---|
| `persona-access-matrix:32` × 6 (owner, manager, cashier, waiter, kitchen, accountant) | `getByRole('heading',{name:'Dashboard'\|'Kitchen',level:1})` — element(s) not found | **(c)** | `dashboard-shell.tsx:133`; snapshot `test-results/persona-access-matrix-pers-4c3f7-…/error-context.md` |
| `accessibility-smoke:86 › axe: dashboard` | same locator, 30s | **(c)** | same. Note: the axe scan itself **never ran** — this file has produced no accessibility measurement for the dashboard yet |
| `known-defects:20 › E2E-D1 · ACCOUNTANT's dashboard still 403s` | same locator, 20s | **(c)** — and **E2E-D1's status is now UNKNOWN**, not fixed: the 403 assertion is downstream of the h1 wait and never executed. Repair the locator before drawing any conclusion about the defect | `known-defects.spec.ts:36` |

### Block B · the accessibility spec's Tab preamble (4 failures) — **(c) stale-test**

| spec · test | error | verdict | evidence |
|---|---|---|---|
| `accessibility:111 › skip link and landmarks: purchase orders / stock / dashboard / POS terminal` | "the skip link must be the FIRST tab stop… Received: inactive" | **(c)** | §1.1 — live measurement + `app/(tenant)/layout.tsx:177`; probe output above |

### Block C · WebSocket upgrade is broken at the dev edge (3 failures) — **(d) environment / infra**

The console error is **not** E2E-D4. E2E-D4 is a 401 caused by
`WS_UPGRADE_PATHS` missing `/api/v1/pos/ws/` (`known-defects.ts:118-128`). What dev emits is:

```
Error during WebSocket handshake: 'Connection' header value must contain 'Upgrade'
```

…on **both** `wss://…/api/v1/kitchen/kds/{branch}/BAR` and `wss://…/api/v1/pos/ws/orders/{branch}`.
`/api/v1/kitchen/` **is** in `WS_UPGRADE_PATHS`, so this is a different, broader fault: the
reverse proxy in front of dev is not forwarding `Upgrade`/`Connection`. **Every** live socket in
the product — KDS board, POS order sync, realtime dashboard — is down on dev. Fix in
`deploy/nginx` / the ingress (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).

| spec · test | error | verdict |
|---|---|---|
| `operational-latency:224 › a KDS station board runs no animation and carries no filter` | 2 console errors, KDS WS handshake | **(d)** — the zone assertions never ran |
| `reduced-motion:269 › a KDS station board still does not animate` | same | **(d)** |
| `responsive:110 › pos adapts at 390/768/1024/1440` | 2 console errors (POS WS) **+ 2 × `403 GET /api/v1/pos/tills?status=OPEN`** | **(d)** for the WS. The 403 is **(c)**: correct behaviour for a WAITER, already declared in `operational-zone-containment.spec.ts:194-198` (`obs.expect403(/\/api\/v1\/pos\/tills/, …)`) and simply missing here. Neither viewport assertion ran |

### Block D · `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` is set on dev (2 failures) — **(d) environment, and the highest-severity finding here**

`app/(auth)/login/page.tsx:24-27` falls back to `process.env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG`
when the host carries no tenant. Dev has it set to `floating-terrace` — confirmed by
`curl https://dev.restaurantos.softxlogic.com/login`, which serves
`data-testid="tenant-slug"` pre-filled with `floating-terrace`.

**This breaks SuperAdmin sign-in in the product, not just in the test.** The console error
context shows the form submitting `tenantSlug=floating-terrace` for a *platform* account and the
server answering **"Sign-in failed — Invalid email or password."**

| spec · test | error | verdict | evidence |
|---|---|---|---|
| `unified-login:49 › A · /login is not rewritten to a default tenant` | `getByTestId('tenant-slug')` expected hidden, got visible, value `floating-terrace` | **(d)** | `app/(auth)/login/page.tsx:24-27`; live curl |
| `superadmin-console:82 › A · the console has navigation and lists real tenants` | `waitForURL(/\/platform\//)` 25s timeout | **(d)** | `test-results/superadmin-console-…/error-context.md`: alert *"Sign-in failed / Invalid email or password"* with Restaurant identifier = `floating-terrace` |

Unset `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` on dev. That also unblocks the 5 `superadmin-console`
and 4 `unified-login` tests currently in "did not run" (§4).

### Block E · responsive / viewport integrity (6 failures)

Note the probe (`e2e/viewport-integrity.mjs`) and the spec are both **locally modified**, so these
are the *new* probe measuring the *deployed* UI.

| spec · test | error | verdict | evidence |
|---|---|---|---|
| `responsive:110 › inventory-stock @390` | 1 escapee: `div 392×32 @40,315` | **(a) REAL** | Live probe: the box is `PageHeader`'s actions slot, `<div class="flex shrink-0 items-center gap-(--space-sm)">` wrapping `<div class="flex flex-wrap …">` with 4 buttons. `shrink-0` on the outer div means the inner `flex-wrap` never gets a chance to wrap, so a 4-button row spills to `right: 432` in a 390 viewport. **`components/ui/page-header.tsx:87` — byte-identical in `origin/main:76`, so the local redo does NOT fix it.** |
| `responsive:110 › purchasing-po @390` | 2 undersized: `button{dialog-trigger} "New Purchase Order" 169×32`, `select 185×32` | **(b) FIXED LOCALLY** | `.touch-floor { min-height:44px; min-width:44px }` at `app/globals.css:1271-1281` (0 occurrences in `origin/main`'s globals.css) and applied in `components/ui/button.tsx` and `components/ui/select.tsx`. Verify after deploy; do not fix twice |
| `responsive:110 › finance-takings @390` | 1 undersized: `input[takings-date] 160×32` | **(a) REAL** | This is a hand-rolled `<input type="date">`, not the `Input` component, so `touch-floor` never reaches it. Local raises it only to `min-h-9` = **36px** — `components/finance/DailyTakings.tsx:113` — still under 44. `origin/main`'s line 103 has no height at all. Needs `touch-floor` or `min-h-11` |
| `responsive:110 › kds @390` | 1 undersized: `a "Back to dashboard" 167×38` | **(c) STALE — the test measures a 404 page** | `ROUTES` declares `{ name:"kds", path:"/app/kds" }` (`responsive.spec.ts:83`). `/app/kds` does not exist — the route is `/app/kitchen` (`ls app/(tenant)/app/` has `kitchen`, no `kds`; the sidebar's "Kitchen Display" points at `/app/kitchen`). "Back to dashboard" exists only in `app/not-found.tsx:31` and `components/shared/access-denied.tsx:26`. `ready: "main"` is satisfied by the 404 page's `<main>` — the exact vacuous-gate shape this spec's own docblock warns about. Fix the path **and** give it a real anchor |
| `responsive:110 › dashboard @390` | 1 occluded: `a[portlet-owner-sales-trend] 358×286 @16,855` | **(c) probe artifact** | Live probe: `elementFromPoint` at the portlet's visible sliver returns `NAV.fixed bottom-0 inset-x-0 z-40 flex h-16` — `MobileBottomNav`. Anything sitting in the bottom 64px at the current scroll offset scores as "fully covered". `<main>` carries `pb-20` (`app/(tenant)/layout.tsx:213`) precisely so it can be scrolled clear, so it is reachable. Scroll into view before sampling, or exclude the `md:hidden` fixed nav — it is chrome, not a page control. Also position-dependent, hence flaky |
| `responsive:110 › pos` | see Block C | **(d)/(c)** | |

### Block F · command palette (3 failures)

| spec · test | error | verdict | evidence |
|---|---|---|---|
| `accessibility:293 › every dialog is modal to assistive tech` | `getByTestId('command-palette-input')` never attached, 15s | **(c)** | `accessibility.spec.ts:296-300` does `goto(…, {waitUntil:"domcontentloaded"})` then presses `ControlOrMeta+k` **immediately**. The shortcut is a client `document` keydown listener registered in an effect (`components/ui/command-palette.tsx:133-143`); a press before hydration is simply lost, and no timeout recovers it. Positive control: `command-palette.spec.ts:34` presses the same chord *after* waiting for the trigger and the palette opens (that test fails later, at line 50). Add a readiness wait |
| `command-palette:34 › ⌘K opens a modal dialog and Escape returns focus to the trigger` | `expect(trigger).toBeFocused()` → `inactive` | **(a) REAL** (medium confidence) | The dialog opened and Escape closed it — lines 44-49 passed — so only focus restoration fails. `components/shared/top-bar.tsx:446-460` and `command-palette.tsx:144-160` are functionally identical to `origin/main` (only Tailwind classes differ), so the local redo does **not** fix it. Likely needs an explicit `onCloseAutoFocus` restoring a trigger ref, because the palette is opened by a global handler rather than a `DialogTrigger`. Confirm by reading `document.activeElement` after Escape before writing the fix |
| `command-palette:66 › a seeded order is findable by its number` | 30s timeout on `getByRole('tab',{name:'Order Management'})` | **(c)** | The POS section switcher renders **buttons**, not ARIA tabs — `operational-zone-containment.spec.ts:216` uses `getByRole("button",{ name:"POS Terminal", exact:true })` on the same screen and passes. Labels are correct (`app/(tenant)/app/pos/page.tsx:21,23`); the role is not |

### Block G · specs whose fixtures point at the wrong thing (5 failures) — **(c) stale-test**

| spec · test | error | verdict | evidence |
|---|---|---|---|
| `finance-guide:109 › B · the open-till rule` | `connect ECONNREFUSED ::1:8080` → `POST http://localhost:8080/api/v1/auth/login` | **(c)** | `finance-guide.spec.ts:19` reads `process.env.GATEWAY_URL`. Every other spec and `e2e/fixtures/gateway.ts:19` read **`E2E_GATEWAY_URL`**. One-word fix; nothing to do with the product |
| `pos-waiter-to-kitchen:31 › the full loop, across two personas` | `GET /api/v1/kitchen/tickets?status=ACTIVE` → **404** | **(c)** | The endpoint is `/api/v1/kitchen/**kds**/tickets` — `lib/repositories/kds.repository.ts:48`. The *bump* earlier in the same test (which uses the real path) succeeded; only this hand-written verification URL is wrong. **Not a kitchen-service defect** |
| `tenant-feature-gating:33 › gateway: FEATURE_CRM off for Zaitoon, on for Saffron` | expected 403, got 200 | **(c)** | `tenant-feature-gating.spec.ts:27-28`: `const SAFFRON_MANAGER = persona("terrace","manager"); const ZAITOON_MANAGER = persona("terrace","manager");` — **the same persona on the same tenant**. Terrace has CRM on, so the "denied" call is correctly 200. A tenant-key rewrite flattened both arms (the sibling test at `:55` loops `["terrace","terrace"]` for the same reason). The test can prove nothing until it uses two different tenants |
| `tenant-feature-gating:72 › nav: the Customers entry follows the tenant's entitlement` | strict-mode violation: `link name:'POS'` → 2 elements (`/app/pos`, `/app/terminals` "POS Terminals") | **(c)** | Non-exact `getByRole` name matching plus the `POS Terminals` nav item added later (`sidebar-nav-items.ts:285`). Needs `exact: true` — the sibling specs already do it |
| `tenant-admin-user-provisioning:183 › after the change the user signs in and sees only WAITER navigation` | nav link `POS` never visible; snapshot shows the **login page** | **(c)** | `tenant-admin-user-provisioning.spec.ts:259-268` hardcodes the session marker cookie as `domain: "localhost", secure: false`. Against `dev.restaurantos.softxlogic.com` that cookie is never sent, so `proxy.ts` bounces to `/login`. Same class as local commit `1dbfae3f` ("*the session marker cookie was hardcoded to localhost, so no remote run could authenticate*"), which fixed `auth.setup.ts` but not this spec. Derive domain from `PLAYWRIGHT_BASE_URL` |

### Block H · state-distinguishability (1 failure) — **(c) stale-test**

| spec · test | error | verdict | evidence |
|---|---|---|---|
| `state-distinguishability:303 › vendors list · … with motion available` | strict-mode violation: `text=Forced Vendor A` → 2 elements (`getByLabel('Vendors').getByText(…)` and `getByTestId('data-grid-cards').getByText(…)`) | **(c)** | By design: `DataGrid` keeps **both** the table and the card fallback in the DOM and lets CSS choose — stated in `responsive.spec.ts:138-141` ("*DataGrid keeps both branches in the DOM and lets CSS choose*"). The anchor needs `.first()` or a visibility filter. (In R1 this failed earlier, on `[data-testid="query-error"]`; under R2 the forced-failure branch resolved and it got to the empty branch. Treat the R1 message as parallel-run noise) |

### Block I · seed / backend state on dev (4 failures)

| spec · test | error | verdict | evidence |
|---|---|---|---|
| `known-defects:61 › E2E-D5 · purging a non-CANCELLED tenant` | "Saffron Grill is not ACTIVE — run the seed script" | **(d)** | The precondition tenant is absent/not ACTIVE on dev. The test's own message names the remedy. E2E-D5's status stays unknown |
| `finance-daily-takings:43 › A · Finance lands on Takings` | `figure-tile-gross-sales` — element(s) not found | **(d)** *and* a latent **(c)** | The `takings-date` assertion one line earlier passed, so the screen rendered; the tiles are inside `TakingsBody`, which `QueryBoundary` only mounts when the day is non-empty (`DailyTakings.tsx:126-137`). The seeded day `2026-08-06` (`finance-daily-takings.spec.ts:28`) has no trading on dev. **Separately, line 64 is wrong and will fail even with data:** it asserts `figure-tile-net-sales` contains `Rs 38,732.40` while line 63 asserts gross is `Rs 33,390.00` — net > gross is impossible under the identity the page prints ("*Gross sales − discounts = net sales*", `DailyTakings.tsx:198`). `38,732.40` is **total billed**. This assertion encodes the exact pre-F5 bug the code comment at `DailyTakings.tsx:190-196` records ("*one tile carrying the bill total under the word 'net' … an accountant reading it over-stated revenue by the whole output-tax line*"). Retarget to `figure-tile-total-billed` |
| `pos-receipt-print:93 › the receipt route … with no printer attached` | `window.print` calls expected 1, got 0 | **(d)** | The test's premise is false on dev. Snapshot: *"Printing on counter-1… Umer MacBook — POS80 is connected and collecting this bill now."* `components/print/receipt-view.tsx:157-163` auto-prints **only** when `routedToPrinter === false`; a routed printer correctly suppresses the dialog. Identical in `origin/main`. Either force `NO_PRINTER` in the test or remove the printer/agent from the dev branch |
| `superadmin-tenant-lifecycle:43 › creates a tenant, then changes its tier` | `DELETE /api/v1/platform/tenants/{id}` → **405**, expected one of `[200,202,204,404]` | **(a) REAL, backend** | The CANCEL immediately before succeeded, so auth and routing are fine; the purge verb is not routed. Owned by `services/platform-admin-service` — **out of scope for this worktree**; raise it with whoever owns `services/`. Impact is bounded (orphan probe tenants accumulate; run-unique names keep later runs working) |

### Block J · step-up TOTP (1 failure) — **(c) stale-test**

| spec · test | error | verdict | evidence |
|---|---|---|---|
| `step-up-totp:46 › A · owner signs in through the form with a live code` | `getByLabel('Authenticator code')` not found, 15s | **(c)**, two independent causes | (1) The field's label is **"Authenticator or recovery code"** — `components/auth/login-form.tsx:704`, and `origin/main:600` identically. `getByLabel` matches substrings, and `"Authenticator code"` is not a substring of `"Authenticator or recovery code"`, so this locator can never match. The earlier `toHaveCount(0)` on line 65 therefore passed vacuously. (2) The error-context snapshot shows the owner landing in the **app shell**, i.e. no TOTP challenge was issued at all — `owner@terrace.local` is not step-up-enrolled on dev, which is **(d)** on top. Fix the label first; then decide whether dev needs the enrolment |

### Block K · POS accessibility (1 failure) — **(a) real defect**

| spec · test | error | verdict | evidence |
|---|---|---|---|
| `accessibility-smoke:86 › axe: POS terminal` | 1 serious `color-contrast` on `span[data-testid="pos-live-indicator"][data-connection-state="polling"]` | **(a) REAL, not fixed locally** | `components/pos/pos-connection-badge.tsx:77` renders `text-warning` on the POS surface. The file is **byte-identical** between the worktree and `origin/main` (diffed in full), so the premium redo does not touch it. Note the badge is stuck on `polling` because of Block C — fixing the WS moves it to `live` (`text-success`) and may hide, not fix, the contrast bug. Fix the `--warning` foreground pairing on `--surface-*`, and keep the assertion |

---

## 3. Consolidated fix list, by owner

**Environment (blocks the most, costs the least):**
1. Raise `RATE_LIMIT_AUTH_PER_MIN` on dev, or mandate `--workers=1`. (§0)
2. Unset `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` on dev — it breaks SuperAdmin login for real users. (Block D)
3. Forward `Upgrade`/`Connection` at the dev reverse proxy — every WebSocket in the product is down. (Block C)
4. Re-seed: the `2026-08-06` takings day, `Saffron Grill` ACTIVE, owner TOTP enrolment; and remove the `counter-1` printer from the receipt branch or make the receipt spec force `NO_PRINTER`. (Blocks I, J)

**Real defects in this worktree — 3 to fix here:**
5. `components/ui/page-header.tsx:87` — drop `shrink-0` (or let the inner row wrap) so the actions slot does not spill at 390. (Block E)
6. `components/finance/DailyTakings.tsx:113` — the date input is 36px; give it `touch-floor`. (Block E)
7. `components/pos/pos-connection-badge.tsx:77` — `text-warning` fails contrast on the POS surface. (Block K)
8. `command-palette` focus restoration on Escape — confirm `document.activeElement` first. (Block F)

**Already fixed locally — verify after deploy, do not touch:**
9. `touch-floor` on `Button`/`Select` clears `purchasing-po @390`. (Block E)

**Test repairs (20 failures, no product change):**
10. Dashboard `h1` → `preset.question` / `data-testid="dashboard"` (8 tests, 3 specs).
11. Drop the `body.click({x:2,y:2})` preamble in `accessibility.spec.ts` (assertion **and** `tabsToMain`).
12. `nav-matrix.ts` `NEVER_VISIBLE`: remove `General`, `Users`.
13. `responsive.spec.ts` `kds` route → `/app/kitchen` + a real anchor; declare the WAITER till 403 on `pos`; scroll-into-view before the occlusion sample.
14. `finance-guide.spec.ts:19` `GATEWAY_URL` → `E2E_GATEWAY_URL`.
15. `pos-waiter-to-kitchen.spec.ts:200` → `/api/v1/kitchen/kds/tickets`.
16. `tenant-feature-gating.spec.ts:27-28` → two real tenants; `:88` → `exact: true`.
17. `tenant-admin-user-provisioning.spec.ts:259-268` → cookie domain from `PLAYWRIGHT_BASE_URL`.
18. `state-distinguishability.spec.ts` anchors → `.first()`.
19. `command-palette` — wait for readiness before `⌘K`; POS switcher is `button`, not `tab`.
20. `operational-zone-containment.spec.ts:229+` — the palette is gone from `/app/pos` by design; pick another portal.
21. `step-up-totp.spec.ts:65,67` → `"Authenticator or recovery code"`.
22. `finance-daily-takings.spec.ts:64` → `figure-tile-total-billed`.

No `data-testid` is removed and no assertion is weakened anywhere in this list.

---

## 4. The 25 that never ran

All are downstream of a `test.describe.configure({ mode: "serial" })` whose first case failed —
fixing the head of each block unblocks the tail. This is where most of the remaining coverage is.

* `superadmin-console` B–F (5) — blocked by Block D
* `unified-login` B–E (4) — blocked by Block D
* `state-distinguishability` (4) — blocked by Block H
* `step-up-totp` A2, B/C, D (3) — blocked by Block J
* `operational-zone-containment` KDS board + both positive controls (3) — blocked by §1.4.
  **Note: the two positive controls have therefore never run, so the whole containment gate is
  currently unproven in either direction.**
* `finance-daily-takings` B, C (2) — blocked by Block I
* `superadmin-tenant-lifecycle` module-toggle + E2E-D3 (2) — blocked by Block I
* `finance-guide` C (1), `pos-waiter-to-kitchen` "a WAITER cannot open a till" (1),
  `accessibility` "one announcement per async result" (1)

Plus 1 genuinely skipped test.

---

## 5. What was run, verbatim

```
export PLAYWRIGHT_BASE_URL=https://dev.restaurantos.softxlogic.com \
  E2E_GATEWAY_URL=https://dev.restaurantos.softxlogic.com \
  SEED_STATE_DIR=/Users/muhammadumer/Documents/Projects/ResturantOS/.seed-state \
  E2E_STACK=1 E2E_WORKER_IP=0

npx playwright test --project=auth-setup --reporter=line   # 3 passed
npx playwright test --project=journeys --reporter=list      > /tmp/triage.txt        2>&1  # exit 1
npx playwright test --project=journeys --workers=1 --reporter=list \
                                                            > /tmp/triage-serial.txt 2>&1  # exit 1
```

Exit codes captured without a pipe. Outcomes counted from the summary block **and** by counting
`✘` markers: R1 summary "48 failed" vs 48 `✘`; R2 summary "39 failed" vs 41 `✘` — the two extra
`✘` are the `test.fail()` cases that failed **as expected** (E2E-D2, E2E-D6) and are correctly
counted as passes. Deployed build confirmed to be `origin/main`, not the local premium redo:
the live sidebar link class is `rounded-md px-3 py-2 text-sm …` (bare Tailwind sizes) where the
worktree uses type roles, and `app/globals.css` on dev has no `.touch-floor`.
