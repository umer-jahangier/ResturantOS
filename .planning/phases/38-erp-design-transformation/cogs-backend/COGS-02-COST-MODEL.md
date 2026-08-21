# COGS-02 — The Recipe & Ingredient Cost Model (measured)

**Repo:** `/Users/muhammadumer/Documents/Projects/ResturantOS-ui38` — branch `phase-38-demo-calibrated-ui`
**Method:** read-only. No source modified, no Maven, no build, no `git stash`. Every claim below
cites `file:line` or the exact command whose output proved it. Absences are proven with the
command, not asserted.

---

## 1. The domain model — every entity, table and column

All recipe/ingredient tables live in **`inventory_db`** (inventory-service), created by
`services/inventory-service/src/main/resources/db/migration/V1__inventory_schema.sql` and extended
additively by V6, V7, V12, V13. Every one is `ENABLE` + `FORCE ROW LEVEL SECURITY` with a
`tenant_isolation` policy on `app.current_tenant_id`.

### 1.1 `units_of_measure` — the unit registry
`V1__inventory_schema.sql:15-33`, `V7__uom_measure_type.sql:19-67`, `V13__uom_archived_at.sql:21-31`
Entity: `domain/model/UnitOfMeasure.java`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL | RLS key |
| `code` | VARCHAR(20) NOT NULL | `uq_uom_tenant_code` (V1) + `uq_uom_tenant_code_ci` on `upper(code)` (V7:62) |
| `name` | VARCHAR(120) NOT NULL | |
| `base_unit_code` | VARCHAR(20) NULL | NULL **means this unit IS its family base** (`IngredientUomFactorResolver.familyBaseCode`, `IngredientUomFactorResolver.java:99-101`) |
| `to_base_factor` | NUMERIC(18,8) NOT NULL DEFAULT 1 | converts into the *family* base, **not** into an ingredient's stock unit |
| `measure_type` | VARCHAR(10) NOT NULL DEFAULT 'COUNT' | V7; CHECK `WEIGHT/VOLUME/COUNT` |
| `archived_at` | TIMESTAMPTZ | V13 — retire, never delete |
| audit | `created_at/updated_at/created_by/updated_by/deleted_at` | |

No migration seeds this table (it is tenant-scoped under FORCE RLS and Flyway sets no tenant GUC —
stated at `V7__uom_measure_type.sql:14-16`). Seeding is `UomProvisioningService` from
`StandardUomCatalog.ALL` (`service/StandardUomCatalog.java:57-77`): 14 units in 3 families —
WEIGHT base `G` (KG 1000, MG 0.001, LB 453.59237, OZ 28.34952313), VOLUME base `ML`
(L 1000, FLOZ 29.57352956, CUP 240, TBSP 15, TSP 5), COUNT base `EACH` (DOZEN 12, PAIR 2).

### 1.2 `ingredients` — the item master
`V1__inventory_schema.sql:36-56` + `V6__ingredient_master_data.sql:13-42`
Entity: `domain/model/Ingredient.java`

| Column | Type | Origin | Notes |
|---|---|---|---|
| `id`, `tenant_id` | UUID | V1 | |
| `name` | VARCHAR(160) NOT NULL | V1 | |
| `sku` | VARCHAR(60) | V1 | unique per tenant |
| `base_uom_code` | VARCHAR(20) NOT NULL | V1 | **the STOCK unit** — `qty_on_hand` and `avg_cost_paisa` are denominated in it (`IngredientUomFactorResolver.java:52-54`) |
| `recipe_uom_code` | VARCHAR(20) | V6:27 | recipe-authoring default only |
| `measure_type` | VARCHAR(10) NOT NULL DEFAULT 'COUNT' | V6:23 | locked once any movement exists |
| `item_type` | VARCHAR(20) NOT NULL DEFAULT 'PURCHASED' | V6:18 | `PURCHASED/PREPARED/BOTH` |
| `produced_by_recipe_id` | UUID | V6:20 | prep/sub-recipe hook — **authoring UI deferred** (V6:52-57) |
| `default_yield_pct` | NUMERIC(6,2) NOT NULL DEFAULT 100.00 | V6:33 | item-level AP→EP trim yield |
| `reorder_point`, `par_level` | NUMERIC(18,4) | V1 / V6:34 | |
| `category` (free text) / `category_id` | VARCHAR(80) / UUID | V1 / V5 | |
| `storage_location`, `storage_location_id`, `shelf_life_days`, `is_perishable`, `short_name`, `description` | | V6 / V10 | |
| `archived_at` | TIMESTAMPTZ | V6:40 | archive, never delete |

**There is no cost column on `ingredients`.** No standard cost, no last price, no target cost.
Verified: `V1__inventory_schema.sql:36-51` and `V6__ingredient_master_data.sql:13-40` list every
column, and none is a cost.

### 1.3 `ingredient_branch_stock` — where the ONLY ingredient cost lives
`V1__inventory_schema.sql:59-73`, retyped by `V12__unit_cost_precision.sql:28-30`
Entity: `domain/model/IngredientBranchStock.java`

