import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  isChunkLoadError, reloadOnce, reloadPending, reloadingFor, installStaleChunkReload,
  RELOAD_GUARD_MS, RELOAD_WAIT_MS, _resetForTests,
} from "./staleChunkReload.js";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

function counter() {
  const f = () => { f.n += 1; };
  f.n = 0;
  return f;
}

beforeEach(() => _resetForTests());

test("the errors a replaced chunk produces are recognised, in every browser", () => {
  // As production logged it (client_errors, 2026-10-06, build 1dac9613).
  assert.ok(isChunkLoadError(new TypeError("'text/html' is not a valid JavaScript MIME type.")));
  assert.ok(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://residata.eu/assets/Platform-abc.js")));
  assert.ok(isChunkLoadError(new TypeError("error loading dynamically imported module: https://residata.eu/assets/x.js")));
  assert.ok(isChunkLoadError(new TypeError("Importing a module script failed.")));
  assert.ok(isChunkLoadError(new Error("Unable to preload CSS for /assets/index-abc.css")));
  assert.ok(isChunkLoadError("Failed to fetch dynamically imported module: x"));
});

test("other errors are not chunk errors", () => {
  assert.equal(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')")), false);
  assert.equal(isChunkLoadError(new Error("Failed to fetch")), false);   // a data request, not a chunk
  assert.equal(isChunkLoadError(null), false);
  assert.equal(isChunkLoadError(undefined), false);
  assert.equal(isChunkLoadError({}), false);
});

test("the page reloads once, and not again within the guard", () => {
  const storage = memoryStorage();
  const reload = counter();
  const t0 = 1_800_000_000_000;
  assert.equal(reloadOnce({ storage, now: t0, reload }), true);
  assert.equal(reload.n, 1);
  // The reloaded page fails again at once: a chunk really broken, not stale.
  assert.equal(reloadOnce({ storage, now: t0 + 2_000, reload }), false);
  assert.equal(reloadOnce({ storage, now: t0 + RELOAD_GUARD_MS - 1, reload }), false);
  assert.equal(reload.n, 1);
  // A later deploy, hours on, reloads again.
  assert.equal(reloadOnce({ storage, now: t0 + RELOAD_GUARD_MS, reload }), true);
  assert.equal(reload.n, 2);
});

test("a guard stamped in the future (a clock set back) does not block a reload", () => {
  const storage = memoryStorage();
  const reload = counter();
  storage.setItem("residata_chunk_reload_at", String(2_000_000_000_000));
  assert.equal(reloadOnce({ storage, now: 1_800_000_000_000, reload }), true);
  assert.equal(reload.n, 1);
});

test("without session storage there is no guard, so no reload", () => {
  const reload = counter();
  assert.equal(reloadOnce({ storage: null, now: 1, reload }), false);
  const throwing = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); } };
  assert.equal(reloadOnce({ storage: throwing, now: 1, reload }), false);
  const full = { getItem: () => null, setItem() { throw new Error("QuotaExceededError"); } };
  assert.equal(reloadOnce({ storage: full, now: 1, reload }), false);
  assert.equal(reload.n, 0);
  assert.equal(reloadPending(1), false);
});

test("a reload under way is pending for a few seconds only", () => {
  const t0 = 1_800_000_000_000;
  assert.equal(reloadPending(t0), false);
  reloadOnce({ storage: memoryStorage(), now: t0, reload: () => {} });
  assert.equal(reloadPending(t0), true);
  assert.equal(reloadPending(t0 + RELOAD_WAIT_MS - 1), true);
  assert.equal(reloadPending(t0 + RELOAD_WAIT_MS), false);
});

test("a boundary reloads for a chunk error, and keeps its screen for anything else", () => {
  const storage = memoryStorage();
  const reload = counter();
  const t0 = 1_800_000_000_000;
  assert.equal(reloadingFor(new TypeError("x is not a function"), { storage, now: t0, reload }), false);
  assert.equal(reload.n, 0);
  assert.equal(reloadingFor(new TypeError("Importing a module script failed."), { storage, now: t0, reload }), true);
  assert.equal(reload.n, 1);
  // Whatever else throws while the page reloads is not shown either.
  assert.equal(reloadingFor(new TypeError("x is not a function"), { storage, now: t0 + 100, reload }), true);
  assert.equal(reload.n, 1);
  // The reload did not happen (a "leave site?" prompt answered "stay"), and the
  // chunk fails again within the guard: the boundary shows its screen.
  assert.equal(reloadingFor(new TypeError("Importing a module script failed."), { storage, now: t0 + RELOAD_WAIT_MS, reload }), false);
  assert.equal(reload.n, 1);
});

test("Vite's preload error reloads the page for a chunk error only", () => {
  const listeners = {};
  const win = { addEventListener: (type, fn) => { listeners[type] = fn; } };
  const storage = memoryStorage();
  const reload = counter();
  installStaleChunkReload(win, { storage, reload });
  assert.equal(typeof listeners["vite:preloadError"], "function");

  listeners["vite:preloadError"]({ payload: new SyntaxError("Unexpected token '<'") });
  assert.equal(reload.n, 0);
  listeners["vite:preloadError"]({ payload: new TypeError("'text/html' is not a valid JavaScript MIME type.") });
  assert.equal(reload.n, 1);
  // The import still fails for its caller; a second chunk of the same page does
  // not reload again.
  listeners["vite:preloadError"]({ payload: new Error("Unable to preload CSS for /assets/a.css") });
  assert.equal(reload.n, 1);
});

test("installing without a window does nothing", () => {
  assert.doesNotThrow(() => installStaleChunkReload(null));
  assert.doesNotThrow(() => installStaleChunkReload({}));
});
