/* ============================================================
   SUIVI — sauvegarde / restauration partagée entre les pages
   Les statuts, remarques, favoris, priorités et dates de statut
   sont exportés dans un fichier JSON unique afin de transporter
   le suivi sur un autre PC.
   ============================================================ */

const SUIVI_EVENT = "foremsuiviimported";
const SUIVI_APP = "leforem-scraper";
const SUIVI_SCHEMA_VERSION = 1;
const TRACKED_PLAIN_KEYS = ["forem_scraping_select"];
const TRACKED_KEY_PATTERN = /^forem_.+_(statuts|remarques|favoris|statut_dates|priorites)$/;

function isTrackedStorageKey(key) {
    return TRACKED_KEY_PATTERN.test(key) ||
        TRACKED_PLAIN_KEYS.indexOf(key) !== -1;
}

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

function showSuiviToast(text) {
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
    const el = document.getElementById("trackingMessage");
    if (!el) {
        showSuiviToast(text);
        return;
    }
    el.textContent = text;
    setTimeout(function () { el.textContent = ""; }, 6000);
}

function exportTracking() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!isTrackedStorageKey(key)) continue;
        try {
            data[key] = JSON.parse(localStorage.getItem(key));
        } catch (e) {
            data[key] = localStorage.getItem(key);
        }
    }
    const payload = {
        app: SUIVI_APP,
        schemaVersion: SUIVI_SCHEMA_VERSION,
        exportDate: new Date().toISOString(),
        data: data
    };
    const filename = "suivi_forem_" + localDateString(new Date()) + ".json";
    downloadJson(filename, JSON.stringify(payload, null, 2));
    showTrackingMessage(
        "Suivi exporté (" + Object.keys(data).length + " jeu(x) de données)."
    );
}

function importTrackingFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
        let parsed;
        try {
            parsed = JSON.parse(reader.result);
        } catch (e) {
            showTrackingMessage("Fichier invalide : JSON illisible.");
            return;
        }
        const payload = parsed && typeof parsed === "object" ? parsed : {};
        const data = payload.data && typeof payload.data === "object"
            ? payload.data : {};
        let imported = 0;
        Object.keys(data).forEach(key => {
            if (!isTrackedStorageKey(key)) return;
            try {
                localStorage.setItem(key, JSON.stringify(data[key]));
                imported++;
            } catch (e) {
                console.error("Unable to store imported key", key, e);
            }
        });
        if (imported === 0) {
            showTrackingMessage("Aucune donnée de suivi reconnue dans ce fichier.");
            return;
        }
        document.dispatchEvent(new CustomEvent(SUIVI_EVENT));
        showTrackingMessage(imported + " jeu(x) de données importé(s).");
    };
    reader.onerror = function () {
        showTrackingMessage("Impossible de lire le fichier.");
    };
    reader.readAsText(file, "utf-8");
}

function setupSuiviActions() {
    const exportBtn = document.getElementById("exportTrackingBtn");
    if (exportBtn) {
        exportBtn.addEventListener("click", exportTracking);
    }
    const importInput = document.getElementById("importTrackingInput");
    if (importInput) {
        importInput.addEventListener("change", function () {
            importTrackingFile(this.files && this.files[0]);
            this.value = "";
        });
    }
}
