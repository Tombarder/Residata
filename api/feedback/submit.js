// Vercel serverless endpoint: /api/feedback/submit
//
// Receives a problem report / question / suggestion from the site-wide
// Feedback widget (every marketing page + every /app page), stores it in
// public.feedback, and emails the admin so it's seen as soon as it lands.
//
// === Security model (mirrors /api/ai/chat-feedback) ===
//   1. Origin / Referer allowlist
//   2. Per-IP burst rate limit (feedback shouldn't burst → tight, 6/min)
//   3. Body size cap (16 KB) + message length cap (4000 chars)
//   4. Category whitelist; message sanitized (strips HTML / control / CSV-formula)
//   5. Service-role insert (bypasses RLS — the anon key can NEVER touch the
//      feedback table directly; this endpoint is the only write path)
//
// Identity: if the caller sends a Supabase Bearer token (logged-in user), we
// resolve their REAL id + account email + tier server-side — never trusting a
// client-supplied tier. Anonymous visitors may leave an optional contact email.
//
// Request:  POST { category, message, email?, page_path?, page_url?, app_lang? }
//           Authorization: Bearer <supabase access token>   (optional)
// Response: 200 { ok:true, id } · 400 bad input · 403 origin · 429 rate · 500

import { createClient } from "@supabase/supabase-js";
import { isTrustedOrigin as checkTrustedOrigin } from "../_lib/origin.js";
import { feedbackHtml, sendEmail, FEEDBACK_CATEGORY_LABELS } from "../_lib/emails.js";

export const maxDuration = 10;

const MAX_BODY_BYTES  = 16 * 1024;
const MAX_MESSAGE_LEN = 4000;
const MAX_SHORT_LEN   = 500;   // page_url / user_agent

const VALID_CATEGORIES = new Set(["data", "bug", "website", "question", "idea", "other"]);

// Trusted origins — same list as /api/ai/chat-feedback (kept in parity).
const ALLOWED_ORIGINS = [
  "https://residata.sk",
  "https://www.residata.sk",
  "https://residata-gamma.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
];
const isTrustedOrigin = (req) => checkTrustedOrigin(req, ALLOWED_ORIGINS);

// Mirror of src/lib/sanitize.js#cleanText — kept inline so this Vercel function
// doesn't reach into the React bundle (same reasoning as chat-feedback.js).
function cleanText(raw, { max = 200 } = {}) {
  if (typeof raw !== "string") return "";
  let s = raw;
  s = s.replace(/[<>]/g, "");
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " "); // strip control chars but KEEP \n (\x0A) and \t
  s = s.replace(/^[=+@]+/, "");
  s = s.replace(/[ \t]+/g, " ");        // collapse spaces/tabs, keep newlines
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

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  if (req.headers["x-real-ip"]) return String(req.headers["x-real-ip"]).trim();
  return req.socket?.remoteAddress || "unknown";
}

// In-memory IP rate limit. Vercel cold starts reset it — fine for burst defense.
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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }
  if (!isTrustedOrigin(req)) {
    return res.status(403).json({ error: "untrusted origin" });
  }
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
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "empty body" });
  }
  if (JSON.stringify(body).length > MAX_BODY_BYTES) {
    return res.status(413).json({ error: "body too large" });
  }

  // Validate
  const category = String(body.category || "").trim();
  if (!VALID_CATEGORIES.has(category)) {
    return res.status(400).json({ error: "invalid category" });
  }
  const message = cleanText(body.message, { max: MAX_MESSAGE_LEN });
  if (message.length < 2) {
    return res.status(400).json({ error: "message too short" });
  }
  const page_path = cleanText(body.page_path, { max: 200 }) || null;
  const page_url  = cleanText(body.page_url,  { max: MAX_SHORT_LEN }) || null;
  const app_lang  = body.app_lang === "en" ? "en" : "sk";
  const user_agent = String(req.headers["user-agent"] || "").slice(0, MAX_SHORT_LEN) || null;

  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolve identity from the Bearer token (logged-in) — never trust client tier.
  let user_id = null, user_tier = "anon", accountEmail = null;
  const authHeader = req.headers.authorization || "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (jwt) {
    try {
      const { data: u } = await admin.auth.getUser(jwt);
      if (u?.user?.id) {
        user_id = u.user.id;
        accountEmail = u.user.email || null;
        const { data: prof } = await admin
          .from("user_profiles").select("tier, email").eq("id", user_id).maybeSingle();
        if (prof?.tier) user_tier = prof.tier;
        if (!accountEmail && prof?.email) accountEmail = prof.email;
      }
    } catch (e) {
      // Bad/expired token → treat as anonymous; the report still lands.
      console.warn("[feedback] token resolve failed:", String(e?.message || e).slice(0, 120));
    }
  }
  // Logged-in → use the account email; anon → the optional contact they typed.
  const email = accountEmail || cleanEmail(body.email) || null;

  // Insert (service role — bypasses RLS)
  const { data: inserted, error: insErr } = await admin
    .from("feedback")
    .insert({ category, message, email, user_id, user_tier, page_path, page_url, user_agent, app_lang, ip })
    .select("id, created_at")
    .single();

  if (insErr) {
    console.error("[feedback] insert failed", insErr.message);
    return res.status(500).json({ error: "could not save feedback" });
  }

  // Email the admin — best-effort. The row is already saved (source of truth);
  // a transient SMTP hiccup must NOT make the user's submit fail.
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
          { category, message, email, user_tier, page_path, page_url, created_at: inserted.created_at },
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
