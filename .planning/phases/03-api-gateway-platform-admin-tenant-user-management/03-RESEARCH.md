# Phase 3: API Gateway, Platform Admin & Tenant/User Management - Research

**Researched:** 2026-06-25
**Domain:** Spring Cloud Gateway 5.x (WebFlux), Spring Boot 4.x / Spring Cloud 2025.1.0, multi-tenant SaaS platform operations
**Confidence:** HIGH (most findings verified via official docs/spec; LOW items flagged)

---

## Summary

Phase 3 builds the platform edge and two core management services on top of the Phase 2 auth foundation.
The three sub-plans (03-01 gateway, 03-02 platform-admin, 03-03 user+branch) are tightly coupled during
provisioning (FD-1) but otherwise independent in steady-state.

**Critical discovery:** Spring Cloud 2025.1.0 (Oakwood) introduced breaking artifact and property-prefix
renames for Spring Cloud Gateway. The old `spring-cloud-starter-gateway` artifact and
`spring.cloud.gateway.*` prefix are **deprecated and broken under Spring Boot 4**. Every file in 03-01
must use the new names (`spring-cloud-starter-gateway-server-webflux`,
`spring.cloud.gateway.server.webflux.*`). Additionally, the shared-lib
`JwtAuthenticationFilter extends OncePerRequestFilter` is **servlet-based and cannot be used in the
reactive gateway**; a new `GlobalFilter` implementation is required specifically for the gateway module.

The platform-admin service is the orchestrator for tenant provisioning (FD-1), calling three internal
Feign endpoints (auth, user, finance) in sequence under a service JWT. The provisioning transaction is
NOT a distributed 2PC — it is a sequential orchestration with compensating logic and an outbox event
(`TENANT_PROVISIONED`) published at the end. Under-60-second SLA is achievable because all downstream
calls are internal LAN hops.

**Primary recommendation:** Build 03-01 first (gateway as thin routing/auth/rate-limit layer), then
03-02 (provisioning orchestrator + lifecycle), then 03-03 (branch/role CRUD + internal permission
endpoints). The gateway depends on Redis being populated by 03-02 (feature flags, tenant status); use
platform-admin's internal endpoint as the gateway's fallback when Redis misses.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `spring-cloud-starter-gateway-server-webflux` | 5.0.0 (via BOM 2025.1.0) | Reactive gateway — routing, filters, rate limiting | Spec-mandated; only working artifact under Spring Boot 4 |
| `spring-boot-starter-data-redis-reactive` | via Boot 4.0.7 BOM | Redis RateLimiter + feature-flag cache (reactive) | Required by `RequestRateLimiter` filter |
| `spring-cloud-starter-circuitbreaker-reactor-resilience4j` | 5.0.0 | Per-upstream circuit breakers | Spec-mandated; reactive Resilience4j integration |
| `spring-cloud-starter-netflix-eureka-client` | 5.0.0 | `lb://service-name` URI resolution | Already used by auth/authorization services |
| `spring-boot-starter-actuator` | via Boot BOM | `/actuator/health`, Prometheus metrics | Standard in all services |
| `spring-boot-starter-web` | via Boot BOM (for platform-admin, user-service) | Servlet stack for non-gateway services | Both platform-admin and user-service are servlet, not reactive |
| `spring-boot-starter-data-jpa` | via Boot BOM | JPA for platform_db, user_db | Standard persistence layer |
| `spring-boot-starter-data-redis` | via Boot BOM | Redis for platform-admin (feature-flag invalidation) | Reactive not needed outside gateway |
| `spring-boot-starter-amqp` | via Boot BOM | RabbitMQ outbox relay — `TENANT_PROVISIONED` event | Outbox pattern from shared-lib |
| `restaurantos-shared-lib` | 1.0.0 | JWT primitives, TenantContext, Feign config, outbox | Phase 2 shared foundation |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `spring-cloud-starter-openfeign` | 5.0.0 | Platform-admin calls auth/user/finance internal APIs | Already configured in shared-lib `FeignSharedConfig` |
| `liquibase-core` | via Boot BOM | `platform_db` + `user_db` schema migrations | Matches existing services pattern |
| `nimbus-jose-jwt` | 9.40 (matches auth-service) | JWKS parsing in gateway GlobalFilter | Only needed in gateway module |
| `spring-boot-starter-validation` | via Boot BOM | DTO validation in platform-admin, user-service | Standard |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `spring-cloud-starter-gateway-server-webflux` | Spring Cloud Gateway Server MVC (servlet) | WebFlux reactive is spec-mandated; MVC gateway exists but has fewer filters |
| Custom GlobalFilter for JWT | Spring OAuth2 Resource Server on gateway | OAuth2 RS would use Spring's decoder; custom filter lets us reuse shared-lib `JwksKeyProvider` and populate `TenantContext` in the reactive way |
| Resilience4j via SCG `CircuitBreaker` filter | Standalone Resilience4j beans | Gateway filter is cleaner; config lives in YAML per-route |

