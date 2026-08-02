-- ============================================================
-- Reconciliation: events that were consumed but never posted.
--
-- Between the Phase 9 merge and the integration fixes, three finance consumers read payload fields
-- their producers had never published:
--
--   * COUNT_VARIANCE_POSTED  — read `lines[].variancePaisa`, published as `varianceCostPaisa`
--   * TRANSFER_SHIPPED       — read `lines[].costPaisa`, published as `unitCostPaisa` (no total)
--   * TRANSFER_RECEIVED      — same
--
-- A missing key read as 0, the recipe's zero-guard returned early, and the message was ACKed and
-- written to `processed_events`. So these events are unpostable by replay: the idempotency guard
-- will skip every one of them forever. They have to be posted by hand.
--
-- ORDER_CLOSED events lost to the over-tender retry loop are a separate case — those were never
-- acked, so they have no processed_events row and appear in section 4.
--
-- Run each section against the named database. Nothing here writes; it only reports.
-- ============================================================

-- ── (1) inventory_db: what SHOULD have posted ───────────────────────────────
-- Every stock count and transfer whose event was emitted, with the value that belonged in the GL.
\c inventory_db

SELECT 'COUNT_VARIANCE' AS source_type,
       sc.id            AS source_id,
       sc.tenant_id,
       sc.branch_id,
       sc.posted_at     AS occurred_at,
       COALESCE(SUM(scl.variance_cost_paisa), 0) AS amount_paisa
  FROM stock_counts sc
  JOIN stock_count_lines scl ON scl.count_id = sc.id
 WHERE sc.status = 'POSTED'
 GROUP BY sc.id, sc.tenant_id, sc.branch_id, sc.posted_at
HAVING COALESCE(SUM(scl.variance_cost_paisa), 0) <> 0

UNION ALL

SELECT 'TRANSFER_SHIP',
       st.id,
       st.tenant_id,
       st.from_branch_id,
       st.shipped_at,
       COALESCE(SUM(ROUND(stl.qty_shipped * stl.unit_cost_paisa)), 0)
  FROM stock_transfers st
  JOIN stock_transfer_lines stl ON stl.transfer_id = st.id
 WHERE st.shipped_at IS NOT NULL
 GROUP BY st.id, st.tenant_id, st.from_branch_id, st.shipped_at

UNION ALL

SELECT 'TRANSFER_RECV',
       st.id,
       st.tenant_id,
       st.to_branch_id,
       st.received_at,
       COALESCE(SUM(ROUND(COALESCE(stl.qty_received, 0) * stl.unit_cost_paisa)), 0)
  FROM stock_transfers st
  JOIN stock_transfer_lines stl ON stl.transfer_id = st.id
 WHERE st.received_at IS NOT NULL
 GROUP BY st.id, st.tenant_id, st.to_branch_id, st.received_at

 ORDER BY occurred_at;

-- ── (2) finance_db: what DID post ───────────────────────────────────────────
-- Diff against (1). Any source_id in (1) and not here needs a manual entry.
\c finance_db

SELECT source_type, source_id, tenant_id, posted_at
  FROM posted_source_events
 WHERE source_type IN ('COUNT_VARIANCE', 'TRANSFER_SHIP', 'TRANSFER_RECV')
 ORDER BY posted_at;

-- ── (3) finance_db: the consumers that acked without posting ────────────────
-- A consumer row here with no matching posted_source_events row is a silently-dropped event. This
-- is the count of what section (1) minus section (2) will contain.
SELECT pe.consumer, COUNT(*) AS events_acked
  FROM processed_events pe
 WHERE pe.consumer IN ('finance.count-variance', 'finance.transfer-shipped', 'finance.transfer-received')
 GROUP BY pe.consumer;

-- ── (4) pos_db: orders closed with no revenue entry ─────────────────────────
-- The over-tender casualties. `tendered > applied` identifies rows written before the payment cap;
-- cross-reference source_id against finance_db.posted_source_events WHERE source_type='ORDER_REVENUE'.
\c pos_db

SELECT o.id AS order_id,
       o.tenant_id,
       o.branch_id,
       o.closed_at,
       o.total_paisa,
       SUM(op.amount_paisa)   AS applied_paisa,
       SUM(op.tendered_paisa) AS tendered_paisa
  FROM orders o
  JOIN order_payments op ON op.order_id = o.id
 WHERE o.status = 'CLOSED'
 GROUP BY o.id, o.tenant_id, o.branch_id, o.closed_at, o.total_paisa
HAVING SUM(op.amount_paisa) <> o.total_paisa
 ORDER BY o.closed_at;

-- ── Posting the catch-up entries ────────────────────────────────────────────
-- For each row that needs one, POST /internal/finance/journal-entries with the sourceType and
-- sourceId from section (1). autoPostInternal dedupes on (tenantId, sourceType, sourceId), so
-- running the catch-up twice is safe — the second call returns the existing entry.
--
-- Accounts, matching the corrected recipes:
--   COUNT_VARIANCE loss : DR 5231 Inventory Count Loss  / CR 1300 Inventory
--   COUNT_VARIANCE gain : DR 1300 Inventory             / CR 5230 Inventory Count Gain
--   TRANSFER_SHIP       : DR 1320 Goods in Transit      / CR 1300 Inventory
--   TRANSFER_RECV       : DR 1300 Inventory             / CR 1320 Goods in Transit
