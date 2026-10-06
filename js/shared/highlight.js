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
import { foldCharacter } from "./text.js";

/** The profile keywords, lowercased without accents. Empty when unset. */
let keywords = [];
/** Keywords the user does not want: found, but flagged in red. */
let excluded = [];
let loaded = false;

/** Class of an ordinary match, and of an excluded one. */
const HIT_CLASS = "keyword-hit";
// Both classes: the modifier only changes the colours, so the padding and the
// weight still come from the base class.
const EXCLUDED_CLASS = "keyword-hit keyword-hit--danger";

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
 *
 * It delegates to text.js so the highlighting and the filters fold identically:
 * a keyword that filters must also be found by the highlighting.
 * @param {string} ch
 * @returns {string} may be two characters when a ligature is folded
 */
function foldChar(ch) {
    return foldCharacter(ch);
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
 * The ranges of several word groups in one text, each tagged with its class.
 *
 * Groups are read in priority order and the first one to claim a stretch keeps
 * it, so a word that is both wanted and excluded shows as excluded: that is
 * the more useful signal.
 * @param {string} text
 * @param {Array<{words: Array<string>, className: string}>} groups
 * @returns {Array<[number, number, string]>} start, end, class
 */
function groupRanges(text, groups) {
    const taken = [];
    const found = [];

    groups.forEach(function (group) {
        if (!group.words || !group.words.length) return;
        matchRanges(text, group.words).forEach(function (range) {
            const clash = taken.some(function (other) {
                return range[0] < other[1] && other[0] < range[1];
            });
            if (clash) return;
            taken.push(range);
            found.push([range[0], range[1], group.className]);
        });
    });

    found.sort(function (a, b) { return a[0] - b[0]; });
    return found;
}

/**
 * Wrap the ranges in <mark>, leaving the rest as plain text.
 * @param {string} text
 * @param {Array<[number, number, string]>} ranges
 * @returns {DocumentFragment}
 */
function buildFragment(text, ranges) {
    const fragment = document.createDocumentFragment();
    let cursor = 0;

    ranges.forEach(function (range) {
        const start = range[0];
        const end = range[1];
        if (start > cursor) {
            fragment.appendChild(document.createTextNode(text.slice(cursor, start)));
        }
        const mark = document.createElement("mark");
        mark.className = range[2];
        mark.textContent = text.slice(start, end);
        fragment.appendChild(mark);
        cursor = end;
    });

    if (cursor < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
    }
    return fragment;
}

/**
 * Highlight the keywords inside one text node's parent.
 * @param {Text} node
 * @param {Array<{words: Array<string>, className: string}>} groups
 */
function highlightTextNode(node, groups) {
    const text = node.nodeValue;
    const ranges = groupRanges(text, groups);
    if (!ranges.length) return;

    if (node.parentNode) {
        node.parentNode.replaceChild(buildFragment(text, ranges), node);
    }
}

/**
 * The groups to highlight, in priority order.
 *
 * With no explicit list, the excluded keywords come first so they win over the
 * wanted ones on any overlap.
 * @param {Array<string>} [words]
 * @param {string} [className]
 * @returns {Array<{words: Array<string>, className: string}>}
 */
function activeGroups(words, className) {
    if (words) {
        return [{ words: words, className: className || HIT_CLASS }];
    }
    return [
        { words: excluded, className: EXCLUDED_CLASS },
        { words: keywords, className: HIT_CLASS },
    ];
}

/**
 * Highlight every keyword found under `root`.
 *
 * Skips script, style and already highlighted text, so calling it twice is
 * harmless.
 * @param {HTMLElement|null} root
 * @param {Array<string>} [words] folded keywords, defaults to the profile ones
 * @param {string} [className] class of the marks, defaults to the ordinary one
 */
export function highlightIn(root, words, className) {
    if (!root) return;
    const groups = activeGroups(words, className);
    const active = groups.some(function (group) {
        return group.words && group.words.length;
    });
    if (!active) {
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
    nodes.forEach(function (node) { highlightTextNode(node, groups); });
}

/**
 * Highlight the keywords of a plain string, for a textContent slot.
 * @param {string} text
 * @returns {DocumentFragment}
 */
export function highlightFragment(text) {
    return buildFragment(
        String(text || ""), groupRanges(String(text || ""), activeGroups()));
}

/** The folded keywords currently in use. */
export function currentKeywords() {
    return keywords.slice();
}

/** The folded excluded keywords currently in use. */
export function currentExcluded() {
    return excluded.slice();
}

/** Whether any keyword is set. */
export function hasKeywords() {
    return keywords.length > 0 || excluded.length > 0;
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
        keywords = foldList(profile.keywords);
        excluded = foldList(profile.excluded);
    } catch (error) {
        keywords = [];
        excluded = [];
    }
    flushPending();
    return currentKeywords();
}

/**
 * Fold a list of keywords and drop the empties and the duplicates.
 * @param {*} list
 * @returns {Array<string>}
 */
function foldList(list) {
    const source = Array.isArray(list) ? list : [];
    return source
        .filter(function (word) { return typeof word === "string" && word.trim() !== ""; })
        .map(function (word) { return foldChar(word.trim()); })
        .filter(function (word, index, all) { return all.indexOf(word) === index; });
}

/**
 * Replay the highlights that were requested too early. Roots that left the
 * document in between are skipped.
 */
function flushPending() {
    if (!keywords.length && !excluded.length) return;
    while (pending.length) {
        const root = pending.shift();
        if (root && root.isConnected) highlightIn(root);
    }
}