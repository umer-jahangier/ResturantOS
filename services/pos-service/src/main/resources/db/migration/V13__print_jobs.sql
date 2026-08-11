-- ============================================================================
-- 26-03 — print_jobs: one durable row per document this product ever issues
-- ============================================================================
-- WHY
-- `.planning/research/gap-audit/DEFECT-REGISTER.md` GA-012 records it plainly: no
-- printed receipt exists anywhere in the product. `grep -rn "[Rr]eceipt"
-- services/pos-service/src/main/java` returned zero hits before this migration.
--
-- This table is deliberately load-bearing beyond plan 26-03. It is the reprint
-- history (26-08), the kitchen ticket queue (26-07) and the print agent's work
-- list (26-11). One table, one truth about what was printed.
--
-- ══ Why the RENDERED DOCUMENT is stored on the row ══
--
-- `document` holds the serialised PrintDocument, not a pointer to one. A reprint
-- re-serves these bytes verbatim; it does NOT re-run the assembler. Re-assembling
-- would let a later price edit, a refund, or a menu-item rename silently change a
-- document the customer is already holding — and would make "the reprint is
-- identical to the original" a hope about two runs of an assembler agreeing rather
-- than a fact about the same bytes.
--
-- ══ Why target_printer_id is IN the sequence key ══
--
-- A customer receipt has one target, so its sequence IS the reprint count, which is
-- what 26-08 asserts on. A kitchen fire writes ONE ROW PER STATION — all for the
-- same order and the same document type — so a unique index scoped only to
-- (tenant, order, type, seq) would make a two-station fire collide with itself on
-- the very first fire. The target is in the key, and sequence allocation is scoped
-- to the same four columns.
--
-- ══ Why there is a SECOND unique index on revision_no ══
--
-- 26-07 dispatches the kitchen ticket AFTER the fire transaction commits (a
-- TransactionSynchronization, deliberately not REQUIRES_NEW — see that plan), so it
-- can no longer inherit the fire's own idempotency guard. (tenant, order, type,
-- target, revision) is the key that stops a retried dispatch printing the same
-- ticket twice. A customer receipt carries a NULL revision and is excluded by the
-- partial predicate rather than colliding with every other receipt.
--
-- ══ RLS ══
--
-- ENABLE **and** FORCE, in this migration, not in a follow-up. pos-service connects
-- as the role that OWNS these tables, and PostgreSQL exempts an owner from its own
-- policies unless FORCE is set — that is exactly the defect 17b closed across 16
-- tables (see V11__force_rls_all_tenant_tables.sql). V11 enumerates a fixed table
-- list and is not re-run, so **V13 is self-forcing**, and
-- `RlsForcedInvariantIT.everyRlsEnabledTableIsForced` is what keeps the invariant
-- true for every table added after this one.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS or guarded by a catalog check.
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_jobs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID         NOT NULL,
    branch_id           UUID         NOT NULL,
    -- NULL means "the branch default printer for this role" (D-26-05).
    terminal_id         UUID,
    order_id            UUID         NOT NULL,
    -- Mirrors PrintDocument.DocumentType. Not an FK to anything: the document schema
    -- lives in shared-lib, and a CHECK here would need a migration every time it grows.
    document_type       VARCHAR(30)  NOT NULL
        CHECK (document_type IN ('CUSTOMER_RECEIPT', 'KITCHEN_TICKET')),
    -- The PrinterEntry.id from the branch's receipt_config. A branch with no printer
    -- configured still issues documents, against the reserved sentinel below, because
    -- a tenant with no thermal hardware must still be able to hand a customer a bill
    -- (D-26-01, definition-of-done item 6).
    target_printer_id   VARCHAR(64)  NOT NULL DEFAULT 'unassigned',
    issue_seq           INT          NOT NULL,
    -- NULL for a customer receipt; the order-item revision for a kitchen ticket.
    revision_no         INT,
    status              VARCHAR(20)  NOT NULL
        CHECK (status IN ('ISSUED', 'QUEUED', 'CLAIMED', 'PRINTED', 'FAILED', 'DEAD_LETTERED')),
    attempts            INT          NOT NULL DEFAULT 0,
    last_error          TEXT,
    -- The serialised PrintDocument. The whole point of the table.
    document            JSONB        NOT NULL,
    issued_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    -- Set on a reprint to the FIRST issue's timestamp, so the paper can say what it is
    -- a reprint of. PrintDocument.Issue refuses to construct a reprint without it.
    original_issued_at  TIMESTAMPTZ,
    -- Client-supplied replay guard on the issuance POST. Issuing allocates a sequence
    -- and writes a row, so a retried request must not inflate the reprint count.
    idempotency_key     VARCHAR(120),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_by          UUID,
    updated_by          UUID,
    deleted_at          TIMESTAMPTZ
);

-- ── RLS: enabled AND forced, here, in the same migration ─────────────────────
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'print_jobs'
                     AND policyname = 'tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON print_jobs
            USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
    END IF;
END $$;

-- FORCE only AFTER the policy exists: forcing a policy-less table denies the owner
-- everything, which is an outage rather than an isolation.
ALTER TABLE print_jobs FORCE ROW LEVEL SECURITY;

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- The sequence key. Two concurrent issues cannot allocate the same number; the
-- pessimistic lock in PrintJobServiceImpl is the fast path and this is the backstop.
CREATE UNIQUE INDEX IF NOT EXISTS uq_print_jobs_sequence
    ON print_jobs (tenant_id, order_id, document_type, target_printer_id, issue_seq);

-- 26-07's after-commit dispatch idempotency key. PARTIAL: receipts carry a null
-- revision and must not collide with one another.
CREATE UNIQUE INDEX IF NOT EXISTS uq_print_jobs_revision
    ON print_jobs (tenant_id, order_id, document_type, target_printer_id, revision_no)
    WHERE revision_no IS NOT NULL;

-- The issuance replay guard. PARTIAL: most rows carry no key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_print_jobs_idempotency
    ON print_jobs (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- The query the print agent's work list walks (26-11).
CREATE INDEX IF NOT EXISTS idx_print_jobs_agent_work
    ON print_jobs (tenant_id, branch_id, status, created_at);

-- The reprint history for one order (26-08).
CREATE INDEX IF NOT EXISTS idx_print_jobs_order
    ON print_jobs (tenant_id, order_id, document_type, issue_seq);

-- ── Self-verification ────────────────────────────────────────────────────────
-- Same shape as V11's: a partially-applied RLS rollout is a live cross-tenant leak,
-- so this migration must not be able to report success while one is open.
DO $$
DECLARE
    unforced text;
BEGIN
    SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO unforced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity;

    IF unforced IS NOT NULL THEN
        RAISE EXCEPTION 'RLS enabled but NOT forced on: % — cross-tenant leak remains open', unforced;
    END IF;
END $$;
