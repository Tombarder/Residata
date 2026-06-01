// POST /api/trial/start
//
// Self-service endpoint: authenticated user starts their 7-day free
// trial. Idempotent-ish — if the user already has a trial (active OR
// expired) we refuse to re-grant. Admin has a separate endpoint
// (/api/trial/grant) that CAN override for support / comped access.
//
// Security:
//   · Origin allowlist (same as chat endpoint)
//   · Supabase session required
//   · No rate limit needed — one-time per user by design
//
// On success:
//   · user_profiles.trial_until        = now + 7 days
//   · user_profiles.trial_started_at   = now
//   · tier stays 'free' — the capability layer promotes them to
//     paid for as long as trial_until > now
//
// Response:
//   200 { trial_until, trial_started_at }
//   401 — unauthenticated
//   403 — untrusted origin / trial already consumed

import { createClient } from "@supabase/supabase-js";
import { isTrustedOrigin as checkTrustedOrigin } from "../_lib/origin.js";

export const maxDuration = 10;

const TRUSTED_ORIGINS = [
  "https://residata-gamma.vercel.app",
  "https://residata.sk",
  "https://www.residata.sk",
  "http://localhost:5173",
  "http://localhost:3000",
];

const isTrustedOrigin = (req) => checkTrustedOrigin(req, TRUSTED_ORIGINS);

const TRIAL_DAYS = 7;

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

    // Check current state — trial is one-shot per user (self-service).
    const { data: prof } = await admin
      .from("user_profiles")
      .select("tier, trial_until, trial_started_at")
      .eq("id", user.id)
      .maybeSingle();
    if (!prof) return res.status(404).json({ error: "profile not found" });
    if (prof.tier === "paid" || prof.tier === "admin") {
      return res.status(409).json({ error: "already on a paid tier", tier: prof.tier });
    }
    if (prof.trial_started_at) {
      return res.status(409).json({
        error: "trial already used",
        trial_started_at: prof.trial_started_at,
        trial_until: prof.trial_until,
      });
    }

    const now = new Date();
    const end = new Date(now.getTime() + TRIAL_DAYS * 86400 * 1000);
    const { error: updateErr } = await admin
      .from("user_profiles")
      .update({
        trial_started_at: now.toISOString(),
        trial_until:      end.toISOString(),
      })
      .eq("id", user.id);
    if (updateErr) return res.status(500).json({ error: "update failed", detail: updateErr.message });

    return res.status(200).json({
      trial_started_at: now.toISOString(),
      trial_until:      end.toISOString(),
      days: TRIAL_DAYS,
    });
  } catch (e) {
    console.error("[trial/start] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
