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
  tertiles, colorFor, coverage, circlePolygon, computeCompetitiveSet, legendForLens,
} from "../lib/mapMetrics";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const amber = "#f5a623";
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
const uniqueSorted = (arr) =>
  Array.from(new Set(arr.filter((v) => v != null && String(v).trim() !== ""))).sort((a, b) =>
    String(a).localeCompare(String(b), "sk", { sensitivity: "base" })
  );
const fmt = (n) => Number(Math.round(n)).toLocaleString("sk-SK");
const fmtK = (n) => (n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k" : fmt(n));
const pct = (x) => `${Math.round(x * 100)}%`;

function projectProps(p, c, lens, thresholds) {
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
    units: Number(p.total_units) || Number(p.available_units) || 0,
    completion: completionBucket(p),
    verified: !!(c && c.verified),
    color: colorFor(p, lens, thresholds),
    lng: c.lng, lat: c.lat,
  };
}

function buildFeatures(projects, coords, lens, thresholds, verifiedOnly) {
  const feats = [];
  for (const p of projects) {
    const c = coords[p.id];
    if (!c) continue;
    if (verifiedOnly && !c.verified) continue;
    feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [c.lng, c.lat] }, properties: projectProps(p, c, lens, thresholds) });
  }
  return { type: "FeatureCollection", features: feats };
}

