/**
 * Reports layer — from "3%" to a real module.
 *
 * Five scopes, each its own view but sharing primitives:
 *   · Market     — nationwide snapshot (every active project)
 *   · Mesto      — one city (Bratislava / Košice / …)
 *   · Časť mesta — one district (Staré Mesto, Petržalka, Ružinov, …)
 *   · Projekt    — deep-dive on one project
 *   · Developer  — developer portfolio overview
 *
 * Every scope renders the same section taxonomy so a user's mental
 * model stays stable as they drill down:
 *     KPI strip → Executive summary (optional AI) → Top/Bottom lists
 *     → Price distribution → Absorption & supply → Downloads (CSV + PDF)
 *
 * Data source: the same projects + flats hooks as the rest of the app.
 * No new fetches; all aggregation happens client-side on cached data.
 *
 * PDF: browser print. A dedicated print stylesheet strips chrome and
 * cleanly paginates the report so `Cmd-P → Save as PDF` gives a
 * brand-clean document without a PDF library.
 *
 * AI summary: REMOVED on user request (2026-04-24). The per-report
 * AI-generated exec summary button was deprecated in favour of a
 * future grounded chatbot surface that answers arbitrary market
 * questions from Residata's data. This file now only hosts static
 * analysis — no LLM calls, no ai_usage_log writes.
 */
import { useState, useMemo, useEffect } from "react";
import { useProjects, useProjectSnapshots, useReportHistogram, fetchReportBinUnits, useReportProjectUnits, useReportComparables } from "../lib/useData";
import { moneyFromEur, moneySymbol } from "../lib/money";
import { useCurrency } from "../lib/useCurrency";
import { useCountry, isAllCountries } from "../lib/useCountry";
import { supabase } from "../lib/supabase";

// ── Visual language (mirrors Platform.jsx) ───────────────────────
const mono = "'JetBrains Mono', monospace";
import { accent as green, dim, text, border, bg, surfaceDark as bg2, surfacePanel as panel, orange } from "../lib/theme";
const red = "#ff6b6b";

// ── Scope definitions ────────────────────────────────────────────
// First five = scope-filtered views (pick a subset, see its report).
// Last three = analytical reports that span ALL active projects and
// answer specific business questions.  We keep them in the same tab
// row because users have one mental "Reports" page; adding a divider
// chip between groups separates them visually without splitting the
// surface.
const SCOPES = [
  { key: "market",      label: { sk: "Trh",          en: "Market" } },
  { key: "mesto",       label: { sk: "Mesto",        en: "City" } },
  { key: "cast",        label: { sk: "Časť mesta",   en: "District" } },
  { key: "projekt",     label: { sk: "Projekt",      en: "Project" } },
  { key: "developer",   label: { sk: "Developer",    en: "Developer" } },
  // Analytical reports — visually separated by a CSS divider in the tab row
  { key: "forecast",    label: { sk: "Predpoveď",    en: "Forecast" },    group: "analytics" },
  { key: "comparables", label: { sk: "Komparable",   en: "Comparables" }, group: "analytics" },
  { key: "tension",     label: { sk: "Cenový pomer", en: "Pricing tension" }, group: "analytics" },
];

/* ══════════════════════════════════════════════════════════════════
   Top-level Reports page. Hosts scope tabs + the picked-scope view.
   ══════════════════════════════════════════════════════════════════ */
