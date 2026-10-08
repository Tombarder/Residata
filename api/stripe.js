// api/stripe.js
//
// ONE consolidated Stripe endpoint — one serverless function instead of three,
// to stay within the plan's function budget. Same behaviour as three separate
// endpoints; routing is by ?action=:
//   POST /api/stripe?action=checkout   (authed)  → Checkout Session { url }
//   POST /api/stripe?action=portal     (authed)  → Billing Portal  { url }
//   POST /api/stripe?action=subscription (authed) → the caller's card subscription
//        as Stripe has it now: { subscription: { status, ends_at } | null }
//   POST /api/stripe?action=webhook    (Stripe)  → writes paid_until
//
// The webhook keeps its public URL /api/webhooks/stripe via a single rewrite in
// vercel.json → /api/stripe?action=webhook, so the URL configured in Stripe
// never changes. bodyParser is disabled for the whole function because the
// webhook needs the raw bytes for signature verification; checkout/portal don't
// read the body at all.

import { getStripe, getSupabaseAdmin, getUserFromRequest, requestOrigin } from "./_lib/stripe.js";
import { isTrustedRequest } from "./_lib/origin.js";
import { rejectIfNotCron } from "./_lib/cronAuth.js";
import { FALLBACK_MONTHLY_CENTS } from "../src/lib/pricingDefaults.js";
import { invoiceSellerFooter } from "../src/lib/company.js";
import { invoiceFacts, invoiceKind, nextChargeCents, businessSummary, invoiceRow, subscriptionRow } from "../src/lib/billingStats.js";

export const config = { api: { bodyParser: false } };

