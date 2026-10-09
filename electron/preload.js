"use strict";

/**
 * Pont entre le processus principal et la page pour les mises à jour.
 *
 * La page n'a aucun accès à Node (sandbox + isolation) : elle passe par cet
 * objet, exposé uniquement quand l'application est empaquetée par Electron.
 * Dans un navigateur classique, `window.leforemUpdater` n'existe pas et
 * l'interface se contente de ne rien proposer.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("leforemUpdater", {
  /** Reçoit l'état : checking / available / up-to-date / downloading / error. */
  onStatus(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("updater:status", listener);
  },
  /** Reçoit l'avancement du téléchargement, en octets. */
  onProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("updater:progress", listener);
  },
  /** Force une vérification maintenant. */
  check() {
    return ipcRenderer.invoke("updater:check");
  },
  /** Télécharge la nouvelle version puis la lance et ferme l'app. */
  install() {
    return ipcRenderer.invoke("updater:install");
  },
});
