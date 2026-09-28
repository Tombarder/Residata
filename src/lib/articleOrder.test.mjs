/**
 * The /analyzy index must not shuffle issues that share a date — a quarter's
 * template issues are published the same day and Postgres gives ties no order.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { orderArticles, seriesRank } from "./articleOrder.js";

test("a date's issues read from the whole to its parts", () => {
  const shuffled = [
    { slug: "kraj-ke-prehlad-2026-q3", date: "2026-09-27" },
    { slug: "po-prehlad-2026-q3", date: "2026-09-27" },
    { slug: "ba-prehlad-2026-q3", date: "2026-09-27" },
    { slug: "kraj-ba-prehlad-2026-q3", date: "2026-09-27" },
    { slug: "sk-prehlad-2026-q3", date: "2026-09-27" },
    { slug: "ke-prehlad-2026-q3", date: "2026-09-27" },
  ];
  assert.deepEqual(orderArticles(shuffled).map((a) => a.slug), [
    "sk-prehlad-2026-q3", "ba-prehlad-2026-q3", "ke-prehlad-2026-q3",
    "po-prehlad-2026-q3", "kraj-ba-prehlad-2026-q3", "kraj-ke-prehlad-2026-q3",
  ]);
});

test("a newer date still comes first, whatever the series", () => {
  const got = orderArticles([
    { slug: "sk-prehlad-2026-q3", date: "2026-09-27" },
    { slug: "trh-novostavieb-2026-10", date: "2026-10-05" },
  ]).map((a) => a.slug);
  assert.deepEqual(got, ["trh-novostavieb-2026-10", "sk-prehlad-2026-q3"]);
});

test("the two national comparison tables close the series, always in one order", () => {
  const got = orderArticles([
    { slug: "co-stoji-byt-2026-q3", date: "2026-09-27" },
    { slug: "kraj-ke-prehlad-2026-q3", date: "2026-09-27" },
    { slug: "kde-sa-predava-2026-q3", date: "2026-09-27" },
    { slug: "sk-prehlad-2026-q3", date: "2026-09-27" },
  ]).map((a) => a.slug);
  assert.deepEqual(got, ["sk-prehlad-2026-q3", "kraj-ke-prehlad-2026-q3",
                         "kde-sa-predava-2026-q3", "co-stoji-byt-2026-q3"]);
});

test("an article outside the series keeps its place among its date", () => {
  assert.equal(seriesRank("trh-novostavieb-2026-09"), 100);
  const got = orderArticles([
    { slug: "b-story", date: "2026-09-27" },
    { slug: "a-story", date: "2026-09-27" },
  ]).map((a) => a.slug);
  assert.deepEqual(got, ["b-story", "a-story"]);
});
