-- Align order_refunds with TenantAuditableEntity (created_by, updated_by, deleted_at, updated_at).
-- Restored from local work and renumbered V4 -> V8: QA's lineage already uses V4
-- (item_status_revision) through V7 (stations). The OrderRefund JPA entity extends
-- TenantAuditableEntity, so Hibernate schema validation requires these columns; no
-- prior QA migration adds them, which prevents pos-service from starting on a fresh DB.
ALTER TABLE order_refunds
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_by UUID,
    ADD COLUMN IF NOT EXISTS updated_by UUID,
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
