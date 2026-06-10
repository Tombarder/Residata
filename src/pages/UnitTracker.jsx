/**
 * UnitTracker — "Byt v čase"
 *
 * Per-unit lifecycle view. User picks a project + unit (or up to 4
 * for compare mode), sees the unit's price evolution, status changes,
 * and key events (first listing, sold date) over the batches we have
 * snapshots for.
 *
 * Reads from flats_archive directly: each row is (batch_id,
 * batch_timestamp, snapshot_month, project_id, unit_id, cena_s_dph,
 * stav, ...). Grouping by (project_id, unit_id) and ordering by
 * batch_timestamp yields the time-series for that single unit.
 *
 * Variant X (2026-04): every scraper run becomes its own permanent
 * row in flats_archive under (country, batch_id, project_id, unit_id).
 * That means TWO scrapes in the same calendar month produce TWO points
 * on this chart -- exactly what Boss expected when he asked "why does
 * unit timeline show only one snapshot." The bug was grouping rows by
 * snapshot_month (YYYY-MM), which collapsed Apr 17 / Apr 27 / Apr 29
 * into one bucket. Now we group by batch_timestamp (canonical Variant
 * X time axis) so every batch is its own data point.
 *
 * Surfaces:
 *   1. KPI strip — first seen, last price, current status, sold date
 *   2. Line chart — total price OR €/m² (toggle) over time, with
 *      status-change markers + price-change annotations
 *   3. Status timeline — horizontal coloured strip below chart
 *      (V=green, R=yellow, PR=orange, P=red) per month
 *   4. Comparable units overlay — same project, similar room count +
 *      area, drawn as faint background lines so user sees their
 *      pick in context
 *   5. Multi-unit compare — pick up to 4 units, plotted together
 *   6. Mini-grid — when project picked but no unit yet, show all
 *      units in project as rows with sparkline; click → expand
 *   7. Searchable picker — "type unit ID", finds across all projects
 *   8. CSV export — one row per (unit, month) for valuers/banks
 *      who paste comparables into their own reports
 */
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useProjects, useUnitSummaries, useUnitHistories, useUnitSearch, useArchiveMonths } from "../lib/useData";
import { useCapabilities } from "../lib/useCapabilities";
import { track } from "../lib/track";
import { moneyFromEur, moneySymbol } from "../lib/money";
import { useCurrency } from "../lib/useCurrency";

const mono   = "'JetBrains Mono', monospace";
const green  = "#00e5a0";
const orange = "#f5a623";
const yellow = "#f5d142";
const red    = "#ff6b6b";
const blue   = "#5e9bff";
const dim    = "#8a8a96";
const text   = "#e8e8ed";
const border = "#222228";
const bg     = "#0a0a0b";
const bg2    = "#0e0e10";
const panel  = "#14141a";

// Status colors — mirror the rest of the platform's V/R/PR/P palette.
const STAV_COLOR = {
  V:  green,
  R:  yellow,
  PR: orange,
  P:  red,
  "Ešte nie v ponuke": dim,
  ERROR: "#ff6b6b88",
};
const STAV_LABEL = {
  V:  "Voľný",
  R:  "Rezervovaný",
  PR: "Predrezervovaný",
  P:  "Predaný",
  "Ešte nie v ponuke": "Ešte nie v ponuke",
  ERROR: "Chyba",
};
// Compare-mode line colors — distinct hues, accessible on dark bg.
const COMPARE_PALETTE = [green, orange, blue, "#e84393"];

const MAX_COMPARE = 4;

// ── Helpers ─────────────────────────────────────────────────────

/** The canonical time axis for a flat row.
 *
 *  Variant X (2026-04) made flats_archive append-only with one row per
 *  (country, batch_id, project_id, unit_id). Each batch carries a
 *  `batch_timestamp` (ISO 8601) — the actual scrape time. Multiple
 *  batches can land in the same calendar month (Apr 17 / 27 / 29), so
 *  grouping by `snapshot_month` collapsed them into a single point on
 *  the chart — that's the "only one snapshot" bug Boss reported.
 *
 *  We now key off `batch_timestamp` everywhere. Falls back to
 *  `snapshot_month` for legacy rows missing the timestamp (shouldn't
 *  happen post-Variant-X but safer to keep the fallback than crash on
 *  an old row). */
function tsOf(row) {
  return row?.batch_timestamp || row?.snapshot_month || "";
}

/** Strip diacritics for accent-insensitive matching ("Slnečnice" ~ "Slnecnice"). */
function stripDia(s) {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Compact event summary for a unit's history — first/sold/last. */
function summariseLifecycle(history) {
  if (!history || history.length === 0) return null;
  const first = history[0];
  const last  = history[history.length - 1];
  // Find first 'P' (sold) snapshot — earliest one with stav='P'
  const sold = history.find(h => h.stav === "P");
  // Find first reservation
  const firstReserved = history.find(h => h.stav === "R" || h.stav === "PR");
  return { first, last, sold, firstReserved };
}

/** Decide if comparable: same project, same izby, ±15% area. */
function isComparable(target, candidate) {
  if (target.project_id !== candidate.project_id) return false;
  if (target.unit_id === candidate.unit_id) return false;  // not self
  if (target.izby != null && candidate.izby != null && target.izby !== candidate.izby) return false;
  if (target.obytna_plocha && candidate.obytna_plocha) {
    const ratio = candidate.obytna_plocha / target.obytna_plocha;
    if (ratio < 0.85 || ratio > 1.15) return false;
  }
  return true;
}

function formatPrice(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(moneyFromEur(n)).toLocaleString("en-US").replace(/,/g, " ") + " " + moneySymbol();
}
function formatPerM2(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(moneyFromEur(n)).toLocaleString("en-US").replace(/,/g, " ") + " " + moneySymbol() + "/m²";
}
/** Format the canonical time axis for display.
 *
 *  Accepts either:
 *    - ISO timestamp 'YYYY-MM-DDTHH:MM:SS+ZZ' -> "DD. MMM YYYY" (Slovak: "29. apr 2026")
 *    - Calendar month 'YYYY-MM'                -> "MMM YYYY"     (legacy fallback)
 *
 *  Used on chart axis, KPI strip, hover tooltip, status timeline. After
 *  Variant X every row should have a full timestamp; the YYYY-MM branch
 *  is just defensive. */
function formatTs(ts, lang) {
  if (!ts) return "—";
  const s = String(ts);
  const dateOpts = { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Bratislava" };
  const monthOpts = { month: "short", year: "numeric", timeZone: "Europe/Bratislava" };
  // Full ISO timestamp -> day-precision format (BA-local)
  if (s.length >= 10 && s.includes("T")) {
    const d = new Date(s);
    if (Number.isFinite(d.getTime())) {
      return d.toLocaleDateString(lang === "sk" ? "sk-SK" : "en-US", dateOpts);
    }
  }
  // Date-only YYYY-MM-DD (treat as UTC midnight, then format in BA TZ)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T00:00:00Z");
    if (Number.isFinite(d.getTime())) {
      return d.toLocaleDateString(lang === "sk" ? "sk-SK" : "en-US", dateOpts);
    }
  }
  // Legacy YYYY-MM month bucket — pin to UTC 1st so BA viewers see the
  // expected month (a local-time Date constructor would drift on the
  // first day of the month for the rare DST hour).
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, mm] = s.split("-");
    const dt = new Date(Date.UTC(Number(y), Number(mm) - 1, 1));
    return dt.toLocaleDateString(lang === "sk" ? "sk-SK" : "en-US", monthOpts);
  }
  return s;
}
// Back-compat alias — older callers may still reference formatMonth.
const formatMonth = formatTs;

// ── Main component ──────────────────────────────────────────────

