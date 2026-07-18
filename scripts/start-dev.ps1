# RestaurantOS — start full local dev stack (infra + all backend services + frontend)
# Usage:
#   .\scripts\start-dev.ps1           # start everything
#   .\scripts\start-dev.ps1 -Stop     # stop host services + docker infra
#   .\scripts\start-dev.ps1 -InfraOnly

param(
    [switch]$Stop,
    [switch]$InfraOnly,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $RepoRoot ".dev-logs"
$PidFile = Join-Path $RepoRoot ".dev-pids.json"

function Write-Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Stop-PortListener([int]$Port) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

function Stop-DevStack {
    Write-Step "Stopping host services (ports 3000, 8080-8096)"
    foreach ($p in 3000, 8080, 8081, 8082, 8083, 8084, 8085, 8086, 8090, 8093, 8095, 8096) {
        Stop-PortListener $p
    }
    if (Test-Path $PidFile) { Remove-Item $PidFile -Force }

    Write-Step "Stopping Docker infrastructure (showing progress; ~30-60s)"
    Push-Location (Join-Path $RepoRoot "deploy")
    # Compose writes progress to stderr; do NOT swallow it (2>$null) or the stop looks frozen.
    # ErrorActionPreference=Continue so that normal stderr progress isn't treated as fatal.
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker compose down --timeout 10 --remove-orphans
    $ErrorActionPreference = $prevEap
    Pop-Location
    Write-Host "Stopped." -ForegroundColor Green
    exit 0
}

if ($Stop) { Stop-DevStack }

# ── Toolchain ────────────────────────────────────────────────────────────────
. (Join-Path $PSScriptRoot "dev-env.ps1")

foreach ($tool in @("docker", "java", "mvn")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        Write-Error "Missing '$tool'. Run scripts/SETUP-WINDOWS.md bootstrap first."
    }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    $pnpmCmd = "D:\tools\pnpm-global\pnpm.cmd"
    if (Test-Path $pnpmCmd) { $env:Path = "D:\tools\pnpm-global;$env:Path" }
    else { Write-Error "pnpm not found. Install to D:\tools\pnpm-global" }
}

. (Join-Path $PSScriptRoot "local-service-env.ps1")

# ── Frontend env ─────────────────────────────────────────────────────────────
$frontendEnvLocal = Join-Path $RepoRoot "frontend\.env.local"
if (-not (Test-Path $frontendEnvLocal)) {
    @"
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8080
"@ | Set-Content $frontendEnvLocal -Encoding utf8
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ── Infrastructure ─────────────────────────────────────────────────────────────
Write-Step "Starting Docker infrastructure"
& (Join-Path $PSScriptRoot "dev-up.ps1")

if ($InfraOnly) {
    Write-Host "Infra only - done. Backend services not started." -ForegroundColor Green
    exit 0
}

function Wait-HttpOk([string]$Url, [int]$TimeoutSec = 120) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { return $true }
        } catch { Start-Sleep -Seconds 3 }
    }
    return $false
}

Write-Step "Waiting for Eureka"
if (-not (Wait-HttpOk "http://localhost:8761/" 180)) {
    Write-Warning "Eureka health check timed out - continuing anyway"
}

