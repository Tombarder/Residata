/**
 * The Pivot's archive readings stay current, and the grains divided by them follow —
 * run with: node --test src/lib/archiveReadingsCache.test.mjs
 *
 * The readings (public.archive_days) and the Pivot's grains were both cached for the
 * whole session. A tab opened after November's first reading, still open after the
 * second, divided a new grain holding both readings' rows by ONE reading: November read
 * twice the flats. The cache code is run here as written in useData.js, against a
 * stand-in for the database and the clock.
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readingDaysByCountry, readingsSignature } from "./archiveReadings.js";

const SRC = readFileSync(new URL("./useData.js", import.meta.url), "utf8");
const BLOCK = SRC.slice(SRC.indexOf("const ARCHIVE_READINGS_TTL_MS"), SRC.indexOf("/** Full readings of every market ("));

function harness(answers) {
  let now = Date.UTC(2026, 10, 2, 9, 0);
  const asked = [];
  const sbReadAll = async (make) => make(0, 999);
  const supabaseData = {
    from: () => {
      let cols = "";
      const b = {
        select(c) { cols = c; return b; },
        order() { return b; },
        range() {
          asked.push(cols);
          const a = answers.shift();
          if (!a) return Promise.resolve({ data: null, error: { message: "no answer" } });
          if (a.error) return Promise.resolve(a);
          if (a.withoutReadings && cols.includes("readings")) { answers.unshift(a); return Promise.resolve({ data: null, error: { message: "column archive_days.readings does not exist" } }); }
          return Promise.resolve({ data: a.rows, error: null });
        },
      };
      return b;
    },
  };
  const grains = new Map([
    ['u::{"dims":["snapshot_month","country"],"mode":"archive"}::v1', [1]],
    ['u::{"dims":["cast"],"mode":"latest"}::', [2]],
  ]);
  const clock = { now: () => now };
  const { _loadArchiveReadings } = new Function(
    "sbReadAll", "supabaseData", "readingDaysByCountry", "readingsSignature", "_pivotGrainCache", "Date",
    `${BLOCK}\nreturn { _loadArchiveReadings };`,
  )(sbReadAll, supabaseData, readingDaysByCountry, readingsSignature, grains, clock);
  return { load: () => _loadArchiveReadings("u"), asked, grains, advance: (ms) => { now += ms; } };
}
const NOV1 = { rows: [{ day: "2026-11-02", country: "SK", readings: 1 }] };
const NOV2 = { rows: [{ day: "2026-11-02", country: "SK", readings: 1 }, { day: "2026-11-06", country: "SK", readings: 1 }] };
const MIN = 60 * 1000;

test("the readings are kept for minutes, then asked again", async () => {
  const h = harness([NOV1, NOV1]);
  const a = await h.load();
  h.advance(10 * MIN);
  assert.equal(await h.load(), a);
  assert.equal(h.asked.length, 1);
  h.advance(10 * MIN);
  assert.equal(await h.load(), a, "an unchanged answer keeps its identity, and its version");
  assert.equal(h.asked.length, 2);
  assert.equal(h.grains.size, 2, "nothing to drop when nothing changed");
});

test("a new reading is a new version, and the archive grains divided by the old one go", async () => {
  const h = harness([NOV1, NOV2]);
  const a = await h.load();
  h.advance(20 * MIN);
  const b = await h.load();
  assert.notEqual(b.version, a.version);
  assert.equal(b.days.SK.get("2026-11-06"), 1);
  assert.deepEqual([...h.grains.keys()], ['u::{"dims":["cast"],"mode":"latest"}::'], "only today's grains stay");
});

test("a failed refresh keeps the last good readings; a failed first read says so", async () => {
  const h = harness([NOV1, { error: { message: "timeout" } }, { error: { message: "timeout" } }]);
  const a = await h.load();
  h.advance(20 * MIN);
  assert.equal(await h.load(), a);
  const fresh = harness([{ error: { message: "timeout" } }, { error: { message: "timeout" } }]);
  await assert.rejects(fresh.load());
});

test("a view without readings yet is read without them", async () => {
  const h = harness([{ withoutReadings: true, rows: [{ day: "2026-11-02", country: "SK" }] }]);
  const a = await h.load();
  assert.equal(a.days.SK.get("2026-11-02"), 1);
  assert.deepEqual(h.asked, ["day,country,readings", "day,country"]);
});

test("the hook asks again while the page is open, and the Pivot's grain key follows the version", () => {
  const hook = SRC.match(/export function useArchiveReadingDays[\s\S]*?\n\}\n/)[0];
  assert.match(hook, /setInterval\(ask, ARCHIVE_READINGS_CHECK_MS\)/);
  assert.match(hook, /addEventListener\("visibilitychange"/);
  assert.match(hook, /version: entry \? entry\.version : ""/);
  const grainHook = SRC.match(/export function usePivotGrain[\s\S]*?\n\}\n/)[0];
  assert.match(grainHook, /::\$\{specKey\}::\$\{version\}`/);
  const PIVOT = readFileSync(new URL("../pages/PivotV2.jsx", import.meta.url), "utf8");
  assert.match(PIVOT, /const grainVersion = isCurrent \? "" : readingsVersion;/);
  assert.match(PIVOT, /usePivotGrain\(\{ enabled: grainEnabled, spec: pivotSpec, meta: grainMeta, version: grainVersion \}\)/);
  assert.match(PIVOT, /usePivotGrain\(\{ enabled: grainEnabled && priceScope, spec: pivotSpecUnscoped, meta: grainMeta, version: grainVersion \}\)/);
});

test("the readings signature changes with a reading and not otherwise", () => {
  const a = readingDaysByCountry(NOV1.rows);
  assert.equal(readingsSignature(a), readingsSignature(readingDaysByCountry([...NOV1.rows])));
  assert.notEqual(readingsSignature(a), readingsSignature(readingDaysByCountry(NOV2.rows)));
  assert.notEqual(readingsSignature(a), readingsSignature(readingDaysByCountry([{ day: "2026-11-02", country: "SK", readings: 2 }])));
});
