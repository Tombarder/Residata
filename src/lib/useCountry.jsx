import { createContext, useContext, useEffect, useState } from "react";
import { supabasePublic, isSupabaseReady } from "./supabase";
import { startingCountry, SESSION_KEY, ALL_COUNTRIES } from "./marketStart.js";

/**
 * useCountry — global selected-country state for the multi-market display layer.
 *
 * WHY a context (vs. prop-drilling like `lang`): the data hooks
 * (useProjects / useMarketTotals) need the selected country WITHOUT every
 * page threading a prop into them. A context lets the hooks read it directly.
 *
 * Default is 'all' — every visit opens on the whole market (see SESSION_KEY).
 * With a single active country the switcher is dormant (renders nothing — see
 * CountrySwitcher) and every hook filters to that country; with two or more,
 * `countries` grows and the switcher appears automatically.
 *
 * Available countries are DERIVED from data: distinct `country` values in
 * public.projects_live (anon-readable, active projects only). So the list is
 * exactly "countries worth showing", never a hardcoded guess.
 */

// Display names per ISO country code, lang-aware. Stable set — extend as
// markets open. (Matches reference.countries; kept here so the switcher has
// names without an extra round-trip / a reference.* read anon can't do.)
const COUNTRY_NAMES = {
  all: { sk: "Všetky", en: "All" },
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

/** Sentinel for the cross-market view. `country === ALL_COUNTRIES` means "no
 *  country filter" — every hook treats it as: drop `.eq('country', …)` on table
 *  reads, and pass `p_country = null` to RPCs. All stored money is EUR, so the
 *  combined view is inherently EUR. */
export { ALL_COUNTRIES };
export function isAllCountries(c) { return c === ALL_COUNTRIES; }

const DEFAULT_COUNTRY = ALL_COUNTRIES;   // platform + site open on the whole market

const CountryContext = createContext({
  country: DEFAULT_COUNTRY,
  setCountry: () => {},
  countries: [DEFAULT_COUNTRY],
  loading: true,
});

export function CountryProvider({ children }) {
  const [country, setCountryRaw] = useState(() => startingCountry(
    typeof sessionStorage !== "undefined" ? sessionStorage : null,
    typeof localStorage !== "undefined" ? localStorage : null));
  // Switcher options: ['all', ...real countries] once ≥2 markets exist; a single
  // market shows just itself (no point in an "All" of one).
  const [countries, setCountries] = useState([DEFAULT_COUNTRY]);
  const [loading, setLoading] = useState(true);

  const setCountry = (c) => {
    setCountryRaw(c);
    try { sessionStorage.setItem(SESSION_KEY, c); } catch { /* private mode — ignore */ }
  };

  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    let cancelled = false;
    // Retry once on a transient first-load read error (mirrors useData's
    // _readPublicWithRetry, kept inline to avoid a circular import). Without it a
    // single racy first request logged "[useCountry] active-countries fetch failed"
    // on every cold load even though the read succeeds moments later.
    const run = () => supabasePublic.from("projects_live").select("country");
    (async () => {
      let res = await run();
      if (res.error) { await new Promise((r) => setTimeout(r, 300)); res = await run(); }
      return res;
    })().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error("[useCountry] active-countries fetch failed", error);
        setLoading(false);
        return;
      }
      const reals = [...new Set((data || []).map((r) => r.country).filter(Boolean))].sort();
      const list = reals.length >= 2 ? [ALL_COUNTRIES, ...reals]
                 : reals.length === 1 ? reals
                 : [ALL_COUNTRIES];
      setCountries(list);
      // A stale selection with no data must not blank the UI.
      setCountryRaw((prev) => (list.includes(prev) ? prev : (list.includes(ALL_COUNTRIES) ? ALL_COUNTRIES : list[0])));
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
