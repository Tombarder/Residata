/* SalesView — Analytics → Predaje / Sales.
   "How many and WHICH units sold — and STAYED sold — in a period, for the projects I pick."
   Reads public.analytics_sales (summary / breakdown / detail) over analytics.sale_events:
   durable sale detection (delete-on-sale aware, relist-reversed), frozen sale price/€m²/
   days-on-market. Same design language as the Explorer/pivot (dark, green accent, mono labels).
   Built for the comparable-projects pricing workflow (e.g. Nitra). */
import { useState, useMemo } from "react";
import { useCurrency } from "../lib/useCurrency";
import { moneyFromEur, moneySymbol } from "../lib/money";
import { useSales, usePivotDistinct } from "../lib/useData";
import LoadError from "../components/LoadError";
import Picker from "../components/Picker";
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

  const [status, setStatus] = useState("sold");
  const isPipe = status !== "sold";
  const [days, setDays] = useState(45);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [market, setMarket] = useState("");      // '' = all | 'sk' | 'cz'
  const [durableOnly, setDurableOnly] = useState(true);
  const [projects, setProjects] = useState([]);  // selected project_name[]
  const [fCity, setFCity] = useState("");
  const [fDev, setFDev] = useState("");
  const [fTyp, setFTyp] = useState("");
  const [groupBy, setGroupBy] = useState("city");
  const [sort, setSort] = useState({ key: "sold_date", dir: "desc" });
  const [projSearch, setProjSearch] = useState("");
  const [projOpen, setProjOpen] = useState(false);

  const date_from = customFrom || isoDaysAgo(days);
  const date_to = customTo || isoToday();

  // option lists (server-side distinct, latest scope is fine for the picker)
  const projOpts = usePivotDistinct({ enabled: true, field: "project_name", mode: "archive" });
  const cityOpts = usePivotDistinct({ enabled: true, field: "city", mode: "archive" });
  const devOpts = usePivotDistinct({ enabled: true, field: "developer", mode: "archive" });
  const typOpts = usePivotDistinct({ enabled: true, field: "typ", mode: "archive" });

  const baseFilters = useMemo(() => {
    const f = {};
    if (market) f.market_key = [market];
    if (projects.length) f.project_name = projects;
    if (fCity) f.city = [fCity];
    if (fDev) f.developer = [fDev];
    if (fTyp) f.typ = [fTyp];
    return f;
  }, [market, projects, fCity, fDev, fTyp]);

  // sale-only sort keys are invalid for the current-pipeline views → fall back to price
  const effSort = isPipe && (sort.key === "sold_date" || sort.key === "days_on_market") ? { key: "price_s_dph_eur", dir: "desc" } : sort;
  const detailCols = isPipe ? DETAIL_COLS_PIPE : DETAIL_COLS;
  const detailColSpan = detailCols.filter((c) => c[3] !== "hide").length; // full-row cells must span the ACTUAL visible column count (varies sold vs pipeline)
  const SORTABLE = isPipe ? ["price_s_dph_eur", "price_per_m2_eur", "izby", "obytna_plocha", "city", "project_name"]
                          : ["sold_date", "price_s_dph_eur", "price_per_m2_eur", "days_on_market", "izby", "obytna_plocha", "city", "project_name"];
  const common = { status, date_from, date_to, durable_only: durableOnly, filters: baseFilters };
  const summarySpec = useMemo(() => ({ ...common, mode: "summary" }), [JSON.stringify(common)]);       // eslint-disable-line
  const breakdownSpec = useMemo(() => ({ ...common, mode: "breakdown", group_by: groupBy }), [JSON.stringify(common), groupBy]); // eslint-disable-line
  const detailSpec = useMemo(() => ({ ...common, mode: "detail", sort: [effSort], limit: DETAIL_LIMIT }), [JSON.stringify(common), JSON.stringify(effSort)]); // eslint-disable-line

  const sum = useSales({ enabled: true, spec: summarySpec });
  const brk = useSales({ enabled: true, spec: breakdownSpec });
  const det = useSales({ enabled: true, spec: detailSpec });

  const S = sum.data || {};
  const brkRows = brk.data?.rows || [];
  // The RPC returns limit+1 rows as a "there's more" sentinel — slice back to the page
  // size and surface the overflow as a "+" so the table never shows a stray extra row.
  const _detRaw = det.data?.rows || [];
  const detHasMore = _detRaw.length > DETAIL_LIMIT;
  const detRows = detHasMore ? _detRaw.slice(0, DETAIL_LIMIT) : _detRaw;

  const toggleProject = (name) => setProjects((p) => p.includes(name) ? p.filter((x) => x !== name) : [...p, name]);
  const clearFilters = () => { setProjects([]); setFCity(""); setFDev(""); setFTyp(""); setMarket(""); };
  const activeFilters = projects.length + [market, fCity, fDev, fTyp].filter(Boolean).length;
  const toggleSort = (k) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" }));

  const projFiltered = (projOpts.values || []).filter((v) => !projSearch || v.toLowerCase().includes(projSearch.toLowerCase()));

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
  const kpiVal = { fontSize: "1.5rem", fontWeight: 700, color: text, fontFamily: mono, fontVariantNumeric: "tabular-nums" };
  const kpiLbl = { fontFamily: mono, fontSize: "0.62rem", color: dim, letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: "0.3rem" };
  const Sel = ({ value, onChange, opts, ph }) => (
    <Picker value={value} onChange={onChange} width={150} searchable sk={lang === "sk"} placeholder={ph} ariaLabel={ph}
      options={[{ value: "", label: ph }, ...(opts || []).map((o) => ({ value: o, label: o }))]} />
  );

  const dur = S.sold_durable ?? 0;
  const gross = S.sold_all ?? 0;
  const reversed = Math.max(0, gross - dur);

  return (
    <div style={{ color: text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* header */}
      <div style={{ marginBottom: "0.9rem" }}>
        <h1 style={{ fontSize: "1.4rem", margin: "0 0 0.2rem" }}>{t("Predaje", "Sales")}</h1>
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
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} style={{ ...sel, width: 140 }} title={t("od", "from")} />
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} style={{ ...sel, width: 140 }} title={t("do", "to")} />
          </>
        )}
        <div style={{ display: "inline-flex", border: `1px solid ${border}`, borderRadius: 7, overflow: "hidden", marginLeft: "0.3rem" }}>
          {[["", "Všetky trhy", "All"], ["sk", "SK", "SK"], ["cz", "CZ", "CZ"]].map(([m, sk, en]) => (
            <button key={m || "all"} onClick={() => setMarket(m)}
              style={{ border: "none", padding: "0.4rem 0.7rem", cursor: "pointer", fontFamily: mono, fontSize: "0.7rem", background: market === m ? green : "transparent", color: market === m ? "#04130d" : dim, fontWeight: market === m ? 700 : 500 }}>
              {t(sk, en)}
            </button>
          ))}
        </div>
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
        {/* project multi-select */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setProjOpen((o) => !o)} style={{ ...sel, cursor: "pointer", minWidth: 150, textAlign: "left", color: projects.length ? text : dim }}>
            {projects.length ? t(`${projects.length} projektov`, `${projects.length} projects`) : t("Projekty: všetky ▾", "Projects: all ▾")}
          </button>
          {projOpen && (
            <div style={{ position: "absolute", zIndex: 20, top: "110%", left: 0, width: 280, maxHeight: 320, overflowY: "auto", background: panel, border: `1px solid ${border}`, borderRadius: 8, padding: "0.5rem", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}>
              <input autoFocus value={projSearch} onChange={(e) => setProjSearch(e.target.value)} placeholder={t("hľadať…", "search…")} style={{ ...sel, width: "100%", boxSizing: "border-box", marginBottom: "0.4rem" }} />
              {projects.length > 0 && <div onClick={() => setProjects([])} style={{ cursor: "pointer", color: dim, fontSize: "0.72rem", fontFamily: mono, padding: "0.2rem 0.3rem" }}>✕ {t("zrušiť výber", "clear")}</div>}
              {projOpts.loading && <div style={{ color: dim, fontSize: "0.75rem", padding: "0.3rem" }}>{t("načítavam…", "loading…")}</div>}
              {projFiltered.map((v) => (
                <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.28rem 0.3rem", fontSize: "0.78rem", cursor: "pointer", color: projects.includes(v) ? text : "var(--text-2)", borderRadius: 4 }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = panelHi)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <input type="checkbox" checked={projects.includes(v)} onChange={() => toggleProject(v)} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <Sel value={fCity} onChange={setFCity} opts={cityOpts.values} ph={t("Mesto: všetky", "City: all")} />
        <Sel value={fDev} onChange={setFDev} opts={devOpts.values} ph={t("Developer: všetci", "Developer: all")} />
        <Sel value={fTyp} onChange={setFTyp} opts={typOpts.values} ph={t("Typ: všetky", "Type: all")} />
        {projects.map((p) => <span key={p} onClick={() => toggleProject(p)} style={{ cursor: "pointer", background: green, color: "#04130d", borderRadius: 4, padding: "0.15rem 0.45rem", fontSize: "0.72rem", fontWeight: 600 }}>{p} ✕</span>)}
        {activeFilters > 0 && <button onClick={clearFilters} style={{ ...sel, cursor: "pointer", color: dim, fontFamily: mono, fontSize: "0.7rem" }}>✕ {t("vyčistiť", "clear")}</button>}
      </div>

      {/* KPI row */}
      {sum.error ? <LoadError lang={lang} /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.6rem", marginBottom: "0.6rem" }}>
          <div style={card}><div style={kpiLbl}>{t(HEADLINE[status][0], HEADLINE[status][1])}</div><div style={kpiVal}>{sum.loading ? "…" : dur.toLocaleString("sk-SK")}</div>{reversed > 0 && !durableOnly && !isPipe && <div style={{ fontSize: "0.68rem", color: orange, fontFamily: mono, marginTop: "0.2rem" }}>{t(`+${reversed} vrátených`, `+${reversed} fell through`)}</div>}</div>
          <div style={card}><div style={kpiLbl}>{isPipe ? t("Hodnota v ponuke", "Listed value") : t("Objem predaja", "Sold value")}</div><div style={kpiVal}>{sum.loading ? "…" : fmtMoney(S.sold_value_eur)}</div></div>
          <div style={card}><div style={kpiLbl}>{t("Medián ceny", "Median price")}</div><div style={kpiVal}>{sum.loading ? "…" : fmtMoney(S.median_price_eur)}</div></div>
          <div style={card}><div style={kpiLbl}>{t("Medián ", "Median ")}{moneySymbol()}/m²</div><div style={kpiVal}>{sum.loading ? "…" : fmtCell("per_m2", S.median_eur_m2)}</div></div>
          {!isPipe && (
          <div style={card}>
            <div style={kpiLbl}>{t("Medián dní na trhu", "Median days on market")}</div>
            <div style={kpiVal}>{sum.loading ? "…" : (S.median_days_on_market != null ? Math.round(S.median_days_on_market) : "—")}</div>
            <div style={{ fontSize: "0.64rem", color: dim, fontFamily: mono, marginTop: "0.2rem" }}>
              {S.observed_dom_count ? t(`z ${S.observed_dom_count} sledovaných`, `of ${S.observed_dom_count} observed`) : t("zatiaľ málo dát", "building history")}
            </div>
          </div>
          )}
        </div>
      )}

      {/* breakdown */}
      <div style={{ ...card, marginBottom: "0.6rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
          <span style={kpiLbl}>{t("Rozklad podľa", "Break down by")}</span>
          <div style={{ display: "inline-flex", gap: "0.25rem", flexWrap: "wrap" }}>
            {GROUP_DIMS.map(([k, sk, en]) => (
              <button key={k} onClick={() => setGroupBy(k)} style={{ ...sel, cursor: "pointer", padding: "0.28rem 0.55rem", fontFamily: mono, fontSize: "0.7rem", background: groupBy === k ? green : bg, color: groupBy === k ? "#04130d" : dim, borderColor: groupBy === k ? green : border, fontWeight: groupBy === k ? 700 : 500 }}>{t(sk, en)}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem", minWidth: 480 }}>
            <thead><tr>{[t("Skupina", "Group"), isPipe ? t("V ponuke", "Listed") : t("Predané", "Sold"), t("Objem", "Value"), `${t("Medián ", "Median ")}${moneySymbol()}/m²`, t("Medián dní", "Median days")].map((h, i) => (
              <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "0.4rem 0.6rem", borderBottom: `1px solid ${border}`, color: dim, fontFamily: mono, fontSize: "0.64rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
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
          <span style={kpiLbl}>{t("Konkrétne byty", "The exact units")}{detRows.length ? ` · ${detRows.length}${detHasMore ? "+" : ""}` : ""}</span>
          <button onClick={exportCsv} disabled={!detRows.length} style={{ ...sel, cursor: detRows.length ? "pointer" : "default", color: detRows.length ? "#04130d" : dim, background: detRows.length ? green : bg, borderColor: detRows.length ? green : border, fontFamily: mono, fontSize: "0.72rem", fontWeight: 700 }}>⬇ CSV</button>
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
                      {c[0] === "days_on_market" && r.left_censored ? <span title={t("Byt bol v ponuke ešte pred spustením sledovania — presný čas na trhu nepoznáme", "Listed before tracking began — true days-on-market unknown")} style={{ color: dim }}>—</span> : fmtCell(c[3], r[c[0]])}
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
