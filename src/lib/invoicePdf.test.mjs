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
  const m = P.model(invoice(), { products: { prod_x: "Residata Premium" }, lang: "sk" });
  assert.equal(m.dodavatel.nazov, "Kamhal & Co. s. r. o.");
  assert.deepStrictEqual(m.odberatel.cisla, [["IČO", "12345678"], ["IČ DPH", "SK2020123456"]]);
  assert.deepStrictEqual([m.vystavena, m.uhradena, m.stav], ["2026-10-07", "2026-10-07", "paid"]);
  const all = P.layout(m).filter((o) => o.op === "text").map((o) => o.text).join("\n").replace(/ /g, " ");
  for (const s of ["Faktúra", "č. RES-0001", "Uhradená", "Predplatné Residata Premium", "Obdobie 7. 10. 2026 – 7. 11. 2026",
    "Zľava 99.82 %", "−279,49 €", "0,50 €", "Uhradené kartou 7. 10. 2026", "Dodávateľ nie je platiteľom DPH.", "57 849 471"]) {
    assert.ok(all.includes(s), s);
  }
  for (const s of ["Invoice", "Bill to", "Pay online", "Skúšobná", "majiteľa", "daňový doklad"]) assert.ok(!all.includes(s), s);
  const en = P.layout(P.model(invoice(), { lang: "en" })).filter((o) => o.op === "text").map((o) => o.text).join("\n");
  assert.ok(en.includes("Invoice") && en.includes("Residata Premium subscription") && !en.includes("Faktúra"));
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
