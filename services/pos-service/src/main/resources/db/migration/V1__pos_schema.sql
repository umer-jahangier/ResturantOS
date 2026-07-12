-- ============================================================
-- POS Service - V1 Schema Migration
-- Creates: menu_categories, menu_items, branch_menu_overrides,
--          modifier_groups, modifiers, dining_tables, orders,
--          order_items, order_item_modifiers, order_discounts,
--          order_sequences + RLS on every tenant table
-- All money in BIGINT paisa (1 PKR = 100 paisa)
-- ============================================================

-- ── menu_categories ─────────────────────────────────────────
CREATE TABLE menu_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    sort_order  INT          NOT NULL DEFAULT 0,
    active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_by  UUID,
    deleted_at  TIMESTAMPTZ,
    CONSTRAINT uq_menu_category_tenant_name UNIQUE (tenant_id, name)
);

ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_categories
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── menu_items ───────────────────────────────────────────────
CREATE TABLE menu_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL,
    category_id     UUID          NOT NULL REFERENCES menu_categories(id),
    name            VARCHAR(150)  NOT NULL,
    description     TEXT,
    base_price_paisa BIGINT       NOT NULL DEFAULT 0,
    tax_rate_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0,
    tax_rate_code   TEXT,
    kds_station     TEXT,
    active          BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    deleted_at      TIMESTAMPTZ
);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_items
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_menu_items_category ON menu_items (category_id);

-- ── branch_menu_overrides ────────────────────────────────────
CREATE TABLE branch_menu_overrides (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID    NOT NULL,
    branch_id       UUID    NOT NULL,
    menu_item_id    UUID    NOT NULL REFERENCES menu_items(id),
    price_paisa     BIGINT,
    active          BOOLEAN,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT uq_branch_menu_override UNIQUE (tenant_id, branch_id, menu_item_id)
);

ALTER TABLE branch_menu_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branch_menu_overrides
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── modifier_groups ──────────────────────────────────────────
CREATE TABLE modifier_groups (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL,
    menu_item_id UUID        NOT NULL REFERENCES menu_items(id),
    name        VARCHAR(100) NOT NULL,
    required    BOOLEAN      NOT NULL DEFAULT FALSE,
    min_select  INT          NOT NULL DEFAULT 0,
    max_select  INT          NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_by  UUID,
    deleted_at  TIMESTAMPTZ
);

ALTER TABLE modifier_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modifier_groups
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── modifiers ────────────────────────────────────────────────
CREATE TABLE modifiers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID         NOT NULL,
    modifier_group_id   UUID         NOT NULL REFERENCES modifier_groups(id),
    name                VARCHAR(100) NOT NULL,
    price_delta_paisa   BIGINT       NOT NULL DEFAULT 0,
    active              BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_by          UUID,
    deleted_at          TIMESTAMPTZ
);

ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modifiers
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── dining_tables ────────────────────────────────────────────
CREATE TABLE dining_tables (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL,
    branch_id       UUID         NOT NULL,
    table_number    VARCHAR(20)  NOT NULL,
    capacity        INT          NOT NULL DEFAULT 4,
    status          VARCHAR(20)  NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'OCCUPIED')),
    floor_plan_x    NUMERIC(8,2),
    floor_plan_y    NUMERIC(8,2),
    floor_plan_shape VARCHAR(20),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT uq_dining_table_branch_number UNIQUE (tenant_id, branch_id, table_number)
);

ALTER TABLE dining_tables ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON dining_tables
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── orders ───────────────────────────────────────────────────
CREATE TABLE orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID         NOT NULL,
    branch_id           UUID         NOT NULL,
    order_no            VARCHAR(30),
    type                VARCHAR(20)  NOT NULL DEFAULT 'DINE_IN'
        CHECK (type IN ('DINE_IN', 'TAKEAWAY', 'DELIVERY')),
    status              VARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','OPEN','SENT_TO_KDS','PARTIAL_READY','READY','SERVED','CLOSED','VOIDED','REFUNDED')),
    table_id            UUID         REFERENCES dining_tables(id),
    cover_count         INT          NOT NULL DEFAULT 1,
    cashier_id          UUID,
    till_session_id     UUID,
    customer_id         UUID,
    subtotal_paisa      BIGINT       NOT NULL DEFAULT 0,
    tax_paisa           BIGINT       NOT NULL DEFAULT 0,
    discount_paisa      BIGINT       NOT NULL DEFAULT 0,
    service_charge_paisa BIGINT      NOT NULL DEFAULT 0,
    total_paisa         BIGINT       NOT NULL DEFAULT 0,
    notes               TEXT,
    opened_at           TIMESTAMPTZ,
    sent_to_kds_at      TIMESTAMPTZ,
    closed_at           TIMESTAMPTZ,
    voided_at           TIMESTAMPTZ,
    void_reason         TEXT,
    client_order_id     UUID         NOT NULL,
    version             BIGINT       NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_by          UUID,
    deleted_at          TIMESTAMPTZ,
    CONSTRAINT uq_orders_client_order_id UNIQUE (client_order_id)
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_orders_branch_status ON orders (branch_id, status);
CREATE INDEX idx_orders_client_order_id ON orders (client_order_id);

-- ── order_items ──────────────────────────────────────────────
CREATE TABLE order_items (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID         NOT NULL,
    order_id                UUID         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id            UUID         NOT NULL,
    item_name_snapshot      VARCHAR(150) NOT NULL,
    unit_price_snapshot     BIGINT       NOT NULL,
    quantity                INT          NOT NULL DEFAULT 1,
    kds_station             TEXT,
    kds_status              VARCHAR(20)  NOT NULL DEFAULT 'PENDING'
        CHECK (kds_status IN ('PENDING', 'COOKING', 'READY')),
    discount_paisa          BIGINT       NOT NULL DEFAULT 0,
    tax_paisa               BIGINT       NOT NULL DEFAULT 0,
    line_total_paisa        BIGINT       NOT NULL DEFAULT 0,
    notes                   TEXT,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by              UUID,
    updated_by              UUID,
    deleted_at              TIMESTAMPTZ
);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_items
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_order_items_order_id ON order_items (order_id);

-- ── order_item_modifiers ─────────────────────────────────────
CREATE TABLE order_item_modifiers (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID         NOT NULL,
    order_item_id           UUID         NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
    modifier_id             UUID         NOT NULL,
    modifier_name_snapshot  VARCHAR(100) NOT NULL,
    price_delta_paisa       BIGINT       NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by              UUID,
    updated_by              UUID,
    deleted_at              TIMESTAMPTZ
);

ALTER TABLE order_item_modifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_item_modifiers
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── order_discounts ──────────────────────────────────────────
CREATE TABLE order_discounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID         NOT NULL,
    order_id        UUID         NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    order_item_id   UUID         REFERENCES order_items(id) ON DELETE CASCADE,
    scope           VARCHAR(10)  NOT NULL CHECK (scope IN ('LINE', 'ORDER')),
    type            VARCHAR(10)  NOT NULL CHECK (type IN ('FLAT', 'PERCENT')),
    value           NUMERIC(12,4) NOT NULL,
    amount_paisa    BIGINT       NOT NULL DEFAULT 0,
    applied_by      UUID,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    deleted_at      TIMESTAMPTZ
);

ALTER TABLE order_discounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_discounts
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- ── order_sequences ──────────────────────────────────────────
CREATE TABLE order_sequences (
    tenant_id       UUID    NOT NULL,
    branch_id       UUID    NOT NULL,
    business_date   DATE    NOT NULL,
    last_seq        INT     NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, branch_id, business_date)
);

ALTER TABLE order_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_sequences
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
