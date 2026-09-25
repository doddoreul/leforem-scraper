import argparse
import concurrent.futures
import json
import os
import random
import re
import sys
import threading
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

OCCUPATION_GUID = "fb3c1045-2adc-49ea-85d1-b5678c7bcd1f"
LOCATION_GUID = "38215355-5f89-48ea-a728-14cfbc9a4b82"

ROW = 50

# Polite scraping: bounded parallelism + global rate limit.
MAX_WORKERS = 4
REQUEST_INTERVAL = 0.35
JITTER = 0.1
MAX_ATTEMPTS = 3
RETRY_BACKOFF = 2.0

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
BLACKLIST_FILE = "blacklist.json"
VERSION = 1


# ============================================================
# POLITE REQUEST HELPERS
# ============================================================

_throttle_lock = threading.Lock()
_next_request_at = 0.0
_blacklist_lock = threading.Lock()
_thread_local = threading.local()


def throttle():
    global _next_request_at
    with _throttle_lock:
        now = time.monotonic()
        delay = _next_request_at - now
        if delay > 0:
            time.sleep(delay)
            now = time.monotonic()
        _next_request_at = (
            now + REQUEST_INTERVAL + random.uniform(0, JITTER)
        )


def request_json_with_retry(session, url):
    for attempt in range(1, MAX_ATTEMPTS + 1):
        throttle()
        try:
            response = session.get(url, timeout=30)
        except requests.RequestException:
            if attempt == MAX_ATTEMPTS:
                raise
            time.sleep(RETRY_BACKOFF * attempt)
            continue

        status = response.status_code
        retryable = status == 429 or status >= 500
        if not retryable or attempt == MAX_ATTEMPTS:
            response.raise_for_status()
            return response.json()
        time.sleep(RETRY_BACKOFF * attempt)
    raise requests.RequestException(
        f"Failed after {MAX_ATTEMPTS} attempts"
    )


def get_session():
    session = getattr(_thread_local, "session", None)
    if session is None:
        session = requests.Session()
        session.headers.update(HEADERS)
        _thread_local.session = session
    return session


def draw_progress(done, total, width=40):
    if total <= 0:
        return ""
    filled = int(round(width * done / total))
    bar = "=" * filled + "-" * (width - filled)
    pct = 100.0 * done / total
    return f"[{bar}] {pct:6.1f}% ({done}/{total})"


# ============================================================
# HELPERS
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
    text = parser.get_text()
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def clean_text(value):
    if value is None:
        return ""
    return " ".join(str(value).split()).strip()


def build_summary(description, max_chars=300):
    text = html_to_text(description)
    if not text:
        return ""
    sentences = re.split(r"(?<=[.!?])\s+", text)
    summary = " ".join(sentences[:2]).strip()
    if len(summary) > max_chars:
        summary = summary[:max_chars].rstrip() + "..."
    return summary


# ============================================================
# DETAIL FIELD EXTRACTION
# ============================================================

def format_contract_type(value):
    if not value:
        return ""
    if isinstance(value, dict):
        for key in ("libelle", "label", "nom", "value"):
            v = value.get(key)
            if v:
                return clean_text(v)
        return ""
    return clean_text(value)


def extract_schedule(detail):
    regime = clean_text(detail.get("regimeTravail"))
    period = ""
    shift = detail.get("shift")
    if isinstance(shift, dict):
        period = clean_text(shift.get("shiftPeriod"))
    return " — ".join(part for part in (regime, period) if part)


def extract_pay(benefits, max_chars=25):
    if not isinstance(benefits, dict):
        return ""
    value = benefits.get("basePay")
    if value is None:
        return ""
    text = " ".join(str(value).split()).strip()
    if len(text) > max_chars:
        text = text[:max_chars].rstrip()
    return text


# The source text (benefitsComments, etc.) is written in French by
# employers, so the patterns below intentionally match French wording.
SALARY_KEYWORDS = re.compile(
    r"salaire|salarial(e|es)?|r[eéè]mun[eéé]r|r[eéè]tribution|paye\b", re.I
)
AMOUNT_EUR = re.compile(r"\d[\d\s.,]*\s*€", re.I)
PERIODIC_AMOUNT = re.compile(
    r"€\s*/?\s*(?:h\b|heure|mois|an|semaine|jour)", re.I
)
FRINGE_BENEFITS = re.compile(
    r"ch[eè]ques?-repas|ticket|bon repas|frais de", re.I
)


