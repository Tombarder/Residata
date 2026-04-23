# Residata — Security posture

Last reviewed: 2026-04-23

This document captures the security-relevant decisions and state of
the Residata application so it can be audited, improved, or handed to
a third-party reviewer without having to re-derive context.

---

## TL;DR

| Layer | State | Notes |
|---|---|---|
| **Transport** | ✅ HTTPS enforced, HSTS preloadable | `Strict-Transport-Security` header set to 2y with `includeSubDomains; preload` |
| **Auth** | ✅ Magic-link (passwordless) via Supabase | No passwords to steal. Short-lived session tokens. |
| **Row security** | ✅ RLS enabled; anon tested per-table | See [RLS section](#rls-row-level-security) below |
| **Admin ops** | ✅ Token + role verified server-side | `api/admin/delete-user.js` double-checks tier=admin |
| **Rate limits** | ✅ Tier-based DB counter + per-IP in-memory | On `/api/ai/summary` |
| **CORS** | ✅ Allowlist of known origins | Wildcard `*` removed |
| **Input sanitization** | ✅ Client-side at intake | `src/lib/sanitize.js` handles CompleteProfile form |
| **Security headers** | ✅ CSP, X-Frame, Referrer, Permissions, HSTS | See [Headers section](#security-headers) |
| **Dependency surface** | ✅ 4 runtime deps, all current majors | See [Dependencies section](#dependencies) |
| **Penetration test** | ❌ Not done | Recommended before first enterprise customer |
| **GDPR audit** | ⚠️ Not formalized | Personal data stored (names, emails) — needs Privacy Policy + DPA |
| **SOC 2 / ISO** | ❌ Not done | Only needed when selling to regulated institutions |

---

## Threat model

Residata's attack surface:

1. **Anonymous web traffic** on public pages — everything under `/`, `/live`, `/sample`, `/use-cases`, `/pricing`, `/contact`
2. **Authenticated users** with `tier` in `{ pending, free, paid, admin }`
3. **API endpoints** at `/api/ai/summary`, `/api/admin/delete-user`, `/api/cron/monthly-reports`, `/api/webhooks/*`
4. **Supabase project** (Postgres DB + Auth + Storage)
5. **Scheduled job** (Vercel Cron → `/api/cron/monthly-reports`) triggered 1st of month

Who might attack:
- Opportunistic internet scanners (credential stuffing bots, XSS fuzzers)
- Competitors trying to scrape data
- A user abusing AI endpoint for free compute
- A disgruntled beta tester trying to escalate privileges

Assets to protect:
- **User accounts and PII** (names, emails, company, LinkedIn)
- **Flats / projects dataset** (the product itself)
- **OpenAI/Anthropic API credit** (cost)
- **Founder brand** (a public breach would be worse than the data loss)

---

## RLS (Row-Level Security)

Tested by direct probe against the REST API with anon key on 2026-04-23.

| Table | Anon read | Anon write | Policy intent |
|---|---|---|---|
| `projects` | ✅ yes | ❌ no | Public registry — marketing pages read |
| `project_snapshots` | ✅ yes | ❌ no | Public time-series — Analytics page reads |
| `metrics` | ✅ yes | ❌ no | Public KPIs — Ticker + MarketPulse read |
| `early_access_stats` | ✅ yes | ❌ no | Public marketing stat |
| `flats` | ❌ 0 rows | ❌ no | Unit-level data is paid — RLS blocks anon |
| `user_profiles` | ❌ 0 rows | ❌ no | Never readable except own row |
| `ai_usage_log` | ❌ 0 rows | ❌ no | Service-role only |
| `app_secrets` | ❌ 0 rows | ❌ no | Service-role only (API keys) |

Probed with:
```bash
curl "https://mtclsrswxtjseewyrcbx.supabase.co/rest/v1/<table>?select=*&limit=1" \
     -H "apikey: <publishable>"
```

All policies behave as intended.

**TODO** — not yet verified:
- `flats` access for `tier=free` with chosen_project_id (should see only that project's flats)
- `flats` access for `tier=paid` (should see all)
- `user_profiles` own-row access for authenticated users (should be writable, other rows not)
- Admin-role access to `user_profiles.tier` column mutations

These require real session tokens to probe; can be done by signing in as each tier and walking the API with the browser devtools.

---

## Security headers

Applied via `vercel.json` on every response:

| Header | Value | Protects against |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | Protocol downgrade attacks |
| `Content-Security-Policy` | Allowlist of sources (see vercel.json) | XSS, data exfiltration |
| `X-Frame-Options` | `DENY` | Clickjacking via iframe embedding |
| `X-Content-Type-Options` | `nosniff` | MIME confusion attacks |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Leak of URL query params to third parties |
| `Permissions-Policy` | Camera, mic, geolocation, payment, USB disabled | Unintended browser API access |
| `Cross-Origin-Opener-Policy` | `same-origin` | Process isolation (Spectre / COOP) |

Plus for API paths:
- `X-Robots-Tag: noindex, nofollow`
- `Cache-Control: no-store`

---

## Rate limiting

`/api/ai/summary` is the main cost exposure (calls Anthropic API).

Two stacked layers:

### Layer 1 — per-IP (in-memory, serverless)
- 10 requests / minute per client IP
- Lives in the function instance — ephemeral across cold starts
- Primary purpose: absorb bursts before they reach the DB

### Layer 2 — per-user (DB-backed, persistent)
- `tier = admin`: 60/hour, 500/day
- `tier = paid`: 30/hour, 200/day
- `tier = free`: 5/hour, 20/day
- `tier = anon`: 3/hour, 10/day (bucketed against all anon combined)
- Counters in `ai_usage_log` table

Other API endpoints:
- `/api/admin/delete-user` — no rate limit; token+role-gated and low call volume
- `/api/cron/monthly-reports` — invoked only by Vercel Cron, secret-gated
- `/api/webhooks/*` — internal, no user-callable surface

---

## Input sanitization

`src/lib/sanitize.js` provides four helpers used at intake:

- `cleanText(raw, {max})` — strips `<`, `>`, control chars, leading CSV formula triggers (`=+@`), collapses whitespace, enforces max length
- `cleanUrl(raw, {max})` — rejects non-http(s) schemes (blocks `javascript:`, `data:`, `file:`)
- `cleanPhone(raw, {max})` — keeps digits, +, spaces, parentheses, dashes only
- `cleanEmail(raw, {max})` — lowercase + regex validation

Applied in `CompleteProfile.jsx` to name, company, position, LinkedIn URL, phone.

Email input on `LoginModal.jsx` goes through `validateBusinessEmail()` which also enforces business-email domain rules.

---

## CORS

`/api/ai/summary` echoes `Access-Control-Allow-Origin` only for origins in the explicit allowlist:
- `https://residata-gamma.vercel.app`
- `https://residata.sk` (reserved for future custom domain)
- `https://www.residata.sk`
- `http://localhost:5173` (Vite dev)
- `http://localhost:3000` (alt dev)

Any other Origin: no ACAO header → browser blocks the call.

---

## Dependencies

Runtime (shipped to production):

| Package | Version | Role | Known issues |
|---|---|---|---|
| `@supabase/supabase-js` | ^2.45.4 | DB client, auth | None current |
| `nodemailer` | ^6.9.16 | Email sender (server-only) | None current |
| `react` | ^19.2.4 | UI framework | None current |
| `react-dom` | ^19.2.4 | UI framework | None current |

**Attack surface: 4 runtime deps.** No `lodash`, no `moment`, no transitive chains known for supply-chain attacks. This is an unusually tight dep tree for a production SPA, and it's deliberate.

Dev dependencies (not shipped): `vite`, `eslint`, `@vitejs/plugin-react`, `globals`, `@types/*`. Irrelevant to runtime security.

**Periodic action**: run `npm audit` on package-lock changes (or enable Dependabot). Not yet automated.

---

## Known remaining risks

### Must address before first enterprise customer

1. **Penetration test** — No third-party pentest has been done. Estimate €2–5k for a small-scope test covering auth flow, API endpoints, and Supabase integration. Deliverable is a report with findings you can show to enterprise procurement.

2. **GDPR / legal** — Personal data (name, email, company, LinkedIn) is stored on EU-hosted infra (Supabase EU region). Minimum needed:
   - Privacy Policy page
   - Cookie banner (if any tracking beyond analytics is added)
   - Data Processing Agreement (DPA) with Supabase — template exists, just needs signing
   - Retention policy (auto-delete old `ai_usage_log` after N days?)
   - Right-to-be-forgotten procedure (delete-user endpoint exists but needs documented SLA)

### Nice-to-have hardening

3. **Audit log** — No record of admin-panel actions (`delete-user` calls). Add `admin_audit_log` table + insert on every admin action.

4. **Session rotation** — Currently relying on Supabase defaults (1 hour access token, 30-day refresh). No forced rotation on password change (N/A — passwordless) or on suspicious activity.

5. **Anomaly alerts** — No alert on spikes in `ai_usage_log`, failed-login rates, or 403s. Simple Slack webhook would catch abuse early.

6. **Secrets rotation** — Anthropic API key, SMTP password, Supabase service-role key live in Vercel environment variables. No rotation schedule. Should rotate every 90 days as policy.

7. **Dependabot / Snyk** — Not configured. CVE alerts would land in GitHub Issues automatically.

### Out of scope (won't fix)

- **Email account hijack** — if someone's email is compromised they can receive magic links and log in. Standard limitation of email-based auth. Mitigation: user's responsibility.
- **DDoS** — Vercel's platform-level protection is the only layer. Adequate for current scale.
- **Physical security** — Not applicable (SaaS, no physical infra).

---

## Incident response

Not formalized. Minimum plan if a breach is suspected:

1. Rotate Anthropic API key and Supabase service-role key in Vercel env
2. Revoke all active sessions via Supabase Dashboard → Auth → Users → Sign out all
3. Snapshot the `ai_usage_log` and auth logs before they roll off
4. Email affected users within 72 hours (GDPR notification requirement)
5. Retrospective — write up root cause, add mitigation to this doc

Contact: residata@proton.me

---

## Change log

- 2026-04-23: Initial security posture documented. Applied: security headers in vercel.json, CORS allowlist + per-IP rate limit on `/api/ai/summary`, input sanitization in `CompleteProfile`, RLS probe across 8 tables.
