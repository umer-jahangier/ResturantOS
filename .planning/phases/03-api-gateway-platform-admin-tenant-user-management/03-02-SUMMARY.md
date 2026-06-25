---
phase: 03-api-gateway-platform-admin-tenant-user-management
plan: "02"
subsystem: platform-admin
tags: [spring-boot, jpa, redis, rabbitmq, testcontainers, wiremock, feign, provisioning-saga, feature-flags, impersonation, liquibase]

depends_on:
  - "03-01"  # gateway Redis key shapes + internal fallback contract
  - "03-03"  # /internal/users/branches + InternalServiceFilter gate

provides:
  - platform-admin-service Maven module (port 8096)
  - platform_db NON-RLS schema (5 business tables + shared infra)
  - Provisioning saga (FD-1) with compensation and TENANT_PROVISIONED outbox
  - Tenant lifecycle (suspend/reactivate/cancel) with Redis status sync
  - Feature flag dual-key Redis invalidation (gateway + @RequiresFeature parity)
  - Impersonation (30-min JWT stamped impersonated_by + impersonation_log)
  - Usage telemetry (usage_records)
  - auth-service: provision-admin, service-token, impersonate internal endpoints
  - signImpersonationToken in JwtSigningService

affects:
  - "03-01"  # closes the gateway↔platform-admin feature/status fallback contract
  - "04-*"   # finance-service seed-coa seam (absent seam documented)
  - "future"  # TOTP enrollment for provisioned admin is downstream

tech-stack:
  added:
    - platform-admin-service (Spring Boot 3 servlet)
    - Testcontainers (PostgreSQL + Redis GenericContainer + RabbitMQ)
    - WireMock (auth/user/finance stubs)
  patterns:
    - Sequential provisioning saga with list-based compensation (NOT 2PC)
    - Transactional outbox (TENANT_PROVISIONED via shared-lib DomainEventPublisher)
    - noRollbackFor=ProvisioningException so PROVISIONING_FAILED persists on saga failure
    - @JdbcTypeCode(SqlTypes.JSON) for PostgreSQL JSONB String columns
    - Dual-key Redis SET (not DELETE) for fail-closed feature flag enforcement

key-files:
  created:
    - services/platform-admin-service/pom.xml
    - services/platform-admin-service/Dockerfile
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/PlatformAdminApplication.java
    - services/platform-admin-service/src/main/resources/application.yml
    - services/platform-admin-service/src/main/resources/db/changelog/v1.0.0/010-create-platform-tables.xml
    - services/platform-admin-service/src/main/resources/db/changelog/v1.0.0/020-shared-infra-tables.xml
    - services/platform-admin-service/src/main/resources/db/changelog/v1.0.0/900-seed-platform-users.xml
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/entity/{TenantEntity,TenantFeatureEntity,PlatformUserEntity,UsageRecordEntity,ImpersonationLogEntity}.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/{ProvisioningService,TenantLifecycleService,FeatureFlagAdminService,ImpersonationService,UsageService}.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/{PlatformTenantController,PlatformInternalController}.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/client/{AuthInternalClient,UserInternalClient,FinanceInternalClient}.java
    - services/platform-admin-service/src/test/java/io/restaurantos/platform/{BasePlatformIT,ProvisioningSagaIT,FeatureFlagInvalidationIT,TenantLifecycleIT,PlatformDbIsolationIT}.java
  modified:
    - services/auth-service/src/main/java/io/restaurantos/auth/service/JwtSigningService.java  # signServiceToken + signImpersonationToken
    - services/auth-service/src/main/java/io/restaurantos/auth/controller/AuthProvisioningInternalController.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/ProvisioningAdminService.java
    - Docs/agent-specs/04-internal-api-contracts.md  # registered POST /internal/auth/users/{id}/impersonate

