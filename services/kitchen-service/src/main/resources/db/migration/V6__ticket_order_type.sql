-- ============================================================
-- Kitchen Service - V6 Migration (KDS service-type visibility)
-- Persists the originating order's service type (OrderType enum name:
-- DINE_IN/TAKEAWAY/DELIVERY/PICKUP) on the KDS ticket. The
-- ORDER_SENT_TO_KDS event now carries an additive `orderType` field
-- (mirrors pos-service PosEventPayloads), but there was no column to
-- land it on, so the kitchen expo could not distinguish takeaway from
-- pickup. Additive, nullable — no data rewrite; pre-existing tickets
-- keep NULL (rendered as "—" / unknown by the KDS UI).
-- ============================================================

ALTER TABLE kds_tickets ADD COLUMN order_type VARCHAR(20);
