// ============================================================
// SURLIGNAGE DES MOTS-CLÉS DU PROFIL
//
// Les mots-clés viennent du profil et sont insensibles à la casse et aux
// accents, comme le reste de l'application.
//
// Le surlignage ne reconstruit jamais de HTML : il parcourt les nœuds de
// texte déjà présents et n'enveloppe que les portions qui correspondent, dans
// un <mark>. Les données de l'employeur restent donc du texte, jamais du
// balisage injecté.
// ============================================================

import { readProfile } from "./profile.js";

/** The profile keywords, lowercased without accents. Empty when unset. */
let keywords = [];
let loaded = false;

/** Folded keywords, memoised by their raw spelling. */
const needleCache = new Map();

/** Tags whose text is a value or code, never decorated. */
const SKIP_TAGS = [
    "script", "style", "mark",
    "input", "textarea", "select", "option", "button",
];

/**
 * Roots that asked for a highlight before the keywords had loaded. The
 * offers table is drawn from its own fetch, so the two rarely finish in the
 * same tick.
 * @type {Array<HTMLElement>}
 */
const pending = [];

/**
 * Fold one character: lowercase and without accents. Kept as a helper so the
 * mapping back to the original text stays exact.
 * @param {string} ch
 * @returns {string}
 */
function foldChar(ch) {
    return ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Fold a whole string and remember where every folded character came from.
 *
 * Folding changes the length ("é" becomes "e"), so an index in the folded text
 * means nothing in the original. The map is what makes it possible to slice
 * the original text at the right places.
 * @param {string} text
 * @returns {{folded: string, map: number[]}}
 */
export function foldWithMap(text) {
    let folded = "";
    const map = [];
    for (let i = 0; i < text.length; i += 1) {
        const piece = foldChar(text[i]);
        for (let k = 0; k < piece.length; k += 1) {
            folded += piece[k];
            map.push(i);
        }
    }
    return { folded: folded, map: map };
}

/**
 * Fold a keyword, memoised. Folding is idempotent, so an already folded
 * needle is returned unchanged.
 * @param {string} word
 * @returns {string}
 */
function foldNeedle(word) {
    const cached = needleCache.get(word);
    if (cached !== undefined) return cached;
    const folded = foldChar(String(word || "").trim());
    needleCache.set(word, folded);
    return folded;
}

/**
 * The character ranges of `needle` inside `haystack`, folded.
 * @param {string} foldedHaystack
 * @param {string} foldedNeedle
 * @returns {Array<[number, number]>} half-open ranges, in folded indexes
 */
function findRanges(foldedHaystack, foldedNeedle) {
    const ranges = [];
    if (!foldedNeedle) return ranges;
    let from = 0;
    for (;;) {
        const at = foldedHaystack.indexOf(foldedNeedle, from);
        if (at === -1) break;
        ranges.push([at, at + foldedNeedle.length]);
        from = at + 1;
    }
    return ranges;
}

/**
 * The ranges of the current keywords in one text, in original indexes.
 * Overlapping ranges are merged so a word is never wrapped twice.
 *
 * The needles are folded here rather than by the caller: folding is
 * idempotent, and a caller who forgets would otherwise get a silent empty
 * result instead of a match.
 * @param {string} text
 * @param {Array<string>} words
 * @returns {Array<[number, number]>} half-open ranges, in original indexes
 */
export function matchRanges(text, words) {
    if (!text || !words || !words.length) return [];

    const { folded, map } = foldWithMap(text);

    const ranges = [];
    words.forEach(function (word) {
        const needle = foldNeedle(word);
        findRanges(folded, needle).forEach(function (pair) {
            const start = map[pair[0]];
            const lastFolded = pair[1] - 1;
            const end = map[lastFolded];
            if (start === undefined || end === undefined) return;
            ranges.push([start, end + 1]);
        });
    });

    if (!ranges.length) return [];

    ranges.sort(function (a, b) { return a[0] - b[0]; });

    const merged = [];
    ranges.forEach(function (range) {
        const last = merged[merged.length - 1];
        // Overlapping or touching ranges become one.
        if (last && range[0] <= last[1]) {
            if (range[1] > last[1]) last[1] = range[1];
        } else {
            merged.push([range[0], range[1]]);
        }
    });
    return merged;
}

/**
 * Highlight the keywords inside one text node's parent.
 * @param {Text} node
 * @param {Array<string>} words already folded
 */
function highlightTextNode(node, words) {
    const text = node.nodeValue;
    const ranges = matchRanges(text, words);
    if (!ranges.length) return;

    const fragment = document.createDocumentFragment();
    let cursor = 0;

    ranges.forEach(function (range) {
        const [start, end] = range;
        if (start > cursor) {
            fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
        }
        const mark = document.createElement("mark");
        mark.className = "keyword-hit";
        mark.textContent = text.slice(start, end);
        fragment.appendChild(mark);
        cursor = end;
    });

    if (cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }

    if (node.parentNode) node.parentNode.replaceChild(fragment, node);
}

/**
 * Highlight every keyword found under `root`.
 *
 * Skips script, style and already highlighted text, so calling it twice is
 * harmless.
 * @param {HTMLElement|null} root
 * @param {Array<string>} [words] folded keywords, defaults to the profile ones
 */
export function highlightIn(root, words) {
    const active = words || keywords;
    if (!root) return;
    if (!active.length) {
        // The offers are drawn before the profile answers. Remember the root
        // so the pass can be replayed once the keywords are known.
        if (words === undefined && pending.indexOf(root) === -1) {
            pending.push(root);
        }
        return;
    }

    const walker = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode: function (node) {
                const parent = node.parentNode;
                if (!parent) return NodeFilter.FILTER_REJECT;
                const name = (parent.nodeName || "").toLowerCase();
                // Never touch the fields the user edits or types into: their
                // text is the value, not content to decorate.
                if (SKIP_TAGS.indexOf(name) !== -1) {
                    return NodeFilter.FILTER_REJECT;
                }
                return node.nodeValue && node.nodeValue.trim()
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
            },
        }
    );

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) { highlightTextNode(node, active); });
}

