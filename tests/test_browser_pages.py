# -*- coding: utf-8 -*-
"""End-to-end check of the four pages in a real browser.

The pages are ES modules: nothing here proves they load, that every import
resolves and that the page actually draws something. Headless Edge loads each
page against the real server, seeded with one small search, and the resulting
DOM is inspected. A module that fails to parse or to load never runs, so its
markers are missing.

The test is skipped when Edge is not installed (set EDGE_PATH to point at
another Chromium-based browser). Nothing from the Forem is requested.

Run from the repository root:
    python -m unittest discover -s tests -v
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
)

from leforem_scraper import config  # noqa: E402
from leforem_scraper import server  # noqa: E402

EDGE_CANDIDATES = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/microsoft-edge",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
)

VIRTUAL_TIME_BUDGET = "5000"

# One search, two offers: enough for the table, the dashboard, the employer
# index and the offer sheet to have something to draw.
OFFERS = [
    {
        "number": "1902",
        "offer_title": "Electromecanicien industriel",
        "company": "Ateliers du Sud",
        "location": "Liege",
        "contract_type": "CDI",
        "schedule": "temps plein",
        "salary": '{"min": 2800, "max": 3400}',
        "pay": '{"min": 2800, "max": 3400}',
        "published_on": "2026-09-25",
        "removed_on": "",
        "modified_at": "2026-09-26T08:15:00",
        "modified": "2026-09-26",
        "date_fin_diffusion": "2026-11-30",
        "description": "<p>Tien de poste au sein d'une equipe.</p>",
        "email": "jobs@example.be",
        "is_new": True,
        "offer_state": "new",
        "diff": {
            "contract_type": ["CDD", "CDI"],
            "description": [
                "<p>Tien de poste au sein d'une equipe de jour.</p>",
                "<p>Tien de poste au sein d'une equipe de nuit.</p>",
            ],
        },
    },
    {
        "number": "1903",
        "offer_title": "Technicien de maintenance",
        "company": "Fonderie du Nord",
        "location": "Charleroi",
        "contract_type": "CDD",
        "schedule": "temps plein",
        "salary": "",
        "pay": "",
        "published_on": "2026-08-02",
        "removed_on": "",
        "modified_at": "2026-08-02T09:00:00",
        "modified": "2026-08-02",
        "date_fin_diffusion": "",
        "description": "<p>Maintenance preventive.</p>",
        "email": "",
        "is_new": False,
        "offer_state": "old",
        "diff": {},
    },
]

DETAIL = {
    "numero": "1902",
    "titreOffre": "Electromecanicien industriel",
    "nomEmployeur": "Ateliers du Sud",
    "typeContrat": {"libelle": "CDI"},
    "lieuxTravail": [{"libelle": "Liege"}],
    "datePublication": "25-09-26",
    "dateDebutDiffusion": "25-09-26",
    "dateFinDiffusion": "30-11-26",
    "dateModification": "26-09-26",
    "nombrePostes": 1,
    "descriptionJob": (
        '<p><span style="color:rgb(89,89,89);background-color:rgb(255,255,255);">'
        "Une formation technique de type bachelier en electromecanique.</span>"
        '<span style="font-family:\'Tahoma\';font-size:16px;">second bloc</span></p>'
    ),
    "descriptionEmployeur": (
        '<p style="text-align: justify;">PME industrielle.'
        '<span style="background-color:rgb(253,253,253);">coll&eacute;e</span>'
        "</p>"
    ),
    "experience": {"libelle": "3 ans"},
    "etudes": [{"libelle": "Bac technique"}],
    "competencies": [{"libelle": "Electricite"}],
    "softSkills": [{"libelle": "Rigueur"}],
    "langues": [{"libelle": "Francais"}],
    "certifications": [],
    "permisConduire": [{"libelle": "B"}],
    "isDeplacementRequired": False,
    "benefits": ["Assurance"],
    "benefitsComments": "",
    "howToApply": "jobs@example.be",
    "officeSkills": [],
    "regimeTravail": {"libelle": "Jour"},
    "regimeTravailPrecision": "",
    "secteurActiviteEmployeur": {"libelle": "Industrie"},
    "travel": "",
    "logoMimeType": "",
    "logoEmployeur": "",
    "metier": {"libelle": "Electromecanicien"},
    "idOffreEmploi": "1902",
}

HISTORY = {
    "1902": {"timestamp": "2026-09-26T08:15:00", "offer_state": "new"},
    "1903": {"timestamp": "2026-08-02T09:00:00", "offer_state": "old"},
}

COMPANIES = {
    "version": 1,
    "employers": {
        "Ateliers du Sud": {
            "nomEmployeur": "Ateliers du Sud",
            "nombreOffres": 1,
            "emails": ["jobs@example.be"],
            "contacts": [],
            "adresses": [{"rue": "Rue du Moulin 1",
                           "codePostal": "4000",
                           "municipalite": "Liege"}],
            "sites": [],
            "secteurs": [],
            "partenaires": [],
            "description": "PME industrielle.",
            "offers": [{"numero": "1902",
                        "titre": "Electromecanicien industriel"}],
            "premierePublication": "2026-09-25",
            "dernieresModifications": ["2026-09-26"],
        }
    },
    "stats": {"total": 1, "avecEmail": 1},
}

# Loads the offer sheet in an iframe and clicks its diff button, so a
# --dump-dom run shows what the user gets after asking for the diff.
DIFF_PROBE = """<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"></head><body>
<pre id="out">pending</pre>
<iframe id="frame" src="/detail.html?number=1902&base=metier_liege"
        width="900" height="600"></iframe>
