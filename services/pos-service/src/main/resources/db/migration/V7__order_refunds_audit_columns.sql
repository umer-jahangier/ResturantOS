-- ============================================================
-- POS Service - V7 Migration
-- order_refunds was created (V3) with only created_at, but OrderRefund extends
-- TenantAuditableEntity, which requires updated_at, created_by, updated_by and
-- deleted_at (same columns every other pos_db table already has, e.g.
-- menu_categories). Without them Hibernate schema validation fails on startup.
-- ============================================================

ALTER TABLE order_refunds
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN created_by UUID,
    ADD COLUMN updated_by UUID,
    ADD COLUMN deleted_at TIMESTAMPTZ;
