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
import { resolveSender } from "./senders.js";

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
  legalFooter: `margin-top:10px;padding-top:10px;border-top:1px solid #23232b;font-size:11px;color:${TEXT_DIM};line-height:1.55`,
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
function shell({ title, preheader = "", inner, footer, lang = "sk" }) {
  const safePreheader = String(preheader || "").replace(/</g, "&lt;");
  return `<!DOCTYPE html>
<html lang="${lang}">
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
              ${footer || "Residata · dáta o trhu novostavieb na Slovensku a v Česku"}
              <div style="${S.legalFooter}">${legalFooterHtml(lang)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// The personal-domain list is the sign-up form's (lib/emailValidation) — one list,
// so the badge in Boss's note can never disagree with what the form told the person.
import { isPersonalEmail } from "../../src/lib/emailValidation.js";


import { COMPANY, addressOneLine, registrationLine } from "../../src/lib/company.js";

/**
 * The sender's legal identity, in the footer of every email we send.
 *
 * § 3a of the Commercial Code applies to a registered company's "business
 * documents ... in written or electronic form" — which includes the emails we
 * send customers, not only the website. It was on neither until today.
 *
 * Read from lib/company like every other surface, so the day the DIČ or IČ DPH
 * is issued it appears here too without anyone remembering that emails exist.
 */
function legalFooterHtml(lang = "sk") {
  const isSK = lang === "sk";
  const ids = [`IČO: ${COMPANY.ico}`];
  if (COMPANY.dic) ids.push(`DIČ: ${COMPANY.dic}`);
  if (COMPANY.icDph) ids.push(`IČ DPH: ${COMPANY.icDph}`);
  return [
    `${COMPANY.legalName}, ${addressOneLine(lang)}`,
    `${ids.join(" · ")}`,
    registrationLine(lang),
  ].join("<br>");
}

// ──────────────────────────────────────────────────────────
// Admin FYI email — new free signup (freemium model, no approval gate)
// ──────────────────────────────────────────────────────────

/**
 * Boss's "someone signed up" note. Every value in it was typed by the person
 * signing up — name, company, LinkedIn — and the API accepts them as typed (the
 * form's own cleaning runs in their browser), so each is escaped here: this
 * lands in the admin's inbox, and an unescaped name is a way to put a link or
 * a fake button in front of him.
 *
 * It used to carry a one-click "⭐ Upgrade to paid" link (approve-user). That
 * function only acts on PENDING accounts and every account reaching this mail
 * is already approved, so the button answered "Already approved" every time.
 * Premium is given in admin → Users, which is where the button now goes.
 */
/**
 * Boss's note that someone signed up (api/webhooks/admin-notify.js) — one per
 * account, the moment the sign-up form is finished. Boss 2026-10-07: "i want to
 * receive an email every time a new user registers". It says who it is (name,
 * company, role, contacts), what they got (Free, or the 7-day trial they asked for),
 * in which language, whether colleagues are already here, and links straight to
 * the person's activity page in admin.
 *
 * `extra`: { lang, trialRunning, trialIntent, colleagues: [email], accountNo }
 */
export function adminDigestSubject(user) {
  const who = [user.full_name, user.company && `(${user.company})`].filter(Boolean).join(" ");
  return `[Residata] New sign-up: ${who ? `${who} — ` : ""}${user.email}`;
}

export function adminDigestHtml(user, webUrl, extra = {}) {
  const badge = isPersonalEmail(user.email)
    ? `<span style="${S.badgeWarn}">⚠ personal</span>`
    : `<span style="${S.badgeOk}">✓ business</span>`;

  const row = (label, value) => `<div style="${S.row}"><span style="${S.rowLabel}">${label}</span><span style="color:${TEXT_HI}">${value}</span></div>`;
  const rows = [];
  if (user.full_name) rows.push(row("Name", escHtml(user.full_name)));
  if (user.company)   rows.push(row("Company", escHtml(user.company)));
  if (user.position)  rows.push(row("Position", escHtml(user.position)));
  const li = safeHttpUrl(user.linkedin_url);
  if (li) rows.push(row("LinkedIn", `<a href="${escHtml(li)}" style="color:${GREEN};text-decoration:none">${escHtml(li)}</a>`));
  if (user.phone)     rows.push(row("Phone", escHtml(user.phone)));
  if (user.created_at) rows.push(row("Registered", escHtml(fmtStamp(user.created_at))));
  if (extra.lang)     rows.push(row("Language", extra.lang === "en" ? "English" : "Slovak"));
  rows.push(row("Plan", extra.trialRunning
    ? `<strong style="color:${GREEN}">7-day Premium trial</strong> running until ${escHtml(fmtStamp(user.trial_until))}`
    : extra.trialIntent
    ? `<strong style="color:${GREEN}">7-day Premium trial</strong> requested at sign-up — starts with the welcome e-mail`
    : "Free — market overview + one project of their choice"));
  const mates = (extra.colleagues || []).filter((e) => e && e !== user.email);
  if (mates.length) rows.push(row("Colleagues here", `${mates.length}: ${mates.slice(0, 5).map(escHtml).join(", ")}${mates.length > 5 ? " …" : ""}`));
  if (extra.accountNo) rows.push(row("Account no.", `#${Number(extra.accountNo)}`));

  const personUrl = `${webUrl}/app/admin?tab=users&user=${encodeURIComponent(user.id)}`;
  const inner = `
    <div style="${S.eyebrow}">New sign-up · FYI</div>
    <h1 style="${S.h1}">${user.full_name ? `${escHtml(user.full_name)} just signed up` : "Someone just signed up"}</h1>
    <p style="${S.p}">Approved automatically — nothing to do. To give Premium, open the person in admin → Users; their activity page shows what they do from today on.</p>
    <div style="${S.userBox}">
      <div style="${S.emailLine}">${escHtml(user.email)}${badge}</div>
      ${rows.join("")}
    </div>
    <a href="${personUrl}" style="${S.btnGreen}">Open their activity</a>
    <a href="${webUrl}/app/admin?tab=users" style="${S.btnOutline}">All users</a>`;

  return shell({
    title: "New Residata signup",
    preheader: `New sign-up: ${[user.full_name, user.company].filter(Boolean).join(", ") || user.email}`,
    inner,
    footer: "Residata · real-time FYI · one e-mail per new account",
    lang: "en",
  });
}