**Installation (gateway/pom.xml additions):**
```xml
<dependency>
  <groupId>org.springframework.cloud</groupId>
  <artifactId>spring-cloud-starter-gateway-server-webflux</artifactId>
</dependency>
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-data-redis-reactive</artifactId>
</dependency>
<dependency>
  <groupId>org.springframework.cloud</groupId>
  <artifactId>spring-cloud-starter-circuitbreaker-reactor-resilience4j</artifactId>
</dependency>
<dependency>
  <groupId>com.nimbusds</groupId>
  <artifactId>nimbus-jose-jwt</artifactId>
  <version>9.40</version>
</dependency>
```

---

## Architecture Patterns

### Recommended Project Structure

```
gateway/
  src/main/java/io/restaurantos/gateway/
    filter/               # GlobalFilter implementations (JWT, tenant, feature-flag)
    config/               # RateLimitConfig, SecurityConfig, RouteConfig
    fallback/             # FallbackController for circuit breaker forward:/fallback/*
    client/               # Reactive WebClient for platform-admin internal lookups
  src/main/resources/
    application.yml       # All route/filter config

services/platform-admin-service/
  src/main/java/io/restaurantos/platform/
    controller/           # /platform/tenants/** (SuperAdmin-facing REST)
    service/              # TenantProvisioningService, LifecycleService, ImpersonationService
    client/               # Feign: AuthClient, UserClient, FinanceClient
    entity/               # Tenant, TenantFeature, PlatformUser, UsageRecord, ImpersonationLog
    repository/           # Spring Data JPA repositories
    event/                # OutboxEvent publisher for TENANT_PROVISIONED
  src/main/resources/db/changelog/  # Liquibase for platform_db

services/user-service/
  src/main/java/io/restaurantos/user/
    controller/           # /api/v1/branches/** + /internal/users/**
    service/              # BranchService, UserProfileService, PermissionService
    entity/               # Branch, UserProfile, UserBranchRole
    repository/           # Spring Data JPA repositories (RLS-aware)
  src/main/resources/db/changelog/  # Liquibase for user_db
```

### Pattern 1: Reactive JWT GlobalFilter (gateway-specific)

**What:** A `GlobalFilter` + `Ordered` bean replaces `OncePerRequestFilter` in the reactive context.
Uses `ServerWebExchange` and returns `Mono<Void>`.

**When to use:** Exactly once in the gateway module. Do NOT attempt to reuse shared-lib's
`JwtAuthenticationFilter` — it is servlet-only.

```java
// Source: Docs/agent-specs/09-security-implementation-guide.md + Spring Cloud Gateway 5.x docs
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class JwtGlobalFilter implements GlobalFilter {

    private final JwksKeyProvider keyProvider;    // reuse from shared-lib

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getPath().value();
        // Pass-through paths: /api/v1/auth/login, /api/v1/auth/refresh,
        //                     /.well-known/*, /actuator/health
        if (isPublicPath(path)) {
            return chain.filter(exchange);
        }
        String authHeader = exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION);
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            return writeError(exchange, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
        }
        String token = authHeader.substring(7);
        try {
            JwtClaims claims = validateAndParseClaims(token);
            UUID tenantId = resolveTenantId(exchange, claims);
            ServerHttpRequest mutated = exchange.getRequest().mutate()
                .header("X-Tenant-Id", tenantId.toString())
                .header("X-User-Id", claims.userId().toString())
                .build();
            return chain.filter(exchange.mutate().request(mutated).build());
        } catch (Exception e) {
            return writeError(exchange, HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED");
        }
    }
}
```

