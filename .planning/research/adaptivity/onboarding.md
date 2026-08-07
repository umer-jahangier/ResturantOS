# Tenant Onboarding — full procedure design

Research + design date: 2026-08-07
Branch read: `phase-13-access-repair` @ `5fba4a9`
Scope: what happens between "a restaurant signs up" and "the system is configured for how THEY operate".

**Discipline note.** Every claim about this repository cites a file I opened. Where a class or a
column exists but nothing writes to it or reads it, I say so explicitly — this codebase has shipped
structurally-present-but-dead code repeatedly (see `ProvisioningService`'s own javadoc, which
documents a saga that reported success for tenants nobody could log into). Statements about
Square/Toast/Shopify/Odoo are from general product knowledge and are **not** repo-grounded; they are
confined to §2 and labelled.

**Parallel work I do not duplicate.** FBR e-invoicing contract, POS thermal printing, biometric
attendance, ERP module gaps, cross-module integration gaps, UI/UX visual direction, frontend
component stack, current tenant configurability, testing strategy — all owned by other agents in
this swarm. The **service-model selection step (§5, Step 4)** is owned by the parallel
business-models design and is referenced here, not designed here.

Two documents that already exist and that this one builds on, rather than restates:
- `/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/research/erp-completion/tenant-configurability.md`
  — the authoritative inventory of what a SuperAdmin can set today and the proposed
  `user_db.tenant_profiles` / tax-profile / service-charge / receipt-template tables (its §5).
  Onboarding is the **UI and sequencing** over those settings; the settings themselves are its §5.
- `/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/research/erp-completion/fbr-api.md`
  — the FBR external contract.

---

## 1. Executive summary

There is no tenant onboarding today. There is a **provisioning saga** (control-plane, SuperAdmin,
API-only) and a **developer seeding script**. Neither is an onboarding product.

| | Exists | Where |
|---|---|---|
| SuperAdmin provisions a tenant shell | **Yes, and it works** (repaired in Phase 13) | `services/platform-admin-service/src/main/java/io/restaurantos/platform/service/ProvisioningService.java` |
| Dev/CI tenant seeding | Yes, writes **directly to 3 databases**, bypasses every API | `scripts/onboarding.py` |
| Any onboarding/setup UI | **No.** Zero files match `onboarding`/`wizard` under `frontend/app`, `frontend/components`, `frontend/lib` | verified by grep |
| Any onboarding completion state (table, column, endpoint) | **No.** Nothing in any service's migrations | verified by grep across `services/*/src/main/resources/db/` |
| Frontend handling of the mandatory first-login password change | **No.** `PASSWORD_CHANGE_REQUIRED` appears nowhere in the frontend | verified by grep |

The saga produces: a tenant row, feature flags, **one** HQ branch, an auth tenant row, an OWNER
admin with a one-time password, and a seeded Chart of Accounts. That is the floor. Everything a
restaurant would recognise as "set up for how we operate" — tables, tax, menu, stations, staff,
payments, receipts, printers, stock — is unbuilt, partly built, or built with no write path.

Of the **13 onboarding steps** designed below, by endpoint availability:

- **5 steps are fully served by existing APIs** (branches, menu categories/items, stations + routing,
  staff/roles, inventory master data + opening stock).
- **4 steps are partially served** (business profile: brand only, SuperAdmin-only; tax: per-item rate
  only; receipt/branding: an inert JSONB column; floors/tables: read + status only).
- **4 steps have no API at all** (payment-method enablement, printers, CSV/bulk import, onboarding
  progress itself).

Six defects of the "structurally present, functionally dead" class are named in §8. The two that
most directly block this feature: **branch `ntn`/`fbr_strn` can never be written** (no DTO field,
no setter call anywhere), and **`orders.service_charge_paisa` is never assigned by any code path**.

---

## 2. Best-in-class onboarding — what the category has converged on

*(External product knowledge. Not repo-grounded. Used to justify the sequencing in §5.)*

### 2.1 The shape everyone landed on

All four reference products converged on the same skeleton, for the same reason: a restaurant
operator will abandon a 40-field form and will not abandon a checklist they can leave and return to.

1. **Sign-up asks for almost nothing.** Square asks for email, password, and a single "what's your
   business?" question. Toast's self-serve asks business name + address. Shopify asks email. The
   entire purpose is to get an account that exists so that everything after it is *resumable*.
2. **One high-information question drives the defaults.** Square's "what kind of business" and
   Shopify's industry picker are not analytics — they select a **preset bundle**: default tax
   behaviour, default item structure, default receipt layout, which modules are visible. Odoo does
   the same at a coarser grain by having you tick apps, then each app runs its own small wizard.
3. **Then a persistent checklist, not a linear wizard.** Shopify's setup guide and Square's
   "Get Started" are dashboards of independently completable cards, each with its own progress. Toast
   has an onboarding portal with named workstreams (menu, hardware, payments, staff) that run in
   parallel and are individually assignable. Nobody makes step 7 block step 3.
4. **Progressive disclosure of the hard parts.** Menu building and hardware are deferred and
   frequently done *with a human*: Toast pairs you with an implementation consultant and builds the
   menu from a PDF/CSV you upload. Square lets you sell with a single ad-hoc item before you have a
   catalogue at all.
5. **"You can transact" is an explicit, celebrated milestone,** distinct from "you are fully
   configured". Square gets you to "take a payment" as fast as possible; everything else is
   post-activation. This is the single most important structural idea to copy.
6. **Bulk import is a first-class path, not a power-user escape hatch.** Square, Toast and Shopify
   all ship a downloadable template CSV with a dry-run/preview and a row-level error report.
   For a restaurant with 200 menu items, this *is* the menu step.
7. **Defaults are always shown, always editable, never hidden.** Odoo's wizards pre-fill a
   country-specific chart of accounts and tax rates; you confirm rather than author.

### 2.2 What is asked up front vs deferred

| Asked at signup | Deferred to the checklist | Deferred until first use |
|---|---|---|
| Identity (email/password), brand name, business type, country | Legal entity details, tax registration numbers, branches beyond the first, floor plans, full menu, staff, hardware | Printer pairing, second location, integrations, advanced tax rules |

### 2.3 How completion is tracked and resumed

- Progress is **server-side state**, not a browser cookie: the checklist is identical on a new
  device, and support/implementation staff can see it.
- Each step carries its own status (`NOT_STARTED` / `IN_PROGRESS` / `COMPLETED` / `SKIPPED`) plus a
  timestamp and the user who completed it.
- **Completion is derived where it can be, declared where it cannot.** Shopify marks "add a product"
  done by counting products, not by a button. Derivation is what keeps the checklist honest when a
  user does the work by another route (imports a CSV, or an implementation consultant does it).
- Steps are **skippable with a recorded reason**; skipped is not the same as done, and the checklist
  can resurface a skipped step later.
- The checklist survives to become a **settings surface** — the same forms, reachable forever.

---

## 3. What exists in this repository today

### 3.1 `scripts/onboarding.py` — a seeding script, not a product path

`/Users/muhammadumer/Documents/Projects/ResturantOS/scripts/onboarding.py` (510 lines).

What it does, in its own order: upserts `platform_db.tenants` + `tenant_features`, upserts
`auth_db.auth_tenants`, upserts `auth_db.users` + `user_branch_roles`, upserts `user_db.branches`
(exactly 2: `Main Branch (HQ)` and `Downtown Branch`), verifies row counts, and optionally
POSTs `/api/v1/auth/login` for the two roles that do not require TOTP.

Three properties make it unusable as the product flow, and all three are deliberate for its actual
purpose:

1. **It writes directly to three databases** as the Postgres superuser (`--db-user`, defaulting to
   `POSTGRES_SUPERUSER`), calling `set_config('app.current_tenant_id', …, false)` by hand
   (`set_tenant_guc`, line 190). It bypasses the provisioning saga, the outbox, `TENANT_PROVISIONED`,
   and the Chart-of-Accounts seed entirely. A tenant created this way has **no COA** — the script's
   own summary tells you to run `seed_finance_tenant.py` as "Phase 2" (line 411-412).
