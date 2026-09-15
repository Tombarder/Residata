/**
 * The sitemap is a list of pages we ASK Google to index. It drifted from what
 * the site actually is, and nothing noticed until 2026-09-03:
 *
 *   · `/about` was listed and is not a route at all — the SPA falls through to
 *     Home, so we were inviting Google to index a second copy of the homepage
 *     under a made-up address;
 *   · `/data` was listed, but routing.js makes `/sample` the primary url and
 *     keeps `/data` only for backward compatibility. Verified live: loading
 *     /data serves the page with `<link rel=canonical href=".../sample">`, so
 *     the sitemap pointed at a url that immediately declares a different one;
 *   · `/privacy`, `/imprint` and `/terms` were listed while seo.js marks them
 *     noindex — the contradiction Search Console reports as "Submitted URL
 *     marked noindex".
 *
 * ONE INVARIANT CATCHES ALL THREE, and it is the honest one: applySeo builds
 * every page's canonical from its `path` in seo.js, so a url worth submitting is
 * exactly a non-noindex `path` from that table. Anything else is either not a
 * page, not the primary url for one, or a page we told Google to ignore.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEO = readFileSync(join(HERE, "seo.js"), "utf8");
const GEN = readFileSync(join(HERE, "..", "..", "scripts", "generate-static-content.mjs"), "utf8");

/** Paths declared in seo.js, split by whether we let Google index them. */
function seoPaths() {
  const indexable = new Set();
  const noindex = new Set();
  // Bound the slice to the TABLE. resolvePageSeo() further down also carries a
  // `path` (the project-detail fallback points at "/live" and is noindex), and
  // reading past the closing brace made this test report /live as noindex —
  // which would have been a false accusation against a page that is indexed.
  const start = SEO.indexOf("const SEO_BY_PAGE = {");
  const table = SEO.slice(start, SEO.indexOf("\n};", start) + 3);
  for (const m of table.matchAll(/path:\s*"([^"]+)"([\s\S]*?)(?=\n  [A-Z"]|\n\};)/g)) {
    (/noindex:\s*true/.test(m[2]) ? noindex : indexable).add(m[1]);
  }
  return { indexable, noindex };
}

/** Paths the generator submits. */
function sitemapPaths() {
  const block = GEN.slice(GEN.indexOf("const SITEMAP_URLS = ["), GEN.indexOf("];", GEN.indexOf("const SITEMAP_URLS = [")));
  return [...block.matchAll(/loc:\s*'([^']+)'/g)].map((m) => m[1]);
}

test("the sitemap and the SEO table both parse — otherwise the rest is vacuous", () => {
  const { indexable, noindex } = seoPaths();
  assert.ok(indexable.size >= 5, `parsed too few indexable paths: ${[...indexable]}`);
  assert.ok(noindex.size >= 3, `parsed too few noindex paths: ${[...noindex]}`);
  assert.ok(sitemapPaths().length >= 5, "parsed too few sitemap urls");
});

test("every submitted url is a real page at its PRIMARY address", () => {
  const { indexable } = seoPaths();
  const strays = sitemapPaths().filter((p) => !indexable.has(p));
  assert.deepEqual(strays, [],
    "not a page, or not the canonical url for one — applySeo builds the canonical " +
    "from seo.js's `path`, so submitting anything else wastes crawl or splits it");
});

test("nothing we told Google to ignore is submitted to Google", () => {
  const { noindex } = seoPaths();
  const contradictions = sitemapPaths().filter((p) => noindex.has(p));
  assert.deepEqual(contradictions, [],
    "Search Console reports this as 'Submitted URL marked noindex'. The legal " +
    "pages stay reachable from the footer, which is what § 3a actually requires.");
});

test("the homepage is still submitted — the one url that must be there", () => {
  assert.ok(sitemapPaths().includes("/"), "the sitemap lost the homepage");
});

test("no known dead, alias or duplicate url creeps back in", () => {
  const submitted = sitemapPaths();
  for (const dead of ["/about", "/data", "/home", "/data-sources", "/contact"]) {
    assert.ok(!submitted.includes(dead),
      `${dead} must not be submitted — /data is a back-compat alias for /sample, ` +
      `/contact serves the same page as /pricing, and /about and /data-sources ` +
      `are not pages at all`);
  }
});

