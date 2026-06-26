# RestaurantOS - Windows equivalent of deploy/scripts/ensure-dev-infra.sh.
# Provisions RabbitMQ (user/permissions/topology) and applies Postgres grants that the
# Docker entrypoint does not run automatically. Uses `docker exec` only - no host psql/bash.
#
# Usage: . needs deploy/.env present.  pwsh scripts/ensure-dev-infra.ps1
$ErrorActionPreference = "Stop"
# PowerShell 7.3+ makes native (exe) commands that exit non-zero throw a terminating error
# when ErrorActionPreference=Stop. Several rabbitmqctl calls below fail *by design* on re-runs
# (e.g. add_user when the user already exists) and are handled via $LASTEXITCODE checks, so
# opt out of that behavior here. Postgres steps use ON_ERROR_STOP=1 for their own error gating.
$PSNativeCommandUseErrorActionPreference = $false
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DeployDir = Join-Path $RepoRoot "deploy"
$EnvFile = Join-Path $DeployDir ".env"

if (-not (Test-Path $EnvFile)) {
    Write-Error "deploy/.env missing. Run: bash deploy/generate-keys.sh"
}

# Parse deploy/.env into a hashtable.
$envMap = @{}
Get-Content $EnvFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $kv = $_ -split '=', 2
    $envMap[$kv[0].Trim()] = $kv[1].Trim()
}

$pgUser = $envMap["POSTGRES_SUPERUSER"]
$rmqUser = $envMap["RABBITMQ_USERNAME"]
$rmqPass = $envMap["RABBITMQ_PASSWORD"]

function Invoke-PsqlFile([string]$Database, [string]$RelPath) {
    $full = Join-Path $DeployDir $RelPath
    if (-not (Test-Path $full)) { Write-Warning "skip missing $RelPath"; return }
    Get-Content -Raw $full | docker exec -i restaurantos-postgres psql -U $pgUser -d $Database -v ON_ERROR_STOP=1 -q | Out-Null
}

Write-Host "==> Ensuring Postgres schema grants (idempotent)..." -ForegroundColor Cyan
Invoke-PsqlFile "postgres" "init/03-grant-schema-privileges.sql"

Write-Host "==> Ensuring auth refresh lookup owner (no-op until auth-service migrates)..." -ForegroundColor Cyan
Invoke-PsqlFile "auth_db" "init/04-auth-refresh-lookup-owner.sql"

Write-Host "==> Ensuring RabbitMQ user + topology..." -ForegroundColor Cyan
docker exec restaurantos-rabbitmq rabbitmqctl await_startup *> $null
# add_user fails if it exists -> fall back to change_password to sync with .env.
docker exec restaurantos-rabbitmq rabbitmqctl add_user $rmqUser $rmqPass *> $null
if ($LASTEXITCODE -ne 0) {
    docker exec restaurantos-rabbitmq rabbitmqctl change_password $rmqUser $rmqPass *> $null
}
docker exec restaurantos-rabbitmq rabbitmqctl set_user_tags $rmqUser administrator *> $null
docker exec restaurantos-rabbitmq rabbitmqctl set_permissions -p / $rmqUser ".*" ".*" ".*" *> $null
docker exec restaurantos-rabbitmq rabbitmqctl import_definitions /etc/rabbitmq/definitions.json *> $null

Write-Host "==> Dev infra ready." -ForegroundColor Green
