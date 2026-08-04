// ⚠️ DEPRECATED — do NOT use to change the subscription price.
//
// The live price is DB-driven: it lives in public.pricing_config
// (monthly_price_cents / anchor_price_cents) and is edited from the in-app
// admin "Pricing" editor (TextsEditor). Checkout builds the charge from that
// row via inline price_data (api/stripe.js → resolvePriceCents), so a price
// change takes effect immediately with NO new Stripe Price object and NO
// redeploy. Every price display (marketing, Platform billing, Terms) reads the
// same row via usePricing(), so it propagates everywhere automatically.
//
// This script used to create a standalone Stripe Price + print STRIPE_PRICE_ID
// to paste into Vercel — but runtime never reads STRIPE_PRICE_ID, so following
// it did nothing and only caused confusion. Kept as a stub on purpose.

console.log(
  [
    "",
    "⚠️  update_stripe_price.mjs is DEPRECATED — it does not change the live price.",
    "",
    "To change the subscription price:",
    "  → open the app as admin → Pricing editor (writes public.pricing_config),",
    "    OR call api/stripe.js?action=set-price.",
    "  It applies immediately (no redeploy, no new Stripe object) and propagates",
    "  to the marketing page, Platform billing, and the Terms page via usePricing().",
    "",
  ].join("\n"),
);
process.exit(0);
