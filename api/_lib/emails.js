// Shared email templates + SMTP helper for webhook endpoints.
//
// Inline-styled HTML (Gmail strips <style> tags). Mirrors the templates from
// notify_auth_events.py — if you change one, change the other.

import nodemailer from "nodemailer";

const green = "#00e5a0";
const textLight = "#e8e8ed";
const textDim = "#8a8a96";
const border = "#2a2a32";

// ──────────────────────────────────────────────────────────
// Inline CSS fragments (reused across blocks)
// ──────────────────────────────────────────────────────────
const S = {
  body: `margin:0;padding:0;background:#0a0a0b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${textLight}`,
  wrap: "max-width:560px;margin:0 auto;padding:32px 20px",
  logoBox: `display:inline-block;width:32px;height:32px;background:${green};border-radius:7px;text-align:center;line-height:32px;font-weight:700;font-size:16px;font-family:'JetBrains Mono',Consolas,monospace;color:#0a0a0b;vertical-align:middle`,
  logoText: `font-size:18px;font-weight:600;color:${textLight};vertical-align:middle;margin-left:8px`,
  card: `background:#16161a;border:1px solid ${border};border-radius:12px;padding:28px;margin-top:24px`,
  hello: `font-size:12px;color:${green};font-family:'JetBrains Mono',Consolas,monospace;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px`,
  h1: `margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${textLight}`,
  p: `margin:12px 0;line-height:1.6;color:#c0c0c8;font-size:15px`,
  btnGreen: `display:inline-block;background:${green};color:#0a0a0b;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;margin:6px 4px 6px 0`,
  btnOutline: `display:inline-block;background:transparent;color:${textLight};border:1px solid ${border};padding:12px 22px;border-radius:8px;font-weight:500;font-size:14px;text-decoration:none;margin:6px 4px 6px 0`,
  userBox: `padding:16px;border:1px solid ${border};border-radius:8px;margin:12px 0;background:#0e0e10`,
  emailLine: `font-size:16px;font-weight:600;color:${textLight};margin-bottom:8px;word-break:break-all`,
  badgeWarn: `display:inline-block;font-size:11px;padding:2px 8px;background:#f5a62320;color:#f5a623;border-radius:100px;font-family:'JetBrains Mono',Consolas,monospace;letter-spacing:0.05em;margin-left:6px`,
  badgeOk: `display:inline-block;font-size:11px;padding:2px 8px;background:#00e5a020;color:${green};border-radius:100px;font-family:'JetBrains Mono',Consolas,monospace;letter-spacing:0.05em;margin-left:6px`,
  row: `display:block;font-size:13px;color:#c0c0c8;margin:4px 0`,
  rowLabel: `color:${textDim};font-family:'JetBrains Mono',Consolas,monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-right:6px`,
  actions: `margin-top:14px;padding-top:14px;border-top:1px solid ${border}`,
  footer: `margin-top:32px;font-size:12px;color:#55555f;text-align:center;line-height:1.6`,
};

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "live.sk", "hotmail.sk", "yahoo.com", "yahoo.sk", "icloud.com", "me.com",
  "mac.com", "proton.me", "protonmail.com", "pm.me",
  "seznam.cz", "centrum.sk", "zoznam.sk", "azet.sk", "atlas.sk", "post.sk",
  "pobox.sk",
]);

function emailDomain(email) {
  return (email?.split("@")[1] || "").toLowerCase().trim();
}

// ──────────────────────────────────────────────────────────
// HMAC-signed approve URL (mirrors notify_auth_events.py)
// ──────────────────────────────────────────────────────────
import { createHmac } from "crypto";

export function approveUrl(userId, tier, supabaseUrl, hmacSecret, ttlSec = 7 * 86400) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${userId}|${tier}|${exp}`;
  const sig = createHmac("sha256", hmacSecret).update(payload).digest();
  // base64url encode
  const sigB64 = sig.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const token = `${payload}|${sigB64}`;
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/approve-user?token=${token}`;
}

