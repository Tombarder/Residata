/**
 * useDashboardConfig — load + persist the logged-in user's personalized
 * dashboard layout.
 *
 * Storage: public.user_dashboards (one row per user, RLS own-row only —
 * migration v2/migrations/2026-07-07_user_dashboards.sql in the scraper repo).
 * The whole dashboard is one versioned JSONB `config` blob:
 *
 *   {
 *     version: 1,
 *     overview: { area: null | { district, city } },   // top KPI-strip scope
 *     widgets:  [ { id, type, w, cfg } ]               // modular cards
 *   }
 *
 * The customer's choices persist FOREVER until they change/delete them — every
 * mutation goes through setConfig(), which optimistically updates local state and
 * debounces an upsert to the DB. A brand-new user (no row yet) gets a sensible
 * starter layout so the dashboard is valuable on first open; their first edit
 * inserts the row.
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { useAuth } from "./useAuth";
import { supabase, supabaseData } from "./supabase";

export const DASHBOARD_VERSION = 1;

// A fresh id for a widget instance. crypto.randomUUID is available in every
// browser we support; the fallback keeps it from throwing in exotic contexts.
export function newWidgetId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return "w_" + crypto.randomUUID().slice(0, 8);
  } catch (_) { /* fall through */ }
  return "w_" + Math.random().toString(36).slice(2, 10);
}

/**
 * Starter dashboard for a first-time customer — immediately useful (competitive
 * pulse + pricing benchmark), plus room they'll obviously want to personalize.
 */
export function defaultConfig() {
  return {
    version: DASHBOARD_VERSION,
    overview: { filters: [] },
    widgets: [
      { id: newWidgetId(), type: "ranking",   w: 1, cfg: { entity: "projects", metric: "sold30",    dir: "top", n: 5 } },
      { id: newWidgetId(), type: "benchmark",  w: 1, cfg: { by: "district", metric: "avg_m2", n: 8 } },
      { id: newWidgetId(), type: "ranking",   w: 1, cfg: { entity: "projects", metric: "available", dir: "top", n: 5 } },
      { id: newWidgetId(), type: "metric",     w: 1, cfg: { metric: "inventory", scope: { kind: "market" } } },
    ],
  };
}

// Normalize / forward-migrate a stored config so an older or partial blob never
// crashes the renderer. Unknown future versions are trusted as-is (newest client
// wrote them); missing pieces are backfilled.
function normalize(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.widgets)) return defaultConfig();
  return {
    version: raw.version || DASHBOARD_VERSION,
    // Persist the Market-Overview filter conditions. Re-id each on load with an
    // "f…" prefix so they can never collide with the shared MapFilterBuilder's
    // per-session "cN" counter ids (which reset to c1 every page load).
    overview: {
      filters: Array.isArray(raw.overview?.filters)
        ? raw.overview.filters.map(c => ({ ...c, id: "f" + Math.random().toString(36).slice(2, 9) }))
        : [],
    },
    widgets: raw.widgets
      .filter(w => w && typeof w === "object" && typeof w.type === "string")
      .map(w => ({
        id: w.id || newWidgetId(),
        type: w.type,
        w: w.w === 2 ? 2 : 1,
        cfg: w.cfg && typeof w.cfg === "object" ? w.cfg : {},
      })),
  };
}

export function useDashboardConfig() {
  const { user } = useAuth();
  const [config, setConfigState] = useState(null);
  const [loading, setLoading] = useState(true);
  // idle | saving | saved | error — surfaced as a tiny status pill.
  const [saveState, setSaveState] = useState("idle");
  const saveTimer = useRef(null);
  const savedTimer = useRef(null);
  // True ONLY after a load that actually succeeded (error === null, incl. the
  // genuine new-user data === null case). The debounced upsert is hard-gated on
  // this so a transient READ failure — which would otherwise show defaultConfig —
  // can never be persisted over the user's real saved layout.
  const loadedOkRef = useRef(false);
  const [loadError, setLoadError] = useState(false);

  // Load the user's row once auth resolves. Anon (shouldn't reach here — the
  // dashboard is behind auth) falls back to the default in-memory only.
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError(false); loadedOkRef.current = false;
    if (!user) { setConfigState(defaultConfig()); setLoading(false); return; }
    // Read via supabaseData (no getSession on the path → the dashboard can never
    // hang on "loading"). The debounced upsert below stays on the auth client.
    supabaseData.from("user_dashboards").select("config").eq("user_id", user.id).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // Real read failure — DON'T persist. Render the default so the page
          // isn't blank, but keep loadedOkRef false so no edit can overwrite the
          // (unloaded) saved layout, and surface an error for a retry affordance.
          console.error("[useDashboardConfig] load", error);
          setLoadError(true);
          setConfigState(defaultConfig());
          setLoading(false);
          return;
        }
        loadedOkRef.current = true;            // success (incl. new user: data === null)
        setConfigState(normalize(data?.config));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.id]);

  // Every mutation flows through here: optimistic local update + debounced upsert.
  const setConfig = useCallback((next) => {
    const value = typeof next === "function" ? next : () => next;
    setConfigState(prev => {
      const resolved = value(prev || defaultConfig());
      // Persist (debounced) — skip if anon, or if the initial load hasn't
      // SUCCEEDED yet (a failed load must never let an edit overwrite the real
      // saved layout with the default shown as a fallback).
      if (user && loadedOkRef.current) {
        setSaveState("saving");
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
          const { error } = await supabase.from("user_dashboards").upsert(
            { user_id: user.id, config: resolved, updated_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
          if (error) { console.error("[useDashboardConfig] save", error); setSaveState("error"); return; }
          setSaveState("saved");
          clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setSaveState("idle"), 1600);
        }, 600);
      }
      return resolved;
    });
  }, [user?.id]);

  useEffect(() => () => { clearTimeout(saveTimer.current); clearTimeout(savedTimer.current); }, []);

  const resetToDefault = useCallback(() => setConfig(defaultConfig()), [setConfig]);

  return { config, loading, loadError, saveState, setConfig, resetToDefault };
}
