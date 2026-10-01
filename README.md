# Forem Offers Scraper

> Récupère automatiquement les offres d'emploi publiées sur le site du Forem
> et les affiche dans une petite page web chez toi (sur ton PC), avec des
> menus pour suivre tes candidatures.

---

# Partie 1 — Démarrage rapide (pour les débutants)

## Étape 1 — Vérifier que Python est installé

Appuie sur la touche `Windows`, tape `powershell`, puis Entrée. Dans le terminal
qui s'ouvre, tape :

```
python --version
```

- **Si tu vois un numéro** du genre `Python 3.12.x` : tout est bon, passe à
  l'étape 2.
- **Si tu vois une erreur** : essaie `py --version`. Si `py` fonctionne, remplace
  `python` par `py` dans toutes les commandes de ce guide.
- **Si Python n'est pas installé** : télécharge-le sur
  <https://www.python.org/downloads/>, et **coche la case « Add python.exe to
  PATH »** avant de cliquer sur *Install Now*. Ferme puis rouvre le terminal.

## Étape 2 — Installer la seule dépendance (une fois pour toutes)

```
python -m pip install requests
```

## Étape 3 — Se placer dans le dossier du projet

Toutes les commandes se lancent **dans le dossier du projet** :

```
cd leforem-scraper
```

## Étape 4 — Lancer le serveur local

```
python serveur.py
```

Tu dois voir : *Web interface on http://localhost:8123*. **Laisse cette fenêtre
ouverte** : c'est elle qui sert la page. Pour l'arrêter : `Ctrl + C` dans cette
fenêtre.

## Étape 5 — Ouvrir la page

Ouvre ton navigateur (Edge, Chrome, Firefox…) sur :

```
http://localhost:8123
```

## Étape 6 — Créer ta première recherche

1. Clique sur **Nouvelle recherche**.
2. Tape un métier (par exemple « électromécanicien ») et choisis-le dans la
   liste proposée.
3. Tape un lieu (par exemple « Liège ») et choisis-le.
4. Clique sur **Copier la commande**.
5. Colle cette commande dans le terminal (celui de l'étape 4) et valide avec
   Entrée :

```
python scraper.py --occupation-guid <id métier> --location-guid <id lieu>
```

Le téléchargement commence. Les offres défilent dans le terminal ; le trait
`=` indique l'avancement. Compte quelques minutes pour une première recherche.

## Étape 7 — Revenir voir tes offres

Recharge la page (`F5`). Le menu **Scraping** en haut permet de choisir la
recherche à afficher. Pour la mettre à jour plus tard, clique sur **Actualiser**
en haut de la page : tu n'as plus besoin du terminal.

### Petit aide-mémoire

| Je veux… | Ce que je fais |
|---|---|
| Démarrer le programme | `python serveur.py` (terminal laissé ouvert) |
| Ouvrir la page | <http://localhost:8123> |
| Mettre à jour les offres | bouton **Actualiser** sur la page |
| Tout re-télécharger | `python scraper.py --refresh …` dans le terminal |
| Nouvelle recherche | **Nouvelle recherche**, puis commande à coller |
| Transporter mes suivis sur un autre PC | export puis import du fichier JSON (page Offres) |
| Arrêter le programme | `Ctrl + C` dans le terminal du serveur |

### Si ça ne marche pas

| Problème | Solution |
|---|---|
| `python n'est pas reconnu…` | Python absent ou hors du PATH : relis l'étape 1, ou utilise `py`. |
| `No module named requests` | `python -m pip install requests` |
| `error: the following arguments are required: --occupation-guid, --location-guid` | Lance la commande générée par **Nouvelle recherche**, elle contient les deux identifiants. |
| La page affiche une erreur | Le serveur est-il lancé et sa fenêtre toujours ouverte ? |
| La page reste sur « Chargement des annonces… » | Le terminal du serveur a été fermé : relance `python serveur.py`. |
| Page blanche en ouvrant `index.html` directement | Le site du Forem bloque le mode `file://` : passe par `http://localhost:8123`. |

---

# Partie 2 — Comment fonctionne le logiciel

## Les trois morceaux

```
   terminal                     navigateur
┌──────────────┐            ┌────────────────────────┐
│ scraper.py   │  écrit     │ index.html + script.js  │
│ (télécharge) ├───────────►│ (tableau, filtres)      │
└──────┬───────┘  data/     │ detail.html (fiche)     │
       │ import             └───────────┬─────────────┘
       │                               │ lit /api/…
┌──────▼───────┐  lit  data/           │
│ serveur.py   │◄─────────────────────┤
│ (serveur web)│  POST /api/scraper/run
└──────────────┘       (actualiser)
```

1. **`scraper.py`** — le programme qui parle au site du Forem et écrit les
   fichiers de données dans `data/`. Il se lance dans le terminal.
2. **`serveur.py`** — un petit serveur web local (port 8123). Il sert la page,
   expose les fichiers de `data/`, quelques API (`/api/scrapings`,
   `/api/nomenclature/…`) et la route qui lance un scraping depuis la page.
3. **L'interface** (`index.html`, `style.css`, `script.js`, `scraper-ui.js`,
   `detail.html`, `detail.js`) — le tableau des offres, les filtres, la fiche
   d'une offre. Elle ne scrape jamais elle-même : elle demande au serveur ou lit
   les fichiers.

