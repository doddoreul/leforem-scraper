/**
 * Date parsing utilities
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

export function formatDate(value: string | null | undefined): string {
  const iso = parseForemDate(value);
  if (!iso) return value ?? "—";
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export function formatRelative(value: string): string {
  const days = daysBetween(value);
  if (days === null) return value;
  if (days === 0) return "aujourd'hui";
  if (days < 0) return `il y a ${-days} jour${-days > 1 ? "s" : ""}`;
  return `dans ${days} jour${days > 1 ? "s" : ""}`;
}