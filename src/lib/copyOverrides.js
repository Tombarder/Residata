/**
 * copyOverrides — the DB overlay over the in-code translation dictionaries.
 *
 * THE MODEL (read this before touching it):
 *   · The in-code dicts (`t` in App.jsx, `liveT` in liveLang.js) are the
 *     permanent DEFAULTS / fallback. They ship with the bundle and always work.
 *   · public.site_content holds the Boss's per-(key,lang) OVERRIDES, edited live
 *     from the admin "Texts" tool. When an override exists it WINS; otherwise the
 *     code default renders. So the site can never go blank, even if the table is
 *     empty or the network is down — exactly the defensive posture used elsewhere
 *     (see supabase.js: public reads must survive any failure).
 *
 * HOW IT STAYS FAST + FLICKER-FREE:
 *   · We hydrate OVERRIDES synchronously from a localStorage cache at import, so a
 *     returning visitor renders the correct copy on the very first paint.
 *   · We refresh from the DB in the background (via the session-less anon client),
 *     update the cache, and notify subscribers so the app re-renders once.
 *   · First-ever visit with an empty cache briefly shows code defaults until the
 *     refresh lands — only the handful of strings the Boss actually overrode can
 *     change, and the swap is a single re-render.
 *
 * REACTIVITY: App.jsx calls useCopyVersion() once at the root; any background
 * refresh or post-save refresh bumps it, re-rendering the tree. All copy is read
 * fresh each render through applyOverrides(), so the new values appear.
 */
import { useEffect, useState } from "react";
import { supabasePublic, isSupabaseReady } from "./supabase";

const CACHE_KEY = "residata_copy_overrides_v1";

// OVERRIDES[lang][key] = value (jsonb-decoded: string | string[] | object).
let OVERRIDES = readCache();
const subscribers = new Set();

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(obj) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {
    /* private mode / quota — ignore, we still have it in memory */
  }
}

/**
 * Merge the overrides for `lang` on top of a base dictionary. An override
 * replaces the WHOLE value for its key (same shape as the default: string,
 * array, or object). Keys without an override fall through to the base.
 *
 * `ns` namespaces the two dictionaries that share this one table — "mk" for the
 * marketing dict (`t` in App.jsx), "lv" for the live/app dict (`liveT`). Stored
 * keys are `${ns}:${key}` so the same bare key in both dicts never collides. We
 * iterate the BASE dict (not the override map), so only overrides that match a
 * real default key are ever applied.
 *
 * Returns the base object unchanged (same reference) when there is nothing to
 * apply, so callers pay zero cost in the common case.
 */
export function applyOverrides(lang, baseDict, ns) {
  if (!baseDict) return baseDict;
  const o = OVERRIDES[lang];
  if (!o) return baseDict;
  const prefix = ns ? ns + ":" : "";
  let out = null;
  for (const k in baseDict) {
    const v = o[prefix + k];
    if (v === undefined || v === null) continue;
    if (out === null) out = { ...baseDict };
    out[k] = v;
  }
  return out || baseDict;
}

export function subscribeCopy(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function emit() {
  for (const cb of subscribers) {
    try { cb(); } catch { /* a bad subscriber must not break the rest */ }
  }
}

/**
 * Fetch all overrides from the DB (anon, session-less — immune to auth state),
 * rebuild the in-memory map + cache, and notify subscribers. Safe to call
 * repeatedly; the admin editor calls it right after a save so the change is live.
 */
export async function refreshOverrides() {
  if (!isSupabaseReady() || !supabasePublic) return;
  const { data, error } = await supabasePublic
    .from("site_content")
    .select("key,lang,value");
  if (error) {
    console.warn("[copyOverrides] fetch failed — keeping defaults/cache", error);
    return;
  }
  const next = {};
  for (const row of data || []) {
    if (!row || !row.key || !row.lang) continue;
    (next[row.lang] ||= {})[row.key] = row.value;
  }
  OVERRIDES = next;
  writeCache(next);
  emit();
}

/**
 * Subscribe a component to override changes. Returns nothing — its only job is
 * to force a re-render when the background refresh (or a post-save refresh)
 * lands. Mount once near the app root.
 */
export function useCopyVersion() {
  const [, setV] = useState(0);
  useEffect(() => subscribeCopy(() => setV((x) => x + 1)), []);
}

// Kick off a background refresh once at startup (non-blocking, after first paint).
if (typeof window !== "undefined") {
  setTimeout(() => { refreshOverrides(); }, 0);
}
