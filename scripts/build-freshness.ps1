# RestaurantOS — is a built jar still current, and how little can we build to fix it?
#
# Dot-sourced by start-dev.ps1 and restart-service.ps1. Answers two separate questions that were
# previously conflated:
#
#   Test-BootJar     — is this jar RUNNABLE? (has a Main-Class)
#   Test-ModuleStale — is this jar CURRENT?  (newer than everything it was built from)
#
# Only the first was ever asked, so -SkipBuild would happily launch an 11-day-old build. Every
# symptom then points at the wrong place: a controller added last week 404s, and the caller reports
# the callee as unreachable — which, from where it stands, is true. Two debugging sessions went
# looking for an outage that was only ever a stale artifact.

# Latest LastWriteTime under any of $Paths, or [datetime]::MinValue if none exist.
function Get-NewestWriteTime([string[]]$Paths) {
    $existing = $Paths | Where-Object { $_ -and (Test-Path $_) }
    if (-not $existing) { return [datetime]::MinValue }
    $newest = Get-ChildItem -Path $existing -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($newest) { return $newest.LastWriteTime }
    return [datetime]::MinValue
}

function Get-ModuleJarPath([string]$RepoRoot, [string]$MavenModule) {
    $artifact = Split-Path $MavenModule -Leaf
    return Join-Path $RepoRoot "$MavenModule/target/$artifact-1.0.0.jar"
}

<#
.SYNOPSIS
Has shared-lib changed since it was last packaged?

.DESCRIPTION
This is the one dependency every service compiles against, and the reason the build scripts pass
-am. Checking it separately is what lets everything else build NARROWLY: if shared-lib is already
packaged and current, rebuilding a service does not need to touch it.

Deliberately compares against shared-lib's own target jar rather than the copy in ~/.m2 — Maven
installs from target, so target is the earlier signal and the conservative one to trust.
#>
function Test-SharedLibStale([string]$RepoRoot) {
    $jar = Join-Path $RepoRoot "shared-lib/target/shared-lib-1.0.0.jar"
    if (-not (Test-Path $jar)) { return $true }
    $src = Get-NewestWriteTime @((Join-Path $RepoRoot "shared-lib/src/main"),
                                 (Join-Path $RepoRoot "shared-lib/pom.xml"))
    return (Get-Item $jar).LastWriteTime -lt $src
}

<#
.SYNOPSIS
Does this module's jar predate the module's OWN sources?

.DESCRIPTION
Scoped deliberately to the module's own code, because this is the check that FORCES a rebuild and
it should fire on exactly one thing: you wrote code that is not in the running jar. That is the
failure that has actually bitten — a controller added days ago missing from the deployed build,
404ing, and reading to its caller as an outage.

Being behind shared-lib is a real but much weaker signal, and treating the two the same made 11 of
15 modules "stale" at once — which is a full-stack rebuild wearing an incremental build's clothes.
It lives in Test-ModuleBehindSharedLib instead, as an advisory.
#>
function Test-ModuleStale([string]$RepoRoot, [string]$MavenModule) {
    $jar = Get-ModuleJarPath $RepoRoot $MavenModule
    if (-not (Test-Path $jar)) { return $true }
    $ownSources = Get-NewestWriteTime @((Join-Path $RepoRoot "$MavenModule/src/main"),
                                        (Join-Path $RepoRoot "$MavenModule/pom.xml"))
    return (Get-Item $jar).LastWriteTime -lt $ownSources
}

<#
.SYNOPSIS
Was this module packaged before the shared-lib it bundles?

.DESCRIPTION
Advisory only — it never forces a build. A Spring Boot fat jar BUNDLES its dependencies, so a
service packaged before shared-lib changed really is carrying the older copy. But that is true of
most of the stack most of the time, and forcing it would rebuild everything whenever shared-lib is
touched. Reported so the choice is visible and deliberate rather than made silently either way.
#>
function Test-ModuleBehindSharedLib([string]$RepoRoot, [string]$MavenModule) {
    $jar = Get-ModuleJarPath $RepoRoot $MavenModule
    if (-not (Test-Path $jar)) { return $false }
    $sharedJar = Join-Path $RepoRoot "shared-lib/target/shared-lib-1.0.0.jar"
    if (-not (Test-Path $sharedJar)) { return $false }
    if (Test-SharedLibStale $RepoRoot) { return $true }
    return (Get-Item $jar).LastWriteTime -lt (Get-Item $sharedJar).LastWriteTime
}

<#
.SYNOPSIS
The narrowest Maven argument list that will correctly rebuild this module.

.DESCRIPTION
-am ("also make") rebuilds every upstream module, which for a service means shared-lib and the
parent poms — on every single-service restart. It is only NEEDED when an upstream module has
actually changed. When shared-lib is current, -pl on its own resolves it from the local repository
and the build is a fraction of the work.

Returns the args only; the caller runs mvn so its own error handling stays in one place.
#>
function Get-ModuleBuildArgs([string]$RepoRoot, [string]$MavenModule) {
    if (Test-SharedLibStale $RepoRoot) {
        # shared-lib must be rebuilt and installed first, so pull it into this build.
        return @("-pl", $MavenModule, "-am", "-DskipTests", "package", "-q")
    }
    return @("-pl", $MavenModule, "-DskipTests", "package", "-q")
}

<#
.SYNOPSIS
Human-readable reason a module is being rebuilt, for the one line the script prints.
#>
function Get-StaleReason([string]$RepoRoot, [string]$MavenModule) {
    $jar = Get-ModuleJarPath $RepoRoot $MavenModule
    if (-not (Test-Path $jar)) { return "no jar built yet" }
    return "jar is older than its own sources"
}
