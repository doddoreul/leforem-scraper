/* ============================================================
   EMPLOYEURS — index des employeurs (companies.json)
   Un employeur par nom exact, contacts cumulés et liens vers ses
   offres. Les coordonnées proviennent des offres : elles peuvent
   appartenir à l'agence de recrutement, pas forcément à l'employeur.

   Le tableau résume chaque employeur (nom, offres, e-mails,
   contacts) et le bouton "Détails" ouvre une modal où tous les champs
   sont modifiables. L'enregistrement est renvoyé au serveur local,
   qui écrit data/companies.json.
   ============================================================ */

import { fetchJson, postJson } from "../shared/api.js";
import { parseForemDate, formatSlashDay } from "../shared/dates.js";
import { el } from "../shared/dom.js";
import { detailHref as offerDetailHref } from "../shared/links.js";
import { normalizeText } from "../shared/text.js";
import { SUIVI_EVENT, TRACKING_GEAR_ACTIONS, showSuiviToast } from "../shared/suivi.js";
import { initTheme } from "../shared/theme.js";
import "../shared/navbar.js";

const COMPANY_DATA_URL = "companies.json";
const COMPANY_SAVE_URL = "companies.json";
const COMPANY_SORT_KEY = "forem_company_sort";
const COMPANY_CONTACT_KEY = "forem_company_contact";

function byName(a, b) {
    return String(a.name).localeCompare(String(b.name), "fr", { sensitivity: "base" });
}

// Colonnes triables du tableau : clé du tri, ordre par défaut et
// comparaison. "action" n'est pas triable (colonne Détails).
const SORT_COLUMNS = [
    { key: "name", label: "Société", defaultDirection: "asc", compare: (a, b) => byName(a, b) },
    {
        key: "offers", label: "Offres", defaultDirection: "desc",
        compare: (a, b) => (b.offerCount || 0) - (a.offerCount || 0) || byName(a, b),
    },
    {
        key: "emails", label: "E-mails", defaultDirection: "desc",
        compare: (a, b) => list(b.emails).length - list(a.emails).length || byName(a, b),
    },
    {
        key: "contacts", label: "Contacts", defaultDirection: "desc",
        compare: (a, b) => contactCount(b) - contactCount(a) || byName(a, b),
    },
    { key: "action", label: "Détails", sortable: false },
];

const CONTACT_FILTERS = {
    "": () => true,
    "email": r => list(r.emails).length > 0,
    "phone": r => list(r.phones).length > 0,
    "address": r => list(r.addresses).length > 0,
    "any": r => contactCount(r) > 0,
    "all": r => list(r.emails).length > 0 &&
        list(r.phones).length > 0 &&
        list(r.addresses).length > 0,
    "active": r => (r.offerCount || 0) > 0,
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

let employers = [];
let meta = { stats: {}, scrapes: [], updated_timestamp: "" };
let sortColumn = "name";
let sortDirection = "asc";
let contactMode = "";
let searchQuery = "";
let draft = null;
let draftKey = "";

// ============================================================
// Helpers
// ============================================================

function list(value) {
    return Array.isArray(value) ? value : [];
}

function contactCount(record) {
    return LIST_FIELDS.slice(0, 3).reduce(
        (total, field) => total + list(record[field]).length, 0
    );
}

function formatAgo(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    const minutes = Math.round((Date.now() - date.getTime()) / 60000);
    if (minutes < 1) return "à l'instant";
    if (minutes < 60) return "il y a " + minutes + " min";
    const hours = Math.round(minutes / 60);
    if (hours < 24) return "il y a " + hours + " h";
    const days = Math.round(hours / 24);
    return days <= 1 ? "hier" : "il y a " + days + " jours";
}

function formatDate(value) {
    if (!value) return "";
    const date = parseForemDate(value);
    return date ? formatSlashDay(date) : String(value);
}

function telHref(value) {
    return "tel:" + String(value).replace(/[^\d+]/g, "");
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function readPref(key, allowed, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (allowed.indexOf(raw) !== -1) return raw;
    } catch (e) {
        // ignore
    }
    return fallback;
}

function storePref(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        // ignore
    }
}

function externalLink(href, text) {
    const link = el("a", "company-contact-value", text);
    link.href = href;
    if (/^https?:/i.test(href)) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
    }
    return link;
}

