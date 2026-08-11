-- ============================================================================
-- 26-11 — the lease that stops a dead agent stranding a ticket
-- ============================================================================
-- WHY
--
-- 26-03 gave print_jobs a status lifecycle and an attempt count. What it did not
-- give it was an answer to "an agent claimed this job and then the till lost
-- power". Without a lease that ticket sits in CLAIMED forever: the kitchen never
-- gets its paper, no error is raised anywhere, and the only symptom is a chef
-- waiting. That is the exact failure shape this phase exists to eliminate.
--
-- So a claim now takes a LEASE, and a lease expires. A sweep returns expired
-- claims to the queue with their attempt count incremented, which both retries the
-- work and makes a permanently failing job eventually dead-letter instead of
-- looping forever.
--
-- ══ Why claimed_by_agent_id is recorded ══
--
-- Two agents can legitimately serve one branch (a till and a spare). The ack must
-- therefore be able to say "this job, claimed by ME, still leased to ME" — because
-- if the lease already expired and the sweep handed the job to the other agent, the
-- late acknowledgement must be a NO-OP rather than marking as printed a job the
-- other agent is currently printing. The server's reclaim is authoritative; see
-- PrintJobClaimService for the residual window this leaves and its size.
--
-- ══ Why next_attempt_at exists ══
--
-- Backoff. Without it, a job that fails because a printer is off retries as fast as
-- the poll loop runs, which is a denial-of-service against a device that is already
-- unhappy. The agent's own queue (26-06) already backs off with jitter; this is the
-- server-side half so the two halves cannot disagree about when to try again.
--
-- No RLS statements here: print_jobs is already ENABLE + FORCE from V13, and
-- ALTER TABLE ... ADD COLUMN does not disturb that.
--
-- IDEMPOTENT: every statement is IF NOT EXISTS.
-- ============================================================================

ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS claimed_by_agent_id UUID;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS lease_expires_at    TIMESTAMPTZ;
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS next_attempt_at     TIMESTAMPTZ;

-- The claim query's index: one branch's queued work, oldest first, respecting
-- backoff. idx_print_jobs_agent_work (V13) covers (tenant, branch, status,
-- created_at) but not next_attempt_at, so a branch with one permanently failing
-- job would re-read it on every poll.
CREATE INDEX IF NOT EXISTS idx_print_jobs_claimable
    ON print_jobs (tenant_id, branch_id, status, next_attempt_at, created_at);

-- The sweep's index: expired leases across all tenants. Partial, because the vast
-- majority of rows are not CLAIMED and the sweep runs on a timer.
CREATE INDEX IF NOT EXISTS idx_print_jobs_expired_leases
    ON print_jobs (lease_expires_at)
    WHERE status = 'CLAIMED';