export default function UnitTracker({ lang = "sk", setCurrent }) {
  const L = (sk, en) => lang === "sk" ? sk : en;
  useCurrency(); // subscribe: re-render prices when the currency toggle flips
  const { can } = useCapabilities();
  const canFull = can("view_analytics");

  const { projects, loading: loadingProjects } = useProjects();
  const { months: archiveMonths } = useArchiveMonths();

  const projectById = useMemo(() => {
    const m = {};
    for (const p of projects || []) m[p.id] = p;
    return m;
  }, [projects]);

  // ── UI state ──────────────────────────────────────────────────
  const [pickedKeys, setPickedKeys] = useState([]);   // `${project_id}::${unit_id}` keys
  const [projFilter, setProjFilter] = useState(null); // selected project (picker + mini-grid)
  const [search, setSearch] = useState("");           // unit / project search text
  const [yMode, setYMode] = useState("total");        // chart Y-axis: total price vs €/m²

  const togglePick = (key) => {
    setPickedKeys(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, key];
    });
  };

  const keyProject = (k) => k.slice(0, k.indexOf("::"));

  const toTile = useCallback((u) => {
    const p = projectById[u.project_id];
    return {
      key: `${u.project_id}::${u.unit_id}`,
      project_id: u.project_id,
      project_name: p?.name || u.project_id,
      district: p?.district || null,
      unit_id: u.unit_id,
      izby: u.izby,
      obytna_plocha: u.obytna_plocha,
      latest_stav: u.latest_stav,
      latest_price: u.cena_s_dph,        // already EUR-overlaid by the hook
    };
  }, [projectById]);

  // ── Server-side data (Phase 1: no whole-archive client pull) ──
  //   · PROJECT summaries — the picked project's units (mini-grid + in-place
  //     filter + compare scope). Small + fast (16 kB–1.4 MB).
  //   · COMPARABLE scope — the single picked unit's project, to find its peers.
  //   · GLOBAL search — server-side (unit_search), never loads every unit.
  const { units: searchSummaries, loading: loadingSearch } =
    useUnitSummaries({ projectId: projFilter });

  const cmpProject = pickedKeys.length === 1 ? keyProject(pickedKeys[0]) : null;
  const { units: cmpSummaries, loading: loadingCmp } =
    useUnitSummaries({ projectId: cmpProject });

  // Global cross-project search: server-side + bounded. A project-NAME query is
  // resolved to ids client-side (diacritic-insensitive) so "Slnečnice" still
  // finds that project's units; unit_id is matched server-side by unit_search.
  const matchingProjectIds = useMemo(() => {
    const q = stripDia(search.trim().toLowerCase());
    if (projFilter || q.length < 2) return [];
    return (projects || []).filter(p => stripDia((p.name || "").toLowerCase()).includes(q)).map(p => p.id);
  }, [projects, projFilter, search]);
  const globalEnabled = !projFilter && pickedKeys.length === 0;
  const { results: searchHits, loading: loadingHits } =
    useUnitSearch({ query: search, projectIds: matchingProjectIds, enabled: globalEnabled });
  const globalResults = useMemo(() => searchHits.map(toTile).slice(0, 25), [searchHits, toTile]);

  // Latest-state tiles for search results / mini-grid.
  const allUnits = useMemo(
    () => (searchSummaries || []).map(toTile),
    [searchSummaries, toTile]
  );

  // Enrich raw history rows (from unit_history) with project metadata the UI reads.
  const enrichRows = useCallback((rows) => (rows || []).map(r => {
    const p = projectById[r.project_id];
    return { ...r, project_name: p?.name || r.project_id, district: p?.district || null, developer: p?.developer || null };
  }), [projectById]);

  // Comparables for a single picked unit: same project, same rooms, ±15% area —
  // matched against the picked unit's own project summaries.
  const comparableKeys = useMemo(() => {
    if (pickedKeys.length !== 1) return [];
    const pk = pickedKeys[0];
    const peers = (cmpSummaries || []).map(toTile);
    const primary = peers.find(u => u.key === pk);
    if (!primary) return [];
    const tArea = Number(primary.obytna_plocha) || 0;
    return peers
      .filter(u => u.key !== pk && isComparable(primary, u))
      .map(u => ({ key: u.key, dist: (tArea > 0 && Number(u.obytna_plocha) > 0) ? Math.abs(Number(u.obytna_plocha) - tArea) : Infinity }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 8)
      .map(x => x.key);
  }, [pickedKeys, cmpSummaries, toTile]);

  // Lazy per-unit histories — only for picked + comparable units.
  const historyKeys = useMemo(
    () => Array.from(new Set([...pickedKeys, ...comparableKeys])),
    [pickedKeys, comparableKeys]
  );
  const { historyByKey, loading: loadingHist } = useUnitHistories(historyKeys);

  const pickedHistories = useMemo(
    () => pickedKeys.map(k => ({ key: k, rows: enrichRows(historyByKey.get(k) || []) })),
    [pickedKeys, historyByKey, enrichRows]
  );
  const comparables = useMemo(
    () => comparableKeys
      .map(k => ({ key: k, rows: enrichRows(historyByKey.get(k) || []) }))
      .filter(c => c.rows.length > 0),
    [comparableKeys, historyByKey, enrichRows]
  );

  // Whole screen only blocks on the (cached, fast) projects list now.
  const loading = loadingProjects;
  // Secondary, in-place spinners while a scope / history loads.
  const loadingScope = loadingSearch;
  const loadingDetail = loadingHist || (!!cmpProject && loadingCmp);

  return (
    <div style={{ padding: "1.5rem 2rem 4rem", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: text, margin: 0, letterSpacing: "-0.01em" }}>
          ⏱ {L("Byt v čase", "Unit timeline")}
        </h2>
        <p style={{ color: dim, fontSize: "0.88rem", lineHeight: 1.55, margin: "0.4rem 0 0", maxWidth: 720 }}>
          {L(
            "Vyber projekt a byt, uvidíš vývoj jeho ceny, zmeny stavu, kedy sa prvýkrát objavil a kedy sa predal. Porovnaj až 4 byty naraz. Dáta sa rozširujú každý mesiac — graf rastie sám.",
            "Pick a project + unit to see its price history, status changes, first listing and sold date. Compare up to 4 units side-by-side. Data accumulates monthly — the chart grows on its own."
          )}
        </p>
      </div>

      {loading && (
        <div style={{ color: dim, fontFamily: mono, fontSize: "0.85rem", padding: "2rem 0" }}>
          {L("Načítavam…", "Loading…")}
        </div>
      )}

      {!loading && (
        <>
          <PickerRow
            projects={projects}
            allUnits={allUnits}
            globalResults={globalResults}
            projectById={projectById}
            loadingScope={loadingScope}
            loadingGlobal={loadingHits}
            pickedKeys={pickedKeys}
            togglePick={togglePick}
            clearAll={() => setPickedKeys([])}
            projFilter={projFilter}
            setProjFilter={setProjFilter}
            search={search}
            setSearch={setSearch}
            lang={lang}
          />

          {/* Once user has picked at least 1 unit → detail/compare view */}
          {pickedKeys.length > 0 && (
            <DetailView
              pickedHistories={pickedHistories}
              comparables={comparables}
              loadingDetail={loadingDetail}
              yMode={yMode}
              setYMode={setYMode}
              lang={lang}
              onProjectClick={(pid) => setCurrent && setCurrent(`App:ProjectDetail:${pid}`)}
              onBackToList={projFilter ? () => setPickedKeys([]) : null}
            />
          )}

          {/* When user has picked a project but NO unit → mini-grid.
              Also passes `search` so the SAME search box from the picker
              filters this grid in-place (instead of triggering a separate
              dropdown — that was the duplicate-list confusion). */}
          {pickedKeys.length === 0 && projFilter && (
            <MiniGrid
              project={projectById[projFilter]}
              units={allUnits}
              loadingScope={loadingScope}
              search={search}
              onPick={(key) => setPickedKeys([key])}
              lang={lang}
            />
          )}

          {/* Empty state — no project, no unit picked */}
          {pickedKeys.length === 0 && !projFilter && (
            <EmptyState lang={lang} canFull={canFull} archiveMonths={archiveMonths} />
          )}
        </>
      )}
    </div>
  );
}

// ── Picker row ──────────────────────────────────────────────────

