-- ============================================================
-- Kitchen Service - V5 Migration (phase 07.3-05, KDS-04)
-- Persists the order's dining-table number on the KDS ticket. The
-- ORDER_SENT_TO_KDS event now carries an additive `tableNumber`
-- field (mirrors pos-service PosEventPayloads, added 07.3-04), but
-- there was no column to land it on. Additive, nullable — no data
-- rewrite. Station rows themselves are seeded at runtime (branches
-- are provisioned per tenant, so a static INSERT here cannot target
-- them) — see TicketRoutingService.ensureStation / KdsController
-- getStations auto-seed-on-miss.
-- ============================================================

ALTER TABLE kds_tickets ADD COLUMN table_number VARCHAR(50);
