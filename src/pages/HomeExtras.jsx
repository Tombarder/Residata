import { useEffect, useRef, useState } from "react";
import { useMetrics, useProjects } from "../lib/useData";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const dim = "#8a8a96";
const border = "#222228";
const bg = "#16161a";

/* ──────────────────────────────────────────────────────────
   0. PIPELINE FLOW — rich hero-replacement visualisation
      3 fázy podľa user-stories:
        1. Collect   — "data collected from X developers and Y projects" (LIVE z DB)
        2. Standardize & Validate
        3. Deliver   — "real-time market intelligence for data-driven decisions"
      (Vedome sme nepoužili "real-time market data for data-driven decisions" —
       znie to ako "data data" v jednej vete. "Intelligence" je stronger beat.)
   ────────────────────────────────────────────────────────── */

// Stage config je teraz function of (devCount, projCount) aby headline caption
// mohol obsahovať LIVE čísla z DB. Bullets sú statické.
function buildPipelineStages(lang, devCount, projCount) {
  const en = [
    {
      key: "collect",
      title: "Collect",
      subtitle: `from ${devCount} developers · ${projCount} projects`,
      lead: `Data collected from ${devCount} developers across ${projCount.toLocaleString("en-US")} active Bratislava projects. The moment a price list updates, we catch it.`,
      bullets: [
        "YIT · Penta · JTRE · HB Reavis · Lucron · Skanska · +50 more",
        "No omissions: if it's published, it's in the dataset",
        "Runs unattended on a schedule — no human clicks required",
      ],
    },
    {
      key: "normalize",
      title: "Standardize & Validate",
      subtitle: "25 unified fields per unit",
      lead: "Every developer formats differently. We extract, deduplicate, and normalize everything into one clean, validated schema so comparisons actually work.",
      bullets: [
        "HTML → structured rows — one record per flat",
        "Project · unit · m² · €/m² · floor · orientation · status",
        "Dedup + district normalization + €/m² consistency checks",
      ],
    },
    {
      key: "publish",
      title: "Deliver",
      subtitle: "for data-driven decisions",
      lead: "Real-time market intelligence for your data-driven decisions. Delivered into wherever you already work — Google Sheets, CSV, or straight into your stack via API.",
      bullets: [
        "Google Sheets — live link, auto-refresh",
        "CSV / XLSX — into Excel, Power BI, Tableau",
        "REST API + webhooks — feed directly into your models",
      ],
    },
  ];
  const sk = [
    {
      key: "collect",
      title: "Zbierame",
      subtitle: `z ${devCount} developerov · ${projCount} projektov`,
      lead: `Dáta zbierame od ${devCount} developerov naprieč ${projCount.toLocaleString("sk-SK")} aktívnymi projektmi v Bratislave. Hneď ako developer zmení cenník, máme to.`,
      bullets: [
        "YIT · Penta · JTRE · HB Reavis · Lucron · Skanska · +50 ďalších",
        "Žiadne výnimky — ak je to verejne dostupné, je to v datasete",
        "Beží automaticky podľa plánu — žiaden manuálny zásah",
      ],
    },
    {
      key: "normalize",
      title: "Normalizácia a validácia",
      subtitle: "25 unifikovaných polí na byt",
      lead: "Každý developer formátuje inak. Extrahujeme, deduplikujeme a mapujeme všetko do jednej čistej validovanej schémy, aby porovnania dávali zmysel.",
      bullets: [
        "HTML → riadky — jeden záznam na byt",
        "Projekt · označenie · m² · €/m² · poschodie · orientácia · stav",
        "Dedup + zjednotené okresy + kontrola konzistencie €/m²",
      ],
    },
    {
      key: "publish",
      title: "Doručujeme",
      subtitle: "pre rozhodnutia podložené dátami",
      lead: "Živé trhové insighty pre vaše rozhodnutia podložené dátami. Doručíme tam, kde reálne pracujete — Google Sheets, CSV, alebo rovno do vášho systému cez API.",
      bullets: [
        "Google Sheets — live odkaz, auto-refresh",
        "CSV / XLSX — rovno do Excelu, Power BI, Tableau",
        "REST API + webhooks — napojené priamo do vašich modelov",
      ],
    },
  ];
  return lang === "sk" ? sk : en;
}

