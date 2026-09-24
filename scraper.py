import argparse
import json
import os
import re
import sys
import time
from datetime import datetime
from html.parser import HTMLParser

import requests


# ============================================================
# CONFIGURATION
# ============================================================

SEARCH_URL_BASE = "https://www.leforem.be/recherche-offres/api/Recherches/Search"

DETAIL_URL = (
    "https://www.leforem.be/recherche-offres/"
    "api/Diffusion/DetailOffre/{}"
)

METIER_GUID = "fb3c1045-2adc-49ea-85d1-b5678c7bcd1f"
LIEU_GUID = "38215355-5f89-48ea-a728-14cfbc9a4b82"

ROW = 50
PAUSE = 0.2

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/140.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-BE,fr;q=0.9,en;q=0.8",
    "Content-Type": "application/json",
    "Origin": "https://www.leforem.be",
    "Referer": "https://www.leforem.be/recherche-offres/resultat-recherche",
}

DATA_FILE = "data.json"
HISTORY_FILE = "historique_supprimees.json"
VERSION = 1


# ============================================================
# OUTILS
# ============================================================

class HTMLToTextParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def get_text(self):
        return " ".join(self.parts)


def html_to_text(value):
    if not value:
        return ""
    parser = HTMLToTextParser()
    parser.feed(value)
    texte = parser.get_text()
    texte = re.sub(r"\s+", " ", texte)
    return texte.strip()


def texte_propre(value):
    if value is None:
        return ""
    return " ".join(str(value).split()).strip()


def creer_resume(description, max_chars=300):
    texte = html_to_text(description)
    if not texte:
        return ""
    phrases = re.split(r"(?<=[.!?])\s+", texte)
    resume = " ".join(phrases[:2]).strip()
    if len(resume) > max_chars:
        resume = resume[:max_chars].rstrip() + "..."
    return resume


# ============================================================
# EXTRACTION DES CHAMPS DU DÉTAIL
# ============================================================

def format_type_contrat(value):
    if not value:
        return ""
    if isinstance(value, dict):
        for cle in ("libelle", "label", "nom", "value"):
            v = value.get(cle)
            if v:
                return texte_propre(v)
        return ""
    return texte_propre(value)


def extraire_horaire(detail):
    regime = texte_propre(detail.get("regimeTravail"))
    periode = ""
    shift = detail.get("shift")
    if isinstance(shift, dict):
        periode = texte_propre(shift.get("shiftPeriod"))
    return " — ".join(partie for partie in (regime, periode) if partie)


def extraire_remuneration(benefits, max_chars=25):
    if not isinstance(benefits, dict):
        return ""
    valeur = benefits.get("basePay")
    if valeur is None:
        return ""
    texte = " ".join(str(valeur).split()).strip()
    if len(texte) > max_chars:
        texte = texte[:max_chars].rstrip()
    return texte


MOT_CLE_SALAIRE = re.compile(
    r"salaire|salarial(e|es)?|r[eéè]mun[eéé]r|r[eéè]tribution|paye\b", re.I
)
MONTANT_EUR = re.compile(r"\d[\d\s.,]*\s*€", re.I)
MONTANT_PERIODIQUE = re.compile(
    r"€\s*/?\s*(?:h\b|heure|mois|an|semaine|jour)", re.I
)
AVANTAGES_PARASITAUX = re.compile(
    r"ch[eè]ques?-repas|ticket|bon repas|frais de", re.I
)


def extraire_salaire(detail, max_chars=75):
    sources = (
        detail.get("benefitsComments")
        or detail.get("commentaireGeneral")
        or detail.get("descriptionComment")
        or ""
    )
    texte = html_to_text(sources)
    if not texte:
        return ""

    phrases = re.split(r"(?<=[.!?])\s+", texte)
    phrase_choisie = ""

    for phrase in phrases:
        if MONTANT_EUR.search(phrase) and MOT_CLE_SALAIRE.search(phrase):
            phrase_choisie = phrase
            break

    if not phrase_choisie:
        for phrase in phrases:
            if not MONTANT_EUR.search(phrase):
                continue
            if not MONTANT_PERIODIQUE.search(phrase):
                continue
            if AVANTAGES_PARASITAUX.search(phrase):
                continue
            phrase_choisie = phrase
            break

    if not phrase_choisie:
        return ""

    mot_cle = MOT_CLE_SALAIRE.search(phrase_choisie)
    if mot_cle:
        phrase_choisie = phrase_choisie[mot_cle.start():]

    phrase_choisie = re.sub(r"\s+", " ", phrase_choisie).strip()
    if len(phrase_choisie) > max_chars:
        phrase_choisie = phrase_choisie[:max_chars].rstrip() + "…"
    return phrase_choisie