export default function PlatformReports({ lang = "sk" }) {
  useCurrency(); // subscribe: re-render every report price/€/m² on currency toggle
  const { projects: allProjects, loading: loadingProjects } = useProjects();

  // Active subset — used for every "current market" aggregate (Market /
  // City / District / Developer scopes). Headline numbers must match
  // what /live, the homepage Ticker, and the Dashboard show — all
  // active-only — so paused/sold_out projects' stale flats don't leak
  // into Reports KPI / breakdowns / histograms either.
  //
  // Project scope (single project) bypasses this filter — user picked
  // that specific project explicitly, so it should render even if the
  // project is paused or sold-out.
  const activeProjects = useMemo(
    () => allProjects.filter(p => (p.status || "active") === "active"),
    [allProjects]
  );

  // Default-scope (everything except Project) reads this. Forever perf fix
  // (2026-06-11): Reports no longer pulls flats_current (32k rows, ~30s). KPIs +
  // district/developer breakdowns + tables derive from projects (projects_live is
  // honest in v2 — its rollups match real unit counts exactly). The only
  // unit-level pieces — price histogram, its drilldown, the project deep-dive and
  // the comparables tab — are server-side RPCs (see useReportHistogram /
  // fetchReportBinUnits / useReportProjectUnits / useReportComparables).
  const projects = activeProjects;

  const [scope, setScope]         = useState("market");
  const [cityPick, setCityPick]   = useState(null);
  const [distPick, setDistPick]   = useState(null);
  const [projPick, setProjPick]   = useState(null);
  const [devPick,  setDevPick]    = useState(null);

  // Derive pickers from active set so the dropdowns don't list cities /
  // districts that only have paused / sold-out projects with no current
  // listings to report on. Project picker exception below — uses ALL
  // projects so user can still navigate to a paused project's history.
  const cityOf = (p) => p.city || inferCity(p.district) || null;
  const cities = useMemo(() => uniqueSorted(projects.map(cityOf).filter(Boolean)), [projects]);
  const districts = useMemo(() => uniqueSorted(projects.map(p => p.district).filter(Boolean)), [projects]);
  const developers = useMemo(() => uniqueSorted(projects.map(p => p.developer).filter(Boolean)), [projects]);

  // Initialise pickers once data arrives
  useEffect(() => {
    if (!cityPick && cities[0])       setCityPick(cities[0]);
    if (!distPick && districts[0])    setDistPick(districts[0]);
    if (!projPick && projects[0])     setProjPick(projects[0].id);
    if (!devPick  && developers[0])   setDevPick(developers[0]);
  }, [cities, districts, projects, developers]); // eslint-disable-line

  const loading = loadingProjects;

  // Scope-drill callback: clicking a row in the "Projects in scope"
  // table switches the whole report to the Project scope for that ID.
  // Auto-scrolls so the user sees the new header instead of wondering
  // whether the click did anything.
  const openProject = (id) => {
    if (!id) return;
    setProjPick(id);
    setScope("projekt");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Hold the loading screen until BOTH datasets are in. `projects` (a small
  // ~300-row query) resolves seconds before `flats` (the ~19k current-units
  // fetch, paginated 5000/page). Guarding on projects.length ALONE let the
  // full report render with flats=[] for the seconds in between — so every
  // unit aggregate computed to 0 and the page showed a fully-formed report
  // reading "kapacitou 0 bytov · 0 voľných · 0 predaných" as if final. A
  // paying customer hitting Reports mid-load saw "Slovak market: 0 units"
  // (2026-06-10 platform audit). Waiting for flats too means they see the
  // loader until real numbers exist, never a zeroed-out report. Once both
  // datasets are present a background refetch (loading=true again) keeps the
  // report on screen — no loader flash — because the data conditions hold.
  if (loading && projects.length === 0) {
    return (
      <div style={{ padding: "3rem 2rem", color: dim, fontFamily: mono, fontSize: "0.85rem" }}>
        {lang === "sk" ? "Načítavam report…" : "Loading report…"}
      </div>
    );
  }

  return (
    <div className="residata-report-root" style={{ padding: "1rem 2rem 4rem", maxWidth: 1100, margin: "0 auto" }}>
      {/* Responsive breakpoints for the whole report module — tightens
          side padding, swaps table / histogram layouts, shrinks fonts
          on narrow viewports. Declared once here so nested components
          inherit without re-declaring. */}
      <style>{`
        @media (max-width: 640px) {
          .residata-report-root { padding: 0.75rem 0.85rem 3rem !important; }
          .rep-hist-row { grid-template-columns: 1fr 40px !important; }
          .rep-hist-row .rep-hist-label { grid-column: 1 / -1; text-align: left !important; }
          .rep-hist-row .rep-hist-bar { grid-column: 1 / -1; }
          .rep-hist-row .rep-hist-count { grid-column: 1 / -1; text-align: right !important; }
        }
        @media (max-width: 520px) {
          .rep-kpi-strip { grid-template-columns: repeat(2, 1fr) !important; }
          .rep-picker-row { flex-direction: column; align-items: stretch !important; }
          .rep-picker-row select { min-width: 0 !important; width: 100%; }
        }
        /* Table wrappers: always horizontal-scroll if content overflows,
           so the page layout never breaks even with long project names. */
        .rep-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      `}</style>
      <ReportHeader
        projects={projects} lang={lang}
        scope={scope}
        scopeLabel={
          scope === "mesto"     ? cityPick  :
          scope === "cast"      ? distPick  :
          scope === "developer" ? devPick   :
          scope === "projekt"   ? projPick  :  // project ID
          null
        }
      />

      {/* Scope tabs — split into TWO labelled rows.
          Row 1 = scope-filtered reports (Market / City / District / Project / Developer)
          Row 2 = analytical reports (Forecast / Comparables / Pricing tension)
          The previous single-row layout wrapped onto 3 rows on
          ≤ 840 px viewports, mixing the two groups visually. Two
          named rows fit on a single line at standard widths and
          wrap cleanly within their group on narrow screens, with
          the group label staying as a stable anchor. */}
      <div className="no-print" style={{
        background: bg2, border: `1px solid ${border}`, borderRadius: 8,
        marginBottom: "1rem", overflow: "hidden",
      }}>
        {(() => {
          const filtered = SCOPES.filter(s => s.group !== "analytics");
          const analytical = SCOPES.filter(s => s.group === "analytics");
          return (
            <>
              <ScopeTabRow
                label={lang === "sk" ? "Pohľad" : "View"}
                tabs={filtered}
                active={scope}
                onClick={setScope}
                lang={lang}
              />
              {analytical.length > 0 && (
                <ScopeTabRow
                  label={lang === "sk" ? "Analytické" : "Analytics"}
                  tabs={analytical}
                  active={scope}
                  onClick={setScope}
                  lang={lang}
                  border
                />
              )}
            </>
          );
        })()}
      </div>

      {/* Picker for the current scope */}
      {scope === "mesto" && (
        <PickerRow label={lang === "sk" ? "Mesto" : "City"} value={cityPick} options={cities} onChange={setCityPick} />
      )}
      {scope === "cast" && (
        <PickerRow label={lang === "sk" ? "Časť mesta" : "District"} value={distPick} options={districts} onChange={setDistPick} />
      )}
      {scope === "projekt" && (
        // Project picker uses allProjects (incl. paused/sold_out) so user
        // can still pull up a historical project's data on demand.
        <PickerRow
          label={lang === "sk" ? "Projekt" : "Project"}
          value={projPick}
          options={allProjects.map(p => ({ value: p.id, label: p.name + (p.district ? ` (${p.district})` : "") + (p.status && p.status !== "active" ? ` [${p.status}]` : "") }))}
          onChange={setProjPick}
        />
      )}
      {scope === "developer" && (
        <PickerRow label={lang === "sk" ? "Developer" : "Developer"} value={devPick} options={developers} onChange={setDevPick} />
      )}

      {/* Scope bodies — flats are no longer threaded down; each scope's
          unit-level data (histogram / drilldown / project units) is fetched
          server-side by the child via the report RPCs. */}
      {scope === "market" && (
        <MarketReport projects={projects} onOpenProject={openProject} lang={lang} />
      )}
      {scope === "mesto" && cityPick && (
        <FilteredReport
          scopeLabel={cityPick}
          scopeType={lang === "sk" ? "Mesto" : "City"}
          rpcScopeType="city" rpcScopeValue={cityPick}
          projects={projects.filter(p => cityOf(p) === cityPick)}
          allProjects={projects}
          onOpenProject={openProject}
          lang={lang}
          breakdownBy="district"
          breakdownLabel={lang === "sk" ? "podľa časti mesta" : "by district"}
        />
      )}
      {scope === "cast" && distPick && (
        <FilteredReport
          scopeLabel={distPick}
          scopeType={lang === "sk" ? "Časť mesta" : "District"}
          rpcScopeType="cast" rpcScopeValue={distPick}
          projects={projects.filter(p => p.district === distPick)}
          allProjects={projects}
          onOpenProject={openProject}
          lang={lang}
          breakdownBy="developer"
          breakdownLabel={lang === "sk" ? "podľa developera" : "by developer"}
        />
      )}
      {scope === "projekt" && projPick && (
        // Project scope: lookup from allProjects (might be paused/sold_out).
        // ProjectReport fetches that project's units server-side (report_project_units);
        // siblings stay active-only so context comparisons make sense.
        <ProjectReport
          project={allProjects.find(p => p.id === projPick)}
          siblings={projects}
          lang={lang}
        />
      )}
      {scope === "developer" && devPick && (
        <FilteredReport
          scopeLabel={devPick}
          scopeType={lang === "sk" ? "Developer" : "Developer"}
          rpcScopeType="developer" rpcScopeValue={devPick}
          projects={projects.filter(p => p.developer === devPick)}
          allProjects={projects}
          onOpenProject={openProject}
          lang={lang}
          breakdownBy="name"
          breakdownLabel={lang === "sk" ? "podľa projektu" : "by project"}
        />
      )}

      {/* Analytical reports — share the same active-only data set as
          the Market scope. Each is a self-contained component below. */}
      {scope === "forecast" && (
        <SellOutForecastReport projects={projects} lang={lang} onOpenProject={openProject} />
      )}
      {scope === "comparables" && (
        <ComparableTransactionsReport projects={projects} lang={lang} />
      )}
      {scope === "tension" && (
        <PricingTensionReport projects={projects} lang={lang} onOpenProject={openProject} />
      )}

      {/* Print stylesheet — strips the platform shell (sidebar + top nav)
          around the report, inverts the dark theme to light, widens
          margins, and marks page-break boundaries per section.

          Key tricks:
            · `visibility:hidden` on body + unhide only the report root
              is more reliable than trying to display:none every chrome
              element by class — works even if the platform shell adds
              new wrappers later.
            · Data bars / histograms use linear-gradient backgrounds —
              we override JUST the accent text color to dark-green and
              strip backgrounds, but keep the bar SHAPES by re-enabling
              backgrounds on the `.print-keep-bg` elements. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm 12mm; }
          html, body { background: #fff !important; color: #111 !important; }

          /* Hide everything, then unhide the report root */
          body * { visibility: hidden; }
          .residata-report-root, .residata-report-root * { visibility: visible; }

          /* Take the report out of the platform-shell layout */
          .residata-report-root {
            position: absolute; left: 0; top: 0; right: 0;
            max-width: 100% !important; padding: 0 !important;
            color: #111 !important; background: #fff !important;
          }
          .residata-report-root * {
            color: #111 !important; background: transparent !important;
            border-color: #ccc !important; box-shadow: none !important;
          }
          .residata-report-root .report-section { page-break-inside: avoid; margin-bottom: 14mm; }
          .residata-report-root .report-pagebreak { page-break-before: always; }
          .residata-report-root .report-accent { color: #006b48 !important; }
          .no-print, .no-print * { display: none !important; visibility: hidden !important; }
        }
      `}</style>
    </div>
  );
}

/* ─── Header card: title + month + print + scope-aware subtitle ─── */
function ReportHeader({ projects, lang, scope, scopeLabel }) {
  const month = new Date().toLocaleDateString(lang === "sk" ? "sk-SK" : "en-US", { month: "long", year: "numeric" });
  const lastSync = projects[0]?.last_updated?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  // Unit count from projects_live rollups (honest in v2) — no flats fetch.
  const totalUnits = useMemo(() => summariseProjects(projects).totalUnits, [projects]);
  // Display name of the scope tab ("Trh", "Mesto", "Projekt", …).
  const scopeName = SCOPES.find(s => s.key === scope)?.label[lang] || "";
  // For Project scope, scopeLabel is a UUID — resolve to human name for
  // the crumb. For other scopes, it's already the human label.
  let scopeLabelDisplay = scopeLabel;
  if (scope === "projekt" && scopeLabel) {
    const p = projects.find(pp => pp.id === scopeLabel);
    if (p) scopeLabelDisplay = p.name;
  }
  return (
    <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 12, padding: "1.5rem 1.75rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: "0.78rem", color: dim, marginBottom: "0.3rem" }}>
            {scopeName}{scopeLabelDisplay && <span style={{ color: text }}> · {scopeLabelDisplay}</span>}
          </div>
          <h2 style={{ fontSize: "1.6rem", fontWeight: 700, color: text, margin: 0, letterSpacing: "-0.02em", textTransform: "capitalize" }}>
            {month}
          </h2>
          <p style={{ color: dim, fontSize: "0.82rem", margin: "0.4rem 0 0" }}>
            {lang === "sk" ? "Dáta k" : "Data as of"} {lastSync} · {projects.length} {lang === "sk" ? "projektov" : "projects"} · {totalUnits.toLocaleString("en-US").replace(/,/g, " ")} {lang === "sk" ? "bytov" : "units"}
          </p>
        </div>
        <div className="no-print" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <SubscribeButton scope={scope} scopeLabel={scopeLabel} lang={lang} />
          <button onClick={() => downloadScopeCSV(projects, lang)}
            style={{
              background: "transparent", color: green, border: `1px solid ${green}55`,
              borderRadius: 4, padding: "0.5rem 0.9rem", fontFamily: mono,
              fontSize: "0.78rem", fontWeight: 700, cursor: "pointer",
            }}>
            ⬇ CSV
          </button>
          <button onClick={() => window.print()} className="btn-p" style={{ fontSize: "0.78rem", padding: "0.5rem 0.9rem" }}>
            🖨 {lang === "sk" ? "Stiahnuť PDF" : "Save as PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Monthly email subscribe toggle ─────────────────────────────
   Upserts a row in `report_subscriptions` for the logged-in user.
   The Vercel cron endpoint (/api/cron/monthly-reports, 1st of month)
   emails everyone who's enabled=true.

   scope_label travels with the upsert so a user subscribing on
   "Projekt: X" actually gets reports on X (not an empty-payload
   project=null fallback). Same for city / district / developer. */
function SubscribeButton({ scope, scopeLabel, lang }) {
  const [state, setState] = useState("loading"); // loading | off | on | saving | err
  const [email, setEmail] = useState(null);

  // Re-check subscription state when scope changes (might have a
  // different row for the new scope? — no, PK is user_id so only ever
  // one subscription per user — but this keeps the re-check honest).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (!cancelled) setState("off"); return; }
        if (!cancelled) setEmail(user.email);
        const { data } = await supabase.from("report_subscriptions")
          .select("enabled, scope, scope_label").eq("user_id", user.id).maybeSingle();
        if (cancelled) return;
        // "on" only when subscribed AND the current scope matches — lets
        // the user move between tabs and see "on" only on their subbed one.
        const isOn = !!(data?.enabled
          && data.scope === scope
          && (data.scope_label || null) === (scopeLabel || null));
        setState(isOn ? "on" : "off");
      } catch (_) { if (!cancelled) setState("off"); }
    })();
    return () => { cancelled = true; };
  }, [scope, scopeLabel]);

  const toggle = async () => {
    setState("saving");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setState("off"); return; }
      const want = state !== "on";
      const { error } = await supabase.from("report_subscriptions").upsert({
        user_id: user.id,
        email:   user.email,
        scope,
        scope_label: scopeLabel || null,
        lang,
        enabled: want,
      }, { onConflict: "user_id" });
      if (error) throw error;
      setState(want ? "on" : "off");
    } catch (e) {
      setState("err");
      setTimeout(() => setState("off"), 3000);
    }
  };

  const label = {
    loading: "…",
    off:     "📧 " + (lang === "sk" ? "Odoberať mesačne" : "Subscribe monthly"),
    on:      "✓ " + (lang === "sk" ? "Odoberá sa"       : "Subscribed"),
    saving:  "…",
    err:     "⚠ chyba",
  }[state];
  const isOn = state === "on";
  return (
    <button onClick={toggle} disabled={state === "saving" || state === "loading"}
      title={email ? `Posielame na ${email}` : ""}
      style={{
        background: isOn ? "rgba(0,229,160,0.14)" : "transparent",
        color: isOn ? green : dim,
        border: `1px solid ${isOn ? green : border}`,
        borderRadius: 4, padding: "0.5rem 0.9rem", fontFamily: mono,
        fontSize: "0.78rem", fontWeight: 700, cursor: "pointer",
      }}>
      {label}
    </button>
  );
}

/* Row of scope-tab buttons with a left-side group label. The label
   stays anchored on a separate baseline so it's always visible even
   when the tabs themselves wrap to multiple lines on narrow screens. */
function ScopeTabRow({ label, tabs, active, onClick, lang, border: hasTopBorder = false }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", flexWrap: "wrap",
      gap: "0.4rem 0.5rem",
      padding: "0.55rem 0.7rem",
      borderTop: hasTopBorder ? `1px solid ${border}` : "none",
      background: hasTopBorder ? "rgba(0,229,160,0.025)" : "transparent",
    }}>
      <div style={{
        fontFamily: mono, fontSize: "0.6rem", color: dim,
        letterSpacing: "0.12em", textTransform: "uppercase",
        marginRight: "0.4rem", flex: "0 0 auto",
        minWidth: 64,
      }}>
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", flex: 1 }}>
        {tabs.map(s => (
          <ScopeTab key={s.key} active={active === s.key} onClick={() => onClick(s.key)}>
            {s.label[lang] || s.label.sk}
          </ScopeTab>
        ))}
      </div>
    </div>
  );
}

function ScopeTab({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        background: active ? "rgba(0,229,160,0.14)" : "transparent",
        border: `1px solid ${active ? green : border}`,
        color: active ? green : dim,
        padding: "0.4rem 0.85rem", borderRadius: 4,
        fontFamily: mono, fontSize: "0.72rem", cursor: "pointer",
        letterSpacing: "0.04em",
      }}>
      {children}
    </button>
  );
}

function PickerRow({ label, value, options, onChange }) {
  const opts = options.map(o => (typeof o === "string" ? { value: o, label: o } : o));
  return (
    <div className="no-print rep-picker-row" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", padding: "0.55rem 0.7rem", background: bg2, border: `1px solid ${border}`, borderRadius: 6 }}>
      <span style={{ fontFamily: mono, fontSize: "0.62rem", color: dim, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</span>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)}
        style={{
          background: bg, border: `1px solid ${border}`, color: text,
          padding: "0.35rem 0.6rem", borderRadius: 4,
          fontFamily: mono, fontSize: "0.78rem", minWidth: 200,
        }}>
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span style={{ fontFamily: mono, fontSize: "0.62rem", color: dim }}>{opts.length} {`⋮`}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Market report — global, "where the Slovak new-build market stands"
   ══════════════════════════════════════════════════════════════════ */
function MarketReport({ projects, onOpenProject, lang }) {
  const { snapshots } = useProjectSnapshots();
  const { country } = useCountry();
  const { bins: priceSeries } = useReportHistogram({ scopeType: "market", nbins: 12 });
  const fetchBin = useMemo(() => (from, to) => fetchReportBinUnits({ country, scopeType: "market", from, to }), [country]);
  const summary = useMemo(() => summariseProjects(projects), [projects]);
  const districts = useMemo(() => groupAggregates(projects, "district", lang), [projects, lang]);
  const developers = useMemo(() => groupAggregates(projects, "developer", lang).slice(0, 8), [projects, lang]);
  // Trend chart: filter snapshots to currently-active projects so the
  // historical line matches what the rest of Reports shows ("active
  // market over time"), not "all projects ever, including those that
  // have since been paused or sold-out". Without this filter, the
  // trend graph would include Danubius's 146 stale snapshots, etc.
  const activeProjectIds = useMemo(() => new Set(projects.map(p => p.id)), [projects]);
  const trendPredicate = useMemo(() => (s) => activeProjectIds.has(s.project_id), [activeProjectIds]);

  // Market-aware title: "All" spans markets, so don't label it Slovak/Czech.
  const title = isAllCountries(country)
    ? (lang === "sk" ? "Trh novostavieb" : "New-build market")
    : country === "CZ"
      ? (lang === "sk" ? "Český trh novostavieb" : "Czech new-build market")
      : (lang === "sk" ? "Slovenský trh novostavieb" : "Slovak new-build market");

  return (
    <>
      <KpiStrip summary={summary} lang={lang} />

      <ReportSection label={lang === "sk" ? "Executive summary" : "Executive summary"} title={title}>
        {/* Priciest district for the summary line. groupAggregates sorts by unit
            COUNT (not €/m²), so districts[0] was actually the LARGEST district —
            mislabeled "most expensive". Pick the highest-€/m² NAMED district (skip
            the "(neznáme)"/"(unknown)" no-district bucket); the full table below
            still lists every bucket honestly. */}
        <ExecSummary summary={summary} lang={lang} extraDistrict={
          [...districts]
            .filter(d => d.name !== "(neznáme)" && d.name !== "(unknown)" && d.wavgM2 != null)
            .sort((a, b) => b.wavgM2 - a.wavgM2)[0] || districts[0]
        } />
      </ReportSection>

      <ReportSection label={lang === "sk" ? "Rozloženie cien" : "Price distribution"} title={lang === "sk" ? `${moneySymbol()}/m² cez všetky byty \u2014 klik na pásmo otvorí zoznam bytov` : `${moneySymbol()}/m² across all units \u2014 click a band for the underlying units`}>
        <Histogram bins={priceSeries} lang={lang} unit="€/m²" onFetchBin={fetchBin} onProjectClick={onOpenProject} />
      </ReportSection>

      <ReportSection label={lang === "sk" ? "Časti mesta" : "Districts"} title={lang === "sk" ? "Kde je dopyt a ceny najvyššie" : "Where demand and prices concentrate"}>
        <AggregateTable rows={districts} lang={lang} nameLabel={lang === "sk" ? "Časť" : "District"} />
      </ReportSection>

      <ReportSection label={lang === "sk" ? "Top developeri" : "Top developers"} title={lang === "sk" ? "Podľa objemu jednotiek" : "By total inventory"}>
        <AggregateTable rows={developers} lang={lang} nameLabel="Developer" />
      </ReportSection>

      <ReportSection label={lang === "sk" ? "Najaktívnejší mesiac" : "Most active last month"} title={lang === "sk" ? "Predaje za posledných 30 dní" : "Sales in the last 30 days"}>
        <TopSellerList projects={projects} lang={lang} />
      </ReportSection>

      {snapshots && snapshots.length > 0 && (
        <ReportSection label={lang === "sk" ? "Historický trend" : "Historical trend"} title={lang === "sk" ? "Vývoj po mesiacoch (aktívny trh)" : "Month-by-month (active market)"}>
          <TrendChart snapshots={snapshots} scopePredicate={trendPredicate} lang={lang} />
        </ReportSection>
      )}

      <FooterCard lang={lang} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Filtered report — reused for City / District / Developer scopes.
   Signs: `scopeLabel` + `scopeType` identify what's narrowed;
          `projects` + `flats` are already filtered to that slice.
   ══════════════════════════════════════════════════════════════════ */
function FilteredReport({ scopeLabel, scopeType, rpcScopeType, rpcScopeValue, projects, allProjects, onOpenProject, lang, breakdownBy, breakdownLabel }) {
  const { snapshots } = useProjectSnapshots();
  const { country } = useCountry();
  const { bins: priceSeries } = useReportHistogram({ scopeType: rpcScopeType, scopeValue: rpcScopeValue, nbins: 12 });
  const fetchBin = useMemo(() => (from, to) => fetchReportBinUnits({ country, scopeType: rpcScopeType, scopeValue: rpcScopeValue, from, to }), [country, rpcScopeType, rpcScopeValue]);
  const summary = useMemo(() => summariseProjects(projects), [projects]);
  const globalSummary = useMemo(() => summariseProjects(allProjects), [allProjects]);
  const breakdown = useMemo(() => groupAggregates(projects, breakdownBy, lang), [projects, breakdownBy, lang]);
  const scopeProjectIds = useMemo(() => new Set(projects.map(p => p.id)), [projects]);

  if (projects.length === 0) {
    return (
      <div style={{ padding: "2rem", color: dim, fontSize: "0.9rem", textAlign: "center", fontStyle: "italic", background: bg2, border: `1px dashed ${border}`, borderRadius: 8 }}>
        {lang === "sk" ? `Pre výber "${scopeLabel}" nemáme dáta.` : `No data available for "${scopeLabel}".`}
      </div>
    );
  }

  const title = lang === "sk" ? `${scopeType}: ${scopeLabel}` : `${scopeType}: ${scopeLabel}`;

  return (
    <>
      <KpiStrip summary={summary} lang={lang} />

      <ReportSection label={scopeType} title={title}>
        <ExecSummary summary={summary} lang={lang} compared={{ label: lang === "sk" ? "trh" : "market", summary: globalSummary }} />
      </ReportSection>

      {priceSeries.some(b => b.count > 0) && (
        <ReportSection label={lang === "sk" ? "Rozloženie cien" : "Price distribution"} title={lang === "sk" ? "Kde sedí väčšina ponuky \u2014 klik na pásmo otvorí zoznam bytov" : "Where the bulk of supply sits \u2014 click a band for the underlying units"}>
          <Histogram bins={priceSeries} lang={lang} unit="€/m²" onFetchBin={fetchBin} onProjectClick={onOpenProject} />
        </ReportSection>
      )}

      {breakdown.length > 0 && (
        <ReportSection label={lang === "sk" ? "Rozklad" : "Breakdown"} title={lang === "sk" ? `Ponuka ${breakdownLabel}` : `Supply ${breakdownLabel}`}>
          <AggregateTable rows={breakdown} lang={lang} nameLabel={breakdownLabel} />
        </ReportSection>
      )}

      <ReportSection label={lang === "sk" ? "Kontext" : "Context"} title={lang === "sk" ? "Porovnanie so širším trhom" : "Benchmark against wider market"}>
        <BenchmarkCard local={summary} global={globalSummary} scopeLabel={scopeLabel} lang={lang} />
      </ReportSection>

      <ReportSection label={lang === "sk" ? "Projekty v scope" : "Projects in scope"} title={lang === "sk" ? `Kompletný zoznam (${projects.length}) \u2014 klik otvorí projekt-report` : `Full list (${projects.length}) \u2014 click to open project report`}>
        <ProjectTable projects={projects} lang={lang} onProjectClick={onOpenProject} />
      </ReportSection>

      {snapshots && snapshots.length > 0 && (
        <ReportSection label={lang === "sk" ? "Historický trend" : "Historical trend"} title={lang === "sk" ? `Vývoj v scope: ${scopeLabel}` : `Trend in scope: ${scopeLabel}`}>
          <TrendChart snapshots={snapshots} scopePredicate={(s) => scopeProjectIds.has(s.project_id)} lang={lang} />
        </ReportSection>
      )}

      <FooterCard lang={lang} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Project report — single-project deep dive.
   ══════════════════════════════════════════════════════════════════ */
function ProjectReport({ project, siblings, lang }) {
  // Hoist all hooks before any early return to keep hook ordering stable
  // across renders (rules-of-hooks).
  const { snapshots } = useProjectSnapshots();
  // This project's current units — fetched server-side (report_project_units),
  // not sliced from a 32k global pull. `flats` alias keeps the rest unchanged.
  const { units: flats } = useReportProjectUnits(project?.id);
  const summary = useMemo(() => project ? summariseProjects([project], flats) : null, [project, flats]);
  const districtSiblings = useMemo(
    // PA-11: same-district siblings must also be the same CITY (district names
    // repeat across cities under unified SK). City-equal today for BA = no change.
    () => project ? siblings.filter(p => p.district === project.district && (p.city || "") === (project.city || "") && p.id !== project.id) : [],
    [siblings, project]
  );
  // District benchmark from sibling projects' rollups (projects_live honest) — no flats.
  const districtSummary = useMemo(() => summariseProjects(districtSiblings), [districtSiblings]);
  const byTyp = useMemo(() => groupAggregatesFromFlats(flats, "typ"), [flats]);
  const byIzby = useMemo(() => groupAggregatesFromFlats(flats, "izby"), [flats]);
  const byPoschodie = useMemo(() => groupAggregatesFromFlats(flats, "poschodie"), [flats]);
  const priceSeries = useMemo(() => priceDistribution(flats, 10), [flats]);
  // Drilldown filters this project's in-memory units to the clicked €/m² band
  // (EUR basis — useReportProjectUnits overlays price_s_dph_eur onto cena_s_dph).
  const fetchBin = useMemo(() => (from, to) => Promise.resolve(
    (flats || [])
      .filter(f => (f.stav === "V" || f.stav === "R" || f.stav === "PR") && f.cena_s_dph > 0 && f.obytna_plocha > 0)
      .map(f => ({ f, m2: f.cena_s_dph / f.obytna_plocha }))
      .filter(x => x.m2 >= from && x.m2 < to)
      .map(({ f, m2 }) => ({
        flatId: `${f.project_id}-${f.unit_id}`, projectId: f.project_id,
        project: project?.name, district: project?.district, izby: f.izby,
        area: f.obytna_plocha == null ? null : Number(f.obytna_plocha),
        price: f.cena_s_dph == null ? null : Number(f.cena_s_dph), m2: Math.round(m2),
      }))
      .sort((a, b) => a.m2 - b.m2)
  ), [flats, project]);

  if (!project) {
    return <div style={{ color: dim, padding: "2rem" }}>{lang === "sk" ? "Nevybraný projekt." : "No project selected."}</div>;
  }

  const title = project.name;

  return (
    <>
      <KpiStrip summary={summary} lang={lang} extra={[
        { label: "Developer",   value: project.developer || "—" },
        { label: lang === "sk" ? "Časť" : "District", value: project.district || "—" },
      ]} />

      <ReportSection label={lang === "sk" ? "Profil projektu" : "Project profile"} title={title}>
        <p style={{ color: "#c4c4cc", lineHeight: 1.7, margin: 0 }}>
          {lang === "sk" ? (
            <><strong style={{ color: text }}>{project.name}</strong> od developera <strong style={{ color: text }}>{project.developer || "—"}</strong> v časti <strong style={{ color: text }}>{project.district || "—"}</strong>.
            {summary.hasUnitData
              ? <> Celkovo {summary.totalUnits} bytov, {summary.soldPct != null ? summary.soldPct.toFixed(0) : "—"}% predaných.</>
              : <> Jednotkové dáta pre tento projekt ešte neposielame (registrový záznam).</>}
            {summary.wavgM2 && <> Vážený priemer <strong style={{ color: text }}>{Math.round(moneyFromEur(summary.wavgM2)).toLocaleString("sk-SK")} {moneySymbol()}/m²</strong>.</>}</>
          ) : (
            <><strong style={{ color: text }}>{project.name}</strong> by <strong style={{ color: text }}>{project.developer || "—"}</strong> in <strong style={{ color: text }}>{project.district || "—"}</strong>.
            {summary.hasUnitData
              ? <> {summary.totalUnits} units, {summary.soldPct != null ? summary.soldPct.toFixed(0) : "—"}% sold.</>
              : <> Unit-level data not tracked yet (registry-only entry).</>}
            {summary.wavgM2 && <> Weighted avg <strong style={{ color: text }}>{Math.round(moneyFromEur(summary.wavgM2)).toLocaleString("en-US")} {moneySymbol()}/m²</strong>.</>}</>
          )}
        </p>
      </ReportSection>

      {byIzby.length > 0 && (
        <ReportSection label={lang === "sk" ? "Mix dispozícií" : "Unit mix"} title={lang === "sk" ? "Ponuka podľa počtu izieb" : "Supply by bedrooms"}>
          <AggregateTable rows={byIzby} lang={lang} nameLabel={lang === "sk" ? "Izby" : "Bedrooms"} />
        </ReportSection>
      )}

      {byTyp.length > 0 && (
        <ReportSection label={lang === "sk" ? "Mix typov" : "Unit types"} title={lang === "sk" ? "Ponuka podľa typu" : "Supply by type"}>
          <AggregateTable rows={byTyp} lang={lang} nameLabel="Typ" />
        </ReportSection>
      )}

      {byPoschodie.length > 0 && byPoschodie.length < 30 && (
        <ReportSection label={lang === "sk" ? "Po poschodiach" : "By floor"} title={lang === "sk" ? "Dostupnosť po výške" : "Availability by floor"}>
          <AggregateTable rows={byPoschodie} lang={lang} nameLabel={lang === "sk" ? "Poschodie" : "Floor"} />
        </ReportSection>
      )}

      {priceSeries.some(b => b.count > 0) && (
        <ReportSection label={lang === "sk" ? "Distribúcia cien" : "Price distribution"} title={lang === "sk" ? `${moneySymbol()}/m² naprieč bytmi \u2014 klik na pásmo otvorí zoznam bytov` : `${moneySymbol()}/m² across units \u2014 click a band for the underlying units`}>
          <Histogram bins={priceSeries} lang={lang} unit="€/m²" onFetchBin={fetchBin} />
        </ReportSection>
      )}

      <ReportSection label={lang === "sk" ? "Benchmark" : "Benchmark"} title={lang === "sk" ? `Projekt vs. časť mesta (${project.district || "—"})` : `Project vs. its district (${project.district || "—"})`}>
        <BenchmarkCard local={summary} global={districtSummary} scopeLabel={project.name} lang={lang} />
      </ReportSection>

      {snapshots && snapshots.length > 0 && (
        <ReportSection label={lang === "sk" ? "Historický trend" : "Historical trend"} title={lang === "sk" ? `Vývoj projektu ${project.name}` : `Trend of ${project.name}`}>
          <TrendChart snapshots={snapshots} scopePredicate={(s) => s.project_id === project.id} lang={lang} />
        </ReportSection>
      )}

      <FooterCard lang={lang} />
    </>
  );
}

/* ══════════════════════════════════════════════════════════════════
   Shared report primitives
   ══════════════════════════════════════════════════════════════════ */
function ReportSection({ label, title, children }) {
  // One-line subtitle in muted gray above the H3 — previously a loud
  // small-caps green uppercase badge, which made every section scream
  // for attention. Now reads as a calm eyebrow.
  return (
    <div className="report-section" style={{ marginBottom: "2rem" }}>
      {label && (
        <div style={{ fontSize: "0.72rem", color: dim, marginBottom: "0.2rem" }}>{label}</div>
      )}
      <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: text, margin: "0 0 0.75rem", letterSpacing: "-0.01em" }}>{title}</h3>
      {children}
    </div>
  );
}

function KpiStrip({ summary, lang, extra = [] }) {
  // soldPct == null signals "data gap" (the scope contains only
  // registry-only projects, or no tracked flats) — render em-dash
  // instead of "0%" which misleads the reader into thinking nothing
  // has sold when the truth is "we don't know".
  // n/a when developer doesn't publish sold info — distinct from
  // a real "0%" so users don't read the absence as "nothing has sold".
  const soldPctLabel = summary.soldPct == null ? "n/a" : `${summary.soldPct.toFixed(0)}%`;
  const items = [
    { label: lang === "sk" ? "Projektov"   : "Projects",   value: summary.projectCount.toLocaleString("en-US").replace(/,/g, " ") },
    { label: lang === "sk" ? "Bytov"       : "Units",      value: summary.totalUnits.toLocaleString("en-US").replace(/,/g, " ") },
    { label: lang === "sk" ? "Voľných"     : "Available",  value: summary.available.toLocaleString("en-US").replace(/,/g, " "), color: green },
    { label: lang === "sk" ? "Predaných"   : "Sold",       value: summary.sold.toLocaleString("en-US").replace(/,/g, " "), color: orange },
    { label: lang === "sk" ? "Predaných %" : "Sold %",     value: soldPctLabel, color: orange },
    ...(summary.wavgM2 ? [{
      label: lang === "sk" ? `Ø ${moneySymbol()}/m² (vážené)` : `Ø ${moneySymbol()}/m² (wtd)`,
      value: Math.round(moneyFromEur(summary.wavgM2)).toLocaleString("en-US").replace(/,/g, " "),
    }] : []),
    ...extra,
  ];
  return (
    <div className="rep-kpi-strip" style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(130px, 1fr))`, gap: "0.5rem", marginBottom: "1.25rem" }}>
      {items.map((k, i) => (
        <div key={i} style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "0.65rem 0.9rem" }}>
          <div style={{ fontSize: "0.7rem", color: dim, marginBottom: "0.2rem" }}>{k.label}</div>
          <div className="report-accent" style={{ fontSize: "1.15rem", fontWeight: 700, color: k.color || text }}>{k.value}</div>
        </div>
      ))}
    </div>
  );
}

