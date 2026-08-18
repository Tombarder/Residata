import { useEffect, useRef, useState } from "react";
import { useMarketTotals, useHomeProjects, useTotalsList, useVelocityMature } from "../lib/useData";
import { useCountry, countryName } from "../lib/useCountry";
import { moneyFromEur, moneySymbol } from "../lib/money";
import { localeTag } from "../lib/locale";
import { useCurrency } from "../lib/useCurrency";
import { marketInventoryDisplay, fmtMonthsToSellout } from "../lib/absorption";
// (imports already include useMarketTotals — we rely on its live view
// instead of summing projects.total_units, which inflates the count for
// projects like Bory/Slnečnice whose total_units is a manual registry
// anchor rather than actual scraped inventory.)

const mono = "'JetBrains Mono', monospace";

// The "live dashboard" mock-up in the PipelineFlow scene reads LIVE data — see
// PipelineFlow below. It used to hold a hand-copied snapshot of the DB, which had
// silently rotted: it showed Downtown Yards in "Staré Mesto" at 8 638 €/m² when the
// project is in Ružinov at 7 133 €/m², and an SK market average of 5 525 against a
// real 4 719. A panel captioned "live dashboard" must not be able to go stale, so
// nothing here is hardcoded any more.
// PipelineFlow scene layout — ONE source of truth for the canvas geometry.
// The three zones are laid out on a single horizontal axis with a single
// header row, so the scene reads as symmetric instead of hand-placed.
//   ZONE_CX — optical centre (x) of each zone: buildings / hub / dashboard
//   AXIS_Y  — the shared vertical centre every zone visual sits on
//   HEAD_Y  — baseline of the first header line, identical for all zones
const ZONE_CX = [205, 700, 1190];
const AXIS_Y  = 270;
const HEAD_Y  = 44;

const green = "var(--accent)";
const dim = "var(--text-dim)";
const border = "var(--border)";
const bg = "var(--surface)";

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
              fill="var(--border-soft)"
              stroke="#4a4a54" strokeWidth="0.4"
            />
            {/* Right side face (dark) */}
            <polygon
              points={`${x + w},${y} ${x + w + depth * 0.8},${y - depth * 0.5} ${x + w + depth * 0.8},${y + h - depth * 0.5} ${x + w},${y + h}`}
              fill="#0d0d11"
              stroke="#1a1a20" strokeWidth="0.4"
            />
            {/* Front face with subtle gradient */}
            <rect x={x} y={y} width={w} height={h} fill="url(#iso-wall)" stroke="var(--border-soft)" strokeWidth="0.5" />
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
              <line x1={x + w / 2} y1={y - depth * 0.5} x2={x + w / 2} y2={y - depth * 0.5 - 10} stroke="var(--accent)" strokeWidth="0.6" opacity="0.7" />
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
        <circle cx="0" cy="0" r="100" fill="none" stroke="var(--accent)" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="3 6" />
        <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="22s" repeatCount="indefinite" />
      </g>

      {/* Inner counter-rotating ring */}
      <g>
        <circle cx="0" cy="0" r="80" fill="none" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="14 4" />
        <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="14s" repeatCount="indefinite" />
      </g>

      {/* Hexagonal core — 6-sided pipeline processor */}
      <g>
        <polygon
          points="0,-56 48,-28 48,28 0,56 -48,28 -48,-28"
          fill="var(--surface-2)"
          stroke="var(--accent)"
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
        <g fill="var(--accent)">
          <rect x="-20" y="-12" width="40" height="3.2" rx="1.2" />
          <rect x="-20" y="-2"  width="28" height="3.2" rx="1.2" opacity="0.7" />
          <rect x="-20" y="8"   width="34" height="3.2" rx="1.2" opacity="0.85" />
        </g>
      </g>

      {/* Surrounding micro-dots orbiting */}
      {[0, 72, 144, 216, 288].map((deg, i) => (
        <g key={i} transform={`rotate(${deg})`}>
          <circle cx="90" cy="0" r="2.5" fill="var(--accent)">
            <animate attributeName="opacity" values="0.3;1;0.3" dur="2.4s" begin={`${i * 0.2}s`} repeatCount="indefinite" />
          </circle>
        </g>
      ))}

      {/* Subtitle tag underneath — the pill is sized FROM the label, not a fixed
          width: a monospace glyph advance is exactly 0.6em, so at 11px with
          0.06em letter-spacing every character costs 7.26px. The old hardcoded
          184px fitted "READY · DEDUPED" but was ~5px too narrow for the Slovak
          "PRIPRAVENÉ · DEDUPLIKOVANÉ", which bled over its own border. */}
      {(() => {
        const pillW = Math.round(subtitle.length * (11 * 0.6 + 11 * 0.06)) + 28;
        return (
          <>
            <rect x={-pillW / 2} y="78" width={pillW} height="24" rx="12" fill="var(--surface-2)" stroke="var(--accent)" strokeOpacity="0.4" strokeWidth="0.8" />
            <text x="0" y="94" textAnchor="middle" fill="var(--accent)" fontFamily={mono} fontSize="11" fontWeight="700" letterSpacing="0.06em">
              {subtitle}
            </text>
          </>
        );
      })()}
    </g>
  );
}

// Trim a label to a character budget for SVG text, which has no text-overflow.
const clip = (t, n) => (t && t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : (t || ''));

