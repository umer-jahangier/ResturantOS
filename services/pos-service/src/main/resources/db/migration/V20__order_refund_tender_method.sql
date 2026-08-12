-- V20 — S0-01: a refund reverses a SPECIFIC tender, and the row has to say which one.
--
-- Until now `order_refunds` recorded only an amount. That was survivable while refunds were
-- unreachable (they were gated on CLOSED, which a paid-but-unserved order never reaches), but
-- the moment a refund becomes the ONLY legal way to undo a paid order, two money screens need
-- the method and cannot derive it:
--
--   * TillServiceImpl's expected-closing cash — a CASH refund physically leaves the drawer and
--     must reduce expected cash; a CARD reversal never touches it. Without the method the
--     cashier is counted short (or over) by the amount of every refund.
--   * GET /orders/{id}/payments — the reversing row shown next to the original tender.
--
-- NULL means "written before this migration", i.e. a legacy full/partial refund whose tender is
-- unknown. Readers treat NULL as CASH: an unknown refund most likely came out of the drawer, and
-- under-counting expected cash is the safe direction (it shows as an overage, not a shortage
-- the cashier is blamed for).
ALTER TABLE order_refunds
    ADD COLUMN IF NOT EXISTS method VARCHAR(30);

COMMENT ON COLUMN order_refunds.method IS
    'The tender method this refund reverses (CASH/CARD/...). NULL for rows written before V20; readers treat NULL as CASH.';
