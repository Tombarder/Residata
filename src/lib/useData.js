import { useEffect, useState } from "react";
import { supabase, isSupabaseReady } from "./supabase";
import { useAuth } from "./useAuth";
import { useCountry } from "./useCountry";

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
    let cancelled = false;
    supabase.from("metrics").select("*").order("display_order", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        // F-313 (DP-096): don't poison the module cache with [] on transient
        // errors — that would leave the ticker empty for the rest of the
        // session until hard reload. Cache ONLY on success.
        if (error) {
          console.error("[useMetrics]", error);
          setLoading(false);
          return;
        }
        const arr = data || [];
        _metricsCache = arr;
        setMetrics(arr);
        setLoading(false);
      });
    return () => { cancelled = true; };
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
/** Live market totals — single source of truth for the homepage ticker,
 *  Dashboard KPI strip, LiveAnalytics KPI, and Reports KPI when no
 *  filter is active.
 *
 *  Reads from the `market_totals` Postgres view, which computes
 *  aggregates from flats_archive (filtered to MAX snapshot_month) on
 *  every read. No staleness — the moment a sync writes new rows or
 *  a backfill / manual append lands in flats_archive, this hook
 *  returns the fresh numbers.
 *
 *  The view is SECURITY DEFINER so anonymous visitors on the marketing
 *  homepage can read aggregate counts (no per-flat data exposed; same
 *  level of detail the old metrics table already exposed publicly).
 *
 *  History: this hook used to read from a `metrics` table, which was
 *  refreshed only during the monthly sync. That made it possible for
 *  the homepage to show "5 101 bytov" while the platform Pivot showed
 *  "5 540" (because someone added rows between syncs). One source of
 *  truth eliminates the entire class of those bugs.
 */
// =============================================================================
// useTotals(level, id) — MMR Phase 8 (2026-06-02): generic granularity hook
// =============================================================================
// One hook to read aggregate totals at any granularity, backed by the
// 6 view-per-granularity surfaces Phase 4 added in the v2 DB:
//
//   level='global'              → public.totals_global              (1 row)
//   level='country'             → public.totals_by_country          (N rows, filter by `id`)
//   level='country_group'       → public.totals_by_country_group    (N rows, filter by `id`)
//   level='market'              → public.totals_by_market           (N rows, filter by `id`)
//   level='region'              → public.totals_by_region           (N rows, filter by `id`)
//   level='city'                → public.totals_by_city             (N rows, filter by `id`)
//
// The `id` arg is the filter value for the level (e.g. 'SK' for country,
// 'sk-ba' for market, 'eu' for country_group, 'bratislavsky' for region,
// etc.). Omit `id` only for level='global'.
//
// Return shape matches useMarketTotals() exactly so consumers can swap
// hook calls without rewiring their UI.
//
// Cache strategy: keyed by `${level}:${id}` so flipping country / market
// inside the same page doesn't re-flash the spinner. F-313 pattern:
// don't cache on transient errors; only cache successful reads.
//
// Future scope (deferred until cz-praha has real data):
//   - CountrySwitcher / MarketSwitcher UI component
//   - URL param ?c=SK / ?m=sk-ba binding
//   - All-EUR price display (D17) — flats_archive.price_s_dph_eur is
//     already populated, frontend wires through it then.
const _totalsCache = new Map();  // key='level:id' → totals obj

const _emptyTotals = {
  loading: true,
  unitsTracked: null, unitsAvailable: null, unitsReserved: null,
  unitsSold: null, soldLastMonth: null, avgPriceM2: null,
  projectsActive: null, projectsTracked: null, developersActive: null,
  snapshotMonth: null,
  // Granularity-specific fields the new views surface:
  level: null, id: null, name: null, currencyCode: null,
};

