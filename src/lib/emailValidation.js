/**
 * PERSONAL E-MAIL PROVIDERS — refused at sign-up (Boss: only work e-mails sign up;
 * a person on gmail, yahoo, … gets in only when an admin adds them in admin →
 * Users, which puts that one address on the exemption list).
 *
 * Two parts, and the database has the SAME two (public.is_personal_email, see
 * supabase_migration_2026_10_personal_email_domains.sql — emailValidation.test.mjs
 * fails if the two ever differ):
 *   · PERSONAL_DOMAINS — exact domains: free mailboxes, consumer ISP mail
 *     (Slovak, Czech and the big foreign ones), privacy relays and throwaway
 *     inboxes;
 *   · PERSONAL_BRANDS — providers with a domain in many countries (yahoo.co.uk,
 *     hotmail.de, outlook.sk, gmx.at …): the brand followed by nothing but a
 *     public ending (com / sk / co.uk / com.br …). user@yahoo.cz is refused,
 *     user@yahoo-partners.com is not.
 *
 * The DATABASE decides (a trigger refuses the account); this copy only lets the
 * form answer while the person types. The form also asks the server for every
 * address before sending a code, so a gap here can never let anyone through.
 */
export const PERSONAL_DOMAINS = new Set([
  // Global free mailboxes
  "me.com", "mac.com", "aim.com", "msn.com", "passport.com",
  "mail.com", "email.com", "usa.com", "post.com", "inbox.com", "lycos.com",
  "fastmail.com", "fastmail.fm", "hey.com", "proton.me", "pm.me",
  "tuta.io", "tutamail.com", "keemail.me", "zoho.com",
  "runbox.com", "posteo.de", "posteo.net", "mailbox.org", "disroot.org", "riseup.net",
  "startmail.com", "countermail.com", "mail2world.com",
  // Privacy relays (a hidden personal address)
  "duck.com", "mozmail.com", "privaterelay.appleid.com", "simplelogin.com", "simplelogin.co",
  "aleeas.com", "anonaddy.com", "anonaddy.me", "33mail.com",
  // Slovakia
  "azet.sk", "centrum.sk", "zoznam.sk", "atlas.sk", "post.sk", "pobox.sk", "szm.sk",
  "stonline.sk", "orangemail.sk", "chello.sk", "nextra.sk", "inmail.sk",
  // Czechia
  "seznam.cz", "email.cz", "post.cz", "centrum.cz", "atlas.cz", "volny.cz", "tiscali.cz",
  "quick.cz", "iol.cz", "mybox.cz", "chello.cz", "upcmail.cz", "cbox.cz",
  // Germany, Austria, Switzerland, Poland, Italy, France, Benelux
  "web.de", "t-online.de", "freenet.de", "arcor.de", "bluewin.ch",
  "wp.pl", "o2.pl", "onet.pl", "interia.pl", "op.pl",
  "libero.it", "virgilio.it", "tiscali.it",
  "laposte.net", "orange.fr", "free.fr", "sfr.fr", "wanadoo.fr",
  "telenet.be", "skynet.be", "ziggo.nl", "kpnmail.nl", "home.nl", "planet.nl", "chello.nl", "xs4all.nl",
  // UK, North America, Australia
  "btinternet.com", "sky.com", "virginmedia.com", "ntlworld.com", "talktalk.net",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "bellsouth.net", "cox.net",
  "charter.net", "earthlink.net", "juno.com", "shaw.ca", "rogers.com", "sympatico.ca",
  "bigpond.com", "optusnet.com.au",
  // Russia, Asia
  "ya.ru", "mail.ru", "bk.ru", "inbox.ru", "list.ru", "rambler.ru",
  "qq.com", "163.com", "126.com", "sina.com", "naver.com", "hanmail.net", "daum.net",
  // Throwaway inboxes
  "10minutemail.com", "10minutemail.net", "sharklasers.com", "grr.la", "guerrillamailblock.com",
  "tempmail.com", "tempmail.net", "temp-mail.org", "temp-mail.io", "tempmailo.com", "tempr.email",
  "trashmail.com", "trashmail.de", "getnada.com", "maildrop.cc", "dispostable.com",
  "throwawaymail.com", "emailondeck.com", "mohmal.com", "fakeinbox.com", "mintemail.com",
  "spamgourmet.com", "mailnesia.com", "discard.email", "burnermail.io", "mailcatch.com",
  "mytemp.email", "moakt.com", "getairmail.com", "inboxkitten.com", "mailpoof.com", "emailfake.com",
]);

