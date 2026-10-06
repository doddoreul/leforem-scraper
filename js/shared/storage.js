// ============================================================
// TRACKING STORAGE — the backend is the source of truth
//
// The follow-up (statuses, remarks, favourites, priorities, status
// dates) lives in SQLite (or JSON) behind /api/tracking. localStorage
// is only a mirror: it seeds the backend once, then follows it.
//
// The pages call readTrackedMap synchronously while rendering, so
// reads come from an in-memory cache that is loaded at startup and
// refreshed after every write. Writes go to the backend first, then
// to localStorage, then update the cache.
//
//     forem_<search>_statuts       { offerId: "postule" }
//     forem_<search>_statut_dates  { offerId: "2026-01-01T..." }
//     forem_<search>_remarques     { offerId: "text" }
//     forem_<search>_favoris       { offerId: true }
//     forem_<search>_priorites     { offerId: 2 }
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

/** Dispatched once the follow-up has been loaded from the backend. */
export const TRACKING_LOADED_EVENT = "foremtrackingloaded";

/** localStorage suffix -> field name used by the tracking API. */
export const SUFFIX_FIELD = {
    statuts: "statut",
    statut_dates: "statut_date",
    remarques: "remarque",
    favoris: "favori",
    priorites: "priorite",
};

// forem_profil is the candidate profile: it is one whole document rather than
// a map of offers, so it travels with the tracking export but is NOT pushed
// to /api/tracking (the import/migration paths only match the per-offer keys).
const TRACKED_PLAIN_KEYS = ["forem_scraping_select", "forem_profil"];
const TRACKED_KEY_PATTERN = /^forem_.+_(statuts|remarques|favoris|statut_dates|priorites)$/;
const MIGRATION_FLAG = "forem_migration_v2_done";
const SYNCED_FLAG = "forem_tracking_synced";

/**
 * The localStorage prefix of a search.
 * @param {string} baseName "" for the default search
 * @returns {string}
 */
export function storagePrefixFor(baseName) {
    return baseName ? "forem_" + baseName + "_" : LEGACY_STORAGE_PREFIX;
}

/**
 * The search name a localStorage prefix belongs to.
 * @param {string} prefix
 * @returns {string}
 */
