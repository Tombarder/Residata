/**
 * The price map's legend must name the population its number belongs to.
 *
 * 🔴 WHY (2026-09-15, found by reading the live home page as a visitor). The
 * page showed two different €/m² "averages" 25 % apart, one above the other:
 *
 *   hero            PRIEMER TRHU €/m²      5 895 €/m²
 *   price-map key   priemerná              4 705 €/m²
 *
 * Both numbers were right. 5 895 is the market (and integrity_check's
 * public_numbers_anon asserts the anon key sees exactly that). 4 705 was the
 * UNWEIGHTED mean of the eleven region rows then on screen — deliberately
 * unweighted, because a units-weighted midpoint is dragged up by Praha and
 * Bratislava until the cheap half of the table is one indistinguishable colour,
 * and it moves every time you drill. It is a scale midpoint, not a market price.
 *
 * The defect was the WORD, not the arithmetic: the key borrowed "priemerná" from
 * the market average sitting a screen above it. The same borrowing made the two
 * colour labels wrong by implication — Bratislavský kraj at 5 598 €/m² is above
 * these rows and BELOW the market, and read "nad priemerom".
 *
 * So the invariant this file holds: the legend states which population it means,
 * and that word tracks the drill level, because the number does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, "..", "pages", "HomeExtras.jsx"), "utf8");

/** The legend block only — a match from elsewhere in a 1 200-line file proves nothing. */
function legend() {
  const i = SRC.indexOf("pod priemerom");
  assert.ok(i > 0, "the price-map legend is gone — this guard would read nothing");
  const body = SRC.slice(i - 400, i + 1400);
  assert.ok(body.includes("nad priemerom"), "legend block did not contain both poles");
  return body;
}

test("the midpoint is still the unweighted mean of the rows on screen", () => {
  // If someone switches this to the weighted market average, the legend's wording
  // below becomes wrong in the other direction — so the two must move together.
  const i = SRC.indexOf("function priceScale(");
  assert.ok(i > 0, "priceScale is gone");
  const fn = SRC.slice(i, SRC.indexOf("\n}", i));
  assert.match(fn, /values\.reduce\(\(a, b\) => a \+ b, 0\) \/ values\.length/,
    "the midpoint is no longer the plain mean of the rows shown — if that is intended, " +
    "the legend wording in this same file has to change with it");
});

test("the printed number is labelled with the population it is a mean of", () => {
  const b = legend();
  assert.ok(!/\?\s*"priemerná"\s*:/.test(b),
    'the legend prints a bare "priemerná" again — on the home page that word already ' +
    "belongs to the market average (5 895), and this number is not it");
  assert.ok(!/\?\s*"average"\s*:/.test(b), "the legend prints a bare \"average\" again");
  assert.match(b, /priemer \$\{rowsWord\}/, "the Slovak midpoint label no longer names its population");
  assert.match(b, /\$\{rowsWord\} average/, "the English midpoint label no longer names its population");
});

test("both colour poles name the same population as the midpoint", () => {
  // "nad priemerom" unqualified reads as "above the market", which is false for
  // every row between the row-mean and the market average.
  const b = legend();
  assert.match(b, /pod priemerom \$\{rowsWord\}/, "the Slovak low pole lost its population");
  assert.match(b, /nad priemerom \$\{rowsWord\}/, "the Slovak high pole lost its population");
  assert.match(b, /below the \$\{rowsWord\} average/, "the English low pole lost its population");
  assert.match(b, /above the \$\{rowsWord\} average/, "the English high pole lost its population");
});

test("the population word follows the drill level, because the number does", () => {
  const i = SRC.indexOf("const rowsWord =");
  assert.ok(i > 0, "rowsWord is gone — the legend would name one level at every level");
  const decl = SRC.slice(i, i + 400);
  for (const w of ["krajov", "miest", "mestských častí", "regions", "cities", "districts"]) {
    assert.ok(decl.includes(w), `rowsWord no longer covers "${w}"`);
  }
  assert.match(decl, /drill\.level === "region"/, "rowsWord stopped reading the drill level");
});
