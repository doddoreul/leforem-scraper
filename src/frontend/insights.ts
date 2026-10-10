/**
 * Dashboard/Insights page
 * Converted from insights.js
 */

import { 
  parseForemDate, 
  formatDate, 
  formatRelative,
  cleanNumber
} from "../shared";

import { 
  createScrapingSelector,
  filterScrapings,
  ScrapingItem
} from "./scraping-selector";

const DEFAULT_PREFIX = "forem_electromecanicien_";
const DASH_SCOPE_KEY = "forem_dash_select";

interface ScrapingItem {
  name: string;
  file: string;
  history: string;
  details: string;
  label: string;
  scrape_timestamp: string;
  occupationGuid: string;
  locationGuid: string;
  offerCount: number;
}

interface DataSet {
  entry: ScrapingItem;
  prefix: string;
  offers: any[];
  deleted: any[];
}

const INSIGHTS_STATUS: [string, string][] = [
  ["", "Non trié"],
  ["interesse", "Intéressé"],
  ["pas_interesse", "Pas intéressé"],
  ["postule", "Postulé"],
  ["contacte", "Contacté"],
  ["refuse", "Refusé"],
  ["rdv", "RDV prévu"],
  ["generique", "Annonce générique"],
];

const STATE_TXT: Record<string, string> = {
  new: "Nouvelle",
  reappeared: "De retour",
  old: "Ancienne",
  deleted: "Supprimée",
};

let scrapings: ScrapingItem[] = [];
let scope = "all";
let scopeFile = "all";
let dataSets: any[] = [];
let lastScrapeHistory: any = null;

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) return null;
  return response.json();
}

function statusLabel(value: string): string {
  const item = INSIGHTS_STATUS.find(s => s[0] === value);
  return item ? item[1] : value || "Non trié";
}

function prefixFor(name: string): string {
  return name ? "forem_" + name + "_" : DEFAULT_PREFIX;
}

