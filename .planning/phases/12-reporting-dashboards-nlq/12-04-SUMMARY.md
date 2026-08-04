---
phase: 12-reporting-dashboards-nlq
plan: 04
subsystem: nlq
tags: [nlq, sql-validation, jsqlparser, ast, security, tenant-isolation, tdd, injection-defense]
status: complete
completed: 2026-07-16

# Dependency graph
requires:
  - phase: 12-reporting-dashboards-nlq
    plan: 01
    provides: nlq-service scaffold (Spring Boot, JSqlParser 5.3, Flyway, Redis, port 8094)
  - phase: 12-reporting-dashboards-nlq
    plan: 02
    provides: clickhouse_analytics fact-table column lists (the PII deny-list + allowlist target tables) and the nlq_readonly execution user
provides:
  - "SqlValidationPipeline.validate(String sql, QueryContext ctx) -> String — the 7-stage AST validation gate between Claude-generated SQL and ClickHouse"
  - "QueryContext record + RejectionCode enum + NlqRejectedException — the public contract 12-07 (controller) and 12-09 (frontend messages) consume"
  - "nlq_allowed_tables (role->table allowlist, seeded) + nlq_query_log (RLS'd, impersonated_by) via Flyway V1__nlq_schema.sql"
  - "AllowedTableService.allowedFor(roleCode) -> Set<String>, Redis-cached 10min, DB-backed, fail-through-to-Postgres (never allow-everything)"
  - "SqlInjectionAttackTest — the adversarial negative-control suite (security evidence for NLQ-01), 29 cases each asserting a typed RejectionCode"
