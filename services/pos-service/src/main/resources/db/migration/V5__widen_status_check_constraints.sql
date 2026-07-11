-- ============================================================
-- POS Service - V5 Migration
-- Fixes a V4 omission (phase 07.1): V4 widened the code enums
-- (7-value OrderItemStatus; TableStatus.NEEDS_BUSSING) and the
-- kds_status VARCHAR length, but left the pre-07.1 CHECK constraints
-- in place. Writing SENT/ACCEPTED/PREPARING/SERVED/CANCELLED to
-- order_items.kds_status (via sendToKds/item transitions) or
-- NEEDS_BUSSING to dining_tables.status therefore failed at runtime
-- with a check_constraint violation. This migration widens both
-- constraints to the current enum sets. Additive/idempotent — no
-- data rewrite (all existing rows already satisfy the new sets).
-- ============================================================

-- ── order_items.kds_status: 3-value -> 7-value OrderItemStatus ──
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_kds_status_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_kds_status_check
    CHECK (kds_status IN ('PENDING', 'SENT', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'));

-- ── dining_tables.status: add NEEDS_BUSSING ────────────────────
ALTER TABLE dining_tables DROP CONSTRAINT IF EXISTS dining_tables_status_check;
ALTER TABLE dining_tables ADD CONSTRAINT dining_tables_status_check
    CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'NEEDS_BUSSING'));
