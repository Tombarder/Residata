/**
 * Tests for the Dashboard's comparison arrows — run with:
 *   node --test src/pages/dashboardMomDelta.test.mjs
 *
 * `aggHistory`, `constantPanelDelta`, `aggMomDelta`, `availableMomPeriods` and
 * `coverageShift` are pure, so this extracts them from the page source and runs
 * them for real rather than asserting on code shape.
 *
 * 🔴 WHY — and why this file changed on 2026-09-23
 *
 * It used to hold the panel constant for averages and ratios ONLY, on the
 * argument that a count is different: "restricting to the shared set here would
 * hide a genuine increase". That argument has a hole — it reasons about projects
 * ARRIVING and never about projects LEAVING. Measured on SK, 2026-08 → 2026-09
 * (11 onboarded, 5 dropped out of the offer):
 *
 *     voľné byty     all projects  +273    same panel   +62    4.4x overstated
 *     rezervované    all projects   −42    same panel  −136    3.2x understated
 *     predané        all projects  +217    same panel  +407    UNDERSTATED
 *
 * The last row is the one the old reasoning could not produce: five projects
 * leaving took their sold counts with them, so pooling *hid* market movement
 * instead of inventing it. The distortion has no consistent sign, so a reader
 * cannot correct for it, and the card's VALUE already carries the true total.
 *
 * What the old behaviour was trying to say — "we added projects" — is now said
 * out loud by coverageShift(), under the strip, where it is information.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SRC = readFileSync(new URL("./DashboardHome.jsx", import.meta.url), "utf8");

function extract(name) {
  const m = SRC.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`, "m"));
  if (!m) throw new Error(`could not extract ${name}`);
  return m[0];
}

const MOM_METRICS = SRC.match(/const MOM_METRICS = [\s\S]*?\);/m)[0];
// MOM_PERIODS is imported from useDashboardConfig so the UI can never offer a
// period the stored-config normalizer would throw away. Read it from there, and
// assert below that the two halves still agree.
const CFG = readFileSync(new URL("../lib/useDashboardConfig.js", import.meta.url), "utf8");
const MOM_PERIODS = CFG.match(/export const OVERVIEW_MOM_BACK = \[.*?\];/m)[0]
  .replace("export const OVERVIEW_MOM_BACK", "const MOM_PERIODS");
const api = new Function(`
  ${MOM_METRICS}
  ${MOM_PERIODS}
  ${extract("aggHistory")}
  ${extract("availableMomPeriods")}
  ${extract("constantPanelDelta")}
  ${extract("aggMomDelta")}
  ${extract("coverageShift")}
  return { aggHistory, aggMomDelta, availableMomPeriods, coverageShift };
`)();
const { aggMomDelta, availableMomPeriods, coverageShift } = api;

const row = (month, id, o = {}) => ({
  snapshot_month: month, project_id: id,
  available_units: 0, sold_units: 0, reserved_units: 0, prereserved_units: 0,
  avg_price_eur_m2: null, developer: "D", ...o,
});

/** "old" is in both months; "new" only in September and much cheaper. */
const ADDED = [
  row("2026-08", "old", { available_units: 100, sold_units: 100, avg_price_eur_m2: 6000 }),
  row("2026-09", "old", { available_units: 100, sold_units: 110, avg_price_eur_m2: 6100 }),
  row("2026-09", "new", { available_units: 100, sold_units: 0,   avg_price_eur_m2: 3000 }),
];
const IDS = new Set(["old", "new"]);

test("the price arrow follows prices, not onboarding", () => {
  const d = aggMomDelta("avg_m2", IDS, ADDED);
  assert.ok(d, "no delta returned");
  assert.equal(Math.round(d.abs), 100, "expected the like-for-like +100, not a pooled fall");
});

test("the absorption arrow follows absorption, not onboarding", () => {
  const d = aggMomDelta("sold_through", IDS, ADDED);
  assert.ok(d, "no delta returned");
  assert.ok(Math.abs(d.abs - 2.38) < 0.05, `expected ≈ +2.38 pp, got ${d.abs}`);
});

