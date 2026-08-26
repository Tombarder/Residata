import { useEffect, useRef, useState } from "react";
import { useAuth } from "./useAuth";
import { seedAccount, seedAnon, isSeeded, readPref, writePref, adoptPref } from "./accountPrefs";

/**
 * The three hooks every page uses to remember its settings for the logged-in
 * account. They are thin: the state itself lives in `accountPrefs.js`, which is
 * the browser's single owner of `user_profiles.ui_prefs` / `.pivot_prefs`.
 *
 * That indirection is the whole point. These hooks used to read the account
 * straight off `useAuth().profile` — a snapshot taken once per page load and
 * never refreshed after a save — so remounting a page (navigate away, come back)
 * re-applied the page-load values over whatever the user had set since. See the
 * header of `accountPrefs.js` for the full account of that bug.
 */

/**
 * useAccountHydrated — a ref that is `false` until this account's prefs have had a
 * chance to hydrate, then `true`. Anon → `true` immediately, and so is a remount
 * onto an account whose prefs are already loaded.
 *
 * Use it to GATE side-effects that must not fire for the initial account-driven
 * hydration — e.g. "when the market changes, reset the map filters": that reset
 * should run for a USER market switch, but NOT for the account's market being
 * restored on load (which would wipe the just-hydrated filters on a fresh device).
 */
export function useAccountHydrated() {
  const { user, profile } = useAuth();
  const ready = useRef(false);
  useEffect(() => {
    if (!user) { ready.current = true; return; }        // anon → no account hydration to wait for
    if (isSeeded(user.id)) { ready.current = true; return; }  // already loaded earlier this session
    if (!profile) return;                               // wait for THIS account's profile
    const id = setTimeout(() => { ready.current = true; }, 800);   // let market + filters land
    return () => clearTimeout(id);
  }, [user, profile]);
  return ready;
}

/**
 * Seed this account's preference store the first time its own profile arrives.
 * Returns true once the store speaks for `scopeId` and the page may finalize.
 *
 * Until then we are looking at either nobody (auth still resolving) or somebody
 * else's profile — a mid-session account switch briefly leaves the previous
 * account's row in context, and trusting it would leak one user's saved view into
 * another's.
 */
function ensureSeeded(scopeId, user, profile) {
  if (isSeeded(scopeId)) return true;
  if (!user) { seedAnon(); return true; }
  const own = profile && profile.id === user.id ? profile : null;
  if (!own) return false;
  seedAccount(scopeId, own);
  return true;
}

/**
 * useAccountUiPref — sync ONE string preference to the account (ui_prefs[key]) so
 * it follows the login across devices.
 *
 * The preference keeps its OWN local store (the theme's / language's / market's
 * existing localStorage) as the instant per-browser cache; this hook bridges it to
 * the account. Anon visitors are never written.
 *
 * @param {string} key          ui_prefs key, e.g. "theme" | "language"
 * @param {string} value        the preference's current value (from its own store)
 * @param {(v:string)=>void} apply   apply an account value on hydration (its setter)
 * @param {{defaultValue?: string}} [opts]  when the account has nothing saved, a
 *        value that differs from defaultValue is pushed up so an existing local
 *        choice reaches the user's other devices; a default value stays put, so a
 *        fresh device never writes noise into the account.
 */
export function useAccountUiPref(key, value, apply, opts = {}) {
  const { defaultValue } = opts;
  const { user, profile, loading: authLoading } = useAuth();
  const scopeId = user?.id || "anon";
  const [hydratedScope, setHydratedScope] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    if (hydratedScope === scopeId) return;
    if (!ensureSeeded(scopeId, user, profile)) return;   // this account's profile not in yet

    const { value: stored, source } = readPref(scopeId, key);
    if (source && typeof stored === "string") {
      apply(stored);
      if (source === "local") writePref(scopeId, key, stored);   // this browser's choice → push it up
    } else if (defaultValue !== undefined && value !== defaultValue) {
      writePref(scopeId, key, value);                            // a real local choice, back-filled
    } else if (typeof value === "string") {
      adoptPref(scopeId, key, value);                            // just the default — hold it, don't publish it
    }
    setHydratedScope(scopeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, scopeId, user, profile]);

  // Persist a later change. writePref ignores an unchanged value, so re-applying
  // what we just hydrated never writes.
  useEffect(() => {
    if (hydratedScope !== scopeId) return;
    if (typeof value !== "string") return;
    writePref(scopeId, key, value);
  }, [value, hydratedScope, scopeId, key]);
}

/**
 * useAccountPrefState — remember a page's filter/settings SNAPSHOT for the account,
 * so the page comes back exactly as the user left it: within the session, across
 * navigations, after a reload, and on their other devices.
 *
 * The page passes its CURRENT persistent filter values as `snapshot` (a plain
 * object with a FIXED key set) and an `apply(saved)` that pushes a saved snapshot
 * back into its state. Leave TRANSIENT UI state (open dropdowns, scroll position,
 * map viewport) OUT of the snapshot.
 *
 * @param {string} key       ui_prefs key, e.g. "salesFilters"
 * @param {object} snapshot  current persistent filter values (fixed key set)
 * @param {(saved:object)=>void} apply  set the page's filters from a saved snapshot
 */
export function useAccountPrefState(key, snapshot, apply) {
  const { user, profile, loading: authLoading } = useAuth();
  const scopeId = user?.id || "anon";
  const [hydratedScope, setHydratedScope] = useState(null);
  const serialized = JSON.stringify(snapshot);

  useEffect(() => {
    if (authLoading) return;
    if (hydratedScope === scopeId) return;

    if (!ensureSeeded(scopeId, user, profile)) {
      // This account's profile hasn't arrived. Show the per-browser cache so the
      // page isn't blank-defaulted for a beat, but do NOT finalize — nothing may
      // be saved until we know whose settings these are.
      const { value } = readPref(scopeId, key);
      if (value && typeof value === "object") apply(value);
      return;
    }

    const { value, source } = readPref(scopeId, key);
    if (value && typeof value === "object") apply(value);
    setHydratedScope(scopeId);
    // A choice this browser made before the preference was ever synced: push it up
    // once so the user's other devices get it too. Nothing saved anywhere: hold the
    // page's own defaults so a remount stays put, without publishing them.
    if (source === "local") writePref(scopeId, key, value);
    else if (!source) adoptPref(scopeId, key, JSON.parse(serialized));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, scopeId, user, profile]);

  // Persist every real change. The store owns the debounce (module-level, so
  // navigating away cannot cancel it) and ignores an unchanged value, so the
  // hydration echo never causes a write.
  useEffect(() => {
    if (hydratedScope !== scopeId) return;
    writePref(scopeId, key, JSON.parse(serialized));
  }, [serialized, hydratedScope, scopeId, key]);
}
