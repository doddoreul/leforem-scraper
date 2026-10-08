# Builds the self-contained backend (serveur.py + Python 3.13 + requests) into
# build/backend/leforem-backend.exe. The Electron shell ships this folder as
# an extra resource, so the user never installs Python.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> Installation de PyInstaller"
python -m pip install --quiet --upgrade pyinstaller

Write-Host "==> Build du backend (serveur.py)"
# Chemins absolus : avec --specpath, PyInstaller résout les sources de
# --add-data par rapport au dossier du spec. Sortie dans electron/build/
# pour que l'app Electron embarque le dossier tel quel.
python -m PyInstaller `
    --noconfirm --clean `
    --onedir `
    --name leforem-backend `
    --distpath "electron/build/backend" `
    --workpath "build/pyinstaller" `
    --specpath "build/spec" `
    --add-data "$root\index.html;." `
    --add-data "$root\html;html" `
    --add-data "$root\css;css" `
    --add-data "$root\js;js" `
    --hidden-import python.storage.sqlite_store `
    --hidden-import python.storage.json_store `
    --hidden-import python.migrate_to_sqlite `
    --hidden-import python.employers `
    serveur.py

$backendExe = "electron/build/backend/leforem-backend/leforem-backend.exe"
if (-not (Test-Path $backendExe)) {
    throw "Le backend n'a pas été produit"
}
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller a échoué (code $LASTEXITCODE)"
}

Write-Host "==> Backend prêt : $backendExe"