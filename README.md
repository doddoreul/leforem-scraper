# Forem Offers Scraper

> Récupère automatiquement les offres d'emploi publiées sur le site du Forem
> et les affiche dans une petite page web chez toi (sur ton PC), avec des
> menus pour suivre tes candidatures.

---

# Partie 1 — Démarrage rapide

Ce guide suppose **Windows**. Toutes les commandes se tapent dans PowerShell.

## 1 — Ouvre PowerShell

Touche `Windows`, tape `powershell`, puis Entrée.

## 2 — Installe Python et la dépendance

Dans le dossier du projet :

```
.\install.ps1
```

Le script télécharge et installe Python (version 3.13, celle que vise le
projet), puis installe `requirements.txt`. Il ne réinstalle rien si Python est
déjà là. S'il doit réellement installer Python, il demande les droits
administrateur : clique droit sur PowerShell, **Exécuter en tant
qu'administrateur**, puis relance la commande.

> Si PowerShell refuse le script, autorise son exécution pour ton compte :
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

**Sans le script**, fais les deux étapes à la main :

```
python --version
python -m pip install -r requirements.txt
```

- Si `python --version` affiche un numéro, c'est bon.
- S'il affiche une erreur, essaie `py --version`. Si `py` marche, remplace
  `python` par `py` dans toutes les commandes de ce guide. C'est aussi ce que
  fait le script tout seul quand `python` pointe vers l'alias Microsoft Store.
- Si Python n'est pas installé : <https://www.python.org/downloads/>, en
  **cochant « Add python.exe to PATH »** avant *Install Now*. Ferme puis rouvre
  PowerShell ensuite.

## 3 — Lance le programme

```
cd leforem-scraper
python serveur.py
```

**Laisse cette fenêtre ouverte** : c'est elle qui sert la page. Le terminal
affiche *Le scraper Le Forem est démarré* et ton navigateur s'ouvre seul sur
<http://localhost:8123>. Pour tout arrêter : `Ctrl + C` dans cette fenêtre.

## 4 — Crée ta première recherche

Dans la page ouverte :

1. **Nouvelle recherche** ;
2. choisis un métier (par exemple « électromécanicien ») puis un lieu
   (par exemple « Liège ») ;
3. **Lancer le scraping**.

Le téléchargement se fait devant toi, dans le faux terminal de la page. Une
fois fini, la recherche devient celle affichée et le tableau se remplit.

Ensuite, tout se passe dans le navigateur : `F5` recharge la page, le bouton
**Actualiser** — ou la date de dernier scraping, en haut — met les offres à
jour, et le menu **Scraping** choisit la recherche affichée. Aucune commande à
recopier.

### Petit aide-mémoire

| Je veux… | Ce que je fais |
|---|---|
| Installer Python et les dépendances | `.\install.ps1` |
| Démarrer le programme | `python serveur.py` (terminal laissé ouvert) |
| Ouvrir la page | <http://localhost:8123> |
| Mettre à jour les offres | bouton **Actualiser**, ou la date de dernier scraping |
| Tout re-télécharger | `python -m python.scraper --refresh …` dans le terminal |
| Nouvelle recherche | **Nouvelle recherche**, puis **Lancer le scraping** |
| Mettre à jour la page Employeurs | rien à faire, c'est fait à la fin de chaque scraping |
| Transporter mes suivis sur un autre PC | export puis import du fichier JSON (page Offres) |
| Arrêter le programme | `Ctrl + C` dans le terminal du serveur |

### Si ça ne marche pas

| Problème | Solution |
|---|---|
| `python n'est pas reconnu…` | Python absent ou hors du PATH : lance `.\install.ps1`, ou utilise `py`. |
| `install.ps1 ne peut pas être chargé car ses scripts sont désactivés` | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, puis relance. |
| `No module named requests` | `python -m pip install -r requirements.txt` |
| `error: the following arguments are required: --occupation-guid, --location-guid` | Utilise **Nouvelle recherche** puis **Lancer le scraping** : la page fournit les deux identifiants. |
| La page affiche une erreur | Le serveur est-il lancé et sa fenêtre toujours ouverte ? |
| La page reste sur « Chargement des annonces… » | Le terminal du serveur a été fermé : relance `python serveur.py`. |
| Page blanche en ouvrant `index.html` directement | Le site du Forem bloque le mode `file://` : passe par `http://localhost:8123`. |

