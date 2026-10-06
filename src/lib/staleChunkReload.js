/**
 * staleChunkReload — a tab left open across a deploy loads the new build once,
 * instead of showing the error screen.
 *
 * Every deploy replaces the hashed chunk files. A tab still running the previous
 * build asks for a chunk that no longer exists the next time it opens a lazily
 * loaded page (/app, the map, the analyses…). The host answers with index.html
 * and the import fails — "'text/html' is not a valid JavaScript MIME type"
 * (client_errors, 2026-10-06, build 1dac9613, /app). One reload fetches the
 * current build, and the page opens as asked.
 *
 * Once only: no second reload within RELOAD_GUARD_MS of the last one, so a chunk
 * that is really broken still reaches the error screen (and is reported) instead
 * of looping. The guard lives in sessionStorage; without it there is no guard,
 * so there is no reload either.
 *
 * Two ways in, both covered:
 * - Vite's `vite:preloadError` event, raised for every lazy import the build
 *   wraps in its preload helper (all of App.jsx's and Platform.jsx's routes).
 *   installStaleChunkReload() listens for it.
 * - An error boundary that catches a chunk error the event did not carry, or any
 *   error while the reload is under way: reloadingFor() tells it to show nothing
 *   and report nothing, for at most RELOAD_WAIT_MS (a "leave site?" prompt the
 *   user answers with "stay" keeps the page; the boundary then shows its screen).
 */

const KEY = "residata_chunk_reload_at";
export const RELOAD_GUARD_MS = 60_000;
export const RELOAD_WAIT_MS = 5_000;

const PATTERNS = [
  /failed to fetch dynamically imported module/i,   // Chromium, chunk missing
  /is not a valid javascript mime type/i,           // Chromium, chunk answered with index.html
  /error loading dynamically imported module/i,     // Firefox
  /importing a module script failed/i,              // Safari
  /unable to preload css/i,                         // Vite's CSS preload
];

/** True for the errors a missing or replaced chunk produces. */
export function isChunkLoadError(err) {
  const msg = typeof err === "string" ? err : err?.message;
  if (!msg) return false;
  return PATTERNS.some((re) => re.test(String(msg)));
}

let requestedAt = 0;

function defaultStorage() {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;   // blocked storage throws on access
  }
}

function defaultReload() {
  window.location.reload();
}

/**
 * Reload the page, unless this session already did so within RELOAD_GUARD_MS.
 * Returns true when a reload was started. Never throws.
 */
export function reloadOnce({ storage = defaultStorage(), now = Date.now(), reload = defaultReload } = {}) {
  try {
    if (!storage) return false;
    const last = Number(storage.getItem(KEY) || 0);
    if (last > 0 && now >= last && now - last < RELOAD_GUARD_MS) return false;
    storage.setItem(KEY, String(now));
    requestedAt = now;
    reload();
    return true;
  } catch {
    return false;
  }
}

/** A reload for a stale chunk was started within the last RELOAD_WAIT_MS. */
export function reloadPending(now = Date.now()) {
  return requestedAt > 0 && now >= requestedAt && now - requestedAt < RELOAD_WAIT_MS;
}

/**
 * For an error boundary: true when the page is reloading — already (the event
 * listener started it, or an earlier boundary did) or now (a chunk error caught
 * here). The boundary then shows nothing and reports nothing.
 */
export function reloadingFor(err, opts = {}) {
  const now = opts.now ?? Date.now();
  if (reloadPending(now)) return true;
  return isChunkLoadError(err) && reloadOnce({ ...opts, now });
}

/** Listen for Vite's preload errors. Call once, before the app mounts. */
export function installStaleChunkReload(win = typeof window !== "undefined" ? window : null, opts = {}) {
  if (!win || typeof win.addEventListener !== "function") return;
  win.addEventListener("vite:preloadError", (e) => {
    // The error still reaches its caller (the boundary shows nothing while the
    // page reloads); nothing else changes for an import that failed for another reason.
    if (isChunkLoadError(e?.payload)) reloadOnce(opts);
  });
}

/** Tests only: forget the reload this module started. */
export function _resetForTests() {
  requestedAt = 0;
}
