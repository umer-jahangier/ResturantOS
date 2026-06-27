# Generate TOTP for a dev user (owner@demo.local by default).
# Usage:
#   .\scripts\generate_totp.ps1
#   .\scripts\generate_totp.ps1 owner@demo.local
#   .\scripts\generate_totp.ps1 owner@demo.local -Enroll

param(
    [Parameter(Position = 0)]
    [string]$Email = "owner@demo.local",
    [switch]$Enroll
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Python = Get-Command python -ErrorAction SilentlyContinue
if (-not $Python) {
    $Python = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $Python) {
    Write-Error "Python not found. Install Python 3 and: pip install psycopg2-binary pyotp cryptography"
}

$Args = @("$ScriptDir\generate_totp.py", $Email)
if ($Enroll) { $Args += "--enroll" }

& $Python.Source @Args
