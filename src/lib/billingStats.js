// Billing numbers for the owner — read straight from Stripe objects, no database.
//
// Boss 2026-10-07: "wanna get notified if someone pays … make sure we can see all the
// info about the customers in the admin, their invoices, payments". Stripe is the
// source of truth for money, so these are pure functions over Stripe's own
// subscriptions and invoices — used by the owner's payment e-mail and by
// admin → Revenue (api/stripe.js, action admin-billing). Pure, so they are tested
// against invoice shapes copied from the live account (billingStats.test.mjs).
//
// Amounts are integer cents throughout.

export const LIVE_STATUSES = ["active", "trialing", "past_due"];

const KIND = { subscription_create: "new", subscription_cycle: "renewal", subscription_update: "change" };

/** "new" | "renewal" | "change" | "other" — from Stripe's billing_reason. */
export function invoiceKind(inv) {
  return KIND[inv?.billing_reason] || "other";
}

/** Proration lines (unused time, mid-period changes) are not the recurring price. */
function isProration(line) {
  const det = line?.parent?.subscription_item_details;
  if (det && "proration" in det) return Boolean(det.proration);
  return Boolean(line?.proration);
}

/**
 * What an invoice says about the subscription it pays for:
 *   listPrice — the recurring price before discounts (sum of non-proration lines)
 *   discount  — what a coupon took off those lines
 *   periodStart / periodEnd — the period paid for (unix seconds), from the
 *     recurring line; the invoice header has start = end on a first invoice
 */
export function invoiceFacts(inv) {
  let listPrice = 0, discount = 0, found = false, periodStart = null, periodEnd = null;
  for (const l of inv?.lines?.data || []) {
    if (isProration(l)) continue;
    found = true;
    listPrice += Number(l.amount || 0);
    discount += (l.discount_amounts || []).reduce((s, d) => s + Number(d.amount || 0), 0);
    if (l.period && periodStart == null) { periodStart = l.period.start; periodEnd = l.period.end; }
  }
  const totalDiscount = (inv?.total_discount_amounts || []).reduce((s, d) => s + Number(d.amount || 0), 0);
  return {
    kind: invoiceKind(inv),
    listPrice: found ? listPrice : null,
    discount: found ? discount : totalDiscount,
    totalDiscount,
    periodStart: periodStart ?? inv?.period_start ?? null,
    periodEnd: periodEnd ?? inv?.period_end ?? null,
  };
}

/** The coupon behind a discount object (Stripe moved it under `source` in 2025). */
function couponOf(d) {
  if (!d || typeof d !== "object") return null;
  const c = d.coupon || d.source?.coupon;
  return c && typeof c === "object" ? c : null;
}

/**
 * Does this discount still apply on a charge at `atSec` (unix seconds)?
 * true / false, or null when we cannot tell (coupon not expanded).
 */
export function discountAppliesAt(d, atSec) {
  const c = couponOf(d);
  if (!c) return null;
  if (c.duration === "forever") return true;
  if (c.duration === "once") return false;
  if (c.duration === "repeating") return d.end ? Number(d.end) > Number(atSec) : null;
  return null;
}

/**
 * The amount of the NEXT recurring charge, or null when it cannot be known.
 * `discounts` = the invoice's discount objects WITH coupons expanded
 * (expand: ["discounts.source.coupon"]); without them a discounted invoice
 * answers null rather than a guess — an e-mail with no amount beats a wrong one.
 */
export function nextChargeCents(facts, discounts) {
  if (facts.listPrice == null) return null;
  if (!facts.discount) return facts.listPrice;
  const objs = (discounts || []).filter((d) => d && typeof d === "object");
  if (!objs.length) return null;
  const answers = objs.map((d) => discountAppliesAt(d, facts.periodEnd));
  if (answers.some((a) => a === null)) return null;
  if (answers.every((a) => a === true)) return facts.listPrice - facts.discount;
  if (answers.every((a) => a === false)) return facts.listPrice;
  return null;
}

