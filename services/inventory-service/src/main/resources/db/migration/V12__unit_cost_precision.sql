-- Inventory Service - V12 Migration: fractional precision for PER-UNIT costs
--
-- Every cost in this schema was BIGINT paisa, which is exactly right for a TOTAL — you cannot pay
-- a fraction of a paisa — and wrong for a cost PER STOCK UNIT, which is a rate, not an amount.
--
-- The distinction did not bite while stock was received in the same unit it was priced in. It
-- became the normal case once goods receipts started converting the vendor's pack unit into the
-- ingredient's stock unit (the 08.x GRN conversion seam): an ingredient stocked in grams and
-- bought by the kilogram now derives its unit cost by dividing. PKR 100/kg is 10 paisa/g exactly;
-- PKR 62/kg is 6.2 paisa/g, which rounded to 6 — a 3.2% valuation error carried into
-- moving-average cost, and from there into COGS, food-cost % and gross margin. Cheap bulk goods
-- are the worst case precisely because their per-gram cost is smallest.
--
-- NUMERIC(18,4) gives four decimal places of a paisa: 0.0001 paisa per gram is PKR 1 per tonne,
-- comfortably finer than any real purchase price, and the same scale `qty` already uses.
--
-- WHAT IS DELIBERATELY NOT WIDENED
--   inventory_movements.total_cost_paisa  - an extended amount; real money, correctly integral
--   every *_cost_paisa total on the wire  - cogsPaisa, lineCostPaisa, varianceCostPaisa, etc.
-- Totals stay BIGINT so journal entries keep balancing in whole paisa. Only the rates move.
--
-- RLS: pure DDL, no DML. Unlike V5's and V7's backfills, `ALTER COLUMN ... TYPE` is not subject to
-- row-level security, so this needs no NO FORCE window — every existing row is retyped by the
-- table rewrite regardless of app.current_tenant_id. Widening BIGINT -> NUMERIC(18,4) is lossless
-- and total: 62 becomes 62.0000, nothing can overflow, nothing rounds.

-- ── moving-average cost per stock unit ──────────────────────────────────────
ALTER TABLE ingredient_branch_stock
    ALTER COLUMN avg_cost_paisa TYPE NUMERIC(18,4),
    ALTER COLUMN avg_cost_paisa SET DEFAULT 0;

-- ── a lot's receipt cost per stock unit (FEFO valuation) ────────────────────
ALTER TABLE stock_lots
    ALTER COLUMN receipt_unit_cost_paisa TYPE NUMERIC(18,4),
    ALTER COLUMN receipt_unit_cost_paisa SET DEFAULT 0;

-- ── the typed movement ledger's per-unit rate (total_cost_paisa stays BIGINT) ─
ALTER TABLE inventory_movements
    ALTER COLUMN unit_cost_paisa TYPE NUMERIC(18,4),
    ALTER COLUMN unit_cost_paisa SET DEFAULT 0;

-- ── inter-branch transfers value each line at the shipping branch's MAC ─────
ALTER TABLE stock_transfer_lines
    ALTER COLUMN unit_cost_paisa TYPE NUMERIC(18,4),
    ALTER COLUMN unit_cost_paisa SET DEFAULT 0;

-- ── wastage is written off at MAC too (V11) ─────────────────────────────────
ALTER TABLE stock_wastage_lines
    ALTER COLUMN unit_cost_paisa TYPE NUMERIC(18,4),
    ALTER COLUMN unit_cost_paisa SET DEFAULT 0;

COMMENT ON COLUMN ingredient_branch_stock.avg_cost_paisa IS
    'Moving-average cost of ONE stock unit, in paisa, to 4 decimal places. A rate, not an amount: '
    'an ingredient stocked in grams and bought by the kilogram has a fractional per-gram cost.';
COMMENT ON COLUMN inventory_movements.total_cost_paisa IS
    'Extended amount in whole paisa. Deliberately BIGINT - this is money, not a rate.';
