// POST /api/admin/create-user
//
// Admin → Users → "Add user" (Boss, 2026-10-06): the admin types an e-mail, a
// name, the account type and (for Premium) the period, and the person has a
// working account at once — exactly what a self sign-up produces, minus the
// confirmation e-mail and the "complete your profile" form. They sign in like
// everyone else: their address, a one-time code.
//
// Same security model as the other /api/admin endpoints: the caller's session is
// checked against Supabase and their profile must be tier='admin'.
//
// Body: { email, full_name, company?, position?, phone?, linkedin_url?,
//         tier: 'free' | 'paid' | 'admin',
//         paid_started_at?, paid_until?   ('YYYY-MM-DD', Premium only; from defaults
//                                          to today, to = none = no end),
//         subscription_note?,
//         send_invite?: boolean, invite_lang?: 'sk' | 'en' }
// Validation and the profile row it produces: lib/adminUsers.js#planNewUser.
//
// Steps, each undone if a later one fails — never a half-made account:
//   1. A personal address (gmail, …) is exempted from the business-e-mail gate
//      (public.admin_set_signup_email_exempt) — without it neither the account
//      nor, later, the sign-in code could be created for it.
//   2. auth.admin.createUser with email_confirm=true. The handle_new_user trigger
//      makes the profile row (pending) and the usual sign-up event.
//   3. The profile is completed and approved in one update, with the type and
//      period set; the two "notified" stamps stop the completion trigger from
//      sending the admin FYI and the generic "You're approved" mail.
//   4. Optionally our own invitation (emails.js#accountCreatedHtml). A failed
//      send does NOT undo the account — the response says so and the admin can
//      tell the person himself.
//   5. admin_audit_log 'create_user'.
//
// Response 200 { ok, user, invite: 'sent' | 'not_requested' | 'failed', invite_error? }

import { createClient } from "@supabase/supabase-js";
import { isTrustedRequest as isTrustedOrigin } from "../_lib/origin.js";
import { accountCreatedHtml, inviteSubject, sendEmail } from "../_lib/emails.js";
import { planNewUser } from "../../src/lib/adminUsers.js";

