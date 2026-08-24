/**
 * Tests for zoneOrder — run with:  node --test src/lib/zoneOrder.test.mjs
 *
 * The case that matters most: dragging RIGHT. The drop index comes from a list
 * that still contains the dragged chip, so a naive remove-then-insert lands one
 * slot short and the user has to drag twice.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { insertAt, moveToIndex, keyOfString, keyOfObject, dropIndexFor } from "./zoneOrder.js";

const L = ["a", "b", "c", "d"];
const move = (list, key, to) => moveToIndex(list, keyOfString, key, to);

/* ─────────────────────────────── insertAt ───────────────────────────────── */

test("inserts at the front, the middle and the end", () => {
  assert.deepEqual(insertAt(L, "x", 0), ["x", "a", "b", "c", "d"]);
  assert.deepEqual(insertAt(L, "x", 2), ["a", "b", "x", "c", "d"]);
  assert.deepEqual(insertAt(L, "x", 4), ["a", "b", "c", "d", "x"]);
});
test("an out-of-range or missing index appends", () => {
  assert.deepEqual(insertAt(L, "x", null), ["a", "b", "c", "d", "x"]);
  assert.deepEqual(insertAt(L, "x", 99), ["a", "b", "c", "d", "x"]);
  assert.deepEqual(insertAt(L, "x", -3), ["a", "b", "c", "d", "x"]);
});
test("insertAt does not mutate the source", () => {
  const src = ["a", "b"];
  insertAt(src, "z", 0);
  assert.deepEqual(src, ["a", "b"]);
});
test("inserting into an empty list", () => {
  assert.deepEqual(insertAt([], "x", 0), ["x"]);
});

/* ──────────────────────────── moveToIndex: left ─────────────────────────── */

test("moving left lands exactly where the caret was", () => {
  assert.deepEqual(move(L, "c", 0), ["c", "a", "b", "d"]);
  assert.deepEqual(move(L, "c", 1), ["a", "c", "b", "d"]);
  assert.deepEqual(move(L, "d", 1), ["a", "d", "b", "c"]);
});

/* ─────────────────────── moveToIndex: right (the bug) ───────────────────── */

test("moving right lands where the caret was, NOT one slot short", () => {
  // caret after "c" (slot 3) while dragging "a" → a ends up between c and d
  assert.deepEqual(move(L, "a", 3), ["b", "c", "a", "d"]);
  // caret at the very end
  assert.deepEqual(move(L, "a", 4), ["b", "c", "d", "a"]);
  assert.deepEqual(move(L, "b", 4), ["a", "c", "d", "b"]);
});

/* ─────────────────────────────── no-ops ─────────────────────────────────── */

test("dropping a chip onto its own slot changes nothing (same reference)", () => {
  assert.equal(move(L, "b", 1), L);   // caret before itself
  assert.equal(move(L, "b", 2), L);   // caret after itself
});
test("an unknown key is left alone", () => {
  assert.equal(move(L, "zzz", 0), L);
});
test("a single-item list cannot be reordered", () => {
  const one = ["a"];
  assert.equal(move(one, "a", 0), one);
  assert.equal(move(one, "a", 1), one);
});
test("an index past the end clamps to the end instead of dropping the item", () => {
  assert.deepEqual(move(L, "a", 99), ["b", "c", "d", "a"]);
  assert.deepEqual(move(L, "d", -5), ["d", "a", "b", "c"]);
});
test("every item survives a move — nothing is ever lost or duplicated", () => {
  for (const key of L) {
    for (let to = 0; to <= L.length; to++) {
      const out = move(L, key, to);
      assert.equal(out.length, L.length, `${key}→${to} changed the length`);
      assert.deepEqual([...out].sort(), [...L].sort(), `${key}→${to} lost or duplicated an item`);
    }
  }
});

/* ───────────────────────── the object-shaped zones ──────────────────────── */

test("Values/Filters (objects keyed by .key) reorder the same way", () => {
  const vals = [{ key: "a", agg: "sum" }, { key: "b", agg: "avg" }, { key: "c", agg: "count" }];
  const out = moveToIndex(vals, keyOfObject, "a", 3);
  assert.deepEqual(out.map((v) => v.key), ["b", "c", "a"]);
  // the whole entry travels, not just its key
  assert.equal(out[2].agg, "sum");
});

/* ───────────────────────────── dropIndexFor ─────────────────────────────── */

const rect = (left, top, width = 100, height = 24) => ({ left, top, width, height });
// one row of three chips: [0-100] [110-210] [220-320], all at y 0-24
const ROW = [rect(0, 0), rect(110, 0), rect(220, 0)];

test("left of the first chip → slot 0", () => {
  assert.equal(dropIndexFor(ROW, 10, 12), 0);
});
test("right of the last chip → the end slot", () => {
  assert.equal(dropIndexFor(ROW, 300, 12), 3);
  assert.equal(dropIndexFor(ROW, 999, 12), 3);
});
test("in the gap between two chips → the slot between them", () => {
  assert.equal(dropIndexFor(ROW, 105, 12), 1);
  assert.equal(dropIndexFor(ROW, 215, 12), 2);
});
test("an empty zone always asks for slot 0", () => {
  assert.equal(dropIndexFor([], 50, 50), 0);
});
test("with wrapped rows the pointer's OWN line wins over a nearer chip above", () => {
  // row 1: chips 0,1 at y 0-24 · row 2: chip 2 at y 30-54
  const wrapped = [rect(0, 0), rect(110, 0), rect(0, 30)];
  // pointer far right on the SECOND line: chip 1 is horizontally closer, but
  // chip 2 shares the line, so the caret belongs after chip 2.
  assert.equal(dropIndexFor(wrapped, 200, 42), 3);
  // same x, but on the FIRST line → after chip 1
  assert.equal(dropIndexFor(wrapped, 200, 12), 2);
});
