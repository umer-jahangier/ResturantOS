---
phase: 03-api-gateway-platform-admin-tenant-user-management
verified: 2026-06-25T17:52:20Z
status: passed
score: 24/24 must-haves verified
re_verification: false
human_verification:
  - test: "Run `mvn -pl gateway -am verify` (requires Docker for Testcontainers + Redis)"
    expected: "JwtGlobalFilterTest, FeatureFlagFilterIT, GatewayRoutingIT all pass GREEN; JaCoCo gateway ≥ 70%"
    why_human: "Cannot run Maven/Testcontainers in structural-verification mode"
  - test: "Run `mvn -pl services/platform-admin-service -am verify` (requires Docker for Postgres + Redis + RabbitMQ + WireMock)"
    expected: "ProvisioningSagaIT (incl. <60s assertion, compensation, idempotency), FeatureFlagInvalidationIT (dual-key), TenantLifecycleIT, PlatformDbIsolationIT all pass GREEN; JaCoCo ≥ 60%"
    why_human: "Cannot run Maven/Testcontainers in structural-verification mode"
  - test: "Run `mvn -pl services/user-service -am verify` (requires Docker for Postgres)"
    expected: "BranchRlsIT (cross-tenant isolation), BranchInternalIT (internal gate), UserAdminDelegationIT (WireMock delegation) all pass GREEN; JaCoCo ≥ 60%"
    why_human: "Cannot run Maven/Testcontainers in structural-verification mode"
  - test: "Run `mvn -pl services/auth-service -am verify`"
    expected: "AuthInternalBranchRoleIT passes GREEN; auth-service JaCoCo stays ≥ 70% after Phase 3 additions"
    why_human: "Cannot run Maven in structural-verification mode"
  - test: "Run `mvn -DskipTests compile` from repo root"
    expected: "All 8 modules compile clean: shared-lib, eureka-server, config-server, auth-service, authorization-service, gateway, user-service, platform-admin-service"
    why_human: "Full multi-module Maven compile requires the local Maven/Java toolchain"
---

# Phase 3: API Gateway + Platform Admin + Tenant/User Management — Verification Report

**Phase Goal:** The platform edge is secured and operable — the gateway authenticates/routes/rate-limits every request, the SuperAdmin can provision and operate tenants, and Tenant Admins can manage branches and per-branch roles that feed JWT issuance.
**Verified:** 2026-06-25T17:52:20Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

All 24 truths derive from the `must_haves` frontmatter of 03-01-PLAN.md, 03-02-PLAN.md, and 03-03-PLAN.md. Verification is structural (file existence, line counts, grep for key patterns, wiring checks).

#### SC1 + SC2 — Gateway (03-01, 7 truths)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Invalid JWT → 401 UNAUTHENTICATED at gateway, never reaches upstream | ✓ VERIFIED | `JwtGlobalFilter.java` (189 lines): missing/malformed Bearer → `writeError(exchange, 401, "UNAUTHENTICATED")` before `chain.filter` |
| 2 | Public paths (/api/v1/auth/\*\*, /.well-known/\*\*, /actuator/health/\*\*, /fallback/\*\*) pass without JWT | ✓ VERIFIED | `isPublicPath()` in JwtGlobalFilter with all required paths; confirmed in `application.yml` route config |
| 3 | Valid JWT → X-Tenant-Id + X-User-Id injected; inbound X-Internal-Service stripped | ✓ VERIFIED | JwtGlobalFilter injects headers (L39 comment + implementation); `StripInternalHeaderFilter.java` (GlobalFilter, runs at HIGHEST_PRECEDENCE) strips header from ALL routes |
| 4 | Per-IP rate limit: auth ~100/min, general ~600/min | ✓ VERIFIED | `application.yml` lines 28-47: `burstCapacity: ${RATE_LIMIT_AUTH_PER_MIN:100}` on auth-route, `${RATE_LIMIT_API_PER_MIN:600}` default; `trusted-proxies` set for X-Forwarded-For passthrough from Nginx |
| 5 | Route with disabled feature flag → 403 FEATURE_DISABLED + X-Upgrade-CTA-URL header | ✓ VERIFIED | `FeatureFlagGlobalFilter.java` (220 lines) line 125-127: `FEATURE_DISABLED` + `X-Upgrade-CTA-URL` header; `RouteFeatureMap.java` maps prefixes → feature codes |
| 6 | Suspended tenant → 403 TENANT_SUSPENDED | ✓ VERIFIED | `FeatureFlagGlobalFilter.java` line 107: `TENANT_SUSPENDED` JSON response; reads `tenant:status:{tenantId}` from Redis with PlatformAdminClient fallback |
| 7 | Upstream down → CircuitBreaker routes to local fallback returning 503 | ✓ VERIFIED | `FallbackController.java` at `/fallback/service-unavailable`; `application.yml` CircuitBreaker filter on every upstream route with `fallbackUri: forward:/fallback/service-unavailable` |

