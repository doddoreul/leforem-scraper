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
python -m pip install -r requirements.txt
```

(équivalent à `python -m pip install requests`)

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
4. Clique sur **Lancer le scraping**.

Le téléchargement démarre et les offres défilent dans le faux terminal de la
page. Compte quelques minutes pour une première recherche. Une fois la
recherche terminée, elle devient la recherche affichée et le tableau se remplit.

Tout se passe dans le navigateur : il n'y a plus de commande à copier.

## Étape 7 — Revenir voir tes offres

Recharge la page (`F5`). Le menu **Scraping** en haut permet de choisir la
recherche à afficher. Pour la mettre à jour plus tard, clique sur **Actualiser**
en haut de la page, ou sur la date de dernier scraping.

### Petit aide-mémoire

| Je veux… | Ce que je fais |
|---|---|
| Démarrer le programme | `python serveur.py` (terminal laissé ouvert) |
| Ouvrir la page | <http://localhost:8123> |
| Mettre à jour les offres | bouton **Actualiser** sur la page |
| Tout re-télécharger | `python -m python.scraper --refresh …` dans le terminal |
| Nouvelle recherche | **Nouvelle recherche**, puis **Lancer le scraping** |
| Mettre à jour la page Employeurs | rien à faire, c'est fait à la fin de chaque scraping |
| Transporter mes suivis sur un autre PC | export puis import du fichier JSON (page Offres) |
| Arrêter le programme | `Ctrl + C` dans le terminal du serveur |

### Si ça ne marche pas

| Problème | Solution |
|---|---|
| `python n'est pas reconnu…` | Python absent ou hors du PATH : relis l'étape 1, ou utilise `py`. |
| `No module named requests` | `python -m pip install -r requirements.txt` |
| `error: the following arguments are required: --occupation-guid, --location-guid` | Utilise **Nouvelle recherche** puis **Lancer le scraping** : la page fournit les deux identifiants. |
| La page affiche une erreur | Le serveur est-il lancé et sa fenêtre toujours ouverte ? |
| La page reste sur « Chargement des annonces… » | Le terminal du serveur a été fermé : relance `python serveur.py`. |
| Page blanche en ouvrant `index.html` directement | Le site du Forem bloque le mode `file://` : passe par `http://localhost:8123`. |

---

# Partie 2 — Comment fonctionne le logiciel

## Les trois morceaux

```
terminal                     navigateur
 ┌──────────────┐            ┌────────────────────────┐
 │ scraper.py   │  écrit     │ index.html + js/pages/  │
 │ (télécharge) ├───────────►│ (tableau, filtres)      │
 └──────┬───────┘  data/     │ detail.html (fiche)     │
        │ import             └───────────┬─────────────┘
        │                               │ lit /api/…
 ┌──────▼───────┐  lit  data/           │
 │ serveur.py   │◄─────────────────────┤
 │ (serveur web)│  POST /api/scraper/run
 └──────────────┘       (actualiser)
```

1. **`python/scraper.py`** — le programme qui parle au site du Forem et
   écrit les fichiers de données dans `data/`. Il se lance dans le terminal
   (`python -m python.scraper`).
2. **`python/server.py`** — un petit serveur web local (port 8123). Il
   sert la page, expose les fichiers de `data/`, quelques API
   (`/api/scrapings`, `/api/nomenclature/…`) et la route qui lance un scraping
   depuis la page (`python serveur.py`).
3. **`python/employers.py`** — construit `data/companies.json` à partir
   des offres déjà téléchargées (`python -m python.employers`).
4. **L'interface** (`index.html`, `html/detail.html`, `html/insights.html`,
   `html/companies.html`, `css/style.css` et les modules `js/`) — le tableau des
   offres, les filtres, la fiche d'une offre. Elle ne scrape jamais elle-même :
   elle demande au serveur ou lit les fichiers.

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

## Lancer et actualiser un scraping depuis la page web

**Nouvelle recherche** et **Actualiser** appellent la même route,
`POST /api/scraper/run`, qui lance exactement le même code que le terminal, en
mode incrémental.

Une nouvelle recherche n'existe pas encore dans `data/` : la page envoie le nom
court, le métier et le lieu choisis, et le serveur crée les fichiers. Ensuite,
elle apparaît dans le menu **Scraping** et devient la recherche affichée.

Points communs aux deux :

- **Actualiser** demande une confirmation avant de lancer, **Lancer le
  scraping** démarre directement (tu viens de choisir métier et lieu) ;
- il n'y a pas de tâche de fond : le bouton reste bloqué jusqu'à la fin ;
- le serveur renvoie un flux d'événements (`log`, `progress`, `done`, `error`)
  que la page affiche en direct dans le pseudo-terminal ;
- un seul scraping à la fois : une seconde demande reçoit une erreur `409` ;
- à la fin, la page propose un résumé (téléchargées, nouvelles, modifiées,
  en cache, erreurs, durée) puis recharge le tableau ;
