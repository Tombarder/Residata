# Residata — Frontend Handoff (2026-06-22)

> Working doc for a new Claude chat picking up **website work** (residata-frontend):
> filling missing data, making it faster/smoother, adding features. Read this first,
> then the "Read next" list at the bottom. Everything here is verified against the
> live repos/DB as of 2026-06-22.

---

## 0. TL;DR — what we're doing now

The backend scraper (separate repo) is stable and in production. **Focus is now the
website**: performance/scalability, filling in data that currently shows empty, and
new features. The hard scalability work (a server-side analytics serving layer) is
**partly done** and is the backbone the website should keep moving onto.

---

## 0.5 🔭 Session 2026-06-22 — what just shipped + critical learnings (READ THIS)

Everything below is **merged + live + verified** unless noted. Both repos auto-deploy
on merge to `main` (frontend → Vercel; scraper → Cloud Run).

**Shipped — frontend (`residata-frontend`):**
- **Map → "Open project" stuck-on-"Loading…" — FIXED** ([#43]/[#45]). Root cause was a
  **data-load race** in `src/lib/useData.js` `useProjectFlats`: a per-effect boolean
  `cancelled` flag with `if (cancelled) return` placed *before* `setLoading(false)`, so
  under rapid re-render thrash (opening from the heavy maplibre map) the latest 200
  result was discarded and the spinner never cleared. Fix = a **monotonic request-id
  guard + `try/finally`** (only stale runs skip; the newest run always commits + always
  clears loading). **The same pattern was fixed in 3 sibling hooks** — `useMetrics`,
  `useTotalsList`, `useDistrictTotals` (they also lacked a `.catch`, so a rejected
  request stranded the spinner). **This pattern is the template** for any "stuck
  loading" hook here.
- **Warm-up 500 — FIXED.** `supabase.js` pre-warmed the connection against
  `public.projects` (a slow view that timed out for anon → HTTP 500 every page load);
  repointed to the fast `projects_live` matview.
- **`npm audit` → 0 vulnerabilities** ([#50]) — non-breaking vite + @babel patch bumps.

**Shipped — scraper (`novostavby`):**
- **`public.projects` view — FIXED** ([#538], applied live). It was a slow plain VIEW
  recomputing `reference.project_state_corrected` 5× → anon `statement_timeout` (57014 /
  HTTP 500). Redefined as a **thin view over the `public.projects_live` matview** (its
  materialized twin) — instant, identical 33-col shape, refreshed via the existing
  `analytics.refresh_projects_live()` on approve. Migration:
  `v2/migrations/2026-06-22_public_projects_over_matview.sql`.
- **Daily-scraper email overhaul** ([#531]) — says "✅ auto-approved (nothing to do)"
  instead of dead Approve/Reject buttons when a run auto-approves; a top **verdict band**
  that distinguishes BIG/blocking (🔴) from small/non-blocking (⚠️) problems; shows real
  **Firecrawl usage** (calls + live credit balance) since per-call $ is logged at 0 by
  design; dropped the always-empty `$`/`Auto-sold` columns (auto-sold is OFF by design —
  documented, not a bug). `v2/lib/scraper_email.py`.

**⚠️ CRITICAL LATENT BUG — proven, NOT fixed (decide before it bites):**
There is a **deadlock in the Supabase auth layer** (`src/lib/supabase.js`
`inMemoryAuthLock`). Its comment claims "a prior failure never blocks the next" — true
for a *rejected* op, but a **hung OR failed token-refresh** leaves gotrue-js's internal
refresh-deferred stuck, so **every subsequent `getSession()` (and thus every
logged-in/RLS data query) hangs forever — until a full page refresh** resets the
module-level `_authChain`. **Reproduced locally** (hang `/auth/v1/token` → `getSession`
+ flats query both HUNG; a *failed* refresh also strands it via gotrue's retry path). It
produces the *exact same symptom* as the data-load race ("never loads, refresh fixes
it"), so it's easy to misattribute. This session's map bug turned out to be the race
(now fixed + Boss-confirmed working), **not** this — so I did NOT ship an auth fix (an
unverified attempt with a grace-timeout + fetch-timeout did NOT clear it in testing and
was reverted; the deadlock is inside gotrue-js, not our lock). **If "stuck loading that
only a refresh fixes" recurs**, this is almost certainly it — and a real fix likely
needs bounding/replacing gotrue's refresh behavior (a custom fetch timeout alone is
insufficient because a *failed* refresh also strands it). Don't ship an auth-layer change
you can't verify against a reproduced hang.

**How to actually test the live product (you'll need this):** log in as the admin test
account `claude.agent@residata.sk` via a Supabase admin magic-link, then drive either the
local dev server (`preview_*` tools) or the live site (Claude-in-Chrome). Full recipe in
memory **`reference_agent_ui_access`**. To inject a session into the local preview: mint a
link with admin `generate_link`, exchange the `hashed_token` via `/auth/v1/verify`, write
the session JSON to `localStorage['sb-mtclsrswxtjseewyrcbx-auth-token']`, reload. The
preview's headless browser canNOT reproduce maplibre real-clicks (synthetic events don't
trigger its hit-testing) and does NOT reproduce the auth deadlock — so popstate-nav is a
fine proxy for in-app navigation, but env-specific bugs need the real browser.

**Open / next candidates:** (1) the analytics serving-layer rebuild (memory
`project_analytics_rebuild`, plan in `novostavby/v2/docs/ANALYTICS_REBUILD_PLAN.md`) — the
backbone for the perf items below; (2) the latent auth deadlock above; (3) the backlog in
§8 (PivotV2/UnitTracker still fetch the whole archive client-side; velocity/sold_30d
empty until real monthly snapshots accumulate; AI assistant not country-scoped);
(4) "filling missing data" — clarify with Boss which (likely project locations/coords via
the `/app/locations` admin map picker — memory `reference_location_manager`).

---

## 1. What Residata is

A **competitive-intelligence platform for new-build apartments** (novostavby) in
Slovakia + Czechia. It scrapes every developer's price list daily, normalizes it,
and sells dashboards / analytics / reports to developers, agents, funds, banks.
The moat is the clean, historical, cross-developer **transaction-direction data**
(what's available / reserved / sold, price/m², absorption, velocity).

- **Live site:** https://residata-gamma.vercel.app
- **Founder / the user ("Boss"):** Tomáš Kamhal — CEO of Sympatia Group, finance
  background (PwC). **Non-developer** but tech-literate. Slovak-first.

---

## 2. The Boss + how to communicate (CRITICAL — read twice)

He is a **CEO, not a developer.** He does NOT want code details, function names,
column numbers, data structures. He WANTS: what's happening (plain language), why it
matters (business impact), the options + trade-offs simply, your recommendation, and
what happens next. Keep updates **short**.

- **Always think AND reply in English**, regardless of the language he writes in
  (he mixes Slovak/English). This is a standing memory rule.
- **"v ľudskej reči" = explain like to a smart CEO**, NOT baby-talk. Do not dumb down.
- **End every substantive message with a short summary.** Use up to 3 conditional
  sections — *Questions / Decisions / Problems* — only when there's something in them.
- Don't re-ask once a direction is approved. "Do it" = do the whole plan.

### Confirmation rule
- **Low blast-radius** (local edits, test runs, a frontend branch/PR): just do it + tell him.
- **Production-affecting** (DB schema/migration on the live DB, anything that changes
  the live site's behaviour for users, irreversible actions): say what you'll do and
  **wait for "ano / schvaľujem / do it."**
- Always say what you'll do before doing it.

### Merge authority
**You own merging.** The Boss delegates ALL PR merging to you — he never touches it.
Merge the final, verified state yourself. **Frontend `main` auto-deploys to Vercel**,
so "merge" = "ship to production." Don't leave finished PRs hanging; don't ask him to merge.

---

## 3. The 3 cardinal rules (these override convenience — they are in memory)

1. **Never sweep a problem under the rug.** Any warning/error/oddity → find the
   **root cause with proof** (logs, queries, live checks — not a hypothesis), fix it on
   the spot, no band-aid workarounds. Banned hedge-words: "probably / maybe / one-off /
   transient" unless you have reproducible proof. Fix routine bugs yourself silently;
   only escalate strategic/architectural/security/financial calls.
2. **(Backend) Every project must scrape every run** — zero tolerance. Mostly relevant
   to the scraper, but know it exists.
3. **Always the best long-term solution, never a quick-fix.** When a fast-but-fragile
   option competes with the correct-forever one, pick correct-forever (the Boss
   explicitly rejects cosmetic shortcuts). No "we'll fix it later", no loose ends —
   finish what you start or write it as a concrete, acceptance-bound to-do. Not a
   licence to over-engineer: simple + correct + durable beats clever.

---

## 4. Repos + where things live

| | Repo | Local path | Deploy |
|---|---|---|---|
| **Frontend (focus)** | `Tombarder/Residata` | `/Users/tomaskamhal/residata-frontend` | Vercel, push-to-`main` → residata-gamma.vercel.app |
| **Backend / scraper** | `Tombarder/novostavby-scraper` | `/Users/tomaskamhal/novostavby` | Cloud Run Job (daily scrape) |

Both talk to the **same Supabase project** (Postgres), ref `mtclsrswxtjseewyrcbx`.
`.env` + secrets are local + gitignored in each repo.

---

## 5. System architecture (how the website gets its data)

```
Daily scraper (Cloud Run, per market sk/cz)
        ↓ writes a snapshot
Supabase Postgres  —  schemas:
   reference  (hierarchy, config, runs, audit)
   review     (pending snapshots, await approval)
   final      (approved data — final.units is the source of truth)
   analytics  (denormalized serving layer: unit_facts + cube + RPCs)
   public     (VIEWS the website reads, RLS-gated for the anon key)
        ↓ @supabase/supabase-js (anon key, RLS)
Website (React/Vite on Vercel) + Vercel serverless api/ functions
```

- **DB-first, snapshot model.** A scrape = one snapshot = atomic unit; approve/reject
  whole snapshots. Manual approve is the design (a temporary auto-approve-clean gate is
  currently on for testing).
- **Markets:** `sk` + `cz` are active; `sk-ostatne` / `cz-ostatne` provisioned but paused.
- The website reads **`public.*` views** (e.g. `flats_current`, `flats_archive`,
  `projects_live`, `metrics`, `totals_global` / `totals_by_country` / `totals_by_district`,
  `velocity_maturity`, `project_coords`, `currency_rates`) and **analytics RPCs**
  (`analytics_pivot`, `analytics_registry`). RLS gates the anon key to 0 raw unit rows;
  per-unit views are `security_invoker`.
- **Querying/altering the DB from this Mac:** direct Postgres :5432 is blocked → use the
  backend repo's `v2/lib/db_client.py` HTTPS Management API helper
  (`db_client._mgmt_query(sql)` / `fetch_all` / `fetch_one`; unset `SUPABASE_DB_URL`
  + `SUPABASE_DB_PASSWORD`, run with `dangerouslyDisableSandbox`). See backend memory
  `reference_supabase_db_access`.

---

## 6. The frontend, concretely

- **Stack:** React 19 + Vite. Deps are intentionally lean: `@supabase/supabase-js`
  (data), `maplibre-gl` (map), `nodemailer` (server-side email), `react`/`react-dom`.
  **No chart library** — charts are hand-rolled SVG/CSS in components. Plain JS/JSX
  (no TypeScript). ESLint configured.
- **Scripts:** `npm run dev` (Vite dev server), `npm run build` (prebuild runs
  `scripts/generate-static-content.mjs` → regenerates SEO static files), `npm run lint`.
- **Pages** (`src/pages/`): `Platform.jsx` (the app shell / dashboard), `PivotV2.jsx`
  ("Analytika" pivot), `UnitExplorer.jsx` (raw per-unit explorer, virtualized),
  `UnitTracker.jsx` ("Byt v čase" per-unit history), `Reports.jsx`, `MapView.jsx`,
  `LivePages.jsx`, `HomeExtras.jsx`, `HeroVariants.jsx`, `LegalPages.jsx`.
- **Data layer:** `src/lib/useData.js` holds the fetch hooks (`useFlatsArchive`,
  `useUnitsInfinite`, etc.); `src/lib/supabase.js` is the client. Other libs:
  `money.js`, `absorption.js`, `routing.js`, `seo.js`, `capabilities.js`, `sanitize.js`.
- **Serverless backend-for-frontend** (`api/`, Vercel functions): `ai/` (the AI
  assistant + chat log), `admin/`, `cron/`, `trial/` (trial/subscription), `webhooks/`,
  `_lib/`. These run on Vercel, not in the React bundle.
- **Auth:** Supabase email-OTP / magic-link (NOT Google SSO in the app despite the admin
  Studio login). For autonomous live QA there's an admin test account
  `claude.agent@residata.sk` — see backend memory `reference_agent_ui_access` for the
  exact magic-link login flow via Supabase admin `generate_link` + Claude-in-Chrome.

---

## 7. Current state — recently shipped (frontend git log)

- **#38** Unit Explorer: virtualized infinite-scroll table (handles the growing archive).
- **#37** Map: moved ref writes out of render (fixed chronically-red CI).
- **#31–#36** Pivot ("Analytika") rewired to the **new server-side `analytics_pivot`
  engine** with any-dimension server-side filtering; Unit Explorer built (Phase 3.1,
  "show raw values as values"); filter dropdowns follow archive mode.
- Map: click-to-zoom clusters, container-resize robustness.

**Backend analytics rebuild (the proper fix for the #1 perf problem)** is tracked in
the *backend* repo at `v2/docs/ANALYTICS_REBUILD_PLAN.md`. It builds a denormalized
`analytics.unit_facts` (RANGE-partitioned by month) + a dimension registry + one
server query engine + a rollup cube + €/m² anomaly alerts, so the website stops
fetching the whole archive client-side. **Phase 1.1 + 1.2 are done** (facts table
built + backfilled) and the pivot already reads the engine. Continuing to move
screens onto this serving layer is the highest-value scalability work.

---

## 8. Backlog — what to work on (from PLATFORM_AUDIT_2026-06-10.md, "Outstanding")

1. **Perf / scalability (#1, most important).** `PivotV2` ("Analytika") and
   `UnitTracker` ("Byt v čase") fetch the **entire `flats_archive` client-side** before
   they're usable (~30–60 s, grows ~19 k rows/month). Move them onto server-side
   aggregation (the analytics serving layer / RPCs) or lazy-load per-unit history.
   This is the single most important item before scaling the paid base.
2. **`sold_30d` / velocity / absorption empty everywhere.** Needs consecutive *real*
   monthly snapshots; history is backfilled, so it populates naturally over coming
   months. The AI assistant honestly discloses this. It's a selling point that
   currently shows nothing — worth surfacing the "maturing" state gracefully.
3. **AI assistant is not country-scoped** (returns CZ projects in SK mode). Decision
   for Boss: scope to active country, or label each project's country. Don't change
   blindly — cross-market answers may be intended.
4. **AI arithmetic errors** (LLM math). Mitigated by the disclaimer; Analytics/Reports
   are the source of truth.
5. **Export label "Projekty (187)"** = all-statuses vs the platform's "148 active" —
   correct data, mildly confusing label.

> **"Filling missing data" (Boss's words for now):** confirm with him exactly which —
> likely some of: project geo-coordinates (`project_coords`, for the map), images /
> descriptions, or fields empty for certain projects. **Ask him to point at a concrete
> example** before bulk work.

---

## 9. How to work (mechanics)

- **Verify frontend changes with the preview tools** (preview_start / preview_eval /
  preview_snapshot / preview_screenshot / preview_console_logs). Don't ask the Boss to
  check manually — verify and show proof. There's a dev launch config
  (`residata-dev` → `npm run dev --port 5173`).
- **For live, real-product QA**, log into the deployed site as the admin test account
  (`claude.agent@residata.sk`) via the magic-link flow in backend memory
  `reference_agent_ui_access`. (Pivot drag-drop can't be automated → use the DB for
  precise rankings.)
- **Tests:** the backend repo has a full pytest suite (`python3 -m pytest v2/tests/`).
  The frontend relies on lint + preview verification + CI; check `eslint` and the
  Vercel build.
- **Branch → PR → verify → you merge.** Frontend `main` auto-deploys; treat a merge as
  a production release.

---

## 10. Gotchas

- **Frontend `main` = production.** Every push to `main` redeploys the live site.
- There may be **uncommitted auto-generated SEO files** (`public/llms.txt`,
  `public/llms-full.txt`, `public/sitemap.xml`) from `prebuild`. They're machine-
  generated — don't hand-edit; commit via the build process if needed, otherwise leave.
- **Root README.md is stock Vite boilerplate** — ignore it. The real orientation is
  this file + `PLATFORM_AUDIT_2026-06-10.md` + `SESSION_2026-06-11.md`.
- Backend repo has a **mandatory first-turn onboarding ritual** in its `CLAUDE.md`
  (read `HANDOVER.md`, memory, `git log`). The frontend has no `CLAUDE.md` yet — this
  handoff stands in for it.
- VAT: SK 23 %, CZ 21 %; `cena_s_dph` (what the buyer pays) is authoritative. Prices may
  carry text sentinels "Na vyžiadanie" / "Po kolaudácii" — don't treat as 0/sold.

---

## Read next (in order)

1. **This file.**
2. `residata-frontend/PLATFORM_AUDIT_2026-06-10.md` — verified state + the enhancement backlog.
3. `residata-frontend/SESSION_2026-06-11.md` — recent frontend session notes.
4. Backend: `novostavby/v2/docs/ANALYTICS_REBUILD_PLAN.md` — the serving-layer plan the
   website is moving onto (active, phased).
5. Backend: `novostavby/CLAUDE.md` + `novostavby/HANDOVER.md` — full system rules + context.
6. Memory (auto-loaded each chat): `user_profile`, `feedback_work_style`,
   `project_analytics_rebuild`, `reference_agent_ui_access`, `reference_residata`,
   and the 3 PRAVIDLÁ in `MEMORY.md`.
