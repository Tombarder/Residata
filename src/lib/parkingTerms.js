/* PARKING VOCABULARY — the words and the badge each term earns.
 *
 * Split out of parkingPrices.jsx so it can be TESTED. The tone lookup used to live
 * inline in the card, and when the field was renamed the rename missed its
 * declaration: `tone is not defined`, a blank project detail page in production.
 * `npm run build` cannot see that, and no test could either — the node test runner
 * will not import a .jsx file, so nothing that lives beside JSX is reachable.
 *
 * Everything here is pure and plain .js. The rule for what belongs in this file:
 * if it decides something, it goes here and gets a test; if it draws something, it
 * stays in the component.
 *
 * v2/lib/parking.py and v2/lib/unit_kinds.py are the sources of truth for the
 * vocabularies themselves; this is the display copy.
 */
const sk = (lang) => lang === "sk";

/** The kinds, in the order they are shown. Mirrors unit_kinds.REGISTER_KINDS. */
export const PARKING_KINDS = [
  { key: "parking_garage",  sk: "Garáž / kryté státie", en: "Garage (indoor)" },
  { key: "parking_outside", sk: "Vonkajšie státie",     en: "Outdoor bay" },
  { key: "parking",         sk: "Parkovanie",           en: "Parking" },
  { key: "storage",         sk: "Kobka / pivnica",      en: "Storage" },
];

/** Mirrors AVAILABILITY in v2/lib/parking.py — that module is the source of truth.
 *
 * Boss 2026-09-03: *"make sure u also record somewhere if the garage is already in
 * price of the apartment, or if its mandatory, or if not mandatory. very important
 * differences."* They are, and they point in opposite directions, so they must not
 * look alike:
 *
 *   included   the flat price already covers a bay → the project is CHEAPER than a
 *              rival quoting the same flat price without one.   (ok, green)
 *   mandatory  the buyer cannot decline → the project is DEARER than its own price
 *              list says.                                        (warn, amber)
 *   optional   a separate product, the price list stands.        (plain chip)
 *
 * Three identical grey chips would bury the only part of this card that changes
 * what a buyer actually pays.
 */
export const TERMS = {
  mandatory:   { sk: "POVINNÉ",       en: "COMPULSORY",        tone: "warn" },
  included:    { sk: "V CENE BYTU",   en: "IN THE FLAT PRICE",  tone: "ok" },
  optional:    { sk: "voliteľné",     en: "optional" },
  on_request:  { sk: "na vyžiadanie", en: "on request" },
  not_offered: { sk: "nepredáva sa",  en: "not sold" },
  unknown:     { sk: "neuvedené",     en: "not stated" },
};

export const VAT = {
  s_dph:   { sk: "s DPH",   en: "incl. VAT" },
  bez_dph: { sk: "bez DPH", en: "excl. VAT" },
};

export function kindLabel(kind, lang) {
  const k = PARKING_KINDS.find((x) => x.key === kind);
  return k ? (sk(lang) ? k.sk : k.en) : kind;
}

/** Which badge tone a term earns, or null for a plain chip.
 *
 * Exported and pure ON PURPOSE. This lived inline in the component as
 * `TERMS[r.availability]?.strong`, and when the field was renamed the rename
 * missed the declaration while the usage changed — `tone is not defined`, a blank
 * project page in production. `npm run build` cannot see that and neither could
 * any test, because nothing rendered the card. A pure function can be tested.
 */
export function termsTone(availability) {
  return TERMS[availability]?.tone || null;
}


export function termsLabel(availability, lang) {
  const t = TERMS[availability];
  return t ? (sk(lang) ? t.sk : t.en) : null;
}