/** Providers with a mailbox domain in many countries — matched with any public ending. */
export const PERSONAL_BRANDS = [
  "gmail", "googlemail", "hotmail", "outlook", "live", "windowslive",
  "yahoo", "ymail", "rocketmail", "aol", "icloud", "gmx", "yandex",
  "protonmail", "tutanota", "zohomail", "hushmail", "rediffmail",
  "mailinator", "yopmail", "guerrillamail",
];
// brand + a public ending only: .com .net .org .sk … or .co.uk .com.br …
const BRAND_RE = new RegExp(`^(${PERSONAL_BRANDS.join("|")})\\.((com|net|org|[a-z]{2})|((co|com|net|org)\\.[a-z]{2}))$`);

/**
 * EXEMPTIONS LIVE IN THE DATABASE, not here.
 *
 * This file used to carry its own whitelist, which held exactly one address.
 * The moment Boss named three more, the form would have kept rejecting them
 * while the server let them through — the two lists had already drifted apart
 * on their first day. Exemptions are now rows in reference.signup_email_policy
 * and are read through `signupEmailAllowed()` below, so adding one is an UPDATE
 * rather than a deploy, and the form and the gate can never disagree.
 *
 * The domain list above stays local ON PURPOSE: it drives instant feedback as
 * the visitor types, with no round-trip. It is a mirror of
 * public.is_personal_email(); the authority is the BEFORE INSERT trigger on
 * auth.users, which uses the Postgres one.
 */
export function isPersonalEmail(email) {
  if (!email || !email.includes("@")) return false;
  const domain = email.split("@")[1].toLowerCase().trim();
  return PERSONAL_DOMAINS.has(domain) || BRAND_RE.test(domain);
}

/**
 * Ask the server whether this address may sign up — the ONLY authority (the
 * database's list, plus the addresses an admin let in).
 *
 * Three answers, because "no" and "could not ask" must not look the same:
 *   true  — allowed;
 *   false — a personal address that was not let in;
 *   null  — the check could not be made (offline, server error). The caller
 *           must not send a code and must not tell a business user their
 *           address is "personal" — it says "try again".
 */
export async function signupEmailAllowed(email) {
  if (!email || !email.includes("@")) return false;
  try {
    const { supabasePublic, isSupabaseReady } = await import("./supabase");
    if (!isSupabaseReady()) return null;
    const { data, error } = await supabasePublic.rpc("signup_email_allowed", { p_email: email.trim() });
    if (error || typeof data !== "boolean") return null;
    return data;
  } catch {
    return null;
  }
}

/** The refusal, in the visitor's language. */
export function personalEmailMessage(lang = "en") {
  return lang === "sk"
    ? "Prosím použi pracovný e-mail — osobné schránky (gmail, outlook, yahoo, azet, seznam …) neprijímame."
    : "Please use your work email — personal mailboxes (gmail, outlook, yahoo …) are not accepted.";
}

export function emailDomain(email) {
  if (!email || !email.includes("@")) return "";
  return email.split("@")[1].toLowerCase().trim();
}

/** Return null if valid, error message if not. */
export function validateBusinessEmail(email, lang = "en") {
  if (!email || !email.includes("@")) {
    return lang === "sk" ? "Zadaj platný email" : "Enter a valid email";
  }
  if (isPersonalEmail(email)) return personalEmailMessage(lang);
  return null;
}
