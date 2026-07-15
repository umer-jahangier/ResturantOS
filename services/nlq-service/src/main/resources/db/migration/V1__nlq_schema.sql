-- NLQ Service V1 — role-scoped table allowlist + the query audit log (plan 12-04)

-- nlq_allowed_tables: a PLATFORM-level table (role_code -> table_name grants), NOT tenant-scoped.
-- Deliberately NO tenant_id column and NO RLS — every tenant on this platform shares the same
-- role -> allowed-analytics-table mapping (the mapping describes what a ROLE may see, not what a
-- TENANT owns). Do NOT "helpfully" add RLS here in a future migration; it would break every
-- lookup because nothing ever sets app.current_tenant_id for a platform-level read.
CREATE TABLE nlq_allowed_tables (
    role_code  VARCHAR(50)  NOT NULL,
    table_name VARCHAR(100) NOT NULL,
    PRIMARY KEY (role_code, table_name)
);

-- Analytics-capable roles get the four fact tables from plan 12-02's clickhouse_analytics schema.
INSERT INTO nlq_allowed_tables (role_code, table_name) VALUES
    ('OWNER', 'sales_order_facts'),
    ('OWNER', 'sales_item_facts'),
    ('OWNER', 'purchase_tax_facts'),
    ('OWNER', 'till_session_facts'),
    ('TENANT_ADMIN', 'sales_order_facts'),
    ('TENANT_ADMIN', 'sales_item_facts'),
    ('TENANT_ADMIN', 'purchase_tax_facts'),
    ('TENANT_ADMIN', 'till_session_facts'),
    ('MANAGER', 'sales_order_facts'),
    ('MANAGER', 'sales_item_facts'),
    ('MANAGER', 'purchase_tax_facts'),
    ('MANAGER', 'till_session_facts'),
    ('ACCOUNTANT', 'sales_order_facts'),
    ('ACCOUNTANT', 'sales_item_facts'),
    ('ACCOUNTANT', 'purchase_tax_facts'),
    ('ACCOUNTANT', 'till_session_facts');
-- CASHIER / KITCHEN_STAFF / INVENTORY_MANAGER / FINANCE_VIEWER get NO rows here on purpose: an
-- empty allowlist means every ad-hoc analytics query they send is rejected at Stage 3
-- (TABLE_NOT_ALLOWED) — correct, they have no business running ad-hoc NLQ analytics.

-- nlq_query_log: tenant-scoped audit trail of every NLQ request (plan 12-07 writes rows here).
-- RLS ENABLED + FORCED, standard tenant_isolation policy (copied verbatim from purchasing's V1).
CREATE TABLE nlq_query_log (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL,
    branch_id        UUID,
    user_id          UUID NOT NULL,
    impersonated_by  UUID,
    role_code        VARCHAR(50),
    question         TEXT NOT NULL,
    generated_sql    TEXT,
    executed_sql     TEXT,
    rejection_code   VARCHAR(50),
    row_count        INT,
    duration_ms      INT,
    cache_hit        BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE nlq_query_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON nlq_query_log
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
ALTER TABLE nlq_query_log FORCE ROW LEVEL SECURITY;

CREATE INDEX idx_nlq_query_log_tenant_created ON nlq_query_log (tenant_id, created_at DESC);
