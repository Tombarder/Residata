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
import { readingDaysByCountry, readingsSignature, holdingSpecs, archiveHolding, holdingSignature, holdingLags, holdingFactsSignature,
  archiveReadingScope, archiveRecordCells, heldReadingDays, weightedCount, recordReadingsSignature } from "./archiveReadings.js";

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
    "holdingSpecs", "archiveHolding", "holdingSignature", "holdingLags", "holdingFactsSignature", "_pivotGrainCache", "Date", "console",
    `${BLOCK}\nreturn { _loadArchiveReadings };`,
  )(sbReadAll, sbRead, supabaseData, readingDaysByCountry, readingsSignature,
    holdingSpecs, archiveHolding, holdingSignature, holdingLags, holdingFactsSignature, grains, clock, { error() {} });
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
    "holdingSpecs", "archiveHolding", "holdingSignature", "holdingLags", "holdingFactsSignature", "_pivotGrainCache", "Date", "console",
    `${BLOCK}\nreturn { _loadArchiveReadings };`,
  )(async (make) => make(0, 999), (b) => b, supabaseData, readingDaysByCountry, readingsSignature,
    holdingSpecs, archiveHolding, holdingSignature, holdingLags, holdingFactsSignature, new Map(), { now: () => now }, { error() {} });
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
  assert.match(SRC, /if \(entry\.lagging\) return entry\.lagLate \? _backoff\(entry\.lagLate\) : ARCHIVE_READINGS_LAG_TTL_MS;/);
  const CHAT = readFileSync(new URL("../../api/ai/chat.js", import.meta.url), "utf8");
  assert.match(CHAT, /const keep = _readings\?\.lagging \? 60 \* 1000 : 10 \* 60 \* 1000;/);
});

// ── what the cube holds is read in parallel with the grain, and a passing error keeps it ──
function stagedHarness() {
  let now = Date.UTC(2026, 10, 6, 9, 0);
  const facts = [{ d: ["SK", "2026-11-02"], m: { n: 7500 } }, { d: ["SK", "2026-11-06"], m: { n: 7500 } }];
  const NOV9 = { d: ["SK", "2026-11-09"], m: { n: 7500 } };                // the 9th's reading, once approved
  const st = { cube: [{ d: ["SK", "2026-11"], m: { n: 15000 } }], facts, rpcFails: false, gate: null, reads: 0, cubeAsks: 0, factsAsks: 0,
    days: [{ day: "2026-11-02", country: "SK", readings: 1 }, { day: "2026-11-06", country: "SK", readings: 1 }] };
  const supabaseData = {
    rpc: async (_n, { p_spec }) => {
      if (st.gate) await st.gate;
      if (st.latency) now += st.latency;
      if (p_spec.dims[1] === "snapshot_month") st.cubeAsks += 1; else st.factsAsks += 1;
      if (st.rpcFails) return { data: null, error: { message: "timeout" } };
      return { data: p_spec.dims[1] === "snapshot_month" ? st.cube : st.facts, error: null };
    },
    from: () => { const b = { select() { return b; }, order() { return b; }, range() { st.reads += 1; return Promise.resolve({ data: st.days, error: null }); } }; return b; },
  };
  const grains = new Map([['u::{"mode":"archive"}::x', { grain: [] }], ['u::{"mode":"latest"}::', { grain: [] }]]);
  const api = new Function(
    "sbReadAll", "sbRead", "supabaseData", "readingDaysByCountry", "readingsSignature",
    "holdingSpecs", "archiveHolding", "holdingSignature", "holdingLags", "holdingFactsSignature", "_pivotGrainCache", "Date", "console",
    `${BLOCK}\nreturn { _loadArchiveReadings, _archiveReadingsCache, _archiveReadingsListeners };`,
  )(async (make) => make(0, 999), (b) => b, supabaseData, readingDaysByCountry, readingsSignature,
    holdingSpecs, archiveHolding, holdingSignature, holdingLags, holdingFactsSignature, grains, { now: () => now }, { error() {} });
  // a reading on the 9th approved: in the days and the facts at once (one transaction)
  const approve9th = () => { st.days = [...st.days, { day: "2026-11-09", country: "SK", readings: 1 }]; st.facts = [...st.facts, NOV9]; };
  return { ...api, st, grains, approve9th, advance: (ms) => { now += ms; } };
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
    "holdingSpecs", "archiveHolding", "holdingSignature", "holdingLags", "holdingFactsSignature", "_pivotGrainCache", "Date", "console",
    `${BLOCK}\nreturn { _loadArchiveReadings };`,
  )(async (make) => make(0, 999), (b) => b, supabaseData, readingDaysByCountry, readingsSignature,
    holdingSpecs, archiveHolding, holdingSignature, holdingLags, holdingFactsSignature, grains, { now: () => now }, { error() {} });
  const lag = await _loadArchiveReadings("u");
  assert.equal(lag.lagging, true, "the cube holds one of the 6th's two readings");
  world.cube = 22490;
  now += 2 * MIN;
  const after = await _loadArchiveReadings("u");
  assert.equal(after.lagging, false);
  assert.notEqual(after.version, lag.version, "a grain asked during the lag is asked again");
  assert.equal(grains.size, 0);
});

// ── a new reading keeps the page on its own days until the new holding is in ──
test("when the days change, the kept entry stays until the new holding is in, then both land together", async () => {
  const h = stagedHarness();
  h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 15000 } }];
  const a = await h._loadArchiveReadings("u");
  // a reading lands on the 9th; the holding question is slow
  let release;
  h.st.gate = new Promise((r) => { release = r; });
  const heard = [];
  h._archiveReadingsListeners.set("u", new Set([() => heard.push(h._archiveReadingsCache.get("u"))]));
  h.approve9th();
  h.advance(20 * MIN);
  const p = h._loadArchiveReadings("u");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(h._archiveReadingsCache.get("u"), a, "the page keeps its own days and holding meanwhile");
  assert.equal(h.grains.size, 2, "and its grains");
  release();
  const b = await p;
  assert.equal(b.holdingKnown, true);
  assert.equal(b.days.SK.get("2026-11-09"), 1);
  assert.notEqual(b.version, a.version);
  assert.deepEqual(heard, [b], "published once, complete");
  assert.deepEqual([...h.grains.keys()], ['u::{"mode":"latest"}::']);
});

