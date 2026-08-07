# API ↔ UI Parity Map

**Scope:** every `@RestController` mapping in all 16 services vs every path the frontend
requests, plus nav-vs-route cross-check.
**Method:** static extraction of all controller mappings (annotation line numbers verified),
matched against every `/api/v*` string literal in `frontend/`, then confirmed against the
**running stack** (frontend :3000, gateway :8080, tenant `floating-terrace`).
**Date:** 2026-08-07. Signed in live as `manager@terrace.local` (UI) and `owner@terrace.local` (API).

> **Extraction hazard — read before re-running any grep.** `/.claude/worktrees/sharp-feynman-941760/`
> contains a **complete second copy of the repo**. A relative-path grep from the wrong cwd silently
> reads the stale copy (it inflated the first controller count from 321 to 778 and reported wrong line
> numbers). Every path in this document is absolute or explicitly rooted, and the extraction excludes
> `/.claude/`, `/target/`, `/node_modules/`, `/src/test/`.

## Headline numbers

| Measure | Count |
|---|---|
| Controller mappings total (non-test) | **321** |
| Public `/api/**` endpoints | **264** |
| Internal-only (`/internal/**`, `/iclock/**`, `/.well-known/**`) | **57** |
| Public endpoints with **no application-code frontend caller** | **80** (30%) |
| API surfaces (controllers) with **zero** app-code callers | **14** |
| Frontend calls with no backend mapping | **0 REST** (3 WebSocket paths, see D2) |
| Nav entries pointing at a non-existent route | **1 live 404** + 3 hidden |

"Application-code caller" excludes `e2e/`, `__tests__/`, `mocks/`. That distinction matters: several
surfaces below are exercised **only by Playwright specs**, which is why the test suite is green while
the product has no way to reach them.

## Correction to prior research

| Prior claim | Verdict | Evidence |
|---|---|---|
| "Nine live API surfaces have zero frontend callers" | **Wrong — it is 14** | Enumerated in D1 below |
| `mobile-bottom-nav.tsx:51` points at dead `/app/settings` | **Already fixed** | `mobile-bottom-nav.tsx:52-56` is `/settings/appearance` (href at L54); the removal is documented in-file at `mobile-bottom-nav.tsx:17-24` |
| `top-bar.tsx` points at dead `/settings/profile` | **Already fixed** | `top-bar.tsx:90-93` documents the removal; `NAV_COMMANDS` (L95-98) now holds only `/app/dashboard` and `/settings/appearance` |
| `TableController` = "backend built, no UI" | **Wrong on both halves** | The frontend *does* call it (`pos.repository.ts:168,178,184`) and renders it at `/app/pos` → Floor View. The real gap is that **no create endpoint exists at all** — `TableController` has only `GET`, `PATCH /{id}`, `GET /{id}/active-order` (`TableController.java:29,38,48`) |
| `FileController` = "upload backend built, no UI" | **Confirmed** | 5 endpoints, zero callers; `grep` for `type="file"`/`FormData`/`multipart` across `app/ components/ lib/` returns **nothing** |
| Menu items have no image field | **Confirmed, deeper than stated** | No column in `V1__pos_schema.sql:31-47`, no field in the DTO (live `GET /api/v1/pos/menu/items/admin` returns keys `active, basePricePaisa, categoryId, categoryName, description, id, kdsStation, name, overridePricePaisa, stationId, taxRateCode, taxRatePct`), and no image reference anywhere in `services/pos-service/` |

---

## Direction 1 — backend endpoints with no frontend caller

### 1a. Fully orphaned surfaces (every endpoint in the controller is uncalled)

Ranked by product impact. **Live status** is the HTTP code observed through the gateway at :8080
with an `owner@terrace.local` bearer token.

| # | Surface | Service | Endpoints | Live status | What it means |
|---|---|---|---|---|---|
| 1 | `UserAdminController` `/api/v1/users/**` | user-service | 10 | `GET /api/v1/users` → **200**, returns all 8 seeded users | **The owner's user-management API works and has no UI.** There is no `user.repository.ts` in `frontend/lib/repositories/`. Only `e2e/journeys/tenant-admin-user-provisioning.spec.ts:55,65,96` touches it |
| 2 | `PlatformAdminController` `/api/v1/platform/tenants/**` | platform-admin | 13 | **403** for a tenant token (correct); surface reachable | Tenant CRUD, suspend/reactivate/cancel/purge, tier change, feature toggles, impersonate — all API-only. Nav links to `/platform/tenants`, which **404s** |
| 3 | `StationController` `/api/v1/pos/stations` | pos-service | 4 | **200**, returns `[]` | KDS station CRUD exists; no screen creates stations. Pairs with the uncalled `PUT /api/v1/pos/menu/items/{id}/station` — so an item can never be routed to a station from the UI |
| 4 | `FileController` `/api/v1/files/**` | file-service | 5 | `GET /api/v1/files` → **200**; `GET /api/v1/files/quota` → **500** | Upload/list/download/delete/quota all built. Zero upload UI anywhere. **The quota endpoint is additionally broken** |
| 5 | `TwoFactorController` `/api/v1/auth/2fa/**` | auth-service | 5 | reachable | Setup/verify/bootstrap/disable. Owner, admin and accountant are *forced* into TOTP, yet enrolment and reset are only possible via `scripts/generate_totp.py` |
| 6 | `BranchController` `/api/v1/branches` (5 of 6) | user-service | 5 | `GET /api/v1/branches` → **200** | Only `/branches/mine` is called (`branch.repository.ts:8`). Branch create/edit/delete has no UI — a tenant cannot add its second restaurant |
| 7 | `AttendanceDeviceController` `/api/v1/hr/devices` | hr-service | 3 | **503** (hr-service down at probe time) | Biometric-device registration for the ADMS/iclock ingest path. No UI |
| 8 | `WastageController` `/api/v1/inventory/wastage` | inventory-service | 2 | **200** with `branchId` | Record + list wastage. No screen. (`GET` without `branchId` → **400**, param is mandatory) |
| 9 | `RoleCatalogController` `/api/v1/roles`, `/api/v1/permissions` | auth-service | 2 | **200**, full catalog | The data every role-assignment UI needs, with no such UI |
| 10 | `PasswordResetController` `/api/v1/auth/reset-password/**` | auth-service | 2 | reachable | Forgot-password request + confirm. The login form has no "forgot password?" link |
| 11 | `FeedbackController` `/api/v1/crm/feedback` | crm-service | 2 | **200** | Customer feedback capture + list. Not on `/app/crm` |
| 12 | `AuditQueryController` `/api/v1/audit/events` | audit-service | 1 | **404** | See D4 — the compliance trail is unreachable *and* misreports why |
| 13 | `MyBranchesController` `/api/v1/auth/my-branches` | auth-service | 1 | **200** | **Duplicate surface.** The branch switcher uses `/api/v1/branches/mine` (user-service) instead. One of the two is dead weight |
| 14 | `PlatformUserAdminController` `.../users/{userId}/reset-password` | platform-admin | 1 | reachable | Superadmin password reset for a tenant user. No UI |

