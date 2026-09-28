/* unitStatus — pins the wording the three pages produced BEFORE they were unified,
 * so the refactor is provably a no-op and cannot drift back apart.
 *
 * The originals, verbatim from git history on 2026-09-14:
 *   UnitTracker: V:["Voľný","Available"] R:["Rezervovaný","Reserved"]
 *                PR:["Predrezervovaný","Pre-reserved"] P:["Predaný","Sold"]
 *                "Ešte nie v ponuke":[…] ERROR:["Chyba","Error"]
 *   DataQA:      V "Voľné"/"Available"  P "Predané"/"Sold"
 *                R "Rezervované"/"Reserved"  PR "Predrezerv."/"Pre-reserved"
 *   LivePages:   V "Voľné"  P "Predané"  R "Rezervované"  N "Ešte nie v ponuke"
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { statusLabel, statusOptions, STATUS_ORDER, listingStatus, OFF_LIST } from "./unitStatus.js";

test("the SINGULAR form is what UnitTracker showed for one flat", () => {
  const sk = (c) => statusLabel(c, "sk", "one");
  assert.equal(sk("V"), "Voľný");
  assert.equal(sk("R"), "Rezervovaný");
  assert.equal(sk("PR"), "Predrezervovaný");
  assert.equal(sk("P"), "Predaný");
  assert.equal(sk("Ešte nie v ponuke"), "Ešte nie v ponuke");
  assert.equal(sk("ERROR"), "Chyba");
  assert.equal(statusLabel("V", "en", "one"), "Available");
  assert.equal(statusLabel("ERROR", "en", "one"), "Error");
});

test("the COLLECTIVE form is what DataQA and the map legend showed for counts", () => {
  const sk = (c) => statusLabel(c, "sk", "many");
  assert.equal(sk("V"), "Voľné");
  assert.equal(sk("P"), "Predané");
  assert.equal(sk("R"), "Rezervované");
  assert.equal(sk("Ešte nie v ponuke"), "Ešte nie v ponuke");
  assert.equal(statusLabel("P", "en", "many"), "Sold");
});

test("singular and collective genuinely differ — that is the point of two forms", () => {
  assert.notEqual(statusLabel("V", "sk", "one"), statusLabel("V", "sk", "many"));
  assert.notEqual(statusLabel("P", "sk", "one"), statusLabel("P", "sk", "many"));
});

test("an unknown code comes back UNCHANGED, never blanked or guessed", () => {
  // A status nobody has seen is a data question; hiding it is how it stays unseen.
  assert.equal(statusLabel("X", "sk", "one"), "X");
  assert.equal(statusLabel("", "sk"), "");
});

test("display order puts available first and sold last", () => {
  assert.deepEqual(STATUS_ORDER.slice(0, 4), ["V", "R", "PR", "P"]);
  assert.deepEqual(statusOptions("sk", "many", ["V", "P"]),
    [{ value: "V", label: "Voľné" }, { value: "P", label: "Predané" }]);
});

test("the status shown is the one the database decided — stav, never re-derived here", () => {
  // project_units_series for Tesla Hloubětín, 2026-09-28: gone from the list, last seen
  // "Voľný", ledger SOLD → the server answers stav "P" and keeps the old one beside it.
  assert.equal(listingStatus({ stav: "P", last_seen_stav: "V", on_price_list: false, ledger_status: "SOLD" }), "P");
  assert.equal(listingStatus({ stav: OFF_LIST, last_seen_stav: "R", on_price_list: false }), OFF_LIST);
  assert.equal(listingStatus({ stav: "V", last_seen_stav: "V", on_price_list: true }), "V");
});

test("a row straight from the current price list falls back to latest_stav", () => {
  // unit_search reads flats_current: every row is listed, so its status IS today's
  assert.equal(listingStatus({ latest_stav: "R" }), "R");
  assert.equal(listingStatus({ stav: "PR", latest_stav: "V" }), "PR");   // stav wins
  assert.equal(listingStatus(null), null);
  assert.equal(listingStatus({}), null);
});

test("the off-list code is the database's own, and it has a label", () => {
  // reference.listing_stav returns exactly 'OFF_LIST' — a different spelling here would
  // show the raw code to the reader instead of the words
  assert.equal(OFF_LIST, "OFF_LIST");
  assert.equal(statusLabel(OFF_LIST, "sk", "one"), "Mimo cenníka");
  assert.equal(statusLabel(OFF_LIST, "en", "one"), "Off the price list");
  assert.ok(!STATUS_ORDER.includes(OFF_LIST));
});

test("no page reads a flat's last-seen status except through listingStatus", async () => {
  // latest_stav from the history cache is the stale one for a flat that left the list.
  // The only place allowed to read it is listingStatus (the fallback for current-list
  // rows); anything else displaying it would show a sold flat as available again.
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join } = await import("node:path");
  const root = new URL("..", import.meta.url).pathname;
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (!/\.(jsx?|mjs)$/.test(name) || /\.test\.mjs$/.test(name)) continue;
      if (p.endsWith("lib/unitStatus.js") || p.endsWith("lib/useData.js")) continue;
      const src = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      if (/\blatest_stav\b/.test(src)) hits.push(p.slice(root.length));
    }
  };
  walk(root);
  assert.deepEqual(hits, []);
});
