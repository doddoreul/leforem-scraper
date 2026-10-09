# -*- coding: utf-8 -*-
"""Tests of the update check logic (electron/update-check.js).

The module is pure JavaScript on purpose, so it is exercised with Node:
the Electron process only calls it. Skipped when Node is not installed.

Run from the repository root:
    python -m unittest discover -s tests
"""

import json
import os
import shutil
import subprocess
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULE_PATH = os.path.join(REPO_ROOT, "electron", "update-check.js")

SCRIPT = r"""
const path = require("path");
const updater = require(path.resolve(process.env.LEFOREM_REPO,
                                     "electron", "update-check.js"));

const cases = {
    // compareVersions
    "same": updater.compareVersions("v1.1.6", "1.1.6"),
    "older": updater.compareVersions("v1.1.6", "v1.1.7"),
    "newer": updater.compareVersions("v1.2.0", "v1.1.9"),
    "major": updater.compareVersions("v2.0.0", "v1.9.9"),
    "garbage": updater.compareVersions("nimporte", "v1.0.0"),
    "empty": updater.compareVersions("", ""),

    // pickAsset : le portable récupère le portable, l'installeur le setup
    "pickPortable": (function () {
        const asset = updater.pickAsset([
            { name: "LeForem-Scraper-1.1.7-Setup.exe",
              browser_download_url: "u-setup", size: 1 },
            { name: "LeForem-Scraper-1.1.7-Portable.exe",
              browser_download_url: "u-portable", size: 2 },
        ], true);
        return asset && asset.browser_download_url;
    })(),
    "pickSetup": (function () {
        const asset = updater.pickAsset([
            { name: "LeForem-Scraper-1.1.7-Setup.exe",
              browser_download_url: "u-setup", size: 1 },
            { name: "LeForem-Scraper-1.1.7-Portable.exe",
              browser_download_url: "u-portable", size: 2 },
        ], false);
        return asset && asset.browser_download_url;
    })(),
    "pickFallback": (function () {
        const asset = updater.pickAsset([
            { name: "notes.txt", browser_download_url: "u-notes" },
            { name: "LeForem-Scraper.exe", browser_download_url: "u-exe" },
        ], true);
        return asset ? asset.browser_download_url : null;
    })(),
    "pickNone": updater.pickAsset([], true),

    // releaseStatus
    "statusAvailable": (function () {
        const status = updater.releaseStatus({
            tag_name: "v1.1.7",
            html_url: "https://example/release",
            published_at: "2026-10-10T10:00:00Z",
            body: "correctifs",
            assets: [
                { name: "LeForem-Scraper-1.1.7-Portable.exe",
                  browser_download_url: "u-portable", size: 124000000 },
            ],
        }, "1.1.6", true);
        return [status.available, status.latest, status.current,
                status.assetName, status.assetSize, status.releaseUrl];
    })(),
    "statusUpToDate": (function () {
        const status = updater.releaseStatus({
            tag_name: "v1.1.6", html_url: "u", assets: [] }, "1.1.6", false);
        return [status.available, status.latest];
    })(),
    "statusOlderRelease": (function () {
        const status = updater.releaseStatus({
            tag_name: "v1.1.5", html_url: "u", assets: [] }, "1.1.6", false);
        return [status.available, status.latest];
    })(),
    "statusNoTag": (function () {
        const status = updater.releaseStatus({}, "1.1.6", false);
        return [status.available, status.latest];
    })(),
};

console.log(JSON.stringify(cases));
"""


@unittest.skipUnless(
    shutil.which("node"), "node n'est pas installe (mises a jour non testees)"
)
class TestUpdateCheck(unittest.TestCase):
    """The pure update logic, run through Node."""

    def run_cases(self):
        env = dict(os.environ, LEFOREM_REPO=REPO_ROOT)
        result = subprocess.run(
            ["node", "-e", SCRIPT],
            capture_output=True,
            text=True,
            timeout=60,
            env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_versions_are_compared_numerically(self):
        cases = self.run_cases()
        self.assertEqual(cases["same"], 0)
        self.assertEqual(cases["older"], -1)
        self.assertEqual(cases["newer"], 1)
        # 2.0.0 est plus récent que 1.9.9 (comparaison numérique, pas texte)
        self.assertEqual(cases["major"], 1)
        self.assertEqual(cases["garbage"], -1)  # illisible = 0 : le plus vieux
        self.assertEqual(cases["empty"], 0)

    def test_each_flavour_downloads_its_own_executable(self):
        cases = self.run_cases()
        self.assertEqual(cases["pickPortable"], "u-portable")
        self.assertEqual(cases["pickSetup"], "u-setup")
        # Sans variante connue, n'importe quel .exe fait l'affaire.
        self.assertEqual(cases["pickFallback"], "u-exe")
        self.assertIsNone(cases["pickNone"])

    def test_a_newer_release_offers_its_asset(self):
        cases = self.run_cases()
        available, latest, current, name, size, url = cases["statusAvailable"]
        self.assertTrue(available)
        self.assertEqual(latest, "v1.1.7")
        self.assertEqual(current, "1.1.6")
        self.assertEqual(name, "LeForem-Scraper-1.1.7-Portable.exe")
        self.assertEqual(size, 124000000)
        self.assertEqual(url, "https://example/release")

    def test_the_same_version_offers_nothing(self):
        cases = self.run_cases()
        self.assertEqual(cases["statusUpToDate"], [False, "v1.1.6"])
        self.assertEqual(cases["statusOlderRelease"], [False, "v1.1.5"])
        self.assertEqual(cases["statusNoTag"], [False, ""])