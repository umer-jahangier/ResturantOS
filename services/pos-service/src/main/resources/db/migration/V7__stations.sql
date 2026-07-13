-- ============================================================
-- POS Service - V7 Migration (Phase 3 — Station Routing Refactor, Stage A)
-- Introduces a canonical, FK-backed station model to replace the
-- free-text `kds_station` routing string. ADDITIVE / NON-BREAKING:
--   * new `stations` table (tenant + branch scoped, RLS, GRANT to pos_user)
--   * menu_items.station_id  UUID NULL  REFERENCES stations(id)  — the
--     canonical station a menu item is assigned to (admin CRUD, Stage B)
--   * order_items.station_id UUID NULL  — station SNAPSHOT captured at
--     add-item time alongside the retained `kds_station` free-text string
-- The existing `kds_station` columns stay populated and load-bearing; a
-- fired line still falls back to it (then "DEFAULT") when no station_id is
-- set, so the KDS runtime flow is unchanged. See TicketRoutingService.
-- ============================================================

-- ── stations ────────────────────────────────────────────────
-- Tenant + branch scoped (locked decision); unique on (tenant_id, branch_id, code).
-- Mirrors the RLS + `tenant_isolation` policy convention of every other pos table
-- (V1/V3). No FORCE ROW LEVEL SECURITY (deferred decision — matches existing tables).
CREATE TABLE stations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID         NOT NULL,
    branch_id   UUID         NOT NULL,
    code        VARCHAR(50)  NOT NULL,
    name        VARCHAR(100) NOT NULL,
    is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_by  UUID,
    deleted_at  TIMESTAMPTZ,
    CONSTRAINT uq_station_tenant_branch_code UNIQUE (tenant_id, branch_id, code)
);

ALTER TABLE stations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stations
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

CREATE INDEX idx_stations_branch ON stations (branch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON stations TO pos_user;

-- ── menu_items.station_id (canonical FK) ─────────────────────
-- Nullable: menu items are tenant-scoped while stations are branch-scoped, so a
-- shared menu item has no single "correct" branch-station until an admin assigns
-- one (Stage B). Routing keeps working via kds_station until then.
ALTER TABLE menu_items ADD COLUMN station_id UUID REFERENCES stations(id);

-- ── order_items.station_id (snapshot) ────────────────────────
-- Snapshot captured at add-item time from the menu item's station_id, alongside
-- the retained kds_station free-text snapshot. Intentionally NOT an FK (a pure
-- point-in-time snapshot, mirroring kds_station / menu_item_id).
ALTER TABLE order_items ADD COLUMN station_id UUID;

-- ── Best-effort backfill of station rows from historical data ─
-- For every branch that has actually placed orders, seed a station row for each
-- distinct non-empty menu_items.kds_station code the tenant uses. This makes the
-- historical station codes visible/manageable per branch without guessing branches
-- the tenant never used. No-op on a fresh/empty schema (e.g. Testcontainers).
-- menu_items.station_id is intentionally left NULL here: with menu items shared
-- across branches there is no single correct branch-station to point them at —
-- assignment is an explicit admin action (Stage B). kds_station stays populated.
INSERT INTO stations (tenant_id, branch_id, code, name, is_active)
SELECT DISTINCT o.tenant_id, o.branch_id, mi.kds_station, mi.kds_station, TRUE
FROM menu_items mi
JOIN orders o ON o.tenant_id = mi.tenant_id
WHERE mi.kds_station IS NOT NULL
  AND mi.kds_station <> ''
ON CONFLICT (tenant_id, branch_id, code) DO NOTHING;