---

# Partie 2 — Comment fonctionne le logiciel

## Les quatre morceaux

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
3. **`python/employers.py`** — construit l'index des employeurs à partir
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
   puis les données sont enregistrées (par défaut dans la base SQLite
   `data/leforem.db`, ou dans les fichiers JSON si `LEFOREM_STORAGE=json`).

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

À la fin d'un scraping réussi, le serveur reconstruit aussi l'index des
employeurs : la page **Employeurs** est donc à jour sans rien lancer
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

**Les offres** vivent dans `data/`. Par défaut, tout est enregistré dans une
base SQLite unique :

| Fichier | Contenu |
|---|---|
| `leforem.db` | offres, détails, historiques, blacklist, index des employeurs, suivi (`offer_tracking`) et profil candidat (`profile`) |
| `trash/` | les recherches supprimées depuis la page (corbeille) |

Le format JSON reste disponible en le demandant explicitement
(`LEFOREM_STORAGE=json`), notamment pour l'export, les tests et la migration.
Au premier lancement en SQLite, si `data/leforem.db` n'existe pas encore, les
fichiers JSON présents dans `data/` sont importés automatiquement. Voici ces
fichiers, un ensemble par recherche (`<base>` = le nom court de la recherche,
p. ex. `liege`) :

| Fichier | Contenu |
|---|---|
| `data_<base>.json` | les offres de la recherche (ce que la page affiche) |
| `details_<base>.json` | le cache des fiches complètes (sert aux calculs) |
| `historique_<base>.json` | les offres disparues depuis le début |
| `historique_modifications.json` | la liste des offres modifiées dans le temps |
| `historique_scrapes.json` | l'historique des scrapings et leurs statistiques |
| `blacklist.json` | les numéros d'annonces en 404, ignorés automatiquement |
| `companies.json` | l'index des employeurs (coordonnées, contacts, offres), reconstruit après chaque scraping |

**Tes suivis** (statut, favori, remarque, priorité, dates de relance) sont dans
la table `offer_tracking` de `data/leforem.db`, une ligne par offre suivie
(`base_name`, `offer_id`, `statut`, `statut_date`, `remarque`, `favori`,
`priorite`). Le navigateur les lit et écrit via `/api/tracking`, et en garde
aussi une copie dans son `localStorage` (`forem_<base>_statuts`,
`forem_<base>_favoris`, …) qui sert de miroir.
Conséquences pratiques :

- tout est local, rien n'est envoyé sur Internet ;
- effacer les données du navigateur n'efface plus tes suivis : ils sont dans la
  base, et réapparaissent au prochain chargement de la page ;
- un suivi fait sur un autre PC n'est pas visible tant que tu n'importes pas le
  fichier de suivi, qui pushes aussi vers la base ;
- la page de détail d'une offre (`html/detail.html`) lit et écrit les mêmes
  données : un statut changé dans une fiche apparaît dans le tableau, même sans
  recharger, et inversement ;
- les compteurs de statut, filtres et relances sont recalculés à chaque
  changement.

## La barre de recherche

La boîte en haut du tableau filtre **à chaque frappe**. Elle cherche dans toutes
les données de l'annonce, pas seulement dans le titre : numéro, date de
publication, date de fin, titre, société, e-mail, contrat, horaire, lieu,
rémunération, chèques-repas, état de l'offre, description entière, et l'objet
`diff` qui contient l'ancienne valeur des champs modifiés. Y sont ajoutés tes
propres suivis : statut, priorité et remarque. Une colonne ajoutée au listing
devient donc cherchable sans toucher au code.

Les accents, les ligatures et la casse ne comptent pas : `Electromecanicien`,
`électromécanicien` et `ELECTROMECANICIEN` trouvent la même annonce. Les
balises HTML de la description sont retirées avant la comparaison, sinon taper
`div` afficherait tout.

Deux règles à garder en tête : tous les mots tapés doivent être présents (c'est
un « et », pas un « ou »), et vider la boîte réaffiche tout.

## Le profil candidat et le surlignage

La page **Profil** (un seul profil pour toute l'application, pas un par
recherche) retient tes mots-clés, ton code postal, ton taux horaire brut, les
types de contrat qui t'intéressent et la distance maximale. Les mots-clés sont
ensuite **surlignés** dans le tableau et dans la fiche d'une offre, ce qui évite
d'ouvrir chaque annonce pour voir si elle colle.

