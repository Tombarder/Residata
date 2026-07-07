/**
 * MapView2 — developer-facing market-intelligence map (Mapa 2).
 *
 * A spatial lens on the same public project aggregates the live map reads
 * (projects_live + project_coords). Built for developers, not home buyers:
 *
 *   · LENS        — what the dots encode: price €/m² · supply · absorption ·
 *                   completion. Colour = the metric (data-driven thirds),
 *                   size = units. Hover a dot for its value; click to open it.
 *   · AREA        — click / drag a point near a site → a radius → the competing
 *                   set is summarised (count, median + range €/m², absorption,
 *                   units, completion mix, top developers, drill-through).
 *   · HONESTY     — ~41% of coords are placeholders (city centroid) and
 *                   completion is known for ~13% of projects, so the UI labels
 *                   coverage and flags approximate locations rather than
 *                   pretending the data is complete.
 *
 * All pure logic lives in ../lib/mapMetrics.js (unit-tested). This file is the
 * MapLibre + React shell.
 */
import { useEffect, useRef, useState, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useProjects } from "../lib/useData";
import { useCountry } from "../lib/useCountry";
import { supabase, supabaseData, supabasePublic, isSupabaseReady } from "../lib/supabase";
import {
  LENSES, COMPLETION, NO_DATA, ppm2Of, metricValue, completionBucket,
  tertiles, colorFor, coverage, circlePolygon, computeCompetitiveSet, computePolygonSet, computeCorridorSet,
  corridorBufferRing, polygonAreaKm2, polylineLengthKm, legendForLens, valueRange, heatWeight, hasPublishedPrice,
  median, percentile, setAbsorptionPct,
} from "../lib/mapMetrics";
import MapFilterBuilder from "../components/MapFilterBuilder";
import Picker from "../components/Picker";
import { applyFilters, describe, isComplete } from "../lib/mapFilters";

const mono = "'JetBrains Mono', monospace";
import { accent as green, orange as amber, dim, text as textLight, border, surfaceDark as bg2 } from "../lib/theme";
const greyPt = "#6b6b76";
const panel = "#141418";

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const FALLBACK_CENTER = [18.5, 48.7];
const FALLBACK_ZOOM = 6.2;

let savedView = null;

// Saved draw-areas persist per-browser (localStorage). Cross-device sync (DB-backed)
// is the next step; this makes a developer's site catchments stick immediately.
const AREAS_KEY = "residata_map_areas_v1";
function loadSavedAreas() { try { return JSON.parse(localStorage.getItem(AREAS_KEY) || "[]"); } catch (_) { return []; } }
function persistSavedAreas(list) { try { localStorage.setItem(AREAS_KEY, JSON.stringify(list)); } catch (_) {} }

const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const fmt = (n) => Number(Math.round(n)).toLocaleString("sk-SK");
const fmtK = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k" : fmt(n));
const pct = (x) => `${Math.round(x * 100)}%`;

function projectProps(p, c, lens, thresholds, heatRange) {
  return {
    id: p.id,
    name: p.name || p.id,
    city: p.city || "",
    district: p.district || "",
    developer: (p.developer || "").trim(),
    ppm2: ppm2Of(p),
    available: Number(p.available_units) || 0,
    total: Number(p.total_units) || 0,
    soldPct: p.sold_percentage == null ? null : Math.round(Number(p.sold_percentage)),
    soldLM: Number(p.sold_last_month) || 0,
    units: Number(p.total_units) || Number(p.available_units) || 0,
    completion: completionBucket(p),
    verified: !!(c && c.verified),
    color: colorFor(p, lens, thresholds),
    w: heatWeight(p, lens, heatRange),
    lng: c.lng, lat: c.lat,
  };
}

function buildFeatures(projects, coords, lens, thresholds, verifiedOnly, heatRange) {
  const feats = [];
  for (const p of projects) {
    const c = coords[p.id];
    if (!c) continue;
    if (verifiedOnly && !c.verified) continue;
    feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: projectProps(p, c, lens, thresholds, heatRange) });
  }
  return { type: "FeatureCollection", features: feats };
}

// Apply the heat/dots view mode to an already-loaded map. Shared by the toggle
// effect and the load handler, so toggling Heat during the load window still takes
// effect. The "off" paint is identical to the points layer's original definition.
function applyHeatMode(map, on) {
  if (!map.getLayer("heat")) return;
  map.setLayoutProperty("heat", "visibility", on ? "visible" : "none");
  map.setPaintProperty("points", "circle-opacity", on ? ["case", ["get", "verified"], 0.32, 0.16] : ["case", ["get", "verified"], 0.92, 0.4]);
  map.setPaintProperty("points", "circle-radius", on
    ? ["interpolate", ["linear"], ["get", "units"], 0, 3, 200, 6, 500, 9]
    : ["interpolate", ["linear"], ["get", "units"], 0, 5, 30, 7, 80, 11, 200, 16, 500, 22]);
}

// Radius slider uses a quadratic mapping (pos 0..1000) so the lower, common range
// gets most of the travel while the slider still reaches 50 km. Rounds to 0.5 km.
const R_MIN = 0.5, R_MAX = 50;
const posToRadius = (pos) => Math.round((R_MIN + (R_MAX - R_MIN) * (pos / 1000) ** 2) * 2) / 2;
const radiusToPos = (r) => Math.round(Math.sqrt(Math.max(0, (r - R_MIN) / (R_MAX - R_MIN))) * 1000);
const RADIUS_PRESETS = [1, 5, 10, 25, 50];

function hoverLabel(props, lens) {
  if (lens === "price")      return props.ppm2 > 0 ? `€${fmt(props.ppm2)}/m²` : "no price";
  if (lens === "supply")     return `${props.available} available`;
  if (lens === "absorption") return props.soldPct == null ? "absorption —" : `${props.soldPct}% sold`;
  if (lens === "momentum")   return props.soldLM > 0 ? `${props.soldLM} sold last mo.` : "no recent sales";
  return COMPLETION[props.completion].label;
}

function showProjectPopup(map, lngLat, props, handlers, popupRef) {
  const el = document.createElement("div");
  el.style.minWidth = "186px";
  const loc = [props.city, props.district].filter(Boolean).join(" · ");
  const price = props.ppm2 > 0 ? `€${fmt(props.ppm2)}/m²` : "—";
  const approx = props.verified ? "" : `<div style="font-size:0.64rem;color:${amber};margin-bottom:6px">◍ approximate location</div>`;
  el.innerHTML =
    `<div style="font-weight:600;font-size:0.92rem;color:${textLight};margin-bottom:2px">${escapeHtml(props.name)}</div>` +
    `<div style="font-size:0.72rem;color:${dim};margin-bottom:6px">${escapeHtml(loc)} · ${escapeHtml(props.developer || "—")}</div>` + approx +
    `<div style="font-family:${mono};font-size:0.72rem;color:${textLight};line-height:1.6">` +
    `<div><span style="color:${dim}">Avg</span> &nbsp;${price}</div>` +
    `<div><span style="color:${dim}">Available</span> &nbsp;${props.available} / ${props.total}</div>` +
    `<div><span style="color:${dim}">Absorbed</span> &nbsp;${props.soldPct == null ? "—" : props.soldPct + "%"}</div></div>` +
    `<div style="display:flex;gap:6px;margin-top:10px">` +
    `<button id="mv2-analyze" style="flex:1;padding:7px 8px;background:transparent;color:${green};border:1px solid ${green};border-radius:6px;font-weight:600;font-size:0.72rem;cursor:pointer">◎ Area</button>` +
    `<button id="mv2-compare" style="flex:1;padding:7px 8px;background:transparent;color:${textLight};border:1px solid ${border};border-radius:6px;font-weight:600;font-size:0.72rem;cursor:pointer">⇄ Compare</button>` +
    `<button id="mv2-open" style="flex:1.3;padding:7px 8px;background:${green};color:#0a0a0b;border:none;border-radius:6px;font-weight:600;font-size:0.72rem;cursor:pointer">Open →</button>` +
    `</div>`;
  const open = el.querySelector("#mv2-open");
  const analyze = el.querySelector("#mv2-analyze");
  const compare = el.querySelector("#mv2-compare");
  if (open) open.onclick = () => handlers.onOpen(props.id);
  if (analyze) analyze.onclick = () => handlers.onAnalyze(props);
  if (compare && handlers.onCompare) compare.onclick = () => handlers.onCompare(props);
  if (popupRef.current) popupRef.current.remove();
  popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "260px", offset: 12 }).setLngLat(lngLat).setDOMContent(el).addTo(map);
}

