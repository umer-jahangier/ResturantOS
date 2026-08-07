# Back-office gap audit — inventory, purchasing, finance, HR

**Method:** live browser session against `http://localhost:3000` (gateway `:8080`), driven as
`manager@terrace.local` (MANAGER), `storekeeper@terrace.local` (INVENTORY_MANAGER) and
`accountant@terrace.local` (ACCOUNTANT, TOTP), tenant `floating-terrace`. Every screen was clicked
through, every form submitted, console + network read on each. API/DB/code used to pin root causes.

**Audit window:** 2026-08-07 07:05–08:00 PKT.

> ### Read this before trusting any single number below
> Another session was building and restarting services throughout this audit. Three consequences,
> stated so nothing here is mistaken for a product defect:
> 1. Several services were running JVMs whose jars had been **overwritten on disk underneath them**
>    (`NoClassDefFoundError: ch.qos.logback.classic.spi.ThrowableProxy`,
>    `FileNotFoundException: …LoadBalancerClientConfiguration$BlockingRetryConfiguration.class`).
>    They answered `/actuator/health` **200** while failing every real request — the exact failure
>    mode already tracked as "services wedge while health still returns 200". I restarted
>    purchasing, hr, authorization and reporting to get past it.
> 2. `hr-service` and `auth-service` **as built from the current working tree do not boot**
>    (`HrAuthorizationService` needs a missing `io.restaurantos.shared.authz.AuthorizationService`
>    bean; `PlatformCredentialClient` needs a missing `RestClient$Builder` — Spring Boot 4
>    modularised that autoconfig out of `spring-boot-starter-web`). Both are **uncommitted WIP from
>    the parallel session**, not findings of mine. I rebuilt `hr-service` from `HEAD` to audit it.
> 3. A **cross-tenant vendor leak was real at 07:26** (Floating Terrace's MANAGER saw 14 vendors
>    including `Control Bistro (isolation test tenant) Supplies`) and **was fixed during the audit**
>    — `purchasing_db` now shows `relforcerowsecurity = t` on every tenant table and the same call
>    returns 1 vendor. **Not reported as an open gap.** Re-verify before closing that item.

---

## Verdict per module

| Module | Screen exists | Loads data | Primary task end-to-end |
|---|---|---|---|
| **Inventory** | Yes — Ingredients / Categories / Recipes / Coverage / Stock / Setup | Yes | **Yes.** Created "Audit Test Olive Oil" → toast → list 3→4 |
| **Purchasing** | Yes — Vendors / Suggested / POs / Invoices / Payments / Analytics | Yes (1 vendor, 12 POs) | **No. Dead at PO approval for every role in the tenant** |
| **Finance** | Yes — Accounts / JE / GL / Periods / Expenses / AP+AR Aging / House Accounts | Yes (72 accounts, 12 periods) | **Yes.** Draft → POSTED, `JE-2027-000026` |
| **HR** | Yes — Employees / Payroll / Schedule / Attendance & Leave | Yes, but **0 employees, 0 leave types** | **Untestable** — nothing to run payroll or a roster against |
| **Reports** | Yes | **Yes, non-empty** — verified below | Yes |

---

## The three questions I was asked to settle

### 1. Purchasing "403 for the MANAGER" — what is actually missing

**The premise in `scripts/CREDENTIALS.md` is wrong, and the seeder's own gap check is why.**

`seed_restaurantos.py:1337` treats `403, 404, 503` identically and reports whichever it got. The
service was **503 (wedged JVM)**, not 403. With purchasing healthy, the MANAGER reads purchasing
fine:

```
GET /api/v1/purchasing/vendors                          → 200, 1 vendor
GET /api/v1/purchasing/purchase-orders?branchId=…       → 200, 12 POs
GET /api/v1/purchasing/invoices?branchId=…              → 200
GET /api/v1/purchasing/bank-accounts                    → 200
```

