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
 *   If env vars are missing or Supabase is unreachable, THIS script does not
 *   fail the build: the existing files in public/ stay (as a fallback) and
 *   the build continues. The one exception is downstream — the published
 *   articles (scripts/.articles.json) are this build's read or nothing, and
 *   prerender.mjs refuses a Vercel build without them, which keeps the
 *   previous deployment and its correct article pages live.
 */
import fs from 'node:fs';
import path from 'node:path';
import { COMPANY, addressOneLine, registrationLine } from '../src/lib/company.js';
import { PUBLIC_LANGS } from '../src/lib/locale.js';
import { SK_PATHS, pathToPage } from '../src/lib/routing.js';
import { FALLBACK_MONTHLY_CENTS, FALLBACK_MONTHLY_DISPLAY, FALLBACK_ANCHOR_DISPLAY } from '../src/lib/pricingDefaults.js';
import { everyPhrase } from '../src/lib/refreshCadence.js';
import { sectionIsLive } from '../src/lib/analysesSection.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Deleted before anything can fail: a list left behind by an earlier build must
// never stand in for the one this build could not read.
const ARTICLES_FILE = path.resolve('scripts/.articles.json');
fs.rmSync(ARTICLES_FILE, { force: true });

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn('[gen-static] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY — skipping. Existing public/ files will be used.');
  process.exit(0);
}

// Single switch for the canonical domain: VITE_SITE_BASE (or SITE_BASE) in the
// Vercel build env; the generated index.html, sitemap.xml, llms.txt, robots.txt
// and security.txt all pick it up. Matches src/lib/seo.js.
//
// The default is the LIVE domain, not a vercel.app preview URL as it was until
// 2026-09-03. Unlike seo.js this file has no window.location to fall back on, so
// a build that lost the env var would have written a preview hostname into the
// sitemap, the canonical tags and every public file — silently, since the build
// still succeeds. The default now cannot be wrong.
const HOME = process.env.VITE_SITE_BASE || process.env.SITE_BASE || 'https://residata.eu';