const _normTotalsRow = (data, level, id) => {
  const num = (v) => (typeof v === "number" && Number.isFinite(v))
    ? v
    : (v != null && !Number.isNaN(Number(v)) ? Number(v) : null);
  return {
    loading: false,
    unitsTracked:    num(data?.total_units_tracked),
    unitsAvailable:  num(data?.total_available),
    unitsReserved:   num(data?.total_reserved),
    unitsSold:       num(data?.total_sold),
    soldLastMonth:   num(data?.total_sold_last_month),
    avgPriceM2:      num(data?.avg_eur_m2),
    projectsActive:  num(data?.total_projects_active),
    projectsTracked: num(data?.total_projects_tracked) ?? num(data?.total_projects_active),
    developersActive:num(data?.total_developers_active),
    snapshotMonth:   data?.snapshot_month || null,
    level,
    id,
    // Per-view convenience fields (not on every view, present where applicable):
    name:           data?.market_name || data?.country_name_en || data?.group_name
                     || data?.region_name || data?.city_name || null,
    currencyCode:   data?.currency_code || null,
  };
};

const _viewForLevel = {
  global:         'totals_global',
  country:        'totals_by_country',
  country_group:  'totals_by_country_group',
  market:         'totals_by_market',
  region:         'totals_by_region',
  city:           'totals_by_city',
};

const _filterColForLevel = {
  global:         null,           // single row, no filter
  country:        'country_code',
  country_group:  'group_id',
  market:         'market_key',
  region:         'region_id',
  city:           'city_id',
};

/**
 * Generic aggregate-totals hook. Reads from the appropriate
 * public.totals_by_X view based on `level` + `id`.
 *
 * Examples:
 *   const sk     = useTotals('country', 'SK');         // SK national
 *   const v4     = useTotals('country_group', 'v4');   // V4 bloc
 *   const skba   = useTotals('market', 'sk-ba');       // BA market only
 *   const all    = useTotals('global');                // everything active
 *
 * Returns the same flat object shape as useMarketTotals(), so callers
 * can choose either. The `loading` flag, the snapshotMonth, and all
 * unit/project counts are preserved field-for-field.
 */
export function useTotals(level, id = null) {
  const cacheKey = `${level}:${id || ''}`;
  const cached = _totalsCache.get(cacheKey);
  const [totals, setTotals] = useState(cached || _emptyTotals);

  useEffect(() => {
    if (!isSupabaseReady()) {
      setTotals(t => ({ ...t, loading: false }));
      return;
    }
    const view = _viewForLevel[level];
    const filterCol = _filterColForLevel[level];
    if (!view) {
      console.warn(`[useTotals] unknown level=${JSON.stringify(level)}`);
      setTotals(t => ({ ...t, loading: false }));
      return;
    }
    let cancelled = false;
    let q = supabase.from(view).select("*");
    if (filterCol && id != null) {
      q = q.eq(filterCol, id);
    }
    q.maybeSingle().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error(`[useTotals] ${level}/${id}`, error);
        setTotals(t => ({ ...t, loading: false }));
        return;
      }
      const next = _normTotalsRow(data, level, id);
      _totalsCache.set(cacheKey, next);
      setTotals(next);
    });
    return () => { cancelled = true; };
  }, [level, id]);

  return totals;
}

