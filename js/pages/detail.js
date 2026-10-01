/* ============================================================
   DETAIL PAGE (fiche façon Le Forem)
   Rendu complet de l'offre depuis le JSON de détail brut
   stocké dans data/details*.json, + suivi personnel.
   ============================================================ */

import { fetchJsonOrNull } from "../shared/api.js";
import { formatLongDate, parseForemDate } from "../shared/dates.js";
import { el } from "../shared/dom.js";
import { offerUrl } from "../shared/links.js";
import { PRIORITY_OPTIONS, STATUS_OPTIONS } from "../shared/statuses.js";
import { readTrackedMap, storagePrefixFor, writeTrackedMap } from "../shared/storage.js";
import { SUIVI_EVENT, TRACKING_GEAR_ACTIONS, setupSuiviActions } from "../shared/suivi.js";
import { initTheme } from "../shared/theme.js";
import "../shared/navbar.js";

const params = new URLSearchParams(window.location.search);
const numberStr = (params.get("number") || "").trim();
const baseName = (params.get("base") || "").trim();

const storagePrefix = storagePrefixFor(baseName);

initTheme(TRACKING_GEAR_ACTIONS);

function statusesValue() { return readTrackedMap(storagePrefix, "statuts"); }
function remarksValue() { return readTrackedMap(storagePrefix, "remarques"); }
function favoritesValue() { return readTrackedMap(storagePrefix, "favoris"); }
function prioritiesValue() { return readTrackedMap(storagePrefix, "priorites"); }
function statutDatesValue() { return readTrackedMap(storagePrefix, "statut_dates"); }
function str(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string") return value.trim();
    return String(value).trim();
}

function listOf(value) {
    return Array.isArray(value) ? value : [];
}

function isTrue(value) {
    return str(value).toLowerCase() === "true";
}

function scrubHtml(html) {
    return String(html || "").replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi, ""
    );
}

function itemLabel(item) {
    if (typeof item === "string") return item.trim();
    if (item && typeof item === "object") {
        return str(item.libelle || item.label || item.nom || item.valeur);
    }
    return "";
}

function formatRelative(date) {
    if (!date) return "";
    const n = Math.round((date.getTime() - Date.now()) / 86400000);
    if (n === 0) return "aujourd'hui";
    if (n < 0) {
        const q = -n;
        return q === 1 ? "hier" : "il y a " + q + " jours";
    }
    return n === 1 ? "demain" : "dans " + n + " jours";
}

function chip(text, tone) {
    const c = el("span", "chip");
    if (tone) c.classList.add("chip-" + tone);
    c.textContent = text;
    return c;
}

function richBlock(html) {
    const node = el("div", "rich-html");
    node.innerHTML = scrubHtml(html);
    return node;
}

// ============================================================
// STYLES COLLES PAR LE CONSEIL
// Forem renvoie les descriptions telles que l'employeur les a saisies :
// beaucoup viennent d'un copier-coller Word ou d'un editeur, et
// embarquent leurs couleurs, polices et fonds. Sur fond blanc ces
// fonds forment des taches illisibles. Le bouton « Styles du
// texte » retire ces attributs presents sans toucher au contenu.
// ============================================================

const PRESENTATION_STYLE_PROPS = [
    "background-color",
    "background",
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "text-align",
    "text-decoration",
    "text-decoration-color",
    "line-height",
    "letter-spacing",
    "word-spacing",
    "text-shadow",
    "mso-",
];

// Neutralised once the user asks for it, and remembered: a pasted Word
// style is a nuisance on every visit.
const PLAIN_STYLES_KEY = "forem_plain_styles";

function plainStylesEnabled() {
    try {
        return localStorage.getItem(PLAIN_STYLES_KEY) === "1";
    } catch (e) {
        return false;
    }
}

function rememberPlainStyles(on) {
    try {
        localStorage.setItem(PLAIN_STYLES_KEY, on ? "1" : "0");
    } catch (e) {
        // Storage unavailable: the choice just does not persist.
    }
}

