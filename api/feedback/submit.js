// Vercel serverless endpoint: /api/feedback/submit
//
// Two modes:
//   · NEW conversation  — no conversation_id → create a feedback (conversation)
//     row + its first message.
//   · CONTINUE          — conversation_id present → append a user message to an
//     existing conversation the caller owns (logged-in only).
// Either way: optional screenshot, and the admin is emailed.
//
// Security: origin allowlist + per-IP rate limit + sanitise + service-role write.
// Identity (and conversation ownership) resolved server-side from the Bearer token.

import { createClient } from "@supabase/supabase-js";
import { isTrustedRequest as isTrustedOrigin } from "../_lib/origin.js";
import { feedbackHtml, feedbackReceiptHtml, sendEmail, FEEDBACK_CATEGORY_LABELS } from "../_lib/emails.js";

export const maxDuration = 15;

const MAX_BODY_BYTES  = 6 * 1024 * 1024;
const MAX_MESSAGE_LEN = 4000;
const MAX_SHORT_LEN   = 500;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_MIME_EXT  = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const VALID_CATEGORIES = new Set(["data", "bug", "website", "question", "idea", "other"]);


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
function cleanEmail(raw, { max = 254 } = {}) {
  if (typeof raw !== "string") return "";
  const s = raw.trim().slice(0, max).toLowerCase();
  if (!s) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return "";
  return s;
}
function parseDataUrlImage(raw) {
  if (typeof raw !== "string" || !raw.startsWith("data:")) return null;
  const m = raw.match(/^data:([\w/+.-]+);base64,(.+)$/s);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = IMAGE_MIME_EXT[mime];
  if (!ext) return null;
  let buffer;
  try { buffer = Buffer.from(m[2], "base64"); } catch { return null; }
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null;
  return { buffer, ext, mime };
}
const isUuid = (s) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function clientIp(req) {
  // x-real-ip FIRST: on Vercel it's the platform-set, non-spoofable connecting IP. The
  // leftmost x-forwarded-for token is client-claimed (spoofable → bypass the per-IP cap).
  if (req.headers["x-real-ip"]) return String(req.headers["x-real-ip"]).trim();
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}
const ipBuckets = new Map();
const IP_WINDOW_MS = 60_000, IP_LIMIT = 6;
function ipRateCheck(ip) {
  const now = Date.now();
  let b = ipBuckets.get(ip);
  if (!b || now - b.start > IP_WINDOW_MS) { b = { start: now, count: 0 }; ipBuckets.set(ip, b); }
  b.count++;
  if (b.count > IP_LIMIT) return { ok: false, retryAfterSec: Math.ceil((IP_WINDOW_MS - (now - b.start)) / 1000) };
  return { ok: true };
}

// Upload an optional image to <message_id><suffix>.<ext> and return the path.
async function uploadShot(admin, img, messageId, suffix = "") {
  if (!img) return null;
  const path = `${messageId}${suffix}.${img.ext}`;
  const { error } = await admin.storage.from("feedback-attachments").upload(path, img.buffer, { contentType: img.mime, upsert: true });
  if (error) { console.error("[feedback] image upload failed:", error.message); return null; }
  return path;
}

// Attach a manual screenshot + an auto page-screenshot to a message.
async function attachToMessage(admin, messageId, img, autoImg) {
  const update = {};
  const p1 = await uploadShot(admin, img, messageId, "");
  if (p1) update.attachment_path = p1;
  const p2 = await uploadShot(admin, autoImg, messageId, "_auto");
  if (p2) update.auto_screenshot_path = p2;
  if (Object.keys(update).length) await admin.from("feedback_messages").update(update).eq("id", messageId);
  return update;
}

export default async function handler(req, res) {
  try { return await handleInner(req, res); }
  catch (e) { console.error("[feedback] crash", e); return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) }); }
}

