/**
 * MapView — all projects plotted on an interactive map, with search + filters.
 *
 * Data flow:
 *   · useProjects()          → the country-scoped project list (names, unit
 *                              counts, prices) — the SAME source the Projects
 *                              table and Dashboard read, so numbers stay in sync.
 *   · public.project_coords  → id → {lat,lng}. A dedicated, read-only view over
 *                              reference.projects(lat,lng). Merged in by id.
 *
 * Search + filters run entirely in-memory over the already-loaded project list
 * (no extra round-trips): a name search-box with type-ahead suggestions, plus
 * Mesto / Časť / Developer / Cena (€/m²) / Stav filters — the same dimensions the
 * Analytics views expose, applied to the map pins. The map re-fits to the result
 * set when a filter narrows it, and selecting a suggestion flies straight to it.
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
import { useCurrency } from "../lib/useCurrency";
import { moneyFromEur, moneySymbol } from "../lib/money";
import { supabasePublic, isSupabaseReady } from "../lib/supabase";

const mono = "'JetBrains Mono', monospace";
import { accent as green, orange as amber, dim, text as textLight, border, surfaceDark as bg2 } from "../lib/theme";
import { getTheme } from "../lib/theme-mode";
const greyPt = "#6b6b76";
const panel = "var(--surface)";

// CARTO vector basemaps — free, no key. Light (positron) in light theme, dark-matter in dark.
// Same cartocdn.com host as before, so the CSP already allows it.
const MAP_STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const MAP_STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const mapStyleUrl = () => (getTheme() === "light" ? MAP_STYLE_LIGHT : MAP_STYLE_DARK);
// SK/CZ fallback view if there's nothing to fit to.
const FALLBACK_CENTER = [18.5, 48.7];
const FALLBACK_ZOOM = 6.2;

// Remembered camera (center/zoom/bearing/pitch) so returning from a project
// detail reopens the map exactly where you left it. Module-level on purpose: it
// survives the component unmount/remount that navigation causes, but is wiped on
// a full page reload → back to the default fitted view, as intended.
let savedView = null;

// Diacritic-insensitive normalise for search/match (Petržalka ↔ petrzalka).
const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const uniqueSorted = (arr) =>
  Array.from(new Set(arr.filter((v) => v != null && String(v).trim() !== ""))).sort((a, b) =>
    String(a).localeCompare(String(b), "sk", { sensitivity: "base" })
  );

// The single source of truth for the properties carried on a map feature AND
// shown in a popup — used by buildFeatures() and by search-select so both render
// identically.
function projectProps(p) {
  return {
    id: p.id,
    name: p.name || p.id,
    city: p.city || "",
    district: p.district || "",
    available: Number(p.available_units) || 0,
    total: Number(p.total_units) || 0,
    sold: Number(p.sold_units) || 0,
    ppm2: Math.round(Number(p.avg_price_eur_m2) || 0),
  };
}

function buildFeatures(projects, coords) {
  const feats = [];
  for (const p of projects) {
    const c = coords[p.id];
    if (!c) continue;
    feats.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c.lng, c.lat] },
      properties: projectProps(p),
    });
  }
  return { type: "FeatureCollection", features: feats };
}

// Build + show the project popup. Shared by the map's point-click handler and by
// search-select, so a clicked pin and a chosen suggestion render the same card.
function showProjectPopup(map, lngLat, props, lang, onOpen, popupRef) {
  const el = document.createElement("div");
  el.style.minWidth = "180px";
  const loc = [props.city, props.district].filter(Boolean).join(" · ");
  const price = Number(props.ppm2) > 0 ? `${moneySymbol()}${Math.round(moneyFromEur(Number(props.ppm2))).toLocaleString("sk-SK")}/m²` : "—";
  el.innerHTML =
    `<div style="font-weight:600;font-size:0.92rem;color:${textLight};margin-bottom:2px">${escapeHtml(props.name)}</div>` +
    `<div style="font-size:0.72rem;color:${dim};margin-bottom:8px">${escapeHtml(loc)}</div>` +
    `<div style="font-family:${mono};font-size:0.72rem;color:${textLight};line-height:1.5">` +
    `<div><span style="color:${dim}">${lang === "sk" ? "Voľné" : "Available"}</span> &nbsp;${props.available} / ${props.total}</div>` +
    `<div><span style="color:${dim}">${lang === "sk" ? "Priem." : "Avg"}</span> &nbsp;${price}</div></div>` +
    `<button id="mv-open" style="margin-top:10px;width:100%;padding:7px 10px;background:${green};color:#0a0a0b;` +
    `border:none;border-radius:6px;font-weight:600;font-size:0.78rem;cursor:pointer">` +
    `${lang === "sk" ? "Otvoriť projekt" : "Open project"} →</button>`;
  const openBtn = el.querySelector("#mv-open");
  if (openBtn) openBtn.onclick = () => onOpen(props.id);
  if (popupRef.current) popupRef.current.remove();
  popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: "260px", offset: 12 })
    .setLngLat(lngLat)
    .setDOMContent(el)
    .addTo(map);
}

export default function MapView({ lang = "en", setCurrent }) {
  const { projects, loading, dataCountry } = useProjects();
  const { country } = useCountry();
  useCurrency(); // subscribe so pin popups re-render in the selected currency
  const sk = lang === "sk";

  const [coords, setCoords] = useState(null);     // id -> {lat,lng,verified} | null while loading
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  const featuresRef = useRef({ type: "FeatureCollection", features: [] });
  const setCurrentRef = useRef(setCurrent);
  const langRef = useRef(lang);
  const countryRef = useRef(country);   // latest country, readable inside the once-mounted load handler
  const fitKeyRef = useRef(null);        // country we've already auto-fitted to (once data was present)
  const popupRef = useRef(null);         // single active popup — clicking pins must not stack popups

  // ── Filter + search state ──
  const [query, setQuery] = useState("");
  const [fCity, setFCity] = useState("");
  const [fDistrict, setFDistrict] = useState("");
  const [fDeveloper, setFDeveloper] = useState("");
  const [fStatus, setFStatus] = useState("all");   // all | available | sold
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const searchWrapRef = useRef(null);

  // Keep these refs on the latest values for the once-mounted (deps []) Mapbox load/click
  // handlers — updated post-commit via effects, never written during render
  // (lint: react-hooks/static-components forbids ref writes during render).
  useEffect(() => { setCurrentRef.current = setCurrent; }, [setCurrent]);
  useEffect(() => { langRef.current = lang; }, [lang]);
  useEffect(() => { countryRef.current = country; }, [country]);

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

  // ── Filter option lists (data-driven, country-scoped via useProjects) ──
  const cityOptions = useMemo(() => uniqueSorted((projects || []).map((p) => p.city)), [projects]);
  const districtOptions = useMemo(
    () => uniqueSorted((projects || []).filter((p) => !fCity || p.city === fCity).map((p) => p.district)),
    [projects, fCity]
  );
  const developerOptions = useMemo(() => uniqueSorted((projects || []).map((p) => p.developer)), [projects]);
  const priceBounds = useMemo(() => {
    let lo = Infinity, hi = 0;
    for (const p of projects || []) {
      const v = Math.round(Number(p.avg_price_eur_m2) || 0);
      if (v > 0) { if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    return Number.isFinite(lo) ? { lo, hi } : { lo: 0, hi: 0 };
  }, [projects]);

  // ── Apply the dropdown/range filters (everything except the name query) ──
  const dropdownFiltered = useMemo(() => {
    let pMin = priceMin === "" ? null : Number(priceMin);
    let pMax = priceMax === "" ? null : Number(priceMax);
    // Tolerate an inverted range (min > max) by swapping, so the user gets the obvious
    // intent instead of a silently-empty map.
    if (pMin != null && pMax != null && pMin > pMax) { const t = pMin; pMin = pMax; pMax = t; }
    const priceActive = pMin != null || pMax != null;
    return (projects || []).filter((p) => {
      if (fCity && p.city !== fCity) return false;
      if (fDistrict && p.district !== fDistrict) return false;
      if (fDeveloper && p.developer !== fDeveloper) return false;
      const avail = Number(p.available_units) || 0;
      if (fStatus === "available" && !(avail > 0)) return false;
      if (fStatus === "sold" && avail > 0) return false;
      if (priceActive) {
        const ppm2 = Math.round(Number(p.avg_price_eur_m2) || 0);
        if (ppm2 <= 0) return false;                       // unknown price can't be confirmed in-range
        if (pMin != null && ppm2 < pMin) return false;
        if (pMax != null && ppm2 > pMax) return false;
      }
      return true;
    });
  }, [projects, fCity, fDistrict, fDeveloper, fStatus, priceMin, priceMax]);

  // ── Name query narrows the dropdown-filtered set → what the map shows ──
  const q = norm(query);
  const shown = useMemo(() => {
    if (!q) return dropdownFiltered;
    return dropdownFiltered.filter((p) => norm(p.name).includes(q));
  }, [dropdownFiltered, q]);

  // ── Type-ahead suggestions: prefix matches first, then contains; capped ──
  const suggestions = useMemo(() => {
    if (!q) return [];
    const starts = [], contains = [];
    for (const p of dropdownFiltered) {
      const n = norm(p.name);
      if (n.startsWith(q)) starts.push(p);
      else if (n.includes(q)) contains.push(p);
      if (starts.length >= 8) break;
    }
    return [...starts, ...contains].slice(0, 8);
  }, [dropdownFiltered, q]);

  const anyFilter = !!(query || fCity || fDistrict || fDeveloper || fStatus !== "all" || priceMin !== "" || priceMax !== "");

  const fc = useMemo(() => buildFeatures(shown, coords || {}), [shown, coords]);
  useEffect(() => { featuresRef.current = fc; }, [fc]);

  const placed = fc.features.length;
  const totalPlaced = useMemo(
    () => (coords ? (projects || []).filter((p) => coords[p.id]).length : 0),
    [projects, coords]
  );
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
      style: mapStyleUrl(),
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

    // Keep the canvas sized to its container even if the layout changes
    // (MapLibre only auto-tracks WINDOW resize, not container-only changes such
    // as a sidebar toggle, split view, or the map mounting before layout settles).
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);

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
      const expandCluster = (e) => {
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
      };
      map.on("click", "clusters", expandCluster);
      map.on("click", "cluster-count", expandCluster);  // clicking the number zooms too

      // Popup on a project point
      map.on("click", "points", (e) => {
        const f = e.features[0];
        showProjectPopup(
          map, f.geometry.coordinates, f.properties, langRef.current,
          (id) => { setCurrentRef.current && setCurrentRef.current("App:ProjectDetail:" + id); },
          popupRef
        );
      });

      ["clusters", "cluster-count", "points"].forEach((layer) => {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
      });
    });

    return () => {
      if (ro) ro.disconnect();
      if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
      map.remove(); mapRef.current = null; readyRef.current = false;
    };
  }, []);

  // ── Push data updates into the map; auto-fit on first data + on country change ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const src = map.getSource("projects");
    if (src) src.setData(fc);
    // Fit when we have points AND haven't yet fitted for this country — but ONLY
    // once the data actually belongs to the selected country. During a country
    // switch useProjects briefly still returns the PREVIOUS country's array;
    // fitting to that (then latching fitKeyRef) is exactly what made SK zoom to
    // CZ and vice-versa. Gate on dataCountry === country so we fit to settled data.
    if (fc.features.length && dataCountry === country && fitKeyRef.current !== country) {
      fitToData(map, fc, fitKeyRef.current !== null);
      fitKeyRef.current = country;
    }
  }, [fc, country, dataCountry]);

  // ── Re-fit to the result set when a NON-search filter narrows it ──
  // (Search typing only filters the pins + offers suggestions; selecting a
  // suggestion flies to it. Dropdown/range/status changes reframe the map.)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const active = fCity || fDistrict || fDeveloper || fStatus !== "all" || priceMin !== "" || priceMax !== "";
    if (!active) return;                          // "show all" is handled by the country/data fit
    if (featuresRef.current.features.length) fitToData(map, featuresRef.current, true);
  }, [fCity, fDistrict, fDeveloper, fStatus, priceMin, priceMax]);

  // ── Country switch: filters are country-scoped, so reset them ──
  const firstCountry = useRef(true);
  useEffect(() => {
    if (firstCountry.current) { firstCountry.current = false; return; }
    setQuery(""); setFCity(""); setFDistrict(""); setFDeveloper("");
    setFStatus("all"); setPriceMin(""); setPriceMax(""); setShowSuggest(false);
  }, [country]);

  // ── Close the suggestion dropdown on outside click ──
  useEffect(() => {
    if (!showSuggest) return;
    const onDown = (e) => { if (searchWrapRef.current && !searchWrapRef.current.contains(e.target)) setShowSuggest(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showSuggest]);

  function selectProject(p) {
    setQuery(p.name);
    setShowSuggest(false);
    setActiveIdx(-1);
    const map = mapRef.current;
    const c = (coords || {})[p.id];
    if (!map) return;
    if (c) {
      map.flyTo({ center: [c.lng, c.lat], zoom: Math.max(map.getZoom(), 14), duration: 700 });
      showProjectPopup(
        map, [c.lng, c.lat], projectProps(p), langRef.current,
        (id) => { setCurrentRef.current && setCurrentRef.current("App:ProjectDetail:" + id); },
        popupRef
      );
    }
  }

  function onSearchKeyDown(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setShowSuggest(true); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      // Only act on a highlighted suggestion (or when there's exactly one), so a plain
      // Enter on free-typed text doesn't surprise-jump to an unrelated first suggestion.
      const pick = activeIdx >= 0 ? suggestions[activeIdx]
                 : (suggestions.length === 1 ? suggestions[0] : null);
      if (pick) { e.preventDefault(); selectProject(pick); }
    } else if (e.key === "Escape") { setShowSuggest(false); setActiveIdx(-1); }
  }

  function clearFilters() {
    setQuery(""); setFCity(""); setFDistrict(""); setFDeveloper("");
    setFStatus("all"); setPriceMin(""); setPriceMax(""); setShowSuggest(false); setActiveIdx(-1);
    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    const map = mapRef.current;
    if (map && readyRef.current) {
      // Re-frame to all placeable projects of this country.
      fitToData(map, buildFeatures(projects || [], coords || {}), true);
    }
  }

  const isLoading = loading || coords === null;

  return (
    <div style={{ height: "calc(100dvh - 64px)", display: "flex", flexDirection: "column", background: bg2 }}>
      {/* Header strip */}
      <div style={{
        display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap",
        padding: "0.85rem 1.25rem", borderBottom: `1px solid ${border}`, background: "var(--surface)",
      }}>
        <div style={{ fontSize: "0.82rem", color: textLight }}>
          <strong style={{ color: green, fontFamily: mono }}>{placed}</strong>
          {anyFilter && totalPlaced > 0 && (
            <span style={{ color: dim }}> {sk ? "z" : "of"} <span style={{ fontFamily: mono }}>{totalPlaced}</span></span>
          )}{" "}
          {sk ? "projektov na mape" : "projects on the map"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", fontSize: "0.72rem", color: dim }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Dot color={green} /> {sk ? "voľné byty" : "available"}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Dot color={greyPt} /> {sk ? "vypredané" : "sold out"}
          </span>
        </div>
        {placeholderCount > 0 && (
          <div style={{
            marginLeft: "auto", fontSize: "0.7rem", color: amber,
            border: `1px solid ${amber}40`, background: `${amber}12`,
            padding: "3px 9px", borderRadius: 20,
          }}>
            📍 {sk
              ? `${placeholderCount} dočasných polôh (presné pozície sa dopĺňajú)`
              : `${placeholderCount} placeholder locations — exact positions being added`}
          </div>
        )}
      </div>

      {/* Filter + search bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap",
        padding: "0.6rem 1.25rem", borderBottom: `1px solid ${border}`, background: panel,
      }}>
        {/* Name search with type-ahead */}
        <div ref={searchWrapRef} style={{ position: "relative", flex: "1 1 240px", minWidth: 200, maxWidth: 360 }}>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setShowSuggest(true); setActiveIdx(-1); }}
            onFocus={() => { if (query) setShowSuggest(true); }}
            onKeyDown={onSearchKeyDown}
            placeholder={sk ? "Hľadať projekt…" : "Search project…"}
            aria-label={sk ? "Hľadať projekt" : "Search project"}
            style={inputStyle}
          />
          {query && (
            <button
              onClick={() => { setQuery(""); setShowSuggest(false); setActiveIdx(-1); }}
              aria-label={sk ? "Zmazať" : "Clear"}
              style={{
                position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", color: dim, cursor: "pointer", fontSize: "1rem", lineHeight: 1, padding: "2px 4px",
              }}
            >×</button>
          )}
          {showSuggest && suggestions.length > 0 && (
            <div style={{
              position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 30,
              background: bg2, border: `1px solid ${border}`, borderRadius: 8, overflow: "hidden",
              boxShadow: "0 12px 30px rgba(0,0,0,0.55)", maxHeight: 320, overflowY: "auto",
            }}>
              {suggestions.map((p, i) => {
                const loc = [p.city, p.district].filter(Boolean).join(" · ");
                const hasCoord = !!(coords || {})[p.id];
                return (
                  <div
                    key={p.id}
                    onMouseDown={(e) => { e.preventDefault(); selectProject(p); }}
                    onMouseEnter={() => setActiveIdx(i)}
                    style={{
                      padding: "8px 11px", cursor: "pointer",
                      background: i === activeIdx ? "var(--surface-3)" : "transparent",
                      borderBottom: i < suggestions.length - 1 ? `1px solid ${border}` : "none",
                    }}
                  >
                    <div style={{ fontSize: "0.82rem", color: textLight, display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                      {!hasCoord && <span style={{ color: amber, fontSize: "0.62rem", flexShrink: 0 }}>{sk ? "bez polohy" : "no pin"}</span>}
                    </div>
                    {loc && <div style={{ fontSize: "0.68rem", color: dim, marginTop: 1 }}>{loc}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* City */}
        <select value={fCity} onChange={(e) => { setFCity(e.target.value); setFDistrict(""); }} style={selectStyle} aria-label={sk ? "Mesto" : "City"}>
          <option value="">{sk ? "Mesto — všetky" : "City — all"}</option>
          {cityOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* District */}
        <select value={fDistrict} onChange={(e) => setFDistrict(e.target.value)} style={selectStyle} aria-label={sk ? "Časť" : "District"}>
          <option value="">{sk ? "Časť — všetky" : "District — all"}</option>
          {districtOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        {/* Developer */}
        <select value={fDeveloper} onChange={(e) => setFDeveloper(e.target.value)} style={selectStyle} aria-label="Developer">
          <option value="">{sk ? "Developer — všetci" : "Developer — all"}</option>
          {developerOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        {/* Price €/m² */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input
            type="number" inputMode="numeric" min="0" value={priceMin}
            onChange={(e) => setPriceMin(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={priceBounds.hi ? String(priceBounds.lo) : (sk ? "od" : "min")}
            aria-label={sk ? "Cena od €/m²" : "Price from €/m²"}
            style={{ ...inputStyle, width: 74, paddingRight: 8 }}
          />
          <span style={{ color: dim, fontSize: "0.72rem" }}>–</span>
          <input
            type="number" inputMode="numeric" min="0" value={priceMax}
            onChange={(e) => setPriceMax(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={priceBounds.hi ? String(priceBounds.hi) : (sk ? "do" : "max")}
            aria-label={sk ? "Cena do €/m²" : "Price to €/m²"}
            style={{ ...inputStyle, width: 74, paddingRight: 8 }}
          />
          <span style={{ color: dim, fontSize: "0.72rem", fontFamily: mono }}>€/m²</span>
        </div>

        {/* Status chips */}
        <div style={{ display: "inline-flex", gap: 4 }}>
          {[
            { k: "all", label: sk ? "Všetky" : "All" },
            { k: "available", label: sk ? "Voľné" : "Available" },
            { k: "sold", label: sk ? "Vypredané" : "Sold out" },
          ].map((s) => (
            <button key={s.k} onClick={() => setFStatus(s.k)} style={chipStyle(fStatus === s.k)}>{s.label}</button>
          ))}
        </div>

        {anyFilter && (
          <button onClick={clearFilters} style={{
            marginLeft: "auto", background: "none", border: `1px solid ${border}`, color: dim,
            borderRadius: 7, padding: "6px 11px", fontSize: "0.74rem", cursor: "pointer",
          }}>
            ✕ {sk ? "Vyčistiť" : "Clear"}
          </button>
        )}
      </div>

      {/* Map */}
      <div style={{ position: "relative", flex: 1, minHeight: 360 }}>
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
        {isLoading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            color: dim, fontFamily: mono, fontSize: "0.8rem", background: "var(--surface-2)", pointerEvents: "none",
          }}>
            {sk ? "Načítavam mapu…" : "Loading map…"}
          </div>
        )}
        {!isLoading && placed === 0 && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            color: dim, fontFamily: mono, fontSize: "0.8rem", textAlign: "center", padding: "2rem", pointerEvents: "none",
          }}>
            {anyFilter
              ? (sk ? "Žiadny projekt nezodpovedá filtrom." : "No projects match the filters.")
              : (sk ? "Žiadne projekty s polohou." : "No projects with a location yet.")}
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
        select option { background:${bg2}; color:${textLight}; }
      `}</style>
    </div>
  );
}

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "7px 26px 7px 11px",
  background: bg2, border: `1px solid ${border}`, borderRadius: 7,
  color: textLight, fontSize: "0.82rem", outline: "none",
};
const selectStyle = {
  padding: "7px 9px", background: bg2, border: `1px solid ${border}`, borderRadius: 7,
  color: textLight, fontSize: "0.8rem", outline: "none", cursor: "pointer", maxWidth: 180,
};
function chipStyle(active) {
  return {
    padding: "6px 11px", borderRadius: 7, cursor: "pointer", fontSize: "0.74rem",
    border: `1px solid ${active ? green : border}`,
    background: active ? `${green}1a` : "transparent",
    color: active ? green : dim,
  };
}

function Dot({ color }) {
  return <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, display: "inline-block" }} />;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
