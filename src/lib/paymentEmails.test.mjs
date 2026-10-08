// Payment e-mails and admin billing (Boss 2026-10-07): "wanna get notified if someone
// pays … no invoice for the user when i bought, and no email about getting to premium
// tier … make sure we can see all the info about the customers in the admin, their
// invoices, payments". The REAL api/stripe.js runs here; only Stripe, the database and
// the mail server are simulated. Pinned:
//   · first payment → the customer gets ONE welcome-to-Premium e-mail WITH the invoice PDF
//     attached, Boss gets ONE payment e-mail with who, how much, discount, next payment
//     and the business numbers — and a redelivered webhook sends nothing more;
//   · a renewal → the invoice e-mail, not a second welcome;
//   · the next payment's amount follows the coupon's duration, and is left out when unknown;
//   · a failed SMTP send leaves no claim, so Stripe's retry delivers it;
//   · a failed renewal → Boss and the customer once while Stripe retries (Premium paused, pay link),
//     and once more on the last attempt;
//   · a failed FIRST payment → Boss and the customer once, without "we retry / Premium keeps running";
//   · a late "failed" for an invoice that has since been paid → nothing;
//   · a cancellation → Boss + a confirmation to the customer; undone → Boss; the end → Boss + the customer;
//   · a refund and a chargeback → Boss once each; revenue is net of them;
//   · a failed send → the webhook answers 500 (Stripe retries), and the retry sends only what is missing;
//   · the customer's language: explicit pick → sign-up language → billing country → English;
//   · admin → Revenue / a person's payments: admins only, numbers from Stripe.
// Invoice shapes copied from the live Residata account (in_1UO0g6…, 7 Oct 2026).

import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

// ── mail ────────────────────────────────────────────────────────────────
const sent = [];
let smtpFails = false;
mock.module("nodemailer", {
  defaultExport: {
    createTransport: () => ({
      sendMail: async (m) => { if (smtpFails) throw new Error("smtp down"); sent.push(m); return { messageId: "m" }; },
    }),
  },
});
const PDF = Buffer.from("%PDF-1.4 test invoice");
globalThis.fetch = async (url) => {
  if (String(url).startsWith("https://pay.stripe.com/invoice/")) return { ok: true, arrayBuffer: async () => PDF };
  throw new Error(`no network in tests: ${url}`);
};

// ── Stripe ──────────────────────────────────────────────────────────────
const ST = { subs: new Map(), invoices: new Map(), charges: [], disputes: [], customers: {}, cancelled: [], coupon: "forever", retrieveFails: false, preview: undefined };
const copy = (o) => JSON.parse(JSON.stringify(o));
const listOf = (data) => ({ then: (ok, bad) => Promise.resolve({ object: "list", data, has_more: false }).then(ok, bad),
  async *[Symbol.asyncIterator]() { yield* data; } });
const discountObj = () => ({ id: "di_1", object: "discount", end: null, source: { type: "coupon", coupon: { id: "c1", duration: ST.coupon, percent_off: 98 } } });
// Like Stripe: a discount is an id unless expanded, and its coupon an id unless expanded deeper.
function expandLike(s, expand = []) {
  const deep = expand.includes("data.discounts.source.coupon");
  const shallow = deep || expand.includes("data.discounts");
  s.discounts = (s.discounts || []).map((d) => (deep ? d
    : shallow ? { ...d, source: { ...d.source, coupon: d.source.coupon.id } } : d.id));
  return s;
}
class FakeStripe {
  constructor() {
    this.subscriptions = {
      retrieve: async (id) => copy(ST.subs.get(id)),
      cancel: async (id) => { ST.cancelled.push(id); const s = ST.subs.get(id); if (s) s.status = "canceled"; return copy(s || { id }); },
      list: (p = {}) => listOf([...ST.subs.values()].filter((s) => !p.customer || s.customer === p.customer).map(copy)
        .map((s) => expandLike(s, p.expand))),
    };
    this.invoices = {
      retrieve: async (id) => {
        if (ST.retrieveFails) throw new Error("stripe down");
        return { ...copy(ST.invoices.get(id)), discounts: [discountObj()] };
      },
      list: (p = {}) => listOf([...ST.invoices.values()].filter((i) => !p.customer || i.customer === p.customer).map(copy)),
    };
    // the upcoming-invoice preview exists only when a test sets ST.preview
    Object.defineProperty(this.invoices, "createPreview", { get: () => (ST.preview === undefined ? undefined
      : async () => (ST.preview === "fail" ? Promise.reject(new Error("no preview")) : { amount_due: ST.preview })) });
    this.charges = { list: (p = {}) => listOf(ST.charges.filter((c) => !p.customer || c.customer === p.customer).map(copy)) };
    this.disputes = { list: () => listOf(ST.disputes.map(copy)) };
    this.paymentIntents = { retrieve: async (id) => ({ id, customer: "cus_1" }) };
    this.customers = { retrieve: async (id) => ({ id, metadata: {}, ...(ST.customers[id] || {}) }) };
    this.webhooks = { constructEvent: (raw, sig) => {
      if (sig !== "t=1,v1=valid") throw new Error("bad signature");
      return JSON.parse(raw.toString("utf8"));
    } };
  }
}

