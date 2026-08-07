# Onboarding gap audit — what a brand-new tenant genuinely cannot do

Audit date: 2026-08-07
Branch: `phase-13-access-repair` @ `5fba4a9`
Method: a real tenant was provisioned through the real API and then driven through the browser.
Design under test: `.planning/research/adaptivity/onboarding.md`

## How this was produced

A genuinely fresh tenant was created over HTTP through the gateway, exactly as
`scripts/e2e/phase13-provisioning-e2e.sh` does it:

```
POST /api/v1/platform/tenants  {"brandName":"Gap Audit Bistro","adminEmail":"owner@gap-audit-bistro.local","tier":"GROWTH"}
→ 201  tenantId a904ceb3-6c12-4201-8df8-8f5167abe750, slug gap-audit-bistro, tempPassword issued once
```

Provisioning itself works. The tenant row, the HQ branch (`c00eef21-…`, `Gap Audit Bistro HQ`), the
auth tenant, the OWNER account and the 20 tier feature flags were all created. Everything below is
what happened when that owner then tried to open a restaurant with it.

Every finding cites a file+line, an observed HTTP status, or a database row. Three things I initially
suspected were **discarded as tooling or environment artifacts** rather than reported: an apparent
redirect loop on the change-password screen (a second browser tab, not the app), an apparently
missing "Add category" button (a mid-load snapshot — it renders once feature flags settle), and
cross-tenant menu rows in the UI (the shared dev browser held another agent's `floating-terrace`
session; the database proves RLS holds, `menu_items` for this tenant returned `0`). Services 503'd
repeatedly throughout because other agents were rebuilding jars concurrently; those are noted and
excluded.

---

## 1. The headline: the tenant is dead on arrival

**A brand-new tenant's owner cannot log in at all, and the UI tells them to ask someone who does not
exist.**

The sequence, all observed live:

| Step | Result |
|---|---|
| `POST /api/v1/auth/login` with the temp password | `403 PASSWORD_CHANGE_REQUIRED` + `changeToken` |
| UI catches it, redirects to `/login/change-password?token=…` | **works** — the screen exists and renders |
| `POST /api/v1/auth/change-password/forced` | `200` — password set |
| `POST /api/v1/auth/login` with the new password | **`401 TOTP_ENROLLMENT_REQUIRED`** |
| What the UI shows | *"This account requires two-factor authentication, which has not been set up yet. **Ask an administrator to complete enrolment before signing in.**"* |

The owner **is** the administrator. It is the only account in the tenant. There is no second user to
ask, and there is no enrolment screen.

The backend anticipated this exactly. `TwoFactorController`
(`services/auth-service/src/main/java/io/restaurantos/auth/controller/TwoFactorController.java:35-50`)
exposes `POST /api/v1/auth/2fa/bootstrap` and `/bootstrap/verify`, unauthenticated by necessity and
re-authenticated by password, with a javadoc that says it exists "for a user the step-up rule locks
out before they can hold a token". It works — I used it to break the deadlock and enrol the owner
out of band, which is how the rest of this audit was possible.

**The frontend never calls it.** A repo-wide grep over `frontend/app`, `frontend/components` and
`frontend/lib` for `2fa` returns exactly two hits and both are comments
(`lib/auth/step-up.ts:12`, `lib/errors/api-error.ts:55`). The only code that mentions enrolment is
the branch that renders the dead-end message: `components/auth/login-form.tsx:174-186`.

Re-checked against the working tree at the end of the audit: another agent has an uncommitted
317-line rewrite of `login-form.tsx` in flight, and it still contains this exact dead-end at
lines 174-184 and still makes no call to `/api/v1/auth/2fa/**`. The finding is current, not stale.

This is the single most important finding in the audit, and **it is not in the design document's gap
register at all.** The document names G-1 (no `PASSWORD_CHANGE_REQUIRED` handling) as the blocker
that makes onboarding impassable. G-1 has since been fixed — `app/(auth)/login/change-password/page.tsx`
and `components/auth/forced-password-change-form.tsx` both exist and I drove them successfully. The
gate immediately behind it is worse, and undocumented.

Compounding it: `services/notification-service` contains **zero** `.java` files. The temp password,
and now the TOTP secret, must be hand-carried out of band by a human.

