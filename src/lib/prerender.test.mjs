/**
 * Every public page must carry its OWN head in the HTML the server sends —
 * the page a link preview, an AI crawler and Google's first pass read before
 * any JavaScript runs. Until 2026-09-28 every article's raw HTML claimed to BE
 * the homepage (its title, its share card, and a canonical pointing at "/").
 *
 * These tests hold the pure half of the build step (scripts/lib/prerenderCore.mjs)
 * and the shared article model (lib/articleSeo.js) to that, without a build.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  headHtml, replaceHead, fillRoot, siteNodes, pageProblems, rssFeed, HEAD_ONLY_PATHS, scriptJson,
} from "../../scripts/lib/prerenderCore.mjs";
import {
  articleHead, articleSeoChecks, seoLang, clip, placeOf, periodOf, relatedArticles,
} from "./articleSeo.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// The source template, with the two whole-line tokens the build fills (vite.config.js)
// emptied so its structured data parses as the built one does.
const TEMPLATE = readFileSync(join(HERE, "..", "..", "index.html"), "utf8")
  .replace(/__COMPANY_(?:TAXID|VATID)_LINE__/g, "");
const SITE = "https://residata.eu";

const ARTICLE = {
  slug: "ke-prehlad-2026-q3",
  date: "2026-09-27",
  updatedAt: "2026-09-28T11:35:34+00:00",
  published: true,
  // the database requires both languages, so "en" holds a copy of the Slovak
  title: { sk: "Košice: trh nových bytov v 3. štvrťroku 2026", en: "Košice: trh nových bytov v 3. štvrťroku 2026" },
  perex: { sk: "Prehľad trhu s novými bytmi v Košiciach za 3. štvrťrok 2026: ponuka, dopyt a ceny podľa veľkosti bytu.", en: "x" },
  method: { sk: "Údaje pochádzajú z verejne zverejnených cenníkov developerov, ktoré Residata číta denne.", en: "x" },
  blocks: [{ type: "table", head: ["Kategória", "Voľné"], rows: [["2-izb", "284"]] }],
  ogImage: "/analyzy/og-ke-prehlad-2026-q3.png",
  figuresMeasuredThrough: "2026-09-27",
};

function articlePage(a = ARTICLE) {
  const head = articleHead(a, { siteBase: SITE });
  const graph = { "@context": "https://schema.org", "@graph": [...siteNodes(TEMPLATE), ...head.jsonLd["@graph"]] };
  const html = replaceHead(TEMPLATE, { lang: head.lang, dropJsonLd: true, head: headHtml({ ...head, jsonLd: graph }) });
  return { head, html: fillRoot(html, `<h1>${a.title.sk}</h1>`, { embed: { slug: a.slug } }) };
}

test("an article's page names itself — not the homepage — before any JavaScript", () => {
  const { head, html } = articlePage();
  const problems = pageProblems(html, {
    title: head.title, canonical: `${SITE}/analyzy/ke-prehlad-2026-q3`, lang: "sk", index: true,
    ogImage: `${SITE}/analyzy/og-ke-prehlad-2026-q3.png`, h1: ARTICLE.title.sk,
    jsonLdType: ["Article", "BreadcrumbList", "Dataset", "Organization"], noFaq: true, hreflang: ["sk", "x-default"],
  });
  assert.deepEqual(problems, []);
  assert.ok(!html.includes('href="https://residata.eu/" />') || !/rel="canonical" href="https:\/\/residata\.eu\/"/.test(html),
    "the homepage canonical must not survive on an article");
});

test("the template's homepage tags are gone, not duplicated", () => {
  const { html } = articlePage();
  for (const re of [/<title>/g, /rel="canonical"/g, /name="description"/g, /property="og:title"/g, /property="og:url"/g]) {
    assert.equal((html.match(re) || []).length, 1, `${re} appears more than once`);
  }
  assert.ok(!/name="googlebot"/.test(html), "a stale googlebot=index tag contradicts robots on a noindex page");
});

test("the homepage FAQ markup never rides along — FAQ markup must match a visible FAQ", () => {
  const { html } = articlePage();
  assert.ok(!html.includes('"FAQPage"'));
  const marketing = replaceHead(TEMPLATE, { lang: "en", head: headHtml({ title: "t", description: "d", robots: "index", canonical: `${SITE}/live`, og: { "og:image": `${SITE}/og-image.png`, "og:url": `${SITE}/live` } }) });
  assert.ok(!marketing.includes('"FAQPage"'), "a marketing route kept the FAQ");
  assert.ok(marketing.includes('"SoftwareApplication"'), "a marketing route lost the product graph");
});

test("a Slovak article is a Slovak page whatever the database's 'en' copy says", () => {
  assert.equal(seoLang(ARTICLE), "sk");
  const { head } = articlePage();
  assert.equal(head.lang, "sk");
  assert.equal(head.og["og:locale"], "sk_SK");
  assert.deepEqual(head.alternates.map((a) => a.hreflang), ["sk", "x-default"]);
  const ld = head.jsonLd["@graph"].find((n) => n["@type"] === "Article");
  assert.equal(ld.inLanguage, "sk");
});

test("a draft is never indexable, even with its own page", () => {
  const head = articleHead({ ...ARTICLE, published: false }, { siteBase: SITE });
  assert.match(head.robots, /noindex/);
});

test("the search title is the written seo_title, else the headline with the site name", () => {
  assert.equal(articleHead(ARTICLE, { siteBase: SITE }).title, "Košice: trh nových bytov v 3. štvrťroku 2026 · Residata");
  const own = { ...ARTICLE, seoTitle: { sk: "Novostavby Košice Q3/2026: ceny, ponuka a predaj" } };
  assert.equal(articleHead(own, { siteBase: SITE }).title, "Novostavby Košice Q3/2026: ceny, ponuka a predaj");
});

test("a description is cut at a word, never mid-word, and says so", () => {
  const long = "slovo ".repeat(60).trim();
  const c = clip(long);
  assert.ok(c.length <= 160 && c.endsWith("…") && !/slov…$/.test(c));
  assert.equal(clip("krátky text"), "krátky text");
});

test("the Dataset states the period a quarterly issue measured, never beyond it", () => {
  assert.equal(periodOf(ARTICLE), "2026-07-01/2026-09-27");
  assert.equal(periodOf({ ...ARTICLE, figuresMeasuredThrough: "2026-10-01" }), "2026-07-01/2026-09-30");
  assert.equal(periodOf({ ...ARTICLE, slug: "trh-novostavieb-2026-09" }), null);
  assert.equal(placeOf(ARTICLE), "Košice");
  assert.equal(placeOf({ ...ARTICLE, title: { sk: "Kde sa predáva najrýchlejšie" } }), null);
});

test("a missing share card is an error the editor sees, not a silent broken preview", () => {
  const codes = articleSeoChecks(ARTICLE, { shareImageExists: false }).map((c) => c.code);
  assert.ok(codes.includes("og-image-missing"));
  assert.ok(articleSeoChecks(ARTICLE, { missingFigures: ["/analyzy/x.svg"] }).some((c) => c.code === "figure-missing"));
  assert.ok(articleSeoChecks({ ...ARTICLE, perex: { sk: "" } }).some((c) => c.level === "error"));
});

test("a town links to its own kraj first, then the country, then the national tables", () => {
  const all = ["ke", "kraj-ke", "sk", "ba", "kraj-po"].map((c) => ({ slug: `${c}-prehlad-2026-q3`, date: "2026-09-27" }))
    .concat([{ slug: "kde-sa-predava-2026-q3", date: "2026-09-27" }, { slug: "ke-prehlad-2026-q2", date: "2026-06-30" }]);
  const got = relatedArticles(ARTICLE, all).map((a) => a.slug);
  assert.deepEqual(got.slice(0, 3), ["kraj-ke-prehlad-2026-q3", "sk-prehlad-2026-q3", "kde-sa-predava-2026-q3"]);
  assert.ok(!got.includes("ke-prehlad-2026-q3") && !got.includes("ke-prehlad-2026-q2"), "not itself, not another quarter");
});

test("the root carries the page and the row the app starts from; the JS-only notice goes", () => {
  const { html } = articlePage();
  assert.ok(html.includes('<div id="root" data-prerendered="1"><h1>'));
  assert.ok(html.includes('<script type="application/json" id="rd-article">{"slug":"ke-prehlad-2026-q3"}</script>'));
  assert.ok(!html.includes("<noscript>"));
  assert.ok(!scriptJson({ x: "</script><script>alert(1)</script>" }).includes("</script>"));
});

test("every public route in routing.js is pre-rendered", () => {
  const routing = readFileSync(join(HERE, "routing.js"), "utf8");
  const block = routing.slice(routing.indexOf("const map = {"), routing.indexOf("};", routing.indexOf("const map = {")));
  const publicPaths = [...block.matchAll(/"(\/[^"]*)":\s*"([^"]+)"/g)]
    .filter(([, , page]) => !page.startsWith("App:") && page !== "Insights")
    .map(([, p]) => p);
  assert.ok(publicPaths.length >= 10, `parsed too few routes: ${publicPaths}`);
  const missing = publicPaths.filter((p) => !HEAD_ONLY_PATHS.includes(p));
  assert.deepEqual(missing, [], "a public route has no pre-rendered head (add it to HEAD_ONLY_PATHS)");
});

test("the feed is valid RSS with one item per analysis", () => {
  const xml = rssFeed([{ title: "A & B", url: `${SITE}/analyzy/a`, date: "2026-09-27", description: "d" }],
    { home: SITE, title: "t", description: "d", buildDate: "2026-09-28T10:00:00Z" });
  assert.match(xml, /<rss version="2.0"/);
  assert.equal((xml.match(/<item>/g) || []).length, 1);
  assert.ok(xml.includes("A &amp; B") && xml.includes("Sun, 27 Sep 2026"));
});
