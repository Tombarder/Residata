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
import { statusLabel, statusOptions, STATUS_ORDER } from "./unitStatus.js";

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
