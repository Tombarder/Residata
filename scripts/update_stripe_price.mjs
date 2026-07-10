// Create a NEW LIVE price for the existing Residata product (Stripe prices are
// immutable, so changing the amount = a new price). Your live key stays in YOUR
// terminal — never shared. Prints the new STRIPE_PRICE_ID to paste into Vercel.
//
// Usage (from residata-frontend):
//   STRIPE_SECRET_KEY=sk_live_xxxx AMOUNT=4999 node scripts/update_stripe_price.mjs
//   (AMOUNT is in cents: 4999 = €49.99. Defaults to 4999 if unset.)

import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key || !key.startsWith("sk_live")) {
  console.error("\n✗ Set your LIVE key first:\n  STRIPE_SECRET_KEY=sk_live_xxxx node scripts/update_stripe_price.mjs\n");
  process.exit(1);
}
const amount = parseInt(process.env.AMOUNT || "4999", 10);
if (!Number.isFinite(amount) || amount < 100) { console.error("✗ bad AMOUNT (cents)"); process.exit(1); }

const stripe = new Stripe(key);
try {
  const products = await stripe.products.list({ active: true, limit: 20 });
  const prod = products.data.find((p) => /residata/i.test(p.name)) || products.data[0];
  if (!prod) { console.error("✗ No product found. Run scripts/setup_stripe_live.mjs first."); process.exit(1); }

  const price = await stripe.prices.create({
    product: prod.id,
    unit_amount: amount,
    currency: "eur",
    recurring: { interval: "month" },
    nickname: `Residata Monthly €${(amount / 100).toFixed(2)}`,
  });
  // Make it the product's default (tidy; not required for checkout).
  try { await stripe.products.update(prod.id, { default_price: price.id }); } catch (_) {}

  console.log(`\n✅ New LIVE price €${(amount / 100).toFixed(2)}/month created on product "${prod.name}".`);
  console.log("\nUpdate ONE Vercel env var (Settings → Environment Variables → edit STRIPE_PRICE_ID):\n");
  console.log("   STRIPE_PRICE_ID =", price.id);
  console.log("\nThen tell Claude \"new price in Vercel\" and it verifies. (Secret key + webhook unchanged.)\n");
} catch (e) {
  console.error("\n✗ Failed:", e?.message || e, "\n");
  process.exit(1);
}
