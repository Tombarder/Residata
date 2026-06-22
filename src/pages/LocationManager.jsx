/**
 * LocationManager — admin-only tool to set each project's LOCATION + CLASSIFICATION.
 *
 * SINGLE SOURCE OF TRUTH = THE PIN. City + Region are DERIVED from the pin and
 * shown read-only — the only way to change them is to move the pin, so the data
 * can never contradict the dot. City/district are read from the pin by REVERSE-
 * GEOCODING it (Photon/OSM) and matching to our cities + district catalog; if the
 * pin lands outside our known cities a warning shows (never a silent wrong city).
 * Nearest-known-city is only a fallback when the lookup returns nothing.
 *
 * District is a combobox over a pre-loaded, growable catalog (Bratislava/Praha/Brno
 * seeded; new names typed get remembered). Cities with no district catalog (small
 * towns) default to using the city itself as the area, so you needn't district them.
 *
 * Geocoding/reverse are browser-direct (CORS, no key; debounced + abortable +
 * timeout). Save → admin_set_project_location (admin-gated, fails closed). Live
 * by-region/district/city views update immediately; the pivot cube refreshes nightly.
 */
import { useEffect, useRef, useState, useMemo } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const PHOTON = "https://photon.komoot.io/api/";
const PHOTON_REVERSE = "https://photon.komoot.io/reverse";
const BIAS = { SK: { lat: 48.7, lon: 19.5 }, CZ: { lat: 49.8, lon: 15.5 } };

const green = "#00e5a0";
const amber = "#f5a623";
const textLight = "#e8e8ed";
const dim = "#8a8a96";
const border = "#222228";
const bg = "#0a0a0b";
const bg2 = "#0e0e10";
const mono = "'JetBrains Mono', monospace";

// SK + CZ bounding box (minLon, minLat, maxLon, maxLat) — restricts geocoder
// suggestions to our region so we never propose places in New Zealand.
const SKCZ_BBOX = "12.0,47.7,22.6,51.1";

// Direct PostgREST RPC. supabase.rpc() awaits getSession() internally, which can
// HANG/stall for tens of seconds when the auth layer is contended (the cause of
// the "Save timed out"). We read the already-stored access token synchronously
// and call PostgREST ourselves — no getSession, no lock, no hang.
const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
function storedAccessToken() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("sb-") && k.includes("-auth-token")) {
        const v = JSON.parse(localStorage.getItem(k));
        const tok = v?.access_token || v?.currentSession?.access_token || (Array.isArray(v) ? v[0] : null);
        if (tok) return tok;
      }
    }
  } catch { /* ignore */ }
  return null;
}
async function rpcDirect(fn, body, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${storedAccessToken() || ""}` },
      body: JSON.stringify(body || {}),
    });
    if (r.status === 401) throw new Error("session-expired");
    if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => "")).slice(0, 140)}`);
    return await r.json();
  } finally { clearTimeout(killer); }
}

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
function buildLabel(p) {
  const line1 = p.name || [p.street, p.housenumber].filter(Boolean).join(" ");
  const line2 = [p.postcode, p.city || p.county || p.district].filter(Boolean).join(" ");
  return [line1, line2, p.state].filter(Boolean).join(", ") || p.name || "—";
}

