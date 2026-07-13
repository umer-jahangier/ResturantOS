-- Adds revision tracking to kds_ticket_items so a second ORDER_SENT_TO_KDS fire for an
-- order already ticketed at a station APPENDS items (POS-12/KDS-03) instead of being
-- silently skipped. Additive only: no DROP/RENAME of existing columns.
-- Migrates legacy COOKING rows to PREPARING (TicketItemStatus enum now also carries
-- ACCEPTED/PREPARING as the target kitchen-owned lifecycle subset PENDING -> ACCEPTED ->
-- PREPARING -> READY; COOKING is retained in the Java enum so this is idempotent and safe
-- for deserialization — the existing bump flow (PENDING -> COOKING -> READY) is unchanged
-- by this plan and stays wired to COOKING; full lifecycle rewiring is a later plan).

ALTER TABLE kds_ticket_items ADD COLUMN revision_no INT NOT NULL DEFAULT 1;
ALTER TABLE kds_ticket_items ADD COLUMN fired_at TIMESTAMPTZ;

UPDATE kds_ticket_items SET status = 'PREPARING' WHERE status = 'COOKING';

CREATE INDEX idx_kds_ticket_items_revision ON kds_ticket_items (ticket_id, revision_no);
