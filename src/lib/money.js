/**
 * money.js — module-level mirror of the CURRENT display currency.
 *
 * Why a module global (not only the React context): price formatting lives in
 * ~15 plain functions scattered across pages (fmtEur, formatPrice, formatPerM2…)
 * that are NOT React components and can't call a hook. At any instant every
 * visible price uses ONE currency (you're viewing one country in one mode), so
 * a single global symbol + rate is correct and simplest. `CurrencyProvider`
 * keeps this in sync with the React context (see useCurrency.jsx); the
 * formatters read moneyFromEur()/moneySymbol() from here.
 *
 * Convention: ALL stored money in the app is EUR-denominated (price_s_dph_eur,
 * eur_m2, avg_eur_m2…). moneyFromEur() converts a EUR number into the current
 * display currency: ×1 in EUR mode, ×unitsPerEur (≈24.17) in CZK-native mode.
 */
let _money = { code: "EUR", symbol: "€", unitsPerEur: 1 };

export function setMoney(next) {
  _money = { ..._money, ...next };
}

export function moneySymbol() { return _money.symbol; }

/** Convert a EUR-denominated number into the current display currency.
 *  Returns the input unchanged for null / non-finite so formatters keep their
 *  own "—" / "" empty handling. */
export function moneyFromEur(eur) {
  if (eur == null) return eur;
  const n = Number(eur);
  if (!Number.isFinite(n)) return eur;
  return n * _money.unitsPerEur;
}

/** Inverse of moneyFromEur: convert a number typed in the current DISPLAY currency
 *  back to EUR — for sending user-entered money thresholds to EUR-denominated columns
 *  (e.g. the Sales detail price filters, which the DB stores in EUR). */
export function moneyToEur(disp) {
  if (disp == null) return disp;
  const n = Number(disp);
  if (!Number.isFinite(n)) return disp;
  return _money.unitsPerEur ? n / _money.unitsPerEur : n;
}

/**
 * formatMoney / formatPerM2 — how a price is WRITTEN, in one place.
 *
 * The module docstring above says formatting "lives in ~15 plain functions scattered
 * across pages", and that scattering produced a real fault: eleven of those sites put the
 * symbol after the number with a space ("204 342 €"), and two put it in front with none.
 * In EUR that only looked foreign. In CZK it printed "Kč4 958 193" — a Czech reader never
 * writes it that way, and the Unit database and Sales were the two pages doing it.
 *
 * So: the amount, a non-breaking space, then the symbol. The space is NBSP because a
 * price must never wrap between the number and its currency.
 *
 * Grouping is sk-SK, which is what every one of those sites already used — including the
 * ones that reached it the long way round via en-US plus a comma swap.
 */
const GROUPED = (n) => Math.round(n).toLocaleString("sk-SK").replace(/,/g, " ");

/* A MISSING price is not a free one. `moneyFromEur` deliberately hands null and "" back
   untouched so each formatter can keep its own empty handling — and Number(null) is 0, so
   the first cut of these printed "0 €" for a flat with no published price. Guard the input,
   not the product. (Caught by money.test.mjs before it ever rendered.) */
const NO_AMOUNT = (v) => v == null || v === "";

/** A price: "204 342 €" / "4 958 193 Kč". Takes a EUR-denominated number. */
export function formatMoney(eur) {
  if (NO_AMOUNT(eur)) return "—";
  const n = Number(moneyFromEur(eur));
  return Number.isFinite(n) ? GROUPED(n) + " " + moneySymbol() : "—";
}

/** A unit rate: "4 813 €/m²" / "116 700 Kč/m²". Takes a EUR-denominated number. */
export function formatPerM2(eur) {
  if (NO_AMOUNT(eur)) return "—";
  const n = Number(moneyFromEur(eur));
  return Number.isFinite(n) ? GROUPED(n) + " " + moneySymbol() + "/m²" : "—";
}