function ExecSummary({ summary, lang, extraDistrict, compared }) {
  // Compact Slovak summary paragraph
  return (
    <p style={{ color: "#c0c0c8", fontSize: "0.95rem", lineHeight: 1.7, margin: 0 }}>
      {lang === "sk" ? (
        <>V tomto výbere sledujeme <strong style={{ color: text }}>{summary.projectCount}</strong> projektov s kapacitou <strong style={{ color: text }}>{summary.totalUnits.toLocaleString("sk-SK")}</strong> bytov.
        Aktuálne je voľných <strong style={{ color: green }}>{summary.available.toLocaleString("sk-SK")}</strong>, predaných <strong style={{ color: orange }}>{summary.sold.toLocaleString("sk-SK")}</strong>.
        {summary.sold30 > 0 && <> Za posledných 30 dní pribudlo <strong style={{ color: orange }}>{summary.sold30}</strong> nových predajov.</>}
        {summary.wavgM2 && <> Priemerná cena v scope-e je <strong style={{ color: text }}>{Math.round(moneyFromEur(summary.wavgM2)).toLocaleString("sk-SK")} {moneySymbol()}/m²</strong> (vážené veľkosťou projektu).</>}
        {extraDistrict && <> Najdrahšia časť: <strong style={{ color: text }}>{extraDistrict.name}</strong>{extraDistrict.wavgM2 && <> ({Math.round(moneyFromEur(extraDistrict.wavgM2)).toLocaleString("sk-SK")} {moneySymbol()}/m²)</>}.</>}
        {compared && compared.summary.wavgM2 && summary.wavgM2 && (() => {
          const delta = ((summary.wavgM2 / compared.summary.wavgM2) - 1) * 100;
          const sign = delta >= 0 ? "+" : "";
          const color = Math.abs(delta) < 2 ? dim : (delta > 0 ? red : green);
          return <> Oproti {compared.label}u je to <strong style={{ color }}>{sign}{delta.toFixed(1)}%</strong>.</>;
        })()}
        </>
      ) : (
        <>This scope contains <strong style={{ color: text }}>{summary.projectCount}</strong> projects holding <strong style={{ color: text }}>{summary.totalUnits.toLocaleString("en-US")}</strong> units.
        Currently <strong style={{ color: green }}>{summary.available.toLocaleString("en-US")}</strong> available, <strong style={{ color: orange }}>{summary.sold.toLocaleString("en-US")}</strong> sold.
        {summary.sold30 > 0 && <> Last 30 days saw <strong style={{ color: orange }}>{summary.sold30}</strong> new sales.</>}
        {summary.wavgM2 && <> Weighted avg <strong style={{ color: text }}>{Math.round(moneyFromEur(summary.wavgM2)).toLocaleString("en-US")} {moneySymbol()}/m²</strong>.</>}
        </>
      )}
    </p>
  );
}

/* ─── Histogram — SVG/HTML horizontal bars per bin ───
 *
 * Bins are now clickable. Clicking a bin opens a drill-down panel
 * under the chart listing every flat whose €/m² sits in that band,
 * sorted ascending by €/m². Each row shows project / district /
 * rooms / area / price / €/m². If `flats` + `projects` are passed,
 * the drill-down is rendered; otherwise the component degrades to
 * the previous read-only display so existing call sites still work.
 *
 * Why inline instead of a separate modal: the question "what's in
 * this bin?" is a follow-up to the chart — keeping the answer in
 * the same reading flow avoids a context switch. Modal would also
 * break when printing the report to PDF.
 */
function Histogram({ bins, lang, unit, onFetchBin, onProjectClick }) {
  // ALL hooks must run on every render — guard with nullish arrays inside,
  // early-return only at the end (avoids the React #310 hook-count crash).
  const [openBin, setOpenBin] = useState(null);   // index of expanded bin, or null
  const [drillRows, setDrillRows] = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const safeBins = Array.isArray(bins) ? bins : [];
  const drillable = typeof onFetchBin === "function";

  // Drilldown is now lazy: clicking a band fetches its units server-side
  // (report_bin_units) instead of filtering a 32k in-memory pull. Project
  // scope resolves onFetchBin synchronously from its already-loaded units.
  const handleBinClick = (i) => {
    if (!drillable) return;
    if (openBin === i) { setOpenBin(null); setDrillRows([]); return; }
    const b = safeBins[i];
    if (!b) return;
    setOpenBin(i);
    setDrillRows([]);
    setDrillLoading(true);
    Promise.resolve(onFetchBin(b.from, b.to))
      .then((rows) => { setDrillRows(Array.isArray(rows) ? rows : []); setDrillLoading(false); })
      .catch(() => { setDrillRows([]); setDrillLoading(false); });
  };

  // Safe to early-return here — all hooks above have already been called.
  if (safeBins.length === 0) return null;
  const max = Math.max(...safeBins.map(b => b.count), 1);

  return (
    <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "0.75rem 0.9rem" }}>
      {/* rep-hist-row class is targeted by the page-level @media query
          to stack the 3 columns on narrow viewports (< 640px). */}
      <div className="rep-hist-row" style={{ display: "grid", gridTemplateColumns: "140px 1fr 40px", gap: "0.3rem 0.3rem", alignItems: "center" }}>
        {safeBins.map((b, i) => (
          <RowBin
            key={i}
            bin={b}
            max={max}
            unit={unit}
            clickable={drillable}
            active={openBin === i}
            onClick={drillable ? () => handleBinClick(i) : undefined}
          />
        ))}
      </div>
      <div style={{ fontFamily: mono, fontSize: "0.62rem", color: dim, marginTop: "0.55rem", textAlign: "center" }}>
        {lang === "sk"
          ? (drillable ? "Klikni na pásmo pre zoznam bytov v ňom. Osa: počet bytov v cenovom pásme." : "Osa: počet bytov v cenovom pásme.")
          : (drillable ? "Click a band for the units in it. Axis: unit count per price band." : "Axis: unit count per price band.")}
      </div>

      {openBin != null && drillable && (
        <HistogramDrilldown
          bin={safeBins[openBin]}
          rows={drillRows}
          loading={drillLoading}
          unit={unit}
          lang={lang}
          onClose={() => { setOpenBin(null); setDrillRows([]); }}
          onProjectClick={onProjectClick}
        />
      )}

      <style>{`
        .rep-hist-clickable { cursor: pointer; transition: background 0.12s, border-color 0.12s; }
        .rep-hist-clickable:hover .rep-hist-label { color: #e8e8ed; }
        .rep-hist-clickable:hover .rep-hist-bar { border-color: #00e5a0; }
        .rep-hist-clickable:hover .rep-hist-count { color: #00e5a0; }
        .rep-hist-clickable.is-active .rep-hist-label { color: #00e5a0; font-weight: 700; }
        .rep-hist-clickable.is-active .rep-hist-bar { border-color: #00e5a0; box-shadow: 0 0 0 1px rgba(0,229,160,0.4); }
        .rep-hist-clickable.is-active .rep-hist-count { color: #00e5a0; }
      `}</style>
    </div>
  );
}

