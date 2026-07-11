// api/stripe.js
//
// ONE consolidated Stripe endpoint — one serverless function instead of three,
// to stay within the plan's function budget. Same behaviour as three separate
// endpoints; routing is by ?action=:
//   POST /api/stripe?action=checkout   (authed)  → Checkout Session { url }
//   POST /api/stripe?action=portal     (authed)  → Billing Portal  { url }
//   POST /api/stripe?action=webhook    (Stripe)  → writes paid_until
//
// The webhook keeps its public URL /api/webhooks/stripe via a single rewrite in
// vercel.json → /api/stripe?action=webhook, so the URL configured in Stripe
// never changes. bodyParser is disabled for the whole function because the
// webhook needs the raw bytes for signature verification; checkout/portal don't
// read the body at all.

import { getStripe, getSupabaseAdmin, getUserFromRequest, requestOrigin } from "./_lib/stripe.js";
import { isTrustedRequest } from "./_lib/origin.js";

export const config = { api: { bodyParser: false } };
export const maxDuration = 15;

// €49.99 / month. THE single place the price lives — change this number and
// deploy. Checkout defines the price inline (price_data below), so there is NO
// Stripe Price object, NO STRIPE_PRICE_ID env var, and nothing to set up by hand.
const MONTHLY_PRICE_CENTS = 4999;

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// ─── checkout ────────────────────────────────────────────────────────────
async function handleCheckout(req, res) {
  if (!isTrustedRequest(req)) return res.status(403).json({ error: "untrusted origin" });
  const admin = getSupabaseAdmin();
  const { user, profile, error, status } = await getUserFromRequest(req, admin);
  if (error) return res.status(status).json({ error });

  const stripe = getStripe();
  const origin = requestOrigin(req);

  const params = {
    mode: "subscription",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "eur",
        product_data: { name: "Residata — Full access" },
        unit_amount: MONTHLY_PRICE_CENTS,
        recurring: { interval: "month" },
      },
    }],
    client_reference_id: user.id,
    subscription_data: { metadata: { supabase_user_id: user.id } },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    automatic_tax: { enabled: false },
    // Force EUR as the presentment currency. Stripe "Adaptive Pricing" (on by
    // default) auto-converts the €49.99 price into the visitor's local currency
    // — so Czech users landed on CZK by default. Disabling it per-session pins
    // checkout to the price's own currency (eur) everywhere. In code, so it's
    // not a dashboard setting that can silently drift back.
    adaptive_pricing: { enabled: false },
    success_url: `${origin}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app?checkout=cancelled`,
  };
  // Returning subscriber → reuse their Stripe customer. New user → let Checkout
  // create the customer from their email (skips a separate customers.create call
  // = one less round-trip = faster). The webhook stores the customer id afterward.
  if (profile?.stripe_customer_id) params.customer = profile.stripe_customer_id;
  else if (user.email) params.customer_email = user.email;

  let session;
  try {
    session = await stripe.checkout.sessions.create(params);
  } catch (e) {
    // adaptive_pricing is only recognised on recent Stripe API versions. If this
    // account's version rejects it, DON'T fail checkout — retry once without the
    // EUR pin (currency then follows Stripe's default). Logged so the fallback is
    // visible if it ever triggers. Any other error is real → rethrow.
    if (e?.param === "adaptive_pricing" || /adaptive_pricing/i.test(String(e?.message || ""))) {
      console.warn("[stripe] adaptive_pricing rejected by API version — retrying without EUR pin");
      const retry = { ...params }; delete retry.adaptive_pricing;
      session = await stripe.checkout.sessions.create(retry);
    } else {
      throw e;
    }
  }
  return res.status(200).json({ url: session.url });
}

