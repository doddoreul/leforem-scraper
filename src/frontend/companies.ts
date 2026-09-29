/**
 * Companies page - Employer index and management
 * Converted from companies.js
 */

import { 
  parseForemDate, 
  formatDate, 
  cleanNumber,
  nowIsoTimestamp
} from "../shared";

const COMPANY_DATA_URL = "companies.json";
const COMPANY_SAVE_URL = "companies.json";
const COMPANY_SORT_KEY = "forem_company_sort";
const COMPANY_CONTACT_KEY = "forem_company_contact";

const CONTACT_FILTERS: Record<string, (r: any) => boolean> = {
  "": () => true,
  "email": r => (r.emails?.length ?? 0) > 0,
  "phone": r => (r.phones?.length ?? 0) > 0,
  "address": r => (r.addresses?.length ?? 0) > 0,
  "any": r => (r.emails?.length ?? 0) > 0 || (r.phones?.length ?? 0) > 0 || (r.addresses?.length ?? 0) > 0,
  "all": r => (r.emails?.length ?? 0) > 0 && (r.phones?.length ?? 0) > 0 && (r.addresses?.length ?? 0) > 0,
  "active": r => (r.offerCount ?? 0) > 0,
};

const LIST_GROUPS = [
  { field: "emails", label: "E-mails", placeholder: "contact@societe.be", copy: true },
  { field: "phones", label: "Téléphones", placeholder: "04 123 45 67" },
  { field: "addresses", label: "Adresses", placeholder: "Rue du Nom 1, 4000 Liege" },
  { field: "websites", label: "Sites", placeholder: "https://societe.be" },
  { field: "contacts", label: "Personnes de contact", placeholder: "Laura Mahy (Coordinateur)" },
  { field: "locations", label: "Lieux de travail", placeholder: "HERSTAL" },
];

const LIST_FIELDS = LIST_GROUPS.map(g => g.field);

interface CompanyRecord {
  name: string;
  offerCount: number;
  deletedCount: number;
  offers: any[];
  deletedOffers: any[];
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

interface Meta {
  version: number;
  scrapes: string[];
  updated_timestamp: string;
  stats: any;
  employers: Record<string, any>;
}

let employers: any[] = [];
let meta: Meta = { stats: {}, scrapes: [], updated_timestamp: "" };
let sortColumn = "name";
let sortDirection = "asc";
let contactMode = "";
let searchQuery = "";
let draft: any = null;
let draftKey = "";

// ... This is a partial conversion. The full companies.js is large.
// The structure mirrors the original companies.js with TypeScript types.

export {};