# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A restaurant tenant can run operations end-to-end — POS order → inventory depletion → balanced double-entry JE — with strict tenant/branch isolation and no accounting imbalance.
**Current focus:** Phase 3 — API Gateway, Platform Admin & Tenant/User Management

## Current Position

Phase: 3 of 12 (API Gateway, Platform Admin & Tenant/User Management)
Plan: 0 of 3 planned
Status: Phase 2 verified passed (5/5 SC)
Last activity: 2026-06-24 — Phase 2 execution complete; all 3 plans + verification passed

Progress: [██████░░░░] 21% (7/33 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 7
- Phase 1: 4/4 plans executed; verification gaps_found (4/5) — SC5 gap open
- Phase 2: 3/3 plans executed; verification passed (5/5)

**By Phase:**

| Phase | Plans | Verify |
|-------|-------|--------|
| 01-infrastructure-foundation-shared-library | 4/4 | 4/5 gaps_found |
| 02-authentication-authorization | 3/3 | 5/5 passed |

**Recent Trend:**
- Last 5 plans: 02-01, 02-02, 02-03 (+ Phase 1 gap still open)
- Trend: Auth + authz stack complete; gateway/platform next

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [02-01]: NON-RLS `auth_tenants` slug lookup before tenant GUC (Phase 2/3 seam).
- [02-01]: Login `@Transactional(noRollbackFor auth failures)` so lockout counts persist.
- [02-02]: Step-up at login for `rbac.manage`, `finance.period.close`, or `totp_enabled`; privileged first-enrollment is provisioning (Phase 3).
- [02-02]: `EncryptionService` in shared-lib via opt-in `EncryptionAutoConfiguration` (not SharedAutoConfiguration).
- [02-03]: `DefaultOpaClient` serializes OPA input with snake_case JSON; 2s connect+read timeout fail-closed.
- [01-04]: Security beans shipped in shared-lib but wired in auth-service SecurityFilterChain.

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase 1 SC5 gap:** `processed_events` consumer dedup not implemented — fix via `/gsd-plan-phase 1 --gaps` (non-blocking for Phase 3).
- **IT env:** Testcontainers on Colima requires `DOCKER_HOST` + `TESTCONTAINERS_RYUK_DISABLED=true`.

## Session Continuity

Last session: 2026-06-24
Stopped at: Phase 2 complete — auth-service (11 ITs) + authorization-service (7 ITs) + opa test 100%.
Next: `/gsd-discuss-phase 3` or `/gsd-plan-phase 3`
Resume file: None
