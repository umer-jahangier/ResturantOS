# COGS-PLAN — Computing cost of goods, gross margin and food-cost % honestly

**Repo:** `/Users/muhammadumer/Documents/Projects/ResturantOS-ui38` — branch `phase-38-demo-calibrated-ui`
**Inputs:** `COGS-01-FACT-PIPELINE.md`, `COGS-02-COST-MODEL.md`, `COGS-03-REPORTING.md`, `38-DECISIONS-DEMO.md` (D-38-16)
**Method:** read-only. No source modified, no Maven, no build, no `git stash`, no query against a live database.
Every claim below is a `file:line` I opened myself or a command whose output is quoted. Where I am
repeating a claim from one of the three input documents, I re-verified it before using it; where I
found the input documents *incomplete* or *wrong*, I say so by name.

---

## 0. Executive summary — can this be done honestly, and what does it cost?

**Yes — for three of the four numbers the demo asks for, at grains that are not the grain the demo
draws them at. No — for per-menu-item margin, until a cross-service contract changes.**

The finding that reframes the whole exercise is this: **the hard part of COGS is already built,
already correct, and already posting to the general ledger.** `DepletionService` resolves the recipe
that was effective at the sale instant (`DepletionService.java:103` → `RecipeService.java:109-112`),
values consumption at the moving-average cost as it stood at that instant, and freezes that cost
into an append-only ledger row — `movement_type='DEPLETION'`, `unit_cost_paisa`, `total_cost_paisa`,
`reference_type='ORDER_CLOSED'`, `reference_id=orderId` (`DepletionService.java:184-194`).
`finance-service` consumes it and posts DR COGS / CR Inventory with a reconciliation guard that
throws rather than post a plausible number (`AutoPostingRecipeEngine.java:245-250`).

Reporting simply never hears about it. `ReportingRabbitConfig.java:12-22` declares two exchanges
(`pos.topic`, `purchasing.topic`) and no binding to `inventory.topic`; the reporting-service consumer
package contains exactly three files, none of which is a `StockDepletedConsumer`:

```
$ ls services/reporting-service/src/main/java/io/restaurantos/reporting/consumer/
OrderClosedConsumer.java  TillClosedConsumer.java  VendorInvoiceMatchedConsumer.java
```

So this is not a "build a costing engine" project. It is a **pipeline project with three honesty
constraints**, and the honesty constraints are most of the work.

### The four numbers, answered

| Number | Grain it can honestly carry | Verdict | Blocked by |
|---|---|---|---|
| COGS (MTD), Gross margin (MTD) | branch × period, via order | **Achievable** | pipeline only (W05–W08) |
| Food cost % | branch × period | **Achievable with caveats** | denominator ambiguity (W10), coverage (W09) |
| Actual-vs-theoretical variance | branch × period | **Achievable with caveats** | needs a posted stock count; unmeasurable without one |
| Menu Margin Ranking (per menu item) | order line | **Blocked** | attribution destroyed at `DepletionService.java:141`; needs W15–W19 |

### What it costs

**21 work items across six layers.** Six of them (W01–W06) are prerequisites that produce no visible
number; the first tile lights up at W12. The order-grain numbers — the P&L card — land at roughly
W01→W12. The Menu Margin Ranking, the single most beautiful panel in the demo and the one D-38-16
named as *"a ranking built entirely on a column that is NULL for every row"*, needs the whole
sequence plus W15–W19, and touches `shared-lib`, `pos-service`, `inventory-service`,
`finance-service` and `reporting-service` in one change.

**Two defects on the money path are found here and fixed as part of this work, not after it:**

- **The COGS journal entry is dated from the wrong clock.** `AutoPostingRecipeEngine.java:254` posts
  through the five-argument `post(...)`, which delegates with `businessDate = null`
  (`:576-579`), and `:594-598` then dates the entry from `envelope.occurredAt()` in **UTC**. The
  matching revenue entry passes `p.businessDate()` verbatim (`:162-164`). `StockDepletedPayload` has
  no business date to pass (`InventoryEventContract.java:67`). **Revenue and the cost that offsets it
  can land on different trading days.** Any daily margin is wrong at the day boundary until this is
  closed. (W03.)
- **`sales_item_facts.line_total_paisa` is tax-inclusive, and nobody has noticed.** I traced it:
  `OrderPricingCalculator.computeItemLine` returns `lineTotal(net, tax)` (`:247`), and
  `OrderServiceImpl.java:2155` sets `item.setLineTotalPaisa(net + lineTax)`. That value flows
  verbatim into `ItemEntry.lineTotalPaisa` (`OrderServiceImpl.java:1541-1549`) and into the fact
  table. `ReportCatalog.salesByItem()` aliases `sum(line_total_paisa) AS gross_revenue_paisa`.
  **A gross margin computed as `line_total_paisa − cogs_paisa` is overstated by the sales tax on
  every line**, and `sales_item_facts` carries no `tax_paisa` column to remove it. This is the
  item-grain instance of COGS-03's B5 and it is sharper than B5: at order grain the fix is a column
  choice, at item grain the column does not exist. (W19.)

### What must never happen, restated so it can be pointed at

1. A COGS figure must never be re-derived from `ingredient_branch_stock.avg_cost_paisa`. That column
   is overwritten in place by every receipt (`ReceiptService.java:73`, `OpeningBalanceService.java:63`,
   `TransferService.java:240`) and there is no history:
   ```
   $ grep -rn "cost_history\|price_history\|CREATE TABLE.*history" --include="*.sql" .
   (no output)
   ```
2. An order's COGS must never be allocated across its lines by revenue share, menu price, or any
   proxy for consumption. `37-07-PLAN.md:29` already named this prohibition; it is restated at
   COGS-03 §7 B1; it stands.
