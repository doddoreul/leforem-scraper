# -*- coding: utf-8 -*-
"""Tests of the full data migration (export / import).

python.migration dumps every data area into one versioned JSON document and
restores it exactly, whatever the storage backend. The contract is exercised
against both JSON files and the SQLite database, plus the CLI and the server
routes.

Run from the repository root:
    python -m unittest discover -s tests -v
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
from python import jsonio  # noqa: E402
from python import migration  # noqa: E402
from python.storage.json_store import JsonStorage  # noqa: E402
from python.storage.sqlite_store import SqliteStorage  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def seed_all(store):
    """Fill every data area a real install can hold."""
    store.write_scraping(
        "liege",
        {
            "version": 1,
            "name": "liege",
            "label": "Metier / Liege",
            "occupation_guid": "occ-guid",
            "location_guid": "loc-guid",
            "offers": [{"number": "1", "titre": "Chat"}] * 2,
        },
    )
    store.write_scraping(
        "global",
        {
            "version": 1,
            "name": "global",
            "scrape_timestamp": "2026-10-08T20:13:19+02:00",
            "offers": [{"number": "42", "titre": "Chien"}],
        },
    )
    store.write_details(
        "liege",
        {"1": {"numero": "1", "titreOffre": "Chat", "salaire": {"min": 2500}}},
    )
    store.write_history_offers(
        "liege", {"offers": [{"number": "1", "state": "disparue"}]}
    )
    store.write_tracking(
        "liege", "1", {"statut": "en_cours", "statut_date": "2026-10-05T00:00:00Z",
                       "remarque": "relancer", "favori": True, "priorite": 2}
    )
    store.write_profile(
        {"version": 1, "keywordsText": "electromecanicien", "keywords": ["x"]}
    )
    store.write_companies(
        {"version": 1, "employers": {"Accent Job": {"count": 2}}}
    )
    store.write_blacklist({"words": ["stage"]})
    store.write_history_scrapes(
        [
            {"timestamp": "t1", "base": "liege", "new": 2},
            {"timestamp": "t2", "base": "global", "new": 1},
        ]
    )
    store.write_history_modifications({"items": []})
    store.write_scrape_state({"pending": False})


def full_reads(store):
    """Every data area as the storage layer sees it, in one dict."""
    return {
        "searches": [
            {
                "name": name,
                "payload": store.read_scraping(name),
                "details": store.read_details(name),
                "history_offers": store.read_history_offers(name),
                "tracking": store.read_tracking(name),
            }
            for name in store.get_scraping_names()
        ],
        "profile": store.read_profile(),
        "companies": store.read_companies(),
        "blacklist": store.read_blacklist(),
        "history_scrapes": store.read_history_scrapes(),
        "history_modifications": store.read_history_modifications(),
        "scrape_state": store.read_scrape_state(),
    }


class MigrationContract:
    def make_storage(self):
        raise NotImplementedError

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved = config.DATA_DIR
        config.DATA_DIR = self.tmp.name
        self.store = self.make_storage()

    def tearDown(self):
        config.DATA_DIR = self._saved
        self.tmp.cleanup()

    def test_export_contains_everything(self):
        seed_all(self.store)
        document = migration.export_document(self.store)

        self.assertEqual(document["format"], "leforem-scraper")
        self.assertEqual(document["version"], 1)
        self.assertEqual({s["name"] for s in document["searches"]},
                         {"liege", "global"})
        by_name = {s["name"]: s for s in document["searches"]}
        self.assertEqual(len(by_name["liege"]["details"]), 1)
        self.assertEqual(len(by_name["liege"]["tracking"]), 1)
        self.assertEqual(document["profile"]["keywords"], ["x"])
        self.assertEqual(len(document["history_scrapes"]), 2)
        self.assertIsNotNone(document["scrape_state"])

    def test_export_carries_the_offers_themselves(self):
        """The dump embeds the full offer list of every search.

        This is the point of the backup: a migration restores every scrape
        as-is, so no fresh scraping is needed on the destination machine.
        """
        seed_all(self.store)
        document = migration.export_document(self.store)
        liege = next(s for s in document["searches"]
                     if s["name"] == "liege")

        self.assertEqual(
            liege["payload"]["offers"],
            [{"number": "1", "titre": "Chat"}] * 2,
        )
        offres = sum(
            len(s["payload"].get("offers") or [])
            for s in document["searches"]
            if isinstance(s.get("payload"), dict)
        )
        self.assertEqual(offres, 3)

    def test_annonces_are_self_contained(self):
        """Each annonce is one readable object, not a reference.

        The listing offer, its detail payload and its follow-up are folded
        into a single entry with clear fields, so the file alone describes
        every annonce completely.
        """
        seed_all(self.store)
        self.store.write_details(
            "liege",
            {
                "1": {
                    "numero": "1",
                    "titreOffre": "Chat",
                    "descriptionJob": "<p>Adopter, nourrir.</p>",
                    "nomEmployeur": "Velours & Co",
                    "typeContrat": "CDI",
                }
            },
        )
        document = migration.export_document(self.store)
        liege = next(s for s in document["searches"]
                     if s["name"] == "liege")
        annonce = next(a for a in liege["annonces"] if a["id"] == "1")

        self.assertEqual(len(liege["annonces"]), 2)  # one per offer
        self.assertEqual(annonce["titre"], "Chat")
        self.assertEqual(annonce["entreprise"], "Velours & Co")
        self.assertEqual(annonce["contrat"], "CDI")
        self.assertEqual(annonce["detail"]["descriptionJob"],
                         "<p>Adopter, nourrir.</p>")
        self.assertEqual(annonce["suivi"]["statut"], "en_cours")
        # The raw pieces stay alongside for an exact rebuild.
        self.assertEqual(annonce["annonce"], {"number": "1", "titre": "Chat"})

    def test_import_restores_everything_exactly(self):
        seed_all(self.store)
        before = full_reads(self.store)
        counts = migration.import_document(
            migration.export_document(self.store), self.store
        )

        self.assertEqual(counts["recherches"], 2)
        self.assertEqual(counts["offres"], 3)  # 2 + 1
        self.assertEqual(counts["details"], 1)
        self.assertEqual(counts["suivi"], 1)
        self.assertEqual(full_reads(self.store), before)

    def test_orphan_tracking_survives_the_round_trip(self):
        """Tracking under a stale base name travels with the backup.

        Early installs recorded the follow-up under a GUID-based name that is
        no longer a scrape. Those rows are invisible in the UI, so only the
        migration tool can carry them: they must not be dropped.
        """
        stale = "fb3c1045-38215355"
        seed_all(self.store)
        self.store.write_tracking(
            stale, "999",
            {"statut": "pas_interesse", "remarque": "garder l'oeil",
             "favori": True, "priorite": 1},
        )

        document = migration.export_document(self.store)
        entry = next(s for s in document["searches"] if s["name"] == stale)
        self.assertIsNone(entry["payload"])
        self.assertEqual(entry["tracking"]["999"]["statut"], "pas_interesse")
        self.assertEqual(entry["tracking"]["999"]["favori"], True)

        counts = migration.import_document(document, self.store)
        self.assertEqual(counts["recherches"], 2)  # stale is no scrape
        self.assertEqual(counts["suivi"], 2)       # seed + stale
        self.assertEqual(
            self.store.read_tracking(stale)["999"]["remarque"],
            "garder l'oeil",
        )

    def test_import_replaces_existing_searches(self):
        """A restore wipes the searches present locally, then rewrites."""
        seed_all(self.store)
        other = tempfile.TemporaryDirectory()
        try:
            saved_dir = config.DATA_DIR
            config.DATA_DIR = other.name
            if isinstance(self.store, JsonStorage):
                source = JsonStorage()
            else:
                source = SqliteStorage(
                    os.path.join(other.name, "leforem.db")
                )
            source.write_scraping(
                "bruxelles",
                {"name": "bruxelles", "label": "Metier / Bruxelles",
                 "offers": [{"number": "7"}]},
            )
            source.write_details("bruxelles", {"7": {"numero": "7"}})
            source.write_tracking("bruxelles", "7", {"statut": "postule"})
            document = migration.export_document(source)
            config.DATA_DIR = saved_dir
        finally:
            other.cleanup()

        counts = migration.import_document(document, self.store)

        names = set(self.store.get_scraping_names())
        self.assertEqual(names, {"bruxelles"})
        self.assertEqual(counts["recherches"], 1)
        self.assertEqual(counts["suivi"], 1)
        self.assertEqual(self.store.read_tracking("bruxelles")["7"]["statut"],
                         "postule")

    def test_import_rejects_a_foreign_document(self):
        seed_all(self.store)
        before = full_reads(self.store)
        with self.assertRaises(ValueError):
            migration.import_document(
                {"format": "autre-app", "version": 1, "searches": []},
                self.store,
            )
        # Nothing was touched.
        self.assertEqual(full_reads(self.store), before)

    def test_import_rejects_an_invalid_search_name(self):
        document = migration.export_document(self.store)
        document["searches"] = [
            {"name": "../evil", "payload": {"offers": []}}
        ]
        with self.assertRaises(ValueError):
            migration.import_document(document, self.store)

    def test_userdata_export_keeps_only_user_data(self):
        seed_all(self.store)
        document = migration.export_userdata_document(self.store)

        self.assertEqual(document["kind"], "userdata")
        self.assertNotIn("searches", document)
        self.assertNotIn("history_scrapes", document)
        self.assertEqual(document["profile"]["keywords"], ["x"])
        self.assertEqual(document["companies"]["employers"],
                         {"Accent Job": {"count": 2}})
        self.assertEqual(document["blacklist"], {"words": ["stage"]})
        self.assertEqual(document["tracking"]["liege"]["1"]["statut"],
                         "en_cours")

    def test_scraping_export_keeps_only_the_scraping(self):
        seed_all(self.store)
        document = migration.export_scraping_document(self.store)

        self.assertEqual(document["kind"], "scraping")
        self.assertNotIn("profile", document)
        self.assertNotIn("companies", document)
        self.assertNotIn("blacklist", document)
        self.assertNotIn("tracking", document)
        self.assertEqual(
            {s["name"] for s in document["searches"]}, {"liege", "global"}
        )
        liege = next(s for s in document["searches"] if s["name"] == "liege")
        self.assertEqual(liege["payload"]["offers"],
                         [{"number": "1", "titre": "Chat"}] * 2)
        self.assertEqual(len(liege["details"]), 1)
        self.assertEqual(len(liege["annonces"]), 2)  # complete, still readable
        for annonce in liege["annonces"]:
            self.assertIsNone(annonce["suivi"])  # no tracking here
        self.assertEqual(len(document["history_scrapes"]), 2)

    def test_userdata_import_keeps_the_searches(self):
        """Importer des données utilisateur ne touche pas au scraping."""
        seed_all(self.store)
        document = migration.export_userdata_document(self.store)
        document["profile"]["keywordsText"] = "changed"

        counts = migration.import_document(document, self.store)

        self.assertEqual(counts["recherches"], 0)
        self.assertEqual(counts["suivi"], 1)
        self.assertEqual(self.store.read_profile()["keywordsText"], "changed")
        # Le scraping et son suivi existant sont intacts.
        self.assertEqual(set(self.store.get_scraping_names()),
                         {"liege", "global"})
        self.assertEqual(self.store.read_tracking("liege")["1"]["statut"],
                         "en_cours")

    def test_scraping_import_keeps_the_user_data(self):
        """Importer un scraping ne touche ni au profil ni au suivi."""
        seed_all(self.store)
        before = {
            "profile": self.store.read_profile(),
            "companies": self.store.read_companies(),
            "blacklist": self.store.read_blacklist(),
            "tracking": self.store.read_tracking("liege"),
        }
        document = migration.export_scraping_document(self.store)
        document["scrape_state"] = {"pending": False, "restart": True}

        counts = migration.import_document(document, self.store)

        self.assertEqual(counts["recherches"], 2)
        self.assertEqual(counts["suivi"], 0)  # le scraping ne porte pas de suivi
        self.assertEqual(self.store.read_profile(), before["profile"])
        self.assertEqual(self.store.read_companies(), before["companies"])
        self.assertEqual(self.store.read_blacklist(), before["blacklist"])
        self.assertEqual(self.store.read_tracking("liege"), before["tracking"])
        self.assertEqual(self.store.read_scraping("liege")["offers"],
                         [{"number": "1", "titre": "Chat"}] * 2)
        self.assertTrue(self.store.read_scrape_state()["restart"])

    def test_partial_imports_combine_in_any_order(self):
        """userdata + scraping = la sauvegarde complète, quel que soit l'ordre."""
        seed_all(self.store)
        user_doc = migration.export_userdata_document(self.store)
        scraping_doc = migration.export_scraping_document(self.store)

        def run_(order):
            folder = tempfile.TemporaryDirectory()
            saved = config.DATA_DIR
            config.DATA_DIR = folder.name
            try:
                if isinstance(self.store, JsonStorage):
                    target = JsonStorage()
                else:
                    target = SqliteStorage(
                        os.path.join(folder.name, "leforem.db")
                    )
                for doc in order:
                    migration.import_document(doc, target)
                reads = full_reads(target)
            finally:
                config.DATA_DIR = saved
                folder.cleanup()
            return reads

        first = run_([user_doc, scraping_doc])
        second = run_([scraping_doc, user_doc])

        self.assertEqual(first["profile"], second["profile"])
        self.assertEqual(
            {s["name"] for s in first["searches"]},
            {s["name"] for s in second["searches"]},
        )
        by_name = {s["name"]: s for s in first["searches"]}
        self.assertEqual(set(by_name), {"liege", "global"})
        self.assertEqual(by_name["liege"]["tracking"]["1"]["statut"],
                         "en_cours")
        self.assertEqual(
            first["history_scrapes"], second["history_scrapes"]
        )

    def test_import_rejects_a_file_without_any_section(self):
        document = {"format": "leforem-scraper", "version": 1,
                    "kind": "userdata"}
        with self.assertRaises(ValueError):
            migration.import_document(document, self.store)

    def test_import_rejects_an_invalid_tracking_base(self):
        document = migration.export_userdata_document(self.store)
        document["tracking"] = {"../evil": {}}
        with self.assertRaises(ValueError):
            migration.import_document(document, self.store)

    def test_export_is_portable_as_json(self):
        seed_all(self.store)
        dump_path = os.path.join(self.tmp.name, "sauvegarde.json")
        migration.write_export(dump_path, self.store)

        with open(dump_path, encoding="utf-8") as handle:
            parsed = json.load(handle)
        self.assertEqual(parsed["format"], "leforem-scraper")
        self.assertEqual(len(parsed["searches"]), 2)

    def test_read_export_rejects_a_non_json_file(self):
        bad = os.path.join(self.tmp.name, "nope.json")
        with open(bad, "w", encoding="utf-8") as handle:
            handle.write("not json at all")
        with self.assertRaises(ValueError):
            migration.read_export(bad)