// ── a lag that lasts backs off ──
test("a lag is checked every minute for its first 15 minutes, then 2, 4, 8 and 15 apart; settled, the count ends", async () => {
  const h = stagedHarness();
  h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 7500 } }];      // the refresh keeps failing
  await h._loadArchiveReadings("u");
  const minutes = [];
  for (let m = 1; m <= 60; m += 1) {
    h.advance(MIN);
    const before = h.st.reads;
    await h._loadArchiveReadings("u");
    if (h.st.reads > before) minutes.push(m);
  }
  assert.deepEqual(minutes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 21, 29, 44, 59]);
  h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 15000 } }];      // refreshed at last
  h.advance(15 * MIN);
  const ok = await h._loadArchiveReadings("u");
  assert.equal(ok.lagging, false);
  assert.equal(ok.lagSince, null);
  assert.equal(ok.lagLate, 0);
});

test("a cube refreshed within its lag's first 15 minutes is seen within a minute", async () => {
  for (const [R, seenAt] of [[2, 2], [5, 5], [10, 10], [15, 15], [17, 17], [40, 44]]) {
    const h = stagedHarness();
    h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 7500 } }];
    await h._loadArchiveReadings("u");
    let seen = null;
    for (let m = 1; m <= 60 && seen == null; m += 1) {
      h.advance(MIN);
      if (m === R) h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 15000 } }];
      const e = await h._loadArchiveReadings("u");
      if (!e.lagging) seen = m;
    }
    assert.equal(seen, seenAt, `refreshed at +${R} min`);
  }
});

test("a holding that cannot be read is asked 1, 2, 4, 8, then 15 minutes apart", async () => {
  const h = stagedHarness();
  await h._loadArchiveReadings("u");
  h.st.rpcFails = true;
  h.advance(15 * MIN);
  await h._loadArchiveReadings("u");                           // the first failure
  const minutes = [];
  for (let m = 1; m <= 45; m += 1) {
    h.advance(MIN);
    const before = h.st.reads;
    await h._loadArchiveReadings("u");
    if (h.st.reads > before) minutes.push(m);
  }
  assert.deepEqual(minutes, [1, 3, 7, 15, 30, 45]);
});

test("a new reading during a lag starts its lag's count afresh", async () => {
  const h = stagedHarness();
  h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 7500 } }];
  await h._loadArchiveReadings("u");
  for (let m = 1; m <= 20; m += 1) { h.advance(MIN); await h._loadArchiveReadings("u"); }
  assert.ok(h._archiveReadingsCache.get("u").lagLate > 0, "past the window");
  h.approve9th();
  h.advance(15 * MIN);
  const e = await h._loadArchiveReadings("u");
  assert.equal(e.days.SK.get("2026-11-09"), 1);
  assert.equal(e.lagging, true);
  assert.equal(e.lagLate, 0, "checked every minute again");
  h.advance(MIN);
  const before = h.st.reads;
  await h._loadArchiveReadings("u");
  assert.equal(h.st.reads, before + 1);
});

test("a check that keeps the entry renders nothing again", () => {
  const hook = SRC.match(/export function useArchiveReadingDays[\s\S]*?\n\}\n/)[0];
  assert.match(hook, /if \(cancelled \|\| now === seen\) return;/);
});

test("a new version keeps the one it replaced, with that version's holding", async () => {
  const h = stagedHarness();
  h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 7500 } }];
  const a = await h._loadArchiveReadings("u");
  h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 15000 } }];
  h.advance(2 * MIN);
  const b = await h._loadArchiveReadings("u");
  assert.notEqual(b.version, a.version);
  assert.equal(b.prevVersion, a.version);
  assert.equal(b.prevHolding, a.holding);
});

test("an entry published between a render and its effect is shown, not taken as seen", () => {
  const hook = SRC.match(/export function useArchiveReadingDays[\s\S]*?\n\}\n/)[0];
  assert.match(hook, /const rendered = _archiveReadingsCache\.get\(key\);/);
  assert.match(hook, /let seen = rendered;/, "seen starts from what the render showed");
  assert.match(hook, /_archiveReadingsListeners\.get\(key\)\.add\(landed\);\s*\n\s*landed\(\);/, "and lands at once if the cache moved on");
  assert.match(hook, /const entry = enabled \? rendered : null;/);
  // the comparison itself, run as written: rendered A, the cache moved to B before the effect
  const body = hook.match(/const landed = \(\) => \{[\s\S]*?\n    \};/)[0];
  const cache = new Map([["u", "B"]]);
  let renders = 0;
  const run = new Function("_archiveReadingsCache", "key", "rendered", "setLanded",
    `let cancelled = false; let seen = rendered; ${body} landed(); landed(); return seen;`);
  assert.equal(run(cache, "u", "A", () => { renders += 1; }), "B");
  assert.equal(renders, 1, "one render for the entry it missed, none for the one it has");
});