test("a COUNT is like-for-like too — an arrow is a claim about a period", () => {
  // The only project in both months did not change its availability. The pooled
  // reading is +100, which is the eleven-projects-onboarded error in miniature.
  const d = aggMomDelta("available", IDS, ADDED);
  assert.equal(d, null, "a count must not report our own onboarding as a market move");
});

test("a project LEAVING must not hide market movement — the case the old rule missed", () => {
  // `stay` genuinely sold 40 more. `gone` was in the offer in August and is not
  // in September, taking its 500 sold with it. Pooled: 540 → 140, i.e. ▼ 400,
  // while the market actually moved ▲ 40.
  const DROPPED = [
    row("2026-08", "stay", { available_units: 50, sold_units: 100 }),
    row("2026-08", "gone", { available_units: 10, sold_units: 500 }),
    row("2026-09", "stay", { available_units: 50, sold_units: 140 }),
  ];
  const d = aggMomDelta("sold_total", new Set(["stay", "gone"]), DROPPED);
  assert.ok(d, "no delta returned");
  assert.equal(d.abs, 40, `expected the true +40, got ${d.abs}`);
});

test("the delta reports the panel it was measured over", () => {
  const d = aggMomDelta("avg_m2", IDS, ADDED);
  assert.equal(d.panel, 1, "one project was in both months");
  assert.equal(d.added, 1, "one project joined");
  assert.equal(d.back, 1);
});

test("no shared projects means no arrow, rather than a made-up one", () => {
  const disjoint = [
    row("2026-08", "a", { available_units: 10, sold_units: 1, avg_price_eur_m2: 5000 }),
    row("2026-09", "b", { available_units: 10, sold_units: 1, avg_price_eur_m2: 9000 }),
  ];
  assert.equal(aggMomDelta("avg_m2", new Set(["a", "b"]), disjoint), null);
});

test("a longer comparison reaches further back, by month name not array index", () => {
  const THREE = [
    row("2026-06", "p", { available_units: 10, avg_price_eur_m2: 5000 }),
    row("2026-07", "p", { available_units: 12, avg_price_eur_m2: 5200 }),
    row("2026-08", "p", { available_units: 14, avg_price_eur_m2: 5400 }),
    row("2026-09", "p", { available_units: 20, avg_price_eur_m2: 5600 }),
  ];
  const ids = new Set(["p"]);
  assert.equal(aggMomDelta("available", ids, THREE, 1).abs, 6,  "1 month back: 14 → 20");
  assert.equal(aggMomDelta("available", ids, THREE, 3).abs, 10, "3 months back: 10 → 20");
  assert.equal(aggMomDelta("available", ids, THREE, 9), null,   "further back than history goes");
});

test("only periods the history can actually serve are offered", () => {
  const h = (n) => Array.from({ length: n }, (_, i) => ({ month: `m${i}`, ids: new Set(["p"]) }));
  assert.deepEqual(availableMomPeriods(h(2)),  [1],        "two buckets support one month back");
  assert.deepEqual(availableMomPeriods(h(4)),  [1, 3],     "four buckets reach three months");
  assert.deepEqual(availableMomPeriods(h(13)), [1, 3, 6, 12]);
  assert.deepEqual(availableMomPeriods(h(1)),  [],         "one bucket supports no comparison");
  assert.deepEqual(availableMomPeriods([]),    []);
});

test("coverage change is reported separately, never folded into an arrow", () => {
  const c = coverageShift(IDS, ADDED);
  assert.deepEqual(c, { added: 1, dropped: 0 });
  const stable = [row("2026-08", "p", { available_units: 1 }), row("2026-09", "p", { available_units: 2 })];
  assert.equal(coverageShift(new Set(["p"]), stable), null, "nothing to say when the panel held");
});

test("the offered periods and the stored-config contract are ONE list", () => {
  // Two hand-kept copies is how `momBack` got silently dropped on load in the
  // first place: the UI offered 3 months, normalize() rebuilt `overview` without
  // it, and the setting appeared not to save.
  assert.match(SRC, /const MOM_PERIODS = OVERVIEW_MOM_BACK/,
    "DashboardHome must derive its periods from useDashboardConfig, not restate them");
  assert.match(CFG, /momBack: Number\(raw\.overview\.momBack\)/,
    "normalize() must carry momBack through, or the choice does not persist");
});
