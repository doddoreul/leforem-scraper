// ============================================================
// PROFILE — the single candidate profile
//
// One profile for the whole app (not one per search). It is stored
// in the database like the follow-up, under the key forem_profil,
// and mirrored in localStorage so it travels with the tracking
// export/import.
//
// Reading is deliberately tolerant: unavailable storage, invalid
// JSON or an unknown version all give an empty profile instead of
// throwing, so the page always renders.
// ============================================================

export const PROFILE_KEY = "forem_profil";
export const PROFILE_URL = "/api/profil";
export const PROFILE_VERSION = 1;

/** Contract types offered when no offer data is available yet. */
export const FALLBACK_CONTRACT_TYPES = [
    "CDI",
    "CDD",
    "Intérim",
    "Indépendant",
    "Étudiant",
    "Stage",
];

/** Hourly gross rate bounds, in euros. */
const RATE_MIN_EXCLUSIVE = 0;
const RATE_MAX = 200;

/** Maximum home-to-work distance, in kilometres. */
const DISTANCE_MIN = 0;
const DISTANCE_MAX = 500;

/**
 * A profile with every field empty. A partial profile is valid.
 * @returns {Object}
 */
export function emptyProfile() {
    return {
        version: PROFILE_VERSION,
        keywordsText: "",
        keywords: [],
        hourlyRate: null,
        contractTypes: [],
        maxDistanceKm: null,
        updatedAt: "",
    };
}

/**
 * Split the free-text keywords on commas or newlines, trim them, drop the
 * empties and remove the duplicates. Comparison ignores case and accents,
 * but the first spelling encountered is the one kept.
 * @param {string} text
 * @returns {Array<string>}
 */
export function parseKeywords(text) {
    const raw = String(text || "");
    if (raw.trim() === "") return [];

    const seen = Object.create(null);
    const out = [];
    raw.split(/[,\n\r]+/).forEach(function (part) {
        const value = part.trim();
        if (value === "") return;
        const key = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        if (seen[key]) return;
        seen[key] = true;
        out.push(value);
    });
    return out;
}

/**
 * Fill the missing fields of a stored payload so the page never has to
 * check for undefined. An unknown version reads as an empty profile.
 * @param {*} raw
 * @returns {Object}
 */
export function normaliseProfile(raw) {
    const empty = emptyProfile();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
    if (raw.version !== PROFILE_VERSION) return empty;

    const keywords = Array.isArray(raw.keywords)
        ? raw.keywords.filter(function (k) { return typeof k === "string" && k.trim() !== ""; })
        : [];

    const contracts = Array.isArray(raw.contractTypes)
        ? raw.contractTypes.filter(function (k) { return typeof k === "string" && k.trim() !== ""; })
        : [];

    return {
        version: PROFILE_VERSION,
        keywordsText: typeof raw.keywordsText === "string" ? raw.keywordsText : "",
        keywords: keywords,
        hourlyRate: typeof raw.hourlyRate === "number" && isFinite(raw.hourlyRate)
            ? raw.hourlyRate
            : null,
        contractTypes: contracts,
        maxDistanceKm: typeof raw.maxDistanceKm === "number" && isFinite(raw.maxDistanceKm)
            ? raw.maxDistanceKm
            : null,
        updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    };
}

/**
 * Check a profile typed by the user and normalise it.
 *
 * Every field is optional: an empty profile is valid. Errors are keyed by
 * field name and hold a French message ready to display.
 * @param {Object} raw
 * @returns {{ok: boolean, errors: Object, value: Object}}
 */