export default function MapView2({ lang = "en", setCurrent }) {
  const { projects, loading } = useProjects();
  const { country } = useCountry();
  const sk = lang === "sk";

  const [coords, setCoords] = useState(null);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const heatModeRef = useRef(false);
  const featuresRef = useRef({ type: "FeatureCollection", features: [] });
  const setCurrentRef = useRef(setCurrent);
  const countryRef = useRef(country);
  const fitKeyRef = useRef(null);
  const popupRef = useRef(null);
  const hoverPopupRef = useRef(null);
  const markerRef = useRef(null);
  const lensRef = useRef("price");
  const onAnalyzeRef = useRef(() => {});
  const onCompareRef = useRef(() => {});

  const [lens, setLens] = useState("price");
  const [conditions, setConditions] = useState([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [nameQuery, setNameQuery] = useState("");
  const [analysisCenter, setAnalysisCenter] = useState(null);
  const [radiusKm, setRadiusKm] = useState(1.5);
  const verifiedOnly = false; // "precise only" toggle removed — include every located project
  const [showSoldOut, setShowSoldOut] = useState(true); // sold out = no units available
  const [showNoPrice, setShowNoPrice] = useState(true); // projects with no published price
  const [heatMode, setHeatMode] = useState(false); // dots vs heatmap of the active lens
  const [anchorId, setAnchorId] = useState(null); // project an "◎ Area" was opened from → benchmark vs its set
  const [viewBounds, setViewBounds] = useState(null); // current map viewport → the overview reflects only what's on screen
  const [extSet, setExtSet] = useState(null); // {nameSet:Set<normName>, count} handed from a filtered analytics view ("Show on map")

  // ── Compare (separate from Area exploration) ──
  // The user assembles an explicit set of projects — by name search (Picker),
  // by clicking a pin, or by "add all in this area" — and sees them side by side.
  // One can be marked the baseline (yours); the rest show €/m² delta vs it.
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState(() => new Set());
  const [baselineId, setBaselineId] = useState(null);

  // ── Draw an area — polygon OR corridor — feeding the SAME competitive panel ──
  // drawTool: the tool actively adding points (null when idle/finished).
  // pts: in-progress vertices. shape: the finished selection —
  //   {kind:'polygon', ring:[[lng,lat],…]} | {kind:'corridor', line:[[lng,lat],…], widthKm}.
  const [drawTool, setDrawTool] = useState(null);
  const [pts, setPts] = useState([]);
  const [shape, setShape] = useState(null);
  const [corridorKm, setCorridorKm] = useState(0.4);
  const [savedAreas, setSavedAreas] = useState(loadSavedAreas);
  const [showExplainer, setShowExplainer] = useState(() => { try { return localStorage.getItem("residata_map_explainer_hidden") !== "1"; } catch (_) { return true; } });
  const [saving, setSaving] = useState(false);   // inline "name this area" input open
  const [saveName, setSaveName] = useState("");
  const [justSaved, setJustSaved] = useState("");  // the name we just saved (brief ✓ confirmation)
  const [compFilter, setCompFilter] = useState(null); // completion bucket the project list is drilled into (null = all)
  const dismissExplainer = () => { setShowExplainer(false); try { localStorage.setItem("residata_map_explainer_hidden", "1"); } catch (_) {} };
  const reopenExplainer = () => { setShowExplainer(true); try { localStorage.removeItem("residata_map_explainer_hidden"); } catch (_) {} };
  const drawToolRef = useRef(null);
  const ptsRef = useRef([]);
  const corridorKmRef = useRef(0.4);
  const shapeRef = useRef(null);
  const mapClickRef = useRef(() => {});
  const finishRef = useRef(() => {});
  const setVertexRef = useRef(() => {});
  const vertexMarkersRef = useRef([]);
  const draggingRef = useRef(false);

  const startDraw = (kind) => { setAnalysisCenter(null); setAnchorId(null); setShape(null); setPts([]); setDrawTool(kind); };
  const cancelDraw = () => { setPts([]); setDrawTool(null); };
  const undoPt = () => setPts((p) => p.slice(0, -1));
  const clearShape = () => { setShape(null); setPts([]); setDrawTool(null); };
  const finishDraw = () => {
    const p = ptsRef.current, kind = drawToolRef.current;
    if (kind === "polygon" && p.length >= 3) { setShape({ kind: "polygon", ring: [...p, p[0]] }); setPts([]); setDrawTool(null); }
    else if (kind === "corridor" && p.length >= 2) { setShape({ kind: "corridor", line: [...p], widthKm: corridorKmRef.current }); setPts([]); setDrawTool(null); }
  };
  // Move vertex i live — updates the in-progress pts or the finished shape.
  const setVertex = (i, lng, lat) => {
    if (drawToolRef.current) { setPts((p) => p.map((c, k) => (k === i ? [lng, lat] : c))); return; }
    const s = shapeRef.current; if (!s) return;
    if (s.kind === "polygon") { const v = s.ring.slice(0, -1).map((c, k) => (k === i ? [lng, lat] : c)); setShape({ ...s, ring: [...v, v[0]] }); }
    else if (s.kind === "corridor") { setShape({ ...s, line: s.line.map((c, k) => (k === i ? [lng, lat] : c)) }); }
  };
  // Map click: add a vertex (or close the polygon when clicking near its first point); else radius.
  const handleMapClick = (e, map) => {
    if (draggingRef.current) return;
    const tool = drawToolRef.current;
    if (tool) {
      const p = ptsRef.current;
      if (tool === "polygon" && p.length >= 3) {
        const first = map.project(p[0]);
        if (Math.hypot(first.x - e.point.x, first.y - e.point.y) < 12) { finishDraw(); return; }
      }
      setPts((prev) => [...prev, [e.lngLat.lng, e.lngLat.lat]]);
      return;
    }
    const hit = map.queryRenderedFeatures(e.point, { layers: ["points"] });
    if (hit && hit.length) return;
    setAnalysisCenter({ lng: e.lngLat.lng, lat: e.lngLat.lat }); setAnchorId(null);
  };
  // Mirror the latest state + callbacks into refs AFTER commit — never during
  // render (that's the react-hooks/refs anti-pattern and double-runs under
  // StrictMode). The maplibre handlers registered once in the map-init effect
  // read these refs, so they always see the freshest values without
  // re-subscribing. Every read happens inside an async handler, so a one-tick-
  // late ref is never observed.
  useEffect(() => {
    drawToolRef.current = drawTool;
    ptsRef.current = pts;
    corridorKmRef.current = corridorKm;
    shapeRef.current = shape;
    finishRef.current = finishDraw;
    setVertexRef.current = setVertex;
    mapClickRef.current = handleMapClick;
  });
  const setCorridorWidth = (v) => { setCorridorKm(v); setShape((s) => (s && s.kind === "corridor" ? { ...s, widthKm: v } : s)); };
  // Saved areas are DB-backed (public.user_map_areas, RLS per-user → follow the user
  // across devices) with a localStorage cache/fallback so the UI is instant and still
  // works if the DB call fails. persistSavedAreas keeps the cache in sync.
  const setAreas = (next) => { setSavedAreas(next); persistSavedAreas(next); };
  const beginSave = () => { if (!shape) return; setSaveName(""); setSaving(true); };
  const confirmSave = async () => {
    const nm = saveName.trim();
    if (!nm || !shape) { setSaving(false); return; }
    setSaving(false); setSaveName(""); setJustSaved(nm); setTimeout(() => setJustSaved(""), 2600);
    // Optimistic local insert (dedupe by name), then reconcile with the DB row id.
    const localItem = { id: "ls-" + String(Date.now()), name: nm, shape, country };
    setAreas([localItem, ...savedAreas.filter((a) => a.name !== nm)].slice(0, 60));
    if (!isSupabaseReady()) return;
    try {
      await supabase.from("user_map_areas").delete().eq("name", nm); // keep names unique per user
      const { data, error } = await supabase.from("user_map_areas")
        .insert({ name: nm, shape, country }).select("id, name, shape, country").single();
      if (error) throw error;
      setSavedAreas((prev) => { const next = prev.map((a) => (a.id === localItem.id ? { id: data.id, name: data.name, shape: data.shape, country: data.country } : a)); persistSavedAreas(next); return next; });
    } catch (_) { /* keep the localStorage-only copy */ }
  };
  const loadArea = (a) => { setSaving(false); setDrawTool(null); setPts([]); setAnalysisCenter(null); setAnchorId(null); if (a.shape.kind === "corridor") setCorridorKm(a.shape.widthKm); setShape(a.shape); };
  const deleteArea = async (id) => {
    setSavedAreas((prev) => { const next = prev.filter((a) => a.id !== id); persistSavedAreas(next); return next; });
    if (isSupabaseReady() && !String(id).startsWith("ls-")) { try { await supabase.from("user_map_areas").delete().eq("id", id); } catch (_) {} }
  };
  // On mount: pull the user's saved areas from the DB (source of truth, follows them
  // across devices). The localStorage cache seeds the initial state for an instant paint.
  // One-time migration: any area that lives only in this browser's cache (saved before
  // the DB feature existed) is pushed into the DB so it follows the user from now on.
  // If the DB is unreachable, the cache stays untouched.
  useEffect(() => {
    if (!isSupabaseReady()) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabaseData.from("user_map_areas")
          .select("id, name, shape, country").order("created_at", { ascending: false });
        if (error) throw error;
        const dbAreas = (data || []).map((r) => ({ id: r.id, name: r.name, shape: r.shape, country: r.country }));
        const dbNames = new Set(dbAreas.map((a) => a.name));
        const toMigrate = loadSavedAreas().filter((a) => a && a.shape && a.name && !dbNames.has(a.name));
        let merged = dbAreas;
        if (toMigrate.length) {
          const { data: ins } = await supabase.from("user_map_areas")
            .insert(toMigrate.map((a) => ({ name: a.name, shape: a.shape, country: a.country })))
            .select("id, name, shape, country");
          if (Array.isArray(ins)) merged = [...ins.map((r) => ({ id: r.id, name: r.name, shape: r.shape, country: r.country })), ...dbAreas];
        }
        if (!cancelled) setAreas(merged);
      } catch (_) { /* keep the localStorage cache */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // On mount, consume a project set handed over from a filtered analytics view (Unit Explorer's
  // "Show on map"). Restricts the map to exactly those projects until cleared. Consume-once.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("residata.mapProjectSet");
      if (!raw) return;
      sessionStorage.removeItem("residata.mapProjectSet");
      const parsed = JSON.parse(raw);
      const names = (parsed && parsed.names) || [];
      if (names.length) setExtSet({ nameSet: new Set(names.map(norm)), count: names.length });
    } catch { /* ignore malformed handoff */ }
  }, []);

  useEffect(() => { setCurrentRef.current = setCurrent; }, [setCurrent]);
  useEffect(() => { countryRef.current = country; }, [country]);
  useEffect(() => { lensRef.current = lens; }, [lens]);
  useEffect(() => { onAnalyzeRef.current = (p) => { setAnalysisCenter({ lng: p.lng, lat: p.lat }); setAnchorId(p.id || null); }; }, []);

  // ── Coordinates (public, with verified flag) ──
  useEffect(() => {
    if (!isSupabaseReady() || !supabasePublic) { setCoords({}); return; }
    let cancelled = false;
    supabasePublic.from("project_coords").select("id,lat,lng,location_verified").then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.error("[project_coords]", error); setCoords({}); return; }
      const m = {};
      (data || []).forEach((r) => { if (r.lat != null && r.lng != null) m[r.id] = { lat: Number(r.lat), lng: Number(r.lng), verified: r.location_verified }; });
      setCoords(m);
    });
    return () => { cancelled = true; };
  }, []);

  // Base set = name search + the filter builder. The sold-out toggle then trims
  // it; we keep the base so we can show how many sold-out it would hide.
  const baseSet = useMemo(() => {
    const q = norm(nameQuery);
    let named = q ? (projects || []).filter((p) => norm(p.name).includes(q)) : (projects || []);
    if (extSet) named = named.filter((p) => extSet.nameSet.has(norm(p.name)));
    return applyFilters(named, conditions);
  }, [projects, nameQuery, conditions, extSet]);
  const soldOutCount = useMemo(() => baseSet.filter((p) => (Number(p.available_units) || 0) === 0).length, [baseSet]);
  const noPriceCount = useMemo(() => baseSet.filter((p) => !hasPublishedPrice(p)).length, [baseSet]);
  const shown = useMemo(() => {
    let s = baseSet;
    if (!showSoldOut) s = s.filter((p) => (Number(p.available_units) || 0) > 0);
    if (!showNoPrice) s = s.filter(hasPublishedPrice);
    return s;
  }, [baseSet, showSoldOut, showNoPrice]);
  const activeConds = useMemo(() => conditions.filter(isComplete), [conditions]);

  // Projects currently on screen = filters ∩ the map viewport. The overview reads
  // ONLY these, so panning / zooming / filtering all recompute it live.
  const inView = useMemo(() => {
    if (!coords) return [];
    const placed = shown.filter((p) => coords[p.id]);
    if (!viewBounds) return placed;
    const { w, s, e, n } = viewBounds;
    return placed.filter((p) => { const c = coords[p.id]; return c.lng >= w && c.lng <= e && c.lat >= s && c.lat <= n; });
  }, [shown, coords, viewBounds]);

  const thresholds = useMemo(() => (lens === "completion" ? null : tertiles(shown.map((p) => metricValue(p, lens)))), [shown, lens]);
  const heatRange = useMemo(() => valueRange(shown, lens), [shown, lens]);
  const lensCoverage = useMemo(() => coverage(inView, lens), [inView, lens]);
  const fc = useMemo(() => buildFeatures(shown, coords || {}, lens, thresholds, verifiedOnly, heatRange), [shown, coords, lens, thresholds, verifiedOnly, heatRange]);
  useEffect(() => { featuresRef.current = fc; }, [fc]);

  // Market overview for the projects in view — drives the adaptive header.
  const marketStats = useMemo(() => {
    const priced = inView.map(ppm2Of).filter((v) => v > 0).sort((a, b) => a - b);
    const at = (q) => percentile(priced, q); // canonical percentile (shared w/ competitive panel)
    const med = median(priced);              // canonical median (shared w/ competitive panel + analytics)
    const sum = (f) => inView.reduce((s, p) => s + (Number(f(p)) || 0), 0);
    const available = sum((p) => p.available_units);
    const reserved = sum((p) => (Number(p.reserved_units) || 0) + (Number(p.prereserved_units) || 0));
    const sold = sum((p) => p.sold_units);
    const invTotal = available + reserved + sold;
    // Price histogram clamped to the 2nd–98th percentile so a few outliers don't flatten it.
    const N = 18, hist = new Array(N).fill(0);
    const hLo = at(0.02), hHi = at(0.98);
    if (priced.length >= 5 && hHi > hLo) {
      const span = hHi - hLo;
      priced.forEach((v) => { hist[Math.min(N - 1, Math.max(0, Math.floor(((v - hLo) / span) * N)))]++; });
    }
    const comp = { ready: 0, soon: 0, mid: 0, far: 0, unknown: 0 };
    inView.forEach((p) => { comp[completionBucket(p)]++; });
    const soldLM = sum((p) => p.sold_last_month);
    const moving = inView.filter((p) => (Number(p.sold_last_month) || 0) > 0).length;
    return {
      count: inView.length, med, pMin: priced[0] ?? null, pMax: priced[priced.length - 1] ?? null,
      hLo, hHi, hist, units: sum((p) => p.total_units), available, reserved, sold, invTotal,
      soldPct: setAbsorptionPct(inView), soldLM, moving, comp,
    };
  }, [inView]);

  const compSet = useMemo(() => {
    if (shape && shape.kind === "polygon") return computePolygonSet(shown, coords, shape.ring, verifiedOnly);
    if (shape && shape.kind === "corridor") return computeCorridorSet(shown, coords, shape.line, shape.widthKm, verifiedOnly);
    return computeCompetitiveSet(shown, coords, analysisCenter, radiusKm, verifiedOnly);
  }, [shown, coords, shape, analysisCenter, radiusKm, verifiedOnly]);
  const selection = shape || analysisCenter; // panel shows for radius OR a drawn shape
  // Reset the completion drill-down whenever the selection TYPE changes (new area /
  // switch radius↔polygon↔corridor / cleared) — but not on every vertex drag.
  const selKey = selection ? (shape ? shape.kind : "radius") : "none";
  useEffect(() => { setCompFilter(null); }, [selKey]);
  // Size readout for the drawn selection.
  const shapeSize = useMemo(() => {
    if (!shape) return null;
    if (shape.kind === "polygon") { const km2 = polygonAreaKm2(shape.ring); return { km2, label: `${km2 < 1 ? km2.toFixed(2) : km2.toFixed(1)} km²` }; }
    const len = polylineLengthKm(shape.line);
    return { km2: len * shape.widthKm * 2, label: `${len.toFixed(1)} km × ${Math.round(shape.widthKm * 1000)} m` };
  }, [shape]);
  const anchor = useMemo(() => (anchorId ? shown.find((p) => p.id === anchorId) : null), [anchorId, shown]);

  // ── Compare data + actions ──
  // Options for the manual "add project" multi-select (every project, by name).
  const projectOptions = useMemo(
    () => (projects || []).map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [projects],
  );
  const projectById = useMemo(() => { const m = new Map(); (projects || []).forEach((p) => m.set(p.id, p)); return m; }, [projects]);
  // The compared projects (resolved from ALL projects, so a lens/filter never
  // drops one you explicitly picked). Missing ids (e.g. other country) are skipped.
  const compareProjects = useMemo(
    () => [...compareIds].map((id) => projectById.get(id)).filter(Boolean),
    [compareIds, projectById],
  );
  // Wire the pin-popup "⇄ Compare" button → add that project + open compare mode.
  useEffect(() => {
    onCompareRef.current = (p) => {
      if (!p || !p.id) return;
      setCompareIds((prev) => { const n = new Set(prev); n.add(p.id); return n; });
      setCompareMode(true);
    };
  }, []);
  const removeCompare = (id) => {
    setCompareIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setBaselineId((b) => (b === id ? null : b));
  };
  const clearCompare = () => { setCompareIds(new Set()); setBaselineId(null); };
  const setBaseline = (id) => setBaselineId((b) => (b === id ? null : id));
  const addAreaToCompare = () => {
    if (!compSet || !compSet.inside.length) return;
    setCompareIds((prev) => { const n = new Set(prev); compSet.inside.forEach((p) => n.add(p.id)); return n; });
  };

  // Zoom/pan the map so the whole analysis circle fits (used by the radius presets
  // and on slider release) — otherwise a 50 km radius would run off-screen.
  const fitToRadius = (r) => {
    const map = mapRef.current, c = analysisCenter;
    if (!map || !c) return;
    const dLat = r / 110.574, dLng = r / (111.32 * Math.cos((c.lat * Math.PI) / 180));
    map.fitBounds([[c.lng - dLng, c.lat - dLat], [c.lng + dLng, c.lat + dLat]], { padding: 56, duration: 500, maxZoom: 15 });
  };

  function fitToData(map, data, animate) {
    if (!data.features.length) { map.jumpTo({ center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM }); return; }
    const b = new maplibregl.LngLatBounds();
    data.features.forEach((f) => b.extend(f.geometry.coordinates));
    if (!b.isEmpty()) map.fitBounds(b, { padding: 70, maxZoom: 13, duration: animate ? 600 : 0 });
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const hadSaved = savedView != null;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: hadSaved ? savedView.center : FALLBACK_CENTER, zoom: hadSaved ? savedView.zoom : FALLBACK_ZOOM, attributionControl: true });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("moveend", () => {
      savedView = { center: map.getCenter().toArray(), zoom: map.getZoom() };
      const b = map.getBounds();
      setViewBounds({ w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() });
    });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);

    map.on("load", () => {
      if (mapRef.current !== map) return;
      map.addSource("radius", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": green, "fill-opacity": 0.07 } });
      map.addLayer({ id: "radius-line", type: "line", source: "radius", paint: { "line-color": green, "line-width": 1.5, "line-dasharray": [2, 2] } });

      // Hand-drawn polygon (in-progress line + vertices, or the finished area).
      map.addSource("draw", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "draw-fill", type: "fill", source: "draw", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": amber, "fill-opacity": 0.10 } });
      map.addLayer({ id: "draw-line", type: "line", source: "draw", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": amber, "line-width": 2 } });
      map.addLayer({ id: "draw-vertex", type: "circle", source: "draw", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": amber, "circle-stroke-width": 2, "circle-stroke-color": "#0a0a0b" } });

      map.addSource("projects", { type: "geojson", data: featuresRef.current });
      // Heatmap of the active lens (hidden until "Heat" is toggled). Weight = how
      // "hot" each project is on the active metric (heatWeight, 0..1).
      map.addLayer({
        id: "heat", type: "heatmap", source: "projects", layout: { visibility: "none" },
        paint: {
          "heatmap-weight": ["get", "w"],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 6, 1, 13, 3],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 6, 16, 11, 32, 14, 52],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.9, 14, 0.5],
          "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(0,0,0,0)", 0.15, "rgba(43,76,155,0.5)", 0.4, "#3aa0ff", 0.62, "#f5a623", 0.82, "#ff7a3d", 1, "#ff3d3d"],
        },
      });
      map.addLayer({
        id: "points", type: "circle", source: "projects",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["interpolate", ["linear"], ["get", "units"], 0, 5, 30, 7, 80, 11, 200, 16, 500, 22],
          // Placeholder-located projects are rendered faded so verified ones lead the eye.
          "circle-opacity": ["case", ["get", "verified"], 0.92, 0.4],
          "circle-stroke-width": 1.2,
          "circle-stroke-color": ["case", ["get", "verified"], "#0a0a0b", amber],
        },
      });

      readyRef.current = true;
      if (heatModeRef.current) applyHeatMode(map, true);
      if (hadSaved) fitKeyRef.current = countryRef.current;
      else if (featuresRef.current.features.length) { fitToData(map, featuresRef.current, false); fitKeyRef.current = countryRef.current; }

      hoverPopupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: "mv2-hover" });
      map.on("mousemove", "points", (e) => {
        if (drawToolRef.current) return; // no hover popups while drawing an area
        const f = e.features[0]; const p = f.properties;
        map.getCanvas().style.cursor = "pointer";
        hoverPopupRef.current.setLngLat(f.geometry.coordinates)
          .setHTML(`<div style="font-weight:600;font-size:0.76rem;color:${textLight}">${escapeHtml(p.name)}</div><div style="font-size:0.7rem;color:${dim};font-family:${mono}">${escapeHtml(hoverLabel(p, lensRef.current))}</div>`)
          .addTo(map);
      });
      map.on("mouseleave", "points", () => { map.getCanvas().style.cursor = ""; if (hoverPopupRef.current) hoverPopupRef.current.remove(); });

      map.on("click", "points", (e) => {
        if (drawToolRef.current) return; // clicking a pin while drawing just drops a vertex (handled below)
        if (hoverPopupRef.current) hoverPopupRef.current.remove();
        const f = e.features[0];
        showProjectPopup(map, f.geometry.coordinates, f.properties, {
          onOpen: (id) => setCurrentRef.current && setCurrentRef.current("App:ProjectDetail:" + id),
          onAnalyze: (ll) => onAnalyzeRef.current(ll),
          onCompare: (p) => onCompareRef.current(p),
        }, popupRef);
      });
      map.on("click", (e) => mapClickRef.current(e, map));
      map.on("dblclick", (e) => {
        if (!drawToolRef.current) return;
        e.preventDefault(); // don't zoom — finish the polygon instead
        finishRef.current();
      });
    });

    return () => {
      if (ro) ro.disconnect();
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
      vertexMarkersRef.current.forEach((m) => m.remove()); vertexMarkersRef.current = [];
      map.remove(); mapRef.current = null; readyRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("projects");
    if (src) src.setData(fc);
    if (fc.features.length && fitKeyRef.current !== country) { fitToData(map, fc, fitKeyRef.current !== null); fitKeyRef.current = country; }
  }, [fc, country]);

  // ── Heat vs dots ── show the heatmap and fade the dots (still clickable) ──
  useEffect(() => {
    heatModeRef.current = heatMode;
    const map = mapRef.current;
    if (!map || !readyRef.current || !map.getLayer("heat")) return;
    applyHeatMode(map, heatMode);
  }, [heatMode]);

  // Radius ring + draggable analysis marker.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("radius");
    if (analysisCenter) {
      if (src) src.setData(circlePolygon(analysisCenter, radiusKm));
      if (!markerRef.current) {
        const el = document.createElement("div");
        el.style.cssText = `width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${green};border:2px solid #0a0a0b;box-shadow:0 0 0 2px ${green}55;cursor:grab`;
        const mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([analysisCenter.lng, analysisCenter.lat]).addTo(map);
        mk.on("dragend", () => { const ll = mk.getLngLat(); setAnalysisCenter({ lng: ll.lng, lat: ll.lat }); setAnchorId(null); });
        markerRef.current = mk;
      } else {
        markerRef.current.setLngLat([analysisCenter.lng, analysisCenter.lat]);
      }
    } else {
      if (src) src.setData({ type: "FeatureCollection", features: [] });
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    }
  }, [analysisCenter, radiusKm]);

  // Render the finished shape (polygon fill / corridor buffer + centerline) or the
  // in-progress geometry into the "draw" source. Vertices are draggable Markers (below).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("draw");
    if (!src) return;
    const poly = (ring) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} });
    const line = (cs) => ({ type: "Feature", geometry: { type: "LineString", coordinates: cs }, properties: {} });
    const features = [];
    if (shape) {
      if (shape.kind === "polygon") features.push(poly(shape.ring));
      else { const buf = corridorBufferRing(shape.line, shape.widthKm); if (buf) features.push(poly(buf)); features.push(line(shape.line)); }
    } else if (pts.length) {
      if (drawTool === "corridor" && pts.length >= 2) { const buf = corridorBufferRing(pts, corridorKm); if (buf) features.push(poly(buf)); }
      if (pts.length >= 2) features.push(line(pts));
    }
    src.setData({ type: "FeatureCollection", features });
  }, [pts, shape, drawTool, corridorKm]);

  // Draggable vertex handles for the active geometry (in-progress pts or finished shape).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const verts = drawTool ? pts : (shape ? (shape.kind === "polygon" ? shape.ring.slice(0, -1) : shape.line) : []);
    const arr = vertexMarkersRef.current;
    while (arr.length > verts.length) { const m = arr.pop(); m.remove(); }
    while (arr.length < verts.length) {
      const el = document.createElement("div");
      el.style.cssText = `width:13px;height:13px;border-radius:50%;background:${amber};border:2px solid #0a0a0b;cursor:grab;box-shadow:0 0 0 2px ${amber}66`;
      const mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([0, 0]).addTo(map);
      mk.on("dragstart", () => { draggingRef.current = true; });
      mk.on("drag", () => { const ll = mk.getLngLat(); setVertexRef.current(mk.__i, ll.lng, ll.lat); });
      mk.on("dragend", () => { setTimeout(() => { draggingRef.current = false; }, 60); });
      arr.push(mk);
    }
    verts.forEach((c, i) => { arr[i].__i = i; arr[i].setLngLat(c); });
  }, [pts, shape, drawTool]);

  // Draw mode: crosshair cursor + suppress double-click-zoom (dblclick finishes the shape).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    if (drawTool) { map.doubleClickZoom.disable(); map.getCanvas().style.cursor = "crosshair"; }
    else { map.doubleClickZoom.enable(); map.getCanvas().style.cursor = ""; }
  }, [drawTool]);

  // Keyboard: Esc cancels an in-progress draw, Backspace removes the last point.
  useEffect(() => {
    if (!drawTool) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); cancelDraw(); }
      else if (e.key === "Backspace") { e.preventDefault(); undoPt(); }
      else if (e.key === "Enter") { e.preventDefault(); finishRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawTool]);

  const firstCountry = useRef(true);
  useEffect(() => {
    if (firstCountry.current) { firstCountry.current = false; return; }
    setConditions([]); setNameQuery(""); setAnalysisCenter(null); setAnchorId(null); setExtSet(null); setShape(null); setPts([]); setDrawTool(null);
  }, [country]);

  const openProject = (id) => setCurrentRef.current && setCurrentRef.current("App:ProjectDetail:" + id);
  const isLoading = loading || coords === null;
  const legend = legendForLens(lens, thresholds, fmt);

  // ── Completion drill-down helpers ──
  const COMP_LABEL = sk
    ? { ready: "hotové", soon: "o rok", mid: "o 2 roky", far: "neskôr", unknown: "neznáme" }
    : { ready: "ready", soon: "+1 yr", mid: "+2 yrs", far: "later", unknown: "unknown" };
  // "When it completes" for a project row: a year, "hotové/done", or null (unknown).
  const completionWhen = (p) => {
    const k = (p.kolaudacia || "").toString().trim();
    if (!k) return null;
    if (/skolaud|hotov|dokon|nas[ťt]ah|ready|complet|move/i.test(k)) return sk ? "hotové" : "done";
    const m = k.match(/20\d{2}/);
    if (m) return m[0];
    return k.length <= 12 ? k : null;
  };
  // The project list, optionally drilled into one completion bucket.
  const listProjects = compSet ? (compFilter ? compSet.inside.filter((p) => completionBucket(p) === compFilter) : compSet.inside) : [];

  // Saved-areas list — shown in the panel in BOTH the empty and the active state, so
  // after you save an area you immediately see it and can reload it.
  const savedAreasBlock = savedAreas.length > 0 ? (
    <div style={{ marginTop: 14, borderTop: `1px solid ${border}`, paddingTop: 12 }}>
      <div style={{ fontSize: "0.7rem", color: dim, marginBottom: 7 }}>☆ {sk ? "Uložené oblasti" : "Saved areas"} ({savedAreas.length})</div>
      {savedAreas.map((a) => (
        <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
          <button onClick={() => loadArea(a)} title={sk ? "Zobraziť túto oblasť" : "Load this area"} style={{ flex: 1, textAlign: "left", background: "none", border: "none", color: justSaved === a.name ? green : textLight, cursor: "pointer", fontSize: "0.76rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = green)} onMouseLeave={(e) => (e.currentTarget.style.color = justSaved === a.name ? green : textLight)}>
            {a.shape.kind === "polygon" ? "▱" : "⇢"} {a.name}{justSaved === a.name ? " ✓" : ""}{a.country && a.country !== "all" ? <span style={{ color: dim }}> · {String(a.country).toUpperCase()}</span> : ""}
          </button>
          <button onClick={() => deleteArea(a.id)} title={sk ? "Zmazať" : "Delete"} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "0.85rem" }}>✕</button>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div className="mv2-root" style={{ height: "calc(100dvh - 64px)", display: "flex", flexDirection: "column", background: bg2 }}>
      {/* Market overview — lens tabs + adaptive insight */}
      <div style={{ borderBottom: `1px solid ${border}`, background: "#0a0a0b", padding: "0.6rem 1.25rem 0.7rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap", marginBottom: 10 }}>
          <span style={{ fontSize: "0.6rem", color: dim, letterSpacing: "0.12em", textTransform: "uppercase" }}>{sk ? "Trh" : "Market"}</span>
          <div style={{ display: "inline-flex", gap: 3, background: bg2, border: `1px solid ${border}`, borderRadius: 999, padding: 3 }}>
            {LENSES.map((l) => <button key={l.key} onClick={() => setLens(l.key)} style={tabStyle(lens === l.key)} title={l.desc}>{l.label}</button>)}
          </div>
          <button onClick={() => setHeatMode((v) => !v)} style={chipStyle(heatMode)} title={sk ? "Tepelná mapa aktívnej metriky" : "Heatmap of the active metric"}>
            {heatMode ? "◉" : "○"} {sk ? "Teplo" : "Heat"}
          </button>
          <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: dim, fontFamily: mono }}>
            <strong style={{ color: textLight }}>{marketStats.count}</strong> {sk ? "v zábere" : "in view"}
            {marketStats.count === 0 && shown.length > 0
              ? <span style={{ color: amber }}> · {sk ? "oddiaľ pre všetky" : "zoom out for all"}</span>
              : <> · <span style={{ color: lensCoverage < 0.4 ? amber : dim }}>{pct(lensCoverage)} {sk ? "s dátami" : "with data"}</span></>}
          </span>
        </div>
        <MarketInsight lens={lens} stats={marketStats} sk={sk} />
      </div>

      {/* Filter bar + legend */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.55rem 1.25rem", borderBottom: `1px solid ${border}`, background: panel }}>
        <input value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} placeholder={sk ? "Hľadať projekt…" : "Find project…"} style={{ ...inputStyle, flex: "1 1 160px", maxWidth: 220 }} />
        <button onClick={() => setFilterOpen((v) => !v)} style={chipStyle(filterOpen || activeConds.length > 0)}>
          ⚙ {sk ? "Filtre" : "Filters"}{activeConds.length > 0 ? ` · ${activeConds.length}` : ""}
        </button>
        <button onClick={() => (drawTool === "polygon" ? cancelDraw() : startDraw("polygon"))} style={chipStyle(drawTool === "polygon" || shape?.kind === "polygon")} title={sk ? "Nakresli vlastnú oblasť (polygón)" : "Draw a custom area (polygon)"}>
          ▱ {sk ? "Oblasť" : "Area"}
        </button>
        <button onClick={() => (drawTool === "corridor" ? cancelDraw() : startDraw("corridor"))} style={chipStyle(drawTool === "corridor" || shape?.kind === "corridor")} title={sk ? "Nakresli koridor: trasa + šírka (napr. okolo električky)" : "Draw a corridor: a route + width (e.g. along a tram line)"}>
          ⇢ {sk ? "Koridor" : "Corridor"}
        </button>
        <button onClick={() => setCompareMode((v) => !v)} style={chipStyle(compareMode)} title={sk ? "Porovnaj vybrané projekty vedľa seba" : "Compare hand-picked projects side by side"}>
          ⇄ {sk ? "Porovnať" : "Compare"}{compareIds.size ? ` · ${compareIds.size}` : ""}
        </button>
        {!showExplainer && <button onClick={reopenExplainer} title={sk ? "Ako to funguje?" : "How it works?"} style={{ ...chipStyle(false), padding: "6px 10px" }}>?</button>}
        {extSet && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: `${green}22`, color: green, border: `1px solid ${green}`, borderRadius: 999, padding: "4px 10px", fontSize: "0.72rem", fontWeight: 600 }}
            title={sk ? "Zobrazené len projekty vyfiltrované v analytike" : "Showing only the projects filtered in analytics"}>
            🗺 {sk ? `Z analytiky: ${extSet.count} projektov` : `From analytics: ${extSet.count} projects`}
            <span onClick={() => setExtSet(null)} style={{ cursor: "pointer", opacity: 0.8 }} title={sk ? "zrušiť" : "clear"}>✕</span>
          </span>
        )}
        {activeConds.map((c) => (
          <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: `${green}14`, color: green, border: `1px solid ${green}40`, borderRadius: 999, padding: "4px 9px", fontSize: "0.7rem", maxWidth: 250 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{describe(c, sk)}</span>
            <span onClick={() => setConditions((cs) => cs.filter((x) => x.id !== c.id))} style={{ cursor: "pointer", flexShrink: 0 }}>×</span>
          </span>
        ))}
        <button onClick={() => setShowSoldOut((v) => !v)} title={sk ? "Zobraziť / skryť vypredané projekty (bez voľných bytov)" : "Show / hide sold-out projects (no units available)"}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 999, fontSize: "0.74rem", cursor: "pointer", border: `1px solid ${showSoldOut ? border : `${amber}55`}`, background: showSoldOut ? "transparent" : `${amber}14`, color: showSoldOut ? textLight : amber }}>
          <EyeIcon off={!showSoldOut} />
          <span style={{ textDecoration: showSoldOut ? "none" : "line-through" }}>{sk ? "Vypredané" : "Sold out"}</span>
          {soldOutCount > 0 && <span style={{ opacity: 0.7, fontFamily: mono, fontSize: "0.66rem" }}>· {soldOutCount}</span>}
        </button>
        <button onClick={() => setShowNoPrice((v) => !v)} title={sk ? "Zobraziť / skryť projekty bez zverejnenej ceny (počítajú sa do prehľadov len keď sú zapnuté)" : "Show / hide projects with no published price (counted in the stats only while shown)"}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 999, fontSize: "0.74rem", cursor: "pointer", border: `1px solid ${showNoPrice ? border : `${amber}55`}`, background: showNoPrice ? "transparent" : `${amber}14`, color: showNoPrice ? textLight : amber }}>
          <EyeIcon off={!showNoPrice} />
          <span style={{ textDecoration: showNoPrice ? "none" : "line-through" }}>{sk ? "Bez ceny" : "No price"}</span>
          {noPriceCount > 0 && <span style={{ opacity: 0.7, fontFamily: mono, fontSize: "0.66rem" }}>· {noPriceCount}</span>}
        </button>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, marginLeft: "auto", fontSize: "0.66rem", color: dim, flexWrap: "wrap" }}>
          {heatMode
            ? <HeatLegend lens={lens} sk={sk} />
            : legend.map((it) => <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: it.color, display: "inline-block" }} />{it.label}</span>)}
        </div>
      </div>

      {/* Map + competitive panel */}
      <div style={{ position: "relative", flex: 1, minHeight: 360 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

        {filterOpen && (
          <MapFilterBuilder conditions={conditions} setConditions={setConditions} projects={projects || []} matchCount={shown.length} totalCount={(projects || []).length} sk={sk} onClose={() => setFilterOpen(false)} />
        )}

        {drawTool && (() => {
          const minPts = drawTool === "polygon" ? 3 : 2;
          const ok = pts.length >= minPts;
          return (
            <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: "center", maxWidth: "calc(100% - 24px)", background: "rgba(14,14,16,0.96)", border: `1px solid ${amber}88`, color: textLight, fontSize: "0.74rem", padding: "6px 8px 6px 14px", borderRadius: 20 }}>
              {drawTool === "polygon" ? "▱" : "⇢"} {sk
                ? `Klikaj ${drawTool === "polygon" ? "body oblasti" : "body trasy"} (${pts.length}) — ${drawTool === "polygon" ? "dvojklik/prvý bod" : "dvojklik"} ukončí, Esc zruší`
                : `Click ${drawTool === "polygon" ? "area points" : "route points"} (${pts.length}) — ${drawTool === "polygon" ? "double-click/first point" : "double-click"} to finish, Esc to cancel`}
              {drawTool === "corridor" && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: dim }}>{sk ? "šírka" : "width"}</span>
                  <input type="range" min={100} max={2000} step={50} value={Math.round(corridorKm * 1000)} onChange={(e) => setCorridorWidth(Number(e.target.value) / 1000)} style={{ width: 90, accentColor: amber }} />
                  <span style={{ fontFamily: mono, color: textLight }}>{Math.round(corridorKm * 1000)} m</span>
                </span>
              )}
              {pts.length > 0 && <button onClick={undoPt} title={sk ? "Späť (Backspace)" : "Undo (Backspace)"} style={{ background: "none", border: `1px solid ${border}`, color: dim, borderRadius: 6, padding: "3px 8px", fontSize: "0.7rem", cursor: "pointer" }}>↶</button>}
              <button onClick={() => finishRef.current()} disabled={!ok} style={{ background: ok ? amber : "transparent", color: ok ? "#0a0a0b" : dim, border: `1px solid ${amber}`, borderRadius: 6, padding: "3px 11px", fontSize: "0.72rem", fontWeight: 600, cursor: ok ? "pointer" : "default" }}>{sk ? "Hotovo" : "Done"}</button>
              <button onClick={cancelDraw} title={sk ? "Zrušiť" : "Cancel"} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "1rem", lineHeight: 1 }}>✕</button>
            </div>
          );
        })()}

        {(compareMode || selection || showExplainer || savedAreas.length > 0) && (
        <div style={{ position: "absolute", top: 12, left: 12, width: 310, maxWidth: "calc(100% - 24px)", maxHeight: "calc(100% - 24px)", overflowY: "auto", background: "rgba(14,14,16,0.97)", border: `1px solid ${border}`, borderRadius: 12, boxShadow: "0 12px 30px rgba(0,0,0,0.5)", padding: "14px 15px", zIndex: 30 }}>
          {compareMode ? (
            <ComparePanel
              options={projectOptions} compareIds={compareIds} setCompareIds={setCompareIds}
              rows={compareProjects} baselineId={baselineId} setBaseline={setBaseline}
              onRemove={removeCompare} onClear={clearCompare}
              areaCount={compSet ? compSet.inside.length : 0} onAddArea={addAreaToCompare}
              onClose={() => setCompareMode(false)} openProject={openProject}
              completionWhen={completionWhen} coords={coords} sk={sk}
            />
          ) : !selection ? (
            <div style={{ color: dim, fontSize: "0.8rem", lineHeight: 1.5 }}>
              {showExplainer && (
                <div style={{ position: "relative", marginBottom: savedAreasBlock ? 0 : 2 }}>
                  <button onClick={dismissExplainer} title={sk ? "Skryť" : "Hide"} style={{ position: "absolute", top: -4, right: -4, background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "0.95rem", lineHeight: 1 }} aria-label="Hide">✕</button>
                  <div style={{ color: textLight, fontWeight: 700, marginBottom: 4, fontSize: "0.92rem", paddingRight: 16 }}>{sk ? "Prieskum konkurencie v okolí" : "Competition in an area"}</div>
                  <div style={{ marginBottom: 12 }}>
                    {sk
                      ? "Vyber si oblasť na mape a ukážem ti všetky projekty vnútri — medián €/m², vypredanosť, developerov, dokončenie aj celý zoznam."
                      : "Pick an area on the map and I'll summarise every project inside — median €/m², absorption, developers, completion and the full list."}
                  </div>
                  <div style={{ color: dim, fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 7 }}>{sk ? "Ako začať — 3 spôsoby" : "How to start — 3 ways"}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    <div><span style={{ color: green, fontWeight: 600 }}>◎ {sk ? "Klikni na mapu" : "Click the map"}</span><br />{sk ? "okruh okolo bodu — jeho veľkosť si nastavíš posuvníkom." : "a radius around that point — set its size with the slider."}</div>
                    <div><span style={{ color: amber, fontWeight: 600 }}>▱ {sk ? "Oblasť" : "Area"}</span> <span style={{ color: dim }}>({sk ? "tlačidlo hore" : "button above"})</span><br />{sk ? "nakresli vlastný tvar: klikaj rohy, dvojklik ukončí." : "draw a custom shape: click the corners, double-click to finish."}</div>
                    <div><span style={{ color: amber, fontWeight: 600 }}>⇢ {sk ? "Koridor" : "Corridor"}</span> <span style={{ color: dim }}>({sk ? "tlačidlo hore" : "button above"})</span><br />{sk ? "nakresli trasu + šírku — napr. pás okolo električky." : "draw a route + a width — e.g. a band along a tram line."}</div>
                  </div>
                  <div style={{ fontSize: "0.68rem", color: dim, marginTop: 10, fontStyle: "italic" }}>{sk ? "Tip: body sa dajú ťahať, oblasť sa dá uložiť." : "Tip: drag the points to reshape, and save an area to reuse it."}</div>
                </div>
              )}
              {!showExplainer && !savedAreasBlock && (
                <div style={{ fontSize: "0.78rem" }}>{sk ? "Klikni na mapu, alebo použi ▱ Oblasť / ⇢ Koridor." : "Click the map, or use ▱ Area / ⇢ Corridor."} <button onClick={reopenExplainer} style={{ background: "none", border: "none", color: green, cursor: "pointer", fontSize: "0.78rem", padding: 0 }}>{sk ? "Ako?" : "How?"}</button></div>
              )}
              {savedAreasBlock}
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ color: textLight, fontWeight: 600, fontSize: "0.85rem" }}>{sk ? "Konkurenčné okolie" : "Competitive set"}</span>
                <button onClick={() => { if (shape) { clearShape(); } else { setAnalysisCenter(null); setAnchorId(null); } }} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "0.95rem" }} aria-label="Clear">✕</button>
              </div>
              {shape ? (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{ fontSize: "0.7rem", color: amber, background: `${amber}14`, border: `1px solid ${amber}44`, borderRadius: 6, padding: "3px 8px" }}>
                      {shape.kind === "polygon" ? "▱" : "⇢"} {shape.kind === "polygon" ? (sk ? "oblasť" : "area") : (sk ? "koridor" : "corridor")}{shapeSize ? ` · ${shapeSize.label}` : ""}
                    </span>
                    <button onClick={() => startDraw(shape.kind)} title={sk ? "Nakresliť znova" : "Redraw"} style={{ background: "none", border: `1px solid ${border}`, color: dim, borderRadius: 6, padding: "3px 9px", fontSize: "0.68rem", cursor: "pointer" }}>{sk ? "Znova" : "Redraw"}</button>
                    {!saving && <button onClick={beginSave} title={sk ? "Uložiť túto oblasť pre neskôr" : "Save this area for later"} style={{ background: "none", border: `1px solid ${green}55`, color: green, borderRadius: 6, padding: "3px 9px", fontSize: "0.68rem", cursor: "pointer" }}>☆ {sk ? "Uložiť" : "Save"}</button>}
                  </div>
                  {saving && (
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      <input autoFocus value={saveName} maxLength={120} onChange={(e) => setSaveName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") confirmSave(); if (e.key === "Escape") setSaving(false); }}
                        placeholder={sk ? "Názov oblasti…" : "Name this area…"}
                        style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "6px 9px", background: bg2, border: `1px solid ${border}`, borderRadius: 7, color: textLight, fontSize: "0.8rem", outline: "none" }} />
                      <button onClick={confirmSave} disabled={!saveName.trim()} style={{ background: saveName.trim() ? green : "transparent", color: saveName.trim() ? "#0a0a0b" : dim, border: `1px solid ${green}55`, borderRadius: 7, padding: "0 12px", fontSize: "0.74rem", fontWeight: 600, cursor: saveName.trim() ? "pointer" : "default" }}>{sk ? "Uložiť" : "Save"}</button>
                      <button onClick={() => setSaving(false)} title={sk ? "Zrušiť" : "Cancel"} style={{ background: "none", border: `1px solid ${border}`, color: dim, borderRadius: 7, padding: "0 8px", fontSize: "0.85rem", cursor: "pointer" }}>✕</button>
                    </div>
                  )}
                  {justSaved && !saving && (
                    <div style={{ fontSize: "0.7rem", color: green, marginBottom: 6 }}>✓ {sk ? `Uložené ako „${justSaved}" — nájdeš to nižšie.` : `Saved as "${justSaved}" — see below.`}</div>
                  )}
                  {shape.kind === "corridor" && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: "0.66rem", color: dim, minWidth: 40 }}>{sk ? "šírka" : "width"}</span>
                      <input type="range" min={100} max={2000} step={50} value={Math.round(shape.widthKm * 1000)} onChange={(e) => setCorridorWidth(Number(e.target.value) / 1000)} style={{ flex: 1, accentColor: amber }} />
                      <span style={{ fontSize: "0.66rem", color: textLight, fontFamily: mono, minWidth: 46, textAlign: "right" }}>{Math.round(shape.widthKm * 1000)} m</span>
                    </div>
                  )}
                  <div style={{ fontSize: "0.62rem", color: dim, marginTop: 6 }}>{sk ? "Ťahaj body pre úpravu tvaru." : "Drag the points to reshape."}</div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: "0.7rem", color: dim, marginBottom: 9 }}>{sk ? "v okruhu" : "within"} <strong style={{ color: textLight, fontFamily: mono }}>{radiusKm % 1 === 0 ? radiusKm : radiusKm.toFixed(1)} km</strong></div>
                  <input type="range" min={0} max={1000} step={1} value={radiusToPos(radiusKm)} onChange={(e) => setRadiusKm(posToRadius(Number(e.target.value)))} onPointerUp={(e) => fitToRadius(posToRadius(Number(e.target.value)))} style={{ width: "100%", marginBottom: 8, accentColor: green }} aria-label="Radius km" />
                  <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
                    {RADIUS_PRESETS.map((p) => {
                      const on = Math.abs(radiusKm - p) < 0.01;
                      return <button key={p} onClick={() => { setRadiusKm(p); fitToRadius(p); }} style={{ flex: 1, minWidth: 0, padding: "5px 0", borderRadius: 6, fontSize: "0.68rem", cursor: "pointer", border: `1px solid ${on ? `${green}66` : border}`, background: on ? `${green}14` : "transparent", color: on ? green : dim }}>{p} km</button>;
                    })}
                  </div>
                </>
              )}

              {anchor && compSet && compSet.inside.length > 1 && (() => {
                const ap = ppm2Of(anchor);
                const deltaPct = (ap > 0 && compSet.median) ? Math.round(((ap - compSet.median) / compSet.median) * 100) : null;
                const aAbs = anchor.sold_percentage == null ? null : Math.round(Number(anchor.sold_percentage));
                return (
                  <div style={{ background: `${green}10`, border: `1px solid ${green}40`, borderRadius: 8, padding: "8px 10px", marginBottom: 12 }}>
                    <div style={{ fontSize: "0.68rem", color: green, marginBottom: 3 }}>◎ {sk ? "Tvoj projekt vs okolie" : "This project vs the set"}</div>
                    <div style={{ fontSize: "0.78rem", color: textLight, fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{anchor.name}</div>
                    <div style={{ fontSize: "0.72rem", color: dim, fontFamily: mono, lineHeight: 1.7 }}>
                      <div>€{ap ? fmt(ap) : "—"}/m²{deltaPct != null ? <span style={{ color: deltaPct > 0 ? "#ff8a8a" : "#7ee0b6" }}> · {deltaPct > 0 ? "+" : ""}{deltaPct}% {sk ? "vs medián" : "vs median"}</span> : ""}</div>
                      <div>{aAbs == null ? "—" : aAbs + "%"} {sk ? "predané" : "sold"}{compSet.avgAbs != null && aAbs != null ? <span style={{ color: aAbs >= compSet.avgAbs ? "#7ee0b6" : "#ff8a8a" }}> · {sk ? "okolie" : "set"} {compSet.avgAbs}%</span> : ""}</div>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: compSet && compSet.placeholderCount ? 8 : 12 }}>
                <Stat label={sk ? "Projekty" : "Projects"} value={compSet ? compSet.inside.length : 0} />
                <Stat label={sk ? "Medián €/m²" : "Median €/m²"} value={compSet && compSet.median ? fmt(compSet.median) : "—"} sub={compSet && compSet.priceLo ? `${fmt(compSet.priceLo)}–${fmt(compSet.priceHi)}` : ""} />
                <Stat label={sk ? "Vypredanosť" : "Absorbed"} value={compSet && compSet.avgAbs != null ? compSet.avgAbs + "%" : "—"} />
                <Stat label={sk ? "Byty" : "Units"} value={compSet ? fmtK(compSet.totalUnits) : 0} sub={compSet ? `${fmtK(compSet.availUnits)} ${sk ? "voľných" : "free"}` : ""} />
              </div>

              {compSet && compSet.median && compSet.priceHi > compSet.priceLo && (
                <PricingBand cs={compSet} anchorPpm2={anchor ? ppm2Of(anchor) : 0} sk={sk} />
              )}
              {compSet && compSet.soldLastMonth > 0 && (
                <div style={{ fontSize: "0.66rem", color: dim, marginBottom: 12 }}>
                  ▴ <span style={{ color: green, fontFamily: mono }}>{compSet.soldLastMonth}</span> {sk ? `bytov predaných ${shape ? "v tejto oblasti" : "v tomto okruhu"} za posledný mesiac` : "units sold in this area last month"}
                </div>
              )}

              {compSet && compSet.placeholderCount > 0 && (
                <div style={{ fontSize: "0.66rem", color: amber, background: `${amber}12`, border: `1px solid ${amber}33`, borderRadius: 6, padding: "5px 8px", marginBottom: 12 }}>
                  ◍ {compSet.placeholderCount} {sk ? "z nich má len približnú (mestskú) polohu" : `of these are approximate (city-level) locations`}
                </div>
              )}

              {compSet && compSet.inside.length > 0 ? (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: "0.7rem", color: dim }}>{sk ? "Kedy sa dokončia" : "When they complete"}</span>
                    {compFilter && <button onClick={() => setCompFilter(null)} style={{ background: "none", border: "none", color: green, cursor: "pointer", fontSize: "0.66rem" }}>{sk ? "zrušiť ✕" : "clear ✕"}</button>}
                  </div>
                  <div style={{ display: "flex", gap: 5, marginBottom: 3 }}>
                    {["ready", "soon", "mid", "far", "unknown"].map((k) => {
                      const n = compSet.comp[k]; const active = compFilter === k;
                      return (
                        <button key={k} onClick={() => n > 0 && setCompFilter(active ? null : k)} disabled={n === 0}
                          title={n > 0 ? (sk ? `Zobraziť projekty (${COMP_LABEL[k]})` : `Show projects (${COMP_LABEL[k]})`) : ""}
                          style={{ flex: 1, minWidth: 0, background: active ? `${COMPLETION[k].color}22` : "none", border: `1px solid ${active ? COMPLETION[k].color : "transparent"}`, borderRadius: 7, padding: "4px 1px", cursor: n > 0 ? "pointer" : "default", textAlign: "center", opacity: n === 0 ? 0.4 : 1 }}>
                          <div style={{ height: 26, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                            <div style={{ width: 15, height: Math.max(3, (n / Math.max(1, compSet.inside.length)) * 26), background: COMPLETION[k].color, borderRadius: 3 }} />
                          </div>
                          <div style={{ fontSize: "0.55rem", color: active ? COMPLETION[k].color : dim, marginTop: 3, lineHeight: 1.1 }}>{COMP_LABEL[k]}</div>
                          <div style={{ fontSize: "0.66rem", color: textLight, fontFamily: mono }}>{n}</div>
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: "0.6rem", color: dim, marginBottom: 12, fontStyle: "italic" }}>{sk ? "Klikni na stĺpec a ukáže ti projekty s daným dokončením." : "Click a bar to list the projects completing then."}</div>

                  <div style={{ fontSize: "0.7rem", color: dim, marginBottom: 6 }}>{sk ? "Najväčší developeri" : "Top developers"}</div>
                  {compSet.topDevs.map((d) => (
                    <div key={d.dev} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: textLight, padding: "2px 0" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 158 }}>{d.dev}</span>
                      <span style={{ color: dim, fontFamily: mono }}>{d.n} · {d.ppm2 ? "€" + fmt(d.ppm2) : "—"}</span>
                    </div>
                  ))}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "12px 0 6px" }}>
                    <span style={{ fontSize: "0.7rem", color: dim }}>{sk ? "Projekty" : "Projects"}{compFilter ? <span style={{ color: COMPLETION[compFilter].color }}> · {COMP_LABEL[compFilter]}</span> : ""} ({listProjects.length})</span>
                    <button onClick={() => exportCsv(listProjects, coords)} style={{ background: "none", border: `1px solid ${border}`, color: dim, borderRadius: 6, padding: "3px 8px", fontSize: "0.66rem", cursor: "pointer" }} title={sk ? "Stiahnuť ako CSV" : "Download as CSV"}>⬇ CSV</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {listProjects.slice().sort((a, b) => ppm2Of(b) - ppm2Of(a)).slice(0, 60).map((p) => {
                      const when = completionWhen(p); const bucket = completionBucket(p); const avail = Number(p.available_units) || 0;
                      return (
                        <button key={p.id} onClick={() => openProject(p.id)} style={{ display: "block", width: "100%", background: "none", border: "none", cursor: "pointer", padding: "4px 5px", textAlign: "left", borderRadius: 6 }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#1d1d22")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ color: textLight, fontSize: "0.76rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(coords && coords[p.id] && !coords[p.id].verified) ? "◍ " : ""}{p.name}</span>
                            <span style={{ color: dim, fontFamily: mono, fontSize: "0.74rem", flexShrink: 0 }}>{ppm2Of(p) ? "€" + fmt(ppm2Of(p)) + "/m²" : "—"}</span>
                          </div>
                          <div style={{ display: "flex", gap: 8, fontSize: "0.62rem", color: dim, marginTop: 1 }}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} title={sk ? "Dokončenie (kolaudácia)" : "Completion"}><span style={{ width: 6, height: 6, borderRadius: "50%", background: COMPLETION[bucket].color, display: "inline-block", flexShrink: 0 }} />{when || (sk ? "termín ?" : "date ?")}</span>
                            <span>· {avail} {sk ? "voľných" : "free"}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {compFilter && listProjects.length === 0 && (
                    <div style={{ color: dim, fontSize: "0.72rem", padding: "6px 2px" }}>{sk ? "Žiadne projekty s týmto dokončením — " : "No projects with this timing — "}<button onClick={() => setCompFilter(null)} style={{ background: "none", border: "none", color: green, cursor: "pointer", fontSize: "0.72rem", padding: 0 }}>{sk ? "zobraziť všetky" : "show all"}</button></div>
                  )}
                </>
              ) : (
                <div style={{ color: dim, fontSize: "0.78rem" }}>{sk ? "Žiadne projekty v okruhu — zväčši okruh alebo klikni inde." : "No projects in range — widen the radius or click elsewhere."}</div>
              )}
              {savedAreasBlock}
            </div>
          )}
        </div>
        )}

        {isLoading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: dim, fontFamily: mono, fontSize: "0.8rem", background: "rgba(10,10,11,0.4)", pointerEvents: "none" }}>{sk ? "Načítavam mapu…" : "Loading map…"}</div>
        )}
      </div>

      <style>{`
        .mv2-root button { transition: filter .12s ease, background .12s ease, border-color .12s ease, color .12s ease; }
        .mv2-root button:hover { filter: brightness(1.12); }
        .mv2-root input { transition: border-color .12s ease; }
        .mv2-root input:focus { border-color: ${green}66; }
        .mv2-root ::-webkit-scrollbar { width: 9px; height: 9px; }
        .mv2-root ::-webkit-scrollbar-thumb { background: #2a2a31; border-radius: 6px; }
        .mv2-root ::-webkit-scrollbar-thumb:hover { background: #3a3a44; }
        .mv2-root ::-webkit-scrollbar-track { background: transparent; }
        .maplibregl-popup-content { background:${bg2}; color:${textLight}; border:1px solid ${border}; border-radius:10px; padding:12px 13px; box-shadow:0 8px 30px rgba(0,0,0,0.5); }
        .mv2-hover .maplibregl-popup-content { padding:7px 10px; }
        .maplibregl-popup-tip { border-top-color:${bg2} !important; border-bottom-color:${bg2} !important; }
        .maplibregl-popup-close-button { color:${dim}; font-size:16px; padding:2px 6px; }
        .maplibregl-ctrl-attrib { font-size:9px; }
        select option { background:${bg2}; color:${textLight}; }
      `}</style>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={{ background: "#141418", borderRadius: 8, padding: "7px 9px" }}>
      <div style={{ fontSize: "0.62rem", color: dim }}>{label}</div>
      <div style={{ fontSize: "1rem", color: textLight, fontWeight: 600, fontFamily: mono }}>{value}</div>
      {sub ? <div style={{ fontSize: "0.58rem", color: dim, fontFamily: mono }}>{sub}</div> : null}
    </div>
  );
}

