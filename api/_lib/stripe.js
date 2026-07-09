// api/_lib/stripe.js
//
// Shared helpers for the Stripe billing endpoints. One place to build the
// Stripe client + the Supabase service-role client, verify the caller, and
// lazily attach a Stripe customer to a user profile.
//
// Design note: billing plugs into the EXISTING entitlement model. A user is
// "paid" when public.user_profiles.paid_until is in the future (see
// supabase_migration_2026_04_subscription.sql). Stripe's only job is to write
// that same paid_until forward when money arrives — the webhook does it.

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

let _stripe = null;
export function getStripe() {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  // No apiVersion pin — use the account's default so the SDK and dashboard agree.
  _stripe = new Stripe(key);
  return _stripe;
}

export function getSupabaseAdmin() {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SECRET_KEY;
  if (!URL || !KEY) throw new Error("Supabase env not set (SUPABASE_URL / SUPABASE_SECRET_KEY)");
  return createClient(URL, KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verify the caller's Supabase JWT (Bearer) and return { user, profile }.
// On failure returns { error, status } so the caller can bail with the right code.
export async function getUserFromRequest(req, admin) {
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: "authentication required", status: 401 };

  const { data: { user } = {}, error } = await admin.auth.getUser(token);
  if (error || !user) return { error: "invalid token", status: 401 };

  const { data: profile } = await admin
    .from("user_profiles")
    .select("id, email, tier, stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  return { user, profile: profile || null };
}

// Resolve the user's Stripe customer, creating (and persisting) one on first use.
export async function ensureCustomer(stripe, admin, user, profile) {
  if (profile?.stripe_customer_id) return profile.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: user.email || undefined,
    metadata: { supabase_user_id: user.id },
  });

  await admin
    .from("user_profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", user.id);

  return customer.id;
}

// Best-effort origin for building redirect URLs. Falls back to the live domain.
export function requestOrigin(req) {
  if (req.headers.origin) return req.headers.origin;
  if (req.headers.referer) {
    try { return new URL(req.headers.referer).origin; } catch { /* ignore */ }
  }
  return "https://residata.eu";
}