export default function LocationManager({ lang = "en" }) {
  const t = (en, sk) => (lang === "sk" ? sk : en);

  const [projects, setProjects] = useState(null);
  const [cities, setCities] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [err, setErr] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("unconfirmed");
  const [country, setCountry] = useState("all");

  const [addr, setAddr] = useState("");
  const [pin, setPin] = useState(null);
  const [cityId, setCityId] = useState("");   // DERIVED from pin (read-only)
  const [cityWarn, setCityWarn] = useState(null); // pin is in a place not in our cities
  const [deriving, setDeriving] = useState(false); // reverse-geocode in flight after a user pin-move
  const [district, setDistrict] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const citiesRef = useRef([]);
  const catalogRef = useRef({ byCity: {}, cityIds: new Set() });
  const cityIdRef = useRef("");
  const revGenRef = useRef(0);
  const userMovedRef = useRef(false);       // true only when the USER moves the pin (not on project load)
  const districtTouchedRef = useRef(false); // true once the user manually edits the district for this placement

  // ── Load projects + cities + districts (direct PostgREST — no getSession) ──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [pj, ci, di] = await Promise.all([
          rpcDirect("admin_list_project_locations", {}),
          rpcDirect("admin_list_cities", {}),
          rpcDirect("admin_list_districts", {}),
        ]);
        if (!alive) return;
        setProjects(pj || []); setCities(ci || []); setDistricts(di || []);
      } catch (e) {
        if (!alive) return;
        setErr(e?.message === "session-expired" ? "Session expired — reload the page." : (e?.message || "load failed"));
        setProjects([]);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { citiesRef.current = cities; }, [cities]);
  useEffect(() => { cityIdRef.current = cityId; }, [cityId]);

  const citiesById = useMemo(() => Object.fromEntries(cities.map((c) => [c.id, c])), [cities]);
  const catalog = useMemo(() => {
    const byCity = {}; const cityIds = new Set();
    for (const d of districts) { (byCity[d.city_id] = byCity[d.city_id] || []).push(d.name); cityIds.add(d.city_id); }
    for (const k of Object.keys(byCity)) byCity[k] = [...new Set(byCity[k])].sort((a, b) => a.localeCompare(b));
    return { byCity, cityIds };
  }, [districts]);
  useEffect(() => { catalogRef.current = catalog; }, [catalog]);

  const cityHasCatalog = (id) => catalog.cityIds.has(id);
  const cityNameOf = (id) => citiesById[id]?.name || "";
  const regionNameOf = (id) => citiesById[id]?.region_name || "—";
  const districtOptions = catalog.byCity[cityId] || [];

  function nearestCity(lat, lng, list) {
    let best = null, bestD = Infinity;
    for (const c of list) {
      if (c.lat == null || c.lng == null) continue;
      const dl = lat - Number(c.lat), dn = lng - Number(c.lng);
      const d = dl * dl + dn * dn;
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }
  function matchCity(name, cc) {
    const n = norm(name);
    return citiesRef.current.find((c) => norm(c.name) === n && (!cc || c.country_code === cc)) || null;
  }
  async function reverseGeocode(lat, lng) {
    const ctrl = new AbortController();
    const killer = setTimeout(() => ctrl.abort(), 8000); // never let a slow lookup hang the UI
    try {
      const r = await fetch(`${PHOTON_REVERSE}?lat=${lat}&lon=${lng}&limit=1`, { signal: ctrl.signal });
      if (!r.ok) return null;
      const p = ((await r.json()).features || [])[0]?.properties || {};
      return { city: p.city, district: p.district, cc: p.countrycode };
    } catch { return null; }
    finally { clearTimeout(killer); }
  }
  function smallCityDistrict(cid) { return catalogRef.current.cityIds.has(cid) ? "" : (citiesById[cid]?.name || ""); }

  const selected = useMemo(() => (projects || []).find((p) => p.id === selectedId) || null, [projects, selectedId]);
  const confirmedCount = useMemo(() => (projects || []).filter((p) => p.location_verified).length, [projects]);
  const noDistrictCount = useMemo(
    () => (projects || []).filter((p) => p.status === "active" && catalog.cityIds.has(p.city_id) && (!p.district || !p.district.trim())).length,
    [projects, catalog]);
  const total = (projects || []).length;

  const filtered = useMemo(() => {
    let list = projects || [];
    if (country !== "all") list = list.filter((p) => p.country_code === country);
    if (filter === "unconfirmed") list = list.filter((p) => !p.location_verified);
    else if (filter === "confirmed") list = list.filter((p) => p.location_verified);
    else if (filter === "nodistrict") list = list.filter((p) => catalog.cityIds.has(p.city_id) && (!p.district || !p.district.trim()));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => (p.name || "").toLowerCase().includes(q) || (p.city_name || "").toLowerCase().includes(q) || (p.district || "").toLowerCase().includes(q));
    return list;
  }, [projects, country, filter, search, catalog]);

  // ── Map ──
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: [18.5, 48.7], zoom: 6.2, attributionControl: true });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const marker = new maplibregl.Marker({ draggable: true, color: green });
    markerRef.current = marker;
    const onMove = (lat, lng) => { userMovedRef.current = true; setDeriving(true); setPin({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) }); setSuggestions([]); };
    marker.on("dragend", () => { const ll = marker.getLngLat(); onMove(ll.lat, ll.lng); });
    map.on("click", (e) => onMove(e.lngLat.lat, e.lngLat.lng));
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.resize()) : null;
    if (ro && containerRef.current) ro.observe(containerRef.current);
    return () => { if (ro) ro.disconnect(); marker.remove(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, marker = markerRef.current;
    if (!map || !marker) return;
    if (pin) marker.setLngLat([pin.lng, pin.lat]).addTo(map); else marker.remove();
  }, [pin]);

  // ── Pin drives City + Region (reverse-geocode → match; suggest district) ──
  // ONLY when the user moved the pin. Loading a saved project shows its saved
  // classification verbatim — re-deriving would let the map service silently
  // overwrite a city/district the Boss confirmed.
  useEffect(() => {
    if (!pin || !citiesRef.current.length) return;
    if (!userMovedRef.current) return;
    userMovedRef.current = false;
    const gen = ++revGenRef.current;
    (async () => {
      const info = await reverseGeocode(pin.lat, pin.lng);
      if (gen !== revGenRef.current) return; // superseded by a newer pin
      const matched = info?.city ? matchCity(info.city, info.cc) : null;
      const finalCity = matched || nearestCity(pin.lat, pin.lng, citiesRef.current);
      const cityChanged = finalCity?.id !== cityIdRef.current;
      setCityId(finalCity?.id || "");
      setCityWarn(info?.city && !matched ? info.city : null);
      // The pin is the source of truth: re-derive the district from the new point —
      // UNLESS the user manually typed one (and the city didn't change, which would
      // invalidate a typed district anyway).
      if (cityChanged || !districtTouchedRef.current) {
        // Only trust the pin's district if it's a name in OUR catalog (keeps our
        // naming, e.g. SK mestská časť "Petržalka"). The map service returns
        // numbered districts for Praha ("Praha 10") that clash with our cadastral
        // names ("Vinohrady") — for those, leave it empty so you pick from the list.
        const fromPin = info?.district && info.district.trim();
        const cat = catalogRef.current.byCity[finalCity?.id] || [];
        const inCatalog = fromPin && cat.some((d) => norm(d) === norm(fromPin));
        setDistrict(inCatalog ? fromPin : smallCityDistrict(finalCity?.id));
      }
      setDeriving(false); // city/district now match the pin → Save allowed
    })();
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2800); return () => clearTimeout(id); }, [toast]);
  useEffect(() => () => { clearTimeout(debounceRef.current); if (abortRef.current) abortRef.current.abort(); }, []);

  // Bias geocoding to where the project actually is (its pin, else its city centre),
  // so suggestions are local — like Google Maps near you, not in New Zealand.
  function searchBias() {
    if (pin) return { lat: pin.lat, lon: pin.lng };
    const c = citiesById[selected?.city_id];
    if (c && c.lat != null) return { lat: Number(c.lat), lon: Number(c.lng) };
    const b = BIAS[selected?.country_code] || BIAS.SK;
    return { lat: b.lat, lon: b.lon };
  }

  // ── Forward geocode (browser-direct, SK/CZ only, biased to the project) ──
  async function doSearch(q, cc, biasLat, biasLon) {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController(); abortRef.current = ctrl;
    const killer = setTimeout(() => ctrl.abort(), 8000);
    setSearching(true);
    try {
      const fb = BIAS[cc] || BIAS.SK;
      const lat = biasLat != null ? biasLat : fb.lat, lon = biasLon != null ? biasLon : fb.lon;
      const r = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=8&lang=default&lat=${lat}&lon=${lon}&bbox=${SKCZ_BBOX}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error("geocoder " + r.status);
      const feats0 = ((await r.json()).features || []).filter((f) => f.geometry?.coordinates?.length === 2);
      // STRICT: only SK/CZ — never fall back to worldwide results.
      const feats = feats0.filter((f) => ["SK", "CZ"].includes(f.properties?.countrycode));
      const seen = new Set(); const out = [];
      for (const f of feats) {
        const lat = +f.geometry.coordinates[1].toFixed(6), lng = +f.geometry.coordinates[0].toFixed(6);
        const label = buildLabel(f.properties); const key = label + lat + lng;
        if (seen.has(key)) continue; seen.add(key);
        out.push({ label, lat, lng, cc: f.properties?.countrycode });
      }
      if (abortRef.current === ctrl) setSuggestions(out);
    } catch (e) { if (e.name !== "AbortError" && abortRef.current === ctrl) setSuggestions([]); }
    finally { clearTimeout(killer); if (abortRef.current === ctrl) { setSearching(false); abortRef.current = null; } }
  }

  function onAddrChange(value) {
    setAddr(value); clearTimeout(debounceRef.current);
    const q = value.trim();
    if (q.length < 3) { if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; } setSuggestions([]); setSearching(false); return; }
    setSearching(true);
    debounceRef.current = setTimeout(() => { const b = searchBias(); doSearch(q, selected?.country_code, b.lat, b.lon); }, 320);
  }

  function pick(s) {
    clearTimeout(debounceRef.current);
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    userMovedRef.current = true; districtTouchedRef.current = false; setDeriving(true); // fresh placement → derive city/district before Save is allowed
    setPin({ lat: s.lat, lng: s.lng }); setAddr(s.label); setSuggestions([]); setSearching(false);
    if (mapRef.current) mapRef.current.flyTo({ center: [s.lng, s.lat], zoom: 16, duration: 600 });
  }

  function selectProject(p) {
    clearTimeout(debounceRef.current);
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    revGenRef.current++;             // cancel any in-flight reverse-geocode
    userMovedRef.current = false;    // loading a project is NOT a user pin-move → keep saved classification
    districtTouchedRef.current = false;
    setSelectedId(p.id); setSuggestions([]); setCityWarn(null); setDeriving(false);
    const lat = p.lat != null ? Number(p.lat) : null, lng = p.lng != null ? Number(p.lng) : null;
    const located = p.location_verified && lat != null && lng != null;
    setCityId(p.city_id || "");
    setDistrict(p.district && p.district.trim() ? p.district : (catalog.cityIds.has(p.city_id) ? "" : cityNameOf(p.city_id)));
    if (located) {
      setAddr(p.address || ""); setPin({ lat, lng }); // shows the saved pin; no re-derive (userMovedRef=false)
      if (mapRef.current) mapRef.current.flyTo({ center: [lng, lat], zoom: 15, duration: 600 });
    } else {
      setPin(null);
      setAddr([p.name, p.city_name].filter(Boolean).join(", "));
      if (lat != null && lng != null && mapRef.current) mapRef.current.flyTo({ center: [lng, lat], zoom: 12, duration: 600 });
      if (p.name) { const c = citiesById[p.city_id]; doSearch([p.name, p.city_name].filter(Boolean).join(", "), p.country_code, c && c.lat != null ? Number(c.lat) : undefined, c && c.lat != null ? Number(c.lng) : undefined); }
    }
  }

  async function save() {
    if (!selected || !pin || !cityId || deriving) return;
    setSaving(true);
    try {
      const rows = await rpcDirect("admin_set_project_location", {
        p_id: selected.id, p_lat: pin.lat, p_lng: pin.lng, p_address: addr.trim() || null,
        p_district: district.trim(), p_city_id: cityId,
      });
      const row = Array.isArray(rows) ? rows[0] : rows; // authoritative saved values
      if (district.trim() && !(catalog.byCity[cityId] || []).includes(district.trim())) {
        setDistricts((prev) => [...prev, { city_id: cityId, name: district.trim() }]);
      }
      const savedLat = row?.lat != null ? Number(row.lat) : pin.lat;
      const savedLng = row?.lng != null ? Number(row.lng) : pin.lng;
      const savedCity = row?.city_id || cityId;
      const savedDist = row?.district ?? (district.trim() || null);
      // Update the in-memory list from the SAVED row so re-opening shows the real pin.
      setProjects((prev) => prev.map((p) => p.id === selected.id
        ? { ...p, lat: savedLat, lng: savedLng, address: row?.address ?? (addr.trim() || null),
            district: savedDist, city_id: savedCity, city_name: cityNameOf(savedCity),
            location_source: "manual", location_verified: true }
        : p));
      // Reflect the saved pin in the editor and stay here (so you can see it's confirmed).
      setPin({ lat: savedLat, lng: savedLng });
      setToast({ type: "ok", msg: t("Saved ✓", "Uložené ✓") });
    } catch (e) {
      setToast({ type: "err", msg: e?.message === "session-expired"
        ? t("Session expired — reload the page", "Relácia vypršala — obnov stránku")
        : (e?.message || "save failed") });
    } finally { setSaving(false); }
  }

  const smallCity = !!cityId && !cityHasCatalog(cityId);

  return (
    <div style={{ display: "flex", height: "calc(100dvh - 64px)", background: bg, color: textLight }}>
      {/* Left list */}
      <div style={{ width: 360, minWidth: 360, borderRight: `1px solid ${border}`, display: "flex", flexDirection: "column", background: bg2 }}>
        <div style={{ padding: "1rem 1.1rem 0.75rem", borderBottom: `1px solid ${border}` }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 600 }}>{t("Project locations", "Polohy projektov")}</div>
          <div style={{ fontFamily: mono, fontSize: "0.72rem", color: dim, marginTop: 4 }}>
            <span style={{ color: green }}>{confirmedCount}</span> / {total} {t("located", "umiestnených")}
            {noDistrictCount > 0 && <span style={{ marginLeft: 8, color: amber }}>· {noDistrictCount} {t("no district", "bez okresu")}</span>}
          </div>
          <div style={{ height: 4, background: "#1a1a1f", borderRadius: 3, marginTop: 8, overflow: "hidden" }}>
            <div style={{ width: total ? `${(confirmedCount / total) * 100}%` : "0%", height: "100%", background: green, transition: "width 0.3s" }} />
          </div>
        </div>
        <div style={{ padding: "0.6rem 0.8rem", display: "flex", gap: 6, flexWrap: "wrap", borderBottom: `1px solid ${border}` }}>
          {[["unconfirmed", t("To do", "Zostáva")], ["confirmed", t("Done", "Hotové")], ["nodistrict", t("⚠ No district", "⚠ Bez okresu")], ["all", t("All", "Všetky")]].map(([k, l]) => (
            <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>{l}</Chip>))}
          <span style={{ width: 1, background: border, margin: "0 2px" }} />
          {[["all", t("All", "Všetko")], ["SK", "🇸🇰 SK"], ["CZ", "🇨🇿 CZ"]].map(([k, l]) => (
            <Chip key={k} active={country === k} onClick={() => setCountry(k)}>{l}</Chip>))}
        </div>
        <div style={{ padding: "0.6rem 0.8rem" }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Search projects…", "Hľadať projekty…")} style={inputStyle} />
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {projects === null && <div style={emptyStyle}>{t("Loading…", "Načítavam…")}</div>}
          {err && <div style={{ ...emptyStyle, color: "#ff6b6b" }}>{err}</div>}
          {projects && !err && filtered.length === 0 && <div style={emptyStyle}>{t("Nothing here.", "Nič tu nie je.")}</div>}
          {filtered.map((p) => {
            const active = p.id === selectedId;
            const flagND = catalog.cityIds.has(p.city_id) && (!p.district || !p.district.trim());
            return (
              <button key={p.id} onClick={() => selectProject(p)} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "0.6rem 0.85rem", textAlign: "left", border: "none",
                borderLeft: `3px solid ${active ? green : "transparent"}`, borderBottom: `1px solid ${border}`,
                background: active ? "rgba(0,229,160,0.10)" : "transparent", color: textLight, cursor: "pointer", fontFamily: "inherit" }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: p.location_verified ? green : amber, boxShadow: p.location_verified ? `0 0 6px ${green}` : "none" }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: "0.86rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ display: "block", fontSize: "0.7rem", color: dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.city_name || p.city_id || "—"}{p.district && p.district.trim() ? " · " + p.district : ""}
                    {flagND && <span style={{ color: amber, marginLeft: 6 }}>⚠ {t("no district", "bez okresu")}</span>}
                    {p.status !== "active" && <span style={{ color: amber, marginLeft: 6 }}>· {p.status}</span>}
                  </span>
                </span>
                <span style={{ fontFamily: mono, fontSize: "0.62rem", color: p.country_code === "CZ" ? "#8aa0ff" : dim }}>{p.country_code}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right editor + map */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
        <div style={{ padding: "0.85rem 1.1rem", borderBottom: `1px solid ${border}`, background: bg2 }}>
          {!selected ? (
            <div style={{ fontSize: "0.85rem", color: dim }}>{t("Pick a project on the left to set its location + district.", "Vyber projekt vľavo a nastav jeho polohu + okres.")}</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.98rem", fontWeight: 600 }}>{selected.name}</span>
                <span style={{ fontFamily: mono, fontSize: "0.64rem", padding: "2px 8px", borderRadius: 20, color: selected.location_verified ? green : amber, border: `1px solid ${selected.location_verified ? green : amber}55`, background: `${selected.location_verified ? green : amber}12` }}>
                  {selected.location_verified ? t("confirmed", "potvrdené") : t("not located yet", "zatiaľ neumiestnené")}
                </span>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ position: "relative", flex: 1, minWidth: 240 }}>
                  <input value={addr} onChange={(e) => onAddrChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setSuggestions([]); }}
                    placeholder={t("Type an address or place — e.g. Sky Park, Bratislava", "Zadaj adresu alebo názov — napr. Sky Park, Bratislava")} style={inputStyle} autoComplete="off" />
                  {(searching || suggestions.length > 0) && (
                    <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20, background: bg2, border: `1px solid ${border}`, borderRadius: 8, boxShadow: "0 10px 34px rgba(0,0,0,0.55)", overflow: "hidden", maxHeight: 240, overflowY: "auto" }}>
                      {searching && <div style={{ padding: "8px 11px", fontSize: "0.74rem", color: dim, fontFamily: mono }}>{t("Searching…", "Hľadám…")}</div>}
                      {!searching && suggestions.length === 0 && <div style={{ padding: "8px 11px", fontSize: "0.74rem", color: dim }}>{t("No matches — click the map to place it.", "Žiadna zhoda — klikni do mapy.")}</div>}
                      {suggestions.map((s, i) => (
                        <button key={i} onClick={() => pick(s)} style={{ display: "block", textAlign: "left", width: "100%", padding: "8px 11px", background: "transparent", border: "none", borderBottom: i < suggestions.length - 1 ? `1px solid ${border}` : "none", color: textLight, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,229,160,0.10)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                          <span style={{ color: green, marginRight: 7 }}>📍</span>{s.label}{s.cc && s.cc !== "SK" && <span style={{ color: dim, fontFamily: mono, fontSize: "0.64rem", marginLeft: 6 }}>{s.cc}</span>}
                        </button>))}
                    </div>)}
                </div>
                <button onClick={save} disabled={!pin || !cityId || deriving || saving} style={btn(green, !pin || !cityId || deriving || saving, true)}>{saving ? t("Saving…", "Ukladám…") : deriving ? t("Locating…", "Zisťujem…") : t("Save", "Uložiť")}</button>
              </div>

              <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 9, flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.74rem", color: dim }}>
                  {t("City", "Mesto")}: <span style={{ color: textLight, fontWeight: 500 }}>{cityNameOf(cityId) || "—"}</span>
                  <span style={{ color: dim }}> · {t("Region", "Kraj")}: <span style={{ color: textLight }}>{regionNameOf(cityId)}</span></span>
                  <span style={{ color: dim, marginLeft: 6, fontSize: "0.66rem" }}>({t("from the pin", "z pinu")})</span>
                </span>
                <label style={{ display: "inline-flex", alignItems: "center", fontSize: "0.74rem", color: dim }}>
                  {t("District", "Okres")}
                  <input list="district-opts" value={district} onChange={(e) => { districtTouchedRef.current = true; setDistrict(e.target.value); }}
                    placeholder={smallCity ? t("(optional — uses city)", "(voliteľné — použije mesto)") : t("e.g. Petržalka", "napr. Petržalka")}
                    style={{ ...inputStyle, width: "auto", minWidth: 170, marginLeft: 6, borderColor: (!smallCity && !district.trim()) ? amber : border }} />
                  <datalist id="district-opts">{districtOptions.map((d) => <option key={d} value={d} />)}</datalist>
                </label>
              </div>

              {cityWarn && (
                <div style={{ marginTop: 7, fontSize: "0.7rem", color: amber }}>
                  ⚠ {t(`The pin is in "${cityWarn}", which isn't one of our cities — move it into the right city, or it won't be classified correctly.`,
                       `Pin je v "${cityWarn}", čo nie je jedno z našich miest — presuň ho do správneho mesta, inak sa nezatriedi správne.`)}
                </div>
              )}
              <div style={{ marginTop: 7, fontSize: "0.7rem", color: pin ? dim : amber }}>
                {pin
                  ? <>📌 {pin.lat}, {pin.lng} — {smallCity ? t("small city: leave district as the city, or type a sub-area.", "malé mesto: nechaj okres ako mesto, alebo napíš časť.") : t("city + region follow the pin; district is suggested — adjust from the list if needed.", "mesto + kraj idú podľa pinu; okres je návrh — uprav zo zoznamu ak treba.")}</>
                  : t("Pick a suggestion above or click the spot on the map, then Save.", "Vyber návrh hore alebo klikni na miesto v mape, potom Ulož.")}
              </div>
            </>
          )}
        </div>
        <div style={{ flex: 1, position: "relative", minHeight: 320 }}>
          <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
          {toast && (<div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 5, padding: "8px 16px", borderRadius: 8, fontSize: "0.82rem", fontWeight: 500, background: toast.type === "ok" ? "rgba(0,229,160,0.95)" : "rgba(255,80,80,0.95)", color: toast.type === "ok" ? "#06281d" : "#2a0808", boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>{toast.msg}</div>)}
        </div>
      </div>

      <style>{`.maplibregl-popup-content { background:${bg2}; color:${textLight}; border:1px solid ${border}; border-radius:10px; } .maplibregl-ctrl-attrib { font-size:9px; }`}</style>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return <button onClick={onClick} style={{ padding: "3px 10px", borderRadius: 20, fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit", border: `1px solid ${active ? green : border}`, background: active ? "rgba(0,229,160,0.14)" : "transparent", color: active ? green : dim }}>{children}</button>;
}
const inputStyle = { width: "100%", boxSizing: "border-box", padding: "0.5rem 0.7rem", background: bg, border: `1px solid ${border}`, borderRadius: 7, color: textLight, fontSize: "0.84rem", fontFamily: "inherit", outline: "none" };
const emptyStyle = { padding: "1.5rem 1.1rem", color: dim, fontSize: "0.8rem", fontFamily: mono };
function btn(color, disabled, filled = false) {
  return { padding: "0.5rem 0.95rem", borderRadius: 7, fontSize: "0.82rem", fontWeight: 600, whiteSpace: "nowrap", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", border: `1px solid ${color}`, background: disabled ? "#1a1a1f" : (filled ? color : "transparent"), color: disabled ? "#55555f" : (filled ? "#06281d" : color), opacity: disabled ? 0.7 : 1, transition: "opacity 0.15s" };
}
