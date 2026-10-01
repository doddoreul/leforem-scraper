// ============================================================
// DATES — the Forem returns several date formats, and the same
// string is parsed by several pages: it is parsed here once.
// ============================================================

/**
 * Parse a date written by the Forem, whatever the format:
 * "06-05-24", "06/05/2024", "2024-05-06", "2024-05-06T10:00:00".
 * @param {string|Date|null} value
 * @returns {Date|null} null when the value cannot be understood
 */
export function parseForemDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
        return isNaN(value.getTime()) ? null : value;
    }

    const text = String(value).trim();
    let match = /^(\d{1,2})-(\d{1,2})-(\d{2})$/.exec(text);
    if (match) {
        return buildDate(2000 + Number(match[3]), Number(match[2]), Number(match[1]));
    }
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (match) {
        return buildDate(Number(match[3]), Number(match[2]), Number(match[1]));
    }
    match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
    if (match) {
        return buildDate(Number(match[1]), Number(match[2]), Number(match[3]));
    }
    return null;
}

function buildDate(year, month, day) {
    const date = new Date(year, month - 1, day);
    return isNaN(date.getTime()) ? null : date;
}

function pad(value) {
    return String(value).padStart(2, "0");
}

/**
 * 06/05/2024
 * @param {Date} date
 * @returns {string}
 */
export function formatSlashDay(date) {
    return pad(date.getDate()) + "/" + pad(date.getMonth() + 1) + "/" + date.getFullYear();
}

/**
 * 06/05/2024 14:30, or the raw value when it cannot be read.
 * @param {string|Date} value
 * @returns {string}
 */
export function formatDateTime(value) {
    if (!value) return "—";
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return formatSlashDay(date) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

/**
 * 6 mai 2024
 * @param {Date} date
 * @returns {string}
 */
export function formatLongDate(date) {
    if (!date) return "";
    return date.toLocaleDateString("fr-BE", {
        year: "numeric",
        month: "long",
        day: "numeric"
    });
}