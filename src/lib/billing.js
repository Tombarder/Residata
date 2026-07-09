// src/lib/billing.js
//
// Frontend entry points for real Stripe billing. Mirrors trial.js: always
// refresh the access token first (dead tokens are the #1 cause of silent
// 401s), POST to the API, then hand off to Stripe's hosted pages by
// redirecting to the returned URL.
//
//   startCheckout()      → Stripe Checkout (subscribe €25/mo)
//   openBillingPortal()  → Stripe Billing Portal (update card / cancel)
//
// Both throw Error("SESSION_EXPIRED") if the session can't be revived, so the
// caller can prompt re-login instead of showing a dead button.

import { getFreshAccessToken } from "./sessionGuard";

async function postAuthed(path) {
  const token = await getFreshAccessToken(); // throws SESSION_EXPIRED if dead
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: "{}",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.url) {
    const e = new Error(data?.error || `HTTP ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return data.url;
}

// Start a subscription. On success the browser leaves for Stripe's Checkout;
// this function does not return in the happy path.
export async function startCheckout() {
  const url = await postAuthed("/api/stripe/create-checkout");
  window.location.assign(url);
}

// Open the self-serve billing portal (manage card / cancel / invoices).
export async function openBillingPortal() {
  const url = await postAuthed("/api/stripe/portal");
  window.location.assign(url);
}
