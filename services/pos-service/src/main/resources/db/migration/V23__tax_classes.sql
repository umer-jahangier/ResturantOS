-- ============================================================================
-- F16 — Sales-tax classes: a rate a human named, inherited by a category,
--       overridable on one dish, and SNAPSHOTTED onto the order line.
-- ============================================================================
-- ══ WHAT WAS ACTUALLY WRONG ══
--
-- There was no sales-tax configuration anywhere in the product. `menu_items` carried
-- `tax_rate_pct` and `tax_rate_code` and the only way to set either was one item at a time
-- in the item dialog — which only grew those two fields at all when S0-03 closed a data-loss
-- bug in the same columns. The consequence was measured in the walkthrough's own bill:
-- a Rs 1,657.00 dine-in subtotal taxed Rs 25.60 — 1.5% — because two Butter Naans carried
-- 16% and every other line on the check carried nothing. Live read on 2026-08-12:
-- 40 items, 6 at 16.00%, 1 at 17.00%, the rest 0.00%, and `tax_rate_code` null on 39 of 40.
--
-- Nobody set those rates wrong. There was nowhere to set them right.
--
-- ══ THE SHAPE ══
--
-- `tax_classes` is the tenant's catalogue of rates: a code the tax authority recognises, a
-- name a person recognises, and a rate. `menu_categories.tax_class_id` is the rule
-- ("everything in Mains is standard-rated"); `menu_items.tax_class_id` is the exception on
-- one dish. This is deliberately the SAME rule/exception shape as V16's station routes,
-- resolved by one server-side class (TaxClassResolver) for the same reason
-- StationRoutingResolver exists: a second copy of a resolution order in TypeScript is a
-- second answer, and the two disagree the first time a step is added.
--
-- ══ WHY THE LEGACY COLUMNS STAY ══
--
-- `menu_items.tax_rate_pct` / `tax_rate_code` are NOT dropped and NOT backfilled into
-- classes. They become the LAST step of the resolution order — the per-item custom rate for
-- an item that belongs to no class. Every tenant on the day this ships has exactly that
-- data and nothing else, so their bills keep computing the identical figure they computed
-- yesterday. Migrating them would require inventing a class name for "16.00% with no code",
-- and a fabricated fiscal classification is worse than an honest custom rate.
--
-- ══ THE ORDER-LINE SNAPSHOT ══
--
-- `order_items` recorded `tax_paisa` and nothing about WHERE it came from. The printed bill's
-- tax breakdown therefore re-read the LIVE `menu_items` row at print time: reprint a
-- three-week-old receipt after a rate change and the paper attributed old money to a new
-- rate, and an item that had since been re-classified moved its tax into a bucket it never
-- paid into. The three new columns freeze rate, code and label at add-item time, exactly as
-- `unit_price_paisa` and `item_name_snapshot` already are on the same row and for the same
-- reason.
--
-- NOT NULL DEFAULT on `tax_rate_pct`, never ADD-then-UPDATE: `order_items` carries FORCE ROW
-- LEVEL SECURITY, Flyway runs as the owner with no `app.current_tenant_id` GUC, so an UPDATE
-- backfill matches zero rows while a later SET NOT NULL sees every one of them and refuses.
-- V22 shipped that exact mistake and could not boot. The default is applied by the table
-- rewrite, to every row, regardless of policy.
--
-- ══ ROW LEVEL SECURITY ══
--
-- tenant_isolation + ENABLE + FORCE, per V11's posture. RlsForcedInvariantIT fails the build
-- otherwise and is not to be modified to accommodate this table.
-- ============================================================================

-- ── tax_classes ─────────────────────────────────────────────────────────────
CREATE TABLE tax_classes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID          NOT NULL,
    -- The tax authority's code. UNIQUE per tenant because it is the identity of the bucket
    -- the money reconciles into: two classes sharing a code would split one line of a tax
    -- return across two rates with nothing on screen saying which was which.
    code       VARCHAR(40)   NOT NULL,
    name       VARCHAR(120)  NOT NULL,
    rate_pct   NUMERIC(5,2)  NOT NULL,
    active     BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by UUID,
    updated_by UUID,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_tax_classes_rate CHECK (rate_pct >= 0 AND rate_pct <= 100)
);

-- Partial on deleted_at: a soft-deleted class must not block a tenant re-creating the same
-- code, which is the normal way somebody fixes a typo in a rate they have already retired.
CREATE UNIQUE INDEX uq_tax_classes_tenant_code
    ON tax_classes (tenant_id, upper(code)) WHERE deleted_at IS NULL;

ALTER TABLE tax_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_classes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_classes
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_classes TO pos_user;

COMMENT ON TABLE tax_classes IS
    'Tenant catalogue of sales-tax rates. A menu category names one as its default; a menu item may name one as an override. Resolved by TaxClassResolver.';

-- ── the rule and the exception ──────────────────────────────────────────────
-- ON DELETE RESTRICT, not SET NULL: silently un-taxing a whole category because somebody
-- removed a rate is the failure this whole item exists to stop. TaxClassServiceImpl refuses
-- the delete with a message naming what still uses it.
ALTER TABLE menu_categories
    ADD COLUMN IF NOT EXISTS tax_class_id UUID REFERENCES tax_classes(id);
ALTER TABLE menu_items
    ADD COLUMN IF NOT EXISTS tax_class_id UUID REFERENCES tax_classes(id);

CREATE INDEX idx_menu_categories_tax_class ON menu_categories (tax_class_id);
CREATE INDEX idx_menu_items_tax_class ON menu_items (tax_class_id);

COMMENT ON COLUMN menu_categories.tax_class_id IS
    'The default tax class for every item in this category. NULL = no category rule.';
COMMENT ON COLUMN menu_items.tax_class_id IS
    'This item''s OVERRIDE. NULL means inherit the category rule — it does not mean zero-rated.';

-- ── the order-line snapshot ─────────────────────────────────────────────────
ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS tax_rate_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_rate_code  VARCHAR(40),
    ADD COLUMN IF NOT EXISTS tax_class_name VARCHAR(120);

COMMENT ON COLUMN order_items.tax_rate_pct IS
    'The rate this line was actually charged at, frozen at add-item time. Pre-F16 rows default to 0 and their tax_paisa is authoritative; the receipt assembler groups those under UNCLASSIFIED rather than borrowing a rate they never carried.';
COMMENT ON COLUMN order_items.tax_rate_code IS
    'Fiscal code this line reconciles under, frozen at add-item time. NULL = unclassified.';
COMMENT ON COLUMN order_items.tax_class_name IS
    'Human name of the class at the time of sale ("Standard rate"), so a bill printed today and reprinted next year say the same words.';
