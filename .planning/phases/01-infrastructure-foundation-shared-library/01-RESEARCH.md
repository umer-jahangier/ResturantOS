# Phase 1: Infrastructure Foundation & Shared Library - Research

**Researched:** 2026-06-23
**Domain:** Java 21 / Spring Boot 3.3 multi-module platform foundation; Docker-Compose dev infra (Postgres RLS, RabbitMQ, OPA, ClickHouse, MinIO); transactional outbox + multi-tenant `shared-lib`
**Confidence:** HIGH (the four agent-specs — 01, 02, 03, 05, 06, 08, 09, 10 — contain the exact intended implementation; this research distills them and flags the gaps the specs leave as implementation decisions)

## Summary

Phase 1 has two halves that the four plans split cleanly: (1) **dev infrastructure** — a `deploy/docker-compose.yml` plus init scripts that stand up Postgres 16 (13 databases + least-privilege roles + RLS-ready GUC), Redis 7, RabbitMQ 3.13 (topology pre-loaded), MinIO, OPA 0.65, ClickHouse 24, Eureka, Config Server, pgAdmin, Mailpit; and (2) the **`shared-lib`** jar that every later service imports, encoding tenant isolation (`TenantAuditableEntity` + Hibernate `@Filter` + Postgres RLS), BIGINT-paisa money, the transactional outbox, idempotency, the JWT filter, the OPA client, feature-flag aspect, and a Spring Boot auto-configuration that wires it all so importing the jar is sufficient.

The specs are unusually complete: every class in `shared-lib` is given verbatim (spec 03 + 09), the full compose file and init SQL are given (spec 06), every env var and `.env.example` is given (spec 05), and the Liquibase RLS/outbox/idempotency/processed_events patterns are given (spec 08 §8.6, §8.9). The planner's job is therefore **transcription with version pinning**, plus resolving a handful of genuine gaps the specs deliberately leave open: how `shared-lib` is verified with no real service, how SC4's "RLS-or-fail" guard is concretely enforced, and how many Maven modules the Phase-1 parent should declare.

**Primary recommendation:** Pin exactly `spring-boot-starter-parent 3.3.5` + `spring-cloud-dependencies 2023.0.3` (compatibility confirmed) and transcribe the spec classes 1:1. Verify `shared-lib` with a **test-only Spring Boot app inside `shared-lib/src/test`** driving Testcontainers (Postgres + RabbitMQ + Redis), a sample `TenantAuditableEntity` table, and a test Liquibase changelog — this single harness proves SC3 (bean resolution + `@Async`/Rabbit tenant propagation), SC4 (Money math + RLS-coverage guard), and SC5 (outbox exactly-once to an idempotent consumer). Scope the Phase-1 parent `<modules>` to only what exists now (`shared-lib`, `eureka-server`, `config-server`), not all 16 services.

---

## Standard Stack

These are **fixed by the specs — no substitutions** (context confirms). Versions come from agent-spec 01 §1.2 unless noted.

### Core (pinned in parent POM)
| Library / Tool | Version | Source of version | Notes |
|---|---|---|---|
| Java | 21 | spec 01 `<java.version>21` | LTS; toolchain target |
| Spring Boot (parent) | 3.3.5 | spec 01 `spring-boot-starter-parent` | provides `spring-boot-dependencies` BOM (manages Hibernate 6.5.x, Liquibase 4.29.x, Jackson, AMQP, Awaitility, AssertJ, Lombok) |
| Spring Cloud | 2023.0.3 (Leyton) | spec 01 `spring-cloud.version` | **BOM import** in `dependencyManagement`; Gateway/Config/Eureka/OpenFeign |
| MapStruct | **1.6.2** | spec 01 `mapstruct.version` | ⚠️ context said "1.5.x" — spec (superior) says **1.6.2**; use 1.6.2 (see Open Questions) |
| Lombok | Boot-managed | — | needs annotation-processor ordering with MapStruct (see Pitfalls) |
| jjwt (api/impl/jackson) | 0.12.6 | spec 01 `jjwt.version` | uses 0.12.x API (`Jwts.parser().verifyWith(..).build().parseSignedClaims(..)`) |
| Liquibase | 4.29.x (Boot-managed) | spec 08 uses `dbchangelog-4.29.xsd` | do NOT pin; inherit from Boot 3.3.5 |
| Hibernate ORM | 6.5.x (Boot-managed) | — | `@FilterDef`/`@Filter` for tenant filter |
| Testcontainers | 1.20.3 | spec 01 `testcontainers.version` | **add `testcontainers-bom` import** (property is set but BOM import is missing from the shown POM — see Pitfalls) |
| JUnit 5 + AssertJ + Awaitility | Boot-managed | spec 10 | Awaitility used for async/Rabbit assertions |

