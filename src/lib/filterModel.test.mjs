/**
 * Run with:  node --test src/lib/filterModel.test.mjs
 *
 * The Unit database's filters are built by the user now, from any field, in any of the
 * five modes the engine understands. That makes two things worth guarding: a saved
 * filter set is USER-WRITABLE input that must never reach the database as something it
 * cannot parse, and the modes a field offers must come from the registry rather than a
 * hand-kept list that goes stale the first time someone adds a measure.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_SENTINEL, capabilitiesOf, newFilter, sanitizeFilter, isFilterActive,
  summariseFilter, filtersToSpec, migrateLegacyFilters, parseNumeric, convertMoneyBounds,
} from "./filterModel.js";

const REG = {
  dimensionKeys: new Set(["city", "stav", "izby", "datum"]),
  measureKeys: new Set(["cena_s_dph", "price_per_m2", "obytna_plocha"]),
  dateKeys: new Set(["datum"]),
};

test("what a field allows comes from the registry, not from its look", () => {
  // A dimension can be picked from a list and tested for presence, but NOT ranged —
  // the engine resolves ranges through the measure registry and raises otherwise.
  assert.deepEqual(capabilitiesOf("city", REG).modes, ["in", "not_in", "empty", "not_empty"]);
  // A measure is the mirror image.
  assert.deepEqual(capabilitiesOf("cena_s_dph", REG).modes, ["between", "empty", "not_empty"]);
  // A DATE dimension is the one that does both — the engine allows ranges on those.
  assert.deepEqual(capabilitiesOf("datum", REG).modes, ["in", "not_in", "between", "empty", "not_empty"]);
  // izby is numeric but a dimension: "is 2 or 3" is the useful question, and a range
  // would be rejected by the engine. Judging by type alone would get this wrong.
  assert.deepEqual(capabilitiesOf("izby", REG).modes, ["in", "not_in", "empty", "not_empty"]);
  // Something nobody has registered is not filterable at all.
  assert.deepEqual(capabilitiesOf("made_up", REG).modes, []);
});

test("a new filter opens on a mode its field actually supports", () => {
  assert.equal(newFilter("city", capabilitiesOf("city", REG), 1).mode, "in");
  assert.equal(newFilter("cena_s_dph", capabilitiesOf("cena_s_dph", REG), 2).mode, "between");
});

test("a saved filter set is untrusted input", () => {
  assert.equal(sanitizeFilter(null, 1), null);
  assert.equal(sanitizeFilter({ mode: "in" }, 1), null, "no key = not a filter");
  const bad = sanitizeFilter({ key: "city", mode: "DROP TABLE", values: [1, {}, "x", null] }, 7);
  assert.equal(bad.mode, "in", "an unknown mode falls back, it does not travel");
  assert.deepEqual(bad.values, ["1", "x"], "only scalars survive, as strings");
  assert.equal(bad.id, 7);
  assert.deepEqual(sanitizeFilter({ key: "izby", min: 0, max: null }, 1).min, "0", "zero is a bound, not absence");
});

test("an empty filter never reaches the engine", () => {
  assert.equal(isFilterActive({ key: "city", mode: "in", values: [] }), false);
  assert.equal(isFilterActive({ key: "cena_s_dph", mode: "between", min: "", max: "" }), false);
  assert.equal(isFilterActive({ key: "cena_s_dph", mode: "between", min: "", max: "300000" }), true);
  // Presence needs no operand — that IS the question.
  assert.equal(isFilterActive({ key: "cena_s_dph", mode: "not_empty" }), true);
  assert.deepEqual(filtersToSpec([{ key: "city", mode: "in", values: [] }]), {});
});

test("each mode lands in the bucket the engine reads it from", () => {
  const spec = filtersToSpec([
    { key: "city", mode: "in", values: ["Nitra", "Praha"] },
    { key: "stav", mode: "not_in", values: ["P"] },
    { key: "obytna_plocha", mode: "between", min: "40", max: "" },
    { key: "cena_s_dph", mode: "not_empty" },
  ]);
  assert.deepEqual(spec.filters, { city: ["Nitra", "Praha"] });
  assert.deepEqual(spec.filters_not, { stav: ["P"] });
  assert.deepEqual(spec.ranges, { obytna_plocha: { min: 40, max: null } });
  assert.deepEqual(spec.nulls, { cena_s_dph: "not_empty" });
});

test("choosing (empty) asks about presence — the sentinel is never sent as a value", () => {
  const spec = filtersToSpec([{ key: "kolaudacia", mode: "in", values: [EMPTY_SENTINEL] }]);
  assert.equal(spec.filters, undefined, "the sentinel is not a value the database can match");
  assert.deepEqual(spec.nulls, { kolaudacia: "empty" });
  // …and "is not (empty)" is the opposite question, not an exclusion list.
  assert.deepEqual(filtersToSpec([{ key: "kolaudacia", mode: "not_in", values: [EMPTY_SENTINEL] }]).nulls,
    { kolaudacia: "not_empty" });
  // Mixed: real values still filter, the sentinel does not sneak in beside them.
  assert.deepEqual(filtersToSpec([{ key: "stav", mode: "in", values: ["V", EMPTY_SENTINEL] }]).filters,
    { stav: ["V"] });
});

test("a money range is converted to EUR, everything else is left alone", () => {
  const opts = { isMoneyKey: (k) => k === "cena_s_dph", toEur: (v) => Number(v) / 25 };
  const spec = filtersToSpec([
    { key: "cena_s_dph", mode: "between", min: "2500000", max: "" },
    { key: "obytna_plocha", mode: "between", min: "50", max: "80" },
  ], opts);
  assert.deepEqual(spec.ranges.cena_s_dph, { min: 100000, max: null }, "CZK typed, EUR sent");
  assert.deepEqual(spec.ranges.obytna_plocha, { min: 50, max: 80 }, "square metres are not money");
});

test("the old nine-control filter set migrates in full, so nobody loses their view", () => {
  const out = migrateLegacyFilters({
    fProject: "Sky Park", fCity: "Bratislava", fCast: "", fDev: "", fStav: "V",
    pMin: "", pMax: "400000", m2Min: "", m2Max: "",
    xf: [
      { key: "izby", op: "in", vals: ["2", "3"], min: "", max: "" },
      { key: "poschodie", op: "in", vals: [], min: "3", max: "8" },
      { key: "etapa", op: "not_in", vals: ["II"], min: "", max: "" },
      { key: "", op: "in", vals: ["ignored"] },
    ],
  });
  assert.deepEqual(out.map((f) => [f.key, f.mode]), [
    ["project_name", "in"], ["city", "in"], ["stav", "in"],
    ["cena_s_dph", "between"], ["izby", "in"], ["poschodie", "between"], ["etapa", "not_in"],
  ]);
  assert.deepEqual(out.find((f) => f.key === "cena_s_dph"), { id: 4, key: "cena_s_dph", mode: "between", values: [], min: "", max: "400000" });
  assert.deepEqual(out.find((f) => f.key === "izby").values, ["2", "3"]);
  assert.equal(new Set(out.map((f) => f.id)).size, out.length, "ids must be unique or React reorders rows");
  assert.deepEqual(migrateLegacyFilters(null), []);
  assert.deepEqual(migrateLegacyFilters({}), [], "a blank legacy set migrates to no filters, not to junk");
});

test("a summary says what the filter does, and does not run off the chip", () => {
  assert.equal(summariseFilter({ key: "stav", mode: "in", values: ["V"] }, "sk"), "je V");
  assert.equal(summariseFilter({ key: "stav", mode: "in", values: ["V", "R", "PR", "P"] }, "sk"), "je V, R +2");
  assert.equal(summariseFilter({ key: "cena_s_dph", mode: "between", min: "", max: "300000" }, "sk"), "… – 300000");
  assert.equal(summariseFilter({ key: "cena_s_dph", mode: "not_empty" }, "en"), "has a value");
  assert.equal(summariseFilter({ key: "x", mode: "in", values: [EMPTY_SENTINEL] }, "sk"), "je (prázdne)");
});


/* ── the four defects found by re-reading the first cut (2026-09-14) ──────────
   Each one produced a filter that LOOKED set on screen and did something else, or
   nothing, which is the worst failure mode a filter can have. */

