// The invoice Kamhal & Co. issues for Residata — the SAME template as KamhalCo's (Boss 2026-10-08:
// "why is it different for Residata and for KamhalCo … total trash").
//  1. layout() reproduces the shared pattern ../../api/_lib/__fixtures__/faktura_vzor.json EXACTLY —
//     the same file faktury-mvp's faktura_pdf.rozloz is tested against. One template, two runtimes.
//  2. A real-shaped Stripe invoice becomes a Slovak (or English) invoice with supplier + buyer,
//     "Paid", period, discount as a percentage — and never the coupon's internal name.
//  3. VAT registration / tax on the invoice / a draft → refused, not drawn with a false VAT line.
//  4. render() makes a PDF with the embedded font (Slovak diacritics) and the title.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as P from "../../api/_lib/invoicePdf.js";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const VZOR = JSON.parse(readFileSync(here("../../api/_lib/__fixtures__/faktura_vzor.json"), "utf8"));

test("layout reproduces the pattern shared with faktury-mvp, command for command", async () => {
  await P.loadMetrics();
  assert.ok(VZOR.pripady.length >= 3);
  for (const c of VZOR.pripady) {
    const ops = P.layout(c.model);
    assert.equal(ops.length, c.ops.length, `${c.nazov}: number of commands`);
    ops.forEach((o, i) => assert.deepStrictEqual(o, c.ops[i], `${c.nazov}: command ${i} differs — `
      + "if the change is deliberate, regenerate with faktury-mvp/scripts/faktura_vzor.py and copy the file here"));
  }
});

test("content: the same Stripe invoice gives the same invoice as faktury-mvp — edge cases included", () => {
  // the INPUTS of the shared pattern (review 9 Oct 2026): balance, 100 % coupon, void, other currency,
  // characters outside the font, negative total… Python's faktura_pdf.model wrote the expected models.
  assert.ok(VZOR.vstupy.length >= 40);
  for (const v of VZOR.vstupy) {
    const opts = { brand: v.znacka, products: v.produkty, lang: v.lang, dodavatel: v.dodavatel };
    if ("chyba" in v) assert.throws(() => P.model(v.inv, opts), P.InvoiceUnavailable, v.nazov);
    else assert.deepStrictEqual(P.model(v.inv, opts), v.model, v.nazov);
  }
});

test("the totals add up in every case; a void invoice owes nothing", () => {
  for (const v of VZOR.vstupy) {
    const m = v.model;
    if (!m) continue;
    assert.equal(m.medzisucet - m.zlavy.reduce((s, z) => s + z.suma, 0), m.celkom, v.nazov);
    assert.equal(m.celkom + m.zostatok, m.k_platbe, v.nazov);
    if (m.stav === "paid") assert.equal(m.k_platbe - m.uhradene, 0, v.nazov);
    if (m.stav === "void") assert.equal(m.k_uhrade, 0, v.nazov);
  }
});

test("loadInvoice: the payment method of the real payment and the IČO from the checkout", async () => {
  const inv = invoice({ custom_fields: [], billing_reason: "subscription_create",
    parent: { type: "subscription_details", subscription_details: { subscription: "sub_x" } } });
  const asked = [];
  const list = (xs) => ({ async *[Symbol.asyncIterator]() { yield* xs; } });
  const stripe = {
    invoices: { retrieve: async () => JSON.parse(JSON.stringify(inv)) },
    customers: { retrieve: async () => ({ invoice_settings: { custom_fields: null } }) },
    checkout: { sessions: { list: (q) => { asked.push(q.subscription); return list([{ custom_fields: [{ key: "companyid", type: "text", text: { value: "50000000" } }] }]); } } },
    invoicePayments: { list: () => list([{ status: "paid", payment: { type: "payment_intent", payment_intent: "pi_1" } }]) },
    paymentIntents: { retrieve: async () => ({ latest_charge: { payment_method_details: { type: "sepa_debit" } } }) },
    products: { retrieve: async () => ({ name: "Residata Premium" }) },
  };
  const { inv: got } = await P.loadInvoice(stripe, "in_test");
  assert.deepEqual(asked, ["sub_x"]);
  assert.equal(got._sposob_uhrady, "sepa_debit");
  const m = P.model(got, { lang: "sk" });
  assert.deepEqual(m.odberatel.cisla[0], ["IČO", "50000000"]);
  assert.equal(P.TEXTS.sk.sposoby[m.sposob], "SEPA inkaso");
});

test("isTransient: a Stripe outage is retried, a template fault is not", () => {
  assert.ok(P.isTransient({ type: "StripeConnectionError" }));
  assert.ok(P.isTransient({ type: "StripeAPIError", statusCode: 502 }));
  assert.ok(!P.isTransient({ type: "StripeInvalidRequestError", statusCode: 400 }));
  assert.ok(!P.isTransient(new P.InvoiceUnavailable("x")));
  assert.ok(!P.isTransient(new TypeError("bug")));
});

const T0 = 1791401176;   // 7 Oct 2026 21:26 Bratislava
function invoice(over = {}) {
  return {
    id: "in_test", object: "invoice", number: "RES-0001", status: "paid", currency: "eur", customer: "cus_test",
    created: T0, status_transitions: { finalized_at: T0, paid_at: T0 + 1 }, due_date: null,
    customer_name: "Jana Testovacia", customer_email: "jana@kancelaria-test.sk",
    customer_address: { line1: "Testovacia 1", line2: "", postal_code: "81101", city: "Bratislava", country: "SK" },
    customer_tax_ids: [{ type: "eu_vat", value: "SK2020123456" }], custom_fields: [{ name: "IČO", value: "12345678" }],
    subtotal: 27999, total: 50, amount_due: 50, amount_paid: 50, amount_remaining: 0,
    total_discount_amounts: [{ amount: 27949, discount: "di_x" }],
    discounts: [{ id: "di_x", source: { type: "coupon", coupon: { id: "c", name: "Skúšobná platba majiteľa", percent_off: 99.82 } } }],
    lines: { data: [{ amount: 27999, quantity: 1, description: "1 × Residata Premium (at €279.99 / month)",
      period: { start: T0, end: T0 + 31 * 86400 }, pricing: { price_details: { product: "prod_x" }, unit_amount_decimal: "27999" },
      parent: { type: "subscription_item_details", subscription_item_details: { proration: false } } }] },
    ...over,
  };
}