---

## 2. There is no onboarding surface, and no way to provision without curl

| Thing | Observed |
|---|---|
| `GET /api/v1/onboarding` | **404** |
| `GET /api/v1/tenant-profile` | **404** |
| Any `onboarding`/`setup`/`wizard` route under `frontend/app` | none |
| `/platform/tenants` — the SuperAdmin tenant list | **404** in the browser, while authenticated |
| `/platform/dashboard` | exists, and is a **9-line placeholder** (`app/(platform)/platform/dashboard/page.tsx`) |

`/platform/tenants` is declared in `components/shared/sidebar-nav-items.ts:357` in `platformNavItems`
with `permission: "platform:tenant:read"` and — unlike the tenant-side unbuilt items — **without**
`comingSoon: true`. So a SuperAdmin sees a "Tenants" item in the nav and clicking it 404s. That is a
genuine dead link.

Credit where due: the three tenant-side unbuilt entries (`/app/settings`, `/app/settings/users`,
`/app/reporting`) *are* marked `comingSoon` and `lib/hooks/auth/use-nav-visibility.ts:51-53,73-75`
filters them out of both the sidebar and the mobile bar. They are not dead links. They are simply
absent screens — which for `Users` is itself a blocker (§4).

---

## 3. What the owner can and cannot do, step by step

Legend: **BACKEND_NO_UI** = the API works, nothing in the UI reaches it · **NEITHER** = no API and no
UI · **SILENT** = the API accepts the request, returns success, and discards the data.

### Branches — BACKEND_NO_UI, plus two live defects

The API is real. As the new owner: `GET /api/v1/branches` → `200`, `POST /api/v1/branches` → `201`.
The frontend's only branch call is `BranchRepository.listMine()` →
`GET /api/v1/branches/mine` (`frontend/lib/repositories/branch.repository.ts`, 11 lines, one method).
There is no branch screen and no `/app/branches` route. An owner cannot rename the saga-created
`"<brand> HQ"`, set its address, or add a second outlet.

**3a. NTN and STRN are accepted, returned 200, and thrown away.** This is G-2, and it is worse than
the design document describes, because it does not fail — it *succeeds*:

```
PUT /api/v1/branches/c00eef21-… {"name":"Gap Audit Bistro Main","ntn":"1234567-8","fbrStrn":"0300123456789"}
→ 200 OK   {… "fbrStrn":null,"ntn":null …}
DB:  SELECT ntn, fbr_strn FROM branches → both empty
```

`BranchDtos.CreateBranchRequest` (lines 14-24) and `UpdateBranchRequest` (lines 26-36) have no `ntn`
and no `fbrStrn` field, so Jackson drops them silently; `BranchResponse` (lines 45-46) returns both,
so the response *looks* like it round-tripped. `grep -rn "setNtn\|setFbrStrn" services/user-service/src/main/java`
returns **no call sites**. Meanwhile
`services/reporting-service/…/FbrTaxSummaryService.java:114` reads `branch.ntn()` for the FBR Tax
Summary header, which is therefore permanently blank for every tenant that ever existed.

**3b. A branch address cannot be entered as an address.** `branches.address` is a **`jsonb`** column
but `UpdateBranchRequest.address` is a `String`. Isolated live:

```
{"phone":"+92-21-1234567"}                          → 200
{"email":"hq@gapaudit.local"}                       → 200
{"address":"12 Zamzama Karachi"}                    → 409 CONFLICT "This conflicts with existing data"
{"address":"{\"line1\":\"12 Zamzama\",\"city\":\"Karachi\"}"} → 200
```

The caller must hand-serialise JSON into a string field with no documented schema. Worse, the error
is a lie: `BranchService.java:127-131` catches *every* `DataIntegrityViolationException` and reports
`"Branch with name '" + req.name() + "' already exists for this tenant"`. A malformed address is
reported as a duplicate name.

**3c. Tier limits are not enforced on creation, and the tenant cannot read them.** GROWTH sets
`max_branches = 5`. I created six more branches, every one `201`, ending at **7 live branches**.
Separately, `GET /api/v1/platform/tenants/{own id}` → **403 PERMISSION_DENIED** — the tenant plane
cannot read its own limits (`PlatformAdminController` is class-annotated `SUPER_ADMIN`). This is
G-3 and OQ-3, both confirmed live.

