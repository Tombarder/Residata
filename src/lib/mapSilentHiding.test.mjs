/**
 * Guard: the map may not remove a project from view without saying so.
 *
 * 🔴 WHY (2026-09-11, fixed 2026-09-15). Boss reported seeing 6 Nitra projects
 * where there are 9. His saved filters had "only priced" ticked, and three Nitra
 * projects publish no price at all — between them 158 available flats. Both
 * price controls drop a priceless project silently, and the header only ever
 * said how many were PLACED, never how many were taken away. The map therefore
 * looked like the whole city while showing two thirds of it.
 *
 * A project with NO published price is not a "no" to a price question, it is an
 * unknown — which is exactly why it deserves reporting rather than deletion. The
 * code comment on the filter default already said such projects "are part of the
 * market and belong on the map"; hiding them without a word contradicted that.
 *
 * (The live number moves as data improves — Šindolka gained a price on
 * 2026-09-14 when its parser was fixed, so Nitra reads 7 + 2 rather than 6 + 3.
 * That is the mechanism working, not drift.)
 *
 * Structural checks: MapView needs WebGL and a session, and an automation tab
 * never paints one (mapHealth.js), so asserting on pixels would prove nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP = readFileSync(join(HERE, "..", "pages", "MapView.jsx"), "utf8");

test("no price and out-of-range are treated as different answers", () => {
  assert.match(MAP, /const priceless = ppm2 <= 0;/,
    "the filter no longer separates 'no published price' from 'priced outside " +
    "the range' — only the first one is an unknown worth reporting");
  assert.match(MAP, /pricelessHidden\.push\(p\)/,
    "priceless projects are dropped without being collected, so nothing can " +
    "report them");
});

test("the count is taken in the SAME pass as the filter it describes", () => {
  // Re-running the predicates separately is how the two numbers drift apart.
  const memo = MAP.slice(MAP.indexOf("const filterPass = useMemo("));
  assert.ok(memo.length > 500, "filterPass is gone — this guard would read nothing");
  const body = memo.slice(0, memo.indexOf("}, [projects,"));
  assert.match(body, /kept\.push\(p\)/, "the kept list is no longer built here");
  assert.match(body, /pricelessHidden/, "the hidden list is no longer built here");
  assert.match(body, /return \{ kept, pricelessHidden \}/,
    "filterPass must return both, so they can never be computed from different filters");
});

test("the hidden count is held to the same tests as the visible count", () => {
  // A notice promising projects that still would not appear (no pin, or filtered
  // out by the name query) is a second lie replacing the first.
  const m = MAP.slice(MAP.indexOf("const hiddenNoPrice = useMemo("));
  assert.ok(m.length > 200, "hiddenNoPrice is gone");
  const body = m.slice(0, m.indexOf("}, ["));
  assert.match(body, /c\[p\.id\]/, "hidden count ignores whether the project even has a pin");
  assert.match(body, /norm\(p\.name\)\.includes\(q\)/,
    "hidden count ignores the name query, so it would over-promise while searching");
});

test("the header actually shows it, in both languages", () => {
  assert.match(MAP, /hiddenNoPrice > 0 &&/, "the notice is never rendered");
  assert.match(MAP, /skrytých — bez zverejnenej ceny/, "Slovak wording is gone");
  assert.match(MAP, /hidden — no published price/, "English wording is gone");
});

test("the notice explains WHY, not just how many", () => {
  // "2 hidden" invites the reading "we have no data". The truth is narrower and
  // better for us: the developer publishes no price, so the filter cannot judge.
  assert.match(MAP, /developer pri nich nezverejňuje cenu/,
    "the Slovak explanation is gone — a bare count reads as a gap in our data");
  assert.match(MAP, /the developer publishes no price/,
    "the English explanation is gone");
});
