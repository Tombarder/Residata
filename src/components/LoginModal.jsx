import { useState, useEffect } from "react";
import { useAuth } from "../lib/useAuth";
import { getLiveT } from "../lib/liveLang";
import { validateBusinessEmail, signupEmailAllowed, personalEmailMessage } from "../lib/emailValidation";
import { track } from "../lib/track";
import { trialIntentAt } from "../lib/trial";
import { loginErrorMessage } from "../lib/loginErrors";
import { useBreakpointDown, BP } from "../lib/breakpoints";
import { useEscape } from "../lib/useDismiss";
import { dangerInk, orangeInk } from "../lib/theme";

// `onSignedIn` fires once a human has actually completed a login here, so the app
// can take them into the platform. Deliberately NOT inferred from "a user exists"
// higher up: that is also true on every page load with a stored session, and would
// yank a logged-in visitor off /pricing every time they refreshed it.
export default function LoginModal({ open, onClose, onSignedIn, lang = "en" }) {
  const t = getLiveT(lang);
  // Escape closes it, like every other layer in the app. An outside click already
  // does (the backdrop's own onClick) — useEscape deliberately does NOT add another
  // outside-click listener, so a click inside the form can never dismiss it.
  useEscape(open, onClose);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // The platform (analytics/maps/tables) is desktop-first; on a phone/tablet we
  // surface a heads-up in the login+register modal so expectations are set.
  const isSmallScreen = useBreakpointDown(BP.tablet);
  // Code-entry (prefetch-proof login): the email contains a one-time CODE, not
  // a clickable link. A magic link is a single-use token consumed by the first
  // GET, so email scanners / antivirus / browser prefetch burn it before the
  // user clicks (proven 2026-06-04). A typed code has no URL to prefetch.
  const [code, setCode] = useState("");
  const [busyVerify, setBusyVerify] = useState(false);
  const [verifyError, setVerifyError] = useState(null);
  const [busyResend, setBusyResend] = useState(false);
  const [resent, setResent] = useState(false);
  const { signIn, verifyCode } = useAuth();

  // The address as it will be sent: no stray spaces from a paste.
  const addr = email.trim();
  // Instant local verdict — no round-trip while typing. Only a first guess: the
  // DATABASE decides who may sign up (its list of personal providers plus the
  // addresses an admin let in), so every well-formed address is also put to the
  // server, and its answer wins either way.
  const localEmailError = addr ? validateBusinessEmail(addr, lang) : null;
  const wellFormed = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(addr);

  // `verdict` is the server's answer and the address it was for; an answer for
  // another address counts for nothing. Until the one on screen is answered a
  // locally-personal address shows a calm "checking" line rather than a red
  // refusal: a person the admin let in on a gmail address used to see "personal
  // providers are not accepted" for the moment the check took.
  const [verdict, setVerdict] = useState({ email: null, ok: null });   // ok: true | false | null = could not check
  useEffect(() => {
    if (!wellFormed) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const ok = await signupEmailAllowed(addr);
      if (!cancelled) setVerdict({ email: addr, ok });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [addr, wellFormed]);

  const checked = wellFormed && verdict.email === addr;
  const refused = checked && verdict.ok === false;
  const exempt = checked && verdict.ok === true && !!localEmailError;
  const unknown = checked && verdict.ok === null;     // offline / server error — submit asks again
  const pending = wellFormed && !!localEmailError && !checked;
  // Red only for a real refusal. A half-typed address is not an error — the
  // button simply waits (it used to say "Enter a valid email" from the first
  // keystroke).
  const emailError = refused ? personalEmailMessage(lang) : null;

  if (!open) return null;


  const submit = async (e) => {
    e.preventDefault();
    if (!wellFormed) { setError(lang === "sk" ? "Zadaj platný e-mail." : "Enter a valid email."); return; }
    setError(null); setBusy(true);
    // Always asked, whatever the form guessed: the database's list is the rule,
    // and a "no" here is cleaner than a code request the database then refuses
    // with a raw "Database error saving new user".
    const allowed = await signupEmailAllowed(addr);
    // Could not ask (null) about a WORK address → send the code anyway: the
    // database still refuses a sign-up it should, and a work address never
    // needed the answer — one hiccup of this check used to stop every sign-in.
    // A personal-looking address does need it (only the database knows whom the
    // admin let in), so for that one "could not check" stays an error.
    if (allowed === false || (allowed === null && localEmailError)) {
      setBusy(false);
      if (allowed === false) {
        setError(personalEmailMessage(lang));
        track("login_rejected_personal_email", { domain: addr.split("@")[1] });
      } else {
        setError(lang === "sk" ? "Nepodarilo sa overiť adresu — skontroluj pripojenie a skús to znova." : "Couldn't check the address — check your connection and try again.");
      }
      return;
    }
    track("login_code_requested", { domain: addr.split("@")[1] });
    const { error } = await signIn(addr, { lang, trialIntentAt: trialIntentAt() });
    setBusy(false);
    if (error) {
      setError(loginErrorMessage(error, lang, { address: addr }));
      track("login_code_request_error", { message: String(error.message || error).slice(0, 200) });
    } else {
      setSent(true);
    }
  };

  const verifySubmit = async (e) => {
    e.preventDefault();
    const clean = code.replace(/\D/g, "");
    if (!clean) return;
    setVerifyError(null); setBusyVerify(true);
    track("login_code_submitted", {});
    const { error } = await verifyCode(addr, clean);
    setBusyVerify(false);
    if (error) {
      setVerifyError(t.login_code_invalid);
      track("login_code_error", { message: String(error.message || error).slice(0, 120) });
    } else {
      track("login_code_success", {});
      // Auth context picks up SIGNED_IN and re-renders the app logged-in;
      // closing the modal hands off to the app's tier/profile gating.
      onClose();
      // …and then TAKE THEM TO THE PLATFORM. Closing the modal used to be the
      // whole of it, which left a brand-new user standing on the marketing page
      // they happened to sign up from — they had just been emailed a code,
      // typed it, and were rewarded with the same public homepage. (Boss,
      // 2026-08-19: "the link that i got after signing up linked me to the
      // 'live' view … should link me to the PLATFORM dashboard". The activity
      // trail agrees: login_code_success was logged at page_path "/".)
      //
      // App owns the navigation because only App can re-render the page —
      // pushRoute alone rewrites the URL and leaves the marketing page on
      // screen, which is worse than not moving at all.
      onSignedIn?.();
    }
  };

  // Says what the server said. It used to show "New code sent ✓" whatever
  // happened — a refused request (rate limit) then looked like a lost e-mail.
  const resend = async () => {
    setVerifyError(null); setResent(false); setBusyResend(true);
    setCode("");
    const { error } = await signIn(addr, { lang, trialIntentAt: trialIntentAt() });
    setBusyResend(false);
    if (error) {
      setVerifyError(loginErrorMessage(error, lang, { address: addr }));
      track("login_code_resend_error", { message: String(error.message || error).slice(0, 200) });
      return;
    }
    setResent(true);
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
      // align-items:flex-start + margin:auto on the child (below) centers the modal
      // when it fits but lets it scroll from the top when it's taller than the
      // viewport (short landscape phone, on-screen keyboard, or the extra small-
      // screen heads-up note). align-items:center would clip the top unreachably.
      display: "flex", alignItems: "flex-start", justifyContent: "center", zIndex: "var(--z-modal)",
      overflowY: "auto",
      padding: "max(1rem, var(--safe-top)) max(1rem, var(--safe-right)) max(1rem, var(--safe-bottom)) max(1rem, var(--safe-left))",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14,
        padding: "2rem", maxWidth: 420, width: "100%", position: "relative", margin: "auto 0",
      }}>
        <button onClick={onClose} style={{
          position: "absolute", top: "0.9rem", right: "1rem", background: "none", border: "none",
          color: "var(--text-dim)", fontSize: "1.25rem", cursor: "pointer", padding: 0,
        }}>×</button>

        {!sent ? (
          <>
            {isSmallScreen && (
              <div style={{
                display: "flex", gap: "0.6rem", alignItems: "flex-start",
                background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.3)",
                borderRadius: 8, padding: "0.75rem 0.85rem", marginBottom: "1.25rem",
                fontSize: "0.8rem", color: "#d8d8de", lineHeight: 1.55,
              }}>
                <span aria-hidden style={{ fontSize: "1rem", lineHeight: 1.4, flexShrink: 0 }}>💻</span>
                <span>
                  {lang === "sk" ? (
                    <><strong style={{ color: orangeInk, fontWeight: 700 }}>Najlepšie na počítači.</strong> Platforma Residata (analytika, mapy, dátové tabuľky) je navrhnutá pre desktop a na telefóne nebude vyzerať ani fungovať správne. Prihlásiť sa môžeš aj tu, no pre plný zážitok ju otvor na notebooku.</>
                  ) : (
                    <><strong style={{ color: orangeInk, fontWeight: 700 }}>Best on a computer.</strong> The Residata platform — analytics, maps and full data tables — is built for desktop and won't look or work well on a phone. You can still sign in here, but open it on a laptop for the full experience.</>
                  )}
                </span>
              </div>
            )}
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "var(--accent)", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>{t.login_label}</div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "0.5rem" }}>{t.login_title}</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-dim)", lineHeight: 1.6, marginBottom: "1.25rem" }}>
              {t.login_desc}
            </p>
            <form onSubmit={submit}>
              <input
                type="email" required autoFocus
                value={email} onChange={e => { setEmail(e.target.value); setError(null); }}
                aria-label={t.login_placeholder}
                placeholder={t.login_placeholder}
                style={{
                  width: "100%", padding: "0.75rem 1rem", background: "var(--surface-2)",
                  border: `1px solid ${emailError ? "#ff6b6b" : "var(--border)"}`, borderRadius: 8, color: "var(--text)",
                  fontSize: "0.95rem", fontFamily: "inherit", marginBottom: "0.25rem",
                  boxSizing: "border-box", outline: "none",
                }}
              />
              <div style={{ fontSize: "0.7rem", color: emailError ? dangerInk : "var(--text-faint)", marginBottom: "0.75rem", minHeight: "1rem" }}>
                {emailError || (pending ? (lang === "sk" ? "Overujem adresu…" : "Checking the address…")
                  // A personal address that IS let in (an admin made the account)
                  // must not read "work email required" under it.
                  : exempt ? (lang === "sk" ? "Na túto adresu ti pošleme kód." : "We'll send the code to this address.")
                  : unknown && localEmailError ? (lang === "sk" ? "Adresu sa nepodarilo overiť — skús to znova." : "Couldn't check the address — try again.")
                  : t.login_biz_email_hint)}
              </div>
              {error && <div style={{ color: dangerInk, fontSize: "0.8rem", marginBottom: "0.75rem" }}>{error}</div>}
              <button type="submit" disabled={busy || !wellFormed || !!emailError || pending} style={{
                width: "100%", padding: "0.75rem", background: "var(--accent)", color: "var(--bg)",
                fontWeight: 600, borderRadius: 8, border: "none",
                cursor: (busy || !wellFormed || emailError || pending) ? "not-allowed" : "pointer",
                fontSize: "0.9rem", opacity: (busy || !wellFormed || emailError || pending) ? 0.4 : 1,
              }}>{busy ? t.login_sending : t.login_send}</button>
            </form>
            <p style={{ fontSize: "0.7rem", color: "var(--text-faint)", marginTop: "1rem", textAlign: "center", lineHeight: 1.55 }}>
              {lang === "sk" ? "Prihlásením súhlasíš s " : "By signing in you agree to our "}
              <a href="/terms" style={{ color: "var(--text-dim)", textDecoration: "underline" }}>{lang === "sk" ? "obchodnými podmienkami" : "Terms of Service"}</a>
              {lang === "sk" ? " a " : " and "}
              <a href="/privacy" style={{ color: "var(--text-dim)", textDecoration: "underline" }}>{lang === "sk" ? "ochranou osobných údajov" : "Privacy Policy"}</a>
              {lang === "sk" ? ". Free verzia zahŕňa plný prístup k 1 projektu." : ". Free tier includes access to 1 full project snapshot."}
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: "2rem", textAlign: "center", marginBottom: "0.5rem" }}>🔑</div>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, textAlign: "center", marginBottom: "0.5rem" }}>{t.login_check_title}</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-dim)", textAlign: "center", lineHeight: 1.6, marginBottom: "0.25rem" }}>
              {t.login_check_body_prefix} <strong style={{ color: "var(--text)" }}>{addr}</strong>{t.login_check_body_suffix}
            </p>
            <p style={{ fontSize: "0.7rem", color: "var(--text-faint)", textAlign: "center", marginBottom: "1rem" }}>
              {t.login_code_hint}
            </p>
            <form onSubmit={verifySubmit}>
              <input
                type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus
                value={code}
                onChange={e => { setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 10)); setVerifyError(null); }}
                aria-label={t.login_code_placeholder}
                placeholder={t.login_code_placeholder}
                style={{
                  width: "100%", padding: "0.85rem 1rem", background: "var(--surface-2)",
                  border: `1px solid ${verifyError ? "#ff6b6b" : "var(--border)"}`, borderRadius: 8, color: "var(--text)",
                  fontSize: "1.5rem", fontFamily: "'JetBrains Mono', monospace", textAlign: "center",
                  letterSpacing: "0.4em", marginBottom: "0.5rem", boxSizing: "border-box", outline: "none",
                }}
              />
              {verifyError && <div style={{ color: dangerInk, fontSize: "0.8rem", marginBottom: "0.6rem", textAlign: "center" }}>{verifyError}</div>}
              <button type="submit" disabled={busyVerify || !code} style={{
                width: "100%", padding: "0.75rem", background: "var(--accent)", color: "var(--bg)",
                fontWeight: 600, borderRadius: 8, border: "none",
                cursor: (busyVerify || !code) ? "not-allowed" : "pointer",
                fontSize: "0.9rem", opacity: (busyVerify || !code) ? 0.4 : 1,
              }}>{busyVerify ? t.login_verifying : t.login_verify}</button>
            </form>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
              <button onClick={resend} disabled={busyResend} style={{
                background: "none", border: "none", color: resent ? "var(--accent)" : "var(--text-dim)",
                fontSize: "0.78rem", cursor: busyResend ? "default" : "pointer", padding: 0,
                fontFamily: "inherit",
              }}>{resent ? t.login_resent : t.login_resend}</button>
              {/* A mistyped address used to be a dead end: the code step kept
                  it through close and reopen, and "send a new code" went to the
                  same wrong address — only a page reload got out. */}
              <button type="button" onClick={() => { setSent(false); setCode(""); setVerifyError(null); setResent(false); setError(null); }} style={{
                background: "none", border: "none", color: "var(--text-dim)",
                fontSize: "0.78rem", cursor: "pointer", padding: 0, fontFamily: "inherit",
              }}>{lang === "sk" ? "Iný e-mail" : "Different e-mail"}</button>
              <button onClick={onClose} style={{
                background: "none", border: "none", color: "var(--text-faint)",
                fontSize: "0.78rem", cursor: "pointer", padding: 0, fontFamily: "inherit",
              }}>{t.login_close}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
