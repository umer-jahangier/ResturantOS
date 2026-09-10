# Superadmin Control Plane — Capability Map

**Scope:** what the SUPERADMIN control plane can honestly support today, established from source.
**Method:** read-only survey of `services/platform-admin-service`, `services/auth-service`,
`services/audit-service`, `services/reporting-service`, `gateway/`, `shared-lib/`, `deploy/`.
Nothing was executed; no schema was changed.
**Governing rule:** D-38-16 — a figure the system cannot compute renders as a stated absence, never
as a number. This document exists so that rule can be applied *before* a tile is designed, not after
it ships with a fabricated value.

All paths are relative to `/Users/muhammadumer/Documents/Projects/ResturantOS-ui38`.

---

## 0. The one-paragraph answer

The platform plane owns **tenant identity, entitlement and operator action**. It owns **no money at
all**. There is no plan-price, no invoice, no payment, no payment-processor integration and no
subscription record anywhere in this codebase — `tenants.billing_ref` is a free-text string
pointing at a billing system that does not exist here. Any "MRR", "ARR", "revenue", "churn value",
"ARPU", "failed payments" or "invoices" module on a Superadmin dashboard would be **invented data**.
Conversely, tenant lifecycle, tier/entitlement, feature flags, impersonation, cross-tenant tenant
counts and fleet health are all real and mostly already exposed. Users, roles, permissions and audit
are real but live behind RLS in *other* services' databases, reachable only via internal HTTP —
buildable, but as integration work, not as a query.

---

## 1. The tenant model

### 1.1 What a tenant is

`services/platform-admin-service/src/main/java/io/restaurantos/platform/entity/TenantEntity.java`

| Column | Line | Notes |
|---|---|---|
| `id` (UUID PK) | :24-25 | |
| `slug` (unique, 100) | :27-28 | **Not editable** — login resolves by slug; nothing propagates a rename to auth-service (`TenantSubscriptionService.java:110-116`) |
| `brand_name` | :30-31 | |
| `status` enum | :33-35, :92-94 | |
| `tier` enum | :37-39, :96-98 | |
| `theme_config` / `email_config` jsonb | :41-47 | |
| `billing_ref` (varchar 255) | :49-50 | **free text, no FK, no schema** |
| `trial_ends_at` | :52-53 | timestamp only |
| `renews_at` | :62-63 | added by 13-14, changeset 030-002 |
| `custom_domain`, `domain_verified` | :65-69 | |
| `max_branches`, `max_users`, `storage_gb`, `nlq_quota` | :71-81 | tier ceilings, stamped by `TierLimits` |
| `created_at`, `suspended_at`, `cancelled_at` | :83-90 | |

**Statuses** (`TenantEntity.java:92-94`):
`PENDING_SETUP · ACTIVE · SUSPENDED · CANCELLED · PURGED · PROVISIONING_FAILED`

**Tiers** (`TenantEntity.java:96-98`): `STARTER · GROWTH · ENTERPRISE · CUSTOM`

**Provisioning states** are expressed *through* status, not a separate column
(`ProvisioningService.java:185,271,297,369,382`):
`PENDING_SETUP` on create → `ACTIVE` on saga success → `PROVISIONING_FAILED` on saga failure →
`retry-provisioning` resets to `PENDING_SETUP`. Lifecycle transitions and their guards live in
`TenantLifecycleService.java:23-30,157-184`; `closePermanently` sets `PURGED` and **deletes nothing**.

### 1.2 Where subscription/tier data lives

`platform_db.tenants`, and nowhere else. The tier has two halves, deliberately split:

- **Quantitative** — `config/TierLimits.java:37-44`. Hardcoded table:
  `STARTER (1,10,5,1000) · GROWTH (5,50,20,5000) · ENTERPRISE (50,500,100,50000) · CUSTOM (999,9999,999,999999)`
  as `(maxBranches, maxUsers, storageGb, nlqQuota)`.
- **Qualitative** — `config/TierFeatureDefaults.java:31-82`. ~20 `FEATURE_*` codes across
  `ALL_TIERS_ON` (POS, INVENTORY, FINANCE, VENDOR, HR, PAYROLL, CRM, LOYALTY, KDS),
  `GROWTH_AND_ABOVE` (MULTI_BRANCH, REPORTING_ADVANCED, WHATSAPP_NOTIFICATIONS, CUSTOM_ROLES,
  AUDIT_EXPORT, LOT_TRACKING, NLQ, ANALYTICS, ECOMMERCE) and
  `ENTERPRISE_AND_ABOVE` (WHITE_LABEL_DOMAIN, CONSOLIDATED_REPORTING).

Per-tenant overrides live in `platform_db.tenant_features` (`entity/TenantFeatureEntity.java`),
with `is_override` (:48-49) marking a deliberate SuperAdmin toggle so tier reconciliation does not
revoke it.

### 1.3 Billing — the plain answer

**There is no billing, payment, plan-price, invoice, or trial entity in this codebase.**

Evidence:

- Every `@Table(name=…)` across all 16 services was enumerated. The only invoice/payment/AR tables
  are **tenant-level restaurant finance** — `vendor_invoices`, `vendor_invoice_lines`, `ap_payments`,
  `ap_payment_allocations`, `ar_transactions`, `expenses`, `journal_entries` — i.e. the restaurant
  paying its food suppliers. None of them describe a tenant paying *us*.
- A repo-wide grep for `stripe|paddle|chargebee|razorpay|braintree|mrr|arr|plan_price|subscription_plan`
  across `services/`, `deploy/`, `shared-lib/` returns **five hits, all of them the string
  `billing_ref` or `renews_at` in the three files listed above**. There is no payment-processor
  client, no webhook handler, no price table, no currency field on any platform table.
- `TenantSubscriptionService.java:36-37` states it directly: "Three columns on the tenant row —
  `billing_ref`, `trial_ends_at`, and (once 13-14 added it) `renews_at` — were likewise never read
  or written by anything." 13-14 made them writable (`update()`, :117-142). They remain **operator
  free-text and operator-entered dates**, not derived facts.
- `platform_db` tables in total (`010-create-platform-tables.xml`, `020-shared-infra-tables.xml`):
  `tenants`, `tenant_features`, `platform_users`, `usage_records`, `impersonation_log`,
  `event_outbox`, `idempotency_keys`, `processed_events`. That is the whole control plane.

