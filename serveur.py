import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import requests

import scraper

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

PORT = 8123

OCCUPATIONS_ENDPOINT = (
    "https://www.leforem.be/recherche-offres/"
    "api/Nomenclature/RechercheMetiers/{}"
)
LOCATIONS_ENDPOINT = (
    "https://www.leforem.be/recherche-offres/"
    "api/Nomenclature/Localisations"
)

STATIC_FILES = {
    "": ("index.html", "text/html; charset=utf-8"),
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/insights.html": ("insights.html", "text/html; charset=utf-8"),
    "/detail.html": ("detail.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/script.js": ("script.js", "application/javascript; charset=utf-8"),
    "/insights.js": ("insights.js", "application/javascript; charset=utf-8"),
    "/detail.js": ("detail.js", "application/javascript; charset=utf-8"),
    "/data.json": ("data.json", "application/json; charset=utf-8"),
    "/historique_supprimees.json": (
        "historique_supprimees.json", "application/json; charset=utf-8"
    ),
    "/historique_modifications.json": (
        "historique_modifications.json", "application/json; charset=utf-8"
    ),
    "/historique_scrapes.json": (
        "historique_scrapes.json", "application/json; charset=utf-8"
    ),
}

CLEAN_FILE_NAME = re.compile(r"data_[A-Za-z0-9_-]+\.json")

SESSION = requests.Session()
SESSION.headers.update(scraper.HEADERS)


def scrape_files_for(name):
    if name:
        return (
            f"data_{name}.json",
            f"historique_{name}.json",
            f"historique_modifications_{name}.json",
        )
    return (
        "data.json",
        "historique_supprimees.json",
        "historique_modifications.json",
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "LeForemScraper/1.0"

    def _send_json(self, code, content):
        body = json.dumps(content, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, path):
        if path in STATIC_FILES:
            file_name, mime_type = STATIC_FILES[path]
        else:
            base_name = os.path.basename(path)
            if CLEAN_FILE_NAME.fullmatch(base_name):
                file_name = base_name
                mime_type = "application/json; charset=utf-8"
            elif base_name.startswith("historique_") and base_name.endswith(
                ".json"
            ):
                file_name = base_name
                mime_type = "application/json; charset=utf-8"
            else:
                self.send_error(404)
                return

        file_path = os.path.join(BASE_DIR, file_name)
        if os.path.dirname(file_path) != BASE_DIR:
            self.send_error(404)
            return
        try:
            with open(file_path, "rb") as f:
                body = f.read()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", mime_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/scrapings":
            self._handle_scrapings()
            return

        if path == "/api/nomenclature/locations":
            self._handle_locations()
            return

        if path == "/api/nomenclature/occupations":
            params = dict(
                p.split("=", 1) for p in parsed.query.split("&") if "=" in p
            )
            q = params.get("q", "").strip()
            self._handle_occupations(q)
            return

        self._serve_file(path)

    def _handle_scrapings(self):
        results = []
        for file_name in sorted(os.listdir(BASE_DIR)):
            if file_name == "data.json":
                name = ""
            elif CLEAN_FILE_NAME.fullmatch(file_name):
                name = file_name[len("data_"):-len(".json")]
            else:
                continue
            try:
                with open(os.path.join(BASE_DIR, file_name),
                          "r", encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(data, dict):
                continue
            offers = data.get("offers", [])
            results.append({
                "name": name,
                "file": file_name,
                "history": scrape_files_for(name)[1],
                "modifications": scrape_files_for(name)[2],
                "label": data.get("label", "") or "",
                "scrape_timestamp": data.get("scrape_timestamp", "") or "",
                "occupationGuid": data.get("occupation_guid", "") or "",
                "locationGuid": data.get("location_guid", "") or "",
                "offerCount": len(offers) if isinstance(offers, list) else 0,
            })
        results.sort(key=lambda e: (e["file"] != "data.json",
                                    e["label"] or e["name"]))
        self._send_json(200, results)

    def _handle_occupations(self, q):
        if not q:
            self._send_json(200, [])
            return
        try:
            response = SESSION.get(OCCUPATIONS_ENDPOINT.format(q), timeout=30)
            response.raise_for_status()
            data = response.json()
        except Exception as e:
            self._send_json(502, {"success": False, "error": str(e)})
            return
        results = [
            {"key": item.get("key", ""), "value": item.get("value", "")}
            for item in data
            if isinstance(item, dict)
        ]
        self._send_json(200, results)

    def _handle_locations(self):
        try:
            response = SESSION.get(LOCATIONS_ENDPOINT, timeout=30)
            response.raise_for_status()
            data = response.json()
        except Exception as e:
            self._send_json(502, {"success": False, "error": str(e)})
            return
        results = [
            {
                "gufid": item.get("gufid", ""),
                "label": item.get("libelle", ""),
                "code": item.get("code", ""),
            }
            for item in data
            if isinstance(item, dict) and item.get("gufid")
        ]
        self._send_json(200, results)

    def log_message(self, format, *args):
        sys.stderr.write(
            "%s - %s\n" % (self.log_date_time_string(), format % args)
        )


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Web interface on http://localhost:{PORT}")
    print("(Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()