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
  let gross = 0;
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
  }
  let net = gross;
  for (const d of sub?.discounts || []) {
    const c = couponOf(d);
    if (!c || discountAppliesAt(d, nowSec) !== true) continue;
    if (c.percent_off) net *= 1 - Number(c.percent_off) / 100;
    else if (c.amount_off) net -= Number(c.amount_off);
  }
  return Math.max(0, Math.round(net));
}

/**
 * The business at a glance, from Stripe's subscriptions and invoices.
 * `subs` must carry discounts WITH their coupons (expand: ["data.discounts.source.coupon"]);
 * with only "data.discounts" the coupon is a bare id and the discount is treated as not
 * applying — measured live 7 Oct 2026: MRR read 279,99 € for a 0,50 € subscription.
 */
export function businessSummary(subs, invoices, now = Date.now()) {
  const nowSec = now / 1000;
  const d = new Date(now);
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
  const days30 = nowSec - 30 * 86400;
  const live = (subs || []).filter((s) => LIVE_STATUSES.includes(s.status));
  const mrr = live.reduce((s, x) => s + subscriptionMonthlyCents(x, nowSec), 0);
  const paid = (invoices || []).filter((i) => i.status === "paid");
  const paidAt = (i) => Number(i.status_transitions?.paid_at || i.created || 0);
  const sum = (arr) => arr.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
  return {
    paying: live.length,
    cancelling: live.filter((s) => s.cancel_at_period_end || s.cancel_at).length,
    pastDue: live.filter((s) => s.status === "past_due").length,
    mrr,
    arr: mrr * 12,
    arpu: live.length ? Math.round(mrr / live.length) : 0,
    revenueMonth: sum(paid.filter((i) => paidAt(i) >= monthStart)),
    revenue30d: sum(paid.filter((i) => paidAt(i) >= days30)),
    revenueTotal: sum(paid),
    payments: paid.length,
    new30d: paid.filter((i) => invoiceKind(i) === "new" && paidAt(i) >= days30).length,
    failedOpen: (invoices || []).filter((i) => i.status === "open" && Number(i.attempt_count || 0) > 0).length,
  };
}

/** One invoice as the admin table shows it (no secrets, no card data). */
export function invoiceRow(inv) {
  const f = invoiceFacts(inv);
  const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id || null;
  return {
    id: inv.id,
    number: inv.number || null,
    status: inv.status,
    kind: f.kind,
    amount: Number(inv.status === "paid" ? inv.amount_paid : inv.amount_due) || 0,
    discount: f.totalDiscount,
    currency: inv.currency || "eur",
    created: inv.created || null,
    paidAt: inv.status_transitions?.paid_at || null,
    periodStart: f.periodStart,
    periodEnd: f.periodEnd,
    attempts: Number(inv.attempt_count || 0),
    customerId,
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
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id || null,
    userId: sub.metadata?.supabase_user_id || null,
  };
}
