# Build l'installeur Windows complet (backend Python + app Electron).
# Sortie : electron/dist/LeForem-Scraper-<version>-Setup.exe
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

Write-Host "==> [3/3] Installeur NSIS"
npm run dist
if ($LASTEXITCODE -ne 0) { throw "electron-builder a échoué" }

Set-Location $root
Get-ChildItem "electron\dist\*.exe" | ForEach-Object {
    Write-Host "==> Installeur : electron\dist\$($_.Name) ($([math]::Round($_.Length / 1MB, 1)) Mo)"
}