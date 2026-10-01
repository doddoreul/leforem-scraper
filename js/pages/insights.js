/* ============================================================
   DASHBOARD (LE FOREM MONITOR)
   Vue d'ensemble : KPIs, évolution des scrapings, statistiques
   par recherche (ou toutes recherches), répartition du suivi,
   nouvelles offres.
   ============================================================ */

import { fetchJsonOrNull, fetchScrapings } from "../shared/api.js";
import { parseForemDate } from "../shared/dates.js";
import { el } from "../shared/dom.js";
import { detailHref } from "../shared/links.js";
import {
    STORAGE_KEY,
    createScrapingSelector,
    filterScrapings,
    getScrapingByKey,
} from "../shared/scraping-selector.js";
import { STATUS_OPTIONS, statusLabel } from "../shared/statuses.js";
import { migrateLegacyStorage, readTrackedMap, storagePrefixFor } from "../shared/storage.js";
import { SUIVI_EVENT, TRACKING_GEAR_ACTIONS, setupSuiviActions } from "../shared/suivi.js";
import { THEME_EVENT, initTheme } from "../shared/theme.js";
import { normalizeText } from "../shared/text.js";
import "../shared/navbar.js";

const STATE_TXT = {
    new: "Nouvelle",
    reappeared: "De retour",
    old: "Ancienne",
    deleted: "Supprimée",
};

let scrapings = [];
let scope = "all";
let scopeFile = "all";
let dataSets = [];
let lastScrapeHistory = null;

// Run migration immediately so it's done before any UI uses the keys.
migrateLegacyStorage();

initTheme(TRACKING_GEAR_ACTIONS);

function readScopeFile() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === "all") return "all";
        const found = getScrapingByKey(scrapings, raw);
        if (found) return found.file;
    } catch (e) {
        // ignore
    }
    return "all";
}

function readScope() {
    // Backward compatibility: returns name for prefix
    const file = readScopeFile();
    if (file === "all") return "all";
    const found = getScrapingByKey(scrapings, file);
    return found ? found.name : "all";
}

function populateScopeSelect() {
    const select = document.getElementById("dashScope");
    if (!select) return Promise.resolve();

    return createScrapingSelector({
        selectId: "dashScope",
        allowAll: true,       // "Toutes les recherches"
        allowCreate: true,    // "Créer un nouveau scrap"
        onChange: function (key) {
            if (key === "all") {
                scope = "all";
                scopeFile = "all";
            } else {
                const found = scrapings.find(function (s) { return s.file === key; });
                if (found) {
                    scope = found.name;
                    scopeFile = found.file;
                } else {
                    scope = "all";
                    scopeFile = "all";
                }
            }
            try {
                localStorage.setItem(STORAGE_KEY, scopeFile);
            } catch (e) {
                // ignore
            }
            refresh();
        }
    });
}

function scopeEntries() {
    return filterScrapings(scrapings, scopeFile);
}

function offerState(offer) {
    if (offer.offer_state) return offer.offer_state;
    return offer.is_new === true ? "new" : "old";
}

function formatDay(value) {
    const d = parseForemDate(value);
    if (!d) return value || "";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return dd + "/" + mm;
}

function formatRelative(value) {
    const d = parseForemDate(value);
    if (!d) return value || "";
    const n = Math.round((d.getTime() - Date.now()) / 86400000);
    if (n === 0) return "aujourd'hui";
    if (n < 0) {
        const q = -n;
        return q === 1 ? "il y a 1 jour" : "il y a " + q + " jours";
    }
    return n === 1 ? "dans 1 jour" : "dans " + n + " jours";
}

function offerDetailHref(entryName, number) {
    return detailHref(number, entryName);
}

// ============================================================
// Aggregation helpers
// ============================================================

function collectOffers() {
    const offers = [];
    const byNumber = {};
    dataSets.forEach(ds => {
        (ds.offers || []).forEach(offer => {
            offers.push(offer);
            byNumber[String(offer.number)] = offer;
        });
    });
    return { offers, byNumber };
}