def extract_salary(detail, max_chars=75):
    sources = (
        detail.get("benefitsComments")
        or detail.get("commentaireGeneral")
        or detail.get("descriptionComment")
        or ""
    )
    text = html_to_text(sources)
    if not text:
        return ""

    sentences = re.split(r"(?<=[.!?])\s+", text)
    chosen = ""

    for sentence in sentences:
        if AMOUNT_EUR.search(sentence) and SALARY_KEYWORDS.search(sentence):
            chosen = sentence
            break

    if not chosen:
        for sentence in sentences:
            if not AMOUNT_EUR.search(sentence):
                continue
            if not PERIODIC_AMOUNT.search(sentence):
                continue
            if FRINGE_BENEFITS.search(sentence):
                continue
            chosen = sentence
            break

    if not chosen:
        return ""

    keyword = SALARY_KEYWORDS.search(chosen)
    if keyword:
        chosen = chosen[keyword.start():]

    chosen = re.sub(r"\s+", " ", chosen).strip()
    if len(chosen) > max_chars:
        chosen = chosen[:max_chars].rstrip() + "…"
    return chosen


def extract_location(workplaces):
    if not workplaces:
        return ""

    values = []

    if isinstance(workplaces, list):
        for item in workplaces:
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
            v = clean_text(v)
            if v and v not in values:
                values.append(v)
    elif isinstance(workplaces, dict):
        v = (
            workplaces.get("nom")
            or workplaces.get("libelle")
            or workplaces.get("ville")
            or ""
        )
        v = clean_text(v)
        if v:
            values.append(v)

    return ", ".join(values)


def build_offer(detail, published_on=""):
    number = clean_text(detail.get("numero"))

    if number:
        url = (
            "https://www.leforem.be/recherche-offres/"
            f"offre-detail/{number}?originPostuler=RECHOFFRE"
        )
    else:
        url = ""

    description = html_to_text(detail.get("descriptionJob"))

    return {
        "number": number,
        "offer_title": clean_text(detail.get("titreOffre")),
        "description": description,
        "company": clean_text(detail.get("nomEmployeur")),
        "url": url,
        "contract_type": format_contract_type(detail.get("typeContrat")),
        "schedule": extract_schedule(detail),
        "pay": extract_pay(detail.get("benefits")),
        "salary": extract_salary(detail),
        "location": extract_location(detail.get("lieuxTravail")),
        "published_on": clean_text(published_on),
        "summary": build_summary(description),
    }


# ============================================================
# OFFER SEARCH
# ============================================================

def search_offers(session, limit=None, occupation_guid=OCCUPATION_GUID, location_guid=LOCATION_GUID):
    payload = {
        "filtres": [],
        "filtresCodifies": [],
        "metier": [],
        "secteur": [],
        "lieuxTravail": [
            {"nom": "Nomenclatures/CodeInsBelge", "guid": location_guid}
        ],
        "locutionsGufids": [occupation_guid],
        "priority": 1,
    }

    seen_numbers = set()
    offers = []
    page = 1

    while True:
        url = f"{SEARCH_URL_BASE}?page={page}&row={ROW}"
        print(f"Search page {page}...")

        throttle()
        response = session.post(url, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()

        results = data.get("offreEmploiResumees") or []
        total = data.get("total", 0)
        page_count = data.get("pageCount") or 1

        print(f"  -> {len(results)} result(s) (total: {total})")

        for offer in results:
            if not isinstance(offer, dict):
                continue
            number = clean_text(offer.get("numero"))
            if not number or number in seen_numbers:
                continue
            seen_numbers.add(number)
            offers.append({
                "number": number,
                "published_on": clean_text(offer.get("publication")),
            })

            if limit is not None and len(offers) >= limit:
                break

        if limit is not None and len(offers) >= limit:
            break

        if page >= page_count:
            break

        page += 1

    print(f"\nOffers retained: {len(offers)}")
    return offers


# ============================================================
# OFFER DETAIL
# ============================================================

def fetch_detail(session, number):
    url = DETAIL_URL.format(number)
    return request_json_with_retry(session, url)


# ============================================================
# JSON FILE READING / WRITING
# ============================================================

def read_json(path, default_model):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if default_model is not None and not isinstance(data, dict):
            return default_model
        return data
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return default_model


def read_previous_offers(path=DATA_FILE):
    data = read_json(path, None)
    if isinstance(data, dict):
        offers = data.get("offers", [])
    elif isinstance(data, list):
        offers = data
    else:
        offers = []

    numbers = {
        clean_text(o.get("number"))
        for o in offers
        if isinstance(o, dict) and clean_text(o.get("number"))
    }
    return offers, numbers


def empty_history(timestamp):
    return {
        "version": VERSION,
        "updated_timestamp": timestamp,
        "offers": [],
    }


def read_history(path=HISTORY_FILE, timestamp=""):
    data = read_json(path, None)
    if isinstance(data, dict) and isinstance(data.get("offers"), list):
        data.setdefault("version", VERSION)
        data.setdefault("updated_timestamp", timestamp)
        return data
    return empty_history(timestamp)


def write_json_atomically(path, content):
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(content, f, ensure_ascii=False, indent=2)
        f.write("\n")
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, path)


