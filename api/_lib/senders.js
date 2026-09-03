/**
 * WHO AN EMAIL COMES FROM — the single place that decides.
 *
 * residata.eu has three mailboxes and Boss gave each exactly one job
 * (2026-09-03):
 *
 *   noreply@  machine mail nobody is expected to answer — welcome, password
 *             resets, monthly reports, invoices. It IS a real mailbox that
 *             copies to his Gmail, so a reply sent to it anyway is not lost.
 *   info@     anything a person may legitimately reply to, plus the legal,
 *             GDPR and security contact.
 *   tomas@    him personally — his contact card and sales. NEVER a machine
 *             sender, which is why it does not appear in this file at all.
 *
 * A caller never names an address. It declares what KIND of message it is
 * sending, and this module maps that to a sender. Two reasons:
 *
 *   1. A new email cannot invent a fourth sender by typo.
 *   2. Choosing wrongly becomes visible in a diff (`conversational: true`)
 *      instead of invisible in a dashboard.
 *
 * This module deliberately has NO imports. `emails.js` pulls in nodemailer,
 * which makes it awkward to unit-test; the policy that actually matters lives
 * here so it can be tested directly. See src/lib/emailSenders.test.mjs.
 *
 * The env overrides exist only as an escape hatch. Nothing sets them:
 * MAIL_FROM was REMOVED from Vercel on purpose, because Vercel marks those
 * variables write-only — `vercel env pull` returns an empty string, so nobody,
 * including whoever set it, can read back which address the product sends as.
 * A constant you can read beats a dashboard value you cannot.
 */

export const DEFAULT_AUTOMATED_SENDER = "noreply@residata.eu";
export const DEFAULT_CONVERSATIONAL_SENDER = "info@residata.eu";

/**
 * Decide the From and Reply-To for one message.
 *
 * @param {object}  opts
 * @param {boolean} opts.conversational  true when a human is writing to a
 *                                       person who may reasonably reply.
 * @param {string}  [opts.replyTo]       explicit override; wins over both.
 * @param {object}  [opts.env]           injectable for tests.
 * @returns {{from: string, replyTo: string|undefined}}
 */
export function resolveSender({ conversational = false, replyTo, env = process.env } = {}) {
  const automated = env.MAIL_FROM || DEFAULT_AUTOMATED_SENDER;
  const human = env.MAIL_FROM_CONVERSATIONAL || DEFAULT_CONVERSATIONAL_SENDER;

  if (conversational) {
    // From is already a monitored mailbox, so a Reply-To would only add noise —
    // unless the caller named one deliberately (e.g. replying on behalf of a user).
    return { from: human, replyTo: replyTo || undefined };
  }
  // "noreply" is a convention, not a fact: people hit reply anyway. Point them at
  // the mailbox a person actually reads rather than letting the message vanish.
  return { from: automated, replyTo: replyTo || human };
}