/** Subscription statuses after which Stripe charges nothing again. */
const CARD_DONE = ["canceled", "unpaid", "incomplete_expired"];
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
        product_data: { name: "Residata Premium" },
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
    // Back to Billing, the one page that reads ?checkout= — /app (the Dashboard)
    // never showed "payment received", and before the webhook landed it showed a
    // free account with a trial offer to someone who had just paid.
    success_url: `${origin}/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app/billing?checkout=cancelled`,
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
  // TWO GUARDS AGAINST BUYING THE SAME SUBSCRIPTION TWICE. The sister product
  // has had these since its billing was written; this one did not, and the
  // failure they prevent is the worst kind — the customer is charged twice,
  // notices before we do, and their first experience of paying us is a refund
  // request.
  //
  //   1. Already subscribed → do not open checkout at all. An active
  //      subscription plus a second one is two charges a month, forever, until
  //      somebody spots it.
  //   2. Idempotency key → two rapid attempts (a double-click, an impatient
  //      retry, two tabs) collapse into ONE Checkout Session at Stripe rather
  //      than creating two. The key changes every 10 minutes, which is longer
  //      than any double-click and shorter than a genuine change of mind; by
  //      the time it rotates, the webhook has normally landed and guard 1
  //      catches the repeat instead.
  //
  //   Guard 1 asks STRIPE whether the subscription is still alive, not our
  //   dates: while a renewal is failing (past_due) Stripe keeps retrying the old
  //   invoice after paid_until has passed, so a date check let the person
  //   "Resubscribe" — and when the retry succeeded they paid twice.
  //   Guard 1b: Premium with no end date, or admin — there is nothing to buy.
  //   Guard 0: an account the admin blocked ("No access"). applySubscription
  //   rightly refuses to hand it Premium back, so letting it pay would take the
  //   money and give nothing — the screens hide the button, the server decides.
  if (profile?.tier === "pending") {
    return res.status(403).json({ error: "account_blocked", detail: "This account has no access. Write to info@residata.eu." });
  }
  if (profile?.stripe_subscription_id) {
    let live = null;
    try { live = await stripe.subscriptions.retrieve(profile.stripe_subscription_id); }
    catch (e) { if (e?.code !== "resource_missing") throw e; }
    // A first payment that never completed (bank declined, 3-D Secure abandoned)
    // leaves an `incomplete` subscription: nothing was paid and nothing runs. It
    // used to answer "already subscribed" — the customer who tried again was
    // locked out of paying. Cancel the stale one (Stripe voids its open invoice)
    // and let this checkout start clean (review 2026-10-08).
    if (live?.status === "incomplete") {
      try { await stripe.subscriptions.cancel(live.id); live = null; }
      catch (e) { console.warn("[stripe checkout] stale incomplete subscription not cancelled:", e?.message || e); }
    }
    if (live && !CARD_DONE.includes(live.status)) {
      return res.status(409).json({
        error: "already subscribed",
        detail: "This account already has a subscription. Manage it under Billing.",
      });
    }
  }
  if (profile?.tier === "admin" || (profile?.tier === "paid" && !profile?.paid_until && !profile?.paid_pause_started)) {
    return res.status(409).json({ error: "already_premium", detail: "This account already has Premium with no end date." });
  }
  // NOTE: in the Node SDK the idempotency key is a REQUEST OPTION (second
  // argument), not a body parameter. Putting it in `params` would send Stripe an
  // unknown field and buy no protection at all — the sister product is Python,
  // where the SDK folds request options into the same call, which is exactly the
  // kind of difference that gets copied across languages and silently does
  // nothing.
  //
  // AND YES, ONE KEY IS CORRECT ACROSS THE RETRY LOOP BELOW — do not "fix" this
  // by varying the key per attempt. Reusing a key with different parameters is
  // normally an error ("the idempotency layer compares incoming parameters to
  // those of the original request and errors if they're not the same"), which
  // makes the loop look broken. It is not, because of the exception that applies
  // to exactly this case: Stripe saves a result "only after the execution of an
  // endpoint begins. If incoming parameters fail validation [...] we don't save
  // the idempotent result [...] You can retry these requests."
  // (https://docs.stripe.com/api/idempotent_requests, read 2026-09-03.)
  //
  // A rejected DEGRADABLE parameter IS a validation failure, so the key is never
  // burned and the retry is free. Varying the key per attempt would instead
  // reopen the double-charge window the key exists to close.
  const idempotencyKey = `checkout:${user.id}:${priceCents}:${Math.floor(Date.now() / 600000)}`;

  let session;
  {
    const attempt = { ...params };
    const dropped = [];
    for (;;) {
      try {
        session = await stripe.checkout.sessions.create(attempt, { idempotencyKey });
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
    const invoice_settings = { footer: invoiceSellerFooter("sk", await bankDetailsFromSecrets(admin)) };
    if (companyId) invoice_settings.custom_fields = [{ name: "IČO", value: companyId.slice(0, 30) }];
    await stripe.customers.update(customerId, { invoice_settings })
      .catch((e) => console.warn("[stripe] invoice settings not written:", e?.message || e));
  }
}

/**
 * Apply a Stripe Customer's current billing identity to our own record.
 *
 * `checkout.session.completed` catches the details as they are first entered.
 * This catches every later change — a customer correcting their company name
 * or adding a VAT number in the billing portal, which they can now do because
 * the portal allows it. Without this the invoice would be right and our
 * database wrong, and the database is what the EU sales list is built from.
 *
 * Only ever fills IN. A Stripe update that carries no address (a default
 * payment-method change, for instance) must not blank the address we hold.
 */
async function syncCustomerBillingIdentity(admin, customer) {
  if (!customer?.id) return;
  const addr = customer.address || null;
  const vatId = (customer.tax_ids?.data || [])
    .map((t) => t?.value)
    .find((v) => v && String(v).trim()) || null;
  const companyId = (customer.invoice_settings?.custom_fields || [])
    .find((f) => f?.name === "IČO")?.value || null;

  const patch = { billing_updated_at: new Date().toISOString() };
  if (customer.name) patch.billing_company_name = customer.name;
  if (addr) { patch.billing_address = addr; if (addr.country) patch.billing_country = addr.country; }
  if (vatId) patch.billing_vat_id = vatId;
  if (companyId) patch.billing_company_id = companyId;
  if (Object.keys(patch).length <= 1) return;

  const { error } = await admin
    .from("user_profiles")
    .update(patch)
    .eq("stripe_customer_id", customer.id);
  if (error) throw new Error(`user_profiles update: ${error.message}`);
}

/**
 * The company's bank details, for the payment line on an invoice.
 *
 * They live in public.app_secrets — RLS on with ZERO policies, so no client
 * key can read the table at all — and never in src/lib/company.js, which is
 * bundled into the browser and sits in a public repository. An IBAN a customer
 * receives on their own invoice is a payment instruction; an IBAN anyone can
 * download is an invitation to send our customers a forged one.
 *
 * Returns {} if the row is missing, and the caller then produces a footer with
 * no payment line rather than failing — a supplier block without bank details
 * is still a valid supplier block.
 */
async function bankDetailsFromSecrets(admin) {
  try {
    const { data } = await admin
      .from("app_secrets")
      .select("key, value")
      .in("key", ["company_iban", "company_bank_name"]);
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    return { iban: by.company_iban || "", bankName: by.company_bank_name || "" };
  } catch (e) {
    console.warn("[stripe] bank details unavailable:", e?.message || e);
    return {};
  }
}

/**
 * The customer's language for a payment e-mail (review 2026-10-08). `ui_prefs.language`
 * is written only after an explicit pick, and the site defaults to English — so a
 * foreign customer who never touched the switch got the welcome in Slovak. The chain:
 * explicit pick → the language they signed up in → Stripe (preferred locale, billing
 * country Slovakia) → English.
 */
async function customerLang(admin, stripe, { customerId = null, userId = null, country = null } = {}) {
  let prof = null;
  try {
    if (userId) ({ data: prof } = await admin.from("user_profiles").select("id, ui_prefs, full_name").eq("id", userId).maybeSingle());
    if (!prof && customerId) ({ data: prof } = await admin.from("user_profiles").select("id, ui_prefs, full_name").eq("stripe_customer_id", customerId).maybeSingle());
  } catch { /* the language falls through */ }
  const name = prof?.full_name ? String(prof.full_name).split(" ")[0] : null;
  const pick = prof?.ui_prefs?.language;
  if (pick === "sk" || pick === "en") return { lang: pick, name };
  if (prof?.id) {
    try {
      const { data } = await admin.auth.admin.getUserById(prof.id);
      const l = data?.user?.user_metadata?.lang;
      if (l === "sk" || l === "en") return { lang: l, name };
    } catch { /* no auth admin API here — next source */ }
  }
  if (country) return { lang: String(country).toUpperCase() === "SK" ? "sk" : "en", name };
  if (customerId && stripe) {
    try {
      const c = await stripe.customers.retrieve(customerId);
      const loc = String(c?.preferred_locales?.[0] || "").toLowerCase();
      if (loc) return { lang: loc.startsWith("sk") ? "sk" : "en", name };
      if (c?.address?.country) return { lang: c.address.country === "SK" ? "sk" : "en", name };
    } catch { /* default below */ }
  }
  return { lang: "en", name };
}

const customerOf = (o) => (typeof o?.customer === "string" ? o.customer : o?.customer?.id) || null;
const userOfInvoice = (inv) => inv?.parent?.subscription_details?.metadata?.supabase_user_id || null;
const subOfInvoice = (inv) => {
  const r = inv?.subscription ?? inv?.parent?.subscription_details?.subscription
    ?? inv?.lines?.data?.[0]?.parent?.subscription_item_details?.subscription ?? null;
  return typeof r === "string" ? r : r?.id || null;
};

/**
 * Email the paid invoice to the customer, in their own language.
 *
 * Throws when the send failed (after releasing the claim): the webhook then answers
 * 500 and Stripe redelivers — the claim dedupes the e-mails that did go out.
 */
async function sendInvoiceEmail(admin, inv, stripe = null) {
  const to = inv.customer_email || null;
  if (!to) return;
  // Only real, payable invoices — except the FIRST one: a 100 % coupon (or a credit
  // balance) still starts Premium, and that customer deserves the welcome too (review
  // 2026-10-08: Boss got "new customer €0.00", the customer got nothing).
  const kind = invoiceKind(inv);
  if (!(inv.amount_paid > 0) && kind !== "new") return;

  // CLAIM THE SEND BEFORE SENDING. Stripe redelivers a webhook whenever the
  // handler does not return 2xx, and plenty can fail after an email has gone
  // out — so the insert, not the send, is what decides whether this delivery is
  // the one that mails the customer. A retry collides with the primary key and
  // returns here. Two invoices for one payment is what a finance department
  // escalates.
  const customerId = customerOf(inv);
  if (!(await claimMail(admin, inv.id, { customerId, to, amount: inv.amount_paid, currency: inv.currency }))) return;

  try {
    const { lang, name } = await customerLang(admin, stripe, { customerId, userId: userOfInvoice(inv), country: inv.customer_address?.country });
    // FIRST PAYMENT = THE WELCOME (Boss 2026-10-07). One e-mail, not two: the
    // celebration carries the invoice; a renewal gets the invoice alone. The PDF is
    // attached — an accountant files an attachment, not a link — and when Stripe's
    // PDF cannot be fetched the e-mail still goes, with the download button.
    const facts = await paymentFacts(stripe, inv);
    const pdf = await fetchInvoicePdf(inv.invoice_pdf);   // a 0 € invoice is a document too
    const p = { ...facts, name, pdfAttached: Boolean(pdf) };
    const { customerPaymentHtml, customerPaymentSubject, sendEmail } = await import("./_lib/emails.js");
    // No `conversational` flag: an invoice is machine mail, so it goes from
    // noreply@ per api/_lib/senders.js, which names invoices explicitly.
    await sendEmail({
      to,
      subject: customerPaymentSubject(p, lang),
      html: customerPaymentHtml(p, "https://residata.eu", lang),
      gmailUser: process.env.GMAIL_FROM,
      gmailPassword: process.env.GMAIL_APP_PASSWORD,
      attachments: pdf ? [{ filename: `${lang === "sk" ? "Faktura" : "Invoice"}-${inv.number || inv.id}.pdf`, content: pdf, contentType: "application/pdf" }] : undefined,
    });
    // Record which language actually went out — the claim above was written
    // before we knew it, and support answering "what did they receive?" wants it.
    await admin.from("invoice_emails_sent").update({ lang }).eq("invoice_id", inv.id);
  } catch (e) {
    // RELEASE THE CLAIM. The row above exists to stop a redelivered webhook
    // sending a SECOND copy — it must not also stop the FIRST one. The webhook
    // answers 500 for this, so Stripe's retry delivers it.
    await releaseMail(admin, inv.id);
    throw e;
  }
}

// ─── payment e-mails to the owner (Boss 2026-10-07) ──────────────────────
// "wanna get notified if someone pays (both on residata and on kamhalco same way i
// get when there is new customer)". Every money event → one e-mail to ADMIN_EMAIL,
// never two: the send is claimed in invoice_emails_sent first, under its own key
// ("owner-paid:<invoice>", "owner-failed:<invoice>", "owner-cancel:<sub>:<when>",
// "owner-reactivated:<sub>:<when>", "owner-ended:<sub>", "owner-refund:<charge>:<total>",
// "owner-dispute:<dispute>:<created|closed>"; the customer's: "<invoice>", "failed:<invoice>",
// "failed-final:<invoice>", "customer-cancel:<sub>:<when>", "customer-ended:<sub>").
// That table is "one row per e-mail that actually went out"; reusing it needs no new table.

/** Claim one e-mail; false = somebody already sent it. Throws on a real DB error. */
async function claimMail(admin, key, { customerId = null, to, amount = null, currency = "eur", lang = "sk" } = {}) {
  const { error } = await admin.from("invoice_emails_sent").insert({
    invoice_id: key, customer_id: customerId || null, sent_to: to,
    amount_cents: amount, currency: currency || "eur", lang,
  });
  if (!error) return true;
  if (error.code === "23505") return false;     // unique violation = already sent
  throw new Error(`invoice_emails_sent: ${error.message}`);
}
const releaseMail = (admin, key) => admin.from("invoice_emails_sent").delete().eq("invoice_id", key);

const stripeDashUrl = (path) =>
  `https://dashboard.stripe.com/${/^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY || "") ? "test/" : ""}${path}`;

/** Stripe's invoice PDF (a signed public URL), or null. Never throws. */
async function fetchInvoicePdf(url) {
  if (!url) return null;
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length < 6 * 1024 * 1024 && buf.subarray(0, 4).toString() === "%PDF" ? buf : null;
  } catch (e) {
    console.warn("[stripe] invoice PDF not fetched:", e?.message || e);
    return null;
  }
}

