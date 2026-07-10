---
phase: 07-point-of-sale-kitchen-display
plan: 08
subsystem: infra
tags: [docker, maven, powershell, dev-tooling, gap-closure]

# Dependency graph
requires:
  - phase: 07-point-of-sale-kitchen-display
    provides: pos-service and kitchen-service Maven modules (07-01..07-04) that the root pom.xml <modules> block declares but that most Dockerfiles/dev scripts hadn't been updated to know about
provides:
  - Every multi-stage-build Dockerfile (except kitchen-service, already correct, and platform-admin-service, out of scope) COPYs all 14 module pom.xml files declared in the root pom.xml, so `docker compose up --build` and any standalone `docker build` of these images no longer aborts with "Child module ... does not exist"
  - pos-service (8084) and kitchen-service (8090) are first-class entries in scripts/start-dev.ps1 (start/stop) and scripts/restart-service.ps1 ($Services table)
affects: [deployment, developer-onboarding, ci-cd]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified:
    - eureka-server/Dockerfile
    - config-server/Dockerfile
    - gateway/Dockerfile
    - services/audit-service/Dockerfile
    - services/auth-service/Dockerfile
    - services/authorization-service/Dockerfile
    - services/file-service/Dockerfile
    - services/finance-service/Dockerfile
    - services/user-service/Dockerfile
    - services/pos-service/Dockerfile
    - scripts/start-dev.ps1
    - scripts/restart-service.ps1

key-decisions:
  - "Did not touch services/kitchen-service/Dockerfile (already staged all 14 module pom.xml files) or services/platform-admin-service/Dockerfile (uses a different COPY-src-only build pattern, out of scope for this gap per plan)."
  - "Did not add pos-service/kitchen-service as docker-compose build: stanzas — deploy/docker-compose.yml deliberately host-runs every application service except eureka/config-server; this plan only fixed the Dockerfiles' own reactor validation so they build correctly whenever invoked (compose or standalone)."

patterns-established: []

requirements-completed: [POS-01, KDS-01]

coverage:
  - id: D1
    description: "All 9 general-pattern Dockerfiles (eureka-server, config-server, gateway, audit-service, auth-service, authorization-service, file-service, finance-service, user-service) plus pos-service's own Dockerfile now COPY all 14 module pom.xml files from the root pom.xml's <modules> block"
    requirement: POS-01
    verification:
      - kind: other
        ref: "shell loop: grep -q 'services/pos-service/pom.xml' && grep -q 'services/kitchen-service/pom.xml' on each of the 9 files, plus grep -q 'services/kitchen-service/pom.xml' on services/pos-service/Dockerfile — printed ALL_OK / POS_OK with zero MISSING lines"
        status: pass
    human_judgment: false
  - id: D2
    description: "pos-service (port 8084) and kitchen-service (port 8090) added to scripts/restart-service.ps1's $Services ordered hashtable and scripts/start-dev.ps1's Stop-DevStack port list, backend-service startup block, and 'Available logs' output"
    requirement: KDS-01
    verification:
      - kind: other
        ref: "grep checks for pos-service/kitchen-service/8084/8090 across both scripts, plus PSParser::Tokenize syntax-validation of both files — printed GREP_OK and PARSE_OK"
        status: pass
    human_judgment: false
  - id: D3
    description: "docker compose up --build succeeds end-to-end on a genuinely clean checkout, and a single .\\scripts\\start-dev.ps1 invocation brings up all 9 backend services plus gateway/frontend including pos-service and kitchen-service"
    verification: []
    human_judgment: true
    rationale: "Requires a live Docker Engine and full local dev stack (Postgres, RabbitMQ, all 9 JVM services, pnpm frontend) — unavailable in the planning/execution sandbox per the plan's own <verification> section (marked optional/manual). Structural grep+parse checks (D1/D2) prove the fix is textually complete; end-to-end confirmation is deferred to a developer with Docker/Maven/pnpm available locally."

# Metrics
duration: 12min
completed: 2026-07-10
status: complete
---

# Phase 07 Plan 08: Cold-start Dockerfile + dev-script gap closure Summary