**Consequence:** every revenue metric is fiction unless new entities are created AND a price is
attached to a tier AND something records a payment. Nothing in the product does any of the three.
Note also **money is BIGINT paisa** everywhere it exists (`sales_order_facts.total_paisa Int64`,
`deploy/clickhouse/V001__analytics_facts.sql:49-53`) — any future billing entity must follow that,
never a float.

---

## 2. The user model across tenants

### 2.1 Where users live

`auth_db.users` — `services/auth-service/src/main/resources/db/changelog/v1.0.0/020-create-users.xml`.
Columns include `tenant_id`, `email`, `password_hash`, `full_name`, `locale`, `totp_secret`,
`totp_enabled`, `is_active`, `failed_login_count`, `locked_until`, **`last_login_at`**, `created_at`,
`deleted_at`, plus `must_change_password` (changeset 080).

`users` is under **FORCE ROW LEVEL SECURITY** on `app.current_tenant_id` like every tenant table.
`auth_user` is `NOSUPERUSER NOBYPASSRLS` (`deploy/init/02-create-roles.sql:17`).

### 2.2 Can the platform plane enumerate users of all tenants?

**Not directly, and not today — but the path exists, one tenant at a time.**

- `platform_db` and `auth_db` are separate databases. Changeset
  `platform-admin-service/.../040-platform-db-rls-posture.xml` records this *measured*: platform
  roles hold **zero grants in all 14 tenant databases**, `platform_db` has **only `plpgsql`
  installed — no `postgres_fdw`, no `dblink`**, so there is no SQL bridge at all.
- The only door is HTTP: `auth-service`'s
  `controller/UserLifecycleInternalController.java` (`@RequestMapping("/internal/auth/users")`):
  - `GET /internal/auth/users` (:130) — **one page of ONE tenant's users**, bounded by a required
    `X-Tenant-Id` header, paginated with `meta.totalCount`, capped page size, fixed `(email, id)` sort.
  - `GET /internal/auth/users/{userId}` (:148), `POST` create (:161), `PATCH` (:179),
    `POST /{id}/deactivate` (:191), `POST /{id}/reactivate` (:202).
  - Writes additionally require `X-Acting-User-Id` and are bounded by the **role ceiling**
    recomputed from the DB (:40-105). Reads are exempt — `X-Tenant-Id` alone bounds them.
  - Gated by `InternalServiceFilter`'s constant-time shared secret; the gateway maps **no route** to
    `/internal/**` (asserted 404 by 13-06), and `StripInternalHeaderFilter` deletes
    `X-Internal-Service` / `X-Acting-User-Id` from every inbound request at the edge.
- **platform-admin-service does not call any of these today.** Its `UserInternalClient`
  (`client/UserInternalClient.java`) has exactly three methods: `createBranch`, `deactivateBranch`,
  and `listBranches` (:62-63). There is **no user client at all**; the only auth call touching users
  is the password reset.
- The gap is named twice in the source rather than hidden:
  `TenantSubscriptionService.java:209-224` — "There is no equivalent for users: the `users` table
  lives in auth_db and auth-service exposes no tenant user count on any internal channel", so a
  downgrade below the user cap is applied **without a refusal**;
  `UsageService.java:165-166` — the `users` meter is emitted as `notMetered` with that reason as its
  text.

  *(Note the wording in those comments predates `UserLifecycleInternalController`, which does now
  return `meta.totalCount` for a tenant. A per-tenant headcount IS obtainable today by calling
  `GET /internal/auth/users?page=0&size=1` per tenant and reading the total. A **fleet-wide** count
  is N calls, not one query — real, but O(tenants).)*

### 2.3 What `reset-password` already does

`POST /api/v1/platform/tenants/{tenantId}/users/{userId}/reset-password` with body `{"reason": "…"}`.

- Controller: `controller/PlatformUserAdminController.java:90-98`, class-level
  `@PreAuthorize("hasAuthority('SUPER_ADMIN')")` (:62).
- The acting administrator is read from the **verified token's `sub`** (`requirePlatformPrincipal()`,
  :118-127) — never a body field, never a header. No resolvable principal ⇒ refusal, not a default.
- Service: `service/PlatformUserAdminService.java:74-87`. Resolves the tenant locally first (404 on
  unknown), logs at INFO **without** the credential, then delegates.
- Delegate: `AuthInternalClient.resetUserPassword` (`client/AuthInternalClient.java:119-123`) with
  `X-Tenant-Id`, `X-Acting-User-Id`, and body `{actorTier:"PLATFORM", reason}`. `actorTier=PLATFORM`
  is the constant that **exempts the call from the tenant role ceiling** — a platform id holds no
  `user_branch_roles`, so the ceiling would otherwise resolve the empty set and refuse every reset.
- Returns `{userId, email, tempPassword, mustChangePassword}` **once**. `tempPassword` is never
  logged, never persisted, never evented, and deliberately **not** covered by an idempotency key
  (`PlatformUserAdminController.java:79-88`) because `idempotency_keys.response_json` is plain text
  that nothing purges.
- auth-service emits `ADMIN_PASSWORD_RESET` into the tenant's own outbox → audit_events.
- The capability is documented as accepted risk T-13-13-F: *a SuperAdmin can take over any account
  in any tenant* (`PlatformUserAdminService.java:28-42`).

---

## 3. Roles and permissions

### 3.1 Where they are defined

All in `auth_db`, seeded by Liquibase in
`services/auth-service/src/main/resources/db/changelog/v1.0.0/`:

- **`permissions`** — created `030-create-roles-permissions.xml:9-19`. **Global, NON-RLS catalogue**
  (`code` PK, `module`, `description`). `auth_user` has SELECT only.
- **`roles`** — created `030-…:21-34`. Nullable `tenant_id` (NULL = system role), `code`, `name`,
  `is_system`. **FORCE RLS** since `030-…:36-51` with predicate
  `tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id')`.
- **`role_permissions`** — created `030-…:54-65`. Was `(role_code, permission_code)` with **no tenant
  column**; `092-tenant-custom-roles.xml` added nullable `tenant_id`, replaced the PK with a unique
  index over `COALESCE(tenant_id, nil-uuid)`, and applied the **identical FORCE RLS policy** (:23-86).
  Rationale recorded in that file: without it, two tenants defining the same role code merged their
  grants — a cross-tenant privilege leak.

