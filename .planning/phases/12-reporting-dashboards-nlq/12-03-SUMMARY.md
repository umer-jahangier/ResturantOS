---
phase: 12-reporting-dashboards-nlq
plan: 03
status: complete
completed: 2026-07-17
wave: 2
executed_by: delegated executor (tasks 1-2), finished in the orchestrator main loop (task 3 + verification) after the agent was cancelled at a session boundary
---

# 12-03 SUMMARY — ETL: events → ClickHouse analytics facts

## What was built

reporting-service's ETL spine. Consumes the three events that **actually exist today** and lands
them as ClickHouse analytics facts, bucketed by the business-day boundary, idempotently.

- **Config**: `ClickHouseConfig` (ClickHouse `JdbcTemplate` + the Postgres one), `ReportingRabbitConfig`
  (queues/bindings on `pos.order.closed`, `pos.till.closed`, `purchasing.invoice.matched`),
  `ClickHouseSchemaGuard` (fail-fast at boot if the four fact tables are absent — a silent boot
  against a missing schema is how you get an ETL that drops every event with no operator signal).
- **Support**: `BusinessDay` (the boundary formula), `BranchTimeZoneResolver` (Redis-cached
  internal user-service lookup, `Asia/Karachi` fallback).
- **Idempotency**: `ProcessedEventEntity`/`ProcessedEventId`/`ProcessedEventJpaRepository`/
  `ProcessedEventService` + `V1__reporting_schema.sql` (`processed_events` + `report_run_log`, RLS enabled).
- **Writers**: `SalesFactWriter`, `PurchaseTaxFactWriter`, `TillSessionFactWriter`.
- **Consumers**: `OrderClosedConsumer`, `TillClosedConsumer`, `VendorInvoiceMatchedConsumer` — each
  delegates to its writer behind the idempotency guard.

## Verification — `mvn -pl services/reporting-service verify` → **BUILD SUCCESS**

- `BusinessDayTest` **6/6**: the boundary formula; same instant in different branch timezones →
  different business dates; the configured default offset.
- `EtlPipelineIT` **6/6** against **real** Testcontainers (ClickHouse 25.9, RabbitMQ 3.12, Postgres 16,
  Redis 7) — publishes real events, asserts real rows. Every must_have truth is covered:
  | Test | must_have |
  |---|---|
  | `orderClosed_landsOrderAndItemFacts` | ORDER_CLOSED → 1 order fact + 1 fact per item |
  | `vendorInvoiceMatched_landsInputTax` | VENDOR_INVOICE_MATCHED → purchase_tax_facts input tax |
  | `tillClosed_landsTillFact` | TILL_CLOSED → till_session_facts |
  | `orderClosedAtOneAm_bucketsToPreviousBusinessDay` | 01:00 order attributes to the PREVIOUS day |
  | `redeliveredEvent_doesNotDuplicate` | redelivery creates no duplicate fact row |
  | `orderClosed_cogsColumnsAreNull` | cogs/margin/category NULL (Phase 8 unbuilt), no crash |
- Scope fence verified: `grep -rniE "STOCK_DEPLETED|LOW_STOCK_ALERT|WASTAGE_RECORDED|COUNT_VARIANCE_POSTED|TRANSFER_"`
  over `services/reporting-service/src` → **zero matches**. No Phase 8/9 event is consumed. `JOURNAL_POSTED`
  deliberately not added.
- The IT applies `deploy/clickhouse/V001__analytics_facts.sql` **by reading the file from disk**, so it
  cannot silently drift from the real schema.

## Four real bugs found and fixed while making the IT actually run

The service had never been booted (12-01 deferred live boot), so all four were latent and would have
hit production. This is the value of the plan insisting on a real-container IT rather than mocks.

1. **clickhouse-jdbc 0.9.0 → 0.8.6** (classifier `all` → `http`). 0.9.0 is a V2 rewrite whose
   `PreparedStatementImpl.setString` throws `ArrayIndexOutOfBoundsException` (empty placeholder array)
   on an ordinary parameterized query — breaking every parameterized fact INSERT and the schema-guard
   probe. **This reverses 12-01's deviation**: 0.9.0 dropping the `http` classifier was a *symptom* of
   the unfinished rewrite, not a packaging change to work around. The plan's original 0.8.x + `http`
   intent was correct. nlq-service pinned in lockstep (re-verified: its 56 tests still green).
2. **ClickHouse DataSource must not be a `@Bean`.** shared-lib's `TenantAwareDataSourcePostProcessor`
   wraps *every* DataSource bean (bare `instanceof DataSource`, no discrimination), and
   `TenantAwareDataSource` issues the **Postgres-only** `SELECT set_config('app.current_tenant_id', ?, false)`
   on each checkout where a tenant is in context. The ETL always has a tenant (read off the event
   envelope), so every ClickHouse write would have failed. `ClickHouseConfig`'s javadoc already said
   "must NOT be wrapped" — nothing enforced it. Now constructed inside the `JdbcTemplate` factory, so it
   never enters the bean graph: the rule is structural, not a comment.
3. **`jdbcUrl is required with driverClassName`.** The hand-rolled `@Primary` Postgres DataSource used
   `@ConfigurationProperties("spring.datasource")` on a raw `DataSourceBuilder`, which binds `url` onto
   Hikari — whose property is `jdbcUrl`. Removing it (now that no second DataSource bean exists) lets Boot
   auto-configure Postgres correctly, and that bean IS still post-processed, so the RLS tenant-GUC fix
   (2099ac0) is still inherited for free.
4. **Missing Postgres `jdbcTemplate`.** `JdbcTemplateAutoConfiguration` is
   `@ConditionalOnMissingBean(JdbcTemplate.class)`, so declaring `clickHouseJdbcTemplate` made it back off
   and never create the default. Redeclared explicitly and `@Primary`.

Plus an IT-helper bug: `applyClickHouseSchema` stripped `--` comments **after** splitting on `;`, so V001
line 8 (`...between merges); acceptable for analytics facts, per 12-RESEARCH`) was torn in half and its
comment tail executed as SQL (`Syntax error: failed at position 1 (acceptable)`). Its own comment claimed
it matched `deploy/clickhouse/apply.sh` — apply.sh strips first (`sed 's/--.*$//'`), which is why 12-02's
live apply worked. Now genuinely matches.

## Execution note

The delegated executor completed tasks 1–2 (commits `a99d0c2`, `f055694`) and was then cancelled at a
session boundary, mid-task-3, with the consumers and IT written but uncommitted and unverified. The
harness refused to resume it, so task 3 — committing, and actually driving the IT to green — was finished
in the orchestrator main loop. Every failure above was found there; the executor had never run the IT.

## Commits

- `a99d0c2` feat(12-03): ClickHouse DataSource, business-day boundary, Postgres idempotency side-tables
- `f055694` feat(12-03): RabbitMQ topology + the three fact writers
- `6bb95d5` fix(12-03): pin clickhouse-jdbc 0.8.6, fix reporting DataSource/JdbcTemplate wiring
- `adc2fd9` feat(12-03): ORDER_CLOSED/TILL_CLOSED/VENDOR_INVOICE_MATCHED consumers + real-container ETL IT