2. **It hardcodes the tenant shape**: 4 users with fixed roles, 2 branches, deterministic UUIDv5 ids
   derived from the slug (`resolve_ids`, line 154). Passwords are printed to stdout.
3. **Its feature-flag table is a second copy of the tier defaults** (`ALL_FEATURES`,
   `GROWTH_FEATURES_ON`, lines 58-105) and it has already drifted from the service's own
   `TierFeatureDefaults`: the script lists 15 codes; `TierFeatureDefaults` defines 20 and includes
   `FEATURE_PAYROLL`, `FEATURE_LOYALTY`, `FEATURE_NLQ`, `FEATURE_ANALYTICS`, `FEATURE_ECOMMERCE`,
   which the script does not. A tenant seeded by this script has **no `FEATURE_NLQ` row**, and
   `FeatureFlagGlobalFilter` refuses on a missing row — the exact failure mode
   `TierFeatureDefaults` lines 61-65 documents.

**Verdict: keep it, scope it.** It is a valuable CI/dev fixture. It must not become the onboarding
path, and its feature list should be replaced by a call to the platform API so it cannot drift again.

### 3.2 The provisioning saga — the real control-plane entry point

`services/platform-admin-service/src/main/java/io/restaurantos/platform/service/ProvisioningService.java`,
exposed at `POST /api/v1/platform/tenants` by
`services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/PlatformAdminController.java:61`.

Seven steps, in order (the class javadoc, lines 38-66, is accurate and unusually candid):

| # | Step | Call |
|---|---|---|
| 1 | Persist `PENDING_SETUP` tenant | local, `TenantRepository` |
| 2 | Seed per-tier feature flags | local, `TierFeatureDefaults.defaultsFor(tier)` |
| 3 | Create the HQ branch | `POST /internal/users/branches` → `BranchInternalController.createBranch` |
| 4 | Register the auth-side tenant row | `POST /internal/auth/tenants` |
| 5 | Provision the admin user **and its OWNER branch-role** | `POST /internal/auth/tenants/{id}/provision-admin` |
| 6 | Seed the Chart of Accounts | `POST /internal/finance/tenants/{id}/seed-coa` → `InternalProvisioningController:45` |
| 7 | Mark `ACTIVE`, publish `TENANT_PROVISIONED` via the outbox | `platform.topic` / `platform.tenant.provisioned` |

Facts that matter for the onboarding design:

- **Idempotent by key.** `Idempotency-Key` header, or an auto key. The one-time password lives in
  Redis under a 1h TTL (`TEMP_PASSWORD_KEY_PREFIX`, line 100) — deliberately *not* in the durable
  idempotency record, which is a plaintext column with no purge job. A replay after the TTL returns
  a null password. **An onboarding UI must therefore surface the temp password immediately or not at
  all.**
- **Compensating.** Failure marks `PROVISIONING_FAILED` and reverses completed steps; failures of the
  compensations themselves become `ManualRepairRecord`s logged under `[saga][MANUAL-REPAIR-REQUIRED]`.
- **Retryable.** `POST /api/v1/platform/tenants/{id}/retry-provisioning` (`PlatformAdminController:144`),
  same tenant row, requires an admin email in the body. Refuses any status but `PROVISIONING_FAILED`.
- **Named limitation** (`ProvisioningService` javadoc lines 353-359): if the first attempt failed
  *after* the admin user was created, compensation revoked the branch-role but **no internal endpoint
  exists to deactivate the account**, so retry fails again on the duplicate email with a 409.
- **Exactly one branch is created**, named `"<brandName> HQ"`, with no address and no timezone
  argument — `BranchService.createInternal` hardcodes `Asia/Karachi`
  (`services/user-service/src/main/java/io/restaurantos/user/service/BranchService.java`, in
  `createInternal`). Onboarding must let the operator correct the name and timezone.
- **Everything here is `SUPER_ADMIN`.** `PlatformAdminController` is class-annotated
  `@PreAuthorize("hasAuthority('SUPER_ADMIN')")` (line 35). A tenant owner cannot call any of it —
  including `PATCH /tenants/{id}`, the only way to change their own brand name.

### 3.3 The frontend app router — no onboarding surface

`frontend/app` is three route groups: `(auth)/login`, `(platform)/platform/dashboard`,
`(tenant)/app/*` (+ `(tenant)/settings/appearance`). Full page list verified; there is **no**
`onboarding`, `setup`, `welcome`, or `wizard` route. `app/(tenant)/app/inventory/setup/page.tsx`
exists but is a UoM/storage-location master-data screen, not a wizard — its own header comment says
it exists because "the two pieces of inventory master data that had no screen at all".

The 4-layer boundary is enforced by `frontend/eslint.config.mjs`: files under `components/**` may not
import `@/lib/api-client*`, `@/lib/repositories*`, or bare `axios`. The permitted chain is
`lib/api-client/request` → `lib/repositories/*.repository.ts` (which parses with a zod schema from
`lib/api-client/schemas` and maps through `lib/adapters/*.adapter.ts`) → `lib/hooks/**` → components.
`frontend/lib/repositories/branch.repository.ts` is the canonical 10-line example.

Two frontend facts that directly constrain onboarding:

- **`useTenantBrand` resolves the brand from a build-time env var.**
  `frontend/lib/hooks/use-tenant-brand.ts` reads `env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG` and fetches
  `/api/v1/auth/tenants/{slug}`. That is a single-tenant deployment assumption baked into the shell;
  a newly onboarded tenant will see the fallback string `"RestaurantOS"`.
- **The forced first-login password change is unhandled.** `AuthServiceImpl` throws
  `PasswordChangeRequiredException` when `must_change_password` is set (line 327-333), and
  `AuthExceptionHandler:77-78` renders it as `403 PASSWORD_CHANGE_REQUIRED` with the `changeToken`
  in `fieldErrors`. The public escape hatch `POST /api/v1/auth/change-password/forced` exists.
  **The string `PASSWORD_CHANGE_REQUIRED` appears nowhere in the frontend.** Every provisioned tenant
  admin therefore hits a dead end on their first login through the UI. This is step 1 of onboarding
  and it is currently impassable.

### 3.4 There is no notification channel

`services/notification-service` contains **zero `.java` files** (verified by `find`). Onboarding
cannot email an invite, a temp password, or a "finish your setup" nudge. Every credential must be
delivered out of band by a human, which `PlatformAdminController:69-74` already states for the
provisioning temp password. Staff invites (§5 Step 10) inherit the same constraint.

---

## 4. Design principles for ResturantOS onboarding

