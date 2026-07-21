/* UnitExplorer — Phase 3.1 of the analytics rebuild.
   The "raw values as values" view: pick any columns, scope/filter, see individual units
   (not aggregated). Reads the detail engine analytics_units (server-side, paginated, RLS-gated).
   UI matches the Analytics/pivot design language (green accent, card panels, JetBrains-Mono
   labels, the POLIA-style field palette). */
import { useState, useMemo, useEffect, useRef } from "react";
import Picker from "../components/Picker";
import { useCountry, isAllCountries } from "../lib/useCountry";
import { useCurrency } from "../lib/useCurrency";
import { moneyFromEur, moneySymbol } from "../lib/money";
import { useUnitsInfinite, useAnalyticsRegistry, usePivotDistinct } from "../lib/useData";
import LoadError from "../components/LoadError";
import { supabaseData } from "../lib/supabase";

// sessionStorage key: the project set handed from a filtered analytics view to the map.
export const MAP_PROJECT_SET_KEY = "residata.mapProjectSet";

const PAGE = 100;          // rows fetched per network page (accumulated; the table is virtualized)
const ROW_H = 33;          // fixed row height (px) — required for windowed virtualization math
const OVERSCAN = 8;        // extra rows rendered above/below the viewport for smooth scrolling
const DEFAULT_COLS = ["project_name", "city", "cast", "typ", "izby", "obytna_plocha", "cena_s_dph", "price_per_m2", "stav"];

// design tokens — identical to PivotV2 so the two pages feel like one product
import { accent as green, accentInk, orange, dim, border, bg, surfacePanel as panelHi, text } from "../lib/theme";
const panel = "var(--surface-2)";
const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";

// group the registry fields into readable categories for the palette
const CATEGORY = {
  country: "loc", market: "loc", city: "loc", cast: "loc", sub_district: "loc",
  developer: "proj", project_name: "proj", import_status: "proj", lifecycle: "proj",
  typ: "unit", etapa: "unit", budova: "unit", unit_detail: "unit", unit_id: "unit",
  izby: "unit", poschodie: "unit", stav: "unit", kolaudacia: "unit", orientacia: "unit",
  cena_s_dph: "price", cena_bez_dph: "price", price_per_m2: "price",
  obytna_plocha: "area", celkova_plocha: "area", balkon: "area", loggia: "area",
  terasa: "area", zahrada: "area", exterier: "area", kobka: "area",
  snapshot_month: "time", datum: "time", batch_id: "time",
};
const CAT_ORDER = ["loc", "proj", "unit", "price", "area", "time"];
const CAT_LABEL = {
  sk: { loc: "Lokalita", proj: "Projekt", unit: "Byt", price: "Cena", area: "Plochy", time: "Čas", other: "Ostatné" },
  en: { loc: "Location", proj: "Project", unit: "Unit", price: "Price", area: "Areas", time: "Time", other: "Other" },
};

function fmtVal(key, val, fmtByKey) {
  if (val == null || val === "") return "—";
  const f = fmtByKey[key];
  const n = Number(val);
  if (f === "eur" && Number.isFinite(n)) return moneySymbol() + Math.round(moneyFromEur(n)).toLocaleString("sk-SK").replace(/,/g, " ");
  if (f === "per_m2" && Number.isFinite(n)) return Math.round(moneyFromEur(n)).toLocaleString("sk-SK").replace(/,/g, " ") + " " + moneySymbol() + "/m²";
  if (f === "area" && Number.isFinite(n)) return n.toLocaleString("sk-SK", { maximumFractionDigits: 1 }) + " m²";
  return String(val);
}

// kind of filter control a field needs, from its registry type
function fieldKind(meta) {
  if (!meta) return "text";
  if (meta.type === "numeric") return "num";
  if (meta.type === "date") return "date";   // from/to range (engine supports date-dim ranges)
  // 'month' (snapshot_month, 'YYYY-MM') → a value picker, not a date range: a calendar input
  // can't express "YYYY-MM" and the engine filters months as an IN list, not a range.
  return "text";
}

/* One generic "filter on any field" row. Rendered per active extra-filter so it can call
   usePivotDistinct for its own text field (stable per React key). Text → is / is-not a set of
   values (chips); number/date → from/to range. Feeds the same analytics_units spec the quick
   filters do (filters / filters_not / ranges), so ANY field in the list is filterable. */
