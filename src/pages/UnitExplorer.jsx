/* UnitExplorer — Phase 3.1 of the analytics rebuild.
   The "raw values as values" view: pick any columns, scope/filter, and see individual
   units (not aggregated). Reads the detail half of the query engine (analytics_units),
   so it's server-side, paginated and RLS-gated (archive = paid/chosen-project). The
   pivot answers "aggregate"; this answers "show me the actual rows". */
import { useState, useMemo, useEffect } from "react";
import { useCountry, isAllCountries } from "../lib/useCountry";
import { useUnitsDetail, useAnalyticsRegistry, usePivotDistinct } from "../lib/useData";

const PAGE = 50;
const DEFAULT_COLS = ["project_name", "city", "cast", "typ", "izby", "obytna_plocha", "cena_s_dph", "price_per_m2", "stav"];

// palette (matches the app's dark platform theme)
const C = { card: "#16161d", border: "#2a2a35", text: "#e8e8ee", dim: "#8a8a96", accent: "#f5a623", chip: "#1e1e27" };
const inp = { background: C.chip, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "0.35rem 0.5rem", fontSize: "0.8rem", fontFamily: "inherit" };

function fmtVal(key, val, fmtByKey) {
  if (val == null || val === "") return "—";
  const f = fmtByKey[key];
  const n = Number(val);
  if (f === "eur" && Number.isFinite(n)) return "€" + Math.round(n).toLocaleString("sk-SK");
  if (f === "per_m2" && Number.isFinite(n)) return Math.round(n).toLocaleString("sk-SK") + " €/m²";
  if (f === "area" && Number.isFinite(n)) return n.toLocaleString("sk-SK", { maximumFractionDigits: 1 }) + " m²";
  return String(val);
}

