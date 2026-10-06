/**
 * The 7-day trial: who may start it, the one atomic write, and the sign-up
 * request the welcome webhook honours (2026-10-06 — the welcome e-mail used to
 * offer a trial that was already running, and two simultaneous starts could
 * both write).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { trialRefusal, trialJustStarted, trialIntentValid, startTrialRow, TRIAL_DAYS } from "./trialRules.js";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const ok = { tier: "free", profile_completed: true };

test("who may start a trial", () => {
  assert.equal(trialRefusal(ok, NOW), null);
  assert.equal(trialRefusal({ ...ok, tier: "pending" }, NOW).status, 403, "no access yet: the intent must survive");
  assert.equal(trialRefusal({ ...ok, profile_completed: false }, NOW).error, "profile_incomplete");
  assert.equal(trialRefusal({ ...ok, tier: "paid" }, NOW).status, 409);
  assert.equal(trialRefusal({ ...ok, tier: "admin" }, NOW).status, 409);
  assert.equal(trialRefusal({ ...ok, paid_until: iso(NOW + 86400e3) }, NOW).status, 409, "Premium by date needs no trial");
  assert.equal(trialRefusal({ ...ok, paid_until: iso(NOW - 86400e3) }, NOW), null, "an ended Premium does not block it");
  assert.equal(trialRefusal({ ...ok, trial_started_at: iso(NOW - 30 * 86400e3) }, NOW).error, "trial already used");
  assert.equal(trialRefusal(null, NOW).status, 404);
});

test("a start moments after the first is the same request, not a refusal", () => {
  const started = (agoMin) => ({ trial_started_at: iso(NOW - agoMin * 60e3), trial_until: iso(NOW - agoMin * 60e3 + TRIAL_DAYS * 86400e3) });
  assert.equal(trialJustStarted(started(1), NOW), true);
  assert.equal(trialJustStarted(started(20), NOW), false, "a trial started long ago is 'already used'");
  assert.equal(trialJustStarted({ trial_started_at: iso(NOW - 60e3), trial_until: iso(NOW - 1) }, NOW), false);
  assert.equal(trialJustStarted({}, NOW), false);
});

test("the trial asked for at sign-up counts for a day, then never", () => {
  assert.equal(trialIntentValid(iso(NOW - 3600e3), NOW), true);
  assert.equal(trialIntentValid(iso(NOW - 25 * 3600e3), NOW), false);
  assert.equal(trialIntentValid("1", NOW), false, "the old bare flag has no moment");
  assert.equal(trialIntentValid(undefined, NOW), false);
  assert.equal(trialIntentValid(iso(NOW + 3600e3), NOW), false, "a moment in the future is not a request");
});

test("the write starts the trial only while none has been started — atomic", async () => {
  const calls = [];
  const chain = {
    update(v) { calls.push(["update", v]); return chain; },
    eq(c, v) { calls.push(["eq", c, v]); return chain; },
    is(c, v) { calls.push(["is", c, v]); return chain; },
    select() { return Promise.resolve({ data: [{ id: "u1", trial_until: "x" }], error: null }); },
  };
  const admin = { from: (t) => { calls.push(["from", t]); return chain; } };
  const row = await startTrialRow(admin, "u1", NOW);
  assert.equal(row.id, "u1");
  assert.deepEqual(calls.find((c) => c[0] === "is"), ["is", "trial_started_at", null]);
  const v = calls.find((c) => c[0] === "update")[1];
  assert.equal(Date.parse(v.trial_until) - Date.parse(v.trial_started_at), TRIAL_DAYS * 86400e3);
});

test("someone else got there first → null, not a second trial", async () => {
  const chain = { update: () => chain, eq: () => chain, is: () => chain, select: () => Promise.resolve({ data: [], error: null }) };
  assert.equal(await startTrialRow({ from: () => chain }, "u1", NOW), null);
});