function XFilterRow({ row, fields, mode, lang, sel, onPatch, onRemove }) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  const label = (f) => (lang === "sk" ? f.label_sk : f.label_en);
  const meta = fields.find((f) => f.key === row.key);
  const kind = fieldKind(meta);
  const distinct = usePivotDistinct({ enabled: kind === "text" && !!row.key, field: row.key, mode });
  const chip = { cursor: "pointer", background: green, color: "#04130d", borderRadius: 4, padding: "0.1rem 0.4rem", fontSize: "0.72rem", fontWeight: 600, whiteSpace: "nowrap" };
  return (
    <div style={{ display: "inline-flex", gap: "0.3rem", alignItems: "center", background: bg, border: `1px solid ${border}`, borderRadius: 6, padding: "0.2rem 0.3rem", flexWrap: "wrap" }}>
      <Picker value={row.key} onChange={(v) => onPatch({ key: v, op: "in", vals: [], min: "", max: "" })} searchable ariaLabel={t("pole…", "field…")} width={140}
        options={[{ value: "", label: t("pole…", "field…") }, ...fields.map((f) => ({ value: f.key, label: label(f) }))]} />
      {row.key && kind === "text" && (<>
        <Picker value={row.op} onChange={(v) => onPatch({ op: v })} ariaLabel="operator" width={92}
          options={[{ value: "in", label: t("je", "is") }, { value: "not_in", label: t("nie je", "is not") }]} />
        <Picker value="" onChange={(v) => { if (v && !(row.vals || []).includes(v)) onPatch({ vals: [...(row.vals || []), v] }); }} searchable width={150}
          placeholder={distinct.loading ? t("načítavam…", "loading…") : t("+ hodnota", "+ value")} ariaLabel="value"
          options={(distinct.values || []).filter((v) => !(row.vals || []).includes(v)).map((v) => ({ value: v, label: v }))} />
        {(row.vals || []).map((v) => <span key={v} onClick={() => onPatch({ vals: row.vals.filter((x) => x !== v) })} style={chip} title={t("odstrániť", "remove")}>{v} ✕</span>)}
      </>)}
      {row.key && (kind === "num" || kind === "date") && (<>
        <input type={kind === "date" ? "date" : "text"} value={row.min} placeholder={t("od", "from")} onChange={(e) => onPatch({ min: e.target.value })} style={{ ...sel, width: kind === "date" ? 132 : 76 }} inputMode={kind === "num" ? "numeric" : undefined} />
        <input type={kind === "date" ? "date" : "text"} value={row.max} placeholder={t("do", "to")} onChange={(e) => onPatch({ max: e.target.value })} style={{ ...sel, width: kind === "date" ? 132 : 76 }} inputMode={kind === "num" ? "numeric" : undefined} />
      </>)}
      <button onClick={onRemove} style={{ ...sel, cursor: "pointer", color: dim, padding: "0.2rem 0.45rem" }} title={t("odstrániť filter", "remove filter")}>✕</button>
    </div>
  );
}

