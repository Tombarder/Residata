// Vercel serverless endpoint: admin-notify — Boss hears about every new account.
//
// Boss 2026-10-07: "i want to receive an email every time a new user registers".
// Two kinds, each sent ONCE per person and stamped on the profile so a retry never
// sends it twice:
//
//   kind "completed" (default) — the sign-up form is finished. Fired by the
//     AFTER INSERT/UPDATE trigger on user_profiles (notify_on_profile_complete, via
//     pg_net) a second after the profile is saved; the nightly safety net
//     (novostavby notify_auth_events.py) re-calls it for any profile still
//     unstamped. Stamp: admin_notified_at. By then the BEFORE trigger has approved
//     the account (Free), so the e-mail is FYI.
//   kind "unfinished" — the person confirmed the e-mail code and left the profile
//     form. Called by pg_cron (notify-unfinished-signups, every 15 min, for accounts
//     confirmed over an hour ago) and by the same nightly safety net. Stamp:
//     unfinished_notified_at. Skipped once the profile is finished: then the
//     "completed" e-mail is the one that says it.
//
// An account an admin created never reaches either: create-user stamps both.

import { adminDigestHtml, adminDigestSubject, adminUnfinishedHtml, adminUnfinishedSubject, sendEmail } from "../_lib/emails.js";
import { isPersonalEmail } from "../../src/lib/emailValidation.js";
import { trialRefusal, trialIntentValid } from "../../src/lib/trialRules.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  // ─── Method + secret check ───
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }
  const incomingSecret = req.headers["x-webhook-secret"] || "";
  const expectedSecret = process.env.WEBHOOK_SECRET || "";
  if (!expectedSecret) {
    return res.status(500).json({ error: "server misconfigured: WEBHOOK_SECRET not set" });
  }
  if (incomingSecret !== expectedSecret) {
    return res.status(401).json({ error: "invalid webhook secret" });
  }

  // ─── Parse body (Vercel gives us JSON automatically if content-type matches) ───
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); }
  catch { return res.status(400).json({ error: "invalid json" }); }
  const userId = body.user_id || body.record?.id;
  if (!userId || !UUID.test(String(userId))) {
    return res.status(400).json({ error: "missing or invalid user_id" });
  }
  const kind = body.kind === "unfinished" ? "unfinished" : "completed";
  const stampField = kind === "unfinished" ? "unfinished_notified_at" : "admin_notified_at";

  // ─── Env ───
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "tkamhal@gmail.com";
  const GMAIL_FROM = process.env.GMAIL_FROM || "tkamhal@gmail.com";
  const WEB_URL = process.env.WEB_URL || "https://residata.eu";

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || (!process.env.SMTP_PASS && !GMAIL_APP_PASSWORD)) {
    return res.status(500).json({ error: "server misconfigured: missing required env" });
  }
  const auth = { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` };

  // ─── Fetch user ───
  const userResp = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}&select=*`, { headers: auth });
  if (!userResp.ok) {
    return res.status(500).json({ error: `supabase fetch failed: ${userResp.status}` });
  }
  const users = await userResp.json();
  if (!users.length) {
    return res.status(404).json({ error: "user not found" });
  }
  const user = users[0];

  // ─── Re-check conditions (idempotency) ───
  if (kind === "completed" && !user.profile_completed) {
    return res.status(200).json({ skipped: "profile not completed yet" });
  }
  if (kind === "unfinished" && user.profile_completed) {
    return res.status(200).json({ skipped: "profile completed — the sign-up e-mail covers it" });
  }
  if (user[stampField]) {
    return res.status(200).json({ skipped: "admin already notified", kind, at: user[stampField] });
  }

  // ─── What else Boss wants to know: language, trial, confirmed, colleagues, count ───
  // None of it may stop the e-mail: each lookup falls back to "unknown".
  let meta = {};
  let confirmedAt = null;
  try {
    const au = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: auth });
    if (au.ok) {
      const j = await au.json();
      const u = j?.user || j || {};
      meta = u.user_metadata || {};
      confirmedAt = u.email_confirmed_at || u.confirmed_at || null;
    }
  } catch { /* unknown */ }
  if (kind === "unfinished" && !confirmedAt) {
    // asked for a code and never typed it: not a sign-up yet (and often a typo or a bot)
    return res.status(200).json({ skipped: "e-mail not confirmed" });
  }

  let colleagues = [];
  const domain = String(user.email || "").split("@")[1] || "";
  if (domain && !isPersonalEmail(user.email)) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?email_domain=eq.${encodeURIComponent(domain)}&id=neq.${userId}&select=email&order=created_at.asc&limit=20`, { headers: auth });
      if (r.ok) colleagues = (await r.json()).map((x) => x.email).filter(Boolean);
    } catch { /* none known */ }
  }

  let accountNo = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?select=id&created_at=lte.${encodeURIComponent(user.created_at)}`,
      { headers: { ...auth, Prefer: "count=exact", Range: "0-0" } });
    const total = Number(String(r.headers.get("content-range") || "").split("/")[1]);
    if (Number.isFinite(total) && total > 0) accountNo = total;
  } catch { /* unknown */ }

  const extra = {
    lang: meta.lang === "en" ? "en" : meta.lang ? "sk" : null,
    // welcome-user starts a requested trial in parallel with this call: whichever
    // order they run in, the e-mail says what is true
    trialRunning: Boolean(user.trial_until && new Date(user.trial_until).getTime() > Date.now()),
    trialIntent: trialIntentValid(meta.trial_intent_at) && !trialRefusal(user),
    colleagues,
    accountNo,
    confirmedAt,
  };

  // ─── Send ───
  try {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: kind === "unfinished" ? adminUnfinishedSubject(user) : adminDigestSubject(user),
      html: kind === "unfinished" ? adminUnfinishedHtml(user, WEB_URL, extra) : adminDigestHtml(user, WEB_URL, extra),
      gmailUser: GMAIL_FROM,
      gmailPassword: GMAIL_APP_PASSWORD,
    });
  } catch (e) {
    // Email failed — don't mark notified so the safety net retries later
    console.error("admin-notify SMTP failed:", e);
    return res.status(500).json({ error: "smtp failed", detail: String(e.message || e) });
  }

  // ─── Mark notified ───
  const patchResp = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}`,
    {
      method: "PATCH",
      headers: { ...auth, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ [stampField]: new Date().toISOString() }),
    }
  );
  if (!patchResp.ok) {
    // Email sent but mark failed — worst case one duplicate from the safety net
    console.error("admin-notify mark failed:", patchResp.status, await patchResp.text());
    return res.status(500).json({ sent: true, markFailed: true, status: patchResp.status });
  }

  return res.status(200).json({ ok: true, kind, sentTo: ADMIN_EMAIL, user: user.email });
}
