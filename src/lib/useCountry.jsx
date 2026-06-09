import { createContext, useContext, useEffect, useState } from "react";
import { supabasePublic, isSupabaseReady } from "./supabase";

/**
 * useCountry — global selected-country state for the multi-market display layer.
 *
 * WHY a context (vs. prop-drilling like `lang`): the data hooks
 * (useProjects / useMarketTotals) need the selected country WITHOUT every
 * page threading a prop into them. A context lets the hooks read it directly.
 *
 * Default is 'SK'. With only Slovakia active, the switcher is dormant
 * (renders nothing — see CountrySwitcher) and every hook filters to 'SK',
 * which is byte-identical to the pre-multi-market behaviour. The moment a
 * second country has active projects, `countries` grows and the switcher
 * appears automatically — no further frontend work needed.
 *
 * Available countries are DERIVED from data: distinct `country` values in
 * public.projects_live (anon-readable, active projects only). So the list is
 * exactly "countries worth showing", never a hardcoded guess.
 */

// Display names per ISO country code, lang-aware. Stable set — extend as
// markets open. (Matches reference.countries; kept here so the switcher has
// names without an extra round-trip / a reference.* read anon can't do.)
const COUNTRY_NAMES = {
  SK: { sk: "Slovensko", en: "Slovakia" },
  CZ: { sk: "Česko", en: "Czechia" },
  PL: { sk: "Poľsko", en: "Poland" },
  HU: { sk: "Maďarsko", en: "Hungary" },
  AT: { sk: "Rakúsko", en: "Austria" },
  DE: { sk: "Nemecko", en: "Germany" },
};

export function countryName(code, lang = "en") {
  return COUNTRY_NAMES[code]?.[lang] || code;
}

const DEFAULT_COUNTRY = "SK";
const LS_KEY = "residata_country";

const CountryContext = createContext({
  country: DEFAULT_COUNTRY,
  setCountry: () => {},
  countries: [DEFAULT_COUNTRY],
  loading: true,
});

export function CountryProvider({ children }) {
  const [country, setCountryRaw] = useState(() => {
    try { return localStorage.getItem(LS_KEY) || DEFAULT_COUNTRY; }
    catch { return DEFAULT_COUNTRY; }
  });
  const [countries, setCountries] = useState([DEFAULT_COUNTRY]);
  const [loading, setLoading] = useState(true);

  const setCountry = (c) => {
    setCountryRaw(c);
    try { localStorage.setItem(LS_KEY, c); } catch { /* private mode — ignore */ }
  };

  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    let cancelled = false;
    supabasePublic.from("projects_live").select("country").then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        // Non-fatal: keep the SK default so the site never blanks on this.
        console.error("[useCountry] active-countries fetch failed", error);
        setLoading(false);
        return;
      }
      const set = new Set((data || []).map((r) => r.country).filter(Boolean));
      set.add(DEFAULT_COUNTRY); // SK always selectable even if the fetch is empty
      const list = [...set].sort();
      setCountries(list);
      // A stale localStorage country with no data must not blank the UI.
      setCountryRaw((prev) => (list.includes(prev) ? prev : DEFAULT_COUNTRY));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <CountryContext.Provider value={{ country, setCountry, countries, loading }}>
      {children}
    </CountryContext.Provider>
  );
}

export function useCountry() {
  return useContext(CountryContext);
}