### 1b. Partially orphaned surfaces

Individual endpoints with no caller inside an otherwise-wired controller. These are the ones that
produce "the button just isn't there" complaints.

| Endpoint | Verb | Service | Why it matters |
|---|---|---|---|
| `/api/v1/pos/menu/items/{id}/station` | PUT | pos | Cannot route a menu item to a KDS station from the UI |
| `/api/v1/pos/menu/items/{id}` | DELETE | pos | Items can be deactivated but never deleted |
| `/api/v1/pos/orders/{id}/close` | POST | pos | Order close is API-only |
| `/api/v1/pos/orders/{id}/split` | POST | pos | **No split-bill UI** — a core restaurant workflow |
| `/api/v1/pos/orders/{id}/promotions/apply` | POST | pos | Promotions can be created (`/app/crm`) but never applied to an order |
| `/api/v1/branches` (POST/GET/PUT/DELETE + `/{id}`) | 5 verbs | user | Branch administration |
| `/api/v1/crm/customers/{id}` | GET/PUT/DELETE | crm | Customer detail-edit-delete; only search/create/`/detail` are wired |
| `/api/v1/hr/leave/requests` | GET | hr | Leave requests can be **created, approved and rejected but never listed** |
| `/api/v1/hr/leave/types` | POST | hr | Leave types are read and auto-defaulted, never created by a user |
| `/api/v1/hr/leave/accrue` | POST | hr | Accrual is API/cron-only |
| `/api/v1/hr/employees/{id}` | GET | hr | Single-employee fetch unused (list + update + deactivate are wired) |
| `/api/v1/hr/labour-cost/shift/{shiftId}` | GET | hr | Per-shift labour cost never surfaced |
| `/api/v1/finance/expenses/{id}` | GET | finance | No expense detail view |
| `/api/v1/finance/periods/{id}` | GET | finance | No period detail view |
| `/api/v1/finance/gl/{accountCode}/entries` | GET | finance | GL drill-down from a balance is missing |
| `/api/v1/inventory/categories/{id}` | GET | inventory | Category detail unused |
| `/api/v1/inventory/recipes/{menuItemId}/effective` | GET | inventory | Effective-recipe resolution never displayed |
| `/api/v1/auth/change-password` | POST | auth | **A signed-in user cannot change their own password** — only the *forced* first-login variant is wired |
| `/api/v1/auth/tenants/{slug}` | GET | auth | Tenant branding never fetched; login page shows the raw slug |
| `/api/v1/crm/promotions` | POST | crm | Promotions are listed but not created from the UI |

---

## Direction 2 — frontend calls with no backend mapping

**No REST call in application code targets a missing controller mapping.** Every `/api/v*` literal
under `frontend/lib/`, `frontend/app/`, `frontend/components/` and `frontend/hooks/` resolves to a
declared mapping with a matching verb.

Three WebSocket paths are not `@RestController` mappings and were verified separately:

| Path | Handler | Status |
|---|---|---|
| `/api/v1/pos/ws/orders/{branchId}` | `pos-service/config/WebSocketConfig.java:28` | Handler exists; **refused at the gateway** — see D4 |
| `/api/v1/kitchen/kds/{branchId}/{stationCode}` | kitchen-service | Allowed by gateway (`JwtGlobalFilter.java:112`) |
| `/api/v1/reporting/dashboard/{branchId}` | reporting-service | Allowed by gateway (`JwtGlobalFilter.java:111`) |

The only other unresolved literals are documentation strings and test fixtures — `ws-base-url.ts:26`
(`"/api/v1/..."` in a comment), `step-up.ts:12` (`"/api/v1/auth/2fa/**"`, a glob), and
`sidebar-nav-items.ts:121` (`"/api/v1/reporting/"` in a comment). None are requests.

---

## Direction 3 — routes in neither nav nor `app/`

`frontend/app/**` defines **53 routes**. Nav lives in `frontend/components/shared/` — **not**
`frontend/lib/nav/`, which does not exist.

### 3a. The one live dead link

| Nav entry | Target | Result |
|---|---|---|
| `sidebar-nav-items.ts:355-360` "Tenants" (`platformNavItems`) | `/platform/tenants` | **Live 404** — browser tab title `404: This page could not be found.` |

### 3b. Hidden, not dead — which is arguably worse

`use-nav-visibility.ts:51` and `:73` return `false` for any item with `comingSoon: true`. Three
entries are therefore **absent from the sidebar entirely** rather than showing as disabled:

| Entry | Target | Line |
|---|---|---|
| Settings › General | `/app/settings` | `sidebar-nav-items.ts:331-335` |
| Settings › Users | `/app/settings/users` | `sidebar-nav-items.ts:344-349` |
| Reporting | `/app/reporting` | `sidebar-nav-items.ts:295-301` |

Confirmed live: signed in as `manager@terrace.local`, the rendered sidebar is
`/app/dashboard, /app/pos, /app/kitchen, /app/pos/tills, /app/inventory, /app/menu/items,
/app/purchasing, /app/crm, /app/reports, /app/dashboard/realtime, /app/nlq` — **no Settings group at
all**. The entire Settings section collapses to nothing, so "settings and profile pages not working"
is precisely right: there is no entry point.

### 3c. A second, divergent nav list that only tests import

`sidebar-nav-items.ts` exports **two** tenant navigations:

- `tenantNavItems` (L59-145) — imported **only** by `__tests__/lib/nav-feature-flags.test.ts:7`
- `navGroups` (L148-352) — imported by `components/shared/sidebar.tsx:12`, the one that renders

They have diverged. `tenantNavItems:111-118` lists Reporting → `/app/reporting` **without**
`comingSoon`, while the live `navGroups:295-301` marks it `comingSoon: true` (flag at L300). A test asserting over
`tenantNavItems` is asserting over a list the product does not render.

### 3d. Routes with no nav entry

