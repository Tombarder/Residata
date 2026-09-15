/**
 * The archive read must never present part of the market as the market.
 * Run with: node --test src/lib/archiveTruncation.test.mjs
 *
 * 🔴 WHY
 *
 * `useFlatsArchive` pages `public.flats_archive` into the browser and stops at
 * MAX_TOTAL = 500 000 rows. Until 2026-09-15 that stop produced a console.warn
 * and nothing else: the hook's entire return was { flats, loading, progress },
 * so a caller could not have distinguished a complete archive from half of one
 * even if it had wanted to.
 *
 * Measured against analytics.unit_facts, which is what flats_archive reads:
 *
 *     SK 2026-08                 854 269 rows   ← ONE month, 1.7x the cap
 *     SK 2026-07                 553 928 rows   ← also over
 *     SK, no month filter      2 174 864 rows   ← 4.3x the cap
 *     CZ, no month filter      1 204 726 rows
 *
 * The unfiltered case is the ordinary one, not a corner: dragging "Mesiac" into
 * Rows with a median is a config the server-side grain path cannot answer, so
 * the Pivot falls back to raw rows with no month filter at all. It then drew
 * medians and counts over 23 % of the Slovak archive and labelled them the
 * market. That is the failure this file exists to keep closed.
 *
 * These are source-shape assertions on purpose. The logic lives inside a React
 * hook with no test renderer in this repo, and the regressions worth catching
 * are structural: dropping a field from the return, or letting a truncated read
 * back into the module cache.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const USE_DATA = readFileSync(new URL("./useData.js", import.meta.url), "utf8");
const PIVOT = readFileSync(new URL("../pages/PivotV2.jsx", import.meta.url), "utf8");

/** The body of useFlatsArchive, so neighbouring hooks can't satisfy a match. */
function archiveHook() {
  const start = USE_DATA.indexOf("export function useFlatsArchive(");
  assert.ok(start > 0, "useFlatsArchive not found — did it get renamed?");
  const after = USE_DATA.indexOf("export function ", start + 10);
  return USE_DATA.slice(start, after === -1 ? USE_DATA.length : after);
}

test("the hook reports completeness, not just rows", () => {
  const body = archiveHook();
  const ret = body.match(/return \{[^}]*\};/g)?.pop();
  assert.ok(ret, "no return statement found in useFlatsArchive");
  for (const field of ["flats", "loading", "progress", "error", "truncated", "tooLarge"]) {
    assert.match(ret, new RegExp(`\\b${field}\\b`),
      `useFlatsArchive must return \`${field}\` — a caller that aggregates cannot ` +
      `tell a partial archive from a complete one without it`);
  }
});

test("a scope bigger than the cap is refused BEFORE fetching it", () => {
  const body = archiveHook();
  assert.match(body, /count:\s*["']estimated["']/,
    "the row count must be probed with the planner estimate (instant, no scan) " +
    "so an impossible scope costs one request, not ~435");
  assert.match(body, /head:\s*true/,
    "the probe must be a HEAD request — it wants the count, never the rows");
  assert.match(body, /estimated\s*!=\s*null\s*&&\s*estimated\s*>\s*MAX_TOTAL/,
    "the estimate must be compared against the same cap the paging loop uses");
  assert.match(body, /setTooLarge\(\s*\{[^}]*estimate[^}]*cap/,
    "a refusal must carry both numbers, so the page can tell the user how much " +
    "to narrow rather than just saying no");
});

test("a truncated read is never cached", () => {
  const body = archiveHook();
  assert.match(body, /if\s*\(\s*!hadError\s*&&\s*!hitCap\s*\)/,
    "the module cache must reject a capped read for the same reason it rejects " +
    "an errored one — a cached truncation is wrong for the rest of the session, " +
    "and re-reading at least has a chance of being right");
});

test("the cap is not quietly raised instead of refusing", () => {
  const body = archiveHook();
  const m = body.match(/const MAX_TOTAL = ([\d_]+);/);
  assert.ok(m, "MAX_TOTAL not found");
  const cap = Number(m[1].replace(/_/g, ""));
  assert.equal(cap, 500_000,
    "500 000 rows is already far past what belongs in a browser tab. If this " +
    "number moved, the fix was probably to make the refusal slower rather than " +
    "to compute the aggregate on the server, which is the real answer.");
  // The measurement that makes the cap meaningful must stay in the file, so the
  // next person sees that it is reached in ordinary use rather than in theory.
  assert.match(body, /854[\s  _]?269/,
    "keep the measured SK 2026-08 row count next to the cap — it is the evidence " +
    "that one month alone overflows it");
});

test("the Pivot consumes all three signals", () => {
  for (const field of ["truncated:", "tooLarge:", "error:"]) {
    assert.ok(PIVOT.includes(field),
      `PivotV2 must destructure \`${field}\` from useFlatsArchive — a hook that ` +
      `reports to nobody is the original bug in a new place`);
  }
});

test("the Pivot refuses an oversized scope instead of drawing it", () => {
  assert.match(PIVOT, /!archiveTooLarge\s*&&\s*\(<>/,
    "the results body must be gated on archiveTooLarge, so a refused scope " +
    "renders the explanation INSTEAD of a table built from nothing");
  assert.match(PIVOT, /archiveTooLarge\.estimate\.toLocaleString/,
    "tell the user the actual size — 'too large' without a number is not actionable");
});

test("partial data is flagged above the numbers it describes", () => {
  const banner = PIVOT.match(/\(archiveTruncated \|\| archiveError\) && \([\s\S]{0,1800}?\n {6}\)\}/);
  assert.ok(banner, "no partial-data banner found in PivotV2");
  assert.ok(!/dismiss|onClose|setHidden/i.test(banner[0]),
    "the partial-data warning must not be dismissible — the numbers stay wrong " +
    "after it is closed");
  assert.match(banner[0], /flatsProgress\.toLocaleString/,
    "say how many rows DID load; 'incomplete' alone does not tell the user how " +
    "far off the figures are");
});
