// Every visit opens on the whole market (Boss 2026-10-07). A pick lasts for the
// visit; a pick an older build stored for ever must never come back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startingCountry, ALL_COUNTRIES } from "./marketStart.js";

const store = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v),
           removeItem: (k) => m.delete(k), has: (k) => m.has(k) };
};

test("a new visit opens on all markets", () => {
  assert.equal(startingCountry(store(), store()), ALL_COUNTRIES);
});

test("an old for-ever pick of one country is erased, not used", () => {
  const local = store({ residata_country: "SK", residata_country_all_default_v1: "1" });
  assert.equal(startingCountry(store(), local), ALL_COUNTRIES);
  assert.equal(local.has("residata_country"), false);
});

test("a pick made during this visit survives a reload of the visit", () => {
  assert.equal(startingCountry(store({ residata_country_visit: "CZ" }), store()), "CZ");
});

test("no storage at all (private mode) still opens on all markets", () => {
  assert.equal(startingCountry(null, null), ALL_COUNTRIES);
});
