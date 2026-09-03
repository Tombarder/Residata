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
import { FALLBACK_MONTHLY_CENTS } from "../src/lib/pricingDefaults.js";
import { invoiceSellerFooter } from "../src/lib/company.js";

export const config = { api: { bodyParser: false } };
export const maxDuration = 15;

// The resilient FALLBACK price. The live price is read from public.pricing_config
// at checkout time (see resolvePriceCents) so it can be changed from the admin
// Pricing tool with no code edit or deploy; if that read fails, checkout falls
// back to this so a customer can always pay. Checkout defines the price inline
// (price_data below) — NO Stripe Price object, NO STRIPE_PRICE_ID.
//
// It is IMPORTED, not written here. This used to be a local 7999 while the site
// displayed €279.99 — a failed DB read would have subscribed someone at €79.99
// for the life of their subscription. One shared constant, one number.
const MONTHLY_PRICE_CENTS = FALLBACK_MONTHLY_CENTS;

// Sanity bounds — a DB-driven price must never charge a nonsensical amount even
// if the config row is fat-fingered. Outside [€1, €10 000] we ignore it and use
// the fallback constant. (Cents.)
const PRICE_MIN_CENTS = 100;
const PRICE_MAX_CENTS = 1000000;

async function resolvePriceCents(admin) {
  try {
    // Race the read against a 3s timeout: a hung DB read must NEVER stall or fail
    // checkout — the revenue path falls back to the constant instead.
    const query = admin
      .from("pricing_config")
      .select("monthly_price_cents")
      .eq("id", 1)
      .maybeSingle();
    const timeout = new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), 3000));
    const res = await Promise.race([query, timeout]);
    if (res && res.__timeout) {
      console.warn("[stripe] pricing_config read timed out — using fallback price");
      return MONTHLY_PRICE_CENTS;
    }
    const { data, error } = res;
    if (error || !data) return MONTHLY_PRICE_CENTS;
    const c = Number(data.monthly_price_cents);
    if (!Number.isInteger(c) || c < PRICE_MIN_CENTS || c > PRICE_MAX_CENTS) {
      return MONTHLY_PRICE_CENTS;
    }
    return c;
  } catch {
    return MONTHLY_PRICE_CENTS;
  }
}

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
  const priceCents = await resolvePriceCents(admin);

  const params = {
    mode: "subscription",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "eur",
        product_data: { name: "Residata — Full access" },
        unit_amount: priceCents,
        recurring: { interval: "month" },
      },
    }],
    client_reference_id: user.id,
    subscription_data: { metadata: { supabase_user_id: user.id } },
    allow_promotion_codes: true,
    // REQUIRED, not "auto". An invoice that cannot state the buyer's address is
    // not a document a Slovak or Czech accountant can book, and "auto" means
    // Stripe asks only when it feels like it.
    billing_address_collection: "required",
    // Collects the buyer's VAT number (IČ DPH / DIČ / VAT ID) and attaches it to
    // the customer, so Stripe prints it on every invoice by itself. It is also
    // the fact that decides reverse charge: an EU VAT number outside Slovakia
    // means the tax is the buyer's to account for, not ours.
    tax_id_collection: { enabled: true },
    // The company registration number has no native Stripe field, so it is a
    // custom field. Optional on purpose — a sole trader or a foreign buyer may
    // legitimately not have one, and a hard requirement would block the sale.
    // The webhook copies whatever is entered onto the customer, from where it
    // prints on every future invoice.
    custom_fields: [
      {
        // ALPHANUMERIC ONLY — Stripe rejects the whole session otherwise, and
        // "company_id" (with the underscore) did exactly that. Label is capped
        // at 50 characters by the API.
        key: "companyid",
        label: { type: "custom", custom: "IČO / Company registration number" },
        type: "text",
        optional: true,
        text: { maximum_length: 32 },
      },
    ],
    // We are not VAT-registered, so there is no tax to calculate yet. When the
    // company registers, this becomes { enabled: true } and Stripe applies the
    // rate and the reverse charge using the address and VAT number collected
    // above — which is why collecting them now matters even while tax is off.
    automatic_tax: { enabled: false },
    // Force EUR as the presentment currency. Stripe "Adaptive Pricing" (on by
    // default) auto-converts the EUR price into the visitor's local currency
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
  if (profile?.stripe_customer_id) {
    params.customer = profile.stripe_customer_id;
    // When an existing customer is passed, Checkout will NOT save the name or
    // address it just collected unless it is told it may. Without this, a
    // returning subscriber's invoice silently keeps whatever was on file before
    // — which today is nothing.
    params.customer_update = { name: "auto", address: "auto" };
  }
  else if (user.email) params.customer_email = user.email;

  // Everything in here is an ENHANCEMENT: the currency pin, and the three fields
  // that make an invoice usable for a business. Each is only understood by
  // recent Stripe API versions, and a rejected parameter fails the whole session
  // — which would take the revenue path down entirely. So a rejection drops that
  // one parameter and tries again, rather than turning a nicety into an outage.
  // Required parameters (mode, line_items, urls) are never in this set: if one
  // of those is wrong, failing loudly is correct.
  const DEGRADABLE = ["adaptive_pricing", "custom_fields", "tax_id_collection", "customer_update"];
  let session;
  {
    const attempt = { ...params };
    const dropped = [];
    for (;;) {
      try {
        session = await stripe.checkout.sessions.create(attempt);
        break;
      } catch (e) {
        const msg = String(e?.message || "");
        const bad = DEGRADABLE.find((k) => e?.param === k || (k in attempt && msg.includes(k)));
        if (!bad) throw e;                       // a real error — do not paper over it
        delete attempt[bad];
        dropped.push(bad);
        console.warn(`[stripe] "${bad}" rejected by this API version — retrying without it`);
      }
    }
    if (dropped.length) {
      // Loud, because a checkout that quietly stopped collecting the buyer's
      // company details still produces an invoice nobody can book.
      console.warn(`[stripe] checkout created WITHOUT: ${dropped.join(", ")} — invoices may be missing buyer details`);
    }
  }
  return res.status(200).json({ url: session.url });
}

