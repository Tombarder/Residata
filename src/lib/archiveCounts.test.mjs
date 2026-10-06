/**
 * The archive's counts are flat-READINGS (one row per flat per reading). The assistant's
 * month-by-month history read them as flats: ~30× too many in a month read daily, and a
 * month read every few days looked like a market that collapsed.
 * api/_lib/archiveCounts.js divides each market-month by its readings.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveGroups, readingsPerMonth } from "../../api/_lib/archiveCounts.js";

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
