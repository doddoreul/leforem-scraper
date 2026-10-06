#requires -Version 5.1

<#
    Installation de Python et de la dependance du projet.

        .\install.ps1

    Le script est idempotent : si Python est deja present et assez recent, il
    saute le telechargement et se contente d'installer requirements.txt.

        .\install.ps1 -SkipDependencies    # uniquement Python

    Le repertoire courant n'a aucune importance : requirements.txt est cherche
    par rapport a ce script. En revanche le script doit rester dans le dossier
    du projet, a cote de requirements.txt.
#>

param(
    # N'installe pas requests, pour reinstaller Python sans toucher a l'env.
    [switch]$SkipDependencies
)

$ErrorActionPreference = "Stop"

# La console Windows n'emet pas de l'UTF-8 par defaut : le "e" accentue du
# message de fin s'afficherait de travers. On force la sortie en UTF-8, ce que
# Windows 10 et 11 gèrent correctement.
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# 3.13 est la version cible du projet (.github/workflows/ci.yml, mypy.ini).
# Corriger le numero de patch ici, pas la ligne mineure.
$PythonVersion = "3.13.16"

$ProjectRoot = $PSScriptRoot
$Requirements  = Join-Path $ProjectRoot "requirements.txt"

function Info($msg)    { Write-Host $msg -ForegroundColor Cyan }
function Step($msg)    { Write-Host "-> $msg" -ForegroundColor Yellow }
function Ok($msg)      { Write-Host "OK  $msg" -ForegroundColor Green }
function Warn($msg)    { Write-Host "!!  $msg" -ForegroundColor Yellow }
function Die($msg)     { Write-Host "XX  $msg" -ForegroundColor Red; exit 1 }

function Read-CommandOutput($exePath, $exeArgs) {
    # Un interpreteur peut ecrire sur stderr. Avec $ErrorActionPreference = "Stop"
    # heritee du script, PowerShell transforme cela en erreur terminante avant que
    # 2>&1 ne fusionne, et l'appelant prendrait une detection reussie pour un
    # echec. On rabat la preference localement : la portee est cette fonction.
    $ErrorActionPreference = "Continue"
    $out = & $exePath @exeArgs 2>&1
    return (($out | ForEach-Object { "$_" }) -join "`n")
}

function Get-InstalledPython {
    # "python" puis le lanceur "py" : sur Windows, le lanceur est souvent la
    # seule chose presente quand le PATH n'a pas ete renseigne.
    foreach ($cmd in @("python", "py")) {
        $exe = Get-Command $cmd -ErrorAction SilentlyContinue
        if (-not $exe) { continue }

        # "python" peut designer l'alias Microsoft Store (WindowsApps), qui ouvre
        # le magasin au lieu de repondre. Ce n'est pas un interpreteur : l'ignorer.
        if ($exe.Source -like "*\Microsoft\WindowsApps\*") { continue }

        # On demande a l'interpreteur de s'executer plutot que de lire
        # "--version" : la sonde prouve du coup que la commande marche vraiment,
        # et stdout ne contient que les deux entiers attendus.
        $code = "import sys; print(sys.version_info[0]); print(sys.version_info[1])"
        $probeArgs = if ($cmd -eq "py") { @("-3", "-c", $code) } else { @("-c", $code) }

        $numbers = @(
            (Read-CommandOutput $exe.Source $probeArgs) -split "`n" |
                ForEach-Object { $_.Trim() } |
                Where-Object { $_ -match "^\d+$" }
        )
        if ($numbers.Count -lt 2) { continue }

        return [pscustomobject]@{
            Path    = $exe.Source
            Major   = [int]$numbers[0]
            Minor   = [int]$numbers[1]
            Command = $cmd
            # La commande a recopier telle quelle, lanceur compris.
            Invoke = if ($cmd -eq "py") { "py -3" } else { "python" }
        }
    }
    return $null
}

Write-Host ""
Info "=== Installation de Python $PythonVersion et des dependances ==="
Write-Host ""

# ---------------------------------------------------------------- Python present

$python = Get-InstalledPython
$minorWanted = [int]($PythonVersion.Split(".")[1])

