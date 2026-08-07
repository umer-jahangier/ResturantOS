# Role visibility audit — what each role SEES vs. what it may DO

**Date:** 2026-08-07 · **Tenant:** `floating-terrace` (ENTERPRISE, all 20 feature flags ON)
**Method:** logged in through the real UI at <http://localhost:3000> as all eight personas, scraped
the rendered sidebar from the DOM, then probed the gateway at <http://localhost:8080> with each
role's own JWT. Every row below is an observed status code, a DOM read, or a file:line — not an
impression.

Because the tenant is ENTERPRISE with every flag enabled, `feature` gating is a no-op here.
Visibility is decided **entirely** by `permission` and `roles[]` in
`frontend/components/shared/sidebar-nav-items.ts`, filtered by
`frontend/lib/hooks/auth/use-nav-visibility.ts:71-88`.

---

## 1. The matrix

Nav counts are the **live DOM scrape** of `aside a` hrefs immediately after login. Permission counts
are the `permissions` claim in the access JWT returned by `POST /api/v1/auth/login`.

| Role | Perms | Nav items | Nav / perm | What it sees |
|---|---:|---:|---:|---|
| OWNER | **66** | 19 | 29% | Dashboard · POS · Kitchen Display · Till Review · Inventory · Menu Items · Accounts · Journal Entries · General Ledger · Periods · Expenses · AP Aging · Purchasing · HR · Customers · Reports · Realtime Dashboard · Ask (NLQ) · Appearance |
| TENANT_ADMIN | **65** | 19 | 29% | *identical to OWNER* |
| MANAGER | 49 | 11 | 22% | Dashboard · POS · Kitchen Display · Till Review · Inventory · Menu Items · Purchasing · Customers · Reports · Realtime Dashboard · Ask (NLQ) |
| ACCOUNTANT | 24 | 13 | 54% | Dashboard · POS · Accounts · Journal Entries · General Ledger · Periods · Expenses · AP Aging · Purchasing · Customers · Reports · Realtime Dashboard · Ask (NLQ) |
| CASHIER | 14 | 3 | 21% | Dashboard · POS · Customers |
| WAITER | 7 | 3 | 43% | Dashboard · POS · Kitchen Display |
| INVENTORY_MANAGER | 5 | 3 | 60% | Dashboard · Inventory · Purchasing |
| KITCHEN_STAFF | 2 | 2 | 100% | Dashboard · Kitchen Display |

**OWNER and TENANT_ADMIN see exactly the same 19 items.** The single permission that separates them
— `rbac.manage` — is attached to one nav entry (`Users`, `sidebar-nav-items.ts:343-349`) which is
marked `comingSoon: true`, so it is filtered out at `use-nav-visibility.ts:75-77`. An owner's extra
permission buys them nothing in the UI.

> Doc drift: `scripts/CREDENTIALS.md:106-107` says OWNER 65 / TENANT_ADMIN 64. Live is **66 / 65**.
> `CREDENTIALS.md:129-131` also says purchasing answers 403 for MANAGER; live it is **200**
> (`GET /api/v1/purchasing/vendors`). Both lines are stale.

### 1b. API probe — 18 surfaces × 8 roles

`NNN/N` = HTTP status / nav item visible. `NNN/-` = status / not in nav.

| Surface | OWNER | T_ADMIN | MANAGER | ACCT | CASHIER | WAITER | INV_MGR | KITCHEN |
|---|---|---|---|---|---|---|---|---|
| `GET /inventory/ingredients` | 200/N | 200/N | 200/N | 403/- | 403/- | 403/- | 200/N | 403/- |
| `GET /finance/accounts` | 200/N | 200/N | **403/-** | 200/N | 403/- | 403/- | 403/- | 403/- |
| `GET /purchasing/vendors` | 200/N | 200/N | 200/N | 200/N | 403/- | 403/- | 200/N | 403/- |
| `GET /hr/employees` | 200/N | 200/N | **200/-** | **200/-** | 403/- | 403/- | 403/- | 403/- |
| `GET /hr/payroll-runs` | 200/N | 200/N | **200/-** | **200/-** | 403/- | 403/- | 403/- | 403/- |
| `GET /crm/customers` | 200/N | 200/N | 200/N | 200/N | 200/N | 403/- | 403/- | 403/- |
| `GET /reporting/reports` | 200/N | 200/N | 200/N | 200/N | 403/- | 403/- | 403/- | 403/- |
| `GET /users` | **200/-** | **200/-** | 403/- | 403/- | 403/- | 403/- | 403/- | 403/- |
| `GET /branches` | **200/-** | **200/-** | **200/-** | **200/-** | **200/-** | **200/-** | **200/-** | **200/-** |
| `GET /pos/tables?branchId=` | 200/- | 200/- | 200/- | 200/- | 200/- | 200/- | 200/- | 200/- |