### Pattern 2: New Property Prefix (Spring Cloud 2025.1.0 / Spring Cloud Gateway 5.x)

**What:** All gateway YAML config must use `spring.cloud.gateway.server.webflux.*`.
The old `spring.cloud.gateway.*` prefix is deprecated and may silently not apply.

```yaml
# Source: Spring Cloud 2025.0/2025.1 release notes + official docs
spring:
  cloud:
    gateway:
      server:
        webflux:
          trusted-proxies: "127\\.0\\.0\\.1|::1|172\\..*"   # trust Nginx
          default-filters:
            - RemoveRequestHeader=X-Internal-Service
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 600
                key-resolver: "#{@ipKeyResolver}"
          routes:
            - id: auth-route
              uri: lb://auth-service
              predicates:
                - Path=/api/v1/auth/**
              filters:
                - name: RequestRateLimiter
                  args:
                    redis-rate-limiter.replenishRate: 2
                    redis-rate-limiter.burstCapacity: 100
                    key-resolver: "#{@ipKeyResolver}"
            - id: pos-route
              uri: lb://pos-service
              predicates:
                - Path=/api/v1/pos/**, /api/v1/orders/**
              filters:
                - name: CircuitBreaker
                  args:
                    name: posCircuitBreaker
                    fallbackUri: forward:/fallback/service-unavailable
```

### Pattern 3: Feature Flag + Tenant Status Check (custom GlobalFilter)

**What:** A second `GlobalFilter` (ordered after JWT) checks Redis for tenant status and
feature flags before routing. Falls back to platform-admin internal endpoint on cache miss.

```java
// Filter order: JwtGlobalFilter (HIGHEST+10) → FeatureFlagFilter (HIGHEST+20) → route
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 20)
public class FeatureFlagGlobalFilter implements GlobalFilter {
    // Redis keys (from FD-15 spec):
    //   tenant:status:{tenantId}           → "ACTIVE" | "SUSPENDED" | "CANCELLED"
    //   tenant_features:{tenantId}:{code}  → "true" | "false"
    //   nlq_quota:{tenantId}:monthly_count → integer string
}
```

### Pattern 4: Provisioning Orchestrator (platform-admin-service)

**What:** `TenantProvisioningService` orchestrates FD-1 as a sequential saga.
Uses `@Transactional` for local `platform_db` writes; calls external services via Feign (not transactional).

```java
// Source: Docs/RestaurantERP_UserStories_FlowDiagrams.md FD-1
@Service
@Transactional
public class TenantProvisioningService {

    public TenantProvisionedResponse provision(ProvisionTenantRequest req) {
        // 1. INSERT tenants (status=PENDING_SETUP) in platform_db
        Tenant tenant = tenantRepository.save(buildTenant(req));
        // 2. Seed tenant_features from tier defaults
        seedFeatures(tenant);
        // 3. Call auth-service: POST /internal/auth/tenants/{id}/provision-admin
        AuthProvisionResponse adminCreds = authClient.provisionAdmin(tenant.getId(), req.email());
        // 4. Call user-service: POST /internal/users/branches {tenantId, name="HQ", isHq=true}
        BranchCreatedResponse hq = userClient.createBranch(new CreateBranchRequest(tenant.getId(), "HQ", true));
        // 5. Call finance-service: POST /internal/tenants/{id}/seed-coa {country=PK}
        financeClient.seedCoa(tenant.getId(), "PK");
        // 6. Update status to ACTIVE
        tenant.setStatus(TenantStatus.ACTIVE);
        // 7. Publish TENANT_PROVISIONED via outbox
        outboxService.publish("TENANT_PROVISIONED", buildProvisionedPayload(tenant, adminCreds, hq));
        // 8. Invalidate/seed Redis cache entries for new tenant
        redisFeatureFlagCache.seed(tenant.getId(), tenant.getFeatures());
        return buildResponse(tenant, adminCreds, hq);
    }
}
```

