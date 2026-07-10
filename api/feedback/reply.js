// Vercel serverless endpoint: /api/feedback/reply
//
// Lets an ADMIN answer a feedback message — the reply is emailed to the user
// through Residata and stored on the row (so the user also sees it in their
// "My messages" tab). The "better version" of one-click reply.
//
// === Security ===
//   1. Origin allowlist
//   2. Per-IP burst limit
//   3. ADMIN-ONLY: the caller's Bearer token is resolved server-side and must
//      map to user_profiles.tier='admin'. No token / not admin → rejected. This
//      is the gate that stops anyone using this to send mail as Residata.
//
// Request:  POST { feedback_id, reply }   Authorization: Bearer <admin token>
// Response: 200 { ok:true, emailed } · 400 · 401 · 403 · 404 · 429 · 500

import { createClient } from "@supabase/supabase-js";
import { isTrustedRequest as isTrustedOrigin } from "../_lib/origin.js";
import { feedbackReplyHtml, sendEmail } from "../_lib/emails.js";

export const maxDuration = 15;
const MAX_REPLY_LEN = 4000;

function cleanText(raw, { max = 200 } = {}) {
  if (typeof raw !== "string") return "";
  let s = raw;
  s = s.replace(/[<>]/g, "");
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
  s = s.replace(/^[=+@]+/, "");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  if (req.headers["x-real-ip"]) return String(req.headers["x-real-ip"]).trim();
  return req.socket?.remoteAddress || "unknown";
}
const ipBuckets = new Map();
const IP_WINDOW_MS = 60_000, IP_LIMIT = 20;
function ipRateCheck(ip) {
  const now = Date.now();
  let b = ipBuckets.get(ip);
  if (!b || now - b.start > IP_WINDOW_MS) { b = { start: now, count: 0 }; ipBuckets.set(ip, b); }
  b.count++;
  if (b.count > IP_LIMIT) return { ok: false, retryAfterSec: Math.ceil((IP_WINDOW_MS - (now - b.start)) / 1000) };
  return { ok: true };
}

const isUuid = (s) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export default async function handler(req, res) {
  try { return await handleInner(req, res); }
  catch (e) { console.error("[feedback-reply] crash", e); return res.status(500).json({ error: "internal error" }); }
}

async function handleInner(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (!isTrustedOrigin(req)) return res.status(403).json({ error: "untrusted origin" });
  const ip = clientIp(req);
  const gate = ipRateCheck(ip);
  if (!gate.ok) { res.setHeader("Retry-After", String(gate.retryAfterSec)); return res.status(429).json({ error: "rate limit" }); }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
  const GMAIL_FROM = process.env.GMAIL_FROM || "tkamhal@gmail.com";
  const WEB_URL = process.env.WEB_URL || "https://residata.eu";
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return res.status(500).json({ error: "server misconfigured" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON" }); } }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "empty body" });

  const feedback_id = body.feedback_id;
  if (!isUuid(feedback_id)) return res.status(400).json({ error: "invalid feedback_id" });
  const reply = cleanText(body.reply, { max: MAX_REPLY_LEN });
  if (reply.length < 2) return res.status(400).json({ error: "reply too short" });

  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // ── Admin gate ──
  const authHeader = req.headers.authorization || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!jwt) return res.status(401).json({ error: "auth required" });
  const { data: u } = await admin.auth.getUser(jwt);
  if (!u?.user?.id) return res.status(401).json({ error: "invalid session" });
  const { data: prof } = await admin.from("user_profiles").select("tier").eq("id", u.user.id).maybeSingle();
  if (prof?.tier !== "admin") return res.status(403).json({ error: "admin only" });

  // ── Load the feedback row (need the user's email + original message) ──
  const { data: fb, error: fbErr } = await admin
    .from("feedback").select("id, email, message, app_lang").eq("id", feedback_id).maybeSingle();
  if (fbErr) return res.status(500).json({ error: "lookup failed" });
  if (!fb) return res.status(404).json({ error: "feedback not found" });
  if (!fb.email) return res.status(400).json({ error: "no email to reply to" });

  // ── Send the reply email (this is the point of the endpoint — must succeed) ──
  if (!GMAIL_APP_PASSWORD) return res.status(500).json({ error: "email not configured" });
  try {
    await sendEmail({
      to: fb.email,
      subject: fb.app_lang === "en" ? "Reply from Residata" : "Odpoveď od Residata",
      html: feedbackReplyHtml(reply, fb.message, WEB_URL, fb.app_lang === "en" ? "en" : "sk", feedback_id),
      from: GMAIL_FROM, gmailUser: GMAIL_FROM, gmailPassword: GMAIL_APP_PASSWORD,
    });
  } catch (e) {
    console.error("[feedback-reply] SMTP failed:", String(e?.message || e).slice(0, 160));
    return res.status(500).json({ error: "email send failed" });
  }

  // ── Record the reply as an admin message in the thread (after the send) ──
  const { error: msgErr } = await admin
    .from("feedback_messages")
    .insert({ conversation_id: feedback_id, sender: "admin", author_id: u.user.id, body: reply });
  if (msgErr) {
    // Email went out but the record failed — surface it; the admin can retry.
    console.error("[feedback-reply] message insert failed:", msgErr.message);
    return res.status(200).json({ ok: true, emailed: true, recordFailed: true });
  }

  return res.status(200).json({ ok: true, emailed: fb.email });
}
