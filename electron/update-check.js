"use strict";

/**
 * Logique pure de la vérification des mises à jour.
 *
 * Aucune dépendance à Electron : ce fichier est appelé par le processus
 * principal, et testé tel quel avec Node (tests/test_update_check.py).
 */

const REPO = "doddoreul/leforem-scraper";
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/** "v1.1.6" → [1, 1, 6] ; null si ce n'est pas une version. */
function parseVersion(tag) {
  const match = /^v?(\d+(?:\.\d+)*)/.exec(String(tag == null ? "" : tag).trim());
  if (!match) return null;
  const parts = match[1].split(".").map(function (part) {
    const value = Number(part);
    return Number.isFinite(value) ? value : 0;
  });
  return parts;
}

/** -1 si a est plus ancien que b, 0 s'ils sont égaux, 1 s'il est plus récent. */
function compareVersions(a, b) {
  const left = parseVersion(a) || [0];
  const right = parseVersion(b) || [0];
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const x = left[index] || 0;
    const y = right[index] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * L'exécutable à télécharger parmi les fichiers de la release.
 *
 * Le portable et l'installeur ne se mettent pas à jour de la même façon :
 * chacun récupère sa variante. À défaut, n'importe quel .exe fait l'affaire.
 * @param {Array} assets les "assets" de la release GitHub
 * @param {boolean} isPortable l'app tourne-t-elle en version portable ?
 * @returns {Object|null}
 */
function pickAsset(assets, isPortable) {
  if (!Array.isArray(assets)) return null;
  const exes = assets.filter(function (asset) {
    return asset && /\.exe$/i.test(String(asset.name)) && asset.browser_download_url;
  });
  if (!exes.length) return null;
  const wanted = isPortable ? "portable" : "setup";
  const match = exes.find(function (asset) {
    return String(asset.name).toLowerCase().indexOf(wanted) !== -1;
  });
  return match || exes[0];
}

/**
 * Ce que devient l'état de l'app après lecture d'une release.
 * @param {Object} release la release GitHub (déjà publiée)
 * @param {string} currentVersion la version de l'app (package.json)
 * @param {boolean} isPortable
 * @returns {Object} { available, current, latest, releaseUrl, notes, asset… }
 */
function releaseStatus(release, currentVersion, isPortable) {
  const latest = release && release.tag_name ? String(release.tag_name) : "";
  const status = {
    available: false,
    current: currentVersion,
    latest: latest,
  };
  if (!latest) return status;
  if (compareVersions(latest, currentVersion) <= 0) return status;

  const asset = pickAsset(release.assets, isPortable);
  status.available = true;
  status.releaseUrl = release.html_url;
  status.publishedAt = release.published_at;
  status.notes = release.body || "";
  status.asset = asset;
  status.assetName = asset ? asset.name : "";
  status.assetUrl = asset ? asset.browser_download_url : "";
  status.assetSize = asset ? asset.size : 0;
  return status;
}

module.exports = {
  API_URL,
  REPO,
  compareVersions,
  parseVersion,
  pickAsset,
  releaseStatus,
};
