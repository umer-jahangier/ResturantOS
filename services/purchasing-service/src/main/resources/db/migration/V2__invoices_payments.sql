-- Purchasing V2 — vendor invoices, AP payments

CREATE TABLE vendor_invoices (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    vendor_id        UUID NOT NULL REFERENCES vendors(id),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id),
    branch_id        UUID NOT NULL,
    invoice_no       VARCHAR(60) NOT NULL,
    invoice_date     DATE NOT NULL,
    status           VARCHAR(30) NOT NULL DEFAULT 'PENDING_MATCH',
    total_paisa      BIGINT NOT NULL DEFAULT 0,
    input_tax_paisa  BIGINT NOT NULL DEFAULT 0,
    match_override_reason TEXT,
    matched_at       TIMESTAMPTZ,
    paid_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_by       UUID,
    deleted_at       TIMESTAMPTZ,
    CONSTRAINT uq_vendor_invoice_no UNIQUE (tenant_id, vendor_id, invoice_no)
);

ALTER TABLE vendor_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vendor_invoices
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE TABLE vendor_invoice_lines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    invoice_id       UUID NOT NULL REFERENCES vendor_invoices(id),
    po_line_id       UUID NOT NULL,
    qty              NUMERIC(18,4) NOT NULL,
    unit_price_paisa BIGINT NOT NULL,
    line_total_paisa BIGINT NOT NULL,
    match_status     VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_by       UUID,
    deleted_at       TIMESTAMPTZ
);

ALTER TABLE vendor_invoice_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON vendor_invoice_lines
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE TABLE ap_payments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    vendor_id        UUID NOT NULL REFERENCES vendors(id),
    branch_id        UUID NOT NULL,
    payment_date     DATE NOT NULL,
    amount_paisa     BIGINT NOT NULL,
    bank_account_code VARCHAR(20) NOT NULL DEFAULT '1110',
    idempotency_key  VARCHAR(120),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_by       UUID,
    deleted_at       TIMESTAMPTZ,
    CONSTRAINT uq_ap_payment_idem UNIQUE (tenant_id, idempotency_key)
);

ALTER TABLE ap_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ap_payments
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);

CREATE TABLE ap_payment_allocations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    payment_id       UUID NOT NULL REFERENCES ap_payments(id),
    invoice_id       UUID NOT NULL REFERENCES vendor_invoices(id),
    amount_paisa     BIGINT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID,
    updated_by       UUID,
    deleted_at       TIMESTAMPTZ
);

ALTER TABLE ap_payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ap_payment_allocations
    USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID);
