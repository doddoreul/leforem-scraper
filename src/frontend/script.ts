/**
 * Frontend - Main application entry point
 * Complete TypeScript conversion from script.js
 */

import { 
  parseForemDate, 
  formatDate, 
  formatRelative,
  cleanNumber,
  nowIsoTimestamp,
  daysBetween
} from "../shared";

import { 
  createScrapingSelector,
  ScrapingSelector 
} from "./scraping-selector";

// ============================================================
// CONFIGURATION
// ============================================================

let dataUrl = "";
let historyUrl = "";
const DEFAULT_STORAGE_PREFIX = "forem_electromecanicien_";

let storagePrefix = DEFAULT_STORAGE_PREFIX;
let activeBaseName = "";
let staleAlertShown = false;

const STALE_AFTER_HOURS = 12;
const FOLLOWUP_DAYS = 30;
const SUGGESTION_LIMIT = 12;

const STATUS_OPTIONS = [
  { value: "", label: "—" },
  { value: "interesse", label: "Intéressé" },
  { value: "pas_interesse", label: "Pas intéressé" },
  { value: "postule", label: "Postulé" },
  { value: "contacte", label: "Contacté" },
  { value: "refuse", label: "Refusé" },
  { value: "rdv", label: "RDV prévu" },
  { value: "generique", label: "Annonce générique" },
];

const FOLLOWUP_STATUSES = ["postule", "contacte"];
const FOLLOWUP_DAYS = 7;

let currentOffers: any[] = [];
let deletedOffers: any[] = [];
let lastScrapeDate = "";
let lastData: any = null;
let staleAlertShown = false;

let sortTable: string | null = null;
let sortKey: string | null = null;
let sortDir: number = 0; // 0 none, 1 ascending, -1 descending

let dataUrl = "";
let historyUrl = "";
const DEFAULT_STORAGE_PREFIX = "forem_electromecanicien_";

let storagePrefix = DEFAULT_STORAGE_PREFIX;
let activeBaseName = "";
let staleAlertShown = false;

const STALE_AFTER_HOURS = 12;
const FOLLOWUP_DAYS = 30;
const SUGGESTION_LIMIT = 12;

const STATUS_OPTIONS = [
  { value: "", label: "—" },
  { value: "interesse", label: "Intéressé" },
  { value: "pas_interesse", label: "Pas intéressé" },
  { value: "postule", label: "Postulé" },
  { value: "contacte", label: "Contacté" },
  { value: "refuse", label: "Refusé" },
  { value: "rdv", label: "RDV prévu" },
  { value: "generique", label: "Annonce générique" },
];

const FOLLOWUP_STATUSES = ["postule", "contacte"];
const FOLLOWUP_DAYS = 7;

let currentOffers: any[] = [];
let deletedOffers: any[] = [];
let lastScrapeDate = "";
let lastData: any = null;
let staleAlertShown = false;

let sortTable: string | null = null;
let sortKey: string | null = null;
let sortDir: number = 0; // 0 none, 1 ascending, -1 descending

// ============================================================
// STORAGE HELPERS
// ============================================================

const DEFAULT_STORAGE_PREFIX = "forem_electromecanicien_";
let storagePrefix = DEFAULT_STORAGE_PREFIX;
let activeBaseName = "";

function getStorageKey(suffix: string): string {
  return storagePrefix + suffix;
}

function setActiveScraping(baseName: string): void {
  storagePrefix = baseName ? "forem_" + baseName + "_" : DEFAULT_STORAGE_PREFIX;
  activeBaseName = baseName || "";
}

// ============================================================
// LOCAL STORAGE HELPERS
// ============================================================

interface StatusesMap { [key: string]: string; }
interface RemarksMap { [key: string]: string; }
interface FavoritesMap { [key: string]: boolean; }
interface StatutDatesMap { [key: string]: string; }
interface PrioritiesMap { [key: string]: string; }

let statuses: Record<string, string> = {};
let remarks: Record<string, string> = {};
let favorites: Record<string, boolean> = {};
let statutDates: Record<string, string> = {};
let priorities: Record<string, string> = {};

function getStorageKey(suffix: string): string {
  return storagePrefix + suffix;
}

function setActiveScraping(baseName: string): void {
  storagePrefix = baseName ? "forem_" + baseName + "_" : DEFAULT_STORAGE_PREFIX;
  activeBaseName = baseName || "";
}

function readPref(key: string, allowed: string[], fallback: string): string {
  try {
    const raw = localStorage.getItem(key);
    if (allowed.indexOf(raw) !== -1) return raw;
  } catch { }
  return fallback;
}

function storePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch { }
}

// ============================================================
// LOCAL STORAGE (statuses)
// ============================================================

interface StatusesMap { [key: string]: string; }
let statuses: Record<string, string> = {};