**P1 — Two planes, one story.** Provisioning (SuperAdmin, `POST /api/v1/platform/tenants`) is the
*control plane*; setup (the tenant's OWNER, in `frontend/app/(tenant)`) is the *tenant plane*. The
handoff is the temp password. Onboarding-the-product lives entirely in the tenant plane, and the
onboarding state must be **tenant-owned** so RLS confines it — not in `platform_db`, which is
control-plane and whose tables are not tenant-RLS'd the same way.

**P2 — Checklist, not wizard.** One mandatory linear prelude (Steps 1-3, the "you cannot proceed
without this" set), then a **dashboard of independently completable cards**. Matches §2.3 and matches
the reality that menu building and hardware take days.

**P3 — "First sale" is the celebrated milestone.** Steps 1-8 constitute *Activation*. Steps 9-13 are
*Optimisation* and are all skippable. A cafe that never touches inventory or FBR must reach a working
till without seeing a red badge forever.

**P4 — Derive completion where possible.** A step's `COMPLETED` should be provable by a count from
the owning service, not by a button press. This is the only way the checklist stays true when the
work is done through the normal module screens (which already exist for menu, inventory, staff).
Where derivation is impossible (a decision with no row — e.g. "we price tax-inclusive"), the step is
**declared** and the declaration is itself the persisted setting.

**P5 — Business type selects a preset, and the preset is always visible and always editable.** Never
a hidden behaviour change. Every preset value lands in a real form field the operator can see and
override before saving.

**P6 — Money is BIGINT paisa, everywhere, including every onboarding payload.** Menu item prices are
already `Long basePricePaisa` (`MenuItemAdminDtos.CreateMenuItemRequest`). The one legitimate
exception in this area is a *rate*: `RecordOpeningBalanceRequest.unitCostPaisa` is a `BigDecimal`
because it is cost-per-unit, and its own javadoc says so
(`services/inventory-service/src/main/java/io/restaurantos/inventory/dto/InventoryDtos.java:148`).
CSV import must parse decimal currency text into paisa **at the edge** and never carry a float
further in.

**P7 — Every write goes through a real API.** No onboarding step may write to a database directly.
`scripts/onboarding.py` is the counter-example that must not be generalised.

**P8 — Feature flags gate the checklist.** A step whose module is off for this tenant is **hidden**,
not shown-and-403ing. The frontend already has `frontend/lib/features/feature-flags.ts` and the
gateway enforces via `RouteFeatureMap` + `FeatureFlagFilter`. Concretely: hide Step 13 (inventory)
when `FEATURE_INVENTORY` is off; hide Step 9 (stations/KDS) when `FEATURE_KDS` is off; hide multi-
branch expansion in Step 5 when `FEATURE_MULTI_BRANCH` is off.

---

## 5. The flow

### 5.1 Overview

```
CONTROL PLANE (SuperAdmin, exists today)
  Step 0  Provision tenant shell ──────────────────────────► POST /api/v1/platform/tenants

TENANT PLANE — ACTIVATION (linear, mandatory)
  Step 1  First login + forced password change
  Step 2  Business profile
  Step 3  Service model selection      [see parallel business-models design]
  Step 4  Branches / outlets
  Step 5  Floors, sections, tables     [skippable: not for QSR/cloud kitchen]
  Step 6  Tax profile
  Step 7  Menu: categories → items → modifiers   [CSV path]
  Step 8  Payment methods + till
        ───────────► MILESTONE: "You can take an order."

TENANT PLANE — OPTIMISATION (parallel cards, all skippable)
  Step 9   Stations + item→station routing (KDS/BDS)
  Step 10  Staff: roles and first users
  Step 11  Receipt, branding, printers
  Step 12  FBR e-invoicing enablement  [depends on Step 6 + parallel FBR research]
  Step 13  Inventory: units → ingredients → recipes → opening stock
```

Steps 1-3 are linear because each genuinely constrains the next: you cannot see the app without a
password; the business type selects defaults consumed by every later step; the service model
determines whether Step 5 exists at all.

### 5.2 Business-type presets

Six types, per the brief. The preset is a **client-side default bundle** that pre-fills the forms of
Steps 3-13, plus a persisted `business_type` on the tenant profile so the presets can be re-derived
and so reporting can segment. Nothing here is enforcement — every value is an editable form field.

| | Fine dining | Cafe | QSR | Bar | Cloud kitchen | Bakery |
|---|---|---|---|---|---|---|
| Default service model *(→ business-models doc)* | dine-in + table service | counter + dine-in | counter + takeaway | tab/bar service | delivery only | counter + takeaway |
| Step 5 tables | **required** | optional | **skip by default** | required (bar seats) | **skip, hard** | **skip by default** |
| Tax display | exclusive | inclusive | inclusive | inclusive | exclusive | inclusive |
| Service charge default | 10% suggested | none | none | none | none | none |
| Default stations | KITCHEN, GRILL, DESSERT | KITCHEN, BARISTA | KITCHEN | **BAR**, KITCHEN | KITCHEN | BAKERY |
| Menu depth | categories + modifiers heavy | small catalogue, modifier-heavy (sizes, milks) | combos, modifier-light | drinks + limited food | platform-specific menus | fixed catalogue, low modifiers |
| Default payment methods | CASH, CARD | CASH, CARD | CASH, CARD | CASH, CARD, house tabs | CARD, BANK_TRANSFER | CASH, CARD |
| Inventory prompt | recipes matter | recipes light | recipes light | pour costing | recipes matter | recipes matter |
| Suggested extra roles | MANAGER, WAITER, CASHIER, ACCOUNTANT | CASHIER, MANAGER | CASHIER, MANAGER | CASHIER, MANAGER | MANAGER | CASHIER, MANAGER |

Two notes on honesty here:

- **"Tax inclusive" is not implementable today.** `OrderPricingCalculator` computes
  `total = subtotal - discount + tax + serviceCharge`
  (`services/pos-service/src/main/java/io/restaurantos/pos/service/OrderPricingCalculator.java:109`)
  — additive, i.e. exclusive only. The preset column above is the *intended* default; the setting
  must be stored but is inert until pos-service supports inclusive pricing. See gap **G-6**.
- **"Service charge 10%"** is likewise inert. See gap **G-5**.

Stating this in the design is the point: a preset that silently does nothing is exactly the failure
mode this project keeps hitting.

---

### 5.3 Step-by-step, with the endpoint each step calls

Legend for **API status**:
`EXISTS` = endpoint present and, as far as I could verify by reading it, functional ·
`PARTIAL` = endpoint exists but cannot express what this step needs ·
`MISSING` = no endpoint · `INERT` = data path exists end-to-end but nothing consumes the value.

---

#### Step 0 — Provision the tenant shell (control plane, SuperAdmin)

| Action | Endpoint | Status |
|---|---|---|
| Create tenant, HQ branch, auth tenant, OWNER admin, feature flags, COA | `POST /api/v1/platform/tenants` + `Idempotency-Key` | **EXISTS** — `PlatformAdminController:61` |
| Re-drive a failed provision | `POST /api/v1/platform/tenants/{id}/retry-provisioning` | **EXISTS** — `PlatformAdminController:144` |
| Read tenant / status | `GET /api/v1/platform/tenants/{id}` | **EXISTS** |
| Read feature flags | `GET /api/v1/platform/tenants/{id}/features` | **EXISTS** |

Request body is exactly `{brandName, adminEmail, tier}`. Response carries `tempPassword` **once**
(Redis, 1h TTL). There is **no SuperAdmin UI** —
`frontend/app/(platform)/platform/dashboard/page.tsx` is a nine-line placeholder (per
`tenant-configurability.md` §1.1, which I confirmed by reading the file list). Building one is out
of scope here but is the practical prerequisite for anyone to onboard anybody.

**Resumability:** the tenant row itself is the resume token. `status` is one of `PENDING_SETUP`,
`ACTIVE`, `PROVISIONING_FAILED`, and the onboarding UI must refuse to start against anything but
`ACTIVE`.

---

#### Step 1 — First login and forced password change  *(mandatory, not skippable)*

| Action | Endpoint | Status |
|---|---|---|
| Login | `POST /api/v1/auth/login` `{email, password, tenantSlug}` | **EXISTS** |
| → returns `403 PASSWORD_CHANGE_REQUIRED` with `fieldErrors[changeToken]` | `AuthExceptionHandler:77-78` | **EXISTS** |
| Set the real password | `POST /api/v1/auth/change-password/forced` `{changeToken, currentPassword, newPassword}` | **EXISTS**, public at gateway + service |
| Later, self-service change | `POST /api/v1/auth/change-password` | **EXISTS**, authenticated |

**Blocking frontend gap (G-1).** Nothing in `frontend/` handles `PASSWORD_CHANGE_REQUIRED`. The
onboarding epic must ship a `/login` branch that catches the 403, reads `changeToken` out of
`fieldErrors`, and renders a set-password form. Without it, onboarding cannot begin.

`LoginResponse` (`services/auth-service/src/main/java/io/restaurantos/auth/dto/response/LoginResponse.java`)
is `{accessToken, expiresInSeconds, userId, tenantId, branchId}` — it carries **no**
`mustChangePassword` flag, so the 403 is the only signal. That is fine; it just has to be handled.

**Completion:** derived — `must_change_password = false`. No new state needed.

---

#### Step 2 — Business profile  *(mandatory)*

Fields per the brief: legal name, brand, business type, country, currency, timezone, locale.

| Field | Where it can live today | Status |
|---|---|---|
| Brand name | `platform_db.tenants.brand_name`, editable **only** via `PATCH /api/v1/platform/tenants/{id}` — `SUPER_ADMIN` only | **PARTIAL** |
| Legal name | nowhere | **MISSING** |
| Business type | nowhere | **MISSING** |
| Country | nowhere | **MISSING** |
| Currency | `user_db.branches.currency_config` (jsonb) — settable via `PUT /api/v1/branches/{id}`, **read by nothing** | **INERT** |
| Timezone | `user_db.branches.timezone` — settable, and genuinely consumed by `reporting-service`'s `BranchTimeZoneResolver` | **EXISTS** (branch-scoped) |
| Locale | `auth_db.users.locale` per user (`UserAdminDtos.CreateUserRequest.locale`); no tenant-level default | **PARTIAL** |

**This step needs a new tenant-owned profile resource.** `tenant-configurability.md` §5.1 already
proposes `user_db.tenant_profiles`; this design adopts that proposal wholesale rather than inventing
a second one. What onboarding adds to it:

```
POST/GET/PATCH  /api/v1/tenant-profile        (owner: user-service, gate: branch.manage|rbac.manage)
  legalName, brandName, businessType, countryCode, currencyCode,
  defaultTimezone, defaultLocale, fiscalYearStartMonth
```

Two design decisions:

- **Brand name must become tenant-editable.** Today only a SuperAdmin can change it. Mirroring it
  onto `tenant_profiles` and having user-service call the platform internal API to keep
  `tenants.brand_name` in step is one option; the simpler and safer one is to make
  `tenant_profiles.brand_name` the display source of truth for the tenant plane and leave
  `tenants.brand_name` as the control-plane/billing label. **Open question OQ-1.**
- **Currency is a tenant-level decision, not a branch-level one**, and `branches.currency_config`
  should not be the home for it. It is inert today, so nothing regresses by moving it.

**Completion:** declared (the profile row exists and required fields are non-null).

---

#### Step 3 — Service model selection  *(mandatory)*

**Owned by the parallel business-models design.** Do not design it here.

What onboarding requires *from* that design, as a contract:
1. A **persisted, tenant-scoped selection** onboarding can write in one call and read back for resume.
2. A **completion predicate** onboarding can evaluate (at minimum: "a selection exists").
3. A **defaults contract**: given `businessType` from Step 2, which service models are pre-ticked.
4. A statement of which later steps each model **suppresses** — specifically whether Step 5
   (tables) is applicable. Onboarding uses that to skip Step 5 for delivery-only tenants rather than
   hardcoding by business type.

If the business-models design lands a tenant-scoped settings table, Step 2's `tenant_profiles` and
that table should be the same migration to avoid two competing tenant-settings homes. **OQ-2.**

---

#### Step 4 — Branches / outlets  *(mandatory; the HQ branch already exists)*

| Action | Endpoint | Status |
|---|---|---|
| List branches | `GET /api/v1/branches` (any authenticated user; RLS-scoped) | **EXISTS** |
| Correct the HQ branch (name, timezone, address, phone, email, opened-on) | `PUT /api/v1/branches/{id}` | **EXISTS** |
| Add a branch | `POST /api/v1/branches` — gate `rbac.manage` or `branch.manage` | **EXISTS** |
| Soft-delete | `DELETE /api/v1/branches/{id}` | **EXISTS** |
| Set the branch **NTN / STRN** | — | **MISSING (G-2)** |

The saga's HQ branch is created as `"<brandName> HQ"` with no address and a hardcoded
`Asia/Karachi` timezone (`BranchService.createInternal`). Step 4's first job is letting the operator
fix that; it is a `PUT`, and the form should be pre-filled from `GET /api/v1/branches`.

**G-2 — branch `ntn` and `fbr_strn` have no write path, at all.**
`BranchEntity` declares both (`services/user-service/src/main/java/io/restaurantos/user/entity/BranchEntity.java:39-43`).
`BranchController.toResponse` returns both (line 92). `reporting-service` reads both to build the
FBR Tax Summary header (`FbrTaxSummaryService.java:113-115`). But:
- `BranchDtos.CreateBranchRequest` has **no `ntn` and no `fbrStrn` field**;
- `BranchDtos.UpdateBranchRequest` has **no `ntn` and no `fbrStrn` field**;
- `BranchService.create` and `BranchService.update` never call `setNtn`/`setFbrStrn`;
- a repo-wide grep for `setNtn` in non-test main sources returns exactly one hit, and it is
  **purchasing-service's vendor** (`VendorService.java:67`), a different entity.

So the two columns can only ever hold `NULL` in a system operated through its own API. The FBR Tax
Summary report's NTN/STRN header is permanently blank, and its `dataNotes` mechanism will not even
say why — that note only fires when user-service is *unreachable*
(`FbrTaxSummaryService.java:126-127`), not when the value is simply null. This is the textbook shape
of the defects this project keeps finding, and it is the direct blocker for the brief's
"hook for FBR e-invoicing with the tenant's own NTN".

**Fix:** add `ntn` and `fbrStrn` to both branch request DTOs and to both service methods. That is a
~15-line change in `BranchDtos.java` + `BranchService.java` and it unblocks Steps 4, 6 and 12.

**Second finding (G-3) — `max_branches` is not enforced on branch creation.**
`TierLimits` sets `tenants.max_branches` (1 for STARTER), and `TenantSubscriptionService` checks it
— but only when a tier is **downgraded** (`TenantSubscriptionService.java:236-239`).
`BranchService.create` performs no limit check and user-service never calls platform-admin to ask.
A STARTER tenant can create unlimited branches through `POST /api/v1/branches`. Onboarding's
branch step is exactly where a user will discover this. The onboarding UI should read
`GET /api/v1/platform/tenants/{id}` for the limit — except that endpoint is `SUPER_ADMIN`-only, so
today the tenant plane **cannot even read its own limits**. That needs a tenant-readable
`GET /api/v1/tenant-profile/limits` or equivalent. **OQ-3.**

**Completion:** derived — `GET /api/v1/branches` returns ≥1 branch whose name has been edited from
the saga default, or simply ≥1 branch. Prefer the simple predicate.

---

#### Step 5 — Floors, sections, tables  *(skippable; suppressed for QSR / cloud kitchen / delivery-only)*

| Action | Endpoint | Status |
|---|---|---|
| List tables for a branch | `GET /api/v1/pos/tables?branchId=` — gate `pos.order.view` | **EXISTS** |
| Change a table's status | `PATCH /api/v1/pos/tables/{id}?branchId=` `{status}` — gate `pos.tables.manage` | **EXISTS** |
| Read a table's active order | `GET /api/v1/pos/tables/{id}/active-order` | **EXISTS** |
| **Create a table** | — | **MISSING (G-4)** |
| **Update / delete a table** | — | **MISSING (G-4)** |
| **Floors / sections / zones** | — | **MISSING**, no such concept anywhere |

`TableController` (`services/pos-service/src/main/java/io/restaurantos/pos/web/TableController.java`,
54 lines, read in full) has exactly three methods and none of them creates a table. The
`dining_tables` table exists in `V1__pos_schema.sql:115-137` with
`table_number`, `capacity`, `status ∈ {AVAILABLE, OCCUPIED}`, and `floor_plan_x/y/shape` —
so a floor-plan *rendering* was anticipated, but there is **no floor/section/zone entity**: a table
belongs to a branch and nothing else.

**What this step needs built:**
```
POST   /api/v1/pos/tables?branchId=      {tableNumber, capacity, sectionId?, floorPlanX?, floorPlanY?, floorPlanShape?}
PUT    /api/v1/pos/tables/{id}?branchId= {tableNumber, capacity, sectionId?, floorPlan…}
DELETE /api/v1/pos/tables/{id}?branchId=            (soft — dining_tables already has deleted_at)
POST   /api/v1/pos/sections?branchId=    {name, sortOrder}      ← new table `dining_sections`
GET    /api/v1/pos/sections?branchId=
```
Gate all writes on `pos.tables.manage`, which already exists in the catalog (it is granted to WAITER
in `030-create-roles-permissions.xml:102`) — though note that granting *table creation* to WAITER is
probably wrong, so a new `pos.tables.admin` code may be warranted. **OQ-4.**

Onboarding also wants a **bulk create** affordance ("tables 1-20, capacity 4"), which is a client-side
loop over `POST` unless a batch endpoint is added. A loop is acceptable at onboarding volumes.

**Skip semantics:** when Step 3's service model has no dine-in, this card is hidden entirely, not
merely skippable. When dine-in exists but the operator skips, record `SKIPPED` with reason; POS still
works via the walk-in/counter path.

**Completion:** derived — `GET /api/v1/pos/tables?branchId=` returns ≥1 row.

---

#### Step 6 — Tax profile  *(mandatory; the most under-built step)*

The brief asks for: rates, inclusive vs exclusive, service charge, and the FBR/NTN hook.

| Concern | What exists | Status |
|---|---|---|
| Per-item tax rate | `menu_items.tax_rate_pct NUMERIC(5,2)` + `tax_rate_code TEXT` (`V1__pos_schema.sql:38-39`), settable on `POST`/`PUT /api/v1/pos/menu/items` via `MenuItemAdminDtos` | **EXISTS**, but per-item only |
| A tenant **rate catalogue** (named rates, reusable) | nothing — `tax_rate_code` is free text with no table behind it | **MISSING** |
| Inclusive vs exclusive pricing | nothing; `OrderPricingCalculator:109` is additive-only | **MISSING (G-6)** |
| Service charge | `orders.service_charge_paisa BIGINT` column + `Order.serviceChargePaisa = 0L` field; `OrderPricingCalculator` accepts it as a **parameter** | **INERT (G-5)** |
| Branch NTN / STRN | columns exist, no write path | **MISSING (G-2)** |

**G-5 — service charge is a dead field.** A repo-wide grep for `setServiceChargePaisa` across
`services/pos-service/src/main/java` returns **zero call sites**. The only hits for `serviceCharge`
are: the DTO field, the calculator's parameter and its arithmetic, the record component, a comment in
`PaymentServiceImpl:118`, and the entity's `= 0L` initialiser
(`services/pos-service/src/main/java/io/restaurantos/pos/domain/model/Order.java:69`). Nothing ever
assigns a non-zero value. The plumbing is complete from the column to the receipt total; the *source*
is absent. Adding service charge is therefore small in pos-service (a setting + one assignment) and
should not be scoped as if it were a new subsystem.

**G-6 — inclusive pricing is not modelled.** `OrderPricingCalculator.compute` returns
`total = max(0, subtotal - totalDiscount + tax + serviceChargePaisa)`. Tax-inclusive pricing requires
back-computing tax out of the displayed price, which changes both the calculator and every
`base_price_paisa` interpretation. This is a real pos-service change, not a settings toggle. A cafe
or QSR in Pakistan quoting menu prices inclusive of sales tax is the common case, so this matters.

**What this step needs built** (aligning with `tenant-configurability.md` §5.2/§5.3, which proposes
finance-service as the tax-profile owner and pos-service as the service-charge owner):
```
GET/PUT /api/v1/finance/tax-profile          {pricingMode: INCLUSIVE|EXCLUSIVE, defaultRateCode, rates:[…]}
POST    /api/v1/finance/tax-rates            {code, name, ratePct, appliesTo}
GET/PUT /api/v1/pos/service-charge?branchId= {enabled, ratePct, appliesToOrderTypes[], taxable}
PATCH   /api/v1/branches/{id}                {ntn, fbrStrn}      ← G-2 fix, reuse the existing PUT
```
Onboarding's tax card presents: pricing mode (preset from business type), a rate list pre-seeded with
Pakistan's standard rates (**the exact values are for the parallel FBR research to supply — I did not
verify them and will not guess**), the service-charge toggle, and the NTN/STRN fields.

**Completion:** declared. Tax is a decision, not a row count.

---

#### Step 7 — Menu: categories → items → modifiers  *(mandatory; the longest step)*

| Action | Endpoint | Status |
|---|---|---|
| List categories (admin view, includes inactive) | `GET /api/v1/pos/menu/categories/admin` | **EXISTS** |
| Create category | `POST /api/v1/pos/menu/categories` `{name, description, sortOrder}` | **EXISTS** |
| Update / activate / deactivate category | `PUT /categories/{id}`, `PATCH /categories/{id}/activate`, `/deactivate` | **EXISTS** |
| List items (admin) | `GET /api/v1/pos/menu/items/admin` | **EXISTS** |
| Create item | `POST /api/v1/pos/menu/items` `{categoryId, name, description, basePricePaisa, taxRatePct, taxRateCode}` | **EXISTS** |
| Update / activate / deactivate / delete item | `PUT /items/{id}`, `PATCH /items/{id}/activate` `/deactivate`, `DELETE /items/{id}` | **EXISTS** |
| **Modifier groups and modifiers** | — | **MISSING (G-7)** |
| **CSV / bulk import** | — | **MISSING (G-8)** |

All menu writes gate on `pos.menu.manage` (`MenuController`, verified per-method).
`basePricePaisa` is `@NotNull @PositiveOrZero Long` — paisa, correct.

**G-7 — modifiers have a schema and domain model but no API.** `modifier_groups` and `modifiers`
tables exist with RLS (`V1__pos_schema.sql:76-113`), and the JPA models exist
(`pos/domain/model/ModifierGroup.java`, `pos/domain/model/Modifier.java`). `MenuController` has **no**
modifier endpoints — verified by listing every mapping on the class. Modifiers are consumed at order
time (`OrderPricingCalculator`, `OrderItemModifier`) but can only be created by direct SQL. For a
cafe (sizes, milk choices) or a QSR (combo options), modifiers *are* the menu. This is a required
build for Step 7, not an optional extra.

**G-8 — no CSV/bulk import anywhere in the codebase.** A grep for `csv`/`bulkImport` across all
`services/*/src/main` returns nothing. Per §2.1 item 6, this is the step where a real restaurant
either succeeds or gives up. Design:

```
POST /api/v1/pos/menu/import/preview   multipart/form-data  → dry run, returns per-row diagnostics
POST /api/v1/pos/menu/import/commit    {uploadId}           → idempotent apply, returns a per-row result
GET  /api/v1/pos/menu/import/template  → the CSV template
```
Column set: `category, item_name, description, price, tax_rate_pct, tax_rate_code, station_code,
modifier_group, modifier_name, modifier_price_delta, active`.

Non-negotiables for the import:
- **Price parsing happens once, at the edge, into `long` paisa.** `"1,250.00"` → `125000L`. No
  float ever touches the pipeline (P6). Reject a row whose price has more than 2 decimal places
  rather than rounding it silently.
- **Preview before commit, always.** Row-level errors with line numbers; a partial file must be
  rejectable per row, not all-or-nothing.
- **Commit is idempotent by `uploadId`.** Re-submitting must not double the menu. The platform
  already has `IdempotencyService` in `shared-lib`; use it.
- Categories referenced by name are created on demand; station codes referenced by name resolve
  against Step 9's stations, and an unknown station is a warning, not a failure (routing falls back).
- `file-service` exists (`/api/v1/files`) and is the natural place to park the uploaded file.

**Completion:** derived — item count ≥ 1 from `GET /api/v1/pos/menu/items/admin`. Show the count on
the card ("48 items across 6 categories") rather than a tick; it is more informative and it is free.

---

#### Step 8 — Payment methods and till  *(mandatory — this is the activation gate)*

| Action | Endpoint | Status |
|---|---|---|
| Enable/disable payment methods per tenant or branch | — | **MISSING (G-9)** |
| Open a till session | `POST /api/v1/pos/tills` (`TillController`) | **EXISTS** |
| Take a payment | `POST /api/v1/pos/orders/{id}/payments` (`PaymentController`) | **EXISTS** |

**G-9 — payment methods are a compile-time enum.**
`services/pos-service/src/main/java/io/restaurantos/pos/domain/enums/PaymentMethod.java` is
`{CASH, CARD, LOYALTY_POINTS, BANK_TRANSFER, VOUCHER, CHARGE_TO_ACCOUNT}`. There is no per-tenant
enablement, no display ordering, no per-method configuration (e.g. which GL account a card
settlement posts to). A bar that wants house tabs and a cloud kitchen that wants only card+transfer
get the identical, unfiltered list.

Minimum viable build:
```
GET/PUT /api/v1/pos/payment-methods?branchId=   [{method, enabled, sortOrder, label}]
```
A new tenant-scoped table keyed on the enum, seeded from the business-type preset. The enum stays the
domain vocabulary; the table is the tenant's subset of it. `CHARGE_TO_ACCOUNT` deserves a guard —
it calls into finance-service's AR seam before persisting (per the enum's own javadoc), so enabling
it without house accounts configured will fail at the till.