/**
 * The next charge, ASKED FROM STRIPE (upcoming-invoice preview) rather than re-derived
 * from coupon rules — the preview knows credit balance, item discounts and a repeating
 * coupon that runs out on the boundary. Null = unknown (shown without an amount).
 * `undefined` = the preview is not available here → the caller may fall back.
 */
async function previewNext(stripe, subId) {
  if (!stripe?.invoices?.createPreview || !subId) return undefined;
  try {
    const pv = await stripe.invoices.createPreview({ subscription: subId });
    return Number.isFinite(Number(pv?.amount_due)) ? Number(pv.amount_due) : null;
  } catch (e) {
    console.warn("[stripe] next-invoice preview unavailable:", e?.message || e);
    return null;
  }
}

/**
 * The facts every payment e-mail shows. Remembered per invoice OBJECT — i.e. for the one
 * webhook delivery that carries it (the customer and the owner e-mail need the same facts,
 * and a later delivery must read Stripe afresh).
 */
const factsCache = new WeakMap();
async function paymentFacts(stripe, inv) {
  if (factsCache.has(inv)) return factsCache.get(inv);
  const f = invoiceFacts(inv);
  let discounts = (inv.discounts || []).filter((d) => d && typeof d === "object");
  if (!discounts.length && f.discount && stripe && inv.id) {
    try {
      const full = await stripe.invoices.retrieve(inv.id, { expand: ["discounts.source.coupon"] });
      discounts = (full?.discounts || []).filter((d) => d && typeof d === "object");
    } catch (e) {
      console.warn("[stripe] invoice discounts not loaded:", e?.message || e);
    }
  }
  const coupon = discounts.map((d) => d.source?.coupon || d.coupon).find((c) => c && typeof c === "object");
  let nextAmount = inv.status === "paid" ? await previewNext(stripe, subOfInvoice(inv)) : null;
  if (nextAmount === undefined) nextAmount = nextChargeCents(f, discounts);
  const out = {
    kind: f.kind,
    amount: Number(inv.amount_paid ?? inv.amount_due ?? 0),
    discount: f.totalDiscount,
    listPrice: f.listPrice,
    coupon: coupon ? (coupon.name || coupon.id) : null,
    currency: inv.currency || "eur",
    number: inv.number || null,
    periodStart: f.periodStart,
    periodEnd: f.periodEnd,
    nextAmount,
    hostedUrl: inv.hosted_invoice_url || null,
    pdfUrl: inv.invoice_pdf || null,
    stripeUrl: inv.id ? stripeDashUrl(`invoices/${inv.id}`) : null,
    attempts: Number(inv.attempt_count || 0),
    nextAttempt: inv.next_payment_attempt || null,
    test: inv.livemode === false,
  };
  factsCache.set(inv, out);
  return out;
}

/** The billing identity PRINTED ON THE INVOICE — what the document says, available on the
 *  first payment (checkout.session.completed, which fills our profile copy, often lands later). */
