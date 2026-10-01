// ============================================================
// LOCAL STORAGE — the follow-up data (statuses, remarks, favourites,
// priorities, status dates) is kept in the browser, one key per
// scraping: forem_<search>_<suffix>
// ============================================================

export const LEGACY_STORAGE_PREFIX = "forem_electromecanicien_";
export const DEFAULT_SCRAPING_PREFIX = "forem_fb3c1045-38215355_";

/** The suffixes that make up a follow-up, in the order they are read. */
export const TRACKED_SUFFIXES = [
    "statuts",
    "statut_dates",
    "remarques",
    "favoris",
    "priorites",
];

const TRACKED_PLAIN_KEYS = ["forem_scraping_select"];
const TRACKED_KEY_PATTERN = /^forem_.+_(statuts|remarques|favoris|statut_dates|priorites)$/;
const MIGRATION_FLAG = "forem_migration_v2_done";

/**
 * The localStorage prefix of a search.
 * @param {string} baseName "" for the default search
 * @returns {string}
 */
export function storagePrefixFor(baseName) {
    return baseName ? "forem_" + baseName + "_" : LEGACY_STORAGE_PREFIX;
}

/**
 * Is this key part of a follow-up (and therefore worth exporting)?
 * @param {string} key
 * @returns {boolean}
 */
export function isTrackedStorageKey(key) {
    return TRACKED_KEY_PATTERN.test(key) ||
        TRACKED_PLAIN_KEYS.indexOf(key) !== -1;
}

/**
 * Read a JSON map stored under <prefix><suffix>.
 * @param {string} prefix
 * @param {string} suffix
 * @returns {Object} {} when missing or unreadable
 */
export function readTrackedMap(prefix, suffix) {
    try {
        const raw = localStorage.getItem(prefix + suffix);
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        return {};
    }
}

/**
 * Write a JSON map under <prefix><suffix>.
 * @param {string} prefix
 * @param {string} suffix
 * @param {*} value
 */
export function writeTrackedMap(prefix, suffix, value) {
    try {
        localStorage.setItem(prefix + suffix, JSON.stringify(value));
    } catch (error) {
        console.error("Unable to write localStorage", error);
    }
}

/**
 * Move the follow-up of the very first search to its GUID-based key.
 * Runs once per browser profile, before any page reads the keys.
 */
export function migrateLegacyStorage() {
    try {
        if (localStorage.getItem(MIGRATION_FLAG)) return;

        TRACKED_SUFFIXES.forEach(function (suffix) {
            const oldKey = LEGACY_STORAGE_PREFIX + suffix;
            const newKey = DEFAULT_SCRAPING_PREFIX + suffix;
            const oldValue = localStorage.getItem(oldKey);
            if (oldValue && !localStorage.getItem(newKey)) {
                localStorage.setItem(newKey, oldValue);
            }
        });

        localStorage.setItem(MIGRATION_FLAG, "1");
    } catch (error) {
        // Storage unavailable (private mode): nothing to migrate.
    }
}