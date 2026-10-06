// ============================================================
// CONFIGURATION
// ============================================================

import {
    API_DELETE_SCRAPING,
    fetchJson,
    fetchScrapings,
    postJson,
} from "../shared/api.js";
import { formatDateTime } from "../shared/dates.js";
import { detailHref } from "../shared/links.js";
import { ScraperUi } from "../shared/scraper-ui.js";
import {
    STORAGE_KEY,
    createScrapingSelector,
    refreshScrapingSelector,
} from "../shared/scraping-selector.js";
import {
    STATUS_OPTIONS as CANONICAL_STATUS_OPTIONS,
    priorityLabel,
    statusRank,
    // Aliased: a local element variable already uses the plain name.
    statusLabel as statusText,
} from "../shared/statuses.js";
import {
    TRACKED_SUFFIXES,
    migrateLegacyStorage,
    readTrackedMap,
    storagePrefixFor,
    writeTrackedMap,
} from "../shared/storage.js";
import { htmlToText } from "../shared/html.js";
import { highlightIn, loadKeywords } from "../shared/highlight.js";
import {
    SUIVI_EVENT,
    TRACKING_GEAR_ACTIONS,
    setupSuiviActions,
    showSuiviToast,
} from "../shared/suivi.js";
import { initTheme } from "../shared/theme.js";
import { normalizeText } from "../shared/text.js";
import "../shared/navbar.js";

// Actions shown in the theme gear dropdown.
const GEAR_ACTIONS = [
    { id: "exportCsvBtn", label: "Exporter CSV", title: "Exporter les annonces visibles en CSV" },
    ...TRACKING_GEAR_ACTIONS,
    { id: "deleteScrapingGearBtn", label: "Supprimer ce scraping", title: "Supprimer le scraping actuellement sélectionné (déplace les fichiers vers data/trash/)" }
];

// Base URLs for the active scraping; populated by setupScrapingSelector()
let dataUrl = "";
let historyUrl = "";

let storagePrefix = storagePrefixFor("");
let activeBaseName = "";
let activeScrapings = [];

function setActiveScraping(baseName) {
    storagePrefix = storagePrefixFor(baseName);
    activeBaseName = baseName || "";
}

// The offers table shows an em dash for untrielled offers, where the offer
// sheet and the dashboard spell out "Non trié".
const STATUS_OPTIONS = CANONICAL_STATUS_OPTIONS.map(option =>
    option.value === "" ? { value: "", label: "—" } : option
);

// Run migration immediately so it's done before any UI uses the keys.
migrateLegacyStorage();

initTheme(GEAR_ACTIONS);

// The profile keywords drive the highlighting. Each rendered row asks for it,
// and the shared module replays the pass if the keywords land after the draw.
loadKeywords();



// ============================================================
// LOCAL STORAGE — the follow-up of the selected search: statuses,
// status dates, remarks, favourites and personal priorities. The
// keys are read and written by js/shared/storage.js.
// ============================================================

let statuses = readTrackedMap(storagePrefix, "statuts");
let statutDates = readTrackedMap(storagePrefix, "statut_dates");
let remarks = readTrackedMap(storagePrefix, "remarques");
let favorites = readTrackedMap(storagePrefix, "favoris");
let priorities = readTrackedMap(storagePrefix, "priorites");

/**
 * Drop the offers that are gone from the table, so the storage does not
 * grow forever.
 * @param {Object} map the in-memory map
 * @param {string} suffix its storage key
 * @param {Set<string>} keepNumbers the numbers still on offer
 */
function cleanTrackedMap(map, suffix, keepNumbers) {
    let changed = false;
    Object.keys(map).forEach(number => {
        if (!keepNumbers.has(number)) {
            delete map[number];
            changed = true;
        }
    });
    if (changed) {
        writeTrackedMap(storagePrefix, suffix, map);
    }
}

function getStatus(number) {
    return statuses[number] || "";
}

function setStatus(number, value) {
    if (value) {
        statuses[number] = value;
        statutDates[number] = new Date().toISOString();
    } else {
        delete statuses[number];
        delete statutDates[number];
    }
    writeTrackedMap(storagePrefix, "statuts", statuses);
    writeTrackedMap(storagePrefix, "statut_dates", statutDates);
    refreshFollowUps();
    renderTrackedAlerts();
}

function getStatutDate(number) {
    return statutDates[number] || "";
}

function setStatutDate(number, value) {
    if (value) {
        statutDates[number] = value;
    } else {
        delete statutDates[number];
    }
    writeTrackedMap(storagePrefix, "statut_dates", statutDates);
}

// First visit after this feature: treat existing statuses as fresh
// so no flood of reminders for statuses set before tracking began.
function backfillStatutDates() {
    let changed = false;
    const now = new Date().toISOString();
    Object.keys(statuses).forEach(number => {
        if (statuses[number] && !statutDates[number]) {
            statutDates[number] = now;
            changed = true;
        }
    });
    if (changed) {
        writeTrackedMap(storagePrefix, "statut_dates", statutDates);
    }
}

function getRemark(number) {
    return remarks[number] || "";
}

function setRemark(number, value) {
    if (value) {
        remarks[number] = value;
    } else {
        delete remarks[number];
    }
    writeTrackedMap(storagePrefix, "remarques", remarks);
}

function isFavorite(number) {
    return favorites[number] === true;
}

function setFavorite(number, active) {
    if (active) {
        favorites[number] = true;
    } else {
        delete favorites[number];
    }
    writeTrackedMap(storagePrefix, "favoris", favorites);
}

function getPriority(number) {
    return priorities[String(number)] || "";
}

function setPriority(number, value) {
    if (value) {
        priorities[String(number)] = value;
    } else {
        delete priorities[String(number)];
    }
    writeTrackedMap(storagePrefix, "priorites", priorities);
}

// Re-reads the in-memory maps from localStorage. Needed when the
// active scraping changes, after an import, or when another tab
// (detail.html) wrote one of the shared keys.
function reloadStorageMaps() {
    statuses = readTrackedMap(storagePrefix, "statuts");
    remarks = readTrackedMap(storagePrefix, "remarques");
    favorites = readTrackedMap(storagePrefix, "favoris");
    statutDates = readTrackedMap(storagePrefix, "statut_dates");
    priorities = readTrackedMap(storagePrefix, "priorites");
}


// detail.html writes the same keys from its own tab. The `storage`
// event only reaches the other tabs, so it is the only way to see
// those changes without reloading the page.
// ============================================================

let storageSyncTimer = null;

function isSyncedStorageKey(key) {
    return TRACKED_SUFFIXES.some(function (suffix) {
        return key === storagePrefix + suffix;
    });
}

function syncFromOtherTab() {
    const tbody = document.getElementById("currentRows");
    const focused = document.activeElement;
    const editingRemark = focused && focused.tagName === "TEXTAREA"
        && tbody && tbody.contains(focused);
    const editing = editingRemark
        ? { number: focused.dataset.number, start: focused.selectionStart, end: focused.selectionEnd }
        : null;

    reloadStorageMaps();
    rerenderTables();

    if (!editing || !editing.number || !tbody) return;
    const restored = tbody.querySelector('textarea[data-number="' + editing.number + '"]');
    if (!restored) return;
    restored.style.height = "auto";
    restored.style.height = restored.scrollHeight + "px";
    restored.focus();
    try {
        restored.setSelectionRange(editing.start, editing.end);
    } catch (e) {
        // Some browsers refuse a selection range on a hidden element.
    }
}

function scheduleStorageSync() {
    if (storageSyncTimer) clearTimeout(storageSyncTimer);
    // detail.html writes the status and its date one after the other.
    storageSyncTimer = setTimeout(function () {
        storageSyncTimer = null;
        syncFromOtherTab();
    }, 120);
}

function setupStorageSync() {
    window.addEventListener("storage", function (event) {
        if (event.key === null || isSyncedStorageKey(event.key)) {
            scheduleStorageSync();
        }
    });
    window.addEventListener("focus", scheduleStorageSync);
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) scheduleStorageSync();
    });
}


// ============================================================
// RENDERING
// ============================================================

function createStatusSelect(number) {
    const select = document.createElement("select");
    select.className = "status-select";
    select.dataset.number = number;
    select.title = "Statut de la candidature";

    STATUS_OPTIONS.forEach(({ value, label }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    });

    select.value = getStatus(number);

    select.addEventListener("change", function () {
        setStatus(this.dataset.number, this.value);
        applyFilters();
    });

    return select;
}

function getOfferState(offer) {
    if (offer.offer_state) return offer.offer_state;
    return offer.is_new === true ? "new" : "old";
}

function createOfferLink(offer) {
    const link = document.createElement("a");
    link.href = detailHref(offer.number, activeBaseName);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.dataset.number = String(offer.number);
    link.title = "Voir le détail de l'offre";
    link.textContent = offer.offer_title || "(Sans titre)";
    link.addEventListener("click", function () {
        markClickedRow(link);
    });
    return link;
}

const STATE_BADGE_TEXT = {
    new: "Nouvelle",
    reappeared: "De retour",
    old: "Ancienne",
    deleted: "Supprimée",
    modified: "Modifiée",
};

