/* SalesView — Analytics → Predaje / Sales.
   "How many and WHICH units sold — and STAYED sold — in a period, for the projects I pick."
   Reads public.analytics_sales (summary / breakdown / detail) over analytics.sale_events:
   durable sale detection (delete-on-sale aware, relist-reversed), frozen sale price/€m²/
   days-on-market. Same design language as the Explorer/pivot (dark, green accent, mono labels).
   Built for the comparable-projects pricing workflow (e.g. Nitra). */
import { useState, useMemo } from "react";
import { useCurrency } from "../lib/useCurrency";
import { moneyFromEur, moneySymbol, moneyToEur } from "../lib/money";
import { useSales } from "../lib/useData";
import { useCountry, isAllCountries } from "../lib/useCountry";
import { useAccountPrefState } from "../lib/useAccountUiPref";
import LoadError from "../components/LoadError";
import Picker from "../components/Picker";
import InfoTip from "../components/InfoTip";
import DateField from "../components/DateField";
import CountrySwitcher from "../components/CountrySwitcher";
import { accent as green, orange, dim, border, bg, surfacePanel as panelHi, text } from "../lib/theme";

const panel = "var(--surface-2)";
const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";

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
  days_on_market:   { sk: "Počet dní od prvého zachytenia po predaj. Ak sme byt videli pribudnúť, je to skutočný čas na trhu; „≥“ znamená, že byt bol v ponuke už keď sme začali sledovať (máj 2026), takže rátame od prvého zachytenia a skutočný čas môže byť dlhší.", en: "Days from first sight to sold. If we saw the unit appear, it's the true time on market; “≥” means the unit was already listed when we began tracking (May 2026), so we count from first sight and the true figure may be longer." },
  detection_method: { sk: "Ako sme predaj zistili: „označené“ = developer označil byt ako predaný; „zmizol“ = byt zmizol z ponuky (developer predané neoznačuje, tak berieme zmiznutie ako predaj).", en: "How we detected the sale: “marked” = the developer flagged it as sold; “delisted” = it disappeared from the listing (the developer doesn't mark sold, so a disappearance is taken as a sale)." },
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

