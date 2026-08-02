-- ============================================================
-- Inventory Service - V11
-- Wastage: spoilage, breakage, staff meals and returns written off stock.
--
-- finance-service has had a WASTAGE_RECORDED consumer, a bound queue and a DLQ since Phase 9 —
-- and there has never been a producer. No entity, no service, no endpoint, nothing that could
-- emit the event. So waste and spoilage (account 5220) could not be recorded at all, which for a
-- restaurant is a first-order cost line and makes food-cost percentage systematically understated.
--
-- Mirrors stock_counts' header+lines shape so the write path, the RLS posture and the event
-- payload all look like their stock-count siblings. The header id IS the `wastageId` the ledger
-- dedupes on: finance's recipe has always required one, and the old placeholder payload — keyed on
-- ingredientId — could never have supplied it.
-- ============================================================

CREATE TABLE stock_wastage (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    branch_id     UUID        NOT NULL,
    reason        VARCHAR(32) NOT NULL
        CHECK (reason IN ('SPOILAGE','BREAKAGE','EXPIRY','STAFF_MEAL','CUSTOMER_RETURN','OTHER')),
    notes         TEXT,
    total_cost_paisa BIGINT   NOT NULL DEFAULT 0,
    recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_by    UUID,
    deleted_at    TIMESTAMPTZ
);

ALTER TABLE stock_wastage ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_wastage FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_wastage
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_stock_wastage_branch_recorded ON stock_wastage (tenant_id, branch_id, recorded_at DESC);

CREATE TABLE stock_wastage_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID          NOT NULL,
    wastage_id      UUID          NOT NULL REFERENCES stock_wastage(id),
    ingredient_id   UUID          NOT NULL,
    qty             NUMERIC(18,4) NOT NULL,
    unit_cost_paisa BIGINT        NOT NULL DEFAULT 0,
    line_cost_paisa BIGINT        NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    deleted_at      TIMESTAMPTZ,
    -- Writing off nothing is not a wastage record; it is a mistake.
    CONSTRAINT ck_stock_wastage_line_qty_positive CHECK (qty > 0)
);

ALTER TABLE stock_wastage_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_wastage_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_wastage_lines
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_stock_wastage_lines_wastage ON stock_wastage_lines (wastage_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_wastage       TO inventory_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_wastage_lines TO inventory_user;