/**
 * The button that drops the pasted presentation styles, plus its wiring.
 * Only shown when the page really carries some.
 * @param {HTMLElement} mainCol the column holding the rich blocks
 */
function setupStyleToggle(mainCol) {
    const blocks = Array.from(mainCol.querySelectorAll(".rich-html"));
    const styled = blocks.filter(
        block => block.querySelector("[style]") || block.getAttribute("style")
    );
    if (!styled.length) return;

    // aria-pressed tells whether the pasted styles are dropped; the label
    // names what is currently applied, so both agree from the start.
    const toggle = el("button", "btn btn-outline style-toggle",
        "Styles du texte : activés");
    toggle.type = "button";
    toggle.setAttribute("aria-pressed", "false");
    toggle.title = "Les couleurs, polices et fonds collés par l'employeur " +
        "peuvent rendre le texte illisible.";

    // The backup survives the round trip: switching the styles off and on
    // again has to give the page back exactly what Forem sent.
    const saved = new Map();

    const apply = function (plain) {
        if (plain) {
            styled.forEach(block => stripPresentationStyles(block, saved));
        } else {
            restorePresentationStyles(saved);
        }
        toggle.textContent = plain
            ? "Styles du texte : désactivés"
            : "Styles du texte : activés";
        toggle.classList.toggle("active", plain);
        toggle.setAttribute("aria-pressed", plain ? "true" : "false");
    };

    if (plainStylesEnabled()) apply(true);

    toggle.addEventListener("click", function () {
        const plain = toggle.getAttribute("aria-pressed") !== "true";
        apply(plain);
        rememberPlainStyles(plain);
    });

    mainCol.insertBefore(toggle, mainCol.firstChild);
}

/**
 * Strip the presentation attributes an employer pasted along with the text.
 * Inline `style` attributes only: the tags themselves (<strong>, <u>, <em>)
 * carry meaning and are left alone. The original attributes are kept in
 * `saved` so the button can put them back.
 * @param {HTMLElement} block a node whose children carry the styles
 * @param {Map<HTMLElement, string>} saved the first-strip backup
 * @returns {number} how many elements were cleaned
 */
function stripPresentationStyles(block, saved) {
    let cleaned = 0;
    const nodes = [block].concat(Array.from(block.querySelectorAll("*")));
    nodes.forEach(node => {
        if (!node.getAttribute) return;
        const style = node.getAttribute("style");
        if (!style) return;
        if (!saved.has(node)) saved.set(node, style);

        const kept = style.split(";")
            .map(decl => decl.trim())
            .filter(decl => {
                const prop = decl.split(":")[0].trim().toLowerCase();
                if (!prop) return false;
                return !PRESENTATION_STYLE_PROPS.some(
                    name => prop === name || prop.indexOf(name) === 0
                );
            });

        if (kept.length) {
            node.setAttribute("style", kept.join("; "));
        } else {
            node.removeAttribute("style");
        }
        cleaned += 1;
    });
    return cleaned;
}

/**
 * Put back the attributes a previous strip removed.
 * @param {Map<HTMLElement, string>} saved the backup taken while stripping
 */
function restorePresentationStyles(saved) {
    saved.forEach((style, node) => {
        if (node.isConnected) node.setAttribute("style", style);
    });
}

// ============================================================
// MAIN
// ============================================================

function main() {
    const root = document.getElementById("detailRoot");
    if (!root) return;
    setupSuiviActions();

    if (!numberStr) {
        renderNotAvailable(root, "Aucun numéro d'offre fourni dans l'URL.");
        return;
    }

    fetchJsonOrNull("/api/scrapings")
        .then(scrapings => {
            const entries = Array.isArray(scrapings) ? scrapings : [];
            const entry = entries.find(e => e.name === baseName)
                || entries.find(e => e.name === "")
                || entries[0]
                || null;
            if (!entry) {
                renderNotAvailable(
                    root,
                    "Aucune recherche trouvée. Lance un scraping puis recharge."
                );
                return;
            }
            loadEntry(entry, root);
        })
        .catch(err => {
            renderNotAvailable(root, "Impossible de charger les données : "
                + err.message);
        });
}

