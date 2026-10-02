/* ============================================================
   SCRAPING MANUEL - bouton « Actualiser », confirmation, faux terminal
   ============================================================
   Le POST /api/scraper/run est bloquant : le serveur termine le scraping
   avant de repondre. La reponse est neanmoins streamee ligne par ligne
   (NDJSON) pour que le terminal affiche les vrais evenements du scraper
   au fur et a mesure. Aucune tache de fond n'est creee. */

import { API_SCRAPE_RUN } from "./api.js";
import { byId } from "./dom.js";
import { showSuiviToast } from "./suivi.js";

// Garde-fou d'affichage : le terminal ne garde que les N dernieres lignes.
const TERMINAL_MAX_LINES = 400;

export const ScraperUi = (function () {
    let elements = null;
    let running = false;
    let target = null;
    let getTarget = null;
    let onScraped = null;
    let pendingDone = null;

    function cacheElements() {
        elements = {
            button: byId("refreshScrapeBtn"),
            confirmModal: byId("refreshConfirmModal"),
            confirmTarget: byId("refreshConfirmTarget"),
            confirmBtn: byId("confirmRefreshBtn"),
            cancelConfirmBtn: byId("cancelRefreshBtn"),
            closeConfirmBtn: byId("closeRefreshConfirmBtn"),
            runModal: byId("refreshRunModal"),
            runHint: byId("refreshRunHint"),
            terminal: byId("scrapeTerminal"),
            result: byId("scrapeResult"),
            resultTitle: byId("scrapeResultTitle"),
            resultInfo: byId("scrapeResultInfo"),
            resultDetails: byId("scrapeResultDetails"),
            resultPre: byId("scrapeResultPre"),
            runStatus: byId("scrapeRunStatus"),
            cancelRunBtn: byId("cancelRefreshRunBtn"),
            closeRunBtn: byId("closeRefreshRunBtn"),
            closeRunFooterBtn: byId("closeRefreshRunFooterBtn")
        };
    }

    function show(node, visible) {
        if (!node) return;
        node.classList.toggle("scraper-hide", !visible);
    }

    function setRunning(value) {
        running = value;
        refreshButtonState();
    }

    function notify(text) {
        showSuiviToast(text);
    }

    // ------------------------------------------------------------
    // Faux terminal
    // ------------------------------------------------------------

    function appendLine(text, kind) {
        const box = elements.terminal;
        if (!box) return null;
        const line = document.createElement("div");
        line.textContent = text;
        if (kind) line.className = "terminal-line-" + kind;
        box.appendChild(line);
        while (box.childElementCount > TERMINAL_MAX_LINES) {
            box.removeChild(box.firstElementChild);
        }
        box.scrollTop = box.scrollHeight;
        return line;
    }

    let progressLine = null;

    function clearTerminal() {
        if (elements.terminal) elements.terminal.innerHTML = "";
        progressLine = null;
    }

    function resetRunModal() {
        clearTerminal();
        show(elements.result, false);
        show(elements.resultDetails, false);
        if (elements.resultPre) elements.resultPre.textContent = "";
        if (elements.resultInfo) elements.resultInfo.innerHTML = "";
        if (elements.runStatus) elements.runStatus.textContent = "";
        if (elements.runHint) {
            elements.runHint.textContent = "Scraping en cours...";
        }
        show(elements.closeRunBtn, false);
        show(elements.cancelRunBtn, false);
        if (elements.closeRunFooterBtn) {
            elements.closeRunFooterBtn.disabled = true;
            elements.closeRunFooterBtn.textContent = "Scraping en cours...";
        }
        if (elements.runModal) elements.runModal.classList.add("visible");
    }

    // ------------------------------------------------------------
    // Résumé / erreur
    // ------------------------------------------------------------

    function formatDuration(seconds) {
        const value = Math.max(0, Math.round(Number(seconds) || 0));
        const minutes = Math.floor(value / 60);
        if (minutes < 1) return value + " s";
        if (minutes === 1) return "1 min " + value % 60 + " s";
        return minutes + " min " + (value % 60) + " s";
    }

    function formatNumber(value) {
        return Number(value || 0).toLocaleString("fr-FR");
    }

    function appendStatRow(description, value) {
        const dt = document.createElement("dt");
        dt.textContent = description;
        const dd = document.createElement("dd");
        dd.textContent = value;
        elements.resultInfo.appendChild(dt);
        elements.resultInfo.appendChild(dd);
    }

    function showResult(summary) {
        setRunning(false);
        show(elements.result, true);
        const labels = (pendingDone && pendingDone.labels) || {};
        elements.resultTitle.textContent = labels.doneTitle || "Scraping terminé";
        elements.resultInfo.innerHTML = "";

        // « téléchargées » = requêtes réellement faites à Forem. Les offres
        // déjà connues viennent du cache : c'est ce qui rend la mise à jour
        // incrémentale, donc le nombre à surveiller est celui-ci.
        const downloaded = summary.fetched != null
            ? summary.fetched
            : summary.traitees;
        const added = (summary.nouvelles || 0) + (summary.reapparues || 0);

        appendStatRow("Offres téléchargées", formatNumber(downloaded));
        appendStatRow("Nouvelles offres", formatNumber(added));
        appendStatRow("Offres modifiées", formatNumber(summary.modifiees));
        appendStatRow("Déjà connues (cache)", formatNumber(summary.cached));
        appendStatRow("Erreurs", formatNumber(summary.erreurs));
        appendStatRow("Durée", formatDuration(summary.duration_seconds));

        const details = Array.isArray(summary.erreur_details)
            ? summary.erreur_details
            : [];
        if (details.length) {
            elements.resultPre.textContent = details.join("\n");
            show(elements.resultDetails, true);
        }

        if (elements.runHint) {
            elements.runHint.textContent = labels.doneHint
                || "Synchronisation terminée.";
        }
        appendLine("> Scraping terminé", "done");
        finishRunModal("Fermer");

        const callback = pendingDone;
        if (callback && callback.onDone) {
            callback.onDone(summary);
        } else if (onScraped) {
            onScraped();
        }
    }

    function showError(message, details) {
        setRunning(false);
        show(elements.result, true);
        elements.resultTitle.textContent = "Scraping interrompu";
        elements.resultInfo.innerHTML = "";
        appendStatRow(
            "Erreur",
            "Une erreur est survenue pendant la synchronisation."
        );
        appendStatRow("Message", message || "Erreur inconnue");

        if (details) {
            elements.resultPre.textContent = details;
            show(elements.resultDetails, true);
        }

        if (elements.runHint) {
            elements.runHint.textContent = "La synchronisation a échoué.";
        }
        appendLine("> " + (message || "Erreur inconnue"), "error");
        finishRunModal("Fermer");
    }

    function finishRunModal(label) {
        if (elements.closeRunFooterBtn) {
            elements.closeRunFooterBtn.disabled = false;
            elements.closeRunFooterBtn.textContent = label;
        }
        show(elements.closeRunBtn, true);
    }

    // ------------------------------------------------------------
    // Traitement des événements du serveur
    // ------------------------------------------------------------

    function handleEvent(event) {
        if (!event || typeof event !== "object") return;

        if (event.type === "log") {
            const line = String(event.line == null ? "" : event.line);
            appendLine("> " + line, classifyLine(line));
            return;
        }

        if (event.type === "progress") {
            const done = Number(event.done) || 0;
            const total = Number(event.total) || 0;
            appendLine("> Offre " + done + " / " + total);
            if (!progressLine) {
                progressLine = appendLine(
                    "> " + done + " / " + total, "progress"
                );
                return;
            }
            progressLine.textContent = "> " + done + " / " + total;
            // The counter stays on the last line, like a real terminal.
            elements.terminal.appendChild(progressLine);
            elements.terminal.scrollTop = elements.terminal.scrollHeight;
            return;
        }

        if (event.type === "done") {
            showResult((event.result || {}));
            return;
        }

        if (event.type === "error") {
            showError(event.message, event.details);
        }
    }

    function classifyLine(line) {
        if (/^(\s*Offer \d+:|Error|HTTP \d|Network error)/i.test(line)) {
            return "warn";
        }
        if (/\berror\b|\berreur\b|\bfailed\b/i.test(line)) {
            return "warn";
        }
        if (/^(Done|Storage updated|Change detection)/.test(line)) {
            return "done";
        }
        return "";
    }

    // ------------------------------------------------------------
    // Requête bloquante + lecture du flux
    // ------------------------------------------------------------

    function consumeLines(text, state) {
        state.buffer += text;
        let index;
        while ((index = state.buffer.indexOf("\n")) >= 0) {
            const line = state.buffer.slice(0, index).trim();
            state.buffer = state.buffer.slice(index + 1);
            if (!line) continue;
            try {
                handleEvent(JSON.parse(line));
            } catch (e) {
                appendLine("> " + line);
            }
        }
    }

    async function runScraping() {
        closeConfirm();
        // Le scraping réellement ciblé est relu au moment du lancement.
        if (getTarget) target = getTarget();

        if (!target) {
            resetRunModal();
            setRunning(true);
            showError(
                "Sélectionnez un scraping précis avant de lancer la mise à jour.",
                ""
            );
            return;
        }

        return executeRun(target, null, null);
    }

    // Lance un scraping donné (nouvelle recherche ou mise à jour) et affiche
    // le même terminal. onDone est appelé après un scraping terminé.
    async function executeRun(runTarget, onDone, labels) {
        resetRunModal();
        setRunning(true);

        if (labels && labels.runningHint && elements.runHint) {
            elements.runHint.textContent = labels.runningHint;
        }

        appendLine("> Initialisation du scraper...");

        let response;
        try {
            response = await fetch(API_SCRAPE_RUN, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: runTarget.name,
                    label: runTarget.label,
                    occupation_guid: runTarget.occupation_guid,
                    location_guid: runTarget.location_guid,
                    // Incrémental : le scraper ne retélécharge que les
                    // offres absentes du dernier scraping (et celles qui
                    // avaient échoué). Les offres connues restent en cache,
                    // comme `python scraper.py` sans `--refresh`.
                    // La reprise complète reste réservée à la CLI.
                    refresh: false
                })
            });
        } catch (e) {
            showError("Serveur injoignable : " + e.message, String(e));
            return;
        }

        if (!response.ok) {
            let message = "HTTP " + response.status;
            try {
                const data = await response.json();
                if (data && data.error) message = data.error;
            } catch (e) {
                /* réponse sans corps JSON */
            }
            showError(message, "");
            return;
        }

        const state = { buffer: "" };
        pendingDone = { onDone: onDone, labels: labels };

        // Le flux est lu tant que la requête est ouverte, c'est-à-dire
        // pendant toute la durée du scraping.
        if (response.body && response.body.getReader) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            try {
                for (;;) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    consumeLines(decoder.decode(chunk.value, { stream: true }), state);
                }
                consumeLines(decoder.decode(), state);
            } catch (e) {
                appendLine("> Flux interrompu : " + e.message, "error");
            }
        } else {
            // Repli : la réponse arrive en une fois, une fois le
            // scraping terminé.
            const text = await response.text();
            consumeLines(text, state);
            consumeLines("\n", state);
        }

        pendingDone = null;

        if (!elements.result.classList.contains("scraper-hide")) {
            return;
        }

        // Aucune ligne "done" reçue : la connexion a été coupée avant la
        // fin du scraping.
        appendLine("> Scraping interrompu", "error");
        showError("La connexion avec le serveur a été interrompue.", "");
    }

    // ------------------------------------------------------------
    // Confirmation
    // ------------------------------------------------------------

    function closeConfirm() {
        if (elements.confirmModal) {
            elements.confirmModal.classList.remove("visible");
        }
    }

    function closeRun() {
        if (running) return;
        if (elements.runModal) elements.runModal.classList.remove("visible");
    }

    function openConfirm() {
        if (running) return;
        if (!target) {
            notify("Sélectionnez un scraping précis pour l'actualiser.");
            return;
        }
        if (elements.confirmTarget) {
            elements.confirmTarget.textContent = "Recherche : " + target.label;
        }
        elements.confirmModal.classList.add("visible");
    }

    function refreshButtonState() {
        if (!elements || !elements.button) return;
        // Le bouton reste cliquable : sans recherche précise choisie, le
        // clic explique quoi sélectionner (comme le bouton «gear»).
        elements.button.disabled = running;
        elements.button.title = target
            ? "Relancer le scraping de : " + target.label
            : "Sélectionnez un scraping précis pour l'actualiser";
    }

    function setup() {
        cacheElements();
        if (!elements.button) return;

        elements.button.addEventListener("click", openConfirm);
        elements.cancelConfirmBtn.addEventListener("click", closeConfirm);
        elements.closeConfirmBtn.addEventListener("click", closeConfirm);
        elements.confirmModal
            .querySelector(".modal-backdrop")
            .addEventListener("click", closeConfirm);
        elements.confirmModal.addEventListener("keydown", function (e) {
            if (e.key === "Escape") closeConfirm();
        });

        elements.confirmBtn.addEventListener("click", function () {
            elements.confirmBtn.disabled = true;
            runScraping().then(function () {
                elements.confirmBtn.disabled = false;
            });
        });

        elements.cancelRunBtn.addEventListener("click", closeRun);
        elements.closeRunBtn.addEventListener("click", closeRun);
        elements.closeRunFooterBtn.addEventListener("click", closeRun);
        elements.runModal
            .querySelector(".modal-backdrop")
            .addEventListener("click", closeRun);
        elements.runModal.addEventListener("keydown", function (e) {
            if (e.key === "Escape") closeRun();
        });
    }

    return {
        // getTarget(): { name, label, occupation_guid, location_guid } | null
        // onScraped(): rechargé après un scraping terminé.
        attach: function (options) {
            setup();
            const settings = options || {};
            onScraped = typeof settings.onScraped === "function"
                ? settings.onScraped
                : null;
            getTarget = typeof settings.getTarget === "function"
                ? settings.getTarget
                : null;
            target = getTarget ? getTarget() : null;
            refreshButtonState();
        },
        // Appelé quand le scraping sélectionné change dans la page.
        setTarget: function (value) {
            target = value;
            refreshButtonState();
        },
        isRunning: function () {
            return running;
        },
        openConfirm: openConfirm,
        // Nouvelle recherche : même terminal, mais la cible vient de la
        // fenêtre « Nouvelle recherche » et non du scraping sélectionné.
        // target: { name, label, occupation_guid, location_guid }
        runNewScraping: function (runTarget, onDone) {
            if (running) {
                notify("Un scraping est déjà en cours.");
                return Promise.resolve();
            }
            return executeRun(runTarget, onDone, {
                runningHint: "Recherche en cours, cela peut prendre quelques minutes...",
                doneTitle: "Recherche terminée",
                doneHint: "La nouvelle recherche est prête."
            });
        }
    };
})();