// ============================================================
// Filtering and sorting
// ============================================================

function matchesQuery(record) {
    if (!searchQuery) return true;
    const haystack = normalizeText([
        record.name,
        record.description,
        list(record.emails).join(" "),
        list(record.phones).join(" "),
        list(record.addresses).join(" "),
        list(record.websites).join(" "),
        list(record.contacts).join(" "),
        list(record.locations).join(" "),
        list(record.sectors).join(" "),
        list(record.partners).join(" "),
        list(record.offers).map(o => (o.title || "") + " " + (o.number || "")).join(" "),
    ].join(" "));
    return haystack.indexOf(searchQuery) !== -1;
}

function sortEmployers(records) {
    const column = SORT_COLUMNS.find(c => c.key === sortColumn && c.sortable !== false);
    if (!column) return records.slice().sort(byName);
    const factor = sortDirection === "desc" ? -1 : 1;
    return records.slice().sort((a, b) => factor * column.compare(a, b));
}

function sortPreference() {
    return sortColumn + ":" + sortDirection;
}

function applySortPreference(value) {
    const parts = String(value || "").split(":");
    const column = SORT_COLUMNS.find(c => c.key === parts[0] && c.sortable !== false);
    if (!column) return false;
    sortColumn = column.key;
    const fallback = column.defaultDirection || "asc";
    sortDirection = parts[1] === "asc" || parts[1] === "desc" ? parts[1] : fallback;
    return true;
}

function toggleSort(key) {
    const column = SORT_COLUMNS.find(c => c.key === key && c.sortable !== false);
    if (!column) return;
    if (sortColumn === key) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
    } else {
        sortColumn = key;
        sortDirection = column.defaultDirection || "asc";
    }
    storePref(COMPANY_SORT_KEY, sortPreference());
    render();
}

function visibleEmployers() {
    const filter = CONTACT_FILTERS[contactMode] || CONTACT_FILTERS[""];
    return sortEmployers(employers.filter(r => filter(r) && matchesQuery(r)));
}

// ============================================================
// Table
// ============================================================

function buildSortableHeaders() {
    const head = document.querySelector("#companiesTable thead tr");
    if (!head) return;
    head.innerHTML = "";
    SORT_COLUMNS.forEach(function (column) {
        const cell = el("th", "company-sortable");
        if (column.sortable === false) {
            cell.textContent = column.label;
            head.appendChild(cell);
            return;
        }
        cell.setAttribute("data-sort", column.key);
        cell.setAttribute("scope", "col");
        cell.textContent = column.label;
        if (sortColumn === column.key) {
            cell.classList.add(sortDirection === "asc" ? "sort-asc" : "sort-desc");
        }
        cell.addEventListener("click", function () {
            toggleSort(column.key);
        });
        head.appendChild(cell);
    });
}

function render() {
    const shown = visibleEmployers();
    document.getElementById("companiesEmpty").classList.toggle("hidden", shown.length > 0);
    document.getElementById("companiesTable").classList.toggle("hidden", !shown.length);
    buildSortableHeaders();
    renderTable(shown);
    renderNote(shown.length);
}

function renderKpis() {
    const root = document.getElementById("kpiRow");
    const stats = meta.stats || {};
    const items = [
        ["Employeurs", stats.employeurs || 0, "cyan"],
        ["Avec email", stats.avecEmail || 0, "green"],
        ["Avec téléphone", stats.avecTelephone || 0, "yellow"],
        ["Avec adresse", stats.avecAdresse || 0, "magenta"],
        ["Offres actives", stats.offresActives || 0, "cyan"],
        ["Emails trouvés", stats.emails || 0, "green"],
        ["Index mis à jour", formatAgo(meta.updated_timestamp), "magenta"],
    ];
    root.innerHTML = "";
    items.forEach(item => {
        const card = el("div", "dash-kpi kpi-" + item[2]);
        card.appendChild(el("span", "dash-kpi-label", item[0]));
        if (typeof item[1] === "number") {
            card.appendChild(el("strong", "dash-kpi-value", String(item[1])));
        } else {
            card.appendChild(el("span", "dash-kpi-text", item[1]));
        }
        root.appendChild(card);
    });
}

function countCell(values) {
    const cell = el("td", "company-count");
    const count = list(values).length;
    if (!count) {
        cell.appendChild(el("span", "company-count-none", "—"));
        return cell;
    }
    cell.appendChild(el("strong", "", String(count)));
    return cell;
}

