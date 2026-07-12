-- ============================================================
-- Finance Service - V6 Accounts Receivable (FIN-05 AR half, 10-18 gap closure)
-- Decision 10-17-A: AR is sourced from corporate/house accounts. Creates:
-- customer_accounts (the house account) + ar_transactions (the AR sub-ledger)
-- + RLS + finance_user grants + the POS-retry idempotency index.
-- ============================================================

CREATE TABLE customer_accounts (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    branch_id             UUID        NOT NULL,
    account_code          VARCHAR(30) NOT NULL,
    name                  VARCHAR(200) NOT NULL,
    contact_name          VARCHAR(200),
    contact_phone         VARCHAR(30),
    contact_email         VARCHAR(200),
    credit_limit_paisa    BIGINT      NOT NULL DEFAULT 0 CHECK (credit_limit_paisa >= 0),
    payment_terms_days    INT         NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0),
    status                VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','SUSPENDED')),
    crm_customer_id       UUID,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID,
    updated_by            UUID,
    deleted_at            TIMESTAMPTZ,
    UNIQUE (tenant_id, account_code)
);

ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_accounts
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
ALTER TABLE customer_accounts FORCE ROW LEVEL SECURITY;

CREATE INDEX idx_customer_accounts_tenant_branch ON customer_accounts (tenant_id, branch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON customer_accounts TO finance_user;

CREATE TABLE ar_transactions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID        NOT NULL,
    branch_id             UUID        NOT NULL,
    customer_account_id   UUID        NOT NULL REFERENCES customer_accounts(id),
    txn_type              VARCHAR(20) NOT NULL CHECK (txn_type IN ('CHARGE','SETTLEMENT')),
    txn_date              DATE        NOT NULL,
    due_date              DATE,
    amount_paisa          BIGINT      NOT NULL CHECK (amount_paisa > 0),
    source_type           VARCHAR(30) NOT NULL CHECK (source_type IN ('POS_ORDER','MANUAL')),
    source_id             UUID,
    journal_entry_id      UUID        NOT NULL,
    reference             VARCHAR(200),
    memo                  VARCHAR(500),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID,
    updated_by            UUID,
    deleted_at            TIMESTAMPTZ
);

-- Idempotency: the whole reason the internal POS seam is safe to retry.
CREATE UNIQUE INDEX uq_ar_txn_source ON ar_transactions (tenant_id, source_type, source_id)
    WHERE source_id IS NOT NULL;

CREATE INDEX idx_ar_transactions_tenant_account ON ar_transactions (tenant_id, customer_account_id);
CREATE INDEX idx_ar_transactions_tenant_branch_date ON ar_transactions (tenant_id, branch_id, txn_date);

ALTER TABLE ar_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ar_transactions
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
ALTER TABLE ar_transactions FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON ar_transactions TO finance_user;