The MANAGER's JWT carries **all ten** `vendor.*` codes (`vendor.manage`, `vendor.view`,
`vendor.po.create/approve/send/close`, `vendor.grn.receive`, `vendor.invoice.book/override`,
`vendor.payment.create`). **No RBAC permission is missing.**

**The real block is an ABAC attribute, and it stops everyone.** Clicking **Approve** on a PO in the
UI shows *"An unexpected error occurred"*; the network tab shows `POST …/approve → 500`, and the
purchasing log resolves the trace to a Feign call to a down `authorization-service`. After
restarting it, the honest answer appears:

```
POST /api/v1/purchasing/purchase-orders/{id}/approve
  MANAGER      → 403 APPROVAL_LIMIT_EXCEEDED
  TENANT_ADMIN → 403 APPROVAL_LIMIT_EXCEEDED
  OWNER        → 403 APPROVAL_LIMIT_EXCEEDED
```

Because `policies/restaurantos/vendor.rego:17` requires
`input.resource.amount_paisa <= input.user.attributes.approval_limit_paisa`, and:

```sql
-- auth_db.user_branch_roles, Floating Terrace: approval_limit_paisa is NULL for every user
accountant@terrace.local | ACCOUNTANT        | (null)
admin@terrace.local      | TENANT_ADMIN      | (null)
manager@terrace.local    | MANAGER           | (null)
owner@terrace.local      | OWNER             | (null)
storekeeper@terrace.local| INVENTORY_MANAGER | (null)
```

Every OWNER/MANAGER JWT carries `"attributes": {}`. In Rego a comparison against an undefined value
makes the rule body undefined, so `allow` stays `false`. Other demo tenants **do** have it
(`MANAGER 30000000`, `OWNER 100000000`), which is why this looks tenant-specific.

**Who should hold it:** whoever approves POs — MANAGER, TENANT_ADMIN and OWNER — needs a non-null
`user_branch_roles.approval_limit_paisa` at or above the PO total (POs here run
Rs 10,000–35,000 = 1,000,000–3,500,000 paisa).

**Why it is not set:** `scripts/seed_restaurantos.py` never writes the column (0 occurrences);
`scripts/onboarding.py:340` does. And **there is no screen anywhere to set an approval limit** —
there is no user-management UI at all (see G-14).

Net effect: purchasing is dead at step 3 of 6 for this tenant. No PO can be approved → nothing can
be sent, received, invoiced or paid. Payments and Invoices are legitimately empty as a *consequence*.

### 2. Reports show non-empty data — **confirmed**

`POST /api/v1/reporting/reports/{code}/run` as MANAGER, `2026-07-01 → 2026-08-08`:

| report | rows |
|---|---|
| sales-by-day | 1 |
| sales-by-item | 6 |
| sales-by-hour | 2 |
| sales-by-order-type | 1 |
| discount-summary | 1 |
| till-sessions | 0 — no till was ever closed |
| purchases-by-po | 0 — consequence of G-1 |

`/app/reports/sales-by-item` renders in the browser: *Chicken Karahi 14 / Rs 23,548.00*,
*Mutton Biryani 4 / Rs 5,800.00*, *Chicken Samosa 12 / Rs 3,480.00*. Realtime tiles return
`todays-revenue: 3705040` paisa. **Reporting is genuinely wired.** See G-16 for what it renders badly.

> Correction to the brief: the tenant has **29 orders (25 CLOSED)**, not 106. 106/120 is the count
> across **all 14 tenants**. Same for "42 ingredients" — Floating Terrace has **3** (14 tenants × 3).

### 3. Menu-item images — exactly what is needed

**Nothing exists on the pos-service side; the file-service side is complete and unused.**

Verified absent — `grep -i "image\|photo\|picture\|thumbnail"` returns **zero** hits in
`services/pos-service/src/main/java`, in its Liquibase changelogs, and in `frontend/`:

- `pos_db.menu_items` columns: `id, tenant_id, category_id, name, description, base_price_paisa, tax_rate_pct, tax_rate_code, kds_station, active, created_at, updated_at, created_by, updated_by, deleted_at, station_id` — **no image column**
- `MenuItemAdminDtos.CreateMenuItemRequest` (lines 16-22) / `UpdateMenuItemRequest` (29-35) — no image field
- `frontend/lib/api-client/schemas/pos.schema.ts:7-21` `apiMenuItemSchema` — no image field
- `frontend/components/menu/MenuItemFormDialog.tsx` — exactly four fields: `categoryId`, `name`, `description`, `priceRupees`

Verified present and working — `services/file-service/.../controller/FileController.java`:

- `POST /api/v1/files`, `consumes = "multipart/form-data"`, `@PreAuthorize("hasAuthority('file.upload')")`, returns `FileUploadResponse`, MinIO-backed, quota-checked
- `GET /api/v1/files/{id}/download` under `file.view`; `DELETE` under `file.manage`
- MANAGER now holds `file.upload`/`file.view`/`file.manage`; ACCOUNTANT and INVENTORY_MANAGER hold `file.upload`/`file.view`
- **`grep -rn "api/v1/files" frontend/{lib,app,components}` → zero hits. `grep -rn "FormData\|multipart" frontend/{lib,app,components}` → zero hits.** No client anywhere.

**To connect them, five pieces — nothing more:**

| # | Layer | Change |
|---|---|---|
| 1 | pos-service DB | Liquibase changeset adding `menu_items.image_file_id UUID NULL` (nullable — 7 existing rows). A file id, not a URL: the URL is file-service's to own. |
| 2 | pos-service API | `imageFileId` on `MenuItem`, `MenuItemDto`, `MenuItemAdminDtos.Create/UpdateMenuItemRequest`, and the mapper. Additive and nullable, so no existing consumer breaks. |
| 3 | frontend Layer-2 | `FileRepository.upload(file)` posting `FormData` to `/api/v1/files` (the first multipart call in the codebase — `lib/api-client/request.ts` currently only sends JSON, so it needs a multipart path that does **not** set `Content-Type` manually). Add `imageFileId` to `apiMenuItemSchema` + `createMenuItemInputSchema`. |
| 4 | frontend UI | A file input in `MenuItemFormDialog.tsx`: pick → `POST /api/v1/files` → take `id` → include as `imageFileId` on the item save. Thumbnail from `/api/v1/files/{id}/download`. |
| 5 | Auth/config | `pos.menu.manage` holders must also hold `file.upload` (MANAGER does; verify OWNER/TENANT_ADMIN). Confirm file-service's allowed content types cover `image/jpeg|png|webp` and the tenant quota is sane for menu photography. |

Deliberately **not** required: no new service, no new permission code, no gateway route (both
`/api/v1/pos/**` and `/api/v1/files/**` are already routed and both were exercised live).

---

## Findings

### G-1 · BLOCKER · No one in the tenant can approve a purchase order
`policies/restaurantos/vendor.rego:17` gates `approve_po` on
`amount_paisa <= user.attributes.approval_limit_paisa`; `auth_db.user_branch_roles.approval_limit_paisa`
is NULL for all 5 Floating Terrace principals, and every OWNER/MANAGER/TENANT_ADMIN JWT carries
`"attributes": {}`. Observed: `POST /api/v1/purchasing/purchase-orders/{id}/approve` → **403
APPROVAL_LIMIT_EXCEEDED** for MANAGER, TENANT_ADMIN **and OWNER**. `scripts/seed_restaurantos.py`
never sets the column (0 occurrences); `scripts/onboarding.py:340` does. Purchasing dead-ends: no
send, receipt, invoice or payment is reachable. **Owner:** purchasing-service / auth-service seed.