- si une fenêtre « données obsolètes » s'affiche (les offres ont beaucoup
  vieilli), le bouton **Actualiser** qu'elle propose lance le même flux.

À la fin d'un scraping réussi, le serveur reconstruit aussi
`data/companies.json` : la page **Employeurs** est donc à jour sans rien lancer
dans un terminal. L'index est fusionné avec le précédent, si bien qu'un e-mail ou
un téléphone trouvé puis disparu de l'affichage est conservé. Si cette
reconstruction échoue, le scraping reste considéré comme réussi (les offres sont
bien enregistrées) ; relance `python -m python.employers` dans ce cas.

Tu peux aussi reconstruire l'index à la main :

| Je veux… | Ce que je fais |
|---|---|
| Reconstruire l'index des employeurs | `python -m python.employers` (après un scraping manuel) |
| Repartir de zéro, sans les contacts accumulés | `python -m python.employers --rebuild` |
| Voir le résumé dans le terminal | `python -m python.employers --stats` |

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
| `companies.json` | l'index des employeurs (coordonnées, contacts, offres), reconstruit après chaque scraping |
| `trash/` | les recherches supprimées depuis la page (corbeille) |

**Tes suivis** (statut, favori, remarque, priorité, dates de relance) ne sont
**pas** dans ces fichiers : ils vivent dans le `localStorage` de ton navigateur,
avec une clé par recherche (`forem_<base>_statuts`, `forem_<base>_favoris`, …).
Conséquences pratiques :

- tout est locaux, rien n'est envoyé sur Internet ;
- effacer les données du navigateur efface tes suivis ;
- la page de détail d'une offre (`html/detail.html`) lit et écrit les mêmes clés :
  un statut changé dans une fiche apparaît dans le tableau, même sans
  recharger, et inversement ;
- les compteurs de statut, filtres et relances sont recalculés à chaque
  changement.

## Les pages et les fichiers du projet

La barre de navigation en haut de page relie trois écrans :

- **Offres** (`index.html`) : le tableau, les filtres, le bouton *Actualiser* ;
- **Dashboard** (`html/insights.html`) : les statistiques de tes recherches ;
- **Employeurs** (`html/companies.html`) : les entreprises et leurs logos.

| Fichier | Rôle |
|---|---|
| `serveur.py` | le point de démarrage : `python serveur.py` |
| `python/` | le code : `config.py` (chemins), `jsonio.py` (lecture/écriture JSON), `core.py` (logique pure), `scraper.py`, `employers.py`, `server.py` — lancés par `python -m python.scraper`, `python -m python.employers`, `python -m python.server` |
| `index.html`, `css/style.css`, `js/pages/index.js` | le tableau des offres, ses filtres et son style |
| `html/detail.html`, `js/pages/detail.js` | la fiche d'une offre (statut, remarque, priorité) |
| `html/insights.html`, `js/pages/insights.js` | le dashboard |
| `html/companies.html`, `js/pages/companies.js` | la page Employeurs |
| `js/shared/` | les modules communs : `api.js`, `dates.js`, `dom.js`, `links.js`, `navbar.js`, `scraper-ui.js`, `scraping-selector.js`, `statuses.js`, `storage.js`, `suivi.js`, `text.js`, `theme.js` |
| `js/boot/theme-boot.js` | le thème appliqué avant le premier affichage (script classique) |
| `css/` | la feuille de style unique, `style.css` |
| `html/navbar_include.html` | la barre de navigation commune, injectée par `js/shared/navbar.js` |
| `tests/` | la suite de tests |

À la racine, il n'y a que `index.html` et `serveur.py`, le lanceur :
les autres pages sont dans `html/`, le style dans `css/`, les modules dans
`js/`, le code dans `python/`. Le scraper et l'index des employeurs n'ont pas
de lanceur à la racine : on les lance par `python -m python.scraper` et
`python -m python.employers`. L'interface est faite de modules ES natifs,
sans build : chaque page charge son fichier dans `js/pages/` et ce qu'elle partage
avec les autres dans `js/shared/`. Les pages restent servies à la racine du
serveur (`/index.html`, `/insights.html`…) même si leurs fichiers sont dans
`html/` ; seuls les assets sont adressés par leur dossier (`/css/…`, `/js/…`).
Le dossier des données n'a qu'une seule source de vérité, `python/config.py`.

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
CSV, le contrat HTTP du scraping et les fichiers servis par le serveur (pages,
modules ES, feuille de style, fichiers JSON, refus de sortir de `data/`, `js/`,
`css/` ou `html/`). Ni le réseau ni le site du Forem ne sont utilisés.

Une partie de la suite ouvre réellement les quatre pages dans un navigateur sans
fenêtre (Edge, ou `EDGE_PATH` pour pointer un autre Chromium) et vérifie ce qui
s'affiche vraiment. C'est la seule partie qui peut être sautée : elle est
ignorée si aucun navigateur n'est trouvé.