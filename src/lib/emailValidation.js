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
 * Whitelist — these personal emails bypass the business-only check.
 * Keep this list minimal. Intended for founders/admins who legitimately
 * need access through a personal account.
 */
const EMAIL_WHITELIST = new Set([
  "tkamhal@gmail.com",
]);

export function isWhitelistedEmail(email) {
  if (!email) return false;
  return EMAIL_WHITELIST.has(email.toLowerCase().trim());
}

export function isPersonalEmail(email) {
  if (!email || !email.includes("@")) return false;
  if (isWhitelistedEmail(email)) return false;
  const domain = email.split("@")[1].toLowerCase().trim();
  return PERSONAL_DOMAINS.has(domain);
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