test("a check that takes a few seconds does not push the next one past the minute's tick", async () => {
  // every analytics_pivot answer takes 250 ms (a check: two of them)
  const h = stagedHarness();
  const slow = h.st;
  h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 7500 } }];
  await h._loadArchiveReadings("u");
  const minutes = [];
  for (let m = 1; m <= 10; m += 1) {
    h.advance(MIN - (m === 1 ? 0 : 500));                  // the tick, a minute after the last one began
    const before = slow.reads;
    h.st.latency = 250;
    await h._loadArchiveReadings("u");
    if (slow.reads > before) minutes.push(m);
  }
  assert.deepEqual(minutes, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

// ── the archive's records are read with readings no older than they are ──
// The records (flats_archive) were kept with the readings in force at the render that
// asked for them. Those could be up to 15 minutes old: the 5th approved at 10:00, the
// records read at 10:05 held it, the readings checked at 09:55 did not — October read
// 15 000 flats for 7 500, and kept doing so after the readings caught up.
test("forced, the readings are read again whatever their age, and a read in flight is not taken for one", async () => {
  const h = stagedHarness();
  await h._loadArchiveReadings("u");
  assert.equal(h.st.reads, 1);
  await h._loadArchiveReadings("u");
  assert.equal(h.st.reads, 1, "within its minutes, kept");
  await h._loadArchiveReadings("u", true);
  assert.equal(h.st.reads, 2, "forced, read again");
  // a check in flight that read the days before the 9th's reading was approved
  h.advance(20 * MIN);
  let release;
  h.st.gate = new Promise((r) => { release = r; });
  const tick = h._loadArchiveReadings("u");
  await new Promise((r) => setTimeout(r, 0));
  h.approve9th();
  const forced = h._loadArchiveReadings("u", true);
  release();
  h.st.gate = null;
  await tick;
  const got = await forced;
  assert.ok(got.days.SK.has("2026-11-09"), "the forced read starts after the one in flight");
});

test("a forced read is no step of a long lag's spacing", async () => {
  const h = stagedHarness();
  h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 7500 } }];                   // the 6th not in the cube
  const a = await h._loadArchiveReadings("u");
  assert.equal(a.lagging, true);
  h.advance(16 * MIN);
  const late = await h._loadArchiveReadings("u");
  assert.equal(late.lagLate, 1);
  h.advance(10 * 1000);
  const forced = await h._loadArchiveReadings("u", true);
  assert.equal(forced.lagLate, 1, "the next check stays 2 minutes out, not 4");
  assert.equal(forced.lagSince, late.lagSince);
});

test("a forced read asks the days and the facts, not the cube, and leaves the entry as it is while neither moved", async () => {
  const h = stagedHarness();
  const a = await h._loadArchiveReadings("u");
  const asked = { cube: h.st.cubeAsks, facts: h.st.factsAsks };
  h.advance(5 * MIN);
  h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 15100 } }];                  // a refresh the forced read does not see
  const b = await h._loadArchiveReadings("u", true);
  assert.equal(b, a, "the same entry");
  assert.equal(b.at, a.at, "the cube's check keeps its time");
  assert.equal(h.st.cubeAsks, asked.cube, "the cube not asked");
  assert.equal(h.st.factsAsks, asked.facts + 1);
  // the facts moved (a retry of a few projects approved): a whole check, the cube included
  h.st.facts = [...h.st.facts, { d: ["SK", "2026-11-10"], m: { n: 40 } }];
  const c = await h._loadArchiveReadings("u", true);
  assert.notEqual(c, a, "a new entry, published");
  assert.equal(h.st.cubeAsks, asked.cube + 1);
  assert.equal(h.st.factsAsks, asked.facts + 2, "the facts read once for it");
  assert.ok(c.holding.facts.get("SK").has("2026-11-10"));
  // read seconds ago: not read again when the caller allows it
  const reads = h.st.reads;
  assert.equal(await h._loadArchiveReadings("u", true, 10 * 1000), c);
  assert.equal(h.st.reads, reads);
  h.advance(11 * 1000);
  await h._loadArchiveReadings("u", true, 10 * 1000);
  assert.equal(h.st.reads, reads + 1);
});

// ── W1: forced reads during a holding outage are no step of the backoff ──
// The holding RPC failing from 09:00, three records loads (a forced read before and after
// each) at 09:01:10, 09:01:40 and 09:02:10, the RPC back and the cube refreshed at 09:03:
// counted, the forced reads pushed the next check to 09:18 and new cube grains read the
// newest month as 15 000 instead of 7 500 for a quarter of an hour.
test("records loads during a holding outage do not push the next check out", async () => {
  const run = async (forcedLoads) => {
    const h = stagedHarness();
    h.st.facts = h.st.facts.slice(0, 2);
    h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 7500 } }];                 // the 6th approved, the cube lags it
    await h._loadArchiveReadings("u");
    h.st.rpcFails = true;
    const log = [];
    for (let sec = 1; sec <= 20 * 60; sec += 1) {
      h.advance(1000);
      if (sec === 3 * 60) { h.st.rpcFails = false; h.st.cube = [{ d: ["SK", "2026-11"], m: { n: 15000 } }]; }
      if (forcedLoads && [70, 100, 130].includes(sec)) {
        await h._loadArchiveReadings("u", true, 10 * 1000);
        await h._loadArchiveReadings("u", true);
      }
      if (sec % 60 === 0) {                                                  // the hook's minute tick
        const before = h.st.cubeAsks;
        const e = await h._loadArchiveReadings("u");
        if (h.st.cubeAsks > before) log.push(`${sec / 60}:${e.holdingFailed ? "fail" : e.lagging ? "lag" : "ok"}/${e.failures}`);
      }
    }
    return log;
  };
  const quiet = await run(false);
  assert.deepEqual(quiet, ["1:fail/1", "2:fail/2", "4:ok/0", "19:ok/0"]);
  assert.deepEqual(await run(true), quiet, "the same checks with the records loads");
});

