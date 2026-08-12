-- ============================================================================
-- S8 — the print queues an agent can actually see on the machine it runs on
-- ============================================================================
-- ══ WHAT WAS WRONG ══
--
-- `PrinterEntry.transport = 'SYSTEM'` has been able to describe a USB till printer
-- since 26-02, and `system-printer.ts` hands `systemPrinterName` straight to
-- `lp -d <name> -o raw`. The one thing nobody could do was find out what to put in
-- that field: /app/settings/printers offered a free-text box with somebody else's
-- printer model as its placeholder.
--
-- A typo there is not an error anybody sees. The save succeeds, the registry rides
-- down to the agent on its next poll, the job is enqueued, and `lp` fails at the
-- spooler minutes later with nobody watching. "Configured in the product, inert in
-- reality" is this codebase's signature defect and this was a live instance of it.
--
-- ══ WHAT THIS ADDS ══
--
-- The agent already talks to the server every three seconds. It now says what print
-- queues the machine has, and those land here so the settings screen can offer them
-- as a LIST. Three columns, because three different facts:
--
--   devices              — the queues themselves. JSONB, an ARRAY of
--                          {name, description, state, isDefault}.
--   devices_unavailable  — why there is no list, when there is none. A Windows host
--                          (this agent cannot raw-print there), or no CUPS on PATH.
--                          NEVER set at the same time as a non-empty `devices`.
--   devices_reported_at  — when the agent last said. Without it, an empty list from
--                          an agent that has never reported looks exactly like an
--                          empty list from a machine with no printers attached, and
--                          the screen would have to guess which sentence to show.
--
-- ══ WHY NOT A TABLE OF ITS OWN ══
--
-- A device list has no life independent of the agent that saw it: it is not
-- referenced by anything, it is replaced wholesale on every poll, and it dies with
-- the agent row. A child table would add a delete cascade, a second RLS policy and
-- a join for a value that is written every three seconds and read on one screen.
--
-- ══ WHY IT IS SAFE TO RENDER ══
--
-- Queue names and CUPS descriptions. No credential, no hash, no lookup id — those
-- live in columns this migration does not touch and no read returns. The agent
-- caps the list at 50 entries and each name at 128 characters before it is sent,
-- and `PrintAgentEnrolmentService` caps them AGAIN on arrival, because a cap
-- enforced only by the client is not a cap.
--
-- ══ ROW LEVEL SECURITY ══
--
-- Untouched and already correct: `print_agents` was ENABLEd, given its
-- `tenant_isolation` policy and FORCEd in V17, in that order, in one migration.
-- Adding columns does not change a policy. `RlsForcedInvariantIT` still guards it,
-- and the self-check at the foot of this file re-asserts it anyway.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS.
-- ============================================================================

ALTER TABLE print_agents ADD COLUMN IF NOT EXISTS devices JSONB;
ALTER TABLE print_agents ADD COLUMN IF NOT EXISTS devices_unavailable TEXT;
ALTER TABLE print_agents ADD COLUMN IF NOT EXISTS devices_reported_at TIMESTAMPTZ;

COMMENT ON COLUMN print_agents.devices IS
    'S8: the print queues the agent last enumerated on its own machine, as a JSON array of '
    '{name, description, state, isDefault}. NULL means the agent has never reported.';
COMMENT ON COLUMN print_agents.devices_unavailable IS
    'S8: why no list could be produced, when none could. Never set alongside a non-empty devices.';
COMMENT ON COLUMN print_agents.devices_reported_at IS
    'S8: when the agent last reported its devices. Distinguishes "no printers attached" from '
    '"this agent has never said".';

-- ── Self-verification ────────────────────────────────────────────────────────
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
