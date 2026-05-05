import { useEffect, useRef, useState } from "react";
import { useMarketTotals, useProjects, useDistrictTotals } from "../lib/useData";
// (imports already include useMarketTotals — we rely on its live view
// instead of summing projects.total_units, which inflates the count for
// projects like Bory/Slnečnice whose total_units is a manual registry
// anchor rather than actual scraped inventory.)

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const dim = "#8a8a96";
const border = "#222228";
const bg = "#16161a";

/* ──────────────────────────────────────────────────────────
   0. PIPELINE FLOW — dynamic single-canvas visualisation
   ────────────────────────────────────────────────────────── */

// (Predchádzajúca 3-karta grid verzia odstránená — user chcel naspäť dynamický
// V2 single-canvas koncept z /hero-lab. Nová implementácia nižšie.)

// ── IsoBuildingsCluster — 10 izometrických budov (cluster) ──
// Stable seed-based windows aby to nemrcalo pri re-render.
function IsoBuildingsCluster() {
  // [x, y, w, h, seed]
  const buildings = [
    [20,  110, 46, 120, 3],
    [70,   70, 46, 160, 5],
    [120, 100, 46, 130, 7],
    [170,  86, 46, 144, 2],
    [220, 118, 46, 112, 9],
    [35,  200, 46,  60, 4],
    [100, 210, 46,  50, 6],
    [165, 206, 46,  54, 8],
    [235, 212, 46,  48, 1],
    [-25,  96, 38, 134, 11],
  ];
  // Deterministic "lit window" pattern based on seed
  const litPattern = (seed, row, col) => ((seed * 37 + row * 13 + col * 7) % 10) > 6;
  return (
    <g>
      {buildings.map(([x, y, w, h, seed], i) => {
        const depth = 14;
        const cols = 3;
        const rows = Math.floor(h / 16);
        return (
          <g key={i}>
            {/* Top face (parallelogram) */}
            <polygon
              points={`${x},${y} ${x + depth * 0.8},${y - depth * 0.5} ${x + w + depth * 0.8},${y - depth * 0.5} ${x + w},${y}`}
              fill="#3a3a44"
              stroke="#4a4a54" strokeWidth="0.4"
            />
            {/* Right side face (dark) */}
            <polygon
              points={`${x + w},${y} ${x + w + depth * 0.8},${y - depth * 0.5} ${x + w + depth * 0.8},${y + h - depth * 0.5} ${x + w},${y + h}`}
              fill="#0d0d11"
              stroke="#1a1a20" strokeWidth="0.4"
            />
            {/* Front face with subtle gradient */}
            <rect x={x} y={y} width={w} height={h} fill="url(#iso-wall)" stroke="#2a2a32" strokeWidth="0.5" />
            {/* Windows — 3 cols × N rows */}
            {Array.from({ length: rows }).map((_, r) =>
              Array.from({ length: cols }).map((_, c) => {
                const wx = x + 4 + c * ((w - 8) / cols);
                const wy = y + 6 + r * 16;
                const lit = litPattern(seed, r, c);
                return (
                  <rect
                    key={`${r}-${c}`}
                    x={wx} y={wy}
                    width={(w - 8) / cols - 2} height="6"
                    fill={lit ? "url(#iso-lit)" : "#161620"}
                    opacity={lit ? 0.9 : 0.6}
                  />
                );
              })
            )}
            {/* Rooftop antenna for tallest */}
            {h > 140 && (
              <line x1={x + w / 2} y1={y - depth * 0.5} x2={x + w / 2} y2={y - depth * 0.5 - 10} stroke="#00e5a0" strokeWidth="0.6" opacity="0.7" />
            )}
          </g>
        );
      })}
      {/* Ground shadow */}
      <ellipse cx="125" cy="270" rx="160" ry="10" fill="#000" opacity="0.4" />
    </g>
  );
}

