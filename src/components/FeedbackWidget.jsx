/**
 * FeedbackWidget — site-wide "Spätná väzba / Feedback" launcher + panel.
 *
 * Mounted ONCE at the app root (App.jsx), unconditionally, so it appears on
 * EVERY page: marketing site AND the /app platform. Fixed bottom-right.
 *
 * Placement: on marketing pages the AI chat pill also sits bottom-right, so we
 * accept a `raised` prop and float ABOVE it (raised → bottom:78). On platform
 * pages there's no chat pill, so it sits at bottom:20 alone.
 *
 * Flow: pick a category → write the message → (anon may add a contact email) →
 * POST /api/feedback/submit. Logged-in users are attributed server-side from
 * their token; we just attach it. Same dark Residata look as FloatingChat.
 */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/useAuth";
import { cleanText, cleanEmail } from "../lib/sanitize";

const mono   = "'JetBrains Mono', monospace";
const green  = "#00e5a0";
const dim    = "#8a8a96";
const text   = "#e8e8ed";
const border = "#222228";
const bg     = "#0a0a0b";
const bg2    = "#0e0e10";
const red    = "#ff6b6b";

const MAX_MESSAGE = 4000;

// key · emoji · SK label · EN label  (keys must match the DB CHECK + endpoint)
const CATEGORIES = [
  ["data",     "📊", "Kvalita dát",      "Data quality"],
  ["bug",      "🐞", "Chyba / nefunguje", "Bug / not working"],
  ["website",  "🖥️", "Web / zobrazenie",  "Website / display"],
  ["question", "❓", "Otázka",            "Question"],
  ["idea",     "💡", "Návrh / funkcia",   "Suggestion / feature"],
  ["other",    "💬", "Iné",               "Other"],
];

// Read the Supabase access token from localStorage (same approach as DataQA /
// LocationManager). Optional — anon submissions work without it; when present
// the server attributes the report to the real account.
function storedAccessToken() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("sb-") && k.includes("-auth-token")) {
        const v = JSON.parse(localStorage.getItem(k));
        const tok = v?.access_token || v?.currentSession?.access_token || (Array.isArray(v) ? v[0] : null);
        if (tok) return tok;
      }
    }
  } catch { /* ignore */ }
  return null;
}

