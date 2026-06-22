---
phase: 01-infrastructure-foundation-shared-library
verified: 2026-06-23T01:55:00Z
status: gaps_found
score: 4/5 must-haves verified
gaps:
  - truth: "A published domain event is delivered exactly once to an idempotent consumer — duplicate delivery is a no-op via `processed_events`"
    status: failed
    reason: "`processed_events` table is created in test-changelog.xml but has NO backing entity class, repository, or consumer code. The SC5 test proves idempotency via `idempotency_keys` (HTTP request idempotency) instead of `processed_events` (consumer-side event deduplication). No code ever writes to or reads from `processed_events`."
    artifacts:
      - path: "shared-lib/src/main/java/io/restaurantos/shared/"
        issue: "No ProcessedEvent entity, no ProcessedEventRepository, no consumer-side dedup logic using processed_events anywhere in shared-lib/src/main/java/"
      - path: "shared-lib/src/test/java/io/restaurantos/shared/integration/SharedLibVerificationIT.java"
        issue: "sc5_idempotentConsumerProcessesEventExactlyOnce uses idempotency_keys via IdempotencyService, NOT processed_events. The test never redelivers a message to a @RabbitListener and asserts it was skipped via processed_events."
    missing:
      - "A `ProcessedEvent` entity or JDBC helper mapping to the `processed_events(consumer, event_id)` table"
      - "Consumer-side deduplication logic: before processing a message, INSERT into processed_events (consumer, event_id); if duplicate key → skip (exactly-once semantics)"
      - "SC5 test update: redeliver the same EventEnvelope, assert the second delivery is a no-op by querying processed_events row count"
human_verification:
  - test: "Run `make dev-up` from repo root"
    expected: "All 9 infra containers (postgres:18.4, redis:8.2, rabbitmq:4.3-management, minio, openpolicyagent/opa:1.17.1, eureka-server, config-server, clickhouse/clickhouse-server:25.9, pgadmin) reach healthy state; `docker compose ps` shows all healthy"
    why_human: "Cannot execute `docker compose up` in this environment; requires Docker daemon and network access"
  - test: "Run `psql -U postgres -c '\\l'` on the running postgres container"
    expected: "Exactly 13 databases listed (platform_db, auth_db, user_db, pos_db, inventory_db, finance_db, purchasing_db, hr_db, crm_db, kitchen_db, notification_db, audit_db, file_db)"
    why_human: "Requires running Docker container"
  - test: "Run `bash deploy/generate-keys.sh` then inspect `deploy/.env`"
    expected: "`grep -c '^JWT_PRIVATE_KEY=' deploy/.env` == 1; `grep -c '^JWT_PUBLIC_KEY=' deploy/.env` == 1; `grep -c '^FIELD_ENCRYPTION_KEY=' deploy/.env` == 1; running it twice does not duplicate lines; decoding FIELD_ENCRYPTION_KEY yields 32 bytes"
    why_human: "Script is executable but requires shell execution in deploy/ context"
  - test: "Open RabbitMQ management UI at http://localhost:15672 after `make dev-up`"
    expected: "Exchanges tab shows: pos.topic, inventory.topic, finance.topic, purchasing.topic, hr.topic, auth.topic, platform.topic, kitchen.topic, notifications.topic + restaurantos.dlx; Queues tab shows 20 queues (10 real + 10 .dlq siblings); audit.all-events.queue has 9 bindings from all topic exchanges with routing key #"
    why_human: "Requires running stack and browser access"
  - test: "Run `mvn -pl shared-lib -am verify` (requires Docker for Testcontainers)"
    expected: "SharedLibVerificationIT passes GREEN; JaCoCo coverage ≥ 70%; sc3_*, sc4_*, sc5_* tests all pass"
    why_human: "Requires Docker daemon for Testcontainers (PostgreSQL 18 + RabbitMQ 4.3 + Redis 8 containers)"
---

# Phase 1: Infrastructure Foundation & Shared Library — Verification Report

**Phase Goal:** Stand up the complete dev infrastructure and the shared-lib so that every downstream service inherits multi-tenant isolation, BIGINT-paisa money handling, and the event/outbox primitives by default — with nothing tenant-business yet built.

