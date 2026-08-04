# RestaurantOS - Windows equivalent of the "render RabbitMQ definitions" step in
# scripts/dev-stack-up.sh (bash-only, and it shells out to python3).
#
# Phase 12 replaced the committed deploy/init/rabbitmq-definitions.json with a
# rabbitmq-definitions.template.json plus a render step, so the real file is gitignored (it
# carries a password hash). docker-compose still bind-mounts the RENDERED path:
#
#   ./init/rabbitmq-definitions.json:/etc/rabbitmq/definitions.json:ro
#
# If it is absent when compose starts, Docker helpfully creates a DIRECTORY at that path.
# RabbitMQ then loads no definitions at all: the declarative "restaurantos" user never exists,
# and every service fails to connect with ACCESS_REFUSED. Nothing on the Windows path
# (start-dev.ps1 -> dev-up.ps1 -> ensure-dev-infra.ps1) rendered it, so this script exists to
# close that gap. Idempotent: safe to re-run, and re-runs simply mint a fresh salt.

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DeployDir = Join-Path $RepoRoot "deploy"
$Template = Join-Path $DeployDir "init\rabbitmq-definitions.template.json"
$Rendered = Join-Path $DeployDir "init\rabbitmq-definitions.json"
$EnvFile = Join-Path $DeployDir ".env"

if (-not (Test-Path $Template)) { Write-Error "Missing $Template" }
if (-not (Test-Path $EnvFile)) { Write-Error "deploy/.env missing. Run: bash deploy/generate-keys.sh" }

$rmqUser = (Select-String -Path $EnvFile -Pattern '^RABBITMQ_USERNAME=' |
    ForEach-Object { $_.Line.Split('=', 2)[1] } | Select-Object -First 1)
$rmqPass = (Select-String -Path $EnvFile -Pattern '^RABBITMQ_PASSWORD=' |
    ForEach-Object { $_.Line.Split('=', 2)[1] } | Select-Object -First 1)
if ([string]::IsNullOrWhiteSpace($rmqUser) -or [string]::IsNullOrWhiteSpace($rmqPass)) {
    Write-Error "RABBITMQ_USERNAME / RABBITMQ_PASSWORD missing from deploy/.env"
}

# RabbitMQ's default rabbit_password_hashing_sha256:
#   salt = 4 random bytes; hash = base64( salt || sha256( salt || utf8(password) ) )
$salt = New-Object byte[] 4
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
$sha = [System.Security.Cryptography.SHA256]::Create()
$digest = $sha.ComputeHash($salt + [System.Text.Encoding]::UTF8.GetBytes($rmqPass))
$hash = [Convert]::ToBase64String($salt + $digest)

$content = Get-Content -Raw $Template
$content = $content.Replace('@@RABBITMQ_USERNAME@@', $rmqUser).Replace('@@RABBITMQ_PASSWORD_HASH@@', $hash)
if ($content -notmatch '"users"') { Write-Error "Render failed: template has no users block." }

# RabbitMQ parses this as JSON; a UTF-8 BOM (what Set-Content -Encoding utf8 writes on PS 5.1)
# makes the parse fail. Write the bytes without one.
[System.IO.File]::WriteAllText($Rendered, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  Rendered deploy/init/rabbitmq-definitions.json for user '$rmqUser'." -ForegroundColor Green
