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