### G-2 · BLOCKER · One 503 on `/api/v1/feature-flags` silently deletes most of the app
Observed in the network log at first login: `GET http://localhost:8080/api/v1/feature-flags → 503`.
The MANAGER's sidebar rendered **only** `Dashboard`, `Reports`, `Realtime Dashboard` — POS, Kitchen
Display, Till Review, Inventory, Menu Items, Purchasing and Customers all disappeared, with **no
error, banner or toast**. Re-logging in once the endpoint returned 200 restored all eight
(screenshots before/after). Cause: `frontend/lib/hooks/auth/use-nav-visibility.ts:29` —
`if (isPending) return false;` — so while the flags query is retrying, every `feature`-gated item is
hidden. A transient dependency blip is indistinguishable from an unentitled tenant. This is very
plausibly the single biggest contributor to "the app is empty". **Owner:** frontend shell.

### G-3 · HIGH · Dashboard "Closed sales" can never be anything but Rs 0.00
`frontend/components/dashboard/tenant-dashboard.tsx:110` calls `useOrderSummaries()` with **no
status filter**. `frontend/lib/repositories/pos.repository.ts:206-210` documents that the endpoint
then "Defaults to ALL non-terminal statuses server-side". Line 125 filters that list for
`o.status === "CLOSED"` — a value it can never contain. Observed: *Closed sales Rs 0.00 · 0
completed orders* while `pos_db` holds **25 CLOSED orders totalling 3,705,040 paisa (Rs 37,050.40)**
and `GET /api/v1/reporting/dashboard/{branchId}/tiles` returns exactly `todays-revenue: 3705040`.
Deterministic, tenant-independent, and the correct number is already one call away.
**Owner:** frontend dashboard.

### G-4 · HIGH · Dining tables cannot be created — no UI *and* no backend
`services/pos-service/.../web/TableController.java` exposes only `GET /` (line 29),
`PATCH /{id}` status (39) and `GET /{id}/active-order` (48). There is **no POST/PUT/DELETE** and no
create path anywhere in `TableService`/`TableServiceImpl`. Floating Terrace has **0 rows** in
`pos_db.dining_tables` (all 8 rows belong to another tenant); the dashboard reads *Dining tables
0 / 0*. Corrects the earlier note that this was "backend built, no UI" — the write side does not
exist either. **Owner:** pos-service + frontend.

### G-5 · HIGH · Menu items have no image field; file-service upload has no client
See question 3 above for the evidence and the five-step fix. **Owner:** pos-service + frontend.

### G-6 · HIGH · Report catalog returns the full SQL and ClickHouse schema to any report viewer
`services/reporting-service/.../controller/ReportController.java:43-44` returns
`List<ReportDefinition>` — the internal record — straight out of `GET /api/v1/reporting/reports`
under only `reporting.report.view`. `ReportDefinition.java` carries `sqlBranchScoped` and
`sqlTenantWide`. Observed as MANAGER: the response body contains
`FROM clickhouse_analytics.sales_order_facts WHERE tenant_id = ? AND branch_id = ? …` for all seven
reports. Fix is a projection DTO of `code/title/category/columns`. **Owner:** reporting-service.

### G-7 · HIGH · A dependency outage surfaces as a generic 500, not a typed refusal
`services/purchasing-service/.../service/PoApprovalService.java:105` (`assertOpaAllows`) lets
`FeignException$ServiceUnavailable` escape when authorization-service is unreachable →
`500 INTERNAL_ERROR` → the UI shows *"An unexpected error occurred"*. Failing closed is right;
failing **unlabelled** is not — it cost this audit ~20 minutes to distinguish from a permission
problem, and it will cost an operator more. Should be a 503 with a distinct code. The same
class of masking applies wherever OPA is called synchronously. **Owner:** purchasing-service.