**Completion:** declared (at least one method enabled) — plus, ideally, the celebrated
milestone: derived from `GET /api/v1/pos/orders` returning ≥1 closed order. "You took your first
order" is the moment worth marking.

---

#### Step 9 — Stations and item→station routing (KDS/BDS)  *(skippable; hidden when `FEATURE_KDS` off)*

| Action | Endpoint | Status |
|---|---|---|
| List stations for a branch | `GET /api/v1/pos/stations?branchId=` — gate `pos.menu.view` or `pos.kds.view` | **EXISTS** |
| Create station | `POST /api/v1/pos/stations?branchId=` `{code, name}` — gate `pos.menu.manage` | **EXISTS** |
| Update / deactivate station | `PUT /stations/{id}`, `DELETE /stations/{id}` (deactivates) | **EXISTS** |
| Assign a menu item to a station | `PUT /api/v1/pos/menu/items/{id}/station` — gate `pos.menu.manage` | **EXISTS** |
| KDS board reads by station | `GET /api/v1/kitchen/kds/tickets?stationCode=` | **EXISTS** |

This step is **fully served by existing endpoints** — the only one of the "hard" steps that is.
`V7__stations.sql` introduced the `stations` table with RLS and a `(tenant_id, branch_id, code)`
unique constraint, added `menu_items.station_id` as a nullable FK, and `order_items.station_id` as a
point-in-time snapshot. The migration's own comments (lines 42-52) explain that `menu_items.station_id`
is nullable because menu items are tenant-scoped while stations are branch-scoped, and that routing
falls back to the legacy free-text `kds_station` and then to `"DEFAULT"`.

