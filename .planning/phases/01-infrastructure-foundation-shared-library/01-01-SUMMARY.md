---
phase: 01-infrastructure-foundation-shared-library
plan: 01
subsystem: infra-foundation
tags: [maven, spring-boot, eureka, config-server, docker-compose, opa, makefile]

dependency-graph:
  requires: []
  provides:
    - maven-reactor-3-modules
    - eureka-server-jar
    - config-server-jar
    - docker-compose-dev-stack
    - opa-policy-placeholder
    - make-dev-up-target
  affects:
    - 01-02-database-init  # deploy/init/01-create-databases.sql, 02-create-roles.sql
    - 01-03-env-secrets    # deploy/.env.example, generate-keys.sh
    - 01-04-shared-lib     # shared-lib sources added to the buildable jar skeleton

tech-stack:
  added:
    - spring-boot-starter-parent:4.0.7
    - spring-cloud-dependencies:2025.1.0
    - spring-cloud-starter-netflix-eureka-server
    - spring-cloud-config-server
    - spring-cloud-starter-netflix-eureka-client
    - testcontainers-bom:1.20.3
    - mapstruct:1.7.0.Beta1
    - lombok:1.18.38
    - jjwt:0.12.6
    - nimbus-jose-jwt:9.40
    - logstash-logback-encoder:7.4
    - docker-compose (dev infra)
    - openpolicyagent/opa:1.17.1
  patterns:
    - maven-multi-module-parent
    - multi-stage-dockerfile
    - compose-local-build
    - rego-v1-policy

key-files:
  created:
    - pom.xml
    - shared-lib/pom.xml
    - eureka-server/pom.xml
    - eureka-server/Dockerfile
    - eureka-server/src/main/java/io/restaurantos/eureka/EurekaServerApplication.java
    - eureka-server/src/main/resources/application.yml
    - config-server/pom.xml
    - config-server/Dockerfile
    - config-server/src/main/java/io/restaurantos/configserver/ConfigServerApplication.java
    - config-server/src/main/resources/application.yml
    - deploy/docker-compose.yml
    - deploy/Makefile
    - deploy/init/clickhouse-init.sql
    - Makefile
    - policies/restaurantos/common.rego
    - .gitignore
  modified: []

decisions:
  - id: D1
    decision: "Declare only shared-lib, eureka-server, config-server in parent <modules>"
    rationale: "Listing all 16 service modules before they exist breaks the Maven reactor"
    alternatives: "Full module list from spec 01 §1.2"
  - id: D2
    decision: "Use build: stanzas for eureka/config in docker-compose.yml instead of ghcr.io image refs"
    rationale: "Images don't exist in ghcr.io; local build is required for make dev-up to work"
    alternatives: "Push pre-built images to ghcr.io first"
  - id: D3
    decision: "Replace spring-boot-starter-aop with spring-boot-starter-aspectj"
    rationale: "Spring Boot 4.0.7 renamed the AOP starter; spring-boot-starter-aop is not in the BOM"
    alternatives: "Pin explicit version for old artifact name"

metrics:
  duration: "~20 min"
  completed: "2026-06-23"
---

# Phase 01 Plan 01: Maven Parent POM + Dev Infrastructure Spine Summary

**One-liner:** Maven 3-module reactor (shared-lib / eureka-server / config-server) with Spring Boot 4.0.7 + Spring Cloud 2025.1.0, multi-stage Dockerfiles building local images for compose, and `make dev-up` wired end-to-end.

## Objective

Stand up the dev-infrastructure spine and the Maven multi-module skeleton so every later plan has a buildable reactor and a runnable local stack. Contributes to SC1 (`make dev-up` brings infrastructure to healthy).

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Maven parent POM + shared-lib/eureka/config skeletons | `8adaaba` | pom.xml, shared-lib/pom.xml, eureka-server/\*, config-server/\*, .gitignore |
| 2 | Dockerfiles + docker-compose.yml with local builds | `dbd06de` | eureka-server/Dockerfile, config-server/Dockerfile, deploy/docker-compose.yml, deploy/init/clickhouse-init.sql, policies/restaurantos/common.rego |
| 3 | Makefile dev-up / dev-down / dev-logs | `ad2322a` | deploy/Makefile, Makefile |

## Verification Results

- `mvn -N validate` → **BUILD SUCCESS**
- `mvn -pl eureka-server,config-server -am -q -DskipTests package` → **BUILD SUCCESS** (both JARs produced)
- Parent `<modules>` → exactly `shared-lib`, `eureka-server`, `config-server` ✓
- `docker compose -f deploy/docker-compose.yml config -q` → **valid** (only env-var warnings, no errors) ✓
- `grep -c "ghcr.io" deploy/docker-compose.yml` → **0** ✓
- `make -n dev-up` from repo root → delegates to `deploy/` and expands to `docker compose up -d --build` ✓
- `policies/restaurantos/common.rego` is Rego v1 with `if` keyword and three helper rules ✓

## Decisions Made

| ID | Decision | Rationale |
|----|----------|-----------|
| D1 | Parent `<modules>` declares only 3 modules | Listing all 16 before they exist breaks the reactor |
| D2 | eureka/config use `build:` stanzas not `ghcr.io` image refs | Images don't exist in registry; local build required for SC1 |
| D3 | Use `spring-boot-starter-aspectj` instead of `spring-boot-starter-aop` | Boot 4.0.7 renamed this starter; old name absent from BOM |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Spring Boot 4.0.7 renamed `spring-boot-starter-aop` to `spring-boot-starter-aspectj`**

- **Found during:** Task 1 package build
- **Issue:** `spring-boot-starter-aop` is not in `spring-boot-dependencies:4.0.7` BOM; Maven reported a missing version error. The BOM contains `spring-boot-starter-aspectj` (and `spring-boot-starter-aspectj-test`) instead.
- **Fix:** Updated `shared-lib/pom.xml` to use `spring-boot-starter-aspectj`; this is the correct Spring Boot 4.x AOP starter.
- **Files modified:** `shared-lib/pom.xml`
- **Commit:** `8adaaba`

**Note:** The spec (agent-spec 03 §3.1) references `spring-boot-starter-aop` which was the Boot 3.x name. The rename is a Boot 4.x breaking change.

### Environment Notes

- Local build verification used JDK 26.0.1 (`/opt/homebrew/Cellar/openjdk/26.0.1`). The project targets Java 25; JDK 26 satisfies `--release 25`.
- The Maven `mvn -pl eureka-server,config-server -am -q package` verification passed using `JAVA_HOME` pointed to JDK 26.

## Next Phase Readiness

**Blockers/concerns for 01-02 and beyond:**

1. `deploy/init/01-create-databases.sql` and `02-create-roles.sql` don't exist yet — `make dev-up` will fail until 01-02 creates them (postgres container init scripts). The compose file already mounts them.
2. `deploy/.env` doesn't exist (01-03 deliverable). The Makefile guard will exit with a clear error.
3. `deploy/init/rabbitmq-definitions.json` and `rabbitmq.conf` don't exist yet (01-03). RabbitMQ container won't start until 01-03 provides them.
4. The `docker compose build eureka config-server` step requires the `maven:3.9-eclipse-temurin-25` base image to exist in Docker Hub — should be available since it's a Temurin official image.
