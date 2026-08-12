-- ============================================================================
-- F16/F20/B3 interaction — what a discount does to the tax, decided out loud.
-- ============================================================================
-- ══ WHAT WAS ACTUALLY WRONG ══
--
-- `OrderServiceImpl.recomputeOrderTotals` priced two charges on the same bill by opposite
-- rules. Tax was the sum of the per-line snapshots V23 stamps at add-item time, taken on the
-- GROSS line; the service charge V24 introduced was recomputed on the NET of every discount:
--
--     tax += item.getTaxPaisa();                          -- gross, stamped once, never revisited
--     applyServiceCharge(order, subtotal - totalDiscount); -- net, recomputed every mutation
--
-- So a discount moved one charge and not the other. Measured live on 2026-08-12 at Floating
-- Terrace F-7, order ORD-20260812-0356: a Rs 49.90 line discount moved the service charge and
-- left the tax at Rs 12.80, where the discounted base gives Rs 12.01 — Rs 0.79 over-charged on
-- one line discount. Comping the check further, the charge page read
--
--     Subtotal Rs 809.00 | Discounts Rs 579.00 | Taxes Rs 12.80 | Total Rs 254.30
--
-- i.e. output tax collected and remitted on Rs 809.00 of food when Rs 230.00 was sold.
--
-- This was nobody's defect. B3 made discounts reachable, V23 put the per-line tax snapshot in
-- place and V24 put the service charge beside it; each is correct alone. The interaction had no
-- owner, so it had no decision — which is what this migration and the javadoc on
-- `recomputeOrderTotals` exist to fix.
--
-- ══ WHY THE DEFAULT IS NET ══
--
-- Under Pakistani sales tax the value of supply is normally the discounted price where the
-- discount is shown on the invoice — and this product shows it: `orders.discount_paisa` prints
-- on every bill and B3 gave every discount its own reviewable row. Taxing the pre-discount
-- price would collect output tax on consideration the restaurant never received.
--
-- It is also what this codebase already says it does. `OrderPricingCalculator.perLineTax` is
-- documented "taxRatePct applied to net line" and `computeItemLine` runs
-- subtotal -> discount -> net -> tax(net). That path has never once executed on a real discount,
-- because its only caller passes a hard-coded `0L` for the discount (OrderServiceImpl, addItem)
-- and every later discount arrives as an `order_discounts` row that never re-enters the
-- calculator. `order_items.discount_paisa` is 0 on every row this product has ever written.
-- The gross behaviour was an artefact of that zero, not a position anyone took.
--
-- ══ WHY IT IS A SETTING AND NOT A CONSTANT ══
--
-- "Normally" is doing real work in the sentence above. Whether a discount reduces the value of
-- supply is a jurisdiction fact and a question about how a particular discount is documented,
-- and it is the tenant — the person who signs the return — who knows the answer for their
-- business, not this codebase. A tenant whose position is that the pre-discount price is the
-- value of supply sets GROSS and gets exactly the arithmetic they had before this shipped.
--
-- TENANT-scoped, not branch-scoped, and the split is the same one V24 drew in the other
-- direction: a service charge is a commercial decision about one dining room, so it lives on
-- `branch_service_charge`; a sales-tax position is a statutory fact about the business and
-- cannot differ between two dining rooms, so it lives here beside `tax_classes` (V23), which is
-- tenant-scoped for the identical reason.
--
-- ══ WHY AN ABSENT ROW IS NET AND NOT AN ERROR ══
--
-- Every tenant upgrading into this migration has no row, and must behave as NET without anyone
-- visiting a screen — the same shape `ServiceChargeServiceImpl.unconfigured` uses to answer for
-- a branch nobody has configured. A pricing read that could fail, 404 or degrade would put the
-- money path at the mercy of a settings lookup, which is the failure V24's header refuses at
-- length. `TaxPolicyService.policyFor` returns an Optional and empty means NET.
--
-- ══ WHAT THIS DOES *NOT* DO ══
--
-- It does not restate history. `recomputeOrderTotals` runs only while an order is being
-- mutated, so every closed check keeps the tax it was settled at, and the rows
-- reporting-service has already written to `sales_order_facts` — the rows
-- `FbrTaxSummaryService` sums into output tax on a return — do not move. Checks still OPEN at
-- deploy re-base the next time anything on them changes, which is correct: an open check has
-- not been presented to a guest yet.
--
-- It also does not decide whether a service charge is itself standard-rated. That question is
-- still open and still deferred, and `OrderPricingCalculator.serviceCharge` still says so.
--
-- ══ ROW LEVEL SECURITY ══
--
-- tenant_isolation + ENABLE + FORCE, per V11's posture. RlsForcedInvariantIT fails the build
-- otherwise and is not to be modified to accommodate this table.
-- ============================================================================

