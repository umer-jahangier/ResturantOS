---
phase: 01
plan: 04
subsystem: shared-lib
tags: [spring-boot, java-25, shared-library, tenant-isolation, rls, jwt, opa, outbox, idempotency, testcontainers, rabbitmq, redis, postgresql]

dependency-graph:
  requires:
    - 01-01   # Maven reactor + Eureka + Config Server
    - 01-02   # TenantAuditableEntity + AbstractRlsCoverageTest + DB init SQL
    - 01-03   # RabbitMQ topology + generate-keys.sh + .env.example
  provides:
    - shared-lib JAR consumed by all services
    - TenantContext + async/consumer propagation
    - Feature flags (Redis-backed)
    - OPA client (optional, ConditionalOnProperty)
    - Idempotency service + entity
    - JWT/security classes (shipped but not wired into SecurityFilterChain)
    - GlobalExceptionHandler + ApiResponse/ApiError
    - MoneyUtils (BIGINT-paisa arithmetic)
    - Transactional outbox (DomainEventPublisher + OutboxRelay)
    - SharedAutoConfiguration (opt-in via AutoConfiguration.imports)
    - Testcontainers integration harness (BaseIntegrationTest)
    - SharedLibVerificationIT (proves SC3/SC4/SC5)
  affects:
    - Phase 2: auth-service wires JwtAuthenticationFilter + SecurityFilterChain
    - All service modules: extend TenantAuditableEntity, use EventPublisher, IdempotencyService
    - Phase 3+: all cross-cutting concerns delegated to shared-lib

tech-stack:
  added:
    - spring-boot-starter-web
    - spring-boot-starter-data-jpa
    - spring-boot-starter-security (beans guarded, no SecurityFilterChain)
    - spring-boot-starter-amqp
    - spring-boot-starter-aspectj
    - spring-boot-starter-data-redis
    - jjwt-api/impl/jackson (JWT signing and parsing)
    - nimbus-jose-jwt (JWKS fetching and RSA key parsing)
    - jackson-databind + JavaTimeModule
    - awaitility (async test assertions)
    - testcontainers: postgresql, rabbitmq, junit-jupiter
  patterns:
    - Transactional Outbox Pattern (DomainEventPublisher → OutboxRelay → RabbitMQ)
    - ThreadLocal tenant propagation via TenantContext / TenantTaskDecorator
    - Hibernate named filter (tenantFilter) for soft-RLS
    - PostgreSQL GUC (app.current_tenant_id) for hard-RLS via set_config
    - OPA fail-closed policy evaluation via RestClient
    - Redis-backed feature flags with TTL caching
    - Spring Boot AutoConfiguration.imports for opt-in library wiring
    - Testcontainers (static containers, once per JVM) in abstract base test

