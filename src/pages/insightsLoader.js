/**
 * Loading the /analyzy pages' code — once, and synchronously when it is in.
 *
 * WHY. The analyses are code-split (App.jsx lazy-loads them). On a page the
 * build pre-rendered (scripts/prerender.mjs) the article is on screen from the
 * first paint, and React.lazy then SUSPENDED on mount — showing the loading
 * spinner over it for ~0.2 s before the same article came back (measured
 * 2026-09-28: content → spinner → content). main.jsx now mounts the app on such
 * a page only after this module is in, and `insightsLazy` hands React.lazy a
 * thenable that resolves SYNCHRONOUSLY once it is, so the first render is the
 * article itself: one swap of identical content, no spinner.
 */
let mod = null;
let pending = null;

export function loadInsights() {
  if (mod) return Promise.resolve(mod);
  pending = pending || import("./Insights.jsx").then((m) => (mod = m));
  return pending;
}

/** A React.lazy factory for one export of Insights.jsx. */
export function insightsLazy(pick) {
  return () => (mod
    // React.lazy reads a thenable that calls back synchronously without suspending.
    ? { then: (resolve) => resolve({ default: pick(mod) }) }
    : loadInsights().then((m) => ({ default: pick(m) })));
}