### G-8 · HIGH · Purchase orders are unreadable — UUIDs where the business identifiers belong
`frontend/app/(tenant)/app/purchasing/purchase-orders/page.tsx:84` renders `{po.id.slice(0, 8)}…`
under a column headed **"PO number"**, and the table has **no vendor column**. Observed: twelve rows
reading `7b2c4a9f…`, `528d242e…`, all "Pending approval", all "—" for expected date. The PO detail
page shows no vendor either, and line items render the ingredient UUID (`5e6ab5ff… (kg)`). Root
cause is the DTO: the payload has `id`/`vendorId` but **no `poNumber` and no `vendorName`**.
**Owner:** purchasing-service DTO + frontend.

### G-9 · MEDIUM · Goods receipt is a dev mock rendered in the product UI
The only receiving path is `MockGrnController` → `POST /purchase-orders/{poId}/mock-receive`, and
the PO detail page renders a yellow panel titled **"Mock goods receipt (dev) — Simulates Phase 8 GRN
while integration-mode=mock."** to a MANAGER. There is no real GRN controller. Either build it or
gate the panel behind a non-production flag — a buyer should not be told the receipt is simulated.
**Owner:** purchasing-service + frontend.

### G-10 · MEDIUM · HR is invisible to the roles that hold HR permissions
`frontend/components/shared/sidebar-nav-items.ts:266-274` gates HR on
`roles: ["OWNER", "TENANT_ADMIN"]` with the comment *"Phase 5+: HR permissions not yet in DB
catalog"*. That comment is stale: MANAGER's JWT carries `hr.employee.view`,
`hr.attendance.manage`/`view`, `hr.leave.approve`/`view`, `hr.payroll.view`; ACCOUNTANT carries
`hr.payroll.run`. `GET /api/v1/hr/employees` and `/hr/payroll-runs` both answer **200** for both.
Navigating to `/app/hr/employees` by URL as MANAGER renders the page fine — it is only unreachable.
Swap the role gate for `permission: "hr.employee.view"`. **Owner:** frontend nav.

### G-11 · MEDIUM · Journal-entry screens mix paisa and rupees in one view
`New Journal Entry` labels its amount inputs **"Debit (paisa)"** / **"Credit (paisa)"** — an
accountant must multiply by 100 by hand. On the posted entry, the summary reads
`TOTAL DEBIT 10,000 / TOTAL CREDIT 10,000` (raw paisa) directly above lines reading
`Rs 100.00` (formatted) — the same amount displayed two ways, three inches apart. Everywhere else
in the app the input is rupees (`priceRupees` in the menu form). **Owner:** frontend finance.

### G-12 · MEDIUM · Add-ingredient hides required fields and validates one at a time
Only `Primary category *` carries an asterisk. Submitting a filled form failed on **"SKU is
required"**; filling SKU and resubmitting then failed on **"Enter a reorder point"** — two
round-trips to discover two unmarked required fields, and `SKU`'s placeholder (`ING-CHK`) reads like
an example rather than a requirement. Mark them and validate the whole form on submit. (The flow
does complete: the ingredient was created and the list went 3 → 4.) **Owner:** frontend inventory.

### G-13 · MEDIUM · On-hand stock goes deeply negative with no guard
`inventory_db.ingredient_branch_stock` for Floating Terrace: **`Chicken | -3000.0000 | avg_cost 0`**.
The Stock screen renders it as `-3000 KG`, `Rs 0.00`, `Out of stock`, `Last counted: Never`, with
`Total stock value: Rs 0.00`. 11 negative rows exist tenant-wide (min -3000). Order consumption
decrements stock that was never received and nothing floors it at zero or warns. Combined with G-1
(no PO can be approved → no receipt can ever be posted) this only ever gets worse.
**Owner:** inventory-service.

### G-14 · MEDIUM · No user management, no settings page, no profile page
`frontend/components/shared/sidebar-nav-items.ts` marks `General` (`/app/settings`, line 334) and
`Users` (`/app/settings/users`, line 348) `comingSoon: true` — they are hidden, and the routes do
not exist (`frontend/app/(tenant)/app/settings/` is absent; only `/settings/appearance` exists,
OWNER/TENANT_ADMIN-only). `top-bar.tsx:205-209` documents that Profile and Settings were **removed
from the profile menu because both 404'd**, leaving `Appearance` + `Log out`. So an OWNER has no way
to invite a user, change a role, or set an approval limit — which is what makes **G-1 unfixable from
inside the product**. **Owner:** frontend + user-service.

