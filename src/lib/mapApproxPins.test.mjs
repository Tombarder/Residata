/**
 * Guards for "this pin is a guess" on the map.
 *
 * 🔴 WHY (2026-09-14/15). 201 of 399 active projects sit on
 * location_source='placeholder' — a point dropped somewhere inside the right
 * city rather than at the project. Half the map. They are NOT stacked on one
 * coordinate, so they are scattered across the city and look exactly like a
 * surveyed pin, and nothing in the pin, the popup or the key said otherwise.
 *
 * The coords loader had been selecting `location_verified` since the beginning
 * and then never reading it — the fact was fetched and dropped on the floor.
 *
 * For a product whose pitch is "where the market is", a wrong pin a client can
 * act on is worse than a missing one: they drive to a different street and stop
 * trusting the dataset. Verified against the database the same day —
 * placeholder ↔ location_verified=false is an exact 201/198 correspondence with
 * no mixed cases, and public.project_coords exposes the column with 0 nulls, so
 * `!c.verified` is a clean boolean and cannot silently flag everything.
 *
 * Structural checks against the source: MapView needs a WebGL canvas and a
 * logged-in session, and an automation tab never paints one (see mapHealth.js),
 * so asserting on rendered pixels here would prove nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP = readFileSync(join(HERE, "..", "pages", "MapView.jsx"), "utf8");

test("the fetched location_verified is actually used, not just fetched", () => {
  assert.match(MAP, /location_verified/,
    "the coords query stopped selecting location_verified");
  assert.match(MAP, /approx:\s*!c\.verified/,
    "nothing derives `approx` from the verified flag — the column would be " +
    "fetched and dropped again, which is the original defect");
});

test("an unverified pin is painted differently from a surveyed one", () => {
  // Colour still means AVAILABILITY; position confidence must not steal that
  // channel, so it rides on opacity and the ring.
  assert.match(MAP, /"circle-opacity":\s*\["case",\s*\["get",\s*"approx"\]/,
    "pin opacity no longer distinguishes an approximate position");
  assert.match(MAP, /"circle-stroke-color":\s*\["case",\s*\["get",\s*"approx"\]/,
    "pin ring no longer distinguishes an approximate position");
  assert.match(MAP, /"circle-color":\s*\["case",\s*\["<=",\s*\["get",\s*"available"\]/,
    "colour must keep meaning availability — approximate-ness belongs elsewhere");
});

test("the popup says it in words, in both languages", () => {
  assert.match(MAP, /props\.approx/,
    "the popup no longer checks whether the position is a guess");
  assert.match(MAP, /Poloha je približná/, "Slovak wording is gone");
  assert.match(MAP, /Approximate location/, "English wording is gone");
});

test("a project opened from SEARCH carries the same warning as a clicked pin", () => {
  // Two call sites render the same popup. The search one builds its props
  // separately, so it is exactly where the flag goes missing unnoticed.
  const calls = [...MAP.matchAll(/showProjectPopup\(/g)];
  assert.ok(calls.length >= 2, "expected the pin-click and search-select call sites");
  const spread = [...MAP.matchAll(/\{\s*\.\.\.projectProps\(p\),\s*approx:\s*!c\.verified\s*\}/g)];
  assert.ok(spread.length >= 1,
    "search-select passes bare projectProps(), so a searched project would lose " +
    "the warning that its position is approximate");
});

test("the key explains the faded dot", () => {
  assert.match(MAP, /približná poloha/, "Slovak legend entry is gone");
  assert.match(MAP, /approximate location/, "English legend entry is gone");
  assert.match(MAP, /function Dot\(\{ color, faded/,
    "Dot lost its faded variant, so the key would no longer match the real pin");
});