function loadEntry(entry, root) {
    // The listing carries the diff (what changed since the previous scrape),
    // the detail file carries the full Forem payload. Both are needed.
    const detailsPromise = fetchJsonOrNull(entry.details);
    const offersPromise = entry.file
        ? fetchJsonOrNull(entry.file)
        : Promise.resolve(null);

    Promise.all([detailsPromise, offersPromise])
        .then(results => {
            const detailsData = results[0];
            const offersData = results[1];
            const store = (detailsData && detailsData.details)
                ? detailsData.details : null;
            const payload = store ? store[numberStr] : null;

            if (!payload) {
                renderNotAvailable(
                    root,
                    "Le détail complet de l'offre " + numberStr +
                    " n'a pas encore été enregistré."
                );
                return;
            }

            renderFiche(root, payload, findOffer(offersData));
        })
        .catch(err => {
            renderNotAvailable(root, "Impossible de charger les données : "
                + err.message);
        });
}

/**
 * The offer's row in the listing, where the scraper stores the diff.
 * @param {Object|null} offersData the data_*.json payload
 * @returns {{diff: Object, modifiedAt: string}|null}
 */
function findOffer(offersData) {
    const offers = (offersData && Array.isArray(offersData.offers))
        ? offersData.offers : [];
    const offer = offers.find(item => str(item && item.number) === numberStr);
    if (!offer) return null;
    return {
        diff: (offer.diff && typeof offer.diff === "object") ? offer.diff : {},
        modifiedAt: str(offer.modified_at),
    };
}

function renderNotAvailable(root, message) {
    root.innerHTML = "";

    const card = el("div", "card empty-card");
    card.appendChild(el("p", "empty-kicker", "Fiche indisponible"));
    card.appendChild(el(
        "h1", "empty-title",
        "Données non disponibles pour cette offre"
    ));
    const p = el("p", "empty-text", message);
    card.appendChild(p);
    const p2 = el("p", "empty-text",
        "Les fiches sont reconstruites lors du prochain scraping (python scraper.py), " +
        "puis recharge cette page.");
    card.appendChild(p2);

    const actionsRow = el("div", "empty-actions");
    const back = el("a", "btn btn-outline", "← Retour aux annonces");
    back.href = "/index.html";
    back.classList.add("empty-action");
    actionsRow.appendChild(back);

    if (numberStr) {
        const openBtn = el("a", "btn btn-primary",
            "Voir l'offre sur Le Forem ↗");
        openBtn.href = offerUrl(numberStr);
        openBtn.target = "_blank";
        openBtn.rel = "noopener noreferrer";
        openBtn.classList.add("empty-action");
        actionsRow.appendChild(openBtn);
    }

    card.appendChild(actionsRow);
    root.appendChild(card);
}

// ============================================================
// FICHE
// ============================================================

