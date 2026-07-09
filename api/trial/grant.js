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
import { isTrustedRequest as isTrustedOrigin } from "../_lib/origin.js";

export const maxDuration = 10;

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

    const { data: updRows, error: updErr } = await admin
      .from("user_profiles").update(patch).eq("id", userId).select("id");
    if (updErr) return res.status(500).json({ error: "update failed", detail: updErr.message });
    if (!updRows || updRows.length === 0) {
      return res.status(500).json({ error: "trial write did not land — no row updated (key/RLS misconfig?)" });
    }

    // Audit log — F-250 fix (same bug family as F-239 in set-subscription).
    // Previously wrote `admin_id / target_user_id / details` which DON'T
    // EXIST in admin_audit_log (schema uses actor_id / target_id / payload).
    // The .then() only logged to console.warn; Vercel logs aren't watched
    // live; so every trial_grant + trial_revoke action was silently dropped.
    // Mirror delete-user.js exactly + await + try/catch so failures surface.
    const clientIp =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      null;
    const userAgent = req.headers["user-agent"] || null;
    try {
      await admin.from("admin_audit_log").insert({
        actor_id:    user.id,
        actor_email: user.email || null,
        action:      `trial_${action}`,
        target_id:   userId,
        payload:     { days: action === "grant" ? days : null, patch },
        ip:          clientIp,
        user_agent:  userAgent,
        success:     true,
        error:       null,
      });
    } catch (auditErr) {
      console.warn("[trial/grant] audit insert failed (non-fatal)", auditErr?.message || auditErr);
    }

    return res.status(200).json({ ok: true, action, ...patch });
  } catch (e) {
    console.error("[trial/grant] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
