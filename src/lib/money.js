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
