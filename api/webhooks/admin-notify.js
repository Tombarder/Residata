// Vercel serverless endpoint: admin-notify
//
// FREEMIUM MODEL — no admin gate:
// Fires from the AFTER-INSERT/UPDATE trigger on user_profiles when a new
// signup completes their profile. By the time this endpoint runs, the
// BEFORE-UPDATE trigger has already auto-approved them (tier='free',
// approved_at=now()). So this email is purely FYI — "new free signup,
// here's who they are, optionally bump to paid if you know them".
//
// This endpoint:
//   1. Validates shared secret
//   2. Loads user profile (service role — bypasses RLS)
//   3. Skips if already notified (idempotency)
//   4. Sends FYI email via Gmail SMTP
//   5. Marks admin_notified_at = now()

import { adminDigestHtml, sendEmail } from "../_lib/emails.js";

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
  const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  const userId = body.user_id || body.record?.id;
  if (!userId) {
    return res.status(400).json({ error: "missing user_id" });
  }

  // ─── Env ───
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  const APPROVAL_HMAC_SECRET = process.env.APPROVAL_HMAC_SECRET;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "tkamhal@gmail.com";
  const GMAIL_FROM = process.env.GMAIL_FROM || "tkamhal@gmail.com";
  const WEB_URL = process.env.WEB_URL || "https://residata.eu";

  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !APPROVAL_HMAC_SECRET || (!process.env.SMTP_PASS && !GMAIL_APP_PASSWORD)) {
    return res.status(500).json({ error: "server misconfigured: missing required env" });
  }

  // ─── Fetch user ───
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

  // ─── Re-check conditions (idempotency only; no tier gate in freemium) ───
  if (!user.profile_completed) {
    return res.status(200).json({ skipped: "profile not completed yet" });
  }
  if (user.admin_notified_at) {
    return res.status(200).json({ skipped: "admin already notified", at: user.admin_notified_at });
  }

  // ─── Send email (FYI about new free signup) ───
  try {
    await sendEmail({
      to: ADMIN_EMAIL,
      subject: `[Residata] New free signup: ${user.email}`,
      html: adminDigestHtml(user, WEB_URL, SUPABASE_URL, APPROVAL_HMAC_SECRET),
      gmailUser: GMAIL_FROM,
      gmailPassword: GMAIL_APP_PASSWORD,
    });
  } catch (e) {
    // Email failed — don't mark notified so cron safety-net retries later
    console.error("admin-notify SMTP failed:", e);
    return res.status(500).json({ error: "smtp failed", detail: String(e.message || e) });
  }

  // ─── Mark notified ───
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
      body: JSON.stringify({ admin_notified_at: new Date().toISOString() }),
    }
  );
  if (!patchResp.ok) {
    // Email sent but mark failed — worst case duplicate email on cron fallback
    console.error("admin-notify mark failed:", patchResp.status, await patchResp.text());
    return res.status(500).json({ sent: true, markFailed: true, status: patchResp.status });
  }

  return res.status(200).json({ ok: true, sentTo: ADMIN_EMAIL, user: user.email });
}