Every 403 lines up with a hidden nav item. **There is no case anywhere in this table of a nav item
being shown to a role the API then refuses.** The bolded cells are the defects, itemised below.

---

## 2. Class A — UI stricter than API (usability defects)

### A-1 · MANAGER and ACCOUNTANT hold real `hr.*` permissions; HR is hard-gated to OWNER/TENANT_ADMIN — HIGH

`sidebar-nav-items.ts:266-274` gates the HR nav on `roles: ["OWNER","TENANT_ADMIN"]` behind the
comment *"Phase 5+: HR permissions not yet in DB catalog — admin/owner only until built."* That
comment is false. The codes are in the catalog, both roles carry them, the backend enforces them,
and the page itself admits them:

- `frontend/app/(tenant)/app/hr/layout.tsx:44` guards on **`hr.employee.view`**, not on a role.
- MANAGER JWT carries `hr.attendance.manage`, `hr.attendance.view`, `hr.employee.view`,
  `hr.leave.approve`, `hr.leave.view`, `hr.payroll.view` — **6 HR codes**.
- ACCOUNTANT JWT carries `hr.employee.view`, `hr.payroll.run`, `hr.payroll.view` — **3 HR codes,
  including the one that actually runs payroll**.
- `services/hr-service/.../EmployeeController.java:46` → `@PreAuthorize("hasAuthority('hr.employee.view')")`
- `services/hr-service/.../PayrollRunController.java:59,67` → `@PreAuthorize("hasAuthority('hr.payroll.run')")`

Observed live:

| Role | Sidebar has `/app/hr` | Typed `/app/hr/payroll` | API |
|---|---|---|---|
| MANAGER | no (11-item nav) | **renders the full HR module** — tabs Employees / Payroll / Schedule / Attendance & Leave | `GET /api/v1/hr/payroll-runs` → **200 OK** |
| ACCOUNTANT | no (13-item nav) | **renders, with a live "New run" button** | `GET /api/v1/hr/payroll-runs` → **200 OK** |

The accountant is the person who runs payroll and the only way they can reach the payroll screen is
by knowing the URL by heart. Nothing is broken except the nav gate.

**Fix:** delete `roles: ["OWNER","TENANT_ADMIN"]` from `sidebar-nav-items.ts:273` (and the flat-list
twin at `:102`) and replace it with `permission: "hr.employee.view"` — matching the guard the page
already uses. Same for the `Reporting` entry's stale comment at `:290-291`.

### A-2 · MANAGER holds `finance.expense.approve` but every Finance route is gated on `finance.journal.view` — MEDIUM

MANAGER's JWT carries `finance.expense.approve` and `finance.ar.view`. The expense
approve/reject endpoints enforce exactly that code
(`services/finance-service/.../ExpenseController.java:53,59`). But the Expenses screen lives inside
`frontend/app/(tenant)/app/finance/layout.tsx:60`, which guards the whole module on
`finance.journal.view` — a code MANAGER does not hold. Every one of the six Finance nav entries
(`sidebar-nav-items.ts:206-249`) is gated on the same single code.

Observed live: MANAGER typing `/app/finance/accounts` gets **"Access denied — You do not have
permission to view this page."** Correct for the ledger; wrong for the expense inbox, which is the
one finance action a branch manager is supposed to perform.

**Fix:** give Expenses its own guard (`finance.expense.approve` OR `finance.journal.view`, mode
`any`) instead of inheriting the module-wide one.

### A-3 · `rbac.manage` / `rbac.user.manage` / `rbac.role.manage` have a working backend and no UI — HIGH

