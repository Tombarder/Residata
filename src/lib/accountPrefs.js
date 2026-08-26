/**
 * accountPrefs — the browser's SINGLE source of truth for an account's saved UI
 * preferences (`user_profiles.ui_prefs` + `user_profiles.pivot_prefs`).
 *
 * ── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────
 * Every settings-bearing page used to hydrate straight from `useAuth().profile`.
 * That object is fetched ONCE (login / page load / window focus) and is never
 * updated when a page saves a preference. So the second time a page mounted —
 * i.e. navigate away and come back, which unmounts and remounts it — it re-applied
 * the PAGE-LOAD snapshot of the account, silently throwing away everything the
 * user had set since, and writing that stale value back over the localStorage
 * cache as well. Symptom (Boss, 2026-08-26): "the Analytics settings are wiped the
 * moment I go to another page and come back, I have to set them up every time."
 * The saving was never broken — the RESTORING read a frozen copy of the account.
 *
 * The fix is to give the account's preferences ONE owner in the browser. This
 * module is seeded from the profile the first time an account's profile loads,
 * and from then on it — not the React `profile` object — is what pages read and
 * write. A later profile re-fetch never clobbers it: the server can only ever be
 * behind what the user just chose here.
 *
 * ── GUARANTEES ─────────────────────────────────────────────────────────────
 * · A choice is authoritative the instant it is made — a remount, a slow network
 *   or a failed request can no longer revert it.
 * · Nothing is lost when a write does not reach the server: the value is kept in
 *   localStorage AND recorded as unconfirmed, so the next page load prefers it
 *   over the account's older copy and re-sends it.
 * · Cross-device still works: the account is what seeds a fresh browser.
 * · Anonymous visitors keep a per-browser cache only; nothing is ever written for
 *   them.
 */
/**
 * The account write itself. Imported lazily so this module stays loadable outside a
 * browser (the tests exercise the store without a Supabase client) and injectable so
 * they can assert what would be sent.
 */
let transport = null;
async function rpc(fn, args) {
  if (!transport) ({ supabaseData: transport } = await import("./supabase"));
  return transport.rpc(fn, args);
}
/** Test seam — swap in a fake `{ rpc(fn, args) }` (never used by the app). */
export function __setTransportForTests(t) { transport = t; }

const UI_LS_PREFIX    = "residata.pref.";              // residata.pref.<key>.<scope>
const PIVOT_LS_PREFIX = "residata.pivotV2.state.v2.";  // residata.pivotV2.state.v2.<scope>
const UNSENT_PREFIX   = "residata.prefsync.";          // residata.prefsync.<scope> → ["key", …]
const PIVOT_KEY       = "__pivot";                     // the pivot blob's key inside a scope
const WRITE_DEBOUNCE_MS = 600;

/** scopeId → { seeded, ui: {key: value}, pivot } */
const scopes = new Map();
/** scopeId → Map(key → value) still owed to the server */
const outbox = new Map();
let flushTimer = null;

const isAnon = (scopeId) => !scopeId || scopeId === "anon";

/* ── localStorage helpers (best-effort: private mode / quota must never throw) ── */
const lsKey = (key, scopeId) =>
  key === PIVOT_KEY ? PIVOT_LS_PREFIX + (scopeId || "anon") : UI_LS_PREFIX + key + "." + (scopeId || "anon");

function lsRead(key, scopeId) {
  try {
    const raw = localStorage.getItem(lsKey(key, scopeId));
    return raw ? JSON.parse(raw) : undefined;
  } catch { return undefined; }
}
function lsWrite(key, scopeId, value) {
  try { localStorage.setItem(lsKey(key, scopeId), JSON.stringify(value)); } catch { /* ignore */ }
}

/* ── unconfirmed set: keys whose local value has not been acknowledged by the server ── */
function unsentRead(scopeId) {
  try {
    const raw = localStorage.getItem(UNSENT_PREFIX + scopeId);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? new Set(v) : new Set();
  } catch { return new Set(); }
}
function unsentWrite(scopeId, set) {
  try {
    if (set.size) localStorage.setItem(UNSENT_PREFIX + scopeId, JSON.stringify([...set]));
    else localStorage.removeItem(UNSENT_PREFIX + scopeId);
  } catch { /* ignore */ }
}
function unsentMark(scopeId, key) { const s = unsentRead(scopeId); s.add(key); unsentWrite(scopeId, s); }
function unsentClear(scopeId, key) { const s = unsentRead(scopeId); if (s.delete(key)) unsentWrite(scopeId, s); }

/**
 * Key-order-independent serialization, used ONLY to decide "is this actually a
 * change?". A value that survives a round-trip through jsonb comes back with its
 * keys in a different order than the page built them in — comparing raw JSON
 * would report a change on every single mount and write the same content forever.
 */
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}
const same = (a, b) => stableStringify(a) === stableStringify(b);

function scopeOf(scopeId) {
  let s = scopes.get(scopeId);
  if (!s) { s = { seeded: false, ui: {}, pivot: undefined }; scopes.set(scopeId, s); }
  return s;
}

/**
 * Seed an account's store from its freshly-loaded profile row. Runs ONCE per
 * account per page load; later profile re-fetches (the window-focus reload) are
 * ignored, because by then this store — not the server — holds the user's latest
 * choices.
 *
 * A key recorded as unconfirmed (a write that never reached the server) is taken
 * from localStorage instead of from the account, and re-queued, so a network blip
 * cannot quietly roll a setting back on the next visit.
 */