function renderFiche(root, payload, offer) {
    root.innerHTML = "";

    const number = str(payload.numero || payload.idOffreEmploi || numberStr);
    const title = str(payload.titreOffre) || "(Sans titre)";
    const employer = str(payload.nomEmployeur);
    const sector = str(payload.secteurActiviteEmployeur);
    const metier = str(payload.metier);
    const locations = listOf(payload.lieuxTravail).map(itemLabel);
    const contract = str(payload.typeContrat);
    const schedule = str(payload.regimeTravail);
    const scheduleDetail = str(payload.regimeTravailPrecision);
    const positions = str(payload.nombrePostes);
    const moved = isTrue(payload.isDeplacementRequired);
    const travelNote = str(payload.travel
        && (payload.travel.regle || payload.travel.frequence
            || payload.travel.libelle || payload.travel.description)
        || "");

    const published = parseForemDate(payload.datePublication);
    const debut = parseForemDate(payload.dateDebutDiffusion);
    const fin = parseForemDate(payload.dateFinDiffusion);
    const modif = parseForemDate(payload.dateModification);

    // --- HERO -------------------------------------------------
    const hero = el("div", "detail-hero");
    root.appendChild(hero);

    const logo = buildLogo(payload, employer);
    hero.appendChild(logo);

    const heroMain = el("div", "detail-hero-main");
    hero.appendChild(heroMain);

    const tLine = el("div", "detail-hero-line");
    if (metier) tLine.appendChild(chip(metier, "info"));
    tLine.appendChild(el("span", "detail-offer-num", "N° " + number));
    heroMain.appendChild(tLine);

    heroMain.appendChild(el("h1", "detail-title", title));

    const employerLine = el("p", "detail-employer", "");
    employerLine.appendChild(el("strong", "detail-employer-name",
        employer || "Employeur non communiqué"));
    if (sector) {
        employerLine.appendChild(document.createTextNode(" · " + sector));
    }
    if (locations.length) {
        employerLine.appendChild(document.createTextNode(" · " + locations.join(", ")));
    }
    heroMain.appendChild(employerLine);

    const facts = el("div", "detail-facts");
    if (contract) facts.appendChild(chip(contract, "accent"));
    if (schedule) facts.appendChild(chip(schedule, "accent"));
    if (scheduleDetail) facts.appendChild(chip(scheduleDetail, "accent"));
    if (positions) facts.appendChild(chip(positions + " poste(s)", "accent"));
    if (moved || travelNote) {
        facts.appendChild(chip(travelNote || "Déplacements requis", "warn"));
    }
    heroMain.appendChild(facts);

    const dates = el("div", "detail-dates");
    if (published) dates.appendChild(el(
        "span", "date-hint",
        "Publié le " + formatLongDate(published) + " (" + formatRelative(published) + ")"
    ));
    if (debut && !published) dates.appendChild(el(
        "span", "date-hint",
        "Diffusion débutée le " + formatLongDate(debut)
    ));
    if (fin) dates.appendChild(el(
        "span", "date-hint date-expiry",
        "Expire le " + formatLongDate(fin) + " (" + formatRelative(fin) + ")"
    ));
    if (modif) dates.appendChild(el(
        "span", "date-hint", "Modifiée le " + formatLongDate(modif)
    ));
    heroMain.appendChild(dates);

    const openBtn = el("a", "btn btn-primary", "Voir l'offre sur Le Forem ↗");
    openBtn.href = offerUrl(number);
    openBtn.target = "_blank";
    openBtn.rel = "noopener noreferrer";
    hero.appendChild(openBtn);

    // --- LAYOUT -----------------------------------------------
    const layout = el("div", "detail-layout");
    root.appendChild(layout);

    const mainCol = el("div", "detail-main");
    layout.appendChild(mainCol);

    // Ce que le scraping a changé depuis la version précédente, sur
    // demande seulement : la fiche montre d'abord l'annonce.
    const diffCard = buildDiffCard(offer);
    if (diffCard) mainCol.appendChild(diffCard);

    const sideCol = el("aside", "detail-side");
    layout.appendChild(sideCol);

    // Mission
    if (str(payload.descriptionJob)) {
        const card = el("section", "card");
        card.appendChild(el("h2", "card-title", "Description de la fonction"));
        card.appendChild(richBlock(payload.descriptionJob));
        mainCol.appendChild(card);
    }

    // Profil recherché
    const profile = buildProfile(payload);
    if (profile) {
        mainCol.appendChild(profile);
    }

    // Avantages
    const benefits = buildBenefits(payload);
    if (benefits) {
        mainCol.appendChild(benefits);
    }

    // À propos de l'employeur
    if (str(payload.descriptionEmployeur)) {
        const card = el("section", "card");
        card.appendChild(el("h2", "card-title", "À propos de " +
            (employer || "l'employeur")));
        card.appendChild(richBlock(payload.descriptionEmployeur));
        mainCol.appendChild(card);
    }

    if (!mainCol.children.length) {
        mainCol.appendChild(el(
            "p", "empty-note",
            "Aucune description détaillée dans cette annonce."
        ));
    }

    setupStyleToggle(mainCol);

    // Informations pratiques
    const infoCard = el("section", "card");
    infoCard.appendChild(el("h2", "card-title", "Informations pratiques"));
    infoCard.appendChild(buildInfoList(payload));
    sideCol.appendChild(infoCard);

    // Comment postuler
    const applyCard = buildApply(payload, number);
    if (applyCard) {
        sideCol.appendChild(applyCard);
    }

    // Votre suivi
    sideCol.appendChild(buildTracking(number));
}

