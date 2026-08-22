# COGS-01 — The Sales Fact Pipeline, End to End

Read-only trace. Every claim below is a file:line or a command with its output. Nothing was built,
no Maven ran, no database was queried. Where a statement is about *live data* rather than *code*,
it is attributed to the artefact that measured it and labelled as such.

Repo: `/Users/muhammadumer/Documents/Projects/ResturantOS-ui38` (branch `phase-38-demo-calibrated-ui`).

---

## Contents

1. [The one-paragraph answer](#1-the-one-paragraph-answer)
2. [Every definition of `sales_item_facts`](#2-every-definition-of-sales_item_facts)
3. [The write path: order settled → row in ClickHouse](#3-the-write-path-order-settled--row-in-clickhouse)
4. [Exactly where COGS would go, and what is written there today](#4-exactly-where-cogs-would-go-and-what-is-written-there-today)
5. [What the write path can and cannot see at write time](#5-what-the-write-path-can-and-cannot-see-at-write-time)
6. [Where a real COGS number DOES exist today](#6-where-a-real-cogs-number-does-exist-today)
7. [The order of events — the central finding](#7-the-order-of-events--the-central-finding)
8. [Backfill: is historical margin recoverable?](#8-backfill-is-historical-margin-recoverable)
9. [What blocks honest COGS](#9-what-blocks-honest-cogs)
10. [Proven absences](#10-proven-absences-with-the-commands)

---

## 1. The one-paragraph answer

`sales_item_facts` is written by **reporting-service**, synchronously inside its `ORDER_CLOSED`
consumer, from the `ORDER_CLOSED` payload alone. That payload's `ItemEntry` carries
`(menuItemId, name, qty, unitPricePaisa, lineTotalPaisa)` and nothing else — no recipe, no cost.
`cogs_paisa` and `gross_margin_paisa` are **present in the INSERT column list and bound to literal
Java `null`**. Meanwhile a *real, moving-average-valued* COGS number **is** computed today — by
**inventory-service**, in a *different service*, from a *different consumer of the same event*,
published on a *different exchange* (`inventory.topic`) that reporting-service has **no binding
to**, at **ingredient grain with no reference to the sold line**, and it arrives **after** the fact
row has already been written. The fact row is not merely missing COGS: it is written at a moment
when COGS provably does not yet exist anywhere in the system, at a grain the COGS event cannot be
attributed back to.

---

## 2. Every definition of `sales_item_facts`

There is exactly one `CREATE TABLE`, duplicated byte-for-byte into the k8s bootstrap ConfigMap.

| File | Role |
|---|---|
| `deploy/clickhouse/V001__analytics_facts.sql:66-89` | The DDL of record |
| `deploy/k8s/base/files/V001__analytics_facts.sql:81-82` | Identical copy shipped into the bootstrap job |
| `deploy/clickhouse/apply.sh` | The applier (there is **no** Liquibase/Flyway for ClickHouse) |
| `services/reporting-service/.../config/ClickHouseSchemaGuard.java:25-26` | Startup fail-fast: refuses to boot if the table is absent |

**Not** a Liquibase changeset and **not** a Flyway migration. Liquibase/Flyway in this repo govern
the per-service Postgres schemas only (`services/*/src/main/resources/db/migration/*.sql`,
`db/changelog/**`). ClickHouse is provisioned by hand-ordered `V00N__*.sql` files run through
`deploy/clickhouse/apply.sh`. ClickHouse image is pinned `clickhouse/clickhouse-server:25.9`
(`deploy/docker-compose.yml:183`, `deploy/k8s/base/14-clickhouse.yaml:29`).

### The columns, verbatim

`deploy/clickhouse/V001__analytics_facts.sql:66-89`:

```sql
CREATE TABLE IF NOT EXISTS clickhouse_analytics.sales_item_facts
(
    tenant_id           UUID,
    branch_id           UUID,
    business_date       Date,
    order_id            UUID,
    line_no             UInt16,
    menu_item_id        UUID,
    item_name           String,
    qty                 Int32,
    unit_price_paisa    Int64,
    line_total_paisa    Int64,
    -- Populated by Phase 8 (Inventory & Recipe). ORDER_CLOSED's ItemEntry carries no
    -- cogs/margin/category today, so the ETL writes NULL. Margin reports must render these as
    -- "—", never as 0.
    cogs_paisa          Nullable(Int64),
    gross_margin_paisa  Nullable(Int64),
    category_name       Nullable(String),
    closed_at           DateTime64(3, 'UTC'),
    event_id            UUID
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(business_date)
ORDER BY (tenant_id, branch_id, business_date, order_id, line_no);
```

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `tenant_id` | `UUID` | no | From the **envelope**, never the payload |
| `branch_id` | `UUID` | no | From the envelope |
| `business_date` | `Date` | no | **In the sort key** → not mutable |
| `order_id` | `UUID` | no | **In the sort key** |
| `line_no` | `UInt16` | no | **In the sort key.** A *positional index*, 0-based, assigned by the ETL loop — see §3. Not `order_items.id`. |
| `menu_item_id` | `UUID` | no | |
| `item_name` | `String` | no | Snapshot at close |
| `qty` | `Int32` | no | |
| `unit_price_paisa` | `Int64` | no | |
| `line_total_paisa` | `Int64` | no | |
| **`cogs_paisa`** | **`Nullable(Int64)`** | **YES** | Not in the sort key → **mutable** |
| **`gross_margin_paisa`** | **`Nullable(Int64)`** | **YES** | Not in the sort key → **mutable** |
| `category_name` | `Nullable(String)` | YES | Also always NULL today |
| `closed_at` | `DateTime64(3, 'UTC')` | no | |
| `event_id` | `UUID` | no | Source `EventEnvelope.eventId`; the dedup / trace handle |

### Later DDL touching this table

- `deploy/clickhouse/V003__business_date_realignment.sql:167-181` — an `INSERT … SELECT` + `DELETE`
  that moved 73 orders / 104 item rows from `2026-08-07` to `2026-08-06`. It copies `cogs_paisa` and
  `gross_margin_paisa` verbatim (lines 178-179). Its header explains why an `UPDATE` was impossible:
  `business_date` is in the sorting key and *"ClickHouse refuses to mutate a sorting-key column"*
  (`V003:57-62`). **This constraint does not apply to `cogs_paisa`.**
- `deploy/clickhouse/V004__discount_facts.sql`, `V005__discount_source.sql` — create/alter
  `sales_discount_facts`, a different table. `V005` establishes the in-place
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS … DEFAULT …` pattern (`V005:22-24`).

There is **no** `V005__cogs_facts.sql`, no `cogs_facts`, no `order_cogs_facts`, no
`menu_item_pnl_facts` anywhere in `deploy/` or `services/` — see §10.

---

## 3. The write path: order settled → row in ClickHouse

### Step 1 — pos-service closes the order and publishes ORDER_CLOSED

`services/pos-service/.../service/OrderServiceImpl.java:1516-1592`, method `performClose`.

- `closedAt = Instant.now()` (`:1528`); `businessDate = branchBusinessDay.dateOf(closedAt, branchId)`
  (`:1529`) — resolved **once**, checked against the accounting period, and stamped on the event.
- Item entries are built at `:1541-1549` from `order.getItems()`:

```java
List<PosEventContract.ItemEntry> itemEntries = order.getItems().stream()
        .map(item -> new PosEventContract.ItemEntry(
                item.getMenuItemId(),
                item.getItemNameSnapshot(),
                item.getQuantity(),
                item.getUnitPriceSnapshot(),
                item.getLineTotalPaisa()))
        .collect(Collectors.toList());
```

- The wire contract, `shared-lib/.../event/payload/PosEventContract.java:136-142`:

```java
public record ItemEntry(
        UUID menuItemId,
        String name,
        int qty,
        long unitPricePaisa,
        long lineTotalPaisa
) {}
```

  **Five fields. No cost, no recipe, no category, no `orderItemId`.**

- Publish at `:1592`: `eventPublisher.publish(POS_EXCHANGE, "pos.order.closed", "ORDER_CLOSED", branchId, payload)`
  (constants at `OrderServiceImpl.java:52-53`).

### Step 2 — the transactional outbox

`publish` writes a row to `event_outbox` in the same Postgres transaction
(`services/pos-service/src/main/resources/db/migration/V2__pos_infra_tables.sql:4-18`; `event_id`,
`exchange`, `routing_key`, `event_type`, `envelope_json`, `status DEFAULT 'PENDING'`).
`shared-lib/.../event/OutboxRelay.java:86-88` relays it:

```java
@Scheduled(fixedDelay = 1000)
public void relay() {
```

At-least-once, per-row confirm channel, `SENT` only on broker ack (`OutboxRelay` javadoc `:17-51`).
**So the event reaches the broker up to ~1s after the DB commit.**

### Step 3 — reporting-service consumes and writes the facts

`services/reporting-service/.../consumer/OrderClosedConsumer.java`

- Bound to `reporting.order-closed.queue` ← `pos.topic` / `pos.order.closed`
  (`config/ReportingRabbitConfig.java:44-57`).
- `:70-82` — dead-letters any payload missing `businessDate` rather than re-deriving it.
- `:85-87` — the write, inside `processedEventService.tryProcess(...)`:

```java
processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
        tenantAwareMessageProcessor.process(envelope, env -> {
            salesFactWriter.write(env, businessDate);
```

`services/reporting-service/.../etl/SalesFactWriter.java`

- `:32-37` — the INSERT statement (see §4).
- `:81-111` — the per-line loop. `line_no` is the **loop counter**, not a domain id:

```java
for (int lineNo = 0; lineNo < items.size(); lineNo++) {
    ItemEntry item = items.get(lineNo);
```

- `:112` — `clickHouseJdbcTemplate.batchUpdate(INSERT_ITEM_SQL, batchArgs)`.

### Trigger summary

| Question | Answer | Evidence |
|---|---|---|
| Event, outbox, batch, or CDC? | **Event, via transactional outbox → RabbitMQ → live consumer.** No batch job, no CDC. | `OrderServiceImpl.java:1592` → `OutboxRelay.java:86` → `OrderClosedConsumer.java:57` |
| Which service | `reporting-service` | — |
| Which class/method | `SalesFactWriter.write(EventEnvelope<OrderClosedPayload>, LocalDate)` | `SalesFactWriter.java:56` |
| Idempotency | Postgres `processed_events` (consumer + eventId), **plus** `ReplacingMergeTree` as a crash safety net | `ProcessedEventService.java:25-37`; `V001:3-9` |
| Re-ingest possible? | **No.** `tryProcess` returns early on a seen `eventId`; a replayed `ORDER_CLOSED` writes nothing. | `ProcessedEventService.java:27-29` |

---

## 4. Exactly where COGS would go, and what is written there today

The columns are **not omitted from the INSERT**. They are named, and bound to literal `null`.

`services/reporting-service/.../etl/SalesFactWriter.java:32-37`:

```java
private static final String INSERT_ITEM_SQL = """
        INSERT INTO clickhouse_analytics.sales_item_facts
            (tenant_id, branch_id, business_date, order_id, line_no, menu_item_id, item_name,
             qty, unit_price_paisa, line_total_paisa, cogs_paisa, gross_margin_paisa,
             category_name, closed_at, event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """;
```

`SalesFactWriter.java:100-107` — the bind values, comment included verbatim:

```java
// cogs_paisa / gross_margin_paisa / category_name are Phase-8-deferred: Phase 8
// (Inventory & Recipe) has not started and OrderClosedPayload.ItemEntry carries
// no COGS/margin/category data today. NULL means "unknown" (12-05's reports
// render it as "—"); 0 would falsely claim "sold at cost", which is a lie an
// owner could act on. Never write 0 here.
null, // cogs_paisa
null, // gross_margin_paisa
null, // category_name
```

> Note the comment is now **factually stale**: "Phase 8 … has not started" is no longer true.
> `services/inventory-service/.../service/DepletionService.java` exists, computes COGS, and
> publishes `STOCK_DEPLETED` (§6). The *conclusion* (write NULL) is still correct, because the
> writer has no access to that number — but the *reason given* is not the real one, and anyone
> reading only this comment will look for the blocker in the wrong place.

### The honest-NULL guards downstream (all three, verified)

1. **SQL** — `services/reporting-service/.../report/ReportCatalog.java:88-89`:

```sql
if(countIf(cogs_paisa IS NOT NULL) = 0, NULL, sum(cogs_paisa)) AS cogs_paisa,
if(countIf(gross_margin_paisa IS NOT NULL) = 0, NULL, sum(gross_margin_paisa)) AS gross_margin_paisa
```

   Rationale at `ReportCatalog.java:75-83`: plain `sum()` over an all-NULL `Nullable` column is not
   trusted to return NULL across ClickHouse versions.

2. **Table render** — `frontend/components/reporting/ReportTable.tsx:8` (`NULLABLE_MONEY_COLUMNS`)
   and `:23-33`: `null`/`undefined` → `—` with an aria-label, *never* `0`.

3. **Dashboard tile** — `frontend/components/dashboard/owner-dashboard.tsx:98`
   (`marginUnavailable = itemRows.every(r => r.gross_margin_paisa == null)`) and `:169-183`, which
   hardcodes `value="—"` with `unavailableReason="Cost of goods is not yet posted per item, so
   margin cannot be computed. Showing nothing rather than a wrong number."`

4. **Zod** — `frontend/lib/api-client/schemas/reporting.schema.ts:30-31`:
   `cogs_paisa: z.number().nullable().optional()`. Test at
   `frontend/__tests__/reporting/reporting-journey.test.ts:25-28` asserts `not.toBe(0)`.

5. **E2E assertion (a live measurement, by the script, not by me)** —
   `scripts/e2e/phase12-reporting-e2e.sh:168-179` queries
   `SELECT count() FROM clickhouse_analytics.sales_item_facts WHERE cogs_paisa IS NOT NULL`
   and **fails the build if it is not `0`**. Today, a populated `cogs_paisa` would break CI.

> **Consequence for any COGS work:** `scripts/e2e/phase12-reporting-e2e.sh:179` is an inverted
> assertion that must be rewritten in the same change that starts populating the column, or the
> first honest COGS row turns the pipeline red.

---

## 5. What the write path can and cannot see at write time

At the moment `SalesFactWriter.write` runs, inside reporting-service:

| COGS input | Available? | Proof |
|---|---|---|
| **Quantity sold** | **Yes** | `ItemEntry.qty` — `PosEventContract.java:139` |
| **Menu item identity** | **Yes** | `ItemEntry.menuItemId` — `PosEventContract.java:137` |
| **Sale timestamp / business date** | **Yes** | `payload.closedAt()`, `payload.businessDate()` |
| **The recipe for the sold item** | **No** | Recipes live in `inventory_db` (`services/inventory-service/src/main/resources/db/migration/V1__inventory_schema.sql:107-129`). reporting-service has no repository, no Feign client and no queue for them. |
| **Ingredient cost as at the sale date** | **No** | `ingredient_branch_stock.avg_cost_paisa` lives in `inventory_db` and is **mutable** — it is overwritten by every receipt. There is no as-at query anywhere. |
| **Any cost figure at all** | **No** | The only three consumers reporting-service declares are ORDER_CLOSED, TILL_CLOSED, VENDOR_INVOICE_MATCHED — `ReportingRabbitConfig.java:26-28`. |

`ReportingRabbitConfig.java:15-17` states the boundary explicitly:

> *"Deliberately declares NO binding to the inventory exchange and NO queue for any not-yet-built
> inventory/wastage/transfer event from a later phase — those do not exist as running code yet"*

That second clause is now **false**: `inventory.topic` publishes `STOCK_DEPLETED` today (§6). The
binding is still absent; only the stated reason has expired.

---

## 6. Where a real COGS number DOES exist today

`services/inventory-service/.../service/DepletionService.java`, `deplete(UUID branchId, OrderClosedPayload payload)`.

Triggered by `services/inventory-service/.../consumer/OrderClosedConsumer.java:46-59` — a **second,
independent** subscriber to the *same* `pos.order.closed` routing key
(`InventoryRabbitConfig.java:22,56-58`).

What it does, in order:

| Step | Line | What |
|---|---|---|
| Resolve recipe **effective at the sale instant** | `:103` | `recipeService.resolveEffectiveRecipe(item.menuItemId(), payload.closedAt())` → `RecipeService.java:109-112`, backed by `recipes.effective_from` (`V1__inventory_schema.sql:113`, index `:129`) |
| Convert recipe line → ingredient stock unit | `:126-140` | `UomConverter.effectiveBaseQty(line, item.qty(), recipe.getYieldServings(), factor)` |
| Accumulate **per ingredient**, across all lines | `:140` | `requiredByIngredient.merge(line.getIngredientId(), effectiveQty, BigDecimal::add)` ← **the sold-line identity is discarded here** |
| Lock, FEFO walk, decrement | `:150-178` | |
| **Value COGS at aggregate MAC** | `:181` | `long cogsPaisa = computeCogsPaisa(required, savedStock.getAvgCostPaisa());` |
| Freeze the cost into a durable movement row | `:184-193` | `movement_type='DEPLETION'`, `unit_cost_paisa`, `total_cost_paisa`, `reference_type='ORDER_CLOSED'`, `reference_id=payload.orderId()` |
| Publish `STOCK_DEPLETED` | `:218-223` | via the same transactional outbox |

The event's shape, `shared-lib/.../event/payload/InventoryEventContract.java:69,80-86`:

```java
public record StockDepletedPayload(UUID orderId, List<DepletedLine> lines, long totalCogsPaisa) {}

public record DepletedLine(UUID ingredientId, BigDecimal qtyBaseDepleted, long cogsPaisa,
                           String cogsAccountCode, String inventoryAccountCode) { … }
```

**Grain: `(orderId, ingredientId)`.** There is no `menuItemId`, no `lineNo`, no `orderItemId`, and no
`businessDate` on this payload.

Who consumes it: **finance-service only.**
`services/finance-service/.../autopost/consumer/StockDepletedConsumer.java:41-48` →
`AutoPostingRecipeEngine.postOrderCogs` (`:204-255`), which posts DR COGS / CR Inventory keyed
`source_type='ORDER_COGS'`, `source_id=orderId` (`AutoPostingRecipeEngine.java:53,254`) into
`journal_entries` (`services/finance-service/src/main/resources/db/migration/V1__finance_schema.sql:68-89`).
It also **fails loudly** if the line costs do not sum to `totalCogsPaisa` (`:245-250`).

> **An order-grain COGS figure that ties to the general ledger already exists.** It is
> `journal_entries` where `source_type='ORDER_COGS'` and `source_id = <orderId>`, plus its
> `journal_lines`. Nothing in reporting or the dashboard reads it.

### A defect found in passing, on the money path

`AutoPostingRecipeEngine.java:254` posts the COGS entry through the **five-argument** `post(...)`:

```java
post(SOURCE_ORDER_COGS, p.orderId(), envelope, "Order COGS " + p.orderId(), lines);
```

which delegates with `businessDate = null` (`:576-579`), and `:594-598` then dates the entry from
`envelope.occurredAt()` in **UTC**:

```java
LocalDate entryDate = businessDate != null
        ? businessDate
        : envelope.occurredAt() != null
                ? envelope.occurredAt().atZone(ZoneOffset.UTC).toLocalDate()
                : LocalDate.now();
```

The revenue entry, by contrast, passes `p.businessDate()` (`:162-164`). `StockDepletedPayload`
carries no business date to pass, so **the COGS journal entry for an order can be dated to a
different trading day than the revenue it offsets** — the envelope's publish time in UTC versus the
branch's `(closedAt − 4h)` trading day. This is the exact defect class `V003__business_date_realignment.sql`
was written to repair for the analytics side (`V003:16-22`), reproduced on the ledger side.
**Any margin computed by day is wrong at the day boundary until this is closed.** Not verified
against live data here — it is a code-level reading of the two call sites.

---

## 7. The order of events — the central finding

```
                       pos-service                    ┌──────────── reporting-service ────────────┐
  performClose ──▶ event_outbox (PENDING) ──▶ relay ──▶ pos.topic ──▶ reporting.order-closed.queue
  OrderServiceImpl:1592   V2__pos_infra:4    ≤1s tick  fanout        │
                                                                     ▼
                                                       SalesFactWriter.write  ◀── T0
                                                       INSERT sales_item_facts
                                                       cogs_paisa = null      SalesFactWriter:105
                                                                     
                                             ┌──────── inventory-service ────────┐
                                  same ──────▶ inventory.order-closed.queue
                                  fanout       DepletionService.deplete
                                               resolve recipe @ closedAt   :103
                                               COGS = qty × MAC            :181   ◀── T1  (COGS first exists)
                                               event_outbox (PENDING)      :218
                                                        │ relay ≤1s tick
                                                        ▼
                                               inventory.topic / STOCK_DEPLETED  ◀── T2
                                                        │
                                            ┌───────────┴──────────┐
                                            ▼                      ▼
                                  finance.stock-depleted     (no reporting queue —
                                  → ORDER_COGS journal        ReportingRabbitConfig:15-17)
```

Three facts about this ordering, each independently blocking:

1. **T0 < T1.** The fact row is inserted from a payload that structurally cannot contain COGS, in a
   service that has no access to recipes or costs, while the only process that can compute COGS is
   running concurrently in a different service. The write is not "missing a column it could have
   filled" — at T0 the number does not exist anywhere in the system.

2. **The two consumers race.** `reporting.order-closed.queue` and `inventory.order-closed.queue` are
   independent fanout subscribers of the same routing key. There is no ordering guarantee, no
   correlation wait, and no retry-until-COGS-arrives anywhere. Even if reporting *could* read the
   depletion, nothing makes it wait for it.

3. **Attribution is destroyed before the event is published.**
   `DepletionService.java:140` merges every recipe line of every sold item into a single
   `Map<ingredientId, BigDecimal>`. From that point the sold line that consumed the ingredient is
   gone. `StockDepletedPayload` (`InventoryEventContract.java:69`) therefore cannot be joined back
   to `sales_item_facts (order_id, line_no)`. The `line_no` on the fact side is itself only a loop
   counter (`SalesFactWriter.java:85`) with no counterpart in `pos_db`, so even an
   `order_item_id` on the depletion side would not join without a second change.

   Plan `37-07-PLAN.md` (never executed — §10) identified precisely this and named the prohibition:
   *"Cost MUST NOT be allocated across lines in proportion to revenue, menu price, or any other
   proxy for consumption. That is an invented number wearing a total's clothing."* (`37-07-PLAN.md:29`)

---

## 8. Backfill: is historical margin recoverable?

### Is the table append-only?

It is `ENGINE = ReplacingMergeTree` (`V001:87`) — **not** append-only in the strict sense, but with
two sharp edges.

**Edge 1 — `ALTER … UPDATE` is legal for `cogs_paisa`, and there is precedent in this repo.**
The sorting key is `(tenant_id, branch_id, business_date, order_id, line_no)` (`V001:89`).
`cogs_paisa` and `gross_margin_paisa` are **not** in it, so ClickHouse's sorting-key mutation
prohibition — the one that forced `V003` into `INSERT`+`DELETE` (`V003:57-62`) — **does not apply**.
An in-place mutation is exactly what `scripts/ops/phase37-repair-analytics-utc-drift.py:146-152`
already does to a money-adjacent column on these very tables:

```python
ch_sql(
    f"ALTER TABLE {CH_DB}.{table} "
    f"UPDATE {column} = fromUnixTimestamp64Milli(toInt64({true_millis}), 'UTC') "
    f"WHERE event_id = toUUID('{event_id}') SETTINGS mutations_sync = 2"
)
```

and — the part worth copying — then **re-reads to confirm** rather than trusting the mutation
(`:153-161`). `SETTINGS mutations_sync = 2` is the right idiom; mutations are asynchronous
(`scripts/e2e/phase32-business-date-reconciliation.sh:131-137` polls `system.mutations`).

**Edge 2 — do NOT backfill by re-INSERTing whole rows.** `ENGINE = ReplacingMergeTree` is declared
**with no version column** (`V001:87` — bare, no argument). Without a version argument
ReplacingMergeTree's choice among duplicates is "the last row in the selection", which is an
insertion-order artefact and not a guarantee you can hold a money figure to. A re-INSERT strategy
therefore risks a merge collapsing the corrected COGS row back to the original NULL row. Any
row-replacement approach must either add a version column first or follow `V003`'s
`INSERT`-then-`DELETE`-by-full-sort-key discipline (`V003:57-62`), and must `OPTIMIZE … FINAL`
(the seeder does: `scripts/e2e/phase12-seed-mock-data.sh:203-205`).

### Can the history be re-ingested instead?

**No.** Two independent blocks:

- `ProcessedEventService.tryProcess` (`services/reporting-service/.../service/ProcessedEventService.java:25-29`)
  returns early for a `(consumer, eventId)` already in `processed_events`. Replaying `ORDER_CLOSED`
  writes nothing. finance's guard is the same shape (`alreadyPosted(SOURCE_ORDER_COGS, orderId)`,
  `AutoPostingRecipeEngine.java:206`).
- Re-deriving cost *today* would use **today's** `avg_cost_paisa`, not the sale-date MAC.
  `DepletionService.java:181` reads `savedStock.getAvgCostPaisa()` — a live, mutable column
  overwritten by every receipt. A "recompute from current stock" backfill produces a number that
  looks computed and is historically false. That is the failure mode this brief forbids.

### So is historical margin recoverable? — Conditionally yes, at ORDER grain

The as-at cost **was** frozen at depletion time, twice:

| Source | Grain | Frozen? | Where |
|---|---|---|---|
| `inventory_movements` where `movement_type='DEPLETION'` and `reference_type='ORDER_CLOSED'`, `reference_id = orderId` | `(order, ingredient)` | **Yes** — `unit_cost_paisa` and `total_cost_paisa` are written at depletion (`DepletionService.java:190-191`) and never updated | `services/inventory-service/src/main/resources/db/migration/V1__inventory_schema.sql:153-172` |
| `journal_entries` where `source_type='ORDER_COGS'`, `source_id = orderId` + its `journal_lines` | `order` | **Yes** — a posted ledger entry | `services/finance-service/src/main/resources/db/migration/V1__finance_schema.sql:68-89` |

Both are RLS-protected (`FORCE ROW LEVEL SECURITY`, `V1__inventory_schema.sql:174-177`), so any
backfill script must set the tenant GUC on the same connection — the precedent and the reasoning are
in `V003:29-32`.

**Recoverable:** *order-grain* historical COGS and margin, for every order that produced a
`DEPLETION` movement.
**Not recoverable:** *line-grain* (`menu_item_id`) historical COGS. The recipe→line attribution was
never persisted anywhere. It could in principle be *re-derived* by re-running the recipe explosion
against `recipes.effective_from <= closedAt` and pairing it with the frozen per-ingredient
`unit_cost_paisa` from `inventory_movements` — but only where the recipe version that was actually
used still exists and is still resolvable. That re-derivation must be reconciled to the frozen
`total_cost_paisa` per order and **fail** on mismatch, in the shape
`AutoPostingRecipeEngine.java:245-250` already uses, rather than being written on trust.

**Orders with no `DEPLETION` movement have no recoverable cost and must stay NULL.** `V003`'s own
rule for this situation is the standard to copy — *"A fact whose ledger counterpart cannot be found
is a second, different defect, and guessing its date to make a total look tidy is precisely what
D-37-05 forbids."* (`V003:44-47`)

---

## 9. What blocks honest COGS

Ranked. Each is a hard block, not a preference.

**B1 — The fact row is written before COGS exists, by a service that cannot compute it.**
`SalesFactWriter.write` runs at T0 from `ORDER_CLOSED`; `DepletionService` computes COGS at T1 in a
different service; `STOCK_DEPLETED` is relayed at T2 ≥ T1 + up to 1s. There is no wait, no
correlation, no ordering guarantee between the two fanout subscribers. Any design that hopes to fill
`cogs_paisa` on the initial INSERT is impossible as the system is wired. COGS must arrive as a
**second write** — a mutation, or its own fact table joined at read time.

**B2 — reporting-service is not subscribed to the event that carries COGS.**
`ReportingRabbitConfig.java:26-28,30-31` declares exactly two exchanges (`pos.topic`,
`purchasing.topic`) and three queues. `grep -rn "inventory" services/reporting-service/src/main/java/`
returns **two comment lines and zero code** (§10). No queue, no binding, no consumer, no payload
mirror.

**B3 — The COGS event's grain cannot be joined to the fact table's grain.**
`StockDepletedPayload` is `(orderId, List<DepletedLine{ingredientId,…}>)`
(`InventoryEventContract.java:69,80`). `sales_item_facts` is keyed `(order_id, line_no)` where
`line_no` is a loop counter (`SalesFactWriter.java:85`). The sold-line identity is discarded at
`DepletionService.java:140`. **Line-grain margin is not obtainable without changing the producer.**
Order-grain margin *is* obtainable today. Allocating an order's COGS across lines by price is
explicitly forbidden (`37-07-PLAN.md:29`) and would be exactly the "figure that looks computed"
failure this brief names.

**B4 — Coverage is silently partial, and the incompleteness signal has no consumer.**
`DepletionService.java:100-110` skips any sold line with no effective recipe; `:120-135` skips any
line whose UOM cannot be converted. Both merely append to `missingMenuItemIds`. `STOCK_DEPLETED`
still fires for the *remaining* lines, with a `totalCogsPaisa` that is **lower than the true cost of
the order and indistinguishable from a complete one** — the payload has no completeness flag.
`DEPLETION_INCOMPLETE` is published (`:229-235`) and **nothing anywhere subscribes to it**: zero
consumers outside inventory-service (§10). So today the system can produce a COGS number that is
confidently too low, and the only signal that it is too low is thrown into an exchange with no
bound queue. **This is the single most dangerous item on the list for a money-path feature**: it is
not a NULL problem, it is a plausible-but-understated-cost problem, and understated cost means
*overstated margin*.
`37-07-PLAN.md:24` states the required behaviour: *"An order whose depletion was incomplete is
recorded as having an incomplete cost, not a lower one."*

**B5 — The COGS ledger entry is dated from the wrong clock.**
`AutoPostingRecipeEngine.java:254` → `:576-579` → `:594-598`: the `ORDER_COGS` entry falls back to
`envelope.occurredAt()` in UTC because `StockDepletedPayload` carries no business date, while the
matching `ORDER_REVENUE` entry uses `businessDate` verbatim (`:162-164`). Revenue and its cost can
land on different trading days. Any daily margin is wrong at the boundary until closed. (Code-level
finding; not measured against live data here.)

**B6 — The current CI gate asserts COGS is NULL.**
`scripts/e2e/phase12-reporting-e2e.sh:168-179` fails if `count(cogs_paisa IS NOT NULL) != 0`. It must
be inverted in the same change that starts populating the column.

**B7 — Backfill hazards.** `ReplacingMergeTree` with no version column (`V001:87`) makes
row-replacement backfill unsafe; `processed_events` makes event replay a no-op
(`ProcessedEventService.java:27-29`); and recomputing from today's `avg_cost_paisa`
(`DepletionService.java:181`) fabricates history. The safe route is `ALTER … UPDATE` on the
non-key columns with `mutations_sync = 2` plus a **read-back verification**, sourced from the
frozen `inventory_movements.total_cost_paisa` — the pattern
`scripts/ops/phase37-repair-analytics-utc-drift.py:146-161` already proves in this repo.

### The one thing that is *not* blocked

The recipe **is** correctly effective-dated (`recipes.effective_from`, `V1__inventory_schema.sql:113`;
`RecipeService.resolveEffectiveRecipe(menuItemId, closedAt)`, `:109-112`), and the cost **is**
correctly valued at the aggregate moving average rather than a lot's receipt price
(`DepletionService.java:181`, `InventoryEventContract.java:58-63`). The hard part of COGS — a
point-in-time-correct recipe and a ledger-tying valuation — is already built and already posts to
the general ledger. What is missing is a **path from that number to the fact table**, and a
**declaration of when it is incomplete**.

---

## 10. Proven absences, with the commands

Run from `/Users/muhammadumer/Documents/Projects/ResturantOS-ui38`.

```
$ find services/reporting-service -name "CogsFactWriter.java" -o -name "StockDepletedConsumer.java" \
      -o -name "ReportingInventoryPayloads.java" | wc -l
0
```
→ Plan `37-07-PLAN.md` (`files_modified:` lines 8-17) listed all three. **None was ever created.**

```
$ ls deploy/clickhouse/ | grep -c cogs
0
$ grep -rn "cogs_facts" deploy services --include="*.sql" --include="*.java" | wc -l
0
```
→ `37-07-PLAN.md:12` names `deploy/clickhouse/V005__cogs_facts.sql`. The real `V005` is
`V005__discount_source.sql`. There is **no COGS fact table anywhere.**

```
$ grep -rn "menu_item_pnl_facts\|order_cogs_facts" deploy services --include="*.sql" --include="*.java"
   (no output)
```
→ Both appear only in `.planning/research/adaptivity/nlq-insights.md:465-466` as proposals.

```
$ grep -rn "inventory" services/reporting-service/src/main/java/
services/reporting-service/.../config/ReportingRabbitConfig.java:15: * Deliberately declares NO binding to the inventory exchange and NO queue for any not-yet-built
services/reporting-service/.../config/ReportingRabbitConfig.java:16: * inventory/wastage/transfer event from a later phase — those do not exist as running code yet
```
→ Two comment lines. **Zero code.** reporting-service has no inventory integration of any kind.

```
$ grep -rn "depletion.incomplete\|DEPLETION_INCOMPLETE_KEY" services --include="*.java" \
      | grep -v inventory-service | wc -l
0
```
→ `DEPLETION_INCOMPLETE` has **no consumer in any service.** It is published into an exchange with
no bound queue. (B4.)

```
$ grep -rn "cogs\|COGS" services/reporting-service/src/main/java/ -il
services/reporting-service/.../config/ClickHouseSchemaGuard.java   (table-name list only)
services/reporting-service/.../consumer/OrderClosedConsumer.java   (comment)
services/reporting-service/.../etl/SalesFactWriter.java            (the two null binds)
services/reporting-service/.../report/ReportCatalog.java           (the honest-NULL guard)
```

### Live-data claims — attributed, not measured by me

I ran no query against Postgres or ClickHouse. Two artefacts in the repo assert live state:

- `scripts/e2e/phase12-reporting-e2e.sh:175-179` — asserts `cogs_paisa IS NOT NULL` count is `0`,
  and fails the run otherwise.
- `.planning/phases/37-finance-orders-integration/37-STATUS.md:17` —
  *"`sales_item_facts`: 12 rows, **0** with `cogs_paisa`. Writer still writes NULL by design until
  37-06/37-07 land"*, and `37-CONTEXT.md:47` — *"0 of 115 fact rows carry `cogs_paisa`"*.

Both are consistent with the code, and the code is dispositive on its own:
`SalesFactWriter.java:105-106` binds literal `null` on every insert, unconditionally, with no branch.
There is no code path in this repository that can write a non-NULL `cogs_paisa`.