if ($python) {
    Ok "Python $($python.Major).$($python.Minor) deja installe ($($python.Path))"
    $pythonExe    = $python.Path
    $pythonInvoke = $python.Invoke
} else {
    Write-Host "Aucun Python trouve dans le PATH." -ForegroundColor Yellow
    Write-Host ""

    # Admin seulement quand il y a vraiment a installer.
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $isAdmin   = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

    if (-not $isAdmin) {
        Die "Relance ce script depuis PowerShell en administrateur : clic droit sur PowerShell, puis Executer en tant qu'administrateur."
    }

    # PowerShell 5.1 demande TLS 1.2 pour parler a python.org. Sans cela le
    # telechargement echoue avec une erreur de securite peu explicite.
    [Net.ServicePointManager]::SecurityProtocol = `
        [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11

    if ([Environment]::Is64BitOperatingSystem) {
        $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }
    } else {
        $arch = "win32"
    }

    $url  = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-$arch.exe"
    $dest = Join-Path $env:TEMP "python-$PythonVersion-$arch.exe"

    Step "Telechargement ($arch) : $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    } catch {
        Die "Telechargement impossible : $($_.Exception.Message)"
    }

    # Un fichier de quelques octets est une page d'erreur, pas l'installeur.
    $size = (Get-Item $dest).Length
    if ($size -lt 5MB) {
        Remove-Item $dest -Force -ErrorAction SilentlyContinue
        Die "Fichier telecharge trop petit ($size octets) : ce n'est pas l'installeur. Verifie l'adresse."
    }
    Ok ("Installeur telecharge ({0:N1} Mo)" -f ($size / 1MB))

    # "3.13.16" -> "Python313", pour que le repertoire d'installation suive
    # la version au lieu de rester fige sur 3.13.
    $parts   = $PythonVersion.Split(".")
    $targetDir = Join-Path $env:ProgramFiles "Python$($parts[0])$($parts[1])"

    Step "Installation silencieuse dans $targetDir, quelques instants"
    try {
        $process = Start-Process -FilePath $dest -ArgumentList @(
            "/quiet"
            "InstallAllUsers=1"
            "PrependPath=1"
            "Include_pip=1"
            "Include_launcher=1"
            "Include_test=0"
            "AssociateFiles=0"
            "Shortcuts=0"
            "TargetDir=$targetDir"
        ) -Wait -PassThru -NoNewWindow
    } finally {
        Remove-Item $dest -Force -ErrorAction SilentlyContinue
    }

    # 0 = succes, 3010 = succes mais redemarrage conseille.
    if ($process.ExitCode -notin 0, 3010) {
        Die "L'installeur a echoue (code $($process.ExitCode)). Relance a la main pour voir le message : $url"
    }
    if ($process.ExitCode -eq 3010) {
        Warn "Installation reussie, mais Windows demande un redemarrage."
    }

    # Le PATH de la session courante ne voit pas l'installation : on va chercher
    # l'executable a son emplacement connu plutot que d'y croire.
    $pythonExe = Join-Path $targetDir "python.exe"
    if (-not (Test-Path $pythonExe)) {
        Die "Python installe mais introuvable a $pythonExe. Redemarre Windows puis relance."
    }
    Ok "Python installe ($pythonExe)"

    # La session courante n'a pas le nouveau PATH : c'est l'attendu, pas une erreur.
    Warn "Ouvre une nouvelle fenetre PowerShell pour que python soit reconnu."
    $pythonInvoke = "python"
}

if ($python -and $python.Minor -ne $minorWanted) {
    Warn "Version $($python.Major).$($python.Minor) installee alors que le projet vise 3.$minorWanted. La suite peut ne pas passer."
}

# ------------------------------------------------------------- dependance du projet

Write-Host ""
if ($SkipDependencies) {
    Info "Dependances ignorees (-SkipDependencies)."
} elseif (-not (Test-Path $Requirements)) {
    Warn "requirements.txt introuvable a $Requirements : dependance non installee."
} else {
    Step "Installation des dependances du projet (requirements.txt)"
    & $pythonExe -m pip install -r $Requirements
    if ($LASTEXITCODE -ne 0) {
        Die "Echec de l'installation des dependances (code $LASTEXITCODE)."
    }
    Ok "Dependances installees."
}

Write-Host ""
Write-Host "Python correctement installé, tapez 'serveur.py' pour lancer le logiciel" -ForegroundColor Green
Write-Host ""
Write-Host "La commande complete, dans ce dossier :" -ForegroundColor Cyan
Write-Host ""
Write-Host "    $pythonInvoke serveur.py" -ForegroundColor White
Write-Host ""
Write-Host "Le navigateur s'ouvre tout seul sur http://localhost:8123." -ForegroundColor Cyan
Write-Host ""