Reachable only by typing the URL or via in-page links: `/app/finance/*` (10 routes),
`/app/hr/*` (5), `/app/inventory/categories|coverage|ingredients|recipes|setup|stock`,
`/settings/appearance` (top-bar only), `/app/reports/fbr`, `/login/change-password`.
Finance and HR are permission-gated in `navGroups`, so this is expected for `manager`; the inventory
sub-pages are not.

---

## D4 — defects observed live that the table cannot express

| ID | Defect | Evidence |
|---|---|---|
| **L-1** | **POS live-order WebSocket refused for every user.** POS status indicator sits at "Polling"; 4 failed handshakes logged in one page load | `JwtGlobalFilter.java:110-113` — `WS_UPGRADE_PATHS = ["/api/v1/reporting/dashboard/", "/api/v1/kitchen/"]`. `/api/v1/pos/ws/` is absent, so the `?token=` query fallback never applies and a browser WebSocket (which cannot set an `Authorization` header) is rejected. Console: `WebSocket connection to 'ws://localhost:8080/api/v1/pos/ws/orders/34cd6f62-…?token=…' failed` ×4 |
| **L-2** | **37 menu categories, 15 named "Starters", 15 named "Mains", 5 "Drinks".** `/app/menu/items` renders ~40 sections, nearly all "No items in this category yet". The Add-item dialog's Category select lists 14 identical "Starters" | Live `GET /api/v1/pos/menu/categories/admin?branchId=…` → 37 rows. No uniqueness constraint on `(tenant_id, branch_id, name)` |
| **L-3** | **No image upload for a menu item — and no backend for one.** Add-item dialog fields are exactly Category, Name, Description, Price; `input[type=file]` count = **0** | `V1__pos_schema.sql:31-47` has no image column; DTO has no image key; `grep -rniE "image\|photo\|picture\|thumbnail" services/pos-service/` returns nothing |
| **L-4** | **No way to add a table.** `/app/pos` → Floor View renders "🪑 No tables configured" with no create control. Dashboard tile reads "Dining tables 0 / 0" | `TableController.java` has no `@PostMapping` (only L29 GET, L38 PATCH, L48 GET active-order). The `dining_tables` table itself is fully modelled — `V1__pos_schema.sql:115-129` including `table_number`, `capacity`, `floor_plan_x/y/shape`. **Schema built, no create API, no UI** |
| **L-5** | **Top-bar search is two hard-coded links.** `NAV_COMMANDS` = `[Dashboard, Appearance]` | `top-bar.tsx:95-98`. The palette's only other item, "Toggle theme" (`top-bar.tsx:247`), has `onSelect={() => setCmdOpen(false)}` — it closes the palette and **does nothing else** |
| **L-6** | **`GET /api/v1/files/quota` → 500** `INTERNAL_ERROR` while `GET /api/v1/files` → 200 | Live probe through gateway with owner token |
| **L-7** | **A down service is reported UP by Eureka and 404s at the gateway.** Eureka listed `AUDIT-SERVICE` and `AUTHORIZATION-SERVICE` as `UP` while ports 8093 and 8083 answered nothing (`curl` → `000`). `GET /api/v1/audit/events` returned **404**, not 503 — a client cannot distinguish "no such endpoint" from "service is down" | Live. `nlq-service` (port **8094**, per `services/nlq-service/src/main/resources/application.yml:2`) is dead **and** unregistered in Eureka, so `/app/nlq` has no backend at all — live `POST /api/v1/nlq/query` → **503**. Only **14** of 16 services are registered; `notification-service` has no Java sources under `services/notification-service/src/main/java/` either |

### Environment note (not a product finding)

`auth-service` crashed repeatedly during this audit with
`NoClassDefFoundError: ch/qos/logback/classic/spi/ThrowableProxy` — thrown the first time the service
tries to log an *exception*, so it boots clean, serves traffic, then dies. The jar itself passes
`unzip -t` and contains `logback-classic-1.5.34.jar`. A concurrent session was restarting the same
service (`.dev-logs/auth-service-uxaudit.log`), so port 8081 had multiple JVMs contending. Worth a
separate look; it is not an API/UI parity gap.

---

## Full endpoint table

`e2e/`, `__tests__/` and `mocks/` references are **not** counted as callers. Line numbers are the
mapping-annotation line, verified against source.

#### audit-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/audit/events` | GET | audit-service | **NONE** | **NONE** |

#### auth-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/auth/2fa/bootstrap` | POST | auth-service | **NONE** | **NONE** |
| `/api/v1/auth/2fa/bootstrap/verify` | POST | auth-service | **NONE** | **NONE** |
| `/api/v1/auth/2fa/disable` | POST | auth-service | **NONE** | **NONE** |
| `/api/v1/auth/2fa/setup` | POST | auth-service | **NONE** | **NONE** |
| `/api/v1/auth/2fa/verify` | POST | auth-service | **NONE** | **NONE** |
| `/api/v1/auth/change-password` | POST | auth-service | **NONE** | **NONE** |
| `/api/v1/auth/change-password/forced` | POST | auth-service | `lib/repositories/session.repository.ts:31` | /login/change-password |
| `/api/v1/auth/login` | POST | auth-service | `lib/api-client/client.ts:31` / `lib/repositories/session.repository.ts:11` | /login |
| `/api/v1/auth/logout` | POST | auth-service | `lib/repositories/session.repository.ts:21` | top-bar profile menu |
| `/api/v1/auth/my-branches` | GET | auth-service | **NONE** | **NONE** |
| `/api/v1/auth/refresh` | POST | auth-service | `lib/api-client/client.ts:31` / `lib/repositories/session.repository.ts:16` | (session) |
| `/api/v1/auth/reset-password/confirm` | POST | auth-service | **NONE** | **NONE** |
| `/api/v1/auth/reset-password/request` | POST | auth-service | **NONE** | **NONE** |
| `/api/v1/auth/switch-branch` | POST | auth-service | `lib/repositories/session.repository.ts:35` | top-bar branch switcher |
| `/api/v1/auth/tenants/{slug}` | GET | auth-service | **NONE** | **NONE** |
| `/api/v1/permissions` | GET | auth-service | **NONE** | **NONE** |
| `/api/v1/roles` | GET | auth-service | **NONE** | **NONE** |

