# RestaurantOS — release stale Liquibase changelog locks before starting services.
#
# Liquibase takes a row lock in DATABASECHANGELOGLOCK for the duration of a migration and
# releases it on exit. A service killed mid-migration — which is exactly what start-dev.ps1 -Stop,
# a closed service window, or a crashed JVM does — never releases it. The next start then blocks
# on "Waiting for changelog lock..." and eventually fails, and the symptom (service never comes up,
# no error in its own log for minutes) points nowhere near the real cause.
#
# Referenced by start-dev.ps1 since the phase-09 commit but never committed alongside it, so every
# start-dev run aborted here with CommandNotFoundException.
#
# Safe to run any time: it only clears a lock that is currently held, and a lock held by a LIVE
# migration cannot exist here because this runs before any service is started.

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# Flyway services (finance, purchasing, pos, kitchen, inventory) have no lock table — Flyway uses
# its own locking and releases it differently. Only the Liquibase databases are listed.
$LiquibaseDatabases = @(
    "auth_db",       # auth-service + authorization-service
    "user_db",
    "platform_db",
    "audit_db",
    "file_db",
    "crm_db"
)

$pgUser = (Select-String -Path (Join-Path $RepoRoot 'deploy\.env') -Pattern '^POSTGRES_SUPERUSER=' |
    ForEach-Object { $_.Line.Split('=', 2)[1] })
if (-not $pgUser) {
    Write-Host "  Skipping Liquibase lock check: POSTGRES_SUPERUSER not found in deploy/.env" -ForegroundColor DarkYellow
    return
}

Write-Host ""
Write-Host "==> Releasing stale Liquibase locks" -ForegroundColor Cyan

# psql writes to stderr for conditions this script treats as normal (database or lock table not yet
# created). Under the caller's "Stop" preference that stderr would become a terminating error and
# take the whole stack launch with it, so a native command is judged by its exit code here.
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    foreach ($db in $LiquibaseDatabases) {
        $sql = @"
DO `$`$
BEGIN
    IF to_regclass('public.databasechangeloglock') IS NOT NULL THEN
        UPDATE databasechangeloglock
           SET locked = FALSE, lockgranted = NULL, lockedby = NULL
         WHERE locked;
        IF FOUND THEN
            RAISE NOTICE 'released';
        END IF;
    END IF;
END
`$`$;
"@
        $output = docker @('exec', '-i', 'restaurantos-postgres', 'psql', '-U', $pgUser, '-d', $db, '-q', '-v', 'ON_ERROR_STOP=1', '-c', $sql) 2>&1
        if ($LASTEXITCODE -ne 0) {
            # A database that does not exist yet is not an error worth stopping the stack for.
            Write-Host "  $db`: skipped (not reachable yet)" -ForegroundColor DarkYellow
        } elseif ($output -match 'released') {
            Write-Host "  $db`: released a stale changelog lock" -ForegroundColor Yellow
        }
    }
} finally {
    $ErrorActionPreference = $previousPreference
}

Write-Host "  Liquibase locks clear." -ForegroundColor Green
