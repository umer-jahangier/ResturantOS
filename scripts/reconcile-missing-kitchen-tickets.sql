-- ============================================================================
-- Fires that produced no kitchen ticket  (plan 26-07)
-- ============================================================================
-- WHY THIS EXISTS
--
-- The kitchen ticket is enqueued by an AFTER-COMMIT transaction synchronisation
-- registered inside OrderServiceImpl.sendToKds. That boundary is deliberate and
-- it is argued at length in PrintDispatchService's class comment: it is the only
-- shape in which a print failure cannot fail a fire, and in which a fire that
-- rolled back cannot leave a phantom ticket the kitchen cooks.
--
-- It has exactly one cost, and this file is that cost's mitigation. If the JVM
-- dies in the window between the fire's COMMIT and the dispatch transaction, the
-- ticket is lost WITH NO ROW TO SHOW FOR IT. The kitchen display is unaffected —
-- it is event-driven, independent, and remains the source of truth — so the food
-- still gets cooked. But the paper is silently absent, and silence is precisely
-- the failure mode phase 26 exists to eliminate.
--
-- So: do not hope. Query.
--
-- WHAT IT DOES NOT LOOK AT
--
-- Routing. A station with items and no printer configured DOES write a row —
-- status FAILED, last_error prefixed 'UNROUTABLE: ' and naming the station. So
-- "no row at all" means dispatch never ran, which is the only thing this is for.
-- To find unrouted stations instead, see the second query at the bottom.
--
-- USAGE
--   psql "$POS_DB_URL" -v tenant="'<tenant-uuid>'" -v from="'2026-08-11'" \
--        -v to="'2026-08-12'" -f scripts/reconcile-missing-kitchen-tickets.sql
--
-- The same statement is exercised by PrintJobRepository.findFiresWithNoTicket and
-- by PrintDispatchIT, which drives it by killing dispatch between commit and
-- enqueue and asserting the missing fire comes back — and that nothing comes back
-- when dispatch worked. A reconciliation query nobody has seen return a row is a
-- reconciliation query nobody knows works.
-- ============================================================================

-- ── 1. Fires with no ticket at all ──────────────────────────────────────────
SELECT DISTINCT
    o.order_no,
    oi.order_id,
    oi.revision_no,
    o.sent_to_kds_at
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE o.tenant_id = :tenant::uuid
  AND o.sent_to_kds_at >= :from::timestamptz
  AND o.sent_to_kds_at <  :to::timestamptz
  AND oi.revision_no > 0
  AND oi.kds_status <> 'CANCELLED'
  AND NOT EXISTS (
      SELECT 1
      FROM print_jobs p
      WHERE p.tenant_id     = o.tenant_id
        AND p.order_id      = oi.order_id
        AND p.document_type = 'KITCHEN_TICKET'
        AND p.revision_no   = oi.revision_no)
ORDER BY o.sent_to_kds_at, oi.revision_no;

-- ── 2. Tickets that had nowhere to go ───────────────────────────────────────
-- A different problem with a different fix: this one is a manager configuring a
-- printer, not an operator replaying a lost job.
SELECT
    p.order_id,
    p.revision_no,
    p.last_error,
    p.created_at
FROM print_jobs p
WHERE p.tenant_id = :tenant::uuid
  AND p.document_type = 'KITCHEN_TICKET'
  AND p.status = 'FAILED'
  AND p.last_error LIKE 'UNROUTABLE:%'
  AND p.created_at >= :from::timestamptz
  AND p.created_at <  :to::timestamptz
ORDER BY p.created_at;
