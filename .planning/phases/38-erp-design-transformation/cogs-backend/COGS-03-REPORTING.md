# COGS-03 — The Reporting / Analytics Layer

**Scope:** `reporting-service`, the ClickHouse `clickhouse_analytics` schema, and the frontend
surfaces that consume them. Read-only survey. Every claim below is a `file:line` or a quoted grep;
nothing was built, no Maven ran, no schema was touched.

**Repo surveyed:** `/Users/muhammadumer/Documents/Projects/ResturantOS-ui38`
**Branch at time of survey:** `phase-38-demo-calibrated-ui` (`git rev-parse --abbrev-ref HEAD`)

---

## 1. The catalog — every report it defines

`services/reporting-service/src/main/java/io/restaurantos/reporting/report/ReportCatalog.java`
is a `@Component` holding a `LinkedHashMap<String, ReportDefinition>`. Registration order
(`:36-42`) is the order the API returns them in (`list()` → `List.copyOf(definitions.values())`,
`:45-47`).

A `ReportDefinition` (`report/ReportDefinition.java:20-26`) is a record of six fields:

```java
public record ReportDefinition(
        String code, String title, String category,
        List<String> columns, String sqlBranchScoped, String sqlTenantWide) {}
```

`sqlTenantWide` is not written by hand. `ReportCatalog.define(...)` (`:202-206`) derives it:

```java
String sqlTenantWide = sqlBranchScoped.replace(" AND branch_id = ?", "");
```

So the `tenant_id = ?` predicate is authored **exactly once per report**, and the two variants
cannot drift. This is a deliberate isolation property, documented at `ReportCatalog.java:24-28`.

### Parameters — identical for all seven reports

There are **no per-report parameters**. `ReportRequest` (`dto/ReportRequest.java:17-22`) is:

| field | type | notes |
|---|---|---|
| `branchId` | `UUID` (nullable) | OWNER may omit → tenant-wide. Everyone else is forced to their JWT branch. |
| `from` | `LocalDate` | required |
| `to` | `LocalDate` | required |
| `params` | `Map<String,Object>` | **declared but never read** — `ReportService.run()` never touches `request.params()`. Verified: `grep -n "params()" ReportService.java` returns nothing. |

There is deliberately **no `tenantId` field** (`ReportRequest.java:10-12`) — tenant comes from
`TenantContext.requireTenantId()` (`ReportService.java:63`) and nowhere else.

Bind order is fixed by `ReportDefinition.java:17-18`:
`sqlBranchScoped → (tenantId, branchId, from, to)`; `sqlTenantWide → (tenantId, from, to)`.

Range guard: `MAX_RANGE_DAYS = 400` (`ReportService.java:36`), enforced at `:120-132`; `from > to`
and null dates throw `InvalidReportRangeException`.

### The seven reports

All seven share the tail `WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?`
… `LIMIT 10000`.

#### 1. `sales-by-day` — "Sales by Day", category `sales` (`:59-73`)
Source: `sales_order_facts`. `GROUP BY business_date ORDER BY business_date`.
Columns: `business_date, order_count, subtotal_paisa, discount_paisa, tax_paisa, total_paisa`.
Note the SELECT omits `service_charge_paisa` even though the fact table carries it
(`V001__analytics_facts.sql:51`) — so `subtotal - discount + tax ≠ total` on this report's face.

#### 2. `sales-by-item` — "Sales by Item", category `sales` (`:84-99`)
Source: `sales_item_facts`. `GROUP BY menu_item_id ORDER BY gross_revenue_paisa DESC`.
Columns: `menu_item_id, item_name, qty, gross_revenue_paisa, cogs_paisa, gross_margin_paisa`.
**This is the COGS report.** Its last two columns are NULL for every row in existence. See §2.

#### 3. `sales-by-hour` — "Sales by Hour (Peak Hours)", category `sales` (`:101-114`)
See §3 — computed, never drawn.

#### 4. `sales-by-order-type` — "Sales by Order Type", category `sales` (`:116-128`)
See §3 — computed, never drawn.

#### 5. `discount-summary` — "Discount Summary", category `sales` (`:148-164`)
Source: `sales_discount_facts` (added in `deploy/clickhouse/V004__discount_facts.sql`).
Row grain: one discount on one check. `ORDER BY closed_at DESC, order_no, discount_no`.
Columns: `business_date, order_no, scope, item_name, discount_type, discount_source,
discount_value, amount_paisa, reason, applied_by, closed_at`.
Uses `coalesce(applied_by_name, toString(applied_by)) AS applied_by` (`:152`) — a name if the staff
directory answered, the raw id if it did not. Never blank.

#### 6. `till-sessions` — "Till Sessions", category `cash` (`:168-181`)
Source: `till_session_facts`. No GROUP BY — raw rows, `ORDER BY closed_at DESC`.
Columns: `till_session_id, cashier_id, business_date, expected_cash_paisa, counted_cash_paisa,
variance_paisa, closed_at`.

#### 7. `purchases-by-po` — "Purchases by Purchase Order", category `purchasing` (`:185-198`)
Source: `purchase_tax_facts`. `GROUP BY purchase_order_id, business_date`.
Columns: `purchase_order_id, business_date, invoice_count, spend_paisa, input_tax_paisa`.
Named `purchases-by-po` and not `purchases-by-vendor` because `purchase_tax_facts` has no
`vendor_id` column — the reason is written out at `ReportCatalog.java:15-22` and the DDL agrees
(`V001__analytics_facts.sql:95-101`).