function collectiveCounts() {
    const counts = { new: 0, reappeared: 0, old: 0 };
    collectOffers().offers.forEach(offer => {
        const state = offerState(offer);
        if (counts[state] === undefined) counts[state] = 0;
        counts[state]++;
    });
    return counts;
}

function statusCounts() {
    const counts = {};
    dataSets.forEach(ds => {
        const map = readTrackedMap(ds.prefix, "statuts");
        Object.values(map).forEach(value => {
            if (value) counts[value] = (counts[value] || 0) + 1;
        });
    });
    return counts;
}

function trackedTotals() {
    let suivies = 0;
    let favoris = 0;
    let priorites = 0;
    dataSets.forEach(ds => {
        suivies += Object.values(readTrackedMap(ds.prefix, "statuts"))
            .filter(Boolean).length;
        favoris += Object.values(readTrackedMap(ds.prefix, "favoris"))
            .filter(Boolean).length;
        priorites += Object.values(readTrackedMap(ds.prefix, "priorites"))
            .filter(Boolean).length;
    });
    return { suivies, favoris, priorites };
}

function deletedCount() {
    return dataSets.reduce((sum, ds) => sum + (ds.deleted || []).length, 0);
}

function lastScrapeTimestamp() {
    const ts = dataSets
        .map(ds => ds.entry.scrape_timestamp || "")
        .filter(Boolean)
        .sort()
        .pop();
    return ts || null;
}

function extractHourlyValues(payText) {
    const values = [];
    const pattern = /(\d{1,3}(?:,\d{1,2})?)\s*(?:€|euros?)?\s*de l'heure/gi;
    let m;
    while ((m = pattern.exec(payText || "")) !== null) {
        values.push(parseFloat(m[1].replace(",", ".")));
    }
    return values;
}

// ============================================================
// Rendering
// ============================================================

function render(scrapeHistory) {
    const empty = !collectOffers().offers.length && !deletedCount();
    document.getElementById("dashEmpty").classList.toggle("hidden", !empty);
    if (empty) {
        renderEvolution(scrapeHistory);
        return;
    }
    renderKpis();
    renderStatusBars();
    renderNewList();
    renderDistribution("lieux", offer => offer.location);
    renderContracts();
    renderSchedules();
    renderSalaires();
    renderEvolution(scrapeHistory);
    renderScrapesTable(scrapeHistory);
}

function renderKpis() {
    const root = document.getElementById("kpiRow");
    const counts = collectiveCounts();
    const totals = trackedTotals();
    const lastTs = lastScrapeTimestamp();

    const items = [
        ["Offres", totalOffers(), "cyan"],
        ["Nouvelles", counts.new, "green"],
        ["Revenues", counts.reappeared, "magenta"],
        ["Supprimées", deletedCount(), "red"],
        ["Suivies", totals.suivies, "cyan"],
        ["Favoris", totals.favoris, "yellow"],
        ["Dernier scraping", lastTs ? "il y a " +
            formatRelative(lastTs) : "—", "magenta"],
    ];

    root.innerHTML = "";
    items.forEach(([label, value, color]) => {
        const card = el("div", "dash-kpi kpi-" + color);
        card.appendChild(el("span", "dash-kpi-label", label));
        const strong = el("strong", "dash-kpi-value");
        if (typeof value === "number") {
            strong.textContent = String(value);
        } else {
            card.appendChild(el("span", "dash-kpi-text", value));
            strong.textContent = "";
        }
        if (strong.textContent !== "") card.appendChild(strong);
        root.appendChild(card);
    });
}

function totalOffers() {
    return collectOffers().offers.length;
}

function renderStatusBars() {
    const root = document.getElementById("statusBars");
    const counts = statusCounts();
    const max = Math.max(1, ...Object.values(counts));
    root.innerHTML = "";
    STATUS_OPTIONS.forEach(({ value, label }) => {
        const count = counts[value] || 0;
        const row = el("div", "dash-bar-row");
        const lab = el("span", "dash-bar-label", label);
        row.appendChild(lab);
        const track = el("div", "dash-bar-track");
        const fill = el("div", "dash-bar-fill");
        fill.style.width = (count / max) * 100 + "%";
        track.appendChild(fill);
        row.appendChild(track);
        const num = el("span", "dash-bar-count", String(count));
        row.appendChild(num);
        root.appendChild(row);
    });
}

