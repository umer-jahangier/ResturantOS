-- Inventory Service - V9 Migration: stock-count variance cap audit trail
--
-- `item_categories.variance_cap_pct` has existed since V5 and been settable from the category form
-- since 08.2, but NOTHING has ever read it. Every count variance posted at any magnitude, with no
-- threshold and no approval step: a fat-fingered count turning 4100 g into 41 g wrote off the
-- difference silently, indistinguishable in the ledger from a correctly counted 41.
--
-- StockCountService now compares each line's variance against the cap resolved for that
-- ingredient's category (most-specific-wins up the tree, exactly like the GL accounts beside it)
-- and refuses to post an over-cap line unless the counter supplies a reason. These columns are the
-- audit trail for that decision.
--
-- All three are nullable and purely additive; existing count lines keep their history untouched
-- and simply carry NULLs, which read as "posted before the cap existed".

ALTER TABLE stock_count_lines
    -- |variance| / system_qty * 100. NULL when system_qty is zero: a percentage needs a base, and
    -- the first count of an item legitimately has none. Recorded rather than recomputed on read so
    -- the number in the audit trail is the one the decision was actually made on.
    ADD COLUMN variance_pct NUMERIC(9, 2),
    -- The cap in force for this line AT POST TIME. Stored, not looked up later, because a category
    -- can be re-capped afterwards and an audit trail that silently re-answers "was this allowed?"
    -- against today's threshold is worse than none. NULL = no cap applied to this line.
    ADD COLUMN cap_pct NUMERIC(6, 2),
    -- Present exactly when the line exceeded its cap and was posted anyway. NULL means the line was
    -- within cap (or uncapped) — no reason was needed, so none is invented.
    ADD COLUMN override_reason VARCHAR(500);

COMMENT ON COLUMN stock_count_lines.variance_pct IS
    'Signed variance as a percentage of system qty at post time; NULL when system qty was zero (no base for a percentage).';
COMMENT ON COLUMN stock_count_lines.cap_pct IS
    'The category variance cap in force when this line posted (most-specific-wins up the tree); NULL when uncapped.';
COMMENT ON COLUMN stock_count_lines.override_reason IS
    'Why an over-cap variance was posted anyway. Non-null only for lines that exceeded cap_pct.';

-- Over-cap lines are the ones an auditor goes looking for, and they are a small minority of rows.
CREATE INDEX idx_stock_count_lines_overrides ON stock_count_lines (tenant_id, count_id)
    WHERE override_reason IS NOT NULL;