### Plus one report that is not in the catalog

`fbr-tax-summary` is a **separate endpoint with a separate permission**, not a catalog entry:
`ReportController.java:58-65`, `@PreAuthorize("hasAuthority('reporting.report.fbr')")`, served by
`FbrTaxSummaryService`. It will never appear in `GET /reports`, so the reports index page
(`frontend/app/(tenant)/app/reports/page.tsx`) hand-links it (`:30-36`).

### Transport

`ReportController.java` — `/api/v1/reporting/reports`:

| method | path | permission | body/params |
|---|---|---|---|
| `GET` | `/` | `reporting.report.view` | — → `List<ReportDefinition>` |
| `POST` | `/{code}/run` | `reporting.report.view` | `ReportRequest` → `ReportResultDto` |
| `GET` | `/fbr-tax-summary` | `reporting.report.fbr` | `branchId, from, to` → `FbrTaxSummaryDto` |

`GET /` serializes the whole `ReportDefinition` record — **including `sqlBranchScoped` and
`sqlTenantWide`**, i.e. the raw SQL text ships to the browser. The frontend schema notes this and
tolerates it (`frontend/lib/api-client/schemas/reporting.schema.ts:3-14`: "MAY be present on the
wire"), and the adapter drops them. Not a correctness bug; worth knowing before adding a report
whose SQL you would rather not publish.

Every run is logged to Postgres `report_run_log` (`ReportService.java:84-86` →
`ReportRunLogger.log(...)`, `service/ReportRunLogger.java:33-38`), which is RLS-protected
tenant-scoped data (`db/migration/V1__reporting_schema.sql:11-15, 65-68`).

---

## 2. The NULL-guard idiom at `ReportCatalog.java:74-89` — the honesty mechanism

### The javadoc (`:75-83`), verbatim

> `cogs_paisa` / `gross_margin_paisa` are Phase-8-deferred NULLs in `sales_item_facts`. Plain
> `sum()` over an all-NULL Nullable column is NOT trusted to return NULL here (ClickHouse's
> NULL-skipping sum semantics for an all-NULL input are surprising across versions) —
> `countIf(... IS NOT NULL) = 0` is used to force an honest NULL whenever no row in the group has a
> non-null value, rather than risk a silent 0 that would tell an owner they sell at cost. Proven
> against a real container in `ReportServiceIT#salesByItem_cogsIsNull`.

### The idiom (`:88-89`), verbatim

```sql
if(countIf(cogs_paisa IS NOT NULL) = 0, NULL, sum(cogs_paisa)) AS cogs_paisa,
if(countIf(gross_margin_paisa IS NOT NULL) = 0, NULL, sum(gross_margin_paisa)) AS gross_margin_paisa
```

### What exactly it protects against

`sum()` in ClickHouse is NULL-skipping. Over a group where *every* row is NULL there is no
well-defined behaviour to rely on across versions — the value that comes back can be `0` rather
than `NULL`. `0` and `NULL` are not the same claim:

- `NULL` = "this system does not know the cost of what you sold."
- `0` = "you sold it at zero cost", which renders downstream as **100% gross margin**.

The guard counts the non-NULL rows in the group *first*. Zero non-NULL inputs ⇒ emit `NULL`
unconditionally, never letting `sum()` speak. It is a fail-closed test on **input completeness**,
not on the output value.

Note the asymmetry that makes it only *half* safe, and that matters enormously the day COGS starts
landing: the guard fires only when **no** row in the group has a value. A group with 9 costed lines
and 1 uncosted line returns the sum of 9 — a number that looks complete and is not. See §6, Blocker
B4.

### Every other place the same idiom is used

```
$ grep -rn "countIf" --include="*.java" --include="*.sql" --include="*.ts" --include="*.tsx" .
frontend/lib/api-client/schemas/reporting.schema.ts:23   (a comment describing it)
services/.../report/ReportCatalog.java:79                (the javadoc)
services/.../report/ReportCatalog.java:88
services/.../report/ReportCatalog.java:89
```

**Two live uses, both in `salesByItem()`, and nowhere else in the codebase.** There is no shared
helper, no SQL fragment constant, no lint rule. A new report that selects a nullable measure and
forgets the wrapper gets ClickHouse's default behaviour with nothing to catch it.

### Sibling honesty mechanisms (same intent, different shape)

These are the rest of the "never fake a number" apparatus. They are conceptual relatives of the
idiom, not textual copies:

| location | mechanism |
|---|---|
| `etl/SalesFactWriter.java:100-107` | writes literal `null` for `cogs_paisa` / `gross_margin_paisa` / `category_name` with the comment *"0 would falsely claim 'sold at cost' … Never write 0 here."* |
| `deploy/clickhouse/V001__analytics_facts.sql:78-83` | the columns are `Nullable(Int64)` at the DDL level, so `0` is not even reachable by accident |
| `service/DashboardTileService.java:152-154` | `averageOrderValue = orderCount == 0 ? null : revenue/orderCount` — *"'no orders yet' and 'average order value is zero' are different facts"* |
| `service/DashboardTileService.java:34-37` | the `open-tills` tile is **deleted rather than faked**: `till_session_facts` only records closes, so "tills open" is not computable |
| `service/FbrTaxSummaryService.java:103-105` | net payable is **never clamped** — a negative is a real refundable input-tax credit |
| `service/FbrTaxSummaryService.java:106-126` | branch NTN/STRN degrades to `null` + a `dataNotes` line instead of failing the report |
| `finance-service/.../AutoPostingRecipeEngine.java:245-249` | COGS line costs must reconcile to the producer's `totalCogsPaisa` or it throws — *"fails loudly rather than posting a plausible number"* |
| `ReportCatalog.java:15-22` | `purchases-by-vendor` was renamed rather than shipped against a table with no `vendor_id` |
| frontend `ReportTable.tsx:26-34` | `null` renders `—`, never `0`, never blank |
| frontend `reporting.schema.ts:28-33` | `z.number().nullable()`, explicitly **not** `.default(0)` |

**Preserve all of these.** Any COGS work must extend the family, not bypass it.

### Its one and only test

`services/reporting-service/src/test/java/.../report/ReportServiceIT.java:318-332`
(`salesByItem_cogsIsNull`) asserts `cogs_paisa` and `gross_margin_paisa` come back `null` and that
`dataNotes` mentions "Phase 8" (`:327-330`). The full IT list is:

```
:287 salesByDay_returnsOnlyCallersTenant
:304 salesByDay_branchScoped
:319 salesByItem_cogsIsNull
:334 reportRun_isLogged
```

Four tests, covering two of the seven reports. `sales-by-hour`, `sales-by-order-type`,
`discount-summary`, `till-sessions` and `purchases-by-po` have **no integration test at all**.

---

## 3. `sales-by-hour` and `sales-by-order-type` — computed, never drawn

Both are fully implemented backend reports. Both are reachable today at
`/app/reports/sales-by-hour` and `/app/reports/sales-by-order-type`, because
`frontend/app/(tenant)/app/reports/[code]/page.tsx` is a generic runner that renders any catalog
code through `ReportTable`. What does not exist is **any visualisation** — no chart, no dashboard
portlet, no aggregation. A bar chart of peak hours is the single most obviously missing artifact in
the product.

Proof of absence:

```
$ grep -rn "hour_of_day\|order_type" --include="*.ts" --include="*.tsx" frontend/ | grep -v node_modules
frontend/mocks/reporting.ts:45:    columns: ["hour_of_day", "order_count", "revenue_paisa"],
frontend/mocks/reporting.ts:51:    columns: ["order_type", "order_count", "revenue_paisa"],
```

Two hits, both in the MSW mock fixture. Zero hits in any component, hook, page or chart.

### `sales-by-hour` — exact output shape

Definition `ReportCatalog.java:101-114`. SQL verbatim:

```sql
SELECT toHour(closed_at) AS hour_of_day, count() AS order_count,
       sum(total_paisa) AS revenue_paisa
FROM clickhouse_analytics.sales_order_facts
WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
GROUP BY hour_of_day
ORDER BY hour_of_day
LIMIT 10000
```

| column | ClickHouse type | JSON type | meaning |
|---|---|---|---|
| `hour_of_day` | `UInt8` from `toHour(DateTime64(3,'UTC'))` | number `0..23` | see the timezone warning below |
| `order_count` | `UInt64` | number | orders closed in that hour |
| `revenue_paisa` | `Int64` | number | **gross** total incl. tax and service charge |

Shape contract for the frontend:
- **Sparse.** Only hours that had at least one closed order appear. A restaurant open 17:00–01:00
  returns ~9 rows, not 24. A chart must materialise the missing hours itself, and must draw them as
  a real zero (there genuinely were no orders) — this is the one place `0` is honest.
- Max cardinality 24, so `LIMIT 10000` never truncates.
- Ordered ascending by hour, so the array is already chart-ready.
- `revenue_paisa` is `total_paisa` — divide by 100 only at display, per the project's paisa rule
  (`owner-dashboard.tsx:127-131` is the existing precedent).

> **Timezone caveat that must be surfaced, not silently absorbed.**
> `closed_at` is `DateTime64(3, 'UTC')` (`V001__analytics_facts.sql:56`) and `toHour()` is applied
> to it directly, with no timezone argument. So `hour_of_day` is **UTC hour**, while
> `business_date` on the same row was computed in the *branch's* timezone with the 4-hour
> business-day offset (`V001__analytics_facts.sql:26-28`;
> `support/BranchTimeZoneResolver.java`, `support/BusinessDay.java`). For a PKT branch (UTC+5)
> a 20:00 dinner rush plots at hour 15. **Labelling that axis "Hour" without correction ships a
> chart that is wrong by five hours.** Either pass the branch timezone into `toHour(closed_at, tz)`
> or label the axis UTC. Do not guess.

### `sales-by-order-type` — exact output shape

Definition `ReportCatalog.java:116-128`. SQL verbatim:

```sql
SELECT order_type, count() AS order_count, sum(total_paisa) AS revenue_paisa
FROM clickhouse_analytics.sales_order_facts
WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
GROUP BY order_type
ORDER BY revenue_paisa DESC
LIMIT 10000
```

| column | ClickHouse type | JSON type | meaning |
|---|---|---|---|
| `order_type` | `LowCardinality(String)` (`V001:47`) | string | written from `OrderClosedPayload.type()` (`SalesFactWriter.java:67`) |
| `order_count` | `UInt64` | number | |
| `revenue_paisa` | `Int64` | number | gross total incl. tax |

Shape contract:
- Very low cardinality (DINE_IN / TAKEAWAY / DELIVERY class of values). It is an **open string
  domain**, not an enum, on the analytics side — the ETL copies whatever POS published. A chart
  must not hardcode a fixed set of slices or a fixed colour map keyed on assumed values; derive the
  categories from the rows.
- Ordered by revenue descending, so it is already ranked for a bar chart or a donut legend.
- Sparse in the same way: a type with no orders in the window is simply absent.

**Both reports carry `dataNotes: []`** — `ReportService.java:80-82` attaches notes only for
`sales-by-item`. Neither has any known-incomplete input, so an empty notes array here is a true
statement, not an oversight.

---

## 4. `dataNotes` — how a report declares a caveat, and how the UI surfaces it

### The contract

`dto/ReportResultDto.java:18-25`:

```java
public record ReportResultDto(
        String code, String title, List<String> columns,
        List<Map<String, Object>> rows, int rowCount, long durationMs,
        List<String> dataNotes) {}
```

Documented at `:9-11`: *"`dataNotes` carries human-readable degradation notices … so the frontend
can render '—' with an explanation instead of a misleading zero, rather than the caller having to
infer the reason from null cells alone."*

`FbrTaxSummaryDto.java:36` carries the same `List<String> dataNotes` field independently.

### How a note is produced today — and the problem with that

`ReportService.java:80-82`:

```java
List<String> dataNotes = "sales-by-item".equals(code)
        ? List.of("COGS and margin require Inventory (Phase 8) and are not yet available")
        : List.of();
```

**A note is a hardcoded string literal keyed on the report code inside the service.** It is not a
field on `ReportDefinition`, not derived from the data, and not registered by the catalog. Concretely:

- A report cannot declare its own caveat. `ReportCatalog` has no `dataNotes` parameter — verified:
  `ReportDefinition.java:20-26` has six components and none of them is a note.
- The note is **unconditional**. It fires on every `sales-by-item` run whether or not the returned
  rows contain COGS. On the day the first costed row lands, this string still says COGS "is not yet
  available" — and it will keep saying so until a human edits `ReportService.java`. That is a
  future lie with a `String.equals` for a trigger.
- `FbrTaxSummaryService.java:106-126` does it the *right* way by contrast: it builds
  `new ArrayList<>()` and `.add(...)`s a note **only when the lookup actually failed** (`:125`).
  The note is evidence of an observed condition.

The `sales-by-item` note should become condition-derived (e.g. emitted when the result actually
contains a NULL `cogs_paisa`) before COGS lands. Otherwise the honesty mechanism inverts and starts
disclaiming figures that are real.

### How the frontend surfaces it

Wire → parse → model → render, all four layers preserve nullability:

1. **Parse** — `frontend/lib/api-client/schemas/reporting.schema.ts:43` `dataNotes: z.array(z.string())`
   (required, so an absent array is a parse failure, not an empty banner). Row schema `:28-33`
   types `cogs_paisa` / `gross_margin_paisa` as `z.number().nullable()` with the explicit comment
   "NEVER `.default(0)`".
2. **Adapt** — `frontend/lib/adapters/reporting.adapter.ts:47` and `:67` pass `dataNotes` through
   untouched.
3. **Model** — `frontend/lib/models/reporting.model.ts:30` and `:55`, `dataNotes: string[]`.
4. **Render** — `frontend/components/reporting/ReportTable.tsx:81-87`:

```tsx
{(hasNullableCogs || result.dataNotes.length > 0) && (
  <div className="rounded-md border … text-muted-foreground">
    {result.dataNotes.length > 0
      ? result.dataNotes.join(" ")
      : "COGS and margin require Inventory (Phase 8) and are not yet available."}
  </div>
)}
```

An info banner above the table, joined with a space. Note the fallback branch: if a report has a
`cogs_paisa`/`gross_margin_paisa` column (`NULLABLE_MONEY_COLUMNS`, `:8`; `hasNullableCogs`, `:68`)
but the server sent **no** notes, the UI **invents the Phase-8 sentence anyway**. That is a second
place the "not yet available" claim is hardcoded, and a second place that must be removed on the
day COGS becomes real — otherwise a fully-costed report renders a banner saying its costs do not
exist.

Cells: `ReportTable.tsx:26-34` — `null`/`undefined` → `<span aria-label="… not available">—</span>`;
`*_paisa` numbers → `<MoneyDisplay>`. Never `0`, never blank, and the em dash is
screen-reader-labelled.

`FbrTaxSummaryCard.tsx:87-91` renders `dataNotes` the same way for the tax report.

### The dashboard's separate path

`frontend/components/dashboard/owner-dashboard.tsx` does **not** read `dataNotes` — despite the
comment at `:96-97` saying it should ("Read it rather than inferring from a null"). It infers:

```
:98   const marginUnavailable = itemRows.every((r) => r.gross_margin_paisa == null);
:169-180  <KpiTile id="owner-gross-margin" title="Gross margin" value="—" …
            unavailableReason={ marginUnavailable ? "Cost of goods is not yet posted per item, so
            margin cannot be computed. Showing nothing rather than a wrong number." : undefined } />
```

Two things follow. First, `value="—"` at `:175` is a **hardcoded literal** — the tile cannot ever
display a number, even if `marginUnavailable` computes false. Wiring real margin requires editing
this line, not just fixing the backend. Second, `.every(... == null)` is the same all-or-nothing
test as the SQL guard: a mixed result (some items costed, some not) sets `marginUnavailable` to
false and the tile would then show `—` **with no explanation at all**, which is the worst of both
worlds.

The rationale is worth keeping (`owner-dashboard.tsx:52-66`, `presets.ts:74-81`): *"A dashboard that
reports 100% gross margin to an owner is worse than one that reports nothing: the first is a number
they will act on."*

---

## 5. What a `food-cost-percentage` report would need

Food cost % = COGS ÷ net sales. It is **strictly downstream of COGS** — there is no shortcut, no
proxy, no "approximate it from purchases". Everything in §6 must be solved first.

### 5.1 The denominator is not settled, and choosing wrong is a money-path defect

`sales_order_facts` carries five money columns (`V001__analytics_facts.sql:49-53`):
`subtotal_paisa`, `discount_paisa`, `service_charge_paisa`, `tax_paisa`, `total_paisa`.

Three different figures in this codebase are all called "sales":

| figure | expression | used at | includes tax? | includes service charge? |
|---|---|---|---|---|
| dashboard "Net sales" | `sum(total_paisa)` | `owner-dashboard.tsx:90` | **yes** | **yes** |
| FBR "taxable sales" | `sum(subtotal_paisa)` | `FbrTaxSummaryService.java:74-76` | no | no |
| true restaurant net sales | `subtotal − discount` | *nowhere* | no | no |

The dashboard tile literally labelled **"Net sales"** sums `total_paisa`, which is gross of sales
tax and service charge. Using that as the denominator understates food cost % by the full tax rate
— on a 16% GST that turns a genuine 33% food cost into ~28%, which is the difference between "we
have a problem" and "we're fine". **This is a live inconsistency, present today, that a food-cost
report would inherit and amplify.**

**Recommended denominator:** `sum(subtotal_paisa) - sum(discount_paisa)` from `sales_order_facts` —
menu revenue actually earned, excluding tax (a pass-through to FBR, never revenue) and excluding
service charge (a labour recovery, not food revenue). Whichever is chosen, the report must **name
it on its own face** — "Food cost as % of net sales (ex-tax, ex-service-charge, after discounts)" —
because a bare percentage with an unstated denominator is exactly the class of defect this
codebase has already paid for.

One wrinkle to check before writing the SQL: `sales_order_facts.discount_paisa` is the order-level
total, and `sales_discount_facts` now carries the same money at discount grain (`V004`). Summing
both is a double count. Use one, and say which.

### 5.2 Tables and joins

Everything is already in `clickhouse_analytics`; **no cross-database join is required.**

- **Numerator:** `sales_item_facts.cogs_paisa` — currently 100% NULL (§6).
- **Denominator:** `sales_order_facts` (`subtotal_paisa`, `discount_paisa`).

The two facts share `(tenant_id, branch_id, business_date, order_id)`, which is the leading prefix
of both `ORDER BY` keys (`V001:61`, `V001:89`) — so the join is a prefix seek, cheap by design.

Do **not** join row-to-row. Aggregate each side independently, then divide — a join between an
order-grain fact and an item-grain fact fans out the order money by the number of lines:

```sql
-- shape only; the NULL guard below is mandatory, see §5.4
SELECT d.business_date,
       c.cogs_paisa,
       d.net_sales_paisa
FROM (
  SELECT business_date,
         sum(subtotal_paisa) - sum(discount_paisa) AS net_sales_paisa
  FROM clickhouse_analytics.sales_order_facts
  WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
  GROUP BY business_date
) d
LEFT JOIN (
  SELECT business_date,
         countIf(cogs_paisa IS NULL)     AS uncosted_lines,
         count()                          AS total_lines,
         if(countIf(cogs_paisa IS NOT NULL) = 0, NULL, sum(cogs_paisa)) AS cogs_paisa
  FROM clickhouse_analytics.sales_item_facts
  WHERE tenant_id = ? AND branch_id = ? AND business_date BETWEEN ? AND ?
  GROUP BY business_date
) c USING (business_date)
```

### 5.3 Period grain

`business_date` is a `Date` and every fact is partitioned `toYYYYMM(business_date)` (`V001:60, 88`).
It is already the branch-local business day with the 4-hour offset (`V001:26-28`), so a 02:00 close
files to the previous trading day correctly — day grain is honest with no extra work.

- **day** — `GROUP BY business_date`. Free.
- **week** — `GROUP BY toMonday(business_date)`. Cheap, but the week-start convention must be a
  stated tenant setting, not a ClickHouse default. Restaurants routinely run Mon–Sun or Wed–Tue.
- **month** — `GROUP BY toStartOfMonth(business_date)`. Aligns with the partition key.

**Day grain is where food cost % is most volatile and most misleading**: one bulk delivery, one
147-cover banquet, or one stock count posting on a Tuesday moves a single day by tens of points.
The comparable practice is a rolling window. Ship **week and month first**; if day grain ships, it
needs a visible "single-day figures are volatile" caveat — a legitimate use of `dataNotes`.

`MAX_RANGE_DAYS = 400` (`ReportService.java:36`) already allows 13 months, enough for a
year-over-year month comparison.

### 5.4 The honesty rules this report must obey

1. **Never divide by an unguarded numerator.** Wrap COGS in the `countIf(... IS NOT NULL) = 0`
   idiom, then let the percentage be NULL when COGS is NULL. `NULL / x` must not become `0%`.
2. **Guard the denominator.** `if(net_sales_paisa = 0, NULL, …)` — the `average-order-value`
   precedent at `DashboardTileService.java:152-154`. Zero sales days exist (closures); "food cost
   was 0%" on such a day is a lie, and division by zero in ClickHouse yields `inf`/`nan`, which
   serialises to something the frontend's `z.number()` will either reject or render as `Infinity`.
3. **Report coverage, do not hide it.** Return `uncosted_lines` and `total_lines` as real columns.
   A day where 40% of lines had no recipe produces a food cost % that is *arithmetically* fine and
   *materially* meaningless. Partial coverage must degrade to a `dataNotes` entry naming the
   fraction — or, better, to NULL below a coverage threshold. `DEPLETION_INCOMPLETE`
   (`InventoryEventContract.java:91-93`) already exists precisely to flag orders whose lines had no
   recipe; that signal must reach this report.
4. **Compute the ratio in integer paisa, present as a percentage at the edge.** Same discipline as
   every other money figure here (`PROJECT.md`: never Double/Float/Decimal for money; the paisa→
   rupee conversion happens once, at display — `owner-dashboard.tsx:127`).

---

## 6. Actual vs theoretical food cost — what the system can support

There are two different numbers and a restaurant wants both. The gap between them **is** the
finding: theoretical says what the recipes say it should have cost; actual says what the storeroom
says it did cost. The difference is waste, theft, over-portioning and yield loss.

### 6.1 The good news: the inventory domain is built, and it computes COGS

The comments in reporting-service ("Phase 8 has not started",
`SalesFactWriter.java:100-102`; "`grep -rn "STOCK_DEPLETED" services/` returns zero matches",
`V001__analytics_facts.sql:30-32`) are **stale**. Re-running that grep today:

```
$ grep -rn "STOCK_DEPLETED" --include="*.java" services/ shared-lib/
services/inventory-service/.../DepletionService.java:216,220,221
services/finance-service/.../consumer/StockDepletedConsumer.java:15,25
services/finance-service/.../FinanceRabbitConfig.java:40,57
shared-lib/.../InventoryEventContract.java:35,46,57,91
… plus 8 integration tests
```

`inventory-service` has 22 domain models, 24 repositories and 30 services, including
`DepletionService`, `MacCalculator`, `RecipeService`, `StockCountService`, `WastageService`,
`TransferService`, `OpeningBalanceService`, `ReceiptService`, `RecipeCostPreviewService`.

`DepletionService.deplete(...)` on every `ORDER_CLOSED`:
- resolves the effective recipe at `closedAt` (`:105`),
- converts each line to base qty (`:139`),
- walks lots FEFO (`:174`),
- values COGS at the **aggregate moving-average cost**, never a lot's own receipt price
  (`:181`, `computeCogsPaisa`),
- writes a signed-negative `DEPLETION` row to `inventory_movements` with `unit_cost_paisa`,
  `total_cost_paisa`, `reference_type='ORDER_CLOSED'`, `reference_id=orderId` (`:184-193`),
- publishes `STOCK_DEPLETED` through the transactional outbox (`:216-224`).

`finance-service` already consumes it and posts DR COGS / CR Inventory
(`autopost/consumer/StockDepletedConsumer.java:15`), with a hard reconciliation guard
(`AutoPostingRecipeEngine.java:245-249`).

**COGS is being computed and posted to the general ledger today. Reporting simply never hears about
it.**

### 6.2 ACTUAL food cost — supportable, at branch/period grain

`inventory_movements` (`services/inventory-service/src/main/resources/db/migration/
V1__inventory_schema.sql:153-179`) is a complete typed, costed, tenant-RLS'd ledger:

```sql
movement_type VARCHAR(24) NOT NULL
    CHECK (movement_type IN ('OPENING_BALANCE','RECEIPT','DEPLETION','TRANSFER_OUT',
                              'TRANSFER_IN','COUNT_VARIANCE','WASTAGE','TRANSFER_VARIANCE')),
qty              NUMERIC(18,4) NOT NULL,
unit_cost_paisa  NUMERIC(18,4) NOT NULL DEFAULT 0,   -- widened by V12
total_cost_paisa BIGINT        NOT NULL DEFAULT 0,
reference_type   VARCHAR(40),
reference_id     UUID,
movement_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
INDEX idx_inventory_movements_branch_time (tenant_id, branch_id, movement_at)
```

All eight movement types are actually written — verified:
`OPENING_BALANCE` (`OpeningBalanceService.java:82`), `RECEIPT` (`ReceiptService.java:93`),
`DEPLETION` (`DepletionService.java:188`), `TRANSFER_OUT` / `TRANSFER_IN`
(`TransferService.java:144, 256`), `COUNT_VARIANCE` (`StockCountService.java:146`),
`WASTAGE` (`WastageService.java:114`).

So the classic **opening + purchases − closing** identity has every term:

| term | source |
|---|---|
| opening stock value | `ingredient_branch_stock` at period start, or the running ledger balance |
| purchases | `RECEIPT` movements (from GRN) |
| transfers in/out | `TRANSFER_IN` / `TRANSFER_OUT` — essential for multi-branch, or one branch eats another's cost |
| wastage | `WASTAGE` movements, separately costed |
| count adjustments | `COUNT_VARIANCE`; `stock_count_lines.variance_cost_paisa` (`V1:255`) carries the money |
| closing stock value | `ingredient_branch_stock.qty_on_hand × avg_cost_paisa` (`V1:64-65`, `avg_cost_paisa` now `NUMERIC(18,4)` per `V12`) |

Grain: **branch × period**, and it is bounded below by how often the tenant posts a stock count
(`stock_counts.posted_at`, `V1:233`). Actual food cost is not computable per menu item, per hour or
per order — nobody's is. That is a property of the physical world, not a gap in this system.

Precision caveat worth carrying into any valuation SQL: `V12__unit_cost_precision.sql` widened
*rates* to `NUMERIC(18,4)` and deliberately left *amounts* as `BIGINT` (`V12:18-21`). It documents
the exact defect it fixed — a 3.2% valuation error propagating into "moving-average cost, and from
there into COGS, food-cost % and gross margin". Any new valuation expression must multiply the
decimal rate by the quantity and round **once**, at the boundary, exactly as
`MacCalculator.extendedCostPaisa` does (`DepletionService.java:296-298`).

### 6.3 THEORETICAL food cost — supportable, at menu-item grain

`recipes` / `recipe_lines` are versioned and time-resolved
(`RecipeService.resolveEffectiveRecipe(menuItemId, closedAt)`, used at `DepletionService.java:105`),
and `RecipeCostPreviewService` already computes plate cost from the *same* `avg_cost_paisa` the
depletion ledger uses — stated at `RecipeCostPreviewService.java:34-37`: *"so the authoring estimate
and the depletion ledger always agree on one number."*

So theoretical cost is: `Σ(recipe line base qty × ingredient avg_cost_paisa) × qty sold`, joined to
`sales_item_facts` by `menu_item_id`. Grain: **menu item**, which is exactly what an owner wants —
"which dishes are costing me".

Its honesty caveat is built in: `RecipeCostPreviewService.java:38-44` — a line with an unknown
ingredient, an unknown UOM, a dimension mismatch, or a never-costed ingredient is **excluded from
the total and reported with a warning**, not silently priced at zero. A theoretical-cost report must
carry that same exclusion count forward into `dataNotes`.

### 6.4 Verdict

| number | grain | supportable today? | blocked by |
|---|---|---|---|
| Theoretical food cost | menu item | **Yes** — data exists in `inventory-service` | no pipeline into ClickHouse |
| Actual food cost | branch × period | **Yes** — full costed movement ledger | no pipeline into ClickHouse; needs a posted stock count to bound the period |
| Variance (actual − theoretical) | branch × period | **Yes**, once both land | both of the above |
| `sales_item_facts.cogs_paisa` | order line | **No** — see B1 | the event contract, structurally |

---

## 7. Blockers to honest COGS, in order of severity

### B1 — `STOCK_DEPLETED` cannot fill `sales_item_facts.cogs_paisa`. Structural, not a wiring gap.

`sales_item_facts` is **order-line grain**: `ORDER BY (tenant_id, branch_id, business_date,
order_id, line_no)` (`V001:89`), where `line_no` is the array index of the item in
`OrderClosedPayload.items` (`SalesFactWriter.java:87-93`).

`StockDepletedPayload` (`InventoryEventContract.java:67`) is:

```java
public record StockDepletedPayload(UUID orderId, List<DepletedLine> lines, long totalCogsPaisa) {}
public record DepletedLine(UUID ingredientId, BigDecimal qtyBaseDepleted, long cogsPaisa,
                           String cogsAccountCode, String inventoryAccountCode) {}   // :80
```

`lines` is **per ingredient**, not per sold line. And the attribution is destroyed *before*
publication, inside `DepletionService`, at `:141`:

```java
requiredByIngredient.merge(line.getIngredientId(), effectiveQty, BigDecimal::add);
```

Every menu item's recipe requirement is summed into one map keyed by `ingredientId`. By the time
`depletedLines` is built (`:210-213`), which dish consumed which gram is gone. The event carries
`orderId` and a single `totalCogsPaisa` — **order grain**.

Compounding it: `PosEventContract.ItemEntry` (`:136-142`) is
`(menuItemId, name, qty, unitPricePaisa, lineTotalPaisa)` — it has **no line id**. So even a
menu-item-keyed COGS map could not be attributed when the same dish appears twice on one check
(two rows, different `line_no`, identical `menu_item_id`).

**Consequence.** Filling `cogs_paisa` at its declared grain requires changing the contract —
`DepletedLine` gaining a `menuItemId` (or a parallel per-sold-line breakdown), and `ItemEntry`
gaining a stable line identity. That is a cross-service change touching `shared-lib`,
`inventory-service`, `finance-service` (whose reconciliation guard at
`AutoPostingRecipeEngine.java:245` asserts on `totalCogsPaisa`) and `pos-service`.

**Do not shortcut this by pro-rating order COGS across lines by revenue share.** A revenue-weighted
allocation manufactures a per-item cost the system never measured and makes low-margin items look
identical to high-margin ones — it would produce a plausible, wrong, *actionable* number, which is
the exact defect class in the commit log. If per-item COGS is out of scope, put COGS at **order
grain** (a new column on `sales_order_facts`, or a new `order_cogs_facts` table), leave
`sales_item_facts.cogs_paisa` NULL and honest, and let `sales-by-item` keep showing `—`.

### B2 — There is no pipeline at all from inventory to reporting.

`ReportingRabbitConfig.java:12-22`, verbatim: *"Consumes EXACTLY the three real, currently
publishing events this phase is scoped to — ORDER_CLOSED, TILL_CLOSED, VENDOR_INVOICE_MATCHED.
Deliberately declares NO binding to the inventory exchange…"*

Three queues, three bindings, all to `pos.topic` and `purchasing.topic` (`:26-31, 53-56, 68-71`).
There is no consumer, no queue, no binding, no Feign client and no scheduled pull that would bring
any inventory figure into ClickHouse. `reporting-service`'s only Feign client is
`UserInternalClient` (branch NTN lookup). `inventory-service` exposes **no COGS endpoint** either —
`grep -rn "cogs\|Cogs" inventory-service/.../web/ .../dto/` returns **zero** matches.

Also missing downstream: `nlq_allowed_tables` seeds only the four original fact tables per role
(`nlq-service/.../V1__nlq_schema.sql:15-30`) and the ClickHouse `nlq_readonly` user is granted
`SELECT` on only those four (`deploy/clickhouse/V002__nlq_readonly_user.sql:69-72`). Any new
COGS fact table needs an entry in **both** or NLQ silently cannot see it.

### B3 — The "not yet available" disclaimer is hardcoded in three places and will become the lie.

1. `ReportService.java:80-82` — `"sales-by-item".equals(code)` → always emits the Phase-8 note.
2. `ReportTable.tsx:83-85` — if a report has a COGS column and sent no notes, the UI **invents**
   the sentence.
3. `owner-dashboard.tsx:175` — `value="—"` is a literal; the tile cannot display a number.

None of the three is derived from the data. The moment real COGS lands, all three keep asserting it
does not exist. Making the note condition-derived — the `FbrTaxSummaryService.java:106-126` pattern,
where a note is appended only on an observed failure — is a prerequisite, not a follow-up.

### B4 — The NULL guard is all-or-nothing and will silently under-report on partial coverage.

`if(countIf(cogs_paisa IS NOT NULL) = 0, NULL, sum(cogs_paisa))` fires only when a group is
**entirely** uncosted. Today that is every group, so it is safe. The day recipes cover 80% of the
menu, a group with 9 costed lines and 1 uncosted line returns the sum of 9 — presented as if it
were the cost of 10. Food cost % computed from it is understated by the missing lines, and nothing
anywhere flags it. The frontend has the same hole (`owner-dashboard.tsx:98`,
`itemRows.every(... == null)`).

`inventory-service` already publishes the signal that fixes this — `DEPLETION_INCOMPLETE`
(`InventoryEventContract.java:91-93`, `DepletionService.java:229-237`), raised whenever a sold line
had no effective recipe or an unconvertible UOM. Nothing consumes it in reporting.
**Any COGS report must return non-NULL and NULL line counts as first-class columns and degrade via
`dataNotes` (or to NULL) below a coverage threshold.**

### B5 — "Net sales" already means three different things, and food cost % would inherit the wrong one.

Detailed in §5.1. The dashboard tile labelled "Net sales" sums `total_paisa` — **gross of tax and
service charge** (`owner-dashboard.tsx:90`), while the FBR report's "taxable sales" sums
`subtotal_paisa` (`FbrTaxSummaryService.java:74-76`). Using the dashboard's figure as the food-cost
denominator understates the percentage by the full tax rate. This must be settled and named on the
report's face before any percentage ships.

### Two lesser issues found in passing

- **`ClickHouseSchemaGuard` does not guard `sales_discount_facts`.** `REQUIRED_FACT_TABLES`
  (`config/ClickHouseSchemaGuard.java:24-25`) lists the four `V001` tables; `V004` added a fifth
  that `discount-summary` reads. If `V004` was not applied, the service boots clean (its whole
  purpose is to refuse to, `:14-18`) and `discount-summary` fails at query time instead. Any new
  COGS fact table must be added to this list.
- **Five of seven reports have no integration test.** `ReportServiceIT` covers `sales-by-day` (×2),
  `sales-by-item` and the run log. `sales-by-hour`, `sales-by-order-type`, `discount-summary`,
  `till-sessions` and `purchases-by-po` have none.

---

## 8. What must be preserved

Anything built on top of this layer must keep every one of these intact:

1. `countIf(... IS NOT NULL) = 0 → NULL` on every nullable measure — and extend it to a
   **coverage-aware** form (B4).
2. `null` written, never `0` (`SalesFactWriter.java:100-107`); `Nullable(Int64)` in DDL.
3. `dataNotes` derived from an **observed condition**, never from a hardcoded report code (B3).
4. `—` in the UI, never `0`, never blank (`ReportTable.tsx:26-34`); `z.number().nullable()` and
   never `.default(0)` (`reporting.schema.ts:28-33`).
5. Divide-by-zero → `null`, not `0` (`DashboardTileService.java:152-154`).
6. Drop the tile rather than fake it (`DashboardTileService.java:34-37`).
7. Reconcile lines to header and **throw** on mismatch (`AutoPostingRecipeEngine.java:245-249`).
8. Money is integer paisa end to end; rates carry decimals; round **once**, at the rate→amount
   boundary (`V12__unit_cost_precision.sql:18-21`).
9. Rename or drop a report rather than ship it against data that cannot support it
   (`ReportCatalog.java:15-22`).
10. `tenant_id` from `TenantContext` only, written once per report, `branch_id` resolved
    server-side (`ReportService.java:63-66, 99-107`).
