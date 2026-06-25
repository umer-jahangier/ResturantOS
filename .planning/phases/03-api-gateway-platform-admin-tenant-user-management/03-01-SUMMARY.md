---
phase: 03
plan: 01
subsystem: api-gateway
tags: [spring-cloud-gateway, webflux, jwt, redis, rate-limiting, circuit-breaker, nginx, testcontainers]

dependencies:
  requires:
    - "02-01: auth_tenants table + JwksKeyProvider from shared-lib"
    - "02-02: JWT structure (tenant_id, roles, permissions claims)"
    - "02-03: DefaultOpaClient snake_case serialization pattern"
  provides:
    - "gateway Maven module on public port 8080"
    - "JwtGlobalFilter: RS256 JWT validation + tenant resolution + header injection"
    - "FeatureFlagGlobalFilter: tenant status + feature flags + NLQ quota enforcement"
    - "StripInternalHeaderFilter: X-Internal-Service stripped on ALL routes"
    - "Rate limiting per IP via Redis token bucket (RequestRateLimiter)"
    - "Circuit breaker fallback 503 for all upstream routes"
    - "Nginx TLS terminator config with X-Forwarded-For passthrough"
  affects:
    - "03-02: platform-admin-service (PlatformAdminClient points to it)"
    - "03-03: user-service (routed through gateway at /api/v1/users/**)"
    - "All subsequent services: must not set X-Internal-Service — gateway strips it from inbound"

tech-stack:
  added:
    - spring-cloud-starter-gateway-server-webflux:5.0.0
    - spring-boot-starter-data-redis-reactive:4.0.7
    - spring-cloud-starter-circuitbreaker-reactor-resilience4j:5.0.0
    - spring-cloud-starter-netflix-eureka-client:5.0.0
    - com.nimbusds:nimbus-jose-jwt:9.40
    - okhttp3:mockwebserver (test)
    - org.testcontainers:junit-jupiter (test)
  patterns:
    - "GlobalFilter chain (Ordered): StripInternalHeader(+5) → JwtGlobal(+10) → FeatureFlag(+20)"
    - "Token bucket rate limiting via Redis (RequestRateLimiter per route)"
    - "Resilience4j circuit breaker with forward:/fallback/* local fallback"
    - "Reactive WebClient (PlatformAdminClient) with fail-open/closed seam"
    - "Testcontainers Redis + MockWebServer for integration test isolation"

key-files:
  created:
    - gateway/pom.xml
    - gateway/Dockerfile
    - gateway/src/main/java/io/restaurantos/gateway/GatewayApplication.java
    - gateway/src/main/java/io/restaurantos/gateway/config/GatewaySecurityConfig.java
    - gateway/src/main/java/io/restaurantos/gateway/config/RateLimitConfig.java
    - gateway/src/main/java/io/restaurantos/gateway/config/WebClientConfig.java
    - gateway/src/main/java/io/restaurantos/gateway/filter/JwtGlobalFilter.java
    - gateway/src/main/java/io/restaurantos/gateway/filter/FeatureFlagGlobalFilter.java
    - gateway/src/main/java/io/restaurantos/gateway/filter/StripInternalHeaderFilter.java
    - gateway/src/main/java/io/restaurantos/gateway/filter/TenantResolutionSupport.java
    - gateway/src/main/java/io/restaurantos/gateway/client/PlatformAdminClient.java
    - gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java
    - gateway/src/main/java/io/restaurantos/gateway/fallback/FallbackController.java
    - gateway/src/main/resources/application.yml
    - gateway/src/test/java/io/restaurantos/gateway/JwtGlobalFilterTest.java
    - gateway/src/test/java/io/restaurantos/gateway/FeatureFlagFilterIT.java
    - gateway/src/test/java/io/restaurantos/gateway/GatewayRoutingIT.java
    - gateway/src/test/resources/application-test.yml
    - deploy/nginx/nginx.conf
  modified:
    - pom.xml (added <module>gateway</module>)

