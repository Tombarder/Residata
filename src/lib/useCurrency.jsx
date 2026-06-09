import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { supabasePublic, isSupabaseReady } from "./supabase";
import { useCountry } from "./useCountry";
import { setMoney } from "./money";

/**
 * useCurrency — display-currency toggle for the price layer.
 *
 * Boss (2026-06-09): "czk natively but have a button that recalculates to the
 * current exchange rate … just current … once user presses switch it will
 * switch."
 *
 * Two modes:
 *   · 'native' (default) — prices shown in the viewed country's own currency
 *     (CZK for Czechia, € for Slovakia).
 *   · 'eur'              — everything shown in € at the CURRENT live rate.
 *
 * The live rate comes from public.currency_rates (anon-readable mirror of
 * reference.currencies, refreshed daily from the ECB by v2/lib/fx_rates.py).
 * Cross-country TOTALS always stay in € regardless of this toggle — those are
 * inherently multi-currency and handled at the data layer.
 *
 * The selected currency is mirrored into money.js so the ~15 plain price
 * formatters across the app render the right amount + symbol without each
 * having to become a hook.
 */

const SYMBOLS = { EUR: "€", CZK: "Kč", PLN: "zł", HUF: "Ft", RON: "lei", BGN: "лв" };
// Native currency per ISO country (matches reference.countries.currency_code).
const NATIVE_CCY = { SK: "EUR", CZ: "CZK", PL: "PLN", HU: "HUF", AT: "EUR", DE: "EUR" };

const LS_KEY = "residata_currency";   // 'native' | 'eur'
const DEFAULT_MODE = "native";

const CurrencyContext = createContext({
  mode: DEFAULT_MODE, setMode: () => {}, toggle: () => {},
  displayCode: "EUR", displaySymbol: "€", nativeCode: "EUR",
  unitsPerEur: 1, hasNativeAlt: false,
});

export function CurrencyProvider({ children }) {
  const { country } = useCountry();
  const [mode, setModeRaw] = useState(() => {
    try { return localStorage.getItem(LS_KEY) || DEFAULT_MODE; } catch { return DEFAULT_MODE; }
  });
  // code -> exchange_rate_to_eur (EUR value of 1 unit). EUR always 1.
  const [rates, setRates] = useState({ EUR: 1 });

  const setMode = (m) => {
    setModeRaw(m);
    try { localStorage.setItem(LS_KEY, m); } catch { /* private mode */ }
  };
  const toggle = () => setMode(mode === "eur" ? "native" : "eur");

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
    const nativeCode = NATIVE_CCY[country] || "EUR";
    const displayCode = mode === "eur" ? "EUR" : nativeCode;
    const exch = rates[displayCode]; // EUR per 1 unit
    const unitsPerEur = displayCode === "EUR" ? 1 : (exch ? 1 / exch : 1);
    return {
      nativeCode,
      displayCode,
      displaySymbol: SYMBOLS[displayCode] || displayCode,
      unitsPerEur,
      // Only Czechia (today) has a native currency != EUR, so the toggle is
      // meaningful there; for SK both modes render €.
      hasNativeAlt: nativeCode !== "EUR",
    };
  }, [country, mode, rates]);

  // Keep the module-level mirror in sync SYNCHRONOUSLY (during render, not in an
  // effect) so the plain formatters read the new currency on the SAME render the
  // toggle triggers — otherwise consumers paint one render stale. Writing a
  // module global derived purely from state/props is safe + idempotent here.
  setMoney({ code: derived.displayCode, symbol: derived.displaySymbol, unitsPerEur: derived.unitsPerEur });

  const value = useMemo(() => ({ mode, setMode, toggle, ...derived }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, derived]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() { return useContext(CurrencyContext); }
