/**
 * The Sales page's period presets — run with:
 *   node --test src/pages/salesWindow.test.mjs
 *
 * analytics_sales counts sale_day >= date_from AND sale_day <= date_to: both ends are in.
 * The presets set date_from = date_to minus N days, so "30 dní" held 31 days of sales,
 * "45 dní" 46 — while the dashboard's Predané / 30 dní card holds exactly 30. The window
 * code is run here as written in the page, not re-implemented.
 */
// The page computes the window in the reader's local calendar; run it in theirs.
process.env.TZ = "Europe/Bratislava";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SRC = readFileSync(new URL("./SalesView.jsx", import.meta.url), "utf8");
const fn = (name) => {
  const m = SRC.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`, "m"));
  if (!m) throw new Error(`could not extract ${name}`);
  return m[0];
};
const fromLine = SRC.match(/const date_from = ([^\n]*);/);
const windowOf = new Function("customFrom", "date_to", "days", `
  ${fn("isoLocal")}
  ${fn("isoDaysBefore")}
  return ${fromLine[1]};
`);
// sale days in [from, to], both ends counted, as the engine counts them
const span = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;

for (const days of [30, 45, 60, 90]) {
  test(`the ${days}-day preset holds ${days} days of sales`, () => {
    const to = "2026-10-05";
    assert.equal(span(windowOf("", to, days), to), days);
  });
}

test("30 days ending on the last data day are the dashboard card's 30 days", () => {
  // DashboardHome: the card is anchor-29 … anchor
  assert.equal(windowOf("", "2026-10-05", 30), "2026-09-06");
});

test("a preset keeps its length across a change of the clocks", () => {
  assert.equal(span(windowOf("", "2026-04-10", 30), "2026-04-10"), 30);
  assert.equal(span(windowOf("", "2026-11-10", 45), "2026-11-10"), 45);
});

test("a typed 'from' is the user's own and is left as it is", () => {
  assert.equal(windowOf("2026-01-01", "2026-10-05", 30), "2026-01-01");
});
