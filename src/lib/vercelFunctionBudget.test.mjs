/**
 * The Hobby plan allows twelve serverless functions. We have twelve.
 *
 * 🔴 WHY THIS TEST EXISTS (2026-09-22). The limit was known — it is written into
 * billingSafetyNet.test.mjs, which is why /api/stripe?action=reconcile rides
 * inside stripe.js instead of getting its own file — but nothing COUNTED. That
 * test asserts the reconcile is not a separate function; it says nothing about
 * the twelve. Add a thirteenth endpoint anywhere else and every test passes, the
 * push is green, and the DEPLOY fails: not the new endpoint, the whole project,
 * billing webhooks included.
 *
 * A limit everybody knows about and nothing enforces is a limit you find out
 * about from a broken deploy. This turns it into a red test on the laptop.
 *
 * WHAT VERCEL COUNTS: every .js under api/, except paths beginning with an
 * underscore — those are shared libraries, not endpoints. Measured 2026-09-22:
 * 12 functions and 5 shared libs under api/_lib.
 *
 * If you genuinely need a thirteenth endpoint, the options are to fold it into
 * an existing handler behind an `action` parameter (what the reconcile does), or
 * to move to a paid plan. Raising the number in this file is not one of them —
 * the platform will refuse the deploy whatever this file says.
 */
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = path.join(ROOT, 'api');

/** Every file Vercel would turn into a serverless function. */
function functionFiles(dir = API, prefix = 'api') {
  const out = [];
  for (const name of readdirSync(dir)) {
    // Vercel ignores anything whose path segment starts with an underscore.
    if (name.startsWith('_')) continue;
    const full = path.join(dir, name);
    const rel = `${prefix}/${name}`;
    if (statSync(full).isDirectory()) out.push(...functionFiles(full, rel));
    else if (name.endsWith('.js')) out.push(rel);
  }
  return out;
}

const HOBBY_FUNCTION_LIMIT = 12;

test('the project fits inside the Hobby serverless-function budget', () => {
  const fns = functionFiles().sort();
  assert.ok(
    fns.length <= HOBBY_FUNCTION_LIMIT,
    `${fns.length} serverless functions, and Hobby allows ${HOBBY_FUNCTION_LIMIT}. ` +
    'The deploy will fail — the WHOLE project, not just the new endpoint, so the ' +
    'Stripe webhook goes down with it. Fold the new endpoint into an existing ' +
    `handler behind an action parameter, the way api/stripe.js carries reconcile.\n${fns.join('\n')}`,
  );
});

test('the count is discovered, so this test cannot pass by being out of date', () => {
  const fns = functionFiles();
  assert.ok(fns.length > 0, 'found no functions under api/ — the discovery is broken, ' +
    'and a guard that finds nothing passes forever');
  assert.ok(fns.includes('api/stripe.js'), 'api/stripe.js is missing from the scan');
  assert.ok(fns.includes('api/cron/monthly-reports.js'), 'nested endpoints are not being scanned');
});

test('shared libraries under api/_lib are not counted as functions', () => {
  // If they ever were, the project would read as over budget and somebody would
  // "fix" it by deleting a library that several endpoints import.
  const fns = functionFiles();
  assert.ok(!fns.some((f) => f.includes('/_')),
    `an underscore path was counted as a function: ${fns.filter((f) => f.includes('/_')).join(', ')}`);
});
