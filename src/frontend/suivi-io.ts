/**
 * Shared suivi I/O utilities - toast notifications, import/export
 * Converted from suivi-io.js
 */

const SUIVI_APP = "leforem";
const SUIVI_SCHEMA_VERSION = 1;

const INSIGHTS_STATUS = [
  ["", "Non trié"],
  ["interesse", "Intéressé"],
  ["pas_interesse", "Pas intéressé"],
  ["postule", "Postulé"],
  ["contacte", "Contacté"],
  ["refuse", "Refusé"],
  ["rdv", "RDV prévu"],
  ["generique", "Annonce générique"],
];

function isTrackedStorageKey(key: string): boolean {
  const prefix = "forem_";
  const suffixes = ["statuts", "statut_dates", "remarques", "favoris", "priorites"];
  return key.startsWith(prefix) && suffixes.some(s => key.endsWith(s));
}

function showSuiviToast(text: string): void {
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
  clearTimeout((toast as any).hideTimer);
  (toast as any).hideTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 6000);
}

function showTrackingMessage(text: string): void {
  const el = document.getElementById("trackingMessage");
  if (!el) {
    showSuiviToast(text);
    return;
  }
  el.textContent = text;
  setTimeout(() => { el.textContent = ""; }, 6000);
}

function exportTracking(): void {
  const data: Record<string, any> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !isTrackedStorageKey(key)) continue;
    try {
      data[key] = JSON.parse(localStorage.getItem(key) || "{}");
    } catch {
      data[key] = localStorage.getItem(key);
    }
  }
  const payload = {
    app: "leforem",
    schemaVersion: 1,
    exportDate: new Date().toISOString(),
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leforem-tracking-" + new Date().toISOString().slice(0, 10) + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function importTracking(file: File): Promise<void> {
  const text = await file.text();
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    showSuiviToast("Fichier invalide.");
    return;
  }
  if (payload.app !== "leforem" || payload.schemaVersion !== 1) {
    showSuiviToast("Format de fichier non reconnu.");
    return;
  }
  for (const [key, value] of Object.entries(payload.data || {})) {
    if (!isTrackedStorageKey(key)) continue;
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore
    }
  }
  showSuiviToast("Suivi importé avec succès.");
  document.dispatchEvent(new CustomEvent("foremsuiviimported"));
}

function setupSuiviActions(): void {
  const exportBtn = document.getElementById("exportTrackingBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", exportTracking);
  }
  const importInput = document.getElementById("importTrackingInput");
  if (importInput) {
    importInput.addEventListener("change", function () {
      if (this.files && this.files[0]) {
        importTracking(this.files[0]);
        this.value = "";
      }
    });
  }
}

export { showSuiviToast, showTrackingMessage, exportTracking, importTracking, setupSuiviActions, SUIVI_APP, SUIVI_SCHEMA_VERSION, INSIGHTS_STATUS };