// useFlatsArchive run as written, with a stand-in for React, the session and the database.
const FLATS_HOOK = (() => {
  const from = SRC.indexOf("let _archiveCache = null;");
  const start = SRC.indexOf("export function useFlatsArchive(");
  const end = SRC.indexOf("\n}\n", start) + 3;
  return SRC.slice(from, end).replace("export function useFlatsArchive(", "function useFlatsArchive(");
})();
function flatsHarness(db, country = "SK") {
  const slots = [];
  const deps = [];
  const cleanups = [];
  let i = 0;
  let pending = [];
  const useState = (init) => {
    const k = i++;
    if (!(k in slots)) slots[k] = init;
    return [slots[k], (v) => { slots[k] = typeof v === "function" ? v(slots[k]) : v; }];
  };
  const useEffect = (fn, d) => {
    const k = i++;
    const prev = deps[k];
    if (!prev || d.some((x, j) => !Object.is(x, prev[j]))) {
      deps[k] = d;
      pending.push(() => { cleanups[k]?.(); cleanups[k] = fn(); });
    }
  };
  db.pages = 0;
  const supabaseData = {
    from: () => {
      let head = false;
      let range = null;
      const b = {
        select(_c, o) { head = !!o?.head; return b; },
        in() { return b; }, gte() { return b; }, lt() { return b; }, order() { return b; }, eq() { return b; },
        range(f, t) { range = [f, t]; return b; },
        run() {
          if (head) return Promise.resolve({ count: db.rows.length, error: null });
          db.pages += 1;
          const out = db.rows.slice(range[0], range[1] + 1);
          db.onPage?.(db.pages);
          return Promise.resolve({ data: out, error: null });
        },
      };
      return b;
    },
  };
  const useFlatsArchive = new Function(
    "useState", "useEffect", "useAuth", "useCountry", "isSupabaseReady", "supabaseData", "sbRead", "_eqCountry", "_toEurDisplay",
    "recordReadingsSignature", "isAllCountries", "console",
    `${FLATS_HOOK}\nreturn useFlatsArchive;`,
  )(useState, useEffect, () => ({ loading: false, user: { id: "u" }, profile: { tier: "pro" } }), () => ({ country }),
    () => true, supabaseData, (b) => b.run(), (q) => q, (a) => a,
    recordReadingsSignature, (c) => c === "all", { error() {}, warn() {} });
  return (...args) => { i = 0; pending = []; const out = useFlatsArchive(...args); for (const p of pending) p(); return out; };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const octRows = (day) => Array.from({ length: 7500 }, (_, i) => ({
  id: `${day}-${i}`, country: "SK", batch_timestamp: `${day}T05:00:00+00:00`, snapshot_month: "2026-10", stav: i < 1500 ? "P" : "V",
}));
const OCT1 = readingDaysByCountry([{ day: "2026-10-01", country: "SK", readings: 1 }]);
const OCT5 = readingDaysByCountry([{ day: "2026-10-01", country: "SK", readings: 1 }, { day: "2026-10-05", country: "SK", readings: 1 }]);
const octHolding = (days) => {
  const sp = holdingSpecs(days);
  return archiveHolding(sp.from, [], [...days.SK.keys()].map((d) => ({ d: ["SK", d], m: { n: 7500 } })), days);
};
const readingsAt = (days) => ({ days, holding: octHolding(days) });
const shownCount = ({ flats, stamp }) => Math.round(weightedCount(flats, archiveRecordCells(
  heldReadingDays(stamp.days, stamp.holding, false), archiveReadingScope([{ key: "snapshot_month", mode: "in", values: ["2026-10"] }]), ["project_name"])));

test("records read after a reading the kept readings missed are not divided by those readings", async () => {
  // 10:05 — the database holds both October readings; the readings kept since 09:55, one
  const db = { rows: [...octRows("2026-10-01"), ...octRows("2026-10-05")] };
  const readings = { now: readingsAt(OCT5) };                                // what a read now says
  const refresh = async () => readings.now;
  const stale = { ...readingsAt(OCT1), refresh };
  const fresh = { ...readingsAt(OCT5), refresh };
  const render = flatsHarness(db);
  render(["2026-10"], null, true, stale);
  await settle();
  const first = render(["2026-10"], null, true, stale);
  assert.ok(!first.flats.length || shownCount(first) === 7500, `never 15 000: ${first.flats.length && shownCount(first)}`);
  // the read published the new readings; the page renders with them
  render(["2026-10"], null, true, fresh);
  await settle();
  const after = render(["2026-10"], null, true, fresh);
  assert.equal(after.loading, false);
  assert.equal(after.flats.length, 15000);
  assert.equal(shownCount(after), 7500, "both readings' records, divided by both readings");
});

test("a reading approved while the records are paged asks for them again", async () => {
  const db = { rows: octRows("2026-10-01") };
  const readings = { now: readingsAt(OCT1) };
  const refresh = async () => readings.now;
  const before = { ...readingsAt(OCT1), refresh };
  const after = { ...readingsAt(OCT5), refresh };
  db.onPage = (n) => {                                                      // the 5th approved after the first page
    if (n === 1) { db.rows = [...octRows("2026-10-05"), ...octRows("2026-10-01")]; readings.now = readingsAt(OCT5); }
  };
  const render = flatsHarness(db);
  render(["2026-10"], null, true, before);
  await settle();
  const mid = render(["2026-10"], null, true, before);
  assert.ok(!mid.flats.length, "records that straddle the 5th's approval are not shown with either readings");
  db.onPage = null;
  render(["2026-10"], null, true, after);
  await settle();
  const done = render(["2026-10"], null, true, after);
  assert.equal(done.flats.length, 15000);
  assert.equal(shownCount(done), 7500);
});

test("a withdrawn reading asks for the records again; the old ones stay with their own readings meanwhile", async () => {
  const db = { rows: [...octRows("2026-10-01"), ...octRows("2026-10-05")] };
  const readings = { now: readingsAt(OCT5) };
  const refresh = async () => readings.now;
  const two = { ...readingsAt(OCT5), refresh };
  const one = { ...readingsAt(OCT1), refresh };
  const render = flatsHarness(db);
  render(["2026-10"], null, true, two);
  await settle();
  const loaded = render(["2026-10"], null, true, two);
  assert.equal(shownCount(loaded), 7500);
  const pagesBefore = db.pages;
  // the 5th withdrawn: its rows leave the facts, the readings say so
  db.rows = octRows("2026-10-01");
  readings.now = readingsAt(OCT1);
  const meanwhile = render(["2026-10"], null, true, one);
  assert.equal(meanwhile.stamp, two, "the old records with their own readings");
  assert.equal(shownCount(meanwhile), 7500);
  await settle();
  const done = render(["2026-10"], null, true, one);
  assert.ok(db.pages > pagesBefore, "asked again");
  assert.equal(done.flats.length, 7500);
  assert.equal(done.stamp, one);
  assert.equal(shownCount(done), 7500);
});

test("records without readings (no analytics) are read without asking for them", async () => {
  const db = { rows: octRows("2026-10-01") };
  const render = flatsHarness(db);
  render(["2026-10"], null, true, { days: null, holding: undefined, refresh: null });
  await settle();
  const got = render(["2026-10"], null, true, { days: null, holding: undefined, refresh: null });
  assert.equal(got.flats.length, 7500);
  assert.equal(got.loading, false);
});

// ── the loader and the records hook together, as the Pivot wires them ──
function readingsWorld(st) {
  let now = Date.UTC(2026, 9, 6, 9, 0);
  Object.assign(st, { dayReads: 0, cubeAsks: 0, factsAsks: 0 });
  const supabaseData = {
    rpc: async (_n, { p_spec }) => {
      if (p_spec.dims[1] === "snapshot_month") {
        st.cubeAsks += 1;
        if (st.cubeFails) return { data: null, error: { message: "timeout" } };
        return { data: st.cube.map(([c, m, n]) => ({ d: [c, m], m: { n } })), error: null };
      }
      st.factsAsks += 1;
      return { data: st.facts.map(([c, d, n]) => ({ d: [c, d], m: { n } })), error: null };
    },
    from: () => {
      const b = { select() { return b; }, order() { return b; },
        range() { st.dayReads += 1; const d = st.days; st.afterDays?.(); return Promise.resolve({ data: d, error: null }); } };
      return b;
    },
  };
  const { _loadArchiveReadings, _archiveReadingsCache } = new Function(
    "sbReadAll", "sbRead", "supabaseData", "readingDaysByCountry", "readingsSignature",
    "holdingSpecs", "archiveHolding", "holdingSignature", "holdingLags", "holdingFactsSignature", "_pivotGrainCache", "Date", "console",
    `${BLOCK}\nreturn { _loadArchiveReadings, _archiveReadingsCache };`,
  )(async (make) => make(0, 999), (b) => b, supabaseData, readingDaysByCountry, readingsSignature,
    holdingSpecs, archiveHolding, holdingSignature, holdingLags, holdingFactsSignature, new Map(), { now: () => now }, { error() {} });
  // the Pivot's stamp of what the readings hook renders
  const stampOf = (e) => ({ days: e.days, holding: e.holding, refresh: (within) => _loadArchiveReadings("u", true, within) });
  return { load: () => _loadArchiveReadings("u"), latest: () => _archiveReadingsCache.get("u"), stampOf, advance: (ms) => { now += ms; } };
}
const fewRows = (n) => Array.from({ length: n }, (_, i) => ({ id: i, country: "SK", batch_timestamp: "2026-09-04T05:00:00+00:00", snapshot_month: "2026-09" }));

// ── a reading approved between a check's read of the days and its read of the facts ──
// The facts then hold a whole reading the days do not, and whatever is divided by those
// days — a grain from the facts, the records — counts it against a reading too few until
// the next check, up to a quarter of an hour later.
test("a check whose facts hold a reading its days lack reads the days again; a retry does not", async () => {
  const st = { days: [{ day: "2026-10-02", country: "SK", readings: 1 }], facts: [["SK", "2026-10-02", 7500]], cube: [["SK", "2026-10", 7500]] };
  const w = readingsWorld(st);
  await w.load();
  w.advance(16 * MIN);
  st.afterDays = () => {                                                    // the 6th approved right after the days are read
    st.afterDays = null;
    st.days = [{ day: "2026-10-06", country: "SK", readings: 1 }, ...st.days];
    st.facts = [...st.facts, ["SK", "2026-10-06", 7500]];
  };
  const reads = st.dayReads;
  const e = await w.load();
  assert.ok(e.days.SK.has("2026-10-06"), "the days read again hold it");
  assert.ok(e.holding.facts.get("SK").has("2026-10-06"));
  assert.ok(!e.holding.factsAhead.size);
  assert.equal(st.dayReads, reads + 2);
  // a not-due morning's retry of a few projects: no reading, the days read once
  w.advance(16 * MIN);
  st.facts = [...st.facts, ["SK", "2026-10-07", 60]];
  const r = st.dayReads;
  await w.load();
  assert.equal(st.dayReads, r + 1);
});

// A facts-only day as big as half a reading that never reaches the days — a partial
// snapshot of the big projects a reading missed — sent every check, and every forced read
// twice, to read the days again.
test("a partial snapshot as big as a reading has the days read again once, not at every check", async () => {
  const st = { days: [{ day: "2026-10-02", country: "SK", readings: 1 }, { day: "2026-10-06", country: "SK", readings: 1 }],
    facts: [["SK", "2026-10-02", 7500], ["SK", "2026-10-06", 3500]],         // the 6th missed big projects
    cube: [["SK", "2026-10", 11000]] };
  const w = readingsWorld(st);
  await w.load();
  st.facts.push(["SK", "2026-10-07", 4000]);                               // the 7th's partial snapshot of them
  st.cube = [["SK", "2026-10", 15000]];
  let reads = st.dayReads;
  for (let k = 0; k < 4; k += 1) { w.advance(16 * MIN); await w.load(); }
  assert.deepEqual([...w.latest().holding.factsAhead], [["SK", ["2026-10-07"]]]);
  assert.equal(st.dayReads - reads, 5, "four checks, the days read again once");
  reads = st.dayReads;
  const facts = st.factsAsks;
  const force = (within) => w.stampOf(w.latest()).refresh(within);
  for (let k = 0; k < 5; k += 1) { w.advance(20 * 1000); await force(0); }
  assert.equal(st.dayReads - reads, 5, "five forced reads, the days read once each");
  assert.equal(st.factsAsks - facts, 5);
  // a second partial snapshot the same morning: read again, once
  st.facts = st.facts.map(([c, d, n]) => (d === "2026-10-07" ? [c, d, 4100] : [c, d, n]));
  reads = st.dayReads;
  for (let k = 0; k < 3; k += 1) { w.advance(16 * MIN); await w.load(); }
  assert.equal(st.dayReads - reads, 4);
});

test("records read while a reading lands between the two reads of the check after them are not divided without it", async () => {
  const octRowsOf = (day, n) => Array.from({ length: n }, (_, i) => ({ id: `${day}-${i}`, country: "SK", batch_timestamp: `${day}T05:00:00+00:00`, snapshot_month: "2026-10" }));
  const st = { days: [{ day: "2026-10-02", country: "SK", readings: 1 }], facts: [["SK", "2026-10-02", 7500]], cube: [["SK", "2026-10", 7500]] };
  const w = readingsWorld(st);
  const db = { rows: octRowsOf("2026-10-02", 7500) };
  const render = flatsHarness(db, "SK");
  await w.load();
  w.advance(MIN);
  db.onPage = (n) => {                                                      // the 6th lands as the check after the pages reads the days
    if (n !== 1) return;
    st.afterDays = () => {
      st.afterDays = null;
      st.days = [{ day: "2026-10-06", country: "SK", readings: 1 }, ...st.days];
      st.facts = [...st.facts, ["SK", "2026-10-06", 7500]];
      db.rows = [...octRowsOf("2026-10-06", 7500), ...db.rows];
    };
  };
  let got = null;
  for (let k = 0; k < 4; k += 1) {                                          // whatever the readings publish renders
    render(["2026-10"], null, true, w.stampOf(w.latest()));
    await settle();
    got = render(["2026-10"], null, true, w.stampOf(w.latest()));
  }
  const shown = Math.round(weightedCount(got.flats, archiveRecordCells(heldReadingDays(got.stamp.days, got.stamp.holding, false),
    archiveReadingScope([{ key: "snapshot_month", mode: "in", values: ["2026-10"] }]), ["project_name"])));
  assert.equal(got.loading, false);
  assert.equal(shown, 7500, `records ${got.flats.length}, their days ${[...got.stamp.days.SK.keys()]}`);
});

// ── W2: the records are asked again for a reading of THEIR market and months only ──
test("an SK user's September records stay for a CZ reading, a retry and a cube refresh, and go for a withdrawn September reading", async () => {
  const st = {
    days: [{ day: "2026-09-04", country: "SK", readings: 1 }, { day: "2026-09-08", country: "SK", readings: 1 },
      { day: "2026-10-02", country: "SK", readings: 1 }, { day: "2026-10-02", country: "CZ", readings: 1 }],
    facts: [["SK", "2026-10-02", 7500], ["CZ", "2026-10-02", 4000]],
    cube: [["SK", "2026-10", 7500], ["CZ", "2026-10", 4000]],
  };
  const w = readingsWorld(st);
  const db = { rows: fewRows(30) };
  const render = flatsHarness(db, "SK");
  const show = async () => {                                               // the next check lands, the page renders
    w.advance(16 * MIN);
    const e = await w.load();
    render(["2026-09"], null, true, w.stampOf(e));
    await settle();
    return render(["2026-09"], null, true, w.stampOf(e));
  };
  const first = await show();
  assert.equal(first.flats.length, 30);
  const pages = db.pages;
  st.facts.push(["SK", "2026-10-07", 60]);                                  // a not-due morning's retry of 2 SK projects
  await show();
  assert.equal(db.pages, pages, "a retry in another month");
  st.days.push({ day: "2026-10-06", country: "CZ", readings: 1 });          // a CZ reading
  st.facts.push(["CZ", "2026-10-06", 4000]);
  await show();
  assert.equal(db.pages, pages, "another market's reading");
  st.days.push({ day: "2026-10-09", country: "SK", readings: 1 });          // an SK reading in October
  st.facts.push(["SK", "2026-10-09", 7500]);
  await show();
  assert.equal(db.pages, pages, "another month's reading");
  st.cube = [["SK", "2026-10", 15060], ["CZ", "2026-10", 8000]];
  await show();
  assert.equal(db.pages, pages, "a cube refresh");
  st.days = st.days.filter((d) => d.day !== "2026-09-08");                 // September's 8th withdrawn
  const after = await show();
  assert.ok(db.pages > pages, "a reading of their own month withdrawn");
  assert.ok(!after.stamp.days.SK.has("2026-09-08"));
});

test("records of the newest month are asked again for its new reading, its facts catching up and a retry", async () => {
  const st = {
    days: [{ day: "2026-10-02", country: "SK", readings: 1 }, { day: "2026-10-05", country: "SK", readings: 1 }],
    facts: [["SK", "2026-10-02", 7500]],                                    // the 5th's sync failed
    cube: [["SK", "2026-10", 7500]],
  };
  const w = readingsWorld(st);
  const db = { rows: fewRows(30) };
  const render = flatsHarness(db, "all");
  const show = async () => {
    w.advance(16 * MIN);
    const e = await w.load();
    render(["2026-10"], null, true, w.stampOf(e));
    await settle();
    return render(["2026-10"], null, true, w.stampOf(e));
  };
  await show();
  let pages = db.pages;
  st.facts.push(["SK", "2026-10-05", 7500]);                                // resynced
  await show();
  assert.ok(db.pages > pages, "the facts caught up with the 5th");
  pages = db.pages;
  st.facts.push(["SK", "2026-10-07", 60]);                                  // a retry: its rows are records of October
  await show();
  assert.ok(db.pages > pages, "a retry");
  pages = db.pages;
  st.days.push({ day: "2026-10-09", country: "CZ", readings: 1 });          // every market on screen
  st.facts.push(["CZ", "2026-10-09", 4000]);
  st.cube.push(["CZ", "2026-10", 4000]);
  await show();
  assert.ok(db.pages > pages, "a CZ reading, all markets on screen");
});

test("the records' readings are those of their market and months, as the facts hold them", () => {
  const days = readingDaysByCountry([{ day: "2026-09-04", country: "SK", readings: 1 }, { day: "2026-10-02", country: "SK", readings: 1 },
    { day: "2026-10-05", country: "SK", readings: 2 }, { day: "2026-10-02", country: "CZ", readings: 1 }]);
  const sp = holdingSpecs(days);
  const holding = (facts) => archiveHolding(sp.from, [], facts.map(([c, d]) => ({ d: [c, d], m: { n: 100 } })), days);
  const all = holding([["SK", "2026-10-02"], ["SK", "2026-10-05"], ["CZ", "2026-10-02"]]);
  const sig = (h, scope) => recordReadingsSignature(days, h, scope);
  assert.equal(sig(all, { country: "SK", months: ["2026-10"] }), "SK:2026-10-02=1;2026-10-05=2");
  assert.equal(sig(all, { country: "SK", dates: ["2026-09-04"] }), "SK:2026-09-04=1", "a day: its whole month");
  assert.equal(sig(all, {}), "CZ:2026-10-02=1,SK:2026-09-04=1;2026-10-02=1;2026-10-05=2");
  assert.equal(sig(holding([["SK", "2026-10-02"], ["CZ", "2026-10-02"]]), { country: "SK", months: ["2026-10"] }), "SK:2026-10-02=1",
    "a day the facts do not hold");
  const retry = holding([["SK", "2026-10-02"], ["SK", "2026-10-05"], ["SK", "2026-10-07"], ["CZ", "2026-10-02"]]);
  assert.equal(sig(retry, { country: "SK", months: ["2026-10"] }), "SK:2026-10-02=1;2026-10-05=2;2026-10-07+100", "a retry, with its rows");
  assert.equal(sig(retry, { country: "CZ" }), sig(all, { country: "CZ" }), "another market's retry");
  assert.equal(sig(retry, { country: "SK", months: ["2026-09"] }), sig(all, { country: "SK", months: ["2026-09"] }), "another month's retry");
  const more = archiveHolding(sp.from, [], [["SK", "2026-10-02", 100], ["SK", "2026-10-05", 200], ["SK", "2026-10-07", 160], ["CZ", "2026-10-02", 100]]
    .map(([c, d, n]) => ({ d: [c, d], m: { n } })), days);
  assert.notEqual(sig(more, { country: "SK" }), sig(retry, { country: "SK" }), "a second retry the same morning");
  assert.equal(sig(retry, { country: "SK", dates: ["2026-10-05"] }), sig(all, { country: "SK", dates: ["2026-10-05"] }),
    "a retry outside the days fetched");
  assert.equal(sig(retry, { country: "SK", dates: ["2026-10-05", "2026-10-07"] }), "SK:2026-10-02=1;2026-10-05=2;2026-10-07+100",
    "a retry within them");
  assert.equal(recordReadingsSignature(null, null, {}), "");
});

// ── a retry's rows are records: its approval or withdrawal asks for them again ──
// SK October read on the 2nd and the 6th; the 6th missed project P (100 flats), so the
// record path shows P at 50. The 7th's retry of P approved: the grain shows 100, and the
// records — never asked again — stayed at 50 for the session.
const retryRows = (day, n, pfx, project) => Array.from({ length: n }, (_, i) => ({
  id: `${pfx}${day}-${i}`, project_id: project, country: "SK", batch_timestamp: `${day}T05:00:00+00:00`, snapshot_month: "2026-10" }));
const retryWorld = () => ({
  days: [{ day: "2026-10-02", country: "SK", readings: 1 }, { day: "2026-10-06", country: "SK", readings: 1 }],
  facts: [["SK", "2026-10-02", 7500], ["SK", "2026-10-06", 7400]],
  cube: [["SK", "2026-10", 14900]],
});
const projectFlats = (got, project) => weightedCount(got.flats.filter((r) => r.project_id === project), archiveRecordCells(
  heldReadingDays(got.stamp.days, got.stamp.holding, false), archiveReadingScope([{ key: "snapshot_month", mode: "in", values: ["2026-10"] }]), ["project_name"]));

test("a retry approved while the Pivot's records are open asks for them again; withdrawn, again", async () => {
  const st = retryWorld();
  const w = readingsWorld(st);
  const db = { rows: [...retryRows("2026-10-06", 7400, "", "A"), ...retryRows("2026-10-02", 7400, "", "A"), ...retryRows("2026-10-02", 100, "p", "P")] };
  const render = flatsHarness(db, "SK");
  const show = async () => {
    w.advance(16 * MIN);
    const e = await w.load();
    render(["2026-10"], null, true, w.stampOf(e));
    await settle();
    return render(["2026-10"], null, true, w.stampOf(e));
  };
  const a = await show();
  assert.equal(projectFlats(a, "P"), 50, "missed on the 6th");
  st.facts.push(["SK", "2026-10-07", 100]);                                  // the 7th's retry of P approved
  st.cube = [["SK", "2026-10", 15000]];
  db.rows = [...retryRows("2026-10-07", 100, "r", "P"), ...db.rows];
  const b = await show();
  assert.equal(b.flats.length, 15000);
  assert.equal(projectFlats(b, "P"), 100);
  st.facts = st.facts.filter(([, d]) => d !== "2026-10-07");                // withdrawn
  st.cube = [["SK", "2026-10", 14900]];
  db.rows = db.rows.filter((r) => !r.id.startsWith("r"));
  const c = await show();
  assert.equal(c.flats.length, 14900);
  assert.equal(projectFlats(c, "P"), 50);
});

test("a retry approved while the records are paged asks for them again, not kept with rows twice and rows missing", async () => {
  const st = retryWorld();
  const w = readingsWorld(st);
  // newest first, as the records are paged: the retry's rows land at the top and shift every page after
  const db = { rows: [...retryRows("2026-10-06", 7400, "", "A"), ...retryRows("2026-10-02", 7400, "", "A"), ...retryRows("2026-10-02", 100, "p", "P")] };
  db.onPage = (n) => {
    if (n === 1) { db.rows = [...retryRows("2026-10-07", 100, "r", "P"), ...db.rows]; st.facts.push(["SK", "2026-10-07", 100]); }
  };
  const render = flatsHarness(db, "SK");
  await w.load();
  let got = null;
  for (let k = 0; k < 4; k += 1) {
    render(["2026-10"], null, true, w.stampOf(w.latest()));
    await settle();
    got = render(["2026-10"], null, true, w.stampOf(w.latest()));
  }
  const ids = got.flats.map((r) => r.id);
  assert.equal(ids.length - new Set(ids).size, 0, "no row twice");
  assert.equal(got.flats.filter((r) => r.id.startsWith("r")).length, 100, "the retry's rows");
  assert.equal(projectFlats(got, "P"), 100);
});

// The Pivot's default records: the Datum filter on the newest reading's day (the 6th),
// fetched as batch_timestamp in [the 6th, the 7th). A retry on the 7th is none of them.
test("records of a day are not asked again for a retry on another day, and are for one on theirs", async () => {
  const st = retryWorld();
  const w = readingsWorld(st);
  const db = { rows: retryRows("2026-10-06", 7400, "", "A") };
  const render = flatsHarness(db, "SK");
  const show = async (dates) => {
    w.advance(16 * MIN);
    const e = await w.load();
    render(null, dates, true, w.stampOf(e));
    await settle();
    return render(null, dates, true, w.stampOf(e));
  };
  await show(["2026-10-06"]);
  let pages = db.pages;
  st.facts.push(["SK", "2026-10-07", 100]);                                  // a retry on the 7th
  st.cube = [["SK", "2026-10", 15000]];
  await show(["2026-10-06"]);
  assert.equal(db.pages, pages, "a retry on the 7th");
  st.facts = st.facts.map(([c, d, n]) => (d === "2026-10-07" ? [c, d, 130] : [c, d, n]));   // a second one
  st.cube = [["SK", "2026-10", 15030]];
  await show(["2026-10-06"]);
  assert.equal(db.pages, pages, "a second retry on the 7th");
  // records of the 6th to the 7th hold it
  await show(["2026-10-06", "2026-10-07"]);
  pages = db.pages;
  st.facts = st.facts.map(([c, d, n]) => (d === "2026-10-07" ? [c, d, 160] : [c, d, n]));
  await show(["2026-10-06", "2026-10-07"]);
  assert.ok(db.pages > pages, "a retry on a day fetched");
});

// ── the facts catch up with a reading while the cube cannot be read ──
// A forced read (the records asking) found the facts moved and the cube's question
// failing: it kept the old holding, which lacks the day, so the records holding that
// day's rows were divided without it — 15 000 for 7 500 — until the cube was back.
test("records read while the cube cannot be read are divided by the facts as read", async () => {
  const octRowsOf = (day, n) => Array.from({ length: n }, (_, i) => ({ id: `${day}-${i}`, country: "SK", batch_timestamp: `${day}T05:00:00+00:00`, snapshot_month: "2026-10" }));
  const st = { days: [{ day: "2026-10-02", country: "SK", readings: 1 }, { day: "2026-10-05", country: "SK", readings: 1 }],
    facts: [["SK", "2026-10-02", 7500]], cube: [["SK", "2026-10", 7500]] };      // the 5th's sync failed
  const w = readingsWorld(st);
  const db = { rows: octRowsOf("2026-10-02", 7500) };
  const render = flatsHarness(db, "SK");
  const before = await w.load();
  // 09:05 the resync drains the 5th into the facts; the cube's question fails for a while
  w.advance(5 * MIN);
  st.facts.push(["SK", "2026-10-05", 7500]);
  db.rows = [...octRowsOf("2026-10-05", 7500), ...db.rows];
  st.cubeFails = true;
  const shown = (g) => Math.round(weightedCount(g.flats, archiveRecordCells(heldReadingDays(g.stamp.days, g.stamp.holding, false),
    archiveReadingScope([{ key: "snapshot_month", mode: "in", values: ["2026-10"] }]), ["project_name"])));
  let got = null;
  for (let k = 0; k < 3; k += 1) {
    render(["2026-10"], null, true, w.stampOf(w.latest()));
    await settle();
    got = render(["2026-10"], null, true, w.stampOf(w.latest()));
  }
  assert.equal(got.flats.length, 15000);
  assert.equal(shown(got), 7500, "the 5th's rows divided by the 5th's reading");
  const e = w.latest();
  assert.equal(e.holdingFailed, true, "the cube still to be read");
  assert.ok(e.holding.facts.get("SK").has("2026-10-05"));
  assert.equal(e.holding.cubeTotals.get("SK|2026-10"), 7500, "the cube as last held");
  assert.equal(e.failures, before.failures, "no step of the backoff");
  assert.equal(e.at, before.at, "the cube's check keeps its time");
  // the cube back: the next check reads it
  st.cubeFails = false;
  st.cube = [["SK", "2026-10", 15000]];
  w.advance(MIN);
  const after = await w.load();
  assert.equal(after.holdingFailed, false);
  assert.equal(after.holding.cubeTotals.get("SK|2026-10"), 15000);
});

// ── W3: a records load costs one read of the days and the facts, not two of everything ──
test("a records load after a fresh check reads the days and the facts once, and never the cube", async () => {
  const st = {
    days: [{ day: "2026-10-01", country: "SK", readings: 1 }, { day: "2026-10-05", country: "SK", readings: 1 }],
    facts: [["SK", "2026-10-01", 7500], ["SK", "2026-10-05", 7500]],
    cube: [["SK", "2026-10", 15000]],
  };
  const w = readingsWorld(st);
  const db = { rows: fewRows(30) };
  const render = flatsHarness(db, "SK");
  const e = await w.load();                                                // the Pivot's first readings check
  const at = { ...st };
  render(null, ["2026-10-05"], true, w.stampOf(e));
  await settle();
  const got = render(null, ["2026-10-05"], true, w.stampOf(e));
  assert.equal(got.flats.length, 30);
  assert.deepEqual([st.dayReads - at.dayReads, st.factsAsks - at.factsAsks, st.cubeAsks - at.cubeAsks], [1, 1, 0],
    "the check after the records only");
  // five minutes on, another day: the check before them too
  w.advance(5 * MIN);
  const at2 = { ...st };
  render(null, ["2026-10-01"], true, w.stampOf(e));
  await settle();
  render(null, ["2026-10-01"], true, w.stampOf(e));
  assert.deepEqual([st.dayReads - at2.dayReads, st.factsAsks - at2.factsAsks, st.cubeAsks - at2.cubeAsks], [2, 2, 0]);
});

test("the Pivot hands the records its readings and a fresh read; the hook only when enabled", () => {
  const PIVOT = readFileSync(new URL("../pages/PivotV2.jsx", import.meta.url), "utf8");
  assert.match(PIVOT, /\(\{ days: readingDays, holding: holdingNow, refresh: refreshReadings \}\)/);
  assert.match(SRC, /\brefresh: enabled \? refresh : null,/);
  assert.match(SRC, /const refresh = useCallback\(\(within = 0\) => _loadArchiveReadings\(key, true, within\), \[key\]\);/);
  const hook = SRC.slice(SRC.indexOf("export function useFlatsArchive("), SRC.indexOf("export function useFlatsArchive(") + 9000);
  assert.match(hook, /\$\{enabled \? "1" : "0"\}::\$\{readingsKey\}`/);
});