#### crm-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/crm/customers` | GET | crm-service | **NONE** | **NONE** |
| `/api/v1/crm/customers` | POST | crm-service | `lib/repositories/crm.repository.ts:29` | /app/crm |
| `/api/v1/crm/customers/search` | GET | crm-service | `lib/repositories/crm.repository.ts:18` | /app/crm |
| `/api/v1/crm/customers/{id}` | DELETE | crm-service | **NONE** | **NONE** |
| `/api/v1/crm/customers/{id}` | GET | crm-service | **NONE** | **NONE** |
| `/api/v1/crm/customers/{id}` | PUT | crm-service | **NONE** | **NONE** |
| `/api/v1/crm/customers/{id}/detail` | GET | crm-service | `lib/repositories/crm.repository.ts:23` | /app/crm |
| `/api/v1/crm/feedback` | GET | crm-service | **NONE** | **NONE** |
| `/api/v1/crm/feedback` | POST | crm-service | **NONE** | **NONE** |
| `/api/v1/crm/promotions` | GET | crm-service | `lib/repositories/crm.repository.ts:41` | /app/crm |
| `/api/v1/crm/promotions` | POST | crm-service | **NONE** | **NONE** |

#### file-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/files` | GET | file-service | **NONE** | **NONE** |
| `/api/v1/files` | POST | file-service | **NONE** | **NONE** |
| `/api/v1/files/quota` | GET | file-service | **NONE** | **NONE** |
| `/api/v1/files/{id}` | DELETE | file-service | **NONE** | **NONE** |
| `/api/v1/files/{id}/download` | GET | file-service | **NONE** | **NONE** |

#### finance-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/finance/accounts` | GET | finance-service | `lib/repositories/finance.repository.ts:75` | /app/finance/accounts, /app/finance/accounts/[code] |
| `/api/v1/finance/accounts` | POST | finance-service | `lib/repositories/finance.repository.ts:75` | /app/finance/accounts, /app/finance/accounts/[code] |
| `/api/v1/finance/accounts/search` | GET | finance-service | `lib/repositories/finance.repository.ts:88` | /app/finance/accounts, /app/finance/accounts/[code] |
| `/api/v1/finance/accounts/setup/status` | GET | finance-service | `lib/repositories/finance.repository.ts:96` | /app/finance/accounts, /app/finance/accounts/[code] |
| `/api/v1/finance/accounts/{code}` | GET | finance-service | `lib/repositories/finance.repository.ts:83` | /app/finance/accounts, /app/finance/accounts/[code] |
| `/api/v1/finance/ap/aging` | GET | finance-service | `lib/repositories/finance.repository.ts:215` | /app/finance/ap-aging |
| `/api/v1/finance/ar/aging` | GET | finance-service | `lib/repositories/finance.repository.ts:265` | /app/finance/ar-aging |
| `/api/v1/finance/ar/charges` | POST | finance-service | `lib/repositories/finance.repository.ts:249` | /app/finance/house-accounts |
| `/api/v1/finance/ar/customer-accounts` | GET | finance-service | `lib/repositories/finance.repository.ts:226` | /app/finance/house-accounts |
| `/api/v1/finance/ar/customer-accounts` | POST | finance-service | `lib/repositories/finance.repository.ts:226` / `lib/repositories/finance.repository.ts:236` | /app/finance/house-accounts |
| `/api/v1/finance/ar/customer-accounts/{id}/statement` | GET | finance-service | `lib/repositories/finance.repository.ts:243` | /app/finance/house-accounts |
| `/api/v1/finance/ar/settlements` | POST | finance-service | `lib/repositories/finance.repository.ts:256` | /app/finance/house-accounts |
| `/api/v1/finance/expenses` | GET | finance-service | `lib/repositories/finance.repository.ts:184` | /app/finance/expenses |
| `/api/v1/finance/expenses` | POST | finance-service | `lib/repositories/finance.repository.ts:190` | /app/finance/expenses |
| `/api/v1/finance/expenses/{id}` | GET | finance-service | **NONE** | **NONE** |
| `/api/v1/finance/expenses/{id}/approve` | POST | finance-service | `lib/repositories/finance.repository.ts:195` | /app/finance/expenses |
| `/api/v1/finance/expenses/{id}/reject` | POST | finance-service | `lib/repositories/finance.repository.ts:204` | /app/finance/expenses |
| `/api/v1/finance/gl/balances` | GET | finance-service | `lib/repositories/finance.repository.ts:172` | /app/finance/gl |
| `/api/v1/finance/gl/{accountCode}/entries` | GET | finance-service | **NONE** | **NONE** |
| `/api/v1/finance/journal-entries` | GET | finance-service | `lib/repositories/finance.repository.ts:110` | /app/finance/journal-entries* |
| `/api/v1/finance/journal-entries` | POST | finance-service | `lib/repositories/finance.repository.ts:110` / `lib/repositories/finance.repository.ts:123` | /app/finance/journal-entries* |
| `/api/v1/finance/journal-entries/{id}` | GET | finance-service | `lib/repositories/finance.repository.ts:118` | /app/finance/journal-entries* |
| `/api/v1/finance/journal-entries/{id}/post` | POST | finance-service | `lib/repositories/finance.repository.ts:128` | /app/finance/journal-entries* |
| `/api/v1/finance/journal-entries/{id}/reverse` | POST | finance-service | `lib/repositories/finance.repository.ts:133` | /app/finance/journal-entries* |
| `/api/v1/finance/periods` | GET | finance-service | `lib/repositories/finance.repository.ts:142` | /app/finance/periods |
| `/api/v1/finance/periods/open` | GET | finance-service | `lib/repositories/finance.repository.ts:147` | /app/finance/periods |
| `/api/v1/finance/periods/provision` | POST | finance-service | `lib/repositories/finance.repository.ts:163` | /app/finance/periods |
| `/api/v1/finance/periods/{id}` | GET | finance-service | **NONE** | **NONE** |
| `/api/v1/finance/periods/{id}/close` | POST | finance-service | `lib/repositories/finance.repository.ts:158` | /app/finance/periods |