export default function UnitExplorer({ lang = "sk" }) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  const { country } = useCountry();
  const { dimensions, measures } = useAnalyticsRegistry();
  const fields = useMemo(() => [...dimensions, ...measures], [dimensions, measures]);
  const fmtByKey = useMemo(() => Object.fromEntries(measures.map((m) => [m.key, m.format])), [measures]);
  const labelByKey = useMemo(() => Object.fromEntries(fields.map((f) => [f.key, lang === "sk" ? f.label_sk : f.label_en])), [fields, lang]);
  const lbl = (k) => labelByKey[k] || k;

  const [mode, setMode] = useState("latest");
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fProject, setFProject] = useState("");
  const [fCity, setFCity] = useState("");
  const [fDev, setFDev] = useState("");
  const [fStav, setFStav] = useState("");
  const [pMin, setPMin] = useState("");
  const [pMax, setPMax] = useState("");
  const [sort, setSort] = useState({ key: "cena_s_dph", dir: "desc" });
  const [offset, setOffset] = useState(0);

  // any scope/filter/sort change → back to page 1
  useEffect(() => { setOffset(0); }, [country, mode, fProject, fCity, fDev, fStav, pMin, pMax, sort]);

  const cityOpts = usePivotDistinct({ enabled: true, field: "city" });
  const devOpts = usePivotDistinct({ enabled: true, field: "developer" });
  const projOpts = usePivotDistinct({ enabled: true, field: "project_name" });
  const stavOpts = usePivotDistinct({ enabled: true, field: "stav" });

  const spec = useMemo(() => {
    const filters = {};
    if (!isAllCountries(country)) filters.country = [country];
    if (fProject) filters.project_name = [fProject];
    if (fCity) filters.city = [fCity];
    if (fDev) filters.developer = [fDev];
    if (fStav) filters.stav = [fStav];
    const ranges = {};
    if (pMin || pMax) ranges.cena_s_dph = { min: pMin || null, max: pMax || null };
    const s = { columns: cols, filters, mode, sort: [sort], limit: PAGE, offset };
    if (Object.keys(ranges).length) s.ranges = ranges;
    return s;
  }, [country, fProject, fCity, fDev, fStav, pMin, pMax, cols, mode, sort, offset]);

  const { rows, hasMore, loading } = useUnitsDetail({ enabled: cols.length > 0, spec });

  const toggleSort = (k) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" }));
  const toggleCol = (k) => setCols((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  const Sel = ({ value, onChange, opts, ph }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inp, minWidth: 130 }}>
      <option value="">{ph}</option>
      {(opts || []).map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );

  return (
    <div style={{ color: C.text, fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", marginBottom: "0.5rem" }}>
        <h1 style={{ fontSize: "1.4rem", margin: 0 }}>{t("Prieskumník bytov", "Unit Explorer")}</h1>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          {["latest", "archive"].map((m) => (
            <button key={m} onClick={() => setMode(m)} style={{ ...inp, cursor: "pointer", background: mode === m ? C.accent : C.chip, color: mode === m ? "#000" : C.text, fontWeight: mode === m ? 600 : 400 }}>
              {m === "latest" ? t("Aktuálne", "Current") : t("História", "All history")}
            </button>
          ))}
        </div>
      </div>
      <p style={{ color: C.dim, fontSize: "0.8rem", marginTop: 0 }}>
        {t("Surové dáta po jednotlivých bytoch — vyber stĺpce, filtruj, zoraď. Stránkované po", "Raw per-unit data — pick columns, filter, sort. Paginated by")} {PAGE}.
      </p>

      {/* filters */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.75rem" }}>
        <Sel value={fProject} onChange={setFProject} opts={projOpts.values} ph={t("Projekt: všetky", "Project: all")} />
        <Sel value={fCity} onChange={setFCity} opts={cityOpts.values} ph={t("Mesto: všetky", "City: all")} />
        <Sel value={fDev} onChange={setFDev} opts={devOpts.values} ph={t("Developer: všetci", "Developer: all")} />
        <Sel value={fStav} onChange={setFStav} opts={stavOpts.values} ph={t("Stav: všetky", "Status: all")} />
        <input style={{ ...inp, width: 90 }} placeholder={t("cena od", "price ≥")} value={pMin} onChange={(e) => setPMin(e.target.value)} inputMode="numeric" />
        <input style={{ ...inp, width: 90 }} placeholder={t("cena do", "price ≤")} value={pMax} onChange={(e) => setPMax(e.target.value)} inputMode="numeric" />
        <button onClick={() => setPickerOpen((o) => !o)} style={{ ...inp, cursor: "pointer" }}>{t("Stĺpce", "Columns")} ({cols.length})</button>
        {(fProject || fCity || fDev || fStav || pMin || pMax) && (
          <button onClick={() => { setFProject(""); setFCity(""); setFDev(""); setFStav(""); setPMin(""); setPMax(""); }} style={{ ...inp, cursor: "pointer", color: C.dim }}>✕ {t("vyčistiť", "clear")}</button>
        )}
      </div>

      {/* column picker */}
      {pickerOpen && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "0.75rem", marginBottom: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.4rem 1rem" }}>
          {fields.map((f) => (
            <label key={f.key} style={{ fontSize: "0.78rem", color: cols.includes(f.key) ? C.text : C.dim, display: "flex", gap: "0.3rem", alignItems: "center", cursor: "pointer", minWidth: 150 }}>
              <input type="checkbox" checked={cols.includes(f.key)} onChange={() => toggleCol(f.key)} />
              {lbl(f.key)}
            </label>
          ))}
        </div>
      )}

      {/* table */}
      <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem" }}>
          <thead>
            <tr style={{ background: C.chip }}>
              {cols.map((k) => (
                <th key={k} onClick={() => toggleSort(k)} style={{ padding: "0.5rem 0.6rem", textAlign: "left", whiteSpace: "nowrap", cursor: "pointer", borderBottom: `1px solid ${C.border}`, color: sort.key === k ? C.accent : C.text, userSelect: "none" }}>
                  {lbl(k)}{sort.key === k ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.composite_unit_id || i} style={{ borderBottom: `1px solid ${C.border}` }}>
                {cols.map((k) => (
                  <td key={k} style={{ padding: "0.4rem 0.6rem", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtVal(k, r[k], fmtByKey)}</td>
                ))}
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={cols.length || 1} style={{ padding: "1.5rem", textAlign: "center", color: C.dim }}>{t("Žiadne byty pre tento filter.", "No units match this filter.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* pagination */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "0.6rem", color: C.dim, fontSize: "0.8rem" }}>
        <button disabled={offset === 0 || loading} onClick={() => setOffset((o) => Math.max(0, o - PAGE))} style={{ ...inp, cursor: offset === 0 ? "default" : "pointer", opacity: offset === 0 ? 0.4 : 1 }}>‹ {t("späť", "prev")}</button>
        <span>{loading ? t("načítavam…", "loading…") : `${rows.length ? offset + 1 : 0}–${offset + rows.length}`}</span>
        <button disabled={!hasMore || loading} onClick={() => setOffset((o) => o + PAGE)} style={{ ...inp, cursor: hasMore ? "pointer" : "default", opacity: hasMore ? 1 : 0.4 }}>{t("ďalej", "next")} ›</button>
      </div>
    </div>
  );
}
