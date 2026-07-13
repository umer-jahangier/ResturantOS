# Phase 12: Reporting, Dashboards & NLQ - Research

**Researched:** 2026-07-14
**Domain:** ClickHouse analytics ETL, Spring Boot realtime WebSocket dashboard, Python FastAPI NL→SQL service
**Confidence:** MEDIUM-HIGH (codebase conventions HIGH; ClickHouse Java/NLQ specifics MEDIUM; Phase 8/9 event contracts LOW — do not exist in code yet)

## Summary

Phase 12 builds three new services that do not exist anywhere in the repo today: `reporting-service` (Java/Spring Boot, port 8092), a realtime WebSocket dashboard (same service), and `nlq-service` (Python/FastAPI, port 8094 — **the first Python service in the whole monorepo**). No scaffolding, no ClickHouse client code, no Python conventions of any kind exist yet; everything must be built from zero, but the *pattern* to copy is extremely well established by 11 other Java services (freshest: `purchasing-service`, Phase 10) and by `kitchen-service`'s working native WebSocket (KDS board, Phase 7).

Infrastructure is half-ready: `deploy/docker-compose.yml` already provisions `clickhouse/clickhouse-server:25.9` with a `clickhouse_analytics` database created by `deploy/init/clickhouse-init.sql` (explicitly says "full schema added by reporting-service migrations" — i.e. **nothing exists inside ClickHouse yet**, no `sales_facts` table). The gateway has a *commented-out* stub for `nlq-route` (`gateway/src/main/resources/application.yml:243-251`) but **no stub at all for a reporting-route** — the planner must add both. The root `pom.xml` does **not** yet declare `services/reporting-service` as a Maven module even though `Docs/agent-specs/01-project-scaffold.md` describes it as if it should — this is aspirational documentation, not current state.

Critically, the event source-of-truth split by phase status is: **ORDER_CLOSED, TILL_CLOSED, ORDER_CREATED, ORDER_VOIDED, ORDER_REFUNDED, ORDER_SENT_TO_KDS, ORDER_ITEM_CANCELLED, TILL_OPENED (POS/Phase 7), JOURNAL_POSTED, PERIOD_CLOSED, EXPENSE (Finance/Phase 6+10), PO_APPROVED, PO_CLOSED, STOCK_RECEIVED (GRN, not depletion), VENDOR_INVOICE_MATCHED, AP_PAYMENT_PROCESSED (Purchasing/Phase 10), KITCHEN_ITEM_STATUS_CHANGED, ORDER_READY (Kitchen/Phase 7), USER_LOGIN_SUCCEEDED/FAILED (Auth)** are REAL and publishing today via the transactional outbox. Everything from Phase 8 (Inventory: STOCK_DEPLETED, LOW_STOCK_ALERT, COUNT_VARIANCE_POSTED, WASTAGE_RECORDED, TRANSFER_*) and Phase 9 (order-to-ledger auto-posting refinements, loyalty) and Phase 11 (PAYROLL_RUN_APPROVED/PAID) is **spec-only** — it appears in `Docs/agent-specs/02-event-schema-registry.md` but no code publishes it. The `sales_facts` and `inventory_daily_snapshots` ClickHouse tables from the spec (`Docs/RestaurantERP_SaaS_Specification.md` M5.2) can only be populated for the POS-sourced columns today; inventory-sourced columns (COGS, ingredient cost) depend on unbuilt Phase 8 events and must either be deferred, stubbed at zero, or the ETL consumer must be written defensively to tolerate a queue that never receives messages until Phase 8 ships.

**Primary recommendation:** Build `reporting-service` as a standard Spring Boot service cloned from `purchasing-service`'s scaffold (Feign, RLS, Flyway pattern → but Postgres migrations are for the *service's own* Postgres-side tables like `report_definitions`/`dashboard_cache_meta`, while ClickHouse DDL is separate, hand-run or via a lightweight ClickHouse migration runner since Flyway doesn't speak ClickHouse natively). Reuse `kitchen-service`'s native `TextWebSocketHandler` + JWT-in-query-param pattern verbatim for the dashboard socket. Build `nlq-service` as a brand-new Python/FastAPI project per `Docs/agent-specs/01-project-scaffold.md` §1.3 (Alembic for its own small Postgres audit table, `sqlglot` ClickHouse dialect for the 7-stage AST validator, `anthropic` SDK with `claude-sonnet-4-6` for SQL generation and `claude-haiku-4-5` for narrative — supersede the stale `claude-sonnet-4-20250514` model ID baked into the spec/env-var docs).

## Standard Stack

### Core (Java side — reporting-service)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Spring Boot | 4.0.x (matches every other service) | service runtime | project-wide pin in root `pom.xml`, no downgrades per `PROJECT.md` |
| `com.clickhouse:clickhouse-jdbc` | latest (2026, ClickHouse-maintained) | ClickHouse JDBC driver for ETL writes + report reads | official ClickHouse Java client, HTTP-protocol based; used with `JdbcTemplate`, not JPA (ClickHouse is not a JPA-friendly OLTP store) |
| Spring AMQP (`spring-boot-starter-amqp`) | matches other services | consumes `pos.topic`/`finance.topic`/etc events | identical pattern to `kitchen-service`'s `KitchenRabbitConfig` |
| `spring-boot-starter-websocket` | matches Spring Boot version | dashboard WS endpoint | identical to `kitchen-service`'s `WebSocketConfig`/`KdsWebSocketHandler` — proven working pattern, JWT-in-query-param auth |
| Flyway | matches other services (purchasing-service uses Flyway, not Liquibase, for its own schema) | reporting-service's OWN Postgres tables (`report_run_log`, `dashboard_kpi_cache` if not fully Redis) | reporting-service's local Postgres DB is separate from ClickHouse — needed for RLS-protected metadata, not analytics facts |
| Redis (`spring-boot-starter-data-redis`) | Redis 8 (already provisioned) | pre-computed KPI tile cache, per-tile 5s-push throttle | spec M5.4 mandates Redis-precomputed tiles; `QuotaService` in file-service is the established Redis-atomic-counter pattern to imitate |

