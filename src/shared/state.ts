/**
 * State classification for offers
 */

import { Offer } from "./types";

export type OfferState = "new" | "unchanged" | "reappeared" | "deleted";

export interface StateClassification {
  new: string[];
  unchanged: string[];
  reappeared: string[];
  deleted: string[];
}

export interface StateResult {
  states: StateClassification;
  currentNumbers: Set<string>;
}

/**
 * Classify a current offer: new / unchanged / reappeared
 */
export function offerStateFor(
  number: string,
  previousNumbers: Set<string>,
  deletedNumbers: Set<string>
): "new" | "unchanged" | "reappeared" {
  if (previousNumbers.has(number)) return "unchanged";
  if (deletedNumbers.has(number)) return "reappeared";
  return "new";
}

/**
 * Compute the full state picture of one scrape
 */
export function collectStates(
  previousOffers: Record<string, unknown>[],
  currentOffers: Record<string, unknown>[],
  deletedNumbers: Set<string>
): StateResult {
  const previous = new Map<string, Record<string, unknown>>();
  for (const offer of previousOffers) {
    const number = cleanNumber(offer?.number);
    if (number) previous.set(number, offer);
  }
  const previousNumbers = new Set(previous.keys());
  const currentNumbers = new Set<string>();

  const states = {
    new: [] as string[],
    unchanged: [] as string[],
    reappeared: [] as string[],
    deleted: [] as string[],
  };

  for (const offer of currentOffers) {
    if (!offer || typeof offer !== "object") continue;
    const number = cleanNumber((offer as Record<string, unknown>).number);
    if (!number || currentNumbers.has(number)) continue;
    currentNumbers.add(number);
    const state = offerStateFor(number, new Set(previous.keys()), new Set());
    (states as Record<string, string[]>)[state].push(number);
  }

  for (const number of [...previous.keys()].sort()) {
    if (!currentNumbers.has(number)) {
      states.deleted.push(number);
    }
  }

  return { states, currentNumbers };
}

export function cleanNumber(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function summarizeScrape(states: { new: string[]; unchanged: string[]; reappeared: string[]; deleted: string[] }, total?: number) {
  return {
    nouvelles: states.new.length,
    inchangées: states.unchanged.length,
    reparues: states.reappeared.length,
    supprimées: states.deleted.length,
    total_offres: total ?? (states.new.length + states.unchanged.length + states.reappeared.length),
  };
}