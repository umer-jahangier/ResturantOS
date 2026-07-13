-- ============================================================
-- POS Service - V6 Migration
-- Phase 07.3 D-03 (POS-18): order-taking terminal supports Dine-in / Takeaway /
-- Pickup. Adds PICKUP to the backend OrderType enum (DELIVERY is kept — it is
-- used elsewhere; the terminal toggle just exposes the 3 D-03 types). Widens
-- orders.type CHECK constraint to include 'PICKUP', following the V5 widening
-- pattern (drop + re-add). Additive/idempotent — no data rewrite (all existing
-- rows already satisfy the new set).
-- ============================================================

-- ── orders.type: 3-value -> 4-value OrderType (adds PICKUP) ────────────────
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_type_check
    CHECK (type IN ('DINE_IN', 'TAKEAWAY', 'DELIVERY', 'PICKUP'));
