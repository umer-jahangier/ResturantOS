-- Purchasing Service - V6 Migration: name the pack factor after what it holds
--
-- `qty_per_order_unit_in_stock_uom` (V5) says "in stock UOM" and is not. It holds how many PACK
-- units one ORDER unit contains — a case of 10 kg is 10, denominated in `pack_uom`, never in the
-- ingredient's stock unit. Nothing in this service could put it in stock units even in principle:
-- `units_of_measure` lives in inventory-service's database, so the pack-unit-to-stock-unit leg is
-- resolved there, on receipt, by GrnUomResolver.
--
-- The name was not harmless. It described a conversion that had never been applied, which is
-- exactly why a 10 kg case received against a gram-stocked ingredient added 10 grams: the column
-- claimed the hard half of the work was already done. Renaming it removes the claim.
--
-- Pure rename. Same type, same nullability, same data — RENAME COLUMN is a catalog-only operation
-- in PostgreSQL, so there is no table rewrite and no DML, and therefore no RLS/NO FORCE window is
-- needed (unlike V5's own backfill).

ALTER TABLE vendor_items
    RENAME COLUMN qty_per_order_unit_in_stock_uom TO pack_units_per_order_unit;

COMMENT ON COLUMN vendor_items.pack_units_per_order_unit IS
    'How many pack_uom units one order_uom unit holds — a case of 10 kg is 10. NOT in the '
    'ingredient''s stock unit: that conversion belongs to inventory-service, which owns the unit '
    'registry, and is applied on goods receipt.';
