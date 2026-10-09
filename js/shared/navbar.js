/* ============================================================
   NAVBAR — injects navbar_include.html and marks the active link
   ============================================================ */

import { initUpdater } from "./updater.js";

export async function loadNavbar() {
    const container = document.getElementById("navbar-placeholder");
    if (!container) return;

    try {
        const response = await fetch("/navbar_include.html", { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        container.innerHTML = await response.text();

        // Every page is served at the root of the server (/index.html,
        // /insights.html…), so the file name alone identifies the current one.
        const current = window.location.pathname.split("/").pop() || "index.html";
        container.querySelectorAll(".page-link").forEach(function (link) {
            if ((link.getAttribute("href") || "").split("/").pop() === current) {
                link.classList.add("active");
                link.setAttribute("aria-current", "page");
            }
        });
    } catch (error) {
        console.error("Failed to load navbar:", error);
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadNavbar);
} else {
    loadNavbar();
}

// Les mises à jour concernent l'application de bureau : sans le pont
// injecté par Electron, ce module ne fait rien.
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
        initUpdater();
    });
} else {
    initUpdater();
}