export function seedAccount(scopeId, profile) {
  const s = scopeOf(scopeId);
  if (s.seeded) return s;
  const ui = (profile && profile.ui_prefs && typeof profile.ui_prefs === "object") ? profile.ui_prefs : {};
  s.ui = { ...ui };
  s.pivot = profile ? (profile.pivot_prefs ?? undefined) : undefined;
  s.seeded = true;

  if (!isAnon(scopeId)) {
    // FIRST, take back anything this browser chose that the server never acknowledged:
    // the account's copy of that key is simply older, and must not win. (Order matters —
    // refreshing the cache before this ran would erase the very value being recovered.)
    for (const key of unsentRead(scopeId)) {
      const local = lsRead(key, scopeId);
      if (local === undefined) { unsentClear(scopeId, key); continue; }
      if (key === PIVOT_KEY) s.pivot = local; else s.ui[key] = local;
      queueWrite(scopeId, key, local);          // re-send what never landed
    }
    // THEN republish the resolved truth to the per-browser cache, so the copy that
    // paints the first frame can never be older than the store. (Two copies allowed to
    // drift is what produced this bug in the first place.)
    for (const [key, value] of Object.entries(s.ui)) lsWrite(key, scopeId, value);
    if (s.pivot !== undefined && s.pivot !== null) lsWrite(PIVOT_KEY, scopeId, s.pivot);
  }
  return s;
}

/** Seed the anonymous scope (no account, no writes — the per-browser cache only). */
export function seedAnon() { return seedAccount("anon", null); }

export function isSeeded(scopeId) { return !!scopes.get(scopeId)?.seeded; }

/**
 * Read a preference for a scope.
 * @returns {{value: any, source: "account"|"local"|null}} — `local` means the
 *   account has nothing saved but this browser does (a choice made before this
 *   preference was synced at all); the caller back-fills it so the user's other
 *   devices get it too.
 */
export function readPref(scopeId, key) {
  const s = scopeOf(scopeId);
  const held = key === PIVOT_KEY ? s.pivot : s.ui[key];
  if (held !== undefined && held !== null) return { value: held, source: "account" };
  const local = lsRead(key, scopeId);
  if (local !== undefined && local !== null) return { value: local, source: "local" };
  return { value: undefined, source: null };
}

/**
 * Record a preference. The store and the per-browser cache take it immediately —
 * so it is already the truth for any page that mounts next — and the account
 * write is debounced behind it. An unchanged value is a no-op, so re-applying a
 * hydrated value never causes a write.
 */
export function writePref(scopeId, key, value) {
  const s = scopeOf(scopeId);
  const held = key === PIVOT_KEY ? s.pivot : s.ui[key];
  if (held !== undefined && same(held, value)) return false;
  if (key === PIVOT_KEY) s.pivot = value; else s.ui[key] = value;
  lsWrite(key, scopeId, value);
  if (isAnon(scopeId)) return true;              // anon → this browser only
  unsentMark(scopeId, key);
  queueWrite(scopeId, key, value);
  return true;
}

/**
 * Record a value the user did not choose — the page's own default, on an account
 * that has never saved this preference. It becomes what a remount reads, so the
 * page stays put, but it is NOT sent and NOT cached: an account with nothing saved
 * must stay that way until someone actually picks something, or the first device to
 * open the app would publish its defaults to every other one.
 */
export function adoptPref(scopeId, key, value) {
  const s = scopeOf(scopeId);
  if (key === PIVOT_KEY) { if (s.pivot === undefined || s.pivot === null) s.pivot = value; }
  else if (s.ui[key] === undefined || s.ui[key] === null) s.ui[key] = value;
}

/* ── the outbox: what still has to reach the server ───────────────────────── */
function queueWrite(scopeId, key, value) {
  let box = outbox.get(scopeId);
  if (!box) { box = new Map(); outbox.set(scopeId, box); }
  box.set(key, value);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushPending, WRITE_DEBOUNCE_MS);
}

/**
 * Send everything the outbox owes the server. A key stays in the outbox (and
 * stays marked unconfirmed) until the server acknowledges it, so a failure
 * retries on the next change, the next flush, or the next page load.
 */
export function flushPending() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  for (const [scopeId, box] of outbox) {
    if (isAnon(scopeId) || box.size === 0) continue;
    for (const [key, value] of [...box]) {
      const call = key === PIVOT_KEY
        ? rpc("set_pivot_prefs", { p_prefs: value })
        : rpc("set_ui_pref", { p_key: key, p_value: value });
      call.then(
        ({ error }) => {
          if (error) { console.warn(`pref "${key}" sync failed:`, error.message); return; }
          // Only drop it once the server has it — and only if it is still the
          // value we sent (a newer change re-queues itself).
          const current = box.get(key);
          if (current !== undefined && same(current, value)) { box.delete(key); unsentClear(scopeId, key); }
        },
        (e) => console.warn(`pref "${key}" sync error:`, e?.message || e),
      );
    }
  }
}

// A tab being hidden or closed is the last chance to send a change the debounce
// is still holding. The value is safe locally either way — this is what gets it
// to the user's other devices.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", flushPending);
  window.addEventListener("visibilitychange", () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") flushPending();
  });
}

/** Test seam — drop all in-memory state (never used by the app). */
export function __resetForTests() {
  scopes.clear(); outbox.clear();
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}

export { PIVOT_KEY };