// ── database ────────────────────────────────────────────────────────────
const DB = { tables: {}, tokens: {} };
const rows = (t) => (DB.tables[t] ||= []);
function query(table) {
  let op = "select", values = null, single = false;
  const filters = [];
  const q = {
    select() { return q; }, insert(v) { op = "insert"; values = v; return q; },
    update(v) { op = "update"; values = v; return q; }, delete() { op = "delete"; return q; },
    eq(c, v) { filters.push((r) => r[c] === v); return q; }, in(c, a) { filters.push((r) => a.includes(r[c])); return q; },
    gte(c, v) { filters.push((r) => r[c] >= v); return q; },
    like(c, pat) { const re = new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`); filters.push((r) => re.test(String(r[c]))); return q; },
    order() { return q; }, limit() { return q; }, maybeSingle() { single = true; return q; },
    then(ok, bad) { return Promise.resolve().then(run).then(ok, bad); },
  };
  function run() {
    const all = rows(table);
    const hit = all.filter((r) => filters.every((f) => f(r)));
    if (op === "insert") {
      const vals = Array.isArray(values) ? values : [values];
      if (table === "invoice_emails_sent" && vals.some((v) => all.some((r) => r.invoice_id === v.invoice_id))) {
        return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      all.push(...vals.map((v) => ({ ...v })));
      return { data: null, error: null };
    }
    if (op === "update") { hit.forEach((r) => Object.assign(r, values)); return { data: null, error: null }; }
    if (op === "delete") { DB.tables[table] = all.filter((r) => !hit.includes(r)); return { data: null, error: null }; }
    const data = hit.map((r) => ({ ...r }));
    return { data: single ? (data[0] ?? null) : data, error: null };
  }
  return q;
}
const createClient = () => ({
  from: query,
  rpc: async (name, args) => { (DB.rpc ||= []).push([name, args]); return { data: null, error: null }; },
  auth: {
    getUser: async (tok) => (DB.tokens[tok] ? { data: { user: DB.tokens[tok] }, error: null } : { data: { user: null }, error: { message: "bad" } }),
    admin: { getUserById: async (id) => ({ data: { user: { id, user_metadata: DB.meta?.[id] || {} } }, error: null }) },
  },
});

mock.module("stripe", { defaultExport: FakeStripe });
mock.module("@supabase/supabase-js", { namedExports: { createClient } });
Object.assign(process.env, {
  SUPABASE_URL: "https://db.test", SUPABASE_SECRET_KEY: "service-test", STRIPE_SECRET_KEY: "sk_live_simulated",
  STRIPE_WEBHOOK_SECRET: "whsec_simulated", ADMIN_EMAIL: "boss@residata.test",
});
for (const k of ["log", "warn", "error"]) mock.method(console, k, () => {});
const stripeApi = (await import("../../api/stripe.js")).default;

// ── helpers ─────────────────────────────────────────────────────────────
const NOW = Math.floor(Date.now() / 1000);
const U = "11111111-1111-1111-1111-111111111111";
const ADMIN = "99999999-9999-9999-9999-999999999999";

function call({ query = {}, headers = {}, body } = {}) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const req = Readable.from([Buffer.from(raw)]);
  Object.assign(req, { method: "POST", query, body, headers: { origin: "https://residata.eu", ...headers } });
  const res = { statusCode: 200, body: undefined, headers: {},
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; }, end() { return this; } };
  return Promise.resolve(stripeApi(req, res)).then(() => res);
}
let evt = 0;
const webhook = (type, object, extra = {}) => call({ query: { action: "webhook" }, headers: { "stripe-signature": "t=1,v1=valid" },
  body: { id: `evt_${++evt}`, type, created: NOW, data: { object, ...(extra.previous ? { previous_attributes: extra.previous } : {}) }, ...(extra.created ? { created: extra.created } : {}) } });

function person(fields = {}) {
  rows("user_profiles").push({ id: U, email: "eva@firma.sk", full_name: "Eva Malá", company: "Firma s.r.o.", position: "CEO",
    tier: "free", created_at: "2026-10-07T19:34:48Z", stripe_customer_id: "cus_1", ui_prefs: { language: "sk" },
    billing_company_name: "Firma s.r.o.", billing_company_id: "12345678", billing_vat_id: "SK2020123456",
    billing_address: { line1: "Hlavná 1", postal_code: "81101", city: "Bratislava", country: "SK" }, ...fields });
}
function sub(fields = {}) {
  const s = { id: "sub_1", object: "subscription", customer: "cus_1", status: "active", created: NOW,
    metadata: { supabase_user_id: U }, cancel_at_period_end: false, cancel_at: null,
    items: { data: [{ current_period_start: NOW, current_period_end: NOW + 30 * 86400,
      price: { unit_amount: 27999, recurring: { interval: "month" } }, quantity: 1 }] },
    discounts: [discountObj()], ...fields };
  ST.subs.set(s.id, s);
  return s;
}
function invoice(fields = {}) {
  const amount = fields.amount_paid ?? 560;
  const inv = { id: "in_1", object: "invoice", status: "paid", billing_reason: "subscription_create",
    customer: "cus_1", customer_email: "eva@firma.sk", customer_name: "Firma s.r.o.", number: "RES-0001",
    amount_paid: amount, amount_due: amount, currency: "eur", created: NOW, attempt_count: 1,
    status_transitions: { paid_at: NOW }, discounts: ["di_1"],
    total_discount_amounts: [{ amount: 27439, discount: "di_1" }],
    hosted_invoice_url: "https://invoice.stripe.com/i/acct_x/inv", invoice_pdf: "https://pay.stripe.com/invoice/acct_x/inv/pdf",
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: { supabase_user_id: U } } },
    lines: { data: [{ amount: 27999, period: { start: NOW, end: NOW + 30 * 86400 },
      parent: { subscription_item_details: { proration: false } }, discount_amounts: [{ amount: 27439, discount: "di_1" }] }] },
    ...fields };
  ST.invoices.set(inv.id, inv);
  return inv;
}
const toBoss = () => sent.filter((m) => m.to === "boss@residata.test");
const toEva = () => sent.filter((m) => m.to === "eva@firma.sk");
const text = (m) => String(m.html).replace(/ /g, " ").replace(/&amp;/g, "&");

beforeEach(() => {
  sent.length = 0; smtpFails = false; ST.subs.clear(); ST.invoices.clear(); ST.coupon = "forever"; ST.retrieveFails = false;
  ST.charges = []; ST.disputes = []; ST.customers = {}; ST.cancelled = []; ST.preview = undefined;
  DB.tables = {}; DB.tokens = {}; DB.meta = {};
  person(); sub();
});

// ── first payment ───────────────────────────────────────────────────────
test("first payment: one welcome with the invoice PDF to the customer, one payment e-mail to Boss — never twice", async () => {
  const inv = invoice();
  await webhook("invoice.paid", inv);
  await webhook("invoice.paid", inv);                 // Stripe redelivers
  await webhook("invoice.payment_succeeded", inv);    // and fires its twin
  assert.equal(toEva().length, 1, "one customer e-mail");
  assert.equal(toBoss().length, 1, "one owner e-mail");

  const w = toEva()[0];
  assert.equal(w.subject, "Vitajte v Residata Premium 🎉");
  for (const s of ["Premium je aktívne", "Dobrý deň, Eva,", "Všetky projekty", "RES-0001", "5,60 €", "Faktúru máte v prílohe", "/app"]) {
    assert.ok(text(w).includes(s), s);
  }
  assert.equal(w.attachments?.length, 1);
  assert.equal(w.attachments[0].filename, "Faktura-RES-0001.pdf");
  assert.ok(w.attachments[0].content.equals(PDF));

  const b = toBoss()[0];
  assert.equal(b.subject, "[Residata] 💶 €5.60 — Eva Malá (Firma s.r.o.) · Premium (new subscription)");
  for (const s of ["New paying customer", "−€274.39 off the €279.99/month price", "· €5.60", "RES-0001", "eva@firma.sk",
    "SK2020123456", "Hlavná 1", "Residata now", "MRR", `tab=users&user=${U}`, "dashboard.stripe.com/invoices/in_1"]) {
    assert.ok(text(b).includes(s), s);
  }
});

test("a customer who uses Residata in English gets the welcome in English", async () => {
  rows("user_profiles")[0].ui_prefs = { language: "en" };
  await webhook("invoice.paid", invoice());
  assert.equal(toEva()[0].subject, "Welcome to Residata Premium 🎉");
  assert.ok(text(toEva()[0]).includes("Your invoice is attached"));
  assert.equal(toEva()[0].attachments[0].filename, "Invoice-RES-0001.pdf");
});

test("a renewal: the invoice e-mail, not a second welcome", async () => {
  await webhook("invoice.paid", invoice({ id: "in_2", number: "RES-0002", billing_reason: "subscription_cycle",
    amount_paid: 27999, total_discount_amounts: [], discounts: [],
    lines: { data: [{ amount: 27999, period: { start: NOW, end: NOW + 30 * 86400 }, parent: { subscription_item_details: { proration: false } }, discount_amounts: [] }] } }));
  assert.equal(toEva()[0].subject, "Faktúra RES-0002 · Residata");
  assert.ok(text(toEva()[0]).includes("Ďakujeme za platbu") && !text(toEva()[0]).includes("Vitajte"));
  assert.ok(toBoss()[0].subject.includes("(renewal)"));
});

// ── next payment ────────────────────────────────────────────────────────
test("the next payment follows the coupon: once → full price; unknown → the date without an amount", async () => {
  ST.coupon = "once";
  await webhook("invoice.paid", invoice());
  assert.ok(text(toBoss()[0]).includes("· €279.99"), "a one-time coupon: the next charge is the full price");

  sent.length = 0; DB.tables.invoice_emails_sent = []; ST.retrieveFails = true;
  await webhook("invoice.paid", invoice({ id: "in_3" }));
  const row = text(toBoss()[0]).split("Next payment")[1].split("</tr>")[0];
  assert.ok(!row.includes("€"), `no invented amount: ${row}`);
});

// ── SMTP down ───────────────────────────────────────────────────────────
test("a failed send answers 500 and leaves no claim, so Stripe's retry delivers both e-mails", async () => {
  smtpFails = true;
  const inv = invoice();
  const r = await webhook("invoice.paid", inv);
  assert.equal(r.statusCode, 500, "a lost e-mail must make Stripe redeliver, not vanish behind a 200");
  assert.equal(sent.length, 0);
  assert.equal(rows("invoice_emails_sent").length, 0, "claims released");
  smtpFails = false;
  assert.equal((await webhook("invoice.paid", inv)).statusCode, 200);
  assert.equal(toEva().length, 1);
  assert.equal(toBoss().length, 1);
});

// ── failed renewal ──────────────────────────────────────────────────────
test("a failed renewal: Boss and the customer hear once, however often Stripe retries", async () => {
  const inv = invoice({ id: "in_f", status: "open", billing_reason: "subscription_cycle", amount_paid: 0, amount_due: 27999,
    next_payment_attempt: NOW + 3 * 86400 });
  await webhook("invoice.payment_failed", inv);
  await webhook("invoice.payment_failed", { ...inv, attempt_count: 2 });
  await webhook("invoice.payment_failed", { ...inv, attempt_count: 3 });
  assert.equal(toBoss().length, 1);
  assert.equal(toEva().length, 1);
  assert.equal(toBoss()[0].subject, "[Residata] ⚠ Payment failed: €279.99 — Eva Malá (Firma s.r.o.)");
  // the truth about access: a failing renewal does not extend paid_until → Premium is paused
  assert.ok(text(toBoss()[0]).includes("Premium is paused") && !text(toBoss()[0]).includes("keeps running"));
  assert.equal(toEva()[0].subject, "Platba za Residata Premium sa nepodarila — Premium je pozastavené");
  for (const x of ["Premium pozastavené", "ďalší pokus", "Zaplatiť teraz", "https://invoice.stripe.com/i/acct_x/inv", "/app/billing"]) {
    assert.ok(text(toEva()[0]).includes(x), x);
  }
  assert.ok(!/neprídete|nepríde o prístup|keep your access/.test(text(toEva()[0])));

  // Stripe's last attempt (no next attempt): one more e-mail each, saying the retries are over
  ST.invoices.set("in_f", { ...inv, attempt_count: 4, next_payment_attempt: null });
  await webhook("invoice.payment_failed", { ...inv, attempt_count: 4, next_payment_attempt: null });
  await webhook("invoice.payment_failed", { ...inv, attempt_count: 4, next_payment_attempt: null });
  assert.equal(toBoss().length, 2);
  assert.equal(toEva().length, 2);
  assert.ok(toBoss()[1].subject.startsWith("[Residata] ⚠ Payment failed — retries over"));
  assert.equal(toEva()[1].subject, "Platba za Residata Premium opäť neprešla — Premium je pozastavené");
  assert.ok(text(toEva()[1]).includes("Ďalší automatický pokus už nebude"));
});

test("a late 'payment failed' for an invoice that has since been paid sends nothing", async () => {
  const inv = invoice({ id: "in_late", status: "open", billing_reason: "subscription_cycle", amount_paid: 0, amount_due: 27999, next_payment_attempt: NOW + 86400 });
  ST.invoices.set("in_late", { ...inv, status: "paid" });          // Stripe now says: paid
  await webhook("invoice.payment_failed", inv);
  assert.equal(sent.length, 0, "no 'check your card' after 'thank you'");
});

test("a failed FIRST payment: nobody is told 'we will retry / Premium keeps running' — it started nothing", async () => {
  // Stripe sandbox 8 Oct 2026: a subscription whose first charge fails → invoice.payment_failed
  // with billing_reason subscription_create; nothing is retried and the person never had Premium.
  const inv = invoice({ id: "in_first", status: "open", billing_reason: "subscription_create", amount_paid: 0, amount_due: 27999, discounts: [], total_discount_amounts: [] });
  await webhook("invoice.payment_failed", inv);
  await webhook("invoice.payment_failed", inv);
  assert.equal(toBoss().length, 1);
  assert.equal(toBoss()[0].subject, "[Residata] ⚠ First payment failed: €279.99 — Eva Malá (Firma s.r.o.)");
  assert.ok(!text(toBoss()[0]).includes("keeps running"), "no 'Premium keeps running' for someone who never had it");
  assert.equal(toEva().length, 1);
  assert.equal(toEva()[0].subject, "Platba za Residata Premium neprešla — predplatné sa nespustilo");
  assert.ok(!/skúsime znova|neprišli/.test(text(toEva()[0])), "no 'we will retry, keep your access'");
  assert.ok(text(toEva()[0]).includes("nič sme vám neúčtovali") && text(toEva()[0]).includes("/app/billing"));
});

// ── cancellation ────────────────────────────────────────────────────────
test("a cancellation: Boss once and a confirmation to the customer; the end: Boss and the customer once each", async () => {
  const end = NOW + 20 * 86400;
  rows("user_profiles")[0].stripe_subscription_id = "sub_1";
  const s = sub({ cancel_at_period_end: true, cancel_at: end, canceled_at: NOW,
    cancellation_details: { feedback: "too_expensive", comment: "<b>drahé</b>" } });
  await webhook("customer.subscription.updated", s, { previous: { cancel_at_period_end: false, cancel_at: null } });
  await webhook("customer.subscription.updated", s, { previous: { cancel_at_period_end: false, cancel_at: null } });
  await webhook("customer.subscription.updated", s, { previous: { metadata: {} } });   // another change while cancelling
  assert.equal(toBoss().length, 1);
  assert.ok(toBoss()[0].subject.startsWith("[Residata] Subscription cancelled: Eva Malá (Firma s.r.o.) — Premium until"));
  assert.ok(text(toBoss()[0]).includes("Too expensive") && text(toBoss()[0]).includes("&lt;b&gt;drahé&lt;/b&gt;"), "the reason, escaped");
  assert.equal(toBoss()[0].replyTo, "eva@firma.sk", "Boss can answer the customer straight from the e-mail");
  assert.equal(toEva().length, 1);
  assert.equal(toEva()[0].subject, "Zrušenie Residata Premium potvrdené");
  assert.ok(text(toEva()[0]).includes("Premium vám beží do") && text(toEva()[0]).includes("/app/billing"));

  ST.subs.set("sub_1", { ...s, status: "canceled", ended_at: NOW });
  await webhook("customer.subscription.deleted", { ...s, status: "canceled" });
  await webhook("customer.subscription.deleted", { ...s, status: "canceled" });
  assert.equal(toBoss().length, 2);
  assert.equal(toBoss()[1].subject, "[Residata] Subscription ended: Eva Malá (Firma s.r.o.)");
  assert.equal(toEva().length, 2);
  assert.equal(toEva()[1].subject, "Residata Premium sa skončilo");
});

test("an undone cancellation: Boss hears that they stayed — only if he heard they left", async () => {
  const end = NOW + 20 * 86400;
  const s = sub({ cancel_at_period_end: true, cancel_at: end, canceled_at: NOW });
  await webhook("customer.subscription.updated", s, { previous: { cancel_at_period_end: false } });
  const back = sub({ cancel_at_period_end: false, cancel_at: null, canceled_at: null });
  await webhook("customer.subscription.updated", back, { previous: { cancel_at_period_end: true, cancel_at: end } });
  await webhook("customer.subscription.updated", back, { previous: { cancel_at_period_end: true, cancel_at: end } });
  assert.equal(toBoss().length, 2);
  assert.equal(toBoss()[1].subject, "[Residata] ✅ Cancellation undone: Eva Malá (Firma s.r.o.) — Premium continues");

  // cancelled and undone before Boss heard of it: no "they stayed"
  sent.length = 0; DB.tables.invoice_emails_sent = [];
  sub({ id: "sub_2", cancel_at_period_end: false });
  await webhook("customer.subscription.updated", ST.subs.get("sub_2"), { previous: { cancel_at_period_end: true } });
  assert.equal(toBoss().length, 0);
});

test("a subscription whose first payment never went through ends silently; an admin gift keeps the customer quiet", async () => {
  await webhook("customer.subscription.deleted", sub({ status: "incomplete_expired" }));
  assert.equal(sent.length, 0, "never a customer — nothing to announce");

  rows("user_profiles")[0].paid_until = new Date(Date.now() + 90 * 86400_000).toISOString();   // Premium beyond this card
  rows("user_profiles")[0].stripe_subscription_id = "other";
  await webhook("customer.subscription.deleted", sub({ status: "canceled" }));
  assert.equal(toBoss().length, 1, "Boss still hears the subscription ended");
  assert.equal(toEva().length, 0, "the customer still has Premium — no 'Premium has ended'");
});

// ── refunds and chargebacks ─────────────────────────────────────────────
test("a refund and a chargeback: Boss once each; revenue in admin is net of them", async () => {
  invoice({ payments: { data: [{ payment: { type: "payment_intent", payment_intent: "pi_1" } }] } });
  const charge = { id: "ch_1", object: "charge", customer: "cus_1", payment_intent: "pi_1", amount: 560, amount_refunded: 200, currency: "eur", livemode: true };
  ST.charges = [charge];
  await webhook("charge.refunded", charge);
  await webhook("charge.refunded", charge);
  assert.equal(toBoss().length, 1);
  assert.equal(toBoss()[0].subject, "[Residata] ↩ Refund €2.00 — Eva Malá (Firma s.r.o.)");
  assert.ok(text(toBoss()[0]).includes("Partial refund"));
  await webhook("charge.refunded", { ...charge, amount_refunded: 560 });     // the rest later: a new total, a new note
  assert.equal(toBoss().length, 2);

  const d = { id: "dp_1", object: "dispute", payment_intent: "pi_1", amount: 560, currency: "eur", status: "needs_response",
    reason: "fraudulent", evidence_details: { due_by: NOW + 7 * 86400 }, livemode: true };
  await webhook("charge.dispute.created", d);
  await webhook("charge.dispute.created", d);
  assert.equal(toBoss().length, 3);
  assert.ok(toBoss()[2].subject.startsWith("[Residata] 🚨 Chargeback €5.60 — Eva Malá (Firma s.r.o.) — respond by"));
  await webhook("charge.dispute.closed", { ...d, status: "lost" });
  assert.equal(toBoss()[3].subject, "[Residata] Chargeback lost: €5.60 — Eva Malá (Firma s.r.o.)");

  ST.charges = [{ ...charge, amount_refunded: 200 }];
  ST.disputes = [];
  const all = await call({ query: { action: "admin-billing" }, headers: asTier("admin"), body: {} });
  assert.equal(all.body.summary.revenueTotal, 360, "5,60 € paid − 2,00 € refunded");
  assert.equal(all.body.summary.refundedTotal, 200);
  assert.equal(all.body.payments[0].refunded, 200);
  const one = await call({ query: { action: "admin-billing" }, headers: { authorization: "Bearer tok-admin" }, body: { user_id: U } });
  assert.equal(one.body.totals.paid, 360);
  assert.equal(one.body.totals.refunded, 200);
});

// ── language ────────────────────────────────────────────────────────────
test("the customer's language: explicit pick, else the sign-up language, else the billing country, else English", async () => {
  delete rows("user_profiles")[0].ui_prefs;
  DB.meta[U] = { lang: "en" };
  await webhook("invoice.paid", invoice({ id: "in_l1" }));
  assert.equal(toEva().at(-1).subject, "Welcome to Residata Premium 🎉", "signed up in English");

  DB.meta[U] = {};
  await webhook("invoice.paid", invoice({ id: "in_l2", customer_address: { country: "SK" } }));
  assert.equal(toEva().at(-1).subject, "Vitajte v Residata Premium 🎉", "billing address in Slovakia");

  await webhook("invoice.paid", invoice({ id: "in_l3", customer_address: { country: "AT" } }));
  assert.equal(toEva().at(-1).subject, "Welcome to Residata Premium 🎉", "a foreign customer is not written to in Slovak");
});

// ── 0 € first invoice ───────────────────────────────────────────────────
test("a 100 % coupon on the first invoice still gets the welcome — worded honestly", async () => {
  await webhook("invoice.paid", invoice({ amount_paid: 0, amount_due: 0, total_discount_amounts: [{ amount: 27999, discount: "di_1" }] }));
  assert.equal(toEva().length, 1);
  assert.ok(text(toEva()[0]).includes("toto obdobie zadarmo") && !text(toEva()[0]).includes("Platba prebehla"));
  assert.equal(toBoss().length, 1);
  assert.ok(text(toBoss()[0]).includes("nothing charged"));
});

// ── checkout after a failed first payment ───────────────────────────────
test("checkout: a stale incomplete subscription is cancelled instead of locking the customer out", async () => {
  rows("user_profiles")[0].stripe_subscription_id = "sub_inc";
  sub({ id: "sub_inc", status: "incomplete" });
  DB.tokens["tok-eva"] = { id: U, email: "eva@firma.sk" };
  const r = await call({ query: { action: "checkout" }, headers: { authorization: "Bearer tok-eva" }, body: {} });
  assert.deepEqual(ST.cancelled, ["sub_inc"]);
  assert.notEqual(r.body?.error, "already subscribed");
});

// ── admin billing ───────────────────────────────────────────────────────
const asTier = (tier) => {
  const id = tier === "admin" ? ADMIN : "22222222-2222-2222-2222-222222222222";
  rows("user_profiles").push({ id, email: `${tier}@residata.test`, tier });
  DB.tokens[`tok-${tier}`] = { id, email: `${tier}@residata.test` };
  return { authorization: `Bearer tok-${tier}` };
};

test("admin billing: only admins; the business and a person's payments come from Stripe", async () => {
  invoice();
  assert.equal((await call({ query: { action: "admin-billing" }, headers: asTier("free"), body: {} })).statusCode, 403);
  assert.equal((await call({ query: { action: "admin-billing" }, body: {} })).statusCode, 401);

  const all = await call({ query: { action: "admin-billing" }, headers: asTier("admin"), body: {} });
  assert.equal(all.statusCode, 200);
  assert.equal(all.body.summary.paying, 1);
  assert.equal(all.body.summary.mrr, 560);                     // 98 % forever off 279.99
  assert.equal(all.body.summary.signups30d, 1);
  assert.equal(all.body.summary.signups30dPaying, 1);
  assert.equal(all.body.summary.revenueTotal, 560);
  assert.equal(all.body.payments[0].number, "RES-0001");
  assert.equal(all.body.payments[0].person.email, "eva@firma.sk");

  const one = await call({ query: { action: "admin-billing" }, headers: { authorization: "Bearer tok-admin" }, body: { user_id: U } });
  assert.equal(one.statusCode, 200);
  assert.equal(one.body.invoices[0].pdfUrl, "https://pay.stripe.com/invoice/acct_x/inv/pdf");
  assert.equal(one.body.totals.paid, 560);
  assert.equal(one.body.billing.vat, "SK2020123456");
  assert.ok(one.body.customer.url.endsWith("/customers/cus_1") && !one.body.customer.url.includes("/test/"));
});

// ── webhook events ──────────────────────────────────────────────────────
test("the nightly reconcile adds a missing event to OUR webhook endpoint — and touches nothing else", async () => {
  const eps = [
    { id: "we_ours", url: "https://residata.eu/api/webhooks/stripe", status: "enabled",
      enabled_events: ["checkout.session.completed", "customer.updated", "customer.subscription.created", "customer.subscription.updated",
        "customer.subscription.deleted", "invoice.paid", "invoice.payment_succeeded"] },
    { id: "we_other", url: "https://example.com/hook", status: "enabled", enabled_events: ["invoice.paid"] },
    { id: "we_off", url: "https://residata.eu/api/webhooks/stripe", status: "disabled", enabled_events: [] },
  ];
  const updates = [];
  process.env.CRON_SECRET = "cron-test";
  // the module holds one Stripe client; give that client the endpoints API
  const { getStripe } = await import("../../api/_lib/stripe.js");
  getStripe().webhookEndpoints = {
    list: () => listOf(eps.map(copy)),
    update: async (id, p) => { updates.push([id, p.enabled_events]); return { id }; },
  };
  const r = await call({ query: { action: "reconcile" }, headers: { authorization: "Bearer cron-test" } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(updates.map((u) => u[0]), ["we_ours"]);
  assert.ok(updates[0][1].includes("invoice.payment_failed"));
  assert.equal(updates[0][1].length, 11, "nothing removed, nothing doubled");
  const added = ["invoice.payment_failed", "charge.refunded", "charge.dispute.created", "charge.dispute.closed"];
  assert.deepEqual(r.body.webhook.added, [{ id: "we_ours", added }]);
  // the heartbeat outlives Hobby's one-hour log: "did the webhook check run, what did it add?"
  const beat = (DB.rpc || []).find(([n]) => n === "record_cron_heartbeat");
  assert.ok(beat[1].p_detail.endsWith(`webhook=ok(1) added:${added.join("+")}`), beat[1].p_detail);
  assert.equal(beat[1].p_ok, true);

  // no endpoint of ours at Stripe: every webhook e-mail would silently stop → the heartbeat is NOT ok
  eps.splice(0, 1);
  DB.rpc = [];
  await call({ query: { action: "reconcile" }, headers: { authorization: "Bearer cron-test" } });
  assert.equal(DB.rpc.find(([n]) => n === "record_cron_heartbeat")[1].p_ok, false);
});