// ============================================================
// BUILDERS
// ============================================================

function buildLogo(payload, employer) {
    const data = str(payload.logoEmployeur);
    const mime = str(payload.logoMimeType) || "image/png";
    const wrap = el("div", "detail-logo");
    if (data) {
        const img = document.createElement("img");
        img.src = "data:" + mime + ";base64," + data;
        img.alt = "Logo de l'employeur";
        wrap.appendChild(img);
    } else {
        const initials = employer.split(/\s+/)
            .filter(w => w.length > 0)
            .slice(0, 2)
            .map(w => w[0].toUpperCase())
            .join("") || "?";
        wrap.appendChild(el("span", "detail-logo-fallback", initials));
    }
    return wrap;
}

function buildInfoList(payload) {
    const dl = el("dl", "detail-info");
    const rows = [];

    const reported = (v, label) => {
        if (str(v)) rows.push([label, String(v).trim()]);
    };

    reported(payload.typeContrat, "Type de contrat");
    reported(payload.regimeTravail, "Régime de travail");
    reported(payload.regimeTravailPrecision, "Précision horaire");
    reported(payload.nombrePostes, "Nombre de postes");
    reported(payload.secteurActiviteEmployeur, "Secteur d'activité");
    reported(payload.metier, "Métier");

    const locations = listOf(payload.lieuxTravail).map(itemLabel).filter(Boolean);
    if (locations.length) rows.push(["Lieu(x) de travail", locations.join(", ")]);

    reported(
        payload.datePublication, "Date de publication"
    );
    reported(payload.dateDebutDiffusion, "Début de diffusion");
    reported(payload.dateFinDiffusion, "Fin de diffusion");
    reported(payload.dateModification, "Dernière modification");

    const isDeplacement = isTrue(payload.isDeplacementRequired);
    if (isDeplacement) rows.push(["Déplacements", "Oui"]);

    rows.forEach(([labelText, value]) => {
        const dt = el("dt", "detail-info-label", labelText + " :");
        dl.appendChild(dt);
        const dd = el("dd", "detail-info-value", value);
        dl.appendChild(dd);
    });

    return dl;
}

