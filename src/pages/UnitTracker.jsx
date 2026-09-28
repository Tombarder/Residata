/**
 * UnitTracker — "Byt v čase"
 *
 * Per-unit lifecycle view. User picks a project + unit (or up to 20
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
 *   5. Multi-unit compare — pick up to 20 units, plotted together
 *   6. Mini-grid — when project picked but no unit yet, show all
 *      units in project as rows with sparkline; click → expand
 *   7. Searchable picker — "type unit ID", finds across all projects
 *   8. CSV export — one row per (unit, month) for valuers/banks
 *      who paste comparables into their own reports
 */
import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from "react";
import { statusLabel, listingStatus, OFF_LIST } from "../lib/unitStatus";
import Picker from "../components/Picker";
import { useProjects, useUnitSummaries, useUnitHistories, useUnitSearch, useProjectUnitsSeries, useArchiveMonths, useUnitListing } from "../lib/useData";
import { useAccountPrefState } from "../lib/useAccountUiPref";
import { useCapabilities } from "../lib/useCapabilities";
import { track } from "../lib/track";
import { localeTag, formatDimNumber } from "../lib/locale";
import { moneyFromEur, moneySymbol, formatMoney, formatPerM2 as formatPerM2Money } from "../lib/money";
import { useCurrency } from "../lib/useCurrency";
import { useSpecifics, UnitPriceMarks } from "../lib/projectSpecifics";
import FlatWorkbench from "../components/FlatWorkbench";

const mono   = "'JetBrains Mono', monospace";
import { accent as green, accentInk, orange, dim, text, border, bg, surfaceDark as bg2, surfacePanel as panel , orangeInk} from "../lib/theme";
import { fieldBlock } from "../lib/controls";
const yellow = "#f5d142";
const red    = "#ff6b6b";
const blue   = "#5e9bff";

// Status colors — mirror the rest of the platform's V/R/PR/P palette.
const STAV_COLOR = {
  V:  green,
  R:  yellow,
  PR: orange,
  P:  red,
  "Ešte nie v ponuke": dim,
  ERROR: "#ff6b6b88",
  [OFF_LIST]: "#8a8f98",
};
/* Compare-mode line styles. The limit used to be 4 "so the chart stays readable" — a
   design choice, not a technical one: a flat's history is one small cached call, and
   nothing downstream counts the lines. Boss asked for ~20 on 2026-09-28, so the chart
   carries the readability instead: ten hues (the platform's own chart colours), then
   the same ten DASHED — past ten, colour alone cannot keep lines apart and a dash can —
   plus a legend that lifts one line and fades the rest, and a tooltip sorted by value. */
/* No hue a STATUS already uses: the dots on every line are coloured by status (Voľný
   green, Rezervovaný yellow, Predrezervovaný orange, Predaný red), and a red line would
   carry its "sold" dots invisibly. Green stays first — the product's own colour — as
   the chart had it before twenty lines were possible. */
const COMPARE_HUES = [green, blue, "#e84393", "#9b59b6", "#00bcd4", "#c0ca33", "#a1887f", "#3f51b5", "#00897b", "#90a4ae"];
const MAX_COMPARE = COMPARE_HUES.length * 2;
function seriesStyle(i) {
  return { color: COMPARE_HUES[i % COMPARE_HUES.length], dash: i >= COMPARE_HUES.length ? "7 4" : undefined };
}
/* A translucent wash of a colour. `${color}1a` works only for a hex: for the accent,
   which is a CSS variable, it made "var(--accent)1a" — invalid, silently dropped — so
   the first series' chip and every "Voľný" pill drew with no background at all. */
const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** The line a series is drawn with — colour AND dash — so every key matches the chart. */
function SeriesSwatch({ i, width = 20 }) {
  const { color, dash } = seriesStyle(i);
  return (
    <svg width={width} height="6" aria-hidden="true" style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle" }}>
      <line x1="2" y1="3" x2={width - 2} y2="3" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={dash} />
    </svg>
  );
}

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