function renderNewList() {
    const root = document.getElementById("newList");
    const entries = dataSets.flatMap(ds =>
        (ds.offers || [])
            .filter(o => offerState(o) === "new" || offerState(o) === "reappeared")
            .map(o => ({ ds, offer: o }))
    );
    entries.sort((a, b) => {
        const da = parseForemDate(a.offer.published_on) || new Date(0);
        const db = parseForemDate(b.offer.published_on) || new Date(0);
        return db - da;
    });
    root.innerHTML = "";
    if (!entries.length) {
        root.appendChild(el("li", "dash-none", "Aucune nouvelle offre détectée."));
        return;
    }
    entries.slice(0, 12).forEach(({ ds, offer }) => {
        const li = el("li", "dash-list-item");
        const date = formatDay(offer.published_on || "");
        li.appendChild(el("span", "dash-list-date", date));
        const link = el("a", "dash-list-link",
            offer.offer_title || "(Sans titre)");
        link.href = offerDetailHref(ds.entry.name, offer.number);
        link.target = "_blank";
        li.appendChild(link);
        const badge = el(
            "span",
            "state-badge state-" + offerState(offer),
            STATE_TXT[offerState(offer)] || offerState(offer)
        );
        li.appendChild(badge);
        root.appendChild(li);
    });
}

function renderDistribution(cardId, pick) {
    const root = document.getElementById(cardId + "Bars");
    const counts = {};
    collectOffers().offers.forEach(offer => {
        const key = pick(offer);
        if (!key) return;
        counts[key] = (counts[key] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...sorted.map(e => e[1]));
    root.innerHTML = "";
    if (!sorted.length) {
        root.appendChild(el("div", "dash-none", "Aucune donnée."));
        return;
    }
    sorted.slice(0, 8).forEach(([label, count]) => {
        const row = el("div", "dash-bar-row");
        const lab = el("span", "dash-bar-label dash-bar-label-flex",
            String(label));
        lab.title = String(label);
        row.appendChild(lab);
        const track = el("div", "dash-bar-track");
        const fill = el("div", "dash-bar-fill");
        fill.style.width = (count / max) * 100 + "%";
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("span", "dash-bar-count", String(count)));
        root.appendChild(row);
    });
}

function bucketContract(contractType) {
    const text = normalizeText(contractType);
    if (text.indexOf("indeterminee") !== -1) return "CDI";
    if (text.indexOf("determinee") !== -1) return "CDD";
    if (text.indexOf("interim") !== -1) return "Intérim";
    return "Autre";
}

function renderContracts() {
    const root = document.getElementById("contratsBars");
    const counts = {};
    collectOffers().offers.forEach(offer => {
        const bucket = bucketContract(offer.contract_type);
        counts[bucket] = (counts[bucket] || 0) + 1;
    });
    const max = Math.max(1, ...Object.values(counts));
    root.innerHTML = "";
    ["CDI", "CDD", "Intérim", "Autre"].forEach(label => {
        const count = counts[label] || 0;
        const row = el("div", "dash-bar-row");
        row.appendChild(el("span", "dash-bar-label", label));
        const track = el("div", "dash-bar-track");
        const fill = el("div", "dash-bar-fill");
        fill.style.width = (count / max) * 100 + "%";
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("span", "dash-bar-count", String(count)));
        root.appendChild(row);
    });
}

function bucketSchedule(offer) {
    const text = normalizeText(offer.schedule);
    if (text.indexOf("temps plein") !== -1) return "Temps plein";
    if (text.indexOf("temps partiel") !== -1) return "Temps partiel";
    return "Autre";
}

