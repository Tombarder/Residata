/**
 * resolveAccess — what a profile actually grants (lib/access.js). The admin panel
 * shows it next to the raw tier since 2026-10-06, so it must be the same rule the
 * site enforces for the user (useCapabilities) and the database enforces
 * (public.current_user_is_paid).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAccess } from "./access.js";

const NOW = Date.parse("2026-10-06T12:00:00Z");
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();
const eff = (tier, p = {}) => resolveAccess(tier, p, NOW).effectiveTier;

test("tier 'paid' with no end date is paid (manual / legacy accounts)", () => {
  assert.equal(eff("paid"), "paid");
});
test("a paid window grants paid even on a free tier, and ends when it ends", () => {
  assert.equal(eff("free", { paid_until: iso(NOW + DAY) }), "paid");
  assert.equal(eff("paid", { paid_until: iso(NOW - DAY) }), "free");
});
test("a pause removes paid access whatever the dates say", () => {
  assert.equal(eff("paid", { paid_until: iso(NOW + 30 * DAY), paid_pause_started: iso(NOW - DAY) }), "free");
});
test("a trial grants paid to a free user, never to a pending one", () => {
  assert.equal(eff("free", { trial_until: iso(NOW + DAY) }), "paid");
  assert.equal(eff("pending", { trial_until: iso(NOW + DAY) }), "pending");
});
test("admin is admin", () => {
  assert.equal(eff("admin", { paid_until: iso(NOW - DAY), paid_pause_started: iso(NOW) }), "admin");
});
test("flags agree with the tier", () => {
  const a = resolveAccess("free", { trial_until: iso(NOW + DAY) }, NOW);
  assert.equal(a.trialActive, true);
  assert.equal(a.paidActive, false);
  const b = resolveAccess("paid", { paid_until: iso(NOW + DAY) }, NOW);
  assert.equal(b.paidWindowActive, true);
  assert.equal(b.paidActive, true);
});