function nameCell(record) {
    const cell = el("td", "company-name-cell");
    const name = el("span", "company-name", record.name);
    cell.appendChild(name);
    if (record.edited) {
        const chip = el("span", "chip chip-info", "modifié");
        chip.title = "Corrigé à la main le " + formatDate(String(record.edited).slice(0, 10));
        cell.appendChild(chip);
    }
    return cell;
}

function detailsButton(record) {
    const cell = el("td", "company-action-cell");
    const button = el("button", "btn btn-outline", "Détails");
    button.type = "button";
    button.addEventListener("click", function () {
        openModal(record.name);
    });
    cell.appendChild(button);
    return cell;
}

function renderTable(records) {
    const body = document.getElementById("companyRows");
    body.innerHTML = "";
    records.forEach(record => {
        const row = el("tr");
        row.appendChild(nameCell(record));

        const offers = el("td", "company-count");
        offers.appendChild(el("strong", "", String(record.offerCount || 0)));
        if (record.deletedCount) {
            offers.appendChild(el("span", "company-count-sub",
                " (+" + record.deletedCount + " suppr.)"));
        }
        row.appendChild(offers);

        row.appendChild(countCell(record.emails));
        row.appendChild(countCell(record.contacts));
        row.appendChild(detailsButton(record));
        body.appendChild(row);
    });
}

function renderNote(shown) {
    const stats = meta.stats || {};
    const scrapes = list(meta.scrapes).map(s => s || "recherche principale");
    const parts = [];
    if (scrapes.length) {
        parts.push(scrapes.length + " recherche(s) : " + scrapes.join(", "));
    }
    parts.push((stats.observations || 0) + " offres observées (" +
        (stats.offresActives || 0) + " actives, " +
        (stats.offresSupprimees || 0) + " supprimées)");
    if (meta.updated_timestamp) {
        parts.push("index du " + formatDate(meta.updated_timestamp.slice(0, 10)));
    }
    const note = document.getElementById("companiesNote");
    note.classList.toggle("hidden", !employers.length);
    if (employers.length) {
        note.textContent = shown + " employeur(s) affiché(s) — " + parts.join(" · ");
    }
}

// ============================================================
// Modal — édition d'un employeur
// ============================================================

function buildModal() {
    const modal = el("div", "modal");
    modal.id = "companyModal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "companyModalTitle");

    const backdrop = el("div", "modal-backdrop");
    backdrop.addEventListener("click", closeModal);
    modal.appendChild(backdrop);

    const box = el("div", "modal-box company-modal-box");
    const header = el("div", "modal-header");
    const title = el("h2", "", "Détails de l'employeur");
    title.id = "companyModalTitle";
    header.appendChild(title);
    const close = el("button", "modal-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Fermer");
    close.addEventListener("click", closeModal);
    header.appendChild(close);
    box.appendChild(header);

    const body = el("div", "company-modal-body");
    body.id = "companyModalBody";
    box.appendChild(body);

    const footer = el("div", "modal-footer");
    const status = el("span", "company-modal-status");
    status.id = "companyModalStatus";
    footer.appendChild(status);
    const cancel = el("button", "btn btn-secondary", "Annuler");
    cancel.type = "button";
    cancel.addEventListener("click", closeModal);
    footer.appendChild(cancel);
    const save = el("button", "btn btn-primary", "Enregistrer");
    save.type = "button";
    save.addEventListener("click", saveModal);
    footer.appendChild(save);
    box.appendChild(footer);

    modal.appendChild(box);
    document.body.appendChild(modal);
    modal.addEventListener("keydown", function (event) {
        if (event.key === "Escape") closeModal();
    });
}

function field(label, node) {
    const wrapper = el("label", "field");
    wrapper.appendChild(el("span", "field-label", label));
    wrapper.appendChild(node);
    return wrapper;
}

function textInput(value, onInput, placeholder) {
    const input = el("input", "company-input");
    input.type = "text";
    input.value = value || "";
    if (placeholder) input.placeholder = placeholder;
    input.addEventListener("input", function () {
        onInput(this.value);
    });
    return input;
}

function removeButton(onClick) {
    const button = el("button", "company-row-remove", "×");
    button.type = "button";
    button.title = "Supprimer cette ligne";
    button.addEventListener("click", onClick);
    return button;
}

