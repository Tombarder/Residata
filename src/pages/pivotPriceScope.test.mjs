/**
 * Tests for the PRICE SCOPE — run with:  node --test src/pages/pivotPriceScope.test.mjs
 * Same zero-dependency, read-the-source-as-text approach as pivotFields.test.mjs:
 * PivotV2.jsx is a React page, so importing it would drag in the whole app.
 *
 * WHAT WENT WRONG (2026-09-09). A pivot row showed, for Dostupne byvanie Nitra's
 * 2-room flats: 51.2 m2, 3 213 EUR/m2, 184 663 EUR. Boss multiplied the first by
 * the second, got 164 505, and reported the data as broken. It was not: the price
 * columns were averaged over the 27 flats that HAVE a published price, while the
 * area column was averaged over all 141 — and those 27 average 57.4 m2, not 51.2.
 * Every number was right; no two of them described the same flats.
 *
 * Developers delete a price when a flat sells, so this is not an edge case: 59% of
 * current listed flats carry no price. And because EUR/m2 moves systematically
 * with flat size, a mixed population is reliably wrong rather than noisily wrong.
 *
 * THE RULE: as soon as a price is in the equation, the population is "flats with a
 * published price". A pivot with no price column is untouched.
 *
 * These tests guard the two ways that rule can rot:
 *   1. a NEW money field is added to the palette and nobody adds it to the scope
 *      trigger  ->  it would silently reopen the exact same hole;
 *   2. a consumer of the filter list quietly goes back to the user's raw `filters`
 *      instead of `effectiveFilters`  ->  that one surface starts disagreeing again.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PivotV2.jsx"), "utf8");

/* Evaluate the scope's pure logic straight out of the source. It depends on
   nothing but isFilterActive and two Sets, so it lifts cleanly — and testing the
   REAL text means the test cannot pass against a stale copy of the logic. */
function lift(name, endMarker) {
  const start = SRC.indexOf(name);
  assert.ok(start >= 0, `${name} not found in PivotV2.jsx`);
  const end = SRC.indexOf(endMarker, start);
  assert.ok(end > start, `end of ${name} not found`);
  return SRC.slice(start, end + endMarker.length);
}
const scope = {};
new Function(
  "exports",
  lift("function isFilterActive(f) {", "\n}") + "\n" +
  lift("const PRICE_VALUE_FIELDS", "\n") + "\n" +
  lift("function priceIsInPlay(valueDefs, filters) {", "\n}") + "\n" +
  "exports.priceIsInPlay = priceIsInPlay; exports.PRICE_VALUE_FIELDS = PRICE_VALUE_FIELDS;",
)(scope);
const { priceIsInPlay, PRICE_VALUE_FIELDS } = scope;

const V = (field, agg = "avg") => ({ key: field, field, agg });

test("a pivot with no money in it is left alone — every flat still counts", () => {
  assert.equal(priceIsInPlay([V("obytna_plocha"), V("izby")], []), false);
  assert.equal(priceIsInPlay([V("celkova_plocha"), V("poschodie")], [{ key: "city", mode: "in", values: ["Nitra"] }]), false);
  assert.equal(priceIsInPlay([], []), false);
});

test("any money VALUE turns the scope on", () => {
  for (const f of ["cena_s_dph", "cena_bez_dph", "cena_na_m2_obytnej", "wavg_m2_price"]) {
    assert.equal(priceIsInPlay([V("obytna_plocha"), V(f)], []), true, `${f} should trigger the scope`);
  }
});

test("a money FILTER turns it on too — the reader is comparing against a price either way", () => {
  assert.equal(priceIsInPlay([V("obytna_plocha")], [{ key: "cena_s_dph", mode: "between", min: 200000 }]), true);
});

test("an INACTIVE filter chip does not turn it on (a chip dropped but not configured)", () => {
  assert.equal(priceIsInPlay([V("obytna_plocha")], [{ key: "cena_s_dph" }]), false);
  assert.equal(priceIsInPlay([V("obytna_plocha")], [{ key: "cena_s_dph", mode: "between" }]), false);
});

test('asking for flats WITHOUT a price is honoured, not overruled into an empty table', () => {
  // The deliberate opposite request. Forcing "has a price" on top of it would
  // return zero rows and look like a broken pivot.
  assert.equal(priceIsInPlay([V("obytna_plocha")], [{ key: "cena_s_dph", mode: "empty" }]), false);
  assert.equal(priceIsInPlay([V("cena_s_dph")], [{ key: "cena_s_dph", mode: "empty" }]), false);
});

test("EVERY field in the palette that carries money is a scope trigger", () => {
  // The regression that would silently reopen the hole: someone adds a new price
  // field and forgets the Set. Any field whose unit is a currency must be in it.
  const lines = SRC.split("\n");
  const moneyFields = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/unit:\s*"€/.test(lines[i])) continue;
    for (let j = i; j >= 0 && j > i - 12; j--) {
      const m = lines[j].match(/^\s{2}([a-z_0-9]+):\s*\{/);
      if (m) { moneyFields.push(m[1]); break; }
    }
  }
  assert.ok(moneyFields.length >= 4, `expected to find the money fields, found ${moneyFields.length}`);
  for (const f of moneyFields) {
    assert.ok(PRICE_VALUE_FIELDS.has(f),
      `"${f}" carries a money unit but is not in PRICE_VALUE_FIELDS — a pivot using it ` +
      `would average money over priced flats and everything else over all flats, which is ` +
      `the exact bug this scope exists to prevent.`);
  }
});

test("every consumer of the filter list uses the SCOPED filters", () => {
  // Each of these reads the filter list to decide which flats are counted. If any
  // one of them reverts to the user's raw `filters`, that surface silently starts
  // describing a different set of flats from the table around it.
  const mustContain = [
    ["client record path",   "records.filter(r => effectiveFilters.every(f => passesFilter(r, f)))"],
    ["server pivot spec",    "buildPivotSpec({ dims: gDims, filters: effectiveFilters, country, isCurrent })"],
    ["serverability gate",   "isServerable(rows, cols, effectiveValues, effectiveFilters)"],
    ["drill-down unit list", "effectiveFilters.every((flt) => passesFilter(r, flt))"],
  ];
  for (const [what, snippet] of mustContain) {
    assert.ok(SRC.includes(snippet), `${what} no longer uses effectiveFilters (looked for: ${snippet})`);
  }
});

test("the only unscoped filter pass is the one computing the denominator", () => {
  // "27 of 141" needs the un-narrowed count, so exactly ONE place may apply the
  // user's raw filters. More than one means a consumer regressed.
  const bare = SRC.match(/(?<![a-zA-Z])filters\.every\(\s*f\s*=>\s*passesFilter/g) || [];
  assert.equal(bare.length, 1, "exactly one unscoped filter pass expected (unscopedRecords)");
  const idx = SRC.indexOf("const unscopedRecords");
  const block = SRC.slice(idx, idx + 400);
  assert.ok(block.includes("filters.every(f => passesFilter(r, f))"),
    "the single unscoped pass must be the unscopedRecords denominator");
});

test("status measures are named so the scope can warn about them", () => {
  // Sold flats are the ones that lose their price, so absorption computed inside
  // the scope collapses (~10% where the price list says ~60%). It must be flagged
  // rather than silently reinterpreted.
  const m = SRC.match(/const STATUS_MEASURES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, "STATUS_MEASURES not found");
  for (const k of ["abs_rate", "sold_count", "available_count"]) {
    assert.ok(m[1].includes(`"${k}"`), `${k} must be in STATUS_MEASURES`);
  }
});
