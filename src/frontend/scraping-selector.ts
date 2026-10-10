/**
 * Scraping Selector - Shared component for index.html & insights.html
 * Converted from scraping-selector.js
 */

const API_SCRAPINGS = "/api/scrapings";
const STORAGE_KEY = "forem_scraping_select";

export interface ScrapingItem {
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

export interface ScrapingSelectorOptions {
  selectId: string;
  allowAll?: boolean;
  allowCreate?: boolean;
  onChange: (key: string, scrapings: ScrapingItem[]) => void;
}

export interface ScrapingSelectorResult {
  select: HTMLSelectElement | null;
  scrapings: ScrapingItem[];
  current: string | null;
}

function escapeAttribute(value: string): string {
  return String(value)
    .replace(/&/g, "&")
    .replace(/"/g, """)
    .replace(/</g, "<");
}

function gearActionMarkup(action: { id: string; label: string; title?: string; type?: string; accept?: string }): string {
  const id = escapeAttribute(action.id);
  const label = escapeAttribute(action.label);
  const title = action.title ? ` title="${escapeAttribute(action.title)}"` : "";
  if (action.type === "file") {
    const accept = action.accept ? ` accept="${escapeAttribute(action.accept)}"` : "";
    return `<input type="file" id="${id}"${accept} hidden>` +
      `<label class="theme-action" for="${id}"${title}>${label}</label>`;
  }
  return `<button type="button" class="theme-action" id="${id}"${title}>${label}</button>`;
}

async function createScrapingSelector(options: ScrapingSelectorOptions): Promise<ScrapingSelectorResult> {
  const { selectId, allowAll = true, allowCreate = true, onChange = () => {} } = options;

  const select = document.getElementById(selectId) as HTMLSelectElement | null;
  if (!select) return { select: null, scrapings: [], current: null };

  const stored = localStorage.getItem(STORAGE_KEY);

  let scrapings: ScrapingItem[] = [];
  try {
    const response = await fetch(API_SCRAPINGS, { cache: "no-store" });
    if (response.ok) scrapings = await response.json();
  } catch (e) {
    console.error("Unable to list scrapings", e);
  }

  select.innerHTML = "";

  if (allowAll) {
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "Toutes les recherches";
    select.appendChild(allOpt);
  }

  scrapings.forEach(item => {
    const option = document.createElement("option");
    option.value = item.file;
    option.dataset.history = item.history;
    option.dataset.base = item.name;
    option.dataset.label = item.label || "";
    option.dataset.occupationGuid = item.occupationGuid || "";
    option.dataset.locationGuid = item.locationGuid || "";
    option.textContent = item.label || item.name || "Recherche principale";
    select.appendChild(option);
  });

  if (allowCreate) {
    const createOpt = document.createElement("option");
    createOpt.value = "__create_new__";
    createOpt.textContent = "Creer un nouveau scrap";
    select.appendChild(createOpt);
  }

  let current = "all";
  if (stored) {
    const found = scrapings.find(s => s.file === stored);
    if (found) {
      select.value = stored;
      current = stored;
    } else if (allowAll) {
      select.value = "all";
    }
  } else if (allowAll) {
    select.value = "all";
  } else if (scrapings.length) {
    select.value = scrapings[0].file;
    current = scrapings[0].file;
  }

  select.addEventListener("change", function () {
    const option = select.selectedOptions[0];
    if (!option || !option.value) return;

    if (option.value === "__create_new__") {
      document.dispatchEvent(new CustomEvent("foremCreateScrape"));
      select.value = current;
      return;
    }

    current = option.value;
    localStorage.setItem(STORAGE_KEY, current);
    onChange(current, scrapings);
  });

  return { select, scrapings, current };
}

function getScrapingByKey(scrapings: any[], key: string) {
  if (key === "all" || key === "__create_new__") return null;
  return scrapings.find((s: any) => s.file === key) || null;
}

function filterScrapings(scrapings: any[], scope: string) {
  if (scope === "all") return scrapings;
  return scrapings.filter((s: any) => s.file === scope);
}

export const ScrapingSelector = {
  createScrapingSelector,
  getScrapingByKey,
  filterScrapings,
  STORAGE_KEY,
};