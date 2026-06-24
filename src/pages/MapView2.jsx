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
import { supabasePublic, isSupabaseReady } from "../lib/supabase";
import {
  LENSES, COMPLETION, NO_DATA, ppm2Of, metricValue, completionBucket,
  tertiles, colorFor, coverage, circlePolygon, computeCompetitiveSet, legendForLens, valueRange, heatWeight,
} from "../lib/mapMetrics";
import MapFilterBuilder from "../components/MapFilterBuilder";
import { applyFilters, describe, isComplete } from "../lib/mapFilters";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const amber = "#f5a623";
const greyPt = "#6b6b76";
const dim = "#8a8a96";
const textLight = "#e8e8ed";
const border = "#222228";
const bg2 = "#0e0e10";
const panel = "#141418";

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const FALLBACK_CENTER = [18.5, 48.7];
const FALLBACK_ZOOM = 6.2;

let savedView = null;

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
    `<button id="mv2-open" style="flex:1.3;padding:7px 8px;background:${green};color:#0a0a0b;border:none;border-radius:6px;font-weight:600;font-size:0.72rem;cursor:pointer">Open →</button>` +
    `</div>`;
  const open = el.querySelector("#mv2-open");
  const analyze = el.querySelector("#mv2-analyze");
  if (open) open.onclick = () => handlers.onOpen(props.id);
  if (analyze) analyze.onclick = () => handlers.onAnalyze(props);
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

  const [lens, setLens] = useState("price");
  const [conditions, setConditions] = useState([]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [nameQuery, setNameQuery] = useState("");
  const [analysisCenter, setAnalysisCenter] = useState(null);
  const [radiusKm, setRadiusKm] = useState(1.5);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [showSoldOut, setShowSoldOut] = useState(true); // sold out = no units available
  const [heatMode, setHeatMode] = useState(false); // dots vs heatmap of the active lens
  const [anchorId, setAnchorId] = useState(null); // project an "◎ Area" was opened from → benchmark vs its set
  const [viewBounds, setViewBounds] = useState(null); // current map viewport → the overview reflects only what's on screen

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
    const named = q ? (projects || []).filter((p) => norm(p.name).includes(q)) : (projects || []);
    return applyFilters(named, conditions);
  }, [projects, nameQuery, conditions]);
  const soldOutCount = useMemo(() => baseSet.filter((p) => (Number(p.available_units) || 0) === 0).length, [baseSet]);
  const shown = useMemo(() => (showSoldOut ? baseSet : baseSet.filter((p) => (Number(p.available_units) || 0) > 0)), [baseSet, showSoldOut]);
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
    const at = (q) => (priced.length ? priced[Math.min(priced.length - 1, Math.floor(q * priced.length))] : null);
    const med = priced.length ? priced[Math.floor((priced.length - 1) / 2)] : null;
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
      soldPct: invTotal ? Math.round((sold / invTotal) * 100) : null, soldLM, moving, comp,
    };
  }, [inView]);

  const compSet = useMemo(() => computeCompetitiveSet(shown, coords, analysisCenter, radiusKm, verifiedOnly), [shown, coords, analysisCenter, radiusKm, verifiedOnly]);
  const anchor = useMemo(() => (anchorId ? shown.find((p) => p.id === anchorId) : null), [anchorId, shown]);

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
            0, "rgba(0,0,0,0)", 0.15, "rgba(40,110,89,0.45)", 0.35, "#3aa0ff", 0.6, "#f5a623", 0.82, "#ff7a3d", 1, "#ff3d3d"],
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
        const f = e.features[0]; const p = f.properties;
        map.getCanvas().style.cursor = "pointer";
        hoverPopupRef.current.setLngLat(f.geometry.coordinates)
          .setHTML(`<div style="font-weight:600;font-size:0.76rem;color:${textLight}">${escapeHtml(p.name)}</div><div style="font-size:0.7rem;color:${dim};font-family:${mono}">${escapeHtml(hoverLabel(p, lensRef.current))}</div>`)
          .addTo(map);
      });
      map.on("mouseleave", "points", () => { map.getCanvas().style.cursor = ""; if (hoverPopupRef.current) hoverPopupRef.current.remove(); });

      map.on("click", "points", (e) => {
        if (hoverPopupRef.current) hoverPopupRef.current.remove();
        const f = e.features[0];
        showProjectPopup(map, f.geometry.coordinates, f.properties, {
          onOpen: (id) => setCurrentRef.current && setCurrentRef.current("App:ProjectDetail:" + id),
          onAnalyze: (ll) => onAnalyzeRef.current(ll),
        }, popupRef);
      });
      map.on("click", (e) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ["points"] });
        if (hit && hit.length) return;
        setAnalysisCenter({ lng: e.lngLat.lng, lat: e.lngLat.lat }); setAnchorId(null);
      });
    });

    return () => {
      if (ro) ro.disconnect();
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      if (hoverPopupRef.current) { hoverPopupRef.current.remove(); hoverPopupRef.current = null; }
      if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
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

  const firstCountry = useRef(true);
  useEffect(() => {
    if (firstCountry.current) { firstCountry.current = false; return; }
    setConditions([]); setNameQuery(""); setAnalysisCenter(null); setAnchorId(null);
  }, [country]);

  const openProject = (id) => setCurrentRef.current && setCurrentRef.current("App:ProjectDetail:" + id);
  const isLoading = loading || coords === null;
  const legend = legendForLens(lens, thresholds, fmt);

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
        {activeConds.map((c) => (
          <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: `${green}14`, color: green, border: `1px solid ${green}40`, borderRadius: 999, padding: "4px 9px", fontSize: "0.7rem", maxWidth: 250 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{describe(c, sk)}</span>
            <span onClick={() => setConditions((cs) => cs.filter((x) => x.id !== c.id))} style={{ cursor: "pointer", flexShrink: 0 }}>×</span>
          </span>
        ))}
        <button onClick={() => setVerifiedOnly((v) => !v)} style={chipStyle(verifiedOnly)} title={sk ? "Len presné polohy" : "Only precise locations"}>
          ◉ {sk ? "presné polohy" : "precise only"}
        </button>
        <button onClick={() => setShowSoldOut((v) => !v)} title={sk ? "Zobraziť / skryť vypredané projekty (bez voľných bytov)" : "Show / hide sold-out projects (no units available)"}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 999, fontSize: "0.74rem", cursor: "pointer", border: `1px solid ${showSoldOut ? border : `${amber}55`}`, background: showSoldOut ? "transparent" : `${amber}14`, color: showSoldOut ? textLight : amber }}>
          <EyeIcon off={!showSoldOut} />
          <span style={{ textDecoration: showSoldOut ? "none" : "line-through" }}>{sk ? "Vypredané" : "Sold out"}</span>
          {soldOutCount > 0 && <span style={{ opacity: 0.7, fontFamily: mono, fontSize: "0.66rem" }}>· {soldOutCount}</span>}
        </button>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, marginLeft: "auto", fontSize: "0.66rem", color: dim, flexWrap: "wrap" }}>
          {legend.map((it) => <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: it.color, display: "inline-block" }} />{it.label}</span>)}
        </div>
      </div>

      {/* Map + competitive panel */}
      <div style={{ position: "relative", flex: 1, minHeight: 360 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

        {filterOpen && (
          <MapFilterBuilder conditions={conditions} setConditions={setConditions} projects={projects || []} matchCount={shown.length} totalCount={(projects || []).length} sk={sk} onClose={() => setFilterOpen(false)} />
        )}

        {!analysisCenter && !isLoading && (
          <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", background: "rgba(14,14,16,0.92)", border: `1px solid ${green}55`, color: textLight, fontSize: "0.74rem", padding: "7px 14px", borderRadius: 20, pointerEvents: "none" }}>
            ◎ {sk ? "Klikni pri pozemku — ukážem konkurenciu v okruhu" : "Click near a site — I'll show the competition within a radius"}
          </div>
        )}

        <div style={{ position: "absolute", top: 12, right: 12, width: 300, maxWidth: "calc(100% - 24px)", maxHeight: "calc(100% - 24px)", overflowY: "auto", background: "rgba(14,14,16,0.97)", border: `1px solid ${border}`, borderRadius: 12, boxShadow: "0 12px 30px rgba(0,0,0,0.5)", padding: "14px 15px" }}>
          {!analysisCenter ? (
            <div style={{ color: dim, fontSize: "0.8rem", lineHeight: 1.6 }}>
              <div style={{ color: textLight, fontWeight: 600, marginBottom: 6, fontSize: "0.85rem" }}>{sk ? "Konkurenčné okolie" : "Competitive set"}</div>
              {sk ? "Klikni na mapu pri pozemku (alebo „◎ Area" + "“ v karte projektu) — zhrniem konkurenciu v okruhu. Bod sa dá ťahať." : "Click the map near a site (or “◎ Area” in a project card) and I'll summarise the competition within a radius. Drag the point to move it."}
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <span style={{ color: textLight, fontWeight: 600, fontSize: "0.85rem" }}>{sk ? "Konkurenčné okolie" : "Competitive set"}</span>
                <button onClick={() => { setAnalysisCenter(null); setAnchorId(null); }} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "0.95rem" }} aria-label="Clear">✕</button>
              </div>
              <div style={{ fontSize: "0.7rem", color: dim, marginBottom: 9 }}>{sk ? "v okruhu" : "within"} <strong style={{ color: textLight, fontFamily: mono }}>{radiusKm % 1 === 0 ? radiusKm : radiusKm.toFixed(1)} km</strong></div>
              <input type="range" min={0} max={1000} step={1} value={radiusToPos(radiusKm)} onChange={(e) => setRadiusKm(posToRadius(Number(e.target.value)))} onPointerUp={(e) => fitToRadius(posToRadius(Number(e.target.value)))} style={{ width: "100%", marginBottom: 8, accentColor: green }} aria-label="Radius km" />
              <div style={{ display: "flex", gap: 5, marginBottom: 12 }}>
                {RADIUS_PRESETS.map((p) => {
                  const on = Math.abs(radiusKm - p) < 0.01;
                  return <button key={p} onClick={() => { setRadiusKm(p); fitToRadius(p); }} style={{ flex: 1, minWidth: 0, padding: "5px 0", borderRadius: 6, fontSize: "0.68rem", cursor: "pointer", border: `1px solid ${on ? `${green}66` : border}`, background: on ? `${green}14` : "transparent", color: on ? green : dim }}>{p} km</button>;
                })}
              </div>

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
                  ▴ <span style={{ color: green, fontFamily: mono }}>{compSet.soldLastMonth}</span> {sk ? "bytov predaných v tomto okruhu za posledný mesiac" : "units sold in this area last month"}
                </div>
              )}

              {compSet && compSet.placeholderCount > 0 && (
                <div style={{ fontSize: "0.66rem", color: amber, background: `${amber}12`, border: `1px solid ${amber}33`, borderRadius: 6, padding: "5px 8px", marginBottom: 12 }}>
                  ◍ {compSet.placeholderCount} {sk ? "z nich má len približnú (mestskú) polohu" : `of these are approximate (city-level) locations`}
                </div>
              )}

              {compSet && compSet.inside.length > 0 ? (
                <>
                  <div style={{ fontSize: "0.7rem", color: dim, marginBottom: 6 }}>{sk ? "Dokončenie" : "Completing"}</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                    {["ready", "soon", "mid", "far", "unknown"].map((k) => (
                      <div key={k} style={{ flex: 1, textAlign: "center" }}>
                        <div style={{ height: 28, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                          <div style={{ width: 16, height: Math.max(3, (compSet.comp[k] / Math.max(1, compSet.inside.length)) * 28), background: COMPLETION[k].color, borderRadius: 3 }} />
                        </div>
                        <div style={{ fontSize: "0.58rem", color: dim, marginTop: 3 }}>{COMPLETION[k].short}</div>
                        <div style={{ fontSize: "0.64rem", color: textLight, fontFamily: mono }}>{compSet.comp[k]}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: "0.7rem", color: dim, marginBottom: 6 }}>{sk ? "Najväčší developeri" : "Top developers"}</div>
                  {compSet.topDevs.map((d) => (
                    <div key={d.dev} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: textLight, padding: "2px 0" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 158 }}>{d.dev}</span>
                      <span style={{ color: dim, fontFamily: mono }}>{d.n} · {d.ppm2 ? "€" + fmt(d.ppm2) : "—"}</span>
                    </div>
                  ))}

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "12px 0 6px" }}>
                    <span style={{ fontSize: "0.7rem", color: dim }}>{sk ? "Projekty" : "Projects"} ({compSet.inside.length})</span>
                    <button onClick={() => exportCsv(compSet.inside, coords)} style={{ background: "none", border: `1px solid ${border}`, color: dim, borderRadius: 6, padding: "3px 8px", fontSize: "0.66rem", cursor: "pointer" }} title={sk ? "Stiahnuť ako CSV" : "Download as CSV"}>⬇ CSV</button>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {compSet.inside.slice().sort((a, b) => ppm2Of(b) - ppm2Of(a)).slice(0, 40).map((p) => (
                      <button key={p.id} onClick={() => openProject(p.id)} style={{ display: "flex", justifyContent: "space-between", gap: 8, background: "none", border: "none", color: textLight, cursor: "pointer", fontSize: "0.75rem", padding: "3px 4px", textAlign: "left", borderRadius: 5 }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#1d1d22")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(coords && coords[p.id] && !coords[p.id].verified) ? "◍ " : ""}{p.name}</span>
                        <span style={{ color: dim, fontFamily: mono, flexShrink: 0 }}>{ppm2Of(p) ? "€" + fmt(ppm2Of(p)) : "—"}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ color: dim, fontSize: "0.78rem" }}>{sk ? "Žiadne projekty v okruhu — zväčši okruh alebo klikni inde." : "No projects in range — widen the radius or click elsewhere."}</div>
              )}
            </div>
          )}
        </div>

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