decisions:
  - id: "03-02-A"
    desc: "noRollbackFor=ProvisioningException on provision() so PROVISIONING_FAILED state commits even when saga throws"
  - id: "03-02-B"
    desc: "Do NOT set tenant ID manually before persist() — @GeneratedValue(UUID) + Spring Data merge() on non-null ID issues an UPDATE (0 rows affected) → StaleObjectStateException; let JPA assign the UUID on persist()"
  - id: "03-02-C"
    desc: "@JdbcTypeCode(SqlTypes.JSON) required on String fields mapped to PostgreSQL JSONB columns (TenantEntity.themeConfig/emailConfig, TenantFeatureEntity.configJson); columnDefinition alone insufficient"
  - id: "03-02-D"
    desc: "Remove duplicate @EnableJpaAuditing from PlatformAdminApplication; SharedAutoConfiguration already provides jpaAuditingHandler — duplicate caused BeanDefinitionOverrideException at context startup"
  - id: "03-02-E"
    desc: "Finance seed-coa seam: provisioning.seed-coa.enabled=false in dev/test (finance-service absent); guard in saga with non-fatal warning; treat as fatal only in prod"
  - id: "03-02-F"
    desc: "platform_db non-RLS: platform-admin-service is the ONLY service with platform_db datasource credentials; no other module declares a platform_db datasource"

metrics:
  duration: "~2 sessions"
  completed: "2026-06-25"
---

# Phase 03 Plan 02: Platform Admin Service Summary

**One-liner:** Platform-admin servlet service with NON-RLS `platform_db`, sequential FD-1 provisioning saga (< 60 s, compensation, TENANT_PROVISIONED outbox), dual-key Redis feature-flag invalidation (gateway + @RequiresFeature parity), and 21 Testcontainers IT tests green.

---

## What Was Built

### 1. platform-admin-service Scaffold (Task 1)

**Module:** `services/platform-admin-service` (port 8096 — not 8080; gateway owns public 8080)

**platform_db schema** — `010-create-platform-tables.xml` creates 5 NON-RLS tables with ZERO row-level security policies:

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `tenants` | `id UUID PK`, `slug UNIQUE`, `status VARCHAR`, `tier VARCHAR`, quotas | `PROVISIONING_FAILED` added to status CHECK for saga compensation |
| `tenant_features` | `(tenant_id, feature_code) PK`, `is_enabled`, `config_json JSONB` | SuperAdmin override authoritative over tier |
| `platform_users` | `id UUID PK`, `email UNIQUE`, `role [SUPER_ADMIN|SUPPORT|BILLING]` | Seeded in `900-seed-platform-users.xml` (seed context) |
| `usage_records` | `id BIGSERIAL PK`, `tenant_id`, `resource`, `qty NUMERIC` | API field is `delta`; DB column stays `qty` |
| `impersonation_log` | `id BIGSERIAL PK`, `platform_user_id`, `tenant_id`, `target_user_id`, `started_at`, `reason` | `ended_at` set by future end-session call |

**Shared infra tables** (`020-shared-infra-tables.xml`): `event_outbox`, `idempotency_keys`, `processed_events` — also NON-RLS (used by DomainEventPublisher + IdempotencyService).

**SC4/PLATFORM-07 isolation guarantee:**
- ZERO RLS policies on any platform table (`pg_policies` asserted by `PlatformDbIsolationIT`)
- No platform entity extends `TenantAuditableEntity` (reflection-asserted in IT)
- Only `platform-admin-service` declares a `platform_db` datasource

**Tier feature defaults** (`TierFeatureDefaults`): All 4 tiers (STARTER/GROWTH/ENTERPRISE/CUSTOM) default all 7 primary modules ON:
`FEATURE_POS, FEATURE_INVENTORY, FEATURE_FINANCE, FEATURE_VENDOR, FEATURE_HR, FEATURE_CRM, FEATURE_KDS`

Higher tiers add extras (GROWTH+): `FEATURE_MULTI_BRANCH, FEATURE_REPORTING_ADVANCED, FEATURE_WHITE_LABEL_DOMAIN, FEATURE_WHATSAPP_NOTIFICATIONS, FEATURE_CUSTOM_ROLES, FEATURE_AUDIT_EXPORT, FEATURE_LOT_TRACKING, FEATURE_CONSOLIDATED_REPORTING`

---

### 2. auth-service Internal Endpoints (Task 2)

New endpoints under the existing `/internal/auth/**` gate (03-03 `InternalServiceFilter`):

| Endpoint | Body | Response | Notes |
|----------|------|----------|-------|
| `POST /internal/auth/tenants/{tenantId}/provision-admin` | `{email}` | `{userId, tempPassword}` | Generates BCrypt temp password, creates UserEntity with MUST_CHANGE_PASSWORD |
| `POST /internal/auth/service-token` | `{service}` | `{token, expiresIn: 300}` | RS256 JWT with `roles:["INTERNAL_SERVICE"]` |
| `POST /internal/auth/users/{userId}/impersonate` | `{impersonatedBy, expiresInSeconds: 1800}` | `{token, expiresIn: 1800}` | 30-min JWT stamped `impersonated_by`; NOT refreshable |