// ──────────────────────────────────────────────────────────
// Admin FYI email — new free signup (freemium model, no approval gate)
// ──────────────────────────────────────────────────────────
export function adminDigestHtml(user, webUrl, supabaseUrl, hmacSecret) {
  const domain = emailDomain(user.email);
  const isPersonal = PERSONAL_DOMAINS.has(domain);
  const badge = isPersonal
    ? `<span style="${S.badgeWarn}">⚠ personal</span>`
    : `<span style="${S.badgeOk}">✓ business</span>`;

  // Only surface "Upgrade to paid" as an action — they're already free.
  // Makes sense for users the admin recognises and wants to bump.
  const upgradeUrl = approveUrl(user.id, "paid", supabaseUrl, hmacSecret);

  const rows = [];
  if (user.full_name)
    rows.push(`<div style="${S.row}"><span style="${S.rowLabel}">Name</span>${user.full_name}</div>`);
  if (user.company)
    rows.push(`<div style="${S.row}"><span style="${S.rowLabel}">Company</span>${user.company}</div>`);
  if (user.position)
    rows.push(`<div style="${S.row}"><span style="${S.rowLabel}">Position</span>${user.position}</div>`);
  if (user.linkedin_url)
    rows.push(`<div style="${S.row}"><span style="${S.rowLabel}">LinkedIn</span><a href="${user.linkedin_url}" style="color:${green}">${user.linkedin_url}</a></div>`);
  if (user.phone)
    rows.push(`<div style="${S.row}"><span style="${S.rowLabel}">Phone</span>${user.phone}</div>`);
  if (user.created_at)
    rows.push(`<div style="${S.row}"><span style="${S.rowLabel}">Registered</span>${user.created_at.slice(0, 16).replace("T", " ")}</div>`);

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${S.body}">
<div style="${S.wrap}">
  <div><span style="${S.logoBox}">R</span><span style="${S.logoText}">Residata</span></div>
  <div style="${S.card}">
    <div style="${S.hello}">New free signup · FYI</div>
    <h1 style="${S.h1}">Someone just signed up</h1>
    <p style="${S.p}">Auto-approved as <strong style="color:${green}">free</strong>. No action needed — they already have access to the free tier.</p>
    <div style="${S.userBox}">
      <div style="${S.emailLine}">${user.email}${badge}</div>
      ${rows.join("")}
      <div style="${S.actions}">
        <div style="font-size:11px;color:${textDim};font-family:'JetBrains Mono',Consolas,monospace;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px">Optional · only if you know them</div>
        <a href="${upgradeUrl}" style="${S.btnGreen}">⭐ Upgrade to paid</a>
      </div>
    </div>
    <p style="${S.p};font-size:13px;color:${textDim}">Full user list + manual controls:</p>
    <a href="${webUrl}/admin" style="${S.btnOutline}">Open admin panel →</a>
  </div>
  <div style="${S.footer}">Residata · real-time FYI · sign-ups are auto-approved as free</div>
</div>
</body></html>`;
}

// ──────────────────────────────────────────────────────────
// Welcome email (to the approved user)
// ──────────────────────────────────────────────────────────
export function approvedUserHtml(user, webUrl) {
  const tier = user.tier || "free";
  const tierDescr = tier === "paid"
    ? "As a paid member you have access to all projects, analytics, history, and CSV exports."
    : "As a free member you can view the summary dashboard plus full detail of one project of your choice.";
  const name = user.full_name || "there";
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="${S.body}">
<div style="${S.wrap}">
  <div><span style="${S.logoBox}">R</span><span style="${S.logoText}">Residata</span></div>
  <div style="${S.card}">
    <div style="${S.hello}">Welcome</div>
    <h1 style="${S.h1}">You're approved 🎉</h1>
    <p style="${S.p}">Hi ${name},</p>
    <p style="${S.p}">Your Residata account is now active as <strong style="color:${green}">${tier}</strong>. You can sign in and start exploring the Bratislava residential market.</p>
    <a href="${webUrl}/live" style="${S.btnGreen}">Open dashboard →</a>
    <p style="${S.p};font-size:13px;color:${textDim};margin-top:20px">${tierDescr}</p>
  </div>
  <div style="${S.footer}">Residata · <a href="${webUrl}" style="color:#55555f">${webUrl}</a></div>
</div>
</body></html>`;
}

// ──────────────────────────────────────────────────────────
// SMTP send helper (Gmail)
// ──────────────────────────────────────────────────────────
export async function sendEmail({ to, subject, html, from, gmailUser, gmailPassword }) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPassword },
  });
  await transporter.sendMail({
    from: `Residata <${from || gmailUser}>`,
    to,
    subject,
    html,
  });
}
