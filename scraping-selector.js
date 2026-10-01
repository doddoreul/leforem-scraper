/* ============================================================
   SCRAPING SELECTOR — shared component for index.html & insights.html
   ============================================================ */

const API_SCRAPINGS = "/api/scrapings";
const STORAGE_KEY = "forem_scraping_select";

// Un contexte par <select> : il permet de reconstruire la liste après la
// création d'une recherche sans réattacher un second écouteur.
const contexts = {};

async function fetchScrapings() {
    try {
        const response = await fetch(API_SCRAPINGS, { cache: "no-store" });
        if (response.ok) return await response.json();
    } catch (e) {
        console.error("Unable to list scrapings", e);
    }
    return [];
}

function buildOptions(select, scrapings, allowAll, allowCreate) {
    select.innerHTML = "";

    if (allowAll) {
        const allOpt = document.createElement("option");
        allOpt.value = "all";
        allOpt.textContent = "Toutes les recherches";
        select.appendChild(allOpt);
    }

    scrapings.forEach(function (item) {
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
}

/**
 * Create a unified scraping selector.
 * @param {Object} options
 *   - selectId: ID of the <select> element
 *   - allowAll: whether to show "Toutes les recherches" (default: true)
 *   - allowCreate: whether to show "Creer un nouveau scrap" (default: true)
 *   - onChange: callback(selectedScrape, allScrapes)
 * @returns {Promise<Object>} { select, scrapings, current }
 */
async function createScrapingSelector(options) {
    const {
        selectId,
        allowAll = true,
        allowCreate = true,
        onChange = function () {}
    } = options;

    const select = document.getElementById(selectId);
    if (!select) return { select: null, scrapings: [], current: null };

    const scrapings = await fetchScrapings();
    const context = { select, allowAll, allowCreate, onChange, scrapings, current: "all" };
    contexts[selectId] = context;

    buildOptions(select, scrapings, allowAll, allowCreate);

    // Restore selection
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && scrapings.some(function (s) { return s.file === stored; })) {
        select.value = stored;
        context.current = stored;
    } else if (allowAll) {
        select.value = "all";
    } else if (scrapings.length) {
        select.value = scrapings[0].file;
        context.current = scrapings[0].file;
    }

    select.addEventListener("change", function () {
        const option = select.selectedOptions[0];
        if (!option || !option.value) return;

        if (option.value === "__create_new__") {
            // Trigger create modal via custom event
            document.dispatchEvent(new CustomEvent("foremCreateScrape"));
            // Reset to previous
            select.value = context.current;
            return;
        }

        context.current = option.value;
        localStorage.setItem(STORAGE_KEY, context.current);
        context.onChange(context.current, context.scrapings);
    });

    return { select, scrapings, current: context.current };
}

/**
 * Re-read the scraping list (after a scraping was created) and apply the
 * stored selection. onChange is called so the page can reload its data.
 * @param {String} selectId
 * @returns {Promise<Object|null>} { select, scrapings, current }
 */
async function refreshScrapingSelector(selectId) {
    const context = contexts[selectId];
    if (!context) return null;

    const { select, allowAll, allowCreate } = context;
    context.scrapings = await fetchScrapings();
    buildOptions(select, context.scrapings, allowAll, allowCreate);

    const stored = localStorage.getItem(STORAGE_KEY);
    const previous = context.current;
    let next = "all";
    if (stored && context.scrapings.some(function (s) { return s.file === stored; })) {
        next = stored;
    } else if (!allowAll && context.scrapings.length) {
        next = context.scrapings[0].file;
    }
    select.value = next;
    context.current = next;

    if (next !== previous || stored === next) {
        context.onChange(next, context.scrapings);
    }
    return { select, scrapings: context.scrapings, current: next };
}

/**
 * Get the current scrape data for a given key.
 * @param {Array} scrapings
 * @param {string} key -- "all", "__create_new__", or a file name
 * @returns {Object|null}
 */
function getScrapingByKey(scrapings, key) {
    if (key === "all" || key === "__create_new__") return null;
    return scrapings.find(function (s) { return s.file === key; }) || null;
}

/**
 * Filter an array of scrapings by the current scope.
 * @param {Array} scrapings
 * @param {string} scope -- "all" or a file name
 * @returns {Array}
 */
function filterScrapings(scrapings, scope) {
    if (scope === "all") return scrapings;
    return scrapings.filter(function (s) { return s.file === scope; });
}

// Expose globally for non-module scripts
window.ScrapingSelector = {
    createScrapingSelector: createScrapingSelector,
    refreshScrapingSelector: refreshScrapingSelector,
    getScrapingByKey: getScrapingByKey,
    filterScrapings: filterScrapings,
    STORAGE_KEY: STORAGE_KEY
};