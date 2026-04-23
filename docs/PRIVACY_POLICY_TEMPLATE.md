# Privacy Policy — TEMPLATE FOR LEGAL REVIEW

> ⚠️ **THIS IS NOT LEGAL ADVICE.** This template is a starting point for
> a lawyer to review, adapt, and approve for your jurisdiction. Do NOT
> publish this document as-is without legal review. GDPR / Slovak
> personal-data-protection law compliance is nuanced — get a
> specialist.
>
> Pass this to a Slovak lawyer with EU data-protection experience.
> Expected lawyer time: 1-2 hours. Expected cost: €150-400.

---

**Effective date:** TO BE FILLED
**Controller:** Residata (sole trader / s.r.o. — whichever entity)
**Contact:** residata@proton.me

## 1. What data we collect

### 1a. Account data
When you create an account we collect:
- Email address (required — for login and communication)
- Full name (required on profile completion)
- Company name (required on profile completion)
- Role / position (required — one of: developer, investor, bank, consultant, other)
- LinkedIn URL (optional)
- Phone number (optional)

### 1b. Usage data
- Session tokens (stored in your browser's localStorage)
- Page view events (which pages you visited, timestamps)
- AI summary generation log (what scope, token usage — not the content
  you saw)
- Admin action log (only if you hold admin role)

### 1c. Data we do NOT collect
- Payment card details (we don't accept card payments on-site)
- Location data
- Biometric data
- IP address (beyond transient rate-limiting — not persisted to DB)
- Browser fingerprint
- Third-party cookies

## 2. Why we process it

- **Email + name + company + role**: to create your account, gate
  access by tier, personalize monthly reports.
- **Session tokens**: to keep you signed in between visits.
- **Usage events**: for product analytics (what features users
  actually use). Aggregated; no individual profiling.
- **AI usage log**: for rate limiting and cost attribution. Retained
  90 days, then auto-deleted.
- **Admin action log**: forensic record in case of investigated
  incident. Retained 365 days, then auto-deleted.

Legal basis under GDPR Art. 6:
- Account data: **contract performance** (providing the service you
  signed up for).
- Usage / AI / admin logs: **legitimate interest** (running the
  service, preventing abuse).

## 3. Who we share it with

### Processors (our sub-contractors, under DPA)
- **Supabase Inc.** (EU region) — hosting our database
- **Vercel Inc.** — hosting the web application
- **Anthropic PBC** — processes anonymized aggregates only when you
  request an AI summary (we send market data aggregates, not your PII)
- **Google LLC** — Gmail SMTP for outgoing transactional emails

### NOT shared with
- Advertisers
- Data brokers
- Marketing networks
- Any third party we don't explicitly list above

## 4. Where data is stored

- Database (user profiles, logs): Supabase EU region (Frankfurt)
- Application hosting: Vercel (global CDN)
- Email transit: Google servers (US/EU)

We do not transfer data outside the EEA except via Standard Contractual
Clauses with our US sub-processors (Vercel, Anthropic, Google).

## 5. How long we keep it

- Account data: while your account exists + 30 days after deletion
- AI usage log: 90 days (auto-purged by scheduled job)
- Admin audit log: 365 days (auto-purged)
- Backups: rolling 30 days (Sheets), 7 days (Supabase Pro PITR)

## 6. Your rights (GDPR Art. 15-22)

- **Access**: request a copy of everything we store about you — email
  residata@proton.me. We respond within 30 days.
- **Correction**: fix inaccurate data through the profile settings or
  by emailing us.
- **Deletion** ("right to be forgotten"): email us from the account
  address. We delete within 30 days. Exception: logs we're legally
  required to keep (none for Residata at this time).
- **Portability**: request a machine-readable export (JSON / CSV).
- **Objection**: you can object to usage-analytics processing.
- **Complaint**: Slovak Data Protection Authority — https://dataprotection.gov.sk

## 7. Security

See `docs/SECURITY.md` in our repository for the technical detail:
- HTTPS + HSTS enforced
- Row-level security on every database table
- Authenticated API endpoints
- Quarterly credential rotation
- Daily automated backups

No system is 100% secure. If we discover a breach affecting your
personal data, we'll notify you within 72 hours (GDPR Art. 34).

## 8. Cookies

We use **only essential cookies** for authentication (the session
token). No analytics cookies, no advertising cookies, no third-party
tracking. Under GDPR this doesn't require a consent banner —
essential cookies are exempt — but we mention it for transparency.

## 9. Children

Residata is a B2B product for industry professionals. Not intended
for users under 16. We don't knowingly collect data from minors.

## 10. Changes

We'll announce material changes by email to registered users at
least 14 days before they take effect.

---

# Lawyer review checklist

- [ ] Does the controller identification meet GDPR Art. 13 requirements?
- [ ] Is the legal-basis classification (contract vs. legitimate interest) accurate for each data category?
- [ ] Are all sub-processors (Supabase, Vercel, Anthropic, Google)
      covered by signed DPAs? If not, flag for signing.
- [ ] Does Anthropic's data processing for AI summary require
      stronger language about AI model training ("Anthropic does not
      train on your data" — verify this is in their DPA)?
- [ ] Cookie policy — is the "only essential" classification
      defensible, or should we add a minimal banner anyway?
- [ ] Deletion workflow — confirm the 30-day SLA is operationally
      achievable.
- [ ] For Slovak market specifically: any additional zakon 18/2018 Z.z.
      requirements beyond GDPR?
- [ ] Recommended changes before publication.
