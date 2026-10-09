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

import { loadAllTrackingFromServer } from "./storage.js";

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
        id: "importUserdataInput",
        label: "Importer les données utilisateur",
        title: "Restaurer un export de données utilisateur (profil, entreprises, liste noire, suivi)",
        type: "file",
        accept: ".json,application/json"
    },
    {
        id: "importScrapingInput",
        label: "Importer un scraping",
        title: "Restaurer un export de scraping (recherches, offres, détails, historiques)",
        type: "file",
        accept: ".json,application/json"
    },
    {
        id: "checkUpdatesBtn",
        label: "Vérifier les mises à jour",
        title: "Demander à GitHub si une nouvelle version est publiée"
    }
];

// Le scraping importé change les offres affichées : la page est rechargée
// peu après le message, pour que l'utilisateur ait le temps de le lire.
const RELOAD_DELAY_MS = 3000;

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

function showTrackingMessage(text) {
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
function exportUserdata() {
    downloadExport(
        "/api/export/userdata",
        "leforem-scraper-donnees-utilisateur-" + localDateString() + ".json",
        "Données utilisateur exportées."
    );
}

/** Export the scraped offers, details, histories and scraping state only. */
function exportScraping() {
    downloadExport(
        "/api/export/scraping",
        "leforem-scraper-scraping-" + localDateString() + ".json",
        "Scraping exporté."
    );
}

/**
 * Read a file as text, so the callers can await the whole import.
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileText(file) {
    return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.onload = function () { resolve(reader.result); };
        reader.onerror = function () { reject(new Error("lecture impossible")); };
        reader.readAsText(file, "utf-8");
    });
}

/**
 * Restore one kind of data from an exported file.
 *
 * Each button handles its own file: the import only replaces what the file
 * carries, so the two imports are independent (and composable in any order).
 * @param {File} file
 * @param {string} kind "userdata" (profil, entreprises, liste noire, suivi)
 *                      or "scraping" (recherches, offres, historiques)
 * @returns {Promise<void>} resolved once the import has been applied
 */
function importKind(file, kind) {
    if (!file) return Promise.resolve();

    return readFileText(file)
        .catch(function () {
            showTrackingMessage("Impossible de lire le fichier.");
        })
        .then(function (text) {
            if (typeof text !== "string") return null;

            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch (error) {
                showTrackingMessage("Fichier invalide : JSON illisible.");
                return null;
            }
            if (!parsed || parsed.format !== "leforem-scraper") {
                showTrackingMessage("Ce fichier n'est pas un export leforem-scraper.");
                return null;
            }

            // Un fichier d'un autre type a son propre bouton : on refuse plutôt
            // que de remplacer des données qui n'étaient pas visées.
            const fileKind = typeof parsed.kind === "string" && parsed.kind
                ? parsed.kind
                : "complet";
            if (fileKind !== "complet" && fileKind !== kind) {
                showTrackingMessage(
                    "Ce fichier est un export « " + fileKind + " » : " +
                    "utilise l'autre bouton d'import."
                );
                return null;
            }

            const scope = kind === "scraping"
                ? "le scraping : les recherches, offres et historiques de " +
                  "cet ordinateur seront remplacés"
                : "les données utilisateur : profil, entreprises, liste " +
                  "noire et suivi de cet ordinateur seront remplacés";
            if (!window.confirm("Importer " + scope + " ? Continuer ?")) {
                return null;
            }
            return text;
        })
        .then(function (body) {
            if (typeof body !== "string") return null;

            return fetch("/api/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: body
            })
                .then(function (response) {
                    return response.json().then(function (data) {
                        return { ok: response.ok, data: data };
                    });
                })
                .then(function (result) {
                    const data = result.data || {};
                    if (!result.ok || !data.ok) {
                        throw {
                            handled: true,
                            message: data.error || "réponse inattendue."
                        };
                    }
                    // Le serveur fait référence : on relit le suivi depuis lui,
                    // toutes bases confondues (un navigateur neuf n'a aucune
                    // clé localStorage pour les recherches importées).
                    return loadAllTrackingFromServer().then(function () {
                        return data;
                    });
                });
        })
        .then(function (data) {
            if (!data) return;

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
            if (kind === "scraping") {
                // Les offres affichées changent : la page est rechargée.
                window.setTimeout(function () {
                    window.location.reload();
                }, RELOAD_DELAY_MS);
            }
        })
        .catch(function (error) {
            if (error && error.handled) {
                showTrackingMessage("Import refusé : " + error.message);
            } else {
                showTrackingMessage("Import impossible : le serveur ne répond pas.");
            }
        });
}

/** Restaurer un export de données utilisateur (profil, suivi…). */
export function importUserdataFile(file) {
    return importKind(file, "userdata");
}

/** Restaurer un export de scraping (recherches, offres…). */
export function importScrapingFile(file) {
    return importKind(file, "scraping");
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
    const userdataInput = document.getElementById("importUserdataInput");
    if (userdataInput) {
        userdataInput.addEventListener("change", function () {
            importUserdataFile(this.files && this.files[0]);
            this.value = "";
        });
    }
    const scrapingInput = document.getElementById("importScrapingInput");
    if (scrapingInput) {
        scrapingInput.addEventListener("change", function () {
            importScrapingFile(this.files && this.files[0]);
            this.value = "";
        });
    }
    const checkUpdatesBtn = document.getElementById("checkUpdatesBtn");
    if (checkUpdatesBtn) {
        checkUpdatesBtn.addEventListener("click", function () {
            if (!window.leforemUpdater) {
                // Le pont n'existe que dans l'application de bureau.
                showSuiviToast(
                    "Les mises à jour se vérifient dans l'application."
                );
                return;
            }
            document.dispatchEvent(new CustomEvent("forem:checkupdates"));
        });
    }
}