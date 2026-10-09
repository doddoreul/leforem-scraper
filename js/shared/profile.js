// ============================================================
// PROFILE — the single candidate profile and what it wants
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

const PROFILE_KEY = "forem_profil";
const PROFILE_URL = "/api/profil";
const PROFILE_VERSION = 1;

/** Contract types offered when no offer data is available yet. */
export const FALLBACK_CONTRACT_TYPES = [
    "CDI",
    "CDD",
    "Intérim",
    "Indépendant",
    "Étudiant",
    "Stage",
];

/**
 * The working regimes the Forem publishes in regimeTravail.
 *
 * A fixed list, not harvested from the offers: the listing packs the regime,
 * the mention and the shift period into one "schedule" string, so harvesting
 * there would offer "Temps plein Travail de jour" as a regime.
 * @type {Array<string>}
 */
export const FALLBACK_SCHEDULE_TYPES = [
    "Temps plein",
    "Temps partiel",
];

/**
 * The mentions the Forem publishes in regimeTravailPrecision, for the same
 * reason: fixed, and matched through the aliases above.
 * @type {Array<string>}
 */
export const FALLBACK_MENTION_TYPES = [
    "Travail de jour",
    "Travail de nuit",
    "Travail posté 2 pauses",
    "Travail posté 3 pauses",
    "Week-end",
];

/**
 * How the friendly labels the profile shows map onto what the Forem writes.
 *
 * The profile offers "CDI" and the Forem writes "Durée indéterminée", so a
 * label alone would never match. An offer may carry several at once — "Intérimaire
 * avec option sur durée indéterminée" is both — and each one counts.
 * @type {Object<string, Array<string>>}
 */
const CONTRACT_ALIASES = {
    cdi: ["duree indeterminee"],
    cdd: ["duree determinee"],
    interim: ["interim"],
    independant: ["independant"],
    etudiant: ["etudiant"],
    stage: ["stage"],
};

/**
 * The same idea for the working regime, regimeTravail: "Temps plein",
 * "Temps partiel".
 * @type {Object<string, Array<string>>}
 */
const SCHEDULE_ALIASES = {
    "temps plein": ["temps plein"],
    "temps partiel": ["temps partiel"],
    mi: ["temps partiel"],
};

/**
 * And for the mentions, regimeTravailPrecision: "Travail de jour", "Travail
 * posté 3 pauses", "Week-end".
 * @type {Object<string, Array<string>>}
 */
const MENTION_ALIASES = {
    jour: ["travail de jour"],
    nuit: ["travail de nuit"],
    weekend: ["week-end", "weekend"],
    "2 pauses": ["poste 2 pauses"],
    "3 pauses": ["poste 3 pauses"],
    pauses: ["poste 2 pauses", "poste 3 pauses"],
};

/** Hourly gross rate bounds, in euros. */
const RATE_MIN_EXCLUSIVE = 0;
const RATE_MAX = 200;

/** Fold a value the same way the filters do. */
function foldValue(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[œ]/g, "oe")
        .replace(/[æ]/g, "ae")
        .replace(/[ø]/g, "o")
        .trim();
}

/**
 * Whether a value is one the candidate wants, given a set of aliases.
 *
 * Both spellings are accepted: the friendly labels the profile page offers and
 * the raw values the Forem publishes, since the profile merges both. The text
 * is folded first, so "Intérim" and "INTERIMAIRE" meet.
 *
 * The match is on substrings because the Forem packs several things in one
 * field: the listing stores regimeTravail, the mention and the shift period in
 * a single "schedule" string, so "Temps plein Travail de jour" has to answer to
 * both the regime and the mention.
 * @param {string} value what the offer carries
 * @param {Array<string>} wanted the values chosen on the profile page
 * @param {Object<string, Array<string>>} aliases friendly label -> Forem wording
 * @returns {boolean}
 */
function matchesWanted(value, wanted, aliases) {
    const text = foldValue(value);
    if (text === "" || !Array.isArray(wanted) || !wanted.length) return false;

    return wanted.some(function (label) {
        const wantedText = foldValue(label);
        if (wantedText === "") return false;
        // The Forem's own wording, chosen on the profile page.
        if (text.indexOf(wantedText) !== -1) return true;
        // Or one of the aliases of a friendly label.
        const tokens = aliases[wantedText];
        return Boolean(tokens) && tokens.some(function (token) {
            return text.indexOf(foldValue(token)) !== -1;
        });
    });
}

/**
 * Whether an offer's contract is one the candidate wants.
 * @param {string} contractType what the offer carries
 * @param {Array<string>} wanted the profile contractTypes
 * @returns {boolean}
 */
export function contractIsWanted(contractType, wanted) {
    return matchesWanted(contractType, wanted, CONTRACT_ALIASES);
}

