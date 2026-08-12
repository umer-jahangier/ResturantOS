-- V27 — a discount's `value` is bounded in the database, not only at the API.
--
-- `scope` and `type` have carried CHECK constraints since V1 (lines 235-236). `value` carried
-- none: `value NUMERIC(12,4) NOT NULL` and nothing else. So the column accepted a 200% discount,
-- and a negative one, and the only thing standing between it and the Discount Summary report was
-- application code.
--
-- WHAT THIS IS FOR. The API now refuses `value <= 0`, and refuses a PERCENT over 100, and refuses
-- any amount larger than what is still discountable — see OrderServiceImpl.applyDiscount and
-- computeDiscountAmount. This constraint exists because a bound enforced in one layer only is not
-- a bound; it is a convention that the next write path added will not know about. The promotion
-- engine already writes to this table by another route.
--
-- THE ROWS THAT PROVE IT. Read live from pos_db on 2026-08-12, of 17 discount rows:
--
--   scope | type    | value    | amount_paisa | reason
--   LINE  | PERCENT | 200.0000 |    145000    | probing overshoot
--   LINE  | PERCENT | 200.0000 |     49900    | two hundred percent at the API
--
-- Both say 200% and both moved the bill by an amount that is not 200% of anything — the row states
-- one thing and the money did another, which is the entire defect. The money was never wrong:
-- OrderPricingCalculator.effectiveDiscount clamps the amount to what is actually there, so the
-- bill cannot go negative. It is the RECORD that lied, and the record is what the guest's bill
-- line and the report's "Discount Value" column are printed from.
--
-- Both rows are probes: same applied_by, same afternoon, reasons that describe themselves. No real
-- trading history is in this set. `value <= 0` rows: none.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS `NOT VALID`, AND WHY THERE IS NO `UPDATE` HERE
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--
-- The intended shape was: repair the two rows to state the money that actually came off, then add
-- a validated CHECK. The repair is provable rather than a guess — when a PERCENT value exceeds
-- 100 the requested amount necessarily exceeds the base, so effectiveDiscount clamped it to the
-- base exactly, and the discount that was really applied was 100% of what was left. `value = 100`
-- is therefore the precise restatement, not an approximation.
--
-- IT CANNOT BE DONE FROM A MIGRATION ON THIS TABLE. `order_discounts` carries FORCE ROW LEVEL
-- SECURITY, so the table's owner is not exempt from its own policies, and Flyway runs as that
-- owner on a connection with no `app.tenant_id` GUC set. An UPDATE here matches ZERO rows while
-- DDL — which RLS does not filter — still sees every row. That is not a hypothesis: it is exactly
-- how V22 first shipped and failed to boot, and V22's own header records the wreck
-- (`SQL State 23502 … contains null values`). A repair UPDATE followed by a validating CHECK
-- would reproduce it precisely: the UPDATE would silently touch nothing and the constraint would
-- then refuse the rows it was supposed to have fixed.
--
-- The ways to force it — DISABLE ROW LEVEL SECURITY, or NO FORCE, around the UPDATE — are the
-- thing this codebase must not learn to do. Suppressing a protection to bulk-rewrite money rows
-- is how 96 posted journal entries were altered in this project earlier this month. A migration
-- that quietly rewrites financial records is not a migration.
--
-- So the door is shut and the room is left as it is:
--
--   * NOT VALID means every INSERT and every UPDATE is checked from this moment on. No new row can
--     be born overstated, by any write path, including ones not yet written.
--   * Existing rows are neither checked nor touched. The two probe rows stay visible and honest
--     rather than being silently restated by a migration nobody watched run.
--
-- TO FINISH THE JOB — a deliberate, credentialed step, not a migration:
--
--   SET app.tenant_id = '<tenant>';   -- per tenant; RLS is why this cannot be done blind
--   UPDATE order_discounts SET value = 100 WHERE type = 'PERCENT' AND value > 100;
--   -- then, once every tenant is clean and `value <= 0` is still empty:
--   ALTER TABLE order_discounts VALIDATE CONSTRAINT order_discounts_value_bounded;
--
-- VALIDATE takes only a SHARE UPDATE EXCLUSIVE lock and does not rewrite the table, so it is safe
-- to run against a live till. If it fails, a row is still lying and wants looking at by a person.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'order_discounts_value_bounded'
    ) THEN
        ALTER TABLE order_discounts
            ADD CONSTRAINT order_discounts_value_bounded
            CHECK (value > 0 AND (type <> 'PERCENT' OR value <= 100))
            NOT VALID;
        RAISE NOTICE 'V27: added order_discounts_value_bounded (NOT VALID) — new and updated rows are now bounded; pre-existing rows are unchecked and untouched.';
    ELSE
        RAISE NOTICE 'V27: order_discounts_value_bounded already present, nothing to do.';
    END IF;
END $$;

COMMENT ON COLUMN order_discounts.value IS
    'Percent for PERCENT, rupees for FLAT — never paisa. Bounded since V27: > 0 always, and <= 100 for PERCENT. The API additionally refuses any value worth more than what is still discountable, so this column states the money that actually came off.';