function hoverLabel(props, lens) {
  if (lens === "price")      return props.ppm2 > 0 ? `€${fmt(props.ppm2)}/m²` : "no price";
  if (lens === "supply")     return `${props.available} available`;
  if (lens === "absorption") return props.soldPct == null ? "absorption —" : `${props.soldPct}% sold`;
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
  if (analyze) analyze.onclick = () => handlers.onAnalyze({ lng: props.lng, lat: props.lat });
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
  const [fCity, setFCity] = useState("");
  const [fDistrict, setFDistrict] = useState("");
  const [fDeveloper, setFDeveloper] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [analysisCenter, setAnalysisCenter] = useState(null);
  const [radiusKm, setRadiusKm] = useState(1.5);
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  useEffect(() => { setCurrentRef.current = setCurrent; }, [setCurrent]);
  useEffect(() => { countryRef.current = country; }, [country]);
  useEffect(() => { lensRef.current = lens; }, [lens]);
  useEffect(() => { onAnalyzeRef.current = (ll) => setAnalysisCenter(ll); }, []);

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

  const cityOptions = useMemo(() => uniqueSorted((projects || []).map((p) => p.city)), [projects]);
  const districtOptions = useMemo(() => uniqueSorted((projects || []).filter((p) => !fCity || p.city === fCity).map((p) => p.district)), [projects, fCity]);
  const developerOptions = useMemo(() => uniqueSorted((projects || []).map((p) => p.developer)), [projects]);

  const shown = useMemo(() => {
    const q = norm(nameQuery);
    return (projects || []).filter((p) => {
      if (fCity && p.city !== fCity) return false;
      if (fDistrict && p.district !== fDistrict) return false;
      if (fDeveloper && p.developer !== fDeveloper) return false;
      if (q && !norm(p.name).includes(q)) return false;
      return true;
    });
  }, [projects, fCity, fDistrict, fDeveloper, nameQuery]);

  const thresholds = useMemo(() => (lens === "completion" ? null : tertiles(shown.map((p) => metricValue(p, lens)))), [shown, lens]);
  const lensCoverage = useMemo(() => coverage(shown, lens), [shown, lens]);
  const fc = useMemo(() => buildFeatures(shown, coords || {}, lens, thresholds, verifiedOnly), [shown, coords, lens, thresholds, verifiedOnly]);
  useEffect(() => { featuresRef.current = fc; }, [fc]);

  // KPI context for the current filtered view.
  const kpis = useMemo(() => {
    const priced = shown.map(ppm2Of).filter((v) => v > 0).sort((a, b) => a - b);
    const med = priced.length ? priced[Math.floor((priced.length - 1) / 2)] : null;
    const units = shown.reduce((s, p) => s + (Number(p.total_units) || 0), 0);
    const abs = shown.map((p) => p.sold_percentage).filter((v) => v != null).map(Number);
    const avgAbs = abs.length ? Math.round(abs.reduce((a, b) => a + b, 0) / abs.length) : null;
    return { count: shown.length, med, units, avgAbs };
  }, [shown]);

  const compSet = useMemo(() => computeCompetitiveSet(shown, coords, analysisCenter, radiusKm, verifiedOnly), [shown, coords, analysisCenter, radiusKm, verifiedOnly]);

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
    map.on("moveend", () => { savedView = { center: map.getCenter().toArray(), zoom: map.getZoom() }; });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);

    map.on("load", () => {
      if (mapRef.current !== map) return;
      map.addSource("radius", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": green, "fill-opacity": 0.07 } });
      map.addLayer({ id: "radius-line", type: "line", source: "radius", paint: { "line-color": green, "line-width": 1.5, "line-dasharray": [2, 2] } });

      map.addSource("projects", { type: "geojson", data: featuresRef.current });
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
        setAnalysisCenter({ lng: e.lngLat.lng, lat: e.lngLat.lat });
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
        mk.on("dragend", () => { const ll = mk.getLngLat(); setAnalysisCenter({ lng: ll.lng, lat: ll.lat }); });
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
    setFCity(""); setFDistrict(""); setFDeveloper(""); setNameQuery(""); setAnalysisCenter(null);
  }, [country]);

  const openProject = (id) => setCurrentRef.current && setCurrentRef.current("App:ProjectDetail:" + id);
  const isLoading = loading || coords === null;
  const legend = legendForLens(lens, thresholds, fmt);
  const activeLens = LENSES.find((l) => l.key === lens);

  return (
    <div style={{ height: "calc(100dvh - 64px)", display: "flex", flexDirection: "column", background: bg2 }}>
      {/* Lens bar + KPI context */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", flexWrap: "wrap", padding: "0.6rem 1.25rem", borderBottom: `1px solid ${border}`, background: "#0a0a0b" }}>
        <span style={{ fontSize: "0.72rem", color: dim }}>{sk ? "Mapa ukazuje" : "Map shows"}</span>
        <div style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
          {LENSES.map((l) => <button key={l.key} onClick={() => setLens(l.key)} style={chipStyle(lens === l.key)}>{l.label}</button>)}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: "1.1rem", fontSize: "0.72rem", color: dim, fontFamily: mono }}>
          <span><strong style={{ color: textLight }}>{kpis.count}</strong> {sk ? "projektov" : "projects"}</span>
          <span>{kpis.med ? <><strong style={{ color: textLight }}>€{fmt(kpis.med)}</strong>/m²</> : "—"}</span>
          <span><strong style={{ color: textLight }}>{fmtK(kpis.units)}</strong> {sk ? "bytov" : "units"}</span>
          <span>{kpis.avgAbs != null ? <><strong style={{ color: textLight }}>{kpis.avgAbs}%</strong> {sk ? "predané" : "sold"}</> : "—"}</span>
        </div>
      </div>

      {/* Lens description + coverage */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap", padding: "0.45rem 1.25rem", borderBottom: `1px solid ${border}`, background: "#08080a" }}>
        <span style={{ fontSize: "0.72rem", color: dim }}>{activeLens?.desc}</span>
        <span style={{ fontSize: "0.66rem", color: lensCoverage < 0.4 ? amber : dim, marginLeft: "auto" }}>
          {sk ? "dáta pre" : "data for"} <strong style={{ fontFamily: mono }}>{pct(lensCoverage)}</strong> {sk ? "projektov" : "of projects"}
          {lensCoverage < 0.4 ? (sk ? " — zvyšok neznámy" : " — rest unknown") : ""}
        </span>
      </div>

      {/* Filter bar + legend */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.55rem 1.25rem", borderBottom: `1px solid ${border}`, background: panel }}>
        <input value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} placeholder={sk ? "Hľadať projekt…" : "Find project…"} style={{ ...inputStyle, flex: "1 1 160px", maxWidth: 220 }} />
        <select value={fCity} onChange={(e) => { setFCity(e.target.value); setFDistrict(""); }} style={selectStyle} aria-label="City">
          <option value="">{sk ? "Mesto — všetky" : "City — all"}</option>{cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fDistrict} onChange={(e) => setFDistrict(e.target.value)} style={selectStyle} aria-label="District">
          <option value="">{sk ? "Časť — všetky" : "District — all"}</option>{districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={fDeveloper} onChange={(e) => setFDeveloper(e.target.value)} style={selectStyle} aria-label="Developer">
          <option value="">{sk ? "Developer — všetci" : "Developer — all"}</option>{developerOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button onClick={() => setVerifiedOnly((v) => !v)} style={chipStyle(verifiedOnly)} title={sk ? "Len presné polohy" : "Only precise locations"}>
          ◉ {sk ? "presné polohy" : "precise only"}
        </button>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, marginLeft: "auto", fontSize: "0.66rem", color: dim, flexWrap: "wrap" }}>
          {legend.map((it) => <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: it.color, display: "inline-block" }} />{it.label}</span>)}
        </div>
      </div>

      {/* Map + competitive panel */}
      <div style={{ position: "relative", flex: 1, minHeight: 360 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

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
                <button onClick={() => setAnalysisCenter(null)} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "0.95rem" }} aria-label="Clear">✕</button>
              </div>
              <div style={{ fontSize: "0.7rem", color: dim, marginBottom: 9 }}>{sk ? "v okruhu" : "within"} <strong style={{ color: textLight, fontFamily: mono }}>{radiusKm.toFixed(1)} km</strong></div>
              <input type="range" min="0.5" max="5" step="0.5" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} style={{ width: "100%", marginBottom: 12, accentColor: green }} aria-label="Radius km" />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: compSet && compSet.placeholderCount ? 8 : 12 }}>
                <Stat label={sk ? "Projekty" : "Projects"} value={compSet ? compSet.inside.length : 0} />
                <Stat label={sk ? "Medián €/m²" : "Median €/m²"} value={compSet && compSet.median ? fmt(compSet.median) : "—"} sub={compSet && compSet.priceLo ? `${fmt(compSet.priceLo)}–${fmt(compSet.priceHi)}` : ""} />
                <Stat label={sk ? "Vypredanosť" : "Absorbed"} value={compSet && compSet.avgAbs != null ? compSet.avgAbs + "%" : "—"} />
                <Stat label={sk ? "Byty" : "Units"} value={compSet ? fmtK(compSet.totalUnits) : 0} sub={compSet ? `${fmtK(compSet.availUnits)} ${sk ? "voľných" : "free"}` : ""} />
              </div>

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

                  <div style={{ fontSize: "0.7rem", color: dim, margin: "12px 0 6px" }}>{sk ? "Projekty" : "Projects"} ({compSet.inside.length})</div>
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
const selectStyle = { padding: "7px 9px", background: bg2, border: `1px solid ${border}`, borderRadius: 7, color: textLight, fontSize: "0.8rem", outline: "none", cursor: "pointer", maxWidth: 170 };
function chipStyle(active) {
  return { padding: "6px 12px", borderRadius: 999, cursor: "pointer", fontSize: "0.76rem", border: `1px solid ${active ? green : border}`, background: active ? `${green}1a` : "transparent", color: active ? green : dim };
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