### 3.2 The nine system roles

Seven in `030-create-roles-permissions.xml:107-116` — `OWNER`, `TENANT_ADMIN`, `MANAGER`,
`ACCOUNTANT`, `INVENTORY_MANAGER`, `CASHIER`, `FINANCE_VIEWER` — plus
`KITCHEN_STAFF` (`042-kds-permissions-kitchen-role.xml:23`) and
`WAITER` (`055-waiter-role-and-tenant-admin-authority.xml:90-93`). All have `tenant_id IS NULL`
and `is_system = true`, so they are **global and visible to every tenant**.

Grants: `OWNER` = every permission; `TENANT_ADMIN` = every permission except `rbac.manage`
(`030-…:118-127`); the rest are explicit lists. `082-file-permissions-and-finance-viewer-role.xml`
and `057-repair-administration-role-grant-drift.xml` are repair changesets that guard against
`role_permissions` rows referencing a role that does not exist — a class of bug that has taken
auth-service's migration (and therefore the whole fleet) down before.

### 3.3 The permission catalogue

**80 distinct permission codes** were extracted from the changelogs (the "79" figure in the brief is
within one of what the changelogs declare; the exact number should be read from the DB, not from a
grep, because several changesets are repairs). Modules present:
`audit · branch · crm · file · finance · hr · inventory · nlq · ops · pos · rbac · reporting · vendor`.
Full extracted list is reproducible with:

```
grep -rhoE "\('[a-z][a-z0-9_]*\.[a-z0-9_.]+'|value=\"[a-z][a-z0-9_]*\.[a-z0-9_.]+\"" \
  services/auth-service/src/main/resources/db/changelog/v1.0.0/ | sort -u
```

The catalogue is protected by `PermissionCatalogClosureTest`, which scans `@PreAuthorize`
expressions and named constants across the repo and **fails the build** on any dotted code the
changelog does not declare (`RoleCatalogController.java:48-51`). A gate naming an undeclared code
produces a clean 403 for every user including OWNER — the highest-recurrence defect in this repo.

### 3.4 Can the platform plane read/modify them?

**No, not today, and there is a hard blocker in the way.**

- Read: `GET /api/v1/roles` and `GET /api/v1/permissions` (`RoleCatalogController.java:80-101`),
  gated `hasAnyAuthority('rbac.manage','rbac.user.manage')`.
- Write: `POST/PUT/DELETE /api/v1/roles` (`RoleAdminController.java:70-105`), gated
  `hasAnyAuthority('rbac.manage','rbac.role.manage')`, and additionally bounded by
  `RoleAdminService`'s ceiling recomputed against the acting user.
- **A platform token cannot pass either gate.** `JwtSigningService.signPlatformToken`
  (`services/auth-service/.../service/JwtSigningService.java:96-117`) mints
  `roles=[SUPER_ADMIN]`, `permissions=[SUPER_ADMIN]`, `token_type=PLATFORM`, **and no `tenant_id`
  claim at all**. Authorities are built from the `permissions` claim alone, so a SuperAdmin holds
  exactly one authority: `SUPER_ADMIN`. It matches no `rbac.*` gate, and the tenant-scoped reads
  would have no tenant to scope to.
- Both `roles` and `role_permissions` are FORCE RLS on a GUC the platform plane cannot populate.

So platform-plane role administration requires **new internal endpoints in auth-service** carrying
`X-Tenant-Id` (the same shape `UserLifecycleInternalController` already uses), plus a Feign client
in platform-admin-service. It is not a query and it is not a gate change.

---

## 4. Audit

### 4.1 What is captured

`audit_db.audit_events` — `services/audit-service/src/main/java/io/restaurantos/audit/entity/AuditEventEntity.java`:
`id`, `occurred_at` (composite PK), `tenant_id`, `branch_id`, `user_id`, **`impersonated_by`**
(:52-61), `action`, `resource_type`, `resource_id`, `before_state`/`after_state`/`metadata` (jsonb),
`ip_address`, `user_agent`.

- **Append-only at three layers**: `audit_writer` has INSERT only, a Postgres trigger raises on
  UPDATE/DELETE (`011-audit-immutability-trigger.xml`), and there is no write surface in the
  service (`AuditQueryController.java:89-93`).
- **Partitioned** by `occurred_at` range (`012-audit-partitioning.xml`); `AuditArchivalService`
  DETACHes rather than drops, keeping up to 84 months.
- Ingested by `AllEventsConsumer` from `audit.all-events.queue`, which
  `deploy/init/rabbitmq-definitions.template.json` binds with routing key `#` to **all topic
  exchanges including `platform.topic`**.
- The allow-list lives in `shared-lib/.../event/AuditEventCatalog.java` and is build-enforced by
  `AuditAllowListClosureTest` against actual publishers.

**`MUST_AUDIT` includes (`AuditEventCatalog.java:52-113`):**
`USER_LOGIN_SUCCEEDED`, `USER_LOGIN_FAILED`, `PASSWORD_CHANGED`, `PASSWORD_RESET_REQUESTED`,
`ADMIN_PASSWORD_RESET`, `USER_CREATED`, `USER_UPDATED`, `USER_DEACTIVATED`, `USER_REACTIVATED`,
`ROLE_GRANTED`, `ROLE_REVOKED`, `TENANT_PROVISIONED`, `IMPERSONATION_STARTED`, `ORDER_VOIDED`,
`ORDER_REFUNDED`, `ORDER_DISCOUNT_APPLIED`, `ORDER_DISCOUNT_REMOVED`, `TILL_OPENED`, `TILL_CLOSED`,
`TILL_REVIEWED`, `KDS_STALE_TICKETS_CLEARED`, `PERIOD_CLOSED`, `JOURNAL_POSTED`, `PO_APPROVED`,
`PO_CLOSED`, `AP_PAYMENT_PROCESSED`, `VENDOR_INVOICE_MATCHED`, `PAYROLL_RUN_APPROVED`,
`PAYROLL_RUN_PAID`.
`ALWAYS_AUDIT_SOURCES = {auth-service, platform-admin-service}` — **every** event from those two is
audited regardless of type.

