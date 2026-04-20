import { useState } from "react";
import { useAuth } from "../lib/useAuth";
import { liveT } from "../lib/liveLang";

export default function LoginModal({ open, onClose, lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { signIn } = useAuth();

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setBusy(true);
    const { error } = await signIn(email);
    setBusy(false);
    if (error) setError(error.message || String(error));
    else setSent(true);
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
                  border: "1px solid #222228", borderRadius: 8, color: "#e8e8ed",
                  fontSize: "0.95rem", fontFamily: "inherit", marginBottom: "0.75rem",
                  boxSizing: "border-box",
                }}
              />
              {error && <div style={{ color: "#ff6b6b", fontSize: "0.8rem", marginBottom: "0.75rem" }}>{error}</div>}
              <button type="submit" disabled={busy || !email} style={{
                width: "100%", padding: "0.75rem", background: "#00e5a0", color: "#0a0a0b",
                fontWeight: 600, borderRadius: 8, border: "none", cursor: busy ? "wait" : "pointer",
                fontSize: "0.9rem", opacity: busy ? 0.6 : 1,
              }}>{busy ? t.login_sending : t.login_send}</button>
            </form>
            <p style={{ fontSize: "0.7rem", color: "#55555f", marginTop: "1rem", textAlign: "center" }}>
              {t.login_terms}
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: "2rem", textAlign: "center", marginBottom: "0.5rem" }}>✉️</div>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, textAlign: "center", marginBottom: "0.75rem" }}>{t.login_check_title}</h2>
            <p style={{ fontSize: "0.85rem", color: "#8a8a96", textAlign: "center", lineHeight: 1.6 }}>
              {t.login_check_body_prefix} <strong style={{ color: "#e8e8ed" }}>{email}</strong>{t.login_check_body_suffix}
            </p>
            <button onClick={onClose} style={{
              width: "100%", padding: "0.75rem", background: "transparent", color: "#e8e8ed",
              fontWeight: 500, borderRadius: 8, border: "1px solid #222228", cursor: "pointer",
              fontSize: "0.9rem", marginTop: "1.25rem",
            }}>{t.login_close}</button>
          </>
        )}
      </div>
    </div>
  );
}
