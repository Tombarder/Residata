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