### 4.2 Does login history exist?

**Yes, two independent sources:**

1. `audit_events` rows with `action IN ('USER_LOGIN_SUCCEEDED','USER_LOGIN_FAILED')`, carrying
   `user_id`, `tenant_id`, `branch_id`, `ip_address`, `user_agent`, `occurred_at`. This is a real
   login history with attempt-level granularity.
2. `auth_db.users.last_login_at`, `failed_login_count`, `locked_until` (020-create-users.xml) —
   current-state only, surfaced through `GET /internal/auth/users/{id}`.

**Platform-user login history does NOT exist.** `platform_users` (`entity/PlatformUserEntity.java`)
has `id, email, password_hash, role, is_active, created_at` and nothing else — no `last_login_at`,
no TOTP column (`JwtSigningService.java:109-112` records the TOTP gap explicitly). Platform logins
*do* reach audit via `ALWAYS_AUDIT_SOURCES`, but keyed by `tenant_id` — and a platform login has no
tenant, so where those rows land needs verification before a "SuperAdmin login history" tile is
promised.

### 4.3 Can the platform plane read audit across tenants?

**No — and the internal endpoint that looks like it can is very likely inert. This needs a live
check before anyone builds on it.**

- `audit_events` and **every partition individually** are `ENABLE` + `FORCE ROW LEVEL SECURITY`
  (`030-audit-events-rls.xml`). That changeset documents, with measurements, that a parent-only
  policy does not cover queries naming a partition directly and is not inherited by future
  partitions — hence per-partition policies plus a trigger for new ones.
- `audit_writer` is `NOSUPERUSER NOBYPASSRLS` (`deploy/init/02-create-roles.sql:37`).
- `AuditQueryController` (`/api/v1/audit/events`) takes the tenant **from `TenantContext`** and
  declares **no tenant parameter at all** (:40-52). Gated `hasAuthority('audit.log.view')` (:152).
  A **platform token holds only `SUPER_ADMIN`, so it is refused here**, and it carries no
  `tenant_id` for `TenantAwareDataSource` to set — so the GUC would be `''` and the query would
  match zero rows even if the gate passed.
- `AuditInternalController` (`/internal/audit/events?tenantId=…`, :38-59) takes the tenant as a
  query parameter and filters in JPA — but **nothing on that path populates `TenantContext`**.
  `grep -rn "TenantContext|X-Tenant-Id" services/audit-service/src/main/java` shows the context is
  set only by `AllEventsConsumer` (via `TenantAwareMessageProcessor`) and read only by
  `AuditQueryController`. With `TenantAwareDataSource` writing `app.current_tenant_id = ''` on
  checkout and FORCE RLS on the table, **this endpoint should return an empty list for every
  tenant**. No integration test covers it (`grep -rl "internal/audit" src/test/java` → nothing).
  Treat `/internal/audit/events` as **unverified/probably broken**, not as an available data source.

**Verdict:** cross-tenant audit is a *schema-and-integration* job, not a read. It needs a
platform-tier internal read on audit-service that sets the GUC per tenant (or a deliberate,
carefully-owned bypass role — note the brief's warning: a SECURITY DEFINER function owned by the
wrong role is exactly the bug that took the auth service down).

### 4.4 What the platform plane DOES have as its own trail

`platform_db.impersonation_log` (`entity/ImpersonationLogEntity.java`) — `platform_user_id`,
`tenant_id`, `target_user_id`, `started_at`, `ended_at`, `expires_at`, `reason`. Not RLS-scoped
(see §6.1). Already exposed:
- `GET /api/v1/platform/impersonations` (all tenants, `PlatformAdminController.java:380`)
- `GET /api/v1/platform/tenants/{id}/impersonations` (:355)
Repository supports date-range + tenant + admin filters with paging
(`repository/ImpersonationLogRepository.java:57-75`). `ImpersonationRecord`
(`dto/PlatformDtos.java:432-444`) resolves tenant slug/brand and admin email but **deliberately does
not resolve `targetUserId` to a name** — platform_db cannot reach user_db, and the honest answer is
the id (:425-431).

---

## 5. Usage and analytics

### 5.1 What `GET /api/v1/platform/tenants/{id}/usage` returns

`PlatformAdminController.java:298-300` → `service/UsageService.meters()` (:159-181) →
`PlatformDtos.TenantUsageResponse` (:342) of `UsageMeter` (:310-333).

`UsageMeter` has **three distinct states**, and this is the single most important honest-data
precedent in the codebase (`PlatformDtos.java:289-309`, `UsageService.java:126-158`):

| State | Meaning |
|---|---|
| `counted(used, limit, source)` | really measured; `used=0` means zero happened |
| `notMetered(limit, why)` | **nobody is counting** — must not render as 0 |
| `unreadable(limit, why)` | the source did not answer — must not render as 0 |

Today, for every tenant:

| Meter | State | Source |
|---|---|---|
| `branches` | **counted** (or `unreadable`) | live `GET /internal/users/tenants/{id}/branches` — the same call `TenantSubscriptionService.usageViolations` trusts to refuse a downgrade |
| `users` | **notMetered** | "auth-service exposes no per-tenant user count" (see §2.2 — this is now *stale*; a count is obtainable) |
| `storage_gb` | **notMetered** | "no producer records storage usage — file-service emits no usage events" |
| `nlq_queries` | **notMetered** (or counted) | Redis `nlq_quota:{tenantId}:monthly_count`, written by nlq-service. **Absent key ≠ zero.** |
| any resource with rows in `usage_records` | counted | summed `qty`, not row count |

`usage_records` measured at **0 rows and 0 producers** (`UsageService.java:27-42`). The one internal
writer, `POST /internal/platform/tenants/{id}/usage`, has no callers anywhere in the repo.

### 5.2 What is in ClickHouse

`deploy/clickhouse/` — database `clickhouse_analytics`:

| Table | File:line | Grain |
|---|---|---|
| `sales_order_facts` | `V001__analytics_facts.sql:40` | one closed order; `subtotal/discount/service_charge/tax/total_paisa Int64`, `business_date`, `branch_id`, `cashier_id`, `till_session_id` |
| `sales_item_facts` | `V001:66` | one order line; `qty`, `unit_price_paisa`, `line_total_paisa`, `cogs_paisa`, `gross_margin_paisa`, `category_name` |
| `purchase_tax_facts` | `V001:103` | one matched vendor invoice; `input_tax_paisa`, `total_paisa`, `match_status` |
| `till_session_facts` | `V001:126` | one closed till; `expected/counted/variance_cash_paisa` |
| `sales_discount_facts` | `V004__discount_facts.sql:20` | discount events (+`V005` source column) |

Every table carries `tenant_id` as an **ordinary column** — ClickHouse has no RLS. A cross-tenant
`GROUP BY tenant_id` is therefore trivially possible **at the SQL level**.

**But the platform plane cannot reach it today.** `platform-admin-service/pom.xml` has no ClickHouse
driver — only `reporting-service` and `nlq-service` do. And `reporting-service` exposes only
tenant-scoped, JWT-gated endpoints: `GET /api/v1/reporting/dashboard/{branchId}/tiles`,
`GET /api/v1/reporting/reports`, `POST /api/v1/reporting/reports/{code}/run`,
`GET /api/v1/reporting/reports/fbr-tax-summary`. There is **no internal cross-tenant reporting
endpoint**.

**⚠️ ClickHouse is boot-critical.** `reporting-service/.../config/ClickHouseSchemaGuard.java:24-25`
refuses to finish `@PostConstruct` unless `sales_order_facts`, `sales_item_facts`,
`purchase_tax_facts`, `till_session_facts` all exist. Any new/changed ClickHouse migration can take
the whole deploy down, must go in `deploy/clickhouse/`, and requires `deploy/k8s/generate.sh` to be
re-run **by someone else** (do not run it as part of this work).

**Honest platform analytics options, in ascending cost:**
1. Nothing new — no cross-tenant analytics. (today)
2. Add a ClickHouse read dependency + a read-only user to platform-admin-service and query the
   existing five fact tables grouped by `tenant_id`. **No new fact table, no migration, no boot
   risk.** This is the recommended path.
3. A new ClickHouse fact table — only if a genuinely new grain is needed. Highest risk; avoid.

---

## 6. System health

### 6.1 `platform_db` posture (read this before designing any "isolation" tile)

`services/platform-admin-service/src/main/resources/db/changelog/v1.0.0/040-platform-db-rls-posture.xml`
is a decision record, not a migration of substance. RLS is **deliberately OFF** on all platform
tables. The reasoning, measured live:

- A platform token has **no `tenant_id` claim**, so `TenantAwareDataSource` writes
  `app.current_tenant_id = ''`, the fleet-standard predicate maps that to NULL and fails **closed**.
  Applying the standard policy was measured to take a probe table from 2 rows to **0**, and writes to
  `ERROR: new row violates row-level security policy`. In production terms: the feature-flag console
  goes blank and every PATCH raises 42501.
- Isolation is **by database and by role** instead, and both halves were executed, not assumed:
  `SET ROLE pos_user; SELECT count(*) FROM tenants;` → permission denied; platform roles hold
  **0 grants across all 14 tenant databases**; `platform_db` has only `plpgsql` — no FDW, no dblink.
- **Do not "fix" this by enabling RLS.** `PlatformDbIsolationIT` asserts the absence as a negative
  control.

### 6.2 Actuator / Eureka

- Every service exposes `management.endpoints.web.exposure.include: health,prometheus`;
  platform-admin-service adds `info` (`application.yml:61-68`, `show-details: always`).
- `/actuator/health/**` and `/actuator/prometheus` are `permitAll()` in
  `config/PlatformSecurityConfig.java:114`.
- Eureka: every service registers (`application.yml:52-59`); there is a standalone `eureka-server/`
  module.

### 6.3 The real fleet-health surface

**`GET /api/v1/ops/health`, served by the gateway itself** —
`gateway/src/main/java/io/restaurantos/gateway/ops/FleetHealthController.java:53`.

- Shape: `{data:{checkedAt, services:[{name, paths, state, detail, lastReachableAt, instanceCount}]}}`
  (:25-31). `checkedAt` is null until the first sweep and the screen says so rather than drawing an
  unmeasured fleet.
- Service list is derived from the gateway's **own route table**, not a hand-kept constant
  (`FleetCatalogue.java:14-33`) — a service the gateway does not route to carries no user traffic.
  This is why `notification-service` (an empty POM module with no source and no route) correctly
  does not appear.
- `FleetHealthMonitor` polls on a loop and reports **actual reachability**, deliberately not
  `eureka instance.getStatus()` (:31) — a registry entry is not evidence a process answers.
- **Gate: `ops.health.view`** (`OpsTokenAuthorizer.java:53`), defined in auth changeset
  `089-ops-health-view-permission.xml` and granted to OWNER and TENANT_ADMIN. Fail-closed on every
  failure path (:34-39).

**A platform SuperAdmin token cannot read it.** It carries `permissions=[SUPER_ADMIN]` only, so
`OpsTokenAuthorizer` returns `FORBIDDEN`. A platform "system status" page needs `OpsTokenAuthorizer`
extended to accept `SUPER_ADMIN` (or a platform-tier sibling endpoint) — a small, well-bounded change
in one file, not new data.

### 6.4 What a true "system status" page could show today

- Per-service UP/DOWN/last-reachable/instance-count for every routed service (from `/api/v1/ops/health`).
- Tenant counts by `status` and by `tier` (`platform_db.tenants`, cross-tenant by design).
- Prometheus scrape targets exist on every service.
- **Not available without new work:** queue depth / DLQ depth (no RabbitMQ management client in any
  service), DB connection-pool stats across the fleet, ClickHouse ingest lag, per-tenant error rates.

---

## 7. Events

### 7.1 What platform-admin-service publishes

Two, both through the transactional outbox (`platform_db.event_outbox`):

| Event | Exchange | Routing key | Site |
|---|---|---|---|
| `TENANT_PROVISIONED` | `platform.topic` | `platform.tenant.provisioned` | `ProvisioningService.java:72-74, 280` |
| `IMPERSONATION_STARTED` | `platform.topic` | `platform.impersonation.started` | `ImpersonationService.java:114-121` |

Both are in `AuditEventCatalog.MUST_AUDIT`, and `platform-admin-service` is in
`ALWAYS_AUDIT_SOURCES`, so anything it publishes is audited.

