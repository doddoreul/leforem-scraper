// ============================================================
// CONFIGURATION
// ============================================================

const DATA_URL = "data.json";
const HISTORY_URL = "historique_supprimees.json";
const API_SCRAPINGS = "/api/scrapings";

const DEFAULT_STORAGE_PREFIX = "forem_electromecanicien_";

let storagePrefix = DEFAULT_STORAGE_PREFIX;

function getStorageKey(suffix) {
    return storagePrefix + suffix;
}

function setActiveScraping(baseName) {
    storagePrefix = baseName
        ? "forem_" + baseName + "_"
        : DEFAULT_STORAGE_PREFIX;
}

const STATUS_OPTIONS = [
    { value: "", label: "—" },
    { value: "interesse", label: "Intéressé" },
    { value: "pas_interesse", label: "Pas intéressé" },
    { value: "postule", label: "Postulé" },
    { value: "contacte", label: "Contacté" },
    { value: "refuse", label: "Refusé" },
    { value: "rdv", label: "RDV prévu" },
];


// ============================================================
// LOCAL STORAGE (statuses)
// ============================================================

function loadStatuses() {
    try {
        const value = localStorage.getItem(getStorageKey("statuts"));
        if (!value) return {};
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
        console.error("Unable to load statuses", e);
        return {};
    }
}

function saveStatuses() {
    try {
        localStorage.setItem(getStorageKey("statuts"), JSON.stringify(statuses));
    } catch (e) {
        console.error("Unable to save statuses", e);
    }
}

function getStatus(number) {
    return statuses[number] || "";
}

function setStatus(number, value) {
    if (value) {
        statuses[number] = value;
    } else {
        delete statuses[number];
    }
    saveStatuses();
}

function cleanStatuses(currentNumbers) {
    let changed = false;
    Object.keys(statuses).forEach(number => {
        if (!currentNumbers.has(number)) {
            delete statuses[number];
            changed = true;
        }
    });
    if (changed) {
        saveStatuses();
    }
}

let statuses = loadStatuses();


// ============================================================
// LOCAL STORAGE (remarks)
// ============================================================

function loadRemarks() {
    try {
        const value = localStorage.getItem(getStorageKey("remarques"));
        if (!value) return {};
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
        console.error("Unable to load remarks", e);
        return {};
    }
}

function saveRemarks() {
    try {
        localStorage.setItem(getStorageKey("remarques"), JSON.stringify(remarks));
    } catch (e) {
        console.error("Unable to save remarks", e);
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
    saveRemarks();
}

function cleanRemarks(currentNumbers) {
    let changed = false;
    Object.keys(remarks).forEach(number => {
        if (!currentNumbers.has(number)) {
            delete remarks[number];
            changed = true;
        }
    });
    if (changed) {
        saveRemarks();
    }
}

let remarks = loadRemarks();


// ============================================================
// LOCAL STORAGE (favorites)
// ============================================================

function loadFavorites() {
    try {
        const value = localStorage.getItem(getStorageKey("favoris"));
        if (!value) return {};
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
        console.error("Unable to load favorites", e);
        return {};
    }
}

function saveFavorites() {
    try {
        localStorage.setItem(getStorageKey("favoris"), JSON.stringify(favorites));
    } catch (e) {
        console.error("Unable to save favorites", e);
    }
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
    saveFavorites();
}

function cleanFavorites(currentNumbers) {
    let changed = false;
    Object.keys(favorites).forEach(number => {
        if (!currentNumbers.has(number)) {
            delete favorites[number];
            changed = true;
        }
    });
    if (changed) {
        saveFavorites();
    }
}

let favorites = loadFavorites();


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

function createOfferLink(offer) {
    const link = document.createElement("a");
    link.href = offer.url || "#";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = offer.offer_title || "(Sans titre)";
    link.addEventListener("click", function () {
        markClickedRow(link);
    });
    return link;
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

    const title = createOfferLink(offer);
    container.appendChild(title);

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
    });

    td.appendChild(button);
    return td;
}