3. A partial sum must never be presented as a total. This is the failure the existing
   `countIf(...) = 0 → NULL` guard does **not** catch, and it is the single most dangerous item in
   this plan.

---

## 1. Theoretical vs actual food cost — and a finding neither of the input documents made

### 1.1 The definitions, and which one the system is actually computing today

- **Theoretical food cost** — what the recipes say the sold items should have consumed, priced.
- **Actual food cost** — opening stock + purchases + transfers in − transfers out − closing stock.
- **The gap** — waste, theft, over-portioning, yield loss. This is the number an operator manages.

**The number `DepletionService` computes, and that `finance-service` posts as `ORDER_COGS`, is
THEORETICAL food cost valued at ACTUAL moving-average prices.** It is not actual food cost and must
never be labelled as such.

The proof is in the code shape. `DepletionService.java:100-142` builds
`Map<UUID, BigDecimal> requiredByIngredient` by exploding each sold line's *recipe*. Nothing measures
what the kitchen actually took out of the walk-in. The relief of stock is recipe-driven:

```java
BigDecimal effectiveQty = UomConverter.effectiveBaseQty(
        line, item.qty(), recipe.getYieldServings(), factor.get());
requiredByIngredient.merge(line.getIngredientId(), effectiveQty, BigDecimal::add);
```
(`DepletionService.java:139-141`)

Over-portioning does not appear here. It appears later, as a `COUNT_VARIANCE` movement when somebody
counts the shelf.

### 1.2 The finding: the chart of accounts already draws the theoretical/actual line

I read every posting method in `AutoPostingRecipeEngine`:

| Source | GL accounts | What it is |
|---|---|---|
| `ORDER_COGS` (`:204-255`) | `tag("COGS")` / `tag("INVENTORY")` | **theoretical** consumption at actual MAC |
| `WASTAGE` (`:331-345`) | `tag("WASTAGE")` / `tag("INVENTORY")` | recorded waste — **not** posted to COGS |
| `COUNT_VARIANCE` (`:355-389`) | `tag("COUNT_LOSS")` / `tag("COUNT_GAIN")` / `tag("INVENTORY")` | shrink and over-portioning — **not** posted to COGS |

So, per branch per period, with every term already posted and already auditable:

```
theoretical food cost = COGS
actual food cost      = COGS + WASTAGE + COUNT_LOSS − COUNT_GAIN
the gap               = WASTAGE + COUNT_LOSS − COUNT_GAIN
```

Neither COGS-02 nor COGS-03 identified this. COGS-03 §6.2 proposed reconstructing actual food cost
from the `opening + purchases − closing` identity, which is correct arithmetic but needs a dated
closing valuation this system does not store (§2.2 below). **The ledger route is strictly better:
it needs no snapshot, every term is a posted journal entry that ties to the GL, and the gap
decomposes into its three named causes instead of arriving as one unattributed residual.**

The equivalent statement in `inventory_movements`, which is the same data one layer down and is what
the reporting pipeline should actually read:

```
theoretical = Σ total_cost_paisa WHERE movement_type = 'DEPLETION'
gap         = Σ cost of WASTAGE + COUNT_VARIANCE movements
```

All eight movement types are genuinely written — `OPENING_BALANCE` (`OpeningBalanceService.java:82`),
`RECEIPT` (`ReceiptService.java:93`), `DEPLETION` (`DepletionService.java:188`), `TRANSFER_OUT`/`IN`
(`TransferService.java:144,256`), `COUNT_VARIANCE` (`StockCountService.java:146`), `WASTAGE`
(`WastageService.java:114`) — and the table is append-only in practice: nothing in the codebase
updates or deletes a movement row.

### 1.3 The honesty rule this produces, which is the most important rule in the plan

**Without a posted stock count in the period, the variance is UNMEASURED, not zero.**

`stock_counts` has `status CHECK IN ('DRAFT','POSTED')` and `posted_at`
(`V1__inventory_schema.sql:226-239`). If no count posted inside the window, `COUNT_LOSS` and
`COUNT_GAIN` are structurally zero, and `actual − theoretical` collapses to waste alone. Rendering
that as *"variance: 0.0%"* would tell an owner their kitchen has no portioning drift, which is a
claim the system has made no measurement to support. It is precisely the defect class of
*"the cart quoted every dine-in guest 5% low"*: well-formed, plausible, actionable, wrong.

The variance figure renders as an absence with the reason **"no stock count posted in this period"**,
and it names the date of the last posted count.

### 1.4 What can be supported, when

| Number | Grain | Today | After this plan |
|---|---|---|---|
| Theoretical food cost | branch × period | computed, unreachable by reporting | **yes** (W05–W08) |
| Theoretical food cost | menu item | attribution destroyed at `:141` | **yes** (W15–W18) |
| Actual food cost | branch × period | every term posted, unreachable | **yes** (W08), bounded by count cadence |
| Actual food cost | menu item / order / hour | **impossible** | **impossible** — a property of the physical world, not a gap in this system |
| The gap | branch × period | — | **yes**, decomposed into waste / count loss / count gain |

---

## 2. Dated costs vs current costs

### 2.1 The situation is better than feared, and the fix is a rule, not a table

The brief anticipated that ingredient costs are stored only as "current", making any historical
margin an estimate wearing a fact's clothes. **Half true, and the half that is true is already
solved — by accident of good design, and undocumented as such.**

- **Current-only, confirmed.** `ingredient_branch_stock.avg_cost_paisa` is one mutable
  `NUMERIC(18,4)` (`V1__inventory_schema.sql:59-73`, retyped `V12:28-30`). There is no history
  table (grep above returns nothing) and no version column. *"What was the average cost of salmon on
  7 August"* cannot be answered from the cost model.
