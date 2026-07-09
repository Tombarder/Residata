// POST /api/stripe/portal
//
// Authenticated. Returns { url } to Stripe's hosted Billing Portal so the user
// can update their card, see invoices, or cancel — entirely self-serve, no
// admin work. Requires the user to already have a Stripe customer id.

import { getStripe, getSupabaseAdmin, getUserFromRequest, requestOrigin } from "../_lib/stripe.js";
import { isTrustedRequest } from "../_lib/origin.js";

export const maxDuration = 10;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
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
  } catch (e) {
    console.error("[stripe/portal] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
