/**
 * Human words for the ways asking for a sign-in code can be refused.
 *
 * 🔴 2026-10-06: a new user said his verification code never came. The auth
 * settings capped sign-in e-mail at TWO per hour for the whole site (fixed; now
 * watched nightly by integrity_check auth_emails_reach_people), and the login
 * form's "Send a new code" answered "New code sent ✓" whatever the server said —
 * so a refused request looked exactly like a lost e-mail. A refusal is now said
 * as one, in the visitor's language, with what to do about it.
 *
 * Nothing raw reaches the screen: until 2026-10-06 any other refusal was shown
 * verbatim ("Database error saving new user", "Failed to fetch") to a Slovak
 * visitor at the very moment they were signing up.
 */
import { personalEmailMessage, validateBusinessEmail } from "./emailValidation.js";

/** `address`: the e-mail the code was asked for — decides what a database refusal means. */
export function loginErrorMessage(error, lang = "en", { address } = {}) {
  if (!error) return null;
  const sk = lang === "sk";
  const code = String(error.code || "");
  const msg = String(error.message || error || "");
  const wait = msg.match(/after (\d+) seconds?/i);
  if (wait) {
    return sk
      ? `Nový kód môžeš vyžiadať o ${wait[1]} s. Ten predchádzajúci ešte platí — skontroluj aj spam.`
      : `You can ask for a new code in ${wait[1]} s. The previous one is still valid — check spam too.`;
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit"
      || error.status === 429 || /rate limit/i.test(msg)) {
    return sk
      ? "Práve odchádza priveľa prihlasovacích kódov. Skús to o pár minút znova — ak to nepomôže, napíš nám na info@residata.eu."
      : "Too many sign-in codes are going out right now. Try again in a few minutes — if that doesn't help, write to info@residata.eu.";
  }
  // The database refusing a NEW account: its business-e-mail gate (a trigger on
  // auth.users) surfaces through Supabase as "Database error saving new user".
  // The form asks the same gate first, so this is only reached when the two
  // answers raced — but if it is, it says the rule, not the plumbing. Supabase
  // says the SAME words for ANY failing trigger, though, so for a work address
  // it is not the rule at all: that person gets the plain "try again / write to
  // us" below instead of being told their work address is a personal mailbox.
  if (/signup_requires_business_email/i.test(msg)
      || (/saving new user/i.test(msg) && !(address && !validateBusinessEmail(address, lang)))) {
    return personalEmailMessage(lang);
  }
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) {
    return sk
      ? "Nepodarilo sa spojiť so serverom — skontroluj pripojenie a skús to znova."
      : "Couldn't reach the server — check your connection and try again.";
  }
  // Anything else: a sentence the visitor can act on. The raw text (English,
  // technical) goes to the activity log by the caller, never onto the screen.
  return sk
    ? "Kód sa nepodarilo odoslať. Skús to znova o chvíľu — ak to nepomôže, napíš nám na info@residata.eu."
    : "The code could not be sent. Try again in a moment — if that doesn't help, write to info@residata.eu.";
}
