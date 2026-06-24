// Shared email templates + SMTP helper for webhook endpoints.
//
// Design: table-based, bgcolor + inline-styled so the email reads the
// same in Gmail (light + dark mode), Outlook, Apple Mail, Thunderbird
// and mobile clients. Everything user-facing lives inside a branded
// dark card (Residata look). The outer body has a neutral off-white
// so clients that strip body backgrounds still show a clean page.
//
// Mirrors the templates from notify_auth_events.py — if you change
// one, change the other.

import nodemailer from "nodemailer";

const GREEN     = "#00e5a0";
const CARD_BG   = "#0e0e10";   // dark Residata card
const CARD_BORDER = "#2a2a32";
const TEXT_HI   = "#e8e8ed";   // primary text on dark card
const TEXT_MID  = "#c0c0c8";   // body copy on dark card
const TEXT_DIM  = "#8a8a96";   // captions, labels
const OUTER_BG  = "#f5f5f7";   // neutral wrapper; most clients preserve this
const INNER_BOX = "#16161a";   // nested info box inside the card

// ──────────────────────────────────────────────────────────
// Inline CSS fragments (reused across blocks)
// ──────────────────────────────────────────────────────────
const S = {
  logoBox:   `display:inline-block;width:34px;height:34px;background:${GREEN};border-radius:8px;text-align:center;line-height:34px;font-weight:700;font-size:17px;font-family:'JetBrains Mono',Consolas,monospace;color:#0a0a0b;vertical-align:middle`,
  logoText:  `font-size:19px;font-weight:700;color:${TEXT_HI};vertical-align:middle;margin-left:10px;letter-spacing:-0.01em`,
  eyebrow:   `font-size:11px;color:${GREEN};font-family:'JetBrains Mono',Consolas,monospace;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 10px;font-weight:700`,
  h1:        `margin:0 0 16px;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${TEXT_HI};line-height:1.3`,
  p:         `margin:12px 0;line-height:1.6;color:${TEXT_MID};font-size:15px`,
  btnGreen:  `display:inline-block;background:${GREEN};color:#0a0a0b;padding:12px 22px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none;margin:6px 4px 6px 0`,
  btnOutline:`display:inline-block;background:transparent;color:${TEXT_HI};border:1px solid ${CARD_BORDER};padding:12px 22px;border-radius:8px;font-weight:500;font-size:14px;text-decoration:none;margin:6px 4px 6px 0`,
  userBox:   `padding:16px 18px;border:1px solid ${CARD_BORDER};border-radius:8px;margin:14px 0;background:${INNER_BOX}`,
  emailLine: `font-size:16px;font-weight:700;color:${TEXT_HI};margin-bottom:10px;word-break:break-all;line-height:1.3`,
  badgeWarn: `display:inline-block;font-size:11px;padding:2px 8px;background:#3a2a10;color:#f5a623;border-radius:100px;font-family:'JetBrains Mono',Consolas,monospace;letter-spacing:0.05em;margin-left:6px`,
  badgeOk:   `display:inline-block;font-size:11px;padding:2px 8px;background:#102a20;color:${GREEN};border-radius:100px;font-family:'JetBrains Mono',Consolas,monospace;letter-spacing:0.05em;margin-left:6px`,
  row:       `display:block;font-size:13px;color:${TEXT_MID};margin:6px 0;line-height:1.45`,
  rowLabel:  `color:${TEXT_DIM};font-family:'JetBrains Mono',Consolas,monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-right:8px`,
  actions:   `margin-top:16px;padding-top:16px;border-top:1px solid ${CARD_BORDER}`,
  footer:    `margin-top:20px;font-size:12px;color:${TEXT_DIM};text-align:center;line-height:1.6`,
};

/**
 * Wrap arbitrary inner HTML in the standard Residata email shell:
 * neutral outer wrapper → branded dark card → footer. Uses a nested
 * <table> with explicit bgcolor + role="presentation" for maximum
 * email-client compatibility (Outlook & Gmail both happy).
 *
 * The OUTER background is set both via style AND bgcolor attribute.
 * Some clients (Outlook 2016+ on Windows) ignore CSS on body; the
 * table bgcolor covers them. Clients in dark-mode that auto-invert
 * will still show the dark card legibly because text colors are
 * explicitly set on the card's inner cells.
 */
