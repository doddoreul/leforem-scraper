# -*- coding: utf-8 -*-
"""Unit tests for core.py (+ scraper.update_history pure logic).

Runs offline on fictional data. No network, no real files.

Run from the repository root:
    python -m unittest discover -s tests -v
"""

import os
import sys
import unittest
from datetime import date

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)

import core
import scraper


def make_offer(number, title="Titre", company="Entreprise",
               location="Liege", contract_type="Duree indeterminee",
               schedule="Temps plein", salary="", pay="",
               published_on="16-09-26", date_publication="16/09/2026",
               extra=None):
    offer = {
        "number": number,
        "offer_title": title,
        "company": company,
        "location": location,
        "contract_type": contract_type,
        "schedule": schedule,
        "salary": salary,
        "pay": pay,
        "published_on": published_on,
        "date_publication": date_publication,
        "email": "contact@example.com",
        "description": "Description de " + str(number),
        "url": "",
        "summary": "",
        "is_new": False,
    }
    if extra:
        offer.update(extra)
    return offer


class TestDates(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(core.parse_forem_date("16/09/2026"), "2026-09-16")
        self.assertEqual(core.parse_forem_date("16-09-26"), "2026-09-16")
        self.assertEqual(
            core.parse_forem_date("2026-09-16T10:00:00+02:00"),
            "2026-09-16",
        )

    def test_relative_text_is_unknown(self):
        self.assertEqual(core.parse_forem_date("Publie aujourd'hui"), "")
        self.assertEqual(core.parse_forem_date(""), "")
        self.assertEqual(core.parse_forem_date(None), "")

    def test_days_between(self):
        self.assertEqual(
            core.days_between("2026-09-26", today=date(2026, 9, 26)), 0
        )
        self.assertEqual(
            core.days_between("2026-09-20", today=date(2026, 9, 26)), -6
        )
        self.assertEqual(core.days_between("garbage"), None)


class TestChangeDetection(unittest.TestCase):
    def test_compare_ignores_technical_and_new_fields(self):
        previous = make_offer("1")
        current = make_offer("1", extra={
            "summary": "another",
            "url": "http://x",
            "is_new": True,
            "offer_state": "updated",
            "technique_collect": True,
        })
        self.assertEqual(core.compare_offers(previous, current), {})

    def test_compare_detects_title_change(self):
        previous = make_offer("1", title="Avant")
        current = make_offer("1", title="Apres")
        changes = core.compare_offers(previous, current)
        self.assertIn("offer_title", changes)
        self.assertEqual(changes["offer_title"]["old"], "Avant")
        self.assertEqual(changes["offer_title"]["new"], "Apres")

    def test_compare_skips_fields_absent_in_previous(self):
        previous = make_offer("1")
        del previous["salary"]
        current = make_offer("1", salary="1500 euros/mois")
        self.assertEqual(core.compare_offers(previous, current), {})

    def test_whitespace_is_normalized(self):
        previous = make_offer("1", title="  Electro   mecanicien ")
        current = make_offer("1", title="Electro mecanicien")
        self.assertNotIn(
            "offer_title", core.compare_offers(previous, current)
        )


class TestStates(unittest.TestCase):
    def test_four_scrape_scenario(self):
        # -- Scrape 1: three offers all new.
        previous = []
        current = [make_offer("100"), make_offer("200"), make_offer("300")]
        states, current_numbers = core.collect_states(
            previous, current, set()
        )
        self.assertEqual(sorted(states["new"]), ["100", "200", "300"])
        self.assertEqual(states["unchanged"], [])
        self.assertEqual(states["deleted"], [])
        self.assertEqual(len(current_numbers), 3)

        # Offer 200 disappears between scrape 1 and 2 -> keep it in the
        # deleted history for the reappearance detection.
        history = scraper.update_history(
            current, current[:1] + current[2:], {"offers": []}, "t2"
        )
        self.assertEqual(len(history["offers"]), 1)
        self.assertEqual(history["offers"][0]["number"], "200")
        self.assertTrue(history["offers"][0]["removed"])

        deleted_numbers = {str(o["number"]) for o in history["offers"]}

        # -- Scrape 2: 100 unchanged, 300 changed, 400 new, 200 gone.
        previous = [make_offer("100"), make_offer("300")]
        current = [
            make_offer("100"),
            make_offer("300", title="300 modifie"),
            make_offer("400"),
        ]
        states, current_numbers = core.collect_states(
            previous, current, deleted_numbers
        )
        self.assertEqual(states["unchanged"], ["100"])
        self.assertEqual(states["updated"], ["300"])
        self.assertEqual(states["new"], ["400"])
        self.assertEqual(states["reappeared"], [])
        self.assertEqual(states["deleted"], [])

        # -- Scrape 3: 200 is back, 100 unchanged, 300 gone.
        previous = [make_offer("100"), make_offer("300", title="300 modifie"),
                    make_offer("400")]
        current = [make_offer("200"), make_offer("100"), make_offer("400")]
        states, current_numbers = core.collect_states(
            previous, current, deleted_numbers
        )
        self.assertEqual(states["reappeared"], ["200"])
        self.assertEqual(states["unchanged"], ["100", "400"])
        self.assertEqual(states["deleted"], ["300"])

        # -- Scrape 4: 200 modified shortly after its reappearance.
        previous = [make_offer("200"), make_offer("100"), make_offer("400")]
        current = [make_offer("200", title="200 revu"),
                   make_offer("100"), make_offer("400")]
        states, current_numbers = core.collect_states(
            previous, current, deleted_numbers
        )
        self.assertEqual(states["updated"], ["200"])
        self.assertEqual(states["unchanged"], ["100", "400"])

    def test_offers_in_current_counts_as_current(self):
        current = [make_offer("1")]
        states, current_numbers = core.collect_states([], current, set())
        self.assertEqual(current_numbers, {"1"})
        self.assertEqual(states["deleted"], [])

    def test_summarize(self):
        states = {
            "new": ["1"],
            "updated": ["2"],
            "unchanged": ["3"],
            "reappeared": [],
            "deleted": ["4"],
        }
        summary = core.summarize_scrape(states, total=3)
        self.assertEqual(summary["nouvelles"], 1)
        self.assertEqual(summary["modifiees"], 1)
        self.assertEqual(summary["supprimees"], 1)
        self.assertEqual(summary["total_offres"], 3)


class TestModificationsHistory(unittest.TestCase):
    def test_append_and_dedup(self):
        history = core.empty_modifications("t1")
        changes = {"offer_title": {"old": "A", "new": "B"}}
        core.append_modification(history, "1", changes, "t1")
        core.append_modification(history, "1", changes, "t2")
        self.assertEqual(len(history["offers"]["1"]), 1)
        self.assertEqual(history["offers"]["1"][0]["date"], "t2")

        core.append_modification(history, "1", None, "t3", event="deleted")
        self.assertEqual(len(history["offers"]["1"]), 2)
        core.append_modification(history, "1", None, "t4", event="deleted")
        self.assertEqual(len(history["offers"]["1"]), 2)
        self.assertEqual(history["offers"]["1"][1]["date"], "t4")

        core.append_modification(history, "1", None, "t5", event="created")
        self.assertEqual(len(history["offers"]["1"]), 3)

    def test_different_changes_not_collapsed(self):
        history = core.empty_modifications("t1")
        core.append_modification(history, "1", {"offer_title": {"old": "A",
                                                               "new": "B"}}, "t1")
        core.append_modification(history, "1", {"offer_title": {"old": "B",
                                                               "new": "C"}}, "t2")
        self.assertEqual(len(history["offers"]["1"]), 2)


class TestScrapeHistory(unittest.TestCase):
    def test_record_dedup_and_cap(self):
        history = core.empty_scrape_history()
        core.record_scrape(history, {"timestamp": "t1", "search": "",
                                    "total_offres": 3})
        core.record_scrape(history, {"timestamp": "t1", "search": "",
                                    "total_offres": 5})
        self.assertEqual(len(history["scrapes"]), 1)
        self.assertEqual(history["scrapes"][0]["total_offres"], 5)

        history["scrapes"] = [{"timestamp": "s%d" % i, "search": "",
                              "n": i} for i in range(600)]
        core.record_scrape(history, {"timestamp": "s0", "search": ""})
        self.assertLessEqual(len(history["scrapes"]),
                             core.SCRAPES_MAX_ENTRIES)


class TestSalaryAnalysis(unittest.TestCase):
    def test_hourly_values(self):
        self.assertEqual(
            core.extract_hourly_values(
                "Salaire brut de 18,00 eur à 19,25 eur de l'heure"
            ),
            [18.0, 19.25],
        )

    def test_monthly_is_not_hourly(self):
        self.assertEqual(
            core.extract_hourly_values("2400 eur par mois"), []
        )

    def test_analyze_salaries(self):
        offers = [
            make_offer("1", salary="18 eur de l'heure"),
            make_offer("2", pay="20,5 eur de l'heure"),
            make_offer("3", salary=""),
            "not-a-dict",
        ]
        result = core.analyze_salaries(offers)
        self.assertEqual(result["total"], 3)
        self.assertEqual(result["renseignees"], 2)
        self.assertIn(18.0, result["hourly"])
        self.assertIn(20.5, result["hourly"])

    def test_mean_median(self):
        self.assertEqual(core.mean([2, 4]), 3)
        self.assertEqual(core.median([1, 3, 9]), 3)
        self.assertEqual(core.median([1, 3, 9, 27]), 6)
        self.assertIsNone(core.mean([]))
        self.assertIsNone(core.median([]))


class TestBlacklistPolicy(unittest.TestCase):
    def test_legacy_list_format(self):
        blacklist = core.read_blacklist_data(["1880409"])
        self.assertIn("1880409", blacklist)
        # Legacy entries must effectively be skipped.
        self.assertFalse(core.should_fetch("1880409", blacklist))

    def test_single_miss_is_not_blacklisted(self):
        blacklist = {}
        core.note_miss(blacklist, "1", "t1")
        self.assertTrue(core.should_fetch("1", blacklist))

    def test_consecutive_misses_blacklist(self):
        blacklist = {}
        core.note_miss(blacklist, "1", "t1")
        core.note_miss(blacklist, "1", "t2")
        self.assertFalse(core.should_fetch("1", blacklist))

    def test_force_bypasses(self):
        blacklist = {}
        core.note_miss(blacklist, "1", "t1")
        core.note_miss(blacklist, "1", "t2")
        self.assertTrue(core.should_fetch("1", blacklist, force=True))

    def test_recovery_clears(self):
        blacklist = {}
        core.note_miss(blacklist, "1", "t1")
        core.note_miss(blacklist, "1", "t2")
        core.note_recovery(blacklist, "1")
        self.assertTrue(core.should_fetch("1", blacklist))
        self.assertNotIn("1", blacklist)

    def test_dict_format_is_normalized(self):
        data = {
            "7": {"first_seen": "t1", "last_seen": "t2", "attempts": 2},
            "8": "ignored",
        }
        blacklist = core.read_blacklist_data(data)
        self.assertEqual(blacklist["7"]["attempts"], 2)
        self.assertFalse(core.should_fetch("7", blacklist))
        self.assertEqual(blacklist["8"]["attempts"],
                         core.MISS_BLACKLIST_AFTER + 1)


class TestScraperHistoryUpdate(unittest.TestCase):
    def test_appearance_removes_from_history(self):
        previous = [make_offer("100"), make_offer("200")]
        current = [make_offer("100")]
        history = scraper.update_history(
            previous, current, {"offers": []}, "t1"
        )
        self.assertEqual(len(history["offers"]), 1)
        self.assertEqual(history["offers"][0]["number"], "200")
        self.assertEqual(history["offers"][0]["offer_state"], "deleted")

        # 200 comes back: it must leave the history.
        newer = [make_offer("100"), make_offer("200")]
        history = scraper.update_history(
            current, newer, history, "t2"
        )
        self.assertEqual(history["offers"], [])

    def test_duplicate_offers_not_duplicated_in_history(self):
        previous = [make_offer("100"), make_offer("200"), make_offer("200")]
        current = [make_offer("100")]
        history = scraper.update_history(
            previous, current, {"offers": []}, "t1"
        )
        self.assertEqual(len(history["offers"]), 1)


class TestScraperHelpers(unittest.TestCase):
    def test_normalize_published_on_uses_absolute(self):
        offer = make_offer("1")
        offer["published_on"] = "Publie aujourd'hui"
        offer["date_publication"] = "26/09/2026"
        scraper.normalize_published_on(offer)
        self.assertEqual(offer["published_on"], "26-09-26")

    def test_normalize_published_on_keeps_absolute(self):
        offer = make_offer("1", published_on="16-09-26")
        scraper.normalize_published_on(offer)
        self.assertEqual(offer["published_on"], "16-09-26")


class TestMergeDetails(unittest.TestCase):
    def test_fetched_wins_over_previous(self):
        previous = {"1": {"a": 1}, "2": {"a": 2}}
        fetched = {"1": {"a": 3}}
        merged = core.merge_details(
            previous=previous, fetched=fetched, keep={"1", "2", "3"}
        )
        self.assertEqual(merged["1"], {"a": 3})
        self.assertEqual(merged["2"], {"a": 2})

    def test_only_kept_numbers_are_preserved(self):
        previous = {"1": {"a": 1}, "2": {"a": 2}, "3": {"a": 3}}
        fetched = {"4": {"a": 4}}
        merged = core.merge_details(
            previous=previous, fetched=fetched, keep={"2", "4"}
        )
        self.assertEqual(set(merged.keys()), {"2", "4"})

    def test_fetched_number_added_even_if_not_in_keep(self):
        previous = {"1": {"a": 1}}
        fetched = {"9": {"a": 9}}
        merged = core.merge_details(
            previous=previous, fetched=fetched, keep={"1"}
        )
        self.assertEqual(merged["9"], {"a": 9})

    def test_no_payloads_are_dropped_as_none(self):
        previous = {"1": None, "2": {"a": 2}}
        fetched = {"2": None}
        merged = core.merge_details(
            previous=previous, fetched=fetched, keep={"1", "2"}
        )
        self.assertEqual(merged.get("1"), None)
        self.assertEqual(merged["2"], {"a": 2})


if __name__ == "__main__":
    unittest.main()