async function handleInner(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (!isTrustedOrigin(req)) return res.status(403).json({ error: "untrusted origin" });
  const ip = clientIp(req);
  const gate = ipRateCheck(ip);
  if (!gate.ok) { res.setHeader("Retry-After", String(gate.retryAfterSec)); return res.status(429).json({ error: "rate limit", retry_after_sec: gate.retryAfterSec }); }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) return res.status(500).json({ error: "server misconfigured" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON body" }); } }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "empty body" });
  if (JSON.stringify(body).length > MAX_BODY_BYTES) return res.status(413).json({ error: "body too large" });

  const message = cleanText(body.message, { max: MAX_MESSAGE_LEN });
  if (message.length < 2) return res.status(400).json({ error: "message too short" });
  const conversation_id = body.conversation_id;
  const img = parseDataUrlImage(body.screenshot);
  const autoImg = parseDataUrlImage(body.auto_screenshot);
  const diagnostics = (body.diagnostics && typeof body.diagnostics === "object" && !Array.isArray(body.diagnostics)) ? body.diagnostics : null;
  const app_lang = body.app_lang === "en" ? "en" : "sk";

  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  // Resolve identity (never trust client tier).
  let user_id = null, user_tier = "anon", accountEmail = null;
  const authHeader = req.headers.authorization || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (jwt) {
    try {
      const { data: u } = await admin.auth.getUser(jwt);
      if (u?.user?.id) {
        user_id = u.user.id; accountEmail = u.user.email || null;
        const { data: prof } = await admin.from("user_profiles").select("tier, email").eq("id", user_id).maybeSingle();
        if (prof?.tier) user_tier = prof.tier;
        if (!accountEmail && prof?.email) accountEmail = prof.email;
      }
    } catch (e) { console.warn("[feedback] token resolve failed:", String(e?.message || e).slice(0, 120)); }
  }

  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "tkamhal@gmail.com";
  const GMAIL_FROM  = process.env.GMAIL_FROM  || "tkamhal@gmail.com";
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
  const WEB_URL = process.env.WEB_URL || "https://residata.eu";
  const page_path = cleanText(body.page_path, { max: 200 }) || null;
  const page_url  = cleanText(body.page_url,  { max: MAX_SHORT_LEN }) || null;

  async function notifyAdmin(category, projectName, email, isReply) {
    if (!process.env.SMTP_PASS && !GMAIL_APP_PASSWORD) return;
    const meta = FEEDBACK_CATEGORY_LABELS[category] || FEEDBACK_CATEGORY_LABELS.other;
    try {
      await sendEmail({
        to: ADMIN_EMAIL,
        subject: `[Residata Feedback]${isReply ? " ↩" : ""} ${meta.label} — ${email || "anonymous"}`,
        html: feedbackHtml({ category, message, email, user_tier, page_path, page_url, project_name: projectName, has_attachment: !!img, is_reply: isReply, created_at: new Date().toISOString() }, WEB_URL),
        from: GMAIL_FROM, gmailUser: GMAIL_FROM, gmailPassword: GMAIL_APP_PASSWORD,
      });
    } catch (e) { console.error("[feedback] notify email failed:", String(e?.message || e).slice(0, 160)); }
  }

  // Confirmation receipt TO the user: "we got your message". Only for a brand-new
  // conversation, and only when we have an address. Non-fatal — a failed receipt
  // must never fail the submit (the message is already saved + admin notified).
  async function notifyUser(category, toEmail, convId) {
    if (!GMAIL_APP_PASSWORD || !toEmail) return;
    try {
      await sendEmail({
        to: toEmail,
        subject: app_lang === "en" ? "We received your message — Residata" : "Máme tvoju správu — Residata",
        html: feedbackReceiptHtml({ category, message }, WEB_URL, app_lang === "en" ? "en" : "sk", convId),
        from: GMAIL_FROM, gmailUser: GMAIL_FROM, gmailPassword: GMAIL_APP_PASSWORD,
      });
    } catch (e) { console.error("[feedback] user receipt failed:", String(e?.message || e).slice(0, 160)); }
  }

  // ── CONTINUE an existing conversation ──
  if (conversation_id !== undefined && conversation_id !== null && conversation_id !== "") {
    if (!isUuid(conversation_id)) return res.status(400).json({ error: "invalid conversation_id" });
    if (!user_id) return res.status(401).json({ error: "sign in to continue a conversation" });
    const { data: conv, error: cErr } = await admin
      .from("feedback").select("id, user_id, category, project_name, email").eq("id", conversation_id).maybeSingle();
    if (cErr) return res.status(500).json({ error: "lookup failed" });
    if (!conv) return res.status(404).json({ error: "conversation not found" });
    if (conv.user_id !== user_id) return res.status(403).json({ error: "not your conversation" });

    const { data: msg, error: mErr } = await admin
      .from("feedback_messages").insert({ conversation_id, sender: "user", author_id: user_id, body: message, diagnostics })
      .select("id").single();
    if (mErr) { console.error("[feedback] message insert failed", mErr.message); return res.status(500).json({ error: "could not save message" }); }
    await attachToMessage(admin, msg.id, img, autoImg);

    await notifyAdmin(conv.category, conv.project_name, conv.email || accountEmail, true);
    return res.status(200).json({ ok: true, id: conversation_id, message_id: msg.id });
  }

  // ── NEW conversation ──
  const category = String(body.category || "").trim();
  if (!VALID_CATEGORIES.has(category)) return res.status(400).json({ error: "invalid category" });
  const email = accountEmail || cleanEmail(body.email) || null;
  const user_agent = String(req.headers["user-agent"] || "").slice(0, MAX_SHORT_LEN) || null;
  const project_id = (typeof body.project_id === "string" ? body.project_id.trim().slice(0, 120) : "") || null;

  let project_name = null;
  if (project_id) {
    try { const { data: proj } = await admin.from("projects").select("name").eq("id", project_id).maybeSingle(); if (proj?.name) project_name = proj.name; }
    catch { /* non-fatal */ }
  }

  const { data: conv, error: insErr } = await admin
    .from("feedback")
    .insert({ category, message, email, user_id, user_tier, page_path, page_url, user_agent, app_lang, ip, project_id, project_name })
    .select("id, created_at").single();
  if (insErr) { console.error("[feedback] insert failed", insErr.message); return res.status(500).json({ error: "could not save feedback" }); }

  // First message of the thread (kept in sync with the conversation opener).
  const { data: msg, error: mErr } = await admin
    .from("feedback_messages")
    .insert({ conversation_id: conv.id, sender: "user", author_id: user_id, body: message, created_at: conv.created_at, diagnostics })
    .select("id").single();
  if (mErr) console.error("[feedback] opener message insert failed", mErr.message);

  if (msg?.id) {
    const up = await attachToMessage(admin, msg.id, img, autoImg);
    if (up.attachment_path) await admin.from("feedback").update({ attachment_path: up.attachment_path }).eq("id", conv.id);
  }

  await notifyAdmin(category, project_name, email, false);
  await notifyUser(category, email, conv.id);   // "we received your message" receipt
  return res.status(200).json({ ok: true, id: conv.id });
}