`services/user-service/.../UserAdminController.java` at `/api/v1/users` exposes list, get, create,
patch, deactivate, reactivate, reset-password, assign-branch-role, revoke-branch-role and
get-permissions — **10 endpoints**. `GET /api/v1/users` returns **200** for OWNER and TENANT_ADMIN
(403 for everyone else — correct).

The only nav entry pointing at it is `sidebar-nav-items.ts:343-349`, marked `comingSoon: true`.
Typed directly as OWNER, `/app/settings/users` returns **`404 This page could not be found.`**

An owner cannot add a staff member, reset a password, or change anybody's role through the product.
This is the user's "no user-management UI for an owner", confirmed as **BACKEND_NO_UI** — the
backend is complete and reachable.

### A-4 · `branch.manage` has a backend and no UI — MEDIUM

`services/user-service/.../BranchController.java:47,74,82` exposes create / update / soft-delete
gated on `rbac.manage` or `branch.manage`. OWNER and TENANT_ADMIN hold `branch.manage`. There is no
nav entry, no route, and no page anywhere under `frontend/app` for branch administration. The tenant
is documented as having 2 branches; neither can be edited and a third cannot be added.

### A-5 · `audit.log.view` has a backend and no UI — LOW

`services/audit-service/.../AuditQueryController.java:82-83` exposes
`GET /api/v1/audit/events` gated on `audit.log.view`, which only OWNER holds. No nav entry, no page.
(The gateway currently 404s that path for every role, so the route registration needs checking too.)

---

## 3. Class B — UI looser than API (security defects)

Prior research found none. **That no longer holds — there are two, plus one API-side over-exposure.**
Neither UI case grants a backend privilege the role lacks, which is why both are MEDIUM rather than
BLOCKER, but both are real and both are reproducible.

### B-1 · `/settings/appearance` has no guard at all — any role reaches the tenant-branding screen — MEDIUM

The nav entry is role-gated (`sidebar-nav-items.ts:336-342`, `roles: ["OWNER","TENANT_ADMIN"]`), and
so is its command-palette twin (`top-bar.tsx:102`) and its mobile-nav twin
(`mobile-bottom-nav.tsx:51-55`). The **page** is guarded by nothing:

- `frontend/app/(tenant)/settings/appearance/page.tsx:21` claims *"Protected by the (tenant) layout
  auth guard — no additional guard needed here."* `frontend/app/(tenant)/layout.tsx` contains no
  guard of any kind; it renders the shell unconditionally.
- `frontend/proxy.ts:21` — `PROTECTED = ["/platform", "/app"]`, and `proxy.ts:64` matcher is
  `["/login", "/platform/:path*", "/app/:path*", "/dashboard", "/dashboard/:path*"]`. `/settings/*`
  is in **neither**, so even the first-pass unauthenticated redirect does not apply to it.
- No `PermissionGuard` — the page is absent from every `PermissionGuard` usage in the codebase.

Observed live: signed in as **KITCHEN_STAFF** (2 permissions; sidebar showing only Dashboard and
Kitchen Display), typed `/settings/appearance` → the full branding page rendered with a working
**"Save appearance"** button. Clicking it changed
`localStorage["tenant-theme-settings"]` from `null` to `{"brandColor":"#3b82f6","logoUrl":""}`.
Reproduced identically as MANAGER.

**Fix:** wrap the page in the same role/permission check its three nav entries use, and add
`/settings` to `PROTECTED` and to the `proxy.ts` matcher.

### B-2 · INVENTORY_MANAGER's landing page is the Kitchen dashboard, whose only CTA is refused — MEDIUM

`frontend/components/dashboard/tenant-dashboard.tsx:282-289`:

```ts
export function TenantDashboard() {
  const { permissions } = useCurrentUser();
  const canViewOrders = permissions.includes("pos.order.view");
  if (!canViewOrders) {
    return <KitchenDashboard />;
  }
  return <OperationsDashboard />;
}
```

The dashboard's only branch is "can you view orders?" — everyone who cannot is *assumed* to be
kitchen staff. INVENTORY_MANAGER's 5 permissions are `inventory.item.manage`, `inventory.item.view`,
`vendor.grn.receive`, `vendor.po.create`, `vendor.view`. No `pos.order.view` → they get the Kitchen
screen. They also have no `pos.kds.view`, so the CTA is a dead end.

Observed live, signed in as `storekeeper@terrace.local`:

