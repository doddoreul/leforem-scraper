// ============================================================
// DOM — the two element helpers every page needs
// ============================================================

/**
 * Create an element.
 * @param {string} tag
 * @param {string} [className]
 * @param {*} [text] textContent, ignored when null/undefined
 * @returns {HTMLElement}
 */
export function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

/**
 * @param {string} id
 * @returns {HTMLElement|null}
 */
export function byId(id) {
    return document.getElementById(id);
}