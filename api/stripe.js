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

import { getStripe, getSupabaseAdmin, getUserFromRequest, ensureCustomer, requestOrigin } from "./_lib/stripe.js";
import { isTrustedRequest } from "./_lib/origin.js";

export const config = { api: { bodyParser: false } };
export const maxDuration = 15;

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
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) return res.status(500).json({ error: "server misconfigured (no STRIPE_PRICE_ID)" });

  const admin = getSupabaseAdmin();
  const { user, profile, error, status } = await getUserFromRequest(req, admin);
  if (error) return res.status(status).json({ error });

  const stripe = getStripe();
  const customerId = await ensureCustomer(stripe, admin, user, profile);
  const origin = requestOrigin(req);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    client_reference_id: user.id,
    subscription_data: { metadata: { supabase_user_id: user.id } },
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    automatic_tax: { enabled: false },
    success_url: `${origin}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app?checkout=cancelled`,
  });
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
async function applySubscription(admin, stripe, sub) {
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

  const active = ["active", "trialing", "past_due"].includes(sub.status);
  // current_period_end moved from the subscription top-level onto each line item
  // in recent Stripe API versions — read item first, fall back to top-level.
  const periodEndUnix = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null;
  const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

  const { data: current } = await admin
    .from("user_profiles").select("tier, paid_started_at").eq("id", userId).maybeSingle();

  const patch = { stripe_subscription_id: sub.id };
  if (customerId) patch.stripe_customer_id = customerId;
  if (active && periodEnd) {
    patch.paid_until = periodEnd;
    patch.paid_pause_started = null;
    if (current?.tier !== "admin") patch.tier = "paid";
    if (!current?.paid_started_at) patch.paid_started_at = new Date().toISOString();
  }

  const { error } = await admin.from("user_profiles").update(patch).eq("id", userId);
  if (error) console.error("[stripe webhook] profile update failed", error.message);
  else console.log(`[stripe webhook] ${sub.status} → user ${userId} paid_until=${patch.paid_until || "(unchanged)"}`);
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
        await applySubscription(admin, stripe, event.data.object);
        break;
      }
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        const subId = event.data.object.subscription;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(typeof subId === "string" ? subId : subId.id);
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