Le profil est enregistré dans la table `profile` de `data/leforem.db`, avec un
miroir dans le `localStorage` du navigateur. Comme pour les suivis, effacer les
données du navigateur ne le fait pas disparaître.

## Les rémunérations

En plus du champ `pay` repris tel quel du Forem, le scraper dérive quelques
valeurs calculées : nature (`hourly` ou `monthly`), minimum et maximum,
estimation horaire à partir du temps de travail, et la mention des chèques-repas
avec son montant et sa période. Ces champs sont calculés **après** le
`content_hash` : améliorer le parseur ne fait donc pas passer des offres
immobiles pour des offres modifiées.

Sur des offres déjà téléchargées, la réanalyse se lance à la main :

| Je veux… | Ce que je fais |
|---|---|
| Recalculer la rémunération des offres en cache | `python -m python.salary --backfill` |
| Voir la répartition | `python -m python.salary --stats` |

Une grande partie des offres reste en rémunération inconnue : le Forem ne la
publie pas toujours, et une annonce qui la cache dans son texte libre n'est pas
toujours convertible.

## Les pages et les fichiers du projet

La barre de navigation en haut de page relie quatre écrans :

- **Offres** (`index.html`) : le tableau, les filtres, le bouton *Actualiser* ;
- **Dashboard** (`html/insights.html`) : les statistiques de tes recherches ;
- **Employeurs** (`html/companies.html`) : les entreprises et leurs logos ;
- **Profil** (`html/profil.html`) : ton profil candidat, un seul pour toute
  l'application (pas un profil par recherche), qui sert à surligner tes
  mots-clés dans le tableau et dans la fiche d'une offre.

La fiche d'une offre (`html/detail.html`) ne figure pas dans la barre : on y
arrive en cliquant une ligne du tableau.

| Fichier | Rôle |
|---|---|
| `serveur.py` | le point de démarrage : `python serveur.py` |
| `install.ps1` | installe Python et les dépendances du projet, pour un poste neuf |
| `python/` | le code : `config.py` (chemins), `jsonio.py` (lecture/écriture JSON), `core.py` (logique pure), `storage/` (stockage SQLite/JSON interchangeable), `salary.py` (rémunérations et chèques-repas), `scraper.py`, `employers.py`, `server.py`, `migrate_to_sqlite.py` — lancés par `python -m python.scraper`, `python -m python.employers`, `python -m python.salary`, `python -m python.server` |
| `index.html`, `css/style.css`, `js/pages/index.js` | le tableau des offres, ses filtres et son style |
| `html/detail.html`, `js/pages/detail.js` | la fiche d'une offre (statut, remarque, priorité) |
| `html/profil.html`, `js/pages/profil.js` | le profil candidat (code postal, mots-clés, taux horaire brut, contrats, distance) |
| `html/insights.html`, `js/pages/insights.js` | le dashboard |
| `html/companies.html`, `js/pages/companies.js` | la page Employeurs |
| `js/shared/` | les modules communs : `api.js`, `dates.js`, `dom.js`, `highlight.js`, `html.js`, `links.js`, `navbar.js`, `profile.js`, `scraper-ui.js`, `scraping-selector.js`, `statuses.js`, `storage.js`, `suivi.js`, `text.js`, `theme.js` |
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
CSV, le contrat HTTP du scraping, le stockage SQLite et JSON, et les fichiers
servis par le serveur (pages, modules ES, feuille de style, refus de sortir de
`data/`, `js/`, `css/` ou `html/`). Les tests qui s'appuient sur des fichiers
JSON forcent `LEFOREM_STORAGE=json` ; les autres s'exécutent sur le backend par
défaut (SQLite). Ni le réseau ni le site du Forem ne sont utilisés.

Une partie de la suite ouvre réellement les cinq pages dans un navigateur sans
fenêtre (Edge, ou `EDGE_PATH` pour pointer un autre Chromium) et vérifie ce qui
s'affiche vraiment : le tableau se remplit, la barre de recherche filtre à la
frappe, le surlignage pose ses marques, le profil s'enregistre. C'est la seule
partie qui peut être sautée : elle est ignorée si aucun navigateur n'est trouvé.