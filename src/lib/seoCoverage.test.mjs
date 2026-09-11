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

// ── hreflang: three files, one list of languages (2026-09-11) ──────────────
//
// `applySeo` only ever UPDATES a <link rel=alternate> it finds and never removes
// one, so a language that leaves PUBLIC_LANGS survives in index.html forever and
// goes on telling Google that version exists. Live on 2026-09-11 the homepage
// advertised `hreflang="cs"` — Czech was built, then deliberately held back from
// launch, and a Czech search result would have landed on the English site.
// locale.js promises that re-exposing a language is ONE edit; it can only be
// true if the static HTML and the sitemap generator follow the same list.
const INDEX_HTML = readFileSync(join(HERE, "..", "..", "index.html"), "utf8");
const LOCALE = readFileSync(join(HERE, "locale.js"), "utf8");

/** The languages locale.js actually exposes, read from the source. */
function publicLangs() {
  const m = /export const PUBLIC_LANGS = \[([^\]]*)\]/.exec(LOCALE);
  assert.ok(m, "PUBLIC_LANGS not found in locale.js — this guard would read nothing");
  const langs = [...m[1].matchAll(/"([a-z]{2})"/g)].map((x) => x[1]);
  assert.ok(langs.length > 0, "PUBLIC_LANGS parsed as empty — the guard would pass vacuously");
  return langs;
}

const hreflangsIn = (src) =>
  [...src.matchAll(/hreflang="([a-z-]+)"/g)].map((m) => m[1]);

test("index.html advertises exactly the languages locale.js exposes", () => {
  const want = [...publicLangs(), "x-default"].sort();
  const got = [...new Set(hreflangsIn(INDEX_HTML))].sort();
  assert.deepEqual(got, want,
    "index.html hreflang set drifted from PUBLIC_LANGS — a language listed here " +
    "but not public is advertised to Google and lands the visitor on another one");
});

test("the sitemap generator advertises the same languages", () => {
  const want = [...publicLangs(), "x-default"].sort();
  const got = [...new Set(hreflangsIn(GEN))].sort();
  assert.deepEqual(got, want, "sitemap hreflang set drifted from PUBLIC_LANGS");
});

test("no og:locale:alternate names a language that is not public", () => {
  const langs = publicLangs();
  const alts = [...INDEX_HTML.matchAll(/og:locale:alternate"\s+content="([a-z]{2})_/g)]
    .map((m) => m[1]);
  assert.ok(alts.length > 0, "no og:locale:alternate found — guard would read nothing");
  for (const a of alts) {
    assert.ok(langs.includes(a),
      `og:locale:alternate names "${a}" which is not in PUBLIC_LANGS (${langs.join(", ")})`);
  }
});

// ── how much history we claim to have (2026-09-11) ─────────────────────────
//
// /use-cases sold "6–12 months of €/m² movement so you can model scenarios" to
// Investors & Private Equity. Measured the same day against final.snapshots:
// Slovakia had 118 days (3.9 months, from 2026-05-16) and Czechia 94 days
// (3.1 months, from 2026-06-09). Off by two to three times, on the page aimed at
// the one audience that would build a model on it and then check.
//
// This is the SECOND time: the first published article claimed six months of
// sales on 113 days of data. Both times the figures underneath were real and
// only the label was wrong, which is exactly why nobody caught it by looking at
// the charts.
//
// A span of history is therefore never written as a COUNT. Nothing in the build
// can verify a count, and it silently decays in both directions — wrong today
// because we overclaimed, wrong next year because we would be underclaiming. A
// START DATE is a fact that does not decay and gets stronger on its own.
const COPY = readFileSync(join(HERE, "marketingCopy.js"), "utf8");

/** Copy strings that talk about our price history, in any language.
 *
 * A benefit is TWO strings — a label and a description — and the claim can sit
 * in either. The first version of this guard filtered on words that only appear
 * in the label, so it read half the copy and reported the other half missing.
 */
function historyClaims() {
  const hits = [...COPY.matchAll(/"([^"\\]{15,400})"/g)]
    .map((m) => m[1])
    .filter((s) => /histor|trajector|vývoj cien|movement|pohyb €\/m²/i.test(s));
  assert.ok(hits.length >= 4,
    `found ${hits.length} history strings in marketingCopy.js, expected the EN and ` +
    "SK label+description pairs — this guard must not pass by reading nothing");
  return hits;
}

test("no marketing copy states how many months of history we hold", () => {
  for (const claim of historyClaims()) {
    const span = /(\d+)\s*(?:[–-]\s*\d+\s*)?(months?|mesiac|mesiacov|rok|rokov|years?)/i.exec(claim);
    assert.equal(span, null,
      `"${claim}" asserts a span of history ("${span && span[0]}"). Nothing in the ` +
      `build can check that number and it was wrong by 2–3x the last time. State ` +
      `the date we started observing instead.`);
  }
});

test("the history copy names the date observation actually started", () => {
  // Once per language. The date is what replaced the unverifiable month count,
  // so losing it means the claim went back to being unanchored.
  const years = historyClaims().join(" ").match(/2026/g) || [];
  assert.ok(years.length >= 2,
    `the history copy names a start year ${years.length} time(s), expected one per ` +
    "language — without it a reader cannot tell how far back the series goes, " +
    "which is the thing they are buying");
});