/** Monthly value of one live subscription after a discount that still runs. */
export function subscriptionMonthlyCents(sub, nowSec = Date.now() / 1000) {
  let gross = 0, perCharge = 0;
  for (const it of sub?.items?.data || []) {
    const p = it.price || it.plan || {};
    const unit = Number(p.unit_amount ?? p.amount ?? 0) * Number(it.quantity || 1);
    const rec = p.recurring || { interval: p.interval, interval_count: p.interval_count };
    const n = Number(rec?.interval_count || 1);
    const perMonth = rec?.interval === "year" ? unit / (12 * n)
      : rec?.interval === "week" ? unit * 52 / 12 / n
      : rec?.interval === "day" ? unit * 365 / 12 / n
      : unit / n;
    gross += perMonth;
    perCharge += unit;
  }
  // an amount-off coupon comes off each CHARGE — on a yearly price that is a twelfth a month
  const monthShare = perCharge ? gross / perCharge : 1;
  let net = gross;
  for (const d of sub?.discounts || []) {
    const c = couponOf(d);
    if (!c || discountAppliesAt(d, nowSec) !== true) continue;
    if (c.percent_off) net *= 1 - Number(c.percent_off) / 100;
    else if (c.amount_off) net -= Number(c.amount_off) * monthShare;
  }
  return Math.max(0, Math.round(net));
}

/** Unix seconds of the first moment of this month in Bratislava (the business's month). */
export function monthStartSec(now = Date.now(), tz = "Europe/Bratislava") {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric" })
    .formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const guess = Date.UTC(Number(parts.year), Number(parts.month) - 1, 1);
  // the zone's offset at that midnight (DST never switches at midnight on the 1st)
  const local = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
    .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day), Number(local.hour), Number(local.minute));
  return (guess - (asUtc - guess)) / 1000;
}

/** Money kept from one invoice: paid − refunded − a lost chargeback. */
export function netCents(inv) {
  if (inv?.status !== "paid") return 0;
  const lost = inv.dispute_status === "lost" ? Number(inv.dispute_amount || 0) : 0;
  return Math.max(0, Number(inv.amount_paid || 0) - Number(inv.refunded_cents || 0) - lost);
}

const OPEN_DISPUTE = ["needs_response", "under_review", "warning_needs_response", "warning_under_review"];
const customerOf = (o) => (typeof o?.customer === "string" ? o.customer : o?.customer?.id) || null;
const periodEndOf = (s) => s?.items?.data?.[0]?.current_period_end ?? s?.current_period_end ?? null;
const cancelling = (s) => Boolean(s?.cancel_at_period_end || s?.cancel_at);

/**
 * The business at a glance, from Stripe's subscriptions and invoices.
 * `subs` must carry discounts WITH their coupons (expand: ["data.discounts.source.coupon"]);
 * with only "data.discounts" the coupon is a bare id and the discount is treated as not
 * applying — measured live 7 Oct 2026: MRR read 279,99 € for a 0,50 € subscription.
 * Invoices may carry `refunded_cents` / `dispute_status` / `dispute_amount` (api/stripe.js
 * attachMoneyFacts) — revenue is what was KEPT, not what was once charged.
 *
 * Review 2026-10-08 — what each number means now:
 *   paying    — customers with a running subscription that is worth money (active or
 *               failing), each counted once; a 100 % coupon is `comped`, a trial `trialing`
 *   mrr       — the monthly value of those subscriptions (Stripe's MRR leaves trials out)
 *   mrrAtRisk — the part of it that is cancelling or failing
 *   revenue*  — net of refunds and lost chargebacks; the month is Bratislava's month
 */
