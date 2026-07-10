// One-time LIVE-mode billing setup.
//
// Your LIVE secret key stays in YOUR terminal — it is never shared with Claude
// or committed anywhere. This script just uses it to create the live product,
// the €49.99/mo price, and the live webhook, then prints the 3 values to paste
// into Vercel.
//
// Usage (from the residata-frontend folder):
//   STRIPE_SECRET_KEY=sk_live_xxxxxxxx node scripts/setup_stripe_live.mjs
//
// Get sk_live_… from Stripe → toggle to LIVE mode (top-right) → Developers → API keys.

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("\n✗ Set your live key first:\n  STRIPE_SECRET_KEY=sk_live_xxxx node scripts/setup_stripe_live.mjs\n");
  process.exit(1);
}
if (!key.startsWith("sk_live")) {
  console.error("\n✗ That is not a LIVE key (must start with sk_live_). Aborting so we don't re-create test objects.\n");
  process.exit(1);
}

const stripe = new Stripe(key);
try {
  const product = await stripe.products.create({
    name: "Residata",
    description: "Market & data intelligence for real estate and finance — every new-build project in Slovakia & Czechia, refreshed daily.",
    url: "https://residata.eu",
  });
  const price = await stripe.prices.create({
    product: product.id, unit_amount: 4999, currency: "eur",
    recurring: { interval: "month" }, lookup_key: "residata_monthly_live",
  });
  const wh = await stripe.webhookEndpoints.create({
    url: "https://residata.eu/api/webhooks/stripe",
    enabled_events: [
      "checkout.session.completed", "customer.subscription.created",
      "customer.subscription.updated", "customer.subscription.deleted",
      "invoice.paid", "invoice.payment_succeeded",
    ],
  });

  console.log("\n✅ LIVE billing created. Put these THREE into Vercel → project residata →");
  console.log("   Settings → Environment Variables (tick all environments), replacing the test values:\n");
  console.log("   STRIPE_SECRET_KEY      = (the sk_live_… key you just used)");
  console.log("   STRIPE_PRICE_ID        =", price.id);
  console.log("   STRIPE_WEBHOOK_SECRET  =", wh.secret);
  console.log("\nThen tell Claude \"live keys in Vercel\" and it merges to production → real payments on.\n");
} catch (e) {
  console.error("\n✗ Setup failed:", e?.message || e, "\n");
  process.exit(1);
}
