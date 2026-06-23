/**
 * MapView2 — PROPOSAL / preview of a DEVELOPER-facing market-intelligence map.
 *
 * A copy of the live Map view, re-cast for property developers (not home buyers).
 * Three coordinated ideas, all on the SAME public project aggregates the live map
 * already reads (projects_live + project_coords) — no new backend:
 *
 *   1. LENS — one control sets what the dots ENCODE: price €/m² · supply ·
 *      absorption · completion. Same dots, different meaning. Size = project units.
 *   2. AREA OF INTEREST — click the map near a site → a radius → the competitive
 *      set within it gets summarised (count, median €/m², absorption, units,
 *      completion timeline, top developers).
 *   3. DRILL — open any project's detail page, same as the live map.
 *
 * Lives at /app/map-2 next to the live Map so it can be compared side by side.
 * The live MapView.jsx is untouched. This is a preview to decide on, not final.
 */
import { useEffect, useRef, useState, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useProjects } from "../lib/useData";
import { useCountry } from "../lib/useCountry";
import { supabasePublic, isSupabaseReady } from "../lib/supabase";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const greyPt = "#6b6b76";
const dim = "#8a8a96";
const textLight = "#e8e8ed";
const border = "#222228";
const bg2 = "#0e0e10";
const panel = "#141418";

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const FALLBACK_CENTER = [18.5, 48.7];
const FALLBACK_ZOOM = 6.2;

// Sequential low → high ramp for the price / supply / absorption lenses.
const RAMP = ["#3aa0ff", "#f5a623", "#ff5d5d"]; // low blue · mid amber · high red
const NO_DATA = greyPt;
// Completion is categorical.
const COMPLETION = {
  ready:   { color: green,     label: "ready / done" },
  soon:    { color: "#3aa0ff", label: "next year" },
  mid:     { color: "#f5a623", label: "+2 years" },
  far:     { color: "#ff5d5d", label: "later" },
  unknown: { color: greyPt,    label: "unknown" },
};

const LENSES = [
  { key: "price",      label: "Price €/m²" },
  { key: "supply",     label: "Supply" },
  { key: "absorption", label: "Absorption" },
  { key: "completion", label: "Completion" },
];

let savedView = null;

const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const uniqueSorted = (arr) =>
  Array.from(new Set(arr.filter((v) => v != null && String(v).trim() !== ""))).sort((a, b) =>
    String(a).localeCompare(String(b), "sk", { sensitivity: "base" })
  );
const fmt = (n) => Number(Math.round(n)).toLocaleString("sk-SK");

function distanceKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Approx circle as a polygon (good enough at city scale) for the radius ring.
function circlePolygon(center, radiusKm, steps = 72) {
  const latR = (center.lat * Math.PI) / 180;
  const dLat = radiusKm / 110.574;
  const dLng = radiusKm / (111.32 * Math.cos(latR));
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([center.lng + dLng * Math.cos(t), center.lat + dLat * Math.sin(t)]);
  }
  return { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] }, properties: {} }] };
}

const ppm2Of = (p) => Math.round(Number(p.avg_price_eur_m2) || 0);

// Raw metric value for the active lens (null = no data → grey).
function metricValue(p, lens) {
  if (lens === "price")      { const v = ppm2Of(p); return v > 0 ? v : null; }
  if (lens === "supply")     { return Number(p.available_units) || 0; }
  if (lens === "absorption") { return p.sold_percentage == null ? null : Number(p.sold_percentage); }
  return null;
}

function completionBucket(p) {
  const k = (p.kolaudacia || "").toString().toLowerCase();
  if (!k) return "unknown";
  if (/skolaud|hotov|dokon|nas[ťt]ah|ready|complet/.test(k)) return "ready";
  const m = k.match(/(20\d{2})/);
  if (m) {
    const y = +m[1], now = new Date().getFullYear();
    if (y <= now) return "ready";
    if (y === now + 1) return "soon";
    if (y === now + 2) return "mid";
    return "far";
  }
  return "unknown";
}

// 33rd / 66th percentile breakpoints over the lens's values in view.
function tertiles(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 3) return null;
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))];
  return [at(1 / 3), at(2 / 3)];
}

