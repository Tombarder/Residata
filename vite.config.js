import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

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
