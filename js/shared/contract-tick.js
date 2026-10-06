// ============================================================
// CONTRACT TICK — the small checkbox shown next to a wanted contract
// ============================================================

import { contractIsWanted } from "./profile.js";

/**
 * The tick to place beside a contract type the candidate wants.
 *
 * Built here so the offers table and the offer sheet show the same thing.
 * It is a badge, not an input: nothing is toggled, it only says the contract
 * is one of the wanted ones. The label carries the words, the glyph alone
 * would be meaningless to a screen reader.
 * @param {string} contractType what the offer carries
 * @param {Array<string>} wanted the profile contractTypes
 * @returns {HTMLElement|null} null when the contract is not wanted
 */
export function contractTick(contractType, wanted) {
    if (!contractIsWanted(contractType, wanted)) return null;

    const tick = document.createElement("span");
    tick.className = "contract-tick";
    tick.textContent = "\u2713";
    tick.title = "Contrat souhaite";
    tick.setAttribute("role", "img");
    tick.setAttribute("aria-label", "Contrat souhaite");
    return tick;
}