### G-15 · MEDIUM · A response-schema drift kills the login form with no message at all
`frontend/lib/repositories/session.repository.ts:12` runs `apiLoginSchema.parse(raw)`; a ZodError
from that parse is **not** an `ApiError`, but `frontend/components/auth/login-form.tsx:135` calls
`error.isTotpRequired()` on it unconditionally. Observed live: `POST /api/v1/auth/login → 200 OK`
followed by console `Uncaught (in promise) TypeError: error.isTotpRequired is not a function`, and
the form simply did nothing — no spinner, no error, no route change. (Today's trigger was a stale
`auth-service` jar missing `tokenType`, i.e. environmental — but the handler will do the same for
*any* future contract drift, on the one screen where a dead-end is fatal.) Guard the branch with an
instance check and surface a fallback message. **Owner:** frontend auth.

### G-16 · LOW · Reports render machine keys and half-empty columns
`/app/reports/sales-by-item` shows a leading **"Menu Item Id"** column of raw UUIDs beside the item
name, headers derived verbatim from the catalog's column names (*"Gross Revenue Paisa"*, *"Cogs
Paisa"*, *"Gross Margin Paisa"* — labelled paisa but formatted `Rs 23,548.00`), and **COGS and
Gross Margin are `—` for every row** under the note *"COGS and margin require inventory (Phase 8)
and are not yet available"*. Two of six columns are permanently blank. **Owner:** reporting-service
+ frontend.

### G-17 · LOW · FBR tax summary omits the registration numbers that make it a tax document
`GET /api/v1/reporting/reports/fbr-tax-summary` returns real money
(`outputTaxPaisa 511040`, `taxableSalesPaisa 3194000`) with **`"ntn": null, "fbrStrn": null`**.
A statutory summary without the NTN/STRN is not filable, and there is no screen to enter them
(see G-14). **Owner:** reporting-service + tenant settings.

### G-18 · LOW · The working tenant has too little data to demonstrate a back office
Floating Terrace: **3 ingredients** (not 42 — that is 14 tenants × 3), **7 active menu items**
(not 78), **0 dining tables**, **0 HR employees**, **0 leave types**, **0 expenses**, **0 vendor
invoices**, **12 finance periods all still OPEN** (so `finance.period.close` — the one permission
the ACCOUNTANT's TOTP step-up exists to protect — has never been exercised). HR renders "No
employees yet" and cannot demonstrate payroll, rostering or attendance at all.
**Owner:** seed script.

---

## What works, and is worth not breaking

- **Inventory → Ingredients** is the best screen in the back office: allergen filters, category and
  status filters, sortable columns, contextual field help, and an Add dialog that explains *why*
  a primary category matters. Create completed end-to-end.
- **Finance → Journal Entries** is genuinely good: open-period-constrained date picker, account
  autocomplete by code or name, a live `Total DR / Total CR` with a `Balanced ✓` indicator that
  gates the save button, draft → post → `Reverse`. Posted `JE-2027-000026` cleanly.
  (`JE-2027` on a `2026-07-01` entry is the Jul–Jun fiscal year, **not** a bug.)
- **Reporting** is real: seven reports, live ClickHouse facts, non-empty results, realtime tiles
  carrying the correct revenue figure.
- **RBAC boundaries hold.** INVENTORY_MANAGER is correctly refused finance, reports, menu admin and
  bank accounts (`403 PERMISSION_DENIED`); ACCOUNTANT is correctly refused inventory and menu admin;
  the ACCOUNTANT TOTP step-up prompts correctly, keeps the password, and signs in.
