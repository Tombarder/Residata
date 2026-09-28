/**
 * trialBannerState — whether the trial banner shows, decided before the first
 * paint from what this browser already knows. Pure (storage is passed in), so it
 * is tested without a DOM (trialBannerState.test.mjs); TrialBanner.jsx renders it.
 */
import { LANG_STORAGE_KEY, PUBLIC_LANGS, DEFAULT_LANG } from "./locale.js";
import { ADDRESS_LANGS } from "./routing.js";

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

/**
 * firstPaintBanner — plus the language the app will render in — as a tiny script
 * for <head> (index.html, filled in by vite.config.js). It runs before the first
 * paint and sets html[data-rd-banner] to "sk" / "en" / "none", so a pre-built
 * page shows the very banner the app is about to show, and the text sits below
 * its real height. The language follows lib/langChoice: the address's own
 * (/sk/…) first, then the kept pick, then the default. Built from the same keys
 * and lists, and held to the same answers by trialBannerState.test.mjs.
 */
export function firstPaintScript() {
  const J = JSON.stringify;
  return "(function(){var h=document.documentElement,P=" + J(PUBLIC_LANGS) + ",a=null;"
    + "try{var p=(window.location.pathname||\"/\").toLowerCase().replace(/\\/+$/,\"\"),A=" + J(ADDRESS_LANGS) + ";"
    + "for(var j=0;j<A.length;j++){if(p===\"/\"+A[j]||p.indexOf(\"/\"+A[j]+\"/\")===0){a=A[j];break}}"
    + "if(P.indexOf(a)<0)a=null}catch(t){}"
    + "try{var s=window.localStorage,"
    + "d=Date.now()<Number(s.getItem(" + J(KEY_BANNER_DISMISSED) + ")||0),x=false;"
    + "for(var i=0;i<s.length;i++){if(/^sb-.+-auth-token$/.test(s.key(i)||\"\")){x=true;break}}"
    + "var e=x?s.getItem(" + J(KEY_OFFER_REMEMBERED) + ")===\"1\":true,l=a||s.getItem(" + J(LANG_STORAGE_KEY) + ");"
    + "if(P.indexOf(l)<0)l=" + J(DEFAULT_LANG) + ";"
    + "h.setAttribute(\"data-rd-banner\",e&&!d?l:\"none\")"
    + "}catch(t){h.setAttribute(\"data-rd-banner\",a||" + J(DEFAULT_LANG) + ")}})();";
}
