# -*- coding: utf-8 -*-
"""Belgian postal codes, resolved from the open dataset cached in data/.

The Forem publishes the workplace as free text ("LIÈGE", "Herstal"), never as a
postal code. This module reads the open dataset that maps postal codes to
localities, caches it once, and answers "which codes serve this place?" so the
offers can carry them and the search box can find them.

Nothing here is fetched at request time: the dataset is a file, and only
``refresh`` goes to the network.

    python -m python.postal --refresh
    python -m python.postal --stats

ODWB's own "api" URL answers HTML; the JSON lives on the OpenDataSoft v2 route.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import unicodedata
from typing import Any, Dict, List, Optional

from python import config

DATASET_NAME = "code-postaux-belge"
RECORDS_URL = (
    "https://www.odwb.be/api/explore/v2.1/catalog/datasets/"
    + DATASET_NAME
    + "/records"
)
PAGE_SIZE = 100
REQUEST_TIMEOUT = 60
# 1145 codes for Belgium; anything past this means the page loop went wrong.
MAX_ROWS = 20000

# Same folding as js/shared/text.js, so a place typed by an employer and a
# place named by the dataset meet on the same key.
LIGATURES = {
    "œ": "oe",
    "æ": "ae",
    "ø": "o",
    "ß": "ss",
    "đ": "d",
    "ł": "l",
}

# An index, keyed by folded locality, rebuilt whenever the cached file changes
# so a server already running picks up a dataset downloaded after it started.
_INDEX: Optional[Dict[str, List[str]]] = None
_INDEX_SIGNATURE: Optional[Any] = None


def dataset_path() -> str:
    """Where the cached dataset lives."""
    return config.postal_codes_file()


def fold(value: Any) -> str:
    """Lowercase, drop accents and ligatures, squeeze spaces."""
    text = str(value or "").strip().lower().replace("'", " ").replace("-", " ")
    for source, target in LIGATURES.items():
        text = text.replace(source, target)
    decomposed = unicodedata.normalize("NFD", text)
    kept = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(kept.split())


def _session():
    import requests

    session = requests.Session()
    session.headers.update({"User-Agent": "leforem-scraper"})
    return session


def fetch_rows() -> List[Dict[str, Any]]:
    """Download the whole dataset, one page at a time."""
    session = _session()
    rows: List[Dict[str, Any]] = []
    total: Optional[int] = None

    while len(rows) < MAX_ROWS:
        params = {"limit": PAGE_SIZE, "offset": len(rows)}
        response = session.get(RECORDS_URL, params=params, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        payload = response.json()

        if total is None:
            total = payload.get("total_count")
        batch = payload.get("results") or []
        rows.extend(batch)
        if not batch or (total is not None and len(rows) >= total):
            break

    return rows


def build_index(rows: List[Dict[str, Any]]) -> Dict[str, List[str]]:
    """Folded locality -> the postal codes serving it, sorted.

    Several codes can serve one place, and one code can serve several places,
    so both directions are lists.
    """
    index: Dict[str, List[str]] = {}

    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get(config.POSTAL_CODE_FIELD) or "").strip()
        place = fold(row.get(config.POSTAL_LOCALITY_FIELD))
        if not code or not place:
            continue
        codes = index.setdefault(place, [])
        if code not in codes:
            codes.append(code)

    for codes in index.values():
        codes.sort()

    return index


def write_dataset(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    """Cache the raw dataset, so the mapping is auditable and refreshable."""
    payload = {
        "source": RECORDS_URL,
        "dataset": DATASET_NAME,
        "rows": rows,
    }
    path = dataset_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)

    return {"rows": len(rows), "localities": len(build_index(rows))}


def read_dataset() -> Optional[List[Dict[str, Any]]]:
    """The cached rows, or None when the dataset was never downloaded."""
    path = dataset_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, ValueError):
        return None
    rows = payload.get("rows")
    return rows if isinstance(rows, list) else None


def dataset_signature() -> Optional[Any]:
    """What tells one version of the cached file from another."""
    try:
        info = os.stat(dataset_path())
    except OSError:
        return None
    return (info.st_mtime_ns, info.st_size)


def load_index() -> Dict[str, List[str]]:
    """The folded locality index, rebuilt when the cached file changes.

    Holding it for the whole life of the process looked cheaper, but a server
    started before "python -m python.postal --refresh" would then never find a
    postal code, and nothing would say why. One stat per request buys that back.

    The signature is size and modification time. A rewrite of the same size
    inside one filesystem timestamp tick would go unnoticed, which does not
    arise in practice: a refresh writes a different file.
    """
    global _INDEX, _INDEX_SIGNATURE

    signature = dataset_signature()
    if _INDEX is None or signature != _INDEX_SIGNATURE:
        rows = read_dataset()
        _INDEX = build_index(rows) if rows else {}
        _INDEX_SIGNATURE = signature

    return _INDEX


def postal_codes_for(location: Any) -> List[str]:
    """The codes serving a place, or an empty list when it is unknown.

    An offer may list several workplaces joined by commas
    ("Arrondissement de Waremme, Hannut"). Every part is tried, and a place
    counts as soon as one part is known.
    """
    index = load_index()
    if not index:
        return []

    codes: List[str] = []
    for part in str(location or "").split(","):
        key = fold(part)
        if key == "":
            continue
        for code in index.get(key, []):
            if code not in codes:
                codes.append(code)

    return sorted(codes)


def enrich_offers(offers: Any) -> int:
    """Attach postalCodes to each offer, in place.

    Returns how many offers got at least one code. Called on the way out of the
    server, never on the way in to storage: what is stored stays untouched, and
    the content hashes stay valid.
    """
    if not isinstance(offers, list):
        return 0

    index = load_index()
    if not index:
        return 0

    enriched = 0
    for offer in offers:
        if not isinstance(offer, dict):
            continue
        codes = postal_codes_for(offer.get("location"))
        if codes:
            offer[config.POSTAL_CODES_FIELD] = codes
            enriched += 1
        else:
            offer.pop(config.POSTAL_CODES_FIELD, None)

    return enriched


def stats() -> Dict[str, Any]:
    rows = read_dataset()
    if rows is None:
        return {"cached": False, "path": dataset_path()}

    index = build_index(rows)
    with_commune = sum(
        1
        for row in rows
        if isinstance(row, dict) and row.get(config.POSTAL_COMMUNE_FIELD)
    )
    return {
        "cached": True,
        "path": dataset_path(),
        "rows": len(rows),
        "localities": len(index),
        "codes": len({c for codes in index.values() for c in codes}),
        "with_commune": with_commune,
    }


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Codes postaux belges, a partir du jeu ouvert ODWB."
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="retelecharge le jeu de donnees et l'ecrit dans data/",
    )
    parser.add_argument(
        "--stats",
        action="store_true",
        help="compte les localites et les codes mis en cache",
    )
    args = parser.parse_args(argv)

    if args.refresh:
        try:
            rows = fetch_rows()
        except Exception as error:  # network, HTTP or malformed JSON
            print("Telechargement impossible : %s" % error, file=sys.stderr)
            return 1
        if not rows:
            print("Le jeu de donnees est vide, rien n'est ecrit.", file=sys.stderr)
            return 1
        written = write_dataset(rows)
        print(
            "Jeu de donnees ecrit : %d lignes, %d localites -> %s"
            % (written["rows"], written["localities"], dataset_path())
        )

    if args.stats or not args.refresh:
        summary = stats()
        if not summary["cached"]:
            print(
                "Aucun jeu de donnees en cache (%s).\n"
                "Lance : python -m python.postal --refresh" % summary["path"]
            )
            return 0 if args.stats else 1
        print(
            "%d lignes, %d localites, %d codes, %d lignes avec commune"
            % (
                summary["rows"],
                summary["localities"],
                summary["codes"],
                summary["with_commune"],
            )
        )
        print("Fichier : %s" % summary["path"])

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