1. `/app/dashboard` renders *"Kitchen — Your account is set up for kitchen display. Open the KDS
   board to view and update tickets."*
2. The page's one link is **"Open KDS board" → `/app/kitchen`**.
3. Clicking it → **"You do not have permission to access the Kitchen Display."**

The store keeper's home screen tells them they are kitchen staff and offers them exactly one action,
which is refused. This is the textbook UI-looser shape: the UI offers what the guard denies.

**Fix:** dispatch the dashboard on the role's actual capability (`pos.kds.view` → Kitchen,
`inventory.item.view` → an inventory summary, else a neutral shell), not on the absence of one
unrelated permission.

### B-3 · `GET /api/v1/branches` is ungated — every role reads the full branch list — MEDIUM (API-side)

`services/user-service/.../BranchController.java:55-62` (list) and `:71-74` (get by id) carry **no
`@PreAuthorize`**, while every mutating sibling on the same controller requires
`rbac.manage`/`branch.manage` (`:47`, `:74`, `:82`).

Observed live with the KITCHEN_STAFF token (2 permissions) — **HTTP 200** returning both branches
with `id`, `tenantId`, `name`, `isHq`, `isActive`, `address`, **`fbrStrn`**, **`ntn`**, `phone`,
`email`, `timezone`, `currencyConfig`, `receiptConfig`. Tax-registration fields are null in this
seed but the shape is exposed, and the list is not scoped to the caller's assigned branches — the
branch switcher already has a properly scoped `/api/v1/branches/mine` (`:66-69`) for that.

No UI surfaces it, so it is not a UI-looser defect; it is the API being looser than every other
route on the same controller.

---

## 4. Forbidden route typed into the address bar — verified refused

Two independent live tests, both a full page load at the URL, both with the role's sidebar read in
the same call to prove which session was active:

| Role (nav count) | Typed URL | Result |
|---|---|---|
| MANAGER (11) | `/app/finance/accounts` | **"Access denied — You do not have permission to view this page. Back to dashboard"** |
| WAITER (3) | `/app/purchasing/vendors` | **"Access denied — You do not have permission to view this page. Back to dashboard"** |

Refusal comes from the module layout's `PermissionGuard … fallback={<AccessDenied />}`
(`finance/layout.tsx:60`, `purchasing/layout.tsx:49`) reading the decoded JWT claims — not from the
nav. Independently, the gateway refuses the underlying calls: `GET /api/v1/finance/accounts` → **403**
for MANAGER, `GET /api/v1/purchasing/vendors` → **403** for WAITER.

Guard coverage is good: every tenant module has a layout-level or page-level `PermissionGuard`
(finance, hr, purchasing, inventory layouts; crm, reports, nlq, pos, kitchen, menu/items,
dashboard/realtime, pos/tills pages). The **only** unguarded authenticated route in the app is
`/settings/appearance` — B-1.

---

## 5. Neither UI nor backend

### N-1 · Dining tables cannot be created by anything — HIGH

Five roles hold `pos.tables.manage` (OWNER, TENANT_ADMIN, MANAGER, CASHIER, WAITER). Observed as
OWNER: POS → **Floor View** → **"🪑 No tables configured"**, and the page's complete button list is
`POS Terminal · Floor View · Order Management · Close Till`. No add-table control exists. The
dashboard tile reads **"Dining tables 0 / 0 — 0 available now"**.

This is worse than "backend built, no UI". `services/pos-service/.../web/TableController.java` has
only `GET` (list, `:29`), `PATCH /{id}` (status, `:37-38`), and `GET /{id}/active-order` (`:47-48`).
`services/pos-service/.../service/TableService.java` declares exactly four methods —
`listByBranch`, `updateStatus`, `getActiveOrderForTable`, `syncStatusForOrder`. **There is no create
method and no POST endpoint anywhere.** `pos.tables.manage` gates a status change on a table that
nothing in the system can bring into existence.

Consequence: the entire dine-in flow is unreachable. The POS order pad's table selector reads
"No table (optional)" with nothing to pick.

### N-2 · Menu items have no image, anywhere — MEDIUM