### 7.2 What it consumes

**Nothing.** `grep -rn "RabbitListener" services/platform-admin-service/src/main/java` → 0 matches.

### 7.3 Topology

`deploy/init/rabbitmq-definitions.template.json` declares 10 exchanges
(`auth.topic, finance.topic, hr.topic, inventory.topic, kitchen.topic, notifications.topic,
platform.topic, pos.topic, purchasing.topic, restaurantos.dlx`) and 20 queue/DLQ pairs. The **only**
binding on `platform.topic` is `audit.all-events.queue` with routing key `#`.

**⚠️ Any new queue must be added to `deploy/init/rabbitmq-definitions.template.json`** or it will not
exist in the cluster. Do not assume it appears.

### 7.4 Notable silence

`TenantLifecycleService` publishes **no events at all** — suspend / reactivate / cancel /
closePermanently write the row and a Redis key (`tenant:status:{id}`, :183-184) and nothing else. So
there is no event stream describing tenant lifecycle beyond provisioning. Same for
`TenantSubscriptionService.changeTier` — it reconciles features and writes
`tenant:nlq_quota:{id}` (:74, :194) but emits nothing. A "recent platform activity" feed built on
events would today contain provisioning and impersonation only.

---

# THE CAPABILITY MAP

Legend — **BUILDABLE NOW**: the data exists and is reachable by the platform plane.
**BUILDABLE WITH SCHEMA/INTEGRATION**: real data exists but needs new entities, new internal
endpoints, or a new client. **NOT HONEST**: would require inventing data.

---

### 1. Platform KPIs — **BUILDABLE NOW (a narrow set)**

