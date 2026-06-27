# Local dev — quick reference

Run from repo root (`D:\GitHub\ResturantOS`).

## 1. First-time setup (new machine)

### Prerequisites

- Docker Desktop
- Java 21+, Maven
- Node 20+, pnpm (`D:\tools\pnpm-global`)
- Python 3 + pip packages:

```powershell
pip install psycopg2-binary bcrypt pyotp cryptography
```

Copy env if needed:

```powershell
Copy-Item deploy\.env.example deploy\.env
```

### Start infrastructure + services

```powershell
.\scripts\start-dev.ps1              # start all (rebuilds by default)
.\scripts\start-dev.ps1 -SkipBuild   # start without rebuild
.\scripts\start-dev.ps1 -Stop        # stop everything
.\scripts\start-dev.ps1 -InfraOnly   # postgres/redis/rabbit only
```

Wait until auth-service and finance-service are healthy (see logs below).

## 2. Tenant onboarding (phase 1)

Creates platform tenant, auth tenant, two branches, and four dev users.
Does **not** seed chart of accounts or accounting periods — run phase 2 separately.

```powershell
# Default dev tenant (idempotent — safe to re-run)
python scripts\onboarding.py

# Custom tenant
python scripts\onboarding.py --slug acme --brand-name "Acme Restaurant" --password "Acme#2026"

# Liquibase-seeded demo tenant (legacy fixed UUIDs)
python scripts\onboarding.py --slug demo --brand-name "Demo Restaurant"

# Verify logins against auth-service (must be running on :8081)
python scripts\onboarding.py --verify-login
```

### Default dev tenant users (`slug=dev`)

| Role | Email | Password | Branches |
|------|-------|----------|----------|
| OWNER | owner@dev.local | ChangeMe#2026 | Main + Downtown |
| CASHIER | cashier@dev.local | ChangeMe#2026 | Main only |
| ACCOUNTANT | accountant@dev.local | ChangeMe#2026 | Main + Downtown |
| FINANCE_VIEWER | finance@dev.local | ChangeMe#2026 | Main only |

Login at http://localhost:3000/login with tenant slug **dev**.

All users on custom slugs share the password from `--password` (default `ChangeMe#2026`).

### TOTP (owner / accountant only — step-up for privileged actions)

```powershell
python scripts\generate_totp.py owner@dev.local --enroll
python scripts\generate_totp.py owner@dev.local
.\scripts\generate_totp.ps1 owner@dev.local
```

Cashier and finance viewer do not require TOTP.

## 3. Finance seed (phase 2)

Run **after** phase 1 onboarding. Seeds ~55 COA accounts + 12 Jul–Jun periods (Pakistan FY).

```powershell
# After default onboarding (slug=dev)
python scripts\seed_finance_tenant.py

python scripts\seed_finance_tenant.py --tenant-id <uuid-from-onboarding>
```

Requires finance-service on http://127.0.0.1:8086.

Setup status API: `GET /api/v1/finance/accounts/setup/status` → `{ accountCount, periodCount, provisioned }`

## 4. Service control

### One service

```powershell
# Restart (stop → build → start)
.\scripts\restart-service.ps1 auth-service
.\scripts\restart-service.ps1 user-service
.\scripts\restart-service.ps1 finance-service
.\scripts\restart-service.ps1 gateway
.\scripts\restart-service.ps1 frontend

# Restart without rebuild
.\scripts\restart-service.ps1 auth-service -SkipBuild

# Build only (no restart)
.\scripts\restart-service.ps1 auth-service -BuildOnly

# List all service names + ports
.\scripts\restart-service.ps1 -List
```

### Ports

| Service | Port |
|---------|------|
| frontend | 3000 |
| gateway | 8080 |
| auth-service | 8081 |
| user-service | 8082 |
| finance-service | 8086 |
| platform-admin-service | 8096 |

## 5. Logs

```powershell
Get-Content .dev-logs\auth-service.log -Tail 50 -Wait
Get-Content .dev-logs\finance-service.log -Tail 50 -Wait
Get-Content .dev-logs\gateway.log -Tail 50 -Wait
Get-Content .dev-logs\user-service.log -Tail 50 -Wait
```

## 6. Full onboarding checklist (new tenant)

1. `.\scripts\start-dev.ps1` — infra + services up
2. `python scripts\onboarding.py` (or `--slug <slug> --brand-name "<name>"`) — phase 1
3. `python scripts\seed_finance_tenant.py --tenant-id <uuid>` — phase 2
4. Log in at http://localhost:3000/login with slug + user from table above