As TENANT_ADMIN, `/app/menu/items` → **Add item** dialog. Its complete field set is
`categoryId`, `name`, `description`, `priceRupees`. `document.querySelectorAll('input[type=file]').length`
on that page is **0**. There is no image field in the DTO either. `file-service` exposes a working
`FileController`, and `/settings/appearance` still says *"Logo URL — File upload will be available in
a future release. Provide a publicly accessible URL for now."* — so the upload backend exists and
**two** separate screens decline to use it.

---

## 6. Other confirmed defects surfaced by the sweep

### O-1 · Tenant Appearance is the only settings screen and it never reaches the server — HIGH

Clicking **Save appearance** produced **zero requests to :8080** (network log across the click shows
only the routine `feature-flags` / `branches/mine` / `auth/refresh` traffic). The sole effect is
`localStorage["tenant-theme-settings"]`. `frontend/app/(tenant)/settings/appearance/page.tsx:19-21`
admits it: *"Persistence: AppearanceForm saves to localStorage … Phase 7 replaces this with
PUT /api/v1/tenants/:id/theme."*

So the tenant's branding is per-browser: it does not follow the user to another device and no other
staff member ever sees it. Combined with `/app/settings` being `comingSoon` (nav entry
`sidebar-nav-items.ts:330-335`, no `page.tsx`), this is the whole of the user's "settings and
profile pages not working" — there is exactly one settings screen, it is unguarded (B-1), and it
does not persist.

### O-2 · The ⌘K palette holds three entries for a 65-permission administrator — MEDIUM

Opened live as TENANT_ADMIN. Dialog contents, in full:
**`Navigation → Dashboard, Appearance` · `Theme → Toggle theme`.**

Source: `frontend/components/shared/top-bar.tsx:100-103` — `NAV_COMMANDS` is a two-element array.
For any role that is not OWNER/TENANT_ADMIN the `Appearance` entry is filtered out (`:106-108`),
leaving **Dashboard and a theme toggle**. Nothing in the palette searches orders, menu items,
vendors, customers, employees, or accounts. This is the user's "limited top-bar search".

### O-3 · The profile menu has one destination — LOW

`top-bar.tsx:200-215`: the dropdown renders `Appearance` (OWNER/TENANT_ADMIN only) and `Log out`.
For the other six roles it is **Log out alone**. There is no profile page — `/settings/profile` does
not exist. The code comment at `:205-209` documents this as a deliberate retreat from dead links,
which is the right call, but it leaves six of eight roles with no account surface at all.

### O-4 · The notification bell is a decorative stub — LOW

`top-bar.tsx:175-190`: a `<button>` with **no `onClick`**, `aria-label="Notifications (3 unread)"`,
and a hardcoded unread dot (`{/* Hardcoded stub count */}`). It renders on every screen for every
role, announces three unread items to screen-reader users, and does nothing when clicked.

### O-5 · Mobile bottom nav has no Kitchen Display entry — MEDIUM

`frontend/components/shared/mobile-bottom-nav.tsx:25-57` — `BOTTOM_NAV_ITEMS` is Dashboard, Orders
(`pos.order.create`), Menu (`inventory.item.view`), Finance (`finance.journal.view`), Appearance
(roles). There is **no `pos.kds.view` entry**. Filtering runs through the same
`useNavGroupVisibility`, so KITCHEN_STAFF — whose two permissions are `pos.kds.view` and
`pos.kds.update`, and who is the role most likely to be on a tablet — gets a bottom bar containing
**Dashboard alone**, with no route to the only screen they are allowed to use. Observed on the
kitchen session's rendered DOM.

(The gating itself is correct here — this bar honours `permission`, `roles` and `comingSoon`
properly. The defect is a missing entry, not a broken guard.)

### O-6 · The POS orders WebSocket puts the full access JWT in the URL — MEDIUM

`frontend/lib/hooks/pos/use-pos-orders-socket.ts:53` builds
`` wsUrl(`/api/v1/pos/ws/orders/${branchId}?token=${accessToken}`) `` and the same pattern appears in
`use-kds-socket.ts:68` and `use-dashboard-socket.ts:60`. The gateway allows it deliberately
(`gateway/.../JwtGlobalFilter.java:114-121`). Console errors observed on the MANAGER session show
the complete signed JWT in the failing-connection message — it will land in gateway access logs,
browser history and any intermediary the same way. The connection also failed repeatedly
(`WebSocket connection to 'ws://localhost:8080/api/v1/pos/ws/orders/…' failed`), so the realtime
order stream is not working on top of leaking the token. Prefer a short-lived single-use ticket or
the `Sec-WebSocket-Protocol` header.

