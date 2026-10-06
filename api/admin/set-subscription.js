// POST /api/admin/set-subscription
//
// Admin-only: change one existing user from the admin Users panel — the account
// type, the Premium period, the profile fields and the internal note — in one
// round-trip. Same security model as the other /api/admin endpoints: the caller
// must be tier='admin' (verified server-side via Supabase auth).
//
// Body: { user_id: string (required), and any of:
//   tier:              'pending' | 'free' | 'paid' | 'admin'   (not your own)
//   paid_started_at:   'YYYY-MM-DD' | ISO | null    "Premium from" (Premium only)
//   paid_until:        'YYYY-MM-DD' | ISO | null    "Premium to"; null = no end
//   full_name, company, position, phone, linkedin_url, subscription_note,
//   send_invite:       true → after the change, e-mail the person what they now
//                      have and how to sign in (the "account ready" mail, in
//                      invite_lang 'sk' | 'en'). Alone it just re-sends it — a
//                      lost invitation, or one that went out before the dates
//                      were changed (2026-10-06: an invite said "until 20 Oct",
//                      the period was moved to 3 Nov a minute later). }
//
// WHAT A CHANGE DOES is decided in ONE place, lib/adminUsers.js#planProfileUpdate,
// shared with the panel and tested there: → Premium starts a period today (or
// keeps one still running), → Free / No access ends every running premium access
// NOW, a day means a Bratislava calendar day, "from" is never in the future, "to"
// never before "from". A bad request is refused with a code the panel says in words.
//
// The one-click shortcuts this endpoint used to carry (+N trial days, +N paid days,
// pause / unpause) are gone with the buttons that sent them (Boss, 2026-10-06) —
// the period is now edited directly.
//
// Response 200 { ok, patch, user, invite } — `user` is the full row as the
// database now holds it, so the panel shows what was stored, not what it hoped
// to store; `invite` is 'sent' | 'failed' | 'not_requested'.

import { createClient } from "@supabase/supabase-js";
import { isTrustedRequest as isTrustedOrigin } from "../_lib/origin.js";
import { accountCreatedHtml, inviteSubject, sendEmail } from "../_lib/emails.js";
import { planProfileUpdate } from "../../src/lib/adminUsers.js";

export const maxDuration = 20;   // an optional e-mail rides on the same request

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

    const admin = createClient(URL, KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return res.status(401).json({ error: "invalid token" });

    const { data: caller } = await admin
      .from("user_profiles").select("tier").eq("id", user.id).maybeSingle();
    if (caller?.tier !== "admin") return res.status(403).json({ error: "admin only" });

    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "invalid JSON" }); }
    }
    if (!body || typeof body !== "object") return res.status(400).json({ error: "empty body" });

    const userId = String(body.user_id || "").trim();
    if (!userId) return res.status(400).json({ error: "user_id required" });

    const { data: target } = await admin
      .from("user_profiles").select("*").eq("id", userId).maybeSingle();
    if (!target) return res.status(404).json({ error: "target user not found" });

    const now = Date.now();
    const sendInvite = body.send_invite === true;
    const inviteLang = body.invite_lang === "en" ? "en" : "sk";
    const plan = planProfileUpdate(target, body, { now, isSelf: userId === user.id });
    // "Nothing changed" is fine when the point of the request is the e-mail.
    if (plan.error && !(sendInvite && plan.error === "nothing_to_change")) return res.status(400).json(plan);
    const patch = plan.patch || {};
    const nextTier = patch.tier ?? target.tier;
    if (sendInvite && nextTier === "pending") {
      return res.status(400).json({ error: "invite_no_access", message: "the account has no access to announce" });
    }

    // .select() + row-count check: the service-role key bypasses RLS, so a
    // 0-row result here means a real misconfig (wrong key / RLS regression) —
    // surface it LOUDLY instead of returning a misleading 200 that never landed.
    let row = target;
    if (Object.keys(patch).length) {
      const { data: updRows, error: updErr } = await admin
        .from("user_profiles").update(patch).eq("id", userId).select("*");
      if (updErr) return res.status(500).json({ error: "update failed", detail: updErr.message });
      if (!updRows || updRows.length === 0) {
        return res.status(500).json({ error: "write did not land — no row updated (key/RLS misconfig?)" });
      }
      row = updRows[0];
    }

    // The e-mail describes the row AS STORED — after the change — so it can never
    // announce a period the database does not hold.
    let invite = "not_requested", inviteError = null;
    if (sendInvite) {
      try {
        await sendEmail({
          to: row.email,
          subject: inviteSubject(inviteLang),
          html: accountCreatedHtml(row, process.env.WEB_URL || "https://residata.eu", inviteLang, now),
          gmailUser: process.env.GMAIL_FROM || "tkamhal@gmail.com",
          gmailPassword: process.env.GMAIL_APP_PASSWORD,
        });
        invite = "sent";
      } catch (e) {
        invite = "failed";
        inviteError = String(e?.message || e).slice(0, 200);
        console.error("[set-subscription] invitation failed", inviteError);
      }
    }

    // Audit — F-239 fix: previously wrote to columns admin_id / target_user_id /
    // details which DON'T EXIST in admin_audit_log (the actual schema uses
    // actor_id / target_id / payload — same as delete-user.js). Every
    // subscription_update insert was silently failing (only the .then()
    // .warn caught it, and Vercel logs aren't watched live). Result: ZERO
    // subscription_update rows in the live audit trail despite Boss using
    // this endpoint repeatedly via LiveAdmin. Mirror delete-user.js exactly.
    const clientIp =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      null;
    const userAgent = req.headers["user-agent"] || null;
    try {
      await admin.from("admin_audit_log").insert({
        actor_id:    user.id,
        actor_email: user.email || null,
        action:      Object.keys(patch).length ? "subscription_update" : "send_invite",
        target_id:   userId,
        // What changed AND what it was before — "Premium do 31. 12." alone does
        // not say whether it was an extension or a cut.
        payload:     {
          ...patch,
          before: Object.fromEntries(Object.keys(patch).map((k) => [k, target[k] ?? null])),
          ...(sendInvite ? { invite, invite_lang: inviteLang } : {}),
        },
        ip:          clientIp,
        user_agent:  userAgent,
        success:     true,
        error:       inviteError,
      });
    } catch (auditErr) {
      // Never let logging mask the real result — but DO surface the failure
      // in Vercel logs so the next ops sweep catches it.
      console.warn("[set-subscription] audit insert failed", auditErr?.message || auditErr);
    }

    // `now` = the moment the rules were applied (e.g. when "→ Free" ended
    // Premium); the panel adopts it so it judges the row by the same clock.
    return res.status(200).json({ ok: true, patch, user: row, invite, now: new Date(now).toISOString(), ...(inviteError ? { invite_error: inviteError } : {}) });
  } catch (e) {
    console.error("[set-subscription] crash", e);
    return res.status(500).json({ error: "internal error", detail: String(e?.message || e).slice(0, 200) });
  }
}
