-- Purchasing Service V1 — vendors, POs, mock GRN, approval tiers

CREATE TABLE vendors (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    name            VARCHAR(200) NOT NULL,
    contact_person  VARCHAR(120),
    phone           VARCHAR(30),
    email           VARCHAR(200),
    address         TEXT,
    payment_terms   VARCHAR(20) NOT NULL DEFAULT 'NET30',
    ntn             VARCHAR(30),
    strn            VARCHAR(30),
    lead_time_days  INT,
    bank_account_no TEXT,
    bank_account_last4 VARCHAR(4),
    notes           TEXT,
    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    deleted_at      TIMESTAMPTZ
);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vendors
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE TABLE vendor_catalogues (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    vendor_id        UUID NOT NULL REFERENCES vendors(id),
    ingredient_id    UUID NOT NULL,
    unit_price_paisa BIGINT NOT NULL,
    valid_from       DATE,
    valid_to         DATE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_by       UUID,
    deleted_at       TIMESTAMPTZ
);

ALTER TABLE vendor_catalogues ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vendor_catalogues
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE TABLE purchase_orders (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id              UUID NOT NULL,
    vendor_id              UUID NOT NULL REFERENCES vendors(id),
    branch_id              UUID NOT NULL,
    status                 VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    expected_delivery_date DATE,
    total_paisa            BIGINT NOT NULL DEFAULT 0,
    notes                  TEXT,
    requester_id           UUID,
    submitted_at           TIMESTAMPTZ,
    required_tiers         INT NOT NULL DEFAULT 1,
    tiers_approved         INT NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by             UUID,
    updated_by             UUID,
    deleted_at             TIMESTAMPTZ
);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_orders
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE TABLE purchase_order_lines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
    ingredient_id    UUID NOT NULL,
    qty              NUMERIC(18,4) NOT NULL,
    uom              VARCHAR(20) NOT NULL,
    unit_price_paisa BIGINT NOT NULL,
    line_total_paisa BIGINT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_by       UUID,
    deleted_at       TIMESTAMPTZ
);

ALTER TABLE purchase_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_lines
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE TABLE po_approval_records (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
    tier             INT NOT NULL,
    approver_id      UUID NOT NULL,
    action           VARCHAR(20) NOT NULL,
    reason           TEXT,
    acted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_by       UUID,
    deleted_at       TIMESTAMPTZ
);

ALTER TABLE po_approval_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON po_approval_records
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE TABLE po_approval_tiers (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    tier_no          INT NOT NULL,
    min_amount_paisa BIGINT NOT NULL DEFAULT 0,
    max_amount_paisa BIGINT,
    required_role    VARCHAR(60),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_by       UUID,
    deleted_at       TIMESTAMPTZ,
    CONSTRAINT uq_po_tier UNIQUE (tenant_id, tier_no)
);

ALTER TABLE po_approval_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON po_approval_tiers
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE TABLE tenant_match_tolerances (
    tenant_id        UUID PRIMARY KEY,
    qty_over_pct     NUMERIC(8,4) NOT NULL DEFAULT 0,
    qty_under_pct    NUMERIC(8,4) NOT NULL DEFAULT 0.05,
    price_over_pct   NUMERIC(8,4) NOT NULL DEFAULT 0.02,
    price_under_pct  NUMERIC(8,4) NOT NULL DEFAULT 0.10,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE mock_grn_receipts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    purchase_order_id UUID NOT NULL,
    po_line_id       UUID NOT NULL,
    grn_id           UUID NOT NULL DEFAULT gen_random_uuid(),
    received_qty     NUMERIC(18,4) NOT NULL,
    received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key  VARCHAR(120),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_by       UUID,
    deleted_at       TIMESTAMPTZ,
    CONSTRAINT uq_mock_grn_idem UNIQUE (tenant_id, idempotency_key)
);

ALTER TABLE mock_grn_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mock_grn_receipts
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);