def extraire_lieu(lieux):
    if not lieux:
        return ""

    valeurs = []

    if isinstance(lieux, list):
        for item in lieux:
            if isinstance(item, dict):
                v = (
                    item.get("nom")
                    or item.get("libelle")
                    or item.get("ville")
                    or item.get("codeLocalite")
                    or ""
                )
            else:
                v = str(item)
            v = texte_propre(v)
            if v and v not in valeurs:
                valeurs.append(v)
    elif isinstance(lieux, dict):
        v = (
            lieux.get("nom")
            or lieux.get("libelle")
            or lieux.get("ville")
            or ""
        )
        v = texte_propre(v)
        if v:
            valeurs.append(v)

    return ", ".join(valeurs)


def transformer_offre(detail, publication=""):
    numero = texte_propre(detail.get("numero"))

    if numero:
        url = (
            "https://www.leforem.be/recherche-offres/"
            f"offre-detail/{numero}?originPostuler=RECHOFFRE"
        )
    else:
        url = ""

    description = html_to_text(detail.get("descriptionJob"))

    return {
        "numero": numero,
        "nom_offre": texte_propre(detail.get("titreOffre")),
        "description": description,
        "societe": texte_propre(detail.get("nomEmployeur")),
        "url": url,
        "type_contrat": format_type_contrat(detail.get("typeContrat")),
        "horaire": extraire_horaire(detail),
        "remuneration": extraire_remuneration(detail.get("benefits")),
        "salaire": extraire_salaire(detail),
        "lieu": extraire_lieu(detail.get("lieuxTravail")),
        "publication": texte_propre(publication),
        "resume": creer_resume(description),
    }


# ============================================================
# RECHERCHE DES OFFRES
# ============================================================

