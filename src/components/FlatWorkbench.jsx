/* FlatWorkbench — filters and a column chooser for a list of flats the page already
 * holds, drawn the way Databáza bytov draws them.
 *
 * Boss, 2026-09-28: the filters (for filtering, and for adding and removing columns) he
 * uses on Predaje and Databáza bytov should be everywhere a list of flats appears —
 * "definitely in Projekty, where that list of flats is". Those two pages ask the server;
 * a project page already has its flats, so this workbench filters them in the browser
 * with the ENGINE's rules (filterModel.matchesFilters) over the registry's own field
 * keys (flatFields), and hands the same right-hand panel (FieldPanel) the controls.
 * One vocabulary, one panel, one meaning of a filter — on every page.
 *
 * The filter state lives in lib/useFlatFilters, which the Byt-v-čase grid uses on its own.
 */
import { useState, useMemo, useRef, useEffect } from "react";
import FieldPanel from "./FieldPanel";
import { useAccountPrefState } from "../lib/useAccountUiPref";
import { moneyFromEur, moneySymbol } from "../lib/money";
import { localeTag } from "../lib/locale";
import { statusLabel } from "../lib/unitStatus";
import { useSpecifics, UnitPriceMarks, specificsLegend } from "../lib/projectSpecifics";
import { field as sharedField } from "../lib/controls";
import { accent as green, accentInk, orangeInk, dim, border, bg, text } from "../lib/theme";
import { isFilterActive, summariseFilter } from "../lib/filterModel";
import { FLAT_FIELD_BY_KEY, FLAT_CAT_ORDER, FLAT_CAT_LABEL, DEFAULT_FLAT_COLS, flatValue } from "../lib/flatFields";
import { useFlatFilters, flatValueLabel } from "../lib/useFlatFilters";

const mono = "'JetBrains Mono', ui-monospace, Menlo, monospace";
const panel = "var(--surface-2)";

/* How a status looks in a cell — the project page's own colours, kept. */
const STAV_STYLE = {
  V: { color: "var(--accent)", bg: "color-mix(in srgb, var(--accent) 8%, transparent)" },
  P: { color: orangeInk, bg: "rgba(245,166,35,0.08)" },
  R: { color: "#888", bg: "rgba(136,136,136,0.08)" },
  PR: { color: "#aaa", bg: "rgba(170,170,170,0.08)" },
};

/** The chip bar above a filtered list: what is filtered, at a glance, each chip removable. */
export function FilterChips({ ff, lang, onOpenPanel, shown, total, noun }) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  const sel = sharedField;
  return (
    <div style={{ background: panel, border: `1px solid ${border}`, borderRadius: 8, padding: "0.5rem 0.6rem", marginBottom: "0.6rem", display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontFamily: mono, fontSize: "0.62rem", color: dim, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: "0.1rem" }}>
        <span style={{ display: "inline-block", width: 3, height: 12, borderRadius: 2, background: "var(--accent)", marginRight: "0.5rem", verticalAlign: "middle" }} />
        {t("Filtre", "Filters")}{ff.activeCount ? ` · ${ff.activeCount}` : ""}
      </span>
      {ff.filters.length === 0 && (
        <button onClick={() => onOpenPanel(true)}
          style={{ ...sel, cursor: "pointer", color: accentInk, borderColor: green, fontFamily: mono, fontSize: "0.72rem" }}>
          + {t("Pridaj filter vpravo", "Add a filter on the right")}
        </button>
      )}
      {ff.filters.map((f) => {
        const on = isFilterActive(f);
        return (
          <span key={f.id} onClick={() => onOpenPanel(false)} title={t("Upraviť v paneli vpravo", "Edit in the panel on the right")}
            style={{
              display: "inline-flex", alignItems: "center", gap: "0.35rem", cursor: "pointer",
              background: on ? "color-mix(in srgb, var(--accent) 12%, var(--surface-2))" : bg,
              border: `1px solid ${on ? green : border}`, borderRadius: 5,
              padding: "0.12rem 0.4rem", fontSize: "0.72rem", color: on ? text : dim, maxWidth: 260,
            }}>
            <span style={{ fontWeight: 600 }}>{ff.lbl(f.key)}</span>
            <span style={{ color: dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {on ? summariseFilter(f, lang, (v) => ff.valueLabel(f.key, v)) : t("(nenastavený)", "(not set)")}
            </span>
            <span onClick={(e) => { e.stopPropagation(); ff.removeFilter(f.id); }} title={t("Odstrániť", "Remove")} style={{ color: dim, fontSize: "0.78rem" }}>✕</span>
          </span>
        );
      })}
      {ff.filters.length > 0 && (
        <button onClick={() => ff.setFilters([])} style={{ ...sel, cursor: "pointer", color: dim, fontFamily: mono, fontSize: "0.7rem" }}>
          ✕ {t("vyčistiť", "clear")}
        </button>
      )}
      <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: "0.72rem", color: ff.activeCount ? accentInk : dim }}>
        <strong style={{ color: text }}>{shown}</strong> {t("z", "of")} {total} {noun}
      </span>
    </div>
  );
}