// "what's still available here" line under a numeric / date column filter. Money bounds are
// stored in EUR and shown in the display currency, exactly like the values in the table.
function fmtRange(kind, r) {
  if (!r || r.min == null || r.max == null) return null;
  const one = (v) => {
    if (kind === "date") return String(v);
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
function fmtCell(kind, v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (kind === "eur") return fmtMoney(v);
  if (kind === "per_m2") return Number.isFinite(n) ? Math.round(moneyFromEur(n)).toLocaleString("sk-SK").replace(/,/g, " ") + " " + moneySymbol() : "—";
  if (kind === "area") return Number.isFinite(n) ? n.toLocaleString("sk-SK", { maximumFractionDigits: 1 }) + " m²" : "—";
  if (kind === "date") return String(v);
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
  const [sort, setSort] = useState({ key: "sold_date", dir: "desc" });
  const [projSearch, setProjSearch] = useState("");
  const [projOpen, setProjOpen] = useState(false);
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
  const detailColSpan = detailCols.filter((c) => c[3] !== "hide").length; // full-row cells must span the ACTUAL visible column count (varies sold vs pipeline)
  const SORTABLE = isPipe ? ["price_s_dph_eur", "price_per_m2_eur", "izby", "obytna_plocha", "city", "project_name"]
                          : ["sold_date", "price_s_dph_eur", "price_per_m2_eur", "days_on_market", "izby", "obytna_plocha", "city", "project_name"];
  // ── detail-table per-column filters → server-side `detail_filters` ──
  // Only columns VISIBLE in the current mode are applied (sold vs pipeline differ), so a
  // dormant sold-only filter (e.g. signal) doesn't silently narrow the pipeline view —
  // and it's preserved for when the user switches back. Money thresholds are typed in the
  // display currency → converted to EUR (curSym is a dep so they re-convert on a switch).
  const curSym = moneySymbol();
  const visibleColKeys = useMemo(() => new Set(detailCols.filter((c) => c[3] !== "hide").map((c) => c[0])), [detailCols]);
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
    () => detailCols.filter((c) => c[3] !== "hide" && COL_FILTER_KIND[c[0]]).map((c) => c[0]),
    [detailCols],
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

  const projFiltered = projOptions.filter((o) => !projSearch || o.label.toLowerCase().includes(projSearch.toLowerCase()));

  const exportCsv = () => {
    const cols = detailCols.filter((c) => c[3] !== "hide");
    // Money columns: export in the SAME display currency the table shows (converted +
    // symbol in the header), so the CSV never silently disagrees with the on-screen values.
    const sym = moneySymbol();
    const head = cols.map((c) => {
      const base = c[3] === "per_m2" ? `${sym}/m²` : (lang === "sk" ? c[1] : c[2]);
      return c[3] === "eur" ? `${base} (${sym})` : base;
    }).join(";");
    const lines = detRows.map((r) => cols.map((c) => {
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

  const sel = { background: bg, border: `1px solid ${border}`, color: text, borderRadius: 5, padding: "0.4rem 0.55rem", fontSize: "0.78rem", fontFamily: "inherit", outline: "none" };
  const card = { background: "var(--surface)", border: `1px solid ${border}`, borderRadius: 8, padding: "0.85rem 1rem" };
  // compact control for the per-column detail filters
  const fInput = { background: bg, border: `1px solid ${border}`, color: text, borderRadius: 4, padding: "0.18rem 0.3rem", fontSize: "0.68rem", fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
  // colour-coded stat card: metric colour as a left-accent bar + faint wash (theme-aware; keeps "var(--surface)" so the light-mode shadow still applies)
  // Calm, uniform cards: one brand-accent bar on every card (no per-metric
  // rainbow), matching the Dashboard market-overview strip. The `color` args are
  // kept in the signatures so the call sites don't change, but ignored.
  const statCard = () => ({ ...card, position: "relative", overflow: "hidden", background: "var(--surface)", paddingLeft: "1rem" });
  const StatBar = () => <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--accent)", opacity: 0.7 }} />;
  // Element factory (NOT a component rendered as <StatInfo/>): returning the node
  // keeps InfoTip's own identity stable across SalesView re-renders, so a tapped-
  // open tooltip isn't remounted (and closed) when sales data / currency updates.
  const statInfo = (sk, en, label) => <div style={{ position: "absolute", top: 6, right: 6 }}><InfoTip text={t(sk, en)} label={label} /></div>;
  const kpiVal = { fontSize: "1.5rem", fontWeight: 700, color: text, fontFamily: mono, fontVariantNumeric: "tabular-nums" };
  const kpiLbl = { fontFamily: mono, fontSize: "0.62rem", color: dim, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: "0.3rem" };
  // `opts` are live facet options ({value,label,hint}) — see facetOptions().
  const Sel = ({ value, onChange, opts, ph }) => (
    <Picker value={value} onChange={onChange} width={150} searchable sk={lang === "sk"} placeholder={ph} ariaLabel={ph}
      options={[{ value: "", label: ph }, ...(opts || [])]} />
  );

  const dur = S.sold_durable ?? 0;
  const gross = S.sold_all ?? 0;
  const reversed = Math.max(0, gross - dur);

  return (
    <div style={{ color: text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* header */}
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, border: "1px solid var(--border)", padding: "1.25rem 1.6rem", marginBottom: "1.5rem", background: "radial-gradient(120% 140% at 2% -20%, rgba(18,185,129,0.13) 0%, transparent 46%), linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, var(--surface)) 0%, var(--bg) 75%)" }}>
        <p style={{ color: dim, fontSize: "0.8rem", margin: 0 }}>
          {t("Koľko a KTORÉ byty sa predali — a zostali predané — vo zvolenom období, pre projekty ktoré si vyberieš.",
             "How many and WHICH units sold — and stayed sold — in the chosen period, for the projects you pick.")}
        </p>
      </div>

      {/* status tabs: Sold / Reserved / Pre-reserved */}
      <div style={{ display: "inline-flex", border: `1px solid ${border}`, borderRadius: 8, overflow: "hidden", marginBottom: "0.6rem" }}>
        {STATUSES.map(([s, sk, en]) => (
          <button key={s} onClick={() => setStatus(s)}
            style={{ border: "none", padding: "0.5rem 1.1rem", cursor: "pointer", fontFamily: mono, fontSize: "0.78rem", background: status === s ? green : panel, color: status === s ? "#04130d" : dim, fontWeight: status === s ? 700 : 500 }}>
            {t(sk, en)}
          </button>
        ))}
      </div>

      {/* controls: period (sold only) + market + durable (sold only) */}
      <div style={{ ...card, marginBottom: "0.6rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ ...kpiLbl, margin: 0, marginRight: "0.1rem" }}>{isPipe ? t("Stav teraz", "Current state") : t("Obdobie", "Period")}</span>
        {isPipe ? (
          <span style={{ fontSize: "0.76rem", color: dim, fontStyle: "italic" }}>{t("Aktuálny pipeline — obdobie sa neuplatňuje", "Current pipeline — period doesn't apply")}</span>
        ) : (
          <>
            <div style={{ display: "inline-flex", border: `1px solid ${border}`, borderRadius: 7, overflow: "hidden" }}>
              {PERIODS.map(([d, sk, en]) => (
                <button key={d} onClick={() => { setDays(d); setCustomFrom(""); setCustomTo(""); }}
                  style={{ border: "none", padding: "0.4rem 0.7rem", cursor: "pointer", fontFamily: mono, fontSize: "0.7rem", background: !customFrom && days === d ? green : "transparent", color: !customFrom && days === d ? "#04130d" : dim, fontWeight: !customFrom && days === d ? 700 : 500 }}>
                  {t(sk, en)}
                </button>
              ))}
            </div>
            <DateField value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} width={140} title={t("od", "from")} />
            <DateField value={customTo} onChange={(e) => setCustomTo(e.target.value)} width={140} title={t("do", "to")} />
          </>
        )}
        {!isPipe && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", fontSize: "0.76rem", color: dim, cursor: "pointer", marginLeft: "auto" }} title={t("Zarátaj len predaje ktoré zostali predané (vylúč tie čo sa vrátili na trh)", "Count only sales that stayed sold (exclude fall-throughs)")}>
            <input type="checkbox" checked={durableOnly} onChange={(e) => setDurableOnly(e.target.checked)} />
            {t("Len trvalé predaje", "Stayed-sold only")}
          </label>
        )}
      </div>

      {/* filters: projects multi-select + city/dev/typ */}
      <div style={{ ...card, marginBottom: "0.6rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", position: "relative" }}>
        <span style={{ ...kpiLbl, margin: 0, marginRight: "0.1rem" }}>{t("Filtre", "Filters")}{activeFilters ? ` · ${activeFilters}` : ""}</span>
        {/* Country / market — the shared global switcher (same state as the left dock).
            Scopes the sold/reserved facts AND every option list to SK / CZ / All, so the
            sidebar switcher now filters Sales like every other page. Renders nothing while
            only one market is active. */}
        <CountrySwitcher lang={lang} />
        {/* project multi-select */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setProjOpen((o) => !o)} style={{ ...sel, cursor: "pointer", minWidth: 150, textAlign: "left", color: projects.length ? text : dim }}>
            {projects.length ? t(`${projects.length} projektov`, `${projects.length} projects`) : t("Projekty: všetky ▾", "Projects: all ▾")}
          </button>
          {projOpen && (
            <div style={{ position: "absolute", zIndex: 20, top: "110%", left: 0, width: 280, maxHeight: 320, overflowY: "auto", background: panel, border: `1px solid ${border}`, borderRadius: 8, padding: "0.5rem", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
              <input autoFocus value={projSearch} onChange={(e) => setProjSearch(e.target.value)} placeholder={t("hľadať…", "search…")} style={{ ...sel, width: "100%", boxSizing: "border-box", marginBottom: "0.4rem" }} />
              {projects.length > 0 && <div onClick={() => setProjects([])} style={{ cursor: "pointer", color: dim, fontSize: "0.72rem", fontFamily: mono, padding: "0.2rem 0.3rem" }}>✕ {t("zrušiť výber", "clear")}</div>}
              {fac.loading && !projOptions.length && <div style={{ color: dim, fontSize: "0.75rem", padding: "0.3rem" }}>{t("načítavam…", "loading…")}</div>}
              {!fac.loading && !projFiltered.length && <div style={{ color: dim, fontSize: "0.75rem", padding: "0.3rem", fontStyle: "italic" }}>{t("žiadny projekt pre tento výber", "no project for this selection")}</div>}
              {projFiltered.map((o) => (
                <label key={o.value} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.28rem 0.3rem", fontSize: "0.78rem", cursor: "pointer", color: projects.includes(o.value) ? text : "var(--text-2)", borderRadius: 4 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = panelHi)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <input type="checkbox" checked={projects.includes(o.value)} onChange={() => toggleProject(o.value)} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                  <span style={{ flexShrink: 0, color: dim, fontSize: "0.7rem", fontFamily: mono, fontVariantNumeric: "tabular-nums" }}>{o.hint}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <Sel value={fCity} onChange={setFCity} opts={cityOptions} ph={t("Mesto: všetky", "City: all")} />
        <Sel value={fDev} onChange={setFDev} opts={devOptions} ph={t("Developer: všetci", "Developer: all")} />
        <Sel value={fTyp} onChange={setFTyp} opts={typOptions} ph={t("Typ: všetky", "Type: all")} />
        {projects.map((p) => <span key={p} onClick={() => toggleProject(p)} style={{ cursor: "pointer", background: green, color: "#04130d", borderRadius: 4, padding: "0.15rem 0.45rem", fontSize: "0.72rem", fontWeight: 600 }}>{p} ✕</span>)}
        {activeFilters > 0 && <button onClick={clearFilters} style={{ ...sel, cursor: "pointer", color: dim, fontFamily: mono, fontSize: "0.7rem" }}>✕ {t("vyčistiť", "clear")}</button>}
      </div>

      {/* KPI row */}
      {sum.error ? <LoadError lang={lang} /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem", marginBottom: "0.6rem" }}>
          <div style={statCard("#10b981")}><StatBar color="#10b981" />{statInfo("Počet bytov v tomto stave za zvolené obdobie (pri predaných: tie, ktoré zostali predané). „+N vrátených“ = predaje, ktoré sa vrátili späť na trh.", "Units in this state for the selected period (for sold: those that stayed sold). “+N fell through” = sales that returned to the market.", t(HEADLINE[status][0], HEADLINE[status][1]))}<div style={{ ...kpiLbl, paddingRight: "1.1rem" }}>{t(HEADLINE[status][0], HEADLINE[status][1])}</div><div style={kpiVal}>{sum.loading ? "…" : dur.toLocaleString("sk-SK")}</div>{reversed > 0 && !durableOnly && !isPipe && <div style={{ fontSize: "0.68rem", color: orange, fontFamily: mono, marginTop: "0.2rem" }}>{t(`+${reversed} vrátených`, `+${reversed} fell through`)}</div>}</div>
          <div style={statCard("#3b74e8")}><StatBar color="#3b74e8" />{statInfo("Súčet cien (s DPH) bytov v tomto výbere.", "Sum of prices (incl. VAT) of the units in this selection.", isPipe ? t("Hodnota v ponuke", "Listed value") : t("Objem predaja", "Sold value"))}<div style={{ ...kpiLbl, paddingRight: "1.1rem" }}>{isPipe ? t("Hodnota v ponuke", "Listed value") : t("Objem predaja", "Sold value")}</div><div style={kpiVal}>{sum.loading ? "…" : fmtMoney(S.sold_value_eur)}</div></div>
          <div style={statCard("#3b74e8")}><StatBar color="#3b74e8" />{statInfo("Stredná cena bytu — polovica je lacnejšia, polovica drahšia. Odolnejšia voči extrémom než priemer.", "The middle unit price — half are cheaper, half dearer. More robust to outliers than the average.", t("Medián ceny", "Median price"))}<div style={{ ...kpiLbl, paddingRight: "1.1rem" }}>{t("Medián ceny", "Median price")}</div><div style={kpiVal}>{sum.loading ? "…" : fmtMoney(S.median_price_eur)}</div></div>
          <div style={statCard("#8b5cf6")}><StatBar color="#8b5cf6" />{statInfo("Stredná cena za m² (s DPH) v tomto výbere.", "The middle price per m² (incl. VAT) in this selection.", t("Medián €/m²", "Median €/m²"))}<div style={{ ...kpiLbl, paddingRight: "1.1rem" }}>{t("Medián ", "Median ")}{moneySymbol()}/m²</div><div style={kpiVal}>{sum.loading ? "…" : fmtCell("per_m2", S.median_eur_m2)}</div></div>
          {!isPipe && (
          <div style={statCard("#e0940f")}>
            <StatBar color="#e0940f" />
            {statInfo("Stredný počet dní, počas ktorých sa byt predával — od prvého zachytenia po predaj. Ak sme byt videli pribudnúť, je to skutočný čas na trhu; ak už bol v ponuke keď sme začali sledovať (máj 2026), rátame od prvého zachytenia (označené „≥“) a skutočná hodnota môže byť vyššia.", "Median number of days units were on the market — from first sight to sold. If we saw a unit appear it's the true time on market; if it was already listed when we began tracking (May 2026) we count from first sight (marked “≥”) and the real figure may be higher.", t("Medián dní na trhu", "Median days on market"))}
            <div style={{ ...kpiLbl, paddingRight: "1.1rem" }}>{t("Medián dní na trhu", "Median days on market")}</div>
            <div style={kpiVal}>{sum.loading ? "…" : (S.median_days_on_market != null ? Math.round(S.median_days_on_market) : "—")}</div>
            <div style={{ fontSize: "0.64rem", color: dim, fontFamily: mono, marginTop: "0.2rem" }}>
              {S.observed_dom_count
                ? <>{t(`z ${S.observed_dom_count} predaných`, `of ${S.observed_dom_count} sold`)}{S.censored_count ? t(` · z toho ${S.censored_count}× „≥“`, ` · ${S.censored_count}× are ≥`) : ""}</>
                : t("zatiaľ málo dát", "building history")}
            </div>
          </div>
          )}
        </div>
      )}

      {/* breakdown */}
      <div style={{ ...card, marginBottom: "0.6rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
          <span style={kpiLbl}><span style={{ display: "inline-block", width: 3, height: 12, borderRadius: 2, background: "var(--accent)", marginRight: "0.5rem", verticalAlign: "middle" }} />{t("Rozklad podľa", "Break down by")}</span>
          <div style={{ display: "inline-flex", gap: "0.25rem", flexWrap: "wrap" }}>
            {GROUP_DIMS.map(([k, sk, en]) => (
              <button key={k} onClick={() => setGroupBy(k)} style={{ ...sel, cursor: "pointer", padding: "0.28rem 0.55rem", fontFamily: mono, fontSize: "0.7rem", background: groupBy === k ? green : bg, color: groupBy === k ? "#04130d" : dim, borderColor: groupBy === k ? green : border, fontWeight: groupBy === k ? 700 : 500 }}>{t(sk, en)}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem", minWidth: 480 }}>
            <thead><tr>{[
              { h: t("Skupina", "Group") },
              { h: isPipe ? t("V ponuke", "Listed") : t("Predané", "Sold"), info: isPipe ? null : t("Počet bytov, ktoré sa v období predali a zostali predané.", "Units that sold — and stayed sold — in the period.") },
              { h: t("Objem", "Value"), info: t("Súčet cien (s DPH) predaných bytov v skupine.", "Sum of prices (incl. VAT) of the sold units in the group.") },
              { h: `${t("Medián ", "Median ")}${moneySymbol()}/m²`, info: t("Stredná cena za m² (s DPH) predaných bytov v skupine.", "Median price per m² (incl. VAT) of the sold units in the group.") },
              { h: t("Medián dní", "Median days"), info: t("Stredný počet dní na trhu (od prvého zachytenia po predaj). Zahŕňa aj byty rátané od prvého zachytenia („≥“), takže hodnota môže byť konzervatívna.", "Median days on market (first sight to sold). Includes units counted from first sight (“≥”), so the figure can be conservative.") },
            ].map((o, i) => (
              <th key={o.h} style={{ textAlign: i === 0 ? "left" : "right", padding: "0.4rem 0.6rem", borderBottom: `1px solid ${border}`, color: dim, fontFamily: mono, fontSize: "0.64rem", textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
                {o.h}{o.info && <span style={{ marginLeft: 5, display: "inline-block", verticalAlign: "middle" }}><InfoTip text={o.info} label={o.h} /></span>}
              </th>
            ))}</tr></thead>
            <tbody>
              {brk.loading && <tr><td colSpan={5} style={{ padding: "1rem", textAlign: "center", color: dim }}>{t("načítavam…", "loading…")}</td></tr>}
              {!brk.loading && brkRows.length === 0 && <tr><td colSpan={5} style={{ padding: "1.2rem", textAlign: "center", color: dim, fontStyle: "italic" }}>{isPipe ? t("Žiadne jednotky pre tento výber.", "No units for this selection.") : t("Žiadne predaje pre tento výber.", "No sales for this selection.")}</td></tr>}
              {brkRows.map((r, i) => (
                <tr key={String(r.group) + i} style={{ background: i % 2 ? "var(--surface-2)" : "transparent" }}>
                  <td style={{ padding: "0.4rem 0.6rem", color: text }}>{r.group ?? "—"}</td>
                  <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", fontFamily: mono, color: text }}>{Number(r.sold).toLocaleString("sk-SK")}</td>
                  <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", fontFamily: mono, color: "var(--text-2)" }}>{fmtMoney(r.sold_value_eur)}</td>
                  <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", fontFamily: mono, color: "var(--text-2)" }}>{fmtCell("per_m2", r.median_eur_m2)}</td>
                  <td style={{ padding: "0.4rem 0.6rem", textAlign: "right", fontFamily: mono, color: "var(--text-2)" }}>{r.median_days_on_market != null ? Math.round(r.median_days_on_market) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* detail: the exact units */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <span style={kpiLbl}><span style={{ display: "inline-block", width: 3, height: 12, borderRadius: 2, background: "var(--accent)", marginRight: "0.5rem", verticalAlign: "middle" }} />{t("Konkrétne byty", "The exact units")}{detRows.length ? ` · ${detRows.length}${detHasMore ? "+" : ""}` : ""}
            <span style={{ marginLeft: 5, display: "inline-block", verticalAlign: "middle" }}><InfoTip label={t("Filtre stĺpcov", "Column filters")} text={t("Filtre pod hlavičkou tabuľky zúžia TENTO zoznam bytov (na serveri, cez celý výber — nie len zobrazených 500). Súhrny a rozpad hore ostávajú za celé zvolené obdobie.", "The filters under the table header narrow THIS list of units (server-side, across the whole selection — not just the 500 shown). The totals and breakdown above stay for the full selected period.")} /></span>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            {activeColCount > 0 && (
              <button onClick={clearColFilters} title={t("Zrušiť filtre stĺpcov", "Clear column filters")}
                style={{ ...sel, cursor: "pointer", color: orange, borderColor: orange, fontFamily: mono, fontSize: "0.68rem", fontWeight: 700 }}>
                ✕ {t("Filtre", "Filters")} ({activeColCount})
              </button>
            )}
            <button onClick={exportCsv} disabled={!detRows.length} style={{ ...sel, cursor: detRows.length ? "pointer" : "default", color: detRows.length ? "#04130d" : dim, background: detRows.length ? green : bg, borderColor: detRows.length ? green : border, fontFamily: mono, fontSize: "0.72rem", fontWeight: 700 }}>⬇ CSV</button>
          </div>
        </div>
        <div style={{ overflowX: "auto", maxHeight: "60vh", overflowY: "auto" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: "0.78rem", minWidth: 820 }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--surface-2)", zIndex: 1 }}><tr>
              {detailCols.filter((c) => c[3] !== "hide").map((c) => {
                const numeric = ["num", "eur", "per_m2", "area"].includes(c[3]);
                const sortable = SORTABLE.includes(c[0]);
                return (
                  <th key={c[0]} onClick={sortable ? () => toggleSort(c[0]) : undefined}
                    style={{ padding: "0.45rem 0.6rem", textAlign: numeric ? "right" : "left", borderBottom: `1px solid ${border}`, color: sort.key === c[0] ? green : "var(--text-2)", cursor: sortable ? "pointer" : "default", fontFamily: mono, fontSize: "0.64rem", textTransform: "uppercase", letterSpacing: "0.03em", whiteSpace: "nowrap", userSelect: "none" }}>
                    {c[3] === "per_m2" ? `${moneySymbol()}/m²` : t(c[1], c[2])}{effSort.key === c[0] ? (effSort.dir === "asc" ? " ▲" : " ▼") : ""}
                    {COL_INFO[c[0]] && <span style={{ marginLeft: 5, display: "inline-block", verticalAlign: "middle" }}><InfoTip text={t(COL_INFO[c[0]].sk, COL_INFO[c[0]].en)} label={t(c[1], c[2])} /></span>}
                  </th>
                );
              })}
            </tr>
            {/* per-column filter row (server-side; narrows THIS list, not the totals above) */}
            <tr>
              {detailCols.filter((c) => c[3] !== "hide").map((c) => {
                const kind = COL_FILTER_KIND[c[0]];
                const money = MONEY_COLS.has(c[0]);
                const cur = colFilters[c[0]];
                const opts = kind === "cat" ? colOptions(c[0]) : null;
                // Live range for this column under every OTHER active filter. Shown as a hint
                // line AND fed to the input's own min/max, so the control can't offer a value
                // that would return nothing. Money bounds convert EUR → display currency.
                const rng = kind === "num" || kind === "date" ? colRange(c[0]) : null;
                const rngTxt = rng ? fmtRange(c[3], rng) : null;
                const bound = (v) => (v == null ? undefined : (money ? Math.round(moneyFromEur(Number(v))) : v));
                return (
                  <th key={c[0]} style={{ padding: "0.2rem 0.4rem 0.35rem", borderBottom: `1px solid ${border}`, background: "var(--surface-2)", verticalAlign: "top", fontWeight: 400 }}>
                    {kind === "cat" && (
                      <select value={typeof cur === "string" ? cur : ""} onChange={(e) => setColCat(c[0], e.target.value)}
                        aria-label={t(c[1], c[2])} style={{ ...fInput, width: "100%", cursor: "pointer", color: cur ? green : "var(--text-2)" }}>
                        <option value="">{t("Všetky", "All")}{opts.length ? ` (${opts.length})` : ""}</option>
                        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}{o.hint ? ` · ${o.hint}` : ""}</option>)}
                      </select>
                    )}
                    {kind === "num" && (
                      <div style={{ display: "flex", gap: 3, justifyContent: "flex-end" }}>
                        <input type="number" inputMode="numeric" placeholder={money ? `${t("od", "min")} ${curSym}` : t("od", "min")} value={cur?.min ?? ""}
                          min={bound(rng?.min)} max={bound(rng?.max)}
                          aria-label={`${t(c[1], c[2])} ${t("od", "min")}`} onChange={(e) => setColBound(c[0], "min", e.target.value)} style={{ ...fInput, width: 60, textAlign: "right" }} />
                        <input type="number" inputMode="numeric" placeholder={t("do", "max")} value={cur?.max ?? ""}
                          min={bound(rng?.min)} max={bound(rng?.max)}
                          aria-label={`${t(c[1], c[2])} ${t("do", "max")}`} onChange={(e) => setColBound(c[0], "max", e.target.value)} style={{ ...fInput, width: 60, textAlign: "right" }} />
                      </div>
                    )}
                    {kind === "date" && (
                      <div style={{ display: "flex", gap: 3 }}>
                        <input type="date" value={cur?.from ?? ""} min={rng?.min} max={rng?.max} aria-label={`${t(c[1], c[2])} ${t("od", "from")}`} onChange={(e) => setColBound(c[0], "from", e.target.value)} style={{ ...fInput, width: 116 }} />
                        <input type="date" value={cur?.to ?? ""} min={rng?.min} max={rng?.max} aria-label={`${t(c[1], c[2])} ${t("do", "to")}`} onChange={(e) => setColBound(c[0], "to", e.target.value)} style={{ ...fInput, width: 116 }} />
                      </div>
                    )}
                    {rngTxt && (
                      <div title={t("Čo je ešte dostupné pri aktuálnom výbere", "What is still available under the current selection")}
                        style={{ marginTop: 2, textAlign: kind === "num" ? "right" : "left", color: dim, fontFamily: mono, fontSize: "0.6rem", whiteSpace: "nowrap", fontWeight: 400 }}>
                        {rngTxt}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr></thead>
            <tbody>
              {det.loading && <tr><td colSpan={detailColSpan} style={{ padding: "1.2rem", textAlign: "center", color: dim }}>{t("načítavam…", "loading…")}</td></tr>}
              {det.error && <tr><td colSpan={detailColSpan} style={{ padding: 0 }}><LoadError lang={lang} /></td></tr>}
              {!det.loading && !det.error && detRows.length === 0 && <tr><td colSpan={detailColSpan} style={{ padding: "1.5rem", textAlign: "center", color: dim, fontStyle: "italic" }}>{isPipe ? t("Žiadne jednotky v tomto stave pre tento výber.", "No units in this state for this selection.") : t("Žiadne predané byty pre tento výber a obdobie.", "No sold units for this selection and period.")}</td></tr>}
              {detRows.map((r, i) => (
                <tr key={(r.project_id || "") + (r.unit_id || "") + i} style={{ background: i % 2 ? "var(--surface-2)" : "transparent" }}>
                  {detailCols.filter((c) => c[3] !== "hide").map((c) => {
                    const numeric = ["num", "eur", "per_m2", "area"].includes(c[3]);
                    if (c[3] === "sig") {
                      const marked = r.detection_method === "marked";
                      return <td key={c[0]} style={{ padding: "0.35rem 0.6rem", borderTop: `1px solid var(--surface)` }}>
                        <span title={marked ? t("Developer označil ako predané", "Developer marked as sold") : t("Zmizol z ponuky (developer neoznačuje predané)", "Removed from listing (developer doesn't mark sold)")}
                          style={{ fontFamily: mono, fontSize: "0.62rem", color: marked ? green : orange }}>{marked ? t("označené", "marked") : t("zmizol", "delisted")}</span>
                      </td>;
                    }
                    return <td key={c[0]} style={{ padding: "0.35rem 0.6rem", textAlign: numeric ? "right" : "left", borderTop: `1px solid var(--surface)`, color: "var(--text-2)", fontFamily: numeric ? mono : "inherit", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {c[0] === "days_on_market"
                        ? (r.days_on_market == null
                            ? <span title={t("Skutočný čas na trhu zatiaľ nevieme", "True days-on-market not known yet")} style={{ color: dim }}>—</span>
                            : r.left_censored
                              ? <span title={t("Merané od prvého zachytenia — byt bol v ponuke už keď sme začali sledovať, skutočný čas môže byť dlhší", "Measured from first sight — the unit was already listed when tracking began, so the true figure may be longer")} style={{ color: "var(--text-2)" }}>≥ {Math.round(r.days_on_market)}</span>
                              : fmtCell(c[3], r.days_on_market))
                        : fmtCell(c[3], r[c[0]])}
                    </td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: "0.5rem", fontSize: "0.68rem", color: dim, fontFamily: mono }}>
          {t("„Dní na trhu" + '"' + " je dostupné len pre byty ktoré sme videli pribudnúť aj predať — sledovanie beží od mája 2026.",
             "\"Days on market\" is only known for units we saw both list and sell — tracking started May 2026.")}
        </div>
      </div>
    </div>
  );
}
