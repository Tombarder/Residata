/**
 * pricingDefaults — the ONE fallback price, for when public.pricing_config
 * cannot be read.
 *
 * The live price has a single source: the `pricing_config` row, edited in the
 * admin Pricing editor. Everything reads it — the pricing page, the Terms, the
 * billing panel, the structured data, and Stripe at checkout. That part was
 * always right.
 *
 * What was NOT right: each of those readers carried its OWN hardcoded number
 * for the case where the read fails, and they had drifted apart —
 *
 *   api/stripe.js        €79.99     ← the one that actually CHARGES money
 *   src/lib/pricing.js   €279.99
 *   LegalPages / Platform / marketingCopy / vite.config   €349.99
 *   Platform anchor      €349.99    ← identical to the price, so the
 *                                     "regular price" struck through on the
 *                                     billing panel showed the same number
 *
 * So a failed database read at checkout would have quietly subscribed a
 * customer at €79.99/month — for the life of that subscription — while every
 * page on the site said €279.99. Not hypothetical: the read is raced against a
 * 3-second timeout precisely because it can fail.
 *
 * Hence this file: ONE constant, imported by the browser bundle, by the Vercel
 * function that talks to Stripe, and by the build scripts. There is no second
 * number to forget.
 *
 * ── KEEPING IT HONEST ───────────────────────────────────────────────────────
 * A fallback is by nature a copy of something that lives in the database, so it
 * can go stale the moment the price is edited. Two things keep it from doing
 * damage:
 *   1. src/lib/pricingDefaults.test.mjs fails if these values disagree with the
 *      live pricing_config row.
 *   2. The admin Pricing editor warns when it saves a price that differs from
 *      the fallback, so whoever changes the price learns immediately.
 * If you change the price in the editor, change it here in the same session.
 */

/** Monthly subscription, in cents. Mirrors pricing_config.monthly_price_cents. */
export const FALLBACK_MONTHLY_CENTS = 27999;

/** Regular / anchor price, in cents. Mirrors pricing_config.anchor_price_cents. */
export const FALLBACK_ANCHOR_CENTS = 47999;

/** "€279.99" from 27999; whole euros lose the decimals (8000 → "€80"). */
export function eurFromCents(cents) {
  if (cents == null || cents === "") return null;
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  const eur = n / 100;
  return "€" + (Number.isInteger(eur) ? String(eur) : eur.toFixed(2));
}

/** "€279.99" — the fallback monthly price as displayed. */
export const FALLBACK_MONTHLY_DISPLAY = eurFromCents(FALLBACK_MONTHLY_CENTS);

/** "€479.99" — the fallback anchor price as displayed. */
export const FALLBACK_ANCHOR_DISPLAY = eurFromCents(FALLBACK_ANCHOR_CENTS);
