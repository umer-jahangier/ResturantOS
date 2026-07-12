-- ============================================================
-- POS Service - V3 Migration
-- Creates: till_sessions, order_payments, order_refunds
-- Adds FK: orders.till_session_id -> till_sessions(id)
-- All money in BIGINT paisa (1 PKR = 100 paisa)
-- ============================================================

-- ── till_sessions ─────────────────────────────────────────────
CREATE TABLE till_sessions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID         NOT NULL,
    branch_id               UUID         NOT NULL,
    cashier_id              UUID         NOT NULL,
    opening_float_paisa     BIGINT       NOT NULL,
    expected_closing_paisa  BIGINT,
    declared_closing_paisa  BIGINT,
    variance_paisa          BIGINT GENERATED ALWAYS AS (declared_closing_paisa - expected_closing_paisa) STORED,
    opened_at               TIMESTAMPTZ,
    closed_at               TIMESTAMPTZ,
    status                  VARCHAR(20)  NOT NULL DEFAULT 'OPEN',
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by              UUID,
    updated_by              UUID,
    deleted_at              TIMESTAMPTZ
);

ALTER TABLE till_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON till_sessions
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

-- One open till per cashier per tenant (partial unique index)
CREATE UNIQUE INDEX uq_open_till_per_cashier ON till_sessions (tenant_id, cashier_id) WHERE status = 'OPEN';

CREATE INDEX idx_till_sessions_cashier ON till_sessions (cashier_id);
CREATE INDEX idx_till_sessions_branch_status ON till_sessions (branch_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON till_sessions TO pos_user;

-- ── order_payments ────────────────────────────────────────────
CREATE TABLE order_payments (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID         NOT NULL,
    order_id      UUID         NOT NULL REFERENCES orders(id),
    method        VARCHAR(30)  NOT NULL,
    amount_paisa  BIGINT       NOT NULL,
    reference_no  VARCHAR(100),
    recorded_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_by    UUID,
    deleted_at    TIMESTAMPTZ
);

ALTER TABLE order_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_payments
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_order_payments_order ON order_payments (order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON order_payments TO pos_user;

-- ── order_refunds ─────────────────────────────────────────────
CREATE TABLE order_refunds (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID         NOT NULL,
    order_id      UUID         NOT NULL REFERENCES orders(id),
    refund_paisa  BIGINT       NOT NULL,
    reason        TEXT         NOT NULL,
    refunded_by   UUID,
    scope         VARCHAR(20)  NOT NULL DEFAULT 'FULL',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

ALTER TABLE order_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_refunds
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_order_refunds_order ON order_refunds (order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON order_refunds TO pos_user;

-- ── FK: orders.till_session_id -> till_sessions(id) ──────────
ALTER TABLE orders
    ADD CONSTRAINT fk_orders_till
    FOREIGN KEY (till_session_id) REFERENCES till_sessions(id);
