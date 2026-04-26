import { useEffect, useMemo, useState } from "react";
import { supabase, isSupabaseReady } from "./supabase";
import { useAuth } from "./useAuth";

/**
 * Data hooks — the one source of truth for reading from Supabase.
 *
 * ## Single canonical source of unit-level data: flats_archive
 *
 * Every byte/flat that ever existed lives in `flats_archive`, append-only,
 * tagged with snapshot_month. Two convenience reads sit on top:
 *
 *   · `flats_current` — Postgres VIEW filtered to MAX(snapshot_month).
 *     Used when callers want "the latest known state" without specifying
 *     a month. Refreshed live (no manual maintenance).
 *
 *   · `useFlatsArchive(months?)` — explicit time-series read used by
 *     the Pivot. Pass an array of YYYY-MM strings to limit, omit for all.
 *
 * The old `flats` table was dropped — `useFlatsCurrent` reads the view.
 * This guarantees the homepage ticker, Reports KPI, Pivot "latest" mode
 * and any other "current state" surface all show the same numbers, since
 * they all derive from the same underlying archive rows.
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
 * Real fix: the hooks that depend on RLS (useProjectFlats, useFlatsCurrent)
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

/**
 * Structured market totals — single source of truth for KPI strips
 * across Dashboard / Analytics / Reports so every screen shows the
 * same "units tracked / available / sold" numbers the ticker shows.
 *
 * Reads from the `metrics` table which is published by the monthly
 * sync (sync_to_supabase.py::compute_metrics). The metrics there are
 * derived from `len(all_flats)` — the REAL row count — not from
 * projects.total_units (which contains registry totals for a few
 * large projects like Slnecnice = 4000, Bory = large, making sums
 * over-count by ~5k).
 *
 * Returns numeric values + raw loading flag. Each value may be null
 * when the metric row doesn't exist yet (e.g. a fresh DB).
 */
