# Residata — manual setup checklist

Everything below must be done by you (human) — can't be automated from
the code. Estimated total time: **~45 minutes** if you sprint through.

Priority coding:
- 🔴 **Do this week** — real risk if skipped
- 🟡 **Do this month** — matters before first paying customer
- 🟢 **Do when subscription scales** — nice-to-have

---

# 🔴 1. Anthropic spending cap (2 min)

Biggest single protection against AI cost abuse. If all my application-
level rate limits fail due to a bug, Anthropic's dashboard cap is the
backstop that actually stops charges.

**Steps:**

1. Open https://console.anthropic.com/settings/limits
2. Find **"Monthly spend cap"**
3. Enter **€50** (or $55) for beta phase; raise to **€200** once paying customers exist
4. Enable email alerts at **50%, 80%, 100%** thresholds
5. Save

**Verify:** back on that page, you should see the cap amount + "Alerts enabled".

---

# 🔴 2. Two-factor auth on every critical account (~20 min total)

Enable 2FA on each of these. Preference order for the second factor:

> **Hardware key (YubiKey)** → **Authenticator app (Authy, 1Password, Google Authenticator)** → ~~SMS~~ (vulnerable to SIM-swap — avoid)

For each: save **recovery codes** in 1Password. Without them, losing
your phone = losing the account.

### 2a. GitHub (5 min) — this controls your code and indirectly every deploy

1. https://github.com/settings/security
2. "Two-factor authentication" → Configure
3. Choose **"Set up using an authenticator app"** (or Security key)
4. Scan QR code in Authenticator / add to 1Password
5. Enter 6-digit code to verify
6. **Download recovery codes** → save in 1Password under "GitHub recovery"
7. Optional but strongly recommended: also add a hardware key

