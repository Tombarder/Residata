/**
 * The archive's counts are flat-READINGS (one row per flat per reading). The assistant's
 * month-by-month history read them as flats: ~30× too many in a month read daily, and a
 * month read every few days looked like a market that collapsed.
 * api/_lib/archiveCounts.js divides each market-month by its readings.
 */
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { archiveGroups, readingsPerMonth, fetchMarketReadings } from "../../api/_lib/archiveCounts.js";

const dims = ["snapshot_month", "country"];
const row = (month, country, n, extra = {}) => ({ d: [month, country], m: { n, avail: n, sold: 0, res: 0, ...extra } });

test("a month read daily and a month read every four days hold the same 400 flats", () => {
  const readings = { "SK|2026-09": 30, "SK|2026-10": 8 };
  const out = archiveGroups([row("2026-09", "SK", 400 * 30), row("2026-10", "SK", 400 * 8)],
    dims, "snapshot_month", readings);
  const by = Object.fromEntries(out.map((g) => [g.group, g.units]));
  assert.deepEqual(by, { "2026-09": 400, "2026-10": 400 });
});

test("two markets read on their own days add up per month", () => {
  const readings = { "SK|2026-11": 8, "CZ|2026-11": 7 };
  const out = archiveGroups([row("2026-11", "SK", 400 * 8), row("2026-11", "CZ", 150 * 7)],
    dims, "snapshot_month", readings);
  assert.equal(out[0].units, 550);
});

test("another grouping over the history is the average month", () => {
  const d3 = ["cast", "country", "snapshot_month"];
  const rows = [
    { d: ["Ružinov", "SK", "2026-09"], m: { n: 100 * 30, avail: 80 * 30, s_cs: 900, n_cs: 3 } },
    { d: ["Ružinov", "SK", "2026-10"], m: { n: 120 * 8, avail: 90 * 8, s_cs: 300, n_cs: 1 } },
  ];
  const [g] = archiveGroups(rows, d3, "cast", { "SK|2026-09": 30, "SK|2026-10": 8 });
  assert.equal(g.group, "Ružinov");
  assert.equal(g.units, 110);
  assert.equal(g.available, 85);
  assert.equal(g.avg_price_eur, 300);              // 300 in both months, so 300 over both
});

test("a month with no full reading of its market (a repair alone) is left out", () => {
  const out = archiveGroups([row("2026-10", "SK", 5)], dims, "snapshot_month", {});
  assert.deepEqual(out, []);
});

test("readings are counted per market and month from the archive's days", () => {
  assert.deepEqual(readingsPerMonth([
    { day: "2026-10-05", country: "SK" }, { day: "2026-10-09", country: "SK" },
    { day: "2026-10-05", country: "CZ" }, { day: null, country: "SK" },
  ]), { "SK|2026-10": 2, "CZ|2026-10": 1 });
});

// ── W3b: a group is averaged over ITS months, not the months of the whole answer ──
// SK read daily Jul–Sep, every four days in October. OLD has 100 flats throughout;
// NEW was launched in September with 200. Asked by project, NEW used to read 100: its
// 400 flat-months divided by the four months OLD spans. Asked as a filter on NEW, the
// same flats read 200. They are the same question and must give the same number.
const R_SK = { "SK|2026-07": 31, "SK|2026-08": 31, "SK|2026-09": 30, "SK|2026-10": 8 };
const launch = () => {
  const rows = [];
  for (const [m, r] of Object.entries(R_SK).map(([k, v]) => [k.slice(3), v])) {
    rows.push({ d: ["OLD", "SK", m], m: { n: 100 * r, avail: 100 * r, sold: 0, res: 0 } });
    if (m >= "2026-09") rows.push({ d: ["NEW", "SK", m], m: { n: 200 * r, avail: 150 * r, sold: 50 * r, res: 0 } });
  }
  return rows;
};

test("a project launched in September reads the same grouped by project as filtered to it", () => {
  const dims = ["project_name", "country", "snapshot_month"];
  const by = Object.fromEntries(archiveGroups(launch(), dims, "project_name", R_SK).map((g) => [g.group, g]));
  assert.equal(by.OLD.units, 100);
  assert.equal(by.NEW.units, 200, "NEW was diluted by the months before it existed");
  assert.equal(by.NEW.available, 150);
  assert.equal(by.NEW.sold, 50);

  const only = launch().filter((r) => r.d[0] === "NEW").map((r) => ({ d: [r.d[1], r.d[2]], m: r.m }));
  const [f] = archiveGroups(only, ["country", "snapshot_month"], null, R_SK);
  assert.equal(f.units, by.NEW.units, "group_by=project and a filter on the project must agree");
});

