// Vercel serverless endpoint: /api/ai/chat-feedback
//
// Records a user's thumbs-up / thumbs-down on a single assistant turn
// in the ai_chat_log table. Wired from the Chat UIs (ChatAssistant +
// FloatingChat) where each assistant message renders 👍/👎 buttons.
//
// Why a separate endpoint vs. piggy-backing on /api/ai/chat:
// the chat endpoint runs the model + writes user+assistant rows on
// every call. Feedback is a follow-up event minutes later, often
// from a different request altogether ("ah this answer was wrong").
// Splitting them keeps each handler single-purpose and lets us
// rate-limit them independently if abuse appears.
//
// === Security model ===
//
// The caller never authenticates — anonymous users can rate too.
// Authorisation is by SESSION_ID matching:
//   · client sends { log_id, session_id, feedback, note }
//   · server looks up the log row by id, checks session_id matches
//   · only then does the update fire
// log_id and session_id are both UUID v4s (~122 bits each). An
// attacker would need to know BOTH to forge feedback on someone
// else's row — combined ~244 bits, unguessable in practice. Good
// enough for a "thumbs button" surface where the worst case is
// fake rating noise (admin reviews qualitatively anyway).
//
// Additional gates:
//   1. Origin / Referer allowlist (same as /api/ai/chat)
//   2. Per-IP rate limit — feedback shouldn't burst, so this is
//      tight (10/min). Burst attempts get 429.
//   3. Body size cap (4 KB)
//   4. Only role='assistant' rows can be rated. The endpoint joins
//      on role to enforce.
//
// Request:
//   PATCH /api/ai/chat-feedback
//   { log_id, session_id, feedback: 'good'|'bad', note?: string }
//
// Response:
//   200  → { ok: true }
//   400  → bad input
//   403  → untrusted origin / session_id mismatch / non-assistant row
//   404  → log_id not found
//   429  → rate limit
//   500  → server error
//
// Idempotent: re-rating the same row overwrites the previous rating
// (and updates feedback_at). This matches user mental model — they
// click 👎 then change to 👍, the new rating wins.

import { createClient } from "@supabase/supabase-js";

export const maxDuration = 10;
const MAX_BODY_BYTES = 4 * 1024;
const MAX_NOTE_LEN   = 280;

// F-112: mirror of src/lib/sanitize.js#cleanText kept inline here so the
// Vercel function doesn't reach into the React bundle (no other api/* file
// does that today; safer to duplicate the 8 lines than to be the first
// to cross the boundary and risk a Vercel deploy that resolves it weirdly).
// Keep in sync with src/lib/sanitize.js if cleanText ever changes.
function cleanText(raw, { max = 280 } = {}) {
  if (typeof raw !== "string") return "";
  let s = raw;
  s = s.replace(/[<>]/g, "");                  // strip HTML tag chars
  s = s.replace(/[\x00-\x1F\x7F]/g, " ");      // strip control chars
  s = s.replace(/^[=+@]+/, "");                // strip CSV-formula triggers
  s = s.replace(/\s+/g, " ").trim();           // collapse whitespace
  if (s.length > max) s = s.slice(0, max);
  return s;
}

// Trusted origins — copy of the list in /api/ai/chat for parity.
const ALLOWED_ORIGINS = [
  "https://residata.sk",
  "https://www.residata.sk",
  "https://residata-gamma.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
];
function isTrustedOrigin(req) {
  const origin  = req.headers.origin  || "";
  const referer = req.headers.referer || "";
  if (origin && ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return true;
  if (referer && ALLOWED_ORIGINS.some(o => referer.startsWith(o))) return true;
  // Same-origin Vercel preview deployments
  if (referer && referer.includes("residata-") && referer.endsWith(".vercel.app")) return true;
  if (origin  && origin.includes("residata-")  && origin.endsWith(".vercel.app"))  return true;
  return false;
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  if (req.headers["x-real-ip"]) return String(req.headers["x-real-ip"]).trim();
  return req.socket?.remoteAddress || "unknown";
}

// In-memory IP rate limit. Vercel cold starts reset this — fine for
// burst protection (real abuse hits the same warm instance).
const ipBuckets = new Map();
const IP_WINDOW_MS = 60_000;
const IP_LIMIT     = 10;
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

const isUuid = (s) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export default async function handler(req, res) {
  try {
    return await handleInner(req, res);
  } catch (e) {
    console.error("[chat-feedback] top-level crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}

async function handleInner(req, res) {
  if (req.method !== "PATCH" && req.method !== "POST") {
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

  // Body parse
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON body" }); }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ error: "empty body" });
  }
  const serialized = JSON.stringify(body);
  if (serialized.length > MAX_BODY_BYTES) {
    return res.status(413).json({ error: "body too large" });
  }

  const { log_id, session_id, feedback, note } = body;
  if (!isUuid(log_id))      return res.status(400).json({ error: "invalid log_id (UUID required)" });
  if (!isUuid(session_id))  return res.status(400).json({ error: "invalid session_id (UUID required)" });
  if (feedback !== "good" && feedback !== "bad" && feedback !== null) {
    return res.status(400).json({ error: "feedback must be 'good', 'bad', or null (to clear)" });
  }
  // F-112: route the user-supplied note through cleanText for the same
  // defense-in-depth reason CompleteProfile + PlatformSettings sanitize
  // their string fields. The note is unlikely to be rendered as HTML
  // today (Boss reads via SQL), but a future analytics dashboard would
  // inherit the unsanitized payload otherwise.
  const noteTrim = typeof note === "string" ? cleanText(note, { max: MAX_NOTE_LEN }) || null : null;

  const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify the row exists, matches session_id, and is an assistant turn.
  const { data: row, error: lookupErr } = await admin
    .from("ai_chat_log")
    .select("id, session_id, role")
    .eq("id", log_id)
    .maybeSingle();

  if (lookupErr) {
    console.error("[chat-feedback] lookup failed", lookupErr.message);
    return res.status(500).json({ error: "lookup failed" });
  }
  if (!row) return res.status(404).json({ error: "log row not found" });
  if (row.session_id !== session_id) {
    return res.status(403).json({ error: "session mismatch" });
  }
  if (row.role !== "assistant") {
    return res.status(403).json({ error: "only assistant turns can be rated" });
  }

  // Apply the rating. feedback === null clears the rating + timestamp.
  const update = feedback === null
    ? { feedback: null, feedback_note: null, feedback_at: null }
    : { feedback, feedback_note: noteTrim, feedback_at: new Date().toISOString() };

  const { error: updErr } = await admin
    .from("ai_chat_log")
    .update(update)
    .eq("id", log_id);

  if (updErr) {
    console.error("[chat-feedback] update failed", updErr.message);
    return res.status(500).json({ error: "update failed" });
  }
  return res.status(200).json({ ok: true });
}
