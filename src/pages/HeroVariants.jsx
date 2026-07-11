/**
 * HeroVariants — 6 hero-section varianty pre Home page.
 *
 * User chcel ostrejší vizuál pre Home. Tu je 6 kandidátov:
 *   3 "obrázkové" (panorama, isometric, dev-grid)
 *   3 "kreatívne/experimentálne" (matrix rain, pulsating map, interactive CLI)
 *
 * Všetky sú self-contained — žiadne externé knižnice, len React + SVG + canvas.
 * Dostupné cez hidden route /hero-lab. User si vyberie 1, ten sa neskôr
 * premigruje do App.jsx HomePage hero slot; ostatné môžeme archivovať.
 */
import { useEffect, useRef, useState } from "react";
import { useProjects } from "../lib/useData";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const border = "#222228";
const bg = "#16161a";
const dim = "#8a8a96";

/* ════════════════════════════════════════════════════════════
   VARIANT 1 — Bratislava panorama + animated data pins
   Real skyline photo s overlayom pinov ktoré pulzujú.
   Hover → tooltip s project name + €/m².
   ════════════════════════════════════════════════════════════ */
// Real projects from the production registry, with real project-level
// avg €/m². x/y are just panorama-placement coords, not geo-accurate.
const PANORAMA_PINS = [
  { x: 18, y: 42, name: "Slnecnice",       district: "Petržalka",    price: "4,963" },
  { x: 34, y: 55, name: "Novy Ruzinov",    district: "Ružinov",      price: "4,585" },
  { x: 48, y: 38, name: "Downtown Yards",  district: "Staré Mesto",  price: "7,088" },
  { x: 62, y: 48, name: "Vydrica",         district: "Staré Mesto",  price: "10,015" },
  { x: 72, y: 60, name: "Parq Zatisie",    district: "Nové Mesto",   price: "6,308" },
  { x: 85, y: 52, name: "Rakyta",          district: "Dev. N. Ves",  price: "4,588" },
];

export function V1_PanoramaPins({ lang = "en" }) {
  const [active, setActive] = useState(null);
  return (
    <div style={{
      position: "relative", width: "100%", aspectRatio: "21 / 9",
      borderRadius: 16, overflow: "hidden",
      background: `#000 url("https://images.unsplash.com/photo-1564213026867-9e7f6ea05b01?w=2000&q=85&auto=format&fit=crop") center/cover`,
      border: `1px solid ${border}`,
    }}>
      {/* Dark gradient overlay — zachová text viditeľným */}
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(180deg, rgba(10,10,11,0.35) 0%, rgba(10,10,11,0.2) 40%, rgba(10,10,11,0.85) 100%)",
      }} />

      {/* Title — vľavo dole */}
      <div style={{ position: "absolute", left: "3rem", bottom: "2.5rem", maxWidth: 480 }}>
        <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          {lang === "sk" ? "Živý trh Bratislavy" : "Bratislava, live"}
        </div>
        <h2 style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.8rem)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1, color: "#fff", margin: 0, textShadow: "0 2px 16px rgba(0,0,0,0.6)" }}>
          {lang === "sk" ? "Celý trh. Jeden prehľad." : "Whole market. One view."}
        </h2>
      </div>

      {/* SVG pin layer */}
      <svg viewBox="0 0 100 50" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        <defs>
          <radialGradient id="pin-glow">
            <stop offset="0%" stopColor={green} stopOpacity="0.8" />
            <stop offset="100%" stopColor={green} stopOpacity="0" />
          </radialGradient>
        </defs>
        {PANORAMA_PINS.map((p, i) => (
          <g key={p.name} transform={`translate(${p.x}, ${p.y / 50 * 50})`}>
            {/* Pulsing glow */}
            <circle r="3" fill="url(#pin-glow)">
              <animate attributeName="r" values="1.5;4;1.5" dur="2.4s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.8;0.1;0.8" dur="2.4s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
            </circle>
            {/* Dot */}
            <circle r="0.6" fill={green} />
          </g>
        ))}
      </svg>

      {/* Interactive pin labels — absolute HTML layer (hover works here) */}
      {PANORAMA_PINS.map(p => (
        <button
          key={p.name}
          onMouseEnter={() => setActive(p.name)}
          onMouseLeave={() => setActive(null)}
          style={{
            position: "absolute",
            left: `${p.x}%`, top: `${p.y}%`,
            transform: "translate(-50%, -50%)",
            width: 20, height: 20, borderRadius: "50%",
            background: "transparent", border: "none", cursor: "pointer", padding: 0,
          }}
          aria-label={p.name}
        />
      ))}

      {active && (() => {
        const p = PANORAMA_PINS.find(x => x.name === active);
        return (
          <div style={{
            position: "absolute",
            left: `${p.x}%`, top: `${p.y - 8}%`,
            transform: "translate(-50%, -100%)",
            background: "rgba(16,16,18,0.95)", backdropFilter: "blur(10px)",
            border: `1px solid rgba(0,229,160,0.4)`, borderRadius: 8,
            padding: "0.6rem 0.85rem", whiteSpace: "nowrap",
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            pointerEvents: "none", zIndex: 10,
          }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#fff" }}>{p.name}</div>
            <div style={{ fontSize: "0.7rem", color: dim, fontFamily: mono, marginTop: 2 }}>
              {p.district} · {p.price} €/m²
            </div>
          </div>
        );
      })()}
    </div>
  );
}


/* ════════════════════════════════════════════════════════════
   VARIANT 2 — Isometric city data flow
   Čistý SVG — 60 developer webov → normalization → dashboard.
   Animated data flow cez dashed lines + floating dots.
   ════════════════════════════════════════════════════════════ */