export function validateProfile(raw) {
    const errors = {};
    const input = raw && typeof raw === "object" ? raw : {};

    // 1. Keywords: free text, commas or newlines as separators.
    const keywordsText = String(input.keywordsText === null || input.keywordsText === undefined
        ? ""
        : input.keywordsText);
    const keywords = parseKeywords(keywordsText);

    // 2. Hourly gross rate: > 0, at most 200, at most two decimals.
    const rateRaw = String(input.hourlyRate === null || input.hourlyRate === undefined
        ? ""
        : input.hourlyRate).trim().replace(",", ".");
    let hourlyRate = null;
    if (rateRaw !== "") {
        if (!/^\d+(\.\d{1,2})?$/.test(rateRaw)) {
            errors.hourlyRate =
                "Le taux horaire doit être un nombre, avec au plus 2 décimales (ex. 15,50).";
        } else {
            const value = Number(rateRaw);
            if (!(value > RATE_MIN_EXCLUSIVE)) {
                errors.hourlyRate = "Le taux horaire doit être supérieur à 0 €.";
            } else if (value > RATE_MAX) {
                errors.hourlyRate = "Le taux horaire ne peut pas dépasser 200 €.";
            } else {
                hourlyRate = value;
            }
        }
    }

    // 3. Contract types: any list of non-empty strings.
    const contractTypes = Array.isArray(input.contractTypes)
        ? input.contractTypes
            .filter(function (v) { return typeof v === "string" && v.trim() !== ""; })
            .map(function (v) { return v.trim(); })
        : [];

    // 4. Maximum distance: whole kilometres between 0 and 500.
    const distanceRaw = String(input.maxDistanceKm === null || input.maxDistanceKm === undefined
        ? ""
        : input.maxDistanceKm).trim();
    let maxDistanceKm = null;
    if (distanceRaw !== "") {
        if (!/^\d+$/.test(distanceRaw)) {
            errors.maxDistanceKm = "La distance doit être un nombre entier de kilomètres.";
        } else {
            const value = Number(distanceRaw);
            if (value < DISTANCE_MIN || value > DISTANCE_MAX) {
                errors.maxDistanceKm = "La distance doit être comprise entre 0 et 500 km.";
            } else {
                maxDistanceKm = value;
            }
        }
    }

    const ok = Object.keys(errors).length === 0;

    return {
        ok: ok,
        errors: errors,
        value: ok ? {
            version: PROFILE_VERSION,
            keywordsText: keywordsText,
            keywords: keywords,
            hourlyRate: hourlyRate,
            contractTypes: contractTypes,
            maxDistanceKm: maxDistanceKm,
            updatedAt: input.updatedAt instanceof Date
                ? input.updatedAt.toISOString()
                : (typeof input.updatedAt === "string" ? input.updatedAt : ""),
        } : emptyProfile(),
    };
}

/**
 * Read the stored profile. Never throws.
 * @returns {Promise<Object>}
 */
export async function readProfile() {
    // The database is the source of truth; localStorage is the mirror.
    try {
        const response = await fetch(PROFILE_URL, { cache: "no-store" });
        if (response.ok) {
            const stored = normaliseProfile(await response.json());
            writeProfileMirror(stored);
            return stored;
        }
    } catch (error) {
        // Server unreachable: fall back to the mirror below.
    }

    try {
        const raw = localStorage.getItem(PROFILE_KEY);
        if (raw === null) return emptyProfile();
        return normaliseProfile(JSON.parse(raw));
    } catch (error) {
        return emptyProfile();
    }
}

/**
 * Copy the profile into localStorage so it is part of the tracking export.
 * @param {Object} profile
 */
function writeProfileMirror(profile) {
    try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (error) {
        console.error("Unable to mirror the profile", error);
    }
}

/**
 * Save the profile to the database and to the mirror.
 * @param {Object} profile
 * @returns {Promise<boolean>} false when the database refused it
 */
export async function writeProfile(profile) {
    const clean = normaliseProfile(profile);
    // The mirror is written first so the profile survives a failed save.
    writeProfileMirror(clean);
    try {
        const response = await fetch(PROFILE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(clean),
        });
        return response.ok;
    } catch (error) {
        console.error("Unable to save the profile", error);
        return false;
    }
}