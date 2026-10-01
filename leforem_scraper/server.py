"""The local web server: static files, the data API and the scrape route.

Everything is served from ``http://localhost:8123``; the page is plain HTML,
CSS and ES modules, so there is no build step and nothing to install beyond
``requests``.

Routes:

===========================  ==========================================
``GET  /...``                 static files and the shared JSON files
``GET  /api/scrapings``       the searches present in ``data/``
``GET  /api/nomenclature/...`` professions and locations, proxied to Forem
``POST /api/scraper/run``     run a scrape, streaming NDJSON events
``POST /delete-scraping``     move a search's files to ``data/trash/``
``POST /companies.json``      save the employer index edited by hand
===========================  ==========================================
"""

import json
import os
import re
import shutil
import sys
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import requests

from leforem_scraper import config
from leforem_scraper import scraper
from leforem_scraper.employers import refresh_index, summarize

BASE_DIR = config.BASE_DIR

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
    "/companies.html": ("companies.html", "text/html; charset=utf-8"),
    "/detail.html": ("detail.html", "text/html; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/navbar_include.html": ("navbar_include.html", "text/html; charset=utf-8"),
}

# The pages are plain ES modules: one entry per page in js/pages/ and the
# modules they share in js/shared/ and js/boot/.
JS_DIR = os.path.join(BASE_DIR, "js")
JS_PATH = re.compile(r"^/js/(?:boot|shared|pages)/[A-Za-z0-9_-]+\.js$")
JAVASCRIPT_MIME = "application/javascript; charset=utf-8"

DATA_FILES = {
    "/historique_scrapes.json": config.SCRAPES_FILE_NAME,
    "/historique_modifications.json": config.MODIFICATIONS_FILE_NAME,
    "/companies.json": config.COMPANIES_FILE_NAME,
}

CLEAN_FILE_NAME = re.compile(r"(data|details)_[A-Za-z0-9_-]+\.json")

# Synchronous scraping: the browser blocks on this route until scraper.py
# has finished writing its files.
SCRAPER_RUN_PATH = "/api/scraper/run"
SCRAPING_NAME = re.compile(r"[A-Za-z0-9_-]+")
_scraper_lock = threading.Lock()

os.makedirs(config.trash_dir(), exist_ok=True)

MAX_EDIT_BODY = 8 * 1024 * 1024

SESSION = requests.Session()
SESSION.headers.update(scraper.HEADERS)


def scrape_files_for(name):
    return (
        f"data_{name}.json",
        f"historique_{name}.json",
    )


def details_file_for(name):
    return f"details_{name}.json"


class StreamReporter:
    """Turns the real scraper events into NDJSON lines.

    The scraper runs in this very request thread; each line it logs is
    forwarded to the browser while the request stays open. Nothing runs in
    the background: the response is finished once scraper.py returns.
    """

    def __init__(self, handler):
        self.handler = handler

    def log(self, message=""):
        lines = str(message).splitlines() or [""]
        for line in lines:
            self.handler.log_message("scraper | %s", line)
            self.handler._write_event({"type": "log", "line": line})

    def progress(self, done, total):
        self.handler._write_event(
            {"type": "progress", "done": done, "total": total}
        )

    def progress_done(self):
        pass