<script type="module">
const out = document.getElementById("out");
const lines = [];
function log(line) { lines.push(line); out.textContent = lines.join("\\n"); }

const frame = document.getElementById("frame");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The profile is reused by every test, and the choice is remembered on
// purpose: start from a clean slate so the first state is the default one.
try { localStorage.removeItem("forem_plain_styles"); } catch (e) {}
frame.src = "/detail.html?number=1902&base=metier_liege&reload=1";

for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    const doc = frame.contentDocument;
    if (!doc) continue;

    // --- The pasted styles, before the button is used -----------------
    const rich = doc.querySelector(".rich-html");
    const pasted = rich && rich.querySelector("[style]");
    log("styledBefore=" + (pasted ? pasted.getAttribute("style") : "none"));
    const styleToggle = doc.querySelector(".style-toggle");
    log("styleButtonBefore=" + (styleToggle
        ? styleToggle.textContent.trim() + "/" + styleToggle.getAttribute("aria-pressed")
        : "absent"));

    if (styleToggle) {
        styleToggle.click();
        await sleep(120);
        const after = rich.querySelector("[style]");
        log("styledAfter=" + (after ? after.getAttribute("style") : "none"));
        log("styleButtonAfter=" + styleToggle.textContent.trim() + "/"
            + styleToggle.getAttribute("aria-pressed"));
        log("stored=" + (frame.contentWindow.localStorage
            .getItem("forem_plain_styles") || "absent"));

        // And back on: the styles the employer pasted must return.
        styleToggle.click();
        await sleep(120);
        const back = rich.querySelector("[style]");
        log("restyled=" + (back ? back.getAttribute("style") : "none"));
        log("styleButtonBack=" + styleToggle.textContent.trim() + "/"
            + styleToggle.getAttribute("aria-pressed"));
        log("storedBack=" + (frame.contentWindow.localStorage
            .getItem("forem_plain_styles") || "absent"));
    }

    // --- The diff, before the button is used --------------------------
    const toggle = doc.querySelector(".diff-toggle");
    if (!toggle) { log("DIFF-NOT-FOUND"); break; }

    const body = doc.querySelector(".diff-body");
    log("button=" + toggle.textContent.trim());
    log("hiddenBefore=" + body.classList.contains("hidden"));
    log("blocksBefore=" + doc.querySelectorAll(".diff-block").length);

    toggle.click();
    await sleep(120);
    log("buttonAfter=" + toggle.textContent.trim());
    log("hiddenAfter=" + body.classList.contains("hidden"));
    log("blocksAfter=" + doc.querySelectorAll(".diff-block").length);
    log("fields=" + Array.from(doc.querySelectorAll(".diff-field"))
        .map(n => n.textContent).join("|"));
    log("oldText=" + (doc.querySelector(".diff-old .diff-text") || {}).textContent);
    log("newText=" + (doc.querySelector(".diff-new .diff-text") || {}).textContent);
    log("DIFF-OK");
    break;
}
log("done");
</script>
</body></html>
"""

# Imports every module and calls the shared helpers: the import errors a
# --dump-dom run cannot show are reported here.
PROBE = """<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"></head><body>
<pre id="out">pending</pre>
<script type="module">
const out = document.getElementById("out");
const lines = [];
function log(line) { lines.push(line); out.textContent = lines.join("\\n"); }

const MODULES = [
    "api.js", "dates.js", "dom.js", "links.js", "navbar.js", "scraper-ui.js",
    "scraping-selector.js", "statuses.js", "storage.js", "suivi.js",
    "text.js", "theme.js",
];