async function fetchView(table, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${SUPABASE_URL}/rest/v1/${table}${qs ? '?' + qs : ''}`;
  // Three tries: a deploy that fails on one dropped connection is a deploy
  // somebody has to notice and re-run, and prerender.mjs now REFUSES to build
  // without the articles this reads (see below).
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
      if (r.ok) return r.json();
      last = new Error(`${table}: HTTP ${r.status} ${await r.text()}`);
      if (r.status < 500) break;
    } catch (e) {
      last = e;
    }
    await new Promise((res) => setTimeout(res, 1500 * attempt));
  }
  throw last;
}

// ── The published analyses, read FIRST and written for prerender.mjs ──────
// One read, one snapshot: the sitemap, the feed, llms.txt and the static page
// of every article are built from this same list, so they cannot disagree about
// what is published. Read before anything else, so a failure in the market
// views below cannot leave the build without it.
const ARTICLE_COLS =
  'id,slug,article_date,published,title,perex,blocks,method,og_image,seo_title,seo_keywords,updated_at,figures_measured_through';
let articles = null;
try {
  articles = await fetchView('articles', {
    // slug breaks the tie: most issues share a date, and without it every build
    // listed them in whatever order the database returned them that time.
    select: ARTICLE_COLS, published: 'eq.true', order: 'article_date.desc,slug.asc',
  });
  fs.writeFileSync(ARTICLES_FILE, JSON.stringify(articles));
  console.log(`[gen-static] scripts/.articles.json — ${articles.length} published articles`);
} catch (e) {
  // prerender.mjs fails the build on Vercel when this file is missing, which
  // keeps the previous deployment — with its correct article pages — live.
  console.warn('[gen-static] could not read the published articles:', e.message);
}

// `market` uses public.totals_global (SK + CZ combined) so the static/LLM surfaces
// match the daily multi-market product — NOT market_totals, which is SK-only and
// would undercount coverage. market_totals is still fetched for snapshot_month.
let market, districts, topProjects, skMeta, cities, maturity;
try {
  [[market], districts, topProjects, [skMeta], cities, maturity] = await Promise.all([
    fetchView('totals_global'),
    fetchView('district_totals', { order: 'total_units.desc' }),
    fetchView('projects_live', {
      status: 'eq.active',
      order: 'total_units.desc',
      limit: '15',
    }),
    fetchView('market_totals'),
    // Coverage is no longer "Bratislava and Prague" — it has been every town
    // with an actively-sold new-build since the 2026-06-08 market unification.
    // Counted, not asserted, so the claim cannot go stale again.
    fetchView('totals_by_city', { select: 'city_id' }).catch(() => []),
    // How far back the series actually goes. public.velocity_maturity carries
    // `oldest_real` per country — the first observation we can stand behind.
    // Read, never typed: /use-cases sold "6–12 months of price history" on
    // 2026-09-11 while the real figures were 3.9 (SK) and 3.1 (CZ) months.
    fetchView('velocity_maturity', { select: 'country_code,oldest_real' }).catch(() => []),
  ]);
} catch (e) {
  console.warn('[gen-static] Supabase fetch failed — keeping existing files. Error:', e.message);
  process.exit(0);
}

// How often the market is read — public.data_collection, the interval an admin
// sets in Kontrola dát → Zber dát. Every public sentence about freshness is
// written from it (src/lib/refreshCadence.js); unreadable → null, and the copy
// says "regularly" rather than an interval this build could not see.
let scrapeEveryDays = null;
try {
  const [row] = await fetchView('data_collection', { select: 'every_days' });
  scrapeEveryDays = Number.isInteger(row?.every_days) ? row.every_days : null;
} catch (e) {
  console.warn('[gen-static] could not read the collection interval:', e.message);
}
const EVERY_EN = everyPhrase('en', { scrape_every_days: scrapeEveryDays });

// Live subscription price — single source of truth is public.pricing_config
// (id=1), edited from the in-app admin Pricing editor. Read here at build time
// so the static/SEO surfaces (llms.txt, index.html JSON-LD) follow the editor on
// each deploy; the live app surfaces read the same row at runtime via usePricing.
let pricing = null;
try {
  [pricing] = await fetchView('pricing_config', { id: 'eq.1', select: 'monthly_price_cents,anchor_price_cents' });
} catch { /* keep null → fall back to current launch price below */ }
const fmtEur = (cents) => {
  if (cents == null) return null;
  const eur = Number(cents) / 100;
  return '€' + (Number.isInteger(eur) ? String(eur) : eur.toFixed(2));
};
const priceStr = fmtEur(pricing?.monthly_price_cents) || FALLBACK_MONTHLY_DISPLAY;
const anchorStr = fmtEur(pricing?.anchor_price_cents) || FALLBACK_ANCHOR_DISPLAY;
const priceNum = ((pricing?.monthly_price_cents ?? FALLBACK_MONTHLY_CENTS) / 100).toFixed(2);

const fmtN = (n) => n == null ? '—' : Number(n).toLocaleString('en-US');
// How coverage is described wherever a static surface states it. Counted from
// the live data — never a hand-written city list.
const cityCount = Array.isArray(cities) ? cities.length : 0;
const coverageLine = cityCount
  ? `Slovakia and Czechia — ${cityCount} towns and cities with actively sold new-build projects`
  : 'Slovakia and Czechia — every town with actively sold new-build projects';
const today = new Date().toISOString().slice(0, 10);
const month = skMeta?.snapshot_month || today.slice(0, 7);
const monthLabel = (() => {
  const [y, m] = month.split('-');
  const dt = new Date(Number(y), Number(m) - 1, 1);
  return dt.toLocaleString('en-US', { month: 'long', year: 'numeric' });
})();

// The /analyzy section is on the site only while something is published
// (lib/analysesSection). A list that could not be read keeps the line, as the
// rest of this file keeps what it could not see.
const analysesOffSite = Array.isArray(articles) && !sectionIsLive(articles.length);
function analysesSurfaceLine() {
  return analysesOffSite ? '' : `- Published market analyses (Slovak, quarterly): ${HOME}/analyzy\n`;
}

// Every published analysis, one line each, for the AI readers robots.txt invites
// (they fetch llms.txt and rarely run JavaScript). Empty when the list could
// not be read — this file never states something it could not see.
function articlesSection() {
  if (!articles || !articles.length) return '';
  const lines = articles.map((a) => {
    const title = (a.title && (a.title.sk || a.title.en)) || a.slug;
    const perex = (a.perex && (a.perex.sk || a.perex.en)) || '';
    return `- [${title}](${HOME}/analyzy/${a.slug}): ${perex.replace(/\s+/g, ' ').trim()}`;
  });
  // The licence the pages themselves state (lib/articleSeo DATA_LICENSE, Terms §7),
  // so an assistant knows the figures may be quoted — and how to credit them.
  const licence = 'Their figures, tables and charts are published under CC BY 4.0 '
    + '(https://creativecommons.org/licenses/by/4.0/): quote and reuse them freely, commercially too, '
    + 'crediting "Residata" with a link to the analysis. Suggested citation: '
    + '"Residata. <title>. <date>. <url>".';
  return `\n## Published analyses (${articles.length}, newest first; Slovak)\n\n${licence}\n\n${lines.join('\n')}\n`;
}