/**
 * HistogramDrilldown — the list that opens under a clicked bin.
 * Table of every flat in the band, sorted by €/m², with a header
 * summarising the band (range + count + cheapest/most-expensive).
 * Project cell click calls onProjectClick (same pattern the
 * ProjectTable uses), so the user can jump to the Project scope.
 */
function HistogramDrilldown({ bin, rows, loading, unit, lang, onClose, onProjectClick }) {
  if (!bin) return null;
  const clickable = typeof onProjectClick === "function";
  const fmtEur = (v) => v == null ? "—" : Math.round(moneyFromEur(v)).toLocaleString(lang === "sk" ? "sk-SK" : "en-US");
  return (
    <div style={{ marginTop: "0.75rem", border: `1px solid ${border}`, borderRadius: 8, background: bg }}>
      <div style={{ padding: "0.6rem 0.85rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", borderBottom: `1px solid ${border}`, background: "rgba(0,229,160,0.04)" }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {lang === "sk" ? "Pásmo" : "Band"} {unit ? (unit === "€/m²" ? `${moneySymbol()}/m²` : unit) : ""}
          </div>
          <div style={{ fontSize: "0.92rem", color: text, fontWeight: 600, marginTop: 2 }}>
            {bandLabel(bin)}{unit ? " " + (unit === "€/m²" ? `${moneySymbol()}/m²` : unit) : ""} · <span style={{ color: green, fontFamily: mono }}>{loading ? "…" : rows.length}</span>{" "}
            <span style={{ color: dim, fontWeight: 400, fontSize: "0.8rem" }}>
              {lang === "sk" ? (rows.length === 1 ? "byt" : (rows.length < 5 ? "byty" : "bytov")) : (rows.length === 1 ? "unit" : "units")}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: `1px solid ${border}`, color: dim, borderRadius: 4, padding: "0.3rem 0.6rem", fontSize: "0.72rem", fontFamily: mono, cursor: "pointer" }}
          title={lang === "sk" ? "Zavrieť" : "Close"}
        >
          ✕ {lang === "sk" ? "zavrieť" : "close"}
        </button>
      </div>
      {loading ? (
        <div style={{ padding: "1rem", color: dim, fontSize: "0.85rem", textAlign: "center", fontStyle: "italic" }}>
          {lang === "sk" ? "Načítavam byty…" : "Loading units…"}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "1rem", color: dim, fontSize: "0.85rem", textAlign: "center", fontStyle: "italic" }}>
          {lang === "sk" ? "Žiadne byty v tomto pásme." : "No units in this band."}
        </div>
      ) : (
        <div className="rep-table-wrap" style={{ maxHeight: 340, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
            <thead style={{ position: "sticky", top: 0, background: bg2, zIndex: 1 }}>
              <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                <th style={tdh}>{lang === "sk" ? "Projekt" : "Project"}</th>
                <th style={tdh}>{lang === "sk" ? "Časť" : "District"}</th>
                <th style={tdhR}>{lang === "sk" ? "Izby" : "Rooms"}</th>
                <th style={tdhR}>{lang === "sk" ? "Plocha" : "Area"}</th>
                <th style={tdhR}>{lang === "sk" ? `Cena ${moneySymbol()}` : `Price ${moneySymbol()}`}</th>
                <th style={tdhR}>{moneySymbol()}/m²</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.flatId || i}
                  className={clickable ? "rep-row-clickable" : "rep-row-hoverable"}
                  style={{ borderTop: `1px solid ${border}`, cursor: clickable ? "pointer" : "default" }}
                  onClick={clickable ? () => onProjectClick(r.projectId) : undefined}
                  title={clickable ? (lang === "sk" ? "Otvoriť projekt-report" : "Open project report") : r.project}
                >
                  <td style={tdc}><strong style={{ color: text }}>{r.project}</strong></td>
                  <td style={tdc}>{r.district}</td>
                  <td style={tdcR}>{r.izby ?? "—"}</td>
                  <td style={tdcR}>{r.area ? r.area.toFixed(1) : "—"}</td>
                  <td style={tdcR}>{fmtEur(r.price)}</td>
                  <td style={{ ...tdcR, color: green, fontWeight: 700 }}>{fmtEur(r.m2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RowBin({ bin, max, unit, clickable, active, onClick }) {
  const w = (bin.count / max) * 100;
  const cls = clickable ? `rep-hist-clickable${active ? " is-active" : ""}` : "";
  const handleKey = (e) => {
    if (!onClick) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
  };
  return (
    <>
      <span
        className={`rep-hist-label ${cls}`}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : -1}
        onClick={onClick}
        onKeyDown={clickable ? handleKey : undefined}
        style={{ fontFamily: mono, fontSize: "0.68rem", color: dim, textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {bandLabel(bin)}{unit ? " " + (unit === "€/m²" ? `${moneySymbol()}/m²` : unit) : ""}
      </span>
      <div
        className={`rep-hist-bar ${cls}`}
        onClick={onClick}
        onKeyDown={clickable ? handleKey : undefined}
        tabIndex={clickable ? 0 : -1}
        role={clickable ? "button" : undefined}
        style={{ position: "relative", height: 14, background: bg, border: `1px solid ${border}`, borderRadius: 3 }}
      >
        <div style={{ position: "absolute", inset: 0, width: `${w}%`, background: `linear-gradient(90deg, ${green}22, ${green})`, borderRadius: 3 }} />
      </div>
      <span
        className={`rep-hist-count ${cls}`}
        onClick={onClick}
        onKeyDown={clickable ? handleKey : undefined}
        tabIndex={clickable ? 0 : -1}
        role={clickable ? "button" : undefined}
        style={{ fontFamily: mono, fontSize: "0.68rem", color: green, fontWeight: 700, textAlign: "right" }}
      >
        {bin.count}
      </span>
    </>
  );
}

/* ─── AggregateTable — generic "group name + KPIs + bar" table ─── */
function AggregateTable({ rows, lang, nameLabel }) {
  if (!rows.length) return <div style={{ color: dim, fontSize: "0.85rem" }}>{lang === "sk" ? "Žiadne dáta." : "No data."}</div>;
  const maxUnits = Math.max(...rows.map(r => r.totalUnits), 1);
  return (
    <div className="rep-table-wrap" style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 560 }}>
        <thead>
          <tr style={{ background: bg, textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <th style={tdh}>{nameLabel}</th>
            <th style={tdhR}>{lang === "sk" ? "Projekty" : "Projects"}</th>
            <th style={tdhR}>{lang === "sk" ? "Bytov"    : "Units"}</th>
            <th style={tdhR}>{lang === "sk" ? "Voľných"  : "Available"}</th>
            <th style={tdhR}>{lang === "sk" ? "Pred. %"  : "Sold %"}</th>
            <th style={tdhR}>Ø {moneySymbol()}/m²</th>
            <th style={{ ...tdh, minWidth: 90 }}>{lang === "sk" ? "Relatívne" : "Relative"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            // Sold % is null when developer doesn't publish sold info
            // for this group at all — render "n/a" rather than a
            // misleading 0%. Everything else always renders numbers.
            const soldCell = r.soldPct == null
              ? <span style={{ color: dim, fontStyle: "italic" }}>n/a</span>
              : `${r.soldPct.toFixed(0)}%`;
            return (
              <tr key={r.name + i} className="rep-row-hoverable" style={{ borderTop: `1px solid ${border}` }}>
                <td style={tdc} title={r.name}>
                  <strong style={{ color: text }}>{r.name}</strong>
                </td>
                <td style={tdcR}>{r.projectCount}</td>
                <td style={tdcR}>{r.totalUnits.toLocaleString("en-US").replace(/,/g, " ")}</td>
                <td style={{ ...tdcR, color: green }}>{r.available.toLocaleString("en-US").replace(/,/g, " ")}</td>
                <td style={{ ...tdcR, color: orange }}>{soldCell}</td>
                <td style={tdcR}>{r.wavgM2 ? Math.round(moneyFromEur(r.wavgM2)).toLocaleString("en-US").replace(/,/g, " ") : "—"}</td>
                <td style={{ ...tdc, padding: "0.35rem 0.75rem" }}>
                  <div style={{ position: "relative", height: 10, background: bg, border: `1px solid ${border}`, borderRadius: 2 }}>
                    <div style={{ position: "absolute", inset: 0, width: `${(r.totalUnits / maxUnits) * 100}%`, background: `linear-gradient(90deg, ${green}33, ${green})`, borderRadius: 2 }} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <style>{`
        .rep-row-hoverable { transition: background 0.12s; }
        .rep-row-hoverable:hover { background: rgba(0,229,160,0.05); }
      `}</style>
    </div>
  );
}
const tdh  = { padding: "0.55rem 0.75rem", fontWeight: 700, textAlign: "left" };
const tdhR = { ...tdh, textAlign: "right" };
const tdc  = { padding: "0.45rem 0.75rem", color: "#c4c4cc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 240 };
const tdcR = { ...tdc, textAlign: "right", fontFamily: mono, color: text };

/* ─── BenchmarkCard — compares scope vs market ─── */
function BenchmarkCard({ local, global, scopeLabel, lang }) {
  if (!global || !global.totalUnits) return null;
  const delta = (metric) => {
    if (local[metric] == null || global[metric] == null || !global[metric]) return null;
    return ((local[metric] / global[metric]) - 1) * 100;
  };
  const rows = [
    { label: lang === "sk" ? `Ø ${moneySymbol()}/m² (vážené)` : `Ø ${moneySymbol()}/m² (weighted)`, local: local.wavgM2, global: global.wavgM2, delta: delta("wavgM2"), unit: `${moneySymbol()}/m²`, money: true, lowerIsGood: true },
    { label: lang === "sk" ? "Predaných %"    : "Sold %",             local: local.soldPct, global: global.soldPct, delta: (local.soldPct || 0) - (global.soldPct || 0), unit: "%",    lowerIsGood: false, absolute: true },
    { label: lang === "sk" ? "Voľných na projekt" : "Avail / project", local: local.projectCount > 0 ? local.available / local.projectCount : 0, global: global.projectCount > 0 ? global.available / global.projectCount : 0, delta: null, unit: "", lowerIsGood: false },
  ];
  return (
    <div className="rep-table-wrap" style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "0.85rem 1.1rem" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.84rem", minWidth: 440 }}>
        <thead>
          <tr style={{ color: dim, fontFamily: mono, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em", textAlign: "left" }}>
            <th style={tdh}></th>
            <th style={tdhR}>{scopeLabel}</th>
            <th style={tdhR}>{lang === "sk" ? "Porovnanie" : "Benchmark"}</th>
            <th style={tdhR}>{lang === "sk" ? "Odchýlka" : "Delta"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            let deltaColor = dim;
            if (r.delta != null && Math.abs(r.delta) > 1) {
              const goodIfPositive = !r.lowerIsGood;
              deltaColor = (r.delta > 0) === goodIfPositive ? green : red;
            }
            const sign = r.delta == null ? "" : (r.delta >= 0 ? "+" : "");
            return (
              <tr key={r.label} style={{ borderTop: i > 0 ? `1px solid ${border}` : "none" }}>
                <td style={tdc}>{r.label}</td>
                <td style={tdcR}>{r.local == null ? "—" : Math.round(r.money ? moneyFromEur(r.local) : r.local).toLocaleString("en-US").replace(/,/g, " ") + (r.unit ? " " + r.unit : "")}</td>
                <td style={tdcR}>{r.global == null ? "—" : Math.round(r.money ? moneyFromEur(r.global) : r.global).toLocaleString("en-US").replace(/,/g, " ") + (r.unit ? " " + r.unit : "")}</td>
                <td style={{ ...tdcR, color: deltaColor, fontWeight: 700 }}>
                  {r.delta == null ? "—" : `${sign}${r.delta.toFixed(1)}${r.absolute ? " pp" : "%"}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Project table (used inside City / District / Developer scopes) ───
 * Per-row counts come from the flats array (real data) when available —
 * matches summariseProjects so headline KPI and per-row numbers reconcile.
 * No-flats fallback uses each project's stav-bucket columns (also real
 * for available/reserved/etc.; sold may be inflated for manual_total
 * projects but at least the table doesn't lead with a 4000-row Slnečnice).
 */
function ProjectTable({ projects, flats, lang, onProjectClick }) {
  const haveFlats = Array.isArray(flats);
  // Pre-bucket flats by project once so per-row enrich is O(1).
  const byProject = useMemo(() => {
    if (!haveFlats) return null;
    const m = new Map();
    for (const f of flats) {
      let r = m.get(f.project_id);
      if (!r) { r = { total: 0, V: 0, P: 0, R: 0, PR: 0, future: 0, err: 0 }; m.set(f.project_id, r); }
      r.total++;
      if (f.stav === "V") r.V++;
      else if (f.stav === "P") r.P++;
      else if (f.stav === "R") r.R++;
      else if (f.stav === "PR") r.PR++;
      else if (f.stav === "Ešte nie v ponuke") r.future++;
      else if (f.stav === "ERROR") r.err++;
    }
    return m;
  }, [flats, haveFlats]);

  const enriched = projects.map(p => {
    if (haveFlats) {
      const r = byProject.get(p.id);
      const total       = r ? r.total : 0;
      const available   = r ? r.V : 0;
      const sold        = r ? r.P : 0;
      const reserved    = r ? r.R + r.PR : 0;
      const future      = r ? r.future : 0;
      const errored     = r ? r.err : 0;
      const activeTotal = total - future - errored;
      const hasSoldData = sold > 0 || reserved > 0;
      const soldPct = activeTotal > 0 && hasSoldData
        ? ((sold + reserved) / activeTotal) * 100
        : null;
      return { ...p, _realTotal: total, _realAvail: available, _realSoldPct: soldPct };
    }
    // Fallback: sum stav buckets from the project row itself.
    const total = (p.available_units || 0) + (p.sold_units || 0) + (p.reserved_units || 0) +
                  (p.prereserved_units || 0) + (p.future_units || 0) + (p.error_units || 0);
    return { ...p, _realTotal: total, _realAvail: p.available_units || 0, _realSoldPct: p.sold_percentage };
  });
  const sorted = [...enriched].sort((a, b) => b._realTotal - a._realTotal);
  const clickable = typeof onProjectClick === "function";
  return (
    <div className="rep-table-wrap" style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 680 }}>
        <thead>
          <tr style={{ background: bg, textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            <th style={tdh}>{lang === "sk" ? "Projekt" : "Project"}</th>
            <th style={tdh}>Developer</th>
            <th style={tdh}>{lang === "sk" ? "Časť" : "District"}</th>
            <th style={tdhR}>{lang === "sk" ? "Bytov" : "Units"}</th>
            <th style={tdhR}>{lang === "sk" ? "Voľných" : "Available"}</th>
            <th style={tdhR}>{lang === "sk" ? "Pred %" : "Sold %"}</th>
            <th style={tdhR}>{moneySymbol()}/m²</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, 100).map((p, i) => (
            <tr
              key={p.id}
              className={clickable ? "rep-row-clickable" : "rep-row-hoverable"}
              style={{ borderTop: i > 0 ? `1px solid ${border}` : "none", cursor: clickable ? "pointer" : "default" }}
              onClick={clickable ? () => onProjectClick(p.id) : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onProjectClick(p.id); } } : undefined}
              tabIndex={clickable ? 0 : -1}
              role={clickable ? "link" : undefined}
              title={clickable ? (lang === "sk" ? "Otvoriť projekt-report" : "Open project report") : p.name}
            >
              <td style={tdc}><strong style={{ color: text }}>{p.name}</strong></td>
              <td style={tdc}>{p.developer || "—"}</td>
              <td style={tdc}>{p.district || "—"}</td>
              <td style={tdcR}>{p._realTotal.toLocaleString("en-US").replace(/,/g, " ")}</td>
              <td style={{ ...tdcR, color: green }}>{p._realAvail.toLocaleString("en-US").replace(/,/g, " ")}</td>
              <td style={{ ...tdcR, color: orange }}>{p._realSoldPct != null ? p._realSoldPct.toFixed(0) + "%" : "—"}</td>
              <td style={tdcR}>{p.avg_price_eur_m2 ? Math.round(moneyFromEur(p.avg_price_eur_m2)).toLocaleString("en-US").replace(/,/g, " ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > 100 && (
        <div style={{ padding: "0.6rem", color: dim, fontSize: "0.75rem", textAlign: "center", fontFamily: mono }}>
          {lang === "sk" ? `Zobrazených prvých 100 z ${sorted.length}.` : `Showing top 100 of ${sorted.length}.`}
        </div>
      )}
      <style>{`
        .rep-row-clickable { transition: background 0.12s; }
        .rep-row-clickable:hover { background: rgba(0,229,160,0.08); }
        .rep-row-clickable:hover td:first-child strong { color: #00e5a0 !important; text-decoration: underline; text-underline-offset: 3px; }
        .rep-row-clickable:focus { outline: none; background: rgba(0,229,160,0.1); box-shadow: inset 0 0 0 1px #00e5a0; }
      `}</style>
    </div>
  );
}

/* ─── Historical trend — sparkline from project_snapshots ─── */
function TrendChart({ snapshots, scopePredicate, lang }) {
  // Group by snapshot_month, compute total units + sold + avail + wavg per month
  const byMonth = {};
  for (const s of snapshots) {
    if (scopePredicate && !scopePredicate(s)) continue;
    const m = s.snapshot_month;
    if (!m) continue;
    (byMonth[m] = byMonth[m] || []).push(s);
  }
  const months = Object.keys(byMonth).sort();
  if (months.length < 2) {
    return (
      <div style={{ color: dim, fontSize: "0.82rem", padding: "0.5rem 0", fontStyle: "italic" }}>
        {lang === "sk" ? "Historická séria zatiaľ obsahuje jeden mesiac — trend bude viditeľný po ďalšom behu." : "Historical series has only one month — trend emerges after the next run."}
      </div>
    );
  }
  // Sum stav-bucket columns (always-real per-flat counts) instead of
  // `total_units` so a registry-inflated month from the past doesn't
  // skew the historical trend. Avg €/m² is unweighted across snapshots
  // (simple mean of project averages) — same trade-off applies as in
  // summariseProjects's no-flats fallback.
  const series = months.map(m => {
    const rows = byMonth[m];
    const sumOf = (key) => rows.reduce((a, r) => a + (r[key] || 0), 0);
    const avail = sumOf("available_units");
    const sold  = sumOf("sold_units");
    const totalUnits = avail + sold +
      sumOf("reserved_units") + sumOf("prereserved_units") +
      sumOf("future_units")   + sumOf("error_units");
    const priced = rows.filter(r => r.avg_price_eur_m2);
    const wavg = priced.length
      ? priced.reduce((a, r) => a + r.avg_price_eur_m2, 0) / priced.length
      : null;
    return { m, totalUnits, sold, avail, wavg };
  });
  const maxUnits = Math.max(...series.map(s => s.totalUnits), 1);
  return (
    <div className="rep-table-wrap" style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "0.85rem 1rem" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem", minWidth: 480 }}>
        <thead>
          <tr style={{ color: dim, fontFamily: mono, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em", textAlign: "left" }}>
            <th style={tdh}>{lang === "sk" ? "Mesiac" : "Month"}</th>
            <th style={tdhR}>{lang === "sk" ? "Bytov"    : "Units"}</th>
            <th style={tdhR}>{lang === "sk" ? "Voľných"  : "Available"}</th>
            <th style={tdhR}>{lang === "sk" ? "Predaných" : "Sold"}</th>
            <th style={tdhR}>{moneySymbol()}/m²</th>
            <th style={{ ...tdh, minWidth: 80 }}>{lang === "sk" ? "Trend" : "Trend"}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s, i) => (
            <tr key={s.m} style={{ borderTop: i > 0 ? `1px solid ${border}` : "none" }}>
              <td style={tdc}>{s.m}</td>
              <td style={tdcR}>{s.totalUnits.toLocaleString("en-US").replace(/,/g, " ")}</td>
              <td style={{ ...tdcR, color: green }}>{s.avail.toLocaleString("en-US").replace(/,/g, " ")}</td>
              <td style={{ ...tdcR, color: orange }}>{s.sold.toLocaleString("en-US").replace(/,/g, " ")}</td>
              <td style={tdcR}>{s.wavg ? Math.round(moneyFromEur(s.wavg)).toLocaleString("en-US").replace(/,/g, " ") : "—"}</td>
              <td style={{ ...tdc, padding: "0.35rem 0.75rem" }}>
                <div style={{ position: "relative", height: 8, background: bg, border: `1px solid ${border}`, borderRadius: 2 }}>
                  <div style={{ position: "absolute", inset: 0, width: `${(s.totalUnits / maxUnits) * 100}%`, background: `linear-gradient(90deg, ${green}33, ${green})`, borderRadius: 2 }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Top-seller list (Market scope) ─── */
function TopSellerList({ projects, lang }) {
  const tops = [...projects]
    .filter(p => (p.sold_last_month || 0) > 0)
    .sort((a, b) => (b.sold_last_month || 0) - (a.sold_last_month || 0))
    .slice(0, 6);
  if (tops.length === 0) {
    return <div style={{ color: dim, fontSize: "0.85rem" }}>{lang === "sk" ? "Predajné dáta sa naplnia po ďalšom mesačnom behu." : "Velocity data populates after the next monthly run."}</div>;
  }
  return (
    <ol style={{ paddingLeft: "1.25rem", margin: 0, color: "#c0c0c8", fontSize: "0.88rem", lineHeight: 1.8 }}>
      {tops.map(p => (
        <li key={p.id}>
          <strong style={{ color: text }}>{p.name}</strong> ({p.district || "—"}) — <span style={{ color: green, fontFamily: mono, fontWeight: 700 }}>+{p.sold_last_month}</span> {lang === "sk" ? "predaných" : "sold"}
          {p.avg_price_eur_m2 && <span style={{ color: dim, fontFamily: mono }}> · {Math.round(moneyFromEur(p.avg_price_eur_m2)).toLocaleString("en-US").replace(/,/g, " ")} {moneySymbol()}/m²</span>}
        </li>
      ))}
    </ol>
  );
}

/* ─── Footer card ─── */
function FooterCard({ lang }) {
  return (
    <div className="no-print" style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "0.85rem 1.1rem", marginTop: "1.5rem" }}>
      <div style={{ fontFamily: mono, fontSize: "0.62rem", color: dim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.3rem" }}>
        {lang === "sk" ? "Čo ďalej" : "What's next"}
      </div>
      <p style={{ color: "#c0c0c8", fontSize: "0.82rem", lineHeight: 1.6, margin: 0 }}>
        {lang === "sk"
          ? "Potrebuješ špecifický uhol (časová rada, porovnanie dvoch projektov, e-mail report)? Napíš na residata@proton.me — vieme pridať."
          : "Need a specific angle (time series, side-by-side, email report)? Email residata@proton.me."}
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════
   ANALYTICAL REPORTS — three cross-cutting views over the active
   market (vs. the 5 scope-filtered reports above which slice the
   same data by Market / City / District / Project / Developer).

   Why separate from the scope tabs:
   The scope reports answer "what does THIS subset look like".
   These three answer specific business questions that span ALL
   active projects:
     · Forecast        — when will current inventory sell out
     · Comparables     — what has actually sold + at what price
     · Pricing tension — where is price/velocity out of equilibrium

   They share the same primitives (KpiStrip, ReportSection,
   AggregateTable, RowBin) so the visual language stays consistent
   with the scope reports — only the underlying analysis is
   different.
   ══════════════════════════════════════════════════════════════════ */

/* ─── 1. Sell-out forecast ──────────────────────────────────────────
   For every active project: months_to_sellout = available / velocity.
   Velocity = sold_last_month (delta from month-over-month sync).
   First month of tracking → no velocity → projects sort to the bottom
   of the table with "—" forecast and a small note explaining why.

   The forecast distribution histogram is the headline: "X projects
   will be gone in <3 months → if you're a competitor with similar
   inventory, your price has room". */
function SellOutForecastReport({ projects, lang, onOpenProject }) {
  // Compute forecast for every project. Return rows with the math
  // exposed so we can show velocity / inventory / forecast all in
  // the same row.
  const rows = projects.map(p => {
    const avail = p.available_units || 0;
    const velocity = Math.max(0, p.sold_last_month || 0);
    // Months at current velocity. Cap at 999 so the sort + format
    // logic below doesn't blow up on velocity=tiny + avail=huge.
    let months = null;
    if (velocity > 0 && avail > 0) months = Math.min(999, avail / velocity);
    else if (avail === 0)          months = 0;     // already sold out
    // velocity 0 + avail > 0 → months stays null ("no signal")

    return {
      ...p,
      forecast_months: months,
      forecast_velocity: velocity,
      forecast_remaining: avail,
      // Absorption % per month (velocity / available × 100). Useful
      // secondary metric — shows momentum independent of inventory.
      absorption_pct: avail > 0 && velocity > 0 ? (velocity / avail) * 100 : null,
    };
  });

  // Distribution buckets — months-to-sellout in business-meaningful bins.
  const buckets = [
    { key: "lt3",   labelSk: "< 3 mes.",     labelEn: "< 3 months",    color: red },
    { key: "3to6",  labelSk: "3–6 mes.",     labelEn: "3–6 months",    color: orange },
    { key: "6to12", labelSk: "6–12 mes.",    labelEn: "6–12 months",   color: "#f5d142" },
    { key: "1to2y", labelSk: "1–2 roky",     labelEn: "1–2 years",     color: green },
    { key: "gt2y",  labelSk: "> 2 roky",     labelEn: "> 2 years",     color: "#5e9bff" },
    { key: "none",  labelSk: "Bez signálu",  labelEn: "No signal",     color: dim },
  ];
  const tally = Object.fromEntries(buckets.map(b => [b.key, 0]));
  for (const r of rows) {
    if (r.forecast_months == null)      tally.none++;
    else if (r.forecast_months < 3)     tally.lt3++;
    else if (r.forecast_months < 6)     tally["3to6"]++;
    else if (r.forecast_months < 12)    tally["6to12"]++;
    else if (r.forecast_months < 24)    tally["1to2y"]++;
    else                                tally.gt2y++;
  }
  const histRows = buckets.map(b => ({
    label: lang === "sk" ? b.labelSk : b.labelEn,
    count: tally[b.key],
    pct: rows.length > 0 ? (tally[b.key] / rows.length) * 100 : 0,
    color: b.color,
  }));

  // Aggregate KPIs
  const totalAvail = rows.reduce((a, r) => a + (r.forecast_remaining || 0), 0);
  const totalVelocity = rows.reduce((a, r) => a + r.forecast_velocity, 0);
  const marketMonths = totalVelocity > 0 ? totalAvail / totalVelocity : null;
  const fastSellers = rows.filter(r => r.forecast_months != null && r.forecast_months < 6).length;

  // Sorted: shortest forecast first (most urgent), nulls go last.
  const sorted = [...rows].sort((a, b) => {
    if (a.forecast_months == null && b.forecast_months == null) return 0;
    if (a.forecast_months == null) return 1;
    if (b.forecast_months == null) return -1;
    return a.forecast_months - b.forecast_months;
  });

  // Edge-case banner for first month of tracking
  const allNoSignal = rows.length > 0 && rows.every(r => r.forecast_velocity === 0);

  return (
    <>
      <ReportSection
        label={lang === "sk" ? "Analytický report" : "Analytical report"}
        title={lang === "sk" ? "Predpoveď vypredania" : "Sell-out forecast"}
      >
        <p style={{ color: "#c0c0c8", fontSize: "0.9rem", lineHeight: 1.65, margin: "0 0 1rem" }}>
          {lang === "sk"
            ? "Pri aktuálnej rýchlosti predaja: za koľko mesiacov sa vypredá inventár každého projektu? Implicitne radené od najrýchlejších — pre konkurentov je to signál ceny, pre developerov absorpčný benchmark, pre investorov mapa kde sa kapitál točí."
            : "At the current sales pace: how many months until each project's inventory sells out? Sorted fastest-first — competitors read it as a price signal, developers as an absorption benchmark, investors as a map of where capital is rotating."}
        </p>

        {allNoSignal && (
          <div style={{
            background: `rgba(245,166,35,0.10)`, border: `1px solid ${orange}33`,
            borderRadius: 6, padding: "0.6rem 0.85rem", marginBottom: "1rem",
            color: text, fontSize: "0.82rem",
          }}>
            ⓘ {lang === "sk"
              ? "Toto je prvý mesiac sledovania — ešte nemáme month-over-month delta na výpočet velocity. Forecast sa aktivuje od ďalšieho mesačného syncu."
              : "This is our first month of tracking — no month-over-month delta yet to compute velocity. Forecasts activate after the next monthly sync."}
          </div>
        )}

        {/* Headline KPIs */}
        <div className="rep-kpi-strip" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.5rem", marginBottom: "1.25rem" }}>
          {[
            { label: lang === "sk" ? "Voľných bytov" : "Available units", value: totalAvail.toLocaleString("en-US").replace(/,/g, " "), color: green },
            { label: lang === "sk" ? "Predaných (1 mes.)" : "Sold (last mo.)", value: totalVelocity.toLocaleString("en-US").replace(/,/g, " "), color: orange },
            { label: lang === "sk" ? "Trh sa vypredá za" : "Market sell-out", value: marketMonths != null ? `${marketMonths.toFixed(1)} ${lang === "sk" ? "mes." : "mo."}` : "—" },
            { label: lang === "sk" ? "Rýchlych projektov (<6 mes.)" : "Fast sellers (<6 mo.)", value: `${fastSellers}`, color: red },
          ].map((k, i) => (
            <div key={i} style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "0.65rem 0.9rem" }}>
              <div style={{ fontSize: "0.7rem", color: dim, marginBottom: "0.2rem" }}>{k.label}</div>
              <div className="report-accent" style={{ fontSize: "1.15rem", fontWeight: 700, color: k.color || text }}>{k.value}</div>
            </div>
          ))}
        </div>
      </ReportSection>

      {/* Distribution histogram */}
      <ReportSection title={lang === "sk" ? "Rozloženie projektov podľa predpovede" : "Project distribution by forecast"}>
        <ForecastHistogram rows={histRows} lang={lang} />
      </ReportSection>

      {/* Per-project table */}
      <ReportSection title={lang === "sk" ? "Projekty zoradené podľa predpovede" : "Projects sorted by forecast"}>
        <div className="rep-table-wrap" style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 720 }}>
            <thead>
              <tr style={{ background: bg, textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                <th style={tdh}>{lang === "sk" ? "Projekt" : "Project"}</th>
                <th style={tdh}>{lang === "sk" ? "Časť" : "District"}</th>
                <th style={tdhR}>{lang === "sk" ? "Voľných" : "Available"}</th>
                <th style={tdhR}>{lang === "sk" ? "Predané (1 mes.)" : "Sold (last mo.)"}</th>
                <th style={tdhR}>{lang === "sk" ? "Mesiace" : "Months"}</th>
                <th style={tdhR}>{lang === "sk" ? "Absorpcia/mes." : "Absorption/mo."}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 100).map((p, i) => {
                const monthLabel = p.forecast_months == null
                  ? "—"
                  : p.forecast_months < 0.1
                    ? "<0.1"
                    : p.forecast_months >= 24
                      ? p.forecast_months >= 999 ? "999+" : `${(p.forecast_months / 12).toFixed(1)}r`
                      : p.forecast_months.toFixed(1);
                const monthColor = p.forecast_months == null ? dim
                  : p.forecast_months < 3 ? red
                  : p.forecast_months < 12 ? orange
                  : green;
                const clickable = !!onOpenProject;
                return (
                  <tr
                    key={p.id}
                    className={clickable ? "rep-row-clickable" : "rep-row-hoverable"}
                    style={{ borderTop: i > 0 ? `1px solid ${border}` : "none", cursor: clickable ? "pointer" : "default" }}
                    onClick={clickable ? () => onOpenProject(p.id) : undefined}
                  >
                    <td style={tdc}><strong style={{ color: text }}>{p.name}</strong></td>
                    <td style={tdc}>{p.district || "—"}</td>
                    <td style={{ ...tdcR, color: green }}>{p.forecast_remaining.toLocaleString("en-US").replace(/,/g, " ")}</td>
                    <td style={{ ...tdcR, color: orange }}>{p.forecast_velocity > 0 ? p.forecast_velocity : "—"}</td>
                    <td style={{ ...tdcR, color: monthColor, fontWeight: 700 }}>{monthLabel}</td>
                    <td style={tdcR}>{p.absorption_pct != null ? `${p.absorption_pct.toFixed(1)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sorted.length > 100 && (
            <div style={{ padding: "0.6rem", color: dim, fontSize: "0.75rem", textAlign: "center", fontFamily: mono }}>
              {lang === "sk" ? `Zobrazených prvých 100 z ${sorted.length}.` : `Showing top 100 of ${sorted.length}.`}
            </div>
          )}
        </div>
      </ReportSection>
    </>
  );
}

function ForecastHistogram({ rows, lang }) {
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "0.85rem 1rem" }}>
      {rows.map((r, i) => (
        <div
          key={i}
          className="rep-hist-row"
          style={{
            display: "grid", gridTemplateColumns: "120px 1fr 60px",
            alignItems: "center", gap: "0.6rem",
            padding: "0.35rem 0", borderTop: i > 0 ? `1px solid ${border}` : "none",
          }}
        >
          <div className="rep-hist-label" style={{ fontSize: "0.78rem", color: text, textAlign: "right", paddingRight: "0.5rem" }}>{r.label}</div>
          <div className="rep-hist-bar" style={{ background: bg, borderRadius: 3, height: 18, overflow: "hidden", position: "relative" }}>
            <div className="print-keep-bg" style={{
              width: `${(r.count / max) * 100}%`, height: "100%",
              background: `linear-gradient(90deg, ${r.color}66, ${r.color})`,
              transition: "width 0.3s",
            }} />
          </div>
          <div className="rep-hist-count" style={{ fontFamily: mono, fontSize: "0.85rem", color: text, fontWeight: 700, textAlign: "right" }}>
            {r.count} <span style={{ color: dim, fontWeight: 400, fontSize: "0.7rem" }}>({r.pct.toFixed(0)}%)</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── 2. Comparable transactions ───────────────────────────────────
   Every flat where stav='P' (sold) becomes a comparable row. Filter
   chips for quick narrowing (district, room count). Designed for
   valuers / banks who need to point at "here's what sold for €X/m²".

   Why scoped to ACTIVE projects only: comparables from paused/sold-
   out projects would be from outdated tracking — the price/availability
   isn't trustworthy without a recent sync. Active-only keeps the
   data fresh. (Once we accumulate multiple snapshot months we can
   relax this — flats from sold-out-under-tracking projects are
   genuine historical comps.) */
function ComparableTransactionsReport({ projects, lang }) {
  // Sold-with-price comparables fetched server-side (report_comparables, ~3k
  // rows) only when this tab opens — not from the old 32k global pull.
  const { units: flats, loading: compLoading } = useReportComparables();
  // Only sold flats with usable pricing (the RPC already filters this; the
  // guard stays as a belt-and-braces against any stray rows).
  const soldFlats = useMemo(() => flats.filter(f =>
    f.stav === "P" && f.cena_s_dph > 0 && f.obytna_plocha > 0
  ), [flats]);

  // Quick lookup: project metadata
  const projectById = useMemo(() => {
    const m = {};
    for (const p of projects) m[p.id] = p;
    return m;
  }, [projects]);

  // Filter state
  const districts = useMemo(
    () => uniqueSorted(soldFlats.map(f => projectById[f.project_id]?.district).filter(Boolean)),
    [soldFlats, projectById]
  );
  const [districtPick, setDistrictPick] = useState("__all__");
  const [roomPick, setRoomPick] = useState("__all__");

  const filtered = useMemo(() => {
    return soldFlats.filter(f => {
      if (districtPick !== "__all__") {
        const d = projectById[f.project_id]?.district;
        if (d !== districtPick) return false;
      }
      if (roomPick !== "__all__") {
        if (String(f.izby) !== roomPick) return false;
      }
      return true;
    });
  }, [soldFlats, projectById, districtPick, roomPick]);

  // Aggregates over filtered set
  const count = filtered.length;
  const eurM2Vals = filtered.map(f => f.cena_s_dph / f.obytna_plocha).sort((a, b) => a - b);
  const median = (arr) => arr.length === 0 ? null : (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2);
  const avgEm2 = eurM2Vals.length > 0 ? eurM2Vals.reduce((a, b) => a + b, 0) / eurM2Vals.length : null;
  const medEm2 = median(eurM2Vals);
  const minEm2 = eurM2Vals[0] || null;
  const maxEm2 = eurM2Vals[eurM2Vals.length - 1] || null;
  const totalRevenue = filtered.reduce((a, f) => a + f.cena_s_dph, 0);

  // Sort: most expensive first by default (most relevant for top-tier comps)
  const sorted = [...filtered].sort((a, b) => b.cena_s_dph - a.cena_s_dph);

  // CSV export (just for this report, scoped to filtered set)
  const downloadCsv = () => {
    // Proper RFC-4180 CSV escaping (doubles internal quotes, wraps when the
    // value carries a comma/quote/newline). Replaces the old JSON.stringify
    // hack, which emitted \" instead of "" and breaks Excel on quoted values.
    const esc = (v) => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const cols = ["project", "city", "district", "developer", "izby", "obytna_plocha_m2", "cena_eur", "eur_per_m2", "poschodie", "orientacia"];
    const head = cols.join(",");
    const rows = filtered.map(f => {
      const p = projectById[f.project_id] || {};
      // Guard against missing/zeroed area (e.g. interior nulled by the area
      // sanity guard) so eur_per_m2 never exports "Infinity"/"NaN".
      const em2 = (f.cena_s_dph > 0 && f.obytna_plocha > 0)
        ? Math.round(f.cena_s_dph / f.obytna_plocha)
        : "";
      return [
        esc(p.name),
        esc(p.city || f.city),
        esc(p.district),
        esc(p.developer),
        f.izby ?? "",
        f.obytna_plocha ?? "",
        f.cena_s_dph ?? "",
        em2,
        f.poschodie ?? "",
        esc(f.orientacia),
      ].join(",");
    });
    const csv = [head, ...rows].join("\n");
    // Prepend UTF-8 BOM so Excel renders Slovak diacritics (Žilina, Prešov,
    // Staré Mesto) correctly — was missing here while other exports have it.
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `residata-comparables-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (compLoading && soldFlats.length === 0) {
    return (
      <div style={{ padding: "2rem", color: dim, fontFamily: mono, fontSize: "0.85rem", textAlign: "center" }}>
        {lang === "sk" ? "Načítavam porovnateľné transakcie…" : "Loading comparable transactions…"}
      </div>
    );
  }

  return (
    <>
      <ReportSection
        label={lang === "sk" ? "Analytický report" : "Analytical report"}
        title={lang === "sk" ? "Porovnateľné transakcie" : "Comparable transactions"}
      >
        <p style={{ color: "#c0c0c8", fontSize: "0.9rem", lineHeight: 1.65, margin: "0 0 1rem" }}>
          {lang === "sk"
            ? "Všetky reálne predané byty (stav „P\") z aktívnej databázy. Pre valuérov, banky a stanovenie kolaterálu — tu sú porovnateľné transakcie, nie marketingové cenníky. Filtrami sa zúži výber, CSV-export pre Excel."
            : "Every actually-sold unit (stav 'P') from our active database. For valuers, banks, and collateral assessment — these are comparable transactions, not marketing list-prices. Filters narrow the set; CSV export drops into Excel."}
        </p>

        {/* Filter row */}
        <div className="no-print" style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.72rem", color: dim, letterSpacing: "0.04em", textTransform: "uppercase" }}>
            {lang === "sk" ? "Filtre" : "Filters"}
          </span>
          <select value={districtPick} onChange={e => setDistrictPick(e.target.value)} style={selectStyle}>
            <option value="__all__">{lang === "sk" ? "Všetky časti" : "All districts"}</option>
            {districts.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={roomPick} onChange={e => setRoomPick(e.target.value)} style={selectStyle}>
            <option value="__all__">{lang === "sk" ? "Všetky izbovosti" : "All room counts"}</option>
            {[1, 2, 3, 4, 5].map(n => <option key={n} value={String(n)}>{n}{lang === "sk" ? "-izb." : "-room"}</option>)}
          </select>
          <button onClick={downloadCsv} style={{
            marginLeft: "auto", background: "transparent", color: green,
            border: `1px solid ${green}55`, borderRadius: 4, padding: "0.4rem 0.8rem",
            fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit",
          }}>⬇ CSV ({count})</button>
        </div>

        {/* KPIs */}
        <div className="rep-kpi-strip" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem", marginBottom: "1.25rem" }}>
          {[
            { label: lang === "sk" ? "Predaných"  : "Sold",         value: count.toLocaleString("en-US").replace(/,/g, " "), color: green },
            { label: lang === "sk" ? `Ø ${moneySymbol()}/m²`     : `Avg ${moneySymbol()}/m²`,     value: avgEm2 ? Math.round(moneyFromEur(avgEm2)).toLocaleString("en-US").replace(/,/g, " ") : "—" },
            { label: lang === "sk" ? `Medián ${moneySymbol()}/m²`: `Median ${moneySymbol()}/m²`,  value: medEm2 ? Math.round(moneyFromEur(medEm2)).toLocaleString("en-US").replace(/,/g, " ") : "—" },
            { label: lang === "sk" ? `Min ${moneySymbol()}/m²`   : `Min ${moneySymbol()}/m²`,     value: minEm2 ? Math.round(moneyFromEur(minEm2)).toLocaleString("en-US").replace(/,/g, " ") : "—", color: green },
            { label: lang === "sk" ? `Max ${moneySymbol()}/m²`   : `Max ${moneySymbol()}/m²`,     value: maxEm2 ? Math.round(moneyFromEur(maxEm2)).toLocaleString("en-US").replace(/,/g, " ") : "—", color: orange },
            { label: lang === "sk" ? `Objem (${moneySymbol()})`  : `Volume (${moneySymbol()})`,   value: totalRevenue ? Math.round(moneyFromEur(totalRevenue)).toLocaleString("en-US").replace(/,/g, " ") : "—" },
          ].map((k, i) => (
            <div key={i} style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "0.65rem 0.9rem" }}>
              <div style={{ fontSize: "0.7rem", color: dim, marginBottom: "0.2rem" }}>{k.label}</div>
              <div className="report-accent" style={{ fontSize: "1.05rem", fontWeight: 700, color: k.color || text }}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* Transaction table */}
        {sorted.length === 0 ? (
          <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "1.5rem", textAlign: "center", color: dim, fontStyle: "italic" }}>
            {lang === "sk" ? "Žiadne predané byty pre tento filter." : "No sold units for this filter."}
          </div>
        ) : (
          <div className="rep-table-wrap" style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", minWidth: 760 }}>
              <thead>
                <tr style={{ background: bg, textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  <th style={tdh}>{lang === "sk" ? "Projekt" : "Project"}</th>
                  <th style={tdh}>{lang === "sk" ? "Časť" : "District"}</th>
                  <th style={tdhR}>{lang === "sk" ? "Izby" : "Rooms"}</th>
                  <th style={tdhR}>m²</th>
                  <th style={tdhR}>{lang === "sk" ? `Cena (${moneySymbol()})` : `Price (${moneySymbol()})`}</th>
                  <th style={tdhR}>{moneySymbol()}/m²</th>
                  <th style={tdhR}>{lang === "sk" ? "Posch." : "Floor"}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 200).map((f, i) => {
                  const p = projectById[f.project_id] || {};
                  const em2 = Math.round(f.cena_s_dph / f.obytna_plocha);
                  return (
                    <tr key={f.id || `${f.project_id}-${f.unit_id}-${i}`} style={{ borderTop: i > 0 ? `1px solid ${border}` : "none" }}>
                      <td style={tdc}><strong style={{ color: text }}>{p.name || f.project_id}</strong></td>
                      <td style={tdc}>{p.district || "—"}</td>
                      <td style={tdcR}>{f.izby || "—"}</td>
                      <td style={tdcR}>{Number(f.obytna_plocha).toFixed(1)}</td>
                      <td style={tdcR}>{Math.round(moneyFromEur(f.cena_s_dph)).toLocaleString("en-US").replace(/,/g, " ")}</td>
                      <td style={{ ...tdcR, color: orange, fontWeight: 700 }}>{Math.round(moneyFromEur(em2)).toLocaleString("en-US").replace(/,/g, " ")}</td>
                      <td style={tdcR}>{f.poschodie ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {sorted.length > 200 && (
              <div style={{ padding: "0.6rem", color: dim, fontSize: "0.75rem", textAlign: "center", fontFamily: mono }}>
                {lang === "sk" ? `Zobrazených prvých 200 z ${sorted.length}. CSV obsahuje všetky.` : `Showing top 200 of ${sorted.length}. CSV has the full set.`}
              </div>
            )}
          </div>
        )}
      </ReportSection>
    </>
  );
}

const selectStyle = {
  background: bg2, color: text, border: `1px solid ${border}`,
  borderRadius: 4, padding: "0.35rem 0.55rem", fontSize: "0.78rem",
  fontFamily: "inherit", cursor: "pointer",
};

/* ─── 3. Pricing tension ───────────────────────────────────────────
   2-axis matrix: how does each project's avg €/m² compare to the
   district median, vs. how fast it's selling?

   Quadrants:
     · TR (high price, high velocity)  = "perceived undervaluation"
       — investors love this; selling fast despite premium
     · BR (low price,  high velocity)  = "fair-priced demand"
     · TL (high price, low velocity)   = "stuck premium" (overpriced)
     · BL (low price,  low velocity)   = "weak demand"

   v1 reads ONE month at a time (no cross-month price-rise component
   yet — that activates after the second snapshot lands and we can
   compute the "rising vs. velocity" delta the user originally asked
   about). Until then it's a static positioning matrix, which is
   already a useful surface for spotting outliers. */
function PricingTensionReport({ projects, lang, onOpenProject }) {
  // PA-11: key districts by CITY+district — district names repeat across cities
  // under unified SK, so a bare district key would merge e.g. two "Centrum"s.
  // For BA today (unique district names) this is byte-identical.
  const dkey = (p) => `${p.city || ""}␟${p.district}`;
  // District-level medians, used as the x-axis baseline.
  const districtMedians = useMemo(() => {
    const byDistrict = {};
    for (const p of projects) {
      if (!p.district || !p.avg_price_eur_m2) continue;
      const k = dkey(p);
      (byDistrict[k] = byDistrict[k] || []).push(p.avg_price_eur_m2);
    }
    const out = {};
    for (const [d, vals] of Object.entries(byDistrict)) {
      const sorted = [...vals].sort((a, b) => a - b);
      out[d] = sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    }
    return out;
  }, [projects]);

  // Build dot data — only projects with both a price AND inventory.
  const dots = useMemo(() => {
    return projects
      .filter(p => p.avg_price_eur_m2 && p.available_units > 0)
      .map(p => {
        const districtMedian = districtMedians[dkey(p)];
        const premiumPct = districtMedian
          ? ((p.avg_price_eur_m2 / districtMedian) - 1) * 100
          : 0;
        const velocityPct = p.available_units > 0
          ? ((p.sold_last_month || 0) / p.available_units) * 100
          : 0;
        // Tension score: positive = high premium AND fast velocity (undervalued perceived).
        // Negative = either high premium without velocity, or low premium with velocity.
        const tensionScore = premiumPct * (velocityPct - 5);  // -5 baseline so "no sales" ≈ 0
        return { ...p, premiumPct, velocityPct, tensionScore, districtMedian };
      });
  }, [projects, districtMedians]);

  // Top 10 by tension score (most "interesting" projects)
  const topTension = [...dots].sort((a, b) => Math.abs(b.tensionScore) - Math.abs(a.tensionScore)).slice(0, 10);

  // Quadrant tallies
  const q = { TR: 0, BR: 0, TL: 0, BL: 0 };
  for (const d of dots) {
    if (d.premiumPct >= 0 && d.velocityPct >= 5)      q.TR++;
    else if (d.premiumPct < 0 && d.velocityPct >= 5)  q.BR++;
    else if (d.premiumPct >= 0 && d.velocityPct < 5)  q.TL++;
    else                                              q.BL++;
  }

  return (
    <>
      <ReportSection
        label={lang === "sk" ? "Analytický report" : "Analytical report"}
        title={lang === "sk" ? "Cenový pomer (premium vs. velocity)" : "Pricing tension (premium vs. velocity)"}
      >
        <p style={{ color: "#c0c0c8", fontSize: "0.9rem", lineHeight: 1.65, margin: "0 0 1rem" }}>
          {lang === "sk"
            ? "Matrix: ako stojí €/m² každého projektu voči mediánu jeho časti mesta (X), proti rýchlosti predaja % za mesiac (Y). Pravý-horný kvadrant = projekty čo sa predávajú napriek prémii — investorský signál „perceived undervaluation\". Krížový mesačný delta (rast ceny vs. velocity) sa aktivuje po druhom syncu — zatiaľ statický pozičný pohľad."
            : "Matrix: how each project's €/m² compares to its district median (X) vs. monthly sell-through rate (Y). Top-right = projects selling despite a premium — investor signal of \"perceived undervaluation\". Cross-month rising-price-vs-velocity delta activates after the second monthly sync — for now, a static positioning view."}
        </p>

        {/* Quadrant tallies */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.5rem", marginBottom: "1.25rem" }}>
          {[
            { label: lang === "sk" ? "↗ Prémia + predaj" : "↗ Premium + selling",     value: q.TR, color: green,  hint: lang === "sk" ? "Perceived undervaluation" : "Perceived undervaluation" },
            { label: lang === "sk" ? "↘ Lacné + predaj"  : "↘ Low + selling",         value: q.BR, color: green,  hint: lang === "sk" ? "Cenovo dostupné, ide" : "Affordable, in demand" },
            { label: lang === "sk" ? "↖ Prémia, stojí"   : "↖ Premium, stuck",        value: q.TL, color: red,    hint: lang === "sk" ? "Pravdepodobne predražené" : "Likely overpriced" },
            { label: lang === "sk" ? "↙ Lacné, stojí"    : "↙ Low, stuck",            value: q.BL, color: dim,    hint: lang === "sk" ? "Slabá poptávka" : "Weak demand" },
          ].map((k, i) => (
            <div key={i} style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "0.65rem 0.9rem" }}>
              <div style={{ fontSize: "0.7rem", color: dim, marginBottom: "0.2rem" }}>{k.label}</div>
              <div className="report-accent" style={{ fontSize: "1.15rem", fontWeight: 700, color: k.color }}>{k.value}</div>
              <div style={{ fontSize: "0.66rem", color: dim, marginTop: "0.15rem" }}>{k.hint}</div>
            </div>
          ))}
        </div>

        {/* Scatter SVG */}
        <PricingTensionScatter dots={dots} lang={lang} onOpenProject={onOpenProject} />
      </ReportSection>

      {/* Top tension list */}
      <ReportSection title={lang === "sk" ? "Najvýraznejšie napätia (top 10)" : "Highest-tension outliers (top 10)"}>
        <div className="rep-table-wrap" style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 720 }}>
            <thead>
              <tr style={{ background: bg, textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                <th style={tdh}>{lang === "sk" ? "Projekt" : "Project"}</th>
                <th style={tdh}>{lang === "sk" ? "Časť" : "District"}</th>
                <th style={tdhR}>{moneySymbol()}/m²</th>
                <th style={tdhR}>{lang === "sk" ? "vs. medián" : "vs. median"}</th>
                <th style={tdhR}>{lang === "sk" ? "Velocity %/mes." : "Velocity %/mo."}</th>
                <th style={tdhR}>{lang === "sk" ? "Signál" : "Signal"}</th>
              </tr>
            </thead>
            <tbody>
              {topTension.map((p, i) => {
                const signal = p.premiumPct >= 0 && p.velocityPct >= 5
                  ? (lang === "sk" ? "↗ Undervalued" : "↗ Undervalued")
                  : p.premiumPct >= 0 && p.velocityPct < 5
                    ? (lang === "sk" ? "↖ Predražené" : "↖ Overpriced")
                    : p.premiumPct < 0 && p.velocityPct >= 5
                      ? (lang === "sk" ? "↘ Lacné, ide" : "↘ Affordable demand")
                      : (lang === "sk" ? "↙ Slabé" : "↙ Weak");
                const signalColor = p.premiumPct >= 0 && p.velocityPct >= 5 ? green
                  : p.premiumPct >= 0 ? red
                  : p.velocityPct >= 5 ? green
                  : dim;
                const clickable = !!onOpenProject;
                return (
                  <tr
                    key={p.id}
                    className={clickable ? "rep-row-clickable" : "rep-row-hoverable"}
                    style={{ borderTop: i > 0 ? `1px solid ${border}` : "none", cursor: clickable ? "pointer" : "default" }}
                    onClick={clickable ? () => onOpenProject(p.id) : undefined}
                  >
                    <td style={tdc}><strong style={{ color: text }}>{p.name}</strong></td>
                    <td style={tdc}>{p.district || "—"}</td>
                    <td style={tdcR}>{Math.round(moneyFromEur(p.avg_price_eur_m2)).toLocaleString("en-US").replace(/,/g, " ")}</td>
                    <td style={{ ...tdcR, color: p.premiumPct >= 0 ? orange : green, fontWeight: 700 }}>
                      {p.premiumPct >= 0 ? "+" : ""}{p.premiumPct.toFixed(1)}%
                    </td>
                    <td style={{ ...tdcR, color: p.velocityPct >= 5 ? green : dim }}>{p.velocityPct.toFixed(1)}%</td>
                    <td style={{ ...tdcR, color: signalColor, fontWeight: 700 }}>{signal}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {topTension.length === 0 && (
            <div style={{ padding: "1.5rem", textAlign: "center", color: dim, fontStyle: "italic" }}>
              {lang === "sk"
                ? "Nedostatok dát na výpočet napätí (žiadne projekty so zverejnenou cenou aj inventárom)."
                : "Not enough data to compute tensions (no projects with both published price and inventory)."}
            </div>
          )}
        </div>
      </ReportSection>
    </>
  );
}

function PricingTensionScatter({ dots, lang, onOpenProject }) {
  const W = 880, H = 420;
  const padL = 64, padR = 24, padT = 24, padB = 56;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  if (dots.length === 0) {
    return (
      <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "1.5rem", textAlign: "center", color: dim, fontStyle: "italic" }}>
        {lang === "sk" ? "Žiadne body pre scatter graf." : "No data points for scatter."}
      </div>
    );
  }

  // Symmetric x range (-X, +X) so 0 is centered.
  const maxAbsPremium = Math.max(20, ...dots.map(d => Math.abs(d.premiumPct)));
  const maxVelocity = Math.max(15, ...dots.map(d => d.velocityPct));
  const xScale = (px) => padL + innerW * 0.5 + (px / maxAbsPremium) * (innerW * 0.5);
  const yScale = (vy) => padT + innerH - (vy / maxVelocity) * innerH;

  const xAxis = padT + innerH;
  const yAxis = padL + innerW * 0.5;

  return (
    <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, padding: "0.75rem" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {/* Quadrant fills */}
        <rect x={padL} y={padT}             width={innerW * 0.5} height={innerH * 0.5} fill="rgba(255,107,107,0.04)"/>
        <rect x={padL + innerW * 0.5} y={padT}             width={innerW * 0.5} height={innerH * 0.5} fill="rgba(0,229,160,0.06)"/>
        <rect x={padL} y={padT + innerH * 0.5} width={innerW * 0.5} height={innerH * 0.5} fill="rgba(138,138,150,0.04)"/>
        <rect x={padL + innerW * 0.5} y={padT + innerH * 0.5} width={innerW * 0.5} height={innerH * 0.5} fill="rgba(0,229,160,0.04)"/>

        {/* Axes */}
        <line x1={padL} y1={xAxis} x2={W - padR} y2={xAxis} stroke={dim} strokeWidth="1"/>
        <line x1={yAxis} y1={padT} x2={yAxis} y2={padT + innerH} stroke={dim} strokeWidth="1"/>

        {/* Grid + tick labels (X: -X%, 0, +X%) */}
        {[-1, -0.5, 0, 0.5, 1].map((t, i) => {
          const x = xScale(t * maxAbsPremium);
          return (
            <g key={i}>
              <line x1={x} y1={padT} x2={x} y2={padT + innerH} stroke={border} strokeDasharray="2,3"/>
              <text x={x} y={padT + innerH + 16} fill={dim} fontSize="10" textAnchor="middle" fontFamily={mono}>
                {t === 0 ? (lang === "sk" ? "medián" : "median") : `${t > 0 ? "+" : ""}${(t * maxAbsPremium).toFixed(0)}%`}
              </text>
            </g>
          );
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const y = yScale(t * maxVelocity);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke={border} strokeDasharray="2,3"/>
              <text x={padL - 8} y={y} fill={dim} fontSize="10" textAnchor="end" dominantBaseline="middle" fontFamily={mono}>
                {(t * maxVelocity).toFixed(0)}%
              </text>
            </g>
          );
        })}

        {/* Dots — color by quadrant */}
        {dots.map((d, i) => {
          const cx = xScale(Math.max(-maxAbsPremium, Math.min(maxAbsPremium, d.premiumPct)));
          const cy = yScale(Math.max(0, Math.min(maxVelocity, d.velocityPct)));
          const fill = d.premiumPct >= 0 && d.velocityPct >= 5 ? green
            : d.premiumPct >= 0 ? red
            : d.velocityPct >= 5 ? green
            : dim;
          const onClick = onOpenProject ? () => onOpenProject(d.id) : undefined;
          return (
            <g key={d.id || i} style={{ cursor: onClick ? "pointer" : "default" }} onClick={onClick}>
              <circle cx={cx} cy={cy} r={Math.min(12, 4 + Math.sqrt(d.available_units || 0) * 0.5)}
                      fill={fill} opacity="0.65" stroke={fill} strokeWidth="1.2">
                <title>{`${d.name} (${d.district || "?"})\n${moneySymbol()}/m²: ${Math.round(moneyFromEur(d.avg_price_eur_m2)).toLocaleString("sk-SK")} (${d.premiumPct >= 0 ? "+" : ""}${d.premiumPct.toFixed(1)}% vs ${lang === "sk" ? "medián" : "median"})\nVelocity: ${d.velocityPct.toFixed(1)} %/mes.\nVoľných: ${d.available_units}`}</title>
              </circle>
            </g>
          );
        })}

        {/* Quadrant labels (faint, top-corners) */}
        <text x={padL + innerW * 0.25} y={padT + 16} fill={red} fontSize="11" textAnchor="middle" fontFamily={mono} opacity="0.7">
          {lang === "sk" ? "↖ Prémia, stojí" : "↖ Premium, stuck"}
        </text>
        <text x={padL + innerW * 0.75} y={padT + 16} fill={green} fontSize="11" textAnchor="middle" fontFamily={mono} opacity="0.85">
          {lang === "sk" ? "↗ Prémia + predaj" : "↗ Premium + selling"}
        </text>
        <text x={padL + innerW * 0.25} y={padT + innerH - 4} fill={dim} fontSize="11" textAnchor="middle" fontFamily={mono} opacity="0.7">
          {lang === "sk" ? "↙ Lacné, stojí" : "↙ Low, stuck"}
        </text>
        <text x={padL + innerW * 0.75} y={padT + innerH - 4} fill={green} fontSize="11" textAnchor="middle" fontFamily={mono} opacity="0.7">
          {lang === "sk" ? "↘ Lacné + predaj" : "↘ Low + selling"}
        </text>

        {/* Axis titles */}
        <text x={padL + innerW * 0.5} y={H - 8} fill={text} fontSize="11" textAnchor="middle" fontFamily={mono}>
          {moneySymbol()}/m² {lang === "sk" ? "vs. medián časti mesta" : "vs. district median"}
        </text>
        <text x={16} y={padT + innerH * 0.5} fill={text} fontSize="11" textAnchor="middle" fontFamily={mono}
              transform={`rotate(-90 16 ${padT + innerH * 0.5})`}>
          {lang === "sk" ? "Velocity (% predaných z voľných za mesiac)" : "Velocity (% of available sold per month)"}
        </text>
      </svg>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════════
   Analytics helpers — pure functions
   ══════════════════════════════════════════════════════════════════ */
function uniqueSorted(arr) {
  return Array.from(new Set(arr)).sort((a, b) => String(a).localeCompare(String(b), "sk"));
}
/* DB carries `district` but not `city`. Fold Bratislava's five okresy
   ("Bratislava I…V") back into a single city label; everything else
   passes through unchanged (city == district when not Bratislava). */
function inferCity(district) {
  if (!district) return null;
  const s = String(district).trim();
  if (/^Bratislava\b/i.test(s)) return "Bratislava";
  if (/^Košice\b/i.test(s))     return "Košice";
  if (/^Prešov\b/i.test(s))     return "Prešov";
  if (/^Žilina\b/i.test(s))     return "Žilina";
  if (/^Nitra\b/i.test(s))      return "Nitra";
  if (/^Trnava\b/i.test(s))     return "Trnava";
  if (/^Banská Bystrica\b/i.test(s)) return "Banská Bystrica";
  if (/^Trenčín\b/i.test(s))    return "Trenčín";
  return s;
}
function summariseProjects(projects, flats) {
  // === Single source of truth: the flats array ===
  //
  // When `flats` is provided, every unit metric is counted directly
  // from individual flat rows — REAL data, no registry inflation.
  //
  // Why this matters: a few projects in the registry (Slnečnice = 4000,
  // Bory etc.) carry a `manual_total` override that gets stored as
  // `projects.total_units` and a derived `projects.sold_units` even
  // though we only actually track ~50 flats per such project in the DB.
  // Summing `p.total_units` for KPIs would inflate the headline count
  // by ~5-10k. Counting from `flats.length` instead gives the honest
  // "what we actually have data on" number.
  //
  // Fields per project (sync_to_supabase.py::aggregate_project):
  //   - total_units, sold_units, sold_percentage  → may be inflated
  //     when manual_total override applied
  //   - available_units, reserved_units, prereserved_units,
  //     future_units, error_units                 → ALWAYS real
  //     (counted from stav per project, never overridden)
  //   - sold_last_month                           → real (per-flat
  //     stav transition counting, no registry math)
  //
  // So sold30 keeps coming from project rows (it's a real per-project
  // delta), and projectCount is just `projects.length`. Everything
  // else is rebuilt from flats.
  const haveFlats = Array.isArray(flats);

  if (haveFlats) {
    const total       = flats.length;
    const available   = flats.filter(f => f.stav === "V").length;
    const sold        = flats.filter(f => f.stav === "P").length;
    const reserved    = flats.filter(f => f.stav === "R").length;
    const prereserved = flats.filter(f => f.stav === "PR").length;
    const future      = flats.filter(f => f.stav === "Ešte nie v ponuke").length;
    const errored     = flats.filter(f => f.stav === "ERROR").length;
    // 30-day velocity stays per-project (real, computed from stav
    // transitions in the sync). Sum across the projects in scope.
    const sold30      = projects.reduce((a, p) => a + (p.sold_last_month || 0), 0);
    // Active denominator excludes "future" + "error" — same convention
    // as sync's aggregate_project so % matches across surfaces.
    const activeTotal = total - future - errored;
    const hasSoldData = sold > 0 || reserved > 0 || prereserved > 0;
    const soldPct = activeTotal > 0 && hasSoldData
      ? ((sold + reserved + prereserved) / activeTotal) * 100
      : null;
    // Avg €/m² as simple arithmetic mean of per-flat €/m² across
    // FOR-SALE flats (V/R/PR). Sold (P) flats are excluded — ~11% of
    // them retain a price field but those are old transactions that
    // bias the headline downward. Matches projects_live.avg_price_eur_m2
    // which filters the same way at the DB layer.
    const m2List = flats
      .filter(f => (f.stav === "V" || f.stav === "R" || f.stav === "PR")
                && f.cena_s_dph > 0 && f.obytna_plocha > 0)
      .map(f => f.cena_s_dph / f.obytna_plocha);
    const wavgM2 = m2List.length
      ? m2List.reduce((a, b) => a + b, 0) / m2List.length
      : null;
    return {
      projectCount: projects.length,
      totalUnits: total,
      available,
      sold,
      reserved: reserved + prereserved,
      sold30,
      soldPct,
      wavgM2,
      hasUnitData: total > 0,
    };
  }

  // === Fallback path: no flats array (e.g. snapshot-only contexts) ===
  //
  // Sum stav-bucket columns instead of `total_units` so registry
  // overrides don't inflate the result here either. `sold_units` is
  // still inflated for manual_total projects in this branch — there's
  // no clean way to recover the real sold count without flats — but
  // the headline `totalUnits` at least matches the sum of buckets we
  // can count, not the registry plan.
  const sumOf = (key) => projects.reduce((a, p) => a + (p[key] || 0), 0);
  const available   = sumOf("available_units");
  const sold        = sumOf("sold_units");
  const reserved    = sumOf("reserved_units");
  const prereserved = sumOf("prereserved_units");
  const future      = sumOf("future_units");
  const errored     = sumOf("error_units");
  const sold30      = sumOf("sold_last_month");
  const totalUnits  = available + sold + reserved + prereserved + future + errored;
  const activeTotal = totalUnits - future - errored;
  const hasSoldData = sold > 0 || reserved > 0 || prereserved > 0;
  const soldPct = activeTotal > 0 && hasSoldData
    ? ((sold + reserved + prereserved) / activeTotal) * 100
    : null;
  // Unit-weighted mean of per-project avg €/m² (weight = for-sale unit count).
  // projects_live.avg_price_eur_m2 is each project's mean over its V/R/PR units,
  // so weighting by that count recovers the EXACT global mean of per-flat €/m²
  // the old flats-based path computed (mean of all = size-weighted mean of group
  // means). projects_live verified honest in v2, so this matches to the unit.
  let _wsum = 0, _wn = 0;
  for (const p of projects) {
    if (!p.avg_price_eur_m2) continue;
    const fs = (p.available_units || 0) + (p.reserved_units || 0) + (p.prereserved_units || 0);
    if (fs <= 0) continue;
    _wsum += p.avg_price_eur_m2 * fs;
    _wn += fs;
  }
  const wavgM2 = _wn > 0 ? _wsum / _wn : null;
  return {
    projectCount: projects.length,
    totalUnits,
    available,
    sold,
    reserved: reserved + prereserved,
    sold30,
    soldPct,
    wavgM2,
    hasUnitData: projects.length > 0 && totalUnits > 0,
  };
}
function groupAggregates(projects, key, lang, allFlats) {
  // Bucket projects by the group key (district / developer / etc),
  // then compute each bucket's totals from ITS subset of flats. This
  // is the fix for the "Penta: 984 units / 0 avail / 0% sold" bug in
  // the Top-Developers table — if we don't pass flats, summariseProjects
  // falls back to sum(p.total_units) which contains registry totals
  // for projects where we track 0 flats (Slnečnice/Bory/Penta portfolio),
  // producing rows that mix registry inventory with scraped availability.
  //
  // Passing flats means every column (units / available / sold / %) is
  // computed from the same source of truth. Buckets with zero tracked
  // flats get all zeros + hasUnitData=false → renders as "—" in the
  // table (handled by AggregateTable) instead of misleading 0% cells.
  const haveFlats = Array.isArray(allFlats);
  const unknown = (lang === "sk" ? "(neznáme)" : "(unknown)");
  // PA-11: district names repeat across cities — "Centrum" exists in BOTH Košice
  // and Žilina, "Dunajská Streda" in two towns, and SK already spans 28 cities.
  // (1) Bucket KNOWN districts by CITY+district so same-named ones never merge;
  //     unknown-district projects share ONE bucket (not one per city).
  // (2) Qualify the DISPLAY name with the city only when a district name COLLIDES
  //     across cities, so two "Centrum" rows aren't indistinguishable while
  //     single-city districts keep their clean bare name.
  const buckets = {};
  for (const p of projects) {
    const dname = p[key] || unknown;
    const bkey = (key === "district" && p[key]) ? `${p.city || ""}␟${p[key]}` : dname;
    (buckets[bkey] = buckets[bkey] || []).push(p);
  }
  // district name → set of cities it appears in (collision detection)
  const distCities = {};
  if (key === "district") {
    for (const bkey of Object.keys(buckets)) {
      const sep = bkey.indexOf("␟");
      if (sep < 0) continue; // the shared unknown bucket
      const city = bkey.slice(0, sep), dn = bkey.slice(sep + 1);
      (distCities[dn] = distCities[dn] || new Set()).add(city);
    }
  }
  return Object.entries(buckets)
    .map(([bkey, ps]) => {
      const city = key === "district" ? (ps[0].city || null) : null;
      let name;
      if (key === "district") {
        const dn = ps[0][key];                       // falsy → the unknown bucket
        name = !dn ? unknown
             : (city && (distCities[dn]?.size || 0) > 1) ? `${dn} (${city})` : dn;
      } else {
        name = bkey;
      }
      const cityField = key === "district" ? { city: ps[0][key] ? city : null } : {};
      let bucketFlats;
      if (haveFlats) {
        const ids = new Set(ps.map(p => p.id));
        bucketFlats = allFlats.filter(f => ids.has(f.project_id));
      }
      return { name, ...cityField, ...summariseProjects(ps, bucketFlats) };
    })
    // Rank by REAL tracked units (bucketFlats.length) descending. If
    // all buckets have no flats at all (caller didn't pass allFlats),
    // totalUnits falls back to the project-registry sum, same as before.
    .sort((a, b) => b.totalUnits - a.totalUnits);
}
/* Group aggregates from raw flats (for Project report's by-izby/typ/poschodie).
   For numeric-looking keys (izby, poschodie) we sort numerically so
   1,2,3,4,10 doesn't come back as 1,10,2,3,4. */
function groupAggregatesFromFlats(flats, key) {
  const buckets = {};
  for (const f of flats) {
    const k = f[key] == null || f[key] === "" ? "(—)" : String(f[key]);
    (buckets[k] = buckets[k] || []).push(f);
  }
  const sumPriceM2 = (rows) => {
    // Weighted avg €/m² of for-sale flats only (V/R/PR). Sold flats
    // sometimes retain a price but those are historical and bias
    // the average downward — same fix as summariseProjects above.
    let sp = 0, sm = 0;
    for (const r of rows) {
      const stav = (r.stav || "").trim().toUpperCase();
      if (stav !== "V" && stav !== "R" && stav !== "PR") continue;
      const p = Number(r.cena_s_dph), m = Number(r.obytna_plocha);
      if (!Number.isFinite(p) || !Number.isFinite(m) || m <= 0) continue;
      sp += p; sm += m;
    }
    return sm > 0 ? sp / sm : null;
  };
  // Numeric keys (izby, poschodie) should sort naturally (1, 2, 3, 10) —
  // otherwise string sort gives the Excel-y 1, 10, 11, 2 pattern.
  const isNumeric = ["izby", "poschodie"].includes(key);
  return Object.entries(buckets)
    .map(([name, rows]) => {
      const sold = rows.filter(r => (r.stav || "").trim().toUpperCase() === "P").length;
      const avail = rows.filter(r => (r.stav || "").trim().toUpperCase() === "V").length;
      const totalUnits = rows.length;
      return {
        name, projectCount: new Set(rows.map(r => r.project_id)).size,
        totalUnits, available: avail, sold, soldPct: totalUnits ? (sold / totalUnits) * 100 : 0,
        wavgM2: sumPriceM2(rows),
      };
    })
    .sort((a, b) => {
      if (isNumeric) {
        const na = parseFloat(a.name), nb = parseFloat(b.name);
        // NaN names (like "(—)") drop to the end regardless of direction
        if (Number.isNaN(na) && Number.isNaN(nb)) return 0;
        if (Number.isNaN(na)) return 1;
        if (Number.isNaN(nb)) return -1;
        return na - nb;
      }
      return b.totalUnits - a.totalUnits;
    });
}
/* Price distribution — bin units by €/m². For-sale flats only (V/R/PR);
   sold flats are excluded so the histogram reflects current asking
   prices, not historical transaction mix. */
/** Render a histogram bin's €/m² band in the CURRENT display currency.
 *  priceDistribution keeps from/to in EUR (so geometry + drill-down math
 *  stay consistent); this converts only the displayed boundary numbers. */
function bandLabel(bin) {
  if (!bin) return "";
  const f = Math.round(moneyFromEur(bin.from)).toLocaleString("sk-SK");
  const t = Math.round(moneyFromEur(bin.to)).toLocaleString("sk-SK");
  return `${f}–${t}`;
}

function priceDistribution(flats, nBins) {
  const values = flats
    .filter(f => f.stav === "V" || f.stav === "R" || f.stav === "PR")
    .map(f => {
      const p = Number(f.cena_s_dph), m = Number(f.obytna_plocha);
      return (Number.isFinite(p) && Number.isFinite(m) && m > 0) ? p / m : null;
    })
    .filter(v => v != null && v >= 500 && v <= 20000); // sanity clip
  if (values.length === 0) return [];
  let lo = Math.min(...values), hi = Math.max(...values);
  // Round bins to 500s for readability
  lo = Math.floor(lo / 500) * 500;
  hi = Math.ceil(hi  / 500) * 500;
  const step = Math.max(500, Math.ceil((hi - lo) / nBins / 500) * 500);
  const bins = [];
  for (let b = lo; b < hi; b += step) {
    bins.push({ from: b, to: b + step, label: `${b.toLocaleString("sk-SK")}–${(b + step).toLocaleString("sk-SK")}`, count: 0 });
  }
  for (const v of values) {
    const idx = Math.min(bins.length - 1, Math.floor((v - lo) / step));
    if (bins[idx]) bins[idx].count++;
  }
  return bins;
}
/* CSV download for the current scope — project-level. */
function downloadScopeCSV(projects, lang) {
  const headers = [
    "id", "name", "developer", "city", "district",
    "total_units", "available_units", "sold_units", "sold_last_month", "sold_percentage",
    "avg_price_eur_m2", "min_price", "max_price", "last_updated",
  ];
  const esc = (v) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const p of projects) lines.push(headers.map(h => esc(p[h])).join(","));
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `residata-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

