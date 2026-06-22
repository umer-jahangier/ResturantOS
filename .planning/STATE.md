# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A restaurant tenant can run operations end-to-end — POS order → inventory depletion → balanced double-entry JE — with strict tenant/branch isolation and no accounting imbalance.
**Current focus:** Phase 1 — Infrastructure Foundation & Shared Library

## Current Position

Phase: 1 of 12 (Infrastructure Foundation & Shared Library)
Plan: 3 of 4 in current phase
Status: In progress
Last activity: 2026-06-23 — Completed 01-03-PLAN.md (RabbitMQ topology + generate-keys.sh + .env.example)

Progress: [███░░░░░░░] 9% (3/33 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 2
- Average duration: ~12 min
- Total execution time: 0.5 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-infrastructure-foundation-shared-library | 2/4 | ~32 min | ~16 min |

**Recent Trend:**
- Last 5 plans: 01-01, 01-02
- Trend: On track

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
- [01-02]: No `ALTER ROLE SET app.current_tenant_id` — tenant GUC is set per-transaction via `set_config(..., true)`; static ALTER ROLE SET would pin one tenant across pooled connections.
- [01-02]: `event_outbox`, `idempotency_keys`, `processed_events` are RLS-exempt (run outside tenant context); AbstractRlsCoverageTest auto-excludes them.
- [01-02]: AbstractRlsCoverageTest has no Testcontainers/Spring bootstrap — that lives in 01-04's BaseIntegrationTest; this class only provides query+assert logic.

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

- ~~**01-02 must create** `deploy/init/01-create-databases.sql` and `deploy/init/02-create-roles.sql`~~ ✅ RESOLVED in 01-02.
- **01-03 must create** `deploy/.env` (via generate-keys.sh), `deploy/init/rabbitmq-definitions.json`, and `deploy/init/rabbitmq.conf` — Makefile guard blocks dev-up until .env exists; RabbitMQ won't start without definitions.
- **Docker Hub availability:** `maven:3.9-eclipse-temurin-25` and `eclipse-temurin:25-jre` must be available for Dockerfile builds. These are standard Temurin images but should be verified on first `docker compose build`.
- **JDK 25 required:** Local environment has JDK 21.0.11. Maven compilation (`mvn compile`, `mvn test-compile`) fails for all modules until JDK 25 is installed. Code is syntactically correct; this is a toolchain constraint only.

## Session Continuity

Last session: 2026-06-22
Stopped at: Completed 01-02-PLAN.md — PostgreSQL init scripts (13 DBs + 13 roles), TenantAuditableEntity, RLS convention doc, AbstractRlsCoverageTest.
Resume file: None
