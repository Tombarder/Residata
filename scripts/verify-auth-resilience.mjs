/**
 * Verification harness for the auth-deadlock fix (src/lib/authResilience.js).
 *
 * Reproduces the "stuck on Loading…, only a page refresh fixes it" deadlock
 * against the REAL @supabase/auth-js GoTrueClient by jamming the token refresh,
 * proves today's behaviour hangs, and proves the fix recovers. No browser /
 * Supabase needed.
 *
 *   node scripts/verify-auth-resilience.mjs
 *
 * Exit 0 = all checks passed; exit 1 = a check failed.
 *
 * Note: test C prints ONE "Error [AbortError]: The operation was aborted" line.
 * That is EXPECTED — it's the fix deliberately aborting the simulated jammed
 * renewal (Node surfaces the timer-tick rejection). The run still exits 0 and
 * every check still reads PASS; it is not a failure.
 */
import { GoTrueClient } from "@supabase/auth-js";
import { createBoundedAuthLock, makeAuthTimeoutFetch } from "../src/lib/authResilience.js";

// The fix deliberately ABORTS a jammed renewal — that abort surfaces as an
// AbortError from the simulated network. It's expected; anything else is a real
// problem and fails the run loudly.
const swallowExpectedAbort = (e) => {
  if (e && e.name === "AbortError") return;
  console.error("unexpected error:", e);
  process.exit(1);
};
process.on("unhandledRejection", swallowExpectedAbort);
process.on("uncaughtException", swallowExpectedAbort);