decisions:
  - id: "03-01-A"
    decision: "StripInternalHeaderFilter as GlobalFilter (not YAML default-filter)"
    rationale: "YAML default-filters only apply to YAML-defined routes; GlobalFilter applies to all routes including programmatic ones, ensuring the security invariant holds universally"
  - id: "03-01-B"
    decision: "Exclude SharedAutoConfiguration from GatewayApplication"
    rationale: "SharedAutoConfiguration requires EntityManager (JPA) and implements WebMvcConfigurer (servlet-based); gateway is a pure reactive WebFlux application with no persistence layer"
  - id: "03-01-C"
    decision: "WebClientConfig provides WebClient.Builder bean explicitly"
    rationale: "Spring Boot 4 no longer auto-configures WebClient.Builder as a prototype bean; must be declared explicitly to avoid NoSuchBeanDefinitionException"
  - id: "03-01-D"
    decision: "TESTCONTAINERS_RYUK_DISABLED=true for Colima environment"
    rationale: "Colima's Docker socket (/Users/muhammadumer/.colima/default/docker.sock) does not support the volume mounts that Ryuk uses for container cleanup; disabling Ryuk allows tests to run"

metrics:
  duration: "~2 hours (Task 3 debug session)"
  completed: "2026-06-25"
  tests:
    unit: 5
    integration: 7
    total: 12
    coverage: ">70% lines (JaCoCo)"
---

# Phase 3 Plan 01: API Gateway Module Summary

**One-liner:** Spring Cloud Gateway 5.x WebFlux edge with RS256 JWT validation, per-tenant feature/quota enforcement via Redis, and per-upstream circuit breakers behind Nginx TLS.

## What Was Built

The `gateway` Maven module is the platform edge service:

1. **Scaffold (Task 1):** `gateway/` Maven module registered in parent POM; `spring-cloud-starter-gateway-server-webflux` (NOT the removed `spring-cloud-starter-gateway`); route definitions under the new `spring.cloud.gateway.server.webflux.*` prefix; per-route rate limiters (auth: 100/min, general: 600/min) and circuit breakers pointing at local fallback; Nginx TLS terminator config at `deploy/nginx/nginx.conf`.

2. **Reactive Filters (Task 2):** Three `GlobalFilter` implementations in precedence order:
   - `StripInternalHeaderFilter` (order +5): strips `X-Internal-Service` from ALL routes
   - `JwtGlobalFilter` (order +10): verifies RS256 JWT via `JwksKeyProvider`; resolves `tenant_id` from JWT claims or Host→Redis→PlatformAdminClient; injects `X-Tenant-Id`, `X-User-Id`, `X-Impersonated-By`; returns 401 `UNAUTHENTICATED` on failure
   - `FeatureFlagGlobalFilter` (order +20): checks `tenant:status:{id}` (suspended → 403), `tenant_features:{id}:{code}` (disabled → 403 + `X-Upgrade-CTA-URL`), `nlq_quota:{id}:monthly_count` (exceeded → 403 QUOTA_EXCEEDED); `PlatformAdminClient` as Redis miss fallback
   - `FallbackController`: `/fallback/service-unavailable` → 503 `SERVICE_UNAVAILABLE`

3. **IT Suite (Task 3):** 12 tests across 3 test classes (all GREEN):
   - `JwtGlobalFilterTest` (5): 401 on missing/expired/garbage JWT; public path pass-through; header injection + X-Internal-Service strip
   - `FeatureFlagFilterIT` (4): SUSPENDED→403; FEATURE_DISABLED→403+CTA; quota exceeded→403; enabled→forwarded
   - `GatewayRoutingIT` (3): per-IP 429 from token bucket; independent per-IP buckets; circuit-breaker 503 fallback

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] SharedAutoConfiguration excluded from gateway**
- **Found during:** Task 3 (Spring context load failure)
- **Issue:** `SharedAutoConfiguration` from shared-lib requires `EntityManager` (JPA) and implements `WebMvcConfigurer` (servlet). Gateway is purely reactive with no persistence.
- **Fix:** Added `SharedAutoConfiguration.class` to `@SpringBootApplication(exclude = {...})`. Gateway uses only `JwksKeyProvider` and `JwtClaims` from shared-lib — plain classes, not beans.
- **Files modified:** `GatewayApplication.java`

**2. [Rule 3 - Blocking] WebClientConfig added for Spring Boot 4 compatibility**
- **Found during:** Task 3 (NoSuchBeanDefinitionException for WebClient.Builder)
- **Issue:** Spring Boot 4 no longer auto-configures `WebClient.Builder` as a bean (the `WebClientAutoConfiguration` class no longer exists in any Spring Boot 4 jar).
- **Fix:** Created `WebClientConfig.java` providing `@Bean WebClient.Builder webClientBuilder()`.
- **Files modified:** `WebClientConfig.java` (new), `GatewaySecurityConfig.java` (removed unused parameter)

