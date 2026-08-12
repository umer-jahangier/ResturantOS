-- ============================================================================
-- S6 — The modifier CATALOGUE: "no chilli", "extra cheese +Rs 150", "medium spicy"
-- ============================================================================
-- ══ WHAT WAS ACTUALLY WRONG ══
--
-- `modifier_groups` and `modifiers` have existed since V1 and nothing has ever written a
-- row to either. There was no repository, no service, no route and no screen — a cashier
-- could not ring "no onions" and an owner could not price "extra cheese".
--
-- The ORDER side, by contrast, was fully wired the whole time: OrderServiceImpl builds
-- `order_item_modifiers` from `request.modifierIds()`, OrderPricingCalculator already sums
-- the deltas into the line subtotal, OrderMapper maps them to the DTO, and BOTH
-- KitchenTicketAssembler and ReceiptDocumentAssembler already print them on the ticket and
-- on the bill.
--
-- So the gap was not "modifiers do nothing". It was worse than that. Any modifier id that
-- DID reach addItem was written as:
--
--     oim.setModifierNameSnapshot(modifierId.toString());   // "for simplicity"
--     oim.setPriceDeltaPaisa(0L);
--
-- — a UUID, at zero price, printed on the kitchen ticket AND on the guest's receipt. The
-- catalogue this migration completes is what lets that stub be replaced by a real lookup.
--
-- ══ WHAT THIS MIGRATION CHANGES ══
--
-- Nothing is created; both tables exist. What they lacked was every constraint that makes
-- the catalogue safe to write to from a screen:
--
--   * `sort_order` on both — the order a cashier sees the groups and the options in. Without
--     it the dialog's rows come back in whatever order the planner felt like, and a till that
--     reorders its own buttons between taps is a mis-punch waiting to happen.
--   * `active` on `modifier_groups` — `modifiers.active` already existed, so an OPTION could
--     be retired but the GROUP holding it could not. Retiring is not deleting: a group that
--     has been rung on ten thousand historical checks must stay readable.
--   * CHECK constraints on min/max — `min_select <= max_select`, `max_select >= 1`, and
--     `required` in agreement with `min_select >= 1`. Two columns that can contradict each
--     other are two answers, and the validator that reads them has to pick one.
--   * ON DELETE CASCADE from `modifiers` to `modifier_groups` — deleting a group takes its
--     options with it. JPA's orphanRemoval does this too; the database says it as well so a
--     hand-run DELETE cannot leave options pointing at nothing.
--   * Unique names, case-insensitive, per parent — two "Extra cheese" options in one group
--     is a cashier's ambiguity, not a catalogue.
--   * The two lookup indexes the till's per-item read needs.
--
-- ══ WHY NO BACKFILL, AND WHY THE DEFAULTS ARE SAFE ══
--
-- Both tables are empty in every tenant (verified: `SELECT count(*)` = 0 in pos_db on
-- 2026-08-12), so there is no data to migrate and no CHECK that can fail on an existing row.
-- The `NOT NULL DEFAULT` columns are still written as ADD COLUMN ... NOT NULL DEFAULT rather
-- than ADD-then-UPDATE, per V23's note: these tables carry FORCE ROW LEVEL SECURITY, Flyway
-- runs as the owner with no `app.current_tenant_id` GUC, and an UPDATE backfill would match
-- zero rows while a later SET NOT NULL saw every one of them. The default is applied by the
-- table rewrite regardless of policy. V22 shipped that exact mistake once already.
--
-- ══ ROW LEVEL SECURITY ══
--
-- Untouched and already correct: both tables were ENABLEd with a `tenant_isolation` policy in
-- V1 and FORCEd in V11. `RlsForcedInvariantIT` guards that and is not modified here.
-- ============================================================================

-- ── modifier_groups ─────────────────────────────────────────────────────────
ALTER TABLE modifier_groups ADD COLUMN IF NOT EXISTS sort_order INT     NOT NULL DEFAULT 0;
ALTER TABLE modifier_groups ADD COLUMN IF NOT EXISTS active     BOOLEAN NOT NULL DEFAULT TRUE;

-- `required` and `min_select` are the same fact stated twice, so the database refuses to hold
-- them in disagreement. A forced group ("choose a spice level") is exactly one whose minimum
-- is at least one; an optional group's minimum is zero. The service enforces the same rule and
-- names the field; this is the second line, for anything that reaches the table another way.
ALTER TABLE modifier_groups DROP CONSTRAINT IF EXISTS modifier_groups_select_bounds_chk;
ALTER TABLE modifier_groups ADD CONSTRAINT modifier_groups_select_bounds_chk CHECK (
    min_select >= 0
    AND max_select >= 1
    AND min_select <= max_select
    AND (required = (min_select >= 1))
);

CREATE INDEX IF NOT EXISTS idx_modifier_groups_tenant_item
    ON modifier_groups (tenant_id, menu_item_id);

-- Case-insensitive, and only over live rows: a group soft-deleted last year must not stop a
-- manager reusing its name today.
CREATE UNIQUE INDEX IF NOT EXISTS uq_modifier_groups_item_name
    ON modifier_groups (tenant_id, menu_item_id, lower(name))
    WHERE deleted_at IS NULL;

-- ── modifiers ───────────────────────────────────────────────────────────────
ALTER TABLE modifiers ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;

-- A modifier may REDUCE the price ("no cheese, -Rs 50") so the delta is deliberately not
-- constrained to be positive. It is BIGINT paisa like every other money column in this
-- schema; there is no float anywhere near it.
ALTER TABLE modifiers DROP CONSTRAINT IF EXISTS modifiers_modifier_group_id_fkey;
ALTER TABLE modifiers ADD CONSTRAINT modifiers_modifier_group_id_fkey
    FOREIGN KEY (modifier_group_id) REFERENCES modifier_groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_modifiers_tenant_group
    ON modifiers (tenant_id, modifier_group_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_modifiers_group_name
    ON modifiers (tenant_id, modifier_group_id, lower(name))
    WHERE deleted_at IS NULL;
