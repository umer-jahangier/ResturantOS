-- A unit of measure can be retired. It is never deleted.
--
-- WHY (36-05, finding F-31-04). Until now `UnitOfMeasureController` exposed exactly two methods:
-- list and create. `PUT /api/v1/inventory/uom/{id}` and `POST .../archive` both answered 404 against
-- the live stack. Every other master-data entity in this service — ingredient, item category,
-- storage location — has update and archive. A tenant that mistyped a unit's name or its conversion
-- factor had no way to correct it, and a unit created by accident appeared in every picker forever.
-- Floating Terrace's registry currently contains a unit coded `TETS`, named "TEST", with a factor of
-- 5 grams. That is what the gap looks like in practice.
--
-- WHY A TIMESTAMP AND NOT A DELETE. A unit code is a foreign key BY VALUE across three services and
-- two databases: `ingredients.base_uom_code`, `ingredients.recipe_uom_code`,
-- `ingredient_uom_conversions.from_uom_code`/`to_uom_code`, and — in purchasing_db —
-- `vendor_items.pack_uom` and `pack_uom`-priced rows. Deleting the row would orphan every one of
-- them silently, and a goods receipt recorded last year in that unit would stop converting, which
-- makes the stock valuation it produced unreproducible. Retirement hides the unit from the pickers
-- and changes nothing else.
--
-- No backfill is needed: NULL means "live", which is what every existing row is.

ALTER TABLE units_of_measure ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN units_of_measure.archived_at IS
    'Non-null means retired: hidden from the pickers, still resolvable by every conversion path. '
    'A unit row is never deleted — its code is referenced by value from ingredients, conversion '
    'rows and purchasing_db.vendor_items, and none of those references can be followed backwards.';

-- Partial index: every picker read filters on this, and the live rows are the ones being read.
CREATE INDEX IF NOT EXISTS idx_uom_tenant_live
    ON units_of_measure (tenant_id)
    WHERE archived_at IS NULL;

-- RLS, per the inventory FORCE-RLS convention. Adding a column does not disturb an existing policy
-- and needs no NO FORCE window (V7 records the same, for the same table) — these statements are
-- idempotent restatements so that this table's protection is asserted in the migration that touches
-- it, rather than assumed from a migration eight files earlier. Postgres exempts a table's OWNER
-- from its own policy unless FORCE is set, and that exemption leaked sixteen tenants' data in this
-- project once already.
ALTER TABLE units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE units_of_measure FORCE ROW LEVEL SECURITY;
