import { useState } from "react";

const pages = ["Home", "Use Cases", "Data", "Pricing"];

function Nav({ current, setCurrent }) {
  return (
    <nav style={{
      position: "fixed", top: 0, width: "100%", zIndex: 100,
      padding: "1.25rem 2rem", display: "flex", alignItems: "center",
      justifyContent: "space-between", background: "rgba(10,10,11,0.85)",
      backdropFilter: "blur(20px)", borderBottom: "1px solid #222228",
    }}>
      <a onClick={() => setCurrent("Home")} style={{ display: "flex", alignItems: "center", gap: "0.6rem", cursor: "pointer", textDecoration: "none" }}>
        <div style={{
          width: 28, height: 28, background: "#00e5a0", borderRadius: 6,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 14, color: "#0a0a0b",
        }}>R</div>
        <span style={{ fontWeight: 600, fontSize: "1.1rem", color: "#e8e8ed", letterSpacing: "-0.02em" }}>Residata</span>
      </a>
      <div style={{ display: "flex", alignItems: "center", gap: "2rem", listStyle: "none" }}>
        {pages.map(p => (
          <a key={p} onClick={() => setCurrent(p)} style={{
            color: current === p ? "#e8e8ed" : "#8a8a96", textDecoration: "none",
            fontSize: "0.875rem", cursor: "pointer", transition: "color 0.2s",
          }}>{p}</a>
        ))}
        <a onClick={() => setCurrent("Pricing")} style={{
          padding: "0.5rem 1.25rem", background: "#00e5a0", color: "#0a0a0b",
          fontWeight: 600, borderRadius: 6, fontSize: "0.8rem", cursor: "pointer",
          letterSpacing: "0.02em", textDecoration: "none",
        }}>Get Access</a>
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer style={{
      padding: "2.5rem 2rem", borderTop: "1px solid #222228",
      display: "flex", justifyContent: "space-between", alignItems: "center",
      maxWidth: 1100, margin: "0 auto",
    }}>
      <span style={{ fontSize: "0.78rem", color: "#55555f" }}>© 2026 Residata. Bratislava, Slovakia.</span>
      <a href="mailto:hello@residata.sk" style={{ fontSize: "0.78rem", color: "#55555f", textDecoration: "none" }}>Contact</a>
    </footer>
  );
}

