# Inventory & Waste Control — Depth a Real Restaurant Needs

**Scope:** wastage capture, theoretical-vs-actual usage variance, recipe costing & yield, par/reorder/PO
suggestion, batch-lot-expiry-FIFO, multi-unit conversion, inter-branch transfers.
**Ground truth read:** `services/inventory-service`, `services/purchasing-service`, `shared-lib` event
contracts, `services/finance-service` auto-posting, `frontend/lib/repositories`, `gateway`.
**Not covered here** (parallel swarm owns these): FBR e-invoicing, thermal printing, biometric
attendance, ERP module gaps, cross-module integration gaps, UI/UX visual direction, frontend
component stack, current tenant configurability, testing strategy.

---

## 0. Decisions that govern everything below

| Concern | Decision | Why |
|---|---|---|
| **Money amounts** | `BIGINT` paisa. Never float, never decimal, never in an event payload as a decimal. | House rule; already enforced. `inventory_movements.total_cost_paisa`, `stock_wastage.total_cost_paisa`, `stock_count_lines.variance_cost_paisa` are all `BIGINT`. |
| **Per-unit costs (rates)** | `NUMERIC(18,4)` paisa. **A rate is not an amount.** | Already migrated by `V12__unit_cost_precision.sql`. PKR 62/kg = 6.2 paisa/g; storing 6 is a 3.2% valuation error compounded into every MAC blend. |
| **Quantities** | **`NUMERIC(18,4)`** — 4 decimal places, 14 integer digits. | Already the house standard: `ingredient_branch_stock.qty_on_hand`, `stock_lots.qty`, `recipe_lines.qty`, `inventory_movements.qty`, `reorder_point`, `par_level`, `stock_count_lines.*_qty`, `stock_transfer_lines.qty_*`, `purchase_order_lines.qty`, `vendor_items.pack_qty` are all `NUMERIC(18,4)`. **Every new quantity column in this design uses the same.** 0.0001 g = 0.1 mg — finer than any kitchen scale; 10^14 g = 100 million tonnes — no overflow. |
| **Within-dimension UOM factors** | `NUMERIC(18,8)` (`units_of_measure.to_base_factor`, unchanged). | Existing. kg→g is exactly 1000; the scale is there for oz/lb style factors. |
| **Cross-dimension bridges** | `NUMERIC(18,9)` (`ingredient_uom_conversions.factor`, unchanged). | Existing. Density (0.911 g/ml for oil) and each-weight need the extra digits. |
| **Percentages** | `NUMERIC(6,2)` for yields/caps (existing convention: `recipe_lines.yield_pct`, `ingredients.default_yield_pct`, `item_categories.variance_cap_pct`); `NUMERIC(9,2)` for computed variance percentages (existing: `stock_count_lines.variance_pct`). | Existing. |
| **Rounding** | Round **once**, at the rate→amount boundary, HALF\_UP, through `MacCalculator.extendedCostPaisa`. | Existing and correct. Section 7 lists the three places this discipline is currently violable. |
| **Tenancy** | Every new table: `tenant_id UUID NOT NULL`, `ENABLE` + **`FORCE ROW LEVEL SECURITY`**, `CREATE POLICY tenant_isolation USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE),'')::UUID)`, `GRANT` to `inventory_user`. | Matches `V11__stock_wastage.sql` exactly. No new table is RLS-exempt — the one exemption in this service (`inventory_tenant_registry`, V3) exists solely for cron tenant discovery and must not be extended. |
| **Feature gating** | Everything under `/api/v1/inventory/` inherits `FEATURE_INVENTORY`; `/api/v1/purchasing/` inherits `FEATURE_VENDOR`. | `gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java:36,50`. New sub-features (§9) are enforced **in-service** via `@RequiresFeature`, not by adding gateway prefixes. |

---

## 1. What actually exists today (verified, file-by-file)

### 1.1 Ingredients & master data — **substantial, partly inert**

`services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/Ingredient.java`
carries: `baseUomCode`, `categoryId` (FK, NOT NULL), `reorderPoint`, `parLevel`, `itemType`
(PURCHASED/PREPARED/BOTH), `producedByRecipeId`, `measureType` (WEIGHT/VOLUME/COUNT),
`recipeUomCode`, `defaultYieldPct`, `storageLocationId`, `shelfLifeDays`, `perishable`,
`archivedAt`.

**Four of these fields are stored and read by nothing.** I grepped for every reader:

| Field | Written | Read by any calculation |
|---|---|---|
| `defaultYieldPct` | `IngredientService.java:507` | **No.** Only echoed into `IngredientDto` (`IngredientService.java:660`). No arithmetic anywhere calls `getDefaultYieldPct()`. |
| `recipeUomCode` | `IngredientService.java:147` | **No.** DTO echo only. `UomConverter` uses the recipe line's own `uomCode`. |
| `shelfLifeDays` | `IngredientService.java:514` | **No.** DTO echo only. **No receipt path derives an expiry date from it** — `ReceiptService.receive` takes `expiryDate` from the request or leaves it null. |
| `producedByRecipeId` | `IngredientService.java:147` (validated against `recipes` at `IngredientService.java:541`) | **No.** No nested-BOM explosion exists. `DepletionService` walks exactly one level of `recipe_lines`. |

`ingredient_uom_conversions` (the cross-dimension bridge — density, each-weight, pack size) is
written by `IngredientService.replaceConversions` (`:551-565`) and read back only to populate the
ingredient DTO (`:624`). **`UomConverter`, `DepletionService`, `RecipeCostPreviewService` and
`GrnUomResolver` never consult it.** Every conversion in the system goes through
`units_of_measure.to_base_factor`, which is within-dimension only. See §7.

### 1.2 Recipes — **real, versioned, effective-dated**

`Recipe` (menuItemId, version, isCurrent, `effectiveFrom`, `yieldServings`) + `RecipeLine`
(ingredientId, qty, uomCode, `yieldPct`). `RecipeService.resolveEffectiveRecipe` filters on
`effective_from` against the order's `closedAt` — not on `is_current`, which is the correct
choice for retroactive accuracy (documented at `Recipe.java:22-25`).

`RecipeService.getCoverage()` reports menu items with no recipe. Reachable at
`GET /api/v1/inventory/recipes/coverage` and wired to `frontend/app/(tenant)/app/inventory/coverage/page.tsx`.

### 1.3 Recipe-driven depletion on order close — **IT HAPPENS. Verified end to end.**

*(The parallel integration-gap agent is also checking this. What **I** found:)*

The chain is complete and every link is real:

1. **Producer.** `services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java:780`
   — `performClose()` publishes `ORDER_CLOSED` on exchange `pos.topic`, routing key `pos.order.closed`,
   with `itemEntries` built from `order.getItems()` carrying `menuItemId` and `quantity`
   (`:753-760`), plus `closedAt` and `businessDate`.
2. **Binding.** `InventoryRabbitConfig.java:63-67` binds queue `inventory.order-closed.queue` to
   `pos.topic` with `"pos.order.closed"` — the routing key matches the producer's constant
   (`OrderServiceImpl.java:48`) exactly. DLQ sibling declared at `:125-126`.
3. **Consumer.** `consumer/OrderClosedConsumer.java:46` — `@RabbitListener` on that queue,
   idempotent via `processed_events` (consumer name `inventory.depletion`), tenant-scoped via
   `TenantAwareMessageProcessor`, calls `depletionService.deplete(env.branchId(), env.payload())`.
   Deserialization failure throws `AmqpRejectAndDontRequeueException` → DLQ, not a silent ack.
