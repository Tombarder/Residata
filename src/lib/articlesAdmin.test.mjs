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

import {
  historyPush, HISTORY_LIMIT, COALESCE_MS, insertBlockAt, blockSnippet,
  tableWidth, normalizeTable, setHeadCell, setCell, addRow, removeRow, moveRow, addColumn, removeColumn,
  formatStamp, formatDay,
} from "./articlesAdmin.js";

const h0 = { stack: [{ value: "a", key: null, at: 0 }], at: 0 };

test("typing in one field is one undo step; a pause or another field starts a new one", () => {
  let h = historyPush(h0, "ab", "title", 1000);
  h = historyPush(h, "abc", "title", 1500);
  assert.equal(h.stack.length, 2, "two keystrokes in a burst = one step");
  assert.equal(h.stack[1].value, "abc");
  h = historyPush(h, "abcd", "title", 1500 + COALESCE_MS + 1);
  assert.equal(h.stack.length, 3, "a pause starts a new step");
  h = historyPush(h, "x", "perex", 1500 + COALESCE_MS + 2);
  assert.equal(h.stack.length, 4, "another field starts a new step");
  h = historyPush(h, "y", null, 1500 + COALESCE_MS + 3);
  h = historyPush(h, "z", null, 1500 + COALESCE_MS + 4);
  assert.equal(h.stack.length, 6, "structural edits never merge");
});

test("the loaded article is never merged into, and an edit drops the redo tail", () => {
  const h = historyPush(h0, "ab", "title", 1);
  assert.equal(h.stack[0].value, "a", "the first state stays reachable");
  const undone = { ...historyPush(h, "abc", "x", 5000), at: 0 };
  const after = historyPush(undone, "new", "x", 5001);
  assert.deepEqual(after.stack.map((s) => s.value), ["a", "new"]);
});

test("history keeps HISTORY_LIMIT steps", () => {
  let h = h0;
  for (let i = 0; i < HISTORY_LIMIT + 30; i++) h = historyPush(h, i, null, i);
  assert.equal(h.stack.length, HISTORY_LIMIT);
  assert.equal(h.at, HISTORY_LIMIT - 1);
});

test("a block is inserted where asked", () => {
  assert.deepEqual(insertBlockAt([1, 2, 3], 1, "x"), [1, "x", 2, 3]);
  assert.deepEqual(insertBlockAt([1, 2], 9, "x"), [1, 2, "x"]);
  assert.deepEqual(insertBlockAt([1, 2], -3, "x"), ["x", 1, 2]);
});

test("a block's snippet says what it holds", () => {
  assert.equal(blockSnippet({ type: "p", text: { sk: "Ahoj  svet", en: "Hi" } }), "Ahoj svet");
  assert.equal(blockSnippet({ type: "bullets", items: [{ sk: "a" }, { sk: "b" }] }), "a · b");
  assert.equal(blockSnippet({ type: "figure", src: "/x.svg", caption: { sk: "" } }), "/x.svg");
  assert.equal(blockSnippet({ type: "table", head: { sk: ["Obec", "Cena"] } }), "Obec | Cena");
  assert.equal(blockSnippet({ type: "p", text: { sk: "x".repeat(200) } }, 10).length, 10);
});

const tbl = { type: "table", head: { sk: ["Obec", "Cena"], en: ["Town", "Price"] }, rows: [["Žilina", "3 100"], ["Martin"]] };

test("a table is kept rectangular", () => {
  assert.equal(tableWidth(tbl), 2);
  assert.deepEqual(normalizeTable(tbl).rows[1], ["Martin", ""]);
  assert.equal(tableWidth({ type: "table", head: { sk: [], en: [] }, rows: [] }), 1);
});

test("table edits keep the shape the public page draws", () => {
  assert.deepEqual(setHeadCell(tbl, "en", 1, "Price €").head, { sk: ["Obec", "Cena"], en: ["Town", "Price €"] });
  assert.deepEqual(setCell(tbl, 0, 1, "3 200").rows[0], ["Žilina", "3 200"]);
  const pair = { ...tbl, rows: [["A", { sk: "1,5", en: "1.5" }]] };
  assert.deepEqual(setCell(pair, 0, 1, "1.6", "en").rows[0][1], { sk: "1,5", en: "1.6" }, "a pair cell keeps both languages");
  assert.deepEqual(addRow(tbl).rows[2], ["", ""]);
  assert.deepEqual(addRow(tbl, 0).rows[0], ["", ""]);
  assert.deepEqual(removeRow(tbl, 0).rows, [["Martin", ""]]);
  assert.deepEqual(moveRow(tbl, 1, -1).rows.map((r) => r[0]), ["Martin", "Žilina"]);
  assert.deepEqual(moveRow(tbl, 0, -1).rows.map((r) => r[0]), ["Žilina", "Martin"], "out of range = no move");
  const wide = addColumn(tbl);
  assert.equal(tableWidth(wide), 3);
  assert.deepEqual(wide.head.en, ["Town", "Price", ""]);
  const narrow = removeColumn(tbl, 0);
  assert.deepEqual(narrow.head, { sk: ["Cena"], en: ["Price"] });
  assert.deepEqual(narrow.rows, [["3 100"], [""]]);
  assert.deepEqual(removeColumn(narrow, 0).head, { sk: ["Cena"], en: ["Price"] }, "the last column stays, content and all");
  assert.deepEqual(removeColumn(narrow, 0).rows, [["3 100"], [""]]);
});

test("database times are shown in Bratislava time, dates the Slovak way", () => {
  assert.equal(formatStamp("2026-10-06T09:02:11+00:00"), "6. 10. 2026 11:02");
  assert.equal(formatStamp("2026-10-06 09:02:11.5+00"), "6. 10. 2026 11:02", "the API's own spelling");
  assert.equal(formatStamp("2026-01-15T23:30:00Z"), "16. 1. 2026 00:30", "winter time, across midnight");
  assert.equal(formatStamp(null), "");
  assert.equal(formatDay("2026-09-30"), "30. 9. 2026");
  assert.equal(formatDay(""), "");
});
