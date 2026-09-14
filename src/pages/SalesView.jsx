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
import { useState, useMemo, useRef } from "react";
import { useCurrency } from "../lib/useCurrency";
import { moneyFromEur, moneySymbol, moneyToEur } from "../lib/money";
import { useSales } from "../lib/useData";
import { useCountry, isAllCountries } from "../lib/useCountry";
import { useAccountPrefState } from "../lib/useAccountUiPref";
import { localeTag } from "../lib/locale";
import LoadError from "../components/LoadError";
import Picker from "../components/Picker";
import FieldPanel from "../components/FieldPanel";
import { isFilterActive, newFilter, sanitizeFilter, summariseFilter } from "../lib/filterModel";
import InfoTip from "../components/InfoTip";
import Kpi from "../components/Kpi";
import DateField from "../components/DateField";
import CountrySwitcher from "../components/CountrySwitcher";
import { text } from "../lib/theme";
import { useSpecifics, SpecificsMark, UnitPriceMarks } from "../lib/projectSpecifics";

const DETAIL_LIMIT = 500; // page size for the detail table; the RPC returns +1 as a has-more sentinel
const PERIODS = [[30, "30 dní", "30 days"], [45, "45 dní", "45 days"], [60, "60 dní", "60 days"], [90, "90 dní", "90 days"]];
/* What the breakdown can group by. The engine allows every dimension; this list offered
   seven of them, so "which floors sell" or "how many sales did we see marked versus simply
   delisted" could not be asked at all — the same restriction the fixed column list put on
   the unit table. `sold` marks the ones that only exist once a unit has sold. */