4. **Domain logic.** `service/DepletionService.java:93-216` — resolves the effective recipe per line,
   converts to base qty, sorts the distinct ingredient set before `findForUpdate` (deadlock
   avoidance), walks lots FEFO flooring each at zero, decrements aggregate `qty_on_hand` by the
   **full** required qty (oversell goes negative by design), values COGS at aggregate MAC (never a
   lot's receipt cost), writes a signed-negative `DEPLETION` movement per ingredient, publishes
   `STOCK_DEPLETED` through the transactional outbox as the last statement.
5. **Proof.** `src/test/java/io/restaurantos/inventory/LiveDepletionProofIT.java` drives
   `MenuItemCatalogService.upsert` → `RecipeService.createVersion` → **`orderClosedConsumer.onMessage`**
   (the real listener method, not the service) and asserts the lot decrement, the `DEPLETION` row,
   and a `STOCK_DEPLETED` outbox payload whose `totalCogsPaisa` is computed independently.

**Verdict: recipe-driven depletion is live, not dead code.** It is the one place in this service
where the full loop is demonstrably wired.

**Six real limits on it, all verified:**

| # | Limit | Evidence |
|---|---|---|
| D1 | **Refunds and voids never restore stock.** Inventory binds only `pos.order.closed`, `pos.menu_item.*`, `purchasing.grn.received`. There is no `ORDER_REFUNDED` / `ORDER_VOIDED` consumer. | `InventoryRabbitConfig.java` — three queues, no refund binding. `PosEventContract` defines `ORDER_REFUNDED` with a full payload. |
| D2 | **Modifiers deplete nothing.** `PosEventContract.ItemEntry` is `(menuItemId, name, qty, unitPricePaisa, lineTotalPaisa)` — no modifier list. "Extra cheese" is priced and never costed. | `shared-lib/.../PosEventContract.java:86-92`. |
| D3 | **Order quantity is `int`.** Half portions, by-weight sales and "2.5 kg of biryani" cannot be expressed. | `PosEventContract.java:89` — `int qty`. |
| D4 | **Uncovered sales are announced and then forgotten.** `DEPLETION_INCOMPLETE` publishes `missingMenuItemIds` (`DepletionService.java:208-215`) but nothing persists or consumes it. The event exists; no queue binds `inventory.depletion.incomplete` anywhere in the fleet. | `InventoryEventContract.java:44,55`; no matching `Binding` bean in any service. |
| D5 | **Sub-recipes / preps do not explode.** An ingredient with `itemType=PREPARED` and a `producedByRecipeId` depletes as itself; its components are untouched. | §1.1 — no reader for `producedByRecipeId`. |
| D6 | **No production/batch step.** Nothing converts raw inputs into a prep item's stock. Prep yield is unmeasurable. | No `production` table, service or endpoint exists. |

### 1.4 Stock movements — **one clean typed ledger**

`inventory_movements` with a DB `CHECK` on `movement_type IN ('OPENING_BALANCE','RECEIPT',
'DEPLETION','TRANSFER_OUT','TRANSFER_IN','COUNT_VARIANCE','WASTAGE','TRANSFER_VARIANCE')`
(`V1__inventory_schema.sql:159-160`), signed `qty NUMERIC(18,4)`, `unit_cost_paisa NUMERIC(18,4)`
(rate), `total_cost_paisa BIGINT` (amount), `reference_type` + `reference_id`, `movement_at`.
FORCE RLS. **This ledger is the single best asset in the whole module** — §3 builds the variance
report entirely out of it without a new write path.

### 1.5 Stock takes — **real, with a variance cap and an audit trail**

`StockCountService.postCount` computes `variance = counted − system` per line under
`findForUpdate`, writes `COUNT_VARIANCE` movements, sets `qty_on_hand = countedQty`, stamps
`lastCountedAt`, publishes `COUNT_VARIANCE_POSTED`. `V9` added a per-category `variance_cap_pct`
(most-specific-wins up the 3-level category tree) that **rejects the whole post** with 422
`COUNT_VARIANCE_OVER_CAP` unless every breaching line carries an `overrideReason` — and stores
`variance_pct`, `cap_pct`, `override_reason` on the line rather than recomputing them later
(`StockCountLine.java:46-56` explains why: a re-capped category must not silently re-answer "was
this allowed?"). This is genuinely good control design.

**Gaps:** counts are a single flat `DRAFT`→`POSTED` post with no count sheet, no blind count, no
sub-location scoping, no partial/cycle count concept, no re-count workflow, and **no lot
reconciliation** (§1.7).

### 1.6 Wastage — **the write path is real; the API is unreachable and the model is thin**

`V11__stock_wastage.sql` + `StockWastage`/`StockWastageLine` + `WastageService.record` +
`WastageController` (`POST/GET /api/v1/inventory/wastage`, `authorizeManage`/`authorizeView`,
`@RequiresFeature("FEATURE_INVENTORY")`). Valued at MAC, signed `WASTAGE` movement per line,
sorted locks, one `WASTAGE_RECORDED` event through the outbox keyed on the header id.
Finance consumes it: `FinanceRabbitConfig.java:42,59` binds `finance.wastage.queue`;
`AutoPostingRecipeEngine.postWastage` (`:265-279`) posts DR `WASTAGE` / CR `INVENTORY`, deduped on
`wastageId`.

**Verified defects:**

| # | Defect | Evidence |
|---|---|---|
| W1 | **No frontend. The endpoint is unreachable from the product.** `frontend/lib/repositories/inventory.repository.ts` enumerates every inventory call the app makes — categories, gl-accounts, ingredients, uom, storage-locations, stock, recipes, opening-balance, receipts, transfers, counts. **No `/wastage`.** The only "wastage" strings in the frontend are a GL account label in test mocks. | Grep of `frontend/**` for `wastage` returns 4 hits, all `"Wastage & Spoilage"` account-name assertions. |
| W2 | **Reason codes are wrong for a restaurant and frozen in a `CHECK` constraint.** `V11:22-23` allows only `SPOILAGE, BREAKAGE, EXPIRY, STAFF_MEAL, CUSTOMER_RETURN, OTHER`. **`OVER_PORTIONING` and `PREP_ERROR` — the two largest controllable waste buckets in any kitchen — cannot be recorded.** They collapse into `OTHER`. | `V11__stock_wastage.sql:22-23`. |
| W3 | **Invalid reason → 500, not 400.** `WastageDtos.RecordWastageRequest.reason` is `@NotBlank String` with no enum, no `@Pattern`. An unknown code reaches the DB `CHECK` and surfaces as a constraint violation. | `dto/WastageDtos.java:27`. |
| W4 | **No approval, at any value.** One `authorizeManage` call and the write-off posts. A line manager can write off any quantity of anything, and it hits the GL immediately. | `WastageController.java:44`. |
| W5 | **Wastage never touches `stock_lots`.** `WastageService` has no `StockLotRepository` dependency at all. Aggregate `qty_on_hand` drops; every lot row keeps its quantity. | `service/WastageService.java` — full read; no lot repository injected or referenced. |
| W6 | **Consequence of W5: the expiry alert loops forever.** `ExpirySweepService` selects lots with `expiry_date <= cutoff AND qty > 0`. Writing off an expired lot leaves `qty > 0`, so the same lot re-alerts every night until someone counts it away. | `ExpirySweepService.java:118-119` + W5. |
| W7 | **Every reason posts to the same GL account.** `AutoPostingRecipeEngine.postWastage` hardcodes `line(tag("WASTAGE"), …)`. `WastageRecordedPayload` is `(wastageId, ingredientId, branchId, qty, costPaisa, reason)` — it carries no account codes, unlike `DepletedLine` which carries `cogsAccountCode`/`inventoryAccountCode`. So `ItemCategory.defaultWasteAccountId` (added by V8) is **never used by finance**, and a staff meal debits Waste & Spoilage. | `AutoPostingRecipeEngine.java:274-276`; `InventoryEventContract.java:156-163`; `DepletionService.java:188-191` for the contrast. |
| W8 | **Multi-line write-offs lose their ingredient on the wire.** `WastageService` sets `ingredientId` to the first line's id when there is exactly one line and **`null` otherwise** (`:151-155`). Detail survives only in `inventory_movements`. | `service/WastageService.java:151-155`. |

### 1.7 Lots, expiry, FIFO — **FEFO works for depletion and transfers; three paths bypass it**

`stock_lots` (branchId, ingredientId, stockId, `qty NUMERIC(18,4) CHECK (qty >= 0)`, `expiryDate`
nullable, `receiptUnitCostPaisa NUMERIC(18,4)`, `receivedAt`, `sourceMovementId`).
`DepletionService.walkFefoAndFloor` sorts by expiry with `nullsLast` and drains oldest-first;
`TransferService` reuses it on ship. `ExpirySweepService` is a genuinely careful nightly cron: it
discovers tenants from the RLS-exempt registry (because a discovery query against `stock_lots`
under FORCE RLS with no ambient context would see nothing and no-op forever — documented at
`ExpirySweepService.java:34-52`), then per tenant sets the GUC on the already-open connection and
enables the Hibernate `tenantFilter`.

**It is FEFO (first-expiry-first-out), not FIFO.** For an ingredient with no expiry dates all lots
sort equal and the walk order is whatever the query returned — effectively arbitrary. There is no
`received_at` tiebreaker in `walkFefoAndFloor`'s comparator (`DepletionService.java:230-232`).

**Three paths desynchronise lots from aggregate on-hand:**

| Path | Effect |
|---|---|
| **Wastage** (§1.6 W5) | Lots keep quantity that no longer exists. |
| **Stock count** | `StockCountService` sets `qty_on_hand = countedQty` and never adjusts lots. A count that finds 8 kg where the book said 10 leaves 10 kg spread across lot rows. |
| **Transfer receive** | `TransferService.receive` creates the destination lot **without calling `setExpiryDate`** — so `expiry_date` is null. A perishable transferred between branches becomes non-perishable and sorts last under FEFO forever. |

**And the largest one: GRN receipts never carry an expiry date.**
`GrnReceiptSimulator` builds each `GrnLine` with `null` in the `expiryDate` position
(`GrnReceiptSimulator.java:104-111`; the record's 5th component is `LocalDate expiryDate`,
`PurchasingEventContract.java:92`). `MockReceiveRequest.Line` is `(poLineId, receivedQty)` — there
is nowhere for a receiver to type one. So **every lot created from a purchase order has a null
expiry**, and the nightly sweep can only ever see lots from the manual receipt screen or opening
balance. `ingredients.shelf_life_days` exists and would answer this automatically; nothing reads it.

### 1.8 Purchase orders, GRN, vendors — **PO/vendor deep; GRN is a mock that is on by default**

**Real and deep:** `Vendor`, `VendorCategory`, `VendorItem` (vendorSku, `orderUom`, `packQty`,
`packUom`, `packUnitsPerOrderUnit`, `minOrderQty`, `orderMultiple`, `leadTimeDays`, `preferred`,
`catchWeight`, `archivedAt`), `VendorItemPrice` (append-only, effective-dated, branch-scoped —
`VendorItemPriceAppendOnlyIT`), `PurchaseOrder` + lines with a **multi-tier approval** model
(`requiredTiers`/`tiersApproved`, `PoApprovalTier`, `DuplicateApproverException`),
`VendorInvoice` + `ThreeWayMatchService` with `TenantMatchTolerance`, `ApPayment` +
allocations, `VendorAnalyticsService` (spend + scorecard).

**The GRN is a simulator.** The only receiving path in the fleet is
`POST /api/v1/purchasing/purchase-orders/{poId}/mock-receive` →
`MockGrnController` → `GrnReceiptSimulator.simulateReceive` → rows in **`mock_grn_receipts`**.
There is no `GoodsReceipt` entity, no receiving screen beyond this, no partial-line rejection, no
quality/temperature capture, no delivery-note reference, no expiry capture, no catch-weight capture.

`MockGrnController:35-37` returns **404 unless `integrationProperties.isMockMode()`**, and
`InventoryIntegrationProperties.integrationMode` defaults to `"mock"` with **no YAML anywhere in
the repo setting it** (grepped every `*.yml`/`*.yaml`/`*.properties`: zero hits for
`mock-mode`/`integrationMode`). So goods receiving works *only* because the mock is the default —
flipping `restaurantos.inventory.integration-mode=feign` for the *category-resolution* reason
documented in `InventoryIntegrationProperties.java:12-15` would **404 the entire receiving flow**,
and with it every stock lot, every MAC update and every GR/IR posting. The frontend calls it
directly (`frontend/lib/repositories/purchasing.repository.ts:222`).

The **event** side downstream of it is real and correct: `GRN_RECEIVED` → `purchasing.topic` →
`inventory.grn-received.queue` → `GrnReceivedConsumer` → `GrnUomResolver` → `ReceiptService`,
idempotent on `eventId`, stamping `referenceType='GRN'` + `grnId` on the movement.

**`/internal/grn/pending-count` is structurally zero.** `GrnPendingCountRepository.countPendingAsOf`
filters `reference_type = 'PENDING_GRN'`, a sentinel **no writer ever produces** — `ReceiptService`
writes `'RECEIPT'` or `'GRN'`. The repository javadoc says so itself. Finance's period-close
pre-check therefore always passes.

### 1.9 Par / reorder / suggestions — **complete and honest**

`ReorderSuggestionService.shortfalls` (inventory) → `GET /internal/inventory/reorder-shortfalls`
(shared-secret header, not JWT) → `OrderSuggestionService.suggestForBranch` (purchasing) → joined
to vendor catalog, priced through `CurrentPriceResolver`, grouped per vendor, converted to whole
purchasable units with `CEILING` at every step, `POST /order-suggestions/drafts` creates one DRAFT
PO per vendor via the same `PurchaseOrderService.create` a hand-typed PO uses. UI at
`frontend/app/(tenant)/app/purchasing/order-suggestions/page.tsx`.

The refusal-to-guess design is right: `NO_VENDOR`, `AMBIGUOUS_VENDOR`, `NO_PRICE`, `NO_PAR_LEVEL`,
`PAR_BELOW_REORDER_POINT` are returned as rows with a `blockedReason` rather than dropped, and
`fetchShortfalls` fails closed on inventory being down (`InventoryUnavailableException`).

**Gaps:** par and reorder point are **static scalars on the ingredient, not per-branch and not
demand-derived**. A 400-cover flagship and a 60-cover satellite share one par level. Nothing uses
sales velocity, lead time, day-of-week or safety stock. §6.

### 1.10 Costing — **a live preview exists; nothing is persisted**

`RecipeCostPreviewService.preview` (`POST /api/v1/inventory/recipes/preview`, `authorizeManage`)
returns `batchCostPaisa`, `portionCostPaisa`, `yieldServings`, `menuItemPricePaisa`,
`foodCostPct` (scale 1), `excludedLineCount` and per-line `costPaisa` + `sharePct`. Prices off
`ingredient_branch_stock.avg_cost_paisa` — the **same** number COGS is valued at, which is the
right call. Batched lookups, one query per kind. Unpriceable lines carry a warning rather than
failing the request. UI: `frontend/components/inventory/recipe-cost-panel.tsx`.

**Gaps:** it is request-scoped and stateless. Nothing persists a plate cost, so there is no menu
margin list, no "which dishes drifted this month", no historical cost curve, and no
food-cost-percentage figure anywhere except inside one authoring dialog. `RecipeDto` carries no
cost at all.

### 1.11 Transfers — **the most complete lifecycle in the module**

`TransferService.ship` (self-transfer rejected, **aggregate on-hand must not go negative** — unlike
depletion, and correctly so, since a receiving branch would otherwise book stock at cost 0),
`receive` (destination-branch ownership enforced before any write, `SHIPPED`-only state guard
against replay, MAC recompute at destination, `TRANSFER_IN` movement, new lot), variance handling
with `TRANSFER_VARIANCE`. Every payload line carries `unitCostPaisa` **and** a producer-computed
`lineCostPaisa` so finance never re-derives money from a decimal quantity.

**Gaps:** no in-transit ledger balance to reconcile against account 1320; no rejection/return-to-
sender; no expiry carried across (§1.7); the receiving branch must send a line for every shipped
ingredient or the whole receive throws.

### 1.12 What does not exist at all

- **Theoretical-vs-actual usage variance.** Grepped the entire repo for
  `theoretical|theoreticalUsage|usage.variance|actualUsage` — four hits, all unrelated prose in
  auth-service and a purchasing schema comment. **There is no such report, table, service,
  endpoint or UI.**
- Persisted recipe/plate cost; menu margin; food-cost % anywhere outside the authoring dialog.
- Waste analytics of any kind (by reason, by branch, by shift, by user, over time).
- Production / prep batches; nested BOM explosion; prep yield measurement.
- Count sheets, blind counts, cycle counts, sub-location counting.
- Shelf-life-driven expiry; lot traceability (which lot went into which order); recall support.
- Catch-weight receiving (the `VendorItem.catchWeight` flag is stored and read by nothing in the
  receipt path).

---

## 2. WASTAGE capture

### 2.1 Reason codes — move them out of the `CHECK` constraint

A hardcoded `CHECK` is the wrong home for a list every tenant wants to edit, and it is why
`OVER_PORTIONING` and `PREP_ERROR` are currently unrecordable (W2). Replace it with a
tenant-scoped, seeded, extensible table.

```sql
-- V13__wastage_reasons.sql
CREATE TABLE wastage_reasons (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID        NOT NULL,
    code                    VARCHAR(40) NOT NULL,
    label                   VARCHAR(80) NOT NULL,
    -- Controllable waste is the kitchen's fault and belongs in the manager's KPI;
    -- uncontrollable (a fridge failure, a supplier's short shelf life) does not.
    is_controllable         BOOLEAN     NOT NULL DEFAULT TRUE,
    -- Whether this reason's cost belongs in food cost % (staff meals and marketing comps
    -- do not: they are employee-benefit and marketing expense respectively).
    in_food_cost            BOOLEAN     NOT NULL DEFAULT TRUE,
    -- Per-reason GL override; falls back to the ingredient category's
    -- default_waste_account_id (V8), then to the tenant-wide WASTAGE tag.
    gl_account_id           UUID,
    gl_account_code         VARCHAR(20),          -- display cache, same convention as V8
    -- NULL = never needs approval. 0 = always needs approval.
    approval_threshold_paisa BIGINT,
    requires_photo          BOOLEAN     NOT NULL DEFAULT FALSE,
    is_system               BOOLEAN     NOT NULL DEFAULT FALSE,  -- seeded; code immutable
    sort_order              INT         NOT NULL DEFAULT 0,
    archived_at             TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID, updated_by UUID, deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_wastage_reason_code UNIQUE (tenant_id, code)
);
ALTER TABLE wastage_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE wastage_reasons FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON wastage_reasons
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
GRANT SELECT, INSERT, UPDATE, DELETE ON wastage_reasons TO inventory_user;

-- stock_wastage gains a real FK; the legacy free-text column stays readable.
ALTER TABLE stock_wastage
    ADD COLUMN reason_id UUID REFERENCES wastage_reasons(id),
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'APPROVED'
        CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED')),
    ADD COLUMN recorded_by UUID,
    ADD COLUMN approved_by UUID,
    ADD COLUMN approved_at TIMESTAMPTZ,
    ADD COLUMN rejection_reason TEXT,
    ADD COLUMN shift_id UUID,                    -- nullable; POS till session when known
    ADD COLUMN reversal_of_wastage_id UUID REFERENCES stock_wastage(id);
ALTER TABLE stock_wastage DROP CONSTRAINT stock_wastage_reason_check;
-- `reason` is kept and kept written (mirrors the ingredients.category / storage_location
-- precedent) so historical rows and anything reading the text keep working.
```

> **Backfill runs under a `NO FORCE` window** — the same pattern V5/V7 used for their backfills, and
> for the same reason: a `NO SUPERUSER / NOBYPASSRLS` role writing tenant rows with no
> `app.current_tenant_id` set will be silently rejected by the policy. `ALTER COLUMN … TYPE` (as in
> V12) does *not* need this; DML does.

**Seeded system reasons** (`is_system = TRUE`, code immutable, label/threshold/GL editable):

| Code | Controllable | In food cost | Default GL | Notes |
|---|---|---|---|---|
| `SPOILAGE` | ✓ | ✓ | 5220 Waste & Spoilage | Went off in storage. |
| `EXPIRY` | ✓ | ✓ | 5220 | Passed its date. Should mostly be pre-empted by the expiry alert. |
| `PREP_ERROR` | ✓ | ✓ | 5220 | Burnt, dropped, wrong recipe. **New.** |
| `OVER_PORTIONING` | ✓ | ✓ | 5220 | Recorded from a variance investigation, not from a bin. **New.** |
| `BREAKAGE` | ✓ | ✓ | 5220 | Physical damage. |
| `CUSTOMER_RETURN` | ✓ | ✓ | 5220 | Sent back. Should cross-reference the order. |
| `STAFF_MEAL` | ✗ | **✗** | 6xxx Staff Welfare | Not waste. Currently mis-posted to 5220 (W7). |
| `MARKETING_COMP` | ✗ | **✗** | 6xxx Marketing | Comped for a reason other than a complaint. |
| `TRAINING` | ✗ | ✗ | 6xxx Training | Deliberate consumption. |
| `SUPPLIER_REJECT` | ✗ | ✓ | 1700 GR/IR or a vendor-claim account | Rejected at the door — should ideally be a GRN short-receipt, not a write-off. |
| `OTHER` | ✓ | ✓ | 5220 | Requires notes; report separately so its share is visible. |

`WastageDtos.RecordWastageRequest` moves from `@NotBlank String reason` to `@NotNull UUID reasonId`
(with a transitional `String reason` accepted and resolved by code), killing W3.

### 2.2 Who records it

| Role | Capability | Enforcement |
|---|---|---|
| Line cook / prep | Record against a **restricted reason set** and up to a low value cap | New OPA action `inventory.wastage.record` in `policies/restaurantos/inventory.rego`, resource carries `reasonId` + `totalCostPaisa` |
| Shift/branch manager | Record any reason; approve up to their tier limit | `inventory.wastage.approve` |
| Area / owner | Approve any value; edit reason master data | `inventory.wastage.approve` + `inventory.wastage.configure` |

This needs a **third** authorization method on `InventoryAuthorizationService`, which today has
exactly two (`authorizeView` → `inventory.item.view`, `authorizeManage` → `inventory.item.manage`).
Writing off stock is not the same authority as editing an ingredient, and today it is
(`WastageController.java:44` calls `authorizeManage`). Add:

```java
public void authorizeWastageRecord(UUID tenantId, UUID branchId, UUID reasonId, long totalCostPaisa)
public void authorizeWastageApprove(UUID tenantId, UUID branchId, long totalCostPaisa)
```

Fail-closed, same `AuthorizationService` wrapper. **Do not** reuse `inventory.item.manage`.

**Capture must be fast or it will not happen.** A cook with wet hands will not fill a form. The
capture surface is: pick ingredient (recent-first, search), type quantity in the unit they think in
(§7), tap a reason tile, done. Photo optional, driven by `requires_photo`. Everything else —
cost, GL account, approval routing — is derived server-side.

### 2.3 Approval for high-value waste

**Threshold resolution, most-specific-wins:** reason-level `approval_threshold_paisa` → branch
setting → tenant setting → unlimited. Same shape as the existing `variance_cap_pct` category walk
(`ItemCategoryService.resolveDefaultsByCategory`), so there is one precedent for "inherited
threshold" in the service rather than two.

**Design decision — stock moves at record time; approval gates the ledger, not the stock.**

The food is already in the bin. If a pending write-off does not reduce `qty_on_hand`, then between
recording and approval the book stock is knowingly wrong — and the count variance report (§3),
which is the entire point of this module, silently absorbs the difference and blames it on theft.
A control that corrupts the control you actually care about is not a control.

So:

1. `POST /wastage` always writes the header, the lines and the `WASTAGE` movements, and always
   decrements `qty_on_hand` and the FEFO lots (§2.5). Physical truth, immediately.
2. If total ≥ threshold → `status = PENDING_APPROVAL`, **and `WASTAGE_RECORDED` is not published.**
   No journal entry yet. The value sits in a "pending write-offs" figure on the stock screen so
   nobody mistakes book stock for unexplained.
3. `POST /wastage/{id}/approve` → `status = APPROVED`, `approved_by`/`approved_at` stamped, **then**
   `WASTAGE_RECORDED` publishes through the outbox as the last statement. Finance's existing
   `alreadyPosted(SOURCE_WASTAGE, wastageId)` dedupe already makes this safe against retries.
4. `POST /wastage/{id}/reject` → `status = REJECTED`, plus a **compensating wastage record**
   (`reversal_of_wastage_id` set, positive movements) that puts the stock back. Never a
   `DELETE`, never an in-place mutation of the original — the same append-only instinct that
   `VendorItemPrice` already follows.
5. **Dual control:** `approved_by != recorded_by`, enforced server-side. Precedent exists —
   `purchasing`'s `DuplicateApproverException` does exactly this for POs.
6. Sub-threshold write-offs are `APPROVED` on insert and publish immediately — today's behaviour,
   unchanged, so nothing regresses.

### 2.4 Cost impact

- Valued at **MAC at write-off time**, never at a lot's receipt cost — already correct in
  `WastageService` and consistent with depletion, so a kilo binned and a kilo sold hit the P&L at
  the same number.
- `line_cost_paisa` / `total_cost_paisa` stay **`BIGINT` paisa**; `unit_cost_paisa` stays
  **`NUMERIC(18,4)`** (rate). Rounding happens once, in `MacCalculator.extendedCostPaisa`.
- **Fix W7:** extend `WastageRecordedPayload` with `wasteAccountCode` and `inventoryAccountCode`,
  resolved per line by the existing `CategoryGlAccountResolver` (which `DepletionService` already
  calls once per depletion) with the reason-level override taking precedence. Finance's
  `postWastage` then uses the carried codes and falls back to `tag("WASTAGE")` — exactly the
  fallback shape `DepletionService`/finance already use for COGS. **This is what finally makes
  `ItemCategory.default_waste_account_id` (shipped in V8) do anything.**
- **Fix W8:** the payload becomes line-structured (`List<WastageLine>`), mirroring
  `StockDepletedPayload`'s `List<DepletedLine>`. Finance still nets to one debit/credit pair per
  account — `postCountVariance` already does exactly this netting and documents why (a 200-line
  count must not become a 400-line JE).
- **Split by `in_food_cost`:** reasons with `in_food_cost = FALSE` post to their own expense account
  and are **excluded from food-cost %** in every report. Otherwise staff meals inflate food cost
  and managers learn to distrust the number.

### 2.5 Lots (fixes W5/W6)

`WastageService` gains `StockLotRepository` and calls the **existing**
`DepletionService.walkFefoAndFloor` — it is already `public static` precisely so it can be driven
without a Spring context. One shared FEFO walk, three callers (deplete, ship, write off).

For an `EXPIRY` write-off the UI passes the specific `lotId` and that lot is drained directly
rather than FEFO-walked — you are throwing away *that* lot. Add an optional `lotId` to
`WastageLineRequest`. This is what closes the W6 alert loop.

### 2.6 API surface

```
POST   /api/v1/inventory/wastage                  record (exists; reasonId + optional lotId)
GET    /api/v1/inventory/wastage                  list (exists; + status/reason/date filters)
GET    /api/v1/inventory/wastage/{id}             detail                          NEW
POST   /api/v1/inventory/wastage/{id}/approve     approve, publishes the event    NEW
POST   /api/v1/inventory/wastage/{id}/reject      reject + compensating record    NEW
GET    /api/v1/inventory/wastage/pending          approval queue for a branch     NEW
GET    /api/v1/inventory/wastage/analytics        by reason / branch / period     NEW
GET    /api/v1/inventory/wastage-reasons          list                            NEW
POST   /api/v1/inventory/wastage-reasons          create (non-system)             NEW
PUT    /api/v1/inventory/wastage-reasons/{id}     update label/threshold/GL       NEW
POST   /api/v1/inventory/wastage-reasons/{id}/archive                             NEW
```

---

## 3. Theoretical vs actual usage — the variance report

**This is the single highest-value feature in the module, and the data to build it already exists.**
No new write path is required. It is an aggregation over `inventory_movements` between two POSTED
stock counts.

### 3.1 The identity

For one ingredient, one branch, between count *A* (period open) and count *B* (period close):

```
book_close   = counted_A
             + Σ RECEIPT            (incl. GRN)
             + Σ OPENING_BALANCE
             + Σ TRANSFER_IN
             − Σ TRANSFER_OUT
             − Σ DEPLETION          ← theoretical usage
             − Σ WASTAGE            ← recorded, explained loss
             ± Σ TRANSFER_VARIANCE

unexplained  = counted_B − book_close
```

The critical realisation: **`DEPLETION` movements are already exactly "theoretical usage"** — they
are recipe-derived, not physically observed. And `COUNT_VARIANCE` at close is already exactly
`counted_B − book_close`. So the report does not recompute anything from recipes; it reads the
ledger. That matters for two reasons:

1. **It cannot disagree with COGS.** A separately-recomputed theoretical figure would drift from the
   `DEPLETION` rows finance already posted, and the two numbers would be defended in different
   meetings.
2. **It cannot double-round.** Recomputing `Σ (recipe_qty × units_sold)` from recipes would round
   at scale 4 a second time, on a different grouping, and land a few grams away from the ledger.

Present it as the industry-standard four-column report:

| Ingredient | Theoretical usage | Actual usage | Variance qty | Variance PKR | Variance % |
|---|---|---|---|---|---|

where `actual_usage = counted_A + purchases + transfers_in − transfers_out − counted_B` and
`variance_qty = actual − theoretical` (a positive variance is loss). `variance_pct` is
**variance ÷ theoretical usage**, not ÷ closing stock — the industry convention, and the only one
where "3% variance on flour" means what a chef expects. Null when theoretical usage is zero (same
rule `StockCountService.variancePct` already applies for a zero base, and for the same reason).

### 3.2 Decomposition — the part that makes it actionable

A single "you lost PKR 84,000" number gets argued with. Split it:

| Bucket | Source | Meaning |
|---|---|---|
| **Recorded waste** | `Σ WASTAGE`, broken out by reason | Explained. Already known about. |
| **Transfer variance** | `Σ TRANSFER_VARIANCE` | Explained. In-transit shortfall. |
| **Uncovered sales** | `depletion_gaps` (new, §3.4) | **Not a loss** — a measurement hole. Sales with no recipe understate theoretical usage and inflate apparent variance. Must be shown, or the whole report is distrusted the first time someone spots it. |
| **Unexplained** | The remainder | Over-portioning + theft + yield error + count error. The number that matters. |

Rank by **`unexplained_cost_paisa` descending**, not by percentage. A 40% variance on saffron and a
2% variance on cooking oil can be the same money, and the oil is usually the bigger number.

### 3.3 Where it lives

**inventory-service**, as a read model over its own ledger. No new movement types, no new events.

```sql
-- V14__usage_variance_periods.sql
-- A named, closed reporting window. The report is computed on demand, but the WINDOW is
-- persisted so two people asking "how did last week look" get the same window boundaries.
CREATE TABLE usage_variance_periods (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID        NOT NULL,
    branch_id         UUID        NOT NULL,
    opening_count_id  UUID        NOT NULL REFERENCES stock_counts(id),
    closing_count_id  UUID        NOT NULL REFERENCES stock_counts(id),
    period_start      TIMESTAMPTZ NOT NULL,
    period_end        TIMESTAMPTZ NOT NULL,
    status            VARCHAR(16) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN','CLOSED')),
    -- Snapshotted on close so a later re-cost or a backdated movement cannot silently
    -- rewrite a period a manager has already been held to. Same instinct as
    -- stock_count_lines storing variance_pct/cap_pct rather than recomputing them.
    theoretical_cost_paisa BIGINT NOT NULL DEFAULT 0,
    actual_cost_paisa      BIGINT NOT NULL DEFAULT 0,
    recorded_waste_cost_paisa BIGINT NOT NULL DEFAULT 0,
    unexplained_cost_paisa BIGINT NOT NULL DEFAULT 0,
    uncovered_sale_count   INT    NOT NULL DEFAULT 0,
    closed_at         TIMESTAMPTZ,
    closed_by         UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID, updated_by UUID, deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_uvp_window CHECK (period_end > period_start)
);
-- + ENABLE/FORCE RLS + tenant_isolation policy + GRANT (as §0)
CREATE INDEX idx_uvp_branch_period ON usage_variance_periods (tenant_id, branch_id, period_end DESC);

-- Per-ingredient snapshot, written only on close.
CREATE TABLE usage_variance_lines (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                UUID          NOT NULL,
    period_id                UUID          NOT NULL REFERENCES usage_variance_periods(id),
    ingredient_id            UUID          NOT NULL,
    opening_qty              NUMERIC(18,4) NOT NULL DEFAULT 0,
    received_qty             NUMERIC(18,4) NOT NULL DEFAULT 0,
    transfer_in_qty          NUMERIC(18,4) NOT NULL DEFAULT 0,
    transfer_out_qty         NUMERIC(18,4) NOT NULL DEFAULT 0,
    theoretical_usage_qty    NUMERIC(18,4) NOT NULL DEFAULT 0,  -- Σ|DEPLETION|
    recorded_waste_qty       NUMERIC(18,4) NOT NULL DEFAULT 0,  -- Σ|WASTAGE|
    closing_qty              NUMERIC(18,4) NOT NULL DEFAULT 0,
    actual_usage_qty         NUMERIC(18,4) NOT NULL DEFAULT 0,
    variance_qty             NUMERIC(18,4) NOT NULL DEFAULT 0,
    variance_pct             NUMERIC(9,2),                      -- NULL when theoretical = 0
    -- Valued at the MAC in force at period close — one rate, one rounding, at the boundary.
    unit_cost_paisa          NUMERIC(18,4) NOT NULL DEFAULT 0,
    variance_cost_paisa      BIGINT        NOT NULL DEFAULT 0,
    counted                  BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID, updated_by UUID, deleted_at TIMESTAMPTZ
);
-- + ENABLE/FORCE RLS + policy + GRANT
CREATE INDEX idx_uvl_period ON usage_variance_lines (period_id);
CREATE INDEX idx_uvl_cost   ON usage_variance_lines (tenant_id, period_id, variance_cost_paisa);
```

`inventory_movements` needs one composite index to make the aggregation cheap:

```sql
CREATE INDEX idx_movements_variance
    ON inventory_movements (tenant_id, branch_id, ingredient_id, movement_at)
    INCLUDE (movement_type, qty, total_cost_paisa);
```

### 3.4 Uncovered sales must be persisted

`DEPLETION_INCOMPLETE` is published and consumed by nothing (D4). Without it the variance report
blames a recipe gap on the kitchen. Add a small table written **in the same transaction as the
depletion**, before the event publish:

```sql
CREATE TABLE depletion_gaps (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL,
    branch_id    UUID NOT NULL,
    order_id     UUID NOT NULL,
    menu_item_id UUID NOT NULL,
    qty          INT  NOT NULL,
    closed_at    TIMESTAMPTZ NOT NULL,
    ...audit... );
-- + ENABLE/FORCE RLS + policy + GRANT
```

Written by `DepletionService` where it currently only collects `missingMenuItemIds`
(`DepletionService.java:109`). Keep publishing the event too — persisting it locally and announcing
it are not alternatives.

### 3.5 Coverage honesty

An ingredient not counted at *B* has no variance — not a zero variance. `usage_variance_lines.counted`
carries that, and the report header states **"127 of 214 items counted (89% of stock value)"**.
Uncounted items are listed separately, never folded into the total. A variance report that quietly
excludes what wasn't counted is how these reports lose credibility permanently.

### 3.6 API surface

```
POST /api/v1/inventory/variance/periods           open a period (opening count id)     NEW
POST /api/v1/inventory/variance/periods/{id}/close  close + snapshot                   NEW
GET  /api/v1/inventory/variance/periods           list periods for a branch            NEW
GET  /api/v1/inventory/variance/periods/{id}      full report, lines ranked by cost    NEW
GET  /api/v1/inventory/variance/preview           live report vs the last POSTED count NEW
```

`preview` matters more than it looks: waiting for a formal period close means a chef sees the
number a week late. `preview` runs the same aggregation from the last POSTED count to *now* using
current book stock instead of a fresh count — it detects nothing (no physical count), but it does
show theoretical usage and recorded waste **live**, which is what drives the daily conversation.

---

## 4. Recipe costing and yield

### 4.1 Three yields, kept distinct

The schema already separates them correctly and the separation must be preserved:

1. **`ingredients.default_yield_pct`** — AP→EP trim yield at item level ("a whole chicken yields
   68% usable"). `NUMERIC(6,2)`. **Currently read by nothing.**
2. **`recipe_lines.yield_pct`** — this line's own loss in this dish. `NUMERIC(6,2)`. Read by
   `UomConverter.effectiveBaseQty` — dividing by `yieldPct/100` correctly grosses the requirement up.
3. **`recipes.yield_servings`** — batch size → portions. `NUMERIC(18,4)`. Read by `UomConverter`.

**Decision: `default_yield_pct` becomes the *default* for a new recipe line's `yield_pct`, applied
at authoring time, and is never applied again at depletion.** The alternative — multiplying both at
runtime — double-counts trim for every chef who already typed the trimmed weight, and is invisible
when it happens. Set it in `RecipeService.createVersion` when the line request omits `yieldPct`.
This makes a shipped field do something without changing any existing recipe's arithmetic.

### 4.2 Persist the cost

`RecipeCostPreviewService` computes the right numbers and throws them away. Persist a snapshot per
recipe **version** (versions are immutable, so this is a natural key):

```sql
CREATE TABLE recipe_cost_snapshots (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL,
    recipe_id            UUID NOT NULL REFERENCES recipes(id),
    branch_id            UUID NOT NULL,          -- MAC is per-branch, so cost is per-branch
    computed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    batch_cost_paisa     BIGINT NOT NULL,
    portion_cost_paisa   BIGINT NOT NULL,
    menu_price_paisa     BIGINT,                 -- from menu_item_catalog at compute time
    food_cost_pct        NUMERIC(6,2),           -- portion ÷ price × 100
    gross_margin_paisa   BIGINT,                 -- price − portion cost
    excluded_line_count  INT NOT NULL DEFAULT 0, -- unpriceable lines; a cost with holes is a lie
    ...audit... );
-- + ENABLE/FORCE RLS + policy + GRANT
CREATE INDEX idx_rcs_recipe_branch ON recipe_cost_snapshots (tenant_id, recipe_id, branch_id, computed_at DESC);
```

Recomputed by a nightly job (same `@Scheduled` + tenant-registry pattern `ExpirySweepService`
already proves works against FORCE RLS) and on demand when a recipe version is created. **Snapshots,
not a live cache** — a cost history is what lets someone say "chicken karahi went from 28% to 34%
food cost in six weeks", which is the question that actually gets asked.

Do **not** widen `RecipeDto` with a live cost: `RecipeService` is `@Transactional(readOnly = true)`
and cheap, and joining MAC into every recipe list would make the recipes page a per-row lookup.

### 4.3 Live food-cost percentage

Two different numbers, both wanted, and conflating them is a classic reporting failure:

| Number | Definition | Source |
|---|---|---|
| **Menu-engineering food cost %** | Σ(portion cost × units sold) ÷ Σ(revenue), per dish and per category | `recipe_cost_snapshots` × POS sales |
| **Actual food cost %** | (opening stock + purchases − closing stock) ÷ revenue | The `usage_variance_periods` identity (§3.1) |

The **gap between them is the variance, expressed as a percentage of sales** — which is the single
most useful number a restaurant owner can be handed. Show both side by side with the delta.

**Menu-margin matrix** (the standard four quadrants, plotting popularity against contribution
margin): Stars (high/high), Plowhorses (high popularity, low margin), Puzzles (low popularity, high
margin), Dogs (low/low). Everything needed is present once §4.2 exists — `MenuItemCatalog` already
carries `base_price_paisa` and is kept synced from POS by `MenuItemCatalogConsumer`.

### 4.4 Honesty rules

- `excluded_line_count > 0` ⇒ the cost is displayed with a warning and **excluded from any
  aggregate**. `RecipeCostPreviewService` already returns this field; the persistence layer must
  not drop it. A plate cost missing two ingredients is worse than no plate cost.
- Costing is **per branch**, because MAC is per branch. A tenant-level "plate cost" would be a
  fiction. The UI must name the branch.
- Zero-MAC ingredients (never received, never opening-balanced) are excluded and counted — the same
  rule `RecipeCostPreviewService.priceLine` already applies (`avgCostPaisa.signum() == 0` → warn).

---

## 5. Batch/lot, expiry, FIFO

### 5.1 Fixes to what exists

| Fix | Change |
|---|---|
| **Wastage drains lots** | Inject `StockLotRepository`; call `DepletionService.walkFefoAndFloor`, or drain a specified `lotId`. Closes W5 and the W6 infinite-alert loop. |
| **Counts reconcile lots** | After setting `qty_on_hand = countedQty`, reconcile lots to match: shortfall drains FEFO; surplus creates an adjustment lot at current MAC with `expiry_date = NULL` and `source_movement_id` = the `COUNT_VARIANCE` movement. Without this, "how much of this expires this week" is wrong after every count. |
| **Transfers carry expiry** | `TransferService.ship` records the source lot(s) consumed per line; `receive` sets the destination lot's `expiry_date` from the **earliest** source expiry. Requires `stock_transfer_lines` to gain `earliest_expiry_date DATE`. Conservative by design. |
| **GRN captures expiry** | `MockReceiveRequest.Line` gains `LocalDate expiryDate`; `GrnReceiptSimulator` passes it into `GrnLine` instead of the hardcoded `null` at `:108`. **This is a one-line-plus-DTO fix that turns the entire expiry subsystem on for purchased stock.** |
| **Shelf life derives expiry** | When no expiry is supplied and `ingredients.shelf_life_days` is set, `ReceiptService` computes `expiryDate = receivedAt + shelfLifeDays`. Makes a shipped, inert field real. |
| **FIFO tiebreaker** | `walkFefoAndFloor`'s comparator gains `.thenComparing(StockLot::getReceivedAt)`. Today two null-expiry lots sort arbitrarily; with the tiebreaker, FEFO degrades gracefully to true FIFO. **Low-risk, high-value, and the method is already `public static` with a dedicated `FefoLotWalkTest`.** |

### 5.2 Lot identity and traceability

`stock_lots` gains `lot_code VARCHAR(60)` (vendor's batch number, nullable, indexed with
`tenant_id`), `supplier_lot_ref VARCHAR(60)`, and `grn_id UUID`. For a recall — "which orders
contained lot X" — add a consumption link written by the FEFO walk:

```sql
CREATE TABLE stock_lot_consumptions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL,
    lot_id        UUID          NOT NULL REFERENCES stock_lots(id),
    movement_id   UUID          NOT NULL REFERENCES inventory_movements(id),
    qty           NUMERIC(18,4) NOT NULL,
    unit_cost_paisa NUMERIC(18,4) NOT NULL DEFAULT 0,  -- the LOT's receipt cost, for traceability
    consumed_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    ...audit... );
-- + ENABLE/FORCE RLS + policy + GRANT
CREATE INDEX idx_slc_lot ON stock_lot_consumptions (tenant_id, lot_id);
CREATE INDEX idx_slc_movement ON stock_lot_consumptions (movement_id);
```

**Critical constraint: this table is traceability data, not valuation data.** COGS stays at
aggregate MAC — `DepletionService` deliberately takes only `avgCostPaisa` and never a lot so that
re-deriving COGS from a lot's receipt cost is *structurally impossible* (`DepletionService.java:246-249`).
`stock_lot_consumptions.unit_cost_paisa` records what the lot cost for audit purposes and **must
never be summed into a journal entry.** Put that in the column comment.

Volume: one row per lot touched per movement. A busy branch with 200 ingredients doing 400 covers
is on the order of a few thousand rows/day — retain 24 months, partition by month if it becomes an
issue.

### 5.3 Expiry workflow

Today: one nightly `EXPIRY_ALERT` per qualifying lot, and nothing consumes it (no queue binds
`inventory.lot.expiry` anywhere). That is a fire-and-forget event with no product behind it.

- **Escalating windows** driven by `wastage_reasons`-style tenant config: T-7 informational, T-3
  "use it or discount it", T-0 blocked-from-FEFO, T+1 auto-proposed write-off (a `PENDING_APPROVAL`
  wastage record with reason `EXPIRY`, never an auto-approved one).
- **Per-lot dedupe.** A `lot_expiry_alerts (lot_id, window_days)` unique row so a lot is not
  re-alerted nightly for its entire final week.
- **Expired lots are excluded from the FEFO walk** but still counted in `qty_on_hand` until written
  off — otherwise the book quietly disagrees with the shelf.

---

## 6. Par levels, reorder points, purchase suggestions

### 6.1 The existing model is right but too coarse

`reorderPoint` = *when*, `parLevel` = *how much to top up to*. `ReorderSuggestionService`'s javadoc
states this crisply and the implementation honours it. Keep it. The problems are scope and staleness.

### 6.2 Move par and reorder point to the branch

They are ingredient-level scalars today (`ingredients.reorder_point`, `ingredients.par_level`) while
stock is per-branch (`ingredient_branch_stock`). That is a genuine modelling error for any
multi-branch tenant.

```sql
CREATE TABLE ingredient_branch_pars (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID          NOT NULL,
    branch_id            UUID          NOT NULL,
    ingredient_id        UUID          NOT NULL,
    reorder_point        NUMERIC(18,4) NOT NULL DEFAULT 0,
    par_level            NUMERIC(18,4) NOT NULL DEFAULT 0,
    safety_stock         NUMERIC(18,4) NOT NULL DEFAULT 0,
    -- NULL = manually set and pinned; non-null = last auto-computed, safe to recompute.
    auto_computed_at     TIMESTAMPTZ,
    ...audit...,
    CONSTRAINT uq_ibp UNIQUE (tenant_id, branch_id, ingredient_id)
);
-- + ENABLE/FORCE RLS + policy + GRANT
```

Resolution is **branch row → ingredient default → zero**, mirroring the most-specific-wins walk
`ItemCategoryService` already implements for GL accounts and variance caps. The ingredient-level
columns stay as the tenant-wide default (same treatment `ingredients.category` and
`storage_location` already received — kept, still written, no longer the sole source of truth).

### 6.3 Demand-derived suggestions

Everything needed is in `inventory_movements`: `Σ|DEPLETION|` per ingredient per day **is** daily
usage, already recipe-corrected.

```
avg_daily_usage  = Σ|DEPLETION| over the trailing N days ÷ N        (N tenant-configurable, default 28)
peak_daily_usage = 95th percentile of daily usage over the same window
lead_time_days   = vendor_items.lead_time_days ?? vendors.lead_time_days ?? tenant default

safety_stock  = (peak_daily − avg_daily) × lead_time_days
reorder_point = avg_daily × lead_time_days + safety_stock
par_level     = reorder_point + avg_daily × order_cycle_days
```

Computed nightly for ingredients whose `auto_computed_at` is non-null (i.e. not manually pinned),
written to `ingredient_branch_pars`, and **surfaced as a suggestion a manager accepts** rather than
silently applied. Reuse the `ExpirySweepService` cron shape verbatim — registry-based tenant
discovery, per-tenant GUC + `tenantFilter`, one transaction. It is the only pattern in this service
proven to work against FORCE RLS from a scheduler thread with no ambient context.

Day-of-week weighting matters in restaurants (Friday is not Tuesday) but is a refinement; ship the
flat trailing average first and make the window configurable.

### 6.4 Keep the refusal-to-guess discipline

`OrderSuggestionService`'s blocked-reason design is genuinely good and must survive. Add three:

- `STALE_PRICE` — the current price is older than the tenant's staleness threshold.
- `BELOW_MOQ_UNECONOMIC` — MOQ rounds a 2 kg shortfall up to a 25 kg sack.
- `NO_USAGE_HISTORY` — a new item with no `DEPLETION` history; the computed par is a guess.

And keep failing closed when inventory is unreachable (`InventoryUnavailableException`) — a partial
order list is worse than none, because the omitted items are precisely the ones about to run out.

---

## 7. Multi-unit handling: purchase in kg, consume in grams

### 7.1 The model, as built

Three layers exist; **only two are wired.**

| Layer | Table/field | Scope | Wired? |
|---|---|---|---|
| Within-dimension | `units_of_measure.to_base_factor` `NUMERIC(18,8)`, `base_unit_code`, `measure_type` | Tenant | **Yes** — `UomConverter`, `RecipeCostPreviewService`, `GrnUomResolver` |
| Purchase pack | `vendor_items.pack_units_per_order_unit` `NUMERIC(18,6)` + `pack_uom` | Tenant | **Yes** — split across two services (see below) |
| Cross-dimension | `ingredient_uom_conversions.factor` `NUMERIC(18,9)` | Per ingredient | **No** — written, echoed in a DTO, consulted by no calculation (§1.1) |

The **two-step purchase conversion** is the best-designed thing in the module and its ownership
split is correct:

- **Step 1 (purchasing):** order unit → pack unit. `GrnLine.qtyInPackUom()` multiplies by
  `qtyPerOrderUnit`; `unitCostPerPackUomPaisa()` divides the cost **by the same factor**, at scale 6,
  so quantity and cost can never disagree (`PurchasingEventContract.java:103-114`).
- **Step 2 (inventory):** pack unit → the ingredient's stock unit. `GrnUomResolver.toBaseUnits`.
  Inventory does this because only inventory owns `units_of_measure` — purchasing knows a carton
  holds 10 of something, only inventory knows what "kg" means to *this* ingredient.

`GrnUomResolver` **never throws**: an unknown or wrong-dimension pack code logs at ERROR and falls
back to factor 1. This is the right call (throwing would DLQ a batch after finance has already
posted GR/IR, turning a valuation error into a reconciliation gap) — **but it means a
misconfigured vendor catalog row silently receives a 10 kg carton as 10 grams and prices one gram
at the carton's cost.** The `is_catch_weight` flag on `VendorItem` is stored and never consulted by
any receipt path.

### 7.2 Where rounding is dangerous

**Correct today, and must stay that way:**

1. **The rate→amount boundary is single and centralised.** `MacCalculator.extendedCostPaisa` is the
   only place a `NUMERIC` rate becomes `BIGINT` paisa, HALF_UP, `longValueExact()`. Every caller —
   depletion COGS, wastage line cost, count variance, transfer lines, receipt totals — goes through
   it. **Do not add a second one.**
2. **`UomConverter.effectiveBaseQty` multiplies by `orderQty` *before* rounding.** Rounding a
   per-serving quantity and then multiplying by 40 covers would multiply the rounding error by 40.
   The current order is right (`UomConverter.java:39-44`).
3. **V12 correctly refuses to widen totals.** `total_cost_paisa`, `line_cost_paisa`,
   `variance_cost_paisa` stay `BIGINT` so journal entries balance in whole paisa. Only rates moved
   to `NUMERIC(18,4)`. That distinction is load-bearing and the migration comment explains it.

**Dangerous, and to be designed against:**

| # | Hazard | Mitigation |
|---|---|---|
| R1 | **Sub-paisa rates that round to zero.** A cheap bulk good bought in tonnes and consumed in grams can price below 0.0001 paisa/g. `NUMERIC(18,4)` floors it at zero and the stock is valued at nothing. `GrnUomResolver` used to clamp to 1 paisa; V12 removed the clamp (correctly — the clamp was a 3.2% error the other way). | Do not reintroduce a clamp. **Reject the receipt** when the derived per-unit cost rounds to zero but the pack cost was positive: that is a UOM configuration error, not a free delivery. Surface it as a validation failure on the vendor catalog row. |
| R2 | **Chained conversions.** `ingredient_uom_conversions`' javadoc mandates source → base → target in exactly two multiplications, never a third intermediate. Chaining kg→g→oz→lb compounds error at every hop. | When §7.3 wires this table up, enforce the two-multiplication rule in code, not just in prose. Reject a conversion that would need three hops. |
| R3 | **Per-line quantity rounding accumulated across a period.** Each `effectiveBaseQty` rounds to scale 4 **per (menu item × recipe line)**. Over 30,000 covers those roundings sum. | Harmless in grams (0.0001 g × 30,000 = 3 g). **Genuinely dangerous for COUNT-dimension ingredients with fractional portions** — half an egg, a third of a lemon. Mitigation: §3 derives theoretical usage by **summing the persisted `DEPLETION` rows**, never by recomputing from recipes. The ledger is the truth; the report agrees with it by construction. |
| R4 | **Division by yield percentage.** `yieldFraction = yieldPct / 100` at scale 8, then a divide. A `yield_pct` of 0 would divide by zero. `NUMERIC(6,2)` permits 0.00 and **there is no `CHECK (yield_pct > 0)` in V1**. | Add `CHECK (yield_pct > 0 AND yield_pct <= 100)` on `recipe_lines` and `CHECK (default_yield_pct > 0 AND default_yield_pct <= 100)` on `ingredients`. A yield above 100% is also nonsense and currently permitted. |
| R5 | **`recipes.yield_servings` is a divisor with no positivity constraint.** Same class of bug — `UomConverter` divides by `yieldFraction × recipeYieldServings`. | Add `CHECK (yield_servings > 0)`. |
| R6 | **Silent factor-1 fallback on GRN.** §7.1. A wrong pack UOM is a 1000× valuation error that logs at ERROR and succeeds. | Validate `pack_uom` against inventory's UOM registry **at vendor-catalog save time** (a `PackUomValidator` already exists in purchasing — extend it to call the existing `InventoryUomClient` rather than accepting free text). Fail the catalog row, not the receipt. |
| R7 | **`OrderSuggestionService` rounds `CEILING` at three successive steps** (pack size → order multiple → MOQ). Deliberate and correct — under-ordering is a stockout — but it compounds, and a 2 kg shortfall can become a 25 kg order. | Surface both quantities, which the DTO already does (`shortfallQty` in stock units, `orderQty` in order units) and which its javadoc explicitly justifies. Add the `BELOW_MOQ_UNECONOMIC` blocked reason (§6.4). |

### 7.3 Wire up the cross-dimension bridge

`ingredient_uom_conversions` is the answer to "the recipe says 2 tablespoons of oil, the stock is in
grams" and to "1 chicken = 1.4 kg". It is written by the ingredient form and read by nothing.

Give `UomConverter` a resolution chain, in order:

1. `line.uomCode == ingredient.baseUomCode` → factor 1.
2. Same dimension (`uom.baseUnitCode` equals-ignore-case `ingredient.baseUomCode`) →
   `units_of_measure.to_base_factor`. *(This is all that exists today.)*
3. **New:** an `ingredient_uom_conversions` row for `(from = line.uomCode, to = ingredient.baseUomCode)`
   → its `factor`. Exactly two multiplications, never chained (R2).
4. Otherwise → the line is unpriceable/undepleteable. `RecipeCostPreviewService` already has the
   right behaviour here (a per-line warning, excluded from the total, `excludedLineCount`
   incremented) — `DepletionService` currently **throws `IllegalStateException` on an unknown UOM
   code** (`DepletionService.java:116-117`), which DLQs the message and stops depleting the whole
   order. Change it to skip the line and fold it into `DEPLETION_INCOMPLETE`, which already exists
   for precisely this "surface it, never silently no-op, never block" purpose.

Note the case-sensitivity trap already discovered and fixed once: `RecipeCostPreviewService.dimensionMatches`
compares case-**insensitively** on both branches because "unit codes have never been normalised at
rest — fixtures write 'KG'/'G' while live tenant rows are lowercase 'g'". Any new comparison must do
the same. Better: normalise `units_of_measure.code` to upper case with a `CHECK` and a backfill.

---

## 8. Inter-branch transfers

Ship/receive/variance is the most complete lifecycle here. What it needs:

| Addition | Why |
|---|---|
| **Carry expiry across** (§5.1) | A transferred perishable currently becomes non-perishable. |
| **In-transit reconciliation** | `TRANSFER_SHIPPED` carries account 1320 valuation but nothing reconciles the balance. Add `GET /transfers/in-transit` returning shipped-not-received with age, and alert past a tenant-configurable threshold. Stock sitting in 1320 for three weeks is either lost or never shipped. |
| **Reject / return to sender** | `status` is `SHIPPED/RECEIVED/CANCELLED`. A destination that refuses a delivery has no path — the `receive` call throws if a line is missing. Add `REJECTED` plus a reverse transfer. |
| **Partial receive** | `receive` requires a line for every shipped ingredient (`TransferService`: missing line → `IllegalArgumentException`). Real deliveries arrive split. Allow a subset, leave the rest in transit. |
| **Transfer pricing policy** | Transfers move at the source branch's MAC. For a franchise or a tenant with inter-branch margin, that is not always right. Make it a tenant setting: `MAC` (default) \| `MAC_PLUS_PCT` \| `STANDARD_COST`. |
| **Request workflow** | Only push exists. A branch that is short must phone. Add `TRANSFER_REQUESTED` → approve → ship, reusing the wastage approval shape. |
| **Lot-level transfer** | Ship specific lots so `lot_code` traceability survives a transfer (§5.2). |

Tenant isolation is already sound — transfers are within one tenant across branches, both stock rows
are under the same `tenant_id` policy, and `receive` checks destination-branch ownership **before any
write** so a denied caller performs no side effect. Preserve that ordering in every addition.

---

## 9. Tenant configurability

*(Current-state configurability is a parallel agent's scope; this is only what **this** design adds.)*

New settings, all resolved most-specific-wins (reason → branch → tenant → system default), following
the `ItemCategoryService.resolveDefaultsByCategory` precedent:

| Setting | Level | Default |
|---|---|---|
| Wastage reason list (labels, GL, controllable, in-food-cost) | Tenant | 11 seeded system reasons |
| Wastage approval threshold | Reason → branch → tenant | Unlimited (no approval) |
| Wastage requires photo | Reason | False |
| Variance period cadence | Branch → tenant | Weekly |
| Variance investigation threshold (% and paisa) | Category → tenant | 2% / PKR 5,000 |
| Usage-history window for auto-par | Tenant | 28 days |
| Order cycle days | Branch → tenant | 7 |
| Expiry alert windows | Tenant | 7 / 3 / 0 days |
| Transfer pricing policy | Tenant | `MAC` |
| In-transit age alert | Tenant | 7 days |
| Price staleness threshold | Tenant | 90 days |

**New feature flags** — enforced in-service with `@RequiresFeature`, **not** by adding gateway
prefixes (`/api/v1/inventory/` already maps to `FEATURE_INVENTORY` at
`RouteFeatureMap.java:50`, and a sub-path prefix there would be a second, competing source of truth):

- `FEATURE_INVENTORY_VARIANCE` — the usage-variance report (§3)
- `FEATURE_INVENTORY_LOT_TRACKING` — lot codes and consumption traceability (§5.2)
- `FEATURE_RECIPE_COSTING` — persisted plate cost and menu margin (§4)

Tier state and `tenant_features.is_override` remain owned by platform-admin-service.

---

## 10. Frontend

Must fit the enforced 4-layer architecture (`api-client` → `repositories` → `adapters/schemas` →
`hooks`), which an ESLint `no-restricted-imports` rule enforces. Every new endpoint needs a Zod
schema in `lib/api-client/schemas/inventory.schema.ts`, a method in
`lib/repositories/inventory.repository.ts`, an adapter in `lib/adapters/inventory.adapter.ts`, and a
hook in `lib/hooks/inventory/use-inventory.ts` — the existing files, extended, not new parallel ones.

New surfaces:

| Route | Purpose |
|---|---|
| `app/(tenant)/app/inventory/wastage/page.tsx` | Record + list + approval queue. **This is the fix for W1 — the API has shipped and is unreachable.** |
| `app/(tenant)/app/inventory/variance/page.tsx` | Period list, report, ranked by unexplained cost |
| `app/(tenant)/app/inventory/expiry/page.tsx` | Expiring lots, one-tap write-off |
| `app/(tenant)/app/inventory/costing/page.tsx` | Plate costs, food-cost %, menu-margin matrix |
| `components/inventory/WastageDialog.tsx` | Fast capture: ingredient → qty → reason tile |
| Extend `stock/page.tsx` | Show pending write-off value, lot expiry column, last-counted age |

The wastage capture dialog is the one component whose interaction design decides whether any of
this works. It must be usable on a phone, in a kitchen, in under fifteen seconds.

---

## 11. Build order

| Wave | Work | Why here |
|---|---|---|
| **1 — Repair** | Wastage frontend (W1); reason table + `OVER_PORTIONING`/`PREP_ERROR` (W2/W3); wastage drains lots (W5/W6); GRN captures expiry; `shelf_life_days` derives expiry; FIFO `received_at` tiebreaker; `yield_pct`/`yield_servings` positivity CHECKs (R4/R5). | Small, mostly one-file, each turns already-shipped code from inert to live. Nothing below is trustworthy until waste is capturable and lots stay honest. |
| **2 — Measure** | `depletion_gaps` persistence (D4); `usage_variance_periods`/`_lines`; the variance report + live preview; count-lot reconciliation. | The headline feature. Depends on wave 1 because a variance report over lots that never drain is arithmetic with a hole in it. |
| **3 — Cost** | `recipe_cost_snapshots`; `default_yield_pct` as the line default; food-cost % (both definitions); menu-margin matrix. | Turns variance quantities into money people argue about. |
| **4 — Control** | Wastage approval workflow + dual control; new OPA actions; per-reason GL routing (W7); line-structured `WastageRecordedPayload` (W8). | Control on top of a measurement nobody trusts is theatre. Measure first. |
| **5 — Predict** | `ingredient_branch_pars`; demand-derived reorder/par; new blocked reasons; transfer in-transit reconciliation. | Needs the usage history wave 2 makes trustworthy. |
| **6 — Trace** | `stock_lot_consumptions`; lot codes; recall queries; cross-dimension conversions wired into `UomConverter` (§7.3). | Highest cost, narrowest audience, no dependency on it from anything above. |

**A real GRN** (replacing `GrnReceiptSimulator`/`mock_grn_receipts`) is a prerequisite for waves 2+
being trustworthy in production, but it belongs to the ERP-module-gap agent's scope. Flagging it
here because the default-on mock is load-bearing for every stock lot in the system.

---

## 12. Where I could not verify

- **I did not run the test suite.** All "this works" claims rest on reading the source plus reading
  the assertions in `LiveDepletionProofIT`, `WastageServiceIT`, `StockCountVarianceCapIT`,
  `FefoLotWalkTest`, `GrnReceivedConsumerIT` and `OrderSuggestionIT`. I did not confirm they pass.
- **I did not query a live database.** RLS policy *presence* is verified in the migration files; RLS
  *effectiveness* under the real `inventory_user` role is not (and open task #7 —
  "Close the Testcontainers superuser blind spot for RLS" — says the existing tests may not catch it
  either).
- **RabbitMQ topology at runtime.** Bindings are verified in `InventoryRabbitConfig` and against
  `deploy/init/rabbitmq-definitions.json` as referenced by its javadoc; I did not inspect a running
  broker.
- **OPA policy content.** I read `InventoryAuthorizationService` and confirmed it evaluates the
  `inventory` module with `inventory.item.view`/`inventory.item.manage`. I did **not** read
  `policies/restaurantos/inventory.rego`, so I cannot say which roles those actions actually grant —
  which matters for the §2.2 claim that a line cook can currently write off unlimited stock. The
  *authority model* (one manage-level check, no value ceiling, no approval) is verified from the
  controller; the *role mapping* is not.
- **Whether `FEATURE_INVENTORY` is enabled for any real tenant.** Feature state lives in
  platform-admin-service; I did not inspect `tenant_features`.
- **`GrnReceiptSimulator`'s per-line PO-membership check** (`:88-92`) looks like it re-queries all PO
  lines inside the loop — an N+1 and a possible correctness quirk — but that is a purchasing
  code-quality matter outside this brief and I did not chase it.
