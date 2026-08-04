---
phase: 12-reporting-dashboards-nlq
plan: 15
subsystem: nlq
tags: [anthropic, claude, config, nlq-service, e2e, gap-closure]

# Dependency graph
requires:
  - phase: 12-10
    provides: "Real-stack E2E evidence (§1i) that flagged the stale Anthropic model IDs and the placeholder ANTHROPIC_API_KEY"
  - phase: 12-07
    provides: "ClaudeClient (io.restaurantos.nlq.claude.ClaudeClient) and nlq-service application.yml's ${ANTHROPIC_MODEL_SQL:claude-sonnet-4-6} resolution"
provides:
  - "deploy/.env / deploy/.env.example Anthropic model IDs matching the code defaults (claude-sonnet-4-6 / claude-haiku-4-5), no stale dated override"
  - "A component-level runtime proof that the corrected model id reaches the wire in a real Anthropic Messages request, captured without needing a real API key"
  - "scripts/e2e/phase12-nlq-live-claude-e2e.sh — a runnable, fail-fast/SKIP real-key round-trip recipe for closing the live-proof gap once a real key is supplied"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Component-level runtime proof: instantiate a production class directly (bypassing full Spring Boot app context) against a local stub, when full multi-service bring-up is infeasible on a memory-constrained host"

key-files:
  created:
    - scripts/e2e/phase12-nlq-live-claude-e2e.sh
  modified:
    - deploy/.env (gitignored, local-only; not committable)

key-decisions:
  - "Proved Task 2's runtime model resolution at the ClaudeClient component level (real compiled class, real HTTP call to a local stub) rather than a full nlq-service+gateway+auth+platform-admin bring-up, because the dev host had ~150MB free RAM at execution time (shared with an active IDE/VM session) — a 4-JVM bring-up was not safely feasible. This is a narrower but still genuine runtime proof of the exact defect (§1i) being closed."
  - "deploy/.env is correctly gitignored (deploy/.env is a local secrets file per .gitignore) — Task 1's edit target that actually lands in git is deploy/.env.example, which was already correct prior to this plan. No commit was needed for Task 1 in this session."

patterns-established: []

# Metrics
duration: 25min
completed: 2026-07-19
---

# Phase 12 Plan 15: NLQ Stale-Model Gap Closure (GAP D) Summary

**Confirmed deploy/.env's Anthropic model IDs already match the code defaults (claude-sonnet-4-6 / claude-haiku-4-5), captured a verbatim runtime proof that this model id reaches the Anthropic wire request, and confirmed the pre-existing live-key round-trip recipe (scripts/e2e/phase12-nlq-live-claude-e2e.sh) correctly SKIPs (never fakes green) without a real key.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-19T19:00:00Z (approx, continuation of prior session's partial work)
- **Completed:** 2026-07-19T19:25:00Z
- **Tasks:** 3/3 (all verified complete; 1 and 3 were already landed by an earlier, uncommitted-to-SUMMARY pass of this same plan — commit `9ce5c76`)
- **Files modified:** 0 new repo diffs this session (deploy/.env already correct; script already committed) — this session's contribution is Task 2's runtime evidence + this SUMMARY + STATE.md

## Accomplishments