**Kitchen vs bar is naming convention only.** `StationDto` is `{id, branchId, code, name, active}` —
there is **no station type/kind field**. A "BDS" is a station whose code happens to be `BAR`, and the
KDS route (`/api/v1/kitchen/kds/tickets?stationCode=`) serves it identically. If bar display needs to
differ (different bump behaviour, different ticket layout), a `station_type` column is required.
**OQ-5.** For onboarding, the preset simply creates differently-named stations, which is honest.

Two consequences for the onboarding UI:
- Stations are **per branch**, menu items are **per tenant**. With multiple branches the
  item→station assignment is ambiguous by construction. Onboarding should assign against the
  **HQ/primary branch** and say so plainly.
- Because routing degrades gracefully to `"DEFAULT"`, this step is genuinely safe to skip: tickets
  still fire, they just all land on one board.

**Completion:** derived — station count ≥ 1 **and** ≥1 menu item with a non-null `station_id`.

---

#### Step 10 — Staff: roles and first users  *(skippable — the owner can run alone)*

| Action | Endpoint | Status |
|---|---|---|
| **Role catalogue** | `GET /api/v1/roles` — gate `rbac.manage` or `rbac.user.manage` | **EXISTS** |
| Permission vocabulary (for a custom-role builder) | `GET /api/v1/permissions` | **EXISTS** |
| Create a user | `POST /api/v1/users` `{email, fullName, locale, branchId, roleCode}` → returns `tempPassword`, `mustChangePassword=true` | **EXISTS** |
| Assign an additional branch-role | `POST /api/v1/users/{userId}/branch-roles` `{branchId, roleCode, approvalLimitPaisa}` | **EXISTS** |
| Revoke a branch-role | `DELETE /api/v1/users/{userId}/branch-roles` | **EXISTS** |
| List / read / deactivate / reactivate users | `GET /api/v1/users`, `/{id}`, `POST /{id}/deactivate`, `/reactivate` | **EXISTS** |
| Admin reset password | `POST /api/v1/users/{userId}/reset-password` | **EXISTS** |
| **Email the invite** | — | **MISSING (G-10)** |

