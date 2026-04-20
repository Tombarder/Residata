import { useEffect, useRef, useState } from "react";
import { useMetrics, useProjects } from "../lib/useData";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const dim = "#8a8a96";
const border = "#222228";
const bg = "#16161a";

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
        {project.available_units} {lang === "sk" ? "voľných" : "avail"} · {project.sold_units} {lang === "sk" ? "predaných" : "sold"}{project.avg_price_eur_m2 ? ` · ${Math.round(project.avg_price_eur_m2).toLocaleString("en-US").replace(/,/g, " ")} €/m²` : ""}
      </div>
      <div style={{ height: 3, background: "#0e0e10", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`, height: "100%", background: barColor,
          transition: "width 0.6s ease",
        }} />
      </div>
      <div style={{ fontSize: "0.65rem", color: dim, fontFamily: mono, marginTop: "0.3rem", letterSpacing: "0.05em" }}>
        {pct.toFixed(0)}% {lang === "sk" ? "predané" : "sold"}
      </div>
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
export function HowItWorksFlow({ lang = "en" }) {
  const t = lang === "sk" ? {
    label: "Ako to funguje",
    title: "Od 60+ developer webov k jednému dashboardu.",
    desc: "Plne automatizovaná pipeline. Každý mesiac.",
    stages: [
      { icon: "🌐", title: "60 webov", desc: "Monitorujeme každú novostavbu v BA" },
      { icon: "⚡", title: "Zachytenie", desc: "Cenníky, plochy, stavy — raw data" },
      { icon: "🧹", title: "Normalizácia", desc: "Štandardizácia, dedup, validácia" },
      { icon: "📊", title: "Dashboard", desc: "Štruktúrované dáta, porovnateľné" },
    ],
  } : {
    label: "How it works",
    title: "From 60+ developer sites to one dashboard.",
    desc: "Fully automated pipeline. Every month.",
    stages: [
      { icon: "🌐", title: "60 sites", desc: "We watch every new-build in Bratislava" },
      { icon: "⚡", title: "Capture", desc: "Prices, sizes, status — raw data" },
      { icon: "🧹", title: "Normalize", desc: "Standardize, dedup, validate" },
      { icon: "📊", title: "Dashboard", desc: "Structured, comparable data" },
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
              width: 70, height: 70, background: bg, border: `1px solid ${border}`,
              borderRadius: "50%", margin: "0 auto 1rem",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.75rem", position: "relative", zIndex: 2,
            }}>
              {stage.icon}
            </div>
            <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#e8e8ed", marginBottom: "0.3rem" }}>{stage.title}</div>
            <div style={{ fontSize: "0.8rem", color: dim, lineHeight: 1.5 }}>{stage.desc}</div>

            {/* Connector + animated dot (not after last) */}
            {i < t.stages.length - 1 && (
              <div style={{
                position: "absolute", top: 35, left: "calc(50% + 35px)", right: "calc(-50% + 35px)",
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