// ───────────────────── llms.txt — short summary ─────────────────────
const llms = `# Residata

> New-build residential market intelligence for Slovakia and Czechia.
> Every active development, structured and refreshed ${EVERY_EN}. Pricing,
> availability, absorption rate, and trends — delivered to developers,
> banks, valuers, and investors.

Residata tracks every new residential development across Slovakia and
Czechia — every town where new-builds are actively sold, not just the two
capitals. It normalizes
data from developer websites into a single consistent schema, refreshes
it daily, and delivers it as CSV and XLSX.

## Scope (updated ${EVERY_EN}; snapshot ${monthLabel})

- Markets: ${coverageLine}
- Total projects in dataset: ${fmtN(market?.total_projects_tracked ?? market?.total_projects_active)} new-build residential projects (current + sold-out under tracking)
- Currently active (in market): ${fmtN(market?.total_projects_active)} projects, ${fmtN(market?.total_units_tracked)} units
- Currently for sale: ${fmtN(market?.total_available)} units · reserved: ${fmtN(market?.total_reserved)} · sold: ${fmtN(market?.total_sold)}
- Average price across available inventory: €${fmtN(market?.avg_eur_m2)}/m² (priced units only — roughly one available home in nine carries no published price, so it is an average over what developers actually publish)
- Distinct active developers: ${fmtN(market?.total_developers_active)}
- Data refresh: daily
- Languages: Slovak and English

## Who operates Residata

Residata is operated by ${COMPANY.legalName}, a Slovak limited liability
company, IČO ${COMPANY.icoPlain}, registered at ${addressOneLine('en')}.
${registrationLine('en')}. Contact: ${COMPANY.email}.
Full details: https://residata.eu/imprint

## What Residata is for

- **Developers** — price new projects against real comparables; track absorption of your and competitors' inventory; spot supply gaps by district and segment.
- **Banks & valuers** — pull recent comparable transactions for valuation and collateral assessment; never work with stale data.
- **Investors** — discover projects with favorable pricing, spot slowing sales velocity, identify sell-out timing.
- **Consultants & analysts** — skip weeks of manual data collection; open the whole Slovak and Czech new-build market, normalized.

## Pricing

- ${priceStr} / month for full ongoing access (early-access price; regular ${anchorStr})

## Public surfaces

- Marketing site: ${HOME}/
- Live dashboard (every active project): ${HOME}/live
- What the data looks like, with live figures: ${HOME}/sample
${analysesSurfaceLine()}- The site in Slovak: ${HOME}/sk (pricing ${HOME}/sk/cennik, use cases ${HOME}/sk/vyuzitie, sample ${HOME}/sk/ukazka, live dashboard ${HOME}/sk/live)
${articlesSection()}
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
real estate across Slovakia and Czechia — ${coverageLine.replace(/^Slovakia and Czechia — /, '')},
not just the two capitals. We track every active development project, normalize data
from developer websites into one schema, and refresh the dataset daily.

Operated by ${COMPANY.legalName} (IČO ${COMPANY.icoPlain}), a Slovak limited
liability company at ${addressOneLine('en')}.
${registrationLine('en')}. Contact ${COMPANY.email} · https://residata.eu/imprint

## Market coverage (updated ${EVERY_EN}; snapshot ${monthLabel})

- ${fmtN(market?.total_projects_tracked ?? market?.total_projects_active)} total projects in dataset (currently active + projects that sold out under our tracking — both groups have full historical price/availability snapshots)
- ${fmtN(market?.total_projects_active)} of them are currently active in the market
- ${fmtN(market?.total_developers_active)} distinct active developers
- ${fmtN(market?.total_units_tracked)} individual units tracked across active projects (current snapshot)
- ${fmtN(market?.total_available)} units currently available (for sale)
- ${fmtN(market?.total_reserved)} reserved
- ${fmtN(market?.total_sold)} explicitly sold
- Average price: €${fmtN(market?.avg_eur_m2)} per square meter (across available inventory that carries a published price; roughly one home in nine has none)

The "total projects" number grows over time as developments sell out and new ones enter the market — the dataset accumulates historical comparable transactions, which is why valuers and banks use Residata for collateral assessment.

## Districts (top by inventory)

${districtsTop}.

## Notable projects (top by inventory)

${topProjList}

## Data delivery

- CSV / XLSX exports (any snapshot)
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

- Monthly ongoing access: ${priceStr} / month (early-access price; regular ${anchorStr})

## Where to find this

Available at ${HOME}/. Numbers in this file are regenerated from
the live database on every deploy — what you read here matches what
the public dashboard shows at the same point in time.
`;