try {
    const loaded = {};
    for (const name of MODULES) {
        loaded[name] = await import("/js/shared/" + name);
    }
    const api = loaded["api.js"];
    const dates = loaded["dates.js"];
    const dom = loaded["dom.js"];
    const links = loaded["links.js"];
    const statuses = loaded["statuses.js"];
    const storage = loaded["storage.js"];
    const suivi = loaded["suivi.js"];
    const text = loaded["text.js"];
    const selector = loaded["scraping-selector.js"];

    log("imported=" + MODULES.length);
    log("dates=" + dates.parseForemDate("25-09-26").getFullYear());
    log("dateTime=" + dates.formatDateTime("2026-09-26T08:15:00"));
    log("detailHref=" + links.detailHref(1902, "metier-liege"));
    log("offerUrl=" + links.offerUrl(1902));
    log("statuses=" + statuses.STATUS_OPTIONS.length + "/"
        + statuses.PRIORITY_OPTIONS.length + " " + statuses.statusLabel(""));
    log("prefix=" + storage.storagePrefixFor("metier-liege"));
    log("gears=" + suivi.TRACKING_GEAR_ACTIONS.length);
    log("el=" + dom.el("p", "x", "y").outerHTML);
    log("normalize=" + text.normalizeText("Electromecanicien"));
    log("selector=" + selector.STORAGE_KEY + " "
        + typeof selector.createScrapingSelector);
    log("scrapings=" + (await api.fetchScrapings()).length);
    log("PROBE-OK");
} catch (error) {
    log("PROBE-FAIL " + (error && error.stack ? error.stack : error));
}
</script>
</body></html>
"""


def find_browser():
    candidates = [os.environ.get("EDGE_PATH") or ""]
    candidates.extend(EDGE_CANDIDATES)
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


BROWSER = find_browser()


class ProbeHandler(server.Handler):
    """The real handler, plus the page that exercises every module."""

    def _serve_file(self, path):
        if path in ("/probe.html", "/diff-probe.html"):
            body = (PROBE if path == "/probe.html" else DIFF_PROBE).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super()._serve_file(path)


@unittest.skipUnless(BROWSER, "aucun navigateur headless trouve (EDGE_PATH)")
class BrowserPagesTestCase(unittest.TestCase):
    """Boots the real server on a temporary data directory."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.profile = tempfile.TemporaryDirectory()
        seed(cls.tmp.name)

        cls._saved_data_dir = config.DATA_DIR
        config.DATA_DIR = cls.tmp.name

        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), ProbeHandler)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever)
        cls.thread.daemon = True
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)
        config.DATA_DIR = cls._saved_data_dir
        cls.profile.cleanup()
        cls.tmp.cleanup()

    def dump(self, path):
        result = subprocess.run(
            [
                BROWSER,
                "--headless=new",
                "--disable-gpu",
                "--no-first-run",
                "--no-default-browser-check",
                "--user-data-dir=" + self.profile.name,
                "--virtual-time-budget=" + VIRTUAL_TIME_BUDGET,
                "--dump-dom",
                f"http://127.0.0.1:{self.port}{path}",
            ],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
        )
        return result.stdout or ""


