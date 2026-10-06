// Vercel serverless endpoint: welcome-user
//
// The welcome e-mail to a person who has just finished signing up. Called by
// the database (trg_notify_on_profile_complete, the moment the sign-up form is
// saved and the account auto-approved), by the approve-user Edge Function, and
// by the daily safety net (notify_auth_events.py) for anyone those missed —
// all three land HERE, so there is one template and one "already sent?" rule.
//   1. Validates the shared secret
//   2. Loads the user profile (service role)
//   3. Re-checks conditions (not already notified, has approved_at)
//   4. Sends the welcome e-mail in the language they signed up in
//   5. Marks approval_notified_at = now()
//
// Accounts an admin creates are stamped notified at creation (they get the
// optional "your account is ready" invitation instead), so this skips them.

import { approvedUserHtml, welcomeSubject, sendEmail } from "../_lib/emails.js";

export default async function handler(req, res) {
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

  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const userId = body.user_id || body.record?.id;
  if (!userId) {
    return res.status(400).json({ error: "missing user_id" });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
  const GMAIL_FROM = process.env.GMAIL_FROM || "tkamhal@gmail.com";
  const WEB_URL = process.env.WEB_URL || "https://residata.eu";

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || (!process.env.SMTP_PASS && !GMAIL_APP_PASSWORD)) {
    return res.status(500).json({ error: "server misconfigured: missing required env" });
  }

  // Fetch user
  const userResp = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}&select=*`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );
  if (!userResp.ok) {
    return res.status(500).json({ error: `supabase fetch failed: ${userResp.status}` });
  }
  const users = await userResp.json();
  if (!users.length) {
    return res.status(404).json({ error: "user not found" });
  }
  const user = users[0];

  // Guards
  if (!["free", "paid", "admin"].includes(user.tier)) {
    return res.status(200).json({ skipped: "tier not eligible", tier: user.tier });
  }
  if (!user.approved_at) {
    return res.status(200).json({ skipped: "not approved yet" });
  }
  if (user.approval_notified_at) {
    return res.status(200).json({ skipped: "already notified", at: user.approval_notified_at });
  }

  // Their language: the site's language when they asked for the sign-in code
  // (LoginModal → signIn → auth user_metadata.lang, set once, at sign-up).
  // Anything else — an older account, a lookup that fails — gets Slovak, the
  // site's home language. Never blocks the e-mail.
  let lang = "sk";
  try {
    const au = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`,
      { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } });
    if (au.ok) {
      const j = await au.json();
      if ((j?.user_metadata?.lang || j?.user?.user_metadata?.lang) === "en") lang = "en";
    }
  } catch { /* keep Slovak */ }

  try {
    await sendEmail({
      to: user.email,
      subject: welcomeSubject(lang),
      html: approvedUserHtml(user, WEB_URL, lang),
      gmailUser: GMAIL_FROM,
      gmailPassword: GMAIL_APP_PASSWORD,
    });
  } catch (e) {
    console.error("welcome-user SMTP failed:", e);
    return res.status(500).json({ error: "smtp failed", detail: String(e.message || e) });
  }

  const patchResp = await fetch(
    `${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}`,
    {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ approval_notified_at: new Date().toISOString() }),
    }
  );
  if (!patchResp.ok) {
    console.error("welcome-user mark failed:", patchResp.status, await patchResp.text());
    return res.status(500).json({ sent: true, markFailed: true });
  }

  return res.status(200).json({ ok: true, sentTo: user.email, tier: user.tier });
}