fs.writeFileSync(path.resolve('public/llms-full.txt'), llmsFull);
console.log(`[gen-static] public/llms-full.txt — ${llmsFull.length} chars`);

// ─────────────── .well-known/security.txt — vulnerability contact ───────────────
// Written from src/lib/company.js so the company details in it can never drift
// from the Imprint. `Expires` is required by RFC 9116 and must be in the future
// or scanners treat the file as stale — one year from each build keeps it valid
// as long as the site is deployed at all.
const secExpires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, '.000Z');
const securityTxt = `# Residata — security contact
# Operated by ${COMPANY.legalName}, ${addressOneLine('en')}
# Company ID (ICO): ${COMPANY.icoPlain}

Contact: mailto:${COMPANY.email}
Expires: ${secExpires}
Preferred-Languages: sk, en, cs
Canonical: https://residata.eu/.well-known/security.txt
Policy: https://residata.eu/terms

# Found a security issue in Residata? Email the address above with enough
# detail to reproduce it. We acknowledge within 3 working days. Please do not
# access, modify or exfiltrate other users' data, and please give us reasonable
# time to fix an issue before disclosing it publicly.
`;
fs.mkdirSync(path.resolve('public/.well-known'), { recursive: true });
fs.writeFileSync(path.resolve('public/.well-known/security.txt'), securityTxt);
console.log(`[gen-static] public/.well-known/security.txt — ${securityTxt.length} chars`);

