// src/lib/sessionGuard.js
//
// One place to make privileged actions (admin tier/subscription writes, the
// trial + pay endpoints) robust against a STALE browser session.
//
// WHY THIS EXISTS — the real-world failure behind "the subscription system
// doesn't work":
//   Magic-link access tokens live ~1 hour. When a tab has been open longer, the
//   access token drifts into the refresh window. The backend then answers a dead
//   token with a raw "permission denied" (client PATCH) or a 401 (the /api
//   endpoints) — to a user that just reads as "I clicked and nothing happened".
//
// ── WHY IT NO LONGER USES supabase.auth.getSession()/refreshSession() ──────────
//   The ORIGINAL implementation called getSession()/refreshSession() directly.
//   Both serialise behind the single in-tab auth lock and kick a NETWORK token
//   refresh; when the token had drifted into the refresh window (classically:
//   the user was on the Map, which runs on the anon client, so the authed token
//   aged unnoticed), that refresh could stall — and the caller's `await` never
//   returned. For the Stripe "pay" flow that meant the popup opened about:blank
//   and hung there; only a reload (fresh token) sometimes cleared it. This is
//   the SAME hang authToken.js already cured for every RLS-gated data read by
//   moving them off getSession() onto a non-blocking in-memory token store.
//
//   getFreshAccessToken() now delegates to that SAME store (getDataAccessToken):
//   in-memory token + localStorage seed + a BOUNDED proactive refresh that
//   always settles (never the auth lock, never an unbounded wait). So privileged
//   actions can no longer hang on auth, by construction — not a timeout band-aid.
//   For the rare case where the bounded refresh returned a still-stale token,
//   the API callers do one forceTokenRefresh()+retry on a 401 (see billing.js /
//   trial.js) — the same "stale → 401 → refresh → retry" contract the read layer
//   uses. Throws SESSION_EXPIRED only when there is genuinely no session.

import { getDataAccessToken } from "./authToken";

/**
 * Return an access token WITHOUT ever hanging. Sourced from the non-blocking
 * token store (getDataAccessToken) — in-memory + localStorage seed + bounded
 * refresh — never supabase.auth.getSession()/the auth lock. Throws an Error with
 * code 'SESSION_EXPIRED' when there is no session at all.
 */
export async function getFreshAccessToken() {
  const token = await getDataAccessToken();
  if (!token) {
    const e = new Error("SESSION_EXPIRED");
    e.code = "SESSION_EXPIRED";
    throw e;
  }
  return token;
}

/** True for any error that means "your login is no longer valid". */
export function isAuthError(err) {
  if (!err) return false;
  if (err.code === "SESSION_EXPIRED") return true;
  if (err.status === 401 || err.status === 403) return true;
  const msg = String(err.message || err.code || err).toLowerCase();
  return /jwt|token|permission denied|not authenticated|expired|refresh token/.test(msg);
}

/** Map any error (ours or Supabase/PostgREST) to a clear, human message. */
export function authErrorMessage(err, lang = "en") {
  if (isAuthError(err)) {
    return lang === "sk"
      ? "Tvoja prihlasovacia relácia vypršala. Obnov stránku (alebo sa odhlás a prihlás znova) a skús to znova."
      : "Your session expired. Refresh the page (or sign out and back in), then try again.";
  }
  const msg = String(err?.message || err?.code || err || "unknown error");
  return (lang === "sk" ? "Akcia zlyhala: " : "Action failed: ") + msg;
}