// ── Center Hub — hexagonal processor with rotating rings + pulsing core ──
function CenterHub({ subtitle }) {
  return (
    <g>
      {/* Outer glow halo */}
      <circle cx="0" cy="0" r="140" fill="url(#hub-halo)" opacity="0.6" />

      {/* Outer rotating ring — dashed */}
      <g>
        <circle cx="0" cy="0" r="100" fill="none" stroke="#00e5a0" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 6" />
        <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="22s" repeatCount="indefinite" />
      </g>

      {/* Inner counter-rotating ring */}
      <g>
        <circle cx="0" cy="0" r="80" fill="none" stroke="#00e5a0" strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="14 4" />
        <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="14s" repeatCount="indefinite" />
      </g>

      {/* Hexagonal core — 6-sided pipeline processor */}
      <g>
        <polygon
          points="0,-56 48,-28 48,28 0,56 -48,28 -48,-28"
          fill="#0e0e10"
          stroke="#00e5a0"
          strokeWidth="1.8"
        >
          <animate attributeName="stroke-opacity" values="0.5;1;0.5" dur="2.6s" repeatCount="indefinite" />
        </polygon>
        {/* Inner hex fill with gradient */}
        <polygon
          points="0,-40 34,-20 34,20 0,40 -34,20 -34,-20"
          fill="url(#hub-core)"
          opacity="0.85"
        />
        {/* Icon: three horizontal bars (schema bars) */}
        <g fill="#00e5a0">
          <rect x="-20" y="-12" width="40" height="3.2" rx="1.2" />
          <rect x="-20" y="-2"  width="28" height="3.2" rx="1.2" opacity="0.7" />
          <rect x="-20" y="8"   width="34" height="3.2" rx="1.2" opacity="0.85" />
        </g>
      </g>

      {/* Surrounding micro-dots orbiting */}
      {[0, 72, 144, 216, 288].map((deg, i) => (
        <g key={i} transform={`rotate(${deg})`}>
          <circle cx="90" cy="0" r="2.5" fill="#00e5a0">
            <animate attributeName="opacity" values="0.3;1;0.3" dur="2.4s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
          </circle>
        </g>
      ))}

      {/* Subtitle tag underneath */}
      <rect x="-92" y="78" width="184" height="24" rx="12" fill="#0e0e10" stroke="#00e5a0" strokeOpacity="0.4" strokeWidth="0.8" />
      <text x="0" y="94" textAnchor="middle" fill="#00e5a0" fontFamily={mono} fontSize="11" fontWeight="700" letterSpacing="0.06em">
        {subtitle}
      </text>
    </g>
  );
}