// ───────────────────── sitemap.xml — refresh lastmod ─────────────────────
// A sitemap is a list of pages we are ASKING Google to index. Two rules follow
// from that, and this list broke both until 2026-09-03:
//
//   1. every entry must be a REAL route, at its PRIMARY url. `/about` was listed
//      and is not a route at all — the SPA falls through to Home, so we were
//      inviting Google to index a second copy of the homepage under a made-up
//      address. `/data` was listed too, but routing.js makes `/sample` the
//      primary and keeps `/data` only for backward compatibility; the page's own
//      canonical says `/sample`, so the sitemap was pointing at a url that
//      immediately declares a different one — wasted crawl on a sales page.
//
//   2. nothing marked noindex belongs here. /privacy, /imprint and /terms are
//      deliberately noindex in src/lib/seo.js (they earn no search traffic and
//      dilute what Google thinks Residata is). Listing them anyway is a
//      contradiction Search Console reports as "Submitted URL marked noindex".
//
//      They were added here on purpose, with a good reason: § 3a of the
//      Commercial Code requires the company's identity to be ON the website, and
//      a page nothing references in a machine-readable way is easy to forget.
//      That reason is met without the sitemap entry — the imprint is linked from
//      the footer of every page, so it is on the website and reachable, which is
//      all § 3a asks. It does not require the page to be INDEXABLE. Keeping the
//      entry would have meant either living with the contradiction or dropping
//      the noindex, and indexing the legal pages is the thing seo.js explicitly
//      decided against. Removing the entry satisfies both.
//
// src/lib/sitemapRoutes.test.mjs enforces both against routing.js and seo.js.
// /status stays: it is indexable on purpose and nothing links to it prominently.
const SITEMAP_URLS = [
  { loc: '/', priority: '1.0', changefreq: 'weekly' },
  { loc: '/live', priority: '0.9', changefreq: 'weekly' },
  { loc: '/pricing', priority: '0.7', changefreq: 'monthly' },
  { loc: '/use-cases', priority: '0.6', changefreq: 'monthly' },
  { loc: '/sample', priority: '0.6', changefreq: 'monthly' },
  // No /contact: Pricing and Contact are ONE page (the nav reads "Cenník &
  // Kontakt" and points at /pricing), so /contact serves identical content and
  // now canonicalises to /pricing. Submitting both would be duplicate content.
  { loc: '/status',  priority: '0.4', changefreq: 'daily'  },
  // Analýzy — the published market analyses. These are the pages the section
  // exists for: they are what ranks for "ceny novostavieb" / "analýza trhu
  // novostavieb", and what a journalist links when citing us. Every article
  // gets a line here AND an entry in seo.js; sitemapRoutes.test.mjs fails if the
  // two disagree, which is what stops this list rotting the way /about did.
  // changefreq yearly on an article: its figures are a dated snapshot and are
  // deliberately never rewritten — a new month is a new URL, not an edit.
  // Slovak only, like every analysis (lib/articleSeo SECTION_LANG).
  { loc: '/analyzy', priority: '0.8', changefreq: 'monthly', langs: ['sk'] },
];

// Every marketing page exists once per language at its own address
// (src/lib/routing.js SK_PATHS): the English entry above and its Slovak twin
// are both listed, and each names the other as its alternate — until 2026-09-28
// both languages shared one URL, so there was no Slovak page to list.
const MARKETING_URLS = SITEMAP_URLS.filter((e) => !(analysesOffSite && e.loc === '/analyzy')).flatMap((e) => {
  const twin = SK_PATHS[pathToPage(e.loc)];
  if (!twin) return [e];
  const alt = { en: e.loc, sk: twin };
  return [{ ...e, alt }, { ...e, loc: twin, alt }];
});

