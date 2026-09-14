/**
 * locale.js — single source of truth mapping the app's UI language code
 * (en | sk | cs) to a BCP-47 locale tag for Intl / toLocaleString number and
 * date formatting.
 *
 * WHY THIS EXISTS: number grouping and date formats are locale-specific, and the
 * codebase had ~20 inline `lang === "sk" ? "sk-SK" : "en-US"` ternaries. Every
 * one of them silently mishandled any third language — when Czech ('cs') became
 * selectable, it grouped numbers the en-US way ("1,234,567") instead of the
 * Czech way ("1 234 567"). Centralising means adding a language is ONE edit here,
 * not a sweep across every page.
 *
 * TEXT vs FORMATTING fall back independently. UI text falls back cs->en (see
 * getLiveT / localizedCopy) until Czech copy is authored. But number/date
 * formatting is not a translation — a Czech visitor wants Czech grouping
 * regardless of whether the surrounding copy is Czech yet. So cs maps to cs-CZ
 * here even while text still falls back to English.
 */
const LOCALE_TAGS = { en: "en-US", sk: "sk-SK", cs: "cs-CZ" };

/** App language code -> BCP-47 locale tag. Unknown langs fall back to en-US. */
export function localeTag(lang) {
  return LOCALE_TAGS[lang] || LOCALE_TAGS.en;
}

/**
 * PUBLIC_LANGS — the single source of truth for which UI languages are exposed
 * to visitors (switcher pills, browser auto-detect, hreflang alternates).
 *
 * Czech ('cs') is FULLY BUILT — nav labels (pagesCS), live dicts (liveLang.js),
 * cs-CZ number/date formatting, hreflang — but held back from the public launch.
 * To re-expose Czech everywhere, add "cs" back to this array (ONE edit); every
 * switcher, the auto-detect, and the hreflang set read from here. Order here is
 * the order the switcher pills render in. Never hardcode a language list again.
 */
export const PUBLIC_LANGS = ["en", "sk"];

/** Fallback language for anything not in PUBLIC_LANGS. */
export const DEFAULT_LANG = "en";

/** Short label shown on switcher pills per language code. */
export const LANG_LABELS = { en: "EN", sk: "SK", cs: "CZ" };

/** True if `lang` is currently public (shown in switchers / auto-selectable). */
export function isPublicLang(lang) {
  return PUBLIC_LANGS.includes(lang);
}

/**
 * Coerce any stored/detected language code to a public one. A stale pick that is
 * no longer public (e.g. a returning visitor whose localStorage still says 'cs')
 * falls back to DEFAULT_LANG so nobody gets stranded on a hidden language with no
 * pill to switch away from.
 */
export function coercePublicLang(lang) {
  return isPublicLang(lang) ? lang : DEFAULT_LANG;
}

/**
 * formatDimNumber — one way to print a NUMERIC DIMENSION value (rooms, floor).
 *
 * PostgREST serialises a Postgres `numeric` as a STRING, so anything that printed one
 * straight showed "6.0" for a six-room flat and "1.0" for the first floor — in the table
 * on the Unit database, and again in the filter's own value list beside it. Sales had a
 * third spelling: it stripped ".0" but left "2.5" with a dot inside a Slovak page.
 *
 * Never rounded to a whole number. 1,5- and 2,5-izbový are real categories, with 78 426
 * and 14 145 units behind them — rounding would merge them into their neighbours.
 *
 * Grouping follows the same sk-SK presentation the surrounding money and area columns
 * already use, so one row never mixes two conventions. That app-wide choice lives with
 * `money.js` and the price renderers; this helper deliberately does not diverge from it.
 *
 * Returns the input untouched when it is not a number, so a text dimension is safe to
 * pass through.
 */
export function formatDimNumber(v) {
  if (v === null || v === undefined || v === "") return v;
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("sk-SK", { maximumFractionDigits: 2 }) : String(v);
}