### Supporting libs needing EXPLICIT versions (not Boot-managed)
| Library | Purpose | Why explicit |
|---|---|---|
| `net.logstash.logback:logstash-logback-encoder` | JSON structured logs (`shared-lib` compile dep, spec 03 §3.1) | not in Boot BOM → pin a version (e.g. 7.4+) |
| `com.nimbusds:nimbus-jose-jwt` | JWKS parsing for `JwksKeyProvider` (spec 09 §9.2 comment: "use nimbus-jose-jwt JWKSet.load in prod") | not in `shared-lib` dep list but required to finish `JwksKeyProvider.refresh()` |

### `shared-lib` compile dependencies (spec 03 §3.1, verbatim)
`spring-boot-starter-web`, `-data-jpa`, `-security`, `-amqp`, `-aop`, `-data-redis`; `jjwt-api/impl/jackson`; `mapstruct`; `lombok`; `logstash-logback-encoder`. Packaging `jar`. Registers beans via auto-config (§3.12) → no `@ComponentScan` change in services.

### Infra images (spec 06, all multi-arch / Apple-Silicon OK unless flagged)
`postgres:16.4`, `redis:7.4`, `rabbitmq:3.13-management`, `minio/minio:RELEASE.2024-09-13T20-26-02Z`, `openpolicyagent/opa:0.65.0`, `clickhouse/clickhouse-server:24.8`, `axllent/mailpit:v1.20`, `dpage/pgadmin4:8.12`, plus **custom** `ghcr.io/restaurantos/eureka-server:1.0.0` and `config-server:1.0.0` (see Open Questions — these do not exist yet).

**Installation (parent `dependencyManagement` the planner must produce):**
```xml
<!-- in addition to spring-boot-starter-parent 3.3.5 -->
<dependencyManagement><dependencies>
  <dependency><groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-dependencies</artifactId>
    <version>2023.0.3</version><type>pom</type><scope>import</scope></dependency>
  <dependency><groupId>org.testcontainers</groupId>
    <artifactId>testcontainers-bom</artifactId>
    <version>1.20.3</version><type>pom</type><scope>import</scope></dependency>
  <dependency><groupId>io.restaurantos</groupId>
    <artifactId>shared-lib</artifactId><version>1.0.0</version></dependency>
</dependencies></dependencyManagement>
```

---

## Architecture Patterns

### Repository layout (spec 01 §1.1) — Phase-1 subset
```
restaurantos/
├── pom.xml                 # parent (restaurantos-parent 1.0.0)
├── shared-lib/             # the Phase-1 deliverable jar
├── eureka-server/          # needed for SC1 (Eureka healthy)
├── config-server/          # needed for SC1 (Config Server healthy)
├── policies/               # OPA Rego (≥1 placeholder for OPA mount to verify)
└── deploy/
    ├── docker-compose.yml
    ├── .env.example   (+ .env, gitignored)
    ├── Makefile or root Makefile  # `make dev-up` (SC1 wording)
    └── init/
        ├── 01-create-databases.sql
        ├── 02-create-roles.sql
        ├── rabbitmq.conf
        ├── rabbitmq-definitions.json
        └── clickhouse-init.sql
```
`services/*` are added in later phases — **do not** scaffold all 16 now (see Open Questions).

