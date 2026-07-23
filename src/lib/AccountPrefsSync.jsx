import { useEffect, useRef } from "react";
import { useAuth } from "./useAuth";
import { useCountry } from "./useCountry";
import { useCurrency } from "./useCurrency";
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
 *   · effects key off the primitive selector VALUE + a stable scope string — never an
 *     unstable object — so a re-render can't churn the debounce;
 *   · a per-key "last synced" baseline replaces any fragile ref flag, so we save ONLY a
 *     real change and never echo the just-hydrated value back;
 *   · writes go through supabaseData (reliable token attachment → auth.uid() resolves),
 *     surface errors, and record the baseline only on SUCCESS so a failed save retries.
 */
export default function AccountPrefsSync() {
  const { user, profile, loading: authLoading } = useAuth();
  const { country, setCountry } = useCountry();
  const { chosen, setCurrency } = useCurrency();

  const scopeId = user?.id || "anon";
  const hydratedRef = useRef(null);            // scope whose account prefs are applied
  const syncedMarketRef = useRef(undefined);   // market value currently persisted to the account
  const syncedCurrencyRef = useRef(undefined); // currency (ISO) currently persisted

  // Hydrate the account's selectors once its OWN profile has loaded. Account values
  // override the per-browser localStorage; absent keys leave the local choice in place
  // (and baseline = current value, so we don't save until the user actually changes it).
  useEffect(() => {
    if (authLoading) return;
    if (hydratedRef.current === scopeId) return;
    if (!user) { hydratedRef.current = "anon"; return; }   // anon → localStorage only
    const own = profile && profile.id === user.id ? profile : null;
    if (!own) return;                                       // wait for THIS account's profile
    const prefs = own.ui_prefs && typeof own.ui_prefs === "object" ? own.ui_prefs : {};

    if (typeof prefs.market === "string") setCountry(prefs.market);
    syncedMarketRef.current = typeof prefs.market === "string" ? prefs.market : country;

    // Only explicit currency choices are synced (null = "follow the market", nothing to
    // restore). Guards against writing the string "null" into localStorage via setCurrency.
    if (typeof prefs.currency === "string") setCurrency(prefs.currency);
    syncedCurrencyRef.current = typeof prefs.currency === "string" ? prefs.currency : chosen;

    hydratedRef.current = scopeId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, scopeId, user, profile]);

  // Persist a market change to the account (debounced), once hydrated.
  useEffect(() => {
    if (scopeId === "anon" || hydratedRef.current !== scopeId) return;
    if (country === syncedMarketRef.current) return;   // unchanged / hydration echo
    const value = country;
    const t = setTimeout(() => {
      supabaseData.rpc("set_ui_pref", { p_key: "market", p_value: value }).then(
        ({ error }) => { if (error) console.warn("market pref sync failed:", error.message); else syncedMarketRef.current = value; },
        (e) => console.warn("market pref sync error:", e?.message || e),
      );
    }, 500);
    return () => clearTimeout(t);
  }, [country, scopeId]);

  // Persist a currency change to the account. Only real ISO choices are stored.
  useEffect(() => {
    if (scopeId === "anon" || hydratedRef.current !== scopeId) return;
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
  }, [chosen, scopeId]);

  return null;
}
