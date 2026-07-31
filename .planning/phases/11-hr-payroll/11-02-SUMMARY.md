# Phase 11 Plan 02 — Summary: hr-service infra registration (gateway + dev scripts)

**Status:** Complete (static implementation; build/verify deferred — see note below)
**Executed:** 2026-07-24

## Objective

Register the not-yet-created `hr-service` (port 8088, `hr_db`) into the platform's runtime wiring —
gateway route + circuit breaker, and the three PowerShell dev/restart scripts — so that once 11-01
lands the service module, it is reachable through `/api/v1/hr/**` and launchable via the standard
dev workflow. This plan does not create the service module itself.

## Files modified

### 1. `gateway/src/main/resources/application.yml`
- Added an `hr-route` block under `spring.cloud.gateway.server.webflux.routes`, positioned right
  before the "Feature-flagged routes (later phases)" commented-stub section (after `crm-route`),
  mirroring `crm-route`/`finance-route` exactly:
  - `uri: lb://hr-service`
  - `predicates: - Path=/api/v1/hr/**`
  - `CircuitBreaker` filter named `hrCircuitBreaker`, `fallbackUri: forward:/fallback/service-unavailable`,
    `statusCodes: [500, 503]`
- Added an `hrCircuitBreaker` instance under `resilience4j.circuitbreaker.instances` (copied from
  `crmCircuitBreaker`: `slidingWindowSize: 10`, `failureRateThreshold: 50`, `waitDurationInOpenState: 10s`,
  `permittedNumberOfCallsInHalfOpenState: 3`).
- Did NOT touch `RouteFeatureMap.java` — confirmed at `gateway/.../support/RouteFeatureMap.java:37`
  that `/api/v1/hr/` -> `FEATURE_HR` is already mapped (also cross-confirmed via existing
  `FeatureFlagFilterIT.java` and `PlatformAdminClientTest.java` references to `FEATURE_HR`).