const GROUP_DIMS = [
  ["city", "Mesto", "City"], ["district", "Mestská časť", "District"], ["sub_district", "Podčasť", "Sub-district"],
  ["developer", "Developer", "Developer"], ["project_name", "Projekt", "Project"],
  ["typ", "Typ", "Type"], ["izby", "Izby", "Rooms"], ["poschodie", "Poschodie", "Floor"],
  ["orientacia", "Orientácia", "Orientation"], ["kolaudacia_label", "Kolaudácia", "Completion"],
  ["detection_method", "Zdroj predaja", "Sale signal", true],
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
// The scope filters at the top of the page. Their option lists are recomputed live from the
// current selection (analytics_sales mode:'facets'), each one excluding its own filter.
const BASE_FACETS = ["city", "developer", "typ", "project_name"];

/* THE FIELD CATALOGUE — one list behind both tabs of the panel, exactly as on the Unit
   database. Before 2026-09-14 this page had twenty-five filter controls in two rows that
   meant different things, and a detail table whose ten columns were fixed in code while
   the rows carried twenty-five fields. Boss: masses of filters, duplicates, restrictive.

   `filter` says how the engine can narrow by it — analytics_sales takes in-lists on the
   dimensions and {min,max} on the numeric columns, and nothing else, so the panel offers
   exactly those and never a mode the query would reject.
   `col` says it can be a column in the unit list.
   `sold` marks the fields that only exist once a unit has actually sold. */
const SALES_FIELDS = [
  { key: "project_name",     sk: "Projekt",        en: "Project",       cat: "proj", filter: "in",      col: "text" },
  { key: "developer",        sk: "Developer",      en: "Developer",     cat: "proj", filter: "in",      col: "text" },
  { key: "city",             sk: "Mesto",          en: "City",          cat: "loc",  filter: "in",      col: "text" },
  { key: "district",         sk: "Mestská časť",   en: "District",      cat: "loc",  filter: "in",      col: "text" },
  { key: "typ",              sk: "Typ",            en: "Type",          cat: "unit", filter: "in",      col: "text" },
  { key: "izby",             sk: "Izby",           en: "Rooms",         cat: "unit", filter: "in",      col: "num"  },
  { key: "poschodie",        sk: "Poschodie",      en: "Floor",         cat: "unit", filter: "in",      col: "num"  },
  { key: "orientacia",       sk: "Orientácia",     en: "Orientation",   cat: "unit", filter: "in",      col: "text" },
  { key: "unit_id",          sk: "ID bytu",        en: "Unit ID",       cat: "unit",                    col: "text" },
  { key: "kolaudacia_label", sk: "Kolaudácia",     en: "Completion",    cat: "time", filter: "in",      col: "text" },
  { key: "sold_date",        sk: "Predané",        en: "Sold",          cat: "time",                    col: "date", sold: true },
  { key: "obytna_plocha",    sk: "Obytná plocha",  en: "Living area",   cat: "area", filter: "between", col: "area" },
  { key: "celkova_plocha",   sk: "Celková plocha", en: "Total area",    cat: "area", filter: "between", col: "area" },
  { key: "price_s_dph_eur",  sk: "Cena",           en: "Price",         cat: "price", filter: "between", col: "eur",    money: true },
  { key: "price_per_m2_eur", sk: "€/m²",           en: "€/m²",          cat: "price", filter: "between", col: "per_m2", money: true },
  { key: "fitout_level",     sk: "Štandard",       en: "Fit-out",       cat: "price",                   col: "text" },
  { key: "days_on_market",   sk: "Dní na trhu",    en: "Days on market", cat: "time", filter: "between", col: "num", sold: true },
  { key: "detection_method", sk: "Zdroj predaja",  en: "Sale signal",   cat: "time", filter: "in",      col: "sig", sold: true },
];
const SALES_CAT_ORDER = ["proj", "loc", "unit", "price", "area", "time"];
const SALES_CAT_LABEL = {
  sk: { proj: "Projekt", loc: "Lokalita", unit: "Byt", price: "Cena", area: "Plochy", time: "Čas a predaj", other: "Ostatné" },
  en: { proj: "Project", loc: "Location", unit: "Unit", price: "Price", area: "Areas", time: "Time & sale", other: "Other" },
};
/* The columns the list opens with. Everything else is one click away in the panel — the
   old table hard-coded ten of the twenty-five fields each row already carried. */
const SALES_DEFAULT_COLS = ["sold_date", "project_name", "city", "typ", "izby", "obytna_plocha",
                            "price_s_dph_eur", "price_per_m2_eur", "days_on_market", "detection_method"];
const SALES_DEFAULT_COLS_PIPE = ["project_name", "city", "typ", "izby", "obytna_plocha",
                                 "price_s_dph_eur", "price_per_m2_eur", "kolaudacia_label"];

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
/** n days before a given YYYY-MM-DD (local calendar), so a window keeps its LENGTH when
 *  its end is moved rather than silently re-anchoring to today. */
function isoDaysBefore(iso, n) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  dt.setDate(dt.getDate() - n);
  return isoLocal(dt);
}

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

/* The shape this page saved before 2026-09-14: nine named fields plus an `extra` array.
   Read so nobody opens the rebuilt page to an unexplained view of the whole market. */