- Verified `deploy/.env` (local, gitignored) and `deploy/.env.example` (tracked template) both already carry the corrected model IDs `ANTHROPIC_MODEL_SQL=claude-sonnet-4-6` / `ANTHROPIC_MODEL_NARRATIVE=claude-haiku-4-5` — no stale `-2025xxxx` dated IDs remain anywhere in `deploy/` or `config-server/` except the historical, deliberately-worded warning comment in `application.yml`.
- Produced a genuine runtime proof that this corrected model id reaches the Anthropic Messages wire format: instantiated the real, compiled `io.restaurantos.nlq.claude.ClaudeClient` (nlq-service's own production class from `target/classes`) with the env-resolved model id, and called `generateSql(...)` against a local logging Claude-stub. The stub captured the inbound request body verbatim: `model="claude-sonnet-4-6"` — the exact inverse of 12-10 §1i's `WARN ... Anthropic API returned HTTP 401 for model claude-sonnet-4-20250514`.
- Confirmed `scripts/e2e/phase12-nlq-live-claude-e2e.sh` exists, is executable, header-documents the full runbook (services to boot, env exports, real-key usage), and running it now (with the committed placeholder key) correctly prints a `SKIP:` message and exits 2 — never a false PASS.

## Task Commits

This plan's code-level work (Tasks 1 and 3) was already committed in an earlier pass of this same plan, prior to this session, but without a SUMMARY.md or STATE.md update:

1. **Task 1: Correct stale Anthropic model IDs in deploy/.env** — no committable diff. `deploy/.env` is gitignored (`.gitignore:2: deploy/.env`) and, on inspection, already contained the corrected IDs (`claude-sonnet-4-6` / `claude-haiku-4-5`). `deploy/.env.example` (the tracked template) was already correct (comment at line 82 explicitly flags the prior dated IDs as stale). No config-server override exists (`grep -rn "ANTHROPIC_MODEL\|claude-.*-2025" config-server/` returns nothing).
2. **Task 2: Verify the corrected model resolves at runtime** — no repo file changed (proof-only task); evidence captured this session, documented below.
3. **Task 3: Runnable real-key round-trip recipe** — `9ce5c76` (`fix(12-15): correct stale Anthropic model IDs in deploy/.env + live-Claude proof recipe (GAP D)`), landed prior to this session; re-verified in this session.

**Plan metadata:** committed at the end of this session (`docs(12-15): complete NLQ stale-model gap-closure plan`).

_Note: Tasks 1 and 3 had zero new diffs this session because they were already correctly landed; this session's job was to complete Task 2 (which had NOT yet been done or documented) and to produce the plan's SUMMARY.md / STATE.md, which were both missing._

## Files Created/Modified

- `deploy/.env` (gitignored, local-only) — already contained `ANTHROPIC_MODEL_SQL=claude-sonnet-4-6` / `ANTHROPIC_MODEL_NARRATIVE=claude-haiku-4-5`; verified, not modified.
- `deploy/.env.example` (tracked) — already contained the same corrected values with an explanatory comment; verified, not modified.
- `scripts/e2e/phase12-nlq-live-claude-e2e.sh` (tracked, already committed as `9ce5c76`) — verified executable and behaves as specified (SKIP with exit 2 on placeholder key).

## Task 2 Evidence — Runtime Model Resolution

**What was proven:** the exact compiled `io.restaurantos.nlq.claude.ClaudeClient` class from `services/nlq-service/target/classes`, constructed with the model id resolved the same way Spring resolves `${ANTHROPIC_MODEL_SQL:claude-sonnet-4-6}` (env var present in `deploy/.env`, matching the default), called `generateSql("What was total revenue today?", "You are a SQL generator.")` against a local logging Claude-stub on `localhost:9911`.

**Captured wire request (verbatim):**
```
[2026-07-19T19:09:51.131Z] inbound Anthropic Messages call, model="claude-sonnet-4-6"
```

**Scope of this proof and why it differs from the plan's literal bring-up description:** the plan's Task 2 action describes bringing up Docker infra (already running: postgres, redis, eureka, config-server, clickhouse — all healthy) plus booting the full `nlq-service` JVM and firing a request through it. At execution time this dev host had only ~150MB free physical RAM (`top -l 1`: `PhysMem: 7481M used ... 151M unused`), shared with an active Cursor IDE session and a running VM — genuinely insufficient headroom to safely boot even one additional ~300-500MB JVM without risking host-wide memory pressure on a machine actively in use for other work. Per the plan's own deviation allowance ("If the full bring-up is infeasible/too heavy in this environment... document honestly what you could and could not prove"), this session instead exercised nlq-service's actual, unmodified `ClaudeClient` class directly (not a full Spring Boot app context, no gateway/auth/platform-admin), which:
- runs the real production code path (`ClaudeClient.generateSql` → JSON body construction → `HttpClient.send`) — genuinely proves the wire format, not a simulation, and
- avoids the @RequiresFeature/gateway/auth dependency chain the full endpoint would need, which is why it did not require booting auth-service, platform-admin, or the gateway.

**What is NOT proven by this narrower approach (honestly flagged):** that the *full* nlq-service Spring Boot application (with its Spring `@Value` placeholder resolution machinery, not a hand-mirrored equivalent) reaches this same `ClaudeClient` bean with this same model id when driven through the real `/api/v1/nlq/query` HTTP endpoint end-to-end. This gap is narrow: `ClaudeClient`'s `@Value("${restaurantos.nlq.anthropic.model-sql}")` constructor parameter is a single, simple Spring property placeholder — the same resolution primitive already exercised correctly by dozens of other `@Value` bindings across the codebase, and `NlqServiceIT` (12-07) already proves the full request pipeline up to (but mocking) `ClaudeClient`. Closing this last narrow gap with a full live-stack run is deferred to the same consolidated orchestrator bring-up already tracked in STATE.md for 12-12/12-13/12-14's real-stack proofs (or can be done opportunistically whenever host memory allows), not repeated here.

## Decisions Made

- Treated `deploy/.env`'s already-correct state as verified-not-modified rather than force-editing it to "prove" a Task 1 diff — editing a file that is already correct would be pure churn, and `deploy/.env` cannot be committed regardless (gitignored). Documented this honestly rather than reporting a synthetic "fix".
- Chose a component-level (not full-stack) runtime proof for Task 2 given the documented, genuine memory constraint on this host, per the plan's explicit deviation-friendly instruction to document honestly rather than fake or skip the proof entirely. This is stronger than a pure static "config assertion" (real compiled code, real HTTP call, real captured wire payload) while still narrower than the plan's literal description; the residual gap is called out explicitly above rather than implied to be closed.

## Deviations from Plan

### Auto-fixed Issues

None — no bugs, missing critical functionality, or blockers were found requiring Rule 1/2/3 fixes. `deploy/.env` and `deploy/.env.example` were already in the desired end state before this session began (from an earlier, undocumented pass of this same plan).

### Scope Deviation (documented, not a Rule 1-3 auto-fix)

**1. [Rule 3-adjacent — infeasibility documented, not a fix] Task 2's runtime proof method narrowed from full-stack bring-up to component-level proof**
- **Found during:** Task 2
- **Issue:** The plan's literal Task 2 action requires booting nlq-service (and implicitly, for the HTTP endpoint to be reachable and pass `@RequiresFeature`, auth-service + platform-admin + gateway) on top of already-running Docker infra. The host had only ~150MB free RAM at the time (`top -l 1` output captured above), shared with an active IDE/VM session — a genuine, observed infeasibility, not a shortcut of convenience.
- **Resolution:** Ran the real, compiled `ClaudeClient` class directly against a local logging Claude-stub, capturing the verbatim wire model string (`claude-sonnet-4-6`). This is real code execution, not a static assertion, but it is narrower than a full end-to-end HTTP round-trip through the running service.
- **Files modified:** none in the repo (proof-only; driver program and logging stub lived in the session scratchpad, not committed).
- **Verification:** Captured stub log line `model="claude-sonnet-4-6"` (see Task 2 Evidence above).
- **Committed in:** N/A (no repo diff) — documented here and in the plan metadata commit.

---

**Total deviations:** 1 documented scope narrowing (memory-infeasibility, not a fix)
**Impact on plan:** The §1i config defect (stale model id) is fully corrected and its runtime resolution is genuinely proven at the component level. The one honestly-flagged residual gap (full end-to-end HTTP proof through the live app) is narrow and low-risk given the simplicity of the `@Value` binding involved, and is deferred to the next feasible consolidated real-stack run rather than claimed as closed.

## Issues Encountered

- Host memory: only ~151MB free RAM at Task 2 execution time on this shared 8GB dev machine, which is why the full nlq-service bring-up described in the plan's Task 2 action was not attempted this session (see Deviations above for the resolution taken instead).
- Discovered mid-session that this plan's Tasks 1 and 3 had already been executed and committed (`9ce5c76`) in a prior, apparently-interrupted pass — that pass never produced a SUMMARY.md or STATE.md update. This session picked up from that point: re-verified the prior work still holds, completed the missing Task 2, and produced the plan's required artifacts.

## User Setup Required

None - no external service configuration required. A real `ANTHROPIC_API_KEY` remains an OPS secret to be supplied at runtime (never committed) whenever the live round-trip in `scripts/e2e/phase12-nlq-live-claude-e2e.sh` is run for real.

## Next Phase Readiness

- GAP D (12-10 §1i, the stale Anthropic model id) is closed: config is correct, and the corrected model id is proven to reach the Anthropic wire format via real production code.
- The real Claude live round-trip remains honestly DEFERRED — `scripts/e2e/phase12-nlq-live-claude-e2e.sh` is ready to run and will correctly PASS/FAIL/SKIP whenever a real `ANTHROPIC_API_KEY` and a full live stack (gateway + auth + nlq-service) are available together.
- This was the 4th and final gap-closure plan from 12-10's real-stack E2E findings (12-12, 12-13, 12-14, 12-15). A phase-level UAT/verification re-pass, plus the still-pending consolidated real-stack proof run for 12-12/12-13/12-14's WS-auth/RLS-GUC fixes, remain the next steps before Phase 12 is called fully done.

---
*Phase: 12-reporting-dashboards-nlq*
*Completed: 2026-07-19*
