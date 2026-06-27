# Restart (or build) a single dev service.
# Usage:
#   .\scripts\restart-service.ps1 auth-service
#   .\scripts\restart-service.ps1 auth-service -SkipBuild
#   .\scripts\restart-service.ps1 auth-service -BuildOnly
#   .\scripts\restart-service.ps1 -List

param(
    [Parameter(Position = 0)]
    [string]$Name,
    [switch]$SkipBuild,
    [switch]$BuildOnly,
    [switch]$List
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogDir = Join-Path $RepoRoot ".dev-logs"

$Services = [ordered]@{
    "frontend"                = @{ Port = 3000; Module = $null; Type = "frontend" }
    "gateway"                 = @{ Port = 8080; Module = "gateway" }
    "auth-service"            = @{ Port = 8081; Module = "services/auth-service" }
    "user-service"            = @{ Port = 8082; Module = "services/user-service" }
    "authorization-service"   = @{ Port = 8083; Module = "services/authorization-service" }
    "finance-service"         = @{ Port = 8086; Module = "services/finance-service" }
    "audit-service"           = @{ Port = 8093; Module = "services/audit-service" }
    "file-service"            = @{ Port = 8095; Module = "services/file-service" }
    "platform-admin-service"  = @{ Port = 8096; Module = "services/platform-admin-service" }
}

function Stop-PortListener([int]$Port) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
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

function Build-Service([string]$ServiceName, [hashtable]$Svc) {
    if ($Svc.Type -eq "frontend") {
        Write-Host "Frontend has no jar build. Use: cd frontend; pnpm dev" -ForegroundColor Yellow
        return
    }
    Write-Host "==> Building $ServiceName..." -ForegroundColor Cyan
    Push-Location $RepoRoot
    mvn -pl $Svc.Module -am -DskipTests package -q
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Write-Error "Maven build failed for $ServiceName"
    }
    Pop-Location
    $artifact = Split-Path $Svc.Module -Leaf
    $jarPath = Join-Path $RepoRoot "$($Svc.Module)/target/$artifact-1.0.0.jar"
    if (-not (Test-BootJar $jarPath)) {
        Write-Error "Expected executable Spring Boot jar at $jarPath"
    }
    Write-Host "Built $jarPath" -ForegroundColor Green
}

function Start-Service([string]$ServiceName, [hashtable]$Svc) {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $logFile = Join-Path $LogDir "$ServiceName.log"

    if ($Svc.Type -eq "frontend") {
        if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
            $pnpmCmd = "D:\tools\pnpm-global\pnpm.cmd"
            if (Test-Path $pnpmCmd) { $env:Path = "D:\tools\pnpm-global;$env:Path" }
            else { Write-Error "pnpm not found" }
        }
        $cmd = @"
Set-Location '$RepoRoot\frontend'
`$Host.UI.RawUI.WindowTitle = 'RestaurantOS - frontend'
if (-not (Test-Path node_modules)) { pnpm install }
pnpm dev *>&1 | Tee-Object -FilePath '$logFile'
"@
    } else {
        $artifact = Split-Path $Svc.Module -Leaf
        $jarPath = Join-Path $RepoRoot "$($Svc.Module)/target/$artifact-1.0.0.jar"
        if (-not (Test-BootJar $jarPath)) {
            Write-Error "Missing boot jar at $jarPath. Run without -SkipBuild."
        }
        $cmd = @"
Set-Location '$RepoRoot'
. '$PSScriptRoot\dev-env.ps1'
. '$PSScriptRoot\local-service-env.ps1'
`$Host.UI.RawUI.WindowTitle = 'RestaurantOS - $ServiceName'
java -jar '$jarPath' *>&1 | Tee-Object -FilePath '$logFile'
"@
    }

    $proc = Start-Process powershell -PassThru -WindowStyle Hidden -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cmd
    )
    Write-Host "Started $ServiceName on port $($Svc.Port) (PID $($proc.Id)) -> $logFile" -ForegroundColor Green
}

if ($List) {
    Write-Host "Available services:" -ForegroundColor Cyan
    $Services.GetEnumerator() | ForEach-Object {
        Write-Host ("  {0,-24} port {1}" -f $_.Key, $_.Value.Port)
    }
    exit 0
}

if (-not $Name) {
    Write-Host "Usage: .\scripts\restart-service.ps1 <name> [-SkipBuild] [-BuildOnly]" -ForegroundColor Yellow
    Write-Host "       .\scripts\restart-service.ps1 -List" -ForegroundColor Yellow
    exit 1
}

$key = $Name.ToLower()
if (-not $Services.Contains($key)) {
    Write-Error "Unknown service '$Name'. Run: .\scripts\restart-service.ps1 -List"
}

$svc = $Services[$key]

if (-not $BuildOnly) {
    Write-Host "==> Stopping $key (port $($svc.Port))..." -ForegroundColor Cyan
    Stop-PortListener $svc.Port
    Start-Sleep -Seconds 1
}

if (-not $SkipBuild -or $BuildOnly) {
    Build-Service $key $svc
}

if ($BuildOnly) { exit 0 }

Start-Service $key $svc
