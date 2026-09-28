/**
 * trialBannerState — whether the trial banner shows, decided before the first
 * paint from what this browser already knows. Pure (storage is passed in), so it
 * is tested without a DOM (trialBannerState.test.mjs); TrialBanner.jsx renders it.
 */

export const KEY_BANNER_DISMISSED = "residata_trial_banner_until";   // unix ms — banner hidden until this time
// "1" / "0": whether a LOGGED-IN account was offered the trial on its last visit —
// the first-paint answer for that browser until the account's profile has loaded.
export const KEY_OFFER_REMEMBERED = "residata_trial_offer_known";

/** A login session is stored in this browser. Supabase keeps it in localStorage
 *  under sb-<project>-auth-token; the key can be read synchronously, the session
 *  itself only arrives later. */
export function hasStoredSession(storage = globalThis.localStorage) {
  try {
    for (let i = 0; i < storage.length; i++) if (/^sb-.+-auth-token$/.test(storage.key(i) || "")) return true;
  } catch { /* storage blocked */ }
  return false;
}

/**
 * Whether the banner shows, decided from what the browser already knows in the
 * FIRST render — before the first paint: no stored session means an anonymous
 * visitor, who is always offered the trial; a stored session means a logged-in
 * visitor, whose eligibility is only known once the profile loads, so until then
 * the answer remembered from their last visit stands. Dismissed = not shown.
 */
export function firstPaintBanner(storage = globalThis.localStorage, now = Date.now()) {
  let dismissed = false, remembered = false;
  try {
    dismissed = now < Number(storage.getItem(KEY_BANNER_DISMISSED) || 0);
    remembered = storage.getItem(KEY_OFFER_REMEMBERED) === "1";
  } catch { /* storage blocked: an anonymous visitor as far as we can tell */ }
  return { dismissed, eligible: hasStoredSession(storage) ? remembered : true };
}
