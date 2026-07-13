-- ============================================================
-- Kitchen Service - V4 Migration (phase 07.1 gap fix, KDS-03)
-- Persists order-level notes on the KDS ticket. The
-- ORDER_SENT_TO_KDS event already carries `orderNotes` (mirrors
-- pos-service PosEventPayloads), but it was dropped on the kitchen
-- side, leaving the KDS board's order-level "Kitchen Notes" callout
-- with no data source. Additive, nullable — no data rewrite.
-- ============================================================

ALTER TABLE kds_tickets ADD COLUMN order_notes VARCHAR(500);