// ── Dashboard panel — right-side terminal/dashboard target ──
function DashboardPanel({ captionRow1, captionRow2, chipLabels }) {
  return (
    <g>
      {/* Panel frame with glow */}
      <rect x="0" y="0" width="310" height="260" rx="14" fill="#0e0e10" stroke="#00e5a0" strokeOpacity="0.45" strokeWidth="1.3" />
      <rect x="0" y="0" width="310" height="260" rx="14" fill="none" stroke="#00e5a0" strokeOpacity="0.12" strokeWidth="4" />

      {/* Header bar */}
      <rect x="0" y="0" width="310" height="32" rx="14" fill="#111113" />
      <rect x="0" y="18" width="310" height="14" fill="#111113" />
      <circle cx="14" cy="16" r="4" fill="#ff5f57" />
      <circle cx="28" cy="16" r="4" fill="#ffbd2e" />
      <circle cx="42" cy="16" r="4" fill="#28c840" />
      <text x="155" y="20" textAnchor="middle" fill="#55555f" fontFamily={mono} fontSize="9" letterSpacing="0.08em">
        residata — live dashboard
      </text>

      {/* Chart card — €/m² trend */}
      <g transform="translate(16, 46)">
        <rect x="0" y="0" width="278" height="100" rx="8" fill="#0a0a0b" stroke="#1a1a1f" strokeWidth="0.6" />
        <text x="10" y="16" fill="#8a8a96" fontFamily={mono} fontSize="8" letterSpacing="0.06em">AVG €/M² · 6 MONTHS</text>
        <text x="268" y="16" textAnchor="end" fill="#00e5a0" fontFamily={mono} fontSize="8" fontWeight="700">+12% YoY</text>

        {/* Area under curve */}
        <path
          d="M 12 80 L 52 62 L 92 68 L 132 44 L 172 50 L 212 28 L 262 40 L 262 92 L 12 92 Z"
          fill="url(#chart-area)" opacity="0.5"
        />
        {/* Line */}
        <path
          d="M 12 80 L 52 62 L 92 68 L 132 44 L 172 50 L 212 28 L 262 40"
          fill="none" stroke="#00e5a0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        />
        {/* Line draw-in animation */}
        <path
          d="M 12 80 L 52 62 L 92 68 L 132 44 L 172 50 L 212 28 L 262 40"
          fill="none" stroke="#00e5a0" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray="400" strokeDashoffset="400"
        >
          <animate attributeName="stroke-dashoffset" from="400" to="0" dur="1.6s" fill="freeze" />
        </path>
        {/* Dots */}
        {[[12,80],[52,62],[92,68],[132,44],[172,50],[212,28],[262,40]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.2" fill="#0a0a0b" stroke="#00e5a0" strokeWidth="1.3" />
        ))}
        {/* Current-period marker (rightmost) */}
        <circle cx="262" cy="40" r="4" fill="#00e5a0">
          <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" />
        </circle>
      </g>

      {/* Mini table row */}
      <g transform="translate(16, 160)">
        <rect x="0" y="0" width="278" height="50" rx="6" fill="#0a0a0b" stroke="#1a1a1f" strokeWidth="0.6" />
        {/* Row 1 */}
        {/* Real active projects with real avg_price_eur_m2 from DB. */}
        <text x="10" y="18" fill="#e8e8ed" fontFamily="'Outfit', sans-serif" fontSize="10" fontWeight="600">Slnecnice</text>
        <text x="150" y="18" fill="#8a8a96" fontFamily={mono} fontSize="9">Petržalka</text>
        <text x="225" y="18" fill="#00e5a0" fontFamily={mono} fontSize="9" fontWeight="700">4,963 €/m²</text>
        {/* Row 2 */}
        <line x1="8" y1="26" x2="270" y2="26" stroke="#1a1a1f" strokeWidth="0.5" />
        <text x="10" y="42" fill="#e8e8ed" fontFamily="'Outfit', sans-serif" fontSize="10" fontWeight="600">Downtown Yards</text>
        <text x="150" y="42" fill="#8a8a96" fontFamily={mono} fontSize="9">Staré Mesto</text>
        <text x="225" y="42" fill="#00e5a0" fontFamily={mono} fontSize="9" fontWeight="700">7,088 €/m²</text>
      </g>

      {/* Export chips */}
      <g transform="translate(16, 222)">
        {chipLabels.map((label, i) => {
          const widths = [62, 48, 54];
          const xs = [0, 72, 128];
          return (
            <g key={label}>
              <rect x={xs[i]} y="0" width={widths[i]} height="24" rx="5"
                fill="#0a0a0b" stroke="#00e5a0" strokeOpacity="0.55" strokeWidth="0.9" />
              <text x={xs[i] + widths[i] / 2} y="16" textAnchor="middle"
                fill="#00e5a0" fontFamily={mono} fontSize="9" fontWeight="700" letterSpacing="0.08em">
                {label}
              </text>
            </g>
          );
        })}
        {/* Caption next to chips */}
        <text x="196" y="10" fill="#8a8a96" fontFamily={mono} fontSize="7" letterSpacing="0.05em">{captionRow1}</text>
        <text x="196" y="20" fill="#55555f" fontFamily={mono} fontSize="7" letterSpacing="0.05em">{captionRow2}</text>
      </g>
    </g>
  );
}

// ── FlowStream — multi-dot animated stream between x1,y and x2,y ──
function FlowStream({ x1, y, x2, count = 5, delayOffset = 0, duration = 3.2 }) {
  return (
    <>
      {/* Static track */}
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="#222228" strokeWidth="1" strokeDasharray="2 4" />
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="url(#flow-gradient)" strokeWidth="2" opacity="0.4" />

      {/* Animated dots */}
      {Array.from({ length: count }).map((_, i) => (
        <circle key={i} r="3.2" fill="#00e5a0" filter="url(#dot-glow)">
          <animateMotion
            dur={`${duration}s`}
            begin={`${delayOffset + (i * duration) / count}s`}
            repeatCount="indefinite"
            path={`M ${x1} ${y} L ${x2} ${y}`}
          />
          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.15;0.85;1"
            dur={`${duration}s`}
            begin={`${delayOffset + (i * duration) / count}s`}
            repeatCount="indefinite"
          />
        </circle>
      ))}
    </>
  );
}