**Fixed Maven reactor-validation failures across 10 Dockerfiles by COPYing the full 14-module pom.xml list, and wired pos-service/kitchen-service into start-dev.ps1 and restart-service.ps1 as first-class dev-stack services.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-10T17:50:07Z
- **Completed:** 2026-07-10T17:57:59Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Fixed the root cause of `docker compose up --build` (and any standalone `docker build`) aborting with "Child module ... does not exist": 9 Dockerfiles were missing `pos-service`/`kitchen-service` pom.xml COPY lines and `pos-service`'s own Dockerfile was missing `kitchen-service`'s — all 10 now stage every one of the 14 modules the root pom.xml declares.
- Made pos-service and kitchen-service full peers of the other 9 backend services in local dev tooling: `scripts/start-dev.ps1` now starts/stops/logs them and `scripts/restart-service.ps1` can build/restart/list them individually, using the exact same `Start-ServiceWindow`/`$Services` mechanisms already used for every other service.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix module pom.xml COPY lists in every Dockerfile missing pos-service/kitchen-service** - `2395552` (fix)
2. **Task 2: Wire pos-service and kitchen-service into scripts/start-dev.ps1 and scripts/restart-service.ps1** - `3e334fd` (feat)

**Plan metadata:** (pending — final docs commit follows this SUMMARY)

## Files Created/Modified
- `eureka-server/Dockerfile` - added pos-service + kitchen-service pom.xml COPY lines
- `config-server/Dockerfile` - added pos-service + kitchen-service pom.xml COPY lines
- `gateway/Dockerfile` - added pos-service + kitchen-service pom.xml COPY lines
- `services/audit-service/Dockerfile` - added pos-service + kitchen-service pom.xml COPY lines
- `services/auth-service/Dockerfile` - added pos-service + kitchen-service pom.xml COPY lines
- `services/authorization-service/Dockerfile` - added pos-service + kitchen-service pom.xml COPY lines
- `services/file-service/Dockerfile` - added pos-service + kitchen-service pom.xml COPY lines
- `services/finance-service/Dockerfile` - added pos-service + kitchen-service pom.xml COPY lines
- `services/user-service/Dockerfile` - added pos-service + kitchen-service pom.xml COPY lines
- `services/pos-service/Dockerfile` - added kitchen-service pom.xml COPY line (pos-service's own was already present)
- `scripts/start-dev.ps1` - added ports 8084/8090 to Stop-DevStack loop, Start-ServiceWindow calls for pos-service/kitchen-service, updated "Available logs" text
- `scripts/restart-service.ps1` - added pos-service (8084) and kitchen-service (8090) entries to $Services ordered hashtable

## Decisions Made
- Left `services/kitchen-service/Dockerfile` untouched — it already staged all 14 module pom.xml files (confirmed correct before making any edits).
- Left `services/platform-admin-service/Dockerfile` untouched — it uses a different `COPY src ./src`-style build pattern that doesn't stage per-module pom.xml files at all; rewriting it would be scope beyond what UAT diagnosed (per plan's explicit instruction).
- Did not add pos-service/kitchen-service as new `docker-compose.yml` `build:` stanzas — `deploy/docker-compose.yml`'s existing comment block documents that every application service besides eureka/config-server is deliberately host-run via `start-dev.ps1`; this plan only fixes the Dockerfiles themselves so they build correctly whenever invoked, without contradicting that architecture.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched the diagnosed root cause and prescribed fix precisely; no additional bugs, missing functionality, or blocking issues were discovered during implementation.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both remaining items from UAT Test 1's cold-start gap are now closed: `docker compose up --build` no longer aborts on Maven reactor validation, and pos-service/kitchen-service have single-command start/restart tooling.
- End-to-end confirmation (`docker compose up --build eureka config-server`, `.\scripts\restart-service.ps1 -List`, `.\scripts\start-dev.ps1` full stack) requires a developer machine with Docker/Maven/pnpm — deferred per plan's own verification section (D3 above), not a blocker for phase closure.
- No blockers for Phase 8 planning.

---
*Phase: 07-point-of-sale-kitchen-display*
*Completed: 2026-07-10*

## Self-Check: PASSED

All 12 modified files confirmed present on disk; both task commits (`2395552`, `3e334fd`) confirmed present in git log.
