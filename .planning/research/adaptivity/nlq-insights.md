# NLQ & Operational Insights — ground truth, and a design for inventory + waste intelligence

Research date: 2026-08-07
Branch read: `phase-13-access-repair` @ `5fba4a9`
Scope: `services/nlq-service`, `services/reporting-service`, `deploy/clickhouse`, `services/inventory-service`
(waste/count/recipe/movement model), the gateway's NLQ gating, and the frontend NLQ slice.

Every claim about the repo below cites a file I opened. Two claims are backed by an **empirical probe**
I ran against the actual `jsqlparser-5.3.jar` in `~/.m2` (marked **PROBED**). Anything I could not
verify is marked **UNVERIFIED** rather than asserted.

Out of scope (covered by the parallel swarm, referenced as dependencies only): FBR e-invoicing,
thermal printing, biometric attendance, ERP module gaps, cross-module integration gaps, UI/UX visual
direction, frontend component stack, tenant configurability, testing strategy.

---

# PART A — What NLQ actually is today

## A.1 The one code path, end to end

`services/nlq-service/src/main/java/io/restaurantos/nlq/service/NlqService.java` is the only route from
a question to ClickHouse. Verified sequence (`NlqService.query`, lines 73–146):

1. `quotaService.reserve(tenantId, userId)` — **before** any LLM spend (lines 75–87).
2. Redis result-cache lookup; a hit rolls the quota back and returns (lines 90–97).
3. `schemaPromptBuilder.buildFor(ctx.roleCode())` → `claudeClient.generateSql(question, prompt)` (99–108).
4. `sqlValidationPipeline.validate(rawSql, ctx)` — the gate (110–118).
5. `executor.execute(safeSql)` as the `nlq_readonly` ClickHouse user (120–132).
6. `claudeClient.narrate(...)` — best effort, never fails the request; skipped for empty results (137).
7. Cache 60 s + write exactly one `nlq_query_log` row (139–142).

Entry point: `POST /api/v1/nlq/query`,
`services/nlq-service/src/main/java/io/restaurantos/nlq/controller/NlqController.java`.
`@PreAuthorize("hasAuthority('nlq.query.run')")`. The request DTO is **only** `question` — the frontend
schema (`frontend/lib/api-client/schemas/nlq.schema.ts`) pins that and says so. Every scoping value is
built from the validated JWT in `buildContext` (lines 44–49), never from a header or body field.

**This part works.** It is not structurally-present-but-dead: `NlqServiceIT` boots a real Postgres +
Redis + ClickHouse 25.9 with the real `deploy/clickhouse/V001`/`V002` files read off disk, stubs only
`ClaudeClient`, and asserts 13 behaviours end to end
(`services/nlq-service/src/test/java/io/restaurantos/nlq/service/NlqServiceIT.java`).

## A.2 The 7-stage validator, stage by stage

`services/nlq-service/src/main/java/io/restaurantos/nlq/validation/SqlValidationPipeline.java`:

| # | Stage | File | What it actually enforces |
|---|---|---|---|
| 1 | `ShapeCheckStage` | `.../stage/ShapeCheckStage.java` | ≤4000 chars; prefix must be `SELECT`/`WITH`; parsed with `CCJSqlParserUtil.parseStatements` and rejected unless exactly **one** statement, and that statement `instanceof Select`. Whitelist, not blacklist. |
| 2 | `AstParseStage` | `.../stage/AstParseStage.java` | Real AST parse on a daemon pool with a hard 1000 ms `CompletableFuture.get` timeout. |
| 3 | `TableAllowlistStage` | `.../stage/TableAllowlistStage.java` | `TablesNamesFinder` over the whole AST; **empty table set → reject** (fail-closed, lines 30–35); each name normalised by `SqlNames.normalizeTable` (strips `clickhouse_analytics.`) and checked against the role allowlist. |
| 4 | `PiiDenylistStage` | `.../stage/PiiDenylistStage.java` | Configured `table.column` deny-list; `SELECT *` and aliased `t.*` both rejected when the table has any denied column. |
| 5 | `TenantFilterStage` → `PredicateInjector` | `.../stage/PredicateInjector.java` | Injects `tenant_id = '<uuid>'` via the AST, **re-parses its own output**, flattens the top-level AND tree treating a parenthesised group as one opaque conjunct, and requires an exact `Column = StringValue` match. Cannot prove → reject. |
| 6 | `BranchFilterStage` | `.../stage/BranchFilterStage.java` | Same mechanism for `branch_id`, skipped for OWNER. Non-OWNER with `branchId == null` → hard reject, never an unfiltered query. |
| 7 | `LimitInjectStage` | `.../stage/LimitInjectStage.java` | Injects `default-limit` when absent; clamps an explicit LIMIT above `max-result-rows`; rejects non-literal/zero/negative. |

The supported query **shape** is deliberately tiny (`PredicateInjector.requireSupportedShape`,
lines 80–97): a single `PlainSelect`, **no CTE, no JOIN, no subquery anywhere in the WHERE, FROM must
be a bare `Table`**. Anything else is rejected at stage 5 with `TENANT_FILTER_MISSING`.

**This shape constraint is the single most important fact for the design in Part E.** You cannot widen
NLQ's answers by teaching the model better SQL — you can only widen them by making the *fact tables*
wider.

### PROBED: what the parser does with ClickHouse-specific input

I ran `jsqlparser-5.3` directly (scratchpad probe, not committed):

| Input | Result | Consequence in the pipeline |
|---|---|---|
| `FROM remote('other:9000','clickhouse_analytics.sales_order_facts')` | parses; FROM item is `TableFunction`; `getTables()` = `[]` | **rejected** at stage 3 (empty table set) — fail-closed works |
| `FROM url('http://evil/x','JSON')` | same | **rejected** at stage 3 |
| `FROM numbers(10)` | same | **rejected** at stage 3 |
| `SELECT dictGet(...)` (no FROM) | parses, `getTables()` = `[]` | **rejected** at stage 3 |
| `... SETTINGS max_execution_time=600` | `JSQLParserException` | **rejected** at stage 1/2 |
| `... FORMAT JSON` | `JSQLParserException` | **rejected** |
| `FROM sales_order_facts FINAL` | parses as a plain `Table` | accepted (harmless) |
| `FROM sales_order_facts t WHERE t.business_date = today()` | injection yields `... AND t.tenant_id = '<uuid>'` | **alias-correct** — JSqlParser qualifies with the alias, not the base name |
| unaliased `clickhouse_analytics.sales_order_facts` | yields `clickhouse_analytics.sales_order_facts.tenant_id = ...` | valid, matched by the proof (`getColumnName()` is unqualified) |

So ClickHouse's remote/URL table functions — the obvious "read someone else's data" vector — are
blocked by the *empty table set* branch, not by an explicit rule. That is a genuine strength, and it is
untested: there is no test asserting `remote(...)` is rejected. Recommend adding one.

## A.3 The schema NLQ can query

Exactly four ClickHouse tables, created by `deploy/clickhouse/V001__analytics_facts.sql`:

| Table | Grain | Fed by |
|---|---|---|
| `sales_order_facts` | one row per closed order | `ORDER_CLOSED` |
| `sales_item_facts` | one row per sold line | `ORDER_CLOSED.items[]` |
| `purchase_tax_facts` | one row per matched vendor invoice | `VENDOR_INVOICE_MATCHED` |
| `till_session_facts` | one row per closed till | `TILL_CLOSED` |

All: `ReplacingMergeTree`, `PARTITION BY toYYYYMM(business_date)`,
`ORDER BY (tenant_id, branch_id, business_date, <key>)`, money as `Int64` paisa, `event_id` carried for
dedup and provenance.

