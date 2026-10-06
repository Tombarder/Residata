/**
 * The Pivot's history counts flats, not flat-readings — run with:
 *   node --test src/lib/archiveReadings.test.mjs
 *
 * In archive mode analytics_pivot counts one row per flat per READING. SK holds about
 * 7 500 flats: September (30 readings) showed ≈ 225 000 under Počet by Mesiac, October
 * (5 daily readings, then one every four days) ≈ 82 000 — a 63 % "fall" that is only
 * the market being read less often. By Datum, the mornings that re-collect a few missed
 * projects showed as days of their own: a sawtooth. src/lib/archiveReadings.js divides
 * each market-month by its full readings (public.archive_days) and drops the days that
 * are not one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  archiveGrainDims, readingDaysByCountry, archiveReadingScope, normaliseArchiveGrain,
  periodFactors, scaleComponents,
} from "./archiveReadings.js";
import { archiveGroups, readingsPerMonth } from "../../api/_lib/archiveCounts.js";

// SK read daily through September and on 1–5 October, then every four days.
const SEP = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
const OCT = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-09", "2026-10-13", "2026-10-17"];
const DAYS = readingDaysByCountry([...SEP, ...OCT].map((day) => ({ day, country: "SK" })));
const sum = (rows, k = "n") => rows.reduce((a, g) => a + (+g.m[k] || 0), 0);

test("the grain carries each row's market and month after the page's own dims", () => {
  assert.deepEqual(archiveGrainDims(["snapshot_month"]), ["snapshot_month", "country"]);
  assert.deepEqual(archiveGrainDims(["cast", "izby"]), ["cast", "izby", "country", "snapshot_month"]);
  assert.deepEqual(archiveGrainDims(["country", "datum"]), ["country", "datum"], "a day names its month");
});

test("Počet by Mesiac: a month read daily and a month read every four days hold the same 7 500 flats", () => {
  const dims = archiveGrainDims(["snapshot_month"]);
  const grain = [
    { d: ["2026-09", "SK"], m: { n: 7500 * 30, avail: 3000 * 30, sold: 4500 * 30 } },
    { d: ["2026-10", "SK"], m: { n: 7500 * 8, avail: 3000 * 8, sold: 4500 * 8 } },
  ];
  const out = normaliseArchiveGrain(grain, dims, DAYS, archiveReadingScope([]));
  assert.deepEqual(out.map((g) => [g.d[0], g.m.n, g.m.avail, g.m.sold]),
    [["2026-09", 7500, 3000, 4500], ["2026-10", 7500, 3000, 4500]]);
});

test("rows by Datum: a full reading is one reading; a morning that only re-collected missed projects is dropped", () => {
  const dims = archiveGrainDims(["datum"]);
  const full = { d: ["2026-10-09", "SK", "2026-10"], m: { n: 7500 } };
  const retry = { d: ["2026-10-10", "SK", "2026-10"], m: { n: 40 } };   // three projects
  const out = normaliseArchiveGrain([full, retry], dims, DAYS, archiveReadingScope([]));
  assert.equal(out.length, 1);
  assert.equal(out[0].m, full.m, "a day's bucket is that reading's flats as they are");
  assert.deepEqual(out[0].cell, { r: 1, mk: "SK", month: "2026-10", day: "2026-10-09" });
});

test("a Datum filter on one day divides by that one reading, not by the month's", () => {
  const dims = archiveGrainDims(["cast"]);
  const grain = [{ d: ["Ružinov", "SK", "2026-10"], m: { n: 1200 } }];
  const one = normaliseArchiveGrain(grain, dims, DAYS,
    archiveReadingScope([{ key: "datum", mode: "in", values: ["2026-10-09"] }]));
  assert.equal(one[0].m.n, 1200);
  const two = normaliseArchiveGrain([{ d: ["Ružinov", "SK", "2026-10"], m: { n: 2400 } }], dims, DAYS,
    archiveReadingScope([{ key: "datum", mode: "in", values: ["2026-10-09", "2026-10-13"] }]));
  assert.equal(two[0].m.n, 1200);
  const except = normaliseArchiveGrain([{ d: ["Ružinov", "SK", "2026-10"], m: { n: 1200 * 6 } }], dims, DAYS,
    archiveReadingScope([{ key: "datum", mode: "not_in", values: ["2026-10-01", "2026-10-02"] }]));
  assert.equal(except[0].m.n, 1200);
});

test("a Datum filter on a day that is no full reading leaves nothing to show", () => {
  const dims = archiveGrainDims(["cast"]);
  const out = normaliseArchiveGrain([{ d: ["Ružinov", "SK", "2026-10"], m: { n: 40 } }], dims, DAYS,
    archiveReadingScope([{ key: "datum", mode: "in", values: ["2026-10-10"] }]));
  assert.deepEqual(out, []);
});

test("two markets read on their own days are each divided by their own readings", () => {
  const days = readingDaysByCountry([
    ...OCT.map((day) => ({ day, country: "SK" })),
    ...["2026-10-02", "2026-10-06", "2026-10-10", "2026-10-14"].map((day) => ({ day, country: "CZ" })),
  ]);
  const dims = archiveGrainDims(["snapshot_month"]);
  const out = normaliseArchiveGrain([
    { d: ["2026-10", "SK"], m: { n: 7500 * 8 } },
    { d: ["2026-10", "CZ"], m: { n: 15000 * 4 } },
  ], dims, days, archiveReadingScope([]));
  assert.equal(sum(out), 22500);
});

test("averages over months weigh each month by its flats; minimum and maximum stay a flat's own", () => {
  const dims = archiveGrainDims([]);
  const out = normaliseArchiveGrain([
    { d: ["SK", "2026-09"], m: { n: 100 * 30, s_cs: 200000 * 100 * 30, n_cs: 100 * 30, mn_cs: 150000, mx_cs: 250000,
      s_pw: 200000 * 100 * 30, s_lw: 50 * 100 * 30 } },
    { d: ["SK", "2026-10"], m: { n: 100 * 8, s_cs: 240000 * 100 * 8, n_cs: 100 * 8, mn_cs: 190000, mx_cs: 290000,
      s_pw: 240000 * 100 * 8, s_lw: 50 * 100 * 8 } },
  ], dims, DAYS, archiveReadingScope([]));
  assert.equal(sum(out, "s_cs") / sum(out, "n_cs"), 220000);   // was 208 421: the daily month weighed ~4x
  assert.equal(sum(out, "s_pw") / sum(out, "s_lw"), 4400);
  assert.deepEqual(out.map((g) => [g.m.mn_cs, g.m.mx_cs]), [[150000, 250000], [190000, 290000]]);
});

test("Batch buckets are one snapshot each and stay as they are", () => {
  const byBatch = [{ d: ["2026-10-10T05:00:00+00:00", "SK", "2026-10"], m: { n: 40 } }];
  assert.equal(normaliseArchiveGrain(byBatch, archiveGrainDims(["batch_timestamp"]), DAYS, archiveReadingScope([])), byBatch);
  const picked = [{ d: ["Ružinov", "SK", "2026-10"], m: { n: 1200 } }];
  assert.equal(normaliseArchiveGrain(picked, archiveGrainDims(["cast"]), DAYS,
    archiveReadingScope([{ key: "batch_timestamp", mode: "in", values: ["2026-10-09T05:00:00+00:00"] }])), picked);
});

test("archive_days rows become each market's full readings by day", () => {
  const d = readingDaysByCountry([{ day: "2026-10-05", country: "SK", readings: 1 }, { day: "2026-10-05", country: "CZ" },
    { day: "2026-08-31", country: "SK", readings: 2 }, { day: "2026-10-07", country: "SK", readings: 0 },
    { day: null, country: "SK" }, { day: "2026-10-01" }]);
  assert.deepEqual(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Object.fromEntries([...v].sort())])),
    { SK: { "2026-08-31": 2, "2026-10-05": 1 }, CZ: { "2026-10-05": 1 } });
});

// ── a day can hold two readings ──
// 2026-08-31 SK holds two complete markets three hours apart (07:56 and 10:58, a manual
// re-run), and the archive holds every row of both. archive_days says so (readings 2).
const AUG = readingDaysByCountry(Array.from({ length: 31 }, (_, i) => ({
  day: `2026-08-${String(i + 1).padStart(2, "0")}`, country: "SK", readings: i === 30 ? 2 : 1,
})));

test("a month with a re-run day reads the market's flats, not one reading more", () => {
  const out = normaliseArchiveGrain([{ d: ["2026-08", "SK"], m: { n: 7500 * 32 } }],
    archiveGrainDims(["snapshot_month"]), AUG, archiveReadingScope([]));
  assert.equal(out[0].m.n, 7500, "counted as days, August read 7 742");
});

test("the re-run day's Datum bucket is the market's flats, not twice them", () => {
  const out = normaliseArchiveGrain([
    { d: ["2026-08-30", "SK", "2026-08"], m: { n: 7500 } },
    { d: ["2026-08-31", "SK", "2026-08"], m: { n: 7500 * 2 } },
  ], archiveGrainDims(["datum"]), AUG, archiveReadingScope([]));
  assert.deepEqual(out.map((g) => g.m.n), [7500, 7500]);
});

test("a Datum filter on the re-run day divides by its two readings", () => {
  const out = normaliseArchiveGrain([{ d: ["Ružinov", "SK", "2026-08"], m: { n: 1200 * 2 } }],
    archiveGrainDims(["cast"]), AUG, archiveReadingScope([{ key: "datum", mode: "in", values: ["2026-08-31"] }]));
  assert.equal(out[0].m.n, 1200);
});

test("the Pivot and the assistant divide the same month by the same readings", async () => {
  const { readingsPerMonth } = await import("../../api/_lib/archiveCounts.js");
  const rows = Array.from({ length: 31 }, (_, i) => ({
    day: `2026-08-${String(i + 1).padStart(2, "0")}`, country: "SK", readings: i === 30 ? 2 : 1,
  }));
  const pivot = normaliseArchiveGrain([{ d: ["2026-08", "SK"], m: { n: 32 } }],
    archiveGrainDims(["snapshot_month"]), readingDaysByCountry(rows), archiveReadingScope([]));
  assert.equal(32 / pivot[0].m.n, readingsPerMonth(rows)["SK|2026-08"]);
});

// ── the month is asked for only when the scope spans more than one ──
test("the grain carries the month only when the scope spans more than one", () => {
  const dimsFor = (filters, dims = ["project_name"]) => archiveGrainDims(dims, archiveReadingScope(filters));
  assert.deepEqual(dimsFor([{ key: "datum", mode: "in", values: ["2026-10-05"] }]), ["project_name", "country"]);
  assert.deepEqual(dimsFor([{ key: "datum", mode: "in", values: ["2026-10-01", "2026-10-05"] }]), ["project_name", "country"]);
  assert.deepEqual(dimsFor([{ key: "datum", mode: "in", values: ["2026-09-30", "2026-10-01"] }]), ["project_name", "country", "snapshot_month"]);
  assert.deepEqual(dimsFor([{ key: "snapshot_month", mode: "in", values: ["2026-09"] }]), ["project_name", "country"]);
  assert.deepEqual(dimsFor([{ key: "snapshot_month", mode: "in", values: ["2026-09", "2026-10"] }]), ["project_name", "country", "snapshot_month"]);
  assert.deepEqual(dimsFor([{ key: "snapshot_month", mode: "in", values: ["2026-09", "2026-10"] },
    { key: "datum", mode: "in", values: ["2026-10-02"] }]), ["project_name", "country"]);
  assert.deepEqual(dimsFor([{ key: "datum", mode: "not_in", values: ["2026-10-02"] }]), ["project_name", "country", "snapshot_month"]);
  assert.deepEqual(dimsFor([]), ["project_name", "country", "snapshot_month"]);
  assert.deepEqual(dimsFor([], ["datum"]), ["datum", "country"]);
  assert.deepEqual(dimsFor([], ["batch_timestamp"]), ["batch_timestamp", "country"]);
});

test("a single month's grain without its month is divided by that month's readings", () => {
  const scope = archiveReadingScope([{ key: "datum", mode: "in", values: ["2026-10-01", "2026-10-02", "2026-10-05"] }]);
  const dims = archiveGrainDims(["project_name"], scope);
  const out = normaliseArchiveGrain([{ d: ["Projekt X", "SK"], m: { n: 300 } }], dims, DAYS, scope);
  assert.equal(out[0].m.n, 100);
  assert.deepEqual(out[0].cell, { r: 3, mk: "SK", month: "2026-10", day: null });
});

// ── a table node averages over the periods it spans ──
// The Pivot's own node arithmetic (emptyComp / addComp / compOfGrain), run as written.
const PIVOT = readFileSync(new URL("../pages/PivotV2.jsx", import.meta.url), "utf8");
const nodeOf = (() => {
  const grab = (re) => { const m = PIVOT.match(re); assert.ok(m, `not found: ${re}`); return m[0]; };
  return new Function("periodFactors", "scaleComponents", `
    ${grab(/const _COMP_PREFIXES = [^\n]*/)}
    ${grab(/function emptyComp\(\)[\s\S]*?\n\}/)}
    ${grab(/function addComp\(acc, m\)[\s\S]*?\n\}/)}
    ${grab(/function compOfGrain\(rows\)[\s\S]*?\n\}/)}
    return compOfGrain;
  `)(periodFactors, scaleComponents);
})();
// SK read every day of September and on 1–5 and 9 October; one project of 100 flats.
const SK_DAYS = readingDaysByCountry([...SEP, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-09"]
  .map((day) => ({ day, country: "SK", readings: 1 })));
const projectOver = (sel) => {
  const perMonth = {};
  for (const d of sel) perMonth[d.slice(0, 7)] = (perMonth[d.slice(0, 7)] || 0) + 1;
  const filters = [{ key: "datum", mode: "in", values: sel }];
  const scope = archiveReadingScope(filters);
  const dims = archiveGrainDims(["project_name"], scope);
  const grain = Object.entries(perMonth).map(([m, k]) => ({
    d: dims.map((dim) => (dim === "project_name" ? "Projekt X" : dim === "country" ? "SK" : m)),
    m: { n: 100 * k, avail: 60 * k, sold: 40 * k, s_cs: 100 * k * 200000, n_cs: 100 * k },
  }));
  return nodeOf(normaliseArchiveGrain(grain, dims, SK_DAYS, scope));
};

test("a scope across two months shows a 100-flat project as 100, not one month-average per month", () => {
  for (const sel of [["2026-09-29", "2026-09-30"], ["2026-09-30", "2026-10-01"],
    ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]]) {
    const c = projectOver(sel);
    assert.equal(Math.round(c.n), 100, `Datum ${sel.join(",")}`);
    assert.equal(Math.round(c.avail), 60);
    assert.equal(c.s_cs / c.n_cs, 200000);
  }
});

test("Mesiac September and October: the Pivot's node and the assistant's group agree", () => {
  const grain = [
    { d: ["Projekt X", "SK", "2026-09"], m: { n: 100 * 30 } },
    { d: ["Projekt X", "SK", "2026-10"], m: { n: 100 * 6 } },
  ];
  const dims = ["project_name", "country", "snapshot_month"];
  const pivot = nodeOf(normaliseArchiveGrain(grain, dims, SK_DAYS,
    archiveReadingScope([{ key: "snapshot_month", mode: "in", values: ["2026-09", "2026-10"] }])));
  const days = [...SK_DAYS.SK].map(([day, readings]) => ({ day, country: "SK", readings }));
  const [assistant] = archiveGroups(grain, dims, "project_name", readingsPerMonth(days));
  assert.equal(Math.round(pivot.n), 100);
  assert.equal(assistant.units, 100);
});

test("a node over two markets adds each market's own average month", () => {
  // SK 400 flats in September and October; CZ 150 flats, read only in October.
  const days = readingDaysByCountry([...SEP.map((day) => ({ day, country: "SK" })),
    ...OCT.map((day) => ({ day, country: "SK" })), ...OCT.map((day) => ({ day, country: "CZ" }))]);
  const dims = ["country", "snapshot_month"];
  const grain = [
    { d: ["SK", "2026-09"], m: { n: 400 * 30 } }, { d: ["SK", "2026-10"], m: { n: 400 * 8 } },
    { d: ["CZ", "2026-10"], m: { n: 150 * 8 } },
  ];
  const total = nodeOf(normaliseArchiveGrain(grain, dims, days, archiveReadingScope([])));
  assert.equal(Math.round(total.n), 550, "SK's average month plus CZ's");
  const byCountry = archiveGroups(grain, dims, "country", readingsPerMonth(
    Object.entries(days).flatMap(([country, m]) => [...m].map(([day, readings]) => ({ day, country, readings })))));
  const [all] = archiveGroups(grain, dims, null, readingsPerMonth(
    Object.entries(days).flatMap(([country, m]) => [...m].map(([day, readings]) => ({ day, country, readings })))));
  assert.equal(all.units, byCountry.reduce((a, g) => a + g.units, 0), "the assistant's whole equals its countries");
  assert.equal(all.units, 550);
});

test("by Datum, a node over several days is the average day, and over months the average month", () => {
  const dims = archiveGrainDims(["datum"]);
  const rows = ["2026-09-29", "2026-09-30", "2026-10-01"].map((day) => ({ d: [day, "SK", day.slice(0, 7)], m: { n: 100 } }));
  const out = normaliseArchiveGrain(rows, dims, SK_DAYS, archiveReadingScope([]));
  assert.equal(Math.round(nodeOf(out).n), 100);
  assert.equal(Math.round(nodeOf(out.slice(0, 2)).n), 100);
});

test("today's market is summed as it always was", () => {
  const c = nodeOf([{ d: ["A"], m: { n: 120, avail: 20 } }, { d: ["B"], m: { n: 80, avail: 30 } }]);
  assert.equal(c.n, 200);
  assert.equal(c.avail, 50);
});

test("every number the Pivot builds from the grain is a node average", () => {
  const tree = PIVOT.match(/function buildTreeFromGrain\([\s\S]*?\n\}/)[0];
  assert.match(tree, /const rollupsFor = \(rows\) => \{ const c = compOfGrain\(rows\);/);
  assert.match(tree, /const compFor = \(rows\) => compOfGrain\(rows\);/);
  assert.match(tree, /const countFor = \(rows\) => Math\.round\(compOfGrain\(rows\)\.n\);/);
  assert.match(PIVOT, /included = Math\.round\(compOfGrain\(grain\)\.n\);/);
  assert.match(PIVOT, /total    = Math\.round\(compOfGrain\(grainUnscoped\)\.n\);/);
  assert.match(PIVOT, /const m = compOfGrain\(grain \|\| \[\]\);/);
});

// ── the page uses it ──
const DATA = readFileSync(new URL("./useData.js", import.meta.url), "utf8");

test("the Pivot asks the archive for the market and month of every row", () => {
  assert.match(PIVOT, /const specDims = useMemo\(\(\) => \(isCurrent \? gDims : archiveGrainDims\(gDims, readingScope\)\)/);
  assert.ok(PIVOT.indexOf("const readingScope = useMemo") < PIVOT.indexOf("const specDims = useMemo"),
    "the scope decides the dims, so it is read first");
  assert.match(PIVOT, /buildPivotSpec\(\{ dims: specDims, filters: effectiveFilters, country, isCurrent \}\)/);
  assert.match(PIVOT, /buildPivotSpec\(\{ dims: specDims, filters, country, isCurrent \}\)/);
});

test("everything the Pivot reads from the archive grain is in flats", () => {
  assert.match(PIVOT, /const grain = useMemo\(\(\) => grainView\(grainRaw, grainRawMeta, specDims\)/);
  assert.match(PIVOT, /const grainUnscoped = useMemo\(\(\) => grainView\(grainUnscopedRaw, grainUnscopedMeta, specDims\)/);
  assert.match(PIVOT, /return meta\.days \? normaliseArchiveGrain\(raw, meta\.dims, meta\.days, meta\.scope\) : null;/);
  // past the point where the flats are made, nothing reads the flat-readings
  const after = PIVOT.slice(PIVOT.indexOf("const grainLoading = "));
  assert.doesNotMatch(after, /\bgrainRaw\b|\bgrainUnscopedRaw\b/);
  assert.match(after, /buildTreeFromGrain\(grain, rows, cols, effectiveValues\)/);
});

test("counts become whole flats where they become numbers on the page", () => {
  assert.match(PIVOT, /v\.agg === "count"\) return Math\.round\(c\.n\);/);
  assert.match(PIVOT, /case "sold_count":    return Math\.round\(c\.sold\);/);
  assert.match(PIVOT, /case "available_count": return Math\.round\(c\.avail\);/);
  assert.match(PIVOT, /const countFor = \(rows\) => Math\.round\(/);
});

test("the readings come from archive_days for every market, every page of it", () => {
  const m = DATA.match(/function _loadArchiveReadings[\s\S]*?\n\}\n/);
  assert.ok(m, "_loadArchiveReadings not found");
  assert.match(m[0], /sbReadAll\(/);
  assert.match(m[0], /from\("archive_days"\)\s*\.select\(cols\)/);
  assert.match(m[0], /read\("day,country,readings"\)/, "each day's readings are what a month is divided by");
  assert.doesNotMatch(m[0], /_eqCountry/, "the All view divides each market by its own readings");
});

// ── a grain still on screen while the next loads is read as its own question ──
const DATA_SRC = readFileSync(new URL("./useData.js", import.meta.url), "utf8");
const grainViewOfHook = new Function(`${DATA_SRC.match(/function _grainView\([\s\S]*?\n\}/)[0]}\nreturn _grainView;`)();
const grainViewOfPage = new Function("normaliseArchiveGrain",
  `${PIVOT.match(/function grainView\(raw, meta, specDims\)[\s\S]*?\n\}/)[0]}\nreturn grainView;`)(normaliseArchiveGrain);

test("the hook hands back the held grain with the request it answers, as loading", () => {
  const held = { key: "k1", grain: [{ d: [], m: { n: 1 } }], meta: { tag: "old" }, error: false };
  const v = grainViewOfHook(held, "k2", { tag: "new" }, undefined);
  assert.equal(v.loading, true);
  assert.equal(v.grain, held.grain);
  assert.deepEqual(v.meta, { tag: "old" }, "the held grain must come with ITS request");
  assert.deepEqual(grainViewOfHook(held, "k1", { tag: "old" }, undefined), { grain: held.grain, meta: { tag: "old" }, loading: false, error: false });
  const cached = [{ d: [], m: { n: 2 } }];
  assert.deepEqual(grainViewOfHook(held, "k2", { tag: "new" }, cached), { grain: cached, meta: { tag: "new" }, loading: false, error: false });
  assert.deepEqual(grainViewOfHook(held, null, null, undefined), { grain: null, meta: null, loading: false, error: false });
  assert.equal(grainViewOfHook({ ...held, error: true }, "k2", null, undefined).error, false, "an error belongs to its request");
});

test("narrowing Datum from 1–5 October to 5 October shows 100 while the new grain loads, not 500", () => {
  const days = readingDaysByCountry(["01", "02", "03", "04", "05"].map((d) => ({ day: `2026-10-${d}`, country: "SK" })));
  const oldScope = archiveReadingScope([{ key: "datum", mode: "in", values: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"] }]);
  const newScope = archiveReadingScope([{ key: "datum", mode: "in", values: ["2026-10-05"] }]);
  const dimsOld = archiveGrainDims(["project_name"], oldScope);
  const dimsNew = archiveGrainDims(["project_name"], newScope);
  const held = [{ d: ["Projekt X", "SK"], m: { n: 500 } }];
  const shown = grainViewOfPage(held, { archive: true, dims: dimsOld, scope: oldScope, days }, dimsNew);
  assert.equal(Math.round(nodeOf(shown).n), 100);
});

test("an archive grain held while Aktuálne loads is still divided by its readings", () => {
  const days = readingDaysByCountry(OCT.map((day) => ({ day, country: "SK" })));
  const scope = archiveReadingScope([{ key: "snapshot_month", mode: "in", values: ["2026-10"] }]);
  const dims = archiveGrainDims(["country"], scope);            // [country]: the same as Aktuálne's
  const held = [{ d: ["SK"], m: { n: 7500 * 8 } }];
  const shown = grainViewOfPage(held, { archive: true, dims, scope, days }, ["country"]);
  assert.equal(Math.round(nodeOf(shown).n), 7500, "it showed the flat-readings, ×8");
});

test("a grain for another layout is not shown under this one", () => {
  assert.equal(grainViewOfPage([{ d: ["A", "SK"], m: { n: 1 } }], { archive: false, dims: ["cast"], scope: {}, days: null }, ["developer"]), null);
  const today = [{ d: ["A"], m: { n: 1 } }];
  assert.equal(grainViewOfPage(today, { archive: false, dims: ["cast"], scope: {}, days: null }, ["cast"]), today);
});

test("the page asks for the archive grain once the readings are known, and passes what it asks", () => {
  assert.match(PIVOT, /const grainEnabled = configServerable && \(isCurrent \|\| !!readingDays\);/);
  assert.match(PIVOT, /usePivotGrain\(\{ enabled: grainEnabled, spec: pivotSpec, meta: grainMeta,/);
  assert.match(PIVOT, /usePivotGrain\(\{ enabled: grainEnabled && priceScope, spec: pivotSpecUnscoped, meta: grainUnscopedMetaNow,/);
  assert.match(PIVOT, /\(\{ archive: !isCurrent, dims: specDims, scope: readingScope,\s*days: readingDays && heldReadingDays\(readingDays, readingHolding, specUsesCube\(pivotSpec, cubeDims\)\) \}\)/);
});

// ── the record path (median, distinct counts) and the drill-down count flats too ──
const { archiveRecordCells, weightedCount } = await import("./archiveReadings.js");
const recordCountOf = new Function("weightedCount", `
  ${PIVOT.match(/const _STAV = [^\n]*/)[0]}
  ${PIVOT.match(/function recordCount\(records, recordCell, pred\)[\s\S]*?\n\}/)[0]}
  return { recordCount, _STAV };
