/**
 * The auth client must not wedge on a token refresh (lib/authStateHandler.js).
 *
 * 🔴 2026-10-06: after a token refresh, every save on the AUTH client waited
 * forever and sent nothing — Boss's admin "paid" click among them. These tests
 * run the REAL @supabase/supabase-js (the version in package-lock) with our own
 * lock (authResilience.createBoundedAuthLock) against a fake network, so they
 * judge the library's actual locking, not a model of it.
 *
 * The first test is the control: it shows the harness CAN see the deadlock, by
 * registering the callback in the shape it had before the fix. If a library
 * upgrade ever stops calling callbacks inside its lock, the control fails and
 * says so — a guard that can no longer fail must not quietly keep passing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { createBoundedAuthLock } from "./authResilience.js";
import { createAuthStateHandler } from "./authStateHandler.js";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const nowS = () => Math.floor(Date.now() / 1000);
const USER = { id: "00000000-0000-0000-0000-0000000000a1", aud: "authenticated", email: "probe@residata.invalid" };
const session = (exp) => ({
  access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, exp, role: "authenticated", aud: "authenticated" })}.sig`,
  refresh_token: `r${exp}${Math.random()}`, token_type: "bearer", expires_in: 3600, expires_at: exp, user: USER,
});

function harness() {
  const sent = [];
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const fetch = async (input) => {
    const url = String(input?.url || input);
    if (url.includes("/auth/v1/token")) return json(session(nowS() + 3600));
    if (url.includes("/auth/v1/user")) return json(USER);
    if (url.includes("/rest/v1/")) { sent.push(url); return json([]); }
    return new Response("{}", { status: 404 });
  };
  const mem = { "sb-probe-auth-token": JSON.stringify(session(nowS() + 3600)) };
  const storage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }, removeItem: (k) => { delete mem[k]; } };
  // A short self-heal cap keeps the control from holding the test process for 35 s;
  // it does not rescue the deadlock (that queue sits beneath this lock — see the
  // control's assertion).
  const client = createClient("http://probe.supabase.co", "anon", {
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
            storage, storageKey: "sb-probe-auth-token", lock: createBoundedAuthLock({ maxHoldMs: 1500 }) },
    global: { fetch },
  });
  return { client, sent };
}

const settles = (p, ms) => Promise.race([p.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), ms))]);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const profileRead = (client, id) => client.from("user_profiles").select("*").eq("id", id).maybeSingle();

test("control: a callback that awaits a query wedges the auth client on a token refresh", async () => {
  const { client, sent } = harness();
  client.auth.onAuthStateChange(async (_event, s) => { if (s?.user) await profileRead(client, s.user.id); });
  await pause(50);
  client.auth.refreshSession();
  await pause(50);
  const wrote = await settles(client.from("user_profiles").update({ tier: "paid" }).eq("id", "x").select(), 2500);
  assert.equal(wrote, false,
    "the old callback shape no longer deadlocks this supabase-js — re-check authStateHandler.js's reasoning before trusting the next test");
  assert.equal(sent.length, 0, "nothing should have left the 'browser' while wedged");
});

test("the app's handler leaves the auth client usable after a token refresh", async () => {
  const { client, sent } = harness();
  let profileLoads = 0;
  let loading = false;
  client.auth.onAuthStateChange(createAuthStateHandler({
    setUser: () => {}, setProfile: () => {}, setProfileError: () => {},
    setLoading: (v) => { loading = v; },
    hasProfile: () => true,
    // Deliberately the worst case: the profile read on the AUTH client itself.
    loadProfile: async (id) => { profileLoads += 1; await profileRead(client, id); },
  }));
  await pause(50);
  assert.equal(await settles(client.auth.refreshSession(), 2500), true, "the token refresh itself must finish");
  assert.equal(await settles(client.from("user_profiles").update({ tier: "paid" }).eq("id", "x").select(), 2500), true,
    "a write after the refresh must go out");
  assert.equal(await settles(client.auth.getSession(), 2500), true);
  await pause(50);
  assert.ok(profileLoads >= 1, "the deferred profile load must still run");
  assert.ok(sent.some((u) => u.includes("user_profiles")), "requests actually reached the network");
  assert.equal(loading, false);
});

test("the handler returns synchronously — gotrue awaits it inside its lock", () => {
  const handler = createAuthStateHandler({
    setUser: () => {}, setProfile: () => {}, setProfileError: () => {}, setLoading: () => {},
    hasProfile: () => false, loadProfile: async () => {}, defer: () => {},
  });
  assert.equal(handler("SIGNED_IN", { user: USER }), undefined, "must not return a promise");
});

test("a fresh login raises loading until the deferred profile load finishes", async () => {
  const calls = [];
  let run;
  const handler = createAuthStateHandler({
    setUser: (u) => calls.push(["user", u?.id || null]),
    setProfile: () => calls.push(["profile", null]),
    setProfileError: () => {},
    setLoading: (v) => calls.push(["loading", v]),
    hasProfile: () => false,
    loadProfile: async (id) => { calls.push(["load", id]); },
    defer: (fn) => { run = fn; },
  });
  handler("SIGNED_IN", { user: USER });
  assert.deepEqual(calls, [["user", USER.id], ["loading", true]], "nothing async may run inside the lock");
  run();
  await pause(0);
  assert.deepEqual(calls.slice(2), [["load", USER.id], ["loading", false]]);
});

test("signing out clears the profile without scheduling anything", () => {
  const calls = [];
  const handler = createAuthStateHandler({
    setUser: (u) => calls.push(["user", u]), setProfile: (p) => calls.push(["profile", p]),
    setProfileError: (e) => calls.push(["err", e]), setLoading: () => calls.push(["loading"]),
    hasProfile: () => true, loadProfile: async () => calls.push(["load"]),
    defer: () => calls.push(["deferred"]),
  });
  handler("SIGNED_OUT", null);
  assert.deepEqual(calls, [["user", null], ["profile", null], ["err", null]]);
});