**Three of these tables' most valuable columns are permanently NULL.**
`services/reporting-service/src/main/java/io/restaurantos/reporting/etl/SalesFactWriter.java`
lines 91–93 write literal `null` for `cogs_paisa`, `gross_margin_paisa` and `category_name`, with the
comment "Phase-8-deferred … 0 would falsely claim 'sold at cost'". Phase 8 has since shipped
(inventory-service computes COGS per ingredient — see Part C) but **nothing was ever wired back**.
`ReportService.run` still attaches the data-note `"COGS and margin require Inventory (Phase 8) and are
not yet available"` (`ReportService.java:80–82`).

`purchase_tax_facts` has **no `vendor_id`** at all — V001's comment records that
`VendorInvoiceMatchedPayload` never carried one, and `ReportCatalog` renamed its report to
`purchases-by-po` for exactly this reason (`ReportCatalog.java:18–27`).

V001 also states, verbatim, why there is no inventory data: *"Deliberately NOT created: any table fed
by STOCK_DEPLETED / LOW_STOCK_ALERT / WASTAGE_RECORDED / COUNT_VARIANCE_POSTED / TRANSFER_* (Phase 8,
not started — `grep -rn "STOCK_DEPLETED" services/` returns zero matches)"*. **That comment is now
stale**: all of those events have real producers today (Part C). The absence is no longer justified.

## A.4 How NLQ is gated per tenant — four independent gates

1. **Feature flag, gateway only.** `gateway/.../support/RouteFeatureMap.java:43` maps `/api/v1/nlq/` →
   `FEATURE_NLQ`; `FeatureFlagGlobalFilter` enforces it against `tenant_features:{tenantId}:FEATURE_NLQ`.
   `TierFeatureDefaults.java:65–67` puts `FEATURE_NLQ` at GROWTH+.
   **`NlqController` carries no `@RequiresFeature`** — unlike every inventory controller
   (`WastageController.java:29`, `RecipeController`, `TransferController`, …). See finding **S1**.
2. **Permission.** `nlq.query.run`, seeded by
   `services/auth-service/src/main/resources/db/changelog/v1.0.0/046-nlq-permissions.xml` for
   OWNER / TENANT_ADMIN / MANAGER / ACCOUNTANT only. CASHIER/CHEF deliberately get nothing.
3. **Role → table allowlist.** `nlq_allowed_tables` (`V1__nlq_schema.sql`) — role-keyed, **no
   `tenant_id`, no RLS, by explicit design**. Same four roles, all four fact tables. An empty allowlist
   is a valid answer and means "reject everything" (`AllowedTableService` javadoc lines 38–45).
4. **Quota.** `NlqQuotaService` writes `nlq_quota:{tenantId}:monthly_count` — the *exact* key the
   gateway reads (`FeatureFlagGlobalFilter.java:226`) — plus `nlq_quota:{tenant}:{user}:hourly_count`.
   The tenant's own allowance lives at `tenant:nlq_quota:{tenantId}`, written on tier change; the
   configured `monthly-quota-default` (500) is the conservative fallback. Fails **closed** on a Redis
   outage (503, `QuotaServiceUnavailableException`). The javadoc on `effectiveMonthlyLimit`
   (lines 72–88) documents that this whole seam was previously broken — two hardcoded numbers and an
   unread `tenants.nlq_quota` column — and was fixed in 13-14.

Isolation at rest: `nlq_query_log` has `ENABLE` + `FORCE ROW LEVEL SECURITY` with the standard
`tenant_isolation` policy (`V1__nlq_schema.sql:55–58`).

## A.5 Anthropic integration

`services/nlq-service/src/main/java/io/restaurantos/nlq/claude/ClaudeClient.java` — plain
`java.net.http.HttpClient` against `{base-url}/v1/messages`, `anthropic-version: 2023-06-01`, 10 s
timeout, fails closed to `ClaudeUnavailableException` on any non-200. Two models from config
(`application.yml:82–83`): `claude-sonnet-4-6` for SQL (1024 max tokens),
`claude-haiku-4-5` for narration (300 max tokens). The user question goes **only** into the `messages`
user turn, never concatenated into `system` — correct prompt-injection hygiene. The only output
processing is markdown-fence stripping.

`SchemaPromptBuilder` builds the role-scoped system prompt, Redis-cached 10 min. Its javadoc is blunt
and correct: *"This prompt is NOT a security control."* Column lists are a hardcoded
`Map.of(...)` of four entries (lines 40–61) with PII columns annotated `[NEVER SELECT - PII]`.

**Note for implementation:** `Map.of` tops out at 10 key/value pairs. Four fact tables today + the six
proposed in Part F is exactly 10 — any further growth requires `Map.ofEntries`. Cheap to get wrong.

**Narration ships tenant rows to Anthropic.** `ClaudeClient.narrate` serialises up to 20 result rows to
JSON and posts them (lines 91–94, 149–158). There is no per-tenant switch to disable narration, no
redaction, and no data-residency control. See finding **S6**.

## A.6 What the tests actually prove

- `SqlInjectionAttackTest` (300 lines) — 25 adversarial cases, each asserting a **specific**
  `RejectionCode`, not merely "it threw": INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/CREATE/RENAME/
  GRANT/`SYSTEM SHUTDOWN`/`OPTIMIZE`, `WITH x AS (...) DELETE`, multi-statement smuggling, line- vs
  block-comment obfuscation, `1=1 OR tenant_id=...` widening, UNION with an unfiltered arm, CTE,
  subquery-in-FROM, correlated IN-subquery, `system.users`, its own `nlq_query_log`, cross-role table
  denial, alias star bypass.
- `NlqServiceIT` — real containers; proves the DDL/INSERT attempts leave ClickHouse untouched (row
  count and table existence asserted), branch-2 rows never leak to a branch-1 MANAGER, cross-tenant
  cache poisoning fails, quota gates *before* the Claude call, impersonation is stamped.
- `SqlValidationPipelineTest`, `StageCoverageTest`, `NlqQuotaServiceTest` — stage-level and quota unit
  coverage.
- Gateway side: `FeatureFlagFilterIT#nlqQuotaExceeded_returns429`.

**Not covered:** ClickHouse table functions (`remote`/`url`/`numbers`); deny-listed columns used in
`WHERE`/`GROUP BY`/`HAVING`/`ORDER BY` (finding **S3**); `@RequiresFeature` at the service (**S1**); any
end-to-end test through the gateway with `FEATURE_NLQ` off.

---

# PART B — reporting-service and the ClickHouse ETL

## B.1 Facts, dimensions, ETL

Three consumers, three queues, and **only** `pos.topic` + `purchasing.topic` are bound —
`services/reporting-service/src/main/java/io/restaurantos/reporting/config/ReportingRabbitConfig.java`
says so in its class javadoc and in code (lines 26–87): *"Deliberately declares NO binding to the
inventory exchange."*

| Consumer | Event | Writer |
|---|---|---|
| `OrderClosedConsumer` | `pos.order.closed` | `SalesFactWriter` → `sales_order_facts` + `sales_item_facts` |
| `TillClosedConsumer` | `pos.till.closed` | `TillSessionFactWriter` → `till_session_facts` |
| `VendorInvoiceMatchedConsumer` | `purchasing.invoice.matched` | `PurchaseTaxFactWriter` → `purchase_tax_facts` |

Idempotency: `processed_events (consumer, event_id)` in Postgres
(`V1__reporting_schema.sql:54–61`) + `ReplacingMergeTree` in ClickHouse as the eventual-consistency
safety net. Business day is derived from the payload's own `closedAt` via
`BusinessDay` + `BranchTimeZoneResolver`, never `Instant.now()` (`OrderClosedConsumer` javadoc).

**There are no dimension tables.** No `dim_ingredient`, no `dim_menu_item`, no `dim_user`, no
`dim_branch`, no `dim_vendor`. Every id in every fact is an opaque UUID. `sales_item_facts` carries a
denormalised `item_name` string; nothing else does.

`ClickHouseSchemaGuard` refuses to boot unless all four fact tables exist — a good fail-fast pattern to
extend for new facts.

## B.2 Named reports and dashboard

