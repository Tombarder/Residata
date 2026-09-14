/**
 * Guards for the Stripe billing SAFETY NET (api/stripe.js ?action=reconcile).
 *
 * 🔴 WHY IT EXISTS (2026-09-14). The webhook was the only thing that ever wrote
 * `paid_until`, and the Stripe account's single destination turned out to point
 * at the OTHER product's server — Residata's own endpoint was registered
 * nowhere. Nothing was lost, because there were no subscriptions yet, but the
 * first customer to convert would have been charged and left on the free tier
 * with no process that would ever notice.
 *
 * The wrong URL was the symptom. The defect was having ONE delivery path and no
 * second chance, which is why these tests guard the net rather than the URL.
 *
 * Structural checks against the source, like identity.test.mjs and
 * seoCoverage.test.mjs: api/stripe.js reaches for Stripe and Supabase at call
 * time, so importing it here would test the mocks instead of the file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const STRIPE_API = readFileSync(join(HERE, "..", "..", "api", "stripe.js"), "utf8");
const VERCEL = JSON.parse(readFileSync(join(HERE, "..", "..", "vercel.json"), "utf8"));

/** The body of handleReconcile, so a match cannot come from somewhere else. */
function reconcileBody() {
  const start = STRIPE_API.indexOf("async function handleReconcile(");
  assert.ok(start > 0, "handleReconcile is gone — the safety net was removed");
  const rest = STRIPE_API.slice(start);
  const end = rest.indexOf("\nasync function ", 1);
  const body = end > 0 ? rest.slice(0, end) : rest;
  assert.ok(body.length > 400, "handleReconcile body read as almost nothing — this guard would pass vacuously");
  return body;
}

test("the reconcile action is reachable through the dispatcher", () => {
  assert.match(STRIPE_API, /if \(action === "reconcile"\) return await handleReconcile\(req, res\);/,
    "handleReconcile exists but nothing routes to it, so the cron would get 'unknown action'");
});

test("a daily cron actually calls it — a net nobody runs is not a net", () => {
  const cron = (VERCEL.crons || []).find((c) => String(c.path).includes("action=reconcile"));
  assert.ok(cron, "no cron points at the reconcile action");
  // Vercel Hobby runs cron jobs at most once a day; a finer schedule is rejected
  // at deploy time, which would take the whole deployment down with it.
  assert.match(cron.schedule, /^\d+ \d+ \* \* \*$/,
    `reconcile schedule "${cron.schedule}" is not a plain daily expression`);
});

test("Vercel Hobby limits: 2 crons, and one function file per endpoint", () => {
  assert.ok((VERCEL.crons || []).length <= 2,
    "Hobby allows 2 cron jobs; a third fails the deploy");
  // The reconcile deliberately rides on api/stripe.js instead of getting its own
  // file, because the project sits at exactly 12 of 12 Hobby functions and a
  // thirteenth fails the entire deploy, billing included.
  assert.match(STRIPE_API, /handleReconcile/,
    "reconcile must live inside api/stripe.js, not a new function file");
});

test("terminal subscriptions are skipped, or paid_until creeps forward forever", () => {
  const body = reconcileBody();
  assert.match(body, /TERMINAL/,
    "no terminal-status guard: re-applying a cancelled subscription stamps " +
    "paid_until = now() on EVERY run, so someone who cancelled months ago reads " +
    "as 'paid until today' for ever");
  for (const status of ["canceled", "unpaid", "incomplete_expired"]) {
    assert.ok(body.includes(`"${status}"`), `terminal list no longer covers ${status}`);
  }
  assert.match(body, /TERMINAL\.includes\(sub\.status\)/,
    "the terminal list is declared but never actually used to skip");
});

test("the endpoint refuses anyone who is not Vercel's cron", () => {
  const body = reconcileBody();
  assert.match(body, /CRON_SECRET/, "no shared secret check");
  assert.match(body, /x-vercel-cron/, "no fallback to Vercel's own cron header");
  assert.match(body, /status\(401\)/,
    "an unauthenticated caller must be refused — this endpoint grants paid access");
});

test("a failed reconcile is loud and returns non-200", () => {
  const body = reconcileBody();
  assert.match(body, /console\.error/, "failures must be logged");
  assert.match(body, /failed \? 500 : 200/,
    "a reconcile that fails silently with 200 is the same blind spot it replaces");
});

test("the webhook still fails closed when its secret is missing", () => {
  // Unrelated to the net itself, but it is the other half of the same trust
  // boundary and it is cheap to hold onto: an unsigned body must never be
  // parsed in a deployed environment.
  assert.match(STRIPE_API, /refusing unsigned webhook/,
    "the deployed-env fail-closed branch is gone — a forged POST could grant a subscription");
});
