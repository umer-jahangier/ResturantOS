<#
.SYNOPSIS
    Windows launcher for scripts/seed_restaurantos.py — the authoritative RestaurantOS seed.

.DESCRIPTION
    This is a LAUNCHER, not a reimplementation, and that is a deliberate decision recorded in
    13-15-PLAN.md. A PowerShell twin of a 1,700-line seeder would be a second implementation of
    the same rules, and the two would drift — which is the exact class of failure this phase
    exists to close. The seeding logic lives in ONE place; this file resolves an interpreter and
    forwards every argument to it verbatim.

    Everything the Python script needs is in the standard library. No pip install is required,
    and none should be performed: the phase threat register (T-13-15-SC) forbids installing a
    package to make a verification script run.

.PARAMETER Args
    Passed straight through. See `python scripts\seed_restaurantos.py --help`.

.EXAMPLE
    .\scripts\seed_restaurantos.ps1
    Run every phase: platform, personas, business data, verification.

.EXAMPLE
    .\scripts\seed_restaurantos.ps1 --phase verify
    Re-run only the verification loop. Exits non-zero, naming every principal that cannot log in.

.EXAMPLE
    .\scripts\seed_restaurantos.ps1 --corrupt-persona cashier@saffron.local
    Deliberately break one persona so the next --phase verify must fail and must name it.

.NOTES
    Credentials produced by this script are DEVELOPMENT-ONLY and are documented in
    scripts\README-seed.md. Rotate every one of them before any deployment.

    Requires: Python 3.9+, Docker (only for the two RECOVERY paths and --corrupt-persona, which
    reach the database through `docker exec restaurantos-postgres psql`), and a running dev
    stack reachable at $env:GATEWAY (default http://localhost:8080).
#>

[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
)

$ErrorActionPreference = 'Stop'

# Resolve the repo root from THIS FILE's location, not from the current directory. A launcher
# that depends on where it was invoked from is a launcher that silently seeds nothing when it is
# run from anywhere but the repo root — the same failure mode scripts/e2e/_phase13-lib.sh
# documents for its own root resolution.
$RepoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Seeder = Join-Path $RepoRoot 'scripts\seed_restaurantos.py'

if (-not (Test-Path -LiteralPath $Seeder)) {
    Write-Error "Could not find $Seeder. Run this from inside the RestaurantOS checkout."
    exit 2
}

# `python3` first, because that is what the repo's other Python entry points assume and what the
# documentation names. `py -3` is the Windows launcher and is tried before the bare `python`,
# which on a Windows box with the Store alias installed opens the Microsoft Store instead of
# running anything — a failure that looks like the script hanging.
$Interpreter = $null
$InterpreterArgs = @()

foreach ($candidate in @('python3', 'python')) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.CommandType -ne 'Application') { continue }
    if ($cmd) {
        try {
            $version = & $cmd.Source '-c' 'import sys; print(sys.version_info[0])' 2>$null
            if ($LASTEXITCODE -eq 0 -and $version -eq '3') {
                $Interpreter = $cmd.Source
                break
            }
        } catch {
            # Store alias or a shim that is not really an interpreter — keep looking.
        }
    }
}

if (-not $Interpreter) {
    $py = Get-Command 'py' -ErrorAction SilentlyContinue
    if ($py) {
        $Interpreter = $py.Source
        $InterpreterArgs = @('-3')
    }
}

if (-not $Interpreter) {
    Write-Error @'
No Python 3 interpreter found.

Install it with one of:
    winget install Python.Python.3.12
    choco install python

then re-run this script. The seeder needs only the standard library — do NOT pip install
anything to make it work; if it reports a missing module, that is a defect to report, not a
package to install (T-13-15-SC).
'@
    exit 2
}

Write-Host "RestaurantOS seed — using $Interpreter" -ForegroundColor DarkGray
Write-Host "  gateway: $(if ($env:GATEWAY) { $env:GATEWAY } else { 'http://localhost:8080 (default)' })" -ForegroundColor DarkGray
Write-Host ''

# & with a splatted array so an argument containing a space survives; $LASTEXITCODE is forwarded
# so a caller (CI, or scripts\e2e\phase13-acceptance.sh under WSL) sees the seeder's own result
# rather than this launcher's.
& $Interpreter @InterpreterArgs $Seeder @Args
exit $LASTEXITCODE
