import { useEffect, useState, useRef, useCallback } from "react";
import { supabaseData, supabasePublic, isSupabaseReady } from "./supabase";
import { useAuth } from "./useAuth";
import { useCountry, isAllCountries } from "./useCountry";

/**
 * sbRead — the single settle-guarantee wrapper every RLS-gated read goes through.
 *
 * All authed reads now run on `supabaseData` (see supabase.js), which already
 * (a) never blocks on getSession() and (b) aborts a dead socket after 35s — so
 * the underlying promise always settles. sbRead is the belt-and-suspenders app
 * layer on top: it converts ANY thrown rejection into `{data:null, error}` and
 * hard-caps the total wait, so a hook's `loading` flag can NEVER be stranded on
 * "Loading…" regardless of what the library or network does. This is the piece
 * that stops the bug from ever reappearing in a NEW hook: as long as a read is
 * wrapped in sbRead, it is structurally incapable of hanging the UI.
 */
const READ_HARD_CAP_MS = 40000;
function sbRead(builder) {
  const settled = Promise.resolve(builder).then(
    (r) => r,
    (error) => ({ data: null, error: error || new Error("read failed") })
  );
  const cap = new Promise((resolve) =>
    setTimeout(
      () => resolve({ data: null, error: { message: "read timed out (client cap)", code: "CLIENT_TIMEOUT" } }),
      READ_HARD_CAP_MS
    )
  );
  return Promise.race([settled, cap]);
}

// Cross-market "All" view helpers: drop the country filter on table reads and
// pass NULL to RPCs (every RPC treats p_country NULL as "all markets"). All
// stored money is EUR, so the combined view is inherently EUR.
const _eqCountry = (q, c) => (isAllCountries(c) ? q : q.eq("country", c));
const _pCountry = (c) => (isAllCountries(c) ? null : c);

/**
 * D17 — EUR everywhere. flats_current / flats_archive expose price_s_dph_eur
 * (native price × reference.currencies.exchange_rate_to_eur; for SK the rate
 * is 1.0 so it equals cena_s_dph exactly). We overlay the EUR value onto
 * cena_s_dph / cena_bez_dph here, so every existing "€"-formatted price across
 * the app renders EUR without editing each per-site formatter. The native
 * amount is preserved as cena_s_dph_native; native currency code is
 * currency_native. For SK this is a no-op (EUR == native).
 */
function _toEurDisplay(rows) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((f) => {
    if (!f || f.price_s_dph_eur == null) return f; // no EUR value → leave native untouched
    // Effective EUR-per-native rate (1.0 for SK, ~0.0413 for CZK). price_s_dph_eur
    // / price_bez_dph_eur are precomputed; cennikova_cena (list price) has no EUR
    // column, so convert it with this rate too — otherwise it stays CZK next to a
    // EUR sale price in CZ/All exports (looked ~24× off). Native preserved.
    const rate = f.cena_s_dph ? (f.price_s_dph_eur / f.cena_s_dph) : 1;
    return {
      ...f,
      cena_s_dph_native: f.cena_s_dph,
      cena_bez_dph_native: f.cena_bez_dph,
      cennikova_cena_native: f.cennikova_cena,
      cena_s_dph: f.price_s_dph_eur,
      cena_bez_dph: f.price_bez_dph_eur != null ? f.price_bez_dph_eur : f.cena_bez_dph,
      cennikova_cena: f.cennikova_cena != null && Number.isFinite(rate) ? f.cennikova_cena * rate : f.cennikova_cena,
    };
  });
}

/* Targeted flats fetch for the Analytika drill-down — ONLY the given projects'
   units, not the whole dataset, so opening the records modal is instant instead
   of pulling every flat. Capped to a few pages (the modal shows a 1000-row
   sample). Same EUR overlay as the main reads. */