function buildApply(payload, number) {
    const how = (payload.howToApply && typeof payload.howToApply === "object")
        ? payload.howToApply : {};
    const email = str(how.email);
    const name = str(how.formattedName) || [
        how.prefferedGivenName, how.familyName
    ].filter(Boolean).join(" ");
    const address = str(how.postalAddress);
    const url = str(how.url);
    const reference = str(how.reference);

    if (!email && !name && !address && !url && !reference) return null;

    const card = el("section", "card");
    card.appendChild(el("h2", "card-title", "Comment postuler"));

    if (name) card.appendChild(el("p", "detail-apply-name", "Contact : " + name));
    if (email) {
        const pLine = el("p", "detail-apply-line");
        pLine.appendChild(el("span", "detail-apply-label", "E-mail : "));
        const link = el("a", "detail-link", email);
        link.href = "mailto:" + email;
        pLine.appendChild(link);
        card.appendChild(pLine);
    }
    if (url) {
        const pLine = el("p", "detail-apply-line");
        const link = el("a", "detail-link", "Candidature en ligne");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        pLine.appendChild(link);
        card.appendChild(pLine);
    }
    if (address) {
        card.appendChild(el("p", "detail-apply-line", "Adresse postale : " + address));
    }
    if (reference) {
        card.appendChild(el("p", "detail-apply-line", "Référence : " + reference));
    }

    const cta = el("a", "btn btn-outline", "Postuler via Le Forem ↗");
    cta.href = offerUrl(number);
    cta.target = "_blank";
    cta.rel = "noopener noreferrer";
    card.appendChild(cta);

    return card;
}

function buildProfile(payload) {
    const blocks = [];

    const experience = listOf(payload.experience);
    if (experience.length) {
        const rows = experience.map(item => {
            const label = itemLabel(item);
            const extent = str(item.experience);
            return label + (extent ? " — " + extent : "");
        });
        blocks.push(profileBlock("Expérience requise", rows));
    }

    const etudes = listOf(payload.etudes).map(itemLabel).filter(Boolean);
    if (etudes.length) blocks.push(profileBlock("Études & diplômes", etudes));

    const permis = listOf(payload.permisConduire).map(item => {
        let label = itemLabel(item);
        const valeur = str(item.valeur);
        if (valeur) label += " (permis " + valeur + ")";
        if (item && item.required) label += " · exigé";
        return label;
    }).filter(Boolean);
    if (permis.length) blocks.push(profileBlock("Permis de conduire", permis));

    const certifications = listOf(payload.certifications).map(itemLabel).filter(Boolean);
    if (certifications.length) blocks.push(profileBlock("Certifications", certifications));

    const competencies = listOf(payload.competencies).map(itemLabel).filter(Boolean);
    if (competencies.length) blocks.push(profileBlock("Compétences", competencies));

    const office = listOf(payload.officeSkills).map(itemLabel).filter(Boolean);
    if (office.length) blocks.push(profileBlock("Compétences bureautiques", office));

    const soft = listOf(payload.softSkills).map(itemLabel).filter(Boolean);
    if (soft.length) blocks.push(profileBlock("Savoir-être", soft));

    const tongues = listOf(payload.langues)
        .map(item => str(item.libelle) + (str(item.experience)
            ? " · " + str(item.experience) : ""))
        .filter(Boolean);
    if (tongues.length) blocks.push(profileBlock("Langues", tongues));

    const languageDetail = listOf(payload.langues)
        .map(item => str(item.comment))
        .filter(Boolean)
        .join("");
    if (languageDetail) {
        blocks.push(richBlockSection("Exigences linguistiques", languageDetail));
    }

    if (!blocks.length) return null;

    const card = el("section", "card");
    card.appendChild(el("h2", "card-title", "Profil recherché"));
    blocks.forEach(block => card.appendChild(block));
    return card;
}

// ============================================================
// DIFF AVEC LA VERSION PRÉCÉDENTE
// core.compute_diff() écrit dans chaque annonce du listing un objet
// { champ: [avant, après] }. La fiche affiche l'annonce ; les
// modifications restent masquées jusqu'à ce que l'utilisateur les
// demande, puis se remplissent à la première ouverture.
// ============================================================

const DIFF_FIELD_LABELS = {
    number: "Numéro",
    offer_title: "Titre de l'offre",
    description: "Description",
    summary: "Résumé",
    company: "Société",
    email: "E-mail",
    url: "Lien",
    contract_type: "Type de contrat",
    schedule: "Régime de travail",
    pay: "Rémunération",
    salary: "Salaire",
    location: "Lieu",
    metier: "Métier",
    published_on: "Publié le",
    date_publication: "Date de publication",
    date_fin_diffusion: "Fin de diffusion",
};

