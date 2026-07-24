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

/**
 * useAccountPrefState — persist a page's filter/settings SNAPSHOT to localStorage
 * (per-account, instant) AND the account (ui_prefs[key], cross-device), so a page
 * remembers its filters and they follow the login across devices.
 *
 * The page passes its CURRENT persistent filter values as `snapshot` (a plain object
 * with a FIXED key set) and an `apply(saved)` that pushes a saved snapshot back into its
 * state. Mirrors the pivot's applyPrefs + payloadSer, generalized. Leave TRANSIENT UI
 * state (open dropdowns, scroll position, map viewport) OUT of the snapshot.
 *
 * Robust: hydrate on this account's profile load (account = source of truth) → local
 * cache → current; debounced supabaseData writes; errors surfaced; a key-order-safe
 * baseline-diff (jsonb loses key order, so a saved object is re-serialized through the
 * snapshot's own key order before comparing) prevents echo saves; an existing local-only
 * snapshot is back-filled to the account on first load.
 *
 * @param {string} key       ui_prefs key, e.g. "salesFilters"
 * @param {object} snapshot  current persistent filter values (fixed key set)
 * @param {(saved:object)=>void} apply  set the page's filters from a saved snapshot
 */
export function useAccountPrefState(key, snapshot, apply) {
  const { user, profile, loading: authLoading } = useAuth();
  const scopeId = user?.id || "anon";
  const [hydratedScope, setHydratedScope] = useState(null);
  const lastSyncedRef = useRef(null);

  const lsKey = (sc) => `residata.pref.${key}.${sc || "anon"}`;
  const serialized = JSON.stringify(snapshot);
  // Re-serialize a saved object through the CURRENT snapshot's key set + order, so the
  // baseline equals what `serialized` becomes once `apply(saved)` lands (echo-safe).
  const canon = (saved) => {
    const out = {};
    for (const k of Object.keys(snapshot)) out[k] = (saved && k in saved) ? saved[k] : snapshot[k];
    return JSON.stringify(out);
  };

  useEffect(() => {
    if (authLoading) return;
    if (hydratedScope === scopeId) return;
    const readLS = (sc) => {
      try { const r = localStorage.getItem(lsKey(sc)); const v = r ? JSON.parse(r) : undefined; return (v && typeof v === "object") ? v : undefined; }
      catch { return undefined; }
    };
    if (!user) {                                   // anon → per-browser cache only
      const ls = readLS("anon");
      if (ls) { apply(ls); lastSyncedRef.current = canon(ls); } else lastSyncedRef.current = serialized;
      setHydratedScope("anon");
      return;
    }
    const own = profile && profile.id === user.id ? profile : null;
    if (!own) { const ls = readLS(user.id); if (ls) apply(ls); return; }   // placeholder; don't finalize
    const prefs = own.ui_prefs && typeof own.ui_prefs === "object" ? own.ui_prefs : {};
    const dbVal = prefs[key];
    const fromAccount = dbVal && typeof dbVal === "object";
    const ls = readLS(user.id);
    const saved = fromAccount ? dbVal : (ls || null);
    if (saved) apply(saved);
    if (fromAccount) lastSyncedRef.current = canon(dbVal);   // account value → no echo save
    else if (saved) lastSyncedRef.current = null;            // local-only → back-fill (save once)
    else lastSyncedRef.current = serialized;                 // fresh → no save
    setHydratedScope(scopeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, scopeId, user, profile]);

  useEffect(() => {
    if (hydratedScope !== scopeId) return;
    try { localStorage.setItem(lsKey(scopeId), serialized); } catch { /* ignore */ }
    if (scopeId === "anon") return;
    if (serialized === lastSyncedRef.current) return;
    const toSave = serialized;
    const t = setTimeout(() => {
      supabaseData.rpc("set_ui_pref", { p_key: key, p_value: JSON.parse(toSave) }).then(
        ({ error }) => { if (error) console.warn(`${key} pref sync failed:`, error.message); else lastSyncedRef.current = toSave; },
        (e) => console.warn(`${key} pref sync error:`, e?.message || e),
      );
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, hydratedScope, scopeId]);
}
