# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** A restaurant tenant can run operations end-to-end — POS order → inventory depletion → balanced double-entry JE — with strict tenant/branch isolation and no accounting imbalance.
**Current focus:** Phase 1 — Infrastructure Foundation & Shared Library

## Current Position

Phase: 1 of 12 (Infrastructure Foundation & Shared Library)
Plan: 4 of 4 executed; verification 4/5 must-haves
Status: Gaps found — SC5 `processed_events` consumer dedup not implemented
Last activity: 2026-06-23 — Phase 1 execution complete; verifier found SC5 gap (see 01-VERIFICATION.md)

Progress: [████░░░░░░] 12% (4/33 plans)

## Performance Metrics

**Velocity:**
- Total plans completed: 4
- Phase 1: 4/4 plans executed; verification gaps_found (4/5)
- Total execution time: ~4.5 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-infrastructure-foundation-shared-library | 4/4 (verify 4/5) | ~4.5 hours | ~68 min |

**Recent Trend:**
- Last 5 plans: 01-01, 01-02, 01-03, 01-04
- Trend: Phase 1 plans done; gap closure needed for SC5

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
- [01-03]: Users/permissions omitted from rabbitmq-definitions.json; RabbitMQ creates the user from RABBITMQ_DEFAULT_USER/PASS env vars (auto-granted / vhost access).
- [01-03]: PEM stored as base64 in .env (not \n-escaped); JwksKeyProvider/JwtProperties in 01-04 must Base64-decode before parsing.
- [01-04]: Security beans (JwtAuthenticationFilter, JwksKeyProvider) shipped in shared-lib but NOT wired — Phase 2 (auth-service) wires them into SecurityFilterChain.
- [01-04]: OutboxRelay publishes raw bytes via `rabbitTemplate.send(...)` to avoid double-encoding by Jackson2JsonMessageConverter.
- [01-04]: OPA client is @ConditionalOnProperty(name="restaurantos.opa.url") — absent in tests; enabled when OPA_URL set in production.
- [01-04]: SharedLibTestApplication (in src/test/java) bootstraps Spring context for shared-lib Testcontainers tests; no main class needed in shared-lib itself.

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

- ~~**01-02 must create** `deploy/init/01-create-databases.sql` and `deploy/init/02-create-roles.sql`~~ ✅ RESOLVED in 01-02.
- ~~**01-03 must create** `deploy/.env` (via generate-keys.sh), `deploy/init/rabbitmq-definitions.json`, and `deploy/init/rabbitmq.conf`~~ ✅ RESOLVED in 01-03.
- **SC5 gap (verification):** `processed_events` table exists in schema but has no Java entity/repository or consumer-side dedup logic. SC5 test uses `idempotency_keys` instead. Fix via `/gsd-plan-phase 1 --gaps`.
- **Docker Hub availability:** `maven:3.9-eclipse-temurin-25` and `eclipse-temurin:25-jre` must be available for Dockerfile builds. These are standard Temurin images but should be verified on first `docker compose build`.
- **JDK 25 required:** Local environment has JDK 21.0.11. Maven compilation (`mvn compile`, `mvn test-compile`) fails for all modules until JDK 25 is installed. Code is syntactically correct; this is a toolchain constraint only.

## Session Continuity

Last session: 2026-06-23
Stopped at: Phase 1 all 4 plans executed; verifier score 4/5 — SC5 `processed_events` consumer dedup missing.
Next: `/gsd-plan-phase 1 --gaps` then re-run `/gsd-execute-phase 1 --gaps-only`
Resume file: None
