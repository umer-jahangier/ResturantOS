# RestaurantOS dev infrastructure (Postgres + RabbitMQ + Redis) hosted in WSL - no Docker.
#
# Why not docker-compose: the EnterpriseDB Windows builds cannot be downloaded programmatically
# (EDB returns 403 to every client), and this box runs legacy inbox WSL with no systemd, so a
# Docker daemon has to be started by hand and dies whenever the VM is reclaimed. Running the
# three services directly inside the distro is fewer moving parts and survives on an 8GB host.
#
# Docker is still required for the Testcontainers integration tests - this is only for dev-run.
#
# Usage: powershell -File scripts/start-infra.ps1 [-Stop] [-Status]

param(
    [switch]$Stop,
    [switch]$Status
)

$ErrorActionPreference = "Stop"
$Distro = "RestaurantOS-Ubuntu"

$action = "start"
if ($Stop)   { $action = "stop" }
if ($Status) { $action = "status" }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$wslRepo = wsl -d $Distro wslpath -a "$repoRoot"
$script = "$wslRepo/scripts/wsl-infra.sh"

Write-Host "==> infra $action (WSL: $Distro)" -ForegroundColor Cyan
wsl -d $Distro -u root -- bash $script $action

if ($action -eq "stop") { return }

# The services are only useful if Windows can actually reach them. WSL forwards localhost only
# for IPv4-bound sockets, so verify rather than assume.
Write-Host ""
Write-Host "==> reachability from Windows" -ForegroundColor Cyan
$ports = [ordered]@{ "postgres" = 5432; "rabbitmq" = 5672; "rabbit-ui" = 15672; "redis" = 6379 }
$allOk = $true
foreach ($name in $ports.Keys) {
    $port = $ports[$name]
    $ok = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet -WarningAction SilentlyContinue
    if (-not $ok) { $allOk = $false }
    $state = if ($ok) { "OK" } else { "UNREACHABLE" }
    $colour = if ($ok) { "Green" } else { "Red" }
    Write-Host ("  {0,-10} 127.0.0.1:{1,-6} {2}" -f $name, $port, $state) -ForegroundColor $colour
}

Write-Host ""
if ($allOk) {
    Write-Host "Infra ready. Start services with: powershell -File scripts/start-dev.ps1" -ForegroundColor Green
    Write-Host "RabbitMQ UI: http://localhost:15672" -ForegroundColor DarkGray
} else {
    Write-Warning "Some ports are unreachable. A listener bound to the IPv6 wildcard (*:port) is NOT forwarded by WSL - it must bind 0.0.0.0."
}
