/* ============================================================
   NAVBAR — injects navbar_include.html and marks the active link
   ============================================================ */

export async function loadNavbar() {
    const container = document.getElementById("navbar-placeholder");
    if (!container) return;

    try {
        const response = await fetch("navbar_include.html", { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        container.innerHTML = await response.text();

        const path = window.location.pathname.split("/").pop() || "index.html";
        container.querySelectorAll(".page-link").forEach(function (link) {
            if (link.getAttribute("href") === path) {
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