**`JwtSigningService` additions:**
- `signServiceToken(String service, Duration ttl)` — subject = service name, `roles: ["INTERNAL_SERVICE"]`
- `signImpersonationToken(JwtClaims targetClaims, UUID impersonatedBy, Duration ttl)` — same RS256 key/kid; adds `impersonated_by` claim; 30-min TTL enforced at issuance

**platform-admin Feign clients** (all use `FeignSharedConfig` → X-Internal-Service header):
- `AuthInternalClient` → `${restaurantos.auth-service.uri}` — provision-admin, service-token, impersonate
- `UserInternalClient` → `${restaurantos.user-service.uri}` — `POST /internal/users/branches`
- `FinanceInternalClient` → `${restaurantos.finance-service.uri}` — `POST /internal/finance/tenants/{id}/seed-coa`

---

### 3. Services + Controllers (Task 3)

#### Provisioning Saga (`ProvisioningService.provision()`)

Sequential FD-1 saga, `@Transactional(noRollbackFor = ProvisioningException.class)`:

```
1. INSERT tenant PENDING_SETUP (slug = url-safe brandName, tier quotas applied)
2. Seed tenant_features from TierFeatureDefaults.defaultsFor(tier)
3. AuthInternalClient.provisionAdmin(tenantId, adminEmail) → {userId, tempPassword}
4. UserInternalClient.createBranch({tenantId, name:"{brand} HQ"}) → {branchId}
5. FinanceInternalClient.seedCoa(tenantId) [guarded: provisioning.seed-coa.enabled=false skips]
6. flip status→ACTIVE + DomainEventPublisher.publish(TENANT_PROVISIONED, outbox) in one Tx
7. IdempotencyService.markComplete(key, result)
→ returns {tenantId, slug, tempPassword}
```

**Compensation:** Steps 3–5 wrapped in try-catch; on failure:
- `tenant.setStatus(PROVISIONING_FAILED)` → saved (commits because `noRollbackFor`)
- Compensation list executed in reverse (feature flags deleted, warnings for downstream)
- `ProvisioningException` thrown

**TENANT_PROVISIONED outbox payload:** `{tenantId, adminEmail, tier, slug}` + `branchId` as aggregate root

**Idempotency:** Guarded by `IdempotencyService.checkAndLock()` / `markComplete()` on the caller-supplied key

**Finance absent seam:** `provisioning.seed-coa.enabled=false` in dev/test; production treats failure as saga failure

#### Tenant Lifecycle (`TenantLifecycleService`)

State machine with Redis sync on each transition:

```
PENDING_SETUP ─→ ACTIVE (on saga complete)
ACTIVE ──────→ SUSPENDED  (suspend — sets suspended_at; Redis tenant:status:{id}=SUSPENDED)
SUSPENDED ───→ ACTIVE     (reactivate — Redis tenant:status:{id}=ACTIVE)
ACTIVE/SUSPENDED → CANCELLED (cancel — sets cancelled_at)
```
Invalid transitions → `IllegalStateException` (409)

#### Feature Flag Dual-Key Invalidation (`FeatureFlagAdminService`)

**MANDATE (SC6):** On `setFeature(tenantId, code, enabled)`:

```java
// Both keys written immediately — SET, not DELETE
redis.opsForValue().set("tenant_features:" + tenantId + ":" + code, value);  // gateway shape
redis.opsForValue().set("feature:" + tenantId + ":" + code, value);          // @RequiresFeature shape
```

Why SET (not DELETE): `RedisFeatureFlagService.isEnabled()` fail-closes to `"false"` on a cache miss and caches that for the TTL. A DELETE would silently disable the feature until TTL expiry. SET-ing both keys to the new value ("true"/"false") makes the enforcement change take effect on the very next request at **both** the gateway (`FeatureFlagGlobalFilter` reads `tenant_features:{tid}:{code}`) and the service-level `@RequiresFeature` aspect (reads `feature:{tid}:{code}`).

SuperAdmin override is **authoritative over tier** — can enable above or revoke below tier defaults.