- Did NOT add `/api/v1/hr/**` (or `/iclock/**`) to any JWT public-path or feature-flag public-prefix
  list — HR stays authenticated and FEATURE_HR-gated. The device-authenticated `/iclock` path is
  explicitly out of scope for this plan (owned by plan 11-11 per the plan's own instructions).

### 2. `scripts/local-service-env.ps1`
- Added an `hr-service` env block (mirroring the `crm-service` block) right before the trailing
  RabbitMQ-credentials section:
  ```powershell
  # hr-service (Liquibase + runtime as hr_user)
  $env:HR_DB_URL = "jdbc:postgresql://127.0.0.1:5432/hr_db"
  $env:HR_DB_USER = "hr_user"
  $env:HR_DB_PASSWORD = $env:HR_DB_PASSWORD
  ```

### 3. `scripts/start-dev.ps1`
- Added `"services/hr-service"` to the `$DevMavenModules` array (after `services/crm-service`).
- Added `$pids["hr-service"] = Start-ServiceWindow "hr-service" "services/hr-service"` immediately
  after the `crm-service` start line.
- Added port `8088` to the `Stop-DevStack` port-kill list (`3000, 8080, 8081, 8082, 8083, 8084, 8086,
  8088, 8090, 8093, 8095, 8096`).
- Cosmetic: appended `hr-service` to the "Available logs" `Write-Host` hint line for consistency
  (not required by the plan, low-risk, same file already being edited).

### 4. `scripts/restart-service.ps1`
- Added `"hr-service" = @{ Port = 8088; Module = "services/hr-service" }` to the `$Services` ordered
  map, directly after the `finance-service` entry (mirroring its shape, per the plan's instruction).

### 5. `deploy/init/02b-ensure-runtime-roles.sql` — **no change made**
- Read the file: it currently contains idempotent `CREATE ROLE ... NOSUPERUSER NOBYPASSRLS` blocks
  only for `user_service`, `audit_writer`, and `file_service`.
- Checked the sibling pattern: `crm-service` connects directly as `crm_user` and `finance-service`
  connects directly as `finance_user` — both created in `deploy/init/02-create-roles.sql` — and
  **neither has an entry in 02b**. `hr-service` connects directly as `hr_user`, which is likewise
  already created in `02-create-roles.sql:21` (`CREATE ROLE hr_user LOGIN PASSWORD :'hr_pw' NOSUPERUSER
  NOBYPASSRLS`) and granted schema privileges in `03-grant-schema-privileges.sql:46-50`.
- Per the plan's own conditional instruction ("if the sibling services that connect directly as their
  `{svc}_user` have NO entry in 02b, then hr-service needs none either: leave 02b unchanged"), this
  file is left untouched. NOBYPASSRLS on `hr_user` is preserved as-is in `02-create-roles.sql` (not
  weakened).

## Already existed — confirmed, not duplicated

- `RouteFeatureMap.java:37` — `FEATURE_HR` mapping for `/api/v1/hr/` (verified intact, untouched).
- `deploy/init/01-create-databases.sql:8` — `CREATE DATABASE hr_db;`
- `deploy/init/02-create-roles.sql:21,43` — `hr_user` role (`NOSUPERUSER NOBYPASSRLS`) + DB grant.
- `deploy/init/03-grant-schema-privileges.sql:46-50` — `hr_db` schema privileges for `hr_user`.
- `deploy/docker-compose.yml` / `deploy/.env.example` — `HR_DB_PASSWORD` already present (per plan's
  objective note; not independently re-verified byte-for-byte in this pass since the plan explicitly
  flagged these as already done and out of this plan's file list).

## Deviations from the plan

None material. One cosmetic addition beyond the plan's literal file-content instructions: appended
`hr-service` to the informational "Available logs" hint line in `start-dev.ps1` (line ~266) for
consistency with the rest of that Write-Host block — this is inside a file already in the plan's
`files_modified` list and carries no functional/runtime risk.

Noted but NOT fixed (out of this plan's scope — pre-existing, belongs to whoever owns crm-service's
infra): `crm-service` itself is missing from `restart-service.ps1`'s `$Services` map and from
`start-dev.ps1`'s `Stop-DevStack` port list and log-hint line (consistent with the Phase 9
crm-service-omission noted in project memory). Left as-is; only `hr-service` entries were added per
this plan's scope.

## Verification

Static self-review performed:
- `grep -n "hr-route" gateway/src/main/resources/application.yml` → line 235 (route block present).
- `grep -n "hrCircuitBreaker" gateway/src/main/resources/application.yml` → lines 242 (route filter
  reference) and 341 (resilience4j instance definition) — both present.
- `grep -n "hr-service\|HR_DB_URL" scripts/*.ps1` → matches in all three scripts
  (`start-dev.ps1` ×3, `local-service-env.ps1` ×2, `restart-service.ps1` ×1).
- `grep -n "8088" scripts/*.ps1` → present in both `restart-service.ps1` and `start-dev.ps1`.
- YAML indentation/structure visually checked against the `crm-route`/`crmCircuitBreaker` blocks it
  was copied from (4-space nesting matches surrounding routes; new circuit-breaker instance sits at
  the same indent level as `crmCircuitBreaker`).
- PowerShell blocks visually checked against the `crm-service`/`finance-service` entries they mirror
  (same hashtable/array syntax, same quoting style).
- `deploy/init/02b-ensure-runtime-roles.sql` — read in full; unchanged, still parses (each block ends
  in `\gexec`, no dangling statement was introduced since nothing was added).

**Verification: build deferred (RAM constraint) — not run.** `mvn -q -pl gateway -am compile` was
NOT executed per the task's RAM/no-build constraint (8GB host, no Docker/Maven in this pass). The
YAML change is structurally identical in shape to the existing `crm-route`/`crmCircuitBreaker` pair
it was copied from, so compile risk is low, but this has not been mechanically confirmed.

## Downstream dependency note

`hr-route`'s `uri: lb://hr-service` will not resolve anything (empty Eureka registration) until plan
11-01 creates and registers the `hr-service` module, and the `Start-ServiceWindow "hr-service"` call
in `start-dev.ps1` will fail (`Missing executable jar`) until that module exists and is built. This
is expected — this plan only wires the surrounding infra, per its stated objective.
