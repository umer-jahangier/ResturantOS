-- V21 — S0-04: record WHO voided an order, not just that it was voided.
--
-- `orders` already carried `void_reason` and `voided_at`; the actor existed only inside the
-- ORDER_VOIDED event payload, which no screen and no query can read back. The consequence was
-- that even once a voided order became reachable in Order Management, the one question an owner
-- actually asks about a void — "who did this?" — had no answer anywhere in the product.
--
-- `updated_by` is NOT that answer. It is the last writer of the row for any reason, so it is a
-- proxy that happens to be right today and stops being right the first time anything else
-- touches a terminal order. This column says exactly one thing and can only be set on the void
-- path (OrderServiceImpl.voidOrder).
--
-- Rows voided before this migration stay NULL and the UI renders "Not recorded". Backfilling
-- them from `updated_by` would manufacture an attribution that was never captured, which on a
-- money-adjacent audit trail is worse than an honest blank.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS voided_by UUID;

COMMENT ON COLUMN orders.voided_by IS
    'User id (JWT sub) of whoever voided this order. NULL for rows voided before V21, and for every order that was never voided.';
