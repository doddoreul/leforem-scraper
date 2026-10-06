// ============================================================
// WANTED TICK — the small checkbox shown beside a wanted value
// ============================================================

import {
    contractIsWanted,
    mentionIsWanted,
    scheduleIsWanted,
} from "./profile.js";

/** One matcher and one colour per category. */
const KINDS = {
    contract: { matches: contractIsWanted, title: "Contrat souhaité" },
    schedule: { matches: scheduleIsWanted, title: "Horaire souhaité" },
    mention: { matches: mentionIsWanted, title: "Mention souhaitée" },
};

/**
 * The tick to place beside a value the candidate wants.
 *
 * Built here so the offers table and the offer sheet show the same thing.
 * It is a badge, not an input: nothing is toggled, it only says the value is
 * one of the wanted ones. The label carries the words, the glyph alone would
 * be meaningless to a screen reader.
 * @param {string} kind "contract", "schedule" or "mention"
 * @param {string} value what the offer carries
 * @param {Object} wanted the three lists read by loadWantedTypes
 * @returns {HTMLElement|null} null when the value is not wanted
 */
export function wantedTick(kind, value, wanted) {
    const spec = KINDS[kind];
    if (!spec) return null;

    const list = wanted && wanted[kind + "s"];
    if (!spec.matches(value, list)) return null;

    const tick = document.createElement("span");
    tick.className = "wanted-tick wanted-tick--" + kind;
    tick.textContent = "\u2713";
    tick.title = spec.title;
    tick.setAttribute("role", "img");
    tick.setAttribute("aria-label", spec.title);
    return tick;
}