| Column | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `branch_id`, `ingredient_id` | UUID | unique on (tenant, branch, ingredient) |
| `qty_on_hand` | NUMERIC(18,4) NOT NULL DEFAULT 0 | may go negative (oversell, D-02) |
| **`avg_cost_paisa`** | **NUMERIC(18,4) NOT NULL DEFAULT 0** | moving-average cost of ONE stock unit. A **rate**, not an amount — `V12__unit_cost_precision.sql:52-54` |
| `last_counted_at` | TIMESTAMPTZ | |

This single mutable column is the whole cost model. It is **per branch**, **current-value-only**,
and **overwritten in place**.

### 1.4 `stock_lots` — FEFO quantities (and a per-lot receipt cost that COGS deliberately ignores)
`V1__inventory_schema.sql:81-104`, `V12:33-35`

`qty`, `expiry_date`, `receipt_unit_cost_paisa NUMERIC(18,4)`, `received_at`, `source_movement_id`.
FEFO governs *which lot quantities drop*; MAC governs *what number posts as COGS* — never the lot's
own cost. Stated at `DepletionService.java:180` and `InventoryEventContract.java:58-62`, enforced by
`DepletionService.computeCogsPaisa` taking only the aggregate average
(`DepletionService.java:265-280`).

### 1.5 `recipes` — the version header
`V1__inventory_schema.sql:107-129` + `V6__ingredient_master_data.sql:64`
Entity: `domain/model/Recipe.java`

| Column | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `menu_item_id` | UUID | `menu_item_id` is a **soft cross-service reference** into pos_db |
| `version` | INT NOT NULL | unique per (tenant, menu_item) |
| `is_current` | BOOLEAN NOT NULL DEFAULT true | **never used for resolution** — see below |
| `effective_from` | TIMESTAMPTZ NOT NULL | the resolution key |
| `yield_servings` | NUMERIC(18,4) NOT NULL DEFAULT 1 | batch → portion divisor |
| `name` | VARCHAR(160) | |
| `net_yield_pct` | NUMERIC(6,2) NOT NULL DEFAULT 100.00 | V6:64 — cooking/reduction loss, **modelled but never read** |

