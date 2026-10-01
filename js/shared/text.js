// ============================================================
// TEXT — comparisons insensitive to accents and case
// ============================================================

/**
 * Lowercase text without its accents, so "Electromecanicien" and
 * "électromécanicien" match when filtering.
 * @param {*} value
 * @returns {string}
 */
export function normalizeText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}