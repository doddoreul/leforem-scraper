# Publie la release GitHub (v1.0.0) avec l'installeur et la version portable,
# lus à la racine du projet. Le jeton vient du gestionnaire de credentials de
# Git (jamais affiché, jamais stocké dans le dépôt).
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$version = "1.0.0"
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

# --- Création de la release (brouillon) ---
$body = @{
    tag_name         = $tag
    name             = "LeForem Scraper $version"
    target_commitish = "go-electron"
    draft            = $true
    prerelease       = $false
    body             = @"
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

# --- Upload des artefacts ---
foreach ($asset in $assets) {
    $path = Join-Path $root $asset
    if (-not (Test-Path $path)) { Write-Warning "Manquant, ignoré : $asset"; continue }
    Write-Host "Upload de $asset ..."
    $uploadUrl = $release.upload_url -replace "\{\?name,label\}", "?name=$asset"
    Invoke-RestMethod -Method Post -Uri $uploadUrl `
        -Headers $headers -ContentType "application/octet-stream" `
        -InFile $path | Out-Null
    Write-Host "  -> OK"
}

# --- Publication (fin de brouillon) ---
$publish = Invoke-RestMethod -Method Patch -Uri "$api/releases/$($release.id)" `
    -Headers $headers -ContentType "application/json" `
    -Body (@{ draft = $false } | ConvertTo-Json)
Write-Host "Release publiée : $($publish.html_url)"