/* ─────── HOME ─────── */
function HomePage({ setCurrent }) {
  return (
    <>
      {/* Hero */}
      <section style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        justifyContent: "center", alignItems: "center", textAlign: "center",
        padding: "8rem 2rem 4rem", position: "relative",
      }}>
        <div style={{
          position: "absolute", top: "-40%", left: "50%", transform: "translateX(-50%)",
          width: 800, height: 800,
          background: "radial-gradient(ellipse, rgba(0,229,160,0.15) 0%, transparent 70%)",
          pointerEvents: "none", opacity: 0.4,
        }} />
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "0.5rem",
          padding: "0.4rem 1rem", border: "1px solid #222228", borderRadius: 100,
          fontSize: "0.75rem", color: "#8a8a96", fontFamily: "'JetBrains Mono', monospace",
          marginBottom: "2.5rem", background: "#111113",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00e5a0" }} />
          Live — tracking 140+ developments
        </div>
        <h1 style={{ fontSize: "clamp(2.8rem, 6vw, 5rem)", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.05, maxWidth: 800 }}>
          Bratislava residential market,<br />
          <span style={{
            background: "linear-gradient(135deg, #00e5a0 0%, #00b880 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>fully transparent.</span>
        </h1>
        <p style={{ marginTop: "1.5rem", fontSize: "1.15rem", color: "#8a8a96", maxWidth: 560, fontWeight: 300, lineHeight: 1.7 }}>
          We monitor every new residential development in Bratislava and turn scattered listings into actionable market intelligence — so you can make pricing, investment, and portfolio decisions based on data.
        </p>
        <div style={{ marginTop: "2.5rem", display: "flex", gap: "1rem" }}>
          <a onClick={() => setCurrent("Pricing")} className="btn-p">Get Access</a>
          <a onClick={() => setCurrent("Data")} className="btn-s">See Sample Data</a>
        </div>
      </section>

      {/* Value Prop — Questions left, What you get right */}
      <section style={{ padding: "5rem 2rem", maxWidth: 1100, margin: "0 auto" }}>
        <Label>What We Deliver</Label>
        <h2 className="sec-title">Not just data. Answers.</h2>
        <p className="sec-desc" style={{ marginBottom: "3rem" }}>
          Every month you get a full snapshot of the Bratislava new-build market — unit-level data across 140+ projects, plus the insights you need to act on it.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          {/* Left — Questions */}
          <div style={{ border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "2rem" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1.25rem" }}>Questions we help you answer</div>
            {[
              "What should I price my 2-bedroom units at in Ružinov to stay competitive?",
              "If I build in Záhorská Bystrica, how long until I sell out based on current absorption?",
              "My project costs €50M to build — are market prices high enough to cover costs and deliver 20% margin?",
              "How fast is Bory selling compared to last quarter — is momentum building or slowing?",
              "Where is supply running low? Which districts will have no new inventory within 6 months?",
              "What's the realistic price range for 60m² in Petržalka — and where does 90% of demand sit?",
              "Which competitor projects are about to sell out — what can I learn from their pricing?",
            ].map((q, i) => (
              <div key={i} style={{ display: "flex", gap: "0.75rem", marginBottom: "0.85rem", alignItems: "flex-start" }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", color: "#00e5a0", marginTop: "0.15rem", flexShrink: 0 }}>→</span>
                <span style={{ fontSize: "0.84rem", color: "#8a8a96", lineHeight: 1.55 }}>{q}</span>
              </div>
            ))}
          </div>

          {/* Right — What you get */}
          <div style={{ border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "2rem" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "1.25rem" }}>Every month you get</div>
            {[
              ["Competitive pricing intelligence", "Know exactly what every project charges per m² — by district, unit type, and phase. Benchmark your own pricing against the entire market."],
              ["Sell-through velocity", "See which projects are selling fast and which are stalling. Spot momentum shifts before the market does."],
              ["Supply & pipeline tracking", "Track new launches, upcoming phases, and total inventory — know what's coming so you're never caught off guard."],
              ["Absorption analysis", "Understand how fast the market absorbs new units by district and segment. Critical for launch timing and feasibility."],
              ["Historical trends", "Month-over-month snapshots let you track pricing direction and velocity — not just where the market is, but where it's heading."],
            ].map(([title, desc]) => (
              <div key={title} style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem", alignItems: "flex-start" }}>
                <span style={{ color: "#00e5a0", fontSize: "0.85rem", marginTop: "0.15rem", flexShrink: 0 }}>✓</span>
                <div>
                  <div style={{ fontSize: "0.9rem", fontWeight: 500, color: "#e8e8ed", marginBottom: "0.2rem" }}>{title}</div>
                  <div style={{ fontSize: "0.8rem", color: "#8a8a96", lineHeight: 1.55 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Flexible Scope — standalone */}
      <section style={{ padding: "0 2rem 5rem", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{
          border: "1px solid #222228", borderRadius: 12, background: "#16161a",
          padding: "2.5rem", display: "grid", gridTemplateColumns: "auto 1fr", gap: "2rem", alignItems: "center",
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 10,
            background: "rgba(0,229,160,0.08)", border: "1px solid rgba(0,229,160,0.15)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'JetBrains Mono', monospace", fontSize: "1.1rem", color: "#00e5a0", fontWeight: 700,
          }}>↗</div>
          <div>
            <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "#e8e8ed", marginBottom: "0.4rem" }}>Flexible scope — we adapt to your needs.</div>
            <p style={{ fontSize: "0.85rem", color: "#8a8a96", lineHeight: 1.65, maxWidth: 700 }}>
              Need weekly updates instead of monthly? Want to cover Košice, Brno, or Prague? Need a custom output format for your internal tools or a different property segment? The pipeline is built to be reconfigured — we adapt scope, frequency, and delivery to match your workflow.
            </p>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section style={{ padding: "4rem 2rem 6rem", textAlign: "center", position: "relative" }}>
        <div style={{
          position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
          width: 600, height: 400,
          background: "radial-gradient(ellipse, rgba(0,229,160,0.15) 0%, transparent 70%)",
          pointerEvents: "none", opacity: 0.3,
        }} />
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.03em", marginBottom: "1rem" }}>See what the data looks like.</h2>
        <p style={{ color: "#8a8a96", fontSize: "1rem", maxWidth: 480, margin: "0 auto 2rem", fontWeight: 300 }}>Explore a real sample from the latest pipeline run — actual insights, actual structure.</p>
        <a onClick={() => setCurrent("Data")} className="btn-p">View Sample Data</a>
      </section>
    </>
  );
}

/* ─────── USE CASES ─────── */
function UseCasesPage({ setCurrent }) {
  const cases = [
    {
      tag: "Developers & Sales Teams", title: "Know exactly where to price.",
      desc: "You're launching a new phase and need to set prices. But what are comparable projects actually charging? How fast are they selling? Are you leaving money on the table — or pricing yourself out?",
      benefits: [
        ["Side-by-side competitor pricing", "see €/m² across every comparable project in your district — broken down by unit type, floor, and phase"],
        ["Sell-through velocity ranking", "know which projects moved the most units last month — and which ones are sitting still"],
        ["Inventory countdown", "track how many units your competitors have left — time your launches to hit gaps in supply"],
      ],
    },
    {
      tag: "Investors & Private Equity", title: "Underwrite with market reality.",
      desc: "You're evaluating a resi development deal. The developer says demand is strong and prices are rising. But is that true — and is it true for this specific district, unit mix, and price point?",
      benefits: [
        ["Absorption rates by segment", "how many units actually sell per month in each district — the number that makes or breaks your IRR"],
        ["Historical price trajectories", "6–12 months of €/m² movement so you can model scenarios based on real trends, not assumptions"],
        ["Feasibility stress test", "compare your target sell price against what the market is actually paying — by m², type, and location"],
      ],
    },
    {
      tag: "Banks & Valuers", title: "Comparable data, ready to use.",
      desc: "You need market comparables for a valuation or collateral assessment — but gathering them manually from 50+ developer websites takes days. We've already done it.",
      benefits: [
        ["Structured comparable listings", "pricing by location, unit type, floor area, and availability — filterable and exportable"],
        ["Market depth overview", "how many active projects and units exist in a given district — essential context for any valuation"],
        ["Monthly refresh", "your comparables are never more than 30 days old — no more working with stale data from last quarter"],
      ],
    },
    {
      tag: "Consultants & Analysts", title: "Hours of research, done for you.",
      desc: "Your client needs a market overview for Bratislava residential. You can spend 2–4 weeks clicking through developer websites, copy-pasting into spreadsheets, fighting inconsistent formats, chasing down broken links, and cleaning messy data — or open a single sheet with everything already structured, normalized, and ready to analyze.",
      benefits: [
        ["Presentation-ready data", "25 normalized columns across 140+ projects — drop straight into models, charts, or client decks"],
        ["Trend analysis built in", "monthly snapshots mean you can show pricing direction and market shifts without extra work"],
        ["Full market coverage", "apartments, houses, retail, semidetached — across every active district. No gaps to fill manually"],
      ],
    },
  ];

  return (
    <>
      <div style={{ padding: "8rem 2rem 3rem", maxWidth: 1100, margin: "0 auto" }}>
        <Label>Use Cases</Label>
        <h1 className="sec-title">Built for anyone who needs<br/>to understand the market.</h1>
        <p className="sec-desc">Different roles, same problem — you need reliable, current data on the Bratislava residential market. Here's how each team uses Residata.</p>
      </div>
      <div style={{ padding: "0 2rem 5rem", maxWidth: 1100, margin: "0 auto" }}>
        {cases.map(c => (
          <div key={c.tag} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", border: "1px solid #222228", borderRadius: 12, overflow: "hidden", marginBottom: "1.5rem" }}>
            <div style={{ padding: "2.5rem", background: "#16161a" }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>{c.title}</div>
              <h3 style={{ fontSize: "1.3rem", fontWeight: 600, letterSpacing: "-0.02em", marginBottom: "0.75rem" }}>{c.tag}</h3>
              <p style={{ fontSize: "0.9rem", color: "#8a8a96", lineHeight: 1.65, fontWeight: 300 }}>{c.desc}</p>
            </div>
            <div style={{ padding: "2.5rem", background: "#111113", borderLeft: "1px solid #222228" }}>
              <h4 style={{ fontSize: "0.8rem", fontWeight: 600, marginBottom: "1rem" }}>What you get</h4>
              {c.benefits.map(([b, d]) => (
                <div key={b} style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", alignItems: "flex-start" }}>
                  <span style={{ color: "#00e5a0", fontSize: "0.85rem", marginTop: "0.15rem" }}>✓</span>
                  <p style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.55 }}><strong style={{ color: "#e8e8ed", fontWeight: 500 }}>{b}</strong> — {d}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: "4rem 2rem", textAlign: "center" }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.03em", marginBottom: "1rem" }}>Different need?</h2>
        <p style={{ color: "#8a8a96", maxWidth: 480, margin: "0 auto 2rem", fontWeight: 300 }}>The pipeline is flexible. If your use case isn't listed, reach out — we likely already have what you need, or can configure it.</p>
        <a onClick={() => setCurrent("Pricing")} className="btn-p">See Pricing</a>
      </div>
    </>
  );
}

/* ─────── DATA ─────── */
function DataPage({ setCurrent }) {
  const mono = "'JetBrains Mono', monospace";
  const rows = [
    ["Slnečnice Viladomy", "Petržalka", "byt", "A2-304", "68.4", "249,660", "3,650", "3", "V"],
    ["Slnečnice Viladomy", "Petržalka", "byt", "A2-412", "45.2", "167,240", "3,700", "4", "P"],
    ["Nový Ružinov II", "Ružinov", "byt", "B1-205", "82.1", "338,252", "4,120", "2", "V"],
    ["RNDZ Residence", "Nové Mesto", "apartmán", "C-101", "34.8", "159,384", "4,580", "1", "R"],
    ["Zwirn Mlyny", "Staré Mesto", "byt", "D-503", "95.6", "497,120", "5,200", "5", "P"],
    ["Bory Nový Dvor", "Lamač", "dom", "RD-18", "142.0", "479,960", "3,380", "—", "V"],
    ["Eurovea City", "Ružinov", "byt", "T2-1804", "56.3", "310,214", "5,510", "18", "V"],
    ["Čerešne Dúbravka", "Dúbravka", "byt", "E-207", "73.9", "243,870", "3,300", "2", "V"],
  ];
  const statusStyle = { V: { color: "#00e5a0", bg: "rgba(0,229,160,0.08)" }, P: { color: "#f5a623", bg: "rgba(245,166,35,0.08)" }, R: { color: "#55555f", bg: "rgba(85,85,95,0.15)" } };

  // Trend data — 12% YoY, roughly 1% per month
  const trendData = [
    { month: "Oct", value: 3480 },
    { month: "Nov", value: 3540 },
    { month: "Dec", value: 3610 },
    { month: "Jan", value: 3690 },
    { month: "Feb", value: 3760 },
    { month: "Mar", value: 3840 },
  ];
  const minV = 3350; const maxV = 3980;
  const chartW = 520; const chartH = 180;
  const padL = 50; const padR = 20; const padT = 20; const padB = 30;
  const innerW = chartW - padL - padR; const innerH = chartH - padT - padB;
  const points = trendData.map((d, i) => ({
    x: padL + (i / (trendData.length - 1)) * innerW,
    y: padT + innerH - ((d.value - minV) / (maxV - minV)) * innerH,
    ...d,
  }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = linePath + ` L${points[points.length-1].x},${padT + innerH} L${points[0].x},${padT + innerH} Z`;

  // Insight card component
  const InsightCard = ({ label, title, children, span2 }) => (
    <div style={{
      border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "1.75rem",
      gridColumn: span2 ? "span 2" : "span 1",
    }}>
      <div style={{ fontFamily: mono, fontSize: "0.6rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.6rem" }}>{label}</div>
      <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1rem", letterSpacing: "-0.01em" }}>{title}</div>
      {children}
    </div>
  );

  const Bar = ({ label, value, max, color }) => (
    <div style={{ marginBottom: "0.6rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
        <span style={{ fontSize: "0.75rem", color: "#8a8a96" }}>{label}</span>
        <span style={{ fontFamily: mono, fontSize: "0.7rem", color: "#e8e8ed" }}>{value}%</span>
      </div>
      <div style={{ width: "100%", height: 6, background: "#222228", borderRadius: 3 }}>
        <div style={{ width: `${(value / max) * 100}%`, height: "100%", background: color || "#00e5a0", borderRadius: 3 }} />
      </div>
    </div>
  );

  const schemaLines = [
    { field: "projekt", type: "string", desc: "Development name" },
    { field: "developer", type: "string", desc: "Developer company" },
    { field: "okres", type: "string", desc: "City district" },
    { field: "typ", type: "enum", desc: "byt | apartmán | dom | retail | semidetached | ine" },
    { field: "oznacenie", type: "string", desc: "Unit label — e.g. A2-304" },
    { field: "dispozicia", type: "string", desc: "Layout — 1-izbový, 2-izbový..." },
    { field: "plocha_m2", type: "float", desc: "Floor area in m²" },
    { field: "cena_eur", type: "int", desc: "Listed price in EUR" },
    { field: "cena_m2", type: "float", desc: "Price per m² (computed)" },
    { field: "poschodie", type: "int", desc: "Floor number" },
    { field: "stav", type: "enum", desc: "V (voľný) | P (predaný) | R (rezervovaný)" },
    { field: "datum_scrape", type: "date", desc: "Collection date — YYYY-MM-DD" },
  ];

  return (
    <>
      <style>{`
        .dark-scroll::-webkit-scrollbar { height: 6px; }
        .dark-scroll::-webkit-scrollbar-track { background: #111113; border-radius: 3px; }
        .dark-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        .dark-scroll::-webkit-scrollbar-thumb:hover { background: #444; }
        .dark-scroll { scrollbar-width: thin; scrollbar-color: #333 #111113; }
      `}</style>

      <div style={{ padding: "8rem 2rem 3rem", maxWidth: 1100, margin: "0 auto" }}>
        <Label>Sample Output</Label>
        <h1 className="sec-title">This is what you get.</h1>
        <p className="sec-desc">Real data, real insights. Same depth every month.</p>
      </div>

      {/* Stats */}
      <div style={{ padding: "0 2rem 0.75rem", maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div style={{ fontSize: "0.85rem", fontWeight: 500, color: "#e8e8ed" }}>Bratislava New-Build Market — March 2026</div>
        <div style={{ fontFamily: mono, fontSize: "0.68rem", color: "#55555f" }}>Monthly snapshot · all active residential projects</div>
      </div>
      <div style={{ padding: "0 2rem 2rem", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "#222228", border: "1px solid #222228", borderRadius: 12, overflow: "hidden" }}>
          {[
            ["4,218", "Units Tracked", "Total units across all projects", "+312 vs Feb", true],
            ["142", "Active Projects", "Developments currently selling", "+6 new this month", true],
            ["€3,840", "Avg. Price per m²", "Weighted across all unit types", "+12% YoY", true],
            ["263", "Units Sold in March", "Across all tracked projects", "+14% vs Feb", true],
          ].map(([n, l, sub, d, up]) => (
            <div key={l} style={{ background: "#16161a", padding: "1.75rem 1.5rem", textAlign: "center" }}>
              <div style={{ fontFamily: mono, fontSize: "2rem", fontWeight: 700, color: "#00e5a0" }}>{n}</div>
              <div style={{ fontSize: "0.8rem", color: "#e8e8ed", marginTop: "0.25rem", fontWeight: 500 }}>{l}</div>
              <div style={{ fontSize: "0.68rem", color: "#55555f", marginTop: "0.15rem" }}>{sub}</div>
              <span style={{
                fontFamily: mono, fontSize: "0.65rem", marginTop: "0.6rem",
                padding: "0.15rem 0.5rem", borderRadius: 4, display: "inline-block",
                color: up ? "#00e5a0" : "#ff4d4d",
                background: up ? "rgba(0,229,160,0.08)" : "rgba(255,77,77,0.08)",
              }}>{d}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Trend Chart + District */}
      <div style={{ padding: "1rem 2rem 2rem", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
          <div style={{ border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "1.5rem 1.5rem 1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <div>
                <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>Avg. €/m² Trend</div>
                <div style={{ fontSize: "0.72rem", color: "#55555f", marginTop: "0.15rem" }}>Bratislava — last 6 months</div>
              </div>
              <span style={{ fontFamily: mono, fontSize: "0.65rem", color: "#00e5a0", background: "rgba(0,229,160,0.08)", padding: "0.15rem 0.5rem", borderRadius: 4 }}>+12% YoY</span>
            </div>
            <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: "100%", height: "auto" }}>
              {[3500, 3600, 3700, 3800, 3900].map(v => {
                const y = padT + innerH - ((v - minV) / (maxV - minV)) * innerH;
                return (<g key={v}><line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke="#1a1a1f" strokeWidth="1" /><text x={padL - 8} y={y + 3} textAnchor="end" fill="#55555f" fontSize="9" fontFamily={mono}>{(v/1000).toFixed(1)}k</text></g>);
              })}
              <path d={areaPath} fill="url(#areaGrad2)" />
              <defs><linearGradient id="areaGrad2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00e5a0" stopOpacity="0.15" /><stop offset="100%" stopColor="#00e5a0" stopOpacity="0" /></linearGradient></defs>
              <path d={linePath} fill="none" stroke="#00e5a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {points.map((p, i) => (<g key={i}><circle cx={p.x} cy={p.y} r="3.5" fill="#0a0a0b" stroke="#00e5a0" strokeWidth="2" /><text x={p.x} y={padT + innerH + 18} textAnchor="middle" fill="#55555f" fontSize="9" fontFamily={mono}>{p.month}</text></g>))}
            </svg>
          </div>

          <div style={{ border: "1px solid #222228", borderRadius: 12, background: "#16161a", padding: "1.5rem" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.15rem" }}>By District</div>
            <div style={{ fontSize: "0.72rem", color: "#55555f", marginBottom: "1.25rem" }}>Average €/m² — last 3 months change</div>
            {[
              ["Staré Mesto", "5,200", "+4.1%", true],
              ["Ružinov", "4,580", "+3.6%", true],
              ["Nové Mesto", "4,320", "+2.9%", true],
              ["Petržalka", "3,650", "+2.4%", true],
              ["Dúbravka", "3,300", "+1.8%", true],
              ["Lamač", "3,380", "+1.2%", true],
            ].map(([district, price, delta, up]) => (
              <div key={district} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.55rem 0", borderBottom: "1px solid #1a1a1f" }}>
                <span style={{ fontSize: "0.8rem", color: "#e8e8ed" }}>{district}</span>
                <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                  <span style={{ fontFamily: mono, fontSize: "0.73rem", color: "#8a8a96" }}>€{price}</span>
                  <span style={{ fontFamily: mono, fontSize: "0.62rem", color: up ? "#00e5a0" : "#ff4d4d", minWidth: 42, textAlign: "right" }}>{delta}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ INSIGHTS ═══ */}
      <div style={{ padding: "2rem 2rem 1rem", maxWidth: 1100, margin: "0 auto" }}>
        <Label>Market Insights</Label>
        <h2 className="sec-title" style={{ marginBottom: "0.5rem" }}>What the data tells you.</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", marginBottom: "2rem" }}>
          <p className="sec-desc" style={{ marginBottom: 0 }}>Examples of the insights you can extract from each monthly delivery. The kind of edge that's hard to build in-house — and expensive to live without.</p>
          <span style={{ fontFamily: mono, fontSize: "0.6rem", color: "#55555f", background: "#111113", border: "1px solid #222228", padding: "0.3rem 0.75rem", borderRadius: 6, whiteSpace: "nowrap", flexShrink: 0 }}>Sample data for illustration</span>
        </div>
      </div>

      <div style={{ padding: "0 2rem 2rem", maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem" }}>

        {/* 1 — Top Seller */}
        <InsightCard label="Top Seller — March" title="Bory Bývanie sold 34 units last month.">
          <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
            Highest single-month takeup across all tracked projects. Phase 4B is now 78% sold out — 46 units remaining from the original 210.
          </div>
          <div style={{ display: "flex", gap: "1.5rem" }}>
            <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#00e5a0" }}>34</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>Units sold</div></div>
            <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#e8e8ed" }}>€3,380</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>Avg. €/m²</div></div>
            <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#f5a623" }}>78%</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>Sold out</div></div>
          </div>
        </InsightCard>

        {/* 2 — New Supply */}
        <InsightCard label="Supply Watch" title="312 new units entered the market.">
          <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
            6 new projects launched in March, adding 312 units to the active pipeline. Ružinov and Petržalka saw the largest additions.
          </div>
          <div style={{ fontSize: "0.75rem", color: "#8a8a96", lineHeight: 1.8 }}>
            {[["Einpark Residence", "Ružinov", 84], ["Slnečnice Zóna M", "Petržalka", 96], ["Nové Lido Phase 1", "Petržalka", 52], ["Other (3 projects)", "—", 80]].map(([p, d, u]) => (
              <div key={p} style={{ display: "flex", justifyContent: "space-between", padding: "0.2rem 0", borderBottom: "1px solid #1a1a1f" }}>
                <span><span style={{ color: "#e8e8ed" }}>{p}</span> <span style={{ color: "#55555f" }}>· {d}</span></span>
                <span style={{ fontFamily: mono, fontSize: "0.7rem" }}>{u} units</span>
              </div>
            ))}
          </div>
        </InsightCard>

        {/* 3 — Absorption Rate */}
        <InsightCard label="Absorption Rate" title="How fast are districts selling?">
          <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
            Monthly sell-through as % of available units. Higher = faster absorption, tighter market.
          </div>
          <Bar label="Staré Mesto" value={8.2} max={10} color="#00e5a0" />
          <Bar label="Ružinov" value={6.8} max={10} color="#00e5a0" />
          <Bar label="Nové Mesto" value={5.4} max={10} color="#00e5a0" />
          <Bar label="Petržalka" value={4.1} max={10} color="#00e5a0" />
          <Bar label="Dúbravka" value={3.2} max={10} color="#55555f" />
          <Bar label="Lamač" value={2.8} max={10} color="#55555f" />
        </InsightCard>

        {/* 4 — District Spotlight (span 2) */}
        <InsightCard label="District Spotlight — Ružinov" title="Ružinov: 892 tracked units across 18 projects." span2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
            <div>
              <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.65, marginBottom: "1rem" }}>
                Most active district by transaction volume. Average unit price sits at €310k with 90% of transactions falling between €215k–€420k. Premium outliers above €500k driven by Eurovea City tower units.
              </div>
              <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#00e5a0" }}>€310k</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>Avg. unit price</div></div>
                <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#e8e8ed" }}>€4,580</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>Avg. €/m²</div></div>
                <div><div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: "#e8e8ed" }}>6.8%</div><div style={{ fontSize: "0.68rem", color: "#55555f" }}>Monthly absorption</div></div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.78rem", color: "#55555f", marginBottom: "0.5rem" }}>Price range distribution</div>
              {/* Mini histogram */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80, paddingBottom: 4 }}>
                {[
                  { range: "<200k", h: 8 }, { range: "200-250k", h: 22 }, { range: "250-300k", h: 45 },
                  { range: "300-350k", h: 72 }, { range: "350-400k", h: 58 }, { range: "400-450k", h: 28 },
                  { range: "450-500k", h: 14 }, { range: "500k+", h: 8 },
                ].map((b, i) => (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <div style={{ width: "100%", height: b.h, background: i >= 2 && i <= 5 ? "#00e5a0" : "#333", borderRadius: "2px 2px 0 0", opacity: i >= 2 && i <= 5 ? 0.7 : 0.4 }} />
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.25rem" }}>
                <span style={{ fontFamily: mono, fontSize: "0.58rem", color: "#55555f" }}>{"<200k"}</span>
                <span style={{ fontFamily: mono, fontSize: "0.58rem", color: "#55555f" }}>500k+</span>
              </div>
              <div style={{ fontSize: "0.7rem", color: "#8a8a96", marginTop: "0.5rem" }}>
                <span style={{ color: "#00e5a0" }}>■</span> 90th percentile: €215k – €420k
              </div>
            </div>
          </div>
        </InsightCard>

        {/* 5 — Sell-out Watch */}
        <InsightCard label="Sell-out Watch" title="5 projects approaching sell-out.">
          <div style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1rem" }}>
            Projects with less than 15% of units remaining. Last chance for clients or investors — these won't be on the market next quarter.
          </div>
          {[
            ["Zwirn Mlyny", "Staré Mesto", 92, 4, "96%"],
            ["Panorama Towers", "Ružinov", 168, 12, "93%"],
            ["Urban Residence", "Nové Mesto", 74, 8, "89%"],
            ["River Park II", "Staré Mesto", 56, 7, "88%"],
            ["Nový Ružinov I", "Ružinov", 110, 16, "85%"],
          ].map(([name, district, total, remaining, pct]) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid #1a1a1f" }}>
              <div>
                <span style={{ fontSize: "0.8rem", color: "#e8e8ed", fontWeight: 500 }}>{name}</span>
                <span style={{ fontSize: "0.72rem", color: "#55555f", marginLeft: "0.5rem" }}>· {district}</span>
              </div>
              <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                <span style={{ fontFamily: mono, fontSize: "0.68rem", color: "#8a8a96" }}>{remaining} left of {total}</span>
                <span style={{ fontFamily: mono, fontSize: "0.62rem", color: "#f5a623", background: "rgba(245,166,35,0.08)", padding: "0.1rem 0.4rem", borderRadius: 4 }}>{pct}</span>
              </div>
            </div>
          ))}
        </InsightCard>
      </div>

      {/* Unit Table */}
      <div style={{ padding: "2rem 2rem 2rem", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1rem" }}>
          <div>
            <Label>Raw Data</Label>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 600 }}>Unit-level sample</h3>
          </div>
          <span style={{ fontFamily: mono, fontSize: "0.7rem", color: "#55555f" }}>Showing 8 of 4,218 records</span>
        </div>
        <div className="dark-scroll" style={{ border: "1px solid #222228", borderRadius: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", minWidth: 900 }}>
            <thead>
              <tr style={{ background: "#111113" }}>
                {["Project", "District", "Typ", "Label", "m²", "Price €", "€/m²", "Floor", "Stav"].map(h => (
                  <th key={h} style={{ padding: "0.875rem 1rem", textAlign: "left", fontFamily: mono, fontSize: "0.65rem", color: "#55555f", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 500, borderBottom: "1px solid #222228", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: i < rows.length - 1 ? "1px solid #1a1a1f" : "none" }}>
                  {r.map((cell, j) => (
                    <td key={j} style={{
                      padding: "0.75rem 1rem", whiteSpace: "nowrap",
                      color: j === 0 ? "#e8e8ed" : "#8a8a96",
                      fontWeight: j === 0 ? 500 : 400,
                      fontFamily: j >= 2 ? mono : "inherit",
                      fontSize: j >= 2 ? "0.73rem" : "0.8rem",
                    }}>
                      {j === 8 ? (
                        <span style={{
                          fontFamily: mono, fontSize: "0.65rem",
                          padding: "0.15rem 0.5rem", borderRadius: 4, fontWeight: 500,
                          color: statusStyle[cell]?.color, background: statusStyle[cell]?.bg,
                        }}>{cell}</span>
                      ) : cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Schema — Terminal (tech flex at bottom) */}
      <div style={{ padding: "2rem 2rem 5rem", maxWidth: 1100, margin: "0 auto" }}>
        <Label>Schema</Label>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Up to 25 columns per unit — key fields below.</h3>
        <p className="sec-desc" style={{ marginBottom: "1.5rem" }}>Additional fields include orientation, balcony area, parking, storage, and project-level metadata.</p>

        <div style={{ border: "1px solid #222228", borderRadius: 12, overflow: "hidden", boxShadow: "0 8px 32px rgba(0,0,0,0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.75rem 1.25rem", background: "#111113", borderBottom: "1px solid #222228" }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ffbd2e" }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840" }} />
            <span style={{ flex: 1, textAlign: "center", fontFamily: mono, fontSize: "0.68rem", color: "#55555f", marginRight: "2rem" }}>residata.schema.yml</span>
          </div>
          <div style={{ background: "#0d0d0f", padding: "1.25rem 1.5rem", fontFamily: mono, fontSize: "0.74rem", lineHeight: 1.85 }}>
            <div style={{ color: "#55555f", marginBottom: "0.25rem" }}># residata output schema v2.4</div>
            <div style={{ color: "#55555f", marginBottom: "0.75rem" }}># 25 fields per unit — key fields shown</div>
            <div style={{ color: "#55555f", marginBottom: "0.5rem" }}>---</div>
            <div style={{ marginBottom: "0.25rem" }}><span style={{ color: "#f5a623" }}>fields</span><span style={{ color: "#55555f" }}>:</span></div>
            {schemaLines.map((s, i) => (
              <div key={i} style={{ paddingLeft: "1.25rem", display: "flex", gap: "0.5rem" }}>
                <span style={{ color: "#55555f" }}>-</span>
                <span style={{ color: "#00e5a0" }}>{s.field}</span>
                <span style={{ color: "#55555f" }}>:</span>
                <span style={{ color: "#e8e8ed" }}>{s.type}</span>
                <span style={{ color: "#55555f", marginLeft: "auto", fontSize: "0.68rem" }}>  # {s.desc}</span>
              </div>
            ))}
            <div style={{ marginTop: "0.75rem", color: "#55555f" }}>---</div>
            <div style={{ marginTop: "0.25rem" }}><span style={{ color: "#f5a623" }}>total_fields</span><span style={{ color: "#55555f" }}>: </span><span style={{ color: "#e8e8ed" }}>25</span></div>
            <div><span style={{ color: "#f5a623" }}>output</span><span style={{ color: "#55555f" }}>: </span><span style={{ color: "#e8e8ed" }}>google_sheets | csv | xlsx</span></div>
            <div><span style={{ color: "#f5a623" }}>encoding</span><span style={{ color: "#55555f" }}>: </span><span style={{ color: "#e8e8ed" }}>utf-8</span></div>
          </div>
        </div>
        <div style={{ marginTop: "0.75rem", fontFamily: mono, fontSize: "0.62rem", color: "#55555f", lineHeight: 1.6 }}>
          Note: Field availability varies by project. Not all developers publish all data points.
        </div>
      </div>

      <div style={{ padding: "4rem 2rem", textAlign: "center" }}>
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>Want the full dataset?</h2>
        <p style={{ color: "#8a8a96", maxWidth: 480, margin: "0 auto 2rem", fontWeight: 300 }}>This is a sample. The full output covers 4,200+ units across 140+ projects, updated monthly.</p>
        <a onClick={() => setCurrent("Pricing")} className="btn-p">See Pricing</a>
      </div>
    </>
  );
}

/* ─────── PRICING ─────── */
function PricingPage() {
  const tiers = [
    {
      tier: "Snapshot", name: "One-time access", price: "€149", note: "Single month, one-time delivery",
      features: [
        [true, "Full dataset — all 140+ projects"],
        [true, "Unit-level data with 25 columns"],
        [true, "Google Sheets or CSV delivery"],
        [false, "No historical data"],
        [false, "No ongoing updates"],
      ],
      featured: false, cta: "Get Started",
    },
    {
      tier: "Standard", name: "Monthly delivery", price: "€99", priceSuffix: "/mo", note: "Billed monthly, cancel anytime",
      features: [
        [true, "Full dataset — all 140+ projects"],
        [true, "Unit-level data with 25 columns"],
        [true, "Monthly updates on the 1st"],
        [true, "Historical snapshots included"],
        [true, "Google Sheets, CSV, or API access"],
      ],
      featured: true, cta: "Get Started",
    },
    {
      tier: "Custom", name: "Enterprise & On-Demand", price: "Let's talk.", isCustom: true, note: "Tailored scope, frequency, and delivery",
      features: [
        [true, "Everything in Standard"],
        [true, "Weekly or bi-weekly updates"],
        [true, "Coverage beyond Bratislava"],
        [true, "Additional markets or property types"],
        [true, "Custom integrations and output formats"],
      ],
      featured: false, cta: "Contact Us",
    },
  ];

  const faqs = [
    ["What format does the data come in?", "Standard delivery is a shared Google Sheet with both raw and cleaned datasets. We can also deliver as CSV, Excel, or via API — depending on your plan and workflow."],
    ["How often is the data updated?", "Standard plans update monthly on the 1st. Custom plans can run weekly or bi-weekly — we adjust the pipeline frequency to match your needs."],
    ["Can you cover cities beyond Bratislava?", "Yes. The pipeline is market-agnostic — we can configure it for any city or region where developer data is publicly listed. This falls under our Custom plan."],
    ["Can I add specific projects or developers to track?", "Absolutely. If a project is publicly listed, we can add it to the registry. Custom clients can request additions at any time."],
    ["How accurate is the data?", "Every record is source-traceable — it links back to the original developer listing. We run validation checks across the pipeline and flag any inconsistencies for manual review."],
  ];

  return (
    <>
      <div style={{ padding: "8rem 2rem 3rem", maxWidth: 1100, margin: "0 auto", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Label>Pricing</Label>
        <h1 className="sec-title">Simple, transparent pricing.</h1>
        <p className="sec-desc" style={{ textAlign: "center" }}>Choose the plan that fits your needs. All plans include the full Bratislava new-build dataset.</p>
      </div>

      <div style={{ padding: "0 2rem 4rem", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.5rem" }}>
          {tiers.map(t => (
            <div key={t.tier} style={{
              border: `1px solid ${t.featured ? "#00e5a0" : "#222228"}`,
              borderRadius: 12, background: "#16161a", padding: "2.5rem",
              display: "flex", flexDirection: "column", position: "relative",
            }}>
              {t.featured && (
                <div style={{
                  position: "absolute", top: "-0.6rem", left: "50%", transform: "translateX(-50%)",
                  padding: "0.2rem 0.75rem", background: "#00e5a0", color: "#0a0a0b",
                  fontFamily: "'JetBrains Mono', monospace", fontSize: "0.6rem", fontWeight: 700,
                  letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 4,
                }}>Most Popular</div>
              )}
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", color: "#00e5a0", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.75rem" }}>{t.tier}</div>
              <h3 style={{ fontSize: "1.3rem", fontWeight: 600, marginBottom: "0.5rem" }}>{t.name}</h3>
              {t.isCustom ? (
                <div style={{ fontSize: "1.2rem", fontWeight: 600, marginBottom: "0.25rem" }}>{t.price}</div>
              ) : (
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "2.2rem", fontWeight: 700, marginBottom: "0.25rem" }}>
                  {t.price}{t.priceSuffix && <span style={{ fontSize: "1rem", fontWeight: 400, color: "#55555f" }}>{t.priceSuffix}</span>}
                </div>
              )}
              <div style={{ fontSize: "0.78rem", color: "#55555f", marginBottom: "2rem" }}>{t.note}</div>
              <div style={{ flex: 1, marginBottom: "2rem" }}>
                {t.features.map(([on, text]) => (
                  <div key={text} style={{ display: "flex", gap: "0.6rem", marginBottom: "0.75rem", alignItems: "flex-start" }}>
                    <span style={{ color: on ? "#00e5a0" : "#55555f", fontSize: "0.8rem", marginTop: "0.2rem" }}>{on ? "✓" : "—"}</span>
                    <p style={{ fontSize: "0.82rem", color: "#8a8a96", lineHeight: 1.5 }}>{text}</p>
                  </div>
                ))}
              </div>
              <a href={`mailto:hello@residata.sk?subject=${t.tier}%20Plan`} style={{
                display: "block", padding: "0.75rem 2rem", textAlign: "center",
                background: t.featured ? "#00e5a0" : "transparent",
                color: t.featured ? "#0a0a0b" : "#e8e8ed",
                border: t.featured ? "none" : "1px solid #222228",
                fontWeight: t.featured ? 600 : 500, fontSize: "0.9rem",
                borderRadius: 8, textDecoration: "none",
              }}>{t.cta}</a>
            </div>
          ))}
        </div>
      </div>

      {/* FAQ */}
      <div style={{ padding: "3rem 2rem 5rem", maxWidth: 800, margin: "0 auto" }}>
        <h3 style={{ fontSize: "1.3rem", fontWeight: 600, marginBottom: "2rem" }}>Common questions</h3>
        {faqs.map(([q, a], i) => (
          <div key={i} style={{ borderTop: "1px solid #222228", padding: "1.5rem 0", borderBottom: i === faqs.length - 1 ? "1px solid #222228" : "none" }}>
            <div style={{ fontSize: "0.95rem", fontWeight: 500, marginBottom: "0.5rem" }}>{q}</div>
            <div style={{ fontSize: "0.85rem", color: "#8a8a96", lineHeight: 1.65, fontWeight: 300 }}>{a}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: "4rem 2rem 6rem", textAlign: "center", position: "relative" }}>
        <div style={{
          position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)",
          width: 600, height: 400,
          background: "radial-gradient(ellipse, rgba(0,229,160,0.15) 0%, transparent 70%)",
          pointerEvents: "none", opacity: 0.3,
        }} />
        <h2 style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "1rem" }}>Not sure which plan fits?</h2>
        <p style={{ color: "#8a8a96", maxWidth: 480, margin: "0 auto 2rem", fontWeight: 300 }}>Reach out and we'll walk you through the data, the pipeline, and which option makes sense for your use case.</p>
        <a href="mailto:hello@residata.sk?subject=Residata%20Inquiry" className="btn-p">hello@residata.sk</a>
      </div>
    </>
  );
}

function Label({ children }) {
  return <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem", color: "#00e5a0", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "1rem" }}>{children}</div>;
}

export default function App() {
  const [current, setCurrent] = useState("Home");

  const handleNav = (page) => {
    setCurrent(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div style={{ background: "#0a0a0b", color: "#e8e8ed", fontFamily: "'Outfit', -apple-system, sans-serif", minHeight: "100vh", WebkitFontSmoothing: "antialiased" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Outfit:wght@300;400;500;600;700&display=swap');
        .sec-title { font-size: clamp(1.8rem, 3.5vw, 2.6rem); font-weight: 700; letter-spacing: -0.03em; margin-bottom: 1rem; line-height: 1.15; }
        .sec-desc { font-size: 1.05rem; color: #8a8a96; max-width: 600px; font-weight: 300; line-height: 1.7; }
        .btn-p { display: inline-block; padding: 0.75rem 2rem; background: #00e5a0; color: #0a0a0b; font-weight: 600; font-size: 0.9rem; border: none; border-radius: 8px; cursor: pointer; text-decoration: none; }
        .btn-p:hover { opacity: 0.85; }
        .btn-s { display: inline-block; padding: 0.75rem 2rem; background: transparent; color: #e8e8ed; font-weight: 500; font-size: 0.9rem; border: 1px solid #222228; border-radius: 8px; cursor: pointer; text-decoration: none; }
        .btn-s:hover { border-color: #55555f; }
      `}</style>
      <Nav current={current} setCurrent={handleNav} />
      {current === "Home" && <HomePage setCurrent={handleNav} />}
      {current === "Use Cases" && <UseCasesPage setCurrent={handleNav} />}
      {current === "Data" && <DataPage setCurrent={handleNav} />}
      {current === "Pricing" && <PricingPage />}
      <Footer />
    </div>
  );
}
