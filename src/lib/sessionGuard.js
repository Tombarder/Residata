// src/lib/sessionGuard.js
//
// One place to make privileged actions (admin tier/subscription writes, the
// trial endpoints) robust against a STALE browser session.
//
// WHY THIS EXISTS — the real-world failure behind "the subscription system
// doesn't work":
//   Magic-link access tokens live ~1 hour. When an admin tab has been open
//   longer, the access token is expired. supabase-js normally auto-refreshes,
//   but if the refresh token is also stale/used the request goes out with a
//   dead token and the backend answers with a raw
//   "permission denied for table user_profiles" (client PATCH) or a 401
//   "authentication required" (the /api endpoints). To a non-technical admin
//   that just reads as "I clicked and nothing happened / it's broken".
//
//   getFreshAccessToken() forces a refresh when the token is missing or about
//   to expire and throws a tagged SESSION_EXPIRED error if the session can't be
//   revived — so callers (a) never send a dead token to the server, and
//   (b) can show a clean "sign in again" message instead of a raw JWT/RLS error.

import { supabase } from "./supabase";

const REFRESH_SKEW_S = 60; // refresh if the token expires within this window

/**
 * Return a guaranteed-fresh access token, refreshing the session first if the
 * current token is missing or about to expire. Also primes the in-memory
 * supabase client so any FOLLOW-UP `supabase.from(...)` call uses the fresh
 * token. Throws an Error with code 'SESSION_EXPIRED' if the session is dead.
 */
export async function getFreshAccessToken() {
  let session = null;
  try {
    ({ data: { session } } = await supabase.auth.getSession());
  } catch {
    session = null;
  }
  const now = Math.floor(Date.now() / 1000);
  const stale =
    !session?.access_token ||
    (typeof session.expires_at === "number" && session.expires_at - now <= REFRESH_SKEW_S);

  if (stale) {
    let refreshed = null;
    let refreshErr = null;
    try {
      const { data, error } = await supabase.auth.refreshSession();
      refreshed = data?.session || null;
      refreshErr = error || null;
    } catch (e) {
      refreshErr = e;
    }
    if (!refreshed?.access_token) {
      const e = new Error("SESSION_EXPIRED");
      e.code = "SESSION_EXPIRED";
      e.cause = refreshErr;
      throw e;
    }
    session = refreshed;
  }
  return session.access_token;
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