def read_blacklist(path=BLACKLIST_FILE):
    data = read_json(path, None)
    if isinstance(data, list):
        return {
            str(number).strip()
            for number in data
            if str(number).strip()
        }
    return set()


def write_blacklist(blacklist, path=BLACKLIST_FILE):
    write_json_atomically(path, sorted(blacklist))


# ============================================================
# REMOVED-OFFERS HISTORY
# ============================================================

def update_history(previous_offers, new_offers, history, timestamp):
    previous_numbers = {
        clean_text(o.get("number"))
        for o in previous_offers
        if isinstance(o, dict)
    }
    new_numbers = {
        clean_text(o.get("number"))
        for o in new_offers
        if isinstance(o, dict)
    }

    previous_by_number = {
        clean_text(o.get("number")): o
        for o in previous_offers
        if isinstance(o, dict)
    }

    # An offer that reappears is removed from the history.
    entries = []
    already_present = set()
    for entry in history.get("offers", []):
        if not isinstance(entry, dict):
            continue
        number = clean_text(entry.get("number"))
        if not number or number in new_numbers or number in already_present:
            continue
        already_present.add(number)
        entries.append(entry)

    # Disappeared offers are added (one entry each).
    removed_numbers = previous_numbers - new_numbers
    for number in sorted(removed_numbers):
        if number in already_present:
            continue
        previous = previous_by_number.get(number, {})
        entry = dict(previous)
        entry["is_new"] = False
        entry["removed"] = True
        entry["removed_on"] = timestamp
        entries.append(entry)
        already_present.add(number)

    history["version"] = VERSION
    history["updated_timestamp"] = timestamp
    history["offers"] = entries
    return history