class Handler(BaseHTTPRequestHandler):
    server_version = "LeForemScraper/1.0"
    # Required to stream the scraper log while the request is still open.
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self._stream_broken = False

    def _send_json(self, code, content):
        body = json.dumps(content, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _serve_file(self, path):
        if path in DATA_FILES:
            file_name = DATA_FILES[path]
            file_root = config.DATA_DIR
            mime_type = "application/json; charset=utf-8"
        elif JS_PATH.match(path):
            file_name = path[len("/js/"):]
            file_root = JS_DIR
            mime_type = JAVASCRIPT_MIME
        elif path in STATIC_FILES:
            file_name, mime_type = STATIC_FILES[path]
            file_root = BASE_DIR
        else:
            base_name = os.path.basename(path)
            if (
                CLEAN_FILE_NAME.fullmatch(base_name)
                or (
                    base_name.startswith("historique_")
                    and base_name.endswith(".json")
                )
            ):
                file_name = base_name
                file_root = config.DATA_DIR
                mime_type = "application/json; charset=utf-8"
            else:
                self.send_error(404)
                return

        file_dir = os.path.normpath(file_root)
        file_path = os.path.normpath(os.path.join(file_dir, file_name))
        # The modules live in sub-directories: only their own tree is served.
        if os.path.commonpath([file_dir, file_path]) != file_dir:
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

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == SCRAPER_RUN_PATH:
            self._handle_scraper_run()
            return
        if parsed.path == "/delete-scraping":
            self._handle_delete_scraping()
            return
        if parsed.path != "/companies.json":
            self.send_error(404)
            return

        origin = self.headers.get("Origin")
        host = self.headers.get("Host") or ""
        if origin and urlparse(origin).netloc != host:
            self._send_json(403, {"error": "origin refused"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_EDIT_BODY:
            self._send_json(400, {"error": "invalid body size"})
            return

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"error": "invalid JSON"})
            return

        if not isinstance(payload, dict) or not isinstance(
            payload.get("employers"), dict
        ):
            self._send_json(400, {"error": "missing employers map"})
            return

        payload["version"] = payload.get("version") or 1
        payload["updated_timestamp"] = scraper.now_iso_timestamp()
        payload["stats"] = summarize(payload["employers"])
        try:
            scraper.write_json_atomically(
                config.companies_file(), payload
            )
        except OSError as exc:
            self._send_json(500, {"error": str(exc)})
            return

        self._send_json(200, {
            "ok": True,
            "employeurs": len(payload["employers"]),
        })

    def _handle_scrapings(self):
        if not os.path.isdir(config.DATA_DIR):
            self._send_json(200, [])
            return
        results = []
        for file_name in sorted(os.listdir(config.DATA_DIR)):
            if CLEAN_FILE_NAME.fullmatch(file_name) and file_name.startswith("data_"):
                name = file_name[len("data_"):-len(".json")]
            else:
                continue
            try:
                with open(os.path.join(config.DATA_DIR, file_name),
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
                "details": details_file_for(name),
                "label": data.get("label", "") or "",
                "scrape_timestamp": data.get("scrape_timestamp", "") or "",
                "occupationGuid": data.get("occupation_guid", "") or "",
                "locationGuid": data.get("location_guid", "") or "",
                "offerCount": len(offers) if isinstance(offers, list) else 0,
            })
        results.sort(key=lambda e: e["label"] or e["name"])
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

    # ============================================================
    # SYNCHRONOUS SCRAPING (POST /api/scraper/run)
    # ============================================================

    def _origin_allowed(self):
        origin = self.headers.get("Origin")
        host = self.headers.get("Host") or ""
        return not origin or urlparse(origin).netloc == host

    def _read_json_body(self, required=True):
        """Return (payload, error_message)."""
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return (None, "empty body") if required else ({}, None)
        if length > MAX_EDIT_BODY:
            return None, "invalid body size"
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None, "invalid JSON"
        if not isinstance(payload, dict):
            return None, "invalid JSON"
        return payload, None

    def _start_stream(self):
        self.send_response(200)
        self.send_header(
            "Content-Type", "application/x-ndjson; charset=utf-8"
        )
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

    def _write_event(self, event):
        if self._stream_broken:
            return
        body = json.dumps(event, ensure_ascii=False).encode("utf-8") + b"\n"
        try:
            self.wfile.write(b"%X\r\n" % len(body))
            self.wfile.write(body)
            self.wfile.write(b"\r\n")
            self.wfile.flush()
        except OSError as exc:
            # Browser closed the page: the scrape still runs to the end,
            # only the live log is dropped.
            self._stream_broken = True
            self.log_message("scraper stream closed: %s", exc)

    def _end_stream(self):
        if self._stream_broken:
            self.close_connection = True
            return
        try:
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except OSError:
            self.close_connection = True

    def _read_scraping_target(self, name, payload):
        """GUIDs and label of one scraping. The stored values win, so the
        request cannot scrape another search than the selected one."""
        stored = {}
        try:
            with open(
                os.path.join(config.DATA_DIR, f"data_{name}.json"),
                "r",
                encoding="utf-8",
            ) as f:
                data = json.load(f)
            if isinstance(data, dict):
                stored = data
        except (OSError, json.JSONDecodeError):
            stored = {}

        occupation_guid = (
            stored.get("occupation_guid") or payload.get("occupation_guid") or ""
        )
        location_guid = (
            stored.get("location_guid") or payload.get("location_guid") or ""
        )
        if not occupation_guid or not location_guid:
            return None

        return {
            "occupation_guid": str(occupation_guid),
            "location_guid": str(location_guid),
            "label": str(stored.get("label") or payload.get("label") or ""),
        }

    def _handle_scraper_run(self):
        """Run scraper.py and answer only once it is finished.

        The response is streamed (one NDJSON line per real scraper event) so
        the terminal follows the run, but the request stays open and blocking
        for the whole duration: no task, queue or job is created.
        """
        if not self._origin_allowed():
            self._send_json(403, {"error": "origin refused"})
            return

        payload, error = self._read_json_body(required=False)
        if error:
            self._send_json(400, {"error": error})
            return

        name = str(payload.get("name") or "").strip()
        if not SCRAPING_NAME.fullmatch(name):
            self._send_json(
                400,
                {"error": "Sélectionnez un scraping précis à actualiser."},
            )
            return

        target = self._read_scraping_target(name, payload)
        if target is None:
            self._send_json(
                404, {"error": "Recherche inconnue ou incomplète : " + name}
            )
            return

        if not _scraper_lock.acquire(blocking=False):
            self._send_json(
                409, {"error": "Un scraping est déjà en cours."}
            )
            return

        try:
            self._run_scraper(
                name, target, refresh=bool(payload.get("refresh"))
            )
        finally:
            _scraper_lock.release()

    def _run_scraper(self, name, target, refresh):
        self.log_message("scraper run started for %s", name)
        self._start_stream()
        reporter = StreamReporter(self)

        try:
            summary = scraper.run_scrape(
                occupation_guid=target["occupation_guid"],
                location_guid=target["location_guid"],
                base=name,
                label=target["label"],
                refresh=refresh,
                reporter=reporter,
                # The user already confirmed in the web interface.
                confirm=lambda question: True,
            )
        except Exception as exc:
            self.log_message("scraper run failed for %s: %s", name, exc)
            self._write_event({
                "type": "error",
                "message": str(exc) or exc.__class__.__name__,
                "details": traceback.format_exc(limit=8),
            })
            self._end_stream()
            return

        # The employer index is rebuilt from the offers just written, so the
        # "Entreprises" page never lags behind the scraping. A failure here
        # must not turn a successful scrape into an error.
        self._refresh_employer_index()

        self.log_message(
            "scraper run finished for %s: %s offer(s), %s new, %s modified, "
            "%s error(s) in %ss",
            name,
            summary.get("total_offres"),
            summary.get("nouvelles"),
            summary.get("modifiees"),
            summary.get("erreurs"),
            summary.get("duration_seconds"),
        )
        self._write_event({"type": "done", "result": summary})
        self._end_stream()

    def _refresh_employer_index(self):
        """Rebuild data/companies.json after a scrape.

        Best effort: an unreadable or partial index is logged and the scrape
        result is left untouched, because the offers themselves are fine and
        the index can be rebuilt again later.
        """
        try:
            stats = refresh_index(
                config.companies_file()
            )
        except Exception as exc:
            self.log_message(
                "employer index not refreshed: %s: %s",
                exc.__class__.__name__,
                exc,
            )
            return None

        self.log_message(
            "employer index refreshed: %s employer(s), %s conserved",
            stats.get("employeurs"),
            stats.get("conserves"),
        )
        return stats

    def _handle_delete_scraping(self):
        """Move all files for a scraping to trash."""
        parsed = urlparse(self.path)
        if parsed.path != "/delete-scraping":
            self.send_error(404)
            return

        origin = self.headers.get("Origin")
        host = self.headers.get("Host") or ""
        if origin and urlparse(origin).netloc != host:
            self._send_json(403, {"error": "origin refused"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_EDIT_BODY:
            self._send_json(400, {"error": "invalid body size"})
            return

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"error": "invalid JSON"})
            return

        if not isinstance(payload, dict) or "name" not in payload:
            self._send_json(400, {"error": "missing name"})
            return

        name = payload["name"]
        if not name or not isinstance(name, str):
            self._send_json(400, {"error": "invalid name"})
            return

        # Sanitize name to prevent path traversal
        if not re.fullmatch(r"[A-Za-z0-9_-]+", name):
            self._send_json(400, {"error": "invalid name format"})
            return

        data_file = f"data_{name}.json"
        history_file = f"historique_{name}.json"
        details_file = f"details_{name}.json"

        moved = []
        errors = []

        for fname in (data_file, history_file, details_file):
            src = os.path.join(config.DATA_DIR, fname)
            if os.path.exists(src):
                dst = os.path.join(config.trash_dir(), fname)
                try:
                    shutil.move(src, dst)
                    moved.append(fname)
                except OSError as e:
                    errors.append(f"{fname}: {e}")
            # If file doesn't exist, that's okay - just skip

        if errors:
            self._send_json(500, {"error": "partial failure", "moved": moved, "errors": errors})
            return

        self._send_json(200, {"ok": True, "moved": moved})

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