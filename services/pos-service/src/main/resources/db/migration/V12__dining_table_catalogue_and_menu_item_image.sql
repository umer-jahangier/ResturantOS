-- ============================================================================
-- 19b-01 — Dining-table catalogue columns + menu-item image reference
-- ============================================================================
-- Two additive column sets, one migration, because both are the storage half of
-- the same phase and neither is large enough to justify its own version number.
--
-- ══ 1. dining_tables.is_active / dining_tables.section ══
--
-- `dining_tables` shipped with `status` (AVAILABLE/OCCUPIED/NEEDS_BUSSING) and
-- nothing else that could hide a table. `status` is RUNTIME SERVICE STATE — it is
-- written by TableService.syncStatusForOrder on every order transition — so using
-- it to mean "this table no longer exists in this restaurant" would make an
-- occupied table un-retirable and a retired table flip itself back to AVAILABLE
-- the moment its last order closed. `is_active` is catalogue state and nothing
-- writes it except an explicit admin action.
--
-- No hard delete is offered and none is possible: orders.table_id references
-- these rows, and a closed order must keep naming the table it was served at.
--
-- `section` is a plain label ("Rooftop", "Garden", "Hall") a manager types, not a
-- second catalogue to CRUD before the first one is usable. Nullable, 50 chars,
-- grouped in the UI. Promote it to its own table if floor plans ever need it.
--
-- ══ 2. menu_items.image_file_id ══
--
-- Stores the file-service file id, NOT a URL. `imageUrl` is derived in MenuItemDto
-- as /api/v1/files/{id}/download. Persisting the URL would bake a route into every
-- row and go stale the day the route changes.
--
-- No FK: file_db is a different database owned by a different service. Referential
-- integrity is enforced at the application boundary instead — MenuServiceImpl
-- calls file-service's /internal/files/{id} metadata endpoint and refuses to
-- persist an id that does not resolve inside the caller's tenant as a real image.
--
-- ══ RLS ══
--
-- Both tables already run FORCE ROW LEVEL SECURITY (V11, phase 17b) with a
-- tenant_isolation policy on tenant_id. Adding a column to a forced table inherits
-- that policy — there is nothing to re-enable here, and deliberately no policy
-- change. RlsForcedInvariantIT fails the build if that ever stops being true.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS.
-- ============================================================================

-- ── dining_tables: catalogue state, separate from runtime status ─────────────
ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE dining_tables ADD COLUMN IF NOT EXISTS section   VARCHAR(50);

-- The default list (the table picker a waiter uses mid-service) is active-only and
-- branch-scoped; this is the index that read walks.
CREATE INDEX IF NOT EXISTS idx_dining_tables_branch_active
    ON dining_tables (tenant_id, branch_id, is_active);

-- ── menu_items: image reference ──────────────────────────────────────────────
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_file_id UUID;
