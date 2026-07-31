-- Inventory Service - V1 Schema Migration
-- Creates the complete Phase-8 domain schema: UOM, ingredients, branch stock, lot tracking (FEFO),
-- versioned recipes/BOM, inventory movements, inter-branch transfers, and stock counts.
--
-- All 11 domain tables use RLS for tenant isolation, and — unlike the finance/kitchen precedent
-- (which omit the FORCE clause) — every table here also runs ALTER TABLE ... FORCE ROW LEVEL
-- SECURITY from V1, per CONTEXT.md's explicit mandate. Every policy wraps the GUC in NULLIF(...,'')
-- before casting to ::UUID, avoiding the empty-GUC cast crash that required finance-service's V4 hotfix.
--
-- Audit columns match TenantAuditableEntity: tenant_id, created_at, updated_at, created_by,
-- updated_by, deleted_at. Quantities are NUMERIC(18,4); UOM conversion factors are NUMERIC(18,8);
-- all cost/money columns are BIGINT paisa.

-- ── units_of_measure ─────────────────────────────────────────
CREATE TABLE units_of_measure (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID         NOT NULL,
    code           VARCHAR(20)  NOT NULL,
    name           VARCHAR(120) NOT NULL,
    base_unit_code VARCHAR(20),
    to_base_factor NUMERIC(18,8) NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by     UUID,
    updated_by     UUID,
    deleted_at     TIMESTAMPTZ,
    CONSTRAINT uq_uom_tenant_code UNIQUE (tenant_id, code)
);

ALTER TABLE units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE units_of_measure FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON units_of_measure
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── ingredients ──────────────────────────────────────────────
CREATE TABLE ingredients (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID          NOT NULL,
    name           VARCHAR(160)  NOT NULL,
    sku            VARCHAR(60),
    base_uom_code  VARCHAR(20)   NOT NULL,
    category       VARCHAR(80),
    reorder_point  NUMERIC(18,4) NOT NULL DEFAULT 0,
    is_active      BOOLEAN       NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by     UUID,
    updated_by     UUID,
    deleted_at     TIMESTAMPTZ,
    CONSTRAINT uq_ingredient_tenant_sku UNIQUE (tenant_id, sku)
);

ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ingredients
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── ingredient_branch_stock ──────────────────────────────────
CREATE TABLE ingredient_branch_stock (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL,
    branch_id       UUID          NOT NULL,
    ingredient_id   UUID          NOT NULL REFERENCES ingredients(id),
    qty_on_hand     NUMERIC(18,4) NOT NULL DEFAULT 0,
    avg_cost_paisa  BIGINT        NOT NULL DEFAULT 0,
    last_counted_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT uq_stock_tenant_branch_ingredient UNIQUE (tenant_id, branch_id, ingredient_id)
);

ALTER TABLE ingredient_branch_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_branch_stock FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ingredient_branch_stock
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── stock_lots (D-04: lot tracking + FEFO source of truth) ───
CREATE TABLE stock_lots (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID          NOT NULL,
    branch_id               UUID          NOT NULL,
    ingredient_id           UUID          NOT NULL,
    stock_id                UUID          NOT NULL REFERENCES ingredient_branch_stock(id),
    qty                     NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (qty >= 0),
    expiry_date             DATE,
    receipt_unit_cost_paisa BIGINT        NOT NULL DEFAULT 0,
    received_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    source_movement_id      UUID,
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by              UUID,
    updated_by              UUID,
    deleted_at              TIMESTAMPTZ
);

ALTER TABLE stock_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_lots FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_lots
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_inventory_lots_fefo ON stock_lots (tenant_id, branch_id, ingredient_id, expiry_date);

-- ── recipes (D-01: versioned, resolved by effective_from at order time) ──
CREATE TABLE recipes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL,
    menu_item_id    UUID          NOT NULL,
    version         INT           NOT NULL,
    is_current      BOOLEAN       NOT NULL DEFAULT true,
    effective_from  TIMESTAMPTZ   NOT NULL,
    yield_servings  NUMERIC(18,4) NOT NULL DEFAULT 1,
    name            VARCHAR(160),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT uq_recipe_tenant_menuitem_version UNIQUE (tenant_id, menu_item_id, version)
);

ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recipes
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_inventory_recipe_effective ON recipes (tenant_id, menu_item_id, effective_from);

