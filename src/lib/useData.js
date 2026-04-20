import { useEffect, useState } from "react";
import { supabase, isSupabaseReady } from "./supabase";

/** Načíta pole metrík pre ticker (zoradené podľa display_order). */
export function useMetrics() {
  const [metrics, setMetrics] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    supabase.from("metrics").select("*").order("display_order", { ascending: true })
      .then(({ data }) => { setMetrics(data || []); setLoading(false); });
  }, []);
  return { metrics, loading };
}

/** Zoznam projektov. Pre anon: prvých 20 (top). Pre authenticated: všetky. */
export function useProjects(limit) {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!isSupabaseReady()) { setLoading(false); return; }
    let q = supabase.from("projects").select("*");
    if (limit) q = q.eq("is_top20", true).limit(limit);
    q.order("available_units", { ascending: false }).then(({ data }) => {
      setProjects(data || []);
      setLoading(false);
    });
  }, [limit]);
  return { projects, loading };
}

/** Byty jedného projektu — gated cez RLS (user musí mať prístup). */
export function useProjectFlats(projectId) {
  const [flats, setFlats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!isSupabaseReady() || !projectId) { setLoading(false); return; }
    setLoading(true);
    supabase.from("flats").select("*").eq("project_id", projectId).order("poschodie", { ascending: true })
      .then(({ data, error }) => {
        setFlats(data || []);
        setError(error);
        setLoading(false);
      });
  }, [projectId]);
  return { flats, loading, error };
}

/** Early access počet zostávajúcich miest z 9. */
export function useEarlyAccessStats() {
  const [stats, setStats] = useState({ paid_count: 0, remaining_slots: 9 });
  useEffect(() => {
    if (!isSupabaseReady()) return;
    supabase.from("early_access_stats").select("*").maybeSingle()
      .then(({ data }) => data && setStats(data));
  }, []);
  return stats;
}
