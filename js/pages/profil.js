/* ============================================================
   PROFIL — the candidate profile page

   Fills the form from the stored profile, validates it on save and
   warns before leaving with unsaved changes. The contract types come
   from the offers already loaded, with a static fallback.

   Nothing is injected as HTML: every value goes through textContent.
   ============================================================ */

import { byId, el } from "../shared/dom.js";
import { fetchJsonOrNull } from "../shared/api.js";
import { initTheme } from "../shared/theme.js";
import "../shared/navbar.js";
import {
    FALLBACK_CONTRACT_TYPES,
    emptyProfile,
    parseKeywords,
    readProfile,
    validateProfile,
    writeProfile,
} from "../shared/profile.js";
import { SUIVI_EVENT } from "../shared/suivi.js";

const FORM_FIELDS = ["keywordsText", "hourlyRate", "maxDistanceKm"];

let saved = emptyProfile();
let dirty = false;

/** Contract types currently shown, after merging offers and saved choices. */
let contractOptions = FALLBACK_CONTRACT_TYPES.slice();

/**
 * Offer a contract type, preserving the order first seen.
 * @param {Array<string>} list
 * @param {string} value
 */
function offerContractType(list, value) {
    const clean = String(value || "").trim();
    if (clean === "") return;
    const key = clean.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const known = list.some(function (item) {
        return item.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() === key;
    });
    if (!known) list.push(clean);
}

function setError(field, message) {
    const box = byId(field + "Error");
    if (!box) return;
    if (message) {
        box.textContent = message;
        box.hidden = false;
    } else {
        box.textContent = "";
        box.hidden = true;
    }
}

function clearErrors() {
    FORM_FIELDS.forEach(function (field) { setError(field, ""); });
    setError("keywordsText", "");
    setError("contractTypes", "");
}

function markDirty() {
    if (dirty) return;
    dirty = true;
}

function showMessage(text, kind) {
    const box = byId("profileMessage");
    if (!box) return;
    box.textContent = text;
    box.className = "profile-message" + (kind ? " profile-message--" + kind : "");
}

function currentFormValue() {
    const types = [];
    contractOptions.forEach(function (type) {
        const box = document.getElementById("contract-" + cssSafe(type));
        if (box && box.checked) types.push(type);
    });
    return {
        keywordsText: byId("keywordsText").value,
        hourlyRate: byId("hourlyRate").value,
        maxDistanceKm: byId("maxDistanceKm").value,
        contractTypes: types,
        updatedAt: saved.updatedAt,
    };
}

