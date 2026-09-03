/**
 * errorReport — tells us when a signed-in user's browser throws.
 *
 * The gap this closes, concretely: on 2026-09-03 the billing panel shipped
 * referencing a variable that did not exist in that component. It built, every
 * test passed, and the page would have thrown for any paying customer who
 * opened it — a page our own testing cannot reach, because reaching it requires
 * an active subscription. The parts of the product behind the paywall are
 * exactly the parts nobody here exercises.
 *
 * WHAT IT DOES NOT DO, on purpose:
 *
 * - Nothing is reported for signed-out visitors. An insert endpoint open to
 *   anonymous browsers is a table anyone can fill, and it would only cover the
 *   marketing pages we already look at constantly.
 * - No query strings. A route path is diagnostic; `?q=` carries whatever the
 *   user typed into a filter.
 * - No breadcrumbs, no session replay, no third party. This is a table in our
 *   own database, subject to the same privacy policy as everything else, and
 *   the Art. 30 register lists it.
 *
 * It is also careful not to become the problem: at most a handful of reports
 * per session, each message seen only once, everything truncated, and every
 * failure swallowed. An error reporter that throws, retries or floods is worse
 * than none.
 */
import { supabaseData } from "./supabase";

const MAX_PER_SESSION = 8;      // a crash loop must not become a write loop
const MAX_MESSAGE = 2000;       // matches the column's CHECK constraint
const MAX_STACK = 8000;

let sent = 0;
const seen = new Set();         // one report per distinct message per session
let getUserId = () => null;     // set by install(); null means "not signed in"
let installed = false;

const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);

/** Route path only — the query string can carry what a user typed. */
function safePath() {
  try {
    return clip(window.location.pathname, 300);
  } catch {
    return null;
  }
}

/**
 * Which deploy this is, so a fixed bug stops accumulating rows against it.
 *
 * Filled from the <meta name="build-id"> tag that vite writes at build time.
 * This used to also try import.meta.env.VITE_BUILD_ID — a variable nothing ever
 * set — and the meta tag did not exist either, so every stored error had a null
 * build while the comment claimed otherwise. Both ends now exist.
 */
function buildId() {
  try {
    const v = document.querySelector('meta[name="build-id"]')?.content || null;
    // An unsubstituted token means the build plugin did not run (dev server).
    return v && !v.startsWith("__") ? clip(v, 100) : null;
  } catch {
    return null;
  }
}

/**
 * Report one error. Safe to call from anywhere, including inside a failing
 * render — it never throws and never returns a rejected promise.
 */
export function reportError(kind, message, stack) {
  try {
    if (sent >= MAX_PER_SESSION) return;
    const msg = clip(String(message ?? "").trim(), MAX_MESSAGE);
    if (!msg) return;
    const key = `${kind}:${msg}`;
    if (seen.has(key)) return;

    const userId = getUserId();
    if (!userId) return;                       // signed-out browsers are not reported

    seen.add(key);
    sent += 1;

    // Fire and forget. A failed insert is not worth a retry, a log line the
    // user can see, or any chance of a loop.
    supabaseData
      .from("client_errors")
      .insert({
        user_id: userId,
        kind,
        message: msg,
        stack: clip(stack, MAX_STACK),
        path: safePath(),
        user_agent: clip(navigator?.userAgent, 500),
        build: buildId(),
      })
      .then(() => {}, () => {});
  } catch {
    /* the reporter must never be the thing that breaks the page */
  }
}

/**
 * Start listening. Call once, with a function that returns the current user id
 * (or null). It is read at report time, not captured, so a user signing in
 * mid-session starts being covered without re-installing.
 */
export function installErrorReporting(currentUserId) {
  if (typeof window === "undefined") return;
  getUserId = typeof currentUserId === "function" ? currentUserId : () => null;
  if (installed) return;
  installed = true;

  window.addEventListener("error", (e) => {
    // Resource load failures (a missing image) surface here with no `error`
    // object and are noise, not defects in our code.
    if (!e?.error && !e?.message) return;
    reportError("error", e.message || String(e.error), e.error?.stack);
  });

  window.addEventListener("unhandledrejection", (e) => {
    const r = e?.reason;
    reportError("unhandledrejection", r?.message || String(r), r?.stack);
  });
}
