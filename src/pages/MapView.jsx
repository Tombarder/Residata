/**
 * MapView — all projects plotted on an interactive map.
 *
 * Data flow:
 *   · useProjects()          → the country-scoped project list (names, unit
 *                              counts, prices) — the SAME source the Projects
 *                              table and Dashboard read, so numbers stay in sync.
 *   · public.project_coords  → id → {lat,lng}. A dedicated, read-only view over
 *                              reference.projects(lat,lng). Merged in by id.
 *
 * Projects whose coordinates aren't set yet simply don't appear (and are
 * reported in the header count). Right now most coordinates are PLACEHOLDERS
 * (dropped inside each project's real city) — flagged in the header banner —
 * until the real positions are filled in.
 *
 * Rendering: MapLibre GL + CARTO dark-matter vector basemap (no API key).
 * Points are clustered; clusters zoom on click; a point opens a popup that
 * links straight to the project detail page.
 */
import { useEffect, useRef, useState, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useProjects } from "../lib/useData";
import { useCountry } from "../lib/useCountry";
import { supabasePublic, isSupabaseReady } from "../lib/supabase";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const amber = "#f5a623";
const greyPt = "#6b6b76";
const dim = "#8a8a96";
const textLight = "#e8e8ed";
const border = "#222228";
const bg2 = "#0e0e10";

// CARTO dark-matter vector style — free, no key, ships its own glyphs+sprites.
const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
// SK/CZ fallback view if there's nothing to fit to.
const FALLBACK_CENTER = [18.5, 48.7];
const FALLBACK_ZOOM = 6.2;

// Remembered camera (center/zoom/bearing/pitch) so returning from a project
// detail reopens the map exactly where you left it. Module-level on purpose: it
// survives the component unmount/remount that navigation causes, but is wiped on
// a full page reload → back to the default fitted view, as intended.
let savedView = null;

function buildFeatures(projects, coords) {
  const feats = [];
  for (const p of projects) {
    const c = coords[p.id];
    if (!c) continue;
    feats.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      properties: {
        id: p.id,
        name: p.name || p.id,
        city: p.city || "",
        district: p.district || "",
        available: Number(p.available_units) || 0,
        total: Number(p.total_units) || 0,
        sold: Number(p.sold_units) || 0,
        ppm2: Math.round(Number(p.avg_price_eur_m2) || 0),
      },
    });
  }
  return { type: "FeatureCollection", features: feats };
}