def now_iso_timestamp():
    return datetime.now().astimezone().isoformat(timespec="seconds")


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Forem offers scraper"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of offers to fetch.",
    )
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Force re-scraping of every offer detail.",
    )
    parser.add_argument(
        "--occupation-guid",
        default=OCCUPATION_GUID,
        help="Occupation GUID (default: industrial electromechanic).",
    )
    parser.add_argument(
        "--location-guid",
        default=LOCATION_GUID,
        help="Work location GUID (default: Liege).",
    )
    parser.add_argument(
        "--base",
        default="",
        help="Scrape name base: writes data_<base>.json and "
             "historique_<base>.json (default: data.json / "
             "historique_supprimees.json).",
    )
    parser.add_argument(
        "--label",
        default="",
        help="Human-readable label for this search (shown in the web UI).",
    )
    args = parser.parse_args()

    if args.limit is not None and args.limit <= 0:
        parser.error("--limit must be a positive integer")

    base_name = re.sub(r"[^A-Za-z0-9_-]+", "-", args.base).strip("-")
    if base_name:
        data_file = f"data_{base_name}.json"
        history_file = f"historique_{base_name}.json"
    else:
        data_file = DATA_FILE
        history_file = HISTORY_FILE

    now = now_iso_timestamp()

    previous_offers, previous_numbers = read_previous_offers(
        path=data_file
    )
    previous_by_number = {
        clean_text(o.get("number")): o
        for o in previous_offers
        if isinstance(o, dict) and clean_text(o.get("number"))
    }
    history = read_history(
        path=history_file, timestamp=now
    )

    blacklist = read_blacklist()
    if blacklist:
        print(f"Blacklisted offers: {len(blacklist)}")

    if base_name:
        print(f"Scrape: {base_name}")
    if args.label:
        print(f"Label: {args.label}")
    print(f"Files: {data_file}, {history_file}")

    if args.limit is not None:
        print(f"Limit requested: {args.limit} offer(s)")
    else:
        print("No limit: fetching every offer.")
    print()

    if args.fresh:
        print("--fresh mode: re-scraping every offer detail.")
    print()

    session = requests.Session()
    session.headers.update(HEADERS)

    search_results = search_offers(
        session,
        limit=args.limit,
        occupation_guid=args.occupation_guid,
        location_guid=args.location_guid,
    )

    new_count = sum(
        1 for entry in search_results
        if entry["number"] not in previous_numbers
        and entry["number"] not in blacklist
    )

    if new_count > 0:
        answer = input(
            f"{new_count} nouvelles annonces trouvées, "
            "souhaitez-vous les scraper? (Y/n) "
        ).strip().lower()
        if answer not in ("", "y", "yes", "o", "oui"):
            print("Annulation. Les fichiers existants sont conservés.")
            return

    new_offers = []
    reused_count = 0

    if search_results:
        total = len(search_results)
        tasks = [
            (index, entry)
            for index, entry in enumerate(search_results, start=1)
            if entry["number"] not in blacklist
        ]
        skipped = total - len(tasks)
        print(
            f"\nFetching details ({len(tasks)} offer(s)) "
            f"with {MAX_WORKERS} parallel workers..."
        )
        if skipped:
            print(f"  ({skipped} blacklisted, skipped)")

        def process_entry(task):
            index, entry = task
            number = entry["number"]
            published_on = entry.get("published_on", "")
            previous = previous_by_number.get(number)

            if (
                not args.fresh
                and previous
                and clean_text(previous.get("published_on"))
                and clean_text(previous.get("published_on")) == published_on
            ):
                offer = dict(previous)
                offer["is_new"] = False
                return task, offer, "reused"

            try:
                detail = fetch_detail(get_session(), number)
                offer = build_offer(
                    detail, published_on=published_on
                )
                offer["is_new"] = number not in previous_numbers
                return task, offer, "fetched"
            except requests.HTTPError as e:
                if (
                    getattr(e, "response", None) is not None
                    and e.response.status_code == 404
                ):
                    return task, None, "404"
                return task, None, f"HTTP error: {e}"
            except requests.RequestException as e:
                return task, None, f"Network error: {e}"
            except Exception as e:
                return task, None, f"Error: {e}"

        done = 0
        fetched_count = 0
        issue_lines = []

        with concurrent.futures.ThreadPoolExecutor(
            max_workers=MAX_WORKERS
        ) as executor:
            for (index, entry), offer, outcome in executor.map(
                process_entry, tasks
            ):
                number = entry["number"]
                if outcome == "reused":
                    new_offers.append(offer)
                    reused_count += 1
                elif outcome == "fetched":
                    new_offers.append(offer)
                    fetched_count += 1
                elif outcome == "404":
                    blacklist.add(number)
                    with _blacklist_lock:
                        write_blacklist(blacklist)
                    issue_lines.append(
                        f"  Offer {number} missing (404): blacklisted"
                    )
                else:
                    issue_lines.append(f"  Offer {number}: {outcome}")
                done += 1
                sys.stdout.write(
                    "\rFetching details: "
                    + draw_progress(done, len(tasks))
                )
                sys.stdout.flush()

        sys.stdout.write("\n")
        sys.stdout.flush()
        for line in issue_lines:
            print(line)

    if not new_offers and not search_results:
        print("\nNo offer found.")

    update_history(
        previous_offers, new_offers, history, now
    )

    data = {
        "version": VERSION,
        "scrape_timestamp": now,
        "name": base_name,
        "label": args.label,
        "occupation_guid": args.occupation_guid,
        "location_guid": args.location_guid,
        "offers": new_offers,
    }

    write_json_atomically(history_file, history)
    write_json_atomically(data_file, data)

    print()
    print(f"Done: {len(new_offers)} offer(s) "
          f"({reused_count} reused, {len(new_offers) - reused_count} fetched)")
    print(f"Files written: {data_file}, {history_file}")


if __name__ == "__main__":
    main()