/**
 * The account preference store — the rules that keep a user's settings from being
 * thrown away.
 *
 * The bug these lock down (2026-08-26): every settings page hydrated from the
 * `profile` object, which is fetched once per page load and never refreshed after a
 * save. Navigating away and back remounted the page, which re-applied that page-load
 * snapshot over whatever the user had set since — so in Analytics no setting ever
 * survived a click to another page.
 */
import test from "node:test";
import assert from "node:assert/strict";

// Minimal browser globals — the store touches localStorage and registers unload
// listeners at import time, so they must exist BEFORE the dynamic import below.
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.window = { addEventListener() {} };
globalThis.document = { visibilityState: "visible" };

const {
  seedAccount, seedAnon, isSeeded, readPref, writePref, adoptPref, flushPending,
  stableStringify, __resetForTests, __setTransportForTests, PIVOT_KEY,
} = await import("./accountPrefs.js");

const USER = "user-1";
const profileWith = (ui, pivot) => ({ id: USER, ui_prefs: ui, pivot_prefs: pivot });

function fresh({ ok = true } = {}) {
  mem.clear();
  __resetForTests();
  const sent = [];
  __setTransportForTests({
    rpc: (fn, args) => { sent.push({ fn, args }); return Promise.resolve(ok ? {} : { error: { message: "offline" } }); },
  });
  return sent;
}

test("stableStringify ignores key order, so a jsonb round-trip is not a change", () => {
  assert.equal(stableStringify({ a: 1, b: [2, { d: 4, c: 3 }] }), stableStringify({ b: [2, { c: 3, d: 4 }], a: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
});

test("a change survives a remount — it is not reverted to the page-load snapshot", () => {
  fresh();
  const profile = profileWith({ salesFilters: { groupBy: "city" } });
  seedAccount(USER, profile);
  assert.deepEqual(readPref(USER, "salesFilters").value, { groupBy: "city" });

  writePref(USER, "salesFilters", { groupBy: "project_name" });

  // Remounting re-runs hydration with the SAME (now stale) profile object, because
  // nothing refetches it mid-session. The store must ignore it.
  seedAccount(USER, profile);
  assert.deepEqual(readPref(USER, "salesFilters").value, { groupBy: "project_name" });
  assert.equal(readPref(USER, "salesFilters").source, "account");
});

test("re-applying a hydrated value writes nothing", () => {
  const sent = fresh();
  seedAccount(USER, profileWith({ explorerFilters: { pMin: "1", pMax: "2" } }));
  // Same content, keys in the other order — what a page rebuilds after apply().
  assert.equal(writePref(USER, "explorerFilters", { pMax: "2", pMin: "1" }), false);
  flushPending();
  assert.deepEqual(sent, []);
});

test("the account seeds a fresh browser; a local-only choice is offered for back-fill", () => {
  fresh();
  localStorage.setItem("residata.pref.mapFilters.user-1", JSON.stringify({ fCity: "Brno" }));
  seedAccount(USER, profileWith({}));
  const got = readPref(USER, "mapFilters");
  assert.deepEqual(got.value, { fCity: "Brno" });
  assert.equal(got.source, "local", "the account has nothing → the page pushes this up");
});

test("a write that never reached the server wins over the account's older copy", async () => {
  fresh({ ok: false });                       // every RPC fails
  seedAccount(USER, profileWith({ reportsFilters: { scope: "market" } }));
  writePref(USER, "reportsFilters", { scope: "developer" });
  flushPending();
  await new Promise((r) => setTimeout(r, 0));

  // Reload: in-memory state is gone (localStorage is not), the account still says
  // "market" — the newer local value must survive, and must be sent again.
  __resetForTests();
  const resent = [];
  __setTransportForTests({ rpc: (fn, args) => { resent.push({ fn, args }); return Promise.resolve({}); } });
  seedAccount(USER, profileWith({ reportsFilters: { scope: "market" } }));
  assert.deepEqual(readPref(USER, "reportsFilters").value, { scope: "developer" });
  flushPending();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(resent, [{ fn: "set_ui_pref", args: { p_key: "reportsFilters", p_value: { scope: "developer" } } }]);

  // Once acknowledged it stops being resent, and the account is now the truth.
  __resetForTests();
  const after = [];
  __setTransportForTests({ rpc: (fn, args) => { after.push({ fn, args }); return Promise.resolve({}); } });
  seedAccount(USER, profileWith({ reportsFilters: { scope: "developer" } }));
  flushPending();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(after, []);
});

test("the pivot setup goes to its own column, and everything else to ui_prefs", async () => {
  const sent = fresh();
  seedAccount(USER, profileWith({}, { rows: ["country"] }));
  assert.deepEqual(readPref(USER, PIVOT_KEY).value, { rows: ["country"] });
  writePref(USER, PIVOT_KEY, { rows: ["country", "city"] });
  writePref(USER, "usageDays", { days: 30 });
  flushPending();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent.map((s) => s.fn).sort(), ["set_pivot_prefs", "set_ui_pref"]);
});

test("an anonymous visitor is cached in this browser and never written to an account", async () => {
  const sent = fresh();
  seedAnon();
  assert.ok(isSeeded("anon"));
  writePref("anon", "salesFilters", { groupBy: "city" });
  flushPending();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, []);
  assert.deepEqual(readPref("anon", "salesFilters").value, { groupBy: "city" });
});

test("a page's own defaults are held for the session but never published", async () => {
  const sent = fresh();
  seedAccount(USER, profileWith({}));
  assert.equal(readPref(USER, "salesFilters").source, null, "nothing saved anywhere yet");

  adoptPref(USER, "salesFilters", { groupBy: "city" });     // the page's opening state
  flushPending();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, [], "an account that saved nothing stays empty");
  // …but a remount still finds it, so the page does not jump around.
  assert.deepEqual(readPref(USER, "salesFilters").value, { groupBy: "city" });

  // The user's first real choice IS published.
  writePref(USER, "salesFilters", { groupBy: "developer" });
  flushPending();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, [{ fn: "set_ui_pref", args: { p_key: "salesFilters", p_value: { groupBy: "developer" } } }]);
});

test("adopting never overwrites what the account already saved", () => {
  fresh();
  seedAccount(USER, profileWith({ usageDays: { days: 90 } }));
  adoptPref(USER, "usageDays", { days: 30 });
  assert.deepEqual(readPref(USER, "usageDays").value, { days: 90 });
});
