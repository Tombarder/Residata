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

// localStorage — WHEN an anon visitor clicked a trial CTA, read + cleared right
// after profile completion to auto-start the trial.
//
// It used to be a bare "1" that never expired and belonged to no one: a visitor
// who clicked "Activate trial" and walked away left it in the browser for good,
// and weeks later whoever signed in on that computer — a colleague on the office
// PC — had their one-time trial started without asking. Now it is a moment, and
// it counts for TRIAL_INTENT_BROWSER_TTL_MS (a sign-up, including waiting for the
// code e-mail, takes minutes). The old "1" has no moment, so it counts for nothing.
const TRIAL_INTENT_KEY = "residata_trial_intent";
const TRIAL_INTENT_BROWSER_TTL_MS = 2 * 60 * 60 * 1000;

export function setTrialIntent() {
  try { localStorage.setItem(TRIAL_INTENT_KEY, new Date().toISOString()); } catch (_) {}
}
/** The moment the trial was asked for (ISO), while it still counts; else null. */
export function trialIntentAt() {
  try {
    const v = localStorage.getItem(TRIAL_INTENT_KEY);
    const t = v ? Date.parse(v) : NaN;
    if (Number.isFinite(t) && Date.now() - t < TRIAL_INTENT_BROWSER_TTL_MS) return new Date(t).toISOString();
    if (v) localStorage.removeItem(TRIAL_INTENT_KEY);   // expired or the old bare "1"
  } catch (_) { /* storage blocked */ }
  return null;
}
export function hasTrialIntent() {
  return trialIntentAt() !== null;
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
//
// ONE request at a time. Profile completion calls this and so does App's
// effect that sees profile_completed flip — both used to POST, and then one
// reloaded the page while the other navigated to /app, so whichever came last
// decided where a brand-new user landed. A caller that joins a request already
// in flight gets the same answer marked `shared: true`, and leaves navigating
// to the caller that started it.
let inflight = null;
export function settleTrialIntent() {
  if (inflight) return inflight.then((r) => ({ ...r, shared: true }));
  if (!hasTrialIntent()) return Promise.resolve({ settled: false });
  inflight = (async () => {
    try {
      const res = await activateTrial();
      clearTrialIntent();                       // started, or 409 = can never start
      return { settled: true, started: !!res.ok, reason: res.reason };
    } catch (e) {
      // Keep the intent: this is a "not right now", not a "never".
      return { settled: false, error: e };
    }
  })().finally(() => { inflight = null; });
  return inflight;
}