export function PipelineFlow({ lang = "en" }) {
  // LIVE čísla z DB. units-in-dataset siahame na metrics.total_units_tracked
  // (count of real flats in DB) — NIE na sum(projects.total_units) lebo
  // projekty ako Bory/Slnečnice tam majú manuálne inflated totals z
  // registry a nadúvalo to číslo na ~11k (lie voči reálnym ~5 100).
  // `useMetrics` už nečerpáme — "units in dataset" sme odstránili (duplicita
  // s MarketPulse o pár sekcií nižšie, ktorý to isté číslo ukazuje veľkými
  // číslami ako "bytov sledovaných"). PipelineFlow ostáva "o tom čo robíme"
  // (developeri → projekty → ako často), MarketPulse je "čo to naozaj je"
  // (počty bytov, dostupné, predané, €/m²). Bez prekrytia.
  // Live-tracked counts come from market_totals (active filter applied
  // at the DB level — same number /live shows, same number Hero badge
  // shows, same number Ticker shows). projects.length here would be 90
  // (full registry incl. paused/sold-out) which is misleading on a
  // "live pipeline" panel.
  const marketTotals = useMarketTotals();
  const devCount  = marketTotals.developersActive ?? null;
  // projCount is used in two places:
  //   z1Live ("z X developerov · Y projektov") — flow description of where
  //     we currently scrape from → ACTIVE makes sense (currently collecting)
  //   stats KPI ("sledovaných projektov" / "projects tracked") — depth of
  //     dataset → TRACKED makes sense (active + sold-out under tracking)
  // We keep two separate counts so the labels don't lie.
  const projCount        = marketTotals.projectsActive  ?? null;
  const projTrackedCount = marketTotals.projectsTracked ?? marketTotals.projectsActive ?? null;
  // Pretty "—" when still loading; template strings below degrade gracefully.
  const fmt = (n, locale) => n == null ? "…" : Number(n).toLocaleString(locale);

  // Short + rich texts. Každé slovo nesie význam — žiadne buzzwordy.
  const T = lang === "sk" ? {
    label: "Ako to funguje",
    title: "Od webov developerov k živému trhovému prehľadu.",
    sub: "3-krokový automatizovaný flow",

    z1Line1: "Dáta zbierame",
    z1Live: `z ${fmt(devCount, "sk-SK")} developerov · ${fmt(projCount, "sk-SK")} projektov`,
    z1Foot: "každý mesiac, bez výnimiek",

    z2Line1: "Normalizácia a validácia",
    z2Chip: "PRIPRAVENÉ · DEDUPLIKOVANÉ",

    z3Line1: "Živý trhový prehľad",
    z3Foot: "pre vaše rozhodnutia podložené dátami",
    z3Chips: ["Sheets", "CSV", "API"],
    z3Cap1: "MESAČNÁ AKTUALIZÁCIA",
    z3Cap2: "alebo týždenne na vyžiadanie",

    // 3 KPI karty pod SVG-scénou. 4. karta "bytov v datasete" sme pustili
    // — duplikovala totožné číslo z MarketPulse nižšie. Toto je "o nás /
    // čo robíme" (vstupy + kadencia), MarketPulse je "aké sú dáta"
    // (počty bytov, dostupné, predané). "sledovaných projektov" (nie
    // "aktívnych") lebo projects.length = 90 = všetko v registri, aktívnych
    // je ~57.
    statsLabel: ["developerov", "sledovaných projektov", "aktualizácia"],
  } : {
    label: "How it works",
    title: "From scattered developer sites to live market intelligence.",
    sub: "3-step automated flow",

    z1Line1: "Data collected",
    z1Live: `from ${fmt(devCount, "en-US")} developers · ${fmt(projCount, "en-US")} projects`,
    z1Foot: "every month",

    z2Line1: "Standardize & validate",
    z2Chip: "READY · DEDUPED",

    z3Line1: "Real-time market intelligence",
    z3Foot: "for your data-driven decisions",
    z3Chips: ["Sheets", "CSV", "API"],
    z3Cap1: "MONTHLY AUTO-REFRESH",
    z3Cap2: "or weekly on demand",

    // See Slovak comment above for why this is 3 cards, not 4.
    statsLabel: ["developers", "projects tracked", "refresh cadence"],
  };

  return (
    <section style={{ padding: "3rem 2rem 5rem", maxWidth: 1280, margin: "0 auto" }}>
      {/* Header — krátky a vecný */}
      <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
        <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          {T.label}
        </div>
        <h2 style={{ fontSize: "clamp(1.8rem, 3.2vw, 2.5rem)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15, color: "#e8e8ed", margin: 0 }}>
          {T.title}
        </h2>
        <p style={{ color: dim, fontSize: "1rem", marginTop: "0.8rem", maxWidth: 640, margin: "0.8rem auto 0", lineHeight: 1.6 }}>
          {T.sub}
        </p>
      </div>

      {/* Scene canvas — single cohesive SVG */}
      <div style={{
        position: "relative",
        background: "linear-gradient(180deg, #0a0a0b 0%, #101014 100%)",
        border: `1px solid ${border}`, borderRadius: 16, overflow: "hidden",
        marginBottom: "1.5rem",
      }}>
        <svg viewBox="0 0 1400 520" style={{ width: "100%", height: "auto", display: "block" }}>
          <defs>
            {/* Building gradient */}
            <linearGradient id="iso-wall" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2d2d36" />
              <stop offset="100%" stopColor="#15151c" />
            </linearGradient>
            {/* Lit window gradient */}
            <linearGradient id="iso-lit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f5a623" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#00e5a0" stopOpacity="0.7" />
            </linearGradient>
            {/* Hub halo */}
            <radialGradient id="hub-halo">
              <stop offset="0%" stopColor="#00e5a0" stopOpacity="0.35" />
              <stop offset="60%" stopColor="#00e5a0" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#00e5a0" stopOpacity="0" />
            </radialGradient>
            {/* Hub core fill */}
            <linearGradient id="hub-core" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a2a24" />
              <stop offset="100%" stopColor="#0a0a0b" />
            </linearGradient>
            {/* Flow line gradient */}
            <linearGradient id="flow-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00e5a0" stopOpacity="0" />
              <stop offset="50%" stopColor="#00e5a0" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#00e5a0" stopOpacity="0" />
            </linearGradient>
            {/* Dashboard chart area */}
            <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00e5a0" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#00e5a0" stopOpacity="0" />
            </linearGradient>
            {/* Glow filter for flow dots */}
            <filter id="dot-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Dot-grid pattern backdrop */}
            <pattern id="dot-grid" width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.8" fill="#2a2a32" />
            </pattern>
          </defs>

          {/* Subtle dot-grid backdrop */}
          <rect x="0" y="0" width="1400" height="520" fill="url(#dot-grid)" opacity="0.35" />

          {/* Radial glow centered on hub */}
          <circle cx="700" cy="260" r="260" fill="url(#hub-halo)" opacity="0.4" />

          {/* ═══ ZONE 1: Iso buildings cluster (x: 40–340) ═══ */}
          <g transform="translate(60, 100)">
            <IsoBuildingsCluster />

            {/* Zone 1 label — text top-left */}
            <g transform="translate(-10, -70)">
              <text x="0" y="0" fill="#00e5a0" fontFamily={mono} fontSize="11" letterSpacing="0.14em" fontWeight="700">01 · COLLECT</text>
              <text x="0" y="22" fill="#fff" fontFamily="'Outfit', sans-serif" fontSize="20" fontWeight="700" letterSpacing="-0.01em">
                {T.z1Line1}
              </text>
              <text x="0" y="42" fill="#00e5a0" fontFamily={mono} fontSize="11.5" fontWeight="600" letterSpacing="0.02em">
                {T.z1Live}
              </text>
              <text x="0" y="58" fill={dim} fontFamily="'Outfit', sans-serif" fontSize="11">
                {T.z1Foot}
              </text>
            </g>
          </g>

          {/* ═══ FLOW 1 → 2 ═══ */}
          <FlowStream x1={360} y={260} x2={540} count={5} delayOffset={0} duration={2.8} />

          {/* ═══ ZONE 2: Central hub (x: 540–860) ═══ */}
          <g transform="translate(700, 260)">
            <CenterHub subtitle={T.z2Chip} />

            {/* Zone 2 label — above hub */}
            <g transform="translate(0, -190)">
              <text x="0" y="0" textAnchor="middle" fill="#00e5a0" fontFamily={mono} fontSize="11" letterSpacing="0.14em" fontWeight="700">02 · PROCESS</text>
              <text x="0" y="22" textAnchor="middle" fill="#fff" fontFamily="'Outfit', sans-serif" fontSize="20" fontWeight="700" letterSpacing="-0.01em">
                {T.z2Line1}
              </text>
            </g>
          </g>

          {/* ═══ FLOW 2 → 3 ═══ */}
          <FlowStream x1={860} y={260} x2={1040} count={5} delayOffset={0.6} duration={2.8} />

          {/* ═══ ZONE 3: Dashboard panel (x: 1040–1350) ═══ */}
          <g transform="translate(1040, 130)">
            <DashboardPanel
              captionRow1={T.z3Cap1}
              captionRow2={T.z3Cap2}
              chipLabels={T.z3Chips}
            />

            {/* Zone 3 label — above panel */}
            <g transform="translate(0, -70)">
              <text x="0" y="0" fill="#00e5a0" fontFamily={mono} fontSize="11" letterSpacing="0.14em" fontWeight="700">03 · DELIVER</text>
              <text x="0" y="22" fill="#fff" fontFamily="'Outfit', sans-serif" fontSize="20" fontWeight="700" letterSpacing="-0.01em">
                {T.z3Line1}
              </text>
              <text x="0" y="42" fill={dim} fontFamily="'Outfit', sans-serif" fontSize="11.5">
                {T.z3Foot}
              </text>
            </g>
          </g>
        </svg>
      </div>

      {/* Stats strip — 3 karty: čo sledujeme (vstup) + ako často. Reálne
          počty bytov sú v MarketPulse nižšie, netreba ich tu duplikovať. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 1,
        padding: 0,
        background: border,
        border: `1px solid ${border}`,
        borderRadius: 12,
        overflow: "hidden",
      }} className="pipeline-stats">
        {[
          { n: fmt(devCount,         lang === "sk" ? "sk-SK" : "en-US"), label: T.statsLabel[0] },
          // KPI label is "sledovaných projektov" / "projects tracked" — value
          // matches the label: projects with archive data (active + sold-out
          // under tracking). Today this equals projectsActive; over time as
          // projects sell out the number grows beyond projectsActive.
          { n: fmt(projTrackedCount, lang === "sk" ? "sk-SK" : "en-US"), label: T.statsLabel[1] },
          // 3. karta = cadence, slovný stat. "Mesačne" / "Monthly" hovorí
          // čo kupujúcemu zaujíma: ako často dostane fresh dáta.
          { n: lang === "sk" ? "Mesačne" : "Monthly",                   label: T.statsLabel[2] },
        ].map((s, i) => (
          <div key={i} style={{
            textAlign: "center",
            padding: "1.25rem 0.5rem",
            background: "linear-gradient(180deg, #0e0e10, #16161a)",
          }}>
            <div style={{ fontFamily: mono, fontSize: "clamp(1.6rem, 3vw, 2.2rem)", fontWeight: 700, color: green, letterSpacing: "-0.02em", lineHeight: 1 }}>
              {s.n}
            </div>
            <div style={{ fontSize: "0.7rem", color: dim, marginTop: "0.45rem", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: mono }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @media (max-width: 560px) {
          .pipeline-stats { grid-template-columns: 1fr !important; }
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
  const totals = useMarketTotals();

  // Pull the hero numbers from the LIVE `market_totals` view — derived
  // on every read from flats_archive (latest month). Always fresh: the
  // moment manual data lands in the archive or a sync writes new rows,
  // these numbers update without a separate refresh step.
  //
  // The four numbers are:
  //   · totalUnits  → count of all flats in the latest snapshot month
  //   · totalAvail  → count where stav = 'V'
  //   · totalSold   → count where stav = 'P' (real explicit sold,
  //                   not "everything that's not available")
  //   · avgEurM2    → simple arithmetic mean of cena/area across flats
  //                   with both valid price and area
  //
  // No more registry-inflated totals leaking in (those were the
  // Bory 984 / Slnečnice 4000 manual_total values that pushed the
  // homepage ticker up by ~5k vs. real data).
  const totalUnits = totals.unitsTracked;
  const totalAvail = totals.unitsAvailable;
  const totalSold  = totals.unitsSold;
  const avgEurM2   = totals.avgPriceM2;

  const label = lang === "sk" ? "Živé dáta z trhu" : "Live from the market";
  const tTotal = lang === "sk" ? "bytov sledovaných" : "units tracked";
  const tActive = lang === "sk" ? "voľných bytov" : "available now";
  const tSold = lang === "sk" ? "predaných celkom" : "sold to date";
  const tEur = lang === "sk" ? "priemer €/m²" : "avg €/m²";
  const topTitle = lang === "sk" ? "Najaktívnejšie projekty" : "Most active projects";
  const openAll = lang === "sk" ? "Všetky projekty →" : "View all projects →";

  // "Most active" = most units sold in the last month. This is a per-
  // project delta the sync script fills in as `sold_last_month` (count
  // of P flats that flipped since last batch, plus a manual_total-
  // based velocity estimate for projects like Bory / Slnecnice where
  // the developer doesn't publish P explicitly).
  //
  // First data snapshot lives in project_snapshots; we only have one
  // month yet, so sold_last_month is NULL for everyone until the May
  // sync run. Until then we fall back to sorting by available_units
  // (same as before) so the section isn't empty, but we label it
  // honestly with a small note. Once the next sync populates real
  // velocity, the sort key flips and the note disappears.
  // Limit to active projects so paused/sold_out don't show as "most
  // active" with stale availability/velocity. Manual projects
  // (status='active') stay in.
  const activeProjects = projects.filter(p => (p.status || "active") === "active");
  const anyVelocity = activeProjects.some(p => (p.sold_last_month || 0) > 0);
  const top = anyVelocity
    ? activeProjects
        .filter(p => (p.sold_last_month || 0) > 0)
        .sort((a, b) => (b.sold_last_month || 0) - (a.sold_last_month || 0))
        .slice(0, 6)
    : [...activeProjects]
        .sort((a, b) => (b.available_units || 0) - (a.available_units || 0))
        .slice(0, 6);

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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: anyVelocity ? "1rem" : "0.3rem" }}>
        <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#e8e8ed", fontFamily: mono, letterSpacing: "0.02em" }}>{topTitle}</h3>
        <button onClick={() => setCurrent && setCurrent("Live")} style={{ background: "none", border: "none", color: green, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit" }}>{openAll}</button>
      </div>
      {!anyVelocity && (
        <div style={{ fontSize: "0.78rem", color: "#8a8a96", marginBottom: "1rem", fontStyle: "italic" }}>
          {lang === "sk"
            ? "Predaje za posledný mesiac začneme zobrazovať od ďalšieho behu syncu (1. mája). Zatiaľ zobrazujeme projekty s najväčšou otvorenou ponukou."
            : "Last-month sales appear after the next sync run (May 1). Showing projects with the largest open inventory meanwhile."}
        </div>
      )}

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
        {(project.sold_last_month || 0) > 0 && (
          <span style={{ color: "#f5a623", fontWeight: 600 }}>+{project.sold_last_month} {lang === "sk" ? "za mesiac" : "this month"} · </span>
        )}
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

function useAnimatedNumber(target, dur = 1200, delayMs = 0) {
  const [value, setValue] = useState(0);
  const ref = useRef({ raf: 0, from: 0, timer: 0 });
  useEffect(() => {
    if (target == null) return;
    const from = ref.current.from;
    const to = target;
    const run = () => {
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
    };
    clearTimeout(ref.current.timer);
    if (delayMs > 0) ref.current.timer = setTimeout(run, delayMs);
    else run();
    return () => { cancelAnimationFrame(ref.current.raf); clearTimeout(ref.current.timer); };
  }, [target, dur, delayMs]);
  return value;
}

/* ──────────────────────────────────────────────────────────
   2. DISTRICT PULSE — horizontal bar chart of avg €/m² per district.
   Data: live from Supabase (useProjects → aggregate by district).
   Animation: each row plays in when the section scrolls into view
   — bar fills left→right, number counts up 0→avg, small shimmer
   sweep, staggered by row. 300-400ms each, cascade 80ms offset.
   ────────────────────────────────────────────────────────── */

function useInView(rootMargin = "0px") {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); obs.disconnect(); } },
      { rootMargin, threshold: 0.15 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView, rootMargin]);
  return [ref, inView];
}

export function DistrictPulse({ lang = "en", setCurrent }) {
  const { districts, loading } = useDistrictTotals();
  const [sectionRef, inView] = useInView();

  // Read per-district aggregates from the `district_totals` Postgres
  // view (live aggregate from flats_archive's latest month). One row
  // per district with REAL counts:
  //   · total_units    — all flats we actually track in the district
  //   · available_units — stav = 'V'
  //   · sold_units      — stav = 'P'  (the explicit sold count, no
  //                       inflation from manual_total registry overrides)
  //   · project_count   — distinct projects with at least 1 flat
  //   · avg_eur_m2      — arithmetic mean of cena/area over priced flats
  //
  // Drop districts without a price signal (avg_eur_m2 = null) so the
  // bar chart's max-scale stays meaningful — same UX as before.
  const rows = (districts || [])
    .filter(d => d.avg_eur_m2 != null)
    .map(d => ({
      district: d.district,
      avg: Number(d.avg_eur_m2),
      count: d.project_count,
      units: d.total_units,
      avail: d.available_units,
      sold: d.sold_units,
    }))
    .sort((a, b) => b.avg - a.avg);

  const max = rows.length > 0 ? Math.max(...rows.map(r => r.avg)) : 1;

  const label = lang === "sk" ? "Cenová mapa Bratislavy" : "Bratislava pricing map";
  const title = lang === "sk" ? "Priemerná cena €/m² podľa okresu" : "Average €/m² by district";
  const desc = lang === "sk"
    ? "Skutočné dáta z aktívnych projektov. Updatuje sa každý mesiac po novom run-e."
    : "Real data from active projects. Refreshes every month after a new pipeline run.";

  return (
    <section ref={sectionRef} style={{ padding: "5rem 2rem", maxWidth: 1100, margin: "0 auto", borderTop: `1px solid ${border}` }}>
      <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
        {label}
      </div>
      <h2 className="sec-title" style={{ marginBottom: "0.5rem" }}>{title}</h2>
      <p className="sec-desc" style={{ marginBottom: "2.5rem" }}>{desc}</p>

      {loading && rows.length === 0 ? (
        <div style={{ color: dim, fontFamily: mono, fontSize: "0.85rem", padding: "2rem 0" }}>
          {lang === "sk" ? "Načítavam…" : "Loading…"}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ color: dim, fontSize: "0.9rem" }}>
          {lang === "sk" ? "Žiadne dáta zatiaľ." : "No data yet."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {rows.map((r, i) => (
            <DistrictRow
              key={r.district}
              row={r}
              index={i}
              max={max}
              animate={inView}
              lang={lang}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DistrictRow({ row, index, max, animate, lang }) {
  const pct = (row.avg / max) * 100;
  const color = colorForPrice(row.avg);
  const delay = 0.08 * index;
  const animatedAvg = useAnimatedNumber(animate ? Math.round(row.avg) : 0, 1100, delay * 1000);

  return (
    <div
      style={{
        display: "grid", gridTemplateColumns: "180px 1fr 160px", gap: "1rem", alignItems: "center",
        opacity: animate ? 1 : 0,
        transform: animate ? "translateY(0)" : "translateY(8px)",
        transition: `opacity 0.5s ease ${delay}s, transform 0.5s ease ${delay}s`,
      }}
      className="district-row"
    >
      {/* Left: district name + count subtitle (was INSIDE the bar with
          mixBlendMode — which cost paint and was hard to read). Moving
          it out of the bar kills the perf cost and fixes contrast. */}
      <div>
        <div style={{ fontSize: "0.92rem", color: "#e8e8ed", fontWeight: 500, lineHeight: 1.25 }}>{row.district}</div>
        <div style={{ fontSize: "0.68rem", color: "#8a8a96", fontFamily: mono, marginTop: 2, letterSpacing: "0.02em" }}>
          {row.count} {lang === "sk" ? "proj" : "proj"} · {row.units.toLocaleString("en-US").replace(/,/g, " ")} {lang === "sk" ? "bytov" : "units"}
        </div>
      </div>

      {/* Bar — cleaner, no overlay text so the fill color stays readable
          and no mix-blend-mode paint cost. */}
      <div style={{
        height: 28, background: "#0e0e10", borderRadius: 6, overflow: "hidden", position: "relative",
        border: `1px solid ${border}`,
      }}>
        <div style={{
          width: animate ? `${pct}%` : "0%",
          height: "100%",
          background: `linear-gradient(90deg, ${color}33, ${color})`,
          borderRight: `2px solid ${color}`,
          transition: `width 1.1s cubic-bezier(0.2, 0.85, 0.25, 1) ${delay}s`,
          position: "relative",
          willChange: "width",
        }}>
          {animate && (
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)",
              animation: `dp-shimmer 1.6s ease-out ${delay + 0.2}s 1`,
              pointerEvents: "none",
            }} />
          )}
        </div>
      </div>

      {/* Right: animated €/m² — the main figure, high contrast colored. */}
      <div style={{
        fontFamily: mono, fontSize: "1.05rem", fontWeight: 700, color,
        textAlign: "right", fontVariantNumeric: "tabular-nums",
        textShadow: `0 0 8px ${color}22`,
      }}>
        {animatedAvg.toLocaleString("en-US").replace(/,/g, " ")} €
      </div>
    </div>
  );
}

function colorForPrice(avg) {
  if (avg >= 7000) return "#ff6b6b"; // premium
  if (avg >= 5500) return "#f5a623"; // upper
  if (avg >= 4200) return "#00e5a0"; // mid
  return "#4a90e2"; // affordable
}

/* HowItWorksFlow + its 4 icon helpers used to live here. Replaced on
   the homepage by PipelineFlow above, which uses live counts from
   useMarketTotals (not the hardcoded "60+ developer webov" string).
   The dead export was a stale-numbers landmine during reviews — and
   App.jsx never imported it — so it's removed entirely. */
