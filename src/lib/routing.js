/**
 * Minimalistic URL routing — žiadny react-router, len History API + popstate listener.
 *
 * Mapping page name → path:
 *   "Home"        → "/"
 *   "Live"        → "/live"
 *   "Use Cases"   → "/use-cases"
 *   "Pricing"     → "/pricing"
 *   "Contact"     → "/contact"
 *   "Data"        → "/data"
 *   "Analytics"   → "/analytics"
 *   "Admin"       → "/admin"
 *   "Project:foo" → "/project/foo"
 */

// ─── Platform (logged-in) page <-> URL mapping ───
// Platform pages use keys like "App:Dashboard", "App:Projects",
// "App:ProjectDetail:<id>" etc. URLs live under /app/*.
const APP_PAGE_TO_PATH = {
  "App:Dashboard": "/app",
  "App:Projects":  "/app/projects",
  "App:Map":       "/app/map",
  "App:Map2":      "/app/map-2",
  "App:Analytics": "/app/analytics",
  "App:UnitTimeline": "/app/unit-timeline",
  "App:Explorer":  "/app/explorer",
  "App:Sales":     "/app/sales",
  "App:Reports":   "/app/reports",
  "App:Exports":   "/app/exports",
  "App:Assistant": "/app/ask",
  "App:Billing":   "/app/billing",
  "App:Settings":  "/app/settings",
  "App:Admin":     "/app/admin",
  "App:Locations": "/app/locations",
  "App:DataQA":    "/app/data-qa",
  "App:Feedback":  "/app/feedback",
  "App:Texts":     "/app/texts",
  "App:Usage":     "/app/usage",
};
const APP_PATH_TO_PAGE = Object.fromEntries(
  Object.entries(APP_PAGE_TO_PATH).map(([k, v]) => [v, k])
);

export function pageToPath(page) {
  if (!page || page === "Home") return "/";
  if (typeof page === "string" && page.startsWith("App:ProjectDetail:")) {
    return "/app/projects/" + page.slice("App:ProjectDetail:".length);
  }
  if (APP_PAGE_TO_PATH[page]) return APP_PAGE_TO_PATH[page];
  if (typeof page === "string" && page.startsWith("Project:")) {
    return "/project/" + page.slice(8);
  }
  // "Data" page je v Nav-e prezentovaná ako "Sample" — preto /sample URL
  // (čitateľnejšie a odráža to marketing-preview charakter stránky).
  if (page === "Data") return "/sample";
  if (page === "HeroLab") return "/hero-lab";
  return "/" + page.toLowerCase().replace(/\s+/g, "-");
}

export function pathToPage(pathname) {
  const clean = (pathname || "/").toLowerCase().replace(/\/+$/, "");
  if (!clean || clean === "/") return "Home";

  // Platform project detail — /app/projects/<id>
  if (clean.startsWith("/app/projects/")) {
    const id = clean.slice("/app/projects/".length);
    if (id) return "App:ProjectDetail:" + id;
    return "App:Projects";
  }
  // Fixed app paths
  if (APP_PATH_TO_PAGE[clean]) return APP_PATH_TO_PAGE[clean];

  // Public project detail — /project/<id>
  if (clean.startsWith("/project/")) return "Project:" + clean.slice(9);

  const map = {
    "/home": "Home",
    "/live": "Live",
    "/use-cases": "Use Cases",
    "/pricing": "Pricing",
    "/contact": "Contact",
    "/sample": "Data",    // nový primárny URL
    "/data": "Data",      // spätná kompatibilita (pôvodný URL)
    // Legal pages — F-051 (Boss 2026-05-31 mandate)
    "/privacy": "Privacy",
    "/imprint": "Imprint",
    "/terms": "Terms",
    // Legacy URLs → new platform pages (for backward compat of email links etc)
    "/analytics": "App:Analytics",
    "/admin": "App:Admin",
    "/hero-lab": "HeroLab",   // hidden — page picker pre Home hero variant
  };
  if (map[clean]) return map[clean];
  // Unknown /app/* path (typo, renamed/removed route, stale bookmark): keep a
  // logged-in user INSIDE the platform — land on the Dashboard rather than bounce
  // them out to the marketing home (which reads as "logged out / broken").
  if (clean.startsWith("/app")) return "App:Dashboard";
  return "Home";
}

/** True if the page key belongs to the platform shell (/app/*). */
export function isAppPage(page) {
  if (!page) return false;
  return typeof page === "string" && page.startsWith("App:");
}

export function pushRoute(page, replace = false) {
  const path = pageToPath(page);
  const state = { page };
  if (replace) window.history.replaceState(state, "", path);
  else window.history.pushState(state, "", path);
}

/**
 * Smart back-navigation. Tries the browser's native history.back()
 * first — the user lands wherever they actually came from (Analytics
 * → project detail → back returns to Analytics, not the hard-coded
 * App:Projects). Falls back to `fallbackPage` only when there's no
 * meaningful history entry to return to (e.g. user opened the URL
 * directly in a new tab).
 *
 *   navigate(page) — caller's navigate function (handleNav from App
 *                    or PlatformShell.navigate). Only used as
 *                    fallback when history is empty.
 *   fallbackPage   — the page key to route to as a safety net.
 *
 * Why not always history.back(): if the user landed via direct URL
 * (no in-app history), history.back() either does nothing or
 * navigates out of the app. Routing them to a sensible fallback
 * keeps them in-product.
 */
export function goBack(navigate, fallbackPage = "Home") {
  if (typeof window === "undefined") return;
  const sameOriginReferrer = document.referrer && document.referrer.startsWith(window.location.origin);
  // history.length includes the current entry — > 1 means there's
  // something to go back to. Combined with referrer check this is a
  // 95% reliable "do we have a previous in-app page?" signal.
  const hasInAppHistory = window.history.length > 1 && (sameOriginReferrer || window.history.state?.page);
  if (hasInAppHistory) {
    window.history.back();
  } else if (navigate) {
    navigate(fallbackPage);
  } else {
    window.location.assign(pageToPath(fallbackPage));
  }
}