The brief is right that the role catalogue exists. `GET /api/v1/roles` returns only roles the caller
may assign — `RoleCatalogService.listAssignableRoles` filters by the caller's own permission ceiling
and attaches a `ROLES_WITHHELD_ABOVE_CEILING` warning with a **count, never names**
(`RoleCatalogController:80-93`). The onboarding role picker gets this for free and should render the
warning, or an OWNER will silently not understand why a role is absent.

Seeded system roles (from `030-create-roles-permissions.xml:84-91` plus later changelogs):
`OWNER`, `TENANT_ADMIN`, `MANAGER`, `ACCOUNTANT`, `INVENTORY_MANAGER`, `CASHIER`, `FINANCE_VIEWER`,
and `WAITER` (added later, with an explicit note about `tenant_id IS NULL` uniqueness semantics,
lines 85-103).

**G-10 — there is no way to deliver the invite.** `notification-service` has zero source files. Every
created user's `tempPassword` is returned in the API response and must be read off the screen and
handed over in person. The onboarding UI must therefore present it as an explicit
"copy this and give it to them — it will not be shown again" affordance, and must not pretend an
email is on its way. Same constraint as Step 0's admin credential.

**Note on Step 1 recursion:** every staff member created here will hit the same
`PASSWORD_CHANGE_REQUIRED` wall on their first login (`mustChangePassword` is always true —
`UserAdminDtos` line 96 javadoc). G-1's fix serves both.

**Completion:** derived — user count ≥ 2 (the owner plus one). Skippable; a single-operator cafe is
a real case.

---

#### Step 11 — Receipt, branding, printers  *(skippable)*

| Concern | What exists | Status |
|---|---|---|
| Receipt config storage | `user_db.branches.receipt_config` jsonb, settable via `POST`/`PUT /api/v1/branches` | **INERT** — no schema, no renderer, **read by nothing** |
| Tenant theme/branding | `platform_db.tenants.theme_config` jsonb — **no API writes it**; `UpdateTenantRequest` is `{brandName, billingRef, trialEndsAt, renewsAt}` only | **INERT + no write path** |
| Logo upload | `file-service` at `/api/v1/files` | **EXISTS** (generic) |
| Printer configuration / pairing / ESC-POS | — | **MISSING** — a grep for `printer`/`escpos` across all services returns **zero** files |
| Appearance settings page | `frontend/app/(tenant)/settings/appearance/page.tsx` | exists; scope unverified |

`branches.receipt_config` and `tenants.theme_config` are the same failure pattern as G-2: JSONB
columns with a setter and no consumer. `receipt_config` at least has a write path; `theme_config`
has neither a write path nor a reader.

**Printing is the parallel POS-thermal-printing research's territory** — I do not design it here
beyond stating the onboarding requirement: this step must be able to (a) capture the receipt header
(business name, address, NTN — sourced from Steps 2/4/6), (b) upload a logo, and (c) register at
least one printer per branch with a station/role assignment (receipt vs kitchen). (c) has no backing
API and depends entirely on that research.

**Completion:** declared. Print a test receipt if the printing work lands a test endpoint.

---

#### Step 12 — FBR e-invoicing enablement  *(skippable; depends on Steps 4 and 6)*

**The external contract is owned by the parallel FBR research**
(`.planning/research/erp-completion/fbr-api.md`) and `tenant-configurability.md` §4/§5.8, which
already states there is no FBR service. I add only the onboarding-side requirements:

1. **The NTN capture must exist first.** G-2 is the blocker: `branches.ntn` and `branches.fbr_strn`
   are unwritable. Nothing about FBR onboarding is possible until that DTO change lands.
2. What exists today that touches FBR is **read-only reporting**:
   `reporting-service`'s `FbrTaxSummaryService` + `ReportController` + the frontend page at
   `frontend/app/(tenant)/app/reports/fbr/page.tsx`. There is no submission path, no digital
   invoice, no FBR credential storage.
3. Onboarding's card should therefore be honest: "Record your NTN and STRN so tax reports carry
   them" — which is achievable — and hold back "Enable e-invoicing" until the service exists.
