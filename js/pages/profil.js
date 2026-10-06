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
    FALLBACK_MENTION_TYPES,
    FALLBACK_SCHEDULE_TYPES,
    emptyProfile,
    parseKeywords,
    readProfile,
    validateProfile,
    writeProfile,
} from "../shared/profile.js";
import { SUIVI_EVENT } from "../shared/suivi.js";

const FORM_FIELDS = ["keywordsText", "excludedText", "hourlyRate", "maxDistanceKm"];

let saved = emptyProfile();
let dirty = false;

/** Contract types currently shown, after merging offers and saved choices. */
let contractOptions = FALLBACK_CONTRACT_TYPES.slice();
/** Working regimes and mentions, fixed lists: see profile.js. */
let scheduleOptions = FALLBACK_SCHEDULE_TYPES.slice();
let mentionOptions = FALLBACK_MENTION_TYPES.slice();

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
    setError("scheduleTypes", "");
    setError("mentionTypes", "");
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
    return {
        keywordsText: byId("keywordsText").value,
        excludedText: byId("excludedText").value,
        hourlyRate: byId("hourlyRate").value,
        maxDistanceKm: byId("maxDistanceKm").value,
        contractTypes: selectedIn("contractTypes", contractOptions),
        scheduleTypes: selectedIn("scheduleTypes", scheduleOptions),
        mentionTypes: selectedIn("mentionTypes", mentionOptions),
        updatedAt: saved.updatedAt,
    };
}

/** A DOM-id-safe fragment for an arbitrary contract type. */
function cssSafe(value) {
    return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

/**
 * Render one list of checkboxes.
 * @param {string} listId the container id
 * @param {Array<string>} options every possible value
 * @param {Array<string>} selected the saved ones
 */
function renderChoiceList(listId, options, selected) {
    const box = byId(listId);
    if (!box) return;
    box.textContent = "";
    options.forEach(function (type) {
        const id = listId + "-" + cssSafe(type);
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

function renderContracts(selected) {
    renderChoiceList("contractTypes", contractOptions, selected);
}

function renderSchedules(selected) {
    renderChoiceList("scheduleTypes", scheduleOptions, selected);
}

function renderMentions(selected) {
    renderChoiceList("mentionTypes", mentionOptions, selected);
}

/**
 * The values ticked for one list, read from its checkboxes.
 * @param {string} listId
 * @param {Array<string>} options
 * @returns {Array<string>}
 */
function selectedIn(listId, options) {
    const chosen = [];
    options.forEach(function (type) {
        const box = document.getElementById(listId + "-" + cssSafe(type));
        if (box && box.checked) chosen.push(type);
    });
    return chosen;
}

function fillForm(profile) {
    byId("keywordsText").value = profile.keywordsText || "";
    byId("excludedText").value = profile.excludedText || "";
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

    const excluded = parseKeywords(profile.excludedText);
    byId("excludedPreview").textContent = excluded.length
        ? "Mots-clés exclus : " + excluded.join(", ")
        : "";

    // Choices that were saved but are gone from the offers stay selectable.
    contractOptions = FALLBACK_CONTRACT_TYPES.slice();
    (profile.contractTypes || []).forEach(function (type) {
        offerContractType(contractOptions, type);
    });
    renderContracts(profile.contractTypes || []);

    // Regimes and mentions come from fixed lists; a saved value that is no
    // longer offered still shows, so nothing ticked disappears silently.
    scheduleOptions = FALLBACK_SCHEDULE_TYPES.slice();
    (profile.scheduleTypes || []).forEach(function (type) {
        offerContractType(scheduleOptions, type);
    });
    renderSchedules(profile.scheduleTypes || []);

    mentionOptions = FALLBACK_MENTION_TYPES.slice();
    (profile.mentionTypes || []).forEach(function (type) {
        offerContractType(mentionOptions, type);
    });
    renderMentions(profile.mentionTypes || []);
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
    renderSchedules(saved.scheduleTypes || []);
    renderMentions(saved.mentionTypes || []);
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
            if (field === "excludedText") {
                const excluded = parseKeywords(byId(field).value);
                byId("excludedPreview").textContent = excluded.length
                    ? "Mots-clés exclus : " + excluded.join(", ")
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