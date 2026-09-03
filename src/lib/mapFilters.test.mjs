/**
 * Tests for mapFilters — run with:  node --test src/lib/mapFilters.test.mjs
 * Zero-dependency (node:test + node:assert).
 *
 * Focus: the CONTRACT between a saved filter and the code that has to honour it
 * later. A user's conditions live in the database (user_dashboards JSONB, ui_prefs)
 * and outlive the FIELDS list they were written against — `country` was removed on
 * purpose, and one account's saved dashboard still held a condition naming it,
 * which showed up as an unfixable empty row in the filter editor (found live
 * 2026-08-19). pruneStale is what stops that, so it gets tested.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pruneStale, isComplete, applyFilters, FIELD_BY_KEY } from "./mapFilters.js";

const c = (field, op, value) => ({ id: `${field}-${op}`, field, op, value });
const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };

// ── pruneStale ───────────────────────────────────────────────────────────────
test("keeps a condition whose field and operator both still exist", () => {
  const live = [c("city", "in", ["Bratislava"]), c("ppm2", "between", ["3000", "6000"])];
  assert.deepEqual(pruneStale(live), live);
});

test("drops a condition naming a field that no longer exists (the country case)", () => {
  const kept = quiet(() => pruneStale([c("country", "in", ["SK"]), c("city", "in", ["Brno"])]));
  assert.deepEqual(kept.map((x) => x.field), ["city"]);
});

test("drops a condition whose operator is not valid for its field's type", () => {
  // "between" is a number operator; city is a category → the pair is unhonourable
  const kept = quiet(() => pruneStale([c("city", "between", [1, 2])]));
  assert.deepEqual(kept, []);
});

test("survives junk: null, undefined, non-array, missing keys", () => {
  assert.deepEqual(pruneStale(null), []);
  assert.deepEqual(pruneStale(undefined), []);
  assert.deepEqual(pruneStale("not an array"), []);
  assert.deepEqual(quiet(() => pruneStale([null, {}, { field: "city" }])), []);
});

test("is idempotent — pruning a pruned array changes nothing", () => {
  const once = quiet(() => pruneStale([c("country", "in", ["SK"]), c("developer", "set", null)]));
  assert.deepEqual(pruneStale(once), once);
});

test("warns once, naming what it dropped, so the next field rename is noticeable", () => {
  const seen = [];
  const w = console.warn;
  console.warn = (m) => seen.push(String(m));
  try { pruneStale([c("country", "in", ["SK"])]); } finally { console.warn = w; }
  assert.equal(seen.length, 1);
  assert.match(seen[0], /country/);
});

test("a pruned condition was inert anyway — pruning cannot change what is filtered", () => {
  const projects = [
    { id: 1, city: "Bratislava", developer: "A" },
    { id: 2, city: "Brno", developer: "B" },
  ];
  const withStale = [c("country", "in", ["SK"]), c("city", "in", ["Brno"])];
  const before = applyFilters(projects, withStale).map((p) => p.id);
  const after = applyFilters(projects, quiet(() => pruneStale(withStale))).map((p) => p.id);
  assert.deepEqual(before, [2]);
  assert.deepEqual(after, before);
});

// ── the guard that made the stale condition harmless in the first place ──────
test("isComplete refuses an unknown field and an unknown operator", () => {
  assert.equal(isComplete(c("country", "in", ["SK"])), false);
  assert.equal(isComplete(c("city", "notanop", ["X"])), false);
  assert.equal(isComplete(c("city", "in", ["Bratislava"])), true);
  assert.equal(isComplete(c("city", "in", [])), false);   // multi with nothing picked
});

test("country really is gone from FIELDS (this test is the reminder if it comes back)", () => {
  assert.equal(FIELD_BY_KEY.country, undefined);
});

// ── Parking (2026-09-03) ───────────────────────────────────────────────────
// A garage is bought separately from the flat, so its price is in neither
// min_price nor €/m². These three fields are the only way to reach it, and each
// reads a column public.projects_live actually serves — the pair of assertions
// below is what would catch a column being renamed on one side only.

test("the parking fields read the columns projects_live serves", () => {
  const row = {
    parking_availability: "mandatory",
    parking_garage_price_from: 25000,
    parking_outside_price_from: 16000,
  };
  assert.equal(FIELD_BY_KEY.parking.get(row), "mandatory");
  assert.equal(FIELD_BY_KEY.parking_garage_price.get(row), 25000);
  assert.equal(FIELD_BY_KEY.parking_outside_price.get(row), 16000);
});

test("a project nobody has reviewed filters as empty, never as 'no parking'", () => {
  const unreviewed = {};
  assert.equal(FIELD_BY_KEY.parking.get(unreviewed), "");
  assert.equal(FIELD_BY_KEY.parking_garage_price.get(unreviewed), null);
  // …and it must not be caught by a filter looking for projects WITHOUT parking.
  const kept = applyFilters([unreviewed],
    [{ id: 1, field: "parking", op: "in", value: ["not_offered"] }]);
  assert.equal(kept.length, 0);
});

test("the parking options are spelled out, not derived from the data", () => {
  // Otherwise 'mandatory' would be unofferable until the first mandatory project
  // is reviewed — which is exactly when somebody wants to search for one.
  assert.deepEqual(FIELD_BY_KEY.parking.options,
    ["mandatory", "included", "optional", "on_request", "not_offered", "unknown"]);
  assert.equal(FIELD_BY_KEY.parking.optionLabel("mandatory"), "Povinné dokúpenie");
});

// ── Parking terms: the three cases must not look alike (2026-09-03) ────────
// Boss: "if the garage is already in price of the apartment, or if its mandatory,
// or if not mandatory. very important differences." They point in opposite
// directions, so they get different badges.
//
// This test exists because the tone lookup lived INLINE in the card component and
// a rename missed its declaration: `tone is not defined`, a blank project page in
// production. The build cannot see that and no test could either, because nothing
// rendered the card. So the decision is a pure function now, and this is it.

test("included and mandatory earn opposite badges; the rest stay plain", async () => {
  const { termsTone, termsLabel } = await import("./parkingTerms.js");
  assert.equal(termsTone("included"), "ok");      // cheaper than it looks
  assert.equal(termsTone("mandatory"), "warn");   // dearer than it looks
  assert.equal(termsTone("optional"), null);
  assert.equal(termsTone("on_request"), null);
  assert.equal(termsTone("unknown"), null);
  assert.equal(termsTone(undefined), null);
  assert.equal(termsLabel("included", "sk"), "V CENE BYTU");
  assert.equal(termsLabel("mandatory", "sk"), "POVINNÉ");
});
