-- Kitchen Display System schema: stations, tickets, ticket items.
-- All domain tables use RLS for tenant isolation.
-- Audit columns match TenantAuditableEntity: tenant_id, created_at, updated_at, created_by, updated_by, deleted_at.

CREATE TABLE kds_stations (
    id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                    UUID        NOT NULL,
    branch_id                    UUID        NOT NULL,
    code                         VARCHAR(50) NOT NULL,
    name                         VARCHAR(100) NOT NULL,
    is_active                    BOOLEAN     NOT NULL DEFAULT true,
    escalation_threshold_seconds INT         NOT NULL DEFAULT 900,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by                   UUID,
    updated_by                   UUID,
    deleted_at                   TIMESTAMPTZ,
    CONSTRAINT uq_station_tenant_branch_code UNIQUE (tenant_id, branch_id, code)
);

ALTER TABLE kds_stations ENABLE ROW LEVEL SECURITY;

CREATE POLICY kds_stations_tenant_isolation ON kds_stations
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE TABLE kds_tickets (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    branch_id    UUID        NOT NULL,
    order_id     UUID        NOT NULL,
    order_no     VARCHAR(50),
    station_code VARCHAR(50) NOT NULL,
    status       VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    priority     BOOLEAN     NOT NULL DEFAULT false,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at   TIMESTAMPTZ,
    ready_at     TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   UUID,
    updated_by   UUID,
    deleted_at   TIMESTAMPTZ
);

ALTER TABLE kds_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY kds_tickets_tenant_isolation ON kds_tickets
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_kds_tickets_branch_station_status ON kds_tickets (branch_id, station_code, status);
CREATE INDEX idx_kds_tickets_order_id ON kds_tickets (order_id);

CREATE TABLE kds_ticket_items (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID         NOT NULL,
    ticket_id     UUID         NOT NULL REFERENCES kds_tickets(id) ON DELETE CASCADE,
    order_item_id UUID         NOT NULL,
    name          VARCHAR(200) NOT NULL,
    qty           INT          NOT NULL,
    modifiers     JSONB,
    notes         TEXT,
    status        VARCHAR(30)  NOT NULL DEFAULT 'PENDING',
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_by    UUID,
    deleted_at    TIMESTAMPTZ
);

ALTER TABLE kds_ticket_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY kds_ticket_items_tenant_isolation ON kds_ticket_items
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_kds_ticket_items_ticket_id ON kds_ticket_items (ticket_id);