`ReportCatalog` (`.../report/ReportCatalog.java`) registers **seven** reports: `sales-by-day`,
`sales-by-item`, `sales-by-hour`, `sales-by-order-type`, `discount-summary`, `till-sessions`,
`purchases-by-po`. Its javadoc is explicit that this is *not* the spec's 40 — *"a report backed by no
data is a lie"*.

`ReportService` binds `tenant_id` from `TenantContext.requireTenantId()` only, and validates a
requested `branchId` against the caller's own (`resolveEffectiveBranchId`, lines 99–107) — only OWNER
may run tenant-wide. `isOwner()` uses `claims.roles().contains("OWNER")`.

`DashboardTileService` computes four tiles from `sales_order_facts` for today, caches 10 s in Redis,
pushes over WebSocket through `TilePushThrottle`. Its javadoc records that `open-tills` was dropped
rather than faked, because `till_session_facts` only ever sees TILL_CLOSED.

## B.3 The honest scorecard: can an owner's real questions be answered?

| Question | Answerable via NLQ today? | Why |
|---|---|---|
| "Which items lose me money" | **No** | `sales_item_facts.cogs_paisa` / `gross_margin_paisa` are written NULL (`SalesFactWriter:91–92`). No COGS anywhere in ClickHouse. |
| "What did we waste last week" | **No** | Data exists in `inventory_db` (Part C) but no waste fact, no inventory ETL binding, no allowlist row. |
| "Which supplier raised prices" | **No** | No vendor identity in any fact (`purchase_tax_facts` has no `vendor_id`). The nearest thing, `VendorAnalyticsService.computePriceVariancePct`, measures *invoice-vs-PO* variance per vendor — a 3-way-match compliance metric, not a price trend — and lives in purchasing's Postgres. |
| "What is my food cost percentage" | **No** | Needs COGS ÷ revenue. Revenue exists; COGS does not. finance-service posts COGS journal entries from `STOCK_DEPLETED`, so the number exists in the GL and nowhere analytics can reach. |
| "When do I need to reorder" | **No (via NLQ)** | `ReorderSuggestionService.shortfalls(branchId)` genuinely works, but it is point-in-time (`qty ≤ reorder_point`, top up to `par_level`) with no usage velocity or lead time, lives in inventory's Postgres, and is invisible to ClickHouse. |
| "Which staff void the most orders" | **No** | pos publishes `ORDER_VOIDED` with `voidedBy` (`OrderServiceImpl.java:50–51, 666–679`; `PosVoidRefundPayloads.OrderVoidedPayload`), reporting binds no queue for it, no void fact exists, and `sales_order_facts` only records CLOSED orders. |

**0 of 6.** Today NLQ can answer revenue, order counts, peak hours, order-type mix, discounts, till
variance, and PO spend. That is a sales-reporting assistant, not operational insight.

---

# PART C — Inventory: what is already modelled (a lot), and what is missing

I grepped for `waste|wastage|spoilage|variance|stock_take|yield` across `services/` and `shared-lib/`.
Inventory is far more complete than the ClickHouse comment implies.

## C.1 What exists and is live

**Wastage** — `services/inventory-service/src/main/resources/db/migration/V11__stock_wastage.sql`:

```
stock_wastage(id, tenant_id, branch_id,
              reason CHECK IN ('SPOILAGE','BREAKAGE','EXPIRY','STAFF_MEAL','CUSTOMER_RETURN','OTHER'),
              notes, total_cost_paisa BIGINT, recorded_at, created_by, ...)
stock_wastage_lines(id, tenant_id, wastage_id, ingredient_id,
                    qty NUMERIC(18,4), unit_cost_paisa BIGINT, line_cost_paisa BIGINT, CHECK qty>0)
```
Both `ENABLE` + `FORCE ROW LEVEL SECURITY`.

`WastageService.record` (`.../service/WastageService.java`) locks ingredients in sorted UUID order,
values every line at the **aggregate moving-average cost** (`stock.getAvgCostPaisa()`) — the same
number depletion uses, so a kilo thrown away and a kilo sold hit the P&L identically — writes a signed
`WASTAGE` movement per line, and publishes one `WASTAGE_RECORDED` through the transactional outbox as
the last statement. Endpoint: `POST/GET /api/v1/inventory/wastage`
(`WastageController`, `@RequiresFeature("FEATURE_INVENTORY")`, manage/view authz).
`WastageServiceIT` exists.

**Stock counts with variance and a cap** — `V1__inventory_schema.sql` (`stock_counts`,
`stock_count_lines`) + `V9__stock_count_variance_cap.sql` which adds `variance_pct`, `cap_pct`,
`override_reason`. `StockCountService.postCount` computes `variance_qty = counted − system`, values it
at MAC, resolves a per-category `variance_cap_pct` most-specific-wins up the category tree, and
**refuses to post an over-cap line without a written reason** — reporting every offending line at once
and rolling the whole count back. Emits `COUNT_VARIANCE_POSTED`.

**Recipe-driven depletion** — `DepletionService.deplete` resolves the effective recipe version at
`closedAt`, converts each line via
`UomConverter.effectiveBaseQty = (qty × toBaseFactor ÷ (yield_pct/100)) × orderQty ÷ yield_servings`,
walks lots FEFO flooring each at zero, decrements aggregate `qty_on_hand` by the **full** required
quantity (oversell may go negative, by design), values COGS at MAC, writes a `DEPLETION` movement per
ingredient, queues `LOW_STOCK_ALERT` on reorder-point breach, and publishes `STOCK_DEPLETED` with
per-ingredient `DepletedLine(ingredientId, qtyBaseDepleted, cogsPaisa, cogsAccountCode,
inventoryAccountCode)`. When a sold item has no recipe it publishes `DEPLETION_INCOMPLETE` rather than
silently skipping.

**A complete typed stock ledger** — `inventory_movements` (`V1__inventory_schema.sql:153–179`):
`movement_type ∈ OPENING_BALANCE | RECEIPT | DEPLETION | TRANSFER_OUT | TRANSFER_IN | COUNT_VARIANCE |
WASTAGE | TRANSFER_VARIANCE`, signed `qty NUMERIC(18,4)`, `unit_cost_paisa`, `total_cost_paisa`,
`reference_type`/`reference_id`, `movement_at`, indexed on `(tenant_id, branch_id, movement_at)`.

**This table is the whole theoretical-vs-actual model already sitting in the database.** Nothing reads
it analytically.

**Also present:** `stock_lots` with expiry + FEFO index; `ExpirySweepService` nightly `EXPIRY_ALERT`
sweep (with the RLS-exempt tenant-registry pattern — see D.3); `ReorderSuggestionService` (reorder
point = *when*, par level = *how much*); `RecipeCostPreviewService` (live plate cost from MAC);
`item_categories` with `default_waste_account_code`, `variance_cap_pct`,
`exclude_from_po_suggestions` (`V5__item_categories.sql`).

**Consumers:** finance-service alone. `WastageConsumer`, `CountVarianceConsumer`,
`StockDepletedConsumer` post journal entries. Nothing in reporting, nothing in notification.

## C.2 What is missing for real waste control

