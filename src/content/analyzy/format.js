/**
 * Shared formatting + the block vocabulary every analysis is written in.
 *
 * WHY BLOCKS AND NOT MARKDOWN
 *   The whole point of this section is to copy the house style Slovak market
 *   analyses are written in — declarative headline, headline number in the first
 *   sentence, fixed metric order, methodology at the end. Prose in a Markdown
 *   file drifts away from that within two issues. A structured block list cannot:
 *   `method` is a required field on every article, so an analysis physically
 *   cannot ship without saying where its numbers came from.
 *
 * WHY THE NUMBERS ARE NOT TYPED HERE
 *   Every figure is read from the generated report JSON (see
 *   v2/scripts/market_report.py in the scraper repo). Retyping one into prose is
 *   how the article, the charts and the database drift apart — which happened
 *   once already in a draft and was caught only by an audit script.
 */

/** 1234567 → "1 234 567" (Slovak thousands separator is a space). */
export function n(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** 42.6 → "42,6 %" — Slovak decimal comma, non-breaking space before the sign. */
export function pct(value, digits = 1) {
  return value.toFixed(digits).replace(".", ",") + " %";
}

/** 5370 → "5 370 €/m²" */
export function eurM2(value) {
  return n(value) + " €/m²";
}

/** ISO date → "7. septembra 2026" */
const MONTHS_SK = [
  "januára", "februára", "marca", "apríla", "mája", "júna",
  "júla", "augusta", "septembra", "októbra", "novembra", "decembra",
];
export function dateSk(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCDate()}. ${MONTHS_SK[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Short form for the eyebrow line: "SEPTEMBER 2026" */
const MONTHS_SK_NOM = [
  "JANUÁR", "FEBRUÁR", "MAREC", "APRÍL", "MÁJ", "JÚN",
  "JÚL", "AUGUST", "SEPTEMBER", "OKTÓBER", "NOVEMBER", "DECEMBER",
];
export function monthSk(iso) {
  const d = new Date(iso + "T00:00:00Z");
  return `${MONTHS_SK_NOM[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Pick one row out of the disposition mix by room count. */
export function byIzby(mix, izby) {
  const row = mix.rows.find((r) => r.izby === izby);
  if (!row) throw new Error(`disposition ${izby} missing from the report`);
  return row;
}
