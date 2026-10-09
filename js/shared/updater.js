/* ============================================================
   MISES À JOUR — la page demande au processus principal

   Le pont `window.leforemUpdater` n'existe que dans l'application de
   bureau (injecté par electron/preload.js). Dans un navigateur, rien de
   tout ceci ne s'affiche et aucun appel n'est fait.
   ============================================================ */

const CHECK_INTERVAL_KEY = "forem_updater_last_check";
const OFFERED_KEY = "forem_updater_offered";
const CHECK_EVERY_MS = 4 * 3600 * 1000;

/** Le pont, quand l'app tourne sous Electron. */
function bridge() {
    return typeof window !== "undefined" && window.leforemUpdater
        ? window.leforemUpdater
        : null;
}

function readStored(key) {
    try {
        return localStorage.getItem(key) || "";
    } catch (error) {
        return "";
    }
}

function writeStored(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        /* stockage indisponible */
    }
}

/** Assez de temps s'est-il écoulé pour réinterroger GitHub ? */
function dueForCheck() {
    const last = Number(readStored(CHECK_INTERVAL_KEY) || 0);
    return Date.now() - last > CHECK_EVERY_MS;
}

function markChecked() {
    writeStored(CHECK_INTERVAL_KEY, String(Date.now()));
}

/** La version a déjà été proposée : on ne radote pas à chaque démarrage. */
function alreadyOffered(version) {
    return readStored(OFFERED_KEY) === version;
}

function markOffered(version) {
    writeStored(OFFERED_KEY, version);
}

function formatSize(bytes) {
    const value = Number(bytes) || 0;
    if (value < 1024 * 1024) return Math.round(value / 1024) + " Ko";
    return (value / (1024 * 1024)).toFixed(1) + " Mo";
}

/**
 * Le bandeau, créé une seule fois et rempli à chaque état.
 * @returns {HTMLElement}
 */
function bannerElement() {
    let banner = document.getElementById("updaterBanner");
    if (banner) return banner;

    banner = document.createElement("div");
    banner.id = "updaterBanner";
    banner.className = "updater-banner";
    banner.setAttribute("role", "status");
    banner.hidden = true;
    banner.innerHTML =
        '<div class="updater-text"></div>' +
        '<div class="updater-actions">' +
        '<button type="button" class="updater-btn" id="updaterInstallBtn">' +
        'Mettre à jour</button>' +
        '<button type="button" class="updater-later" id="updaterLaterBtn">' +
        'Plus tard</button>' +
        '</div>';
    document.body.appendChild(banner);

    byIdSafe("updaterLaterBtn").addEventListener("click", hideBanner);
    byIdSafe("updaterInstallBtn").addEventListener("click", install);
    return banner;
}

function byIdSafe(id) {
    return document.getElementById(id);
}

function hideBanner() {
    const banner = byIdSafe("updaterBanner");
    if (banner) banner.hidden = true;
}

function showBanner(html, buttons) {
    const banner = bannerElement();
    banner.querySelector(".updater-text").innerHTML = html;
    byIdSafe("updaterInstallBtn").hidden = !buttons;
    banner.hidden = false;
}

let currentStatus = null;

function renderStatus(status) {
    currentStatus = status;
    const banner = bannerElement();
    if (!status) return;

    if (status.state === "checking") {
        showBanner("Recherche d'une mise à jour…", false);
        return;
    }

    if (status.state === "downloading") {
        const total = Number(status.total) || 0;
        const received = Number(status.received) || 0;
        const percent = total ? Math.round((received / total) * 100) : 0;
        showBanner(
            "Téléchargement de la version " + status.latest + "… " +
            percent + "% (" + formatSize(received) + " / " +
            formatSize(total) + ")",
            false
        );
        return;
    }

    if (status.state === "error") {
        showBanner(
            "Mise à jour impossible : " + (status.error || "erreur inconnue"),
            false
        );
        return;
    }

    if (!status.available) {
        hideBanner();
        return;
    }

    // Une seule proposition par version : après, on se taît.
    if (alreadyOffered(status.latest)) {
        hideBanner();
        return;
    }
    markOffered(status.latest);
    showBanner(
        "La version <strong>" + status.latest + "</strong> est disponible " +
        "(tu as la " + (status.current || "?") + ").",
        true
    );
}

function showProgress(payload) {
    if (currentStatus && currentStatus.state === "downloading") {
        currentStatus.received = payload.received;
        currentStatus.total = payload.total;
        renderStatus(currentStatus);
    }
}

function install() {
    const api = bridge();
    if (!api) return;
    api.install();
}

/**
 * Vérifie les mises à jour, sans radoter.
 * @returns {Promise<void>}
 */
async function checkUpdates() {
    const api = bridge();
    if (!api) return;
    if (!dueForCheck()) return;
    markChecked();
    await api.check();
}

/**
 * Branche le bandeau et lance la première vérification.
 * Sans le pont (navigateur), ne fait rien du tout.
 * @returns {Promise<void>}
 */
export async function initUpdater() {
    const api = bridge();
    if (!api) return;

    api.onStatus(renderStatus);
    api.onProgress(showProgress);

    // Une vérification manuelle est toujours la bienvenue : le menu
    // « Vérifier les mises à jour » émet cet événement.
    document.addEventListener("forem:checkupdates", function () {
        markChecked();
        api.check();
    });

    checkUpdates();
}
