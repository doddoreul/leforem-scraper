// ============================================================
// LINKS — building the URLs of the pages
// ============================================================

/**
 * Link to the sheet of one offer. `base` is the search the offer
 * belongs to, so the sheet reads the right data and storage keys.
 * @param {string|number} number
 * @param {string} [base]
 * @returns {string}
 */
export function detailHref(number, base) {
    const params = new URLSearchParams({ number: String(number || "") });
    if (base) params.set("base", base);
    return "/detail.html?" + params.toString();
}

/**
 * The offer on the Forem website.
 * @param {string|number} number
 * @returns {string}
 */
export function offerUrl(number) {
    return "https://www.leforem.be/recherche-offres/offre-detail/" +
        encodeURIComponent(number) + "?originPostuler=RECHOFFRE";
}