import test from "node:test";
import assert from "node:assert/strict";

import { t } from "./articleFormat.js";

// Every /analyzy English table printed Slovak decimals until 2026-09-23:
// to_cms.py kept only the Slovak parse of a table's rows, and Insights.jsx
// rendered each cell raw. Measured on one issue, 18 of 66 cells differed —
// "28,6 %" where an English reader expects "28.6 %".
//
// The fix rests entirely on t() treating the two cell shapes correctly, so the
// contract is pinned here rather than left to the component.
test("a table cell that is the same in both languages stays a plain string", () => {
  assert.equal(t("1 159", "sk"), "1 159");
  assert.equal(t("1 159", "en"), "1 159");
});

test("a cell that differs by language resolves to the reader's language", () => {
  const cell = { sk: "28,6 %", en: "28.6 %" };
  assert.equal(t(cell, "sk"), "28,6 %");
  assert.equal(t(cell, "en"), "28.6 %");
});

test("an English reader never falls back to a Slovak decimal silently", () => {
  // The fallback exists for a cell whose English side was never written; it must
  // not fire for one that has it, which is exactly the bug being fixed.
  assert.equal(t({ sk: "66,2 m²", en: "66.2 m²" }, "en"), "66.2 m²");
  // …and where there genuinely is no English, Slovak is better than blank.
  assert.equal(t({ sk: "Bratislava" }, "en"), "Bratislava");
});

test("a missing cell renders as empty, not as 'undefined'", () => {
  assert.equal(t(null, "sk"), "");
  assert.equal(t(undefined, "en"), "");
});
