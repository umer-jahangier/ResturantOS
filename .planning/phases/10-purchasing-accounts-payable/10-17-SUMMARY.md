---
phase: 10-purchasing-accounts-payable
plan: 17
subsystem: docs
tags: [requirements, roadmap, scope-decision, accounts-receivable, finance]

# Dependency graph
requires:
  - phase: 10-purchasing-accounts-payable
    provides: FIN-05 AP half (10-02 AP aging, 10-05 OPA-limited expense approval), and the 2026-07-13 UAT/audit that reopened the phase (10-06-A)
provides:
  - A dated, explicit resolution of the FIN-05 AP/AR ambiguity — AR is IN scope, not descoped
  - FIN-05 flipped from false-green Complete back to In Progress in REQUIREMENTS.md
  - Phase 10 SC#4 restated falsifiably (AP + AR, balanced JE against account 1200, named internal seam)
  - A named Phase 10 / Phase 7 split: Phase 10 (10-18) owns the AR ledger + internal seam, Phase 7 (07-05) owns the POS "charge to account" tender
  - Phase 7 roadmap entry (07-05 plan + 7th success criterion) so the seam has a consumer and cannot go unclaimed
affects: [10-18-PLAN.md, 07-05 (future Phase 7 plan), phase-10-completion, phase-7-planning]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md

key-decisions:
  - "10-17-A: FIN-05 AR is IN scope (not descoped). Receivables are sourced from corporate/house accounts. Phase 10 (10-18) builds the AR sub-ledger + the internal charge seam; Phase 7 (07-05) wires the POS charge-to-account tender to it. AR is not OPA-gated — a credit limit is a domain invariant, not an approval workflow."

patterns-established: []

# Metrics
duration: 8min
completed: 2026-07-13
---

# Phase 10 Plan 17: FIN-05 AR Scope Decision Record Summary

**Recorded and propagated decision 10-17-A: AR is IN scope for FIN-05 (sourced from corporate/house accounts), split across Phase 10 (ledger + internal seam, plan 10-18) and Phase 7 (POS tender, plan 07-05), with FIN-05 flipped from false-green Complete back to In Progress.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-13 (session start)
- **Completed:** 2026-07-13
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- FIN-05 checklist item in REQUIREMENTS.md unchecked and restated with the full dated decision (AR in scope, corporate/house account source, 10-18 + Phase 7 split, AP half already shipped)
- FIN-05 traceability row changed from `Complete` to `In Progress`, citing both owning phases
- Phase 10 SC#4 in ROADMAP.md restated as a falsifiable criterion naming account 1200 and `POST /internal/finance/ar/charges` explicitly
- Phase 10 gained a **Scope decisions** note under its Status line so future verifiers don't re-derive the resolution
- Phase 10 plan list corrected: 10-17 relabeled as the decision-record plan (not the original checkpoint description), 10-18 appended at wave 5, plan count 17→18
- Phase 7 gained a new `07-05` follow-up plan line naming the internal seam verbatim, plus a 7th success criterion, plan count 4→5

## Task Commits

Each task was committed atomically:

1. **Task 1: Record the decision in REQUIREMENTS.md (FIN-05)** - `84b38da` (docs)
2. **Task 2: Propagate to ROADMAP.md — Phase 10 SC#4, plan list, and the Phase 7 follow-up** - `95e69ce` (docs)

_No plan-metadata commit was needed beyond these two — both are already scoped to `.planning/` docs per the plan's `files_modified` list._

## Files Created/Modified
- `.planning/REQUIREMENTS.md` - FIN-05 checklist item unchecked + restated with dated split-scope decision; traceability row changed to In Progress
- `.planning/ROADMAP.md` - Phase 10 SC#4 restated falsifiably; Scope decisions note added; plan list corrected (10-17 relabeled, 10-18 added, count 18); Phase 7 gained 07-05 line + 7th success criterion (count 5)

## Decisions Made
- **10-17-A (2026-07-13):** FIN-05's AR clause is IN scope, not descoped, reversing the plan's original checkpoint recommendation. Source of receivables: corporate/house accounts (restaurants bill corporate clients and regulars on account; settled later). Split rationale: POS does not exist yet (Phase 7 is 0/4 plans), so the ledger cannot yet have a real-time writer from order close — Phase 10 (10-18) builds the AR sub-ledger, customer/house-account entity, AR balances + aging, and a real internal seam (`POST /internal/finance/ar/charges`) that is exercisable now via a manual post-a-charge path; Phase 7 (07-05, deferred) wires the POS "charge to account" tender to that seam. AR is explicitly NOT OPA-gated — a credit limit is a domain invariant on the customer account, not an approval workflow, so no new OPA action verb is introduced.

## Deviations from Plan

None - plan executed exactly as written. This was a docs-only decision-record plan; both tasks matched their specified actions and verify steps passed without needing fixes.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- FIN-05, Phase 10 SC#4, and Phase 7's new 07-05/SC#7 are mutually consistent and all name `POST /internal/finance/ar/charges` verbatim — a future Phase 7 planner can grep that one string and find the contract.
- Verified via `grep -rn "descope\|descoped" .planning/ROADMAP.md .planning/REQUIREMENTS.md`: the only hit is the Scope decisions note itself saying "not descoped" — no residual claim contradicts the decision.
- `git diff --stat` for this plan's two commits touches only `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md` — no source code was modified.
- Phase 10 is NOT closable until 10-18 lands and the AR aging page renders real data from a real charge (FIN-05 stays In Progress until then, per 10-06-A's false-green lesson).
- Phase 7 planning (when it starts) must account for the now-5th plan (07-05) and 7th success criterion before that phase can be marked complete.

---
*Phase: 10-purchasing-accounts-payable*
*Completed: 2026-07-13*