### `shared-lib` package layout (spec 01 §1.4) — the task checklist
```
io/restaurantos/shared/
├── entity/        TenantAuditableEntity
├── tenant/        TenantContext, ThreadLocalTenantContext, TenantTaskDecorator,
│                  TenantFilterInterceptor, TenantAwareMessageProcessor
├── security/      JwtAuthenticationFilter, JwksKeyProvider, JwtClaims, SecurityConfig,
│                  EncryptionService, EncryptedStringConverter
├── feature/       @RequiresFeature, FeatureFlagAspect, FeatureFlagService (+Redis impl)
├── authz/         OpaClient, DefaultOpaClient, OpaInput, OpaDecision, AuthorizationService
├── idempotency/   IdempotencyService (+impl), IdempotencyKey entity
├── event/         EventPublisher (+impl), EventEnvelope, OutboxEntry, OutboxRepository, OutboxRelay
├── api/           ApiResponse, ApiError, PageMeta, GlobalExceptionHandler
├── exception/     RestaurantOsException + 8 subclasses
├── money/         Money, MoneyUtils
└── config/        SharedAutoConfiguration, TenantContextAuditorAware, AsyncTenantConfig
```
Auto-config registered via `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` (spec 03 §3.12).

### Pattern 1: CRIT-01 — tenant propagation across `@Async` and RabbitMQ
**What:** The tenant id lives in a `ThreadLocal` (`ThreadLocalTenantContext`). It is empty on pool/consumer threads, so it MUST be propagated.
- `@Async`: a `TaskDecorator` (`TenantTaskDecorator`) snapshots the context on the calling thread and restores it on the pool thread inside `try/finally` (spec 03 §3.3, 09 §9.3). Wire it into a `ThreadPoolTaskExecutor`.
- RabbitMQ: consumers **never** query entities directly. They delegate to `TenantAwareMessageProcessor.process(envelope, handler)` which, inside `@Transactional`, (a) sets `TenantContext` from the envelope, (b) `session.enableFilter("tenantFilter")`, and (c) `SELECT set_config('app.current_tenant_id', :tid, true)` **on the same connection**, then runs the handler, then `clear()` in `finally`. The transaction-local `set_config(..., true)` is reset when the connection returns to the pool — preventing tenant bleed.

**Anti-pattern (spec 03 §3.3):** a raw `@RabbitListener` that calls a repository directly → RLS returns zero rows and the Hibernate filter is off. The plan's verification MUST include a test that proves the wrong way returns nothing and the right way returns the row.

### Pattern 2: MAJOR-12 — transactional outbox (no direct RabbitTemplate from business code)
`EventPublisher.publish(...)` writes an `OutboxEntry` (status `PENDING`, the serialized `EventEnvelope` JSON) **inside the caller's `@Transactional`**. `OutboxRelay` (`@Scheduled(fixedDelay=1000)`, `@Transactional`) polls `findTop200ByStatusOrderByCreatedAtAsc("PENDING")` and `convertAndSend`s, flipping to `SENT`. At-least-once delivery is safe because consumers are idempotent. The `event_outbox`, `idempotency_keys`, `processed_events` tables are **NOT shipped by `shared-lib`** (it has no migrations) — each consuming/publishing service creates them via Liquibase (spec 08 §8.9). They are **not** tenant-scoped and get **no** RLS policy.

### Pattern 3: Multi-tenant entity + RLS (the core invariant)
`TenantAuditableEntity` (`@MappedSuperclass`, `@FilterDef name="tenantFilter"`, `@Filter condition="tenant_id = :tenantId"`, Spring Data auditing, soft-delete `deleted_at`). Defense-in-depth = Hibernate filter (app layer) **+** Postgres RLS (`ENABLE` + `FORCE ROW LEVEL SECURITY` + `CREATE POLICY tenant_isolation USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)`) immediately after each `createTable` (spec 08 §8.6). Service roles are `NOSUPERUSER NOBYPASSRLS` (spec 06 §6.3) so RLS is never bypassed.

