# Reports layer — setup

This doc covers everything non-obvious about the Reports module
(`src/pages/Reports.jsx`) and how to turn optional features on.

## What the Reports page does

Five scopes, each rendering the same section taxonomy:

| Scope       | What it shows                                          | Typical use                        |
|-------------|--------------------------------------------------------|------------------------------------|
| Trh         | Market-wide: every project, every unit                 | Monthly market pulse               |
| Mesto       | Filtered by `projects.city` (inferred from district)   | "Čo sa deje v Bratislave"          |
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

Header buttons:

- **📧 Odoberať mesačne** — one click subscribes the user to the monthly
  email for the current scope. Details below.
- **⬇ CSV** — project-level CSV of the current scope.
- **🖨 Stiahnuť PDF** — uses the browser's `window.print()`. The page
  ships its own print stylesheet that strips nav, inverts to light,
  and sets page-breaks per section. Works in all modern browsers; user
  picks "Save as PDF" in the print dialog.

---

## Step 1. Run the DB migration

File: `supabase_migration_2026_04_ai_usage.sql` in the repo root.

Creates two tables the AI endpoint and the monthly cron need:

- `ai_usage_log` — every AI call logged for rate limiting + cost tracking.
- `report_subscriptions` — who wants the monthly email.

Both have RLS on. Self-read-only for users; server-side code uses the
service-role key to bypass RLS for cross-user queries.

Open the Supabase SQL editor at
<https://supabase.com/dashboard/project/mtclsrswxtjseewyrcbx/sql/new>,
paste the whole migration file in, run it. It's idempotent — re-running
won't create duplicates.

---

## Step 2. Turn on AI summaries (optional)

The "✨ Vygenerovať" button calls `/api/ai/summary` (Vercel serverless,
file: `api/ai/summary.js`). It talks to Claude (Anthropic Messages API,
`claude-sonnet-4-5`) with a calibrated Slovak prompt.

### 2a. Get an Anthropic API key

1. <https://console.anthropic.com/settings/keys>
2. Create a new key. Copy the `sk-ant-...` value.

### 2b. Add it to Vercel env

1. <https://vercel.com/tombarder/residata/settings/environment-variables>
2. Add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-...`
   - Environments: **Production**, **Preview**, **Development**
3. Redeploy (push any commit, or in Vercel UI: Deployments → … → Redeploy).

When the key is missing the endpoint returns HTTP 501 and the UI shows a
helpful "Pridaj ANTHROPIC_API_KEY…" hint instead of a red error.

### Rate limits (enforced)

Per user, rolling windows:

| Tier  | Per hour | Per day |
|-------|---------:|--------:|
| admin | 60       | 500     |
| paid  | 30       | 200     |
| free  | 5        | 20      |
| anon  | 3        | 10      |

When exceeded the endpoint returns 429 + `retry_after_sec` and the UI
shows a friendly "limit reached" message.

### What gets sent to AI

The client sends a compact JSON like:

```json
{
  "scope": "district",
  "scopeLabel": "Petržalka",
  "summary":   { "projects": 18, "units": 2412, "available": 1031, "sold": 1381, "soldPct": 57, "wavgM2": 3640 },
  "benchmark": { "projects": 142, "units": 15890, "wavgM2": 4120, "soldPct": 48 },
  "breakdown": [
    { "name": "Skyland Group", "projects": 3, "units": 640, "available": 212, "soldPct": 67, "wavgM2": 4010 }
  ],
  "priceBins": [ { "band": "3 000–3 500 €/m²", "count": 180 } ]
}
```

No PII, no personal data, no unit-level rows — aggregates only. The
endpoint caps input at 16 KB and output at 900 tokens. Typical cost per
summary is well under 1 cent.

---

## Step 3. Turn on monthly email reports (optional)

Vercel cron at `/api/cron/monthly-reports` fires 1st of each month, 08:00
UTC. Iterates `report_subscriptions.enabled=true`, renders an inline
HTML report, sends via Gmail SMTP.

### 3a. Gmail app password

Already set for the welcome/approval flow. If `GMAIL_USER` +
`GMAIL_APP_PASSWORD` aren't in Vercel envs, add them:

1. <https://myaccount.google.com/apppasswords> → create a 16-char password.
2. <https://vercel.com/tombarder/residata/settings/environment-variables>
   - `GMAIL_USER` = `residata@gmail.com` (or whichever sending address)
   - `GMAIL_APP_PASSWORD` = `xxxx xxxx xxxx xxxx`

### 3b. Cron secret (recommended)

Lets admin manually trigger the cron for testing. Without it, only
Vercel's internal scheduler can hit the endpoint.

1. Generate any long random string.
2. Add to Vercel envs: `CRON_SECRET` = the random string.
3. Test manually:

   ```bash
   curl -X POST https://residata-gamma.vercel.app/api/cron/monthly-reports \
        -H "Authorization: Bearer $CRON_SECRET"
   ```

### 3c. Verify the schedule

After deploy, check <https://vercel.com/tombarder/residata/settings/cron-jobs>
— the "Monthly reports" job should be listed with next run in the future.

### 3d. Users opt in

Each logged-in user sees a **📧 Odoberať mesačne** button at the top of
their Reports page. One click subscribes them to the scope they're
currently viewing. The row in `report_subscriptions` encodes scope +
scope_label + lang, so a user can subscribe to "Petržalka" and a
different user to "Developer: YIT Slovakia" — the cron fans out the
right content per row.

---

## Step 4. Admin panel visibility (optional)

You can view all AI usage + subscribers directly in Supabase:

- <https://supabase.com/dashboard/project/mtclsrswxtjseewyrcbx/editor>
  → `ai_usage_log` table — every AI call, user, scope, input/output
  tokens, ok flag, error message, timestamp.
- Same editor → `report_subscriptions` — who's opted in, their scope,
  last_sent_at (null until first cron run).

---

## Cost / abuse controls

- **Per-request token cap**: 900 output tokens (~600 words).
- **Per-request input cap**: 16 KB JSON.
- **Per-user rate limit**: hourly + daily windows, see table above.
- **Cron endpoint auth**: Vercel's `x-vercel-cron: 1` header or
  `CRON_SECRET` bearer token. Random internet POSTs return 401.

## Troubleshooting

- **"AI ešte nie je zapnuté"** → env var missing or not redeployed.
- **"AI rate limit reached"** → user hit their hourly/daily cap; either
  wait or bump their tier in `user_profiles.tier`.
- **"anthropic HTTP 401"** → bad key.
- **"anthropic HTTP 429"** → rate-limited at Anthropic.
- **"context too large"** → the client is sending more than 16 KB.
  Only happens if the scope has many hundreds of projects; tune
  `slim()` in `buildAiContext()` to trim.
- **Cron didn't fire** → check <https://vercel.com/tombarder/residata/logs>.
  Free-tier Vercel only allows once/day crons; Hobby is fine for monthly.
- **Emails didn't send** → check Gmail quotas (500/day on free gmail,
  2000/day on Google Workspace). Look at `results[]` in the cron
  response for per-recipient error strings.

## Known limitations

- **AI** is per-scope summary only; no year-over-year comparisons
  yet (would need historical `project_snapshots` enrichment).
- **Monthly email** is currently scope-snapshot only; no diff narrative
  ("v Petržalke pribudlo X predajov oproti predminulému mesiacu")
  — also needs snapshot history.
- **Email delivery** goes out from Gmail → if sending to > ~20 subscribers
  regularly, swap in a transactional ESP (Postmark, Resend).