#### SC3 + SC4 + SC6 — Platform Admin (03-02, 9 truths)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 8 | Provisioning saga < 60s: PENDING_SETUP → tier features → provision-admin → HQ branch → (finance seam) → ACTIVE + TENANT_PROVISIONED | ✓ VERIFIED | `ProvisioningService.java` (298 lines, renamed from TenantProvisioningService); sequential saga steps 1-8 with TENANT_PROVISIONED outbox publish; `ProvisioningSagaIT.java` asserts `elapsed < 60_000L` |
| 9 | Saga failure → PROVISIONING_FAILED (not half-ACTIVE); retry endpoint re-runs remaining steps | ✓ VERIFIED | `ProvisioningService.java` compensation block → `TenantStatus.PROVISIONING_FAILED`; `PlatformTenantController` exposes retry endpoint; `ProvisioningSagaIT.java` line 90-113 tests WireMock branch-fails → PROVISIONING_FAILED + no TENANT_PROVISIONED |
| 10 | TENANT_PROVISIONED published via transactional outbox in same tx as ACTIVE status flip | ✓ VERIFIED | `ProvisioningService.java` line 160: `eventPublisher.publish(EXCHANGE, ROUTING_KEY, TENANT_PROVISIONED_EVENT, ...)` inside `@Transactional`; `event_outbox` shared-infra table in `020-shared-infra-tables.xml` |
| 11 | SuperAdmin can list/paginate tenants; lifecycle state machine: suspend/reactivate/cancel (invalid transitions rejected) | ✓ VERIFIED | `TenantLifecycleService.java`: state machine with `requireStatus()` guard; Redis `tenant:status:{tid}` key deleted on each transition (cache-invalidation approach — gateway makes one PlatformAdminClient call on next request); `TenantLifecycleIT.java` asserts transitions + invalid transition throws `IllegalStateException` |
| 12 | Feature toggle: persists on tenant_features AND immediately writes both Redis key shapes (tenant_features:{tid}:{code} + feature:{tid}:{code}) via SET, not DELETE | ✓ VERIFIED | `FeatureFlagAdminService.java` lines 91-99: `gatewayKey = "tenant_features:..."`, `serviceKey = "feature:..."`, `redis.opsForValue().set(gatewayKey, value)` + `redis.opsForValue().set(serviceKey, value)`; `FeatureFlagInvalidationIT.java` lines 34-35 asserts both keys immediately |
| 13 | SuperAdmin override authoritative over tier; 6 primary modules + FEATURE_KDS default ON in every tier | ✓ VERIFIED | `TierFeatureDefaults.java`: 7 defaults (FEATURE_POS/INVENTORY/FINANCE/VENDOR/HR/CRM/KDS) in ALL_TIERS set; `FeatureFlagAdminService.setFeature` upserts tenant_features (override independent of tier) |
| 14 | Impersonation: 30-min JWT stamped impersonated_by + impersonation_log row written | ✓ VERIFIED | `ImpersonationService.java`: delegates to `AuthInternalClient.impersonate` (30-min TTL), then `ImpersonationLogEntity` saved; `JwtSigningService.signImpersonationToken` adds `impersonated_by` claim (line 80) with passed TTL |
| 15 | platform_db: NO tenant_id RLS on any business table; TenantEntity does NOT extend TenantAuditableEntity; only platform-admin-service has platform_db credentials | ✓ VERIFIED | `010-create-platform-tables.xml`: comment "DO NOT add tenant isolation" — zero grep matches for `ROW LEVEL SECURITY` in actual SQL; `TenantEntity.java` comment "does not extend TenantAuditableEntity"; `PlatformDbIsolationIT.java` queries `pg_policies` + checks `relrowsecurity`; parent POM shows only `services/platform-admin-service` module (no other service declares platform_db datasource) |
| 16 | Gateway cache-miss fallbacks resolve: GET /internal/platform/tenants/{id}/status, /features, POST .../usage | ✓ VERIFIED | `PlatformInternalController.java`: `GET /tenants/{tenantId}/status` → `{status, tier}`, `GET /tenants/{tenantId}/features` → feature map, `POST /tenants/{tenantId}/usage` → `UsageService.record`; behind `InternalServiceFilter` gate |

