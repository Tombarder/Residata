/**
 * unitStatus.js — what a unit's `stav` code MEANS, in one place.
 *
 * The codes (V / R / PR / P / "Ešte nie v ponuke" / ERROR) are the scraper's vocabulary
 * and they are fine in the database. On a page they are not: the Unit database printed a
 * bare "V" in its Status column, which tells a reader nothing.
 *
 * It was already spelled out by hand in three separate pages — DataQA, LivePages and
 * UnitTracker — and the three had drifted into disagreement about the wording. Two of
 * those spellings are BOTH right, which is the interesting part and why this module
 * carries two forms rather than one:
 *
 *   · ONE  — a single flat, as a row or a detail page: "Voľný byt"  → Voľný / Predaný
 *   · MANY — a count or a category of them:            "Voľné byty" → Voľné / Predané
 *
 * Getting that wrong reads as broken Slovak, so the caller says which it means.
 * Colours stay with the pages: the map legend and the QA table deliberately use
 * different palettes, and that is a design choice, not a fact about the status.
 */

/** Canonical display order — available first, sold last. Matches `pivotColOrder`. */
export const STATUS_ORDER = ["V", "R", "PR", "P", "Ešte nie v ponuke", "ERROR"];

const LABELS = {
  V:                    { one: ["Voľný", "Available"],           many: ["Voľné", "Available"] },
  R:                    { one: ["Rezervovaný", "Reserved"],      many: ["Rezervované", "Reserved"] },
  PR:                   { one: ["Predrezervovaný", "Pre-reserved"], many: ["Predrezervované", "Pre-reserved"] },
  P:                    { one: ["Predaný", "Sold"],              many: ["Predané", "Sold"] },
  "Ešte nie v ponuke":  { one: ["Ešte nie v ponuke", "Not yet listed"], many: ["Ešte nie v ponuke", "Not yet listed"] },
  ERROR:                { one: ["Chyba", "Error"],               many: ["Chyby", "Errors"] },
};

/**
 * statusLabel(code, lang, form) — the human wording for a `stav` code.
 *
 * An UNKNOWN code comes back unchanged rather than as a blank or a guess: a status we
 * have never seen is a data question, and hiding it behind "—" is how it stays unseen.
 */
export function statusLabel(code, lang = "sk", form = "one") {
  const entry = LABELS[code];
  if (!entry) return code;
  return (entry[form] || entry.one)[lang === "sk" ? 0 : 1];
}

/** Every code with its label, in display order — for legends, pickers and filters. */
export function statusOptions(lang = "sk", form = "many", codes = STATUS_ORDER) {
  return codes.map((code) => ({ value: code, label: statusLabel(code, lang, form) }));
}
