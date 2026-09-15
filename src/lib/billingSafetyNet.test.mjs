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
  // 2026-09-15: this used to require exactly the two things that turned out to
  // be the hole. It accepted `x-vercel-cron` as a FALLBACK when CRON_SECRET was
  // unset — and it was unset, so a header sent by hand from a laptop got a 200
  // out of production. The auth now lives in api/_lib/cronAuth.js, shared with
  // the monthly-reports cron and tested for real in cronAuth.test.mjs; what
  // belongs here is only that this endpoint goes through it before doing work.
  const body = reconcileBody();
  assert.match(body, /rejectIfNotCron\(req, res/,
    "the reconcile no longer authenticates through the shared cron door");
  const firstWork = Math.min(
    ...["getStripe()", "getSupabaseAdmin()"].map((n) => {
      const i = body.indexOf(n);
      return i < 0 ? Number.POSITIVE_INFINITY : i;
    })
  );
  assert.ok(Number.isFinite(firstWork), "the handler no longer reaches Stripe or Supabase at all");
  assert.ok(body.indexOf("rejectIfNotCron(req, res") < firstWork,
    "auth must run BEFORE Stripe or Supabase are touched — otherwise an unauthenticated " +
    "caller still costs us the API calls the 401 was meant to prevent");
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

/**
 * 🔴 A CRON GETS. (2026-09-15, the day the net was found never to have run.)
 *
 * The tests above proved the reconcile was routed and scheduled, and it was
 * both — yet every 04:00 invocation since it shipped came back 405, because the
 * handler opened with a blanket `req.method !== "POST"` and Vercel calls a
 * scheduled job with a plain GET. Routed + scheduled + unreachable is exactly
 * the shape a guard is supposed to catch, so the guard now also reads the door.
 *
 * It derives the actions from vercel.json rather than naming "reconcile", so a
 * second cron action added later is covered the day it is added.
 */
function methodsTable() {
  const start = STRIPE_API.indexOf("const METHODS = {");
  assert.ok(start > 0, "the per-action method table is gone — a blanket method gate is back");
  const body = STRIPE_API.slice(start, STRIPE_API.indexOf("};", start));
  assert.ok(body.length > 60, "METHODS read as almost nothing — this guard would pass vacuously");
  const table = {};
  for (const m of body.matchAll(/["']?([a-z-]+)["']?\s*:\s*\[([^\]]*)\]/g)) {
    table[m[1]] = [...m[2].matchAll(/["']([A-Z]+)["']/g)].map((x) => x[1]);
  }
  return table;
}

test("every cron that calls this endpoint is allowed the method a cron uses", () => {
  const table = methodsTable();
  const stripeCrons = (VERCEL.crons || []).filter((c) => String(c.path).startsWith("/api/stripe"));
  assert.ok(stripeCrons.length >= 1, "no cron points at /api/stripe — billingSafetyNet reads nothing");

  for (const c of stripeCrons) {
    const action = new URLSearchParams(String(c.path).split("?")[1] || "").get("action");
    assert.ok(action, `cron path "${c.path}" carries no ?action=`);
    assert.ok(table[action],
      `cron calls ?action=${action} but METHODS does not list that action, so the ` +
      `dispatcher answers 400 "unknown action" every night`);
    assert.ok(table[action].includes("GET"),
      `cron calls ?action=${action} but it only accepts ${table[action].join("/")}. ` +
      `Vercel invokes a scheduled job with GET, so this job answers 405 before its ` +
      `auth check — which is how the reconcile ran zero times between 2026-09-14 and 15.`);
  }
});

test("the browser-driven actions stay POST-only", () => {
  // The fix widened one door; it must not have widened the others. A GET that
  // starts a Checkout Session or writes a price is a CSRF hole.
  const table = methodsTable();
  for (const action of ["checkout", "portal", "set-price", "webhook"]) {
    assert.deepEqual(table[action], ["POST"],
      `${action} must stay POST-only — it is reached from a browser or from Stripe, never a cron`);
  }
});

test("an unknown action is rejected before any handler runs", () => {
  assert.match(STRIPE_API, /const allowed = METHODS\[action\];/,
    "the dispatcher no longer decides from the table");
  assert.match(STRIPE_API, /if \(!allowed\) return res\.status\(400\)/,
    "an action missing from the table must 400, not fall through to a handler");
});
