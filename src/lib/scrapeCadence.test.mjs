/**
 * The data-collection interval editor (Data Control → Zber dát) — run with:
 *   node --test src/lib/scrapeCadence.test.mjs
 *
 * The number an admin types here decides how often the market is collected, so the
 * editor must only ever send a whole number of days from 1 to 30, the −/+ buttons
 * must never step outside that range, and the tab must stay reachable.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_DAYS, MIN_DAYS, PRESETS, everyDays, parseDays, stepDays } from "./scrapeCadence.js";

test("the range is 1 to 30 days", () => {
  assert.equal(MIN_DAYS, 1);
  assert.equal(MAX_DAYS, 30);
});

test("every whole number from 1 to 30 is accepted as itself", () => {
  for (let n = 1; n <= 30; n++) {
    assert.equal(parseDays(String(n)), n);
    assert.equal(parseDays(n), n);
    assert.equal(parseDays(` ${n} `), n);
  }
});

test("anything else is refused, not rounded or clamped", () => {
  for (const raw of ["", " ", "0", "31", "100", "-1", "-4", "4.5", "4,5", "1e1", "4d", "abc",
                     "０４", null, undefined, NaN, 4.5, 0, 31, "0x4", "+4"]) {
    assert.equal(parseDays(raw), null, `parseDays(${JSON.stringify(raw)})`);
  }
});

test("leading zeros read as the number they spell", () => {
  assert.equal(parseDays("04"), 4);
  assert.equal(parseDays("030"), 30);
  assert.equal(parseDays("00"), null);
});

test("the presets are all valid, ascending, and include daily, 4 and 30", () => {
  for (const n of PRESETS) assert.equal(parseDays(n), n);
  assert.deepEqual([...PRESETS].sort((a, b) => a - b), PRESETS);
  for (const n of [1, 4, 30]) assert.ok(PRESETS.includes(n));
});

test("the −/+ buttons step one day from what is typed and stay in range", () => {
  assert.equal(stepDays("4", 1, +1), 5);
  assert.equal(stepDays("4", 1, -1), 3);
  assert.equal(stepDays("1", 4, -1), 1);       // never below 1
  assert.equal(stepDays("30", 4, +1), 30);     // never above 30
  assert.equal(stepDays("", 7, +1), 8);        // empty box → step from the saved value
  assert.equal(stepDays("abc", 7, -1), 6);
  assert.equal(stepDays("", null, +1), 2);     // nothing at all → step from 1
  for (let n = 1; n <= 30; n++) {
    for (const d of [-1, +1]) {
      const r = stepDays(String(n), 1, d);
      assert.ok(r >= MIN_DAYS && r <= MAX_DAYS && Number.isInteger(r));
    }
  }
});

test("the interval reads as Slovak a person would write it", () => {
  assert.equal(everyDays(1, "sk"), "každý deň");
  assert.equal(everyDays(2, "sk"), "každé 2 dni");
  assert.equal(everyDays(4, "sk"), "každé 4 dni");
  assert.equal(everyDays(5, "sk"), "každých 5 dní");
  assert.equal(everyDays(30, "sk"), "každých 30 dní");
  assert.equal(everyDays(1, "en"), "every day");
  assert.equal(everyDays(4, "en"), "every 4 days");
});

const editor = readFileSync(new URL("../components/ScrapeCadenceEditor.jsx", import.meta.url), "utf8");
const dataQa = readFileSync(new URL("../pages/DataQA.jsx", import.meta.url), "utf8");

test("the editor reads and writes through the two admin-gated RPCs only", () => {
  assert.match(editor, /rpc\("admin_scrape_cadence", \{\}\)/);
  assert.match(editor, /rpc\("admin_set_scrape_cadence", \{ p_days: parsed \}\)/);
  const calls = [...editor.matchAll(/rpc\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ["admin_scrape_cadence", "admin_set_scrape_cadence"]);
});

test("Save sends only a parsed, changed value", () => {
  assert.match(editor, /const parsed = parseDays\(draft\);/);
  assert.match(editor, /const dirty = parsed != null && parsed !== current;/);
  assert.match(editor, /disabled=\{!dirty \|\| saving\}/);
  assert.match(editor, /if \(!dirty \|\| saving\) return;/);
});

test("the controls the end-to-end check drives keep their handles", () => {
  for (const id of ["scrape-cadence", "scrape-cadence-current", "scrape-cadence-minus", "scrape-cadence-plus",
                    "scrape-cadence-input", "scrape-cadence-save", "scrape-cadence-status",
                    "scrape-cadence-history", "scrape-cadence-invalid", "scrape-cadence-error"]) {
    assert.ok(editor.includes(`data-testid="${id}"`), id);
  }
  assert.ok(editor.includes("data-testid={`scrape-cadence-preset-${n}`}"));
  assert.ok(editor.includes("data-testid={`scrape-cadence-next-${m.market_key}`}"));
});

test("Data Control has the Zber dát tab and renders the editor in it", () => {
  assert.match(dataQa, /import ScrapeCadenceEditor from "\.\.\/components\/ScrapeCadenceEditor";/);
  assert.match(dataQa, /\["cadence", t\("Data collection", "Zber dát"\)\]/);
  assert.match(dataQa, /\{view === "cadence" && <ScrapeCadenceEditor lang=\{lang\} \/>\}/);
  assert.ok(dataQa.includes("data-testid={`dataqa-tab-${k}`}"));
});
