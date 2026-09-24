# leforem-scraper

Scraper maison des offres Forem « Électromécanicien industriel » (province de Liège) + affichage local dans le navigateur.

## Usage

1. Scraper (données) :

```powershell
pip install requests
python scraper.py                          # incrémental : ne re-scrape que les offres nouvelles/modifiées
python scraper.py --fresh                  # force le re-scraping complet des détails
python scraper.py --limit 10               # se limiter à N annonces (astuce : à ne garder ensuite qu'un full run)
python scraper.py --metier-guid <GUID> --lieu-guid <GUID>   # changer métier / lieu (défaut = électromécanicien / Liège)
```

2. Afficher (déjà scrapé) :

```powershell
python -m http.server 8123
# puis ouvrir http://localhost:8123
```

## Fichiers

- `scraper.py` : seul script qui écrit les JSON (`data.json`, `historique_supprimees.json`). Ne génère jamais de HTML.
- `data.json` : offres actuelles (régénéré à chaque scraper ; ignoré par git).
- `historique_supprimees.json` : offres disparues (« supprimée le … ») ; ignoré par git.
- `index.html`, `style.css`, `script.js` : interface web (ne fait QUE lire les JSON).

## Notes

- Colonne « Salaire » : extraite par regex du champ `benefitsComments`. Présent seulement si l'employeur publie un chiffre.
- Données perso du navigateur (statuts, favoris, remarques) dans `localStorage` du navigateur, PAS dans git.
- Mode sombre : suit le thème du système.
- Rappel : vider `data.json` + `historique_supprimees.json` à la main si tu repars de zéro (normalement non requis).