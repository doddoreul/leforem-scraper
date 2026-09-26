"""Pure analysis helpers shared by scrapper.py and the test suite.

Kept dependency-free (no requests) so the logic can be unit-tested
without touching the Forem website or the filesystem layout beyond
passed-in dictionaries.
"""

import json
import re
from datetime import date, datetime


# ============================================================
# IDENTIFICATION
# ============================================================

def clean_number(value):
    """Offer numbers are the primary key: normalize to a plain string."""
    if value is None:
        return ""
    return str(value).strip()


def norm_text(value):
    """Whitespace-normalized text used for comparisons."""
    if value is None:
        return ""
    return " ".join(str(value).split()).strip()


# ============================================================
# CHANGE DETECTION
# ============================================================

# Fields that matter to the candidate. Rewrites are purposeful: a
# change in one of these is worth reporting. `summary` and `url` are
# derived from/identical to other fields, so they are left out.
COMPARE_FIELDS = (
    "offer_title",
    "company",
    "location",
    "contract_type",
    "schedule",
    "pay",
    "salary",
    "email",
    "published_on",
    "date_publication",
    "date_fin_diffusion",
    "date_modification",
    "description",
)

# Technical fields never considered as user-facing changes.
TECHNICAL_FIELDS = {
    "is_new",
    "summary",
    "url",
    "offer_state",
    "reappeared",
    "removed",
    "removed_on",
    "first_seen",
    "changes",
}


def compare_offers(previous, current):
    """Return {field: {"old": ..., "new": ...}} for significant diffs.

    A field already present in `previous` is required: newly-introduced
    columns (schema migrations) are ignored so a first run does not
    flag every offer as "modified".
    """
    changes = {}
    if not isinstance(previous, dict) or not isinstance(current, dict):
        return changes
    for field in COMPARE_FIELDS:
        if field not in previous:
            continue
        old_value = norm_text(previous.get(field))
        new_value = norm_text(current.get(field))
        if old_value != new_value:
            changes[field] = {"old": old_value, "new": new_value}
    return changes


def offer_state_for(number, previous_numbers, deleted_numbers, changes):
    """Classify a *current* offer: new / updated / unchanged / reappeared."""
    if number in previous_numbers:
        return "updated" if changes else "unchanged"
    if number in deleted_numbers:
        return "reappeared"
    return "new"


def collect_states(previous_offers, current_offers, deleted_numbers):
    """Compute the full state picture of one scrape.

    Returns a dict mapping each state to the list of numbers in it.
    """
    previous = {}
    for offer in previous_offers:
        if isinstance(offer, dict) and clean_number(offer.get("number")):
            previous[clean_number(offer.get("number"))] = offer
    previous_numbers = set(previous)
    current_numbers = set()

    states = {
        "new": [],
        "updated": [],
        "unchanged": [],
        "reappeared": [],
        "deleted": [],
    }

    for offer in current_offers:
        if not isinstance(offer, dict):
            continue
        number = clean_number(offer.get("number"))
        if not number or number in current_numbers:
            continue
        current_numbers.add(number)
        changes = compare_offers(previous.get(number, {}), offer)
        state = offer_state_for(number, previous_numbers, deleted_numbers, changes)
        states[state].append(number)

    for number in sorted(previous_numbers - current_numbers):
        states["deleted"].append(number)

    return states, current_numbers


def summarize_scrape(states, total=None):
    """Compact counter dict used by the scrape history."""
    return {
        "nouvelles": len(states["new"]),
        "modifiees": len(states["updated"]),
        "inchangees": len(states["unchanged"]),
        "reapparues": len(states["reappeared"]),
        "supprimees": len(states["deleted"]),
        "total_offres": total if total is not None
        else len(states["new"]) + len(states["updated"]) + len(states["unchanged"])
        + len(states["reappeared"]),
    }


# ============================================================
# MODIFICATIONS HISTORY
# ============================================================

MODIFICATIONS_VERSION = 1


def empty_modifications(timestamp):
    return {
        "version": MODIFICATIONS_VERSION,
        "updated_timestamp": timestamp,
        "offers": {},
    }