// =============================================================================
// useMarketTotals — per-country aggregate totals. Reads public.totals_by_country
// filtered by the selected country (useCountry). Defaults to 'SK', which is
// byte-identical to the old SK-pinned market_totals view — that alias was
// literally `SELECT … FROM totals_by_country WHERE country_code='SK'`, so the
// SK numbers and column shape are unchanged. Switching country now actually
// re-aggregates instead of always returning Slovakia.
// =============================================================================
const _marketTotalsByCountry = new Map();  // country code → mapped totals object
export function useMarketTotals() {
  const { country } = useCountry();
  const [totals, setTotals] = useState(() => _marketTotalsByCountry.get(country) || {
    loading: true,
    unitsTracked: null, unitsAvailable: null, unitsReserved: null,
    unitsSold: null, avgPriceM2: null, snapshotMonth: null,
  });
  useEffect(() => {
    if (!isSupabaseReady()) {
      setTotals(t => ({ ...t, loading: false }));
      return;
    }
    const cached = _marketTotalsByCountry.get(country);
    if (cached) setTotals(cached);
    let cancelled = false;
    supabase.from("totals_by_country").select("*").eq("country_code", country).maybeSingle().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error("[useMarketTotals]", error);
        setTotals(t => ({ ...t, loading: false }));
        return;
      }
      const num = (v) => (typeof v === "number" && Number.isFinite(v))
        ? v
        : (v != null && !Number.isNaN(Number(v)) ? Number(v) : null);
      const next = {
        loading: false,
        unitsTracked:    num(data?.total_units_tracked),
        unitsAvailable:  num(data?.total_available),
        unitsReserved:   num(data?.total_reserved),
        unitsSold:       num(data?.total_sold),
        soldLastMonth:   num(data?.total_sold_last_month),
        avgPriceM2:      num(data?.avg_eur_m2),
        projectsActive:  num(data?.total_projects_active),
        // projectsTracked = projects with ≥1 snapshot in flats_archive,
        // including ones that have since sold out / paused. Grows
        // monotonically over time; legacy registry-only sold-outs without
        // archive data are NOT included. Fallback to projectsActive while
        // older view shapes are still being deployed.
        projectsTracked: num(data?.total_projects_tracked) ?? num(data?.total_projects_active),
        developersActive:num(data?.total_developers_active),
        snapshotMonth:   data?.snapshot_month || null,
      };
      _marketTotalsByCountry.set(country, next);
      setTotals(next);
    });
    return () => { cancelled = true; };
  }, [country]);
  return totals;
}

/** Per-district aggregates derived live from flats_archive — one row per
 *  district with total_units / available_units / sold_units / reserved /
 *  project_count / avg_eur_m2. Used by DistrictPulse on the homepage and
 *  any other "districts breakdown" surface that needs honest counts.
 *
 *  Same security model as useMarketTotals — reads a SECURITY DEFINER
 *  view that exposes only aggregate rows. */
let _districtTotalsCache = null;
export function useDistrictTotals() {
  const [districts, setDistricts] = useState(_districtTotalsCache || []);
  const [loading, setLoading] = useState(_districtTotalsCache === null);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    let cancelled = false;
    supabase.from("district_totals").select("*").then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error("[useDistrictTotals]", error);
        setLoading(false);
        return;
      }
      const arr = data || [];
      _districtTotalsCache = arr;
      setDistricts(arr);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);
  return { districts, loading };
}

/** Project list. Reads from `projects_live` view — projects table
 *  metadata + REAL per-project flat counts derived from flats_archive
 *  (latest month). Same shape as the old projects table; consumers
 *  see the same field names but the numbers are no longer inflated
 *  by registry overrides (Bory 984 → real 24, Slnečnice 4000 → real
 *  382, etc.).
 *
 *  Public data — anon and authenticated see the same rows (the
 *  difference is what the UI chooses to render, not RLS).
 */
