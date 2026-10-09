/* ============================================================
   THÈME — cogwheel + réglages (mode sombre, données)
   ============================================================ */

const THEME_KEY = "forem_theme";
export const THEME_EVENT = "foremthemechange";

const GEAR_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="3.2"></circle>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 ' +
    '1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 ' +
    '1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 ' +
    '2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 ' +
    '2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

const THEMES = ["light", "dark", "mono", "neon", "warm", "pastel", "jewel", "vibrancy"];

function storedTheme() {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        return THEMES.includes(saved) ? saved : null;
    } catch (error) {
        return null;
    }
}

function systemTheme() {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark" : "light";
}

function currentTheme() {
    return storedTheme() || systemTheme();
}

export function applyTheme(theme) {
    const next = THEMES.includes(theme) ? theme : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
        localStorage.setItem(THEME_KEY, next);
    } catch (error) {
        /* stockage indisponible : le thème reste appliqué pour la session */
    }
    document.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { theme: next } }));
}

function escapeAttribute(value) {
    return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function gearActionMarkup(action) {
    const id = escapeAttribute(action.id);
    const label = escapeAttribute(action.label);
    const title = action.title ? ' title="' + escapeAttribute(action.title) + '"' : "";
    const extraClass = action.id === "deleteScrapingGearBtn" ? " theme-action--danger" : "";
    if (action.type === "file") {
        const accept = action.accept ? ' accept="' + escapeAttribute(action.accept) + '"' : "";
        return '<input type="file" id="' + id + '"' + accept + " hidden>" +
            '<label class="theme-action' + extraClass + '" for="' + id + '"' + title + ">" + label + "</label>";
    }
    return '<button type="button" class="theme-action' + extraClass + '" id="' + id + '"' + title + ">" + label + "</button>";
}

/**
 * Fill (or empty) the "Données" section of the cogwheel menu.
 * @param {Array<{id: string, label: string, title?: string,
 *                type?: string, accept?: string}>} actions
 */
function renderGearActions(actions) {
    const menu = document.getElementById("themeMenu");
    if (!menu) return;
    const list = Array.isArray(actions) ? actions : [];
    let section = menu.querySelector(".theme-actions");
    if (list.length === 0) {
        if (section) section.remove();
        return;
    }
    if (!section) {
        section = document.createElement("div");
        section.className = "theme-actions";
        menu.appendChild(section);
    }
    section.innerHTML = '<p class="theme-menu-label">Données</p>' +
        list.map(gearActionMarkup).join("");
}

function syncThemeSelect() {
    const select = document.getElementById("themeSelect");
    if (select) select.value = currentTheme();
}

function buildThemeSettings() {
    if (document.getElementById("themeSettings")) return;

    const wrap = document.createElement("div");
    wrap.id = "themeSettings";
    wrap.className = "theme-settings";
    wrap.innerHTML =
        '<button type="button" class="theme-gear" id="themeGear" aria-haspopup="true" ' +
        'aria-expanded="false" aria-controls="themeMenu" title="Paramètres">' + GEAR_SVG +
        '<span class="sr-only">Paramètres</span></button>' +
        '<div class="theme-menu" id="themeMenu" hidden>' +
        '<p class="theme-menu-title">Paramètres</p>' +
        '<div class="theme-switch-row">' +
        '<label class="theme-switch-label" for="themeSelect">Thème</label>' +
        '<select id="themeSelect" class="theme-select">' +
        '<option value="light">Clair</option>' +
        '<option value="dark">Sombre</option>' +
        '<option value="mono">Monochrome</option>' +
        '<option value="neon">Neon</option>' +
        '<option value="warm">Warm</option>' +
        '<option value="pastel">Pastel</option>' +
        '<option value="jewel">Jewel</option>' +
        '<option value="vibrancy">Vibrancy</option>' +
        '</select>' +
        '</div>' +
        '</div>';

    document.body.appendChild(wrap);

    const gear = document.getElementById("themeGear");
    const menu = document.getElementById("themeMenu");
    const select = document.getElementById("themeSelect");

    function openMenu(open) {
        menu.hidden = !open;
        gear.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) syncThemeSelect();
    }

    gear.addEventListener("click", function (event) {
        event.stopPropagation();
        openMenu(menu.hidden);
    });

    select.addEventListener("change", function () {
        applyTheme(select.value);
    });

    document.addEventListener(THEME_EVENT, syncThemeSelect);

    menu.addEventListener("click", function (event) {
        if (event.target.closest(".theme-action")) openMenu(false);
    });

    document.addEventListener("click", function (event) {
        if (!wrap.contains(event.target)) openMenu(false);
    });

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape" && !menu.hidden) {
            openMenu(false);
            gear.focus();
        }
    });

    syncThemeSelect();
}

/**
 * La version de l'application, en pied du menu.
 * Elle vient du serveur (python/version.py, régénéré à chaque build depuis
 * electron/package.json) : une seule source de vérité.
 */
async function showAppVersion() {
    const menu = document.getElementById("themeMenu");
    if (!menu) return;

    let label = menu.querySelector(".theme-menu-version");
    if (!label) {
        label = document.createElement("p");
        label.className = "theme-menu-version";
        menu.appendChild(label);
    }
    label.textContent = "Version …";

    try {
        const response = await fetch("/api/version");
        if (!response.ok) return;
        const data = await response.json();
        if (data && data.version) {
            label.textContent = "Version " + data.version;
        }
    } catch (error) {
        /* pas de version connue : on garde le libellé neutre */
    }
}

/**
 * Build the cogwheel and follow the system theme until the user picks one.
 * @param {Array} [gearActions] entries of the "Données" section, page specific
 */
export function initTheme(gearActions) {
    document.documentElement.setAttribute("data-theme", currentTheme());
    buildThemeSettings();
    renderGearActions(gearActions);
    showAppVersion();

    if (!storedTheme() && window.matchMedia) {
        const query = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = function () {
            if (!storedTheme()) applyTheme(systemTheme());
        };
        if (query.addEventListener) query.addEventListener("change", onChange);
        else if (query.addListener) query.addListener(onChange);
    }
}