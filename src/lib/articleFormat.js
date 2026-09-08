/**
 * Shared formatting + the block vocabulary every analysis is written in.
 *
 * Lives in lib/ because the LIVE article page imports it. It used to sit under
 * content/analyzy, a folder documented as seed data only — code that runs on
 * every visit should not live in a folder that says it does not run.
 *
 * WHY BLOCKS AND NOT MARKDOWN
 *   The point of this section is to copy the house style Slovak market analyses
 *   are written in — declarative headline, headline number in the first sentence,
 *   fixed metric order, methodology at the end. Prose in a Markdown file drifts
 *   away from that within two issues. A structured block list cannot: `method` is
 *   a required field, so an analysis physically cannot ship without saying where
 *   its numbers came from.
 *
 * WHY EVERY BLOCK IS BILINGUAL
 *   The platform serves Slovak and English, so a Slovak-only article is a broken
 *   page for half the site. Text fields are {sk, en} pairs and the renderer picks
 *   by the visitor's language; `t()` below is the only place that choice is made.
 *
 * WHY THE NUMBERS ARE NOT TYPED HERE
 *   Every figure is read from the generated report JSON (v2/scripts/market_report.py
 *   in the scraper repo). Retyping one into prose is how the article, the charts
 *   and the database drift apart — which happened once already in a draft and was
 *   caught only by an audit script.
 */

/** Pick the right language out of a {sk, en} pair; plain strings pass through. */
export function t(value, lang) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return (lang === "en" ? value.en : value.sk) ?? value.sk ?? "";
}

const SEP = { sk: { thousands: " ", decimal: "," }, en: { thousands: " ", decimal: "." } };

/** 1234567 → "1 234 567" */
export function n(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** 42.6 → "42,6 %" in Slovak, "42.6%" in English. */
export function pct(value, lang = "sk", digits = 1) {
  const s = value.toFixed(digits).replace(".", SEP[lang === "en" ? "en" : "sk"].decimal);
  return lang === "en" ? `${s}%` : `${s} %`;
}

/** 5370 → "5 370 €/m²" */
export function eurM2(value) {
  return n(value) + " €/m²";
}

const MONTHS = {
  sk: { gen: ["januára", "februára", "marca", "apríla", "mája", "júna", "júla",
              "augusta", "septembra", "októbra", "novembra", "decembra"],
        nom: ["JANUÁR", "FEBRUÁR", "MAREC", "APRÍL", "MÁJ", "JÚN", "JÚL",
              "AUGUST", "SEPTEMBER", "OKTÓBER", "NOVEMBER", "DECEMBER"] },
  en: { gen: ["January", "February", "March", "April", "May", "June", "July",
              "August", "September", "October", "November", "December"],
        nom: ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
              "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"] },
};

const parse = (iso) => new Date(iso + "T00:00:00Z");

/** ISO date → "8. septembra 2026" / "8 September 2026" */
export function dateLong(iso, lang = "sk") {
  const d = parse(iso);
  const m = MONTHS[lang === "en" ? "en" : "sk"].gen[d.getUTCMonth()];
  return lang === "en"
    ? `${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`
    : `${d.getUTCDate()}. ${m} ${d.getUTCFullYear()}`;
}

/** Eyebrow line: "SEPTEMBER 2026" */
export function monthLong(iso, lang = "sk") {
  const d = parse(iso);
  return `${MONTHS[lang === "en" ? "en" : "sk"].nom[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The observation window, phrased honestly.
 *
 * This helper exists because the first draft said "za posledných šesť mesiacov"
 * on 113 days of data — the query used a rolling 180-day window that reached two
 * months back beyond the day collection started. The figures were real; the label
 * was not. Nothing in an article may describe a period except through this.
 */
export function windowPhrase(win, lang = "sk") {
  return lang === "en"
    ? `since ${dateLong(win.from, "en")}`
    : `od ${dateLong(win.from, "sk")}`;
}

/** "za 113 dní" / "over 113 days" */
export function windowDays(win, lang = "sk") {
  return lang === "en" ? `over ${win.days} days` : `za ${win.days} dní`;
}

/**
 * Slovak needs three forms of "mesiac" and picks by the number in front of it:
 * 1 mesiac · 2–4 mesiace · 5+ mesiacov (and 0 takes the genitive plural too).
 * The first version handled only 1 and then said "mesiace" for everything else,
 * so any value of five or more would have printed "5 mesiace".
 */
export function months(count, lang = "sk") {
  if (lang === "en") return `${count} month${count === 1 ? "" : "s"}`;
  const k = Math.abs(Math.round(count));
  if (k === 1) return "1 mesiac";
  if (k >= 2 && k <= 4) return `${k} mesiace`;
  return `${k} mesiacov`;
}

/** Pick one row out of the disposition mix by room count. */
export function byIzby(mix, izby) {
  const row = mix.rows.find((r) => r.izby === izby);
  if (!row) throw new Error(`disposition ${izby} missing from the report`);
  return row;
}
