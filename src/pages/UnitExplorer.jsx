/* UnitExplorer — Phase 3.1 of the analytics rebuild.
   The "raw values as values" view: pick any columns, scope/filter, see individual units
   (not aggregated). Reads the detail engine analytics_units (server-side, paginated, RLS-gated).
   UI matches the Analytics/pivot design language (green accent, card panels, JetBrains-Mono
   labels, the POLIA-style field palette). */
import { useState, useMemo, useEffect, useRef } from "react";
import Picker from "../components/Picker";
import FieldPanel from "../components/FieldPanel";
import { useCountry, isAllCountries } from "../lib/useCountry";
import { useCurrency } from "../lib/useCurrency";
import { moneyFromEur, moneySymbol, formatMoney, formatPerM2 } from "../lib/money";
import { formatDimNumber } from "../lib/locale";
import { statusLabel } from "../lib/unitStatus";
import { unitKindLabel } from "../lib/unitKinds";
import { useUnitsInfinite, useAnalyticsRegistry, usePivotDistinct } from "../lib/useData";
import { useAccountPrefState } from "../lib/useAccountUiPref";
import { EMPTY_SENTINEL, MODE_LABEL, capabilitiesOf, newFilter, sanitizeFilter,
         isFilterActive, summariseFilter, filtersToSpec, migrateLegacyFilters,
         convertMoneyBounds } from "../lib/filterModel";
import LoadError from "../components/LoadError";
import DateField from "../components/DateField";
import { supabaseData } from "../lib/supabase";

// sessionStorage key: the project set handed from a filtered analytics view to the map.
export const MAP_PROJECT_SET_KEY = "residata.mapProjectSet";

const PAGE = 100;          // rows fetched per network page (accumulated; the table is virtualized)
const ROW_H = 33;          // fixed row height (px) — required for windowed virtualization math
const OVERSCAN = 8;        // extra rows rendered above/below the viewport for smooth scrolling
const DEFAULT_COLS = ["project_name", "city", "cast", "typ", "izby", "obytna_plocha", "cena_s_dph", "price_per_m2", "stav"];

// design tokens — identical to PivotV2 so the two pages feel like one product
import { accent as green, accentInk, orange, dim, border, bg, surfacePanel as panelHi, text } from "../lib/theme";
import { useSpecifics, UnitPriceMarks, specificsLegend } from "../lib/projectSpecifics";
import { field } from "../lib/controls";
const panel = "var(--surface-2)";
const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";

// group the registry fields into readable categories for the palette
const CATEGORY = {
  country: "loc", market: "loc", city: "loc", cast: "loc", sub_district: "loc",
  developer: "proj", project_name: "proj", import_status: "proj", lifecycle: "proj",
  typ: "unit", etapa: "unit", budova: "unit", unit_detail: "unit", unit_id: "unit",
  izby: "unit", poschodie: "unit", stav: "unit", kolaudacia: "unit", orientacia: "unit",
  cena_s_dph: "price", cena_bez_dph: "price", price_per_m2: "price",
  // Fit-out is part of what a price MEANS (what it buys), so it sits beside the prices.
  fitout_level: "price",
  // These three had quietly collected in "Ostatné" because this map is hand-kept while the
  // registry grew past it. A palette whose "Other" bucket holds a chunk of the interesting
  // fields reads as unfinished.
  is_home: "unit", kolaudacia_date: "time", batch_timestamp: "time",
  obytna_plocha: "area", celkova_plocha: "area", balkon: "area", loggia: "area",
  terasa: "area", zahrada: "area", exterier: "area", kobka: "area",
  snapshot_month: "time", datum: "time",
};
const CAT_ORDER = ["loc", "proj", "unit", "price", "area", "time"];
const CAT_LABEL = {
  sk: { loc: "Lokalita", proj: "Projekt", unit: "Byt", price: "Cena", area: "Plochy", time: "Čas", other: "Ostatné" },
  en: { loc: "Location", proj: "Project", unit: "Unit", price: "Price", area: "Areas", time: "Time", other: "Other" },
};