test("a real-shaped invoice: Slovak, supplier and buyer, paid, period, discount % — no coupon name", async () => {
  await P.loadMetrics();
  // as loadInvoice returns it: the payment method type of the real payment
  const m = P.model(invoice({ _sposob_uhrady: "card" }), { products: { prod_x: "Residata Premium" }, lang: "sk" });
  assert.equal(m.dodavatel.nazov, "Kamhal & Co. s. r. o.");
  assert.deepStrictEqual(m.odberatel.cisla, [["IČO", "12345678"], ["IČ DPH", "SK2020123456"]]);
  assert.deepStrictEqual([m.vystavena, m.uhradena, m.stav], ["2026-10-07", "2026-10-07", "paid"]);
  const all = P.layout(m).filter((o) => o.op === "text").map((o) => o.text).join("\n").replace(/ /g, " ");
  for (const s of ["Faktúra", "č. RES-0001", "Uhradená", "Predplatné Residata Premium", "Obdobie 7. 10. 2026 – 7. 11. 2026",
    "Zľava 99,82 %", "−279,49 €", "0,50 €", "Platobná karta", "Uhradené 7. 10. 2026", "Dodávateľ nie je platiteľom DPH.", "57 849 471"]) {
    assert.ok(all.includes(s), s);
  }
  for (const s of ["Invoice", "Bill to", "Pay online", "Skúšobná", "majiteľa", "daňový doklad"]) assert.ok(!all.includes(s), s);
  const en = P.layout(P.model(invoice(), { lang: "en" })).filter((o) => o.op === "text").map((o) => o.text).join("\n");
  assert.ok(en.includes("Invoice") && en.includes("Residata Premium subscription") && !en.includes("Faktúra"));
});

test("the buyer's postal code as written in Slovakia and Czechia (811 01) — as faktury-mvp", () => {
  const rows = (a) => P.model(invoice({ customer_address: a }), { lang: "sk" }).odberatel.riadky;
  assert.ok(rows({ line1: "Hlavná 1", postal_code: "81101", city: "Bratislava", country: "SK" }).includes("811 01 Bratislava"));
  assert.ok(rows({ line1: "Hlavná 1", postal_code: "811 01", city: "Bratislava", country: "SK" }).includes("811 01 Bratislava"));
  assert.ok(rows({ line1: "Na Příkopě 1", postal_code: "11000", city: "Praha", country: "CZ" }).includes("110 00 Praha"));
  assert.ok(rows({ line1: "Unter den Linden 1", postal_code: "10115", city: "Berlin", country: "DE" }).includes("10115 Berlin"));
  assert.ok(rows({ line1: "Hlavná 1", postal_code: null, city: "Bratislava", country: "SK" }).includes("Bratislava"));
});

test("a draft, tax on the invoice → refused", () => {
  assert.throws(() => P.model(invoice({ number: null, status: "draft" })), P.InvoiceUnavailable);
  assert.throws(() => P.model(invoice({ total_taxes: [{ amount: 460 }] })), P.InvoiceUnavailable);
});

test("render: a PDF with the embedded font and the title", async () => {
  const { pdf, number } = await P.invoicePdf(invoice(), { products: { prod_x: "Residata Premium" } });
  assert.equal(number, "RES-0001");
  assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
  const { PDFDocument, PDFName, PDFDict } = await import("pdf-lib");
  const doc = await PDFDocument.load(pdf);
  const fonts = doc.context.enumerateIndirectObjects().map(([, o]) => o)
    .filter((o) => o instanceof PDFDict && o.get(PDFName.of("Type"))?.toString() === "/Font")
    .map((o) => String(o.get(PDFName.of("BaseFont"))));
  assert.ok(fonts.some((f) => f.includes("InterFaktura-Regular")) && fonts.some((f) => f.includes("InterFaktura-SemiBold")), fonts.join());
  assert.equal(doc.getTitle(), "Faktúra RES-0001");
  assert.ok(pdf.length < 200_000, `subset font, not the whole TTF (${pdf.length} B)`);
});

test("no invoice text runs into the footer, whatever the number of lines (review 9 Oct 2026, L4)", () => {
  const H = 841.89, yf = H - 92;                       // the footer rule (footer() in layout)
  const base = VZOR.pripady.find((p) => p.nazov === "vstup:multi_discount_balance_sk_kamhalco").model;
  assert.ok(base.zlavy.length && base.zostatok, "a case with discounts and a balance — the tallest totals block");
  const footer = new Set(P.layout(base).filter((o) => o.op === "text" && o.y > yf).map((o) => o.text));
  assert.ok(footer.size, "footer found");
  const zlavy = [...base.zlavy, ...base.zlavy];
  for (let n = 1; n <= 30; n++) {
    const m = { ...base, polozky: Array(n).fill(base.polozky[0]), zlavy };
    const bad = P.layout(m).filter((o) => o.op === "text" && o.y > yf - 4 && !footer.has(o.text)).map((o) => [n, o.text, o.y]);
    assert.deepEqual(bad, [], "text runs into the footer");
  }
});