function legacySalesFilters(s) {
  if (!s || typeof s !== "object") return [];
  let id = 0;
  const out = [];
  const add = (key, extra) => out.push({ id: ++id, key, mode: "in", values: [], min: "", max: "", ...extra });
  if (Array.isArray(s.projects) && s.projects.length) add("project_name", { values: s.projects.map(String) });
  for (const [prop, key] of [["fCity", "city"], ["fDev", "developer"], ["fTyp", "typ"]]) {
    if (typeof s[prop] === "string" && s[prop]) add(key, { values: [s[prop]] });
  }
  for (const x of Array.isArray(s.extra) ? s.extra : []) {
    if (!x || !x.key) continue;
    if (Array.isArray(x.values) && x.values.length) add(x.key, { values: x.values.map(String) });
    else if ((x.min ?? "") !== "" || (x.max ?? "") !== "") {
      add(x.key, { mode: "between", min: x.min == null ? "" : String(x.min), max: x.max == null ? "" : String(x.max) });
    }
  }
  return out;
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
  /* ONE filter list, the same shape and the same panel as the Unit database — Boss asked
     for the same logic on both pages. Everything in it narrows the KPIs, the breakdown and
     the unit list together; there is no second scope any more. */
  const [filters, setFilters] = useState([]);
  const fId = useRef(0);
  const [cols, setCols] = useState(SALES_DEFAULT_COLS);
  const [panelTab, setPanelTab] = useState("filters");
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState("city");
  const spec = useSpecifics(lang);
  const [sort, setSort] = useState({ key: "sold_date", dir: "desc" });

  // Remember the Sales filters per-account, across devices (localStorage + ui_prefs).
  useAccountPrefState(
    "salesFilters",
    { status, days, customFrom, customTo, durableOnly, groupBy, sort, filters, cols, panelTab },
    (s) => {
      if (s.status !== undefined) setStatus(s.status);
      if (s.days !== undefined) setDays(s.days);
      if (s.customFrom !== undefined) setCustomFrom(s.customFrom);
      if (s.customTo !== undefined) setCustomTo(s.customTo);
      if (typeof s.durableOnly === "boolean") setDurableOnly(s.durableOnly);
      if (s.groupBy !== undefined) setGroupBy(s.groupBy);
      if (s.sort && typeof s.sort === "object") setSort(s.sort);
      if (s.panelTab === "filters" || s.panelTab === "cols") setPanelTab(s.panelTab);
      if (Array.isArray(s.cols)) setCols(s.cols.filter((k) => SALES_FIELDS.some((f) => f.key === k && f.col)));
      /* Saved sets are user-writable, and this page had an older shape (nine named fields
         plus an `extra` array). Both are read; anything unknown is dropped rather than sent
         to the engine, which raises on an unknown filter and would blank the page. */
      const incoming = Array.isArray(s.filters) ? s.filters : legacySalesFilters(s);
      const clean = incoming
        .map((f, i) => sanitizeFilter(f, i + 1))
        .filter((f) => f && SALES_FIELDS.some((m) => m.key === f.key && m.filter));
      setFilters(clean);
      fId.current = clean.reduce((m, f) => Math.max(m, Number(f.id) || 0), 0);
    },
  );

  /* The window. A custom bound on ONE side used to leave the other anchored to TODAY, so
     typing only a "do" of 30 June with the 45-day preset selected produced 31 July – 30
     June: a range running backwards, which the engine answers honestly with zero and the
     page reported as "no sales for this selection". The chosen preset is a LENGTH, so an
     open "from" is measured back from whatever "to" is. */
  const date_to = customTo || isoToday();
  const date_from = customFrom || isoDaysBefore(date_to, days);
  // An explicitly inverted pair (both typed, from after to) is still possible and is the
  // user's own doing — but it is said out loud rather than answered with an empty table.
  const rangeInverted = date_from > date_to;

  const curSymForFilters = moneySymbol();   // dep: re-convert typed money bounds on a currency switch
  /* Sale-only fields (the signal, days on market) do not exist on the reserved /
     pre-reserved relations, and analytics_sales RAISES on an unknown filter — which blanks
     the page. They are dropped from the QUERY here rather than only hidden from the picker:
     the first cut hid them from the add list but left an already-added one in state, so
     adding "Zdroj predaja" and switching to Rezervované broke the page outright. Keeping
     them in state means they come back when you switch to Predané. */
  const liveFilters = useMemo(
    () => filters.filter((f) => {
      const m = SALES_FIELDS.find((x) => x.key === f.key);
      return m && m.filter && !(isPipe && m.sold);
    }),
    [filters, isPipe],
  );

  const baseFilters = useMemo(() => {
    const f = {};
    // Global country → market_key ('SK'/'CZ' → 'sk'/'cz'); 'all' drops it.
    if (!isAllCountries(country)) f.market_key = [country.toLowerCase()];
    for (const flt of liveFilters) {
      const meta = SALES_FIELDS.find((m) => m.key === flt.key);
      if (!isFilterActive(flt)) continue;
      if (meta.filter === "in") {
        f[flt.key] = flt.values;
      } else {
        const conv = meta.money ? (v) => moneyToEur(Number(v)) : (v) => Number(v);
        const o = {};
        if (flt.min !== "" && !Number.isNaN(Number(flt.min))) o.min = conv(flt.min);
        if (flt.max !== "" && !Number.isNaN(Number(flt.max))) o.max = conv(flt.max);
        if ("min" in o || "max" in o) f[flt.key] = o;
      }
    }
    return f;
  }, [country, liveFilters, curSymForFilters]);

  /* Sale-only sort keys are invalid on the pipeline views, and a sort on a column the user
     has SINCE HIDDEN is invisible — the rows come back in an order with no explanation on
     screen. Both fall back to the first sortable column that is actually showing. */
  const sortableNow = isPipe
    ? ["price_s_dph_eur", "price_per_m2_eur", "izby", "obytna_plocha", "city", "project_name"]
    : ["sold_date", "price_s_dph_eur", "price_per_m2_eur", "days_on_market", "izby", "obytna_plocha", "city", "project_name"];
  /* The columns are CHOSEN now. The table used to hard-code ten of the twenty-five fields
     every detail row already carries, which is what made the page feel restrictive — the
     data was there and there was no way to ask for it. Kept in the [key, sk, en, kind]
     tuple shape the renderer already speaks, so only the source of the list changed. */
  const visibleCols = useMemo(() => {
    const avail = SALES_FIELDS.filter((f) => f.col && !(isPipe && f.sold));
    const chosen = cols.filter((k) => avail.some((f) => f.key === k));
    /* No silent substitution. The first cut fell back to the defaults when the list came
       out empty, so pressing "✕ žiadne" appeared to do nothing — a control that does not
       do what it says is worse than one that is missing. An empty choice renders an empty
       state that explains itself; a chosen set that is empty only because the SOLD-only
       columns were dropped on a pipeline tab still falls back, because the user did not
       ask for that. */
    /* An EMPTY cols list can only come from the user pressing "žiadne" — the state starts
       as the defaults and is never empty otherwise. That is an instruction, so it is
       obeyed and explained. A NON-empty cols whose members all happen to be sold-only on a
       pipeline tab is a different thing entirely: the user did not ask for a blank table,
       so that one falls back to the defaults. (The first version tested these the wrong way
       round, so "žiadne" appeared to do nothing.) */
    if (!cols.length) return [];
    const use = chosen.length ? chosen : (isPipe ? SALES_DEFAULT_COLS_PIPE : SALES_DEFAULT_COLS).filter((k) => avail.some((f) => f.key === k));
    return use.map((k) => { const f = avail.find((x) => x.key === k); return [f.key, f.sk, f.en, f.col]; });
  }, [cols, isPipe]);
  const colFields = useMemo(
    () => SALES_FIELDS.filter((f) => f.col && !(isPipe && f.sold))
      .map((f) => ({ key: f.key, label_sk: f.sk, label_en: f.en,
                     type: ["num", "eur", "per_m2", "area"].includes(f.col) ? "numeric" : f.col === "date" ? "date" : "text" })),
    [isPipe],
  );
  const effSort = useMemo(() => {
    const shown = new Set(visibleCols.map((c) => c[0]));
    if (sortableNow.includes(sort.key) && shown.has(sort.key)) return sort;
    const fallback = sortableNow.find((k) => shown.has(k));
    return fallback ? { key: fallback, dir: "desc" } : sort;
  }, [sort, visibleCols, sortableNow]);
  const detailColSpan = visibleCols.length; // full-row cells must span the ACTUAL visible column count (varies sold vs pipeline)
  const SORTABLE = sortableNow;
  /* A sold-only grouping is invalid on the pipeline tabs and the engine raises on it, so
     the group falls back rather than blanking the page — same reasoning as the sale-only
     filters. It is not written back to state, so it returns when you go back to Predané. */
  const effGroupBy = (isPipe && (GROUP_DIMS.find(([k]) => k === groupBy) || [])[3]) ? "city" : groupBy;

  const common = { status, date_from, date_to, durable_only: durableOnly, filters: baseFilters };
  const summarySpec = useMemo(() => ({ ...common, mode: "summary" }), [JSON.stringify(common)]);       // eslint-disable-line
  const breakdownSpec = useMemo(() => ({ ...common, mode: "breakdown", group_by: effGroupBy }), [JSON.stringify(common), effGroupBy]); // eslint-disable-line
  const detailSpec = useMemo(() => ({ ...common, mode: "detail", sort: [effSort], limit: DETAIL_LIMIT }), [JSON.stringify(common), JSON.stringify(effSort)]); // eslint-disable-line

  // ── LIVE FACETS: what can still be picked, given everything already picked ──
  // Both filter rows are populated from the SAME facts the page is showing, not from a
  // global list — so City only offers cities with sales in this period/market, Developer
  // only developers still present in the chosen city, and so on. Each field's own filter
  // is excluded server-side, so choosing a city never collapses the city list to that one
  // city. `base` = the scope row at the top; `detail` = the per-column row above the unit
  // list, which additionally sees the other column filters (it drills inside the scope).
  /* ONE facet request now, not two. The second one existed only to feed the per-column
     filter row; with a single scope, the same call feeds the four pickers and whatever
     extra categorical filters are on screen — so every interaction costs one round trip
     instead of two, and no two option lists can be computed from different scopes. */
  const facetKeys = useMemo(() => {
    const cat = liveFilters.map((f) => f.key)
      .filter((k) => SALES_FIELDS.some((m) => m.key === k && m.filter === "in"));
    return [...new Set([...BASE_FACETS, ...cat])];
  }, [liveFilters]);
  const baseFacetSpec = useMemo(() => ({ ...common, mode: "facets", facet_scope: "base", facets: facetKeys }), [JSON.stringify(common), JSON.stringify(facetKeys)]); // eslint-disable-line
  const sum = useSales({ enabled: true, spec: summarySpec });
  const brk = useSales({ enabled: true, spec: breakdownSpec });
  const det = useSales({ enabled: true, spec: detailSpec });
  const fac = useSales({ enabled: true, spec: baseFacetSpec });

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
  /* Panel wiring — the same component the Unit database uses, so a filter means the same
     thing on both pages. Values come from THIS page's live facets rather than the pivot
     grain, which is the only difference and is why the panel takes a value source. */
  const capsOf = (key) => {
    const m = SALES_FIELDS.find((f) => f.key === key);
    if (!m || !m.filter || (isPipe && m.sold)) return { modes: [], valued: false, ranged: false, isDate: false };
    /* analytics_sales takes in-lists and {min,max} and nothing else, so the panel is told
       exactly that — it never offers an operator the query would reject. */
    return m.filter === "in"
      ? { modes: ["in"], valued: true, ranged: false, isDate: false }
      : { modes: ["between"], valued: false, ranged: true, isDate: false };
  };
  const unitOf = (key) => {
    const m = SALES_FIELDS.find((f) => f.key === key);
    if (!m) return "";
    if (m.col === "eur") return moneySymbol();
    if (m.col === "per_m2") return `${moneySymbol()}/m²`;
    if (m.col === "area") return "m²";
    return "";
  };
  /* Rooms and floor are numeric, so a facet hands back "2.0"; nobody asks for a 2.0-room
     flat. The label is tidied, the VALUE sent to the engine is untouched. */
  const prettyValue = (key) => {
    if (key === "detection_method") return (v) => (v === "marked" ? t("označené", "marked") : v === "disappeared" ? t("zmizol", "delisted") : v);
    if (key === "izby" || key === "poschodie") return (v) => String(v).replace(/\.0$/, "");
    return null;
  };
  const useValues = (key, enabled) => ({
    // {value,label} pairs: the engine gets the stored value, the reader sees the tidy one.
    values: enabled ? facetOptions(fac.data, key, null, prettyValue(key)) : [],
    loading: fac.loading,
  });
  const panelFields = useMemo(
    () => SALES_FIELDS.filter((f) => !(isPipe && f.sold))
      .map((f) => ({ key: f.key, label_sk: f.sk, label_en: f.en,
                     type: f.filter === "between" ? "numeric" : f.col === "date" ? "date" : "text" })),
    [isPipe],
  );
  const addFilter = (key) => {
    const caps = capsOf(key);
    if (!caps.modes.length) return;
    setFilters((a) => (a.some((f) => f.key === key) ? a : [...a, newFilter(key, caps, ++fId.current)]));
  };
  const patchFilter = (id, patch) => setFilters((a) => a.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeFilter = (id) => setFilters((a) => a.filter((f) => f.id !== id));
  const clearFilters = () => setFilters([]);
  const activeFilters = liveFilters.filter(isFilterActive).length;
  const toggleCol = (k) => setCols((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

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
      /* The file says what the screen says. The sale signal renders as "označené" in the
         table and was exporting as "marked" — a column whose meaning changes between the
         page and the download is the same fault as a currency that does. */
      const pretty = prettyValue(c[0]);
      const shown = pretty && v != null ? pretty(v) : v;
      return shown == null ? "" : String(shown).replace(/;/g, ",");
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
          <span className="rd-label" style={{ fontSize: "0.66rem", color: rangeInverted ? "var(--accent-2)" : "var(--accent-ink)", letterSpacing: "0.04em", textTransform: "none" }}>
            {rangeLabel}{rangeInverted ? ` — ${t("obdobie beží pozadu", "the period runs backwards")}` : ""}
          </span>
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
          {/* The market switcher is a platform-level scope, not one of these filters. */}
          <CountrySwitcher lang={lang} hideLabel />
          {/* The query, stated. The CONTROLS live in the panel on the right — the same one
              the Unit database uses — so this line is a readable summary rather than a row
              of dropdowns that used to be duplicated again under the table. */}
          {liveFilters.length === 0 && (
            <span style={{ fontSize: "0.78rem", color: "var(--text-faint)" }}>
              {t("Žiadne — celý trh. Pridaj filter v paneli vpravo.", "None — the whole market. Add one in the panel on the right.")}
            </span>
          )}
          {liveFilters.map((f) => {
            const m = SALES_FIELDS.find((x) => x.key === f.key);
            const on = isFilterActive(f);
            return (
              <span key={f.id} className="rd-chip" onClick={() => { setPanelTab("filters"); setAdding(false); }}
                title={t("Upraviť v paneli vpravo", "Edit in the panel on the right")}
                style={on ? undefined : { opacity: 0.6 }}>
                <span className="rd-chip__label">
                  {t(m.sk, m.en)}{on ? ` · ${summariseFilter(f, lang, prettyValue(f.key) || undefined)}` : ` · ${t("nenastavený", "not set")}`}
                </span>
                <span className="rd-chip__x" onClick={(e) => { e.stopPropagation(); removeFilter(f.id); }}>✕</span>
              </span>
            );
          })}
          {filters.length > liveFilters.length && (
            <span style={{ fontSize: "0.72rem", color: "var(--text-faint)" }}
              title={t("Filtre na polia, ktoré pri rezerváciách neexistujú (zdroj predaja, dní na trhu) — vrátia sa pri Predané.",
                       "Filters on fields that do not exist for reservations (sale signal, days on market) — they return on Sold.")}>
              +{filters.length - liveFilters.length} {t("neaktívnych", "inactive")}
            </span>
          )}
          {activeFilters > 0 && (
            <button className="rd-btn rd-btn--ghost rd-btn--sm" onClick={clearFilters}>✕ {t("vyčistiť", "clear")}</button>
          )}
        </div>
      </div>

      <div className="rd-workbench">
        <div className="rd-workbench__main">
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
            {GROUP_DIMS.filter(([, , , sold]) => !(isPipe && sold)).map(([k, sk, en]) => (
              <button key={k} className="rd-seg__btn" aria-pressed={effGroupBy === k} onClick={() => setGroupBy(k)}>{t(sk, en)}</button>
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
                  {/* The group is a stored value; show the readable one, the same as the
                      table, the chips and the CSV. Grouping by sale signal otherwise reads
                      "marked / disappeared" on a Slovak page. */}
                  <td className="rd-td--key">{(() => {
                    const pretty = prettyValue(effGroupBy);
                    return r.group == null ? "—" : (pretty ? pretty(r.group) : r.group);
                  })()}
                    {effGroupBy === "project_name" ? <SpecificsMark items={spec.project(r.group)} lang={lang} /> : null}
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
            {/* The tooltip that used to live here explained why this list could disagree
                with the totals above it. With one scope there is nothing to explain. */}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <button className="rd-btn rd-btn--primary rd-btn--sm" onClick={exportCsv} disabled={!detRows.length}>⬇ CSV</button>
          </div>
        </div>

        {visibleCols.length === 0 ? (
          /* The user pressed "žiadne". Say so and offer the way back, instead of a table
             with no columns or — worse — the defaults quietly put back. */
          <div className="rd-note" style={{ textAlign: "center", padding: "2rem 1rem" }}>
            <div style={{ color: "var(--text)", fontSize: "0.86rem", marginBottom: "0.3rem" }}>
              {t("Nie je vybraný žiadny stĺpec.", "No columns are selected.")}
            </div>
            <div style={{ marginBottom: "0.9rem" }}>
              {t("Zoznam bytov nemá čo zobraziť — vyber stĺpce v paneli vpravo.", "The unit list has nothing to show — choose columns in the panel on the right.")}
            </div>
            <button className="rd-btn rd-btn--primary rd-btn--sm"
              onClick={() => { setCols(isPipe ? SALES_DEFAULT_COLS_PIPE : SALES_DEFAULT_COLS); setPanelTab("cols"); }}>
              ↺ {t("Obnoviť predvolené stĺpce", "Restore the default columns")}
            </button>
          </div>
        ) : (
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
            </thead>
            <tbody>
              {det.loading && <tr><td className="rd-td--empty" colSpan={detailColSpan} style={{ fontStyle: "normal" }}>{t("načítavam…", "loading…")}</td></tr>}
              {det.error && <tr><td colSpan={detailColSpan} style={{ padding: 0 }}><LoadError lang={lang} /></td></tr>}
              {!det.loading && !det.error && detRows.length === 0 && <tr><td className="rd-td--empty" colSpan={detailColSpan}>{rangeInverted
                  ? t("Dátum „od“ je neskôr ako „do“ — oprav obdobie hore.", "The “from” date is after the “to” date — fix the period above.")
                  : isPipe ? t("Žiadne jednotky v tomto stave pre tento výber.", "No units in this state for this selection.")
                           : t("Žiadne predané byty pre tento výber a obdobie.", "No sold units for this selection and period.")}</td></tr>}
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
        </div>)}
        <div className="rd-note" style={{ marginTop: "0.6rem" }}>
          {t("„Dní na trhu“ je dostupné len pre byty ktoré sme videli pribudnúť aj predať — sledovanie beží od mája 2026.",
             "“Days on market” is only known for units we saw both list and sell — tracking started May 2026.")}
        </div>
      </div>
        </div>

        <FieldPanel
          lang={lang}
          tab={panelTab} setTab={setPanelTab}
          adding={adding} setAdding={setAdding}
          search={search} setSearch={setSearch}
          fields={panelTab === "cols" ? colFields : panelFields}
          catOf={(k) => (SALES_FIELDS.find((f) => f.key === k) || {}).cat || "other"}
          catOrder={SALES_CAT_ORDER} catLabel={SALES_CAT_LABEL}
          capsOf={capsOf} unitOf={unitOf} useValues={useValues}
          filters={liveFilters} onAdd={addFilter} onPatch={patchFilter} onRemove={removeFilter}
          cols={cols} onToggleCol={toggleCol} onSetCols={setCols}
          defaultCols={isPipe ? SALES_DEFAULT_COLS_PIPE : SALES_DEFAULT_COLS}
          emptyHint={t("Súhrny aj zoznam ukazujú celé zvolené obdobie — pridaj filter tlačidlom vyššie.",
                       "The totals and the list cover the whole selected period — add one with the button above.")}
        />
      </div>
    </div>
  );
}