-- ── recipe_lines (BOM) ───────────────────────────────────────
CREATE TABLE recipe_lines (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL,
    recipe_id     UUID          NOT NULL REFERENCES recipes(id),
    ingredient_id UUID          NOT NULL,
    qty           NUMERIC(18,4) NOT NULL,
    uom_code      VARCHAR(20)   NOT NULL,
    yield_pct     NUMERIC(6,2)  NOT NULL DEFAULT 100,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_by    UUID,
    deleted_at    TIMESTAMPTZ
);

ALTER TABLE recipe_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recipe_lines
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── inventory_movements (typed ledger: OPENING_BALANCE, RECEIPT, DEPLETION, ...) ──
CREATE TABLE inventory_movements (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID          NOT NULL,
    branch_id        UUID          NOT NULL,
    ingredient_id    UUID          NOT NULL,
    movement_type    VARCHAR(24)   NOT NULL
        CHECK (movement_type IN ('OPENING_BALANCE','RECEIPT','DEPLETION','TRANSFER_OUT',
                                  'TRANSFER_IN','COUNT_VARIANCE','WASTAGE','TRANSFER_VARIANCE')),
    qty              NUMERIC(18,4) NOT NULL,
    unit_cost_paisa  BIGINT        NOT NULL DEFAULT 0,
    total_cost_paisa BIGINT        NOT NULL DEFAULT 0,
    reference_type   VARCHAR(40),
    reference_id     UUID,
    movement_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_by       UUID,
    deleted_at       TIMESTAMPTZ
);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_movements
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_inventory_movements_branch_time ON inventory_movements (tenant_id, branch_id, movement_at);

-- ── stock_transfers (inter-branch ship/receive) ─────────────
CREATE TABLE stock_transfers (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID        NOT NULL,
    from_branch_id UUID        NOT NULL,
    to_branch_id   UUID        NOT NULL,
    status         VARCHAR(16) NOT NULL DEFAULT 'SHIPPED'
        CHECK (status IN ('SHIPPED','RECEIVED','CANCELLED')),
    shipped_at     TIMESTAMPTZ,
    received_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by     UUID,
    updated_by     UUID,
    deleted_at     TIMESTAMPTZ
);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_transfers
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── stock_transfer_lines ─────────────────────────────────────
CREATE TABLE stock_transfer_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL,
    transfer_id     UUID          NOT NULL REFERENCES stock_transfers(id),
    ingredient_id   UUID          NOT NULL,
    qty_shipped     NUMERIC(18,4) NOT NULL,
    qty_received    NUMERIC(18,4),
    variance_qty    NUMERIC(18,4) NOT NULL DEFAULT 0,
    unit_cost_paisa BIGINT        NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    deleted_at      TIMESTAMPTZ
);

ALTER TABLE stock_transfer_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_transfer_lines
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── stock_counts ─────────────────────────────────────────────
CREATE TABLE stock_counts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    branch_id   UUID        NOT NULL,
    status      VARCHAR(16) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','POSTED')),
    counted_at  TIMESTAMPTZ,
    posted_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_by  UUID,
    deleted_at  TIMESTAMPTZ
);

ALTER TABLE stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_counts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_counts
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── stock_count_lines ────────────────────────────────────────
CREATE TABLE stock_count_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID          NOT NULL,
    count_id            UUID          NOT NULL REFERENCES stock_counts(id),
    ingredient_id       UUID          NOT NULL,
    system_qty          NUMERIC(18,4) NOT NULL DEFAULT 0,
    counted_qty         NUMERIC(18,4) NOT NULL DEFAULT 0,
    variance_qty        NUMERIC(18,4) NOT NULL DEFAULT 0,
    variance_cost_paisa BIGINT        NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_by          UUID,
    deleted_at          TIMESTAMPTZ
);

ALTER TABLE stock_count_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_count_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_count_lines
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