`)(weightedCount);

// A 100-flat project (60 on offer, 40 sold) seen at each reading of a scope.
const recordsOver = (dayList) => dayList.flatMap((day) => Array.from({ length: 100 }, (_, i) => ({
  country: "SK", project_id: "x", unit_id: `u${i}`, batch_timestamp: `${day}T05:12:00+00:00`,
  snapshot_month: day.slice(0, 7), stav: i < 60 ? "V" : "P",
})));

test("Počet on the record path is the flats, not the flat-readings: 100, not 700", () => {
  const sel = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-09"];
  const filters = [{ key: "snapshot_month", mode: "in", values: ["2026-10"] }];
  const recs = recordsOver(sel);
  const cell = archiveRecordCells(SK_DAYS, archiveReadingScope(filters), ["project_name"]);
  const { recordCount, _STAV } = recordCountOf;
  assert.equal(recs.length, 600);
  assert.equal(recordCount(recs, cell), 100);
  assert.equal(recordCount(recs, cell, (r) => _STAV(r) === "V"), 60);
  assert.equal(recordCount(recs, cell, (r) => _STAV(r) === "P"), 40);
  assert.equal(recordCount(recs, null), 600, "today's market: one record, one flat");
});

test("the record path averages over the months and days it spans, like the grain path", () => {
  const { recordCount } = recordCountOf;
  const recs = recordsOver(["2026-09-29", "2026-09-30", "2026-10-01"]);
  const scope = archiveReadingScope([{ key: "datum", mode: "in", values: ["2026-09-29", "2026-09-30", "2026-10-01"] }]);
  assert.equal(recordCount(recs, archiveRecordCells(SK_DAYS, scope, ["project_name"])), 100);
  assert.equal(recordCount(recs, archiveRecordCells(SK_DAYS, scope, ["datum"])), 100);
  // a morning that only re-collected a few projects is no reading: its records do not count
  const retry = recordsOver(["2026-10-07"]).slice(0, 5);
  assert.equal(recordCount([...recordsOver(["2026-10-05"]), ...retry],
    archiveRecordCells(SK_DAYS, archiveReadingScope([]), ["datum"])), 100);
});

test("the record path's tree, header and the drill-down all count this way", () => {
  assert.match(PIVOT, /if \(agg === "count"\) return recordCount\(records, recordCell\);/);
  assert.match(PIVOT, /field === FIELDS\.sold_count\) return recordCount\(records, recordCell, \(r\) => _STAV\(r\) === "P"\)/);
  assert.match(PIVOT, /field === FIELDS\.available_count\) return recordCount\(records, recordCell, \(r\) => _STAV\(r\) === "V"\)/);
  const tree = PIVOT.match(/function buildTree\(records, rowFields, colFields, valueDefs, recordCell = null\)[\s\S]*?\n\}/)[0];
  assert.equal((tree.match(/count: recordCount\((records|items), recordCell\)/g) || []).length, 3);
  assert.match(tree, /compute\(FIELDS\[v\.field\], v\.agg, recs, recordCell\)/);
  assert.match(PIVOT, /buildTree\(filteredRecords, rows, cols, effectiveValues, recordCell\)/);
  assert.match(PIVOT, /archiveRecordCells\(heldReadingDays\(readingDays, readingHolding, false\), readingScope, gDims\)/);
  assert.match(PIVOT, /const displayCount = useGrain \? \(rawTree\?\.count \|\| 0\) : recordsCount;/);
  assert.match(PIVOT, /configServerable \? displayCount : \(rawTree\?\.count \|\| 0\)/);
  assert.match(PIVOT, /configServerable \? displayCount : recordsCount/);
  assert.match(PIVOT, /const count = isCurrent \? undefined : node\.count;/);
  assert.match(PIVOT, /\(count \?\? records\.length\)\.toLocaleString/);
  assert.match(PIVOT, /useArchiveReadingDays\(\{ enabled: canViewAnalytics && !isCurrent \}\)/);
});

// ── the cube lags an approval until its refresh ──
const { specUsesCube, holdingSpecs, archiveHolding, heldReadingDays, monthReadings } = await import("./archiveReadings.js");
// November SK, read on 2 and 6 November (and a retry of a few projects on the 4th); the
// cube was last refreshed before the 6th was approved.
const NOV_DAYS = readingDaysByCountry([{ day: "2026-10-29", country: "SK" },
  { day: "2026-11-02", country: "SK", readings: 1 }, { day: "2026-11-06", country: "SK", readings: 1 }]);
const NOV_FACTS = [{ d: ["SK", "2026-11-02"], m: { n: 7500 } }, { d: ["SK", "2026-11-04"], m: { n: 40 } },
  { d: ["SK", "2026-11-06"], m: { n: 7500 } }];

test("what the cube holds is asked of the cube and the facts, for each market's newest month", () => {
  const specs = holdingSpecs(NOV_DAYS);
  assert.deepEqual(specs.cube, { dims: ["country", "snapshot_month"], mode: "archive", filters: { snapshot_month: ["2026-11"] } });
  assert.deepEqual(specs.facts, { dims: ["country", "datum"], mode: "archive", ranges: { datum: { min: "2026-11-01", max: null, includeEmpty: false } } });
  assert.equal(specUsesCube(specs.cube, new Set()), true);
  assert.equal(specUsesCube(specs.facts, new Set()), false, "the facts answer the day question");
});

test("a reading in archive_days that the cube does not hold yet is not counted for a cube grain", () => {
  const specs = holdingSpecs(NOV_DAYS);
  const holding = archiveHolding(specs.from, [{ d: ["SK", "2026-11"], m: { n: 7500 } }], NOV_FACTS);
  assert.deepEqual(monthReadings(heldReadingDays(NOV_DAYS, holding, true)), { "SK|2026-10": 1, "SK|2026-11": 1 });
  assert.deepEqual(monthReadings(heldReadingDays(NOV_DAYS, holding, false)), { "SK|2026-10": 1, "SK|2026-11": 2 });
  // the Pivot's November from the cube: 7 500, not 3 750
  const scope = archiveReadingScope([{ key: "snapshot_month", mode: "in", values: ["2026-11"] }]);
  const dims = archiveGrainDims(["country"], scope);
  const shown = grainViewOfPage([{ d: ["SK"], m: { n: 7500 } }],
    { archive: true, dims, scope, days: heldReadingDays(NOV_DAYS, holding, true) }, dims);
  assert.equal(Math.round(nodeOf(shown).n), 7500);
  // refreshed, it holds both (and the retry's rows)
  const later = archiveHolding(specs.from, [{ d: ["SK", "2026-11"], m: { n: 15040 } }], NOV_FACTS);
  assert.deepEqual(monthReadings(heldReadingDays(NOV_DAYS, later, true)), { "SK|2026-10": 1, "SK|2026-11": 2 });
});

test("a reading the facts do not hold either counts for neither; an unreadable holding changes nothing", () => {
  const specs = holdingSpecs(NOV_DAYS);
  const holding = archiveHolding(specs.from, [{ d: ["SK", "2026-11"], m: { n: 7500 } }], NOV_FACTS.slice(0, 1));
  assert.deepEqual(monthReadings(heldReadingDays(NOV_DAYS, holding, false)), { "SK|2026-10": 1, "SK|2026-11": 1 });
  assert.equal(heldReadingDays(NOV_DAYS, null, true), NOV_DAYS);
});

test("which grains read the cube follows the engine's routing", () => {
  const cube = new Set(["country", "snapshot_month", "cast", "stav", "has_price"]);
  assert.equal(specUsesCube({ dims: ["cast", "country"], filters: { stav: ["V"] } }, cube), true);
  assert.equal(specUsesCube({ dims: ["datum", "country"] }, cube), false);
  assert.equal(specUsesCube({ dims: ["cast"], ranges: { cena_s_dph: { min: "1" } } }, cube), false);
  assert.equal(specUsesCube({ dims: ["cast"], nulls: { cena_s_dph: "not_empty" } }, cube), false);
  assert.equal(specUsesCube({ dims: ["cast"], filters: { has_price: ["true"] } }, cube), true);
});

test("the Pivot divides each grain and the records by the readings their source holds", () => {
  assert.match(PIVOT, /heldReadingDays\(readingDays, readingHolding, specUsesCube\(pivotSpecUnscoped, cubeDims\)\)/);
  assert.match(PIVOT, /archiveRecordCells\(heldReadingDays\(readingDays, readingHolding, false\), readingScope, gDims\)/);
  assert.match(DATA, /holding = archiveHolding\(specs\.from, cube\.data, facts\.data\);/);
  assert.match(DATA, /const version = `\$\{readingsSignature\(days\)\}\/\$\{holdingSignature\(holding\)\}`;/);
});

// ── what the cube holds survives a few rows of drift ──
// The facts can grow without a cube refresh (a resync drained on a morning without one, a
// refresh that failed). A day is held while the cube covers at least half of its rows.
const throughOf = (total, rowsByDay) => {
  const days = readingDaysByCountry(rowsByDay.filter(([, , reading]) => reading !== false)
    .map(([day]) => ({ day: `2026-11-${day}`, country: "SK", readings: 1 })));
  const specs = holdingSpecs(days);
  const h = archiveHolding(specs.from, [{ d: ["SK", "2026-11"], m: { n: total } }],
    rowsByDay.map(([day, n]) => ({ d: ["SK", `2026-11-${day}`], m: { n } })));
  return { through: h.cubeThrough.get("SK|2026-11"), cube: monthReadings(heldReadingDays(days, h, true))["SK|2026-11"] || 0 };
};
for (const [name, total, rows, through, readings] of [
  ["steady", 15000, [["02", 7500], ["06", 7500]], "2026-11-06", 2],
  ["the cube lags the 6th", 7500, [["02", 7500], ["06", 7500]], "2026-11-02", 1],
  ["26 rows resynced into the 2nd, no refresh", 15000, [["02", 7526], ["06", 7500]], "2026-11-06", 2],
  ["drift, and the 6th lagging", 7500, [["02", 7526], ["06", 7500]], "2026-11-02", 1],
  ["a retry on the 3rd held, the 6th lagging", 7800, [["02", 7500], ["03", 300, false], ["06", 7500]], "2026-11-03", 1],
  ["a retry on the 7th not in the cube yet", 15000, [["02", 7500], ["06", 7500], ["07", 300, false]], "2026-11-06", 2],
  ["a sibling of the 6th approved late", 15000, [["02", 7500], ["06", 7800]], "2026-11-06", 2],
  ["the 2nd withdrawn, the cube not refreshed", 15000, [["06", 7500]], "2026-11-06", 1],
]) {
  test(`what the cube holds — ${name}`, () => {
    assert.deepEqual(throughOf(total, rows), { through, cube: readings });
  });
}

test("drift does not double the month: November with 26 rows resynced into the 2nd reads 7 500", () => {
  const days = readingDaysByCountry([{ day: "2026-11-02", country: "SK" }, { day: "2026-11-06", country: "SK" }]);
  const specs = holdingSpecs(days);
  const h = archiveHolding(specs.from, [{ d: ["SK", "2026-11"], m: { n: 15000 } }],
    [{ d: ["SK", "2026-11-02"], m: { n: 7526 } }, { d: ["SK", "2026-11-06"], m: { n: 7500 } }]);
  const scope = archiveReadingScope([{ key: "snapshot_month", mode: "in", values: ["2026-11"] }]);
  const dims = archiveGrainDims(["snapshot_month"], scope);
  const out = normaliseArchiveGrain([{ d: ["2026-11", "SK"], m: { n: 15000 } }], dims, heldReadingDays(days, h, true), scope);
  assert.equal(out[0].m.n, 7500);
});

test("kolaudacia is answered from the facts, so it is divided by the facts' readings", () => {
  assert.equal(specUsesCube({ dims: ["kolaudacia", "country", "snapshot_month"], mode: "archive" }, new Set()), false);
  assert.equal(specUsesCube({ dims: ["cast", "country"], filters: { kolaudacia: ["2027"] } }, new Set()), false);
  assert.equal(specUsesCube({ dims: ["orientacia", "country", "snapshot_month"] }, new Set()), true);
});