export default function UnitExplorer({ lang = "sk", setCurrent }) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  const { country } = useCountry();
  useCurrency(); // subscribe so €/€-m² cells re-render in the selected currency
  // display value of 1 EUR = the current display-currency rate; recomputes on each
  // currency toggle (used to convert money FILTER inputs display->EUR, see spec below).
  const _money1 = moneyFromEur(1) || 1;
  const { dimensions, measures } = useAnalyticsRegistry();

  // unified field list (dedup dim/measure on key); keep label + type + format
  const fields = useMemo(() => {
    const seen = new Map();
    for (const d of dimensions) if (!seen.has(d.key)) seen.set(d.key, { key: d.key, label_sk: d.label_sk, label_en: d.label_en, type: d.data_type, fmt: null });
    for (const m of measures) {
      const ex = seen.get(m.key);
      if (ex) { ex.fmt = m.format; if (!ex.type || ex.type === "text") ex.type = "numeric"; }
      else seen.set(m.key, { key: m.key, label_sk: m.label_sk, label_en: m.label_en, type: "numeric", fmt: m.format });
    }
    return [...seen.values()];
  }, [dimensions, measures]);
  const fmtByKey = useMemo(() => Object.fromEntries(fields.filter((f) => f.fmt).map((f) => [f.key, f.fmt])), [fields]);
  const lbl = (k) => { const f = fields.find((x) => x.key === k); return f ? (lang === "sk" ? f.label_sk : f.label_en) : k; };

  const [mode, setMode] = useState("latest");
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [fProject, setFProject] = useState(""); const [fCity, setFCity] = useState(""); const [fCast, setFCast] = useState(""); const [fDev, setFDev] = useState(""); const [fStav, setFStav] = useState("");
  const [pMin, setPMin] = useState(""); const [pMax, setPMax] = useState("");
  const [m2Min, setM2Min] = useState(""); const [m2Max, setM2Max] = useState("");
  // generic "filter on any field" rows — {id, key, op, vals[], min, max}. Cover EVERY field
  // not already handled by a dedicated quick control above.
  const [xf, setXf] = useState([]);
  const xfId = useRef(0);
  const [sort, setSort] = useState({ key: "cena_s_dph", dir: "desc" });
  const [search, setSearch] = useState("");
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(560);

  // dropdown option lists follow the chosen scope (audit M4): in "História" they include
  // values that exist only historically (e.g. a now-sold-out project), not just current ones.
  const cityOpts = usePivotDistinct({ enabled: true, field: "city", mode });
  // Mestská časť options narrow to the chosen city (Bratislava's časti ≠ Praha's) — same
  // parent-scopes-child behaviour as the Map filter. With no city picked, all časti show.
  const castOpts = usePivotDistinct({ enabled: true, field: "cast", mode, city: fCity || null });
  const devOpts = usePivotDistinct({ enabled: true, field: "developer", mode });
  const projOpts = usePivotDistinct({ enabled: true, field: "project_name", mode });
  const stavOpts = usePivotDistinct({ enabled: true, field: "stav", mode });

  // Changing the city invalidates a previously-picked mestská časť (it belongs to the old
  // city), so clear it — otherwise the table would filter to an empty intersection.
  useEffect(() => { setFCast(""); }, [fCity]);

  // fields available to the generic "+ filter" picker: everything EXCEPT the ones already
  // driven by a dedicated quick control (so no confusing double-filter on the same field).
  const QUICK_COVERED = useMemo(() => new Set(["country", "city", "cast", "developer", "stav", "project_name", "cena_s_dph", "price_per_m2"]), []);
  const xfFields = useMemo(() => fields.filter((f) => !QUICK_COVERED.has(f.key)), [fields, QUICK_COVERED]);
  const xfActive = xf.filter((r) => r.key && ((r.vals && r.vals.length) || r.min || r.max));

  const spec = useMemo(() => {
    const filters = {};
    const filters_not = {};
    const ranges = {};
    if (!isAllCountries(country)) filters.country = [country];
    if (fProject) filters.project_name = [fProject];
    if (fCity) filters.city = [fCity];
    if (fCast) filters.cast = [fCast];
    if (fDev) filters.developer = [fDev];
    if (fStav) filters.stav = [fStav];
    // Currency fix (2026-07-11): the table renders money via moneyFromEur (EUR->display),
    // but analytics_units stores/filters money in EUR. Convert money range inputs from the
    // DISPLAY currency back to EUR, else in CZK mode a typed CZK band is compared against EUR
    // values -> empty/nonsensical results. Mirrors PivotV2's dispToEur.
    const dispToEur = (v) => (v === null || v === undefined || v === "" ? null : Number(v) / _money1);
    if (pMin || pMax) ranges.cena_s_dph = { min: dispToEur(pMin), max: dispToEur(pMax) };
    if (m2Min || m2Max) ranges.price_per_m2 = { min: dispToEur(m2Min), max: dispToEur(m2Max) };
    // generic per-field filters → same spec shape the engine already supports
    for (const r of xf) {
      if (!r.key) continue;
      const meta = fields.find((f) => f.key === r.key);
      const kind = fieldKind(meta);
      if (kind === "text" && r.vals && r.vals.length) {
        if (r.op === "not_in") filters_not[r.key] = r.vals;
        else filters[r.key] = r.vals;
      } else if ((kind === "num" || kind === "date") && (r.min || r.max)) {
        // money fields (eur / per_m2) are stored in EUR -> convert the typed display value.
        const isMoney = fmtByKey[r.key] === "eur" || fmtByKey[r.key] === "per_m2";
        ranges[r.key] = isMoney
          ? { min: dispToEur(r.min), max: dispToEur(r.max) }
          : { min: r.min || null, max: r.max || null };
      }
    }
    const s = { columns: cols, filters, mode, sort: [sort] };   // limit/offset managed by useUnitsInfinite
    if (Object.keys(filters_not).length) s.filters_not = filters_not;
    if (Object.keys(ranges).length) s.ranges = ranges;
    return s;
  }, [country, fProject, fCity, fCast, fDev, fStav, pMin, pMax, m2Min, m2Max, cols, mode, sort, xf, fields, fmtByKey, _money1]);

  const { rows, hasMore, loading, loadMore, error: loadFailed } = useUnitsInfinite({ enabled: cols.length > 0, spec, pageSize: PAGE });

  // a new query (filter/sort/column change) scrolls back to the top
  const specKey = JSON.stringify(spec);
  useEffect(() => { setScrollTop(0); if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [specKey]);

  // measure the scroll viewport height (for the windowing math) + track resize
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setViewH(el.clientHeight || 560);
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // virtualization: render only the visible row slice (+ overscan), padded by spacer rows
  const total = rows.length;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const endIdx = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);
  const visible = rows.slice(startIdx, endIdx);
  const padTop = startIdx * ROW_H;
  const padBottom = Math.max(0, (total - endIdx) * ROW_H);

  const toggleSort = (k) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));
  const toggleCol = (k) => setCols((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  const activeFilters = [fProject, fCity, fCast, fDev, fStav, pMin, pMax, m2Min, m2Max].filter(Boolean).length + xfActive.length;
  const addXf = () => setXf((a) => [...a, { id: ++xfId.current, key: "", op: "in", vals: [], min: "", max: "" }]);
  const patchXf = (id, patch) => setXf((a) => a.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeXf = (id) => setXf((a) => a.filter((r) => r.id !== id));

  // "Show on map" — hand the CURRENT filtered set's distinct projects to the map. One pivot
  // call (dims=[project_name], same filters) yields exactly the projects behind these units,
  // even for unit-level filters (izby, plocha…) the project-level map can't express itself.
  const [mapBusy, setMapBusy] = useState(false);
  const showOnMap = async () => {
    setMapBusy(true);
    try {
      const p_spec = { dims: ["project_name"], filters: spec.filters, mode: spec.mode };
      if (spec.filters_not) p_spec.filters_not = spec.filters_not;
      if (spec.ranges) p_spec.ranges = spec.ranges;
      const { data, error } = await supabaseData.rpc("analytics_pivot", { p_spec });
      const names = error ? [] : (Array.isArray(data) ? data : []).map((r) => r?.d?.[0]).filter(Boolean);
      sessionStorage.setItem(MAP_PROJECT_SET_KEY, JSON.stringify({ names, count: names.length, source: "explorer", ts: Date.now() }));
      // setCurrent (handleNav) actually switches the SPA page AND updates the URL; a bare
      // pushRoute would only change the address bar without rendering the map.
      if (setCurrent) setCurrent("App:Map2");
      else window.location.assign("/app/map-2");
    } finally {
      setMapBusy(false);
    }
  };

  // palette: filter by search, group by category
  const palette = useMemo(() => {
    const q = search.trim().toLowerCase();
    const groups = {};
    for (const f of fields) {
      if (q && !(lang === "sk" ? f.label_sk : f.label_en).toLowerCase().includes(q)) continue;
      const g = CATEGORY[f.key] || "other";
      (groups[g] = groups[g] || []).push(f);
    }
    return groups;
  }, [fields, search, lang]);

  const sel = { background: bg, border: `1px solid ${border}`, color: text, borderRadius: 5, padding: "0.4rem 0.55rem", fontSize: "0.78rem", fontFamily: "inherit", outline: "none" };
  const Sel = ({ value, onChange, opts, ph }) => (
    <Picker value={value} onChange={onChange} searchable placeholder={ph} ariaLabel={ph} width={150}
      options={[{ value: "", label: ph }, ...(opts || []).map((o) => ({ value: o, label: o }))]} />
  );
  const typeBadge = (ty) => (ty === "numeric" ? "#" : ty === "date" || ty === "month" ? "📅" : "T");
  const typeColor = (ty) => (ty === "numeric" ? orange : green);

  return (
    <div style={{ color: text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* header + mode toggle */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.9rem" }}>
        <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, border: "1px solid var(--border)", padding: "1.4rem 1.6rem 1.5rem", marginBottom: "1.5rem", background: "radial-gradient(120% 140% at 2% -20%, rgba(18,185,129,0.13) 0%, transparent 46%), linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, var(--surface)) 0%, var(--bg) 75%)" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 3, background: "linear-gradient(90deg, var(--accent), #3b74e8 55%, #8b5cf6)" }} />
          <h1 style={{ fontSize: "1.4rem", margin: "0 0 0.2rem" }}>{t("Prieskumník bytov", "Unit Explorer")}</h1>
          <p style={{ color: dim, fontSize: "0.8rem", margin: 0 }}>{t("Surové dáta po jednotlivých bytoch — vyber stĺpce vpravo, filtruj, zoraď klikom na hlavičku.", "Raw per-unit data — pick columns on the right, filter, sort by clicking a header.")}</p>
        </div>
        <div style={{ display: "inline-flex", border: `1px solid ${border}`, borderRadius: 7, overflow: "hidden", background: panel }}>
          {[["latest", t("Aktuálne", "Current")], ["archive", t("História", "All history")]].map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)} style={{ border: "none", padding: "0.4rem 0.85rem", cursor: "pointer", fontFamily: mono, fontSize: "0.72rem", letterSpacing: "0.03em", background: mode === m ? green : "transparent", color: mode === m ? "#04130d" : dim, fontWeight: mode === m ? 700 : 500 }}>{label}</button>
          ))}
        </div>
      </div>

      {/* two-column: main (filters + table) | palette */}
      <div style={{ display: "flex", gap: "0.9rem", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* filter toolbar */}
          <div style={{ background: panel, border: `1px solid ${border}`, borderRadius: 8, padding: "0.6rem 0.7rem", marginBottom: "0.6rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: mono, fontSize: "0.62rem", color: dim, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: "0.1rem" }}><span style={{ display: "inline-block", width: 3, height: 12, borderRadius: 2, background: "var(--accent)", marginRight: "0.5rem", verticalAlign: "middle" }} />{t("Filtre", "Filters")}{activeFilters ? ` · ${activeFilters}` : ""}</span>
            <Sel value={fProject} onChange={setFProject} opts={projOpts.values} ph={t("Projekt: všetky", "Project: all")} />
            <Sel value={fCity} onChange={setFCity} opts={cityOpts.values} ph={t("Mesto: všetky", "City: all")} />
            <Sel value={fCast} onChange={setFCast} opts={castOpts.values} ph={t("Mestská časť: všetky", "District: all")} />
            <Sel value={fDev} onChange={setFDev} opts={devOpts.values} ph={t("Developer: všetci", "Developer: all")} />
            <Sel value={fStav} onChange={setFStav} opts={stavOpts.values} ph={t("Stav: všetky", "Status: all")} />
            <input style={{ ...sel, width: 84 }} placeholder={`${t("cena od", "price from")} ${moneySymbol()}`} value={pMin} onChange={(e) => setPMin(e.target.value)} inputMode="numeric" />
            <input style={{ ...sel, width: 84 }} placeholder={`${t("cena do", "price to")} ${moneySymbol()}`} value={pMax} onChange={(e) => setPMax(e.target.value)} inputMode="numeric" />
            <input style={{ ...sel, width: 92 }} placeholder={`${moneySymbol()}/m² ${t("od", "from")}`} value={m2Min} onChange={(e) => setM2Min(e.target.value)} inputMode="numeric" />
            <input style={{ ...sel, width: 92 }} placeholder={`${moneySymbol()}/m² ${t("do", "to")}`} value={m2Max} onChange={(e) => setM2Max(e.target.value)} inputMode="numeric" />
            {/* generic per-field filters — one row per chosen field (any field in the list) */}
            {xf.map((r) => (
              <XFilterRow key={r.id} row={r} fields={xfFields} mode={mode} lang={lang} sel={sel}
                onPatch={(patch) => patchXf(r.id, patch)} onRemove={() => removeXf(r.id)} />
            ))}
            <button onClick={addXf} style={{ ...sel, cursor: "pointer", color: accentInk, fontFamily: mono, fontSize: "0.72rem", borderColor: green }}>+ {t("filter", "filter")}</button>
            {activeFilters > 0 && <button onClick={() => { setFProject(""); setFCity(""); setFCast(""); setFDev(""); setFStav(""); setPMin(""); setPMax(""); setM2Min(""); setM2Max(""); setXf([]); }} style={{ ...sel, cursor: "pointer", color: dim, fontFamily: mono, fontSize: "0.7rem" }}>✕ {t("vyčistiť", "clear")}</button>}
            <button onClick={showOnMap} disabled={mapBusy} title={t("Zobraziť vyfiltrované projekty na mape", "Show the filtered projects on the map")}
              style={{ ...sel, marginLeft: "auto", cursor: mapBusy ? "wait" : "pointer", color: "#04130d", background: green, borderColor: green, fontFamily: mono, fontSize: "0.72rem", fontWeight: 700 }}>
              🗺 {mapBusy ? t("otváram…", "opening…") : t("Zobraziť na mape", "Show on map")}
            </button>
            <span style={{ fontFamily: mono, fontSize: "0.72rem", color: dim }}>
              {loading && rows.length === 0 ? t("načítavam…", "loading…") : `${rows.length}${hasMore ? "+" : ""} ${t("bytov", "units")}`}
            </span>
          </div>

          {/* virtualized scrolling table — only the visible row window is in the DOM; scrolling
              near the bottom auto-loads the next page (handles arbitrarily large result sets) */}
          <div ref={scrollRef}
            onScroll={(e) => { const el = e.currentTarget; setScrollTop(el.scrollTop); if (hasMore && !loading && el.scrollHeight - el.scrollTop - el.clientHeight < 500) loadMore(); }}
            style={{ overflow: "auto", height: "62vh", border: `1px solid ${border}`, borderRadius: 8, background: panel }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: "100%", minWidth: Math.max(1, cols.length) * 150, fontSize: "0.8rem" }}>
              <thead style={{ background: "var(--surface-2)", position: "sticky", top: 0, zIndex: 1 }}>
                <tr>
                  {cols.map((k) => {
                    const numeric = fields.find((f) => f.key === k)?.type === "numeric";
                    return (
                      <th key={k} onClick={() => toggleSort(k)} title={t("Klikni pre zoradenie", "Click to sort")}
                        style={{ padding: "0.55rem 0.7rem", textAlign: numeric ? "right" : "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer", borderBottom: `1px solid ${border}`, color: sort.key === k ? green : "var(--text-2)", userSelect: "none", fontFamily: mono, fontSize: "0.68rem", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700 }}>
                        {lbl(k)}{sort.key === k ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {padTop > 0 && <tr style={{ height: padTop }}><td colSpan={cols.length} style={{ padding: 0, border: 0 }} /></tr>}
                {visible.map((r, vi) => {
                  const i = startIdx + vi;
                  return (
                    <tr key={r.composite_unit_id || i} style={{ background: i % 2 ? "var(--surface-2)" : "transparent" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = panelHi)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = i % 2 ? "var(--surface-2)" : "transparent")}>
                      {cols.map((k) => {
                        const numeric = fields.find((f) => f.key === k)?.type === "numeric";
                        return <td key={k} style={{ height: ROW_H, boxSizing: "border-box", padding: "0 0.7rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: numeric ? "right" : "left", borderTop: `1px solid var(--surface)`, color: k === sort.key ? text : "var(--text-2)", fontFamily: numeric ? mono : "inherit", fontVariantNumeric: "tabular-nums" }}>{fmtVal(k, r[k], fmtByKey)}</td>;
                      })}
                    </tr>
                  );
                })}
                {padBottom > 0 && <tr style={{ height: padBottom }}><td colSpan={cols.length} style={{ padding: 0, border: 0 }} /></tr>}
                {!loading && rows.length === 0 && loadFailed && (
                  <tr><td colSpan={cols.length || 1} style={{ padding: 0 }}><LoadError lang={lang} /></td></tr>
                )}
                {!loading && rows.length === 0 && !loadFailed && (
                  <tr><td colSpan={cols.length || 1} style={{ padding: "2rem", textAlign: "center", color: dim, fontStyle: "italic" }}>{cols.length === 0 ? t("Vyber aspoň jeden stĺpec vpravo →", "Pick at least one column on the right →") : t("Žiadne byty pre tento filter.", "No units match this filter.")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {loading && rows.length > 0 && <div style={{ marginTop: "0.45rem", fontFamily: mono, fontSize: "0.7rem", color: dim }}>{t("načítavam ďalšie…", "loading more…")}</div>}
        </div>

        {/* field palette (POLIA-style) */}
        <div style={{ width: 268, flexShrink: 0, background: panel, border: `1px solid ${border}`, borderRadius: 8, padding: "0.75rem", display: "flex", flexDirection: "column", maxHeight: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.55rem" }}>
            <span style={{ fontFamily: mono, fontSize: "0.7rem", color: text, fontWeight: 700, letterSpacing: "0.06em" }}><span style={{ display: "inline-block", width: 3, height: 12, borderRadius: 2, background: "var(--accent)", marginRight: "0.5rem", verticalAlign: "middle" }} />{t("STĹPCE", "COLUMNS")}</span>
            <span style={{ fontFamily: mono, fontSize: "0.6rem", color: dim }}>{cols.length}/{fields.length}</span>
          </div>
          <div style={{ position: "relative", marginBottom: "0.55rem" }}>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Hľadať pole…", "Search fields…")}
              style={{ width: "100%", padding: "0.45rem 0.65rem 0.45rem 1.9rem", background: bg, border: `1px solid ${border}`, borderRadius: 5, color: text, fontSize: "0.78rem", fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} />
            <span style={{ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", color: dim, fontSize: "0.85rem", pointerEvents: "none" }}>🔍</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto", background: bg, border: `1px solid ${border}`, borderRadius: 5, padding: "0.3rem" }}>
            {CAT_ORDER.filter((g) => palette[g]?.length).concat(palette.other ? ["other"] : []).map((g) => (
              <div key={g} style={{ marginBottom: "0.35rem" }}>
                <div style={{ fontFamily: mono, fontSize: "0.56rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", padding: "0.3rem 0.45rem 0.15rem" }}>{CAT_LABEL[lang === "sk" ? "sk" : "en"][g]}</div>
                {palette[g].map((f) => {
                  const on = cols.includes(f.key);
                  return (
                    <div key={f.key} role="checkbox" aria-checked={on} tabIndex={0}
                      onClick={() => toggleCol(f.key)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCol(f.key); } }}
                      title={on ? t("Klikni pre skrytie", "Click to hide") : t("Klikni pre zobrazenie", "Click to show")}
                      style={{ display: "flex", alignItems: "center", gap: "0.45rem", padding: "0.32rem 0.55rem", borderRadius: 4, color: on ? text : dim, fontSize: "0.78rem", cursor: "pointer", userSelect: "none", borderLeft: `2px solid ${on ? green : "transparent"}`, background: on ? "color-mix(in srgb, var(--accent) 6%, transparent)" : "transparent" }}
                      onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = panelHi; }}
                      onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}>
                      <span style={{ fontFamily: mono, fontSize: "0.62rem", width: 16, textAlign: "center", color: typeColor(f.type), fontWeight: 700 }}>{typeBadge(f.type)}</span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lang === "sk" ? f.label_sk : f.label_en}</span>
                      {on && <span style={{ fontFamily: mono, fontSize: "0.62rem", color: accentInk }}>✓</span>}
                    </div>
                  );
                })}
              </div>
            ))}
            {fields.length > 0 && Object.keys(palette).length === 0 && (
              <div style={{ padding: "1rem 0.45rem", color: dim, fontSize: "0.74rem", textAlign: "center", fontStyle: "italic" }}>{t("Žiadne zhody.", "No matches.")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
