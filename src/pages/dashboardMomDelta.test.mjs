/**
 * Tests for the Dashboard's month-over-month arrows — run with:
 *   node --test src/pages/dashboardMomDelta.test.mjs
 *
 * `aggHistory` and `aggMomDelta` are pure, so this extracts them from the page
 * source and runs them for real rather than asserting on code shape.
 *
 * 🔴 WHY
 *
 * The arrows compare the latest snapshot_month bucket with the one before it.
 * A COUNT growing because we onboarded projects is a true statement — 12 242 →
 * 12 311 available units IS more inventory. An AVERAGE and a RATIO are not:
 * add eleven cheaper projects and the average falls without one price moving.
 *
 * Measured on the live buckets 2026-08 → 2026-09 (2026-09-15):
 *
 *     avg €/m²      all projects   5 924 → 5 913   ▼ 11
 *                   like-for-like  5 920 → 5 942   ▲ 22
 *     sold-through  all projects   62,15 → 62,02   ▼ 0,13 pp
 *                   like-for-like  61,49 → 62,19   ▲ 0,70 pp
 *
 * Both arrows pointed the WRONG WAY, on the first card of the first page a user
 * sees. That is the board's caveat d5532b — "the only valid price time series is
 * the same-unit comparison" — showing up on a surface.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SRC = readFileSync(new URL("./DashboardHome.jsx", import.meta.url), "utf8");

function extract(name, kind = "function") {
  const re = kind === "function"
    ? new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`, "m")
    : new RegExp(`const ${name} = [\\s\\S]*?\\);`, "m");
  const m = SRC.match(re);
  if (!m) throw new Error(`could not extract ${name}`);
  return m[0];
}

const MOM = SRC.match(/const MOM_METRICS = [\s\S]*?\);/m)[0];
const sandbox = new Function(`
  ${MOM}
  ${extract("aggHistory")}
  ${extract("COMPOSITION_SENSITIVE", "const")}
  ${extract("aggMomDelta")}
  return { aggHistory, aggMomDelta };
`)();
const { aggMomDelta } = sandbox;

/** Two months. "old" is in both; "new" only in September and is much cheaper. */
const SNAPSHOTS = [
  { snapshot_month: "2026-08-01", project_id: "old", available_units: 100, sold_units: 100,
    reserved_units: 0, prereserved_units: 0, avg_price_eur_m2: 6000, developer: "D" },
  { snapshot_month: "2026-09-01", project_id: "old", available_units: 100, sold_units: 110,
    reserved_units: 0, prereserved_units: 0, avg_price_eur_m2: 6100, developer: "D" },
  { snapshot_month: "2026-09-01", project_id: "new", available_units: 100, sold_units: 0,
    reserved_units: 0, prereserved_units: 0, avg_price_eur_m2: 3000, developer: "E" },
];
const IDS = new Set(["old", "new"]);

test("the price arrow follows prices, not onboarding", () => {
  // `old` went 6000 → 6100. Pooled with the new cheap project the average falls
  // to 4550, which is the arrow that used to be drawn.
  const d = aggMomDelta("avg_m2", IDS, SNAPSHOTS);
  assert.ok(d, "no delta returned");
  assert.equal(Math.round(d.abs), 100, "expected the like-for-like +100, not a pooled fall");
  assert.ok(d.abs > 0, "the arrow points down while the only project in both months rose");
});

test("the absorption arrow follows absorption, not onboarding", () => {
  // `old` went 100/200 = 50 % to 110/210 = 52.4 %. Pooled with a project that has
  // sold nothing, it reads as a fall.
  const d = aggMomDelta("sold_through", IDS, SNAPSHOTS);
  assert.ok(d, "no delta returned");
  assert.ok(d.abs > 0, "the arrow points down while the only project in both months rose");
  assert.ok(Math.abs(d.abs - 2.38) < 0.05, `expected ≈ +2.38 pp, got ${d.abs}`);
});

test("a COUNT still counts everything — onboarding is real inventory", () => {
  // 100 available in August, 200 in September. Restricting to the shared set
  // here would hide a genuine increase.
  const d = aggMomDelta("available", IDS, SNAPSHOTS);
  assert.ok(d, "no delta returned");
  assert.equal(d.abs, 100);
});

test("only the average and the ratio are population-sensitive", () => {
  const set = SRC.match(/const COMPOSITION_SENSITIVE = new Set\(\[(.*?)\]\)/s)[1];
  const names = [...set.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, ["avg_m2", "sold_through"]);
});

test("no shared projects means no arrow, rather than a made-up one", () => {
  const disjoint = [
    { snapshot_month: "2026-08-01", project_id: "a", available_units: 10, sold_units: 1,
      reserved_units: 0, prereserved_units: 0, avg_price_eur_m2: 5000 },
    { snapshot_month: "2026-09-01", project_id: "b", available_units: 10, sold_units: 1,
      reserved_units: 0, prereserved_units: 0, avg_price_eur_m2: 9000 },
  ];
  assert.equal(aggMomDelta("avg_m2", new Set(["a", "b"]), disjoint), null);
});