// ── Small SVG illustrations per stage (internal to PipelineFlow) ──
function StageCollect({ color }) {
  // 3×3 mriežka izometrických budov
  const buildings = [
    [30, 90, 24, 50], [62, 82, 24, 58], [94, 92, 24, 48],
    [30, 130, 24, 40], [62, 116, 24, 54], [94, 128, 24, 42],
    [30, 166, 24, 32], [62, 156, 24, 42], [94, 164, 24, 34],
  ];
  return (
    <svg viewBox="0 0 170 200" style={{ width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id="c-wall" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2a2a32" />
          <stop offset="1" stopColor="#14141a" />
        </linearGradient>
      </defs>
      {buildings.map(([x, y, w, h], i) => (
        <g key={i}>
          <rect x={x} y={y} width={w} height={h} fill="url(#c-wall)" stroke="#333" strokeWidth="0.4" />
          <polygon points={`${x},${y} ${x + 6},${y - 4} ${x + w + 6},${y - 4} ${x + w},${y}`} fill="#3a3a44" stroke="#444" strokeWidth="0.4" />
          <polygon points={`${x + w},${y} ${x + w + 6},${y - 4} ${x + w + 6},${y + h - 4} ${x + w},${y + h}`} fill="#0e0e10" stroke="#222" strokeWidth="0.4" />
          {Array.from({ length: Math.floor(h / 8) }).map((_, row) => (
            <rect key={row} x={x + 4} y={y + 4 + row * 8} width={w - 8} height={3} fill={Math.random() > 0.6 ? color : "#1a1a20"} opacity="0.7" />
          ))}
        </g>
      ))}
      {/* subtle ground shadow */}
      <ellipse cx="85" cy="200" rx="70" ry="6" fill="#000" opacity="0.3" />
    </svg>
  );
}

function StageNormalize({ color }) {
  // Table look: 5 headers + 4 rows
  const headers = ["projekt", "m²", "€/m²", "stav"];
  const rows = [
    ["Slnečnice", "68.4", "3,650", "V"],
    ["Ružinov",   "82.1", "4,120", "V"],
    ["Zwirn",     "95.6", "5,200", "P"],
    ["RNDZ",      "34.8", "4,580", "R"],
  ];
  const colX = [14, 74, 100, 138];
  const statusColor = { V: color, P: "#f5a623", R: "#888" };
  return (
    <svg viewBox="0 0 170 200" style={{ width: "100%", height: "100%" }}>
      <rect x="8" y="24" width="154" height="162" rx="6" fill="#0a0a0b" stroke="#222" strokeWidth="0.6" />
      {/* header row */}
      <rect x="8" y="24" width="154" height="22" fill="#111113" />
      {headers.map((h, i) => (
        <text key={h} x={colX[i]} y="38" fill={dim} fontFamily={mono} fontSize="8" letterSpacing="0.05em">
          {h}
        </text>
      ))}
      {/* rows */}
      {rows.map((r, ri) => (
        <g key={ri}>
          <line x1="8" y1={46 + ri * 28} x2="162" y2={46 + ri * 28} stroke="#1a1a1f" strokeWidth="0.5" />
          {r.map((cell, ci) => (
            <text key={ci} x={colX[ci]} y={62 + ri * 28}
              fill={ci === 3 ? statusColor[cell] : "#e8e8ed"}
              fontFamily={ci === 0 ? "'Outfit', sans-serif" : mono}
              fontSize={ci === 0 ? "9" : "8.5"}
              fontWeight={ci === 3 ? 700 : 400}
            >{cell}</text>
          ))}
        </g>
      ))}
      {/* schema badge */}
      <rect x="8" y="170" width="154" height="18" fill={color} opacity="0.08" />
      <text x="14" y="182" fill={color} fontFamily={mono} fontSize="8" letterSpacing="0.06em">25 fields · deduped · indexed</text>
    </svg>
  );
}

function StagePublish({ color }) {
  return (
    <svg viewBox="0 0 170 200" style={{ width: "100%", height: "100%" }}>
      {/* Mini dashboard */}
      <rect x="14" y="24" width="142" height="90" rx="6" fill="#0a0a0b" stroke="#222" strokeWidth="0.6" />
      {/* mini chart line */}
      <polyline points="22,95 42,75 62,82 82,55 102,60 122,38 148,52" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
      {[22, 42, 62, 82, 102, 122, 148].map((x, i) => (
        <circle key={i} cx={x} cy={[95,75,82,55,60,38,52][i]} r="1.8" fill="#0a0a0b" stroke={color} strokeWidth="1" />
      ))}
      <text x="22" y="44" fill={dim} fontFamily={mono} fontSize="7" letterSpacing="0.04em">€/M² · 6M TREND</text>
      <text x="22" y="110" fill={dim} fontFamily={mono} fontSize="7">+12% YoY</text>

      {/* Export chips */}
      {[
        { x: 14, label: "Sheets" },
        { x: 64, label: "CSV" },
        { x: 104, label: "API" },
      ].map((c, i) => (
        <g key={c.label}>
          <rect x={c.x} y="130" width={i === 0 ? 46 : i === 1 ? 36 : 52} height="22" rx="4"
            fill="#0e0e10" stroke={color} strokeWidth="0.8" strokeOpacity="0.6" />
          <text x={c.x + 6} y="145" fill={color} fontFamily={mono} fontSize="8" fontWeight="700" letterSpacing="0.05em">
            {c.label}
          </text>
        </g>
      ))}
      {/* delivery note */}
      <text x="14" y="172" fill={dim} fontFamily={mono} fontSize="7" letterSpacing="0.04em">MONTHLY · AUTO-REFRESH</text>
      <text x="14" y="184" fill={dim} fontFamily={mono} fontSize="7" letterSpacing="0.04em">or WEEKLY on demand</text>
    </svg>
  );
}

// Middle stage (Standardize & Validate) kombinuje dovtedajšie Parse + Normalize.
// Vizuálne použijeme "Normalize" kartu — ukazuje tabuľku s unified fields,
// čo je najlepší reprezentant oboch krokov. Parse kartu vyhradíme pre budúce
// iterácie (napr. detailný breakdown na sub-stránke).
const STAGE_RENDER = {
  collect: StageCollect,
  normalize: StageNormalize,   // slúži ako "Standardize & Validate"
  publish: StagePublish,
};

export function PipelineFlow({ lang = "en" }) {
  // Live čísla z DB — developer count je derived z unique `developer` fieldu
  // v projects tabuľke. Ak field chýba / je null, fallback na konštantu (60),
  // aby sme neukazovali "0 developers" počas loading-u alebo pri prázdnej DB.
  const { projects } = useProjects();
  const uniqueDevs = new Set(projects.map(p => p.developer).filter(Boolean)).size;
  const devCount = uniqueDevs > 0 ? uniqueDevs : 60;
  const projCount = projects.length > 0 ? projects.length : 142;

  const stages = buildPipelineStages(lang, devCount, projCount);
  const label = lang === "sk" ? "Ako to celé funguje" : "How the pipeline works";
  const title = lang === "sk"
    ? "Od rozhádzaných webov k živému trhovému prehľadu."
    : "From scattered sites to live market intelligence.";
  const sub = lang === "sk"
    ? "Plne automatizovaná pipeline. 3 fázy, každý mesiac, bez výnimiek — reálne čísla, žiadne kliky."
    : "Fully automated pipeline. 3 stages, every month, no exceptions — real numbers, zero clicks.";
  const statsLabel = lang === "sk"
    ? ["developerov sledovaných", "aktívnych projektov", "bytov v datasete", "polí na byt"]
    : ["developers tracked", "active projects", "units in dataset", "fields per unit"];

  return (
    <section style={{ padding: "3rem 2rem 5rem", maxWidth: 1280, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
        <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          {label}
        </div>
        <h2 style={{ fontSize: "clamp(1.8rem, 3.2vw, 2.4rem)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15, color: "#e8e8ed", margin: 0 }}>
          {title}
        </h2>
        <p style={{ color: dim, fontSize: "1rem", marginTop: "0.9rem", maxWidth: 700, margin: "0.9rem auto 0", lineHeight: 1.65 }}>
          {sub}
        </p>
      </div>

      {/* Stage cards grid + connecting flow lines */}
      <div className="pipeline-grid" style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "1rem",
        position: "relative",
        marginBottom: "2rem",
      }}>
        {stages.map((st, i) => {
          const Illustration = STAGE_RENDER[st.key];
          return (
            <div key={st.key} style={{
              position: "relative",
              background: "#0e0e10",
              border: `1px solid ${border}`,
              borderRadius: 12,
              padding: "1.25rem 1.25rem 1.1rem",
              display: "flex", flexDirection: "column",
              transition: "border-color 0.3s, transform 0.3s, box-shadow 0.3s",
            }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = green;
                e.currentTarget.style.transform = "translateY(-3px)";
                e.currentTarget.style.boxShadow = "0 10px 32px rgba(0,229,160,0.08)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = border;
                e.currentTarget.style.transform = "";
                e.currentTarget.style.boxShadow = "";
              }}
            >
              {/* Stage number badge */}
              <div style={{
                position: "absolute", top: "0.85rem", right: "0.95rem",
                fontFamily: mono, fontSize: "0.6rem",
                color: green, letterSpacing: "0.08em",
                border: `1px solid ${green}`, borderRadius: 4,
                padding: "0.1rem 0.4rem",
                background: "rgba(0,229,160,0.08)",
                fontWeight: 700,
              }}>{String(i + 1).padStart(2, "0")}</div>

              {/* SVG illustration */}
              <div style={{ height: 160, marginBottom: "0.6rem" }}>
                <Illustration color={green} />
              </div>

              {/* Title */}
              <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "#fff", letterSpacing: "-0.01em" }}>
                {st.title}
              </div>
              <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, marginTop: "0.2rem", letterSpacing: "0.04em" }}>
                {st.subtitle}
              </div>

              {/* Lead sentence */}
              <p style={{ fontSize: "0.84rem", color: "#c0c0c8", lineHeight: 1.55, marginTop: "0.7rem", marginBottom: "0.8rem" }}>
                {st.lead}
              </p>

              {/* Bullets */}
              <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {st.bullets.map((b, bi) => (
                  <li key={bi} style={{ display: "flex", gap: "0.4rem", fontSize: "0.75rem", color: dim, lineHeight: 1.5, marginBottom: "0.3rem", alignItems: "flex-start" }}>
                    <span style={{ color: green, flexShrink: 0, marginTop: "0.05rem" }}>→</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>

              {/* Forward arrow (between cards — hidden on last) */}
              {i < stages.length - 1 && (
                <div className="pipeline-arrow" style={{
                  position: "absolute",
                  right: "-1.4rem", top: "45%",
                  width: "1.6rem", height: "2px",
                  background: `linear-gradient(90deg, ${border}, ${green})`,
                  zIndex: 2,
                }}>
                  <div style={{
                    position: "absolute", right: "-4px", top: "-3px",
                    width: 8, height: 8, borderRadius: "50%", background: green,
                    boxShadow: `0 0 10px ${green}`,
                    animation: `pipelineDot 2.4s ease-in-out ${i * 0.3}s infinite`,
                  }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Stats strip */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "0.75rem",
        padding: "1.25rem 1.5rem",
        background: "linear-gradient(180deg, #0e0e10, #16161a)",
        border: `1px solid ${border}`,
        borderRadius: 12,
      }} className="pipeline-stats">
        {[
          { n: String(devCount),  label: statsLabel[0] },
          { n: projCount.toLocaleString(lang === "sk" ? "sk-SK" : "en-US"), label: statsLabel[1] },
          { n: "4,218",            label: statsLabel[2] },
          { n: "25",               label: statsLabel[3] },
        ].map((s, i) => (
          <div key={i} style={{
            textAlign: "center",
            borderRight: i < 3 ? `1px solid ${border}` : "none",
            padding: "0 0.5rem",
          }}>
            <div style={{ fontFamily: mono, fontSize: "clamp(1.6rem, 3vw, 2.2rem)", fontWeight: 700, color: green, letterSpacing: "-0.02em", lineHeight: 1 }}>
              {s.n}
            </div>
            <div style={{ fontSize: "0.72rem", color: dim, marginTop: "0.4rem", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes pipelineDot {
          0%   { transform: translateX(-1.4rem); opacity: 0; }
          20%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateX(0); opacity: 0; }
        }
        /* Mobile — stack stages + hide inline arrows (they'd point down not right) */
        @media (max-width: 860px) {
          .pipeline-grid { grid-template-columns: 1fr !important; }
          .pipeline-arrow { display: none !important; }
        }
        @media (max-width: 560px) {
          .pipeline-stats { grid-template-columns: 1fr 1fr !important; }
          .pipeline-stats > div { border-right: none !important; padding: 0.5rem 0.5rem !important; }
        }
      `}</style>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────
   1. MARKET PULSE — live hero-section stats + top projects
   ────────────────────────────────────────────────────────── */
export function MarketPulse({ lang = "en", setCurrent }) {
  const { projects } = useProjects();
  const { metrics } = useMetrics();

  const totalUnits = projects.reduce((a, p) => a + (p.total_units || 0), 0);
  const totalAvail = projects.reduce((a, p) => a + (p.available_units || 0), 0);
  const totalSold = projects.reduce((a, p) => a + (p.sold_units || 0), 0);
  const avgEurM2 = metrics.find(m => m.metric_key === "avg_eur_m2")?.value_numeric;

  const label = lang === "sk" ? "Živé dáta z trhu" : "Live from the market";
  const tTotal = lang === "sk" ? "bytov sledovaných" : "units tracked";
  const tActive = lang === "sk" ? "voľných bytov" : "available now";
  const tSold = lang === "sk" ? "predaných celkom" : "sold to date";
  const tEur = lang === "sk" ? "priemer €/m²" : "avg €/m²";
  const topTitle = lang === "sk" ? "Najaktívnejšie projekty" : "Most active projects";
  const openAll = lang === "sk" ? "Všetky projekty →" : "View all projects →";

  // Top 6 by available units (most "alive" market activity)
  const top = [...projects].sort((a, b) => (b.available_units || 0) - (a.available_units || 0)).slice(0, 6);

  return (
    <section style={{ padding: "2rem 2rem 5rem", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "0.5rem",
          padding: "0.3rem 0.85rem", background: "rgba(0,229,160,0.08)",
          border: "1px solid rgba(0,229,160,0.25)", borderRadius: 999,
          fontFamily: mono, fontSize: "0.65rem", color: green, fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.1em",
        }}>
          <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%", background: green, display: "inline-block" }}></span>
          {label}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "3rem" }}>
        <Stat value={totalUnits} label={tTotal} />
        <Stat value={totalAvail} label={tActive} accent={green} />
        <Stat value={totalSold} label={tSold} accent="#f5a623" />
        <Stat value={avgEurM2 ? Math.round(avgEurM2) : null} label={tEur} prefix="" suffix=" €" />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1rem" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#e8e8ed", fontFamily: mono, letterSpacing: "0.02em" }}>{topTitle}</h3>
        <button onClick={() => setCurrent && setCurrent("Live")} style={{ background: "none", border: "none", color: green, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>{openAll}</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.85rem" }}>
        {top.map(p => <ProjectMini key={p.id} project={p} setCurrent={setCurrent} lang={lang} />)}
      </div>
    </section>
  );
}

function Stat({ value, label, prefix = "", suffix = "", accent = "#e8e8ed" }) {
  const display = useAnimatedNumber(value);
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, background: bg, padding: "1.5rem 1.5rem 1.25rem" }}>
      <div style={{
        fontSize: "2.4rem", fontWeight: 700, letterSpacing: "-0.03em",
        fontFamily: mono, color: accent, lineHeight: 1.1,
      }}>
        {value == null ? "—" : (
          <>{prefix}{display.toLocaleString("en-US").replace(/,/g, " ")}{suffix}</>
        )}
      </div>
      <div style={{ fontSize: "0.78rem", color: dim, marginTop: "0.4rem", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono }}>
        {label}
      </div>
    </div>
  );
}

function ProjectMini({ project, setCurrent, lang }) {
  const soldDataUnavailable = (project.sold_units || 0) === 0 && (project.reserved_units || 0) === 0 && (project.prereserved_units || 0) === 0;
  const pct = project.sold_percentage ?? 0;
  const barColor = pct >= 80 ? "#ff6b6b" : pct >= 50 ? "#f5a623" : green;
  return (
    <div
      onClick={() => setCurrent && setCurrent(`Project:${project.id}`)}
      style={{
        border: `1px solid ${border}`, borderRadius: 10, background: bg, padding: "1.1rem",
        cursor: "pointer", transition: "transform 0.2s, border-color 0.2s",
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = green; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.borderColor = border; }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.25rem" }}>
        <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#e8e8ed" }}>{project.name}</div>
        <div style={{ fontSize: "0.7rem", color: dim, fontFamily: mono }}>{project.district || "—"}</div>
      </div>
      <div style={{ fontSize: "0.75rem", color: dim, marginBottom: "0.6rem" }}>
        {project.available_units} {lang === "sk" ? "voľných" : "avail"}
        {!soldDataUnavailable && <> · {project.sold_units} {lang === "sk" ? "predaných" : "sold"}</>}
        {project.avg_price_eur_m2 ? ` · ${Math.round(project.avg_price_eur_m2).toLocaleString("en-US").replace(/,/g, " ")} €/m²` : ""}
      </div>
      {soldDataUnavailable ? (
        <div style={{ fontSize: "0.65rem", color: dim, fontFamily: mono, letterSpacing: "0.05em", fontStyle: "italic" }}>
          {lang === "sk" ? "developer nezverejňuje predajnosť" : "developer doesn't publish sales data"}
        </div>
      ) : (
        <>
          <div style={{ height: 3, background: "#0e0e10", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              width: `${pct}%`, height: "100%", background: barColor,
              transition: "width 0.6s ease",
            }} />
          </div>
          <div style={{ fontSize: "0.65rem", color: dim, fontFamily: mono, marginTop: "0.3rem", letterSpacing: "0.05em" }}>
            {pct.toFixed(0)}% {lang === "sk" ? "predané" : "sold"}
          </div>
        </>
      )}
    </div>
  );
}

function useAnimatedNumber(target) {
  const [value, setValue] = useState(0);
  const ref = useRef({ raf: 0, from: 0 });
  useEffect(() => {
    if (target == null) return;
    const from = ref.current.from;
    const to = target;
    const dur = 1200;
    const start = performance.now();
    cancelAnimationFrame(ref.current.raf);
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setValue(Math.round(from + (to - from) * eased));
      if (p < 1) ref.current.raf = requestAnimationFrame(step);
      else ref.current.from = to;
    };
    ref.current.raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(ref.current.raf);
  }, [target]);
  return value;
}

/* ──────────────────────────────────────────────────────────
   2. DISTRICT PULSE — horizontal bar chart of avg €/m² per district
   ────────────────────────────────────────────────────────── */
export function DistrictPulse({ lang = "en", setCurrent }) {
  const { projects } = useProjects();

  // Aggregate by district
  const byDistrict = {};
  for (const p of projects) {
    if (!p.district || !p.avg_price_eur_m2) continue;
    if (!byDistrict[p.district]) byDistrict[p.district] = { sum: 0, count: 0, units: 0, avail: 0, sold: 0 };
    byDistrict[p.district].sum += p.avg_price_eur_m2;
    byDistrict[p.district].count += 1;
    byDistrict[p.district].units += p.total_units || 0;
    byDistrict[p.district].avail += p.available_units || 0;
    byDistrict[p.district].sold += p.sold_units || 0;
  }
  const rows = Object.entries(byDistrict)
    .map(([d, s]) => ({ district: d, avg: s.sum / s.count, ...s }))
    .sort((a, b) => b.avg - a.avg);

  if (rows.length === 0) return null;

  const max = Math.max(...rows.map(r => r.avg));

  const label = lang === "sk" ? "Cenová mapa Bratislavy" : "Bratislava pricing map";
  const title = lang === "sk" ? "Priemerná cena €/m² podľa okresu" : "Average €/m² by district";
  const desc = lang === "sk"
    ? "Skutočné dáta z aktívnych projektov. Farba indikuje cenový tier."
    : "Real data from active projects. Color indicates price tier.";

  return (
    <section style={{ padding: "5rem 2rem", maxWidth: 1100, margin: "0 auto", borderTop: `1px solid ${border}` }}>
      <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
        {label}
      </div>
      <h2 className="sec-title" style={{ marginBottom: "0.5rem" }}>{title}</h2>
      <p className="sec-desc" style={{ marginBottom: "2.5rem" }}>{desc}</p>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        {rows.map((r, i) => {
          const pct = (r.avg / max) * 100;
          const color = colorForPrice(r.avg);
          return (
            <div key={r.district} style={{ display: "grid", gridTemplateColumns: "180px 1fr 120px", gap: "1rem", alignItems: "center" }}
              className="district-row">
              <div style={{ fontSize: "0.9rem", color: "#e8e8ed", fontWeight: 500 }}>{r.district}</div>
              <div style={{
                height: 32, background: "#0e0e10", borderRadius: 6, overflow: "hidden", position: "relative",
                border: `1px solid ${border}`,
              }}>
                <div style={{
                  width: `${pct}%`, height: "100%",
                  background: `linear-gradient(90deg, ${color}33, ${color})`,
                  borderRight: `2px solid ${color}`,
                  transition: "width 0.8s ease",
                  animation: "barFill 1s ease-out",
                }} />
                <div style={{
                  position: "absolute", left: "0.75rem", top: 0, bottom: 0,
                  display: "flex", alignItems: "center",
                  fontSize: "0.7rem", color: dim, fontFamily: mono,
                }}>
                  {r.count} {lang === "sk" ? "projektov" : "projects"} · {r.units} {lang === "sk" ? "bytov" : "units"}
                </div>
              </div>
              <div style={{
                fontFamily: mono, fontSize: "0.95rem", fontWeight: 600, color,
                textAlign: "right",
              }}>
                {Math.round(r.avg).toLocaleString("en-US").replace(/,/g, " ")} €
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function colorForPrice(avg) {
  if (avg >= 7000) return "#ff6b6b"; // premium
  if (avg >= 5500) return "#f5a623"; // upper
  if (avg >= 4200) return "#00e5a0"; // mid
  return "#4a90e2"; // affordable
}

/* ──────────────────────────────────────────────────────────
   3. HOW IT WORKS — animated data flow pipeline
   ────────────────────────────────────────────────────────── */
const IconGlobe = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18"/>
  </svg>
);
const IconCapture = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <path d="M7 10l5 5 5-5"/>
    <path d="M12 15V3"/>
  </svg>
);
const IconNormalize = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M6 12h12M9 18h6"/>
    <circle cx="19.5" cy="6" r="1.5" fill="currentColor"/>
  </svg>
);
const IconDashboard = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" rx="1"/>
    <rect x="14" y="3" width="7" height="5" rx="1"/>
    <rect x="14" y="12" width="7" height="9" rx="1"/>
    <rect x="3" y="16" width="7" height="5" rx="1"/>
  </svg>
);

export function HowItWorksFlow({ lang = "en" }) {
  const t = lang === "sk" ? {
    label: "Ako to funguje",
    title: "Od 60+ developer webov k jednému dashboardu.",
    desc: "Plne automatizovaná pipeline. Každý mesiac.",
    stages: [
      { Icon: IconGlobe,    title: "60 webov",      desc: "Monitorujeme každú novostavbu v BA" },
      { Icon: IconCapture,  title: "Zachytenie",    desc: "Cenníky, plochy, stavy — raw dáta" },
      { Icon: IconNormalize, title: "Normalizácia", desc: "Štandardizácia, dedup, validácia" },
      { Icon: IconDashboard, title: "Dashboard",    desc: "Štruktúrované, porovnateľné dáta" },
    ],
  } : {
    label: "How it works",
    title: "From 60+ developer sites to one dashboard.",
    desc: "Fully automated pipeline. Every month.",
    stages: [
      { Icon: IconGlobe,    title: "60 sites",      desc: "We watch every new-build in Bratislava" },
      { Icon: IconCapture,  title: "Capture",       desc: "Prices, sizes, status — raw data" },
      { Icon: IconNormalize, title: "Normalize",    desc: "Standardize, dedup, validate" },
      { Icon: IconDashboard, title: "Dashboard",    desc: "Structured, comparable data" },
    ],
  };

  return (
    <section style={{ padding: "5rem 2rem", maxWidth: 1100, margin: "0 auto", borderTop: `1px solid ${border}` }}>
      <div style={{ textAlign: "center", marginBottom: "3rem" }}>
        <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          {t.label}
        </div>
        <h2 className="sec-title" style={{ marginBottom: "0.5rem" }}>{t.title}</h2>
        <p className="sec-desc" style={{ margin: "0 auto" }}>{t.desc}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, position: "relative" }} className="flow-grid">
        {t.stages.map((stage, i) => (
          <div key={i} style={{ padding: "0 1rem", textAlign: "center", position: "relative" }}>
            <div style={{
              width: 72, height: 72,
              background: "linear-gradient(135deg, #1a1a20 0%, #101014 100%)",
              border: `1px solid ${border}`,
              borderRadius: "50%", margin: "0 auto 1rem",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: green, position: "relative", zIndex: 2,
              boxShadow: "0 4px 14px rgba(0, 229, 160, 0.06), inset 0 1px 0 rgba(255,255,255,0.03)",
            }}>
              <stage.Icon />
            </div>
            <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#e8e8ed", marginBottom: "0.3rem" }}>{stage.title}</div>
            <div style={{ fontSize: "0.8rem", color: dim, lineHeight: 1.5 }}>{stage.desc}</div>

            {/* Connector + animated dot (not after last) */}
            {i < t.stages.length - 1 && (
              <div style={{
                position: "absolute", top: 36, left: "calc(50% + 36px)", right: "calc(-50% + 36px)",
                height: 1, background: `linear-gradient(90deg, ${border}, ${green}, ${border})`, zIndex: 1,
                overflow: "hidden",
              }}>
                <div className="flow-pulse" style={{
                  width: 8, height: 8, borderRadius: "50%", background: green,
                  position: "absolute", top: -3.5,
                  boxShadow: `0 0 10px ${green}`,
                  animation: `flowDot 3s ease-in-out ${i * 0.4}s infinite`,
                }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
