/**
 * The door every scheduled job shares — api/_lib/cronAuth.js.
 *
 * 🔴 WHY (2026-09-15). Two cron endpoints, each deciding for itself what counts
 * as a genuine cron, were each wrong in the opposite direction:
 *
 *   • /api/stripe?action=reconcile accepted `x-vercel-cron: 1` whenever
 *     CRON_SECRET was unset — and it was unset. A header sent by hand from a
 *     laptop reached the handler and got a 200, so the nightly billing net was
 *     callable by anyone. (Our own audit note claimed Vercel strips that header
 *     from client requests. It does not; nobody had tried it.)
 *
 *   • /api/cron/monthly-reports resolved CRON_SECRET through a fallback that
 *     also reads public.app_secrets, where a 64-character value happened to
 *     live. Vercel only signs a cron request when the variable is in the
 *     project ENV, so the endpoint demanded a token no cron could present and
 *     refused itself every month since April.
 *
 * Unlike the other guards in this folder, this file imports the real module and
 * exercises it: cronAuth has no Stripe or Supabase dependency, so there is
 * nothing to mock and nothing to fake the result.
 */
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { rejectIfNotCron } from "../../api/_lib/cronAuth.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const VERCEL = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));

/** Minimal res double: records what the handler answered. */
function fakeRes() {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
}
const reqWith = (headers) => ({ headers });

/**
 * Source with comments stripped. These files EXPLAIN the defect in prose —
 * "x-vercel-cron", "app_secrets" — so a plain substring search would flag the
 * explanation and force the comment out. What matters is whether the code
 * still does it.
 */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const ORIGINAL = process.env.CRON_SECRET;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL;
});

/** Swallow the deliberate console.error so the run stays readable. */
function quiet(fn) {
  const real = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = real; }
}

test("the right bearer token gets in", () => {
  process.env.CRON_SECRET = "s3cret-value";
  const res = fakeRes();
  assert.equal(rejectIfNotCron(reqWith({ authorization: "Bearer s3cret-value" }), res), false);
  assert.equal(res.code, null, "a genuine cron must not be answered at the door");
});

test("x-vercel-cron alone is refused — it is sendable by anyone", () => {
  process.env.CRON_SECRET = "s3cret-value";
  const res = fakeRes();
  assert.equal(rejectIfNotCron(reqWith({ "x-vercel-cron": "1" }), res), true);
  assert.equal(res.code, 401);
});

test("a wrong or absent token is refused", () => {
  process.env.CRON_SECRET = "s3cret-value";
  for (const headers of [{}, { authorization: "Bearer wrong" }, { authorization: "s3cret-value" }]) {
    const res = fakeRes();
    assert.equal(rejectIfNotCron(reqWith(headers), res), true, JSON.stringify(headers));
    assert.equal(res.code, 401);
  }
});

test("no CRON_SECRET means NOBODY gets in, including a spoofed cron header", () => {
  delete process.env.CRON_SECRET;
  const res = fakeRes();
  quiet(() => assert.equal(rejectIfNotCron(reqWith({ "x-vercel-cron": "1" }), res), true));
  assert.equal(res.code, 401, "fail OPEN here is how the reconcile became world-callable");
});

test("a missing CRON_SECRET is logged as its own event, naming the cause", () => {
  delete process.env.CRON_SECRET;
  const lines = [];
  const real = console.error;
  console.error = (...a) => lines.push(a.join(" "));
  try { rejectIfNotCron(reqWith({}), fakeRes(), "some-job"); } finally { console.error = real; }
  const msg = lines.join("\n");
  assert.match(msg, /CRON_SECRET/, "the log must name the variable that is missing");
  assert.match(msg, /INERT/i, "silently 401ing every night is how both of these hid for months");
  assert.match(msg, /some-job/, "the label must say which job is inert");
});

test("the token is compared in constant time", () => {
  const src = readFileSync(join(ROOT, "api", "_lib", "cronAuth.js"), "utf8");
  assert.match(src, /timingSafeEqual/,
    "a plain === on a shared secret leaks its prefix through response timing");
  assert.match(src, /x\.length === y\.length/,
    "timingSafeEqual throws on unequal lengths — the guard against that is gone");
});

test("the environment is the ONLY place the secret is read from", () => {
  const src = readFileSync(join(ROOT, "api", "_lib", "cronAuth.js"), "utf8");
  assert.match(src, /process\.env\.CRON_SECRET/);
  assert.ok(!/app_secrets/.test(codeOnly(src)),
    "a secret in the database is one Vercel cannot sign with — reading it there is " +
    "what made the monthly report refuse its own cron");
});

test("every scheduled endpoint goes through this one door", () => {
  const crons = VERCEL.crons || [];
  assert.ok(crons.length >= 1, "no crons in vercel.json — this guard would read nothing");
  for (const c of crons) {
    const file = join(ROOT, String(c.path).split("?")[0].replace(/^\//, "") + ".js");
    const src = readFileSync(file, "utf8");
    assert.match(src, /rejectIfNotCron\(/,
      `${c.path} does not use the shared cron auth, so it decides for itself what a ` +
      `cron is — which is exactly how the two endpoints ended up wrong in opposite ways`);
    // assert.ok, not doesNotMatch: a failing doesNotMatch on a 30 000-character
    // file prints the whole file into the report.
    assert.ok(!/x-vercel-cron/.test(codeOnly(src)),
      `${c.path} still READS x-vercel-cron; that header is sendable by anyone and was ` +
      `measured getting a 200 in production on 2026-09-15`);
  }
});
