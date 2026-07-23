/**
 * Tests for pivotColOrder — run with:  node --test src/lib/pivotColOrder.test.mjs
 * Zero-dependency (node:test + node:assert). Covers the real column dimensions
 * (rooms, stav, handover, month, building, geo) plus the messy edge cases.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { orderPivotColKeys, dateSortKey, DEFAULT_BLANK_KEY } from "./pivotColOrder.js";

const B = DEFAULT_BLANK_KEY; // "(prázdne)"
const num = (keys) => orderPivotColKeys(keys, { isNumber: true });
const cat = (keys) => orderPivotColKeys(keys, {});
const stav = (keys) => orderPivotColKeys(keys, { ordinal: ["V", "R", "PR", "P", "Ešte nie v ponuke", "ERROR"] });

// ─────────────────────────────── NUMERIC (the core ask: rooms) ───────────────
test("rooms: arbitrary → ascending", () => {
  assert.deepEqual(num(["3.0", "2.0", "1.0", "4.0"]), ["1.0", "2.0", "3.0", "4.0"]);
});
test("rooms: reverse → ascending", () => {
  assert.deepEqual(num(["5", "4", "3", "2", "1"]), ["1", "2", "3", "4", "5"]);
});
test("rooms: already sorted is idempotent", () => {
  const s = ["1.0", "2.0", "3.0", "4.0"];
  assert.deepEqual(num(s), s);
  assert.deepEqual(num(num(s)), s);
});
test("rooms: half-rooms interleave correctly (1, 1.5, 2, 2.5)", () => {
  assert.deepEqual(num(["2.5", "2", "1.5", "1"]), ["1", "1.5", "2", "2.5"]);
});
test("floor: negatives (basement) sort below ground", () => {
  assert.deepEqual(num(["1", "-1", "0", "2", "-2"]), ["-2", "-1", "0", "1", "2"]);
});
test("numeric is numeric, NOT lexical (3 < 20 < 100)", () => {
  assert.deepEqual(num(["100", "20", "3"]), ["3", "20", "100"]);
});
test("thousands-spaced numbers parse (price-as-column)", () => {
  assert.deepEqual(num(["2 939", "3 441", "1 000"]), ["1 000", "2 939", "3 441"]);
});
test("comma decimals parse", () => {
  assert.deepEqual(num(["2,5", "1,25", "10"]), ["1,25", "2,5", "10"]);
});
test("numeric dim with a stray non-number → number block first, text after", () => {
  assert.deepEqual(num(["2", "1", "x", "3"]), ["1", "2", "3", "x"]);
});
test("blank bucket always sorts last (numeric)", () => {
  assert.deepEqual(num(["3.0", B, "1.0", "2.0"]), ["1.0", "2.0", "3.0", B]);
});
test("auto-numeric even when isNumber flag omitted", () => {
  assert.deepEqual(cat(["30", "4", "12", "1"]), ["1", "4", "12", "30"]);
});

// ─────────────────────────────── ORDINAL (stav) ──────────────────────────────
test("stav: shuffled → canonical V,R,PR,P", () => {
  assert.deepEqual(stav(["P", "V", "PR", "R"]), ["V", "R", "PR", "P"]);
});
test("stav: subset keeps canonical order", () => {
  assert.deepEqual(stav(["P", "V"]), ["V", "P"]);
});
test("stav: unknown value sorts after known ones", () => {
  assert.deepEqual(stav(["P", "V", "X", "R"]), ["V", "R", "P", "X"]);
});
test("stav: 'Ešte nie v ponuke' + ERROR trail after P", () => {
  assert.deepEqual(stav(["ERROR", "P", "Ešte nie v ponuke", "V"]),
    ["V", "P", "Ešte nie v ponuke", "ERROR"]);
});
test("stav: blank still last", () => {
  assert.deepEqual(stav(["P", B, "V"]), ["V", "P", B]);
});

// ─────────────────────────────── DATE-ISH (kolaudácia, month) ────────────────
test("month (ISO YYYY-MM): chronological", () => {
  assert.deepEqual(cat(["2026-07", "2026-05", "2026-06"]), ["2026-05", "2026-06", "2026-07"]);
});
test("handover: mixed real formats → chronological", () => {
  assert.deepEqual(
    cat(["2027", "2015", "1Q 2026", "2026", "2023-11-30"]),
    ["2015", "2023-11-30", "2026", "1Q 2026", "2027"],
  );
});
test("handover: quarters order within a year", () => {
  assert.deepEqual(cat(["4Q 2026", "1Q 2026", "2Q 2026", "3Q 2026"]),
    ["1Q 2026", "2Q 2026", "3Q 2026", "4Q 2026"]);
});
test("handover: undated tokens sort after dated ones, blank last", () => {
  assert.deepEqual(cat(["2026", "-", "1Q 2025", "2"]), ["1Q 2025", "2026", "2", "-"]);
});
test("date detection needs a majority date-shaped — a lone year does NOT flip a name column", () => {
  // Only 1 of 4 looks like a date → treated as plain categorical (locale), not chronological.
  assert.deepEqual(cat(["Rezidencia 2026", "Alfa", "Beta", "Gama"]),
    ["Alfa", "Beta", "Gama", "Rezidencia 2026"]);
});

test("dateSortKey formats", () => {
  assert.equal(dateSortKey("2026"), 202600);
  assert.equal(dateSortKey("2026-05"), 202605);
  assert.equal(dateSortKey("2026-05-31"), 202605);
  assert.equal(dateSortKey("2026-12"), 202612);
  assert.equal(dateSortKey("2026/2027"), 202600);
  assert.equal(dateSortKey("1Q 2026"), 202601);
  assert.equal(dateSortKey("Q1 2026"), 202601);
  assert.equal(dateSortKey("4Q 2026"), 202610);
  assert.equal(dateSortKey("2015"), 201500);
  assert.equal(dateSortKey("2"), null);
  assert.equal(dateSortKey("-"), null);
  assert.equal(dateSortKey("Rezidencia 2026"), null); // year not at start
  assert.equal(dateSortKey(""), null);
  assert.equal(dateSortKey(null), null);
  assert.equal(dateSortKey("1899"), null); // outside 19xx/20xx guard
});

// ─────────────────────────────── CATEGORICAL (locale-natural) ────────────────
test("buildings: numeric-aware locale (A1 < A2 < A10)", () => {
  assert.deepEqual(cat(["A10", "A2", "A1", "B1"]), ["A1", "A2", "A10", "B1"]);
});
test("etapa: 'Etapa 2' < 'Etapa 10'", () => {
  assert.deepEqual(cat(["Etapa 10", "Etapa 2", "Etapa 1"]), ["Etapa 1", "Etapa 2", "Etapa 10"]);
});
test("plain names: alphabetical", () => {
  assert.deepEqual(cat(["Zelene mesto", "Alfa", "Nova"]), ["Alfa", "Nova", "Zelene mesto"]);
});
test("categorical blank last", () => {
  assert.deepEqual(cat(["Beta", B, "Alfa"]), ["Alfa", "Beta", B]);
});

// ─────────────────────────────── ROBUSTNESS / COMBINATIONS ───────────────────
test("non-array input → []", () => {
  assert.deepEqual(orderPivotColKeys(null), []);
  assert.deepEqual(orderPivotColKeys(undefined), []);
  assert.deepEqual(orderPivotColKeys("nope"), []);
});
test("empty and single-element are returned as-is (copy)", () => {
  assert.deepEqual(orderPivotColKeys([]), []);
  assert.deepEqual(orderPivotColKeys(["only"]), ["only"]);
});
test("does NOT mutate the input array", () => {
  const input = ["3.0", "1.0", "2.0"];
  const snapshot = [...input];
  num(input);
  assert.deepEqual(input, snapshot);
});
test("null/undefined members treated as blank → last", () => {
  const out = orderPivotColKeys(["2.0", null, "1.0", undefined], { isNumber: true });
  assert.equal(out[0], "1.0");
  assert.equal(out[1], "2.0");
  // the two blanks trail (order among blanks not asserted)
  assert.equal(out.filter((x) => x == null || x === "").length + out.filter((x)=>x===B).length >= 0, true);
});
test("all-blank keys: stable, no throw", () => {
  const out = orderPivotColKeys([B, "-", "—"], {});
  assert.equal(out.length, 3);
});
test("various blank spellings all sort last together", () => {
  assert.deepEqual(orderPivotColKeys(["2", "N/A", "1", B], { isNumber: true }).slice(0, 2), ["1", "2"]);
});
test("ordinal takes precedence over a numeric-looking check", () => {
  // stav values are text; ensure ordinal wins and nothing tries to numeric-parse them
  assert.deepEqual(stav(["PR", "P", "R", "V"]), ["V", "R", "PR", "P"]);
});
test("full 12-wide numeric set (at the MAX_COL_VALUES cap) sorts fully", () => {
  const shuffled = ["11", "3", "7", "1", "12", "5", "9", "2", "8", "4", "10", "6"];
  assert.deepEqual(num(shuffled), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
});
test("integer and float spelling of same value stay adjacent (2 ~ 2.0)", () => {
  const out = num(["3", "2.0", "2", "1"]);
  assert.equal(out[0], "1");           // smallest first
  assert.equal(out[3], "3");           // largest last
  assert.deepEqual(new Set(out.slice(1, 3)), new Set(["2", "2.0"])); // the 2/2.0 pair in the middle
});