export function baseNameForPrefix(prefix) {
    if (!prefix || prefix.length < 7) return "";
    return prefix.slice("forem_".length, -1);
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

/** Searches whose data is already cached: { baseName: { offerId: fields } } */
const _cache = {};

/**
 * Read a JSON map stored under <prefix><suffix>.
 *
 * Serves from the backend cache when that search is loaded, and from
 * localStorage otherwise (before startup, or when the server is down).
 * @param {string} prefix
 * @param {string} suffix
 * @returns {Object}
 */
export function readTrackedMap(prefix, suffix) {
    const baseName = baseNameForPrefix(prefix);
    if (baseName && Object.prototype.hasOwnProperty.call(_cache, baseName)) {
        return suffixFromCache(_cache[baseName], suffix);
    }
    try {
        const raw = localStorage.getItem(prefix + suffix);
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        return {};
    }
}

/**
 * Build one <suffix> map out of the cached fields.
 * @param {Object} entries { offerId: fields }
 * @param {string} suffix
 * @returns {Object}
 */
function suffixFromCache(entries, suffix) {
    const field = SUFFIX_FIELD[suffix];
    const out = {};
    if (!field) return out;
    Object.keys(entries).forEach(function (offerId) {
        const value = (entries[offerId] || {})[field];
        if (value === null || value === undefined || value === "") return;
        out[offerId] = suffix === "favoris" ? !!value : value;
    });
    return out;
}

// -- backend ------------------------------------------------------

function apiPath(baseName, offerId) {
    let path = "/api/tracking/" + encodeURIComponent(baseName);
    if (offerId) path += "/" + encodeURIComponent(offerId);
    return path;
}

/**
 * Read the whole follow-up of a search from the backend.
 * @param {string} baseName
 * @returns {Promise<Object>} {} when the backend is unreachable
 */
export async function fetchTracking(baseName) {
    try {
        const response = await fetch(apiPath(baseName));
        if (!response.ok) return {};
        return await response.json();
    } catch (error) {
        return {};
    }
}

/**
 * Write one field of one offer. A null value clears it.
 * @param {string} baseName
 * @param {string} offerId
 * @param {string} field one of the values of SUFFIX_FIELD
 * @param {*} value
 * @returns {Promise<boolean>}
 */
export async function pushTracking(baseName, offerId, field, value) {
    const payload = {};
    payload[field] = value === undefined ? null : value;
    try {
        const response = await fetch(apiPath(baseName, offerId), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

/**
 * Delete the follow-up of one offer.
 * @param {string} baseName
 * @param {string} offerId
 * @returns {Promise<boolean>}
 */
export async function deleteOfferTracking(baseName, offerId) {
    try {
        const response = await fetch(apiPath(baseName, offerId), {
            method: "DELETE",
        });
        return response.ok;
    } catch (error) {
        return false;
    }
}

/**
 * Load one search into the cache and mirror it to localStorage.
 * @param {string} baseName
 * @returns {Promise<Object>}
 */
export async function loadTracking(baseName) {
    const data = await fetchTracking(baseName);
    // An empty answer is still authoritative: it means "no follow-up yet"
    // and must stop the reads from falling back to a stale localStorage.
    _cache[baseName] = data && typeof data === "object" ? data : {};
    mirrorToLocalStorage(baseName, _cache[baseName]);
    return _cache[baseName];
}

/**
 * Load every search found in localStorage into the cache.
 * @returns {Promise<void>}
 */
export async function loadAllTracking() {
    const bases = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const match = key.match(
            /^forem_(.+)_(statuts|remarques|favoris|statut_dates|priorites)$/
        );
        if (match) bases[match[1]] = true;
    }
    await Promise.all(Object.keys(bases).map(loadTracking));
}

/**
 * Copy the cached fields back into the localStorage mirror.
 * @param {string} baseName
 * @param {Object} entries
 */
function mirrorToLocalStorage(baseName, entries) {
    const prefix = storagePrefixFor(baseName);
    TRACKED_SUFFIXES.forEach(function (suffix) {
        const map = suffixFromCache(entries, suffix);
        try {
            localStorage.setItem(prefix + suffix, JSON.stringify(map));
        } catch (error) {
            console.error("Unable to mirror tracking", error);
        }
    });
}

// -- writes -------------------------------------------------------

/**
 * Write one field of one offer, to the backend then to the mirror.
 * @param {string} baseName
 * @param {string} offerId
 * @param {string} field
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function writeOfferField(baseName, offerId, field, value) {
    // The cache and the mirror are updated first, without waiting for the
    // network: the callers render right after, so a deferred cache update
    // would show the previous value.
    if (!Object.prototype.hasOwnProperty.call(_cache, baseName)) {
        _cache[baseName] = {};
    }
    const entry = _cache[baseName][offerId] || {};
    entry[field] = value;
    _cache[baseName][offerId] = entry;
    mirrorToLocalStorage(baseName, _cache[baseName]);

    const ok = await pushTracking(baseName, offerId, field, value);
    if (!ok) {
        // The server is down. The edit stays in the mirror so the session
        // is not lost, and the one-shot sync pushes it on the next load.
        console.warn("Tracking not persisted to the backend", field);
    }
}

/**
 * Write a JSON map under <prefix><suffix>, backend first.
 * @param {string} prefix
 * @param {string} suffix
 * @param {*} value
 * @returns {Promise<void>}
 */
export async function writeTrackedMap(prefix, suffix, value) {
    const baseName = baseNameForPrefix(prefix);
    const field = SUFFIX_FIELD[suffix];
    const map = value && typeof value === "object" ? value : {};

    try {
        localStorage.setItem(prefix + suffix, JSON.stringify(map));
    } catch (error) {
        console.error("Unable to write localStorage", error);
    }

    if (!baseName || !field) return;

    const known = Object.prototype.hasOwnProperty.call(_cache, baseName)
        ? suffixFromCache(_cache[baseName], suffix)
        : {};

    // Only the offers that actually changed are sent: the callers pass the
    // whole map after editing a single entry.
    const ids = Object.keys(map);
    for (const offerId of ids) {
        if (map[offerId] !== known[offerId]) {
            await writeOfferField(baseName, offerId, field, map[offerId]);
        }
    }
    for (const offerId of Object.keys(known)) {
        if (!(offerId in map)) {
            await writeOfferField(baseName, offerId, field, null);
        }
    }
}

// -- migration ----------------------------------------------------

/**
 * Push an existing localStorage follow-up to the backend, once.
 * @returns {Promise<number>} the number of offers mirrored
 */
export async function migrateLocalStorageToBackend() {
    const bases = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const match = key.match(
            /^forem_(.+)_(statuts|remarques|favoris|statut_dates|priorites)$/
        );
        if (!match) continue;
        const baseName = match[1];
        const suffix = match[2];
        if (!bases[baseName]) bases[baseName] = {};
        bases[baseName][suffix] = readTrackedMap(
            "forem_" + baseName + "_", suffix
        );
    }

    let mirrored = 0;
    for (const baseName of Object.keys(bases)) {
        const byOffer = {};
        TRACKED_SUFFIXES.forEach(function (suffix) {
            const field = SUFFIX_FIELD[suffix];
            const map = bases[baseName][suffix] || {};
            Object.keys(map).forEach(function (offerId) {
                if (!byOffer[offerId]) byOffer[offerId] = {};
                byOffer[offerId][field] = map[offerId];
            });
        });
        for (const offerId of Object.keys(byOffer)) {
            const fields = byOffer[offerId];
            const keys = Object.keys(fields);
            for (const field of keys) {
                await pushTracking(baseName, offerId, field, fields[field]);
            }
            mirrored++;
        }
    }

    try {
        localStorage.setItem(SYNCED_FLAG, "1");
    } catch (error) {
        // Storage unavailable.
    }
    await loadAllTracking();
    return mirrored;
}

/**
 * Import an exported follow-up into the backend.
 *
 * The data goes straight to the backend rather than through localStorage:
 * writing to localStorage would be ignored by the reads (they serve the
 * cache) and migrateLocalStorageToBackend would then push the *stale* cache
 * over the import. The cache is reloaded from the backend afterwards, which
 * is authoritative, and localStorage follows as a mirror.
 * @param {Object} data { "forem_<base>_<suffix>": { offerId: value } }
 * @returns {Promise<number>} the number of offers imported
 */
export async function importTrackedData(data) {
    if (!data || typeof data !== "object") return 0;

    // Group by search and offer, so one offer is sent in a single request.
    const byBase = {};
    let imported = 0;

    Object.keys(data).forEach(function (key) {
        if (!isTrackedStorageKey(key)) return;
        const match = key.match(
            /^forem_(.+)_(statuts|remarques|favoris|statut_dates|priorites)$/
        );
        if (!match) return;
        const field = SUFFIX_FIELD[match[2]];
        const values = data[key];
        if (!field || !values || typeof values !== "object") return;
        if (!byBase[match[1]]) byBase[match[1]] = {};
        Object.keys(values).forEach(function (offerId) {
            if (!byBase[match[1]][offerId]) byBase[match[1]][offerId] = {};
            byBase[match[1]][offerId][field] = values[offerId];
        });
    });

    for (const baseName of Object.keys(byBase)) {
        const offers = byBase[baseName];
        for (const offerId of Object.keys(offers)) {
            const fields = offers[offerId];
            for (const field of Object.keys(fields)) {
                await pushTracking(baseName, offerId, field, fields[field]);
            }
            imported++;
        }
    }

    // The backend now holds the import: refresh the cache from it.
    await loadAllTracking();
    return imported;
}

/**
 * Startup path: move the legacy keys, seed the backend once, then load
 * the cache. Safe to call on every page load.
 * @returns {Promise<void>}
 */
export async function migrateLegacyStorage() {
    try {
        if (!localStorage.getItem(MIGRATION_FLAG)) {
            TRACKED_SUFFIXES.forEach(function (suffix) {
                const oldKey = LEGACY_STORAGE_PREFIX + suffix;
                const newKey = DEFAULT_SCRAPING_PREFIX + suffix;
                const oldValue = localStorage.getItem(oldKey);
                if (oldValue && !localStorage.getItem(newKey)) {
                    localStorage.setItem(newKey, oldValue);
                }
            });
            localStorage.setItem(MIGRATION_FLAG, "1");
        }
    } catch (error) {
        // Storage unavailable (private mode).
    }

    try {
        if (!localStorage.getItem(SYNCED_FLAG)) {
            await migrateLocalStorageToBackend();
        }
    } catch (error) {
        // Fall through to the plain load.
    }

    await loadAllTracking();

    // The pages render before this resolves, so tell them the follow-up is
    // now the backend's: the renders that happened on the localStorage
    // fallback are refreshed.
    document.dispatchEvent(
        new CustomEvent(TRACKING_LOADED_EVENT, { detail: { base: "" } })
    );
}

/**
 * Load one search's follow-up into the cache.
 * Called when the user switches search.
 * @param {string} baseName
 * @returns {Promise<void>}
 */
export async function refreshTracking(baseName) {
    await loadTracking(baseName);
}
