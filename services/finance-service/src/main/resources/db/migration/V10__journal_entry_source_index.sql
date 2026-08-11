-- 37-04: make "what did this order produce?" cheap.
--
-- journal_entries already carries source_type and source_id and has since phase 9, but there is no
-- index on either. The transaction register (37-08) calls the by-source lookup ONCE PER VISIBLE ROW,
-- so an unindexed lookup turns one screen into N sequential scans of the whole ledger.
--
-- The column order is deliberate. tenant_id leads because every query is tenant-scoped by the RLS
-- policy and the planner can then use the index for the policy predicate too. source_id precedes
-- source_type because the load-bearing question is "every entry this ORDER produced" across all
-- source types -- a closed order posts ORDER_REVENUE on close, ORDER_COGS when inventory depletes
-- and ORDER_REFUND later, three entries under three types sharing one source_id. Leading with
-- source_type would force a separate index scan per type.
--
-- Partial on source_id IS NOT NULL: hand-written adjustments carry no source at all and there is no
-- question to ask of them, so they are kept out of the index entirely.
CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant_source
    ON journal_entries (tenant_id, source_id, source_type)
    WHERE source_id IS NOT NULL;
