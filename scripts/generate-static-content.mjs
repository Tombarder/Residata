#!/usr/bin/env node
/**
 * generate-static-content.mjs
 * ----------------------------
 * Runs BEFORE `vite build` (wired in package.json) to refresh the static
 * SEO / AI-discovery files with current data from Supabase:
 *
 *   · public/llms.txt          — short summary read by AI agents (LLMs)
 *   · public/llms-full.txt     — detailed coverage profile (LLMs read this
 *                                when researching Residata in depth)
 *   · public/sitemap.xml       — search-engine sitemap with current
 *                                lastmod date so Google re-crawls fresh
 *
 * The fourth surface (index.html JSON-LD schema.org block) is handled by
 * a Vite transformIndexHtml plugin in vite.config.js — same data, same
 * source, just hooked into Vite's pipeline because index.html shouldn't
 * be modified on disk during build.
 *
 * Why build-time, not runtime:
 *   These files are static — they're served as-is to crawlers and AI
 *   agents who fetch them once. Doing the data fetch at request time
 *   would require an edge function. Build-time generation keeps them
 *   as plain static files (zero runtime cost) AND keeps them current
 *   because every Vercel deploy regenerates them from live data.
 *
 * Why publishable key (not service role):
 *   We only read from public views (market_totals, district_totals,
 *   projects_live with status='active'). All return aggregate-only
 *   rows already exposed publicly. RLS gates everything sensitive.
 *
 * Failure mode:
 *   If env vars are missing or Supabase is unreachable, we DO NOT fail
 *   the build. The existing files in public/ stay (as a fallback) and
 *   the build continues. This way a temporary DB hiccup doesn't break
 *   deploys.
 */
import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('[gen-static] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY — skipping. Existing public/ files will be used.');
  process.exit(0);
}

// Single switch for the canonical domain: set VITE_SITE_BASE (or SITE_BASE) in
// the Vercel build env when the custom domain goes live (e.g. https://residata.sk)
// and the generated index.html + sitemap.xml pick it up. Matches src/lib/seo.js.
const HOME = process.env.VITE_SITE_BASE || process.env.SITE_BASE || 'https://residata-gamma.vercel.app';