/**
 * The other half of "every time a new user registers": a person who confirmed the
 * e-mail code and then left the profile form. Without this Boss never heard of them —
 * the note above waits for the finished form. Sent once, about an hour later
 * (pg_cron notify-unfinished-signups → admin-notify kind "unfinished").
 */
export function adminUnfinishedSubject(user) {
  return `[Residata] Sign-up not finished: ${user.email}`;
}

export function adminUnfinishedHtml(user, webUrl, extra = {}) {
  const badge = isPersonalEmail(user.email)
    ? `<span style="${S.badgeWarn}">⚠ personal</span>`
    : `<span style="${S.badgeOk}">✓ business</span>`;
  const row = (label, value) => `<div style="${S.row}"><span style="${S.rowLabel}">${label}</span><span style="color:${TEXT_HI}">${value}</span></div>`;
  const rows = [];
  if (user.created_at) rows.push(row("Code confirmed", escHtml(fmtStamp(extra.confirmedAt || user.created_at))));
  if (extra.lang) rows.push(row("Language", extra.lang === "en" ? "English" : "Slovak"));
  if (extra.trialIntent) rows.push(row("Wanted", "the 7-day Premium trial"));
  const mates = (extra.colleagues || []).filter((e) => e && e !== user.email);
  if (mates.length) rows.push(row("Colleagues here", `${mates.length}: ${mates.slice(0, 5).map(escHtml).join(", ")}`));
  const inner = `
    <div style="${S.eyebrow}">Sign-up not finished · FYI</div>
    <h1 style="${S.h1}">Someone started signing up and stopped</h1>
    <p style="${S.p}">They confirmed their e-mail but did not fill in the short profile form, so they have no access yet. If you know them, a personal nudge usually helps — or create the account for them in admin → Users.</p>
    <div style="${S.userBox}">
      <div style="${S.emailLine}">${escHtml(user.email)}${badge}</div>
      ${rows.join("")}
    </div>
    <a href="mailto:${escHtml(user.email)}" style="${S.btnGreen}">Write to them</a>
    <a href="${webUrl}/app/admin?tab=users&user=${encodeURIComponent(user.id)}" style="${S.btnOutline}">Open in admin</a>`;
  return shell({
    title: "Residata sign-up not finished",
    preheader: `Sign-up not finished: ${user.email}`,
    inner,
    footer: "Residata · real-time FYI · sent once per person",
    lang: "en",
  });
}

