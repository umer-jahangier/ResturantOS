-- ============================================================
-- POS Service - V10
-- Separates "what the customer handed over" from "what was applied to the bill".
--
-- recordPayment accepted any amount with no cap and PaymentStatusDerivationService documented
-- the consequence as intended behaviour ("overpay clamps to PAID"). ORDER_CLOSED then carried
-- every payment row verbatim, so finance debited the tendered cash and credited
-- subtotal - discount + tax + serviceCharge. Any over-tender — the ordinary cash case, Rs 1000
-- for a Rs 950 bill — produced debits > credits, the deferred balance trigger rejected the
-- journal entry, and the consumer threw. Reproduced live on 2026-08-01:
--
--     ERROR: JE_UNBALANCED: entry 51f1a4f1-... DR=129300 CR=124300
--
-- The message did not dead-letter. It was requeued with no backoff and no cap and was still
-- climbing at ~17 failed attempts/second after 2,371 attempts, pinning a listener thread and a
-- database connection, while the order sat CLOSED with a posted COGS entry and no revenue entry.
--
-- amount_paisa keeps its meaning — the amount APPLIED — and is now capped server-side at the
-- outstanding balance. tendered_paisa and change_paisa carry the cash-drawer reality for till
-- reconciliation and the customer receipt.
-- ============================================================

ALTER TABLE order_payments
    ADD COLUMN tendered_paisa BIGINT,
    ADD COLUMN change_paisa   BIGINT;

-- Backfill: every historical row was recorded as "tendered exactly the applied amount", which is
-- true for all of them except the over-tendered ones — and those are precisely the rows whose
-- orders have no revenue entry. Restating them here would silently change a closed order's
-- history; they are left as-is and surface in the reconciliation query documented in the
-- integration audit instead.
-- pos_db is ENABLE (not FORCE) ROW LEVEL SECURITY and the Flyway user owns these tables, so this
-- UPDATE needs no NO FORCE window — unlike the finance/inventory backfills.
UPDATE order_payments
   SET tendered_paisa = amount_paisa,
       change_paisa   = 0
 WHERE tendered_paisa IS NULL;

ALTER TABLE order_payments
    ALTER COLUMN tendered_paisa SET NOT NULL,
    ALTER COLUMN change_paisa   SET NOT NULL,
    ALTER COLUMN change_paisa   SET DEFAULT 0;

-- Change is never negative and never exceeds what was handed over. A violation here means the
-- capping logic in PaymentServiceImpl was bypassed.
ALTER TABLE order_payments
    ADD CONSTRAINT ck_order_payments_change_non_negative
        CHECK (change_paisa >= 0 AND change_paisa <= tendered_paisa),
    ADD CONSTRAINT ck_order_payments_tender_covers_applied
        CHECK (tendered_paisa >= amount_paisa);
