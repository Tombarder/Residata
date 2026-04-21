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

export function pageToPath(page) {
  if (!page || page === "Home") return "/";
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
  if (clean.startsWith("/project/")) return "Project:" + clean.slice(9);

  const map = {
    "/home": "Home",
    "/live": "Live",
    "/use-cases": "Use Cases",
    "/pricing": "Pricing",
    "/contact": "Contact",
    "/sample": "Data",    // nový primárny URL
    "/data": "Data",      // spätná kompatibilita (pôvodný URL)
    "/analytics": "Analytics",
    "/admin": "Admin",
    "/hero-lab": "HeroLab",   // hidden — page picker pre Home hero variant
  };
  return map[clean] || "Home";
}

export function pushRoute(page, replace = false) {
  const path = pageToPath(page);
  const state = { page };
  if (replace) window.history.replaceState(state, "", path);
  else window.history.pushState(state, "", path);
}
