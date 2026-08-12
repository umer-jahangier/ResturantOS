-- ============================================================================
-- F17 — a cook can clear a board carrying tickets from a business day that has closed
-- ============================================================================
-- WHY
-- Nothing ever aged a ticket off a KDS board. Measured live on 2026-08-12 as
-- kitchen@terrace.local, branch F-7 (Floating Terrace), station DEFAULT: 75 active
-- tickets on a board paginated 1/7, of which 10 were received on 2026-08-07 —
-- five days and 123h earlier — sitting in the READY/PENDING columns at the head of
-- the board. A ticket leaves the board today only when the POS closes, serves or
-- voids its order; an order that never closes leaves its ticket there forever.
--
-- A real kitchen hits this the first time a screen or a service dies mid-shift, and
-- there is no way back to a clean board the next morning.
--
-- WHAT THIS ADDS
-- Two columns recording that a ticket was taken off the board BY A PERSON, and when.
-- The row is never deleted: the ticket, its items, its order number and its original
-- receivedAt all survive, and TicketStatus.CLEARED is what keeps it off the active
-- board (which queries PENDING,COOKING,READY). The cleared list is readable back
-- through the same /kds/tickets endpoint with status=CLEARED.
--
-- cleared_by is the acting user's id from the verified JWT. It is a convenience for
-- the kitchen's own "cleared" list; the AUTHORITY on who cleared what is the
-- KDS_STALE_TICKETS_CLEARED audit event, which audit-service writes to its own
-- append-only table from the outbox.
--
-- THE INDEX
-- The stale scan is (branch_id [, station_code], received_at < cutoff). The existing
-- idx_kds_tickets_branch_station_status leads on status, which does not help a range
-- scan on received_at. This one does, and it also serves the branch-wide "all
-- stations" board.
--
-- IDEMPOTENT: IF NOT EXISTS on every statement.
-- RLS: no policy change. kds_tickets is already ENABLE + FORCE ROW LEVEL SECURITY
-- (V8) on app.current_tenant_id, and adding columns does not alter that.
-- ============================================================================

ALTER TABLE kds_tickets ADD COLUMN IF NOT EXISTS cleared_at TIMESTAMPTZ;
ALTER TABLE kds_tickets ADD COLUMN IF NOT EXISTS cleared_by UUID;

CREATE INDEX IF NOT EXISTS idx_kds_tickets_branch_received_at
    ON kds_tickets (branch_id, received_at);

-- ── Self-verification ────────────────────────────────────────────────────────
-- A migration that runs and does nothing is the shape this repository keeps finding.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'kds_tickets'
                     AND column_name = 'cleared_at') THEN
        RAISE EXCEPTION 'kds_tickets.cleared_at was not created';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'kds_tickets'
                     AND column_name = 'cleared_by') THEN
        RAISE EXCEPTION 'kds_tickets.cleared_by was not created';
    END IF;
END $$;