export function businessSummary(subs, invoices, now = Date.now()) {
  const nowSec = now / 1000;
  const monthStart = monthStartSec(now);
  const days30 = nowSec - 30 * 86400;
  const live = (subs || []).filter((s) => LIVE_STATUSES.includes(s.status));
  const worth = (s) => subscriptionMonthlyCents(s, nowSec);
  const billed = live.filter((s) => s.status !== "trialing");
  const valued = billed.filter((s) => worth(s) > 0);
  const mrr = valued.reduce((a, x) => a + worth(x), 0);
  const payingCustomers = new Set(valued.map(customerOf).filter(Boolean));
  const paying = payingCustomers.size || valued.length;
  const atRisk = valued.filter((s) => cancelling(s) || s.status === "past_due");
  const paid = (invoices || []).filter((i) => i.status === "paid");
  const paidAt = (i) => Number(i.status_transitions?.paid_at || i.created || 0);
  const net = (arr) => arr.reduce((a, i) => a + netCents(i), 0);
  const refunded = (arr) => arr.reduce((a, i) => a + Number(i.refunded_cents || 0), 0);
  const ended30 = (subs || []).filter((s) => s.status === "canceled" && Number(s.ended_at || 0) >= days30);
  const renewSoon = valued.filter((s) => !cancelling(s) && s.status === "active"
    && Number(periodEndOf(s) || 0) > nowSec && Number(periodEndOf(s)) <= nowSec + 7 * 86400);
  return {
    paying,
    comped: billed.filter((s) => worth(s) === 0).length,
    trialing: live.filter((s) => s.status === "trialing").length,
    cancelling: live.filter(cancelling).length,
    pastDue: live.filter((s) => s.status === "past_due").length,
    mrr,
    arr: mrr * 12,
    arpu: paying ? Math.round(mrr / paying) : 0,
    mrrAtRisk: atRisk.reduce((a, x) => a + worth(x), 0),
    revenueMonth: net(paid.filter((i) => paidAt(i) >= monthStart)),
    revenue30d: net(paid.filter((i) => paidAt(i) >= days30)),
    revenueTotal: net(paid),
    refundedTotal: refunded(paid),
    payments: paid.filter((i) => Number(i.amount_paid || 0) > 0).length,
    new30d: paid.filter((i) => invoiceKind(i) === "new" && paidAt(i) >= days30).length,
    churned30d: ended30.length,
    renewals7d: renewSoon.length,
    renewals7dAmount: renewSoon.reduce((a, x) => a + worth(x), 0),
    failedOpen: (invoices || []).filter((i) => i.status === "open" && Number(i.attempt_count || 0) > 0).length,
    disputesOpen: (invoices || []).filter((i) => OPEN_DISPUTE.includes(i.dispute_status)).length,
  };
}

/** The coupon's display name on an invoice or subscription, when expanded. */
function couponName(o) {
  for (const d of o?.discounts || []) {
    const c = couponOf(d);
    if (c) return c.name || c.id || null;
  }
  return null;
}

/** One invoice as the admin table shows it (no secrets, no card data). */
export function invoiceRow(inv) {
  const f = invoiceFacts(inv);
  const amount = Number(inv.status === "paid" ? inv.amount_paid : inv.amount_due) || 0;
  const refunded = Number(inv.refunded_cents || 0);
  return {
    id: inv.id,
    number: inv.number || null,
    status: inv.status,
    kind: f.kind,
    amount,
    refunded,
    net: inv.status === "paid" ? netCents(inv) : 0,
    dispute: inv.dispute_status || null,
    discount: f.totalDiscount,
    coupon: couponName(inv),
    currency: inv.currency || "eur",
    created: inv.created || null,
    paidAt: inv.status_transitions?.paid_at || null,
    periodStart: f.periodStart,
    periodEnd: f.periodEnd,
    attempts: Number(inv.attempt_count || 0),
    nextAttempt: inv.next_payment_attempt || null,
    customerId: customerOf(inv),
    email: inv.customer_email || null,
    name: inv.customer_name || null,
    hostedUrl: inv.hosted_invoice_url || null,
    pdfUrl: inv.invoice_pdf || null,
  };
}

/** One subscription as the admin shows it. */
export function subscriptionRow(sub, nowSec = Date.now() / 1000) {
  const item = sub?.items?.data?.[0] || {};
  return {
    id: sub.id,
    status: sub.status,
    created: sub.created || null,
    periodStart: item.current_period_start ?? sub.current_period_start ?? null,
    periodEnd: item.current_period_end ?? sub.current_period_end ?? null,
    cancelAt: sub.cancel_at || null,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    canceledAt: sub.canceled_at || null,
    endedAt: sub.ended_at || null,
    monthly: LIVE_STATUSES.includes(sub.status) ? subscriptionMonthlyCents(sub, nowSec) : 0,
    coupon: couponName(sub),
    reason: sub.cancellation_details?.feedback || null,
    customerId: customerOf(sub),
    userId: sub.metadata?.supabase_user_id || null,
  };
}
