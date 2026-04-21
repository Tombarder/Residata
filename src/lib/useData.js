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
    // Pre-warm auth session — ensures access_token is attached to the REST
    // call. Without this, a freshly-mounted component whose parent just
    // hydrated the session can fire the query before the token is wired in,
    // causing RLS to treat the user as anon and return zero rows silently.
    (async () => {
      try { await supabase.auth.getSession(); } catch { /* ignore */ }
      const { data, error } = await supabase.from("flats")
        .select("*").eq("project_id", projectId)
        .order("poschodie", { ascending: true });
      setFlats(data || []);
      setError(error);
      setLoading(false);
    })();
  }, [projectId]);
  return { flats, loading, error };
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