function shell({ title, preheader = "", inner, footer }) {
  const safePreheader = String(preheader || "").replace(/</g, "&lt;");
  return `<!DOCTYPE html>
<html lang="sk">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${title || "Residata"}</title>
</head>
<body style="margin:0;padding:0;background:${OUTER_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <!-- preheader: hidden in-client preview snippet -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden">${safePreheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${OUTER_BG}" style="background:${OUTER_BG};padding:24px 12px">
    <tr>
      <td align="center" style="padding:0">
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" bgcolor="${CARD_BG}" style="background:${CARD_BG};border:1px solid ${CARD_BORDER};border-radius:14px;overflow:hidden;max-width:560px;width:100%">
          <tr>
            <td style="padding:30px 32px;color:${TEXT_HI}">
              <div style="margin-bottom:20px">
                <span style="${S.logoBox}">R</span><span style="${S.logoText}">Residata</span>
              </div>
              ${inner}
            </td>
          </tr>
        </table>
        <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;width:100%">
          <tr>
            <td style="${S.footer}">
              ${footer || "Residata · realitné dáta o bratislavskom trhu novostavieb"}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

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
    rows.push(`<div style="${S.row}"><span style="${S.rowLabel}">Name</span><span style="color:${TEXT_HI}">${user.full_name}</span></div>`);
  if (user.company)
    rows.push(`<div style="${S.row}"><span style="${S.rowLabel}">Company</span><span style="color:${TEXT_HI}">${user.company}</span></div>`);
  if (user.position)
    rows.push(`<div style="${S.row}"><span style="${S.rowLabel}">Position</span>${user.position}</div>`);
  if (user.linkedin_url)
    rows.push(`<div style="${S.row}"><span style="${S.rowLabel}">LinkedIn</span><a href="${user.linkedin_url}" style="color:${GREEN};text-decoration:none">${user.linkedin_url}</a></div>`);
  if (user.phone)
    rows.push(`<div style="${S.row}"><span style="${S.rowLabel}">Phone</span>${user.phone}</div>`);
  if (user.created_at)
    rows.push(`<div style="${S.row}"><span style="${S.rowLabel}">Registered</span>${user.created_at.slice(0, 16).replace("T", " ")}</div>`);

  const inner = `
    <div style="${S.eyebrow}">New free signup · FYI</div>
    <h1 style="${S.h1}">Someone just signed up</h1>
    <p style="${S.p}">Auto-approved as <strong style="color:${GREEN}">free</strong>. No action needed — they already have access to the free tier.</p>
    <div style="${S.userBox}">
      <div style="${S.emailLine}">${user.email}${badge}</div>
      ${rows.join("")}
      <div style="${S.actions}">
        <div style="font-size:11px;color:${TEXT_DIM};font-family:'JetBrains Mono',Consolas,monospace;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:10px">Optional · only if you know them</div>
        <a href="${upgradeUrl}" style="${S.btnGreen}">⭐ Upgrade to paid</a>
      </div>
    </div>
    <p style="${S.p};font-size:13px;color:${TEXT_DIM}">Full user list + manual controls:</p>
    <a href="${webUrl}/app/admin" style="${S.btnOutline}">Open admin panel →</a>`;

  return shell({
    title: "New Residata signup",
    preheader: `New signup: ${user.email}`,
    inner,
    footer: "Residata · real-time FYI · sign-ups are auto-approved as free",
  });
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
  const inner = `
    <div style="${S.eyebrow}">Welcome</div>
    <h1 style="${S.h1}">You're approved 🎉</h1>
    <p style="${S.p}">Hi ${name},</p>
    <p style="${S.p}">Your Residata account is now active as <strong style="color:${GREEN}">${tier}</strong>. You can sign in and start exploring the Bratislava residential market.</p>
    <a href="${webUrl}/live" style="${S.btnGreen}">Open dashboard →</a>
    <p style="${S.p};font-size:13px;color:${TEXT_DIM};margin-top:20px">${tierDescr}</p>`;
  return shell({
    title: "Welcome to Residata",
    preheader: `You're approved as ${tier}. Open the dashboard.`,
    inner,
    footer: `Residata · <a href="${webUrl}" style="color:${TEXT_DIM};text-decoration:none">${webUrl}</a>`,
  });
}

// ──────────────────────────────────────────────────────────
// User feedback / problem-report notification
// ──────────────────────────────────────────────────────────

// Shared by the email builder + the /api/feedback/submit subject line so
// the label is identical in the inbox and in the message body. English —
// admin-facing, same as every other notification in this file.
export const FEEDBACK_CATEGORY_LABELS = {
  data:     { label: "Data quality",      emoji: "📊" },
  bug:      { label: "Bug / not working", emoji: "🐞" },
  website:  { label: "Website / display", emoji: "🖥️" },
  question: { label: "Question",          emoji: "❓" },
  idea:     { label: "Suggestion / feature", emoji: "💡" },
  other:    { label: "Other",             emoji: "💬" },
};

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Admin notification for a new feedback / problem report submitted via the
 * site-wide widget. Mirrors the branded dark card used by the other emails.
 *
 * @param {object} fb  { category, message, email, user_tier, page_path,
 *                        page_url, created_at }
 * @param {string} webUrl  base site URL (for the "open feedback log" button)
 */
