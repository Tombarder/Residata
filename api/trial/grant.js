// POST /api/trial/grant
//
// Admin endpoint: grant or revoke a 7-day trial for any user.
//   · Body: { user_id, action: "grant" | "revoke", days?: number }
//   · Only callers with tier='admin' may invoke.
//
// Grant sets trial_until = now + (days || 7) and trial_started_at = now.
// If the user already has a trial (used OR active), grant OVERWRITES
// it — admin's explicit intent wins over the one-shot self-service
// guard (/api/trial/start).
//
// Revoke NULLs both trial_until and trial_started_at, so the user
// can self-service-start the trial again later if admin wants.

import { createClient } from "@supabase/supabase-js";

export const maxDuration = 10;

const TRUSTED_ORIGINS = [
  "https://residata-gamma.vercel.app",
  "https://residata.sk",
  "https://www.residata.sk",
  "http://localhost:5173",
  "http://localhost:3000",
];

function isTrustedOrigin(req) {
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  if (origin && TRUSTED_ORIGINS.some(o => origin === o)) return true;
  if (referer && TRUSTED_ORIGINS.some(o => referer.startsWith(o))) return true;
  return false;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
    if (!isTrustedOrigin(req)) return res.status(403).json({ error: "untrusted origin" });

    const URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SECRET_KEY;
    if (!URL || !KEY) return res.status(500).json({ error: "server misconfigured" });

    const authHeader = req.headers.authorization || req.headers.Authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return res.status(401).json({ error: "authentication required" });

    const admin = createClient(URL, KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: "invalid token" });

    // Must be admin.
    const { data: caller } = await admin
      .from("user_profiles").select("tier").eq("id", user.id).maybeSingle();
    if (caller?.tier !== "admin") return res.status(403).json({ error: "admin only" });

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON" }); }
    }
    if (!body || typeof body !== "object") return res.status(400).json({ error: "empty body" });

    const userId = String(body.user_id || "").trim();
    const action = body.action === "revoke" ? "revoke" : "grant";
    const days   = Math.max(1, Math.min(90, Number(body.days) || 7));
    if (!userId) return res.status(400).json({ error: "user_id required" });
    if (userId === user.id) return res.status(400).json({ error: "cannot grant trial to yourself" });

    let patch;
    if (action === "revoke") {
      patch = { trial_until: null, trial_started_at: null };
    } else {
      const now = new Date();
      const end = new Date(now.getTime() + days * 86400 * 1000);
      patch = { trial_until: end.toISOString(), trial_started_at: now.toISOString() };
    }

    const { error: updErr } = await admin
      .from("user_profiles").update(patch).eq("id", userId);
    if (updErr) return res.status(500).json({ error: "update failed", detail: updErr.message });

    // Best-effort audit log (admin_audit_log table).
    admin.from("admin_audit_log").insert({
      admin_id: user.id,
      target_user_id: userId,
      action: `trial_${action}`,
      details: { days: action === "grant" ? days : null },
    }).then(({ error }) => { if (error) console.warn("[trial/grant] audit log", error.message); });

    return res.status(200).json({ ok: true, action, ...patch });
  } catch (e) {
    console.error("[trial/grant] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