function invoiceBilling(inv) {
  if (!inv) return null;
  const a = inv.customer_address || {};
  const address = [a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");
  const vat = (inv.customer_tax_ids || []).map((t) => t?.value).filter(Boolean).join(", ");
  const companyId = (inv.custom_fields || []).find((c) => /i[cč]o|company/i.test(String(c?.name || "")))?.value || null;
  return (inv.customer_name || address || vat) ? { name: inv.customer_name || null, companyId, vat: vat || null, address: address || null } : null;
}

/** The person behind a Stripe customer (or a subscription's metadata), with billing identity. */
async function customerPerson(admin, { customerId = null, userId = null, inv = null } = {}) {
  const cols = "id, email, full_name, company, position, phone, created_at, tier, paid_started_at, paid_until, "
    + "stripe_customer_id, stripe_subscription_id, billing_company_name, billing_company_id, billing_vat_id, billing_address";
  let user = null;
  if (userId) ({ data: user } = await admin.from("user_profiles").select(cols).eq("id", userId).maybeSingle());
  if (!user && customerId) ({ data: user } = await admin.from("user_profiles").select(cols).eq("stripe_customer_id", customerId).maybeSingle());
  const fromInvoice = invoiceBilling(inv);
  if (!user) return { user: null, billing: fromInvoice };
  const a = user.billing_address || {};
  const address = [a.line1, a.line2, [a.postal_code, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");
  const fromProfile = (user.billing_company_name || user.billing_vat_id || address)
    ? { name: user.billing_company_name, companyId: user.billing_company_id, vat: user.billing_vat_id, address } : null;
  const billing = fromInvoice || fromProfile
    ? { name: fromInvoice?.name || fromProfile?.name || null, companyId: fromInvoice?.companyId || fromProfile?.companyId || null,
        vat: fromInvoice?.vat || fromProfile?.vat || null, address: fromInvoice?.address || fromProfile?.address || null }
    : null;
  return { user, billing };
}

/** Who to name when we have no profile (deleted account, a customer made in Stripe). */
async function personOrStripe(admin, stripe, { customerId, userId, inv = null, email = null, name = null }) {
  const who = await customerPerson(admin, { customerId, userId, inv });
  if (who.user) return who;
  let e = email || inv?.customer_email || null, n = name || inv?.customer_name || null;
  if ((!e || !n) && customerId && stripe) {
    try { const c = await stripe.customers.retrieve(customerId); e = e || c?.email || null; n = n || c?.name || null; } catch { /* unknown */ }
  }
  return { user: e || n ? { email: e, full_name: n } : null, billing: who.billing };
}

/**
 * Refunds and disputes onto invoices (review 2026-10-08). Stripe leaves a refunded
 * invoice `paid` with `amount_paid` unchanged — the money facts live on the charge and
 * the dispute, linked to the invoice only through its payment intent (measured in the
 * sandbox: invoice.payments[].payment.payment_intent; a charge carries no invoice).
 * Adds `refunded_cents`, `dispute_status`, `dispute_amount` to each invoice. Never throws.
 */
async function attachMoneyFacts(stripe, invoices, { customer = null } = {}) {
  const byPi = new Map();
  for (const i of invoices || []) {
    for (const p of i.payments?.data || []) {
      const pi = p?.payment?.payment_intent;
      if (pi) byPi.set(typeof pi === "string" ? pi : pi.id, i);
    }
  }
  if (!byPi.size) return { truncated: false };
  let truncated = false;
  try {
    let n = 0;
    for await (const ch of stripe.charges.list({ limit: 100, ...(customer ? { customer } : {}) })) {
      if (++n > 2000) { truncated = true; break; }
      const i = byPi.get(typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id);
      if (i && ch.amount_refunded) i.refunded_cents = (i.refunded_cents || 0) + Number(ch.amount_refunded);
    }
  } catch (e) { console.warn("[stripe] refunds not loaded:", e?.message || e); }
  try {
    let n = 0;
    for await (const d of stripe.disputes.list({ limit: 100 })) {
      if (++n > 500) { truncated = true; break; }
      const i = byPi.get(typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id);
      if (i) { i.dispute_status = d.status; i.dispute_amount = Number(d.amount || 0); }
    }
  } catch (e) { console.warn("[stripe] disputes not loaded:", e?.message || e); }
  return { truncated };
}

/** Paying customers, MRR and revenue, straight from Stripe. Null when Stripe cannot be read. */
async function businessNow(stripe) {
  try {
    let truncated = false;
    const subs = [];
    for await (const x of stripe.subscriptions.list({ status: "all", limit: 100, expand: ["data.discounts.source.coupon"] })) {
      if (subs.length >= 1000) { truncated = true; break; }
      subs.push(x);
    }
    const invoices = [];
    for await (const x of stripe.invoices.list({ limit: 100, expand: ["data.payments", "data.discounts.source.coupon"] })) {
      if (invoices.length >= 2000) { truncated = true; break; }
      invoices.push(x);
    }
    const money = await attachMoneyFacts(stripe, invoices);
    const summary = { ...businessSummary(subs, invoices), truncated: truncated || money.truncated };
    return { summary, subs, invoices };
  } catch (e) {
    console.warn("[stripe] business numbers unavailable:", e?.message || e);
    return null;
  }
}

/** One owner e-mail, claimed first — `build` runs only for the delivery that will send. */
async function mailOwner(admin, key, build, { customerId = null, amount = null, currency = "eur" } = {}) {
  const to = process.env.ADMIN_EMAIL || "tkamhal@gmail.com";
  if (!(await claimMail(admin, key, { customerId, to, amount, currency, lang: "en" }))) return false;
  try {
    const { subject, html, replyTo, test } = await build();
    const { sendEmail } = await import("./_lib/emails.js");
    // a preview deployment on the test key must not read like real money
    await sendEmail({ to, subject: test ? `[TEST] ${subject}` : subject, html, replyTo: replyTo || undefined,
      gmailUser: process.env.GMAIL_FROM, gmailPassword: process.env.GMAIL_APP_PASSWORD });
    return true;
  } catch (e) {
    await releaseMail(admin, key);      // a failed send must not block the retry
    throw e;
  }
}

/** One customer e-mail, claimed first. `build(lang, name)` → { subject, html }. */
async function mailCustomer(admin, stripe, key, { to, customerId, userId, country = null, amount = null, currency = "eur" }, build) {
  if (!to) return false;
  if (!(await claimMail(admin, key, { customerId, to, amount, currency }))) return false;
  try {
    const { lang, name } = await customerLang(admin, stripe, { customerId, userId, country });
    const { subject, html } = await build(lang, name);
    const { sendEmail } = await import("./_lib/emails.js");
    await sendEmail({ to, subject, html, gmailUser: process.env.GMAIL_FROM, gmailPassword: process.env.GMAIL_APP_PASSWORD });
    await admin.from("invoice_emails_sent").update({ lang }).eq("invoice_id", key);
    return true;
  } catch (e) {
    await releaseMail(admin, key);
    throw e;
  }
}

async function notifyOwnerPayment(admin, stripe, inv) {
  // a 100 %-discounted first invoice is still a new customer worth knowing about
  if (!(inv.amount_paid > 0) && invoiceKind(inv) !== "new") return;
  const customerId = customerOf(inv);
  await mailOwner(admin, `owner-paid:${inv.id}`, async () => {
    const [facts, who, biz] = await Promise.all([paymentFacts(stripe, inv),
      personOrStripe(admin, stripe, { customerId, userId: userOfInvoice(inv), inv }), businessNow(stripe)]);
    const p = { ...facts, user: who.user, billing: who.billing, business: biz?.summary || null };
    const em = await import("./_lib/emails.js");
    return { subject: em.ownerPaymentSubject(p), html: em.ownerPaymentHtml(p, "https://residata.eu"),
      replyTo: who.user?.email, test: facts.test };
  }, { customerId, amount: inv.amount_paid, currency: inv.currency });
}

/**
 * A payment that did not go through. RE-READ FIRST (review 2026-10-08): Stripe redelivers
 * for three days and does not keep order, so a late `payment_failed` can arrive after the
 * invoice was paid — "check your card" after "thank you" is worse than silence.
 * Three truths, three wordings:
 *  · first payment (kind "new") — nothing started, nothing is retried; link to finish it;
 *  · renewal with a next attempt — Premium is paused until it goes through, Stripe retries;
 *  · renewal with NO next attempt — Stripe gives up; pay the invoice or Premium ends.
 */
async function notifyPaymentFailed(admin, stripe, inv) {
  let fresh = inv;
  try { fresh = (await stripe.invoices.retrieve(inv.id)) || inv; } catch { /* the event's copy */ }
  if (["paid", "void", "uncollectible"].includes(fresh.status)) return;
  inv = { ...inv, status: fresh.status || inv.status, next_payment_attempt: fresh.next_payment_attempt ?? inv.next_payment_attempt,
          attempt_count: fresh.attempt_count ?? inv.attempt_count };
  const customerId = customerOf(inv);
  const userId = userOfInvoice(inv);
  const final = invoiceKind(inv) !== "new" && !inv.next_payment_attempt;
  const [facts, who] = await Promise.all([paymentFacts(stripe, inv), personOrStripe(admin, stripe, { customerId, userId, inv })]);
  const p = { ...facts, final, amount: Number(inv.amount_due || 0), user: who.user, billing: who.billing };
  const em = await import("./_lib/emails.js");
  await mailOwner(admin, final ? `owner-failed-final:${inv.id}` : `owner-failed:${inv.id}`,
    async () => ({ subject: em.ownerPaymentFailedSubject(p), html: em.ownerPaymentFailedHtml(p, "https://residata.eu"),
      replyTo: who.user?.email, test: facts.test }),
    { customerId, amount: inv.amount_due, currency: inv.currency });
  // the customer: on the first failure and on the last one (Stripe retries a renewal
  // several times — one e-mail per attempt would be nagging)
  await mailCustomer(admin, stripe, final ? `failed-final:${inv.id}` : `failed:${inv.id}`,
    { to: inv.customer_email || who.user?.email, customerId, userId, country: inv.customer_address?.country,
      amount: inv.amount_due, currency: inv.currency },
    (lang, name) => ({ subject: em.customerPaymentFailedSubject(lang, p), html: em.customerPaymentFailedHtml({ ...p, name }, "https://residata.eu", lang) }));
}

const isCancelling = (s) => Boolean(s?.cancel_at_period_end || s?.cancel_at);
const endsAtOf = (s) => s?.cancel_at || (s?.cancel_at_period_end ? (s.items?.data?.[0]?.current_period_end ?? s.current_period_end ?? null) : null);

/**
 * Subscription changes worth an e-mail: a cancellation (Premium runs to the end) — Boss +
 * a confirmation to the customer; an UNDONE cancellation — Boss (otherwise his inbox says
 * the customer left); the end of a subscription — Boss + the customer. The subscription is
 * re-read first, so a late event cannot announce a cancellation that was already undone.
 */
async function notifySubscriptionChange(admin, stripe, sub, { deleted = false, previous = null, eventAt = null } = {}) {
  if (sub.status === "incomplete_expired" || (deleted && sub.status === "incomplete")) return;   // never paid: not a customer leaving
  let s = sub;
  if (!deleted) { try { s = (await stripe.subscriptions.retrieve(sub.id)) || sub; } catch { /* the event's copy */ } }
  const customerId = customerOf(s);
  const userId = s.metadata?.supabase_user_id || null;
  const em = await import("./_lib/emails.js");
  const ownerBuild = (c) => async () => {
    const [who, biz] = await Promise.all([personOrStripe(admin, stripe, { customerId, userId }), businessNow(stripe)]);
    const cc = { ...c, user: who.user, billing: who.billing, business: biz?.summary || null };
    return { subject: em.ownerCancelSubject(cc), html: em.ownerCancelHtml(cc, "https://residata.eu"), replyTo: who.user?.email, test: s.livemode === false };
  };
  const reason = s.cancellation_details?.feedback || null;
  const comment = s.cancellation_details?.comment || null;

  if (deleted) {
    const unpaid = s.cancellation_details?.reason === "payment_failed";
    await mailOwner(admin, `owner-ended:${s.id}`, ownerBuild({ ended: true, unpaid, reason, comment }), { customerId });
    // the customer, unless the end is not really an end: an admin gift carries Premium on,
    // a blocked or deleted account is the admin's own decision
    const { data: prof } = await admin.from("user_profiles").select("email, tier, paid_until").eq(userId ? "id" : "stripe_customer_id", userId || customerId).maybeSingle();
    const stillPremium = prof?.tier === "admin" || (prof?.tier === "paid" && !prof?.paid_until)
      || (prof?.paid_until && new Date(prof.paid_until).getTime() > Date.now() + 60_000);
    if (prof && prof.tier !== "pending" && !stillPremium) {
      await mailCustomer(admin, stripe, `customer-ended:${s.id}`, { to: prof.email, customerId, userId },
        (lang, name) => ({ subject: em.customerEndedSubject(lang, { unpaid }), html: em.customerEndedHtml({ unpaid, name }, "https://residata.eu", lang) }));
    }
    return;
  }
  const wasCancelling = previous && ("cancel_at_period_end" in previous || "cancel_at" in previous)
    ? Boolean(previous.cancel_at_period_end || previous.cancel_at) : null;
  if (isCancelling(s)) {
    if (wasCancelling === true) return;                    // already cancelling: another change, not a new cancellation
    const endsAt = endsAtOf(s);
    const when = s.canceled_at || endsAt;
    await mailOwner(admin, `owner-cancel:${s.id}:${when}`, ownerBuild({ ended: false, endsAt, reason, comment }), { customerId });
    const { data: prof } = await admin.from("user_profiles").select("email").eq(userId ? "id" : "stripe_customer_id", userId || customerId).maybeSingle();
    await mailCustomer(admin, stripe, `customer-cancel:${s.id}:${when}`, { to: prof?.email, customerId, userId },
      (lang, name) => ({ subject: em.customerCancelSubject(lang, { endsAt }), html: em.customerCancelHtml({ endsAt, name }, "https://residata.eu", lang) }));
  } else if (wasCancelling === true && ["active", "trialing", "past_due"].includes(s.status)) {
    // only when Boss was told about the cancellation — "they stayed" about a departure he
    // never heard of (cancelled and undone within one delivery) is noise
    const { data: told } = await admin.from("invoice_emails_sent").select("invoice_id").like("invoice_id", `owner-cancel:${s.id}:%`).limit(1);
    if (!told?.length) return;
    await mailOwner(admin, `owner-reactivated:${s.id}:${eventAt || Math.floor(Date.now() / 1000)}`,
      ownerBuild({ reactivated: true }), { customerId });
  }
}

/** Money given back (`charge.refunded`, cumulative). Boss hears once per new total. */
async function notifyRefund(admin, stripe, charge) {
  const total = Number(charge.amount_refunded || 0);
  if (!total) return;
  const customerId = customerOf(charge);
  await mailOwner(admin, `owner-refund:${charge.id}:${total}`, async () => {
    const who = await personOrStripe(admin, stripe, { customerId, email: charge.billing_details?.email, name: charge.billing_details?.name });
    const em = await import("./_lib/emails.js");
    const r = { amount: Number(charge.amount || 0), refunded: total, currency: charge.currency, user: who.user,
      stripeUrl: stripeDashUrl(`payments/${typeof charge.payment_intent === "string" ? charge.payment_intent : charge.id}`) };
    return { subject: em.ownerRefundSubject(r), html: em.ownerRefundHtml(r, "https://residata.eu"), test: charge.livemode === false };
  }, { customerId, amount: total, currency: charge.currency });
}

/** A chargeback: it has a deadline and costs a fee — Boss hears at once, and when it closes. */
async function notifyDispute(admin, stripe, d, phase) {
  let customerId = null;
  try {
    const pi = typeof d.payment_intent === "string" ? d.payment_intent : d.payment_intent?.id;
    if (pi) customerId = customerOf(await stripe.paymentIntents.retrieve(pi));
  } catch { /* unknown customer */ }
  await mailOwner(admin, `owner-dispute:${d.id}:${phase}`, async () => {
    const who = await personOrStripe(admin, stripe, { customerId });
    const em = await import("./_lib/emails.js");
    const x = { phase, status: d.status, amount: Number(d.amount || 0), currency: d.currency, reason: d.reason,
      dueBy: d.evidence_details?.due_by || null, user: who.user, stripeUrl: stripeDashUrl(`disputes/${d.id}`) };
    return { subject: em.ownerDisputeSubject(x), html: em.ownerDisputeHtml(x, "https://residata.eu"), test: d.livemode === false };
  }, { customerId, amount: d.amount, currency: d.currency });
}

// ─── admin billing (Boss 2026-10-07: "see all the info about the customers in the
// admin, their invoices, payments") ─────────────────────────────────────────
// POST { user_id? } with an admin's Bearer token.
//   · no user_id → the business: KPIs, every payment with its invoice, every subscription
//   · user_id    → that person's Stripe customer: subscriptions, invoices, billing identity
// Read from Stripe on each call (Stripe is the truth for money), joined to our
// profiles by customer id. An action here and not a new file: the Hobby plan
// allows 12 functions and api/ is at 12 (vercelFunctionBudget.test.mjs).
async function handleAdminBilling(req, res) {
  if (!isTrustedRequest(req)) return res.status(403).json({ error: "untrusted origin" });
  const admin = getSupabaseAdmin();
  const { profile, error, status } = await getUserFromRequest(req, admin);
  if (error) return res.status(status).json({ error });
  if (profile?.tier !== "admin") return res.status(403).json({ error: "admin only" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const userId = String(body?.user_id || "").trim();
  const stripe = getStripe();
  const mode = stripeMode().mode;
  const nowSec = Date.now() / 1000;

  if (userId) {
    const { user, billing } = await customerPerson(admin, { userId });
    if (!user) return res.status(404).json({ error: "user not found" });
    const cid = user.stripe_customer_id;
    let subscriptions = [], invoices = [], next = null, truncated = false;
    if (cid) {
      try {
        const subsRaw = [], invRaw = [];
        for await (const x of stripe.subscriptions.list({ customer: cid, status: "all", limit: 100, expand: ["data.discounts.source.coupon"] })) {
          if (subsRaw.length >= 100) { truncated = true; break; }
          subsRaw.push(x);
        }
        for await (const x of stripe.invoices.list({ customer: cid, limit: 100, expand: ["data.payments", "data.discounts.source.coupon"] })) {
          if (invRaw.length >= 300) { truncated = true; break; }
          invRaw.push(x);
        }
        const money = await attachMoneyFacts(stripe, invRaw, { customer: cid });
        truncated = truncated || money.truncated;
        subscriptions = subsRaw.map((x) => subscriptionRow(x, nowSec));
        invoices = invRaw.filter((i) => i.status !== "draft").map(invoiceRow);
        // the next charge, as Stripe will make it (credit balance, coupons running out)
        const running = subsRaw.find((x) => ["active", "trialing", "past_due"].includes(x.status) && !x.cancel_at_period_end && !x.cancel_at);
        if (running) {
          const amount = await previewNext(stripe, running.id);
          const r = subscriptionRow(running, nowSec);
          next = { at: running.status === "past_due" ? null : r.periodEnd, amount: amount === undefined ? r.monthly : amount };
        }
      } catch (e) {
        if (e?.code !== "resource_missing") return res.status(502).json({ error: "stripe_unreachable", detail: String(e?.message || e).slice(0, 200) });
      }
    }
    const paid = invoices.filter((x) => x.status === "paid" && x.amount > 0);
    return res.status(200).json({
      ok: true, mode, billing, truncated, next,
      customer: cid ? { id: cid, url: stripeDashUrl(`customers/${cid}`) } : null,
      totals: { paid: paid.reduce((s, x) => s + x.net, 0), refunded: paid.reduce((s, x) => s + x.refunded, 0), payments: paid.length,
                first: paid.length ? Math.min(...paid.map((x) => x.paidAt || x.created)) : null },
      subscriptions, invoices,
    });
  }

  const biz = await businessNow(stripe);
  if (!biz) return res.status(502).json({ error: "stripe_unreachable" });
  const cids = [...new Set([...biz.invoices.map(customerOf), ...biz.subs.map(customerOf)].filter(Boolean))];
  const people = {};
  // `.in()` travels in the URL — a few hundred Stripe ids would overflow it, so in chunks
  for (let i = 0; i < cids.length; i += 100) {
    const { data, error: e } = await admin.from("user_profiles").select("id, email, full_name, company, stripe_customer_id").in("stripe_customer_id", cids.slice(i, i + 100));
    if (e) console.warn("[stripe admin-billing] people not joined:", e.message);
    for (const u of data || []) people[u.stripe_customer_id] = { id: u.id, email: u.email, name: u.full_name, company: u.company };
  }
  // sign-up → paying conversion over 30 days: who registered, and how many of them paid
  let signups30d = null, signups30dPaying = null;
  try {
    const since = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data } = await admin.from("user_profiles").select("id, stripe_customer_id, tier").gte("created_at", since).limit(5000);
    const payers = new Set(biz.invoices.filter((i) => i.status === "paid" && Number(i.amount_paid) > 0).map(customerOf));
    const fresh = (data || []).filter((u) => u.tier !== "admin");
    signups30d = fresh.length;
    signups30dPaying = fresh.filter((u) => u.stripe_customer_id && payers.has(u.stripe_customer_id)).length;
  } catch (e) { console.warn("[stripe admin-billing] sign-ups not counted:", e?.message || e); }
  const withPerson = (r) => ({ ...r, person: people[r.customerId] || null });
  return res.status(200).json({
    ok: true, mode,
    summary: { ...biz.summary, signups30d, signups30dPaying },
    payments: biz.invoices.filter((i) => i.status !== "draft").map(invoiceRow).map(withPerson),
    subscriptions: biz.subs.map((x) => subscriptionRow(x, nowSec)).map(withPerson),
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
    return_url: `${requestOrigin(req)}/app/billing`,
  });
  return res.status(200).json({ url: portal.url });
}

// ─── subscription (authed) ───────────────────────────────────────────────
// What the caller's card subscription is doing right now, from Stripe itself.
// The Billing page needs it to stop promising "Renews" for a subscription the
// customer cancelled in the portal (Stripe keeps it `active` until the period
// ends) and to say "your payment failed" instead of "Premium ended — resubscribe"
// while Stripe is still retrying a renewal.
async function handleSubscriptionStatus(req, res) {
  if (!isTrustedRequest(req)) return res.status(403).json({ error: "untrusted origin" });
  const admin = getSupabaseAdmin();
  const { profile, error, status } = await getUserFromRequest(req, admin);
  if (error) return res.status(status).json({ error });
  if (!profile?.stripe_subscription_id) return res.status(200).json({ subscription: null });
  let sub;
  try { sub = await getStripe().subscriptions.retrieve(profile.stripe_subscription_id); }
  catch (e) {
    if (e?.code === "resource_missing") return res.status(200).json({ subscription: null });
    throw e;
  }
  const periodEnd = sub.items?.data?.[0]?.current_period_end ?? sub.current_period_end ?? null;
  const endsUnix = sub.cancel_at || (sub.cancel_at_period_end ? periodEnd : null);
  return res.status(200).json({
    subscription: { status: sub.status, ends_at: endsUnix ? new Date(endsUnix * 1000).toISOString() : null },
  });
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
//     at period end for cancel-at-period-end, so "now" ≈ the intended end. Only
//     when it is the subscription on file, no other one of the customer still
//     pays, and only what it paid for (never-paid or a longer gift is left alone).
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
    .from("user_profiles").select("tier, paid_started_at, paid_until, stripe_subscription_id").eq("id", userId).maybeSingle();

  // AN ENDING SUBSCRIPTION TAKES PREMIUM AWAY ONLY IF IT IS THE ONE PAYING FOR IT.
  // Before, any ending subscription stamped paid_until = now. So cancelling a
  // duplicate (the double-charge refund) cut off the customer the other one still
  // paid for, and Stripe re-delivering a late "deleted" — it retries for 3 days —
  // after the admin had moved a cancelled card payer to a gift wiped the gift.
  // The profile records which subscription pays (every live event writes it, and
  // an admin cancel or a gift clears it), so anything else ending changes nothing.
  if (terminal) {
    if (!current || current.stripe_subscription_id !== sub.id) {
      console.warn(`[stripe webhook] ${sub.id} ended (${deleted ? "deleted" : status}); user ${userId}'s Premium is not paid by it (${current?.stripe_subscription_id || "no subscription on file"}) — access left as it is`);
      return;
    }
    // Ending, but another subscription of the same customer still pays → that one
    // carries the access on, instead of a gap until the next nightly reconcile.
    if (customerId) {
      try {
        const { data: others = [] } = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
        const other = others.find((s) => s.id !== sub.id && ["active", "trialing", "past_due"].includes(s.status));
        if (other) {
          console.warn(`[stripe webhook] ${sub.id} ended; ${other.id} of the same customer still pays — access follows it`);
          return applySubscription(admin, stripe, other);
        }
      } catch (e) {
        console.warn("[stripe webhook] could not look for another subscription:", e?.message || e);
      }
    }
  }

  // An account the admin BLOCKED ("No access") is never handed Premium back by a
  // payment event or the nightly reconcile. Blocking a card payer cancels the
  // subscription in the same request (api/admin/set-subscription.js), so this
  // should not happen — if it does, it is said loudly instead of undone silently.
  if (current?.tier === "pending" && !terminal) {
    console.error(`[stripe webhook] ${sub.id} is ${status} for user ${userId}, whom the admin blocked — access NOT restored; cancel the subscription in Stripe`);
    return;
  }

  const patch = { stripe_subscription_id: deleted ? null : sub.id };
  if (customerId) patch.stripe_customer_id = customerId;

  if (terminal) {
    // Revoke as of now — the ONLY path that lowers paid_until — but a subscription
    // takes away only what it gave. One that never paid (incomplete_expired: the
    // first payment never went through) gave nothing; and Premium that runs past
    // this subscription's last paid period (an admin gift that was there before
    // the card) was not this subscription's to end.
    const neverPaid = status === "incomplete_expired";
    const curMs = current?.paid_until ? new Date(current.paid_until).getTime() : 0;
    const beyondThisSub = periodEndUnix != null && curMs > periodEndUnix * 1000 + 60_000;
    if (!neverPaid && !beyondThisSub) {
      patch.paid_until = new Date().toISOString();
      patch.paid_pause_started = null;
    }
  } else if (paidNow && periodEnd) {
    // Extend only forward — a stale/duplicate event can never rewind access.
    const curMs = current?.paid_until ? new Date(current.paid_until).getTime() : 0;
    patch.paid_until = new Date(periodEnd).getTime() > curMs ? periodEnd : current.paid_until;
    patch.paid_pause_started = null;
    if (current?.tier !== "admin") patch.tier = "paid";
    // "Premium from" is the start of THIS stretch of Premium: kept while it runs
    // on, reset when the person comes back after it had ended — otherwise a
    // January gift followed by an October subscription read "Premium since
    // 1 January", ten months that never happened.
    // A renewal of the subscription already on file is the SAME stretch, even
    // though its webhook always lands just after the old period ended (Stripe
    // rolls the period over first) — without this, "Premium from" jumped to the
    // renewal date every month.
    const running = current?.stripe_subscription_id === sub.id
      || (current?.paid_until
        ? new Date(current.paid_until).getTime() > Date.now()
        : current?.tier === "paid");                  // no end date = Premium with no end
    if (!current?.paid_started_at || !running) patch.paid_started_at = new Date().toISOString();
  }
  // GRACE (past_due / incomplete / paused): touch neither paid_until nor tier.

  const { error } = await admin.from("user_profiles").update(patch).eq("id", userId);
  if (error) console.error("[stripe webhook] profile update failed", error.message);
  else console.log(`[stripe webhook] ${deleted ? "deleted" : status} → user ${userId} paid_until=${patch.paid_until || "(unchanged)"}`);
}

/**
 * reconcile — the safety net for a webhook that never arrived.
 *
 * 🔴 WHY THIS EXISTS (2026-09-14). The webhook was the ONLY thing that ever
 * wrote `paid_until`, and on this date the Stripe account's only destination
 * turned out to point at the OTHER product's server: Residata's own endpoint was
 * registered nowhere. Nothing had been lost — there were no subscriptions yet —
 * but the first customer to convert would have been charged and left on the free
 * tier, permanently, with no process that would ever notice.
 *
 * A single delivery path with no second chance is the actual defect; the wrong
 * URL was only how it surfaced. KamhalCo, the sister product, has had exactly
 * this net since its own audit (`stripe_reconcile.py`, "a net for lost/failed
 * webhooks") and that is why its billing survived the same misconfiguration.
 *
 * Stripe is the source of truth here and we simply re-apply it, which is safe
 * because `applySubscription` is idempotent by construction: it extends
 * `paid_until` only FORWARD, sets `paid_started_at` only when unset, and leaves
 * grace states untouched.
 *
 * 🔴 TERMINAL SUBSCRIPTIONS ARE DELIBERATELY SKIPPED, and the reason matters.
 * A missed *cancellation* costs nothing: `paid_until` still holds the period end
 * the customer already paid for, so access lapses on its own. Re-applying one
 * here would instead stamp `paid_until = now()` on every run, so a user who
 * cancelled months ago would read as "paid until today" forever — a cosmetic lie
 * that grows every night. The harm worth fixing is the opposite one: somebody
 * PAID and did not get access.
 */
async function handleReconcile(req, res) {
  // One shared definition of a genuine cron — see api/_lib/cronAuth.js for the
  // two production measurements behind it. The version this replaces fell back
  // to `x-vercel-cron: 1` whenever CRON_SECRET was unset, and CRON_SECRET WAS
  // unset: a hand-sent header from a laptop reached this handler and got a 200,
  // so the nightly net was callable by anyone who guessed the query string.
  if (rejectIfNotCron(req, res, "stripe reconcile")) return;

  const stripe = getStripe();
  const admin = getSupabaseAdmin();

  const TERMINAL = ["canceled", "unpaid", "incomplete_expired"];
  // A ceiling so one bad day cannot run the function out of time. Far above any
  // plausible book for a long while; when it is ever hit, the response says so
  // rather than silently reconciling a subset.
  const MAX = 1000;

  let scanned = 0, applied = 0, skipped = 0, failed = 0, truncated = false;
  const problems = [];

  for await (const sub of stripe.subscriptions.list({ status: "all", limit: 100 })) {
    if (scanned >= MAX) { truncated = true; break; }
    scanned++;
    if (TERMINAL.includes(sub.status)) { skipped++; continue; }
    try {
      await applySubscription(admin, stripe, sub);
      applied++;
    } catch (e) {
      failed++;
      problems.push({ subscription: sub.id, error: String(e?.message || e).slice(0, 200) });
    }
  }

  // Our webhook endpoint must carry every event a branch of handleWebhook reacts to —
  // a branch whose event is not subscribed never runs (invoice.payment_failed, added
  // 2026-10-07). It can never fail the reconcile it rides on.
  let webhook = null;
  try { webhook = await ensureWebhookEvents(stripe); }
  catch (e) { console.warn("[stripe reconcile] webhook events not checked:", e?.message || e); }

  // Loud in the log when something did not apply — a reconcile that quietly
  // fails is the same blind spot it was built to remove.
  if (failed) console.error(`[stripe reconcile] ${failed} of ${scanned} failed`, problems);
  else console.log(`[stripe reconcile] scanned=${scanned} applied=${applied} skipped=${skipped}`);

  // 🔴 LEAVE A TRACE THAT OUTLIVES THE LOG (2026-09-15). Everything above this
  // line is a console line on a Hobby plan, which is discarded after an hour —
  // so "did the net run last night?" had no answer by the time anyone asked,
  // and that is the only reason this endpoint could go from its first deploy to
  // its first real run without executing once. The scraper's helper crons have
  // self-reported into reference.cron_heartbeats since June and a stale one
  // shows up in the digest Boss already gets daily; this joins them.
  //
  // It must never be able to fail the reconcile it is reporting on.
  try {
    await admin.rpc("record_cron_heartbeat", {
      p_job: "residata_stripe_reconcile",
      // not ok when no endpoint of ours exists at Stripe: every webhook-driven e-mail
      // and access change would silently stop (a transient read error is only noted)
      p_ok: failed === 0 && webhook?.ours !== 0,
      p_detail: `scanned=${scanned} applied=${applied} skipped=${skipped} failed=${failed} ${webhookNote(webhook)}`,
    });
  } catch (e) {
    console.error("[stripe reconcile] heartbeat not recorded", String(e?.message || e));
  }

  return res.status(failed ? 500 : 200).json({
    ok: failed === 0, scanned, applied, skipped, failed, truncated, problems, webhook,
  });
}

// Every event handleWebhook has a branch for. The nightly reconcile ADDS any of them
// missing from OUR endpoint (residata.eu) — it never removes an event and never
// touches another endpoint (the KamhalCo one lives in another account anyway).
export const WEBHOOK_EVENTS = [
  "checkout.session.completed", "customer.updated",
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "invoice.paid", "invoice.payment_succeeded", "invoice.payment_failed",
  "charge.refunded", "charge.dispute.created", "charge.dispute.closed",
];
const OUR_WEBHOOK = /^https:\/\/(www\.)?residata\.eu\/api\/(webhooks\/stripe|stripe\?action=webhook)\b/;

async function ensureWebhookEvents(stripe) {
  const added = [];
  let ours = 0;
  for await (const w of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (w.status !== "enabled" || !OUR_WEBHOOK.test(String(w.url || ""))) continue;
    ours++;
    const have = w.enabled_events || [];
    if (have.includes("*")) continue;
    const missing = WEBHOOK_EVENTS.filter((e) => !have.includes(e));
    if (!missing.length) continue;
    await stripe.webhookEndpoints.update(w.id, { enabled_events: [...have, ...missing] });
    console.log(`[stripe reconcile] webhook ${w.id}: added ${missing.join(", ")}`);
    added.push({ id: w.id, added: missing });
  }
  return { ours, added };
}

/** One short line for the heartbeat — the console line is gone after an hour on Hobby. */
function webhookNote(w) {
  if (!w) return "webhook=not-checked";
  if (!w.ours) return "webhook=NONE-OURS";
  const added = w.added.flatMap((a) => a.added);
  return `webhook=ok(${w.ours})${added.length ? ` added:${added.join("+")}` : ""}`;
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

  // E-mails ride on the webhook. A failed send used to be logged and swallowed, so the
  // customer's invoice or Boss's payment e-mail could vanish while Stripe saw 200 and
  // never retried (review 2026-10-08). Now a failed send answers 500: Stripe redelivers
  // (for up to three days), every e-mail that did go out is claimed in
  // invoice_emails_sent and is not repeated, and the access change is idempotent. An
  // event older than two days gets 200 anyway — a mail server down for days is a
  // problem the log must show, not a reason to keep Stripe's retries piling up.
  const mailFailures = [];
  const soft = (label) => (e) => {
    console.warn(`[stripe webhook] ${label} not sent:`, e?.message || e);
    mailFailures.push(label);
  };
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
      // A customer who edits their company name, address or VAT number in the
      // billing portal changes it at Stripe — and until now, nowhere else. Our
      // copy is what the EU sales list is built from, so it has to follow.
      case "customer.updated": {
        await syncCustomerBillingIdentity(admin, event.data.object)
          .catch((e) => console.warn("[stripe] customer.updated not applied:", e?.message || e));
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await applySubscription(admin, stripe, event.data.object, {
          deleted: event.type === "customer.subscription.deleted",
        });
        // Boss (and the customer) hear about a cancellation, an undone cancellation and
        // the end of a subscription — after the access change.
        if (event.type !== "customer.subscription.created") {
          await notifySubscriptionChange(admin, stripe, event.data.object, {
            deleted: event.type === "customer.subscription.deleted",
            previous: event.data.previous_attributes || null,
            eventAt: event.created || null,
          }).catch(soft("subscription e-mail"));
        }
        break;
      }
      // A payment that did not go through: Boss and the customer hear on the first
      // attempt and when Stripe gives up. Access follows the subscription events.
      case "invoice.payment_failed": {
        await notifyPaymentFailed(admin, stripe, event.data.object).catch(soft("failed-payment e-mail"));
        break;
      }
      case "invoice.paid":
      case "invoice.payment_succeeded": {
        // `invoice.subscription` was removed from recent Stripe API versions (moved
        // under invoice.parent / line-item parent) — the same migration handled for
        // current_period_end. Resolve it robustly so this renewal safety-net path
        // doesn't silently no-op.
        const inv = event.data.object;
        const subRef = subOfInvoice(inv);
        if (subRef) {
          const sub = await stripe.subscriptions.retrieve(subRef);
          await applySubscription(admin, stripe, sub);
        }
        // Send the invoice ourselves. Stripe can email invoices, but only if
        // someone ticks a box in the dashboard, and the Terms promise the
        // customer a document — a promise should not depend on a setting nobody
        // can see from the code. Sent from `invoice.paid` ONLY: Stripe fires
        // invoice.payment_succeeded for the same invoice, and both arriving here
        // would send the customer two copies.
        if (event.type === "invoice.paid") {
          await sendInvoiceEmail(admin, inv, stripe).catch(soft("invoice e-mail"));
          // …and Boss hears about the money (Boss 2026-10-07), once per invoice
          await notifyOwnerPayment(admin, stripe, inv).catch(soft("owner payment e-mail"));
        }
        break;
      }
      // Money given back, and chargebacks (a deadline and a fee): Boss hears at once.
      case "charge.refunded": {
        await notifyRefund(admin, stripe, event.data.object).catch(soft("refund e-mail"));
        break;
      }
      case "charge.dispute.created":
      case "charge.dispute.closed": {
        await notifyDispute(admin, stripe, event.data.object, event.type.endsWith("created") ? "created" : "closed")
          .catch(soft("dispute e-mail"));
        break;
      }
      default:
        break;
    }
    if (mailFailures.length) {
      const ageSec = Date.now() / 1000 - Number(event.created || 0);
      if (ageSec < 2 * 86400) return res.status(500).json({ error: "email_failed", retry: true, failed: mailFailures });
      console.error(`[stripe webhook] ${event.id}: giving up on ${mailFailures.join(", ")} after two days of retries`);
    }
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("[stripe webhook] handler crash", e);
    return res.status(500).json({ error: "handler error" });
  }
}

// ─── mode (public) ──────────────────────────────────────────────────────
// Which Stripe this deployment takes money with: "live", "test" or "missing" —
// from the key's prefix only, never any part of a secret. Exists because a site
// on a TEST key looks completely real: the customer pays, sees "thank you", gets
// Premium in our database — and nothing reaches the bank. Nothing outside said
// which key ran, so the only way to find out was a real purchase. Read nightly by
// novostavby integrity_check.stripe_takes_real_money (with KamhalCo's /health).
function stripeMode() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  const mode = /^(sk|rk)_live_/.test(key) ? "live" : /^(sk|rk)_test_/.test(key) ? "test" : "missing";
  const wh = process.env.STRIPE_WEBHOOK_SECRET || "";
  return { mode, webhook_secret: wh.startsWith("whsec_") ? "set" : "missing" };
}

async function handleMode(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(stripeMode());
}

// ─── router ──────────────────────────────────────────────────────────────
/**
 * Which HTTP methods each action answers — declared beside the router, per action.
 *
 * 🔴 WHY IT IS A TABLE AND NOT ONE RULE (2026-09-15). This handler opened with
 * `if (req.method !== "POST") return 405`, which is correct for the three
 * browser-driven actions and for Stripe's webhook, and wrong for a cron:
 * **Vercel invokes a scheduled job with a plain GET.** So from the moment the
 * nightly reconcile shipped it answered 405 at the door, before its own auth
 * check was ever reached — the safety net that exists precisely because billing
 * had a single delivery path had itself never run, not once.
 *
 * Nothing surfaced it because a cron on Hobby leaves only a runtime log, and
 * that log is discarded after an hour; by the time anyone looks, 04:00 is gone.
 * The guard is now `src/lib/billingSafetyNet.test.mjs`, which reads the cron
 * paths out of vercel.json and asserts this table admits GET for each of them —
 * the deploy and the test therefore read the same source of truth, and a future
 * cron action cannot repeat this by being added to only one of them.
 */
const METHODS = {
  checkout: ["POST"],
  portal: ["POST"],
  subscription: ["POST"],
  "set-price": ["POST"],
  webhook: ["POST"],              // Stripe POSTs its events
  reconcile: ["GET", "POST"],     // Vercel cron GETs; POST stays for a manual run with the secret
  mode: ["GET"],                  // public: "live" | "test" | "missing", no secret in it
  "admin-billing": ["POST"],      // admin → Revenue and a person's payments (admin token)
};

export default async function handler(req, res) {
  const action = req.query.action;
  const allowed = METHODS[action];
  if (!allowed) return res.status(400).json({ error: "unknown action" });
  if (!allowed.includes(req.method)) {
    res.setHeader("Allow", allowed.join(", "));
    return res.status(405).json({ error: "method not allowed" });
  }
  try {
    if (action === "checkout") return await handleCheckout(req, res);
    if (action === "portal") return await handlePortal(req, res);
    if (action === "subscription") return await handleSubscriptionStatus(req, res);
    if (action === "set-price") return await handleSetPrice(req, res);
    if (action === "webhook") return await handleWebhook(req, res);
    if (action === "reconcile") return await handleReconcile(req, res);
    if (action === "mode") return await handleMode(req, res);
    if (action === "admin-billing") return await handleAdminBilling(req, res);
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    console.error("[stripe] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