| # | Gap | Evidence |
|---|---|---|
| W1 | **Reason codes are a hardcoded CHECK constraint**, not tenant data. No "burnt", "dropped", "wrong order", "over-prep", "trim loss", "comped". No controllable/uncontrollable classification. | `V11__stock_wastage.sql:20–21` |
| W2 | **No attribution beyond `created_by`.** No shift, no station, no supervisor, no photo. | `V11` column list |
| W3 | **No finished-goods (menu-item) waste.** Only ingredient write-offs. A binned plated dish loses the whole recipe cost; there is no way to record it as such. | `WastageDtos.WastageLineRequest(ingredientId, qty)` |
| W4 | **No production/prep events.** Theoretical usage is derived purely from *sales*. Prep 40 portions, sell 25 → 15 portions of prep loss that nothing records. Yield variance is therefore **not measurable** — `recipe_lines.yield_pct` is an assumption applied at depletion, never compared to reality. | `UomConverter.effectiveBaseQty`, `DepletionService` |
| W5 | **No approval threshold on write-offs.** Stock counts have a cap+override; wastage has none — any user with manage rights can write off any amount silently. | `WastageService.record` vs `StockCountService.postCount` |
| W6 | **No reversal.** `stock_wastage.deleted_at` exists and is never written. A mis-keyed write-off can only be corrected by an offsetting stock count. | `WastageService` (no delete/void path) |
| W7 | **`WASTAGE_RECORDED` collapses multi-line write-offs.** `ingredientId` is the *first* line's id for single-line write-offs and **null** for multi-line ones; only a total is carried. A waste ETL keyed on this event cannot produce per-ingredient detail. | `WastageService.java:150–161`; `InventoryEventContract.WastageRecordedPayload` |
| W8 | **`stock_counts` has no `count_type`.** A 3-line spot check is indistinguishable from a full physical inventory, so a variance report cannot tell signal from noise. | `V1__inventory_schema.sql:226–239` |
| W9 | **No waste analytics anywhere.** `GET /api/v1/inventory/wastage?branchId=` returns raw headers with ingredient UUIDs — no date range, no aggregation, no reason breakdown, no names. | `WastageController.list`, `WastageService.list` |

---

# PART D — Design

## D.1 The governing decision: widen the facts, not the grammar

The validator's provable-safety property depends on a query shape it can re-parse and prove
(`PredicateInjector.requireSupportedShape`). Relaxing it to allow JOINs would mean proving the tenant
predicate on every join arm — the exact thing 12-04 declined to do ("a smaller provable surface beats a
larger unprovable one").

**Decision D-1: never relax the NLQ SQL shape. Pre-join everything at ETL/rollup time into wide,
single-table facts.** Every new question in the catalogue must reduce to
`SELECT … FROM <one fact> WHERE … GROUP BY … ORDER BY … LIMIT n`.

**Decision D-2: add a curated metric layer above free-form SQL.** Free-form NL→SQL is the wrong tool
for *defined* metrics. "Food cost percentage" has one correct formula; letting a model re-derive it per
question is how you ship a number an owner acts on and that is wrong. Introduce `nlq_metrics`, modelled
directly on `ReportCatalog`'s proven pattern (hand-written parameterised SQL with binds, tenant/branch
resolved server-side). Claude's job becomes **routing + parameter extraction**, returned as structured
JSON; free-form SQL remains the fallback for the long tail, through the unchanged 7-stage pipeline.

This also fixes cost and latency: routing is a Haiku-class task, and a matched metric is deterministic
and cacheable far beyond 60 s.

## D.2 The question catalogue

Format: question → metric code → the fact it reads → what must be built first.

### Money & menu

| Question | Metric | Fact | Prereq |
|---|---|---|---|
| "Which items lose me money?" | `menu-item-margin` | `menu_item_pnl_facts` | F3 (COGS attribution) |
| "What's my food cost percentage?" (period, branch, category) | `food-cost-pct` | `daily_pnl_facts` | F3 |
| "Which items have the worst margin *trend*?" | `menu-item-margin-trend` | `menu_item_pnl_facts` | F3 |
| "What are my top sellers by profit, not revenue?" | `top-items-by-profit` | `menu_item_pnl_facts` | F3 |
| "Which categories are dragging margin down?" | `category-margin` | `menu_item_pnl_facts` (denormalised category) | F3 + dim |

### Waste

| Question | Metric | Fact | Prereq |
|---|---|---|---|
| "What did we waste last week?" | `waste-summary` | `waste_facts` | F1 |
| "What are we wasting most, by cost?" | `waste-by-ingredient` | `waste_facts` | F1 + `dim_ingredient` |
| "Why are we wasting it?" | `waste-by-reason` | `waste_facts` | F1 + W1 (reason codes) |
| "Is waste up or down vs last month?" | `waste-trend` | `waste_facts` | F1 |
| "What % of my food cost is waste?" | `waste-ratio` | `daily_pnl_facts` | F1 + F3 |
| "Which shift/station wastes most?" | `waste-by-shift` | `waste_facts` | F1 + W2 |

### Variance / shrinkage / theft

| Question | Metric | Fact | Prereq |
|---|---|---|---|
| "Where is stock disappearing?" | `usage-variance` | `stock_variance_facts` | F2 + F4 |
| "Which ingredients have unexplained loss?" | `unexplained-variance-by-ingredient` | `stock_variance_facts` | F4 |
| "Show me count overrides" | `count-override-audit` | `stock_count_facts` | F2 |

### Purchasing

| Question | Metric | Fact | Prereq |
|---|---|---|---|
| "Which supplier raised prices?" | `vendor-price-change` | `purchase_price_facts` | F5 |
| "What am I paying per kg of chicken over time?" | `ingredient-price-trend` | `purchase_price_facts` | F5 |
| "Which vendor is cheapest for X?" | `vendor-price-compare` | `purchase_price_facts` | F5 |

### Stock / reorder

| Question | Metric | Fact | Prereq |
|---|---|---|---|
| "What do I need to order?" | `reorder-shortfalls` | `stock_position_facts` | F6 |
| "How many days of cover do I have?" | `days-of-cover` | `stock_position_facts` + usage velocity | F2 + F6 |
| "What's about to expire?" | `expiring-stock` | `stock_position_facts` | F6 |

### People

| Question | Metric | Fact | Prereq |
|---|---|---|---|
| "Which staff void the most orders?" | `voids-by-staff` | `order_void_facts` | F7 + `dim_user` |
| "Which cashier has the worst till variance?" | `till-variance-by-cashier` | `till_session_facts` (**exists today**) | `dim_user` + column-level authz (S3/S4) |
| "Who discounts the most?" | `discounts-by-staff` | `sales_order_facts` (needs `discounted_by`) | payload additive field |

Note `till-variance-by-cashier` is answerable from data that already lands. It is the cheapest
high-value insight in the whole catalogue, blocked only by the PII deny-list and the absence of a name
dimension.

## D.3 Theoretical vs actual — the model

Per (tenant, branch, ingredient) over a period bounded by two posted counts:

```
opening_qty            = counted_qty at the period-opening count
+ receipts_qty         = Σ movements WHERE type = 'RECEIPT' or 'OPENING_BALANCE'
+ transfers_in_qty     = Σ movements WHERE type = 'TRANSFER_IN'
- transfers_out_qty    = Σ movements WHERE type = 'TRANSFER_OUT'
- theoretical_usage    = Σ |movements| WHERE type = 'DEPLETION'      <- recipe-driven, already written
- recorded_waste_qty   = Σ |movements| WHERE type = 'WASTAGE'        <- already written
= expected_closing_qty
                       vs
  counted_qty          = the period-closing count
=> unexplained_variance_qty  = counted_qty - expected_closing_qty
   unexplained_variance_cost_paisa = round(unexplained_variance_qty × avg_cost_paisa)   [Int64]
```

Every input already exists in `inventory_movements` + `stock_count_lines`. Nothing new needs to be
*captured* for the core variance number — only *computed and landed*.

**Period boundaries.** The natural period is count-to-count **per ingredient**, not calendar month —
`ingredient_branch_stock.last_counted_at` (`V1:66`) is the anchor and is already maintained by
`StockCountService` (line 139). Calendar periods would attribute variance to a window in which the item
was never counted.

**Interpretation, which the UI must state plainly:**
- Negative unexplained variance = stock present in the book, absent on the shelf → over-portioning,
  unrecorded waste, or theft, in that order of likelihood.
- Positive = under-recorded receipts, or a recipe that over-states usage.
- **A single count is not evidence.** A persistent one-sided variance across ≥3 counts is.

**What is NOT separable, and must be said so:**
- Over-portioning vs theft — indistinguishable from the ledger. Separating them requires a *portion
  audit* (weigh N plated portions, record actual vs recipe). Propose an optional
  `portion_audits(ingredient_id, menu_item_id, sample_size, expected_qty, actual_qty, auditor)` record;
  it is the only honest way to attribute the gap.