Honest today, from `platform_db.tenants` alone (cross-tenant read is this database's whole purpose):
- Total tenants; tenants by `status` (6 values); tenants by `tier` (4 values).
- New tenants per period (`created_at`), suspensions (`suspended_at`), cancellations (`cancelled_at`).
- Tenants in `PROVISIONING_FAILED` — an operator-actionable number, and `retry-provisioning` exists.
- Trials ending / renewals due in the next N days (`trial_ends_at`, `renews_at`) — **caveat: these
  are operator-entered dates, and are NULL for most tenants.** Render "not set", never "0 days".
- Impersonation sessions started in period (`impersonation_log`, already exposed).

⚠️ `TenantRepository` (`repository/TenantRepository.java`) currently has only `findBySlug`,
`existsBySlug` and `JpaRepository` defaults. Count-by-status/tier needs one or two `@Query` methods —
trivial, no schema change.

**NOT honest as a "KPI":** anything named active-users, DAU/MAU, sessions, or adoption. There is no
platform-side session store and no per-tenant activity counter (`usage_records` = 0 rows).

---

### 2. Revenue metrics (MRR, ARR, churn value, ARPU, LTV, invoices, failed payments) — **NOT HONEST**

There is no price on a tier, no invoice, no payment, no payment-processor integration, no currency
field, no ledger of platform-side money anywhere in the codebase (§1.3). Every one of these numbers
would be fabricated.

The **only** honest revenue-adjacent facts today: the count of tenants per tier, and the free-text
`billing_ref` a human typed. A "Revenue" module can honestly render exactly one thing: *"Billing is
not integrated. N tenants on ENTERPRISE, M on GROWTH, K on STARTER. billing_ref set for J of them."*

**To make it real** you would need, at minimum, new entities in `platform_db` (Liquibase, following
the existing changelog structure, non-superuser-safe):
`subscription_plans(tier, currency, price_paisa, billing_interval)` ·
`tenant_subscriptions(tenant_id, plan_id, status, current_period_start/end, cancel_at)` ·
`invoices(tenant_id, period, amount_paisa, status, issued_at, due_at)` ·
`invoice_lines` · `payments(invoice_id, amount_paisa, method, external_ref, received_at)`.
**All amounts BIGINT paisa.** Even then MRR is only real once something *writes* payments —
either an operator-entry UI or a real processor integration. Do not ship an MRR tile on a schema
that only an operator types into and call it measured.

---

### 3. Tenant management — **BUILDABLE NOW (largely already built)**

~20 endpoints exist and are contract-frozen: create, list, get, patch, tier, retry-provisioning,
suspend, reactivate, cancel, close, features (GET/PATCH/DELETE override), usage, impersonate,
impersonations, status, reset-password. Frontend has 4 pages under `frontend/app/(platform)/platform/`.

Honest additions with no schema change:
- Filter/sort/search the tenant list by status, tier, created_at, slug (add repository methods).
- Tenant detail enriched with the live branch count (already available) and the feature diff vs tier
  default (`TenantFeatureEntity.is_override` distinguishes deliberate from seeded).
- Lifecycle-history from `suspended_at` / `cancelled_at` timestamps.

**Not honest without work:** a lifecycle *timeline* (no events published for suspend/cancel/close —
§7.4) and any per-tenant "last activity" (nothing records it).

---

### 4. User management (cross-tenant) — **BUILDABLE WITH INTEGRATION** (no new schema)

The data is real and the doors exist; platform-admin-service simply does not call them.

Needs: a `UserInternalClient` in platform-admin-service against
`auth-service /internal/auth/users` (list/get/create/patch/deactivate/reactivate), plus new
platform controller routes under the existing `SUPER_ADMIN` gate.

- Per-tenant user list, search, active-only filter, and **total count** — all already supported by
  `UserLifecycleInternalController.list()`.
- Per-user detail incl. `last_login_at`, `is_active`, `must_change_password`, lockout state.
- Deactivate/reactivate and password reset (reset already shipped).

Constraints to honour, not work around:
- Every call must carry `X-Tenant-Id` (RLS GUC) — there is **no all-tenants user query**; a fleet
  user list is N calls. Say so in the UI (a paged, per-tenant drill-down, not a global grid) or
  accept the fan-out cost explicitly.
- Writes require `X-Acting-User-Id`. The platform principal holds no `user_branch_roles`, so the
  role ceiling resolves the empty set and refuses. The reset path solves this with
  `actorTier="PLATFORM"`; **any new platform-tier write needs the same explicit exemption on the
  auth-service side**, designed deliberately, not by omitting a header.
- Once a user count exists, `UsageService`'s `users` meter can move from `notMetered` to `counted`,
  and `TenantSubscriptionService.usageViolations` can finally refuse a downgrade below headcount
  (the gap named at `TenantSubscriptionService.java:209-224`).

---

### 5. Roles & permissions (platform view) — **BUILDABLE WITH INTEGRATION** (no new schema)

Read-only platform view of the global catalogue is the honest, low-risk version:
- 80 permission codes with module grouping, and the 9 system roles with their grants — all
  `tenant_id IS NULL`, so genuinely global.
- Per-tenant custom roles exist (`092-tenant-custom-roles.xml`) and are RLS-scoped.

Needs: new **internal** endpoints in auth-service (e.g. `GET /internal/auth/roles`,
`GET /internal/auth/permissions`, `GET /internal/auth/tenants/{id}/roles`) plus a client.
The existing `/api/v1/roles` and `/api/v1/permissions` are unreachable to a platform token
(§3.4).

**Platform *modification* of tenant roles: possible but treat as a separate, security-reviewed
decision.** Composing a role IS granting authority (`RoleAdminController.java:31-38`), and the
platform tier has no ceiling to bound it. If it ships, it needs the same explicit
`actorTier="PLATFORM"` exemption, a mandatory reason, and an audit event — the pattern
`ADMIN_PASSWORD_RESET` already establishes.

**NOT honest:** any "permission usage" / "which tenants use role X" analytics. Nothing records it.

---

### 6. Subscriptions & billing — **SPLIT**

- **Subscription (entitlement) management: BUILDABLE NOW.** Tier change with limit enforcement and
  feature reconciliation is fully implemented (`POST /tenants/{id}/tier`, with `force` and a typed
  `TierLimitExceededException` listing violations). `PATCH /tenants/{id}` writes `billingRef`,
  `trialEndsAt`, `renewsAt`. Trial-ending and renewal-due lists are honest **as operator-entered
  dates**.
- **Billing: NOT HONEST** — see §2. No invoices, no payments, no prices, no dunning.

Two things a UI must not do: (a) present `billing_ref` as if it links to anything — it is free text;
(b) render a NULL `renews_at` as "—" that reads like a date; the comment on
`TenantEntity.java:58-61` is explicit that null means *"no renewal scheduled"*, a real state.

---

### 7. Feature management — **BUILDABLE NOW (already built)**

`GET /tenants/{id}/features`, `PATCH /tenants/{id}/features/{code}`,
`DELETE /tenants/{id}/features/{code}/override`. The response distinguishes **tier default** from
**SuperAdmin override** via `is_override`, invalidates both Redis cache key shapes so the gateway
sees changes on the next request, and `changeTier` reconciles without destroying overrides.
`FeatureCodeClosureTest` guards the code list.

Honest additions with no schema change: a cross-tenant matrix (code × tenant enabled/overridden),
built by reading `tenant_features` — cross-tenant reads on platform_db are the console's job (§6.1).

---

### 8. Analytics (cross-tenant) — **BUILDABLE WITH INTEGRATION** (no new ClickHouse migration)

Real, aggregatable, and correctly denominated in paisa: order volume, gross sales, discounts,
tax, till variance, item mix and gross margin — all with `tenant_id`, `branch_id` and `business_date`
on five existing fact tables (§5.2).

Recommended path: add a **read-only** ClickHouse datasource to platform-admin-service and query the
existing tables grouped by `tenant_id`. **Do not add a ClickHouse migration** — `ClickHouseSchemaGuard`
makes that boot-critical for reporting-service, and the existing grain already answers the question.

Caveats that must reach the UI:
- These are **restaurant** metrics (what tenants sell), not **platform** metrics (what we earn).
  Labelling "Total sales across tenants" as revenue would be the exact D-38-16 violation.
- Facts exist only for tenants whose branches actually trade; a tenant with no orders has no rows,
  which is *"no trading activity recorded"*, not zero sales.
- Business dates are cut on the **branch** timezone (`support/BusinessDay.java`,
  `BranchTimeZoneResolver.java`) — a naive UTC cross-tenant rollup will be wrong for
  `Asia/Karachi` branches by five hours. This is the same defect class already fixed twice
  (Takings screen; `AuditQueryController`'s `zone` parameter).

---

### 9. System administration / system status — **BUILDABLE WITH A SMALL GATE CHANGE**

Real: per-service UP/DOWN + last-reachable + instance count from `GET /api/v1/ops/health`, derived
from the gateway's own route table so it cannot silently omit a service (§6.3). Plus tenant
status/tier distributions and Prometheus targets.

Blocker: `OpsTokenAuthorizer` requires `ops.health.view`; a platform token holds only `SUPER_ADMIN`.
One file, one accepted-authority change — but it is a **security** change to the gateway's own
endpoint and should be reviewed as one, not slipped in.

**NOT honest without new work:** queue depth, DLQ depth, consumer lag, connection-pool saturation,
ClickHouse ingest lag, per-service error rates. No client for any of these exists in any service.
A "System status" page that shows an empty DLQ chart it is not actually reading is worse than one
that says "queue metrics are not collected".

---

### 10. Audit & security — **BUILDABLE WITH SCHEMA/INTEGRATION** (and one bug to fix first)

**BUILDABLE NOW:**
- Impersonation register across all tenants, filterable by tenant / admin / date, with computed
  status — already exposed at `GET /api/v1/platform/impersonations`.
- The security *posture* facts are documentable and true: append-only audit with 84-month retention,
  FORCE RLS per partition, DB-and-role isolation of the control plane, gateway header stripping.

**NEEDS WORK (real data, unreachable):**
- Cross-tenant audit feed, login history and failed-login analysis. `audit_events` holds all of it
  (§4.1-4.2) but `platform_db` cannot reach `audit_db` at all, and the platform token passes neither
  audit gate.
- **Fix first:** `/internal/audit/events` almost certainly returns zero rows for every tenant because
  nothing sets `app.current_tenant_id` on that path while the table is FORCE RLS (§4.3). Verify
  against a live audit_db before designing anything on top of it. The clean fix is a per-request GUC
  set from the `tenantId` parameter (or an `X-Tenant-Id` header), inside audit-service.
  **Do not reach for a SECURITY DEFINER function or an ownership change** — a SECURITY DEFINER
  function owned by the wrong role is the bug that just took the auth service down, and services
  connect as a non-superuser belonging to no roles, so a migration cannot fix ownership anyway.
- **Platform-operator audit is thinner than it looks.** `platform_users` has no `last_login_at` and
  no TOTP. Platform events are audited via `ALWAYS_AUDIT_SOURCES`, but `audit_events.tenant_id` is
  NOT NULL and a platform login has no tenant — where (or whether) platform-login rows land must be
  verified before promising a "SuperAdmin activity log". A dedicated `platform_db.platform_audit_log`
  table is the honest fix if they do not land.

---

### 11. Announcements — **NOT HONEST**

No announcement, broadcast, banner or message entity exists anywhere (`grep -rlniE
'announcement|broadcast_message'` across `services/` → zero production hits). Nothing consumes
`notifications.topic` for tenant-facing messages, and **`notification-service` has no source files
at all** — it is an empty POM module with no route and no port
(`FleetCatalogue.java:25-28`; also `PlatformUserAdminService.java:18-24`, which is why self-service
forgot-password ships disabled and the SuperAdmin *is* the delivery channel).

**BUILDABLE WITH SCHEMA** if wanted: `platform_db.announcements(id, title, body, severity,
audience_tier[], starts_at, ends_at, created_by, created_at)` plus
`announcement_dismissals(announcement_id, user_id)`, and a public read on the tenant side. That is
in-app banners only. **Email/SMS/WhatsApp delivery is NOT buildable** — there is no delivery service
to send it.

---

### 12. Support (tickets, SLA, conversations) — **NOT HONEST**

No ticket, conversation, SLA or case entity exists. What genuinely exists as "support" today:
- **Impersonation** — `POST /tenants/{id}/impersonate` with a reason, a 30-minute non-refreshable
  token, an `impersonated_by` claim carried into `audit_events`, and a queryable register.
- **Platform password reset** with a mandatory reason and an `ADMIN_PASSWORD_RESET` audit event.
- `PlatformUserEntity.PlatformRole` already declares `SUPPORT` and `BILLING` alongside `SUPER_ADMIN`
  (:40-42) — but **nothing differentiates them**: every platform endpoint gates on
  `hasAuthority('SUPER_ADMIN')`, so a SUPPORT or BILLING login can currently reach *nothing*. That
  is a real, cheap, honest capability to build (differentiated gates) and it needs no new data.

A "Support" module can honestly be *"Operator actions on this tenant"* — impersonations and password
resets with reasons. It cannot be a helpdesk.

---

## Summary table

| Module | Verdict | Blocking need |
|---|---|---|
| Platform KPIs (tenant counts, statuses, tiers, provisioning failures) | **BUILDABLE NOW** | 1-2 repository count queries |
| Revenue / MRR / invoices / payments | **NOT HONEST** | 5 new `platform_db` entities *and* a real payment source |
| Tenant management | **BUILDABLE NOW** | already built; add filters |
| User management (cross-tenant) | **BUILDABLE WITH INTEGRATION** | Feign client → `/internal/auth/users`; per-tenant only |
| Roles & permissions (read) | **BUILDABLE WITH INTEGRATION** | new internal endpoints in auth-service |
| Roles & permissions (write) | **BUILDABLE WITH INTEGRATION** + security review | platform-tier ceiling exemption, audited |
| Subscriptions (entitlement/tier) | **BUILDABLE NOW** | already built |
| Billing | **NOT HONEST** | see Revenue |
| Feature management | **BUILDABLE NOW** | already built; add cross-tenant matrix |
| Analytics (cross-tenant sales) | **BUILDABLE WITH INTEGRATION** | ClickHouse read-only datasource — **no migration** |
| System status | **BUILDABLE** | accept `SUPER_ADMIN` in `OpsTokenAuthorizer` |
| Queue/DLQ/pool/lag metrics | **NOT HONEST** | no collector exists anywhere |
| Audit — impersonation register | **BUILDABLE NOW** | already built |
| Audit — cross-tenant events / login history | **BUILDABLE WITH INTEGRATION** | fix `/internal/audit/events` GUC first |
| Audit — platform-operator activity | **BUILDABLE WITH SCHEMA** | likely needs `platform_audit_log` + `last_login_at` |
| Announcements (in-app) | **BUILDABLE WITH SCHEMA** | 2 new tables; no delivery beyond in-app |
| Announcements (email/SMS/WhatsApp) | **NOT HONEST** | notification-service has no source |
| Support / tickets / SLA | **NOT HONEST** | no entity; build "operator actions" instead |
| SUPPORT / BILLING platform roles | **BUILDABLE NOW** | differentiate the `@PreAuthorize` gates |

---

## Hard-rule reminders for whoever builds from this

1. **ClickHouse is boot-critical.** `ClickHouseSchemaGuard` refuses to boot reporting-service without
   its 4 fact tables. Prefer *reading* the existing tables. If a migration is ever unavoidable, it
   goes in `deploy/clickhouse/` and **`deploy/k8s/generate.sh` must be re-run — by the owner of that
   script, not as a side effect of this work.**
2. **A new RabbitMQ queue must be added to `deploy/init/rabbitmq-definitions.template.json`** or it
   will not exist in the cluster.
3. **Postgres changes go through Liquibase**, following each service's existing changelog structure.
   Services connect as a NON-SUPERUSER in no roles: a migration cannot ALTER ownership or create roles.
4. **RLS is FORCE-enabled on tenant tables** in every tenant database. `platform_db` deliberately has
   none (§6.1) — do not "fix" it. To read tenant data, use the existing internal HTTP seams with
   `X-Tenant-Id`, which is how the branch count and the password reset already work. Do not invent a
   SECURITY DEFINER path.
5. **Money is BIGINT paisa.** Never float, never double.
6. **Preserve every existing endpoint contract and every `data-testid` consumed by e2e.**
7. **`frontend/` is another workstream's** — do not touch it.
8. **D-38-16 in practice:** the pattern already exists and should be copied, not reinvented —
   `PlatformDtos.UsageMeter` (`dto/PlatformDtos.java:310-333`) with its `counted` / `notMetered` /
   `unreadable` trichotomy, and `UsageService.java:126-158` explaining why `0` and "not metered" must
   never be the same answer. Any new platform figure should be expressed in that shape.
