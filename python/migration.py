"""Migration complète des données.

Exporte ou restaure TOUTES les données de l'application en un seul fichier
JSON :

- les recherches scrapeées (payload complet, y compris les offres) ;
- les détails d'offres mis en cache (``details_*.json``) ;
- les historiques : scrapes, offres disparues et modifications ;
- le profil candidat ;
- l'index des entreprises ;
- la liste noire ;
- l'état du scraping en cours (s'il y en a un) ;
- le suivi de chaque offre : statut, date de statut, remarque, favori et
  priorité.

Le fichier porte un en-tête versionné (``format`` + ``version``) ; il est
lisible à la main et portable d'un poste à l'autre, quel que soit le stockage
sous-jacent (fichiers JSON ou base SQLite). L'import restaure l'état exact de
la sauvegarde : il remplace les recherches, profils et suivis déjà présents.

Usage en ligne de commande, depuis la racine du projet ::

    python -m python.migration export sauvegarde.json
    python -m python.migration import sauvegarde.json

Options communes : ``--data-dir DOSSIER`` (dossier de données cible) et
``--backend json|sqlite`` (stockage cible ; par défaut, le backend actif).
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Dict, List, Optional

from python import config
from python import jsonio

FORMAT = "leforem-scraper"
SCHEMA_VERSION = 1

# Le suivi exploité par l'application : toute entrée exportée porte ces clés,
# afin qu'un import reproduise exactement la ligne d'origine (y compris les
# valeurs vides).
TRACKING_KEYS = ("statut", "statut_date", "remarque", "favori", "priorite")


def _all_bases(storage: Any) -> List[str]:
    """Every base name the storage knows about.

    A search written under an old name can leave tracking, details or a
    history behind without a current ``scrapings`` row. Exporting only the
    scrape names would silently drop those rows, so the enumeration covers
    the union of every data area.
    """
    names = set(storage.get_scraping_names())
    for getter in (
        "get_tracking_bases",
        "get_details_bases",
        "get_history_offers_bases",
    ):
        method = getattr(storage, getter, None)
        if method is not None:
            names.update(method())
    return sorted(names)


def export_document(storage: Any) -> Dict[str, Any]:
    """Build the complete, versioned dump of every stored data area."""
    searches: List[Dict[str, Any]] = []
    for name in _all_bases(storage):
        searches.append(
            {
                "name": name,
                "payload": storage.read_scraping(name),
                "details": storage.read_details(name),
                "history_offers": storage.read_history_offers(name),
                "tracking": storage.read_tracking(name),
            }
        )
    return {
        "format": FORMAT,
        "version": SCHEMA_VERSION,
        "exported_at": jsonio.now_iso_timestamp(),
        "searches": searches,
        "profile": storage.read_profile(),
        "companies": storage.read_companies(),
        "blacklist": storage.read_blacklist(),
        "history_scrapes": storage.read_history_scrapes(),
        "history_modifications": storage.read_history_modifications(),
        "scrape_state": storage.read_scrape_state(),
    }


def write_export(path: str, storage: Any = None) -> str:
    """Write the full dump of ``storage`` to ``path`` (atomically)."""
    if storage is None:
        from python.storage import get_storage

        storage = get_storage()
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    jsonio.write_json_atomically(path, export_document(storage))
    return path


def read_export(path: str) -> Dict[str, Any]:
    """Load ``path`` and check it looks like one of our dumps."""
    document = jsonio.read_json(path, None)
    if not isinstance(document, dict):
        raise ValueError("Le fichier n'est pas un JSON lisible.")
    if document.get("format") != FORMAT:
        raise ValueError(
            "Ce fichier n'est pas une sauvegarde leforem-scraper "
            "(format inconnu %r)."
            % document.get("format")
        )
    if document.get("version") != SCHEMA_VERSION:
        raise ValueError(
            "Version de sauvegarde %r non prise en charge (attendue : %r)."
            % (document.get("version"), SCHEMA_VERSION)
        )
    return document


def import_document(document: Dict[str, Any], storage: Any) -> Dict[str, Any]:
    """Restore every data area from a dump.

    The searches come from ``document["searches"]``; the searches already
    present in ``storage`` are replaced, as are the profile, the employers,
    the blacklist and the histories. Returns a count map, in French keys, so
    the web UI can show them as-is.
    """
    errors = _validate(document)
    if errors:
        raise ValueError(errors)

    searches = document.get("searches", [])
    counts: Dict[str, Any] = {
        "recherches": 0,
        "offres": 0,
        "details": 0,
        "suivi": 0,
    }

    # 1. Nettoie le périmètre : l'import restaure l'état exact de la
    #    sauvegarde, donc les recherches ET les zones orphelines (suivi,
    #    détails, historiques sous d'anciens noms de base) sont remplacés.
    for name in _all_bases(storage):
        storage.delete_scraping(name)
        for offer_id in list(storage.read_tracking(name)):
            storage.delete_tracking(name, offer_id)

    # 2. Réécrit chaque base de la sauvegarde. Une base peut n'exister que
    #    pour son suivi (plus de scraping sous ce nom) : seul son payload est
    #    alors absent.
    for search in searches:
        name = search["name"]
        payload = search.get("payload")
        if isinstance(payload, dict):
            storage.write_scraping(name, payload)
            counts["recherches"] += 1

            offers = payload.get("offers", [])
            counts["offres"] += len(offers) if isinstance(offers, list) else 0

        details = search.get("details")
        if isinstance(details, dict) and details:
            storage.write_details(name, details)
            counts["details"] += len(details)

        history = search.get("history_offers")
        if isinstance(history, dict) and history:
            storage.write_history_offers(name, history)

        tracking = search.get("tracking")
        if isinstance(tracking, dict):
            for offer_id, fields in tracking.items():
                if not isinstance(fields, dict):
                    continue
                complete = {key: fields.get(key) for key in TRACKING_KEYS}
                storage.write_tracking(name, str(offer_id), complete)
                counts["suivi"] += 1

    # 3. Les zones partagées. Les clés absentes d'une sauvegarde plus
    #    ancienne sont laissées telles quelles.
    if "profile" in document:
        storage.write_profile(document["profile"] or {})
    if "companies" in document:
        storage.write_companies(document["companies"] or {})
    if "blacklist" in document:
        storage.write_blacklist(document["blacklist"] or {})
    if "history_scrapes" in document:
        storage.write_history_scrapes(document["history_scrapes"] or [])
    if "history_modifications" in document:
        storage.write_history_modifications(document["history_modifications"] or {})
    if "scrape_state" in document:
        if document["scrape_state"]:
            storage.write_scrape_state(document["scrape_state"])
        else:
            storage.delete_scrape_state()

    return counts


def _validate(document: Any) -> Optional[str]:
    """First-pass validation, before anything is written (fail fast)."""
    if not isinstance(document, dict):
        return "Sauvegarde illisible : le contenu n'est pas un objet JSON."
    if document.get("format") != FORMAT:
        return "Ce fichier n'est pas une sauvegarde leforem-scraper."
    if document.get("version") != SCHEMA_VERSION:
        return (
            "Version de sauvegarde non prise en charge : %r."
            % document.get("version")
        )
    searches = document.get("searches")
    if not isinstance(searches, list):
        return "Sauvegarde illisible : la section 'searches' est absente."
    for search in searches:
        if not isinstance(search, dict):
            return "Sauvegarde illisible : une recherche n'est pas un objet."
        name = search.get("name", "")
        if not config.valid_search_name(name):
            return "Nom de recherche invalide dans la sauvegarde : %r." % name
        if not isinstance(search.get("payload"), dict):
            # A base may only carry tracking under a stale name: its payload
            # is legitimately absent.
            if search.get("payload") is not None:
                return "Recherche %r sans contenu (payload) valide." % name
    return None


def _storage_from_args(args: argparse.Namespace) -> Any:
    """The storage the CLI works on, from ``--data-dir`` and ``--backend``."""
    if args.data_dir:
        config.DATA_DIR = args.data_dir
    if args.backend:
        os.environ["LEFOREM_STORAGE"] = args.backend
    from python.storage import get_storage

    return get_storage()


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m python.migration",
        description="Exporte ou restaure toutes les données leforem-scraper.",
    )
    subparsers = parser.add_subparsers(dest="commande", required=True)

    export = subparsers.add_parser("export", help="écrit une sauvegarde complète")
    export.add_argument("fichier", help="chemin du fichier JSON à créer")
    _add_common_options(export)

    import_ = subparsers.add_parser("import", help="restaure une sauvegarde")
    import_.add_argument("fichier", help="chemin du fichier JSON à lire")
    _add_common_options(import_)

    args = parser.parse_args(argv)

    try:
        storage = _storage_from_args(args)
        if args.commande == "export":
            write_export(args.fichier, storage)
            document = read_export(args.fichier)
            searches = [s for s in document["searches"]
                        if isinstance(s.get("payload"), dict)]
            tracked = sum(len(s.get("tracking", {}))
                          for s in document["searches"])
            print(
                "Données exportées dans %s (%d recherche(s), %d suivi(s))."
                % (args.fichier, len(searches), tracked)
            )
        else:
            document = read_export(args.fichier)
            counts = import_document(document, storage)
            print(
                "Données importées : %(recherches)d recherche(s), "
                "%(offres)d offre(s), %(details)d détail(s), "
                "%(suivi)d offre(s) suivie(s)." % counts
            )
    except ValueError as exc:
        print("Erreur : %s" % exc, file=sys.stderr)
        return 2
    except OSError as exc:
        print("Erreur d'accès au fichier : %s" % exc, file=sys.stderr)
        return 2

    return 0


def _add_common_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--data-dir",
        help="dossier de données cible (défaut : le dossier standard)",
    )
    parser.add_argument(
        "--backend",
        choices=["json", "sqlite"],
        help="stockage cible (défaut : le backend actif)",
    )


if __name__ == "__main__":
    sys.exit(main())