// Compare a hand-picked set of projects side by side. Selection happens elsewhere
// (name search here, a pin's "⇄ Compare", or "add all in this area") — this panel
// only presents the set. One project can be the baseline (★ yours); the rest show
// their €/m² delta against it, or against the set median when none is chosen.
function ComparePanel({ options, compareIds, setCompareIds, rows, baselineId, setBaseline, onRemove, onClear, areaCount, onAddArea, onClose, openProject, completionWhen, coords, sk }) {
  const priced = rows.map(ppm2Of).filter((v) => v > 0).sort((a, b) => a - b);
  const setMed = median(priced);
  const setAbs = rows.length ? setAbsorptionPct(rows) : null;
  const baseline = baselineId ? rows.find((p) => p.id === baselineId) : null;
  const refPpm = baseline && ppm2Of(baseline) > 0 ? ppm2Of(baseline) : setMed;
  const refLabel = baseline ? (sk ? "vs tvoj" : "vs yours") : (sk ? "vs medián" : "vs median");
  const delta = (v) => (refPpm && v > 0 ? Math.round(((v - refPpm) / refPpm) * 100) : null);
  const sorted = rows.slice().sort((a, b) => (b.id === baselineId ? 1 : 0) - (a.id === baselineId ? 1 : 0) || ppm2Of(b) - ppm2Of(a));
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
        <span style={{ color: textLight, fontWeight: 600, fontSize: "0.85rem" }}>⇄ {sk ? "Porovnanie" : "Compare"}{rows.length ? ` (${rows.length})` : ""}</span>
        <button onClick={onClose} title={sk ? "Zavrieť porovnanie" : "Close compare"} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "0.95rem" }} aria-label="Close">✕</button>
      </div>
      <Picker multi searchable options={options} value={[...compareIds]} onChange={(arr) => setCompareIds(new Set(arr))} placeholder={sk ? "Pridať projekt (hľadaj podľa mena)…" : "Add a project (search by name)…"} width="100%" sk={sk} ariaLabel="Add projects to compare" />
      {areaCount > 0 && (
        <button onClick={onAddArea} style={{ width: "100%", marginTop: 8, background: `${green}12`, border: `1px solid ${green}55`, color: green, borderRadius: 7, padding: "7px 8px", fontSize: "0.72rem", cursor: "pointer" }}>
          ➕ {sk ? `Pridať ${areaCount} z nakreslenej oblasti` : `Add ${areaCount} from the drawn area`}
        </button>
      )}
      {rows.length === 0 ? (
        <div style={{ color: dim, fontSize: "0.76rem", lineHeight: 1.6, marginTop: 12 }}>
          {sk
            ? "Vyber projekty na porovnanie: hľadaj vyššie podľa mena, klikni špendlík na mape (⇄ Compare), alebo nakresli oblasť (▱ / ⇢) a pridaj všetky vnútri."
            : "Pick projects to compare: search by name above, click a pin on the map (⇄ Compare), or draw an area (▱ / ⇢) and add everything inside."}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.64rem", color: dim, fontFamily: mono, margin: "11px 0 6px" }}>
            <span>{sk ? "Medián setu" : "Set median"}: €{setMed ? fmt(setMed) : "—"}/m²</span>
            <span>{setAbs != null ? `${setAbs}% ${sk ? "predané" : "sold"}` : ""}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {sorted.map((p) => {
              const isBase = p.id === baselineId;
              const ppm = ppm2Of(p); const d = isBase ? null : delta(ppm);
              const abs = p.sold_percentage == null ? null : Math.round(Number(p.sold_percentage));
              const when = completionWhen(p); const bucket = completionBucket(p);
              const avail = Number(p.available_units) || 0; const tot = Number(p.total_units) || 0;
              const approx = coords && coords[p.id] && !coords[p.id].verified;
              return (
                <div key={p.id} style={{ background: isBase ? `${green}12` : "#141418", border: `1px solid ${isBase ? `${green}55` : border}`, borderRadius: 8, padding: "7px 9px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={() => setBaseline(p.id)} title={isBase ? (sk ? "Zrušiť ako tvoj základ" : "Unset as your baseline") : (sk ? "Označiť ako tvoj (základ porovnania)" : "Mark as yours (comparison baseline)")} style={{ background: isBase ? `${green}22` : "transparent", border: `1px solid ${isBase ? green : "transparent"}`, color: isBase ? green : dim, cursor: "pointer", borderRadius: 5, width: 21, height: 21, flexShrink: 0, fontSize: "0.72rem", lineHeight: 1 }}>★</button>
                    <button onClick={() => openProject(p.id)} style={{ flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, color: isBase ? green : textLight, fontSize: "0.77rem", fontWeight: isBase ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={sk ? "Otvoriť projekt" : "Open project"}>
                      {approx ? "◍ " : ""}{p.name}{isBase ? <span style={{ color: dim, fontWeight: 400 }}> · {sk ? "tvoj" : "yours"}</span> : ""}
                    </button>
                    <button onClick={() => onRemove(p.id)} title={sk ? "Odobrať z porovnania" : "Remove from comparison"} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "0.8rem", flexShrink: 0, padding: "0 2px" }}>✕</button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", fontSize: "0.66rem", color: dim, fontFamily: mono, marginTop: 4, paddingLeft: 27 }}>
                    <span style={{ color: textLight }}>{ppm ? "€" + fmt(ppm) + "/m²" : "—"}{d != null ? <span style={{ color: d > 0 ? "#ff8a8a" : "#7ee0b6" }}> {d > 0 ? "+" : ""}{d}% {refLabel}</span> : ""}</span>
                    <span>{abs == null ? "—" : abs + "%"} {sk ? "pred." : "sold"}</span>
                    <span>{avail}/{tot} {sk ? "voľ." : "free"}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: COMPLETION[bucket].color, display: "inline-block" }} />{when || (sk ? "termín ?" : "date ?")}</span>
                  </div>
                  {p.developer ? <div style={{ fontSize: "0.6rem", color: dim, marginTop: 2, paddingLeft: 27, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.developer}</div> : null}
                </div>
              );
            })}
          </div>
          <button onClick={onClear} style={{ width: "100%", marginTop: 8, background: "none", border: `1px solid ${border}`, color: dim, borderRadius: 7, padding: "6px 8px", fontSize: "0.7rem", cursor: "pointer" }}>{sk ? "Vyčistiť všetko" : "Clear all"}</button>
        </>
      )}
    </div>
  );
}

