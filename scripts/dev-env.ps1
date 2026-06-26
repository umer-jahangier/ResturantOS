# RestaurantOS — D-drive dev environment (Windows PowerShell)
# Dot-source in a session:  . D:\GitHub\ResturantOS\scripts\dev-env.ps1

$env:JAVA_HOME = "D:\jdk25"
$env:MAVEN_HOME = "D:\tools\apache-maven"
$env:PNPM_HOME = "D:\tools\pnpm-global"
$env:Path = @(
    "$env:JAVA_HOME\bin",
    "$env:MAVEN_HOME\bin",
    "$env:PNPM_HOME",
    "D:\Git\usr\bin",
    "D:\Git\cmd",
    "D:\Miniconda\Library\bin",
    $env:Path
) -join ";"

Write-Host "RestaurantOS dev env loaded (JDK 25, Maven, pnpm on D:)" -ForegroundColor Green
Write-Host "  JAVA_HOME=$env:JAVA_HOME"
Write-Host "  MAVEN_HOME=$env:MAVEN_HOME"
