-- ============================================================
-- POS Service - V4 Migration
-- Adds: order_items.revision_no, order_items.fired_at, orders.derived_status
-- Additive only — no DROP/RENAME of existing columns.
-- kds_status column (VARCHAR(20), EnumType.STRING) is retained and widened
-- to the 7-value OrderItemStatus lifecycle; PENDING/SENT/ACCEPTED/PREPARING/
-- READY/SERVED/CANCELLED all fit within the existing length=20 constraint.
-- All money in BIGINT paisa (1 PKR = 100 paisa) — unaffected by this migration.
-- ============================================================

-- ── order_items: revision tracking ──────────────────────────────
ALTER TABLE order_items
    ADD COLUMN revision_no INT NOT NULL DEFAULT 0;

ALTER TABLE order_items
    ADD COLUMN fired_at TIMESTAMPTZ;

CREATE INDEX idx_order_items_revision_no ON order_items (order_id, revision_no);

-- ── orders: persisted derived status ────────────────────────────
ALTER TABLE orders
    ADD COLUMN derived_status VARCHAR(20) NOT NULL DEFAULT 'DRAFT';
