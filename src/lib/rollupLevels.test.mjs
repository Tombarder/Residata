/**
 * The two level→X maps in useData.js must agree, and must not name a dropped view.
 *
 * 🔴 WHY (2026-09-22). `_viewForLevel` offered `market: 'totals_by_market'` and
 * `_filterColForLevel` offered `market: 'market_key'`, for a view that had been
 * DROPPED from the database. The header comment listed it, and the usage example
 * read `useTotals('market', 'sk-ba')` — a view that is gone and a market key
 * retired in the 2026-06-08 unification, in one line.
 *
 * Nothing called the hook that way, so nothing broke. A map that lies is a trap
 * for whoever reads it next, which is the only reason a map exists.
 *
 * This file cannot ask the database whether a view exists — the frontend suite is
 * hermetic and has no credentials. What it CAN do is make the two maps agree, so
 * removing a level halfway leaves a red test instead of a hook that resolves a view
 * name and then has no column to filter it by.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'useData.js'), 'utf8');

/** Keys of a `const NAME = { ... };` object literal in the source. */
function keysOf(name) {
  const m = SRC.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`));
  assert.ok(m, `${name} not found — this guard is reading the wrong file`);
  return [...m[1].matchAll(/^\s*([a-z_]+):/gm)].map((x) => x[1]);
}

test('every rollup level has both a view and a filter column', () => {
  const views = keysOf('_viewForLevel');
  const cols = keysOf('_filterColForLevel');
  assert.ok(views.length >= 5, `only ${views.length} levels found — the parse is wrong`);
  assert.deepEqual(
    views.slice().sort(), cols.slice().sort(),
    'the two level maps disagree. A level with a view and no filter column reads ' +
    'the whole table; a level with a column and no view resolves to undefined and ' +
    'the hook bails with a console warning nobody sees.',
  );
});

test('the dropped market level has not come back', () => {
  const views = keysOf('_viewForLevel');
  assert.ok(!views.includes('market'),
    "level='market' is back in the map, but public.totals_by_market was dropped " +
    'from the database. Market-level figures live in public.market_totals, which ' +
    'is keyed on `country` rather than a market key — a different shape, not a ' +
    'rename, so it does not slot into this table.');
});

test('every level the map offers is one the header documents', () => {
  // The header is what somebody reads before writing a call; if it and the map
  // disagree, one of them sends people somewhere that does not answer.
  for (const level of keysOf('_viewForLevel')) {
    assert.match(SRC, new RegExp(`level='${level}'`),
      `the map offers level='${level}' and the header comment never mentions it`);
  }
});
