/**
 * Shared type definitions for LeForem Scraper
 */

/**
 * Core offer data from Forem API
 */
export interface ForemOfferData {
  number: string;
  offer_title: string;
  description: string;
  company: string;
  email: string;
  url: string;
  contract_type: string;
  schedule: string;
  pay: string;
  salary: string;
  location: string;
  published_on: string;
  date_publication: string;
  date_fin_diffusion: string;
  metier: string;
  summary: string;
}

/**
 * Extended offer with metadata for change detection
 */
export interface Offer extends ForemOfferData {
  content_hash: string;
  first_seen_at: string;
  last_seen_at: string;
  last_scraped_at: string;
  modified: boolean;
  modified_at: string | null;
  diff: Record<string, [string, string]>;
  first_seen_at: string;
  last_seen_at: string;
  last_scraped_at: string;
  modified: boolean;
  modified_at: string;
  diff: Record<string, [string, string]>;
  offer_state?: 'new' | 'unchanged' | 'reappeared';
  is_new?: boolean;
  reappeared?: boolean;
}

/**
 * User-specific data (separated from Forem data)
 */
export interface UserData {
  favorite?: boolean;
  status?: string;
  notes?: string;
  tags?: string[];
  priority?: number;
  suivi?: Record<string, unknown>;
}

/**
 * Complete offer with user data
 */
export interface OfferWithUserData extends Offer {
  userData?: UserData;
}

/**
 * Scrape configuration
 */
export interface ScrapeConfig {
  occupation_guid: string;
  location_guid: string;
  base_name?: string;
  label?: string;
  limit?: number;
  refresh?: boolean;
}

/**
 * Scrape history entry
 */
export interface ScrapeEntry {
  timestamp: string;
  search: string;
  label: string;
  nouvelles: number;
  inchangees: number;
  reparues: number;
  supprimees: number;
  total_offres: number;
}

/**
 * Scrape history file structure
 */
export interface ScrapeHistory {
  version: number;
  scrapes: ScrapeEntry[];
}

/**
 * Blacklist entry for failed scrapes
 */
export interface BlacklistEntry {
  first_seen: string;
  last_seen: string;
  attempts: number;
}

export type Blacklist = Record<string, BlacklistEntry>;

/**
 * Offer history entry (deleted offers)
 */
export interface HistoryEntry {
  number: string;
  removed_on: string;
  // ... other fields from original offer
  [key: string]: unknown;
}

/**
 * History file structure
 */
export interface HistoryData {
  version: number;
  updated_timestamp: string;
  offers: HistoryEntry[];
}

/**
 * Detail payload from Forem API
 */
export interface ForemDetailPayload {
  numero: string;
  titreOffre: string;
  descriptionJob: string;
  nomEmployeur: string;
  email: string;
  typeContrat: string;
  benefits: unknown;
  lieuxTravail: unknown;
  datePublication: string;
  dateDebutDiffusion: string;
  dateFinDiffusion: string;
  metier: string;
  secteurActiviteEmployeur: string;
  nomPartenaire: string;
  howToApply: {
    email?: string;
    telephone?: string;
    postalAddress?: { organisation?: string };
    webAddress?: string;
    formattedName?: string;
    fonctionPersonneContact?: string;
  };
  descriptionEmployeur: string;
}

/**
 * Scraped data file structure
 */
export interface ScrapedData {
  version: number;
  scrape_timestamp: string;
  name: string;
  label: string;
  occupation_guid: string;
  location_guid: string;
  offers: Offer[];
  metier_index: Record<string, string[]>;
}

/**
 * Scrapings list entry (for API)
 */
export interface ScrapingListEntry {
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

/**
 * Company/Employer index entry
 */
export interface CompanyEntry {
  name: string;
  offerCount: number;
  deletedCount: number;
  offers: Offer[];
  deletedOffers: Offer[];
  emails: string[];
  phones: string[];
  addresses: string[];
  locations: string[];
  websites: string[];
  contacts: string[];
  sectors: string[];
  partners: string[];
  description: string;
  firstPublished: string;
  lastModified: string;
  edited: string;
}

/**
 * Companies index file structure
 */
export interface CompaniesIndex {
  version: number;
  updated_timestamp: string;
  scrapes: string[];
  stats: {
    employeurs: number;
    avecEmail: number;
    avecTelephone: number;
    avecAdresse: number;
    avecSite: number;
    emails: number;
    offresActives: number;
    offresSupprimees: number;
    observations: number;
    employeursSansNom: number;
    conserves: number;
  };
  employers: Record<string, CompanyEntry>;
}

/**
 * Search result from Forem API
 */
export interface ForemSearchResult {
  numero: string;
  publication: string;
  // ... other fields
}

/**
 * Scraping selector item
 */
export interface ScrapingSelectorItem {
  file: string;
  history: string;
  details: string;
  label: string;
  scrape_timestamp: string;
  occupationGuid: string;
  locationGuid: string;
  offerCount: number;
  name: string;
}

/**
 * Stale alert data
 */
export interface StaleAlertData {
  scrapeDate: string;
  isAll: boolean;
  data: {
    occupation_guid?: string;
    location_guid?: string;
    name?: string;
    label?: string;
  };
}

/**
 * Delete scraping payload
 */
export interface DeleteScrapingPayload {
  name: string;
}

/**
 * Company edit payload
 */
export interface CompanyEditPayload {
  version: number;
  scrapes: string[];
  employers: Record<string, CompanyEntry>;
}

/**
 * API error response
 */
export interface ApiError {
  error: string;
}

/**
 * Generic API response
 */
export interface ApiResponse<T = unknown> {
  ok?: boolean;
  error?: string;
  data?: T;
}

/**
 * HTML element creation helper types
 */
export type HTMLAttributes = Record<string, string>;

export interface ElementCreator {
  (tag: string, className?: string, text?: string | number): HTMLElement;
}

/**
 * Utility type for making all properties optional
 */
export type Partial<T> = {
  [P in keyof T]?: T[P];
};

/**
 * Utility type for making all properties required
 */
export type Required<T> = {
  [P in keyof T]-?: T[P];
}

/**
 * Utility type for picking properties
 */
export type Pick<T, K extends keyof T> = {
  [P in K]: T[P];
};

/**
 * Utility type for omitting properties
 */
export type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;