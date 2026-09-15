/**
 * The price scope must not knock the pivot off the cube.
 * Run with: node --test src/pages/pivotPriceScopeCube.test.mjs
 *
 * 🔴 WHY
 *
 * Boss's ruling (board 4bbfd7, 2026-09-09) makes "only flats WITH a price"
 * automatic whenever money is in the question. It was expressed as a filter on
 * `cena_s_dph`, which is a MEASURE — and analytics_pivot drops off the
 * pre-aggregated cube for any filter key it finds in measure_registry:
 *
 *     PERFORM 1 FROM analytics.measure_registry WHERE key = k AND enabled;
 *     IF FOUND THEN use_cube := false;          -- measure filter → facts
 *
 * so every archive-mode query moved from analytics.unit_cube (81 316 rows) to
 * analytics.unit_facts (3 379 590 — 41x) and ran past the 8 s timeout.
 * Measured 2026-09-15, same dims (snapshot_month + project_name + izby):
 *
 *     no scope                         1 157 ms   200
 *     + home scope (a cube dim)        1 674 ms   200
 *     + PRICE scope (a measure)        8 099 ms   500  ← timeout
 *     + both                           8 118 ms   500  ← timeout
 *
 * `has_price` is the same test as a cube DIMENSION — the fix is_home already got.
 * It is chosen at RUNTIME from the live registry so this file can ship before the
 * migration: analytics_pivot raises 'unknown dim has_price' until the dimension
 * exists, and reading the registry is the same question the engine will ask.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SRC = readFileSync(new URL("./PivotV2.jsx", import.meta.url), "utf8");

test("both spellings of the scope exist and mean the same thing", () => {
  assert.match(SRC, /const PRICE_SCOPE_FILTER = Object\.freeze\(\{ key: "cena_s_dph", mode: "not_empty" \}\)/,
    "the measure form must stay — it is the fallback while the dimension does not exist");
  assert.match(SRC, /const PRICE_SCOPE_FILTER_CUBE = Object\.freeze\(\{ key: "has_price", mode: "in", values: \["true"\] \}\)/,
    "the cube form must be an ordinary dimension filter, like HOME_SCOPE_FILTER");
});

test("which one is used is decided by the LIVE registry, never by a constant", () => {
  const m = SRC.match(/const priceScopeIsCubeable = useMemo\(([\s\S]{0,300}?)\);/);
  assert.ok(m, "priceScopeIsCubeable not found");
  assert.match(m[1], /registry\.dimensions/,
    "it must ask the registry the engine itself resolves against — hardcoding the " +
    "answer reintroduces the deploy-order trap this exists to remove");
  assert.match(m[1], /PRICE_SCOPE_DIM/,
    "compare against the named constant so the dimension name has one spelling");
});

test("the scope still goes into effectiveFilters, one or the other, never both", () => {
  const m = SRC.match(/const effectiveFilters = useMemo\(\(\) => \{([\s\S]*?)\}, \[/);
  assert.ok(m, "effectiveFilters not found");
  const body = m[1];
  assert.match(body, /priceScopeIsCubeable \? PRICE_SCOPE_FILTER_CUBE : PRICE_SCOPE_FILTER/,
    "exactly one form is appended — appending both would filter twice and, worse, " +
    "the measure one would still knock the query off the cube");
  assert.match(body, /if \(!priceScope\) return filters;/,
    "the scope must stay conditional on money actually being in the question");
  // The recomputation has to see the registry arriving, or the first render's
  // answer (registry still empty → fallback) would stick for the session.
  const deps = SRC.match(/\}, \[filters, priceScope, homeScope, priceScopeIsCubeable\]\);/);
  assert.ok(deps, "priceScopeIsCubeable must be a dependency — the registry loads " +
                  "asynchronously, so without it the page keeps the slow form forever");
});

test("has_price is server-able, or the fallback is worse than the bug", () => {
  const m = SRC.match(/const SERVERABLE_DIMS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(m, "SERVERABLE_DIMS not found");
  assert.match(m[1], /"has_price"/,
    "an unlisted key makes isServerable() false, which pushes the whole query onto " +
    "the raw-record path — the 500 000-row archive road, i.e. slower than the " +
    "timeout this change is fixing");
});

test("the measured evidence stays next to the code that rests on it", () => {
  assert.match(SRC, /8 099 ms|8099/,
    "keep the measurement: without it the next reader sees two filters that look " +
    "equivalent and deletes one");
  assert.match(SRC, /81 316|3 379 590/,
    "keep the two table sizes — they are why a dimension and a measure are not " +
    "interchangeable here");
});