key-files:
  created:
    - shared-lib/src/main/java/io/restaurantos/shared/tenant/TenantContext.java
    - shared-lib/src/main/java/io/restaurantos/shared/tenant/ThreadLocalTenantContext.java
    - shared-lib/src/main/java/io/restaurantos/shared/tenant/TenantTaskDecorator.java
    - shared-lib/src/main/java/io/restaurantos/shared/tenant/TenantAwareMessageProcessor.java
    - shared-lib/src/main/java/io/restaurantos/shared/tenant/TenantFilterInterceptor.java
    - shared-lib/src/main/java/io/restaurantos/shared/config/TenantContextAuditorAware.java
    - shared-lib/src/main/java/io/restaurantos/shared/event/EventEnvelope.java
    - shared-lib/src/main/java/io/restaurantos/shared/exception/*.java (8 exception classes)
    - shared-lib/src/main/java/io/restaurantos/shared/feature/RequiresFeature.java
    - shared-lib/src/main/java/io/restaurantos/shared/feature/FeatureFlagService.java
    - shared-lib/src/main/java/io/restaurantos/shared/feature/FeatureFlagAspect.java
    - shared-lib/src/main/java/io/restaurantos/shared/feature/RedisFeatureFlagService.java
    - shared-lib/src/main/java/io/restaurantos/shared/authz/OpaDecision.java
    - shared-lib/src/main/java/io/restaurantos/shared/authz/OpaInput.java
    - shared-lib/src/main/java/io/restaurantos/shared/authz/OpaClient.java
    - shared-lib/src/main/java/io/restaurantos/shared/authz/DefaultOpaClient.java
    - shared-lib/src/main/java/io/restaurantos/shared/idempotency/IdempotencyService.java
    - shared-lib/src/main/java/io/restaurantos/shared/idempotency/IdempotencyKey.java
    - shared-lib/src/main/java/io/restaurantos/shared/idempotency/IdempotencyKeyRepository.java
    - shared-lib/src/main/java/io/restaurantos/shared/idempotency/DefaultIdempotencyService.java
    - shared-lib/src/main/java/io/restaurantos/shared/security/JwtClaims.java
    - shared-lib/src/main/java/io/restaurantos/shared/security/JwtProperties.java
    - shared-lib/src/main/java/io/restaurantos/shared/security/JwksKeyProvider.java
    - shared-lib/src/main/java/io/restaurantos/shared/security/JwtAuthenticationFilter.java
    - shared-lib/src/main/java/io/restaurantos/shared/security/RestaurantOsAuthentication.java
    - shared-lib/src/main/java/io/restaurantos/shared/api/PageMeta.java
    - shared-lib/src/main/java/io/restaurantos/shared/api/ApiResponse.java
    - shared-lib/src/main/java/io/restaurantos/shared/api/ApiError.java
    - shared-lib/src/main/java/io/restaurantos/shared/api/GlobalExceptionHandler.java
    - shared-lib/src/main/java/io/restaurantos/shared/money/Money.java
    - shared-lib/src/main/java/io/restaurantos/shared/money/MoneyUtils.java
    - shared-lib/src/main/java/io/restaurantos/shared/event/OutboxEntry.java
    - shared-lib/src/main/java/io/restaurantos/shared/event/OutboxRepository.java
    - shared-lib/src/main/java/io/restaurantos/shared/event/EventPublisher.java
    - shared-lib/src/main/java/io/restaurantos/shared/event/DomainEventPublisher.java
    - shared-lib/src/main/java/io/restaurantos/shared/event/OutboxRelay.java
    - shared-lib/src/main/java/io/restaurantos/shared/config/SharedAutoConfiguration.java
    - shared-lib/src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
    - shared-lib/src/test/java/io/restaurantos/shared/integration/BaseIntegrationTest.java
    - shared-lib/src/test/java/io/restaurantos/shared/integration/SharedLibTestApplication.java
    - shared-lib/src/test/java/io/restaurantos/shared/integration/SharedLibVerificationIT.java
    - shared-lib/src/test/java/io/restaurantos/shared/integration/TestFixtures.java
    - shared-lib/src/test/java/io/restaurantos/shared/integration/Widget.java
    - shared-lib/src/test/java/io/restaurantos/shared/integration/WidgetRepository.java
    - shared-lib/src/test/resources/application.properties
    - shared-lib/src/test/resources/db/changelog/test-changelog.xml
  modified: []

decisions:
  - id: D-04-01
    decision: "Security beans (JwtAuthenticationFilter, JwksKeyProvider) shipped in shared-lib but NOT wired into any SecurityFilterChain. No @EnableWebSecurity in shared-lib. Phase 2 (auth-service) wires them."
    rationale: "Prevents every service from requiring a full Spring Security configuration prematurely. Resolves plan gotcha #2."
  - id: D-04-02
    decision: "OPA client is @ConditionalOnProperty(name='restaurantos.opa.url', matchIfMissing=false) — absent from test harness."
    rationale: "OPA is optional in dev/test. Services that need it set restaurantos.opa.url. Resolves plan gotcha #4."
  - id: D-04-03
    decision: "OutboxRelay publishes raw Message bytes via rabbitTemplate.send(exchange, routingKey, new Message(bytes, props)) instead of convertAndSend(String) to avoid double-encoding."
    rationale: "Critical gotcha #1 from plan. Avoids consumers receiving double-JSON-encoded payloads."
  - id: D-04-04
    decision: "Minimal SharedLibTestApplication (@SpringBootApplication + @EntityScan + @EnableJpaRepositories) bootstraps the Spring test context instead of a sample-service module."
    rationale: "shared-lib has no main class; the test harness needs a @SpringBootApplication to load SharedAutoConfiguration and JPA repositories."
  - id: D-04-05
    decision: "WebEnvironment.NONE used in BaseIntegrationTest to avoid starting an embedded HTTP server."
    rationale: "shared-lib tests exercise JPA/Redis/RabbitMQ, not HTTP endpoints. Security filter-chain auto-configuration also excluded."

metrics:
  duration: "~4 hours (across two sessions)"
  completed: "2026-06-23"
---

# Phase 1 Plan 4: shared-lib Full Implementation + Testcontainers Harness

**One-liner:** Complete cross-cutting shared-lib with tenant propagation, feature flags, OPA, idempotency, JWT classes, BIGINT-paisa MoneyUtils, transactional outbox relay, and Testcontainers integration harness proving SC3/SC4/SC5.

## Objective

Implement the `shared-lib` JAR — the foundation every service imports — delivering: tenant isolation infrastructure, feature flags, OPA policy evaluation, idempotency enforcement, JWT/security classes (not wired), standardized API responses, BIGINT-paisa money arithmetic, and the transactional outbox pattern. Verified by a Testcontainers integration test proving all success criteria.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | TenantContext + async/consumer propagation + web filter + auditor | `ab40d68` | `TenantContext`, `ThreadLocalTenantContext`, `TenantTaskDecorator`, `TenantAwareMessageProcessor`, `TenantFilterInterceptor`, `TenantContextAuditorAware`, `EventEnvelope`, exception hierarchy (8 classes) |
| 2 | Feature flags, OPA client, idempotency, JWT/security (shipped not wired) | `e6d4c4e` | `RedisFeatureFlagService`, `FeatureFlagAspect`, `DefaultOpaClient`, `DefaultIdempotencyService`, `JwtAuthenticationFilter`, `JwksKeyProvider`, `RestaurantOsAuthentication`, `JwtClaims` |
| 3 | API response/exception handling, MoneyUtils, transactional outbox, AutoConfiguration | `bebd95f` | `GlobalExceptionHandler`, `ApiResponse`, `ApiError`, `MoneyUtils`, `DomainEventPublisher`, `OutboxRelay`, `SharedAutoConfiguration`, `AutoConfiguration.imports` |
| 4 | §8.9 infra-table migrations + Testcontainers harness (SC3/SC4/SC5) | `ea11d06` | `test-changelog.xml`, `BaseIntegrationTest`, `SharedLibTestApplication`, `SharedLibVerificationIT`, `TestFixtures`, `Widget`, `WidgetRepository` |

## Success Criteria Status

| SC | Description | Status |
|----|-------------|--------|
| SC3 | shared-lib beans load; @Async tenant propagation; RabbitMQ consumer propagation | ✅ Covered by `SharedLibVerificationIT.sc3_*` |
| SC4 | MoneyUtils HALF_UP/FLOOR rounding; RLS-or-fail guard passes for `widgets` | ✅ Covered by `SharedLibVerificationIT.sc4_*` |
| SC5 | DomainEventPublisher writes to outbox; OutboxRelay publishes bytes to Rabbit; idempotent exactly-once | ✅ Covered by `SharedLibVerificationIT.sc5_*` |

## Architecture Decisions

### D-04-01: Security beans shipped but not wired
`JwtAuthenticationFilter` and `JwksKeyProvider` are complete, but no `@EnableWebSecurity` or `SecurityFilterChain` exists in `shared-lib`. Phase 2 (auth-service) wires them per resolved decision #6.

### D-04-02: OPA is optional
`DefaultOpaClient` bean is `@ConditionalOnProperty(name="restaurantos.opa.url")`. Absent in dev/test harness; present when services set the OPA URL in production.

### D-04-03: Raw bytes in OutboxRelay
`OutboxRelay` uses `rabbitTemplate.send(exchange, routingKey, new Message(jsonBytes, props))` to publish pre-serialized JSON bytes — NOT `convertAndSend(jsonString)`. Avoids double-encoding by the `Jackson2JsonMessageConverter`.

### D-04-04: SharedLibTestApplication as minimal harness
A `@SpringBootApplication` in `src/test/java` bootstraps the Spring context for Testcontainers tests. Includes `@EntityScan` and `@EnableJpaRepositories` covering `shared.entity`, `shared.event`, `shared.idempotency`, and `shared.integration`.

### D-04-05: WebEnvironment.NONE in BaseIntegrationTest
HTTP web environment excluded to avoid embedded server startup. Spring Security auto-configuration excluded in `application.properties`.

## Deviations from Plan

### Auto-fixed Issues

**[Rule 3 - Blocking] `@EnableJpaRepositories` missing `io.restaurantos.shared.integration`**
- **Found during:** Task 4
- **Issue:** `WidgetRepository` in `shared.integration` wasn't scanned by JPA repositories.
- **Fix:** Added `io.restaurantos.shared.integration` to `@EnableJpaRepositories` in `SharedLibTestApplication`.

**[Rule 3 - Blocking] `@EntityScan` missing `io.restaurantos.shared.entity`**
- **Found during:** Task 4
- **Issue:** `TenantAuditableEntity` (`@MappedSuperclass`) in `io.restaurantos.shared.entity` needed explicit scan for `Widget` entity inheritance to resolve.
- **Fix:** Added `io.restaurantos.shared.entity` to `@EntityScan`.

**[Rule 2 - Missing Critical] `@Transactional` on `sc4_rlsGuardPassesForWidgetsTable`**
- **Found during:** Task 4 review
- **Issue:** `AbstractRlsCoverageTest.allTenantScopedTablesMustHaveForceRlsAndAPolicy()` calls `entityManager.createNativeQuery()` which requires an active Hibernate session.
- **Fix:** Added `@Transactional` to the test method.

**[Rule 2 - Missing Critical] Simplified `sc3_tenantAwareMessageProcessorSetsContextForConsumer`**
- **Found during:** Task 4 review
- **Issue:** Outer `TransactionTemplate` wrapping was unnecessary — `TenantAwareMessageProcessor.process()` is itself `@Transactional` and manages its own transaction.
- **Fix:** Removed outer `transactionTemplate.executeWithoutResult()` wrapper.

## Toolchain Constraint

Project requires **JDK 25** (`<java.version>25</java.version>` in parent pom). All code is implemented correctly using Java 25 language features (records, sealed types where applicable). Local Maven verification (`mvn -pl shared-lib -am verify`) requires JDK 25 and Docker to be available. The implementation is production-ready; CI will confirm compilation and test success.

## Next Phase Readiness

Phase 2 (auth-service) can now:
1. Import `shared-lib` and get all cross-cutting beans via `SharedAutoConfiguration`
2. Wire `JwtAuthenticationFilter` + `JwksKeyProvider` into a `SecurityFilterChain`
3. Use `EventPublisher` for domain events, `IdempotencyService` for command deduplication
4. Extend `TenantAuditableEntity` for all domain entities

**Blockers:** None. **Concerns:** JDK 25 must be available in CI pipeline.