- **Yield variance** — requires prep/butchery events capturing input and output quantity. `yield_pct`
  is currently an *assumption baked into depletion*, never validated. Propose
  `production_batches(recipe_id | ingredient_id, input_qty, output_qty, produced_by, batch_at)`;
  `actual_yield_pct = output/input`, and `yield_variance = actual − recipe.yield_pct`. **This is genuinely
  new capture and should be phased second** — it is the difference between "we lose 8% on chicken" and
  "our recipe assumes 85% yield and we actually get 77%".

## D.4 New ClickHouse facts (F1–F7)

Conventions kept verbatim from `V001__analytics_facts.sql`: `ReplacingMergeTree`,
`PARTITION BY toYYYYMM(business_date)`, `ORDER BY (tenant_id, branch_id, business_date, <key>)`,
`event_id UUID`, tenant/branch as the leading sort columns so the NLQ-injected predicates are a prefix
seek.

**Money typing.** Following the repo's V12 rule as written in
`InventoryEventContract.StockReceivedPayload`'s javadoc: **AMOUNTS are `Int64` paisa; RATES
(`unit_cost_paisa`) are `Decimal64(4)`**, mirroring `NUMERIC(18,4)`. Quantities are `Decimal64(4)`.
No Float anywhere. ⚠️ This is a deliberate, documented divergence from a literal reading of "money is
always BIGINT paisa" — the repo already made this call in V12 because a per-gram cost of a
bought-by-the-kilo ingredient is not an integer number of paisa. **Flagging for the parent agent to
ratify.** Event payloads keep `long …Paisa` for every amount.

| # | Table | Grain | Key columns | Source |
|---|---|---|---|---|
| **F1** | `waste_facts` | one wastage **line** | `wastage_id, line_no, ingredient_id, category_id, reason_code, reason_category, qty, uom_code, unit_cost_paisa Decimal64(4), line_cost_paisa Int64, recorded_by, shift_id, recorded_at` | `WASTAGE_RECORDED` **+ additive `lines[]`** (W7) |
| **F2** | `inventory_movement_facts` | one `inventory_movements` row | `movement_id, movement_type LowCardinality, ingredient_id, category_id, qty Decimal64(4) (signed), unit_cost_paisa Decimal64(4), total_cost_paisa Int64, reference_type, reference_id, movement_at` | fan-in from `STOCK_DEPLETED.lines[]`, `WASTAGE_RECORDED.lines[]`, `COUNT_VARIANCE_POSTED.lines[]`, `TRANSFER_*.lines[]`, `STOCK_RECEIVED` |
| **F3** | `menu_item_pnl_facts` | (branch, business_date, menu_item_id) | `item_name, category_id, category_name, qty_sold, gross_revenue_paisa, discount_paisa, theoretical_cogs_paisa, gross_margin_paisa, margin_pct Decimal64(4)` | **rollup job** joining `sales_item_facts` × `order_cogs_facts` |
| **F3b** | `order_cogs_facts` | (order_id, line_no) | `menu_item_id, cogs_paisa Int64, recipe_id, recipe_version, is_incomplete UInt8` | `STOCK_DEPLETED` **+ additive per-line attribution** |
| **F4** | `stock_variance_facts` | (branch, ingredient, period) | `period_start, period_end, opening_count_id, closing_count_id, opening_qty, receipts_qty, transfers_net_qty, theoretical_usage_qty, recorded_waste_qty, expected_closing_qty, counted_qty, unexplained_variance_qty, unexplained_variance_cost_paisa Int64, variance_pct Decimal64(4)` | **rollup job** over F2 + F2c |
| **F2c** | `stock_count_facts` | one count **line** | `count_id, count_type, ingredient_id, system_qty, counted_qty, variance_qty, variance_cost_paisa, variance_pct, cap_pct, override_reason, counted_by` | `COUNT_VARIANCE_POSTED` + W8 |
| **F5** | `purchase_price_facts` | one GRN/invoice line | `vendor_id, ingredient_id, qty Decimal64(4), order_uom_code, unit_price_paisa Decimal64(4), line_total_paisa Int64, grn_id, po_id` | `GRN_RECEIVED` — **already carries `vendorId` and per-line `unitCostPaisa`** (`PurchasingEventContract.GrnReceivedPayload:49–56`) |
| **F6** | `stock_position_facts` | daily snapshot (branch, ingredient) | `qty_on_hand, avg_cost_paisa Decimal64(4), value_paisa Int64, reorder_point, par_level, days_of_cover Decimal64(2), earliest_expiry_date, below_reorder UInt8` | nightly snapshot job |
| **F7** | `order_void_facts` | one voided order | `order_id, voided_by, void_reason, order_total_paisa, status_before, voided_at` | `ORDER_VOIDED` **+ additive `totalPaisa`, `statusBefore`** |

**Dimensions (new, `ReplacingMergeTree ORDER BY (tenant_id, id)`, no `business_date`):**
`dim_ingredient(id, name, sku, base_uom_code, category_id, category_name, is_active)`,
`dim_menu_item(id, name, category_name)`, `dim_user(id, display_name, role_code, is_active)`,
`dim_vendor(id, name)`.

Fed by new `*_UPSERTED` events from the owning service. This is not optional: an NLQ answer that says
*"ingredient `8f3c…` cost you ₨12,400"* is useless, and because the shape rule forbids JOINs, the name
must be **denormalised into the fact** as well as available as a dimension. Precedent exists —
inventory already consumes a menu-item catalog event (`MenuItemCatalogConsumer`).

### The events that need changing (all additive, therefore safe)

`InventoryEventContract`'s javadoc records that consumers deserialize with
`FAIL_ON_UNKNOWN_PROPERTIES` disabled, so **adding** a field is backward-compatible by construction.

1. `WastageRecordedPayload` — add `List<WastageLine> lines` (ingredientId, qty, unitCostPaisa,
   lineCostPaisa). Keep the existing scalar fields untouched so finance's dedupe on `wastageId` and its
   aggregate posting are unaffected. **This is the single highest-leverage change in the whole
   document** — without it, waste analytics is per-write-off totals only.
2. `DepletedLine` — add `menuItemId` and `lineNo`. Requires `DepletionService` to stop discarding
   per-item attribution when it merges into `requiredByIngredient` (`DepletionService.java:100–122`).
   Carry a per-(menuItemId, lineNo) contribution alongside the merged ingredient total; the merged map
   stays the source of truth for the stock write, the attribution is additive metadata for COGS.
3. `OrderVoidedPayload` — add `totalPaisa`, `statusBefore`.
4. `CountVariancePostedPayload` — add `countType` (needs W8 first).
5. New: `INGREDIENT_UPSERTED`, `MENU_ITEM_UPSERTED`, `USER_UPSERTED`, `VENDOR_UPSERTED`.

**Do not** re-derive money in a consumer from qty × rate — `AutoPostingRecipeEngine` already refuses to,
and the same rule must hold in the ETL. Producers publish the extended amount.

### ETL wiring

`ReportingRabbitConfig` gains bindings to `inventory.topic` and `pos.topic`'s void key, each with its
own durable queue + DLQ (the existing `reportingDeadLetterTopology` loop already parameterises this).
`ClickHouseSchemaGuard.REQUIRED_FACT_TABLES` must be extended in the same change, or the guard silently
stops guarding the new tables.

## D.5 Rollup jobs (F3, F4, F6) and the RLS trap

F3/F4/F6 are computed, not streamed. A nightly `@Scheduled` job in reporting-service reads ClickHouse
(where it *is* allowed to JOIN — only the NLQ path is shape-restricted) and writes the pre-joined facts.

**⚠️ The tenant-discovery trap, already paid for once in this repo.** `ExpirySweepService`'s javadoc
(`services/inventory-service/.../ExpirySweepService.java`, the "D6 gap-closure" block) documents that a
`@Scheduled` job has **no ambient tenant context**, so any discovery query bound by FORCE RLS sees zero
tenants and the job "would silently no-op forever". Inventory solved it with an RLS-exempt
`inventory_tenant_registry` upserted by every write path.

