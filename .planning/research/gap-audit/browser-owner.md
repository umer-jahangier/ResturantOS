# Gap audit — OWNER and TENANT_ADMIN, driven through the browser

**Date:** 2026-08-07
**Tenant:** `floating-terrace` (ENTERPRISE, all modules on, 2 branches)
**Personas:** `owner@terrace.local` (OWNER, 69 permissions incl. `rbac.manage`) and
`admin@terrace.local` (TENANT_ADMIN, 68 permissions incl. `rbac.user.manage`, no `rbac.manage`)
**Method:** headless Chromium (Playwright 1.61) driving the real frontend at
<http://localhost:3000> against the live gateway at <http://localhost:8080>. Every route was
visited, the DOM inventoried, buttons clicked, forms submitted, and the console + network log
read on each screen. Backend claims were then re-checked with a real bearer token via curl.

**Artifacts** (all paths absolute):

| What | Where |
|---|---|
| 110 screenshots, one per screen per persona | `/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/research/gap-audit/screenshots/` |
| Machine-readable per-screen capture (owner) | `.../screenshots/owner-results.json` |
| Machine-readable per-screen capture (admin) | `.../screenshots/admin-results.json` |
| Interaction transcript (owner) | `.../screenshots/owner-interactions.txt` |
| Interaction transcript (admin) | `.../screenshots/admin-interactions.txt` |

**Environment note, not a finding:** `auth-service` was not running at the start of this audit
(Eureka reported `AUTH-SERVICE DOWN`, no process on :8081) and flapped repeatedly during it —
several other agents were restarting services concurrently. Every `503` in the capture files is
that, and I re-ran each persona to convergence. All findings below were reproduced with the
stack healthy.

---

## 1. The headline

**The OWNER of a restaurant, holding every permission the platform defines, has exactly one
settings screen: a brand-colour picker that saves to `localStorage` and never touches the
server.** There is no user management, no profile, no way to change their own password, no way
to add a dining table, no way to attach a picture to anything, and the top-bar search searches
two hardcoded strings.

The `SETTINGS` section of the sidebar, for both OWNER and TENANT_ADMIN, is exactly one item:

```
SETTINGS | Appearance
```

`frontend/components/shared/sidebar-nav-items.ts:330-349` declares three items in that group. Two of them
— `General` (`/app/settings`) and `Users` (`/app/settings/users`) — carry `comingSoon: true`, and
`frontend/lib/hooks/auth/use-nav-visibility.ts:51` and `:73` hide any item with that flag. The pages behind
them do not exist either: both return HTTP 404.

---

## 2. Screen-by-screen

Legend — **Data**: `real` = rows rendered from the API; `empty` = a designed empty state;
`empty·dead-end` = an empty state that tells the user to create something with no control to do
it. **Actions**: whether the buttons/forms on the screen actually did something when clicked.

### Reachable from the sidebar

