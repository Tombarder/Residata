import { useState } from "react";
import { useAuth } from "../lib/useAuth";
import { liveT } from "../lib/liveLang";
import { validateBusinessEmail } from "../lib/emailValidation";
import { track } from "../lib/track";

export default function LoginModal({ open, onClose, lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
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

  if (!open) return null;

  const emailError = email ? validateBusinessEmail(email, lang) : null;

  const submit = async (e) => {
    e.preventDefault();
    const err = validateBusinessEmail(email, lang);
    if (err) {
      setError(err);
      track("login_rejected_personal_email", { domain: email.split("@")[1] });
      return;
    }
    setError(null); setBusy(true);
    track("login_code_requested", { domain: email.split("@")[1] });
    const { error } = await signIn(email);
    setBusy(false);
    if (error) {
      setError(error.message || String(error));
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
    const { error } = await verifyCode(email, clean);
    setBusyVerify(false);
    if (error) {
      setVerifyError(t.login_code_invalid);
      track("login_code_error", { message: String(error.message || error).slice(0, 120) });
    } else {
      track("login_code_success", {});
      // Auth context picks up SIGNED_IN and re-renders the app logged-in;
      // closing the modal hands off to the app's tier/profile gating.
      onClose();
    }
  };

  const resend = async () => {
    setVerifyError(null); setResent(false); setBusyResend(true);
    setCode("");
    await signIn(email);
    setBusyResend(false);
    setResent(true);
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#16161a", border: "1px solid #222228", borderRadius: 14,
        padding: "2rem", maxWidth: 420, width: "100%", position: "relative",
      }}>
        <button onClick={onClose} style={{
          position: "absolute", top: "0.9rem", right: "1rem", background: "none", border: "none",
          color: "#8a8a96", fontSize: "1.25rem", cursor: "pointer", padding: 0,
        }}>×</button>

        {!sent ? (
          <>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.65rem", color: "#00e5a0", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "0.75rem" }}>{t.login_label}</div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "0.5rem" }}>{t.login_title}</h2>
            <p style={{ fontSize: "0.85rem", color: "#8a8a96", lineHeight: 1.6, marginBottom: "1.25rem" }}>
              {t.login_desc}
            </p>
            <form onSubmit={submit}>
              <input
                type="email" required autoFocus
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder={t.login_placeholder}
                style={{
                  width: "100%", padding: "0.75rem 1rem", background: "#0e0e10",
                  border: `1px solid ${emailError ? "#ff6b6b" : "#222228"}`, borderRadius: 8, color: "#e8e8ed",
                  fontSize: "0.95rem", fontFamily: "inherit", marginBottom: "0.25rem",
                  boxSizing: "border-box", outline: "none",
                }}
              />
              <div style={{ fontSize: "0.7rem", color: emailError ? "#ff6b6b" : "#55555f", marginBottom: "0.75rem", minHeight: "1rem" }}>
                {emailError || t.login_biz_email_hint}
              </div>
              {error && <div style={{ color: "#ff6b6b", fontSize: "0.8rem", marginBottom: "0.75rem" }}>{error}</div>}
              <button type="submit" disabled={busy || !email || !!emailError} style={{
                width: "100%", padding: "0.75rem", background: "#00e5a0", color: "#0a0a0b",
                fontWeight: 600, borderRadius: 8, border: "none",
                cursor: (busy || emailError) ? "not-allowed" : "pointer",
                fontSize: "0.9rem", opacity: (busy || emailError) ? 0.4 : 1,
              }}>{busy ? t.login_sending : t.login_send}</button>
            </form>
            <p style={{ fontSize: "0.7rem", color: "#55555f", marginTop: "1rem", textAlign: "center" }}>
              {t.login_terms}
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: "2rem", textAlign: "center", marginBottom: "0.5rem" }}>🔑</div>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, textAlign: "center", marginBottom: "0.5rem" }}>{t.login_check_title}</h2>
            <p style={{ fontSize: "0.85rem", color: "#8a8a96", textAlign: "center", lineHeight: 1.6, marginBottom: "0.25rem" }}>
              {t.login_check_body_prefix} <strong style={{ color: "#e8e8ed" }}>{email}</strong>{t.login_check_body_suffix}
            </p>
            <p style={{ fontSize: "0.7rem", color: "#55555f", textAlign: "center", marginBottom: "1rem" }}>
              {t.login_code_hint}
            </p>
            <form onSubmit={verifySubmit}>
              <input
                type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus
                value={code}
                onChange={e => { setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 10)); setVerifyError(null); }}
                placeholder={t.login_code_placeholder}
                style={{
                  width: "100%", padding: "0.85rem 1rem", background: "#0e0e10",
                  border: `1px solid ${verifyError ? "#ff6b6b" : "#222228"}`, borderRadius: 8, color: "#e8e8ed",
                  fontSize: "1.5rem", fontFamily: "'JetBrains Mono', monospace", textAlign: "center",
                  letterSpacing: "0.4em", marginBottom: "0.5rem", boxSizing: "border-box", outline: "none",
                }}
              />
              {verifyError && <div style={{ color: "#ff6b6b", fontSize: "0.8rem", marginBottom: "0.6rem", textAlign: "center" }}>{verifyError}</div>}
              <button type="submit" disabled={busyVerify || !code} style={{
                width: "100%", padding: "0.75rem", background: "#00e5a0", color: "#0a0a0b",
                fontWeight: 600, borderRadius: 8, border: "none",
                cursor: (busyVerify || !code) ? "not-allowed" : "pointer",
                fontSize: "0.9rem", opacity: (busyVerify || !code) ? 0.4 : 1,
              }}>{busyVerify ? t.login_verifying : t.login_verify}</button>
            </form>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
              <button onClick={resend} disabled={busyResend} style={{
                background: "none", border: "none", color: resent ? "#00e5a0" : "#8a8a96",
                fontSize: "0.78rem", cursor: busyResend ? "default" : "pointer", padding: 0,
                fontFamily: "inherit",
              }}>{resent ? t.login_resent : t.login_resend}</button>
              <button onClick={onClose} style={{
                background: "none", border: "none", color: "#55555f",
                fontSize: "0.78rem", cursor: "pointer", padding: 0, fontFamily: "inherit",
              }}>{t.login_close}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