/** An http(s) URL, or null — so a stored value can never become a javascript: link. */
function safeHttpUrl(v) {
  try {
    const u = new URL(String(v || ""));
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch { return null; }
}

/** "2026-10-06 15:26" in Bratislava time — a timestamp read by a person in Slovakia. */
function fmtStamp(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString("sv-SE", { timeZone: "Europe/Bratislava", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const fmtLongDay = (ts, lang) => new Date(ts).toLocaleDateString(lang === "sk" ? "sk-SK" : "en-GB",
  { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Bratislava" });

// ──────────────────────────────────────────────────────────
// Welcome email (to a person who has just signed up on the web)
// ──────────────────────────────────────────────────────────

/**
 * The first thing a new user gets from us, sent when they finish the sign-up
 * form. In their language (the one the site was in when they signed up — see
 * welcome-user.js), saying what they actually have: a free account is the
 * market overview + one project of their choice, and the 7-day Premium trial
 * is one click away (or already running, if they asked for it on the way in).
 *
 * It used to be English only, announce "You're approved 🎉 … active as free"
 * (the raw tier word), say nothing of the trial, and print the name unescaped.
 */
export function welcomeSubject(lang = "sk") {
  return lang === "sk" ? "Vitajte v Residata — váš účet je aktívny" : "Welcome to Residata — your account is active";
}

export function approvedUserHtml(user, webUrl, lang = "sk", now = Date.now()) {
  const sk = lang === "sk";
  const t = (a, b) => (sk ? a : b);
  const name = escHtml(user.full_name || "");
  const trialUntil = user.trial_until ? new Date(user.trial_until).getTime() : null;
  const trialRunning = trialUntil && trialUntil > now;
  const paidUntil = user.paid_until ? new Date(user.paid_until).getTime() : null;

  let access;
  if (user.tier === "admin") {
    access = t("Máte administrátorský prístup.", "You have administrator access.");
  } else if (user.tier === "paid" && !(paidUntil && paidUntil <= now)) {
    access = paidUntil
      ? t(`Máte prístup <strong style="color:${GREEN}">Premium</strong> do ${fmtLongDay(paidUntil, lang)} — všetky projekty, analytiku, históriu a exporty.`,
          `You have <strong style="color:${GREEN}">Premium</strong> access until ${fmtLongDay(paidUntil, lang)} — every project, analytics, history and exports.`)
      : t(`Máte prístup <strong style="color:${GREEN}">Premium</strong> — všetky projekty, analytiku, históriu a exporty.`,
          `You have <strong style="color:${GREEN}">Premium</strong> access — every project, analytics, history and exports.`);
  } else {
    access = t("Máte bezplatný účet: prehľad trhu novostavieb na Slovensku a v Česku a plný detail jedného projektu podľa vlastného výberu.",
               "You have a free account: the overview of the Slovak and Czech new-build market, and the full detail of one project of your choice.");
  }

  let trialBox = "";
  if (user.tier === "free" && trialRunning) {
    trialBox = `
    <div style="${S.userBox}">
      <div style="${S.rowLabel}">${t("Premium na 7 dní", "7 days of Premium")}</div>
      <p style="${S.p};margin:8px 0 0">${t(
        `Váš bezplatný trial Premium beží do <strong style="color:${TEXT_HI}">${fmtLongDay(trialUntil, lang)}</strong> — všetky projekty, analytika a história. Potom sa účet sám vráti na bezplatný; nič sa nestrháva.`,
        `Your free Premium trial runs until <strong style="color:${TEXT_HI}">${fmtLongDay(trialUntil, lang)}</strong> — every project, analytics and history. After that the account simply returns to free; nothing is charged.`,
      )}</p>
    </div>`;
  } else if (user.tier === "free" && !user.trial_started_at) {
    trialBox = `
    <div style="${S.userBox}">
      <div style="${S.rowLabel}">${t("Vyskúšajte Premium", "Try Premium")}</div>
      <p style="${S.p};margin:8px 0 0">${t(
        "Premium si môžete vyskúšať 7 dní zadarmo — všetky projekty, analytika a história, bez karty a bez platby. Spustíte ho jedným klikom v aplikácii.",
        "You can try Premium free for 7 days — every project, analytics and history, no card and no payment. Start it with one click in the app.",
      )}</p>
    </div>`;
  }

  const inner = `
    <div style="${S.eyebrow}">${t("Vitajte", "Welcome")}</div>
    <h1 style="${S.h1}">${t("Váš účet na Residata je aktívny", "Your Residata account is active")}</h1>
    <p style="${S.p}">${name ? t(`Dobrý deň, ${name},`, `Hello ${name},`) : t("Dobrý deň,", "Hello,")}</p>
    <p style="${S.p}">${t("ďakujeme za registráciu. ", "thank you for signing up. ")}${access}</p>
    ${trialBox}
    <a href="${webUrl}/app" style="${S.btnGreen}">${t("Otvoriť Residata", "Open Residata")} →</a>
    <p style="${S.p};font-size:13px;color:${TEXT_DIM};margin-top:20px">${t(
      "Nabudúce sa prihlásite rovnako: zadáte svoj e-mail a my vám pošleme jednorazový kód — heslo nepotrebujete.",
      "Next time you sign in the same way: enter your e-mail and we send you a one-time code — there is no password.",
    )}</p>`;
  return shell({
    title: t("Vitajte v Residata", "Welcome to Residata"),
    preheader: t("Váš účet je aktívny. Otvorte Residata.", "Your account is active. Open Residata."),
    inner,
    footer: `Residata · <a href="${webUrl}" style="color:${TEXT_DIM};text-decoration:none">${webUrl.replace(/^https?:\/\//, "")}</a>`,
    lang: sk ? "sk" : "en",
  });
}

// ──────────────────────────────────────────────────────────
// Account created by an admin (admin → Users → "Add user")
// ──────────────────────────────────────────────────────────

/**
 * The invitation an admin may send with a new account. The person never asked
 * for it — Boss made the account for them (a journalist, a partner) — so it says
 * who they are to us, what they have, and the one thing they need to know: there
 * is no password, they sign in with this address and get a one-time code. Sent
 * only when the admin ticks it; otherwise the account is created silently and
 * the admin tells the person himself.
 *
 * `user` is the new profile row (full_name, email, tier, paid_until).
 */
export function inviteSubject(lang = "sk") {
  return lang === "sk" ? "Váš účet na Residata je pripravený" : "Your Residata account is ready";
}

export function accountCreatedHtml(user, webUrl, lang = "sk", now = Date.now()) {
  const sk = lang === "sk";
  const t = (a, b) => (sk ? a : b);
  const name = escHtml(user.full_name || "");
  const email = escHtml(user.email || "");
  const untilMs = user.paid_until ? new Date(user.paid_until).getTime() : null;
  const until = untilMs ? fmtLongDay(untilMs, lang) : null;
  // Re-sent later (admin → edit → "send again"), the period may have ended: then
  // it is a free account and must not read "Premium until <a past date>".
  const premiumNow = user.tier === "paid" && !(untilMs && untilMs <= now);
  const access = premiumNow
    ? (until
        ? t(`Máte prístup <strong style="color:${GREEN}">Premium</strong> do ${until} — všetky projekty, analytiku, históriu a exporty.`,
            `You have <strong style="color:${GREEN}">Premium</strong> access until ${until} — every project, analytics, history and exports.`)
        : t(`Máte prístup <strong style="color:${GREEN}">Premium</strong> — všetky projekty, analytiku, históriu a exporty.`,
            `You have <strong style="color:${GREEN}">Premium</strong> access — every project, analytics, history and exports.`))
    : user.tier === "admin"
      ? t("Máte administrátorský prístup.", "You have administrator access.")
      : t("Máte bezplatný prístup: prehľad trhu a detail jedného projektu podľa vlastného výberu.",
          "You have free access: the market overview and the full detail of one project of your choice.");
  const inner = `
    <div style="${S.eyebrow}">${t("Váš účet", "Your account")}</div>
    <h1 style="${S.h1}">${t("Váš účet na Residata je pripravený", "Your Residata account is ready")}</h1>
    <p style="${S.p}">${name ? t(`Dobrý deň, ${name},`, `Hello ${name},`) : t("Dobrý deň,", "Hello,")}</p>
    <p style="${S.p}">${t(
      `vytvorili sme vám účet na Residata — dáta o predaji novostavieb na Slovensku a v Česku. ${access}`,
      `we have created a Residata account for you — sales data on new-build housing in Slovakia and Czechia. ${access}`,
    )}</p>
    <div style="${S.userBox}">
      <div style="${S.rowLabel}">${t("Ako sa prihlásiť", "How to sign in")}</div>
      <p style="${S.p};margin:8px 0 0">${t(
        `Otvorte Residata, kliknite na <strong style="color:${TEXT_HI}">Prihlásiť sa</strong> a zadajte <strong style="color:${TEXT_HI}">${email}</strong>. Pošleme vám jednorazový kód — heslo nepotrebujete.`,
        `Open Residata, click <strong style="color:${TEXT_HI}">Sign in</strong> and enter <strong style="color:${TEXT_HI}">${email}</strong>. We will e-mail you a one-time code — there is no password.`,
      )}</p>
    </div>
    <a href="${webUrl}/app" style="${S.btnGreen}">${t("Otvoriť Residata", "Open Residata")} →</a>`;
  return shell({
    lang,
    title: t("Váš účet na Residata", "Your Residata account"),
    preheader: t("Účet je pripravený — prihlásite sa svojím e-mailom a jednorazovým kódom.", "Your account is ready — sign in with your e-mail and a one-time code."),
    inner,
    footer: `Residata · <a href="${webUrl}" style="color:${TEXT_DIM};text-decoration:none">${webUrl.replace(/^https?:\/\//, "")}</a>`,
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
    <div style="${S.eyebrow}">${fb.is_reply ? "New message in a conversation" : "New feedback"} · ${escHtml(meta.label)}</div>
    <h1 style="${S.h1}">${fb.is_reply ? "↩ " : ""}${meta.emoji} ${escHtml(meta.label)}</h1>
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
export function feedbackReplyHtml(reply, original, webUrl, lang = "sk", convId = null) {
  const sk = lang === "sk";
  const t = (s, e) => (sk ? s : e);
  const replyHtml = escHtml(reply).replace(/\n/g, "<br>");
  const origBlock = original
    ? `<div style="border-left:2px solid ${CARD_BORDER};padding-left:12px;margin:8px 0 0;color:${TEXT_DIM};font-size:13px;line-height:1.6">${escHtml(String(original).slice(0, 600)).replace(/\n/g, "<br>")}</div>`
    : "";
  // Deep-link straight to THIS conversation on the platform — the widget reads
  // ?feedback=<id> and opens the thread, so the user lands on our reply and can
  // answer in-app immediately (no external email thread).
  const convLink = convId ? `${webUrl}/app?feedback=${encodeURIComponent(convId)}` : `${webUrl}/app`;
  const inner = `
    <div style="${S.eyebrow}">${t("Odpoveď od Residata", "Reply from Residata")}</div>
    <h1 style="${S.h1}">${t("Ozvali sme sa ti", "We got back to you")} 🙌</h1>
    <p style="${S.p}">${t("Ďakujeme za tvoju správu — tu je naša odpoveď:", "Thanks for your message — here's our reply:")}</p>
    <div style="padding:16px 18px;border:1px solid ${CARD_BORDER};border-radius:8px;margin:14px 0;background:${INNER_BOX};color:${TEXT_HI};font-size:15px;line-height:1.6">${replyHtml}</div>
    ${original ? `<p style="${S.p};font-size:12px;color:${TEXT_DIM};margin-bottom:2px">${t("Tvoja pôvodná správa:", "Your original message:")}</p>${origBlock}` : ""}
    <a href="${convLink}" style="${S.btnGreen};margin-top:14px">${t("Otvoriť konverzáciu na platforme", "Open the conversation on the platform")} →</a>
    <p style="${S.p};font-size:12px;color:${TEXT_DIM};margin-top:12px">${t("Odpovedať môžeš priamo tu v e-maile aj v aplikácii.", "You can reply right here by email or in the app.")}</p>`;
  return shell({ lang,
    title: t("Odpoveď od Residata", "Reply from Residata"),
    preheader: String(reply || "").slice(0, 80),
    inner,
    footer: t("Residata · tento e-mail dostávaš, lebo si nám poslal spätnú väzbu",
              "Residata · you're receiving this because you sent us feedback"),
  });
}

/**
 * Receipt email sent TO the user right after they submit a NEW message via the
 * feedback widget — confirms we received it and points back to the conversation
 * on the platform. Only sent when we have an email to send to.
 */
export function feedbackReceiptHtml(fb, webUrl, lang = "sk", convId = null) {
  const sk = lang === "sk";
  const t = (s, e) => (sk ? s : e);
  const meta = FEEDBACK_CATEGORY_LABELS[fb.category] || FEEDBACK_CATEGORY_LABELS.other;
  const msgHtml = escHtml(String(fb.message || "")).replace(/\n/g, "<br>");
  const convLink = convId ? `${webUrl}/app?feedback=${encodeURIComponent(convId)}` : `${webUrl}/app`;
  const inner = `
    <div style="${S.eyebrow}">${t("Máme to", "Got it")} · ${escHtml(meta.label)}</div>
    <h1 style="${S.h1}">${t("Tvoja správa dorazila", "Your message reached us")} 🙌</h1>
    <p style="${S.p}">${t("Ďakujeme! Ozveme sa ti čo najskôr — odpoveď uvidíš tu v e-maile aj v aplikácii v sekcii „Moje konverzácie“.", "Thanks! We'll get back to you shortly — you'll see the reply here by email and in the app under \"My conversations\".")}</p>
    <div style="padding:16px 18px;border:1px solid ${CARD_BORDER};border-radius:8px;margin:14px 0;background:${INNER_BOX};color:${TEXT_HI};font-size:15px;line-height:1.6">${msgHtml}</div>
    <a href="${convLink}" style="${S.btnGreen};margin-top:6px">${t("Otvoriť konverzáciu", "Open the conversation")} →</a>`;
  return shell({ lang,
    title: t("Máme tvoju správu", "We received your message"),
    preheader: t("Ďakujeme — ozveme sa ti čoskoro.", "Thanks — we'll get back to you soon."),
    inner,
    footer: t("Residata · potvrdenie prijatia tvojej správy", "Residata · confirmation we received your message"),
  });
}

// ──────────────────────────────────────────────────────────
// SMTP send helper.
//
// HOW IT SENDS (live): Resend, over SMTP. `SMTP_HOST=smtp.resend.com`,
// `SMTP_PORT=465`, `SMTP_USER=resend`, `SMTP_PASS=<api key>` in Vercel. Resend
// verifies the DOMAIN residata.eu (DKIM at `resend._domainkey.residata.eu`,
// envelope sender on `send.residata.eu`), so ANY @residata.eu address is a valid
// From — which is what lets the role-based senders below work without further setup.
//
// The From address is DECOUPLED from the SMTP login: `resend` is the login, the
// visible sender is chosen by role. There is deliberately no MAIL_FROM variable set
// in Vercel any more — Vercel marks these write-only, so `vercel env pull` returns
// an empty value and nobody, including the person who set it, can read back which
// address the product actually sends as. The constants below are the source of
// truth precisely because they can be read. MAIL_FROM is still honoured if someone
// sets it, but nothing depends on it.
// ── WHO THE MAIL COMES FROM — one place, decided by ROLE (Boss 2026-09-03) ──
// residata.eu has three mailboxes and each has exactly one job:
//
//   noreply@  machine mail nobody is expected to answer (welcome, resets, reports,
//             invoices). It IS a real mailbox that copies to his Gmail, so even a
//             reply sent to it in spite of the name is never lost.
//   info@     anything a person may legitimately reply to.
//   tomas@    him personally — his contact card and sales. NEVER a machine sender.
//
// The caller does not pick an address, it declares whether the mail is part of a
// conversation; that way a new email cannot accidentally introduce a fourth
// sender, and there is no second place where an address is written down.
// Automated mail still carries Reply-To: info@, so a customer who hits reply
// reaches a monitored mailbox instead of the void.
export async function sendEmail({ to, subject, html, from, gmailUser, gmailPassword, replyTo, conversational = false }) {
  const host = process.env.SMTP_HOST || "smtp.gmail.com";
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER || gmailUser;          // SMTP LOGIN (auth) — the real account
  const pass = process.env.SMTP_PASS || gmailPassword;
  // `from` is the pre-2026-09 Gmail-era parameter. It is deliberately NOT consulted:
  // MAIL_FROM already overrode it in production, so ignoring it changes nothing that
  // ran, and it stops a caller quietly reintroducing tkamhal@gmail.com as a sender.
  const { from: fromAddr, replyTo: replyAddr } = resolveSender({ conversational, replyTo });
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,   // 465 = implicit TLS; 587 = STARTTLS (provider-dependent)
    auth: { user, pass },
  });
  await transporter.sendMail({
    from: `Residata <${fromAddr}>`,
    to,
    ...(replyAddr ? { replyTo: replyAddr } : {}),
    subject,
    html,
  });
  // Success breadcrumb (no PII beyond the From) so a send is verifiable in the
  // Vercel runtime logs — the helpers only log on FAILURE otherwise.
  console.log(`[email] sent via ${host} from ${fromAddr}`);
}


/**
 * The invoice email we send ourselves after a successful payment.
 *
 * Stripe can email invoices, but only if someone switches it on in the
 * dashboard — and the Terms promise the customer a document. Sending it from
 * here means the promise is kept by code that is reviewed and tested, in the
 * customer's own language, carrying our legal identity like every other email,
 * and it keeps working whoever is administering the Stripe account.
 *
 * `inv` is the Stripe Invoice object. Both links come from Stripe and are
 * long-lived signed URLs; we never attach the PDF ourselves.
 */
export function invoicePaidHtml(inv, webUrl, lang = "sk") {
  const sk = lang === "sk";
  const t = (a, b) => (sk ? a : b);
  const amount = ((inv.amount_paid ?? inv.total ?? 0) / 100).toFixed(2);
  const currency = String(inv.currency || "eur").toUpperCase();
  const number = inv.number || inv.id || "";
  const period = inv.status_transitions?.paid_at
    ? new Date(inv.status_transitions.paid_at * 1000).toLocaleDateString(sk ? "sk-SK" : "en-GB")
    : "";

  const rows = [
    [t("Číslo faktúry", "Invoice number"), escHtml(number)],
    [t("Suma", "Amount"), `${amount} ${currency}`],
    period ? [t("Dátum úhrady", "Paid on"), period] : null,
  ].filter(Boolean);

  const inner = `
    <div style="${S.eyebrow}">${t("Faktúra", "Invoice")}</div>
    <div style="${S.h1}">${t("Ďakujeme za platbu", "Thank you for your payment")}</div>
    <p style="${S.p}">${t(
      "Nižšie je vaša faktúra za predplatné Residata. Je to daňový doklad — stiahnite si ju pre svoje účtovníctvo.",
      "Below is your invoice for the Residata subscription. It is a tax document — download it for your records.",
    )}</p>
    ${rows.map(([k, v]) => `<div style="${S.row}"><span style="${S.rowLabel}">${k}</span><span style="color:${TEXT_HI}">${v}</span></div>`).join("")}
    ${inv.hosted_invoice_url ? `<p style="${S.p}"><a href="${inv.hosted_invoice_url}" style="${S.btnGreen}">${t("Otvoriť faktúru", "View invoice")}</a></p>` : ""}
    ${inv.invoice_pdf ? `<p style="${S.p}"><a href="${inv.invoice_pdf}" style="color:${GREEN}">${t("Stiahnuť PDF", "Download PDF")}</a></p>` : ""}
    <p style="${S.p}">${t(
      "Predplatné sa obnovuje automaticky; zrušiť ho môžete kedykoľvek v sekcii fakturácie.",
      "The subscription renews automatically; you can cancel any time in the billing section.",
    )}</p>
  `;

  return shell({
    lang,
    title: t("Faktúra od Residata", "Invoice from Residata"),
    preheader: t(`Faktúra ${number} · ${amount} ${currency}`, `Invoice ${number} · ${amount} ${currency}`),
    inner,
    footer: t("Residata · doklad k vášmu predplatnému", "Residata · receipt for your subscription"),
  });
}
