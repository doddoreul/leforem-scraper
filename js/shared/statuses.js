// ============================================================
// STATUS & PRIORITY — the vocabulary shared by the offers table,
// the offer sheet and the dashboard
// ============================================================

export const STATUS_OPTIONS = [
    { value: "", label: "Non trié" },
    { value: "interesse", label: "Intéressé" },
    { value: "pas_interesse", label: "Pas intéressé" },
    { value: "postule", label: "Postulé" },
    { value: "contacte", label: "Contacté" },
    { value: "refuse", label: "Refusé" },
    { value: "rdv", label: "RDV prévu" },
    { value: "generique", label: "Annonce générique" },
];

export const PRIORITY_OPTIONS = [
    { value: "", label: "Aucune" },
    { value: "haute", label: "Haute" },
    { value: "moyenne", label: "Moyenne" },
    { value: "faible", label: "Faible" },
];

export const STATUS_VALUES = STATUS_OPTIONS.map(option => option.value);

/**
 * @param {string} value
 * @returns {string} the label, or the value itself when unknown
 */
export function statusLabel(value) {
    const option = STATUS_OPTIONS.find(item => item.value === value);
    return option ? option.label : (value || "");
}

/**
 * Sort rank of a status, in the order of STATUS_OPTIONS.
 * @param {string} value
 * @returns {number} the number of statuses when the value is unknown
 */
export function statusRank(value) {
    const index = STATUS_OPTIONS.findIndex(option => option.value === value);
    return index === -1 ? STATUS_OPTIONS.length : index;
}

/**
 * @param {string} value
 * @returns {string} the label, or "" when unknown
 */
export function priorityLabel(value) {
    const option = PRIORITY_OPTIONS.find(item => item.value === value);
    return option ? option.label : "";
}