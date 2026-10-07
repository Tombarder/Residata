import { test } from "node:test";
import assert from "node:assert/strict";
import { articleMatches, articleCounts, slugProblem, ARTICLE_FILTERS } from "./articlesAdmin.js";

const live = { slug: "kvartalka-ke-2026-q3", published: true, title: { sk: "Košice: trh novostavieb", en: "Košice: the new-build market" }, perex: { sk: "Ceny v Košiciach", en: "Prices" } };
const draft = { slug: "trh-novostavieb-2026-10", published: false, title: { sk: "Október", en: "October" }, perex: { sk: "", en: "" } };

test("each tab shows its own articles", () => {
  assert.deepEqual(ARTICLE_FILTERS, ["all", "published", "draft"]);
  assert.equal(articleMatches(live, "all"), true);
  assert.equal(articleMatches(draft, "all"), true);
  assert.equal(articleMatches(live, "published"), true);
  assert.equal(articleMatches(draft, "published"), false);
  assert.equal(articleMatches(live, "draft"), false);
  assert.equal(articleMatches(draft, "draft"), true);
});

test("search ignores case and accents and reads title, standfirst and address", () => {
  assert.equal(articleMatches(live, "all", "kosice"), true);
  assert.equal(articleMatches(live, "all", "KOŠICE trh"), true);
  assert.equal(articleMatches(live, "all", "2026-q3"), true);
  assert.equal(articleMatches(live, "all", "praha"), false);
  assert.equal(articleMatches(draft, "all", "october"), true);
  assert.equal(articleMatches(draft, "published", "october"), false, "the tab still applies");
  assert.equal(articleMatches(live, "all", "   "), true);
});

test("counts add up", () => {
  assert.deepEqual(articleCounts([live, draft, { ...draft, slug: "x" }]), { all: 3, published: 1, draft: 2 });
  assert.deepEqual(articleCounts([]), { all: 0, published: 0, draft: 0 });
});

test("a new address must be a clean, unused URL segment", () => {
  assert.equal(slugProblem("trh-novostavieb-2026-11", ["trh-novostavieb-2026-10"]), null);
  assert.equal(slugProblem("", []), "empty");
  assert.equal(slugProblem("  ", []), "empty");
  assert.equal(slugProblem("Trh", []), "format");
  assert.equal(slugProblem("trh novostavieb", []), "format");
  assert.equal(slugProblem("košice", []), "format");
  assert.equal(slugProblem("-trh", []), "format");
  assert.equal(slugProblem("trh-", []), "format");
  assert.equal(slugProblem("trh--x", []), "format");
  assert.equal(slugProblem("trh-novostavieb-2026-10", ["trh-novostavieb-2026-10"]), "taken");
});