test("a market read since September is averaged over its own months, not the other market's", () => {
  const readings = { ...R_SK, "CZ|2026-09": 30, "CZ|2026-10": 7 };
  const rows = [];
  for (const [k, r] of Object.entries(readings)) {
    const [c, m] = k.split("|");
    rows.push({ d: [c, m], m: { n: (c === "SK" ? 400 : 150) * r } });
  }
  const by = Object.fromEntries(archiveGroups(rows, ["country", "snapshot_month"], "country", readings)
    .map((g) => [g.group, g.units]));
  assert.deepEqual(by, { SK: 400, CZ: 150 });
});

// ── W3c: every month weighs by its flats, not by how often it was read ──
// 100 flats at 200 000 € in July, August and September (read daily), at 240 000 € in
// October (read every four days). The average month is 210 000 €. A ratio of the raw
// sums weighed each daily month ~4x the October one and gave 203 200 €.
test("an average price over the history weighs each month by its flats, not its readings", () => {
  const rows = Object.entries(R_SK).map(([k, r]) => {
    const m = k.slice(3);
    const price = m === "2026-10" ? 240000 : 200000;
    return { d: ["SK", m], m: { n: 100 * r, avail: 100 * r, s_cs: price * 100 * r, n_cs: 100 * r,
      s_pw: price * 100 * r, s_lw: 50 * 100 * r, mn_cs: price, mx_cs: price } };
  });
  const [g] = archiveGroups(rows, ["country", "snapshot_month"], null, R_SK);
  assert.equal(g.avg_price_eur, 210000);
  assert.equal(g.avg_eur_per_m2, 4200);             // 210 000 € over 50 m²
  assert.equal(g.min_price, 200000);
  assert.equal(g.max_price, 240000);
});

test("two markets in one month weigh by their flats, not by how often each was read", () => {
  // SK 400 flats at 200 000 € read 8 times; CZ 100 flats at 100 000 € read 30 times.
  const readings = { "SK|2026-11": 8, "CZ|2026-11": 30 };
  const rows = [
    { d: ["2026-11", "SK"], m: { n: 400 * 8, s_cs: 200000 * 400 * 8, n_cs: 400 * 8 } },
    { d: ["2026-11", "CZ"], m: { n: 100 * 30, s_cs: 100000 * 100 * 30, n_cs: 100 * 30 } },
  ];
  const [g] = archiveGroups(rows, dims, "snapshot_month", readings);
  assert.equal(g.units, 500);
  assert.equal(g.avg_price_eur, 180000);            // (400·200 000 + 100·100 000) / 500
});

// ── W3a: a day can hold two readings ──
// 2026-08-31 SK holds two complete markets three hours apart (07:56 and 10:58, a manual
// re-run), and the archive holds every row of both: August carries 32 readings' rows.
// Counted as days it had 31 readings, and its stock read 7 742 for 7 500.
// public.archive_days says how many full readings each day holds.
const AUGUST = Array.from({ length: 31 }, (_, i) => ({
  day: `2026-08-${String(i + 1).padStart(2, "0")}`, country: "SK", readings: i === 30 ? 2 : 1,
}));

test("two readings on one day are two readings, so a re-run day does not inflate the month", () => {
  const readings = readingsPerMonth(AUGUST);
  assert.deepEqual(readings, { "SK|2026-08": 32 });
  const [g] = archiveGroups([row("2026-08", "SK", 7500 * 32)], dims, "snapshot_month", readings);
  assert.equal(g.units, 7500, "the re-run day counted the market twice");
  const asDays = readingsPerMonth(AUGUST.map(({ day, country }) => ({ day, country })));
  assert.equal(archiveGroups([row("2026-08", "SK", 7500 * 32)], dims, "snapshot_month", asDays)[0].units, 7742);
});

test("a day without a readings column is one reading; a day of none is none", () => {
  assert.deepEqual(readingsPerMonth([
    { day: "2026-10-05", country: "SK" }, { day: "2026-10-09", country: "SK", readings: null },
    { day: "2026-10-13", country: "SK", readings: 0 }, { day: "2026-10-17", country: "CZ", readings: 2 },
  ]), { "SK|2026-10": 2, "CZ|2026-10": 2 });
});

