/**
 * UnitTracker — "Byt v čase"
 *
 * Per-unit lifecycle view. User picks a project + unit (or up to 4
 * for compare mode), sees the unit's price evolution, status changes,
 * and key events (first listing, sold date) over the months we have
 * snapshots for.
 *
 * Reads from flats_archive directly: each row is (snapshot_month,
 * project_id, unit_id, cena_s_dph, stav, ...). Grouping by
 * (project_id, unit_id) and ordering by snapshot_month yields the
 * time-series for that single unit.
 *
 * Today (2026-04-28) flats_archive only has the April snapshot, so
 * every unit shows just one data point — but the page is built so it
 * grows automatically as monthly syncs accumulate. After 6 months
 * users see real curves; after 12+, full lifecycle stories.
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
import { useState, useMemo, useEffect, useRef } from "react";
import { useProjects, useFlatsArchive, useArchiveMonths } from "../lib/useData";
import { useCapabilities } from "../lib/useCapabilities";

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

/** Group flats_archive rows by (project_id, unit_id) and order by
 *  snapshot_month asc within each group. Returns Map<key, rows[]>. */
function groupByUnit(flats) {
  const map = new Map();
  for (const f of flats) {
    if (!f.project_id || !f.unit_id) continue;
    const key = `${f.project_id}::${f.unit_id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(f);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => String(a.snapshot_month).localeCompare(String(b.snapshot_month)));
  }
  return map;
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
  return Math.round(n).toLocaleString("en-US").replace(/,/g, " ") + " €";
}
function formatPerM2(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US").replace(/,/g, " ") + " €/m²";
}
function formatMonth(m, lang) {
  if (!m) return "—";
  const [y, mm] = String(m).split("-");
  const dt = new Date(Number(y), Number(mm) - 1, 1);
  return dt.toLocaleDateString(lang === "sk" ? "sk-SK" : "en-US", { month: "short", year: "numeric" });
}

// ── Main component ──────────────────────────────────────────────

export default function UnitTracker({ lang = "sk", setCurrent }) {
  const L = (sk, en) => lang === "sk" ? sk : en;
  const { can } = useCapabilities();
  const canFull = can("view_analytics");

  const { projects, loading: loadingProjects } = useProjects();
  const { flats, loading: loadingFlats } = useFlatsArchive();
  const { months: archiveMonths } = useArchiveMonths();

  const projectById = useMemo(() => {
    const m = {};
    for (const p of projects || []) m[p.id] = p;
    return m;
  }, [projects]);

  // Enrich flats with project metadata so cards/charts can show name
  const enriched = useMemo(() => {
    if (!flats?.length) return [];
    return flats.map(f => {
      const p = projectById[f.project_id];
      return {
        ...f,
        project_name: p?.name || f.project_id,
        district:     p?.district || null,
        developer:    p?.developer || null,
      };
    });
  }, [flats, projectById]);

  const byUnit = useMemo(() => groupByUnit(enriched), [enriched]);

  // Picked units — array of `${project_id}::${unit_id}` keys
  const [pickedKeys, setPickedKeys] = useState([]);
  // Project filter (for picker scope and mini-grid)
  const [projFilter, setProjFilter] = useState(null);
  // Search across all units
  const [search, setSearch] = useState("");
  // Y-axis mode: total price vs €/m²
  const [yMode, setYMode] = useState("total");

  // Reset picks if user changes project filter
  const togglePick = (key) => {
    setPickedKeys(prev => {
      if (prev.includes(key)) return prev.filter(k => k !== key);
      if (prev.length >= MAX_COMPARE) return prev;
      return [...prev, key];
    });
  };

  // Histories of all picked units, in order picked.
  const pickedHistories = useMemo(
    () => pickedKeys.map(k => ({ key: k, rows: byUnit.get(k) || [] })),
    [pickedKeys, byUnit]
  );

  const loading = loadingProjects || loadingFlats;

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

      {loading && <div style={{ color: dim, fontFamily: mono, fontSize: "0.85rem", padding: "2rem 0" }}>{L("Načítavam…", "Loading…")}</div>}

      {!loading && (
        <>
          <PickerRow
            projects={projects}
            byUnit={byUnit}
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
          {pickedHistories.length > 0 && (
            <DetailView
              pickedHistories={pickedHistories}
              byUnit={byUnit}
              archiveMonths={archiveMonths}
              yMode={yMode}
              setYMode={setYMode}
              lang={lang}
              onProjectClick={(pid) => setCurrent && setCurrent(`App:ProjectDetail:${pid}`)}
            />
          )}

          {/* When user has picked a project but NO unit → mini-grid */}
          {pickedHistories.length === 0 && projFilter && (
            <MiniGrid
              project={projectById[projFilter]}
              byUnit={byUnit}
              onPick={(key) => setPickedKeys([key])}
              lang={lang}
            />
          )}

          {/* Empty state — no project, no unit picked */}
          {pickedHistories.length === 0 && !projFilter && (
            <EmptyState lang={lang} canFull={canFull} archiveMonths={archiveMonths} />
          )}
        </>
      )}
    </div>
  );
}

// ── Picker row ──────────────────────────────────────────────────

function PickerRow({ projects, byUnit, pickedKeys, togglePick, clearAll, projFilter, setProjFilter, search, setSearch, lang }) {
  // Search across all units (project_id::unit_id keys + display label).
  const allUnits = useMemo(() => {
    const out = [];
    for (const [key, rows] of byUnit) {
      const r0 = rows[0];
      out.push({
        key,
        project_id: r0.project_id,
        project_name: r0.project_name,
        unit_id: r0.unit_id,
        district: r0.district,
        izby: r0.izby,
        obytna_plocha: r0.obytna_plocha,
        latest_stav: rows[rows.length - 1].stav,
      });
    }
    return out;
  }, [byUnit]);

  // When a project filter is active, scope search results to that project.
  const visibleUnits = useMemo(() => {
    let arr = allUnits;
    if (projFilter) arr = arr.filter(u => u.project_id === projFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      arr = arr.filter(u =>
        u.unit_id.toLowerCase().includes(q) ||
        u.project_name.toLowerCase().includes(q)
      );
    }
    return arr.slice(0, 25);  // cap dropdown
  }, [allUnits, projFilter, search]);

  const activeProjects = (projects || []).filter(p => (p.status || "active") === "active");

  return (
    <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 10, padding: "1rem 1.1rem", marginBottom: "1.25rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0.75rem", alignItems: "end" }} className="ut-picker-grid">
        <div>
          <label style={{ display: "block", fontSize: "0.7rem", color: dim, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.3rem" }}>
            {lang === "sk" ? "Projekt" : "Project"}
          </label>
          <select
            value={projFilter || ""}
            onChange={(e) => setProjFilter(e.target.value || null)}
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
          <label style={{ display: "block", fontSize: "0.7rem", color: dim, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.3rem" }}>
            {lang === "sk" ? "Hľadať byt" : "Search unit"}
          </label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === "sk" ? "napr. A2-304 alebo Slnečnice" : "e.g. A2-304 or project name"}
            style={selectStyle}
          />
        </div>

        <div>
          {pickedKeys.length > 0 && (
            <button
              onClick={clearAll}
              style={{
                background: "transparent", color: dim, border: `1px solid ${border}`,
                borderRadius: 6, padding: "0.55rem 0.85rem", cursor: "pointer", fontSize: "0.78rem",
                fontFamily: "inherit",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = red; e.currentTarget.style.borderColor = red; }}
              onMouseLeave={e => { e.currentTarget.style.color = dim; e.currentTarget.style.borderColor = border; }}
            >
              ✕ {lang === "sk" ? "Vyprázdniť" : "Clear"} ({pickedKeys.length})
            </button>
          )}
        </div>
      </div>

      {/* Unit results dropdown — only when search query OR project picked AND no unit picked yet, OR multi-compare */}
      {(search.trim() || (projFilter && pickedKeys.length < MAX_COMPARE)) && visibleUnits.length > 0 && (
        <div style={{ marginTop: "0.85rem" }}>
          <div style={{ fontSize: "0.7rem", color: dim, marginBottom: "0.4rem" }}>
            {lang === "sk"
              ? `${visibleUnits.length} bytov · klikni na pridanie (max ${MAX_COMPARE})`
              : `${visibleUnits.length} units · click to add (max ${MAX_COMPARE})`}
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: "0.4rem",
            maxHeight: 280, overflowY: "auto",
            background: bg, border: `1px solid ${border}`, borderRadius: 6, padding: "0.5rem",
          }}>
            {visibleUnits.map(u => {
              const isPicked = pickedKeys.includes(u.key);
              const stavCol = STAV_COLOR[u.latest_stav] || dim;
              return (
                <button
                  key={u.key}
                  onClick={() => togglePick(u.key)}
                  disabled={!isPicked && pickedKeys.length >= MAX_COMPARE}
                  style={{
                    background: isPicked ? "rgba(0,229,160,0.10)" : "transparent",
                    border: `1px solid ${isPicked ? green : border}`,
                    color: text, cursor: pickedKeys.length >= MAX_COMPARE && !isPicked ? "not-allowed" : "pointer",
                    padding: "0.5rem 0.7rem", borderRadius: 5,
                    fontSize: "0.78rem", fontFamily: "inherit", textAlign: "left",
                    opacity: !isPicked && pickedKeys.length >= MAX_COMPARE ? 0.4 : 1,
                  }}
                >
                  <div style={{ fontWeight: 600, color: isPicked ? green : text }}>
                    {u.unit_id}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: dim, marginTop: "0.15rem", display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.project_name}</span>
                    <span style={{ color: stavCol, whiteSpace: "nowrap" }}>{u.latest_stav}</span>
                  </div>
                  {(u.izby || u.obytna_plocha) && (
                    <div style={{ fontSize: "0.66rem", color: dim, marginTop: "0.1rem" }}>
                      {u.izby ? `${u.izby}izb · ` : ""}{u.obytna_plocha ? `${u.obytna_plocha}m²` : ""}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Picked chips strip — shows currently selected units */}
      {pickedKeys.length > 0 && (
        <div style={{ marginTop: "0.85rem", display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
          {pickedKeys.map((k, i) => {
            const rows = byUnit.get(k) || [];
            const r = rows[0];
            const color = COMPARE_PALETTE[i % COMPARE_PALETTE.length];
            return (
              <button
                key={k}
                onClick={() => togglePick(k)}
                style={{
                  background: `${color}1a`,
                  border: `1px solid ${color}`,
                  color: text, padding: "0.32rem 0.6rem",
                  borderRadius: 5, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit",
                  display: "inline-flex", alignItems: "center", gap: "0.4rem",
                }}
                title={lang === "sk" ? "Klikni na odstránenie" : "Click to remove"}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }}></span>
                <strong style={{ color: text }}>{r?.unit_id}</strong>
                <span style={{ color: dim, fontSize: "0.7rem" }}>· {r?.project_name?.slice(0, 20)}</span>
                <span style={{ color: dim, marginLeft: "0.2rem" }}>✕</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const selectStyle = {
  width: "100%", padding: "0.55rem 0.7rem",
  background: bg, color: text, border: `1px solid ${border}`,
  borderRadius: 6, fontSize: "0.85rem", fontFamily: "inherit",
  outline: "none", boxSizing: "border-box",
};

// ── Detail view (KPIs + chart + status timeline) ────────────────

function DetailView({ pickedHistories, byUnit, archiveMonths, yMode, setYMode, lang, onProjectClick }) {
  // Single-unit mode for KPIs: take first picked. Multi-unit overlays
  // chart but keeps single KPI strip for the FIRST picked unit (the
  // "primary" focus). User-feedback iterating possible.
  const primary = pickedHistories[0];
  const primaryRows = primary?.rows || [];
  const lifecycle = summariseLifecycle(primaryRows);
  const r0 = primaryRows[0];

  // Comparables: only when 1 unit picked. Find similar units in same
  // project. Drawn as faint background lines on the chart.
  const comparables = useMemo(() => {
    if (pickedHistories.length !== 1 || !r0) return [];
    const matches = [];
    for (const [key, rows] of byUnit) {
      if (key === primary.key) continue;
      const candidate = rows[0];
      if (isComparable(r0, candidate)) {
        matches.push({ key, rows });
      }
    }
    return matches.slice(0, 8);  // cap to keep chart readable
  }, [pickedHistories, byUnit, primary, r0]);

  return (
    <>
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
        archiveMonths={archiveMonths}
        yMode={yMode}
        setYMode={setYMode}
        lang={lang}
      />

      {/* Status timeline strip — one row per picked unit */}
      <StatusTimelineCard pickedHistories={pickedHistories} archiveMonths={archiveMonths} lang={lang} />

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
      value: formatMonth(lifecycle.first.snapshot_month, lang),
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
      sub: formatMonth(lifecycle.last.snapshot_month, lang),
      color: STAV_COLOR[lifecycle.last.stav] || text,
    },
    lifecycle.sold ? {
      label: lang === "sk" ? "Predaný" : "Sold",
      value: formatMonth(lifecycle.sold.snapshot_month, lang),
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

function ChartCard({ pickedHistories, comparables, archiveMonths, yMode, setYMode, lang }) {
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

  // X axis: union of ALL months — picked + comparable — but at least
  // archiveMonths is the source of truth for "available data".
  const allMonths = useMemo(() => {
    const set = new Set();
    for (const h of pickedHistories) for (const r of h.rows) set.add(r.snapshot_month);
    for (const c of comparables) for (const r of c.rows) set.add(r.snapshot_month);
    return Array.from(set).sort();
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
      <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 10, padding: "1.2rem", marginBottom: "1rem", color: dim, fontSize: "0.85rem", textAlign: "center" }}>
        {lang === "sk"
          ? "Tento byt nemá zatiaľ žiadne cenové body. Po ďalšom mesačnom syncu bude mať svoj prvý záznam."
          : "No price points yet for this unit. After the next monthly sync it will have its first record."}
      </div>
    );
  }

  return (
    <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 10, padding: "1rem 1.1rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.85rem", flexWrap: "wrap", gap: "0.4rem" }}>
        <div style={{ fontSize: "0.78rem", color: dim, fontFamily: mono, letterSpacing: "0.04em", textTransform: "uppercase" }}>
          {lang === "sk" ? "Vývoj ceny" : "Price evolution"} · {yLabel}
        </div>
        <div style={{ display: "flex", gap: "0.3rem" }}>
          <YModeBtn active={yMode === "total"} onClick={() => setYMode("total")}>
            {lang === "sk" ? "celková cena" : "total price"}
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

      {comparables.length > 0 && pickedHistories.length === 1 && (
        <div style={{ marginTop: "0.5rem", fontSize: "0.7rem", color: dim, fontStyle: "italic" }}>
          {lang === "sk"
            ? `+${comparables.length} podobných bytov v rovnakom projekte (rovnaký počet izieb, ±15 % plocha) v pozadí.`
            : `+${comparables.length} comparable units in same project (same room count, ±15 % area) shown in background.`}
        </div>
      )}
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

function LineChartSVG({ pickedHistories, comparables, allMonths, yOf, fmtY, lang }) {
  const W = 880, H = 360;
  const padL = 70, padR = 24, padT = 24, padB = allMonths.length > 8 ? 80 : 50;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const monthIdx = useMemo(() => {
    const m = {};
    allMonths.forEach((mo, i) => { m[mo] = i; });
    return m;
  }, [allMonths]);

  // Y range
  const allValues = [];
  for (const h of pickedHistories) for (const r of h.rows) {
    const v = yOf(r); if (Number.isFinite(v)) allValues.push(v);
  }
  for (const c of comparables) for (const r of c.rows) {
    const v = yOf(r); if (Number.isFinite(v)) allValues.push(v);
  }
  const minV = Math.min(...allValues);
  const maxV = Math.max(...allValues);
  const range = maxV - minV || 1;
  // Pad Y by 8% top + bottom for breathing room
  const yMin = minV - range * 0.08;
  const yMax = maxV + range * 0.08;
  const yRange = yMax - yMin;

  const yScale = (v) => padT + innerH - ((v - yMin) / yRange) * innerH;
  const xPos = (mo) => {
    const i = monthIdx[mo];
    if (i == null) return null;
    if (allMonths.length === 1) return padL + innerW / 2;
    return padL + (innerW / (allMonths.length - 1)) * i;
  };

  // Y ticks — 4 evenly spaced
  const ticks = [yMin, yMin + yRange * 0.25, yMin + yRange * 0.5, yMin + yRange * 0.75, yMax];

  const [hover, setHover] = useState(null);
  const rotate = allMonths.length > 8;

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {/* Y gridlines + ticks */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yScale(t)} y2={yScale(t)} stroke={border} strokeDasharray="2,3"/>
            <text x={padL - 8} y={yScale(t)} fill={dim} fontSize="11" textAnchor="end" dominantBaseline="middle" fontFamily={mono}>
              {fmtY(t).replace(/\s?€\/m²/, "").replace(/\s?€/, "")}
            </text>
          </g>
        ))}

        {/* Comparable units — faint background lines */}
        {comparables.map((c, ci) => {
          const pts = c.rows.map(r => {
            const x = xPos(r.snapshot_month);
            const y = yOf(r);
            if (x == null || !Number.isFinite(y)) return null;
            return { x, y: yScale(y), r };
          }).filter(Boolean);
          if (pts.length === 0) return null;
          const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
          return (
            <g key={`cmp-${ci}`} opacity="0.18">
              <path d={path} stroke={dim} strokeWidth="1.5" fill="none"/>
              {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={dim}/>)}
            </g>
          );
        })}

        {/* Picked unit lines */}
        {pickedHistories.map((h, hi) => {
          const color = COMPARE_PALETTE[hi % COMPARE_PALETTE.length];
          const pts = h.rows.map(r => {
            const x = xPos(r.snapshot_month);
            const y = yOf(r);
            if (x == null || !Number.isFinite(y)) return null;
            return { x, y: yScale(y), r };
          }).filter(Boolean);
          if (pts.length === 0) return null;
          const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
          return (
            <g key={`pick-${hi}`}>
              <path d={path} stroke={color} strokeWidth="2.5" fill="none"/>
              {pts.map((p, i) => {
                const stavCol = STAV_COLOR[p.r.stav] || color;
                const isStavChange = i > 0 && pts[i - 1].r.stav !== p.r.stav;
                const isPriceChange = i > 0 &&
                  Number.isFinite(yOf(pts[i - 1].r)) && Number.isFinite(yOf(p.r)) &&
                  Math.abs(yOf(pts[i - 1].r) - yOf(p.r)) / yOf(pts[i - 1].r) > 0.01;
                return (
                  <g key={i}
                     onMouseEnter={(e) => setHover({ row: p.r, color, mouseX: e.clientX, mouseY: e.clientY })}
                     onMouseMove={(e) => setHover(h0 => h0 ? { ...h0, mouseX: e.clientX, mouseY: e.clientY } : h0)}
                     onMouseLeave={() => setHover(null)}
                     style={{ cursor: "pointer" }}>
                    <circle cx={p.x} cy={p.y} r="14" fill="transparent"/>
                    <circle cx={p.x} cy={p.y} r={isStavChange ? 7 : 5} fill={stavCol} stroke={bg} strokeWidth="2"/>
                    {/* Status-change marker: small ring around */}
                    {isStavChange && (
                      <circle cx={p.x} cy={p.y} r="11" fill="none" stroke={stavCol} strokeWidth="1.5" strokeDasharray="2,2"/>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* X axis labels */}
        {allMonths.map((m, i) => {
          const x = padL + (allMonths.length === 1 ? innerW / 2 : (innerW / (allMonths.length - 1)) * i);
          const y = padT + innerH + 16;
          return (
            <text key={i} x={x} y={y} fill={text} fontSize="11" fontFamily={mono}
                  textAnchor={rotate ? "end" : "middle"}
                  transform={rotate ? `rotate(-35 ${x} ${y})` : undefined}>
              {formatMonth(m, lang)}
            </text>
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hover && typeof document !== "undefined" && (
        <div style={{
          position: "fixed",
          left: hover.mouseX + 14, top: hover.mouseY + 14,
          background: "rgba(14, 14, 18, 0.97)",
          border: `1px solid ${hover.color}`,
          borderRadius: 6, padding: "0.55rem 0.8rem",
          fontFamily: mono, fontSize: "0.78rem", color: text,
          pointerEvents: "none", zIndex: 10000,
          boxShadow: "0 6px 18px rgba(0,0,0,0.6)",
          whiteSpace: "nowrap",
        }}>
          <div style={{ fontWeight: 700, color: hover.color }}>{formatMonth(hover.row.snapshot_month, lang)}</div>
          <div style={{ marginTop: "0.18rem" }}>{fmtY(yOf(hover.row))}</div>
          <div style={{ color: STAV_COLOR[hover.row.stav] || dim, fontSize: "0.7rem", marginTop: "0.18rem" }}>
            {STAV_LABEL[hover.row.stav] || hover.row.stav}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Status timeline strip ───────────────────────────────────────

function StatusTimelineCard({ pickedHistories, archiveMonths, lang }) {
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
                       title={`${formatMonth(r.snapshot_month, lang)} · ${STAV_LABEL[r.stav] || r.stav}`}>
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

function MiniGrid({ project, byUnit, onPick, lang }) {
  // Collect all units in this project. useMemo MUST come before any
  // conditional early return — React enforces hook-call order.
  const units = useMemo(() => {
    if (!project) return [];
    const out = [];
    for (const [key, rows] of byUnit) {
      if (rows[0]?.project_id === project.id) {
        out.push({ key, rows });
      }
    }
    out.sort((a, b) => String(a.rows[0].unit_id).localeCompare(String(b.rows[0].unit_id), undefined, { numeric: true }));
    return out;
  }, [byUnit, project]);

  if (!project) return null;

  return (
    <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 10, padding: "1rem 1.1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.85rem" }}>
        <div>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, color: text, margin: 0 }}>
            {project.name} <span style={{ color: dim, fontSize: "0.85rem", fontWeight: 400 }}>· {units.length} {lang === "sk" ? "bytov" : "units"}</span>
          </h3>
          <div style={{ fontSize: "0.74rem", color: dim, marginTop: "0.2rem" }}>
            {lang === "sk" ? "Klikni na byt pre detail jeho vývoja" : "Click a unit to open its lifecycle"}
          </div>
        </div>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: "0.5rem",
        maxHeight: 600, overflowY: "auto",
      }}>
        {units.map(u => {
          const r0 = u.rows[0];
          const last = u.rows[u.rows.length - 1];
          const stavCol = STAV_COLOR[last.stav] || dim;
          return (
            <button
              key={u.key}
              onClick={() => onPick(u.key)}
              style={{
                background: "transparent", border: `1px solid ${border}`, color: text,
                cursor: "pointer", padding: "0.6rem 0.8rem", borderRadius: 6,
                fontSize: "0.8rem", fontFamily: "inherit", textAlign: "left",
                transition: "border-color 0.12s, background 0.12s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = green; e.currentTarget.style.background = "rgba(0,229,160,0.04)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.background = "transparent"; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.5rem" }}>
                <strong style={{ color: text }}>{r0.unit_id}</strong>
                <span style={{ color: stavCol, fontSize: "0.72rem", fontWeight: 700 }}>{last.stav}</span>
              </div>
              <div style={{ fontSize: "0.7rem", color: dim, marginTop: "0.2rem" }}>
                {r0.izby ? `${r0.izby}izb · ` : ""}{r0.obytna_plocha ? `${r0.obytna_plocha} m²` : ""}
                {last.cena_s_dph && (
                  <span style={{ color: text, marginLeft: "0.4rem" }}>{formatPrice(last.cena_s_dph)}</span>
                )}
              </div>
              {/* Mini-sparkline — when there are 2+ data points, show line shape */}
              {u.rows.length >= 2 && (
                <MiniSparkline rows={u.rows} />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MiniSparkline({ rows }) {
  const values = rows.map(r => r.cena_s_dph).filter(v => Number.isFinite(v));
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const W = 240, H = 22;
  const xs = (i) => (i / (rows.length - 1)) * W;
  const ys = (v) => H - ((v - min) / range) * H;
  const path = rows.map((r, i) => {
    const v = r.cena_s_dph;
    if (!Number.isFinite(v)) return null;
    return `${i === 0 ? "M" : "L"} ${xs(i)} ${ys(v)}`;
  }).filter(Boolean).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 22, marginTop: "0.4rem", display: "block" }}>
      <path d={path} stroke={green} strokeWidth="1.5" fill="none" opacity="0.8"/>
    </svg>
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
            ? "Zatiaľ máme iba 1 mesačný snapshot (apríl 2026). Po každom mesačnom syncu pribudne nový dátový bod a krivka sa rozšíri."
            : "Only 1 monthly snapshot available so far (April 2026). After each monthly sync a new data point will appear and the curve will grow."}
        </div>
      )}
    </div>
  );
}

// ── CSV export ──────────────────────────────────────────────────

function ExportRow({ pickedHistories, lang }) {
  const downloadCsv = () => {
    const head = ["project_id", "project_name", "unit_id", "snapshot_month", "stav", "cena_s_dph", "cena_bez_dph", "obytna_plocha", "izby", "developer", "district"];
    const out = [head.join(",")];
    for (const h of pickedHistories) {
      for (const r of h.rows) {
        out.push([
          r.project_id, JSON.stringify(r.project_name || ""), r.unit_id,
          r.snapshot_month, r.stav || "",
          r.cena_s_dph || "", r.cena_bez_dph || "",
          r.obytna_plocha || "", r.izby || "",
          JSON.stringify(r.developer || ""), JSON.stringify(r.district || ""),
        ].join(","));
      }
    }
    const csv = out.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `residata-unit-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
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