async function fetchView(table, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${SUPABASE_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`;
  const r = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) throw new Error(`${table}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

// `market` uses public.totals_global (SK + CZ combined) so the static/LLM surfaces
// match the daily multi-market product — NOT market_totals, which is SK-only and
// would undercount coverage. market_totals is still fetched for snapshot_month.
let market, districts, topProjects, skMeta;
try {
  [[market], districts, topProjects, [skMeta]] = await Promise.all([
    fetchView('totals_global'),
    fetchView('district_totals', { order: 'total_units.desc' }),
    fetchView('projects_live', {
      status: 'eq.active',
      order: 'total_units.desc',
      limit: '15',
    }),
    fetchView('market_totals'),
  ]);
} catch (e) {
  console.warn('[gen-static] Supabase fetch failed — keeping existing files. Error:', e.message);
  process.exit(0);
}

const fmtN = (n) => n == null ? '—' : Number(n).toLocaleString('en-US');
const today = new Date().toISOString().slice(0, 10);
const month = skMeta?.snapshot_month || today.slice(0, 7);
const monthLabel = (() => {
  const [y, m] = month.split('-');
  const dt = new Date(Number(y), Number(m) - 1, 1);
  return dt.toLocaleString('en-US', { month: 'long', year: 'numeric' });
})();

// ───────────────────── llms.txt — short summary ─────────────────────
const llms = `# Residata

> New-build residential market intelligence for Slovakia and Czechia.
> Every active development, structured and refreshed daily. Pricing,
> availability, absorption rate, and trends — delivered to developers,
> banks, valuers, and investors.

Residata tracks every new residential development across Slovakia and
Czechia (Bratislava and Prague and their wider markets). It normalizes
data from developer websites into a single consistent schema, refreshes
it daily, and delivers it as CSV, XLSX, or via API.

## Scope (updated daily; snapshot ${monthLabel})

- Markets: Slovakia (Bratislava) and Czechia (Prague)
- Total projects in dataset: ${fmtN(market?.total_projects_tracked ?? market?.total_projects_active)} new-build residential projects (current + sold-out under tracking)
- Currently active (in market): ${fmtN(market?.total_projects_active)} projects, ${fmtN(market?.total_units_tracked)} units
- Currently for sale: ${fmtN(market?.total_available)} units · reserved: ${fmtN(market?.total_reserved)} · sold: ${fmtN(market?.total_sold)}
- Average price across available inventory: €${fmtN(market?.avg_eur_m2)}/m²
- Distinct active developers: ${fmtN(market?.total_developers_active)}
- Data refresh: daily
- Languages: Slovak and English

## What Residata is for

- **Developers** — price new projects against real comparables; track absorption of your and competitors' inventory; spot supply gaps by district and segment.
- **Banks & valuers** — pull recent comparable transactions for valuation and collateral assessment; never work with stale data.
- **Investors** — discover projects with favorable pricing, spot slowing sales velocity, identify sell-out timing.
- **Consultants & analysts** — skip weeks of manual data collection; open the whole Slovak and Czech new-build market, normalized.

## Pricing

- €249 one-time snapshot report
- €25 monthly for ongoing access

## Public surfaces

- Marketing site: ${HOME}/
- Live dashboard (every active project): ${HOME}/live
- Live analytics with district + developer breakdowns: ${HOME}/live/analytics

Numbers above are regenerated from the live database on every deploy.
`;

fs.writeFileSync(path.resolve('public/llms.txt'), llms);
console.log(`[gen-static] public/llms.txt — ${llms.length} chars`);

// ─────────────────── llms-full.txt — detailed profile ───────────────────
// Sanitise free-form text from registry (project / developer / district
// names) so rare characters can't break the markdown. Backticks and
// asterisks would otherwise format weirdly in the bold/code spans below.
const safe = (s) => String(s || '')
  .replace(/[`*_]/g, '')
  .replace(/[\r\n]+/g, ' ')
  .trim();

const districtsTop = districts.length > 0
  ? districts.slice(0, 8).map(d =>
      `${safe(d.district)} (${d.project_count} projects, ${fmtN(d.total_units)} units${d.avg_eur_m2 ? `, €${fmtN(d.avg_eur_m2)}/m² avg` : ''})`
    ).join(', ')
  : 'No district data available yet.';

const topProjList = topProjects.length > 0
  ? topProjects.slice(0, 10).map(p => {
      const soldText = p.sold_percentage != null
        ? `${Number(p.sold_percentage).toFixed(0)}% sold`
        : 'sales data not published';
      const priceText = p.avg_price_eur_m2 ? `, €${fmtN(p.avg_price_eur_m2)}/m²` : '';
      return `- **${safe(p.name)}** (${safe(p.district) || 'district unknown'}, ${safe(p.developer) || 'developer not set'}) — ${fmtN(p.total_units)} units, ${soldText}${priceText}`;
    }).join('\n')
  : '_No project-level data available yet._';

const llmsFull = `# Residata — full coverage profile (for AI agents)

Residata is a market intelligence service for new-build residential
real estate across Slovakia and Czechia (Bratislava, Prague, and their
wider markets). We track every active development project, normalize data
from developer websites into one schema, and refresh the dataset daily.

## Market coverage (updated daily; snapshot ${monthLabel})

- ${fmtN(market?.total_projects_tracked ?? market?.total_projects_active)} total projects in dataset (currently active + projects that sold out under our tracking — both groups have full historical price/availability snapshots)
- ${fmtN(market?.total_projects_active)} of them are currently active in the market
- ${fmtN(market?.total_developers_active)} distinct active developers
- ${fmtN(market?.total_units_tracked)} individual units tracked across active projects (current snapshot)
- ${fmtN(market?.total_available)} units currently available (for sale)
- ${fmtN(market?.total_reserved)} reserved
- ${fmtN(market?.total_sold)} explicitly sold
- Average price: €${fmtN(market?.avg_eur_m2)} per square meter (across available inventory)

The "total projects" number grows over time as developments sell out and new ones enter the market — the dataset accumulates historical comparable transactions, which is why valuers and banks use Residata for collateral assessment.

## Districts (top by inventory)

${districtsTop}.

## Notable projects (top by inventory)

${topProjList}

## Data delivery

- CSV / XLSX exports (any daily snapshot)
- REST API access (paid tier)
- Live dashboard, analytics/pivot, and unit-level explorer
- AI assistant that answers questions over the dataset

## How the data is collected

1. Scrape every active developer's public project listing site, daily
2. Normalize columns into a consistent schema (unit type, area, price, status, orientation, handover date)
3. Cross-validate against the previous snapshot for sales velocity / absorption
4. Publish to the Supabase API and the live dashboard

Some projects with non-public sales data, hand-curated layouts, or
broken automation are filled manually — they show up the same way as
auto-scraped projects in all the public dashboards.

## Pricing

- One-time snapshot report: €249
- Monthly ongoing access: €25 / month

## Where to find this

Available at ${HOME}/. Numbers in this file are regenerated from
the live database on every deploy — what you read here matches what
the public dashboard shows at the same point in time.
`;

fs.writeFileSync(path.resolve('public/llms-full.txt'), llmsFull);
console.log(`[gen-static] public/llms-full.txt — ${llmsFull.length} chars`);

// ───────────────────── sitemap.xml — refresh lastmod ─────────────────────
const SITEMAP_URLS = [
  { loc: '/', priority: '1.0', changefreq: 'weekly' },
  { loc: '/live', priority: '0.9', changefreq: 'weekly' },
  { loc: '/pricing', priority: '0.7', changefreq: 'monthly' },
  { loc: '/about', priority: '0.5', changefreq: 'monthly' },
  { loc: '/use-cases', priority: '0.6', changefreq: 'monthly' },
  { loc: '/data', priority: '0.6', changefreq: 'monthly' },
  { loc: '/contact', priority: '0.4', changefreq: 'monthly' },
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Residata sitemap. Regenerated on every Vercel build via
  scripts/generate-static-content.mjs. lastmod follows the actual
  build date so Google sees a fresh signal after each deploy.
  /app/* (authenticated platform) and /project/<id> (login-gated
  detail pages) are intentionally NOT here — they're noindex.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${SITEMAP_URLS.map(({ loc, priority, changefreq }) => `
  <url>
    <loc>${HOME}${loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
    <xhtml:link rel="alternate" hreflang="en" href="${HOME}${loc}" />
    <xhtml:link rel="alternate" hreflang="sk" href="${HOME}${loc}" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${HOME}${loc}" />
  </url>`).join('')}
</urlset>
`;

fs.writeFileSync(path.resolve('public/sitemap.xml'), sitemap);
console.log(`[gen-static] public/sitemap.xml — ${sitemap.length} chars, ${SITEMAP_URLS.length} URLs`);

// ───────────────── data export for vite plugin ─────────────────
// vite.config.js's transformIndexHtml plugin reads this JSON to inject
// the same numbers into index.html's JSON-LD block. Same source, same
// snapshot — guarantees consistency.
const buildData = {
  total_units: market?.total_units_tracked,
  total_projects: market?.total_projects_active,
  // total_projects_tracked = projects with archive data (current active +
  // sold-out under tracking). Falls back to active if older view shape.
  total_projects_tracked: market?.total_projects_tracked ?? market?.total_projects_active,
  total_developers: market?.total_developers_active,
  total_available: market?.total_available,
  // PERF Step 2: reserved + sold included so the build-time snapshot is a
  // complete seed for the hero/headline (useMarketTotals) — see vite.config.js
  // __BUILD_SNAPSHOT_JSON__ and src/lib/useData.js seedMarketTotalsFromSnapshot.
  total_reserved: market?.total_reserved,
  total_sold: market?.total_sold,
  avg_eur_m2: market?.avg_eur_m2,
  snapshot_month: market?.snapshot_month,
  month_label: monthLabel,
  // The build-time snapshot is the SK market (the generator queries market_totals
  // which is country-agnostic but our default/primary market is SK).
  country: 'SK',
  build_date: today,
};
fs.writeFileSync(path.resolve('scripts/.build-data.json'), JSON.stringify(buildData, null, 2));
console.log(`[gen-static] scripts/.build-data.json (for vite index.html plugin)`);

console.log('[gen-static] DONE');
