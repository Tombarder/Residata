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
 * The filter state lives in lib/useFlatFilters.
 *
 * Reviewed 2026-09-28 against the table it replaced on the project page, which had
 * two things this first dropped: status / rooms / price filters VISIBLE above the list
 * (added after Boss's own "tam nie je filter, alebo ak je, nejde / nevidno ho") and
 * twelve columns that fit without scrolling sideways. The quick bar and the collapsible
 * panel below are those two, back.
 */
import { useState, useMemo, useRef, useEffect } from "react";
import FieldPanel from "./FieldPanel";
import { useAccountPrefState } from "../lib/useAccountUiPref";
import { moneyFromEur, moneySymbol } from "../lib/money";
import { localeTag, formatDimNumber } from "../lib/locale";
import { statusLabel, OFF_LIST, STATUS_ORDER, offListTitle, offListLegend } from "../lib/unitStatus";
import { useSpecifics, UnitPriceMarks, specificsLegend } from "../lib/projectSpecifics";
import { field as sharedField } from "../lib/controls";
import { accent as green, accentInk, orangeInk, dim, border, bg, text } from "../lib/theme";
import { isFilterActive, summariseFilter, cleanFilterScopes } from "../lib/filterModel";
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
  [OFF_LIST]: { color: "#8a8f98", bg: "rgba(138,143,152,0.10)" },
};

