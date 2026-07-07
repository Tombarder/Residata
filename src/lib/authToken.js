/**
 * Bounded access-token provider for the RLS-gated DATA client (see supabase.js
 * `supabaseData`).
 *
 * ── THE BUG THIS ENDS (for good) ──────────────────────────────────────────────
 * Every read on the AUTHED supabase client runs `await auth.getSession()` BEFORE
 * the actual PostgREST fetch (supabase-js `_getAccessToken`). getSession() is
 * serialised behind a single in-tab lock and may kick a network token refresh.
 * When that shared auth step stalls for ANY reason (token drifted into the
 * refresh window while the user was on the anon-client Map, a backgrounded tab /
 * laptop-sleep left an in-flight refresh unresolved, a dead keep-alive swallowed
 * the refresh), the `await getSession()` never returns — so the data fetch never
 * even fires, and the hook's spinner shows "Loading…" forever. Only a full page
 * reload (fresh auth instance + lock + connections) clears it. That is the
 * "open a project / analytics hangs, hard refresh pops it in instantly" bug, and
 * it kept coming back because every fix patched ONE call site (e.g.
 * LocationManager's rpcDirect) while every other read still went through
 * getSession().
 *
 * ── THE ARCHITECTURAL CURE ────────────────────────────────────────────────────
 * The data client is created with the `accessToken` option, so supabase-js calls
 * THIS function for every request INSTEAD of getSession()/the lock/refresh dance
 * (see `_getAccessToken`: `if (this.accessToken) return await this.accessToken()`).
 * We resolve the token WITHOUT ever touching the auth lock:
 *   1. an in-memory token, kept live by subscribing to the auth client's
 *      onAuthStateChange (updated on SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT);
 *   2. seeded synchronously from localStorage at module load, so even the very
 *      first read before any event has a token — no network, no lock;
 *   3. at the ~hourly expiry boundary, a BOUNDED refresh (hard-capped via
 *      Promise.race) — never the unbounded lock. If it can't finish in time we
 *      return the current token anyway; a stale token yields a 401 that RESOLVES
 *      (never hangs) and the read layer retries.
 * Net result: the data path can no longer hang on auth, by construction — not as
 * a timeout band-aid but because getSession() is no longer on it.
 */

// Refresh proactively if the token expires within this window (seconds).
const REFRESH_SKEW_S = 90;
// Hard cap on how long a data read may wait for a boundary refresh (ms). The
// auth client autoRefreshes well before expiry, so this only ever trips on a
// woken-from-sleep edge; even then it's bounded, never infinite.
const REFRESH_RACE_MS = 6000;

let _authClient = null;      // the AUTH client (set via initAuthTokenSync)
let _accessToken = null;     // current user access token, or null when logged out
let _expiresAt = 0;          // unix seconds; 0 = unknown
let _refreshInFlight = null; // dedupe concurrent boundary refreshes

/** Synchronously read the persisted Supabase session token from localStorage.
 *  No network, no lock — instant. Tolerant of gotrue's storage-shape variants
 *  (flat session object, {currentSession}, or chunked array). */
function _readStoredSession() {
  try {
    if (typeof localStorage === "undefined") return null;
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("sb-") && k.includes("-auth-token")) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        let v;
        try { v = JSON.parse(raw); } catch { continue; }
        const s = v?.access_token ? v
          : v?.currentSession?.access_token ? v.currentSession
          : (Array.isArray(v) && v[0]?.access_token) ? v[0]
          : null;
        if (s?.access_token) return s;
      }
    }
  } catch { /* private mode / no storage */ }
  return null;
}

function _seedFromStorage() {
  const s = _readStoredSession();
  if (s?.access_token) {
    _accessToken = s.access_token;
    _expiresAt = Number(s.expires_at) || 0;
  }
}
_seedFromStorage();

/** Wire the token store to the AUTH client's session lifecycle. Called once from
 *  supabase.js right after the auth client is created. The callback is
 *  synchronous (only assigns) — it never awaits an auth op, so it can't deadlock
 *  the auth lock (same rule useAuth's onAuthStateChange follows). */
export function initAuthTokenSync(authClient) {
  _authClient = authClient || null;
  if (!_authClient) return;
  try {
    _authClient.auth.onAuthStateChange((_event, session) => {
      _accessToken = session?.access_token || null;
      _expiresAt = Number(session?.expires_at) || 0;
    });
  } catch { /* non-fatal: we still have the localStorage seed + fallback */ }
}

function _expiredSoon() {
  if (!_accessToken) return true;
  if (!_expiresAt) return false;                 // unknown expiry → trust it
  const now = Math.floor(Date.now() / 1000);
  return _expiresAt - now <= REFRESH_SKEW_S;
}

/** Bounded token refresh. Reuses the auth client's refreshSession() (which keeps
 *  the stored session + all other tabs in sync) but caps the wait via
 *  Promise.race so the DATA path can never block on it. Deduped so a burst of
 *  reads triggers one refresh. Always resolves (never rejects). */
function _boundedRefresh() {
  if (_refreshInFlight) return _refreshInFlight;
  if (!_authClient) return Promise.resolve(_accessToken);
  const refresh = _authClient.auth.refreshSession()
    .then(({ data }) => {
      const s = data?.session;
      if (s?.access_token) {
        _accessToken = s.access_token;
        _expiresAt = Number(s.expires_at) || 0;
      }
      return _accessToken;
    })
    .catch(() => _accessToken);
  const capped = Promise.race([
    refresh,
    new Promise((res) => setTimeout(() => res(_accessToken), REFRESH_RACE_MS)),
  ]).finally(() => { _refreshInFlight = null; });
  _refreshInFlight = capped;
  return capped;
}

/**
 * The `accessToken` function handed to the DATA client. supabase-js awaits it on
 * every request. Contract: ALWAYS settles fast, NEVER hangs.
 *   · logged out            → null  (supabase-js falls back to the anon key → anon RLS)
 *   · token fresh           → return it immediately (no await past a sync check)
 *   · token expired/near    → bounded refresh (≤ REFRESH_RACE_MS), then return
 *                             whatever we have (fresh, or stale as a last resort)
 * A stale token can only ever produce a 401 that RESOLVES — the read layer treats
 * that as a transient error and retries — it can never strand the UI.
 */
export async function getDataAccessToken() {
  // Late seed: if the in-memory token is missing but localStorage now has one
  // (e.g. a login completed in another tab), pick it up without a network call.
  if (!_accessToken) {
    const s = _readStoredSession();
    if (s?.access_token) { _accessToken = s.access_token; _expiresAt = Number(s.expires_at) || 0; }
  }
  if (!_accessToken) return null;                // genuinely logged out → anon
  if (_expiredSoon()) {
    await _boundedRefresh();                      // bounded; never the auth lock
  }
  return _accessToken || null;
}

/** Test/diagnostic peek at the current token state (not used in the render path). */
export function _debugTokenState() {
  return { hasToken: !!_accessToken, expiresAt: _expiresAt };
}
