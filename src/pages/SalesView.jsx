/* SalesView — Analytics → Predaje / Sales.
   "How many and WHICH units sold — and STAYED sold — in a period, for the projects I pick."
   Reads public.analytics_sales (summary / breakdown / detail / facets) over
   analytics.sale_events: durable sale detection (delete-on-sale aware, relist-reversed),
   frozen sale price/€m²/days-on-market.

   LOOK: built on the shared UI kit in styles/ui.css (`.rd-card`, `.rd-deck`, `.rd-tabs`,
   `.rd-seg`, `.rd-field`, `.rd-btn`, `.rd-kpi`, `.rd-table`) — one card holding the
   controls, underline tabs for the view, a grey-track segmented control for the small
   switches, and one table style with a sticky head. Dropdowns are always <Picker>, never
   a native <select>: the OS menu can't show the live facet counts and paints itself with
   the OS palette. Nothing here sets a colour that isn't a token, so light and dark both
   work. (Redesigned 2026-08-19 — Boss: "the whole sales page is old looking… especially
   the bottom half… also the data in the dropdown menus".)

   Built for the comparable-projects pricing workflow (e.g. Nitra). */
import { useState, useMemo } from "react";
import { useCurrency } from "../lib/useCurrency";
import { moneyFromEur, moneySymbol, moneyToEur } from "../lib/money";
import { useSales } from "../lib/useData";
import { useCountry, isAllCountries } from "../lib/useCountry";
import { useAccountPrefState } from "../lib/useAccountUiPref";
import { localeTag } from "../lib/locale";
import LoadError from "../components/LoadError";
import Picker from "../components/Picker";
import InfoTip from "../components/InfoTip";
import Kpi from "../components/Kpi";
import DateField from "../components/DateField";
import CountrySwitcher from "../components/CountrySwitcher";
import { text } from "../lib/theme";
import { useSpecifics, SpecificsMark, UnitPriceMarks } from "../lib/projectSpecifics";

const DETAIL_LIMIT = 500; // page size for the detail table; the RPC returns +1 as a has-more sentinel
const PERIODS = [[30, "30 dní", "30 days"], [45, "45 dní", "45 days"], [60, "60 dní", "60 days"], [90, "90 dní", "90 days"]];
const GROUP_DIMS = [
  ["city", "Mesto", "City"], ["district", "Mestská časť", "District"], ["developer", "Developer", "Developer"],
  ["project_name", "Projekt", "Project"], ["typ", "Typ", "Type"], ["izby", "Izby", "Rooms"],
  ["kolaudacia_label", "Kolaudácia", "Completion"],
];
const DETAIL_COLS = [
  ["sold_date", "Predané", "Sold", "date"], ["project_name", "Projekt", "Project", "text"],
  ["city", "Mesto", "City", "text"], ["typ", "Typ", "Type", "text"], ["izby", "Izby", "Rooms", "num"],
  ["obytna_plocha", "Plocha", "Area", "area"], ["price_s_dph_eur", "Cena", "Price", "eur"],
  ["price_per_m2_eur", "€/m²", "€/m²", "per_m2"], ["days_on_market", "Dní na trhu", "Days on mkt", "num"],
  ["detection_method", "Zdroj", "Signal", "sig"], ["kind", "", "", "hide"],
];
// pipeline (reserved / pre-reserved) = current units, no sale-date / days-on-market / signal
const DETAIL_COLS_PIPE = [
  ["project_name", "Projekt", "Project", "text"], ["city", "Mesto", "City", "text"],
  ["typ", "Typ", "Type", "text"], ["izby", "Izby", "Rooms", "num"],
  ["obytna_plocha", "Plocha", "Area", "area"], ["price_s_dph_eur", "Cena", "Price", "eur"],
  ["price_per_m2_eur", "€/m²", "€/m²", "per_m2"], ["kolaudacia_label", "Kolaudácia", "Completion", "text"],
];
// Per-column FILTER kind for the detail-table column filters (server-side via
// analytics_sales detail_filters). "cat" = in-list dropdown, "num" = min/max range,
// "date" = from/to. Columns not listed here get no filter control.
const COL_FILTER_KIND = {
  sold_date: "date",
  project_name: "cat", city: "cat", typ: "cat", detection_method: "cat", kolaudacia_label: "cat",
  izby: "num", obytna_plocha: "num", price_s_dph_eur: "num", price_per_m2_eur: "num", days_on_market: "num",
};
// Width of each column's filter control. Fixed, because a table in auto layout sizes a
// column to its widest content: an elastic dropdown holding "Rezidencia Mierová" would
// drag the whole column that wide and shove the money columns off the screen.
const COL_FILTER_W = {
  sold_date: 108, project_name: 146, city: 104, typ: 88, detection_method: 100,
  kolaudacia_label: 112, izby: 50, obytna_plocha: 58, price_s_dph_eur: 68,
  price_per_m2_eur: 62, days_on_market: 56,
};
// Money columns are stored in EUR but typed by the user in the DISPLAY currency → convert.
const MONEY_COLS = new Set(["price_s_dph_eur", "price_per_m2_eur"]);
// The scope filters at the top of the page. Their option lists are recomputed live from the
// current selection (analytics_sales mode:'facets'), each one excluding its own filter.
const BASE_FACETS = ["city", "developer", "typ", "project_name"];