function colorFor(p, lens, thresholds) {
  if (lens === "completion") return COMPLETION[completionBucket(p)].color;
  const v = metricValue(p, lens);
  if (v == null) return NO_DATA;
  if (!thresholds) return RAMP[1];
  return v < thresholds[0] ? RAMP[0] : v < thresholds[1] ? RAMP[1] : RAMP[2];
}

function projectProps(p, lens, thresholds) {
  return {
    id: p.id,
    name: p.name || p.id,
    city: p.city || "",
    district: p.district || "",
    developer: p.developer || "",
    ppm2: ppm2Of(p),
    available: Number(p.available_units) || 0,
    total: Number(p.total_units) || 0,
    sold: Number(p.sold_units) || 0,
    soldPct: p.sold_percentage == null ? null : Math.round(Number(p.sold_percentage)),
    units: Number(p.total_units) || Number(p.available_units) || 0,
    color: colorFor(p, lens, thresholds),
  };
}

function buildFeatures(projects, coords, lens, thresholds) {
  const feats = [];
  for (const p of projects) {
    const c = coords[p.id];
    if (!c) continue;
    feats.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      properties: projectProps(p, lens, thresholds),
    });
  }
  return { type: "FeatureCollection", features: feats };
}

function showProjectPopup(map, lngLat, props, onOpen, popupRef) {
  const el = document.createElement("div");
  el.style.minWidth = "180px";
  const loc = [props.city, props.district].filter(Boolean).join(" · ");
  const price = Number(props.ppm2) > 0 ? `€${Number(props.ppm2).toLocaleString("sk-SK")}/m²` : "—";
  el.innerHTML =
    `<div style="font-weight:600;font-size:0.92rem;color:${textLight};margin-bottom:2px">${escapeHtml(props.name)}</div>` +
    `<div style="font-size:0.72rem;color:${dim};margin-bottom:8px">${escapeHtml(loc)}</div>` +
    `<div style="font-family:${mono};font-size:0.72rem;color:${textLight};line-height:1.6">` +
    `<div><span style="color:${dim}">Avg</span> &nbsp;${price}</div>` +
    `<div><span style="color:${dim}">Available</span> &nbsp;${props.available} / ${props.total}</div>` +
    `<div><span style="color:${dim}">Absorbed</span> &nbsp;${props.soldPct == null ? "—" : props.soldPct + "%"}</div></div>` +
    `<button id="mv2-open" style="margin-top:10px;width:100%;padding:7px 10px;background:${green};color:#0a0a0b;` +
    `border:none;border-radius:6px;font-weight:600;font-size:0.78rem;cursor:pointer">Open project →</button>`;
  const btn = el.querySelector("#mv2-open");
  if (btn) btn.onclick = () => onOpen(props.id);
  if (popupRef.current) popupRef.current.remove();
  popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "260px", offset: 12 })
    .setLngLat(lngLat).setDOMContent(el).addTo(map);
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
  const analysisMarkerRef = useRef(null);

  const [lens, setLens] = useState("price");
  const [fCity, setFCity] = useState("");
  const [fDistrict, setFDistrict] = useState("");
  const [fDeveloper, setFDeveloper] = useState("");
  const [nameQuery, setNameQuery] = useState("");
  const [analysisCenter, setAnalysisCenter] = useState(null); // {lng,lat} | null
  const [radiusKm, setRadiusKm] = useState(1.5);

  useEffect(() => { setCurrentRef.current = setCurrent; }, [setCurrent]);
  useEffect(() => { countryRef.current = country; }, [country]);

  // ── Coordinates (public read-only view) ──
  useEffect(() => {
    if (!isSupabaseReady() || !supabasePublic) { setCoords({}); return; }
    let cancelled = false;
    supabasePublic.from("project_coords").select("id,lat,lng,location_verified").then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.error("[project_coords]", error); setCoords({}); return; }
      const m = {};
      (data || []).forEach((r) => {
        if (r.lat != null && r.lng != null) m[r.id] = { lat: Number(r.lat), lng: Number(r.lng), verified: r.location_verified };
      });
      setCoords(m);
    });
    return () => { cancelled = true; };
  }, []);

  // ── Filter option lists ──
  const cityOptions = useMemo(() => uniqueSorted((projects || []).map((p) => p.city)), [projects]);
  const districtOptions = useMemo(
    () => uniqueSorted((projects || []).filter((p) => !fCity || p.city === fCity).map((p) => p.district)),
    [projects, fCity]
  );
  const developerOptions = useMemo(() => uniqueSorted((projects || []).map((p) => p.developer)), [projects]);

  // ── Filters → the working set the lens + analysis run over ──
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

  // ── Lens thresholds (data-driven tertiles over the visible set) ──
  const thresholds = useMemo(() => {
    if (lens === "completion") return null;
    return tertiles(shown.map((p) => metricValue(p, lens)));
  }, [shown, lens]);

  const fc = useMemo(() => buildFeatures(shown, coords || {}, lens, thresholds), [shown, coords, lens, thresholds]);
  useEffect(() => { featuresRef.current = fc; }, [fc]);

  const placed = fc.features.length;

  // ── Competitive set within the radius of the chosen point ──
  const compSet = useMemo(() => {
    if (!analysisCenter || !coords) return null;
    const inside = shown.filter((p) => {
      const c = coords[p.id];
      return c && distanceKm(analysisCenter, c) <= radiusKm;
    });
    const priced = inside.map(ppm2Of).filter((v) => v > 0).sort((a, b) => a - b);
    const median = priced.length ? priced[Math.floor((priced.length - 1) / 2)] : null;
    const totalUnits = inside.reduce((s, p) => s + (Number(p.total_units) || 0), 0);
    const availUnits = inside.reduce((s, p) => s + (Number(p.available_units) || 0), 0);
    const absVals = inside.map((p) => p.sold_percentage).filter((v) => v != null).map(Number);
    const avgAbs = absVals.length ? Math.round(absVals.reduce((a, b) => a + b, 0) / absVals.length) : null;
    const comp = { ready: 0, soon: 0, mid: 0, far: 0, unknown: 0 };
    inside.forEach((p) => { comp[completionBucket(p)]++; });
    const byDev = {};
    inside.forEach((p) => { const d = p.developer || "—"; (byDev[d] = byDev[d] || []).push(p); });
    const topDevs = Object.entries(byDev)
      .map(([d, ps]) => ({ dev: d, n: ps.length, ppm2: (() => { const v = ps.map(ppm2Of).filter((x) => x > 0); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; })() }))
      .sort((a, b) => b.n - a.n).slice(0, 4);
    return { inside, median, totalUnits, availUnits, avgAbs, comp, topDevs };
  }, [analysisCenter, coords, shown, radiusKm]);

  function fitToData(map, data, animate) {
    if (!data.features.length) { map.jumpTo({ center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM }); return; }
    const b = new maplibregl.LngLatBounds();
    data.features.forEach((f) => b.extend(f.geometry.coordinates));
    if (!b.isEmpty()) map.fitBounds(b, { padding: 70, maxZoom: 13, duration: animate ? 600 : 0 });
  }

  // ── Initialise the map once ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const hadSavedView = savedView != null;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: hadSavedView ? savedView.center : FALLBACK_CENTER,
      zoom: hadSavedView ? savedView.zoom : FALLBACK_ZOOM,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("moveend", () => { savedView = { center: map.getCenter().toArray(), zoom: map.getZoom() }; });

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);

    map.on("load", () => {
      if (mapRef.current !== map) return;
      // Radius ring (under the points)
      map.addSource("radius", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "radius-fill", type: "fill", source: "radius", paint: { "fill-color": green, "fill-opacity": 0.06 } });
      map.addLayer({ id: "radius-line", type: "line", source: "radius", paint: { "line-color": green, "line-width": 1.5, "line-dasharray": [2, 2] } });

      // Project points — colour encodes the active lens, size encodes units. No
      // clustering: clusters would hide the very pattern the lens is meant to show.
      map.addSource("projects", { type: "geojson", data: featuresRef.current });
      map.addLayer({
        id: "points", type: "circle", source: "projects",
        paint: {
          "circle-color": ["get", "color"],
          "circle-radius": ["interpolate", ["linear"], ["get", "units"], 0, 5, 30, 7, 80, 11, 200, 16, 500, 22],
          "circle-opacity": 0.9,
          "circle-stroke-width": 1.2, "circle-stroke-color": "#0a0a0b",
        },
      });

      readyRef.current = true;
      if (hadSavedView) fitKeyRef.current = countryRef.current;
      else if (featuresRef.current.features.length) { fitToData(map, featuresRef.current, false); fitKeyRef.current = countryRef.current; }

      map.on("click", "points", (e) => {
        const f = e.features[0];
        showProjectPopup(map, f.geometry.coordinates, f.properties,
          (id) => { setCurrentRef.current && setCurrentRef.current("App:ProjectDetail:" + id); }, popupRef);
      });
      // A click on the map (not on a project) drops the analysis point.
      map.on("click", (e) => {
        const hit = map.queryRenderedFeatures(e.point, { layers: ["points"] });
        if (hit && hit.length) return;
        setAnalysisCenter({ lng: e.lngLat.lng, lat: e.lngLat.lat });
      });
      map.on("mouseenter", "points", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "points", () => { map.getCanvas().style.cursor = ""; });
    });

    return () => {
      if (ro) ro.disconnect();
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      if (analysisMarkerRef.current) { analysisMarkerRef.current.remove(); analysisMarkerRef.current = null; }
      map.remove(); mapRef.current = null; readyRef.current = false;
    };
  }, []);

  // ── Push data + recolour on lens/filter change; auto-fit on first data + country ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("projects");
    if (src) src.setData(fc);
    if (fc.features.length && fitKeyRef.current !== country) {
      fitToData(map, fc, fitKeyRef.current !== null);
      fitKeyRef.current = country;
    }
  }, [fc, country]);

  // ── Draw / move the radius ring + analysis marker ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("radius");
    if (analysisCenter) {
      if (src) src.setData(circlePolygon(analysisCenter, radiusKm));
      if (!analysisMarkerRef.current) {
        const el = document.createElement("div");
        el.style.cssText = `width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${green};border:2px solid #0a0a0b;box-shadow:0 0 0 2px ${green}55`;
        analysisMarkerRef.current = new maplibregl.Marker({ element: el }).setLngLat([analysisCenter.lng, analysisCenter.lat]).addTo(map);
      } else {
        analysisMarkerRef.current.setLngLat([analysisCenter.lng, analysisCenter.lat]);
      }
    } else {
      if (src) src.setData({ type: "FeatureCollection", features: [] });
      if (analysisMarkerRef.current) { analysisMarkerRef.current.remove(); analysisMarkerRef.current = null; }
    }
  }, [analysisCenter, radiusKm]);

  // ── Country switch resets the view ──
  const firstCountry = useRef(true);
  useEffect(() => {
    if (firstCountry.current) { firstCountry.current = false; return; }
    setFCity(""); setFDistrict(""); setFDeveloper(""); setNameQuery(""); setAnalysisCenter(null);
  }, [country]);

  const openProject = (id) => setCurrentRef.current && setCurrentRef.current("App:ProjectDetail:" + id);
  const isLoading = loading || coords === null;
  const legend = legendForLens(lens, thresholds);

  return (
    <div style={{ height: "calc(100dvh - 64px)", display: "flex", flexDirection: "column", background: bg2 }}>
      {/* Lens bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap", padding: "0.7rem 1.25rem", borderBottom: `1px solid ${border}`, background: "#0a0a0b" }}>
        <span style={{ fontSize: "0.72rem", color: dim }}>{sk ? "Mapa zobrazuje" : "Map shows"}</span>
        <div style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
          {LENSES.map((l) => (
            <button key={l.key} onClick={() => setLens(l.key)} style={chipStyle(lens === l.key)}>{l.label}</button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: dim }}>
          <strong style={{ color: green, fontFamily: mono }}>{placed}</strong> {sk ? "projektov" : "projects"} · {sk ? "veľkosť = počet bytov" : "size = units"}
        </span>
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", padding: "0.55rem 1.25rem", borderBottom: `1px solid ${border}`, background: panel }}>
        <input value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} placeholder={sk ? "Hľadať projekt…" : "Find project…"} style={{ ...inputStyle, flex: "1 1 180px", maxWidth: 240 }} />
        <select value={fCity} onChange={(e) => { setFCity(e.target.value); setFDistrict(""); }} style={selectStyle} aria-label="City">
          <option value="">{sk ? "Mesto — všetky" : "City — all"}</option>
          {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fDistrict} onChange={(e) => setFDistrict(e.target.value)} style={selectStyle} aria-label="District">
          <option value="">{sk ? "Časť — všetky" : "District — all"}</option>
          {districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select value={fDeveloper} onChange={(e) => setFDeveloper(e.target.value)} style={selectStyle} aria-label="Developer">
          <option value="">{sk ? "Developer — všetci" : "Developer — all"}</option>
          {developerOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {/* Legend */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, marginLeft: "auto", fontSize: "0.68rem", color: dim, flexWrap: "wrap" }}>
          {legend.map((it) => (
            <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: it.color, display: "inline-block" }} />{it.label}
            </span>
          ))}
        </div>
      </div>

      {/* Map + competitive panel */}
      <div style={{ position: "relative", flex: 1, minHeight: 360 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

        {/* Competitive-set panel */}
        <div style={{ position: "absolute", top: 12, right: 12, width: 290, maxWidth: "calc(100% - 24px)", maxHeight: "calc(100% - 24px)", overflowY: "auto", background: "rgba(14,14,16,0.96)", border: `1px solid ${border}`, borderRadius: 12, boxShadow: "0 12px 30px rgba(0,0,0,0.5)", padding: "14px 15px" }}>
          {!analysisCenter ? (
            <div style={{ color: dim, fontSize: "0.8rem", lineHeight: 1.6 }}>
              <div style={{ color: textLight, fontWeight: 600, marginBottom: 6, fontSize: "0.85rem" }}>{sk ? "Konkurenčné okolie" : "Competitive set"}</div>
              {sk ? "Klikni na mapu pri pozemku — zhrniem konkurenčné projekty v okruhu." : "Click the map near a site — I'll summarise the competing projects within a radius."}
            </div>
          ) : (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ color: textLight, fontWeight: 600, fontSize: "0.85rem" }}>{sk ? "Konkurenčné okolie" : "Competitive set"}</span>
                <button onClick={() => setAnalysisCenter(null)} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "0.95rem" }} aria-label="Clear">✕</button>
              </div>
              <div style={{ fontSize: "0.7rem", color: dim, marginBottom: 10 }}>{sk ? "v okruhu" : "within"} {radiusKm.toFixed(1)} km</div>

              <input type="range" min="0.5" max="5" step="0.5" value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} style={{ width: "100%", marginBottom: 12 }} aria-label="Radius km" />

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <Stat label={sk ? "Projekty" : "Projects"} value={compSet ? compSet.inside.length : 0} />
                <Stat label={sk ? "Medián €/m²" : "Median €/m²"} value={compSet && compSet.median ? fmt(compSet.median) : "—"} />
                <Stat label={sk ? "Vypredanosť" : "Absorbed"} value={compSet && compSet.avgAbs != null ? compSet.avgAbs + "%" : "—"} />
                <Stat label={sk ? "Byty" : "Units"} value={compSet ? fmt(compSet.totalUnits) : 0} sub={compSet ? `${fmt(compSet.availUnits)} ${sk ? "voľných" : "free"}` : ""} />
              </div>

              {compSet && compSet.inside.length > 0 && (
                <>
                  <div style={{ fontSize: "0.7rem", color: dim, marginBottom: 6 }}>{sk ? "Dokončenie" : "Completing"}</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                    {[["ready", sk ? "hotové" : "ready"], ["soon", "+1y"], ["mid", "+2y"], ["far", sk ? "neskôr" : "later"]].map(([k, lbl]) => (
                      <div key={k} style={{ flex: 1, textAlign: "center" }}>
                        <div style={{ height: 30, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                          <div style={{ width: 18, height: Math.max(3, (compSet.comp[k] / Math.max(1, compSet.inside.length)) * 30), background: COMPLETION[k].color, borderRadius: 3 }} />
                        </div>
                        <div style={{ fontSize: "0.62rem", color: dim, marginTop: 3 }}>{lbl}</div>
                        <div style={{ fontSize: "0.66rem", color: textLight, fontFamily: mono }}>{compSet.comp[k]}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: "0.7rem", color: dim, marginBottom: 6 }}>{sk ? "Najväčší developeri" : "Top developers"}</div>
                  {compSet.topDevs.map((d) => (
                    <div key={d.dev} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: textLight, padding: "2px 0" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{d.dev}</span>
                      <span style={{ color: dim, fontFamily: mono }}>{d.n} · {d.ppm2 ? "€" + fmt(d.ppm2) : "—"}</span>
                    </div>
                  ))}

                  <div style={{ fontSize: "0.7rem", color: dim, margin: "12px 0 6px" }}>{sk ? "Projekty" : "Projects"}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {compSet.inside.slice(0, 30).map((p) => (
                      <button key={p.id} onClick={() => openProject(p.id)} style={{ display: "flex", justifyContent: "space-between", gap: 8, background: "none", border: "none", color: textLight, cursor: "pointer", fontSize: "0.75rem", padding: "3px 4px", textAlign: "left", borderRadius: 5 }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#1d1d22")} onMouseLeave={(e) => (e.currentTarget.style.background = "none")}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        <span style={{ color: dim, fontFamily: mono, flexShrink: 0 }}>{ppm2Of(p) ? "€" + fmt(ppm2Of(p)) : "—"}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {compSet && compSet.inside.length === 0 && (
                <div style={{ color: dim, fontSize: "0.78rem" }}>{sk ? "Žiadne projekty v okruhu — zväčši okruh alebo klikni inde." : "No projects in range — widen the radius or click elsewhere."}</div>
              )}
            </div>
          )}
        </div>

        {isLoading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: dim, fontFamily: mono, fontSize: "0.8rem", background: "rgba(10,10,11,0.4)", pointerEvents: "none" }}>
            {sk ? "Načítavam mapu…" : "Loading map…"}
          </div>
        )}
      </div>

      <style>{`
        .maplibregl-popup-content { background:${bg2}; color:${textLight}; border:1px solid ${border}; border-radius:10px; padding:12px 13px; box-shadow:0 8px 30px rgba(0,0,0,0.5); }
        .maplibregl-popup-tip { border-top-color:${bg2} !important; border-bottom-color:${bg2} !important; }
        .maplibregl-popup-close-button { color:${dim}; font-size:16px; padding:2px 6px; }
        .maplibregl-ctrl-attrib { font-size:9px; }
        select option { background:${bg2}; color:${textLight}; }
      `}</style>
    </div>
  );
}

