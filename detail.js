/* ============================================================
   DETAIL PAGE (fiche façon Le Forem)
   Rendu complet de l'offre depuis le JSON de détail brut
   stocké dans data/details*.json, + suivi personnel.
   ============================================================ */

const DETAIL_STATUS_OPTIONS = [
    { value: "", label: "Non trié" },
    { value: "interesse", label: "Intéressé" },
    { value: "pas_interesse", label: "Pas intéressé" },
    { value: "postule", label: "Postulé" },
    { value: "contacte", label: "Contacté" },
    { value: "refuse", label: "Refusé" },
    { value: "rdv", label: "RDV prévu" },
];

const DETAIL_PRIORITY_OPTIONS = [
    { value: "", label: "Aucune" },
    { value: "haute", label: "Haute" },
    { value: "moyenne", label: "Moyenne" },
    { value: "faible", label: "Faible" },
];

const DEFAULT_PREFIX = "forem__";

const params = new URLSearchParams(window.location.search);
const numberStr = (params.get("number") || "").trim();
const baseName = (params.get("base") || "").trim();

const storagePrefix = baseName ? "forem_" + baseName + "_" : DEFAULT_PREFIX;

function storageGet(suffix) {
    try {
        const raw = localStorage.getItem(storagePrefix + suffix);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function storageSet(suffix, value) {
    try {
        localStorage.setItem(storagePrefix + suffix, JSON.stringify(value));
    } catch (e) {
        console.error("Unable to write localStorage", e);
    }
}

function statusesValue() { return storageGet("statuts") || {}; }
function remarksValue() { return storageGet("remarques") || {}; }
function favoritesValue() { return storageGet("favoris") || {}; }
function prioritiesValue() { return storageGet("priorites") || {}; }
function statutDatesValue() { return storageGet("statut_dates") || {}; }

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

function parseForemDate(value) {
    if (!value) return null;
    const text = String(value).trim();
    let m = /^(\d{1,2})-(\d{1,2})-(\d{2})$/.exec(text);
    if (m) {
        const d = new Date("20" + m[3] + "-" + m[2] + "-" + m[1] + "T00:00:00");
        return isNaN(d.getTime()) ? null : d;
    }
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (m) {
        const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        return isNaN(d.getTime()) ? null : d;
    }
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
    if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
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

function formatDate(date) {
    if (!date) return "";
    return date.toLocaleDateString("fr-BE", { year: "numeric", month: "long", day: "numeric" });
}

function offerUrl(number) {
    return "https://www.leforem.be/recherche-offres/offre-detail/" +
        encodeURIComponent(number) + "?originPostuler=RECHOFFRE";
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
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
// MAIN
// ============================================================

function main() {
    const root = document.getElementById("detailRoot");
    if (!root) return;

    if (!numberStr) {
        renderNotAvailable(root, "Aucun numéro d'offre fourni dans l'URL.");
        return;
    }

    fetch("/api/scrapings")
        .then(r => r.json())
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
    const detailsPromise = fetch(entry.details).then(r => r.json())
        .catch(() => null);
    const modsPromise = fetch(entry.modifications).then(r => r.json())
        .catch(() => null);

    Promise.all([detailsPromise, modsPromise])
        .then(([detailsData, modifications]) => {
            const store = (detailsData && detailsData.details)
                ? detailsData.details : null;
            const payload = store ? store[numberStr] : null;
            const events = extractEvents(modifications);

            if (!payload) {
                renderNotAvailable(
                    root,
                    "Le détail complet de l'offre " + numberStr +
                    " n'a pas encore été enregistré."
                );
                return;
            }

            renderFiche(root, payload, events);
        })
        .catch(err => {
            renderNotAvailable(root, "Impossible de charger les données : "
                + err.message);
        });
}

function extractEvents(modifications) {
    if (!modifications || !modifications.offers) return [];
    const list = modifications.offers[numberStr];
    return Array.isArray(list) ? list.slice() : [];
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
    back.href = "index.html";
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

function renderFiche(root, payload, events) {
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
        "Publié le " + formatDate(published) + " (" + formatRelative(published) + ")"
    ));
    if (debut && !published) dates.appendChild(el(
        "span", "date-hint",
        "Diffusion débutée le " + formatDate(debut)
    ));
    if (fin) dates.appendChild(el(
        "span", "date-hint date-expiry",
        "Expire le " + formatDate(fin) + " (" + formatRelative(fin) + ")"
    ));
    if (modif) dates.appendChild(el(
        "span", "date-hint", "Modifiée le " + formatDate(modif)
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

    // Historique des modifications
    if (events.length) {
        const histCard = el("section", "card");
        histCard.appendChild(el(
            "h2", "card-title",
            "Historique des modifications (" + events.length + ")"
        ));
        histCard.appendChild(buildTimeline(events, number));
        root.appendChild(histCard);
    }
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
        storageSet("favoris", favorites);
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
        DETAIL_STATUS_OPTIONS,
        statuses[number] || "",
        value => {
            statuses[number] = value;
            storageSet("statuts", statuses);
            if (value) {
                statutDates[number] = new Date().toISOString();
                storageSet("statut_dates", statutDates);
            } else {
                delete statutDates[number];
                storageSet("statut_dates", statutDates);
            }
        }
    );
    card.appendChild(statusField);

    const priorityField = makeField(
        "Priorité",
        DETAIL_PRIORITY_OPTIONS,
        priorities[number] || "",
        value => {
            if (value) {
                priorities[number] = value;
            } else {
                delete priorities[number];
            }
            storageSet("priorites", priorities);
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
        storageSet("remarques", remarks);
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

// ============================================================
// TIMELINE
// ============================================================

function buildTimeline(events) {
    const list = el("ul", "detail-timeline");
    events.slice().reverse().forEach(entry => {
        const item = el("li", "detail-timeline-item");
        item.appendChild(el("span", "detail-timeline-date",
            entry.date || ""));

        if (entry.event === "created") {
            item.appendChild(el(
                "span", "detail-timeline-pill state-new", "Créée / détectée"
            ));
        } else if (entry.event === "reappeared") {
            item.appendChild(el(
                "span", "detail-timeline-pill state-reappeared", "De retour"
            ));
        } else if (entry.event === "deleted") {
            item.appendChild(el(
                "span", "detail-timeline-pill state-deleted", "Retirée"
            ));
        } else {
            const changes = entry.changes || {};
            Object.keys(changes).forEach(field => {
                const change = changes[field] || {};
                const oldText = String(change.old !== undefined ? change.old : "");
                const newText = String(change.new !== undefined ? change.new : "");
                const line = el("span", "detail-change");
                line.appendChild(el("strong", "detail-change-field", field));
                line.appendChild(document.createTextNode(" : "));
                line.appendChild(el("span", "detail-change-old", oldText));
                line.appendChild(el("span", "detail-change-arrow", " → "));
                line.appendChild(el("span", "detail-change-new", newText));
                item.appendChild(line);
            });
        }
        list.appendChild(item);
    });
    return list;
}

document.addEventListener("DOMContentLoaded", main);