test("every public route has its own SEO entry", () => {
  // applySeo RETURNS EARLY for a page it does not know, leaving whatever meta is
  // already in the head — the previous page's on a client-side navigation, and
  // index.html's homepage meta WITH `index, follow` for a crawler landing cold.
  // That is how /status shipped inheriting another page's identity, and how
  // /hero-lab — an internal tool — was left indexable under the homepage title.
  const routing = readFileSync(join(HERE, "routing.js"), "utf8");
  const map = routing.match(/const map = \{([\s\S]*?)\n  \};/);
  assert.ok(map, "could not find routing.js's path→page map; this test is vacuous without it");

  const routed = new Set(
    [...map[1].matchAll(/"[^"]+":\s*"([^"]+)"/g)]
      .map((m) => m[1])
      .filter((p) => !p.startsWith("App:") && !p.startsWith("Project:")), // both have explicit fallbacks
  );
  const start = SEO.indexOf("const SEO_BY_PAGE = {");
  const table = SEO.slice(start, SEO.indexOf("\n};", start));
  const known = new Set([...table.matchAll(/\n  "?([A-Za-z][A-Za-z ]*)"?:\s*\{/g)].map((m) => m[1].trim()));

  const orphans = [...routed].filter((p) => !known.has(p)).sort();
  assert.deepEqual(orphans, [],
    "these routes would silently wear another page's title, description and robots tag");
});

test("two urls never claim to be the canonical of the same content", () => {
  // Pricing and Contact are ONE page. Each self-canonicalising was duplicate
  // content: Google picks one arbitrarily and splits the ranking signals.
  const table = (() => {
    const start = SEO.indexOf("const SEO_BY_PAGE = {");
    return SEO.slice(start, SEO.indexOf("\n};", start) + 3);
  })();
  const contact = table.slice(table.indexOf("  Contact: {"));
  const contactPath = contact.match(/path:\s*"([^"]+)"/)?.[1];
  assert.equal(contactPath, "/pricing",
    "the nav reads 'Cenník & Kontakt' and points at /pricing, and /contact serves " +
    "identical content — so its canonical must point there. If the pages were " +
    "genuinely split again, change this test in the same commit.");

  const submitted = sitemapPaths();
  assert.equal(new Set(submitted).size, submitted.length,
    "the sitemap lists the same url twice");
});

// ── what we hand to AI crawlers (2026-09-15) ──────────────────────────────
//
// llms.txt is the file written FOR machines: an agent reads it and follows the
// URLs it lists. It advertised "Live analytics with district + developer
// breakdowns: /live/analytics" — a path that does not exist. Verified live: the
// app's router has no entry for it, falls through to Home, and the page comes
// back with the homepage title and a canonical of "/". So an agent sent there
// would describe our homepage as our analytics product.
//
// A dead link in a sitemap gets a crawl error somebody eventually sees. A dead
// link here is answered with 200 and plausible content, so nothing ever
// complains — which is exactly why it needs a test.
test("every residata url in llms.txt is a route the app actually has", () => {
  const routing = readFileSync(join(HERE, "routing.js"), "utf8");
  const map = routing.match(/const map = \{([\s\S]*?)\n  \};/);
  assert.ok(map, "could not find routing.js's path→page map; this test is vacuous without it");

  const realPaths = new Set([...map[1].matchAll(/"([^"]+)":/g)].map((m) => m[1]));
  realPaths.add("/");                       // Home, handled before the map
  const prefixes = ["/analyzy/", "/project/", "/app"];   // handled by prefix, not the map

  // The template, not the built file — the built one is regenerated and a stale
  // copy on disk would make this pass while the next deploy reintroduces the URL.
  const block = GEN.slice(GEN.indexOf("## Public surfaces"));
  assert.ok(block.length > 80, "llms.txt public-surfaces block not found — guard reads nothing");

  const advertised = [...block.matchAll(/\$\{HOME\}(\/[A-Za-z0-9/_-]*)/g)].map((m) => m[1]);
  assert.ok(advertised.length >= 2, `found ${advertised.length} advertised urls, expected several`);

  for (const p of advertised) {
    const ok = realPaths.has(p) || prefixes.some((pre) => p.startsWith(pre));
    assert.ok(ok,
      `llms.txt sends crawlers to "${p}", which the router does not know. It will answer ` +
      `200 with the HOMEPAGE, so nothing will ever report it as broken.`);
  }
});
