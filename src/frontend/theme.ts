/**
 * Theme management - cogwheel + settings (dark/light mode)
 * Converted from theme.js
 */

const THEME_KEY = "forem_theme";
const THEME_EVENT = "foremthemechange";

const GEAR_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="12" r="3.2"></circle>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 ' +
    '1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 ' +
    '1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 ' +
    '2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 ' +
    '2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

function storedTheme(): string | null {
  try {
    const saved = localStorage.getItem("forem_theme");
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

function systemTheme(): "light" | "dark" {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function currentTheme(): "light" | "dark" {
  return storedTheme() || systemTheme();
}

function applyTheme(theme: "light" | "dark"): void {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("forem_theme", next);
  } catch {
    // ignore
  }
  document.dispatchEvent(new CustomEvent("foremthemechange", { detail: { theme: next } }));
}

function escapeAttribute(value: string): string {
  return String(value)
    .replace(/&/g, "&")
    .replace(/"/g, """)
    .replace(/</g, "<");
}

function gearActionMarkup(action: { id: string; label: string; title?: string; type?: string; accept?: string }): string {
  const id = escapeAttribute(action.id);
  const label = escapeAttribute(action.label);
  const title = action.title ? ' title="' + escapeAttribute(action.title) + '"' : "";
  if (action.type === "file") {
    const accept = action.accept ? ' accept="' + escapeAttribute(action.accept) + '"' : "";
    return '<input type="file" id="' + id + '"' + accept + " hidden>" +
      '<label class="theme-action" for="' + id + '"' + title + ">" + label + "</label>";
  }
  return '<button type="button" class="theme-action" id="' + id + '"' + title + ">" + label + "</button>";
}

function renderGearActions(): void {
  const menu = document.getElementById("themeMenu");
  if (!menu) return;
  const actions = Array.isArray(window.FOREM_GEAR_ACTIONS) ? window.FOREM_GEAR_ACTIONS : [];
  let section = menu.querySelector(".theme-actions");
  if (actions.length === 0) {
    if (section) section.remove();
    return;
  }
  if (!section) {
    section = document.createElement("div");
    section.className = "theme-actions";
    menu.appendChild(section);
  }
  section.innerHTML = '<p class="theme-menu-label">Données</p>' +
    actions.map(gearActionMarkup).join("");
}

function syncThemeSwitch(): void {
  const toggle = document.getElementById("themeSwitch");
  if (toggle) (toggle as HTMLInputElement).checked = currentTheme() === "dark";
}

function buildThemeSettings(): void {
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
    '<label class="theme-switch-label" for="themeSwitch">Mode sombre</label>' +
    '<input type="checkbox" id="themeSwitch" class="theme-switch" role="switch">' +
    '</div>' +
    '</div>';

  document.body.appendChild(wrap);
  renderGearActions();

  const gear = document.getElementById("themeGear");
  const menu = document.getElementById("themeMenu");
  const toggle = document.getElementById("themeSwitch");

  function openMenu(open: boolean): void {
    if (menu) menu.hidden = !open;
    if (gear) gear.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) syncThemeSwitch();
  }

  if (gear) {
    gear.addEventListener("click", function (event) {
      event.stopPropagation();
      openMenu(menu!.hidden);
    });
  }

  if (toggle) {
    toggle.addEventListener("change", function () {
      applyTheme((this as HTMLInputElement).checked ? "dark" : "light");
    });
  }

  document.addEventListener("foremthemechange", syncThemeSwitch);

  if (menu) {
    menu.addEventListener("click", function (event) {
      if (event.target && (event.target as HTMLElement).closest(".theme-action")) openMenu(false);
    });
  }

  document.addEventListener("click", function (event) {
    if (!wrap.contains(event.target as Node)) openMenu(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !menu!.hidden) {
      openMenu(false);
      if (gear) gear.focus();
    }
  });

  syncThemeSwitch();
}

function initTheme(): void {
  document.documentElement.setAttribute("data-theme", currentTheme());
  buildThemeSettings();
  if (!storedTheme() && window.matchMedia) {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = function () {
      if (!storedTheme()) applyTheme(systemTheme());
    };
    if (query.addEventListener) query.addEventListener("change", onChange);
    else if ((query as any).addListener) (query as any).addListener(onChange);
  }
}

function storedTheme(): string | null {
  try {
    const saved = localStorage.getItem("forem_theme");
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

function systemTheme(): "light" | "dark" {
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function currentTheme(): "light" | "dark" {
  return storedTheme() || systemTheme();
}

function applyTheme(theme: "light" | "dark"): void {
  const next = theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("forem_theme", next);
  } catch {
    // ignore
  }
  document.dispatchEvent(new CustomEvent("foremthemechange", { detail: { theme: next } }));
}

function escapeAttribute(value: string): string {
  return String(value)
    .replace(/&/g, "&")
    .replace(/"/g, """)
    .replace(/</g, "<");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initTheme);
} else {
  initTheme();
}