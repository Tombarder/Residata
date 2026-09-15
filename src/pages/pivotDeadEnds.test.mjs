/**
 * Every Pivot failure state must offer a way out.
 * Run with: node --test src/pages/pivotDeadEnds.test.mjs
 *
 * 🔴 WHY
 *
 * PivotV2 persists its layout PER USER (useAccountPrefState → the account prefs
 * store, not just localStorage). Two render branches — the grain error and the
 * oversized-archive refusal — replace the whole body, and the editing UI lives
 * inside the `!grainErrored && !archiveTooLarge` gate below them: LeftPanel, the
 * field palette, "Predvolené", "Vyčistiť".
 *
 * So a saved layout the engine cannot answer used to lock the user out of
 * Analytics permanently. Measured in the browser, logged in as admin,
 * 2026-09-15: dragging "Mesiac" into Rows with a price measure times out (the
 * price scope drops the query off the cube — see the has_price migration), and
 * after the failure the page offered
 *
 *     0 draggable chips · no reset · no clear · no field palette
 *
 * with one button, "Skúsiť znova", which reloads — rehydrating the same saved
 * layout and failing again. Confirmed across a full reload AND after clearing
 * localStorage, because the layout comes back from the server.
 *
 * The escape hatch is the fix, and these tests exist because it is invisible
 * until the day it is needed.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SRC = readFileSync(new URL("./PivotV2.jsx", import.meta.url), "utf8");

/** The JSX of one top-level render branch, from its guard to its closing `)}`. */
function branch(guard) {
  const i = SRC.indexOf(guard);
  assert.ok(i > 0, `render branch not found: ${guard}`);
  const j = SRC.indexOf("\n      )}", i);
  assert.ok(j > i, `could not find the end of: ${guard}`);
  return SRC.slice(i, j);
}

const DEAD_ENDS = [
  ["grain error", "{!isInitialLoading && grainErrored && ("],
  ["oversized archive", "{!isInitialLoading && !grainErrored && archiveTooLarge && ("],
];

for (const [name, guard] of DEAD_ENDS) {
  test(`the ${name} state offers a reset`, () => {
    assert.match(branch(guard), /onClick=\{resetToDefault\}/,
      `the ${name} branch hides the entire editing UI, so without resetToDefault ` +
      `the user has no way to change the layout that caused it — and the layout ` +
      `is saved server-side, so reloading reproduces the failure`);
  });
}

test("resetToDefault actually restores every part of the layout", () => {
  const i = SRC.indexOf("const resetToDefault = ");
  assert.ok(i > 0, "resetToDefault not found");
  const body = SRC.slice(i, SRC.indexOf("};", i));
  // Rows is the one that matters most — a time dimension there is what triggers
  // the archive path — but a partial reset would leave the user still stuck.
  for (const setter of ["setRows", "setCols", "setValues", "setFilters"]) {
    assert.match(body, new RegExp(`${setter}\\(DEFAULT_`),
      `resetToDefault must restore ${setter.slice(3)} — a reset that leaves the ` +
      `offending field in place is not an escape`);
  }
});

test("a reload is never the only button on the grain error", () => {
  const b = branch(DEAD_ENDS[0][1]);
  const reloads = (b.match(/window\.location\.reload/g) || []).length;
  assert.ok(reloads > 0, "expected the retry button to still be there");
  assert.match(b, /resetToDefault/,
    "reload alone rehydrates the saved layout and fails again — that was the bug");
  // And the user has to be told why reloading did not help.
  assert.match(b, /nastavenie sa ukladá|layout is saved/,
    "explain that the layout is saved, or the reset button looks arbitrary");
});

test("the escape is reachable without the hidden controls", () => {
  for (const [name, guard] of DEAD_ENDS) {
    const b = branch(guard);
    assert.ok(!/<LeftPanel/.test(b),
      `${name}: this test assumes LeftPanel is NOT in this branch — if it now is, ` +
      `the lock-out is fixed structurally and these tests should be revisited`);
  }
});
