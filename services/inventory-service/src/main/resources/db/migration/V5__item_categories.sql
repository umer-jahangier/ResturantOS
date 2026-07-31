-- Inventory Service - V5 Migration: item_categories master data (D-02, 08.2-01)
--
-- Turns the free-text ingredients.category column into first-class, self-referencing master
-- data: a 3-level-max tree (`item_categories`) enforced by a database trigger, plus a required
-- `ingredients.category_id` FK backfilled from the legacy free-text column. This is the single
-- deterministic category answer every downstream GL-derivation / spend-analytics plan depends
-- on (INV-13). Additive only — no existing column or table is dropped, renamed or retyped, so
-- stock_lots, inventory_movements, ingredient_branch_stock, recipes and recipe_lines (the
-- 08.1-proven depletion loop) stay completely untouched.

-- ── (1) item_categories ──────────────────────────────────────────────────────
CREATE TABLE item_categories (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                       UUID          NOT NULL,
    parent_id                       UUID          REFERENCES item_categories(id) ON DELETE RESTRICT,
    level                           SMALLINT      NOT NULL CHECK (level BETWEEN 1 AND 3),
    code                            VARCHAR(40),
    name                            VARCHAR(160)  NOT NULL,
    default_inventory_account_code VARCHAR(20),
    default_cost_account_code      VARCHAR(20),
    default_waste_account_code     VARCHAR(20),
    variance_cap_pct                NUMERIC(6,2),
    exclude_from_po_suggestions     BOOLEAN       NOT NULL DEFAULT false,
    sort_order                      INT           NOT NULL DEFAULT 0,
    archived_at                     TIMESTAMPTZ,
    created_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by                      UUID,
    updated_by                      UUID,
    deleted_at                      TIMESTAMPTZ,
    -- NULLS NOT DISTINCT (Postgres 16) so two sibling roots with the same name under a NULL
    -- parent still collide, exactly like two siblings under a real parent would.
    CONSTRAINT uq_item_category_tenant_parent_name UNIQUE NULLS NOT DISTINCT (tenant_id, parent_id, name)
);

CREATE INDEX idx_item_categories_tenant_parent ON item_categories (tenant_id, parent_id);

-- ── (2) enforce_item_category_depth() — D-02 hard cap ───────────────────────
-- This is the D-02 3-level cap. The service layer mirrors this check to produce a friendly
-- error, but this trigger is the actual enforcement point — a crafted request (or a future bug
-- in the service layer) cannot create a 4th-level node or graft a node onto another tenant's
-- tree, because the database itself refuses the row.
CREATE OR REPLACE FUNCTION enforce_item_category_depth() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    parent_level SMALLINT;
    parent_tenant_id UUID;
BEGIN
    IF NEW.parent_id IS NULL THEN
        IF NEW.level <> 1 THEN
            RAISE EXCEPTION 'item_categories: a root category (parent_id IS NULL) must have level = 1, got %', NEW.level
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NEW.parent_id = NEW.id THEN
            RAISE EXCEPTION 'item_categories: a category cannot be its own parent'
                USING ERRCODE = '23514';
        END IF;

        SELECT level, tenant_id INTO parent_level, parent_tenant_id
        FROM item_categories WHERE id = NEW.parent_id;

        IF parent_tenant_id IS DISTINCT FROM NEW.tenant_id THEN
            RAISE EXCEPTION 'item_categories: parent_id % belongs to a different tenant', NEW.parent_id
                USING ERRCODE = '23514';
        END IF;

        IF parent_level >= 3 THEN
            RAISE EXCEPTION 'item_categories: parent_id % is already at level 3, the maximum depth is 3 levels', NEW.parent_id
                USING ERRCODE = '23514';
        END IF;

        IF NEW.level <> parent_level + 1 THEN
            RAISE EXCEPTION 'item_categories: level % must be exactly one greater than parent level %', NEW.level, parent_level
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_item_category_depth
    BEFORE INSERT OR UPDATE ON item_categories
    FOR EACH ROW EXECUTE FUNCTION enforce_item_category_depth();

-- ── (3) ingredients.category_id (nullable until the backfill completes) ─────
ALTER TABLE ingredients ADD COLUMN category_id UUID;

-- ── (4) Backfill from the legacy free-text ingredients.category column ──────
-- In production the Flyway user owns `ingredients`, and `ingredients` is FORCE ROW LEVEL
-- SECURITY. With no app.current_tenant_id GUC set during a migration run, the tenant_isolation
-- predicate evaluates to NULL for every row, so both the read and the write below would
-- silently touch zero rows. We therefore temporarily relax FORCE RLS for this backfill only,
-- and close the window again immediately afterwards with an explicit re-FORCE — this must
-- never be left open across a migration boundary. This step MUST run before step (5) enables
-- RLS on item_categories, otherwise the INSERT below would be filtered the same way.
ALTER TABLE ingredients NO FORCE ROW LEVEL SECURITY;

INSERT INTO item_categories (tenant_id, parent_id, level, name)
SELECT DISTINCT tenant_id, NULL::UUID, 1, COALESCE(NULLIF(btrim(category), ''), 'Uncategorized')
FROM ingredients;

UPDATE ingredients i
SET category_id = c.id
FROM item_categories c
WHERE c.tenant_id = i.tenant_id
  AND c.parent_id IS NULL
  AND c.name = COALESCE(NULLIF(btrim(i.category), ''), 'Uncategorized');

-- Mandatory: close the NO FORCE window opened above. ingredients must never leave this
-- migration with FORCE ROW LEVEL SECURITY disabled.
ALTER TABLE ingredients FORCE ROW LEVEL SECURITY;

-- ── (5) Make category_id required, RESTRICT-only, indexed ───────────────────
ALTER TABLE ingredients ALTER COLUMN category_id SET NOT NULL;
ALTER TABLE ingredients ADD CONSTRAINT fk_ingredient_category
    FOREIGN KEY (category_id) REFERENCES item_categories(id) ON DELETE RESTRICT;
CREATE INDEX idx_ingredients_tenant_category ON ingredients (tenant_id, category_id);

-- NOTE: ingredients.category (the legacy free-text column) is intentionally retained,
-- unmodified, for history. It is no longer the source of truth for category assignment —
-- category_id above is — and application code stops reading it in plan 08.2-09.

-- ── (6) RLS on item_categories, per the inventory FORCE-RLS convention ──────
ALTER TABLE item_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_categories
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON item_categories TO inventory_user;