### Anti-Patterns to Avoid
- **Hard-coding versions in child modules** — child POMs reference `shared-lib` with no `<version>` (inherited).
- **Direct `RabbitTemplate.send` from a service** — use the outbox.
- **`@Transactional` on controllers/repositories** — service layer only (spec 07 §7.1.3).
- **`double`/`float` or `NUMERIC` for money** — `long` paisa / `BIGINT` (spec 07 §7.1.9, 08 §8.12; inventory *quantities* are `NUMERIC(18,4)`).
- **`TIMESTAMP` instead of `TIMESTAMPTZ`**, **`ON DELETE CASCADE` toward financial rows** (spec 08 §8.12).

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Reliable event publish | custom "send then save" | the spec's transactional outbox (`EventPublisher`+`OutboxRelay`) | avoids phantom/lost events on rollback/broker-down |
| Tenant isolation | manual `WHERE tenant_id=?` in every query | Hibernate `@Filter` + Postgres RLS (both) | one missed query = cross-tenant leak |
| Async/consumer context | manual thread juggling | `TaskDecorator` + `TenantAwareMessageProcessor` | ThreadLocal leaks / empty context bugs |
| Money formatting | `paisa/100.0` ad hoc | `MoneyUtils` (`en-PK`, HALF_UP) | rounding + locale correctness |
| Idempotency | bespoke dedup | `IdempotencyService` (HTTP) + `processed_events` (consumers) | exactly-once semantics |
| Error→HTTP mapping | per-controller try/catch | `GlobalExceptionHandler` + exception hierarchy | uniform `ApiError` envelope + codes |
| RabbitMQ topology | imperative `@Bean Queue/Exchange/Binding` in code | pre-loaded `rabbitmq-definitions.json` (spec 06 §6.4) | topology exists on first boot, SC2 |
| RS256 + AES keys | committing dev keys | `generate-keys.sh` (openssl) writing to `.env` | SC2; no secrets in git |

**Key insight:** In this codebase the "platform invariants" (tenancy, money, events) are centralized in `shared-lib` precisely so services can't re-implement them inconsistently. Phase 1 is where those primitives are forged; downstream phases only consume them.

---

## How to verify `shared-lib` with no real service (resolves SC3/SC5 — implementation decision)

**Recommendation: a test-only Spring Boot application inside `shared-lib/src/test`** (NOT a separate `sample-service` module). Rationale: lightest reactor, no extra module to maintain, and it literally *is* "a sample service importing shared-lib." Eureka/Config-Server modules can't serve this role (they don't import the JPA/tenant stack).

Build this harness:
1. `src/test/.../TestApp` — a `@SpringBootApplication` (+ `@EnableScheduling`, `@EnableAsync`) that pulls in `SharedAutoConfiguration`.
2. A sample entity `WidgetEntity extends TenantAuditableEntity` (proves the mapped-superclass + filter compile and map).
3. A test Liquibase changelog creating `widgets` (+ its RLS changeset), `event_outbox`, `idempotency_keys`, `processed_events` — exactly per spec 08 §8.6/§8.9.
4. `BaseIntegrationTest` per spec 10 §10.1: Testcontainers `postgres:16.4` + `redis:7.4` + `rabbitmq:3.13-management`, Liquibase on context start, `set_config('app.current_tenant_id', …, false)` in `@BeforeEach`.
5. Stub external calls so the context starts without a live Auth/OPA: provide a test `FeatureFlagService` bean (or real Redis-backed one against the Redis container), a test `JwksKeyProvider`/`OpaClient`, or avoid the web-security slice entirely for the JPA/outbox tests.

