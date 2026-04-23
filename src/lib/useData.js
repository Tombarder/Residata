import { useEffect, useState } from "react";
import { supabase, isSupabaseReady } from "./supabase";
import { useAuth } from "./useAuth";

/**
 * Data hooks — the one source of truth for reading from Supabase.
 *
 * ## Module-level caches (why they exist)
 *
 * Problem: the app's top-level layout remounts on every route change (for
 * the page-fade animation). Without cache, every hook's useState resets,
 * so on each navigation the user would see a brief "0 projects / 0 units
 * / €— / 0 sold" flash while the refetch was in flight — a "zeros on nav"
 * bug.
 *
 * Now: first load populates the cache, subsequent mounts get the cached
 * data as their initial state immediately. Background refetch still fires
 * so the data stays fresh.
 *
 * ## Auth-readiness gate (the real fix for the "No data" bug)
 *
 * Previously this file had a 5-retry exponential backoff in
 * `useProjectFlats` to work around a race: the flats query would fire at
 * component mount, but at that moment the Supabase client sometimes
 * hadn't finished applying the user's session to outgoing HTTP headers.
 * RLS evaluated the caller as anonymous → 0 rows → "No data" in the UI.
 * F5 "fixed" it because the hard reload gave auth time to resolve
 * before any component mounted.
 *
 * Root cause: data hooks were firing WITHOUT checking whether auth
 * context had finished initializing. Retry was treating a symptom.
 *
 * Real fix: the hooks that depend on RLS (useProjectFlats, useAllFlats)
 * now read `loading` from useAuth and don't fire their fetch until
 * auth is confirmed resolved. This means:
 *   - Session from localStorage has been loaded AND applied to the
 *     Supabase client
 *   - onAuthStateChange has fired its first event
 *   - useAuth's `loading` has flipped to false
 * The next fetch then has a session (or confirmed no session for anon
 * users) — no race possible.
 *
 * Hooks hitting public tables (metrics, projects, snapshots,
 * early_access_stats) don't need the gate — those return the same data
 * to anon and authenticated callers, so racing the token attachment
 * doesn't affect the result.
 */
let _projectsCache = null;
let _metricsCache = null;

/** Live metrics for the ticker (KPI strip). Public table — no auth gate. */
export function useMetrics() {
  const [metrics, setMetrics] = useState(_metricsCache || []);
  const [loading, setLoading] = useState(_metricsCache === null);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    supabase.from("metrics").select("*").order("display_order", { ascending: true })
      .then(({ data }) => {
        const arr = data || [];
        _metricsCache = arr;
        setMetrics(arr);
        setLoading(false);
      });
  }, []);
  return { metrics, loading };
}

/** Project list. Public data; anon and authenticated see the same rows
 *  (differences come from what the UI chooses to render, not from RLS). */
export function useProjects(limit) {
  const [projects, setProjects] = useState(_projectsCache || []);
  const [loading, setLoading] = useState(_projectsCache === null);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    let q = supabase.from("projects").select("*");
    if (limit) q = q.eq("is_top20", true).limit(limit);
    q.order("available_units", { ascending: false }).then(({ data }) => {
      const arr = data || [];
      _projectsCache = arr;
      setProjects(arr);
      setLoading(false);
    });
  }, [limit]);
  return { projects, loading };
}

/** Units (flats) for one project — gated by RLS on the flats table.
 *
 *  Auth-readiness gate: we wait for useAuth().loading to flip to false
 *  before firing the fetch. This guarantees the Supabase client has
 *  applied the session token (or confirmed none) to outgoing HTTP
 *  headers. Without this gate, the race manifests as "No data" on
 *  first click-through after navigation.
 *
 *  RLS-identity gate: we also refetch when anything that could change
 *  the caller's RLS permission for this table changes — specifically
 *  `tier` and `chosen_project_id`. Without this, the ChooseProjectGate
 *  flow breaks: first fetch (before user picks) returns 0 rows because
 *  RLS rejects free user with no chosen_project_id; after the user
 *  picks, profile.chosen_project_id changes but the hook wouldn't
 *  refetch because projectId and authLoading stayed the same. Result
 *  was a blank-looking page after confirming project choice.
 *
 *  Empty state interpretation (after auth + RLS identity resolved):
 *    - Caller has no permission → RLS returns 0 rows → UI renders the
 *      appropriate gate (ChooseProjectGate / login). Not this hook's
 *      problem.
 *    - Project has 0 flats in DB → 0 rows → UI renders "no data yet"
 *      message explaining sync gap vs. developer-no-listing.
 *  Either way: 0 rows here means 0 rows for real (given current RLS).
 */
