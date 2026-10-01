// ============================================================
// HTTP — the local server, read-only for the pages except the two
// write routes (/api/scraper/run and /delete-scraping)
// ============================================================

export const API_SCRAPINGS = "/api/scrapings";
export const API_SCRAPE_RUN = "/api/scraper/run";
export const API_DELETE_SCRAPING = "/delete-scraping";

/**
 * Read a JSON file of the local server. Nothing is cached: the pages
 * must show the result of the scraping that just finished.
 * @param {string} url
 * @returns {Promise<*>} rejects when the server answers an error
 */
export async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${url}`);
    }
    return response.json();
}

/**
 * Same as fetchJson, but a missing file is not an error: the pages that
 * can live without a file ask for it this way.
 * @param {string} url
 * @returns {Promise<*>} null when the file cannot be read
 */
export async function fetchJsonOrNull(url) {
    try {
        return await fetchJson(url);
    } catch (error) {
        console.error("Unable to read " + url, error);
        return null;
    }
}

/**
 * The list of the searches known by the server.
 * @returns {Promise<Array>} [] when the server cannot be reached
 */
export async function fetchScrapings() {
    try {
        return await fetchJson(API_SCRAPINGS);
    } catch (error) {
        console.error("Unable to list scrapings", error);
        return [];
    }
}

/**
 * Send JSON to the server and return its answer.
 * @param {string} url
 * @param {Object} payload
 * @returns {Promise<{ok: boolean, status: number, data: *}>}
 */
export async function postJson(url, payload) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    let data = null;
    try {
        data = await response.json();
    } catch (error) {
        data = null;
    }
    return { ok: response.ok, status: response.status, data };
}