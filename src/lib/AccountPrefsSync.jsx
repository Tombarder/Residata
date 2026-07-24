import { useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import { useCountry, ALL_COUNTRIES } from "./useCountry";
import { useCurrency } from "./useCurrency";
import { useThemeMode, setTheme } from "./theme-mode";
import { useAccountUiPref } from "./useAccountUiPref";
import { supabaseData } from "./supabase";

/**
 * AccountPrefsSync — makes the GLOBAL UI selectors (market + currency) follow the
 * ACCOUNT across devices, exactly like the analytics pivot does. localStorage stays
 * the instant per-browser cache; the account (user_profiles.ui_prefs, written via the
 * set_ui_pref(key, value) merge RPC) is the cross-device source of truth.
 *
 * Renders nothing — mounted once inside the Country + Currency providers (so it can
 * read both selectors) and below AuthProvider (so it can read the profile).
 *
 * Robustness mirrors the pivot fix (which was silently never saving for 3 weeks):
 *   · save effects key off the primitive selector VALUE + the hydration scope — never an
 *     unstable object — so a re-render can't churn the debounce;
 *   · a per-key "last synced" baseline replaces any fragile flag, so we save ONLY a real
 *     change and never echo the just-hydrated value back;
 *   · writes go through supabaseData (reliable token attachment → auth.uid() resolves),
 *     surface errors, and record the baseline only on SUCCESS so a failed save retries.
 */
export default function AccountPrefsSync() {
  const { user, profile, loading: authLoading } = useAuth();
  const { country, setCountry } = useCountry();
  const { chosen, setCurrency } = useCurrency();

  const scopeId = user?.id || "anon";

  // Theme (light/dark) is a global preference too — sync it via the shared hook. Default
  // is "dark", so only an explicit "light" gets back-filled from a device that had it.
  const [themeMode] = useThemeMode();
  useAccountUiPref("theme", themeMode, setTheme, { defaultValue: "dark" });

  // STATE (not a ref) so the save effects re-run the MOMENT hydration finalizes — that's
  // what lets a back-fill fire even when the selector value itself didn't change on load.
  const [hydratedScope, setHydratedScope] = useState(null);
  const syncedMarketRef = useRef(undefined);   // market value currently persisted to the account
  const syncedCurrencyRef = useRef(undefined); // currency (ISO) currently persisted

  // Hydrate the account's selectors once its OWN profile has loaded. Account values
  // override the per-browser localStorage; an absent key leaves the local choice in place.
  useEffect(() => {
    if (authLoading) return;
    if (hydratedScope === scopeId) return;
    if (!user) { setHydratedScope("anon"); return; }   // anon → localStorage only
    const own = profile && profile.id === user.id ? profile : null;
    if (!own) return;                                  // wait for THIS account's profile
    const prefs = own.ui_prefs && typeof own.ui_prefs === "object" ? own.ui_prefs : {};

    if (typeof prefs.market === "string") {
      setCountry(prefs.market);
      syncedMarketRef.current = prefs.market;
    } else {
      // No account market yet. A non-default LOCAL choice back-fills (baseline left
      // undefined → the effect saves it once); a plain default ("all") stays put
      // (baseline = current value → no save, so a fresh device never pollutes the account).
      syncedMarketRef.current = country === ALL_COUNTRIES ? country : undefined;
    }

    if (typeof prefs.currency === "string") {
      setCurrency(prefs.currency);
      syncedCurrencyRef.current = prefs.currency;
    } else {
      // No account currency: back-fill an explicit local choice; leave null (follow the
      // market) untouched. setCurrency(null) would also write the string "null" locally.
      syncedCurrencyRef.current = typeof chosen === "string" ? undefined : chosen;
    }

    setHydratedScope(scopeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, scopeId, user, profile]);

  // Persist a market change (or a first-load back-fill) to the account, debounced.
  useEffect(() => {
    if (scopeId === "anon" || hydratedScope !== scopeId) return;
    if (country === syncedMarketRef.current) return;   // unchanged / hydration echo
    const value = country;
    const t = setTimeout(() => {
      supabaseData.rpc("set_ui_pref", { p_key: "market", p_value: value }).then(
        ({ error }) => { if (error) console.warn("market pref sync failed:", error.message); else syncedMarketRef.current = value; },
        (e) => console.warn("market pref sync error:", e?.message || e),
      );
    }, 500);
    return () => clearTimeout(t);
  }, [country, hydratedScope, scopeId]);

  // Persist a currency change (or back-fill) to the account. Only real ISO choices stored.
  useEffect(() => {
    if (scopeId === "anon" || hydratedScope !== scopeId) return;
    if (typeof chosen !== "string") return;            // null = follow market → nothing to store
    if (chosen === syncedCurrencyRef.current) return;  // unchanged / hydration echo
    const value = chosen;
    const t = setTimeout(() => {
      supabaseData.rpc("set_ui_pref", { p_key: "currency", p_value: value }).then(
        ({ error }) => { if (error) console.warn("currency pref sync failed:", error.message); else syncedCurrencyRef.current = value; },
        (e) => console.warn("currency pref sync error:", e?.message || e),
      );
    }, 500);
    return () => clearTimeout(t);
  }, [chosen, hydratedScope, scopeId]);

  return null;
}
