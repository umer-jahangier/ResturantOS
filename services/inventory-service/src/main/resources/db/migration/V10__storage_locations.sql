-- Inventory Service - V10 Migration: storage_locations master data
--
-- Promotes ingredients.storage_location (free text, V6) to tenant-managed master data, for the
-- same reason V5 promoted ingredients.category: free text fragments silently. "Walk-in Cooler",
-- "walk in cooler" and "WIC" are three storage locations to a database and one shelf to a chef,
-- so nothing can group by it, no count sheet can be ordered by it, and no expiry sweep can be
-- scoped to it.
--
-- Additive only. The legacy ingredients.storage_location column is RETAINED and kept in sync by
-- IngredientService, exactly like V5 retained ingredients.category — anything still reading the
-- text keeps working while storage_location_id becomes the source of truth.

-- ── (1) storage_locations ────────────────────────────────────────────────────
CREATE TABLE storage_locations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID          NOT NULL,
    name        VARCHAR(80)   NOT NULL,
    description VARCHAR(255),
    sort_order  INT           NOT NULL DEFAULT 0,
    archived_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by  UUID,
    updated_by  UUID,
    deleted_at  TIMESTAMPTZ
);

-- Case-insensitive uniqueness, matching V7's uq_uom_tenant_code_ci. Two locations differing only
-- in casing are the same shelf, and letting both exist recreates exactly the fragmentation this
-- table is here to end.
CREATE UNIQUE INDEX uq_storage_location_tenant_name_ci
    ON storage_locations (tenant_id, lower(name));

-- ── (2) ingredients.storage_location_id ──────────────────────────────────────
-- Nullable by design: a storage location is genuinely optional (a dry good may not have one),
-- unlike category_id, which V5 made NOT NULL because every item must cost somewhere.
ALTER TABLE ingredients ADD COLUMN storage_location_id UUID;

-- ── (3) Backfill from the legacy free-text column ────────────────────────────
-- Same NO FORCE window V5 used, for the same reason: in production the Flyway user owns
-- `ingredients` and the table is FORCE ROW LEVEL SECURITY, so with no app.current_tenant_id GUC
-- set during a migration the tenant_isolation predicate is NULL for every row and both the read
-- and the write below would silently touch nothing. The window is closed again immediately.
-- This must run BEFORE step (5) enables RLS on storage_locations, or the INSERT would be
-- filtered the same way.
ALTER TABLE ingredients NO FORCE ROW LEVEL SECURITY;

-- DISTINCT ON collapses casing variants to ONE row per (tenant, lower(name)) — without it the
-- unique index above would reject the insert outright on any tenant that has both "Freezer" and
-- "freezer". min(name) makes which casing survives deterministic rather than insertion-ordered.
INSERT INTO storage_locations (tenant_id, name)
SELECT tenant_id, min(btrim(storage_location)) AS name
FROM ingredients
WHERE NULLIF(btrim(storage_location), '') IS NOT NULL
GROUP BY tenant_id, lower(btrim(storage_location));

UPDATE ingredients i
SET storage_location_id = s.id
FROM storage_locations s
WHERE s.tenant_id = i.tenant_id
  AND lower(s.name) = lower(btrim(i.storage_location));

-- Re-align the retained text column with the canonical casing that won above, so the two
-- representations agree from the very first read rather than only after the next save.
UPDATE ingredients i
SET storage_location = s.name
FROM storage_locations s
WHERE s.id = i.storage_location_id
  AND i.storage_location IS DISTINCT FROM s.name;

-- Mandatory: close the NO FORCE window. ingredients must never leave a migration with FORCE ROW
-- LEVEL SECURITY disabled.
ALTER TABLE ingredients FORCE ROW LEVEL SECURITY;

-- ── (4) FK + index ───────────────────────────────────────────────────────────
-- RESTRICT, not CASCADE: deleting a storage location must never silently detach the ingredients
-- filed under it. The service archives instead of deleting anyway (D-04's convention).
ALTER TABLE ingredients ADD CONSTRAINT fk_ingredient_storage_location
    FOREIGN KEY (storage_location_id) REFERENCES storage_locations(id) ON DELETE RESTRICT;
CREATE INDEX idx_ingredients_tenant_storage_location
    ON ingredients (tenant_id, storage_location_id);

COMMENT ON COLUMN ingredients.storage_location IS
    'Legacy free-text label, retained for history and kept in sync with storage_location_id''s '
    'name by IngredientService. storage_location_id is the source of truth.';

-- ── (5) RLS, per the inventory FORCE-RLS convention ──────────────────────────
ALTER TABLE storage_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage_locations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON storage_locations
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

GRANT SELECT, INSERT, UPDATE, DELETE ON storage_locations TO inventory_user;
