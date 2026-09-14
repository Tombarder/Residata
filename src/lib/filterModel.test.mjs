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
  summariseFilter, filtersToSpec, migrateLegacyFilters,
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
