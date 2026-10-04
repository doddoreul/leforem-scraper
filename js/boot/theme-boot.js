/* ============================================================
   THEME BOOT — a classic script, on purpose.

   It runs while <head> is parsed, before the first paint, so the page
   never flashes in the wrong theme. A module would be deferred and
   could paint first. The rest of the theme lives in
   js/shared/theme.js.
   ============================================================ */

(function () {
    "use strict";

    var KEY = "forem_theme";
    var saved = null;

    try {
        saved = localStorage.getItem(KEY);
    } catch (error) {
        saved = null;
    }

    // No validation here: js/shared/theme.js owns the THEMES list and
    // normalises whatever lands in localStorage via applyTheme(). This
    // script only has to pick a value before the first paint.
    if (!saved) {
        var prefersDark = window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches;
        saved = prefersDark ? "dark" : "light";
    }

    document.documentElement.setAttribute("data-theme", saved);
})();