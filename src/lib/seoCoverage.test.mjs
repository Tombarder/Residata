/**
 * The public site must not describe itself as smaller than it is.
 *
 * Until 2026-09-03 every per-route title and description said the product
 * covered "Bratislava". It has covered Slovakia AND Czechia for months. Worse,
 * these runtime values OVERWRITE the correct ones the build bakes into
 * index.html — verified live: the tab title changed from
 * "…for Slovakia & Czechia" to "…novostavieb Bratislava" once the app booted.
 * Google renders JavaScript, so Google saw the smaller claim, and so did
 * LinkedIn when the link was shared.
 *
 * seo.js cannot be imported here (it uses extensionless bundler imports), so
 * these read the source, the way identity.test.mjs does.
 *
 * Note the deliberate asymmetry: "Bratislava" is FINE and wanted in `keywords`
 * — it is plausibly the highest-volume local search term and dropping it would
 * cost real traffic. What is banned is a TITLE or DESCRIPTION that asserts the
 * coverage IS Bratislava.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEO = readFileSync(join(HERE, "seo.js"), "utf8");
const GEN = readFileSync(join(HERE, "..", "..", "scripts", "generate-static-content.mjs"), "utf8");

/** Every `title:` / `description:` string literal in the copy table. */
function claimLines() {
  return SEO.split("\n")
    .filter((l) => /^\s*(title|description):\s*"/.test(l))
    .map((l) => l.trim());
}

test("no title or description claims the product is Bratislava-only", () => {
  // "v Bratislave" / "for Bratislava" / "Bratislava New-Build Market" — a claim
  // about scope. A district name inside an example question is not this.
  const offenders = claimLines().filter((l) =>
    /(for|across|in)\s+Bratislava|Bratislava\s+(New-Build|real estate market)|v\s+Bratislave|novostavieb\s+Bratislava/i.test(l));
  assert.deepEqual(offenders, [],
    "these advertise a fraction of the actual market — see coveragePhrase()");
});

test("the two commercial pages name both countries", () => {
  for (const marker of [
    'title: "Residata — New-Build Market Intelligence for Slovakia & Czechia"',
    'title: "Residata — Dátový prehľad trhu novostavieb na Slovensku a v Česku"',
  ]) {
    assert.ok(SEO.includes(marker), `missing: ${marker}`);
  }
});

test("Bratislava is still targeted in keywords — it is the search term", () => {
  const kw = SEO.split("\n").filter((l) => /^\s*keywords:\s*"/.test(l)).join("\n");
  assert.ok(/novostavby Bratislava/.test(kw),
    "dropping the highest-volume Slovak term would cost real traffic");
});

test("the coverage token is actually substituted, like price is", () => {
  assert.ok(SEO.includes('split("__COVERAGE__").join(coverage)'),
    "an unsubstituted __COVERAGE__ would ship a literal placeholder into Google");
  const used = /__COVERAGE__/.test(SEO.replace(/split\("__COVERAGE__"\)/g, ""));
  assert.ok(used, "the token is defined but never used in any copy");
});

test("coverage degrades to a sentence with NO number when data is missing", () => {
  // A build without DB access must not assert a figure it cannot see, and must
  // not fall back to a hardcoded one that then rots.
  const fn = SEO.slice(SEO.indexOf("export function coveragePhrase"));
  const body = fn.slice(0, fn.indexOf("\nexport function applySeo"));
  const fallback = body.slice(body.lastIndexOf("return sk"));
  assert.ok(!/\d/.test(fallback), "the no-data fallback must contain no digits");
  assert.ok(/Slovensku a v Česku/.test(fallback) && /Slovakia and Czechia/.test(fallback),
    "the fallback still has to name both countries");
});

/** Pull the `["from", "to"]` pairs out of one country block in the source. */
function czRules(langKey) {
  const block = SEO.slice(SEO.indexOf("  CZ: {"), SEO.indexOf("  // There is deliberately NO"));
  const seg = block.slice(block.indexOf(`${langKey}: [`));
  const list = seg.slice(0, seg.indexOf("],"));
  return [...list.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)].map((m) => [m[1], m[2]]);
}
const applyRules = (s, rules) => rules.reduce((acc, [f, t]) => acc.split(f).join(t), s);

test("the Czech view never doubles a country name", () => {
  // The hazard: the base copy now says "Slovakia & Czechia", so a bare
  // ["Slovakia", "Czechia"] rule renders "…for Czechia & Czechia" to every
  // Czech-market visitor. This nearly shipped on 2026-09-03.
  const cases = [
    ["en", "Residata — New-Build Market Intelligence for Slovakia & Czechia"],
    ["en", "Explore every active new-build project across Slovakia and Czechia: units available."],
    ["sk", "Residata — Dátový prehľad trhu novostavieb na Slovensku a v Česku"],
    ["sk", "Pozrite si každý aktívny projekt novostavby na Slovensku a v Česku."],
  ];
  for (const [langKey, base] of cases) {
    const out = applyRules(base, czRules(langKey));
    for (const dup of ["Czechia & Czechia", "Czechia and Czechia", "Česku a v Česku", "Česku a na Česku"]) {
      assert.ok(!out.includes(dup), `CZ rules produced "${dup}" from: ${base}\n  → ${out}`);
    }
    assert.ok(/Czechia|Česku/.test(out), "the Czech view should still name Czechia first");
  }
});

test("no find-replace layer patches the base copy any more", () => {
  assert.ok(!/^\s{2}all:\s*\{/m.test(SEO),
    "an 'all' override block patches the OUTPUT and silently stops matching the " +
    "moment the base copy is edited — fix the base copy instead");
});

test("the build actually supplies the town count the copy asks for", () => {
  assert.ok(/total_cities:/.test(GEN),
    "coveragePhrase reads total_cities from the build snapshot; the generator must write it");
});
