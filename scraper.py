"""Compatibility entry point.

The scraper now lives in :mod:`leforem_scraper.scraper`. This module keeps
``python scraper.py``, ``import scraper`` and everything the tests reach for
working, without duplicating a single line of logic.

The data folder has a single source of truth,
:data:`leforem_scraper.config.DATA_DIR`; this module deliberately does not
re-export it, so nobody can point one module at a temporary folder and leave
the others reading the real one.
"""

from leforem_scraper.scraper import *  # noqa: F401,F403
from leforem_scraper.scraper import (  # noqa: F401
    BASE_DIR,
    HEADERS,
    VERSION,
    ConsoleReporter,
    ask_confirmation,
    build_offer,
    clean_text,
    details_file,
    fetch_detail,
    get_session,
    listing_hash,
    main,
    normalize_published_on,
    read_blacklist,
    read_details,
    read_history,
    read_json,
    read_previous_offers,
    run_scrape,
    scraper_files,
    search_offers,
    update_history,
    write_blacklist,
    write_json_atomically,
)

if __name__ == "__main__":
    main()