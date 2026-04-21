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
    "/data": "Data",
    "/analytics": "Analytics",
    "/admin": "Admin",
  };
  return map[clean] || "Home";
}

export function pushRoute(page, replace = false) {
  const path = pageToPath(page);
  const state = { page };
  if (replace) window.history.replaceState(state, "", path);
  else window.history.pushState(state, "", path);
}
