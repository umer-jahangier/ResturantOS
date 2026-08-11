-- ============================================================
-- POS Service - V14 Migration (Phase 28 — Stations, POS Profiles & Staff Assignment)
--
-- A station gains a TYPE (D-28-01): KITCHEN | BAR | PANTRY | EXPO | DESSERT.
--
-- WHY A TYPE AND NOT A STRING
-- The type answers "which display shows this station's tickets". Free text is how "Bar",
-- "bar" and "BAR " become three stations that each receive a third of the drinks, so the
-- column carries a CHECK constraint enumerating the five values. The Java enum
-- (StationType) is the other half; neither alone is sufficient — bean validation does not
-- protect a direct write, and a CHECK constraint does not give a UI a list to render.
-- New values are added by migration, deliberately.
--
-- WHY THE DEFAULT IS THE ENTIRE BACK-COMPATIBILITY STORY
-- Every station in every tenant today renders on the KDS. NOT NULL DEFAULT 'KITCHEN' means
-- every existing row becomes a kitchen station and NOTHING about today's routing moves.
-- A nullable column would instead make every consumer decide what a missing type means,
-- and they would not all decide the same thing.
--
-- ON ROW LEVEL SECURITY
-- `stations` is already ENABLEd (V7) and FORCEd (V11). This migration adds a column to an
-- already-isolated table and changes no policy — stated explicitly so a reviewer checking
-- the 17b invariant does not go looking for a FORCE that belongs in V11.
-- ============================================================

ALTER TABLE stations
    ADD COLUMN station_type VARCHAR(20) NOT NULL DEFAULT 'KITCHEN';

ALTER TABLE stations
    ADD CONSTRAINT ck_station_type
    CHECK (station_type IN ('KITCHEN', 'BAR', 'PANTRY', 'EXPO', 'DESSERT'));

-- The list screen filters by (branch, type) and the routing resolver reads (branch, active).
-- Partial on live rows: a retired station is never a routing destination and never rendered
-- in the picker, so indexing it would only widen the index for rows no query wants.
CREATE INDEX idx_stations_branch_type ON stations (branch_id, station_type) WHERE is_active;
