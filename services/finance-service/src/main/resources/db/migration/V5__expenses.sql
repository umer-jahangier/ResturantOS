-- ============================================================
-- Finance Service - V5 Expenses (FIN-05: OPA-gated expense approval)
-- Creates: expenses table + RLS + finance_user grants
-- ============================================================

CREATE TABLE expenses (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    branch_id             UUID        NOT NULL,
    expense_date          DATE        NOT NULL,
    expense_account_code  VARCHAR(20) NOT NULL,
    description           VARCHAR(500),
    amount_paisa          BIGINT      NOT NULL CHECK (amount_paisa > 0),
    status                VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL'
        CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED')),
    requested_by          UUID,
    approved_by           UUID,
    approved_at           TIMESTAMPTZ,
    reject_reason         VARCHAR(500),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID,
    updated_by            UUID,
    deleted_at            TIMESTAMPTZ
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON expenses
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;

CREATE INDEX idx_expenses_tenant_branch ON expenses (tenant_id, branch_id);
CREATE INDEX idx_expenses_tenant_status ON expenses (tenant_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON expenses TO finance_user;