def rechercher_offres(session, limite=None):
    payload = {
        "filtres": [],
        "filtresCodifies": [],
        "metier": [],
        "secteur": [],
        "lieuxTravail": [
            {"nom": "Nomenclatures/CodeInsBelge", "guid": LIEU_GUID}
        ],
        "locutionsGufids": [METIER_GUID],
        "priority": 1,
    }

    numeros_vus = set()
    offres = []
    page = 1

    while True:
        url = f"{SEARCH_URL_BASE}?page={page}&row={ROW}"
        print(f"Search page {page}...")

        response = session.post(url, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()

        resultats = data.get("offreEmploiResumees") or []
        total = data.get("total", 0)
        page_count = data.get("pageCount") or 1

        print(f"  -> {len(resultats)} result(s) (total: {total})")

        for offre in resultats:
            if not isinstance(offre, dict):
                continue
            numero = texte_propre(offre.get("numero"))
            if not numero or numero in numeros_vus:
                continue
            numeros_vus.add(numero)
            offres.append({
                "numero": numero,
                "publication": texte_propre(offre.get("publication")),
            })

            if limite is not None and len(offres) >= limite:
                break

        if limite is not None and len(offres) >= limite:
            break

        if page >= page_count:
            break

        page += 1
        time.sleep(PAUSE)

    print(f"\nOffers retained: {len(offres)}")
    return offres


# ============================================================
# DÉTAIL D'UNE OFFRE
# ============================================================

def recuperer_detail(session, numero):
    url = DETAIL_URL.format(numero)
    response = session.get(url, timeout=30)
    response.raise_for_status()
    return response.json()


# ============================================================
# LECTURE / ÉCRITURE DES FICHIERS JSON
# ============================================================

def lire_json(fichier, modele_par_defaut):
    try:
        with open(fichier, "r", encoding="utf-8") as f:
            data = json.load(f)
        if modele_par_defaut is not None and not isinstance(data, dict):
            return modele_par_defaut
        return data
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return modele_par_defaut


def lire_offres_precedentes(fichier=DATA_FILE):
    data = lire_json(fichier, None)
    if isinstance(data, dict):
        offres = data.get("offres", [])
    elif isinstance(data, list):
        offres = data
    else:
        offres = []

    numeros = {
        texte_propre(o.get("numero"))
        for o in offres
        if isinstance(o, dict) and texte_propre(o.get("numero"))
    }
    return offres, numeros


def retour_vide_historique(horodatage):
    return {
        "version": VERSION,
        "updated_timestamp": horodatage,
        "offres": [],
    }


def lire_historique(fichier=HISTORY_FILE, horodatage=""):
    data = lire_json(fichier, None)
    if isinstance(data, dict) and isinstance(data.get("offres"), list):
        data.setdefault("version", VERSION)
        data.setdefault("updated_timestamp", horodatage)
        return data
    return retour_vide_historique(horodatage)


def ecrire_json_atomique(fichier, contenu):
    fichier_tmp = f"{fichier}.tmp"
    with open(fichier_tmp, "w", encoding="utf-8") as f:
        json.dump(contenu, f, ensure_ascii=False, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(fichier_tmp, fichier)


# ============================================================
# HISTORIQUE DES OFFRES SUPPRIMÉES
# ============================================================

def mettre_a_jour_historique(anciennes_offres, nouvelles_offres, historique, horodatage):
    numeros_anciens = {
        texte_propre(o.get("numero"))
        for o in anciennes_offres
        if isinstance(o, dict)
    }
    numeros_nouveaux = {
        texte_propre(o.get("numero"))
        for o in nouvelles_offres
        if isinstance(o, dict)
    }

    anciennes_par_numero = {
        texte_propre(o.get("numero")): o
        for o in anciennes_offres
        if isinstance(o, dict)
    }

    # Une annonce réapparue est retirée de l'historique.
    historiques = []
    deja_presents = set()
    for entree in historique.get("offres", []):
        if not isinstance(entree, dict):
            continue
        numero = texte_propre(entree.get("numero"))
        if not numero or numero in numeros_nouveaux or numero in deja_presents:
            continue
        deja_presents.add(numero)
        historiques.append(entree)

    # Les annonces disparues sont ajoutées (une seule entrée chacune).
    pour_deleted = numeros_anciens - numeros_nouveaux
    for numero in sorted(pour_deleted):
        if numero in deja_presents:
            continue
        ancienne = anciennes_par_numero.get(numero, {})
        entree = dict(ancienne)
        entree["nouvelle"] = False
        entree["supprimee"] = True
        entree["date_suppression"] = horodatage
        historiques.append(entree)
        deja_presents.add(numero)

    historique["version"] = VERSION
    historique["updated_timestamp"] = horodatage
    historique["offres"] = historiques
    return historique


def horodatage_maintenant():
    return datetime.now().astimezone().isoformat(timespec="seconds")


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Scraper Forem - Electromecanicien industriel (Liege)"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Nombre maximum d'annonces a recuperer.",
    )
    args = parser.parse_args()

    if args.limit is not None and args.limit <= 0:
        parser.error("--limit doit etre un entier positif")

    maintenant = horodatage_maintenant()

    anciennes_offres, numeros_anciens = lire_offres_precedentes()
    historique = lire_historique(horodatage=maintenant)

    if args.limit is not None:
        print(f"Limite demandee : {args.limit} annonce(s)")
    else:
        print("Aucune limite : recuperation de toutes les annonces.")
    print()

    session = requests.Session()
    session.headers.update(HEADERS)

    resultats_recherche = rechercher_offres(session, limite=args.limit)

    nouvelles_offres = []

    if resultats_recherche:
        total = len(resultats_recherche)
        print(f"\nRecuperation des details ({total} annonce(s))...")

        for index, entree in enumerate(resultats_recherche, start=1):
            numero = entree["numero"]
            print(f"  [{index}/{total}] Offre {numero}")

            try:
                detail = recuperer_detail(session, numero)
                offre = transformer_offre(
                    detail, publication=entree.get("publication", "")
                )
                offre["nouvelle"] = numero not in numeros_anciens
                nouvelles_offres.append(offre)
            except requests.RequestException as e:
                print(f"    Erreur reseau : {e}")
            except Exception as e:
                print(f"    Erreur : {e}")

            time.sleep(PAUSE)

    if not nouvelles_offres and not resultats_recherche:
        print("\nAucune annonce trouvee.")

    mettre_a_jour_historique(
        anciennes_offres, nouvelles_offres, historique, maintenant
    )

    data = {
        "version": VERSION,
        "scrape_timestamp": maintenant,
        "offres": nouvelles_offres,
    }

    ecrire_json_atomique(HISTORY_FILE, historique)
    ecrire_json_atomique(DATA_FILE, data)

    print()
    print(f"Termine : {len(nouvelles_offres)} annonce(s)")
    print(f"Fichiers ecrits : {DATA_FILE}, {HISTORY_FILE}")


if __name__ == "__main__":
    main()