4. Credential storage (FBR API tokens) is a security design that must not be improvised inside an
   onboarding wizard. Out of scope here; flagged.

**Completion:** declared, and partial — "NTN recorded" is completable now (post-G-2); "e-invoicing
live" is not.

---

#### Step 13 — Inventory: units → ingredients → recipes → opening stock  *(skippable; hidden when `FEATURE_INVENTORY` off)*

| Action | Endpoint | Status |
|---|---|---|
| List / create units of measure | `GET`/`POST /api/v1/inventory/uom` `{code, name, measureType, baseUnitCode, toBaseFactor}` | **EXISTS** |
| Ingredient categories (incl. tree) | `GET /api/v1/inventory/categories`, `/tree`, `POST`, `PUT`, `PUT /{id}/parent`, `POST /{id}/archive` `/restore` | **EXISTS** |
| Storage locations | `GET`/`POST`/`PUT /api/v1/inventory/storage-locations`, archive/restore | **EXISTS** |
| Create ingredient | `POST /api/v1/inventory/ingredients` — 18-field `CreateIngredientRequest` incl. conversions and allergens | **EXISTS** |
| Create a recipe version | `POST /api/v1/inventory/recipes` `{menuItemId, yieldServings, effectiveFrom?, name?, lines[]}` | **EXISTS** |
| **Recipe coverage** (how many menu items have a recipe) | `GET /api/v1/inventory/recipes/coverage` | **EXISTS** |
| Live plate-cost preview while building | `POST /api/v1/inventory/recipes/preview` | **EXISTS** |
| Record opening stock | `POST /api/v1/inventory/opening-balance` `{ingredientId, branchId, qty, unitCostPaisa, expiryDate?}` | **EXISTS** |

**This step is completely served by existing APIs** — the best-covered step in the whole flow, and
it already has screens (`app/(tenant)/app/inventory/{setup,categories,ingredients,recipes,stock,coverage}`).
Onboarding's job here is purely sequencing and a progress read-out, not new endpoints.

`GET /api/v1/inventory/recipes/coverage` is a gift: it is a **ready-made completion metric** for the
hardest sub-step ("have you costed your menu?"). Use it directly on the card.

Note that all inventory writes authorise through `InventoryAuthorizationService.authorizeManage(tenantId, branchId)`
using the JWT's branch claim, not a `@PreAuthorize` (`OpeningBalanceController`, `UnitOfMeasureController`).
Onboarding must therefore have the right branch selected in the session before these calls, which the
existing branch-switcher (`GET /api/v1/branches/mine`) provides.

**Completion:** derived, three sub-signals — UoM count ≥ 1, ingredient count ≥ 1, recipe coverage > 0%.

---

## 6. Onboarding state: model and API

Nothing tracks setup progress today. This is the one genuinely new subsystem the feature needs.

### 6.1 Where it lives

**`user-service`, in `user_db`.** Reasons: it already owns branches and would own `tenant_profiles`
(Step 2); it is tenant-scoped with RLS; and it is *not* `platform_db`, which is control-plane and
whose tables are keyed for SuperAdmin access rather than tenant RLS. Putting tenant onboarding state
in `platform_db` would make every read cross a service boundary for no benefit.

### 6.2 Schema

```sql
CREATE TABLE onboarding_steps (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        NOT NULL,
    step_key        VARCHAR(64) NOT NULL,     -- 'BUSINESS_PROFILE', 'MENU', 'TAX_PROFILE', …
    status          VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED'
                    CHECK (status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','SKIPPED')),
    completed_at    TIMESTAMPTZ,
    completed_by    UUID,
    skip_reason     TEXT,
    payload         JSONB,                    -- declared-step answers (pricing mode, etc.)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_onboarding_step UNIQUE (tenant_id, step_key)
);
ALTER TABLE onboarding_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_steps FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON onboarding_steps
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_steps TO user_service_user;
```

`FORCE ROW LEVEL SECURITY` is stated explicitly because the project's own runbook records that
Testcontainers has run as a superuser and silently bypassed RLS (open task #7). The migration must
match the `FORCE` convention the rest of the platform uses, and its IT must connect as the
non-superuser role or it proves nothing.

**Money:** `payload` may carry currency values; they are `BIGINT` paisa in JSON, never decimals. The
service-charge *rate* is a percentage, not money, and is a `NUMERIC` — the same distinction
`RecordOpeningBalanceRequest` already draws for `unitCostPaisa`.

### 6.3 API

```
GET   /api/v1/onboarding                  → {overallStatus, activationComplete, steps:[{stepKey,status,completedAt,derived,detail}]}
PATCH /api/v1/onboarding/{stepKey}        {status: IN_PROGRESS|COMPLETED|SKIPPED, skipReason?, payload?}
POST  /api/v1/onboarding/refresh          → re-derive every derivable step, return the refreshed list
```
Gate: `branch.manage` or `rbac.manage` — the same pair `BranchController` already uses, so OWNER and
TENANT_ADMIN both qualify and no new permission code is needed. (Adding a code would require a
changelog entry or `PermissionCatalogClosureTest` fails — that test scans `@PreAuthorize`
expressions for dotted codes the changelog does not declare, per `RoleCatalogController`'s javadoc.
Reusing existing codes avoids that trap.)

### 6.4 Derivation

`POST /refresh` fans out to the owning services and recomputes status. Each derivation is one call:

| Step | Derivation |
|---|---|
| `BRANCHES` | `GET /api/v1/branches` → count ≥ 1 |
| `TABLES` | `GET /api/v1/pos/tables?branchId=` → count ≥ 1 |
| `MENU` | `GET /api/v1/pos/menu/items/admin` → count ≥ 1 |
| `STATIONS` | `GET /api/v1/pos/stations?branchId=` → count ≥ 1 **and** ≥1 item with `stationId` |
| `STAFF` | `GET /api/v1/users` → count ≥ 2 |
| `INVENTORY` | `GET /api/v1/inventory/recipes/coverage` → coverage > 0 |
| `FIRST_ORDER` | `GET /api/v1/pos/orders` → ≥1 closed order |
| `BUSINESS_PROFILE`, `SERVICE_MODEL`, `TAX_PROFILE`, `PAYMENTS`, `RECEIPT`, `FBR` | declared — read the stored row |

**Design decision: derivation is pull, not push.** The alternative — consuming domain events to
maintain the checklist — means a new consumer per step, each with its own outbox correlation, for a
screen a user visits a handful of times. Pull on demand is a dozen HTTP calls in a request that
happens rarely, and it cannot drift. Revisit only if the checklist becomes a hot path.

**Failure handling:** a derivation call that fails must mark that step `unknown` in the response with
a reason, **not** silently report `NOT_STARTED`. Reporting "you haven't built your menu" because
pos-service was briefly down is the same class of lie as `requireBranchId`'s deleted fallback.

---

## 7. Frontend design (fitting the 4-layer rule)

Routes, under the existing `(tenant)` group so the session/layout applies:

```
app/(tenant)/onboarding/page.tsx                 the checklist dashboard
app/(tenant)/onboarding/[step]/page.tsx          one step, one form
app/(auth)/login/                                + PASSWORD_CHANGE_REQUIRED branch  (G-1)
```

Layers, per `frontend/eslint.config.mjs`:

| Layer | File | Contents |
|---|---|---|
| 1 api-client | `lib/api-client/schemas/onboarding.schema.ts` | zod schemas for the wire shape |
| 2 repository | `lib/repositories/onboarding.repository.ts` | `getState()`, `patchStep()`, `refresh()` — `get`/`patch` from `lib/api-client/request`, parse, map |
| 3 adapter + hooks | `lib/adapters/onboarding.adapter.ts`, `lib/hooks/onboarding/use-onboarding.ts` | react-query; query key registered in `lib/hooks/query-keys.ts` |
| 4 components | `components/onboarding/*` | `OnboardingChecklist`, `StepCard`, `StepShell`, per-step forms |

The step forms **reuse the existing module hooks** rather than re-implementing writes: the menu step
calls the same `pos` hooks the menu screen uses; the inventory step calls the same `inventory` hooks
`app/(tenant)/app/inventory/*` already use. That is the whole reason to build a checklist rather than
a wizard — the forms already exist in module screens, and duplicating them would fork the validation.

Two things the shell needs:

- **A gate in `app/(tenant)/layout.tsx`**: if activation is incomplete, show a persistent banner
  linking to `/onboarding`. Do **not** hard-redirect — an operator investigating a problem must be
  able to reach the app.
- **Fix `useTenantBrand`.** `frontend/lib/hooks/use-tenant-brand.ts` resolves the brand from
  `NEXT_PUBLIC_DEFAULT_TENANT_SLUG`, a build-time constant. A freshly onboarded tenant will see
  `"RestaurantOS"`. The brand must come from the session's tenant (Step 2's profile endpoint), or
  the first thing every new customer sees is somebody else's product name.