## Ce qui se passe pendant un scraping

1. **Phase 1 — la liste.** Le scraper interroge l'API du Forem et récupère le
   résumé de chaque offre (numéro, titre, société, lieu, date, description
   courte). C'est rapide : une seule requête par page de résultats.
2. **Comparaison.** Pour chaque résumé, il calcule un `listing_hash` (empreinte
   de l'annonce résumé) et le compare à celui enregistré au scraping précédent.
3. **Phase 2 — les détails.** Il n'ouvre la fiche complète que pour les offres
   **nouvelles**, les offres dont le `listing_hash` a **changé**, et les offres
   qui avaient **échoué** la dernière fois. Les autres sont reprises du cache :
   c'est ce qui rend un scraping incrémental rapide.
4. **Écriture.** Chaque réponse est convertie en champs lisibles (contrat,
   horaire, rémunération, email, lieu, dates), un `content_hash` est calculé,
   puis les fichiers JSON sont réécrits **de façon atomique** (fichier temporaire
   puis remplacement, pour ne jamais laisser de fichier tronqué).

## Le système « incrémental » en deux empreintes

| Empreinte | Portée | Sert à quoi |
|---|---|---|
| `listing_hash` | le résumé de l'annonce (sans date de publication, sans logo, sans identifiant) | décider s'il faut rouvrir la fiche |
| `content_hash` | le contenu extrait de la fiche | repérer une offre qui a changé → tag « modifiée » |

Quelques règles qui évitent les faux positifs :

- une offre qui n'a pas encore d'empreinte enregistrée (première fois) est
  simplement mise en cache, pas marquée comme modifiée ;
- un changement de règle de hash (`hash_rule`, actuellement `2`) ne déclenche
  pas une rafale de fausses modifications ;
- `published_on` est exclu du `content_hash` car cette valeur bouge chez le
  Forem sans que l'offre change.

## Actualiser depuis la page web

Le bouton **Actualiser** appelle `POST /api/scraper/run` sur le serveur, qui
lance exactement le même code que le terminal, en mode incrémental :

- une demande de confirmation s'affiche avant le lancement (il n'y a pas de
  tâche de fond, le bouton reste bloqué jusqu'à la fin) ;
- le serveur renvoie un flux d'événements (`log`, `progress`, `done`, `error`)
  que la page affiche en direct dans le pseudo-terminal ;
- un seul scraping à la fois : une seconde demande reçoit une erreur `409` ;
- à la fin, la page propose un résumé (téléchargées, nouvelles, modifiées,
  en cache, erreurs, durée) puis recharge le tableau ;
- si une fenêtre « données obsolètes » s'affiche (les offres ont beaucoup
  vieilli), le bouton **Actualiser** qu'elle propose lance le même flux.

