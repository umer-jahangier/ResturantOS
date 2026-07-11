-- Purchasing V3 — PO close (PUR-02 terminal state)

ALTER TABLE purchase_orders ADD COLUMN closed_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN closed_by UUID;
ALTER TABLE purchase_orders ADD COLUMN close_reason TEXT;
