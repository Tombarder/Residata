// Vercel serverless endpoint: /api/admin/delete-user
//
// Admin-only destructive op — calls Supabase Auth admin API (which requires
// service-role and therefore MUST live on the backend, not in the browser).
//
// Auth model:
//   1. Caller sends their Supabase session access-token as Authorization: Bearer <token>
//   2. Endpoint validates the token against Supabase (auth.getUser)
//   3. Endpoint reads caller's user_profiles row to confirm tier='admin'
//   4. Only then does it accept { user_id } and delete via auth.admin.deleteUser()
//   5. Self-delete is refused — admins can't nuke their own account from here.
//
// auth.users delete cascades into user_profiles via FK.
//
// WHAT "DELETE MY ACCOUNT" MEANS (2026-10-06 — until then it deleted the auth
// user and nothing else):
//   1. A live card subscription is CANCELLED at Stripe first. Before, the account
//      went and Stripe went on charging the card every month, mailing "thank you
//      for your payment" invoices for an account that no longer existed. If the
//      cancel fails, nothing is deleted.
//   2. Personal records the FK cascade does not reach are erased: AI questions
//      (ai_chat_log is ON DELETE SET NULL — the text stayed), activity history
//      (user_activity, SET NULL), feedback threads with their e-mail and files
//      (no FK at all) and the sign-up record with the e-mail (events).
//   3. KEPT, on purpose and said so in the UI: invoices (accounting law) and the
//      admin audit log's record that this deletion happened.

import { createClient } from "@supabase/supabase-js";
import { isTrustedRequest as isTrustedOrigin } from "../_lib/origin.js";
import { getStripe } from "../_lib/stripe.js";

export const maxDuration = 20;

/** Stripe subscription statuses after which nothing is charged again. */
const CARD_DONE = ["canceled", "incomplete_expired", "unpaid"];

/** Personal rows the auth.users cascade leaves behind. Each step is attempted;
 *  failures are returned so the audit log names what may remain. */