// Per-column plain-language explainers (rendered as an "i" tooltip on the header),
// for the columns whose meaning / calculation isn't self-evident. Same voice as the
// Dashboard metric explainers. Keyed by column key.
const COL_INFO = {
  obytna_plocha:    { sk: "Obytná plocha bytu v m² (nie celková/podlahová).", en: "Living area of the unit in m² (not total/floor area)." },
  price_s_dph_eur:  { sk: "Cena s DPH, zafixovaná v čase predaja — posledná reálna cena, ktorú developer zverejnil pred tým, než byt zmizol/označil ako predaný. „—“ = developer cenu nezverejnil.", en: "Price incl. VAT, frozen at sale time — the last real price the developer published before the unit sold. “—” = the developer never published a price." },
  price_per_m2_eur: { sk: "Cena za m² obytnej plochy, s DPH, v čase predaja (cena ÷ obytná plocha).", en: "Price per m² of living area, incl. VAT, at sale time (price ÷ living area)." },
  days_on_market:   { sk: "Počet dní od prvého zachytenia po predaj. „≥“ = byt bol v ponuke už keď sme začali sledovať (máj 2026), takže skutočný čas na trhu môže byť dlhší.", en: "Days from first sight to sold. “≥” = the unit was already listed when we began tracking (May 2026), so its true time on market may be longer." },
  detection_method: { sk: "Ako zisťujeme predaje: „označené“ = developer označil byt ako predaný priamo na webe projektu; „zmizol“ = byt zmizol z ponuky (používa sa, keď developer predané byty na webe nenecháva, takže zmiznutie berieme ako predaj).", en: "How we detect sales: “marked” = the developer flagged it as sold on the project website; “delisted” = it disappeared from the listing (used when the developer doesn't keep sold units on the website, so a disappearance is taken as a sale)." },
};
// the three status views
const STATUSES = [["sold", "Predané", "Sold"], ["reserved", "Rezervované", "Reserved"], ["prereserved", "Predrezervované", "Pre-reserved"]];
const HEADLINE = { sold: ["Predané (trvalo)", "Sold (stayed)"], reserved: ["Rezervované teraz", "Reserved now"], prereserved: ["Predrezervované teraz", "Pre-reserved now"] };

// LOCAL calendar date (YYYY-MM-DD) — NOT toISOString(), which returns the UTC date.
// Our users are in SK/CZ (UTC+1/+2), so a UTC date shifts the whole "last N days" window
// back a day for any part of the evening, silently dropping units sold "today".
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function isoDaysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return isoLocal(d);
}
const isoToday = () => isoLocal(new Date());

const fmtInt = (n) => (n == null ? "" : Number(n).toLocaleString("sk-SK").replace(/,/g, " "));

/* A stored date is an ISO day; a reader wants "18. aug 2026", not "2026-08-18".
   Short month, never a bare number pair, so 08/09 can't be read as September. */
function fmtDay(v, lang) {
  if (!v) return "—";
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString(localeTag(lang), { day: "numeric", month: "short", year: "numeric" });
}

// "what's still available here" line under a numeric / date column filter. Money bounds are
// stored in EUR and shown in the display currency, exactly like the values in the table.
function fmtRange(kind, r, lang) {
  if (!r || r.min == null || r.max == null) return null;
  const one = (v) => {
    if (kind === "date") return fmtDay(v, lang);
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (kind === "eur" || kind === "per_m2") return fmtInt(Math.round(moneyFromEur(n)));
    if (kind === "area") return n.toLocaleString("sk-SK", { maximumFractionDigits: 1 });
    return fmtInt(Math.round(n));
  };
  const lo = one(r.min), hi = one(r.max);
  return lo === hi ? lo : `${lo} – ${hi}`;
}

function fmtMoney(eur) {
  if (eur == null || !Number.isFinite(Number(eur))) return "—";
  return moneySymbol() + Math.round(moneyFromEur(Number(eur))).toLocaleString("sk-SK").replace(/,/g, " ");
}
function fmtCell(kind, v, lang) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (kind === "eur") return fmtMoney(v);
  if (kind === "per_m2") return Number.isFinite(n) ? Math.round(moneyFromEur(n)).toLocaleString("sk-SK").replace(/,/g, " ") + " " + moneySymbol() : "—";
  if (kind === "area") return Number.isFinite(n) ? n.toLocaleString("sk-SK", { maximumFractionDigits: 1 }) + " m²" : "—";
  if (kind === "date") return fmtDay(v, lang);
  return String(v);
}