function createNotesCell(number) {
    const td = document.createElement("td");
    td.className = "notes-cell";

    const textarea = document.createElement("textarea");
    textarea.rows = 5;
    textarea.placeholder = "…";
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

    [
        ["Contrat", values.contract_type],
        ["Horaire", values.schedule],
        ["Rémunération", values.pay],
        ["Salaire", values.salary],
    ].forEach(([labelText, value]) => {
        if (!value) return;
        const line = document.createElement("div");
        line.className = "detail-line";

        const label = document.createElement("span");
        label.className = "detail-label";
        label.textContent = labelText + ": ";
        line.appendChild(label);

        line.appendChild(document.createTextNode(value));
        td.appendChild(line);
    });

    return td;
}

function createCurrentRow(offer) {
    const number = String(offer.number);
    const tr = document.createElement("tr");
    tr.dataset.number = number;
    tr.dataset.isNew = offer.is_new === true ? "true" : "false";

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

    tr.appendChild(textCell([document.createTextNode(offer.published_on || "")], "col-published"));
    tr.appendChild(textCell([document.createTextNode(number)], "col-forem-id"));
    tr.appendChild(textCell([createDescriptionBlock(offer)], "col-offer"));
    tr.appendChild(textCell([document.createTextNode(offer.company || "")], "col-company"));
    tr.appendChild(createDetailsCell(offer));
    tr.appendChild(textCell([document.createTextNode(offer.location || "")], "col-location"));
    tr.appendChild(createNotesCell(number));

    return tr;
}

function createSeparationRow(text) {
    const row = document.createElement("tr");
    row.className = "separation-row";
    row.dataset.separation = "true";

    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.textContent = text;

    row.appendChild(cell);
    return row;
}

function createDeletedRow(offer) {
    const tr = document.createElement("tr");
    tr.dataset.number = String(offer.number);

    const textCell = (nodes, className) => {
        const td = document.createElement("td");
        td.className = className;
        nodes.forEach(node => td.appendChild(node));
        return td;
    };

    tr.appendChild(createStarCell(String(offer.number)));
    tr.appendChild(textCell([document.createTextNode(String(offer.number))], "col-forem-id"));
    tr.appendChild(textCell([createOfferLink(offer)], "col-offer"));
    tr.appendChild(textCell([document.createTextNode(offer.company || "")], "col-company"));
    tr.appendChild(createDetailsCell(offer));
    tr.appendChild(textCell([document.createTextNode(offer.location || "")], "col-location"));
    tr.appendChild(textCell([document.createTextNode(formatDate(offer.removed_on))], "col-removed-on"));
    tr.appendChild(createNotesCell(String(offer.number)));

    return tr;
}

function renderCurrent(offers, scrapeDate) {
    const newOffers = offers.filter(o => o.is_new === true);
    const olderOffers = offers.filter(o => o.is_new !== true);

    document.getElementById("statTotal").textContent = offers.length;
    document.getElementById("statNew").textContent = newOffers.length;
    document.getElementById("statOld").textContent = olderOffers.length;
    document.getElementById("statDate").textContent = scrapeDate ? formatDate(scrapeDate) : "—";

    const tbody = document.getElementById("currentRows");
    tbody.innerHTML = "";

    if (offers.length === 0) {
        tbody.appendChild(createInfoRow("Aucune annonce trouvée."));
        return;
    }

    if (newOffers.length > 0) {
        tbody.appendChild(createSeparationRow(`Nouvelles annonces (${newOffers.length})`));
        newOffers.forEach(offer => tbody.appendChild(createCurrentRow(offer)));
    }

    if (olderOffers.length > 0) {
        tbody.appendChild(createSeparationRow(`Anciennes annonces (${olderOffers.length})`));
        olderOffers.forEach(offer => tbody.appendChild(createCurrentRow(offer)));
    }
}

function renderDeleted(offers) {
    const tbody = document.getElementById("deletedRows");
    tbody.innerHTML = "";

    const counter = document.getElementById("statDeleted");
    if (counter) {
        counter.textContent = String(offers.length);
    }

    const sorted = offers.slice().sort((a, b) => {
        const aTime = new Date(a.removed_on || "1970-01-01T00:00:00").getTime();
        const bTime = new Date(b.removed_on || "1970-01-01T00:00:00").getTime();
        return bTime - aTime;
    });

    if (sorted.length === 0) {
        tbody.appendChild(createInfoRow("Aucune annonce supprimée.", 8));
        return;
    }

    sorted.forEach(offer => tbody.appendChild(createDeletedRow(offer)));
}


// ============================================================
// DISPLAY HELPERS
// ============================================================