reporting-service has **no such registry**. Any rollup job written naively will no-op in production and
pass every test that runs with an ambient context. Two options: (a) clone the registry pattern into
`reporting_db` (upserted by each ETL consumer, which already runs under
`TenantAwareMessageProcessor`), or (b) discover tenants from ClickHouse itself
(`SELECT DISTINCT tenant_id FROM sales_order_facts WHERE business_date >= …`) — ClickHouse has no RLS,
so this is safe and needs no new table. **(b) is simpler and I recommend it**, with the caveat that a
tenant with no sales in the window gets no rollup (correct — there is nothing to roll up).

---

# PART E — NLQ extension

## E.1 Allowlist and tenant gating

`nlq_allowed_tables` is role-keyed and platform-wide by explicit design (`V1__nlq_schema.sql:3–7`,
which also warns future migrations **not** to add RLS to it). Adding the new facts there makes them
visible to every tenant on that tier.

**Decision D-3: keep `nlq_allowed_tables` role-keyed; add a second, orthogonal table
`nlq_table_features(table_name, feature_code)`.** A table is queryable iff
`role ∈ allowlist(table)` **AND** the tenant has `feature_code` enabled. This reuses the existing
shared-lib feature service and platform-admin's `tenant_features` (single source of truth, `is_override`
respected) rather than inventing a per-tenant table grid.

Proposed mapping:

| Table | Roles | Feature |
|---|---|---|
| existing 4 | OWNER, TENANT_ADMIN, MANAGER, ACCOUNTANT | `FEATURE_NLQ` |
| `waste_facts`, `inventory_movement_facts`, `stock_position_facts`, `stock_count_facts`, `stock_variance_facts` | + INVENTORY_MANAGER | `FEATURE_INVENTORY` |
| `menu_item_pnl_facts`, `order_cogs_facts` | OWNER, TENANT_ADMIN, MANAGER, ACCOUNTANT | `FEATURE_INVENTORY` |
| `purchase_price_facts` | + ACCOUNTANT | `FEATURE_VENDOR` |
| `order_void_facts` | OWNER, TENANT_ADMIN, MANAGER | `FEATURE_POS` |
| `dim_*` | same as the facts they name | inherit |

Note `INVENTORY_MANAGER` currently has **no** `nlq.query.run` grant (changelog 046) and an empty
allowlist. Granting them waste/stock tables requires both a new `role_permissions` row and allowlist
rows — get both, or the feature is invisible and looks like the "one wrong JWT claim" class of failure
this project has hit before.

## E.2 Metric catalogue (`nlq_metrics`)

Platform-level table, same posture as `nlq_allowed_tables` (role-keyed, no RLS), plus the feature join:

```
nlq_metrics(code PK, title, category, fact_table, sql_template, param_spec JSONB,
            columns JSONB, unit, required_feature, min_role_rank, is_active)
nlq_metric_roles(metric_code, role_code)
```

`sql_template` is hand-written parameterised SQL with `?` binds — never string-interpolated — executed
through the **same** `clickHouseReadOnlyJdbcTemplate` (`nlq_readonly` user), with `tenant_id` bound from
`TenantContext` and `branch_id` bound server-side exactly as `ReportService.resolveEffectiveBranchId`
does. The safety property is inherited from a pattern already proven in this repo, not re-invented.

Routing flow inside `NlqService`, inserted between steps 2 and 3:

```
2.5  claudeClient.routeMetric(question, metricCatalogue(role, tenant))
       -> {"metric":"waste-by-reason","params":{"from":"2026-07-01","to":"2026-07-31"}}  (structured JSON)
       -> unknown metric code / missing required param / failed param validation => fall through to free-form
3    free-form NL->SQL  (unchanged)
4    7-stage validator  (unchanged, and still applied to free-form only)
5    execute            (identical executor for both paths)
```

Guardrails on the routed path: the returned `metric` must exist in the catalogue *for this role and
tenant* (never trusted from the model); every param is coerced and range-checked in Java before
binding; dates are clamped to the same `MAX_RANGE_DAYS = 400` `ReportService` uses. A routed query is
cacheable for much longer than 60 s because it is deterministic — propose 300 s for routed, keep 60 s
for free-form.

## E.3 Prompt changes

`SchemaPromptBuilder`:
- Convert `FACT_TABLE_COLUMNS` from `Map.of` to `Map.ofEntries` **before** adding tables (10-pair limit).
- Add a "prefer the pre-joined fact that already contains the metric" rule so the model does not try to
  reconstruct margin from `sales_item_facts`.
- Keep the existing hard rules verbatim — they map 1:1 to what the validator enforces, which is why the
  rejection rate is low.
- Add worked examples per new fact, in the same Q/A form.

## E.4 Validator hardening (see Part G for severities)

1. **Deny-list must cover predicates, not just projections** (S3). Walk `getWhere()`, `getGroupBy()`,
   `getHaving()`, `getOrderByElements()` with the same `ColumnCollector`.
2. **Role-scoped column deny-lists.** Replace the single global
   `restaurantos.nlq.pii-denylist` string with `nlq_denied_columns(role_code, table_name, column_name)`
   so `voided_by`/`cashier_id` can be readable by OWNER (who needs "which staff…") and denied to
   MANAGER, instead of the current all-or-nothing.
3. **Reject ClickHouse table functions explicitly**, with a test, rather than relying on the
   empty-table-set fallback.
4. Add `@RequiresFeature("FEATURE_NLQ")` to `NlqController` (S1).

---

# PART F — Proactive insights

## F.1 Storage

```
insight_rules(id, tenant_id NULL /* NULL = platform default */, rule_code, enabled,
              threshold_json JSONB, window_days INT, severity, channels TEXT[], updated_by, ...)
insights(id, tenant_id, branch_id, rule_code, subject_type, subject_id, business_date,
         severity, headline, body, metric_value_paisa BIGINT NULL, metric_value_num NUMERIC NULL,
         baseline_value_paisa BIGINT NULL, baseline_value_num NUMERIC NULL,
         state ENUM('NEW','ACKNOWLEDGED','DISMISSED','RESOLVED'), dedupe_key, snooze_until,
         created_at, acknowledged_by, acknowledged_at)
```
Both in `reporting_db`, `ENABLE` + `FORCE ROW LEVEL SECURITY` with the standard
`tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID` policy — copied verbatim
from `report_run_log` (`V1__reporting_schema.sql:82–85`), except that `insight_rules` needs a policy
tolerant of the platform-default `tenant_id IS NULL` rows (`USING (tenant_id IS NULL OR tenant_id = …)`),
with writes restricted to the tenant-owned rows.

`dedupe_key` = `rule_code | branch | subject_id | period` and a unique index on
`(tenant_id, dedupe_key)` — an insight engine that re-raises the same finding nightly gets muted by
users within a week.

## F.2 The detectors, ordered by value ÷ cost

| # | Insight | Reads | Buildable when |
|---|---|---|---|
| 1 | **"X% of your sales have no recipe"** — `DEPLETION_INCOMPLETE` fires today and **nothing consumes it**. Every uncovered item silently understates COGS and food cost. | `DEPLETION_INCOMPLETE` | **Now** — no new capture at all |
| 2 | **Till variance outlier by cashier** — z-score of `variance_paisa` per cashier vs branch mean | `till_session_facts` | **Now** (+ `dim_user`) |
| 3 | Waste spike — week's `waste_facts` cost vs trailing 8-week median, per reason code | F1 | after F1 |
| 4 | Unexplained usage variance — \|variance\| > threshold % of theoretical usage, sustained ≥2 counts | F4 | after F2+F4 |
| 5 | Item margin drop — margin_pct down > N pp vs trailing 28 days, min volume guard | F3 | after F3 |
| 6 | Reorder urgency — `days_of_cover < vendor_lead_time` (not just `qty ≤ reorder_point`) | F6 + F2 velocity | after F2+F6 |
| 7 | Supplier price increase — vendor's mean `unit_price_paisa` for an ingredient up > N% vs trailing 90 days | F5 | after F5 |
| 8 | Void-rate outlier per staff — voids/orders > 3σ of branch mean, min-volume guarded | F7 | after F7 |
| 9 | Expiry risk — value of stock expiring within lead days, vs trailing usage | F6 | after F6 |
| 10 | Count override pattern — same counter repeatedly overriding the cap on the same ingredient | F2c | after F2c |

