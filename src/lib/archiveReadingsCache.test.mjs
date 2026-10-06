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
import { readingDaysByCountry, readingsSignature, holdingSpecs, archiveHolding, holdingSignature, holdingLags } from "./archiveReadings.js";

const SRC = readFileSync(new URL("./useData.js", import.meta.url), "utf8");
const BLOCK = SRC.slice(SRC.indexOf("const ARCHIVE_READINGS_TTL_MS"), SRC.indexOf("/** Full readings of every market ("));

function harness(answers) {
  let now = Date.UTC(2026, 10, 2, 9, 0);
  const asked = [];
  const sbReadAll = async (make) => make(0, 999);
  const sbRead = (b) => b;
  const supabaseData = {
    rpc: () => Promise.resolve({ data: [], error: null }),   // what the cube holds is another test's
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
    "sbReadAll", "sbRead", "supabaseData", "readingDaysByCountry", "readingsSignature",
    "holdingSpecs", "archiveHolding", "holdingSignature", "holdingLags", "_pivotGrainCache", "Date", "console",
    `${BLOCK}\nreturn { _loadArchiveReadings };`,
  )(sbReadAll, sbRead, supabaseData, readingDaysByCountry, readingsSignature,
    holdingSpecs, archiveHolding, holdingSignature, holdingLags, grains, clock, { error() {} });
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
  assert.match(hook, /setInterval\(\(\) => \{ if \(!hidden\(\)\) ask\(\); \}, ARCHIVE_READINGS_CHECK_MS\)/);
  assert.match(hook, /addEventListener\("visibilitychange"/);
  assert.match(hook, /version: entry \? entry\.version : ""/);
  const grainHook = SRC.match(/export function usePivotGrain[\s\S]*?\n\}\n/)[0];
  assert.match(grainHook, /::\$\{specKey\}::\$\{version\}`/);
  const PIVOT = readFileSync(new URL("../pages/PivotV2.jsx", import.meta.url), "utf8");
  assert.match(PIVOT, /const grainVersion = isCurrent \? "" : readingsVersion;/);
  assert.match(PIVOT, /usePivotGrain\(\{ enabled: grainEnabled, spec: pivotSpec, meta: grainMeta, version: grainVersion \}\)/);
  assert.match(PIVOT, /usePivotGrain\(\{ enabled: grainEnabled && priceScope, spec: pivotSpecUnscoped, meta: grainUnscopedMetaNow, version: grainVersion \}\)/);
});

test("the readings signature changes with a reading and not otherwise", () => {
  const a = readingDaysByCountry(NOV1.rows);
  assert.equal(readingsSignature(a), readingsSignature(readingDaysByCountry([...NOV1.rows])));
  assert.notEqual(readingsSignature(a), readingsSignature(readingDaysByCountry(NOV2.rows)));
  assert.notEqual(readingsSignature(a), readingsSignature(readingDaysByCountry([{ day: "2026-11-02", country: "SK", readings: 2 }])));
});

// ── today's market: the Pivot's latest-mode grains are kept for minutes, not the session ──
const grainCurrent = new Function(`
  ${SRC.match(/const PIVOT_GRAIN_TTL_MS = [^\n]*/)[0]}
  ${SRC.match(/const _isArchiveGrainKey = [^\n]*/)[0]}
  ${SRC.match(/function _grainCurrent\(key, entry, now\)[\s\S]*?\n\}/)[0]}
  return _grainCurrent;
`)();

test("a latest grain is served for 15 minutes, then asked again; an archive grain follows its readings", () => {
  const t0 = Date.UTC(2026, 10, 2, 9, 0);
  const latest = 'u::{"dims":["cast"],"mode":"latest"}::';
  const archive = 'u::{"dims":["cast","country"],"mode":"archive"}::12.abc/-';
  assert.equal(grainCurrent(latest, { grain: [], at: t0 }, t0 + 14 * MIN), true);
  assert.equal(grainCurrent(latest, { grain: [], at: t0 }, t0 + 16 * MIN), false, "the morning's market in the evening");
  assert.equal(grainCurrent(archive, { grain: [], at: t0 }, t0 + 24 * 60 * MIN), true);
  assert.equal(grainCurrent(latest, undefined, t0), false);
});

test("the grain hook asks again while the page is open, and keeps the kept grain on screen meanwhile", () => {
  const hook = SRC.match(/export function usePivotGrain[\s\S]*?\n\}\n/)[0];
  assert.match(hook, /document\.visibilityState !== "hidden"\) ask\(\); \}, PIVOT_GRAIN_CHECK_MS\)/);
  assert.match(hook, /addEventListener\("visibilitychange"/);
  assert.match(hook, /_pivotGrainCache\.set\(key, \{ grain: arr, at: Date\.now\(\) \}\)/);
  assert.match(hook, /if \(kept\) setState\(\{ key, grain: kept\.grain, meta, error: false \}\);\s*\n\s*if \(_grainCurrent\(key, kept, Date\.now\(\)\)\) return;/);
  assert.match(hook, /\}, \[key, authLoading, recheck\]\)/);
  assert.match(hook, /if \(!kept\) setState\(\{ key, grain: \[\], meta, error: true \}\);/);
});

// ── while the cube lags an approval, the readings are asked again within a minute ──
test("a holding read during the cube's lag is kept a minute, then 15 minutes once it agrees", async () => {
  const days = [{ day: "2026-11-02", country: "SK", readings: 1 }, { day: "2026-11-06", country: "SK", readings: 1 }];
  const facts = [{ d: ["SK", "2026-11-02"], m: { n: 7500 } }, { d: ["SK", "2026-11-06"], m: { n: 7500 } }];
  let cube = [{ d: ["SK", "2026-11"], m: { n: 7500 } }];               // refreshed before the 6th
  let now = Date.UTC(2026, 10, 6, 5, 30);
  let asked = 0;
  const supabaseData = {
    rpc: (_n, { p_spec }) => Promise.resolve({ data: p_spec.dims[1] === "snapshot_month" ? cube : facts, error: null }),
    from: () => { const b = { select() { return b; }, order() { return b; }, range() { asked += 1; return Promise.resolve({ data: days, error: null }); } }; return b; },
  };
  const { _loadArchiveReadings } = new Function(
    "sbReadAll", "sbRead", "supabaseData", "readingDaysByCountry", "readingsSignature",
    "holdingSpecs", "archiveHolding", "holdingSignature", "holdingLags", "_pivotGrainCache", "Date", "console",
    `${BLOCK}\nreturn { _loadArchiveReadings };`,
  )(async (make) => make(0, 999), (b) => b, supabaseData, readingDaysByCountry, readingsSignature,
    holdingSpecs, archiveHolding, holdingSignature, holdingLags, new Map(), { now: () => now }, { error() {} });
  const lagged = await _loadArchiveReadings("u");
  assert.equal(lagged.lagging, true);
  cube = [{ d: ["SK", "2026-11"], m: { n: 15000 } }];                    // 05:32 the cube is refreshed
  now += 2 * MIN;
  const after = await _loadArchiveReadings("u");
  assert.equal(asked, 2, "asked again within the lag's minute");
  assert.equal(after.lagging, false);
  assert.notEqual(after.version, lagged.version, "the grains divided by the lagging cube are asked again");
  now += 5 * MIN;
  assert.equal(await _loadArchiveReadings("u"), after);
  assert.equal(asked, 2, "agreeing again, kept for 15 minutes");
});

test("the hook checks every minute, and the assistant keeps lagging readings a minute", () => {
  assert.match(SRC, /const ARCHIVE_READINGS_CHECK_MS = 60 \* 1000;/);
  assert.match(SRC, /const _readingsTtl = \(entry\) => \(entry\.lagging \|\| entry\.holdingFailed \? ARCHIVE_READINGS_LAG_TTL_MS : ARCHIVE_READINGS_TTL_MS\);/);
  const CHAT = readFileSync(new URL("../../api/ai/chat.js", import.meta.url), "utf8");
  assert.match(CHAT, /const keep = _readings\?\.lagging \? 60 \* 1000 : 10 \* 60 \* 1000;/);
});

// ── what the cube holds is read in parallel with the grain, and a passing error keeps it ──
function stagedHarness() {
  let now = Date.UTC(2026, 10, 6, 9, 0);
  const days = [{ day: "2026-11-02", country: "SK", readings: 1 }, { day: "2026-11-06", country: "SK", readings: 1 }];
  const facts = [{ d: ["SK", "2026-11-02"], m: { n: 7500 } }, { d: ["SK", "2026-11-06"], m: { n: 7500 } }];
  const st = { cube: [{ d: ["SK", "2026-11"], m: { n: 15000 } }], rpcFails: false, gate: null };
  const supabaseData = {
    rpc: async (_n, { p_spec }) => {
      if (st.gate) await st.gate;
      if (st.rpcFails) return { data: null, error: { message: "timeout" } };
      return { data: p_spec.dims[1] === "snapshot_month" ? st.cube : facts, error: null };
    },
    from: () => { const b = { select() { return b; }, order() { return b; }, range() { return Promise.resolve({ data: days, error: null }); } }; return b; },
  };
  const grains = new Map([['u::{"mode":"archive"}::x', { grain: [] }], ['u::{"mode":"latest"}::', { grain: [] }]]);
  const api = new Function(
    "sbReadAll", "sbRead", "supabaseData", "readingDaysByCountry", "readingsSignature",
    "holdingSpecs", "archiveHolding", "holdingSignature", "holdingLags", "_pivotGrainCache", "Date", "console",
    `${BLOCK}\nreturn { _loadArchiveReadings, _archiveReadingsCache, _archiveReadingsListeners };`,
  )(async (make) => make(0, 999), (b) => b, supabaseData, readingDaysByCountry, readingsSignature,
    holdingSpecs, archiveHolding, holdingSignature, holdingLags, grains, { now: () => now }, { error() {} });
  return { ...api, st, grains, advance: (ms) => { now += ms; } };
}

test("the days are published before what the cube holds is in, so a grain can be asked meanwhile", async () => {
  const h = stagedHarness();
  let release;
  h.st.gate = new Promise((r) => { release = r; });
  const heard = [];
  h._archiveReadingsListeners.set("u", new Set([() => heard.push(h._archiveReadingsCache.get("u").holdingKnown)]));
  const p = h._loadArchiveReadings("u");
  await new Promise((r) => setTimeout(r, 0));
  const early = h._archiveReadingsCache.get("u");
  assert.ok(early && early.days.SK.get("2026-11-06") === 1, "the days are there before the holding");
  assert.equal(early.holdingKnown, false);
  release();
  const done = await p;
  assert.equal(done.holdingKnown, true);
  assert.equal(done.version, early.version, "the holding arriving is no new question for the grain");
  assert.deepEqual(heard, [false, true]);
});

test("a holding that cannot be read keeps the last good one, the version and the grains", async () => {
  const h = stagedHarness();
  const a = await h._loadArchiveReadings("u");
  h.st.rpcFails = true;
  h.advance(20 * MIN);
  const b = await h._loadArchiveReadings("u");
  assert.equal(b.version, a.version);
  assert.equal(b.holding, a.holding);
  assert.equal(b.holdingFailed, true);
  assert.equal(h.grains.size, 2, "no grain sent to be asked again");
  h.st.rpcFails = false;
  h.advance(2 * MIN);                                   // asked again within the minute
  const c = await h._loadArchiveReadings("u");
  assert.equal(c.holdingFailed, false);
  assert.equal(c.version, a.version);
});

test("a cube refresh with the same days is a new version, and the archive grains go", async () => {
  const h = stagedHarness();
  h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 7500 } }];   // lagging the 6th
  const a = await h._loadArchiveReadings("u");
  h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 15000 } }];
  h.advance(2 * MIN);
  const b = await h._loadArchiveReadings("u");
  assert.notEqual(b.version, a.version);
  assert.deepEqual([...h.grains.keys()], ['u::{"mode":"latest"}::']);
});

test("the Pivot waits for what the cube holds before dividing, and the record path errors with the grain path", () => {
  const PIVOT = readFileSync(new URL("../pages/PivotV2.jsx", import.meta.url), "utf8");
  assert.match(PIVOT, /const holdingNow = readingHoldingKnown \? readingHolding : undefined;/);
  assert.match(PIVOT, /const grainEnabled = configServerable && \(isCurrent \|\| !!readingDays\);/);
  assert.match(PIVOT, /const grainLoading = grainRawLoading \|\| \(archiveGrain && \(readingsLoading \|\| holdingNow === undefined\)\);/);
  assert.match(PIVOT, /\|\| \(!useGrain && canViewAnalytics && !isCurrent && !!readingsError\);/);
  assert.match(SRC, /holdingKnown: !!entry\?\.holdingKnown/);
});

test("a day read twice approved while the cube lags: lagging, then a new version after the refresh", async () => {
  let now = Date.UTC(2026, 10, 6, 9, 0);
  const world = { days: [{ day: "2026-11-02", country: "SK", readings: 1 }, { day: "2026-11-06", country: "SK", readings: 2 }],
    cube: 15000, facts: [["2026-11-02", 7500], ["2026-11-06", 14990]] };
  const supabaseData = {
    rpc: (_n, { p_spec }) => Promise.resolve({ error: null, data: p_spec.dims[1] === "snapshot_month"
      ? [{ d: ["SK", "2026-11"], m: { n: world.cube } }] : world.facts.map(([d, n]) => ({ d: ["SK", d], m: { n } })) }),
    from: () => { const b = { select() { return b; }, order() { return b; }, range() { return Promise.resolve({ data: world.days, error: null }); } }; return b; },
  };
  const grains = new Map([['u::{"mode":"archive"}::x', { grain: [] }]]);
  const { _loadArchiveReadings } = new Function(
    "sbReadAll", "sbRead", "supabaseData", "readingDaysByCountry", "readingsSignature",
    "holdingSpecs", "archiveHolding", "holdingSignature", "holdingLags", "_pivotGrainCache", "Date", "console",
    `${BLOCK}\nreturn { _loadArchiveReadings };`,
  )(async (make) => make(0, 999), (b) => b, supabaseData, readingDaysByCountry, readingsSignature,
    holdingSpecs, archiveHolding, holdingSignature, holdingLags, grains, { now: () => now }, { error() {} });
  const lag = await _loadArchiveReadings("u");
  assert.equal(lag.lagging, true, "the cube holds one of the 6th's two readings");
  world.cube = 22490;
  now += 2 * MIN;
  const after = await _loadArchiveReadings("u");
  assert.equal(after.lagging, false);
  assert.notEqual(after.version, lag.version, "a grain asked during the lag is asked again");
  assert.equal(grains.size, 0);
});
