# Unified Tenant Configuration Model

**Status:** research / design recommendation
**Date:** 2026-08-07
**Scope:** where tenant configuration lives, how it propagates, how it is validated, versioned and governed
**Constrains:** every subsequent adaptivity design (service model, tax, receipts, printers, POS profiles, KDS routing, business hours, locale, FBR credentials, quotas)

---

## 0. The recommendation in one page

**Two planes, one registry, three scopes, no new service.**

1. **Control plane — entitlement.** Stays exactly where it is: `platform_db`, owned by
   platform-admin-service, written only by SuperAdmin. `tenants` + `tenant_features` already
   implement this ([`TenantEntity.java`](../../../services/platform-admin-service/src/main/java/io/restaurantos/platform/entity/TenantEntity.java),
   [`TenantFeatureEntity.java`](../../../services/platform-admin-service/src/main/java/io/restaurantos/platform/entity/TenantFeatureEntity.java)).
   Distribution is the Redis read-through the gateway already runs. **Unknown = refuse.** Settled by
   13-03/D-33 and not reopened here.

2. **Configuration plane — operations.** Does **not** go into `platform_db`. It lives in the
   database of the service that owns the invariant, in one repeated table shape,
   `tenant_settings` / `tenant_setting_revisions` / `tenant_secrets`. Reads are Redis read-through;
   writes SET the cache after commit and publish `TENANT_SETTING_CHANGED` through the existing
   transactional outbox.

3. **One registry makes it coherent.** A compiled-in `SettingRegistry` in `shared-lib` is the single
   catalogue of every setting key: owner, scope ceiling, JSON Schema, default, writer class,
   secret-ness, and — the load-bearing field — its **unresolved policy** (`DEFAULT` / `REFUSE` /
   `LAST_KNOWN`). The registry is the thing that stops this becoming scattered ad-hoc columns; the
   storage being distributed is an implementation detail underneath it.

4. **Scopes: `TENANT` → `BRANCH` → `TERMINAL`.** Resolution walks the deepest scope upward and ends
   at the registry default. Platform defaults are **code, never rows**.

5. **The ownership rule that keeps it honest:** *a setting's invariants must be checkable inside its
   owner's own transaction. If they are not, the setting is owned by the wrong service.* No
   synchronous cross-service validation, ever.

