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
 * listingStatus(unit) — the status to SHOW for a flat whose history we hold, including a
 * flat that has since left the price list.
 *
 * `latest_stav` is the last status the flat was SEEN with. For a flat still on the list
 * that is exactly right: it is what the developer's page says today. For a flat that has
 * vanished it is stale — a project that deletes a flat when it sells leaves every sold
 * flat frozen at "Voľný", and on 2026-09-28 the Byt-v-čase grid showed 88 of Tesla
 * Hloubětín's sold flats as available that way. The ledger (reference.unit_ledger) is
 * the platform's single answer to "was it sold" (memory rules_sold_from_the_ledger), so a
 * vanished flat takes ITS verdict: sold → "P", anything else → OFF_LIST.
 *
 * A row that does not say whether it is still listed (`on_price_list` absent — an older
 * server, or a surface that never asks) keeps its last seen status, as before.
 */
export function listingStatus(unit) {
  if (!unit) return null;
  if (unit.on_price_list === false) return unit.ledger_status === "SOLD" ? "P" : OFF_LIST;
  return unit.latest_stav ?? unit.stav ?? null;
}
