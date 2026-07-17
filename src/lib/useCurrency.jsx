import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabasePublic, isSupabaseReady } from "./supabase";
import { useCountry } from "./useCountry";
import { setMoney } from "./money";

/**
 * useCurrency — display-currency for the price layer.
 *
 * Boss (2026-06-09): "czk natively but have a button that recalculates to the
 * current exchange rate … once user presses switch it will switch."
 * Boss (2026-06-24): the switcher must be PERSISTENT and work in EVERY view —
 * you can view CZK prices while in the SK or All market too (not only CZ).
 *
 * Model — currency is DECOUPLED from the market:
 *   · `displayCode` is whatever currency the user picked (an explicit, global,
 *     persisted choice). All stored money is EUR, so any currency is just a
 *     ×rate conversion that works regardless of which market is selected.
 *   · Until the user picks one, we follow the viewed market's native currency
 *     (CZ → CZK, SK / All → EUR) — preserves the prior default. The moment they
 *     click a currency it sticks GLOBALLY (CZK stays CZK when they move to SK).
 *   · `currencies` (the offered set) is derived from the active markets:
 *     EUR + each active market's native currency. Auto-grows when PL/HU/… open.
 *
 * The live rate comes from public.currency_rates (anon mirror of
 * reference.currencies, refreshed daily from the ECB by v2/lib/fx_rates.py).
 * Cross-country TOTALS always stay in € at the data layer.
 *
 * The selected currency is mirrored into money.js so the ~15 plain price
 * formatters across the app render the right amount + symbol without each
 * having to become a hook.
 */

const SYMBOLS = { EUR: "€", CZK: "Kč", PLN: "zł", HUF: "Ft", RON: "lei", BGN: "лв" };
// Native currency per ISO country (matches reference.countries.currency_code).
const NATIVE_CCY = { SK: "EUR", CZ: "CZK", PL: "PLN", HU: "HUF", AT: "EUR", DE: "EUR" };

const LS_KEY = "residata_currency_code"; // explicit ISO choice ('EUR'|'CZK'|…) | absent = follow market

const CurrencyContext = createContext({
  displayCode: "EUR", displaySymbol: "€", unitsPerEur: 1,
  currencies: ["EUR"], setCurrency: () => {},
  // legacy aliases (kept so existing subscribers don't break)
  mode: "eur", setMode: () => {}, toggle: () => {}, nativeCode: "EUR", hasNativeAlt: false,
});

export function CurrencyProvider({ children }) {
  const { country, countries } = useCountry();
  // Explicit user choice (ISO code) or null = "follow the viewed market".
  const [chosen, setChosenRaw] = useState(() => {
    try { return localStorage.getItem(LS_KEY) || null; } catch { return null; }
  });
  // code -> exchange_rate_to_eur (EUR value of 1 unit). EUR always 1.
  const [rates, setRates] = useState({ EUR: 1 });

  const setCurrency = (code) => {
    setChosenRaw(code);
    try { localStorage.setItem(LS_KEY, code); } catch { /* private mode */ }
  };

  // Fetch live rates once (public, anon — never depends on a user session).
  useEffect(() => {
    if (!isSupabaseReady()) return;
    let cancelled = false;
    supabasePublic.from("currency_rates").select("code, exchange_rate_to_eur").then(({ data, error }) => {
      if (cancelled || error || !data) return;
      const m = { EUR: 1 };
      data.forEach((r) => { if (r.code) m[r.code] = Number(r.exchange_rate_to_eur); });
      setRates(m);
    });
    return () => { cancelled = true; };
  }, []);

  const derived = useMemo(() => {
    const marketNative = NATIVE_CCY[country] || "EUR";
    // Offered currencies = EUR + native currency of every ACTIVE market, deduped,
    // EUR first. (countries comes from public.projects_live, so this is exactly
    // "currencies worth offering" and grows on its own as new markets open.)
    const reals = (countries || []).filter((c) => c && c !== "all");
    const offered = ["EUR", ...reals.map((c) => NATIVE_CCY[c] || "EUR")]
      .filter((v, i, a) => a.indexOf(v) === i);
    // Explicit choice wins (global); otherwise default to EUR (Boss 2026-06-25:
    // "default is EUR and ALL"). The whole platform is EUR-first, so a fresh
    // visitor lands on € everywhere; CZK is one click and then sticks globally.
    let displayCode = chosen && offered.includes(chosen) ? chosen : "EUR";
    if (!offered.includes(displayCode)) displayCode = "EUR";
    const exch = rates[displayCode]; // EUR per 1 unit
    // A non-EUR currency needs a VALID positive rate to convert. Until the rates fetch
    // lands (or if it fails / a row has a null/0 rate), fall back to EUR display ENTIRELY
    // — code, symbol AND factor together. Otherwise we'd pair the "Kč" symbol with an
    // unconverted EUR number (unitsPerEur=1), a ~24× understatement with the wrong symbol.
    let unitsPerEur = 1;
    if (displayCode !== "EUR") {
      if (exch && Number.isFinite(exch) && exch > 0) unitsPerEur = 1 / exch;
      else displayCode = "EUR"; // rate not (yet) available → show EUR, not wrong Kč
    }
    return {
      marketNative,
      offered,
      displayCode,
      displaySymbol: SYMBOLS[displayCode] || displayCode,
      unitsPerEur,
    };
  }, [country, countries, chosen, rates]);

  // Keep the module-level mirror in sync SYNCHRONOUSLY (during render, not in an
  // effect) so the plain formatters read the new currency on the SAME render the
  // toggle triggers — otherwise consumers paint one render stale. Writing a
  // module global derived purely from state/props is safe + idempotent here.
  setMoney({ code: derived.displayCode, symbol: derived.displaySymbol, unitsPerEur: derived.unitsPerEur });

  const value = useMemo(() => ({
    // current API
    displayCode: derived.displayCode,
    displaySymbol: derived.displaySymbol,
    unitsPerEur: derived.unitsPerEur,
    currencies: derived.offered,
    setCurrency,
    // legacy aliases — keep Ticker + any other subscribers working unchanged
    mode: derived.displayCode === "EUR" ? "eur" : "native",
    setMode: (m) => setCurrency(m === "eur" ? "EUR" : derived.marketNative),
    toggle: () => setCurrency(derived.displayCode === "EUR" ? derived.marketNative : "EUR"),
    nativeCode: derived.marketNative,
    hasNativeAlt: derived.offered.length > 1,
  }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [derived]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() { return useContext(CurrencyContext); }
