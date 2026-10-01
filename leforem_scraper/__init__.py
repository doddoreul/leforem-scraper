"""Forem offers scraper, local web interface and employer index.

The package is organised by responsibility rather than by entry point:

- ``config``    where things are read from and written to (paths, layout)
- ``jsonio``    reading and writing JSON files
- ``core``      pure analysis helpers, no network, no filesystem
- ``scraper``   talking to the Forem website and turning it into offers
- ``employers`` the employer index built from the scraped offers
- ``server``    the local HTTP server and its routes

The scripts at the repository root (``scraper.py``, ``serveur.py``,
``companies.py``) are thin entry points that only forward to the modules
here, so the documented commands keep working unchanged.
"""

__all__ = ["__version__"]

__version__ = "1.0.0"