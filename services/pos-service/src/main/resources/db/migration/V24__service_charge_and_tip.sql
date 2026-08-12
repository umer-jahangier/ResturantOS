-- ============================================================================
-- F20 — A service charge a branch can actually set, and a tip a cashier can
--       actually take.
-- ============================================================================
-- ══ WHAT WAS ACTUALLY WRONG ══
--
-- `orders.service_charge_paisa` has existed since V1. It is summed by DailyTakingsService,
-- carried on ORDER_CLOSED, credited to account 4910 by finance's AutoPostingRecipeEngine,
-- printed by ReceiptDocumentAssembler and rendered by the charge page. Every consumer of the
-- number was built. Nothing in the product could ever make it non-zero: measured on
-- 2026-08-12, `service_charge_paisa` was 0 on all 195 orders in pos_db, and it is 0 because
-- no code path anywhere assigns it. The visible symptom was a line reading
-- `Service charge Rs 0.00` on the charge page and on every guest's bill — a charge the
-- restaurant is told about, cannot influence, and never collects.
--
-- Tips were worse: there was no column, no field, no control. A cashier taking a card
-- payment could not record a tip at all, so tips either never happened or were folded into
-- the sale — which books staff money as the restaurant's revenue and taxes it as such.
--
-- ══ WHY THE POLICY LIVES IN pos_db AND NOT ON `branches` ══
--
-- `branches` is user-service's table and pos-service reaches it only through
-- UserBranchClient, which is deliberately FAIL-SOFT: a receipt degrades rather than fails
-- when user-service is unreachable. Pricing cannot be fail-soft. If the rate lookup could
-- silently return "no charge" during a user-service blip, two checks rung ten seconds apart
-- would carry different totals with nothing on screen saying why, and the ledger would
-- record both as correct. The rate a bill is computed from must come from the same
-- transaction that writes the bill.
--
-- ══ WHY THE ORDER SNAPSHOTS THE RATE ══
--
-- `orders.service_charge_pct` and `service_charge_label` freeze what was charged, exactly as
-- V23 froze `order_items.tax_rate_pct` and for the identical reason: a bill reprinted after
-- the rate changes must describe the money the guest actually paid, not the policy in force
-- on the day of the reprint. Without the snapshot the only honest thing the receipt could
-- print is a bare amount with no percentage against it.
--
-- ══ THE TIP IS NOT PART OF THE BILL ══
--
-- `tip_paisa` sits on the PAYMENT, not on the order, because that is what it is: money
-- handed over on top of a settled amount, on one tender, at one moment. Putting it on
-- `orders` would have forced it into `total_paisa` and therefore into
-- `subtotal - discount + tax + service_charge == total`, which is the invariant finance
-- balances the revenue journal entry against — and a tip is not revenue. It is money the
-- restaurant is holding for its staff. finance credits it to a liability.
--
-- `ck_order_payments_tender_covers_applied` is widened from `tendered >= amount` to
-- `tendered >= amount + tip` for the same reason `change_paisa` was constrained in V10: the
-- three numbers on a payment row describe one physical handover and must add up. A Rs 1,000
-- note against a Rs 900 bill with a Rs 50 tip is amount=900, tip=50, change=50, tendered=1000.
--
-- ══ ROW LEVEL SECURITY ══
--
-- tenant_isolation + ENABLE + FORCE, per V11's posture. RlsForcedInvariantIT fails the build
-- otherwise and is not to be modified to accommodate this table.
-- ============================================================================