/**
 * Store the buyer's billing identity and make it print on their invoices.
 *
 * Two separate jobs, and both matter:
 *
 *  1. Write it to OUR database, so the invoice details are ours and survive
 *     independently of Stripe — needed for the EU sales list (a Czech business
 *     customer has to be reported monthly by VAT number) and for any invoice we
 *     ever issue outside Stripe.
 *
 *  2. Write the company registration number onto the STRIPE CUSTOMER as an
 *     invoice custom field, because that is what makes it appear on every
 *     future invoice for that subscription — not just this first one. The VAT
 *     number needs no such step: tax_id_collection attaches it to the customer
 *     and Stripe prints it automatically.
 *
 * Never throws. A billing detail that fails to save is worth a log line, not a
 * failed webhook that Stripe will retry and that could double-apply elsewhere.
 */
async function persistBillingIdentity(admin, stripe, session) {
  const userId = session.client_reference_id
    || session.metadata?.supabase_user_id
    || null;
  if (!userId) return;

  const details = session.customer_details || {};
  const address = details.address || null;
  // Checkout returns the custom field under whichever type it was declared as.
  const companyId = (session.custom_fields || [])
    .find((f) => f.key === "companyid")?.text?.value?.trim() || null;
  // tax_ids is an array; a buyer can in principle supply more than one, but
  // Checkout collects a single VAT number, so take the first non-empty value.
  const vatId = (details.tax_ids || [])
    .map((t) => t?.value)
    .find((v) => v && String(v).trim()) || null;

  const patch = {
    billing_company_name: details.name || null,
    billing_company_id: companyId,
    billing_vat_id: vatId,
    billing_address: address,
    billing_country: address?.country || null,
    billing_updated_at: new Date().toISOString(),
  };
  // Do not blank a detail we already hold just because this session did not
  // collect it — a returning customer may check out without re-entering
  // everything, and an invoice losing the buyer's IČO is worse than a stale one.
  for (const k of Object.keys(patch)) {
    if (patch[k] === null && k !== "billing_updated_at") delete patch[k];
  }
  if (Object.keys(patch).length <= 1) return;

  const { error } = await admin.from("user_profiles").update(patch).eq("id", userId);
  if (error) throw new Error(`user_profiles update: ${error.message}`);

  // Put both sides of the invoice onto the Stripe customer, so they print on
  // every invoice from here on rather than only the one this checkout created.
  //
  //   custom_fields → the BUYER's registration number
  //   footer        → OUR identification as the supplier
  //
  // The footer matters more than it looks: Stripe prints the seller from the
  // account's business profile, which is a dashboard setting and — until the
  // account is moved to the company — still names a private individual. Writing
  // it here means the legally required supplier details are on the document
  // either way, and they pick up the DIČ and IBAN by themselves once those
  // exist. Best effort: an invoice detail is never worth failing a webhook that
  // Stripe would then retry.
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (customerId) {
    const invoice_settings = { footer: invoiceSellerFooter("sk") };
    if (companyId) invoice_settings.custom_fields = [{ name: "IČO", value: companyId.slice(0, 30) }];
    await stripe.customers.update(customerId, { invoice_settings })
      .catch((e) => console.warn("[stripe] invoice settings not written:", e?.message || e));
  }
}