function loadStatuses(): Record<string, string> {
  try { const raw = localStorage.getItem(getStorageKey("statuts")); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
function saveStatuses() { try { localStorage.setItem(getStorageKey("statuts"), JSON.stringify(statuses)); } catch (e) { console.error("Unable to save statuses", e); } }
function getStatus(number: string): string { return statuses[number] || ""; }
function setStatus(number: string, value: string) { if (value) statuses[number] = value; else delete statuses[number]; saveStatuses(); }
function cleanStatuses(currentNumbers: Set<string>) { let changed = false; Object.keys(statuses).forEach(n => { if (!currentNumbers.has(n)) { delete statuses[n]; changed = true; } }); if (changed) saveStatuses(); }

// ============================================================
// LOCAL STORAGE (statut dates)
// ============================================================

let statutDates: Record<string, string> = {};

function loadStatutDates(): Record<string, string> { try { const v = localStorage.getItem(getStorageKey("statut_dates")); return v ? JSON.parse(v) : {}; } catch { return {}; } }
function saveStatutDates() { try { localStorage.setItem(getStorageKey("statut_dates"), JSON.stringify(statutDates)); } catch (e) { console.error("Unable to save statut dates", e); } }
function getStatutDate(number: string): string { return statutDates[number] || ""; }
function setStatutDate(number: string, value: string) { if (value) statutDates[number] = value; else delete statutDates[number]; saveStatutDates(); }
function backfillStatutDates() { let changed = false; currentOffers.forEach(o => { const n = String(o.number); const s = getStatus(n); if (s && !statutDates[n]) { statutDates[n] = nowIsoTimestamp(); } }); saveStatutDates(); }

// ============================================================
// LOCAL STORAGE (remarks)
// ============================================================

let remarks: Record<string, string> = {};

function loadRemarks(): Record<string, string> { try { const v = localStorage.getItem(getStorageKey("remarques")); return v ? JSON.parse(v) : {}; } catch { return {}; } }
function saveRemarks() { try { localStorage.setItem(getStorageKey("remarques"), JSON.stringify(remarks)); } catch (e) { console.error("Unable to save remarks", e); } }
function getRemark(number: string): string { return remarks[number] || ""; }
function setRemark(number: string, value: string) { if (value) remarks[number] = value; else delete remarks[number]; saveRemarks(); }
function cleanRemarks(currentNumbers: Set<string>) { let changed = false; Object.keys(remarks).forEach(n => { if (!currentNumbers.has(n)) { delete remarks[n]; } }); saveRemarks(); }

// ============================================================
// LOCAL STORAGE (favorites)
// ============================================================

let favorites: Record<string, boolean> = {};

function loadFavorites(): Record<string, boolean> { try { const v = localStorage.getItem(getStorageKey("favoris")); return v ? JSON.parse(v) : {}; } catch { return {}; } }
function saveFavorites() { try { localStorage.setItem(getStorageKey("favoris"), JSON.stringify(favorites)); } catch (e) { console.error("Unable to save favorites", e); } }
function isFavorite(number: string): boolean { return favorites[number] === true; }
function setFavorite(number: string, active: boolean) { if (active) favorites[number] = true; else delete favorites[number]; saveFavorites(); }
function cleanFavorites(currentNumbers: Set<string>) { Object.keys(favorites).forEach(n => { if (!currentNumbers.has(n)) delete favorites[n]; }); saveFavorites(); }

// ============================================================
// LOCAL STORAGE (priorities)
// ============================================================

const PRIORITY_OPTIONS = [ { value: "", label: "Aucune" }, { value: "haute", label: "Haute" }, { value: "moyenne", label: "Moyenne" }, { value: "faible", label: "Faible" } ];
let priorities: Record<string, string> = {};

function loadPriorities(): Record<string, string> { try { const v = localStorage.getItem(getStorageKey("priorites")); return v ? JSON.parse(v) : {}; } catch { return {}; } }
function savePriorities() { try { localStorage.setItem(getStorageKey("priorites"), JSON.stringify(priorities)); } catch (e) { console.error("Unable to save priorities", e); } }
function getPriority(number: string): string { return priorities[String(number)] || ""; }
function setPriority(number: string, value: string) { if (value) priorities[String(number)] = value; else delete priorities[String(number)]; savePriorities(); }
function priorityLabel(value: string): string { const o = PRIORITY_OPTIONS.find(o => o.value === value); return o ? o.label : ""; }
function cleanPriorities(currentNumbers: Set<string>) { Object.keys(priorities).forEach(n => { if (!currentNumbers.has(n)) delete priorities[n]; }); savePriorities(); }

// Re-reads the in-memory maps from localStorage. Needed when the
// active scraping changes or after an import restores the data.
function reloadStorageMaps() { statuses = loadStatuses(); remarks = loadRemarks(); favorites = loadFavorites(); statutDates = loadStatutDates(); priorities = loadPriorities(); }

export {};