- **But the cost was frozen at the moment of consumption.** `DepletionService.java:190-191` writes
  `movement.setUnitCostPaisa(savedStock.getAvgCostPaisa())` and
  `movement.setTotalCostPaisa(cogsPaisa)` into `inventory_movements`, and nothing ever updates it.
  `unit_cost_paisa` is the MAC **as it stood at that instant**; `total_cost_paisa` is the money that
  posted to the GL.

So the dated cost this project needs already exists — at the only instants where it is *knowable*,
which is exactly the instants where stock moved.

**Therefore the plan's first item is not "build a cost-history table". It is to make it structurally
impossible for any COGS or margin path to read the live column.** Building a history table would
duplicate `inventory_movements` and create a second source of truth for money — which is the defect
`AutoPostingRecipeEngine.java:245-250` throws to prevent.

The rule, stated so a reviewer can enforce it:

> **Every COGS figure is sourced from a frozen `inventory_movements` row. No reporting query, no
> backfill, and no ETL may read `ingredient_branch_stock.avg_cost_paisa`.** The only legitimate
> readers of the live column are `RecipeCostPreviewService` (a forward-looking authoring estimate,
> correctly labelled at `recipe-cost-panel.tsx:105-107`) and the closing-inventory valuation in §2.2.

This is W01, and it ships with a test that fails if a reporting or backfill class calls
`getAvgCostPaisa()`.

### 2.2 The one place a dated cost genuinely does not exist

Closing inventory **value** at a past date. `qty_on_hand` at date *D* is reconstructable — the
movement `qty` is signed (`DepletionService.java:189` negates) — but the *rate* at date *D* is only
known at movement instants, and an ingredient that did not move has no row.

This does not block anything in §1.2's ledger formulation, which never needs a closing valuation.
It blocks only a balance-sheet-style inventory value series. W02 adds a forward-written period-end
valuation snapshot for that, and the series **starts at the first snapshot and renders an absence
before it** — it is not backfilled by valuing history at today's MAC.

### 2.3 Backfill: what is and is not recoverable

| | Recoverable? | How | Rule |
|---|---|---|---|
| Order-grain historical COGS | **Yes** | `inventory_movements` where `movement_type='DEPLETION'` and `reference_type='ORDER_CLOSED'`, grouped by `reference_id` | Frozen at depletion. Never recomputed. |
| Line-grain (menu-item) historical COGS | **No** | The recipe→sold-line attribution was never persisted | The Menu Margin Ranking's history starts at deploy date, and says so |
| Orders with no `DEPLETION` movement | **No** | — | **No row.** Not a zero. The LEFT JOIN in §4.2 renders them uncosted. |
| Closing inventory value before W02 | **No** | — | Series starts at first snapshot |

Three hazards, each with a proven precedent to copy:

1. **Event replay is a no-op.** `ProcessedEventService.tryProcess` returns early on a seen
   `(consumer, eventId)` (`ProcessedEventService.java:25-29`); finance's guard is
   `alreadyPosted(SOURCE_ORDER_COGS, orderId)` (`AutoPostingRecipeEngine.java:206`). Backfill is a
   **script that writes facts**, never a republished event.
2. **`ReplacingMergeTree` is declared with no version column** (`V001:87` — bare). Its choice among
   duplicates is an insertion-order artefact. A re-INSERT backfill risks a merge collapsing the
   corrected row back to the original. **Every new fact table in this plan declares
   `ReplacingMergeTree(ingested_at)` with an explicit version column** — a real improvement over
   `V001`'s tables, and cheap because the tables are new.
3. **Mutations are for the one-off repair, not the steady state.** `ALTER … UPDATE` on `cogs_paisa`
   is legal (it is not in the sort key, unlike the `business_date` that forced `V003` into
   `INSERT`+`DELETE`, `V003:47-55`), and `scripts/ops/phase37-repair-analytics-utc-drift.py:146-161`
   proves the idiom in this repo — `SETTINGS mutations_sync = 2`, then **re-read to confirm rather
   than trust the mutation**. But a mutation rewrites whole parts. One per order, hundreds per day,
   is not a pipeline. **COGS arrives as its own fact table joined at read time, never as a
   per-order mutation of `sales_item_facts`.** This is the engineering call COGS-01 §8 left open.

---

## 3. Partial data — coverage

### 3.1 The existing guard catches zero coverage, not partial

`ReportCatalog.java:88-89`, verbatim:

```sql
if(countIf(cogs_paisa IS NOT NULL) = 0, NULL, sum(cogs_paisa)) AS cogs_paisa,
if(countIf(gross_margin_paisa IS NOT NULL) = 0, NULL, sum(gross_margin_paisa)) AS gross_margin_paisa
```

It fires only when **no** row in the group has a value. Today every group is entirely uncosted, so
it is safe. The day recipes cover part of the menu, a group with 9 costed lines and 1 uncosted line
returns the sum of 9 — presented as the cost of 10. **Understated cost means overstated margin**,
and the number is arithmetically valid, plausible and actionable.

The frontend has the same hole: `owner-dashboard.tsx:98` is
`itemRows.every((r) => r.gross_margin_paisa == null)`. A mixed result sets `marginUnavailable` to
`false`, at which point `value="—"` (a hardcoded literal, `:175`) renders **with no explanation at
all** — the worst of both worlds.

There is exactly one place in this codebase where the idiom appears:

```
$ grep -rn "countIf" --include="*.java" --include="*.sql" --include="*.ts" --include="*.tsx" .
frontend/lib/api-client/schemas/reporting.schema.ts:23   (a comment describing it)
services/.../report/ReportCatalog.java:79                (the javadoc)
services/.../report/ReportCatalog.java:88
services/.../report/ReportCatalog.java:89
```

