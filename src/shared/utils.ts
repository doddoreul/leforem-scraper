/**
 * Shared utility functions for LeForem Scraper
 */

import { Offer } from "./types";

/**
 * Clean and normalize text for comparisons
 */
export function normText(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Clean number string
 */
export function cleanNumber(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Normalize text for hashing
 */
export function normalizeForHash(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (typeof value === "object") {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).sort()) {
      obj[k] = normalizeForHash(v);
    }
    return obj;
  }
  if (typeof value === "string") return value.trim().replace(/\s+/g, " ");
  return value;
}

/**
 * Parse Forem date formats into YYYY-MM-DD
 */
export function parseForemDate(value: string | null | undefined): string {
  if (!value) return "";
  const text = String(value).trim();

  // DD/MM/YYYY
  let match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // DD-MM-YY
  match = text.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (match) {
    const [, day, month, year] = match;
    return `20${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // ISO timestamp
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const [, year, month, day] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  return "";
}

/**
 * Days between date and today
 */
export function daysBetween(value: string): number | null {
  const iso = parseForemDate(value);
  if (!iso) return null;
  try {
    const target = new Date(iso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = target.getTime() - today.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

/**
 * Check if offer is recent (within maxAgeDays)
 */
export function isOfferRecent(offer: { published_on?: string }, maxAgeDays = 365): boolean {
  const published = offer.published_on;
  if (!published) return true;
  const days = daysBetween(published);
  if (days === null) return true;
  return days >= -maxAgeDays;
}

/**
 * Filter offers to recent ones
 */
export function filterRecentOffers<T extends { published_on?: string }>(
  offers: T[],
  maxAgeDays = 365
): T[] {
  return offers.filter((o) => isOfferRecent(o, maxAgeDays));
}

/**
 * Get current ISO timestamp
 */
export function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Generate content hash for offer
 */
export async function computeContentHash(offer: Record<string, unknown>): Promise<string> {
  const hashFields = [
    "number",
    "offer_title",
    "description",
    "company",
    "email",
    "url",
    "contract_type",
    "schedule",
    "pay",
    "salary",
    "location",
    "published_on",
    "date_publication",
    "date_fin_diffusion",
    "metier",
    "summary",
  ];

  const normalized: Record<string, unknown> = {};
  for (const field of hashFields) {
    const value = (offer as Record<string, unknown>)[field];
    normalized[field] = normalizeForHash(offer[field] ?? "");
  }

  const jsonStr = JSON.stringify(normalized, Object.keys(normalized).sort(), "");
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonStr);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute diff between two offers
 */
export function computeDiff(
  oldOffer: Record<string, unknown>,
  newOffer: Record<string, unknown>
): Record<string, [string, string]> {
  const compareFields = [
    "number",
    "offer_title",
    "description",
    "company",
    "email",
    "url",
    "contract_type",
    "schedule",
    "pay",
    "salary",
    "location",
    "published_on",
    "date_publication",
    "date_fin_diffusion",
    "metier",
    "summary",
  ];

  const diff: Record<string, [string, string]> = {};
  for (const field of compareFields) {
    const oldVal = String(oldOffer[field] ?? "");
    const newVal = String(newOffer[field] ?? "");
    if (normalizeForHash(oldOffer[field] ?? "") !== normalizeForHash(newOffer[field] ?? "")) {
      diff[field] = [String(oldOffer[field] ?? ""), String(newOffer[field] ?? "")];
    }
  }
  return diff;
}

/**
 * Check if offer is recent (within maxAgeDays)
 */
export function filterRecentOffers<T extends { published_on?: string }>(
  offers: T[],
  maxAgeDays = 365
): T[] {
  return offers.filter((o) => {
    const published = (o as Record<string, unknown>).published_on;
    if (!published) return true;
    const days = daysBetween(String(published));
    if (days === null) return true;
    return days >= -365;
  });
}

/**
 * Get current ISO timestamp
 */
export function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Days between date and today
 */
export function daysBetween(value: string): number | null {
  const iso = parseForemDate(value);
  if (!iso) return null;
  try {
    const target = new Date(iso);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = target.getTime() - today.getTime();
    return Math.round(diff / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}