function createStateBadge(state) {
    const span = document.createElement("span");
    span.className = "state-badge state-" + state;
    span.textContent = STATE_BADGE_TEXT[state] || state;
    return span;
}

let clickedRowNumber = null;

function markClickedRow(link) {
    const tr = link.closest("tr");
    if (!tr) return;

    const number = tr.dataset.number || null;

    if (clickedRowNumber !== null && clickedRowNumber !== number) {
        const previous = document.querySelector(
            `tr[data-number="${clickedRowNumber}"]`
        );
        if (previous) {
            previous.classList.remove("clicked-row");
        }
    }

    if (clickedRowNumber === number) {
        clickedRowNumber = null;
        tr.classList.remove("clicked-row");
        return;
    }

    clickedRowNumber = number;
    tr.classList.add("clicked-row");
}

function createDescriptionBlock(offer) {
    const container = document.createElement("div");

    const head = document.createElement("div");
    head.className = "offer-head";

    const state = getOfferState(offer);
    if (state !== "unchanged" && state !== "old") {
        head.appendChild(createStateBadge(state));
    }

    const title = createOfferLink(offer);
    head.appendChild(title);

    if (offer.modified === true) {
        const tag = document.createElement("span");
        tag.className = "modified-tag";
        tag.textContent = "\u270E";
        tag.title = "Offre modifiée" + (offer.modified_at
            ? " le " + formatDateTime(offer.modified_at)
            : "");
        tag.setAttribute("aria-label", "Offre modifiée");
        tag.setAttribute("role", "img");
        head.appendChild(tag);
    }

    if (state === "deleted" && offer.removed_on) {
        const hint = document.createElement("span");
        hint.className = "date-hint date-removed";
        hint.textContent = " · supprimée le " + formatDateTime(offer.removed_on);
        head.appendChild(hint);
    }

    container.appendChild(head);

    if (offer.description) {
        const description = document.createElement("div");
        description.className = "offer-description";
        description.textContent = offer.description;
        container.appendChild(description);

        const button = document.createElement("button");
        button.type = "button";
        button.className = "desc-toggle";
        button.textContent = "Afficher plus";
        button.addEventListener("click", function () {
            const expanded = description.classList.toggle("expanded");
            this.textContent = expanded ? "Afficher moins" : "Afficher plus";
        });
        container.appendChild(button);
    }

    return container;
}

function createStarCell(number) {
    const numberStr = String(number);
    const td = document.createElement("td");
    td.className = "col-star";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "star-button";
    button.title = "Marquer comme favori";
    button.setAttribute("aria-pressed", isFavorite(numberStr) ? "true" : "false");
    button.textContent = isFavorite(numberStr) ? "★" : "☆";

    button.addEventListener("click", function () {
        const active = !isFavorite(numberStr);
        setFavorite(numberStr, active);
        this.textContent = active ? "★" : "☆";
        this.setAttribute("aria-pressed", active ? "true" : "false");
        this.classList.toggle("active", active);
        rerenderTables();
    });

    td.appendChild(button);
    return td;
}

function createNotesCell(number) {
    const td = document.createElement("td");
    td.className = "notes-cell";

const textarea = document.createElement("textarea");
    textarea.rows = 5;
    textarea.placeholder = ".";
    textarea.dataset.number = String(number);
    textarea.value = getRemark(String(number));
    textarea.title = "Remarque personnelle";
    textarea.addEventListener("input", function () {
        setRemark(String(number), this.value);
        this.style.height = "auto";
        this.style.height = this.scrollHeight + "px";
    });

    td.appendChild(textarea);
    return td;
}

function createDetailsCell(values) {
    const td = document.createElement("td");
    td.className = "col-details";

    const addLine = (labelText, value, linkHref) => {
        if (!value) return;
        const line = document.createElement("div");
        line.className = "detail-line";

        const label = document.createElement("span");
        label.className = "detail-label";
        label.textContent = labelText + ": ";
        line.appendChild(label);

        if (linkHref) {
            const link = document.createElement("a");
            link.className = "detail-link";
            link.href = linkHref;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = value;
            line.appendChild(link);
        } else {
            line.appendChild(document.createTextNode(value));
        }
        td.appendChild(line);
    };

    const number = String(values.number);
    const priority = getPriority(number);

    [
        ["Contrat", values.contract_type],
        ["Horaire", values.schedule],
        ["Rémunération", values.pay],
        ["Salaire", values.salary],
        ["Priorité", priorityLabel(priority)],
    ].forEach(([labelText, value]) => addLine(labelText, value, ""));

    if (values.email) {
        const emails = String(values.email);
        const first = emails.split(",")[0].trim();
        addLine("Email", emails, "mailto:" + first);
    }

    return td;
}