### Pattern 5: Service JWT for Provisioning Internal Calls

**What:** Platform-admin calls `POST /internal/auth/service-token` to obtain a short-lived
service JWT (sub=platform-admin-service, roles=["INTERNAL_SERVICE"]) used for Feign calls
during provisioning.

```java
// Source: Docs/agent-specs/04-internal-api-contracts.md section 4.2
// FeignSharedConfig.internalRequestInterceptor() picks up Authorization from RequestContextHolder.
// For server-initiated flows, manually set it on the Feign template via a custom RequestInterceptor:
@Bean
public RequestInterceptor serviceTokenInterceptor(AuthClient authClient) {
    return template -> {
        // Only inject when no user context is present (provisioning flows)
        if (RequestContextHolder.getRequestAttributes() == null) {
            String serviceToken = serviceTokenCache.getOrRefresh();
            template.header("Authorization", "Bearer " + serviceToken);
        }
    };
}
```

### Pattern 6: User-Service RLS Context

**What:** `TenantFilterInterceptor` from shared-lib sets `app.current_tenant_id` GUC per request
in user-service. Branches table uses RLS policy checking the GUC.

```sql
-- user_db branch table RLS (follows established shared-lib pattern)
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branches
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
```

### Anti-Patterns to Avoid

- **Reusing `OncePerRequestFilter` in gateway**: Gateway is WebFlux; servlet filters are silently ignored.
- **Using `spring.cloud.gateway.*` prefix (old)**: In Spring Cloud 2025.1.0 / Boot 4, properties
  under the old prefix are deprecated and may not be processed. Always use `spring.cloud.gateway.server.webflux.*`.
- **Platform-admin routing internal calls through gateway**: Services call each other directly via
  Eureka-resolved URLs. Gateway is for external traffic only.
- **Storing `platform_db` credentials in shared environment**: Only platform-admin-service's
  `application.yml` / Config Server profile should have `platform_db` credentials.
- **Making provisioning fully transactional across services**: There is no distributed transaction.
  Use sequential orchestration with status tracking and compensating actions on failure.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Redis token-bucket rate limiting | Custom Lua scripts | SCG `RequestRateLimiter` + `spring-boot-starter-data-redis-reactive` | SCG ships production-quality Lua scripts for Redis; edge cases with atomic increment, expiry |
| JWT JWKS key caching | Manual HTTP client + cache | `JwksKeyProvider` (already in shared-lib) + nimbus-jose-jwt parsing | JwksKeyProvider already handles TTL, kid rotation, thread-safety |
| Per-upstream circuit breaker | Custom retry + fallback logic | SCG `CircuitBreaker` filter + `spring-cloud-starter-circuitbreaker-reactor-resilience4j` | Resilience4j handles half-open state, sliding window, configurable timeouts |
| Feign service-to-service auth | Manual header copy | `FeignSharedConfig.internalRequestInterceptor()` (already in shared-lib) | Handles JWT propagation + X-Internal-Service secret |
| Tenant slug→tenantId cache | In-memory HashMap in gateway | Redis with 5-min TTL (same cluster as rate limits) | Distributed cache survives gateway restarts, consistent across replicas |
| RabbitMQ outbox publish | Direct `rabbitTemplate.send()` | `OutboxService` from shared-lib | Handles exactly-once with Postgres outbox + relay |

**Key insight:** The shared-lib provides ~80% of what these three services need for cross-cutting concerns.
Don't re-implement TenantContext, outbox, Feign config, JwksKeyProvider.

---

## Common Pitfalls

### Pitfall 1: Wrong Gateway Artifact/Property Prefix