affects: [12-07 (calls validate() with the nlq_readonly executor; its Claude system prompt must generate only within the supported query shape), 12-09 (maps RejectionCode -> user-facing message)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQL safety by AST parse + mutate + RE-PARSE-to-PROVE (JSqlParser), never regex/string surgery — the tenant/branch predicate is injected into the AST, the mutated SQL is re-serialised and re-parsed, and the pipeline walks the re-parsed tree to prove the predicate landed at the outermost conjunctive level; if it cannot prove it, it rejects"
    - "Whitelist-not-blacklist shape gate: reject anything that is not, after CCJSqlParserUtil.parseStatements, exactly one Select — a blacklist would always miss a ClickHouse verb (OPTIMIZE/SYSTEM/...)"
    - "Deliberately small provable surface: single-table PlainSelect only; JOIN/CTE/UNION/subquery-in-WHERE are rejected rather than risk an unprovable rewrite (a smaller provable surface beats a larger unprovable one)"
    - "Watched-RED negative controls on a security control: temporarily disable the guard, confirm the corresponding attack test goes RED, restore — proves the guard is load-bearing, not decorative"

key-files:
  created:
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/RejectionCode.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/NlqRejectedException.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/QueryContext.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/SqlValidationPipeline.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/stage/ShapeCheckStage.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/stage/AstParseStage.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/stage/TableAllowlistStage.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/stage/PiiDenylistStage.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/stage/TenantFilterStage.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/stage/BranchFilterStage.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/stage/LimitInjectStage.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/stage/PredicateInjector.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/validation/stage/SqlNames.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/allowlist/AllowedTableEntity.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/allowlist/AllowedTableRepository.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/allowlist/AllowedTableService.java
    - services/nlq-service/src/main/resources/db/migration/V1__nlq_schema.sql
    - services/nlq-service/src/test/java/io/restaurantos/nlq/validation/SqlValidationPipelineTest.java
    - services/nlq-service/src/test/java/io/restaurantos/nlq/validation/SqlInjectionAttackTest.java
    - services/nlq-service/src/test/java/io/restaurantos/nlq/validation/TestPipelines.java
    - services/nlq-service/src/test/java/io/restaurantos/nlq/validation/stage/StageCoverageTest.java
  modified:
    - services/nlq-service/src/main/resources/application.yml
    - services/nlq-service/pom.xml

key-decisions:
  - "Open Question 4 CLOSED: nlq_allowed_tables lives in nlq-service's own nlq_db, keyed by ROLE (not tenant), Redis-cached 10min. It is a PLATFORM-level table — NO tenant_id column, NO RLS — because it describes what a ROLE may see, not what a TENANT owns (same category as auth's non-RLS lookup tables). A comment in the migration warns future reviewers not to add RLS."
  - "Supported query shape is deliberately narrow: a single-table PlainSelect (optional WHERE/GROUP BY/ORDER BY/LIMIT). JOINs, CTEs, UNIONs and subqueries-in-WHERE are REJECTED at the tenant-filter stage — not because they are inherently unsafe, but because the injector cannot PROVE by re-parse that every table reference is tenant-constrained in those shapes. 12-07's Claude system prompt must instruct the model to generate ONLY within this shape (this is how the rejection rate stays low without weakening the gate)."
  - "JaCoCo parse-timeout: JSqlParser 5.3's CCJSqlParserUtil does NOT expose a withTimeOut(...) builder on this version (verified against the actual jar, contra older docs). AstParseStage bounds the parse with an explicit CompletableFuture.get(1000ms, ...) on an injectable executor instead."
  - "The nlq_readonly ClickHouse profile (12-02) caps rows/time server-side; LimitInjectStage is the polite first line (inject 1000 default, clamp to 10000 max), the profile is the hard line. Both exist on purpose."

# Metrics
duration: ~90min
tasks: 3
commits: 3 (+1 docs)
tests: 56 (7 contract + 29 adversarial + 20 stage-branch), all green
validator-coverage: 95.3% line (JaCoCo, io.restaurantos.nlq.validation.**)
---

# Phase 12 Plan 04: NLQ 7-Stage SQL AST Validation Pipeline Summary

**A pure, exhaustively-tested 7-stage JSqlParser-AST pipeline that stands between Claude-generated SQL and ClickHouse — it treats every query as hostile and PROVES it safe (tenant/branch predicate injected via AST, then re-parsed and re-walked to prove it landed) rather than checking it "looks fine"; unprovable shapes are rejected, never executed unfiltered.**

## What was built (TDD: red → green → harden)

**Task 1 (RED)** — Wrote both suites against a not-yet-existent pipeline plus the public contract types (`RejectionCode`, `NlqRejectedException`, `QueryContext`). Suites failed for the right reason (no `SqlValidationPipeline`), not on test-file compile errors.

**Task 2 (GREEN)** — Implemented the 7 stages until both suites went green:
1. **ShapeCheckStage** — trimmed-prefix must be `SELECT`/`WITH`; `CCJSqlParserUtil.parseStatements` must yield exactly ONE statement (never semicolon-counting); that statement must be a `Select` (whitelist, not blacklist); length ≤ 4000.
2. **AstParseStage** — real AST parse, bounded to 1s via `CompletableFuture` on an injectable executor (JSqlParser 5.3 has no `withTimeOut`).
3. **TableAllowlistStage** — `TablesNamesFinder` walks EVERY table reference (CTEs/subqueries/UNION arms included); each normalised name (strip `clickhouse_analytics.`, lowercase) must be in `allowedTableService.allowedFor(role)`; empty table set → fail closed.
4. **PiiDenylistStage** — rejects a named deny-listed column AND a `SELECT *` / `t.*` that would star-expand to include one.
5. **TenantFilterStage** — ANDs `tenant_id = '<ctx>'` in via the AST, then RE-PARSES and re-walks to prove it; unprovable → `TENANT_FILTER_MISSING`.
6. **BranchFilterStage** — same mechanism for `branch_id`, non-OWNER only; non-OWNER with null branch → rejected.
7. **LimitInjectStage** — inject 1000 when absent, clamp to 10000 when over, reject negative/zero/non-numeric.

Plus `AllowedTableService` (DB-backed, Redis-cached 10min, fail-through-to-Postgres) and `V1__nlq_schema.sql`.

**Task 3 (HARDEN)** — Watched-RED controls proved each guard load-bearing (details below), found + fixed a real aliased-star PII bypass, and drove the validator package to 95.3% line coverage with a genuinely-scoped JaCoCo gate.

## Watched-RED control results (recorded per plan requirement)

- **Re-parse proof (TenantFilterStage/PredicateInjector) commented out** → the UNION-unfiltered-arm, CTE, subquery, correlated-IN and JOIN cases went RED (nothing thrown, or `ClassCastException`, or wrong code). Proof is load-bearing. Restored.
- **`instanceof Select` whitelist (ShapeCheckStage) commented out** → only the `WITH x AS (...) DELETE FROM ...` case went RED (`SHAPE_INVALID` → `PARSE_FAILED`); plain INSERT/UPDATE/DELETE/DROP stayed GREEN because they are caught earlier by the `SELECT`/`WITH` prefix check. This precisely located what the whitelist uniquely defends: a CTE-scoped DDL that satisfies the `WITH` prefix. Added that case as a permanent attack test. Restored.

## Bug found and fixed during hardening

**Aliased-table star PII bypass.** `SELECT t.* FROM sales_order_facts t` — the `AllTableColumns` qualifier is the ALIAS `t`, not the real table name, so the deny-list lookup missed it and the star was allowed. `PiiDenylistStage` now resolves the qualifier against the FROM table's alias/name (fail-closed to the FROM table's denied set). Covered by both a stage test and a pipeline-level attack case.

## Honest coverage note