let failures = 0;
const ok = (name) => console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
const bad = (name, detail) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` — ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const abortError = () => Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
// Resolve to a sentinel if `p` doesn't settle within ms — lets us assert "hangs".
const settledWithin = async (p, ms) => {
  const TIMEOUT = Symbol("timeout");
  const res = await Promise.race([p.then((v) => ({ v }), (e) => ({ e })), sleep(ms).then(() => TIMEOUT)]);
  return res === TIMEOUT ? { timedOut: true } : res;
};

// ── The ORIGINAL lock (pre-fix), to demonstrate the wedge it caused ──────────
const makeLegacyLock = () => {
  let chain = Promise.resolve();
  return (_n, _t, fn) => { const run = chain.then(() => fn(), () => fn()); chain = run.then(() => {}, () => {}); return run; };
};

// ── JWT / session / storage helpers for the real-client test ─────────────────
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (expSec) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u1", role: "authenticated", exp: expSec })}.sig`;
const session = (expiresInSec, rt = "refresh-" + Math.random().toString(36).slice(2)) => {
  const now = Math.floor(Date.now() / 1000), exp = now + expiresInSec;
  return {
    access_token: jwt(exp), refresh_token: rt, expires_in: expiresInSec, expires_at: exp,
    token_type: "bearer",
    user: { id: "u1", aud: "authenticated", role: "authenticated", email: "t@test.io",
      app_metadata: { provider: "email" }, user_metadata: {}, identities: [],
      created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() },
  };
};
const memStorage = (seed) => {
  const store = { ...seed };
  return { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
};
const tokenOk = () => new Response(JSON.stringify({
  access_token: jwt(Math.floor(Date.now() / 1000) + 3600), token_type: "bearer", expires_in: 3600,
  refresh_token: "refreshed-rt", user: session(3600).user,
}), { status: 200, headers: { "content-type": "application/json" } });

// A fetch that hangs on /token until aborted; `okAfter` calls succeed (models a
// transiently-stuck renewal that the fix lets recover instead of hanging).
const tokenFetch = ({ hangCalls = Infinity } = {}) => {
  let calls = 0;
  return (input, init = {}) => {
    const u = typeof input === "string" ? input : input?.url || "";
    if (!u.includes("/token")) return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    calls++;
    if (calls > hangCalls) return Promise.resolve(tokenOk());
    // Hang until the timeout's AbortSignal fires. We POLL the signal rather than
    // using an abort-event listener, so the rejection happens on a normal timer
    // tick (gotrue catches it) instead of synchronously inside Node's abort
    // dispatch, which would print the simulated AbortError as stderr noise.
    const p = new Promise((_res, rej) => {
      const s = init.signal;
      if (!s) return; // no signal → hang forever
      const iv = setInterval(() => { if (s.aborted) { clearInterval(iv); rej(abortError()); } }, 15);
    });
    p.catch(() => {}); // mark handled — gotrue consumes its own chain; silences Node's reporter
    return p;
  };
};

const newClient = (lock, fetch) => new GoTrueClient({
  url: "http://test.local/auth/v1", storageKey: "sb-test-auth-token",
  storage: memStorage({ "sb-test-auth-token": JSON.stringify(session(30)) }), // 30s left → inside the 90s refresh margin
  autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, lock, fetch,
});

async function main() {
  console.log("\n\x1b[1mAuth-resilience verification\x1b[0m\n");

  // ── A. The lock ────────────────────────────────────────────────────────────
  console.log("A. In-tab auth lock");
  {
    const legacy = makeLegacyLock();
    legacy("l", -1, () => new Promise(() => {}));            // op1: never settles (stuck refresh)
    const op2 = legacy("l", -1, () => "ran");                // op2: queued behind it
    const r = await settledWithin(op2, 800);
    r.timedOut ? ok("legacy lock WEDGES a later op behind a stuck one (reproduces the bug)")
               : bad("legacy lock should have wedged op2", JSON.stringify(r));
  }
  {
    const bounded = createBoundedAuthLock({ maxHoldMs: 400 });
    bounded("l", -1, () => new Promise(() => {}));           // op1: never settles
    const op2 = bounded("l", -1, () => "ran");               // op2: must still run
    const r = await settledWithin(op2, 1500);
    (!r.timedOut && r.v === "ran") ? ok("bounded lock SELF-HEALS — a later op runs despite a stuck one")
                                   : bad("bounded lock should have let op2 run", JSON.stringify(r));
  }

  // ── B. The bounded auth fetch ──────────────────────────────────────────────
  console.log("\nB. Bounded auth fetch");
  {
    const hang = () => new Promise((_res, rej) => {}); // base fetch that never settles, ignores signal? add signal:
    const hangSig = (input, init = {}) => new Promise((_res, rej) => {
      const s = init.signal; if (s) s.addEventListener("abort", () => queueMicrotask(() => rej(abortError())), { once: true });
    });
    const f = makeAuthTimeoutFetch(hangSig, { authTimeoutMs: 300 });
    const authReq = settledWithin(f("http://x/auth/v1/token?grant_type=refresh_token").catch((e) => { throw e; }), 1500);
    const r = await authReq;
    (!r.timedOut && r.e && r.e.name === "AbortError") ? ok("auth request is aborted by the timeout (~300ms), never hangs")
                                                       : bad("auth request should have aborted", JSON.stringify(r.e?.name || r));
    const dataReq = await settledWithin(makeAuthTimeoutFetch(hangSig, { authTimeoutMs: 300 })("http://x/rest/v1/flats_current"), 700);
    dataReq.timedOut ? ok("data request is NOT bounded (passes through; paged reads never aborted)")
                     : bad("data request should pass through untouched", JSON.stringify(dataReq));
    void hang;
  }

  // ── C. Real GoTrueClient end-to-end ────────────────────────────────────────
  console.log("\nC. Real @supabase/auth-js GoTrueClient (jammed token refresh)");
  {
    // C1 — TODAY: legacy lock + raw (unbounded) fetch, refresh hangs → getSession never settles.
    const c1 = newClient(makeLegacyLock(), tokenFetch({ hangCalls: Infinity }));
    const r1 = await settledWithin(c1.getSession(), 3000);
    r1.timedOut ? ok("TODAY: getSession() HANGS forever on a stuck refresh (only a reload clears it)")
                : bad("expected today's code to hang", JSON.stringify(r1));
  }
  {
    // C2 — FIXED: bounded lock + bounded fetch, refresh transiently stuck then OK → recovers fast.
    const c2 = newClient(createBoundedAuthLock(), makeAuthTimeoutFetch(tokenFetch({ hangCalls: 1 }), { authTimeoutMs: 600 }));
    const t0 = Date.now();
    const r2 = await settledWithin(c2.getSession(), 8000);
    const ms = Date.now() - t0;
    (!r2.timedOut && r2.v?.data?.session && !r2.v?.error)
      ? ok(`FIXED: getSession() RECOVERS in ~${ms}ms and returns a valid session (no reload needed)`)
      : bad("fixed client should recover with a session", JSON.stringify(r2.v?.error || r2));
  }
  {
    // C3 — FIXED, healthy network: a normal refresh still works (no regression).
    const c3 = newClient(createBoundedAuthLock(), makeAuthTimeoutFetch(tokenFetch({ hangCalls: 0 }), { authTimeoutMs: 600 }));
    const r3 = await settledWithin(c3.getSession(), 5000);
    (!r3.timedOut && r3.v?.data?.session && !r3.v?.error)
      ? ok("FIXED: a normal (healthy) refresh still works — no regression")
      : bad("normal refresh should succeed", JSON.stringify(r3.v?.error || r3));
  }

  console.log(`\n${failures === 0 ? "\x1b[32mALL CHECKS PASSED\x1b[0m" : `\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("harness error:", e); process.exit(1); });
