/**
 * Which language a visitor sees — ONE rule, used by the app (App.jsx) and
 * mirrored by the before-paint script (trialBannerState.firstPaintScript), which
 * trialBannerState.test.mjs holds to it.
 *
 * The PICK is the visitor's language: what they chose with the switch, or their
 * account's once it loads. On a first visit it is the language of the address
 * they arrived on — /sk/cennik is the very page the switch would have led to.
 * Nothing else changes it: opening a Slovak link later does not overwrite an
 * English pick, and a visit never writes to an account. (Boss 2026-08-15: a
 * first-time visitor on an ordinary address lands in English — no guessing from
 * the browser's language. That still holds; an address with a language is not a
 * guess, it is the page the visitor opened.)
 *
 * The SHOWN language is the address's when the address has one (/sk/…),
 * whatever the pick: a link to a Slovak page opens a Slovak page. Every other
 * address — the English marketing pages, /analyzy, the app — shows the pick.
 *
 * Until 2026-09-28 the two were one state, so an English pick, arriving from the
 * account a moment after load, turned a Slovak link into the English page.
 */
import { pathLang } from "./routing.js";
import { DEFAULT_LANG, LANG_STORAGE_KEY, isPublicLang, coercePublicLang } from "./locale.js";

/** The language an address holds, if it is one we publish; otherwise null. */
export function addressLang(pathname) {
  const lang = pathLang(pathname);
  return isPublicLang(lang) ? lang : null;
}

/** The pick this browser has kept, or null when it has none. */
export function storedPick(storage = globalThis.localStorage) {
  try {
    const stored = storage.getItem(LANG_STORAGE_KEY);
    // A stale pick of a language no longer published ('cs') is no pick at all.
    return isPublicLang(stored) ? stored : null;
  } catch {
    return null;   // storage blocked (private mode etc.)
  }
}

/** The visitor's pick at page load: kept → first contact's address → default. */
export function initialPick(pathname, storage) {
  return storedPick(storage) || addressLang(pathname) || DEFAULT_LANG;
}

/** The language shown: the address's language when it has one, else the pick. */
export function shownLang(addrLang, pick) {
  return (isPublicLang(addrLang) ? addrLang : null) || coercePublicLang(pick);
}