function loadPrefixedMap(prefix: string, suffix: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(prefix + suffix);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readScope(): string {
  try {
    const raw = localStorage.getItem("forem_scraping_select");
    if (raw === "all") return "all";
    if (scrapings.some(s => s.name === raw)) return raw;
  } catch {
    // ignore
  }
  return "all";
}

async function populateScopeSelect(): Promise<void> {
  const select = document.getElementById("dashScope") as HTMLSelectElement;
  if (!select) return;

  return createScrapingSelector({
    selectId: "dashScope",
    allowAll: true,
    allowCreate: true,
    onChange: (key) => {
      if (key === "all") {
        scope = "all";
        scopeFile = "all";
      } else {
        const found = scrapings.find(s => s.file === key);
        if (found) {
          scope = found.name;
          scopeFile = found.file;
        } else {
          scope = "all";
          scopeFile = "all";
        }
      }
      try {
        localStorage.setItem("forem_scraping_select", scopeFile);
      } catch {
        // ignore
      }
      refresh();
    }
  });
}

function scopeEntries(): ScrapingItem[] {
  if (scope === "all") return scrapings;
  return scrapings.filter(s => s.name === scope);
}

function offerState(offer: any): string {
  if (offer.offer_state) return offer.offer_state;
  return offer.is_new === true ? "new" : "old";
}

function parseForemDate(value: string): Date | null {
  if (!value) return null;
  const text = String(value).trim();
  let m = /^(\d{1,2})-(\d{1,2})-(\d{2})$/.exec(text);
  if (m) {
    const d = new Date("20" + m[3] + "-" + m[2] + "-" + m[1] + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  m = /^(\d{4})-/.exec(text);
  if (m) {
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatDay(value: string): string {
  const d = parseForemDate(value);
  if (!d) return value || "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return dd + "/" + mm;
}

function formatRelative(value: string): string {
  const d = parseForemDate(value);
  if (!d) return value || "";
  const n = Math.round((d.getTime() - Date.now()) / 86400000);
  if (n === 0) return "aujourd'hui";
  if (n < 0) {
    const q = -n;
    return q === 1 ? "il y a 1 jour" : "il y a " + q + " jours";
  }
  return n === 1 ? "dans 1 jour" : "dans " + n + " jours";
}

function detailHref(entryName: string, number: string): string {
  const params = new URLSearchParams({ number: String(number) });
  if (entryName) params.set("base", entryName);
  return "detail.html?" + params.toString();
}

function collectOffers() {
  const offers: any[] = [];
  const byNumber: Record<string, any> = {};
  dataSets.forEach(ds => {
    (ds.offers || []).forEach(offer => {
      offers.push(offer);
      byNumber[String(offer.number)] = offer;
    });
  }
  return { offers, byNumber };
}

function collectiveCounts() {
  const counts = { new: 0, reappeared: 0, old: 0 };
  collectOffers().offers.forEach(offer => {
    const state = offerState(offer);
    if (!counts[state]) counts[state] = 0;
    counts[state]++;
  });
  return counts;
}

function statusCounts() {
  const counts: Record<string, number> = {};
  dataSets.forEach(ds => {
    const map = loadPrefixedMap(prefixFor(ds.entry.name), "statuts");
    Object.values(map).forEach(value => {
      if (value) counts[value] = (counts[value] || 0) + 1;
    });
  });
  return counts;
}

function trackedTotals() {
  let suivies = 0, favoris = 0, priorites = 0;
  dataSets.forEach(ds => {
    suivies += Object.values(loadPrefixedMap(prefixFor(ds.entry.name), "statuts"))
      .filter(Boolean).length;
    favoris += Object.values(loadPrefixedMap(prefixFor(ds.entry.name), "favoris"))
      .filter(Boolean).length;
    priorites += Object.values(loadPrefixedMap(prefixFor(ds.entry.name), "priorites"))
      .filter(Boolean).length;
  });
  return { suivies, favoris, priorites };
}

function deletedCount() {
  return dataSets.reduce((sum, ds) => sum + (ds.deleted || []).length, 0);
}

function lastScrapeTimestamp() {
  const ts = dataSets
    .map(ds => ds.entry.scrape_timestamp || "")
    .filter(Boolean)
    .sort()
    .pop();
  return ts || null;
}

function extractHourlyValues(payText: string): number[] {
  const values: number[] = [];
  const pattern = /(\d{1,3}(?:,\d{1,2})?)\s*(?:€|euros?)?\s*de l'heure/gi;
  let m;
  while ((m = pattern.exec(payText || "")) !== null) {
    values.push(parseFloat(m[1].replace(",", ".")));
  }
  return values;
}

async function refresh(): Promise<void> {
  const entries = scopeEntries();
  dataSets = await Promise.all(entries.map(async entry => {
    const data = await fetchJson(entry.file);
    const hist = await fetchJson(entry.history);
    return {
      entry,
      prefix: prefixFor(entry.name),
      offers: data && Array.isArray(data.offers) ? data.offers : [],
      deleted: hist && Array.isArray(hist.offers) ? hist.offers : [],
    };
  }));
  const scrapeHistory = await fetchJson("/historique_scrapes.json");
  render(scrapeHistory);
}

function render(scrapeHistory: any): void {
  // Dashboard rendering implementation would go here
  // This is a placeholder for the full implementation
}

function showEmpty(): void {
  document.getElementById("dashEmpty")!.classList.remove("hidden");
}

async function init(): Promise<void> {
  scrapings = await fetchJson("/api/scrapings") || [];
  if (!scrapings.length) {
    showEmpty();
    return;
  }
  const stored = localStorage.getItem("forem_scraping_select");
  if (stored === "all") {
    scope = "all";
  } else {
    const found = scrapings.find(s => s.name === stored);
    if (found) scope = found.name;
  }
  await populateScopeSelect();
  await refresh();

  // Handle "Créer un nouveau scrap" from shared selector
  document.addEventListener("foremCreateScrape", function () {
    window.open("index.html", "_blank");
  });
}

document.addEventListener("DOMContentLoaded", init);

document.addEventListener("foremthemechange", function () {
  if (lastScrapeHistory) render(lastScrapeHistory);
});

document.addEventListener("foremsuiviimported", function () {
  refresh();
});