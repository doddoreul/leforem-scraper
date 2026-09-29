/**
 * Salary analysis utilities
 */

const HOURLY_HINT_PATTERN = /\/\s*h\b|(?:^|\s)l[''´`]?\s*heure|par\s+heure|horaire/i;
const AMOUNT_PATTERN = /\d{1,3}(?:[.,]\d{1,2})?/;

export function hasSalary(offer: Record<string, unknown>): boolean {
  const text = String(offer.salary ?? offer.pay ?? "").toLowerCase();
  return text.length > 0;
}

export function extractHourlyValues(text: string): number[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  if (!/h\b|heure|horaire/.test(lower)) return [];

  const amounts: number[] = [];
  for (const match of text.matchAll(/(\d{1,3}(?:[.,]\d{1,2})?)/g)) {
    const raw = match[1].replace(",", ".");
    const value = parseFloat(raw);
    if (!isNaN(value) && value > 0 && value <= 200) {
      amounts.push(value);
    }
  }
  return [...new Set(amounts)].sort((a, b) => a - b);
}

export interface SalaryAnalysis {
  renseignées: number;
  total: number;
  hourly: number[];
}

export function analyzeSalaries(offers: Record<string, unknown>[]): {
  renseignées: number;
  total: number;
  hourly: number[];
} {
  let total = 0;
  let renseignées = 0;
  const hourly: number[] = [];

  for (const offer of offers) {
    if (!offer || typeof offer !== "object") continue;
    total++;
    if (hasSalary(offer)) renseignées++;
    const text = String(offer.salary ?? offer.pay ?? "");
    const hourly = extractHourlyValues(text);
    hourly.push(...hourly);
  }

  return {
    renseignées,
    total,
    hourly: [...new Set(hourly)].sort((a, b) => a - b),
  };
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[mid]
    : (ordered[mid - 1] + ordered[mid]) / 2;
}