// A stand-in for the service-key client's public.archive_days, paged the way PostgREST
// pages (1 000 rows at most), optionally as the view was before it carried `readings`.
function fakeAdmin({ days = [], withoutReadings = false, cubeRows = null, factRows = null } = {}) {
  const calls = [];
  // analytics_pivot: what the cube and the facts hold; without them given, unreadable.
  const rpc = (name, { p_spec: spec }) => {
    calls.push(`rpc ${spec.dims.join(",")}`);
    const rows = spec.dims[1] === "snapshot_month" ? cubeRows : factRows;
    return Promise.resolve(rows ? { data: rows, error: null } : { data: null, error: { message: "not here" } });
  };
  const from = (name) => {
    let cols = "";
    const b = {
      select(c) { cols = c; return b; },
      order() { return b; },
      range(lo, hi) {
        calls.push(`${name} ${cols} ${lo}-${hi}`);
        if (withoutReadings && cols.includes("readings")) {
          return Promise.resolve({ data: null, error: { message: "column archive_days.readings does not exist" } });
        }
        const pick = (r) => Object.fromEntries(cols.split(",").filter((k) => k in r).map((k) => [k, r[k]]));
        return Promise.resolve({ data: days.slice(lo, Math.min(hi + 1, lo + 1000)).map(pick), error: null });
      },
    };
    return b;
  };
  return { calls, from, rpc };
}

test("the assistant reads every page of archive_days, with its readings", async () => {
  const many = Array.from({ length: 1500 }, (_, i) => ({
    day: new Date(Date.UTC(2022, 0, 1) + i * 86400000).toISOString().slice(0, 10), country: "SK", readings: 1,
  }));
  many[1499].readings = 2;
  const admin = fakeAdmin({ days: many });
  const { cube: counts } = await fetchMarketReadings(admin);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 1501);
  assert.ok(admin.calls.includes("archive_days day,country,readings 1000-1999"), "the second page was not read");
});

test("before archive_days carries readings, each day is one reading", async () => {
  const admin = fakeAdmin({ withoutReadings: true, days: [
    { day: "2026-10-05", country: "SK", readings: 2 }, { day: "2026-10-09", country: "SK", readings: 1 }] });
  assert.deepEqual((await fetchMarketReadings(admin)).cube, { "SK|2026-10": 2 });
});

// ── the cube lags an approval until its refresh ──
// November SK: readings on 2 and 6 November, both approved — archive_days and the facts
// hold both. The cube was last refreshed between them: its November is one reading.
const NOV = [{ day: "2026-10-29", country: "SK", readings: 1 },
  { day: "2026-11-02", country: "SK", readings: 1 }, { day: "2026-11-06", country: "SK", readings: 1 }];
const NOV_CUBE = [{ d: ["SK", "2026-11"], m: { n: 7500 } }];
const NOV_FACTS = [{ d: ["SK", "2026-11-02"], m: { n: 7500 } }, { d: ["SK", "2026-11-04"], m: { n: 40 } },
  { d: ["SK", "2026-11-06"], m: { n: 7500 } }];

test("a reading archive_days counts but the cube does not hold yet is not counted for the cube", async () => {
  const admin = fakeAdmin({ days: NOV, cubeRows: NOV_CUBE, factRows: NOV_FACTS });
  const r = await fetchMarketReadings(admin);
  assert.deepEqual(r.cube, { "SK|2026-10": 1, "SK|2026-11": 1 });
  assert.deepEqual(r.facts, { "SK|2026-10": 1, "SK|2026-11": 2 }, "the facts hold both");
  const [g] = archiveGroups([row("2026-11", "SK", 7500)], dims, "snapshot_month", r.cube);
  assert.equal(g.units, 7500, "divided by both readings it read 3 750");
});

test("once the cube is refreshed, it counts the reading again", async () => {
  const admin = fakeAdmin({ days: NOV, cubeRows: [{ d: ["SK", "2026-11"], m: { n: 15040 } }], factRows: NOV_FACTS });
  assert.deepEqual((await fetchMarketReadings(admin)).cube, { "SK|2026-10": 1, "SK|2026-11": 2 });
});

test("the assistant divides a cube answer by the cube's readings and a range answer by the facts'", () => {
  const SRC = readFileSync(new URL("../../api/ai/chat.js", import.meta.url), "utf8");
  assert.match(SRC, /archiveGroups\(data, dims, gkey, specUsesCube\(spec\) \? readings\.cube : readings\.facts\)/);
});

test("the assistant knows when the cube lags, so it keeps those readings only a minute", async () => {
  assert.equal((await fetchMarketReadings(fakeAdmin({ days: NOV, cubeRows: NOV_CUBE, factRows: NOV_FACTS }))).lagging, true);
  assert.equal((await fetchMarketReadings(fakeAdmin({ days: NOV, cubeRows: [{ d: ["SK", "2026-11"], m: { n: 15040 } }], factRows: NOV_FACTS }))).lagging, false);
});
