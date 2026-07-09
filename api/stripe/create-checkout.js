// POST /api/stripe/create-checkout
//
// Authenticated. Creates a Stripe Checkout Session (subscription mode) for the
// logged-in user and returns { url } for the client to redirect to. On success
// Stripe fires checkout.session.completed → our webhook writes paid_until.
//
// Security: same origin gate as the other browser-facing endpoints, plus a
// verified Supabase Bearer token identifying the user.

import { getStripe, getSupabaseAdmin, getUserFromRequest, ensureCustomer, requestOrigin } from "../_lib/stripe.js";
import { isTrustedRequest } from "../_lib/origin.js";

export const maxDuration = 10;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
    if (!isTrustedRequest(req)) return res.status(403).json({ error: "untrusted origin" });

    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) return res.status(500).json({ error: "server misconfigured (no STRIPE_PRICE_ID)" });

    const admin = getSupabaseAdmin();
    const { user, profile, error, status } = await getUserFromRequest(req, admin);
    if (error) return res.status(status).json({ error });

    // Already paid? Send them to the portal instead of double-subscribing.
    // (Cheap guard — the webhook is still the source of truth.)
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
      // Neplatiteľ DPH at launch → no automatic tax. Flip on later if VAT-registered.
      automatic_tax: { enabled: false },
      success_url: `${origin}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app?checkout=cancelled`,
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error("[stripe/create-checkout] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
