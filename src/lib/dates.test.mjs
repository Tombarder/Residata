// daysLeftText — the counter under a trial or a Premium period passes through all
// three Slovak count forms on its way down; it used to print "1 dní zostáva".
import { test } from "node:test";
import assert from "node:assert/strict";
import { daysLeftText } from "./dates.js";

test("Slovak: 1 deň · 2–4 dni · 5+ dní, and the last day", () => {
  assert.equal(daysLeftText(0, "sk"), "posledný deň");
  assert.equal(daysLeftText(1, "sk"), "zostáva 1 deň");
  assert.equal(daysLeftText(2, "sk"), "zostávajú 2 dni");
  assert.equal(daysLeftText(4, "sk"), "zostávajú 4 dni");
  assert.equal(daysLeftText(5, "sk"), "zostáva 5 dní");
  assert.equal(daysLeftText(28, "sk"), "zostáva 28 dní");
});

test("English: singular and plural", () => {
  assert.equal(daysLeftText(0, "en"), "last day");
  assert.equal(daysLeftText(1, "en"), "1 day left");
  assert.equal(daysLeftText(7, "en"), "7 days left");
});
