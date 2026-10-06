# -*- coding: utf-8 -*-
"""Tests for the postal-code mapping.

The Forem gives the workplace as free text, so the mapping is what decides
whether a postal code can find an offer at all.
"""

import json
import os
import tempfile
import unittest

from python import config
from python import postal


ROWS = [
    # One place served by two codes.
    {"column_1": "4000", "column_2": "Liège",
     "municipality_name_french": "Liège"},
    {"column_1": "4020", "column_2": "Liège",
     "municipality_name_french": "Liège"},
    # One code serving two places.
    {"column_1": "4100", "column_2": "Seraing",
     "municipality_name_french": "Seraing"},
    {"column_1": "4100", "column_2": "Boncelles",
     "municipality_name_french": "Seraing"},
    # Accents and hyphens on both sides of the comparison.
    {"column_1": "4460", "column_2": "Grâce-Hollogne",
     "municipality_name_french": "Grâce-Hollogne"},
    # Not a place: it covers many codes, none of which names it.
    {"column_1": "4100", "column_2": "Arrondissement de Liège",
     "municipality_name_french": "Liège"},
    # A row with nothing usable in it.
    {"column_1": "", "column_2": ""},
    "not a dict",
]


class FoldTest(unittest.TestCase):
    def test_case_and_accents_go_away(self):
        self.assertEqual(postal.fold("LIÈGE"), "liege")
        self.assertEqual(postal.fold("Liège"), "liege")

    def test_the_separators_vanish(self):
        self.assertEqual(postal.fold("Grâce-Hollogne"), "grace hollogne")
        self.assertEqual(postal.fold("  Herstal  "), "herstal")

    def test_ligatures_fold_like_the_frontend(self):
        self.assertEqual(postal.fold("Manœuvre"), "manoeuvre")

    def test_a_digit_is_kept(self):
        self.assertEqual(postal.fold("4000"), "4000")


class IndexTest(unittest.TestCase):
    def setUp(self):
        self.index = postal.build_index(ROWS)

    def test_a_place_can_have_several_codes(self):
        self.assertEqual(self.index["liege"], ["4000", "4020"])

    def test_codes_are_sorted(self):
        self.assertEqual(postal.build_index(list(reversed(ROWS)))["liege"],
                         ["4000", "4020"])

    def test_two_places_sharing_a_code_are_both_kept(self):
        self.assertEqual(self.index["seraing"], ["4100"])
        self.assertEqual(self.index["boncelles"], ["4100"])

    def test_hyphenated_place_is_reachable(self):
        self.assertEqual(self.index["grace hollogne"], ["4460"])

    def test_an_arrondissement_is_listed_but_matches_nothing_alone(self):
        self.assertIn("arrondissement de liege", self.index)


class LookupTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved = config.DATA_DIR
        config.DATA_DIR = self.tmp.name
        postal._INDEX = None

    def tearDown(self):
        config.DATA_DIR = self._saved
        postal._INDEX = None
        self.tmp.cleanup()

    def _cache(self, rows):
        with open(postal.dataset_path(), "w", encoding="utf-8") as handle:
            json.dump({"rows": rows}, handle, ensure_ascii=False)
        postal._INDEX = None

    def test_without_a_dataset_nothing_breaks(self):
        self.assertEqual(postal.load_index(), {})
        self.assertEqual(postal.postal_codes_for("Liège"), [])
        offers = [{"location": "Liège"}]
        self.assertEqual(postal.enrich_offers(offers), 0)
        self.assertNotIn(config.POSTAL_CODES_FIELD, offers[0])

    def test_a_corrupted_dataset_is_ignored(self):
        with open(postal.dataset_path(), "w", encoding="utf-8") as handle:
            handle.write("{not json")
        postal._INDEX = None
        self.assertEqual(postal.load_index(), {})

    def test_lookup_is_case_and_accent_insensitive(self):
        self._cache(ROWS)
        self.assertEqual(postal.postal_codes_for("LIÈGE"), ["4000", "4020"])
        self.assertEqual(postal.postal_codes_for("Liège"), ["4000", "4020"])
        self.assertEqual(postal.postal_codes_for("Herstal"), [])

    def test_a_place_can_be_served_by_two_codes(self):
        self._cache(ROWS)
        self.assertEqual(postal.postal_codes_for("Liège"), ["4000", "4020"])

    def test_several_workplaces_joined_by_commas_resolve(self):
        self._cache(ROWS)
        # extract_location joins them, so an offer may name more than one.
        found = postal.postal_codes_for("Arrondissement de Liège, Seraing")
        self.assertEqual(found, ["4100"])

    def test_an_unknown_place_resolves_to_nothing(self):
        self._cache(ROWS)
        self.assertEqual(postal.postal_codes_for("Nulle part"), [])
        self.assertEqual(postal.postal_codes_for(""), [])

    def test_enrich_attaches_the_codes_in_place(self):
        self._cache(ROWS)
        offers = [
            {"number": "1", "location": "LIÈGE"},
            {"number": "2", "location": "Seraing"},
            {"number": "3", "location": "Nulle part"},
        ]
        self.assertEqual(postal.enrich_offers(offers), 2)
        self.assertEqual(offers[0][config.POSTAL_CODES_FIELD], ["4000", "4020"])
        self.assertEqual(offers[1][config.POSTAL_CODES_FIELD], ["4100"])
        self.assertNotIn(config.POSTAL_CODES_FIELD, offers[2])

    def test_enrich_leaves_the_other_fields_alone(self):
        self._cache(ROWS)
        offers = [{"number": "1", "location": "Liège", "offer_title": "Tapis"}]
        postal.enrich_offers(offers)
        self.assertEqual(offers[0]["offer_title"], "Tapis")
        self.assertEqual(offers[0]["number"], "1")

    def test_enrich_survives_garbage(self):
        self._cache(ROWS)
        self.assertEqual(postal.enrich_offers(None), 0)
        self.assertEqual(postal.enrich_offers(["not a dict"]), 0)


class StatsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved = config.DATA_DIR
        config.DATA_DIR = self.tmp.name
        postal._INDEX = None

    def tearDown(self):
        config.DATA_DIR = self._saved
        postal._INDEX = None
        self.tmp.cleanup()

    def test_stats_report_the_cache_is_missing(self):
        summary = postal.stats()
        self.assertFalse(summary["cached"])
        self.assertIn("postal_codes.json", summary["path"])

    def test_stats_count_the_dataset(self):
        postal.write_dataset(ROWS)
        postal._INDEX = None
        summary = postal.stats()
        self.assertTrue(summary["cached"])
        self.assertEqual(summary["localities"], 5)
        # 4000, 4020, 4100 and 4460.
        self.assertEqual(summary["codes"], 4)


class LiveReloadTest(unittest.TestCase):
    """A server already running must notice a dataset written under it.

    Caching the index for the life of the process looked cheaper, but a server
    started before "python -m python.postal --refresh" then never found a
    postal code and nothing said why.
    """

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self._saved = config.DATA_DIR
        config.DATA_DIR = self.tmp.name
        postal._INDEX = None

    def tearDown(self):
        config.DATA_DIR = self._saved
        postal._INDEX = None
        self.tmp.cleanup()

    def test_a_dataset_appearing_is_picked_up(self):
        # The server answers before anything is downloaded.
        self.assertEqual(postal.postal_codes_for("Liège"), [])
        self.assertEqual(postal.enrich_offers([{"location": "Liège"}]), 0)

        postal.write_dataset(ROWS)

        self.assertEqual(postal.postal_codes_for("Liège"), ["4000", "4020"])
        offers = [{"location": "Liège"}]
        self.assertEqual(postal.enrich_offers(offers), 1)
        self.assertEqual(offers[0][config.POSTAL_CODES_FIELD], ["4000", "4020"])

    def test_a_removed_dataset_is_forgotten(self):
        postal.write_dataset(ROWS)
        self.assertEqual(postal.postal_codes_for("Liège"), ["4000", "4020"])

        os.remove(postal.dataset_path())

        self.assertEqual(postal.postal_codes_for("Liège"), [])

    def test_rewriting_the_dataset_changes_the_answer(self):
        postal.write_dataset(ROWS)
        self.assertEqual(postal.postal_codes_for("Herstal"), [])

        postal.write_dataset(ROWS + [
            {"column_1": "4040", "column_2": "Herstal",
             "municipality_name_french": "Herstal"},
        ])

        self.assertEqual(postal.postal_codes_for("Herstal"), ["4040"])

    def test_the_signature_changes_with_the_file(self):
        self.assertIsNone(postal.dataset_signature())
        postal.write_dataset(ROWS)
        first = postal.dataset_signature()
        self.assertIsNotNone(first)

        # A different length always invalidates, whatever the timestamps do.
        postal.write_dataset(ROWS + [{"column_1": "9999", "column_2": "Autre"}])
        self.assertNotEqual(first, postal.dataset_signature())

    def test_a_later_refresh_is_seen(self):
        postal.write_dataset(ROWS)
        first = postal.dataset_signature()

        # Same length, so only the timestamp can tell them apart. Windows
        # timestamps are coarse, so move it on rather than race the clock.
        stamp = first[0] + 10_000_000_000
        os.utime(postal.dataset_path(), ns=(stamp, stamp))

        self.assertNotEqual(first, postal.dataset_signature())


if __name__ == "__main__":
    unittest.main()