function listGroup(group) {
    const wrapper = el("div", "company-group");
    const head = el("div", "company-group-head");
    const values = list(draft[group.field]);
    head.appendChild(el("h3", "company-group-title",
        group.label + " (" + values.length + ")"));
    if (group.copy && values.length) {
        const copy = el("button", "company-link-button", "Copier");
        copy.type = "button";
        copy.addEventListener("click", function () {
            copyText(values.join(", "), group.label + " copié(s) : " + values.join(", "));
        });
        head.appendChild(copy);
    }
    wrapper.appendChild(head);

    const rows = el("div", "company-rows");
    values.forEach((value, index) => {
        const row = el("div", "company-row");
        row.appendChild(textInput(value, function (newValue) {
            draft[group.field][index] = newValue;
        }, group.placeholder));
        row.appendChild(removeButton(function () {
            draft[group.field].splice(index, 1);
            rerenderModalBody();
        }));
        rows.appendChild(row);
    });
    wrapper.appendChild(rows);

    const add = el("button", "company-link-button", "+ Ajouter");
    add.type = "button";
    add.addEventListener("click", function () {
        draft[group.field].push("");
        rerenderModalBody();
    });
    wrapper.appendChild(add);
    return wrapper;
}

function offerList(field, label, linked) {
    const wrapper = el("div", "company-group");
    const entries = list(draft[field]);
    wrapper.appendChild(el("h3", "company-group-title", label + " (" + entries.length + ")"));

    if (!entries.length) {
        wrapper.appendChild(el("p", "company-empty", "Aucune offre."));
        return wrapper;
    }

    const rows = el("div", "company-offer-rows");
    entries.forEach(function (entry) {
        const row = el("div", "company-offer company-offer-readonly");
        row.appendChild(el("span", "company-offer-title",
            entry.title || (entry.number ? "Offre #" + entry.number : "Offre sans titre")));
        row.appendChild(el("span", "company-offer-location", entry.location || ""));
        if (linked && entry.number) {
            const link = el("a", "company-offer-button", "Détails");
            link.href = offerDetailHref(entry.number, entry.base);
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            row.appendChild(link);
        }
        rows.appendChild(row);
    });
    wrapper.appendChild(rows);
    return wrapper;
}

function rerenderModalBody() {
    const body = document.getElementById("companyModalBody");
    body.innerHTML = "";
    buildModalBody(body);
}

function buildModalBody(body) {
    const nameInput = el("input", "company-input");
    nameInput.type = "text";
    nameInput.value = draft.name || "";
    nameInput.addEventListener("input", function () {
        draft.name = this.value;
    });
    body.appendChild(field("Nom de la société", nameInput));

    const counts = el("p", "company-modal-hint",
        "Offres actives : " + list(draft.offers).length +
        " — supprimées : " + list(draft.deletedOffers).length +
        " (listes générées par le scraping, non modifiables ici).");
    body.appendChild(counts);

    LIST_GROUPS.forEach(function (group) {
        if (!Array.isArray(draft[group.field])) draft[group.field] = [];
        body.appendChild(listGroup(group));
    });

    body.appendChild(offerList("offers", "Offres liées", true));
    body.appendChild(offerList("deletedOffers", "Offres supprimées", false));
}

function copyText(text, message) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
            () => showSuiviToast(message),
            () => showSuiviToast("Copie impossible : " + text)
        );
    } else {
        showSuiviToast("Copie non supportée : " + text);
    }
}

function openModal(name) {
    const record = employers.find(r => r.name === name);
    if (!record) return;
    draft = clone(record);
    draftKey = record.name;
    LIST_FIELDS.forEach(function (field) {
        draft[field] = list(draft[field]);
    });
    draft.offers = list(draft.offers);
    draft.deletedOffers = list(draft.deletedOffers);
    document.getElementById("companyModalTitle").textContent = name;
    document.getElementById("companyModalStatus").textContent = "";
    rerenderModalBody();
    document.getElementById("companyModal").classList.add("visible");
    const first = document.querySelector("#companyModalBody input");
    if (first) first.focus();
}

function closeModal() {
    document.getElementById("companyModal").classList.remove("visible");
    draft = null;
    draftKey = "";
}