// Published analyses, straight from the table that renders them, so a piece
// published from /app/articles reaches Google on the next deploy without anyone
// editing this file. Deliberately appended AFTER the literal above rather than
// into it: sitemapRoutes.test.mjs validates that literal against seo.js's static
// SEO table, and article meta is applied at runtime from the row instead.
// 🔴 KEEP THE EXISTING FILES when the articles could not be read. Warning and
// carrying on wrote a sitemap with every published analysis silently missing
// from it — a worse file than the one already on disk, and nothing downstream
// would have said so. A deploy that does not happen is cheaper than a sitemap
// that quietly drops the content it exists to list.
if (!articles) {
  console.warn('[gen-static] no article list — keeping the existing sitemap.');
  process.exit(0);
}
// lastmod is the article's OWN last change. The build date on every url told
// Google that everything changed on every deploy, which is how a crawler learns
// to ignore lastmod altogether.
// hreflang: ONE language lives at an article's address — the one it is written
// in. The site-wide en+sk pair told Google a Slovak analysis had an English
// version (lib/articleSeo.js seoLang, the same rule the page itself follows).
const articleUrls = articles.map((r) => ({
  loc: `/analyzy/${r.slug}`, priority: '0.7', changefreq: 'yearly',
  lastmod: String(r.updated_at || r.article_date || today).slice(0, 10),
  langs: [(r.title && r.title.sk) ? 'sk' : 'en'],
}));
const ALL_SITEMAP_URLS = [...MARKETING_URLS, ...articleUrls];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Residata sitemap. Regenerated on every Vercel build via
  scripts/generate-static-content.mjs. An analysis carries its own last
  change as lastmod; the marketing pages carry the build date.
  /app/* (authenticated platform) and /project/<id> (login-gated
  detail pages) are intentionally NOT here — they're noindex.
-->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${ALL_SITEMAP_URLS.map(({ loc, priority, changefreq, lastmod, langs = PUBLIC_LANGS, alt }) => `
  <url>
    <loc>${HOME}${loc}</loc>
    <lastmod>${lastmod || today}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
${(alt
    ? [['en', alt.en], ['sk', alt.sk], ['x-default', alt.en]]
    : [...langs, 'x-default'].map((l) => [l, loc])
  ).map(([l, href]) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${HOME}${href}" />`).join('\n')}
  </url>`).join('')}
</urlset>
`;

fs.writeFileSync(path.resolve('public/sitemap.xml'), sitemap);
console.log(`[gen-static] public/sitemap.xml — ${sitemap.length} chars, ${ALL_SITEMAP_URLS.length} URLs`);

// ───────────────── data export for vite plugin ─────────────────
// vite.config.js's transformIndexHtml plugin reads this JSON to inject
// the same numbers into index.html's JSON-LD block. Same source, same
// snapshot — guarantees consistency.
// Earliest `oldest_real` across every market we track — the honest start of the
// series. undefined when the view did not answer, and the phrase then says less
// rather than asserting a date it cannot see.
const historySince = ((maturity || [])
  .map((r) => r?.oldest_real)
  .filter(Boolean)
  .map((d) => String(d).slice(0, 10))
  .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  .sort())[0];

const buildData = {
  total_units: market?.total_units_tracked,
  total_projects: market?.total_projects_active,
  // total_projects_tracked = projects with archive data (current active +
  // sold-out under tracking). Falls back to active if older view shape.
  total_projects_tracked: market?.total_projects_tracked ?? market?.total_projects_active,
  total_developers: market?.total_developers_active,
  // Towns/cities with actively-sold projects. Added 2026-09-03 so the per-route
  // SEO copy can state real coverage instead of a hardcoded city name — see
  // src/lib/seo.js coveragePhrase(). Same snapshot as llms.txt, so the two
  // cannot disagree about how big the product is.
  total_cities: cityCount || undefined,
  // First observation across all markets, YYYY-MM-DD. Feeds
  // src/lib/seo.js historySincePhrase(), which is what the marketing copy states
  // instead of counting months: a count cannot be checked by the build and
  // decays in both directions, a start date only gets stronger.
  history_since: historySince,
  // How often the market is read (src/lib/refreshCadence.js reads it).
  scrape_every_days: scrapeEveryDays ?? undefined,
  total_available: market?.total_available,
  // PERF Step 2: reserved + sold included so the build-time snapshot is a
  // complete seed for the hero/headline (useMarketTotals) — see vite.config.js
  // __BUILD_SNAPSHOT_JSON__ and src/lib/useData.js seedMarketTotalsFromSnapshot.
  total_reserved: market?.total_reserved,
  total_sold: market?.total_sold,
  avg_eur_m2: market?.avg_eur_m2,
  snapshot_month: market?.snapshot_month,
  month_label: monthLabel,
  // Subscription price from public.pricing_config (single source of truth) so
  // index.html's JSON-LD Offer + FAQ price follow the admin editor per deploy.
  monthly_price: priceStr,       // display, e.g. "€349.99"
  monthly_price_num: priceNum,   // JSON-LD numeric, e.g. "349.99"
  anchor_price: anchorStr,       // display, e.g. "€479.99"
  // The build-time snapshot is the SK market (the generator queries market_totals
  // which is country-agnostic but our default/primary market is SK).
  country: 'SK',
  build_date: today,
};
fs.writeFileSync(path.resolve('scripts/.build-data.json'), JSON.stringify(buildData, null, 2));
console.log(`[gen-static] scripts/.build-data.json (for vite index.html plugin)`);

console.log('[gen-static] DONE');
