# -*- coding: utf-8 -*-
"""Tests for the static files served by the local server.

The pages are plain ES modules: one file per page in js/pages/ and the
modules they share in js/shared/ and js/boot/. What is checked here is that
the server hands them over as JavaScript, that nothing outside js/ escapes,
and that the old root scripts are gone.

Run from the repository root:
    python -m unittest discover -s tests -v
"""

import os
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

import requests

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)

from leforem_scraper import config
from leforem_scraper import server

PAGES = ("index", "insights", "companies", "detail")


class StaticFilesTestCase(unittest.TestCase):
    """Boots the real server on a temporary data directory."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved = config.DATA_DIR
        config.DATA_DIR = self.tmp.name

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.daemon = True
        self.thread.start()

    def tearDown(self):
        config.DATA_DIR = self._saved
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.tmp.cleanup()

    def get(self, path, **kwargs):
        return requests.get(
            f"http://127.0.0.1:{self.port}{path}", timeout=10, **kwargs
        )


class TestPages(StaticFilesTestCase):
    def test_every_page_is_served(self):
        for page in PAGES:
            with self.subTest(page=page):
                response = self.get(f"/{page}.html")
                self.assertEqual(response.status_code, 200)
                self.assertIn("text/html", response.headers["Content-Type"])

    def test_a_page_loads_its_own_module(self):
        for page in PAGES:
            with self.subTest(page=page):
                body = self.get(f"/{page}.html").text
                self.assertIn(f'js/pages/{page}.js', body)
                self.assertIn("js/boot/theme-boot.js", body)

    def test_the_theme_boot_script_is_not_a_module(self):
        # It must run while <head> is parsed, before the first paint.
        for page in PAGES:
            with self.subTest(page=page):
                body = self.get(f"/{page}.html").text
                self.assertIn(
                    '<script src="js/boot/theme-boot.js"></script>', body
                )

    def test_the_removed_root_scripts_are_not_served(self):
        for name in ("script.js", "insights.js", "companies.js", "detail.js",
                     "theme.js", "suivi-io.js", "scraping-selector.js",
                     "scraper-ui.js", "navbar-loader.js"):
            with self.subTest(name=name):
                self.assertEqual(self.get(f"/{name}").status_code, 404)

    def test_nothing_of_the_project_is_listed(self):
        body = self.get("/").text
        self.assertNotIn("companies.py", body)


class TestModules(StaticFilesTestCase):
    def test_the_whole_module_tree_is_served(self):
        js_root = os.path.join(server.BASE_DIR, "js")
        modules = []
        for folder, _dirs, files in os.walk(js_root):
            for name in files:
                if name.endswith(".js"):
                    relative = os.path.relpath(
                        os.path.join(folder, name), js_root
                    )
                    modules.append("/js/" + relative.replace(os.sep, "/"))

        self.assertGreaterEqual(len(modules), 10)
        for path in sorted(modules):
            with self.subTest(path=path):
                response = self.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    response.headers["Content-Type"],
                    "application/javascript; charset=utf-8",
                )
                self.assertEqual(
                    response.headers["Cache-Control"], "no-store"
                )

    def test_an_unknown_module_is_a_404(self):
        self.assertEqual(self.get("/js/pages/nope.js").status_code, 404)

    def test_only_javascript_is_served_from_the_module_tree(self):
        self.assertEqual(self.get("/js/pages/index.html").status_code, 404)
        self.assertEqual(self.get("/js/server.py").status_code, 404)

    def test_the_module_tree_cannot_be_left(self):
        for path in ("/js/../server.py",
                     "/js/shared/../../core.py",
                     "/js/pages/../../../etc/passwd"):
            with self.subTest(path=path):
                self.assertEqual(self.get(path).status_code, 404)


class TestDataFiles(StaticFilesTestCase):
    def test_the_shared_json_files_are_served_from_the_data_directory(self):
        for name in ("historique_scrapes.json", "historique_modifications.json",
                     "companies.json"):
            with self.subTest(name=name):
                with open(os.path.join(self.tmp.name, name), "w",
                          encoding="utf-8") as handle:
                    handle.write("{}")
                response = self.get(f"/{name}")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {})

    def test_an_unknown_json_file_is_a_404(self):
        self.assertEqual(self.get("/data_ghost.json").status_code, 404)


if __name__ == "__main__":
    unittest.main()