const inputStyle = { boxSizing: "border-box", padding: "7px 11px", background: bg2, border: `1px solid ${border}`, borderRadius: 7, color: textLight, fontSize: "0.82rem", outline: "none" };
function chipStyle(active) {
  return { padding: "6px 12px", borderRadius: 999, cursor: "pointer", fontSize: "0.76rem", border: `1px solid ${active ? green : border}`, background: active ? `${green}1a` : "transparent", color: active ? green : dim };
}
function tabStyle(active) {
  return { padding: "5px 13px", borderRadius: 999, cursor: "pointer", fontSize: "0.75rem", border: "none", background: active ? green : "transparent", color: active ? "#06140f" : dim, fontWeight: active ? 600 : 400 };
}
const dot = (c) => ({ width: 8, height: 8, borderRadius: "50%", background: c, display: "inline-block", marginRight: 5 });

// Adaptive market overview — the headline metric + a visual that fits the lens.
// Pricing-positioning band for the analysed area: full €/m² range with the
// middle-50% (P25–P75) highlighted, the median marked, and — when an anchor
// project is set — a caret showing exactly where it would sit in the market.
function PricingBand({ cs, anchorPpm2, sk }) {
  const { priceLo, priceHi, p25, p75, median } = cs;
  if (!median || !(priceHi > priceLo)) return null;
  const span = priceHi - priceLo;
  const pos = (v) => Math.max(0, Math.min(100, ((v - priceLo) / span) * 100));
  const aPos = anchorPpm2 > 0 ? pos(anchorPpm2) : null;
  const aQuart = anchorPpm2 > 0 && p25 != null && p75 != null
    ? (anchorPpm2 < p25 ? (sk ? "spodný kvartil — lacnejší než okolie" : "bottom quartile — cheaper than the area")
      : anchorPpm2 > p75 ? (sk ? "horný kvartil — drahší než okolie" : "top quartile — pricier than the area")
      : (sk ? "stredné pásmo trhu" : "right in the market mid-band"))
    : null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: "0.6rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>{sk ? "Cenové pásmo €/m²" : "Pricing band €/m²"}</span>
        <span style={{ fontSize: "0.62rem", color: dim, fontFamily: mono }}>{sk ? "stred 50 %" : "middle 50%"} €{fmt(p25)}–€{fmt(p75)}</span>
      </div>
      <div style={{ position: "relative", height: 12, marginBottom: 6 }}>
        <div style={{ position: "absolute", left: 0, right: 0, top: 5, height: 2, background: "#26262d", borderRadius: 2 }} />
        <div style={{ position: "absolute", left: `${pos(p25)}%`, width: `${Math.max(1, pos(p75) - pos(p25))}%`, top: 2, height: 8, background: `${green}30`, border: `1px solid ${green}66`, borderRadius: 4 }} />
        <div style={{ position: "absolute", left: `${pos(median)}%`, top: 0, width: 2, height: 12, background: green, transform: "translateX(-1px)" }} title={`med €${fmt(median)}`} />
        {aPos != null ? <div style={{ position: "absolute", left: `${aPos}%`, top: -4, transform: "translateX(-5px)", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `7px solid ${textLight}` }} title={`${sk ? "tento projekt" : "this project"} €${fmt(anchorPpm2)}`} /> : null}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.6rem", color: dim, fontFamily: mono }}>
        <span>€{fmt(priceLo)}</span>
        <span style={{ color: green }}>med €{fmt(median)}</span>
        <span>€{fmt(priceHi)}</span>
      </div>
      {aQuart ? <div style={{ fontSize: "0.64rem", color: dim, marginTop: 7 }}>{sk ? "Tento projekt " : "This project "}<span style={{ color: textLight, fontFamily: mono }}>€{fmt(anchorPpm2)}/m²</span> · {aQuart}</div> : null}
    </div>
  );
}
function MarketInsight({ lens, stats, sk }) {
  const s = stats;
  let headline, visual;
  if (lens === "price") {
    headline = <Headline big={s.med ? `€${fmt(s.med)}` : "—"} unit="/m²" sub={s.pMin ? `${sk ? "medián · rozsah" : "median · range"} €${fmt(s.pMin)}–€${fmt(s.pMax)}` : (sk ? "bez zverejnených cien" : "no published prices")} />;
    visual = <Histogram hist={s.hist} hLo={s.hLo} hHi={s.hHi} med={s.med} />;
  } else if (lens === "completion") {
    const known = s.count - s.comp.unknown;
    headline = <Headline big={s.count ? `${Math.round((known / s.count) * 100)}%` : "—"} sub={sk ? "má termín dokončenia" : "have a completion date"} />;
    visual = <Pipeline comp={s.comp} />;
  } else if (lens === "supply") {
    headline = <Headline big={fmtK(s.available)} sub={`${sk ? "voľných · z" : "units available · of"} ${fmtK(s.invTotal)}`} />;
    visual = <InventoryBar avail={s.available} res={s.reserved} sold={s.sold} sk={sk} />;
  } else if (lens === "momentum") {
    headline = <Headline big={fmtK(s.soldLM)} sub={`${sk ? "predaných za mesiac · " : "sold last month · "}${s.moving}/${s.count} ${sk ? "v pohybe" : "moving"}`} />;
    visual = <MovingBar moving={s.moving} count={s.count} soldLM={s.soldLM} sk={sk} />;
  } else {
    headline = <Headline big={s.soldPct != null ? `${s.soldPct}%` : "—"} sub={`${sk ? "predané · " : "sold · "}${fmtK(s.sold)} ${sk ? "z" : "of"} ${fmtK(s.invTotal)}`} />;
    visual = <InventoryBar avail={s.available} res={s.reserved} sold={s.sold} sk={sk} />;
  }
  return <div style={{ display: "flex", alignItems: "center", gap: 20 }}>{headline}{visual}</div>;
}
function Headline({ big, unit, sub }) {
  return (
    <div style={{ minWidth: 124, flexShrink: 0 }}>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, color: textLight, fontFamily: mono, lineHeight: 1 }}>{big}{unit ? <span style={{ fontSize: "0.78rem", color: dim, fontWeight: 400 }}>{unit}</span> : null}</div>
      <div style={{ fontSize: "0.64rem", color: dim, marginTop: 4 }}>{sub}</div>
    </div>
  );
}
function Histogram({ hist, hLo, hHi, med }) {
  if (!hist || !hist.some((n) => n > 0)) return <div style={{ flex: 1, fontSize: "0.7rem", color: dim }}>—</div>;
  const max = Math.max(...hist, 1);
  const medIdx = (med != null && hHi > hLo) ? Math.min(hist.length - 1, Math.max(0, Math.floor(((med - hLo) / (hHi - hLo)) * hist.length))) : -1;
  return (
    <div style={{ flex: 1, minWidth: 150 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 36 }}>
        {hist.map((n, i) => <div key={i} title={String(n)} style={{ flex: 1, height: `${Math.max(7, (n / max) * 100)}%`, background: i === medIdx ? green : "#2c6e59", borderRadius: 2 }} />)}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.58rem", color: dim, fontFamily: mono, marginTop: 4 }}>
        <span>€{fmt(hLo)}</span><span>€{fmt(hHi)}/m²</span>
      </div>
    </div>
  );
}
function InventoryBar({ avail, res, sold, sk }) {
  const t = Math.max(1, avail + res + sold);
  const seg = (v, c, lbl) => (v > 0 ? <div key={lbl} title={`${lbl}: ${fmt(v)}`} style={{ width: `${(v / t) * 100}%`, background: c, height: "100%" }} /> : null);
  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div style={{ display: "flex", height: 18, borderRadius: 5, overflow: "hidden", background: "#17171c", border: `1px solid ${border}` }}>
        {seg(avail, green, sk ? "voľné" : "available")}{seg(res, amber, sk ? "rezervované" : "reserved")}{seg(sold, greyPt, sk ? "predané" : "sold")}
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: "0.62rem", color: dim, marginTop: 5, flexWrap: "wrap" }}>
        <span><span style={dot(green)} />{fmtK(avail)} {sk ? "voľné" : "available"}</span>
        <span><span style={dot(amber)} />{fmtK(res)} {sk ? "rezerv." : "reserved"}</span>
        <span><span style={dot(greyPt)} />{fmtK(sold)} {sk ? "predané" : "sold"}</span>
      </div>
    </div>
  );
}
function MovingBar({ moving, count, soldLM, sk }) {
  const t = Math.max(1, count);
  const staticN = Math.max(0, count - moving);
  return (
    <div style={{ flex: 1, minWidth: 200 }}>
      <div style={{ display: "flex", height: 18, borderRadius: 5, overflow: "hidden", background: "#17171c", border: `1px solid ${border}` }}>
        {moving > 0 ? <div title={String(moving)} style={{ width: `${(moving / t) * 100}%`, background: green, height: "100%" }} /> : null}
        {staticN > 0 ? <div title={String(staticN)} style={{ width: `${(staticN / t) * 100}%`, background: greyPt, height: "100%" }} /> : null}
      </div>
      <div style={{ display: "flex", gap: 14, fontSize: "0.62rem", color: dim, marginTop: 5, flexWrap: "wrap" }}>
        <span><span style={dot(green)} />{moving} {sk ? "v pohybe" : "selling"}</span>
        <span><span style={dot(greyPt)} />{staticN} {sk ? "bez predaja" : "no sales"}</span>
        {soldLM > 0 ? <span style={{ fontFamily: mono, color: green }}>{soldLM} {sk ? "ks/mes." : "units/mo"}</span> : null}
      </div>
    </div>
  );
}
function Pipeline({ comp }) {
  const order = ["ready", "soon", "mid", "far", "unknown"];
  const t = Math.max(1, order.reduce((s, k) => s + comp[k], 0));
  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ display: "flex", height: 18, borderRadius: 5, overflow: "hidden", background: "#17171c", border: `1px solid ${border}` }}>
        {order.map((k) => (comp[k] > 0 ? <div key={k} title={`${COMPLETION[k].label}: ${comp[k]}`} style={{ width: `${(comp[k] / t) * 100}%`, background: COMPLETION[k].color, height: "100%" }} /> : null))}
      </div>
      <div style={{ display: "flex", gap: 12, fontSize: "0.6rem", color: dim, marginTop: 5, flexWrap: "wrap" }}>
        {order.map((k) => (comp[k] > 0 ? <span key={k}><span style={dot(COMPLETION[k].color)} />{comp[k]} {COMPLETION[k].short}</span> : null))}
      </div>
    </div>
  );
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Heatmap legend — shown in place of the dot legend while Heat is on: a cool→hot
// gradient (matching the heatmap-color ramp) labelled with the active metric.
function HeatLegend({ lens, sk }) {
  const L = LENSES.find((l) => l.key === lens);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }} title={sk ? "Tepelná mapa — intenzita podľa zvolenej metriky" : "Heatmap — intensity by the active metric"}>
      <span>{sk ? "menej" : "low"}</span>
      <span style={{ width: 84, height: 9, borderRadius: 5, background: "linear-gradient(90deg, #2b4c9b, #3aa0ff, #f5a623, #ff7a3d, #ff3d3d)", display: "inline-block" }} />
      <span style={{ color: textLight }}>{sk ? "viac" : "high"}</span>
      {L ? <span style={{ opacity: 0.7 }}>· {L.label}</span> : null}
    </span>
  );
}
function EyeIcon({ off }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden="true">
      {off ? (
        <>
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </>
      ) : (
        <>
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
          <circle cx="12" cy="12" r="3" />
        </>
      )}
    </svg>
  );
}

// Download the competitive set as CSV (developers want it in their own model).
function exportCsv(rows, coords) {
  const head = ["Project", "Developer", "City", "District", "EUR_per_m2", "Total_units", "Available", "Absorption_pct", "Approx_location"];
  const esc = (v) => { const s = String(v == null ? "" : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [head.join(",")].concat((rows || []).map((p) => [
    p.name, p.developer || "", p.city || "", p.district || "", ppm2Of(p) || "",
    Number(p.total_units) || "", Number(p.available_units) || "",
    p.sold_percentage == null ? "" : Math.round(Number(p.sold_percentage)),
    (coords && coords[p.id] && !coords[p.id].verified) ? "yes" : "",
  ].map(esc).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "competitive-set.csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