Why not central-with-distribution: `platform_db` has **no RLS by mandate**
(`010-create-platform-tables.xml` lines 8–12: "NO RLS, NO tenant-isolation policy (SC4/PLATFORM-07)
… DO NOT add tenant isolation policies or `app.current_tenant_id` anywhere in this file"). Putting
every tenant's operational configuration there moves the platform's largest body of tenant-scoped
data into the one database with no row-level tenant boundary, guarded only by application code. It
also makes platform-admin a write dependency for routine restaurant operations, and platform-admin
is the service whose unavailability the gateway is deliberately configured to treat as a refusal.

Why not purely local-with-no-model: that is what exists today, and §1 shows what it produced —
five config surfaces, three of them completely dead, two of them write-only, one hard-coded
timezone, and two different rounding conventions for tax.

---

## 1. Ground truth: what exists today

Every claim below was read in the file cited.

### 1.1 The control plane is real and works

| Component | File | State |
|---|---|---|
| Tenant record, tier, status, quotas | `services/platform-admin-service/.../entity/TenantEntity.java` | live |
| Per-tenant feature flags + `is_override` | `.../entity/TenantFeatureEntity.java` | live |
| Tier → feature matrix (20 codes) | `.../config/TierFeatureDefaults.java` | live |
| Tier → numeric limits | `.../config/TierLimits.java` | live |
| SuperAdmin toggle + dual-key Redis write | `.../service/FeatureFlagAdminService.java` | live |
| Gateway status/feature/quota enforcement | `gateway/.../filter/FeatureFlagGlobalFilter.java` | live |
| Route → feature map | `gateway/.../support/RouteFeatureMap.java` | live |
| Internal read API for the gateway | `.../controller/PlatformInternalController.java` | live |
| Per-service `@RequiresFeature` aspect | `shared-lib/.../feature/RedisFeatureFlagService.java` | live |

`FeatureFlagGlobalFilter` is the reference implementation for everything in this document. It
already encodes the three rules that matter:

- **Three outcomes, not two.** `StatusResolution.UNKNOWN` (line 328–344) exists because
  "we could not determine" is a distinct answer from ACTIVE and SUSPENDED.
- **An unknown is never cached.** Lines 386–394: "Caching a guess turns a momentary blip into a
  hard refusal for the full 5-minute TTL."
- **Exactly one fail-open lever.** Lines 99–105: "two levers that can disagree give an operator a
  configuration in which entitlement fails closed and suspension fails open, which is the worst of
  both and is invisible until someone tests it."

### 1.2 The configuration plane does not exist. Five stubs stand in for it.

| Column / table | Where | Written? | Read? | Verdict |
|---|---|---|---|---|
| `tenants.theme_config` JSONB | `TenantEntity.java:41-43` | **no** | **no** | dead — only the entity and `010-create-platform-tables.xml:32` mention it |
| `tenants.email_config` JSONB | `TenantEntity.java:45-47` | **no** | **no** | dead |
| `tenant_features.config_json` JSONB | `TenantFeatureEntity.java:51-53` | **no** | **no** | dead — grep across all Java/TS/XML returns only the entity and `010-create-platform-tables.xml:71` |
| `branches.currency_config` JSONB | `BranchEntity.java:54-56` | yes, `BranchService.java:54,124` | **no consumer** | write-only |
| `branches.receipt_config` JSONB | `BranchEntity.java:58-60` | yes, `BranchService.java:55,125` | **no consumer** | write-only |

Both branch columns are **raw unvalidated `String`** on the way in — `BranchService.create` does
`branch.setCurrencyConfig(req.currencyConfig())` with no parse, no schema, no shape check, straight
from a public `PUT /api/v1/users/branches/{id}`. Any JSON, or any string at all, is accepted and
stored. This is precisely the failure mode §5 is written to prevent.

### 1.3 Config that *is* consumed, scattered across five services with no common model

| What | Owner | Shape | Notes |
|---|---|---|---|
| Branch IANA timezone | user-service `branches.timezone` | column, default `Asia/Karachi` (`BranchEntity.java:51-52`) | the one working cross-service config read |
| Payroll tax slabs, EOBI rates | hr-service `tax_config` | per (tenant, fiscal_year) row, JSONB slabs (`TaxConfigEntity.java`) | good design, isolated |
| Late-arrival policy | hr-service `attendance_policies` | `branch_id NULL = tenant-wide default` (`AttendancePolicyEntity.java:16`) | **the tenant/branch override pattern already exists here, informally** |
| 3-way match tolerances | purchasing-service `tenant_match_tolerances` | `domain/model/TenantMatchTolerance.java` | ad-hoc |
| PO approval tiers | purchasing-service `po_approval_tiers` | table | ad-hoc |
| Loyalty tier thresholds | crm-service `loyalty_tier_config` | table | ad-hoc |
| Branch menu overrides | pos-service `branch_menu_overrides` | table | ad-hoc |

Five services, five different shapes, five different write paths, five different audit stories,
zero shared vocabulary. The next twelve settings will make it seventeen.

### 1.4 Distribution: the only cross-service config read that works, and how

`reporting-service/.../support/BranchTimeZoneResolver.java` is the sole working example:

```
Redis GET branch:tz:{branchId}   (24h TTL)
  ↓ miss
Feign GET /internal/users/branches/{branchId}   (X-Internal-Service secret; no JWT required)
  ↓ any failure
fall back to restaurantos.business-day.default-timezone (Asia/Karachi), log WARN
```

This is the right shape and the right fallback *for this setting* — an ETL consumer that cannot
resolve a timezone must still bucket the event, because dropping it is worse than bucketing it in
the default zone. The model in §4 has to be able to express exactly this, and it does
(`unresolved: DEFAULT`). But note that it is a bespoke class: nothing else can reuse it, and the
next service that needs a config value will write a sixth variant of it.

Meanwhile the same concept is hard-coded twice elsewhere:
- `hr-service/.../service/AttendanceService.java:34` — `ZoneId ZONE = ZoneId.systemDefault()`. The
  JVM's zone, not the tenant's, not the branch's.
- `hr-service/.../adms/AttlogLineParser.java:21` — `ZoneId DEVICE_ZONE = ZoneId.of("Asia/Karachi")`.

### 1.5 Locale and rounding are compiled in, and already inconsistent

- `shared-lib/.../money/MoneyUtils.java:9` — `Locale EN_PK` is a private static final. Every
  `formatPkr` call in the platform formats as Pakistani rupees regardless of tenant.
- `MoneyUtils.taxPerLine` (line 39) floors: `(linePaisa * taxBps) / 10000`.
- `pos-service/.../service/OrderPricingCalculator.java:56-60` rounds HALF_UP for the same
  quantity.

Two rounding conventions for per-line tax already coexist. A tenant-configurable rounding mode with
one owner is not a nice-to-have; it is the fix for a live inconsistency.

### 1.6 Service charge is structurally present and permanently zero

`pos-service/.../domain/model/Order.java:69` declares `private long serviceChargePaisa = 0L;`. It
flows through `OrderPricingCalculator.orderTotals` (line 94, 109, 111) and out through
`OrderDto` (line 26). **`setServiceChargePaisa` is never called anywhere in `src/main`.** There is
no service-charge configuration, no service-charge input, and no service-charge feature. The field
is a schema-level placeholder for a capability that does not exist — exactly the "structurally
present and completely dead" pattern this project has shipped before.

### 1.7 Feature-flag resolver coverage is uneven

`SharedAutoConfiguration.java:139-153` registers `TenantFeatureResolver` only
`@ConditionalOnProperty("restaurantos.platform-admin.uri")`. Without it,
`RedisFeatureFlagService.isEnabled` returns `false` on every cache miss (lines 51–56).

Services that set the property: finance, inventory, kitchen, nlq, pos, purchasing, reporting.
Services that do not: audit, auth, authorization, crm, **file** (sets a *differently named*
`restaurantos.platform-admin-service.uri`), **hr**, user, platform-admin.

hr-service and crm-service happen not to use `@RequiresFeature` today, so nothing is broken — but
the first `@RequiresFeature` added to either will 403 for every tenant on every request, silently.
The same class of defect this repo has already hit five times. **Any settings design that adds a
`@ConditionalOnProperty` bean must come with a closure test, not a comment.**

### 1.8 Two live defects in the existing invalidation path

Both are in `FeatureFlagAdminService.invalidateBothKeyShapes` (lines 172–184), and the model in
§6 must not copy them.

**(a) Redis is written inside the transaction, so a rollback poisons the cache.**
`setFeature` and `reconcileToTierDefaults` are `@Transactional` and call
`redis.opsForValue().set(...)` in the method body. If the transaction rolls back after that point,
Redis holds a value the database never committed.

**(b) The Redis write has no TTL.**
```java
redis.opsForValue().set(gatewayKey, value);   // no Duration argument
redis.opsForValue().set(serviceKey, value);
```
Every other write in this system carries an expiry —
`FeatureFlagGlobalFilter` uses `CACHE_TTL = Duration.ofMinutes(5)` on both its cache-fill paths
(lines 60, 302, 411). These two do not. Combined with (a), a rolled-back toggle leaves a
**permanently** wrong flag: the gateway reads it, finds a value, and never re-resolves. The
comment at lines 179–181 correctly explains why `SET` beats `DELETE`, and then omits the TTL that
makes `SET` safe.

> Recommendation for a separate fix, independent of this design: move both writes to an
> after-commit hook and give them the same 5-minute TTL the readers assume.

### 1.9 Security context the design can rely on

- JWT claims available: `tenant_id`, `branch_id`, `roles`, `permissions`, `attributes`,
  `totp_verified`, `impersonated_by`, `token_type`
  (`auth-service/.../service/JwtSigningService.java:36-45, 103-140`).
- 13-02 made TOTP step-up **a JWT claim, not a header** (commit `6da5fb2`), so
  "this setting requires step-up" is enforceable with what exists.
- `EncryptedStringConverter` (`shared-lib/.../security/EncryptedStringConverter.java`) is proven in
  production paths: `hr-service/.../entity/AttendanceDeviceEntity.java:53`,
  `auth-service/.../entity/UserEntity.java:37`.
  **Trap:** `EncryptionAutoConfiguration` is `@ConditionalOnProperty("restaurantos.encryption.key")`
  and the converter holds a `static EncryptionService` initialised by that bean. If the key is
  unset, the converter is never initialised and the **first write NPEs at runtime, not at startup.**
- `branches` RLS: `USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)` with
  `FORCE ROW LEVEL SECURITY` (`user-service/.../011-enable-rls-branches.xml`). The policy has no
  explicit `WITH CHECK`; for a `FOR ALL` policy Postgres reuses `USING` as the check, so inserts are
  covered — but new settings tables should state `WITH CHECK` explicitly rather than rely on it.
- Transactional outbox is shared and already used by platform-admin
  (`shared-lib/.../event/DomainEventPublisher`, `OutboxRelay` polling every 1000 ms;
  `platform_db` has its own `event_outbox` table per `020-shared-infra-tables.xml`).

---

## 2. The decision: where configuration lives

### 2.1 The question, sharpened

"Central or distributed" is the wrong axis. The real question is: **where does the authority to
*reject* a value live?** Storage follows that, not the other way round.

Consider the invariant the brief names: *a service model incompatible with an active till must be
rejected, not stored.* Open tills are rows in `pos_db.till_sessions`, reachable only by pos-service.
A central store in `platform_db` physically cannot evaluate that predicate. It has exactly three
options, and all three are bad:

1. Accept the write and let pos-service discover the conflict later — which is "stored, not
   rejected", the thing we were told not to do.
2. Call pos-service synchronously inside the write. That is a distributed transaction with no
   coordinator; the settings write now fails for network reasons and reports them as validation
   failures. This repo has already shipped a compensation path that could never fire because
   **Feign cannot send PATCH** — a transport-shaped failure wearing a domain-logic costume. Adding a
   mandatory cross-service hop to every settings write invites the same class of bug at ten times
   the frequency.
3. Replicate `till_sessions` into `platform_db`. No.

So: **the owner of a setting is the service that can evaluate its invariants inside its own
transaction.** That is a rule, not a preference, and it is the single constraint that makes the
ownership table in §3 derivable rather than arbitrary.

### 2.2 Why not `platform_db` for operational settings

- **PLATFORM-07 forbids it in spirit and the migration forbids it in writing.**
  `010-create-platform-tables.xml:8-12` — "Platform DB Tables — NO RLS … DO NOT add tenant isolation
  policies or `app.current_tenant_id` anywhere in this file." The entire configuration surface of
  every tenant is the last body of data that should sit outside RLS.
- **Availability coupling.** The gateway deliberately refuses when platform-admin cannot answer
  (13-03, `TENANT_STATUS_UNAVAILABLE`, `T-13-03-C` accepted as a DoS trade). That posture is correct
  for *entitlement*. Extending it to *operations* means a platform-admin restart stops restaurants
  taking orders because nobody can resolve a rounding mode.
- **Blast radius.** platform-admin currently owns 5 tables. Making it own ~40 setting keys for 16
  services makes every settings change a platform-admin deploy.

### 2.3 Why not "each service does whatever it likes"

That is the status quo (§1.3) and it produces: no common audit story, no common rollback,
no common validation, no common cache policy, no way for the UI to render a settings screen without
bespoke code per module, and — demonstrated — dead columns nobody notices for three phases.

### 2.4 The answer

> **Configuration is *federated by storage* and *unified by registry*.**
>
> The **`SettingRegistry`** — one compiled-in catalogue in `shared-lib`, closure-tested against
> every owner — is the single coherent model. It declares every key exactly once.
> The **rows** live in the owner's own RLS-protected database, because that is the only place their
> invariants can be checked.
> The **reads** cross service boundaries through Redis, never through a synchronous call in a
> request path.

One exception, deliberate: **entitlement and quota stay central in `platform_db`**, because their
invariant *is* the tier table, which platform-admin owns, and because they must not be writable by
the tenant at all.

---

## 3. Ownership map

Derived by applying §2.1: owner = the service that can check the invariant locally.

| Scope group | Key prefix | Owner | Why that owner |
|---|---|---|---|
| Entitlement, quotas, tier | `platform.*` | **platform-admin-service** | invariant is the tier table it owns; must be tenant-unwritable |
| Org identity, locale, money presentation, branding, hours, branch profile | `org.*` | **user-service** | already owns `branches` (RLS, FORCE) incl. `timezone`, `ntn`, `fbr_strn`; already exposes `/internal/users/branches/{id}` that reporting-service consumes |
| Service model, table/counter behaviour, till rules, order numbering, receipt layout, printer targets, POS terminal profiles | `pos.*` | **pos-service** | invariants read `till_sessions`, `dining_tables`, `stations`, `order_sequences` |
| Station routing, prep-time defaults, bump behaviour, BDS split | `kds.*` | **kitchen-service** | invariants read `kds_stations` |
| Tax profile, rounding mode, fiscal calendar, auto-post recipes, period policy | `finance.*` | **finance-service** | invariants read `accounting_periods`, `journal_entries`, `je_sequences` |
| Match tolerances, approval tiers, AP policy | `purchasing.*` | **purchasing-service** | already holds `tenant_match_tolerances`, `po_approval_tiers` |
| Costing method, lot tracking, wastage policy, reorder defaults | `inventory.*` | **inventory-service** | invariants read `stock_lots`, `ingredient_branch_stock` |
| Payroll tax config, attendance policy, leave accrual, device config | `hr.*` | **hr-service** | already holds `tax_config`, `attendance_policies`, `attendance_devices` |
| Loyalty tiers, promotion rules, feedback policy | `crm.*` | **crm-service** | already holds `loyalty_tier_config` |
| Channel enablement, template overrides, quiet hours | `notify.*` | **notification-service** | owns delivery |
| FBR e-invoicing endpoint, credentials, mode | `fbr.*` | **finance-service** | statutory posting is finance's invariant; see §11 dependency |

**`org.*` deserves a note.** Currency, timezone, locale, date format, business hours, fiscal-year
label, legal name, NTN/STRN and receipt branding are read by nearly every service and owned by none
of them. Rather than inventing a 17th service, they attach to user-service, which already holds
`branches` with `timezone`, `ntn`, `fbr_strn`, `currency_config` and `receipt_config`, already has an
internal branch endpoint that another service already calls and caches, and whose database already
has `FORCE ROW LEVEL SECURITY` on that table. This is the smallest move that removes the scattering.

> Naming: expose it at `/api/v1/org/settings/**` (a new gateway route to `lb://user-service`), not
> `/api/v1/users/settings/**`. The route carries **no feature gate**, consistent with
> `RouteFeatureMap` leaving `/api/v1/users/` ungated for core access.

---

## 4. The registry

The registry is the artefact that makes this "one coherent model" rather than "eleven local tables".
It is **compiled-in Java in `shared-lib`**, not a database table, for the same reason
`TierFeatureDefaults` and the permission catalogue are code: a vocabulary that ships with the binary
can be closure-tested at build time, and drift becomes a red build instead of a production 403.

```java
package io.restaurantos.shared.settings;

public record SettingDefinition(
        String key,                  // "pos.service_model" — dot-namespaced, prefix = owner
        String owner,                // "pos-service"
        Scope maxScope,              // deepest scope at which an override is legal
        WriterClass minWriter,       // SUPER_ADMIN | TENANT_ADMIN | BRANCH_MANAGER
        boolean requiresStepUp,      // assert totp_verified on the caller's JWT
        ValueType type,              // STRING | INTEGER | BOOLEAN | ENUM | PAISA | JSON_OBJECT
        String jsonSchema,           // draft-2020-12, validated on every write
        String defaultJson,          // the platform default — code, never a row
        Unresolved unresolved,       // DEFAULT | REFUSE | LAST_KNOWN   ← see §6.3
        boolean secret,              // true ⇒ tenant_secrets, never Redis, never an event payload
        String description) {

    public enum Scope       { TENANT, BRANCH, TERMINAL }
    public enum WriterClass { SUPER_ADMIN, TENANT_ADMIN, BRANCH_MANAGER }
    public enum Unresolved  { DEFAULT, REFUSE, LAST_KNOWN }
}
```

Each owning service contributes a `SettingModule` (a `List<SettingDefinition>`); `shared-lib`
assembles them into an immutable `SettingRegistry` keyed by `key`, failing fast on a duplicate key
or on a `key` whose prefix does not match its declared `owner`.

### 4.1 Illustrative entries

| key | maxScope | minWriter | type | unresolved | note |
|---|---|---|---|---|---|
| `org.locale` | BRANCH | TENANT_ADMIN | ENUM | DEFAULT | replaces `MoneyUtils.EN_PK` |
| `org.currency_code` | TENANT | TENANT_ADMIN | ENUM | **REFUSE** | changing it after any posted journal is an invariant violation (§5.3) |
| `org.timezone` | BRANCH | TENANT_ADMIN | STRING | DEFAULT | subsumes `branches.timezone` + `BranchTimeZoneResolver`'s fallback |
| `org.business_hours` | BRANCH | BRANCH_MANAGER | JSON_OBJECT | DEFAULT | |
| `org.receipt.branding` | BRANCH | TENANT_ADMIN | JSON_OBJECT | DEFAULT | replaces write-only `branches.receipt_config` |
| `pos.service_model` | BRANCH | TENANT_ADMIN | ENUM | **REFUSE** | `TABLE_SERVICE` \| `COUNTER` \| `QSR` \| `DELIVERY_ONLY` |
| `pos.service_charge_pct_bps` | BRANCH | TENANT_ADMIN | INTEGER | **REFUSE** | basis points; makes `Order.serviceChargePaisa` (§1.6) live |
| `pos.rounding_mode` | TENANT | TENANT_ADMIN | ENUM | **REFUSE** | resolves the `MoneyUtils` / `OrderPricingCalculator` split (§1.5) |
| `pos.printer.receipt_target` | TERMINAL | BRANCH_MANAGER | JSON_OBJECT | LAST_KNOWN | |
| `kds.routing_rules` | BRANCH | BRANCH_MANAGER | JSON_OBJECT | LAST_KNOWN | |
| `finance.fiscal_year_start_month` | TENANT | TENANT_ADMIN | INTEGER | **REFUSE** | |
| `finance.tax_profile` | TENANT | TENANT_ADMIN | JSON_OBJECT | **REFUSE** | |
| `fbr.credentials` | TENANT | TENANT_ADMIN + step-up | JSON_OBJECT | **REFUSE** | `secret: true` |
| `platform.quota.nlq_monthly` | TENANT | **SUPER_ADMIN** | INTEGER | **REFUSE** | already enforced by the gateway; §7 gives it a home |

### 4.2 Money in settings

**Hard rule, closure-tested:** no registry entry may declare `"type": "number"` in its JSON Schema.
Any monetary setting is `ValueType.PAISA`, stored as a JSON **integer**, and its key ends `_paisa`.
Rates are basis points (`_bps`, integer), never percentages as decimals. A `TENANT_SETTING_CHANGED`
payload therefore never carries a float or a decimal, satisfying the platform money rule at the
config layer as well as the event layer.

### 4.3 Closure tests (build-failing, modelled on what already works)

The two existing closure tests in this repo are the template:
`services/platform-admin-service/src/test/java/io/restaurantos/platform/config/FeatureCodeClosureTest.java`
and `services/auth-service/src/test/java/io/restaurantos/auth/PermissionCatalogClosureTest.java`.
Both parse another module's source off the repository tree and compare vocabularies. Four new ones:

| Test | Asserts | Catches |
|---|---|---|
| `SettingKeyClosureTest` | every key read via `Settings.get(...)` anywhere in `services/**` exists in the registry | a typo'd key silently resolving to the default forever |
| `SettingOwnerClosureTest` | every `owner` is a real directory under `services/`, and every key's prefix maps to that owner | a key served by a service that does not own it |
| `SettingMoneyTypeTest` | no schema declares `number`; every `_paisa` key is `integer` | a float creeping into a config value or event payload |
| `SettingWriterClosureTest` | every permission named by a `minWriter` mapping exists in the auth catalogue changelog | the five-times-repeated phantom-permission defect |

---

## 5. Schema

Deployed **per owning service database**, identical shape everywhere. `shared-lib` ships the JPA
entities and the repository; each owner ships its own Liquibase changeset.

### 5.1 `tenant_settings`

```sql
CREATE TABLE tenant_settings (
    tenant_id       UUID        NOT NULL,
    scope_type      VARCHAR(16) NOT NULL,            -- TENANT | BRANCH | TERMINAL
    scope_id        UUID        NOT NULL,            -- see the sentinel note below
    setting_key     VARCHAR(120) NOT NULL,
    value           JSONB       NOT NULL,
    version         BIGINT      NOT NULL DEFAULT 1,  -- optimistic concurrency (If-Match)
    locked_by_platform BOOLEAN  NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by      UUID,
    CONSTRAINT pk_tenant_settings
        PRIMARY KEY (tenant_id, scope_type, scope_id, setting_key),
    CONSTRAINT chk_tenant_settings_scope
        CHECK (scope_type IN ('TENANT','BRANCH','TERMINAL')),
    CONSTRAINT chk_tenant_settings_tenant_scope_sentinel
        CHECK (scope_type <> 'TENANT' OR scope_id = '00000000-0000-0000-0000-000000000000')
);

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_settings
    USING      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_tenant_settings_key ON tenant_settings (tenant_id, setting_key);
```

Two deliberate choices:

- **`scope_id` is `NOT NULL` with an all-zeros sentinel for `TENANT`**, rather than nullable. A
  nullable column in a primary key does not enforce uniqueness in Postgres (`NULL <> NULL`), so a
  nullable `scope_id` permits two tenant-scope rows for the same key — silent, undetectable, and
  whichever the planner returns first wins. The sentinel makes the PK do its job. The `CHECK`
  constraint pins the sentinel to `TENANT` only.
- **`WITH CHECK` is stated explicitly**, unlike `011-enable-rls-branches.xml`, which relies on
  Postgres reusing `USING`. Stating it means a future `FOR SELECT`/`FOR UPDATE` split cannot silently
  drop insert protection.

### 5.2 `tenant_setting_revisions`

```sql
CREATE TABLE tenant_setting_revisions (
    id              BIGSERIAL    PRIMARY KEY,
    tenant_id       UUID         NOT NULL,
    scope_type      VARCHAR(16)  NOT NULL,
    scope_id        UUID         NOT NULL,
    setting_key     VARCHAR(120) NOT NULL,
    revision        BIGINT       NOT NULL,           -- monotonic per (tenant,scope,key)
    previous_value  JSONB,                           -- NULL on first write
    new_value       JSONB,                           -- NULL when the override was removed
    change_kind     VARCHAR(16)  NOT NULL,           -- SET | CLEAR | RESTORE | PLATFORM_LOCK
    actor_type      VARCHAR(24)  NOT NULL,           -- TENANT_USER | PLATFORM_ADMIN | SYSTEM
    actor_user_id   UUID,
    impersonated_by UUID,                            -- from the JWT claim; never inferred
    reason          TEXT,
    changed_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_setting_revision
        UNIQUE (tenant_id, scope_type, scope_id, setting_key, revision)
);

ALTER TABLE tenant_setting_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_setting_revisions FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_setting_revisions
    USING      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Append-only at runtime: no UPDATE/DELETE grants for the service role, plus a trigger,
-- matching the posture audit_service already uses on audit_events.
REVOKE UPDATE, DELETE ON tenant_setting_revisions FROM <service_role>;
```

`impersonated_by` is written from the JWT claim and is **never defaulted**. The precedent is
explicit: `PlatformInternalController.impersonate` refuses a request with no `actingAdminUserId`
because "an audit row naming the wrong person is worse than no row" (D-34). Same rule here.

### 5.3 `tenant_secrets`

```sql
CREATE TABLE tenant_secrets (
    tenant_id       UUID         NOT NULL,
    scope_type      VARCHAR(16)  NOT NULL,
    scope_id        UUID         NOT NULL,
    setting_key     VARCHAR(120) NOT NULL,
    ciphertext      BYTEA        NOT NULL,     -- @Convert(EncryptedStringConverter.class)
    fingerprint     VARCHAR(64)  NOT NULL,     -- SHA-256 of plaintext, for "did it change?" only
    rotated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    rotated_by      UUID,
    CONSTRAINT pk_tenant_secrets PRIMARY KEY (tenant_id, scope_type, scope_id, setting_key)
);
-- same FORCE RLS + USING/WITH CHECK policy
```

Rules, all enforceable and all testable:
1. A `secret: true` key **never** has a `tenant_settings` row.
2. Never written to Redis. Resolution is always a database read in the owner. Secrets are used on
   outbound-integration paths (FBR submission, SMTP), not in the order hot path, so the cost is fine.
3. Never returned by any `GET`. The API returns `{configured, fingerprint, rotatedAt}`.
4. Its `TENANT_SETTING_CHANGED` event carries `{key, revision, secret: true}` and **no value**.
5. **Startup gate:** any service declaring a `secret: true` key must fail fast at boot if
   `restaurantos.encryption.key` is unset — otherwise `EncryptedStringConverter.encryptionService`
   is null and the first write NPEs in production (§1.9).

### 5.4 Control-plane additions (platform_db only)

`tenants` currently carries four quota columns (`max_branches`, `max_users`, `storage_gb`,
`nlq_quota`) stamped by `TierLimits.applyTo`. `nlq_quota` was invisible to the gateway until 13-14.
Rather than adding a fifth and a sixth column each time a quota is invented:

```sql
CREATE TABLE tenant_quotas (
    tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    quota_key   VARCHAR(80)  NOT NULL,     -- 'branches' | 'users' | 'storage_gb' | 'nlq_monthly'
    limit_value BIGINT       NOT NULL,     -- -1 is NOT permitted; see below
    source      VARCHAR(16)  NOT NULL,     -- TIER | OVERRIDE   (mirrors tenant_features.is_override)
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_by  UUID,
    CONSTRAINT pk_tenant_quotas PRIMARY KEY (tenant_id, quota_key)
);
-- NO RLS. platform_db is not tenant-scoped (PLATFORM-07); this is a plain FK, as on usage_records.
```

`source` carries `tenant_features.is_override`'s exact semantics: a tier change reconciles `TIER`
rows and leaves `OVERRIDE` rows alone, so a quota a SuperAdmin granted deliberately survives a
downgrade. Reuse the reasoning in `TenantFeatureEntity.java:34-47` verbatim.

**`-1` is forbidden as a stored value.** `FeatureFlagGlobalFilter` uses `UNDETERMINED_QUOTA = -1L`
as an in-memory sentinel for "could not be determined" (line 80). A `-1` that can also mean
"unlimited" would collide with it and turn an outage into an unmetered Claude-backed endpoint —
the exact billing incident the 13-14 comment describes. Unlimited, if it is ever needed, is a
separate boolean column, never a magic number.

The four existing columns stay for one release as a read-only projection, then are dropped once
`TenantSubscriptionService` and `PlatformInternalController.getStatus` read the table.

---

## 6. Propagation

### 6.1 Read path — three tiers, no synchronous cross-service call in a request

```
Settings.get(tenantId, branchId, terminalId, "pos.rounding_mode")
   │
   ├─ 1. Redis  GET  tset:{tenantId}:{scope}:{scopeId}:{key}       ← 300 s TTL
   │        hit → parse & return  (records provenance)
   │
   ├─ 2. miss, and this process IS the owner
   │        → SELECT from tenant_settings, walking TERMINAL → BRANCH → TENANT
   │        → SET the resolved value into Redis WITH TTL
   │
   ├─ 2'. miss, and this process is NOT the owner
   │        → GET {owner}/internal/settings/resolve?tenant=&scope=&key=
   │          (X-Internal-Service secret, the same gate BranchInternalController uses)
   │        → SET into Redis WITH TTL
   │
   └─ 3. still unresolved → apply the key's declared Unresolved policy (§6.3). Never cached.
```

The scope walk happens **once, at resolution**, and the *resolved* value is what is cached, keyed by
the scope it was requested at. So a branch that has no override caches the tenant value under its own
branch key. The trade is that a tenant-scope write must invalidate every branch key for that
key — handled in §6.2 by publishing the fan-out from the owner, which knows the branch list.

The 300-second TTL is deliberately the same number as
`FeatureFlagGlobalFilter.CACHE_TTL` and `restaurantos.feature-flags.cache-ttl-seconds` (default 300
in `SharedAutoConfiguration:150`). One number, one mental model.

### 6.2 Write path — commit first, then cache, then event

```java
@Transactional
public SettingWriteResult set(SettingWrite w) {
    SettingDefinition def = registry.require(w.key());
    assertOwnedByThisService(def);          // wrong-owner ⇒ 400, never a silent accept
    assertWriter(def, caller);              // WriterClass + branch-role + optional step-up
    assertScopeAllowed(def, w.scope());     // maxScope ceiling
    validateShape(def, w.value());          // JSON Schema
    validateReferential(def, w.value());    // owner-local FK-ish checks
    runInvariants(def, w);                  // §7 — inside THIS transaction

    long v = upsertWithVersionCheck(w);     // If-Match mismatch ⇒ 409 SETTING_VERSION_CONFLICT
    appendRevision(w, v, caller);           // same transaction, append-only
    outbox.publish("config.topic", "config.setting.changed",
                   "TENANT_SETTING_CHANGED", w.branchId(), payload(w, v));  // same transaction
    registerAfterCommit(() -> cache.put(w, v));   // ← NOT inside the transaction
    return ...;
}
```

Four properties, each a direct response to something already in this codebase:

| Property | Reason |
|---|---|
| Cache write is `afterCommit`, **not** in the transaction body | §1.8(a) — `FeatureFlagAdminService` writes Redis inside `@Transactional`, so a rollback leaves Redis holding a value the DB never committed |
| Cache write **always carries the 300 s TTL** | §1.8(b) — the existing writes carry none, so a bad entry never self-heals |
| Cache write **SETs the new value**, does not DELETE | `FeatureFlagAdminService:179-181` — DELETE plus a fail-closed miss path silently disables the thing you just enabled |
| Event goes through the **outbox**, in the same transaction | `EventPublisher` javadoc: "MUST be called inside the same `@Transactional` method that mutates business state (resolves MAJOR-12)" |

The event is the durable backstop, and it does a job the direct cache write cannot: it lets a
service that must **react** to a change (rebuild a routing table, re-open a period, re-register a
printer) do so, and it lets a service whose Redis write was lost recover within one relay tick
(`OutboxRelay` runs `@Scheduled(fixedDelay = 1000)`). Together: propagation is typically sub-second,
worst case bounded by the 300 s TTL, and never unbounded.

Payload (money-safe, secret-safe):

```json
{ "settingKey": "pos.rounding_mode", "scopeType": "BRANCH",
  "scopeId": "…", "revision": 7, "value": "HALF_UP", "secret": false,
  "affectedScopeIds": ["…","…"] }
```

`affectedScopeIds` is the fan-out list the owner computes for a TENANT-scope write, so consumers
evict the derived branch/terminal keys without having to know the branch topology.

### 6.3 Cache miss — the question the brief asks, answered per setting

This is where 13-03's lesson must be applied *without* being over-applied.

**Entitlement (control plane) is settled and unchanged.** Tenant status, feature flags and quotas
fail closed on an unknown: `StatusResolution.UNKNOWN` → **503 `TENANT_STATUS_UNAVAILABLE`**, nothing
cached, one lever (`restaurantos.fail-open-on-platform-down`, default false) read in exactly one
place. `T-13-03-C` accepts the DoS: "refusing during an outage is the correct posture for a
suspension lever." **This design does not reopen that and does not add a second lever.**

**Configuration (config plane) is not one question, so it does not get one answer.** Collapsing
"could not determine a printer target" and "could not determine a tax rate" into a single policy is
the same mistake as `.defaultIfEmpty("ACTIVE")` — a default that is quietly an assertion. The
registry therefore declares an `Unresolved` policy **per key**, from a closed set of three:

| Policy | Behaviour on unresolvable | Legal for | Illegal for |
|---|---|---|---|
| `DEFAULT` | use the compiled-in registry default, log WARN with tenant+key | settings whose default is safe and boring: locale, date format, timezone (matching today's `BranchTimeZoneResolver`), receipt footer text | anything touching money, tax, or entitlement |
| `REFUSE` | fail the operation, **503** with a distinct code `SETTING_UNAVAILABLE` naming the key | tax profile, rounding mode, currency, service-charge rate, fiscal calendar, FBR credentials, quotas | anything on a path where refusing loses data (e.g. an ETL consumer) |
| `LAST_KNOWN` | serve the last value this process resolved, only within a declared staleness bound, then escalate to `REFUSE` | KDS routing, printer selection — settings where a slightly stale answer is strictly better than a stopped kitchen | anything that must be exactly right at the moment of use |

Three rules that keep this from degenerating:

1. **The policy is a property of the key, not of the service, not of the environment, and not of a
   property file.** There is no `restaurantos.settings.fail-open`. The 13-03 reasoning generalises
   exactly: two levers that can disagree give an operator a configuration nobody has tested. Changing
   a key's policy is a code change, reviewed, closure-tested, and diffable.
2. **An unresolved value is never written to the cache** — same rule, same reason, as
   `isFeatureEnabled` and `resolveAndCacheStatus`. Caching a `DEFAULT` fallback would turn a
   five-second blip into five minutes of a tenant's configuration silently not applying.
3. **`REFUSE` returns 503 and a distinct code, never 403 and never a fabricated value.** An operator
   must be able to tell "we could not tell" from "you may not"; a client must be able to tell a
   retryable outage from a settled decision. Verbatim the reasoning in
   `FeatureFlagGlobalFilter:156-161`.

**A worked example of why per-key matters.** `BranchTimeZoneResolver` runs inside an AMQP consumer
with no HTTP request. If user-service is down and the policy were `REFUSE`, the consumer would nack
and the event would eventually land on a DLQ — a *permanent* loss of a reporting fact to protect a
*cosmetic* bucketing decision. `DEFAULT` is correct there. If the same consumer needed
`finance.tax_profile` to compute a tax fact, `REFUSE` is correct, because a fact computed against a
guessed tax rate is worse than a fact that arrives late. One codebase, two right answers, and the
registry is where the difference is written down.

### 6.4 Redis key shapes (contract — changing one silently strands the others)

```
tset:{tenantId}:TENANT::{key}                 → JSON value      (300 s TTL)
tset:{tenantId}:BRANCH:{branchId}:{key}       → JSON value      (300 s TTL)
tset:{tenantId}:TERMINAL:{terminalId}:{key}   → JSON value      (300 s TTL)
```

The existing shapes are untouched and stay owned by their current writers:
`tenant:status:{t}`, `tenant_features:{t}:{code}`, `feature:{t}:{code}`, `tenant:nlq_quota:{t}`,
`nlq_quota:{t}:monthly_count`, `branch:tz:{branchId}`.

> Follow the precedent set in `FeatureFlagGlobalFilter:66-73` and put the key-shape constant in
> **one** shared class that both writer and readers import. That comment exists because a duplicated
> constant is what let the NLQ quota key drift and silently return a compiled-in limit.

---

## 7. Validation

Three layers, all inside the owner, all inside the write transaction.

### 7.1 Shape
JSON Schema from the registry. Rejects wrong types, unknown enum members, out-of-range integers,
and — via the closure test in §4.3 — any float where paisa is required. This alone would have
prevented `branches.currency_config` from accepting an arbitrary unparsed string
(`BranchService.java:54`).

### 7.2 Referential
The value names something that exists in the owner's database: a station id in `kds_stations`, an
account code in the chart of accounts, a printer id. Owner-local query; no cross-service call.

### 7.3 Invariant — an SPI, not a pile of `if`s

```java
public interface SettingInvariant {
    String name();                      // "ServiceModelVsOpenTill" — appears in the 409 body
    Set<String> appliesTo();            // setting keys
    void check(SettingWrite w, InvariantContext ctx) throws SettingInvariantViolation;
}
```

The brief's example, concretely:

```java
// pos-service
class ServiceModelVsOpenTill implements SettingInvariant {
    public Set<String> appliesTo() { return Set.of("pos.service_model"); }

    public void check(SettingWrite w, InvariantContext ctx) {
        if (!"COUNTER".equals(w.stringValue()) && !"QSR".equals(w.stringValue())) return;
        List<UUID> open = tillRepo.findOpenSessionIds(w.tenantId(), w.branchIdOrAll());
        if (!open.isEmpty()) {
            throw new SettingInvariantViolation(name(),
                "Cannot switch to " + w.stringValue() + " while " + open.size()
                + " till session(s) are OPEN. Close them first.", open);
        }
    }
}
```

`till_sessions` lives in `pos_db`; pos-service owns `pos.service_model`; the check runs in the same
transaction as the write and the write does not commit. **Rejected, not stored.** Response: `409`
with `{"error":{"code":"SETTING_INVARIANT_VIOLATED","invariant":"ServiceModelVsOpenTill",
"blocking":[...]}}`.

Other invariants that fall out of this pattern:

| Invariant | Owner | Refuses |
|---|---|---|
| `CurrencyImmutableAfterPosting` | finance | changing `org.currency_code` once any journal entry exists |
| `FiscalStartVsOpenPeriods` | finance | changing `finance.fiscal_year_start_month` while any period is OPEN |
| `RoundingModeVsOpenTill` | pos | changing `pos.rounding_mode` mid-shift |
| `RoutingRuleTargetsRealStation` | kitchen | a `kds.routing_rules` entry naming an unknown station |
| `ServiceChargeRequiresTaxProfile` | pos | a non-zero `pos.service_charge_pct_bps` with no tax treatment declared |

### 7.4 Cross-service invariants are forbidden as synchronous checks

`finance.fiscal_year_start_month` (finance) constrains `hr.tax_config.fiscal_year` (hr). Three legal
resolutions, in preference order:

1. **Move the setting** so one service owns both sides. Usually the right answer and the reason the
   ownership map in §3 is shaped the way it is.
2. **Subscribe and reconcile.** The dependent service consumes `TENANT_SETTING_CHANGED` and adjusts,
   or marks itself misconfigured.
3. **Surface a configuration conflict.** A `configuration_conflicts` row in the dependent service,
   projected into a tenant-visible "Configuration Health" panel, blocking the *operation* rather
   than the *setting write*.

Never a synchronous call. Two reasons, both from this repo's own history: a settings write that
depends on another service's availability fails for transport reasons while reporting a domain
error, and the project has already shipped exactly that shape — a compensating action that could
never fire because **Feign cannot send PATCH**. A cross-service validation hop is that bug with a
much larger surface.

---

## 8. Versioning, audit and rollback

**Two records, deliberately.**

| | `tenant_setting_revisions` | `audit_events` |
|---|---|---|
| Where | owner's DB, RLS | `audit_db`, partitioned, append-only |
| Purpose | operational history; powers the diff and restore UI | forensic/compliance record |
| Enforcement | no UPDATE/DELETE grants | already: `audit_writer` has no UPDATE/DELETE grants + a Postgres trigger (`AuditEventEntity` javadoc) |
| Retention | prunable per tenant policy | archival, `AuditArchivalService` |

They are not redundant: the revision table must be fast, local and joinable to the live row to render
a settings screen; the audit record must be immutable and must survive the owning service's data
being pruned. `audit_events` already has `before_state` and `after_state` JSONB columns, so a
`TENANT_SETTING_CHANGED` event lands there with no schema change — `AllEventsConsumer` already
consumes the bus.

**Who changed it.** `actor_type` + `actor_user_id` + `impersonated_by`, taken from JWT claims that
already exist. A SuperAdmin acting through impersonation produces one row naming both the target
user and the platform administrator — the D-34 rule.

**Rollback.** `POST /…/settings/{key}/revisions/{n}:restore`:
1. Read revision `n`'s `new_value`.
2. Run the **full write path** — schema, referential, invariants. A value that was valid in March is
   not necessarily valid today; restoring `pos.service_model = COUNTER` must still be refused while a
   till is open.
3. Write a **new** revision with `change_kind = RESTORE` and `reason = "restored from revision n"`.

History is never rewritten and a restore is never a `DELETE`. The revision counter is monotonic.

**Concurrency.** `version` + `If-Match`; mismatch is `409 SETTING_VERSION_CONFLICT` carrying the
current value so the UI can show a three-way diff. Without this, two managers with the settings page
open silently overwrite each other and the revision log shows two legitimate-looking writes.

---

## 9. Governance: who may change what

### 9.1 Three writer classes

| Class | Identity | Plane | Governs | Enforcement |
|---|---|---|---|---|
| **SuperAdmin** | `platform_users` row; JWT `token_type = PLATFORM` (`JwtSigningService:103-112`) | control | tier, features, quotas, `locked_by_platform` | platform token; tenant tokens rejected outright |
| **Tenant admin** | tenant JWT with permission `settings.tenant.write` | config, `TENANT` scope | service model, tax profile, fiscal calendar, branding, hours | permission + `maxScope` ceiling + `requiresStepUp` ⇒ assert `totp_verified` |
| **Branch manager** | tenant JWT with `settings.branch.write` **and a branch role on that branch** | config, `BRANCH`/`TERMINAL` scope | printers, KDS routing, that branch's hours | permission + **server-side** branch-role check |

The registry's `maxScope` is what makes this safe rather than advisory: `finance.tax_profile` has
`maxScope = TENANT`, so a branch manager cannot invent a branch-local tax rate no matter what
permissions they hold. The scope ceiling is checked before the permission, because a
scope violation is a modelling error and should read as `400`, not `403`.

> **Dependency / open risk.** Open task #11 in this repo is "SECURITY: close the branch-role
> assignment escalation before merge." Branch-scope settings writes inherit that risk directly: the
> branch id must be resolved from the caller's server-side branch-role assignments, never trusted
> from the request body. This design must not land before that is closed.

### 9.2 SuperAdmin over tenant settings

`locked_by_platform` gives the config plane what `tenant_features.is_override` gives the control
plane. When true: the tenant admin sees the control read-only with an explanation, the write path
returns `403 SETTING_PLATFORM_LOCKED`, and only a platform token can change or clear it. This is the
mechanism for "SuperAdmin pinned this tenant's rounding mode during a billing dispute" — and the
lock, its reason, and who set it are all in the revision log.

### 9.3 The line, stated plainly

- **Entitlement answers "may this tenant have this at all?"** — SuperAdmin, central, `platform_db`,
  fails closed. It is a commercial decision.
- **Configuration answers "given that they may, how does it behave?"** — tenant, federated, RLS,
  per-key unresolved policy. It is an operational decision.
- **Branch/terminal scope answers "and how does it behave *here*?"** — bounded by `maxScope`.

A setting that blurs the line is mis-modelled. `platform.quota.nlq_monthly` is entitlement (the
tenant bought 5,000 queries). `pos.printer.receipt_target` is configuration. `pos.service_model` is
configuration gated by an entitlement (`FEATURE_POS`), and the gateway already gates the route.

---

## 10. Migration from what exists

| Today | Action | Notes |
|---|---|---|
| `tenants.theme_config`, `tenants.email_config` | **drop** | dead (§1.2); becomes `org.branding.*`, `notify.email.*` |
| `tenant_features.config_json` | **drop** | dead (§1.2); per-feature config becomes registry keys |
| `branches.currency_config` | migrate → `org.currency_code`, `org.money_format` | never read; migration is mechanical and low-risk |
| `branches.receipt_config` | migrate → `org.receipt.branding` (BRANCH scope) | never read; same |
| `branches.timezone` | **keep the column**, mirror as `org.timezone` | `BranchTimeZoneResolver` and the internal DTO read it today; the column is the projection, the setting is the source. Cut over only after the resolver is switched. |
| `tenants.max_branches / max_users / storage_gb / nlq_quota` | → `tenant_quotas`, columns read-only for one release, then dropped | `TenantSubscriptionService` and `PlatformInternalController.getStatus` must switch first, or the gateway's quota path silently reverts to "undeterminable" |
| `hr.tax_config`, `attendance_policies` | **leave as first-class tables**; register a *pointer* key | these are versioned, effective-dated, multi-row structures. A JSONB blob would be a downgrade. The registry entry says "hr owns this, edit it here" so the settings UI can link to it. |
| `purchasing.tenant_match_tolerances`, `po_approval_tiers` | same treatment | |
| `crm.loyalty_tier_config` | same treatment | |
| `MoneyUtils.EN_PK` | read `org.locale` | requires threading a locale into a static utility — a real refactor, sized separately |
| `MoneyUtils.taxPerLine` (FLOOR) vs `OrderPricingCalculator.perLineTax` (HALF_UP) | pick one, driven by `pos.rounding_mode` | this is a **behaviour change** and needs a decision + regression test, not a silent unification |
| `AttendanceService.ZONE = systemDefault()`, `AttlogLineParser.DEVICE_ZONE` | read `org.timezone` / a device-scoped setting | |
| `frontend/lib/hooks/use-tenant-brand.ts` | replace | calls `fetch` directly, bypassing layers 1–2 of the 4-layer architecture |

**Not a "big bang".** The registry plus `shared-lib` machinery plus one owner (`org.*` in
user-service) is a complete, shippable slice. Every subsequent owner is additive and independent.

---

## 11. Frontend fit (4-layer architecture)

The ESLint boundary (`frontend/eslint.config.mjs:11-35`) restricts `components/**` from importing
`@/lib/api-client/**` or `@/lib/repositories/**`. Settings fits without exception:

| Layer | File | Responsibility |
|---|---|---|
| 1 api-client | `lib/api-client/schemas/settings.schema.ts` | zod for the envelope; `value` is `z.unknown()` here — its real shape comes from the registry slice the API returns |
| 2 repositories | `lib/repositories/settings.repository.ts` | one repository; the owner is derived from the key prefix via a compiled-in map |
| 3 adapters/models | `lib/adapters/settings.adapter.ts`, `lib/models/settings.model.ts` | `ResolvedSetting { key, value, source: 'TENANT'\|'BRANCH'\|'TERMINAL'\|'DEFAULT', version, editable, lockedByPlatform, schema }` |
| 3 hooks | `lib/hooks/settings/use-settings.ts`, `use-update-setting.ts`, `use-setting-revisions.ts` | React Query; keys registered in `lib/hooks/query-keys.ts` |
| 4 components | `components/settings/SettingsForm.tsx` etc. | renders **from the schema**, so a new setting needs no new component |

Two things to guard, both with precedent:

- **The prefix→owner map must not drift from the backend registry.** Guard it the way
  `frontend/__tests__/lib/nav-feature-flags.test.ts` already guards `FEATURE_FLAGS`: regex-scrape the
  Java source off the repo tree and compare. Note 13-03's finding about that test — it compares
  against a **union** and so cannot detect a code present in only one source. The settings guard must
  compare **set equality in both directions**, not membership in a union.
- **Provenance must be visible.** Every control shows whether the value came from this branch, the
  tenant, or the platform default, with a "reset to inherited" affordance that maps to
  `DELETE …?scope=BRANCH`, not to "set to empty". Without it, users cannot tell an override from an
  inheritance and will set branch-level values they meant to set once.

---

## 12. API surface

Mounted per owner, identical shape, one prefix per owner so the existing gateway routing and feature
gating apply unchanged.

```
GET    /api/v1/{owner}/settings?scope=BRANCH&scopeId=…&prefix=pos.
GET    /api/v1/{owner}/settings/{key}?scope=&scopeId=
PUT    /api/v1/{owner}/settings/{key}          If-Match: <version>
DELETE /api/v1/{owner}/settings/{key}?scope=BRANCH&scopeId=…      (remove override)
GET    /api/v1/{owner}/settings/{key}/revisions
POST   /api/v1/{owner}/settings/{key}/revisions/{n}:restore
GET    /api/v1/{owner}/settings/schema?prefix=                    (registry slice for the UI)

GET    /internal/{owner}/settings/resolve?tenant=&scope=&scopeId=&key=   (X-Internal-Service)

PUT    /api/v1/platform/tenants/{id}/quotas/{quotaKey}            (SuperAdmin)
PUT    /api/v1/platform/tenants/{id}/settings/{key}/lock          (SuperAdmin)
```

Gateway work: one new route, `/api/v1/org/**` → `lb://user-service`, **no** `RouteFeatureMap`
entry (core, ungated for ACTIVE tenants, consistent with `/api/v1/users/`). Every other settings
path already routes with its module and already inherits that module's feature gate — which is the
correct behaviour: a tenant without `FEATURE_KDS` should not be able to edit KDS settings.

`PATCH` is deliberately absent. `PlatformInternalController` uses `PATCH` for feature toggles and it
works there, but this project has been burned by **Feign being unable to send PATCH** on an internal
path. `PUT` with `If-Match` is the safer primitive and expresses the concurrency requirement anyway.

---

## 13. Test strategy (deltas only — the swarm's testing-strategy thread owns the rest)

| Test | Asserts | Would have caught |
|---|---|---|
| 4× closure tests (§4.3) | registry ↔ code ↔ auth catalogue ↔ frontend map | the five phantom-permission defects, the two phantom-feature defects |
| `SettingRlsIT` | a second tenant's GUC returns zero rows from `tenant_settings` and `tenant_setting_revisions` | cross-tenant config leak. **Must run as a non-superuser role** — open task #7 records that Testcontainers currently connects as superuser, which bypasses RLS and makes these tests vacuous |
| `SettingCacheMissPostureIT` | each `Unresolved` policy behaves as declared, with the owner genuinely stopped | a `REFUSE` key silently defaulting |
| `SettingRollbackCachePoisonIT` | a rolled-back write leaves **no** Redis entry | §1.8(a) — the live defect in `FeatureFlagAdminService` |
| `SettingCacheTtlTest` | every cache write carries a TTL | §1.8(b) |
| `SettingInvariantIT` | `pos.service_model` write refused with an OPEN till, and the row is unchanged afterwards | "stored, not rejected" |
| `SettingSecretNeverLeaksIT` | no `GET` returns a secret value; no outbox payload contains one | credential exposure |
| `SettingVersionConflictIT` | concurrent writes ⇒ one 409, not a silent overwrite | lost updates |

---

## 14. What I could not verify

Stated plainly, per the discipline note.

1. **No settings implementation exists to test.** Everything above is design. The only *executed*
   evidence is for the existing feature-flag/status path, which 13-03 proved live.
2. **The rollback-poisons-Redis defect (§1.8a) is read from source, not reproduced.** The code path is
   unambiguous — `@Transactional` method, `redis.opsForValue().set` in the body, no
   `TransactionSynchronization` anywhere in the class — but I did not run a failing transaction to
   observe the stale key.
3. **The missing TTL (§1.8b) is a direct source reading** and is not in doubt.
4. **`Order.serviceChargePaisa` never being written** was established by grepping `src/main` for
   `serviceCharge` and finding only the field declaration, the calculator parameter and the DTO. A
   reflective or native-SQL write would not appear; I saw no evidence of one.
5. **Per-service RLS coverage of the *new* tables is a plan, not a fact.** Several services still have
   `ENABLE` without `FORCE` (e.g. every table in `purchasing-service/.../V1__purchasing_schema.sql`;
   `pos-service/.../V7__stations.sql:18` explicitly notes "No FORCE ROW LEVEL SECURITY (deferred
   decision — matches existing tables)"). New settings tables must be `FORCE` from the first
   changeset; the pre-existing gap is out of scope here.
6. **`GET /internal/users/branches/{branchId}` returns a raw `BranchEntity`.** That means adding
   columns to `branches` changes an internal contract. reporting-service binds a narrow record
   (`UserInternalClient.BranchInternalDto`) so it tolerates additions, but I did not audit every
   consumer of that endpoint.
7. **Effort estimate is judgement, not measurement.**

---

## 15. Dependencies on parallel research threads

Referenced, not re-researched:

- **FBR e-invoicing** — owns the *content* of `fbr.*`: which credentials, which endpoints, sandbox
  vs production, invoice-number format. This document owns only their *storage* (`tenant_secrets`,
  encrypted, never cached, never in an event) and *governance* (tenant-admin + step-up).
- **POS thermal printing** — owns the shape of `pos.printer.*` and `org.receipt.*`. This document
  provides `TERMINAL` scope and `LAST_KNOWN` for them.
- **Biometric attendance** — `AttendanceDeviceEntity` already uses `EncryptedStringConverter`; device
  config is a candidate for a fourth `DEVICE` scope, deferred until that thread reports.
- **Cross-module integration gaps** — will name settings whose invariants span services; §7.4's three
  resolutions are the intended handling.
- **Current tenant configurability** — the audit companion to §1; if it disagrees with anything here,
  it is the authority on *what exists* and this document is the authority on *what to build*.
- **UI/UX visual direction & frontend component stack** — own the appearance of the settings screens;
  §11 owns only their layering and data contract.
- **Testing strategy** — owns the general approach; §13 lists only the deltas this model adds.

---

## 16. Effort

| Slice | Days |
|---|---|
| `shared-lib`: registry, SPI, resolver, cache, event, entities, 4 closure tests | 4 |
| platform-admin: `tenant_quotas`, `locked_by_platform`, revisions, SuperAdmin endpoints, `TierLimits` cutover | 3 |
| user-service `org.*`: tables, migrate the two branch columns, invariants, API, `/api/v1/org` route | 4 |
| Rollout to pos, finance, kitchen, inventory, purchasing, hr (~1.5 d each) | 9 |
| Gateway route + unresolved-policy wiring + fixing §1.8(a)/(b) | 2 |
| Frontend layers 1–4 + schema-driven form renderer + settings pages + drift guard | 6 |
| Tests: RLS (non-superuser), cache-miss postures, invariants, secrets, concurrency | 4 |
| **Total** | **32** |

Minimum shippable backbone — `shared-lib` + platform-admin + `org.*` + frontend + tests — is **~17
days** and is the slice that unblocks every other adaptivity design.