#### hr-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/hr/attendance/quarantine` | GET | hr-service | `lib/repositories/hr.repository.ts:217` | /app/hr/attendance |
| `/api/v1/hr/attendance/quarantine/{id}/resolve` | POST | hr-service | `lib/repositories/hr.repository.ts:222` | /app/hr/attendance |
| `/api/v1/hr/attendance/{employeeId}/clock-in` | POST | hr-service | `lib/repositories/hr.repository.ts:167` | /app/hr/attendance |
| `/api/v1/hr/attendance/{employeeId}/clock-out` | POST | hr-service | `lib/repositories/hr.repository.ts:171` | /app/hr/attendance |
| `/api/v1/hr/attendance/{employeeId}/punches` | GET | hr-service | `lib/repositories/hr.repository.ts:175` | /app/hr/attendance |
| `/api/v1/hr/attendance/{employeeId}/summary` | GET | hr-service | `lib/repositories/hr.repository.ts:179` | /app/hr/attendance |
| `/api/v1/hr/devices` | GET | hr-service | **NONE** | **NONE** |
| `/api/v1/hr/devices` | POST | hr-service | **NONE** | **NONE** |
| `/api/v1/hr/devices/{id}` | DELETE | hr-service | **NONE** | **NONE** |
| `/api/v1/hr/employees` | GET | hr-service | `lib/repositories/hr.repository.ts:70` | /app/hr/employees |
| `/api/v1/hr/employees` | POST | hr-service | `lib/repositories/hr.repository.ts:75` | /app/hr/employees |
| `/api/v1/hr/employees/{id}` | DELETE | hr-service | `lib/repositories/hr.repository.ts:86` | /app/hr/employees |
| `/api/v1/hr/employees/{id}` | GET | hr-service | **NONE** | **NONE** |
| `/api/v1/hr/employees/{id}` | PUT | hr-service | `lib/repositories/hr.repository.ts:82` | /app/hr/employees |
| `/api/v1/hr/labour-cost/branch/{branchId}` | GET | hr-service | `lib/repositories/hr.repository.ts:232` | /app/hr/schedule |
| `/api/v1/hr/labour-cost/shift/{shiftId}` | GET | hr-service | **NONE** | **NONE** |
| `/api/v1/hr/leave/accrue` | POST | hr-service | **NONE** | **NONE** |
| `/api/v1/hr/leave/balances` | GET | hr-service | `lib/repositories/hr.repository.ts:211` | /app/hr |
| `/api/v1/hr/leave/requests` | GET | hr-service | **NONE** | **NONE** |
| `/api/v1/hr/leave/requests` | POST | hr-service | `lib/repositories/hr.repository.ts:199` | /app/hr |
| `/api/v1/hr/leave/requests/{id}/approve` | POST | hr-service | `lib/repositories/hr.repository.ts:203` | /app/hr |
| `/api/v1/hr/leave/requests/{id}/reject` | POST | hr-service | `lib/repositories/hr.repository.ts:207` | /app/hr |
| `/api/v1/hr/leave/types` | GET | hr-service | `lib/repositories/hr.repository.ts:185` | /app/hr |
| `/api/v1/hr/leave/types` | POST | hr-service | **NONE** | **NONE** |
| `/api/v1/hr/leave/types/defaults` | POST | hr-service | `lib/repositories/hr.repository.ts:189` | /app/hr |
| `/api/v1/hr/payroll-runs` | GET | hr-service | `lib/repositories/hr.repository.ts:100` / `lib/repositories/hr.repository.ts:91` | /app/hr/payroll |
| `/api/v1/hr/payroll-runs` | POST | hr-service | `lib/repositories/hr.repository.ts:100` | /app/hr/payroll |
| `/api/v1/hr/payroll-runs/{id}` | GET | hr-service | `lib/repositories/hr.repository.ts:95` | /app/hr/payroll |
| `/api/v1/hr/payroll-runs/{id}/approve` | POST | hr-service | `lib/repositories/hr.repository.ts:119` | /app/hr/payroll |
| `/api/v1/hr/payroll-runs/{id}/calculate` | POST | hr-service | `lib/repositories/hr.repository.ts:107` | /app/hr/payroll |
| `/api/v1/hr/payroll-runs/{id}/pay` | POST | hr-service | `lib/repositories/hr.repository.ts:123` | /app/hr/payroll |
| `/api/v1/hr/payroll-runs/{id}/payslips` | GET | hr-service | `lib/repositories/hr.repository.ts:127` | /app/hr/payroll |
| `/api/v1/hr/shifts` | POST | hr-service | `lib/repositories/hr.repository.ts:137` | /app/hr/schedule |
| `/api/v1/hr/shifts/assignments` | POST | hr-service | `lib/repositories/hr.repository.ts:145` | /app/hr/schedule |
| `/api/v1/hr/shifts/assignments/move` | POST | hr-service | `lib/repositories/hr.repository.ts:158` | /app/hr/schedule |
| `/api/v1/hr/shifts/assignments/{assignmentId}` | DELETE | hr-service | `lib/repositories/hr.repository.ts:162` | /app/hr/schedule |
| `/api/v1/hr/shifts/week` | GET | hr-service | `lib/repositories/hr.repository.ts:133` | /app/hr/schedule |
| `/api/v1/hr/shifts/{id}` | DELETE | hr-service | `lib/repositories/hr.repository.ts:141` | /app/hr/schedule |
| `/api/v1/hr/shifts/{id}` | PUT | hr-service | **NONE** | **NONE** |