// Champs dont la valeur arrive en HTML depuis Forem.
const DIFF_HTML_FIELDS = ["description", "summary"];

/**
 * A value of the diff, as plain text ready to display.
 * @param {*} value
 * @returns {string}
 */
function diffValue(value) {
    if (value === undefined || value === null) return "";
    const text = String(value);
    if (DIFF_HTML_FIELDS.some(field => text.indexOf("<") !== -1)) {
        const block = document.createElement("div");
        block.innerHTML = scrubHtml(text);
        return (block.textContent || "").replace(/\s+/g, " ").trim();
    }
    return text.replace(/\s+/g, " ").trim();
}

/**
 * @param {Object} diff the { champ: [avant, après] } object
 * @returns {Array<{field: string, label: string, before: string, after: string}>}
 */
function diffRows(diff) {
    if (!diff || typeof diff !== "object") return [];
    return Object.keys(diff).map(field => {
        const pair = diff[field];
        return {
            field: field,
            label: DIFF_FIELD_LABELS[field] || field,
            before: diffValue(Array.isArray(pair) ? pair[0] : ""),
            after: diffValue(Array.isArray(pair) ? pair[1] : ""),
        };
    }).sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

function buildDiffRow(row) {
    const block = el("div", "diff-block");
    block.appendChild(el("h3", "diff-field", row.label));

    const before = el("div", "diff-old");
    before.appendChild(el("span", "diff-tag", "Avant"));
    before.appendChild(el("span", "diff-text", row.before || "(vide)"));

    const after = el("div", "diff-new");
    after.appendChild(el("span", "diff-tag", "Après"));
    after.appendChild(el("span", "diff-text", row.after || "(vide)"));

    block.appendChild(before);
    block.appendChild(after);
    return block;
}

/**
 * @param {{diff: Object, modifiedAt: string}|null} offer
 * @returns {HTMLElement|null} null when nothing changed
 */
function buildDiffCard(offer) {
    const rows = offer ? diffRows(offer.diff) : [];
    if (!rows.length) return null;

    const card = el("section", "card diff-card");
    card.appendChild(el("h2", "card-title",
        "Modifications (" + rows.length + ")"));

    const when = parseForemDate(offer.modifiedAt);
    card.appendChild(el("p", "diff-meta", when
        ? "Dernière modification : " + formatLongDate(when)
        : "Dernière modification : " + str(offer.modifiedAt)));

    const toggle = el("button", "btn btn-outline diff-toggle",
        "Afficher le diff");
    const body = el("div", "diff-body hidden");
    body.setAttribute("aria-live", "polite");

    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", function () {
        const opening = body.classList.contains("hidden");
        if (opening && !body.childElementCount) {
            rows.forEach(row => body.appendChild(buildDiffRow(row)));
        }
        body.classList.toggle("hidden", !opening);
        toggle.textContent = opening ? "Masquer le diff" : "Afficher le diff";
        toggle.setAttribute("aria-expanded", opening ? "true" : "false");
    });

    card.appendChild(toggle);
    card.appendChild(body);
    return card;
}

function richBlockSection(titleText, html) {
    const block = el("div", "profile-block");
    block.appendChild(el("h3", "profile-block-title", titleText));
    block.appendChild(richBlock(html));
    return block;
}

function profileBlock(titleText, values) {
    const block = el("div", "profile-block");
    block.appendChild(el("h3", "profile-block-title", titleText));
    if (values.length === 1) {
        block.appendChild(el("p", "profile-block-text", values[0]));
    } else {
        const list = el("ul", "profile-list");
        values.forEach(value => list.appendChild(el("li", "", value)));
        block.appendChild(list);
    }
    return block;
}

