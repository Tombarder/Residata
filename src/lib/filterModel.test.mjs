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
  togglePillValue, setRangeFilter, rescaleSavedMoney, cleanFilterScopes,
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

// ── matchesFilters: the engine's rules, applied to rows already in the browser ──────
// A project's flats and the Byt-v-čase grid filter on the client. The same saved filter
// must give the answer public.analytics_units would, clause for clause.
import { matchesFilters } from "./filterModel.js";

const rowsM = [
  { id: 1, stav: "V", izby: 2, cena: 200000, datum: "2026-09-01", budova: "A" },
  { id: 2, stav: "P", izby: 3, cena: 300000, datum: "2026-09-15", budova: null },
  { id: 3, stav: "R", izby: 3, cena: null,   datum: null,          budova: "b" },
];
const keep = (filters, opts = {}) =>
  rowsM.filter((r) => matchesFilters(r, filters, { valueOf: (row, k) => row[k], ...opts })).map((r) => r.id);
const F = (key, mode, extra = {}) => ({ id: 1, key, mode, values: [], min: "", max: "", ...extra });

test("an inactive filter narrows nothing (an empty value list, an empty range)", () => {
  assert.deepEqual(keep([F("stav", "in"), F("cena", "between")]), [1, 2, 3]);
});

test("'is' matches listed values and never a blank unless (empty) is listed", () => {
  assert.deepEqual(keep([F("izby", "in", { values: ["3"] })]), [2, 3]);
  assert.deepEqual(keep([F("budova", "in", { values: ["A"] })]), [1]);
  assert.deepEqual(keep([F("budova", "in", { values: ["A", EMPTY_SENTINEL] })]), [1, 2]);
});

test("text compares case-insensitively, as lower(col::text) does in the engine", () => {
  assert.deepEqual(keep([F("budova", "in", { values: ["B"] })]), [3]);
});

test("'is not' KEEPS blank rows unless (empty) is listed — the engine's col IS NULL OR …", () => {
  assert.deepEqual(keep([F("budova", "not_in", { values: ["A"] })]), [2, 3]);
  assert.deepEqual(keep([F("budova", "not_in", { values: ["A", EMPTY_SENTINEL] })]), [3]);
  assert.deepEqual(keep([F("budova", "not_in", { values: [EMPTY_SENTINEL] })]), [1, 3]);
});

test("a range never matches a blank value, and both bounds are inclusive", () => {
  assert.deepEqual(keep([F("cena", "between", { min: "200000", max: "300000" })]), [1, 2]);
  assert.deepEqual(keep([F("cena", "between", { min: "250 000" })]), [2]);   // typed with a space
});

test("a money bound typed in the display currency is converted to EUR before comparing", () => {
  const czk = { isMoneyKey: (k) => k === "cena", toEur: (v) => v / 25 };
  assert.deepEqual(keep([F("cena", "between", { max: "6000000" })], czk), [1]);   // 6 M Kč = 240 000 €
});

test("a date range compares ISO dates as text, not as numbers", () => {
  const d = { isDateKey: (k) => k === "datum" };
  assert.deepEqual(keep([F("datum", "between", { min: "2026-09-10" })], d), [2]);
});

test("empty / not-empty test presence only", () => {
  assert.deepEqual(keep([F("cena", "empty")]), [3]);
  assert.deepEqual(keep([F("cena", "not_empty")]), [1, 2]);
});

test("filters AND together", () => {
  assert.deepEqual(keep([F("izby", "in", { values: ["3"] }), F("stav", "not_in", { values: ["P"] })]), [3]);
});

// ── the quick-filter pills, the price boxes, currency-safe restore, per-project memory ──
let _id = 100;
const mk = (key) => ({ id: ++_id, key, mode: "in", values: [], min: "", max: "" });

test("a pill click adds the value, a second click drops it, an empty pill filter goes away", () => {
  let f = togglePillValue([], "stav", "V", mk);
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].values, ["V"]);
  f = togglePillValue(f, "stav", "R", mk);
  assert.deepEqual(f[0].values, ["V", "R"]);
  f = togglePillValue(f, "stav", "V", mk);
  assert.deepEqual(f[0].values, ["R"]);
  f = togglePillValue(f, "stav", "R", mk);
  assert.deepEqual(f, []);
});

test("a pill REPLACES an 'is not' on the same field instead of editing it", () => {
  const panel = [{ id: 1, key: "stav", mode: "not_in", values: ["P"], min: "", max: "" },
                 { id: 2, key: "izby", mode: "in", values: ["2"], min: "", max: "" }];
  const f = togglePillValue(panel, "stav", "V", mk);
  assert.equal(f.filter((x) => x.key === "stav").length, 1);
  assert.deepEqual(f.find((x) => x.key === "stav"), { ...f.find((x) => x.key === "stav"), mode: "in", values: ["V"] });
  assert.ok(f.some((x) => x.key === "izby"));                 // other fields untouched
});

test("a field that cannot take an 'is' is left alone", () => {
  assert.deepEqual(togglePillValue([], "cena_s_dph", "1", () => null), []);
});

test("the price boxes keep ONE between-filter and drop it when both are empty", () => {
  let f = setRangeFilter([], "cena_s_dph", "200000", "", mk);
  assert.equal(f.length, 1);
  assert.equal(f[0].mode, "between");
  assert.equal(f[0].min, "200000");
  f = setRangeFilter(f, "cena_s_dph", "200000", "300000", mk);
  assert.equal(f.length, 1);
  assert.equal(f[0].max, "300000");
  f = setRangeFilter(f, "cena_s_dph", "", "", mk);
  assert.deepEqual(f, []);
});

test("saved money bounds follow the currency they were typed in", () => {
  const saved = [{ id: 1, key: "cena_s_dph", mode: "between", min: "", max: "5000000", values: [] },
                 { id: 2, key: "izby", mode: "between", min: "2", max: "3", values: [] }];
  const isMoney = (k) => k === "cena_s_dph";
  // typed in Kč (1 € = 24.35 Kč), read back in € → ~205 339 €, not five million euro
  const inEur = rescaleSavedMoney(saved, 24.35, 1, isMoney);
  assert.equal(inEur[0].max, "205339");
  assert.equal(inEur[1].max, "3");                            // rooms are not money
  assert.equal(rescaleSavedMoney(saved, 1, 1, isMoney), saved);        // same currency: untouched
  assert.equal(rescaleSavedMoney(saved, null, 1, isMoney), saved);     // no record: untouched
});

test("the per-project filter memory keeps the most recent projects and drops junk", () => {
  const raw = {};
  for (let i = 0; i < 35; i++) raw[`p${i}`] = { filters: [], rate: 1, at: i };
  raw.bad = "x";
  raw.alsoBad = { filters: "no" };
  const out = cleanFilterScopes(raw, 30);
  assert.equal(Object.keys(out).length, 30);
  assert.ok(out.p34 && !out.p0 && !out.p4);                   // the five oldest went
  assert.ok(!out.bad && !out.alsoBad);
  assert.deepEqual(cleanFilterScopes([1, 2]), {});
});