/** A DOM-id-safe fragment for an arbitrary contract type. */
function cssSafe(value) {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

function renderContracts(selected) {
    const box = byId("contractTypes");
    if (!box) return;
    box.textContent = "";
    contractOptions.forEach(function (type) {
        const id = "contract-" + cssSafe(type);
        const row = el("label", "contract-item");
        row.setAttribute("for", id);

        const input = el("input", "contract-item__box");
        input.type = "checkbox";
        input.id = id;
        input.value = type;
        input.checked = selected.indexOf(type) !== -1;
        input.addEventListener("change", markDirty);

        row.appendChild(input);
        row.appendChild(el("span", "contract-item__label", type));
        box.appendChild(row);
    });
}

function fillForm(profile) {
    byId("keywordsText").value = profile.keywordsText || "";
    byId("hourlyRate").value = profile.hourlyRate === null || profile.hourlyRate === undefined
        ? ""
        : String(profile.hourlyRate);
    byId("maxDistanceKm").value = profile.maxDistanceKm === null
        || profile.maxDistanceKm === undefined
        ? ""
        : String(profile.maxDistanceKm);

    const keywords = parseKeywords(profile.keywordsText);
    byId("keywordsPreview").textContent = keywords.length
        ? "Mots-clés retenus : " + keywords.join(", ")
        : "";

    // Choices that were saved but are gone from the offers stay selectable.
    contractOptions = FALLBACK_CONTRACT_TYPES.slice();
    (profile.contractTypes || []).forEach(function (type) {
        offerContractType(contractOptions, type);
    });
    renderContracts(profile.contractTypes || []);
}

/**
 * Add the contract types present in the loaded offers.
 * @returns {Promise<void>}
 */
async function loadContractTypesFromOffers() {
    let scrapings = [];
    try {
        scrapings = await fetchJsonOrNull("/api/scrapings") || [];
    } catch (error) {
        scrapings = [];
    }
    if (!Array.isArray(scrapings)) return;

    for (const entry of scrapings) {
        const name = typeof entry === "string" ? entry : (entry && entry.name);
        if (!name) continue;
        let payload = null;
        try {
            payload = await fetchJsonOrNull("/data_" + name + ".json");
        } catch (error) {
            payload = null;
        }
        const offers = payload && Array.isArray(payload.offers) ? payload.offers : [];
        offers.forEach(function (offer) {
            if (offer && typeof offer === "object") {
                offerContractType(contractOptions, offer.contract_type);
            }
        });
    }
}

async function load() {
    saved = await readProfile();
    fillForm(saved);
    dirty = false;

    await loadContractTypesFromOffers();
    // Re-render so the freshly discovered types appear, keeping the ticks.
    renderContracts(saved.contractTypes || []);
}

async function save(event) {
    if (event) event.preventDefault();
    clearErrors();

    const result = validateProfile(currentFormValue());
    if (!result.ok) {
        Object.keys(result.errors).forEach(function (field) {
            setError(field, result.errors[field]);
        });
        showMessage("Corrige les champs signalés avant d'enregistrer.", "error");
        return;
    }

    result.value.updatedAt = new Date().toISOString();
    const ok = await writeProfile(result.value);
    saved = result.value;
    dirty = false;
    fillForm(saved);
    renderContracts(saved.contractTypes || []);

    if (ok) {
        showMessage("Profil enregistré.", "ok");
    } else {
        showMessage("Profil enregistré dans ce navigateur, pas dans la base.", "warn");
    }
}

function reset() {
    saved = emptyProfile();
    dirty = false;
    clearErrors();
    fillForm(saved);
    renderContracts([]);
    showMessage("Profil réinitialisé. Pense à l'enregistrer.", "warn");
}

/**
 * Ask before leaving with unsaved changes.
 * @param {BeforeUnloadEvent} event
 */
function warnOnLeave(event) {
    if (!dirty) return undefined;
    event.preventDefault();
    event.returnValue = "";
    return "";
}

function setup() {
    initTheme();

    byId("profileForm").addEventListener("submit", save);
    byId("resetProfileBtn").addEventListener("click", reset);

    FORM_FIELDS.forEach(function (field) {
        byId(field).addEventListener("input", function () {
            markDirty();
            if (field === "keywordsText") {
                const keywords = parseKeywords(byId(field).value);
                byId("keywordsPreview").textContent = keywords.length
                    ? "Mots-clés retenus : " + keywords.join(", ")
                    : "";
            }
        });
    });

    window.addEventListener("beforeunload", warnOnLeave);

    // An imported tracking file carries the profile: pick it up and push it
    // to the database, which is the source of truth.
    document.addEventListener(SUIVI_EVENT, async function () {
        let mirrored = emptyProfile();
        try {
            const raw = localStorage.getItem("forem_profil");
            if (raw) mirrored = JSON.parse(raw);
        } catch (error) {
            return;
        }
        if (!mirrored || mirrored.version !== 1) return;
        if (mirrored.updatedAt && mirrored.updatedAt !== saved.updatedAt) {
            saved = mirrored;
            fillForm(saved);
            dirty = false;
            await writeProfile(saved);
            showMessage("Profil mis à jour depuis l'import.", "ok");
        }
    });

    load();
}

setup();