-- ============================================================
-- Kitchen Service - V7 Migration (Phase 3 — Station Routing Refactor, Stage C)
-- The ORDER_SENT_TO_KDS event now carries the canonical, FK-backed station
-- (additive stationId/stationName fields, mirrors pos-service). Kitchen
-- consumes these as a PROJECTION of the pos-owned `stations` table
-- (cross-DB — no SQL FK across services). ADDITIVE / NON-BREAKING:
--   * kds_tickets.station_id       — canonical pos station id this ticket routed to
--                                     (null for legacy/free-text-only lines)
--   * kds_stations.source_station_id — canonical pos station id this projected row
--                                       mirrors (null for auto-vivified/DEFAULT rows)
-- station_code stays the load-bearing ticket/WS subscription key; these columns
-- only ADD the canonical reference so a future contract migration (Stage D) can key
-- by station id without another routing change.
-- ============================================================

ALTER TABLE kds_tickets  ADD COLUMN station_id        UUID;
ALTER TABLE kds_stations ADD COLUMN source_station_id UUID;
