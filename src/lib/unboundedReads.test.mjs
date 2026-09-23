/**
 * Guards against the silent-truncation class — run with:
 *   node --test src/lib/unboundedReads.test.mjs
 *
 * 🔴 WHY
 *
 * PostgREST caps an unbounded select at `db-max-rows` (1000 on this project)
 * and returns the truncated page with NO error. A read that outgrows the cap
 * therefore starts lying silently, and nothing on the page looks wrong. Found
 * twice on 2026-09-23:
 *
 *   · project_snapshots — 1 434 rows. Every month-over-month arrow on the
 *     Dashboard was computed from 1 000 of them, short across all five buckets.
 *   · flats_current for one project — Slnečnice has 4 624 current units, so its
 *     flat list showed 1 000 of them to a paying customer.
 *
 * A table goes on BIG_TABLES the moment it can exceed the cap, filtered as the
 * app filters it. Reads of those must paginate (sbReadAll / .range) or bound
 * themselves (.limit / .single / head-only count).
 */
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/** Tables whose row count is not structurally below the 1000-row cap. */
const BIG_TABLES = [
  "project_snapshots",   // 1 434 rows and one per project per month, so it only grows
  "flats_current",       // per project: Slnečnice 4 624
  "flats_archive",       // every unit of every scrape
  "unit_facts",
];
const BOUNDED = /\.range\(|\.limit\(|\.single\(|\.maybeSingle\(|head:\s*true/;

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { sources(p, out); continue; }
    if (!/\.(js|jsx)$/.test(name) || name.includes(".test.")) continue;
    out.push(p);
  }
  return out;
}

test("no read of a big table can be silently truncated", () => {
  const offenders = [];
  for (const file of sources("src")) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const m = line.match(/\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/);
      if (!m || !BIG_TABLES.includes(m[1])) return;
      // a builder can span lines; look at the statement around it
      const window = lines.slice(i, i + 14).join("\n");
      if (!window.includes(".select(")) return;         // a write, not a read
      if (BOUNDED.test(window)) return;
      offenders.push(`${file}:${i + 1} → ${m[1]}`);
    });
  }
  assert.deepEqual(offenders, [],
    "these reads would be capped at db-max-rows with no error:\n  " + offenders.join("\n  "));
});

test("the pagination helper exists and stops on a short page", async () => {
  const src = readFileSync("src/lib/useData.js", "utf8");
  assert.match(src, /async function sbReadAll\(/, "sbReadAll must exist");

  // Re-implement nothing: run the real helper against a fake builder.
  const body = src.match(/async function sbReadAll\([\s\S]*?\n\}/m)[0];
  const sbReadAll = new Function(`
    const sbRead = (b) => Promise.resolve(b);
    ${body}
    return sbReadAll;
  `)();

  const TOTAL = 2350, PAGE = 1000;
  let calls = 0;
  const { data, error } = await sbReadAll((from, to) => {
    calls += 1;
    const rows = [];
    for (let i = from; i <= Math.min(to, TOTAL - 1); i += 1) rows.push({ i });
    return { data: rows, error: null };
  }, { pageSize: PAGE });

  assert.equal(error, null);
  assert.equal(data.length, TOTAL, "must return every row, not the first page");
  assert.equal(calls, 3, "1000 + 1000 + 350 → three requests, then stop");
  assert.deepEqual(data[0], { i: 0 });
  assert.deepEqual(data[TOTAL - 1], { i: TOTAL - 1 });
});

test("an error mid-way is surfaced, not swallowed as a short read", async () => {
  const src = readFileSync("src/lib/useData.js", "utf8");
  const body = src.match(/async function sbReadAll\([\s\S]*?\n\}/m)[0];
  const sbReadAll = new Function(`
    const sbRead = (b) => Promise.resolve(b);
    ${body}
    return sbReadAll;
  `)();
  let calls = 0;
  const { error } = await sbReadAll(() => {
    calls += 1;
    if (calls === 2) return { data: null, error: { message: "boom" } };
    return { data: Array.from({ length: 1000 }, (_, i) => ({ i })), error: null };
  }, { pageSize: 1000 });
  assert.ok(error, "a failed page must not look like the end of the data");
});
