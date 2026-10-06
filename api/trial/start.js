// POST /api/trial/start
//
// Self-service endpoint: authenticated user starts their 7-day free
// trial. Idempotent-ish — if the user already has a trial (active OR
// expired) we refuse to re-grant. Support / comped access is not a trial:
// the admin gives Premium with a period in admin → Users
// (/api/admin/set-subscription, /api/admin/create-user).
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
//   403 — untrusted origin / sign-up not finished (profile_incomplete)
//   409 — trial already used, or already on Premium / admin
//   200 also when the trial was started moments ago (the welcome webhook
//        honoured the trial asked for at sign-up, or a second tab) — the
//        person asked for a running trial and has one.
//
// Who may start, and the atomic write, live in src/lib/trialRules.js, shared
// with the welcome webhook.

import { createClient } from "@supabase/supabase-js";
import { isTrustedRequest as isTrustedOrigin } from "../_lib/origin.js";
import { TRIAL_DAYS, trialRefusal, trialJustStarted, startTrialRow } from "../../src/lib/trialRules.js";

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

    // Check current state — trial is one-shot per user (self-service).
    const { data: prof } = await admin
      .from("user_profiles")
      .select("tier, profile_completed, trial_until, trial_started_at, paid_until")
      .eq("id", user.id)
      .maybeSingle();
    if (trialJustStarted(prof)) {
      return res.status(200).json({ trial_started_at: prof.trial_started_at, trial_until: prof.trial_until, days: TRIAL_DAYS, already_running: true });
    }
    const refusal = trialRefusal(prof);
    // Not before the sign-up is finished — 403, not 409: the trial intent kept
    // from the marketing page must survive this and be redeemed once the profile
    // is complete (settleTrialIntent drops it only on 2xx/409).
    if (refusal) {
      return res.status(refusal.status).json({
        error: refusal.error,
        ...(prof?.trial_started_at ? { trial_started_at: prof.trial_started_at, trial_until: prof.trial_until } : {}),
      });
    }

    // Atomic: only while trial_started_at is empty, so two requests at once
    // cannot both write (the second read the same empty row and overwrote it).
    const row = await startTrialRow(admin, user.id);
    if (!row) {
      const { data: again } = await admin.from("user_profiles")
        .select("trial_started_at, trial_until").eq("id", user.id).maybeSingle();
      if (trialJustStarted(again)) {
        return res.status(200).json({ trial_started_at: again.trial_started_at, trial_until: again.trial_until, days: TRIAL_DAYS, already_running: true });
      }
      return res.status(409).json({ error: "trial already used" });
    }

    return res.status(200).json({
      trial_started_at: row.trial_started_at,
      trial_until:      row.trial_until,
      days: TRIAL_DAYS,
    });
  } catch (e) {
    console.error("[trial/start] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