#### inventory-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/inventory/categories` | GET | inventory-service | `lib/repositories/inventory.repository.ts:99` | /app/inventory/categories |
| `/api/v1/inventory/categories` | POST | inventory-service | `lib/repositories/inventory.repository.ts:110` | /app/inventory/categories |
| `/api/v1/inventory/categories/tree` | GET | inventory-service | `lib/repositories/inventory.repository.ts:104` | /app/inventory/categories |
| `/api/v1/inventory/categories/{id}` | GET | inventory-service | **NONE** | **NONE** |
| `/api/v1/inventory/categories/{id}` | PUT | inventory-service | `lib/repositories/inventory.repository.ts:118` | /app/inventory/categories |
| `/api/v1/inventory/categories/{id}/archive` | POST | inventory-service | `lib/repositories/inventory.repository.ts:135` | /app/inventory/categories |
| `/api/v1/inventory/categories/{id}/parent` | PUT | inventory-service | `lib/repositories/inventory.repository.ts:127` | /app/inventory/categories |
| `/api/v1/inventory/categories/{id}/restore` | POST | inventory-service | `lib/repositories/inventory.repository.ts:140` | /app/inventory/categories |
| `/api/v1/inventory/counts` | POST | inventory-service | `lib/repositories/inventory.repository.ts:323` | /app/inventory/stock |
| `/api/v1/inventory/gl-accounts` | GET | inventory-service | `lib/repositories/inventory.repository.ts:151` | /app/inventory/setup |
| `/api/v1/inventory/ingredients` | GET | inventory-service | `lib/repositories/inventory.repository.ts:157` | /app/inventory/ingredients |
| `/api/v1/inventory/ingredients` | POST | inventory-service | `lib/repositories/inventory.repository.ts:172` | /app/inventory/ingredients |
| `/api/v1/inventory/ingredients/{id}` | GET | inventory-service | `lib/repositories/inventory.repository.ts:166` | /app/inventory/ingredients |
| `/api/v1/inventory/ingredients/{id}` | PUT | inventory-service | `lib/repositories/inventory.repository.ts:180` | /app/inventory/ingredients |
| `/api/v1/inventory/ingredients/{id}/archive` | POST | inventory-service | `lib/repositories/inventory.repository.ts:188` | /app/inventory/ingredients |
| `/api/v1/inventory/ingredients/{id}/restore` | POST | inventory-service | `lib/repositories/inventory.repository.ts:193` | /app/inventory/ingredients |
| `/api/v1/inventory/menu-items` | GET | inventory-service | `lib/repositories/inventory.repository.ts:93` | /app/inventory/recipes |
| `/api/v1/inventory/opening-balance` | POST | inventory-service | `lib/repositories/inventory.repository.ts:290` | /app/inventory/stock |
| `/api/v1/inventory/receipts` | POST | inventory-service | `lib/repositories/inventory.repository.ts:296` | /app/inventory/stock |
| `/api/v1/inventory/recipes` | GET | inventory-service | `lib/repositories/inventory.repository.ts:262` | /app/inventory/recipes, /app/inventory/recipes/[menuItemId] |
| `/api/v1/inventory/recipes` | POST | inventory-service | `lib/repositories/inventory.repository.ts:257` | /app/inventory/recipes, /app/inventory/recipes/[menuItemId] |
| `/api/v1/inventory/recipes/coverage` | GET | inventory-service | `lib/repositories/inventory.repository.ts:274` | /app/inventory/coverage |
| `/api/v1/inventory/recipes/options` | GET | inventory-service | `lib/repositories/inventory.repository.ts:268` | /app/inventory/recipes, /app/inventory/recipes/[menuItemId] |
| `/api/v1/inventory/recipes/preview` | POST | inventory-service | `lib/repositories/inventory.repository.ts:281` | /app/inventory/recipes, /app/inventory/recipes/[menuItemId] |
| `/api/v1/inventory/recipes/{menuItemId}/effective` | GET | inventory-service | **NONE** | **NONE** |
| `/api/v1/inventory/stock` | GET | inventory-service | `lib/repositories/inventory.repository.ts:250` | /app/inventory/stock |
| `/api/v1/inventory/storage-locations` | GET | inventory-service | `lib/repositories/inventory.repository.ts:212` | /app/inventory/setup |
| `/api/v1/inventory/storage-locations` | POST | inventory-service | `lib/repositories/inventory.repository.ts:218` | /app/inventory/setup |
| `/api/v1/inventory/storage-locations/{id}` | PUT | inventory-service | `lib/repositories/inventory.repository.ts:229` | /app/inventory/setup |
| `/api/v1/inventory/storage-locations/{id}/archive` | POST | inventory-service | `lib/repositories/inventory.repository.ts:238` | /app/inventory/setup |
| `/api/v1/inventory/storage-locations/{id}/restore` | POST | inventory-service | `lib/repositories/inventory.repository.ts:243` | /app/inventory/setup |
| `/api/v1/inventory/transfers/pending` | GET | inventory-service | `lib/repositories/inventory.repository.ts:318` | /app/inventory/stock |
| `/api/v1/inventory/transfers/receive` | POST | inventory-service | `lib/repositories/inventory.repository.ts:310` | /app/inventory/stock |
| `/api/v1/inventory/transfers/ship` | POST | inventory-service | `lib/repositories/inventory.repository.ts:302` | /app/inventory/stock |
| `/api/v1/inventory/uom` | GET | inventory-service | `lib/repositories/inventory.repository.ts:198` | /app/inventory/setup |
| `/api/v1/inventory/uom` | POST | inventory-service | `lib/repositories/inventory.repository.ts:206` | /app/inventory/setup |
| `/api/v1/inventory/wastage` | GET | inventory-service | **NONE** | **NONE** |
| `/api/v1/inventory/wastage` | POST | inventory-service | **NONE** | **NONE** |

#### kitchen-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/kitchen/kds/stations` | GET | kitchen-service | `lib/repositories/kds.repository.ts:83` | /app/kitchen, /app/kitchen/[stationCode] |
| `/api/v1/kitchen/kds/tickets` | GET | kitchen-service | `lib/repositories/kds.repository.ts:21` | /app/kitchen, /app/kitchen/[stationCode] |
| `/api/v1/kitchen/kds/tickets/{ticketId}` | GET | kitchen-service | `lib/repositories/kds.repository.ts:74` | /app/kitchen, /app/kitchen/[stationCode] |
| `/api/v1/kitchen/kds/tickets/{ticketId}/items/{itemId}/bump` | POST | kitchen-service | `lib/repositories/kds.repository.ts:30` | /app/kitchen, /app/kitchen/[stationCode] |
| `/api/v1/kitchen/kds/tickets/{ticketId}/items/{itemId}/status` | POST | kitchen-service | `lib/repositories/kds.repository.ts:50` | /app/kitchen, /app/kitchen/[stationCode] |
| `/api/v1/kitchen/kds/tickets/{ticketId}/recall` | POST | kitchen-service | `lib/repositories/kds.repository.ts:59` | /app/kitchen, /app/kitchen/[stationCode] |

#### nlq-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/nlq/query` | POST | nlq-service | `components/nlq/NlqRejectionNotice.tsx:7` / `lib/models/nlq.model.ts:29` | /app/nlq |

