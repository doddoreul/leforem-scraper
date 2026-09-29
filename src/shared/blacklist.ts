/**
 * Blacklist / Miss Policy for failed scrapes
 */

export interface BlacklistEntry {
  first_seen: string;
  last_seen: string;
  attempts: number;
}

export type Blacklist = Record<string, BlacklistEntry>;

export const MISS_BLACKLIST_AFTER = 2;

export function emptyBlacklist(): Blacklist {
  return {};
}

export function readBlacklistData(data: unknown): Blacklist {
  if (Array.isArray(data)) {
    const result: Blacklist = {};
    for (const number of data) {
      const n = cleanNumber(number);
      if (n) result[n] = { attempts: 3 }; // MISS_BLACKLIST_AFTER + 1
    }
    return result;
  }
  if (data && typeof data === "object") {
    const result: Blacklist = {};
    for (const [number, entry] of Object.entries(data as Record<string, unknown>)) {
      const n = cleanNumber(number);
      if (!n) continue;
      if (typeof entry === "object" && entry !== null) {
        const e = entry as Record<string, unknown>;
        result[cleanNumber(number)] = {
          first_seen: String(e.first_seen ?? ""),
          last_seen: String(e.last_seen ?? ""),
          attempts: Number(e.attempts ?? 0),
        };
      } else {
        result[cleanNumber(number)] = { attempts: 3 }; // MISS_BLACKLIST_AFTER + 1
      }
    }
    return result;
  }
  return {};
}

export function shouldFetch(number: string, blacklist: Record<string, { attempts: number }>, force = false): boolean {
  if (force) return true;
  const entry = blacklist[number];
  if (!entry) return true;
  return (entry.attempts ?? 0) < 2; // MISS_BLACKLIST_AFTER
}

export function noteMiss(blacklist: Record<string, { first_seen: string; last_seen: string; attempts: number }>, number: string, timestamp: string) {
  const entry = blacklist[number] ?? {};
  if (!entry.first_seen) entry.first_seen = timestamp;
  entry.last_seen = timestamp;
  entry.attempts = (entry.attempts ?? 0) + 1;
  blacklist[number] = entry;
}

export function noteRecovery(blacklist: Record<string, unknown>, number: string) {
  delete blacklist[number];
}

function cleanNumber(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}