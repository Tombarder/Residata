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
} from "./archiveReadings.js";

// SK read daily through September and on 1–5 October, then every four days.
const SEP = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
const OCT = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-09", "2026-10-13", "2026-10-17"];
const DAYS = readingDaysByCountry([...SEP, ...OCT].map((day) => ({ day, country: "SK" })));
const sum = (rows, k = "n") => rows.reduce((a, g) => a + (+g.m[k] || 0), 0);

test("the grain carries each row's market and month after the page's own dims", () => {
  assert.deepEqual(archiveGrainDims(["snapshot_month"]), ["snapshot_month", "country"]);
  assert.deepEqual(archiveGrainDims(["cast", "izby"]), ["cast", "izby", "country", "snapshot_month"]);
  assert.deepEqual(archiveGrainDims(["country", "datum"]), ["country", "datum", "snapshot_month"]);
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
  assert.deepEqual(out, [full]);
  assert.equal(out[0], full, "a day's bucket is that reading's flats as they are");
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

// ── the page uses it ──
const PIVOT = readFileSync(new URL("../pages/PivotV2.jsx", import.meta.url), "utf8");
const DATA = readFileSync(new URL("./useData.js", import.meta.url), "utf8");

test("the Pivot asks the archive for the market and month of every row", () => {
  assert.match(PIVOT, /const specDims = useMemo\(\(\) => \(isCurrent \? gDims : archiveGrainDims\(gDims\)\)/);
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
