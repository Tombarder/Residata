// src/lib/trial.js
//
// Single source of truth for STARTING the 7-day free trial from the
// frontend. Before this module every "Activate trial" CTA (dashboard
// banner, marketing top-banner, marketing popup, pricing card) merely
// NAVIGATED to the Billing page — none of them actually started the
// trial. Only the Billing page itself called /api/trial/start. So a user
// clicking a button literally labelled "Activate trial" / promised
// "one-click activation" got nothing activated. This centralises the real
// activation so EVERY surface can start the trial in one click.
//
// It also carries "trial intent" across the signup boundary: an anon
// visitor who clicks a trial CTA can't start a trial yet (no account), so
// we remember the intent and auto-activate the moment their profile is
// completed (the "30s sign-up → 7-day trial" promise).

import { getFreshAccessToken } from "./sessionGuard";
import { forceTokenRefresh } from "./authToken";

// localStorage flag — set when an anon visitor clicks a trial CTA, read +
// cleared right after profile completion to auto-start the trial.
const TRIAL_INTENT_KEY = "residata_trial_intent";

export function setTrialIntent() {
  try { localStorage.setItem(TRIAL_INTENT_KEY, "1"); } catch (_) {}
}
export function hasTrialIntent() {
  try { return localStorage.getItem(TRIAL_INTENT_KEY) === "1"; } catch (_) { return false; }
}
export function clearTrialIntent() {
  try { localStorage.removeItem(TRIAL_INTENT_KEY); } catch (_) {}
}

/**
 * Start the authenticated user's 7-day trial.
 *
 * Always refreshes the access token first (getFreshAccessToken) so the
 * request never goes out with a dead token — the #1 historical reason
 * "start trial" silently 401'd.
 *
 * Returns:
 *   { ok: true,  data }                       — trial started
 *   { ok: false, reason: "consumed", data }   — already used OR already on
 *                                               a paid/admin tier (409). The
 *                                               caller should route to Billing
 *                                               rather than show a hard error.
 *
 * Throws:
 *   - Error code "SESSION_EXPIRED" if the session can't be revived
 *   - Error (with .status) on any other non-OK HTTP response / network error
 * so callers can show a clean "sign in again" / "try again" message.
 */
export async function activateTrial() {
  const headers = (t) => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
  let token = await getFreshAccessToken(); // non-blocking; throws SESSION_EXPIRED only if no session
  let r = await fetch("/api/trial/start", { method: "POST", headers: headers(token), body: "{}" });
  // Stale-token recovery: one forced refresh + single retry on a 401 (the token
  // store may hand back a just-expired token) — same contract as the read layer,
  // so a slightly-stale token doesn't surface as a false "session expired".
  if (r.status === 401) {
    token = await forceTokenRefresh();
    if (token) r = await fetch("/api/trial/start", { method: "POST", headers: headers(token), body: "{}" });
  }
  const data = await r.json().catch(() => ({}));
  if (r.ok) return { ok: true, data };
  // 409 = already used / already paid — a normal "can't start" state, not an
  // error to alarm the user with. Caller decides (usually: go to Billing).
  if (r.status === 409) return { ok: false, reason: "consumed", data };
  const e = new Error(data?.error || `HTTP ${r.status}`);
  e.status = r.status;
  e.data = data;
  throw e;
}

/**
 * Redeem the trial a visitor asked for BEFORE they had an account, and only
 * give up on it when the answer is final.
 *
 * The promise on the marketing page is "30s sign-up → 7-day trial": they click
 * "Activate 7-day trial" while anonymous, we remember the intent, and it has to
 * be honoured once they have a profile. It used to be honoured exactly once, in
 * CompleteProfile, with the intent cleared no matter what happened —
 *
 *     if (hasTrialIntent()) { try { await activateTrial(); } catch {} clearTrialIntent(); }
 *
 * — so one network blip, one 500, one momentarily-stale session at that exact
 * moment and the trial was gone for good. The user had clicked the button, been
 * told they had a week of Premium, and silently landed on the free tier with
 * nothing to explain it and nothing anywhere to retry it.
 *
 * The intent is now cleared only when it CANNOT usefully be retried:
 *   · the trial started                        → done
 *   · 409, already used or already paid        → it can never start; stop asking
 * Anything else (offline, 5xx, expired session) leaves the flag set, so the next
 * load tries again. One attempt per load, so it cannot spin.
 *
 * Safe to call on every load: it does nothing unless the flag is actually set.
 */
export async function settleTrialIntent() {
  if (!hasTrialIntent()) return { settled: false };
  try {
    const res = await activateTrial();
    clearTrialIntent();                       // started, or 409 = can never start
    return { settled: true, started: !!res.ok, reason: res.reason };
  } catch (e) {
    // Keep the intent: this is a "not right now", not a "never".
    return { settled: false, error: e };
  }
}