**Verified:** 2026-06-23T01:55:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `make dev-up` brings all infrastructure containers to healthy | ? UNCERTAIN | Makefile + docker-compose.yml verified structurally; all 9 pinned image tags present, no ghcr.io references, local builds for eureka/config; requires Docker to confirm runtime health |
| 2 | RabbitMQ boots with full exchange/queue/DLQ topology; `generate-keys.sh` writes RS256 + AES-256 key into `.env`; `.env.example` documents every variable | ✓ VERIFIED | 9 topic exchanges + restaurantos.dlx confirmed via json.load; 20 queues (10 real + 10 .dlq); audit.all-events.queue has 9 bindings (#); rabbitmq.conf present with load_definitions; generate-keys.sh contains openssl genpkey + FIELD_ENCRYPTION_KEY; .env.example has all 3 key placeholders |
| 3 | A service importing `shared-lib` resolves `TenantContext`, `MoneyUtils`, `OpaClient`, `IdempotencyService`, `DomainEventPublisher`; tenant context propagates through @Async and RabbitMQ consumer | ✓ VERIFIED | All 5 types exist as substantive interfaces + implementations; SharedAutoConfiguration wires them via AutoConfiguration.imports; TenantTaskDecorator implements TaskDecorator; TenantAwareMessageProcessor sets app.current_tenant_id; SharedLibVerificationIT has SC3 tests (runtime proof requires `mvn verify`) |
| 4 | `MoneyUtils` computes per-line floored tax with half-up rounding on BIGINT paisa; tenant-scoped table without RLS changeset fails migration/build check | ✓ VERIFIED | MoneyUtils.java (50 lines) uses RoundingMode.HALF_UP; AbstractRlsCoverageTest queries relforcerowsecurity + pg_policies, excludes infra tables; widgets table in test-changelog has immediate RLS changeset; SharedLibVerificationIT has SC4 tests |
| 5 | A published domain event carries the standard envelope and is delivered exactly once to an idempotent consumer — duplicate delivery is a no-op via `processed_events`, proving the transactional outbox publishes on commit | ✗ FAILED | EventEnvelope carries all standard fields (eventId, eventType, tenantId, branchId, occurredAt, correlationId, schemaVersion, source, payload); DomainEventPublisher writes to event_outbox ✓; OutboxRelay publishes via RabbitTemplate and marks SENT ✓; BUT `processed_events` table has NO entity/repository/code — zero references in `shared-lib/src/main/java/`. SC5 test uses `idempotency_keys` instead |

**Score:** 4/5 truths verified (1 gap, 1 uncertain/human-needed)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `pom.xml` | Maven parent with Boot 4.0.7, spring-cloud 2025.1.0, testcontainers-bom, only 3 modules | ✓ VERIFIED | Boot 4.0.7, spring-cloud.version=2025.1.0, testcontainers-bom present; modules: shared-lib, eureka-server, config-server |
| `deploy/docker-compose.yml` | 9 infra services + mailpit/pgadmin, local builds for eureka/config, no ghcr.io | ✓ VERIFIED | build: stanzas for eureka-server + config-server; `grep -c "ghcr.io"` = 0 |
| `deploy/Makefile` | dev-up/dev-down/dev-logs/dev-ps + guard for missing .env | ✓ VERIFIED | _check-env guard present; all 4 targets present; delegates to docker compose |
| `Makefile` (root) | delegates `make dev-up` to deploy/ | ✓ VERIFIED | `$(MAKE) -C deploy dev-up` for all 4 targets |
| `eureka-server/...EurekaServerApplication.java` | @EnableEurekaServer on port 8761 | ✓ VERIFIED | @EnableEurekaServer present |
| `config-server/...ConfigServerApplication.java` | @EnableConfigServer on port 8888 | ✓ VERIFIED | @EnableConfigServer present |
| `eureka-server/Dockerfile` | Multi-stage local build | ✓ VERIFIED | File exists |
| `config-server/Dockerfile` | Multi-stage local build | ✓ VERIFIED | File exists |
| `deploy/init/01-create-databases.sql` | 13 CREATE DATABASE statements | ✓ VERIFIED | Exactly 13 CREATE DATABASE entries |
| `deploy/init/02-create-roles.sql` | 13 NOSUPERUSER NOBYPASSRLS roles | ✓ VERIFIED | 13 NOSUPERUSER NOBYPASSRLS entries; no ALTER ROLE SET app.current_tenant_id |
| `deploy/init/rabbitmq.conf` | `load_definitions = /etc/rabbitmq/definitions.json` | ✓ VERIFIED | Exact content confirmed |
| `deploy/init/rabbitmq-definitions.json` | 9 topic exchanges + restaurantos.dlx; all queues with .dlq siblings; audit.all-events.queue bound to all 9 with # | ✓ VERIFIED | Exchanges: 10 (9 topic + dlx); Queues: 20 (10+10 DLQs); audit.all-events.queue: 9 bindings, all topic exchanges, routing key # |
| `deploy/init/clickhouse-init.sql` | CREATE DATABASE IF NOT EXISTS clickhouse_analytics | ✓ VERIFIED | File exists |
| `deploy/generate-keys.sh` | openssl genpkey → RS256 + AES-256 → deploy/.env; idempotent | ✓ VERIFIED | openssl genpkey present; FIELD_ENCRYPTION_KEY via openssl rand; idempotent key replacement logic |
| `deploy/.env.example` | Every variable from agent-spec 05; JWT_PRIVATE_KEY/JWT_PUBLIC_KEY/FIELD_ENCRYPTION_KEY as placeholders | ✓ VERIFIED | All 3 key placeholders present with dev defaults |
| `policies/restaurantos/common.rego` | Rego v1 syntax; same_tenant_and_branch, same_tenant, has_permission | ✓ VERIFIED | package restaurantos.common; all 3 rules with `if` keyword |
| `shared-lib/src/main/java/.../entity/TenantAuditableEntity.java` | @FilterDef("tenantFilter"), Instant audit fields, deleted_at | ✓ VERIFIED | @FilterDef(name = "tenantFilter") + @Filter present; Instant typed audit fields |
| `shared-lib/src/test/java/.../testsupport/AbstractRlsCoverageTest.java` | Queries relforcerowsecurity + pg_policies; excludes event_outbox/idempotency_keys/processed_events | ✓ VERIFIED | 7 references to relforcerowsecurity/pg_policies; excludes all 3 infra tables |
| `shared-lib/src/main/java/.../tenant/TenantContext.java` | ThreadLocal tenant/branch/userId | ✓ VERIFIED | ThreadLocalTenantContext.java is the implementation |
| `shared-lib/src/main/java/.../tenant/TenantTaskDecorator.java` | implements TaskDecorator for @Async propagation | ✓ VERIFIED | implements TaskDecorator; 18 lines substantive |
| `shared-lib/src/main/java/.../tenant/TenantAwareMessageProcessor.java` | Sets app.current_tenant_id per RabbitMQ message | ✓ VERIFIED | Contains `set_config('app.current_tenant_id', ...)` |
| `shared-lib/src/main/java/.../money/MoneyUtils.java` | BIGINT-paisa arithmetic with RoundingMode.HALF_UP | ✓ VERIFIED | 50 lines; RoundingMode.HALF_UP; BigDecimal arithmetic |
| `shared-lib/src/main/java/.../authz/OpaClient.java` + `DefaultOpaClient.java` | Fail-closed; reads OPA_URL | ✓ VERIFIED | Interface + 32-line impl; "fail-closed" comment; reads OPA_URL baseUrl |
| `shared-lib/src/main/java/.../idempotency/IdempotencyService.java` + `DefaultIdempotencyService.java` | checkAndLock/markComplete/getCompletedResponse using idempotency_keys | ✓ VERIFIED | Interface + 61-line impl |
| `shared-lib/src/main/java/.../event/DomainEventPublisher.java` | Writes EventEnvelope to event_outbox within caller's @Transactional | ✓ VERIFIED | 66 lines; references event_outbox via OutboxRepository; serializes EventEnvelope |
| `shared-lib/src/main/java/.../event/OutboxRelay.java` | Polls PENDING rows, publishes via RabbitTemplate, marks SENT | ✓ VERIFIED | References RabbitTemplate + PENDING status |
| `shared-lib/src/main/java/.../event/EventEnvelope.java` | Standard envelope with eventId, eventType, tenantId, branchId, occurredAt, correlationId, schemaVersion, source, payload | ✓ VERIFIED | All 9 fields present in record |
| `shared-lib/src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` | Registers SharedAutoConfiguration | ✓ VERIFIED | `io.restaurantos.shared.config.SharedAutoConfiguration` registered |
| `shared-lib/src/main/java/.../security/JwtAuthenticationFilter.java` | Shipped, NOT wired into SecurityFilterChain | ✓ VERIFIED | No @EnableWebSecurity or SecurityFilterChain bean found in main sources |
| `shared-lib/src/test/resources/db/changelog/test-changelog.xml` | event_outbox + idempotency_keys + processed_events infra tables; widgets with immediate RLS | ✓ VERIFIED | All 3 infra tables present; widgets table followed by RLS changeset (ENABLE + FORCE + CREATE POLICY) |
| `shared-lib/src/test/java/.../integration/BaseIntegrationTest.java` | @Testcontainers with PostgreSQLContainer | ✓ VERIFIED | PostgreSQLContainer import + @Testcontainers annotation |
| `shared-lib/src/test/java/.../integration/SharedLibVerificationIT.java` | SC3 + SC4 + SC5 tests | ⚠️ PARTIAL | SC3 (beans + @Async + RabbitMQ propagation) ✓; SC4 (MoneyUtils + RLS guard) ✓; SC5 outbox→relay→RabbitMQ ✓; BUT SC5 exactly-once via processed_events ✗ |
| **MISSING** | ProcessedEvent entity/repository for consumer-side deduplication via processed_events | ✗ MISSING | `processed_events` table created but never written to by any Java code |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `deploy/docker-compose.yml` | `eureka-server/Dockerfile` | `build.dockerfile: eureka-server/Dockerfile` | ✓ WIRED | build: stanza present with correct Dockerfile path |
| `deploy/docker-compose.yml` | `policies/` | `../policies:/policies:ro` OPA volume mount | ✓ WIRED | OPA mount pattern confirmed in compose |
| `deploy/init/rabbitmq-definitions.json` | RabbitMQ docker compose | Mounted at /etc/rabbitmq/definitions.json | ✓ WIRED | rabbitmq.conf load_definitions references mounted path |
| `deploy/generate-keys.sh` | `deploy/.env` | Writes JWT_PRIVATE_KEY / JWT_PUBLIC_KEY / FIELD_ENCRYPTION_KEY | ✓ WIRED | Script output variables confirmed in code |
| `shared-lib/...TenantAwareMessageProcessor.java` | `TenantContext` + `app.current_tenant_id` GUC | reads envelope tenantId, sets context + RLS GUC | ✓ WIRED | `set_config('app.current_tenant_id', :tid, true)` confirmed |
| `shared-lib/...OutboxRelay.java` | `RabbitTemplate` + `event_outbox` table | polls PENDING rows, publishes, marks SENT | ✓ WIRED | RabbitTemplate import + PENDING status check confirmed |
| `SharedLibVerificationIT` | Testcontainers Postgres 18 + RabbitMQ 4.3 | @Testcontainers static containers | ✓ WIRED | PostgreSQLContainer static container declared |
| `processed_events` table | Any consumer dedup code | INSERT before processing event_id per consumer | ✗ NOT WIRED | Table exists in DB schema; zero Java code reads/writes it |

---

### Requirements Coverage

| Requirement | Status | Notes |
|-------------|--------|-------|
| SC1: `make dev-up` brings full stack to healthy | ? HUMAN NEEDED | Structural artifacts complete; runtime health unverifiable without Docker |
| SC2: RabbitMQ topology + generate-keys.sh + .env.example | ✓ SATISFIED | All verified structurally |
| SC3: shared-lib beans + @Async + RabbitMQ tenant propagation | ✓ SATISFIED | All artifacts present + wired; runtime proven by IT (needs `mvn verify`) |
| SC4: MoneyUtils BIGINT paisa + RLS-or-fail guard | ✓ SATISFIED | Both verified structurally; IT proves at runtime |
| SC5: transactional outbox → exactly-once consumer via `processed_events` | ✗ BLOCKED | Outbox + relay proven; `processed_events` consumer dedup NOT implemented |

---

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|---------|--------|
| `shared-lib/src/main/java/io/restaurantos/shared/event/DomainEventPublisher.java` | Comment: "at-least-once delivery" | ℹ️ Info | Acknowledges the gap; exactly-once requires `processed_events` consumer side |
| `shared-lib/src/test/java/.../SharedLibVerificationIT.java` | `sc5_idempotentConsumerProcessesEventExactlyOnce` tests `idempotency_keys` not `processed_events` | ⚠️ Warning | Test passes but doesn't prove the spec's requirement |

No blocker stubs, placeholder returns, or `TODO` patterns found in core production files.

---

### Human Verification Required

#### 1. Full Stack Health Check
**Test:** Run `make dev-up` from repository root; wait for all containers to become healthy.
**Expected:** `docker compose -f deploy/docker-compose.yml ps` shows all services with `(healthy)` status; `psql -U postgres -c '\l'` lists exactly 13 databases; `psql -U postgres -c '\du'` shows 13 `*_user` roles with `NOSUPERUSER, NOBYPASSRLS` attributes.
**Why human:** Cannot execute Docker Compose in this environment.

#### 2. Key Generation Script
**Test:** Run `bash deploy/generate-keys.sh` then run it again (idempotency test).
**Expected:** First run: prints success message without secrets; `deploy/.env` has exactly 1 line each for JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, FIELD_ENCRYPTION_KEY; `echo $FIELD_ENCRYPTION_KEY | base64 -d | wc -c` == 32. Second run: same counts, no duplicated lines.
**Why human:** Script must be executed in a shell with OpenSSL available.

#### 3. RabbitMQ Management UI
**Test:** Open `http://localhost:15672` after `make dev-up`.
**Expected:** Exchanges shows all 9 topic exchanges + restaurantos.dlx; Queues shows 20 queues (10 real + 10 `.dlq` siblings each with `x-dead-letter-exchange` argument); `audit.all-events.queue` has 9 bindings from all topic exchanges with routing key `#`.
**Why human:** Requires running browser + running stack.

#### 4. Integration Test Suite
**Test:** Run `mvn -pl shared-lib -am verify` with Docker running (Testcontainers).
**Expected:** SharedLibVerificationIT runs GREEN; all sc3_*, sc4_*, sc5_* tests pass (except sc5_idempotentConsumerProcessesEventExactlyOnce which tests `idempotency_keys` not `processed_events` — this test currently passes but doesn't satisfy the spec's `processed_events` requirement); JaCoCo coverage ≥ 70%.
**Why human:** Requires Docker daemon for Testcontainers.

---

### Gaps Summary

**1 gap blocks full goal achievement:**

**SC5 — `processed_events` consumer deduplication not implemented.**

The phase goal says: "duplicate delivery is a no-op via `processed_events`". The `processed_events(consumer, event_id)` table is created in the Liquibase test-changelog and correctly excluded from RLS, but there is zero Java code that reads from or writes to it. No `ProcessedEvent` entity, no `ProcessedEventRepository`, no consumer-side deduplication logic exists anywhere in `shared-lib/src/main/java/`.

The SC5 test (`sc5_idempotentConsumerProcessesEventExactlyOnce`) tests idempotency via `idempotency_keys` (HTTP request idempotency), which is a different concern. The test for outbox→relay→RabbitMQ (`sc5_outboxRelayPublishesToRabbitMqAndMarksSent`) proves the outbox publishes on commit, but it does NOT redeliver the same event and assert it is skipped via `processed_events`.

**To fix:** Add a `ProcessedEvent` entity or a JDBC-based `ProcessedEventRepository` that inserts `(consumer, event_id)` before processing a message. If the INSERT fails with unique key violation, skip processing (exactly-once). Update `sc5_idempotentConsumerProcessesEventExactlyOnce` to use `@RabbitListener`, redeliver the same event, and assert row count in `processed_events` == 1.

---

*Verified: 2026-06-23T01:55:00Z*
*Verifier: Claude (gsd-verifier)*