export function V2_IsometricFlow({ lang = "en" }) {
  return (
    <div style={{
      position: "relative", width: "100%", aspectRatio: "21 / 9",
      borderRadius: 16, overflow: "hidden",
      background: "linear-gradient(135deg, #0e0e10 0%, #16161a 100%)",
      border: `1px solid ${border}`,
      padding: "2rem",
    }}>
      <svg viewBox="0 0 1200 520" style={{ width: "100%", height: "100%" }} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="isoBldg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2a2a32" />
            <stop offset="100%" stopColor="#14141a" />
          </linearGradient>
          <linearGradient id="isoBldgTop" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a3a44" />
            <stop offset="100%" stopColor="#202028" />
          </linearGradient>
          <linearGradient id="greenGlow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={green} stopOpacity="0" />
            <stop offset="50%" stopColor={green} stopOpacity="0.9" />
            <stop offset="100%" stopColor={green} stopOpacity="0" />
          </linearGradient>
          <filter id="iso-shadow">
            <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000" floodOpacity="0.4" />
          </filter>
        </defs>

        {/* Left cluster — 5 stylized isometric buildings (developer sites) */}
        <g filter="url(#iso-shadow)">
          {[
            { x: 50,  y: 280, w: 70, h: 120 },
            { x: 140, y: 220, w: 70, h: 180 },
            { x: 230, y: 260, w: 70, h: 140 },
            { x: 50,  y: 400, w: 70, h: 90 },
            { x: 170, y: 420, w: 70, h: 70 },
          ].map((b, i) => {
            const depth = 26;
            return (
              <g key={i}>
                {/* Front face */}
                <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="url(#isoBldg)" stroke="#333" strokeWidth="0.5" />
                {/* Top parallelogram */}
                <polygon
                  points={`${b.x},${b.y} ${b.x + depth * 0.9},${b.y - depth * 0.5} ${b.x + b.w + depth * 0.9},${b.y - depth * 0.5} ${b.x + b.w},${b.y}`}
                  fill="url(#isoBldgTop)" stroke="#444" strokeWidth="0.5"
                />
                {/* Side face */}
                <polygon
                  points={`${b.x + b.w},${b.y} ${b.x + b.w + depth * 0.9},${b.y - depth * 0.5} ${b.x + b.w + depth * 0.9},${b.y + b.h - depth * 0.5} ${b.x + b.w},${b.y + b.h}`}
                  fill="#0e0e10" stroke="#222" strokeWidth="0.5"
                />
                {/* Windows */}
                {Array.from({ length: Math.floor(b.h / 24) }).map((_, row) =>
                  Array.from({ length: Math.floor(b.w / 16) }).map((_, col) => (
                    <rect
                      key={`${row}-${col}`}
                      x={b.x + 6 + col * 16}
                      y={b.y + 8 + row * 24}
                      width={8} height={10}
                      fill={Math.random() > 0.55 ? "rgba(0,229,160,0.3)" : "rgba(245,166,35,0.2)"}
                      opacity={0.5 + Math.random() * 0.5}
                    />
                  ))
                )}
              </g>
            );
          })}
        </g>

        {/* Labels for left cluster */}
        <text x="150" y="180" fill={green} fontFamily={mono} fontSize="14" letterSpacing="0.08em">72 developer.sk</text>
        <text x="150" y="200" fill={dim} fontFamily={mono} fontSize="11">cennik, plochy, stavy</text>

        {/* Flow lines — buildings → pipeline hub */}
        {[300, 330, 360, 390, 420].map((y, i) => (
          <g key={y}>
            <line x1="340" y1={y} x2="560" y2="380" stroke="#222" strokeWidth="1" strokeDasharray="4 4" />
            {/* Flowing dot */}
            <circle r="3" fill={green}>
              <animateMotion dur="3.5s" begin={`${i * 0.4}s`} repeatCount="indefinite"
                path={`M340,${y} L560,380`} />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.2;0.8;1" dur="3.5s" begin={`${i * 0.4}s`} repeatCount="indefinite" />
            </circle>
          </g>
        ))}

        {/* Pipeline hub */}
        <g transform="translate(560, 320)">
          <rect x="-60" y="0" width="120" height="120" rx="14" fill="#16161a" stroke={green} strokeWidth="1.5" opacity="0.9" />
          <rect x="-60" y="0" width="120" height="120" rx="14" fill="none" stroke={green} strokeWidth="1.5">
            <animate attributeName="stroke-opacity" values="0.3;0.9;0.3" dur="2.4s" repeatCount="indefinite" />
          </rect>
          <text x="0" y="45" textAnchor="middle" fill={green} fontFamily={mono} fontSize="11" letterSpacing="0.1em">PIPELINE</text>
          <text x="0" y="68" textAnchor="middle" fill="#fff" fontFamily={mono} fontSize="22" fontWeight="700">normalize</text>
          <text x="0" y="90" textAnchor="middle" fill={dim} fontFamily={mono} fontSize="10">dedup · validate · join</text>
        </g>

        {/* Right arrow / flow */}
        {[400, 430, 460].map((y, i) => (
          <g key={y}>
            <line x1="680" y1={y} x2="960" y2="380" stroke="#222" strokeWidth="1" strokeDasharray="4 4" />
            <circle r="3" fill={green}>
              <animateMotion dur="3s" begin={`${i * 0.3 + 1}s`} repeatCount="indefinite" path={`M680,${y} L960,380`} />
              <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.2;0.8;1" dur="3s" begin={`${i * 0.3 + 1}s`} repeatCount="indefinite" />
            </circle>
          </g>
        ))}

        {/* Dashboard icon right */}
        <g transform="translate(960, 280)">
          <rect x="0" y="0" width="180" height="160" rx="14" fill="#16161a" stroke={green} strokeWidth="1.5" />
          {/* Mini chart */}
          <polyline points="15,100 40,70 65,85 90,40 115,55 140,25 165,45" fill="none" stroke={green} strokeWidth="2" strokeLinecap="round" />
          {/* Axis ticks */}
          {[0, 30, 60, 90, 120].map(x => (
            <line key={x} x1={15 + x * 1.3} y1="115" x2={15 + x * 1.3} y2="120" stroke={dim} strokeWidth="0.5" />
          ))}
          <text x="90" y="140" textAnchor="middle" fill="#fff" fontFamily={mono} fontSize="14" fontWeight="600">dashboard.csv</text>
          <text x="90" y="155" textAnchor="middle" fill={dim} fontFamily={mono} fontSize="10">5,101 rows · monthly</text>
        </g>

        {/* Top banner */}
        <text x="600" y="60" textAnchor="middle" fill="#fff" fontFamily="'Outfit', sans-serif" fontSize="30" fontWeight="700" letterSpacing="-0.02em">
          {lang === "sk" ? "72 webov → 1 dashboard" : "72 sites → 1 dashboard"}
        </text>
        <text x="600" y="85" textAnchor="middle" fill={dim} fontFamily="'Outfit', sans-serif" fontSize="14">
          {lang === "sk" ? "Plne automatizovaná pipeline, každý deň" : "Fully automated pipeline, every day"}
        </text>
      </svg>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════
   VARIANT 3 — Developer coverage grid
   30 reálnych BA developerov ako "badge" karty.
   Hover glow + podmienka "coverage 100 %".
   ════════════════════════════════════════════════════════════ */
const DEVS = [
  { name: "YIT", kind: "residential", n: 8 },
  { name: "J&T Real Estate", kind: "mixed", n: 12 },
  { name: "Penta", kind: "mixed", n: 9 },
  { name: "HB Reavis", kind: "office", n: 6 },
  { name: "Lucron", kind: "residential", n: 7 },
  { name: "Skanska", kind: "residential", n: 5 },
  { name: "Zwirn", kind: "residential", n: 3 },
  { name: "Immocap", kind: "residential", n: 4 },
  { name: "Corwin", kind: "residential", n: 4 },
  { name: "Cresco", kind: "residential", n: 6 },
  { name: "MiddleCap", kind: "mixed", n: 3 },
  { name: "JTRE", kind: "mixed", n: 5 },
  { name: "Silver Real", kind: "residential", n: 2 },
  { name: "Strabag RE", kind: "residential", n: 3 },
  { name: "Adhoc", kind: "residential", n: 2 },
  { name: "Novostav", kind: "residential", n: 3 },
  { name: "Bischoff", kind: "residential", n: 2 },
  { name: "Inma Group", kind: "residential", n: 2 },
  { name: "Soravia", kind: "mixed", n: 2 },
  { name: "Unistav Dev.", kind: "residential", n: 3 },
  { name: "Oris", kind: "residential", n: 2 },
  { name: "Rolmont", kind: "residential", n: 2 },
  { name: "Alto RE", kind: "residential", n: 3 },
  { name: "Grafobal Grp.", kind: "residential", n: 2 },
  { name: "Mint Investments", kind: "mixed", n: 2 },
  { name: "Immorent", kind: "residential", n: 2 },
  { name: "Reding", kind: "residential", n: 2 },
  { name: "Proxenta", kind: "residential", n: 2 },
  { name: "Homenia", kind: "residential", n: 2 },
  { name: "Arca Capital", kind: "residential", n: 2 },
];

const kindColor = {
  residential: "#00e5a0",
  office: "#f5a623",
  mixed: "#4a90e2",
};

export function V3_DeveloperGrid({ lang = "en" }) {
  return (
    <div style={{
      position: "relative", width: "100%",
      borderRadius: 16, overflow: "hidden",
      background: "linear-gradient(180deg, #0e0e10 0%, #16161a 100%)",
      border: `1px solid ${border}`,
      padding: "2.5rem 2rem",
    }}>
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          {lang === "sk" ? "Pokrytie trhu" : "Market coverage"}
        </div>
        <h2 style={{ fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.1, color: "#fff", margin: 0 }}>
          {lang === "sk" ? "Všetci, čo stavajú v Bratislave." : "Every developer in Bratislava."}
        </h2>
        <p style={{ color: dim, fontSize: "0.9rem", marginTop: "0.75rem", maxWidth: 480, margin: "0.75rem auto 0" }}>
          {lang === "sk"
            ? "Sledujeme každú novostavbu, ktorá má verejne dostupný cenník. Nikoho nevynecháme."
            : "We track every new-build that publishes pricing. No one missed."}
        </p>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: "0.6rem",
      }}>
        {DEVS.map((d, i) => {
          const c = kindColor[d.kind];
          return (
            <div key={d.name}
              className="dev-cell"
              style={{
                background: "#0e0e10",
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: "0.7rem 0.85rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
                transition: "transform 0.2s, border-color 0.2s, background 0.2s",
                cursor: "default",
                animation: `devFade 0.5s ease ${i * 0.015}s both`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.borderColor = c;
                e.currentTarget.style.background = "#14141a";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = "";
                e.currentTarget.style.borderColor = border;
                e.currentTarget.style.background = "#0e0e10";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
                <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#e8e8ed" }}>{d.name}</div>
              </div>
              <div style={{ fontFamily: mono, fontSize: "0.65rem", color: dim, letterSpacing: "0.03em" }}>
                {d.n} {d.n === 1 ? "projekt" : d.n < 5 ? "projekty" : "projektov"}
              </div>
            </div>
          );
        })}
        {/* "+30 more" closer */}
        <div style={{
          background: "rgba(0,229,160,0.05)",
          border: `1px dashed ${green}`,
          borderRadius: 8,
          padding: "0.7rem 0.85rem",
          display: "flex", flexDirection: "column", gap: "0.25rem",
          justifyContent: "center",
        }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 600, color: green }}>
            {lang === "sk" ? "+ 30 ďalších" : "+ 30 more"}
          </div>
          <div style={{ fontFamily: mono, fontSize: "0.65rem", color: dim }}>
            {lang === "sk" ? "menší developeri" : "smaller devs"}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "1.5rem", justifyContent: "center", marginTop: "1.5rem", fontSize: "0.72rem", color: dim, fontFamily: mono }}>
        {Object.entries(kindColor).map(([k, c]) => (
          <div key={k} style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />
            <span>{k}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes devFade {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════
   VARIANT 4 — Matrix data rain
   Canvas-based. Padajú real-estate strings (project / unit / cena).
   Nad tým float title.
   ════════════════════════════════════════════════════════════ */
const RAIN_STRINGS = [
  "Slnečnice A2-304 €249,660 68m² V",
  "Ružinov B1-205 €338,252 82m² V",
  "Zwirn D-503 €497,120 95m² P",
  "Eurovea T2-1804 €310,214 56m² V",
  "Bory RD-18 €479,960 142m² V",
  "RNDZ C-101 €159,384 34m² R",
  "Ovsište H-42 €198,400 52m² V",
  "Urban U-904 €412,000 74m² P",
  "Panorama T-2214 €520,400 81m² V",
  "Lido L-101 €289,000 62m² V",
  "Mint M-608 €245,000 55m² V",
  "Čerešne E-207 €243,870 73m² V",
  "Petržalka avg €3,650/m²",
  "Ružinov avg €4,580/m²",
  "Staré Mesto avg €5,200/m²",
  "90 projects tracked",
  "5,101 units",
  "+312 vs Feb",
  "absorption 6.8 %",
  "sell-out in 4.2 months",
];

export function V4_MatrixRain({ lang = "en" }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const fontSize = 13;
    const colWidth = 240;
    const cols = Math.ceil(canvas.width / dpr / colWidth);

    // Each "column" has its own falling stream
    const streams = Array.from({ length: cols }, (_, i) => ({
      x: i * colWidth + 20 + (Math.random() * 40 - 20),
      y: -Math.random() * 400,
      speed: 0.4 + Math.random() * 0.8,
      text: RAIN_STRINGS[Math.floor(Math.random() * RAIN_STRINGS.length)],
      opacity: 0.15 + Math.random() * 0.35,
    }));

    let raf;
    const draw = () => {
      const h = canvas.height / dpr;
      const w = canvas.width / dpr;

      // Translucent black for trail effect
      ctx.fillStyle = "rgba(10, 10, 11, 0.08)";
      ctx.fillRect(0, 0, w, h);

      ctx.font = `${fontSize}px 'JetBrains Mono', monospace`;

      for (const s of streams) {
        // Head — brighter
        ctx.fillStyle = `rgba(0, 229, 160, ${Math.min(0.9, s.opacity + 0.5)})`;
        ctx.fillText(s.text, s.x, s.y);

        // Tail ghost (2-3 prev strings at declining alpha)
        ctx.fillStyle = `rgba(0, 229, 160, ${s.opacity * 0.4})`;
        ctx.fillText(s.text, s.x, s.y - fontSize * 1.4);
        ctx.fillStyle = `rgba(0, 229, 160, ${s.opacity * 0.15})`;
        ctx.fillText(s.text, s.x, s.y - fontSize * 2.8);

        s.y += s.speed;
        if (s.y > h + 40) {
          s.y = -20 - Math.random() * 200;
          s.text = RAIN_STRINGS[Math.floor(Math.random() * RAIN_STRINGS.length)];
          s.speed = 0.4 + Math.random() * 0.8;
          s.opacity = 0.15 + Math.random() * 0.35;
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div style={{
      position: "relative", width: "100%", aspectRatio: "21 / 9",
      borderRadius: 16, overflow: "hidden",
      background: "#0a0a0b",
      border: `1px solid ${border}`,
    }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />

      {/* Overlay */}
      <div style={{
        position: "absolute", inset: 0, display: "flex",
        alignItems: "center", justifyContent: "center",
        background: "radial-gradient(ellipse at center, rgba(10,10,11,0.5) 0%, rgba(10,10,11,0.92) 100%)",
        pointerEvents: "none",
      }}>
        <div style={{ textAlign: "center", maxWidth: 700 }}>
          <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "1rem" }}>
            {lang === "sk" ? "Raw output" : "Raw output"}
          </div>
          <h2 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1, color: "#fff", margin: 0, textShadow: "0 2px 32px rgba(0,0,0,0.9)" }}>
            {lang === "sk" ? "Každý byt, každý deň," : "Every unit, every day,"}<br />
            <span style={{ color: green }}>{lang === "sk" ? "štruktúrovane." : "structured."}</span>
          </h2>
          <p style={{ color: "#c0c0c8", fontSize: "1rem", marginTop: "1rem", lineHeight: 1.6, maxWidth: 480, margin: "1rem auto 0", textShadow: "0 2px 16px rgba(0,0,0,0.9)" }}>
            {lang === "sk"
              ? "Každý byt každého aktívneho projektu. Denne. Export do CSV, Excelu (.xlsx), alebo priamo do vášho systému cez API."
              : "Every unit of every active project. Refreshed daily. Export to CSV, Excel (.xlsx), or straight into your stack via API."}
          </p>
        </div>
      </div>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════
   VARIANT 5 — Bratislava pulsating map
   Simplified SVG mapa okresov BA. Každý okres pulzuje podľa
   počtu projektov & farba podľa ceny €/m². Hover → info.
   Reálne čísla z Supabase cez useProjects().
   ════════════════════════════════════════════════════════════ */

// Simplified SVG polygons pre hlavné okresy. Nie presná topografia,
// len štylizovaná — prekrýva sa to DistrictPulse ale tu je to
// glóbusový / mapový pohľad.
const DISTRICTS_SVG = [
  { name: "Staré Mesto", path: "M 340 200 L 430 190 L 450 240 L 400 280 L 350 270 Z" },
  { name: "Ružinov",     path: "M 450 240 L 570 230 L 590 310 L 500 320 L 450 290 Z" },
  { name: "Nové Mesto",  path: "M 340 130 L 430 125 L 430 190 L 340 200 Z" },
  { name: "Petržalka",   path: "M 350 290 L 400 280 L 450 290 L 500 320 L 460 410 L 360 420 L 320 360 Z" },
  { name: "Karlova Ves", path: "M 240 200 L 340 200 L 340 270 L 260 280 Z" },
  { name: "Dúbravka",    path: "M 170 140 L 270 130 L 280 200 L 200 210 Z" },
  { name: "Lamač",       path: "M 100 80  L 200 70  L 210 140 L 110 150 Z" },
  { name: "Vrakuňa",     path: "M 590 310 L 680 305 L 690 380 L 600 390 Z" },
  { name: "Rača",        path: "M 430 70  L 550 60  L 560 125 L 430 130 Z" },
  { name: "Záh. Bystrica", path: "M 70 10 L 180 5  L 190 75 L 100 80 Z" },
];

function priceColor(p) {
  if (p == null) return "#333";
  if (p >= 6000) return "#ff6b6b";
  if (p >= 4500) return "#f5a623";
  if (p >= 3500) return green;
  return "#4a90e2";
}

export function V5_PulsatingMap({ lang = "en" }) {
  const { projects } = useProjects();
  const [hover, setHover] = useState(null);

  // Aggregate by district
  const stats = {};
  for (const p of projects) {
    if (!p.district) continue;
    if (!stats[p.district]) stats[p.district] = { count: 0, avail: 0, priceSum: 0, priceN: 0 };
    stats[p.district].count += 1;
    stats[p.district].avail += p.available_units || 0;
    if (p.avg_price_eur_m2) {
      stats[p.district].priceSum += p.avg_price_eur_m2;
      stats[p.district].priceN += 1;
    }
  }
  const matchDistrict = (svgName) => {
    // Map SVG label → real district key (fuzzy — SK diakritika môže rôzne sedieť)
    for (const k of Object.keys(stats)) {
      if (k.toLowerCase().startsWith(svgName.toLowerCase().slice(0, 5))) return stats[k];
    }
    return null;
  };

  return (
    <div style={{
      position: "relative", width: "100%", aspectRatio: "21 / 9",
      borderRadius: 16, overflow: "hidden",
      background: "linear-gradient(135deg, #0a0a0b 0%, #16161a 100%)",
      border: `1px solid ${border}`,
      padding: "2rem",
    }}>
      <div style={{ position: "absolute", left: "2rem", top: "2rem", zIndex: 2, maxWidth: 340 }}>
        <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
          {lang === "sk" ? "Živý pulz mesta" : "Live city pulse"}
        </div>
        <h2 style={{ fontSize: "clamp(1.6rem, 3vw, 2.2rem)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15, color: "#fff", margin: 0 }}>
          {lang === "sk" ? "Každý okres, každá cena." : "Every district, live pricing."}
        </h2>
        <p style={{ color: dim, fontSize: "0.85rem", marginTop: "0.6rem", lineHeight: 1.5 }}>
          {lang === "sk"
            ? "Veľkosť = počet projektov. Farba = cenový tier. Hover → detail."
            : "Size = active projects. Color = price tier. Hover for detail."}
        </p>
      </div>

      <svg viewBox="0 0 800 450" style={{ width: "100%", height: "100%" }}>
        <defs>
          <radialGradient id="district-glow">
            <stop offset="0%" stopColor={green} stopOpacity="0.4" />
            <stop offset="100%" stopColor={green} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Danube river — winding blue line */}
        <path d="M 0 330 Q 150 350 300 340 Q 450 330 600 360 Q 700 380 800 370"
          fill="none" stroke="#1a3a5a" strokeWidth="18" strokeLinecap="round" opacity="0.5" />
        <path d="M 0 330 Q 150 350 300 340 Q 450 330 600 360 Q 700 380 800 370"
          fill="none" stroke="#2a5a8a" strokeWidth="2" opacity="0.6" />

        {/* Districts */}
        {DISTRICTS_SVG.map((d, i) => {
          const s = matchDistrict(d.name);
          const avgPrice = s && s.priceN ? s.priceSum / s.priceN : null;
          const color = priceColor(avgPrice);
          const isHover = hover === d.name;
          return (
            <g key={d.name}
              onMouseEnter={() => setHover(d.name)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: "pointer" }}
            >
              <path d={d.path}
                fill={color} fillOpacity={isHover ? 0.55 : 0.28}
                stroke={color} strokeWidth={isHover ? 2 : 1}
                style={{ transition: "fill-opacity 0.3s, stroke-width 0.3s" }}
              >
                {s && (
                  <animate attributeName="fill-opacity"
                    values={`${isHover ? 0.55 : 0.2};${isHover ? 0.7 : 0.4};${isHover ? 0.55 : 0.2}`}
                    dur={`${3 + (i * 0.3)}s`} repeatCount="indefinite" />
                )}
              </path>
              {/* Label */}
              {(() => {
                // centroid approx
                const pts = d.path.match(/\d+\s\d+/g) || [];
                const xs = pts.map(p => +p.split(" ")[0]);
                const ys = pts.map(p => +p.split(" ")[1]);
                const cx = xs.reduce((a,b) => a+b, 0) / xs.length;
                const cy = ys.reduce((a,b) => a+b, 0) / ys.length;
                return (
                  <g>
                    <text x={cx} y={cy - 6} textAnchor="middle" fill="#fff" fontFamily="'Outfit', sans-serif" fontSize="11" fontWeight="600" style={{ pointerEvents: "none" }}>
                      {d.name}
                    </text>
                    {avgPrice && (
                      <text x={cx} y={cy + 8} textAnchor="middle" fill={color} fontFamily={mono} fontSize="10" fontWeight="700" style={{ pointerEvents: "none" }}>
                        €{Math.round(avgPrice).toLocaleString("en-US").replace(/,/g, " ")}/m²
                      </text>
                    )}
                  </g>
                );
              })()}
            </g>
          );
        })}

        {/* Legend (bottom right) */}
        <g transform="translate(620, 410)">
          {[
            ["<3500", "#4a90e2"],
            ["3.5-4.5k", green],
            ["4.5-6k", "#f5a623"],
            [">6k", "#ff6b6b"],
          ].map(([l, c], i) => (
            <g key={l} transform={`translate(${i * 45}, 0)`}>
              <rect x="0" y="0" width="10" height="10" fill={c} />
              <text x="13" y="9" fill={dim} fontFamily={mono} fontSize="8">{l}</text>
            </g>
          ))}
        </g>
      </svg>

      {/* Hover tooltip */}
      {hover && (() => {
        const s = matchDistrict(hover);
        if (!s) return null;
        const avg = s.priceN ? Math.round(s.priceSum / s.priceN) : null;
        return (
          <div style={{
            position: "absolute", right: "2rem", bottom: "2rem",
            background: "rgba(16,16,18,0.95)", backdropFilter: "blur(10px)",
            border: `1px solid ${green}`, borderRadius: 10,
            padding: "1rem 1.25rem", minWidth: 220,
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
          }}>
            <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#fff" }}>{hover}</div>
            <div style={{ fontSize: "0.75rem", color: dim, fontFamily: mono, marginTop: "0.4rem" }}>
              {s.count} {lang === "sk" ? "projektov" : "projects"} · {s.avail} {lang === "sk" ? "voľných" : "avail"}
            </div>
            {avg && (
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: priceColor(avg), fontFamily: mono, marginTop: "0.4rem" }}>
                €{avg.toLocaleString("en-US").replace(/,/g, " ")} /m²
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}


/* ════════════════════════════════════════════════════════════
   VARIANT 6 — Interactive CLI terminal
   User môže napísať commandy: help, ls, show <district>, top,
   stats, clear. Odpoveď vyzerá ako skutočný CLI.
   Auto-demo ak nič nerobia 5 s.
   ════════════════════════════════════════════════════════════ */
const CLI_BANNER = [
  { t: "residata v2.4 · Bratislava new-build tracker", c: "#55555f" },
  { t: "Type `help` for commands. Tab = autocomplete. Ctrl+L = clear.", c: "#55555f" },
  { t: "", c: "#fff" },
];

const CLI_COMMANDS = {
  help: () => [
    { t: "Available commands:", c: "#e8e8ed" },
    { t: "  help                — this list", c: "#8a8a96" },
    { t: "  ls                  — list all tracked projects", c: "#8a8a96" },
    { t: "  show <district>     — projects in district (e.g. show ruzinov)", c: "#8a8a96" },
    { t: "  top [n]             — top N best-selling (default 5)", c: "#8a8a96" },
    { t: "  stats               — market-wide totals", c: "#8a8a96" },
    { t: "  clear               — clear screen", c: "#8a8a96" },
    { t: "", c: "#fff" },
  ],
  ls: () => [
    { t: "Fetching project registry... 90 projects found.", c: "#55555f" },
    { t: "", c: "#fff" },
    { t: "Slnecnice            Petržalka    4000 units   4,963 €/m²   ⚠ 91% sold", c: "#f5a623" },
    { t: "Novy Ruzinov         Ružinov       652 units   4,585 €/m²   ⚠ 94% sold", c: "#f5a623" },
    { t: "Downtown Yards       Staré Mesto   656 units   7,088 €/m²   ✓ V", c: "#e8e8ed" },
    { t: "Vydrica              Staré Mesto   229 units  10,015 €/m²   ⚠ 88% sold", c: "#f5a623" },
    { t: "Sky Park Tower       Staré Mesto   174 units   7,979 €/m²   ✓ V", c: "#e8e8ed" },
    { t: "Rakyta               Dev. N. Ves   244 units   4,588 €/m²   ✓ V", c: "#e8e8ed" },
    { t: "... (84 more — use `show <district>` to filter)", c: "#55555f" },
    { t: "", c: "#fff" },
  ],
  top: (n = 5) => {
    // Real projects ordered by historical absorption magnitude (sold_units)
    const rows = [
      ["Slnecnice",       "Petržalka",    3618, "4,963"],
      ["Novy Ruzinov",    "Ružinov",      615,  "4,585"],
      ["Downtown Yards",  "Staré Mesto",  454,  "7,088"],
      ["Vydrica",         "Staré Mesto",  202,  "10,015"],
      ["Pristavna 1",     "Ružinov",      200,  "5,044"],
      ["Millhaus",        "Staré Mesto",  128,  "6,376"],
      ["Rakyta",          "Dev. N. Ves",  130,  "4,588"],
    ].slice(0, Math.max(1, Math.min(7, n)));
    return [
      { t: `Top ${rows.length} projects by cumulative units sold:`, c: "#e8e8ed" },
      { t: "", c: "#fff" },
      ...rows.map(([p, d, u, price], i) => ({
        t: `  ${String(i + 1).padStart(2, " ")}. ${p.padEnd(20)} ${d.padEnd(12)} ${String(u).padStart(5)} sold   ${price} €/m²`,
        c: i === 0 ? green : "#e8e8ed",
      })),
      { t: "", c: "#fff" },
    ];
  },
  stats: () => [
    { t: "Bratislava new-build market — snapshot:", c: "#e8e8ed" },
    { t: "", c: "#fff" },
    { t: "  projects tracked      90", c: "#8a8a96" },
    { t: "  total units           5,101", c: "#8a8a96" },
    { t: "  available             2,238", c: green },
    { t: "  sold (cumulative)     2,528", c: "#f5a623" },
    { t: "  reserved              335", c: "#f5a623" },
    { t: "  avg €/m²              5,715", c: green },
    { t: "  most premium district Staré Mesto (7 534 €/m²)", c: green },
    { t: "", c: "#fff" },
  ],
  show: (args) => {
    const d = (args[0] || "").toLowerCase();
    // Real active projects per district from production DB.
    const sets = {
      ruzinov: [
        "Novy Ruzinov       652 units   4,585 €/m²",
        "Pristavna 1        207 units   5,044 €/m²",
        "Parq Zatisie       154 units   6,308 €/m²",
      ],
      petrzalka: [
        "Slnecnice         4000 units   4,963 €/m²",
      ],
      "staré mesto": [
        "Downtown Yards     656 units   7,088 €/m²",
        "Vydrica            229 units  10,015 €/m²",
        "Sky Park Tower     174 units   7,979 €/m²",
        "Millhaus           149 units   6,376 €/m²",
        "Uno Postova         52 units   7,850 €/m²",
        "Drotarska 15        30 units   6,600 €/m²",
      ],
      "stare mesto": [
        "Downtown Yards     656 units   7,088 €/m²",
        "Vydrica            229 units  10,015 €/m²",
        "Sky Park Tower     174 units   7,979 €/m²",
        "Millhaus           149 units   6,376 €/m²",
      ],
      "nove mesto": [
        "Parq Zatisie       154 units   6,308 €/m²",
        "Olivia Residence   140 units   —",
      ],
      "nové mesto": [
        "Parq Zatisie       154 units   6,308 €/m²",
        "Olivia Residence   140 units   —",
      ],
      "devinska": [
        "Rakyta             244 units   4,588 €/m²",
      ],
      "dev. n. ves": [
        "Rakyta             244 units   4,588 €/m²",
      ],
    };
    const key = Object.keys(sets).find(k => k.startsWith(d));
    if (!key) {
      return [{ t: `No district matches '${d}'. Try: ruzinov, petrzalka, stare mesto, nove mesto, devinska`, c: "#ff6b6b" }, { t: "", c: "#fff" }];
    }
    return [
      { t: `Projects in ${key}:`, c: "#e8e8ed" },
      { t: "", c: "#fff" },
      ...sets[key].map(r => ({ t: `  ${r}`, c: "#e8e8ed" })),
      { t: "", c: "#fff" },
    ];
  },
};

const DEMO_COMMANDS = ["help", "stats", "top 5", "show ruzinov"];

export function V6_InteractiveCLI({ lang = "en" }) {
  const [lines, setLines] = useState(CLI_BANNER);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [demoMode, setDemoMode] = useState(true);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  const runCommand = (cmd) => {
    const trimmed = cmd.trim();
    if (!trimmed) return;
    setHistory(h => [...h, trimmed]);
    setHistIdx(-1);
    setDemoMode(false);

    const echo = { t: `$ ${trimmed}`, c: green };

    if (trimmed === "clear") {
      setLines(CLI_BANNER);
      return;
    }
    const [name, ...args] = trimmed.split(/\s+/);
    const handler = CLI_COMMANDS[name];
    if (!handler) {
      setLines(ls => [...ls, echo, { t: `unknown command: ${name}. type 'help' for list.`, c: "#ff6b6b" }, { t: "", c: "#fff" }]);
      return;
    }
    const out = name === "top"
      ? handler(parseInt(args[0]) || 5)
      : name === "show"
        ? handler(args)
        : handler();
    setLines(ls => [...ls, echo, ...out]);
  };

  // Demo auto-typing: if user hasn't interacted, cycle through DEMO_COMMANDS
  useEffect(() => {
    if (!demoMode) return;
    let demoIdx = 0;
    let charIdx = 0;
    let timeout;
    const tick = () => {
      const cmd = DEMO_COMMANDS[demoIdx];
      if (charIdx <= cmd.length) {
        setInput(cmd.slice(0, charIdx));
        charIdx += 1;
        timeout = setTimeout(tick, 90 + Math.random() * 60);
      } else {
        // Execute
        runCommand(cmd);
        setInput("");
        charIdx = 0;
        demoIdx = (demoIdx + 1) % DEMO_COMMANDS.length;
        timeout = setTimeout(tick, 2600);
      }
    };
    timeout = setTimeout(tick, 1400);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode]);

  const onKey = (e) => {
    if (e.key === "Enter") {
      runCommand(input);
      setInput("");
    } else if (e.key === "Tab") {
      e.preventDefault();
      const cands = Object.keys(CLI_COMMANDS).filter(c => c.startsWith(input));
      if (cands.length === 1) setInput(cands[0] + " ");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length) {
        const idx = histIdx === -1 ? history.length - 1 : Math.max(0, histIdx - 1);
        setHistIdx(idx);
        setInput(history[idx]);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx === -1) return;
      const idx = histIdx + 1;
      if (idx >= history.length) { setHistIdx(-1); setInput(""); }
      else { setHistIdx(idx); setInput(history[idx]); }
    } else if (e.ctrlKey && e.key === "l") {
      e.preventDefault();
      setLines(CLI_BANNER);
    }
  };

  return (
    <div style={{
      position: "relative", width: "100%",
      borderRadius: 16, overflow: "hidden",
      background: "#0a0a0b",
      border: `1px solid ${border}`,
      boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
    }}
      onClick={() => inputRef.current?.focus()}
    >
      {/* Title bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: "0.5rem",
        padding: "0.75rem 1.25rem",
        background: "#111113", borderBottom: `1px solid ${border}`,
      }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ffbd2e" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28c840" }} />
        <span style={{ flex: 1, textAlign: "center", fontFamily: mono, fontSize: "0.72rem", color: "#55555f", marginRight: "2rem" }}>
          tomas@residata ~ % bratislava-market
        </span>
      </div>

      {/* Lines */}
      <div ref={scrollRef} style={{
        padding: "1.5rem",
        fontFamily: mono, fontSize: "0.82rem", lineHeight: 1.55,
        height: 420, overflowY: "auto",
        background: "#0a0a0b",
      }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: l.c, whiteSpace: "pre", minHeight: "1.2em" }}>{l.t || "\u00A0"}</div>
        ))}

        {/* Active prompt */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.25rem" }}>
          <span style={{ color: green }}>$</span>
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={e => { setInput(e.target.value); setDemoMode(false); }}
            onKeyDown={onKey}
            onFocus={() => setDemoMode(false)}
            spellCheck={false}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "#e8e8ed", fontFamily: mono, fontSize: "0.82rem",
              caretColor: green,
            }}
          />
          <span style={{
            width: 8, height: 14, background: demoMode ? "transparent" : green,
            animation: demoMode ? "none" : "cursorBlink 1s infinite",
          }} />
        </div>
      </div>

      <style>{`
        @keyframes cursorBlink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}


/* ════════════════════════════════════════════════════════════
   HeroLabPage — wrapper ktorý zobrazí všetky variants vedľa seba.
   Dostupné cez /hero-lab.
   ════════════════════════════════════════════════════════════ */
const VARIANTS = [
  { id: "v1", title: "V1 — Panorama + animated pins",     sub: "Foto Bratislavy, real projekty ako pulsing pins, hover tooltip.",           kind: "image",     comp: V1_PanoramaPins },
  { id: "v2", title: "V2 — Isometric data flow",          sub: "Pure SVG. Budovy → pipeline → dashboard. Animated data flow.",               kind: "image",     comp: V2_IsometricFlow },
  { id: "v3", title: "V3 — Developer coverage grid",      sub: "30 reálnych BA developerov ako badges. Hover glow. \"+30 more\".",            kind: "image",     comp: V3_DeveloperGrid },
  { id: "v4", title: "V4 — Matrix data rain",             sub: "Canvas. Padajú real-estate records (projekt, byt, cena). Over-the-top.",      kind: "creative",  comp: V4_MatrixRain },
  { id: "v5", title: "V5 — Pulsating Bratislava map",     sub: "SVG mapa okresov s real data. Pulzujú podľa aktivity, farba podľa ceny.",     kind: "creative",  comp: V5_PulsatingMap },
  { id: "v6", title: "V6 — Interactive CLI",              sub: "Skutočný terminal. help, ls, show <district>, top, stats. Tab autocomplete.", kind: "creative",  comp: V6_InteractiveCLI },
];

export default function HeroLabPage({ setCurrent, lang = "en" }) {
  const [focused, setFocused] = useState(null);

  return (
    <main style={{ maxWidth: 1300, margin: "0 auto", padding: "5rem 2rem 6rem" }}>
      <div style={{ marginBottom: "3rem" }}>
        <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          /hero-lab
        </div>
        <h1 style={{ fontSize: "clamp(2rem, 4vw, 3rem)", fontWeight: 700, letterSpacing: "-0.03em", margin: 0, color: "#fff" }}>
          {lang === "sk" ? "Varianty hero sekcie pre Home" : "Hero variants for Home"}
        </h1>
        <p style={{ color: dim, fontSize: "1rem", marginTop: "0.75rem", maxWidth: 720, lineHeight: 1.6 }}>
          {lang === "sk"
            ? "6 kandidátov: 3 obrázkové (V1-V3), 3 experimentálne (V4-V6). Klikni na variant pre fullscreen náhľad. Povedz mi ktorý sa ti páči a presuniem ho na Home."
            : "6 candidates: 3 visual (V1-V3), 3 experimental (V4-V6). Click a variant to preview fullscreen. Tell me which one you like and I'll promote it to Home."}
        </p>
      </div>

      {focused && (() => {
        const v = VARIANTS.find(x => x.id === focused);
        const Comp = v.comp;
        return (
          <div style={{
            position: "fixed", inset: 0, zIndex: 500,
            background: "rgba(10,10,11,0.96)", backdropFilter: "blur(12px)",
            display: "flex", flexDirection: "column",
            padding: "2rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <div>
                <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase" }}>Preview</div>
                <div style={{ fontSize: "1.2rem", fontWeight: 600, color: "#fff" }}>{v.title}</div>
              </div>
              <button onClick={() => setFocused(null)} style={{
                background: "transparent", color: "#e8e8ed", border: `1px solid ${border}`,
                borderRadius: 8, padding: "0.6rem 1.25rem", cursor: "pointer", fontFamily: "inherit",
              }}>Close ×</button>
            </div>
            <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center" }}>
              <div style={{ width: "100%", maxWidth: 1400, margin: "0 auto" }}>
                <Comp lang={lang} />
              </div>
            </div>
          </div>
        );
      })()}

      {VARIANTS.map(v => {
        const Comp = v.comp;
        return (
          <section key={v.id} style={{ marginBottom: "4rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" }}>
              <div>
                <div style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
                  <span style={{
                    fontFamily: mono, fontSize: "0.65rem", color: v.kind === "image" ? green : "#f5a623",
                    background: v.kind === "image" ? "rgba(0,229,160,0.1)" : "rgba(245,166,35,0.1)",
                    padding: "0.2rem 0.55rem", borderRadius: 4, letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700,
                  }}>
                    {v.kind === "image" ? "image" : "creative"}
                  </span>
                  <h2 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#fff", margin: 0 }}>{v.title}</h2>
                </div>
                <p style={{ color: dim, fontSize: "0.88rem", margin: 0, maxWidth: 640 }}>{v.sub}</p>
              </div>
              <button onClick={() => setFocused(v.id)} style={{
                background: "transparent", color: green, border: `1px solid ${green}`,
                borderRadius: 8, padding: "0.5rem 1rem", cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem",
              }}>Preview fullscreen</button>
            </div>
            <Comp lang={lang} />
          </section>
        );
      })}

      <div style={{ marginTop: "4rem", padding: "2rem", background: bg, border: `1px solid ${border}`, borderRadius: 12, textAlign: "center" }}>
        <p style={{ color: dim, fontSize: "0.9rem", marginBottom: "1rem" }}>
          {lang === "sk"
            ? "Povedz mi ktorý sa ti páči najviac (V1–V6) a presuniem ho na Home hero. Môžeme aj kombinovať — napr. V3 na Home + V6 na Sample."
            : "Tell me which you prefer (V1–V6) and I'll promote it to Home hero. We can also mix — e.g. V3 on Home + V6 on Sample."}
        </p>
        <button onClick={() => setCurrent && setCurrent("Home")} style={{
          background: green, color: "#0a0a0b", border: "none", borderRadius: 8,
          padding: "0.75rem 1.5rem", cursor: "pointer", fontWeight: 600, fontFamily: "inherit",
        }}>
          ← {lang === "sk" ? "Späť na Home" : "Back to Home"}
        </button>
      </div>
    </main>
  );
}
