// Publishing from /app/articles must refuse an article whose charts are not on
// the site yet (board 693ea7). These pin the two halves: which files an article
// shows, and what counts as "live".
import { test } from "node:test";
import assert from "node:assert/strict";
import { articleFiles, filesNotLive } from "./articleFiles.js";

const article = {
  ogImage: "/analyzy/og-x.png",
  blocks: [
    { type: "p", text: { sk: "…" } },
    { type: "figure", src: "/analyzy/x-a.svg", srcM: "/analyzy/x-a-m.svg", srcEn: "/analyzy/x-a.svg" },
    { type: "figure", src: "/analyzy/x-b.svg?v=2" },
    { type: "figure", src: "https://elsewhere.example/c.svg" },
  ],
};

const fakeFetch = (answers) => async (path) => {
  const a = answers[path];
  if (a instanceof Error) throw a;
  return { ok: (a?.status ?? 200) < 400, status: a?.status ?? 200,
           headers: { get: () => a?.type ?? null } };
};

test("an article shows its share card and every drawing of every figure, once each", () => {
  assert.deepEqual(articleFiles(article),
    ["/analyzy/og-x.png", "/analyzy/x-a.svg", "/analyzy/x-a-m.svg", "/analyzy/x-b.svg"]);
});

test("every file answering as an image is live", async () => {
  const ok = Object.fromEntries(articleFiles(article).map((p) => [p, { type: "image/svg+xml" }]));
  assert.deepEqual(await filesNotLive(article, fakeFetch(ok)), []);
});

test("200 text/html is the app's own page, not the chart — it is NOT live", async () => {
  const answers = Object.fromEntries(articleFiles(article).map((p) => [p, { type: "image/png" }]));
  answers["/analyzy/x-a-m.svg"] = { type: "text/html; charset=utf-8" };
  const missing = await filesNotLive(article, fakeFetch(answers));
  assert.deepEqual(missing.map((m) => m.path), ["/analyzy/x-a-m.svg"]);
  assert.match(missing[0].why, /text\/html/);
});

test("an error status or a failed request refuses too", async () => {
  const answers = Object.fromEntries(articleFiles(article).map((p) => [p, { type: "image/svg+xml" }]));
  answers["/analyzy/og-x.png"] = { status: 404, type: "text/plain" };
  answers["/analyzy/x-b.svg"] = new Error("offline");
  const missing = await filesNotLive(article, fakeFetch(answers));
  assert.deepEqual(missing.map((m) => m.path), ["/analyzy/og-x.png", "/analyzy/x-b.svg"]);
});

test("an article with no figures and no card has nothing to wait for", async () => {
  assert.deepEqual(await filesNotLive({ blocks: [] }, fakeFetch({})), []);
});