**What goes wrong:** Gateway fails to start or routes are not registered; Redis rate limiting silently
does nothing.

**Why it happens:** Spring Cloud 2025.0 deprecated `spring-cloud-starter-gateway` and
`spring.cloud.gateway.*`. Spring Cloud 2025.1.0 removed the old artifacts entirely.

**How to avoid:** Always use `spring-cloud-starter-gateway-server-webflux` in pom.xml and
`spring.cloud.gateway.server.webflux.*` in YAML.

**Warning signs:** `NoSuchBeanDefinitionException: RouteLocator` at startup; rate limiting returning
200s even under load.

### Pitfall 2: X-Forwarded Headers Disabled by Default

**What goes wrong:** Gateway sees `127.0.0.1` for all IPs when behind Nginx, making
per-IP rate limiting useless (everyone shares one bucket).

**Why it happens:** Spring Cloud 2025.0 changed X-Forwarded-* to disabled-by-default for security.

**How to avoid:** Set `spring.cloud.gateway.server.webflux.trusted-proxies` to a regex matching
Nginx's IP (e.g., `127\.0\.0\.1|172\..*`). In Nginx, set `proxy_set_header X-Forwarded-For $remote_addr`.

**Warning signs:** All rate limits hit simultaneously from different clients; `KeyResolver`
returns the same key for all requests.

### Pitfall 3: Servlet Filter in Reactive Gateway

**What goes wrong:** `JwtAuthenticationFilter extends OncePerRequestFilter` added to gateway
causes `ClassCastException` or is silently skipped.

**Why it happens:** Spring Cloud Gateway uses Spring WebFlux (Netty-based), not Spring MVC
(Tomcat/Jetty-based). Servlet-based filters are not invoked.

**How to avoid:** Implement a `GlobalFilter` (or `WebFilter`) for gateway-specific auth logic.
Import `JwksKeyProvider` and `JwtClaims` from shared-lib but do NOT import the filter itself.

**Warning signs:** JWT is not validated but requests reach upstream; no 401 on invalid tokens.

### Pitfall 4: Provisioning Partial Failures

**What goes wrong:** Tenant is created in `platform_db` but auth-admin creation fails →
orphaned PENDING_SETUP tenant with no Tenant Admin.

**Why it happens:** Calls to auth-service, user-service, finance-service are not transactional.

**How to avoid:**
1. Catch `FeignException` from each downstream call
2. If any call fails, set tenant status to `PROVISIONING_FAILED` in platform_db
3. Return 500 with retry instructions
4. Add a SuperAdmin "retry provisioning" endpoint

**Warning signs:** Tenants stuck in `PENDING_SETUP` status; no welcome email sent.

### Pitfall 5: Redis Cache Stale After Feature Flag Change

**What goes wrong:** SuperAdmin disables a feature; tenant continues to access it for up to
5 minutes due to stale gateway cache.

**Why it happens:** Spec says "cache invalidated immediately" — this means platform-admin must
actively invalidate (DELETE/SET) the Redis key on feature flag change, not just let TTL expire.

**How to avoid:** In `FeatureFlagService.updateFlag()`, after writing to `platform_db.tenant_features`,
call `redisTemplate.delete("tenant_features:{tenantId}:{featureCode}")` and set the new value.

**Warning signs:** Feature flag changes take minutes to take effect.

### Pitfall 6: platform_db Credential Leak

**What goes wrong:** Other services accidentally connect to `platform_db` (misconfigured Config Server
profile), violating isolation requirement.

**Why it happens:** All services use the same Config Server; `platform_db` credentials in shared
profiles are picked up by all services.

**How to avoid:** `platform_db` credentials must ONLY be in `platform-admin-service`'s dedicated
Config Server profile. Verify other service datasource URLs at startup.

### Pitfall 7: Impersonation JWT Missing Enforced Expiry

**What goes wrong:** Impersonation sessions last indefinitely if `iat + 30min` check is not
enforced at token issuance time.

**Why it happens:** Auth service issues JWTs; if platform-admin passes arbitrary `exp`, there is
no server-side session to invalidate.

