/**
 * The trial banner is decided before the first paint (lib/trialBannerState),
 * so it is drawn in the app's first frame instead of pushing the fixed nav down
 * one frame later — the layout shift Lighthouse measured on every marketing page.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { firstPaintBanner, hasStoredSession, KEY_BANNER_DISMISSED, KEY_OFFER_REMEMBERED } from "./trialBannerState.js";

function store(entries = {}) {
  const m = new Map(Object.entries(entries));
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => (m.has(k) ? m.get(k) : null) };
}
const NOW = Date.parse("2026-09-28T12:00:00Z");
const SESSION = { "sb-mtclsrswxtjseewyrcbx-auth-token": "{}" };

test("an anonymous visitor is offered the trial from the first frame", () => {
  assert.deepEqual(firstPaintBanner(store(), NOW), { dismissed: false, eligible: true });
});

test("a dismissal stands until it expires", () => {
  assert.equal(firstPaintBanner(store({ [KEY_BANNER_DISMISSED]: String(NOW + 1000) }), NOW).dismissed, true);
  assert.equal(firstPaintBanner(store({ [KEY_BANNER_DISMISSED]: String(NOW - 1000) }), NOW).dismissed, false);
});

test("a logged-in visitor gets the answer remembered from the last visit, never a guess", () => {
  assert.equal(hasStoredSession(store(SESSION)), true);
  assert.equal(hasStoredSession(store({ "sb-x-something-else": "1", residata_lang: "sk" })), false);
  assert.equal(firstPaintBanner(store(SESSION), NOW).eligible, false, "nothing remembered: not shown until the profile says so");
  assert.equal(firstPaintBanner(store({ ...SESSION, [KEY_OFFER_REMEMBERED]: "1" }), NOW).eligible, true);
  assert.equal(firstPaintBanner(store({ ...SESSION, [KEY_OFFER_REMEMBERED]: "0" }), NOW).eligible, false);
});

test("blocked storage reads as an anonymous visitor, not a crash", () => {
  const blocked = { get length() { throw new Error("SecurityError"); }, key() { throw new Error("x"); }, getItem() { throw new Error("x"); } };
  assert.deepEqual(firstPaintBanner(blocked, NOW), { dismissed: false, eligible: true });
});