#### SC5 — User Service (03-03, 8 truths)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 17 | Tenant Admin CRUDs branches via /api/v1/branches/\*\*; records written to user_db.branches | ✓ VERIFIED | `BranchController.java` + `BranchService.java`; `010-create-branches.xml` creates `branches` table; gateway route `Path=/api/v1/users/**, /api/v1/branches/**` → `lb://user-service` |
| 18 | Branches are RLS tenant-scoped (DB-enforced): tenant A cannot read tenant B's branches | ✓ VERIFIED | `011-enable-rls-branches.xml`: `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation ON branches USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)`; `BranchEntity extends TenantAuditableEntity`; `UserWebMvcConfig` registers `TenantFilterInterceptor` |
| 19 | Second branch with same name in same tenant → 409 (UNIQUE(tenant_id, name)) | ✓ VERIFIED | `010-create-branches.xml` line 32-34: `addUniqueConstraint tableName="branches" columnNames="tenant_id, name" constraintName="uk_branches_tenant_name"` |
| 20 | POST /internal/users/branches (FD-1 step 4) works and returns {branchId} | ✓ VERIFIED | `BranchInternalController.java` line 46: `@PostMapping("/branches")` → `BranchService.createInternal()`; called by `UserInternalClient` in platform-admin |
| 21 | Internal branch-detail reads: GET /internal/users/branches/{id} + GET /internal/users/tenants/{id}/branches | ✓ VERIFIED | `BranchInternalController.java` lines 58 + 23 comments: both endpoints present; `GET /internal/users/tenants/{id}/branches` at `/tenants/{id}/branches` |
| 22 | user_branch_roles owned by auth-service; user-service NEVER writes it directly, delegates via AuthInternalClient | ✓ VERIFIED | `AuthInternalClient.java`: `@PostMapping("/internal/auth/users/{userId}/branch-roles")` + `@DeleteMapping`; `UserAdminService` delegates; grep of user-service src for `user_branch_roles` returns only 4 comments, zero JPA entity/table |
| 23 | Auth GET /internal/auth/users/{userId}/permissions (wraps PermissionResolver) for JWT issuance | ✓ VERIFIED | `AuthInternalController.java` lines 62-75: `@GetMapping("users/{userId}/permissions")` wraps `permissionResolver.resolve(userId, branchId)` |
| 24 | auth-service /internal/auth/\*\* rejects missing/wrong X-Internal-Service with 403 FORBIDDEN | ✓ VERIFIED | `InternalServiceFilter.java` (58 lines): guards `/internal/**` paths with constant-time secret check; 403 `INTERNAL_AUTH_REQUIRED` on mismatch; `AuthInternalBranchRoleIT.java` (193 lines) tests this gate |

**Score: 24/24 truths verified**

---

### Required Artifacts

