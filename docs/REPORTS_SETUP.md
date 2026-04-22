# Reports layer — setup

This doc covers everything non-obvious about the Reports module
(`src/pages/Reports.jsx`) and how to turn optional features on.

## What the Reports page does

Five scopes, each rendering the same section taxonomy:

| Scope       | What it shows                                          | Typical use                        |
|-------------|--------------------------------------------------------|------------------------------------|
| Trh         | Market-wide: every project, every unit                 | Monthly market pulse               |
| Mesto       | Filtered by `projects.city`                            | "Čo sa deje v Bratislave"          |
| Časť mesta  | Filtered by `projects.district`                        | "Petržalka vs. trh"                |
| Projekt     | One project deep-dive                                  | Pricing + unit-mix per project     |
| Developer   | One developer's portfolio                              | Competitive landscape              |

Every scope renders:

1. **KPI strip** — projects / units / available / sold / sold% / weighted €/m²
2. **Executive summary** — Slovak prose from the aggregates
3. **AI summary** (optional, see below)
4. **Price distribution** — histogram of €/m² bins
5. **Breakdown** — by district / developer / project / izby (scope-dependent)
6. **Benchmark** — scope vs. wider market with red/green delta
7. **Project table** — the full list
8. **Historical trend** — month-by-month from `project_snapshots`

Download options:

- **⬇ CSV** — project-level CSV of the current scope.
- **🖨 Stiahnuť PDF** — uses the browser's `window.print()`. The page
  ships its own print stylesheet that strips nav, inverts to light,
  and sets page-breaks per section. Works in all modern browsers; user
  picks "Save as PDF" in the print dialog.

## Turning on AI summaries

The "✨ Vygenerovať" button calls `/api/ai/summary` (Vercel serverless,
file: `api/ai/summary.js`). The function talks to Claude (Anthropic
Messages API, `claude-sonnet-4-5`) with a calibrated Slovak prompt.

### Step 1. Get an Anthropic API key

1. Go to <https://console.anthropic.com/settings/keys>
2. Create a new key. Copy the `sk-ant-...` value.

### Step 2. Add it to Vercel env

1. Vercel dashboard → project → **Settings** → **Environment Variables**
2. Add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-...`
   - Environments: **Production**, **Preview**, **Development**
3. Redeploy (or push any commit).

When the key is missing the endpoint returns HTTP 501 and the UI shows a
helpful "Pridaj ANTHROPIC_API_KEY…" hint instead of a red error.

### What gets sent to AI

The client sends a compact JSON like:

```json
{
  "scope": "district",
  "scopeLabel": "Petržalka",
  "summary":   { "projects": 18, "units": 2412, "available": 1031, "sold": 1381, "soldPct": 57, "wavgM2": 3640 },
  "benchmark": { "projects": 142, "units": 15890, "wavgM2": 4120, "soldPct": 48 },
  "breakdown": [
    { "name": "Skyland Group", "projects": 3, "units": 640, "available": 212, "soldPct": 67, "wavgM2": 4010 },
    …
  ],
  "priceBins": [ { "band": "3 000–3 500 €/m²", "count": 180 }, … ]
}
```

No PII, no personal data, no unit-level rows — aggregates only. The
endpoint caps input at 16 KB and output at 900 tokens. Typical cost per
summary is well under 1 cent.

## Cost / abuse controls

- **Per-request token cap**: 900 output tokens (~600 words).
- **Per-request input cap**: 16 KB JSON.
- **Rate limiting** is NOT built in — if the app grows past a few
  active users, add a per-user rate limit (e.g. Supabase row
  counting by `user_id` + window). For now the feature is behind
  `view_monthly_reports` capability which means paid tier only.

## Troubleshooting

- **"AI ešte nie je zapnuté"** → env var missing or not redeployed.
- **"anthropic HTTP 401"** → bad key.
- **"anthropic HTTP 429"** → rate-limited at Anthropic.
- **"context too large"** → we're sending more than 16 KB. Happens only
  if the scope has many hundreds of projects; tune `slim()` in
  `buildAiContext` to trim.

## Known limitations (next iterations)

- **Columns zone in Pivot** — not wired yet (only Rows / Values / Filters).
  Tracked for a follow-up; would let users cross-tab e.g. Developer × Stav.
- **Email delivery** — the reports download-only for now. Scheduled email
  delivery (first of the month) is in the roadmap.
- **Time series on price bins** — the histogram is current-snapshot only.
  A "price drift" view (month-over-month) requires the same binning on
  `project_snapshots` which doesn't carry unit-level prices.