Insights 1 and 2 are worth shipping **before** any of the fact work: they are pure consumption of data
that already lands, and #1 in particular is a data-quality alarm that makes every later COGS number
trustworthy.

## F.3 Delivery

- `GET /api/v1/reporting/insights?branchId=&state=&severity=` and
  `PATCH /api/v1/reporting/insights/{id}` (acknowledge / dismiss / snooze), permission
  `reporting.insight.view` / `reporting.insight.manage`.
- Push on the **existing** dashboard WebSocket (`DashboardWebSocketHandler`), reusing `TilePushThrottle`'s
  leading-edge + trailing-flush contract so a burst cannot flood a client.
- High-severity insights route to notification-service via an `INSIGHT_RAISED` event.
- The NLQ page shows the top 3 open insights as suggested questions — this is what turns NLQ from a
  blank box into something an owner actually uses.

## F.4 Anti-noise rules (non-negotiable)

Minimum-volume guards on every ratio (no "margin down 100%" from one sale). A confidence statement on
every variance insight ("based on 2 counts 11 days apart"). Never present an unexplained variance as
theft — present it as unexplained, ranked, with the three candidate causes. Snooze must be per-subject,
not per-rule.

---

# PART G — Safety: how isolation is achieved, and where it is weak

## G.1 The five layers that actually hold

1. **Nothing scoping comes from the client.** The request body is `{question}` only; tenant, branch,
   role, user and impersonation all come from the validated JWT (`NlqController.buildContext`), and the
   frontend schema is written to forbid growing a `sql` field.
2. **The predicate is proven, not assumed.** `PredicateInjector` re-parses its own output and walks it.
   An unprovable shape is rejected, not run best-effort.
3. **Fail-closed everywhere I checked.** Empty table set → reject. Non-OWNER with no branch → reject.
   Redis down → 503, never unmetered. Claude down → 503, never a fallback SQL path. Unknown role →
   empty allowlist → reject.
4. **Database-layer allowlist.** `deploy/clickhouse/V002__nlq_readonly_user.sql` grants SELECT
   **per table**, never `ON clickhouse_analytics.*`, on a `readonly = 1 CONST` profile with
   `max_execution_time = 5 MAX 5`, `max_result_rows = 10000 MAX 10000`,
   `result_overflow_mode = 'throw' CONST`. Verified empirically in that file's header against a live
   ClickHouse 25.9. Even total validator failure cannot read an ungranted table or relax a limit.
5. **Audit is unconditional.** Every outcome writes exactly one `nlq_query_log` row, in its own
   `REQUIRES_NEW` transaction, with the executed SQL and the impersonation stamp.

## G.2 Findings

| ID | Severity | Finding |
|---|---|---|
| **S1** | **MED** | **NLQ's feature flag is enforced only at the gateway.** `NlqController` has no `@RequiresFeature("FEATURE_NLQ")`; every inventory controller has its equivalent (`WastageController.java:29`). `application.yml:62–65` already wires `restaurantos.platform-admin.uri` *"Source of truth for @RequiresFeature checks"* — the plumbing exists and is unused. Any path to nlq-service that is not the gateway (service mesh, port-forward, a future internal route, a mis-ordered gateway filter) bills a tenant for a feature they do not have. One annotation. |
| **S2** | **MED** | **The PII deny-list only inspects projections.** `PiiDenylistStage.validate` loops `plainSelect.getSelectItems()` and nothing else. `SELECT sum(variance_paisa) FROM till_session_facts WHERE cashier_id = '<uuid>'` passes every stage and runs. That is an aggregation oracle over the exact columns the deny-list exists to protect. |
| **S3** | **MED** | **The oracle in S2 is loaded by a second read path.** `ReportCatalog.tillSessions()` (`ReportCatalog.java:149`) SELECTs `cashier_id` in the clear under `reporting.report.view`, which MANAGER holds. So the identifiers NLQ refuses to emit are handed out by the report next to it. The two paths must agree; today they contradict each other. |
| **S4** | **DESIGN/MED** | **Narration exports tenant rows to Anthropic with no tenant control.** `ClaudeClient.narrate` posts up to 20 result rows plus the question to `api.anthropic.com`. There is no per-tenant opt-out, no redaction, no residency setting. For a product carrying FBR tax data this needs an explicit decision and a tenant-visible setting, not silence. (Cross-reference the FBR e-invoicing research for any statutory constraint — **UNVERIFIED** here.) |
| **S5** | **LOW** | **`LimitInjectStage` does not clamp the *injected* default against `max-result-rows`.** Only an explicit LIMIT is clamped (`LimitInjectStage.java:41–47`). Inert with shipped config (1000 < 10000) and already documented as a latent gap in `NlqServiceIT`'s class javadoc; becomes a permanent `ROW_CAP_EXCEEDED` for every no-LIMIT question if `NLQ_DEFAULT_LIMIT` is ever raised above the cap. |
| **S6** | **LOW** | **`NlqController` couples to an undocumented "roles is singular" invariant.** It takes `claims.roles().get(0)` and derives both the allowlist and `isOwner` from it; `ReportService.isOwner()` uses `.contains("OWNER")`. The invariant currently **holds** — `PermissionResolver.buildForAssignment` mints `List.of(assignment.getRoleCode())` and `BranchRoleAdminService.assign`'s javadoc states *"the JWT's `roles` claim is singular and every downstream consumer of it assumes so"*, enforced by a partial unique index on `(user_id, branch_id) WHERE is_active`. So this is not a live bug — but the two services disagree about how to read the same claim, and if the invariant is ever relaxed NLQ mis-scopes silently while reporting does not. |
| **S7** | **LOW** | **Timeout classification is substring-based.** `ClickHouseReadOnlyExecutor.classify` maps any message containing `"timeout"` (case-insensitive) to `NlqTimeoutException` — a connect-timeout or an unrelated driver error is reported to the user as "narrow your question". |
| **S8** | **LOW** | **No retention on `nlq_query_log`.** Every question and every generated SQL string is kept forever. Questions are free text typed by users and can contain personal data. No purge job exists. |
| **S9** | **INFO** | `/internal/**` is `permitAll` in `NlqSecurityConfig` but guarded by `NlqInternalServiceFilter`'s constant-time shared-secret check, and nlq-service exposes **no** internal controller today. Safe now; a latent footgun if someone adds one. |
| **S10** | **INFO** | An audit-write failure is caught and logged, not raised (`NlqQueryLogService.log`). Correct for availability, but an RLS/GUC misconfiguration would silently produce an empty audit trail with no alarm. Recommend a counter/metric on that catch. |
| **S11** | **DESIGN** | **`nlq_allowed_tables` is platform-wide.** Adding a fact table grants it to every tenant on a qualifying tier. Addressed by D-3 (`nlq_table_features`). |
| **S12** | **INFO** | The narrative text returned to the UI is model output derived from row values (e.g. `item_name`, `notes`) that staff can type. It is rendered as an authoritative answer. Low impact, but the UI should visually distinguish "generated summary" from "data". |

## G.3 What the new facts do to the threat surface

Every fact added is a new cross-tenant leak opportunity, and the mitigations are already established:
`tenant_id`/`branch_id` as the leading `ORDER BY` columns, per-table `GRANT SELECT … TO nlq_readonly`
in a new `V003`, a row in `nlq_allowed_tables`, and the injected+proven predicates. **The one genuinely
new risk class is the identity columns** — `recorded_by`, `counted_by`, `voided_by`, `cashier_id`. Ship
these behind the role-scoped column deny-list (E.4.2), not the current global one, and never allow a
free-form query to project a raw user UUID; only `dim_user`-resolved display names, and only for roles
that hold a staff-analytics permission.

