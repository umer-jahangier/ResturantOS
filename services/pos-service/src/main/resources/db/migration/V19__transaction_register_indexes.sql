-- 37-08 — supporting indexes for the transaction register (GET /api/v1/pos/transactions).
--
-- The register UNIONs three money-event sources (order_payments, order_refunds, and orders for
-- voids) and filters them on a date range. Measured with EXPLAIN (ANALYZE) against the live
-- pos_db: the CTE is inlined and the range predicate IS pushed down into each branch, so the
-- query is index-friendly — but every branch was a Seq Scan, because at 38 money events a Seq
-- Scan is genuinely the cheapest plan and the planner is right to pick it.
--
-- These indexes are therefore for the shape the query has at volume, not for today's numbers.
-- Verified applicable rather than merely plausible: with enable_seqscan = off the planner selects
-- each index below for its branch, which shows the index actually matches the predicate the
-- register issues. No speedup is claimed at this row count, because there is none to claim.
--
-- Every index is partial on the same `deleted_at IS NULL` predicate the register uses, so it stays
-- small and excludes soft-deleted rows the query can never return.
--
-- Written with IF NOT EXISTS so it is safe whether Flyway applies it first or it was applied by
-- hand during verification.
--
-- NOTE ON CONCURRENTLY: these are created in Flyway's transaction, which blocks writes to the
-- table for the duration. That is correct for the current data volume and consistent with every
-- other migration in this service. A deployment with a large orders table should create these
-- CONCURRENTLY outside a transaction instead.

-- TENDER branch: order_payments scanned by recorded_at over the requested range.
CREATE INDEX IF NOT EXISTS idx_order_payments_recorded_at
    ON order_payments (recorded_at DESC)
    WHERE deleted_at IS NULL;

-- REFUND branch: order_refunds scanned by created_at over the requested range.
CREATE INDEX IF NOT EXISTS idx_order_refunds_created_at
    ON order_refunds (created_at DESC)
    WHERE deleted_at IS NULL;

-- VOID branch: voids are a small minority of orders, so a partial index on voided_at keeps this
-- tiny and lets the branch skip the whole table instead of filtering it.
CREATE INDEX IF NOT EXISTS idx_orders_voided_at
    ON orders (voided_at DESC)
    WHERE voided_at IS NOT NULL AND deleted_at IS NULL;

-- The cashier filter. branch_id is already served by idx_orders_branch_status, whose leading
-- column it is; cashier_id had no index at all, so `?cashierId=` was a full scan on every call.
CREATE INDEX IF NOT EXISTS idx_orders_cashier_id
    ON orders (cashier_id)
    WHERE deleted_at IS NULL;