-- ── the branch's policy ─────────────────────────────────────────────────────
CREATE TABLE branch_service_charge (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID          NOT NULL,
    branch_id     UUID          NOT NULL,
    -- Off is the default and the only safe one. A tenant upgrading into this migration must
    -- not discover tomorrow that every bill grew by a percentage nobody typed.
    enabled       BOOLEAN       NOT NULL DEFAULT FALSE,
    rate_pct      NUMERIC(5,2)  NOT NULL DEFAULT 0,
    -- What the guest reads on the paper. "Service charge" is the default; a tenant that calls
    -- it a "Service fee" or "Gratuity" should not have to accept our word for it on their bill.
    label         VARCHAR(60)   NOT NULL DEFAULT 'Service charge',
    -- Which channels it applies to. A service charge pays for table service, so dine-in is on
    -- and the counter channels are off — charging a walk-in for waiting on themselves is the
    -- single most common way a restaurant gets this wrong in public.
    dine_in       BOOLEAN       NOT NULL DEFAULT TRUE,
    takeaway      BOOLEAN       NOT NULL DEFAULT FALSE,
    pickup        BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_by    UUID,
    updated_by    UUID,
    -- Present because TenantAuditableEntity maps it, not because anything sets it: see the
    -- unique index below for why this table has no soft delete.
    deleted_at    TIMESTAMPTZ,
    CONSTRAINT ck_branch_service_charge_rate CHECK (rate_pct >= 0 AND rate_pct <= 100),
    -- An enabled policy at 0% is a control that looks armed and does nothing. Refused at the
    -- database so no writer can express it, however it is called.
    CONSTRAINT ck_branch_service_charge_enabled_rate CHECK (NOT enabled OR rate_pct > 0)
);

-- One policy per branch. Not partial-on-deleted_at: there is no soft delete here, because
-- "we no longer take a service charge" is `enabled = FALSE` and keeping the row keeps the
-- rate the branch used to charge visible to whoever asks why last month's bills differ.
CREATE UNIQUE INDEX uq_branch_service_charge_branch
    ON branch_service_charge (tenant_id, branch_id);

ALTER TABLE branch_service_charge ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_service_charge FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branch_service_charge
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
GRANT SELECT, INSERT, UPDATE, DELETE ON branch_service_charge TO pos_user;

COMMENT ON TABLE branch_service_charge IS
    'One branch''s service-charge policy. Read inside the order transaction by OrderServiceImpl.recomputeOrderTotals; never through a cross-service call, because pricing cannot be fail-soft.';
COMMENT ON COLUMN branch_service_charge.rate_pct IS
    'Percentage of the net-of-discount, pre-tax subtotal. Applied HALF_UP to whole paisa by OrderPricingCalculator.serviceCharge.';

-- ── the order's snapshot of it ──────────────────────────────────────────────
-- NOT NULL DEFAULT in one statement, never ADD-then-UPDATE: `orders` carries FORCE ROW LEVEL
-- SECURITY and Flyway runs as the owner with no `app.current_tenant_id` GUC, so an UPDATE
-- backfill matches zero rows while a later SET NOT NULL sees every one of them and refuses.
-- V22 shipped that exact mistake and could not boot; V23 records the same warning.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS service_charge_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS service_charge_label VARCHAR(60);

COMMENT ON COLUMN orders.service_charge_pct IS
    'The rate this check was actually charged at, frozen when the total was last computed. 0 means no service charge applied — the receipt then prints no service-charge line at all.';
COMMENT ON COLUMN orders.service_charge_label IS
    'The branch''s wording for the charge at the time of sale, so a bill reprinted after a rename still reads the way the guest saw it. NULL when no charge applied.';

-- ── the tip ─────────────────────────────────────────────────────────────────
ALTER TABLE order_payments
    ADD COLUMN IF NOT EXISTS tip_paisa BIGINT NOT NULL DEFAULT 0;

ALTER TABLE order_payments
    ADD CONSTRAINT ck_order_payments_tip_non_negative CHECK (tip_paisa >= 0);

-- Widen the V10 constraint rather than adding a second one, so there is exactly one statement
-- of what a payment row must add up to.
ALTER TABLE order_payments
    DROP CONSTRAINT IF EXISTS ck_order_payments_tender_covers_applied;
ALTER TABLE order_payments
    ADD CONSTRAINT ck_order_payments_tender_covers_applied
        CHECK (tendered_paisa >= amount_paisa + tip_paisa);

COMMENT ON COLUMN order_payments.tip_paisa IS
    'Money taken ON TOP of the bill for the staff. Never part of orders.total_paisa and never revenue: finance credits it to the Tips Payable liability. tendered = amount + tip + change.';