export function useProjectFlats(projectId) {
  const { loading: authLoading, profile } = useAuth();
  const tier = profile?.tier || null;
  const chosenProjectId = profile?.chosen_project_id || null;
  const [flats, setFlats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Guard: no Supabase, no projectId, or auth still initializing →
    // stay in "loading" state; effect will re-run when authLoading flips.
    if (!isSupabaseReady() || !projectId || authLoading) {
      return;
    }
    setLoading(true);
    setError(null);
    let cancelled = false;

    (async () => {
      const { data, error: err } = await supabase.from("flats")
        .select("*")
        .eq("project_id", projectId)
        .order("poschodie", { ascending: true });
      if (cancelled) return;
      setFlats(data || []);
      setError(err || null);
      setLoading(false);
    })();

    return () => { cancelled = true; };
    // tier + chosenProjectId are in deps because RLS policy outcome
    // depends on them — when they change, the server-side permission
    // may change too and we need a fresh fetch.
  }, [projectId, authLoading, tier, chosenProjectId]);

  return { flats, loading, error };
}

/** Monthly project snapshots — full time-series of the projects table.
 *  Public historical data (same shape for anon + auth callers). */
let _snapshotsCache = null;
export function useProjectSnapshots() {
  const [snapshots, setSnapshots] = useState(_snapshotsCache || []);
  const [loading, setLoading] = useState(_snapshotsCache === null);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    supabase.from("project_snapshots").select("*")
      .order("snapshot_month", { ascending: false })
      .then(({ data }) => {
        const arr = data || [];
        _snapshotsCache = arr;
        setSnapshots(arr);
        setLoading(false);
      });
  }, []);
  return { snapshots, loading };
}

/** All flats across every project — for the unit-level pivot on Analytics.
 *
 *  RLS tier behaviour:
 *    - anonymous          → 0 rows
 *    - free               → flats of user's chosen_project_id only
 *    - paid/admin         → every flat in every active/sold_out project
 *
 *  Auth-readiness gate: identical reasoning to useProjectFlats. Without
 *  it, the Analytics page used to flash "no data" for paid users on
 *  first client-side nav — RLS was evaluating the caller as anonymous
 *  before the session token caught up.
 *
 *  RLS-identity invalidation: we key the module cache by an identity
 *  signature (tier + chosen_project_id). Without this, a user who
 *  logged in as free and later upgraded to paid (or vice-versa) would
 *  keep seeing the old cached set — wrong scope. When identity changes
 *  the cache is invalidated and we refetch.
 *
 *  Paging: Supabase caps single queries at 1000 rows; we page the
 *  ~5,100 flats in 1000-chunk ranges.
 */
let _flatsCache = null;
let _flatsCacheKey = null;  // identity signature the cache was built for
export function useAllFlats() {
  const { loading: authLoading, user, profile } = useAuth();
  const identityKey = user
    ? `${user.id}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}`
    : "anon";
  const [flats, setFlats] = useState(_flatsCacheKey === identityKey ? (_flatsCache || []) : []);
  const [loading, setLoading] = useState(_flatsCacheKey !== identityKey);

  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    if (authLoading) { return; }

    // Cache hit for the same identity → reuse it
    if (_flatsCacheKey === identityKey && _flatsCache) {
      setFlats(_flatsCache);
      setLoading(false);
      return;
    }

    // Identity changed (login / logout / tier upgrade / project switch)
    // → invalidate and refetch
    let cancelled = false;
    setLoading(true);
    (async () => {
      const all = [];
      const PAGE = 1000;
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("flats")
          .select("*")
          .range(offset, offset + PAGE - 1)
          .order("id", { ascending: true });
        if (cancelled) return;
        if (error) {
          console.error("[useAllFlats]", error);
          break;
        }
        all.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      if (cancelled) return;
      _flatsCache = all;
      _flatsCacheKey = identityKey;
      setFlats(all);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, identityKey]);

  return { flats, loading };
}

/** Early access slot count for the marketing badge. Public table. */
export function useEarlyAccessStats() {
  const [stats, setStats] = useState({ paid_count: 0, remaining_slots: 9 });
  useEffect(() => {
    if (!isSupabaseReady()) return;
    supabase.from("early_access_stats").select("*").maybeSingle()
      .then(({ data }) => data && setStats(data));
  }, []);
  return stats;
}