### O-7 · Every page load fetches a tenant named `test` — LOW

`GET /api/v1/auth/tenants/test → 200 OK` fires on every single navigation, in every role's session.
Related to the known `?tenant=test` issue and presumably covered by that fix; noting it because it is
one wasted round trip per page load in the live app, not just a login-page redirect.

---

## 7. Environment notes (not findings)

- `auth-service` and `hr-service` both 503'd mid-audit with `NoClassDefFoundError` on classes that
  exist in their jars — a concurrent `mvn package` rewriting the jar under the running JVM. Waited
  out / restarted (`scripts/dev-env.sh` + `scripts/local-service-env.sh` must be sourced first;
  a bare `java -jar` fails Liquibase with `password authentication failed for user "hr_user"`).
  All API results above were re-taken after recovery.
- `pos-service` 503'd during the batch probe; the POS rows in §1b were re-verified individually
  afterwards (`GET /api/v1/pos/tables` → 200).
- The browser profile is shared with other agent sessions, so the HttpOnly refresh cookie was
  occasionally overwritten mid-run. Every capture above reads the role marker **and** the sidebar in
  the same call, so no row mixes two sessions.
- `?tenant=test` on `/login` — known, excluded per brief.

---

## 8. Ranked summary

| # | Finding | Class | Severity | Owner |
|---|---|---|---|---|
| A-3 | Owner cannot manage users; 10 endpoints live, nav `comingSoon`, route 404s | BACKEND_NO_UI | HIGH | frontend |
| A-1 | MANAGER (6 codes) + ACCOUNTANT (3, incl. `hr.payroll.run`) locked out of HR by a stale role gate | UI stricter | HIGH | frontend |
| N-1 | Dining tables cannot be created — no POST, no service method, no UI | NEITHER_EXISTS | HIGH | pos-service + frontend |
| O-1 | The only settings screen writes to localStorage; zero API calls on save | DATA_MISSING | HIGH | frontend |
| B-1 | `/settings/appearance` unguarded — KITCHEN_STAFF reaches tenant branding | UI looser | MEDIUM | frontend |
| B-2 | INVENTORY_MANAGER's dashboard is the Kitchen screen; its one CTA is refused | UI looser | MEDIUM | frontend |
| B-3 | `GET /api/v1/branches` ungated — every role reads the full branch list | API looser | MEDIUM | user-service |
| A-2 | MANAGER holds `finance.expense.approve`; Expenses sits behind `finance.journal.view` | UI stricter | MEDIUM | frontend |
| A-4 | `branch.manage` backend live, no UI at all | BACKEND_NO_UI | MEDIUM | frontend |
| O-5 | Mobile bottom nav has no KDS entry — kitchen tablet gets one icon | UX defect | MEDIUM | frontend |
| O-2 | ⌘K palette = 3 items for a 65-permission admin | UX defect | MEDIUM | frontend |
| N-2 | No menu-item image — no field, no upload, despite a working `FileController` | NEITHER_EXISTS | MEDIUM | pos-service + frontend |
| O-6 | Access JWT in the WebSocket query string; connection also failing | Security / broken | MEDIUM | frontend + gateway |
| A-5 | `audit.log.view` backend live, no UI (and route 404s at the gateway) | BACKEND_NO_UI | LOW | frontend + gateway |
| O-3 | Profile menu = "Log out" for six of eight roles | UX defect | LOW | frontend |
| O-4 | Notification bell: no handler, hardcoded "3 unread" | UX defect | LOW | frontend |
| O-7 | `GET /auth/tenants/test` on every page load in every session | UX defect | LOW | frontend |

**Verdict on the two classes.** UI-stricter-than-API is the dominant failure mode and is systemic:
five separate permission families (`hr.*`, `rbac.*`, `branch.manage`, `audit.log.view`,
`finance.expense.approve`) are held, enforced, and unreachable. UI-looser-than-API is no longer
empty — B-1 and B-2 are both reproducible — but neither escalates a backend privilege, and the
direct-URL refusal test passed cleanly on both routes tried. The guard layer is sound; the nav
layer, the dashboard's role dispatch, and one unguarded page are not.