function renderSchedules() {
    const root = document.getElementById("horairesBars");
    const counts = {};
    collectOffers().offers.forEach(offer => {
        const bucket = bucketSchedule(offer);
        counts[bucket] = (counts[bucket] || 0) + 1;
    });
    const max = Math.max(1, ...Object.values(counts));
    root.innerHTML = "";
    ["Temps plein", "Temps partiel", "Autre"].forEach(label => {
        const count = counts[label] || 0;
        const row = el("div", "dash-bar-row");
        row.appendChild(el("span", "dash-bar-label", label));
        const track = el("div", "dash-bar-track");
        const fill = el("div", "dash-bar-fill");
        fill.style.width = (count / max) * 100 + "%";
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("span", "dash-bar-count", String(count)));
        root.appendChild(row);
    });
}

function renderSalaires() {
    const root = document.getElementById("salaireStats");
    const offers = collectOffers().offers;
    let known = 0;
    const hourlyPerOffer = [];
    offers.forEach(offer => {
        const pay = offer.pay || "";
        const salary = offer.salary || "";
        const text = normalizeText(String(pay || salary));
        if (!text) return;
        known++;
        const values = extractHourlyValues(String(pay || salary));
        if (values.length) {
            const mean = values.reduce((a, b) => a + b, 0) / values.length;
            hourlyPerOffer.push(mean);
        }
    });
    root.innerHTML = "";
    const rows = [
        ["Renseignée", known],
        ["Non renseignée", offers.length - known],
    ];
    const max = Math.max(1, offers.length);
    rows.forEach(([label, count]) => {
        const row = el("div", "dash-bar-row");
        row.appendChild(el("span", "dash-bar-label", label));
        const track = el("div", "dash-bar-track");
        const fill = el("div", "dash-bar-fill");
        fill.style.width = (count / max) * 100 + "%";
        track.appendChild(fill);
        row.appendChild(track);
        row.appendChild(el("span", "dash-bar-count", String(count)));
        root.appendChild(row);
    });
    if (hourlyPerOffer.length) {
        const mean =
            hourlyPerOffer.reduce((a, b) => a + b, 0) / hourlyPerOffer.length;
        const note = el("div", "dash-note");
        note.textContent = "Moyenne horaire : " + mean.toFixed(2) +
            " €/h (sur " + hourlyPerOffer.length + " offre" +
            (hourlyPerOffer.length > 1 ? "s" : "") + ")";
        root.appendChild(note);
    } else {
        root.appendChild(el("div", "dash-note",
            "Aucune valeur horaire exploitable."));
    }
}

function renderEvolution(scrapeHistory) {
    const canvas = document.getElementById("evolutionCanvas");
    const note = document.getElementById("evolutionNote");
    const records = (scrapeHistory && Array.isArray(scrapeHistory.scrapes))
        ? scrapeHistory.scrapes.slice() : [];
    const filtered = scope === "all"
        ? records
        : records.filter(r => r.search === scope);
    if (!filtered.length) {
        note.textContent = "Pas encore d'historique de scrapings.";
        drawChart(canvas, [], []);
        return;
    }
    const points = filtered.map(r => r.total_offres);
    const labels = filtered.map(r =>
        formatDay(r.timestamp) +
        (r.label || r.search ? " · " + (r.label || r.search) : "")
    );
    note.textContent = filtered.length + " scraping(s) enregistré(s).";
    drawChart(canvas, points, labels);
}

function cssVar(node, name, fallback) {
    const value = getComputedStyle(node).getPropertyValue(name).trim();
    return value || fallback;
}

