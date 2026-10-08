# Coque de bureau Electron

L'application est un conteneur : elle ne réécrit rien du scraper. Elle lance
`serveur.py` (embarqué par **PyInstaller**) comme process enfant, attend que le
port réponde, puis ouvre une fenêtre sur `http://localhost:<port>`.

```
serveur.py ──PyInstaller──▶ electron/build/backend/leforem-backend/leforem-backend.exe
                                              │
main.js (Electron) ──spawn──▶ backend exe ────┤  LEFOREM_PORT / LEFOREM_DATA_DIR / LEFOREM_NO_BROWSER
                                              ▼
                              fenêtre Electron ▶ http://localhost:<port>
```

## Layout

| Chemin | Rôle |
|---|---|
| `main.js` | Cycle de vie : port libre, spawn du backend, poll, fenêtre, arrêt |
| `build/backend/` | Sortie PyInstaller (générée, ignorée par git) |
| `dist/` | Installeurs produits par electron-builder (générée) |
| `resources/` | Icons, assets de build (à venir) |

## Conventions d'environnement (côté Python)

Le backend lit les variables posées par la coque — les mêmes conventions que
`LEFOREM_STORAGE` :

| Variable | Rôle |
|---|---|
| `LEFOREM_PORT` | Port HTTP (libre, choisi par `main.js`) |
| `LEFOREM_DATA_DIR` | Dossier des données → `%LOCALAPPDATA%\leforem-scraper\data` |
| `LEFOREM_NO_BROWSER` | Ne pas ouvrir le navigateur (Electron s'en charge) |
| `LEFOREM_REPORT_URL` | Imprimer `LEFOREM_URL=...` sur stdout |

## Reconstruire

```powershell
# Tout d'un coup : backend + app + installeur NSIS
..\scripts\build-installer.ps1

# Ou pièce par pièce
..\scripts\build-backend.ps1   # emballage Python
npm run pack                   # dossier portable electron/dist/win-unpacked
npm run dist                   # installeur electron/dist/*.exe
npm run dist:portable          # exe portable sans installation
```

## Développer sans rebuild

Sans `build/backend/`, `main.js` retombe sur `python serveur.py` à la racine du
dépôt — tu peux donc travailler dans le navigateur classique comme avant, ou
avec la coque (`npm start`).

## La suite (idées)

- Icône d'application (`.ico`, générée puis placée dans `resources/`)
- Signature de code pour limiter les avertissements d'antivirus
- Fond d'écran « écran de chargement » pendant le démarrage du serveur