// ── Dashboard panel — right-side terminal/dashboard target ──
function DashboardPanel({ captionRow1, captionRow2, chipLabels, avgLabel, rows, chartLabel }) {
  return (
    <g>
      {/* Panel frame with glow */}
      <rect x="0" y="0" width="310" height="260" rx="14" fill="var(--surface-2)" stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.3" />
      <rect x="0" y="0" width="310" height="260" rx="14" fill="none" stroke="var(--accent)" strokeOpacity="0.12" strokeWidth="4" />

      {/* Header bar */}
      <rect x="0" y="0" width="310" height="32" rx="14" fill="var(--surface)" />
      <rect x="0" y="18" width="310" height="14" fill="var(--surface)" />
      <circle cx="14" cy="16" r="4" fill="#ff5f57" />
      <circle cx="28" cy="16" r="4" fill="#ffbd2e" />
      <circle cx="42" cy="16" r="4" fill="#28c840" />
      <text x="155" y="20" textAnchor="middle" fill="var(--text-faint)" fontFamily={mono} fontSize="9" letterSpacing="0.08em">
        residata — live dashboard
      </text>

      {/* Chart card — €/m² trend */}
      <g transform="translate(16, 46)">
        <rect x="0" y="0" width="278" height="100" rx="8" fill="var(--bg)" stroke="var(--surface-3)" strokeWidth="0.6" />
        {/* The sparkline below is decoration — we have no 6-month series on this page.
            It therefore carries NO number of its own: the figure on the right is the
            live market average. The old panel printed a fabricated "+2.1% MoM" here. */}
        <text x="10" y="16" fill="var(--text-dim)" fontFamily={mono} fontSize="8" letterSpacing="0.06em">{chartLabel}</text>
        <text x="268" y="16" textAnchor="end" fill="var(--accent)" fontFamily={mono} fontSize="8" fontWeight="700">{avgLabel}</text>

        {/* Area under curve */}
        <path
          d="M 12 80 L 52 62 L 92 68 L 132 44 L 172 50 L 212 28 L 262 40 L 262 92 L 12 92 Z"
          fill="url(#chart-area)" opacity="0.5"
        />
        {/* Line */}
        <path
          d="M 12 80 L 52 62 L 92 68 L 132 44 L 172 50 L 212 28 L 262 40"
          fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
        />
        {/* Line draw-in animation */}
        <path
          d="M 12 80 L 52 62 L 92 68 L 132 44 L 172 50 L 212 28 L 262 40"
          fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray="400" strokeDashoffset="400"
        >
          <animate attributeName="stroke-dashoffset" from="400" to="0" dur="1.6s" fill="freeze" />
        </path>
        {/* Dots */}
        {[[12,80],[52,62],[92,68],[132,44],[172,50],[212,28],[262,40]].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="2.2" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.3" />
        ))}
        {/* Current-period marker (rightmost) */}
        <circle cx="262" cy="40" r="4" fill="var(--accent)">
          <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" />
        </circle>
      </g>

      {/* Mini table row */}
      <g transform="translate(16, 160)">
        <rect x="0" y="0" width="278" height="50" rx="6" fill="var(--bg)" stroke="var(--surface-3)" strokeWidth="0.6" />
        {/* Two REAL projects from the market currently being viewed. */}
        <line x1="8" y1="26" x2="270" y2="26" stroke="var(--surface-3)" strokeWidth="0.5" />
        {rows.map((r, i) => (
          <g key={i} transform={`translate(0, ${i * 24})`}>
            {/* SVG text does not wrap or ellipsize, so the columns are clipped by
                character budget instead: real project names run long ("Rohan City –
                Diamanty Karlín") and would otherwise run straight through the
                district column. The price is END-anchored at the row's right edge so
                a wider number (13 076 €/m²) grows leftwards instead of out of the panel. */}
            <text x="10" y="18" fill="var(--text)" fontFamily="'Outfit', sans-serif" fontSize="10" fontWeight="600">{clip(r.name, 24)}</text>
            <text x="150" y="18" fill="var(--text-dim)" fontFamily={mono} fontSize="9">{clip(r.district, 11)}</text>
            <text x="270" y="18" textAnchor="end" fill="var(--accent)" fontFamily={mono} fontSize="9" fontWeight="700">{r.price}</text>
          </g>
        ))}
      </g>

      {/* Export chips */}
      <g transform="translate(16, 222)">
        {chipLabels.map((label, i) => {
          const widths = [62, 48, 54];
          const xs = [0, 72, 128];
          return (
            <g key={label}>
              <rect x={xs[i]} y="0" width={widths[i]} height="24" rx="5"
                fill="var(--bg)" stroke="var(--accent)" strokeOpacity="0.55" strokeWidth="0.9" />
              <text x={xs[i] + widths[i] / 2} y="16" textAnchor="middle"
                fill="var(--accent)" fontFamily={mono} fontSize="9" fontWeight="700" letterSpacing="0.08em">
                {label}
              </text>
            </g>
          );
        })}
        {/* Caption next to chips */}
        <text x="196" y="10" fill="var(--text-dim)" fontFamily={mono} fontSize="7" letterSpacing="0.05em">{captionRow1}</text>
        <text x="196" y="20" fill="var(--text-faint)" fontFamily={mono} fontSize="7" letterSpacing="0.05em">{captionRow2}</text>
      </g>
    </g>
  );
}

