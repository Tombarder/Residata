// The card-payment paths, run through the REAL handlers with Stripe and the
// database simulated in memory.
//
// Why this exists (2026-10-07, launch day): every money decision was covered by
// unit tests of the rules (adminUsers.cardSubscriptionVerdict, access.js), but
// the handlers that wire Stripe's events to a customer's access had never run as
// a whole outside production — and production had no card customers yet. The
// first one to subscribe would have been the first test. Writing these found
// three defects in applySubscription/handleCheckout:
//   · cancelling a DUPLICATE subscription (the double-charge refund) cut off the
//     customer the other subscription still paid for;
//   · an ending subscription wiped Premium it never gave (an admin gift longer
//     than the card, a first payment that never went through, a late "deleted"
//     re-delivered after the admin had moved the person to a gift);
//   · a blocked account could still open checkout and pay for nothing.
//
// Only the two outside libraries are replaced ("stripe", "@supabase/supabase-js");
// every line of api/stripe.js, api/_lib/stripe.js, api/admin/set-subscription.js
// and api/admin/delete-user.js runs as deployed. Needs
// --experimental-test-module-mocks (package.json "test").

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { resolveAccess } from "./access.js";

// ── simulated Stripe ─────────────────────────────────────────────────────
const ST = { subs: new Map(), calls: [], sessions: [], failCancel: false, failRetrieve: false };
const stripeError = (message, code) => Object.assign(new Error(message), { code });
const copy = (o) => JSON.parse(JSON.stringify(o));
class FakeStripe {
  constructor() {
    this.subscriptions = {
      retrieve: async (id) => {
        ST.calls.push(["retrieve", id]);
        if (ST.failRetrieve) throw stripeError("Stripe is unreachable", "api_error");
        const s = ST.subs.get(id);
        if (!s) throw stripeError(`No such subscription: '${id}'`, "resource_missing");
        return copy(s);
      },
      cancel: async (id) => {
        ST.calls.push(["cancel", id]);
        if (ST.failCancel) throw stripeError("Stripe is unreachable", "api_error");
        const s = ST.subs.get(id);
        s.status = "canceled";
        return copy(s);
      },
      // Awaitable (one page) AND async-iterable (auto-pagination), like the SDK.
      list: (params = {}) => {
        const data = [...ST.subs.values()]
          .filter((s) => !params.customer || s.customer === params.customer)
          .filter((s) => !params.status || params.status === "all" || s.status === params.status)
          .map(copy);
        const page = { object: "list", data, has_more: false };
        return {
          then: (ok, bad) => Promise.resolve(page).then(ok, bad),
          async *[Symbol.asyncIterator]() { yield* data; },
        };
      },
    };
    this.checkout = { sessions: { create: async (params, opts) => {
      ST.sessions.push({ params, opts });
      return { id: "cs_test_1", url: "https://checkout.stripe.test/cs_test_1" };
    } } };
    this.customers = {
      retrieve: async (id) => ({ id, metadata: {} }),
      update: async (id) => ({ id }),
    };
    this.billingPortal = { sessions: { create: async () => ({ url: "https://billing.stripe.test/p" }) } };
    this.webhooks = { constructEvent: (raw, sig) => {
      if (sig !== "t=1,v1=valid") throw new Error("No signatures found matching the expected signature for payload");
      return JSON.parse(raw.toString("utf8"));
    } };
  }
}

