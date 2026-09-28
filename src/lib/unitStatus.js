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

/** The code a page uses for a flat that is no longer on its project's price list and is
 *  not counted as sold — see listingStatus. */
export const OFF_LIST = "OFF_LIST";
const OFF_LIST_CODE = OFF_LIST;

/** Canonical display order — available first, sold last. Matches `pivotColOrder`. */
export const STATUS_ORDER = ["V", "R", "PR", "P", "Ešte nie v ponuke", "ERROR"];

const LABELS = {
  V:                    { one: ["Voľný", "Available"],           many: ["Voľné", "Available"] },
  R:                    { one: ["Rezervovaný", "Reserved"],      many: ["Rezervované", "Reserved"] },
  PR:                   { one: ["Predrezervovaný", "Pre-reserved"], many: ["Predrezervované", "Pre-reserved"] },
  P:                    { one: ["Predaný", "Sold"],              many: ["Predané", "Sold"] },
  "Ešte nie v ponuke":  { one: ["Ešte nie v ponuke", "Not yet listed"], many: ["Ešte nie v ponuke", "Not yet listed"] },
  ERROR:                { one: ["Chyba", "Error"],               many: ["Chyby", "Errors"] },
  /* Not a scraper code: what a page says about a flat that has LEFT the price list and
     that the ledger does not count as sold. See listingStatus below. */
  [OFF_LIST_CODE]:      { one: ["Mimo cenníka", "Off the price list"], many: ["Mimo cenníka", "Off the price list"] },
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

/**
 * listingStatus(unit) — the status to SHOW for a flat, including one that has left the
 * price list. Boss, 2026-09-28: "if flat is marked as sold … it must be correct
 * everywhere".
 *
 * The RULE lives in one place, the database's reference.listing_stav: still on the list →
 * what the developer's page says today; left the list → the ledger's verdict (sold → "P",
 * anything else → OFF_LIST). Every function that serves flats with a history
 * (project_units_series, unit_list_json, unit_listing, project_units_sold_off_list)
 * returns that answer in `stav`, and keeps what the page last said beside it as
 * `last_seen_stav`. This only READS it. `latest_stav` is the fallback for rows straight
 * from the current price list (unit_search), where the two are the same thing.
 *
 * It used to re-derive the rule here as well — two copies of one rule is how the four
 * copies of the unit-kind list drifted apart (CLAUDE.md, unit_kinds). One copy now.
 */
export function listingStatus(unit) {
  if (!unit) return null;
  return unit.stav ?? unit.latest_stav ?? null;
}

/**
 * withSoldOffList(current, soldOff, projectId) — a project's flats AS ITS HEADER COUNTS
 * THEM: the current price list plus the sold flats the developer took off it
 * (public.project_units_sold_off_list). Only THIS project's, and never a flat the price
 * list still shows — the two lists come from different serving layers, so for a moment
 * after a scrape a flat can be in both, and a project switch can hand over the previous
 * project's rows before the new ones land. Returns `current` itself when nothing is added.
 */
export function withSoldOffList(current, soldOff, projectId) {
  const base = Array.isArray(current) ? current : [];
  if (!Array.isArray(soldOff) || soldOff.length === 0) return base;
  const listed = new Set(base.map((f) => `${f.project_id}::${f.unit_id}`));
  const extra = soldOff.filter((f) => f && f.project_id === projectId && !listed.has(`${f.project_id}::${f.unit_id}`));
  return extra.length ? [...base, ...extra] : base;
}
