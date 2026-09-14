/* A unit kind is stored as the scraper's word and READ as a person's.
 * Written after the Unit database printed "flat" and "parking_garage" verbatim into
 * a Slovak page on 2026-09-14. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { unitKindLabel, isHomeUnit, HOME_UNIT_TYPES } from "./unitKinds.js";

test("every kind present in the live catalogue has a label", () => {
  // Measured 2026-09-14 from final.units; parking_outside is in the vocabulary
  // with no project using it yet, and is covered too.
  const live = ["flat", "apartment", "studio", "house", "semi-detached house",
                "retail", "office", "parking", "parking_garage", "parking_outside",
                "storage", "land", "other"];
  for (const k of live) {
    assert.notEqual(unitKindLabel(k, "sk"), k, `no SK label for ${k}`);
    assert.ok(unitKindLabel(k, "en").length > 0, `no EN label for ${k}`);
  }
});

test("an unstated kind on a price list is a flat — the same reading isHomeUnit takes", () => {
  assert.equal(unitKindLabel(null, "sk"), "Byt");
  assert.equal(unitKindLabel("", "en"), "Flat");
  assert.equal(isHomeUnit(null), true);
});

test("apartmán is NOT byt — they are different legal categories here", () => {
  assert.notEqual(unitKindLabel("apartment", "sk"), unitKindLabel("flat", "sk"));
});

test("studio is not called a garsónka", () => {
  // These rows carry 1–2 rooms and 32–64 m²; a garsónka is one room with no
  // separate kitchen, so the word would assert something the data does not say.
  assert.ok(!/garsón/i.test(unitKindLabel("studio", "sk")));
});

test("an UNKNOWN kind comes back unchanged, never blanked", () => {
  assert.equal(unitKindLabel("polyfunkcny", "sk"), "polyfunkcny");
});

test("labelling never changes what counts as a home", () => {
  for (const k of ["parking_garage", "storage", "retail", "office", "land", "other"]) {
    assert.equal(isHomeUnit(k), false, `${k} must never reach a money average`);
  }
  for (const k of HOME_UNIT_TYPES) assert.equal(isHomeUnit(k), true);
});
