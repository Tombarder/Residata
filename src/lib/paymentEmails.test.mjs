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
        if (ST.retrieveFails === "outage") throw Object.assign(new Error("connection reset"), { type: "StripeConnectionError" });
        if (ST.retrieveFails) throw new Error("stripe down");
        return { ...copy(ST.invoices.get(id)), discounts: [discountObj()] };
      },
      list: (p = {}) => listOf([...ST.invoices.values()].filter((i) => !p.customer || i.customer === p.customer).map(copy)),
    };
    // the upcoming-invoice preview exists only when a test sets ST.preview
    Object.defineProperty(this.invoices, "createPreview", { get: () => (ST.preview === undefined ? undefined
      : async () => (ST.preview === "fail" ? Promise.reject(new Error("no preview")) : { amount_due: ST.preview })) });
    this.charges = { list: (p = {}) => listOf(ST.charges.filter((c) => !p.customer || c.customer === p.customer).map(copy)) };
    // like Stripe: the invoice behind a payment intent (invoice.payments[].payment.payment_intent)
    this.invoicePayments = { list: async (p = {}) => ({ data: [...ST.invoices.values()]
      .filter((i) => (i.payments?.data || []).some((x) => x.payment?.payment_intent === p.payment?.payment_intent))
      .slice(0, 1).map((i) => ({ object: "invoice_payment", invoice: i.id })) }) };
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
// Supabase Storage: the invoice archive (one private bucket, created on first use like the real one)
const STORE = { buckets: new Map(), created: [] };
const storage = {
  from: (bucket) => ({
    download: async (path) => {
      const b = STORE.buckets.get(bucket);
      if (!b) return { data: null, error: { message: "Bucket not found" } };
      const f = b.get(path);
      return f ? { data: { arrayBuffer: async () => f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) }, error: null }
        : { data: null, error: { message: "Object not found" } };
    },
    upload: async (path, body, { upsert } = {}) => {
      const b = STORE.buckets.get(bucket);
      if (!b) return { data: null, error: { message: "Bucket not found" } };
      if (b.has(path) && !upsert) return { data: null, error: { message: "The resource already exists" } };
      b.set(path, Buffer.from(body));
      return { data: { path }, error: null };
    },
  }),
  createBucket: async (name, opts) => { STORE.created.push([name, opts]); STORE.buckets.set(name, new Map()); return { data: { name }, error: null }; },
};
const createClient = () => ({
  from: query,
  storage,
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
    setHeader(k, v) { this.headers[k] = v; }, send(b) { this.body = b; return this; }, end() { return this; } };
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
    subtotal: 27999, total: amount, amount_remaining: 0,
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
  DB.tables = {}; DB.tokens = {}; DB.meta = {}; STORE.buckets.clear(); STORE.created = [];
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
  assert.equal(w.subject, "Predplatné Residata Premium je aktívne");
  for (const s of ["je aktívne a platbu sme prijali", "Dobrý deň, Eva,", "RES-0001", "5,60 €", "Faktúru nájdete v prílohe", "/app",
    "S pozdravom", "info@residata.eu"]) {
    assert.ok(text(w).includes(s), s);
  }
  // Boss 2026-10-08: "what is this nonsense in there" — no feature list, no 🎉, no telling them what to do with it
  for (const s of ["🎉", "dôveru", "účtovníctv", "doklad", "Všetky projekty", "Exporty dát"]) assert.ok(!text(w).includes(s) && !w.subject.includes(s), s);
  assert.equal(w.attachments?.length, 1);
  assert.equal(w.attachments[0].filename, "Faktura-RES-0001.pdf");
  // OUR invoice (api/_lib/invoicePdf.js — the KamhalCo template), not Stripe's PDF
  assert.ok(!w.attachments[0].content.equals(PDF) && w.attachments[0].content.subarray(0, 4).toString() === "%PDF");
  const { PDFDocument } = await import("pdf-lib");
  assert.equal((await PDFDocument.load(w.attachments[0].content)).getTitle(), "Faktúra RES-0001");

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
  assert.equal(toEva()[0].subject, "Your Residata Premium subscription is active");
  assert.ok(text(toEva()[0]).includes("Your invoice is attached"));
  assert.ok(!text(toEva()[0]).includes("dáta o trhu") && text(toEva()[0]).includes("new-build market intelligence"),
    "no Slovak tagline in an English e-mail (review 9 Oct 2026)");
  const { PDFDocument } = await import("pdf-lib");
  assert.equal((await PDFDocument.load(toEva()[0].attachments[0].content)).getTitle(), "Invoice RES-0001", "the invoice in English too");
  assert.equal(toEva()[0].attachments[0].filename, "Invoice-RES-0001.pdf");
});

