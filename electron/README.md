# Coque de bureau Electron

L'application est un conteneur : elle ne réécrit rien du scraper. Elle lance
`serveur.py` (embarqué par **PyInstaller**) comme processus enfant, attend que le
port réponde, puis ouvre une fenêtre sur `http://localhost:<port>`.

```
serveur.py --PyInstaller--> electron/build/backend/leforem-backend/leforem-backend.exe
                                              |
main.js (Electron) --spawn--> backend exe     |  LEFOREM_PORT / LEFOREM_DATA_DIR / LEFOREM_NO_BROWSER
                                              v
                              fenêtre Electron -> http://localhost:<port>
```

## Layout

| Chemin | Rôle |
|---|---|
| `main.js` | Cycle de vie : port libre, spawn du backend, poll, fenêtre, arrêt, IPC de mise à jour |
| `preload.js` | Pont sécurisé exposé à la page (`window.leforemUpdater`) |
| `update-check.js` | Interroge l'API GitHub des releases et compare les versions (tests : `tests/test_update_check.py`) |
| `package.json` | Version de l'application (source de vérité) et configuration electron-builder |
| `build/backend/` | Sortie PyInstaller (générée, ignorée par git) |
| `dist/` | Installeurs produits par electron-builder (générée, ignorée par git) |

## Conventions d'environnement (côté Python)

Le backend lit les variables posées par la coque :

| Variable | Rôle |
|---|---|
| `LEFOREM_PORT` | Port HTTP (libre, choisi par `main.js`) |
| `LEFOREM_DATA_DIR` | Dossier des données, `%APPDATA%\LeForem Scraper\data` |
| `LEFOREM_NO_BROWSER` | Ne pas ouvrir le navigateur (Electron s'en charge) |
| `LEFOREM_REPORT_URL` | Imprimer `LEFOREM_URL=...` sur stdout |

## Reconstruire

```powershell
# Tout d'un coup : backend + app + installeur NSIS
..\scripts\build-installer.ps1

# Ou pièce par pièce
..\scripts\build-backend.ps1   # emballage Python (régénère python/version.py)
npm run pack                   # dossier portable electron/dist/win-unpacked
npm run dist                   # installeur + portable (electron/dist/*.exe)
```

Les deux fichiers `Setup` et `Portable` sont ensuite copiés à la **racine
du projet** par le script de build, pour que l'utilisateur choisisse sa forme.

## Développer sans rebuild

Sans `build/backend/`, `main.js` retombe sur `python serveur.py` à la racine du
dépôt : on peut travailler dans le navigateur classique, ou avec la coque
(`npm start`).

## La suite (idées)

- Icône d'application (`.ico`, placée dans un dossier `resources/`)
- Signature de code pour limiter les avertissements SmartScreen et antivirus