export async function fetchFlatsForProjects(country, projectIds, opts = {}) {
  if (!isSupabaseReady() || !Array.isArray(projectIds) || projectIds.length === 0) return [];
  const { isCurrent = true, months } = opts;
  const table = isCurrent ? "flats_current" : "flats_archive";
  const ids = projectIds.slice(0, 400);   // URL-length / sanity cap
  const all = [];
  for (let page = 0; page < 3; page++) {   // up to ~3000 rows; modal caps at 1000
    let q = _eqCountry(supabaseData.from(table).select("*"), country).in("project_id", ids);
    if (!isCurrent && Array.isArray(months) && months.length) q = q.in("snapshot_month", months);
    const { data, error } = await sbRead(q.range(page * 1000, page * 1000 + 999).order("id", { ascending: true }));
    if (error || !data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return _toEurDisplay(all);
}

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
const _metricsCacheByCountry = new Map();  // country code -> metrics array

// ── Velocity data-maturity gate (2026-06-15) ───────────────────────────────
// "sold last month" is only an honest 30-day figure once a market has >=30 days
// of real history (public.velocity_maturity). Until then the ticker + dashboard
// KPI show "building history" instead of a partial-window count, and auto-reveal
// the real number once the market matures (no code change; every future market
// gets the same treatment). Fail-OPEN: if maturity can't load we show the number
// (never hide good data on a transient blip).
let _velocityMaturity = null;          // { SK: {is_mature, ...}, CZ: {...} }
let _velocityMaturityPromise = null;
function _loadVelocityMaturity() {
  if (_velocityMaturity) return Promise.resolve(_velocityMaturity);
  if (_velocityMaturityPromise) return _velocityMaturityPromise;
  _velocityMaturityPromise = supabasePublic.from("velocity_maturity").select("*")
    .then(({ data }) => {
      const m = {};
      (data || []).forEach((r) => { m[r.country_code] = r; });
      _velocityMaturity = m;
      return m;
    })
    .catch(() => ({}));
  return _velocityMaturityPromise;
}
function _velocityMatureForView(country, mat) {
  if (!mat || !Object.keys(mat).length) return true;   // unknown -> fail open
  if (isAllCountries(country)) {
    const rows = Object.values(mat);
    return rows.length > 0 && rows.every((r) => r.is_mature);
  }
  const r = mat[country];
  return r ? !!r.is_mature : true;                       // unknown country -> fail open
}
function _gateVelocityMetricRows(arr, country, mat) {
  if (_velocityMatureForView(country, mat)) return arr;
  return arr.map((m) => m.metric_key === "total_sold_last_month"
    ? { ...m, value_numeric: null,
        value_text: "Predané za mesiac: zbierame históriu",
        value_text_native: "Predané za mesiac: zbierame históriu",
        value_json: { ...(m.value_json || {}), text_en: "Sold last month: building history" } }
    : m);
}

/** Whether the selected country's "sold last month" velocity is mature enough
 *  (>=30d real history) to display a real number. Fail-open. Dashboard KPI uses it. */
export function useVelocityMature() {
  const { country } = useCountry();
  const [mature, setMature] = useState(true);
  useEffect(() => {
    let cancelled = false;
    _loadVelocityMaturity().then((mat) => {
      if (!cancelled) setMature(_velocityMatureForView(country, mat));
    });
    return () => { cancelled = true; };
  }, [country]);
  return mature;
}

/** Live metrics for the ticker (KPI strip). Public view — no auth gate.
 *  Country-scoped: public.metrics now emits each metric per active country
 *  (LATERAL over countries, EUR-converted), so the ticker shows the SELECTED
 *  country's numbers. Was hardcoded SK — a CZ visitor saw Slovak figures
 *  (19 261 bytov / Petržalka / "naprieč BA"). Keyed by country so flipping
 *  SK<->CZ doesn't re-flash the strip. */
export function useMetrics() {
  const { country } = useCountry();
  const [metrics, setMetrics] = useState(_metricsCacheByCountry.get(country) || []);
  const [loading, setLoading] = useState(!_metricsCacheByCountry.has(country));
  // Request-id guard + .finally (2026-06-22) — same hardening as useProjectFlats.
  // Replaces a `cancelled` boolean that put the guard before setLoading(false) and
  // had no .catch, so a rejected request (or rapid country re-switch) could strand
  // the ticker on its loading state.
  const reqRef = useRef(0);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    const cached = _metricsCacheByCountry.get(country);
    if (cached) { setMetrics(cached); setLoading(false); }
    const myReq = ++reqRef.current;
    const isStale = () => myReq !== reqRef.current;
    // "All" has no combined row in `metrics` (it's emitted per country). Build the
    // key total_* ticker entries from totals_global (cross-market, EUR). Per-market
    // peak/district entries are omitted in All (they name one project/district).
    if (isAllCountries(country)) {
      // Fresh query each attempt (builder is single-shot) so _readPublicWithRetry
      // can re-fire when the heavy rollup view exceeds the anon statement timeout
      // on a COLD cache (57014) — the retry hits the now-warm view (~100ms).
      const runGlobal = () => supabasePublic.from("totals_global").select("*").maybeSingle();
      Promise.all([
        _readPublicWithRetry(runGlobal),
        _loadVelocityMaturity(),
      ]).then(([{ data, error }, mat]) => {
        if (isStale()) return;
        if (error || !data) return;
        const f = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US").replace(/,/g, " "));
        // Each metric carries the SK copy (value_text) AND an EN copy
        // (value_json.text_en) so Ticker.jsx can render the active language —
        // the "All" cross-market ticker was previously Slovak-only in EN mode.
        const arr = [
          { metric_key: "total_units_tracked",   display_order: 9,  category: "total",   value_text: `${f(data.total_units_tracked)} bytov sledovaných`,    value_json: { text_en: `${f(data.total_units_tracked)} units tracked` } },
          { metric_key: "total_available",       display_order: 10, category: "total",   value_text: `${f(data.total_available)} bytov v aktívnej ponuke`,    value_json: { text_en: `${f(data.total_available)} units available` } },
          { metric_key: "total_reserved",        display_order: 11, category: "total",   value_text: `${f(data.total_reserved)} rezervovaných`,    value_json: { text_en: `${f(data.total_reserved)} reserved` } },
          { metric_key: "total_sold_last_month", display_order: 12, category: "total",   value_text: `${f(data.total_sold_last_month)} predaných za mesiac`,    value_json: { text_en: `${f(data.total_sold_last_month)} sold last month` } },
          { metric_key: "total_projects_active", display_order: 13, category: "total",   value_text: `${f(data.total_projects_active)} aktívnych projektov`,    value_json: { text_en: `${f(data.total_projects_active)} active projects` } },
          { metric_key: "avg_eur_m2",            display_order: 53, category: "pricing", value_text: `Priemerná cena: ${f(data.avg_eur_m2)} €/m²`,    value_json: { text_en: `Avg €/m²: €${f(data.avg_eur_m2)}` } },
        ];
        const gated = _gateVelocityMetricRows(arr, country, mat);
        _metricsCacheByCountry.set(country, gated);
        setMetrics(gated);
      }).catch((e) => {
        if (!isStale()) console.error("[useMetrics]", e);
      }).finally(() => {
        if (!isStale()) setLoading(false);
      });
      return () => { reqRef.current++; };
    }
    // Fresh query each attempt (builder is single-shot) so _readPublicWithRetry
    // can re-fire when the heavy `metrics` rollup view exceeds the anon statement
    // timeout on a COLD cache (57014) — the retry hits the now-warm view (~100ms).
    const runMetrics = () => supabasePublic.from("metrics").select("*").eq("country_code", country).order("display_order", { ascending: true });
    Promise.all([
      _readPublicWithRetry(runMetrics),
      _loadVelocityMaturity(),
    ]).then(([{ data, error }, mat]) => {
        if (isStale()) return;
        // F-313 (DP-096): don't poison the module cache with [] on transient
        // errors — that would leave the ticker empty for the rest of the
        // session until hard reload. Cache ONLY on success.
        if (error) {
          console.error("[useMetrics]", error);
          return;
        }
        const gated = _gateVelocityMetricRows(data || [], country, mat);
        _metricsCacheByCountry.set(country, gated);
        setMetrics(gated);
      }).catch((e) => {
        if (!isStale()) console.error("[useMetrics]", e);
      }).finally(() => {
        if (!isStale()) setLoading(false);
      });
    return () => { reqRef.current++; };
  }, [country]);
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
  soldLastMonth: null, avgPriceM2: null,
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
  district:       'totals_by_district',
};

const _filterColForLevel = {
  global:         null,           // single row, no filter
  country:        'country_code',
  country_group:  'group_id',
  market:         'market_key',
  region:         'region_id',
  city:           'city_id',
  district:       'district',
};

// The geo aggregate views spell the country column differently:
// totals_by_district uses `country`, the rest use `country_code`.
const _countryColForLevel = (level) => (level === 'district' ? 'country' : 'country_code');

/**
 * One delayed retry for the PUBLIC aggregate reads (totals_* / district),
 * which route through the session-less `supabasePublic` client.
 *
 * The FIRST render right after a fresh magic-link login fires a burst of
 * queries while the app is still warming up (auth token exchange, profile
 * fetch, cold PostgREST connection). In that window a public read can come back
 * with a TRANSIENT error (aborted fetch / cold statement_timeout). These hooks
 * had no retry, so a single failed attempt left the /app dashboard KPI cards
 * (Sledované byty / Voľné / Predané / €/m²) and the "podľa mestskej časti"
 * district totals empty until the user reloaded — even though the data was fine.
 *
 * One delayed re-read closes that window. Paired with re-running the effect when
 * auth settles (the `authLoading` / `user?.id` deps below, mirroring
 * usePivotDistinct) it gives two independent recovery paths. `run` MUST create a
 * fresh query each call — a supabase builder is single-shot — so pass a thunk,
 * not an already-awaited promise. On success (no error) it returns after the
 * first attempt; it never masks a persistent error (that still surfaces).
 */
async function _readPublicWithRetry(run, { retries = 1, delayMs = 300 } = {}) {
  let res = await run();
  for (let attempt = 0; res && res.error && attempt < retries; attempt++) {
    await new Promise((r) => setTimeout(r, delayMs));
    res = await run();
  }
  return res;
}

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
  // Auth-settle signal: re-run the fetch once auth resolves, and retry on a
  // transient first-load error (see _readPublicWithRetry). Public read, so we
  // don't GATE on authLoading — we just want a fresh attempt when it settles.
  const { loading: authLoading, user } = useAuth();
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
    const runReq = () => {
      let q = supabasePublic.from(view).select("*");
      if (filterCol && id != null) q = q.eq(filterCol, id);
      return q.maybeSingle();
    };
    _readPublicWithRetry(runReq).then(({ data, error }) => {
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
  }, [level, id, authLoading, user?.id]);

  return totals;
}