function relativeDays(value) {
    const d = parseShortDate(value);
    if (!d) return null;
    return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function expiryText(offer) {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(
        String(offer.date_fin_diffusion || "").trim()
    );
    if (!m) return "";
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (isNaN(d.getTime())) return "";
    const days = Math.round((d.getTime() - Date.now()) / 86400000);
    if (days < 0) return "expirée il y a " + (-days) + " j";
    if (days === 0) return "expire aujourd'hui";
    return "expire dans " + days + " j";
}

function createPublishedCell(offer) {
    const box = document.createElement("div");
    const days = relativeDays(offer.published_on);
    box.textContent = offer.published_on || "";
    if (days !== null) {
        const hint = " " + (days === 0 ? "(aujourd'hui)" : "(il y a " + days + " j)");
        const span = document.createElement("span");
        span.className = "date-hint";
        span.textContent = hint;
        box.appendChild(span);
    }
    const exp = expiryText(offer);
    if (exp) {
        const span = document.createElement("span");
        span.className = "date-hint date-expiry";
        span.textContent = " · " + exp;
        box.appendChild(span);
    }
    return box;
}

function createCurrentRow(offer) {
    const number = String(offer.number);
    const tr = document.createElement("tr");
    tr.dataset.number = number;
    tr.dataset.isNew = offer.is_new === true ? "true" : "false";
    tr.dataset.state = getOfferState(offer);

    const textCell = (nodes, className) => {
        const td = document.createElement("td");
        td.className = className;
        nodes.forEach(node => td.appendChild(node));
        return td;
    };

    tr.appendChild(createStarCell(number));

    const tdStatus = document.createElement("td");
    tdStatus.className = "col-status";
    tdStatus.appendChild(createStatusSelect(number));
    tr.appendChild(tdStatus);

    tr.appendChild(textCell([createPublishedCell(offer)], "col-published"));

    tr.appendChild(textCell([document.createTextNode(number)], "col-forem-id"));
    tr.appendChild(textCell([createDescriptionBlock(offer)], "col-offer"));
    tr.appendChild(textCell([document.createTextNode(offer.company || "")], "col-company"));
    tr.appendChild(createDetailsCell(offer));
    tr.appendChild(textCell([document.createTextNode(offer.location || "")], "col-location"));
    tr.appendChild(createNotesCell(number));

    highlightIn(tr);
    return tr;
}

function createSeparationRow(text, className) {
    const row = document.createElement("tr");
    row.className = className
        ? "separation-row " + className
        : "separation-row";
    row.dataset.separation = "true";

    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.textContent = text;

    row.appendChild(cell);
    return row;
}

function appendRemovedGroup(tbody, removed) {
    if (removed.length === 0) return;
    removed.sort((a, b) => {
        const ra = parseSortDate(a.removed_on) || 0;
        const rb = parseSortDate(b.removed_on) || 0;
        return rb - ra;
    });
    tbody.appendChild(createSeparationRow(`Supprimées (${removed.length})`, "separ-deleted"));
    removed.forEach(offer => tbody.appendChild(createCurrentRow(offer)));
}

function renderCurrent(offers, scrapeDate) {
    const removed = offers.filter(o => getOfferState(o) === "deleted");
    const live = offers.filter(o => getOfferState(o) !== "deleted");
    const allNew = live.filter(o => o.is_new === true);
    const allOld = live.filter(o => o.is_new !== true);

    document.getElementById("statTotal").textContent = offers.length;
    document.getElementById("statNew").textContent = allNew.length;
    document.getElementById("statOld").textContent = allOld.length;
    document.getElementById("statDate").textContent = scrapeDate ? formatDateTime(scrapeDate) : "—";

    const tbody = document.getElementById("currentRows");
    tbody.innerHTML = "";

    if (offers.length === 0) {
        tbody.appendChild(createInfoRow("Aucune annonce trouvée."));
        return;
    }

    if (sortIsActive() && sortTable === "currentRows") {
        sortedOffers(live).forEach(offer => {
            tbody.appendChild(createCurrentRow(offer));
        });
        appendRemovedGroup(tbody, removed);
        return;
    }

    const favorites = live.filter(o => isFavorite(String(o.number)));
    const favNumbers = new Set(favorites.map(o => String(o.number)));
    const modifiedOffers = live.filter(o => o.modified === true);
    const newOffers = allNew.filter(o => !favNumbers.has(String(o.number)));
    const olderOffers = allOld.filter(o => !favNumbers.has(String(o.number)));
    
    // Default order: most recently published first
    if (!sortIsActive() || sortTable !== "currentRows") {
        offers.sort((a, b) => {
            const pa = parseSortDate(a.published_on) || 0;
            const pb = parseSortDate(b.published_on) || 0;
            if (pb !== pa) return pb - pa;
            const ma = parseSortDate(a.modified_at) || 0;
            const mb = parseSortDate(b.modified_at) || 0;
            return mb - ma;
        });
    }

    // Mises à jour section
    if (modifiedOffers.length > 0) {
        tbody.appendChild(createSeparationRow(`Mises à jour (${modifiedOffers.length})`, "separ-modified"));
        modifiedOffers.forEach(offer => tbody.appendChild(createCurrentRow(offer)));
    }

    if (favorites.length > 0) {
        tbody.appendChild(createSeparationRow(`Favoris (${favorites.length})`, "separ-favorites"));
        favorites.forEach(offer => tbody.appendChild(createCurrentRow(offer)));
    }

    if (newOffers.length > 0) {
        tbody.appendChild(createSeparationRow(`Nouvelles annonces (${newOffers.length})`));
        newOffers.forEach(offer => tbody.appendChild(createCurrentRow(offer)));
    }

    if (olderOffers.length > 0) {
        tbody.appendChild(createSeparationRow(`Anciennes annonces (${olderOffers.length})`));
        olderOffers.forEach(offer => tbody.appendChild(createCurrentRow(offer)));
    }

    if (removed.length > 0) {
        appendRemovedGroup(tbody, removed);
    }

    refreshFollowUps();
}

function rerenderTables() {
    if (!currentOffers) return;
    renderCurrent(currentOffers, lastScrapeDate);
    applyFilters();
    renderTrackedAlerts();
}


// ============================================================
// TRACKING LOSS ALERTS
// Warns (discretely) when a favorite / active application ends up
// in the deleted offers, or comes back from there. Alerts are
// recomputed from the current state; "Masquer" hides them for the
// rest of the session.
// ============================================================

let trackedAlertsExpanded = false;

const TRACKED_ALERTS_DISMISS_KEY = "forem_tracked_alerts_dismissed";

// "Masquer" keeps the panel hidden until a new scraping replaces the one
// currently displayed: the marker remembers the scrape date it hid.
function trackedAlertsHiddenForCurrentScrape() {
    if (!lastScrapeDate) return false;
    try {
        return localStorage.getItem(TRACKED_ALERTS_DISMISS_KEY) === lastScrapeDate;
    } catch (error) {
        return false;
    }
}

function dismissTrackedAlerts() {
    try {
        if (lastScrapeDate) {
            localStorage.setItem(TRACKED_ALERTS_DISMISS_KEY, lastScrapeDate);
        }
    } catch (error) {
        /* storage unavailable */
    }
}

const TRACKED_ALERTS_VISIBLE = 5;

const TRACKED_ALERT_BADGES = {
    gone: "Disparue",
    back: "De retour",
    modified: "Modifiée",
};

function buildTrackedAlertItem(kind, offer, dateValue) {
    const row = document.createElement("div");
    row.className = "tracked-alert-item tracked-alert-" + kind;

    const badge = document.createElement("span");
    badge.className = "tracked-alert-badge";
    badge.textContent = TRACKED_ALERT_BADGES[kind] || kind;

    const message = document.createElement("span");
    message.appendChild(createOfferLink(offer));
    const company = offer.company ? " (" + offer.company + ")" : "";
    const date = formatDateTime(dateValue);
    let text;
    if (kind === "gone") {
        text = company + " — supprimée (le " + date + ").";
    } else if (kind === "modified") {
        text = company + " — annonce modifiée (" + date + ").";
    } else {
        text = company + " — de retour dans la liste (" + date + ").";
    }
    message.appendChild(document.createTextNode(text));

    row.appendChild(badge);
    row.appendChild(message);
    return row;
}

function renderTrackedAlerts() {
    const panel = document.getElementById("trackedAlertPanel");
    const list = document.getElementById("trackedAlertList");
    if (!panel || !list) return;

    if (trackedAlertsHiddenForCurrentScrape()) {
        panel.classList.add("hidden");
        return;
    }

    const items = [];
    (currentOffers || []).forEach(offer => {
        const state = getOfferState(offer);
        if (state === "deleted") {
            items.push(buildTrackedAlertItem("gone", offer, offer.removed_on));
        } else if (state === "reappeared") {
            items.push(buildTrackedAlertItem("back", offer, lastScrapeDate));
        }
        if (offer.modified === true && state !== "deleted") {
            items.push(buildTrackedAlertItem("modified", offer, offer.modified_at));
        }
    });

    list.innerHTML = "";
    if (items.length === 0) {
        panel.classList.add("hidden");
        return;
    }

    items.forEach(item => list.appendChild(item));
    updateTrackedAlertToggle(items.length);
    panel.classList.remove("hidden");
}

function updateTrackedAlertToggle(total) {
    const toggle = document.getElementById("trackedAlertToggleBtn");
    const list = document.getElementById("trackedAlertList");
    const limited = total > TRACKED_ALERTS_VISIBLE;

    if (list) {
        list.classList.toggle(
            "is-limited", limited && !trackedAlertsExpanded
        );
    }
    if (toggle) {
        toggle.classList.toggle("hidden", !limited);
        toggle.textContent = trackedAlertsExpanded ? "Voir moins" : "Voir plus";
        toggle.setAttribute(
            "aria-expanded", trackedAlertsExpanded ? "true" : "false"
        );
    }
}


// ============================================================
// DISPLAY HELPERS
// ============================================================


// ============================================================
// RELANCES (FOLLOW-UPS)
// Offers "postulé" / "contacté" for too long go to the top of
// the workflow so the user remembers to follow them up.
// ============================================================

const FOLLOWUP_DAYS = 7;
const FOLLOWUP_STATUSES = ["postule", "contacte"];

function timeAgoShort(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const days = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
    if (days <= 0) return "aujourd'hui";
    if (days === 1) return "il y a 1 jour";
    return "il y a " + days + " jours";
}

function buildFollowUpItem(item) {
    const { offer, status, date } = item;

    const num = document.createElement("span");
    num.className = "follow-up-num";
    num.textContent = String(offer.number);

    const title = createOfferLink(offer);

    const meta = document.createElement("div");
    meta.className = "follow-up-meta";
    meta.textContent = offer.company || "";

    const body = document.createElement("div");
    body.className = "follow-up-body";
    body.appendChild(title);
    body.appendChild(meta);

    const statusLabel = document.createElement("span");
    statusLabel.className = "follow-up-status";
    statusLabel.textContent = statusLabel(status);

    const ago = document.createElement("span");
    ago.className = "follow-up-ago";
    ago.textContent = timeAgoShort(date);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "follow-up-relance";
    button.dataset.number = String(offer.number);
    button.textContent = "Relancé";
    button.title = "Marquer comme relancé aujourd'hui";

    const row = document.createElement("div");
    row.className = "follow-up-item";
    row.appendChild(num);
    row.appendChild(body);
    row.appendChild(statusLabel);
    row.appendChild(ago);
    row.appendChild(button);

    return row;
}

function getFollowUps() {
    const now = Date.now();
    const limit = FOLLOWUP_DAYS * 24 * 60 * 60 * 1000;
    return currentOffers
        .filter(offer => {
            const number = String(offer.number);
            const status = getStatus(number);
            if (!FOLLOWUP_STATUSES.includes(status)) return false;
            const date = getStatutDate(number);
            if (!date) return false;
            const t = new Date(date).getTime();
            return !isNaN(t) && (now - t) >= limit;
        })
        .map(offer => ({
            offer,
            status: getStatus(String(offer.number)),
            date: getStatutDate(String(offer.number)),
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

function refreshFollowUps() {
    const panel = document.getElementById("followUpPanel");
    const listEl = document.getElementById("followUpList");
    const countEl = document.getElementById("followUpCount");
    if (!panel || !listEl || !countEl) return;

    const list = getFollowUps();

    if (!list.length) {
        panel.classList.add("hidden");
        listEl.innerHTML = "";
        return;
    }

    countEl.textContent = String(list.length);
    listEl.innerHTML = "";
    list.forEach(item => listEl.appendChild(buildFollowUpItem(item)));
    panel.classList.remove("hidden");
}

function markFollowedUp(number) {
    setStatutDate(number, new Date().toISOString());
    refreshFollowUps();
}

function markAllFollowedUp() {
    const now = new Date().toISOString();
    const list = getFollowUps();
    list.forEach(({ offer }) => {
        statutDates[String(offer.number)] = now;
    });
    saveStatutDates();
    refreshFollowUps();
}


// ============================================================
// FILTERS (STATUS + SEARCH)
// ============================================================

function getKeywords(value) {
    return normalizeText(value).split(/\s+/).filter(Boolean);
}

function getStatusFromUrl() {
    const value = new URLSearchParams(window.location.search).get("status");
    const allowed = STATUS_OPTIONS.map(o => o.value).concat(["unsorted"]);
    return allowed.includes(value) ? value : "";
}

function updateStatusInUrl(value) {
    const url = new URL(window.location.href);
    if (value) {
        url.searchParams.set("status", value);
    } else {
        url.searchParams.delete("status");
    }
    window.history.replaceState({}, "", url);
}

let groupFilter = "all";
let groupFilterZones = [];

// Offer lookup map used by the advanced filters (built on each load).
let currentByNumber = new Map();

function readFilterValue(id) {
    const el = document.getElementById(id);
    return el ? el.value : "";
}

function offerStateMatches(offer, value) {
    const state = getOfferState(offer);
    if (!value) return state !== "deleted";
    if (value === "old") {
        return state === "old" || state === "unchanged";
    }
    return state === value;
}

/**
 * Whether an offer sits in the picked locality.
 *
 * lieuxTravail holds free text typed by the employer, so "LIÈGE" and "Liège"
 * mean the same place. Both sides are folded before comparing, otherwise the
 * same city would appear twice in the menu and only one of the two would
 * filter.
 * @param {Object} offer
 * @param {string} value
 * @returns {boolean}
 */
/**
 * Write a shouted place name the way a person would.
 *
 * Employers type "LIÈGE" and "HERSTAL"; the menu reads "Liège" and "Herstal".
 * Only a wholly uppercase name is rewritten: "Arrondissement de Liege" already
 * has its own shape and is left exactly as the employer wrote it.
 *
 * The check looks for a lowercase letter rather than comparing case, so a name
 * without any letter ("4000", "-") is never touched.
 * @param {string} value
 * @returns {string}
 */
function tidyLocation(value) {
    const text = String(value || "").trim();
    if (text === "") return "";
    if (!/\p{L}/u.test(text) || /\p{Ll}/u.test(text)) return text;
    return text.charAt(0).toLocaleUpperCase()
        + text.slice(1).toLocaleLowerCase();
}

/**
 * Every place one offer sits in, as a list.
 *
 * An offer may name several: "Arrondissement de Waremme, Arrondissement de
 * Liège, Hannut". They are three distinct places. The scraper stores them
 * apart in `locations`; offers scraped before that only have the joined
 * string, so it is split on commas. No single workplace from the Forem
 * contains a comma, which was checked against the stored data.
 * @param {Object} offer
 * @returns {Array<string>}
 */
function offerLocations(offer) {
    if (!offer) return [];

    if (Array.isArray(offer.locations) && offer.locations.length > 0) {
        return offer.locations
            .map(function (value) { return String(value || "").trim(); })
            .filter(Boolean);
    }

    return String(offer.location || "")
        .split(",")
        .map(function (part) { return part.trim(); })
        .filter(Boolean);
}

/**
 * Whether an offer sits in the picked place.
 *
 * One locality out of several is enough: picking "Hannut" keeps an offer that
 * also covers two arrondissements. The places are folded on both sides, since
 * the employers type them freely.
 * @param {Object} offer
 * @param {string} value
 * @returns {boolean}
 */
function locationMatches(offer, value) {
    if (!value) return true;
    const wanted = normalizeText(value);
    if (wanted === "") return true;
    return offerLocations(offer).some(function (place) {
        return normalizeText(place) === wanted;
    });
}

/**
 * Fill the locality menu with the places the loaded offers actually mention.
 *
 * Built from the offers rather than from the Forem nomenclature: the employers
 * type the place as free text, so a nomenclature list would offer thousands of
 * spellings that match nothing.
 * @param {Array<Object>} offers
 */
function fillLocationFilter(offers) {
    const select = document.getElementById("locationFilter");
    if (!select) return;

    const chosen = select.value;
    const seen = new Map();

    offers.forEach(function (offer) {
        // An offer naming three places contributes three entries, not one.
        offerLocations(offer).forEach(function (raw) {
            // One option per place, whichever spelling the employer used, shown
            // with its capitals tamed.
            const key = normalizeText(raw);
            if (key === "" || seen.has(key)) return;
            seen.set(key, tidyLocation(raw));
        });
    });

    const values = Array.from(seen.values())
        .sort(function (a, b) {
            return normalizeText(a).localeCompare(normalizeText(b), "fr");
        });

    select.textContent = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Toutes";
    select.appendChild(all);

    values.forEach(function (place) {
        const option = document.createElement("option");
        option.value = place;
        option.textContent = place;
        select.appendChild(option);
    });

    // Keep the choice when it is still on offer, drop it otherwise.
    const stillThere = values.some(function (place) {
        return normalizeText(place) === normalizeText(chosen);
    });
    select.value = stillThere ? chosen : "";
}

function contractMatches(offer, value) {
    if (!value) return true;
    const text = normalizeText(offer.contract_type || "");
    if (value === "cdi") return text.indexOf("duree indeterminee") !== -1;
    if (value === "cdd") return text.indexOf("duree determinee") !== -1;
    if (value === "interim") return text.indexOf("interim") !== -1;
    return text.indexOf("interim") === -1 && text.indexOf("duree") === -1;
}

function scheduleMatches(offer, value) {
    if (!value) return true;
    const text = normalizeText(offer.schedule || "");
    switch (value) {
        case "plein":
            return text.indexOf("temps plein") !== -1;
        case "partiel":
            return text.indexOf("temps partiel") !== -1;
        case "jour":
            return /de jour|travail de jour/.test(text);
        case "nuit":
            return text.indexOf("nuit") !== -1;
        case "weekend":
            return text.indexOf("week-end") !== -1 || text.indexOf("week end") !== -1;
        case "pauses":
            return /2 pauses|3 pauses|2x8|3x8/.test(text);
        default:
            return true;
    }
}

function hasSalaryInfo(offer) {
    return Boolean(normalizeText(offer.salary) || normalizeText(offer.pay));
}

function parseShortDate(value) {
    const m = /^(\d{1,2})-(\d{1,2})-(\d{2})$/.exec(value || "");
    if (!m) return null;
    const d = new Date("20" + m[3] + "-" + m[2] + "-" + m[1] + "T00:00:00");
    return isNaN(d.getTime()) ? null : d;
}

function dateMatches(offer, value) {
    if (!value) return true;
    const d = parseShortDate(offer.published_on);
    if (!d) {
        const raw = normalizeText(offer.published_on || "");
        let approx = null;
        if (raw.indexOf("aujourdhui") !== -1) approx = 0;
        else if (raw.indexOf("hier") !== -1) approx = 1;
        if (approx === null) return false;
        if (value === "today") return approx === 0;
        const days = { "24h": 1, "3j": 3, "7j": 7, "30j": 30 }[value];
        return days !== undefined && approx <= days;
    }
    const diffDays = (Date.now() - d.getTime()) / 86400000;
    if (value === "today") return diffDays >= 0 && diffDays < 1;
    const days = { "24h": 1, "3j": 3, "7j": 7, "30j": 30 }[value];
    if (days === undefined) return true;
    return diffDays >= 0 && diffDays <= days;
}

function applyFilters() {
    const statusValue = readFilterValue("statusFilter");
    const stateFilter = readFilterValue("stateFilter");
    const locationFilter = readFilterValue("locationFilter");
    const contractFilter = readFilterValue("contractFilter");
    const scheduleFilter = readFilterValue("scheduleFilter");
    const salaryFilter = readFilterValue("salaryFilter");
    const dateFilter = readFilterValue("dateFilter");

    applyFiltersToTable(
        "currentRows",
        "currentSearch",
        function (row) {
            const number = String(row.dataset.number);
            const offer = currentByNumber.get(number);

            if (groupFilter === "new" && row.dataset.isNew !== "true") return false;
            if (groupFilter === "old" && row.dataset.isNew !== "false") return false;

            if (statusValue) {
                const status = getStatus(number);
                if (statusValue === "unsorted") {
                    if (status !== "") return false;
                } else if (status !== statusValue) {
                    return false;
                }
            }

            if (offer) {
                if (!offerStateMatches(offer, stateFilter)) return false;
                if (!locationMatches(offer, locationFilter)) return false;
                if (!contractMatches(offer, contractFilter)) return false;
                if (!scheduleMatches(offer, scheduleFilter)) return false;
                if (salaryFilter === "oui" && !hasSalaryInfo(offer)) return false;
                if (salaryFilter === "non" && hasSalaryInfo(offer)) return false;
                if (!dateMatches(offer, dateFilter)) return false;
            }
            return true;
        }
    );
}

function applyFiltersToTable(tbodyId, searchId, otherFiltersPass) {
    const tbody = document.getElementById(tbodyId);
    const input = document.getElementById(searchId);
    const keywords = input ? getKeywords(input.value) : [];

    const rows = Array.from(tbody.children);

    // A separation row labels the block of rows that follows it. Each block
    // is grouped under its own header; rows placed before the first header
    // form a header-less block.
    const groups = [];
    let current = null;
    rows.forEach(row => {
        if (row.dataset && row.dataset.separation === "true") {
            current = { separation: row, rows: [] };
            groups.push(current);
        } else {
            if (!current) {
                current = { separation: null, rows: [] };
                groups.push(current);
            }
            current.rows.push(row);
        }
    });

    groups.forEach(group => {
        let visible = 0;

        group.rows.forEach(row => {
            const number = row.dataset && row.dataset.number;

            if (!number) {
                row.style.display = "";
                return;
            }

            let shown = otherFiltersPass(row);

            if (shown && keywords.length > 0) {
                // Match on the offer data, never on the rendered row: the row
                // text also holds the status option labels, the state badges
                // and the remarks textarea, so "postule" matched every row and
                // typing it looked like it did nothing.
                shown = offerMatchesRow(row, searchId, keywords);
            }

            row.style.display = shown ? "" : "none";
            if (shown) visible++;
        });

        // Hide a separation row when none of its items is visible.
        if (group.separation) {
            group.separation.style.display = visible > 0 ? "" : "none";
        }
    });
}

function setupGroupFilterZones() {
    groupFilterZones = Array.from(document.querySelectorAll(".stat-filter"));
    groupFilterZones.forEach(zone => {
        zone.addEventListener("click", function () {
            const value = this.dataset.filter || "all";
            groupFilter = groupFilter === value ? "all" : value;
            updateGroupFilterZones();
            applyFilters();
        });
    });
}

function updateGroupFilterZones() {
    groupFilterZones.forEach(zone => {
        zone.classList.toggle("active", zone.dataset.filter === groupFilter);
    });
}

function resetGroupFilter() {
    groupFilter = "all";
    groupFilterZones.forEach(zone => zone.classList.remove("active"));
}


// ============================================================
// TABS
// ============================================================

function setupTabs() {
    const buttons = Array.from(document.querySelectorAll(".tab-btn"));

    buttons.forEach(button => {
        button.addEventListener("click", function () {
            buttons.forEach(b => {
                const active = b === this;
                b.classList.toggle("active", active);
                b.setAttribute("aria-selected", active ? "true" : "false");
            });

            document.getElementById("tab-current").classList.remove("hidden");
        });
    });
}


// ============================================================
// NEW SEARCH
// ============================================================

const API_OCCUPATIONS = "/api/nomenclature/occupations?q=";
const API_LOCATIONS = "/api/nomenclature/locations";

const SUGGESTION_LIMIT = 12;

let selectedOccupation = null;
let selectedLocation = null;
let locationsCache = null;
let occupationTimer = null;

function setupNewSearch() {
    const modal = document.getElementById("searchModal");
    if (!modal) return;

    document.getElementById("closeModalBtn").addEventListener(
        "click", closeModal
    );
    document.getElementById("cancelModalBtn").addEventListener(
        "click", closeModal
    );
    modal.querySelector(".modal-backdrop").addEventListener("click", closeModal);
    document.getElementById("launchScrapeBtn").addEventListener(
        "click", launchNewScraping
    );

    modal.addEventListener("keydown", function (e) {
        if (e.key === "Escape") closeModal();
    });

    document.getElementById("occupationInput").addEventListener(
        "input", function () {
            clearTimeout(occupationTimer);
            const term = this.value.trim();
            occupationTimer = setTimeout(
                () => searchOccupations(term), 250
            );
        }
    );

    document.getElementById("locationInput").addEventListener(
        "input", function () {
            loadLocations().then(
                list => filterLocations(this.value, list)
            );
        }
    );

    document.getElementById("occupationSuggestions").addEventListener(
        "click", function (e) {
            const item = e.target.closest("li[data-key]");
            if (!item) return;
            pickOccupation(item.dataset.key, item.dataset.label);
        }
    );

    document.getElementById("locationSuggestions").addEventListener(
        "click", function (e) {
            const item = e.target.closest("li[data-key]");
            if (!item) return;
            pickLocation(item.dataset.key, item.dataset.label);
        }
    );
}

function openModal() {
    const modal = document.getElementById("searchModal");
    if (!modal) return;
    selectedOccupation = null;
    selectedLocation = null;
    clearSuggestions("occupationSuggestions");
    clearSuggestions("locationSuggestions");
    document.getElementById("occupationInput").value = "";
    document.getElementById("locationInput").value = "";
    document.getElementById("scrapeStatus").textContent = "";
    document.getElementById("searchNamePreview").value = "";
    document.getElementById("launchScrapeBtn").disabled = true;
    updateConfirmation();
    modal.classList.add("visible");
    document.getElementById("occupationInput").focus();
}

function closeModal() {
    document.getElementById("searchModal").classList.remove("visible");
}

function clearSuggestions(id) {
    document.getElementById(id).innerHTML = "";
}

function showSuggestionError(id, message) {
    const ul = document.getElementById(id);
    ul.innerHTML = "";
    const li = document.createElement("li");
    li.className = "suggestion-empty";
    li.textContent = message;
    ul.appendChild(li);
}

function searchOccupations(term) {
    if (!term) {
        clearSuggestions("occupationSuggestions");
        return;
    }
    fetch(API_OCCUPATIONS + encodeURIComponent(term), { cache: "no-store" })
        .then(response => {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
        })
        .then(list => renderOccupationSuggestions(list, term))
        .catch(e => {
            console.error(e);
            showSuggestionError(
                "occupationSuggestions", "Erreur réseau : " + e.message
            );
        });
}

function renderOccupationSuggestions(list, term) {
    const ul = document.getElementById("occupationSuggestions");
    ul.innerHTML = "";
    const normalizedTerm = normalizeText(term);
    let filtered = list.filter(item => item && item.value && normalizeText(
        item.value
    ).includes(normalizedTerm));
    if (!filtered.length) {
        filtered = list;
    }
    filtered.slice(0, SUGGESTION_LIMIT).forEach(item => {
        const li = document.createElement("li");
        li.dataset.key = item.key;
        li.dataset.label = item.value;
        li.textContent = item.value;
        li.tabIndex = 0;
        ul.appendChild(li);
    });
    if (!filtered.length) {
        showSuggestionError(
            "occupationSuggestions", `Aucun métier trouvé pour « ${term} ».`
        );
    }
}

function loadLocations() {
    if (locationsCache) {
        return Promise.resolve(locationsCache);
    }
    return fetch(API_LOCATIONS, { cache: "no-store" })
        .then(response => {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
        })
        .then(list => {
            locationsCache = list;
            return list;
        })
        .catch(e => {
            console.error(e);
            return [];
        });
}

function filterLocations(term, list) {
    const ul = document.getElementById("locationSuggestions");
    ul.innerHTML = "";
    const normalizedTerm = normalizeText(term);
    const filtered = list.filter(item => item && item.label && (
        !normalizedTerm ||
        normalizeText(item.label).includes(normalizedTerm) ||
        normalizeText(String(item.code)).includes(normalizedTerm)
    ));
    if (!filtered.length) {
        showSuggestionError(
            "locationSuggestions",
            term ? "Aucun lieu trouvé." : "Tape pour filtrer les lieux."
        );
        return;
    }
    filtered.slice(0, SUGGESTION_LIMIT).forEach(item => {
        const li = document.createElement("li");
        li.dataset.key = item.gufid;
        li.dataset.label = item.label;
        li.textContent = item.label;
        li.tabIndex = 0;
        ul.appendChild(li);
    });
}

function pickOccupation(key, label) {
    selectedOccupation = { key: key, value: label };
    document.getElementById("occupationInput").value = label;
    clearSuggestions("occupationSuggestions");
    updateConfirmation();
}

function pickLocation(key, label) {
    selectedLocation = { key: key, label: label };
    document.getElementById("locationInput").value = label;
    clearSuggestions("locationSuggestions");
    updateConfirmation();
}

function updateConfirmation() {
    document.getElementById("confirmationOccupation").textContent = selectedOccupation
        ? selectedOccupation.value : "—";
    document.getElementById("confirmationOccupationGuid").textContent = selectedOccupation
        ? selectedOccupation.key : "—";
    document.getElementById("confirmationLocation").textContent = selectedLocation
        ? selectedLocation.label : "—";
    document.getElementById("confirmationLocationGuid").textContent = selectedLocation
        ? selectedLocation.key : "—";
    const ready = Boolean(selectedOccupation && selectedLocation);
    document.getElementById("searchNamePreview").value = ready
        ? newScrapingName() : "";
    document.getElementById("launchScrapeBtn").disabled = !ready;
    document.getElementById("scrapeStatus").textContent = "";
}

function slugify(text) {
    return normalizeText(text)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

// Nom court utilisé par le scraper pour les fichiers de la recherche
// (data_<nom>.json, details_<nom>.json, historique_<nom>.json).
function newScrapingName() {
    if (!selectedOccupation || !selectedLocation) return "";
    return slugify(selectedOccupation.value + " " + selectedLocation.label);
}

function newScrapingLabel() {
    return selectedOccupation.value + " / " + selectedLocation.label;
}

// La recherche est créée et téléchargée comme les mises à jour : même route,
// même terminal. Aucune commande à copier dans un terminal.
function launchNewScraping() {
    if (!selectedOccupation || !selectedLocation) return;
    const name = newScrapingName();
    const status = document.getElementById("scrapeStatus");
    if (!name) {
        status.textContent = "Choisis un métier et un lieu qui contiennent des lettres.";
        return;
    }
    closeModal();
    ScraperUi.runNewScraping({
        name: name,
        label: newScrapingLabel(),
        occupation_guid: selectedOccupation.key,
        location_guid: selectedLocation.key
    }, function () {
        selectCreatedScraping(name);
    });
}

// Le scraper vient d'écrire data_<name>.json : la liste des recherches est
// rechargée et la nouvelle recherche devient la sélection courante.
function selectCreatedScraping(name) {
    localStorage.setItem(
        STORAGE_KEY, "data_" + name + ".json"
    );
    refreshScrapingSelector();
}

// Recharge la liste des recherches sans perdre l'écouteur du <select> ni la
// sélection courante.


function updateDeleteGearButtonVisibility() {
    const btn = document.getElementById("deleteScrapingGearBtn");
    if (!btn) return;
    // Show only when a specific scrape is selected (not "all")
    if (dataUrl && dataUrl !== "all" && activeBaseName) {
        btn.style.display = "";
    } else {
        btn.style.display = "none";
    }
}


// ============================================================
// BOUTON « ACTUALISER » (scraping manuel, synchrone)
// ============================================================

function currentScrapingTarget() {
    if (!dataUrl || dataUrl === "all" || !activeBaseName) return null;
    const scrape = activeScrapings.find(function (s) {
        return s.name === activeBaseName;
    }) || {};
    return {
        name: activeBaseName,
        label: scrape.label || (lastData && lastData.label) || activeBaseName,
        occupation_guid: scrape.occupationGuid
            || (lastData && lastData.occupation_guid) || "",
        location_guid: scrape.locationGuid
            || (lastData && lastData.location_guid) || ""
    };
}

function setupScraperRefresh() {
    ScraperUi.attach({
        getTarget: currentScrapingTarget,
        onScraped: function () {
            // « Dernier scraping », statistiques et tableaux sont rechargés
            // depuis les fichiers écrits par le scraper.
            reloadStorageMaps();
            reloadTables();
        }
    });
}

function refreshScraperButtonTarget() {
    ScraperUi.setTarget(currentScrapingTarget());
}

// ============================================================
// SCRAPING SELECTOR (shared component)
// ============================================================

// La recherche affichée : le composant ne déclenche pas onChange au premier
// rendu, c'est ici qu'on décide ce que le tableau montre à l'ouverture.
function applyScrapingSelection(key, scrapings) {
    activeScrapings = scrapings;
    if (key === "all") {
        dataUrl = "all";
        historyUrl = "";
        setActiveScraping("");
        return;
    }
    const scrape = scrapings.find(function (s) { return s.file === key; });
    if (!scrape) return;
    dataUrl = scrape.file;
    historyUrl = scrape.history;
    setActiveScraping(scrape.name || "");
}

function setupScrapingSelector() {
    const select = document.getElementById("scrapingSelect");
    if (!select) return Promise.resolve();

    return createScrapingSelector({
        selectId: "scrapingSelect",
        allowAll: true,      // "Toutes les recherches" option
        allowCreate: true,   // "Creer un nouveau scrap" option
        onChange: function (key, scrapings) {
            applyScrapingSelection(key, scrapings);
            reloadStorageMaps();
            resetGroupFilter();
            resetSort();
            reloadTables();
            updateDeleteGearButtonVisibility();
            refreshScraperButtonTarget();
        }
    }).then(function (result) {
        try {
            // result.current est la recherche retenue : celle du profil, ou
            // « Toutes les recherches » si le profil n'en a aucune.
            applyScrapingSelection(result.current, result.scrapings);
            updateDeleteGearButtonVisibility();
            refreshScraperButtonTarget();
            reloadStorageMaps();
            reloadTables();
        } catch (e) {
            console.error("Error restoring scrape selection:", e);
        }
    });
}

// Listen for "Create new scrape" event from shared component
document.addEventListener("foremCreateScrape", function () {
    openModal();
});

function updateTitle(data) {
    const label = data && typeof data.label === "string"
        ? data.label.trim() : "";
    const fullTitle = label
        ? "Offres Forem — " + label
        : "Offres Forem — Électromécanicien industriel";
    const maxLen = 50;
    const displayTitle = fullTitle.length > maxLen
        ? fullTitle.slice(0, maxLen - 1) + "…"
        : fullTitle;
    const titleEl = document.getElementById("mainTitle");
    titleEl.textContent = displayTitle;
    titleEl.title = fullTitle;
    document.title = fullTitle;
}


// ============================================================
// SHARED STATE
// ============================================================

let currentOffers = [];
let lastScrapeDate = "";
let lastData = null;
let staleAlertShown = false;

let sortTable = null;
let sortKey = null;
let sortDir = 0; // 0 none, 1 ascending, -1 descending


// ============================================================
// TABLE SORTING
// ============================================================

function parseSortDate(value) {
    if (!value) return 0;
    const short = /^(\d{1,2})-(\d{1,2})-(\d{2})$/.exec(value);
    if (short) {
        return new Date(
            "20" + short[3] + "-" + short[2] + "-" + short[1]
        ).getTime();
    }
    const t = new Date(value).getTime();
    return isNaN(t) ? 0 : t;
}

function getStatusRank(offer) {
    return statusRank(getStatus(String(offer.number)) || "");
}

function getSortValue(offer, key) {
    switch (key) {
        case "status":
            return getStatusRank(offer);
        case "published_on":
        case "removed_on":
        case "modified_at":
            return parseSortDate(offer[key]);
        case "number":
            return String(offer.number || "");
        default:
            return String(offer[key] || "");
    }
}

function compareForSort(a, b, key, dir) {
    const va = getSortValue(a, key);
    const vb = getSortValue(b, key);
    if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * dir;
    }
    return va.localeCompare(vb, "fr", { sensitivity: "base" }) * dir;
}

function sortedOffers(offers) {
    if (!sortKey || !sortDir) return offers;
    return offers.slice().sort(function (a, b) {
        return compareForSort(a, b, sortKey, sortDir);
    });
}

function sortIsActive() {
    return Boolean(sortKey && sortDir);
}

function tableKeyFor(th) {
    const tbody = th.closest("table").querySelector("tbody");
    return tbody ? tbody.id : "";
}

function setupSortableColumns() {
    document.querySelectorAll("th[data-sort]").forEach(th => {
        th.classList.add("sortable");
        th.addEventListener("click", function () {
            const tableKey = tableKeyFor(th);
            const key = this.dataset.sort;
            if (sortKey === key && sortTable === tableKey) {
                if (sortDir === 1) {
                    sortDir = -1;
                } else {
                    sortTable = null;
                    sortKey = null;
                    sortDir = 0;
                }
            } else {
                sortTable = tableKey;
                sortKey = key;
                sortDir = 1;
            }
            updateSortHeaders();
            renderCurrent(currentOffers, lastScrapeDate);
            applyFilters();
        });
    });
}

function updateSortHeaders() {
    document.querySelectorAll("th[data-sort]").forEach(th => {
        th.classList.remove("sort-asc", "sort-desc");
        if (th.dataset.sort === sortKey && tableKeyFor(th) === sortTable) {
            th.classList.add(sortDir === 1 ? "sort-asc" : "sort-desc");
        }
    });
}

function resetSort() {
    sortTable = null;
    sortKey = null;
    sortDir = 0;
    updateSortHeaders();
}


// ============================================================
// CSV EXPORT
// ============================================================

function statusLabel(value) {
    const option = STATUS_OPTIONS.find(o => o.value === value);
    return option ? option.label : (value ? value : "");
}

function csvField(value) {
    const text = String(value == null ? "" : value);
    if (/[;"\r\n]/.test(text)) {
        return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
}

/**
 * Folded search text per offer, so a keystroke does not rebuild it.
 *
 * Keyed on the offer object, which is rebuilt on every reload, so the cache
 * expires on its own and nothing has to be invalidated by hand. Offers are
 * never mutated in place, which is what makes this safe.
 * @type {WeakMap<Object, string>}
 */
const offerTextCache = new WeakMap();

/**
 * Every searchable value of an offer, as one folded string.
 *
 * The fields are not listed by hand on purpose: a column added to the
 * listing becomes searchable the day it appears, instead of silently staying
 * out of the box. Nested objects and arrays are walked too, since the pay and
 * diff data live one level down.
 * @param {Object} offer
 * @returns {string}
 */
function offerSearchText(offer) {
    const cached = offerTextCache.get(offer);
    if (cached !== undefined) return cached;

    const parts = [];
    collectSearchValues(offer, parts, 0);
    const text = normalizeText(parts.join(" "));

    offerTextCache.set(offer, text);
    return text;
}

/**
 * Push the scalar values of one node into parts, flattening as it goes.
 *
 * Booleans are left out: "true" matches most offers and means nothing to
 * search for. Strings carrying markup go through htmlToText, otherwise a tag
 * name matches every offer.
 * @param {*} value
 * @param {Array<string>} parts
 * @param {number} depth
 */
function collectSearchValues(value, parts, depth) {
    if (value === null || value === undefined) return;
    // The depth cap keeps a self-referencing object from looping forever.
    if (depth > 4) return;

    if (Array.isArray(value)) {
        value.forEach(item => collectSearchValues(item, parts, depth + 1));
        return;
    }
    if (typeof value === "object") {
        Object.keys(value).forEach(key => {
            const item = value[key];
            if (typeof item !== "boolean") collectSearchValues(item, parts, depth + 1);
        });
        return;
    }
    if (typeof value === "string") {
        if (!value) return;
        parts.push(value.indexOf("<") >= 0 ? htmlToText(value) : value);
        return;
    }
    if (typeof value === "number") parts.push(String(value));
}

function offerMatchesKeys(offer, inputId) {
    const input = document.getElementById(inputId);
    if (!input) return true;
    const keywords = getKeywords(input.value);
    if (!keywords.length) return true;

    const number = String(offer.number);
    // The user's own follow-up is searched too: "postule", "haute" or a word
    // from a remark are exactly what someone looks for in that box.
    const text = normalizeText([
        offerSearchText(offer),
        statusText(getStatus(number)),
        priorityLabel(getPriority(number)),
        getRemark(number),
    ].filter(Boolean).join(" "));

    return keywords.every(word => text.includes(word));
}

/**
 * Whether one rendered row matches the typed keywords.
 *
 * The offer is the only reliable source: reading the row's text would also
 * match the fixed chrome around it. Rows whose offer is unknown fall back to
 * their text, so nothing disappears silently.
 * @param {HTMLElement} row
 * @param {string} inputId
 * @param {Array<string>} keywords already folded
 * @returns {boolean}
 */
function offerMatchesRow(row, inputId, keywords) {
    const number = row.dataset && row.dataset.number;
    const offer = number ? currentByNumber.get(number) : null;

    if (offer) return offerMatchesKeys(offer, inputId);

    // Last resort: read the row without what repeats on every line. The
    // status menu and the remarks textarea are kept in the DOM, so matching
    // the raw text made "postule" and "favori" match everything.
    const copy = row.cloneNode(true);
    copy.querySelectorAll("select, textarea, button").forEach(el => el.remove());
    const text = normalizeText(copy.textContent);
    return keywords.every(word => text.includes(word));
}

function getOffersForExport() {
    const filter = document.getElementById("statusFilter");
    const statusValue = filter ? filter.value : "";
    // Only the locality is mirrored here, alongside the search box. Mirroring
    // the state filter too would silently drop the deleted offers, which the
    // export kept until now.
    const locationValue = readFilterValue("locationFilter");

    return currentOffers.filter(offer => {
        const number = String(offer.number);
        if (groupFilter === "new" && offer.is_new !== true) return false;
        if (groupFilter === "old" && offer.is_new === true) return false;
        if (statusValue !== "") {
            const status = getStatus(number);
            if (statusValue === "unsorted") {
                if (status !== "") return false;
            } else if (status !== statusValue) {
                return false;
            }
        }
        if (!locationMatches(offer, locationValue)) return false;

        return offerMatchesKeys(offer, "currentSearch");
    });
}

function buildCsv(offers) {
    const header = [
        "Numéro", "Statut", "Remarque", "Nom de l'offre", "Société", "Email",
        "Contrat", "Horaire", "Rémunération", "Lieu",
    ];
    const lines = [header.join(";")];
    offers.forEach(offer => {
        const number = String(offer.number || "");
        lines.push([
            number,
            statusLabel(getStatus(number)),
            getRemark(number).replace(/\r?\n/g, " "),
            offer.offer_title || "",
            offer.company || "",
            offer.email || "",
            offer.contract_type || "",
            offer.schedule || "",
            offer.pay || "",
            offer.location || "",
        ].map(csvField).join(";"));
    });
    return "\uFEFF" + lines.join("\r\n");
}

function downloadCsv(filename, content) {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}


// ============================================================
// SUIVI — l'export / import du suivi est défini dans shared/suivi.js
// (partagé avec le dashboard et la fiche offre)
// ============================================================

function exportCsv() {
    const offers = getOffersForExport();
    const message = document.getElementById("exportMessage");

    const select = document.getElementById("scrapingSelect");
    const option = select && select.selectedOptions[0];
    const base = (option && option.dataset.base) || "annonces";
    const filename = "annonces_" + base + "_" +
        localDateString(new Date()) + ".csv";

    if (!offers.length) {
        if (message) {
            message.textContent = "Aucune annonce à exporter.";
            setTimeout(function () { message.textContent = ""; }, 4000);
        }
        return;
    }

    downloadCsv(filename, buildCsv(offers));
    if (message) {
        message.textContent = offers.length +
            " annonce(s) exportée(s) : " + filename;
        setTimeout(function () { message.textContent = ""; }, 4000);
    }
}


// ============================================================
// STALE SCRAPE ALERT
// ============================================================

const STALE_AFTER_HOURS = 12;

function timeAgoLabel(timestamp) {
    if (!timestamp) return "date inconnue";
    const hours = Math.floor(
        (Date.now() - new Date(timestamp).getTime()) / 3600000
    );
    if (hours < 1) return "il y a moins d'une heure";
    if (hours < 24) return "il y a " + hours + " h";
    const days = Math.floor(hours / 24);
    if (days < 2) return "il y a 1 jour";
    return "il y a " + days + " jours";
}

function maybeShowStaleAlert(data, scrapeDate) {
    if (staleAlertShown || !data) return;
    const t = new Date(scrapeDate).getTime();
    if (isNaN(t)) return;
    const tooOld =
        Date.now() - t > STALE_AFTER_HOURS * 3600 * 1000;
    if (!tooOld) return;

    staleAlertShown = true;

    // « Toutes les recherches » cannot be refreshed as a whole: the scraper
    // works on one search at a time, so the alert only invites the user to
    // pick one.
    const isAll = dataUrl === "all";
    const age = timeAgoLabel(scrapeDate);
    const hint = document.getElementById("staleHint");
    if (hint) {
        hint.innerHTML = isAll
            ? "Dernière mise à jour : <strong>" + age + "</strong>. " +
              "Certaines données sont peut-être obsolètes : sélectionnez un " +
              "scraping précis puis actualisez-le."
            : "Dernière mise à jour : <strong>" + age + "</strong>. " +
              "De nouvelles annonces ont peut-être été publiées depuis : " +
              "actualisez vos scrapps pour les afficher.";
    }

    const refreshBtn = document.getElementById("staleRefreshBtn");
    if (refreshBtn) refreshBtn.style.display = isAll ? "none" : "";

    const modal = document.getElementById("staleModal");
    if (modal) modal.classList.add("visible");
}

function closeStaleAlert() {
    const modal = document.getElementById("staleModal");
    if (modal) modal.classList.remove("visible");
}

function refreshFromStaleAlert() {
    // Same path as the « Actualiser » button next to the last scrape date:
    // confirmation, then the scraping itself.
    closeStaleAlert();
    const button = document.getElementById("refreshScrapeBtn");
    if (button) button.click();
}


// ============================================================
// INITIALIZATION
// ============================================================

function createInfoRow(text, colSpan) {
    const tr = document.createElement("tr");
    tr.className = "info-row";
    const td = document.createElement("td");
    td.colSpan = colSpan || 9;
    td.textContent = text;
    tr.appendChild(td);
    return tr;
}

function extractOffers(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.offers)) return data.offers;
    return [];
}

function showError(tbody, message, colSpan) {
    if (!tbody) {
        console.error(message);
        return;
    }
    tbody.innerHTML = "";
    tbody.appendChild(createInfoRow(message, colSpan));
}

async function loadJsonWithFallback(url, tbody, failureMessage, colSpan) {
    try {
        return await fetchJson(url);
    } catch (e) {
        console.error(e);
        showError(tbody, `${failureMessage} (${e.message})`, colSpan);
        return null;
    }
}

async function reloadTables() {
    const tbodyCurrent = document.getElementById("currentRows");

    if (!dataUrl && dataUrl !== "all") {
        tbodyCurrent.innerHTML = "<tr><td colspan='9' class='no-scraping'>Aucun scraping sélectionné. Choisissez-en un dans le menu.</td></tr>";
        return;
    }

    let offers = [];
    let scrapeDate = "";
    let data = null;

    if (dataUrl === "all") {
        // Fetch all scrapes and merge
        const scrapings = await fetchScrapings();
        if (scrapings && scrapings.length) {
            const allData = await Promise.all(scrapings.map(async s => {
                const d = await fetchJson(s.file);
                return { data: d, timestamp: s.scrape_timestamp, label: s.label };
            }));
            allData.forEach(({ data: d, timestamp }) => {
                if (d) {
                    offers.push(...extractOffers(d));
                    if (timestamp && (!scrapeDate || timestamp > scrapeDate)) scrapeDate = timestamp;
                }
            });
            // Use label from most recent scrape for title
            const mostRecent = allData.reduce((a, b) => a.timestamp > b.timestamp ? a : b, { label: "" });
            data = { label: mostRecent.label || "Toutes les recherches" };
        }
    } else {
        data = await loadJsonWithFallback(
            dataUrl,
            tbodyCurrent,
            "Impossible de charger " + dataUrl
        );

        if (!data) return;

        offers = extractOffers(data);
        scrapeDate = data && data.scrape_timestamp ? data.scrape_timestamp : "";
    }

    currentOffers = offers;
    lastScrapeDate = scrapeDate;
    // The menu lists the places of this scrape, so it follows the selection.
    fillLocationFilter(offers);
    // Store metadata needed for stale alert command generation
    lastData = {
        offers: offers,
        occupation_guid: data && data.occupation_guid,
        location_guid: data && data.location_guid,
        name: data && data.name,
        label: data && data.label
    };

    const keepNumbers = new Set(offers.map(o => String(o.number)));

    currentByNumber = new Map();
    offers.forEach(o => {
        currentByNumber.set(String(o.number), o);
        // Fold the search text here, under the table render, rather than on
        // the first keystroke where it would show as a stall.
        offerSearchText(o);
    });

    cleanTrackedMap(statuses, "statuts", keepNumbers);
    cleanTrackedMap(remarks, "remarques", keepNumbers);
    cleanTrackedMap(favorites, "favoris", keepNumbers);
    cleanTrackedMap(statutDates, "statut_dates", keepNumbers);
    cleanTrackedMap(priorities, "priorites", keepNumbers);
    backfillStatutDates();

    try {
        renderCurrent(offers, scrapeDate);
        applyFilters();
        updateTitle(data);
        renderTrackedAlerts();
    } catch (e) {
        console.error("Rendering error", e);
        showError(
            tbodyCurrent,
            "Erreur lors de l'affichage des annonces : " + e.message
        );
    }
}

async function init() {
    // Under file://, fetch() is blocked by the browser.
    if (window.location.protocol === "file:") {
        showError(
            document.getElementById("currentRows"),
            "Page ouverte directement depuis le disque. Lancez : " +
            "python serveur.py, puis http://localhost:8123/."
        );
        return;
    }

    setupTabs();
    setupNewSearch();
    setupGroupFilterZones();
    setupSortableColumns();
    setupScraperRefresh();
    setupStorageSync();
    // Default sort: most recently published first
    sortTable = "currentRows";
    sortKey = "published_on";
    sortDir = -1;
    updateSortHeaders();
    const exportBtn = document.getElementById("exportCsvBtn");
    if (exportBtn) {
        exportBtn.addEventListener("click", exportCsv);
    }
    const deleteScrapingGearBtn = document.getElementById("deleteScrapingGearBtn");
    if (deleteScrapingGearBtn) {
        deleteScrapingGearBtn.addEventListener("click", function () {
            if (!dataUrl || dataUrl === "all" || !activeBaseName) {
                showSuiviToast("Sélectionnez un scraping précis pour le supprimer.");
                return;
            }
            openDeleteConfirm(activeBaseName);
        });
    }

    setupSuiviActions();

    const closeStaleBtn = document.getElementById("closeStaleBtn");
    if (closeStaleBtn) {
        closeStaleBtn.addEventListener("click", closeStaleAlert);
    }
    const closeStaleFooterBtn = document.getElementById("closeStaleFooterBtn");
    if (closeStaleFooterBtn) {
        closeStaleFooterBtn.addEventListener("click", closeStaleAlert);
    }
    const staleRefreshBtn = document.getElementById("staleRefreshBtn");
    if (staleRefreshBtn) {
        staleRefreshBtn.addEventListener("click", refreshFromStaleAlert);
    }
    const staleModal = document.getElementById("staleModal");
    if (staleModal) {
        staleModal.querySelector(".modal-backdrop")
            .addEventListener("click", closeStaleAlert);
        staleModal.addEventListener("keydown", function (e) {
            if (e.key === "Escape") closeStaleAlert();
        });
    }

    // Delete confirmation modal
    const deleteConfirmModal = document.getElementById("deleteConfirmModal");
    const closeDeleteConfirmBtn = document.getElementById("closeDeleteConfirmBtn");
    const cancelDeleteBtn = document.getElementById("cancelDeleteBtn");
    const confirmDeleteBtn = document.getElementById("confirmDeleteBtn");

    function closeDeleteConfirm() {
        if (deleteConfirmModal) deleteConfirmModal.classList.remove("visible");
    }

    function openDeleteConfirm(scrapingName) {
        document.getElementById("deleteScrapingName").textContent = scrapingName;
        if (deleteConfirmModal) deleteConfirmModal.classList.add("visible");
    }

    if (closeDeleteConfirmBtn) closeDeleteConfirmBtn.addEventListener("click", closeDeleteConfirm);
    if (cancelDeleteBtn) cancelDeleteBtn.addEventListener("click", closeDeleteConfirm);
    if (confirmDeleteBtn) {
        confirmDeleteBtn.addEventListener("click", async function () {
            const nameEl = document.getElementById("deleteScrapingName");
            const name = nameEl ? nameEl.textContent : "";
            if (!name) return;
            closeDeleteConfirm();
            await deleteScraping(name);
        });
    }

    if (deleteConfirmModal) {
        deleteConfirmModal.querySelector(".modal-backdrop")
            .addEventListener("click", closeDeleteConfirm);
        deleteConfirmModal.addEventListener("keydown", function (e) {
            if (e.key === "Escape") closeDeleteConfirm();
        });
    }

    // Relancer le scraping depuis la date de dernière exécution.
    const statDateEl = document.getElementById("statDate");
    if (statDateEl) {
        statDateEl.addEventListener("click", function () {
            if (!dataUrl || dataUrl === "all" || !activeBaseName) {
                showSuiviToast("Sélectionnez un scraping précis pour l'actualiser.");
                return;
            }
            ScraperUi.openConfirm();
        });
    }

    async function deleteScraping(name) {
        try {
            const result = await postJson(API_DELETE_SCRAPING, { name: name });
            if (!result.ok) {
                throw new Error((result.data && result.data.error)
                    || "Erreur lors de la suppression");
            }
            showSuiviToast("Scraping supprimé : " + result.data.moved.join(", "));
            // Refresh scraping selector
            await refreshScrapingSelector();
            // If we were viewing the deleted scrape, switch to "all"
            if (dataUrl === "data_" + name + ".json") {
                const select = document.getElementById("scrapingSelect");
                if (select) select.value = "all";
                dataUrl = "all";
                historyUrl = "";
                setActiveScraping("");
                reloadTables();
            }
        } catch (e) {
            showSuiviToast("Erreur : " + e.message);
        }
    }

    const trackedAlertDismissBtn = document.getElementById("trackedAlertDismissBtn");
    if (trackedAlertDismissBtn) {
        trackedAlertDismissBtn.addEventListener("click", function () {
            dismissTrackedAlerts();
            const panel = document.getElementById("trackedAlertPanel");
            if (panel) {
                panel.classList.add("hidden");
            }
        });
    }

    const trackedAlertToggleBtn = document.getElementById("trackedAlertToggleBtn");
    if (trackedAlertToggleBtn) {
        trackedAlertToggleBtn.addEventListener("click", function () {
            trackedAlertsExpanded = !trackedAlertsExpanded;
            renderTrackedAlerts();
        });
    }

    const followUpAllBtn = document.getElementById("followUpAllBtn");
    if (followUpAllBtn) {
        followUpAllBtn.addEventListener("click", markAllFollowedUp);
    }
    const followUpList = document.getElementById("followUpList");
    if (followUpList) {
        followUpList.addEventListener("click", function (e) {
            const btn = e.target.closest(".follow-up-relance");
            if (!btn) return;
            markFollowedUp(btn.dataset.number);
        });
    }
    const followUpHint = document.getElementById("followUpHint");
    if (followUpHint) {
        followUpHint.textContent =
            "Postulé ou contacté depuis plus de " + FOLLOWUP_DAYS + " jours.";
    }
    refreshFollowUps();

    await setupScrapingSelector();

    const filter = document.getElementById("statusFilter");
    if (filter) {
        filter.value = getStatusFromUrl();
        filter.addEventListener("change", function () {
            applyFilters();
            updateStatusInUrl(filter.value);
        });
    }

    [
        "stateFilter", "locationFilter", "contractFilter", "scheduleFilter",
        "salaryFilter", "dateFilter",
    ].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            select.addEventListener("change", applyFilters);
        }
    });

    ["currentSearch"].forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;

        // The box follows the keyboard whatever event the browser sends:
        // "input" for typing and paste, "keyup" for the keys that edit
        // without emitting a change (arrows, delete, Escape), and "keydown"
        // so a keypress is never ignored. keyup and input both read the
        // value already updated, so the passes converge on one result.
        ["input", "keyup", "keydown"].forEach(type => {
            input.addEventListener(type, applyFilters);
        });
    });

    await reloadTables();
    maybeShowStaleAlert(lastData, lastScrapeDate);
}

document.addEventListener(SUIVI_EVENT, function () {
    reloadStorageMaps();
    backfillStatutDates();
    rerenderTables();
});

document.addEventListener("DOMContentLoaded", init);