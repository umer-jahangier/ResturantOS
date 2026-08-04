-- Inventory Service - V4 Migration: menu_item_catalog read-model (D-02, 08.1-02)
--
-- Tenant-scoped read-model of the pos-service menu catalog, populated exclusively by
-- MenuItemCatalogConsumer from MENU_ITEM_UPSERTED/MENU_ITEM_DELETED events published on
-- pos.topic (08.1-01). This is a domain table (read under tenant context on the API path via
-- GET /api/v1/inventory/menu-items, and written under tenant context resolved from the
-- EventEnvelope on the consumer path via TenantAwareMessageProcessor), so it follows V1's
-- FORCE-RLS convention exactly — NOT the V3 inventory_tenant_registry RLS-EXEMPT pattern.
--
-- D-07 (soft-delete): MENU_ITEM_DELETED NEVER deletes this row. It only sets active=false, so
-- historical recipes/movements referencing that menuItemId stay resolvable.
CREATE TABLE menu_item_catalog (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID          NOT NULL,
    menu_item_id      UUID          NOT NULL,
    name              VARCHAR(160)  NOT NULL,
    category_id       UUID,
    category_name     VARCHAR(160),
    active            BOOLEAN       NOT NULL DEFAULT true,
    base_price_paisa  BIGINT        NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by        UUID,
    updated_by        UUID,
    deleted_at        TIMESTAMPTZ,
    CONSTRAINT uq_menu_item_catalog_tenant_menuitem UNIQUE (tenant_id, menu_item_id)
);

CREATE INDEX idx_menu_item_catalog_tenant_active ON menu_item_catalog (tenant_id, active);

ALTER TABLE menu_item_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_item_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_item_catalog
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON menu_item_catalog TO inventory_user;
