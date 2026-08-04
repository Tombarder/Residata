/**
 * Cookie-consent read helper.
 *
 * Mirrors the shape written by CookieBanner.jsx to
 * localStorage["residata-cookie-consent"]: { v, ts, essential, analytics }.
 *
 * Used to GATE non-essential behavior (first-party usage analytics via
 * track.js) so that a "Reject" in the cookie banner is actually honored —
 * previously the banner was cosmetic and tracking ran regardless (GDPR /
 * ePrivacy issue). Essential/session functionality is unaffected.
 */
const STORAGE_KEY = "residata-cookie-consent";

export function readConsent() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

/**
 * True ONLY if the user has explicitly consented to analytics. If the banner
 * hasn't been answered yet (no stored choice), this returns false — so nothing
 * non-essential runs before an explicit opt-in.
 */
export function hasAnalyticsConsent() {
  const c = readConsent();
  return !!(c && c.analytics === true);
}