| # | Screen | Route | HTTP | Renders | Data | Actions | Console / network | Screenshot |
|---|---|---|---|---|---|---|---|---|
| 1 | Dashboard | `/app/dashboard` | 200 | yes | real (4 recent orders) | no buttons at all | clean when stack healthy | `owner-dashboard.png` |
| 2 | Realtime Dashboard | `/app/dashboard/realtime` | 200 | yes | real (Rs 33,686.40) | no buttons | **WS to `ws://localhost:8080/api/v1/reporting/dashboard/{branch}` fails to connect → falls back to polling** | `owner-dashboard-realtime.png` |
| 3 | POS | `/app/pos` | 200 | yes | real | Open Till / POS Terminal / Floor View / Order Management all work | POS orders WebSocket error (see #F-9) | `owner-pos.png` |
| 4 | POS → Floor View | `/app/pos` tab | 200 | yes | **empty·dead-end — "🪑 No tables configured"** | **no control to add a table** | clean | `owner-pos-floor-view.png` |
| 5 | Till Review | `/app/pos/tills` | 200 | yes | empty (0 rows) | Refresh / Previous / Next | clean | `owner-pos-tills.png` |
| 6 | Kitchen Display | `/app/kitchen` | 200 | yes | real (2 stations, 11 tickets) | station tiles navigate | clean | `owner-kitchen.png` |
| 7 | Inventory (hub) | `/app/inventory` | 200 | yes | n/a — link hub | 2 cards navigate | clean | `owner-inventory.png` |
| 8 | Ingredients | `/app/inventory/ingredients` | 200 | yes | real (4 rows) | Add ingredient + 15 allergen filters + search + 2 selects | clean | `owner-inventory-ingredients.png` |
| 9 | Stock | `/app/inventory/stock` | 200 | yes | real (4 rows) | Opening balance / Receipt / Transfer / Count | clean | `owner-inventory-stock.png` |
| 10 | Recipes | `/app/inventory/recipes` | 200 | yes | real (6 rows) | New recipe version | clean | `owner-inventory-recipes.png` |
| 11 | Inventory Categories | `/app/inventory/categories` | 200 | yes | real | Add category / row Actions | clean | `owner-inventory-categories.png` |
| 12 | Coverage | `/app/inventory/coverage` | 200 | yes | real (5 rows) | Show all | clean | `owner-inventory-coverage.png` |
| 13 | Inventory Setup | `/app/inventory/setup` | 200 | yes | real (14 rows) | Add unit / Add location | clean | `owner-inventory-setup.png` |
| 14 | Menu Items | `/app/menu/items` | 200 | yes | real | Add category / Add item — **both submit successfully** (`201`/`200 POST /api/v1/pos/menu/items`) | clean | `owner-menu-items.png` |
| 15 | Finance → Accounts | `/app/finance/accounts` | 200 | yes | real (50 rows) | only a filter select | clean | `owner-finance-accounts.png` |
| 16 | Journal Entries | `/app/finance/journal-entries` | 200 | yes | real (24 rows) | rows navigate | clean | `owner-finance-journal-entries.png` |
| 17 | New Journal Entry | `/app/finance/journal-entries/new` | 200 | yes | n/a | full form, 37 controls, date picker | clean | `owner-finance-journal-new.png` |
| 18 | General Ledger | `/app/finance/gl` | 200 | yes | real (1 row) | account select | clean | `owner-finance-gl.png` |
| 19 | Periods | `/app/finance/periods` | 200 | yes | real (12 rows) | Provision Periods / Close Period / year nav | clean | `owner-finance-periods.png` |
| 20 | Expenses | `/app/finance/expenses` | 200 | yes | empty | New expense | clean | `owner-finance-expenses.png` |
| 21 | AP Aging | `/app/finance/ap-aging` | 200 | yes | empty (correct — no vendor invoices) | none | clean | `owner-finance-ap-aging.png` |
| 22 | AR Aging | `/app/finance/ar-aging` | 200 | yes | empty | none | clean | `owner-finance-ar-aging.png` |
| 23 | House Accounts | `/app/finance/house-accounts` | 200 | yes | empty | New house account | clean | `owner-finance-house-accounts.png` |
| 24 | Purchasing (hub) | `/app/purchasing` | 200 | yes | n/a — link hub | 6 cards navigate | clean | `owner-purchasing.png` |
| 25 | Vendors | `/app/purchasing/vendors` | 200 | yes | real (1 vendor) | Add vendor / Edit / Manage catalog | clean | `owner-purchasing-vendors.png` |
| 26 | Purchase Orders | `/app/purchasing/purchase-orders` | 200 | yes | real (12 rows) | New Purchase Order + status filter | clean | `owner-purchasing-pos.png` |
| 27 | Invoices | `/app/purchasing/invoices` | 200 | yes | empty | Book Invoice | clean | `owner-purchasing-invoices.png` |
| 28 | Payments | `/app/purchasing/payments` | 200 | yes | empty | **zero buttons — read-only dead end** | clean | `owner-purchasing-payments.png` |
| 29 | Order Suggestions | `/app/purchasing/order-suggestions` | 200 | yes | real (4 rows) | **zero buttons — cannot act on a suggestion** | clean | `owner-purchasing-suggestions.png` |
| 30 | Purchasing Analytics | `/app/purchasing/analytics` | 200 | yes | real (2 tables) | 2 selects | clean | `owner-purchasing-analytics.png` |
| 31 | HR → Employees | `/app/hr/employees` | 200 | yes | **empty — "No employees yet"** while 17 users exist | New employee | clean | `owner-hr-employees.png` |
| 32 | HR Payroll | `/app/hr/payroll` | 200 | yes | empty | New run | clean | `owner-hr-payroll.png` |
| 33 | HR Schedule | `/app/hr/schedule` | 200 | yes | empty | Add shift + week nav | clean | `owner-hr-schedule.png` |
| 34 | HR Attendance | `/app/hr/attendance` | 200 | yes | empty | Clock in/out, Request leave, Approve, Reject, **"Seed default leave types"** (a dev button on a production screen) | clean | `owner-hr-attendance.png` |
| 35 | Customers (CRM) | `/app/crm` | 200 | yes | **empty·dead-end — "Add your first customer" with no Add button** | **zero buttons** | clean | `owner-crm.png` |
| 36 | Reports | `/app/reports` | 200 | yes | real (7 report cards) | cards navigate | clean | `owner-reports.png` |
| 37 | FBR Tax Summary | `/app/reports/fbr` | 200 | yes | real (Rs 31,940 / 25 orders) | 2 date inputs | clean on re-run | `owner-reports-fbr.png` |
| 38 | Ask (NLQ) | `/app/nlq` | 200 | yes | n/a | 3 sample prompts + Ask | clean | `owner-nlq.png` |
| 39 | **Appearance** | `/settings/appearance` | 200 | yes | n/a | **Save writes `localStorage` only — 0 network requests** | clean | `owner-appearance-saved.png` |

### Chrome present on every screen

| # | Element | Behaviour observed | Screenshot |
|---|---|---|---|
| 40 | Top-bar search (⌘K) | Palette contains literally `Dashboard \| Appearance \| Toggle theme`. Typing `Beef Nihari` (a real seeded menu item) → **"No results found"**. Typing `owner@terrace.local` → **"No results found"**. **Zero network requests issued.** | `owner-search-palette.png`, `owner-search-menuitem-query.png` |
| 41 | Profile menu | `My Account \| Appearance \| Log out`. No Profile, no Settings, no Change password. | `owner-profile-menu.png` |
| 42 | Notification bell | `aria-label="Notifications (3 unread)"` with a red dot. Click → **DOM delta 0, no popover, no network request.** | `owner-bell-clicked.png` |

### Routes the user expects and that do not exist

| # | Route | HTTP | Screenshot |
|---|---|---|---|
| 43 | `/app/settings` | **404** "This page could not be found." | `owner-XX-settings.png` |
| 44 | `/app/settings/users` | **404** | `owner-XX-settings-users.png` |
| 45 | `/settings/profile` | **404** | `owner-XX-settings-profile.png` |
| 46 | `/app/profile` | **404** | `owner-XX-profile.png` |
| 47 | `/app/reporting` | **404** (nav item exists, `comingSoon`) | `owner-XX-reporting.png` |
| 48 | `/app/users` | **404** | `owner-XX-users.png` |

### TENANT_ADMIN

Identical in every respect. Same sidebar (`admin-sidebar.png`), same three chrome defects
(`admin-search-palette.png`, `admin-profile-menu.png`, `admin-bell-clicked.png`), same six 404s
(`admin-XX-*.png`). The only differences in the capture are row-count timing artifacts.
**TENANT_ADMIN also gets `200` from `GET /api/v1/users` and `GET /api/v1/branches`** — so the
missing UI is not a permission problem for either role.

---

## 3. The user's four named failures — what actually happens

### 3.1 User management — `BACKEND_NO_UI`, and the backend is complete

I exercised the entire lifecycle through the gateway with a live OWNER bearer token:

| Call | Result |
|---|---|
| `GET /api/v1/users?page=0&size=5` | **200**, 17 real users returned |
| `POST /api/v1/users` | **201** — id `192349d0-0670-4ffb-a93a-59bc19199249`, temp password issued, `WAITER` role assigned at HQ |
| `PATCH /api/v1/users/{id}` | **200** — `fullName` → `"Gap Audit Probe RENAMED"` |
| `POST /api/v1/users/{id}/deactivate` | **200** — `active: false`, assignment preserved |

`services/user-service/src/main/java/io/restaurantos/user/controller/UserAdminController.java:58`
maps `/api/v1/users` and defines list (`:83`), get (`:98`), create (`:111`), patch (`:123`),
deactivate (`:139`), reactivate (`:146`), reset-password (`:176`), assign/revoke branch-role
(`:187`, `:197`) and permissions (`:218`).

The frontend contains **zero** consumers. The only occurrence of the string `/users` outside a
test is the dead nav href:

- `frontend/components/shared/sidebar-nav-items.ts:345` — `href: "/app/settings/users"`
- `frontend/components/shared/sidebar-nav-items.ts:348` — `comingSoon: true, // /app/settings/users page not built yet`

There is no `lib/hooks/users/`, no `lib/api-client/schemas/user.schema.ts`, no repository, no
page. `/app/settings/users` returns 404 for both OWNER and TENANT_ADMIN.

**An owner cannot see, create, edit, deactivate or reset the password of a single member of their
own staff.** Every account on the system today exists because `scripts/seed_restaurantos.py` made it.

Also backend-only, same shape: `BranchController` at
`services/user-service/src/main/java/io/restaurantos/user/controller/BranchController.java:38`
has POST (`:48`), PUT (`:75`) and DELETE (`:83`) — the frontend calls only
`/api/v1/branches/mine` (`frontend/lib/repositories/branch.repository.ts:8`). No branch can be
added or edited from the UI either.

### 3.2 Settings page — `UI_NO_BACKEND`, and it lies about saving

`/app/settings` is a **404**. The one settings screen that exists, `/settings/appearance`, is a
stub that was never wired up:

- `frontend/components/settings/appearance-form.tsx:112-129` — `onSubmit` writes
  `localStorage.setItem("tenant-theme-settings", ...)` and nothing else. Line 118-119 says so:
  `// Persistence stub (localStorage). // Phase 7 backend contract: PUT /api/v1/tenants/:id/theme`.
- `frontend/app/(tenant)/settings/appearance/page.tsx:19-21` repeats it.

Observed by clicking **Save appearance** with the network tab open:

```
SAVE APPEARANCE -> network: []                       # zero requests
localStorage after save: {"brandColor":"#3b82f6","logoUrl":"https://example.com/logo.png"}
success text shown: true                             # the UI says it saved
logoUrl after reload:                                # ...but the form comes back BLANK
fresh-browser localStorage: null                     # and nothing exists on the server
```

So it is worse than "not persisted": the form reports success, then **fails to rehydrate its own
`localStorage` value on reload**, so the user sees their setting vanish on the very next page
load. Nothing is tenant-wide, nothing survives a different browser, and a second admin never sees
the change. `logoUrl` is also a plain text field expecting a URL — there is no way to upload a logo.

### 3.3 Profile page — `NEITHER_EXISTS`, except the one part that does

`/settings/profile` → **404**. `/app/profile` → **404**. The profile dropdown was deliberately
emptied because its links were dead — see the comment at
`frontend/components/shared/top-bar.tsx:205-209`:

> `Was `Profile` → /settings/profile and `Settings` → /app/settings. Neither route exists`

There is no `/me` or profile endpoint in any service, so most of a profile page has no backend.
**But the single most important thing a profile page does exists and is unreachable:**

- `services/auth-service/src/main/java/io/restaurantos/auth/controller/PasswordChangeController.java:41`
  — `POST /api/v1/auth/change-password`, "a logged-in user changes their own password".
- The frontend never calls it. `grep -rn "change-password" frontend/lib frontend/app frontend/components`
  returns only the **forced** variant (`session.repository.ts:31`,
  `use-forced-password-change.ts:11`, `app/(auth)/login/change-password/page.tsx`), which is
  reachable only from a `403 PASSWORD_CHANGE_REQUIRED` at login.

**A signed-in owner cannot change their own password.** Their only route is to be reset by an
administrator — through a UI that does not exist (§3.1).

### 3.4 Top-bar search — `NEITHER_EXISTS`

The palette is a hardcoded array of two nav links:

- `frontend/components/shared/top-bar.tsx:95-98` — `const NAV_COMMANDS = [{ Dashboard }, { Appearance }]`
- `frontend/components/shared/top-bar.tsx:247` — `<CommandItem onSelect={() => setCmdOpen(false)}>Toggle theme</CommandItem>` — the
  handler only closes the dialog. **The "Toggle theme" command does nothing.**

Observed: searching a real menu item and a real user email both return "No results found" with
**zero network traffic**. There is no global-search endpoint anywhere in the backend either —
only two scoped ones (`crm-service/.../CustomerController.java:55`,
`finance-service/.../AccountController.java:73`), neither wired to this palette. The comment at
`frontend/components/shared/top-bar.tsx:93-94` concedes the real search is unbuilt.

---

## 4. Additional confirmed defects

### F-1 — Dining tables: no create endpoint and no UI (`NEITHER_EXISTS`)

`services/pos-service/src/main/java/io/restaurantos/pos/web/TableController.java` has exactly
three routes: `GET` list (`:29`), `PATCH /{id}` status-only (`:38`), `GET /{id}/active-order`
(`:48`). **There is no `POST` and no `DELETE`.** Confirmed live:

```
GET /api/v1/pos/tables?branchId=34cd6f62… → 200 {"data":[]}   # HQ
GET /api/v1/pos/tables?branchId=c2d74ade… → 200 {"data":[]}   # Rooftop
```

Both branches of an ENTERPRISE tenant have zero tables, the Floor View says "🪑 No tables
configured" (`owner-pos-floor-view.png`), and the dashboard tile reads `Dining tables 0 / 0`.
A table can only enter the system through a seeder. This is the strongest form of the gap: the
UI is missing *and* the API to back it was never written.

### F-2 — No file upload anywhere in the product (`BACKEND_NO_UI` + backend currently broken)

`services/file-service/src/main/java/io/restaurantos/file/controller/FileController.java:67`
implements `POST /api/v1/files` (multipart), `:97` download, `:104` delete, `:113` quota.

The frontend has **zero** `<input type="file">` and **zero** `FormData` — verified two ways:
`grep -rn 'type="file"\|FormData\|api/v1/files' frontend/{app,components,lib}` returns nothing,
and a live DOM count across six candidate screens returned `TOTAL FILE INPUTS: 0`.

And the backend does not currently answer: both `GET /api/v1/files/quota` and
`POST /api/v1/files` return **500** (`traceId 22be87e2-…` and `862ab2c2-…`), directly on :8095 as
well as through the gateway. Cause in `.dev-logs/file-service-new.log:800-804`:

```
feign.RetryableException: platform-admin-service executing
  GET http://platform-admin-service:8096/internal/platform/tenants/{id}/status
Caused by: java.net.UnknownHostException: platform-admin-service
```

The tenant-status Feign client is pinned to the Docker-compose hostname, so every file-service
request 500s outside compose.

### F-3 — Menu items have no image field at all (`NEITHER_EXISTS`)

The live API response for `GET /api/v1/pos/menu/items` carries these keys and no others:

```
active, basePricePaisa, categoryId, categoryName, description, id,
kdsStation, name, overridePricePaisa, stationId, taxRateCode, taxRatePct
```

No `image`, `photo`, `imageUrl`, `thumbnail` — nothing. The **Add item** dialog
(`owner-menu-add-item-dialog.png`) offers Category, Name, Description, Price and
`fileInputs: 0`, matching `frontend/components/menu/MenuItemFormDialog.tsx:147-209`. So the
picture the user asked for needs a schema column, an API field, an upload control *and* a fixed
file-service.

### F-4 — CRM empty state is a dead end (`UI_NO_BACKEND`)

`/app/crm` renders "No customers found — **Add your first customer** to start tracking loyalty"
and the main region contains **zero buttons** (`owner-crm.png`). The instruction cannot be
followed. `crm-service` has a full `CustomerController`; the frontend only ever lists and searches.

### F-5 — The nav hides half of itself while feature flags are in flight (`UX_DEFECT`)

`frontend/lib/hooks/auth/use-nav-visibility.ts:29` — `if (isPending) return false;` — so while
`GET /api/v1/feature-flags` is pending or retrying, every feature-gated item (POS, Kitchen, Till
Review, Inventory, Menu Items, all six Finance items, Purchasing, HR, Customers, NLQ) is hidden.
Captured on the first pass: the owner's sidebar rendered as
`OVERVIEW Dashboard | REPORTING Reports, Realtime Dashboard | SETTINGS Appearance` — nine of the
sidebar's twelve groups' worth of items simply absent — for several seconds on every page load.

### F-6 — Purchasing "Order Suggestions" has data and no action (`UI_NO_BACKEND`)

`/app/purchasing/order-suggestions` renders 4 real suggestion rows and **zero buttons**
(`owner-purchasing-suggestions.png`). A user can see what to reorder and cannot act on it.

### F-7 — Purchasing "Payments" is read-only (`UI_NO_BACKEND`)

`/app/purchasing/payments` has zero buttons and zero inputs (`owner-purchasing-payments.png`).
"Record and track payments against approved invoices" is what the hub card promises; nothing on
the screen records a payment.

### F-8 — A dev seeding button ships on the HR screen (`UX_DEFECT`)

`/app/hr/attendance` renders a **"Seed default leave types"** button (`owner-hr-attendance.png`).

### F-9 — Both live WebSockets fail to connect (`BROKEN_AT_RUNTIME`)

Reproduced on every load of `/app/pos` and `/app/dashboard/realtime`:

```
[error] WebSocket connection to
  'ws://localhost:8080/api/v1/pos/ws/orders/{branchId}?token=…' failed
[warning] WebSocket connection to
  'ws://localhost:8080/api/v1/reporting/dashboard/{branchId}?token=…' failed
```

Both screens fall back to polling (the POS header visibly reads "Polling"), so the feature
degrades rather than breaks — but the realtime path advertised on the page never runs, and the
JWT is being passed in a query string.

### F-10 — HR Employees is empty while 17 users exist (`DATA_MISSING`)

`/app/hr/employees` reads "No employees yet" for a tenant with 17 authenticated principals
(`owner-hr-employees.png`). Employee records and user records are entirely disjoint, and with
§3.1 missing there is no screen anywhere that lists the people who work at this restaurant.

---

## 5. What does work

Worth stating plainly, because it bounds the repair. These screens rendered real data, and their
primary write path completed successfully with a 2xx on the wire:

- **Menu Items** — `Add item` submitted `POST /api/v1/pos/menu/items` → **200**, dialog closed,
  the new row appeared in the list. Verified for both OWNER and TENANT_ADMIN
  (`owner-menu-add-item-submitted.png`, `admin-menu-add-item-submitted.png`).
- **Inventory** — Ingredients, Stock, Recipes, Categories, Coverage, Setup all render real rows
  with working create controls and filters.
- **Finance** — Accounts (50 rows), Journal Entries (24 rows), the full New Journal Entry form,
  GL, Periods with Provision/Close.
- **Purchasing** — Vendors and Purchase Orders (12 rows) with working create.
- **Reports / FBR / NLQ / KDS / POS terminal / Till** — all render real data.

The product's transactional core is real. What is missing is the administrative shell around it.

---

## 6. Summary of gaps

| ID | Gap | Kind | Severity | Owner | Est. |
|---|---|---|---|---|---|
| G-1 | No user-management UI; complete CRUD backend at `/api/v1/users` unreachable | BACKEND_NO_UI | BLOCKER | frontend `/app/settings/users` | 5 |
| G-2 | `/app/settings` 404 — no settings page at all | NEITHER_EXISTS | BLOCKER | frontend + tenant-settings API | 4 |
| G-3 | Appearance "Save" writes localStorage, reports success, does not rehydrate | UI_NO_BACKEND | HIGH | frontend + user-service tenant theme | 2 |
| G-4 | No profile page; signed-in user cannot change their own password although `POST /api/v1/auth/change-password` exists | BACKEND_NO_UI | HIGH | frontend `/app/profile` | 2 |
| G-5 | Top-bar search is 2 hardcoded links; no search backend exists | NEITHER_EXISTS | HIGH | frontend + a search endpoint | 5 |
| G-6 | Dining tables: no create/delete endpoint and no UI; both branches have 0 tables | NEITHER_EXISTS | BLOCKER | pos-service + frontend | 3 |
| G-7 | No file upload anywhere; file-service 500s on every request | BACKEND_NO_UI / BROKEN_AT_RUNTIME | HIGH | file-service + frontend | 3 |
| G-8 | Menu items have no image field in schema, API or form | NEITHER_EXISTS | HIGH | pos-service + frontend | 3 |
| G-9 | No branch-management UI; `BranchController` POST/PUT/DELETE unreachable | BACKEND_NO_UI | HIGH | frontend | 2 |
| G-10 | Notification bell is inert with a hardcoded "3 unread" badge | UI_NO_BACKEND | MEDIUM | frontend + notification service | 3 |
| G-11 | "Toggle theme" command palette item does nothing | UX_DEFECT | LOW | frontend | 0.25 |
| G-12 | CRM empty state instructs "Add your first customer" with no control | UI_NO_BACKEND | MEDIUM | frontend | 1 |
| G-13 | Sidebar hides all feature-gated items while flags are pending | UX_DEFECT | MEDIUM | frontend | 0.5 |
| G-14 | Purchasing Payments and Order Suggestions render data with no actions | UI_NO_BACKEND | MEDIUM | frontend | 2 |
| G-15 | Both WebSockets fail; token passed in query string | BROKEN_AT_RUNTIME | MEDIUM | gateway + frontend | 2 |
| G-16 | HR Employees empty while 17 users exist; no screen lists staff | DATA_MISSING | MEDIUM | hr-service + frontend | 2 |
| G-17 | Dev "Seed default leave types" button on the HR attendance screen | UX_DEFECT | LOW | frontend | 0.25 |
| G-18 | `/app/reporting` nav target 404s (hidden by `comingSoon`, config still present) | DEAD_LINK | LOW | frontend | 0.25 |

**Total ≈ 40 engineer-days**, dominated by the four screens that do not exist: users, settings,
profile, and search.
