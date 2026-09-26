/* ============================================================
   DETAIL PAGE
   Vue détail d'une offre (actuelle ou supprimée) + historique
   des modifications + suivi personnel.
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

const STATE_BADGE_TEXT = {
    new: "Nouvelle",
    updated: "Modifiée",
    reappeared: "De retour",
    old: "Ancienne",
    deleted: "Supprimée",
};

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

function statusesValue() {
    return storageGet("statuts") || {};
}

function remarksValue() {
    return storageGet("remarques") || {};
}

function favoritesValue() {
    return storageGet("favoris") || {};
}

function prioritiesValue() {
    return storageGet("priorites") || {};
}

function statutDatesValue() {
    return storageGet("statut_dates") || {};
}

function normalizeText(value) {
    return String(value || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
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
        return q === 1 ? "il y a 1 jour" : "il y a " + q + " jours";
    }
    return n === 1 ? "dans 1 jour" : "dans " + n + " jours";
}

function offerState(offer, inHistory) {
    if (inHistory) return "deleted";
    if (offer.offer_state) return offer.offer_state;
    return offer.is_new === true ? "new" : "old";
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function main() {
    const root = document.getElementById("detailRoot");
    if (!numberStr) {
        showError(root, "Aucun numéro d'offre fourni dans l'URL.");
        return;
    }

    Promise.all([
        fetch("/api/scrapings").then(r => r.json()),
    ]).then(([scrapings]) => {
        const entry = (scrapings || []).find(e => e.name === baseName)
            || (scrapings || []).find(e => e.name === "")
            || null;
        if (!entry) {
            showError(root, "Aucune recherche trouvée. Lance un scraping puis recharge.");
            return;
        }
        fetchEntry(entry, root);
    }).catch(err => {
        showError(root, "Impossible de charger les données : " + err.message);
    });
}

function fetchEntry(entry, root) {
    const dataPromise = fetch(entry.file).then(r => r.json());
    const historyPromise = fetch(entry.history).then(r => r.json())
        .catch(() => null);
    const modsPromise = fetch(entry.modifications).then(r => r.json())
        .catch(() => null);

    Promise.all([dataPromise, historyPromise, modsPromise])
        .then(([data, history, modifications]) => {
            const offers = (data && Array.isArray(data.offers)) ? data.offers : [];
            const deleted = (history && Array.isArray(history.offers))
                ? history.offers : [];
            const offer = offers.find(o => String(o.number) === numberStr);
            const inHistory = Boolean(!offer && deleted.find(
                o => String(o.number) === numberStr
            ));
            const target = offer || deleted.find(o => String(o.number) === numberStr);
            const events = extractEvents(modifications);
            render(root, entry, target, inHistory, events);
        })
        .catch(err => {
            showError(root, "Impossible de charger les données : " + err.message);
        });
}

function extractEvents(modifications) {
    if (!modifications || !modifications.offers) return [];
    const list = modifications.offers[numberStr];
    return Array.isArray(list) ? list.slice() : [];
}

function render(root, entry, offer, inHistory, events) {
    if (!offer) {
        showError(root, "Offre " + numberStr + " introuvable dans « " +
            (entry.label || entry.name || "Recherche principale") + " ».");
        return;
    }

    const number = String(offer.number);

    let statuses = statusesValue();
    let remarks = remarksValue();
    let favorites = favoritesValue();
    let priorities = prioritiesValue();
    let statutDates = statutDatesValue();

    const state = offerState(offer, inHistory);

    root.innerHTML = "";

    const head = el("div", "detail-head");
    root.appendChild(head);

    const titleLine = el("div", "detail-title-line");
    head.appendChild(titleLine);

    const badge = el("span", "state-badge state-" + state,
        STATE_BADGE_TEXT[state] || state);
    titleLine.appendChild(badge);

    const title = el("h1", "detail-title", offer.offer_title || "(Sans titre)");
    titleLine.appendChild(title);

    const subtitle = el("p", "detail-sub");
    subtitle.textContent = [
        number,
        offer.company || "",
        offer.location || "",
    ].filter(Boolean).join(" · ");
    head.appendChild(subtitle);

    const actions = el("div", "detail-actions");
    head.appendChild(actions);

    const star = document.createElement("button");
    star.type = "button";
    star.className = "star-button";
    const isFav = Boolean(favorites[number]);
    star.textContent = isFav ? "★" : "☆";
    star.title = "Marquer comme favori";
    star.setAttribute("aria-pressed", isFav ? "true" : "false");
    star.addEventListener("click", () => {
        const active = !favorites[number];
        favorites[number] = active;
        storageSet("favoris", favorites);
        star.textContent = active ? "★" : "☆";
        star.classList.toggle("active", active);
        star.setAttribute("aria-pressed", active ? "true" : "false");
    });
    actions.appendChild(star);

    const statusSelect = makeSelect(
        DETAIL_STATUS_OPTIONS,
        statuses[number] || "",
        "Statut :",
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
    actions.appendChild(statusSelect);

    const prioritySelect = makeSelect(
        DETAIL_PRIORITY_OPTIONS,
        priorities[number] || "",
        "Priorité :",
        value => {
            if (value) {
                priorities[number] = value;
            } else {
                delete priorities[number];
            }
            storageSet("priorites", priorities);
        }
    );
    actions.appendChild(prioritySelect);

    const remarkArea = el("textarea", "detail-remark",
        remarks[number] || "");
    remarkArea.placeholder = "Remarque personnelle…";
    remarkArea.rows = 3;
    remarkArea.addEventListener("blur", function () {
        remarks[number] = this.value;
        storageSet("remarques", remarks);
    });
    actions.appendChild(remarkArea);

    const linkBtn = el("a", "detail-forem-link", "Voir l'annonce sur Le Forem");
    linkBtn.href = offer.url || "#";
    linkBtn.target = "_blank";
    linkBtn.rel = "noopener noreferrer";
    actions.appendChild(linkBtn);

    const grid = el("div", "detail-grid");
    root.appendChild(grid);

    const infoCard = el("section", "detail-card");
    infoCard.appendChild(el("h2", "detail-card-title", "Informations"));
    infoCard.appendChild(buildInfoList(offer, inHistory));
    grid.appendChild(infoCard);

    if (offer.description) {
        const descCard = el("section", "detail-card",
            undefined);
        descCard.appendChild(el("h2", "detail-card-title", "Description"));
        const desc = el("div", "offer-description", offer.description);
        descCard.appendChild(desc);
        const toggle = el("button", "desc-toggle", "Afficher plus");
        toggle.type = "button";
        toggle.addEventListener("click", function () {
            const expanded = desc.classList.toggle("expanded");
            this.textContent = expanded ? "Afficher moins" : "Afficher plus";
        });
        descCard.appendChild(toggle);
        grid.appendChild(descCard);
    }

    if (events.length) {
        const histCard = el("section", "detail-card");
        histCard.appendChild(el(
            "h2", "detail-card-title",
            "Historique des modifications (" + events.length + ")"
        ));
        histCard.appendChild(buildTimeline(events));
        grid.appendChild(histCard);
    }
}

function makeSelect(options, current, labelText, onChange) {
    const wrap = el("label", "detail-select-wrap");
    const label = el("span", "detail-select-label", labelText);
    wrap.appendChild(label);
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

function buildInfoList(offer, inHistory) {
    const dl = el("dl", "detail-info");
    const rows = [];

    const published = parseForemDate(offer.date_publication || offer.published_on);
    const fin = parseForemDate(offer.date_fin_diffusion);
    const modif = parseForemDate(offer.date_modification);

    if (published) {
        rows.push(["Publié le", published.toLocaleDateString("fr-BE") +
            " (" + formatRelative(published) + ")"]);
    } else if (offer.published_on) {
        rows.push(["Publié le", offer.published_on]);
    }
    if (fin) {
        rows.push(["Expire le", fin.toLocaleDateString("fr-BE") +
            " (" + formatRelative(fin) + ")"]);
    }
    if (modif) {
        rows.push(["Modifiée le", modif.toLocaleDateString("fr-BE")]);
    }
    rows.push(["Métier", offer.metier]);
    rows.push(["Contrat", offer.contract_type]);
    rows.push(["Horaire", offer.schedule]);
    rows.push(["Rémunération", offer.pay]);
    rows.push(["Salaire", offer.salary]);
    rows.push(["Email", offer.email]);
    rows.push(["N° offre", offer.number]);
    if (inHistory) {
        rows.push(["État", "Annonce retirée de Le Forem"]);
    }

    rows.forEach(([labelText, value]) => {
        if (!value) return;
        const dt = el("dt", "detail-info-label", labelText + " :");
        dl.appendChild(dt);
        const dd = el("dd", "detail-info-value");
        if (labelText === "Email") {
            const address = String(value).split(",")[0].trim();
            const link = el("a", "detail-link", address);
            link.href = "mailto:" + address;
            dd.appendChild(link);
        } else {
            dd.textContent = value;
        }
        dl.appendChild(dd);
    });

    return dl;
}

function buildTimeline(events) {
    const list = el("ul", "detail-timeline");
    events.slice().reverse().forEach(entry => {
        const item = el("li", "detail-timeline-item");
        if (entry.event === "created") {
            item.appendChild(el("span", "detail-timeline-date",
                entry.date || ""));
            item.appendChild(el(
                "span", "detail-timeline-pill state-new", "Créée / détectée"
            ));
        } else if (entry.event === "reappeared") {
            item.appendChild(el("span", "detail-timeline-date",
                entry.date || ""));
            item.appendChild(el(
                "span", "detail-timeline-pill state-reappeared", "De retour"
            ));
        } else if (entry.event === "deleted") {
            item.appendChild(el("span", "detail-timeline-date",
                entry.date || ""));
            item.appendChild(el(
                "span", "detail-timeline-pill state-deleted", "Retirée"
            ));
        } else {
            item.appendChild(el("span", "detail-timeline-date",
                entry.date || ""));
            const changes = entry.changes || {};
            Object.keys(changes).forEach(field => {
                const change = changes[field] || {};
                const oldText = String(change.old !== undefined ? change.old : "");
                const newText = String(change.new !== undefined ? change.new : "");
                const line = el("span", "detail-change");
                line.appendChild(el(
                    "strong", "detail-change-field", field)
                );
                line.appendChild(document.createTextNode(" : "));
                const oldSpan = el("span", "detail-change-old", oldText);
                const arrow = el("span", "detail-change-arrow", " → ");
                const newSpan = el("span", "detail-change-new", newText);
                [oldSpan, arrow, newSpan].forEach(n => line.appendChild(n));
                item.appendChild(line);
            });
        }
        list.appendChild(item);
    });
    return list;
}

function showError(root, message) {
    const card = el("div", "detail-card");
    const title = el("h2", "detail-card-title", "Détail indisponible");
    card.appendChild(title);
    const p = el("p", "", message);
    card.appendChild(p);
    root.innerHTML = "";
    root.appendChild(card);
}

document.addEventListener("DOMContentLoaded", main);