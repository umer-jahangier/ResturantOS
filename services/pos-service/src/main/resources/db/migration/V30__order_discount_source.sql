-- V30 — a discount says HOW it was priced and, separately, WHO decided it.
--
-- THE BUG THIS CLOSES
--
-- `OrderServiceImpl.applyPromotions` built its row with `type = 'PROMOTION'` while
-- `order_discounts.type` has carried `CHECK (type IN ('FLAT','PERCENT'))` since V1. Every
-- automatic promotion therefore priced correctly, built its row, and died at flush:
--
--   ERROR: new row for relation "order_discounts" violates check constraint
--          "order_discounts_type_check"
--
-- POST /api/v1/pos/orders/{id}/promotions/apply is reachable (gated on pos.order.discount.order)
-- and returned 500 for any customer with a qualifying offer. Read back live on 2026-08-12,
-- `SELECT type, count(*) FROM order_discounts GROUP BY 1` returned PERCENT only: a CRM promotion
-- had never once reduced a bill in this product. No test covered the path either.
--
-- WHY THE CONSTRAINT IS RIGHT AND THE ENGINE IS WRONG
--
-- `type` is not a label, it is the unit discriminator for `value`, and three independent places
-- already say so in the same words:
--
--   * OrderServiceImpl.computeDiscountAmount — FLAT multiplies `value` by 100 (so `value` is
--     RUPEES); PERCENT divides it by 100 (so `value` is a RATE).
--   * deploy/clickhouse/V004__discount_facts.sql — "What was ASKED for: rupees for FLAT,
--     percent for PERCENT."
--   * frontend/lib/models/pos.model.ts — the same sentence again.
--
-- The promotion path set `value` to the capped PAISA figure. That is neither rupees nor a rate,
-- so 'PROMOTION' was quietly introducing a THIRD unit convention for `value` under cover of
-- being a third type. Widening the CHECK would have made that permanent: every reader of
-- `value` would need to know which of three units it was in, and the two that already exist are
-- documented in three places that would all have become wrong.
--
-- An automatic promotion resolved by the CRM engine to "Rs 150 off this check" IS a flat
-- discount of Rs 150. The engine's underlying rule (spend-and-save, tier offer, BOGO) is not
-- representable in this table and should not be — crm-service owns the rule, pos-service records
-- the money. So the promotion writes type = 'FLAT' with `value` in rupees, like every other flat
-- discount, and the fact that a machine chose it moves to its own column.
--
-- WHY NOT `reason`
--
-- `reason` (V22) is operator free text, 3–200 chars. Two places branch on provenance to stop
-- discounts stacking — applyPromotions replaces a previous promotion, and applyDiscount replaces
-- a previous MANUAL order-scope discount while deliberately leaving a promotion standing. A
-- predicate that decides how much money comes off a bill cannot be a substring match on a
-- sentence a manager is free to type. Provenance is a closed set, so it gets a closed column.
--
-- WHY `ADD COLUMN … NOT NULL DEFAULT` AND NOT AN `UPDATE`
--
-- Same trap V22 documented and paid for. `order_discounts` carries FORCE ROW LEVEL SECURITY, so
-- the table owner is not exempt from its own policies. Flyway runs as that owner on a connection
-- with no `app.current_tenant_id` GUC set: a backfilling UPDATE matches ZERO rows, while
-- `SET NOT NULL` is DDL, sees every pre-existing row, and refuses. `ADD COLUMN … NOT NULL
-- DEFAULT` is applied by the table rewrite itself, to every row, regardless of policy.
--
-- Unlike V22 the DEFAULT is KEPT, and that difference is deliberate. V22's default was a
-- placeholder confessing that the reason was never captured, so letting a future insert acquire
-- it silently would have defeated the column. 'MANUAL' is not a placeholder — it is the true and
-- overwhelmingly common classification, correct for all pre-existing rows (no PROMOTION row has
-- ever been written) and the right answer for any future human-initiated path that forgets to
-- name itself. The single automatic path names itself explicitly.
--
-- A WARNING FOR THE LOYALTY WORK THAT WILL LAND ON TOP OF THIS
--
-- `source` is a closed set and the obvious next value to reach for is 'REDEMPTION', when a guest
-- spends points or store credit. DO NOT ADD IT. A redemption is not a discount and does not
-- belong in this table at all:
--
--   * A DISCOUNT is the restaurant giving away its own margin. Gross sales fall. That is every
--     row here, manual or automatic.
--   * A REDEMPTION is the guest spending a liability the restaurant already owes them. The sale
--     happened at FULL price and was settled with something other than cash — it is a TENDER,
--     and it belongs in `order_payments` with its own method, exactly like a card.
--
-- Booking a redemption here would understate gross sales, overstate giveaway, and leave the
-- points liability sitting on the balance sheet after it had been settled. The Discount Summary
-- would report money the guest already owned as money the restaurant gave away, so an owner
-- would see the loyalty programme as pure cost with no offsetting drawdown — which is the exact
-- reading that gets a loyalty programme cancelled.
--
-- Of the seven models the product owner wants (points, punch-card, tiered, cashback, store
-- credit, birthday, referral), only punch-card, tiered and birthday are discounts. The rest are
-- liability issuance or redemption and need machinery that does not exist yet.
ALTER TABLE order_discounts
    ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'MANUAL';

ALTER TABLE order_discounts
    DROP CONSTRAINT IF EXISTS order_discounts_source_check;

ALTER TABLE order_discounts
    ADD CONSTRAINT order_discounts_source_check
        CHECK (source IN ('MANUAL', 'PROMOTION'));

-- Reading the Discount Summary means asking "what did this branch give away automatically last
-- month, and what did its managers give away by hand" — which is source + tenant, over a date
-- range the report gets from `orders`.
CREATE INDEX IF NOT EXISTS idx_order_discounts_tenant_source
    ON order_discounts (tenant_id, source);

COMMENT ON COLUMN order_discounts.type IS
    'How to read `value`: FLAT means `value` is RUPEES, PERCENT means `value` is a RATE. Nothing '
    'else belongs here — provenance lives in `source`. Constrained to FLAT/PERCENT since V1.';
COMMENT ON COLUMN order_discounts.source IS
    'WHO decided this discount: MANUAL for a human at the till or a manager override, PROMOTION '
    'for a row the crm-service promotion engine applied automatically. Orthogonal to `type` — an '
    'automatic discount is still priced as FLAT or PERCENT. Never null since V30.';