async function erasePersonalRecords(sb, userId, email) {
  const failed = [];
  const step = async (name, fn) => {
    try { const { error } = await fn(); if (error) failed.push(`${name}: ${error.message}`); }
    catch (e) { failed.push(`${name}: ${String(e?.message || e)}`); }
  };
  // Feedback: no FK, carries the e-mail; its messages cascade, its files do not.
  const { data: threads } = await sb.from("feedback").select("id, attachment_path").eq("user_id", userId);
  const ids = (threads || []).map((t) => t.id);
  if (ids.length) {
    const { data: msgs } = await sb.from("feedback_messages").select("attachment_path, auto_screenshot_path").in("conversation_id", ids);
    const files = [...(threads || []).map((t) => t.attachment_path), ...(msgs || []).flatMap((m) => [m.attachment_path, m.auto_screenshot_path])].filter(Boolean);
    if (files.length) await step("feedback files", () => sb.storage.from("feedback-attachments").remove(files));
    await step("feedback", () => sb.from("feedback").delete().in("id", ids));
  }
  await step("ai_chat_log", () => sb.from("ai_chat_log").delete().eq("user_id", userId));
  await step("user_activity", () => sb.from("user_activity").delete().eq("user_id", userId));
  if (email) await step("events", () => sb.from("events").delete().like("event_type", "new_signup%").eq("new_value->>email", email));
  return failed;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method not allowed" });
  }

  // Same origin allowlist every other privileged endpoint enforces
  // (set-subscription / trial-grant / trial-start). This is the single
  // irreversible admin op, so it must not be the least-gated one.
  if (!isTrustedOrigin(req)) return res.status(403).json({ error: "untrusted origin" });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    return res.status(500).json({ error: "server misconfigured: SUPABASE envs missing" });
  }

  // ── Extract bearer token ──
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ error: "missing bearer token" });
  }

  // Service-role client — used both for verifying caller and for the deletion.
  const sb = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false },
  });

  // ── Verify caller is admin ──
  const { data: callerData, error: callerErr } = await sb.auth.getUser(token);
  if (callerErr || !callerData?.user) {
    return res.status(401).json({ error: "invalid session token" });
  }
  const callerId = callerData.user.id;

  const { data: callerProfile, error: pErr } = await sb
    .from("user_profiles")
    .select("tier")
    .eq("id", callerId)
    .maybeSingle();
  if (pErr) {
    return res.status(500).json({ error: `profile fetch failed: ${pErr.message}` });
  }
  // ── Parse body ──
  const body = typeof req.body === "string" ? (req.body ? JSON.parse(req.body) : {}) : (req.body || {});
  const targetId = body.user_id;
  if (!targetId) {
    return res.status(400).json({ error: "missing user_id in body" });
  }
  // Authorization: a user may delete THEIR OWN account (GDPR right to erasure /
  // self-service DSAR from Settings); an admin may delete anyone. Deleting
  // someone ELSE requires admin. (Kept in this one function so we don't add a
  // new Vercel serverless function — the Hobby plan is at its 12-function cap.)
  const isSelfDelete = targetId === callerId;
  const isAdmin = !!callerProfile && callerProfile.tier === "admin";
  if (!isSelfDelete && !isAdmin) {
    return res.status(403).json({ error: "not admin" });
  }

  // ── Capture target details BEFORE deletion for the audit log ──
  // Once auth.admin.deleteUser() fires, cascade wipes user_profiles too.
  // We want the audit trail to show who was deleted, not just their uuid.
  const { data: targetProfile } = await sb
    .from("user_profiles")
    .select("email, tier, full_name, company, stripe_subscription_id")
    .eq("id", targetId)
    .maybeSingle();

  // ── 1. Stop the card first — or delete nothing ──
  let cardCancelled = false;
  if (targetProfile?.stripe_subscription_id) {
    try {
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(targetProfile.stripe_subscription_id).catch((e) => {
        if (e?.code === "resource_missing") return null;
        throw e;
      });
      if (sub && !CARD_DONE.includes(sub.status)) {
        await stripe.subscriptions.cancel(sub.id);
        cardCancelled = true;
      }
    } catch (e) {
      console.error("[delete-user] could not cancel the card subscription", e?.message);
      return res.status(502).json({
        error: "card_cancel_failed",
        message: "The card subscription could not be cancelled, so the account was not deleted. Try again, or cancel it in Stripe first.",
      });
    }
  }

  // ── 2. Personal records the cascade does not reach ──
  const leftover = await erasePersonalRecords(sb, targetId, targetProfile?.email || null);
  if (leftover.length) console.error("[delete-user] personal records not erased", leftover);

  // Actor details for the log (caller is the admin performing the action)
  const actorEmail = callerData.user.email || null;
  const clientIp =
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    null;
  const userAgent = req.headers["user-agent"] || null;

  // ── Delete ──
  const { error: delErr } = await sb.auth.admin.deleteUser(targetId);

  // ── Audit log — ALWAYS records attempt (success or failure) ──
  // Best-effort: a failing audit write shouldn't mask the real result.
  try {
    await sb.from("admin_audit_log").insert({
      actor_id:    callerId,
      actor_email: actorEmail,
      action:      isSelfDelete ? "self_delete_user" : "delete_user",
      target_id:   targetId,
      payload:     targetProfile ? { ...targetProfile, card_cancelled: cardCancelled, not_erased: leftover } : null,
      ip:          clientIp,
      user_agent:  userAgent,
      success:     !delErr,
      error:       delErr?.message || null,
    });
  } catch (_) { /* never let logging break the response */ }

  if (delErr) {
    return res.status(500).json({ error: `delete failed: ${delErr.message}` });
  }

  // An admin-created account on a personal e-mail (gmail, …) put that address on
  // the business-e-mail gate's exemption list (api/admin/create-user.js). With the
  // account gone, the exemption is personal data kept for nothing — it goes too.
  // Best-effort: the account IS deleted; a leftover exemption only lets the address
  // sign up again, so it is logged, not failed on. Before the migration
  // (supabase_migration_2026_10_admin_creates_accounts.sql) the function does not
  // exist — and nothing could have been exempted by create-user either.
  if (targetProfile?.email) {
    const { error: exErr } = await sb.rpc("admin_set_signup_email_exempt", { p_email: targetProfile.email, p_exempt: false });
    if (exErr && exErr.code !== "PGRST202") {
      console.warn("[delete-user] could not remove the sign-up exemption", exErr.message);
    }
  }

  return res.status(200).json({ ok: true, deletedUserId: targetId });
}