// Grouped via en-US plus a comma swap until 2026-09-14, which reached the same digits
// by a longer road than every other page. One formatter now.
const formatPrice = formatMoney;
const formatPerM2 = formatPerM2Money;
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
      return d.toLocaleDateString(localeTag(lang), dateOpts);
    }
  }
  // Date-only YYYY-MM-DD (treat as UTC midnight, then format in BA TZ)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T00:00:00Z");
    if (Number.isFinite(d.getTime())) {
      return d.toLocaleDateString(localeTag(lang), dateOpts);
    }
  }
  // Legacy YYYY-MM month bucket — pin to UTC 1st so BA viewers see the
  // expected month (a local-time Date constructor would drift on the
  // first day of the month for the rare DST hour).
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, mm] = s.split("-");
    const dt = new Date(Date.UTC(Number(y), Number(mm) - 1, 1));
    return dt.toLocaleDateString(localeTag(lang), monthOpts);
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
  /* Add several at once — what a filter is FOR on this page: narrow the grid to the
     flats you want side by side, then take them. Stops at the limit, keeps grid order. */
  const addPicks = (keys) => setPickedKeys(prev => {
    const next = [...prev];
    for (const k of keys) {
      if (next.length >= MAX_COMPARE) break;
      if (!next.includes(k)) next.push(k);
    }
    return next;
  });

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
      stav: listingStatus(u),            // the database's verdict — a sold flat that vanished is "P"
      latest_price: u.cena_s_dph,        // already EUR-overlaid by the hook
      series: u.series || null,          // compact EUR price series (grid sparkline); null for search/compare tiles
    };
  }, [projectById]);

  // ── Server-side data (Phase 1: no whole-archive client pull) ──
  //   · PROJECT summaries — the picked project's units (mini-grid + in-place
  //     filter + compare scope). Small + fast (16 kB–1.4 MB).
  //   · COMPARABLE scope — the single picked unit's project, to find its peers.
  //   · GLOBAL search — server-side (unit_search), never loads every unit.
  // Grid data for the selected project: latest state + a compact price series per
  // unit (for the sparkline), in one small jsonb call — not a full-history pull.
  const { units: searchSummaries, loading: loadingSearch } =
    useProjectUnitsSeries(projFilter);

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
  // Enabled whenever no project filter is active — NOT gated on picks, so a user
  // can pick unit A then search for unit B in another project to compare them.
  const globalEnabled = !projFilter;
  const { results: searchHits, loading: loadingHits } =
    useUnitSearch({ query: search, projectIds: matchingProjectIds, enabled: globalEnabled });
  const globalResults = useMemo(() => searchHits.map(toTile).slice(0, 25), [searchHits, toTile]);

  /* The grid's rows: every flat of the chosen project with its own details, taken from
     its LAST OBSERVED row — so a flat that has left the price list keeps its building
     and floor and a "building A" filter still finds it — and the status a reader should
     see (listingStatus: a sold flat that vanished is "Predaný", not the "Voľný" it was
     last seen with). */
  const gridRows = useMemo(
    () => (searchSummaries || []).map((u) => ({
      ...u,
      ...toTile(u),
      id: `${u.project_id}::${u.unit_id}`,
      /* The grid names a flat by its unit_id everywhere — row, chip, chart legend — so
         its filter must too, not by the display label the project page prefers. */
      unit_detail: null,
    })),
    [searchSummaries, toTile]
  );
  const gridRowByKey = useMemo(() => new Map(gridRows.map((r) => [r.key, r])), [gridRows]);

  /* The true status of EVERY picked flat, whichever project it is in — so the chart
     legend and the status card never say "Voľný" about a flat the grid (or the ledger)
     knows is sold. The grid's own rows are the fallback while it loads. */
  const listingByKey = useUnitListing(pickedKeys);
  const listingOf = useCallback(
    (k) => listingByKey.get(k) || gridRowByKey.get(k) || null,
    [listingByKey, gridRowByKey],
  );

  // Remember the Unit-timeline selection per-account, across devices. The flat list's
  // own filters, columns and sort are remembered by the workbench ("unitTimelineFlats").
  useAccountPrefState(
    "unitTimeline",
    { pickedKeys, projFilter, search, yMode },
    (s) => {
      if (Array.isArray(s.pickedKeys)) {
        setPickedKeys(s.pickedKeys.filter((k) => typeof k === "string" && k.includes("::")).slice(0, MAX_COMPARE));
      }
      if (s.projFilter !== undefined) setProjFilter(s.projFilter);
      if (s.search !== undefined) setSearch(s.search);
      if (s.yMode !== undefined) setYMode(s.yMode);
    },
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
      <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, border: "1px solid var(--border)", padding: "1.25rem 1.6rem", marginBottom: "1.5rem", background: "radial-gradient(120% 140% at 2% -20%, rgba(18,185,129,0.13) 0%, transparent 46%), linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, var(--surface)) 0%, var(--bg) 75%)" }}>
        <p style={{ color: dim, fontSize: "0.88rem", lineHeight: 1.55, margin: 0, maxWidth: 720 }}>
          {L(
            `Vyber projekt → klikni na byt a uvidíš jeho cenu, stav a kľúčové udalosti v čase. Chceš porovnať? Klikni na ďalšie byty (max ${MAX_COMPARE} naraz), alebo ich vyfiltruj vpravo a pridaj všetky zobrazené. Dáta pribúdajú každý deň — graf rastie sám.`,
            `Pick a project → click a unit to see its price, status and key events over time. Want to compare? Click more units (up to ${MAX_COMPARE} at once), or filter them on the right and add every one shown. Data grows every day.`
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
            globalResults={globalResults}
            projectById={projectById}
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

          {/* Chart/detail for the selected unit(s) — appears above the grid the
              moment ≥1 unit is selected, so the grid you clicked from stays put
              below (no "list disappeared, where did it go?" jump). */}
          {pickedKeys.length > 0 && (
            <DetailView
              pickedHistories={pickedHistories}
              listingOf={listingOf}
              comparables={comparables}
              loadingDetail={loadingDetail}
              yMode={yMode}
              setYMode={setYMode}
              lang={lang}
              onProjectClick={(pid) => setCurrent && setCurrent(`App:ProjectDetail:${pid}`)}
              onBackToList={null}
            />
          )}

          {/* ONE unit grid — always shown once a project is chosen. Click a tile
              to select it (chart appears above); click more tiles to compare, up
              to MAX_COMPARE. Selected tiles are highlighted; this is the same list
              whether you're picking your first unit or adding a comparison — no
              second grid, no separate "compare" mode (that was the confusing
              duplicate). The filter panel beside it is Databáza bytov's own. */}
          {projFilter && (
            <ProjectFlatList
              project={projectById[projFilter]}
              rows={gridRows}
              loadingScope={loadingScope}
              search={search}
              pickedKeys={pickedKeys}
              togglePick={togglePick}
              addPicks={addPicks}
              lang={lang}
            />
          )}

          {/* Empty state — no project chosen yet */}
          {!projFilter && pickedKeys.length === 0 && (
            <EmptyState lang={lang} canFull={canFull} archiveMonths={archiveMonths} />
          )}
        </>
      )}
    </div>
  );
}

// ── Picker row ──────────────────────────────────────────────────