/**
 * Email the paid invoice to the customer, in their own language.
 *
 * Never throws: the caller catches, and an email that fails must not fail the
 * webhook — Stripe would retry it and re-apply the subscription. A missing
 * email is a support request; a retried webhook is a data problem.
 */
async function sendInvoiceEmail(admin, inv) {
  const to = inv.customer_email || null;
  if (!to) return;
  // Only real, payable invoices. A zero-amount one (a fully discounted period,
  // a trial conversion) is not something to email as a receipt.
  if (!(inv.amount_paid > 0)) return;

  // The customer's own language. The key is `language` — `lang` is what the
  // browser uses in localStorage, and reading that name here would have quietly
  // emailed every English-speaking customer in Slovak.
  let lang = "sk";
  const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
  if (customerId) {
    const { data } = await admin
      .from("user_profiles")
      .select("ui_prefs")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    const pref = data?.ui_prefs?.language;
    if (pref === "en" || pref === "sk") lang = pref;
  }

  const { invoicePaidHtml, sendEmail } = await import("./_lib/emails.js");
  await sendEmail({
    to,
    subject: `${lang === "sk" ? "Faktúra" : "Invoice"} ${inv.number || ""} · Residata`.replace(/\s+/g, " ").trim(),
    html: invoicePaidHtml(inv, "https://residata.eu", lang),
    from: process.env.MAIL_FROM || process.env.GMAIL_FROM,
    gmailUser: process.env.GMAIL_FROM,
    gmailPassword: process.env.GMAIL_APP_PASSWORD,
  });
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

// ─── set-price (admin) ─────────────────────────────────────────────────────
// Admin-only write of the DB-driven price. This is the ONLY writer of
// public.pricing_config (the table has no RLS write policy, so the browser can
// never write it directly). We verify the caller is an admin and clamp every
// value to sane bounds before touching a live-money field.
async function handleSetPrice(req, res) {
  if (!isTrustedRequest(req)) return res.status(403).json({ error: "untrusted origin" });
  const admin = getSupabaseAdmin();
  const { user, profile, error, status } = await getUserFromRequest(req, admin);
  if (error) return res.status(status).json({ error });
  if (profile?.tier !== "admin") return res.status(403).json({ error: "admin only" });

  let body;
  try { body = JSON.parse((await readRawBody(req)).toString("utf8") || "{}"); }
  catch { return res.status(400).json({ error: "invalid JSON body" }); }

  const patch = { updated_at: new Date().toISOString(), updated_by: user.id };

  // Monthly price (the actual charge) — required, clamped to [€1, €10 000].
  const cents = Number(body.monthly_price_cents);
  if (!Number.isInteger(cents) || cents < PRICE_MIN_CENTS || cents > PRICE_MAX_CENTS) {
    return res.status(400).json({ error: `monthly_price_cents must be an integer in [${PRICE_MIN_CENTS}, ${PRICE_MAX_CENTS}]` });
  }
  patch.monthly_price_cents = cents;

  // Anchor (struck-through display price) — optional, clamped or null.
  if (body.anchor_price_cents === null || body.anchor_price_cents === "") {
    patch.anchor_price_cents = null;
  } else if (body.anchor_price_cents !== undefined) {
    const a = Number(body.anchor_price_cents);
    if (!Number.isInteger(a) || a < PRICE_MIN_CENTS || a > 2 * PRICE_MAX_CENTS) {
      return res.status(400).json({ error: "anchor_price_cents out of range" });
    }
    patch.anchor_price_cents = a;
  }
  // A crossed-out "regular" price must be strictly above the real price.
  if (patch.anchor_price_cents != null && patch.anchor_price_cents <= cents) {
    return res.status(400).json({ error: "anchor_price_cents must be higher than monthly_price_cents" });
  }

  // Discount notes — optional free text, length-capped.
  for (const k of ["discount_note_en", "discount_note_sk"]) {
    if (body[k] !== undefined) patch[k] = String(body[k] ?? "").slice(0, 400);
  }

  const { data, error: dbErr } = await admin
    .from("pricing_config").update(patch).eq("id", 1).select().maybeSingle();
  if (dbErr) return res.status(500).json({ error: "write failed", detail: dbErr.message });
  // No row updated = the singleton config row is missing → surface it, don't
  // report a silent success (the price would appear "saved" but nothing changed).
  if (!data) return res.status(500).json({ error: "pricing_config row (id=1) missing — cannot save" });
  return res.status(200).json({ ok: true, config: data });
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
    } else if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
      // The webhook is public and signature verification is the ONLY trust boundary. If the
      // secret is ever missing/misconfigured in a DEPLOYED env, FAIL CLOSED — never parse an
      // unsigned body, or an attacker could POST a forged subscription grant. The unsigned
      // fallback below is strictly for local `vercel dev` (VERCEL_ENV unset/development).
      console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET missing in a deployed env — refusing unsigned webhook");
      return res.status(500).json({ error: "webhook secret not configured" });
    } else {
      event = JSON.parse(raw.toString("utf8"));
      console.warn("[stripe webhook] STRIPE_WEBHOOK_SECRET unset — signature NOT verified (local dev only)");
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
        // Capture WHO is buying before anything else. This is the only moment
        // the company name, registration number and VAT number exist in one
        // place; a failure here must never cost the subscription, so it is
        // caught inside and logged rather than thrown.
        await persistBillingIdentity(admin, stripe, session).catch((e) =>
          console.warn("[stripe] billing identity not stored:", e?.message || e));
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
        // Send the invoice ourselves. Stripe can email invoices, but only if
        // someone ticks a box in the dashboard, and the Terms promise the
        // customer a document — a promise should not depend on a setting nobody
        // can see from the code. Sent from `invoice.paid` ONLY: Stripe fires
        // invoice.payment_succeeded for the same invoice, and both arriving here
        // would send the customer two copies.
        if (event.type === "invoice.paid") {
          await sendInvoiceEmail(admin, event.data.object)
            .catch((e) => console.warn("[stripe] invoice email not sent:", e?.message || e));
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
    if (action === "set-price") return await handleSetPrice(req, res);
    if (action === "webhook") return await handleWebhook(req, res);
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[stripe] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
