-- ============================================================================
-- 28-05 — Per-branch item → station routing, and the close of a live data bug
-- ============================================================================
-- ══ THE BUG THIS EXISTS TO CLOSE ══
--
-- `menu_items` has NO branch. It hangs off `menu_categories`, which is unique per tenant.
-- So a two-branch tenant has exactly ONE row for "Chicken Karahi" and exactly ONE
-- `station_id` on it. An admin at Branch B assigning that item to B's grill silently
-- re-points the SAME item for Branch A, and overwrites the free-text mirror with B's code
-- — after which Branch A's tickets route to a code that may not exist there and fall
-- through to DEFAULT.
--
-- Each write passes its own branch guard. There is no guard against the LAST WRITER WINNING
-- ACROSS BRANCHES, because the row is not branch-scoped in the first place. V7__stations.sql
-- says exactly this in its own comment and defers it. It has been invisible only because no
-- UI calls the endpoint — the feature being dead is the only reason the bug does not bite,
-- and plan 28-10 is about to build that UI.
--
-- ══ AND THE CAPABILITY IT ADDS ══
--
-- D-28-04 wants one order spanning food and drink to produce two tickets. kitchen-service
-- ALREADY does that — it groups by station code and emits one ticket per order and station.
-- What has never existed is a supported way for a tenant to say WHICH items go where, per
-- branch. Without these tables, "an order spanning food and drink produces two tickets" is
-- a sentence about a code path nobody can reach.
--
-- ══ CATEGORY-LEVEL ROUTES ══
--
-- `menu_category_station_routes` is not a convenience. "Everything in Drinks goes to the
-- bar" is how this is actually configured; per-item rows would make that two hundred
-- checkbox clicks that then drift as items are added. An item-level route WINS over its
-- category's — see StationRoutingResolver for the full order.
--
-- ══ ROW LEVEL SECURITY, AND A NOTE FOR WHOEVER COMES NEXT ══
--
-- Both tables get tenant_isolation + ENABLE + FORCE here, per V11's posture.
-- RlsForcedInvariantIT fails the build otherwise and is not to be modified to accommodate
-- them.
--
-- FORCE binds the table OWNER too. A future migration that legitimately needs to touch rows
-- across tenants — a backfill, a repair — must TOGGLE the force flag around itself and put
-- it back, not quietly drop it. auth-service's changeset 058 does exactly that and is the
-- pattern to copy. A migration that "temporarily" disables FORCE and never restores it looks
-- identical in git to one that did, and the difference is 16 tenants reading each other.
-- ============================================================================

-- ── menu_item_station_routes ────────────────────────────────────────────────
-- One destination per item, per branch. THE row that makes an item's station a
-- per-branch fact instead of a tenant-wide one.
CREATE TABLE menu_item_station_routes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID        NOT NULL,
    branch_id    UUID        NOT NULL,
    menu_item_id UUID        NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    station_id   UUID        NOT NULL REFERENCES stations(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by   UUID,
    updated_by   UUID,
    deleted_at   TIMESTAMPTZ,
    CONSTRAINT uq_menu_item_station_route UNIQUE (tenant_id, branch_id, menu_item_id)
);

CREATE INDEX idx_menu_item_station_routes_lookup
    ON menu_item_station_routes (tenant_id, branch_id, menu_item_id);

ALTER TABLE menu_item_station_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_item_station_routes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_item_station_routes
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
GRANT SELECT, INSERT, UPDATE, DELETE ON menu_item_station_routes TO pos_user;

-- ── menu_category_station_routes ────────────────────────────────────────────
-- "All drinks go to the bar" — one row, not two hundred.
CREATE TABLE menu_category_station_routes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    branch_id   UUID        NOT NULL,
    category_id UUID        NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
    station_id  UUID        NOT NULL REFERENCES stations(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_by  UUID,
    deleted_at  TIMESTAMPTZ,
    CONSTRAINT uq_menu_category_station_route UNIQUE (tenant_id, branch_id, category_id)
);

CREATE INDEX idx_menu_category_station_routes_lookup
    ON menu_category_station_routes (tenant_id, branch_id, category_id);

ALTER TABLE menu_category_station_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_category_station_routes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_category_station_routes
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
GRANT SELECT, INSERT, UPDATE, DELETE ON menu_category_station_routes TO pos_user;

-- NOTE, deliberately not done here: menu_items.station_id and menu_items.kds_station are
-- NOT dropped and are NOT backfilled into these tables. The free-text mirror is still read
-- by the order-ready consumer on the POS side, and the legacy FK is still the fallback the
-- resolver uses for a tenant who has configured nothing. Retiring them is a later phase's
-- job with its own migration and its own consumer audit — not a side effect of this one.
