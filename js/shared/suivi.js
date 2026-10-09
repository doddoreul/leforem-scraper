/* ============================================================
   DONNÉES — export / import partagés entre les pages

   Les données sont séparées en deux familles, exportables dans
   deux fichiers JSON distincts :
   - les données utilisateur (profil, entreprises, liste noire,
     suivi) ;
   - le scraping (offres, détails, historiques, état du scraping).
   Un import restaure ce que contient le fichier, sans toucher au
   reste. Voir python/migration.py.
   ============================================================ */

import { loadAllTracking } from "./storage.js";

export const SUIVI_EVENT = "foremsuiviimported";

/**
 * The "Données" entries of the cogwheel menu, identical on every page.
 * @type {Array<{id: string, label: string, title: string,
 *               type?: string, accept?: string}>}
 */
export const TRACKING_GEAR_ACTIONS = [
    {
        id: "exportUserdataBtn",
        label: "Exporter les données utilisateur",
        title: "Profil, entreprises, liste noire et suivi, en un fichier JSON"
    },
    {
        id: "exportScrapingBtn",
        label: "Exporter le scraping",
        title: "Offres scrapées, détails, historiques et état du scraping, en un fichier JSON"
    },
    {
        id: "importDataInput",
        label: "Importer des données",
        title: "Restaurer des données utilisateur, un scraping ou une sauvegarde complète",
        type: "file",
        accept: ".json,application/json"
    }
];

function localDateString(date) {
    const d = date || new Date();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + month + "-" + day;
}

function downloadJson(filename, content) {
    const blob = new Blob([content], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export function showSuiviToast(text) {
    let toast = document.getElementById("suiviToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "suiviToast";
        toast.className = "suivi-toast";
        toast.setAttribute("role", "status");
        document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add("visible");
    clearTimeout(toast.hideTimer);
    toast.hideTimer = setTimeout(function () {
        toast.classList.remove("visible");
    }, 6000);
}

export function showTrackingMessage(text) {
    const message = document.getElementById("trackingMessage");
    if (!message) {
        showSuiviToast(text);
        return;
    }
    message.textContent = text;
    setTimeout(function () { message.textContent = ""; }, 6000);
}

/**
 * Download a server-side export document, named like the server names it.
 * @param {string} path the export route
 * @param {string} filename the file name the download should keep
 * @param {string} okMessage shown once the download started
 */
function downloadExport(path, filename, okMessage) {
    fetch(path)
        .then(function (response) {
            if (!response.ok) throw new Error("HTTP " + response.status);
            return response.text();
        })
        .then(function (text) {
            downloadJson(filename, text);
            showTrackingMessage(okMessage);
        })
        .catch(function () {
            showTrackingMessage("Export impossible : le serveur ne répond pas.");
        });
}

/** Export the profile, employers, blacklist and follow-up only. */
export function exportUserdata() {
    downloadExport(
        "/api/export/userdata",
        "leforem-scraper-donnees-utilisateur-" + localDateString() + ".json",
        "Données utilisateur exportées."
    );
}

/** Export the scraped offers, details, histories and scraping state only. */
export function exportScraping() {
    downloadExport(
        "/api/export/scraping",
        "leforem-scraper-scraping-" + localDateString() + ".json",
        "Scraping exporté."
    );
}

/**
 * Restore a file produced by one of the exports (userdata, scraping or
 * complete). Only the data actually present in the file is replaced; the
 * backend is authoritative, so the local mirror is reloaded afterwards.
 * @param {File} file
 */
export function importDataFile(file) {
    if (!file) return;
    if (!window.confirm(
        "L'import restaure les données du fichier : sur cet ordinateur, " +
        "toutes les données correspondantes déjà présentes seront " +
        "remplacées (données utilisateur, et le scraping si le fichier en " +
        "contient). Continuer ?"
    )) return;

    const reader = new FileReader();
    reader.onload = function () {
        let parsed;
        try {
            parsed = JSON.parse(reader.result);
        } catch (error) {
            showTrackingMessage("Fichier invalide : JSON illisible.");
            return;
        }
        if (!parsed || parsed.format !== "leforem-scraper") {
            showTrackingMessage("Ce fichier n'est pas un export leforem-scraper.");
            return;
        }
        fetch("/api/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: reader.result
        })
            .then(function (response) {
                return response.json().then(function (data) {
                    return { ok: response.ok, data: data };
                });
            })
            .then(function (result) {
                const data = result.data || {};
                if (result.ok && data.ok) {
                    return loadAllTracking().then(function () {
                        return data;
                    });
                }
                throw {
                    handled: true,
                    message: data.error || "réponse inattendue."
                };
            })
            .then(function (data) {
                document.dispatchEvent(new CustomEvent(SUIVI_EVENT));
                const parts = [];
                if (data.recherches) {
                    parts.push(data.recherches + " recherche(s)");
                }
                if (data.offres) {
                    parts.push(data.offres + " offre(s)");
                }
                if (data.details) {
                    parts.push(data.details + " détail(s)");
                }
                if (data.suivi) {
                    parts.push(data.suivi + " offre(s) suivie(s)");
                }
                showTrackingMessage(
                    "Import terminé : " + (parts.join(", ") || "données restaurées.")
                );
            })
            .catch(function (error) {
                if (error && error.handled) {
                    showTrackingMessage("Import refusé : " + error.message);
                } else {
                    showTrackingMessage("Import impossible : le serveur ne répond pas.");
                }
            });
    };
    reader.onerror = function () {
        showTrackingMessage("Impossible de lire le fichier.");
    };
    reader.readAsText(file, "utf-8");
}

export function setupSuiviActions() {
    const userdataBtn = document.getElementById("exportUserdataBtn");
    if (userdataBtn) {
        userdataBtn.addEventListener("click", exportUserdata);
    }
    const scrapingBtn = document.getElementById("exportScrapingBtn");
    if (scrapingBtn) {
        scrapingBtn.addEventListener("click", exportScraping);
    }
    const importInput = document.getElementById("importDataInput");
    if (importInput) {
        importInput.addEventListener("change", function () {
            importDataFile(this.files && this.files[0]);
            this.value = "";
        });
    }
}