// =============================================================================
// useTotalsList(level, opts) — LIST of all rows at a granularity level, for
// drill-down (kraje in a country, cities in a kraj, districts in a city).
// Unlike useTotals (one entity), this returns the children array.
//
//   useTotalsList('region',   { country: 'SK' })                          → all SK kraje
//   useTotalsList('city',     { country: 'SK', filterCol:'region_id', filterId:'sk-bratislavsky' })
//   useTotalsList('district', { country: 'SK', filterCol:'city_id',   filterId:'bratislava' })
//
// When filterCol is given but filterId is null (parent not selected yet) the
// hook returns [] without querying — so a drill-down can mount all three levels
// unconditionally (Rules of Hooks) and only the active one fetches.
// =============================================================================
const _totalsListCache = new Map();
export function useTotalsList(level, { country = null, filterCol = null, filterId = null } = {}) {
  // Auth-settle signal (mirrors usePivotDistinct): re-fetch once auth resolves.
  // Public read via supabasePublic, so no GATE — just a fresh attempt on settle,
  // plus a transient-error retry below. Fixes the "/app dashboard district totals
  // empty on first load right after login" race.
  const { loading: authLoading, user } = useAuth();
  const view = _viewForLevel[level];
  const cacheKey = `${level}:${country || ''}:${filterCol || ''}:${filterId ?? ''}`;
  const [rows, setRows] = useState(() => _totalsListCache.get(cacheKey) || []);
  const [loading, setLoading] = useState(() => !_totalsListCache.has(cacheKey));
  // Request-id guard + .finally (2026-06-22) — same hardening as useProjectFlats:
  // only stale runs skip, and the latest run always clears loading on every path
  // (success / db-error / rejection). Replaces a `cancelled` boolean that put the
  // guard before setLoading(false) and had no .catch (a rejected request stranded
  // the spinner).
  const reqRef = useRef(0);

  useEffect(() => {
    // Parent filter requested but no parent selected → nothing to fetch.
    if (filterCol && filterId == null) {
      setRows([]);
      setLoading(false);
      return;
    }
    if (!isSupabaseReady() || !view) {
      setLoading(false);
      return;
    }
    const cached = _totalsListCache.get(cacheKey);
    if (cached) { setRows(cached); setLoading(false); }
    else setLoading(true);

    const myReq = ++reqRef.current;
    const isStale = () => myReq !== reqRef.current;
    // Fresh query each attempt (builder is single-shot) so _readPublicWithRetry
    // can re-fire on a transient first-load error.
    const runReq = () => {
      let q = supabasePublic.from(view).select("*");
      // 'all' = the cross-market view → NO country filter (show every region/city/
      // district across all markets). A literal .eq('country_code','all') matched
      // nothing, which is why the homepage pricing-map block was empty in All view.
      if (country && country !== "all") q = q.eq(_countryColForLevel(level), country);
      if (filterCol && filterId != null) q = q.eq(filterCol, filterId);
      return q;
    };
    _readPublicWithRetry(runReq).then(({ data, error }) => {
      if (isStale()) return;
      if (error) {
        console.error(`[useTotalsList] ${level}/${filterCol}=${filterId}`, error);
        return;
      }
      const arr = data || [];
      _totalsListCache.set(cacheKey, arr);
      setRows(arr);
    }).catch((e) => {
      if (!isStale()) console.error(`[useTotalsList] ${level}/${filterCol}=${filterId}`, e);
    }).finally(() => {
      if (!isStale()) setLoading(false);
    });
    return () => { reqRef.current++; };
  }, [level, country, filterCol, filterId, view, cacheKey, authLoading, user?.id]);

  return { rows, loading };
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

// PERF Step 2: seed the hero/headline totals from the build-time snapshot
// (window.__RESIDATA_SNAPSHOT__, injected into index.html before the app JS
// runs). This makes the FIRST render of useMarketTotals show REAL numbers
// immediately — no "Live — loading projects…" flash, no DB round-trip on the
// critical path — while the live fetch in the hook still refreshes in the
// background. No-op (graceful fallback to loading→fetch) if the snapshot is
// absent or malformed; never throws.
(function seedMarketTotalsFromSnapshot() {
  try {
    const s = (typeof window !== "undefined") ? window.__RESIDATA_SNAPSHOT__ : null;
    if (!s || typeof s !== "object") return;
    const n = (v) => (v != null && !Number.isNaN(Number(v)) ? Number(v) : null);
    const cc = s.country || "SK";
    _marketTotalsByCountry.set(cc, {
      loading: false,
      unitsTracked:    n(s.total_units),
      unitsAvailable:  n(s.total_available),
      unitsReserved:   n(s.total_reserved),
      soldLastMonth:   null,                       // not in snapshot — live fetch fills it
      avgPriceM2:      n(s.avg_eur_m2),
      projectsActive:  n(s.total_projects),
      projectsTracked: n(s.total_projects_tracked) ?? n(s.total_projects),
      developersActive:n(s.total_developers),
      snapshotMonth:   s.snapshot_month || null,
      _fromSnapshot:   true,
    });
  } catch (_e) { /* a seed must never break the app */ }
})();

export function useMarketTotals() {
  // Auth-settle signal (mirrors usePivotDistinct): re-fetch once auth resolves.
  // Public read via supabasePublic, so no GATE — just a fresh attempt on settle,
  // plus a transient-error retry below. Fixes the "/app dashboard KPI cards empty
  // on first load right after login" race.
  const { loading: authLoading, user } = useAuth();
  const { country } = useCountry();
  const [totals, setTotals] = useState(() => _marketTotalsByCountry.get(country) || {
    loading: true,
    unitsTracked: null, unitsAvailable: null, unitsReserved: null,
    avgPriceM2: null, snapshotMonth: null,
  });
  useEffect(() => {
    if (!isSupabaseReady()) {
      setTotals(t => ({ ...t, loading: false }));
      return;
    }
    const cached = _marketTotalsByCountry.get(country);
    if (cached) setTotals(cached);
    let cancelled = false;
    // "All" → the cross-market combined row (totals_global); else the per-country
    // row. totals_global now includes total_sold_last_month (cross-market velocity,
    // 2026-06-15) so "sold last month" renders for the All view too; it still lacks
    // snapshot_month, which we fill from the latest month any market scraped so the
    // dashboard's "last run for month X" is real.
    // Fresh query each attempt (builder is single-shot) so _readPublicWithRetry
    // can re-fire on a transient first-load error.
    const runReq = () => (isAllCountries(country)
      ? Promise.all([
          supabasePublic.from("totals_global").select("*").maybeSingle(),
          supabasePublic.from("totals_by_country").select("snapshot_month")
            .order("snapshot_month", { ascending: false }).limit(1).maybeSingle(),
        ]).then(([g, m]) => ({
          data: g.data ? { ...g.data, snapshot_month: m.data?.snapshot_month ?? null } : g.data,
          error: g.error,
        }))
      : supabasePublic.from("totals_by_country").select("*").eq("country_code", country).maybeSingle());
    _readPublicWithRetry(runReq).then(({ data, error }) => {
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
  }, [country, authLoading, user?.id]);
  return totals;
}

/** Per-district aggregates derived live from flats_archive — one row per
 *  city+district with total_units / available_units / sold_units / reserved /
 *  project_count / avg_eur_m2. Used by any "districts breakdown" surface
 *  that needs honest counts.
 *
 *  Multi-country: reads `totals_by_district` (SK + CZ + …) filtered to the
 *  selected country (useCountry), so a CZ visitor never sees SK districts.
 *  The previous implementation read the SK-only `district_totals` alias with
 *  no country filter, which would have shown Slovakia's districts on the CZ
 *  view. We keep city+district granularity (totals_by_district is grouped by
 *  city) so collisions like "Staré Mesto" (Bratislava AND Praha) stay
 *  distinct rows instead of being summed together.
 *
 *  Columns are mapped to the shape the old `district_totals` view exposed
 *  (district / total_units / available_units / sold_units / reserved_units /
 *  project_count / avg_eur_m2 / country) PLUS the city fields totals_by_district
 *  adds (city_id / city_name / region_id / region_name), so existing consumers
 *  that read either shape keep working.
 *
 *  Same security model as useMarketTotals — reads a SECURITY DEFINER
 *  view that exposes only aggregate rows. For country='SK' the returned set
 *  is byte-identical to the SK rows the previous SK-pinned view returned. */
const _districtTotalsByCountry = new Map();  // country code → rows
export function useDistrictTotals() {
  // Auth-settle signal (mirrors usePivotDistinct): re-fetch once auth resolves.
  // Public read via supabasePublic, so no GATE — just a fresh attempt on settle,
  // plus a transient-error retry below (same first-load race as the KPI cards).
  const { loading: authLoading, user } = useAuth();
  const { country } = useCountry();
  const cached = _districtTotalsByCountry.get(country);
  const [districts, setDistricts] = useState(cached || []);
  const [loading, setLoading] = useState(cached === undefined);
  // Request-id guard + .finally (2026-06-22) — same hardening as useProjectFlats.
  // The old `cancelled` boolean put `if (cancelled) return` BEFORE setLoading(false),
  // and there was no .catch, so (a) a rapid re-run could strand the spinner and
  // (b) a rejected request left it spinning forever. Now only stale runs skip and
  // the latest run always clears loading in finally, on every path.
  const reqRef = useRef(0);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    const hit = _districtTotalsByCountry.get(country);
    if (hit) { setDistricts(hit); setLoading(false); }
    else setLoading(true);
    const myReq = ++reqRef.current;
    const isStale = () => myReq !== reqRef.current;
    // Fresh query each attempt (builder is single-shot) so _readPublicWithRetry
    // can re-fire on a transient first-load error.
    const runReq = () => _eqCountry(supabasePublic.from("totals_by_district").select("*"), country);
    _readPublicWithRetry(runReq).then(({ data, error }) => {
      if (isStale()) return;
      if (error) { console.error("[useDistrictTotals]", error); return; }
      const arr = data || [];
      _districtTotalsByCountry.set(country, arr);
      setDistricts(arr);
    }).catch((e) => {
      if (!isStale()) console.error("[useDistrictTotals]", e);
    }).finally(() => {
      if (!isStale()) setLoading(false);
    });
    return () => { reqRef.current++; };
  }, [country, authLoading, user?.id]);
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
    let q = _eqCountry(supabasePublic.from("projects_live").select("*"), country);
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

// PERF Step 6: a narrow projects read for the public HOMEPAGE only (MarketPulse).
// The shared useProjects() above selects "*" (32 columns, ~119 KB for 161 rows)
// and feeds many surfaces, so it stays untouched. The landing only needs a
// handful of display/number fields — this hook selects just those, dropping the
// heaviest unused columns (project_url, last_updated/last_seen_at, and the
// internal-classification text fields) → roughly half the payload off the
// homepage, with its own cache so it never interferes with useProjects.
// Column set is a SUPERSET of every field MarketPulse reads (audited 2026-06-04)
// plus a safety margin; if a homepage component ever needs more, add it here.
const _HOME_PROJECT_COLS =
  "country,id,name,district,sub_district,city,developer,status,is_top20," +
  "total_units,available_units,sold_units,reserved_units,prereserved_units," +
  "future_units,sold_last_month,sold_percentage,avg_price_eur_m2,min_price,max_price";
let _homeProjectsCache = null;
let _homeProjectsCacheKey = null;
export function useHomeProjects() {
  const { country } = useCountry();
  const key = country;
  const cacheHit = _homeProjectsCacheKey === key;
  const [projects, setProjects] = useState(cacheHit ? (_homeProjectsCache || []) : []);
  const [loading, setLoading] = useState(!cacheHit);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    let cancelled = false;
    _eqCountry(supabasePublic.from("projects_live").select(_HOME_PROJECT_COLS), country)
      .order("available_units", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { console.error("[useHomeProjects]", error); setLoading(false); return; }
        const arr = data || [];
        _homeProjectsCache = arr;
        _homeProjectsCacheKey = key;
        setProjects(arr);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [key]);
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
  // Monotonic request id (2026-06-22) — replaces a per-effect boolean
  // `cancelled` flag. Opening a project FROM THE MAP tears down a heavy
  // maplibre instance while auth/profile re-resolves, which re-ran this effect
  // several times in quick succession; the old flag let the LATEST successful
  // 200 be discarded ("if (cancelled) return" before setLoading(false)),
  // stranding the page on "Loading…" forever even though the rows came back.
  // With a request id, only STALE runs skip; the newest run always commits and
  // (in finally) always clears loading — robust to any remount/auth timing.
  const reqRef = useRef(0);

  useEffect(() => {
    if (!isSupabaseReady() || !projectId) {
      setLoading(false);   // nothing to load → never strand the spinner
      return;
    }
    // Auth still resolving — keep the spinner; this effect re-runs when
    // authLoading flips (it's a dep) and then starts the fetch.
    if (authLoading) return;
    const myReq = ++reqRef.current;
    const isStale = () => myReq !== reqRef.current;
    setLoading(true);
    setError(null);

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
      return await sbRead(supabaseData.from("flats_current")
        .select("*")
        .eq("project_id", projectId)
        .order("poschodie", { ascending: true }));
    };

    // Fallback for manual projects (Altum, Bory) — they're updated
    // sporadically by Boss not by cron, so when the global "latest
    // snapshot_month" rolls forward they fall out of flats_current.
    // Their data is STILL VALID, just slightly older. Fetch the most
    // recent batch that exists for THIS project specifically.
    const fetchMostRecentForProject = async () => {
      // First: find most recent batch_timestamp for this project
      const probe = await sbRead(supabaseData.from("flats_archive")
        .select("batch_id, batch_timestamp")
        .eq("project_id", projectId)
        .order("batch_timestamp", { ascending: false, nullsFirst: false })
        .limit(1));
      if (probe.error || !probe.data || probe.data.length === 0) {
        return { data: [], error: probe.error };
      }
      const latestBatch = probe.data[0].batch_id;
      // Then fetch all flats for that specific batch
      return await sbRead(supabaseData.from("flats_archive")
        .select("*")
        .eq("project_id", projectId)
        .eq("batch_id", latestBatch)
        .order("poschodie", { ascending: true }));
    };

    (async () => {
      try {
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
          if (isStale()) return;
          ({ data, error: err } = await fetchCurrent());
        }
        // Final fallback: archive lookup. Manual projects (status='paused'
        // promoted to 'active' by sync) often have stale snapshot_month
        // because they're updated manually. Their archive data is still
        // valid for display.
        if (!err && (!data || data.length === 0)) {
          if (isStale()) return;
          ({ data, error: err } = await fetchMostRecentForProject());
        }
        if (isStale()) return;
        setFlats(_toEurDisplay(data || []));
        setError(err || null);
      } catch (e) {
        if (!isStale()) setError(e);
      } finally {
        // The newest run always reaches here and clears the spinner — this is
        // the fix for the "stuck on Loading…" race. A stale run (superseded by
        // a newer effect run, or unmounted) leaves loading to whoever's current.
        if (!isStale()) setLoading(false);
      }
    })();

    // Invalidate this run on re-run / unmount so a late-resolving fetch can't
    // overwrite a newer run's result or setState after unmount.
    return () => { reqRef.current++; };
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
    supabasePublic.from("project_snapshots").select("*")
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
export function useFlatsCurrent(enabled = true) {
  const { loading: authLoading, user, profile } = useAuth();
  const { country } = useCountry();
  // country is part of the identity signature: switching country must refetch
  // (and not serve a stale other-country cache). flats_current carries a
  // `country` column ('SK'/'CZ'); without this filter SK paid users saw SK+CZ
  // rows mixed in Reports.
  const identityKey = user
    ? `${user.id}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}::${country}`
    : `anon::${country}`;
  const [flats, setFlats] = useState(_flatsCurrentCacheKey === identityKey ? (_flatsCurrentCache || []) : []);
  const [loading, setLoading] = useState(_flatsCurrentCacheKey !== identityKey);

  useEffect(() => {
    if (!enabled) { setFlats([]); setLoading(false); return; }
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
        const { data, error } = await sbRead(_eqCountry(supabaseData.from("flats_current").select("*"), country)
          .range(offset, offset + PAGE - 1)
          .order("id", { ascending: true }));
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
      const all_eur = _toEurDisplay(all);
      if (!hadError) {
        _flatsCurrentCache = all_eur;
        _flatsCurrentCacheKey = identityKey;
      }
      setFlats(all_eur);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, identityKey, country, enabled]);

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
export function useFlatsArchive(months, dates, enabled = true) {
  const { loading: authLoading, user, profile } = useAuth();
  const { country } = useCountry();
  const datesArr = Array.isArray(dates) && dates.length ? dates.slice().sort() : null;
  const monthsKey = Array.isArray(months) ? months.slice().sort().join(",") : "all";
  const datesKey = datesArr ? datesArr.join(",") : "all";
  // country is part of the identity signature so switching country refetches
  // instead of serving a stale other-country cache. flats_archive carries a
  // `country` column ('SK'/'CZ'); without this filter SK paid users saw SK+CZ
  // rows mixed in the Pivot.
  const identityKey = (user
    ? `${user.id}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}`
    : "anon") + `::${monthsKey}::${datesKey}::${country}::${enabled ? "1" : "0"}`;
  const [flats, setFlats] = useState(_archiveCacheKey === identityKey ? (_archiveCache || []) : []);
  const [loading, setLoading] = useState(_archiveCacheKey !== identityKey);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!enabled) { setFlats([]); setProgress(0); setLoading(false); return; }
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
        let q = _eqCountry(supabaseData.from("flats_archive").select("*"), country)
          .range(offset, offset + REQUESTED_PAGE - 1)
          .order("batch_timestamp", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true });
        if (Array.isArray(months) && months.length > 0) {
          q = q.in("snapshot_month", months);
        }
        if (datesArr) {
          // Day-scope: batch_timestamp range [min, max+1) — index-friendly; the
          // exact datum filter refines in filteredRecords. Cuts the default
          // fetch from the whole month (~152k) to the shown day (~19k).
          const hi = new Date(datesArr[datesArr.length - 1] + "T00:00:00Z");
          hi.setUTCDate(hi.getUTCDate() + 1);
          q = q.gte("batch_timestamp", datesArr[0]).lt("batch_timestamp", hi.toISOString().slice(0, 10));
        }
        const { data, error } = await sbRead(q);
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
      const all_eur = _toEurDisplay(all);
      if (!hadError) {
        _archiveCache = all_eur;
        _archiveCacheKey = identityKey;
      }
      setFlats(all_eur);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, identityKey, monthsKey, datesKey, country, enabled]);

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
 *  withdrawn) so the two stay consistent.
 *
 *  NOT country-scoped (intentional): the `archive_months` view is built
 *  from final.snapshots and carries NO country/market column (see
 *  v2/migrations/2026-06-01_f207_archive_months_view_and_f208_flats_archive_id.sql),
 *  so it cannot be filtered with `.eq("country", …)` here. Deriving the
 *  month list from flats_archive filtered by country would reintroduce the
 *  exact F-207 truncation this view was created to fix (paginating 97 k
 *  rows, plus RLS would shrink anon/free callers to ≤1 month). Impact of
 *  leaving it all-country is cosmetic and ~nil today: PivotV2 calls this
 *  hook but no longer reads the result, and UnitTracker uses only
 *  `.length` to decide a "≤1 month" empty-state hint — SK and CZ share the
 *  same monthly cadence, so the count is identical either way. The proper
 *  fix is a backend change: add a country/market_key column to the
 *  archive_months view, then add `.eq("country", country)` here.  */
