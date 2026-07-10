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