def read_modifications(path, timestamp=""):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return empty_modifications(timestamp)
        if not isinstance(data.get("offers"), dict):
            data["offers"] = {}
        data.setdefault("version", MODIFICATIONS_VERSION)
        data.setdefault("updated_timestamp", timestamp)
        return data
    except (OSError, json.JSONDecodeError):
        return empty_modifications(timestamp)


def append_modification(history, number, changes, timestamp, event=None):
    """Record a change event for an offer.

    Identical consecutive events are collapsed (same field/old/new set)
    into a single entry whose date is refreshed, avoiding duplicates.
    """
    offers = history.setdefault("offers", {})
    entry = {"date": timestamp}
    if event is not None:
        entry["event"] = event
    else:
        entry["changes"] = changes

    stack = offers.get(number)
    if stack and isinstance(stack, list):
        last = stack[-1]
        if isinstance(last, dict):
            last_changes = last.get("changes")
            if (
                entry.get("event") == last.get("event")
                and last_changes == changes
            ):
                last["date"] = timestamp
                return history
    offers.setdefault(number, []).append(entry)
    return history


# ============================================================
# SCRAPE HISTORY (per search)
# ============================================================

SCRAPES_VERSION = 1
SCRAPES_MAX_ENTRIES = 500


def empty_scrape_history():
    return {"version": SCRAPES_VERSION, "scrapes": []}


