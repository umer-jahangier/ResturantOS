# Tenant Configurability — what a SuperAdmin can actually set today, and what is missing

Research date: 2026-08-07
Branch read: `phase-13-access-repair` @ `5fba4a9`
Scope: platform-admin-service, gateway feature enforcement, and every service that owns a
setting a tenant would expect to configure.

Every claim below cites a file I opened. Where I could not verify something (notably the FBR
API contract) it is marked **UNVERIFIED** rather than guessed.

---

## 1. What a SuperAdmin can configure per tenant today

### 1.1 The complete API surface

`services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/PlatformAdminController.java`
is the entire SuperAdmin control plane. Class-annotated `@PreAuthorize("hasAuthority('SUPER_ADMIN')")`.

| Endpoint | What it changes |
|---|---|
| `POST /api/v1/platform/tenants` | provision: brandName, adminEmail, tier |
| `GET /api/v1/platform/tenants` / `/{id}` | read |
| `PATCH /api/v1/platform/tenants/{id}` | **brandName, billingRef, trialEndsAt, renewsAt** — nothing else |
| `POST /api/v1/platform/tenants/{id}/tier` | `{tier, force}` → re-applies limits + reconciles feature rows |
| `POST /api/v1/platform/tenants/{id}/retry-provisioning` | re-drive a failed saga |
| `POST /api/v1/platform/tenants/{id}/suspend` `/reactivate` `/cancel`, `DELETE /{id}` | lifecycle |
| `GET /api/v1/platform/tenants/{id}/features` | read the flag map |
| `PATCH /api/v1/platform/tenants/{id}/features/{featureCode}` | `{enabled}` → sets the flag AND marks `is_override=true` |
| `POST /api/v1/platform/tenants/{id}/impersonate` | audited impersonation |

The editable profile is deliberately narrow. `PlatformDtos.UpdateTenantRequest` is exactly
`(brandName, billingRef, trialEndsAt, renewsAt)`, and its javadoc states the slug and tier are
excluded on purpose (slug because login resolves by it via `auth_db.auth_tenants`, tier because
it has its own endpoint).

There is **no SuperAdmin UI**. `frontend/app/(platform)/platform/dashboard/page.tsx` is nine
lines and says "SuperAdmin shell placeholder." Everything above is API-only today.

### 1.2 The feature codes — the actual enumerable list

Source of truth: `services/platform-admin-service/src/main/java/io/restaurantos/platform/config/TierFeatureDefaults.java`.
Mirrored (and guarded) by `frontend/lib/features/feature-flags.ts` and
`services/platform-admin-service/src/test/java/io/restaurantos/platform/config/FeatureCodeClosureTest.java`.

**20 codes. All 20 are individually settable per tenant** via
`PATCH /tenants/{id}/features/{code}` — including above the tenant's tier, because
`FeatureFlagAdminService.setFeature` sets `is_override=true` and
`reconcileToTierDefaults` skips override rows in both directions.

ON in every tier (`ALL_TIERS_ON`, 9 codes):

```
FEATURE_POS
FEATURE_INVENTORY
FEATURE_FINANCE
FEATURE_VENDOR
FEATURE_HR
FEATURE_PAYROLL
FEATURE_CRM
FEATURE_LOYALTY
FEATURE_KDS
```

GROWTH and above (`GROWTH_AND_ABOVE`, 9 codes):

```
FEATURE_MULTI_BRANCH
FEATURE_REPORTING_ADVANCED
FEATURE_WHATSAPP_NOTIFICATIONS
FEATURE_CUSTOM_ROLES
FEATURE_AUDIT_EXPORT
FEATURE_LOT_TRACKING
FEATURE_NLQ
FEATURE_ANALYTICS
FEATURE_ECOMMERCE
```

ENTERPRISE and above (`ENTERPRISE_AND_ABOVE`, 2 codes):

```
FEATURE_WHITE_LABEL_DOMAIN
FEATURE_CONSOLIDATED_REPORTING
```