No shared helper, no SQL constant, no lint. A new report that forgets the wrapper gets ClickHouse's
default with nothing to catch it.

### 3.2 Coverage is not one number. It is three, and they disagree

| Coverage | Definition | Where it comes from | What it qualifies |
|---|---|---|---|
| **Catalog** | covered menu items ÷ active menu items | `RecipeService.getCoverage()` (`RecipeService.java:129-172`), already a first-class API | *"How much of my menu is costed?"* — an operations metric, not a report caveat |
| **Line** | costed sold lines ÷ sold lines, in the period | `countIf(...)` / `count()` on the fact tables | Counts: item ranking positions, line counts |
| **Revenue** | revenue of costed lines ÷ total revenue, in the period | `sumIf(...)` / `sum(...)` | **Money figures — COGS, margin, food cost %** |

They are not interchangeable. `seed_restaurantos.py:1229-1234,1373-1379` creates 1 recipe against 1
of up to 6 active menu items — ~17% catalog coverage. If that one item is the best seller, revenue
coverage could be 60%. **A money figure must be qualified by revenue coverage, because the missing
money is what biases it.** Qualifying a rupee total with a menu-item percentage is a category error
that happens to produce a number.

Two properties of `RecipeService.getCoverage()` that must be stated wherever it is surfaced:
it classifies against `Instant.now()` (`RecipeService.java:140`), so it is a statement about **today**
and not about the report's period; and it is branch-agnostic, while `avg_cost_paisa` is per-branch.

### 3.3 Coverage is measured by absence against the complete sales facts — never by a flag on the event

This is the design decision that makes coverage trustworthy, and it falls out of a detail I verified
that neither input document drew the consequence of:

**A fully-uncovered order publishes no `STOCK_DEPLETED` at all.** `DepletionService.java:144-147`:

```java
// D-03: no early return here — even when EVERY line is uncovered, fall through so
// DEPLETION_INCOMPLETE still publishes below. STOCK_DEPLETED only fires when at least one
// ingredient actually resolved (never with zero depletedLines just to signal something ran).
if (!requiredByIngredient.isEmpty()) {
```

And `DEPLETION_INCOMPLETE` cannot be used to count what was missed. Its payload is
`DepletionIncompletePayload(orderId, closedAt, List<UUID> missingMenuItemIds)`
(`InventoryEventContract.java:92`), and `missingMenuItemIds` is an `ArrayList` appended at **two**
sites with different granularity — once per `ItemEntry` for a missing recipe (`:109`) and once per
*recipe line* for an unconvertible UOM (`:135`). Duplicates are possible, a menu item with one good
line and one bad line appears as both depleted and missing, and there is no sold-line identity
anywhere in it. **It is an operator alert, not a measurement.** (It also has no consumer at all:
`grep` outside inventory-service returns only the constant declarations and one entry in
`AuditEventCatalog.NOT_AUDIT_RELEVANT:144`.)

Therefore:

> **Coverage is `LEFT JOIN` absence.** `sales_order_facts` and `sales_item_facts` contain every
> order and every sold line, unconditionally. The COGS fact tables contain rows only where a cost
> was actually measured. Uncovered = present on the left, absent on the right. No flag can drift out
> of sync with the money, because there is no flag.

This also means no `DEPLETION_INCOMPLETE` consumer is needed in reporting. Recommend surfacing it
operationally instead (W21), which is where it belongs.

### 3.4 The coverage contract for every COGS-bearing report

1. `covered_revenue_paisa`, `total_revenue_paisa`, `covered_line_count`, `total_line_count` are
   **real columns on the response**, never a note and never inferred by the client.
2. A money figure below the coverage floor renders as an **absence with the coverage stated**, not
   as a partial sum. Proposed floor: **95% revenue coverage** for a headline KPI tile; below it the
   figure is not shown. Reports (as opposed to tiles) always return the figure *and* its coverage,
   because a report is a place to investigate.
3. Between the floor and 100%, the figure renders **with a coverage qualifier attached to the
   number itself** — not in a banner elsewhere on the page (§5.3).
4. `dataNotes` is derived from the observed coverage, following
   `FbrTaxSummaryService.java:106-126`, which builds `new ArrayList<>()` and `.add(...)`s a note only
   when the lookup actually failed. Never from `"sales-by-item".equals(code)`.

---

## 4. The design

### 4.1 Why COGS goes in its own tables and `sales_item_facts.cogs_paisa` stays NULL forever

Three facts force it:

1. **T0 < T1.** `SalesFactWriter.write` runs from `ORDER_CLOSED` in reporting-service; COGS first
   exists later, in inventory-service, from an independent fanout subscriber of the same routing
   key. No ordering guarantee, no correlation wait. The initial INSERT structurally cannot carry it.
2. **Mutation is not a pipeline** (§2.3 hazard 3).
3. **The declared grain is unreachable.** `sales_item_facts` is `(order_id, line_no)` where `line_no`
   is a loop counter (`SalesFactWriter.java:85`), and the sold-line identity is destroyed at
   `DepletionService.java:141`.

So: two new tables, joined at read time on their leading sort-key prefix, which is a prefix seek.
`sales_item_facts.cogs_paisa` keeps its `Nullable(Int64)` type and its NULL, and its DDL comment is
rewritten (`ALTER TABLE … COMMENT COLUMN`, the pattern `V005__discount_source.sql:25` established)
to point at the real table — so the next reader does not repeat this investigation. The existing
`countIf(... IS NOT NULL) = 0 → NULL` guard on `sales-by-item` stays exactly as it is and keeps
rendering `—`, correctly, forever.