function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    const p = n => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}


// ============================================================
// FILTERS (STATUS + SEARCH)
// ============================================================

function normalizeText(text) {
    return (text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

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

function applyFilters() {
    const filter = document.getElementById("statusFilter");
    const statusValue = filter ? filter.value : "";

    applyFiltersToTable(
        "currentRows",
        "currentSearch",
        function (row) {
            if (groupFilter === "new" && row.dataset.isNew !== "true") return false;
            if (groupFilter === "old" && row.dataset.isNew !== "false") return false;
            if (statusValue === "") return true;
            const status = getStatus(String(row.dataset.number));
            if (statusValue === "unsorted") return status === "";
            return status === statusValue;
        }
    );

    applyFiltersToTable("deletedRows", "deletedSearch", function () {
        return true;
    });
}

function applyFiltersToTable(tbodyId, searchId, otherFiltersPass) {
    const tbody = document.getElementById(tbodyId);
    const input = document.getElementById(searchId);
    const keywords = input ? getKeywords(input.value) : [];

    const rows = Array.from(tbody.children);

    // Split the tbody into groups delimited by separation rows.
    let currentGroup = [];
    const groups = [];

    rows.forEach(row => {
        if (row.dataset && row.dataset.separation === "true") {
            groups.push({ separation: row, rows: currentGroup });
            currentGroup = [];
        } else {
            currentGroup.push(row);
        }
    });
    groups.push({ separation: null, rows: currentGroup });

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
                const text = normalizeText(row.textContent);
                shown = keywords.every(word => text.includes(word));
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
            const target = this.dataset.target;

            buttons.forEach(b => {
                const active = b === this;
                b.classList.toggle("active", active);
                b.setAttribute("aria-selected", active ? "true" : "false");
            });

            document.getElementById("tab-current").classList.toggle(
                "hidden", target !== "current"
            );
            document.getElementById("tab-deleted").classList.toggle(
                "hidden", target !== "deleted"
            );
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

    document.getElementById("newSearchBtn").addEventListener(
        "click", openModal
    );
    document.getElementById("closeModalBtn").addEventListener(
        "click", closeModal
    );
    document.getElementById("cancelModalBtn").addEventListener(
        "click", closeModal
    );
    modal.querySelector(".modal-backdrop").addEventListener("click", closeModal);
    document.getElementById("copyCommandBtn").addEventListener(
        "click", copyCommand
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
    selectedOccupation = null;
    selectedLocation = null;
    clearSuggestions("occupationSuggestions");
    clearSuggestions("locationSuggestions");
    document.getElementById("occupationInput").value = "";
    document.getElementById("locationInput").value = "";
    document.getElementById("scrapeStatus").textContent = "";
    document.getElementById("commandBox").value = "";
    document.getElementById("copyCommandBtn").disabled = true;
    updateConfirmation();
    const modal = document.getElementById("searchModal");
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
    const ready = selectedOccupation && selectedLocation;
    document.getElementById("commandBox").value = ready
        ? buildCommand() : "";
    document.getElementById("copyCommandBtn").disabled = !ready;
}

function buildCommand() {
    if (!selectedOccupation || !selectedLocation) return "";
    const slug = slugify(selectedOccupation.value + " " + selectedLocation.label);
    const label = selectedOccupation.value + " / " + selectedLocation.label;
    return "python scraper.py --fresh --occupation-guid " + selectedOccupation.key +
        " --location-guid " + selectedLocation.key +
        " --base " + slug +
        " --label \"" + label + "\"";
}

function slugify(text) {
    return normalizeText(text)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

async function copyCommand() {
    const command = document.getElementById("commandBox").value;
    const status = document.getElementById("scrapeStatus");
    if (!command) return;
    try {
        await navigator.clipboard.writeText(command);
        status.textContent = "Commande copiée. Colle-la dans le terminal, " +
            "dans le dossier leforem-scraper.";
    } catch (e) {
        const box = document.getElementById("commandBox");
        box.select();
        document.execCommand("copy");
        status.textContent = "Commande copiée.";
    }
}


// ============================================================
// SCRAPING SELECTOR
// ============================================================

let dataUrl = DATA_URL;
let historyUrl = HISTORY_URL;

function setupScrapingSelector() {
    const select = document.getElementById("scrapingSelect");
    if (!select) return Promise.resolve();
    return fetch(API_SCRAPINGS, { cache: "no-store" })
        .then(response => {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.json();
        })
        .then(list => {
            const stored = localStorage.getItem("forem_scraping_select");
            list.forEach(item => {
                const option = document.createElement("option");
                option.value = item.file;
                option.dataset.history = item.history;
                option.dataset.base = item.name;
                option.textContent = item.name !== ""
                    ? (item.label || item.name)
                    : (item.label || "Default (" + item.file + ")");
                option.selected =
                    item.file === stored || item.file === dataUrl;
                select.appendChild(option);
            });
            const active = list.find(item => item.file === stored);
            if (active) {
                dataUrl = active.file;
                historyUrl = active.history;
                setActiveScraping(active.name || "");
            }
            select.addEventListener("change", switchScraping);
        })
        .catch(e => {
            console.error("Unable to list scrapings", e);
        });
}

function switchScraping(e) {
    const option = e.target.selectedOptions[0];
    if (!option || !option.value) return;
    dataUrl = option.value;
    historyUrl = option.dataset.history || HISTORY_URL;
    setActiveScraping(option.dataset.base || "");
    localStorage.setItem("forem_scraping_select", option.value);
    resetGroupFilter();
    reloadTables();
}

function updateTitle(data) {
    const label = data && typeof data.label === "string"
        ? data.label.trim() : "";
    const title = label
        ? "Offres Forem — " + label
        : "Offres Forem — Électromécanicien industriel";
    document.getElementById("mainTitle").textContent = title;
    document.title = title;
}


// ============================================================
// CSV EXPORT
// ============================================================

let currentOffers = [];

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

function localDateString(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
}

function offerMatchesKeys(offer, inputId) {
    const input = document.getElementById(inputId);
    if (!input) return true;
    const keywords = getKeywords(input.value);
    if (!keywords.length) return true;
    const text = normalizeText([
        offer.number,
        offer.published_on,
        offer.offer_title,
        offer.company,
        offer.contract_type,
        offer.schedule,
        offer.pay,
        offer.location,
    ].filter(Boolean).join(" "));
    return keywords.every(word => text.includes(word));
}

function getOffersForExport() {
    const filter = document.getElementById("statusFilter");
    const statusValue = filter ? filter.value : "";

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
        return offerMatchesKeys(offer, "currentSearch");
    });
}

function buildCsv(offers) {
    const header = [
        "Numéro", "Statut", "Remarque", "Nom de l'offre", "Société",
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

async function loadJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${url}`);
    }
    return response.json();
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
        return await loadJson(url);
    } catch (e) {
        console.error(e);
        showError(tbody, `${failureMessage} (${e.message})`, colSpan);
        return null;
    }
}

async function reloadTables() {
    const tbodyCurrent = document.getElementById("currentRows");
    const tbodyDeleted = document.getElementById("deletedRows");

    const data = await loadJsonWithFallback(
        dataUrl,
        tbodyCurrent,
        "Impossible de charger " + dataUrl
    );

    const history = await loadJsonWithFallback(
        historyUrl,
        tbodyDeleted,
        "Impossible de charger " + historyUrl,
        7
    );

    if (!data) {
        return;
    }

    const offers = extractOffers(data);
    const deleted = history ? extractOffers(history) : [];
    const scrapeDate = data && data.scrape_timestamp
        ? data.scrape_timestamp : "";

    currentOffers = offers;

    const currentNumbers = new Set(offers.map(o => String(o.number)));
    cleanStatuses(currentNumbers);
    cleanRemarks(currentNumbers);
    cleanFavorites(currentNumbers);

    try {
        renderCurrent(offers, scrapeDate);
        renderDeleted(deleted);
        applyFilters();
        updateTitle(data);
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
    const exportBtn = document.getElementById("exportCsvBtn");
    if (exportBtn) {
        exportBtn.addEventListener("click", exportCsv);
    }
    await setupScrapingSelector();

    const filter = document.getElementById("statusFilter");
    if (filter) {
        filter.value = getStatusFromUrl();
        filter.addEventListener("change", function () {
            applyFilters();
            updateStatusInUrl(filter.value);
        });
    }

    ["currentSearch", "deletedSearch"].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener("input", applyFilters);
        }
    });

    await reloadTables();
}

document.addEventListener("DOMContentLoaded", init);