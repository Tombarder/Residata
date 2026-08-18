/**
 * Block personal/free email providers — force business emails only for signup.
 * Same list as public.is_personal_email() in Postgres (keep in sync).
 */
const PERSONAL_DOMAINS = new Set([
  // Google
  "gmail.com", "googlemail.com",
  // Microsoft
  "outlook.com", "hotmail.com", "live.com", "msn.com", "live.sk", "hotmail.sk",
  // Yahoo
  "yahoo.com", "yahoo.sk", "ymail.com", "yahoo.co.uk",
  // Apple
  "icloud.com", "me.com", "mac.com",
  // Proton
  "protonmail.com", "proton.me", "pm.me",
  // Slovak / Czech
  "seznam.cz", "email.cz", "centrum.sk", "centrum.cz", "zoznam.sk",
  "azet.sk", "atlas.sk", "post.sk", "pobox.sk", "szm.sk",
  // Generic
  "aol.com", "mail.com", "gmx.com", "gmx.net", "gmx.de", "inbox.com",
  "fastmail.com", "tutanota.com", "tuta.io", "zoho.com", "mailbox.org",
  "yandex.com", "yandex.ru", "rambler.ru",
  // Temporary / disposable
  "mailinator.com", "tempmail.com", "10minutemail.com", "guerrillamail.com",
]);

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
  return PERSONAL_DOMAINS.has(domain);
}

/**
 * Ask the server whether this address may register — the single source of truth
 * for exemptions. Only worth calling when the local rule would block: that is
 * the only case an exemption can change.
 *
 * Fails CLOSED: if the check cannot be reached we keep the local verdict, so a
 * network blip can never quietly open sign-up to every consumer domain.
 */
export async function signupEmailAllowed(email) {
  if (!email || !email.includes("@")) return false;
  try {
    const { supabasePublic, isSupabaseReady } = await import("./supabase");
    if (!isSupabaseReady()) return false;
    const { data, error } = await supabasePublic.rpc("signup_email_allowed", { p_email: email });
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
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
  if (isPersonalEmail(email)) {
    return lang === "sk"
      ? "Prosím použi pracovný/business email (nie gmail, outlook a pod.)"
      : "Please use your work email (personal providers like gmail/outlook are not accepted)";
  }
  return null;
}