export const maxDuration = 20;

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });
    if (!isTrustedOrigin(req)) return res.status(403).json({ error: "untrusted origin" });

    const URL = process.env.SUPABASE_URL;
    const KEY = process.env.SUPABASE_SECRET_KEY;
    if (!URL || !KEY) return res.status(500).json({ error: "server misconfigured" });

    const authHeader = req.headers.authorization || req.headers.Authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return res.status(401).json({ error: "authentication required" });

    const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user: caller } = {}, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !caller) return res.status(401).json({ error: "invalid token" });
    const { data: callerProfile } = await admin
      .from("user_profiles").select("tier").eq("id", caller.id).maybeSingle();
    if (callerProfile?.tier !== "admin") return res.status(403).json({ error: "admin only" });

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON" }); }
    }
    const now = Date.now();
    const plan = planNewUser(body, { now });
    if (plan.error) return res.status(400).json(plan);
    const { email, profile, sendInvite, inviteLang } = plan;

    // Already here? (auth.users and user_profiles are 1:1 — the profile is the
    // readable side; GoTrue stores addresses lower-cased, and so does planNewUser.)
    // createUser would refuse too; this answers in words. eq, not ilike — in a
    // LIKE pattern the "_" of "jan_novak@" is a wildcard.
    const { data: existing } = await admin
      .from("user_profiles").select("id").eq("email", email).limit(1);
    if (existing && existing.length) return res.status(409).json({ error: "email_exists" });

    // 1. Personal address → exempt it from the business-e-mail gate first.
    let exempted = false;
    const { data: allowed, error: allowedErr } = await admin.rpc("signup_email_allowed", { p_email: email });
    if (allowedErr) return res.status(500).json({ error: "gate check failed", detail: allowedErr.message });
    if (allowed === false) {
      const { data: changed, error: exErr } = await admin.rpc("admin_set_signup_email_exempt", { p_email: email, p_exempt: true });
      if (exErr) {
        // PGRST202 / 42883: the function is not in the database yet
        // (supabase_migration_2026_10_admin_creates_accounts.sql not applied).
        const missing = exErr.code === "PGRST202" || exErr.code === "42883" || /could not find the function/i.test(exErr.message || "");
        return res.status(missing ? 409 : 500).json(missing
          ? { error: "personal_email_setup" }
          : { error: "exemption failed", detail: exErr.message });
      }
      exempted = changed === true;
    }
    const undoExemption = async () => {
      if (!exempted) return;
      const { error } = await admin.rpc("admin_set_signup_email_exempt", { p_email: email, p_exempt: false });
      if (error) console.error("[create-user] could not undo the exemption for a failed create", error.message);
    };

    // 2. The auth account — confirmed, so no confirmation mail is sent.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: profile.full_name },
      app_metadata: { created_by_admin: caller.id },
    });
    if (createErr || !created?.user) {
      await undoExemption();
      const exists = /already (been )?registered|already exists/i.test(createErr?.message || "");
      return res.status(exists ? 409 : 500).json(exists
        ? { error: "email_exists" }
        : { error: "create failed", detail: createErr?.message || "no user returned" });
    }
    const newId = created.user.id;

    // 3. Complete + approve + type + period, in one write.
    const { data: rows, error: updErr } = await admin
      .from("user_profiles").update(profile).eq("id", newId).select("*");
    if (updErr || !rows || rows.length === 0) {
      // Never leave a half-made account behind: the auth user goes (its profile
      // row cascades with it), and so does the exemption.
      const { error: rbErr } = await admin.auth.admin.deleteUser(newId);
      await undoExemption();
      return res.status(500).json({
        error: "profile write failed",
        detail: (updErr?.message || "no profile row (handle_new_user trigger missing?)") +
          (rbErr ? ` — and the rollback failed too: ${rbErr.message}` : " — the account was removed again"),
      });
    }
    const newUser = rows[0];

    // handle_new_user logged this as a self sign-up and judged it like one
    // ("personal email", "suspicious org" once a domain has 4 accounts). It is
    // not one: the admin made it. Re-label that one event so the admin's list of
    // new accounts says so (EventBadge: "ADDED BY ADMIN"). Best-effort.
    try {
      const { error: evErr } = await admin.from("events")
        .update({ event_type: "new_signup_admin_created", new_value: { email, domain: email.split("@")[1], created_by: caller.email || caller.id } })
        .like("event_type", "new_signup%")
        .eq("new_value->>email", email)
        .gte("detected_at", new Date(now - 60000).toISOString());
      if (evErr) console.warn("[create-user] could not re-label the sign-up event", evErr.message);
    } catch (e) {
      console.warn("[create-user] could not re-label the sign-up event", e?.message || e);
    }

    // 4. Our invitation, if asked for.
    let invite = "not_requested", inviteError = null;
    if (sendInvite) {
      try {
        await sendEmail({
          to: email,
          subject: inviteSubject(inviteLang),
          html: accountCreatedHtml(newUser, process.env.WEB_URL || "https://residata.eu", inviteLang),
          gmailUser: process.env.GMAIL_FROM || "tkamhal@gmail.com",
          gmailPassword: process.env.GMAIL_APP_PASSWORD,
        });
        invite = "sent";
      } catch (e) {
        invite = "failed";
        inviteError = String(e?.message || e).slice(0, 200);
        console.error("[create-user] invitation failed", inviteError);
      }
    }

    // 5. Audit.
    try {
      await admin.from("admin_audit_log").insert({
        actor_id: caller.id,
        actor_email: caller.email || null,
        action: "create_user",
        target_id: newId,
        payload: {
          email, tier: newUser.tier, full_name: newUser.full_name, company: newUser.company,
          paid_started_at: newUser.paid_started_at, paid_until: newUser.paid_until,
          personal_email_exempted: exempted, invite, invite_lang: sendInvite ? inviteLang : null,
        },
        ip: (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.headers["x-real-ip"] || null,
        user_agent: req.headers["user-agent"] || null,
        success: true,
        error: inviteError,
      });
    } catch (auditErr) {
      console.warn("[create-user] audit insert failed", auditErr?.message || auditErr);
    }

    return res.status(200).json({ ok: true, user: newUser, invite, now: new Date(now).toISOString(), ...(inviteError ? { invite_error: inviteError } : {}) });
  } catch (e) {
    console.error("[create-user] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