#### platform-admin-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/feature-flags` | GET | platform-admin-service | `lib/repositories/feature.repository.ts:10` | (all tenant screens) |
| `/api/v1/platform/auth/login` | POST | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants` | GET | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants` | POST | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants/{tenantId}` | DELETE | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants/{tenantId}` | GET | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants/{tenantId}` | PATCH | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants/{tenantId}/cancel` | POST | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants/{tenantId}/features` | GET | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants/{tenantId}/features/{featureCode}` | PATCH | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants/{tenantId}/impersonate` | POST | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants/{tenantId}/reactivate` | POST | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants/{tenantId}/retry-provisioning` | POST | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants/{tenantId}/suspend` | POST | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants/{tenantId}/tier` | POST | platform-admin-service | **NONE** | **NONE** |
| `/api/v1/platform/tenants/{tenantId}/users/{userId}/reset-password` | POST | platform-admin-service | **NONE** | **NONE** |

#### pos-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/pos/menu/categories` | GET | pos-service | `lib/repositories/pos.repository.ts:72` | /app/menu/items |
| `/api/v1/pos/menu/categories` | POST | pos-service | `lib/repositories/pos.repository.ts:137` | /app/menu/items |
| `/api/v1/pos/menu/categories/admin` | GET | pos-service | `lib/repositories/pos.repository.ts:100` | /app/menu/items |
| `/api/v1/pos/menu/categories/{id}` | PUT | pos-service | `lib/repositories/pos.repository.ts:145` | /app/menu/items |
| `/api/v1/pos/menu/categories/{id}/activate` | PATCH | pos-service | `lib/repositories/pos.repository.ts:151` | /app/menu/items |
| `/api/v1/pos/menu/categories/{id}/deactivate` | PATCH | pos-service | `lib/repositories/pos.repository.ts:159` | /app/menu/items |
| `/api/v1/pos/menu/items` | GET | pos-service | `lib/repositories/pos.repository.ts:79` | /app/menu/items |
| `/api/v1/pos/menu/items` | POST | pos-service | `lib/repositories/pos.repository.ts:108` | /app/menu/items |
| `/api/v1/pos/menu/items/admin` | GET | pos-service | `lib/repositories/pos.repository.ts:92` | /app/menu/items |
| `/api/v1/pos/menu/items/{id}` | DELETE | pos-service | **NONE** | **NONE** |
| `/api/v1/pos/menu/items/{id}` | GET | pos-service | `lib/repositories/pos.repository.ts:84` | /app/menu/items |
| `/api/v1/pos/menu/items/{id}` | PUT | pos-service | `lib/repositories/pos.repository.ts:118` | /app/menu/items |
| `/api/v1/pos/menu/items/{id}/activate` | PATCH | pos-service | `lib/repositories/pos.repository.ts:123` | /app/menu/items |
| `/api/v1/pos/menu/items/{id}/deactivate` | PATCH | pos-service | `lib/repositories/pos.repository.ts:129` | /app/menu/items |
| `/api/v1/pos/menu/items/{id}/station` | PUT | pos-service | **NONE** | **NONE** |
| `/api/v1/pos/orders` | GET | pos-service | `lib/repositories/pos.repository.ts:216` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders` | POST | pos-service | `lib/repositories/pos.repository.ts:193` / `lib/repositories/pos.repository.ts:216` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}` | GET | pos-service | `lib/repositories/pos.repository.ts:201` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}/close` | POST | pos-service | **NONE** | **NONE** |
| `/api/v1/pos/orders/{id}/discounts` | POST | pos-service | `lib/repositories/pos.repository.ts:239` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}/instructions` | PATCH | pos-service | `lib/repositories/pos.repository.ts:263` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}/items` | POST | pos-service | `lib/repositories/pos.repository.ts:226` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}/items/{itemId}` | DELETE | pos-service | `lib/repositories/pos.repository.ts:232` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}/items/{itemId}/cancel` | POST | pos-service | `lib/repositories/pos.repository.ts:298` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}/items/{itemId}/serve` | POST | pos-service | `lib/repositories/pos.repository.ts:285` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}/payments` | GET | pos-service | `lib/repositories/pos.repository.ts:309` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}/payments` | POST | pos-service | `lib/repositories/pos.repository.ts:324` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}/promotions/apply` | POST | pos-service | **NONE** | **NONE** |
| `/api/v1/pos/orders/{id}/refund` | POST | pos-service | `lib/repositories/pos.repository.ts:349` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}/send-to-kds` | POST | pos-service | `lib/repositories/pos.repository.ts:252` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}/split` | POST | pos-service | **NONE** | **NONE** |
| `/api/v1/pos/orders/{id}/table` | PATCH | pos-service | `lib/repositories/pos.repository.ts:278` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/orders/{id}/void` | POST | pos-service | `lib/repositories/pos.repository.ts:336` | /app/pos, /app/pos/orders/[orderId]/charge |
| `/api/v1/pos/stations` | GET | pos-service | **NONE** | **NONE** |
| `/api/v1/pos/stations` | POST | pos-service | **NONE** | **NONE** |
| `/api/v1/pos/stations/{id}` | DELETE | pos-service | **NONE** | **NONE** |
| `/api/v1/pos/stations/{id}` | PUT | pos-service | **NONE** | **NONE** |
| `/api/v1/pos/tables` | GET | pos-service | `lib/repositories/pos.repository.ts:168` | /app/pos (Floor View tab) |
| `/api/v1/pos/tables/{id}` | PATCH | pos-service | `lib/repositories/pos.repository.ts:178` | /app/pos (Floor View tab) |
| `/api/v1/pos/tables/{id}/active-order` | GET | pos-service | `lib/repositories/pos.repository.ts:184` | /app/pos (Floor View tab) |
| `/api/v1/pos/tills` | GET | pos-service | `lib/repositories/pos.repository.ts:360` / `lib/repositories/pos.repository.ts:400` | /app/pos/tills |
| `/api/v1/pos/tills` | POST | pos-service | `lib/repositories/pos.repository.ts:367` / `lib/repositories/pos.repository.ts:400` | /app/pos/tills |
| `/api/v1/pos/tills/{id}` | GET | pos-service | `lib/repositories/pos.repository.ts:385` | /app/pos/tills |
| `/api/v1/pos/tills/{id}/approve` | POST | pos-service | `lib/repositories/pos.repository.ts:420` | /app/pos/tills |
| `/api/v1/pos/tills/{id}/close` | POST | pos-service | `lib/repositories/pos.repository.ts:377` | /app/pos/tills |
| `/api/v1/pos/tills/{id}/flag` | POST | pos-service | `lib/repositories/pos.repository.ts:425` | /app/pos/tills |
| `/api/v1/pos/tills/{id}/note` | POST | pos-service | `lib/repositories/pos.repository.ts:431` | /app/pos/tills |
| `/api/v1/pos/tills/{id}/reconciliation` | GET | pos-service | `lib/repositories/pos.repository.ts:412` | /app/pos/tills |
| `/api/v1/pos/tills/{id}/review-actions` | GET | pos-service | `lib/repositories/pos.repository.ts:439` | /app/pos/tills |