export default function SalesView({ lang = "sk" }) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  useCurrency();
  const { country } = useCountry();   // global market switcher (left dock) — single source of truth

  const [status, setStatus] = useState("sold");
  const isPipe = status !== "sold";
  const [days, setDays] = useState(45);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [durableOnly, setDurableOnly] = useState(true);
  const [projects, setProjects] = useState([]);  // selected project_name[]
  const [fCity, setFCity] = useState("");
  const [fDev, setFDev] = useState("");
  const [fTyp, setFTyp] = useState("");
  const [groupBy, setGroupBy] = useState("city");
  const spec = useSpecifics(lang);
  const [sort, setSort] = useState({ key: "sold_date", dir: "desc" });
  // Per-column filters on the detail table. Shape per column: "cat" → string value;
  // "num" → { min, max } (display-currency strings for money cols); "date" → { from, to }.
  const [colFilters, setColFilters] = useState({});

  // Remember the Sales filters per-account, across devices (localStorage + ui_prefs).
  useAccountPrefState(
    "salesFilters",
    { status, days, customFrom, customTo, durableOnly, projects, fCity, fDev, fTyp, groupBy, sort, colFilters },
    (s) => {
      if (s.status !== undefined) setStatus(s.status);
      if (s.days !== undefined) setDays(s.days);
      if (s.customFrom !== undefined) setCustomFrom(s.customFrom);
      if (s.customTo !== undefined) setCustomTo(s.customTo);
      if (typeof s.durableOnly === "boolean") setDurableOnly(s.durableOnly);
      if (Array.isArray(s.projects)) setProjects(s.projects);
      if (s.fCity !== undefined) setFCity(s.fCity);
      if (s.fDev !== undefined) setFDev(s.fDev);
      if (s.fTyp !== undefined) setFTyp(s.fTyp);
      if (s.groupBy !== undefined) setGroupBy(s.groupBy);
      if (s.sort && typeof s.sort === "object") setSort(s.sort);
      if (s.colFilters && typeof s.colFilters === "object") setColFilters(s.colFilters);
    },
  );

  const date_from = customFrom || isoDaysAgo(days);
  const date_to = customTo || isoToday();

  const baseFilters = useMemo(() => {
    const f = {};
    // Global country → market_key. Country codes are 'SK'/'CZ'; the sale facts
    // key markets lowercase ('sk'/'cz'). 'all' drops the filter (every market).
    if (!isAllCountries(country)) f.market_key = [country.toLowerCase()];
    if (projects.length) f.project_name = projects;
    if (fCity) f.city = [fCity];
    if (fDev) f.developer = [fDev];
    if (fTyp) f.typ = [fTyp];
    return f;
  }, [country, projects, fCity, fDev, fTyp]);

  // sale-only sort keys are invalid for the current-pipeline views → fall back to price
  const effSort = isPipe && (sort.key === "sold_date" || sort.key === "days_on_market") ? { key: "price_s_dph_eur", dir: "desc" } : sort;
  const detailCols = isPipe ? DETAIL_COLS_PIPE : DETAIL_COLS;
  const visibleCols = detailCols.filter((c) => c[3] !== "hide");
  const detailColSpan = visibleCols.length; // full-row cells must span the ACTUAL visible column count (varies sold vs pipeline)
  const SORTABLE = isPipe ? ["price_s_dph_eur", "price_per_m2_eur", "izby", "obytna_plocha", "city", "project_name"]
                          : ["sold_date", "price_s_dph_eur", "price_per_m2_eur", "days_on_market", "izby", "obytna_plocha", "city", "project_name"];
  // ── detail-table per-column filters → server-side `detail_filters` ──
  // Only columns VISIBLE in the current mode are applied (sold vs pipeline differ), so a
  // dormant sold-only filter (e.g. signal) doesn't silently narrow the pipeline view —
  // and it's preserved for when the user switches back. Money thresholds are typed in the
  // display currency → converted to EUR (curSym is a dep so they re-convert on a switch).
  const curSym = moneySymbol();
  const visibleColKeys = useMemo(() => new Set(visibleCols.map((c) => c[0])), [detailCols]); // eslint-disable-line
  const detailFilters = useMemo(() => {
    const out = {};
    for (const [key, val] of Object.entries(colFilters)) {
      const kind = COL_FILTER_KIND[key];
      if (!kind || val == null || !visibleColKeys.has(key)) continue;
      if (kind === "cat") {
        if (val) out[key] = { values: [val] };
      } else if (kind === "num") {
        const conv = MONEY_COLS.has(key) ? (x) => moneyToEur(Number(x)) : (x) => Number(x);
        const o = {};
        if (val.min != null && val.min !== "" && !Number.isNaN(Number(val.min))) o.min = conv(val.min);
        if (val.max != null && val.max !== "" && !Number.isNaN(Number(val.max))) o.max = conv(val.max);
        if ("min" in o || "max" in o) out[key] = o;
      } else if (kind === "date") {
        const o = {};
        if (val.from) o.from = val.from;
        if (val.to) o.to = val.to;
        if ("from" in o || "to" in o) out[key] = o;
      }
    }
    return out;
  }, [colFilters, visibleColKeys, curSym]); // eslint-disable-line -- curSym: re-convert money thresholds on currency switch

  const common = { status, date_from, date_to, durable_only: durableOnly, filters: baseFilters };
  const summarySpec = useMemo(() => ({ ...common, mode: "summary" }), [JSON.stringify(common)]);       // eslint-disable-line
  const breakdownSpec = useMemo(() => ({ ...common, mode: "breakdown", group_by: groupBy }), [JSON.stringify(common), groupBy]); // eslint-disable-line
  const detailSpec = useMemo(() => ({ ...common, mode: "detail", sort: [effSort], limit: DETAIL_LIMIT, detail_filters: detailFilters }), [JSON.stringify(common), JSON.stringify(effSort), JSON.stringify(detailFilters)]); // eslint-disable-line

  // ── LIVE FACETS: what can still be picked, given everything already picked ──
  // Both filter rows are populated from the SAME facts the page is showing, not from a
  // global list — so City only offers cities with sales in this period/market, Developer
  // only developers still present in the chosen city, and so on. Each field's own filter
  // is excluded server-side, so choosing a city never collapses the city list to that one
  // city. `base` = the scope row at the top; `detail` = the per-column row above the unit
  // list, which additionally sees the other column filters (it drills inside the scope).
  const baseFacetSpec = useMemo(() => ({ ...common, mode: "facets", facet_scope: "base", facets: BASE_FACETS }), [JSON.stringify(common)]); // eslint-disable-line
  const detailFacetKeys = useMemo(
    () => visibleCols.filter((c) => COL_FILTER_KIND[c[0]]).map((c) => c[0]),
    [detailCols], // eslint-disable-line
  );
  const detailFacetSpec = useMemo(
    () => ({ ...common, mode: "facets", facet_scope: "detail", facets: detailFacetKeys, detail_filters: detailFilters }),
    [JSON.stringify(common), JSON.stringify(detailFacetKeys), JSON.stringify(detailFilters)], // eslint-disable-line
  );

  const sum = useSales({ enabled: true, spec: summarySpec });
  const brk = useSales({ enabled: true, spec: breakdownSpec });
  const det = useSales({ enabled: true, spec: detailSpec });
  const fac = useSales({ enabled: true, spec: baseFacetSpec });
  const facDet = useSales({ enabled: true, spec: detailFacetSpec });

  const S = sum.data || {};
  const brkRows = brk.data?.rows || [];
  // Longest bar in the breakdown = the biggest group, so the column reads as a chart.
  const brkMax = brkRows.reduce((m, r) => Math.max(m, Number(r.sold) || 0), 0);
  // The RPC returns limit+1 rows as a "there's more" sentinel — slice back to the page
  // size and surface the overflow as a "+" so the table never shows a stray extra row.
  const _detRaw = det.data?.rows || [];
  const detHasMore = _detRaw.length > DETAIL_LIMIT;
  const detRows = detHasMore ? _detRaw.slice(0, DETAIL_LIMIT) : _detRaw;

  // Facet lists → picker options. A value that is STILL SELECTED but no longer available
  // (another filter moved under it) is kept in the list showing 0, so the control never
  // displays a value it doesn't offer and the user can see why the table went empty.
  const facetOptions = (facets, key, selected, labelOf) => {
    const list = facets?.values?.[key] || [];
    const opts = list.map((o) => ({ value: o.v, label: labelOf ? labelOf(o.v) : o.v, hint: fmtInt(o.n) }));
    const chosen = Array.isArray(selected) ? selected : (selected ? [selected] : []);
    for (const v of chosen) {
      // server matching is case-insensitive → compare the same way before re-adding
      if (v && !list.some((o) => String(o.v).toLowerCase() === String(v).toLowerCase())) {
        opts.push({ value: v, label: labelOf ? labelOf(v) : v, hint: "0" });
      }
    }
    return opts.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
  };
  const cityOptions = useMemo(() => facetOptions(fac.data, "city", fCity), [fac.data, fCity]);
  const devOptions  = useMemo(() => facetOptions(fac.data, "developer", fDev), [fac.data, fDev]);
  const typOptions  = useMemo(() => facetOptions(fac.data, "typ", fTyp), [fac.data, fTyp]);
  const projOptions = useMemo(() => facetOptions(fac.data, "project_name", projects), [fac.data, projects]);

  const toggleProject = (name) => setProjects((p) => p.includes(name) ? p.filter((x) => x !== name) : [...p, name]);
  const clearFilters = () => { setProjects([]); setFCity(""); setFDev(""); setFTyp(""); };
  const activeFilters = projects.length + [fCity, fDev, fTyp].filter(Boolean).length;
  const toggleSort = (k) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" }));

  // ── detail-table column-filter helpers ──
  const setColCat = (key, v) => setColFilters((f) => { const n = { ...f }; if (v) n[key] = v; else delete n[key]; return n; });
  const setColBound = (key, bound, v) => setColFilters((f) => {
    const cur = (f[key] && typeof f[key] === "object") ? f[key] : {};
    const nv = { ...cur, [bound]: v };
    const empty = ["min", "max", "from", "to"].every((b) => (nv[b] ?? "") === "");
    const n = { ...f };
    if (empty) delete n[key]; else n[key] = nv;
    return n;
  });
  const clearColFilters = () => setColFilters({});
  const activeColCount = Object.keys(detailFilters).length;
  // Column-filter options come from the DETAIL facets — the values present across the WHOLE
  // selection, not just the 500 rows fetched for the page (which is what the kolaudácia list
  // used to be built from, so it silently offered only what happened to be on screen).
  const colOptions = (key) => facetOptions(facDet.data, key, colFilters[key],
    key === "detection_method" ? (v) => (v === "marked" ? t("označené", "marked") : v === "disappeared" ? t("zmizol", "delisted") : v) : null);
  // Available min/max for a numeric / date column, under every OTHER active filter.
  const colRange = (key) => facDet.data?.ranges?.[key] || null;

  const exportCsv = () => {
    // Money columns: export in the SAME display currency the table shows (converted +
    // symbol in the header), so the CSV never silently disagrees with the on-screen values.
    const sym = moneySymbol();
    const head = visibleCols.map((c) => {
      const base = c[3] === "per_m2" ? `${sym}/m²` : (lang === "sk" ? c[1] : c[2]);
      return c[3] === "eur" ? `${base} (${sym})` : base;
    }).join(";");
    const lines = detRows.map((r) => visibleCols.map((c) => {
      const v = r[c[0]];
      if (c[3] === "eur" || c[3] === "per_m2") return v == null ? "" : Math.round(moneyFromEur(Number(v)));
      return v == null ? "" : String(v).replace(/;/g, ",");
    }).join(";"));
    const blob = new Blob(["﻿" + [head, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `predaje_${date_from}_${date_to}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  // A scope filter: one Picker, live facet options, each option's own count as the
  // hint. An element factory, NOT a component declared in the render — a fresh
  // function identity each render would remount the Picker and slam an open
  // dropdown shut the moment new facet data arrived.
  const scopeFilter = (value, onChange, opts, ph, w = 152) => (
    <Picker value={value} onChange={onChange} width={w} searchable sk={lang === "sk"} placeholder={ph} ariaLabel={ph}
      options={[{ value: "", label: ph }, ...(opts || [])]} />
  );

  const dur = S.sold_durable ?? 0;
  const gross = S.sold_all ?? 0;
  const reversed = Math.max(0, gross - dur);
  const rangeLabel = `${fmtDay(date_from, lang)} – ${fmtDay(date_to, lang)}`;

  return (
    <div style={{ color: text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* intro band — what this page answers, and over which window */}
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 14, border: "1px solid var(--border)", padding: "0.95rem 1.2rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", background: "radial-gradient(120% 140% at 2% -20%, color-mix(in srgb, var(--accent) 13%, transparent) 0%, transparent 46%), linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, var(--surface)) 0%, var(--bg) 75%)" }}>
        <p style={{ color: "var(--text-dim)", fontSize: "0.82rem", margin: 0, lineHeight: 1.55, flex: "1 1 320px" }}>
          {t("Koľko a KTORÉ byty sa predali — a zostali predané — vo zvolenom období, pre projekty ktoré si vyberieš.",
             "How many and WHICH units sold — and stayed sold — in the chosen period, for the projects you pick.")}
        </p>
        {!isPipe && (
          <span className="rd-label" style={{ fontSize: "0.66rem", color: "var(--accent-ink)", letterSpacing: "0.04em", textTransform: "none" }}>{rangeLabel}</span>
        )}
      </div>

      {/* status: the three views of the same facts */}
      <div className="rd-tabs" role="tablist" style={{ marginBottom: "0.9rem" }}>
        {STATUSES.map(([s, sk, en]) => (
          <button key={s} role="tab" className="rd-tab" aria-selected={status === s} onClick={() => setStatus(s)}>
            {t(sk, en)}
          </button>
        ))}
      </div>

      {/* control deck — period + scope filters in ONE card, hairline-separated */}
      <div className="rd-card rd-deck" style={{ marginBottom: "0.7rem" }}>
        <div className="rd-deck__row">
          <span className="rd-label">{isPipe ? t("Stav teraz", "Current state") : t("Obdobie", "Period")}</span>
          {isPipe ? (
            <span style={{ fontSize: "0.78rem", color: "var(--text-dim)" }}>
              {t("Aktuálny pipeline — obdobie sa neuplatňuje", "Current pipeline — period doesn't apply")}
            </span>
          ) : (
            <>
              <div className="rd-seg">
                {PERIODS.map(([d, sk, en]) => (
                  <button key={d} className="rd-seg__btn" aria-pressed={!customFrom && !customTo && days === d}
                    onClick={() => { setDays(d); setCustomFrom(""); setCustomTo(""); }}>
                    {t(sk, en)}
                  </button>
                ))}
              </div>
              <span style={{ color: "var(--text-faint)", fontSize: "0.72rem" }}>{t("alebo", "or")}</span>
              <DateField value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} width={132} title={t("od", "from")} />
              <span style={{ color: "var(--text-faint)" }}>–</span>
              <DateField value={customTo} onChange={(e) => setCustomTo(e.target.value)} width={132} title={t("do", "to")} />
              {(customFrom || customTo) && (
                <button className="rd-btn rd-btn--ghost rd-btn--sm" onClick={() => { setCustomFrom(""); setCustomTo(""); }}>
                  ✕ {t("vlastné", "custom")}
                </button>
              )}
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", color: "var(--text-dim)", cursor: "pointer", marginLeft: "auto" }}
                title={t("Zarátaj len predaje ktoré zostali predané (vylúč tie čo sa vrátili na trh)", "Count only sales that stayed sold (exclude fall-throughs)")}>
                <input type="checkbox" checked={durableOnly} onChange={(e) => setDurableOnly(e.target.checked)} />
                {t("Len trvalé predaje", "Stayed-sold only")}
              </label>
            </>
          )}
        </div>

        <div className="rd-deck__row">
          <span className="rd-label">{t("Filtre", "Filters")}{activeFilters ? ` · ${activeFilters}` : ""}</span>
          {/* Country / market — the shared global switcher (same state as the left dock).
              Scopes the sold/reserved facts AND every option list to SK / CZ / All, so the
              sidebar switcher now filters Sales like every other page. Renders nothing while
              only one market is active. */}
          <CountrySwitcher lang={lang} hideLabel />
          {/* Projects: the app's own multi-select — searchable, live counts, closes on an
              outside click. (Was a hand-rolled panel with native checkboxes that stayed
              open until you clicked its button again.) */}
          <Picker multi searchable width={186} sk={lang === "sk"} value={projects} onChange={setProjects}
            options={projOptions} ariaLabel={t("Projekty", "Projects")}
            placeholder={fac.loading && !projOptions.length ? t("načítavam…", "loading…") : t("Projekty: všetky", "Projects: all")} />
          {scopeFilter(fCity, setFCity, cityOptions, t("Mesto: všetky", "City: all"))}
          {scopeFilter(fDev, setFDev, devOptions, t("Developer: všetci", "Developer: all"), 166)}
          {scopeFilter(fTyp, setFTyp, typOptions, t("Typ: všetky", "Type: all"), 128)}
          {projects.map((p) => (
            <span key={p} className="rd-chip" onClick={() => toggleProject(p)} title={t("Odobrať z výberu", "Remove from selection")}>
              <span className="rd-chip__label">{p}</span><span className="rd-chip__x">✕</span>
            </span>
          ))}
          {activeFilters > 0 && (
            <button className="rd-btn rd-btn--ghost rd-btn--sm" onClick={clearFilters}>✕ {t("vyčistiť", "clear")}</button>
          )}
        </div>
      </div>

      {/* KPI row */}
      {sum.error ? <LoadError lang={lang} /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(172px, 1fr))", gap: "0.7rem", marginBottom: "0.7rem" }}>
          <Kpi loading={sum.loading} label={t(HEADLINE[status][0], HEADLINE[status][1])} value={dur.toLocaleString("sk-SK")}
            sub={reversed > 0 && !durableOnly && !isPipe ? t(`+${reversed} vrátených`, `+${reversed} fell through`) : null} subWarn
            info={t("Počet bytov v tomto stave za zvolené obdobie (pri predaných: tie, ktoré zostali predané). „+N vrátených“ = predaje, ktoré sa vrátili späť na trh.",
                    "Units in this state for the selected period (for sold: those that stayed sold). “+N fell through” = sales that returned to the market.")} />
          <Kpi loading={sum.loading} label={isPipe ? t("Hodnota v ponuke", "Listed value") : t("Objem predaja", "Sold value")} value={fmtMoney(S.sold_value_eur)}
            info={t("Súčet cien (s DPH) bytov v tomto výbere.", "Sum of prices (incl. VAT) of the units in this selection.")} />
          <Kpi loading={sum.loading} label={t("Medián ceny", "Median price")} value={fmtMoney(S.median_price_eur)}
            info={t("Stredná cena bytu — polovica je lacnejšia, polovica drahšia. Odolnejšia voči extrémom než priemer.",
                    "The middle unit price — half are cheaper, half dearer. More robust to outliers than the average.")} />
          <Kpi loading={sum.loading} label={`${t("Medián ", "Median ")}${moneySymbol()}/m²`} value={fmtCell("per_m2", S.median_eur_m2, lang)}
            info={t("Stredná cena za m² (s DPH) v tomto výbere.", "The middle price per m² (incl. VAT) in this selection.")} />
          {!isPipe && (
            <Kpi loading={sum.loading} label={t("Medián dní na trhu", "Median days on market")}
              value={S.median_days_on_market != null ? Math.round(S.median_days_on_market) : "—"}
              sub={S.observed_dom_count
                ? `${t(`z ${S.observed_dom_count} predaných`, `of ${S.observed_dom_count} sold`)}${S.censored_count ? t(` · z toho ${S.censored_count}× „≥“`, ` · ${S.censored_count}× are ≥`) : ""}`
                : t("zatiaľ málo dát", "building history")}
              info={t("Stredný počet dní od prvého zachytenia po predaj. Byty označené „≥“ boli v ponuke už na začiatku sledovania, takže skutočná hodnota môže byť vyššia.",
                      "Median days from first sight to sold. Units marked “≥” were already listed when tracking began, so the real figure may be higher.")} />
          )}
        </div>
      )}

      {/* breakdown */}
      <div className="rd-card rd-card--pad" style={{ marginBottom: "0.7rem" }}>
        <div className="rd-sect" style={{ marginBottom: "0.7rem" }}>
          <span className="rd-sect__tick" />
          <span className="rd-sect__name">{t("Rozklad podľa", "Break down by")}</span>
          <div className="rd-seg rd-seg--wrap">
            {GROUP_DIMS.map(([k, sk, en]) => (
              <button key={k} className="rd-seg__btn" aria-pressed={groupBy === k} onClick={() => setGroupBy(k)}>{t(sk, en)}</button>
            ))}
          </div>
        </div>
        <div className="rd-scroll">
          <table className="rd-table" style={{ minWidth: 520 }}>
            <thead><tr>{[
              { h: t("Skupina", "Group") },
              { h: isPipe ? t("V ponuke", "Listed") : t("Predané", "Sold"), num: true, info: isPipe ? null : t("Počet bytov, ktoré sa v období predali a zostali predané.", "Units that sold — and stayed sold — in the period.") },
              { h: t("Objem", "Value"), num: true, info: t("Súčet cien (s DPH) predaných bytov v skupine.", "Sum of prices (incl. VAT) of the sold units in the group.") },
              { h: `${t("Medián ", "Median ")}${moneySymbol()}/m²`, num: true, info: t("Stredná cena za m² (s DPH) predaných bytov v skupine.", "Median price per m² (incl. VAT) of the sold units in the group.") },
              { h: t("Medián dní", "Median days"), num: true, info: t("Stredný počet dní na trhu (od prvého zachytenia po predaj). Zahŕňa aj byty rátané od prvého zachytenia („≥“), takže hodnota môže byť konzervatívna.", "Median days on market (first sight to sold). Includes units counted from first sight (“≥”), so the figure can be conservative.") },
            ].map((o) => (
              <th key={o.h} className={o.num ? "num" : undefined}>
                {o.h}{o.info && <span style={{ marginLeft: 5, display: "inline-block", verticalAlign: "middle" }}><InfoTip text={o.info} label={o.h} /></span>}
              </th>
            ))}</tr></thead>
            <tbody>
              {brk.loading && <tr><td className="rd-td--empty" colSpan={5} style={{ fontStyle: "normal" }}>{t("načítavam…", "loading…")}</td></tr>}
              {!brk.loading && brkRows.length === 0 && <tr><td className="rd-td--empty" colSpan={5}>{isPipe ? t("Žiadne jednotky pre tento výber.", "No units for this selection.") : t("Žiadne predaje pre tento výber.", "No sales for this selection.")}</td></tr>}
              {brkRows.map((r, i) => (
                <tr key={String(r.group) + i}>
                  <td className="rd-td--key">{r.group ?? "—"}
                    {groupBy === "project_name" ? <SpecificsMark items={spec.project(r.group)} lang={lang} /> : null}
                  </td>
                  {/* the count doubles as a bar, so the biggest groups are visible at a glance */}
                  <td className="num" style={{ color: "var(--text)", minWidth: 96 }}>
                    {Number(r.sold).toLocaleString("sk-SK")}
                    {brkMax > 0 && <span className="rd-bar"><span className="rd-bar__fill" style={{ width: `${Math.max(2, (Number(r.sold) / brkMax) * 100)}%` }} /></span>}
                  </td>
                  <td className="num">{fmtMoney(r.sold_value_eur)}</td>
                  <td className="num">{fmtCell("per_m2", r.median_eur_m2, lang)}</td>
                  <td className="num">{r.median_days_on_market != null ? Math.round(r.median_days_on_market) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* detail: the exact units */}
      <div className="rd-card rd-card--pad">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <div className="rd-sect">
            <span className="rd-sect__tick" />
            <span className="rd-sect__name">{t("Konkrétne byty", "The exact units")}</span>
            {detRows.length > 0 && <span className="rd-sect__count">{fmtInt(detRows.length)}{detHasMore ? "+" : ""}</span>}
            <InfoTip label={t("Filtre stĺpcov", "Column filters")} text={t("Filtre pod hlavičkou tabuľky zúžia TENTO zoznam bytov (na serveri, cez celý výber — nie len zobrazených 500). Súhrny a rozpad hore ostávajú za celé zvolené obdobie.", "The filters under the table header narrow THIS list of units (server-side, across the whole selection — not just the 500 shown). The totals and breakdown above stay for the full selected period.")} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {activeColCount > 0 && (
              <button className="rd-btn rd-btn--warn rd-btn--sm" onClick={clearColFilters} title={t("Zrušiť filtre stĺpcov", "Clear column filters")}>
                ✕ {t("Filtre stĺpcov", "Column filters")} ({activeColCount})
              </button>
            )}
            <button className="rd-btn rd-btn--primary rd-btn--sm" onClick={exportCsv} disabled={!detRows.length}>⬇ CSV</button>
          </div>
        </div>

        <div className="rd-scroll" style={{ maxHeight: "58vh" }}>
          <table className="rd-table rd-table--sticky" style={{ minWidth: isPipe ? 900 : 1040 }}>
            <thead>
              <tr>
                {visibleCols.map((c) => {
                  const numeric = ["num", "eur", "per_m2", "area"].includes(c[3]);
                  const sortable = SORTABLE.includes(c[0]);
                  const on = effSort.key === c[0];
                  return (
                    <th key={c[0]} onClick={sortable ? () => toggleSort(c[0]) : undefined}
                      className={[numeric ? "num" : "", sortable ? "rd-th--sortable" : "", on ? "rd-th--on" : ""].filter(Boolean).join(" ")}
                      title={sortable ? t("Klikni pre zoradenie", "Click to sort") : undefined}>
                      {c[3] === "per_m2" ? `${moneySymbol()}/m²` : t(c[1], c[2])}
                      {on && <span style={{ marginLeft: 3 }}>{effSort.dir === "asc" ? "▲" : "▼"}</span>}
                      {COL_INFO[c[0]] && <span style={{ marginLeft: 5, display: "inline-block", verticalAlign: "middle" }}><InfoTip text={t(COL_INFO[c[0]].sk, COL_INFO[c[0]].en)} label={t(c[1], c[2])} /></span>}
                    </th>
                  );
                })}
              </tr>
              {/* per-column filter row (server-side; narrows THIS list, not the totals above) */}
              <tr>
                {visibleCols.map((c) => {
                  const kind = COL_FILTER_KIND[c[0]];
                  const money = MONEY_COLS.has(c[0]);
                  const cur = colFilters[c[0]];
                  const w = COL_FILTER_W[c[0]];
                  // Live range for this column under every OTHER active filter. Shown as a hint
                  // line AND fed to the input's own min/max, so the control can't offer a value
                  // that would return nothing. Money bounds convert EUR → display currency.
                  const rng = kind === "num" || kind === "date" ? colRange(c[0]) : null;
                  const rngTxt = rng ? fmtRange(c[3], rng, lang) : null;
                  const bound = (v) => (v == null ? undefined : (money ? Math.round(moneyFromEur(Number(v))) : v));
                  return (
                    <th key={c[0]} className="rd-th--filter">
                      {kind === "cat" && (
                        <Picker small searchable width={w} sk={lang === "sk"}
                          value={typeof cur === "string" ? cur : ""} onChange={(v) => setColCat(c[0], v)}
                          ariaLabel={t(c[1], c[2])} placeholder={t("Všetky", "All")}
                          options={[{ value: "", label: t("Všetky", "All") }, ...colOptions(c[0])]} />
                      )}
                      {kind === "num" && (
                        <div style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                          <input type="number" inputMode="numeric" className="rd-field rd-field--sm rd-field--num" placeholder={t("od", "min")} value={cur?.min ?? ""}
                            min={bound(rng?.min)} max={bound(rng?.max)} style={{ width: w }}
                            aria-label={`${t(c[1], c[2])} ${t("od", "min")}`} onChange={(e) => setColBound(c[0], "min", e.target.value)} />
                          <input type="number" inputMode="numeric" className="rd-field rd-field--sm rd-field--num" placeholder={t("do", "max")} value={cur?.max ?? ""}
                            min={bound(rng?.min)} max={bound(rng?.max)} style={{ width: w }}
                            aria-label={`${t(c[1], c[2])} ${t("do", "max")}`} onChange={(e) => setColBound(c[0], "max", e.target.value)} />
                        </div>
                      )}
                      {kind === "date" && (
                        <div style={{ display: "flex", gap: 3 }}>
                          <DateField small value={cur?.from ?? ""} width={w} ariaLabel={`${t(c[1], c[2])} ${t("od", "from")}`}
                            onChange={(e) => setColBound(c[0], "from", e.target.value)} style={{ minWidth: 0 }} />
                          <DateField small value={cur?.to ?? ""} width={w} ariaLabel={`${t(c[1], c[2])} ${t("do", "to")}`}
                            onChange={(e) => setColBound(c[0], "to", e.target.value)} style={{ minWidth: 0 }} />
                        </div>
                      )}
                      {rngTxt && (
                        <div className="rd-filter-hint" title={t("Čo je ešte dostupné pri aktuálnom výbere", "What is still available under the current selection")}
                          style={{ textAlign: kind === "num" ? "right" : "left" }}>
                          {rngTxt}
                        </div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {det.loading && <tr><td className="rd-td--empty" colSpan={detailColSpan} style={{ fontStyle: "normal" }}>{t("načítavam…", "loading…")}</td></tr>}
              {det.error && <tr><td colSpan={detailColSpan} style={{ padding: 0 }}><LoadError lang={lang} /></td></tr>}
              {!det.loading && !det.error && detRows.length === 0 && <tr><td className="rd-td--empty" colSpan={detailColSpan}>{isPipe ? t("Žiadne jednotky v tomto stave pre tento výber.", "No units in this state for this selection.") : t("Žiadne predané byty pre tento výber a obdobie.", "No sold units for this selection and period.")}</td></tr>}
              {detRows.map((r, i) => (
                <tr key={(r.project_id || "") + (r.unit_id || "") + i}>
                  {visibleCols.map((c) => {
                    const numeric = ["num", "eur", "per_m2", "area"].includes(c[3]);
                    if (c[3] === "sig") {
                      const marked = r.detection_method === "marked";
                      return <td key={c[0]}>
                        <span className={marked ? "rd-badge rd-badge--ok" : "rd-badge rd-badge--warn"}
                          title={marked ? t("Developer označil ako predané", "Developer marked as sold") : t("Zmizol z ponuky (developer neoznačuje predané)", "Removed from listing (developer doesn't mark sold)")}>
                          {marked ? t("označené", "marked") : t("zmizol", "delisted")}
                        </span>
                      </td>;
                    }
                    const isKey = c[0] === "project_name";
                    return <td key={c[0]} className={[numeric ? "num" : "", isKey ? "rd-td--key" : ""].filter(Boolean).join(" ") || undefined}>
                      {/* project cell → the project mark; the EUR/m2 cell → what THIS
                          price assumes. Both sit after the value with no break
                          opportunity in front, so neither column can gain an orphan. */}
                      {c[0] === "days_on_market"
                        ? (r.days_on_market == null
                            ? <span title={t("Skutočný čas na trhu zatiaľ nevieme", "True days-on-market not known yet")} style={{ color: "var(--text-faint)" }}>—</span>
                            : r.left_censored
                              ? <span title={t("Merané od prvého zachytenia — byt bol v ponuke už keď sme začali sledovať, skutočný čas môže byť dlhší", "Measured from first sight — the unit was already listed when tracking began, so the true figure may be longer")}>≥ {Math.round(r.days_on_market)}</span>
                              : fmtCell(c[3], r.days_on_market, lang))
                        : fmtCell(c[3], r[c[0]], lang)}
                      {isKey ? <SpecificsMark items={spec.project(r.project_id || r.project_name)} lang={lang} /> : null}
                      {c[0] === "price_per_m2_eur" ? <UnitPriceMarks items={spec.unit(r, r.project_id || r.project_name)} lang={lang} /> : null}
                    </td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="rd-note" style={{ marginTop: "0.6rem" }}>
          {t("„Dní na trhu“ je dostupné len pre byty ktoré sme videli pribudnúť aj predať — sledovanie beží od mája 2026.",
             "“Days on market” is only known for units we saw both list and sell — tracking started May 2026.")}
        </div>
      </div>
    </div>
  );
}