Then the verification tests:
- **SC3 — bean resolution:** assert the context contains `TenantContext`, `MoneyUtils` (static, just reference), `OpaClient`, `IdempotencyService`, `EventPublisher`, and `WidgetEntity` maps. **`@Async` propagation:** set context on the main thread, call an `@Async` method that reads `tenantContext.requireTenantId()`, assert it matches. **Rabbit propagation:** publish an envelope to a test queue, consume via `TenantAwareMessageProcessor`, assert the handler saw the right tenant AND that an RLS-scoped `widgets` query returned the row (and the anti-pattern returned none).
- **SC4 — Money:** unit-test per-line floored tax with HALF_UP on BIGINT paisa (pure unit test, no container). Plus the RLS-coverage guard (below).
- **SC5 — outbox exactly-once:** in one `@Transactional`, mutate a `WidgetEntity` and `EventPublisher.publish(...)`; let `OutboxRelay` deliver; consumer (with `processed_events` dedup) applies once; **re-deliver the same `eventId` → no-op**. Use Awaitility (spec 10 §10.3).

**SC5 serialization gotcha (flag for planner):** `OutboxRelay` sends the stored **JSON String** via `convertAndSend`. With the default Jackson converter this double-encodes the string and the `@RabbitListener<EventEnvelope<T>>` won't deserialize. The relay must publish the raw JSON as bytes with `contentType=application/json` (build a `Message` with explicit `MessageProperties`), and the consumer's converter must reconstruct the generic `EventEnvelope<Payload>` (the listener method's parameter type drives Jackson; verify generic type handling). Bake this into the outbox task.

---

## How to enforce SC4 "tenant-scoped table without RLS changeset fails the build" (implementation decision)

The specs state the *rule* (spec 08 §8.6, §8.12.5) and mention an unrelated CI scan (BLR-2, which checks audit *columns*, spec 08 §8.4) — but the **RLS-presence check is unspecified**. Propose a concrete, reusable mechanism that lives in `shared-lib` test-support so every later service inherits it:

**Recommended: a runtime DB-state guard (`AbstractRlsCoverageTest`)** that runs after Liquibase against the Testcontainers Postgres and asserts, for every base table carrying a `tenant_id` column (excluding the known non-tenant infra tables `event_outbox`, `idempotency_keys`, `processed_events`):
```sql
-- candidate tenant-scoped tables
SELECT table_name FROM information_schema.columns
 WHERE column_name='tenant_id' AND table_schema='public';
-- for each: RLS must be enabled AND a policy must exist
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ?;   -- both true
SELECT count(*) FROM pg_policies WHERE tablename = ?;                          -- >= 1
```
Fail the test (→ fail `mvn verify`/CI) if any candidate table lacks `relrowsecurity=true` / `relforcerowsecurity=true` / a policy. This is more robust than XML parsing because it checks the *actual* applied schema. Optionally pair with a lightweight static changelog scanner for fast local feedback.

**Phase-1 proof of the guard:** the `widgets` sample table (with its RLS changeset) passes; a deliberately-omitted-RLS table fixture makes the guard fail — demonstrating SC4's "fails the build."

---

## Common Pitfalls (infra + build gotchas — Research Focus 4)

### Pitfall 1: Eureka & Config-Server images don't exist yet
**What:** `docker-compose.yml` references `ghcr.io/restaurantos/eureka-server:1.0.0` and `config-server:1.0.0`. These are this project's own modules and are not published. `make dev-up` (SC1) will fail to pull them.
**Fix:** Phase 1 MUST scaffold `eureka-server/` and `config-server/` Spring Boot modules and either (a) build local images tagged to match, or (b) change those two compose services to `build:` stanzas. **This is scope the 4 sketched plans don't name explicitly** — likely belongs in 01-01. (See Open Questions.)

### Pitfall 2: `make dev-up` target must be created
Spec 06 says `docker compose up -d`; SC1 says `make dev-up`. Add a `Makefile` with `dev-up`/`dev-down`/`dev-logs` wrapping compose (+ the first-run steps in spec 06 §6.6: create MinIO bucket, verify health).

### Pitfall 3: RabbitMQ definitions password & double-load
- `rabbitmq-definitions.json` embeds a **plaintext, hard-coded** `users[].password` ("your-rabbitmq-password") — JSON is **not** env-interpolated, so it won't track `${RABBITMQ_PASSWORD}`. Either keep it byte-for-byte in sync with `.env`, or generate the definitions file from `.env` in `generate-keys.sh`/Makefile, or use `password_hash`. 
- Both `RABBITMQ_DEFINITIONS_FILE` (env) **and** `rabbitmq.conf load_definitions` are set — redundant. For 3.13 the canonical path is `rabbitmq.conf load_definitions`; the definitions user can collide with `RABBITMQ_DEFAULT_USER`. Prefer the conf approach and ensure the defined user matches the default user/password.

### Pitfall 4: MinIO healthcheck uses `mc`
`healthcheck: ["CMD","mc","ready","local"]` — recent MinIO **server** images dropped the `mc` client, so this can fail and never report healthy (blocking dependents). Safer: `wget -q --spider http://localhost:9000/minio/health/live` (or curl). Validate against the pinned `RELEASE.2024-09-13` tag; adjust if `mc` is absent.

### Pitfall 5: Custom GUC `app.current_tenant_id`
`current_setting('app.current_tenant_id', true)` works without pre-registration because the name is namespaced (contains a dot) and `set_config(..., true)` is transaction-local. SC1's phrase "role … has the `app.current_tenant_id` SET param" is satisfied by the app setting it per transaction — `02-create-roles.sql` deliberately contains **no** `ALTER ROLE … SET`. Don't add one; it would pin a static tenant.

### Pitfall 6: Seed inserts under `FORCE ROW LEVEL SECURITY`
A policy with only `USING` is also applied as `WITH CHECK` for INSERT. Inserting a row when `app.current_tenant_id` is unset (e.g., Liquibase seed running after RLS is enabled) → `current_setting(...,true)` is NULL → predicate false → **INSERT blocked**. Not a Phase-1 blocker (Phase-1 system seeds like roles are non-tenant-scoped), but flag for Finance/HR seeds (spec 08 §8.6 COA uses `tenant_id='000…0'`): either seed before enabling RLS, or `SET app.current_tenant_id` to the system tenant during the seed changeset, or add a `WITH CHECK` exception.

### Pitfall 7: Lombok + MapStruct annotation-processor ordering
MapStruct 1.6.2 + Lombok require `maven-compiler-plugin` `annotationProcessorPaths` in order: `lombok`, then `mapstruct-processor`, plus `org.projectlombok:lombok-mapstruct-binding`. Omitting the binding → MapStruct can't see Lombok getters/setters and silently maps nulls.

### Pitfall 8: Testcontainers BOM not imported
Spec 01 sets `<testcontainers.version>` but the shown `dependencyManagement` only imports spring-cloud + shared-lib. Without the `testcontainers-bom` import (or per-artifact versions) `postgresql`/`rabbitmq`/`junit-jupiter` Testcontainers artifacts won't resolve. Add the BOM (shown above).

### Pitfall 9: OPA empty policy dir
OPA 0.65 `run --server /policies` starts fine with an empty dir, but spec 06 §6.6 verifies `GET /v1/policies | grep restaurantos`. Phase-1 `policies/` should contain at least a placeholder `restaurantos/common.rego` so the OPA mount is demonstrably loaded (real Rego arrives in Phase 2).

### Pitfall 10: Multiline RS256 PEM in `.env`
`JWT_PRIVATE_KEY` is a multi-line PEM; `.env`/Docker env do not handle newlines cleanly. Decide a storage form (base64-encode the PEM into one line and decode in-app, or single-line `\n`-escaped). `generate-keys.sh` should emit whatever form the app expects. (Auth-service consumes this in Phase 2, but `generate-keys.sh` is a Phase-1 SC2 deliverable.)

### Pitfall 11: ClickHouse init file must exist + `nofile` ulimits
`./init/clickhouse-init.sql` is mounted read-only; if missing, the container errors. Provide at least a minimal file. Keep `ulimits.nofile 262144`. `clickhouse-server:24.8` has arm64 images (Apple-Silicon OK). `/docker-entrypoint-initdb.d` runs only on first init (empty volume) — re-running needs a volume reset.

---

## Code Examples (verified from specs — for planner reference)

### Money per-line floored tax (SC4) — the unit to test
```java
// Source: spec 03 §3.11 (MoneyUtils) + spec 07 §7.1.9 rules
// Tax floored per line on BIGINT paisa; HALF_UP only at the BigDecimal boundary.
long taxPaisa = BigDecimal.valueOf(lineTotalPaisa)
        .multiply(taxRate)                       // e.g. 0.13
        .setScale(0, RoundingMode.HALF_UP)       // per-line rounding
        .longValueExact();
```

### RLS changeset immediately after createTable (spec 08 §8.6)
```xml
<sql splitStatements="true" endDelimiter=";">
  ALTER TABLE widgets ENABLE ROW LEVEL SECURITY;
  ALTER TABLE widgets FORCE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON widgets
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
  GRANT SELECT, INSERT, UPDATE, DELETE ON widgets TO <service>_user;
</sql>
```

### Consumer (the only sanctioned form — spec 09 §9.3)
```java
@RabbitListener(queues = "…queue")
public void onEvent(EventEnvelope<Payload> env) {
    processor.process(env, e -> service.handle(e.payload(), e.eventId())); // dedup via processed_events
}
```

---

## State of the Art

| Old / wrong | Current (spec-mandated) | Impact |
|---|---|---|
| jjwt 0.11 `parserBuilder().setSigningKey()` | jjwt 0.12.6 `parser().verifyWith().build().parseSignedClaims()` | spec 09 code uses 0.12 API |
| RestTemplate | `RestClient` (OPA client, JWKS) | spec 03/09 use `RestClient` (Boot 3.2+) |
| Spring Cloud 2022.x | **2023.0.3 (Leyton)** with Boot 3.3.x | confirmed compatible (below) |
| `password_hash`-only Rabbit definitions | `password` field auto-hashed on import (3.13) | works, but sync gotcha (Pitfall 3) |

**Confirmed compatibility (HIGH):** Spring Cloud release-train **2023.0.x (Leyton) supports Spring Boot 3.2.x and 3.3.x**; maintainer confirmed **2023.0.3 works with Spring Boot 3.3.x** (spring.io project page; spring-cloud-release "Supported Versions" wiki; spring-cloud-config issue #2559). The spec's pin of Boot 3.3.5 + Cloud 2023.0.3 is correct — use it as-is.

---

## Open Questions (genuine ambiguities — flag, don't invent)

1. **Maven parent `<modules>` scope for Phase 1.** Spec 01 §1.2 shows the *final* parent listing all 16 service modules + gateway/config/eureka. If listed before the directories exist, `mvn` fails. **Recommendation:** Phase-1 parent declares only `shared-lib`, `eureka-server`, `config-server`; add service modules in their own phases. Planner should confirm this trimmed list (and that the spec POM is the eventual target, not the Phase-1 state).

2. **Eureka-server & Config-server are implied Phase-1 work but not in the 4 plan titles.** SC1 requires both healthy, and compose references custom images that don't exist. **Recommendation:** add their scaffolding to plan 01-01 (or note an implicit 5th deliverable). Decision needed: build local images vs. `build:` compose stanzas vs. run from IDE (SC1 says `make dev-up` → favor `build:` or pre-built local images).

3. **`shared-lib` verification vehicle.** Test-only Spring Boot app in `shared-lib/src/test` (recommended) vs. a dedicated `sample-service` module. Recommendation = test sources (lighter, satisfies SC3/SC5). Confirm.

4. **SC4 enforcement mechanism** is unspecified by the docs. Recommended = runtime `AbstractRlsCoverageTest` querying `pg_class`/`pg_policies` after Liquibase (+ optional static scanner). Confirm this is acceptable as the "build check."

5. **MapStruct version conflict.** Phase context says "MapStruct 1.5.x"; agent-spec 01 (source of truth, declared superior) pins **1.6.2**. **Recommendation:** use 1.6.2 (spec wins). Flag so the planner doesn't accidentally pin 1.5.x from the prompt.

6. **`SecurityConfig`/`JwtAuthenticationFilter` auto-config boundary.** Spec 03 §3.12's auto-config `@Bean` list does **not** include `SecurityConfig`/`JwtAuthenticationFilter`/`JwksKeyProvider` (those live in `shared-lib.security`, spec 09). Unclear whether the security chain is auto-applied to every importing service or opted-in per service. For Phase-1 verification this is avoidable (test the JPA/tenant/outbox slices without the web-security layer), but the planner should decide the wiring contract for downstream services.

7. **RabbitMQ definitions completeness.** Spec 06 §6.4 ships a *representative* topology; spec 02 §2.2 lists the full exchange/queue/DLQ set. SC2 says "every exchange, queue, and per-consumer DLQ." Decision: generate the full §2.2 topology now, or only the exchanges + the few queues whose consumers exist later? **Recommendation:** create all 10 exchanges + `restaurantos.dlx` now (cheap, stable), and the queues/DLQs that §2.2 enumerates; per-service queues can be added as consumers arrive. Confirm scope for SC2.

---

## Sources

### Primary (HIGH confidence)
- `Docs/agent-specs/01-project-scaffold.md` — monorepo layout, parent POM, version properties, package naming
- `Docs/agent-specs/02-event-schema-registry.md` — envelope, RabbitMQ topology, DLQ policy, `processed_events`, idempotency pattern
- `Docs/agent-specs/03-shared-lib-specification.md` — every `shared-lib` class (verbatim), auto-config, CRIT-01/MAJOR-12, §8.9 table note
- `Docs/agent-specs/05-environment-variables.md` — full var table + `.env.example`
- `Docs/agent-specs/06-dev-docker-compose.md` — compose file, init SQL, roles, rabbitmq-definitions, OPA mount, first-run commands
- `Docs/agent-specs/08-database-migration-guide.md` — Liquibase conventions, §8.6 RLS + deferred JE trigger, §8.9 shared infra tables
- `Docs/agent-specs/09-security-implementation-guide.md` — JWT filter, JWKS, tenant interceptor, OPA integration, AES-GCM
- `Docs/agent-specs/07-coding-standards.md` — Java/TS conventions, money/timestamp rules, BLR-2 note
- `Docs/agent-specs/10-test-architecture-guide.md` — `BaseIntegrationTest`, fixtures, Rabbit consumer test pattern, coverage gates
- spring.io / spring-cloud-release wiki / spring-cloud-config #2559 — Boot 3.3.x ↔ Cloud 2023.0.3 compatibility

### Secondary (MEDIUM)
- Coding Steve "Spring Version Compatibility Cheatsheet"; Azure spring-cloud timeline — corroborate 2023.0.3↔3.3.x pairing

## Metadata
**Confidence breakdown:**
- Standard stack: HIGH — pinned in specs; Boot↔Cloud verified against official sources
- Architecture / class inventory: HIGH — verbatim in specs 03/09
- Infra gotchas: MEDIUM-HIGH — derived from specs + known Docker image/RLS behaviors; Pitfalls 1, 3, 4 warrant a quick `docker compose up` smoke test during execution
- Verification approach & SC4 guard: MEDIUM — these are the deliberate spec gaps; recommendations are sound but are decisions the planner/user should confirm

**Research date:** 2026-06-23
**Valid until:** ~2026-07-23 (stable stack; re-check only if Spring Boot/Cloud or pinned image tags change)
