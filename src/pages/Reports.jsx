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
import { useProjects, useAllFlats, useProjectSnapshots } from "../lib/useData";
import { supabase } from "../lib/supabase";

// ── Visual language (mirrors Platform.jsx) ───────────────────────
const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const dim = "#8a8a96";
const text = "#e8e8ed";
const border = "#222228";
const bg = "#0a0a0b";
const bg2 = "#0e0e10";
const panel = "#14141a";
const red = "#ff6b6b";
const orange = "#f5a623";

// ── Scope definitions ────────────────────────────────────────────
const SCOPES = [
  { key: "market",     label: { sk: "Trh",          en: "Market" } },
  { key: "mesto",      label: { sk: "Mesto",        en: "City" } },
  { key: "cast",       label: { sk: "Časť mesta",   en: "District" } },
  { key: "projekt",    label: { sk: "Projekt",      en: "Project" } },
  { key: "developer",  label: { sk: "Developer",    en: "Developer" } },
];

/* ══════════════════════════════════════════════════════════════════
   Top-level Reports page. Hosts scope tabs + the picked-scope view.
   ══════════════════════════════════════════════════════════════════ */
export default function PlatformReports({ lang = "sk" }) {
  const { projects, loading: loadingProjects } = useProjects();
  const { flats,    loading: loadingFlats }    = useAllFlats();

  const [scope, setScope]         = useState("market");
  const [cityPick, setCityPick]   = useState(null);
  const [distPick, setDistPick]   = useState(null);
  const [projPick, setProjPick]   = useState(null);
  const [devPick,  setDevPick]    = useState(null);

  // Derive pickers from data. The DB schema doesn't currently carry a
  // city column — infer it from the district prefix: "Bratislava I..V"
  // all collapse to "Bratislava", others pass through (district = city).
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

  const loading = loadingProjects || loadingFlats;

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
        projects={projects} flats={flats} lang={lang}
        scope={scope}
        scopeLabel={
          scope === "mesto"     ? cityPick  :
          scope === "cast"      ? distPick  :
          scope === "developer" ? devPick   :
          scope === "projekt"   ? projPick  :  // project ID
          null
        }
      />

      {/* Scope tabs */}
      <div className="no-print" style={{
        display: "flex", gap: "0.3rem", flexWrap: "wrap",
        padding: "0.55rem 0.6rem", background: bg2, border: `1px solid ${border}`,
        borderRadius: 8, marginBottom: "1rem",
      }}>
        {SCOPES.map(s => (
          <ScopeTab key={s.key} active={scope === s.key} onClick={() => setScope(s.key)}>
            {s.label[lang] || s.label.sk}
          </ScopeTab>
        ))}
      </div>

      {/* Picker for the current scope */}
      {scope === "mesto" && (
        <PickerRow label={lang === "sk" ? "Mesto" : "City"} value={cityPick} options={cities} onChange={setCityPick} />
      )}
      {scope === "cast" && (
        <PickerRow label={lang === "sk" ? "Časť mesta" : "District"} value={distPick} options={districts} onChange={setDistPick} />
      )}
      {scope === "projekt" && (
        <PickerRow
          label={lang === "sk" ? "Projekt" : "Project"}
          value={projPick}
          options={projects.map(p => ({ value: p.id, label: p.name + (p.district ? ` (${p.district})` : "") }))}
          onChange={setProjPick}
        />
      )}
      {scope === "developer" && (
        <PickerRow label={lang === "sk" ? "Developer" : "Developer"} value={devPick} options={developers} onChange={setDevPick} />
      )}

      {/* Scope bodies */}
      {scope === "market" && (
        <MarketReport projects={projects} flats={flats} onOpenProject={openProject} lang={lang} />
      )}
      {scope === "mesto" && cityPick && (
        <FilteredReport
          scopeLabel={cityPick}
          scopeType={lang === "sk" ? "Mesto" : "City"}
          projects={projects.filter(p => cityOf(p) === cityPick)}
          flats={flats.filter(f => {
            const p = projects.find(x => x.id === f.project_id);
            return p && cityOf(p) === cityPick;
          })}
          allProjects={projects}
          allFlats={flats}
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
          projects={projects.filter(p => p.district === distPick)}
          flats={flats.filter(f => projectDistrict(f, projects) === distPick)}
          allProjects={projects}
          allFlats={flats}
          onOpenProject={openProject}
          lang={lang}
          breakdownBy="developer"
          breakdownLabel={lang === "sk" ? "podľa developera" : "by developer"}
        />
      )}
      {scope === "projekt" && projPick && (
        <ProjectReport
          project={projects.find(p => p.id === projPick)}
          flats={flats.filter(f => f.project_id === projPick)}
          siblings={projects}
          allFlats={flats}
          lang={lang}
        />
      )}
      {scope === "developer" && devPick && (
        <FilteredReport
          scopeLabel={devPick}
          scopeType={lang === "sk" ? "Developer" : "Developer"}
          projects={projects.filter(p => p.developer === devPick)}
          flats={flats.filter(f => {
            const p = projects.find(x => x.id === f.project_id);
            return p && p.developer === devPick;
          })}
          allProjects={projects}
          allFlats={flats}
          onOpenProject={openProject}
          lang={lang}
          breakdownBy="name"
          breakdownLabel={lang === "sk" ? "podľa projektu" : "by project"}
        />
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
function ReportHeader({ projects, flats, lang, scope, scopeLabel }) {
  const month = new Date().toLocaleDateString(lang === "sk" ? "sk-SK" : "en-US", { month: "long", year: "numeric" });
  const lastSync = projects[0]?.last_updated?.slice(0, 10) || new Date().toISOString().slice(0, 10);
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
            {lang === "sk" ? "Dáta k" : "Data as of"} {lastSync} · {projects.length} {lang === "sk" ? "projektov" : "projects"} · {flats.length} {lang === "sk" ? "bytov" : "units"}
          </p>
        </div>
        <div className="no-print" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <SubscribeButton scope={scope} scopeLabel={scopeLabel} lang={lang} />
          <button onClick={() => downloadScopeCSV(projects, flats, lang)}
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
function MarketReport({ projects, flats, onOpenProject, lang }) {
  const { snapshots } = useProjectSnapshots();
  const summary = useMemo(() => summariseProjects(projects, flats), [projects, flats]);
  const priceSeries = useMemo(() => priceDistribution(flats, 12), [flats]);
  const districts = useMemo(() => groupAggregates(projects, "district", lang, flats), [projects, flats, lang]);
  const developers = useMemo(() => groupAggregates(projects, "developer", lang, flats).slice(0, 8), [projects, flats, lang]);

  const title = lang === "sk" ? "Slovenský trh novostavieb" : "Slovak new-build market";

  return (
    <>
      <KpiStrip summary={summary} lang={lang} />

      <ReportSection label={lang === "sk" ? "Executive summary" : "Executive summary"} title={title}>
        <ExecSummary summary={summary} lang={lang} extraDistrict={districts[0]} />
      </ReportSection>

      <ReportSection label={lang === "sk" ? "Rozloženie cien" : "Price distribution"} title={lang === "sk" ? "€/m² cez všetky byty \u2014 klik na pásmo otvorí zoznam bytov" : "€/m² across all units \u2014 click a band for the underlying units"}>
        <Histogram bins={priceSeries} lang={lang} unit="€/m²" flats={flats} projects={projects} onProjectClick={onOpenProject} />
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
        <ReportSection label={lang === "sk" ? "Historický trend" : "Historical trend"} title={lang === "sk" ? "Vývoj po mesiacoch" : "Month-by-month"}>
          <TrendChart snapshots={snapshots} scopePredicate={null} lang={lang} />
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
function FilteredReport({ scopeLabel, scopeType, projects, flats, allProjects, allFlats, onOpenProject, lang, breakdownBy, breakdownLabel }) {
  const { snapshots } = useProjectSnapshots();
  const summary = useMemo(() => summariseProjects(projects, flats), [projects, flats]);
  const globalSummary = useMemo(() => summariseProjects(allProjects, allFlats), [allProjects, allFlats]);
  const priceSeries = useMemo(() => priceDistribution(flats, 12), [flats]);
  const breakdown = useMemo(() => groupAggregates(projects, breakdownBy, lang, flats), [projects, flats, breakdownBy, lang]);
  const siblings = useMemo(() => groupAggregates(allProjects, breakdownBy === "developer" ? "district" : "developer", lang, allFlats).slice(0, 6), [allProjects, allFlats, breakdownBy, lang]);
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
          <Histogram bins={priceSeries} lang={lang} unit="€/m²" flats={flats} projects={projects} onProjectClick={onOpenProject} />
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
function ProjectReport({ project, flats, siblings, allFlats, lang }) {
  // Hoist all hooks before any early return to keep hook ordering stable
  // across renders (rules-of-hooks).
  const { snapshots } = useProjectSnapshots();
  const summary = useMemo(() => project ? summariseProjects([project], flats) : null, [project, flats]);
  const districtSiblings = useMemo(
    () => project ? siblings.filter(p => p.district === project.district && p.id !== project.id) : [],
    [siblings, project]
  );
  // District sibling summary: filter flats to only this district's siblings
  const districtSiblingIds = useMemo(() => new Set(districtSiblings.map(p => p.id)), [districtSiblings]);
  const districtFlats = useMemo(
    () => Array.isArray(allFlats) ? allFlats.filter(f => districtSiblingIds.has(f.project_id)) : [],
    [allFlats, districtSiblingIds]
  );
  const districtSummary = useMemo(() => summariseProjects(districtSiblings, districtFlats), [districtSiblings, districtFlats]);
  const byTyp = useMemo(() => groupAggregatesFromFlats(flats, "typ"), [flats]);
  const byIzby = useMemo(() => groupAggregatesFromFlats(flats, "izby"), [flats]);
  const byPoschodie = useMemo(() => groupAggregatesFromFlats(flats, "poschodie"), [flats]);
  const priceSeries = useMemo(() => priceDistribution(flats, 10), [flats]);

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
            {summary.wavgM2 && <> Vážený priemer <strong style={{ color: text }}>{Math.round(summary.wavgM2).toLocaleString("sk-SK")} €/m²</strong>.</>}</>
          ) : (
            <><strong style={{ color: text }}>{project.name}</strong> by <strong style={{ color: text }}>{project.developer || "—"}</strong> in <strong style={{ color: text }}>{project.district || "—"}</strong>.
            {summary.hasUnitData
              ? <> {summary.totalUnits} units, {summary.soldPct != null ? summary.soldPct.toFixed(0) : "—"}% sold.</>
              : <> Unit-level data not tracked yet (registry-only entry).</>}
            {summary.wavgM2 && <> Weighted avg <strong style={{ color: text }}>{Math.round(summary.wavgM2).toLocaleString("en-US")} €/m²</strong>.</>}</>
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
        <ReportSection label={lang === "sk" ? "Distribúcia cien" : "Price distribution"} title={lang === "sk" ? "€/m² naprieč bytmi \u2014 klik na pásmo otvorí zoznam bytov" : "€/m² across units \u2014 click a band for the underlying units"}>
          <Histogram bins={priceSeries} lang={lang} unit="€/m²" flats={flats} projects={[project]} />
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
  const soldPctLabel = summary.soldPct == null ? "—" : `${summary.soldPct.toFixed(0)}%`;
  const items = [
    { label: lang === "sk" ? "Projektov"   : "Projects",   value: summary.projectCount.toLocaleString("en-US").replace(/,/g, " ") },
    { label: lang === "sk" ? "Bytov"       : "Units",      value: summary.totalUnits.toLocaleString("en-US").replace(/,/g, " ") },
    { label: lang === "sk" ? "Voľných"     : "Available",  value: summary.available.toLocaleString("en-US").replace(/,/g, " "), color: green },
    { label: lang === "sk" ? "Predaných"   : "Sold",       value: summary.sold.toLocaleString("en-US").replace(/,/g, " "), color: orange },
    { label: lang === "sk" ? "Predaných %" : "Sold %",     value: soldPctLabel, color: orange },
    ...(summary.wavgM2 ? [{
      label: lang === "sk" ? "Ø €/m² (vážené)" : "Ø €/m² (wtd)",
      value: Math.round(summary.wavgM2).toLocaleString("en-US").replace(/,/g, " "),
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
        {summary.wavgM2 && <> Priemerná cena v scope-e je <strong style={{ color: text }}>{Math.round(summary.wavgM2).toLocaleString("sk-SK")} €/m²</strong> (vážené veľkosťou projektu).</>}
        {extraDistrict && <> Najdrahšia časť: <strong style={{ color: text }}>{extraDistrict.name}</strong>{extraDistrict.wavgM2 && <> ({Math.round(extraDistrict.wavgM2).toLocaleString("sk-SK")} €/m²)</>}.</>}
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
        {summary.wavgM2 && <> Weighted avg <strong style={{ color: text }}>{Math.round(summary.wavgM2).toLocaleString("en-US")} €/m²</strong>.</>}
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
function Histogram({ bins, lang, unit, flats, projects, onProjectClick }) {
  // ALL hooks must run on every render — putting an early return
  // between useState and useMemo changed the hook count when `bins`
  // toggled between empty and non-empty across renders (caused React
  // #310 "rendered more hooks than during the previous render" crash
  // on /app once metrics/projects had loaded). Fix: hoist every hook
  // to the top, guard with nullish arrays inside, and only do the
  // null render at the end.
  const [openBin, setOpenBin] = useState(null);   // index of currently-expanded bin, or null
  const safeBins = Array.isArray(bins) ? bins : [];
  const drillable = Array.isArray(flats) && flats.length > 0;

  // Compute the list of flats for the open bin on demand — cheap
  // filter on already-loaded data, no round-trip.
  const flatsInOpenBin = useMemo(() => {
    if (openBin == null || !drillable) return [];
    const b = safeBins[openBin];
    if (!b) return [];
    const projById = new Map((projects || []).map(p => [p.id, p]));
    const rows = [];
    for (const f of flats) {
      const price = Number(f.cena_s_dph), area = Number(f.obytna_plocha);
      if (!Number.isFinite(price) || !Number.isFinite(area) || area <= 0) continue;
      const m2 = price / area;
      if (m2 < 500 || m2 > 20000) continue;
      // Include the last bin's upper edge (to) so the max value lands
      // visibly; lower bins are [from, to).
      const inRange = openBin === safeBins.length - 1
        ? (m2 >= b.from && m2 <= b.to)
        : (m2 >= b.from && m2 < b.to);
      if (!inRange) continue;
      const p = projById.get(f.project_id);
      rows.push({
        flatId: f.id,
        projectId: f.project_id,
        project: p?.name || "—",
        district: p?.district || "—",
        izby: f.izby,
        area,
        price,
        m2: Math.round(m2),
      });
    }
    rows.sort((a, b) => a.m2 - b.m2);
    return rows;
  }, [openBin, safeBins, flats, projects, drillable]);

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
            onClick={drillable ? () => setOpenBin(openBin === i ? null : i) : undefined}
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
          rows={flatsInOpenBin}
          unit={unit}
          lang={lang}
          onClose={() => setOpenBin(null)}
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
function HistogramDrilldown({ bin, rows, unit, lang, onClose, onProjectClick }) {
  if (!bin) return null;
  const clickable = typeof onProjectClick === "function";
  const fmtEur = (v) => v == null ? "—" : Math.round(v).toLocaleString(lang === "sk" ? "sk-SK" : "en-US");
  return (
    <div style={{ marginTop: "0.75rem", border: `1px solid ${border}`, borderRadius: 8, background: bg }}>
      <div style={{ padding: "0.6rem 0.85rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", borderBottom: `1px solid ${border}`, background: "rgba(0,229,160,0.04)" }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {lang === "sk" ? "Pásmo" : "Band"} {unit ? unit : ""}
          </div>
          <div style={{ fontSize: "0.92rem", color: text, fontWeight: 600, marginTop: 2 }}>
            {bin.label}{unit ? " " + unit : ""} · <span style={{ color: green, fontFamily: mono }}>{rows.length}</span>{" "}
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
      {rows.length === 0 ? (
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
                <th style={tdhR}>{lang === "sk" ? "Cena €" : "Price €"}</th>
                <th style={tdhR}>€/m²</th>
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
        {bin.label}{unit ? " " + unit : ""}
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
            <th style={tdhR}>Ø €/m²</th>
            <th style={{ ...tdh, minWidth: 90 }}>{lang === "sk" ? "Relatívne" : "Relative"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            // `hasUnitData === false` means this row's group contains
            // only registry-only projects — we don't have flat-level
            // data for them, so rendering 0 / 0 / 0% in the numeric
            // columns is misleading (reads as "they sold nothing").
            // Render em-dash + a subtle "no data" title instead.
            const gap = r.hasUnitData === false;
            const tipGap = lang === "sk"
              ? "Projekty v tejto skupine nie sú v našom flats tracking-u (sú v registri, ale nemáme ich jednotkové dáta)."
              : "Projects in this group are registry-only — we don't have unit-level data for them yet.";
            const dashTd = { ...tdcR, color: dim, fontStyle: "italic" };
            return (
              <tr key={r.name + i} className="rep-row-hoverable" style={{ borderTop: `1px solid ${border}`, opacity: gap ? 0.7 : 1 }} title={gap ? tipGap : undefined}>
                <td style={tdc} title={r.name}>
                  <strong style={{ color: text }}>{r.name}</strong>
                  {gap && <span style={{ marginLeft: 6, fontFamily: mono, fontSize: "0.6rem", color: dim, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    · {lang === "sk" ? "registry" : "registry"}
                  </span>}
                </td>
                <td style={tdcR}>{r.projectCount}</td>
                <td style={gap ? dashTd : tdcR}>{gap ? "—" : r.totalUnits.toLocaleString("en-US").replace(/,/g, " ")}</td>
                <td style={gap ? dashTd : { ...tdcR, color: green }}>{gap ? "—" : r.available.toLocaleString("en-US").replace(/,/g, " ")}</td>
                <td style={gap ? dashTd : { ...tdcR, color: orange }}>{gap ? "—" : `${r.soldPct.toFixed(0)}%`}</td>
                <td style={tdcR}>{r.wavgM2 ? Math.round(r.wavgM2).toLocaleString("en-US").replace(/,/g, " ") : "—"}</td>
                <td style={{ ...tdc, padding: "0.35rem 0.75rem" }}>
                  <div style={{ position: "relative", height: 10, background: bg, border: `1px solid ${border}`, borderRadius: 2 }}>
                    <div style={{ position: "absolute", inset: 0, width: `${gap ? 0 : (r.totalUnits / maxUnits) * 100}%`, background: `linear-gradient(90deg, ${green}33, ${green})`, borderRadius: 2 }} />
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
    { label: lang === "sk" ? "Ø €/m² (vážené)" : "Ø €/m² (weighted)", local: local.wavgM2, global: global.wavgM2, delta: delta("wavgM2"), unit: "€/m²", lowerIsGood: true },
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
                <td style={tdcR}>{r.local == null ? "—" : Math.round(r.local).toLocaleString("en-US").replace(/,/g, " ") + (r.unit ? " " + r.unit : "")}</td>
                <td style={tdcR}>{r.global == null ? "—" : Math.round(r.global).toLocaleString("en-US").replace(/,/g, " ") + (r.unit ? " " + r.unit : "")}</td>
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

/* ─── Project table (used inside City / District / Developer scopes) ─── */
function ProjectTable({ projects, lang, onProjectClick }) {
  const sorted = [...projects].sort((a, b) => (b.total_units || 0) - (a.total_units || 0));
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
            <th style={tdhR}>€/m²</th>
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
              <td style={tdcR}>{(p.total_units || 0).toLocaleString("en-US").replace(/,/g, " ")}</td>
              <td style={{ ...tdcR, color: green }}>{(p.available_units || 0).toLocaleString("en-US").replace(/,/g, " ")}</td>
              <td style={{ ...tdcR, color: orange }}>{p.sold_percentage ? p.sold_percentage.toFixed(0) + "%" : "—"}</td>
              <td style={tdcR}>{p.avg_price_eur_m2 ? Math.round(p.avg_price_eur_m2).toLocaleString("en-US").replace(/,/g, " ") : "—"}</td>
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
  const series = months.map(m => {
    const rows = byMonth[m];
    const totalUnits = rows.reduce((a, r) => a + (r.total_units || 0), 0);
    const sold       = rows.reduce((a, r) => a + (r.sold_units || 0), 0);
    const avail      = rows.reduce((a, r) => a + (r.available_units || 0), 0);
    const priced = rows.filter(r => r.avg_price_eur_m2 && (r.total_units || 0) > 0);
    const wavg = priced.length
      ? priced.reduce((a, r) => a + r.avg_price_eur_m2 * r.total_units, 0) /
        priced.reduce((a, r) => a + r.total_units, 0)
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
            <th style={tdhR}>€/m²</th>
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
              <td style={tdcR}>{s.wavg ? Math.round(s.wavg).toLocaleString("en-US").replace(/,/g, " ") : "—"}</td>
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
          {p.avg_price_eur_m2 && <span style={{ color: dim, fontFamily: mono }}> · {Math.round(p.avg_price_eur_m2).toLocaleString("en-US").replace(/,/g, " ")} €/m²</span>}
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
function projectCity(flat, projects) {
  const p = projects.find(pp => pp.id === flat.project_id);
  return p ? (p.city || inferCity(p.district)) : null;
}
function projectDistrict(flat, projects) {
  const p = projects.find(pp => pp.id === flat.project_id);
  return p?.district || null;
}
function summariseProjects(projects, flats) {
  // Unit counts: ALWAYS prefer the REAL flats table when it's passed
  // in (same source-of-truth as the ticker metric total_units_tracked).
  // Fall back to summing projects.total_units only when the caller
  // literally didn't pass a flats array. This intentional fallback
  // over-counts for a handful of large projects whose `total_units`
  // stores a registry figure instead of tracked rows (Slnecnice=4000,
  // Bory=large) — that's the only reason to use it, and every current
  // in-app caller now passes flats, so the fallback is just defensive.
  //
  // A critical case: flats = [] (empty array, not undefined). That
  // means "we DO track these projects but currently see zero flats in
  // scope" — either the scope is empty, or the projects are registry-
  // only entries with no scraped flats. We treat empty-array as the
  // REAL answer (0/0/0), NOT as "use the inflated fallback". Returning
  // zeros prevents "Penta: 984 units / 0 avail / 0% sold" kind of
  // misleading rows where the unit count comes from a different source
  // than the availability + sold counts.
  const hasFlats = Array.isArray(flats);
  let totalUnits, available, sold, reserved;
  if (hasFlats) {
    totalUnits = flats.length;
    available  = flats.filter(f => f.stav === "V").length;
    sold       = flats.filter(f => f.stav === "P").length;
    reserved   = flats.filter(f => f.stav === "R" || f.stav === "PR").length;
  } else {
    totalUnits = projects.reduce((a, p) => a + (p.total_units || 0), 0);
    available  = projects.reduce((a, p) => a + (p.available_units || 0), 0);
    sold       = projects.reduce((a, p) => a + (p.sold_units || 0), 0);
    reserved   = 0;
  }
  const sold30 = projects.reduce((a, p) => a + (p.sold_last_month || 0), 0);
  // Data-gap flag: we trust a sold% only when we actually have unit-
  // level data (flats rows) for at least one project in the scope.
  // Without it, sold% is either 0/0 (NaN) or a division by an inflated
  // registry number — both produce misleading figures. AggregateTable
  // and KpiStrip read this flag and render "—" instead of "0%".
  const hasUnitData = totalUnits > 0;
  const soldPct = hasUnitData ? (sold / totalUnits) * 100 : null;
  // Weighted average €/m² — weight by project's total_units so large
  // projects pull the mean more than boutique ones. Always derived from
  // the projects table (flats don't carry per-unit €/m² for every row).
  const priced = projects.filter(p => p.avg_price_eur_m2 && (p.total_units || 0) > 0);
  const wavgM2 = priced.length
    ? priced.reduce((a, p) => a + p.avg_price_eur_m2 * p.total_units, 0) /
      priced.reduce((a, p) => a + p.total_units, 0)
    : null;
  return { projectCount: projects.length, totalUnits, available, sold, reserved, sold30, soldPct, wavgM2, hasUnitData };
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
  const buckets = {};
  for (const p of projects) {
    const k = p[key] || (lang === "sk" ? "(neznáme)" : "(unknown)");
    (buckets[k] = buckets[k] || []).push(p);
  }
  return Object.entries(buckets)
    .map(([name, ps]) => {
      let bucketFlats;
      if (haveFlats) {
        const ids = new Set(ps.map(p => p.id));
        bucketFlats = allFlats.filter(f => ids.has(f.project_id));
      }
      return { name, ...summariseProjects(ps, bucketFlats) };
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
    let sp = 0, sm = 0;
    for (const r of rows) {
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
/* Price distribution — bin units by €/m² */
function priceDistribution(flats, nBins) {
  const values = flats
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
function downloadScopeCSV(projects, flats, lang) {
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