### Tables — NEITHER. The hardest blocker after login.

```
POST /api/v1/pos/tables?branchId=…  → 405  {"code":"METHOD_NOT_ALLOWED","message":"POST is not supported on this endpoint"}
PUT  /api/v1/pos/tables/{id}?…      → 405
GET  /api/v1/pos/tables?branchId=…  → 200  []
```

`services/pos-service/src/main/java/io/restaurantos/pos/web/TableController.java` has three mappings:
`GET /` (line 29), `PATCH /{id}` for status only (line 38), `GET /{id}/active-order` (line 48).
Nothing creates a table. The frontend matches: `PosRepository` has `getTables` and
`updateTableStatus` and nothing else. There is no floor/section/zone entity anywhere.

A dine-in restaurant cannot enter a single table. This is G-4, confirmed by status code rather than
by reading.

### Menu — the API is fine; the form throws half of it away

Categories and items both work as the new owner: `POST /api/v1/pos/menu/categories` → `200`.
Screens exist at `/app/menu/items` with working Add category / Add item dialogs.

**The item form has four fields.** Read live out of the open dialog:
`Category`, `Name`, `Description`, `Price (Rs)`.

`MenuItemFormDialog.tsx:95` builds the payload as
`{categoryId, name, description, basePricePaisa}` — and stops there. Yet every layer beneath it
already supports tax: the backend record `MenuItemAdminDtos.CreateMenuItemRequest` (lines 16-23) takes
`taxRatePct` and `taxRateCode`; the zod schema `createMenuItemInputSchema`
(`lib/api-client/schemas/pos.schema.ts:46-53`) declares both as optional; `PosRepository.createMenuItem`
passes the parsed body straight through. Only the form omits them, and because the schema marks them
optional nothing errors.

The consequence is measurable in the database. `menu_items.tax_rate_pct` defaults to `0`
(`V1__pos_schema.sql:38`). Comparing seeded rows against a row created through the UI in the same
tenant:

| Item | Origin | `tax_rate_pct` |
|---|---|---|
| Chicken Karahi, Butter Naan, Seekh Kebab, … | seed script (direct SQL) | **16.00** |
| `Audit Item 60568` | **created through the UI** | **0.00** |

Every item a restaurant enters through its own product is created **zero-rated**. They would
under-charge sales tax on every line and under-report to FBR, with nothing on screen to suggest a tax
field was ever missed.

Also missing from the menu step:
- **Item images: NEITHER.** `MenuItem`
  (`services/pos-service/src/main/java/io/restaurantos/pos/domain/model/MenuItem.java`) has no image
  column — the entity is id, category, name, description, `base_price_paisa`, `tax_rate_pct`,
  `tax_rate_code`, `kds_station`, `station_id`, `active`. There is no field to point at a file.
  Separately, `file-service` **does** expose a working uploader
  (`FileController` at `/api/v1/files`: POST multipart, GET, download, DELETE, quota) and
  `GET /api/v1/files` returned `200` for the new owner — but the frontend contains **zero**
  references to `/api/v1/files`. So the upload backend is built and unreachable, and even if it were
  reachable there is nowhere to store the result.
- **Modifiers: no API.** `modifier_groups`/`modifiers` tables and the `ModifierGroup`/`Modifier` JPA
  models exist; there is **no controller mentioning modifier** in any service. For a cafe or QSR the
  modifiers *are* the menu.
- **CSV/bulk import: none.** No `/import` mapping in any controller.

### Stations and KDS routing — BACKEND_NO_UI, fully working, completely unreachable

```
POST /api/v1/pos/stations?branchId=…  {"code":"GRILL","name":"Grill"}  → 201
```

`StationController` has GET, POST, PUT, DELETE (lines 35-59). `PUT /api/v1/pos/menu/items/{id}/station`
exists (`MenuController.java:108`). None of it is reachable from the UI: the only station call in the
frontend is `KdsRepository.getStations()` → `/api/v1/kitchen/kds/stations`, which is the KDS board's
own list, not the admin CRUD. No `/api/v1/pos/stations` appears in any repository, and there is no
`/app/stations` route.