---

# PART H — Tenant configurability

| Setting | Owner | Today |
|---|---|---|
| `FEATURE_NLQ` on/off, per tenant with override | platform-admin `tenant_features` | **exists** (`TierFeatureDefaults`, `is_override`) |
| Monthly NLQ quota | `tenants.nlq_quota` → `tenant:nlq_quota:{id}` | **exists** (fixed in 13-14) |
| Hourly per-user NLQ limit | `restaurantos.nlq.user-hourly-limit` | **global config only** — not per tenant |
| Variance cap % per category | `item_categories.variance_cap_pct` | **exists and enforced** |
| PO-suggestion exclusion per category | `item_categories.exclude_from_po_suggestions` | **exists and read** |
| Reorder point / par level per ingredient | `ingredients` | **exists and read** |
| Waste reason codes | — | **new** (W1) |
| Waste approval threshold | — | **new** (W5) |
| Insight rule thresholds | — | **new** (`insight_rules`) |
| Narration on/off | — | **new** (S4) |
| Count type / cycle-count schedule | — | **new** (W8) |

Adding a feature code is not free: `FeatureCodeClosureTest` in platform-admin plus
`frontend/lib/features/feature-flags.ts` both enumerate the 20 codes and must move together. I recommend
**no new feature codes** — reuse `FEATURE_INVENTORY` / `FEATURE_VENDOR` / `FEATURE_POS` via
`nlq_table_features`, and gate insights on `FEATURE_ANALYTICS`, which already exists at GROWTH+.

Depends on: the parallel **tenant-configurability** research for the settings-surface pattern (there is
no SuperAdmin UI today — that doc records `frontend/app/(platform)/platform/dashboard/page.tsx` as a
nine-line placeholder).

---

# PART I — Frontend

Must fit the enforced 4-layer boundary (`api-client → repositories → adapters/schemas → hooks`), the
same slice the NLQ module already demonstrates:

```
lib/api-client/schemas/insights.schema.ts      zod, mirrors the DTO exactly
lib/api-client/schemas/waste.schema.ts
lib/models/insights.model.ts                   domain types, no `unknown`/`any`
lib/adapters/insights.adapter.ts               raw -> domain
lib/repositories/insights.repository.ts        .parse() before adapt (FE-08)
lib/hooks/insights/use-insights.ts             useQuery/useMutation, re-exports ApiError as a local alias
components/insights/*                          never imports @/lib/api-client
app/(tenant)/app/insights/page.tsx             <FeatureGuard feature="FEATURE_ANALYTICS"><PermissionGuard require="reporting.insight.view">
```

Copy `frontend/app/(tenant)/app/nlq/page.tsx` verbatim as the guard pattern — it already nests
`FeatureGuard` inside `PermissionGuard` with `AccessDenied` fallbacks, and
`lib/hooks/nlq/use-nlq.ts` shows the required `export type { ApiError as … }` trick that keeps
`components/**` inside the ESLint boundary.

Screens: **Insight feed** (severity-sorted, acknowledge/snooze inline); **Waste** (record + reason
breakdown + trend); **Variance report** (per ingredient, count-to-count, with the "unexplained ≠ theft"
framing in the empty/low-confidence states); **Menu P&L** (margin by item, worst-first); NLQ page gains
suggested questions sourced from open insights.

Money: paisa → rupees **only** at render. The narration model is already instructed to convert
(`NARRATIVE_SYSTEM_PROMPT`), which is a second, independent formatter — the UI must not double-convert
a narrative that already reads in rupees.

Depends on: the parallel **UI/UX direction** and **frontend component stack** research for the visual
system and chart primitives.

---

# PART J — Phasing

| Wave | Contents | Ships what |
|---|---|---|
| **0 — safety & free wins** (≈4 d) | S1 `@RequiresFeature`; S2 predicate-aware deny-list + tests; table-function rejection test; `dim_user`; insight #1 (`DEPLETION_INCOMPLETE` consumer) and #2 (till variance by cashier) | Two real insights with **zero** new capture; three closed findings |
| **1 — waste** (≈9 d) | W1 reason codes, W2 attribution, W5 threshold, W6 reversal, W7 `lines[]`; `waste_facts` + ETL; `dim_ingredient`; waste metrics + allowlist + prompt; waste UI | "What did we waste last week / why / where" |
| **2 — the stock ledger** (≈8 d) | `inventory_movement_facts` fan-in consumer; `stock_count_facts`; W8 `count_type`; `stock_position_facts` nightly snapshot; reorder + days-of-cover metrics | "What do I need to order", "how much did we use" |
| **3 — variance** (≈7 d) | `stock_variance_facts` rollup (count-to-count per ingredient); variance metrics; variance report UI; insights #4, #10 | Theoretical-vs-actual, shrinkage exposure |
| **4 — margin** (≈9 d) | `DepletedLine` per-line attribution; `order_cogs_facts`; `menu_item_pnl_facts` + `daily_pnl_facts` rollups; retire the "COGS not yet available" data-note; insight #5 | "Which items lose me money", "what's my food cost %" |
| **5 — purchasing & people** (≈5 d) | `purchase_price_facts` from `GRN_RECEIVED`; `order_void_facts`; role-scoped column deny-list; insights #7, #8 | "Which supplier raised prices", "who voids most" |
| **6 — metric layer & insight engine** (≈8 d) | `nlq_metrics` + routing; `nlq_table_features`; `insight_rules`/`insights` + API + WS + notification; insight feed UI; NLQ suggested questions | Deterministic metrics; proactive surface |
| **7 — yield & portioning** (≈6 d) | `production_batches`, `portion_audits`, yield-variance metric | Separating yield loss from over-portioning |

Total ≈ **56 person-days**; ≈48 excluding wave 7, which is genuinely optional for a first release.

---

# PART K — Open questions

1. **Money typing for rates in ClickHouse.** The brief says money is always BIGINT paisa; the repo's
   own V12 decision makes `unit_cost_paisa` a `BigDecimal` *rate* (documented in
   `InventoryEventContract.StockReceivedPayload`). I have proposed `Decimal64(4)` for rates and `Int64`
   for amounts. Needs ratification.
2. **Does narration to Anthropic need a tenant opt-out and/or a data-residency story?** Cross-check with
   the FBR research. Today it is unconditional and invisible.
3. **`ORDER_VOIDED` payload extension** — does pos-service know `totalPaisa` at void time for a DRAFT
   order with no priced lines? **UNVERIFIED**; I did not read `OrderServiceImpl.voidOrder` fully.
4. **`GRN_RECEIVED` unit conversion.** `PurchasingEventContract.GrnLine`'s javadoc says `qtyReceived`
   and `unitCostPaisa` are in the **vendor's order unit** and that only step 1 of a two-step conversion
   is applied. `purchase_price_facts` must therefore carry both the order-unit price and a converted
   base-unit price, or price-trend comparisons across changing pack sizes will be wrong. I did not
   verify how inventory resolves step 2 today.
5. **Does `sales_item_facts` need backfill?** All historical rows have NULL COGS. A margin report that
   silently starts in month N looks broken. Decide: backfill from `inventory_movements`, or render
   "—" before the cutover date (the existing `countIf(... ) = 0 → NULL` idiom in
   `ReportCatalog.salesByItem` already does the honest thing).
6. **Should the free-form NLQ path survive the metric layer?** Keeping both doubles the surface. My
   recommendation is yes, because the long tail is the point — but it should be logged separately so
   the routed/free-form ratio is measurable, and the free-form path could be tier-gated.
7. **Insight compute cost.** Nightly rollups over `inventory_movement_facts` for every tenant — I did
   not size the row volume. A busy branch is roughly (ingredients per order × orders) DEPLETION rows
   per day; needs a back-of-envelope before committing to a nightly full-scan design.
