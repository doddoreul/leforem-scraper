/**
 * LeForem Scraper - TypeScript Implementation
 * 
 * Main scraper logic for fetching and processing Forem job offers.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { 
  ScraperConfig, 
  ScraperFiles, 
  SCRAPER_CONSTANTS, 
  DEFAULT_HEADERS,
  ScraperFiles as ScraperFilesType
} from "./types";
import { 
  readJsonFile, 
  writeJsonAtomically, 
  cleanNumber, 
  parseForemDate,
  normalizeForHash,
  computeContentHash,
  computeDiff,
  nowIsoTimestamp,
  filterRecentOffers,
  buildMetierIndex,
  preserveUserData,
  nowIsoTimestamp,
  filterRecentOffers
} from "../shared";

import { Offer } from "../shared/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(path.dirname(__filename), "..", "..", "data");

// ============================================================
// FILE HELPERS
// ============================================================

export function getScraperFiles(baseName: string): ScraperFiles {
  return {
    dataFile: path.join(DATA_DIR, `data_${baseName}.json`),
    historyFile: path.join(DATA_DIR, `historique_${baseName}.json`),
    detailsFile: path.join(DATA_DIR, `details_${baseName}.json`),
  };
}

// ============================================================
// JSON FILE READING / WRITING
// ============================================================

export async function readJsonFile<T>(path: string, defaultModel: T | null = null): Promise<T | null> {
  try {
    const content = await fs.readFile(path, "utf-8");
    const data = JSON.parse(content);
    if (defaultModel !== null && typeof data !== "object") return defaultModel;
    return data as T;
  } catch {
    return defaultModel;
  }
}

export async function writeJsonAtomically<T>(path: string, content: T): Promise<void> {
  const dir = path.dirname(path);
  await fs.mkdir(dir, { recursive: true });
  const tempPath = `${path}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(content, null, 2), "utf-8");
  await fs.rename(tempPath, path);
}

// ============================================================
// HTTP REQUEST HELPERS
// ============================================================

const throttleLock = { current: Promise.resolve() };
let nextRequestAt = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  if (nextRequestAt > now) {
    await new Promise(resolve => setTimeout(resolve, nextRequestAt - now));
  }
  nextRequestAt = Date.now() + 350 + Math.random() * 100;
}

async function requestJsonWithRetry(url: string, options: RequestInit = {}, attempts = 3): Promise<any> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "fr-BE,fr;q=0.9,en;q=0.8",
    "Content-Type": "application/json",
    "Origin": "https://www.leforem.be",
    "Referer": "https://www.leforem.be/recherche-offres/resultat-recherche",
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    await throttle();
    try {
      const response = await fetch(url, { ...{ headers }, ...options });
      const status = response.status;
      const retryable = status === 429 || status >= 500;
      if (!retryable || attempt === 3) {
        if (!response.ok) throw new Error(`HTTP ${status}`);
        return response.json();
      }
      await new Promise(r => setTimeout(r, 2000 * attempt));
    } catch (e) {
      if (attempt === 3) throw e;
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error("Failed after retries");
}

// ============================================================
// OFFER SEARCH
// ============================================================

interface SearchOfferResult {
  number: string;
  published_on: string;
}

async function searchOffers(
  occupationGuid: string,
  locationGuid: string,
  limit?: number
): Promise<Array<{ number: string; published_on: string }>> {
  const payload = {
    filtres: [],
    filtresCodifies: [],
    metier: [],
    secteur: [],
    lieuxTravail: [{ nom: "Nomenclatures/CodeInsBelge", guid: locationGuid }],
    locutionsGufids: [occupationGuid],
    priority: 1,
  };

  const seenNumbers = new Set<string>();
  const offers: Array<{ number: string; published_on: string }> = [];
  let page = 1;
  const ROW = 50;
  const SEARCH_URL_BASE = "https://www.leforem.be/recherche-offres/api/Recherches/Search";

  while (true) {
    const url = `https://www.leforem.be/recherche-offres/api/Recherches/Search?page=${page}&row=50`;
    console.log(`Search page ${page}...`);

    const data = await requestJsonWithRetry(
      "https://www.leforem.be/recherche-offres/api/Recherches/Search",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, page, row: 50 }),
      }
    );

    const results = data.offreEmploiResumees || [];
    const total = data.total || 0;
    const pageCount = data.pageCount || 1;

    console.log(`  -> ${results.length} result(s) (total: ${total})`);

    for (const offer of results) {
      if (typeof offer !== "object" || !offer) continue;
      const number = cleanNumber(offer.numero);
      if (!number || seenNumbers.has(number)) continue;
      seenNumbers.add(number);
      offers.push({
        number,
        published_on: String(offer.publication ?? ""),
      });
      if (limit && offers.length >= limit) break;
    }

    if (limit && offers.length >= limit) break;
    if (page >= (data.pageCount || 1)) break;
    page++;
  }

  console.log(`\nOffers retained: ${offers.length}`);
  return offers;
}

// We need to define the search payload
const payload = {
  filtres: [],
  filtresCodifies: [],
  metier: [],
  secteur: [],
  lieuxTravail: [{ nom: "Nomenclatures/CodeInsBelge", guid: "" }],
  locutionsGufids: [""],
  priority: 1,
};

function cleanNumber(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function cleanText(value: unknown): string {
  if (!value) return "";
  return String(value).trim();
}

// ============================================================
// DETAIL FETCHING
// ============================================================

async function fetchDetail(number: string): Promise<any> {
  const url = `https://www.leforem.be/recherche-offres/api/Diffusion/DetailOffre/${number}`;
  return requestJsonWithRetry(url);
}

// We need to implement this
async function requestJsonWithRetry(url: string): Promise<any> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

// ============================================================
// OFFER BUILDING
// ============================================================

async function buildOffer(detail: any, publishedOn: string): Promise<any> {
  const number = cleanNumber(detail?.numero);

  const url = number
    ? `https://www.leforem.be/recherche-offres/offre-detail/${number}?originPostuler=RECHOFFRE`
    : "";

  const description = detail.descriptionJob ? String(detail.descriptionJob).replace(/<[^>]*>/g, "") : "";

  const datePublication = cleanText(
    detail.datePublication || detail.dateDebutDiffusion
  );
  if (!parseForemDate(datePublication)) {
    const fallback = cleanText(detail.dateDebutDiffusion);
    if (!parseForemDate(fallback)) {
      // fallback handled in parseForemDate
    }
  }

  const offer = {
    number,
    offer_title: cleanText(detail.titreOffre),
    description,
    company: cleanText(detail.nomEmployeur),
    email: "", // extractEmail would go here
    url,
    contract_type: formatContractType(detail.typeContrat),
    schedule: extractSchedule(detail),
    pay: extractPay(detail.benefits),
    salary: extractSalary(detail),
    location: extractLocation(detail.lieuxTravail),
    published_on: cleanText(publishedOn),
    date_publication: datePublication,
    date_fin_diffusion: cleanText(detail.dateFinDiffusion),
    metier: cleanText(detail.metier),
    summary: buildSummary(description),
  };

  // Add content hash for change detection
  // const hash = await computeContentHash(offer);
  // offer.content_hash = hash;

  // Add timestamps
  const now = new Date().toISOString();
  offer.last_scraped_at = now;
  offer.last_seen_at = now;

  return offer;
}

function cleanText(value: unknown): string {
  if (!value) return "";
  return String(value).replace(/<[^>]*>/g, "").trim();
}

function cleanNumber(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseForemDate(value: string): string {
  if (!value) return "";
  const text = String(value).trim();
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}`;
  match = value.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (match) return `20${match[3]}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}`;
  match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}`;
  return "";
}

function formatContractType(value: unknown): string {
  if (!value) return "";
  const text = String(value).toLowerCase();
  if (text.includes("indetermin")) return "CDI";
  if (text.includes("determin")) return "CDD";
  if (text.includes("interim")) return "Intérim";
  return "Autre";
}

function extractSchedule(detail: any): string {
  if (!detail?.horaire) return "";
  return String(detail.horaire).trim();
}

function extractPay(benefits: any): string {
  if (!benefits) return "";
  if (typeof benefits === "object") return String(benefits.remuneration ?? "");
  return String(benefits);
}

function extractSalary(detail: any): string {
  if (!detail?.benefits) return "";
  if (typeof detail.benefits === "object") return String(detail.benefits.remuneration ?? "");
  return String(detail.benefits);
}

function extractLocation(workplaces: any): string {
  if (!workplaces) return "";
  if (Array.isArray(workplaces)) {
    return workplaces.map((w: any) => w.libelle ?? w).filter(Boolean).join(", ");
  }
  if (typeof workplaces === "object") return String(workplaces.libelle ?? "");
  return String(workplaces);
}

function buildSummary(description: string): string {
  if (!description) return "";
  const text = description.replace(/<[^>]*>/g, "");
  return text.length > 200 ? text.slice(0, 200) + "..." : text;
}

function formatContractType(value: unknown): string {
  if (!value) return "";
  const text = String(value).toLowerCase();
  if (text.includes("indetermin")) return "CDI";
  if (text.includes("determin")) return "CDD";
  if (text.includes("interim")) return "Intérim";
  return "Autre";
}

function extractSchedule(detail: any): string {
  if (!detail?.horaire) return "";
  return String(detail.horaire).trim();
}

function extractPay(benefits: any): string {
  if (!benefits) return "";
  if (typeof benefits === "object") return String((benefits as any).remuneration ?? "");
  return String(benefits);
}

function extractSalary(detail: any): string {
  if (!detail?.benefits) return "";
  if (typeof detail.benefits === "object") return String((detail.benefits as any).remuneration ?? "");
  return String(detail.benefits);
}

function extractLocation(workplaces: any): string {
  if (!workplaces) return "";
  if (Array.isArray(workplaces)) {
    return workplaces.map((w: any) => w.libelle ?? w).filter(Boolean).join(", ");
  }
  if (typeof workplaces === "object") return String((workplaces as any).libelle ?? "");
  return String(workplaces);
}

function buildSummary(description: string): string {
  if (!description) return "";
  const text = description.replace(/<[^>]*>/g, "");
  return text.length > 200 ? text.slice(0, 200) + "..." : text;
}

function cleanText(value: unknown): string {
  if (!value) return "";
  return String(value).replace(/<[^>]*>/g, "").trim();
}

function parseForemDate(value: string): string {
  if (!value) return "";
  const text = String(value).trim();
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}`;
  match = value.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (match) return `20${match[3]}-${match[2].padStart(2,"0")}-${match[1].padStart(2,"0")}`;
  match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2,"0")}-${match[3].padStart(2,"0")}`;
  return "";
}