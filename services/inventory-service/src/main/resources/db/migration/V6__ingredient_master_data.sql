-- Inventory Service - V6 Migration: ingredient master data (D-03, D-06, D-07, 08.2-09)
--
-- Turns `ingredients` into real, manageable master data: the industry-standard item field set
-- (short name, description, item type, measure type, recipe UOM, default yield, par level,
-- storage location, shelf life, perishable flag, archive-not-delete), plus two child tables for
-- per-item UOM conversions and allergens. Also gives D-07's recipe-header yield number its own
-- column on `recipes`. Additive only — every new `ingredients` column is nullable or defaulted,
-- so existing rows, stock lots, inventory movements and MAC history stay completely untouched;
-- nothing is dropped, retyped or renamed, including the legacy free-text `ingredients.category`
-- column, which stays exactly as V5 left it.

-- ── (1) ingredients master-data columns ─────────────────────────────────────
ALTER TABLE ingredients
    ADD COLUMN short_name VARCHAR(80),
    ADD COLUMN description TEXT,
    -- D-03: prep/sub-recipes are modelled here now (item_type + produced_by_recipe_id) even
    -- though the prep-recipe authoring UI is explicitly deferred out of this phase.
    ADD COLUMN item_type VARCHAR(20) NOT NULL DEFAULT 'PURCHASED'
        CHECK (item_type IN ('PURCHASED', 'PREPARED', 'BOTH')),
    ADD COLUMN produced_by_recipe_id UUID,
    -- D-06: measure type (WEIGHT/VOLUME/COUNT) is locked once any inventory movement or stock
    -- lot exists for the ingredient — enforced in IngredientService, not here.
    ADD COLUMN measure_type VARCHAR(10) NOT NULL DEFAULT 'COUNT'
        CHECK (measure_type IN ('WEIGHT', 'VOLUME', 'COUNT')),
    -- base_uom_code (V1) already is the stock UOM; this is the recipe UOM only — no separate
    -- stock-UOM column is introduced.
    ADD COLUMN recipe_uom_code VARCHAR(20),
    -- D-07: this is the item-level AP-to-EP trim yield — one of D-07's three distinct yield
    -- numbers. It is a different number from the per-recipe-line waste percentage that already
    -- exists on the recipe-BOM child table, and a different number again from the recipe-header
    -- net yield added to `recipes` below. Each of the three gets exactly one column; none is a
    -- general-purpose yield field.
    ADD COLUMN default_yield_pct NUMERIC(6, 2) NOT NULL DEFAULT 100.00,
    ADD COLUMN par_level NUMERIC(18, 4) NOT NULL DEFAULT 0,
    ADD COLUMN storage_location VARCHAR(80),
    ADD COLUMN shelf_life_days INT,
    ADD COLUMN is_perishable BOOLEAN NOT NULL DEFAULT false,
    -- D-04: archive, never hard-delete. NULL = live/active; set = archived, dropped from active
    -- pickers while every existing recipe, stock and purchase reference keeps working.
    ADD COLUMN archived_at TIMESTAMPTZ;

CREATE INDEX idx_ingredients_tenant_archived ON ingredients (tenant_id, archived_at);

-- ── (2) recipes.net_yield_pct — D-07's third and final yield number ────────
-- (a) This is D-07's recipe-header number, completing the set of three: item-level AP-to-EP
--     trim yield (ingredients.default_yield_pct, above), the pre-existing per-recipe-line waste
--     percentage column (untouched by this migration), and this recipe-header cooking/reduction
--     loss — the yield a batch loses between the sum of its raw lines and the finished quantity
--     a portion is cut from.
-- (b) The 100.00 default means every existing recipe version is explicitly "no reduction loss",
--     so no shipped plate cost moves as a result of adding this column.
-- (c) Authoring and cost consumption of this number are DEFERRED alongside the prep/sub-recipe
--     builder that CONTEXT.md's "Out of scope" section already defers — RecipeCostPreviewService
--     does not read it in this phase, and no ingredient-master-data UI exposes it. Modelling it
--     now is what keeps the additive-migrations-only constraint from forcing a second `recipes`
--     migration later. `recipes` is the version-header table from V1 (one row per version,
--     resolved by effective_from), so this number is versioned for free.
-- Because this is DDL with a constant default, RLS does not filter it and no backfill statement
-- is needed.
--
-- Scope guard: `recipes` is the only pre-existing table this migration touches besides
-- `ingredients`. The recipe-line table and its per-line waste column stay entirely out of this
-- migration.
ALTER TABLE recipes ADD COLUMN net_yield_pct NUMERIC(6, 2) NOT NULL DEFAULT 100.00;

-- ── (3) ingredient_uom_conversions — D-06/D-08 item-scoped cross-dimension bridges ──
-- Density, each-weight and pack-size conversions live here, per item, because purchase UOM
-- belongs to the vendor_item (not the ingredient) while stock/recipe UOM belong to the
-- ingredient itself. Conversion is always source -> base -> target in exactly two
-- multiplications (D-08) — never chained through a third intermediate unit.
CREATE TABLE ingredient_uom_conversions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    ingredient_id  UUID          NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    from_uom_code  VARCHAR(20)   NOT NULL,
    to_uom_code    VARCHAR(20)   NOT NULL,
    factor         NUMERIC(18, 9) NOT NULL CHECK (factor > 0),
    note           VARCHAR(160),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by     UUID,
    updated_by     UUID,
    deleted_at     TIMESTAMPTZ,
    CONSTRAINT uq_ingredient_conversion UNIQUE (tenant_id, ingredient_id, from_uom_code, to_uom_code)
);

ALTER TABLE ingredient_uom_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_uom_conversions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ingredient_uom_conversions
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON ingredient_uom_conversions TO inventory_user;

-- ── (4) ingredient_allergens ─────────────────────────────────────────────────
CREATE TABLE ingredient_allergens (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    ingredient_id  UUID          NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
    allergen_code  VARCHAR(30)   NOT NULL,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by     UUID,
    updated_by     UUID,
    deleted_at     TIMESTAMPTZ,
    CONSTRAINT uq_ingredient_allergen UNIQUE (tenant_id, ingredient_id, allergen_code)
);

ALTER TABLE ingredient_allergens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_allergens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ingredient_allergens
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON ingredient_allergens TO inventory_user;