/**
 * Whether an offer's working regime is one the candidate wants.
 * @param {string} schedule
 * @param {Array<string>} wanted the profile scheduleTypes
 * @returns {boolean}
 */
export function scheduleIsWanted(schedule, wanted) {
    return matchesWanted(schedule, wanted, SCHEDULE_ALIASES);
}

/**
 * Whether an offer's mention, day or night, is one the candidate wants.
 * @param {string} mention
 * @param {Array<string>} wanted the profile mentionTypes
 * @returns {boolean}
 */
export function mentionIsWanted(mention, wanted) {
    return matchesWanted(mention, wanted, MENTION_ALIASES);
}

/** What the profile asks for, read once per page. */
let wantedTypes = null;

/**
 * Clean a list of chosen values: drop the empties, trim the rest.
 * @param {*} list
 * @returns {Array<string>}
 */
function cleanTypeList(list) {
    const source = Array.isArray(list) ? list : [];
    return source
        .filter(function (value) {
            return typeof value === "string" && value.trim() !== "";
        })
        .map(function (value) { return value.trim(); });
}

/**
 * Read what the candidate wants: contracts, schedules and mentions.
 *
 * One read for the three lists, since they come from the same profile.
 * Never throws: a profile that cannot be read simply means no tick.
 * @returns {Promise<{contracts: Array<string>, schedules: Array<string>,
 *                    mentions: Array<string>}>}
 */
export async function loadWantedTypes() {
    if (wantedTypes) {
        return {
            contracts: wantedTypes.contracts.slice(),
            schedules: wantedTypes.schedules.slice(),
            mentions: wantedTypes.mentions.slice(),
        };
    }

    let profile = null;
    try {
        profile = await readProfile();
    } catch (error) {
        profile = null;
    }

    wantedTypes = {
        contracts: cleanTypeList(profile && profile.contractTypes),
        schedules: cleanTypeList(profile && profile.scheduleTypes),
        mentions: cleanTypeList(profile && profile.mentionTypes),
    };

    return {
        contracts: wantedTypes.contracts.slice(),
        schedules: wantedTypes.schedules.slice(),
        mentions: wantedTypes.mentions.slice(),
    };
}

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
        excludedText: "",
        excluded: [],
        hourlyRate: null,
        contractTypes: [],
        scheduleTypes: [],
        mentionTypes: [],
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

    const excluded = Array.isArray(raw.excluded)
        ? raw.excluded.filter(function (k) { return typeof k === "string" && k.trim() !== ""; })
        : [];

    const scheduleTypes = Array.isArray(raw.scheduleTypes)
        ? raw.scheduleTypes.filter(function (k) { return typeof k === "string" && k.trim() !== ""; })
        : [];

    const mentionTypes = Array.isArray(raw.mentionTypes)
        ? raw.mentionTypes.filter(function (k) { return typeof k === "string" && k.trim() !== ""; })
        : [];

    const contracts = Array.isArray(raw.contractTypes)
        ? raw.contractTypes.filter(function (k) { return typeof k === "string" && k.trim() !== ""; })
        : [];

    return {
        version: PROFILE_VERSION,
        keywordsText: typeof raw.keywordsText === "string" ? raw.keywordsText : "",
        keywords: keywords,
        excludedText: typeof raw.excludedText === "string" ? raw.excludedText : "",
        excluded: excluded,
        scheduleTypes: scheduleTypes,
        mentionTypes: mentionTypes,
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

    // 2. Excluded keywords: same free text, same separators.
    const excludedText = String(input.excludedText === null || input.excludedText === undefined
        ? ""
        : input.excludedText);
    const excluded = parseKeywords(excludedText);

    // 3. Hourly gross rate: > 0, at most 200, at most two decimals.
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

    // 4. Contract types: any list of non-empty strings.
    const contractTypes = Array.isArray(input.contractTypes)
        ? input.contractTypes
            .filter(function (v) { return typeof v === "string" && v.trim() !== ""; })
            .map(function (v) { return v.trim(); })
        : [];

    // 5. Wanted schedules and mentions: same shape as the contract types.
    const scheduleTypes = Array.isArray(input.scheduleTypes)
        ? input.scheduleTypes
            .filter(function (v) { return typeof v === "string" && v.trim() !== ""; })
            .map(function (v) { return v.trim(); })
        : [];

    const mentionTypes = Array.isArray(input.mentionTypes)
        ? input.mentionTypes
            .filter(function (v) { return typeof v === "string" && v.trim() !== ""; })
            .map(function (v) { return v.trim(); })
        : [];

    // 6. Maximum distance: whole kilometres between 0 and 500.
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
            excludedText: excludedText,
            excluded: excluded,
            hourlyRate: hourlyRate,
            contractTypes: contractTypes,
            scheduleTypes: scheduleTypes,
            mentionTypes: mentionTypes,
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