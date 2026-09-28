import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
// The company's legal identity comes from the SAME module the app renders from
// (src/lib/company.js), so index.html's structured data can never disagree with
// the Imprint. Never retype a company detail into the HTML.
import { COMPANY, addressOneLine } from './src/lib/company.js'
import { FALLBACK_MONTHLY_CENTS } from './src/lib/pricingDefaults.js'
import { firstPaintScript } from './src/lib/trialBannerState.js'

/**
 * residataIndexHtmlContent
 * ------------------------
 * Replaces placeholder tokens in index.html's schema.org JSON-LD block
 * (and any other meta-tag content that needs current numbers) with live
 * values fetched at build time. The data is produced by
 * scripts/generate-static-content.mjs which runs BEFORE vite — this
 * plugin just reads the cached JSON it leaves at scripts/.build-data.json
 * and substitutes tokens.
 *
 * Tokens used in index.html:
 *   __SCHEMA_MONTHLY_PRICE_NUM__      — the subscription price in the Offer
 *   __BUILD_SNAPSHOT_JSON__           — the build-time market snapshot
 *   __COMPANY_*__                     — legal identity from src/lib/company.js
 *
 * (Until 2026-09-28 index.html also carried a FAQPage block with the market
 * counts and the prices. Google requires FAQ markup to match a FAQ VISIBLE on
 * the page, and the homepage shows none, so it went; everything it said is in
 * llms.txt, the file written for AI assistants.)
 *
 * If the JSON is missing (script didn't run / no env vars), placeholders
 * keep their default values written in the HTML — graceful fallback.
 */
function residataIndexHtmlContent() {
  return {
    name: 'residata-index-html-content',
    transformIndexHtml(html) {
      let data = {};
      try {
        const p = path.resolve(__dirname, 'scripts/.build-data.json');
        if (fs.existsSync(p)) data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch (e) {
        console.warn('[vite] build-data.json read failed, using defaults:', e.message);
      }
      const tokens = {
        // Subscription price from public.pricing_config (single source of truth,
        // edited in the admin Pricing editor). Injected at build so index.html's
        // JSON-LD Offer follows the editor — and a price change rebuilds the site
        // (scraper repo, 2026-09-28_price_and_market_figures_rebuild_the_site.sql).
        // Fallback = current launch price if build-data is absent.
        __SCHEMA_MONTHLY_PRICE_NUM__:      data.monthly_price_num      || (FALLBACK_MONTHLY_CENTS / 100).toFixed(2),
        // The before-paint banner decision (index.html <head>): the same answer
        // TrialBanner reaches, so a pre-built page shows the banner the app will.
        __FIRST_PAINT_SCRIPT__:            firstPaintScript(),
        // PERF Step 2: the FULL build-time snapshot, injected as JSON into an
        // inline <script> so window.__RESIDATA_SNAPSHOT__ exists before any app
        // JS runs. src/lib/useData.js seeds useMarketTotals from it → the hero
        // headline paints real numbers on first render (no "loading…" flash, no
        // DB round-trip on the critical path). 'null' when build data absent
        // (graceful fallback → current live-fetch behaviour). Must be valid JS.
        __BUILD_SNAPSHOT_JSON__:           (data && Object.keys(data).length) ? JSON.stringify(data) : 'null',
        // Legal identity — one source (src/lib/company.js), same as the Imprint.
        // The deploy's own identity. Vercel exposes the commit SHA; locally the
        // build time is enough to tell two builds apart. errorReport stores it,
        // so an error can be attributed to the build that had the bug — without
        // it, that field was always null while the code claimed otherwise.
        __BUILD_ID__: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 8)
                      || new Date().toISOString().slice(0, 16).replace('T', ' '),
        __COMPANY_LEGAL_NAME__:            COMPANY.legalName,
        __COMPANY_ICO__:                   COMPANY.icoPlain,
        __COMPANY_STREET__:                COMPANY.street,
        __COMPANY_POSTAL__:                COMPANY.postalCode,
        __COMPANY_CITY__:                  COMPANY.cityEn,
        __COMPANY_COUNTRY__:               COMPANY.countryCode,
        __COMPANY_ADDRESS_ONE_LINE__:      addressOneLine('en'),
        __COMPANY_PHONE__:                 COMPANY.phone,
        __COMPANY_FOUNDED__:               COMPANY.incorporatedOn,
        // Emitted as a whole JSON line so an unissued VAT number produces NO
        // field at all rather than an empty one. Same for the tax ID.
        __COMPANY_VATID_LINE__:            COMPANY.icDph ? `"vatID": ${JSON.stringify(COMPANY.icDph)},` : '',
        __COMPANY_TAXID_LINE__:            COMPANY.dic   ? `"taxID": ${JSON.stringify(COMPANY.dic)},`   : '',
      };
      let out = html;
      for (const [k, v] of Object.entries(tokens)) {
        out = out.split(k).join(String(v));
      }
      return out;
    },
  };
}