CREATE TABLE tenant_tax_policy (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL,
    -- NET or GROSS, spelled rather than a boolean. `discount_reduces_tax_base = false` in a
    -- database dump is a fact a reader has to reason about; 'GROSS' is one they can act on, and
    -- this column will be read by somebody reconciling a return under time pressure.
    tax_base   VARCHAR(10) NOT NULL DEFAULT 'NET',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID,
    updated_by UUID,
    -- Present because TenantAuditableEntity maps it, not because anything sets it: see the
    -- unique index below for why this table has no soft delete.
    deleted_at TIMESTAMPTZ,
    CONSTRAINT ck_tenant_tax_policy_base CHECK (tax_base IN ('NET', 'GROSS'))
);

-- One policy per tenant. Not partial-on-deleted_at: there is no soft delete here, because
-- "we went back to the default" is tax_base = 'NET' and keeping the row keeps the position the
-- tenant used to hold visible to whoever asks why last quarter's returns were computed
-- differently.
CREATE UNIQUE INDEX uq_tenant_tax_policy_tenant ON tenant_tax_policy (tenant_id);

ALTER TABLE tenant_tax_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_tax_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_tax_policy
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_tax_policy TO pos_user;

COMMENT ON TABLE tenant_tax_policy IS
    'One tenant''s sales-tax base position. Read inside the order transaction by OrderServiceImpl.recomputeOrderTotals; never through a cross-service call, because pricing cannot be fail-soft. No row means NET.';
COMMENT ON COLUMN tenant_tax_policy.tax_base IS
    'NET: tax is charged on the line after its share of every discount (the default, and the normal Pakistani value-of-supply position where the discount is shown on the invoice). GROSS: tax is charged on the undiscounted line. Changing this does not restate any check already closed.';

-- ── the order line's record of which rule priced it ─────────────────────────
-- NOT NULL DEFAULT in one statement, never ADD-then-UPDATE: `order_items` carries FORCE ROW
-- LEVEL SECURITY and Flyway runs as the owner with no `app.current_tenant_id` GUC, so an UPDATE
-- backfill matches zero rows while a later SET NOT NULL sees every one of them and refuses.
-- V22 shipped that exact mistake and could not boot; V23 and V24 both record the same warning.
--
-- 'GROSS' is the correct backfill for every existing row, and it is a statement of fact rather
-- than a default: every line written before this migration was taxed on its gross amount,
-- because that is the only thing the code could do. A bill reprinted from last month must keep
-- saying what the guest was actually charged — the same reason V23 snapshotted `tax_rate_pct`
-- onto the line instead of re-reading the menu at print time.
ALTER TABLE order_items
    ADD COLUMN IF NOT EXISTS tax_base VARCHAR(10) NOT NULL DEFAULT 'GROSS';

-- New rows are stamped by the pricing path, which writes the tenant's policy at the moment the
-- total was last computed. The default above applies only to rows that predate this column.
ALTER TABLE order_items
    ALTER COLUMN tax_base SET DEFAULT 'NET';

ALTER TABLE order_items
    ADD CONSTRAINT ck_order_items_tax_base CHECK (tax_base IN ('NET', 'GROSS'));

COMMENT ON COLUMN order_items.tax_base IS
    'Which rule priced THIS line''s tax_paisa, frozen when the total was last computed — exactly as tax_rate_pct freezes the rate. GROSS on every row written before V27, because that is what the code did. Lets a return be reconciled without guessing which policy was in force.';