`CUSTOM` tier gets everything (see `isEnabledByDefault`).

### 1.3 Which of those 20 are actually *enforced* at the edge

`gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java` — the only place a
disabled module becomes a 403. 14 prefix→code entries covering **9 distinct codes**:

| Prefix | Code |
|---|---|
| `/api/v1/finance/` | `FEATURE_FINANCE` |
| `/api/v1/purchasing/` | `FEATURE_VENDOR` |
| `/api/v1/hr/`, `/iclock/`, `/internal/attendance/` | `FEATURE_HR` |
| `/api/v1/crm/` | `FEATURE_CRM` |
| `/api/v1/nlq/` | `FEATURE_NLQ` |
| `/api/v1/payroll/` | `FEATURE_PAYROLL` |
| `/api/v1/analytics/` | `FEATURE_ANALYTICS` |
| `/api/v1/loyalty/` | `FEATURE_LOYALTY` |
| `/api/v1/kds/`, `/api/v1/kitchen/` | `FEATURE_KDS` |
| `/api/v1/ecommerce/` | `FEATURE_ECOMMERCE` |
| `/api/v1/inventory/` | `FEATURE_INVENTORY` |

**`FEATURE_POS` is in the tier matrix but has no route mapping.** `/api/v1/pos/` is ungated —
turning `FEATURE_POS` off today changes nothing at the gateway. Same for
`FEATURE_MULTI_BRANCH`, `FEATURE_REPORTING_ADVANCED`, `FEATURE_WHATSAPP_NOTIFICATIONS`,
`FEATURE_CUSTOM_ROLES`, `FEATURE_AUDIT_EXPORT`, `FEATURE_LOT_TRACKING`,
`FEATURE_WHITE_LABEL_DOMAIN`, `FEATURE_CONSOLIDATED_REPORTING`: 11 of the 20 codes are
sellable and toggleable but have no edge enforcement. Four of them
(`FEATURE_PAYROLL`, `FEATURE_ANALYTICS`, `FEATURE_LOYALTY`, `FEATURE_ECOMMERCE`) map to prefixes
that no service currently serves — documented in the `TierFeatureDefaults` comments.

Enforcement mechanics (`gateway/.../filter/FeatureFlagGlobalFilter.java`, order
`HIGHEST_PRECEDENCE + 20`): tenant status → feature flag → quota. Redis keys
`tenant:status:{id}`, `tenant_features:{id}:{code}`, `tenant:nlq_quota:{id}`,
`nlq_quota:{id}:monthly_count`, all 5-minute TTL. Every unknown fails **closed** (503
`TENANT_STATUS_UNAVAILABLE` / `NLQ_QUOTA_UNAVAILABLE`) unless
`restaurantos.fail-open-on-platform-down=true`. A disabled feature returns 403 `FEATURE_DISABLED`
with `X-Upgrade-CTA-URL: https://app.restaurantos.io/billing?feature={code}`.

### 1.4 The quantitative half

`services/platform-admin-service/src/main/java/io/restaurantos/platform/config/TierLimits.java`:

| Tier | maxBranches | maxUsers | storageGb | nlqQuota |
|---|---|---|---|---|
| STARTER | 1 | 10 | 5 | 1000 |
| GROWTH | 5 | 50 | 20 | 5000 |
| ENTERPRISE | 50 | 500 | 100 | 50000 |
| CUSTOM | 999 | 9999 | 999 | 999999 |

These four numbers are **not independently settable per tenant**. They are a pure function of the
tier — `TierLimits.applyTo` stamps them, and no endpoint accepts them. The spec explicitly asks
for the opposite: `Docs/RestaurantERP_SaaS_Specification.md:149` — "Set per-tenant usage limits
(branches, users, storage, NLQ queries)". Today the only way to give one tenant a different
branch cap is to move it to `CUSTOM` and accept all four CUSTOM numbers.

### 1.5 What 13-14 shipped (per `.planning/phases/13-platform-tenant-access-repair/13-14-SUMMARY.md`)

