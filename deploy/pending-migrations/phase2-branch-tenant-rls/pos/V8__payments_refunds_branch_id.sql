-- ============================================================
-- Phase 2 — Add branch_id to order_payments / order_refunds (pos_db)
-- DEFERRED. Apply WITH the companion entity/service code changes (see README) —
-- branch_id is made NOT NULL, so write paths must populate it or inserts fail.
-- ============================================================

-- ── order_payments ───────────────────────────────────────────────────────────
ALTER TABLE order_payments ADD COLUMN branch_id UUID;
UPDATE order_payments p SET branch_id = o.branch_id
    FROM orders o WHERE o.id = p.order_id;
ALTER TABLE order_payments ALTER COLUMN branch_id SET NOT NULL;
CREATE INDEX idx_order_payments_branch ON order_payments (branch_id);

-- ── order_refunds ────────────────────────────────────────────────────────────
ALTER TABLE order_refunds ADD COLUMN branch_id UUID;
UPDATE order_refunds r SET branch_id = o.branch_id
    FROM orders o WHERE o.id = r.order_id;
ALTER TABLE order_refunds ALTER COLUMN branch_id SET NOT NULL;
CREATE INDEX idx_order_refunds_branch ON order_refunds (branch_id);

-- Note: these tables intentionally keep the tenant-only RLS policy (branch scoping
-- for payments/refunds is enforced in the service layer via the parent order, to
-- preserve the pos.order.view.all cross-branch read). The column exists so payments
-- and refunds can be branch-filtered/reported directly without joining orders.
