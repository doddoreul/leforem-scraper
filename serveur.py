"""Compatibility entry point.

The server now lives in :mod:`leforem_scraper.server`. This module keeps
``python serveur.py`` and ``import serveur`` working (the tests and the
documentation use both), without duplicating a single line of logic.

The data folder has a single source of truth,
:data:`leforem_scraper.config.DATA_DIR`; this module deliberately does not
re-export it, so nobody can point one module at a temporary folder and leave
the others reading the real one.
"""

from leforem_scraper.server import *  # noqa: F401,F403
from leforem_scraper.server import (  # noqa: F401
    BASE_DIR,
    PORT,
    Handler,
    StreamReporter,
    main,
)

if __name__ == "__main__":
    main()