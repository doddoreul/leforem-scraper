/**
 * Job/Métier indexing utilities
 */

import { Offer } from "./types";

export function extractMetiers(offers: Record<string, unknown>[]): string[] {
  const metiers = new Set<string>();
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    const metier = String(offer.metier ?? "").trim();
    if (metier) metiers.add(metier);
  }
  return Array.from(metiers).sort();
}

export interface MetierIndex {
  [metier: string]: string[];
}

export function buildMetierIndex(offers: Record<string, unknown>[]): Record<string, string[]> {
  const index: Record<string, string[]> = {};
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    const number = String(offer.number ?? "").trim();
    if (!number) continue;
    const metier = String(offer.metier ?? "").trim();
    if (!metier) continue;
    if (!index[metier]) index[metier] = [];
    index[metier].push(number);
  }
  return index;
}

export function getOffersByMetier(offers: Record<string, unknown>[], metier: string): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    if (String(offer.metier ?? "").trim() === metier) {
      result.push(offer);
    }
  }
  return result;
}