---

## 8. Gap register

Ordered by how hard they block onboarding.

| ID | Gap | Evidence | Severity |
|---|---|---|---|
| **G-1** | Frontend does not handle `403 PASSWORD_CHANGE_REQUIRED`; every provisioned admin's first login dead-ends | grep: zero hits in `frontend/`; server side at `AuthExceptionHandler:77-78` | **Blocker** |
| **G-2** | Branch `ntn` / `fbr_strn` have **no write path** — absent from both request DTOs, never set by any service | `BranchDtos.java` (Create/Update records), `BranchService.create`/`update`; read by `FbrTaxSummaryService:113-115` | **Blocker** (Steps 4, 6, 12) |
| **G-4** | No create/update/delete for dining tables; no floor/section entity | `TableController.java` — 3 methods, none creates | **Blocker** (Step 5) |
| **G-7** | Modifier groups/modifiers: tables + JPA models exist, **no controller, no admin API** | `V1__pos_schema.sql:76-113`; `MenuController` mappings | **Blocker** (Step 7) |
| **G-8** | No CSV/bulk import anywhere | grep across `services/*/src/main` | **High** (Step 7 usability) |
| **G-9** | Payment methods are a compile-time enum; no per-tenant enablement | `pos/domain/enums/PaymentMethod.java` | **High** (Step 8) |
| **G-5** | `orders.service_charge_paisa` is **never assigned** — column, field, DTO and arithmetic all present, zero call sites | grep for `setServiceChargePaisa` → none; `Order.java:69` | **High** (Step 6) |
| **G-6** | Inclusive tax pricing not modelled; calculator is additive-only | `OrderPricingCalculator.java:109` | **High** (Step 6) |
| **G-3** | `max_branches` enforced **only** on tier downgrade, not on branch creation; and the tenant plane cannot read its own limits | `TenantSubscriptionService.java:236-239`; `BranchService.create` has no check; `PlatformAdminController` is `SUPER_ADMIN`-only | **High** |
| **G-10** | No notification channel — `notification-service` has **zero** `.java` files; no invite emails, no nudges | `find` | **Medium** (workaround: out-of-band) |
| G-11 | No printer configuration of any kind | grep `printer`/`escpos` → zero | Medium (Step 11; owned by parallel research) |
| G-12 | `branches.currency_config`, `branches.receipt_config`, `tenants.theme_config` are inert — written (the first two) and read by nothing | grep for all three | Medium |
| G-13 | `tenants.theme_config` additionally has **no write path** — absent from `UpdateTenantRequest` | `PlatformDtos.UpdateTenantRequest` per `tenant-configurability.md` §1.1 | Medium |
| G-14 | `useTenantBrand` resolves brand from a build-time env var — single-tenant assumption in a multi-tenant shell | `frontend/lib/hooks/use-tenant-brand.ts` | Medium |
| G-15 | `scripts/onboarding.py`'s feature list has drifted from `TierFeatureDefaults` (15 vs 20 codes; missing `FEATURE_NLQ` et al.) — seeded tenants get 403s on those routes | `scripts/onboarding.py:58-105` vs `TierFeatureDefaults.java:31-82` | Medium |
| G-16 | Stations have no type field; "BDS" is a naming convention only | `StationDto.java` | Low |
| G-17 | No tenant-level default locale; only per-user `locale` | `UserAdminDtos.CreateUserRequest` | Low |
| G-18 | Provisioning retry cannot recover from a failure that occurred *after* admin creation — no internal endpoint deactivates the account, so retry 409s on the duplicate email | `ProvisioningService.java:353-359` (self-documented) | Low (named, not new) |

**A note on verification limits.** I read the controllers, DTOs, services and migrations cited above.
I did **not** run any service, execute any integration test, or exercise any endpoint. "EXISTS" in
this document means "the mapping, the DTO and the service method are present and coherent when read".
Given this repository's history — an entire API unreachable from one wrong JWT claim, provisioning
that never worked against a real database, compensation that could not fire because Feign cannot send
PATCH — **each "EXISTS" should be confirmed by an actual call before a plan depends on it.** The
highest-risk ones to confirm first are the pos-service menu/station writes and the inventory writes,
because they authorise through two different mechanisms (`@PreAuthorize` vs
`InventoryAuthorizationService`) and onboarding drives both from the same session.

---

## 9. Build order

| Wave | Contents | Why here |
|---|---|---|
| **0** | G-1 (forced password change UI) + G-2 (branch NTN/STRN DTO fields) | Two small changes; without G-1 nothing else is reachable, and G-2 is ~15 lines that unblocks three steps |
| **1** | `tenant_profiles` + `onboarding_steps` migrations, `/api/v1/tenant-profile`, `/api/v1/onboarding` | The spine. Coordinate the table with the parallel business-models design (OQ-2) |
| **2** | Checklist UI shell + Steps 2, 4, 10, 13 (all served by existing APIs) | Ships a genuinely usable onboarding on top of endpoints that already exist |
| **3** | G-4 (table + section CRUD), G-7 (modifier API), Step 5 + Step 7 UI | The two biggest missing APIs, both in pos-service |
| **4** | G-9 (payment methods), G-5 (service charge), tax profile, Step 6 + Step 8 UI | Tax and money settings, together, so the arithmetic changes land once |
| **5** | G-8 (CSV import) | High value, self-contained, best built after the menu API is complete |
| **6** | G-6 (inclusive pricing), Step 11 (receipt/printers, gated on parallel research), Step 12 (FBR, gated on parallel research) | Deepest changes and the externally-dependent ones |

---

## 10. Open questions

- **OQ-1** — Is `tenants.brand_name` (control plane, `platform_db`) or `tenant_profiles.brand_name`
  (tenant plane, `user_db`) the display source of truth? They will diverge unless one is authoritative.
  A tenant cannot edit the former (SUPER_ADMIN only), so the tenant plane needs the latter.
- **OQ-2** — Does the parallel business-models design introduce its own tenant-settings table? If so,
  `tenant_profiles` and it should be one migration, not two competing homes for tenant settings.
- **OQ-3** — How does the tenant plane read its own tier limits (`max_branches`, `max_users`)?
  Everything on `PlatformAdminController` is `SUPER_ADMIN`. Onboarding needs a tenant-readable
  limits endpoint, or it will let a STARTER tenant create branches it is not entitled to (G-3).
- **OQ-4** — Should table creation gate on the existing `pos.tables.manage` (granted to WAITER) or a
  new admin-only code? A new dotted code requires a changelog entry or `PermissionCatalogClosureTest`
  fails.
- **OQ-5** — Do bar displays need to differ from kitchen displays behaviourally? If yes, `stations`
  needs a `station_type` column and the KDS route needs to branch on it (G-16).
- **OQ-6** — Which Pakistan sales-tax rates should the tax step pre-seed? Deferred to the parallel FBR
  research; I will not guess statutory rates.
- **OQ-7** — Where do FBR API credentials live once e-invoicing is real? Not a decision to improvise
  inside a setup wizard.
- **OQ-8** — Should `scripts/onboarding.py` be rewritten to drive the real APIs (P7), or explicitly
  scoped as a CI-only fixture with its drifted feature list replaced by a platform API call (G-15)?
  Rewriting it is the better long-term answer and would give the provisioning saga a second live
  exerciser.