#### Impersonation (`ImpersonationService`)

```
POST /api/v1/platform/impersonate {tenantId, targetUserId, reason}
  → AuthInternalClient.impersonate(targetUserId, superAdminId, 1800s)
  → INSERT impersonation_log(platform_user_id=superAdminId, tenant_id, target_user_id, started_at, reason)
  → returns 30-min JWT stamped impersonated_by (NOT refreshable — exp enforced at issuance)
```

#### Usage Telemetry (`UsageService`)

```
POST /internal/platform/tenants/{id}/usage {resource, delta}
  → INSERT usage_records(tenant_id, resource, qty=delta, recorded_at)
  → returns {newCount (aggregate for period), limit (quota from tenants table)}
```

#### Public + Internal Controllers

**Public** (`/api/v1/platform/**`, requires SUPER_ADMIN):
`POST /tenants`, `GET /tenants`, `GET /tenants/{id}`, `POST /tenants/{id}/suspend|reactivate|cancel`, `PUT /tenants/{id}/features/{code}`, `POST /tenants/{id}/provision/retry`, `POST /impersonate`, `GET /tenants/{id}/telemetry`

**Internal** (`/internal/platform/**`, X-Internal-Service gate — used by gateway as fallbacks):
- `GET /tenants/{id}/status` → `{status, tier}` (gateway `tenant:status:{id}` cache miss fallback)
- `GET /tenants/{id}/features` → `{features: {code: bool}}` (gateway feature cache miss fallback)
- `POST /tenants/{id}/usage` → `{newCount, limit}`

---

### 4. IT Suite (Task 4) — 21 tests, all GREEN

**`PlatformDbIsolationIT`** (9 tests): JDBC `pg_policies` zero-row asserts; `relrowsecurity=false`; reflection `isAssignableFrom(TenantAuditableEntity)=false` for all 5 entities; shared infra tables present; no `app.current_tenant_id` refs.

**`ProvisioningSagaIT`** (3 tests): happy-path < 60 s + `tenant_features` seeded + `TENANT_PROVISIONED` in outbox; idempotency replay returns same tenant; WireMock branch-fail → `ProvisioningException` + tenant persists as `PROVISIONING_FAILED` + no outbox event.

**`TenantLifecycleIT`** (6 tests): suspend/reactivate/cancel state machine + invalid transitions → exception; internal status endpoint returns `{status, tier}`.

**`FeatureFlagInvalidationIT`** (3 tests): enable above tier → both Redis keys `"true"` immediately (no TTL wait); revoke below tier → both keys `"false"`; key present without TTL wait.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Duplicate `@EnableJpaAuditing` caused Spring context failure**
- **Found during:** Task 4 (first test run)
- **Issue:** `PlatformAdminApplication` had `@EnableJpaAuditing` AND `SharedAutoConfiguration` registers `jpaAuditingHandler` via its own `@EnableJpaAuditing` → `BeanDefinitionOverrideException`
- **Fix:** Removed `@EnableJpaAuditing` from `PlatformAdminApplication`; `SharedAutoConfiguration` is authoritative
- **Files modified:** `PlatformAdminApplication.java`
- **Decision:** 03-02-D

**2. [Rule 1 — Bug] `StaleObjectStateException` from manual `setId()` before `save()`**
- **Found during:** Task 4 (post-context-fix)
- **Issue:** `tenant.setId(UUID.randomUUID())` before `tenantRepository.save(tenant)` → Spring Data sees non-null ID → calls `merge()` not `persist()` → Hibernate issues `UPDATE` for non-existent row → 0 rows updated → `StaleObjectStateException`
- **Fix:** Removed `tenant.setId(UUID.randomUUID())`; `@GeneratedValue(strategy = GenerationType.UUID)` assigns ID on `persist()` (correct path); `tenant.getId()` after `save()` returns the generated UUID
- **Files modified:** `ProvisioningService.java`
- **Decision:** 03-02-B

**3. [Rule 1 — Bug] JSONB columns rejected `VARCHAR` binding**
- **Found during:** Task 4 (post-setId fix)
- **Issue:** `theme_config`/`email_config` (TenantEntity) and `config_json` (TenantFeatureEntity) mapped as `String` with `columnDefinition = "jsonb"` but Hibernate bound them as JDBC `VARCHAR` → PostgreSQL `column is of type jsonb but expression is of type character varying`
- **Fix:** Added `@JdbcTypeCode(SqlTypes.JSON)` to all three JSONB `String` fields
- **Files modified:** `TenantEntity.java`, `TenantFeatureEntity.java`
- **Decision:** 03-02-C