Validator package (`io.restaurantos.nlq.validation.**`) line coverage is **95.3%**, enforced by a JaCoCo `check` scoped to that package via check-goal class-file `<includes>` (rule-level BUNDLE `<includes>` do NOT narrow — an earlier attempt passed spuriously at 84.9% before I caught it; the gate now correctly reports 0.953 and fails when set to 0.999). Enforced floor is 0.92 (small margin above the residual). The remaining ~5% (12 lines) are irreducible fail-closed guards that no valid input can trigger:
- `PredicateInjector`: the post-injection proof-failure branches and the `isExactPredicate` false-arms — never reached because for the supported single-table shape the serialise→re-parse round-trip always succeeds and always contains the injected predicate. They are the "should never happen, reject anyway" core of the control; deleting them would weaken the gate.
- `AstParseStage`: the `InterruptedException` and non-`NlqRejected` `ExecutionException` handlers — concurrency paths that cannot be triggered deterministically in a unit test.

## Verification (all run)

- `mvn -pl services/nlq-service -am test` → **56 tests, 0 failures** (7 contract + 29 adversarial + 20 stage-branch).
- `mvn -pl services/nlq-service verify` → JaCoCo "All coverage checks have been met" at the scoped 0.92 floor (real 0.953); load-bearing confirmed (fails at 0.999).
- Adversarial suite: 27 `assertThrows`, 300 lines (≥ 20 / ≥ 120 required); every rejection asserts a specific `RejectionCode`.
- No `String.format` / string-concat / `replaceAll` / `.matches()` SQL surgery anywhere in `validation/stage/` — all mutation via the JSqlParser AST.

## Pins for downstream plans

**For 12-07 (Claude call + ClickHouse execution):**

- Signature: `String SqlValidationPipeline.validate(String sql, QueryContext ctx)` — returns safe SQL or throws `NlqRejectedException`.
- `QueryContext(UUID tenantId, UUID branchId, String roleCode, boolean isOwner, UUID userId, UUID impersonatedBy)` — build from `JwtClaims` at the controller. `isOwner` = OWNER role (cross-branch); everyone else is branch-pinned.
- **Supported query shape (the model MUST generate only within this):** a single `SELECT` over ONE allowed fact table, with optional `WHERE`, `GROUP BY`, `ORDER BY`, and `LIMIT`. NO JOINs, NO CTEs, NO UNIONs, NO subqueries. Anything else is rejected with `TENANT_FILTER_MISSING`. Columns must be named explicitly (no `SELECT *` on a table carrying a PII column).
- Run the returned SQL as the `nlq_readonly` ClickHouse user (12-02) — defence in depth if the validator is ever bypassed.
- `nlq_query_log` columns to write: `id, tenant_id, branch_id, user_id, impersonated_by, role_code, question, generated_sql, executed_sql, rejection_code, row_count, duration_ms, cache_hit, created_at`. RLS is ENABLED+FORCED (set `app.current_tenant_id` before insert). Fill `impersonated_by` from `JwtClaims.impersonatedBy()`.

**For 12-09 (frontend):** `RejectionCode` values to map to user-facing messages: `SHAPE_INVALID, PARSE_FAILED, TABLE_NOT_ALLOWED, PII_COLUMN_DENIED, TENANT_FILTER_MISSING, BRANCH_FILTER_MISSING, LIMIT_INVALID`. The exception message is a safe generic string (it never echoes the offending SQL — that would be an oracle for a validator-probing attacker).

**PII deny-list** (`restaurantos.nlq.pii-denylist`, application.yml): `sales_order_facts.customer_id`, `sales_order_facts.cashier_id`, `till_session_facts.cashier_id` — the real customer/staff-identifying columns from 12-02's fact tables.

**Allowlist seed** (V1): OWNER / TENANT_ADMIN / MANAGER / ACCOUNTANT get all four fact tables; CASHIER / KITCHEN_STAFF / others get none (empty allowlist → every query rejected at Stage 3, correct).

## Deviations from Plan

1. **[Rule 1 - Bug] Aliased-table star PII bypass** — see "Bug found and fixed" above. Fixed inline, added tests.
2. **JaCoCo instrumentation of JSqlParser's generated tokenizer** — `CCJSqlParserTokenManager.jjMoveNfa_0` is too large for ASM (`MethodTooLargeException`), crashing the coverage agent. Excluded `net.sf.jsqlparser.**` from instrumentation (we only need coverage of our own code). [Rule 3 - Blocking]
3. **JaCoCo gate scoping** — the plan implied a simple package rule; rule-level BUNDLE `<includes>` do not narrow the analysed set (it passed spuriously at 84.9%). Corrected to check-goal-level class-file `<includes>` scoped to `io/restaurantos/nlq/validation/**`, which genuinely enforces the validator-package ratio. [Rule 1 - Bug]

**No architectural changes.** No Claude call, no ClickHouse execution — deliberately isolated to 12-07 per the plan.

## Commits

- `d19a15a` test(12-04): add failing 7-stage SQL validation + injection-attack suites
- `743d353` feat(12-04): implement 7-stage SQL AST validation pipeline
- `220733b` test(12-04): harden injection suite via watched-RED controls on the validator
- (this) docs(12-04): complete NLQ validation pipeline plan

---
*Phase: 12-reporting-dashboards-nlq*
*Completed: 2026-07-16*