**How to avoid:** When platform-admin calls auth to issue an impersonation JWT, always set
`exp = now + 1800s` (30 min). The `impersonated_by` claim must be present; gateway or downstream
services detect this claim for audit logging.

### Pitfall 8: User-Service Missing RLS for Branch Isolation

**What goes wrong:** Tenant Admin for Tenant A can read/modify branches of Tenant B.

**Why it happens:** RLS GUC `app.current_tenant_id` not set in `TenantFilterInterceptor`, or
user-service registered `TenantFilterInterceptor` but forgot to set `setApplyToAllHandlers(true)`.

**How to avoid:** Register `TenantFilterInterceptor` for `/**` in user-service's WebMvcConfigurer
(same pattern as auth-service from Phase 2). Verify with Testcontainers-based RLS coverage test.

---

## Code Examples

### Gateway Rate Limiting: Achieving 100 req/min/IP for Auth Routes

The spec (Docs/agent-specs/09-security-implementation-guide.md §9.6) provides this pattern.
For 100 req/min: `replenishRate=2` (fills 2 tokens/sec = 120/min), `burstCapacity=100`
(initial burst allowance). For 600 req/min: `replenishRate=10`, `burstCapacity=600`.

```yaml
# Source: Docs/agent-specs/09-security-implementation-guide.md §9.6
spring:
  cloud:
    gateway:
      server:
        webflux:
          default-filters:
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 10
                redis-rate-limiter.burstCapacity: 600
                key-resolver: "#{@ipKeyResolver}"
          routes:
            - id: auth-route
              uri: lb://auth-service
              predicates:
                - Path=/api/v1/auth/**
              filters:
                - name: RequestRateLimiter
                  args:
                    redis-rate-limiter.replenishRate: 2
                    redis-rate-limiter.burstCapacity: 100
                    key-resolver: "#{@ipKeyResolver}"
```

```java
// Source: Docs/agent-specs/09-security-implementation-guide.md §9.6
@Configuration
public class RateLimitConfig {
    @Bean
    public KeyResolver ipKeyResolver() {
        return exchange -> {
            String xff = exchange.getRequest().getHeaders().getFirst("X-Forwarded-For");
            String ip = xff != null ? xff.split(",")[0].trim()
                : exchange.getRequest().getRemoteAddress().getAddress().getHostAddress();
            return Mono.just(ip);
        };
    }
}
```

### Gateway Circuit Breaker per Upstream

```yaml
# Source: Spring Cloud Gateway 5.x official docs (verified)
# spring.cloud.gateway.server.webflux.routes[*].filters
- name: CircuitBreaker
  args:
    name: posCircuitBreaker
    fallbackUri: forward:/fallback/service-unavailable
    statusCodes:
      - 500
      - 503
```

```yaml
# resilience4j config (in gateway application.yml)
resilience4j:
  circuitbreaker:
    instances:
      posCircuitBreaker:
        slidingWindowSize: 10
        failureRateThreshold: 50
        waitDurationInOpenState: 10s
        permittedNumberOfCallsInHalfOpenState: 3
```

### Feature Flag Enforcement Response (FD-15)

```java
// 403 FEATURE_DISABLED with CTA URL header
exchange.getResponse().setStatusCode(HttpStatus.FORBIDDEN);
exchange.getResponse().getHeaders().add("X-Upgrade-CTA-URL",
    "https://app.restaurantos.io/billing?feature=" + featureCode);
exchange.getResponse().getHeaders().setContentType(MediaType.APPLICATION_JSON);
return exchange.getResponse().writeWith(Mono.just(exchange.getResponse()
    .bufferFactory()
    .wrap("{\"error\":{\"code\":\"FEATURE_DISABLED\",\"message\":\"Upgrade to enable this feature\"}}".getBytes())));
```

### Provisioning Flow (FD-1) - Platform Admin