def seed(folder):
    def write(name, payload):
        with open(os.path.join(folder, name), "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False)

    write("data_metier_liege.json", {
        "label": "Metier / Liege",
        "scrape_timestamp": "2026-09-26T08:15:00",
        "occupation_guid": "occ-guid",
        "location_guid": "loc-guid",
        "offers": OFFERS,
    })
    write("historique_metier_liege.json", HISTORY)
    write("details_metier_liege.json", {"details": {"1902": DETAIL}})
    write("historique_scrapes.json", {"scrapes": []})
    write("historique_modifications.json", {"modifications": []})
    write("companies.json", COMPANIES)


class TestModulesInBrowser(BrowserPagesTestCase):
    def test_every_shared_module_loads(self):
        dom = self.dump("/probe.html")
        start = dom.find('<pre id="out">')
        end = dom.find("</pre>", start)
        self.assertGreater(start, 0, "la page de sonde n'a pas rendu")
        report = dom[start:end]

        self.assertIn("PROBE-OK", report, report)
        self.assertIn("imported=12", report)
        self.assertNotIn("PROBE-FAIL", report)

    def report_of(self, path):
        dom = self.dump(path)
        start = dom.find('<pre id="out">')
        end = dom.find("</pre>", start)
        self.assertGreater(start, 0, "la sonde n'a pas rendu")
        return dom[start:end]

    def test_the_pasted_styles_can_be_switched_off(self):
        report = self.report_of("/diff-probe.html")

        # The button exists because the offer carries inline styles...
        self.assertIn("styleButtonBefore=", report)
        self.assertIn("Styles du texte : activés/false", report)
        # ...they are still on when the page opens...
        self.assertIn("background-color:rgb(255,255,255)", report)
        # ...and one click drops the colours, the fonts and the alignment
        # while keeping the text and the tags.
        self.assertIn("styleButtonAfter=Styles du texte : désactivés/true",
                      report)
        self.assertIn("stored=1", report)
        self.assertNotIn("styledAfter=background-color", report)
        self.assertNotIn("styledAfter=font-family", report)
        self.assertNotIn("styledAfter=text-align", report)

    def test_the_styles_come_back_when_asked_again(self):
        report = self.report_of("/diff-probe.html")

        # Second click restores exactly what Forem sent.
        self.assertIn("styleButtonBack=Styles du texte : activés/false",
                      report)
        self.assertIn(
            "restyled=color:rgb(89,89,89);background-color:rgb(255,255,255)",
            report,
        )
        self.assertIn("storedBack=0", report)

    def test_the_diff_appears_when_asked(self):
        report = self.report_of("/diff-probe.html")

        self.assertIn("DIFF-OK", report)
        self.assertIn("button=Afficher le diff", report)
        self.assertIn("hiddenBefore=true", report)
        self.assertIn("blocksBefore=0", report)
        self.assertIn("buttonAfter=Masquer le diff", report)
        self.assertIn("hiddenAfter=false", report)
        self.assertIn("blocksAfter=2", report)
        self.assertIn("fields=Description|Type de contrat", report)
        # The HTML of the stored descriptions is shown as text.
        self.assertIn(
            "oldText=Tien de poste au sein d'une equipe de jour.", report
        )
        self.assertIn(
            "newText=Tien de poste au sein d'une equipe de nuit.", report
        )


class TestPagesInBrowser(BrowserPagesTestCase):
    def assertDrawn(self, path, markers):
        dom = self.dump(path)
        self.assertTrue(dom, path + " : DOM vide")
        for marker in markers:
            with self.subTest(path=path, marker=marker):
                self.assertIn(marker, dom)

    def test_the_theme_is_applied_before_the_first_paint(self):
        for page in ("", "/insights.html", "/companies.html", "/detail.html"):
            with self.subTest(page=page):
                dom = self.dump(page)
                self.assertRegex(dom, r'data-theme="(light|dark)"')

    def test_every_page_draws_its_cogwheel(self):
        for page in ("", "/insights.html", "/companies.html", "/detail.html"):
            with self.subTest(page=page):
                dom = self.dump(page)
                self.assertIn('id="themeGear"', dom)
                self.assertIn("Exporter le suivi", dom)

    def test_the_offers_table_fills_on_open(self):
        self.assertDrawn("", [
            'id="scrapingSelect"',
            "Toutes les recherches",
            "Ateliers du Sud",
            "Electromecanicien industriel",
            "Fonderie du Nord",
        ])

    def test_the_offers_page_keeps_its_controls(self):
        # Everything the offers page owns, moved or not: a split must not
        # lose a control.
        self.assertDrawn("", [
            "Exporter CSV",
            "Supprimer ce scraping",
            "Nouvelle recherche",
            "Intéressé",
            "Postulé",
            "RDV prévu",
            "Postulé ou contacté depuis plus de 7 jours.",
            'id="stateFilter"',
            'id="contractFilter"',
            'id="salaryFilter"',
            'id="currentSearch"',
            'id="exportCsvBtn"',
            'id="deleteScrapingGearBtn"',
        ])

    def test_the_dashboard_draws_its_kpis(self):
        self.assertDrawn("/insights.html", [
            "Electromecanicien industriel",
            "Metier / Liege",
        ])

    def test_the_employer_page_draws_the_index(self):
        self.assertDrawn("/companies.html", ["Ateliers du Sud"])

    def test_the_offer_sheet_draws_the_fiche(self):
        self.assertDrawn("/detail.html?number=1902&base=metier_liege", [
            "Electromecanicien industriel",
            "Intéressé",
            "Voir l'offre sur Le Forem",
        ])

    def test_the_diff_is_hidden_until_asked(self):
        dom = self.dump("/detail.html?number=1902&base=metier_liege")
        self.assertIn("Afficher le diff", dom)
        self.assertIn("Modifications (2)", dom)
        # The offer is shown, not the diff.
        self.assertNotIn("Masquer le diff", dom)
        self.assertNotIn('class="diff-block"', dom)

    def test_an_offer_without_changes_has_no_diff_button(self):
        dom = self.dump("/detail.html?number=1903&base=metier_liege")
        self.assertNotIn("diff-card", dom)
        self.assertNotIn("Afficher le diff", dom)

    def test_no_page_reports_a_missing_module(self):
        for page in ("", "/insights.html", "/companies.html", "/detail.html"):
            with self.subTest(page=page):
                dom = self.dump(page)
                self.assertNotIn("Failed to load module", dom)
                self.assertNotIn("is not defined", dom)


if __name__ == "__main__":
    unittest.main()