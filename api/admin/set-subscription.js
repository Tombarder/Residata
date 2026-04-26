// POST /api/admin/set-subscription
//
// Admin-only endpoint to write any subscription field on a user's
// profile in one round-trip. Same security model as the other
// /api/admin endpoints: caller must be tier='admin' (verified
// server-side via Supabase auth).
//
// Body: any subset of:
//   { user_id:           string,           required
//     trial_until:       ISO string | null,
//     trial_started_at:  ISO string | null,
//     paid_until:        ISO string | null,
//     paid_started_at:   ISO string | null,
//     paid_pause_started ISO string | null,
//     subscription_note: string | null,
//     extend_trial_days: number,           shortcut: bumps trial_until forward
//     extend_paid_days:  number,           shortcut: bumps paid_until forward
//     pause:             boolean,          shortcut: paused_at = now
//     unpause:           boolean }         shortcut: paused_at = null + push paid_until forward by paused-duration
//
// Response 200 { ok, patch } where patch is the actual field set
// applied (so the client can echo it back into local state).

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

function isoOrNull(v) {
  if (v === null) return null;
  if (typeof v === "string") {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
  }
  return undefined;
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

    const { data: caller } = await admin
      .from("user_profiles").select("tier").eq("id", user.id).maybeSingle();
    if (caller?.tier !== "admin") return res.status(403).json({ error: "admin only" });

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON" }); }
    }
    if (!body || typeof body !== "object") return res.status(400).json({ error: "empty body" });

    const userId = String(body.user_id || "").trim();
    if (!userId) return res.status(400).json({ error: "user_id required" });

    // Read current row so shortcut actions (extend / unpause) can
    // do their relative math without race. We ignore stale-read
    // risk because admin actions are sequential, not concurrent.
    const { data: target } = await admin
      .from("user_profiles")
      .select("paid_until, paid_started_at, paid_pause_started, trial_until")
      .eq("id", userId)
      .maybeSingle();
    if (!target) return res.status(404).json({ error: "target user not found" });

    const patch = {};

    // Direct date / null setters
    for (const key of ["trial_until", "trial_started_at", "paid_until", "paid_started_at", "paid_pause_started"]) {
      if (key in body) {
        const v = isoOrNull(body[key]);
        if (v === undefined) return res.status(400).json({ error: `bad ${key}` });
        patch[key] = v;
      }
    }
    if ("subscription_note" in body) {
      patch.subscription_note = typeof body.subscription_note === "string"
        ? body.subscription_note.slice(0, 500)
        : null;
    }

    // Shortcut: extend_trial_days
    if (Number.isFinite(Number(body.extend_trial_days))) {
      const days = Math.max(1, Math.min(365, Number(body.extend_trial_days)));
      const base = target.trial_until && new Date(target.trial_until) > new Date()
        ? new Date(target.trial_until) : new Date();
      patch.trial_until = new Date(base.getTime() + days * 86400 * 1000).toISOString();
      if (!target.trial_until) patch.trial_started_at = new Date().toISOString();
    }

    // Shortcut: extend_paid_days
    if (Number.isFinite(Number(body.extend_paid_days))) {
      const days = Math.max(1, Math.min(3650, Number(body.extend_paid_days)));
      const base = target.paid_until && new Date(target.paid_until) > new Date()
        ? new Date(target.paid_until) : new Date();
      patch.paid_until = new Date(base.getTime() + days * 86400 * 1000).toISOString();
      if (!target.paid_started_at) patch.paid_started_at = new Date().toISOString();
    }

    // Shortcut: pause
    if (body.pause === true) {
      patch.paid_pause_started = new Date().toISOString();
    }

    // Shortcut: unpause — push paid_until forward by the paused duration
    // so the user gets back the time they lost while paused.
    if (body.unpause === true && target.paid_pause_started) {
      const pausedMs = Date.now() - new Date(target.paid_pause_started).getTime();
      patch.paid_pause_started = null;
      if (target.paid_until) {
        patch.paid_until = new Date(new Date(target.paid_until).getTime() + pausedMs).toISOString();
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "no fields to update" });
    }

    const { error: updErr } = await admin
      .from("user_profiles").update(patch).eq("id", userId);
    if (updErr) return res.status(500).json({ error: "update failed", detail: updErr.message });

    // Audit
    admin.from("admin_audit_log").insert({
      admin_id: user.id,
      target_user_id: userId,
      action: "subscription_update",
      details: patch,
    }).then(({ error }) => { if (error) console.warn("[set-subscription] audit", error.message); });

    return res.status(200).json({ ok: true, patch });
  } catch (e) {
    console.error("[set-subscription] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