function fmtVal(key, val, fmtByKey, numeric, lang) {
  if (val == null || val === "") return "—";
  const f = fmtByKey[key];
  const n = Number(val);
  if (f === "eur") return formatMoney(val);
  if (f === "per_m2") return formatPerM2(val);
  if (f === "area" && Number.isFinite(n)) return n.toLocaleString("sk-SK", { maximumFractionDigits: 1 }) + " m²";
  if (numeric && Number.isFinite(n)) return formatDimNumber(val);
  /* "V" told the reader nothing. The scraper's codes are right in the database and wrong
     on a page; each row here is ONE flat, so it takes the singular. */
  if (key === "stav") return statusLabel(val, lang, "one");
  if (key === "typ") return unitKindLabel(val, lang);
  return String(val);
}


/* One filter, drawn as a card in the right-hand panel.

   It replaces a row of controls that lived squeezed into the toolbar above the table,
   where a field with a dozen chosen values pushed everything else off the line. Here
   each filter owns its own block, all of them are visible at once, and the operators
   offered are the ones the ENGINE accepts for that field — capabilitiesOf reads the
   registry, so a numeric dimension like "izby" offers "is 2 or 3" (which works) rather
   than a range (which the engine would reject). */

export default function UnitExplorer({ lang = "sk", setCurrent }) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  const { country } = useCountry();
  useCurrency(); // subscribe so €/€-m² cells re-render in the selected currency
  // display value of 1 EUR = the current display-currency rate; recomputes on each
  // currency toggle (used to convert money FILTER inputs display->EUR, see spec below).
  const _money1 = moneyFromEur(1) || 1;
  const { dimensions, measures } = useAnalyticsRegistry();
  // Which projects price under a payment schedule rather than ordinary terms.
  const marksFor = useSpecifics(lang);

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
  const curSymForLabels = moneySymbol();
  const lblFor = (f, l) => {
    const raw = l === "sk" ? f.label_sk : f.label_en;
    return (f.fmt === "eur" || f.fmt === "per_m2") && curSymForLabels !== "€" ? raw.replace(/€/g, curSymForLabels) : raw;
  };
  const lbl = (k) => { const f = fields.find((x) => x.key === k); return f ? lblFor(f, lang === "sk" ? "sk" : "en") : k; };

  /* What a typed bound is measured in. Money follows the currency toggle, so it is read at
     render time rather than baked into the field list. */
  const unitOf = (k) => {
    const fmt = fmtByKey[k];
    if (fmt === "eur") return moneySymbol();
    if (fmt === "per_m2") return `${moneySymbol()}/m²`;
    if (fmt === "area") return "m²";
    return "";
  };

  /* The panel lists the same fields, so it needs the same currency-aware labels — its
     palette and its filter cards would otherwise say "€/m²" beside Kč figures. */
  const panelFields = useMemo(
    () => fields.map((f) => ({ ...f, label_sk: lblFor(f, "sk"), label_en: lblFor(f, "en") })),
    [fields, curSymForLabels, lang],   // eslint-disable-line -- symbol: relabel on a currency switch
  );

  const [mode, setMode] = useState("latest");
  const [cols, setCols] = useState(DEFAULT_COLS);
  /* ONE list of filters the user builds, on any field, in any mode the engine accepts.
     It replaces nine hard-coded controls (project / city / district / developer / status
     / price from-to / €-m² from-to) plus a cramped "+ filter" for the leftovers. Boss,
     2026-09-14: he wants to build the filters he wants rather than be handed a fixed set
     and allowed only to add columns. Nothing is pre-selected — an empty list means the
     whole market, which is the honest starting point. */
  const [filters, setFilters] = useState([]);
  const fId = useRef(0);
  /* The right-hand panel does two jobs now and they are NOT the same job, so it says
     which one it is doing rather than leaving it to be guessed from behaviour. */
  const [panelTab, setPanelTab] = useState("filters");
  /* Adding a filter is a STEP, not a second list competing for the same panel. While this
     is on, the field list owns the panel; picking a field hands it straight back. */
  const [adding, setAdding] = useState(false);
  const [sort, setSort] = useState({ key: "cena_s_dph", dir: "desc" });
  const [search, setSearch] = useState("");
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(560);

  // Remember the Unit-database view per-account, across devices.
  useAccountPrefState(
    "explorerFilters",
    /* `search` is deliberately NOT persisted. It is find-as-you-type over the field
       list, not a setting, and saving it meant opening the page with a stale word in
       the box and almost every field hidden — which reads as "the product only has
       three fields" rather than "you searched for this once". Found on 2026-09-14 with
       "cena" left in the box from a previous session. */
    { mode, cols, filters, sort, panelTab },
    (s) => {
      if (s.mode !== undefined) setMode(s.mode);
      if (Array.isArray(s.cols)) setCols(s.cols);
      if (s.panelTab === "filters" || s.panelTab === "cols") setPanelTab(s.panelTab);
      /* A saved set is either the NEW list or the OLD nine-control shape. Both are
         restored: a migration that quietly dropped the old one would mean opening the
         rebuilt page and seeing the whole market with no sign that anything was lost.
         Everything is sanitised on the way in — this blob is user-writable. */
      const incoming = Array.isArray(s.filters) ? s.filters : migrateLegacyFilters(s, 1);
      if (incoming.length || Array.isArray(s.filters)) {
        const clean = incoming.map((f, i) => sanitizeFilter(f, i + 1)).filter(Boolean);
        setFilters(clean);
        fId.current = clean.reduce((m, f) => Math.max(m, Number(f.id) || 0), 0);
      }
      if (s.sort && typeof s.sort === "object") setSort(s.sort);
    },
  );

  /* Registry-derived capability sets. The engine resolves `filters` through the
     DIMENSION registry and `ranges` through the MEASURE registry, so which operators a
     field may offer is a fact about the registry, not about the field's look. Building
     these once here means a field added to the registry tomorrow is filterable that day
     without anyone editing a list. */
  const capsSets = useMemo(() => ({
    /* `filterable` is the registry's own say on whether a dimension may be filtered, and
       the engine honours it. Ignoring it would offer a value list for a field meant to be
       SHOWN and not queried. Every dimension is filterable today — which is exactly why a
       missing check would go unnoticed until the day one is not. Excluded here, a field is
       still perfectly available as a COLUMN. */
    dimensionKeys: new Set(dimensions.filter((d) => d.filterable !== false).map((d) => d.key)),
    measureKeys: new Set(measures.map((m) => m.key)),
    dateKeys: new Set(dimensions.filter((d) => d.data_type === "date").map((d) => d.key)),
  }), [dimensions, measures]);
  const capsOf = (key) => capabilitiesOf(key, capsSets);

  /* A mestská časť belongs to a city (Bratislava's are not Praha's), so when the user
     has narrowed to one city the district value list narrows with it. Kept from the old
     page — it was the one thing the hard-coded controls did better than a generic row. */
  /* How the panel gets values for a categorical filter. Passed in rather than imported by
     the panel, so Sales can hand it its own live facets while the control stays identical. */
  const useValues = (key, enabled) => {
    const res = usePivotDistinct({
      enabled, field: key, mode,
      city: key === "cast" ? (cityScope || null) : null,
    });
    /* The value list comes straight from the grain, so it speaks the DATABASE's words: a
       room filter offered "1.0" and "2.0" beside a column reading 1 and 2, and a type
       filter offered "flat" and "parking_garage" beside one reading Byt and Garážové
       státie. A filter that names its values differently from the column it filters is
       two vocabularies in one panel. The ENGINE still receives the stored value — only
       the label is tidied, which is why these go out as {value,label} pairs. */
    const numeric = fields.find((f) => f.key === key)?.type === "numeric";
    const label = numeric ? (v) => String(formatDimNumber(v))
      : key === "typ" ? (v) => unitKindLabel(v, lang)
      : key === "stav" ? (v) => statusLabel(v, lang, "one")
      : null;
    /* Keyed on primitives, not on `label` — a fresh arrow every render would rebuild the
       array every render and the memo would be decoration. */
    return useMemo(() => {
      if (!label) return res;
      return { ...res, values: (res.values || []).map((v) => (
        v && typeof v === "object" ? v : { value: v, label: label(v) }
      )) };
    }, [res, key, lang, numeric]);   // eslint-disable-line react-hooks/exhaustive-deps
  };

  const cityScope = useMemo(() => {
    const f = filters.find((x) => x.key === "city" && x.mode === "in" && (x.values || []).length === 1);
    return f ? f.values[0] : null;
  }, [filters]);

  const addFilter = (key) => {
    const caps = capsOf(key);
    if (!caps.modes.length) return;
    setFilters((a) => (a.some((f) => f.key === key) ? a : [...a, newFilter(key, caps, ++fId.current)]));
  };
  const patchFilter = (id, patch) => setFilters((a) => a.map((f) => {
    if (f.id !== id) return f;
    const next = { ...f, ...patch };
    /* Switching operator must not carry the old operand along: leaving a values list on
       a range, or bounds on an "is", makes a filter that reads one way and acts another. */
    if (patch.mode && patch.mode !== f.mode) {
      if (patch.mode === "between") { next.values = []; }
      else if (patch.mode === "in" || patch.mode === "not_in") { next.min = ""; next.max = ""; }
      else { next.values = []; next.min = ""; next.max = ""; }
    }
    return next;
  }));
  const removeFilter = (id) => setFilters((a) => a.filter((f) => f.id !== id));

  /* Never order by a column that is not on screen. Hide the sorted column and the rows keep
     that order with nothing on the page explaining it — the indicator goes with the header.
     The sort follows the first column still showing. (Same fault, same fix, on Sales.) */
  const effSort = useMemo(
    () => (cols.includes(sort.key) || !cols.length ? sort : { key: cols[0], dir: sort.dir }),
    [sort, cols],
  );

  /* The display currency can change under a typed money bound. Convert it, or the same
     filter silently asks a different question — see convertMoneyBounds. */
  const rateRef = useRef(moneyFromEur(1) || 1);
  useEffect(() => {
    const rate = moneyFromEur(1) || 1;
    const prev = rateRef.current;
    rateRef.current = rate;
    if (prev && rate && prev !== rate) {
      setFilters((a) => convertMoneyBounds(a, rate / prev, (k) => fmtByKey[k] === "eur" || fmtByKey[k] === "per_m2"));
    }
  });

  const spec = useMemo(() => {
    /* Money is stored and compared in EUR; the box the user types into follows the
       currency toggle. Convert at the edge, or a CZK band typed in CZK mode is compared
       against EUR values and returns nonsense. (Same conversion the pivot does.) */
    const toEur = (v) => Number(v) / _money1;
    const isMoneyKey = (k) => fmtByKey[k] === "eur" || fmtByKey[k] === "per_m2";
    const built = filtersToSpec(filters, { isMoneyKey, toEur, isDateKey: (k) => capsSets.dateKeys.has(k) });

    /* The sidebar's market toggle is an ambient scope, not one of these filters. It
       applies UNLESS the user has said something about country here — otherwise adding
       "Krajina is Česko" while the sidebar says SK would be silently overwritten and the
       chip on screen would describe a query that never ran. An explicit choice beats an
       ambient one, and the chip then tells the truth. */
    const withCountry = { ...(built.filters || {}) };
    const userSetCountry = filters.some((f) => f.key === "country" && isFilterActive(f));
    if (!isAllCountries(country) && !userSetCountry) withCountry.country = [country];

    // Always fetch fitout_level even when the user isn't showing that column:
    // the mark beside the price needs the UNIT's own level, and a project can
    // price shells and finished flats side by side (PANORÁMA Košice sells 241
    // shells and 19 finished, and carries no project-level answer at all).
    const out = { columns: cols.includes("fitout_level") ? cols : [...cols, "fitout_level"],
                  filters: withCountry, mode, sort: [effSort] };   // limit/offset from useUnitsInfinite
    if (built.filters_not) out.filters_not = built.filters_not;
    if (built.ranges) out.ranges = built.ranges;
    if (built.nulls) out.nulls = built.nulls;
    return out;
  }, [country, filters, cols, mode, effSort, fmtByKey, _money1, capsSets]);

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
  // The legend names only the schedules a reader can actually see on screen.
  const legendNote = useMemo(() => {
    if (!cols.includes("cena_s_dph")) return "";
    // Every schedule AND every fit-out level actually on screen, explained once
    // under the table by the same module that draws the marks.
    return specificsLegend(visible.map((r) => marksFor.unit(r, r.project_id || r.project_name)), lang);
  }, [visible, marksFor, cols, lang]);
  const padTop = startIdx * ROW_H;
  const padBottom = Math.max(0, (total - endIdx) * ROW_H);

  const toggleSort = (k) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));
  const toggleCol = (k) => setCols((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  const activeFilters = filters.filter(isFilterActive).length;

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
      // …including the presence filters. Without this line the map answers a WIDER
      // question than the table it was opened from, and the two disagree on screen.
      if (spec.nulls) p_spec.nulls = spec.nulls;
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

  // The shared control box (lib/controls.js), so this page's inputs and chips line
  // up with the Pickers they sit next to. Inline rather than the class because every
  // call site sets its own width and several reuse it as a button.
  const sel = { ...field };
  const typeBadge = (ty) => (ty === "numeric" ? "#" : ty === "date" || ty === "month" ? "📅" : "T");
  const typeColor = (ty) => (ty === "numeric" ? orange : green);

  return (
    <div style={{ color: text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* One compact row. The help text used to sit in a 16px-radius gradient card with
          1.25rem of padding and 1.5rem of margin under it — roughly 90px of the screen
          spent on one sentence, while the table below it was the reason for the page. It
          is a hint; it reads as a hint. The scope toggle sits on the same line, vertically
          centred with it, instead of floating beside a tall box. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.7rem" }}>
        <p style={{ color: dim, fontSize: "0.78rem", margin: 0, lineHeight: 1.5, maxWidth: "62ch" }}>
          {t("Surové dáta po jednotlivých bytoch. Vpravo si postav filtre na ľubovoľné pole a zvlášť vyber stĺpce; zoradíš klikom na hlavičku.",
             "Raw per-unit data. Build filters on any field on the right, choose your columns separately, and sort by clicking a header.")}
        </p>
        <div style={{ display: "inline-flex", border: `1px solid ${border}`, borderRadius: 7, overflow: "hidden", background: panel, flexShrink: 0 }}>
          {[["latest", t("Aktuálne", "Current")], ["archive", t("História", "All history")]].map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              title={m === "latest" ? t("Iba aktuálny stav trhu", "Only the current state of the market")
                                    : t("Všetky pozorovania v čase — byt sa objaví raz za deň, keď bol v ponuke", "Every observation over time — a unit appears once per day it was listed")}
              style={{ border: "none", padding: "0.45rem 0.9rem", cursor: "pointer", fontFamily: mono, fontSize: "0.72rem", letterSpacing: "0.03em", background: mode === m ? green : "transparent", color: mode === m ? "#04130d" : dim, fontWeight: mode === m ? 700 : 500 }}>{label}</button>
          ))}
        </div>
      </div>

      {/* two-column: main (filters + table) | palette */}
      <div className="rd-workbench">
        <div className="rd-workbench__main">
          {/* Query bar. The CONTROLS moved to the right-hand panel; what stays here is a
              readable statement of the query that is running, so the filter set is visible
              even while the panel is showing columns. Each chip removes its own filter. */}
          <div style={{ background: panel, border: `1px solid ${border}`, borderRadius: 8, padding: "0.5rem 0.6rem", marginBottom: "0.6rem", display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: mono, fontSize: "0.62rem", color: dim, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: "0.1rem" }}>
              <span style={{ display: "inline-block", width: 3, height: 12, borderRadius: 2, background: "var(--accent)", marginRight: "0.5rem", verticalAlign: "middle" }} />
              {t("Filtre", "Filters")}{activeFilters ? ` · ${activeFilters}` : ""}
            </span>

            {filters.length === 0 && (
              <button onClick={() => { setPanelTab("filters"); setAdding(true); }}
                style={{ ...sel, cursor: "pointer", color: accentInk, borderColor: green, fontFamily: mono, fontSize: "0.72rem" }}>
                + {t("Pridaj filter vpravo", "Add a filter on the right")}
              </button>
            )}

            {filters.map((f) => {
              const on = isFilterActive(f);
              return (
                <span key={f.id} onClick={() => { setPanelTab("filters"); setAdding(false); }}
                  title={t("Upraviť v paneli vpravo", "Edit in the panel on the right")}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: "0.35rem", cursor: "pointer",
                    background: on ? "color-mix(in srgb, var(--accent) 12%, var(--surface-2))" : bg,
                    border: `1px solid ${on ? green : border}`, borderRadius: 5,
                    padding: "0.12rem 0.4rem", fontSize: "0.72rem", color: on ? text : dim, maxWidth: 260,
                  }}>
                  <span style={{ fontWeight: 600 }}>{lbl(f.key)}</span>
                  <span style={{ color: dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {on ? summariseFilter(f, lang) : t("(nenastavený)", "(not set)")}
                  </span>
                  <span onClick={(e) => { e.stopPropagation(); removeFilter(f.id); }}
                    title={t("Odstrániť", "Remove")} style={{ color: dim, fontSize: "0.78rem" }}>✕</span>
                </span>
              );
            })}

            {filters.length > 0 && (
              <button onClick={() => setFilters([])} style={{ ...sel, cursor: "pointer", color: dim, fontFamily: mono, fontSize: "0.7rem" }}>
                ✕ {t("vyčistiť", "clear")}
              </button>
            )}

            <button onClick={showOnMap} disabled={mapBusy} title={t("Zobraziť vyfiltrované projekty na mape", "Show the filtered projects on the map")}
              style={{ ...sel, marginLeft: "auto", cursor: mapBusy ? "wait" : "pointer", color: "#04130d", background: green, borderColor: green, fontFamily: mono, fontSize: "0.72rem", fontWeight: 700 }}>
              🗺 {mapBusy ? t("otváram…", "opening…") : t("Zobraziť na mape", "Show on map")}
            </button>
            <span style={{ fontFamily: mono, fontSize: "0.72rem", color: dim }}>
              {loading && rows.length === 0 ? t("načítavam…", "loading…") : `${rows.length}${hasMore ? "+" : ""} ${t("bytov", "units")}`}
            </span>
          </div>

          {/* No columns means no query is even sent (useUnitsInfinite is disabled), which
              without this reads as "the filters returned nothing" — a wrong and alarming
              answer. The COLUMNS tab now has a "none" button, so this state is one click
              away and has to explain itself and offer the way back. */}
          {cols.length === 0 && (
            <div style={{ border: `1px solid ${border}`, borderRadius: 8, background: panel, padding: "2.2rem 1rem", textAlign: "center" }}>
              <div style={{ color: text, fontSize: "0.86rem", marginBottom: "0.3rem" }}>
                {t("Nie je vybraný žiadny stĺpec.", "No columns are selected.")}
              </div>
              <div style={{ color: dim, fontSize: "0.76rem", marginBottom: "0.9rem" }}>
                {t("Tabuľka nemá čo zobraziť — vyber stĺpce v paneli vpravo.", "There is nothing for the table to show — choose columns in the panel on the right.")}
              </div>
              <button onClick={() => { setCols(DEFAULT_COLS); setPanelTab("cols"); }}
                style={{ ...sel, cursor: "pointer", color: "#04130d", background: green, borderColor: green, fontFamily: mono, fontSize: "0.74rem", fontWeight: 700 }}>
                ↺ {t("Obnoviť predvolené stĺpce", "Restore the default columns")}
              </button>
            </div>
          )}

          {/* virtualized scrolling table — only the visible row window is in the DOM; scrolling
              near the bottom auto-loads the next page (handles arbitrarily large result sets) */}
          {cols.length > 0 && <div ref={scrollRef}
            onScroll={(e) => { const el = e.currentTarget; setScrollTop(el.scrollTop); if (hasMore && !loading && el.scrollHeight - el.scrollTop - el.clientHeight < 500) loadMore(); }}
            /* Same bottom edge as the panel beside it. The table was a flat 62vh while the
               panel ran to the foot of the window, so the two columns ended at different
               heights and the page looked unfinished at any size. The 56px is the query
               bar above the table plus its gap — the panel starts that much higher. */
            style={{ overflow: "auto", height: "calc(100vh - 206px)", minHeight: 364, border: `1px solid ${border}`, borderRadius: 8, background: panel }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: "100%", minWidth: Math.max(1, cols.length) * 150, fontSize: "0.8rem" }}>
              <thead style={{ background: "var(--surface-2)", position: "sticky", top: 0, zIndex: 1 }}>
                <tr>
                  {cols.map((k) => {
                    const numeric = fields.find((f) => f.key === k)?.type === "numeric";
                    return (
                      <th key={k} onClick={() => toggleSort(k)} title={t("Klikni pre zoradenie", "Click to sort")}
                        style={{ padding: "0.55rem 0.7rem", textAlign: numeric ? "right" : "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer", borderBottom: `1px solid ${border}`, color: effSort.key === k ? green : "var(--text-2)", userSelect: "none", fontFamily: mono, fontSize: "0.68rem", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700 }}>
                        {lbl(k)}{effSort.key === k ? (effSort.dir === "asc" ? " ▲" : " ▼") : ""}
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
                        // A price that only holds under a payment schedule gets a
                        // one-character mark, so a right-aligned money column keeps
                        // its shape. The sentence lives in the tooltip and the legend.
                        // What this price assumes: the payment schedule and what
                        // it BUYS. The unit's own level wins over the project's —
                        // Nová Myslivna sells one Shell&Core unit inside an
                        // otherwise standard project.
                        const marks = k === "cena_s_dph" ? marksFor.unit(r, r.project_id || r.project_name) : null;
                        return <td key={k} style={{ height: ROW_H, boxSizing: "border-box", padding: "0 0.7rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: numeric ? "right" : "left", borderTop: `1px solid var(--surface)`, color: k === effSort.key ? text : "var(--text-2)", fontFamily: numeric ? mono : "inherit", fontVariantNumeric: "tabular-nums" }}>{fmtVal(k, r[k], fmtByKey, numeric, lang)}<UnitPriceMarks items={marks} lang={lang} compact /></td>;
                      })}
                    </tr>
                  );
                })}
                {padBottom > 0 && <tr style={{ height: padBottom }}><td colSpan={cols.length} style={{ padding: 0, border: 0 }} /></tr>}
                {!loading && rows.length === 0 && loadFailed && (
                  <tr><td colSpan={cols.length || 1} style={{ padding: 0 }}><LoadError lang={lang} /></td></tr>
                )}
                {!loading && rows.length === 0 && !loadFailed && (
                  <tr><td colSpan={cols.length || 1} style={{ padding: "2rem", textAlign: "center", color: dim, fontStyle: "italic" }}>{t("Žiadne byty pre tento filter.", "No units match this filter.")}</td></tr>
                )}
              </tbody>
            </table>
          </div>}
          {loading && rows.length > 0 && <div style={{ marginTop: "0.45rem", fontFamily: mono, fontSize: "0.7rem", color: dim }}>{t("načítavam ďalšie…", "loading more…")}</div>}
          {/* Only shown when a marked price is actually on screen — a legend for
              something the reader cannot see is just clutter. */}
          {legendNote && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.72rem", lineHeight: 1.45, color: dim }}>
              {legendNote}
            </div>
          )}
        </div>

        <FieldPanel
          lang={lang} sel={sel}
          tab={panelTab} setTab={setPanelTab}
          adding={adding} setAdding={setAdding}
          search={search} setSearch={setSearch}
          fields={panelFields}
          catOf={(k) => CATEGORY[k] || "other"} catOrder={CAT_ORDER} catLabel={CAT_LABEL}
          capsOf={capsOf} unitOf={unitOf}
          useValues={useValues}
          filters={filters} onAdd={addFilter} onPatch={patchFilter} onRemove={removeFilter}
          cols={cols} onToggleCol={toggleCol} onSetCols={setCols} defaultCols={DEFAULT_COLS}
          emptyHint={t("Tabuľka ukazuje celý trh — pridaj filter tlačidlom vyššie.",
                       "The table shows the whole market — add one with the button above.")}
        />
      </div>
    </div>
  );
}
