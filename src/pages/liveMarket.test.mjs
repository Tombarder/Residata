/**
 * Analytics' "Aktuálne" is TODAY'S MARKET — run with: node --test src/pages/liveMarket.test.mjs
 *
 * Boss, 2026-09-28: Databáza bytov must show reality, "not technical details". Until
 * then it (and the Pivot's current view) read only what the developers' price lists
 * showed today, so a developer who deletes a sold flat took the sale with it: Tesla
 * Hloubětín read 180 flats and 0 sold there against 268 and 88 on its own page.
 *
 * The database now serves today's market in one shape (analytics.unit_facts_live behind
 * analytics_pivot / analytics_units, public.flats_live for the browser). The Pivot asks
 * it TWO ways — the server engine for most layouts, the browser for medians, distinct
 * counts and drill-downs — and both must read the same market, or one question gets two
 * answers depending on how it was asked. Same read-the-source approach as
 * pivotPriceScope.test.mjs: the pages are React, importing them drags in the app.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** The body of `function name(` … up to the next top-level `export`. */
function body(src, name) {
  const i = src.indexOf(`function ${name}(`);
  assert.ok(i >= 0, `${name} not found`);
  const j = src.indexOf("\nexport ", i + 1);
  return code(src.slice(i, j < 0 ? undefined : j));
}

const DATA = read("../lib/useData.js");

test("the Pivot's browser path reads today's market, like its server path", () => {
  const current = body(DATA, "useFlatsCurrent");
  assert.match(current, /from\("flats_live"\)/);
  assert.doesNotMatch(current, /from\("flats_current"\)/);
});

test("a Pivot drill-down in Aktuálne reads the same market as the cell it opened", () => {
  const drill = body(DATA, "fetchFlatsForProjects");
  assert.match(drill, /isCurrent \? "flats_live" : "flats_archive"/);
});

const PIVOT = read("PivotV2.jsx");

test("the sold measures carry no '(v cenníku)' — in Aktuálne they count every sale", () => {
  for (const key of ["abs_rate", "sold_count"]) {
    const i = PIVOT.indexOf(`\n  ${key}: {`);
    assert.ok(i >= 0, `${key} not in FIELDS`);
    const label = PIVOT.slice(i, i + 200).match(/label: "([^"]+)"/)[1];
    assert.ok(!/cenník/.test(label), `${key} still reads "${label}"`);
  }
  assert.ok(!/sold_count: "Sold \(on the price list\)"/.test(PIVOT));
});

test("history still says what it counts — only there", () => {
  // the summary line changes its words with the scope rather than claiming the same
  // thing in both: in history a deleted sold flat is absent from the later days
  assert.match(code(PIVOT), /isCurrent\s*\?\s*\(lang === "sk" \? "predaných" : "sold"\)/);
  assert.match(PIVOT, /predaných \(v cenníku daného dňa\)/);
});

const EXPLORER = read("UnitExplorer.jsx");

test("Databáza bytov frames a sold-and-removed flat the way the project page does", () => {
  const src = code(EXPLORER);
  // the STATUS cell of a row the database marks off its list gets the frame and the title
  assert.match(src, /const offList = k === "stav" && r\.on_price_list === false;/);
  assert.match(src, /offList\s*\?\s*<span title=\{offListTitle\(r\[k\], r\.last_seen_on, lang\)\}[^>]*dashed/);
  assert.match(src, /offListLegend\(lang\)/);
  // one wording: neither page spells the sentence out itself any more
  const WB = code(read("../components/FlatWorkbench.jsx"));
  for (const s of [src, WB]) assert.ok(!/Z cenníka zmizol po/.test(s));
});
