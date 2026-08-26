/**
 * Tests for the Pivot field palette — run with:  node --test src/pages/pivotFields.test.mjs
 * Zero-dependency (node:test + node:assert), reads PivotV2.jsx as text on purpose:
 * the file is a React page, so importing it would drag in the whole app.
 *
 * Focus: the bug where a field is OFFERED but can never hold a value.
 *
 * A flat row arriving from public.flats_current does NOT carry its project's
 * attributes — city, district, developer, project name, status all belong to the
 * project, and the browser re-attaches them per row in the `records` useMemo. That
 * is a deliberate design (repeating them on 40 000 rows would be slower), but it
 * means there are TWO hand-written lists of project-level attributes in one file:
 *
 *   1. PROJECT_LEVEL_ATTR — the map used to resolve a clicked cell to project ids
 *   2. the `records` enrichment — what actually gets copied onto each flat
 *
 * On 2026-08-26 `city` was in (1) and missing from (2). The palette showed "Mesto",
 * dragging it in looked completely normal, and every single row grouped into
 * "(prázdne)" — for months. Nothing failed; an empty envelope was delivered.
 *
 * These tests assert the two lists agree. They need no database and no fixture,
 * because both lists live in the same file — which is exactly why they can drift.
 *
 * The other half of the same disease (a dimension the SERVER offers that has no
 * data at all, e.g. the retired `batch_id`) is asserted against the live database
 * by integrity_check.check_offered_dims_are_live. Each check sits next to the list
 * it guards, so neither needs a copy of the other's.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "PivotV2.jsx"), "utf8");

/** Keys of the PROJECT_LEVEL_ATTR map — the project-level dimensions the pivot knows about. */
function projectLevelFields() {
  const block = SRC.slice(SRC.indexOf("const PROJECT_LEVEL_ATTR"));
  const body = block.slice(block.indexOf("{") + 1, block.indexOf("};"));
  return [...body.matchAll(/^\s*([a-z_0-9]+)\s*:\s*"([a-z_0-9]+)"/gm)].map(m => ({
    field: m[1], projectAttr: m[2],
  }));
}

/** Property names the `records` useMemo copies onto every flat row. */
function enrichedProps() {
  const at = SRC.indexOf("const records = useMemo");
  assert.notEqual(at, -1, "could not find the records useMemo — did it get renamed?");
  const body = SRC.slice(at, SRC.indexOf("}, [flats, projectById]);", at));
  return new Set([...body.matchAll(/^\s{8}([a-z_0-9]+):\s/gm)].map(m => m[1]));
}

/** What a palette accessor reads off the flat row, for one field key. */
function accessorReads(key) {
  const m = SRC.match(new RegExp(`^  ${key}:\\s+\\{[^\\n]*accessor:([^\\n]*)$`, "m"));
  return m ? [...new Set([...m[1].matchAll(/\br\.([a-z_0-9]+)/g)].map(x => x[1]))] : [];
}

test("every project-level dimension is actually copied onto the flat rows", () => {
  const enriched = enrichedProps();
  const missing = projectLevelFields()
    .flatMap(({ field }) => accessorReads(field))
    .filter(col => !enriched.has(col));
  assert.deepEqual(
    [...new Set(missing)], [],
    "a project-level field reads a property the enrichment never sets — it will render " +
    "(prázdne) for EVERY row while looking perfectly normal. This is the 2026-08-26 " +
    "`city` bug. Add it to the `records` useMemo in PivotV2.jsx.",
  );
});

test("city specifically — the field this test was written for", () => {
  assert.ok(enrichedProps().has("city"),
    "`city` is not set by the records enrichment; Mesto will be empty on every row");
  assert.deepEqual(accessorReads("city"), ["city"]);
});

test("the palette offers no field that reads a property nothing ever provides", () => {
  // Columns public.flats_current delivers are read straight off the flat; project
  // attributes are re-attached. A palette field may only read from those two sets.
  const enriched = enrichedProps();
  const paletteBlock = SRC.slice(SRC.indexOf("const FIELDS"));
  const keys = [...paletteBlock.matchAll(/^  ([a-z_0-9]+):\s+\{\s+label:/gm)].map(m => m[1]);
  assert.ok(keys.length >= 25, `only found ${keys.length} palette fields — parser drifted`);
  const projectOnly = new Set(["name", "status"]);       // live only on the project record
  const offenders = keys.flatMap(k => accessorReads(k)
    .filter(col => projectOnly.has(col) && !enriched.has(col))
    .map(col => `${k} reads r.${col}`));
  assert.deepEqual(offenders, []);
});

test("a retired field leaves no reference behind", () => {
  // `batch_id` was retired on 2026-08-26: it stopped being written on 2026-07-01, so
  // it could only ever render empty. A retired field must go from the palette AND
  // from every dim list, or it comes back as a dead entry.
  assert.equal(/^\s+batch_id:\s+\{/m.test(SRC), false,
    "batch_id is back in the palette — it has had no data since 2026-07-01");
  assert.equal(/"batch_id"/.test(SRC), false,
    "batch_id is still listed as a server-able / time dimension");
});
