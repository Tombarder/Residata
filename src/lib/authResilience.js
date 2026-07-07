/**
 * Auth-layer resilience — the cure for the "stuck on Loading…, only a full page
 * refresh fixes it" deadlock on logged-in pages (e.g. Map → open a project).
 *
 * ROOT CAUSE (traced against @supabase/auth-js 2.106.2):
 *   Every RLS-gated read goes through getSession(). When the access token is
 *   within EXPIRY_MARGIN_MS (= 90s) of expiry, getSession does a NETWORK token
 *   refresh, and every auth op is serialised behind a single in-tab lock. Two
 *   unbounded waits made one slow/stuck refresh fatal:
 *     1. the refresh fetch had NO timeout — a hung connection hangs forever; and
 *     2. the previous custom lock (`_authChain.then(fn)`) waited FOREVER to
 *        acquire, so a stuck refresh wedged the chain and EVERY later logged-in
 *        query hung until a full page reload reset the module state.
 *   The map triggers it because the map runs on the anon client, so the authed
 *   token drifts into the refresh window unnoticed; the first authed query
 *   (opening a project) then hits the stuck refresh.
 *
 * THE FIX — two independent guards, each removing one unbounded wait. This is a
 * real cure, not a retry/auto-reload workaround: nothing re-fires the request,
 * nothing reloads the page; we simply make every wait in the auth path bounded.
 */

// An auth refresh is a tiny request — 8s is very generous. Deliberately scoped
// to /auth/v1/* only: data reads page up to 1000–5000 rows and must NOT be
// aborted mid-flight, so they pass through untouched.
export const AUTH_FETCH_TIMEOUT_MS = 8000;

// The lock chain self-heals after this long. It must comfortably exceed the
// auth-fetch timeout (8s) plus gotrue's internal refresh-retry window so it only
// ever trips on a true pathology, never on a normal (sub-second) auth op.
export const AUTH_LOCK_MAX_HOLD_MS = 35000;

const _sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Wrap a base fetch so AUTH requests (/auth/v1/*) are bounded by a hard timeout
 * via AbortController; everything else passes through unchanged. A hung refresh
 * therefore aborts after `authTimeoutMs` and releases the lock instead of
 * hanging forever. Honours a caller-supplied AbortSignal too.
 */
export function makeAuthTimeoutFetch(baseFetch, { authTimeoutMs = AUTH_FETCH_TIMEOUT_MS } = {}) {
  const f = baseFetch || ((...a) => fetch(...a));
  return (input, init = {}) => {
    const urlStr =
      typeof input === "string" ? input
      : input && typeof input.url === "string" ? input.url
      : String(input || "");
    // Only auth traffic is bounded — never abort a slow paged data read.
    if (!urlStr.includes("/auth/v1/")) return f(input, init);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), authTimeoutMs);
    const callerSignal = init.signal;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    return f(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };
}

// Hard ceiling for a single RLS-gated DATA read (ms). The data client no longer
// blocks on getSession() (see authToken.js), so this only ever trips on a truly
// stuck socket — a dead keep-alive after laptop-sleep / a Wi-Fi handoff that the
// browser hasn't reaped. Generous: the app pages reads in ≤5000-row chunks that
// return in a few seconds on a warm connection; 35s means "the connection itself
// is dead", so we abort it (freeing the socket) and let the read layer retry on a
// fresh one instead of spinning forever.
export const DATA_FETCH_TIMEOUT_MS = 35000;

/**
 * Wrap a base fetch so EVERY request is bounded by a hard timeout via
 * AbortController — used by the DATA client. On timeout the socket is aborted,
 * which makes PostgREST resolve with an AbortError `{error}` (it never rejects
 * for non-throwOnError builders), so the calling hook always reaches its
 * `setLoading(false)` and can retry — a stuck connection can no longer strand
 * the UI. Honours a caller-supplied AbortSignal too.
 */
export function makeDataTimeoutFetch(baseFetch, { timeoutMs = DATA_FETCH_TIMEOUT_MS } = {}) {
  const f = baseFetch || ((...a) => fetch(...a));
  return (input, init = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const callerSignal = init.signal;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort();
      else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    return f(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };
}

/**
 * A self-healing in-tab serialisation lock with the signature gotrue expects:
 *   (name, acquireTimeout, fn) => Promise<result of fn>
 *
 * It still runs auth ops one-at-a-time via a private promise chain, but the
 * chain ALWAYS advances within `maxHoldMs` even if `fn` never settles — so a
 * single stuck op can never block every later auth op forever. (The old lock set
 * `_authChain = run.then(...)`, so a stuck `run` wedged the chain permanently.)
 * In normal operation every op settles in well under maxHoldMs, so ops stay
 * strictly serialised and the cap never trips. Trade-off by design: if an op IS
 * genuinely stuck past the cap, the next op starts while it's still running — the
 * cap chooses liveness over strict mutual exclusion (the right call for auth ops,
 * and the bounded auth fetch means fn should settle long before maxHoldMs anyway).
 */
export function createBoundedAuthLock({ maxHoldMs = AUTH_LOCK_MAX_HOLD_MS } = {}) {
  let chain = Promise.resolve();
  return function boundedAuthLock(_name, _acquireTimeout, fn) {
    // Run after the previous op settles (a prior failure never blocks the next).
    const run = chain.then(() => fn(), () => fn());
    // The next op waits on `gate`: it opens when `run` settles OR after the hard
    // cap, whichever is first — guaranteeing the chain can never wedge forever.
    chain = new Promise((open) => {
      const timer = setTimeout(open, maxHoldMs);
      run.then(() => {}, () => {}).then(() => { clearTimeout(timer); open(); });
    });
    return run;
  };
}
