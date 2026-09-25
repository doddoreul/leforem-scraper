# Forem Offers Scraper

> Récupère automatiquement les offres d'emploi publiées sur le site du Forem
> et les affiche dans une petite page web chez toi (sur ton PC), avec des
> menus pour suivre tes candidatures.

---

## 1) Installer Python (la première fois)

C'est le langage utilisé par ce projet. Si tu ne sais pas si Python est déjà
installé, on va le vérifier.

### 1.1. Ouvrir un terminal

- Appuie sur la touche `Windows`, tape `powershell`, puis Entrée.
- Une fenêtre bleue s'ouvre avec une ligne de commande.

### 1.2. Vérifier si Python est déjà là

Dans le terminal, tape ceci puis Entrée :

```
python --version
```

- **Si tu vois un numéro** du genre `Python 3.12.x` : parfait, va directement
  à l'étape 2.
- **Si tu vois une erreur** (`python n'est pas reconnu…`) : essaie :

```
py --version
```

- Si `py` fonctionne, tant mieux : utilise `py` dans toutes les commandes de
  ce guide au lieu de `python`.

### 1.3. Installer Python (si absent)

1. Va sur <https://www.python.org/downloads/> et clique sur
   **Download Python**.
2. Ouvre le fichier téléchargé.
3. **IMPORTANT** : coche la case **« Add python.exe to PATH »** (en bas de la
   fenêtre) AVANT de cliquer sur **Install Now**.
4. Laisse l'installation se terminer, puis ferme le terminal et rouvre-en un.
5. Reteste avec `python --version`. Tu dois voir un numéro de version.

---

## 2) Récupérer le projet

Le dossier du projet doit être sur ton ordinateur (il contient au minimum les
fichiers `scraper.py`, `serveur.py`, `index.html`, `style.css`,
`script.js`).

Si tu as récupéré ce projet depuis GitHub :

- clique sur le bouton vert **Code**,
- choisis **Download ZIP**,
- extrais l'archive, par exemple dans `Documents\leforem-scraper`.

---

## 3) Installer la bibliothèque `requests`

Ce petit module permet au scraper de parler avec le site du Forem.

Dans le terminal, tape :

```
python -m pip install requests
```

Attends la fin (quelques secondes). Si tout est bon, tu verras un message du
genre `Successfully installed requests-2.x.x`.

---

## 4) Lancer les commandes au bon endroit

Toutes les commandes doivent être lancées **dans le dossier du projet**.

Dans le terminal, tape :

```
cd leforem-scraper
```

(adapte le chemin selon l'endroit où tu as extrait le dossier).

---

## 5) Récupérer les offres

Tape cette commande, puis Entrée :

```
python scraper.py
```

Le programme :

1. cherche les offres sur le site du Forem (mots-clés par défaut :
   électromécanicien industriel, arrondissement de Liège),
2. ouvre chaque offre pour récupérer le détail,
3. écrit deux fichiers : `data.json` (les offres) et
   `historique_supprimees.json` (les offres qui ont disparu).

Ça peut prendre quelques minutes. Sois patient : les offres défilent dans le
terminal.

### Options utiles

| Option | Effet | Exemple |
|---|---|---|
| (aucune) | Scraping normal : seules les offres nouvelles/modifiées sont re-téléchargées | `python scraper.py` |
| `--fresh` | Force le re-téléchargement de TOUTES les offres | `python scraper.py --fresh` |
| `--limit N` | Se limiter à N offres (utile pour tester) | `python scraper.py --limit 10` |

---

## 6) Afficher les offres dans le navigateur

Le site du Forem bloque l'ouverture des fichiers directement depuis le
disque. Il faut donc lancer le petit serveur local :

```
python serveur.py
```

Tu dois voir : *Web interface on http://localhost:8123*.

Ensuite, ouvre ton navigateur (Chrome, Edge, Firefox…) et va sur :

```
http://localhost:8123
```

**Laisse la fenêtre du terminal ouverte** tant que tu utilises la page.
Pour arrêter le serveur plus tard : ferme la fenêtre ou appuie sur
`Ctrl + C`.

---

## 7) Se servir de la page web

La page est en anglais, mais tout est simple :

- **Current offers** : les offres actuelles. Chaque ligne a :
  - une **étoile** pour mettre l'offre en favori,
  - un menu **Status** pour suivre ta candidature (Interested, Applied,
    Contacted, Rejected…),
  - une zone **Remarks** pour écrire un commentaire,
  - un lien vers l'offre originale sur le site du Forem.
- **Removed offers** : les offres qui ont disparu du site.
- **New / Older offers** : le programme affiche d'abord les nouvelles offres
  (nouvelles = absentes du précédent scraping).
- En haut : une **barre de recherche** pour filtrer les lignes par
  mots-clés, et le menu **Status** pour filtrer par statut.
- **New search** : pour changer de métier ou de lieu. Un bouton te génère la
  commande à copier-coller dans le terminal :

```
python scraper.py --fresh --occupation-guid <id metier> --location-guid <id lieu> --base mon-scraping --label "Mon metier / Ma ville"
```

  Chaque nouveau scraping crée ses propres fichiers
  (`data_mon-scraping.json`, etc.). Tu peux ensuite passer de l'un à l'autre
  avec le menu **Scraping** en haut de la page.
- Le menu **Scraping** te permet de voir les statistiques de chaque scraping.
  Tes statuts, favoris et remarques sont enregistrés dans ton navigateur,
  séparément pour chaque scraping.

---

## 8) Problèmes fréquents

| Problème | Solution |
|---|---|
| `python n'est pas reconnu…` | Python n'est pas installé ou pas dans le PATH. Relis l'étape 1, ou utilise `py` à la place de `python`. |
| `No module named requests` | La bibliothèque manque : `python -m pip install requests`. |
| La page affiche une erreur | Le serveur est-il bien lancé (`python serveur.py`) et la fenêtre du terminal toujours ouverte ? |
| `Ctrl + C` ne fonctionne pas | Clique d'abord dans la fenêtre du terminal (pour qu'elle soit active) puis réessaie. |

---

## 9) Fichiers du projet

- `scraper.py` : le programme qui télécharge les offres (c'est lui qui écrit
  les fichiers de données).
- `serveur.py` : le petit serveur local qui affiche la page.
- `index.html`, `style.css`, `script.js` : la page web elle-même.
- `data.json`, `historique_supprimees.json` : les données générées par le
  scraper (ne pas y toucher à la main).

Bonne recherche !