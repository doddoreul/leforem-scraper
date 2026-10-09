// ============================================================
// HTML DES ANNONCES
// Forem renvoie les descriptions telles que l'employeur les a
// saisies : beaucoup viennent d'un copier-coller Word ou d'un
// ├®diteur, et embarquent leurs couleurs, ses polices, ses classes
// (`msonormal`) et ses commentaires conditionnels. Ce module
// nettoie ce HTML avant l'affichage.
// ============================================================

// Balises gard├®es. Le reste est d├®balis├® (le texte reste) : c'est le
// moyen de ne jamais perdre une information de l'employeur.
const ALLOWED_TAGS = {
    a: ["href", "title"],
    b: [],
    blockquote: [],
    br: [],
    code: [],
    div: [],
    em: [],
    h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
    hr: [],
    i: [],
    img: ["alt", "src", "title"],
    li: [],
    ol: ["start", "type"],
    p: [],
    pre: [],
    s: [],
    span: [],
    strike: [],
    strong: [],
    sub: [],
    sup: [],
    small: [],
    table: [],
    tbody: [],
    td: ["colspan", "rowspan"],
    tfoot: [],
    th: ["colspan", "rowspan", "scope"],
    thead: [],
    tr: [],
    u: [],
    ul: [],
};

// Attributs de pr├®sentation. Retir├®s par d├®faut, gard├®s quand on veut
// revoir la mise en forme d'origine. Aucun n'ex├®cute quoi que ce soit.
const PRESENTATION_ATTRS = [
    "align", "bgcolor", "border", "cellpadding", "cellspacing", "class",
    "color", "face", "height", "nowrap", "size", "style", "valign", "width",
];

// Balises retir├®es avec leur contenu : ce sont du code, pas du texte.
const DROPPED_TAGS = [
    "script", "style", "iframe", "object", "embed", "applet", "form",
    "input", "button", "select", "option", "textarea", "link", "meta",
    "base", "noscript", "template", "svg", "math", "canvas",
];

// Balises de pr├®sentation d'un ├®diteur : gard├®es seulement quand on
// affiche la mise en forme d'origine.
const PRESENTATION_TAGS = { font: ["color", "face", "size"] };

// ├ël├®ments d├®balis├®s puis jet├®s s'ils ne contiennent plus rien.
const PRUNABLE_TAGS = ["p", "span", "div", "font", "b", "strong", "em", "i", "u"];

const SAFE_URL = /^(https?:|mailto:|tel:)/i;

/**
 * Is this url safe to keep in an href?
 * @param {string} value
 * @returns {boolean}
 */
function isSafeUrl(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return false;
    // Ancre et chemin relatif : rien ├á v├®rifier.
    if (trimmed.indexOf("#") === 0 || trimmed.indexOf("/") === 0) return true;
    // Sans sch├®ma : relatif, ou cela ne peut pas ├¬tre une url distante.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
    return SAFE_URL.test(trimmed);
}

/**
 * Keep the allowed attributes, and only those. Anything that looks like
 * code (on*, mso*, xmlns*, data-*) goes whatever the tag is, whether the
 * presentation is being kept or not.
 * @param {HTMLElement} node
 * @param {string[]} allowed
 * @param {boolean} keepPresentation
 */
function cleanAttributes(node, allowed, keepPresentation) {
    Array.from(node.attributes).forEach(attr => {
        const name = attr.name.toLowerCase();
        if (name.indexOf("on") === 0 || name.indexOf("mso") === 0 ||
            name.indexOf("xmlns") === 0 || name.indexOf("data-") === 0) {
            node.removeAttribute(attr.name);
            return;
        }
        if (keepPresentation &&
            PRESENTATION_ATTRS.indexOf(name) !== -1) {
            return;
        }
        if (allowed.indexOf(name) === -1) {
            node.removeAttribute(attr.name);
            return;
        }
        if (name === "href" && !isSafeUrl(attr.value)) {
            node.removeAttribute(attr.name);
        }
        // Une image distante se charge d├¿s qu'elle est ins├®r├®e, et son
        // onerror a pu s'ex├®cuter avant m├¬me notre filtre.
        if (name === "src" && !isSafeUrl(attr.value)) {
            node.removeAttribute(attr.name);
        }
    });
}

/**
 * Copy `source`'s children into `target`, keeping what is allowed.
 * Iterates a static list: children are moved, never visited in place.
 * @param {HTMLElement} source
 * @param {HTMLElement} target
 * @param {boolean} keepPresentation true to keep colours, fonts and classes
 */
function sanitizeInto(source, target, keepPresentation) {
    const children = Array.from(source.childNodes);

    children.forEach(child => {
        // 3 = texte. Le reste (commentaires, dont les conditionnels
        // Word <!--[if !supportLists]-->, et doctypes) est ignor├®.
        if (child.nodeType === 3) {
            target.appendChild(document.createTextNode(child.nodeValue));
            return;
        }
        if (child.nodeType !== 1) return;

        const tag = child.tagName.toLowerCase();
        if (DROPPED_TAGS.indexOf(tag) !== -1) return;

        const allowed = ALLOWED_TAGS[tag] ||
            (keepPresentation ? PRESENTATION_TAGS[tag] : null);
        if (!allowed) {
            // Balise inconnue : on garde ce qu'il y a dedans.
            sanitizeInto(child, target, keepPresentation);
            return;
        }

        cleanAttributes(child, allowed, keepPresentation);

        const clean = document.createElement(tag);
        for (let i = 0; i < child.attributes.length; i += 1) {
            clean.setAttribute(child.attributes[i].name,
                child.attributes[i].value);
        }
        if (tag === "a") {
            clean.setAttribute("rel", "noopener noreferrer");
        }
        sanitizeInto(child, clean, keepPresentation);
        target.appendChild(clean);
    });
}

/**
 * Remove the empty wrappers a word processor leaves behind.
 * @param {HTMLElement} node
 */
function pruneEmpty(node) {
    Array.from(node.children).forEach(child => {
        pruneEmpty(child);
        const tag = child.tagName.toLowerCase();
        if (PRUNABLE_TAGS.indexOf(tag) === -1) return;
        if (child.textContent.trim()) return;
        if (child.querySelector("br, hr, img, table, ul, ol")) return;
        child.remove();
    });
}

/**
 * The HTML of an offer, ready to display.
 * @param {string} html what Forem returned
 * @param {boolean} keepPresentation true to keep colours, fonts and classes
 * @returns {string}
 */
function sanitizeHtml(html, keepPresentation) {
    // DOMParser et non innerHTML : le document produit est inerte, donc
    // une <img onerror> ne se d├®clenche pas pendant l'analyse. Avec
    // innerHTML, le filtre arriverait apr├¿s coup, trop tard.
    const parsed = new DOMParser()
        .parseFromString(String(html || ""), "text/html");

    const clean = document.createElement("div");
    sanitizeInto(parsed.body, clean, keepPresentation === true);
    pruneEmpty(clean);
    return clean.innerHTML;
}

/**
 * The same HTML as plain text, for the diff and the exports.
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
    const holder = document.createElement("div");
    holder.innerHTML = sanitizeHtml(html);
    return (holder.textContent || "").replace(/\s+/g, " ").trim();
}