export default function FeedbackWidget({ lang = "sk", raised = false }) {
  const L = (sk, en) => (lang === "sk" ? sk : en);
  const { user, profile } = useAuth();

  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [phase, setPhase] = useState("idle"); // idle | sending | done | error
  const [errorMsg, setErrorMsg] = useState("");
  const taRef = useRef(null);

  const accountEmail = user?.email || profile?.email || null;
  const bottom = raised ? 78 : 20;

  useEffect(() => {
    if (open && phase === "idle") {
      const t = setTimeout(() => taRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open, phase]);

  function resetForm() {
    setCategory(null); setMessage(""); setEmail("");
    setPhase("idle"); setErrorMsg("");
  }
  function close() {
    setOpen(false);
    // Reset only after a successful send, so an accidental close mid-typing
    // doesn't wipe the draft.
    if (phase === "done") resetForm();
  }

  const canSend = !!category && cleanText(message, { max: MAX_MESSAGE }).length >= 2 && phase !== "sending";

  async function submit() {
    if (!canSend) return;
    setPhase("sending"); setErrorMsg("");
    const token = storedAccessToken();
    const payload = {
      category,
      message: cleanText(message, { max: MAX_MESSAGE }),
      page_path: typeof window !== "undefined" ? window.location.pathname : null,
      page_url: typeof window !== "undefined" ? window.location.href : null,
      app_lang: lang === "sk" ? "sk" : "en",
    };
    // Only attach a contact email for anon users (logged-in is resolved server-side).
    if (!accountEmail) {
      const e = cleanEmail(email);
      if (e) payload.email = e;
    }
    try {
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch("/api/feedback/submit", {
        method: "POST", headers, body: JSON.stringify(payload),
      });
      if (r.status === 429) {
        setPhase("error");
        setErrorMsg(L("Priveľa správ za chvíľu — skús o minútu.", "Too many messages — try again in a minute."));
        return;
      }
      if (!r.ok) {
        setPhase("error");
        setErrorMsg(L("Nepodarilo sa odoslať. Skús to znova.", "Couldn't send. Please try again."));
        return;
      }
      setPhase("done");
    } catch {
      setPhase("error");
      setErrorMsg(L("Nepodarilo sa odoslať. Skús to znova.", "Couldn't send. Please try again."));
    }
  }

  // ── Launcher pill ──────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label={L("Nahlásiť problém alebo návrh", "Report a problem or suggestion")}
        className="residata-fb-pill"
        style={{
          position: "fixed", right: 20, bottom,
          height: 40, padding: "0 14px 0 12px", borderRadius: 20,
          border: `1px solid rgba(0,229,160,0.55)`, background: bg2, color: text,
          cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "0.5rem",
          fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 600, letterSpacing: "-0.005em",
          zIndex: 2000, animation: "rbf-glow 2.4s ease-in-out infinite",
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={green} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        <span>{L("Spätná väzba", "Feedback")}</span>
        <style>{`
          @keyframes rbf-glow {
            0%, 100% { box-shadow: 0 6px 18px rgba(0,0,0,0.4), 0 0 0 0 rgba(0,229,160,0); }
            50%      { box-shadow: 0 8px 22px rgba(0,0,0,0.45), 0 0 22px 3px rgba(0,229,160,0.45); }
          }
          .residata-fb-pill { transition: transform .18s, border-color .18s, background .18s; }
          .residata-fb-pill:hover {
            transform: translateY(-1px); border-color: ${green}; background: #121216; animation-play-state: paused;
            box-shadow: 0 10px 28px rgba(0,0,0,0.55), 0 0 28px 5px rgba(0,229,160,0.55), 0 0 0 1px rgba(0,229,160,0.3) inset;
          }
          @media (prefers-reduced-motion: reduce) {
            .residata-fb-pill { animation: none; box-shadow: 0 6px 18px rgba(0,0,0,0.4), 0 0 16px 2px rgba(0,229,160,0.35); }
          }
        `}</style>
      </button>
    );
  }

  // ── Panel ──────────────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", right: 20, bottom,
      width: "min(380px, calc(100vw - 32px))",
      maxHeight: "min(640px, calc(100vh - 40px))",
      background: bg2, border: `1px solid ${border}`, borderRadius: 14,
      boxShadow: "0 20px 60px rgba(0,0,0,0.65)",
      display: "flex", flexDirection: "column", zIndex: 2000,
      animation: "rbf-panel 0.2s ease-out",
    }}>
      <style>{`@keyframes rbf-panel { from {opacity:0; transform:translateY(12px);} to {opacity:1; transform:translateY(0);} }`}</style>

      {/* Header */}
      <div style={{
        padding: "0.7rem 0.85rem", display: "flex", alignItems: "center", gap: "0.5rem",
        borderBottom: `1px solid ${border}`,
        background: "linear-gradient(180deg, rgba(0,229,160,0.07), transparent)",
        borderTopLeftRadius: 14, borderTopRightRadius: 14,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: text, fontWeight: 700, fontSize: "0.88rem", letterSpacing: "-0.01em" }}>
            {L("Spätná väzba", "Feedback")}
          </div>
          <div style={{ color: dim, fontFamily: mono, fontSize: "0.6rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {L("problém · otázka · návrh", "problem · question · idea")}
          </div>
        </div>
        <button
          onClick={close} title={L("Zavrieť", "Close")} aria-label={L("Zavrieť", "Close")}
          style={{ background: "transparent", border: `1px solid ${border}`, color: dim, borderRadius: 6, cursor: "pointer", padding: "0.3rem 0.55rem", fontSize: "0.75rem", fontFamily: mono, lineHeight: 1 }}
          onMouseEnter={e => { e.currentTarget.style.color = red; }}
          onMouseLeave={e => { e.currentTarget.style.color = dim; }}
        >✕</button>
      </div>

      {/* Body */}
      <div style={{ padding: "0.85rem", overflowY: "auto" }}>
        {phase === "done" ? (
          <div style={{ textAlign: "center", padding: "1.4rem 0.5rem" }}>
            <div style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>✅</div>
            <div style={{ color: text, fontWeight: 600, fontSize: "0.95rem", marginBottom: "0.35rem" }}>
              {L("Ďakujeme!", "Thank you!")}
            </div>
            <div style={{ color: dim, fontSize: "0.82rem", lineHeight: 1.5, marginBottom: "1rem" }}>
              {L("Dostali sme to a pozrieme sa na to. Ak treba, ozveme sa.",
                 "We've got it and will take a look. We'll reach out if needed.")}
            </div>
            <button onClick={resetForm}
              style={{ background: "transparent", border: `1px solid ${border}`, color: text, borderRadius: 8, padding: "0.5rem 0.9rem", cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}>
              {L("Poslať ďalšiu", "Send another")}
            </button>
          </div>
        ) : (
          <>
            {/* Friendly intro — what we'd love to hear from them */}
            <div style={{ color: "#cdd0d6", fontSize: "0.84rem", lineHeight: 1.55, marginBottom: "0.95rem" }}>
              {L(
                "Daj nám vedieť čokoľvek — ak niečo nefunguje, ak vieš o aktívnej novostavbe, ktorá nám chýba, alebo máš otázku či nápad na novú funkciu, ktorú by si uvítal. Tie najlepšie veľmi radi pridáme. 🙌",
                "Tell us anything — if something's not working, if you know an active new-build we're missing, or if you have a question or a feature you'd love to see. We're always glad to add the best ones. 🙌"
              )}
            </div>
            {/* Category */}
            <div style={{ color: dim, fontFamily: mono, fontSize: "0.62rem", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.45rem" }}>
              {L("Typ", "Type")}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.85rem" }}>
              {CATEGORIES.map(([key, emoji, sk, en]) => {
                const on = category === key;
                return (
                  <button key={key} onClick={() => setCategory(key)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.3rem",
                      padding: "0.4rem 0.6rem", borderRadius: 8, cursor: "pointer",
                      border: `1px solid ${on ? green : border}`,
                      background: on ? "rgba(0,229,160,0.1)" : "transparent",
                      color: on ? green : "#c4c4cc", fontFamily: "inherit", fontSize: "0.76rem",
                    }}>
                    <span aria-hidden="true">{emoji}</span>{L(sk, en)}
                  </button>
                );
              })}
            </div>

            {/* Message */}
            <div style={{ color: dim, fontFamily: mono, fontSize: "0.62rem", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "0.45rem" }}>
              {L("Správa", "Message")}
            </div>
            <textarea
              ref={taRef}
              value={message}
              onChange={e => setMessage(e.target.value.slice(0, MAX_MESSAGE))}
              placeholder={L("Tvoja správa…", "Your message…")}
              rows={4}
              style={{
                width: "100%", boxSizing: "border-box", minHeight: 96, maxHeight: 220,
                background: bg, border: `1px solid ${border}`, borderRadius: 8, color: text,
                fontFamily: "inherit", fontSize: "0.85rem", lineHeight: 1.5,
                padding: "0.55rem 0.65rem", resize: "vertical", outline: "none",
              }}
            />

            {/* Optional email — only for anon (logged-in is known server-side) */}
            {!accountEmail && (
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                type="email"
                placeholder={L("E-mail (nepovinné, ak chceš odpoveď)", "Email (optional, if you want a reply)")}
                style={{
                  width: "100%", boxSizing: "border-box", marginTop: "0.55rem",
                  background: bg, border: `1px solid ${border}`, borderRadius: 8, color: text,
                  fontFamily: "inherit", fontSize: "0.82rem", padding: "0.5rem 0.65rem", outline: "none",
                }}
              />
            )}

            {phase === "error" && (
              <div style={{ marginTop: "0.6rem", color: red, fontSize: "0.78rem", fontFamily: mono }}>
                ⚠ {errorMsg}
              </div>
            )}

            <button
              onClick={submit}
              disabled={!canSend}
              style={{
                marginTop: "0.85rem", width: "100%",
                background: canSend ? green : "#2a2a30",
                color: canSend ? "#0a0a0c" : dim,
                border: "none", borderRadius: 8, padding: "0.6rem 0.8rem",
                fontWeight: 700, fontFamily: mono, fontSize: "0.8rem",
                cursor: canSend ? "pointer" : "not-allowed",
              }}>
              {phase === "sending" ? L("Odosielam…", "Sending…") : L("Odoslať", "Send")}
            </button>

            <div style={{ marginTop: "0.55rem", color: dim, fontSize: "0.62rem", fontFamily: mono, textAlign: "center", lineHeight: 1.5 }}>
              {accountEmail
                ? L(`Odosielaš ako ${accountEmail}`, `Sending as ${accountEmail}`)
                : L("Anonymné, ak nevyplníš e-mail", "Anonymous unless you add an email")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