let _archiveMonthsCache = null;
export function useArchiveMonths() {
  const [months, setMonths] = useState(_archiveMonthsCache || []);
  const [loading, setLoading] = useState(_archiveMonthsCache === null);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await sbRead(supabaseData
        .from("archive_months")
        .select("snapshot_month")
        .order("snapshot_month", { ascending: false }));
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

/* ─── Analytika (PivotV2) server-side aggregation (forever perf fix, 2026-06-11) ─
 * The pivot pulled the whole latest month (152k rows, ~60s) to show one day.
 * useArchiveDays gives the scrape-day list (seed + datum popover) without records;
 * usePivotGrain returns server-aggregated grain rows for "server-able" configs
 * (decomposable aggs + whitelisted dims + time-only filters). The client rebuilds
 * the tree from the grain; non-server-able configs fall back to the raw path. */
let _archiveDaysCache = new Map();
/** Distinct scrape days (YYYY-MM-DD, DESC) for the current country. Light + cached. */
export function useArchiveDays() {
  const { country } = useCountry();
  const [days, setDays] = useState(_archiveDaysCache.get(country) || []);
  const [loading, setLoading] = useState(!_archiveDaysCache.has(country));
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    if (_archiveDaysCache.has(country)) { setDays(_archiveDaysCache.get(country)); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await sbRead(_eqCountry(supabaseData.from("archive_days").select("day"), country).order("day", { ascending: false }));
      if (cancelled) return;
      if (error) { console.error("[useArchiveDays]", error); setLoading(false); return; }
      const seen = new Set(); const arr = [];
      for (const row of data || []) { const d = row.day; if (d && !seen.has(d)) { seen.add(d); arr.push(d); } }
      _archiveDaysCache.set(country, arr); setDays(arr); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [country]);
  return { days, loading };
}

let _pivotGrainCache = new Map();
/** Server-aggregated pivot grain rows [{d:[dimVals], m:{components}}] for a full
 *  analytics_pivot spec ({dims, filters, filters_not, ranges, nulls, mode, …}).
 *  The spec is built in PivotV2 (buildPivotSpec) — ALL filters are applied server-side
 *  now, so any-dimension filtering is instant (no browser record pull). enabled=false →
 *  no fetch (returns null). RLS-gated (mode 'archive' is paid/chosen-project gated in the
 *  RPC, mirroring flats_archive). Cached by user+tier+chosen+spec. */
export function usePivotGrain({ enabled = false, spec = null } = {}) {
  const { loading: authLoading, user, profile } = useAuth();
  const specKey = spec ? JSON.stringify(spec) : "";
  const key = enabled && spec
    ? `${user?.id || "anon"}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}::${specKey}`
    : null;
  const [grain, setGrain] = useState(key && _pivotGrainCache.has(key) ? _pivotGrainCache.get(key) : null);
  const [loading, setLoading] = useState(!!enabled && !(key && _pivotGrainCache.has(key)));
  useEffect(() => {
    if (!enabled || !spec) { setGrain(null); setLoading(false); return; }
    if (!isSupabaseReady() || authLoading) return;
    if (_pivotGrainCache.has(key)) { setGrain(_pivotGrainCache.get(key)); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await sbRead(supabaseData.rpc("analytics_pivot", { p_spec: spec }));
      if (cancelled) return;
      if (error) { console.error("[usePivotGrain]", error); setGrain([]); setLoading(false); return; }
      const arr = Array.isArray(data) ? data : [];
      _pivotGrainCache.set(key, arr);
      setGrain(arr);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [enabled, key, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  return { grain, loading };
}

// Cache for server-side distinct filter values — one fast pivot_grain(p_dims=[field])
// call instead of pulling the whole archive (~30k rows) just to populate a dropdown.
const _pivotDistinctCache = new Map();

/* usePivotDistinct — distinct values of ONE categorical field, server-side.
   Calls pivot_grain grouped by [field]: each grain row is {d:[value], m:{n}}, so the
   row keys ARE the field's distinct values, computed by the SAME server CASE the
   client accessor mirrors (so they match what records-side filtering compares).
   Returns the same {values, hasEmpty} shape distinctValuesForField() yields for a
   TEXT field, so FilterPopover can consume it interchangeably — WITHOUT a records pull. */
export function usePivotDistinct({ enabled = false, field = null, months = null, dates = null, stav = null, mode = null, city = null } = {}) {
  const { loading: authLoading, user, profile } = useAuth();
  const { country } = useCountry();
  // One analytics_pivot(dims=[field]) call: each grain row is {d:[value], m:{…}}, so the
  // row keys ARE the field's distinct values. Scope mirrors the table (country/month/date,
  // and stav for OTHER fields — a field's own value list is never narrowed by itself).
  // `city` narrows a location field's options to one city (e.g. only Bratislava's mestské
  // časti), the same "parent scopes child" behaviour the Map filter uses — never applied to
  // the `city` field itself (a field's own list is never narrowed by itself).
  const spec = enabled && field ? (() => {
    const filters = {};
    if (!isAllCountries(country)) filters.country = [country];
    if (months && months.length) filters.snapshot_month = months.map(String);
    if (dates && dates.length) filters.datum = dates.map(String);
    if (stav && stav.length && field !== "stav") filters.stav = stav.map(String);
    if (city && field !== "city") filters.city = [String(city)];
    return { dims: [field], mode: mode || ((months?.length || dates?.length) ? "archive" : "latest"), filters };
  })() : null;
  const key = enabled && field
    ? `${user?.id || "anon"}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}::${JSON.stringify(spec)}`
    : null;
  const [result, setResult] = useState(() => (key && _pivotDistinctCache.has(key)) ? _pivotDistinctCache.get(key) : { values: [], hasEmpty: false });
  const [loading, setLoading] = useState(!!enabled && !(key && _pivotDistinctCache.has(key)));
  useEffect(() => {
    if (!enabled || !field) { setLoading(false); return; }
    if (!isSupabaseReady() || authLoading) return;
    if (_pivotDistinctCache.has(key)) { setResult(_pivotDistinctCache.get(key)); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await sbRead(supabaseData.rpc("analytics_pivot", { p_spec: spec }));
      if (cancelled) return;
      if (error) { console.error("[usePivotDistinct]", error); setResult({ values: [], hasEmpty: false }); setLoading(false); return; }
      const rows = Array.isArray(data) ? data : [];
      // Mirror distinctValuesForField()'s TEXT branch: dedupe case-insensitively on
      // trimmed lowercase, keep first-seen casing, sort locale-numeric, track empties.
      let hasEmpty = false;
      const seen = new Set();
      const strs = [];
      for (const g of rows) {
        const v = g && g.d ? g.d[0] : null;
        if (v == null || v === "") { hasEmpty = true; continue; }
        const s = String(v);
        const k = s.trim().toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k); strs.push(s);
      }
      strs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const out = { values: strs, hasEmpty };
      _pivotDistinctCache.set(key, out);
      setResult(out);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [enabled, key, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  return { values: result.values, hasEmpty: result.hasEmpty, loading };
}

// Cache for server-side numeric-field stats (min/max/median/count) — so a numeric
// range filter popover opens instantly instead of pulling ~30k rows for its bounds.
const _pivotStatsCache = new Map();

/* usePivotFieldStats — min/max/median/count for ONE numeric field, server-side, via
   the report_field_stats RPC. Stats come from the NATIVE columns (cena_s_dph, not
   the EUR copy) so the popover's range hints stay in the same units the records-path
   filter compares. Scope mirrors the table (country/month/date/stav). SECURITY
   INVOKER → RLS gates it (anon gets nulls). */
export function usePivotFieldStats({ enabled = false, field = null, months = null, dates = null, stav = null } = {}) {
  const { loading: authLoading, user, profile } = useAuth();
  const { country } = useCountry();
  const key = enabled && field
    ? `${user?.id || "anon"}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}::${country}::${field}::${(months || []).join(",")}::${(dates || []).join(",")}::${(stav || []).join(",")}`
    : null;
  const [stats, setStats] = useState(() => (key && _pivotStatsCache.has(key)) ? _pivotStatsCache.get(key) : null);
  const [loading, setLoading] = useState(!!enabled && !(key && _pivotStatsCache.has(key)));
  useEffect(() => {
    if (!enabled || !field) { setLoading(false); return; }
    if (!isSupabaseReady() || authLoading) return;
    if (_pivotStatsCache.has(key)) { setStats(_pivotStatsCache.get(key)); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await sbRead(supabaseData.rpc("report_field_stats", {
        p_field: field,
        p_country: _pCountry(country),
        p_months: months && months.length ? months : null,
        p_dates: dates && dates.length ? dates : null,
        p_stav: stav && stav.length ? stav : null,
      }));
      if (cancelled) return;
      if (error || !data || data.min == null) {   // null min ⇒ no rows visible (anon/empty)
        if (error) console.error("[usePivotFieldStats]", error);
        const empty = { min: null, max: null, median: null, count: 0, nNull: 0 };
        if (!error) _pivotStatsCache.set(key, empty);
        setStats(empty); setLoading(false); return;
      }
      const s = {
        min: Number(data.min), max: Number(data.max),
        median: data.median == null ? null : Number(data.median),
        count: Number(data.count || 0), nNull: Number(data.n_null || 0),
      };
      _pivotStatsCache.set(key, s);
      setStats(s); setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [enabled, key, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  return { stats, loading };
}

// ── Byt v čase (UnitTracker) server-side data — Phase 1 perf/scaling fix ──────
//
// Replaces the old whole-archive pull (useFlatsArchive, ~217k rows / 30-60s) for
// the UnitTracker screen with two narrow reads backed by RPCs:
//
//   · unit_list_json(country, project?) → latest-state summary per unit as ONE
//     jsonb blob (RLS-gated). Per-project = small + fast (the common flow);
//     whole-country (project=null) = the single ~7 MB call used only by global
//     cross-project search.
//   · unit_history(project, unit)       → one unit's full timeline, lazy, per
//     picked/comparable unit (tens of ms each).
//
// Both inherit flats_archive's RLS gate (free user sees only their chosen
// project; anon sees nothing), so there is no bypass path. Caches are module-
// level and keyed by identity so a tier/country change refetches.

let _unitSummCache = new Map();
/** Latest-state unit summaries for a scope.
 *  Pass { projectId } for one project's units (grid / comparables), or
 *  { all: true } for every unit (global search). Neither → returns []. */
export function useUnitSummaries({ projectId = null, all = false } = {}) {
  const { loading: authLoading, user, profile } = useAuth();
  const { country } = useCountry();
  const scope = projectId ? `p:${projectId}` : (all ? "all" : "none");
  const idKey = user
    ? `${user.id}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}::${country}::${scope}`
    : `anon::${country}::${scope}`;
  const [units, setUnits] = useState(_unitSummCache.get(idKey) || []);
  const [loading, setLoading] = useState(scope !== "none" && !_unitSummCache.has(idKey));

  useEffect(() => {
    if (scope === "none") { setUnits([]); setLoading(false); return; }
    if (!isSupabaseReady()) { setLoading(false); return; }
    if (authLoading) return;
    if (_unitSummCache.has(idKey)) { setUnits(_unitSummCache.get(idKey)); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await sbRead(supabaseData.rpc("unit_list_json", {
        p_country: _pCountry(country),
        p_project_id: projectId,   // null when scope === 'all'
      }));
      if (cancelled) return;
      if (error) { console.error("[useUnitSummaries]", error); setLoading(false); return; }
      const arr = _toEurDisplay(Array.isArray(data) ? data : []);
      _unitSummCache.set(idKey, arr);
      setUnits(arr);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, idKey]);

  return { units, loading };
}

let _unitHistCache = new Map();
/** Lazily fetch full per-unit histories for a set of `${project_id}::${unit_id}`
 *  keys. Returns a Map<key, rows[]> covering whichever keys have loaded, plus a
 *  loading flag while any are still in flight. Each key is fetched once and
 *  cached (per identity). */
export function useUnitHistories(keys) {
  const { loading: authLoading, user, profile } = useAuth();
  const idPrefix = user ? `${user.id}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}` : "anon";
  const wantKeys = Array.isArray(keys) ? keys : [];
  const wantSig = wantKeys.slice().sort().join(",");
  const [historyByKey, setHistoryByKey] = useState(() => new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseReady() || authLoading) return;
    let cancelled = false;
    const assemble = () => {
      const m = new Map();
      for (const k of wantKeys) {
        const cached = _unitHistCache.get(`${idPrefix}::${k}`);
        if (cached) m.set(k, cached);
      }
      return m;
    };
    const need = wantKeys.filter(k => !_unitHistCache.has(`${idPrefix}::${k}`));
    if (need.length === 0) { setHistoryByKey(assemble()); setLoading(false); return; }
    setLoading(true);
    (async () => {
      await Promise.all(need.map(async (k) => {
        const sep = k.indexOf("::");
        const pid = k.slice(0, sep);
        const uid = k.slice(sep + 2);
        const { data, error } = await sbRead(supabaseData.rpc("unit_history", { p_project_id: pid, p_unit_id: uid }));
        if (error) { console.error("[useUnitHistories]", k, error); _unitHistCache.set(`${idPrefix}::${k}`, []); return; }
        _unitHistCache.set(`${idPrefix}::${k}`, _toEurDisplay(data || []));
      }));
      if (cancelled) return;
      setHistoryByKey(assemble());
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, idPrefix, wantSig]);

  return { historyByKey, loading };
}

/** Server-side global unit search (debounced). Calls unit_search(country, q,
 *  project_ids) which reads RLS-gated flats_current and returns ≤40 matches —
 *  instead of loading every unit's summary to filter client-side. `query`
 *  matches unit_id (≥2 chars); `projectIds` (resolved from a project-name query
 *  client-side) matches whole projects. Disabled unless `enabled`. */
export function useUnitSearch({ query, projectIds, enabled }) {
  const { loading: authLoading, user, profile } = useAuth();
  const { country } = useCountry();
  const q = (query || "").trim();
  const pids = Array.isArray(projectIds) ? projectIds : [];
  const sig = `${user?.id || "anon"}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}::${country}::${q}::${pids.slice().sort().join(",")}::${enabled ? 1 : 0}`;
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !isSupabaseReady() || authLoading) { setResults([]); setLoading(false); return; }
    if (q.length < 2 && pids.length === 0) { setResults([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    // Debounce so we don't fire a query on every keystroke.
    const timer = setTimeout(async () => {
      const { data, error } = await sbRead(supabaseData.rpc("unit_search", {
        p_country: _pCountry(country), p_q: q, p_project_ids: pids, p_limit: 40,
      }));
      if (cancelled) return;
      if (error) { console.error("[useUnitSearch]", error); setResults([]); setLoading(false); return; }
      setResults(_toEurDisplay(Array.isArray(data) ? data : []));
      setLoading(false);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [authLoading, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  return { results, loading };
}

let _projSeriesCache = new Map();
/** Per-unit latest state + compact EUR price series for ONE project — powers the
 *  Byt v čase mini-grid sparklines in a single small jsonb call (RLS-gated).
 *  projectId null → []. */
export function useProjectUnitsSeries(projectId) {
  const { loading: authLoading, user, profile } = useAuth();
  const idKey = projectId
    ? `${user?.id || "anon"}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}::${projectId}`
    : "none";
  const [units, setUnits] = useState(_projSeriesCache.get(idKey) || []);
  const [loading, setLoading] = useState(!!projectId && !_projSeriesCache.has(idKey));
  useEffect(() => {
    if (!projectId) { setUnits([]); setLoading(false); return; }
    if (!isSupabaseReady() || authLoading) return;
    if (_projSeriesCache.has(idKey)) { setUnits(_projSeriesCache.get(idKey)); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await sbRead(supabaseData.rpc("project_units_series", { p_project_id: projectId }));
      if (cancelled) return;
      if (error) { console.error("[useProjectUnitsSeries]", error); setLoading(false); return; }
      const arr = _toEurDisplay(Array.isArray(data) ? data : []);   // overlays cena_s_dph; series stays EUR
      _projSeriesCache.set(idKey, arr);
      setUnits(arr);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, idKey]);
  return { units, loading };
}

/* ─── Reports server-side aggregation (forever perf fix, 2026-06-11) ───
 * Reports used to pull flats_current (32k rows, ~30s) just to draw the €/m²
 * histogram + drilldown. KPIs/breakdowns now come from projects_live (honest in
 * v2); these hooks move the only unit-level pieces server-side. RPCs are
 * SECURITY INVOKER (RLS inherited) and country-scoped to match useFlatsCurrent. */
let _reportHistCache = new Map();
/** Adaptive €/m² histogram bins for a Reports scope. Returns {bins:[{from,to,count}],loading}.
 *  Bins are EUR (price_s_dph_eur basis) — Histogram converts to display currency. */
export function useReportHistogram({ scopeType = "market", scopeValue = null, nbins = 12 } = {}) {
  const { loading: authLoading, user, profile } = useAuth();
  const { country } = useCountry();
  const key = `${user?.id || "anon"}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}::${country}::${scopeType}::${scopeValue || ""}::${nbins}`;
  const [bins, setBins] = useState(_reportHistCache.get(key) || null);
  const [loading, setLoading] = useState(!_reportHistCache.has(key));
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    if (authLoading) return;
    if (_reportHistCache.has(key)) { setBins(_reportHistCache.get(key)); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await sbRead(supabaseData.rpc("report_price_histogram", {
        p_country: _pCountry(country), p_scope_type: scopeType, p_scope_value: scopeValue, p_nbins: nbins,
      }));
      if (cancelled) return;
      if (error) { console.error("[useReportHistogram]", error); setBins([]); setLoading(false); return; }
      const arr = Array.isArray(data) ? data : [];
      _reportHistCache.set(key, arr);
      setBins(arr);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { bins: bins || [], loading };
}

/** Lazy histogram drilldown — the units inside one clicked €/m² band, scoped.
 *  Plain async (not a hook): called on bin click. Returns rows shaped for
 *  HistogramDrilldown {flatId,projectId,project,district,izby,area,price,m2}
 *  with price in EUR so moneyFromEur() renders the display currency. */
export async function fetchReportBinUnits({ country = null, scopeType = "market", scopeValue = null, from = 0, to = 1e9 } = {}) {
  if (!isSupabaseReady()) return [];
  const { data, error } = await sbRead(supabaseData.rpc("report_bin_units", {
    p_country: _pCountry(country), p_scope_type: scopeType, p_scope_value: scopeValue, p_m2_from: from, p_m2_to: to,
  }));
  if (error) { console.error("[fetchReportBinUnits]", error); return []; }
  return (Array.isArray(data) ? data : []).map((r) => ({
    flatId: `${r.project_id}-${r.unit_id}`,
    projectId: r.project_id,
    project: r.project,
    district: r.district,
    izby: r.izby,
    area: r.area == null ? null : Number(r.area),
    price: r.price_s_dph_eur == null ? null : Number(r.price_s_dph_eur),
    m2: r.m2 == null ? null : Number(r.m2),
  }));
}

let _reportProjUnitsCache = new Map();
/** All current units of ONE project (every stav, incl typ + poschodie) for the
 *  Reports Project deep-dive — one small jsonb call, RLS-gated. projectId null → []. */
export function useReportProjectUnits(projectId) {
  const { loading: authLoading, user, profile } = useAuth();
  const idKey = projectId
    ? `${user?.id || "anon"}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}::${projectId}`
    : "none";
  const [units, setUnits] = useState(_reportProjUnitsCache.get(idKey) || []);
  const [loading, setLoading] = useState(!!projectId && !_reportProjUnitsCache.has(idKey));
  useEffect(() => {
    if (!projectId) { setUnits([]); setLoading(false); return; }
    if (!isSupabaseReady() || authLoading) return;
    if (_reportProjUnitsCache.has(idKey)) { setUnits(_reportProjUnitsCache.get(idKey)); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await sbRead(supabaseData.rpc("report_project_units", { p_project_id: projectId }));
      if (cancelled) return;
      if (error) { console.error("[useReportProjectUnits]", error); setLoading(false); return; }
      const arr = _toEurDisplay(Array.isArray(data) ? data : []);
      _reportProjUnitsCache.set(idKey, arr);
      setUnits(arr);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { units, loading };
}

let _reportCompCache = new Map();
/** Sold-with-price units for the Reports "Komparable" tab — small (~3k of 19k
 *  sold keep a price), one jsonb call, country-scoped, RLS-gated. EUR-overlaid. */
export function useReportComparables() {
  const { loading: authLoading, user, profile } = useAuth();
  const { country } = useCountry();
  const key = `${user?.id || "anon"}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}::${country}`;
  const [units, setUnits] = useState(_reportCompCache.get(key) || []);
  const [loading, setLoading] = useState(!_reportCompCache.has(key));
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    if (authLoading) return;
    if (_reportCompCache.has(key)) { setUnits(_reportCompCache.get(key)); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await sbRead(supabaseData.rpc("report_comparables", { p_country: _pCountry(country) }));
      if (cancelled) return;
      if (error) { console.error("[useReportComparables]", error); setLoading(false); return; }
      const arr = _toEurDisplay(Array.isArray(data) ? data : []);
      _reportCompCache.set(key, arr);
      setUnits(arr);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authLoading, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { units, loading };
}

/** Early access slot count for the marketing badge. Public table. */
export function useEarlyAccessStats() {
  const [stats, setStats] = useState({ paid_count: 0, remaining_slots: 9 });
  useEffect(() => {
    if (!isSupabaseReady()) return;
    let cancelled = false;
    supabasePublic.from("early_access_stats").select("*").maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        if (data) setStats(data);
      });
    return () => { cancelled = true; };
  }, []);
  return stats;
}

/* ── Unit Explorer (Phase 3.1) — raw per-unit detail rows from analytics_units ──
   spec = { columns:[field keys], filters/filters_not/ranges/nulls:{…}, mode:'latest'|'archive',
            sort:[{key,dir}], limit, offset }. RLS-gated in the RPC (archive = paid/chosen-project).
   Fetches limit+1 → hasMore; returns the page (sliced to limit). */
export function useUnitsDetail({ enabled = false, spec = null } = {}) {
  const { loading: authLoading, user, profile } = useAuth();
  const specKey = spec ? JSON.stringify(spec) : "";
  const key = enabled && spec
    ? `${user?.id || "anon"}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}::${specKey}`
    : null;
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(!!enabled);
  useEffect(() => {
    if (!enabled || !spec) { setRows([]); setHasMore(false); setLoading(false); return; }
    if (!isSupabaseReady() || authLoading) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await sbRead(supabaseData.rpc("analytics_units", { p_spec: spec }));
      if (cancelled) return;
      if (error) { console.error("[useUnitsDetail]", error); setRows([]); setHasMore(false); setLoading(false); return; }
      const all = Array.isArray(data?.rows) ? data.rows : [];
      const lim = Number(data?.limit ?? spec.limit ?? 100);
      setHasMore(all.length > lim);
      setRows(all.slice(0, lim));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [enabled, key, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  return { rows, hasMore, loading };
}

/* Infinite/accumulating variant of useUnitsDetail for a virtualized table: keeps appending
   pages (loadMore) instead of prev/next paging, so the Explorer can scroll through an
   arbitrarily large result set smoothly. `spec` must NOT carry limit/offset — those are managed
   here. A generation counter drops stale responses when the spec changes mid-flight. */
export function useUnitsInfinite({ enabled = false, spec = null, pageSize = 100 } = {}) {
  const { loading: authLoading, user, profile } = useAuth();
  const specKey = spec ? JSON.stringify(spec) : "";
  const authKey = `${user?.id || "anon"}::${profile?.tier || ""}::${profile?.chosen_project_id || ""}`;
  const genRef = useRef(0);
  const offsetRef = useRef(0);
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchPage = useCallback(async (gen) => {
    if (!enabled || !spec || !isSupabaseReady() || authLoading) return;
    setLoading(true);
    try {
      const pageSpec = { ...spec, limit: pageSize, offset: offsetRef.current };
      const { data, error } = await sbRead(supabaseData.rpc("analytics_units", { p_spec: pageSpec }));
      if (gen !== genRef.current) return;               // superseded by a newer query → drop this page
      if (error) { console.error("[useUnitsInfinite]", error); return; }
      const all = Array.isArray(data?.rows) ? data.rows : [];
      const lim = Number(data?.limit ?? pageSize);
      const page = all.slice(0, lim);
      offsetRef.current += page.length;
      setHasMore(all.length > lim);
      setRows(prev => [...prev, ...page]);
    } finally {
      if (gen === genRef.current) setLoading(false);    // only the current generation owns `loading`
    }
  }, [enabled, specKey, authKey, authLoading, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  // spec/auth change → bump generation, reset accumulation, load page 0
  useEffect(() => {
    genRef.current += 1;
    const gen = genRef.current;
    offsetRef.current = 0;
    setRows([]); setHasMore(false);
    if (enabled && spec && isSupabaseReady() && !authLoading) fetchPage(gen);
    else setLoading(false);                             // not fetching → clear any orphaned loading
  }, [specKey, authKey, enabled, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = useCallback(() => {
    if (!hasMore || loading) return;
    fetchPage(genRef.current);
  }, [hasMore, loading, fetchPage]);

  return { rows, hasMore, loading, loadMore };
}

/* The analytics dimension/measure registry — the single source for the Explorer's column
   picker (and any future field-driven UI). Cached process-wide (it's small + static). */
let _analyticsRegistryCache = null;
export function useAnalyticsRegistry() {
  const [reg, setReg] = useState(_analyticsRegistryCache || { dimensions: [], measures: [] });
  const [loading, setLoading] = useState(!_analyticsRegistryCache);
  useEffect(() => {
    if (_analyticsRegistryCache) { setReg(_analyticsRegistryCache); setLoading(false); return; }
    if (!isSupabaseReady()) { setLoading(false); return; }
    let cancelled = false;
    sbRead(supabaseData.rpc("analytics_registry")).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) { console.error("[useAnalyticsRegistry]", error); setLoading(false); return; }
      _analyticsRegistryCache = data;
      setReg(data); setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);
  return { dimensions: reg.dimensions || [], measures: reg.measures || [], loading };
}

// ── Data freshness (2026-06-25) ────────────────────────────────────────────
// "Dáta aktualizované DD.M.YYYY" per country — the latest APPROVED snapshot date
// (public.market_freshness). Snapshots approve all-or-nothing, so when a market's
// batch is stuck (a project can't scrape) this date stops advancing for that
// market — the visible "this batch needs fixing" signal, never silently mixing
// fresh + stale data. The "All" view shows the OLDEST market date (the combined
// view is only as fresh as its stalest market).
let _freshness = null;            // { SK: 'YYYY-MM-DD', CZ: '…' }
let _freshnessPromise = null;
function _loadFreshness() {
  if (_freshness) return Promise.resolve(_freshness);
  if (_freshnessPromise) return _freshnessPromise;
  _freshnessPromise = supabasePublic.from("market_freshness").select("country,last_data_date")
    .then(({ data }) => {
      const m = {};
      (data || []).forEach((r) => { if (r.country) m[r.country] = r.last_data_date; });
      _freshness = m;
      return m;
    })
    .catch(() => ({}));
  return _freshnessPromise;
}
function _freshnessForView(country, m) {
  if (!m || !Object.keys(m).length) return null;
  if (isAllCountries(country)) {
    const dates = Object.values(m).filter(Boolean).sort();   // ISO dates sort chronologically
    return dates[0] || null;                                 // oldest = honest combined freshness
  }
  return m[country] || null;
}

/** Latest data date ('YYYY-MM-DD') for the selected country (the oldest market
 *  for the "All" view), or null while loading. Drives the freshness indicator. */
export function useFreshness() {
  const { country } = useCountry();
  const [date, setDate] = useState(() => _freshnessForView(country, _freshness));
  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseReady()) return;
    _loadFreshness().then((m) => { if (!cancelled) setDate(_freshnessForView(country, m)); });
    return () => { cancelled = true; };
  }, [country]);
  return date;
}