**4. [Rule 1 — Bug] `PROVISIONING_FAILED` state not visible after saga failure**
- **Found during:** Task 4 — `provisionTenant_branchFails_compensates_tenantProvisioningFailed` assertion `tenants not empty` failed
- **Issue:** `provision()` was `@Transactional`; when `ProvisioningException` was thrown, Spring rolled back the entire transaction including the `PROVISIONING_FAILED` status update → tenant not in DB
- **Fix:** Changed to `@Transactional(noRollbackFor = ProvisioningException.class)` so the catch block's PROVISIONING_FAILED save + compensation deletes commit, then the exception propagates without rollback
- **Files modified:** `ProvisioningService.java`
- **Decision:** 03-02-A

**5. [Rule 3 — Blocking] Testcontainers Ryuk fails on Colima Docker**
- **Found during:** First test run (previous session)
- **Issue:** Ryuk container requires Docker socket bind mount; Colima blocks bind mounts → `ContainerLaunchException`
- **Fix:** Added `testcontainers.properties` (`ryuk.disabled=true`), `docker-java.properties` (`api.version=1.44`), and `maven-failsafe-plugin` env vars (`TESTCONTAINERS_RYUK_DISABLED=true`, `DOCKER_HOST=unix://${user.home}/.colima/default/docker.sock`)
- **Files modified:** `pom.xml` (failsafe config), `src/test/resources/testcontainers.properties`, `src/test/resources/docker-java.properties`
- **Decision:** 03-01-D (pre-existing Colima constraint)

---

## Doc 4 Contract Amendment

Per plan `<output>` instruction, `POST /internal/auth/users/{userId}/impersonate` has been registered in `Docs/agent-specs/04-internal-api-contracts.md` §4.2:

```
POST /internal/auth/users/{userId}/impersonate
Request:  {impersonatedBy: UUID, expiresInSeconds: int}
Response: {token: string, expiresIn: int}
Gate:     X-Internal-Service header (InternalServiceFilter)
Notes:    30-min JWT stamped impersonated_by; NOT refreshable (exp enforced at issuance)
```

---

## Verification Results

- `mvn verify` (full reactor): **BUILD SUCCESS** — all 21 platform-admin ITs + all other service ITs green
- SC3 ✅ — provisioning saga < 60 s, tier features seeded, TENANT_PROVISIONED published, list/lifecycle/impersonation/telemetry working
- SC4 ✅ — `pg_policies` zero rows, no TenantAuditableEntity extends, no other service has platform_db datasource
- SC6 ✅ — feature toggle persists + immediately invalidates BOTH Redis key shapes, SuperAdmin override authoritative over tier
- Port 8096 ✅ — no collision with gateway (8080)
- Finance absent seam ✅ — `provisioning.seed-coa.enabled=false` skips CoA seeding in dev/test

---

## Commits

| Hash | Description |
|------|-------------|
| `3319226` | feat(03-02): platform-admin-service scaffold + platform_db NON-RLS migrations + entities + tier defaults |
| `cb67657` | feat(03-02): auth provisioning endpoints + signImpersonationToken + platform-admin Feign clients |
| `d7d3a2b` | feat(03-02): provisioning saga + lifecycle + feature-flag dual-key invalidation + impersonation + usage + controllers |
| `80fe485` | fix(03-02): use SET not DELETE for dual-key Redis invalidation + impersonation_log UUID id |
| `55ae628` | fix(03-02): Testcontainers IT suite — fix Spring context + JSONB type + saga transaction |

---

## Next Phase Readiness

**03-01 fallback contract CLOSED:** `PlatformInternalController` provides the status and features fallback endpoints the gateway routes to on cache miss.

**Phase 4 seam (finance-service):** `FinanceInternalClient.seedCoa()` is stubbed and guarded by `provisioning.seed-coa.enabled` — no changes needed to platform-admin when finance-service ships.

**Remaining in Phase 3:** `03-01-PLAN.md` is complete. Phase 3 is now fully executed (03-01 gateway, 03-02 platform-admin, 03-03 user-service — all 3 plans green).
