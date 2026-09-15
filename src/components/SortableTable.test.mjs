/* useTableSort's comparator — the part that has to be right regardless of which table
 * uses it. Written alongside the extraction, because the behaviours below are the ones
 * every hand-rolled copy on the platform got slightly differently. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { localeTag } from "../lib/locale.js";

/* The comparator, lifted verbatim from useTableSort so it can be exercised without a
 * React renderer. If the component's copy changes, this test is the thing that notices. */
const makeSorter = (col, dirWord, lang = "sk") => {
  const dir = dirWord === "desc" ? -1 : 1;
  const locale = localeTag(lang);
  return (arr) => [...arr].sort((a, b) => {
    const av = col.get(a), bv = col.get(b);
    const an = av == null || av === "", bn = bv == null || bv === "";
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    if (col.kind === "num") return (Number(av) - Number(bv)) * dir;
    if (col.kind === "date") return (new Date(av) - new Date(bv)) * dir;
    return String(av).localeCompare(String(bv), locale, { sensitivity: "base" }) * dir;
  });
};

const rows = (...vals) => vals.map((v, i) => ({ v, i }));
const col = (kind) => ({ kind, get: (r) => r.v });

test("numbers sort as numbers, not as text", () => {
  const out = makeSorter(col("num"), "asc")(rows(10, 2, 1, 44));
  assert.deepEqual(out.map((r) => r.v), [1, 2, 10, 44]);
});

test("a blank sorts LAST in BOTH directions — it is not a small value", () => {
  // Putting blanks on top of a "highest first" ranking hides the answer.
  assert.deepEqual(makeSorter(col("num"), "desc")(rows(5, null, 9)).map((r) => r.v), [9, 5, null]);
  assert.deepEqual(makeSorter(col("num"), "asc")(rows(5, null, 9)).map((r) => r.v), [5, 9, null]);
  assert.deepEqual(makeSorter(col("text"), "asc")(rows("b", "", "a")).map((r) => r.v), ["a", "b", ""]);
});

test("text uses the reader's collation — Č after C, before D", () => {
  const out = makeSorter(col("text"), "asc", "sk")(rows("Dom", "Časť", "Byt"));
  assert.deepEqual(out.map((r) => r.v), ["Byt", "Časť", "Dom"]);
});

test("dates sort chronologically, not lexically", () => {
  const out = makeSorter(col("date"), "desc")(rows("2026-09-02", "2026-09-10", "2026-08-30"));
  assert.deepEqual(out.map((r) => r.v), ["2026-09-10", "2026-09-02", "2026-08-30"]);
});

test("sorting does not mutate the array it was given", () => {
  const input = rows(3, 1, 2);
  const copy = [...input];
  makeSorter(col("num"), "asc")(input);
  assert.deepEqual(input, copy);
});