function buildBenefits(payload) {
    const extras = listOf(payload.benefits && payload.benefits.otherBenefits)
        .filter(Boolean);
    const comments = str(payload.benefitsComments);

    if (!extras.length && !comments) return null;

    const card = el("section", "card");
    card.appendChild(el("h2", "card-title", "Avantages"));

    if (extras.length === 1) {
        card.appendChild(el("p", "profile-block-text", extras[0]));
    } else if (extras.length > 1) {
        const list = el("ul", "profile-list");
        extras.forEach(value => list.appendChild(el("li", "", value)));
        card.appendChild(list);
    }

    if (comments) card.appendChild(richBlock(comments));

    return card;
}

// ============================================================
// SUIVI PERSONNEL
// ============================================================

function buildTracking(number) {
    const card = el("section", "card");
    card.appendChild(el("h2", "card-title", "Votre suivi"));

    let statuses = statusesValue();
    let remarks = remarksValue();
    let favorites = favoritesValue();
    let priorities = prioritiesValue();
    let statutDates = statutDatesValue();

    const starLine = el("div", "detail-track-line");
    const star = document.createElement("button");
    star.type = "button";
    star.className = "star-button";
    const isFav = Boolean(favorites[number]);
    star.textContent = isFav ? "★" : "☆";
    star.title = "Marquer comme favori";
    star.setAttribute("aria-pressed", isFav ? "true" : "false");
    star.classList.toggle("active", isFav);
    star.addEventListener("click", () => {
        const active = !favorites[number];
        if (active) {
            favorites[number] = true;
        } else {
            delete favorites[number];
        }
        writeTrackedMap(storagePrefix, "favoris", favorites);
        star.textContent = active ? "★" : "☆";
        star.classList.toggle("active", active);
        star.setAttribute("aria-pressed", active ? "true" : "false");
    });
    starLine.appendChild(star);
    starLine.appendChild(el("span", "detail-track-star-text",
        isFav ? "Dans vos favoris" : "Ajouter aux favoris"));
    card.appendChild(starLine);

    const statusField = makeField(
        "Statut",
        STATUS_OPTIONS,
        statuses[number] || "",
        value => {
            statuses[number] = value;
            writeTrackedMap(storagePrefix, "statuts", statuses);
            if (value) {
                statutDates[number] = new Date().toISOString();
                writeTrackedMap(storagePrefix, "statut_dates", statutDates);
            } else {
                delete statutDates[number];
                writeTrackedMap(storagePrefix, "statut_dates", statutDates);
            }
        }
    );
    card.appendChild(statusField);

    const priorityField = makeField(
        "Priorité",
        PRIORITY_OPTIONS,
        priorities[number] || "",
        value => {
            if (value) {
                priorities[number] = value;
            } else {
                delete priorities[number];
            }
            writeTrackedMap(storagePrefix, "priorites", priorities);
        }
    );
    card.appendChild(priorityField);

    const remarkArea = el("textarea", "remark-textarea",
        remarks[number] || "");
    remarkArea.placeholder = "Votre remarque personnelle…";
    remarkArea.rows = 3;
    remarkArea.addEventListener("blur", function () {
        const value = this.value;
        if (value) {
            remarks[number] = value;
        } else {
            delete remarks[number];
        }
        writeTrackedMap(storagePrefix, "remarques", remarks);
    });
    const remarkLabel = el("label", "field");
    remarkLabel.appendChild(el("span", "field-label", "Remarque"));
    remarkLabel.appendChild(remarkArea);
    card.appendChild(remarkLabel);

    return card;
}

function makeField(labelText, options, current, onChange) {
    const wrap = el("label", "field");
    wrap.appendChild(el("span", "field-label", labelText));
    const select = document.createElement("select");
    options.forEach(option => {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        select.appendChild(opt);
    });
    select.value = current;
    select.addEventListener("change", () => onChange(select.value));
    wrap.appendChild(select);
    return wrap;
}

document.addEventListener("DOMContentLoaded", main);

document.addEventListener(SUIVI_EVENT, function () {
    main();
});
