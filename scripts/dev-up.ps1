# RestaurantOS — Windows dev-up (replaces `make dev-up` when GNU make is unavailable)
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\dev-env.ps1"

Push-Location "$PSScriptRoot\..\deploy"
try {
    if (-not (Test-Path ".env")) {
        Write-Error "deploy/.env missing. Run: bash deploy/generate-keys.sh"
    }

    $pgUser = (Select-String -Path ".env" -Pattern "^POSTGRES_SUPERUSER=" | ForEach-Object { $_.Line.Split("=", 2)[1] })
    $pgPass = (Select-String -Path ".env" -Pattern "^POSTGRES_SUPERUSER_PASSWORD=" | ForEach-Object { $_.Line.Split("=", 2)[1] })
    "postgres:5432:*:${pgUser}:${pgPass}" | Set-Content ".pgpass" -NoNewline

    # docker compose writes build progress to stderr; under EAP=Stop that aborts the script.
    # Run native docker calls under EAP=Continue and check $LASTEXITCODE explicitly instead.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    docker compose up -d --build 2>&1 | ForEach-Object { Write-Host $_ }
    $buildExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($buildExit -ne 0) { throw "docker compose up -d --build failed (exit $buildExit)" }

    Write-Host "Waiting for MinIO..."
    Start-Sleep -Seconds 15

    $bucket = (Select-String -Path ".env" -Pattern "^MINIO_BUCKET=" | ForEach-Object { $_.Line.Split("=", 2)[1] })
    $ErrorActionPreference = "Continue"
    docker compose exec -T minio sh -c "mc alias set local http://localhost:9000 `$MINIO_ROOT_USER `$MINIO_ROOT_PASSWORD && mc mb --ignore-existing local/$bucket" 2>&1 | ForEach-Object { Write-Host $_ }
    $ErrorActionPreference = $prevEAP

    & "$PSScriptRoot\ensure-dev-infra.ps1"

    Write-Host ""
    Write-Host "=== Stack started. Run: docker compose -f deploy/docker-compose.yml ps ===" -ForegroundColor Green
}
finally {
    Pop-Location
}