```
V006__order_cogs_facts.sql
  clickhouse_analytics.order_cogs_facts
    tenant_id, branch_id, business_date Date, order_id UUID,
    cogs_paisa Int64,                      -- theoretical consumption at actual MAC
    cogs_basis LowCardinality(String),     -- 'THEORETICAL_AT_MAC'; there will be others
    covered_line_count UInt16, total_line_count UInt16,
    covered_revenue_paisa Int64,
    depleted_at DateTime64(3,'UTC'), event_id UUID, ingested_at DateTime64(3,'UTC')
  ENGINE = ReplacingMergeTree(ingested_at)
  PARTITION BY toYYYYMM(business_date)
  ORDER BY (tenant_id, branch_id, business_date, order_id)

V007__inventory_period_facts.sql        -- the gap, per §1.2
  clickhouse_analytics.inventory_movement_facts
    tenant_id, branch_id, business_date Date, movement_type LowCardinality(String),
    ingredient_id UUID, qty Decimal(18,4), total_cost_paisa Int64,
    reference_type, reference_id, movement_at, event_id, ingested_at

V008__sales_item_cogs_facts.sql         -- wave 5 only
    tenant_id, branch_id, business_date, order_id, order_item_id UUID,
    menu_item_id, cogs_paisa Int64, cogs_basis, ingested_at
  ORDER BY (tenant_id, branch_id, business_date, order_id, order_item_id)
```

Three registration points that are easy to miss and each fails silently:

- `ClickHouseSchemaGuard.REQUIRED_FACT_TABLES` (`ClickHouseSchemaGuard.java:24-25`) lists only the
  four `V001` tables. `sales_discount_facts` from `V004` was **already** missed — that is a
  pre-existing gap this plan closes in passing.
- `nlq_allowed_tables` seeds only the same four per role (`nlq-service V1__nlq_schema.sql:15-30`).
- The ClickHouse `nlq_readonly` user is granted `SELECT` per table, deliberately never
  `ON clickhouse_analytics.*` (`V002__nlq_readonly_user.sql:64-72`).

A new table missing from any of the three is invisible to NLQ with no error the user can act on.

### 4.2 The read shape

Aggregate each side independently and divide. Never join order-grain money to item-grain rows —
that fans the order money out by line count.

```sql
SELECT s.business_date,
       s.net_sales_paisa,
       c.cogs_paisa,
       s.covered_revenue_paisa,
       s.total_revenue_paisa,
       s.covered_order_count,
       s.total_order_count
FROM (
  SELECT o.business_date,
         sum(o.subtotal_paisa) - sum(o.discount_paisa)                        AS net_sales_paisa,
         sum(o.subtotal_paisa - o.discount_paisa)                             AS total_revenue_paisa,
         sumIf(o.subtotal_paisa - o.discount_paisa, k.order_id != toUUID('...')) AS covered_revenue_paisa,
         count()                                                              AS total_order_count,
         countIf(k.order_id IS NOT NULL)                                      AS covered_order_count
  FROM clickhouse_analytics.sales_order_facts o
  LEFT JOIN clickhouse_analytics.order_cogs_facts k USING (tenant_id, branch_id, business_date, order_id)
  WHERE o.tenant_id = ? AND o.branch_id = ? AND o.business_date BETWEEN ? AND ?
  GROUP BY o.business_date
) s
LEFT JOIN (
  SELECT business_date, sum(cogs_paisa) AS cogs_paisa
  FROM clickhouse_analytics.order_cogs_facts
  WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
  GROUP BY business_date
) c USING (business_date)
```