- `tenant_features.is_override` (changeset `030-001`, backfilled FALSE) and `tenants.renews_at`
  (`030-002`) — `services/platform-admin-service/src/main/resources/db/changelog/v1.0.0/030-tenant-feature-override-flag.xml`.
- `TenantSubscriptionService.changeTier`: re-applies `TierLimits`, calls
  `FeatureFlagAdminService.reconcileToTierDefaults` (skips override rows both directions),
  writes `tenant:nlq_quota:{id}` straight through.
- Downgrade refused with 409 `TIER_LIMIT_EXCEEDED` when the tenant is over the target's
  **branch** cap; `force:true` overrides. The **user** cap is not checked — auth-service exposes
  no tenant user count (SUMMARY §"Left open" #2).
- Known gap carried forward (SUMMARY §"Left open" #5): a tenant whose tier never changes still
  has no `tenant_features` rows for codes added after it was provisioned. No backfill migration
  was written.
- Deployment blocker recorded (SUMMARY §"Left open" #1): `platform_admin` role does not exist in
  `deploy/init/02-create-roles.sql`, so changeset 030 (the first ALTER on this service) needs a
  manual `GRANT platform_admin TO platform_user`.

---

## 2. Answer: which tenant-level settings are NOT configurable

I checked for a settings table or service across every service. **There is no `tenant_settings`,
`org_settings` or `tenant_config` table anywhere in the repo** (grep over all `*.sql`/`*.java`
under `services/` and `shared-lib/` returns zero hits). There is no settings-owning service.

| Setting | Status today | Evidence |
|---|---|---|
| **Currency** | **Not configurable.** `branches.currency_config` (jsonb) exists on `BranchEntity` and is settable via `POST/PATCH /api/v1/branches` — but **nothing reads it**. No service consumes `currencyConfig`. All money is `BIGINT` paisa; PKR is baked into the frontend (`Docs/…Specification.md:2697` `Intl.NumberFormat('en-PK', {currency:'PKR'})`). | `services/user-service/.../entity/BranchEntity.java:56`, `.../service/BranchService.java` |
| **Timezone** | **Branch-level, configurable; no tenant-level default.** `branches.timezone` NOT NULL default `Asia/Karachi`; read by `reporting-service` `BranchTimeZoneResolver` for business-day bucketing, with an app-property fallback `restaurantos.business-day.default-timezone`. A SuperAdmin cannot set it; a tenant admin can, per branch. | `BranchEntity.java:50`, `services/reporting-service/.../support/BranchTimeZoneResolver.java` |
| **Tax rates / tax profile** | **Not configurable as a profile.** The only tax rate in the system is `menu_items.tax_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 0` plus a free-text `tax_rate_code`, set per menu item. There is no tenant or branch tax profile, no named tax codes table, no exemption model. | `services/pos-service/src/main/resources/db/migration/V1__pos_schema.sql:38-39`, `.../dto/MenuItemAdminDtos.java`, `.../service/OrderPricingCalculator.perLineTax` |
| **Service charge** | **Not configurable and effectively dead.** `orders.service_charge_paisa BIGINT NOT NULL DEFAULT 0` exists and is summed into the order total, but **no code path ever sets it** — `grep setServiceChargePaisa` across `services/` returns nothing. It is always 0. | `V1__pos_schema.sql:156`, `.../domain/model/Order.java:68`, `.../service/OrderPricingCalculator.aggregateOrderTotals` |
| **Receipt template / branding** | **Not configurable.** `branches.receipt_config` (jsonb) exists and is settable, but no service reads it. There is no receipt renderer in any Java service. | `BranchEntity.java:60`, `BranchService.update` |
| **POS profile (combined vs separate food/bar)** | **Does not exist.** No such concept in schema, code or spec — grep for "POS profile" / food-vs-bar over `Docs/` and `.planning/` returns nothing. Closest primitive is the branch-scoped `stations` table. | `services/pos-service/src/main/resources/db/migration/V7__stations.sql` |
| **KDS/BDS routing** | **Partially configurable, tenant-admin level, no BDS.** `stations(tenant_id, branch_id, code, name, is_active)` with `menu_items.station_id` FK is the canonical routing model; free-text `menu_items.kds_station` is the retained fallback ("then `DEFAULT`"). There is **no bar/BDS distinction** — one station model serves everything. Not a SuperAdmin surface. | `V7__stations.sql` |
| **Business hours** | **Does not exist.** Zero hits for `business_hours` / `opening_hours` / `businessHours` anywhere in `services/`, `frontend/`, `shared-lib/`. `branches.opened_on` is a founding date, not hours. | grep; `BranchEntity.java:63` |
| **Fiscal year** | **Hardcoded Pakistan Jul–Jun.** `PakistanFiscalYear.forDate` is `month >= 7 ? year+1 : year`, a static util with no configuration. `accounting_periods` carries a `fiscal_year INT` and `ProvisionRequest` accepts a `fiscalYear`, but the *start month* is not a setting. | `services/finance-service/.../util/PakistanFiscalYear.java`, `.../db/migration/V1__finance_schema.sql:35` |
| **Language / locale** | **Per-user only, no tenant default.** `users.locale` is patchable via `PATCH /api/v1/users/{userId}` (`UserAdminDtos`, `@Size(max=10)`). No tenant-level locale, no i18n bundles in any service (grep for `i18n`/`MessageSource` finds nothing). Spec asks for it: `Specification.md:153` "Configure global settings: base currency options, supported locales". | `services/user-service/.../dto/UserAdminDtos.java:151`, `.../service/UserAdminService.java:94` |
| **Rounding rules** | **Not configurable — hardcoded.** `OrderPricingCalculator.perLineTax` is `RoundingMode.HALF_UP` at 10-digit scale, per line, always. No cash-rounding (nearest-rupee) step exists anywhere. | `.../service/OrderPricingCalculator.java:56-62` |

---

## 3. Is there any per-tenant branding?

**No working branding. Three disconnected fragments, none joined up.**

1. `platform_db.tenants.theme_config JSONB` and `email_config JSONB` exist
   (`010-create-platform-tables.xml:32-33`) and are mapped on `TenantEntity` as
   `themeConfig`/`emailConfig`. Grep across all of `services/`, `gateway/`, `frontend/`,
   `shared-lib/`: **the only hits are the column declaration and the field declaration.**
   Nothing reads them, nothing writes them, and `UpdateTenantRequest` has no parameter for them.
   Same for `custom_domain` and `domain_verified` — declared, never referenced.
2. `frontend/components/settings/appearance-form.tsx` renders a brand-colour picker and a
   Logo URL field, then persists to **`localStorage`**. Its own comment reads
   `// Phase 7 backend contract: PUT /api/v1/tenants/:id/theme { brandColor, logoUrl }` —
   **that endpoint does not exist**; grep for `/theme` across all Java sources returns nothing.
   `frontend/app/(tenant)/settings/appearance` is the only route under `(tenant)/settings`.
3. `brandName` is real and does round-trip: set at provisioning and via `PATCH /tenants/{id}`,
   mirrored into `auth_db` by `AuthInternalClient.registerTenant`, and read by the frontend from
   the public `GET /api/v1/auth/tenants/{slug}` (`frontend/lib/hooks/use-tenant-brand.ts` →
   `AuthController.java:47`). That hook resolves the slug from
   `NEXT_PUBLIC_DEFAULT_TENANT_SLUG`, i.e. a build-time env var, not the signed-in tenant.

So: **a tenant's name is configurable; its logo and colours are not persisted anywhere.**
`FEATURE_WHITE_LABEL_DOMAIN` is sold at ENTERPRISE and backed by nothing — no route mapping, no
`custom_domain` consumer, no gateway host resolution.

There is also no logo *storage* wiring: `file-service` exists
(`services/file-service/src/main/java/io/restaurantos/file/…`, MinIO-backed, with
`TierStorageProperties` and a `QuotaService`) but nothing references it for branding.

---

## 4. What is missing for a tenant to enable FBR tax invoicing with their own NTN

### 4.1 What exists

- `branches.ntn VARCHAR(50)` and `branches.fbr_strn VARCHAR(50)` columns on `BranchEntity`
  (`BranchEntity.java:38,41`).
- `BranchDtos.BranchResponse` returns them.
- `reporting-service` reads them for the report header:
  `FbrTaxSummaryService` calls `GET /internal/users/branches/{branchId}` and puts
  `ntn`/`fbrStrn` into `FbrTaxSummaryDto`; on failure it degrades to null with a `dataNotes`
  entry rather than failing.
- `FbrTaxSummaryService` produces output tax (from `sales_order_facts`, ClickHouse), input tax
  (from `purchase_tax_facts`), and `netPayablePaisa`, exposed at the reporting REST surface and
  rendered by `frontend/components/reporting/FbrTaxSummaryCard.tsx` /
  `frontend/app/(tenant)/app/reports/fbr/page.tsx`.
- Vendors have their own NTN (`purchasing-service` `VendorService.setNtn`) — unrelated to the
  tenant's own registration.

### 4.2 What is missing

1. **NTN and STRN cannot be set through any API.** `BranchDtos.CreateBranchRequest` and
   `UpdateBranchRequest` have **no `ntn` / `fbrStrn` fields**, and `BranchService.create` /
   `BranchService.update` never call the setters. Grep for `setFbrStrn|setNtn` across
   `services/` returns exactly one hit, and it is `purchasing-service`'s *vendor* NTN. The
   columns are therefore **write-only via direct SQL**. This is the single hardest blocker and
   the cheapest to fix.
2. **No tenant-level tax identity.** NTN/STRN are branch columns. A tenant is one legal entity
   with one NTN in the normal case; there is no tenant-level record and no inheritance.
3. **No FBR invoice numbering, QR code, or invoice document.** No POS invoice renderer exists at
   all (see receipt_config above). No `fbr_invoice_number`, no QR payload, no digital signature.
4. **No e-filing/transmission pipeline.** Stated explicitly in the code, twice:
   `FbrTaxSummaryDto` javadoc — "There is no FBR/IRIS e-filing API integration anywhere in the
   specs and NONE is built here"; the same sentence appears on `FbrTaxSummaryService`.
5. **No credential storage.** Nowhere to hold a per-tenant FBR/PRAL API token, and no secret
   handling for one.
6. **No tax-rate configuration to file against.** Rates live per menu item (§2); a tenant cannot
   declare "standard rate 18%, this category is zero-rated".

### 4.3 The external contract — UNVERIFIED

I attempted to ground the FBR API contract and **could not**:

- `https://www.fbr.gov.pk/digital-invoicing/172001` — 404 ("The Requested Page does not Exist").
- `https://dicrm.pral.com.pk/` — returned only the heading "DICRM", no content.
- `https://di.wisesolutions.pk/fbr-digital-invoicing-pakistan` — fetched successfully, but it
  explicitly declines to publish endpoints, credential formats, sandbox details or SRO numbers,
  and says "Technical readers should read FBR/PRAL documentation directly."

Secondary/vendor sources from a web search state that digital invoicing became mandatory for
sales-tax-registered persons in August 2025, that PRAL is FBR's appointed licensed integrator
(free of charge) under the Rules 33M–33V / Rule 150XF framework of the Sales Tax Act 1990, and
that invoices must carry a QR code and an FBR invoice number. **Treat all of that as unconfirmed
until someone reads the official PRAL technical documentation.** Do not design against it.

Sources fetched or listed:
- https://di.wisesolutions.pk/fbr-digital-invoicing-pakistan (fetched; declines technical detail)
- https://www.fbr.gov.pk/digital-invoicing/172001 (fetched; 404)
- https://dicrm.pral.com.pk/ (fetched; empty)
- https://difbr.pk/blog/pakistan-e-invoicing-integrator-licensing-fbr-rules-33m-v (search result, not fetched)
- https://www.pakistanstatetime.com/news/fbr-launches-free-einvoicing-integration-with-pral (search result, not fetched)

**Action required from the user:** obtain the official FBR/PRAL Digital Invoicing technical
documentation (endpoint list, auth scheme, invoice JSON schema, sandbox access). Without it, any
integration design is fabrication.

---

## 5. Concrete list of settings to add

Design principle that follows from §2: **there is no settings home today, so one has to be
chosen deliberately.** Two candidate homes exist and they answer different questions.

- **platform-admin-service / `platform_db`** — non-RLS control plane. Correct for anything the
  SuperAdmin owns and the tenant must not change (limits, entitlements, commercial terms).
  `PlatformDbIsolationIT` asserts zero RLS policies here; do not add tenant-scoped operational
  data to it.
- **user-service / `user_db`** — already owns `branches` with `timezone`, `currency_config`,
  `receipt_config`, `ntn`, `fbr_strn`, and is already RLS-scoped via `TenantAuditableEntity`.
  Correct for tenant-owned operational configuration. It already has the branch-level half; a
  tenant-level `tenant_profiles` table beside it is the smallest correct addition.

Recommended storage model for the new tenant-level settings: **one `tenant_profiles` table in
`user_db`, RLS-scoped, one row per tenant, typed columns for anything a service must read, plus
narrow jsonb only for genuinely open-ended structures (receipt template, theme).** Not an EAV
key/value table — every setting below has a known consumer, and a typed column is what makes a
missing value a compile error instead of a null at runtime.

Resolution order for anything that exists at both levels: **branch value if set, else tenant
value, else the app-property default.** That is already the shape `BranchTimeZoneResolver` uses
(branch → property default); this just inserts the tenant tier in the middle.

### 5.1 Tenant-owned operational settings — new `user_db.tenant_profiles`

Owner: **user-service**. New table, RLS `tenant_isolation` policy, `GRANT` to `user_user`,
exposed as `GET/PATCH /api/v1/tenants/me/profile` (tenant admin) and
`GET/PATCH /internal/users/tenants/{id}/profile` (platform-admin + other services).

| Setting | Column | Type | Consumer that must read it |
|---|---|---|---|
| Base currency | `base_currency` | `CHAR(3)` NOT NULL DEFAULT `'PKR'` | pos-service, finance-service, reporting-service, frontend formatting |
| Currency display (symbol, decimals, position) | `currency_display` | `jsonb` | frontend only |
| Default timezone | `default_timezone` | `VARCHAR(64)` NOT NULL DEFAULT `'Asia/Karachi'` | `BranchTimeZoneResolver` middle tier |
| Default locale | `default_locale` | `VARCHAR(10)` NOT NULL DEFAULT `'en'` | frontend, notification templates; falls back for users with null `locale` |
| Fiscal year start month | `fiscal_year_start_month` | `SMALLINT` NOT NULL DEFAULT `7` | **finance-service** — replaces the hardcoded `PakistanFiscalYear` |
| Fiscal year labelling convention | `fiscal_year_label_rule` | `VARCHAR(20)` NOT NULL DEFAULT `'END_YEAR'` | finance-service |
| Cash rounding rule | `cash_rounding` | `VARCHAR(20)` NOT NULL DEFAULT `'NONE'` (`NONE`/`NEAREST_1`/`NEAREST_5`) | pos-service payment path |
| Tax rounding mode | `tax_rounding_mode` | `VARCHAR(10)` NOT NULL DEFAULT `'HALF_UP'` | `OrderPricingCalculator` |
| Tax rounding level | `tax_rounding_level` | `VARCHAR(10)` NOT NULL DEFAULT `'LINE'` (`LINE`/`ORDER`) | `OrderPricingCalculator` |
| Prices tax-inclusive? | `prices_tax_inclusive` | `BOOLEAN` NOT NULL DEFAULT `false` | pos-service — changes the whole pricing formula |
| Tenant NTN | `ntn` | `VARCHAR(50)` | reporting-service FBR header; branch NTN overrides |
| Tenant STRN | `strn` | `VARCHAR(50)` | same |
| Legal entity name / registered address | `legal_name`, `registered_address` | `VARCHAR(255)`, `jsonb` | invoice header |
| Receipt template | `receipt_template` | `jsonb` | new receipt renderer (see 5.4) |
| Theme (brand colour, logo file id) | `theme` | `jsonb` | frontend shell + receipt renderer |

Migration note: `branches.timezone` / `currency_config` / `receipt_config` stay as the
per-branch override tier. **`branches.ntn` and `branches.fbr_strn` must additionally be added
to `CreateBranchRequest`/`UpdateBranchRequest` and wired in `BranchService` — that is a
three-line fix and unblocks FBR reporting on its own.**

### 5.2 Tax profile — new tables, owner **finance-service**

Per-item `tax_rate_pct` is not a tax profile and cannot express zero-rating, exemption, or a
rate change with an effective date.

| Table (in `finance_db`, RLS-scoped) | Columns |
|---|---|
| `tax_codes` | `id, tenant_id, code, name, rate_pct NUMERIC(5,2), kind (STANDARD/ZERO_RATED/EXEMPT/FURTHER_TAX), effective_from DATE, effective_to DATE, is_active` |
| `tax_profiles` | `id, tenant_id, name, default_sales_tax_code_id, default_purchase_tax_code_id, is_default` |

`pos-service.menu_items.tax_rate_code` (already a free-text column) becomes an FK-by-code into
`tax_codes`, resolved at order time. `menu_items.tax_rate_pct` stays as the resolved snapshot so
historical orders are not re-priced. Exposed as `/api/v1/finance/tax-codes` CRUD.

### 5.3 Service charge — owner **pos-service**

`orders.service_charge_paisa` is already summed into the total and is always zero. Add to the
tenant profile (or a pos-owned `pos_settings` row if you want branch granularity):

| Setting | Type |
|---|---|
| `service_charge_pct` | `NUMERIC(5,2)` default 0 |
| `service_charge_applies_to` | `VARCHAR(20)` (`NONE`/`DINE_IN`/`ALL`) |
| `service_charge_taxable` | `BOOLEAN` |

Then wire `OrderPricingCalculator.aggregateOrderTotals`'s `serviceChargePaisa` argument to a
computed value instead of the constant 0 it receives today. **Run `impact` on
`aggregateOrderTotals` before touching it** — `OrderServiceImpl:1013` recomputes the same total
independently, so both call sites move together or the totals diverge.

### 5.4 Receipt template and branding — owner **user-service** (config) + a renderer

`receipt_config` and `theme` jsonb hold the config; nothing renders it. Needed:

- A receipt renderer. There is no natural home — the least-bad option is **pos-service**, which
  already owns orders, payments and tills, exposing `GET /api/v1/pos/orders/{id}/receipt`.
- Logo storage: **file-service** already exists (MinIO, `FileStorageService`, `QuotaService`,
  `TierStorageProperties`). Store a file id in `theme.logoFileId`; do not store a URL.
- Delete or rewire `frontend/components/settings/appearance-form.tsx`'s `localStorage` stub and
  the `use-tenant-brand.ts` env-var slug lookup, which resolves the *build's* tenant, not the
  signed-in one.

### 5.5 Business hours — owner **user-service**, on `branches`

No consumer exists yet, so this is only worth adding when something needs it (business-day
cutover, scheduled reports, HR shift validation). Model as `branches.business_hours jsonb`:
seven day entries of `{open, close, closed}` plus a `dayCutoverTime` for the business-day
boundary — the last is the one `reporting-service`'s `BusinessDay` would actually use, and today
it has only a timezone.

### 5.6 Per-tenant limit overrides — owner **platform-admin-service**

The spec requires it (`Specification.md:149`) and the tier table forbids it. Smallest change
that preserves 13-14's design: add four nullable override columns to `platform_db.tenants` —
`max_branches_override`, `max_users_override`, `storage_gb_override`, `nlq_quota_override` —
and have `TierLimits.applyTo` skip a field whose override is non-null. This is the exact same
shape as `tenant_features.is_override`: a null means "tier-derived", a value means "a SuperAdmin
said so", and a tier change must not clear it. Extend `UpdateTenantRequest` with the four
fields. `TenantSubscriptionService.changeTier` must then write `tenant:nlq_quota:{id}` from the
effective value, not the tier value.

### 5.7 Gateway enforcement gaps to close alongside

- Add `/api/v1/pos/` → `FEATURE_POS` to `RouteFeatureMap` (currently the flagship module is
  ungated). Note this makes a previously-free route gate-able — verify every tenant has the row
  first, given SUMMARY §"Left open" #5.
- Write the backfill migration for §"Left open" #5 (insert missing `tenant_features` rows at
  tier default for every existing tenant) — without it, adding any new code silently 403s every
  tenant whose tier never changes.
- The nine tier-only codes with no route (`FEATURE_MULTI_BRANCH`, `FEATURE_REPORTING_ADVANCED`,
  `FEATURE_WHATSAPP_NOTIFICATIONS`, `FEATURE_CUSTOM_ROLES`, `FEATURE_AUDIT_EXPORT`,
  `FEATURE_LOT_TRACKING`, `FEATURE_WHITE_LABEL_DOMAIN`, `FEATURE_CONSOLIDATED_REPORTING`) are
  cross-cutting capabilities, not path prefixes. They need enforcement inside the owning service
  via the existing `@RequiresFeature` aspect (shared-lib `RedisFeatureFlagService`, key shape
  `feature:{tenantId}:{code}`, already written by `FeatureFlagAdminService`), not a route entry.

### 5.8 FBR digital invoicing — owner **a new fbr-service**, gated but not designed

Blocked on the official technical documentation (§4.3). What can be built now without it:

1. NTN/STRN write path on branches and on the tenant profile (§5.1). **Do this first — it is
   independent of the FBR API and unblocks the report that already exists.**
2. Tax codes (§5.2), so the filing has correctly-classified lines.
3. Invoice numbering and a rendered invoice document (§5.4).

Everything past that — credential storage, endpoint calls, QR payload, signature — waits on the
documentation. A new `fbr-service` behind a new `FEATURE_FBR_INVOICING` code (added to
`TierFeatureDefaults` *and* `RouteFeatureMap` together, or `FeatureCodeClosureTest` fails the
build) is the right shape, but do not scaffold its API surface against guessed schemas.

---

## 6. Suggested order

1. **Branch NTN/STRN write path** — 3 lines in `BranchDtos` + `BranchService`, unblocks the
   shipped FBR report. Zero risk.
2. **`tenant_features` backfill migration** — closes a known live gap (SUMMARY §5).
3. **`tenant_profiles` table + tenant-settings API** (§5.1) — the foundation everything else
   reads.
4. **Fiscal year start month** wired into finance-service, replacing `PakistanFiscalYear`.
5. **Tax codes / tax profile** (§5.2) then **service charge** (§5.3).
6. **Per-tenant limit overrides** (§5.6) — self-contained in platform-admin.
7. **Receipt renderer + branding** (§5.4) — biggest new surface.
8. **FBR integration** — only after the official docs are in hand.

Per `CLAUDE.md`: run `impact({target, direction:"upstream"})` before editing
`OrderPricingCalculator.aggregateOrderTotals`, `TierLimits.applyTo`,
`FeatureFlagAdminService.reconcileToTierDefaults` and `BranchService.update`, and
`detect_changes()` before committing. The GitNexus index is stale as of `5fba4a9`.