### Core (Python side — nlq-service, ALL NEW to this repo)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| FastAPI | 0.138+ (pinned in `PROJECT.md` constraints) | HTTP framework | project-wide stack decision, already fixed |
| `anthropic` (official Python SDK) | current (2026) | Claude API calls | official SDK per `Docs/agent-specs` P5.4 table; confirmed current via local claude-api skill |
| `sqlglot` | current | AST parse + ClickHouse dialect validation (stage 2 of 7-stage pipeline) | explicitly named in spec M6.3 stage 2 and P5.4 table; verified it ships a `clickhouse` dialect (sqlglot.dialects.clickhouse) |
| `clickhouse-connect` | current | Python ClickHouse client for query execution | named in P5.4 table |
| `psycopg[binary]` (psycopg3) | current | Postgres driver for `nlq_query_log` / quota bookkeeping if kept outside audit_db | named in P5.4 table |
| Alembic | current | migrations for nlq-service's own tiny Postgres footprint | P5.6/agent-spec: "Python NLQ uses Alembic" (contrasts with Java's Flyway/Liquibase) |
| `redis` (redis-py) | matches Redis 8 | result cache (60s TTL), quota counters (monthly/hourly) | mirrors the Java `QuotaService` pattern; spec M6.2/M6.4 mandate Redis for both cache and quota |
| PyJWT or `python-jose` | current | verify RS256 JWT against the same JWKS endpoint every Java service uses | must independently validate the JWT (defence in depth per `PROJECT.md` Security constraint) — no shared-lib equivalent exists in Python, must be hand-rolled carefully |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `structlog` | current | JSON structured logs for Python service | matches Java's Logstash-encoder JSON logging (P5.6) |
| Resilience4j (already in shared-lib deps) | matches other services | circuit breaking on Feign calls from reporting-service to inventory/user/finance internal APIs | matches gateway's `CircuitBreaker` filter pattern already used for every other route |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `sqlglot` (Python) for AST validation | JSqlParser or Apache Calcite (Java) | Rejected — NLQ service is explicitly Python per architecture (`Docs/agent-specs` P5.4, M6.2); doing the validator in Java would mean either a second network hop from Python→Java for validation or reimplementing what `sqlglot` already does. `sqlglot` is also the spec's named choice (M6.3 stage 2) — this is a locked decision, not open for alternatives. |
| ClickHouse JDBC driver | ClickHouse's newer native Java Client API directly (bypassing JDBC) | The native client is more performant for bulk inserts/batch ETL, but JDBC is simpler to wire into `JdbcTemplate`/existing Spring patterns for the report-query side. Recommend JDBC for report queries (low complexity) and consider the native client only if ETL insert throughput becomes a bottleneck — not needed at Phase 12 scale (single-tenant dev, modest event volume). |
| `claude-sonnet-4-20250514` (spec/env-var doc's pinned model ID) | `claude-sonnet-4-6` (current alias) | The spec text and `Docs/agent-specs/05-environment-variables.md` hardcode a stale dated model ID from spec-writing time. Per this project's `CLAUDE.md`-adjacent claude-api skill catalog, `claude-sonnet-4-6` is the current recommended alias for structured/agentic tasks; `claude-sonnet-4-20250514` still exists (legacy, Active) but there is no reason to pin to a 2025-05-14 snapshot when a current alias exists. Recommend using the `ANTHROPIC_MODEL_SQL` env var (already scaffolded in `05-environment-variables.md`) but set its **default** to `claude-sonnet-4-6`, keep it overridable. |

**Installation (reporting-service `pom.xml`, illustrative):**
```xml
<dependency>
    <groupId>com.clickhouse</groupId>
    <artifactId>clickhouse-jdbc</artifactId>
    <version>0.7.1</version> <!-- verify latest at implementation time -->
    <classifier>http</classifier>
</dependency>
```

**Installation (nlq-service, illustrative `pyproject.toml`/`requirements.txt`):**
```bash
pip install fastapi "uvicorn[standard]" anthropic sqlglot clickhouse-connect "psycopg[binary]" alembic redis pyjwt structlog
```

## Architecture Patterns

### Recommended reporting-service structure (clone of purchasing-service layout)
```
services/reporting-service/
├── pom.xml                          # add as new <module> to root pom.xml
├── src/main/java/io/restaurantos/reporting/
│   ├── ReportingServiceApplication.java   # @EnableFeignClients(basePackages = "io.restaurantos.reporting.client")
│   ├── config/
│   │   ├── ReportingRabbitConfig.java     # exchanges/queues per event-schema-registry §2.2 (reporting.*.queue)
│   │   ├── WebSocketConfig.java           # clone kitchen-service's, path /api/v1/reporting/dashboard/{branchId}
│   │   ├── ClickHouseConfig.java          # DataSource bean for clickhouse-jdbc, separate from the Postgres one
│   │   └── FeignClientConfig.java         # clone purchasing-service's — X-Internal-Service + JWT forwarding
│   ├── client/                             # InventoryClient, UserClient (branch lookups) — per doc 04 example
│   ├── consumer/                           # one consumer class per subscribed event (ORDER_CLOSED, TILL_CLOSED, JOURNAL_POSTED, ...)
│   ├── clickhouse/                         # DDL runner + repository classes issuing raw SQL via JdbcTemplate
│   ├── ws/
│   │   └── DashboardWebSocketHandler.java  # clone KdsWebSocketHandler; push on ORDER_CLOSED/TILL_CLOSED, throttled 5s/tile
│   ├── service/                            # ReportService (named reports), FbrTaxSummaryService, DashboardTileService
│   ├── controller/                         # REST endpoints for the 40 named reports + FBR
│   ├── entity/ + repository/               # small Postgres side-tables (report run audit, cache metadata) — RLS + Flyway
│   └── event/                              # payload records mirroring PosClosePayloads.java pattern
└── src/main/resources/
    ├── application.yml                     # port 8092, matches env-var doc conventions
    ├── db/migration/                       # Flyway — Postgres-side tables only
    └── clickhouse/                         # hand-authored DDL for sales_facts, inventory_daily_snapshots, etc; NOT Flyway
```

### Recommended nlq-service structure (new, per `Docs/agent-specs/01-project-scaffold.md` §1.3, "nlq-service follows a Python FastAPI layout instead")
```
nlq-service/
├── pyproject.toml (or requirements.txt)
├── alembic/                        # migrations for the tiny Postgres footprint (or write straight to audit_db if permitted — see Open Questions)
├── app/
│   ├── main.py                     # FastAPI app, registers with Eureka (via py_eureka_client or a sidecar — see Open Questions)
│   ├── auth/jwt_verify.py          # RS256 verify against JWKS_URI — mirror shared-lib's JwksKeyProvider logic in Python
│   ├── validation/
│   │   ├── shape_check.py          # stage 1
│   │   ├── ast_parse.py            # stage 2 — sqlglot.parse_one(sql, dialect="clickhouse")
│   │   ├── table_allowlist.py      # stage 3
│   │   ├── pii_denylist.py         # stage 4
│   │   ├── tenant_filter.py        # stage 5 — auto-inject if missing
│   │   ├── branch_filter.py        # stage 6 — auto-inject for non-OWNER roles
│   │   └── limit_inject.py         # stage 7
│   ├── claude/client.py            # anthropic SDK wrapper, prompt assembly (3 layers per M6.2)
│   ├── clickhouse/executor.py      # clickhouse-connect, readonly role, 5s timeout, 10k row cap
│   ├── cache/redis_cache.py        # 60s result cache keyed nlq:{tenantId}:{role}:{sha256(question)}
│   ├── quota/redis_quota.py        # per-tenant monthly + per-user hourly counters
│   └── routers/query.py            # POST /api/v1/nlq/query
```

### Pattern 1: Transactional-outbox event consumption with idempotency (MANDATORY for reporting-service's ETL consumers)
**What:** Every consumer checks `processed_events(consumer, event_id)` before applying, in the SAME transaction as the write.
**When to use:** Every RabbitMQ consumer in reporting-service (ORDER_CLOSED → sales_facts, TILL_CLOSED → dashboard push, JOURNAL_POSTED → financial facts, etc).
**Example (verbatim pattern, from `services/kitchen-service/src/main/java/io/restaurantos/kitchen/consumer/OrderClosedConsumer.java`):**
```java
@RabbitListener(queues = KitchenRabbitConfig.KITCHEN_ORDER_CLOSED_QUEUE)
public void onMessage(Message message) {
    EventEnvelope<OrderClosedPayload> envelope = deserialize(message);
    if (envelope == null) { log.warn("could not deserialize — skipping"); return; }
    processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
            tenantAwareMessageProcessor.process(envelope, env ->
                    ticketService.serveTicketsForOrder(env.payload().orderId())
            )
    );
}
```
Note: `processed_events` for ClickHouse writes is tricky — ClickHouse itself has no transactions. The idempotency check-and-record for ClickHouse-bound consumers should stay in reporting-service's own Postgres `processed_events` table (its RLS-protected side DB), and only the ClickHouse INSERT happens after that guard passes. A ClickHouse insert retried on consumer redelivery (if the Postgres commit succeeds but the process crashes before the CH insert) is an acceptable edge case for analytics facts (eventual consistency, not ledger-grade) — but flag this explicitly to the planner as a design decision, not silently assumed.

### Pattern 2: Native WebSocket handler with JWT-in-query-param auth (proven, reuse verbatim for dashboard)
**What:** `TextWebSocketHandler` subclass, path variables carry `{branchId}`, token passed as `?token=` query param (browsers can't set WS headers), permission check against a specific permission code, subscriber registry keyed by scope, `notifySubscribers()` called from the service layer after each relevant mutation.
**When to use:** Dashboard WebSocket at `/api/v1/reporting/dashboard/{branchId}`.
**Example:** See `services/kitchen-service/src/main/java/io/restaurantos/kitchen/ws/KdsWebSocketHandler.java` (full file read, 157 lines) — copy structure, change:
- path: `/api/v1/kitchen/kds/{branchId}/{stationId}` → `/api/v1/reporting/dashboard/{branchId}`
- permission check: `pos.kds.view` → a new `reporting.dashboard.view` permission (must be seeded in RBAC + OPA policy)
- subscriber key: `branchId:stationCode` → `branchId` alone (or `branchId:tileId` if per-tile granularity needed)
- **Add the 5-second minimum-interval-per-tile throttle** the spec requires (M5.4) — KDS handler has NO throttle (every mutation pushes immediately), so this must be added net-new, e.g. a `ConcurrentHashMap<String, Instant> lastPushByTile` gate before `sendMessage`.

Frontend consumption: reuse `frontend/lib/hooks/kds/use-kds-socket.ts` verbatim as the template — same exponential-backoff reconnect, same `?token=${accessToken}` query param pattern, same `window.location.host` proxying through the gateway (confirmed the gateway's `kitchen-route` has no special WS filter — Spring Cloud Gateway's `lb://` routing handles WS upgrade transparently on the same `Path=` predicate, so a plain `reporting-route` addition should work the same way for WS traffic).

### Pattern 3: Feign JWT-forwarding for internal calls (MANDATORY — this exact bug already bit Phase 10 twice)
**What:** Every `RequestInterceptor` on internal Feign clients MUST forward `X-Internal-Service` secret AND the caller's `Authorization` header AND `X-Tenant-Id`.
**When to use:** reporting-service's Feign clients to `user-service` (branch lookups per doc 04 §internal contracts) and to `authorization-service` if reporting-service calls `/internal/authorize` for anything permission-scoped beyond OPA-at-gateway.
**Example:** `services/purchasing-service/src/main/java/io/restaurantos/purchasing/config/FeignClientConfig.java` (full file read above) — copy verbatim, especially `forwardCallerJwt()`.

### Pattern 4: Reject-then-inject SQL validation pipeline (nlq-service, Python)
**What:** 7 sequential stages, each either rejects outright or mutates the AST (auto-inject tenant/branch/limit).
**When to use:** Every NLQ request, before any ClickHouse execution.
**Example (conceptual, from spec M6.3 — no existing code, this is the contract to implement):**
```python
def validate(sql: str, role: str, tenant_id: str, branch_id: str | None, is_owner: bool) -> str:
    if not shape_check(sql):
        raise NlqRejected("SHAPE_INVALID")
    try:
        ast = sqlglot.parse_one(sql, dialect="clickhouse")
    except sqlglot.errors.ParseError:
        raise NlqRejected("PARSE_FAILED")
    tables = extract_tables(ast)
    if not tables.issubset(allowed_tables_for_role(role)):
        raise NlqRejected("TABLE_NOT_ALLOWED")
    if references_denied_columns(ast, PII_DENYLIST):
        raise NlqRejected("PII_COLUMN_DENIED")
    ast = inject_tenant_filter(ast, tenant_id)          # stage 5, mandatory
    if not is_owner:
        ast = inject_branch_filter(ast, branch_id)        # stage 6, non-OWNER only
    ast = inject_limit_if_missing(ast, default_limit=1000) # stage 7
    return ast.sql(dialect="clickhouse")
```
A query that, after stage 5/6, still cannot be proven to carry a tenant/branch predicate (e.g. the injector can't find a WHERE-injectable spot because of a UNION/subquery it doesn't handle) must be REJECTED, not silently executed unfiltered — this is the literal wording of ROADMAP success criterion 3 ("a query missing the tenant or branch filter is rejected").

### Anti-Patterns to Avoid
- **Trusting Claude's SQL output as ground truth:** the 7-stage pipeline exists precisely because Claude can hallucinate or be prompt-injected via the NL question itself. Every stage must run even if the SQL "looks fine."
- **Setting the tenant GUC transaction-local (`is_local=true`) on reporting-service's own Postgres side tables:** this is the exact Phase 10 bug (commit `2099ac0`) — reporting-service will use the SAME shared-lib `TenantAwareDataSource`, so it inherits the fix automatically as long as it depends on the current `shared-lib` version. Do NOT hand-roll a new DataSource wrapper for reporting-service.
- **Relying only on OPA/gateway-level auth for NLQ's tenant isolation:** the ClickHouse read-only user must ALSO run with a session-level tenant WHERE clause (M6.4) — defence in depth, matching this project's stated Security constraint ("JWT validated at gateway AND each service").
- **Double-encoding JSON in the outbox relay:** if reporting-service ever needs to publish its own events (unlikely, it's mostly a consumer), reuse `DomainEventPublisher`/`OutboxRelay` unchanged — do not call `rabbitTemplate.convertAndSend(jsonString)` (see `OutboxRelay.java` javadoc, "SC5 gotcha").

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQL AST parsing/validation | A custom SQL tokenizer/regex-based validator | `sqlglot` (ClickHouse dialect) | Regex-based SQL validation is a well-known injection-bypass trap (comments, encoding tricks, subqueries); `sqlglot` gives a real AST with `find_all(exp.Table)`, proper column/table extraction, and a maintained ClickHouse dialect |
| Tenant GUC propagation on JDBC connections | A new DataSource wrapper for reporting-service | `shared-lib`'s `TenantAwareDataSource` (already fixed for the BEGIN-ordering bug) | Re-solving this in a new service would very likely reintroduce the exact bug fixed in commit `2099ac0` — the fix (session-scoped GUC + close()-reset proxy) is non-obvious and already paid for |
| Internal-service JWT forwarding | Ad-hoc Feign interceptors per new client | Clone `purchasing-service`'s `FeignClientConfig.forwardCallerJwt()` | Already fixed once (commit `990026a`) after causing a total internal-authorize outage; the fix logic (pull `Authorization` off `ServletRequestAttributes`, skip if already present, no-op for async/event contexts) is subtle enough that reinventing it is a guaranteed regression risk |
| Redis-based quota counters | A custom atomic-increment-with-rollback scheme | Clone `file-service`'s `QuotaService` pattern (`INCRBY` + rollback `DECRBY` on over-limit) | Already solved the exact race-condition-safe reserve/rollback problem this phase needs (monthly tenant quota, hourly user quota) |
| WebSocket JWT auth + reconnect | A new auth scheme or a new frontend hook from scratch | Clone `KdsWebSocketHandler` (backend) + `use-kds-socket.ts` (frontend) | Both are proven working in production-equivalent Phase 7 KDS flow; the query-param-token + exponential-backoff-reconnect pattern is exactly what's needed for the dashboard |
| Python JWT verification | Trusting a claim without signature check, or building your own RS256 verifier from scratch | `pyjwt`/`python-jose` + fetch the same JWKS endpoint (`JWT_JWKS_URL`) every Java service uses | This is genuinely new ground in this repo (first Python service) — use a maintained library, not hand-rolled crypto, and mirror the Java `JwksKeyProvider`'s kid-lookup + verify flow conceptually |

**Key insight:** This phase is the first to combine (a) analytics infra with no prior code in this repo, and (b) the first Python service, and (c) reuse of two already-debugged Java pitfalls (tenant GUC, JWT forwarding). The single biggest risk is NOT researching NLQ/ClickHouse novelty — it's *failing to reuse* the shared-lib fixes and Feign pattern, which would silently reintroduce bugs this project already paid to fix once.

## Common Pitfalls

### Pitfall 1: RLS tenant GUC discarded before BEGIN (already fixed in shared-lib, but only if consumed correctly)
**What goes wrong:** A service's own DataSource bypasses or predates the shared-lib fix (e.g., someone copy-pastes an OLD version of `TenantAwareDataSource` instead of depending on the current `shared-lib` artifact), causing every RLS-protected read inside a `@Transactional` write to silently return zero rows.
**Why it happens:** Spring's transaction manager checks a connection out of the pool BEFORE issuing `BEGIN`; a transaction-LOCAL `set_config(..., true)` GUC set at checkout is discarded before `BEGIN` runs.
**How to avoid:** reporting-service must declare a normal dependency on the current `shared-lib` (matching version used by purchasing-service/finance-service) and must NOT vendor or reimplement `TenantAwareDataSource`. Only relevant to reporting-service's own small Postgres side-tables — NOT to ClickHouse (which has no RLS/transactions at all; tenant isolation there is enforced entirely by application-level `WHERE tenant_id = :tenantId` predicates and, for NLQ, session-level enforcement per M6.4).
**Warning signs:** A validating SELECT inside a write transaction returns 0 rows for data that demonstrably exists; symptom masquerades as a business-logic bug (e.g., "invalid code" for a code that's present).

### Pitfall 2: Internal service-to-service call unauthenticated because JWT not forwarded
**What goes wrong:** A new Feign client's `RequestInterceptor` sends `X-Internal-Service` (proves caller is trusted) but not the end-user's `Authorization` header (proves subject is a real user) — `/internal/authorize` and similar dual-gated endpoints reject the call, surfacing as a 503 upstream.
**Why it happens:** Easy to copy only half the pattern; the tests won't catch it because ITs stub the client interface directly and never exercise the real HTTP call path (documented explicitly in commit `990026a`'s message).
**How to avoid:** Copy `purchasing-service`'s `FeignClientConfig` wholesale for any reporting-service → authorization-service or → user-service internal call, especially `forwardCallerJwt()`.
**Warning signs:** Internal calls succeed against a stubbed test double but fail with 503/401 against the real stack; OPA policy tests all pass but manual end-to-end flow fails.

### Pitfall 3: Missing tenant/branch filter after AST mutation (NLQ)
**What goes wrong:** The auto-injector for stage 5/6 fails to find a safe injection point in a syntactically valid but structurally unusual query (subquery, UNION, CTE), producing SQL that still lacks the tenant/branch predicate, and the query executes unfiltered.
**Why it happens:** AST-based WHERE-injection is genuinely hard to make airtight across arbitrary valid SQL shapes; `sqlglot` gives you the tools but the injection logic itself is bespoke to this project.
**How to avoid:** Treat "cannot prove injection succeeded" as a hard rejection, not a best-effort pass-through. After injection, re-parse the resulting SQL and assert (programmatically, not just optimistically) that a `tenant_id = ...` predicate is present in every table reference's applicable WHERE/ON clause before considering the query safe to execute. ROADMAP success criterion 3 explicitly requires this rejection behavior to be testable.
**Warning signs:** A crafted NLQ using a subquery or CTE returns cross-tenant rows in testing.

### Pitfall 4: ETL consumer built against event contracts that don't exist yet (Phase 8/9 dependency)
**What goes wrong:** Plans/tasks assume `STOCK_DEPLETED`, `LOW_STOCK_ALERT`, or Phase-9-refined `ORDER_CLOSED`-derived COGS data are available, but Phase 8/9 haven't shipped — so the corresponding RabbitMQ queue either doesn't exist (nothing publishes to `inventory.topic` yet) or the consumer never receives messages, and ClickHouse `sales_facts.cogs_paisa`/`gross_margin_paisa` columns and `inventory_daily_snapshots` stay perpetually empty/zero.
**Why it happens:** ROADMAP explicitly lists Phase 12 as `Depends on: Phase 7, Phase 8, Phase 9` — but per `.planning/STATE.md`, Phase 8 and 9 are `Not started` as of this research date (only Phase 7/7.1/7.2/7.3 and Phase 10 are done).
**How to avoid:** Scope Phase 12's plans to ONLY what POS (Phase 7, done), Finance (Phase 6/10, done), Purchasing (Phase 10, done), and Kitchen (Phase 7, done) events can support today. Build the inventory-sourced ETL consumers (STOCK_DEPLETED etc.) as dormant/defensive — queue bindings can be declared (matching the event-schema-registry topology) so they're ready the moment Phase 8 ships, but the success criteria and verification for THIS phase must not depend on inventory-sourced report columns actually populating. The FBR Tax Summary report (output tax vs input tax vs net payable) is fed by `JOURNAL_POSTED`/tax-line data from Finance (already real) and `VENDOR_INVOICE_MATCHED.inputTaxPaisa` from Purchasing (already real) — this report is achievable without Phase 8/9. Sales-by-item margin/COGS reports are NOT fully achievable without Phase 8.
**Warning signs:** A plan task references an event type not found by `grep -rn '"STOCK_DEPLETED"' services/` (confirmed: zero matches today).

### Pitfall 5: No reporting-route / no WS-aware gateway config
**What goes wrong:** Frontend dashboard WebSocket or report REST calls 404 through the gateway because no route was added.
**Why it happens:** `gateway/src/main/resources/application.yml` has commented stubs for `hr-route`, `crm-route`, `nlq-route`, `inventory-route` but **no stub at all, not even commented, for reporting-route** — it's easy to assume it exists somewhere and miss adding it.
**How to avoid:** Add both `reporting-route` (`Path=/api/v1/reporting/**`) and uncomment/adapt `nlq-route` (`Path=/api/v1/nlq/**`), each with a `CircuitBreaker` filter + `fallbackUri: forward:/fallback/service-unavailable`, matching every existing route's shape exactly (see `purchasing-route` and `kitchen-route` for the template).
**Warning signs:** `curl http://localhost:8080/api/v1/reporting/...` returns a generic gateway 404 rather than a service-level response.

### Pitfall 6: Python service integration gaps (Eureka registration, Config Server, internal-service auth) — genuinely unresearched territory
**What goes wrong:** nlq-service is architecturally supposed to "register in Eureka" (spec M6.2) and be "proxied by the API Gateway," but there is no existing Python code anywhere in this repo demonstrating how a non-Java service registers with Eureka, pulls config from Spring Cloud Config Server, or participates in the `X-Internal-Service` internal-auth convention used by every Java service.
**Why it happens:** All 11 existing services are Java/Spring, which get Eureka/Config integration "for free" via Spring Cloud starters; Python has no equivalent auto-wiring in this codebase.
**How to avoid:** This is a genuine open question for the planner (see Open Questions) — likely solution is a Python Eureka client library (e.g. `py-eureka-client`) for self-registration, plain env vars (or a lightweight Config Server HTTP fetch) instead of Spring Cloud Config's auto-refresh, and manually setting the `X-Internal-Service` header + forwarding `Authorization` in any outbound call nlq-service makes to Java internal endpoints (e.g., to fetch `nlq_allowed_tables` per role, or to check quotas against platform-admin).
**Warning signs:** nlq-service builds and runs standalone but never appears in the Eureka dashboard, and the gateway's `lb://nlq-service` route can't resolve it.

## Code Examples

### Business-day boundary formula (verified, `PROJECT.md`)
```
business-day boundary = DATE(opened_at AT TIME ZONE branch.timezone - INTERVAL '4 hours')
```
Source: `.planning/PROJECT.md` line 68 ("Time" constraint). Also appears as `BUSINESS_DAY_OFFSET_HOURS=4` env var scoped to `pos, finance, reporting` in `Docs/agent-specs/05-environment-variables.md` line 47 — confirms the 4-hour offset is configurable, not hardcoded, and reporting-service is an intended consumer of this exact env var. Apply this formula when bucketing ClickHouse `sales_facts.event_date` and when computing "Sales by Day" style reports so a 1am order doesn't get attributed to the wrong calendar day.

### EventEnvelope (verified, exact class to deserialize against)
```java
// shared-lib/src/main/java/io/restaurantos/shared/event/EventEnvelope.java
public record EventEnvelope<T>(
        UUID eventId, String eventType, UUID tenantId, UUID branchId,
        Instant occurredAt, UUID correlationId, int schemaVersion,
        String source, T payload) {}
```

### ORDER_CLOSED payload (verified, exact fields available for sales_facts ETL today)
```java
// services/pos-service/src/main/java/io/restaurantos/pos/event/PosClosePayloads.java
public record OrderClosedPayload(
        UUID orderId, String orderNo, String type, UUID customerId,
        long subtotalPaisa, long discountPaisa, long serviceChargePaisa,
        long taxPaisa, long totalPaisa,
        List<PaymentEntry> payments, List<ItemEntry> items,
        UUID tillSessionId, UUID cashierId, Instant closedAt) {}
public record ItemEntry(UUID menuItemId, String name, int qty, long unitPricePaisa, long lineTotalPaisa) {}
```
Note: no `cogsPaisa`/`grossMarginPaisa`/`categoryName` on `ItemEntry` today — the spec's `sales_facts` table wants `cogs_paisa`, `gross_margin_paisa`, `category_name`, none of which are present in the real Phase-7 payload. These must either be joined from another (unbuilt Phase 8) source, defaulted to null/0, or the ETL is scoped to omit them until Phase 8/9 land.

### ClickHouse read-only profile (MEDIUM confidence, verified via ClickHouse official docs)
```sql
-- SQL-driven equivalent (verify current syntax at implementation time —
-- WebFetch of clickhouse.com/docs/operations/settings/settings-profiles only
-- confirmed the XML form; SQL-driven CREATE SETTINGS PROFILE syntax should be
-- re-verified against clickhouse.com/docs/sql-reference/statements/create/settings-profile)
CREATE SETTINGS PROFILE nlq_readonly_profile
    SETTINGS readonly = 1 READONLY,
             max_execution_time = 5 MAX,
             max_result_rows = 10000 MAX;

CREATE USER nlq_readonly IDENTIFIED BY '...' SETTINGS PROFILE nlq_readonly_profile;
```
Source: ClickHouse official docs (`clickhouse.com/docs/operations/settings/settings-profiles`, fetched live) confirm `readonly`, `max_execution_time`, `max_result_rows` are valid profile-constrainable settings and the general CONST/MAX/MIN constraint syntax; exact `CREATE SETTINGS PROFILE`/`CREATE USER ... SETTINGS PROFILE` SQL statement grammar was NOT fully confirmed by the fetched page (it showed XML `users.xml` config, not the SQL-driven form) — flagged as an Open Question below, verify `CREATE SETTINGS PROFILE` grammar against `clickhouse.com/docs/sql-reference/statements/create/settings-profile` before implementing.

### FBR Tax Summary — required fields (verified, spec)
Per `Docs/RestaurantERP_SaaS_Specification.md` line 2167: "FBR Tax Summary (output vs input, net payable)" — one of the 10 Financial named reports. Inputs available today:
- **Output tax**: from `ORDER_CLOSED.taxPaisa` (POS, real) aggregated by business day/period.
- **Input tax**: from `VENDOR_INVOICE_MATCHED.inputTaxPaisa` (Purchasing, real — see `Docs/agent-specs/02-event-schema-registry.md` line 195).
- **Net payable**: output tax − input tax.
- Branch FBR registration fields (`fbr_strn`, `ntn`) exist on the `branches` table already (`Docs/RestaurantERP_SaaS_Specification.md` line 2290, in `user_db`) — reporting-service must Feign-call user-service's `/internal/users/branches/{branchId}` (confirmed real internal endpoint, doc 04 line 65) to pull these for the report header.
No further FBR-specific format/filing spec was found anywhere in `Docs/` — this is a reporting summary for the tenant's own bookkeeping, not an actual FBR e-filing integration (no mention of FBR API/IRIS integration anywhere in the specs). Treat "FBR Tax Summary" as a named internal report with FBR-shaped fields, not a live government filing feature.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `claude-sonnet-4-20250514` pinned in spec/env-var docs | `claude-sonnet-4-6` alias (current recommended balanced model) | spec was written before 4.6 release | Use the alias as the env var default; `claude-sonnet-4-20250514` still works (Active, legacy) but there's no reason to pin to a stale snapshot |
| `claude-haiku-...` (spec leaves version incomplete, `claude-haiku-4-...`) | `claude-haiku-4-5` (`claude-haiku-4-5-20251001`) | current fastest/cheapest model | Use for the narrative-generation step (M6.2 "Narrative generation (claude-haiku, ~200 tokens)") |

**Deprecated/outdated:** None specific to ClickHouse/WebSocket found — this is a greenfield build within the project, so there's no legacy pattern in-repo to migrate away from.

## Open Questions

1. **How does a Python service (nlq-service) register with Eureka and pull config from Spring Cloud Config Server?**
   - What we know: The spec says "Registered in Eureka as `nlq-service`. Proxied by the API Gateway" (M6.2) and env vars reference `EUREKA_URL`/`CONFIG_SERVER_URL` generically as "all Java," implying Python may be exempt or must self-integrate.
   - What's unclear: No Python code, library choice, or integration pattern exists anywhere in this repo to copy.
   - Recommendation: The planner should treat this as its own research/design task within the phase plan (likely `py-eureka-client` for registration + plain env-var config, no auto-refresh) rather than assume it's a solved problem.

2. **Exact SQL-driven `CREATE SETTINGS PROFILE` / `CREATE USER ... SETTINGS PROFILE` grammar for ClickHouse 25.9.**
   - What we know: `readonly`, `max_execution_time`, `max_result_rows` are valid, constrainable settings (verified via official docs).
   - What's unclear: The exact SQL statement syntax (vs. XML `users.xml` config) was not confirmed by the fetched page.
   - Recommendation: WebFetch `https://clickhouse.com/docs/sql-reference/statements/create/settings-profile` and `.../create/user` directly during planning/execution before writing the DDL migration.

3. **How is reporting-service's own Postgres-side schema versioned — Flyway (like purchasing-service) or does it need none at all if everything lives in ClickHouse?**
   - What we know: purchasing-service uses Flyway; finance-service and others use Liquibase (mixed convention across services — confirmed by finding both `db/migration` (Flyway) and `db/changelog` (Liquibase) directories across different services).
   - What's unclear: Which migration tool the planner should pick for reporting-service's metadata tables (report run audit log, cache metadata) is a genuine per-service choice already split in this codebase; either is precedented.
   - Recommendation: Default to Flyway (purchasing-service, the freshest reference, uses it) unless there's a reason to match a specific neighboring service.

4. **What exactly is `nlq_allowed_tables` scoped by — role code, or a per-tenant configurable allowlist?**
   - What we know: Spec M6.3 stage 3 says "every table in the AST must be in the role's `nlq_allowed_tables`" — implies role-based, not tenant-based.
   - What's unclear: Where this allowlist is stored/administered (a new Postgres table? Redis-cached config per M6.2 step "Load RBAC-scoped ClickHouse schema slice (Redis cache, 10-min TTL)"?) is not fully specified.
   - Recommendation: Treat as Claude's-discretion within the plan — a small reporting-service or nlq-service-owned config table, seeded per role, cached in Redis per the spec's stated 10-min TTL.

## Sources

### Primary (HIGH confidence)
- `deploy/docker-compose.yml` (lines 164-233) — ClickHouse 25.9 container config, ports, volumes
- `deploy/init/clickhouse-init.sql` — confirms only the empty DB exists, no schema yet
- `shared-lib/src/main/java/io/restaurantos/shared/event/EventEnvelope.java`, `DomainEventPublisher.java`, `OutboxRelay.java` — exact envelope/outbox mechanics
- `services/pos-service/src/main/java/io/restaurantos/pos/event/PosClosePayloads.java`, `OrderServiceImpl.java`, `TillServiceImpl.java` — real ORDER_CLOSED/TILL_CLOSED payloads and publish call sites
- `services/kitchen-service/.../ws/KdsWebSocketHandler.java`, `config/WebSocketConfig.java`, `consumer/OrderClosedConsumer.java`, `config/KitchenRabbitConfig.java` — proven WS + consumer patterns
- `services/purchasing-service/src/main/resources/application.yml`, `db/migration/V1__purchasing_schema.sql`, `config/FeignClientConfig.java` — freshest service scaffold + RLS + JWT-forwarding fix
- `gateway/src/main/resources/application.yml` (lines 179-251) — confirmed no reporting-route stub, commented nlq-route stub exists
- `pom.xml` (root) — confirmed reporting-service/nlq-service NOT yet declared as modules
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` — business-day formula, requirement IDs, phase dependency/status ground truth
- `Docs/agent-specs/02-event-schema-registry.md` — full event catalogue (spec-level; cross-checked against actual code for which events are real)
- `Docs/agent-specs/04-internal-api-contracts.md` (lines 190-247) — Feign client pattern, `ReportingServiceApplication` example, `InventoryClient` example
- `Docs/agent-specs/05-environment-variables.md` — full env-var table incl. ports, ClickHouse/NLQ-specific vars
- `Docs/agent-specs/01-project-scaffold.md` — intended directory layout for reporting-service/nlq-service
- `Docs/RestaurantERP_SaaS_Specification.md` §M5 (Reporting & Analytics), §M6 (NLQ) — full architecture, ClickHouse DDL sketches, 7-stage pipeline definition, WS architecture, response shape
- `git show 2099ac0` / `990026a` (Phase 10 commits) — verified full diffs of the tenant-GUC and JWT-forwarding fixes
- `/Users/mac/.cursor/repos/.../skills/claude-api/shared/models.md`, `python/claude-api/README.md` — current Claude model catalog and Python SDK usage

### Secondary (MEDIUM confidence)
- WebSearch + WebFetch of `clickhouse.com/docs/operations/settings/settings-profiles` — confirmed `readonly`/`max_execution_time`/`max_result_rows` are valid profile settings; did not confirm exact SQL-driven CREATE statement grammar
- WebSearch on `clickhouse-jdbc` (ClickHouse official GitHub, mvnrepository) — confirmed it's the maintained official Java driver, HTTP-protocol based
- WebSearch on `sqlglot` ClickHouse dialect — confirmed dialect exists and is documented (`sqlglot.dialects.clickhouse`)

### Tertiary (LOW confidence)
- None retained as authoritative in this document — all findings that started as WebSearch-only were either upgraded via official-doc verification or explicitly flagged as Open Questions rather than stated as fact.

## Metadata

**Confidence breakdown:**
- Standard stack (Java side): HIGH — every library choice is either already used elsewhere in this codebase or explicitly named in the project's own agent-specs
- Standard stack (Python/NLQ side): MEDIUM — libraries are correctly named by the spec and verified to exist/be current, but zero in-repo precedent means integration details (Eureka, Config Server, internal auth) are genuinely unproven
- Architecture patterns: HIGH — directly cloned from working, tested, recently-fixed Phase 7/10 code
- Event contracts (what's real vs spec-only): HIGH — verified by exhaustive grep of actual publish call sites, not just spec reading
- ClickHouse-specific settings/DDL grammar: MEDIUM — core concepts confirmed via official docs, exact SQL syntax needs a final verify-pass at implementation time
- Pitfalls: HIGH — sourced from actual git commit history of bugs found and fixed in this exact codebase

**Research date:** 2026-07-14
**Valid until:** 30 days for the Java/architecture findings (stable, in-repo); 7 days for the Claude model-ID recommendation (fast-moving); re-verify Phase 8/9 status against `.planning/STATE.md` immediately before planning starts, since that status is the single fastest-changing input to this research.
