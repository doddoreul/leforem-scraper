/**
 * Server - HTTP server for LeForem Scraper
 * Converted from serveur.py
 */

import * as http from "http";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import * as url from "url";
import * as crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_DIR = path.dirname(__filename);
const DATA_DIR = path.join(BASE_DIR, "..", "data");

const PORT = 8123;

const OCCUPATIONS_ENDPOINT = "https://www.leforem.be/recherche-offres/api/Nomenclature/RechercheMetiers/{}";
const LOCATIONS_ENDPOINT = "https://www.leforem.be/recherche-offres/api/Nomenclature/Localisations";

const STATIC_FILES: Record<string, [string, string]> = {
  "": ["index.html", "text/html; charset=utf-8"],
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/insights.html": ["insights.html", "text/html; charset=utf-8"],
  "/companies.html": ["companies.html", "text/html; charset=utf-8"],
  "/detail.html": ["detail.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/theme.js": ["theme.js", "application/javascript; charset=utf-8"],
  "/suivi-io.js": ["suivi-io.js", "application/javascript; charset=utf-8"],
  "/script.js": ["script.js", "application/javascript; charset=utf-8"],
  "/insights.js": ["insights.js", "application/javascript; charset=utf-8"],
  "/companies.js": ["companies.js", "application/javascript; charset=utf-8"],
  "/detail.js": ["detail.js", "application/javascript; charset=utf-8"],
  "/scraping-selector.js": ["scraping-selector.js", "application/javascript; charset=utf-8"],
  "/navbar-loader.js": ["navbar-loader.js", "application/javascript; charset=utf-8"],
  "/navbar_include.html": ["navbar_include.html", "text/html; charset=utf-8"],
};

const DATA_FILES: Record<string, string> = {
  "/historique_scrapes.json": "historique_scrapes.json",
  "/historique_modifications.json": "historique_modifications.json",
  "/companies.json": "companies.json",
};

const CLEAN_FILE_NAME = /^(data|details)_[A-Za-z0-9_-]+\.json$/;

const TRASH_DIR = path.join(DATA_DIR, "trash");
await fs.mkdir(TRASH_DIR, { recursive: true });

const MAX_EDIT_BODY = 8 * 1024 * 1024;

const SESSION = {
  get: async (url: string) => {
    const response = await fetch(url);
    return response.json();
  },
  post: async (url: string, body: any) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.json();
  },
};

function scrapeFilesFor(name: string): [string, string] {
  return [`data_${name}.json`, `historique_${name}.json`];
}

function detailsFileFor(name: string): string {
  return `details_${name}.json`;
}

interface HandlerRequest extends http.IncomingMessage {
  url: string;
  method: string;
  headers: http.IncomingHttpHeaders;
}

interface HandlerResponse extends http.ServerResponse {
  _sendJson?: (code: number, content: any) => void;
}

class Handler extends http.Server {
  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const parsed = url.parse(req.url || "/", true);
    const path = parsed.pathname;