test("a date range is sent as dates — Number() would silently erase it", () => {
  const spec = filtersToSpec(
    [{ key: "datum", mode: "between", min: "2026-01-01", max: "2026-06-30" }],
    { isDateKey: (k) => k === "datum" },
  );
  assert.deepEqual(spec.ranges.datum, { min: "2026-01-01", max: "2026-06-30" });
  // The bug: Number("2026-01-01") is NaN, JSON writes NaN as null, and the filter is
  // then a no-op while the date sits in the box looking applied.
  const broken = filtersToSpec([{ key: "datum", mode: "between", min: "2026-01-01", max: "" }]);
  assert.notDeepEqual(broken.ranges.datum, { min: "2026-01-01", max: null },
    "without isDateKey the old path is still lossy — the caller must pass it");
});

test("a decimal typed the Slovak way is a number", () => {
  assert.equal(parseNumeric("50,5"), 50.5);
  assert.equal(parseNumeric("1 250"), 1250, "a thousands space is how the app prints them back");
  assert.equal(parseNumeric("abc"), null);
  assert.equal(parseNumeric(""), null);
  assert.equal(parseNumeric("0"), 0, "zero is a bound");
  const spec = filtersToSpec([{ key: "obytna_plocha", mode: "between", min: "50,5", max: "" }]);
  assert.deepEqual(spec.ranges.obytna_plocha, { min: 50.5, max: null });
});