export default function MapView({ lang = "en", setCurrent }) {
  const { projects, loading } = useProjects();
  const { country } = useCountry();

  const [coords, setCoords] = useState(null);     // id -> {lat,lng,verified} | null while loading
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const featuresRef = useRef({ type: "FeatureCollection", features: [] });
  const setCurrentRef = useRef(setCurrent);
  const countryRef = useRef(country);   // latest country, readable inside the once-mounted load handler
  const fitKeyRef = useRef(null);        // country we've already auto-fitted to (once data was present)
  const popupRef = useRef(null);         // single active popup — clicking pins must not stack popups
  setCurrentRef.current = setCurrent;
  countryRef.current = country;

  // ── Load coordinates (anon, public read-only view) ──
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

  const fc = useMemo(
    () => buildFeatures(projects || [], coords || {}),
    [projects, coords]
  );
  featuresRef.current = fc;

  const placed = fc.features.length;
  const placeholderCount = useMemo(() => {
    if (!coords) return 0;
    return fc.features.filter((f) => coords[f.properties.id] && !coords[f.properties.id].verified).length;
  }, [fc, coords]);

  function fitToData(map, data, animate) {
    if (!data.features.length) {
      map.jumpTo({ center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM });
      return;
    }
    const b = new maplibregl.LngLatBounds();
    data.features.forEach((f) => b.extend(f.geometry.coordinates));
    if (!b.isEmpty()) map.fitBounds(b, { padding: 70, maxZoom: 13, duration: animate ? 600 : 0 });
  }

  // ── Initialise the map once ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    // Restore the camera from the last time the map was open this session.
    const hadSavedView = savedView != null;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: hadSavedView ? savedView.center : FALLBACK_CENTER,
      zoom: hadSavedView ? savedView.zoom : FALLBACK_ZOOM,
      bearing: hadSavedView ? savedView.bearing : 0,
      pitch: hadSavedView ? savedView.pitch : 0,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // Remember the camera on every settle, so navigating away + back restores it.
    map.on("moveend", () => {
      savedView = {
        center: map.getCenter().toArray(),
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
    });

    map.on("load", () => {
      if (mapRef.current !== map) return;  // component unmounted before the style finished loading
      map.addSource("projects", {
        type: "geojson",
        data: featuresRef.current,
        cluster: true,
        clusterRadius: 48,
        clusterMaxZoom: 13,
      });

      // Cluster bubbles
      map.addLayer({
        id: "clusters", type: "circle", source: "projects", filter: ["has", "point_count"],
        paint: {
          "circle-color": green, "circle-opacity": 0.85,
          "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 30],
          "circle-stroke-width": 2, "circle-stroke-color": "#0a0a0b",
        },
      });
      map.addLayer({
        id: "cluster-count", type: "symbol", source: "projects", filter: ["has", "point_count"],
        layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Open Sans Bold"], "text-size": 13 },
        paint: { "text-color": "#0a0a0b" },
      });

      // Individual project points — green if anything available, grey if sold out
      map.addLayer({
        id: "points", type: "circle", source: "projects", filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": ["case", ["<=", ["get", "available"], 0], greyPt, green],
          "circle-radius": 7,
          "circle-stroke-width": 1.5, "circle-stroke-color": "#0a0a0b",
        },
      });

      readyRef.current = true;
      if (hadSavedView) {
        // Restored a previous camera — don't auto-fit over where the user left off.
        fitKeyRef.current = countryRef.current;
      } else if (featuresRef.current.features.length) {
        // Data may not have arrived yet — fit now if it has, otherwise the data
        // effect below fits as soon as it does (handles the load-before-data race).
        fitToData(map, featuresRef.current, false);
        fitKeyRef.current = countryRef.current;
      }

      // Click a cluster → smoothly zoom in so the big bubble "opens up" into
      // smaller bubbles / individual pins. MapLibre recomputes clustering at the
      // new zoom, so each click drills down until you reach individual projects
      // (standard cluster-expansion behaviour — Google Maps / Leaflet style).
      map.on("click", "clusters", (e) => {
        const f = map.queryRenderedFeatures(e.point, { layers: ["clusters"] })[0];
        if (!f) return;
        const src = map.getSource("projects");
        src.getClusterExpansionZoom(f.properties.cluster_id)
          .then((zoom) => {
            map.easeTo({
              center: f.geometry.coordinates,
              zoom: Math.max(zoom, map.getZoom() + 0.6),
              duration: 500,
            });
          })
          .catch(() => {});
      });

      // Popup on a project point
      map.on("click", "points", (e) => {
        const f = e.features[0];
        const p = f.properties;
        const el = document.createElement("div");
        el.style.minWidth = "180px";
        const loc = [p.city, p.district].filter(Boolean).join(" · ");
        const price = Number(p.ppm2) > 0 ? `€${Number(p.ppm2).toLocaleString("sk-SK")}/m²` : "—";
        el.innerHTML =
          `<div style="font-weight:600;font-size:0.92rem;color:${textLight};margin-bottom:2px">${escapeHtml(p.name)}</div>` +
          `<div style="font-size:0.72rem;color:${dim};margin-bottom:8px">${escapeHtml(loc)}</div>` +
          `<div style="font-family:${mono};font-size:0.72rem;color:${textLight};line-height:1.5">` +
          `<div><span style="color:${dim}">Available</span> &nbsp;${p.available} / ${p.total}</div>` +
          `<div><span style="color:${dim}">Avg</span> &nbsp;${price}</div></div>` +
          `<button id="mv-open" style="margin-top:10px;width:100%;padding:7px 10px;background:${green};color:#0a0a0b;` +
          `border:none;border-radius:6px;font-weight:600;font-size:0.78rem;cursor:pointer">` +
          `${lang === "sk" ? "Otvoriť projekt" : "Open project"} →</button>`;
        const openBtn = el.querySelector("#mv-open");
        if (openBtn) openBtn.onclick = () => { setCurrentRef.current && setCurrentRef.current("App:ProjectDetail:" + p.id); };
        if (popupRef.current) popupRef.current.remove();
        popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "260px", offset: 12 })
          .setLngLat(f.geometry.coordinates).setDOMContent(el).addTo(map);
      });

      ["clusters", "points"].forEach((layer) => {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
      });
    });

    return () => {
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      map.remove(); mapRef.current = null; readyRef.current = false;
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Push data updates into the map; auto-fit on first data + on country change ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("projects");
    if (src) src.setData(fc);
    // Fit when we actually have points AND haven't yet fitted for this country.
    // Covers the common race where the map loads before the data arrives.
    if (fc.features.length && fitKeyRef.current !== country) {
      fitToData(map, fc, fitKeyRef.current !== null);
      fitKeyRef.current = country;
    }
  }, [fc, country]);

  const isLoading = loading || coords === null;

  return (
    <div style={{ height: "calc(100dvh - 64px)", display: "flex", flexDirection: "column", background: bg2 }}>
      {/* Header strip */}
      <div style={{
        display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap",
        padding: "0.85rem 1.25rem", borderBottom: `1px solid ${border}`, background: "#0a0a0b",
      }}>
        <div style={{ fontSize: "0.82rem", color: textLight }}>
          <strong style={{ color: green, fontFamily: mono }}>{placed}</strong>{" "}
          {lang === "sk" ? "projektov na mape" : "projects on the map"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", fontSize: "0.72rem", color: dim }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Dot color={green} /> {lang === "sk" ? "voľné byty" : "available"}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Dot color={greyPt} /> {lang === "sk" ? "vypredané" : "sold out"}
          </span>
        </div>
        {placeholderCount > 0 && (
          <div style={{
            marginLeft: "auto", fontSize: "0.7rem", color: amber,
            border: `1px solid ${amber}40`, background: `${amber}12`,
            padding: "3px 9px", borderRadius: 20,
          }}>
            📍 {lang === "sk"
              ? `${placeholderCount} dočasných polôh (presné pozície sa dopĺňajú)`
              : `${placeholderCount} placeholder locations — exact positions being added`}
          </div>
        )}
      </div>

      {/* Map */}
      <div style={{ position: "relative", flex: 1, minHeight: 360 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        {isLoading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            color: dim, fontFamily: mono, fontSize: "0.8rem", background: "rgba(10,10,11,0.4)", pointerEvents: "none",
          }}>
            {lang === "sk" ? "Načítavam mapu…" : "Loading map…"}
          </div>
        )}
        {!isLoading && placed === 0 && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            color: dim, fontFamily: mono, fontSize: "0.8rem", textAlign: "center", padding: "2rem",
          }}>
            {lang === "sk" ? "Žiadne projekty s polohou." : "No projects with a location yet."}
          </div>
        )}
      </div>

      {/* Dark popup theming */}
      <style>{`
        .maplibregl-popup-content { background:${bg2}; color:${textLight}; border:1px solid ${border};
          border-radius:10px; padding:12px 13px; box-shadow:0 8px 30px rgba(0,0,0,0.5); }
        .maplibregl-popup-tip { border-top-color:${bg2} !important; border-bottom-color:${bg2} !important; }
        .maplibregl-popup-close-button { color:${dim}; font-size:16px; padding:2px 6px; }
        .maplibregl-ctrl-attrib { font-size:9px; }
      `}</style>
    </div>
  );
}

function Dot({ color }) {
  return <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, display: "inline-block" }} />;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