function Test-BootJar([string]$JarPath) {
    if (-not (Test-Path $JarPath)) { return $false }
    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("ros-bootjar-" + [Guid]::NewGuid().ToString("n"))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
        Push-Location $tmp
        jar xf $JarPath META-INF/MANIFEST.MF 2>$null | Out-Null
        if (-not (Test-Path "META-INF/MANIFEST.MF")) { return $false }
        return Select-String -Path "META-INF/MANIFEST.MF" -Pattern "^Main-Class:" -Quiet
    } catch {
        return $false
    } finally {
        Pop-Location
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Start-ServiceWindow(
    [string]$Name,
    [string]$MavenModule,
    [string]$ExtraEnvBlock = ""
) {
    $logFile = Join-Path $LogDir "$Name.log"
    $artifact = Split-Path $MavenModule -Leaf
    $jarPath = Join-Path $RepoRoot "$MavenModule/target/$artifact-1.0.0.jar"
    $needsBuild = -not $SkipBuild.IsPresent -or -not (Test-BootJar $jarPath)
    if ($needsBuild) {
        Write-Host "  Building $Name..."
        Push-Location $RepoRoot
        mvn -pl $MavenModule -am -DskipTests package -q
        if ($LASTEXITCODE -ne 0) {
            Pop-Location
            Write-Error "Maven build failed for $Name"
        }
        Pop-Location
        if (-not (Test-BootJar $jarPath)) {
            Write-Error "Expected executable Spring Boot jar at $jarPath (missing Main-Class). Re-run without -SkipBuild."
        }
    }
    $cmd = @"
Set-Location '$RepoRoot'
. '$PSScriptRoot\dev-env.ps1'
. '$PSScriptRoot\local-service-env.ps1'
`$Host.UI.RawUI.WindowTitle = 'RestaurantOS - $Name'
$ExtraEnvBlock
java -jar '$jarPath' *>&1 | Tee-Object -FilePath '$logFile'
"@
    $proc = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cmd
    )
    Write-Host "  Started $Name (PID $($proc.Id)) -> $logFile"
    return $proc.Id
}

# ── Backend services (order matters: auth before gateway) ─────────────────────
Write-Step "Starting backend services (separate windows)"

$pids = @{}
$pids["auth-service"] = Start-ServiceWindow "auth-service" "services/auth-service"
Start-Sleep -Seconds 15

$pids["authorization-service"] = Start-ServiceWindow "authorization-service" "services/authorization-service"
$pids["user-service"] = Start-ServiceWindow "user-service" "services/user-service"
$pids["platform-admin-service"] = Start-ServiceWindow "platform-admin-service" "services/platform-admin-service"
$pids["audit-service"] = Start-ServiceWindow "audit-service" "services/audit-service"
$pids["file-service"] = Start-ServiceWindow "file-service" "services/file-service"
$pids["finance-service"] = Start-ServiceWindow "finance-service" "services/finance-service"
$pids["pos-service"] = Start-ServiceWindow "pos-service" "services/pos-service"
$pids["kitchen-service"] = Start-ServiceWindow "kitchen-service" "services/kitchen-service"
$pids["inventory-service"] = Start-ServiceWindow "inventory-service" "services/inventory-service"

Write-Step "Waiting for auth-service JWKS before gateway"
if (-not (Wait-HttpOk "http://localhost:8081/.well-known/jwks.json" 180)) {
    Write-Warning "Auth JWKS not ready - gateway may fail to start. Check .dev-logs/auth-service.log"
}

# 04-auth-refresh-lookup-owner.sql is a no-op until auth-service has run its migrations,
# so apply it now (after JWKS is up) to enable refresh-token lookup under FORCE RLS.
Write-Step "Applying auth refresh-lookup owner (post-migration)"
try {
    $pgUser = (Select-String -Path (Join-Path $RepoRoot 'deploy\.env') -Pattern '^POSTGRES_SUPERUSER=' | ForEach-Object { $_.Line.Split('=', 2)[1] })
    Get-Content -Raw (Join-Path $RepoRoot 'deploy\init\04-auth-refresh-lookup-owner.sql') |
        docker exec -i restaurantos-postgres psql -U $pgUser -d auth_db -q | Out-Null
} catch { Write-Warning "Could not apply 04-auth-refresh-lookup-owner.sql: $_" }

$pids["gateway"] = Start-ServiceWindow "gateway" "gateway"

# ── Frontend ───────────────────────────────────────────────────────────────────
Write-Step "Starting frontend (Next.js)"
$frontendLog = Join-Path $LogDir "frontend.log"
$feCmd = @"
Set-Location '$RepoRoot\frontend'
`$Host.UI.RawUI.WindowTitle = 'RestaurantOS - frontend'
if (-not (Test-Path node_modules)) { pnpm install }
pnpm dev *>&1 | Tee-Object -FilePath '$frontendLog'
"@
$pids["frontend"] = (Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $feCmd
)).Id

$pids | ConvertTo-Json | Set-Content $PidFile -Encoding utf8

Write-Host ""
Write-Host "=====================================================" -ForegroundColor Green
Write-Host " RestaurantOS dev stack starting" -ForegroundColor Green
Write-Host "=====================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Frontend     http://localhost:3000"
Write-Host "  API Gateway  http://localhost:8080"
Write-Host "  Eureka       http://localhost:8761"
Write-Host "  RabbitMQ UI  http://localhost:15672"
Write-Host "  Mailpit      http://localhost:8025"
Write-Host ""
Write-Host "  Logs dir:    $LogDir"
Write-Host ""
Write-Host "  Services now run hidden in the background (no extra windows)."
Write-Host "  View a log live:   Get-Content $LogDir\gateway.log -Tail 50 -Wait"
Write-Host "  Available logs:    auth-service, authorization-service, user-service,"
Write-Host "                     platform-admin-service, audit-service, file-service,"
Write-Host "                     finance-service, pos-service, kitchen-service,"
Write-Host "                     inventory-service, gateway, frontend"
Write-Host "  Tail all at once:  Get-Content $LogDir\*.log -Tail 5"
Write-Host "  Stop everything:   .\scripts\start-dev.ps1 -Stop"
Write-Host ""
Write-Host "Services take 1-3 min to fully register in Eureka." -ForegroundColor Yellow