test("\"is not X and not blank\" sends both halves — it is an AND and the spec can say it", () => {
  const spec = filtersToSpec([{ key: "stav", mode: "not_in", values: ["P", EMPTY_SENTINEL] }]);
  assert.deepEqual(spec.filters_not, { stav: ["P"] });
  assert.deepEqual(spec.nulls, { stav: "not_empty" },
    "dropping this answered a narrower question than the one on screen");
});

test("a new date filter opens on a range, not on a list of every distinct day", () => {
  assert.equal(newFilter("datum", capabilitiesOf("datum", REG), 1).mode, "between");
  assert.equal(newFilter("city", capabilitiesOf("city", REG), 2).mode, "in", "a plain dimension still opens on is");
});


test("a chip shows the readable value, not the stored one", () => {
  // Sales stores rooms as a numeric, so a facet hands back "2.0"; a chip reading
  // "Izby · je 2.0" is the database talking. The VALUE is untouched either way.
  const tidy = (v) => String(v).replace(/\.0$/, "");
  assert.equal(summariseFilter({ key: "izby", mode: "in", values: ["2.0", "3.0"] }, "sk", tidy), "je 2, 3");
  assert.equal(summariseFilter({ key: "izby", mode: "in", values: ["2.0"] }, "sk"), "je 2.0",
    "without a resolver the raw value still shows — the caller opts in");
  const sig = (v) => (v === "marked" ? "označené" : v);
  assert.equal(summariseFilter({ key: "detection_method", mode: "in", values: ["marked"] }, "sk", sig), "je označené");
});


test("a typed money bound is a PRICE, so it follows the currency", () => {
  // € 300 000 with the rate at 24.264 CZK/€ is 7 279 257 Kč — the same filter, said in
  // the other currency. Leaving the digits alone silently turned a €300k floor into a
  // 300 000 Kč one (about €12k) and took the result from 529 sales to 1 005.
  const isMoney = (k) => k === "price_s_dph_eur";
  const out = convertMoneyBounds(
    [{ key: "price_s_dph_eur", mode: "between", min: "300000", max: "" },
     { key: "obytna_plocha", mode: "between", min: "50", max: "80" }],
    24.264097, isMoney,
  );
  assert.equal(out[0].min, "7279229");
  assert.equal(out[0].max, "", "an open bound stays open");
  assert.deepEqual(out[1], { key: "obytna_plocha", mode: "between", min: "50", max: "80" },
    "square metres are not money and must not move");
});

test("converting money returns the SAME array when nothing changes", () => {
  // It runs in an effect, so a new array every render would loop forever.
  const fs = [{ key: "price_s_dph_eur", mode: "between", min: "300000", max: "" }];
  assert.equal(convertMoneyBounds(fs, 1, () => true), fs, "no rate change, no new array");
  assert.equal(convertMoneyBounds(fs, NaN, () => true), fs, "a bad rate is not a reason to rewrite");
  const cats = [{ key: "city", mode: "in", values: ["Nitra"] }];
  assert.equal(convertMoneyBounds(cats, 25, () => true), cats, "nothing to convert, same array");
});
