/**
 * Scraper module types and configuration
 */

export interface ScraperConfig {
  occupationGuid: string;
  locationGuid: string;
  baseName?: string;
  label?: string;
  limit?: number;
  refresh: boolean;
}

export interface ScraperFiles {
  dataFile: string;
  historyFile: string;
  detailsFile: string;
}

export const SCRAPER_CONSTANTS = {
  SEARCH_URL_BASE: "https://www.leforem.be/recherche-offres/api/Recherches/Search",
  DETAIL_URL: "https://www.leforem.be/recherche-offres/api/Diffusion/DetailOffre/{}",
  ROW: 50,
  MAX_WORKERS: 4,
  REQUEST_INTERVAL: 0.35,
  JITTER: 0.1,
  MAX_ATTEMPTS: 3,
  RETRY_BACKOFF: 2.0,
  DATA_DIR: "data",
  VERSION: 1,
};

export interface ScrapeHeaders {
  "User-Agent": string;
  Accept: string;
  "Accept-Language": string;
  "Content-Type": string;
  Origin: string;
  Referer: string;
}

export const DEFAULT_HEADERS: ScrapeHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "fr-BE,fr;q=0.9,en;q=0.8",
  "Content-Type": "application/json",
  Origin: "https://www.leforem.be",
  Referer: "https://www.leforem.be/recherche-offres/resultat-recherche",
};