Consistent with that, **every `menu_items.station_id` is NULL** across the tenants I inspected —
routing falls back to `"DEFAULT"` and every ticket lands on one board. The design document is right
that this step is "fully served by existing endpoints"; what it does not say is that not one of those
endpoints has a caller.

### Staff and roles — BACKEND_NO_UI. This is the user's complaint, confirmed.

As the brand-new owner, all of these returned `200`:
`GET /api/v1/users`, `GET /api/v1/roles`, `GET /api/v1/permissions`.
`UserAdminController` (`services/user-service/…/UserAdminController.java`) has eleven mappings
including create, deactivate/reactivate, reset-password and branch-role grant/revoke.

`/app/settings/users` returns **404** in the browser while authenticated. No repository anywhere in
`frontend/lib/repositories/` references `/api/v1/users`, `/api/v1/roles` or `/api/v1/permissions`.
An owner cannot create a single member of staff through the product.

The profile menu confirms the shape of it: it contains exactly two items, `Appearance` and `Log out`.
`components/shared/top-bar.tsx:90-93` records why — `/app/settings` and `/settings/profile` were
removed from the chrome because they had no `page.tsx`. The links were deleted; the screens were
never built. The same file's `NAV_COMMANDS` (lines 95-98) is the "limited top-bar search" the user
described: the command palette contains **two** entries, Dashboard and Appearance, with a comment
calling itself "a stopgap".

### Tax, payments, printers — NEITHER, all three

| Probe as the new owner | Result |
|---|---|
| `GET /api/v1/finance/tax-profile` | **404** |
| `GET /api/v1/finance/tax-rates` | **404** |
| `GET /api/v1/pos/payment-methods?branchId=…` | **404** |
| printer/ESC-POS source files across all services | **0** |

Payment methods are a compile-time enum
(`pos/domain/enums/PaymentMethod.java`); there is no per-tenant enablement, so every tenant gets the
identical unfiltered list. There is no tax rate catalogue behind the free-text `tax_rate_code`, and
no inclusive/exclusive pricing setting — `OrderPricingCalculator` is additive-only.

### Inventory and opening stock — the one step that genuinely works

Screens exist for setup, categories, ingredients, recipes, stock and coverage, and the repository
layer reaches all of them (`/api/v1/inventory/uom`, `/ingredients`, `/recipes`,
`/recipes/coverage`, `/opening-balance`, `/storage-locations`). `POST /api/v1/inventory/uom` returned
`422 UOM_DUPLICATE_CODE` for `KG` — i.e. the endpoint works and UoM master data is already seeded.
This is the only onboarding step that is complete end to end, and the design document's assessment of
it is accurate.

### Branding — every tenant sees somebody else's name

The sidebar rendered **"Lume"** while the branch switcher directly beside it read
**"Floating Terrace HQ"**, and the network log shows the shell fetching
`GET /api/v1/auth/tenants/**test**` while authenticated as a different tenant entirely.

`frontend/lib/hooks/use-tenant-brand.ts` resolves the brand from
`env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG` — a build-time constant, set to `test` in `.env.local`, whose
display name is "Lume". Every tenant in the deployment sees it. The login page is fine (it resolves
the slug from `?tenant=`, and correctly showed "Sign in to Gap Audit Bistro"); it is the authenticated
shell that is wrong. This is G-14, confirmed live.

---

## 4. Where reality diverges from `adaptivity/onboarding.md`

The design document is careful and mostly correct — its own closing caveat asks that every "EXISTS"
be confirmed by a real call before a plan depends on it. That was the right instinct. Results:

**Fixed since the document was written**
- **G-1 is closed.** `PASSWORD_CHANGE_REQUIRED` is handled end to end. Build order Wave 0 should drop it.

**Missed entirely — and it is the actual blocker**
- **TOTP enrolment has no UI.** The document does not mention `TOTP_ENROLLMENT_REQUIRED` anywhere. It
  is the gate that makes a new tenant unusable, it sits directly behind the one the document *did*
  identify, and its backend (`/api/v1/auth/2fa/bootstrap`) already exists. This belongs at the very
  top of Wave 0.

**Understated**
- **G-2 is a silent success, not a missing field.** The document says NTN "can never be written". In
  practice the API returns **200 OK** and discards it. A wizard built against this would show a green
  tick over lost data.