function PickerRow({ projects, globalResults, projectById, loadingGlobal, pickedKeys, togglePick, clearAll, projFilter, setProjFilter, search, setSearch, lang }) {
  // `globalResults` (from server-side unit_search) shows ONLY when no project is
  // picked (global cross-project search). When a project IS picked, the same
  // search box filters the unit grid in-place — see UnitGrid — so we never show
  // two parallel lists. `allUnits` here are the picked project's summaries, used
  // as the compare sub-search scope.
  const activeProjects = (projects || []).filter(p => (p.status || "active") === "active");

  return (
    <div style={{
      background: `linear-gradient(180deg, ${bg2} 0%, ${bg} 100%)`,
      border: `1px solid ${border}`, borderRadius: 12,
      padding: "1.1rem 1.25rem", marginBottom: "1.25rem",
    }}>
      <style>{`
        /* Two 240px-min columns don't fit a phone — stack them below 640px so the
           picker never forces a horizontal page scroll. */
        @media (max-width: 640px) {
          .ut-picker-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 1fr) minmax(240px, 1fr) auto", gap: "0.85rem", alignItems: "end" }} className="ut-picker-grid">
        <div>
          <label style={{ display: "block", fontSize: "0.68rem", color: dim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.35rem", fontWeight: 600 }}>
            {lang === "sk" ? "Projekt" : "Project"}
          </label>
          <Picker value={projFilter || ""} onChange={(v) => { setProjFilter(v || null); setSearch(""); }} searchable sk={lang === "sk"} ariaLabel={lang === "sk" ? "Projekt" : "Project"}
            options={[{ value: "", label: lang === "sk" ? "— vyber projekt —" : "— pick a project —" }, ...activeProjects.map((p) => ({ value: p.id, label: `${p.name}${p.district ? ` (${p.district})` : ""}` }))]} />
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
            const { color } = seriesStyle(i);
            return (
              <button
                key={k}
                onClick={() => togglePick(k)}
                style={{
                  background: tint(color, 10),
                  border: `1px solid ${color}`,
                  color: text, padding: "0.35rem 0.65rem",
                  borderRadius: 6, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
                  display: "inline-flex", alignItems: "center", gap: "0.45rem",
                }}
                title={lang === "sk" ? "Klikni na odstránenie" : "Click to remove"}
              >
                <SeriesSwatch i={i} width={16} />
                <strong style={{ color: text }}>{r?.unit_id}</strong>
                <span style={{ color: dim, fontSize: "0.7rem" }}>· {r?.project_name?.slice(0, 22)}</span>
                <span style={{ color: dim, marginLeft: "0.15rem" }}>✕</span>
              </button>
            );
          })}
          {/* How to compare: just click more tiles in the grid below. No separate
              "compare mode" — the limit exists only so the chart stays readable. */}
          {pickedKeys.length < MAX_COMPARE && (
            <span style={{ color: dim, fontSize: "0.74rem", fontStyle: "italic", marginLeft: "0.15rem" }}>
              {lang === "sk"
                ? `+ klikni na ďalší byt nižšie na porovnanie (max ${MAX_COMPARE})`
                : `+ click another unit below to compare (max ${MAX_COMPARE})`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Reusable unit tile used in global-search results, mini-grid, and
// compare-mode sub-search. Same visual language across surfaces.
function UnitTile({ unit, isPicked, disabled, onClick, lang, compact = false }) {
  const stavCol = STAV_COLOR[unit.stav] || dim;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: isPicked ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
        border: `1px solid ${isPicked ? green : border}`,
        color: text, cursor: disabled ? "not-allowed" : "pointer",
        padding: compact ? "0.45rem 0.65rem" : "0.65rem 0.85rem",
        borderRadius: 7, fontSize: "0.78rem", fontFamily: "inherit", textAlign: "left",
        opacity: disabled ? 0.4 : 1,
        transition: "border-color 0.12s, background 0.12s",
      }}
      onMouseEnter={e => { if (!disabled && !isPicked) { e.currentTarget.style.borderColor = green; e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 4%, transparent)"; } }}
      onMouseLeave={e => { if (!disabled && !isPicked) { e.currentTarget.style.borderColor = border; e.currentTarget.style.background = "transparent"; } }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.2rem" }}>
        <strong style={{ color: isPicked ? green : text, fontSize: "0.86rem" }}>{unit.unit_id}</strong>
        <span style={{ color: stavCol, fontSize: "0.7rem", fontWeight: 700 }}>{statusLabel(unit.stav, lang, "one")}</span>
      </div>
      <div style={{ fontSize: "0.7rem", color: dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {unit.project_name}
      </div>
      {(unit.izby || unit.obytna_plocha || unit.latest_price) && (
        <div style={{ fontSize: "0.7rem", color: dim, marginTop: "0.25rem" }}>
          {/* Postgres hands `numeric` back as a STRING, so these read "2.0izb" and
              "76.25 m²" — a dot decimal, no space, on a Slovak page. */}
          {unit.izby ? `${formatDimNumber(unit.izby)} izb` : ""}
          {unit.izby && unit.obytna_plocha ? " · " : ""}
          {unit.obytna_plocha ? `${Number(unit.obytna_plocha).toLocaleString(localeTag(lang), { maximumFractionDigits: 1 })} m²` : ""}
          {unit.latest_price ? <span style={{ color: text, marginLeft: "0.5rem", fontWeight: 600, fontFamily: mono }}>{formatPrice(unit.latest_price)}</span> : ""}
        </div>
      )}
    </button>
  );
}

// Shared control box, so the unit search sits level with the project <Picker>
// beside it (they were 6px apart in height, which is what made the row look off).
const selectStyle = { ...fieldBlock };

// ── Detail view (KPIs + chart + status timeline) ────────────────

function DetailView({ pickedHistories, listingOf, comparables, loadingDetail, yMode, setYMode, lang, onProjectClick, onBackToList }) {
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
        <KpiStrip lifecycle={lifecycle} primary={r0} listing={listingOf ? listingOf(primary?.key) : null}
          onProjectClick={onProjectClick} lang={lang} />
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
        listingOf={listingOf}
        comparables={comparables}
        yMode={yMode}
        setYMode={setYMode}
        lang={lang}
      />

      {/* CSV export */}
      <ExportRow pickedHistories={pickedHistories} lang={lang} />
    </>
  );
}

// ── KPI strip ───────────────────────────────────────────────────

function KpiStrip({ lifecycle, primary, listing, onProjectClick, lang }) {
  // What THIS flat's price assumes — its own fit-out level, and the project's
  // payment schedule if it has one.
  const spec = useSpecifics(lang);
  const pk = lifecycle?.last?.project_id || lifecycle?.last?.project_name;
  /* A flat that has LEFT the price list: the status it was last seen with is history,
     not its state (a project that deletes sold flats freezes every one at "Voľný"). Say
     what we do know — when it was last listed, and the ledger's verdict. `listing` is
     the grid's row for this flat; without one (a flat picked from another project's
     search) the strip reads as it always did. */
  const offList = listing?.on_price_list === false;
  const shownStav = offList ? listingStatus(listing) : lifecycle.last.stav;
  const soldByLedger = offList && !lifecycle.sold && listing?.ledger_status === "SOLD";
  const items = [
    {
      label: lang === "sk" ? "Prvýkrát videný" : "First seen",
      value: formatTs(tsOf(lifecycle.first), lang),
      sub: lifecycle.first.cena_s_dph ? formatPrice(lifecycle.first.cena_s_dph) : "—",
      color: text,
    },
    {
      label: lang === "sk" ? "Posledná cena" : "Last price",
      // A price means nothing without what it buys: a shell and a finished flat
      // at the same number are not the same offer (v2/docs/FITOUT_LEVELS.md).
      value: (
        <>
          {formatPrice(lifecycle.last.cena_s_dph)}
          <UnitPriceMarks items={spec.unit(lifecycle.last, pk)} lang={lang} />
        </>
      ),
      sub: lifecycle.last.obytna_plocha && lifecycle.last.cena_s_dph
        ? formatPerM2(lifecycle.last.cena_s_dph / lifecycle.last.obytna_plocha)
        : "—",
      color: accentInk,
    },
    {
      label: lang === "sk" ? "Aktuálny stav" : "Current status",
      value: statusLabel(shownStav, lang, "one"),
      sub: offList
        ? `${lang === "sk" ? "naposledy v cenníku" : "last listed"} ${formatTs(listing.last_seen, lang)}`
        : formatTs(tsOf(lifecycle.last), lang),
      color: STAV_COLOR[shownStav] || text,
    },
    lifecycle.sold ? {
      label: lang === "sk" ? "Predaný" : "Sold",
      value: formatTs(tsOf(lifecycle.sold), lang),
      sub: (
        <>
          {formatPrice(lifecycle.sold.cena_s_dph)}
          <UnitPriceMarks items={spec.unit(lifecycle.sold, pk)} lang={lang} />
        </>
      ),
      color: red,
    } : soldByLedger ? {
      label: lang === "sk" ? "Predaný" : "Sold",
      value: `${lang === "sk" ? "po" : "after"} ${formatTs(listing.last_seen, lang)}`,
      sub: lang === "sk" ? "zmizol z cenníka — počítame ho ako predaný" : "left the price list — counted as sold",
      color: red,
    } : offList ? {
      /* Off the list and NOT counted as sold (withdrawn, renamed, or a sale the ledger has
         not confirmed): "not sold yet" would be a claim we cannot make. */
      label: lang === "sk" ? "Predaný" : "Sold",
      value: "—",
      sub: lang === "sk" ? "stiahnutý z cenníka — predaj nepotvrdený" : "taken off the list — sale not confirmed",
      color: dim,
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
        <strong style={{ color: accentInk, fontSize: "1rem" }}>{primary?.unit_id}</strong>
        <span style={{ color: dim }}>·</span>
        {onProjectClick ? (
          <button
            onClick={() => onProjectClick(primary?.project_id)}
            style={{
              background: "transparent", border: "none", color: text,
              cursor: "pointer", padding: 0, fontSize: "0.85rem", fontFamily: "inherit",
              textDecoration: "underline", textDecorationColor: `color-mix(in srgb, var(--accent) 40%, transparent)`, textUnderlineOffset: "3px",
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
            <span style={{ color: dim }}>{formatDimNumber(primary.izby)} izb</span>
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

function ChartCard({ pickedHistories, listingOf, comparables, yMode, setYMode, lang }) {
  /* The line being looked at — set by hovering its legend entry or the line itself. It
     is drawn on top in full colour and the rest fade, which is what keeps twenty lines
     readable: "against grey elements, coloured ones stick out" (Datawrapper). */
  const [focusKey, setFocusKey] = useState(null);
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
          ? "Tento byt zatiaľ nemá cenové body — prvý pribudne pri zajtrajšej aktualizácii."
          : "No price points for this unit yet — the first one arrives with tomorrow's update."}
      </div>
    );
  }

  const isSinglePoint = allMonths.length === 1;

  // Legend data. stavLbl → lang-aware status name. presentStavs → only the
  // statuses that actually occur in the picked units (so the key shows nothing
  // irrelevant). hasStatusChange → whether any unit ever changed status (the
  // dashed ring on the line marks those points).
  const stavLbl = (s) => statusLabel(s, lang, "one");   // one unit, so the singular
  const presentStavs = ["V", "R", "PR", "P", "Ešte nie v ponuke", "ERROR"].filter(s => pickedHistories.some(h => h.rows.some(r => r.stav === s)));
  const hasStatusChange = pickedHistories.some(h => new Set(h.rows.map(r => r.stav)).size > 1);

  return (
    <div style={{
      background: `linear-gradient(180deg, ${bg2} 0%, ${bg} 100%)`,
      border: `1px solid ${border}`, borderRadius: 12,
      padding: "1.1rem 1.25rem", marginBottom: "1rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <div style={{ fontSize: "0.7rem", color: dim, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 600 }}>
            <span style={{ display: "inline-block", width: 3, height: 12, borderRadius: 2, background: "var(--accent)", marginRight: "0.5rem", verticalAlign: "middle" }} />{lang === "sk" ? "Vývoj ceny v čase" : "Price evolution over time"}
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
            {`${moneySymbol()}/m²`}
          </YModeBtn>
        </div>
      </div>

      <LineChartSVG
        pickedHistories={pickedHistories}
        comparables={comparables}
        focusKey={focusKey}
        setFocusKey={setFocusKey}
        allMonths={allMonths}
        yOf={yOf}
        fmtY={fmtY}
        lang={lang}
      />

      {/* Legend — which coloured line is which unit (+ its current status), and
          what the status dots along each line mean. Replaces the old separate
          status-timeline strip: the line already carries the status over time. */}
      <div style={{ marginTop: "0.95rem", paddingTop: "0.85rem", borderTop: `1px solid ${border}`, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        <div style={{ display: "flex", gap: "0.5rem 1.1rem", flexWrap: "wrap", alignItems: "center" }}>
          {pickedHistories.map((h, hi) => {
            const last = h.rows[h.rows.length - 1];
            // The status the grid shows — a flat that left the price list is not "Voľný".
            const listing = listingOf ? listingOf(h.key) : null;
            const stav = listing ? listingStatus(listing) : last?.stav;
            const scol = STAV_COLOR[stav] || dim;
            const faded = focusKey && focusKey !== h.key;
            return (
              <span key={h.key} onMouseEnter={() => setFocusKey(h.key)} onMouseLeave={() => setFocusKey(null)}
                style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", fontSize: "0.78rem", cursor: "default", opacity: faded ? 0.35 : 1, transition: "opacity 0.12s" }}>
                <SeriesSwatch i={hi} />
                <span style={{ color: text, fontWeight: 600, fontFamily: mono }}>{h.rows[0]?.unit_id}</span>
                {stav && <span style={{ color: scol, fontSize: "0.66rem", fontWeight: 700, padding: "0.05rem 0.4rem", background: tint(scol, 10), borderRadius: 3 }}>{stavLbl(stav)}</span>}
              </span>
            );
          })}
          {pickedHistories.length > 1 && (
            <span style={{ fontSize: "0.7rem", color: dim, fontStyle: "italic" }}>
              {lang === "sk" ? "prejdi myšou na byt — zvýrazní sa jeho čiara" : "hover a unit to highlight its line"}
            </span>
          )}
        </div>
        {presentStavs.length > 0 && (
          <div style={{ display: "flex", gap: "0.85rem", flexWrap: "wrap", alignItems: "center", fontSize: "0.7rem", color: dim }}>
            <span style={{ color: dim, fontWeight: 600 }}>{lang === "sk" ? "Bodky = stav:" : "Dots = status:"}</span>
            {presentStavs.map(s => (
              <span key={s} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: STAV_COLOR[s], display: "inline-block" }}/>
                {stavLbl(s)}
              </span>
            ))}
            {hasStatusChange && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", border: `1.5px dashed ${dim}`, display: "inline-block" }}/>
                {lang === "sk" ? "zmena stavu" : "status change"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Below-chart hints — single-point and comparables */}
      <div style={{ marginTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.74rem" }}>
        {isSinglePoint && (
          <div style={{ color: orangeInk, display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: orange, display: "inline-block" }}/>
            {lang === "sk"
              ? "Zatiaľ 1 záznam — ďalší bod pribudne zajtra a krivka začne mať tvar."
              : "1 record so far — tomorrow adds another point and the line takes shape."}
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
        background: active ? "color-mix(in srgb, var(--accent) 14%, transparent)" : "transparent",
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

function LineChartSVG({ pickedHistories, comparables, focusKey = null, setFocusKey = () => {}, allMonths, yOf, fmtY, lang }) {
  const W = 880;
  const padL = 76, padR = 60, padT = 28;
  const innerW = W - padL - padR;
  /* Past a dozen scrapes the date ticks are set at -35°, and a rotated "05. 8. 2026"
     reaches ~45px below the axis — straight through the axis title, which sat 36px
     down. The bottom margin makes room for the rotated labels it asks for, and the
     drawing grows by the same amount so the plot itself keeps its height. */
  const rotate = allMonths.length > 12 || (allMonths.length > 5 && innerW < 600);
  const padB = rotate ? 84 : 56;
  const innerH = 336;
  const H = padT + innerH + padB;
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

  // Pre-compute picked points (used by both render + hover lookup)
  const pickedPointSets = pickedHistories.map((h, hi) => {
    const { color, dash } = seriesStyle(hi);
    const pts = h.rows.map(r => {
      const x = xPos(tsOf(r));
      const y = yOf(r);
      if (x == null || !Number.isFinite(y)) return null;
      return { x, y: yScale(y), r, rawY: y };
    }).filter(Boolean);
    return { color, dash, pts, key: h.key, hi };
  });
  /* Past six lines a dot on every scrape is noise, not information: keep the ones that
     SAY something — a status change, the latest point, the point under the cursor. The
     focused line (legend or line hover) is drawn last, on top, and carries the endpoint
     labels; with nothing focused they stay on the first flat, as before. */
  const many = pickedPointSets.length > 6;
  const focusIdx = focusKey ? pickedPointSets.findIndex(ps => ps.key === focusKey) : -1;
  const labelIdx = focusIdx >= 0 ? focusIdx : 0;
  const drawOrder = focusIdx >= 0
    ? [...pickedPointSets.filter((_, i) => i !== focusIdx), pickedPointSets[focusIdx]]
    : pickedPointSets;

  // Hovered timestamp (for crosshair)
  const hoveredTs = hoverIdx != null ? allMonths[hoverIdx] : null;
  const hoverX = hoveredTs ? xPos(hoveredTs) : null;

  // Rows aligned with the hovered timestamp across all picked units — highest first,
  // so with twenty flats the tooltip reads as a ranking rather than a pick order.
  const hoverPicked = hoveredTs ? pickedHistories.map((h, hi) => {
    const r = h.rows.find(row => tsOf(row) === hoveredTs);
    return r ? { row: r, hi, key: h.key } : null;
  }).filter(Boolean).sort((a, b) => {
    const av = yOf(a.row), bv = yOf(b.row);
    return (Number.isFinite(bv) ? bv : -Infinity) - (Number.isFinite(av) ? av : -Infinity);
  }) : [];

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
            <stop offset="0%" stopColor="color-mix(in srgb, var(--accent) 4%, transparent)"/>
            <stop offset="100%" stopColor="color-mix(in srgb, var(--accent) 0%, transparent)"/>
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
                {lang === "sk" ? "→ ďalší bod zajtra" : "→ next point tomorrow"}
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
        {drawOrder.map(({ color, dash, pts, key, hi }) => {
          if (pts.length === 0) return null;
          const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
          const focused = hi === focusIdx;
          const faded = focusIdx >= 0 && !focused;
          return (
            <g key={`pick-${key || hi}`} opacity={faded ? 0.16 : 1}>
              <path d={path} stroke={color} strokeWidth={focused ? 3.5 : (many ? 2 : 2.5)} strokeDasharray={dash} fill="none"/>
              {/* A wide invisible twin, so the line itself can be hovered to focus it. */}
              <path d={path} stroke="transparent" strokeWidth="12" fill="none" style={{ pointerEvents: "stroke" }}
                    onMouseEnter={() => setFocusKey(key)} onMouseLeave={() => setFocusKey(null)}/>
              {pts.map((p, i) => {
                const stavCol = STAV_COLOR[p.r.stav] || color;
                const isStavChange = i > 0 && pts[i - 1].r.stav !== p.r.stav;
                const isFirst = i === 0;
                const isLatest = i === pts.length - 1;
                const isHovered = hoveredTs && tsOf(p.r) === hoveredTs;
                // Endpoint values on ONE line only — the focused one, else the first —
                // so labels never pile up; every other value is in the tooltip.
                const showEndpointLabel = (isFirst || isLatest) && !isSinglePoint && hi === labelIdx;
                if (many && !focused && !isLatest && !isStavChange && !isHovered && !showEndpointLabel) return null;
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
                      // Horizontal: first → right of dot, last → left of dot, then
                      // clamp so the box always stays inside the plot (never clipped
                      // by the Y axis or the right edge).
                      let lblX = isFirst ? p.x + 8 : p.x - 8 - lblW;
                      lblX = Math.max(padL + 2, Math.min(lblX, W - padR - lblW - 2));
                      // Vertical: LIFT the label off the line. The data dots sit on
                      // the line, so a label centred on the line gets covered by them
                      // (a flat price = every dot at the label's height). Sit it above
                      // the point; flip below only if that would clip the plot top.
                      const above = p.y - 34 >= padT;
                      const lblCy = above ? p.y - 24 : p.y + 24;
                      const boxEdgeY = above ? lblCy + 10 : lblCy - 10;
                      return (
                        <g>
                          <line x1={p.x} y1={p.y} x2={lblX + lblW / 2} y2={boxEdgeY}
                                stroke={color} strokeWidth="1" opacity="0.35"/>
                          <rect x={lblX} y={lblCy - 10} width={lblW} height={20}
                                fill="var(--surface)" stroke={color} strokeWidth="1" rx="3"/>
                          <text x={lblX + lblW / 2} y={lblCy + 4}
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
        const flipLeft = tooltipPos.x > winW - 300;
        // Placed by its real height: twenty rows are ~490px, which a fixed "flip when
        // within 140px of the bottom" pushed off the screen.
        const estH = 52 + hoverPicked.length * 22;
        let top = tooltipPos.y + 14;
        if (top + estH > winH - 8) top = Math.max(8, tooltipPos.y - 14 - estH);
        return (
        <div style={{
          position: "fixed",
          left: flipLeft ? tooltipPos.x - 14 : tooltipPos.x + 14,
          top,
          transform: flipLeft ? "translateX(-100%)" : undefined,
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
          {hoverPicked.map(({ row, hi, key }, idx) => (
            <div key={key || idx} style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: idx > 0 ? "0.25rem" : 0, opacity: focusIdx >= 0 && hi !== focusIdx ? 0.45 : 1 }}>
              <SeriesSwatch i={hi} width={14} />
              <span style={{ color: key === focusKey ? text : dim, fontSize: "0.72rem", fontWeight: key === focusKey ? 700 : 400 }}>{row.unit_id}</span>
              <span style={{ marginLeft: "auto", fontWeight: 700 }}>{fmtY(yOf(row))}</span>
              <span style={{ color: STAV_COLOR[row.stav] || dim, fontSize: "0.68rem",
                             padding: "0.05rem 0.3rem", border: `1px solid ${STAV_COLOR[row.stav] || dim}`, borderRadius: 3 }}>
                {statusLabel(row.stav, lang, "one")}
              </span>
            </div>
          ))}
        </div>
        );
      })()}
    </div>
  );
}

// ── Mini-grid (project picked, no unit yet) ─────────────────────

// Compact price-trend sparkline for a grid tile. Takes the unit's EUR price
// `series` (from project_units_series) directly — no full-history download.
function MiniSparkline({ series, compact = false }) {
  const values = (series || []).filter(v => Number.isFinite(v));
  if (values.length < 2) return compact ? <span style={{ color: dim }}>—</span> : null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 240, H = 22;
  const denom = Math.max(1, values.length - 1);
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"} ${(i / denom) * W} ${H - ((v - min) / range) * H}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      style={{ width: "100%", height: compact ? 18 : 22, marginTop: compact ? 0 : "0.4rem", display: "block" }}>
      <path d={path} stroke={green} strokeWidth="1.5" fill="none" opacity="0.8" vectorEffect="non-scaling-stroke"/>
    </svg>
  );
}

/* The picked flat's swatch in the list's leading column — the chart's own line. */
const PickSwatch = ({ index }) => <SeriesSwatch i={index} width={16} />;

/* What the list shows before anyone chooses — the tiles' old content, as columns. */
const BVC_DEFAULT_COLS = ["unit_id", "izby", "obytna_plocha", "budova", "poschodie", "cena_s_dph", "price_per_m2", "stav"];

/**
 * Byt v čase's list of a project's flats — THE SAME workbench as the project page and
 * Databáza bytov (filters on every attribute, a column chooser, sort, all remembered per
 * account), plus a column to pick flats for the chart and one with each flat's price
 * trend. Boss, 2026-09-28: "why doesn't Byt v čase have all its attributes but only a
 * few?" — the rows now carry every attribute of the flat's last observation, including
 * flats that have left the price list, with the status the ledger decided for them.
 * The tiles it used to be are one click away and show the columns you chose.
 */
function ProjectFlatList({ project, rows, loadingScope, search, pickedKeys, togglePick, addPicks, lang }) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  /* Filtered by project as well as by the hook: on a project switch the series hook keeps
     the PREVIOUS project's rows until the new ones arrive, and a row from the wrong
     project must never be pickable. Hooks before any early return. */
  const projRows = useMemo(
    () => (project ? (rows || []).filter(u => u.project_id === project.id) : []),
    [rows, project]
  );
  // The search box in the picker row above narrows the same list in place — ONE list.
  const shownRows = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    return q ? projRows.filter(u => String(u.unit_id).toLowerCase().includes(q)) : projRows;
  }, [projRows, search]);

  if (!project) return null;
  const isLoading = loadingScope && projRows.length === 0;
  const pickedCount = pickedKeys.length;
  const room = MAX_COMPARE - pickedCount;

  return (
    <div style={{
      background: `linear-gradient(180deg, ${bg2} 0%, ${bg} 100%)`,
      border: `1px solid ${border}`, borderRadius: 12,
      padding: "1.1rem 1.25rem",
    }}>
      <div style={{ marginBottom: "0.85rem" }}>
        <h3 style={{ fontSize: "1.05rem", fontWeight: 600, color: text, margin: 0, letterSpacing: "-0.01em" }}>
          {project.name}
        </h3>
        <div style={{ fontSize: "0.78rem", color: dim, marginTop: "0.25rem" }}>
          {isLoading
            ? t("Načítavam byty…", "Loading units…")
            : pickedCount > 0
            ? t(`Vybrané ${pickedCount}/${MAX_COMPARE} · klikni na ďalší byt na porovnanie, alebo na vybraný na odobratie`,
                `Selected ${pickedCount}/${MAX_COMPARE} · click another unit to compare, or a selected one to remove`)
            : t(`${projRows.length} bytov · klikni na byt a uvidíš jeho cenu v čase`, `${projRows.length} units · click one to see its price over time`)}
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: "1.2rem", color: dim, fontFamily: mono, fontSize: "0.85rem", textAlign: "center" }}>
          {t("Načítavam byty…", "Loading units…")}
        </div>
      ) : (
        <FlatWorkbench
          rows={shownRows}
          lang={lang}
          prefKey="unitTimelineFlats"
          scopeKey={project.id}
          rowKey={(r) => r.key}
          defaultCols={BVC_DEFAULT_COLS}
          select={{ keys: pickedKeys, onToggle: togglePick, max: MAX_COMPARE, Swatch: PickSwatch, colorOf: (i) => seriesStyle(i).color }}
          extraCols={[{ key: "__trend", label: t("Vývoj ceny", "Price trend"), width: 110, after: "unit_id", render: (r) => <MiniSparkline series={r.series} compact /> }]}
          renderTile={(r, ctx) => <FlatTile unit={r} ctx={ctx} onToggle={togglePick} lang={lang} />}
          toolbar={(shown) => {
            /* What a filter is for on this page: narrow the list, then take what is left. */
            const addable = shown.filter(u => !pickedKeys.includes(u.key));
            if (shown.length >= projRows.length || addable.length === 0 || room <= 0) return null;
            return (
              <button onClick={() => addPicks(addable.map(u => u.key))}
                title={addable.length > room
                  ? t(`Pridá prvých ${room} — porovnať sa dá najviac ${MAX_COMPARE} bytov naraz`, `Adds the first ${room} — at most ${MAX_COMPARE} units compare at once`)
                  : t("Pridá všetky zobrazené byty do grafu", "Adds every unit shown to the chart")}
                style={{ ...fieldBlock, width: "auto", cursor: "pointer", color: accentInk, borderColor: green, fontFamily: mono, fontSize: "0.72rem", fontWeight: 600, whiteSpace: "nowrap", padding: "0.3rem 0.7rem" }}>
                + {t("Porovnať zobrazené", "Compare the units shown")} ({Math.min(addable.length, room)}{addable.length > room ? ` ${t("z", "of")} ${addable.length}` : ""})
              </button>
            );
          }}
          emptyHint={t("Zoznam ukazuje všetky byty projektu — vyfiltruj tie, ktoré chceš porovnať, a pridaj ich tlačidlom hore.",
                       "The list shows every unit in the project — filter the ones you want to compare and add them with the button above.")}
        />
      )}
    </div>
  );
}

/* One flat as a tile: its id, status and trend, and the columns chosen in the panel —
   one choice of columns drives both views. */
function FlatTile({ unit: u, ctx, onToggle, lang }) {
  const t = (sk, en) => (lang === "sk" ? sk : en);
  const { cols, cell, lbl, pickIndex, disabled } = ctx;
  const selected = pickIndex >= 0;
  const selColor = selected ? seriesStyle(pickIndex).color : green;
  const stavCol = STAV_COLOR[u.stav] || dim;
  const attrs = cols.filter((k) => k !== "unit_id" && k !== "stav");
  return (
    <button
      onClick={() => { if (!disabled) onToggle(u.key); }}
      disabled={disabled}
      title={disabled
        ? t(`Naraz sa dá porovnať max ${MAX_COMPARE} bytov — odober jeden na pridanie ďalšieho`, `You can compare at most ${MAX_COMPARE} units — remove one to add another`)
        : (selected ? t("Klikni na odobratie z výberu", "Click to remove from selection") : t("Klikni na výber", "Click to select"))}
      style={{
        width: "100%", height: "100%",
        background: selected ? tint(selColor, 12) : bg2,
        border: `1px solid ${selected ? selColor : border}`,
        color: text, cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        padding: "0.7rem 0.85rem", borderRadius: 8,
        fontSize: "0.8rem", fontFamily: "inherit", textAlign: "left",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
        <strong style={{ color: selected ? selColor : text, fontSize: "0.92rem", letterSpacing: "-0.01em", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          {selected && <SeriesSwatch i={pickIndex} width={14} />}{u.unit_id}
        </strong>
        <span style={{ color: stavCol, fontSize: "0.7rem", fontWeight: 700, padding: "0.1rem 0.4rem", background: tint(stavCol, 10), borderRadius: 3, whiteSpace: "nowrap",
                       border: `1px ${u.on_price_list === false ? "dashed" : "solid"} ${u.on_price_list === false ? stavCol : "transparent"}` }}>
          {statusLabel(u.stav, lang, "one")}
        </span>
      </div>
      {attrs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "0.08rem 0.6rem", fontSize: "0.72rem", lineHeight: 1.45 }}>
          {attrs.map((k) => (
            <Fragment key={k}>
              <span style={{ color: dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lbl(k)}</span>
              <span style={{ color: text, fontFamily: mono, textAlign: "right", whiteSpace: "nowrap" }}>{cell(k, u)}</span>
            </Fragment>
          ))}
        </div>
      )}
      {/* A flat that has left the price list says so, and since when — its price above is
          the last one it was listed at, not a current offer. */}
      {u.on_price_list === false && u.last_seen && (
        <div style={{ fontSize: "0.68rem", color: dim, fontStyle: "italic", marginTop: "0.25rem" }}>
          {t("naposledy v cenníku", "last listed")} {formatTs(u.last_seen, lang)}
        </div>
      )}
      {u.series && u.series.length >= 2 && <MiniSparkline series={u.series} />}
    </button>
  );
}

// ── Empty state ─────────────────────────────────────────────────

function EmptyState({ lang, canFull, archiveMonths }) {
  const months = (archiveMonths || []).length;
  return (
    <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 10, padding: "2.5rem 1.5rem", textAlign: "center" }}>
      <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem", opacity: 0.5 }}>⏱</div>
      <div style={{ fontSize: "1rem", color: text, marginBottom: "0.4rem", fontWeight: 600 }}>
        {lang === "sk" ? "Začni výberom projektu hore" : "Start by picking a project above"}
      </div>
      <div style={{ fontSize: "0.85rem", color: dim, maxWidth: 540, margin: "0 auto", lineHeight: 1.55 }}>
        {lang === "sk"
          ? `Potom klikni na byt a uvidíš vývoj jeho ceny, zmeny stavu, kedy sa prvýkrát objavil a kedy sa predal. Klikni na ďalšie byty (max ${MAX_COMPARE}) na porovnanie.`
          : `Then click a unit to see its price evolution, status changes, when it first appeared and when it sold. Click more units (up to ${MAX_COMPARE}) to compare.`}
      </div>
      {months <= 1 && (
        <div style={{ marginTop: "1rem", fontSize: "0.78rem", color: orangeInk, fontStyle: "italic", maxWidth: 540, margin: "1rem auto 0" }}>
          {lang === "sk"
            ? "Každý deň pribudne nový dátový bod a krivka sa rozšíri."
            : "A new data point lands every day and the curve grows."}
        </div>
      )}
    </div>
  );
}

// ── CSV export ──────────────────────────────────────────────────

function ExportRow({ pickedHistories, lang }) {
  const downloadCsv = () => {
    const head = ["project_id", "project_name", "unit_id", "batch_timestamp", "snapshot_month", "batch_id", "stav", "cena_s_dph", "cena_bez_dph", "obytna_plocha", "izby", "developer", "district", "fitout_level"];
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
          r.fitout_level || "",
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
          background: "transparent", color: accentInk, border: `1px solid color-mix(in srgb, var(--accent) 33%, transparent)`,
          borderRadius: 6, padding: "0.5rem 0.85rem", fontFamily: mono,
          fontSize: "0.78rem", cursor: "pointer",
        }}
      >
        ⬇ CSV ({pickedHistories.reduce((a, h) => a + h.rows.length, 0)} {lang === "sk" ? "riadkov" : "rows"})
      </button>
    </div>
  );
}