(Shape only — the `LEFT JOIN` sentinel handling is written properly in W08; the point is that the
left side is the complete order population and coverage is derived from the join's misses.)

The percentage is then computed **at the edge**, in the service, from two integer paisa columns,
with both guards: NULL numerator → NULL result, zero denominator → NULL result
(`DashboardTileService.java:152-154` is the precedent — *"'no orders yet' and 'average order value
is zero' are different facts"*). ClickHouse division by zero yields `inf`/`nan`, which serialises
into something `z.number()` will either reject or render as `Infinity`.

### 4.3 The denominator, named on the report's face

Three different figures in this codebase are all called "sales":

| figure | expression | where | tax? | service charge? |
|---|---|---|---|---|
| dashboard "Net sales" | `sum(total_paisa)` | `owner-dashboard.tsx:89` | **yes** | **yes** |
| FBR "taxable sales" | `sum(subtotal_paisa)` | `FbrTaxSummaryService.java:74-76` | no | no |
| true restaurant net sales | `subtotal − discount` | *nowhere* | no | no |

`sales_order_facts` carries all five money columns (`V001:49-53`), so the choice is free.

**Decision: `sum(subtotal_paisa) − sum(discount_paisa)`.** Sales tax is a pass-through to FBR and
was never revenue; service charge is a labour recovery, not food revenue. Using the dashboard tile's
`total_paisa` would understate food cost % by the full tax rate — on 16% GST, a genuine 33% food
cost renders as ~28%, which is the difference between *"we have a problem"* and *"we're fine"*.

The report titles itself **"Food cost as % of net sales (ex-tax, ex-service-charge, after
discounts)"**. A bare percentage with an unstated denominator is the exact defect class this codebase
has already paid for three times.

One wrinkle: `sales_order_facts.discount_paisa` is the order-level total and `sales_discount_facts`
(`V004`) now carries the same money at discount grain. Summing both double-counts. Use
`sales_order_facts.discount_paisa` and say so in the SQL comment.

### 4.4 Rounding, and a trade-off that must be made deliberately

Today COGS is rounded **once per ingredient per order**: `computeCogsPaisa(required, avgCost)` →
`MacCalculator.extendedCostPaisa` → `setScale(0, HALF_UP)` (`MacCalculator.java:61`), where
`required` is already summed across every sold line sharing that ingredient
(`DepletionService.java:141,181`). The rate→amount boundary is crossed in exactly one function
(`MacCalculator.java:52-62`), which is correct and must be preserved.

Wave 5 needs per-sold-line costs. Computing them independently and summing produces a total that
differs from today's aggregate by rounding pennies. There is no way to have both. The choice:

> **Round at the finest grain that is reported, once, and let the coarser figures be sums of the
> finer ones.** Σ(line) == order == day, exactly, at every level. The aggregate acquires slightly
> more rounding error against the true real-valued cost — at most 1 paisa per (sold line ×
> ingredient) pair — in exchange for a report whose parts always sum to its total.

This changes the posted `ORDER_COGS` journal amount by that same margin. It is a real change to a GL
figure and is called out explicitly in the W15 migration note, not absorbed. `finance-service`'s
reconciliation guard (`AutoPostingRecipeEngine.java:245-250`) stays green because header and lines
move together within the same payload — but the guard's tolerance is exact equality today
(`posted != p.totalCogsPaisa()` → throw), so W15 must make the header the **sum of the published
lines** rather than an independently-computed total. A report whose parts do not sum to its total is
the defect; a total that disagrees with the sum of its parts by rounding is the same defect wearing
a smaller number.

---

## 5. The honest fallback — what the UI renders when inputs are incomplete

### 5.1 The three states, and why two is not enough

`StatTile` today has exactly two states. `stat-tile.tsx:129-134`:

```
/**
 * Set when the figure genuinely cannot be computed from data this system holds. Renders `—`
 * plus this reason instead of the value, and suppresses the delta row. Say what is missing
 * ("no aggregate food-cost source"), not that something went wrong.
 */
unavailableReason?: string;
```

Computed, or absent-with-a-reason. **Coverage introduces a third state that neither covers: computed
from a known fraction of the inputs.** Forcing it into "computed" is exactly B4 — the number appears
whole. Forcing it into "absent" throws away a figure that is genuinely useful at 92% coverage.

W13 adds a `qualifier` slot rendered **adjacent to the value**, in the same visual unit, never as a
page banner. A caveat that lives elsewhere on the page is a caveat the reader screenshots away from.

### 5.2 The rules, in precedence order

1. **No data at all** → `—` plus `unavailableReason`, delta row suppressed. Never `0`.
   *"No costed sales in this period. Cost of goods is posted only for menu items that have a recipe."*
2. **Revenue coverage below the floor (< 95%)** → `—` plus `unavailableReason` naming the fraction.
   *"Cost is known for 62% of this period's sales. A margin computed from part of the sales would
   overstate it, so it is not shown."* Never a partial sum.
3. **Revenue coverage at or above the floor but below 100%** → the figure, plus a qualifier attached
   to it. *"covers 97% of sales"*. Delta rows against a prior period render **only if that period's
   coverage is also above the floor**; otherwise the delta is `null`, which `StatTile` already
   distinguishes from `0` (`stat-tile.tsx:116-124` — *"`null` must never be coerced to `0`, which
   claims the business did not move"*).
4. **Zero denominator** (a closure day) → `—` plus *"no sales in this period"*. Never `0%`.
5. **Actual-vs-theoretical variance with no posted stock count in the window** → `—` plus
   *"no stock count posted since {date}. Portioning variance is unmeasured, not zero."*
6. **Every figure, always** → its basis on its own face: *"theoretical, from recipes, at cost as at
   the time of sale"*.

At no point does any of these render `0`, and at no point does a number appear without its coverage.

### 5.3 What must be deleted, or the honesty mechanism inverts

Three places hardcode *"not yet available"*, none derived from data. On the day COGS becomes real,
all three keep asserting it does not exist.

| Site | What it does now |
|---|---|
| `ReportService.java:80-82` | `"sales-by-item".equals(code)` → always emits the Phase-8 note, whether or not the rows carry COGS |
| `ReportTable.tsx:83-85` | if a report has a COGS column and sent **no** notes, the UI **invents** the sentence |
| `owner-dashboard.tsx:175` | `value="—"` is a literal; the tile cannot display a number even when `marginUnavailable` is false |

Plus the CI gate, which currently **fails the build if COGS is populated** —
`scripts/e2e/phase12-reporting-e2e.sh:168,179`:

```bash
COGS_NOT_NULL="$(ch_query "SELECT count() FROM clickhouse_analytics.sales_item_facts WHERE cogs_paisa IS NOT NULL")"
[[ "$COGS_NOT_NULL" == "0" ]] && pass "..." || fail "cogs_paisa unexpectedly non-null in $COGS_NOT_NULL rows"
```

Under this design that assertion stays **true and correct** — `sales_item_facts.cogs_paisa` is never
populated (§4.1). It is joined by a new positive assertion against `order_cogs_facts`, so the gate
proves the pipeline works instead of proving it does not exist.

### 5.4 A defect shipping today, in the same family

Independent of the dashboard, `RecipeCostPreviewService` prints a lie right now. Verified at
`:110-165`: warned lines are skipped from the accumulator and `batchCostPaisa` is returned as a plain
`long` (`RecipeDtos.java:71-78` — the aggregates are primitives and cannot be null). If **every**
line warns, `batchCost = 0` → `portionCostPaisa = 0` → with a menu price present,
`foodCostPct = 0 / price × 100 = 0.0`, a non-null `BigDecimal`. The panel renders `"0.0%"`
(`recipe-cost-panel.tsx:27-32`) beside `Batch cost Rs 0.00`.

**"0.0% food cost" is a claim that a dish costs nothing to make.** The per-line contract right beside
it is exemplary — *"a degraded line never carries a partial/misleading cost figure"*
(`RecipeDtos.java:51-56`). The aggregates simply were not held to it. W00 fixes it: the three
aggregates become nullable when `excludedLineCount > 0`, and a zero batch cost is never divided by a
price. Cheap, standalone, and it is a lie on screen today.

---

## 6. Work items, ordered by dependency

### Wave 0 — the shipping defect, and the dated-cost rule

| id | title | layer | risk |
|---|---|---|---|
| **W00** | `RecipeCostPreviewDto` aggregates go nullable when any line is excluded; never divide a zero batch cost by a price | api | low |
| **W01** | Frozen-cost rule: `inventory_movements` is the system of record for COGS. Add the missing time-bounded and order-set repository queries; add a test that fails if any reporting/backfill class reads `avg_cost_paisa` | domain | low |
| **W02** | `inventory_valuation_snapshots` — forward-written period-end `qty × MAC` per (branch, ingredient). The only dated cost the ledger cannot supply | schema | low |

`InventoryMovementRepository` is 31 lines and exposes three methods —
`findByReferenceId(UUID)`, `existsByTenantIdAndIngredientId`,
`findDistinctIngredientIdsByTenantIdAndIngredientIdIn`. **No time-bounded query exists.**
`findByReferenceId(orderId)` is the seam the backfill uses.

### Wave 1 — fix the source defects before building on them

| id | title | layer | risk |
|---|---|---|---|
| **W03** | `businessDate` onto `StockDepletedPayload` and `DepletionIncompletePayload`; pass it in `postOrderCogs`. **Closes the wrong-clock GL dating defect** | domain | **high** |
| **W04** | Per-order coverage counts (`covered_line_count`, `total_line_count`, `covered_revenue_paisa`) onto `StockDepletedPayload`, via the additive-component precedent already in `InventoryEventContract.java:84-87` | domain | medium |

W03 is high risk because it changes a shared event contract consumed by finance and alters the date
a journal entry posts to — including, potentially, entries in a closed accounting period. It needs
its own migration note and a decision about historical entries (recommendation: **do not** re-date
posted history; correct forward and reconcile the boundary explicitly, per `V003:43-45` —
*"guessing its date to make a total look tidy is precisely what D-37-05 forbids"*).

### Wave 2 — the pipeline

| id | title | layer | risk |
|---|---|---|---|
| **W05** | `V006__order_cogs_facts.sql` + `V007__inventory_movement_facts.sql`, `ReplacingMergeTree(ingested_at)` | schema | low |
| **W06** | Register both in `ClickHouseSchemaGuard`, `nlq_allowed_tables`, and the `nlq_readonly` grants. **Also add the pre-existing `sales_discount_facts` omission** | schema | low |
| **W07** | reporting-service binds `inventory.topic`; `StockDepletedConsumer` + `CogsFactWriter`, idempotent through `ProcessedEventService`, DLQ-bound per the existing three-queue pattern | ingestion | medium |
| **W08** | Backfill script: order-grain historical COGS from frozen `DEPLETION` movements. Sets the tenant GUC per `V003:27-29`; re-reads to confirm per `phase37-repair-analytics-utc-drift.py:153-161`; **writes no row for an order with no depletion** | ingestion | **high** |

### Wave 3 — the honest read layer

| id | title | layer | risk |
|---|---|---|---|
| **W09** | Coverage-aware SQL idiom as a shared fragment, replacing the all-or-nothing `countIf`. Coverage columns are first-class on every COGS-bearing report | reporting | medium |
| **W10** | New reports: `cogs-by-day`, `food-cost-pct` (named denominator, §4.3), `food-cost-variance` (§1.2, gated on a posted count) | reporting | medium |
| **W11** | `dataNotes` becomes condition-derived — `ReportDefinition` declares a note *builder*, `ReportService` stops keying on `"sales-by-item".equals(code)` | api | medium |
| **W12** | `ReportResultDto` carries structured coverage, so the client never re-derives it from nulls | api | low |

### Wave 4 — the UI

| id | title | layer | risk |
|---|---|---|---|
| **W13** | `StatTile` gains the third state: a `qualifier` rendered adjacent to the value | frontend | low |
| **W14** | `owner-dashboard.tsx` — remove the `value="—"` literal, wire COGS / gross margin / food cost % through the §5.2 rules, read `dataNotes` instead of inferring from nulls | frontend | medium |
| **W15** | `ReportTable.tsx` — delete the invented Phase-8 sentence at `:83-85`; render server notes only | frontend | low |

### Wave 5 — line grain: the Menu Margin Ranking

| id | title | layer | risk |
|---|---|---|---|
| **W16** | `ItemEntry` gains `orderItemId`; `sales_item_facts` gains `order_item_id`. The identity already exists — `order_items.id` (`pos V1__pos_schema.sql:183`) — it is simply not on the wire | domain | medium |
| **W17** | Per-sold-line COGS on the depletion path; header becomes the sum of published lines (§4.4). **Never a pro-rata allocation** | domain | **high** |
| **W18** | `V008__sales_item_cogs_facts.sql` + writer, joined to `sales_item_facts` at read time. `sales_item_facts.cogs_paisa` stays NULL; `COMMENT COLUMN` rewritten to point here | schema | medium |
| **W19** | Per-line `tax_paisa` / `discount_paisa` onto `ItemEntry` and `sales_item_facts`. **Without this, item-grain margin is overstated by the sales tax on every line** (§0) | domain | **high** |
| **W20** | Menu Margin Ranking report + tile, qualified by revenue coverage, with the standing modifier caveat (§7) | reporting | medium |

### Wave 6 — gates

| id | title | layer | risk |
|---|---|---|---|
| **W21** | Invert the CI gate: keep `sales_item_facts.cogs_paisa IS NULL`, add a positive assertion on `order_cogs_facts`. Add ITs for the coverage guard at 0%, partial and 100%. Surface `DEPLETION_INCOMPLETE` operationally — it has no consumer anywhere today | reporting | medium |

---

## 7. Money-path risks

| Risk | Mitigation |
|---|---|
| **Partial coverage silently understates cost and overstates margin.** The existing guard fires only at zero coverage (`ReportCatalog.java:88-89`); `owner-dashboard.tsx:98` has the same hole | Coverage as first-class columns measured by LEFT JOIN absence (§3.3); a 95% revenue-coverage floor below which money figures render as an absence (§5.2) |
| **`sales_item_facts.line_total_paisa` is tax-inclusive** — traced through `OrderPricingCalculator:247` → `OrderServiceImpl:2155` → `ItemEntry` → the fact table. Item-grain margin would be overstated by the tax on every line, and no `tax_paisa` column exists to remove it | Order grain first, using `subtotal − discount` from `sales_order_facts` (§4.3). W19 adds the per-line columns before any item-grain margin ships |
| **The `ORDER_COGS` journal entry is dated in UTC while its revenue is dated by the branch trading day** (`AutoPostingRecipeEngine.java:254` → `:576-579` → `:594-598` vs `:162-164`) | W03, in wave 1, before anything is built on daily margin. Do not re-date posted history; correct forward and reconcile the boundary explicitly |
| **Modifiers add revenue and structurally cannot add cost.** `modifiers` has `price_delta_paisa` and no ingredient link (`pos V1__pos_schema.sql:96-108`); modifiers are absent from `ItemEntry` entirely. Every "+Rs 150 extra cheese" books as 100% margin | Not fixable in this plan. A standing, permanent caveat on every margin report naming it. Variants do not exist as a concept either — sizes are separate menu items, each needing its own recipe |
| **Re-pricing history at today's MAC** would produce a number that looks computed and is historically false | W01's rule plus its test; the backfill reads only frozen `total_cost_paisa` |
| **`ReplacingMergeTree` with no version column** makes row-replacement non-deterministic (`V001:87`) | Every new table declares `ReplacingMergeTree(ingested_at)`. Mutations only for the one-off backfill, with `mutations_sync = 2` and a re-read |
| **A per-order mutation pipeline would rewrite ClickHouse parts hundreds of times a day** | COGS lives in its own tables, joined at read time. `sales_item_facts` is never mutated |
| **Rounding drift between per-line and aggregate COGS** changes a posted GL figure | Round once at the finest reported grain; header = Σ published lines; called out in the W17 migration note, not absorbed (§4.4) |
| **A new fact table invisible to NLQ**, silently — three registration points, one of which (`sales_discount_facts`) was already missed | W06 closes all three plus the pre-existing gap |
| **The CI gate currently fails the build the moment COGS is populated** (`phase12-reporting-e2e.sh:179`) | W21, in the same change as the first populated column |
| **`DEPLETION_INCOMPLETE` used as a coverage measurement.** Its `missingMenuItemIds` list has duplicates, mixes item-grain and line-grain appends (`:109` vs `:135`), and carries no sold-line identity | Never used for measurement. Coverage is LEFT JOIN absence. The event becomes an operator alert (W21) |
| **`RecipeService.getCoverage()` used as a report caveat.** It classifies against `Instant.now()` (`:141`) and is branch-agnostic, while costs are per-branch | Catalog coverage is an operations metric on its own surface. Money figures are qualified by revenue coverage in the report's own period |

---

## 8. What must be preserved

Every one of these already exists and must survive:

1. `null` written, never `0` (`SalesFactWriter.java:100-107`); `Nullable(Int64)` in the DDL.
2. `countIf(... IS NOT NULL) = 0 → NULL` on `sales-by-item` — kept verbatim, extended by the
   coverage-aware form elsewhere.
3. `—` in the UI, never `0`, never blank (`ReportTable.tsx:26-34`), screen-reader-labelled.
4. `z.number().nullable()`, explicitly never `.default(0)` (`reporting.schema.ts:28-33`).
5. Divide-by-zero → `null` (`DashboardTileService.java:152-154`).
6. Drop a tile rather than fake it (`DashboardTileService.java:34-37`).
7. Reconcile lines to header and **throw** on mismatch (`AutoPostingRecipeEngine.java:245-250`).
8. Money is integer paisa end to end; rates carry decimals; round **once**, at the rate→amount
   boundary, in `MacCalculator.extendedCostPaisa` (`V12__unit_cost_precision.sql:17-21`).
9. Rename or drop a report rather than ship it against data that cannot support it
   (`ReportCatalog.java:15-22`).
10. Recipes resolve by `effective_from <= closedAt`, never by `is_current`
    (`RecipeService.java:103-112`).
11. COGS values at the aggregate MAC, never a lot's own receipt cost
    (`DepletionService.java:265-280`, `InventoryEventContract.java:57-63`).
12. A unit conversion across families returns `Optional.empty()`, never a guessed 1
    (`IngredientUomFactorResolver.java:82-84`).
13. `tenant_id` from `TenantContext` only; the `branch_id` predicate authored once per report
    (`ReportCatalog.java:202-206`).
14. D-38-16: a number that cannot be computed renders as an absence with its reason, and its delta
    row is suppressed. `StatTile.unavailableReason` is the sanctioned rendering.
