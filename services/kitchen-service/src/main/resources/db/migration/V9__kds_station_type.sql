-- ============================================================
-- Kitchen Service - V9 Migration (Phase 28 — Stations, POS Profiles & Staff Assignment)
--
-- The station PROJECTION gains the station's TYPE (D-28-01).
--
-- WHY IT HAS TO LIVE HERE AND NOT ONLY IN pos_db
-- `kds_stations` is an event-fed projection of pos-service's `stations` (see KdsStation and
-- V7), and the BOARD reads the projection. A type that existed only in pos_db would mean the
-- display had to call back into pos-service to decide whether a ticket belongs on the bar
-- screen — a synchronous dependency on the hot path of the one screen that must keep working
-- when everything else is down.
--
-- SAME SHAPE AND SAME REASONING AS pos V14
-- NOT NULL DEFAULT 'KITCHEN' with a CHECK over the five values. Every projected row that
-- exists today feeds a kitchen board, so every one of them becomes KITCHEN and nothing moves.
-- A nullable column would make each consumer decide what a missing type means.
--
-- ON ROW LEVEL SECURITY
-- kitchen_db's tenant tables are ENABLEd and FORCEd by V8. This adds a column to an
-- already-isolated table and changes no policy — stated so a reviewer checking the 17b
-- invariant does not go looking for a FORCE that belongs in V8.
-- ============================================================

ALTER TABLE kds_stations
    ADD COLUMN station_type VARCHAR(20) NOT NULL DEFAULT 'KITCHEN';

ALTER TABLE kds_stations
    ADD CONSTRAINT ck_kds_station_type
    CHECK (station_type IN ('KITCHEN', 'BAR', 'PANTRY', 'EXPO', 'DESSERT'));

CREATE INDEX idx_kds_stations_branch_type ON kds_stations (branch_id, station_type) WHERE is_active;