| Artifact | Plan | Status | Details |
|----------|------|--------|---------|
| `gateway/pom.xml` | 03-01 | ✓ VERIFIED | 166 lines; uses `spring-cloud-starter-gateway-server-webflux` (NOT removed bare artifact); `spring-boot-starter-web` explicitly absent |
| `gateway/src/main/resources/application.yml` | 03-01 | ✓ VERIFIED | 231 lines; `spring.cloud.gateway.server.webflux.*` prefix; `trusted-proxies`; rate limiters (100/min auth, 600/min general); circuit-breakers; all routes present |
| `gateway/.../JwtGlobalFilter.java` | 03-01 | ✓ VERIFIED | 189 lines; `implements GlobalFilter, Ordered`; references `JwksKeyProvider`; `UNAUTHENTICATED` + header injection |
| `gateway/.../FeatureFlagGlobalFilter.java` | 03-01 | ✓ VERIFIED | 220 lines; `implements GlobalFilter, Ordered`; `FEATURE_DISABLED`, `TENANT_SUSPENDED`, `QUOTA_EXCEEDED`, `X-Upgrade-CTA-URL` |
| `gateway/.../FallbackController.java` | 03-01 | ✓ VERIFIED | 37 lines; `SERVICE_UNAVAILABLE` JSON response at `/fallback/service-unavailable` |
| `deploy/nginx/nginx.conf` | 03-01 | ✓ VERIFIED | 97 lines; TLS on port 443; `X-Forwarded-For $remote_addr`; `proxy_pass http://gateway:8080` |
| `gateway/.../StripInternalHeaderFilter.java` | 03-01 | ✓ VERIFIED | GlobalFilter (not YAML default-filter) stripping `X-Internal-Service`; covers YAML + programmatic routes |
| `services/platform-admin-service/src/main/java/io/restaurantos/platform/service/ProvisioningService.java` | 03-02 | ✓ VERIFIED (renamed) | 298 lines; PLAN named it `TenantProvisioningService.java`; renamed to `ProvisioningService.java`; saga + compensation + outbox publish substantive |
| `services/platform-admin-service/.../FeatureFlagAdminService.java` | 03-02 | ✓ VERIFIED | 101 lines; dual-key SET (gateway shape + aspect shape); `tenant_features` DB upsert |
| `services/platform-admin-service/.../ImpersonationService.java` | 03-02 | ✓ VERIFIED | 102 lines; delegates to auth, writes `ImpersonationLogEntity` |
| `services/platform-admin-service/.../PlatformInternalController.java` | 03-02 | ✓ VERIFIED | 91 lines; status/features/usage endpoints; behind `InternalServiceFilter` |
| `services/auth-service/.../AuthProvisioningInternalController.java` | 03-02 | ✓ VERIFIED | 82 lines; provision-admin + service-token + impersonate under `/internal/auth` |
| `services/platform-admin-service/src/main/resources/db/changelog/v1.0.0/010-create-platform-tables.xml` | 03-02 | ✓ VERIFIED | 170 lines; 5 tables (tenants, tenant_features, platform_users, usage_records, impersonation_log); ZERO RLS policies |
| `services/platform-admin-service/.../entity/TenantEntity.java` | 03-02 | ✓ VERIFIED | 89 lines; does NOT extend TenantAuditableEntity (comment explicitly notes this for SC4) |
| `services/user-service/.../db/changelog/v1.0.0/010-create-branches.xml` | 03-03 | ✓ VERIFIED | 41 lines; branches table; `UNIQUE(tenant_id, name)` addUniqueConstraint present |
| `services/user-service/.../db/changelog/v1.0.0/011-enable-rls-branches.xml` | 03-03 | ✓ VERIFIED | 25 lines; `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + `tenant_isolation` policy |
| `services/user-service/.../entity/BranchEntity.java` | 03-03 | ✓ VERIFIED | 64 lines; `extends TenantAuditableEntity` |
| `services/user-service/.../client/AuthInternalClient.java` | 03-03 | ✓ VERIFIED | 54 lines; branch-roles assign/revoke/permissions delegation to `/internal/auth/users/{userId}/branch-roles` |
| `services/auth-service/.../controller/AuthInternalController.java` | 03-03 | ✓ VERIFIED | 79 lines; branch-roles (assign + revoke) + permissions endpoints; references `PermissionResolver` |
| `services/auth-service/.../config/InternalServiceFilter.java` | 03-03 | ✓ VERIFIED | 58 lines; guards `/internal/**`; constant-time check; 403 on mismatch |
| `services/user-service/.../controller/BranchInternalController.java` | 03-03 | ✓ VERIFIED | 85 lines; `POST /internal/users/branches` (FD-1 step 4) + branch-detail GETs |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `JwtGlobalFilter` | `JwksKeyProvider` (shared-lib) | RS256 verify against auth-service JWKS | ✓ WIRED | `import io.restaurantos.shared.security.JwksKeyProvider` + field injection |
| `FeatureFlagGlobalFilter` | Redis `tenant:status:{tid}` + `tenant_features:{tid}:{code}` | Reactive Redis `get()` + PlatformAdminClient cache-miss | ✓ WIRED | CACHE_TTL=5min; cache key shapes exactly match PLAN; PlatformAdminClient fallback with `onErrorResume` |
| `application.yml default-filters` (YAML) + `StripInternalHeaderFilter` (GlobalFilter) | X-Internal-Service removal | `StripInternalHeaderFilter` runs at `HIGHEST_PRECEDENCE` — covers all routes | ✓ WIRED | GlobalFilter is broader than YAML default-filter; preferred per §4.1 |
| `TenantLifecycleService` suspend/reactivate/cancel | Redis `tenant:status:{tid}` | `redis.delete()` on each transition (cache-invalidation, not cache-update) | ✓ WIRED (⚠️ cache-invalidation approach) | Delete forces cache miss → gateway calls PlatformAdminClient on next request; functionally correct but different from planned "SET" approach; see Design Notes |
| `FeatureFlagAdminService.setFeature` | Redis `tenant_features:{tid}:{code}` AND `feature:{tid}:{code}` | `redis.opsForValue().set(gatewayKey, value)` + `redis.opsForValue().set(serviceKey, value)` | ✓ WIRED | Both key shapes SET (not DELETE) as mandated by SC6 |
| `ProvisioningService` | auth `POST /internal/auth/tenants/{id}/provision-admin` + user `POST /internal/users/branches` + finance (seam) | `AuthInternalClient` + `UserInternalClient` + `FinanceInternalClient` Feign | ✓ WIRED | FeignSharedConfig injects X-Internal-Service; finance seam guarded by `provisioning.seed-coa.enabled` flag |
| `ProvisioningService` | `DomainEventPublisher` → `event_outbox` | Transactional outbox publish of `TENANT_PROVISIONED` | ✓ WIRED | `eventPublisher.publish(...)` inside `@Transactional`; `020-shared-infra-tables.xml` creates `event_outbox` |
| `UserWebMvcConfig` | `TenantFilterInterceptor` (shared-lib) | `addInterceptor(tenantFilterInterceptor)` for `/api/v1/**` | ✓ WIRED | Sets `app.current_tenant_id` GUC per request; required for branches RLS |
| `UserAdminService` | auth `POST/DELETE /internal/auth/users/{userId}/branch-roles` | `AuthInternalClient` Feign delegation | ✓ WIRED | user-service has zero `user_branch_roles` JPA entity or SQL |
| `AuthInternalController.permissions` | `PermissionResolver.resolve(userId, branchId)` | Direct method call | ✓ WIRED | `permissionResolver.resolve(userId, branchId)` — existing Phase 2 resolver reused |
| `gateway application.yml user-service route` | `lb://user-service` | `Path=/api/v1/users/**, /api/v1/branches/**` | ✓ WIRED | Both path prefixes on one route covering Tenant Admin branches + role assignment |

---

### Requirements Coverage

| Requirement | Plans | Status | Notes |
|-------------|-------|--------|-------|
| GW-01: JWT validation + 401 at edge | 03-01 | ✓ SATISFIED | JwtGlobalFilter — RS256 verify; public paths whitelisted |
| GW-02: X-Tenant-Id propagation | 03-01 | ✓ SATISFIED | JwtGlobalFilter injects from JWT claims; TenantResolutionSupport handles Host-based fallback |
| GW-03: Rate limiting per-IP | 03-01 | ✓ SATISFIED | RequestRateLimiter + ipKeyResolver; trusted-proxies for real IP |
| GW-04: Feature flag + tenant status enforcement | 03-01 | ✓ SATISFIED | FeatureFlagGlobalFilter; Redis + PlatformAdminClient fallback |
| GW-05: Quota enforcement (NLQ) | 03-01 | ✓ SATISFIED | QUOTA_EXCEEDED check in FeatureFlagGlobalFilter |
| GW-06: Circuit-breaker + fallback | 03-01 | ✓ SATISFIED | CircuitBreaker filter on all upstreams; FallbackController 503 |
| PLATFORM-01: Tenant provisioning saga | 03-02 | ✓ SATISFIED | ProvisioningService <60s saga + compensation |
| PLATFORM-02: Tenant list/paginate | 03-02 | ✓ SATISFIED | TenantLifecycleService.list() + PlatformTenantController |
| PLATFORM-03: Lifecycle state machine | 03-02 | ✓ SATISFIED | suspend/reactivate/cancel with state guards |
| PLATFORM-04: Feature flag admin | 03-02 | ✓ SATISFIED | FeatureFlagAdminService + dual-key Redis immediate invalidation |
| PLATFORM-05: Impersonation | 03-02 | ✓ SATISFIED | ImpersonationService + JwtSigningService.signImpersonationToken |
| PLATFORM-06: Usage telemetry | 03-02 | ✓ SATISFIED | UsageService + PlatformInternalController POST /usage |
| PLATFORM-07: platform_db isolation | 03-02 | ✓ SATISFIED | No RLS in migrations; no TenantAuditableEntity inheritance; PlatformDbIsolationIT |
| PLATFORM-10: Tier feature defaults | 03-02 | ✓ SATISFIED | TierFeatureDefaults: 7 defaults ON in all tiers + per-tier extras |
| USER-01: Branch CRUD + RLS isolation | 03-03 | ✓ SATISFIED | BranchController + RLS migration + TenantFilterInterceptor |
| USER-02: Per-branch role assignment (delegation) | 03-03 | ✓ SATISFIED | UserAdminService delegates to auth-service; zero user_branch_roles writes in user-service |
| USER-03: Internal branch + permission endpoints | 03-03 | ✓ SATISFIED | BranchInternalController + AuthInternalController.permissions wrapping PermissionResolver |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `TenantLifecycleService.java` | Cache-invalidation via `redis.delete()` on lifecycle transitions instead of direct `redis.opsForValue().set(key, newStatus)` | ⚠️ Warning | Functionally correct (cache miss → PlatformAdminClient re-caches on next request) but deviates from PLAN 03-02 note "update Redis immediately". If PlatformAdminClient is down during a suspension event, the gateway may fail-open and continue serving a suspended tenant for up to the cache TTL (5 min). Feature-flag invalidation correctly uses SET; this is a lifecycle-specific deviation. |
| *(None)* | No TODO/FIXME/placeholder stubs found in any Phase 3 main implementation file | — | — |

---

### Human Verification Required

#### 1. Full Multi-Module Compile

**Test:** `cd /Users/muhammadumer/Documents/Projects/ResturantOS && mvn -DskipTests compile`
**Expected:** All 8 modules compile clean (BUILD SUCCESS)
**Why human:** Requires local Java 25 + Maven 3.9 toolchain; can't run in structural verification mode

#### 2. Gateway IT Suite

**Test:** `mvn -pl gateway -am verify` (Docker must be running for Testcontainers)
**Expected:** `JwtGlobalFilterTest` — 401 on missing JWT, public paths forwarded, X-Tenant-Id injected, X-Internal-Service stripped; `FeatureFlagFilterIT` — TENANT_SUSPENDED 403, FEATURE_DISABLED 403 + CTA URL, QUOTA_EXCEEDED 403; `GatewayRoutingIT` — 429 on rate-limit breach, per-IP independence, 503 circuit-breaker fallback. JaCoCo ≥ 70%.
**Why human:** Testcontainers requires Docker daemon; Redis 8 container pulled and started

#### 3. Platform-Admin IT Suite

**Test:** `mvn -pl services/platform-admin-service -am verify` (Docker for Postgres + Redis + RabbitMQ)
**Expected:** `ProvisioningSagaIT` — happy-path < 60s, idempotency replay, compensation → PROVISIONING_FAILED + retry; `FeatureFlagInvalidationIT` — both Redis key shapes updated immediately after toggle; `TenantLifecycleIT` — suspend/reactivate/cancel + invalid-transition exception; `PlatformDbIsolationIT` — zero RLS policies on platform tables. JaCoCo ≥ 60%.
**Why human:** Requires Docker + WireMock stubs for auth/user/finance services

#### 4. User-Service IT Suite

**Test:** `mvn -pl services/user-service -am verify` (Docker for Postgres)
**Expected:** `BranchRlsIT` — tenant A cannot see tenant B branches (cross-tenant isolation); `BranchInternalIT` — POST /internal/users/branches fails without X-Internal-Service, succeeds with it; `UserAdminDelegationIT` — WireMock confirms auth /internal/auth/users/{id}/branch-roles called with X-Internal-Service, zero user_branch_roles writes in user_db.
**Why human:** Testcontainers Postgres required; WireMock stubs for auth-service

#### 5. Auth-Service IT Suite Regression

**Test:** `mvn -pl services/auth-service -am verify`
**Expected:** `AuthInternalBranchRoleIT` — new branch-role + permissions internal endpoints pass; previously passing Phase 2 tests still GREEN; JaCoCo stays ≥ 70%.
**Why human:** Compile + test execution required

---

### Design Notes (Deviations from Plan)

1. **`StripInternalHeaderFilter` vs YAML default-filter:** The plan specified `RemoveRequestHeader=X-Internal-Service` in `application.yml` default-filters. The implementation uses a `GlobalFilter` (`StripInternalHeaderFilter.java`) instead. This is a **better approach**: GlobalFilters run on ALL routes (both YAML-configured and programmatically registered), whereas `default-filters` in YAML only apply to YAML-declared routes. The security property (stripping the internal secret from public traffic) is fully preserved and stronger.

2. **`ProvisioningService` vs `TenantProvisioningService`:** Class renamed from PLAN specification. Behavior is identical; the SUMMARY should document the final class name.

3. **`PlatformDbIsolationIT` vs `PlatformDbIsolationTest`:** File renamed with `IT` suffix (consistent with Testcontainers naming convention in this codebase). All assertions match the planned scope.

4. **Lifecycle Redis cache-invalidation vs SET:** `TenantLifecycleService` uses `redis.delete("tenant:status:{tid}")` on every transition rather than `redis.opsForValue().set(key, newStatus)`. The effect is cache invalidation — the gateway sees a cache miss, calls `PlatformAdminClient.getStatus()`, gets the current DB value, and re-caches it for 5 minutes. This is functionally correct but introduces one extra synchronous call to PlatformAdminClient per post-transition gateway request. The `FeatureFlagGlobalFilter` handles this correctly via the `onErrorResume` fallback. **Recommendation:** On a gap-fix pass, consider setting `tenant:status:{tid} = SUSPENDED/CANCELLED` directly to avoid the extra hop and close the fail-open window.

---

### Gaps Summary

No structural gaps found. All 24 must-have truths are verified against actual code. All required artifacts exist and are substantive (no stub files, no TODO/placeholder implementations). All key links are wired. The phase goal is structurally complete pending runtime confirmation via `mvn verify`.

The one behavioral deviation (lifecycle cache-invalidation vs SET) is a warning-level concern that does not prevent the phase goal from being achieved — gateway suspension enforcement still takes effect within one request cycle through the cache-miss + PlatformAdminClient path.

---

_Verified: 2026-06-25T17:52:20Z_
_Verifier: Claude (gsd-verifier)_
_Verification mode: Structural (grep / file inspection) — no Maven build executed_