**While you're here, also:**
- https://github.com/Tombarder/residata/settings/branches → Add rule for `main`:
  - ✅ Require a pull request before merging
  - ✅ Require status checks to pass (pick the new `CI` job once it's run at least once)
  - ✅ Require linear history
  - This means even if GitHub account is compromised, direct push-to-main is blocked.

### 2b. Vercel (3 min) — controls what's live + all env vars

1. https://vercel.com/account/settings/security
2. Two-Factor Authentication → Enable
3. Scan QR / add to 1Password
4. Verify with 6-digit code
5. Save recovery codes

### 2c. Supabase (3 min) — controls DB access

1. https://supabase.com/dashboard/account/security
2. "Multi-factor authentication" → Enable
3. Same flow as above; save recovery codes

**While here:** Supabase Dashboard → Project (mtclsrswxtjseewyrcbx) → Settings → Billing → set usage alerts (notifications when getting close to DB storage / bandwidth / MAU limits).

### 2d. Google / Gmail (3 min) — Sheets source + SMTP

1. https://myaccount.google.com/signinoptions/two-step-verification
2. "Turn on 2-Step Verification"
3. Add Authenticator app OR hardware key
4. Save backup codes in 1Password

**While here, additionally:**
- https://myaccount.google.com/security → check "Recent security events" — any device you don't recognize, sign it out.
- Gmail → Settings → See all → Accounts and Import → "Send mail as" — confirm only expected aliases exist (no attacker added one).

### 2e. Anthropic (2 min) — AI billing

1. https://console.anthropic.com/settings/security
2. Enable MFA
3. Save recovery codes

### 2f. Password manager (5 min) — root of trust for everything above

1. 1Password (or whichever you use) → Settings → Security
2. Enable 2FA on the password manager ITSELF
3. If you use 1Password: turn on "Travel Mode" when crossing borders (optional)

### 2g. Domain registrar (if residata.sk is registered)

1. Log in to registrar (e.g. Websupport.sk, Namecheap, whoever registered it)
2. Account security → Enable 2FA
3. Also turn on **"Domain lock"** / "Registrar lock" — prevents transfer to another registrar without explicit unlock. This stops the worst-case "attacker redirects residata.sk to a phishing site" attack.

---

# 🔴 3. Google Sheets sharing audit (5 min)

The Residata master sheet is your single source of truth. If it's
deleted, wrongly shared, or corrupted, the monthly pipeline breaks.

1. Open the sheet: https://docs.google.com/spreadsheets/d/1OHb9eddPYCYfqmw81fOVIqWybVtnkIvc2YGgG9ZT3Rc/edit
2. Click "Share" (top-right)
3. Review the access list:
   - **You (owner)**: OK
   - **"Anyone with the link"**: SHOULD BE OFF. If on, change to "Restricted" (only people added explicitly).
   - **Any editor you don't recognize**: remove them. Only editors you explicitly trust should remain.
   - **Viewer/commenter access**: review the same way.
4. Bottom of share dialog → "General access" → set to **"Restricted"**.
5. Under "Advanced settings" if present: disable "Editors can change permissions and share" (so editors can't invite new people without your approval).

---

# 🟡 4. Apply the 2 new SQL migrations (5 min)

These add forensic + retention infrastructure. The code is in this
repo; you need to run them once against your production DB.

### 4a. Admin audit log

1. Supabase Dashboard → SQL editor → new query
2. Paste contents of `supabase_migration_2026_04_admin_audit.sql`
3. Run
4. Verify: "admin_audit_log table created successfully" (or similar)

### 4b. Log retention (pg_cron auto-prune)

1. First enable the extension:
   Supabase Dashboard → Database → Extensions → search "pg_cron" → Enable
2. Then run the migration:
   SQL editor → new query → paste `supabase_migration_2026_04_log_retention.sql`
3. Run
4. Verify: `SELECT * FROM cron.job;` should show 2 jobs:
   `prune-ai-usage-log` and `prune-admin-audit-log`

---

# 🟡 5. Sheets automatic backup (3 min setup, runs nightly)

Detailed step-by-step is in `docs/sheets-backup.gs` at the top of
the file. Summary:

1. Open the master sheet → Extensions → Apps Script
2. Paste contents of `docs/sheets-backup.gs`
3. Save, run `backupNow` once manually to grant permissions
4. Add time-based trigger (daily, 3-4am)
5. Confirm "Residata backups" folder appears in your Drive with
   today's .xlsx copy

---

# 🟡 6. Supabase DB backup (first time, then weekly)

If you're on Supabase Free plan, this is your ONLY backup. Pro plan
has daily auto-backups with 7-day retention.

**First-time setup (5 min):**

1. Install pg_dump:
   - macOS: `brew install postgresql@16`
   - Linux: `sudo apt install postgresql-client-16`
2. Get DB password:
   Supabase Dashboard → Project Settings → Database → "Reset database password"
   Copy the new password into 1Password under "Residata Supabase DB"
3. Test run:
   ```sh
   cd ~/residata/residata
   export SUPABASE_DB_PASSWORD='paste-the-password-here'
   ./scripts/backup-supabase.sh
   ```
4. Check `backups/` folder — a .sql.gz file should exist

**Weekly:**
- Re-run the script
- Copy latest `.sql.gz` to 1Password secure notes OR iCloud Drive OR encrypted USB
- Don't commit backups to git (already git-ignored)

---

# 🟡 7. Secrets rotation (once every 90 days)

Calendar reminder: rotate these 4 secrets quarterly. Takes 10 min total.

### ANTHROPIC_API_KEY
1. https://console.anthropic.com/settings/keys
2. Create new key → copy
3. Vercel Dashboard → Project Settings → Environment Variables → edit `ANTHROPIC_API_KEY` → paste new value → Save
4. Also update the `app_secrets` DB row (Supabase SQL editor):
   ```sql
   UPDATE app_secrets SET value = 'sk-ant-...new-key...' WHERE key = 'ANTHROPIC_API_KEY';
   ```
5. Delete OLD key in Anthropic dashboard
6. Test: trigger an AI summary in the app; should work

### SUPABASE_SECRET_KEY (service-role)
1. Supabase Dashboard → Project Settings → API → service_role
2. "Regenerate" (breaking — any other service using the old key will lose access)
3. Copy new key → Vercel env → Save → redeploy
4. Monitor Vercel function logs for any 401s from internal calls

### GMAIL_APP_PASSWORD
1. https://myaccount.google.com/apppasswords
2. Delete the old "Residata" app password
3. Generate a new one
4. Update Vercel env + `app_secrets` (SQL UPDATE as above)

### CRON_SECRET
1. Generate a random string: `openssl rand -base64 32`
2. Update Vercel env var `CRON_SECRET` to the new value
3. Redeploy (monthly cron next month will use it)

---

# 🟢 8. When you hit these thresholds (future)

### First paying customer
- [ ] Write Privacy Policy (give a lawyer `docs/PRIVACY_POLICY_TEMPLATE.md` to review — don't write it yourself)
- [ ] Sign DPA with Supabase (template on their site)
- [ ] Create `/privacy` + `/terms` pages on the website

### First enterprise / bank / regulated customer
- [ ] Commission a penetration test (€2-5k, 1-2 weeks)
- [ ] Prepare SOC 2 readiness with a consultant (€10-20k, 3-6 months)

### 100+ paying customers
- [ ] Move Supabase to Pro plan (~$25/mo) — automated daily backups + PITR
- [ ] Enable Sentry or similar error monitoring
- [ ] Set up a bug bounty on Intigriti or HackerOne

---

# Done? How to verify

After completing the 🔴 items (Anthropic cap + 2FA + Sheets audit):

1. Anthropic dashboard shows active spending cap + alerts → ✅
2. GitHub / Vercel / Supabase / Google / Anthropic / password manager: 2FA on, recovery codes in 1Password → ✅
3. Master Google Sheet: access list is known-good, no "anyone with link" → ✅
4. SQL migrations applied; `SELECT * FROM cron.job;` returns 2 rows → ✅
5. Sheets backup: first run produced a file in "Residata backups" Drive folder → ✅

Then you can tell any future enterprise customer honestly: "We do 2FA
on all critical accounts, have automated daily Sheet backups, run
security-header hardening, gate all paid data with RLS, and have a
spending cap on every paid API."

---

# When you need to find this info again

This checklist lives at `docs/SETUP_CHECKLIST.md` in the repo.
Detailed security posture is at `docs/SECURITY.md`.
Both can be shown to a pentester / auditor / enterprise procurement
team as evidence of mature security practice.
