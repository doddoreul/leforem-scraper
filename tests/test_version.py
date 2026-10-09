# -*- coding: utf-8 -*-
"""Tests of the application version served to the pages.

The version lives in ``electron/package.json`` (single source of truth);
``python/version.py`` is its reflection so the packaged backend can serve
it, and the cogwheel menu shows it. A drift between the two is a bug, so it
is checked here.

Run from the repository root:
    python -m unittest discover -s tests
"""

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

import requests

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)

from python import config  # noqa: E402
from python import server as server_module  # noqa: E402
from python.version import VERSION  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PACKAGE_JSON = os.path.join(REPO_ROOT, "electron", "package.json")


class TestVersionFile(unittest.TestCase):
    """The reflection never drifts from the package version."""

    def package_version(self):
        with open(PACKAGE_JSON, encoding="utf-8") as handle:
            return json.load(handle)["version"]

    def test_version_matches_package_json(self):
        self.assertEqual(VERSION, self.package_version())

    def test_version_looks_like_a_release(self):
        self.assertRegex(VERSION, r"^\d+\.\d+\.\d+$")


class TestVersionRoute(unittest.TestCase):
    """The pages read the version from GET /api/version."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved = config.DATA_DIR
        config.DATA_DIR = self.tmp.name
        os.environ["LEFOREM_STORAGE"] = "json"
        from python.storage import reset_storage
        reset_storage()

        from python import server
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever)
        self.thread.daemon = True
        self.thread.start()

    def tearDown(self):
        from python.storage import reset_storage
        reset_storage()
        config.DATA_DIR = self._saved
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)
        self.tmp.cleanup()

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def test_the_route_serves_the_version(self):
        response = requests.get(self.url("/api/version"), timeout=10)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"version": VERSION})

    def test_the_updater_reads_the_same_version(self):
        """The update check compares against this very number."""
        from python.version import VERSION as served

        self.assertEqual(served, VERSION)