/**
 * Highlight the keywords of a plain string, for a textContent slot.
 * @param {string} text
 * @returns {DocumentFragment}
 */
export function highlightFragment(text) {
    const fragment = document.createDocumentFragment();
    const ranges = matchRanges(String(text || ""), keywords);
    let cursor = 0;
    ranges.forEach(function (range) {
        if (range[0] > cursor) {
            fragment.appendChild(document.createTextNode(
                String(text).slice(cursor, range[0])));
        }
        const mark = document.createElement("mark");
        mark.className = "keyword-hit";
        mark.textContent = String(text).slice(range[0], range[1]);
        fragment.appendChild(mark);
        cursor = range[1];
    });
    fragment.appendChild(document.createTextNode(String(text || "").slice(cursor)));
    return fragment;
}

/** The folded keywords currently in use. */
export function currentKeywords() {
    return keywords.slice();
}

/** Whether any keyword is set. */
export function hasKeywords() {
    return keywords.length > 0;
}

/**
 * Read the keywords from the stored profile. Safe to call on every page.
 * @returns {Promise<Array<string>>} the folded keywords
 */
export async function loadKeywords() {
    if (loaded) return currentKeywords();
    loaded = true;
    try {
        const profile = await readProfile();
        const list = Array.isArray(profile.keywords) ? profile.keywords : [];
        keywords = list
            .filter(function (word) { return typeof word === "string" && word.trim() !== ""; })
            .map(function (word) { return foldChar(word.trim()); })
            .filter(function (word, index, all) { return all.indexOf(word) === index; });
    } catch (error) {
        keywords = [];
    }
    flushPending();
    return currentKeywords();
}

/**
 * Replay the highlights that were requested too early. Roots that left the
 * document in between are skipped.
 */
function flushPending() {
    if (!keywords.length) return;
    while (pending.length) {
        const root = pending.shift();
        if (root && root.isConnected) highlightIn(root);
    }
}