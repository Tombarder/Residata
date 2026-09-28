/**
 * The flat vocabulary behind every in-browser flat list (a project's flats, the
 * Byt-v-čase grid). It must read the database's columns correctly and speak the analytics
 * registry's keys, or one filter means two things on two pages.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  FLAT_FIELDS, FLAT_FIELD_BY_KEY, flatValue, isMoneyField, isDateField,
  capsSetsFor, flatCapsOf, distinctFlatValues, DEFAULT_FLAT_COLS,
} from "./flatFields.js";
import { EMPTY_SENTINEL, matchesFilters } from "./filterModel.js";

const row = {
  unit_id: "A-12", unit_detail: "A.1.12", typ: "flat", budova: "A", poschodie: 3, izby: "2.0",
  obytna_plocha: 55.5, exterier_plocha: 6, balkon_plocha: 6, loggia_plocha: null,
  celkova_plocha: 61.5, cena_s_dph: 222000, cena_bez_dph: 180488, stav: "V",
  kolaudacia: "Q4 2026", kolaudacia_date: "2026-12-31", fitout_level: "standard",
};

test("areas read the database's *_plocha columns under the registry's short keys", () => {
  assert.equal(flatValue(row, "balkon"), 6);
  assert.equal(flatValue(row, "exterier"), 6);
  assert.equal(flatValue(row, "loggia"), null);
  assert.equal(flatValue(row, "obytna_plocha"), 55.5);
});

test("€/m² is price ÷ living area, and blank when either is missing or the area is zero", () => {
  assert.equal(flatValue(row, "price_per_m2"), 222000 / 55.5);
  assert.equal(flatValue({ ...row, obytna_plocha: 0 }, "price_per_m2"), null);
  assert.equal(flatValue({ ...row, cena_s_dph: null }, "price_per_m2"), null);
});

test("the unit shows its readable label when the developer publishes one", () => {
  assert.equal(flatValue(row, "unit_id"), "A.1.12");
  assert.equal(flatValue({ ...row, unit_detail: null }, "unit_id"), "A-12");
});

test("numbers come back as numbers, whatever string shape the database sent", () => {
  assert.equal(flatValue(row, "izby"), 2);
  assert.equal(flatValue({ ...row, izby: "" }, "izby"), null);
});

test("money and date fields are flagged, so bounds convert and compare correctly", () => {
  assert.ok(isMoneyField("cena_s_dph") && isMoneyField("price_per_m2") && !isMoneyField("obytna_plocha"));
  assert.ok(isDateField("kolaudacia_date") && !isDateField("kolaudacia"));
});

test("distinct values sort numbers as numbers and fold blanks into one (empty) at the end", () => {
  const rows = [{ izby: 10 }, { izby: 2 }, { izby: 2 }, { izby: null }, { izby: 3 }];
  assert.deepEqual(distinctFlatValues(rows, "izby"), [
    { value: "2", n: 2 }, { value: "3", n: 1 }, { value: "10", n: 1 }, { value: EMPTY_SENTINEL, n: 1 },
  ]);
});

test("a value picked from the list matches the rows it came from", () => {
  const rows = [{ izby: "2.0" }, { izby: 3 }, { izby: 2 }];
  const pick = distinctFlatValues(rows, "izby")[0].value;          // what the list offers
  const f = [{ id: 1, key: "izby", mode: "in", values: [pick], min: "", max: "" }];
  assert.equal(rows.filter((r) => matchesFilters(r, f, { valueOf: flatValue })).length, 2);
});

test("before the registry loads, rooms offer both a value list and a range; a price only a range", () => {
  const sets = capsSetsFor(null);
  assert.deepEqual(flatCapsOf("izby", sets).modes, ["in", "not_in", "between", "empty", "not_empty"]);
  assert.deepEqual(flatCapsOf("cena_s_dph", sets).modes, ["between", "empty", "not_empty"]);
  assert.ok(flatCapsOf("kolaudacia_date", sets).isDate);
});

test("the live registry wins: a dimension it stops filtering stops being filterable here", () => {
  const live = {
    dimensions: [{ key: "budova", filterable: false, data_type: "text" }, { key: "stav", data_type: "text" }],
    measures: [{ key: "cena_s_dph" }],
  };
  const sets = capsSetsFor(live);
  assert.deepEqual(flatCapsOf("budova", sets).modes, []);
  assert.ok(flatCapsOf("stav", sets).modes.includes("in"));
});

test("every default column is a real field, and keys are unique", () => {
  for (const k of DEFAULT_FLAT_COLS) assert.ok(FLAT_FIELD_BY_KEY[k], k);
  assert.equal(new Set(FLAT_FIELDS.map((f) => f.key)).size, FLAT_FIELDS.length);
});