// ── FlowStream — multi-dot animated stream between x1,y and x2,y ──
function FlowStream({ x1, y, x2, count = 5, delayOffset = 0, duration = 3.2 }) {
  return (
    <>
      {/* Static track */}
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" />
      <line x1={x1} y1={y} x2={x2} y2={y} stroke="url(#flow-gradient)" strokeWidth="2" opacity="0.4" />

      {/* Animated dots */}
      {Array.from({ length: count }).map((_, i) => (
        <circle key={i} r="3.2" fill="var(--accent)" filter="url(#dot-glow)">
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

  // LIVE content for the "live dashboard" mock-up in zone 3. `useHomeProjects`
  // is already fetched (and module-cached) for MarketPulse further down the same
  // page, so this costs no extra request. Top 2 active projects by €/m² — the
  // column the rows actually show, so the list is self-consistent, and it follows
  // the market switch (SK / CZ / All) for free.
  const { projects: homeProjects } = useHomeProjects();
  const panelRows = [...(homeProjects || [])]
    .filter(p => (p.status || "active") === "active" && p.avg_price_eur_m2 && p.district)
    .sort((a, b) => b.avg_price_eur_m2 - a.avg_price_eur_m2)
    .slice(0, 2)
    .map(p => ({
      name: p.name,
      district: p.district,
      price: `${Math.round(moneyFromEur(p.avg_price_eur_m2)).toLocaleString("en-US").replace(/,/g, " ")} ${moneySymbol()}/m²`,
    }));
  const panelAvg = marketTotals.avgPriceM2
    ? `${Math.round(moneyFromEur(marketTotals.avgPriceM2)).toLocaleString("en-US").replace(/,/g, " ")} ${moneySymbol()}/m²`
    : "…";
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

    // All three step titles are the same grammatical form — "we do X" — so the
    // scene reads as one sentence in three beats. It used to mix a verb phrase
    // ("Dáta zbierame") with two bare nouns ("Normalizácia a validácia" /
    // "Živý trhový prehľad").
    z1Line1: "Dáta zbierame",
    z1Live: `z ${fmt(devCount, "sk-SK")} developerov · ${fmt(projCount, "sk-SK")} projektov`,

    z2Line1: "Normalizujeme a validujeme",
    z2Foot: "jednotný formát pre celý trh",
    z2Chip: "PRIPRAVENÉ · DEDUPLIKOVANÉ",

    z3Line1: "Vytvárame živý trhový prehľad",
    z3Foot: "pre vaše rozhodnutia podložené dátami",
    z3Chips: ["CSV", "Excel"],
    z3ChartLabel: "PRIEMER TRHU €/m²",
    z3Cap1: "DENNÁ AKTUALIZÁCIA",
    z3Cap2: "vždy aktuálny stav trhu",

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

    z1Line1: "We collect the data",
    z1Live: `from ${fmt(devCount, "en-US")} developers · ${fmt(projCount, "en-US")} projects`,

    z2Line1: "We standardise and validate",
    z2Foot: "one comparable format",
    z2Chip: "READY · DEDUPED",

    z3Line1: "We build the live market view",
    z3Foot: "for your data-driven decisions",
    z3Chips: ["CSV", "Excel"],
    z3ChartLabel: "MARKET AVG €/m²",
    z3Cap1: "DAILY AUTO-REFRESH",
    z3Cap2: "always the current market",

    // See Slovak comment above for why this is 3 cards, not 4.
    statsLabel: ["developers", "projects tracked", "refresh cadence"],
  };

  return (
    <section style={{ padding: "clamp(2rem,6vw,3rem) 2rem clamp(2.5rem,8vw,5rem)", maxWidth: 1280, margin: "0 auto" }}>
      {/* Header — krátky a vecný */}
      <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
        <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          {T.label}
        </div>
        <h2 style={{ fontSize: "clamp(1.8rem, 3.2vw, 2.5rem)", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15, color: "var(--text)", margin: 0 }}>
          {T.title}
        </h2>
        <p style={{ color: dim, fontSize: "1rem", marginTop: "0.8rem", maxWidth: 640, margin: "0.8rem auto 0", lineHeight: 1.6 }}>
          {T.sub}
        </p>
      </div>

      {/* Scene canvas — single cohesive SVG */}
      <div style={{
        position: "relative",
        background: "linear-gradient(180deg, var(--bg) 0%, #101014 100%)",
        border: `1px solid ${border}`, borderRadius: 16, overflow: "hidden",
        marginBottom: "1.5rem",
      }}>
        <svg viewBox="0 0 1400 440" style={{ width: "100%", height: "auto", display: "block" }}>
          <defs>
            {/* Building gradient */}
            <linearGradient id="iso-wall" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2d2d36" />
              <stop offset="100%" stopColor="#15151c" />
            </linearGradient>
            {/* Lit window gradient */}
            <linearGradient id="iso-lit" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f5a623" stopOpacity="0.9" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.7" />
            </linearGradient>
            {/* Hub halo */}
            <radialGradient id="hub-halo">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
              <stop offset="60%" stopColor="var(--accent)" stopOpacity="0.08" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </radialGradient>
            {/* Hub core fill */}
            <linearGradient id="hub-core" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a2a24" />
              <stop offset="100%" stopColor="var(--bg)" />
            </linearGradient>
            {/* Flow line gradient */}
            <linearGradient id="flow-gradient" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0" />
              <stop offset="50%" stopColor="var(--accent)" stopOpacity="0.7" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
            {/* Dashboard chart area */}
            <linearGradient id="chart-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
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
              <circle cx="1" cy="1" r="0.8" fill="var(--border-soft)" />
            </pattern>
          </defs>

          {/* Subtle dot-grid backdrop */}
          <rect x="0" y="0" width="1400" height="440" fill="url(#dot-grid)" opacity="0.35" />

          {/* Radial glow centered on hub */}
          <circle cx="700" cy={AXIS_Y} r="260" fill="url(#hub-halo)" opacity="0.4" />

          {/* ═══ ZONE HEADERS ═══
              All three headers share ONE geometry: same three baselines
              (eyebrow / title / caption), same centre-anchoring, each block
              centred on its own zone's optical centre (ZONE_CX). Previously
              they sat at three different heights (y 30 / 70 / 60) with mixed
              left/centre anchoring and 4 / 2 / 3 lines, which read as crooked.
              Keep them symmetric — edit the constants, not individual <text>. */}
          {[
            { key: "z1", cx: ZONE_CX[0], eyebrow: "01 · COLLECT", title: T.z1Line1, sub: T.z1Live },
            { key: "z2", cx: ZONE_CX[1], eyebrow: "02 · PROCESS", title: T.z2Line1, sub: T.z2Foot },
            { key: "z3", cx: ZONE_CX[2], eyebrow: "03 · DELIVER", title: T.z3Line1, sub: T.z3Foot },
          ].map(z => (
            <g key={z.key} transform={`translate(${z.cx}, ${HEAD_Y})`}>
              <text x="0" y="0" textAnchor="middle" fill="var(--accent)" fontFamily={mono} fontSize="11" letterSpacing="0.14em" fontWeight="700">
                {z.eyebrow}
              </text>
              <text x="0" y="27" textAnchor="middle" fill="#fff" fontFamily="'Outfit', sans-serif" fontSize="20" fontWeight="700" letterSpacing="-0.01em">
                {z.title}
              </text>
              {/* One treatment for all three caption lines. The first one used to be
                  accent-green mono while the other two were dim sans, so three lines
                  sitting on the same baseline looked like two different kinds of thing. */}
              <text x="0" y="50" textAnchor="middle" fontFamily="'Outfit', sans-serif" fontSize="11.5" fill={dim} fontWeight="400">
                {z.sub}
              </text>
            </g>
          ))}

          {/* ═══ ZONE 1: Iso buildings cluster ═══
              Origin picked so the cluster's optical centre (local ~128, ~170)
              lands on ZONE_CX[0] / AXIS_Y. */}
          <g transform={`translate(${ZONE_CX[0] - 128}, ${AXIS_Y - 170})`}>
            <IsoBuildingsCluster />
          </g>

          {/* ═══ FLOW 1 → 2 ═══ */}
          <FlowStream x1={375} y={AXIS_Y} x2={540} count={5} delayOffset={0} duration={2.8} />

          {/* ═══ ZONE 2: Central hub (already drawn around its own origin) ═══ */}
          <g transform={`translate(${ZONE_CX[1]}, ${AXIS_Y})`}>
            <CenterHub subtitle={T.z2Chip} />
          </g>

          {/* ═══ FLOW 2 → 3 ═══ */}
          <FlowStream x1={860} y={AXIS_Y} x2={1025} count={5} delayOffset={0.6} duration={2.8} />

          {/* ═══ ZONE 3: Dashboard panel (310 × 260, drawn from its top-left) ═══ */}
          <g transform={`translate(${ZONE_CX[2] - 155}, ${AXIS_Y - 130})`}>
            <DashboardPanel
              captionRow1={T.z3Cap1}
              captionRow2={T.z3Cap2}
              chipLabels={T.z3Chips}
              chartLabel={T.z3ChartLabel}
              avgLabel={panelAvg}
              rows={panelRows}
            />
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
          { n: fmt(devCount,         localeTag(lang)), label: T.statsLabel[0] },
          // KPI label is "sledovaných projektov" / "projects tracked" — value
          // matches the label: projects with archive data (active + paused /
          // sold-out under tracking). Diverges from projectsActive whenever a
          // project moves between active and paused; today's gap is ~30%
          // (e.g. 73 active vs 116 tracked). Grows over time as more
          // historical data accumulates.
          { n: fmt(projTrackedCount, localeTag(lang)), label: T.statsLabel[1] },
          // 3. karta = cadence, slovný stat. "Mesačne" / "Monthly" hovorí
          // čo kupujúcemu zaujíma: ako často dostane fresh dáta.
          { n: lang === "sk" ? "Denne" : "Daily",                       label: T.statsLabel[2] },
        ].map((s, i) => (
          <div key={i} style={{
            textAlign: "center",
            padding: "1.25rem 0.5rem",
            background: "linear-gradient(180deg, var(--surface-2), var(--surface))",
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
  useCurrency(); // subscribe: re-render avg €/m² stat + project cards on currency toggle
  const { projects } = useHomeProjects();  // PERF Step 6: narrow column read (homepage only)
  const totals = useMarketTotals();
  const velocityMature = useVelocityMature();  // gate "sold last month" until 30d history

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
  const soldLastMonth = totals.soldLastMonth;          // velocity, not the vanity cumulative
  const avgEurM2   = totals.avgPriceM2;
  // months-of-inventory (market absorption) — fully plumbed; shows the live number once
  // velocity coverage is mature, "waiting for more data" until then (see absorption.js).
  const inv = marketInventoryDisplay(totalAvail, soldLastMonth, projects, lang);

  const label = lang === "sk" ? "Živé dáta z trhu" : "Live from the market";
  const tTotal = lang === "sk" ? "bytov sledovaných" : "units tracked";
  const tActive = lang === "sk" ? "voľných bytov" : "available now";
  const tSoldMonth = lang === "sk" ? "predaných za mesiac" : "sold last month";
  const tInventory = lang === "sk" ? "zásoba na trhu" : "market supply";
  const tEur = lang === "sk" ? `priemer ${moneySymbol()}/m²` : `avg ${moneySymbol()}/m²`;
  const openAll = lang === "sk" ? "Všetky projekty →" : "View all projects →";

  // Ranked by units SOLD in the last 30 days. Verified against the live DB
  // 2026-08-18: `sold_last_month` is a date-windowed per-unit count coming from
  // reference.unit_ledger (each unit carries its own `sold_at`), surfaced via
  // reference.project_lifecycle_state.sold_last_30d — not a snapshot-to-snapshot
  // diff. It is therefore cadence-independent and safe to label as real sales.
  //
  // (Historical note: this block used to describe a snapshot-delta metric and the
  // F-042 v1-backfill inflation that came with it. Both are gone — the ledger
  // replaced that mechanism, so the old caveat no longer applies.)
  //
  // When no project has a velocity signal yet (a brand-new market), fall back to
  // ranking by available units so the section isn't empty — and say so in the
  // heading rather than passing it off as a sales ranking.
  // Active projects only, so paused / sold-out ones don't show up with stale
  // availability. Manual projects (status='active') stay in.
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
    <section style={{ padding: "2rem 2rem clamp(2.5rem,8vw,5rem)", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "0.5rem",
          padding: "0.3rem 0.85rem", background: "color-mix(in srgb, var(--accent) 8%, transparent)",
          border: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)", borderRadius: 999,
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
        <Stat value={velocityMature ? soldLastMonth : null}
              placeholder={velocityMature ? null : (lang === "sk" ? "zbierame históriu" : "building history")}
              label={tSoldMonth} accent="#f5a623" />
        <Stat value={inv.ready ? Math.round(inv.value) : null} placeholder={inv.ready ? null : inv.text}
              suffix={inv.ready ? (lang === "sk" ? " mes." : " months") : ""} label={tInventory} />
        <Stat value={avgEurM2 ? Math.round(moneyFromEur(avgEurM2)) : null} label={tEur} prefix="" suffix={` ${moneySymbol()}`} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: "0.25rem 1rem", marginBottom: anyVelocity ? "1rem" : "0.3rem" }}>
        <div>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text)", fontFamily: mono, letterSpacing: "0.02em", margin: 0 }}>
            {anyVelocity
              ? (lang === "sk" ? "Najpredávanejšie projekty" : "Fastest-selling projects")
              : (lang === "sk" ? "Najväčšia ponuka" : "Largest offer")}
          </h3>
          <div style={{ fontSize: "0.72rem", color: dim, marginTop: "0.25rem" }}>
            {anyVelocity
              ? (lang === "sk" ? "podľa počtu bytov predaných za posledných 30 dní" : "by units sold in the last 30 days")
              : (lang === "sk" ? "podľa počtu voľných bytov" : "by units still available")}
          </div>
        </div>
        <button onClick={() => setCurrent && setCurrent("Live")} style={{ background: "none", border: "none", color: green, fontSize: "0.85rem", cursor: "pointer", fontFamily: "inherit", padding: 0, whiteSpace: "nowrap" }}>{openAll}</button>
      </div>
      {!anyVelocity && (
        <div style={{ fontSize: "0.78rem", color: "var(--text-dim)", marginBottom: "1rem", fontStyle: "italic" }}>
          {lang === "sk"
            ? "Predaje za posledný mesiac sa ešte len populujú. Zatiaľ zobrazujeme projekty s najväčšou otvorenou ponukou."
            : "Last-month sales are still populating. Showing projects with the largest open inventory meanwhile."}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: "0.85rem" }}>
        {top.map(p => <ProjectMini key={p.id} project={p} setCurrent={setCurrent} lang={lang} />)}
      </div>
    </section>
  );
}

function Stat({ value, label, prefix = "", suffix = "", accent = "var(--text)", placeholder = null }) {
  const display = useAnimatedNumber(value);
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, background: bg, padding: "1.5rem 1.5rem 1.25rem" }}>
      <div style={{
        fontSize: "2.4rem", fontWeight: 700, letterSpacing: "-0.03em",
        fontFamily: mono, color: accent, lineHeight: 1.1, minHeight: "2.6rem",
        display: "flex", alignItems: "center",
      }}>
        {value == null
          ? (placeholder
              ? <span style={{ fontSize: "0.9rem", fontWeight: 500, color: dim, fontStyle: "italic", letterSpacing: 0 }}>⏳ {placeholder}</span>
              : "—")
          : (<>{prefix}{display.toLocaleString("en-US").replace(/,/g, " ")}{suffix}</>)}
      </div>
      <div style={{ fontSize: "0.78rem", color: dim, marginTop: "0.4rem", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: mono }}>
        {label}
      </div>
    </div>
  );
}

function ProjectMini({ project, setCurrent, lang }) {
  const L = (sk, en) => (lang === "sk" ? sk : en);
  const nf = (n) => Number(n || 0).toLocaleString("en-US").replace(/,/g, " ");

  // The card shows a project's inventory as three mutually exclusive buckets that
  // add up to the whole. Pre-reserved folds into "reserved": for a buyer both mean
  // "spoken for, but not sold yet", and splitting it out bought precision nobody
  // reading a homepage card needs.
  const sold     = Number(project.sold_units || 0);
  const reserved = Number(project.reserved_units || 0) + Number(project.prereserved_units || 0);
  const free     = Number(project.available_units || 0);
  const base     = sold + reserved + free;
  const soldDataUnavailable = sold === 0 && reserved === 0;

  // `sold_percentage` from the DB is (sold + reserved + pre-reserved) / offered — so
  // it is NOT the share sold: Milrose reads 56% off 58 sold + 42 reserved out of 178.
  // It is the share of the project that is gone from the market, which the Slovak
  // trade calls "vypredanosť" — Boss's wording, and the industry's.
  const takenPct = Number(project.sold_percentage ?? (base ? (100 * (sold + reserved)) / base : 0));
  const pctOf = (n) => (base > 0 ? (100 * n) / base : 0);

  // Verified against the live ledger 2026-08-18: this is a real per-unit sale count —
  // units whose status flipped to SOLD within 30 days of the project's latest scrape
  // (reference.unit_ledger.sold_at → project_lifecycle_state.sold_last_30d). Milrose's
  // 19 are individually dated between 21 Jul and 15 Aug. The old badge said only
  // "+19 za mesiac", which never said WHAT went up.
  const soldLastMonth = project.sold_last_month || 0;
  const sellout = fmtMonthsToSellout(project.available_units, project.sold_last_month, lang);

  // `free` doubles as the bar's track colour, so the bar always spans the whole
  // project and the empty part IS the free stock. --surface-3 was too close to the
  // card background to see; --text-faint is a defined token that stays legible.
  const COLORS = { sold: green, reserved: "#f5a623", free: "var(--text-faint)" };
  // Empty buckets are dropped: "0 rezervovaných" is noise, not information.
  const legend = [
    { c: COLORS.sold,     n: sold,     t: L("predaných", "sold") },
    { c: COLORS.reserved, n: reserved, t: L("rezervovaných", "reserved") },
    { c: COLORS.free,     n: free,     t: L("voľných", "available") },
  ].filter(l => l.n > 0);
  const breakdown = legend.map(l => `${nf(l.n)} ${l.t}`).join(" · ");

  return (
    <div
      onClick={() => setCurrent && setCurrent(`Project:${project.id}`)}
      style={{
        border: `1px solid ${border}`, borderRadius: 12, background: bg,
        padding: "1.15rem 1.25rem 1.2rem",
        cursor: "pointer", transition: "transform 0.2s, border-color 0.2s",
        display: "flex", flexDirection: "column", gap: "0.85rem",
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = green; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.borderColor = border; }}
    >
      {/* Header: name + district */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
        <div style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em", lineHeight: 1.3 }}>{project.name}</div>
        <div style={{ fontSize: "0.68rem", color: dim, fontFamily: mono, whiteSpace: "nowrap", flexShrink: 0, marginTop: "0.15rem" }}>{project.district || "—"}</div>
      </div>

      {/* Price + the sales badge, which now says what it counts */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <span style={{ fontFamily: mono, fontSize: "0.95rem", fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>
          {project.avg_price_eur_m2 ? `${nf(Math.round(moneyFromEur(project.avg_price_eur_m2)))} ${moneySymbol()}/m²` : "—"}
        </span>
        {soldLastMonth > 0 && (
          <span
            title={L(`${soldLastMonth} bytov sa predalo za posledných 30 dní`, `${soldLastMonth} units sold in the last 30 days`)}
            style={{
              fontFamily: mono, fontSize: "0.68rem", fontWeight: 600, color: green,
              background: "rgba(0,229,160,0.1)", border: "1px solid rgba(0,229,160,0.28)",
              borderRadius: 6, padding: "0.15rem 0.5rem", whiteSpace: "nowrap",
            }}>
            ▲ {soldLastMonth} {L("predaných / 30 dní", "sold / 30 days")}
          </span>
        )}
      </div>

      {soldDataUnavailable ? (
        <div style={{ fontSize: "0.68rem", color: dim, fontFamily: mono, letterSpacing: "0.03em", fontStyle: "italic" }}>
          {L("developer nezverejňuje predajnosť", "developer doesn't publish sales data")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {/* One stacked bar showing the whole project: sold | reserved | free.
              The old bar drew a single sold-percentage fill whose COLOUR silently
              encoded a heat threshold (green <50, amber <80, red above) — a code
              nobody could read off the card. Segments say the same thing out loud. */}
          <div
            role="img"
            aria-label={breakdown}
            title={breakdown}
            style={{ display: "flex", height: 7, background: COLORS.free, borderRadius: 4, overflow: "hidden" }}
          >
            <div style={{ width: `${pctOf(sold)}%`,     background: COLORS.sold,     transition: "width 0.6s ease" }} />
            <div style={{ width: `${pctOf(reserved)}%`, background: COLORS.reserved, transition: "width 0.6s ease" }} />
          </div>

          {/* Legend — every number on the card is now spelled out */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem 0.8rem", fontSize: "0.72rem", color: dim }}>
            {legend.map(l => (
              <span key={l.t} style={{ display: "inline-flex", alignItems: "center", gap: "0.32rem", whiteSpace: "nowrap" }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: l.c, flexShrink: 0 }} />
                <strong style={{ color: "var(--text)", fontWeight: 600 }}>{nf(l.n)}</strong> {l.t}
              </span>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "0.75rem", fontSize: "0.7rem", color: dim, fontFamily: mono, letterSpacing: "0.03em" }}>
            {/* Slovak puts a space before the percent sign, English does not. */}
            <span>{takenPct.toFixed(0)}{L(" %", "%")} {L("vypredané", "taken")}</span>
            {sellout && <span style={{ color: green, fontWeight: 600, whiteSpace: "nowrap" }}>{sellout}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function useAnimatedNumber(target, dur = 1200, delayMs = 0) {
  const [value, setValue] = useState(target == null ? 0 : target);
  const ref = useRef({ raf: 0, from: target == null ? 0 : target, timer: 0, seeded: target != null });
  useEffect(() => {
    if (target == null) return;
    // First real value → show it IMMEDIATELY (no count-up-from-0). The old
    // count-up relied on requestAnimationFrame, which is throttled to zero frames
    // in background tabs, headless/screenshot/crawler contexts, and for
    // prefers-reduced-motion users — leaving the number stuck at "0", i.e. the
    // homepage rendering "0 units tracked / €0" on the sales page + in SEO snapshots.
    if (!ref.current.seeded) {
      ref.current.seeded = true; ref.current.from = target; setValue(target); return;
    }
    const to = target;
    const from = ref.current.from;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { ref.current.from = to; setValue(to); return; }
    clearTimeout(ref.current.timer);
    // Guarantee we land on `to` even if rAF never fires (throttled contexts).
    const settle = setTimeout(() => { ref.current.from = to; setValue(to); }, dur + 150);
    const run = () => {
      const start = performance.now();
      cancelAnimationFrame(ref.current.raf);
      const step = (t) => {
        const p = Math.min(1, (t - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
        setValue(Math.round(from + (to - from) * eased));
        if (p < 1) ref.current.raf = requestAnimationFrame(step);
        else { ref.current.from = to; clearTimeout(settle); }
      };
      ref.current.raf = requestAnimationFrame(step);
    };
    if (delayMs > 0) ref.current.timer = setTimeout(run, delayMs);
    else run();
    return () => { cancelAnimationFrame(ref.current.raf); clearTimeout(ref.current.timer); clearTimeout(settle); };
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

// One hue for every bar in the pricing map.
//
// The rows are regions — nominal identity, not an ordered scale — and the bar's
// LENGTH already encodes the price, with the exact figure printed beside it. The
// old chart also painted each bar by which of four hardcoded price brackets it
// fell into (≥7000 red / ≥5500 amber / ≥4200 green / else blue), which:
//   · spent the colour channel re-encoding what length already showed,
//   · was a rainbow ramp for a magnitude — the classic misuse,
//   · collapsed the whole bottom of the table into one flat blue, because six of
//     ten Slovak regions sit under €4 200 (Boss's complaint), and
//   · went stale by construction: the brackets are absolute prices, so ordinary
//     market drift silently repaints the chart.
// A single brand hue removes all four problems at once.
// ── Pricing-map colour: a DIVERGING scale, rebuilt from the rows on screen ──
//
// Colour answers "expensive or cheap for this market?", which the bar length alone
// can't say: warm = above the typical price here, cool = below it, neutral grey at
// the typical price itself. Blue↔red is the CVD-safe diverging pair (validated
// against this surface: worst-pair ΔE 23.6 protan / 31.9 normal, both poles ≥3:1
// contrast), and grey — not a third hue — sits at the midpoint so "typical" reads
// as "nothing to report".
//
// TWO details make it survive changing data, and both were what broke the old
// version (four hardcoded price brackets: ≥7000 red / ≥5500 amber / ≥4200 green /
// else blue):
//
//   1. The scale is derived from the rows being displayed, never from absolute
//      prices. So it re-fits itself every night as the market moves, and it works
//      unchanged at every drill level — kraj, mesto, mestská časť — and in CZK as
//      well as EUR. The old brackets were tuned for Slovak regions, which is why
//      six of them fell into one identical blue.
//   2. Each ARM is normalised by its own spread. A single shared spread (or a
//      units-weighted mean, which Praha and Bratislava drag upward) squashes the
//      whole cheap end into one indistinguishable colour — the exact failure the
//      brackets had. Per-arm normalisation spends the full range on each side, so
//      neighbouring rows stay apart whatever the distribution looks like.
const PRICE_COOL = '#3987e5';  // below the typical price
const PRICE_WARM = '#e34948';  // above it
const PRICE_MID  = '#6b6b78';  // neutral midpoint

/** Fit the diverging scale to the values currently on screen. */
function priceScale(values) {
  if (!values.length) return { mid: 0, up: 1, down: 1 };
  const sorted = [...values].sort((a, b) => a - b);
  const h = Math.floor(sorted.length / 2);
  // Median, not mean: the mean is pulled toward whichever end holds the big
  // markets, which tilts the whole chart to one colour.
  const mid = sorted.length % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
  let up = 0, down = 0;
  for (const v of values) {
    if (v > mid) up = Math.max(up, v - mid);
    else down = Math.max(down, mid - v);
  }
  return { mid, up: up || 1, down: down || 1 };
}

//: Pulls mid-range rows toward their pole instead of leaving them muddy grey.
//: Linear mixing left most of the table hovering near the neutral midpoint, which
//: looked washed out; the curve keeps grey for rows that really are near-typical
//: while letting everything else show its colour. Purely cosmetic — it changes how
//: strongly a deviation is drawn, never its sign or its order.
const PRICE_CURVE = 0.6;

function barHue(avg, scale) {
  const t = avg >= scale.mid ? (avg - scale.mid) / scale.up : -(scale.mid - avg) / scale.down;
  const pole = t >= 0 ? PRICE_WARM : PRICE_COOL;
  const pct = Math.min(100, Math.pow(Math.abs(t), PRICE_CURVE) * 100);
  // color-mix keeps this valid for every input — the old code built the fill by
  // string concat as `${color}33`, which produced the invalid `var(--accent)33`
  // and made the browser drop the gradient, rendering those rows as black bars.
  return `color-mix(in srgb, ${pole} ${pct.toFixed(1)}%, ${PRICE_MID})`;
}

// Empty drill state helper (top level = whole country, by kraj).
const _emptyDrill = { level: "region", regionId: null, regionName: null, cityId: null, cityName: null };

export function DistrictPulse({ lang = "en", setCurrent }) {  // eslint-disable-line no-unused-vars
  useCurrency(); // subscribe: re-render the per-district €/m² bars on currency toggle
  const { country } = useCountry();
  const [sectionRef, inView] = useInView();

  // Drill state: Country → kraj (region) → mesto (city) → mestská časť (district).
  // Reads the live geo-hierarchy aggregate views (totals_by_region / _by_city /
  // _by_district — all SECURITY DEFINER aggregates, anon-safe). When the rest of
  // Slovakia is live this becomes the national pricing map; today it shows the
  // single populated kraj and drills into Bratislava's districts.
  const [drill, setDrill] = useState(_emptyDrill);

  // Country switch (e.g. CZ) → reset to the top of the hierarchy.
  useEffect(() => { setDrill(_emptyDrill); }, [country]);

  const regionQ   = useTotalsList("region",   { country });
  const cityQ     = useTotalsList("city",     { country, filterCol: "region_id", filterId: drill.regionId });
  const districtQ = useTotalsList("district", { country, filterCol: "city_id",   filterId: drill.cityId });

  // Normalise the active level to a common row shape {key,name,avg,count,units}.
  let activeRows, loading, drillable;
  if (drill.level === "region") {
    loading = regionQ.loading; drillable = true;
    activeRows = regionQ.rows.map(d => ({ key: d.region_id, name: d.region_name, avg: d.avg_eur_m2, count: d.total_projects_active, units: d.total_units_tracked }));
  } else if (drill.level === "city") {
    loading = cityQ.loading; drillable = true;
    activeRows = cityQ.rows.map(d => ({ key: d.city_id, name: d.city_name, avg: d.avg_eur_m2, count: d.total_projects_active, units: d.total_units_tracked }));
  } else {
    loading = districtQ.loading; drillable = false;
    activeRows = districtQ.rows.map(d => ({ key: d.district, name: d.district, avg: d.avg_eur_m2, count: d.project_count, units: d.total_units }));
  }

  // Drop entries without a price signal so the bar max-scale stays meaningful.
  const rows = activeRows
    .filter(d => d.avg != null)
    .map(d => ({ ...d, avg: Number(d.avg), units: Number(d.units) || 0, count: Number(d.count) || 0 }))
    .sort((a, b) => b.avg - a.avg);
  const max = rows.length > 0 ? Math.max(...rows.map(r => r.avg)) : 1;
  const scale = priceScale(rows.map(r => r.avg));

  const cName = countryName(country, lang);
  const label = lang === "sk" ? `Cenová mapa — ${cName}` : `${cName} pricing map`;
  const levelWord = drill.level === "region"
    ? (lang === "sk" ? "podľa kraja" : "by region")
    : drill.level === "city"
      ? (lang === "sk" ? "podľa mesta" : "by city")
      : (lang === "sk" ? "podľa mestskej časti" : "by district");
  const title = lang === "sk" ? `Priemerná cena ${moneySymbol()}/m² ${levelWord}` : `Average ${moneySymbol()}/m² ${levelWord}`;
  const desc = lang === "sk"
    ? "Skutočné dáta z aktívnych projektov. Klikni na riadok pre rozpad nižšie. Updatuje sa každý deň."
    : "Real data from active projects. Click a row to drill down. Refreshes daily.";

  // Breadcrumb trail (clickable parents).
  const crumbs = [{ label: cName, go: () => setDrill(_emptyDrill) }];
  if (drill.regionId) {
    crumbs.push({
      label: drill.regionName,
      go: drill.level === "district"
        ? () => setDrill({ ..._emptyDrill, level: "city", regionId: drill.regionId, regionName: drill.regionName })
        : null,
    });
  }
  if (drill.cityId) crumbs.push({ label: drill.cityName, go: null });

  const handleRowClick = (r) => {
    if (drill.level === "region") {
      setDrill({ ..._emptyDrill, level: "city", regionId: r.key, regionName: r.name });
    } else if (drill.level === "city") {
      setDrill({ level: "district", regionId: drill.regionId, regionName: drill.regionName, cityId: r.key, cityName: r.name });
    }
  };

  return (
    <section ref={sectionRef} style={{ padding: "clamp(2.75rem,8vw,5rem) 2rem", maxWidth: 1100, margin: "0 auto", borderTop: `1px solid ${border}` }}>
      <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
        {label}
      </div>
      <h2 className="sec-title" style={{ marginBottom: "0.5rem" }}>{title}</h2>
      <p className="sec-desc" style={{ marginBottom: "0.9rem" }}>{desc}</p>

      {/* Colour carries a second reading, so it gets a one-line key — otherwise the
          hues are just decoration the reader has to guess at. */}
      {rows.length > 1 && (
        <div style={{
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.45rem",
          fontFamily: mono, fontSize: "0.68rem", color: dim, marginBottom: "1.6rem",
          letterSpacing: "0.03em",
        }}>
          <span style={{ width: 22, height: 7, borderRadius: 2, background: PRICE_COOL, flexShrink: 0 }} />
          <span>{lang === "sk" ? "pod typickou cenou" : "below typical"}</span>
          <span style={{ width: 22, height: 7, borderRadius: 2, background: PRICE_MID, margin: "0 0 0 0.5rem", flexShrink: 0 }} />
          <span>
            {lang === "sk" ? "typická" : "typical"}
            {" "}
            <span style={{ color: "var(--text)" }}>
              {Math.round(moneyFromEur(scale.mid) || 0).toLocaleString("en-US").replace(/,/g, " ")} {moneySymbol()}/m²
            </span>
          </span>
          <span style={{ width: 22, height: 7, borderRadius: 2, background: PRICE_WARM, margin: "0 0 0 0.5rem", flexShrink: 0 }} />
          <span>{lang === "sk" ? "nad ňou" : "above typical"}</span>
        </div>
      )}

      {/* Breadcrumb — only once drilled below the top level. */}
      {crumbs.length > 1 && (
        <div style={{ fontFamily: mono, fontSize: "0.8rem", marginBottom: "1.75rem", display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
              {i > 0 && <span style={{ color: dim }}>›</span>}
              {c.go ? (
                <button
                  onClick={c.go}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: green, fontFamily: mono, fontSize: "0.8rem" }}
                >{c.label}</button>
              ) : (
                <span style={{ color: "var(--text)" }}>{c.label}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div style={{ color: dim, fontFamily: mono, fontSize: "0.85rem", padding: "2rem 0" }}>
          {lang === "sk" ? "Načítavam…" : "Loading…"}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ color: dim, fontSize: "0.9rem" }}>
          {lang === "sk" ? "Žiadne cenové dáta na tejto úrovni." : "No pricing data at this level."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {rows.map((r, i) => (
            <GeoBarRow
              key={r.key}
              row={r}
              index={i}
              max={max}
              scale={scale}
              animate={inView}
              lang={lang}
              onClick={drillable ? handleRowClick : null}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GeoBarRow({ row, index, max, scale, animate, lang, onClick }) {
  const pct = (row.avg / max) * 100;
  const hue = barHue(row.avg, scale);
  const delay = 0.08 * index;
  // Show the REAL €/m² immediately (no count-up-from-0). The count-up looked
  // "live" for a scrolling user but rendered a literal "0 €" in every non-scroll
  // snapshot — screenshots, crawlers, and the split-second before the section
  // animates in — which read as "the market is €0". The bar fill + row fade +
  // shimmer below still animate on scroll, so the section stays lively.
  const avgDisplay = Math.round(moneyFromEur(row.avg) || 0);
  const clickable = typeof onClick === "function";
  const barTitle = `${row.name}: ${avgDisplay.toLocaleString("en-US").replace(/,/g, " ")} ${moneySymbol()}/m² · `
    + `${row.count} ${lang === "sk" ? "projektov" : "projects"} · `
    + `${row.units.toLocaleString("en-US").replace(/,/g, " ")} ${lang === "sk" ? "bytov" : "units"}`;

  return (
    <div
      onClick={clickable ? () => onClick(row) : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(row); } } : undefined}
      style={{
        display: "grid", gridTemplateColumns: "180px 1fr 160px", gap: "1rem", alignItems: "center",
        opacity: animate ? 1 : 0,
        transform: animate ? "translateY(0)" : "translateY(8px)",
        transition: `opacity 0.5s ease ${delay}s, transform 0.5s ease ${delay}s`,
        cursor: clickable ? "pointer" : "default",
      }}
      className="district-row"
    >
      {/* Left: name + count subtitle. A › chevron marks a drillable row
          (kraj → mesto → mestská časť). Name kept out of the bar for
          contrast + paint perf (see git history). */}
      <div>
        <div style={{ fontSize: "0.92rem", color: "var(--text)", fontWeight: 500, lineHeight: 1.25 }}>
          {row.name}
          {clickable && <span style={{ color: green, marginLeft: 6, fontFamily: mono }}>›</span>}
        </div>
        <div style={{ fontSize: "0.68rem", color: "var(--text-dim)", fontFamily: mono, marginTop: 2, letterSpacing: "0.02em" }}>
          {row.count} {lang === "sk" ? "proj" : "proj"} · {row.units.toLocaleString("en-US").replace(/,/g, " ")} {lang === "sk" ? "bytov" : "units"}
        </div>
      </div>

      {/* Bar — cleaner, no overlay text so the fill color stays readable
          and no mix-blend-mode paint cost. */}
      <div
        title={barTitle}
        style={{
          height: 20, background: "var(--surface-2)", borderRadius: 4,
          overflow: "hidden", position: "relative",
        }}
      >
        <div style={{
          width: animate ? `${pct}%` : "0%",
          height: "100%",
          // Wash → solid along the bar. color-mix keeps this a VALID declaration:
          // the old code built `${color}33` by string concat, and when colorForPrice
          // returned the CSS variable "var(--accent)" that produced the nonsense
          // `var(--accent)33`. The browser dropped the whole gradient, so every row
          // in that price band rendered as an empty black bar on the live site.
          background: `linear-gradient(90deg, color-mix(in srgb, ${hue} 55%, transparent), ${hue})`,
          // 4px rounded data-end, square at the baseline.
          borderRadius: "0 4px 4px 0",
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

      {/* Right: the €/m² figure. Text wears an INK token, never the mark's colour —
          the old row printed the number in its price-band colour, which is what made
          the lower half of the table a wall of identical blue numerals. */}
      <div style={{
        fontFamily: mono, fontSize: "1.05rem", fontWeight: 700, color: "var(--text)",
        textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
      }}>
        {avgDisplay.toLocaleString("en-US").replace(/,/g, " ")} {moneySymbol()}
      </div>
    </div>
  );
}

/* HowItWorksFlow + its 4 icon helpers used to live here. Replaced on
   the homepage by PipelineFlow above, which uses live counts from
   useMarketTotals (not the hardcoded "60+ developer webov" string).
   The dead export was a stale-numbers landmine during reviews — and
   App.jsx never imported it — so it's removed entirely. */