let _projectsCacheKey = null;   // identity signature the cache was built for
export function useProjects(limit) {
  // Invalidate cache on user.id OR tier change. Without this, a user
  // who first hit the page as free (and the UI tier flipped) would
  // keep seeing the stale array. Keying by id + tier makes every auth
  // transition a fresh fetch.
  const { user, profile } = useAuth();
  const { country } = useCountry();
  const tier = profile?.tier || "anon";
  const key = `${user?.id || "anon"}::${tier}::${limit || "all"}::${country}`;
  const cacheHit = _projectsCacheKey === key;
  const [projects, setProjects] = useState(cacheHit ? (_projectsCache || []) : []);
  const [loading, setLoading] = useState(!cacheHit);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    let cancelled = false;
    let q = supabase.from("projects_live").select("*").eq("country", country);
    if (limit) q = q.eq("is_top20", true).limit(limit);
    q.order("available_units", { ascending: false }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.error("[useProjects]", error);
        setLoading(false);
        return;
      }
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
    const fetchCurrent = async () => {
      // flats_current = view of latest month from flats_archive.
      // Reading from here guarantees the per-project flat list shows
      // the same data as the Pivot's "Latest month" mode and the
      // homepage ticker — single source of truth.
      return await supabase.from("flats_current")
        .select("*")
        .eq("project_id", projectId)
        .order("poschodie", { ascending: true });
    };

    // Fallback for manual projects (Altum, Bory) — they're updated
    // sporadically by Boss not by cron, so when the global "latest
    // snapshot_month" rolls forward they fall out of flats_current.
    // Their data is STILL VALID, just slightly older. Fetch the most
    // recent batch that exists for THIS project specifically.
    const fetchMostRecentForProject = async () => {
      // First: find most recent batch_timestamp for this project
      const probe = await supabase.from("flats_archive")
        .select("batch_id, batch_timestamp")
        .eq("project_id", projectId)
        .order("batch_timestamp", { ascending: false, nullsFirst: false })
        .limit(1);
      if (probe.error || !probe.data || probe.data.length === 0) {
        return { data: [], error: probe.error };
      }
      const latestBatch = probe.data[0].batch_id;
      // Then fetch all flats for that specific batch
      return await supabase.from("flats_archive")
        .select("*")
        .eq("project_id", projectId)
        .eq("batch_id", latestBatch)
        .order("poschodie", { ascending: true });
    };

    (async () => {
      let { data, error: err } = await fetchCurrent();
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
        ({ data, error: err } = await fetchCurrent());
      }
      // Final fallback: archive lookup. Manual projects (status='paused'
      // promoted to 'active' by sync) often have stale snapshot_month
      // because they're updated manually. Their archive data is still
      // valid for display.
      if (!err && (!data || data.length === 0)) {
        if (cancelled) return;
        ({ data, error: err } = await fetchMostRecentForProject());
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
    let cancelled = false;
    supabase.from("project_snapshots").select("*")
      .order("snapshot_month", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("[useProjectSnapshots]", error);
          setLoading(false);
          return;
        }
        const arr = data || [];
        _snapshotsCache = arr;
        setSnapshots(arr);
        setLoading(false);
      });
    return () => { cancelled = true; };
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
      let offset = 0;
      let hadError = false;
      // Safety cap — if server is paginating us into oblivion (e.g. cap < 50
      // rows but tens of thousands of total rows), give up at 200k. We've
      // never had more than ~5.5k rows in flats_current; this is a guardrail.
      const MAX_TOTAL = 200_000;
      while (offset < MAX_TOTAL) {
        const { data, error } = await supabase
          .from("flats_current")
          .select("*")
          .range(offset, offset + PAGE - 1)
          .order("id", { ascending: true });
        if (cancelled) return;
        if (error) {
          console.error("[useFlatsCurrent]", error);
          hadError = true;
          break;
        }
        const got = data?.length || 0;
        if (got === 0) break;                       // truly out of rows
        all.push(...data);
        offset += got;                              // advance by ACTUAL rows
        // If server returned fewer than requested, that's the final page.
        // But ONLY treat it as "final" when got is reasonably close to PAGE
        // — if got is tiny (< 50) it might just be the last partial page,
        // OR the server's hard cap. Either way got < PAGE means done.
        if (got < PAGE) break;
      }
      if (cancelled) return;
      // F-313 (DP-096): don't poison the module cache with an empty/partial
      // result when the fetch errored. A transient Supabase hiccup would
      // otherwise leave paid users staring at an empty dashboard for the
      // rest of the session until they hard-reload. We still surface what
      // we got to local state (best-effort render), but don't write the
      // cache so the next mount retries fresh.
      if (!hadError) {
        _flatsCurrentCache = all;
        _flatsCurrentCacheKey = identityKey;
      }
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
  const [progress, setProgress] = useState(0);

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
    setProgress(0);
    (async () => {
      const all = [];
      let hadError = false;
      // PostgREST default max-rows is 1000 per request. We REQUEST 5000
      // hoping the server config allows it (cuts wall-clock by 5x); if
      // the server caps lower we still continue paginating until an
      // empty page or error. Termination conditions:
      //   · got === 0 → no more rows (true end of dataset)
      //   · got < REQUESTED_PAGE AND we made progress in this iteration →
      //     server is at the tail of the dataset, also done
      // Earlier versions had a `got < 50 → break` heuristic which TRUNCATED
      // the archive when the server happened to cap pages at < 50 rows.
      // We now rely strictly on actual row counts.
      const REQUESTED_PAGE = 5000;
      let offset = 0;
      let lastPageSize = REQUESTED_PAGE;
      // Safety cap to prevent runaway loops if a misconfigured server
      // returns a tiny page size for a huge table.
      const MAX_TOTAL = 500_000;
      while (offset < MAX_TOTAL) {
        let q = supabase
          .from("flats_archive")
          .select("*")
          .range(offset, offset + REQUESTED_PAGE - 1)
          .order("batch_timestamp", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true });
        if (Array.isArray(months) && months.length > 0) {
          q = q.in("snapshot_month", months);
        }
        const { data, error } = await q;
        if (cancelled) return;
        if (error) {
          console.error("[useFlatsArchive]", error);
          hadError = true;
          break;
        }
        const got = data?.length || 0;
        if (got === 0) break;                       // truly out of rows
        all.push(...data);
        setProgress(all.length);
        offset += got;                              // advance by ACTUAL rows
        // If we got fewer rows than the previous page's size, we've likely
        // hit the dataset end. We track lastPageSize so we don't break
        // prematurely on a server-imposed page cap (which would otherwise
        // happen on EVERY page).
        if (lastPageSize !== REQUESTED_PAGE && got < lastPageSize) break;
        if (got < REQUESTED_PAGE && lastPageSize === REQUESTED_PAGE) {
          // First time getting less than REQUESTED — could be server cap
          // OR end of data. Adjust expected page size to what we got and
          // keep paginating. The next iteration's same/larger page size
          // means more data; smaller means done.
          lastPageSize = got;
        }
      }
      if (offset >= MAX_TOTAL) {
        console.warn("[useFlatsArchive] reached safety cap of", MAX_TOTAL, "rows");
      }
      if (cancelled) return;
      // F-313 (DP-096): don't poison the module cache with a partial/empty
      // result when the fetch errored. A transient Supabase hiccup during
      // the analytics Pivot's heavy archive read would otherwise leave the
      // user with truncated time-series for the rest of the session until
      // hard reload. Best-effort render what we got, but don't cache.
      if (!hadError) {
        _archiveCache = all;
        _archiveCacheKey = identityKey;
      }
      setFlats(all);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, identityKey, monthsKey]);

  return { flats, loading, progress };
}