// ─── portal ──────────────────────────────────────────────────────────────
async function handlePortal(req, res) {
  if (!isTrustedRequest(req)) return res.status(403).json({ error: "untrusted origin" });
  const admin = getSupabaseAdmin();
  const { user, profile, error, status } = await getUserFromRequest(req, admin);
  if (error) return res.status(status).json({ error });
  if (!profile?.stripe_customer_id) {
    return res.status(400).json({ error: "no billing account yet — subscribe first" });
  }
  const stripe = getStripe();
  const portal = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${requestOrigin(req)}/app`,
  });
  return res.status(200).json({ url: portal.url });
}

// ─── webhook ─────────────────────────────────────────────────────────────
// Sync a Stripe subscription's lifecycle onto user_profiles.paid_until.
//
// Three regimes, keyed off the Stripe status (and the `deleted` event):
//   · PAID    (active / trialing) → extend paid_until to the period end,
//     but MONOTONICALLY (never rewind on a duplicated / out-of-order event).
//   · TERMINAL (canceled / unpaid / incomplete_expired, or subscription.deleted)
//     → REVOKE: set paid_until = now and drop the subscription id. Stripe deletes
//     at period end for cancel-at-period-end, so "now" ≈ the intended end.
//   · GRACE   (past_due / incomplete / paused / anything else) → leave paid_until
//     UNCHANGED. Crucially we must NOT extend on past_due: a declined renewal
//     advances current_period_end to the unpaid next period, and extending off
//     that would hand the user a free month. Existing (not-yet-elapsed) paid_until
//     is their grace window.
async function applySubscription(admin, stripe, sub, { deleted = false } = {}) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  let userId = sub.metadata?.supabase_user_id || null;
  if (!userId && customerId) {
    const { data } = await admin
      .from("user_profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
    userId = data?.id || null;
  }
  if (!userId && customerId) {
    try { const c = await stripe.customers.retrieve(customerId); userId = c?.metadata?.supabase_user_id || null; }
    catch { /* ignore */ }
  }
  if (!userId) { console.warn("[stripe webhook] no user for subscription", sub.id); return; }

  const status = sub.status;
  const terminal = deleted || ["canceled", "unpaid", "incomplete_expired"].includes(status);
  const paidNow  = ["active", "trialing"].includes(status);
  // current_period_end moved from the subscription top-level onto each line item
  // in recent Stripe API versions — read item first, fall back to top-level.
  const periodEndUnix = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null;
  const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

  const { data: current } = await admin
    .from("user_profiles").select("tier, paid_started_at, paid_until").eq("id", userId).maybeSingle();

  const patch = { stripe_subscription_id: deleted ? null : sub.id };
  if (customerId) patch.stripe_customer_id = customerId;

  if (terminal) {
    // Revoke as of now — the ONLY path that lowers paid_until.
    patch.paid_until = new Date().toISOString();
    patch.paid_pause_started = null;
  } else if (paidNow && periodEnd) {
    // Extend only forward — a stale/duplicate event can never rewind access.
    const curMs = current?.paid_until ? new Date(current.paid_until).getTime() : 0;
    patch.paid_until = new Date(periodEnd).getTime() > curMs ? periodEnd : current.paid_until;
    patch.paid_pause_started = null;
    if (current?.tier !== "admin") patch.tier = "paid";
    if (!current?.paid_started_at) patch.paid_started_at = new Date().toISOString();
  }
  // GRACE (past_due / incomplete / paused): touch neither paid_until nor tier.

  const { error } = await admin.from("user_profiles").update(patch).eq("id", userId);
  if (error) console.error("[stripe webhook] profile update failed", error.message);
  else console.log(`[stripe webhook] ${deleted ? "deleted" : status} → user ${userId} paid_until=${patch.paid_until || "(unchanged)"}`);
}

async function handleWebhook(req, res) {
  const stripe = getStripe();
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers["stripe-signature"];
    if (whSecret) {
      event = stripe.webhooks.constructEvent(raw, sig, whSecret);
    } else {
      event = JSON.parse(raw.toString("utf8"));
      console.warn("[stripe webhook] STRIPE_WEBHOOK_SECRET unset — signature NOT verified (dev only)");
    }
  } catch (e) {
    console.error("[stripe webhook] signature verification failed:", e?.message);
    return res.status(400).json({ error: `webhook signature error: ${e?.message}` });
  }

  try {
    const admin = getSupabaseAdmin();
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          if (!sub.metadata?.supabase_user_id && session.client_reference_id) {
            sub.metadata = { ...(sub.metadata || {}), supabase_user_id: session.client_reference_id };
          }
          await applySubscription(admin, stripe, sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await applySubscription(admin, stripe, event.data.object, {
          deleted: event.type === "customer.subscription.deleted",
        });
        break;
      }
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        // `invoice.subscription` was removed from recent Stripe API versions (moved
        // under invoice.parent / line-item parent) — the same migration handled for
        // current_period_end. Resolve it robustly so this renewal safety-net path
        // doesn't silently no-op.
        const inv = event.data.object;
        const subRef =
          inv.subscription
          ?? inv.parent?.subscription_details?.subscription
          ?? inv.lines?.data?.[0]?.parent?.subscription_item_details?.subscription
          ?? null;
        if (subRef) {
          const sub = await stripe.subscriptions.retrieve(typeof subRef === "string" ? subRef : subRef.id);
          await applySubscription(admin, stripe, sub);
        }
        break;
      }
      default:
        break;
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("[stripe webhook] handler crash", e);
    return res.status(500).json({ error: "handler error" });
  }
}

// ─── router ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
  const action = req.query.action;
  try {
    if (action === "checkout") return await handleCheckout(req, res);
    if (action === "portal") return await handlePortal(req, res);
    if (action === "webhook") return await handleWebhook(req, res);
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[stripe] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