- **Branch address is not writable in any practical sense** (jsonb-in-a-String, 409 on a plain
  string, misleading error). The document lists `PUT /api/v1/branches/{id}` as **EXISTS** for
  "name, timezone, address, phone" — name, phone, email and timezone do work; address does not.
- **Menu tax is a UI gap, not a backend gap.** The document treats per-item tax as **EXISTS**. It is,
  right up to the form — which drops it, producing zero-rated items. This is cheap to fix and
  currently corrupts real tax data, so it should be promoted well above its implied priority.

**Overstated**
- **G-4's severity is right but its shape is worse:** `POST` returns `405`, so the path is routed and
  the method simply is not there.
- **The `comingSoon` nav entries are not dead links** — `use-nav-visibility.ts` filters them. The one
  real dead link is `/platform/tenants` on the platform side, which the document does not mention.

**Confirmed exactly as written**
G-3 (limits unenforced + unreadable), G-7 (modifiers, no API), G-8 (no CSV), G-9 (payment enum),
G-10 (no notification service — 0 java files), G-11 (no printers), G-14 (brand from env var),
and the absence of any onboarding state (`/api/v1/onboarding` → 404).

---

## 5. What this means for the wizard

The ranking that falls out of the evidence, rather than out of the step numbering:

1. **Nothing ships before TOTP enrolment has a screen.** Every other item is unreachable until an
   owner can log in. The API exists; this is a frontend-only task.
2. **Two data-integrity bugs must be fixed before any wizard writes through them** — NTN/STRN silent
   discard, and menu-item tax dropped by the form. Both currently produce wrong data that looks
   right, which is the failure mode this project keeps repeating.
3. **The largest single body of work is UI over APIs that already work**: branches, users/roles,
   stations and item→station routing are all built, tested and reachable by curl, and have no
   caller. That is the cheapest surface area in the whole plan.
4. **Only two things need net-new backend before a restaurant can open**: table CRUD (plus
   sections), and payment-method enablement. Tax profile, modifiers, printers and CSV import are
   real but can follow first sale.
5. **The checklist itself** (`onboarding_steps` + `/api/v1/onboarding`) is genuinely absent and is
   the one new subsystem, as the document says.

---

## 6. Evidence appendix

Fresh tenant: `gap-audit-bistro` / `a904ceb3-6c12-4201-8df8-8f5167abe750`, HQ branch
`c00eef21-d111-482f-b40b-c70748ee8ef7`, tier GROWTH.

Probe scripts used (throwaway, not committed):
`provision.sh`, `bootstrap_totp.sh`, `enrol_and_login.sh`, `probe.sh`…`probe5.sh` under this
session's scratchpad.

Endpoint results as the new tenant's OWNER:

```
GET  /api/v1/branches                       200      GET  /api/v1/users              200
GET  /api/v1/roles                          200      GET  /api/v1/permissions        200
GET  /api/v1/files                          200      GET  /api/v1/pos/tables         200 []
POST /api/v1/pos/menu/categories            200      POST /api/v1/pos/stations       201
POST /api/v1/branches                       201 (x6, past max_branches=5)
POST /api/v1/inventory/uom                  422 UOM_DUPLICATE_CODE (endpoint works)
PUT  /api/v1/branches/{id} + ntn/fbrStrn    200  → stored NULL
PUT  /api/v1/branches/{id} address="plain"  409 CONFLICT (misreported as duplicate name)
POST /api/v1/pos/tables                     405 METHOD_NOT_ALLOWED
PUT  /api/v1/pos/tables/{id}                405 METHOD_NOT_ALLOWED
GET  /api/v1/pos/payment-methods            404      GET /api/v1/finance/tax-profile 404
GET  /api/v1/finance/tax-rates              404      GET /api/v1/onboarding          404
GET  /api/v1/tenant-profile                 404
GET  /api/v1/platform/tenants/{own id}      403 PERMISSION_DENIED
```

Browser, authenticated: `/app/settings/users` → **404**, `/platform/tenants` → **404**.

Environment note: `auth-service`, `pos-service` and `user-service` each died and returned `503`
through the gateway several times during this audit because concurrent agents were rebuilding their
jars (`NoClassDefFoundError` on shutdown = jar replaced under a running process). Every finding above
was re-confirmed against a healthy service.