function PickerRow({ projects, allUnits, globalResults, projectById, loadingScope, loadingGlobal, pickedKeys, togglePick, clearAll, projFilter, setProjFilter, search, setSearch, lang }) {
  // `globalResults` (from server-side unit_search) shows ONLY when no project is
  // picked (global cross-project search). When a project IS picked, the same
  // search box filters the mini-grid in-place — see MiniGrid — so we never show
  // two parallel lists. `allUnits` here are the picked project's summaries, used
  // as the compare sub-search scope.
  const activeProjects = (projects || []).filter(p => (p.status || "active") === "active");

  // Sub-state shown for "compare more" mode: when 1+ unit picked AND
  // we're in a project context, show a small "+ Pridať ďalší byt"
  // toggle that opens an inline mini-search SCOPED to that project.
  const [compareSearchOpen, setCompareSearchOpen] = useState(false);
  const compareScope = projFilter
    ? allUnits.filter(u => u.project_id === projFilter && !pickedKeys.includes(u.key))
    : [];
  const compareSearchQ = search.trim().toLowerCase();
  const compareResults = compareSearchOpen
    ? compareScope.filter(u => !compareSearchQ || u.unit_id.toLowerCase().includes(compareSearchQ) || u.project_name.toLowerCase().includes(compareSearchQ)).slice(0, 12)
    : [];

  return (
    <div style={{
      background: `linear-gradient(180deg, ${bg2} 0%, ${bg} 100%)`,
      border: `1px solid ${border}`, borderRadius: 12,
      padding: "1.1rem 1.25rem", marginBottom: "1.25rem",
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(240px, 1fr) auto", gap: "0.85rem", alignItems: "end" }} className="ut-picker-grid">
        <div>
          <label style={{ display: "block", fontSize: "0.68rem", color: dim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.35rem", fontWeight: 600 }}>
            {lang === "sk" ? "Projekt" : "Project"}
          </label>
          <select
            value={projFilter || ""}
            onChange={(e) => { setProjFilter(e.target.value || null); setSearch(""); }}
            style={selectStyle}
          >
            <option value="">{lang === "sk" ? "— vyber projekt —" : "— pick a project —"}</option>
            {activeProjects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.district ? ` (${p.district})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: "block", fontSize: "0.68rem", color: dim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.35rem", fontWeight: 600 }}>
            {projFilter
              ? (lang === "sk" ? "Filtrovať byty v projekte" : "Filter units in project")
              : (lang === "sk" ? "Alebo hľadaj byt naprieč všetkými" : "Or search across all units")}
          </label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={projFilter
              ? (lang === "sk" ? "napr. A2-304" : "e.g. A2-304")
              : (lang === "sk" ? "napr. A2-304 alebo názov projektu" : "e.g. A2-304 or project name")}
            style={selectStyle}
          />
        </div>

        <div>
          {pickedKeys.length > 0 && (
            <button
              onClick={clearAll}
              style={{
                background: "transparent", color: dim, border: `1px solid ${border}`,
                borderRadius: 6, padding: "0.6rem 0.9rem", cursor: "pointer", fontSize: "0.78rem",
                fontFamily: "inherit", whiteSpace: "nowrap",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = red; e.currentTarget.style.borderColor = red; }}
              onMouseLeave={e => { e.currentTarget.style.color = dim; e.currentTarget.style.borderColor = border; }}
            >
              ✕ {lang === "sk" ? "Vyprázdniť" : "Clear"} ({pickedKeys.length})
            </button>
          )}
        </div>
      </div>

      {/* Global search loading hint (the one ~7 MB all-units call, lazy). */}
      {loadingGlobal && !projFilter && search.trim() && globalResults.length === 0 && (
        <div style={{ marginTop: "0.95rem", color: dim, fontFamily: mono, fontSize: "0.78rem" }}>
          {lang === "sk" ? "Hľadám naprieč všetkými bytmi…" : "Searching across all units…"}
        </div>
      )}

      {/* Global search results — ONLY when no project picked + has search query.
          Never shown alongside the mini-grid (which appears when project picked). */}
      {globalResults.length > 0 && (
        <div style={{ marginTop: "0.95rem" }}>
          <div style={{ fontSize: "0.7rem", color: dim, marginBottom: "0.45rem", fontFamily: mono }}>
            {globalResults.length} {lang === "sk" ? "výsledkov · klikni na výber" : "results · click to select"}
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            gap: "0.5rem",
            maxHeight: 320, overflowY: "auto",
          }}>
            {globalResults.map(u => (
              <UnitTile key={u.key} unit={u} isPicked={pickedKeys.includes(u.key)}
                disabled={!pickedKeys.includes(u.key) && pickedKeys.length >= MAX_COMPARE}
                onClick={() => togglePick(u.key)} lang={lang} />
            ))}
          </div>
        </div>
      )}

      {/* Picked chips strip — currently selected units, with a "+ add another"
          button for compare mode (only when project context is active). */}
      {pickedKeys.length > 0 && (
        <div style={{ marginTop: "0.95rem", display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
          {pickedKeys.map((k, i) => {
            const sep = k.indexOf("::");
            const r = { unit_id: k.slice(sep + 2), project_name: projectById[k.slice(0, sep)]?.name };
            const color = COMPARE_PALETTE[i % COMPARE_PALETTE.length];
            return (
              <button
                key={k}
                onClick={() => togglePick(k)}
                style={{
                  background: `${color}1a`,
                  border: `1px solid ${color}`,
                  color: text, padding: "0.35rem 0.65rem",
                  borderRadius: 6, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
                  display: "inline-flex", alignItems: "center", gap: "0.45rem",
                }}
                title={lang === "sk" ? "Klikni na odstránenie" : "Click to remove"}
              >
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, display: "inline-block" }}></span>
                <strong style={{ color: text }}>{r?.unit_id}</strong>
                <span style={{ color: dim, fontSize: "0.7rem" }}>· {r?.project_name?.slice(0, 22)}</span>
                <span style={{ color: dim, marginLeft: "0.15rem" }}>✕</span>
              </button>
            );
          })}
          {/* + Pridať ďalší byt — opens scoped sub-search */}
          {projFilter && pickedKeys.length < MAX_COMPARE && (
            <button
              onClick={() => setCompareSearchOpen(o => !o)}
              style={{
                background: "transparent",
                border: `1px dashed ${green}66`,
                color: green, padding: "0.32rem 0.65rem",
                borderRadius: 6, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {compareSearchOpen
                ? (lang === "sk" ? "✕ zavrieť" : "✕ close")
                : (lang === "sk" ? `+ Pridať ďalší byt na porovnanie` : `+ Add unit to compare`)}
            </button>
          )}
        </div>
      )}

      {/* Compare-mode sub-search — only when explicitly toggled */}
      {compareSearchOpen && projFilter && (
        <div style={{ marginTop: "0.85rem", padding: "0.7rem", background: bg, border: `1px solid ${green}33`, borderRadius: 6 }}>
          <div style={{ fontSize: "0.7rem", color: dim, marginBottom: "0.4rem" }}>
            {lang === "sk" ? `Vyber ďalší byt z projektu (${MAX_COMPARE - pickedKeys.length} zostáva)` : `Pick another unit from project (${MAX_COMPARE - pickedKeys.length} left)`}
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "0.4rem", maxHeight: 240, overflowY: "auto",
          }}>
            {compareResults.length === 0 ? (
              <div style={{ color: dim, fontSize: "0.78rem", fontStyle: "italic", padding: "0.4rem" }}>
                {lang === "sk" ? "Žiadne ďalšie byty pre tento filter." : "No more units in scope."}
              </div>
            ) : compareResults.map(u => (
              <UnitTile key={u.key} unit={u} isPicked={false}
                disabled={pickedKeys.length >= MAX_COMPARE}
                onClick={() => { togglePick(u.key); }} lang={lang} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Reusable unit tile used in global-search results, mini-grid, and
// compare-mode sub-search. Same visual language across surfaces.
function UnitTile({ unit, isPicked, disabled, onClick, lang, compact = false }) {
  const stavCol = STAV_COLOR[unit.latest_stav] || dim;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: isPicked ? "rgba(0,229,160,0.08)" : "transparent",
        border: `1px solid ${isPicked ? green : border}`,
        color: text, cursor: disabled ? "not-allowed" : "pointer",
        padding: compact ? "0.45rem 0.65rem" : "0.65rem 0.85rem",
        borderRadius: 7, fontSize: "0.78rem", fontFamily: "inherit", textAlign: "left",
        opacity: disabled ? 0.4 : 1,
        transition: "border-color 0.12s, background 0.12s",
      }}
      onMouseEnter={e => { if (!disabled && !isPicked) { e.currentTarget.style.borderColor = green; e.currentTarget.style.background = "rgba(0,229,160,0.04)"; } }}
      onMouseLeave={e => { if (!disabled && !isPicked) { e.currentTarget.style.borderColor = border; e.currentTarget.style.background = "transparent"; } }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.2rem" }}>
        <strong style={{ color: isPicked ? green : text, fontSize: "0.86rem" }}>{unit.unit_id}</strong>
        <span style={{ color: stavCol, fontSize: "0.7rem", fontWeight: 700 }}>{unit.latest_stav}</span>
      </div>
      <div style={{ fontSize: "0.7rem", color: dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {unit.project_name}
      </div>
      {(unit.izby || unit.obytna_plocha || unit.latest_price) && (
        <div style={{ fontSize: "0.7rem", color: dim, marginTop: "0.25rem" }}>
          {unit.izby ? `${unit.izby}izb` : ""}
          {unit.izby && unit.obytna_plocha ? " · " : ""}
          {unit.obytna_plocha ? `${unit.obytna_plocha} m²` : ""}
          {unit.latest_price ? <span style={{ color: text, marginLeft: "0.5rem", fontWeight: 600, fontFamily: mono }}>{formatPrice(unit.latest_price)}</span> : ""}
        </div>
      )}
    </button>
  );
}

const selectStyle = {
  width: "100%", padding: "0.55rem 0.7rem",
  background: bg, color: text, border: `1px solid ${border}`,
  borderRadius: 6, fontSize: "0.85rem", fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};

// ── Detail view (KPIs + chart + status timeline) ────────────────

function DetailView({ pickedHistories, comparables, loadingDetail, yMode, setYMode, lang, onProjectClick, onBackToList }) {
  // Single-unit mode for KPIs: take first picked. Multi-unit overlays
  // chart but keeps single KPI strip for the FIRST picked unit (the
  // "primary" focus). Comparables (same project, similar size) are computed
  // upstream from the project's summaries and passed in as { key, rows }.
  const primary = pickedHistories[0];
  const primaryRows = primary?.rows || [];
  const lifecycle = summariseLifecycle(primaryRows);
  const r0 = primaryRows[0];

  // Histories load lazily per picked unit — show a loader until the primary
  // unit's series arrives, so the chart's "no price points" empty state doesn't
  // flash during the fetch.
  if (loadingDetail && primaryRows.length === 0) {
    return (
      <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 12, padding: "1.5rem", color: dim, fontFamily: mono, fontSize: "0.85rem", textAlign: "center" }}>
        {lang === "sk" ? "Načítavam históriu bytu…" : "Loading unit history…"}
      </div>
    );
  }

  return (
    <>
      {/* Back-to-list nav — only when 1 picked + we have a project context */}
      {pickedHistories.length === 1 && onBackToList && (
        <button
          onClick={onBackToList}
          style={{
            background: "transparent", border: "none", color: dim,
            cursor: "pointer", padding: "0.3rem 0", marginBottom: "0.85rem",
            fontFamily: "inherit", fontSize: "0.82rem",
            display: "inline-flex", alignItems: "center", gap: "0.4rem",
          }}
          onMouseEnter={e => { e.currentTarget.style.color = green; }}
          onMouseLeave={e => { e.currentTarget.style.color = dim; }}
        >
          ← {lang === "sk" ? "Späť na zoznam bytov" : "Back to unit list"}
        </button>
      )}

      {/* KPI strip — only meaningful in single-unit mode */}
      {pickedHistories.length === 1 && lifecycle && (
        <KpiStrip lifecycle={lifecycle} primary={r0} onProjectClick={onProjectClick} lang={lang} />
      )}
      {pickedHistories.length > 1 && (
        <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 10, padding: "0.85rem 1.1rem", marginBottom: "1rem", fontSize: "0.82rem", color: text }}>
          {lang === "sk"
            ? `Porovnávaš ${pickedHistories.length} bytov. KPI prehľad zobrazuje len jeden byt — pre detail klikni na jednotlivé byty samostatne.`
            : `Comparing ${pickedHistories.length} units. KPI summary is per-unit — pick a single unit for the full lifecycle detail.`}
        </div>
      )}

      {/* Chart */}
      <ChartCard
        pickedHistories={pickedHistories}
        comparables={comparables}
        yMode={yMode}
        setYMode={setYMode}
        lang={lang}
      />

      {/* Status timeline strip — one row per picked unit */}
      <StatusTimelineCard pickedHistories={pickedHistories} lang={lang} />

      {/* CSV export */}
      <ExportRow pickedHistories={pickedHistories} lang={lang} />
    </>
  );
}

// ── KPI strip ───────────────────────────────────────────────────

function KpiStrip({ lifecycle, primary, onProjectClick, lang }) {
  const items = [
    {
      label: lang === "sk" ? "Prvýkrát videný" : "First seen",
      value: formatTs(tsOf(lifecycle.first), lang),
      sub: lifecycle.first.cena_s_dph ? formatPrice(lifecycle.first.cena_s_dph) : "—",
      color: text,
    },
    {
      label: lang === "sk" ? "Posledná cena" : "Last price",
      value: formatPrice(lifecycle.last.cena_s_dph),
      sub: lifecycle.last.obytna_plocha && lifecycle.last.cena_s_dph
        ? formatPerM2(lifecycle.last.cena_s_dph / lifecycle.last.obytna_plocha)
        : "—",
      color: green,
    },
    {
      label: lang === "sk" ? "Aktuálny stav" : "Current status",
      value: STAV_LABEL[lifecycle.last.stav] || lifecycle.last.stav,
      sub: formatTs(tsOf(lifecycle.last), lang),
      color: STAV_COLOR[lifecycle.last.stav] || text,
    },
    lifecycle.sold ? {
      label: lang === "sk" ? "Predaný" : "Sold",
      value: formatTs(tsOf(lifecycle.sold), lang),
      sub: formatPrice(lifecycle.sold.cena_s_dph),
      color: red,
    } : {
      label: lang === "sk" ? "Predaný" : "Sold",
      value: "—",
      sub: lang === "sk" ? "ešte nepredaný" : "not sold yet",
      color: dim,
    },
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.6rem", marginBottom: "0.85rem" }}>
        {items.map((k, i) => (
          <div key={i} style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "0.7rem 0.95rem" }}>
            <div style={{ fontSize: "0.65rem", color: dim, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.25rem" }}>
              {k.label}
            </div>
            <div style={{ fontSize: "1.05rem", fontWeight: 700, color: k.color, fontFamily: mono }}>
              {k.value}
            </div>
            <div style={{ fontSize: "0.72rem", color: dim, marginTop: "0.18rem" }}>
              {k.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Header row: project / unit identification */}
      <div style={{
        display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.5rem",
        marginBottom: "0.85rem", fontSize: "0.85rem", color: text,
      }}>
        <strong style={{ color: green, fontSize: "1rem" }}>{primary?.unit_id}</strong>
        <span style={{ color: dim }}>·</span>
        {onProjectClick ? (
          <button
            onClick={() => onProjectClick(primary?.project_id)}
            style={{
              background: "transparent", border: "none", color: text,
              cursor: "pointer", padding: 0, fontSize: "0.85rem", fontFamily: "inherit",
              textDecoration: "underline", textDecorationColor: `${green}66`, textUnderlineOffset: "3px",
            }}
            onMouseEnter={e => { e.currentTarget.style.color = green; }}
            onMouseLeave={e => { e.currentTarget.style.color = text; }}
          >
            {primary?.project_name}
          </button>
        ) : (
          <span>{primary?.project_name}</span>
        )}
        {primary?.district && (
          <>
            <span style={{ color: dim }}>·</span>
            <span style={{ color: dim }}>{primary.district}</span>
          </>
        )}
        {primary?.izby && (
          <>
            <span style={{ color: dim }}>·</span>
            <span style={{ color: dim }}>{primary.izby}izb</span>
          </>
        )}
        {primary?.obytna_plocha && (
          <>
            <span style={{ color: dim }}>·</span>
            <span style={{ color: dim }}>{primary.obytna_plocha} m²</span>
          </>
        )}
        {primary?.developer && (
          <>
            <span style={{ color: dim }}>·</span>
            <span style={{ color: dim }}>{primary.developer}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Chart card ──────────────────────────────────────────────────

function ChartCard({ pickedHistories, comparables, yMode, setYMode, lang }) {
  // Y-axis value extractor based on yMode
  const yOf = (row) => {
    if (yMode === "perm2") {
      if (!row.cena_s_dph || !row.obytna_plocha) return null;
      return row.cena_s_dph / row.obytna_plocha;
    }
    return row.cena_s_dph || null;
  };
  const yLabel = yMode === "perm2" ? (lang === "sk" ? "€/m²" : "€/m²") : "€";
  const fmtY  = yMode === "perm2" ? formatPerM2 : formatPrice;

  // X axis: union of ALL batch timestamps — picked + comparable.
  // Each batch is its own data point on the chart (Variant X — every
  // scrape = its own permanent point, NOT collapsed by month).
  const allMonths = useMemo(() => {
    const set = new Set();
    for (const h of pickedHistories) for (const r of h.rows) set.add(tsOf(r));
    for (const c of comparables) for (const r of c.rows) set.add(tsOf(r));
    return Array.from(set).filter(Boolean).sort();
  }, [pickedHistories, comparables]);

  // Y range: include all picked + comparables values
  const yValues = useMemo(() => {
    const out = [];
    for (const h of pickedHistories) for (const r of h.rows) {
      const v = yOf(r);
      if (Number.isFinite(v)) out.push(v);
    }
    for (const c of comparables) for (const r of c.rows) {
      const v = yOf(r);
      if (Number.isFinite(v)) out.push(v);
    }
    return out;
  }, [pickedHistories, comparables, yMode]);

  if (allMonths.length === 0 || yValues.length === 0) {
    return (
      <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 12, padding: "1.5rem", marginBottom: "1rem", color: dim, fontSize: "0.88rem", textAlign: "center" }}>
        {lang === "sk"
          ? "Tento byt nemá zatiaľ žiadne cenové body. Po ďalšom mesačnom syncu bude mať svoj prvý záznam."
          : "No price points yet for this unit. After the next monthly sync it will have its first record."}
      </div>
    );
  }

  const isSinglePoint = allMonths.length === 1;

  return (
    <div style={{
      background: `linear-gradient(180deg, ${bg2} 0%, ${bg} 100%)`,
      border: `1px solid ${border}`, borderRadius: 12,
      padding: "1.1rem 1.25rem", marginBottom: "1rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <div style={{ fontSize: "0.7rem", color: dim, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
            {lang === "sk" ? "Vývoj ceny v čase" : "Price evolution over time"}
          </div>
          <div style={{ fontSize: "0.74rem", color: dim, marginTop: "0.2rem" }}>
            {lang === "sk" ? "X = dátum scrapu · Y = " : "X = scrape date · Y = "}{yMode === "perm2" ? `${moneySymbol()}/m²` : (lang === "sk" ? `celková cena (${moneySymbol()})` : `total price (${moneySymbol()})`)}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.3rem" }}>
          <YModeBtn active={yMode === "total"} onClick={() => setYMode("total")}>
            {lang === "sk" ? "celková cena" : "total"}
          </YModeBtn>
          <YModeBtn active={yMode === "perm2"} onClick={() => setYMode("perm2")}>
            €/m²
          </YModeBtn>
        </div>
      </div>

      <LineChartSVG
        pickedHistories={pickedHistories}
        comparables={comparables}
        allMonths={allMonths}
        yOf={yOf}
        fmtY={fmtY}
        lang={lang}
      />

      {/* Below-chart hints — single-point and comparables */}
      <div style={{ marginTop: "0.85rem", display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.74rem" }}>
        {isSinglePoint && (
          <div style={{ color: orange, display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: orange, display: "inline-block" }}/>
            {lang === "sk"
              ? "Zatiaľ máme len 1 záznam pre tento byt. Pri ďalšom scrape pribudne ďalší bod a krivka začne mať tvar."
              : "Only 1 record for this unit so far. After the next scrape another point will appear and the line will take shape."}
          </div>
        )}
        {comparables.length > 0 && pickedHistories.length === 1 && (
          <div style={{ color: dim, fontStyle: "italic" }}>
            {lang === "sk"
              ? `+${comparables.length} podobných bytov (rovnaký počet izieb, ±15 % plocha) v pozadí ako referencia.`
              : `+${comparables.length} comparable units (same room count, ±15 % area) shown as faint background lines.`}
          </div>
        )}
      </div>
    </div>
  );
}

function YModeBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? "rgba(0,229,160,0.14)" : "transparent",
        border: `1px solid ${active ? green : border}`,
        color: active ? green : dim,
        borderRadius: 5, padding: "0.32rem 0.7rem",
        cursor: "pointer", fontFamily: "inherit", fontSize: "0.72rem",
      }}
    >
      {children}
    </button>
  );
}

// ── Line chart SVG ──────────────────────────────────────────────

/** Convert a batch_timestamp / snapshot_month string to milliseconds since
 *  epoch — used for time-proportional X positioning. Robust to all the
 *  formats we may encounter:
 *    · ISO timestamp:  '2026-04-29T10:32:00+00:00'
 *    · Date only:      '2026-04-29'  (Variant-X derived)
 *    · YYYY-MM legacy: '2026-04'      (pre-Variant-X rows; mid-month proxy) */
function tsToMs(ts) {
  if (!ts) return 0;
  const s = String(ts);
  if (s.includes("T")) {
    const t = new Date(s).getTime();
    if (Number.isFinite(t)) return t;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(s + "T00:00:00Z").getTime();
  }
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split("-");
    // Mid-month so a YYYY-MM legacy row sits roughly between adjacent
    // ISO timestamps in the same series rather than at the start edge.
    return Date.UTC(Number(y), Number(m) - 1, 15);
  }
  return 0;
}

/** Pick a "nice" step size so axis ticks land on round numbers (10/20/50/100…).
 *  Returns the step magnitude given a target of ~5 ticks across the span. */
function niceStep(span, targetSteps = 5) {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const rough = span / targetSteps;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  let nice;
  if (norm < 1.5) nice = 1;
  else if (norm < 3) nice = 2;
  else if (norm < 7) nice = 5;
  else nice = 10;
  return nice * mag;
}

/** Compact thousand-separator formatter for axis tick labels:
 *  580_000 → '580k', 1_250_000 → '1.25M'. */
function fmtCompact(n) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    const v = n / 1_000_000;
    return v.toFixed(2).replace(/\.?0+$/, "") + "M";
  }
  if (abs >= 1_000) {
    const v = n / 1_000;
    return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + "k";
  }
  return Math.round(n).toString();
}

/** Adaptive X-axis tick selector. Returns indices into allMonths to label.
 *  Always includes first + last; remaining ticks are evenly spaced. */
function pickXTicks(allMonths, maxTicks = 6) {
  const n = allMonths.length;
  if (n === 0) return [];
  if (n <= maxTicks) return allMonths.map((_, i) => i);
  const step = (n - 1) / (maxTicks - 1);
  const out = new Set();
  for (let i = 0; i < maxTicks; i++) out.add(Math.round(i * step));
  out.add(0);
  out.add(n - 1);
  return [...out].sort((a, b) => a - b);
}

function LineChartSVG({ pickedHistories, comparables, allMonths, yOf, fmtY, lang }) {
  const W = 880, H = 420;
  const padL = 76, padR = 60, padT = 28, padB = 56;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const isSinglePoint = allMonths.length === 1;
  const svgRef = useRef(null);

  // ── Time-proportional X positioning ─────────────────────────────
  // Spreads points by ACTUAL time delta (Apr 17 → Apr 27 is wider than
  // Apr 27 → Apr 29). Falls back to evenly-spaced indices if all
  // timestamps collapse to the same value (corrupt data).
  const xMin = allMonths.length ? tsToMs(allMonths[0]) : 0;
  const xMax = allMonths.length ? tsToMs(allMonths[allMonths.length - 1]) : 0;
  const xSpan = xMax - xMin;
  const xPos = (ts) => {
    if (allMonths.length === 1) return padL + innerW / 2;
    if (xSpan <= 0) {
      // Fallback: equal spacing by index
      const i = allMonths.indexOf(ts);
      if (i < 0) return null;
      return padL + (innerW / (allMonths.length - 1)) * i;
    }
    const ms = tsToMs(ts);
    return padL + ((ms - xMin) / xSpan) * innerW;
  };

  // ── Y range — picked drives the window, NOT comparables ─────────
  // Comparables are decorative context; we never let them squash
  // picked unit's prominence. If a comparable falls outside the picked
  // window, we clip it (rendered at viewport edge). A small "+N more
  // off-chart" hint shows when that happens.
  const pickedValues = [];
  for (const h of pickedHistories) for (const r of h.rows) {
    const v = yOf(r); if (Number.isFinite(v)) pickedValues.push(v);
  }
  const compValues = [];
  for (const c of comparables) for (const r of c.rows) {
    const v = yOf(r); if (Number.isFinite(v)) compValues.push(v);
  }
  const primary = pickedValues.length ? pickedValues : compValues;
  const pMin = primary.length ? Math.min(...primary) : 0;
  const pMax = primary.length ? Math.max(...primary) : 1;
  const pRange = pMax - pMin;

  // Visibility windowing:
  //   · Single value or near-flat (<2% variation): expand to ±5% of
  //     mid value so dots don't collapse into one horizontal line.
  //   · Otherwise: pad 15% top + 15% bottom for breathing room.
  const flatThreshold = Math.max(pMax * 0.02, 1);
  let rawMin, rawMax;
  if (pRange < flatThreshold) {
    const center = (pMin + pMax) / 2;
    const halfWindow = Math.max(center * 0.05, 1);
    rawMin = center - halfWindow;
    rawMax = center + halfWindow;
  } else {
    rawMin = pMin - pRange * 0.15;
    rawMax = pMax + pRange * 0.15;
  }

  // Comparables: extend window only if the comparable RANGE OVERLAPS
  // the picked range (i.e., they're realistic peers). If a comparable
  // is way off (e.g., picked is 568k and comp is 200k), we DO NOT
  // expand — keeping picked centered. The comparable line just clips
  // at the chart bottom edge.
  if (pickedValues.length && compValues.length) {
    const cMin = Math.min(...compValues);
    const cMax = Math.max(...compValues);
    const pickedSpan = rawMax - rawMin;
    // Allow comparables to widen by at most ±25% of the picked window —
    // anything beyond that is clipped (preserves picked unit's visual
    // dominance).
    const maxExpand = pickedSpan * 0.25;
    if (cMin < rawMin) rawMin = Math.max(cMin, rawMin - maxExpand);
    if (cMax > rawMax) rawMax = Math.min(cMax, rawMax + maxExpand);
  }

  // Round to nice tick boundaries.
  const step = niceStep(rawMax - rawMin);
  const yMin = Math.floor(rawMin / step) * step;
  const yMax = Math.ceil(rawMax / step) * step;
  const yRange = (yMax - yMin) || 1;
  const yScale = (v) => {
    // Clamp to chart area so out-of-range comparables don't bleed.
    const t = padT + innerH - ((v - yMin) / yRange) * innerH;
    return Math.max(padT, Math.min(padT + innerH, t));
  };

  const ticks = [];
  for (let v = yMin; v <= yMax + step / 2; v += step) ticks.push(v);

  // Count off-chart comparables (for the "+N more off-chart" hint)
  const compsOffChart = compValues.filter(v => v < yMin || v > yMax).length;

  // ── Crosshair hover state — Yahoo-Finance style ─────────────────
  // Single hover state covering entire chart area (not per-dot). We
  // find the nearest data point in time-space and snap the crosshair
  // to it. Tooltip shows date + value(s) + status. Mouse-leave clears.
  const [hoverIdx, setHoverIdx] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  function handlePointerAt(clientX, clientY) {
    if (!svgRef.current || allMonths.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const scaleX = W / rect.width;
    const localX = (clientX - rect.left) * scaleX;
    if (localX < padL - 4 || localX > W - padR + 4) {
      setHoverIdx(null);
      return;
    }
    // Find nearest data point in X
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < allMonths.length; i++) {
      const px = xPos(allMonths[i]);
      if (px == null) continue;
      const d = Math.abs(px - localX);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    setHoverIdx(bestIdx);
    setTooltipPos({ x: clientX, y: clientY });
  }
  function handleMouseMove(e) {
    handlePointerAt(e.clientX, e.clientY);
  }
  function handleMouseLeave() { setHoverIdx(null); }
  // Touch support — same crosshair behaviour for mobile users. We
  // intentionally don't preventDefault on touchmove so vertical page
  // scrolling still works; the crosshair is informational, not an
  // interaction target.
  function handleTouchMove(e) {
    const t = e.touches && e.touches[0];
    if (t) handlePointerAt(t.clientX, t.clientY);
  }
  function handleTouchEnd() { setHoverIdx(null); }

  // X-axis ticks (adaptive density)
  const xTickIndices = pickXTicks(allMonths, 6);
  const rotate = allMonths.length > 12 || (allMonths.length > 5 && innerW < 600);

  // Pre-compute picked points (used by both render + hover lookup)
  const pickedPointSets = pickedHistories.map((h, hi) => {
    const color = COMPARE_PALETTE[hi % COMPARE_PALETTE.length];
    const pts = h.rows.map(r => {
      const x = xPos(tsOf(r));
      const y = yOf(r);
      if (x == null || !Number.isFinite(y)) return null;
      return { x, y: yScale(y), r, rawY: y };
    }).filter(Boolean);
    return { color, pts, key: h.key };
  });

  // Hovered timestamp (for crosshair)
  const hoveredTs = hoverIdx != null ? allMonths[hoverIdx] : null;
  const hoverX = hoveredTs ? xPos(hoveredTs) : null;

  // Find rows aligned with hovered timestamp across all picked units
  const hoverPicked = hoveredTs ? pickedHistories.map((h, hi) => {
    const r = h.rows.find(row => tsOf(row) === hoveredTs);
    return r ? { row: r, color: COMPARE_PALETTE[hi % COMPARE_PALETTE.length] } : null;
  }).filter(Boolean) : [];

  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", touchAction: "pan-y" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchMove}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* Soft baseline gradient backdrop for the plot area */}
        <defs>
          <linearGradient id="ut-plot-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(0,229,160,0.04)"/>
            <stop offset="100%" stopColor="rgba(0,229,160,0)"/>
          </linearGradient>
        </defs>
        <rect x={padL} y={padT} width={innerW} height={innerH} fill="url(#ut-plot-bg)" rx="4"/>

        {/* Y gridlines + tick labels (compact: 580k, 1.2M) */}
        {ticks.map((t, i) => (
          <g key={`ytick-${i}`}>
            <line x1={padL} x2={W - padR} y1={yScale(t)} y2={yScale(t)} stroke={border} strokeDasharray="2,4" opacity="0.6"/>
            <text x={padL - 10} y={yScale(t)} fill={dim} fontSize="11" textAnchor="end" dominantBaseline="middle" fontFamily={mono}>
              {fmtCompact(moneyFromEur(t))}
            </text>
          </g>
        ))}

        {/* Comparable units — faint background lines */}
        {comparables.map((c, ci) => {
          const pts = c.rows.map(r => {
            const x = xPos(tsOf(r));
            const y = yOf(r);
            if (x == null || !Number.isFinite(y)) return null;
            return { x, y: yScale(y), r };
          }).filter(Boolean);
          if (pts.length === 0) return null;
          const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
          return (
            <g key={`cmp-${ci}`} opacity="0.18">
              <path d={path} stroke={dim} strokeWidth="1.2" fill="none"/>
              {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2} fill={dim}/>)}
            </g>
          );
        })}

        {/* Off-chart comparable hint (when comparables clipped) */}
        {compsOffChart > 0 && (
          <text x={W - padR - 6} y={padT + 14} fill={dim} fontSize="10"
                textAnchor="end" fontFamily={mono} opacity="0.65">
            {lang === "sk"
              ? `${compsOffChart} bodov porovnateľných mimo grafu`
              : `${compsOffChart} comparable points off-chart`}
          </text>
        )}

        {/* Future-data hint when only a single data point */}
        {isSinglePoint && pickedHistories.length === 1 && pickedHistories[0].rows.length > 0 && (() => {
          const r = pickedHistories[0].rows[0];
          const v = yOf(r);
          if (!Number.isFinite(v)) return null;
          const cx = xPos(tsOf(r));
          const cy = yScale(v);
          if (cx == null) return null;
          return (
            <g opacity="0.45">
              <path d={`M ${cx} ${cy} L ${W - padR - 8} ${cy}`} stroke={green} strokeWidth="1.5" fill="none" strokeDasharray="3,4"/>
              <text x={W - padR - 8} y={cy - 8} fill={green} fontSize="10" textAnchor="end" fontFamily={mono} opacity="0.85">
                {lang === "sk" ? "→ ďalší bod po najbližšom scrape" : "→ next data point after next scrape"}
              </text>
            </g>
          );
        })()}

        {/* Crosshair vertical guide (Yahoo-style) — only when hovering */}
        {hoverX != null && (
          <line x1={hoverX} x2={hoverX} y1={padT} y2={padT + innerH}
                stroke={text} strokeOpacity="0.25" strokeWidth="1" strokeDasharray="3,3" pointerEvents="none"/>
        )}

        {/* Picked unit lines — minimal dots, no inline labels.
            Endpoint values shown only at first + last point. Status
            changes get a colored ring. Hover is handled by the
            chart-wide overlay below, not per-dot, so labels never
            collide regardless of how many batches accumulate. */}
        {pickedPointSets.map(({ color, pts, key }, hi) => {
          if (pts.length === 0) return null;
          const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
          return (
            <g key={`pick-${key || hi}`}>
              <path d={path} stroke={color} strokeWidth="2.5" fill="none"/>
              {pts.map((p, i) => {
                const stavCol = STAV_COLOR[p.r.stav] || color;
                const isStavChange = i > 0 && pts[i - 1].r.stav !== p.r.stav;
                const isFirst = i === 0;
                const isLatest = i === pts.length - 1;
                const isHovered = hoveredTs && tsOf(p.r) === hoveredTs;
                const showEndpointLabel = (isFirst || isLatest) && !isSinglePoint && hi === 0;
                // Endpoint labels only on the FIRST picked unit to avoid
                // label clutter when comparing 4 units. Other picked
                // units rely on tooltip.
                const baseRadius = isLatest ? 5 : (isStavChange ? 5 : 3);
                const radius = isHovered ? baseRadius + 3 : baseRadius;
                return (
                  <g key={i}>
                    {/* Status-change dashed ring */}
                    {isStavChange && (
                      <circle cx={p.x} cy={p.y} r={radius + 4} fill="none" stroke={stavCol} strokeWidth="1.2" strokeDasharray="2,2" opacity="0.6"/>
                    )}
                    {/* Hover highlight ring */}
                    {isHovered && (
                      <circle cx={p.x} cy={p.y} r={radius + 5} fill="none" stroke={color} strokeWidth="1.5" opacity="0.6"/>
                    )}
                    {/* Main dot */}
                    <circle cx={p.x} cy={p.y} r={radius}
                            fill={stavCol} stroke={bg} strokeWidth="1.5"/>
                    {/* Endpoint value label (first + last, primary unit only) */}
                    {showEndpointLabel && (() => {
                      const labelText = fmtCompact(moneyFromEur(p.rawY));
                      const lblW = Math.max(46, labelText.length * 7);
                      // Place label inside chart area: first → right of dot,
                      // last → left of dot, to avoid clipping at edges.
                      const placeRight = isFirst;
                      const lblX = placeRight ? p.x + 8 : p.x - 8 - lblW;
                      return (
                        <g>
                          <rect x={lblX} y={p.y - 10} width={lblW} height={20}
                                fill="rgba(14,14,18,0.95)" stroke={color} strokeWidth="1" rx="3" opacity="0.95"/>
                          <text x={lblX + lblW / 2} y={p.y + 4}
                                fill={text} fontSize="10.5" fontWeight="700" textAnchor="middle" fontFamily={mono}>
                            {labelText}
                          </text>
                        </g>
                      );
                    })()}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* X axis labels — adaptive density (max 6 ticks; first+last always shown) */}
        {xTickIndices.map((i) => {
          const m = allMonths[i];
          const x = xPos(m);
          if (x == null) return null;
          const y = padT + innerH + 18;
          return (
            <text key={`xtick-${i}`} x={x} y={y} fill={text} fontSize="11" fontFamily={mono}
                  textAnchor={rotate ? "end" : "middle"}
                  transform={rotate ? `rotate(-35 ${x} ${y})` : undefined}>
              {formatMonth(m, lang)}
            </text>
          );
        })}

        {/* X axis title */}
        <text x={padL + innerW / 2} y={H - 8} fill={dim} fontSize="10" textAnchor="middle" fontFamily={mono} letterSpacing="0.05em">
          {lang === "sk" ? "DÁTUM SCRAPU" : "SCRAPE DATE"}
        </text>
        {/* Y axis title */}
        <text x={20} y={padT + innerH / 2} fill={dim} fontSize="10" textAnchor="middle" fontFamily={mono}
              letterSpacing="0.05em" transform={`rotate(-90 20 ${padT + innerH / 2})`}>
          {fmtY === formatPerM2 ? `${moneySymbol()}/m²` : (lang === "sk" ? `CENA (${moneySymbol()})` : `PRICE (${moneySymbol()})`)}
        </text>
      </svg>

      {/* Yahoo-style hover tooltip — shows date + value(s) for ALL picked
          units at the snapped timestamp. Pins to the cursor; never blocks
          dot interaction because crosshair is rendered inside the SVG.
          Flips left/up when within ~280×140 px of the right/bottom edge
          so the tooltip never gets clipped at viewport boundaries. */}
      {hoveredTs && hoverPicked.length > 0 && typeof document !== "undefined" && (() => {
        const winW = typeof window !== "undefined" ? window.innerWidth : 1024;
        const winH = typeof window !== "undefined" ? window.innerHeight : 768;
        const flipLeft = tooltipPos.x > winW - 280;
        const flipUp   = tooltipPos.y > winH - 140;
        return (
        <div style={{
          position: "fixed",
          left: flipLeft ? tooltipPos.x - 14 : tooltipPos.x + 14,
          top:  flipUp   ? tooltipPos.y - 14 : tooltipPos.y + 14,
          transform: `${flipLeft ? "translateX(-100%) " : ""}${flipUp ? "translateY(-100%)" : ""}`.trim() || undefined,
          background: "rgba(14, 14, 18, 0.97)",
          border: `1px solid ${border}`,
          borderRadius: 6, padding: "0.55rem 0.8rem",
          fontFamily: mono, fontSize: "0.78rem", color: text,
          pointerEvents: "none", zIndex: 10000,
          boxShadow: "0 6px 18px rgba(0,0,0,0.6)",
          whiteSpace: "nowrap",
          minWidth: 160,
        }}>
          <div style={{ fontWeight: 700, color: text, marginBottom: "0.4rem", borderBottom: `1px solid ${border}`, paddingBottom: "0.3rem" }}>
            {formatTs(hoveredTs, lang)}
          </div>
          {hoverPicked.map(({ row, color: c }, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: idx > 0 ? "0.25rem" : 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: c, flexShrink: 0 }}/>
              <span style={{ color: dim, fontSize: "0.72rem" }}>{row.unit_id}</span>
              <span style={{ marginLeft: "auto", fontWeight: 700 }}>{fmtY(yOf(row))}</span>
              <span style={{ color: STAV_COLOR[row.stav] || dim, fontSize: "0.68rem",
                             padding: "0.05rem 0.3rem", border: `1px solid ${STAV_COLOR[row.stav] || dim}`, borderRadius: 3 }}>
                {row.stav}
              </span>
            </div>
          ))}
        </div>
        );
      })()}
    </div>
  );
}

// ── Status timeline strip ───────────────────────────────────────

function StatusTimelineCard({ pickedHistories, lang }) {
  if (pickedHistories.length === 0) return null;

  return (
    <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 10, padding: "1rem 1.1rem", marginBottom: "1rem" }}>
      <div style={{ fontSize: "0.78rem", color: dim, fontFamily: mono, letterSpacing: "0.04em", textTransform: "uppercase", marginBottom: "0.85rem" }}>
        {lang === "sk" ? "Časová os stavov" : "Status timeline"}
      </div>

      {pickedHistories.map((h, hi) => {
        const r0 = h.rows[0];
        const color = COMPARE_PALETTE[hi % COMPARE_PALETTE.length];
        return (
          <div key={h.key} style={{ marginBottom: hi < pickedHistories.length - 1 ? "0.85rem" : 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }}/>
              <span style={{ fontSize: "0.78rem", color: text, fontWeight: 600 }}>
                {r0?.unit_id} <span style={{ color: dim, fontWeight: 400 }}>· {r0?.project_name}</span>
              </span>
            </div>
            <div style={{ display: "flex", height: 18, borderRadius: 4, overflow: "hidden", border: `1px solid ${border}` }}>
              {h.rows.map((r, i) => {
                const fill = STAV_COLOR[r.stav] || dim;
                return (
                  <div key={i}
                       style={{ flex: 1, background: fill, position: "relative" }}
                       title={`${formatTs(tsOf(r), lang)} · ${STAV_LABEL[r.stav] || r.stav}`}>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Legend */}
      <div style={{ marginTop: "0.85rem", display: "flex", gap: "0.85rem", flexWrap: "wrap", fontSize: "0.7rem", color: dim }}>
        {[
          { stav: "V", label: lang === "sk" ? "Voľný" : "Available" },
          { stav: "R", label: lang === "sk" ? "Rezervovaný" : "Reserved" },
          { stav: "PR", label: lang === "sk" ? "Predrezervovaný" : "Pre-reserved" },
          { stav: "P", label: lang === "sk" ? "Predaný" : "Sold" },
        ].map(it => (
          <span key={it.stav} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
            <span style={{ width: 11, height: 11, borderRadius: 2, background: STAV_COLOR[it.stav], display: "inline-block" }}/>
            {it.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Mini-grid (project picked, no unit yet) ─────────────────────

function MiniGrid({ project, units: scopeUnits, loadingScope, search, onPick, lang }) {
  // Units in this project, from latest-state summaries (one row per unit). The
  // per-unit mini-sparkline was dropped here on purpose: it was the only thing
  // that forced downloading every unit's full history for the whole project
  // (e.g. 56k rows for Slnečnice). Latest price/status is shown instead; the
  // full price curve is one click away. useMemo MUST come before any early
  // return — React enforces hook-call order.
  const units = useMemo(() => {
    if (!project) return [];
    return (scopeUnits || [])
      .filter(u => u.project_id === project.id)
      .slice()
      .sort((a, b) => String(a.unit_id).localeCompare(String(b.unit_id), undefined, { numeric: true }));
  }, [scopeUnits, project]);

  // Apply in-place search filter — same search box that lives in the
  // picker row above filters the grid here, so the user sees ONE list
  // (this grid, narrowed) instead of a dropdown PLUS a grid.
  const filtered = useMemo(() => {
    if (!search?.trim()) return units;
    const q = search.trim().toLowerCase();
    return units.filter(u => String(u.unit_id).toLowerCase().includes(q));
  }, [units, search]);

  if (!project) return null;
  const isLoading = loadingScope && units.length === 0;

  return (
    <div style={{
      background: `linear-gradient(180deg, ${bg2} 0%, ${bg} 100%)`,
      border: `1px solid ${border}`, borderRadius: 12,
      padding: "1.1rem 1.25rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <h3 style={{ fontSize: "1.05rem", fontWeight: 600, color: text, margin: 0, letterSpacing: "-0.01em" }}>
            {project.name}
          </h3>
          <div style={{ fontSize: "0.78rem", color: dim, marginTop: "0.25rem" }}>
            {isLoading
              ? (lang === "sk" ? "Načítavam byty…" : "Loading units…")
              : filtered.length === units.length
              ? (lang === "sk" ? `${units.length} bytov · klikni na byt pre jeho vývoj` : `${units.length} units · click one to open its timeline`)
              : (lang === "sk" ? `${filtered.length} z ${units.length} bytov · upravený filter` : `${filtered.length} of ${units.length} units · filtered`)}
          </div>
        </div>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: "0.55rem",
        maxHeight: 640, overflowY: "auto",
      }}>
        {isLoading ? (
          <div style={{ gridColumn: "1 / -1", padding: "1.2rem", color: dim, fontFamily: mono, fontSize: "0.85rem", textAlign: "center" }}>
            {lang === "sk" ? "Načítavam byty…" : "Loading units…"}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ gridColumn: "1 / -1", padding: "1.2rem", color: dim, fontSize: "0.85rem", fontStyle: "italic", textAlign: "center" }}>
            {lang === "sk" ? "Žiadne byty zodpovedajúce filtru." : "No units match the filter."}
          </div>
        ) : filtered.map(u => {
          const stavCol = STAV_COLOR[u.latest_stav] || dim;
          return (
            <button
              key={u.key}
              onClick={() => onPick(u.key)}
              style={{
                background: bg2, border: `1px solid ${border}`, color: text,
                cursor: "pointer", padding: "0.75rem 0.9rem", borderRadius: 8,
                fontSize: "0.82rem", fontFamily: "inherit", textAlign: "left",
                transition: "border-color 0.15s, background 0.15s, transform 0.12s",
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = green;
                e.currentTarget.style.background = "rgba(0,229,160,0.05)";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = border;
                e.currentTarget.style.background = bg2;
                e.currentTarget.style.transform = "translateY(0)";
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.25rem" }}>
                <strong style={{ color: text, fontSize: "0.92rem", letterSpacing: "-0.01em" }}>{u.unit_id}</strong>
                <span style={{ color: stavCol, fontSize: "0.7rem", fontWeight: 700, padding: "0.1rem 0.4rem", background: `${stavCol}1a`, borderRadius: 3 }}>
                  {u.latest_stav}
                </span>
              </div>
              <div style={{ fontSize: "0.74rem", color: dim, lineHeight: 1.45 }}>
                {u.izby ? `${u.izby}-izb` : ""}
                {u.izby && u.obytna_plocha ? " · " : ""}
                {u.obytna_plocha ? `${u.obytna_plocha} m²` : ""}
                {(u.izby || u.obytna_plocha) && u.latest_price ? <br/> : ""}
                {u.latest_price && (
                  <span style={{ color: text, fontWeight: 600, fontFamily: mono, fontSize: "0.8rem" }}>{formatPrice(u.latest_price)}</span>
                )}
                {u.latest_price && u.obytna_plocha && (
                  <span style={{ color: dim, marginLeft: "0.35rem", fontSize: "0.7rem" }}>· {formatPerM2(u.latest_price / u.obytna_plocha)}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────

function EmptyState({ lang, canFull, archiveMonths }) {
  const months = (archiveMonths || []).length;
  return (
    <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 10, padding: "2.5rem 1.5rem", textAlign: "center" }}>
      <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem", opacity: 0.5 }}>⏱</div>
      <div style={{ fontSize: "1rem", color: text, marginBottom: "0.4rem", fontWeight: 600 }}>
        {lang === "sk" ? "Vyber projekt a byt" : "Pick a project and unit"}
      </div>
      <div style={{ fontSize: "0.85rem", color: dim, maxWidth: 540, margin: "0 auto", lineHeight: 1.55 }}>
        {lang === "sk"
          ? "Môžeš porovnať až 4 byty naraz. Vidíš vývoj ceny, zmeny stavu, kedy sa byt prvýkrát objavil v ponuke a kedy bol predaný."
          : "Compare up to 4 units side-by-side. See price evolution, status changes, when the unit first appeared and when it sold."}
      </div>
      {months <= 1 && (
        <div style={{ marginTop: "1rem", fontSize: "0.78rem", color: orange, fontStyle: "italic", maxWidth: 540, margin: "1rem auto 0" }}>
          {lang === "sk"
            ? "Po každom scrape pribudne nový dátový bod a krivka sa rozšíri."
            : "After each scrape a new data point will appear and the curve will grow."}
        </div>
      )}
    </div>
  );
}

// ── CSV export ──────────────────────────────────────────────────

function ExportRow({ pickedHistories, lang }) {
  const downloadCsv = () => {
    const head = ["project_id", "project_name", "unit_id", "batch_timestamp", "snapshot_month", "batch_id", "stav", "cena_s_dph", "cena_bez_dph", "obytna_plocha", "izby", "developer", "district"];
    const out = [head.join(",")];
    for (const h of pickedHistories) {
      for (const r of h.rows) {
        out.push([
          r.project_id, JSON.stringify(r.project_name || ""), JSON.stringify(r.unit_id || ""),
          r.batch_timestamp || "", r.snapshot_month || "", r.batch_id || "",
          r.stav || "",
          r.cena_s_dph || "", r.cena_bez_dph || "",
          r.obytna_plocha || "", r.izby || "",
          JSON.stringify(r.developer || ""), JSON.stringify(r.district || ""),
        ].join(","));
      }
    }
    const csv = out.join("\n");
    // UTF-8 BOM so Windows Excel renders SK diacritics ("Petržalka",
    // "Staré Mesto") instead of "Petr�alka" / "Star� Mesto".
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `residata-unit-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    try { track("csv_exported", { type: "unit_timeline", row_count: pickedHistories.reduce((a, h) => a + h.rows.length, 0) }); } catch (_) {}
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
      <button onClick={downloadCsv}
        style={{
          background: "transparent", color: green, border: `1px solid ${green}55`,
          borderRadius: 6, padding: "0.5rem 0.85rem", fontFamily: mono,
          fontSize: "0.78rem", cursor: "pointer",
        }}
      >
        ⬇ CSV ({pickedHistories.reduce((a, h) => a + h.rows.length, 0)} {lang === "sk" ? "riadkov" : "rows"})
      </button>
    </div>
  );
}