def read_scrape_history(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or not isinstance(data.get("scrapes"), list):
            return empty_scrape_history()
        data.setdefault("version", SCRAPES_VERSION)
        return data
    except (OSError, json.JSONDecodeError):
        return empty_scrape_history()


def record_scrape(history, entry):
    """Insert a scrape entry. A previous entry with the identical
    timestamp is replaced (re-run of the same scrape)."""
    scrapes = history.setdefault("scrapes", [])
    timestamp = entry.get("timestamp", "")
    search = entry.get("search", "")
    for index, current in enumerate(scrapes):
        if isinstance(current, dict) and (
            current.get("timestamp") == timestamp
            and current.get("search") == search
        ):
            scrapes[index] = entry
            break
    else:
        scrapes.append(entry)
    if len(scrapes) > SCRAPES_MAX_ENTRIES:
        del scrapes[: len(scrapes) - SCRAPES_MAX_ENTRIES]
    return history


def merge_details(previous, fetched, keep):
    """Merge the raw detail payloads of two runs into one store.

    `previous` and `fetched` are dicts {number: payload}. Payloads are
    kept only for numbers in `keep` (current offers + deleted tombstone).
    A range freshly fetched this run always wins over the cached one.
    """
    merged = {}
    if isinstance(previous, dict):
        for number in keep:
            payload = previous.get(number)
            if payload is not None:
                merged[number] = payload
    if isinstance(fetched, dict):
        for number, payload in fetched.items():
            if payload is not None:
                merged[number] = payload
    return merged


# ============================================================
# DATES
# ============================================================

def parse_forem_date(value):
    """Normalize the various date formats found on the Forem API into
    YYYY-MM-DD (or "" when unknown).

    Accepts DD/MM/YYYY ("16/09/2026"), DD-MM-YY ("16-09-26") and ISO
    timestamps ("2026-09-16T00:00:00+02:00").
    """
    text = clean_number(value)
    if not text:
        return ""

    match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", text)
    if match:
        day, month, year = match.groups()
        return "%s-%s-%s" % (year, month.zfill(2), day.zfill(2))

    match = re.match(r"^(\d{1,2})-(\d{1,2})-(\d{2})$", text)
    if match:
        day, month, year = match.groups()
        return "20%s-%s-%s" % (year, month.zfill(2), day.zfill(2))

    match = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", text)
    if match:
        year, month, day = match.groups()
        return "%s-%s-%s" % (year, month.zfill(2), day.zfill(2))

    return ""


def days_between(value, today=None):
    """Days between ISO date `value` and today (negative = in the past)."""
    iso = parse_forem_date(value)
    if not iso:
        return None
    try:
        target = date(*[int(part) for part in iso.split("-")])
    except ValueError:
        return None
    today = today or date.today()
    return (target - today).days


# ============================================================
# SALARY ANALYSIS
# ============================================================

HOURLY_HINT_PATTERN = re.compile(
    r"/\s*h\b|(?:^|\s)l[''´`]?\s*heure|par\s+heure|horaire", re.I
)
AMOUNT_PATTERN = re.compile(r"\d{1,3}(?:[.,]\d{1,2})?")


def has_salary(offer):
    """True when some remuneration info is present."""
    text = norm_text(offer.get("salary") or offer.get("pay"))
    return bool(text)


def extract_hourly_values(text):
    """Return numeric €/hour values when the text is clearly hourly.

    Returns [] when the text is not expressed per hour or cannot be
    parsed reliably (never invents or mixes €/month / €/year values).
    """
    if not text:
        return []
    lower = text.lower()
    if not HOURLY_HINT_PATTERN.search(lower):
        return []
    amounts = []
    for match in AMOUNT_PATTERN.finditer(text):
        raw = match.group().replace(",", ".")
        try:
            value = float(raw)
        except ValueError:
            continue
        if 0 < value <= 200:
            amounts.append(value)
    return sorted(set(amounts))


def analyze_salaries(offers):
    """Aggregate remuneration facts across offers.

    Returns:
      {"renseignees": n, "total": n,
       "hourly": [values...]} with hourly values only when the offers
       are expressed per hour (comparable unit).
    """
    total = 0
    renseignees = 0
    hourly = []
    for offer in offers:
        if not isinstance(offer, dict):
            continue
        total += 1
        if has_salary(offer):
            renseignees += 1
        hourly.extend(extract_hourly_values(offer.get("salary") or offer.get("pay")))
    return {
        "renseignees": renseignees,
        "total": total,
        "hourly": sorted(set(hourly)),
    }


def mean(values):
    if not values:
        return None
    return sum(values) / len(values)


def median(values):
    if not values:
        return None
    ordered = sorted(values)
    size = len(ordered)
    if size % 2 == 1:
        return ordered[size // 2]
    return (ordered[size // 2 - 1] + ordered[size // 2]) / 2


# ============================================================
# BLACKLIST / MISS POLICY
# ============================================================

# Number of consecutive 404/miss outcomes before a number is skipped
# during the detail phase (it can still be recovered explicitly).
MISS_BLACKLIST_AFTER = 2


def empty_blacklist():
    return {}


def read_blacklist_data(data):
    """Accept both the legacy list format and the current dict format.

    Legacy: ["1880409", ...]  ->  {"1880409": {"attempts": INF, ...}}
    Current: {"1880409": {"first_seen": ..., "last_seen": ..., "attempts": n}}
    """
    if isinstance(data, list):
        result = {}
        for number in data:
            number = clean_number(number)
            if number:
                result[number] = {"attempts": MISS_BLACKLIST_AFTER + 1}
        return result
    if isinstance(data, dict):
        result = {}
        for number, entry in data.items():
            number = clean_number(number)
            if not number:
                continue
            if isinstance(entry, dict):
                result[number] = {
                    "first_seen": clean_number(entry.get("first_seen")),
                    "last_seen": clean_number(entry.get("last_seen")),
                    "attempts": int(entry.get("attempts") or 0),
                }
            else:
                result[number] = {"attempts": MISS_BLACKLIST_AFTER + 1}
        return result
    return {}


def should_fetch(number, blacklist, force=False):
    """Whether the scraper should request the detail for this number.

    A single 404 never blocks the next attempt (temporary errors are
    retried). Only after MISS_BLACKLIST_AFTER consecutive misses is the
    number skipped; `force` (--retry-blacklist / --fresh) bypasses it.
    """
    if force:
        return True
    entry = blacklist.get(number)
    if not entry:
        return True
    return int(entry.get("attempts") or 0) < MISS_BLACKLIST_AFTER


def note_miss(blacklist, number, timestamp):
    """Register a 404/HTTP error for a number (increments attempts)."""
    entry = blacklist.get(number) or {}
    if not entry.get("first_seen"):
        entry["first_seen"] = timestamp
    entry["last_seen"] = timestamp
    entry["attempts"] = int(entry.get("attempts") or 0) + 1
    blacklist[number] = entry


def note_recovery(blacklist, number):
    """A successful fetch removes the number from the blacklist."""
    blacklist.pop(number, None)