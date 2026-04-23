# Residata — Security posture

Last reviewed: 2026-04-23

This document captures the security-relevant decisions and state of
the Residata application. Structured around the three pillars the
founder considers mission-critical:

1. **Cost abuse** — nobody drains our paid APIs (Anthropic, SMTP, Supabase)
2. **Data theft** — nobody sees paid data without paying
3. **Takedown / hack** — nobody takes the site down, steals user data,
   hijacks Google Sheets, or modifies code

---

## TL;DR scorecard

| Pillar | Protection | State |
|---|---|---|
| **1. Cost abuse** | `/api/ai/summary` requires auth (no anon) | ✅ Done |
| | Server-side Origin check (not just CORS) | ✅ Done |
| | Per-IP rate limit (10/min) | ✅ Done |
| | Per-user tier limits (hour + day) | ✅ Done |
| | Input/output token caps | ✅ Done |
| | **Hard monthly cap in Anthropic dashboard** | ⚠️ **YOU MUST CONFIGURE** |
| **2. Data theft** | Supabase RLS on flats / user_profiles / app_secrets | ✅ Verified |
| | Publishable key is safe in browser | ✅ By design |
| | Service-role key server-side only | ✅ Verified |
| | No PII in URL params or client logs | ✅ Verified |
| **3. Takedown / hack** | HTTPS + HSTS preload | ✅ Done |
| | CSP + X-Frame + Referrer + Permissions headers | ✅ Done |
| | Input sanitization (XSS, CSV injection) | ✅ Done |
| | Admin endpoint server-side role check | ✅ Done |
| | CORS allowlist + Origin check | ✅ Done |
| | **2FA on GitHub, Vercel, Supabase, Google, Anthropic** | ⚠️ **YOU MUST ENABLE** |
| | Backups of Supabase + Google Sheets | ⚠️ See [backups](#backups-and-recovery) |

---

# Pillar 1 — Cost abuse

## What paid APIs we use

| API | What for | Current cost exposure |
|---|---|---|
| **Anthropic** (`claude-sonnet-4-5`) | AI exec-summary on `/api/ai/summary` | ~$0.025 per call, capped per user |
| **Supabase** (Postgres + Auth + Storage) | DB, auth, RLS | Usage-based, generous free tier |
| **Gmail SMTP** (via `nodemailer`) | Transactional emails (welcome, monthly reports) | Free up to 500/day; abuse risks account suspension not $$ |
| **Google Sheets API** (in scraper) | Source of truth for data pipeline | Free tier generous; runs on GitHub Actions |

**Firecrawl, OpenAI, Stripe are NOT used.** No other paid APIs in the codebase.

## `/api/ai/summary` — Anthropic cost protection (detailed)

This is the only endpoint that spends money per call. Hardening stack:

### Layer 1 — Auth required (NO anon tier)
No session token → `401 authentication required`. Closes the biggest
vector: random internet traffic burning credit without creating an
account. Attackers have to sign up first, and sign-up is gated by:
- Email domain validation (blocks disposable addresses)
- Manual admin approval before `tier` upgrade to anything useful

### Layer 2 — Server-side Origin / Referer check
CORS is browser-only. curl / Postman / server-side scripts bypass CORS
entirely. We check `Origin` and `Referer` headers server-side; if
neither claims one of our trusted domains, response is `403 untrusted
origin`. Can be spoofed by a determined attacker, but stops casual
script abuse cold.

### Layer 3 — Per-IP rate limit (in-memory)
10 requests/minute per IP. Ephemeral (survives only within a warm
function instance) but absorbs burst attacks before they hit Anthropic.

### Layer 4 — Per-user tier limits (DB-backed, persistent)
| Tier | Per hour | Per day | Worst-case daily cost |
|---|---|---|---|
| `admin` | 60 | 500 | $12.50 |
| `paid` | 30 | 200 | $5.00 |
| `free` | 5 | 20 | $0.50 |
| `pending` | 0 | 0 | $0 — hard-blocked |

Counters live in `ai_usage_log` table. Lookup failure = fail-CLOSED
(reject call) not fail-open.

### Layer 5 — Input/output bounds
- Input: 16 KB JSON max
- Output: 900 tokens max
- Worst-case single call: ~$0.025

### Layer 6 — **HARD MONTHLY CAP IN ANTHROPIC DASHBOARD** ⚠️ Manual

This is the ONLY absolute backstop. Application-level limits fail open
if there's a bug. Anthropic's dashboard-level cap does NOT.

**Action required — you must do this once:**

1. Log in to https://console.anthropic.com
2. Usage → Limits → Monthly spend cap
3. Set to a dollar value (recommendation: **€50/month**
   while beta, **€200/month** once paying customers exist)
4. Enable email alerts at 50%, 80%, 100% of cap

Without this, a bug or successful attack could theoretically run up
$1000s of credit before anyone notices. With it, the cap is hard —
Anthropic stops serving requests.

## Gmail SMTP (monthly reports)

Gmail free tier: 500 emails/day. Residata sends at most ~20/month (one
per report subscriber). No abuse risk unless SMTP credentials leak
(credential rotation section below).

## Supabase quota

Free tier limits: 500 MB database, 5 GB bandwidth, 50k monthly active
users. Residata well under all. Usage alert is set in Supabase dash —
configure if not already (Project Settings → Billing → Alerts).

## What I CANNOT protect against

- Distributed attack from 1000s of IPs with 1000s of free accounts
  created automatically. Mitigation requires adding a CAPTCHA on signup
  and/or payment at signup. Not yet needed at current scale.
- Insider abuse (your own admin account being misused). Mitigation is
  the audit log — see [Pillar 3](#pillar-3--full-takedown-protection).

---

# Pillar 2 — Data theft prevention

## Public vs private data

### Public (anon + AI crawlers see this — intended)
| Data | Why public |
|---|---|
| Project names, district, developer | Registry is marketing |
| Project-level aggregates (% sold, avg €/m²) | Proof of product |
| Homepage hero metrics (5,101 units, 90 projects) | Marketing claim |
| Sample insight cards | Demo what we deliver |
| Historical project_snapshots (aggregate level) | Public time-series |

### Private (auth + RLS gated — only paid can access)
| Data | Protection layer | Verified |
|---|---|---|
| `flats` (unit-level: prices, areas, unit IDs) | Supabase RLS by tier | ✅ anon returns 0 rows (probed) |
| `user_profiles` (names, emails, company, LinkedIn) | Supabase RLS own-row only | ✅ anon returns 0 rows |
| `app_secrets` (API keys) | Service-role only | ✅ anon blocked |
| `ai_usage_log` | Service-role only | ✅ anon blocked |
| Custom reports, PDFs | Auth-gated + personalized generation | ✅ behind login |
| Historical unit-level time-series | RLS-gated same as `flats` | ✅ anon blocked |

## RLS audit (probed 2026-04-23)

| Table | Anon read | Anon write |
|---|---|---|
| `projects` | ✅ yes | ❌ no |
| `project_snapshots` | ✅ yes | ❌ no |
| `metrics` | ✅ yes | ❌ no |
| `early_access_stats` | ✅ yes | ❌ no |
| `flats` | ❌ 0 rows | ❌ no |
| `user_profiles` | ❌ 0 rows | ❌ no |
| `ai_usage_log` | ❌ 0 rows | ❌ no |
| `app_secrets` | ❌ 0 rows | ❌ no |

All policies behave as intended.

### TODO (not yet verified — needs session tokens to probe)
- `flats` access for `tier=free` with `chosen_project_id` (should see ONLY that project)
- `flats` access for `tier=paid` (should see everything)
- `user_profiles` own-row read for authenticated user (should see own + NO others)
- `user_profiles.tier` column — admin only?

These need interactive session testing. Not currently automated.

## API data exposure

All data endpoints return 401/403 for unauthorized:
- `/api/ai/summary` — auth required (enforced 2026-04-23)
- `/api/admin/delete-user` — auth + `tier=admin` required server-side
- `/api/cron/monthly-reports` — secret bearer token OR Vercel cron header
- `/api/webhooks/*` — internal only, no user-callable surface

## Publishable key in browser — intended

`VITE_SUPABASE_PUBLISHABLE_KEY` is safe to ship to browsers. It's what
RLS evaluates. RLS does the actual gating — the key alone gives you
nothing sensitive.

Service-role key is server-side only (Vercel env var), never bundled
into the browser.

---

# Pillar 3 — Full takedown protection

This is the pillar YOU have the most control over, because most attack
vectors are account-level and can't be mitigated in code.

## What can go wrong — attack tree

```
Someone wants to destroy Residata. Paths:
  │
  ├─ Compromise your GitHub → push malicious commit → Vercel deploys it
  │    Mitigation: 2FA + hardware key on GitHub
  │
  ├─ Compromise your Vercel → redeploy malicious build, steal env vars
  │    Mitigation: 2FA on Vercel
  │
  ├─ Compromise your Supabase → access full DB with service-role key
  │    Mitigation: 2FA on Supabase + env var rotation
  │
  ├─ Compromise your Google account → delete source Sheets, steal data
  │    Mitigation: 2FA on Google + sharing audit + backup Sheets
  │
  ├─ Compromise your Anthropic / email account → rotate keys, block
  │    Mitigation: 2FA + unique password manager entry
  │
  ├─ Compromise domain registrar → redirect residata.sk elsewhere
  │    Mitigation: registrar 2FA + domain lock
  │
  ├─ Supply chain attack on npm package → code shipped in build
  │    Mitigation: Dependabot alerts + minimal dep surface (4 runtime)
  │
  ├─ XSS / CSRF / SQLi from the application itself
  │    Mitigation: CSP, sanitize.js, Bearer auth, parameterized queries (all done)
  │
  └─ Physical theft of your laptop with logged-in sessions
       Mitigation: FileVault / BitLocker + short session lifetimes
```

## Account 2FA — this is the #1 ask of you

Enable 2FA on EVERY account listed below. Preferably hardware key
(YubiKey) on the most critical ones; authenticator app otherwise.
SMS 2FA is weak — avoid if possible (SIM swap attack).

| Account | Why critical | Current state |
|---|---|---|
| **GitHub** (Tombarder) | Controls code → deploys | ⚠️ verify |
| **Vercel** | Controls what's live, holds env vars | ⚠️ verify |
| **Supabase** | DB access + service-role key | ⚠️ verify |
| **Google** (Gmail) | Sheets source data + SMTP | ⚠️ verify |
| **Anthropic** | Pays for AI + holds API key | ⚠️ verify |
| **Domain registrar** (if residata.sk registered) | DNS control | ⚠️ verify |
| **1Password / password manager** | Root of trust for above | ⚠️ verify |

**Your task this week:** audit all these, enable 2FA, save recovery codes.

## What's already hardened in code

### Transport
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- HTTPS enforced by Vercel (automatic)

### Browser-side attacks
- `Content-Security-Policy` — tight allowlist (self + fonts + Unsplash + Supabase)
- `X-Frame-Options: DENY` — no iframe embedding
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` — camera, mic, geo, payment, USB all disabled
- `Cross-Origin-Opener-Policy: same-origin`

### Application attacks
- Input sanitization (`src/lib/sanitize.js`): strips HTML tags, control
  chars, CSV formula triggers, non-http(s) URL schemes
- CompleteProfile form wired through sanitization at intake
- LoginModal email through `validateBusinessEmail`
- XSS-safe rendering (React auto-escapes JSX)
- SQL injection-safe (Supabase client parameterizes)
- CSRF-safe (Bearer token auth, not cookies; SameSite not relevant)

### API attacks
- CORS allowlist (wildcard removed)
- Server-side Origin check
- Admin endpoint: `auth.getUser()` + tier check + self-delete block
- Rate limits on AI endpoint
- Cron endpoint: secret + `x-vercel-cron` fallback

### Infrastructure
- Vercel: HTTPS automatic, DDoS protection at platform level
- Supabase: EU region (GDPR-friendly), RLS on all sensitive tables
- Dependencies: only 4 runtime (react, react-dom, @supabase/supabase-js,
  nodemailer), all current majors, no known CVEs at review time

## Google Sheets — specific notes

The new-build data pipeline reads from Google Sheets (`1OHb9eddPYCYfqmw81fOVIqWybVtnkIvc2YGgG9ZT3Rc`).
This is your **single source of truth** — if it's deleted or corrupted,
the monthly sync breaks.

### Sheets hardening — you must do
1. **Sharing audit**: Who has edit access? Aim for editors = you only.
   Everyone else: viewer or no access.
2. **No "anyone with link"** access. Explicit invitees only.
3. **Version history enabled** (default Google behaviour — keep it).
4. **Export backup monthly**: automate a daily export to a separate
   Google Drive folder or local backup. Can be done with:
   - Apps Script: scheduled trigger creates `.xlsx` copy
   - Or Takeout export monthly
5. **Service account used by scraper** has read-only scope if possible.
   Currently: verify the credentials.json permissions in
   `~/novostavby/credentials.json`.

## Backups and recovery

Current state: **fragile**. Single source of truth in Sheets; no
automated DB backup beyond Supabase's internal point-in-time recovery.

### Supabase
Supabase Pro plan has daily auto-backups with 7-day retention. Free
tier: backup is on you.

**Action**: once subscription starts, export DB weekly:
```sh
pg_dump "postgresql://postgres:[PASSWORD]@db.mtclsrswxtjseewyrcbx.supabase.co:5432/postgres" \
  > backup-$(date +%Y%m%d).sql
```
Store in encrypted off-site location.

### Google Sheets
See [Google Sheets section](#google-sheets--specific-notes) above.

### Code
GitHub is the backup. But you should have a **local working clone** at
all times so that if GitHub goes down or account is compromised, you
can restart from somewhere.

## Secrets rotation schedule

These should rotate at least every 90 days, sooner on any suspicion:

| Secret | Where stored | Rotation effort |
|---|---|---|
| `ANTHROPIC_API_KEY` | Vercel env + `app_secrets` table | Low — regenerate in Anthropic dash, update Vercel |
| `SUPABASE_SECRET_KEY` (service-role) | Vercel env | Medium — regen in Supabase, update all places |
| `GMAIL_APP_PASSWORD` | Vercel env + `app_secrets` | Low — Google account → App passwords |
| `CRON_SECRET` | Vercel env | Low — generate new random string, update |

## Audit log (not yet implemented)

Currently no record of admin actions (`delete-user`, tier changes).
Should be added before first paying customer who depends on auditable
access control.

### Proposed schema
```sql
CREATE TABLE admin_audit_log (
  id          bigserial primary key,
  actor_id    uuid references auth.users(id),
  action      text not null,         -- 'delete_user', 'grant_admin', etc.
  target_id   uuid,                  -- user affected
  payload     jsonb,
  ip          inet,
  user_agent  text,
  created_at  timestamptz default now()
);
```

## Incident response

If you suspect a breach:

1. **Change all passwords** for accounts listed in [2FA section](#account-2fa--this-is-the-1-ask-of-you).
2. **Rotate all secrets** listed in [secrets rotation](#secrets-rotation-schedule).
3. **Supabase → Auth → Users → Sign out all users** (revokes active sessions).
4. **Snapshot logs**: `ai_usage_log`, Supabase auth events, Vercel deployment history, Google Sheets version history. Before anything rolls off.
5. **Notify affected users within 72 hours** (GDPR requirement).
6. **Write a retrospective**: add findings to this doc's change log.

Contact: residata@proton.me

---

## Change log

- **2026-04-23**: Hardened `/api/ai/summary` to require auth (removed anon tier), added server-side Origin check, fail-closed on rate-limit lookup error, hard-block pending users. Documented three-pillar posture.
- **2026-04-23**: Initial security posture. Security headers via vercel.json, input sanitization (`src/lib/sanitize.js`), RLS probe across 8 tables, dependency audit.
