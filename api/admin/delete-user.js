// Vercel serverless endpoint: /api/admin/delete-user
//
// Admin-only destructive op — calls Supabase Auth admin API (which requires
// service-role and therefore MUST live on the backend, not in the browser).
//
// Auth model:
//   1. Caller sends their Supabase session access-token as Authorization: Bearer <token>
//   2. Endpoint validates the token against Supabase (auth.getUser)
//   3. Endpoint reads caller's user_profiles row to confirm tier='admin'
//   4. Only then does it accept { user_id } and delete via auth.admin.deleteUser()
//   5. Self-delete is refused — admins can't nuke their own account from here.
//
// auth.users delete cascades into user_profiles via FK.

import { createClient } from "@supabase/supabase-js";
import { isTrustedRequest as isTrustedOrigin } from "../_lib/origin.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  // Same origin allowlist every other privileged endpoint enforces
  // (set-subscription / trial-grant / trial-start). This is the single
  // irreversible admin op, so it must not be the least-gated one.
  if (!isTrustedOrigin(req)) return res.status(403).json({ error: "untrusted origin" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: "server misconfigured: SUPABASE envs missing" });
  }

  // ── Extract bearer token ──
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ error: "missing bearer token" });
  }

  // Service-role client — used both for verifying caller and for the deletion.
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });

  // ── Verify caller is admin ──
  const { data: callerData, error: callerErr } = await sb.auth.getUser(token);
  if (callerErr || !callerData?.user) {
    return res.status(401).json({ error: "invalid session token" });
  }
  const callerId = callerData.user.id;

  const { data: callerProfile, error: pErr } = await sb
    .from("user_profiles")
    .select("tier")
    .eq("id", callerId)
    .maybeSingle();
  if (pErr) {
    return res.status(500).json({ error: `profile fetch failed: ${pErr.message}` });
  }
  // ── Parse body ──
  const body = typeof req.body === "string" ? (req.body ? JSON.parse(req.body) : {}) : (req.body || {});
  const targetId = body.user_id;
  if (!targetId) {
    return res.status(400).json({ error: "missing user_id in body" });
  }
  // Authorization: a user may delete THEIR OWN account (GDPR right to erasure /
  // self-service DSAR from Settings); an admin may delete anyone. Deleting
  // someone ELSE requires admin. (Kept in this one function so we don't add a
  // new Vercel serverless function — the Hobby plan is at its 12-function cap.)
  const isSelfDelete = targetId === callerId;
  const isAdmin = !!callerProfile && callerProfile.tier === "admin";
  if (!isSelfDelete && !isAdmin) {
    return res.status(403).json({ error: "not admin" });
  }

  // ── Capture target details BEFORE deletion for the audit log ──
  // Once auth.admin.deleteUser() fires, cascade wipes user_profiles too.
  // We want the audit trail to show who was deleted, not just their uuid.
  const { data: targetProfile } = await sb
    .from("user_profiles")
    .select("email, tier, full_name, company")
    .eq("id", targetId)
    .maybeSingle();

  // Actor details for the log (caller is the admin performing the action)
  const actorEmail = callerData.user.email || null;
  const clientIp =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    null;
  const userAgent = req.headers["user-agent"] || null;

  // ── Delete ──
  const { error: delErr } = await sb.auth.admin.deleteUser(targetId);

  // ── Audit log — ALWAYS records attempt (success or failure) ──
  // Best-effort: a failing audit write shouldn't mask the real result.
  try {
    await sb.from("admin_audit_log").insert({
      actor_id:    callerId,
      actor_email: actorEmail,
      action:      isSelfDelete ? "self_delete_user" : "delete_user",
      target_id:   targetId,
      payload:     targetProfile || null,
      ip:          clientIp,
      user_agent:  userAgent,
      success:     !delErr,
      error:       delErr?.message || null,
    });
  } catch (_) { /* never let logging break the response */ }

  if (delErr) {
    return res.status(500).json({ error: `delete failed: ${delErr.message}` });
  }

  return res.status(200).json({ ok: true, deletedUserId: targetId });
}
