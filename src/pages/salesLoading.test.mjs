/**
 * Sales figures never show the previous question's answer as this one's — run with:
 *   node --test src/pages/salesLoading.test.mjs
 *
 * Two ways they did:
 *  · useSales (useData.js) kept the previous spec's data while the next loaded, and on
 *    the render in which the spec changed — before its effect said "loading" — that data
 *    read as settled. The dashboard's month-ago pace ignored loading anyway, so switching
 *    All → Ružinov compared Ružinov's pace with the whole market's for a second: "−560".
 *  · the Sales page ended its window on today until the market's last data day arrived,
 *    sent that today-anchored query, showed its window and numbers, then replaced them.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DATA = readFileSync(new URL("../lib/useData.js", import.meta.url), "utf8");
const DASH = readFileSync(new URL("./DashboardHome.jsx", import.meta.url), "utf8");
const SALES = readFileSync(new URL("./SalesView.jsx", import.meta.url), "utf8");

const salesView = (() => {
  const m = DATA.match(/function _salesView\([\s\S]*?\n\}/);
  assert.ok(m, "_salesView not found in useData.js");
  return new Function(`${m[0]}\nreturn _salesView;`)();
})();

test("the answer to the previous spec is loading, not settled, for the new one", () => {
  const held = { key: "u::all", data: { sold_durable: 900 }, loading: false, error: false };
  const v = salesView(held, "u::ruzinov");
  assert.equal(v.loading, true);
  assert.equal(v.data, held.data, "the held answer stays on screen while the next loads");
  assert.deepEqual(salesView(held, "u::all"), { data: held.data, loading: false, error: false });
});

test("an error belongs to the request that failed", () => {
  const failed = { key: "u::all", data: null, loading: false, error: true };
  assert.equal(salesView(failed, "u::all").error, true);
  assert.equal(salesView(failed, "u::ruzinov").error, false);
});

test("a disabled request has nothing and is not loading", () => {
  assert.deepEqual(salesView({ key: "u::all", data: { x: 1 }, loading: false, error: false }, null),
    { data: null, loading: false, error: false });
});

test("useSales returns that view, keyed by identity and spec", () => {
  const m = DATA.match(/export function useSales\([\s\S]*?\n\}\n/);
  assert.ok(m, "useSales not found");
  assert.match(m[0], /const reqKey = enabled && spec \? `\$\{identity\}::\$\{specKey\}` : null;/);
  assert.match(m[0], /return _salesView\(state, reqKey\);/);
  assert.match(m[0], /setState\(\{ key: reqKey, data: d \|\| null, loading: false, error: false \}\)/);
});

test("the dashboard's month-ago pace has no value while a market's answer is loading", () => {
  const m = DASH.match(/const part = \(spec, res\) => \{[\s\S]*?\n    \};/);
  assert.ok(m, "prevSold's part() not found");
  const part = new Function(`${m[0]}\nreturn part;`)();
  const spec = { mode: "summary" };
  assert.ok(Number.isNaN(part(spec, { data: { sold_durable: 560 }, loading: true })), "a held answer was read as this scope's");
  assert.equal(part(spec, { data: { sold_durable_prorated: 74.6 }, loading: false }), 74.6);
  assert.equal(part(null, undefined), 0);
  assert.ok(Number.isNaN(part(undefined, undefined)));
});

test("the Sales page asks nothing until its window's end is known", () => {
  assert.match(SALES, /const \{ date: freshness, settled: freshnessSettled \} = useFreshnessStatus\(\);/);
  assert.match(SALES, /const windowKnown = !!customTo \|\| freshnessSettled \|\| freshnessGaveUp;/);
  assert.match(SALES, /setTimeout\(\(\) => setFreshnessGaveUp\(true\), FRESHNESS_WAIT_MS\)/);
  for (const q of ["sum", "brk", "det", "fac"]) {
    assert.match(SALES, new RegExp(`const ${q}Q = useSales\\(\\{ enabled: windowKnown, spec: `), `${q} is asked before the window is known`);
    assert.match(SALES, new RegExp(`const ${q} = windowKnown \\? ${q}Q : SALES_WAITING;`), `${q} does not read as loading while it waits`);
  }
  assert.match(SALES, /const SALES_WAITING = Object\.freeze\(\{ data: null, loading: true, error: false \}\);/);
  assert.doesNotMatch(SALES, /useSales\(\{ enabled: true,/);
});

test("the window shown above the figures is the one they are for", () => {
  assert.match(SALES, /visibility: windowKnown \? undefined : "hidden"/);
});