**3. [Rule 1 - Bug] StripInternalHeaderFilter promoted to GlobalFilter**
- **Found during:** Task 3 (`validJwt_headersInjected_internalServiceStripped` test failure)
- **Issue:** `RemoveRequestHeader=X-Internal-Service` in YAML `default-filters` only applies to YAML-defined routes. Programmatic routes (`RouteLocatorBuilder`) do not inherit default-filters, leaving the security invariant broken for any code-defined route.
- **Fix:** Created `StripInternalHeaderFilter` as a `GlobalFilter` (order +5, before JWT validation). Removed `RemoveRequestHeader=X-Internal-Service` from YAML `default-filters` to avoid double-stripping.
- **Files modified:** `StripInternalHeaderFilter.java` (new), `application.yml`

**4. [Rule 1 - Bug] MockWebServer.getRequestCount() is cumulative**
- **Found during:** Task 3 (3 FeatureFlagFilterIT failures)
- **Issue:** Tests using `assertThat(mockUpstream.getRequestCount()).isZero()` failed when run after tests that made upstream requests, because `getRequestCount()` is cumulative and never resets between tests.
- **Fix:** Capture `int before = mockUpstream.getRequestCount()` before each action and assert `isEqualTo(before)` rather than `isZero()`.

**5. [Rule 3 - Blocking] Testcontainers Ryuk disabled for Colima**
- **Found during:** Task 3 (Docker environment errors)
- **Issue:** Colima's Docker socket doesn't support bind mounts that Ryuk uses (`mkdir /.../.colima/default/docker.sock: operation not supported`).
- **Fix:** Set `TESTCONTAINERS_RYUK_DISABLED=true` and `DOCKER_HOST=unix:///.../.colima/default/docker.sock` in the Maven invocation.

**6. [Rule 2 - Missing Critical] maven-failsafe-plugin added**
- **Found during:** Task 3 (FeatureFlagFilterIT and GatewayRoutingIT not executed)
- **Issue:** Maven Surefire skips `*IT.java` files by convention; without failsafe configured, integration tests never ran during `verify`.
- **Fix:** Added `maven-failsafe-plugin` to `gateway/pom.xml` with `integration-test` and `verify` goals.

## Must-have Verification

| Requirement | Verified |
|-------------|---------|
| Invalid JWT → 401 UNAUTHENTICATED, upstream not called | ✅ JwtGlobalFilterTest |
| Public paths pass without JWT | ✅ JwtGlobalFilterTest |
| Valid JWT → X-Tenant-Id/X-User-Id injected, X-Internal-Service stripped | ✅ JwtGlobalFilterTest |
| Per-IP rate limit → 429 from token bucket | ✅ GatewayRoutingIT |
| Feature flag disabled → 403 FEATURE_DISABLED + X-Upgrade-CTA-URL | ✅ FeatureFlagFilterIT |
| Suspended tenant → 403 TENANT_SUSPENDED | ✅ FeatureFlagFilterIT |
| Dead upstream → 503 SERVICE_UNAVAILABLE from circuit breaker | ✅ GatewayRoutingIT |

## Artifact Verification

| Artifact | Status |
|----------|--------|
| `gateway/pom.xml` contains `spring-cloud-starter-gateway-server-webflux` | ✅ |
| `application.yml` uses `spring.cloud.gateway.server.webflux` prefix | ✅ |
| `JwtGlobalFilter.java` ≥60 lines, reactive JWT validation | ✅ (130+ lines) |
| `FeatureFlagGlobalFilter.java` ≥60 lines, Redis + fallback | ✅ (150+ lines) |
| `FallbackController.java` returns 503 | ✅ |
| `deploy/nginx/nginx.conf` contains X-Forwarded-For | ✅ |

## Key Links

- `JwtGlobalFilter` → `JwksKeyProvider` (shared-lib) via RS256 signature verification
- `FeatureFlagGlobalFilter` → Redis keys `tenant:status:{id}` / `tenant_features:{id}:{code}`
- `application.yml` routes → `RemoveRequestHeader=X-Internal-Service` moved to `StripInternalHeaderFilter` GlobalFilter
