// Vercel serverless endpoint: /api/feedback/submit
//
// Receives a problem report / question / suggestion from the site-wide
// Feedback widget (every marketing page + every /app page), stores it in
// public.feedback, optionally saves a screenshot, and emails the admin.
//
// === Security model (mirrors /api/ai/chat-feedback) ===
//   1. Origin / Referer allowlist
//   2. Per-IP burst rate limit (6/min)
//   3. Body size cap (6 MB — room for one downscaled screenshot) + message cap
//   4. Category whitelist; message sanitized
//   5. Service-role insert (the anon key can never touch the table directly)
//
// Identity: a logged-in caller's id + account email + tier are resolved
// server-side from their Bearer token — never trusting a client tier.
//
// Project context: when filed from a project page the widget passes project_id;
// we resolve the project name server-side (better for triage + the email).
//
// Screenshot: optional `screenshot` data-URL → decoded, validated (jpeg/png/webp,
// ≤4 MB), uploaded to the PRIVATE feedback-attachments bucket as <id>.<ext>.
//
// Request:  POST { category, message, email?, page_path?, page_url?, app_lang?,
//                  project_id?, screenshot? (data:image/...;base64,...) }
//           Authorization: Bearer <token>   (optional)
// Response: 200 { ok:true, id } · 400 bad input · 403 origin · 429 rate · 500

import { createClient } from "@supabase/supabase-js";
import { isTrustedOrigin as checkTrustedOrigin } from "../_lib/origin.js";
import { feedbackHtml, sendEmail, FEEDBACK_CATEGORY_LABELS } from "../_lib/emails.js";

export const maxDuration = 15;

const MAX_BODY_BYTES  = 6 * 1024 * 1024;   // room for one downscaled screenshot
const MAX_MESSAGE_LEN = 4000;
const MAX_SHORT_LEN   = 500;   // page_url / user_agent
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_MIME_EXT  = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const VALID_CATEGORIES = new Set(["data", "bug", "website", "question", "idea", "other"]);

// Same allowlist as /api/ai/chat-feedback (kept in parity).
const ALLOWED_ORIGINS = [
  "https://residata.sk",
  "https://www.residata.sk",
  "https://residata-gamma.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
];
const isTrustedOrigin = (req) => checkTrustedOrigin(req, ALLOWED_ORIGINS);

// Mirror of src/lib/sanitize.js#cleanText — inline so this function doesn't
// reach into the React bundle (same reasoning as chat-feedback.js).
function cleanText(raw, { max = 200 } = {}) {
  if (typeof raw !== "string") return "";
  let s = raw;
  s = s.replace(/[<>]/g, "");
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " "); // strip control chars, KEEP \n \t
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

// Parse a `data:image/...;base64,xxxx` string → { buffer, ext, mime } or null.
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

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  if (req.headers["x-real-ip"]) return String(req.headers["x-real-ip"]).trim();
  return req.socket?.remoteAddress || "unknown";
}

const ipBuckets = new Map();
const IP_WINDOW_MS = 60_000;
const IP_LIMIT     = 6;
function ipRateCheck(ip) {
  const now = Date.now();
  let bucket = ipBuckets.get(ip);
  if (!bucket || now - bucket.start > IP_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    ipBuckets.set(ip, bucket);
  }
  bucket.count++;
  if (bucket.count > IP_LIMIT) {
    return { ok: false, retryAfterSec: Math.ceil((IP_WINDOW_MS - (now - bucket.start)) / 1000) };
  }
  return { ok: true };
}

