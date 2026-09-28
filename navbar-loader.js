/* ============================================================
   NAVBAR LOADER
   Dynamically loads navbar_include.html and marks the active link
   ============================================================ */

async function loadNavbar() {
    const container = document.getElementById("navbar-placeholder");
    if (!container) return;

    try {
        const response = await fetch("navbar_include.html", { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        const html = await response.text();
        container.innerHTML = html;

        // Set active link based on current page
        const path = window.location.pathname.split("/").pop() || "index.html";
        const links = container.querySelectorAll(".page-link");
        links.forEach(link => {
            const href = link.getAttribute("href");
            if (href === path) {
                link.classList.add("active");
                link.setAttribute("aria-current", "page");
            }
        });
    } catch (e) {
        console.error("Failed to load navbar:", e);
    }
}

// Auto-load on DOM ready
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadNavbar);
} else {
    loadNavbar();
}