/**
 * The whole workbench: chip bar, sortable table, and the filters / columns panel.
 *
 * @param rows        flats_current-shaped rows (money in EUR)
 * @param prefKey     the account-preference key its view is remembered under
 * @param rowKey      row → stable id
 * @param highlightId a row to scroll to and flash (the project page's scatter click)
 */
export default function FlatWorkbench({
  rows, lang = "sk", prefKey, rowKey = (r) => r.id, highlightId = null,
  defaultCols = DEFAULT_FLAT_COLS, defaultSort = { key: "unit_id", dir: "asc" },
}) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  const locale = localeTag(lang);
  const ff = useFlatFilters(rows, { lang });
  const spec = useSpecifics(lang);

  const [cols, setCols] = useState(defaultCols);
  const [sort, setSort] = useState(defaultSort);
  const [panelTab, setPanelTab] = useState("filters");
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");

  /* Remembered per account, across devices and across projects: the columns you chose
     and the filters you built describe how you read a flat list, not one project. The
     search box is left out on purpose — see UnitExplorer: a stale word hid most fields. */
  useAccountPrefState(prefKey, { cols, filters: ff.filters, sort, panelTab }, (s) => {
    if (Array.isArray(s.cols)) setCols(s.cols.filter((k) => FLAT_FIELD_BY_KEY[k]));
    if (s.panelTab === "filters" || s.panelTab === "cols") setPanelTab(s.panelTab);
    if (Array.isArray(s.filters)) ff.restoreFilters(s.filters);
    if (s.sort && typeof s.sort === "object" && FLAT_FIELD_BY_KEY[s.sort.key]) setSort(s.sort);
  });

  /* Never order by a column that is not on screen — the rows would keep an order nothing
     on the page explains. The sort follows the first column still showing. */
  const effSort = cols.includes(sort.key) || !cols.length ? sort : { key: cols[0], dir: sort.dir };
  const sorted = useMemo(() => {
    const f = FLAT_FIELD_BY_KEY[effSort.key];
    if (!f) return ff.filtered;
    const dir = effSort.dir === "desc" ? -1 : 1;
    const numeric = f.type === "numeric";
    return [...ff.filtered].sort((a, b) => {
      const av = flatValue(a, f.key), bv = flatValue(b, f.key);
      const ae = av === null || av === undefined || av === "";
      const be = bv === null || bv === undefined || bv === "";
      if (ae && be) return 0;
      if (ae) return 1;            // blanks last, whichever way
      if (be) return -1;
      if (numeric) return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv), locale, { numeric: true, sensitivity: "base" }) * dir;
    });
  }, [ff.filtered, effSort.key, effSort.dir, locale]);

  const toggleSort = (k) => setSort((s) => (s.key === k
    ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" }
    : { key: k, dir: FLAT_FIELD_BY_KEY[k]?.type === "numeric" ? "desc" : "asc" }));
  const toggleCol = (k) => setCols((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  /* A flat picked on the scatter chart scrolls into view and flashes. If a filter hides
     it, the filters are cleared first — a click that silently does nothing is worse. */
  const scrollRef = useRef(null);
  useEffect(() => {
    if (!highlightId) return;
    const inData = (rows || []).some((r) => rowKey(r) === highlightId);
    const inView = sorted.some((r) => rowKey(r) === highlightId);
    if (inData && !inView && ff.filters.length) { ff.setFilters([]); return; }
    const id = requestAnimationFrame(() => {
      document.getElementById(`flat-row-${highlightId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [highlightId, sorted]);   // eslint-disable-line react-hooks/exhaustive-deps

  const cell = (k, r) => {
    const v = flatValue(r, k);
    const fmt = FLAT_FIELD_BY_KEY[k]?.fmt;
    if (k === "cena_s_dph") {
      return (
        <>
          {v !== null ? `${Math.round(moneyFromEur(v)).toLocaleString(locale)} ${moneySymbol()}`
            : r.cena_s_dph_text ? <span style={{ color: dim }}>{r.cena_s_dph_text}</span> : "—"}
          {/* A flat can carry its OWN payment schedule or fit-out level inside an otherwise
              ordinary project, so the mark sits on the flat, not only in the project panel. */}
          <UnitPriceMarks items={spec.unit(r, r.project_id || r.project_name)} lang={lang} compact />
        </>
      );
    }
    if (v === null || v === undefined || v === "") return <span style={{ color: dim }}>—</span>;
    if (fmt === "eur" || fmt === "per_m2") return Math.round(moneyFromEur(v)).toLocaleString(locale);
    if (fmt === "area") return Number(v).toLocaleString(locale, { maximumFractionDigits: 1 });
    if (k === "stav") {
      const s = STAV_STYLE[v];
      return s
        ? <span style={{ padding: "2px 6px", borderRadius: 4, fontFamily: mono, fontSize: "0.64rem", fontWeight: 600, color: s.color, background: s.bg }}>{statusLabel(v, lang, "one")}</span>
        : statusLabel(v, lang, "one");
    }
    if (k === "unit_id") return <strong>{v}</strong>;
    return flatValueLabel(k, v, lang);
  };

  const legend = useMemo(
    () => (cols.includes("cena_s_dph") ? specificsLegend(sorted.map((r) => spec.unit(r, r.project_id || r.project_name)), lang) : ""),
    [sorted, spec, cols, lang],
  );

  const openPanel = (add) => { setPanelTab("filters"); setAdding(!!add); };
  const numericCol = (k) => FLAT_FIELD_BY_KEY[k]?.type === "numeric";

  return (
    <div className="rd-workbench">
      <div className="rd-workbench__main">
        <FilterChips ff={ff} lang={lang} onOpenPanel={openPanel}
          shown={sorted.length} total={(rows || []).length} noun={t("bytov", "units")} />

        {cols.length === 0 ? (
          <div style={{ border: `1px solid ${border}`, borderRadius: 8, background: panel, padding: "2.2rem 1rem", textAlign: "center" }}>
            <div style={{ color: text, fontSize: "0.86rem", marginBottom: "0.3rem" }}>{t("Nie je vybraný žiadny stĺpec.", "No columns are selected.")}</div>
            <button onClick={() => { setCols(defaultCols); setPanelTab("cols"); }}
              style={{ ...sharedField, cursor: "pointer", color: "#04130d", background: green, borderColor: green, fontFamily: mono, fontSize: "0.74rem", fontWeight: 700, marginTop: "0.6rem" }}>
              ↺ {t("Obnoviť predvolené stĺpce", "Restore the default columns")}
            </button>
          </div>
        ) : (
          /* Same height as the panel beside it, so the two columns end together. */
          <div ref={scrollRef} style={{ overflow: "auto", maxHeight: "calc(100vh - 206px)", minHeight: 280, border: `1px solid ${border}`, borderRadius: 8, background: panel }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: "100%", minWidth: Math.max(1, cols.length) * 96, fontSize: "0.78rem" }}>
              <thead style={{ background: "var(--surface-2)", position: "sticky", top: 0, zIndex: 1 }}>
                <tr>
                  {cols.map((k) => (
                    /* Headers WRAP rather than clip: beside the panel a column is ~96px, and
                       "OBYTNÁ PLO…" / "EXTERIÉR (…" told the reader nothing. */
                    <th key={k} onClick={() => toggleSort(k)} title={`${ff.lbl(k)} — ${t("klikni pre zoradenie", "click to sort")}`}
                      style={{ padding: "0.55rem 0.6rem", textAlign: numericCol(k) ? "right" : "left", verticalAlign: "bottom", whiteSpace: "normal", lineHeight: 1.3, cursor: "pointer", borderBottom: `1px solid ${border}`, color: effSort.key === k ? green : "var(--text-2)", userSelect: "none", fontFamily: mono, fontSize: "0.64rem", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700 }}>
                      {ff.lbl(k)}{effSort.key === k ? (effSort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr><td colSpan={cols.length} style={{ padding: "1.4rem", textAlign: "center", color: dim, fontStyle: "italic" }}>
                    {t("Žiadne byty neprešli filtrami.", "No flats match the filters.")}
                  </td></tr>
                )}
                {sorted.map((r, i) => {
                  const id = rowKey(r);
                  return (
                    <tr key={id} id={`flat-row-${id}`} className={id === highlightId ? "flat-row-flash" : ""}
                      style={{ background: i % 2 ? "var(--surface-2)" : "transparent" }}>
                      {cols.map((k) => (
                        <td key={k} style={{ padding: "0.42rem 0.6rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: numericCol(k) ? "right" : "left", borderTop: "1px solid var(--surface)", color: k === effSort.key ? text : "var(--text-2)", fontFamily: numericCol(k) ? mono : "inherit", fontVariantNumeric: "tabular-nums" }}>
                          {cell(k, r)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {legend && <div style={{ marginTop: "0.5rem", fontSize: "0.72rem", lineHeight: 1.45, color: dim }}>{legend}</div>}
        <style>{`
          @keyframes flatRowFlash {
            0%   { background-color: color-mix(in srgb, var(--accent) 35%, transparent); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 60%, transparent); }
            60%  { background-color: color-mix(in srgb, var(--accent) 12%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent); }
            100% { background-color: transparent; box-shadow: none; }
          }
          .flat-row-flash > td { animation: flatRowFlash 3s ease-out; }
        `}</style>
      </div>

      <FieldPanel
        lang={lang}
        tab={panelTab} setTab={setPanelTab}
        adding={adding} setAdding={setAdding}
        search={search} setSearch={setSearch}
        fields={ff.panelFields}
        catOf={(k) => FLAT_FIELD_BY_KEY[k]?.cat || "other"} catOrder={FLAT_CAT_ORDER} catLabel={FLAT_CAT_LABEL}
        capsOf={ff.capsOf} unitOf={ff.unitOf}
        useValues={ff.useValues}
        filters={ff.filters} onAdd={ff.addFilter} onPatch={ff.patchFilter} onRemove={ff.removeFilter}
        cols={cols} onToggleCol={toggleCol} onSetCols={setCols} defaultCols={defaultCols}
        emptyHint={t("Tabuľka ukazuje všetky byty projektu — pridaj filter tlačidlom vyššie.",
                     "The table shows every flat in the project — add a filter with the button above.")}
      />
    </div>
  );
}
