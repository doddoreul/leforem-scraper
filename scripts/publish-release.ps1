# Publie la release GitHub (le tag vient de electron/package.json, donc
# v1.1.1) avec l'installeur et le portable, lus à la racine du projet.
# Reprend le brouillon existant s'il y en a un : le script peut être relancé
# sans dupliquer ni la release ni les assets.
# Le jeton vient du credential manager de Git (jamais affiché).
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# La version vient de electron/package.json, source unique de vérité.
$version = (Get-Content "electron\package.json" -Raw | ConvertFrom-Json).version
$tag = "v$version"
$owner = "doddoreul"
$repo = "leforem-scraper"
$assets = @(
    "LeForem-Scraper-$version-Setup.exe",
    "LeForem-Scraper-$version-Portable.exe"
)

# --- Jeton depuis le credential manager de Git ---
$cred = "protocol=https`nhost=github.com`n" | git credential fill
$token = ($cred | Select-String "^password=(.*)$").Matches.Groups[1].Value
if (-not $token) { throw "Pas de jeton disponible pour github.com" }

$headers = @{
    Authorization = "Bearer $token"
    Accept        = "application/vnd.github+json"
}
$api = "https://api.github.com/repos/$owner/$repo"

# --- Release : prend le brouillon du tag courant s'il existe, sinon le crée ---
$existing = Invoke-RestMethod -Uri "$api/releases?per_page=100" -Headers $headers |
    Where-Object { $_.tag_name -eq $tag } | Select-Object -First 1

if ($existing) {
    $release = $existing
    Write-Host "Brouillon/release existant : $($release.html_url)"
} else {
    $body = @{
        tag_name = $tag
        name = "LeForem Scraper $version"
        target_commitish = "go-electron"
        draft = $true
        prerelease = $false
        body = @"
## Le scraper leforem.be en application de bureau Windows

**Aucun prérequis** : Python, Electron et le navigateur sont embarqués dans
le fichier. Double-clic, c'est tout.

### Choix du format

| Fichier | Usage |
|---|---|
| ``LeForem-Scraper-$version-Setup.exe`` | **Installeur** : assistant, raccourcis bureau + menu Démarrer |
| ``LeForem-Scraper-$version-Portable.exe`` | **Portable** : clé USB ou dossier, aucune installation |

### Données

Elles sont conservées dans ``%APPDATA%\LeForem Scraper\data`` (rien n'est
effacé lors d'une désinstallation).
"@
    } | ConvertTo-Json
    $release = Invoke-RestMethod -Method Post -Uri "$api/releases" `
        -Headers $headers -ContentType "application/json" -Body $body
    Write-Host "Release créée (brouillon) : $($release.html_url)"
}

# --- Upload des artefacts (reprise si un asset est déjà présent) ---
foreach ($asset in $assets) {
    $path = Join-Path $root $asset
    if (-not (Test-Path $path)) { Write-Warning "Manquant, ignoré : $asset"; continue }

    $oldAsset = $release.assets | Where-Object { $_.name -eq $asset } | Select-Object -First 1
    if ($oldAsset) {
        Write-Host "Asset déjà présent ($asset), suppression puis re-upload ..."
        Invoke-RestMethod -Method Delete -Uri "$api/releases/assets/$($oldAsset.id)" `
            -Headers $headers | Out-Null
    }

    Write-Host "Upload de $asset ..."
    $uploadUrl = $release.upload_url -replace "\{\?name,label\}", "?name=$asset"
    $uploaded = Invoke-RestMethod -Method Post -Uri $uploadUrl `
        -Headers $headers -ContentType "application/octet-stream" `
        -InFile $path
    Write-Host "  -> asset $($uploaded.id) ($($uploaded.size) octets)"
}

# --- Publication (fin de brouillon ; crée aussi le tag de la version) ---
if ($release.draft) {
    $published = Invoke-RestMethod -Method Patch -Uri "$api/releases/$($release.id)" `
        -Headers $headers -ContentType "application/json" `
        -Body (@{ draft = $false } | ConvertTo-Json)
    Write-Host "Release publiée : $($published.html_url)"
} else {
    Write-Host "Release déjà publiée : $($release.html_url)"
}