/** Distinct snapshot months available in the archive — small fast call
 *  used by the Pivot's month-filter dropdown. Public-ish (RLS still
 *  applies, but month names alone leak no per-flat data).
 *
 *  Reads from `public.archive_months` — a view that returns one row per
 *  distinct YYYY-MM. The earlier implementation queried `flats_archive`
 *  with `select('snapshot_month').order(desc)` and deduped client-side,
 *  which silently truncated to the latest month once flats_archive
 *  exceeded the PostgREST page cap (97 k rows today, all sorted DESC by
 *  snapshot_month → first 1 000 rows were all from 2026-05, dedup → just
 *  `['2026-05']`). Surfaced as F-207 during the DP-069 audit. The view
 *  applies the same WHERE filter as flats_archive (approved + not
 *  withdrawn) so the two stay consistent.  */
let _archiveMonthsCache = null;
export function useArchiveMonths() {
  const [months, setMonths] = useState(_archiveMonthsCache || []);
  const [loading, setLoading] = useState(_archiveMonthsCache === null);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("archive_months")
        .select("snapshot_month")
        .order("snapshot_month", { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error("[useArchiveMonths]", error);
        setLoading(false);
        return;
      }
      // Defensive dedup in case a future schema change adds duplicates; the
      // view already does DISTINCT but the client guard is free insurance.
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
    let cancelled = false;
    supabase.from("early_access_stats").select("*").maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setStats(data);
      });
    return () => { cancelled = true; };
  }, []);
  return stats;
}