export function feedbackHtml(fb, webUrl) {
  const meta = FEEDBACK_CATEGORY_LABELS[fb.category] || FEEDBACK_CATEGORY_LABELS.other;
  const when = (fb.created_at || new Date().toISOString()).slice(0, 16).replace("T", " ");
  const msgHtml = escHtml(fb.message).replace(/\n/g, "<br>");

  const rows = [
    `<div style="${S.row}"><span style="${S.rowLabel}">From</span><span style="color:${TEXT_HI}">${fb.email ? escHtml(fb.email) : "anonymous"}</span></div>`,
    `<div style="${S.row}"><span style="${S.rowLabel}">Tier</span>${escHtml(fb.user_tier || "anon")}</div>`,
    fb.project_name ? `<div style="${S.row}"><span style="${S.rowLabel}">Project</span><span style="color:${TEXT_HI}">${escHtml(fb.project_name)}</span></div>` : "",
    fb.page_path ? `<div style="${S.row}"><span style="${S.rowLabel}">Page</span>${escHtml(fb.page_path)}</div>` : "",
    `<div style="${S.row}"><span style="${S.rowLabel}">When</span>${escHtml(when)} UTC</div>`,
    fb.has_attachment ? `<div style="${S.row}"><span style="${S.rowLabel}">Screenshot</span><span style="color:${GREEN}">📎 attached — open the log to view</span></div>` : "",
  ].join("");

  const inner = `
    <div style="${S.eyebrow}">New feedback · ${escHtml(meta.label)}</div>
    <h1 style="${S.h1}">${meta.emoji} ${escHtml(meta.label)}</h1>
    <div style="padding:16px 18px;border:1px solid ${CARD_BORDER};border-radius:8px;margin:14px 0;background:${INNER_BOX};color:${TEXT_HI};font-size:15px;line-height:1.6;white-space:normal">${msgHtml}</div>
    <div style="${S.userBox}">
      ${rows}
    </div>
    <a href="${webUrl}/app/feedback" style="${S.btnGreen}">Open feedback log →</a>`;

  return shell({
    title: "New Residata feedback",
    preheader: `${meta.label}: ${String(fb.message || "").slice(0, 80)}`,
    inner,
    footer: "Residata · user feedback · reply to the address above if it needs a follow-up",
  });
}

/**
 * Reply email sent TO the user when the admin answers their feedback from the
 * admin log. `reply` is the admin's text; `original` quotes their message.
 * Chrome is localised to the user's language; the body is the admin's words.
 */
export function feedbackReplyHtml(reply, original, webUrl, lang = "sk") {
  const sk = lang === "sk";
  const t = (s, e) => (sk ? s : e);
  const replyHtml = escHtml(reply).replace(/\n/g, "<br>");
  const origBlock = original
    ? `<div style="border-left:2px solid ${CARD_BORDER};padding-left:12px;margin:8px 0 0;color:${TEXT_DIM};font-size:13px;line-height:1.6">${escHtml(String(original).slice(0, 600)).replace(/\n/g, "<br>")}</div>`
    : "";
  const inner = `
    <div style="${S.eyebrow}">${t("Odpoveď od Residata", "Reply from Residata")}</div>
    <h1 style="${S.h1}">${t("Ozvali sme sa ti", "We got back to you")} 🙌</h1>
    <p style="${S.p}">${t("Ďakujeme za tvoju správu — tu je naša odpoveď:", "Thanks for your message — here's our reply:")}</p>
    <div style="padding:16px 18px;border:1px solid ${CARD_BORDER};border-radius:8px;margin:14px 0;background:${INNER_BOX};color:${TEXT_HI};font-size:15px;line-height:1.6">${replyHtml}</div>
    ${original ? `<p style="${S.p};font-size:12px;color:${TEXT_DIM};margin-bottom:2px">${t("Tvoja pôvodná správa:", "Your original message:")}</p>${origBlock}` : ""}
    <a href="${webUrl}" style="${S.btnGreen};margin-top:14px">${t("Otvoriť Residatu", "Open Residata")} →</a>`;
  return shell({
    title: t("Odpoveď od Residata", "Reply from Residata"),
    preheader: String(reply || "").slice(0, 80),
    inner,
    footer: t("Residata · tento e-mail dostávaš, lebo si nám poslal spätnú väzbu",
              "Residata · you're receiving this because you sent us feedback"),
  });
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