## Où sont mes données

**Les offres** dans `data/`, un ensemble de fichiers par recherche
(`<base>` = le nom court de la recherche, p. ex. `liege`) :

| Fichier | Contenu |
|---|---|
| `data_<base>.json` | les offres de la recherche (ce que la page affiche) |
| `details_<base>.json` | le cache des fiches complètes (sert aux calculs) |
| `historique_<base>.json` | les offres disparues depuis le début |
| `historique_modifications.json` | la liste des offres modifiées dans le temps |
| `historique_scrapes.json` | l'historique des scrapings et leurs statistiques |
| `blacklist.json` | les numéros d'annonces en 404, ignorés automatiquement |
| `companies.json` | les logos d'entreprises, mis en cache |
| `trash/` | les recherches supprimées depuis la page (corbeille) |

**Tes suivis** (statut, favori, remarque, priorité, dates de relance) ne sont
**pas** dans ces fichiers : ils vivent dans le `localStorage` de ton navigateur,
avec une clé par recherche (`forem_<base>_statuts`, `forem_<base>_favoris`, …).
Conséquences pratiques :

- tout est locaux, rien n'est envoyé sur Internet ;
- effacer les données du navigateur efface tes suivis ;
- la page de détail d'une offre (`detail.html`) lit et écrit les mêmes clés :
  un statut changé dans une fiche apparaît dans le tableau, même sans
  recharger, et inversement ;
- les compteurs de statut, filtres et relances sont recalculés à chaque
  changement.

## Les pages et les fichiers du projet

La barre de navigation en haut de page relie trois écrans :

- **Offres** (`index.html`) : le tableau, les filtres, le bouton *Actualiser* ;
- **Dashboard** (`insights.html`) : les statistiques de tes recherches ;
- **Employeurs** (`companies.html`) : les entreprises et leurs logos.

| Fichier | Rôle |
|---|---|
| `scraper.py` | télécharge les offres, compare les empreintes, écrit `data/` |
| `serveur.py` | serveur local (page + API + lancement d'un scraping) |
| `core.py` | outils partagés : empreintes, lecture/écriture des historiques |
| `companies.py` | récupère et met en cache les logos des entreprises |
| `script.js`, `style.css`, `index.html` | le tableau des offres et son style |
| `detail.html`, `detail.js` | la fiche d'une offre (statut, remarque, priorité) |
| `scraper-ui.js` | fenêtre d'actualisation : confirmation, flux en direct, résumé |
| `scraping-selector.js` | menu « Scraping » partagé entre les pages |
| `insights.html`, `insights.js` | le dashboard |
| `companies.html`, `companies.js` | la page Employeurs |
| `suivi-io.js` | export / import de tes suivis (JSON) pour changer de PC |
| `navbar_include.html`, `navbar-loader.js` | la barre de navigation commune |
| `theme.js` | thème clair / sombre |
| `tests/` | la suite de tests |

## Options du scraper

| Option | Effet |
|---|---|
| `--occupation-guid ID` | métier recherché (obligatoire, fourni par la page) |
| `--location-guid ID` | lieu recherché (obligatoire, fourni par la page) |
| `--label "texte"` | nom lisible de la recherche, affiché dans le menu |
| `--base nom` | nom court des fichiers ; par défaut généré à partir des identifiants |
| `--limit N` | ne traiter que N offres (utile pour tester) |
| `--refresh` | re-télécharge **toutes** les offres au lieu d'appliquer l'incrémental |

## Les tests

Le projet embarque une suite de tests (aucune installation supplémentaire) :

```
python -m unittest discover -s tests
```

Elle couvre l'incrémental, les empreintes, le nettoyage des données, l'export
CSV et le contrat HTTP du scraping. Ni le réseau ni le site du Forem ne sont
utilisés.