export function useMarketTotals() {
  const { metrics, loading } = useMetrics();
  // Memoise the parsed totals so consumers (and their useMemo deps
  // downstream) don't see a brand-new object on every render of the
  // parent. Without this, Dashboard/Analytics/Reports rebuild their
  // KPI objects on every render even when the underlying metrics
  // haven't changed.
  return useMemo(() => {
    const byKey = {};
    if (Array.isArray(metrics)) {
      for (const m of metrics) {
        if (m && typeof m === "object" && m.metric_key) byKey[m.metric_key] = m;
      }
    }
    const num = (key) => {
      const m = byKey[key];
      if (!m) return null;
      const v = m.value_numeric;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    return {
      loading,
      unitsTracked:   num("total_units_tracked"),
      unitsAvailable: num("total_available"),
      unitsReserved:  num("total_reserved"),
      unitsSold:      num("total_sold_to_date"),
      projectsActive: num("total_projects_active"),
      avgPriceM2:     num("avg_price_m2"),
    };
  }, [metrics, loading]);
}

/** Project list. Public data; anon and authenticated see the same rows
 *  (differences come from what the UI chooses to render, not from RLS). */
let _projectsCacheKey = null;   // identity signature the cache was built for
export function useProjects(limit) {
  // Invalidate cache on user.id OR tier change. Without this, a user
  // who first hit the page as free (and Supabase RLS returned the
  // chosen-project-only scope) would keep seeing the stale 1-row
  // array even after logging out + back in as paid, or after RLS
  // was relaxed server-side. Keying by id + tier makes every auth
  // transition a fresh fetch.
  const { user, profile } = useAuth();
  const tier = profile?.tier || "anon";
  const key = `${user?.id || "anon"}::${tier}::${limit || "all"}`;
  const cacheHit = _projectsCacheKey === key;
  const [projects, setProjects] = useState(cacheHit ? (_projectsCache || []) : []);
  const [loading, setLoading] = useState(!cacheHit);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    let cancelled = false;
    let q = supabase.from("projects").select("*");
    if (limit) q = q.eq("is_top20", true).limit(limit);
    q.order("available_units", { ascending: false }).then(({ data }) => {
      if (cancelled) return;
      const arr = data || [];
      _projectsCache = arr;
      _projectsCacheKey = key;
      setProjects(arr);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [limit, key]);
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
  // RLS for flats now also reads trial_until / paid_until / pause
  // (see current_user_is_paid() — supabase_migration_2026_04_rls_trial_paid).
  // Including these in deps means switching from one project to another
  // mid-trial doesn't keep a stale "denied" result around.
  const trialUntil = profile?.trial_until || null;
  const paidUntil = profile?.paid_until || null;
  const paidPaused = profile?.paid_pause_started || null;
  const [flats, setFlats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isSupabaseReady() || !projectId || authLoading) {
      return;
    }
    setLoading(true);
    setError(null);
    let cancelled = false;

    // Defensive retry: in some browsers the first fetch right after
    // a navigation transition can race with the supabase client's
    // session-token attachment, returning 0 rows even though RLS
    // would allow them. If we get an empty result AND the user is
    // privileged enough to expect data, wait one tick and refetch
    // once. Eliminates the "click project → empty page → refresh
    // and now it works" symptom users reported.
    const fetchOnce = async () => {
      // flats_current = view of latest month from flats_archive.
      // Reading from here guarantees the per-project flat list shows
      // the same data as the Pivot's "Latest month" mode and the
      // homepage ticker — single source of truth.
      return await supabase.from("flats_current")
        .select("*")
        .eq("project_id", projectId)
        .order("poschodie", { ascending: true });
    };

    (async () => {
      let { data, error: err } = await fetchOnce();
      // Retry once if first call returned empty AND we have a likely
      // access promotion path (paid tier, admin, active trial,
      // active paid window). For genuinely empty projects the retry
      // is harmless.
      const looksPrivileged =
        tier === "paid" || tier === "admin" ||
        (trialUntil && new Date(trialUntil) > new Date()) ||
        (paidUntil && new Date(paidUntil) > new Date() && !paidPaused);
      if (!err && (!data || data.length === 0) && looksPrivileged) {
        await new Promise(r => setTimeout(r, 250));
        if (cancelled) return;
        ({ data, error: err } = await fetchOnce());
      }
      if (cancelled) return;
      setFlats(data || []);
      setError(err || null);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [projectId, authLoading, tier, chosenProjectId, trialUntil, paidUntil, paidPaused]);

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

/** All flats from the LATEST month across every project — i.e. "current
 *  state" of the unit-level dataset. Reads from the `flats_current` view
 *  which is a live filter on flats_archive (no separate table). Use this
 *  whenever a page wants "what does the market look like right now."
 *
 *  For time-series / cross-month rezy, use `useFlatsArchive` instead.
 *
 *  RLS tier behaviour (inherited from flats_archive via security_invoker):
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
let _flatsCurrentCache = null;
let _flatsCurrentCacheKey = null;
export function useFlatsCurrent() {
  const { loading: authLoading, user, profile } = useAuth();
  const identityKey = user
    ? `${user.id}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}`
    : "anon";
  const [flats, setFlats] = useState(_flatsCurrentCacheKey === identityKey ? (_flatsCurrentCache || []) : []);
  const [loading, setLoading] = useState(_flatsCurrentCacheKey !== identityKey);

  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    if (authLoading) { return; }

    if (_flatsCurrentCacheKey === identityKey && _flatsCurrentCache) {
      setFlats(_flatsCurrentCache);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      const all = [];
      const PAGE = 1000;
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .from("flats_current")
          .select("*")
          .range(offset, offset + PAGE - 1)
          .order("id", { ascending: true });
        if (cancelled) return;
        if (error) {
          console.error("[useFlatsCurrent]", error);
          break;
        }
        all.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      if (cancelled) return;
      _flatsCurrentCache = all;
      _flatsCurrentCacheKey = identityKey;
      setFlats(all);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, identityKey]);

  return { flats, loading };
}

/** Unit-level historical archive — every flat from every monthly run.
 *
 *  Why this exists separate from useFlatsCurrent:
 *    `flats` is the current snapshot — overwritten each sync. The
 *    archive (`flats_archive`) is append-only with a `snapshot_month`
 *    tag, so the platform Pivot can slice across time the same way
 *    the Sheets pivot over Clean Master can. After 2-3 months of
 *    syncs accumulate, trend / month-over-month rezy become possible.
 *
 *  Default scope:
 *    `months` defaults to undefined → all months returned (sorted desc).
 *    Pass an array of YYYY-MM strings to limit (e.g. `["2026-04"]` for
 *    just-this-month, `["2026-03","2026-04"]` for two-month compare).
 *    Most callers will pass the most recent month at first paint and
 *    let the user expand from there.
 *
 *  RLS:
 *    Same gating as flats — paid/admin/active-trial sees everything,
 *    free users see only their chosen_project_id rows. Cache key
 *    includes tier + chosen_project_id so identity changes refetch.
 *
 *  Paging:
 *    Supabase caps single queries at 1000 rows. ~5,500 flats × N
 *    months → page in 1000-row chunks just like useFlatsCurrent.
 */
let _archiveCache = null;
let _archiveCacheKey = null;
export function useFlatsArchive(months) {
  const { loading: authLoading, user, profile } = useAuth();
  const monthsKey = Array.isArray(months) ? months.slice().sort().join(",") : "all";
  const identityKey = user
    ? `${user.id}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}::${monthsKey}`
    : `anon::${monthsKey}`;
  const [flats, setFlats] = useState(_archiveCacheKey === identityKey ? (_archiveCache || []) : []);
  const [loading, setLoading] = useState(_archiveCacheKey !== identityKey);

  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    if (authLoading) return;

    if (_archiveCacheKey === identityKey && _archiveCache) {
      setFlats(_archiveCache);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      const all = [];
      const PAGE = 1000;
      for (let offset = 0; ; offset += PAGE) {
        let q = supabase
          .from("flats_archive")
          .select("*")
          .range(offset, offset + PAGE - 1)
          .order("snapshot_month", { ascending: false })
          .order("id", { ascending: true });
        if (Array.isArray(months) && months.length > 0) {
          q = q.in("snapshot_month", months);
        }
        const { data, error } = await q;
        if (cancelled) return;
        if (error) {
          console.error("[useFlatsArchive]", error);
          break;
        }
        all.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      if (cancelled) return;
      _archiveCache = all;
      _archiveCacheKey = identityKey;
      setFlats(all);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, identityKey, monthsKey]);

  return { flats, loading };
}

/** Distinct snapshot months available in the archive — small fast call
 *  used by the Pivot's month-filter dropdown. Public-ish (RLS still
 *  applies, but month names alone leak no per-flat data). */
let _archiveMonthsCache = null;
export function useArchiveMonths() {
  const [months, setMonths] = useState(_archiveMonthsCache || []);
  const [loading, setLoading] = useState(_archiveMonthsCache === null);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      // Distinct months — Supabase doesn't give us DISTINCT directly via
      // PostgREST, so we project just snapshot_month and dedup client-side.
      // The set is tiny (≤ 60 even after 5 years), so this is cheap.
      const { data, error } = await supabase
        .from("flats_archive")
        .select("snapshot_month")
        .order("snapshot_month", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error("[useArchiveMonths]", error);
        setLoading(false);
        return;
      }
      const seen = new Set();
      const arr = [];
      for (const row of data || []) {
        if (row.snapshot_month && !seen.has(row.snapshot_month)) {
          seen.add(row.snapshot_month);
          arr.push(row.snapshot_month);
        }
      }
      _archiveMonthsCache = arr;
      setMonths(arr);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);
  return { months, loading };
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