class TestJsonMigration(MigrationContract, unittest.TestCase):
    def make_storage(self):
        return JsonStorage()


class TestSqliteMigration(MigrationContract, unittest.TestCase):
    def make_storage(self):
        return SqliteStorage(os.path.join(self.tmp.name, "leforem.db"))


def _storage_env(backend):
    env = dict(os.environ)
    env["LEFOREM_STORAGE"] = backend
    return env


class TestMigrationCli(unittest.TestCase):
    """python -m python.migration export / import, on two data folders."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.source = os.path.join(self.tmp.name, "source")
        self.target = os.path.join(self.tmp.name, "target")
        os.makedirs(self.source, exist_ok=True)
        os.makedirs(self.target, exist_ok=True)
        self.dump = os.path.join(self.tmp.name, "sauvegarde.json")

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *args, **kwargs):
        return subprocess.run(
            [sys.executable, "-m", "python.migration", *args],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            env=_storage_env(kwargs.pop("backend", "sqlite")),
            timeout=60,
            **kwargs,
        )

    def test_export_then_import_round_trip(self):
        # First folder is seeded by hand through the storage API.
        config_data = config.DATA_DIR
        config.DATA_DIR = self.source
        try:
            store = SqliteStorage(os.path.join(self.source, "leforem.db"))
            seed_all(store)
        finally:
            config.DATA_DIR = config_data

        exported = self.run_cli(
            "export", self.dump, "--data-dir", self.source
        )
        self.assertEqual(exported.returncode, 0, exported.stderr)
        self.assertTrue(os.path.exists(self.dump))
        self.assertIn("Données exportées", exported.stdout)

        imported = self.run_cli(
            "import", self.dump, "--data-dir", self.target
        )
        self.assertEqual(imported.returncode, 0, imported.stderr)
        self.assertIn("Données importées", imported.stdout)

        # Re-export the target and compare, ignoring the timestamp.
        second_dump = os.path.join(self.tmp.name, "relu.json")
        reexported = self.run_cli(
            "export", second_dump, "--data-dir", self.target,
            backend="sqlite",
        )
        self.assertEqual(reexported.returncode, 0, reexported.stderr)

        first = migration.read_export(self.dump)
        second = migration.read_export(second_dump)
        self.assertEqual(first["searches"], second["searches"])
        self.assertEqual(first["profile"], second["profile"])
        self.assertEqual(first["companies"], second["companies"])
        self.assertEqual(first["history_scrapes"], second["history_scrapes"])

    def test_import_rejects_a_foreign_file(self):
        with open(self.dump, "w", encoding="utf-8") as handle:
            handle.write(json.dumps({"format": "autre", "version": 1}))
        result = self.run_cli(
            "import", self.dump, "--data-dir", self.target
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("Erreur", result.stderr)


class MigrationRouteTestCase(unittest.TestCase):
    """The /api/export and /api/import routes, on a real server."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved_dir = config.DATA_DIR
        config.DATA_DIR = self.tmp.name
        os.environ["LEFOREM_STORAGE"] = "json"
        from python.storage import reset_storage
        reset_storage()

        from python import server
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.daemon = True
        self.thread.start()

    def tearDown(self):
        from python.storage import reset_storage
        reset_storage()
        config.DATA_DIR = self._saved_dir
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.tmp.cleanup()

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def test_export_downloads_everything(self):
        from python.storage import get_storage
        store = get_storage()
        seed_all(store)

        response = requests.get(self.url("/api/export"), timeout=15)
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment;", response.headers.get(
            "Content-Disposition", ""))
        document = response.json()
        self.assertEqual(document["format"], "leforem-scraper")
        self.assertEqual({s["name"] for s in document["searches"]},
                         {"liege", "global"})

    def test_import_restores_and_counts(self):
        from python.storage import get_storage
        seed_all(get_storage())
        document = migration.export_document(get_storage())
        document["profile"]["keywordsText"] = "changed"

        response = requests.post(
            self.url("/api/import"), json=document, timeout=15
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["recherches"], 2)
        self.assertEqual(payload["suivi"], 1)
        self.assertEqual(
            get_storage().read_profile()["keywordsText"], "changed"
        )

    def test_import_rejects_foreign_format(self):
        response = requests.post(
            self.url("/api/import"),
            json={"format": "autre", "version": 1, "searches": []},
            timeout=15,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("error", response.json())

    def test_import_rejects_invalid_json(self):
        response = requests.post(
            self.url("/api/import"),
            data=b"{pas du json",
            headers={"Content-Type": "application/json"},
            timeout=15,
        )
        self.assertEqual(response.status_code, 400)

    def test_export_userdata_route(self):
        from python.storage import get_storage
        seed_all(get_storage())

        response = requests.get(self.url("/api/export/userdata"), timeout=15)
        self.assertEqual(response.status_code, 200)
        document = response.json()
        self.assertEqual(document["kind"], "userdata")
        self.assertNotIn("searches", document)
        self.assertIn("donnees-utilisateur", response.headers.get(
            "Content-Disposition", ""))
        self.assertEqual(document["tracking"]["liege"]["1"]["statut"],
                         "en_cours")

    def test_export_scraping_route(self):
        from python.storage import get_storage
        seed_all(get_storage())

        response = requests.get(self.url("/api/export/scraping"), timeout=15)
        self.assertEqual(response.status_code, 200)
        document = response.json()
        self.assertEqual(document["kind"], "scraping")
        self.assertIn("searches", document)
        self.assertNotIn("tracking", document)
        self.assertNotIn("profile", document)
        self.assertIn("scraping", response.headers.get(
            "Content-Disposition", ""))
        self.assertEqual(
            {s["name"] for s in document["searches"]}, {"liege", "global"}
        )


if __name__ == "__main__":
    unittest.main()