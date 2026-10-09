"use strict";

/**
 * Coque de bureau du scraper Le Forem.
 *
 * Lance le backend Python (embarqué avec PyInstaller), attend qu'il réponde,
 * puis ouvre la fenêtre sur http://localhost:<port>. À la fermeture, tue le
 * backend. Ne réécrit rien de l'application : c'est un conteneur.
 */

const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");

const START_TIMEOUT_MS = 30_000;

// Une seule instance : le second lancement se contente de ramener la fenêtre.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;
  let backend = null;
  // Dernière release connue : { available, current, latest, releaseUrl… }
  let latestRelease = null;
  let updateTimer = null;

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Commandes venues de la page (bouton « Mettre à jour », vérification).
  app.whenReady().then(() => {
    const { ipcMain } = require("electron");
    ipcMain.handle("updater:check", () => checkForUpdates());
    ipcMain.handle("updater:install", () => installUpdate());
  });

  // --- Utilitaires ---------------------------------------------------------

  function pickFreePort() {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const port = srv.address().port;
        srv.close(() => resolve(port));
      });
    });
  }

  function waitForServer(url, timeoutMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const req = http.get(url, (res) => {
          res.resume();
          resolve(true);
        });
        req.setTimeout(1000, () => req.destroy());
        req.on("error", () => {
          if (Date.now() - start > timeoutMs) {
            resolve(false);
          } else {
            setTimeout(tick, 250);
          }
        });
      };
      tick();
    });
  }

  // --- Backend (le serveur Python) -----------------------------------------

  function backendExePath() {
    // Empaqueté : le backend est copié dans resources/backend par
    // electron-builder (voir "extraResources" dans package.json).
    const bundled = path.join(
      process.resourcesPath,
      "backend",
      "leforem-backend",
      "leforem-backend.exe"
    );
    if (fs.existsSync(bundled)) return bundled;
    // Développement : si personne n'a buildé le backend, on le compile au
    // lancement, sinon on retombe sur la racine du dépôt.
    const built = path.join(
      __dirname,
      "build",
      "backend",
      "leforem-backend",
      "leforem-backend.exe"
    );
    if (fs.existsSync(built)) return built;
    return null;
  }

  function startBackend(url) {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, "backend.log");

    const env = {
      ...process.env,
      LEFOREM_PORT: String(url.port),
      LEFOREM_DATA_DIR: path.join(app.getPath("userData"), "data"),
      LEFOREM_NO_BROWSER: "1",
      LEFOREM_REPORT_URL: "1",
      PYTHONUNBUFFERED: "1",
    };

    const exe = backendExePath();
    const args = [];

    if (exe) {
      backend = spawn(exe, args, {
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } else {
      // Repli pour le développement sans build : python serveur.py.
      const root = path.resolve(__dirname, "..");
      backend = spawn("python", ["serveur.py"], {
        env,
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }

    const sink = fs.createWriteStream(logFile, { flags: "a" });
    backend.stdout.pipe(sink);
    backend.stderr.pipe(sink);
    backend.on("error", (err) => {
      sink.write(`[electron] backend error: ${err.message}\n`);
    });
    backend.on("exit", (code, signal) => {
      sink.write(
        `[electron] backend exited code=${code} signal=${signal}\n`
      );
      if (mainWindow && !mainWindow.isDestroyed()) {
        loadBackendGonePage();
      }
    });
    return backend;
  }

  function stopBackend() {
    if (backend && backend.exitCode === null) {
      backend.kill();
      backend = null;
    }
  }

  // --- Fenêtre -------------------------------------------------------------

  function createWindow(url) {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 940,
      minHeight: 600,
      autoHideMenuBar: true,
      title: "LeForem Scraper",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, "preload.js"),
      },
    });
    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadURL(url);
  }

  function loadBackendGonePage() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          "<!doctype html><meta charset=utf-8>" +
            "<body style='font-family:sans-serif;padding:2rem'>" +
            "<h2>Le serveur s'est arrêté</h2>" +
            "<p>Le backend Python a quitté de façon inattendue. " +
            "Ferme l'application puis relance-la.</p></body>"
        )
    );
  }

  // --- Mises à jour ---------------------------------------------------------

  const { net, shell } = require("electron");
  const updater = require("./update-check");

  // La version portable se met à jour avec le .exe portable, l'installeur avec
  // le Setup : l'un se relance, l'autre s'installe.
  function isPortable() {
    return Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
  }

  function currentStatus() {
    return (
      latestRelease || { available: false, current: app.getVersion() }
    );
  }

  function tellRenderer(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("updater:status", payload);
    }
  }

  function fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const request = net.request(updater.API_URL);
      request.setHeader("Accept", "application/vnd.github+json");
      request.setHeader("User-Agent", "leforem-scraper");
      request.on("response", (response) => {
        if (response.statusCode !== 200) {
          reject(new Error("HTTP " + response.statusCode));
          response.resume();
          return;
        }
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on("error", reject);
      request.end();
    });
  }

  /** Interroge GitHub. Ne renvoie jamais d'exception : l'app doit démarrer. */
  async function checkForUpdates() {
    tellRenderer({ state: "checking", ...currentStatus() });
    try {
      const release = await fetchLatestRelease();
      latestRelease = updater.releaseStatus(
        release,
        app.getVersion(),
        isPortable()
      );
    } catch (error) {
      latestRelease = {
        available: false,
        current: app.getVersion(),
        error: String((error && error.message) || error),
      };
    }
    tellRenderer({
      state: latestRelease.available ? "available" : "checked",
      ...latestRelease,
    });
    return latestRelease;
  }

  /** Télécharge la nouvelle version, puis la lance et ferme l'application. */
  async function installUpdate() {
    const status = currentStatus();
    if (!status.available || !status.assetUrl) {
      // Rien de prêt : on ouvre la page de la release.
      if (status.releaseUrl) shell.openExternal(status.releaseUrl);
      return { ok: false };
    }

    const target = path.join(
      app.getPath("temp"),
      status.assetName || "leforem-update.exe"
    );

    tellRenderer({ state: "downloading", ...status });
    await new Promise((resolve, reject) => {
      const request = net.request(status.assetUrl);
      request.setHeader("User-Agent", "leforem-scraper");
      request.on("response", (response) => {
        if (response.statusCode !== 200) {
          reject(new Error("HTTP " + response.statusCode));
          response.resume();
          return;
        }
        const out = fs.createWriteStream(target);
        let received = 0;
        const total = Number(response.headers["content-length"] || 0);
        response.on("data", (chunk) => {
          received += chunk.length;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("updater:progress", {
              received,
              total: total || status.assetSize || 0,
            });
          }
        });
        response.pipe(out);
        out.on("finish", () => out.close(resolve));
        out.on("error", reject);
      });
      request.on("error", reject);
      request.end();
    }).catch((error) => {
      tellRenderer({ state: "error", ...status, error: String(error) });
      throw error;
    });

    // On ferme d'abord, puis on lance : la nouvelle version doit pouvoir
    // démarrer seule (une seule instance par verrou, sinon elle se contente
    // de rendre la main à celle qui tourne encore).
    setTimeout(() => {
      shell.openPath(target).catch(() => {});
    }, 500);
    app.quit();
    return { ok: true };
  }

  // --- Cycle de vie ---------------------------------------------------------

  app.whenReady().then(async () => {
    try {
      const port = await pickFreePort();
      const url = new URL(`http://127.0.0.1:${port}`);

      startBackend(url);

      const ready = await waitForServer(url.toString(), START_TIMEOUT_MS);
      if (ready) {
        createWindow(url.toString());
        scheduleUpdateCheck();
        // Premier contrôle un peu après l'ouverture, pour ne pas la retarder.
        setTimeout(() => {
          checkForUpdates().catch(() => {});
        }, 20_000);
      } else {
        dialog.showErrorBox(
          "LeForem Scraper",
          "Le serveur intégré n'a pas démarré en 30 secondes.\n" +
            "Consulte le journal dans :\n" +
            path.join(app.getPath("userData"), "logs", "backend.log")
        );
        app.quit();
      }
    } catch (err) {
      dialog.showErrorBox("LeForem Scraper", String(err && err.message));
      app.quit();
    }
  });

  // Un point toutes les 4 heures ; la page se charge de ne pas radoter.
  function scheduleUpdateCheck() {
    if (updateTimer) clearInterval(updateTimer);
    updateTimer = setInterval(() => {
      checkForUpdates().catch(() => {});
    }, 4 * 3600 * 1000);
  }

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    stopBackend();
  });
}