```java
// Source: Docs/RestaurantERP_UserStories_FlowDiagrams.md FD-1 (sequenceDiagram)
// Key internal endpoints from Docs/agent-specs/04-internal-api-contracts.md:
//   POST /internal/auth/tenants/{id}/provision-admin  → {userId, tempPassword}
//   POST /internal/users/branches  → {branchId}
//   POST /internal/finance/tenants/{id}/seed-coa  → OK

@FeignClient(name = "auth-service", configuration = FeignSharedConfig.class)
public interface AuthInternalClient {
    @PostMapping("/internal/auth/tenants/{tenantId}/provision-admin")
    ApiResponse<AdminProvisionResponse> provisionAdmin(
        @PathVariable UUID tenantId,
        @RequestBody ProvisionAdminRequest req);

    @PostMapping("/internal/auth/service-token")
    ApiResponse<ServiceTokenResponse> serviceToken(@RequestBody ServiceTokenRequest req);
}
```

### Impersonation JWT Issuance

```java
// platform-admin calls auth to issue an impersonation token:
// POST /internal/auth/users/{targetUserId}/impersonate
// { "issuedBy": superAdminId, "expiresInSeconds": 1800 }
// auth-service sets claims: sub=targetUserId, tenant_id=..., impersonated_by=superAdminId, exp=now+1800

// Log to platform_db.impersonation_log:
impersonationLogRepository.save(ImpersonationLog.builder()
    .platformUserId(superAdminId)
    .tenantId(tenantId)
    .targetUserId(targetUserId)
    .startedAt(Instant.now())
    .reason(request.getReason())
    .build());
```

### User-Service Internal Permissions Endpoint

