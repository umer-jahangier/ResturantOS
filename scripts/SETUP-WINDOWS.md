# RestaurantOS — Windows (D: drive) setup

One-time bootstrap for local development on Windows. All tooling lives on **D:** — nothing is installed under `C:\Program Files` except Docker Desktop and Node (already present).

## What was installed

| Tool | Location | Notes |
|------|----------|-------|
| **JDK 25** (required) | `D:\jdk25` | Project uses Java 25 (`pom.xml`). JDK 21 at `D:\jdk21` is **not** sufficient for Maven builds. |
| **Apache Maven 3.9.16** | `D:\tools\apache-maven` | Backend builds |
| **pnpm 10.12.1** | `D:\tools\pnpm-global` | Frontend package manager |
| **deploy/.env** | `deploy/.env` | Dev secrets + RS256/AES keys (from `generate-keys.sh`) |

## One-time: permanent PATH (run in PowerShell as your user)

```powershell
[Environment]::SetEnvironmentVariable("JAVA_HOME", "D:\jdk25", "User")
[Environment]::SetEnvironmentVariable("MAVEN_HOME", "D:\tools\apache-maven", "User")
[Environment]::SetEnvironmentVariable("PNPM_HOME", "D:\tools\pnpm-global", "User")

$path = [Environment]::GetEnvironmentVariable("Path", "User")
$add = @("D:\jdk25\bin", "D:\tools\apache-maven\bin", "D:\tools\pnpm-global")
foreach ($p in $add) { if ($path -notlike "*$p*") { $path = "$p;$path" } }
[Environment]::SetEnvironmentVariable("Path", $path, "User")
```

Restart Cursor/terminal after this so `java`, `mvn`, and `pnpm` resolve globally.

## Every session — one command (recommended)

```powershell
cd D:\GitHub\ResturantOS
.\scripts\start-dev.ps1
```

This starts **everything**: Docker infra, all 6 backend services, gateway, and frontend (each in its own window). Logs go to `.dev-logs/`.

Stop everything:

```powershell
.\scripts\start-dev.ps1 -Stop
```

Infra only (no backend/frontend):

```powershell
.\scripts\start-dev.ps1 -InfraOnly
```

## Every session (manual / step-by-step)

```powershell
. D:\GitHub\ResturantOS\scripts\dev-env.ps1
```

## Start infrastructure

1. **Start Docker Desktop** (required — infra runs in containers).
2. From repo root:

```powershell
# Option A — PowerShell (no GNU make needed)
.\scripts\dev-up.ps1

# Option B — Git Bash + make (if you install make later)
bash deploy/generate-keys.sh   # only if deploy/.env is missing
make dev-up
```

## Verify stack

```powershell
cd D:\GitHub\ResturantOS\deploy
docker compose ps
```

All services should show **healthy** (or Up for OPA/pgAdmin).

| Service | URL |
|---------|-----|
| Eureka | http://localhost:8761 |
| Config Server | http://localhost:8888 |
| PostgreSQL | localhost:5432 |
| pgAdmin | http://localhost:5050 |
| RabbitMQ UI | http://localhost:15672 |
| MinIO console | http://localhost:9001 |
| Mailpit | http://localhost:8025 |
| OPA | http://localhost:8181 |
| ClickHouse | http://localhost:8123 |

**pgAdmin login:** email from `deploy/.env` → `PGADMIN_DEFAULT_EMAIL`, password → `PGADMIN_DEFAULT_PASSWORD`

## Build & run app code

```powershell
. D:\GitHub\ResturantOS\scripts\dev-env.ps1

# Backend (Phase 1 modules)
cd D:\GitHub\ResturantOS
mvn -pl shared-lib,eureka-server,config-server -am -DskipTests compile

# Frontend
cd frontend
pnpm install
pnpm dev          # http://localhost:3000
```

## Manual installs (optional)

| Item | Why | How |
|------|-----|-----|
| **Docker Desktop** | Required for infra | Already installed; must be running before `dev-up` |
| **GNU make** | `make dev-up` on Windows | `choco install make` or use `scripts/dev-up.ps1` instead |
| **psql client** | `ensure-dev-infra.sh` from host | Optional — grants run via `docker compose exec postgres psql ...` |
| **Anthropic API key** | NLQ (Phase 12) | Set `ANTHROPIC_API_KEY` in `deploy/.env` when needed |

## Phase 1 requirements (this setup satisfies)

- **INFRA-01..04**: Docker stack + `.env` + keys
- **LIB-01..06**: `shared-lib` compiles; full tests need `mvn test`
- **XCUT-01..06**: Enforced in shared-lib (verified in Phase 1 plans)

Phase 1 code was already implemented in the repo (4/4 plans). This document covers **your laptop environment** only.

## Scripts reference

| Script | Purpose |
|--------|---------|
| `scripts/start-dev.ps1` | **One command** — infra + all backend services + gateway + frontend |
| `scripts/start-dev.ps1 -Stop` | Stop host services and Docker infra |
| `scripts/dev-env.ps1` | Load JDK 25 + Maven + pnpm on PATH |
| `scripts/local-service-env.ps1` | Load `deploy/.env` + per-service DB credentials |
| `scripts/dev-up.ps1` | Start Docker infra only |

## Troubleshooting

- **Docker pipe error** → Start Docker Desktop and wait until `docker info` succeeds.
- **Maven "Child module does not exist" in Docker build** → Fixed in `eureka-server/Dockerfile` and `config-server/Dockerfile` (all module POMs copied into build context).
- **pnpm EPERM on corepack** → Use `npm install -g pnpm --prefix D:\tools\pnpm-global` (already done).
- **Wrong Java version** → Ensure `JAVA_HOME=D:\jdk25`, not `D:\jdk21`.