function drawChart(canvas, points, labels) {
    const parent = canvas.parentElement;
    const height = parseInt(
        getComputedStyle(parent).getPropertyValue(
            "--dash-chart-height") || "200", 10
    );
    const gridColor = cssVar(canvas, "--dash-line", "#D6E1E3");
    const axisColor = cssVar(canvas, "--dash-text-secondary", "#698696");
    const labelColor = cssVar(canvas, "--dash-muted", "#698696");
    const accentColor = cssVar(canvas, "--dash-cyan", "#5289AD");
    canvas.height = height;
    const width = canvas.clientWidth || 600;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.height = height + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, height);

    const padL = 42;
    const padR = 14;
    const padT = 12;
    const padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    if (!points.length) return;

    const maxV = Math.max(...points, 1);
    const step = Math.ceil(maxV / 4);
    const top = Math.ceil(maxV / step) * step;

    ctx.font = "11px system-ui, sans-serif";
    for (let i = 0; i <= 4; i++) {
        const v = (top / 4) * i;
        const y = padT + plotH - (v / top) * plotH;
        ctx.strokeStyle = gridColor;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(width - padR, y);
        ctx.stroke();
        ctx.fillStyle = axisColor;
        ctx.textAlign = "right";
        ctx.fillText(String(Math.round(v)), padL - 8, y + 4);
    }

    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
        const x = plotW === 0 ? 0 : padL + (i * (plotW / (points.length - 1)));
        const y = padT + plotH - (p / top) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = accentColor;
    points.forEach((p, i) => {
        const x = plotW === 0 ? 0 : padL + (i * (plotW / (points.length - 1)));
        const y = padT + plotH - (p / top) * plotH;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.fillStyle = labelColor;
    ctx.textAlign = "center";
    const labelEvery = Math.ceil(labels.length / 8);
    labels.forEach((label, i) => {
        if (i % labelEvery !== 0 && i !== labels.length - 1) return;
        const x = plotW === 0 ? 0 : padL + (i * (plotW / (points.length - 1)));
        ctx.fillText(label, x, height - 8);
    });
}

function renderScrapesTable(scrapeHistory) {
    const tbody = document.getElementById("scrapesTable");
    const records = (scrapeHistory && Array.isArray(scrapeHistory.scrapes))
        ? scrapeHistory.scrapes.slice() : [];
    const filtered = scope === "all"
        ? records
        : records.filter(r => r.search === scope);
    tbody.innerHTML = "";
    if (!filtered.length) {
        const tr = document.createElement("tr");
        const td = el("td", "", "Aucun scraping enregistré.");
        td.colSpan = 6;
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }
    filtered.slice().reverse().slice(0, 30).forEach(r => {
        const tr = document.createElement("tr");
        [
            formatDay(r.timestamp),
            r.label || r.search || "Recherche principale",
            r.total_offres,
            r.nouvelles,
            r.reapparues,
            r.supprimees,
        ].forEach(text => {
            const td = document.createElement("td");
            td.textContent = text === undefined ? "" : String(text);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}

function showEmpty() {
    document.getElementById("dashEmpty").classList.remove("hidden");
}

async function refresh() {
    const entries = scopeEntries();
    dataSets = await Promise.all(entries.map(async entry => {
        const data = await fetchJsonOrNull(entry.file);
        const hist = await fetchJsonOrNull(entry.history);
        return {
            entry,
            prefix: storagePrefixFor(entry.name),
            offers: data && Array.isArray(data.offers) ? data.offers : [],
            deleted: hist && Array.isArray(hist.offers) ? hist.offers : [],
        };
    }));
    const scrapeHistory = await fetchJsonOrNull("/historique_scrapes.json");
    lastScrapeHistory = scrapeHistory;
    render(scrapeHistory);
}

async function init() {
    setupSuiviActions();
    scrapings = await fetchScrapings();
    if (!scrapings.length) {
        showEmpty();
        return;
    }
    // Initialize both scope (name for prefix) and scopeFile (file for filtering)
    const stored = readScopeFile();
    if (stored === "all") {
        scope = "all";
        scopeFile = "all";
    } else {
        const found = getScrapingByKey(scrapings, stored);
        if (found) {
            scope = found.name;
            scopeFile = found.file;
        } else {
            scope = "all";
            scopeFile = "all";
        }
    }
    await populateScopeSelect();
    await refresh();

    // Handle "Créer un nouveau scrap" from shared selector
    document.addEventListener("foremCreateScrape", function () {
        window.open("index.html", "_blank");
    });
}

document.addEventListener("DOMContentLoaded", init);

document.addEventListener(THEME_EVENT, function () {
    if (lastScrapeHistory) render(lastScrapeHistory);
});

document.addEventListener(SUIVI_EVENT, refresh);