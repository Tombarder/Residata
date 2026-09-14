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

/* byLabel — ordering a filter's value list by what the READER sees.
 * Written after labelling the values scrambled the order: "Garážové státie" landed
 * between Parkovanie and Obchodný priestor, alphabetical in the DATABASE's vocabulary. */
import { byLabel } from "./locale.js";

const order = (labels, lang = "sk") =>
  labels.map((label) => ({ label })).sort(byLabel(lang)).map((o) => o.label);

test("numbers sort as NUMBERS — a floor list runs -2 to 44", () => {
  assert.deepEqual(order(["10", "2", "1", "44", "0", "-1", "-2", "36"]),
    ["-2", "-1", "0", "1", "2", "10", "36", "44"]);
});

test("a half room sits between its neighbours, not after them", () => {
  assert.deepEqual(order(["2", "1,5", "1", "2,5", "3"]), ["1", "1,5", "2", "2,5", "3"]);
});

test("Slovak diacritics sort where a Slovak reader looks for them", () => {
  // Č after C, before D — a plain a<b comparison puts Č after Z.
  const out = order(["Dom", "Časť", "Byt", "Apartmán"]);
  assert.deepEqual(out, ["Apartmán", "Byt", "Časť", "Dom"]);
});

test("the labelled unit kinds come out alphabetically", () => {
  assert.deepEqual(
    order(["Parkovanie", "Garážové státie", "Byt", "Obchodný priestor", "Apartmán"]),
    ["Apartmán", "Byt", "Garážové státie", "Obchodný priestor", "Parkovanie"]);
});

test("mixed numbers and text do not throw", () => {
  assert.equal(order(["5", "Bratislava", "1"]).length, 3);
});

/* formatPercent — written after a Slovak page showed "7.3% absorpcia" and "0.0%". */
import { formatPercent } from "./locale.js";

test("Slovak uses a comma and a non-breaking space before the sign", () => {
  assert.equal(formatPercent(7.3, "sk"), "7,3 %");
  assert.equal(formatPercent(0, "sk"), "0,0 %");
  assert.equal(formatPercent(61, "sk", 0), "61 %");
});

test("English keeps the dot and no space", () => {
  assert.equal(formatPercent(7.3, "en"), "7.3%");
  assert.equal(formatPercent(61, "en", 0), "61%");
});

test("Czech follows the Slovak convention, not the English one", () => {
  assert.equal(formatPercent(7.3, "cs"), "7,3 %");
});

test("a missing percentage is a dash, never NaN%", () => {
  for (const v of [null, undefined, "", NaN, "n/a"]) assert.equal(formatPercent(v, "sk"), "—");
});

test("the space never lets the sign wrap onto its own line", () => {
  assert.ok(!/ %$/.test(formatPercent(5, "sk")));
});
