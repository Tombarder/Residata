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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

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
  if (!callerProfile || callerProfile.tier !== "admin") {
    return res.status(403).json({ error: "not admin" });
  }

  // ── Parse body ──
  const body = typeof req.body === "string" ? (req.body ? JSON.parse(req.body) : {}) : (req.body || {});
  const targetId = body.user_id;
  if (!targetId) {
    return res.status(400).json({ error: "missing user_id in body" });
  }
  if (targetId === callerId) {
    return res.status(400).json({ error: "refusing to delete yourself" });
  }

  // ── Delete ──
  const { error: delErr } = await sb.auth.admin.deleteUser(targetId);
  if (delErr) {
    return res.status(500).json({ error: `delete failed: ${delErr.message}` });
  }

  return res.status(200).json({ ok: true, deletedUserId: targetId });
}
