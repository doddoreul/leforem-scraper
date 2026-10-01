"""Compatibility entry point.

The helpers now live in :mod:`leforem_scraper.core`. This module keeps
``import core`` working for the scripts, the tests and the documentation,
without duplicating a single line of logic.
"""

from leforem_scraper.core import *  # noqa: F401,F403
from leforem_scraper.core import (  # noqa: F401
    CONTENT_HASH_FIELDS,
    CONTENT_HASH_RULE,
    MISS_BLACKLIST_AFTER,
    SCRAPES_MAX_ENTRIES,
    SCRAPES_VERSION,
)