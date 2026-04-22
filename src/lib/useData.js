import { useEffect, useState } from "react";
import { supabase, isSupabaseReady } from "./supabase";

/**
 * Module-level caches for data that's safe to share across components.
 *
 * Problem this solves: the app's top-level layout remounts on every route
 * change (for the page-fade animation), which blows away every hook's
 * useState including useProjects / useMetrics. On each navigation the user
 * would see a brief "0 projects / 0 units / €— / 0 sold" flash while the
 * refetch was in flight — a "zeros on nav" bug.
 *
 * Now: first load populates the cache, subsequent mounts get the cached
 * data as their initial state immediately. A background refetch still fires
 * so the data stays fresh; the user never sees zeros unless the app is
 * genuinely on its very first load this session.
 */
let _projectsCache = null;
let _metricsCache = null;

/** Live metrics for the ticker (KPI strip). */
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

/** Project list. Anon gets ~top 20 (if limit requested), logged-in gets all. */
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

/** Units (flats) for one project — gated by RLS on the flats table. */
export function useProjectFlats(projectId) {
  const [flats, setFlats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!isSupabaseReady() || !projectId) { setLoading(false); return; }
    setLoading(true);
    let cancelled = false;

    const fetchFlats = async () => {
      return supabase.from("flats")
        .select("*").eq("project_id", projectId)
        .order("poschodie", { ascending: true });
    };

    (async () => {
      // Make sure the supabase client has a current session before firing
      // any RLS-gated read. getSession is a pure local read; if the access
      // token is close to expiry we actively refresh. Without this, a
      // freshly-mounted ProjectDetail (the user clicks a project right
      // after page load) can fire the flats query before the token has
      // been attached to the supabase client, and RLS treats the user as
      // anonymous. Real-world symptom: "No data available" on the first
      // click; the second click works.
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const expSoon = session.expires_at && (session.expires_at * 1000) < Date.now() + 120000;
          if (expSoon) await supabase.auth.refreshSession();
        }
      } catch { /* ignore — we'll still attempt the fetch */ }

      if (cancelled) return;
      let { data, error: err } = await fetchFlats();
      if (cancelled) return;

      // Empty result with no error could be a) no flats in DB (edge case
      // since project shows unit count) or b) RLS evaluated the caller as
      // unauthenticated. Retry once with an explicit session refresh to
      // rule out (b).
      if ((!data || data.length === 0) && !err) {
        try { await supabase.auth.refreshSession(); } catch { /* ignore */ }
        if (cancelled) return;
        const retry = await fetchFlats();
        if (cancelled) return;
        data = retry.data;
        err = retry.error;
      }

      setFlats(data || []);
      setError(err);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [projectId]);
  return { flats, loading, error };
}

/** Monthly project snapshots — full time-series of the projects table.
 *  One row per project per snapshot_month ('YYYY-MM'). New months appear
 *  automatically on every sync_to_supabase run. The Analytics pivot reads
 *  from here so the user can filter / group by month too.
 */
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

/** Early access slot count for the marketing badge. */
export function useEarlyAccessStats() {
  const [stats, setStats] = useState({ paid_count: 0, remaining_slots: 9 });
  useEffect(() => {
    if (!isSupabaseReady()) return;
    supabase.from("early_access_stats").select("*").maybeSingle()
      .then(({ data }) => data && setStats(data));
  }, []);
  return stats;
}
