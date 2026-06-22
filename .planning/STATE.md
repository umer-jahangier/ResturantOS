# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A restaurant tenant can run operations end-to-end — POS order → inventory depletion → balanced double-entry JE — with strict tenant/branch isolation and no accounting imbalance.
**Current focus:** Phase 1 — Infrastructure Foundation & Shared Library

## Current Position

Phase: 1 of 12 (Infrastructure Foundation & Shared Library)
Plan: 1 of 4 in current phase
Status: In progress
Last activity: 2026-06-23 — Completed 01-01-PLAN.md (Maven skeleton + dev infra spine)

Progress: [█░░░░░░░░░] 3% (1/33 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 1
- Average duration: ~20 min
- Total execution time: 0.3 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-infrastructure-foundation-shared-library | 1/4 | ~20 min | ~20 min |

**Recent Trend:**
- Last 5 plans: 01-01
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Init]: Specs in `Docs/` are the single source of truth, superior to prompts.
- [Init]: Skip GSD research phase — domain/stack/architecture fully specified + 11 agent-specs produced.
- [Roadmap]: Phase 1 = Sprint-1 "GO" set is split across Phases 1–4 (infra+shared-lib → auth+authz → gateway+platform+user → frontend+CI/CD); nothing tenant-business precedes a working auth+gateway+frontend shell.
- [Roadmap]: Notifications/Audit/Files (Phase 5) come online as event consumers of the foundation; the welcome/reset emails referenced by PLATFORM-01/AUTH-06 are delivered via this phase's consumers while the foundation phases publish the triggering events via the outbox.
- [Roadmap]: FIN-03 (auto-posting engine) is placed at Phase 9 to close the core-value loop after POS+Inventory; module-specific postings (GR/IR, vendor payment, payroll JE) are owned by their module REQs (PUR-03/PUR-04/HR-03).
- [01-01]: Parent `<modules>` declares only 3 modules (shared-lib, eureka-server, config-server) — adding all 16 service modules before they exist breaks the reactor.
- [01-01]: eureka/config compose services use `build:` stanzas (context: repo root) — ghcr.io images don't exist yet and SC1 requires local builds.
- [01-01]: Spring Boot 4.0.7 renamed `spring-boot-starter-aop` → `spring-boot-starter-aspectj`; shared-lib uses the new name.

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

- **01-02 must create** `deploy/init/01-create-databases.sql` and `deploy/init/02-create-roles.sql` before `make dev-up` works — postgres container fails without init scripts.
- **01-03 must create** `deploy/.env` (via generate-keys.sh), `deploy/init/rabbitmq-definitions.json`, and `deploy/init/rabbitmq.conf` — Makefile guard blocks dev-up until .env exists; RabbitMQ won't start without definitions.
- **Docker Hub availability:** `maven:3.9-eclipse-temurin-25` and `eclipse-temurin:25-jre` must be available for Dockerfile builds. These are standard Temurin images but should be verified on first `docker compose build`.

## Session Continuity

Last session: 2026-06-23
Stopped at: Completed 01-01-PLAN.md — Maven skeleton, Dockerfiles, docker-compose, Makefiles, OPA placeholder.
Resume file: None
