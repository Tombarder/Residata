/**
 * The market-freshness cache — run with:
 *   node --test src/lib/freshness.test.mjs
 *
 * public.market_freshness gives each market's last data day. It drives the "Dáta
 * aktualizované" line, the dashboard's month-ago arrows (each market's previous 30 days
 * end on its own last reading) and where the Sales page's presets end. The cache in
 * useData.js kept the FIRST answer for the whole session, whatever it was: a failed or
 * empty read cached {} — the arrows vanished and Sales fell back to today until a
 * reload — and a tab open overnight kept yesterday's date. The cache code is run here as
 * written, against a stand-in for the database and the clock.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SRC = readFileSync(new URL("./useData.js", import.meta.url), "utf8");
const BLOCK = SRC.slice(SRC.indexOf("// ── Data freshness"), SRC.indexOf("function _freshnessForView("));

function harness(answers) {
  let now = Date.UTC(2026, 9, 6, 8, 0);
  const asked = [];
  const supabasePublic = {
    from: (t) => ({
      select: () => {
        asked.push(t);
        const a = answers.shift();
        if (a instanceof Error) return Promise.reject(a);
        return Promise.resolve(a);
      },
    }),
  };
  const clock = { now: () => now };
  const { _loadFreshness } = new Function("supabasePublic", "Date", `${BLOCK}\nreturn { _loadFreshness };`)(supabasePublic, clock);
  return { load: _loadFreshness, asked, advance: (ms) => { now += ms; } };
}
const OK = (sk, cz) => ({ data: [{ country: "SK", last_data_date: sk }, { country: "CZ", last_data_date: cz }], error: null });
const HOUR = 3600 * 1000;

test("a failed read is not kept: the next ask reads again", async () => {
  const h = harness([{ data: null, error: { message: "timeout" } }, OK("2026-10-05", "2026-10-05")]);
  assert.deepEqual(await h.load(), {});
  assert.deepEqual(await h.load(), { SK: "2026-10-05", CZ: "2026-10-05" });
  assert.equal(h.asked.length, 2);
});

test("a read that throws is not kept either", async () => {
  const h = harness([new Error("network"), OK("2026-10-05", "2026-10-04")]);
  assert.deepEqual(await h.load(), {});
  assert.deepEqual(await h.load(), { SK: "2026-10-05", CZ: "2026-10-04" });
});

test("an empty answer is not kept", async () => {
  const h = harness([{ data: [], error: null }, OK("2026-10-05", "2026-10-05")]);
  assert.deepEqual(await h.load(), {});
  assert.deepEqual(await h.load(), { SK: "2026-10-05", CZ: "2026-10-05" });
});

test("a good answer is kept for a few hours, then read again", async () => {
  const h = harness([OK("2026-10-05", "2026-10-05"), OK("2026-10-09", "2026-10-09")]);
  assert.deepEqual(await h.load(), { SK: "2026-10-05", CZ: "2026-10-05" });
  h.advance(2 * HOUR);
  assert.deepEqual(await h.load(), { SK: "2026-10-05", CZ: "2026-10-05" });
  assert.equal(h.asked.length, 1, "asked again within the hour it was read");
  h.advance(2 * HOUR);
  assert.deepEqual(await h.load(), { SK: "2026-10-09", CZ: "2026-10-09" }, "a tab open overnight keeps yesterday's date");
  assert.equal(h.asked.length, 2);
});

test("when the refresh fails, the last good answer stands", async () => {
  const h = harness([OK("2026-10-05", "2026-10-05"), { data: null, error: { message: "timeout" } }, OK("2026-10-09", "2026-10-09")]);
  await h.load();
  h.advance(4 * HOUR);
  assert.deepEqual(await h.load(), { SK: "2026-10-05", CZ: "2026-10-05" });
  assert.deepEqual(await h.load(), { SK: "2026-10-09", CZ: "2026-10-09" });
});

test("asks at the same moment share one read", async () => {
  const h = harness([OK("2026-10-05", "2026-10-05")]);
  const [a, b] = await Promise.all([h.load(), h.load()]);
  assert.equal(a, b);
  assert.equal(h.asked.length, 1);
});

test("a page left open asks again on its own", () => {
  const m = SRC.match(/function useFreshnessMap\(\)[\s\S]*?\n\}\n/);
  assert.ok(m, "useFreshnessMap not found");
  assert.match(m[0], /document\.visibilityState !== "hidden"\) ask\(\); \}, FRESHNESS_CHECK_MS\)/);
  assert.match(m[0], /addEventListener\("visibilitychange"/);
  for (const hook of ["useFreshness", "useFreshnessByCountry", "useFreshnessStatus"]) {
    const h = SRC.match(new RegExp(`export function ${hook}\\(\\)[\\s\\S]*?\\n\\}\\n`));
    assert.ok(h && /useFreshness(Map|Status)\(\)/.test(h[0]), `${hook} must read the shared, refreshed map`);
  }
});
