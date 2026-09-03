import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
// The company's legal identity comes from the SAME module the app renders from
// (src/lib/company.js), so index.html's structured data can never disagree with
// the Imprint. Never retype a company detail into the HTML.
import { COMPANY, addressOneLine } from './src/lib/company.js'
import { FALLBACK_MONTHLY_CENTS, FALLBACK_MONTHLY_DISPLAY, FALLBACK_ANCHOR_DISPLAY } from './src/lib/pricingDefaults.js'

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
 *   __SCHEMA_TOTAL_UNITS__            — current total units tracked
 *   __SCHEMA_TOTAL_PROJECTS__         — currently active project count
 *   __SCHEMA_TOTAL_PROJECTS_TRACKED__ — projects with archive data (active +
 *                                       sold-out under tracking, monotonically
 *                                       growing)
 *   __SCHEMA_MONTH_LABEL__            — e.g. "April 2026"
 *   __COMPANY_*__                     — legal identity from src/lib/company.js
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
        __SCHEMA_TOTAL_UNITS__:            data.total_units            != null ? Number(data.total_units).toLocaleString('en-US')            : '5,500+',
        __SCHEMA_TOTAL_PROJECTS__:         data.total_projects         != null ? Number(data.total_projects).toLocaleString('en-US')         : '60+',
        __SCHEMA_TOTAL_PROJECTS_TRACKED__: data.total_projects_tracked != null ? Number(data.total_projects_tracked).toLocaleString('en-US') : (data.total_projects != null ? Number(data.total_projects).toLocaleString('en-US') : '60+'),
        __SCHEMA_MONTH_LABEL__:            data.month_label            || 'the latest snapshot',
        // Subscription price from public.pricing_config (single source of truth,
        // edited in the admin Pricing editor). Injected at build so index.html's
        // JSON-LD Offer + FAQ follow the editor per deploy. Fallback = current
        // launch price if build-data is absent.
        __SCHEMA_MONTHLY_PRICE__:          data.monthly_price          || FALLBACK_MONTHLY_DISPLAY,
        __SCHEMA_MONTHLY_PRICE_NUM__:      data.monthly_price_num      || (FALLBACK_MONTHLY_CENTS / 100).toFixed(2),
        __SCHEMA_ANCHOR_PRICE__:           data.anchor_price           || FALLBACK_ANCHOR_DISPLAY,
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

export default defineConfig({
  plugins: [react(), residataIndexHtmlContent()],
})
