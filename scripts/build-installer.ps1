# Build l'installeur Windows et la version portable.
# Sortie : LeForem-Scraper-<version>-Setup.exe et -Portable.exe à la racine.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> [1/3] Backend Python autonome"
& (Join-Path $PSScriptRoot "build-backend.ps1")
if ($LASTEXITCODE -ne 0) { throw "build-backend a échoué" }

Write-Host "==> [2/3] Dépendances Electron"
Set-Location (Join-Path $root "electron")
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install a échoué" }

Write-Host "==> [3/3] Installeur NSIS + version portable"
npm run dist
if ($LASTEXITCODE -ne 0) { throw "electron-builder a échoué" }

Set-Location $root

# Les deux versions à la racine du projet, pour que l'utilisateur choisisse.
$artifacts = Get-ChildItem "electron\dist\LeForem-Scraper-*.exe"
foreach ($artifact in $artifacts) {
    Copy-Item $artifact.FullName -Destination (Join-Path $root $artifact.Name) -Force
    Write-Host "==> $($artifact.Name) ($([math]::Round($artifact.Length / 1MB, 1)) Mo) -> racine du projet"
}