/**
 * maplibreWorkerAssets
 * --------------------
 * MapLibre 6 does not inline its tile worker. It builds one at RUNTIME from a file
 * it expects to find beside itself, and that worker then imports a second file
 * beside IT:
 *
 *   maplibre-gl.mjs  ->  new URL("./maplibre-gl-worker.mjs", import.meta.url)
 *   maplibre-gl-worker.mjs  ->  import ... from "./maplibre-gl-shared.mjs"
 *
 * No bundler can see either edge: the first is a runtime-built URL, the second
 * lives inside a file nothing imports. So Vite emitted neither, the SPA rewrite
 * answered both requests with index.html, and `new Worker(anHtmlPage, {type:
 * "module"})` failed the way module workers fail — in total silence. The map
 * mounted, sized its canvas, drew its controls, loaded its sprite and glyphs, and
 * painted nothing but the style's background colour. Boss got a black rectangle
 * with working buttons on it (2026-09-14).
 *
 * `?url` is not enough on its own, which is how the first fix missed: it copies
 * the worker verbatim and still emits nothing for the `./maplibre-gl-shared.mjs`
 * the copy imports. Both files have to land, KEEPING THEIR NAMES, in ONE folder.
 *
 * The folder carries the package version, so upgrading MapLibre changes the URL
 * on its own and no stale worker can be served from cache against a new library.
 * Nothing here is hand-maintained: the version and the file list come from the
 * installed package.
 *
 * Dev and build are served from the same declaration deliberately. The upgrade
 * that caused this was verified in `vite dev`, where MapLibre's own resolution
 * happens to work — a difference between dev and prod is exactly what hid it.
 */
function maplibreWorkerAssets() {
  const version = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'node_modules/maplibre-gl/package.json'), 'utf-8'),
  ).version;
  const dir = `maplibre/${version}`;
  // The worker, and the module the worker imports. Names are load-bearing:
  // maplibre-gl-worker.mjs asks for "./maplibre-gl-shared.mjs" by that exact name.
  const FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];
  const srcOf = (f) => path.resolve(__dirname, 'node_modules/maplibre-gl/dist', f);

  return {
    name: 'residata-maplibre-worker-assets',
    config() {
      // The app reads this to call setWorkerUrl — one source for the path.
      return { define: { __MAPLIBRE_WORKER_URL__: JSON.stringify(`/${dir}/${FILES[0]}`) } };
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const hit = FILES.find((f) => req.url && req.url.split('?')[0].endsWith(`/${dir}/${f}`));
        if (!hit) return next();
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.end(fs.readFileSync(srcOf(hit)));
      });
    },
    generateBundle() {
      for (const f of FILES) {
        this.emitFile({ type: 'asset', fileName: `${dir}/${f}`, source: fs.readFileSync(srcOf(f)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), residataIndexHtmlContent(), maplibreWorkerAssets()],
})