#### purchasing-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/purchasing/analytics/scorecard` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:294` | /app/purchasing/analytics |
| `/api/v1/purchasing/analytics/spend` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:289` | /app/purchasing/analytics |
| `/api/v1/purchasing/bank-accounts` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:284` | /app/purchasing/payments |
| `/api/v1/purchasing/invoices` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:236` | /app/purchasing/invoices* |
| `/api/v1/purchasing/invoices` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:247` | /app/purchasing/invoices* |
| `/api/v1/purchasing/invoices/{id}` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:254` | /app/purchasing/invoices* |
| `/api/v1/purchasing/invoices/{id}/override-match` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:261` | /app/purchasing/invoices* |
| `/api/v1/purchasing/order-suggestions` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:301` | /app/purchasing/order-suggestions |
| `/api/v1/purchasing/order-suggestions/drafts` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:310` | /app/purchasing/order-suggestions |
| `/api/v1/purchasing/payments` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:274` | /app/purchasing/payments |
| `/api/v1/purchasing/purchase-orders` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:173` | /app/purchasing/purchase-orders* |
| `/api/v1/purchasing/purchase-orders` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:179` | /app/purchasing/purchase-orders* |
| `/api/v1/purchasing/purchase-orders/{id}` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:214` | /app/purchasing/purchase-orders* |
| `/api/v1/purchasing/purchase-orders/{id}/approve` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:196` | /app/purchasing/purchase-orders* |
| `/api/v1/purchasing/purchase-orders/{id}/close` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:226` | /app/purchasing/purchase-orders* |
| `/api/v1/purchasing/purchase-orders/{id}/reject` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:202` | /app/purchasing/purchase-orders* |
| `/api/v1/purchasing/purchase-orders/{id}/send` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:209` | /app/purchasing/purchase-orders* |
| `/api/v1/purchasing/purchase-orders/{id}/submit` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:186` | /app/purchasing/purchase-orders* |
| `/api/v1/purchasing/purchase-orders/{id}/withdraw` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:191` | /app/purchasing/purchase-orders* |
| `/api/v1/purchasing/purchase-orders/{poId}/mock-receive` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:222` | /app/purchasing/purchase-orders* |
| `/api/v1/purchasing/vendor-items/{id}` | PUT | purchasing-service | `lib/repositories/purchasing.repository.ts:110` | /app/purchasing/vendors/[id] |
| `/api/v1/purchasing/vendor-items/{id}/archive` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:118` | /app/purchasing/vendors/[id] |
| `/api/v1/purchasing/vendor-items/{id}/prices` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:123` | /app/purchasing/vendors/[id] |
| `/api/v1/purchasing/vendor-items/{id}/prices` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:137` | /app/purchasing/vendors/[id] |
| `/api/v1/purchasing/vendors` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:68` | /app/purchasing/vendors, /app/purchasing/vendors/[id] |
| `/api/v1/purchasing/vendors` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:73` | /app/purchasing/vendors, /app/purchasing/vendors/[id] |
| `/api/v1/purchasing/vendors/{id}` | PUT | purchasing-service | `lib/repositories/purchasing.repository.ts:78` | /app/purchasing/vendors, /app/purchasing/vendors/[id] |
| `/api/v1/purchasing/vendors/{vendorId}/categories` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:153` | /app/purchasing/vendors, /app/purchasing/vendors/[id] |
| `/api/v1/purchasing/vendors/{vendorId}/categories` | PUT | purchasing-service | `lib/repositories/purchasing.repository.ts:163` | /app/purchasing/vendors, /app/purchasing/vendors/[id] |
| `/api/v1/purchasing/vendors/{vendorId}/items` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:89` | /app/purchasing/vendors, /app/purchasing/vendors/[id] |
| `/api/v1/purchasing/vendors/{vendorId}/items` | POST | purchasing-service | `lib/repositories/purchasing.repository.ts:101` / `lib/repositories/purchasing.repository.ts:89` | /app/purchasing/vendors, /app/purchasing/vendors/[id] |
| `/api/v1/purchasing/vendors/{vendorId}/price-changes` | GET | purchasing-service | `lib/repositories/purchasing.repository.ts:144` | /app/purchasing/vendors, /app/purchasing/vendors/[id] |

#### reporting-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/reporting/dashboard/{branchId}/tiles` | GET | reporting-service | `lib/repositories/reporting.repository.ts:62` | /app/dashboard/realtime |
| `/api/v1/reporting/reports` | GET | reporting-service | `lib/repositories/reporting.repository.ts:27` | /app/reports, /app/reports/[code] |
| `/api/v1/reporting/reports/fbr-tax-summary` | GET | reporting-service | `lib/repositories/reporting.repository.ts:49` | /app/reports/fbr |
| `/api/v1/reporting/reports/{code}/run` | POST | reporting-service | `lib/repositories/reporting.repository.ts:43` | /app/reports, /app/reports/[code] |

#### user-service

| Endpoint | Verb | Owning service | Frontend caller | UI screen |
|---|---|---|---|---|
| `/api/v1/branches` | GET | user-service | **NONE** | **NONE** |
| `/api/v1/branches` | POST | user-service | **NONE** | **NONE** |
| `/api/v1/branches/mine` | GET | user-service | `lib/repositories/branch.repository.ts:8` | top-bar branch switcher |
| `/api/v1/branches/{id}` | DELETE | user-service | **NONE** | **NONE** |
| `/api/v1/branches/{id}` | GET | user-service | **NONE** | **NONE** |
| `/api/v1/branches/{id}` | PUT | user-service | **NONE** | **NONE** |
| `/api/v1/users` | GET | user-service | **NONE** | **NONE** |
| `/api/v1/users` | POST | user-service | **NONE** | **NONE** |
| `/api/v1/users/{userId}` | GET | user-service | **NONE** | **NONE** |
| `/api/v1/users/{userId}` | PATCH | user-service | **NONE** | **NONE** |
| `/api/v1/users/{userId}/branch-roles` | DELETE | user-service | **NONE** | **NONE** |
| `/api/v1/users/{userId}/branch-roles` | POST | user-service | **NONE** | **NONE** |
| `/api/v1/users/{userId}/deactivate` | POST | user-service | **NONE** | **NONE** |
| `/api/v1/users/{userId}/permissions` | GET | user-service | **NONE** | **NONE** |
| `/api/v1/users/{userId}/reactivate` | POST | user-service | **NONE** | **NONE** |
| `/api/v1/users/{userId}/reset-password` | POST | user-service | **NONE** | **NONE** |