Resolution is by `effective_from <= atInstant`, most-recent-first, deliberately **not** by
`is_current` (`RecipeService.resolveEffectiveRecipe`, `RecipeService.java:103-112`; depletion passes
the order's `closedAt`, `DepletionService.java:103`). Coverage classification also refuses
`is_current` (`RecipeService.java:121-128`).

`net_yield_pct` is dead. Proven:
```
$ grep -rn "netYieldPct\|net_yield_pct" --include="*.java" --include="*.ts" --include="*.tsx" .
services/inventory-service/src/test/java/io/restaurantos/inventory/SchemaMigrationIT.java:127
services/inventory-service/src/test/java/io/restaurantos/inventory/SchemaMigrationIT.java:134
```
Two hits, both inside a schema-guard integration test asserting the column still exists. No entity
field, no service, no DTO, no frontend. `V6:52-57` states the deferral explicitly.

### 1.6 `recipe_lines` — the BOM
`V1__inventory_schema.sql:132-150`
Entity: `domain/model/RecipeLine.java`

| Column | Type | Notes |
|---|---|---|
| `id`, `tenant_id`, `recipe_id` (FK → recipes) | UUID | |
| `ingredient_id` | UUID NOT NULL | **no FK** (same DB, but none declared) |
| `qty` | NUMERIC(18,4) NOT NULL | |
| `uom_code` | VARCHAR(20) NOT NULL | stored in the *resolved registry casing*, not the request's (`RecipeService.java:214-217`) |
| `yield_pct` | NUMERIC(6,2) NOT NULL DEFAULT 100 | per-line trim/waste |

**No cost column.** A recipe line never stores what it cost — not at authoring time, not at any
later time. Cost is always recomputed from live `avg_cost_paisa`.

### 1.7 The three yield numbers (D-07), and which are actually consumed

| Yield | Column | Consumed by cost? |
|---|---|---|
| Item-level AP→EP trim | `ingredients.default_yield_pct` (V6:33) | **No** — `RecipeCostPreviewService` and `DepletionService` never read it |
| Per-recipe-line waste | `recipe_lines.yield_pct` | **Yes** — `UomConverter.java:38,42` divides by `yieldPct/100` |
| Recipe-header reduction loss | `recipes.net_yield_pct` (V6:64) | **No** — dead (proof above) |

Batch→portion division is by `recipes.yield_servings`
(`RecipeCostPreviewService.java:124-128`, `UomConverter.java:42`).

### 1.8 `ingredient_uom_conversions` — item-scoped cross-dimension bridges (built, never consulted by cost)
`V6__ingredient_master_data.sql:71-92`: `ingredient_id`, `from_uom_code`, `to_uom_code`,
`factor NUMERIC(18,9) CHECK (factor > 0)`, `note`. Intended for density, each-weight and pack-size
(V6:67-70).

**No cost or depletion path reads it.** Proven:
```
$ grep -rn "IngredientUomConversionRepository\|ingredientUomConversionRepository" \
    --include="*.java" services/ | grep -v "/test/"
repository/IngredientAllergenRepository.java:24   (a comment)
repository/IngredientUomConversionRepository.java:16  (the interface itself)
service/IngredientService.java:24,83,96           (import, field, constructor)
$ grep -n "conversionRepository\." services/.../IngredientService.java
475:  countByUomCodeEitherSide      # UOM-archive guard
728:  deleteByTenantIdAndIngredientId  # CRUD
740:  save                             # CRUD
801:  findByTenantIdAndIngredientIdIn  # list rendering
```
`RecipeCostPreviewService`, `DepletionService` and `GrnUomResolver` all route through
`IngredientUomFactorResolver`, which takes only two `UnitOfMeasure` rows and never touches this
table (`IngredientUomFactorResolver.java:59-92`).

### 1.9 `menu_item_catalog` — the price side of food-cost %
`V4__menu_item_catalog.sql:12-36`. A read-model of pos-service's menu, written only by
`MenuItemCatalogConsumer` → `MenuItemCatalogService.java:45`. Carries `menu_item_id`, `name`,
`category_id/name`, `active`, `base_price_paisa BIGINT`. `MENU_ITEM_DELETED` only flips `active`
(V4:10-11).

---

## 2. How an ingredient's COST is stored and updated

**It is a weighted moving average (MAC), current-value-only, per branch.** Not standard cost, not
last purchase price, not FIFO/LIFO.

`MacCalculator.recomputeAvgCostPaisa` (`service/MacCalculator.java:29-50`):
```
newAvg = (oldQty*oldAvg + recvQty*recvCost) / (oldQty + recvQty), scale 4, HALF_UP
```
with a D-02 oversell reset: a receipt landing on `oldQty <= 0` **replaces** the average with the
receipt's own unit cost rather than blending (`MacCalculator.java:41-45`).

Every writer of `avg_cost_paisa` (`grep -rn "setAvgCostPaisa" --include="*.java" services/ | grep -v /test/`):

| Site | Effect |
|---|---|
| `ReceiptService.java:73` | GRN / manual receipt — blends via MacCalculator |
| `OpeningBalanceService.java:63` | opening balance — blends |
| `TransferService.java:240` | inbound inter-branch transfer — blends at the *shipping* branch's MAC |
| `ReceiptService.java:126`, `DepletionService.java:308`, `StockCountService.java:292`, `WastageService.java:339`*, `TransferService.java:339` | `newStockRow(...)` constructors only — initialise a fresh row to 0 |

(*`WastageService.java:195` is the `newStockRow` helper; its cost read is at line 101.)

So: **only receipts, opening balances and transfers-in move the cost.** Depletion, stock counts and
wastage consume it and never change it (`DepletionService.java:181`, `StockCountService.java:123`,
`WastageService.java:101` all read `getAvgCostPaisa()` and write only quantities).

Precision history matters here: V12 retyped `avg_cost_paisa`, `receipt_unit_cost_paisa`,
`inventory_movements.unit_cost_paisa`, `stock_transfer_lines.unit_cost_paisa` and
`stock_wastage_lines.unit_cost_paisa` from `BIGINT` → `NUMERIC(18,4)`, because a per-unit cost is a
**rate**. `V12__unit_cost_precision.sql:8-15` records the measured error: PKR 62/kg stored as
6 paisa/g instead of 6.2 — a 3.2% valuation error compounded into MAC, COGS, food-cost % and
margin. Totals (`total_cost_paisa`, every `*_cost_paisa` on the wire) stay `BIGINT` (V12:17-20).
The rate→amount boundary is crossed in exactly one function,
`MacCalculator.extendedCostPaisa` (`MacCalculator.java:52-62`).

---

## 3. THE DECISIVE QUESTION — is there any historical cost record?

### 3.1 There is no cost-history table, and no versioning on the cost column

```
$ grep -rn "cost_history\|price_history\|avg_cost.*history\|CREATE TABLE.*history" --include="*.sql" .
(no output)
```
`avg_cost_paisa` is a single mutable `NUMERIC(18,4)` column on `ingredient_branch_stock`, updated
in place at `ReceiptService.java:73`, `OpeningBalanceService.java:63`, `TransferService.java:240`.
Nothing writes the prior value anywhere. **You cannot ask "what was the average cost of salmon on
7 August" from the cost model itself. That number is gone the moment the next receipt lands.**

### 3.2 There IS a dated, append-only cost *event* ledger — `inventory_movements`

`V1__inventory_schema.sql:153-179`, `V12:38-40`; entity `domain/model/InventoryMovement.java`.

| Column | Type |
|---|---|
| `tenant_id`, `branch_id`, `ingredient_id` | UUID |
| `movement_type` | VARCHAR(24) CHECK IN (`OPENING_BALANCE`,`RECEIPT`,`DEPLETION`,`TRANSFER_OUT`,`TRANSFER_IN`,`COUNT_VARIANCE`,`WASTAGE`,`TRANSFER_VARIANCE`) |
| `qty` | NUMERIC(18,4) — signed (depletion negates, `DepletionService.java:189`) |
| **`unit_cost_paisa`** | NUMERIC(18,4) — the MAC **as it stood at that instant** (`DepletionService.java:190`) |
| **`total_cost_paisa`** | BIGINT — the extended amount, i.e. the COGS posted (`DepletionService.java:191`) |
| `reference_type` / `reference_id` | `'ORDER_CLOSED'` / **the orderId** (`DepletionService.java:192-193`) |
| `movement_at` | TIMESTAMPTZ NOT NULL DEFAULT now() |

Index: `idx_inventory_movements_branch_time (tenant_id, branch_id, movement_at)` (V1:179).
Nothing in the codebase updates or deletes a movement row — the only writes are `save(...)` of a
freshly-constructed entity.

**This is the honest historical record, and it already exists.** A DEPLETION row *is* a dated,
audited COGS fact: this many stock units of this ingredient left this branch at this rate at this
instant against this order.

### 3.3 …but the answer to the literal question is still **no**, for three reasons

1. **The ledger is sparse and event-shaped, not a cost time series.** It records the cost at the
   moments stock moved. If no salmon moved on 7 August, there is no 7-August row. You can
   *reconstruct* the prevailing MAC by taking the last movement at or before that date — but that
   is an inference from the ledger, not a stored dated cost, and it silently returns nothing for an
   ingredient with no prior movement.
2. **There is no query to do it.** `repository/InventoryMovementRepository.java` (whole file, 31
   lines) exposes exactly three methods: `findByReferenceId(UUID)`,
   `existsByTenantIdAndIngredientId`, and `findDistinctIngredientIdsByTenantIdAndIngredientIdIn`.
   **No time-bounded query exists.** `findByReferenceId(orderId)` is, however, precisely the seam a
   backfill would use.
3. **Retroactive edits to the cost model are not versioned.** `recipe_lines` carries no cost
   snapshot (§1.6) and `avg_cost_paisa` carries no history (§3.1). Only the *recipe structure* is
   time-versioned (`recipes.effective_from`); the *prices* are not.

### 3.4 The one genuinely effective-dated price in the system is in a different database

`services/purchasing-service/src/main/resources/db/migration/V5__vendor_item_catalog.sql:56-86`
creates `vendor_item_prices`: `vendor_item_id`, `branch_id`, `unit_price_paisa BIGINT`,
`price_uom`, `effective_from`, `effective_to`, `source CHECK IN ('CATALOG','CONTRACT','INVOICE','MANUAL')`,
`is_contract_price`. The migration states it is append-only with no in-place UPDATE, expressly so
that "correct historical costing" is possible (V5:57-60).

Three caveats before anyone reaches for it:
- It lives in **purchasing_db**, a different database from inventory_db. No join is possible;
  `vendor_items.ingredient_id` is a documented soft cross-service reference (V5:18-20).
- It is a **vendor list price in the vendor's `price_uom`**, not the branch's blended consumption
  cost. Using it as COGS would change the accounting basis from MAC to something else, and would
  disagree with the journal entries finance has already posted from `STOCK_DEPLETED`.
- Many `vendor_items` may point at one ingredient (V5:43-45), so "the" price for an ingredient on a
  date is ambiguous.

### 3.5 Verdict

> **Historical margin CAN be computed honestly — but only for orders whose depletion actually ran,
> and only by reading `inventory_movements` DEPLETION rows, never by re-pricing history against
> today's `avg_cost_paisa`.**
>
> Re-pricing an August order at today's MAC would produce a number that looks computed and is not
> a measurement. There is no dated cost column to do it correctly, and the ledger that *is* correct
> is at the wrong grain (see §7).

---

## 4. Unit conversion — where it happens, and whether it is exact

### 4.1 The rule

`service/IngredientUomFactorResolver.java` — one function,
`factorToIngredientBase(fromUom, ingredientBaseCode, ingredientBaseUom)`:

```
factor = to_base_factor(fromUom) / to_base_factor(ingredientStockUom)      # line 90-91, scale 8, HALF_UP
```
with three short-circuits: same code (case-insensitive) → exactly `BigDecimal.ONE` (line 67-69);
stock unit absent from the registry but equal to the family base → `fromUom.toBaseFactor` unchanged
(line 73-80); different families → **`Optional.empty()`, never a guessed 1** (line 82-84).

Its javadoc records the measured defect this rule exists to kill
(`IngredientUomFactorResolver.java:19-27`): a 0.25 KG recipe line against a KG-stocked ingredient
was read as 250 (raw `to_base_factor`), driving `qty_on_hand` from 100 to −400 and posting
`JE ORDER_COGS 12,500,000 paisa` against revenue of 290,000 — a 4,310% food cost, with every event
and journal entry balancing.

### 4.2 The three call sites

| Path | Site | Behaviour on "no conversion" |
|---|---|---|
| Recipe cost preview | `RecipeCostPreviewService.java:180-185` | warns the line, excludes it from the batch total |
| Order depletion | `DepletionService.java:123-137` (via `ingredientStockUomFactor`, line 290-300) | skips the line, publishes `DEPLETION_INCOMPLETE` |
| Goods receipt | `GrnUomResolver.java:129-137` | **throws** `GrnUomUnresolvableException` → DLQ, no stock written |

`GrnUomResolver` is the grams/kg ↔ cases seam: it converts the vendor pack quantity and pack cost
into the ingredient's stock unit before `ReceiptService` touches anything
(`GrnUomResolver.java:83-90`). Its javadoc records two live defects: a 10 kg carton adding 10
instead of 10,000 grams and feeding the carton price in as the per-gram price, moving MAC from 50 →
222 paisa/g (`GrnUomResolver.java:24-28`); and a PO line with unit `FURLONG` receiving seven
furlongs as seven kilograms of Basmati Rice (`GrnUomResolver.java:43-47`).

### 4.3 Is it exact? — **No. It is lossy at three defined rounding boundaries.**

| Step | Scale | Mode | Where |
|---|---|---|---|
| family-ratio factor | 8 dp | HALF_UP | `IngredientUomFactorResolver.java:44, 91` |
| GRN qty → stock unit | 4 dp | HALF_UP | `GrnUomResolver.java:58, 87` |
| GRN pack cost → cost per stock unit | 4 dp | HALF_UP | `GrnUomResolver.java:60, 162` |
| `effective_base_qty` working / persisted | 8 dp then 4 dp | HALF_UP | `UomConverter.java:30-31, 43-44` |
| MAC blend | 4 dp | HALF_UP | `MacCalculator.java:25, 49` |
| rate × qty → whole paisa | 0 dp | HALF_UP | `MacCalculator.java:61` |

Exact for decimal-power conversions (KG→G = 1000, L→ML = 1000). Inexact for
`LB` (453.59237), `OZ` (28.34952313), `FLOZ` (29.57352956) — an OZ→G→KG round trip cannot return
the original value at 8 dp. Every rounding is HALF_UP, deliberately mirroring `MoneyUtils.fromPkr`
and never `MoneyUtils.taxPerLine`'s floor (`UomConverter.java:23-26`, `MacCalculator.java:8-9`).

The full formula (`UomConverter.effectiveBaseQty`, `UomConverter.java:36-45`):
```
effective_base_qty = (line.qty × factor × orderQty) / ((line.yield_pct / 100) × recipe.yield_servings)
```
Note the preview calls it with `orderQty = 1` (`RecipeCostPreviewService.java:203-204`).

### 4.4 Case sensitivity is a live hazard on the cost path

Unit codes "have never been normalised at rest" — fixtures write `KG`, live tenant rows can be `kg`
(`RecipeCostPreviewService.java:92-94`). The preview defends with a `TreeMap<>(String.CASE_INSENSITIVE_ORDER)`
(line 95) and the comment concedes "a missed lookup here now means a dropped line rather than a
wrong number, but it is still a dropped line." `DepletionService.java:114` uses
`unitOfMeasureRepository.findByCode(...)` and **throws** `IllegalStateException` on a miss, which is
a different failure mode on the same data.

---

## 5. Menu item → recipe: the join, and how many items actually have one

### 5.1 The join

`recipes.menu_item_id` → `menu_item_catalog.menu_item_id` → pos_db `menu_items.id`. There is no
FK: `menu_item_catalog` is an event-fed projection (`V4__menu_item_catalog.sql:3-8`), and the POS
menu is in a different database.

Resolution at sale time: `RecipeService.resolveEffectiveRecipe(menuItemId, closedAt)`
(`RecipeService.java:109-112`) → `recipeRepository.findEffectiveVersionsDesc(tenantId, menuItemId, atInstant)`,
first result. Depletion calls it with `payload.closedAt()` (`DepletionService.java:103`).

### 5.2 The count already exists as a first-class API

`RecipeService.getCoverage()` (`RecipeService.java:129-172`) returns
`CoverageResponse(totalActiveMenuItems, covered, scheduled, noRecipe, items, missing)`
(`RecipeDtos.java:139-145`), classified **only** by `effectiveFrom <= now` — three states
`COVERED / SCHEDULED / NO_RECIPE` (`RecipeDtos.java:113-129`). That is the count to use, per
tenant, per branch-agnostic active catalog. There is no SQL needed:
`GET` the coverage endpoint on `RecipeController`.

### 5.3 What the seed actually creates — a real number

There is **no SQL seed for recipes**:
```
$ grep -rn "INSERT INTO recipes\|INSERT INTO recipe_lines" -r .   →  (no output)
```
Seeding is API-driven, `scripts/seed_restaurantos.py`:
- Menu: `MENU` at `seed_restaurantos.py:1229-1234` contains **6 items** across 3 categories
  (Chicken Samosa, Seekh Kebab, Chicken Karahi, Mutton Biryani, Butter Naan, Fresh Lime). Tenant
  specs ask for 18 (line 149) and 3 (line 175), so a tenant gets `min(spec, 6)`.
- Ingredients: exactly **3** — `CHK-001 Chicken`, `RIC-001 Basmati Rice`, `SPC-001 Spice Mix`
  (line 1350), all stocked in `KG`.
- Recipes: **exactly one**, against `menu_item_ids[0]` only, with **one line**
  (`qty 0.25 KG, yieldPct 100`, name "Seed recipe") — `seed_restaurantos.py:1373-1379`.

> **A seeded demo tenant has 1 recipe covering 1 of up to 6 active menu items — roughly 17%
> coverage — and that recipe has a single ingredient line.** Even a perfect COGS pipeline would
> therefore produce a non-NULL `cogs_paisa` on about one sold line in six, and that figure would
> represent 0.25 kg of chicken standing in for an entire plate.

---

## 6. Modifiers and variants — does the model represent cost at all?

**No. Neither is represented anywhere in the cost model.**

**Modifiers** live in pos_db: `modifier_groups` and `modifiers`
(`services/pos-service/src/main/resources/db/migration/V1__pos_schema.sql:76-112`, tightened by
`V25__modifier_catalogue.sql`). The `modifiers` table's full column list (V1:96-108) is:
`id, tenant_id, modifier_group_id, name, price_delta_paisa, active` + audit.

- There is a **price** delta. There is **no** `ingredient_id`, no `recipe_id`, no cost delta, and no
  child table linking a modifier to any ingredient. Proven by the column list above and by
  `grep -rni "recipe" ... services/pos-service/src` returning no modifier/variant hit.
- `OrderPricingCalculator` sums the deltas into the line subtotal (`V25:11-12`), so "extra cheese
  +Rs 150" **increases revenue and cannot increase cost**. Every modifier is therefore implicitly
  100% margin.
- `PosEventContract.ItemEntry` (`shared-lib/.../PosEventContract.java:136-142`) carries
  `menuItemId, name, qty, unitPricePaisa, lineTotalPaisa` — **modifiers are not on the ORDER_CLOSED
  wire at all**, so even a downstream consumer could not cost them.
- Note `V25:48-49` records that both catalogue tables were empty in every tenant as of 2026-08-12.

**Variants** (size/portion — "large", "half") do not exist as a concept:
```
$ grep -rni "variant" services/pos-service/src/main/resources/db/migration/
```
returns only unrelated comment text about RLS invariants — no table, no column. A restaurant models
sizes as separate menu items today, each needing its own recipe.

---

## 7. What `RecipeCostPreviewService` returns null for, and why

`services/inventory-service/src/main/java/io/restaurantos/inventory/service/RecipeCostPreviewService.java`
— non-persisting (`@Transactional(readOnly = true)`, line 47; "never calls save/saveAll/delete/flush",
line 36). Endpoint `POST /api/v1/inventory/recipes/preview`
(`web/RecipeController.java:102-109`, branch-claim enforced at line 106-108).

### 7.1 Honest nulls (four of them)

| What | Condition | Line |
|---|---|---|
| `RecipeCostLineDto.lineCostPaisa` + `.sharePctOfBatch` = null, `warning` set | ingredient id unknown | 174-177 |
| same | UOM code unknown, or line unit's family ≠ ingredient stock unit's family (`factor.isEmpty()`) | 179-185 |
| same | ingredient never costed — **no stock row for this branch, or `avgCostPaisa == 0`** | 187-191 |
| `menuItemPricePaisa` = null | no `menuItemId` sent, catalog row absent, or `basePricePaisa == 0` | 149-156 |
| `foodCostPct` = null | exactly when `menuItemPricePaisa` is null | 158-164 |

The warning is one fixed string, `"Couldn't price this line — check the unit conversion for %s"`
(line 50). The DTO contract states the pairing explicitly: cost and share "are null exactly when
`warning` is non-null — a degraded line never carries a partial/misleading cost figure"
(`RecipeDtos.java:51-56`); and "`foodCostPct` is null whenever `menuItemPricePaisa` is null or zero"
(`RecipeDtos.java:66-70`, the lines the frontend audit cited).

That per-line discipline is exemplary. The aggregates are where it breaks.

### 7.2 The three aggregates that are NOT nullable — and are computed from incomplete inputs

`batchCostPaisa`, `portionCostPaisa` and `excludedLineCount` are primitives on the response record
(`RecipeDtos.java:71-78`): `long, long, BigDecimal, Long, BigDecimal, int, List`. They cannot be null.

1. **A partially-priced recipe yields a fully-confident-looking plate cost.** Warned lines are
   skipped from the accumulator (`RecipeCostPreviewService.java:116-120`) and `batchCostPaisa` is
   returned as a plain `long`. A 5-line recipe with 2 unpriceable lines returns the cost of the
   other 3 as *the batch cost*. The only signal is `excludedLineCount`.
2. **A fully-unpriceable recipe reports Rs 0.00, not "unknown".** If every line warns,
   `batchCost = 0` → `batchCostPaisa = 0` → `portionCostPaisa = 0` (line 124-125).
3. **…and then reports a 0.0% food cost.** With a menu price present, line 158-164 computes
   `0 / price × 100 = 0.0` and returns it — a non-null `BigDecimal`. The frontend renders any
   non-null value: `formatFoodCostPct` returns `"0.0%"` and only `null` becomes an em dash
   (`frontend/components/inventory/recipe-cost-panel.tsx:27-32, 91-102`). The panel shows
   `Batch cost Rs 0.00 / Cost per portion Rs 0.00 / Food cost % 0.0%` with a small
   `"N lines excluded from cost pending a fix"` note (line 108-115).

**"0.0% food cost" is a claim that a dish costs nothing to make.** It is the same failure class as
"the cart quoted every dine-in guest 5% low": nothing errors, every number is well-formed, and only
the meaning is wrong. The panel's own caption — "Estimated from current ingredient cost — actual
cost is set at depletion time" (line 105-107) — is honest about the *basis* but not about the
*completeness*.

---

## 8. Why `sales_item_facts.cogs_paisa` is NULL — the measured chain

The dashboard is not wrong to refuse. The chain is broken in a specific, identifiable place.

1. **COGS is computed correctly and is durable.** `DepletionService.deplete` writes a DEPLETION
   `inventory_movements` row per ingredient with `unit_cost_paisa` (the MAC at that instant),
   `total_cost_paisa` (the COGS), `reference_type='ORDER_CLOSED'`, `reference_id=orderId`
   (`DepletionService.java:184-194`), and publishes `STOCK_DEPLETED` with per-ingredient
   `cogsPaisa` and an order-level `totalCogsPaisa` (line 218-223).
2. **`STOCK_DEPLETED` has exactly one consumer, and it is finance.**
   ```
   $ grep -rn "DepletedLine\|StockDepletedPayload" --include="*.java" . | grep -v /test/
   shared-lib/.../InventoryEventContract.java:67,80,84
   finance-service/.../AutoPostingRecipeEngine.java:204,205,222
   finance-service/.../consumer/StockDepletedConsumer.java:44,45
   inventory-service/.../DepletionService.java:13,18,159,210,223
   ```
   `services/reporting-service/src/main/java/io/restaurantos/reporting/consumer/` contains exactly
   three consumers — `OrderClosedConsumer`, `TillClosedConsumer`, `VendorInvoiceMatchedConsumer`.
   **Reporting never subscribes to `STOCK_DEPLETED`.**
3. **The ETL therefore writes literal nulls.** `SalesFactWriter.java:100-107`:
   ```java
   null, // cogs_paisa
   null, // gross_margin_paisa
   null, // category_name
   ```
   with the comment "NULL means 'unknown' … 0 would falsely claim 'sold at cost', which is a lie an
   owner could act on. Never write 0 here."
4. **The DDL and the report guard were built for this.**
   `deploy/clickhouse/V001__analytics_facts.sql:80-83` declares both columns `Nullable(Int64)` and
   instructs reports to render "—". `ReportCatalog.java:88-89` forces an honest NULL with
   `if(countIf(cogs_paisa IS NOT NULL) = 0, NULL, sum(cogs_paisa))`.
5. **The dashboard tile is correct.** `frontend/components/dashboard/owner-dashboard.tsx:169-182`
   renders `value="—"` with `unavailableReason="Cost of goods is not yet posted per item, so margin
   cannot be computed. Showing nothing rather than a wrong number."`

**The grain mismatch is the hard part.** `sales_item_facts` is one row per **order line**
(`V001:64`). `STOCK_DEPLETED.lines` and the DEPLETION movement rows are one entry per
**ingredient per order** — `DepletionService.java:100,141` merges ingredient demand *across every
menu item on the check* before costing. Once two lines share an ingredient, the per-line COGS is
**not recoverable** from what is published or persisted. Any per-line COGS requires either a new
per-line grain in the depletion path, or a re-allocation — and a re-allocation is an estimate
wearing a measurement's clothes.

---

## 9. The five things that BLOCK honest COGS

Ranked by how badly each one damages the number.

### B1 — Depletion aggregates ingredient demand across the whole order, destroying line grain
`DepletionService.java:100` (`Map<UUID, BigDecimal> requiredByIngredient`), merged at line 141 across
every `ItemEntry` and every recipe line, then costed once per ingredient at line 162-213.
`sales_item_facts` needs one COGS per order line (`V001__analytics_facts.sql:64`). Two lines sharing
chicken produce one chicken figure. **This is a code-shape blocker, not a data gap**, and it is the
single change that unblocks everything else.

### B2 — No dated ingredient cost; the only cost column is overwritten in place
`ingredient_branch_stock.avg_cost_paisa` (V1:65, V12:28-30), written at `ReceiptService.java:73`,
`OpeningBalanceService.java:63`, `TransferService.java:240`. No history table
(`grep "cost_history|price_history|CREATE TABLE.*history"` → no output). The audited alternative,
`inventory_movements` (`movement_at` + `unit_cost_paisa` + `total_cost_paisa` +
`reference_id = orderId`), exists and is append-only — but its repository exposes **no time-bounded
query at all** (`InventoryMovementRepository.java`, 3 methods, whole file). **Backfill must read
DEPLETION rows by order; re-pricing history at today's MAC is not a measurement and must be refused.**

### B3 — Recipe coverage is ~1 in 6 on a seeded tenant, and a partial COGS sum is a wrong COGS
Seed creates 1 recipe with 1 line against 1 of up to 6 menu items
(`seed_restaurantos.py:1229-1234, 1350, 1373-1379`); no SQL recipe seed exists
(`grep "INSERT INTO recipes"` → no output). Uncovered lines are skipped and reported via
`DEPLETION_INCOMPLETE` (`DepletionService.java:104-110, 229-236`) — correctly. But a dashboard that
sums `cogs_paisa` over a mix of covered and uncovered lines produces a margin that is
*arithmetically valid and materially wrong*. **Any COGS rollup must carry a coverage denominator**
(`RecipeService.getCoverage()`, `RecipeService.java:129-172`, already returns exactly this) and must
render "—" below a threshold rather than a partial sum.

### B4 — Modifiers add revenue and cannot add cost; variants are not modelled
`modifiers` has `price_delta_paisa` and no ingredient link at all
(`pos-service V1__pos_schema.sql:96-108`), and modifiers are absent from
`PosEventContract.ItemEntry` (`shared-lib/.../PosEventContract.java:136-142`). Every "+Rs 150 extra
cheese" is booked as 100% margin. No `variant` table exists in pos-service migrations. **Margin is
therefore structurally overstated on every modified line, and the model cannot currently be told
otherwise.**

### B5 — The preview presents incomplete inputs as finished numbers
`RecipeCostPreviewService.java:116-128` skips warned lines from the batch total, then returns
`batchCostPaisa`/`portionCostPaisa` as non-nullable `long`s (`RecipeDtos.java:71-78`); with every
line excluded, `foodCostPct` is computed as `0/price×100 = 0.0` (line 158-164) and the panel prints
`"0.0%"` (`recipe-cost-panel.tsx:27-32`). Contrast the per-line contract, which is exactly right
(`RecipeDtos.java:51-56`). **Fix: make `batchCostPaisa`/`portionCostPaisa`/`foodCostPct` null
whenever `excludedLineCount > 0`, and never divide a zero batch cost by a price.** This is the same
defect class the ReportCatalog `countIf(...) = 0 -> NULL` guard already solves one layer down.

---

## 10. Secondary findings worth carrying forward

- **`recipes.net_yield_pct` is dead** (2 hits, both in `SchemaMigrationIT`). Cooking/reduction loss
  is not in any plate cost. Deferral is documented at `V6:52-57`.
- **`ingredients.default_yield_pct` is never read by any cost path.** AP→EP trim yield is
  authored and ignored. Only `recipe_lines.yield_pct` reaches `UomConverter.java:38`.
- **`ingredient_uom_conversions` is CRUD-only** (§1.8). Density and each-weight bridges cannot be
  used, so a recipe line in ML against a WEIGHT-stocked ingredient is unpriceable by construction —
  `RecipeService.resolveLines` refuses it at authoring time (`RecipeService.java:269-274`) with the
  stated reason "nothing in the system knows the density of chicken" (line 236-239).
- **Unit codes are not normalised at rest.** The preview tolerates it case-insensitively
  (`RecipeCostPreviewService.java:92-96`); `DepletionService.java:114-116` throws
  `IllegalStateException` on the same miss. Two failure modes, one data problem.
- **`avg_cost_paisa` is per-branch.** COGS at branch A and branch B for the same recipe legitimately
  differ. Any tenant-level margin rollup must aggregate branch-costed lines, never re-cost at some
  tenant-wide average.
- **`findByReferenceId(UUID)`** (`InventoryMovementRepository.java:16`) is the existing, audited seam
  for retrieving an order's DEPLETION movements — the natural entry point for a backfill.
- **Preview basis vs. posting basis agree by construction.** Both read
  `IngredientBranchStock.avgCostPaisa` and both cross the rate→amount boundary through
  `MacCalculator.extendedCostPaisa` (`RecipeCostPreviewService.java:205`,
  `DepletionService.java:278-280`). Stated as a deliberate invariant at
  `RecipeCostPreviewService.java:36-38`. Preserve it.

---

## Appendix — absence proofs

```
# No ingredient cost-history / price-history table anywhere
$ grep -rn "cost_history\|price_history\|avg_cost.*history\|CREATE TABLE.*history" --include="*.sql" .
(no output)

# recipes.net_yield_pct is never read by application code
$ grep -rn "netYieldPct\|net_yield_pct" --include="*.java" --include="*.ts" --include="*.tsx" .
services/inventory-service/src/test/java/io/restaurantos/inventory/SchemaMigrationIT.java:127
services/inventory-service/src/test/java/io/restaurantos/inventory/SchemaMigrationIT.java:134

# No SQL seed creates a recipe
$ grep -rn "INSERT INTO recipes\|INSERT INTO recipe_lines" -r .
(no output)

# ingredient_uom_conversions is never read by a cost/depletion/GRN path
$ grep -rn "IngredientUomConversionRepository\|ingredientUomConversionRepository" --include="*.java" services/ | grep -v "/test/"
# -> only IngredientService CRUD (see §1.8)

# reporting-service has no STOCK_DEPLETED consumer
$ ls services/reporting-service/src/main/java/io/restaurantos/reporting/consumer/
OrderClosedConsumer.java  TillClosedConsumer.java  VendorInvoiceMatchedConsumer.java

# InventoryMovementRepository has no time-bounded query (whole file, 31 lines)
$ cat services/inventory-service/src/main/java/io/restaurantos/inventory/repository/InventoryMovementRepository.java
# -> findByReferenceId, existsByTenantIdAndIngredientId, findDistinctIngredientIdsByTenantIdAndIngredientIdIn

# No variant table in pos-service
$ grep -rni "variant" services/pos-service/src/main/resources/db/migration/
# -> only "invariant" in RLS comments
```
