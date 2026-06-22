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
import { supabase } from "../lib/supabase";

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
  const districtRef = useRef("");
  const revGenRef = useRef(0);

  // ── Load projects + cities + districts ──
  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: pj, error: pe }, { data: ci }, { data: di }] = await Promise.all([
        supabase.rpc("admin_list_project_locations"),
        supabase.rpc("admin_list_cities"),
        supabase.rpc("admin_list_districts"),
      ]);
      if (!alive) return;
      if (pe) { setErr(pe.message); setProjects([]); return; }
      setProjects(pj || []); setCities(ci || []); setDistricts(di || []);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { citiesRef.current = cities; }, [cities]);
  useEffect(() => { cityIdRef.current = cityId; }, [cityId]);
  useEffect(() => { districtRef.current = district; }, [district]);

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
    try {
      const r = await fetch(`${PHOTON_REVERSE}?lat=${lat}&lon=${lng}&limit=1`);
      if (!r.ok) return null;
      const p = ((await r.json()).features || [])[0]?.properties || {};
      return { city: p.city, district: p.district, cc: p.countrycode };
    } catch { return null; }
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
    const onMove = (lat, lng) => { setPin({ lat: +lat.toFixed(6), lng: +lng.toFixed(6) }); setSuggestions([]); };
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
  useEffect(() => {
    if (!pin || !citiesRef.current.length) return;
    const gen = ++revGenRef.current;
    (async () => {
      const info = await reverseGeocode(pin.lat, pin.lng);
      if (gen !== revGenRef.current) return; // superseded by a newer pin
      const matched = info?.city ? matchCity(info.city, info.cc) : null;
      const finalCity = matched || nearestCity(pin.lat, pin.lng, citiesRef.current);
      const cityChanged = finalCity?.id !== cityIdRef.current;
      setCityId(finalCity?.id || "");
      setCityWarn(info?.city && !matched ? info.city : null);
      // Suggest the district from the pin when the city changed or the field is empty;
      // keep the user's typed/saved district otherwise.
      if (cityChanged || !districtRef.current.trim()) {
        const sug = info?.district && info.district.trim() ? info.district.trim() : smallCityDistrict(finalCity?.id);
        setDistrict(sug);
      }
    })();
  }, [pin]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 2800); return () => clearTimeout(id); }, [toast]);
  useEffect(() => () => { clearTimeout(debounceRef.current); if (abortRef.current) abortRef.current.abort(); }, []);

  // ── Forward geocode (browser-direct) ──
  async function doSearch(q, cc) {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController(); abortRef.current = ctrl;
    const killer = setTimeout(() => ctrl.abort(), 8000);
    setSearching(true);
    try {
      const bias = BIAS[cc] || BIAS.SK;
      const r = await fetch(`${PHOTON}?q=${encodeURIComponent(q)}&limit=6&lat=${bias.lat}&lon=${bias.lon}`, { signal: ctrl.signal });
      if (!r.ok) throw new Error("geocoder " + r.status);
      const feats0 = ((await r.json()).features || []).filter((f) => f.geometry?.coordinates?.length === 2);
      const skcz = feats0.filter((f) => ["SK", "CZ"].includes(f.properties?.countrycode));
      const feats = skcz.length ? skcz : feats0;
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
    debounceRef.current = setTimeout(() => doSearch(q, selected?.country_code), 320);
  }

  function pick(s) {
    clearTimeout(debounceRef.current);
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setPin({ lat: s.lat, lng: s.lng }); setAddr(s.label); setSuggestions([]); setSearching(false);
    if (mapRef.current) mapRef.current.flyTo({ center: [s.lng, s.lat], zoom: 16, duration: 600 });
  }

  function selectProject(p) {
    clearTimeout(debounceRef.current);
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    revGenRef.current++; // cancel any in-flight reverse-geocode from the previous project
    setSelectedId(p.id); setSuggestions([]); setCityWarn(null);
    const lat = p.lat != null ? Number(p.lat) : null, lng = p.lng != null ? Number(p.lng) : null;
    const located = p.location_verified && lat != null && lng != null;
    setCityId(p.city_id || "");
    setDistrict(p.district && p.district.trim() ? p.district : (catalog.cityIds.has(p.city_id) ? "" : cityNameOf(p.city_id)));
    if (located) {
      setAddr(p.address || ""); setPin({ lat, lng }); // pin effect will re-derive city/district from the point
      if (mapRef.current) mapRef.current.flyTo({ center: [lng, lat], zoom: 15, duration: 600 });
    } else {
      setPin(null);
      setAddr([p.name, p.city_name].filter(Boolean).join(", "));
      if (lat != null && lng != null && mapRef.current) mapRef.current.flyTo({ center: [lng, lat], zoom: 12, duration: 600 });
      if (p.name) doSearch([p.name, p.city_name].filter(Boolean).join(", "), p.country_code);
    }
  }

  function withTimeout(promise, ms) { return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]); }

  async function save() {
    if (!selected || !pin || !cityId) return;
    setSaving(true);
    try {
      const { error } = await withTimeout(supabase.rpc("admin_set_project_location", {
        p_id: selected.id, p_lat: pin.lat, p_lng: pin.lng, p_address: addr.trim() || null,
        p_district: district.trim(), p_city_id: cityId,
      }), 15000);
      if (error) { setToast({ type: "err", msg: error.message }); return; }
      if (district.trim() && !(catalog.byCity[cityId] || []).includes(district.trim())) {
        setDistricts((prev) => [...prev, { city_id: cityId, name: district.trim() }]);
      }
      const next = (projects || []).find((p) => !p.location_verified && p.id !== selected.id && (country === "all" || p.country_code === country));
      setProjects((prev) => prev.map((p) => p.id === selected.id
        ? { ...p, lat: pin.lat, lng: pin.lng, address: addr.trim() || null, district: district.trim() || null, city_id: cityId, city_name: cityNameOf(cityId), location_source: "manual", location_verified: true }
        : p));
      setToast({ type: "ok", msg: t("Saved ✓", "Uložené ✓") });
      if (next) selectProject(next); else { setSelectedId(null); setPin(null); setAddr(""); }
    } catch (e) {
      setToast({ type: "err", msg: e?.message === "timeout" ? t("Save timed out — try again", "Uloženie vypršalo — skús znova") : String(e?.message || e) });
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
                <button onClick={save} disabled={!pin || saving} style={btn(green, !pin || saving, true)}>{saving ? t("Saving…", "Ukladám…") : t("Save", "Uložiť")}</button>
              </div>

              <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 9, flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.74rem", color: dim }}>
                  {t("City", "Mesto")}: <span style={{ color: textLight, fontWeight: 500 }}>{cityNameOf(cityId) || "—"}</span>
                  <span style={{ color: dim }}> · {t("Region", "Kraj")}: <span style={{ color: textLight }}>{regionNameOf(cityId)}</span></span>
                  <span style={{ color: dim, marginLeft: 6, fontSize: "0.66rem" }}>({t("from the pin", "z pinu")})</span>
                </span>
                <label style={{ display: "inline-flex", alignItems: "center", fontSize: "0.74rem", color: dim }}>
                  {t("District", "Okres")}
                  <input list="district-opts" value={district} onChange={(e) => setDistrict(e.target.value)}
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
