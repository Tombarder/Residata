/**
 * Human words for the ways asking for a sign-in code can be refused.
 *
 * 🔴 2026-10-06: a new user said his verification code never came. The auth
 * settings capped sign-in e-mail at TWO per hour for the whole site (fixed; now
 * watched nightly by integrity_check auth_emails_reach_people), and the login
 * form's "Send a new code" answered "New code sent ✓" whatever the server said —
 * so a refused request looked exactly like a lost e-mail. A refusal is now said
 * as one, in the visitor's language, with what to do about it.
 */
export function loginErrorMessage(error, lang = "en") {
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
  return msg || (sk ? "Kód sa nepodarilo odoslať." : "The code could not be sent.");
}
