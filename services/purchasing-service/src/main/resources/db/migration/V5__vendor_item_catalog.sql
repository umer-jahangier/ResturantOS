-- Purchasing Service V5 — vendor item catalog (PUR-07, PUR-08)
--
-- vendor_catalogues (V1) has existed since the service's first migration and is 100% dead code —
-- no entity, repository, controller or frontend ever read or wrote it. This migration supersedes
-- it with a real catalog that can price a PO line and support a three-way match: `vendor_items`
-- (vendor SKU, pack size, purchase UOM, MOQ, lead time) pointing at exactly one ingredient per
-- row (many vendor_items may point at the same ingredient — a vendor legitimately sells the same
-- ingredient in more than one pack size), append-only effective-dated `vendor_item_prices`, and
-- filter/suggestion-only `vendor_categories` tags. Additive only: `vendor_catalogues` is left
-- completely untouched and dropping it is deliberately out of scope for this migration; no
-- existing purchasing column is dropped, renamed or retyped.

-- ── (1) vendor_items ─────────────────────────────────────────────────────────
CREATE TABLE vendor_items (
    id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                           UUID NOT NULL,
    vendor_id                           UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    -- ingredient_id is a deliberate cross-service soft reference: ingredients live in
    -- inventory_db, a separate database, so no FK is possible here. Service-layer validation
    -- (plan 08.2-08) resolves the ingredient under the caller's tenant before a write.
    ingredient_id                       UUID NOT NULL,
    vendor_sku                          VARCHAR(80),
    vendor_description                  VARCHAR(240),
    gtin                                VARCHAR(20),
    order_uom                           VARCHAR(20) NOT NULL,
    pack_description                    VARCHAR(80),
    pack_qty                            NUMERIC(18,4) NOT NULL DEFAULT 1,
    pack_uom                            VARCHAR(20) NOT NULL,
    qty_per_order_unit_in_stock_uom     NUMERIC(18,6),
    min_order_qty                       NUMERIC(18,4),
    order_multiple                      NUMERIC(18,4),
    lead_time_days                      INT,
    is_preferred                        BOOLEAN NOT NULL DEFAULT false,
    is_catch_weight                     BOOLEAN NOT NULL DEFAULT false,
    archived_at                         TIMESTAMPTZ,
    created_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                          UUID,
    updated_by                          UUID,
    deleted_at                          TIMESTAMPTZ,
    -- NULLS NOT DISTINCT so two vendor_items with no vendor_sku still collide the same way two
    -- vendor_items sharing a real vendor_sku would.
    CONSTRAINT uq_vendor_item_tenant_vendor_sku UNIQUE NULLS NOT DISTINCT (tenant_id, vendor_id, vendor_sku)
    -- Deliberately NO unique constraint on (tenant_id, vendor_id, ingredient_id): a vendor
    -- legitimately sells the same ingredient in more than one pack size.
);

CREATE INDEX idx_vendor_items_tenant_vendor ON vendor_items (tenant_id, vendor_id);
CREATE INDEX idx_vendor_items_tenant_ingredient ON vendor_items (tenant_id, ingredient_id);

ALTER TABLE vendor_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vendor_items
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_items TO purchasing_user;

-- ── (2) vendor_item_prices — append-only, effective-dated (D-01 / RESEARCH §9.3 call 5) ────
-- A price change inserts a new row and closes the prior row's effective_to; there is no in-place
-- price UPDATE anywhere in the application. This is what makes price-change reporting,
-- contract-compliance checks and correct historical costing possible.
CREATE TABLE vendor_item_prices (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL,
    vendor_item_id    UUID NOT NULL REFERENCES vendor_items(id) ON DELETE RESTRICT,
    branch_id         UUID,
    unit_price_paisa  BIGINT NOT NULL,
    price_uom         VARCHAR(20) NOT NULL,
    effective_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to      TIMESTAMPTZ,
    source            VARCHAR(20) NOT NULL DEFAULT 'MANUAL'
        CHECK (source IN ('CATALOG', 'CONTRACT', 'INVOICE', 'MANUAL')),
    is_contract_price BOOLEAN NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by        UUID,
    updated_by        UUID,
    deleted_at        TIMESTAMPTZ
);

CREATE INDEX idx_vendor_item_prices_item_effective
    ON vendor_item_prices (tenant_id, vendor_item_id, effective_from DESC);

ALTER TABLE vendor_item_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vendor_item_prices
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_item_prices TO purchasing_user;

-- ── (3) vendor_categories — filter/suggestion tags only (D-01) ──────────────
-- These tags exist only to filter pickers and suggest a default vendor for items with no
-- preferred vendor; a category assignment is never the gate that lets a purchase happen. No
-- column here names a purchase-gating concept — that decision belongs entirely to vendor_items
-- and the service layer.
CREATE TABLE vendor_categories (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL,
    vendor_id     UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    -- category_id is a cross-service soft reference to inventory-service's item_categories.
    category_id   UUID NOT NULL,
    -- Denormalized label so the vendor page renders without a cross-service call.
    category_name VARCHAR(160),
    is_preferred  BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_by    UUID,
    deleted_at    TIMESTAMPTZ,
    CONSTRAINT uq_vendor_category UNIQUE (tenant_id, vendor_id, category_id)
);

ALTER TABLE vendor_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vendor_categories
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON vendor_categories TO purchasing_user;

-- ── (4) purchase_order_lines.vendor_item_id — nullable, historical lines predate the catalog ──
ALTER TABLE purchase_order_lines
    ADD COLUMN vendor_item_id UUID REFERENCES vendor_items(id) ON DELETE RESTRICT;

CREATE INDEX idx_po_lines_vendor_item ON purchase_order_lines (vendor_item_id);