function legendForLens(lens, thresholds) {
  if (lens === "completion") {
    return [COMPLETION.ready, COMPLETION.soon, COMPLETION.mid, COMPLETION.far, COMPLETION.unknown]
      .map((c) => ({ color: c.color, label: c.label }));
  }
  const unit = lens === "price" ? "€/m²" : lens === "absorption" ? "%" : "u";
  if (!thresholds) return [{ color: RAMP[1], label: lens === "price" ? "€/m²" : lens }, { color: NO_DATA, label: "no data" }];
  const [t1, t2] = thresholds;
  return [
    { color: RAMP[0], label: `< ${fmt(t1)}${unit}` },
    { color: RAMP[1], label: `${fmt(t1)}–${fmt(t2)}` },
    { color: RAMP[2], label: `≥ ${fmt(t2)}${unit}` },
    { color: NO_DATA, label: "no data" },
  ];
}

function Stat({ label, value, sub }) {
  return (
    <div style={{ background: "#141418", borderRadius: 8, padding: "7px 9px" }}>
      <div style={{ fontSize: "0.64rem", color: dim }}>{label}</div>
      <div style={{ fontSize: "1rem", color: textLight, fontWeight: 600, fontFamily: mono }}>{value}</div>
      {sub ? <div style={{ fontSize: "0.6rem", color: dim }}>{sub}</div> : null}
    </div>
  );
}

const inputStyle = { boxSizing: "border-box", padding: "7px 11px", background: bg2, border: `1px solid ${border}`, borderRadius: 7, color: textLight, fontSize: "0.82rem", outline: "none" };
const selectStyle = { padding: "7px 9px", background: bg2, border: `1px solid ${border}`, borderRadius: 7, color: textLight, fontSize: "0.8rem", outline: "none", cursor: "pointer", maxWidth: 180 };
function chipStyle(active) {
  return { padding: "6px 12px", borderRadius: 999, cursor: "pointer", fontSize: "0.76rem", border: `1px solid ${active ? green : border}`, background: active ? `${green}1a` : "transparent", color: active ? green : dim };
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