```java
// Source: Docs/agent-specs/04-internal-api-contracts.md — user-service is NOT listed for
// permission computation. Auth-service exposes:
//   GET /internal/auth/users/{userId}/permissions?branchId=
// User-service provides branch details:
//   GET /internal/users/branches/{branchId}
// For JWT issuance, auth-service combines both.
// User-service must expose:
//   GET /internal/users/{userId}/branch-roles
//   returning: { branchId, roleCode, permissions[] } for each branch

@GetMapping("/internal/users/{userId}/branch-roles")
@PreAuthorize("hasRole('INTERNAL_SERVICE')")
public ApiResponse<List<BranchRoleDto>> getUserBranchRoles(@PathVariable UUID userId) {
    return ApiResponse.ok(permissionService.computeBranchRoles(userId));
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `spring-cloud-starter-gateway` | `spring-cloud-starter-gateway-server-webflux` | Spring Cloud 2025.0 (deprecated) → 2025.1.0 (required) | All pom.xml and YAML must use new names |
| `spring.cloud.gateway.*` properties | `spring.cloud.gateway.server.webflux.*` | Spring Cloud 2025.0 | All gateway YAML must be migrated |
| X-Forwarded headers trusted by default | Opt-in via `trusted-proxies` regex | Spring Cloud 2025.0 | Must explicitly configure for Nginx |
| Hystrix circuit breaker | Resilience4j via `spring-cloud-starter-circuitbreaker-reactor-resilience4j` | Spring Cloud 2020.x | Hystrix is fully removed |

**Deprecated/outdated:**
- `spring-cloud-starter-gateway`: Removed in Spring Cloud 5.0.0 under Boot 4. Will fail to resolve.
- `spring.cloud.gateway.routes[*]` (old prefix): Deprecated; use `spring.cloud.gateway.server.webflux.routes[*]`
- `WebSecurityConfigurerAdapter` in gateway security: Removed in Spring Security 7; use lambda DSL `SecurityWebFilterChain` for WebFlux.

---

## Open Questions

1. **Impersonation endpoint in auth-service**
   - What we know: Spec says platform-admin issues an impersonation JWT with `impersonated_by` stamp
     and 30-min expiry. Auth-service has `POST /internal/auth/service-token`.
   - What's unclear: Is there a dedicated `POST /internal/auth/users/{id}/impersonate` endpoint, or
     does platform-admin call `/internal/auth/service-token` and manually set claims?
   - Recommendation: Add `POST /internal/auth/users/{id}/impersonate` to auth-service in Phase 3
     (or confirm during 03-02 planning).

2. **Tenant resolution from Host header (slug-based)**
   - What we know: Default URL is `{tenant_slug}.restaurantos.io`; gateway resolves tenant_id from
     JWT claim (primary) or Host header (for custom-domain tenants, Phase 3+).
   - What's unclear: For Phase 3, is Host-header-based resolution required, or only JWT-based?
     (Custom domain provisioning is milestone 26, deferred). The spec says "gateway resolves tenant_id
     from JWT OR custom domain host header" — but the `auth_tenants` table (NON-RLS in auth_db)
     does the slug→tenantId lookup.
   - Recommendation: Implement JWT-based tenant resolution as primary in Phase 3; add Host-header
     resolution (using `auth_tenants` cache via Redis) as secondary. Keep Host-header path simple:
     extract slug from Host, Redis GET `tenant:slug:{slug}`, fallback to auth_db.

3. **user_db schema — what columns does `branches` need?**
   - What we know: Internal API returns `{ branchId, tenantId, name, isHq, timezone, fbrStrn, ntn, currencyConfig }`
   - What's unclear: Full DDL not in spec (only the API contract).
   - Recommendation: Define DDL from the API contract fields + standard `tenant_id`, `created_at`, `updated_at`.

4. **Redis key TTL for tenant status vs feature flags**
   - What we know: Feature flags: 5-min TTL per spec. Tenant status TTL not explicitly stated.
   - Recommendation: Use 5-min TTL for tenant status as well (consistent with feature flags);
     invalidate immediately on suspension/reactivation (same as feature flag invalidation).

---

## Sources

### Primary (HIGH confidence)
- `Docs/agent-specs/09-security-implementation-guide.md` — Gateway rate limiting YAML, JWT filter pattern
- `Docs/RestaurantERP_SaaS_Specification.md §P4.3` — API Gateway responsibilities
- `Docs/RestaurantERP_SaaS_Specification.md §P6.5` — platform_db schema (complete DDL)
- `Docs/RestaurantERP_UserStories_FlowDiagrams.md §FD-1` — Provisioning sequence diagram
- `Docs/RestaurantERP_UserStories_FlowDiagrams.md §FD-15` — Feature flag & quota enforcement flow
- `Docs/agent-specs/04-internal-api-contracts.md` — All internal API contracts
- `spring.io/blog/2025/11/25/spring-cloud-2025-1-0-aka-oakwood-has-been-released` — SC 2025.1.0 release notes
- `github.com/spring-cloud/spring-cloud-release/wiki/Spring-Cloud-2025.1-Release-Notes` — breaking changes
- `docs.spring.io/spring-cloud-gateway/reference/spring-cloud-gateway-server-webflux/...` — Rate limiter factory docs (WebFetch verified)
- `docs.spring.io/spring-cloud-gateway/reference/spring-cloud-gateway-server-webflux/gatewayfilter-factories/circuitbreaker-filter-factory.html` — CircuitBreaker filter docs (WebSearch verified)

### Secondary (MEDIUM confidence)
- `stackoverflow.com/questions/79869572` — Spring Cloud Starter Gateway + Boot 4 artifact names (community, confirmed by official docs)
- `medium.com/codetodeploy/spring-cloud-gateway-jwt-validation-key-rotation-jwks-...` — JWT + gateway patterns (community, consistent with spec approach)

### Tertiary (LOW confidence)
- Training knowledge on Resilience4j circuit breaker configuration defaults — verify against `resilience4j.circuitbreaker` docs before using

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — artifact names verified via official Spring Cloud 2025.1.0 release notes + Stack Overflow confirmation
- Architecture: HIGH — directly derived from project spec (FD-1, FD-15, P4.3, §9.6, §4.x)
- Pitfalls: HIGH (artifact/prefix) and MEDIUM (provisional Java code patterns) — Spring Cloud breaking changes confirmed official; Java patterns from spec + docs
- Open questions: honest gaps identified from spec review

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (Spring Cloud Gateway 5.x is stable; check for 5.x.x patch releases)
