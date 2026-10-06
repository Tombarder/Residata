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
  assert.match(PIVOT, /normaliseArchiveGrain\(grainRaw, specDims, readingDays, readingScope\)/);
  assert.match(PIVOT, /normaliseArchiveGrain\(grainUnscopedRaw, specDims, readingDays, readingScope\)/);
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
  const m = DATA.match(/export function useArchiveReadingDays[\s\S]*?\n\}\n/);
  assert.ok(m, "useArchiveReadingDays not found");
  assert.match(m[0], /sbReadAll\(/);
  assert.match(m[0], /from\("archive_days"\)\s*\.select\(cols\)/);
  assert.match(m[0], /read\("day,country,readings"\)/, "each day's readings are what a month is divided by");
  assert.doesNotMatch(m[0], /_eqCountry/, "the All view divides each market by its own readings");
});
