// ============================================================
// TEXT — comparisons insensitive to accents and case
// ============================================================

/**
 * Letters that carry no combining accent, so NFD leaves them alone, but that a
 * person still types without them. "manœuvre" has to answer to "manoeuvre".
 * Applied after the lowercase step, so the keys are lowercase only.
 * @type {Object<string, string>}
 */
const LIGATURES = {
    "œ": "oe", // œ
    "æ": "ae", // æ
    "ø": "o",  // ø
    "ß": "ss", // ß
    "đ": "d",  // đ
    "ł": "l",  // ł
};

const LIGATURE_RE = new RegExp("[" + Object.keys(LIGATURES).join("") + "]", "g");

/**
 * Lowercase a text without its accents, so "Electromecanicien" and
 * "électromécanicien" match when filtering.
 * @param {*} value
 * @returns {string}
 */
export function normalizeText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(LIGATURE_RE, (ch) => LIGATURES[ch]);
}

/**
 * The same folding for a single character, for callers that must keep track of
 * indexes. A ligature folds to two characters.
 * @param {string} ch
 * @returns {string}
 */
export function foldCharacter(ch) {
    const folded = String(ch)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(LIGATURE_RE, (c) => LIGATURES[c]);
    return folded;
}