// ── simulated database ───────────────────────────────────────────────────
const DB = { tables: {}, tokens: {}, rpc: [], deleted: [], fail: null };
const rows = (t) => (DB.tables[t] ||= []);
function query(table) {
  let op = "select", values = null, single = false, returning = false;
  const filters = [];
  const q = {
    select() { if (op !== "select") returning = true; return q; },
    insert(v) { op = "insert"; values = v; return q; },
    update(v) { op = "update"; values = v; return q; },
    delete() { op = "delete"; return q; },
    eq(c, v) { filters.push((r) => r[c] === v); return q; },
    is(c, v) { filters.push((r) => (r[c] ?? null) === v); return q; },
    in(c, a) { filters.push((r) => a.includes(r[c])); return q; },
    like(c, p) {
      const re = new RegExp("^" + p.split("%").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
      filters.push((r) => re.test(String(r[c] ?? "")));
      return q;
    },
    order() { return q; },
    limit() { return q; },
    maybeSingle() { single = true; return q; },
    single() { single = true; return q; },
    then(ok, bad) { return Promise.resolve().then(run).then(ok, bad); },
  };
  function run() {
    if (DB.fail?.(table, op)) return { data: null, error: { message: `forced ${op} failure on ${table}` } };
    const all = rows(table);
    const hit = all.filter((r) => filters.every((f) => f(r)));
    let data = null;
    if (op === "select") data = hit.map((r) => ({ ...r }));
    else if (op === "update") { hit.forEach((r) => Object.assign(r, values)); if (returning) data = hit.map((r) => ({ ...r })); }
    else if (op === "delete") DB.tables[table] = all.filter((r) => !hit.includes(r));
    else if (op === "insert") all.push(...(Array.isArray(values) ? values : [values]).map((v) => ({ ...v })));
    if (single) data = Array.isArray(data) ? (data[0] ?? null) : data;
    return { data, error: null };
  }
  return q;
}
const createClient = () => ({
  from: query,
  rpc: async (fn, args) => { DB.rpc.push({ fn, args }); return { data: null, error: null }; },
  storage: { from: () => ({ remove: async () => ({ data: [], error: null }), list: async () => ({ data: [], error: null }) }) },
  auth: {
    getUser: async (token) => (DB.tokens[token]
      ? { data: { user: DB.tokens[token] }, error: null }
      : { data: { user: null }, error: { message: "invalid JWT" } }),
    admin: { deleteUser: async (id) => {
      DB.tables.user_profiles = rows("user_profiles").filter((r) => r.id !== id);
      DB.deleted.push(id);
      return { data: {}, error: null };
    } },
  },
});

mock.module("stripe", { defaultExport: FakeStripe });
mock.module("@supabase/supabase-js", { namedExports: { createClient } });
Object.assign(process.env, {
  SUPABASE_URL: "https://db.test", SUPABASE_SECRET_KEY: "service-test",
  STRIPE_SECRET_KEY: "sk_test_simulated", STRIPE_WEBHOOK_SECRET: "whsec_simulated", CRON_SECRET: "cron-test",
});
globalThis.fetch = async () => { throw new Error("no network in tests"); };   // e-mails fail quietly, never send
for (const k of ["log", "warn", "error"]) mock.method(console, k, () => {});

const stripeApi = (await import("../../api/stripe.js")).default;
const setSubscription = (await import("../../api/admin/set-subscription.js")).default;
const deleteUser = (await import("../../api/admin/delete-user.js")).default;

// ── helpers ──────────────────────────────────────────────────────────────
const NOW = Date.now();
const DAY = 86400000;
const unix = (ms) => Math.floor(ms / 1000);
const isoAt = (ms) => new Date(unix(ms) * 1000).toISOString();
const U = "11111111-1111-1111-1111-111111111111";
const ADMIN = "99999999-9999-9999-9999-999999999999";

function call(handler, { method = "POST", query = {}, headers = {}, body } = {}) {
  const raw = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const req = Readable.from([Buffer.from(raw)]);
  Object.assign(req, { method, query, body, headers: { origin: "https://residata.eu", ...headers } });
  const res = {
    statusCode: 200, body: undefined, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    end() { return this; },
  };
  return Promise.resolve(handler(req, res)).then(() => res);
}
const webhook = (type, object, sig = "t=1,v1=valid") =>
  call(stripeApi, { query: { action: "webhook" }, headers: { "stripe-signature": sig }, body: { id: "evt_1", type, data: { object } } });
const asUser = (id, token = `tok-${id}`) => { DB.tokens[token] = { id, email: `${id.slice(0, 4)}@firma.sk` }; return { authorization: `Bearer ${token}` }; };

function person(id, fields = {}) {
  const row = {
    id, email: `${id.slice(0, 4)}@firma.sk`, full_name: "Eva Malá", company: "Firma", tier: "free",
    profile_completed: true, paid_until: null, paid_started_at: null, paid_pause_started: null,
    trial_until: null, stripe_customer_id: null, stripe_subscription_id: null, ...fields,
  };
  rows("user_profiles").push(row);
  return row;
}
const profile = (id) => rows("user_profiles").find((r) => r.id === id);
function sub(id, { user = U, customer = "cus_1", status = "active", periodEnd = NOW + 30 * DAY, ...rest } = {}) {
  const s = {
    id, object: "subscription", customer, status, metadata: { supabase_user_id: user },
    items: { data: [{ current_period_end: unix(periodEnd) }] },
    cancel_at_period_end: false, cancel_at: null, ...rest,
  };
  ST.subs.set(id, s);
  return s;
}
const premium = (id) => resolveAccess(profile(id).tier, profile(id), Date.now()).paidActive;
const checkoutCompleted = (subId, user = U) => webhook("checkout.session.completed", {
  id: "cs_test_1", object: "checkout.session", mode: "subscription", subscription: subId,
  client_reference_id: user, customer: "cus_1",
  customer_details: { name: "Firma s.r.o.", address: { country: "SK" }, tax_ids: [] }, custom_fields: [],
});

beforeEach(() => {
  ST.subs.clear(); ST.calls.length = 0; ST.sessions.length = 0; ST.failCancel = false; ST.failRetrieve = false;
  DB.tables = {}; DB.tokens = {}; DB.rpc = []; DB.deleted = []; DB.fail = null;
});

// ── paying ───────────────────────────────────────────────────────────────

test("a new card payer gets Premium to the end of the month they paid for", async () => {
  person(U);
  sub("sub_1", { periodEnd: NOW + 30 * DAY });
  const r = await checkoutCompleted("sub_1");
  assert.equal(r.statusCode, 200);
  const p = profile(U);
  assert.equal(p.tier, "paid");
  assert.equal(p.paid_until, isoAt(NOW + 30 * DAY));
  assert.equal(p.stripe_subscription_id, "sub_1");
  assert.equal(p.stripe_customer_id, "cus_1");
  assert.ok(p.paid_started_at, "Premium-from is stamped");
  assert.ok(premium(U));
});

test("a forged webhook changes nothing", async () => {
  person(U);
  sub("sub_1");
  const r = await webhook("customer.subscription.updated", ST.subs.get("sub_1"), "t=1,v1=forged");
  assert.equal(r.statusCode, 400);
  assert.equal(profile(U).tier, "free");
  assert.equal(profile(U).paid_until, null);
});

test("a repeated or out-of-order event never shortens Premium", async () => {
  person(U);
  sub("sub_1", { periodEnd: NOW + 30 * DAY });
  await checkoutCompleted("sub_1");
  await webhook("customer.subscription.updated", { ...ST.subs.get("sub_1"), items: { data: [{ current_period_end: unix(NOW + 2 * DAY) }] } });
  assert.equal(profile(U).paid_until, isoAt(NOW + 30 * DAY));
});

test("a renewal moves the end forward; a failing renewal does not hand out a free month", async () => {
  person(U);
  sub("sub_1", { periodEnd: NOW + 2 * DAY });
  await checkoutCompleted("sub_1");
  // Renewal paid: Stripe advances the period, invoice.paid arrives (subscription under `parent`).
  ST.subs.get("sub_1").items.data[0].current_period_end = unix(NOW + 32 * DAY);
  await webhook("invoice.paid", { id: "in_1", object: "invoice", parent: { subscription_details: { subscription: "sub_1" } } });
  assert.equal(profile(U).paid_until, isoAt(NOW + 32 * DAY));
  // Next renewal fails: past_due with the NEXT (unpaid) period end — must not extend.
  Object.assign(ST.subs.get("sub_1"), { status: "past_due", items: { data: [{ current_period_end: unix(NOW + 62 * DAY) }] } });
  await webhook("customer.subscription.updated", ST.subs.get("sub_1"));
  assert.equal(profile(U).paid_until, isoAt(NOW + 32 * DAY));
});

test("cancelled in the portal: Premium runs to the end of the month, Billing says when, then it stops", async () => {
  person(U);
  sub("sub_1", { periodEnd: NOW + 20 * DAY });
  await checkoutCompleted("sub_1");
  Object.assign(ST.subs.get("sub_1"), { cancel_at_period_end: true });
  await webhook("customer.subscription.updated", ST.subs.get("sub_1"));
  assert.equal(profile(U).paid_until, isoAt(NOW + 20 * DAY), "still paid for until the period ends");
  const st = await call(stripeApi, { query: { action: "subscription" }, headers: asUser(U) });
  assert.equal(st.statusCode, 200);
  assert.deepEqual(st.body.subscription, { status: "active", ends_at: isoAt(NOW + 20 * DAY) });
  // The period ends: Stripe deletes the subscription.
  Object.assign(ST.subs.get("sub_1"), { status: "canceled" });
  await webhook("customer.subscription.deleted", ST.subs.get("sub_1"));
  assert.equal(profile(U).stripe_subscription_id, null);
  assert.ok(Date.parse(profile(U).paid_until) <= Date.now());
  assert.equal(premium(U), false);
});

// ── ending only what it gave ─────────────────────────────────────────────

test("cancelling a duplicate subscription leaves the one that pays alone — and the other way round access follows it", async () => {
  person(U);
  sub("sub_1", { periodEnd: NOW + 25 * DAY });
  sub("sub_2", { periodEnd: NOW + 28 * DAY });
  await checkoutCompleted("sub_1");
  await checkoutCompleted("sub_2");                 // the double charge
  assert.equal(profile(U).stripe_subscription_id, "sub_2");
  // Support refunds and cancels the FIRST one.
  ST.subs.get("sub_1").status = "canceled";
  await webhook("customer.subscription.deleted", ST.subs.get("sub_1"));
  assert.equal(profile(U).stripe_subscription_id, "sub_2");
  assert.equal(profile(U).paid_until, isoAt(NOW + 28 * DAY));
  assert.ok(premium(U));
  // Had support cancelled the one on file instead, the other still pays → access follows it.
  ST.subs.get("sub_1").status = "active";
  ST.subs.get("sub_2").status = "canceled";
  await webhook("customer.subscription.deleted", ST.subs.get("sub_2"));
  assert.equal(profile(U).stripe_subscription_id, "sub_1");
  assert.ok(premium(U), "no gap until the nightly reconcile");
});

test("a 'deleted' re-delivered after the admin moved the person to a gift does not wipe the gift", async () => {
  person(U, { tier: "paid", paid_until: isoAt(NOW + 60 * DAY), stripe_customer_id: "cus_1", stripe_subscription_id: null });
  sub("sub_1", { status: "canceled", periodEnd: NOW + 10 * DAY });
  await webhook("customer.subscription.deleted", ST.subs.get("sub_1"));
  assert.equal(profile(U).paid_until, isoAt(NOW + 60 * DAY));
  assert.ok(premium(U));
});

test("a gift longer than the card is not cut short when the card ends", async () => {
  person(U, { tier: "paid", paid_until: isoAt(NOW + 90 * DAY), paid_started_at: isoAt(NOW - 5 * DAY) });
  sub("sub_3", { periodEnd: NOW + 30 * DAY });
  await checkoutCompleted("sub_3");
  assert.equal(profile(U).paid_until, isoAt(NOW + 90 * DAY), "the longer end stays");
  ST.subs.get("sub_3").status = "canceled";
  await webhook("customer.subscription.deleted", ST.subs.get("sub_3"));
  assert.equal(profile(U).paid_until, isoAt(NOW + 90 * DAY));
  assert.equal(profile(U).stripe_subscription_id, null);
  assert.ok(premium(U));
});

test("a first payment that never went through takes nothing away", async () => {
  person(U, { tier: "paid", paid_until: isoAt(NOW + 20 * DAY) });
  sub("sub_4", { status: "incomplete", periodEnd: NOW + 30 * DAY });
  await webhook("customer.subscription.created", ST.subs.get("sub_4"));
  ST.subs.get("sub_4").status = "incomplete_expired";
  await webhook("customer.subscription.updated", ST.subs.get("sub_4"));
  assert.equal(profile(U).paid_until, isoAt(NOW + 20 * DAY));
  assert.ok(premium(U));
});

// ── who may pay ──────────────────────────────────────────────────────────

test("a blocked account cannot pay, and a payment event does not unblock it", async () => {
  person(U, { tier: "pending" });
  const r = await call(stripeApi, { query: { action: "checkout" }, headers: asUser(U) });
  assert.equal(r.statusCode, 403);
  assert.equal(r.body.error, "account_blocked");
  assert.equal(ST.sessions.length, 0, "no checkout session was opened");
  sub("sub_1");
  await webhook("customer.subscription.updated", ST.subs.get("sub_1"));
  assert.equal(profile(U).tier, "pending");
  assert.equal(profile(U).paid_until, null);
});

test("checkout refuses a second subscription — also while a renewal is failing — and Premium without an end", async () => {
  person(U, { tier: "paid", paid_until: isoAt(NOW + 5 * DAY), stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  const pay = () => call(stripeApi, { query: { action: "checkout" }, headers: asUser(U) });
  sub("sub_1", { status: "active" });
  assert.equal((await pay()).body.error, "already subscribed");
  ST.subs.get("sub_1").status = "past_due";
  profile(U).paid_until = isoAt(NOW - DAY);          // the date has passed, Stripe is still retrying
  assert.equal((await pay()).body.error, "already subscribed");
  ST.subs.get("sub_1").status = "canceled";
  const ok = await pay();
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.url, "https://checkout.stripe.test/cs_test_1");
  const { params, opts } = ST.sessions[0];
  assert.equal(params.customer, "cus_1", "a returning subscriber keeps their Stripe customer");
  assert.equal(params.client_reference_id, U);
  assert.match(params.success_url, /\/app\/billing\?checkout=success/);
  assert.equal(params.line_items[0].price_data.product_data.name, "Residata Premium");
  assert.match(opts.idempotencyKey, new RegExp(`^checkout:${U}:`));
  for (const fields of [{ tier: "admin" }, { tier: "paid", paid_until: null, stripe_subscription_id: null }]) {
    Object.assign(profile(U), fields);
    assert.equal((await pay()).body.error, "already_premium", JSON.stringify(fields));
  }
});

// ── the nightly safety net ───────────────────────────────────────────────

test("the nightly reconcile grants a payment whose webhook was lost, skips ended ones, and leaves a trace", async () => {
  person(U);
  const V = "22222222-2222-2222-2222-222222222222";
  person(V, { tier: "paid", paid_until: isoAt(NOW + 40 * DAY) });
  sub("sub_9", { user: U, customer: "cus_9", periodEnd: NOW + 30 * DAY });
  sub("sub_8", { user: V, customer: "cus_8", status: "canceled", periodEnd: NOW + 3 * DAY });
  const refused = await call(stripeApi, { method: "GET", query: { action: "reconcile" } });
  assert.equal(refused.statusCode, 401, "only the cron may run it");
  const r = await call(stripeApi, { method: "GET", query: { action: "reconcile" }, headers: { authorization: "Bearer cron-test" } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual([r.body.scanned, r.body.applied, r.body.skipped, r.body.failed], [2, 1, 1, 0]);
  assert.equal(profile(U).paid_until, isoAt(NOW + 30 * DAY));
  assert.ok(premium(U));
  assert.equal(profile(V).paid_until, isoAt(NOW + 40 * DAY), "an ended subscription is not re-applied");
  assert.deepEqual(DB.rpc.map((c) => [c.fn, c.args.p_job, c.args.p_ok]), [["record_cron_heartbeat", "residata_stripe_reconcile", true]]);
});

// ── admin and deletion ───────────────────────────────────────────────────

test("admin moving a card payer to Free stops the card first; the 'deleted' that follows changes nothing", async () => {
  person(ADMIN, { tier: "admin" });
  person(U, { tier: "paid", paid_until: isoAt(NOW + 20 * DAY), paid_started_at: isoAt(NOW - 10 * DAY), stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  sub("sub_1", { periodEnd: NOW + 20 * DAY });
  const r = await call(setSubscription, { headers: asUser(ADMIN), body: { user_id: U, tier: "free" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(ST.calls.some(([op, id]) => op === "cancel" && id === "sub_1"), "the card was cancelled at Stripe");
  assert.equal(profile(U).stripe_subscription_id, null);
  assert.equal(premium(U), false);
  const after = { ...profile(U) };
  await webhook("customer.subscription.deleted", ST.subs.get("sub_1"));
  assert.deepEqual(profile(U), after);
});

test("admin cannot hand a card payer different Premium dates; if Stripe is unreachable nothing changes", async () => {
  person(ADMIN, { tier: "admin" });
  person(U, { tier: "paid", paid_until: isoAt(NOW + 20 * DAY), stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  sub("sub_1", { periodEnd: NOW + 20 * DAY });
  const before = { ...profile(U) };
  const longer = await call(setSubscription, { headers: asUser(ADMIN), body: { user_id: U, paid_until: "2027-06-30" } });
  assert.equal(longer.statusCode, 409);
  assert.equal(longer.body.error, "card_subscription");
  ST.failCancel = true;
  const blocked = await call(setSubscription, { headers: asUser(ADMIN), body: { user_id: U, tier: "pending" } });
  assert.equal(blocked.statusCode, 502);
  assert.equal(blocked.body.error, "card_cancel_failed");
  assert.deepEqual(profile(U), before);
  assert.ok(!ST.calls.some(([op]) => op === "cancel") || ST.subs.get("sub_1").status === "active");
});

test("deleting a card payer's account stops the card first; if Stripe is unreachable nothing is deleted", async () => {
  person(U, { tier: "paid", paid_until: isoAt(NOW + 20 * DAY), stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1" });
  sub("sub_1", { periodEnd: NOW + 20 * DAY });
  ST.failCancel = true;
  const kept = await call(deleteUser, { headers: asUser(U), body: { user_id: U } });
  assert.equal(kept.statusCode, 502);
  assert.equal(kept.body.error, "card_cancel_failed");
  assert.ok(profile(U), "the account is still there");
  assert.deepEqual(DB.deleted, []);
  ST.failCancel = false;
  const gone = await call(deleteUser, { headers: asUser(U), body: { user_id: U } });
  assert.equal(gone.statusCode, 200, JSON.stringify(gone.body));
  assert.equal(ST.subs.get("sub_1").status, "canceled", "nothing is charged after the account is gone");
  assert.deepEqual(DB.deleted, [U]);
  assert.equal(profile(U), undefined);
  // Stripe's "deleted" for the cancelled card arrives after the account is gone — harmless.
  assert.equal((await webhook("customer.subscription.deleted", ST.subs.get("sub_1"))).statusCode, 200);
});