    // Add _sendJson helper
    (res as any)._sendJson = (code: number, content: any) => {
      const body = JSON.stringify(content, null, 2);
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
      });
      res.end(body);
    };

    // API endpoints
    if (path === "/api/scrapings") {
      await this.handleScrapings(res);
      return;
    }

    if (path === "/api/nomenclature/locations") {
      await this.handleLocations(res);
      return;
    }

    if (path === "/api/nomenclature/occupations") {
      const q = parsed.query.q || "";
      await this.handleOccupations(q, res);
      return;
    }

    if (req.method === "POST" && path === "/delete-scraping") {
      await this.handleDeleteScraping(req, res);
      return;
    }

    if (req.method === "POST" && path === "/companies.json") {
      await this.handleCompaniesPost(req, res);
      return;
    }

    // Serve static files
    await this.serveFile(req, res, path);
  }

  async handleScrapings(res: http.ServerResponse): Promise<void> {
    if (!await fs.stat(DATA_DIR).then(() => true).catch(() => false)) {
      this._sendJson(res, 200, []);
      return;
    }

    const results = [];
    const files = await fs.readdir(DATA_DIR);
    for (const fileName of files.sort()) {
      if (!CLEAN_FILE_NAME.test(fileName) || !fileName.startsWith("data_")) continue;
      const name = fileName.slice(5, -5); // remove "data_" and ".json"
      
      try {
        const data = JSON.parse(await fs.readFile(path.join(DATA_DIR, fileName), "utf-8"));
        if (!data || typeof data !== "object") continue;
        const offers = data.offers || [];
        results.push({
          name,
          file: fileName,
          history: `historique_${name}.json`,
          details: `details_${name}.json`,
          label: data.label || "",
          scrape_timestamp: data.scrape_timestamp || "",
          occupationGuid: data.occupation_guid || "",
          locationGuid: data.location_guid || "",
          offerCount: Array.isArray(offers) ? offers.length : 0,
        });
      } catch {
        continue;
      }
    }
    results.sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
    this._sendJson(res, 200, results);
  }

  async handleLocations(res: http.ServerResponse): Promise<void> {
    try {
      const response = await fetch(LOCATIONS_ENDPOINT);
      response.raise_for_status();
      const data = await response.json();
      const results = data.map((item: any) => ({
        gufid: item.gufid,
        label: item.libelle,
        code: item.code,
      }));
      this._sendJson(res, 200, results);
    } catch (e) {
      this._sendJson(res, 502, { success: false, error: String(e) });
    }
  }

  async handleOccupations(q: string, res: http.ServerResponse): Promise<void> {
    if (!q) {
      this._sendJson(res, 200, []);
      return;
    }
    try {
      const response = await fetch(OCCUPATIONS_ENDPOINT.replace("{}", q), { timeout: 30000 });
      response.raise_for_status();
      const data = await response.json();
      this._sendJson(res, 200, data);
    } catch (e) {
      this._sendJson(res, 502, { success: false, error: String(e) });
    }
  }

  async handleDeleteScraping(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    const host = req.headers.host || "";
    if (origin && url.parse(origin).host !== host) {
      this._sendJson(res, 403, { error: "origin refused" });
      return;
    }

    let body = "";
    for await (const chunk of req) body += chunk;
    if (body.length > MAX_EDIT_BODY) {
      this._sendJson(res, 400, { error: "invalid body size" });
      return;
    }

    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      this._sendJson(res, 400, { error: "invalid JSON" });
      return;
    }

    if (!payload || typeof payload !== "object" || !payload.name) {
      this._sendJson(res, 400, { error: "missing name" });
      return;
    }

    const name = payload.name;
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      this._sendJson(res, 400, { error: "invalid name format" });
      return;
    }

    const dataFile = `data_${name}.json`;
    const historyFile = `historique_${name}.json`;
    const detailsFile = `details_${name}.json`;

    const moved: string[] = [];
    const errors: string[] = [];

    for (const fname of [dataFile, historyFile, detailsFile]) {
      const src = path.join(DATA_DIR, fname);
      if (await fs.stat(src).then(() => true).catch(() => false)) {
        const dst = path.join(TRASH_DIR, fname);
        try {
          await fs.rename(src, dst);
          moved.push(fname);
        } catch (e) {
          errors.push(`${fname}: ${(e as Error).message}`);
        }
      }
    }

    if (errors.length) {
      this._sendJson(res, 500, { error: "partial failure", moved, errors });
      return;
    }

    this._sendJson(res, 200, { ok: true, moved });
  }

  async handleCompaniesPost(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    const host = req.headers.host || "";
    if (origin && url.parse(origin).host !== host) {
      this._sendJson(res, 403, { error: "origin refused" });
      return;
    }

    let body = "";
    for await (const chunk of req) body += chunk;
    if (body.length > MAX_EDIT_BODY) {
      this._sendJson(res, 400, { error: "invalid body size" });
      return;
    }

    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      this._sendJson(res, 400, { error: "invalid JSON" });
      return;
    }

    if (!payload || typeof payload !== "object" || !payload.employers) {
      this._sendJson(res, 400, { error: "missing employers map" });
      return;
    }

    payload.version = payload.version || 1;
    payload.updated_timestamp = new Date().toISOString();
    // stats would be computed here

    const companiesPath = path.join(DATA_DIR, "companies.json");
    try {
      await fs.mkdir(path.dirname(companiesPath), { recursive: true });
      const tempPath = `${companiesPath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), "utf-8");
      await fs.rename(tempPath, companiesPath);
    } catch (exc) {
      this._sendJson(res, 500, { error: String(exc) });
      return;
    }

    this._sendJson(res, 200, { ok: true, employeurs: Object.keys(payload.employers).length });
  }

  async serveFile(req: http.IncomingMessage, res: http.ServerResponse, path: string): Promise<void> {
    let fileName: string;
    let fileRoot: string;
    let mimeType: string;

    if (STATIC_FILES[path]) {
      [fileName, mimeType] = STATIC_FILES[path];
      fileRoot = BASE_DIR;
    } else if (DATA_FILES[path]) {
      fileName = DATA_FILES[path];
      fileRoot = DATA_DIR;
      mimeType = "application/json; charset=utf-8";
    } else {
      const baseName = path.split("/").pop() || "";
      if (CLEAN_FILE_NAME.test(baseName) || 
          (baseName.startsWith("historique_") && baseName.endsWith(".json"))) {
        fileName = baseName;
        fileRoot = DATA_DIR;
        mimeType = "application/json; charset=utf-8";
      } else {
        res.writeHead(404);
        res.end();
        return;
      }
    }

    const fileDir = path.resolve(fileRoot);
    const filePath = path.resolve(path.join(fileDir, fileName));
    if (!filePath.startsWith(fileDir)) {
      res.writeHead(404);
      res.end();
      return;
    }

    try {
      const body = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": mimeType, "Content-Length": body.length, "Cache-Control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  }

  _sendJson(code: number, content: any, res: http.ServerResponse): void {
    const body = JSON.stringify(content, null, 2);
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Cache-Control": "no-store",
    });
    res.write(body);
    res.end();
  }

  logMessage(format: string, ...args: any[]): void {
    process.stderr.write(`${this.logDateTimeString()} - ${format.replace(/%s/g, () => args.shift())}\n`);
  }

  logDateTimeString(): string {
    return new Date().toISOString();
  }
}

async function main(): Promise<void> {
  const server = new Handler();
  await server.listen(PORT, "127.0.0.1");
  console.log(`Web interface on http://localhost:${PORT}`);
  console.log("(Ctrl+C to stop)");
}

main().catch(console.error);