/* formatDimNumber — the one way a numeric DIMENSION value is printed.
 *
 * These exist because the same defect appeared on three surfaces on 2026-09-14: the Unit
 * database table, its own filter value list, and the Sales table — each printing a room
 * count as "6.0" or "2.5" where the others did something else. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDimNumber } from "./locale.js";

test("a whole number loses the Postgres decimal tail", () => {
  assert.equal(formatDimNumber("6.0"), "6");
  assert.equal(formatDimNumber("1.0"), "1");
  assert.equal(formatDimNumber(4), "4");
});

test("a half room is NEVER rounded away", () => {
  // 78 426 units are 1,5-izbový and 14 145 are 2,5 — rounding merges real categories.
  assert.equal(formatDimNumber("1.5"), "1,5");
  assert.equal(formatDimNumber("2.5"), "2,5");
  assert.equal(formatDimNumber("4.5"), "4,5");
});

test("a negative floor survives (basements are real)", () => {
  assert.equal(formatDimNumber("-2.0"), "-2");
  assert.equal(formatDimNumber("-1"), "-1");
});

test("a non-number passes through untouched, so text dimensions are safe", () => {
  assert.equal(formatDimNumber("Bratislava"), "Bratislava");
  assert.equal(formatDimNumber(""), "");
  assert.equal(formatDimNumber(null), null);
  assert.equal(formatDimNumber(undefined), undefined);
});
