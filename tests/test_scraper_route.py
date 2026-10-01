# -*- coding: utf-8 -*-
"""Tests for the synchronous scraping route (POST /api/scraper/run).

The real Forem API is never called: scraper.run_scrape() is replaced by a
fake that reports events the same way the real one does. What is verified
here is the contract of the route itself: the answer arrives only after the
scraper is finished, the real scraper events are streamed while it runs, and
the scrape parameters are read from the stored scraping.

Run from the repository root:
    python -m unittest discover -s tests -v
"""

import json
import os
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer

import requests

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)

import scraper
import serveur


class FakeRunScraper:
    """Stands in for scraper.run_scrape(), reporting the same events."""

    def __init__(self, events=(), summary=None, delay=0.0, error=None,
                 gate=None):
        self.events = list(events)
        self.summary = summary or {}
        self.delay = delay
        self.error = error
        self.gate = gate
        self.calls = []
        self.finished = threading.Event()

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if self.gate is not None:
            self.gate.wait(20)
        for done, total in self.events:
            kwargs["reporter"].progress(done, total)
            if self.delay:
                time.sleep(self.delay)
        if self.error:
            raise self.error
        self.finished.set()
        return self.summary


class ScraperRouteTestCase(unittest.TestCase):
    """Boots the real server on a temporary data directory."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved = (serveur.DATA_DIR, scraper.run_scrape)
        serveur.DATA_DIR = self.tmp.name

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), serveur.Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.daemon = True
        self.thread.start()

        self.fake = None

    def tearDown(self):
        scraper.run_scrape = self._saved[1]
        serveur.DATA_DIR = self._saved[0]
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.tmp.cleanup()

    def install(self, fake):
        self.fake = fake
        scraper.run_scrape = fake
        return fake

    def seed_scraping(self, name="test", occupation="occ-guid",
                      location="loc-guid", label="Metier / Ville"):
        path = os.path.join(self.tmp.name, f"data_{name}.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({
                "name": name,
                "label": label,
                "occupation_guid": occupation,
                "location_guid": location,
                "offers": [],
            }, handle)

    def post(self, payload, name="test", timeout=30):
        return requests.post(
            f"http://127.0.0.1:{self.port}/api/scraper/run",
            json=payload,
            timeout=timeout,
        )

    @staticmethod
    def events(response):
        return [
            json.loads(line)
            for line in response.text.splitlines()
            if line.strip()
        ]


class TestBlockingScrape(ScraperRouteTestCase):
    def test_the_known_offers_are_not_downloaded_again(self):
        # The route must not turn the run into a full re-download: only an
        # explicit refresh does, otherwise scraper.py keeps its incremental
        # behaviour (new offers and previously failed ones only).
        self.seed_scraping()
        fake = self.install(FakeRunScraper(summary={"status": "done"}))

        self.post({"name": "test"})

        self.assertEqual(len(fake.calls), 1)
        self.assertFalse(fake.calls[0]["refresh"])

    def test_a_refresh_is_only_performed_when_asked_for(self):
        self.seed_scraping()
        fake = self.install(FakeRunScraper(summary={"status": "done"}))

        self.post({"name": "test", "refresh": True})

        self.assertTrue(fake.calls[0]["refresh"])

    def test_response_arrives_after_the_scrape_is_finished(self):
        self.seed_scraping()
        self.install(FakeRunScraper(
            events=[(1, 3), (2, 3), (3, 3)],
            summary={"status": "done", "total_offres": 3},
            delay=0.05,
        ))

        response = self.post({"name": "test"})

        # The route only answers once run_scrape() has returned.
        self.assertTrue(self.fake.finished.is_set())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["Content-Type"],
            "application/x-ndjson; charset=utf-8",
        )

        types = [event["type"] for event in self.events(response)]
        self.assertEqual(types, ["progress", "progress", "progress", "done"])

    def test_logs_are_received_before_the_scrape_is_finished(self):
        self.seed_scraping()
        release = threading.Event()

        class SlowFake:
            """Logs one line, then waits for the client to have read it."""

            def __init__(self):
                self.calls = []
                self.done = False

            def __call__(self, **kwargs):
                self.calls.append(kwargs)
                kwargs["reporter"].log("Connexion à l'API Forem...")
                release.wait(20)
                self.done = True
                return {"status": "done", "total_offres": 1}

        fake = SlowFake()
        scraper.run_scrape = fake

        with requests.post(
            f"http://127.0.0.1:{self.port}/api/scraper/run",
            json={"name": "test"},
            stream=True,
            timeout=30,
        ) as response:
            lines = response.iter_lines()

            first = json.loads(next(lines))
            self.assertEqual(first["type"], "log")
            self.assertEqual(first["line"], "Connexion à l'API Forem...")
            # The line arrived while the scraper was still working.
            self.assertFalse(fake.done)

            release.set()
            rest = [json.loads(l) for l in lines if l.strip()]

        self.assertTrue(fake.done)
        self.assertEqual(rest[-1]["type"], "done")

    def test_stored_guids_are_used(self):
        self.seed_scraping(occupation="occ-1", location="loc-1")
        self.install(FakeRunScraper(summary={"status": "done"}))

        self.post({"name": "test", "occupation_guid": "spoofed"})

        call = self.fake.calls[0]
        self.assertEqual(call["occupation_guid"], "occ-1")
        self.assertEqual(call["location_guid"], "loc-1")
        self.assertEqual(call["base"], "test")
        self.assertEqual(call["label"], "Metier / Ville")

    def test_summary_is_returned_to_the_browser(self):
        self.seed_scraping()
        self.install(FakeRunScraper(summary={
            "status": "done",
            "traitees": 3420,
            "total_offres": 3408,
            "nouvelles": 12,
            "modifiees": 23,
            "erreurs": 2,
            "duration_seconds": 272.0,
        }))

        result = self.events(self.post({"name": "test"}))[-1]["result"]
        self.assertEqual(result["traitees"], 3420)
        self.assertEqual(result["nouvelles"], 12)
        self.assertEqual(result["modifiees"], 23)
        self.assertEqual(result["erreurs"], 2)
        self.assertEqual(result["duration_seconds"], 272.0)

    def test_a_new_scraping_is_created_from_the_guids_sent_by_the_browser(self):
        # « Nouvelle recherche » : le navigateur choisit métier et lieu, donc
        # le nom n'existe pas encore dans data/. Les GUIDs du payload sont
        # alors utilisés et le scraper écrit data_<nom>.json.
        self.assertFalse(
            os.path.exists(os.path.join(self.tmp.name, "data_nouveau.json"))
        )
        self.install(FakeRunScraper(summary={"status": "done", "nouvelles": 1}))

        response = self.post({
            "name": "nouveau",
            "label": "Metier / Ville",
            "occupation_guid": "occ-new",
            "location_guid": "loc-new",
        })

        self.assertEqual(response.status_code, 200)
        call = self.fake.calls[0]
        self.assertEqual(call["occupation_guid"], "occ-new")
        self.assertEqual(call["location_guid"], "loc-new")
        self.assertEqual(call["base"], "nouveau")
        self.assertEqual(call["label"], "Metier / Ville")
        self.assertFalse(call["refresh"])
        self.assertEqual(self.events(response)[-1]["type"], "done")

    def test_a_new_scraping_without_guids_is_refused(self):
        self.install(FakeRunScraper(summary={"status": "done"}))

        response = self.post({"name": "nouveau", "label": "Metier / Ville"})

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.fake.calls, [])

    def test_scrape_failure_is_reported_without_killing_the_server(self):
        self.seed_scraping()
        self.install(FakeRunScraper(error=RuntimeError("Forem injoignable")))

        response = self.post({"name": "test"})
        self.assertEqual(response.status_code, 200)

        events = self.events(response)
        self.assertEqual(events[-1]["type"], "error")
        self.assertIn("Forem injoignable", events[-1]["message"])

        # The server is still alive.
        self.assertEqual(
            requests.get(
                f"http://127.0.0.1:{self.port}/api/scrapings", timeout=10
            ).status_code,
            200,
        )


class TestScrapeRouteGuards(ScraperRouteTestCase):
    def test_unknown_scraping_is_refused(self):
        self.install(FakeRunScraper(summary={"status": "done"}))
        response = self.post({"name": "missing"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.fake.calls, [])

    def test_scraping_without_guids_is_refused(self):
        path = os.path.join(self.tmp.name, "data_empty.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump({"offers": []}, handle)
        self.install(FakeRunScraper(summary={"status": "done"}))

        response = self.post({"name": "empty"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.fake.calls, [])

    def test_missing_name_is_refused(self):
        self.install(FakeRunScraper(summary={"status": "done"}))
        response = self.post({})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.fake.calls, [])

    def test_name_cannot_escape_the_data_directory(self):
        self.install(FakeRunScraper(summary={"status": "done"}))
        response = self.post({"name": "../serveur"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.fake.calls, [])

    def test_all_scrapings_is_refused(self):
        self.install(FakeRunScraper(summary={"status": "done"}))
        response = self.post({"name": "all"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.fake.calls, [])

    def test_a_second_run_is_refused_while_one_is_going_on(self):
        self.seed_scraping()
        gate = threading.Event()
        fake = self.install(FakeRunScraper(
            summary={"status": "done"}, gate=gate,
        ))

        results = {}

        def first():
            results["first"] = self.post({"name": "test"})

        worker = threading.Thread(target=first)
        worker.start()

        # Wait until the blocking call is inside the scraper.
        for _ in range(100):
            if fake.calls:
                break
            time.sleep(0.02)

        second = self.post({"name": "test"})
        gate.set()
        worker.join(timeout=30)

        self.assertEqual(second.status_code, 409)
        self.assertEqual(results["first"].status_code, 200)
        self.assertEqual(len(fake.calls), 1)


if __name__ == "__main__":
    unittest.main()