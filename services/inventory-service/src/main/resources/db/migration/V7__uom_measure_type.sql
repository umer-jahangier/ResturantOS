-- Inventory Service - V7 Migration: unit-of-measure dimension family (measure_type)
--
-- `units_of_measure` had no notion of which physical dimension a unit belongs to, so nothing
-- could stop an ingredient declaring `measure_type = 'COUNT'` while its `base_uom_code` pointed
-- at a weight unit. The dimension was only ever implicit, via the `base_unit_code` chain that
-- RecipeCostPreviewService.dimensionMatches walks — invisible to the ingredient form, which
-- rendered every unit in the tenant regardless of the selected measure type.
--
-- This makes the family explicit so IngredientService can reject mismatched pairs and the UI can
-- filter the Stock/Recipe unit selects. Mirrors the vocabulary `ingredients.measure_type` (V6)
-- already uses, including its CHECK constraint, so the two columns are directly comparable.
--
-- Additive only: one nullable-then-backfilled column plus a case-insensitive uniqueness index.
-- No row is deleted, retyped or renamed, and no seed data is inserted here — `units_of_measure`
-- is tenant-scoped under FORCE RLS, so there is no tenant to attribute rows to at migration time.
-- Per-tenant seeding is UomProvisioningService's job.

-- ── (1) measure_type ────────────────────────────────────────────────────────
ALTER TABLE units_of_measure ADD COLUMN measure_type VARCHAR(10);

-- Same NO FORCE window V5 used for its own backfill, and for the same reason: `units_of_measure`
-- has been FORCE ROW LEVEL SECURITY since V1, and the Flyway user owns it, so FORCE applies to
-- this session too. No migration sets app.current_tenant_id, which makes the tenant_isolation
-- predicate NULL for every row — the UPDATE below would match nothing and the SET NOT NULL two
-- statements later would then fail with "column measure_type contains null values".
--
-- This went unnoticed because it only bites a database that already HAS units: on a fresh schema
-- (every Testcontainers IT, and any brand-new deployment) the backfill has no rows to miss and
-- NOT NULL succeeds over an empty table. It fails on exactly the databases that matter — the ones
-- carrying real tenant data forward from V6.
ALTER TABLE units_of_measure NO FORCE ROW LEVEL SECURITY;

-- Backfill from the code itself. Case-insensitive because nothing has ever normalised the casing
-- of `code` — the test suite writes 'KG'/'G'/'EACH' while live tenant data uses lowercase 'g'.
-- Anything unrecognised falls to COUNT, matching V6's default for `ingredients.measure_type`.
UPDATE units_of_measure SET measure_type = CASE
    WHEN upper(code) IN ('G', 'GRAM', 'GRM', 'KG', 'KILOGRAM', 'MG', 'LB', 'LBS', 'OZ') THEN 'WEIGHT'
    WHEN upper(code) IN ('ML', 'L', 'LTR', 'LITRE', 'LITER', 'CL', 'DL',
                         'FLOZ', 'CUP', 'TBSP', 'TSP', 'GAL', 'PT', 'QT') THEN 'VOLUME'
    ELSE 'COUNT'
END
WHERE measure_type IS NULL;

-- Mandatory: close the window immediately. NO FORCE is table-wide, not session-scoped, so any
-- other connection reading through this role while it is open sees every tenant's rows.
ALTER TABLE units_of_measure FORCE ROW LEVEL SECURITY;

ALTER TABLE units_of_measure
    ALTER COLUMN measure_type SET DEFAULT 'COUNT',
    ALTER COLUMN measure_type SET NOT NULL,
    ADD CONSTRAINT ck_uom_measure_type CHECK (measure_type IN ('WEIGHT', 'VOLUME', 'COUNT'));

-- ── (2) A unit code means one unit, whatever its casing ─────────────────────
-- IngredientService resolves `base_uom_code`/`recipe_uom_code`/conversion codes case-insensitively
-- (a request may say 'KG' while the tenant's row is 'kg') and then stores the resolved row's own
-- code. That contract only holds if 'kg' and 'KG' cannot both exist for one tenant — the existing
-- uq_uom_tenant_code UNIQUE (tenant_id, code) permits exactly that, so tighten it here.
--
-- If this index fails to build, the tenant genuinely has two rows for one unit and the duplicate
-- must be merged by hand before deploying; failing at migration time is deliberate, because the
-- alternative is an ambiguous lookup silently picking one of them at runtime.
CREATE UNIQUE INDEX uq_uom_tenant_code_ci ON units_of_measure (tenant_id, upper(code));

-- ── (3) Provisioning lookup ─────────────────────────────────────────────────
-- UomProvisioningService reads the whole tenant set on every ingredient write and UOM list to
-- decide which standard units are missing; keep that a single index scan.
CREATE INDEX idx_uom_tenant_measure_type ON units_of_measure (tenant_id, measure_type);

-- ── (4) Repair existing ingredients that disagree with their own stock unit ──
-- IngredientService used to default a missing `measureType` to COUNT unconditionally, regardless
-- of the unit beside it in the same request — so live rows exist reading "measure type: COUNT,
-- stock unit: g". From V7 that pairing is rejected on write, which would leave exactly those rows
-- un-editable through the UI: the form would offer only COUNT units and refuse to save the item.
--
-- The stock unit is the trustworthy half of the pair (it is what every movement, valuation and
-- recipe conversion has actually been denominated in), so the measure type is realigned to it,
-- never the reverse. Rows whose `base_uom_code` does not resolve to a unit for their tenant are
-- deliberately left alone — there is nothing to derive a dimension from, and inventing one would
-- be worse than the 422 that now surfaces them for a human to fix.
--
-- Both tables need the window open: `ingredients` is the write target and `units_of_measure` is
-- read in the join, and an RLS-filtered read would make this repair silently do nothing — the
-- quieter half of the same bug that made step (1) fail loudly.
ALTER TABLE ingredients NO FORCE ROW LEVEL SECURITY;
ALTER TABLE units_of_measure NO FORCE ROW LEVEL SECURITY;

UPDATE ingredients i
SET measure_type = u.measure_type
FROM units_of_measure u
WHERE u.tenant_id = i.tenant_id
  AND upper(u.code) = upper(i.base_uom_code)
  AND i.measure_type <> u.measure_type;

-- Mandatory: no table may leave a migration with FORCE ROW LEVEL SECURITY disabled.
ALTER TABLE ingredients FORCE ROW LEVEL SECURITY;
ALTER TABLE units_of_measure FORCE ROW LEVEL SECURITY;