function cleanValues(values) {
    return list(values)
        .map(value => String(value).trim())
        .filter(value => value !== "");
}

function buildSavedIndex() {
    // Offres, secteurs, partenaires, description et dates ne sont pas
    // éditables dans la modal : les valeurs chargées sont renvoyées
    // telles quelles.
    const offers = list(draft.offers).map(clone);
    const deleted = list(draft.deletedOffers).map(clone);

    const record = {
        name: String(draft.name || "").trim(),
        offerCount: offers.length,
        deletedCount: deleted.length,
        offers: offers,
        deletedOffers: deleted,
        emails: cleanValues(draft.emails),
        phones: cleanValues(draft.phones),
        addresses: cleanValues(draft.addresses),
        locations: cleanValues(draft.locations),
        websites: cleanValues(draft.websites),
        contacts: cleanValues(draft.contacts),
        sectors: list(draft.sectors),
        partners: list(draft.partners),
        description: String(draft.description || ""),
        firstPublished: String(draft.firstPublished || ""),
        lastModified: String(draft.lastModified || ""),
        edited: new Date().toISOString(),
    };

    // A rename must not silently overwrite another employer.
    if (record.name !== draftKey &&
        Object.prototype.hasOwnProperty.call(meta.employers, record.name)) {
        return { error: "Un autre employeur porte déjà le nom « " +
            record.name + " »." };
    }

    const index = {
        version: meta.version || 1,
        scrapes: list(meta.scrapes),
        employers: {},
    };
    Object.keys(meta.employers).forEach(function (key) {
        if (key === draftKey) return;
        index.employers[key] = meta.employers[key];
    });
    index.employers[record.name] = record;
    return { index: index, name: record.name };
}

async function saveModal() {
    const status = document.getElementById("companyModalStatus");
    const built = buildSavedIndex();
    if (built.error) {
        status.textContent = built.error;
        return;
    }
    if (!built.name) {
        status.textContent = "Le nom ne peut pas être vide.";
        return;
    }
    status.textContent = "Enregistrement…";
    try {
        const answer = await postJson(COMPANY_SAVE_URL, built.index);
        if (!answer.ok) {
            const detail = answer.data || {};
            throw new Error(detail.error || ("HTTP " + answer.status));
        }
        const savedName = built.name;
        closeModal();
        await load();
        const record = employers.find(r => r.name === savedName);
        showSuiviToast(record
            ? "Employeur enregistré (" + list(record.emails).length +
              " e-mail(s))."
            : "Employeur enregistré.");
    } catch (error) {
        console.error("Unable to save companies.json", error);
        status.textContent = "Erreur : " + error.message;
    }
}

// ============================================================
// Data loading
// ============================================================

function applyData(payload) {
    const source = payload && typeof payload === "object" ? payload : {};
    const map = source.employers && typeof source.employers === "object"
        ? source.employers
        : {};
    meta.employers = map;
    employers = Object.keys(map).map(key => {
        const record = Object.assign({}, map[key]);
        if (!record.name) record.name = key;
        return record;
    }).filter(record => record.name);
    meta = {
        version: source.version || 1,
        stats: source.stats || {},
        scrapes: list(source.scrapes),
        updated_timestamp: source.updated_timestamp || "",
        employers: map,
    };
}

async function load() {
    try {
        applyData(await fetchJson(COMPANY_DATA_URL));
    } catch (error) {
        console.error("Unable to load companies.json", error);
        applyData(null);
    }
    renderKpis();
    render();
}

function setupControls() {
    const search = document.getElementById("companySearch");
    search.addEventListener("input", function () {
        searchQuery = normalizeText(this.value).trim();
        render();
    });

    const contact = document.getElementById("companyContact");
    contactMode = readPref(COMPANY_CONTACT_KEY, Object.keys(CONTACT_FILTERS), "");
    contact.value = contactMode;
    contact.addEventListener("change", function () {
        contactMode = this.value;
        storePref(COMPANY_CONTACT_KEY, contactMode);
        render();
    });

    if (!applySortPreference(readPref(COMPANY_SORT_KEY, null, "name:asc"))) {
        sortColumn = "name";
        sortDirection = "asc";
    }
}

document.addEventListener(SUIVI_EVENT, load);

initTheme(TRACKING_GEAR_ACTIONS);
buildModal();
setupControls();
load();