export default async function handler(req, res) {
  try {
    return await handleInner(req, res);
  } catch (e) {
    console.error("[feedback] top-level crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}

async function handleInner(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  if (!isTrustedOrigin(req)) return res.status(403).json({ error: "untrusted origin" });

  const ip = clientIp(req);
  const ipGate = ipRateCheck(ip);
  if (!ipGate.ok) {
    res.setHeader("Retry-After", String(ipGate.retryAfterSec));
    return res.status(429).json({ error: "rate limit", retry_after_sec: ipGate.retryAfterSec });
  }

  const SUPABASE_URL        = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: "server misconfigured" });
  }

  // Body parse + size cap
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON body" }); }
  }
  if (!body || typeof body !== "object") return res.status(400).json({ error: "empty body" });
  if (JSON.stringify(body).length > MAX_BODY_BYTES) return res.status(413).json({ error: "body too large" });

  // Validate
  const category = String(body.category || "").trim();
  if (!VALID_CATEGORIES.has(category)) return res.status(400).json({ error: "invalid category" });
  const message = cleanText(body.message, { max: MAX_MESSAGE_LEN });
  if (message.length < 2) return res.status(400).json({ error: "message too short" });

  const page_path  = cleanText(body.page_path, { max: 200 }) || null;
  const page_url   = cleanText(body.page_url,  { max: MAX_SHORT_LEN }) || null;
  const app_lang   = body.app_lang === "en" ? "en" : "sk";
  const user_agent = String(req.headers["user-agent"] || "").slice(0, MAX_SHORT_LEN) || null;
  const project_id = (typeof body.project_id === "string" ? body.project_id.trim().slice(0, 120) : "") || null;

  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve identity from the Bearer token — never trust client tier.
  let user_id = null, user_tier = "anon", accountEmail = null;
  const authHeader = req.headers.authorization || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (jwt) {
    try {
      const { data: u } = await admin.auth.getUser(jwt);
      if (u?.user?.id) {
        user_id = u.user.id;
        accountEmail = u.user.email || null;
        const { data: prof } = await admin.from("user_profiles").select("tier, email").eq("id", user_id).maybeSingle();
        if (prof?.tier) user_tier = prof.tier;
        if (!accountEmail && prof?.email) accountEmail = prof.email;
      }
    } catch (e) {
      console.warn("[feedback] token resolve failed:", String(e?.message || e).slice(0, 120));
    }
  }
  const email = accountEmail || cleanEmail(body.email) || null;

  // Auto project context — when filed from a project page.
  let project_name = null;
  if (project_id) {
    try {
      const { data: proj } = await admin.from("projects").select("name").eq("id", project_id).maybeSingle();
      if (proj?.name) project_name = proj.name;
    } catch { /* non-fatal — keep the id */ }
  }

  // Insert (service role — bypasses RLS)
  const { data: inserted, error: insErr } = await admin
    .from("feedback")
    .insert({ category, message, email, user_id, user_tier, page_path, page_url, user_agent, app_lang, ip, project_id, project_name })
    .select("id, created_at")
    .single();

  if (insErr) {
    console.error("[feedback] insert failed", insErr.message);
    return res.status(500).json({ error: "could not save feedback" });
  }

  // Optional screenshot → private bucket, then link it on the row. Best-effort:
  // a failed upload must not fail the submit (the message is already saved).
  let hasAttachment = false;
  const img = parseDataUrlImage(body.screenshot);
  if (img) {
    const path = `${inserted.id}.${img.ext}`;
    const { error: upErr } = await admin.storage
      .from("feedback-attachments")
      .upload(path, img.buffer, { contentType: img.mime, upsert: true });
    if (!upErr) {
      hasAttachment = true;
      await admin.from("feedback").update({ attachment_path: path }).eq("id", inserted.id);
    } else {
      console.error("[feedback] screenshot upload failed:", upErr.message);
    }
  }

  // Email the admin — best-effort (row is the source of truth).
  const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "tkamhal@gmail.com";
  const GMAIL_FROM  = process.env.GMAIL_FROM  || "tkamhal@gmail.com";
  const WEB_URL     = process.env.WEB_URL     || "https://residata-gamma.vercel.app";
  if (GMAIL_APP_PASSWORD) {
    const meta = FEEDBACK_CATEGORY_LABELS[category] || FEEDBACK_CATEGORY_LABELS.other;
    try {
      await sendEmail({
        to: ADMIN_EMAIL,
        subject: `[Residata Feedback] ${meta.label} — ${email || "anonymous"}`,
        html: feedbackHtml(
          { category, message, email, user_tier, page_path, page_url, project_name, has_attachment: hasAttachment, created_at: inserted.created_at },
          WEB_URL
        ),
        from: GMAIL_FROM,
        gmailUser: GMAIL_FROM,
        gmailPassword: GMAIL_APP_PASSWORD,
      });
    } catch (e) {
      console.error("[feedback] notify email failed (row saved):", String(e?.message || e).slice(0, 160));
    }
  }

  return res.status(200).json({ ok: true, id: inserted.id });
}