/* A translucent wash of any colour, a CSS variable included. */
const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

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
          + {t("Pridať filter", "Add a filter")}
        </button>
      )}
      {ff.filters.map((f) => {
        const on = isFilterActive(f);
        return (
          <span key={f.id} role="button" tabIndex={0} onClick={() => onOpenPanel(false)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenPanel(false); } }}
            title={t("Upraviť v paneli filtrov", "Edit in the filter panel")}
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
            <button onClick={(e) => { e.stopPropagation(); ff.removeFilter(f.id); }} aria-label={t("Odstrániť filter", "Remove filter")}
              style={{ border: "none", background: "transparent", color: dim, fontSize: "0.78rem", cursor: "pointer", padding: 0 }}>✕</button>
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

/* The one-click filters above the list — status and rooms as pills with their counts,
   price as from / to. They write the SAME filters the panel shows as cards. A group
   with a single value is left out: there is nothing to choose. */
function QuickBar({ ff, rows, lang, keys, priceKey }) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  const groups = useMemo(() => keys.map((key) => {
    const counts = new Map();
    for (const r of rows || []) {
      const v = flatValue(r, key);
      if (v === null || v === undefined || v === "") continue;
      const k = String(v);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    if (counts.size < 2) return null;
    const order = key === "stav" ? [...STATUS_ORDER, OFF_LIST] : null;
    const values = [...counts.keys()].sort(order
      ? (a, b) => ((order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
      : (a, b) => Number(a) - Number(b) || a.localeCompare(b));
    return { key, values, counts };
  }).filter(Boolean), [rows, keys]);
  const priceF = ff.filters.find((f) => f.key === priceKey && f.mode === "between");
  // A price box on a project that publishes no price at all could only ever empty the list.
  const anyPrice = useMemo(() => !!priceKey && (rows || []).some((r) => flatValue(r, priceKey) != null), [rows, priceKey]);
  const pill = (on) => ({
    display: "inline-flex", alignItems: "center", gap: "0.3rem", cursor: "pointer",
    padding: "0.18rem 0.5rem", borderRadius: 999, fontSize: "0.72rem", fontFamily: "inherit",
    border: `1px solid ${on ? green : border}`, background: on ? tint("var(--accent)", 14) : "transparent",
    color: on ? text : "var(--text-2)",
  });
  const lab = { fontFamily: mono, fontSize: "0.62rem", color: dim, textTransform: "uppercase", letterSpacing: "0.08em" };
  const box = { ...sharedField, width: 96, padding: "0.25rem 0.45rem", fontFamily: mono, fontSize: "0.72rem" };
  if (!groups.length && !anyPrice) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem 1.1rem", marginBottom: "0.55rem" }}>
      {groups.map(({ key, values, counts }) => {
        const f = ff.filters.find((x) => x.key === key && x.mode === "in");
        const sel = new Set(f?.values || []);
        return (
          <div key={key} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", flexWrap: "wrap" }}>
            <span style={lab}>{ff.lbl(key)}</span>
            {values.map((v) => (
              <button key={v} onClick={() => ff.toggleValue(key, v)} aria-pressed={sel.has(v)} style={pill(sel.has(v))}>
                {key === "stav" ? statusLabel(v, lang, "many") : (FLAT_FIELD_BY_KEY[key]?.type === "numeric" ? String(formatDimNumber(v)) : ff.valueLabel(key, v))}
                <span style={{ color: dim, fontFamily: mono, fontSize: "0.64rem" }}>{counts.get(v)}</span>
              </button>
            ))}
          </div>
        );
      })}
      {anyPrice && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
          <span style={lab}>{ff.lbl(priceKey)}</span>
          <input type="number" inputMode="numeric" placeholder={t("od", "min")} aria-label={t("Cena od", "Price from")}
            value={priceF?.min ?? ""} onChange={(e) => ff.setRange(priceKey, e.target.value, priceF?.max ?? "")} style={box} />
          <span style={{ color: dim }}>–</span>
          <input type="number" inputMode="numeric" placeholder={t("do", "max")} aria-label={t("Cena do", "Price to")}
            value={priceF?.max ?? ""} onChange={(e) => ff.setRange(priceKey, priceF?.min ?? "", e.target.value)} style={box} />
        </div>
      )}
    </div>
  );
}

/* How wide a column must stay before the table scrolls sideways: a number needs less
   room than a word, and the price needs the most. */
const colMinWidth = (k) => (k === "cena_s_dph" || k === "cena_bez_dph" ? 104
  : k === "unit_id" ? 88
  : FLAT_FIELD_BY_KEY[k]?.type === "numeric" ? 70 : 86);

/* Filters are remembered PER SCOPE (per project): a "building B" filter built on one
   project must not silently empty the next one's list (filterModel.cleanFilterScopes). */
/**
 * The whole workbench: quick filters, chip bar, sortable table (or tiles), and the
 * filters / columns panel.
 *
 * @param rows        flats_current-shaped rows (money in EUR)
 * @param prefKey     the account-preference key its view is remembered under
 * @param scopeKey    what the FILTERS are remembered per (the project); columns, sort,
 *                    view and the panel are remembered for the whole page
 * @param rowKey      row → stable id
 * @param highlightId a row to scroll to and flash (the project page's scatter click)
 * @param quickKeys   fields offered as one-click pills above the list
 * @param select      rows can be PICKED (Byt v čase): { keys, onToggle(key), max,
 *                    Swatch({ index }), colorOf(index) }. Adds a leading column; clicking a
 *                    row (or Enter / Space on it) picks or drops it.
 * @param extraCols   fixed columns beside the chosen ones: [{ key, label, render(row), width, after }] —
 *                    `after` = the chosen column it follows (else it goes last), so a narrow
 *                    screen does not push it off the right edge.
 * @param renderTile  a tile view beside the table: (row, ctx) → node, ctx = { cols, cell, lbl,
 *                    pickIndex, disabled }. Adds a Tabuľka / Dlaždice switch; the tiles show
 *                    the SAME chosen columns, so one choice drives both views.
 * @param toolbar     (shownRows) → node, top right — e.g. "compare the flats shown"
 * @param emptyHint   the panel's line when no filter is set
 */
export default function FlatWorkbench({
  rows, lang = "sk", prefKey, scopeKey = null, rowKey = (r) => r.id, highlightId = null,
  defaultCols = DEFAULT_FLAT_COLS, defaultSort = { key: "unit_id", dir: "asc" },
  quickKeys = ["stav", "izby"], select = null, extraCols = [], renderTile = null, toolbar = null, emptyHint = null,
}) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  const locale = localeTag(lang);
  const ff = useFlatFilters(rows, { lang });
  const spec = useSpecifics(lang);

  const [cols, setCols] = useState(defaultCols);
  const [sort, setSort] = useState(defaultSort);
  const [panelTab, setPanelTab] = useState("filters");
  const [panelOpen, setPanelOpen] = useState(true);
  const [view, setView] = useState("table");
  const [scopes, setScopes] = useState({});
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");

  const scopeK = scopeKey == null || scopeKey === "" ? "_" : String(scopeKey);
  const scopeRef = useRef(scopeK);

  /* Remembered per account, across devices: how you read a flat list (columns, sort,
     view, panel) for the whole page, and the filters you built per project. The search
     box is left out on purpose — see UnitExplorer: a stale word hid most fields. */
  useAccountPrefState(prefKey, { cols, sort, panelTab, panelOpen, view, scopes }, (s) => {
    if (Array.isArray(s.cols)) setCols(s.cols.filter((k) => FLAT_FIELD_BY_KEY[k]));
    if (s.panelTab === "filters" || s.panelTab === "cols") setPanelTab(s.panelTab);
    if (typeof s.panelOpen === "boolean") setPanelOpen(s.panelOpen);
    if (s.sort && typeof s.sort === "object" && FLAT_FIELD_BY_KEY[s.sort.key]) setSort(s.sort);
    if (s.view === "table" || s.view === "tiles") setView(s.view);
    let saved = cleanFilterScopes(s.scopes);
    // the first version (2026-09-28, hours) kept ONE list for every project: adopt it
    // for the project it is being read on rather than lose it
    if (!s.scopes && Array.isArray(s.filters) && s.filters.length) {
      saved = { [scopeRef.current]: { filters: s.filters, rate: null, at: Date.now() } };
    }
    setScopes(saved);
    const mine = saved[scopeRef.current];
    ff.restoreFilters(mine?.filters || [], mine?.rate);
  });

  // A different project: its own filters, or none.
  useEffect(() => {
    if (scopeRef.current === scopeK) return;
    scopeRef.current = scopeK;
    const mine = scopes[scopeK];
    ff.restoreFilters(mine?.filters || [], mine?.rate);
  }, [scopeK]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Filters changed within a project: remember them under it (with the currency they are in).
  const filtersSig = JSON.stringify(ff.filters);
  useEffect(() => {
    setScopes((m) => {
      const k = scopeRef.current;
      const cur = m[k];
      if (cur && JSON.stringify(cur.filters) === filtersSig && cur.rate === ff.rate) return m;
      if (!cur && ff.filters.length === 0) return m;
      const next = { ...m };
      if (ff.filters.length === 0) delete next[k];
      else next[k] = { filters: ff.filters, rate: ff.rate, at: Date.now() };
      return cleanFilterScopes(next);
    });
  }, [filtersSig, ff.rate]);   // eslint-disable-line react-hooks/exhaustive-deps

  const showTiles = !!renderTile && view === "tiles";

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

  /* A flat the developer took off the price list shows the status our sales tracking
     decided for it (the database's rule), in a DASHED pill — so a sold flat reads as sold
     and the reader can still tell it is not one the page lists today. The sentence on
     hover and the legend line are unitStatus's, shared with Databáza bytov. */
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
      const gone = r.on_price_list === false;
      const title = gone ? offListTitle(v, r.last_seen, lang) : undefined;
      return s
        ? <span title={title} style={{ padding: "1px 6px", borderRadius: 4, fontFamily: mono, fontSize: "0.64rem", fontWeight: 600, color: s.color, background: s.bg, border: `1px ${gone ? "dashed" : "solid"} ${gone ? s.color : "transparent"}` }}>{statusLabel(v, lang, "one")}</span>
        : <span title={title}>{statusLabel(v, lang, "one")}</span>;
    }
    if (k === "unit_id") return <strong>{v}</strong>;
    return flatValueLabel(k, v, lang);
  };

  const legend = useMemo(() => {
    const lines = [];
    if (cols.includes("cena_s_dph")) {
      const l = specificsLegend(sorted.map((r) => spec.unit(r, r.project_id || r.project_name)), lang);
      if (l) lines.push(l);
    }
    if (cols.includes("stav") && sorted.some((r) => r.on_price_list === false)) {
      lines.push(offListLegend(lang));
    }
    return lines;
  }, [sorted, spec, cols, lang]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* The panel offers only fields this list actually carries (a project that publishes no
     orientation should not offer an orientation filter that can only ever match nothing),
     plus every chosen column and filtered field, so nothing chosen can go unreachable. */
  const panelFields = useMemo(() => {
    const keep = new Set([...cols, ...ff.filters.map((f) => f.key)]);
    for (const f of ff.panelFields) {
      if (keep.has(f.key)) continue;
      if ((rows || []).some((r) => { const v = flatValue(r, f.key); return v !== null && v !== undefined && v !== ""; })) keep.add(f.key);
    }
    return ff.panelFields.filter((f) => keep.has(f.key));
  }, [ff.panelFields, ff.filters, cols, rows]);

  const openPanel = (add) => { setPanelOpen(true); setPanelTab("filters"); setAdding(!!add); };
  const numericCol = (k) => FLAT_FIELD_BY_KEY[k]?.type === "numeric";

  /* Picking (Byt v čase): the index a row holds in the pick, or -1. */
  const pickIndexOf = (id) => (select ? select.keys.indexOf(id) : -1);
  const pickDisabled = (id) => !!select && pickIndexOf(id) < 0 && select.keys.length >= (select.max ?? Infinity);
  const Swatch = select?.Swatch;
  const colCount = cols.length + (select ? 1 : 0) + extraCols.length;
  /* The table's column order: the chosen columns, each followed by any fixed column that
     asked to sit after it; fixed columns whose anchor is not showing go last. */
  const layout = useMemo(() => {
    const out = [];
    for (const k of cols) {
      out.push({ field: k });
      for (const c of extraCols) if (c.after === k) out.push({ extra: c });
    }
    for (const c of extraCols) if (!c.after || !cols.includes(c.after)) out.push({ extra: c });
    return out;
  }, [cols, extraCols]);
  const tableMin = cols.reduce((a, k) => a + colMinWidth(k), 0) + (select ? 34 : 0) + extraCols.reduce((a, c) => a + (c.width || 96), 0);

  const segBtn = (on) => ({ ...sharedField, width: "auto", cursor: "pointer", fontFamily: mono, fontSize: "0.7rem", padding: "0.3rem 0.65rem",
    color: on ? accentInk : dim, borderColor: on ? green : border, background: on ? tint("var(--accent)", 10) : "transparent" });

  return (
    <div className="rd-workbench">
      <div className="rd-workbench__main">
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
          {renderTile && (
            <div style={{ display: "inline-flex", gap: "0.25rem" }} role="group" aria-label={t("Zobrazenie", "View")}>
              <button onClick={() => setView("table")} aria-pressed={!showTiles} style={segBtn(!showTiles)}>▤ {t("Tabuľka", "Table")}</button>
              <button onClick={() => setView("tiles")} aria-pressed={showTiles} style={segBtn(showTiles)}>▦ {t("Dlaždice", "Tiles")}</button>
            </div>
          )}
          <div style={{ marginLeft: "auto", display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
            {toolbar ? toolbar(sorted) : null}
            {/* The panel folds away: the list then gets the full width, and twelve columns
                fit without scrolling sideways, as they did before the panel existed. */}
            <button onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen} style={segBtn(false)}
              title={panelOpen ? t("Skryť panel filtrov a stĺpcov", "Hide the filters and columns panel") : t("Ukázať panel filtrov a stĺpcov", "Show the filters and columns panel")}>
              {panelOpen ? t("Skryť panel ⟩", "Hide panel ⟩") : t("⟨ Filtre a stĺpce", "⟨ Filters & columns")}
            </button>
          </div>
        </div>
        <QuickBar ff={ff} rows={rows} lang={lang} keys={quickKeys} priceKey="cena_s_dph" />
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
        ) : showTiles ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: "0.55rem",
                        maxHeight: "calc(100vh - 240px)", minHeight: 280, overflowY: "auto", alignContent: "start" }}>
            {sorted.length === 0
              ? <div style={{ gridColumn: "1 / -1", padding: "1.2rem", color: dim, fontStyle: "italic", textAlign: "center" }}>{t("Žiadne byty neprešli filtrami.", "No flats match the filters.")}</div>
              : sorted.map((r) => {
                const id = rowKey(r);
                return <div key={id}>{renderTile(r, { cols, cell, lbl: ff.lbl, pickIndex: pickIndexOf(id), disabled: pickDisabled(id) })}</div>;
              })}
          </div>
        ) : (
          /* Same height as the panel beside it, so the two columns end together. */
          <div ref={scrollRef} style={{ overflow: "auto", maxHeight: "calc(100vh - 206px)", minHeight: 280, border: `1px solid ${border}`, borderRadius: 8, background: panel }}>
            <table style={{ borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", width: "100%", minWidth: tableMin, fontSize: "0.78rem" }}>
              <thead style={{ background: "var(--surface-2)", position: "sticky", top: 0, zIndex: 1 }}>
                <tr>
                  {select && <th style={{ width: 34, borderBottom: `1px solid ${border}` }} aria-label={t("Výber", "Pick")} />}
                  {layout.map(({ field: k, extra: c }) => (c ? (
                    <th key={c.key} style={{ width: c.width || 96, padding: "0.55rem 0.6rem", textAlign: "left", verticalAlign: "bottom", borderBottom: `1px solid ${border}`, color: "var(--text-2)", fontFamily: mono, fontSize: "0.64rem", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700 }}>
                      {c.label}
                    </th>
                  ) : (
                    /* Headers WRAP rather than clip: beside the panel a column is narrow, and
                       "OBYTNÁ PLO…" / "EXTERIÉR (…" told the reader nothing. */
                    <th key={k} onClick={() => toggleSort(k)} title={`${ff.lbl(k)} — ${t("klikni pre zoradenie", "click to sort")}`}
                      /* A fixed-layout table takes its column widths from this row: without
                         them every column got an equal share and the price was cut off
                         ("882 412…") while a one-digit floor column sat half empty. */
                      style={{ width: colMinWidth(k), padding: "0.55rem 0.5rem", textAlign: numericCol(k) ? "right" : "left", verticalAlign: "bottom", whiteSpace: "normal", lineHeight: 1.3, cursor: "pointer", borderBottom: `1px solid ${border}`, color: effSort.key === k ? green : "var(--text-2)", userSelect: "none", fontFamily: mono, fontSize: "0.64rem", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 700 }}>
                      {ff.lbl(k)}{effSort.key === k ? (effSort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr><td colSpan={colCount} style={{ padding: "1.4rem", textAlign: "center", color: dim, fontStyle: "italic" }}>
                    {t("Žiadne byty neprešli filtrami.", "No flats match the filters.")}
                  </td></tr>
                )}
                {sorted.map((r, i) => {
                  const id = rowKey(r);
                  const pi = pickIndexOf(id);
                  const disabled = pickDisabled(id);
                  return (
                    <tr key={id} id={`flat-row-${id}`} className={id === highlightId ? "flat-row-flash" : ""}
                      onClick={select && !disabled ? () => select.onToggle(id) : undefined}
                      tabIndex={select ? 0 : undefined}
                      aria-selected={select ? pi >= 0 : undefined}
                      onKeyDown={select ? (e) => { if ((e.key === "Enter" || e.key === " ") && !disabled) { e.preventDefault(); select.onToggle(id); } } : undefined}
                      title={select ? (disabled
                        ? t(`Naraz sa dá porovnať najviac ${select.max} bytov — odober jeden`, `At most ${select.max} units compare at once — remove one`)
                        : (pi >= 0 ? t("Klikni na odobratie z grafu", "Click to remove from the chart") : t("Klikni na pridanie do grafu", "Click to add to the chart"))) : undefined}
                      style={{ background: pi >= 0 && select?.colorOf ? tint(select.colorOf(pi), 12) : (i % 2 ? "var(--surface-2)" : "transparent"),
                               cursor: select ? (disabled ? "not-allowed" : "pointer") : "default", opacity: disabled ? 0.5 : 1 }}>
                      {select && (
                        <td style={{ padding: "0.42rem 0 0.42rem 0.55rem", borderTop: "1px solid var(--surface)" }}>
                          {pi >= 0 && Swatch
                            ? <Swatch index={pi} />
                            : <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, border: `1px solid ${border}`, verticalAlign: "middle" }} />}
                        </td>
                      )}
                      {layout.map(({ field: k, extra: c }) => (c ? (
                        <td key={c.key} style={{ padding: "0.3rem 0.6rem", borderTop: "1px solid var(--surface)" }}>{c.render(r)}</td>
                      ) : (
                        <td key={k} style={{ padding: "0.42rem 0.5rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: numericCol(k) ? "right" : "left", borderTop: "1px solid var(--surface)", color: k === effSort.key ? text : "var(--text-2)", fontFamily: numericCol(k) ? mono : "inherit", fontVariantNumeric: "tabular-nums" }}>
                          {cell(k, r)}
                        </td>
                      )))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {legend.map((l, i) => <div key={i} style={{ marginTop: "0.5rem", fontSize: "0.72rem", lineHeight: 1.45, color: dim }}>{l}</div>)}
        <style>{`
          @keyframes flatRowFlash {
            0%   { background-color: color-mix(in srgb, var(--accent) 35%, transparent); box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent) 60%, transparent); }
            60%  { background-color: color-mix(in srgb, var(--accent) 12%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 30%, transparent); }
            100% { background-color: transparent; box-shadow: none; }
          }
          .flat-row-flash > td { animation: flatRowFlash 3s ease-out; }
        `}</style>
      </div>

      {panelOpen && (
        <FieldPanel
          lang={lang}
          tab={panelTab} setTab={setPanelTab}
          adding={adding} setAdding={setAdding}
          search={search} setSearch={setSearch}
          fields={panelFields}
          catOf={(k) => FLAT_FIELD_BY_KEY[k]?.cat || "other"} catOrder={FLAT_CAT_ORDER} catLabel={FLAT_CAT_LABEL}
          capsOf={ff.capsOf} unitOf={ff.unitOf}
          useValues={ff.useValues}
          filters={ff.filters} onAdd={ff.addFilter} onPatch={ff.patchFilter} onRemove={ff.removeFilter}
          cols={cols} onToggleCol={toggleCol} onSetCols={setCols} defaultCols={defaultCols}
          emptyHint={emptyHint || t("Tabuľka ukazuje všetky byty projektu — pridaj filter tlačidlom vyššie.",
                                    "The table shows every flat in the project — add a filter with the button above.")}
        />
      )}
    </div>
  );
}
