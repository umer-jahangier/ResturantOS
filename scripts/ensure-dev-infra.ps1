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

function Invoke-PsqlFile([string]$Database, [string]$RelPath, [hashtable]$Vars) {
    $full = Join-Path $DeployDir $RelPath
    if (-not (Test-Path $full)) { Write-Warning "skip missing $RelPath"; return }
    $args = @("-U", $pgUser, "-d", $Database, "-v", "ON_ERROR_STOP=1", "-q")
    foreach ($k in $Vars.Keys) {
        $args += "-v"
        $args += "${k}=$($Vars[$k])"
    }
    Get-Content -Raw $full | docker exec -i restaurantos-postgres psql @args | Out-Null
}

Write-Host "==> Ensuring runtime Postgres roles (idempotent)..." -ForegroundColor Cyan
# Must stay in lockstep with deploy/scripts/ensure-dev-infra.sh and with every :'var' that
# init/02b-ensure-runtime-roles.sql actually references. The phase-12 merge added reporting_db /
# nlq_db provisioning to that SQL and taught only the .sh half to pass rpt_pw/nlq_pw; this file
# did not conflict, so it silently kept the old three-variable call. Under ON_ERROR_STOP=1 an
# unset psql variable aborts the file, taking the whole stack launch with it.
$rolePasswords = [ordered]@{
    user_pw  = $envMap["USER_DB_PASSWORD"]
    audit_pw = $envMap["AUDIT_DB_PASSWORD"]
    file_pw  = $envMap["FILE_DB_PASSWORD"]
    rpt_pw   = $envMap["REPORTING_DB_PASSWORD"]
    nlq_pw   = $envMap["NLQ_DB_PASSWORD"]
}
# A missing key yields $null, which psql would happily turn into a role with an EMPTY password;
# the service then fails much later with an opaque authentication error. Say so here instead.
# (ASCII only in this message: PowerShell 5.1 reads this file as ANSI and a non-ASCII character
# inside a string literal is a parse error, not a display glitch.)
$missing = $rolePasswords.Keys | Where-Object { [string]::IsNullOrWhiteSpace($rolePasswords[$_]) }
if ($missing) {
    Write-Error ("deploy/.env is missing values for: $($missing -join ', '). " +
        "Add the corresponding *_DB_PASSWORD entries (REPORTING_DB_PASSWORD / NLQ_DB_PASSWORD " +
        "arrived with phase 12). Creating these roles with empty passwords only defers the failure.")
}
Invoke-PsqlFile "postgres" "init/02b-ensure-runtime-roles.sql" $rolePasswords

Write-Host "==> Ensuring Postgres schema grants (idempotent)..." -ForegroundColor Cyan
Invoke-PsqlFile "postgres" "init/03-grant-schema-privileges.sql" @{}

Write-Host "==> Ensuring auth refresh lookup owner (no-op until auth-service migrates)..." -ForegroundColor Cyan
Invoke-PsqlFile "auth_db" "init/04-auth-refresh-lookup-owner.sql" @{}

Write-Host "==> Ensuring RabbitMQ user + topology..." -ForegroundColor Cyan
# rabbitmqctl writes to stderr and exits non-zero by design on re-runs (e.g. add_user when the
# user already exists). Under EAP=Stop, native stderr can surface as a terminating error in some
# PowerShell hosts, so run this whole block under EAP=Continue and gate everything on exit codes.
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    docker exec restaurantos-rabbitmq rabbitmqctl await_startup 2>&1 | Out-Null
    # add_user fails if it exists -> fall back to change_password to sync with .env.
    docker exec restaurantos-rabbitmq rabbitmqctl add_user $rmqUser $rmqPass 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        docker exec restaurantos-rabbitmq rabbitmqctl change_password $rmqUser $rmqPass 2>&1 | Out-Null
    }
    docker exec restaurantos-rabbitmq rabbitmqctl set_user_tags $rmqUser administrator 2>&1 | Out-Null
    docker exec restaurantos-rabbitmq rabbitmqctl set_permissions -p / $rmqUser ".*" ".*" ".*" 2>&1 | Out-Null
    docker exec restaurantos-rabbitmq rabbitmqctl import_definitions /etc/rabbitmq/definitions.json 2>&1 | Out-Null
} finally {
    $ErrorActionPreference = $prevEap
    # Reset so a benign non-zero rabbitmqctl exit doesn't trip the caller's error handling.
    $global:LASTEXITCODE = 0
}

Write-Host "==> Dev infra ready." -ForegroundColor Green
