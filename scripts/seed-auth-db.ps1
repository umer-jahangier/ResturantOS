# Apply auth_db schema + Liquibase seed context (demo tenant + users).
# Idempotent: Liquibase skips changesets already applied.
# Usage: .\scripts\seed-auth-db.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogFile = Join-Path $RepoRoot ".dev-logs\auth-seed.log"
$Jar = Join-Path $RepoRoot "services\auth-service\target\auth-service-1.0.0.jar"

. (Join-Path $PSScriptRoot "dev-env.ps1")
. (Join-Path $PSScriptRoot "local-service-env.ps1")

New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null

if (-not (Test-Path $Jar)) {
    Write-Host "Building auth-service..."
    mvn -pl shared-lib,services/auth-service -am -DskipTests package -q
}

Write-Host "Running auth-service once to apply Liquibase (schema + seed)..."
$proc = Start-Process java -PassThru -WindowStyle Hidden -ArgumentList @("-jar", $Jar) -RedirectStandardOutput $LogFile -RedirectStandardError $LogFile

$deadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $deadline) {
    if ($proc.HasExited) { break }
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:8081/actuator/health" -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { break }
    } catch { Start-Sleep -Seconds 2 }
}

Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort 8081 -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

Write-Host "Done. Verify with:"
Write-Host "  docker exec restaurantos-postgres psql -U postgres -d auth_db -c `"SELECT slug FROM auth_tenants; SELECT email FROM users;`""
