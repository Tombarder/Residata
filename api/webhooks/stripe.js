// POST /api/webhooks/stripe
//
// Stripe -> us. This is the ONLY source of truth for turning money into access.
// On a paid/renewed subscription we write public.user_profiles.paid_until forward
// (and tier='paid'); the existing capability layer + RLS do the rest. On cancel we
// do nothing destructive — the user keeps access until paid_until lapses, then the
// frontend auto-demotes to free (same as the manual admin model).
//
// Security: NOT origin-gated (Stripe has no browser Origin). Instead every event
// is verified against STRIPE_WEBHOOK_SECRET via the raw request body. bodyParser
// is disabled so the signature check sees the exact bytes Stripe signed.

import { getStripe, getSupabaseAdmin } from "../_lib/stripe.js";

export const config = { api: { bodyParser: false } };
export const maxDuration = 15;

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// Write a user's paid window from a Stripe subscription object.
async function applySubscription(admin, stripe, sub) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  // Resolve the Supabase user id: metadata → stored customer id → customer metadata.
  let userId = sub.metadata?.supabase_user_id || null;
  if (!userId && customerId) {
    const { data } = await admin
      .from("user_profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
    userId = data?.id || null;
  }
  if (!userId && customerId) {
    try {
      const c = await stripe.customers.retrieve(customerId);
      userId = c?.metadata?.supabase_user_id || null;
    } catch { /* ignore */ }
  }
  if (!userId) {
    console.warn("[stripe webhook] could not resolve user for subscription", sub.id);
    return;
  }

  const active = ["active", "trialing", "past_due"].includes(sub.status);
  // Recent Stripe API versions moved current_period_end from the subscription
  // top-level onto each line item. Read the item first, fall back to top-level
  // (older versions) so paid_until is set correctly regardless of API version.
  const periodEndUnix =
    sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null;
  const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

  // Read current row so we never demote an admin and only stamp paid_started_at once.
  const { data: current } = await admin
    .from("user_profiles")
    .select("tier, paid_started_at")
    .eq("id", userId)
    .maybeSingle();

  const patch = { stripe_subscription_id: sub.id };
  if (customerId) patch.stripe_customer_id = customerId;

  if (active && periodEnd) {
    patch.paid_until = periodEnd;          // renewals push this forward automatically
    patch.paid_pause_started = null;       // paying clears any pause
    if (current?.tier !== "admin") patch.tier = "paid";
    if (!current?.paid_started_at) patch.paid_started_at = new Date().toISOString();
  }
  // Inactive (canceled/unpaid): leave paid_until as-is → access lapses naturally at period end.

  const { error } = await admin.from("user_profiles").update(patch).eq("id", userId);
  if (error) console.error("[stripe webhook] profile update failed", error.message);
  else console.log(`[stripe webhook] ${sub.status} → user ${userId} paid_until=${patch.paid_until || "(unchanged)"}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const stripe = getStripe();
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    const raw = await readRawBody(req);
    const sig = req.headers["stripe-signature"];
    if (whSecret) {
      event = stripe.webhooks.constructEvent(raw, sig, whSecret);
    } else {
      // Dev-only fallback so local testing without a signing secret still works.
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
        // Ignore everything else.
        break;
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("[stripe webhook] handler crash", e);
    return res.status(500).json({ error: "handler error" });
  }
}
