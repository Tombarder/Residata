/**
 * Supabase clients.
 * Publishable key is safe in browser — RLS policies protect all gating.
 *
 * TWO clients by design:
 *
 *   · `supabase`        — the AUTHED client. Persists + auto-refreshes the
 *     user's session (localStorage). Used for everything that depends on WHO
 *     the caller is: login/profile (useAuth) and the RLS-gated unit-level
 *     reads (flats_current / flats_archive / archive_months) where a paid user
 *     sees more rows than anon.
 *
 *   · `supabasePublic`  — the ANON client. NEVER attaches a user session
 *     (persistSession:false, no storage). Always queries as the anon role
 *     using only the publishable key. Used for the PUBLIC marketing data
 *     (metrics, totals_*, projects_live, project_snapshots, early_access_stats,
 *     the country list) — rows that are identical for every visitor.
 *
 * WHY two clients (the bug this fixes): with a single authed client, a STALE
 * or expired session token in localStorage makes supabase-js attach a dead
 * Bearer token to EVERY request. If the refresh token is also expired it can't
 * self-heal, so even the public marketing views start returning 401 — the
 * homepage silently falls back to its defaults (the CountrySwitcher disappears,
 * totals stop updating, only Slovakia shows). Routing public reads through a
 * session-less client makes the public site immune to any user's auth state:
 * it can never 401 on a stale login, today or in the future.
 */
import { createClient } from "@supabase/supabase-js";
import { createBoundedAuthLock, makeAuthTimeoutFetch } from "./authResilience";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.warn("Supabase env missing — running in offline/fallback mode");
}

/**
 * In-tab auth lock (2026-06-10, hardened 2026-06-23). supabase-js defaults to
 * the Web Locks API (navigator.locks) to serialise token refresh across tabs. In
 * some contexts — incognito, certain browser extensions, embedded/automation
 * webviews — that lock is never granted, so `auth.getSession()` hangs forever;
 * and because every authed query awaits getSession() internally, the whole app
 * sticks on "Loading…". So we serialise auth ops WITHIN the tab without ever
 * touching navigator.locks.
 *
 * 2026-06-23 hardening (see ./authResilience.js): the original chain waited
 * FOREVER to acquire, so one slow/stuck token refresh wedged the chain and every
 * later logged-in query hung until a full page reload — the "open a project from
 * the Map → stuck on Loading…, only refresh fixes it" bug. The lock now
 * self-heals (the chain always advances within a hard cap), and the auth fetch
 * is bounded so a refresh can never hang the chain in the first place. Two
 * independent guards, each removing one unbounded wait.
 */
const inMemoryAuthLock = createBoundedAuthLock();

export const supabase = url && key ? createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
    lock: inMemoryAuthLock,
  },
  // Bound auth network calls (/auth/v1/*) so a hung/slow token refresh can never
  // hold the auth lock indefinitely. Scoped to auth only — paged data reads pass
  // through untouched and are never aborted mid-flight.
  global: { fetch: makeAuthTimeoutFetch() },
}) : null;

/**
 * Session-less anon client for PUBLIC reads. A distinct storageKey + no
 * storage + persistSession:false guarantees it never reads, writes, or
 * attaches the authed client's session. Every query runs as the anon role —
 * exactly what the public marketing surfaces need, and immune to a stale
 * login in localStorage.
 */
export const supabasePublic = url && key ? createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storageKey: "residata-public-noauth",
  },
}) : null;

export const isSupabaseReady = () => !!supabase;

/**
 * Pre-warm the Supabase connection by firing a tiny query the moment this
 * module loads. This opens the TLS handshake, primes PostgREST's connection
 * pool, and resolves any lazy cold-start behaviour long before the user
 * actually interacts. Fire-and-forget: no await, no error handling — worst
 * case it silently fails and the real query on user action pays the cold cost.
 *
 * Warmed via the PUBLIC client: the homepage critical path now reads through
 * supabasePublic, and warming via the anon client also avoids a noisy 401 in
 * the console when a stale session is present.
 *
 * Measured impact: first user-triggered query drops from a visible wait to
 * ~100-200 ms because the connection is already warm.
 */
if (typeof window !== "undefined" && supabasePublic) {
  // setTimeout 0 so we don't block initial render on the network call
  setTimeout(() => {
    // Warm against projects_live — a light, fast view the homepage actually reads.
    // NOT public.projects: that aggregate view times out for the anon role
    // (Postgres 57014 / statement_timeout), so the old warm-up returned HTTP 500
    // on every page load — it never actually warmed anything AND each call held a
    // DB connection busy until the timeout fired. projects_live returns instantly.
    supabasePublic.from("projects_live").select("id").limit(1).then(
      () => { /* warmed */ },
      () => { /* ignore — real calls will retry */ }
    );
  }, 0);
}
