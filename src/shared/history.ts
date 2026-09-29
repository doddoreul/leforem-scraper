/**
 * Scrape History Management
 */

export interface ScrapeEntry {
  timestamp: string;
  search: string;
  label: string;
  nouvelles: number;
  inchangées: number;
  réapparues: number;
  supprimées: number;
  total_offres: number;
}

export interface ScrapeHistory {
  version: number;
  scrapes: Array<{
    timestamp: string;
    search: string;
    label: string;
    nouvelles: number;
    inchangées: number;
    réapparues: number;
    supprimées: number;
    total_offres: number;
  }>;
}

export const SCRAPES_VERSION = 1;
export const SCRAPES_MAX_ENTRIES = 500;

export function emptyScrapeHistory() {
  return { version: 1, scrapes: [] };
}

export function readScrapeHistory(data: unknown): { version: number; scrapes: unknown[] } {
  if (!data || typeof data !== "object" || !Array.isArray((data as Record<string, unknown>).scrapes)) {
    return { version: 1, scrapes: [] };
  }
  const dataObj = data as { version?: number; scrapes: unknown[] };
  return {
    version: dataObj.version ?? 1,
    scrapes: dataObj.scrapes,
  };
}

export function recordScrape(history: { scrapes: unknown[] }, entry: Record<string, unknown>) {
  const scrapes = history.scrapes;
  const timestamp = String(entry.timestamp ?? "");
  const search = String(entry.search ?? "");

  for (let index = 0; index < scrapes.length; index++) {
    const current = scrapes[index];
    if (
      current &&
      typeof current === "object" &&
      (current as Record<string, unknown>).timestamp === timestamp &&
      (current as Record<string, unknown>).search === search
    ) {
      scrapes[index] = entry;
      return history;
    }
  }

  scrapes.push(entry);
  if (scrapes.length > 500) {
    const excess = scrapes.length - 500;
    scrapes.splice(0, excess);
  }
  return history;
}