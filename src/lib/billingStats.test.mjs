// The owner's money numbers (lib/billingStats.js) — pure functions over Stripe objects.
// Review 2026-10-08 pinned what each number MEANS, because each had a plausible wrong
// reading that the screens and the payment e-mails would have repeated:
//   · paying = customers worth money, each once (a 100 % coupon and a trial are not paying);
//   · MRR leaves trials out; "at risk" = cancelling or failing;
//   · revenue = what was KEPT (refunds and lost chargebacks come off);
//   · "this month" is Bratislava's month, not UTC's;
//   · an amount-off coupon on a yearly price is a twelfth a month.
import { test } from "node:test";
import assert from "node:assert/strict";
import { businessSummary, monthStartSec, netCents, subscriptionMonthlyCents, nextChargeCents, invoiceRow } from "./billingStats.js";

const NOW = Date.parse("2026-10-08T10:00:00Z");
const S = NOW / 1000;
const coupon = (c, end = null) => ({ end, source: { coupon: c } });
const sub = (f = {}) => ({
  id: "sub", customer: "cus_a", status: "active", cancel_at_period_end: false, cancel_at: null,
  items: { data: [{ current_period_end: S + 20 * 86400, price: { unit_amount: 10000, recurring: { interval: "month" } }, quantity: 1 }] },
  discounts: [], ...f,
});
const paidInv = (f = {}) => ({ status: "paid", amount_paid: 10000, created: S, status_transitions: { paid_at: S }, billing_reason: "subscription_cycle", ...f });

test("this month starts at midnight in Bratislava, summer and winter", () => {
  assert.equal(new Date(monthStartSec(NOW) * 1000).toISOString(), "2026-09-30T22:00:00.000Z");
  assert.equal(new Date(monthStartSec(Date.parse("2026-12-01T00:30:00Z")) * 1000).toISOString(), "2026-11-30T23:00:00.000Z",
    "00:30 UTC on 1 December is already December in Bratislava");
  assert.equal(new Date(monthStartSec(Date.parse("2026-10-31T22:30:00Z")) * 1000).toISOString(), "2026-09-30T22:00:00.000Z",
    "22:30 UTC on 31 October is still October in Bratislava (UTC+1)");

  // a payment at 23:30 Bratislava on 30 September is September's money, not October's
  const inv = paidInv({ status_transitions: { paid_at: Date.parse("2026-09-30T21:30:00Z") / 1000 } });
  assert.equal(businessSummary([], [inv], NOW).revenueMonth, 0);
});

test("revenue is what was kept: refunds and a lost chargeback come off", () => {
  assert.equal(netCents(paidInv({ refunded_cents: 2500 })), 7500);
  assert.equal(netCents(paidInv({ dispute_status: "lost", dispute_amount: 10000 })), 0);
  assert.equal(netCents(paidInv({ dispute_status: "won", dispute_amount: 10000 })), 10000);
  assert.equal(netCents({ status: "open", amount_paid: 0 }), 0);
  const s = businessSummary([], [paidInv({ refunded_cents: 2500 }), paidInv()], NOW);
  assert.equal(s.revenueTotal, 17500);
  assert.equal(s.refundedTotal, 2500);
  assert.equal(s.payments, 2);
});

test("paying counts customers worth money once; a 100 % coupon is comped, a trial is a trial", () => {
  const subs = [
    sub({ id: "a1", customer: "cus_a" }),
    sub({ id: "a2", customer: "cus_a" }),                                         // the same customer twice
    sub({ id: "b", customer: "cus_b", discounts: [coupon({ duration: "forever", percent_off: 100 })] }),
    sub({ id: "c", customer: "cus_c", status: "trialing" }),
    sub({ id: "d", customer: "cus_d", status: "past_due" }),
    sub({ id: "e", customer: "cus_e", cancel_at_period_end: true }),
    sub({ id: "f", customer: "cus_f", status: "canceled", ended_at: S - 5 * 86400 }),
    sub({ id: "g", customer: "cus_g", status: "canceled", ended_at: S - 50 * 86400 }),
  ];
  const s = businessSummary(subs, [], NOW);
  assert.equal(s.paying, 3, "cus_a (once), cus_d (failing), cus_e (cancelling)");
  assert.equal(s.comped, 1);
  assert.equal(s.trialing, 1);
  assert.equal(s.mrr, 40000, "a1 + a2 + d + e — no trial, no 100 % coupon");
  assert.equal(s.arpu, Math.round(40000 / 3));
  assert.equal(s.mrrAtRisk, 20000, "the failing and the cancelling one");
  assert.equal(s.churned30d, 1, "ended 5 days ago — the one 50 days ago is outside");
  assert.equal(s.renewals7d, 0, "period ends in 20 days");
  const soon = businessSummary([sub({ items: { data: [{ current_period_end: S + 3 * 86400, price: { unit_amount: 10000, recurring: { interval: "month" } } }] } })], [], NOW);
  assert.equal(soon.renewals7d, 1);
  assert.equal(soon.renewals7dAmount, 10000);
});

test("an amount-off coupon on a yearly price is a twelfth a month; a percent coupon scales", () => {
  const yearly = (d) => sub({ items: { data: [{ price: { unit_amount: 120000, recurring: { interval: "year" } }, quantity: 1 }] }, discounts: [d] });
  assert.equal(subscriptionMonthlyCents(yearly(coupon({ duration: "forever", amount_off: 12000 })), S), 9000, "(1200 − 120) € / 12");
  assert.equal(subscriptionMonthlyCents(yearly(coupon({ duration: "forever", percent_off: 50 })), S), 5000);
  assert.equal(subscriptionMonthlyCents(sub({ discounts: [coupon({ duration: "repeating", percent_off: 50 }, S - 1)] }), S), 10000,
    "a repeating coupon that has run out no longer counts");
  assert.equal(subscriptionMonthlyCents(sub({ discounts: [{ source: { coupon: "c_id_only" } }] }), S), 10000,
    "an unexpanded coupon is not guessed");
});

test("the next charge: an unknown discount answers null rather than a guess", () => {
  const facts = { listPrice: 27999, discount: 27439, periodEnd: S + 30 * 86400 };
  assert.equal(nextChargeCents(facts, [coupon({ duration: "forever", percent_off: 98 })]), 560);
  assert.equal(nextChargeCents(facts, [coupon({ duration: "once", percent_off: 98 })]), 27999);
  assert.equal(nextChargeCents(facts, [coupon({ duration: "repeating", percent_off: 98 }, S + 10 * 86400)]), 27999);
  assert.equal(nextChargeCents(facts, []), null);
  assert.equal(nextChargeCents(facts, ["di_123"]), null);
});

test("an invoice row carries the refund, the chargeback and the coupon's name", () => {
  const r = invoiceRow(paidInv({ id: "in_1", refunded_cents: 10000, dispute_status: "needs_response",
    discounts: [coupon({ id: "c1", name: "Founders" })], next_payment_attempt: null }));
  assert.equal(r.refunded, 10000);
  assert.equal(r.net, 0);
  assert.equal(r.dispute, "needs_response");
  assert.equal(r.coupon, "Founders");
});
