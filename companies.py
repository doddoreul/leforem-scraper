"""Compatibility entry point.

The employer index now lives in :mod:`leforem_scraper.employers`. This
module keeps ``python companies.py`` and ``import companies`` working,
without duplicating a single line of logic.

The data folder has a single source of truth,
:data:`leforem_scraper.config.DATA_DIR`; this module deliberately does not
re-export it, so nobody can point one module at a temporary folder and leave
the others reading the real one.
"""

from leforem_scraper.employers import *  # noqa: F401,F403
from leforem_scraper.employers import (  # noqa: F401
    VERSION,
    build_index,
    main,
    refresh_index,
    summarize,
)

if __name__ == "__main__":
    main()