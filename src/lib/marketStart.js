/**
 * The market a page load starts on (lib/useCountry).
 *
 * 🔴 EVERY VISIT OPENS ON "ALL" (Boss 2026-10-07: "default pri otvorení stránky …
 * na všetky, nie len na Slovensko / len na Česko"). A pick is kept for the visit —
 * across pages and reloads of the same tab — and forgotten when the visit ends.
 * Until that day it was stored in the browser AND synced to the account, so one
 * click on SK made every later visit, on every device, open on Slovakia alone.
 */
export const ALL_COUNTRIES = "all";
export const SESSION_KEY = "residata_country_visit";
// The keys that used to remember the market for ever — cleared on sight, so an old
// pick cannot come back.
const RETIRED_KEYS = ["residata_country", "residata_country_all_default_v1"];

/** This visit's pick, else "all" — and any pick an older build stored for ever is
 *  erased, never read. */
export function startingCountry(session, local) {
  try { for (const k of RETIRED_KEYS) local?.removeItem(k); } catch { /* private mode */ }
  try { return session?.getItem(SESSION_KEY) || ALL_COUNTRIES; } catch { return ALL_COUNTRIES; }
}
