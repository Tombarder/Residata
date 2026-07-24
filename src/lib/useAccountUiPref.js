import { useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import { supabaseData } from "./supabase";

/**
 * useAccountUiPref — sync ONE string preference to the user's account (ui_prefs[key])
 * so it follows the login across devices, reusing the robust pattern proven for the
 * pivot / market / currency sync:
 *   · hydrate from the account the moment ITS profile loads (account = source of truth);
 *   · persist changes debounced, through supabaseData (reliable auth.uid()), surfacing
 *     errors and recording the baseline only on success so a failed save retries;
 *   · effects key off the primitive value + the hydration scope (never an unstable
 *     object), and a baseline-diff means we never echo the just-hydrated value back.
 *
 * The preference keeps its OWN local store (localStorage etc.) as the instant per-browser
 * cache; this hook only bridges it to the account. Anon visitors are never written.
 *
 * @param {string} key          ui_prefs key, e.g. "theme" | "language"
 * @param {string} value        the preference's current value (from its own store)
 * @param {(v:string)=>void} apply   apply an account value on hydration (its setter)
 * @param {{defaultValue?: string}} [opts]  when the account has nothing saved, a value
 *        that differs from defaultValue is back-filled (pushed up) so an existing local
 *        choice reaches other devices; a value equal to defaultValue stays put.
 */
export function useAccountUiPref(key, value, apply, opts = {}) {
  const { defaultValue } = opts;
  const { user, profile, loading: authLoading } = useAuth();
  const scopeId = user?.id || "anon";
  const [hydratedScope, setHydratedScope] = useState(null);
  const syncedRef = useRef(undefined);

  // Hydrate from the account once its OWN profile has loaded.
  useEffect(() => {
    if (authLoading) return;
    if (hydratedScope === scopeId) return;
    if (!user) { setHydratedScope("anon"); return; }          // anon → local store only
    const own = profile && profile.id === user.id ? profile : null;
    if (!own) return;                                         // wait for THIS account's profile
    const prefs = own.ui_prefs && typeof own.ui_prefs === "object" ? own.ui_prefs : {};
    const stored = prefs[key];
    if (typeof stored === "string") {
      apply(stored);
      syncedRef.current = stored;
    } else {
      // No account value yet: back-fill a non-default local choice (baseline undefined →
      // the save effect pushes it once); a default value stays put (baseline = current).
      syncedRef.current = (defaultValue !== undefined && value !== defaultValue) ? undefined : value;
    }
    setHydratedScope(scopeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, scopeId, user, profile]);

  // Persist a change (or a first-load back-fill) to the account, debounced.
  useEffect(() => {
    if (scopeId === "anon" || hydratedScope !== scopeId) return;
    if (typeof value !== "string" || value === syncedRef.current) return;
    const v = value;
    const t = setTimeout(() => {
      supabaseData.rpc("set_ui_pref", { p_key: key, p_value: v }).then(
        ({ error }) => { if (error) console.warn(`${key} pref sync failed:`, error.message); else syncedRef.current = v; },
        (e) => console.warn(`${key} pref sync error:`, e?.message || e),
      );
    }, 500);
    return () => clearTimeout(t);
  }, [value, hydratedScope, scopeId, key]);
}
