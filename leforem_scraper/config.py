"""Where the application reads from and writes to.

Everything that builds a path lives here, so the layout of ``data/`` is
described in a single place.

The data directory is a module attribute on purpose: the tests point it at
a temporary directory, and the command line accepts ``--data-dir``. Resolve
it through :func:`data_dir` rather than caching it at import time.
"""

import os

# Repository root, i.e. the folder holding the entry-point scripts.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Folder holding every generated file.
DATA_DIR = os.path.join(BASE_DIR, "data")

# Files shared by all searches.
SCRAPES_FILE_NAME = "historique_scrapes.json"
BLACKLIST_FILE_NAME = "blacklist.json"
COMPANIES_FILE_NAME = "companies.json"
MODIFICATIONS_FILE_NAME = "historique_modifications.json"

# Format version of the scraper history files.
VERSION = 1


def data_dir():
    """The current data directory (read at call time, not cached)."""
    return DATA_DIR


def trash_dir():
    """Deleted searches are moved aside instead of being removed."""
    return os.path.join(data_dir(), "trash")


def shared_file(name):
    """A file shared by every search, e.g. the blacklist."""
    return os.path.join(data_dir(), name)


def scrapes_file():
    return shared_file(SCRAPES_FILE_NAME)


def blacklist_file():
    return shared_file(BLACKLIST_FILE_NAME)


def companies_file():
    return shared_file(COMPANIES_FILE_NAME)


def scrape_base(file_name):
    """The search name a data file belongs to.

    ``data.json`` is the default search, ``data_liege.json`` is ``liege``.
    Returns ``""`` for anything that is not a data file.
    """
    if not file_name.startswith("data"):
        return None
    if not file_name.endswith(".json"):
        return None
    return file_name[len("data"):-len(".json")].lstrip("_")


def data_file(base_name):
    """The offers of one search, the file the page actually reads.

    The separator is always there, so the default search is ``data_.json``.
    """
    return os.path.join(data_dir(), f"data_{base_name}.json")


def history_file(base_name):
    """The offers of one search that have disappeared over time."""
    return os.path.join(data_dir(), f"historique_{base_name}.json")


def details_file(base_name):
    """Cached detail payloads of one search, used for the extra fields."""
    return os.path.join(data_dir(), f"details_{base_name}.json")


def scrape_files(base_name):
    """(offers, history) paths of one search."""
    return data_file(base_name), history_file(base_name)