test("a renewal: the invoice e-mail, not a second welcome", async () => {
  await webhook("invoice.paid", invoice({ id: "in_2", number: "RES-0002", billing_reason: "subscription_cycle",
    amount_paid: 27999, total_discount_amounts: [], discounts: [],
    lines: { data: [{ amount: 27999, period: { start: NOW, end: NOW + 30 * 86400 }, parent: { subscription_item_details: { proration: false } }, discount_amounts: [] }] } }));
  assert.equal(toEva()[0].subject, "Faktúra RES-0002 – Residata");
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
  assert.equal(toEva()[0].subject, "Platba za predplatné sa nepodarila – Residata");
  for (const x of ["Premium je pozastavené", "zopakujeme", "Uhradiť faktúru", "https://invoice.stripe.com/i/acct_x/inv", "/app/billing"]) {
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
  assert.equal(toEva()[1].subject, "Predplatné čaká na úhradu – Residata");
  assert.ok(text(toEva()[1]).includes("automaticky ju už nezopakujeme"));
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
  assert.equal(toEva()[0].subject, "Platba sa nepodarila – Residata");
  assert.ok(!/skúsime znova|neprišli|zopakujeme|pozastavené/.test(text(toEva()[0])), "no 'we will retry, keep your access'");
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
  assert.equal(toEva()[0].subject, "Zrušenie predplatného potvrdené – Residata");
  assert.ok(text(toEva()[0]).includes("Premium zostáva aktívne do") && text(toEva()[0]).includes("/app/billing"));

  ST.subs.set("sub_1", { ...s, status: "canceled", ended_at: NOW });
  await webhook("customer.subscription.deleted", { ...s, status: "canceled" });
  await webhook("customer.subscription.deleted", { ...s, status: "canceled" });
  assert.equal(toBoss().length, 2);
  assert.equal(toBoss()[1].subject, "[Residata] Subscription ended: Eva Malá (Firma s.r.o.)");
  assert.equal(toEva().length, 2);
  assert.equal(toEva()[1].subject, "Predplatné Premium skončilo – Residata");
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
  // the customer: one note per refund, the second one reports only the new part (review 9 Oct 2026)
  const back = toEva().filter((m) => m.subject === "Vrátenie platby – Residata");
  assert.equal(back.length, 2, "one per refund, none for the redelivery");
  const plain = (m) => text(m).replace(/<[^>]+>/g, "");
  assert.ok(plain(back[0]).includes("vrátili sme vám 2,00 €") && plain(back[0]).includes("RES-0001") && !plain(back[0]).includes("Vrátené spolu"), plain(back[0]));
  assert.ok(plain(back[1]).includes("vrátili sme vám 3,60 €") && plain(back[1]).includes("Vrátené spolu") && plain(back[1]).includes("5,60 €"), plain(back[1]));

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
  assert.equal(toEva().at(-1).subject, "Your Residata Premium subscription is active", "signed up in English");

  DB.meta[U] = {};
  await webhook("invoice.paid", invoice({ id: "in_l2", customer_address: { country: "SK" } }));
  assert.equal(toEva().at(-1).subject, "Predplatné Residata Premium je aktívne", "billing address in Slovakia");

  await webhook("invoice.paid", invoice({ id: "in_l3", customer_address: { country: "AT" } }));
  assert.equal(toEva().at(-1).subject, "Your Residata Premium subscription is active", "a foreign customer is not written to in Slovak");
});

// ── 0 € first invoice ───────────────────────────────────────────────────
test("a 100 % coupon on the first invoice still gets the welcome — worded honestly", async () => {
  await webhook("invoice.paid", invoice({ amount_paid: 0, amount_due: 0, total_discount_amounts: [{ amount: 27999, discount: "di_1" }] }));
  assert.equal(toEva().length, 1);
  assert.ok(text(toEva()[0]).includes("je aktívne.") && text(toEva()[0]).includes("0,00 €") && !text(toEva()[0]).includes("platbu sme prijali"));
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
  // Stripe's portal: the DEFAULT configuration gets invoice history off — that flag only (Boss 2026-10-08)
  const confs = [
    { id: "bpc_default", is_default: true, active: true, features: { invoice_history: { enabled: true }, subscription_cancel: { enabled: true } } },
    { id: "bpc_other", is_default: false, active: true, features: { invoice_history: { enabled: true } } },
  ];
  const portalUpdates = [];
  getStripe().billingPortal = { configurations: {
    list: () => listOf(confs.map(copy)),
    update: async (id, p) => { portalUpdates.push([id, p]); return { id }; },
  } };
  const r = await call({ query: { action: "reconcile" }, headers: { authorization: "Bearer cron-test" } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(portalUpdates, [["bpc_default", { features: { invoice_history: { enabled: false } } }]]);
  assert.deepEqual(r.body.portal, { checked: true, off: 1 });
  assert.deepEqual(updates.map((u) => u[0]), ["we_ours"]);
  assert.ok(updates[0][1].includes("invoice.payment_failed"));
  assert.equal(updates[0][1].length, 11, "nothing removed, nothing doubled");
  const added = ["invoice.payment_failed", "charge.refunded", "charge.dispute.created", "charge.dispute.closed"];
  assert.deepEqual(r.body.webhook.added, [{ id: "we_ours", added }]);
  // the heartbeat outlives Hobby's one-hour log: "did the webhook check run, what did it add?"
  const beat = (DB.rpc || []).find(([n]) => n === "record_cron_heartbeat");
  assert.ok(beat[1].p_detail.endsWith(`webhook=ok(1) added:${added.join("+")}`), beat[1].p_detail);
  assert.ok(beat[1].p_detail.includes("portal=fixed(1)"), beat[1].p_detail);
  assert.equal(beat[1].p_ok, true);
  confs[0].features.invoice_history.enabled = false;           // already off → nothing to write
  portalUpdates.length = 0;
  assert.deepEqual((await call({ query: { action: "reconcile" }, headers: { authorization: "Bearer cron-test" } })).body.portal, { checked: true, off: 0 });
  assert.equal(portalUpdates.length, 0);

  // no endpoint of ours at Stripe: every webhook e-mail would silently stop → the heartbeat is NOT ok
  eps.splice(0, 1);
  delete getStripe().billingPortal;
  DB.rpc = [];
  await call({ query: { action: "reconcile" }, headers: { authorization: "Bearer cron-test" } });
  assert.equal(DB.rpc.find(([n]) => n === "record_cron_heartbeat")[1].p_ok, false);
});

// ── the customer's own invoices (Boss 2026-10-08: Stripe's portal no longer lists them) ──
const asEva = (fields = {}) => {
  Object.assign(rows("user_profiles").find((r) => r.id === U), fields);
  DB.tokens["tok-eva"] = { id: U, email: "eva@firma.sk" };
  return { authorization: "Bearer tok-eva" };
};

test("customer → invoices: only their own, newest data from Stripe; Pay only on the current subscription's unpaid one", async () => {
  invoice();                                                                       // paid, cus_1
  invoice({ id: "in_open", number: "RES-0002", status: "open", amount_paid: 0, amount_due: 27999, billing_reason: "subscription_cycle" });
  invoice({ id: "in_old", number: "RES-0003", status: "open", amount_paid: 0, amount_due: 27999,
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_abandoned", metadata: {} } } });
  invoice({ id: "in_draft", number: null, status: "draft" });
  invoice({ id: "in_other", number: "RES-0099", customer: "cus_2", customer_email: "iny@firma.sk" });
  const r = await call({ query: { action: "invoices" }, headers: asEva({ stripe_subscription_id: "sub_1" }), body: {} });
  assert.equal(r.statusCode, 200);
  const byNo = Object.fromEntries(r.body.invoices.map((x) => [x.number, x]));
  assert.deepEqual(Object.keys(byNo).sort(), ["RES-0001", "RES-0002", "RES-0003"], "own, finalized invoices only");
  assert.equal(byNo["RES-0001"].status, "paid");
  assert.equal(byNo["RES-0001"].amount, 560);
  assert.equal(byNo["RES-0001"].pay_url, null);
  assert.equal(byNo["RES-0002"].pay_url, "https://invoice.stripe.com/i/acct_x/inv", "the current subscription's unpaid invoice can be paid");
  assert.equal(byNo["RES-0003"].pay_url, null, "an abandoned checkout's invoice is not offered for payment");
  assert.equal((await call({ query: { action: "invoices" }, body: {} })).statusCode, 401);
  rows("user_profiles").find((x) => x.id === U).stripe_customer_id = null;
  assert.deepEqual((await call({ query: { action: "invoices" }, headers: asEva(), body: {} })).body, { invoices: [] });
});

test("customer → invoice PDF: their own as OUR PDF; somebody else's is 'not found'", async () => {
  invoice();
  invoice({ id: "in_other", number: "RES-0099", customer: "cus_2", customer_email: "iny@firma.sk" });
  const r = await call({ query: { action: "invoice-pdf" }, headers: asEva(), body: { invoice_id: "in_1", lang: "sk" } });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["Content-Disposition"], /filename="Faktura-RES-0001\.pdf"/);
  const { PDFDocument } = await import("pdf-lib");
  assert.equal((await PDFDocument.load(r.body)).getTitle(), "Faktúra RES-0001");
  assert.ok(!Buffer.from(r.body).equals(PDF), "our invoice, not Stripe's PDF");
  assert.equal((await call({ query: { action: "invoice-pdf" }, headers: asEva(), body: { invoice_id: "in_other" } })).statusCode, 404);
  assert.equal((await call({ query: { action: "invoice-pdf" }, headers: asEva(), body: { invoice_id: "../x" } })).statusCode, 400);
  assert.equal((await call({ query: { action: "invoice-pdf" }, body: { invoice_id: "in_1" } })).statusCode, 401);
});

test("a renewal that failed first and then went through: the customer is told Premium is back", async () => {
  await webhook("invoice.paid", invoice({ id: "in_5", number: "RES-0005", billing_reason: "subscription_cycle", attempt_count: 3,
    amount_paid: 27999, total_discount_amounts: [], discounts: [] }));
  const m = toEva()[0];
  assert.equal(m.subject, "Faktúra RES-0005 – Residata");
  assert.ok(text(m).includes("ktorá predtým neprešla") && text(m).includes("Premium je znova aktívne"), text(m));
  sent.length = 0;
  await webhook("invoice.paid", invoice({ id: "in_6", number: "RES-0006", billing_reason: "subscription_cycle", attempt_count: 1,
    amount_paid: 27999, total_discount_amounts: [], discounts: [] }));
  assert.ok(!text(toEva()[0]).includes("predtým neprešla"), "an ordinary renewal says nothing about a failure");
});

test("Stripe portal: in the customer's language, and its invoice history is switched off on the first visit", async () => {
  const { getStripe } = await import("../../api/_lib/stripe.js");
  const sessions = [], portalUpdates = [];
  const confs = [{ id: "bpc_default", is_default: true, active: true, features: { invoice_history: { enabled: true } } }];
  getStripe().billingPortal = {
    sessions: { create: async (p) => { sessions.push(p); return { url: "https://billing.stripe.test/p" }; } },
    configurations: { list: () => listOf(confs.map(copy)),
      update: async (id, p) => { portalUpdates.push(id); confs[0].features.invoice_history.enabled = false; return { id }; } },
  };
  const r = await call({ query: { action: "portal" }, headers: asEva(), body: {} });
  assert.equal(r.statusCode, 200);
  assert.equal(sessions[0].locale, "sk", "a Slovak customer gets the Slovak portal");
  assert.deepEqual(portalUpdates, ["bpc_default"]);
  rows("user_profiles").find((x) => x.id === U).ui_prefs = { language: "en" };
  await call({ query: { action: "portal" }, headers: asEva(), body: {} });
  assert.equal(sessions[1].locale, "en");
  assert.deepEqual(portalUpdates, ["bpc_default"], "checked once per instance, not on every visit");
});

// ── the issued invoice is KEPT (review 9 Oct 2026) ─────────────────────
test("archive: the paid invoice's PDF is stored once and the same bytes come back later, even after the data changed", async () => {
  await webhook("invoice.paid", invoice());
  const mailed = toEva()[0].attachments[0].content;
  assert.deepEqual(STORE.created, [["invoices", { public: false }]], "a PRIVATE bucket, created on first use");
  const kept = STORE.buckets.get("invoices").get("in_1-sk.pdf");
  assert.ok(kept && Buffer.from(mailed).equals(kept), "the archived copy is the one the customer got");
  // a year later the company has a new name — the issued document does not change
  ST.invoices.get("in_1").customer_name = "Úplne Iná Firma a.s.";
  const r = await call({ query: { action: "invoice-pdf" }, headers: asEva(), body: { invoice_id: "in_1", lang: "sk" } });
  assert.equal(r.statusCode, 200);
  assert.ok(Buffer.from(r.body).equals(kept), "the download is the archived document, not a fresh drawing");
});

test("archive: an unpaid (open) invoice is drawn afresh and not stored", async () => {
  invoice({ id: "in_open", number: "RES-0007", status: "open", amount_paid: 0, status_transitions: {} });
  const r = await call({ query: { action: "invoice-pdf" }, headers: asEva(), body: { invoice_id: "in_open", lang: "sk" } });
  assert.equal(r.statusCode, 200);
  assert.ok(!STORE.buckets.get("invoices")?.has("in_open-sk.pdf"), "an open invoice can still change — not archived");
});

test("Stripe outage while drawing the invoice: the webhook answers 500 (Stripe redelivers), no e-mail with Stripe's PDF", async () => {
  ST.retrieveFails = "outage";
  const r = await webhook("invoice.paid", invoice());
  assert.equal(r.statusCode, 500, "a transient outage must make Stripe redeliver");
  assert.equal(toEva().length, 0, "no customer e-mail with Stripe's English template under our name");
  assert.equal(rows("invoice_emails_sent").filter((x) => x.invoice_id === "in_1").length, 0, "the claim is released");
  ST.retrieveFails = false;
  assert.equal((await webhook("invoice.paid", invoice())).statusCode, 200);
  const m = toEva()[0];
  assert.ok(m && !Buffer.from(m.attachments[0].content).equals(PDF), "the redelivery carries OUR invoice");
});

test("Stripe outage on the download: 503 'try again', not Stripe's PDF", async () => {
  invoice();
  ST.retrieveFails = "outage";
  const r = await call({ query: { action: "invoice-pdf" }, headers: asEva(), body: { invoice_id: "in_1", lang: "sk" } });
  assert.equal(r.statusCode, 503);
  assert.match(r.body.error, /dočasne nedostupný/);
});

test("an invoice our template refuses (not EUR): the customer still gets Stripe's true PDF, and it is alerted", async () => {
  console.error.mock.resetCalls();
  await webhook("invoice.paid", invoice({ currency: "usd" }));
  const m = toEva()[0];
  assert.ok(m, "the e-mail still goes");
  assert.ok(Buffer.from(m.attachments[0].content).equals(PDF), "Stripe's PDF — ours cannot draw a USD invoice truthfully");
  assert.ok(console.error.mock.calls.some((c) => String(c.arguments[0]).startsWith("RESIDATA-ALERT invoice template")), "alerted");
  assert.ok(!STORE.buckets.get("invoices")?.size, "nothing archived");
});

// ── admin → our invoice PDF ─────────────────────────────────────────────
test("admin → PDF: our invoice (the one the customer got), admins only", async () => {
  invoice();
  const r = await call({ query: { action: "admin-invoice-pdf" }, headers: asTier("admin"), body: { invoice_id: "in_1" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["Content-Type"], "application/pdf");
  assert.match(r.headers["Content-Disposition"], /filename="Faktura-RES-0001\.pdf"/);
  const { PDFDocument } = await import("pdf-lib");
  assert.equal((await PDFDocument.load(r.body)).getTitle(), "Faktúra RES-0001");
  assert.equal((await call({ query: { action: "admin-invoice-pdf" }, headers: asTier("free"), body: { invoice_id: "in_1" } })).statusCode, 403);
  assert.equal((await call({ query: { action: "admin-invoice-pdf" }, body: { invoice_id: "in_1" } })).statusCode, 401);
  assert.equal((await call({ query: { action: "admin-invoice-pdf" }, headers: asTier("admin"), body: { invoice_id: "../x" } })).statusCode, 400);

  // the document the CUSTOMER got, in their language — not the admin's
  rows("user_profiles").find((x) => x.id === U).ui_prefs = { language: "en" };
  invoice({ id: "in_8", number: "RES-0008" });
  const en = await call({ query: { action: "admin-invoice-pdf" }, headers: asTier("admin"), body: { invoice_id: "in_8", lang: "sk" } });
  assert.equal((await PDFDocument.load(en.body)).getTitle(), "Invoice RES-0008");
});
