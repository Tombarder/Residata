/**
 * ChatAssistant — grounded market-data chatbot for the /app/ask page.
 *
 * Stateless from the server's perspective: the whole conversation
 * history is sent on every POST. The server assembles a tier-
 * appropriate data context and calls Claude (see /api/ai/chat.js).
 *
 * Tier behaviour (enforced server-side, NOT client):
 *   · anon   — 3 questions/day, market totals only
 *   · free   — 10 questions/day, market + user's one chosen project
 *   · paid   — 30 questions/day, full market data
 *   · admin  — 100 questions/day, everything
 *
 * Conversation persistence: messages live in localStorage keyed by
 * user_id (or 'anon'). Survives tab close and page refresh. Doesn't
 * sync across devices — that would need a server table we haven't
 * built yet, and for v1 per-device history is fine.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/useAuth";
import { useCapabilities } from "../lib/useCapabilities";
import { track } from "../lib/track";

const mono   = "'JetBrains Mono', monospace";
const green  = "#00e5a0";
const dim    = "#8a8a96";
const text   = "#e8e8ed";
const border = "#222228";
const bg     = "#0a0a0b";
const bg2    = "#0e0e10";
const orange = "#f5a623";
const red    = "#ff6b6b";

function storageKey(userId) { return `residata_chat_${userId || "anon"}`; }

export default function ChatAssistant({ lang = "sk" }) {
  const { user } = useAuth();
  const { tier } = useCapabilities();
  const L = (sk, en) => lang === "sk" ? sk : en;

  // messages: [{ role: 'user'|'assistant', content: string, error?: string }]
  const [messages, setMessages] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey(user?.id));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(-40) : [];
    } catch { return []; }
  });
  const [input, setInput]     = useState("");
  const [pending, setPending] = useState(false);
  const [remaining, setRemaining] = useState(null);  // { today } from last server response
  const [errBanner, setErrBanner] = useState(null);

  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  // Persist history. Keep only last 40 messages so localStorage doesn't bloat.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey(user?.id), JSON.stringify(messages.slice(-40)));
    } catch (_) { /* quota exceeded? fall through silently */ }
  }, [messages, user?.id]);

  // Auto-scroll on new message.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  // Focus input on mount.
  useEffect(() => { inputRef.current?.focus(); }, []);

  const dailyLimit = ({ anon: 3, free: 10, paid: 30, admin: 100 })[tier] ?? 3;
  const quotaColor = remaining == null ? dim
    : remaining.today <= 1 ? red
    : remaining.today <= 3 ? orange
    : green;

  const clearChat = () => {
    setMessages([]);
    setErrBanner(null);
    try { localStorage.removeItem(storageKey(user?.id)); } catch (_) {}
    track("chat_cleared");
  };

  const send = async () => {
    const q = input.trim();
    if (!q || pending) return;
    const nextMsgs = [...messages, { role: "user", content: q }];
    setMessages(nextMsgs);
    setInput("");
    setPending(true);
    setErrBanner(null);
    track("chat_question", { tier, len: q.length });

    try {
      // Attach Supabase session token when available so the server
      // can identify the caller. Anon calls go through with no
      // Authorization header and hit the stricter limit.
      const headers = { "Content-Type": "application/json" };
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      } catch (_) {}

      const r = await fetch("/api/ai/chat", {
        method: "POST", headers,
        body: JSON.stringify({ messages: nextMsgs.slice(-20), lang }),
      });
      if (r.status === 429) {
        const j = await r.json().catch(() => ({}));
        setErrBanner({ kind: "limit", text: j.error || L("Dosiahnutý denný limit.", "Daily limit reached.") });
        setMessages(prev => prev.slice(0, -1));
        return;
      }
      if (r.status === 403) {
        setErrBanner({ kind: "auth", text: L("Prístup odmietnutý. Ak máš tier 'pending', počkaj na schválenie.", "Access denied. If your tier is 'pending', wait for approval.") });
        setMessages(prev => prev.slice(0, -1));
        return;
      }
      if (r.status === 501) {
        setErrBanner({ kind: "config", text: L("AI zatiaľ nie je zapnuté (chýba API kľúč).", "AI not yet enabled (API key missing).") });
        setMessages(prev => prev.slice(0, -1));
        return;
      }
      if (!r.ok) {
        const body = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
      }
      const j = await r.json();
      setMessages(prev => [...prev, { role: "assistant", content: j.text || "" }]);
      setRemaining(j.remaining || null);
      track("chat_answer", { tier: j.tier, remaining: j.remaining?.today ?? null });
    } catch (e) {
      setErrBanner({ kind: "err", text: String(e?.message || e) });
      setMessages(prev => [...prev.slice(0, -1), { role: "user", content: q, error: String(e?.message || e) }]);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e) => {
    // Enter sends, Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const suggestedQuestions = tier === "paid" || tier === "admin" ? [
    L("Ktoré projekty mali najväčší predaj za posledných 30 dní?", "Which projects sold the most in the last 30 days?"),
    L("Ktorý okres má najvyššie €/m²?", "Which district has the highest €/m²?"),
    L("Porovnaj top 3 developerov podľa inventáru.", "Compare the top 3 developers by inventory."),
  ] : tier === "free" ? [
    L("Aký je stav môjho projektu?", "What's the state of my project?"),
    L("Koľko bytov je aktuálne na trhu v Bratislave?", "How many units are on the Bratislava market right now?"),
    L("Ktorý okres je cenovo najdrahší?", "Which district is the most expensive?"),
  ] : [
    L("Koľko novostavbových bytov sa teraz sleduje v Bratislave?", "How many new-build units are currently tracked in Bratislava?"),
    L("Koľko projektov je v aktívnej ponuke?", "How many projects are actively selling?"),
    L("Ktorý okres je cenovo najvyšší?", "Which district has the highest prices?"),
  ];

  return (
    <div style={{ padding: "1.25rem 1.5rem 2rem", maxWidth: 920, margin: "0 auto" }}>
      {/* Header + quota */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
        <div>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 700, color: text, margin: 0, letterSpacing: "-0.02em" }}>
            ✨ {L("Opýtaj sa čokoľvek o trhu", "Ask anything about the market")}
          </h2>
          <p style={{ color: dim, fontSize: "0.85rem", lineHeight: 1.55, marginTop: "0.35rem", marginBottom: 0, maxWidth: 640 }}>
            {L(
              "AI asistent odpovedá z dát Residata. Pri všeobecnej znalosti (mimo nášho datasetu) označí časť odpovede \"[všeobecná znalosť, nie dáta Residata]\" aby si vedel čo je odkiaľ.",
              "Grounded AI answers drawn from Residata's dataset. When the assistant reaches outside our data (e.g. general market context), it tags that part \"[general knowledge, not Residata data]\" so you know the provenance."
            )}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: mono, fontSize: "0.62rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.2rem" }}>
            {L("Denný limit", "Daily limit")}
          </div>
          <div style={{ fontFamily: mono, fontSize: "1.1rem", fontWeight: 700, color: quotaColor }}>
            {remaining == null ? `${dailyLimit}` : `${remaining.today} / ${dailyLimit}`}
          </div>
          <div style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, marginTop: "0.1rem" }}>
            tier: <span style={{ color: text }}>{tier}</span>
          </div>
        </div>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} style={{
        background: bg2, border: `1px solid ${border}`, borderRadius: 12,
        minHeight: 360, maxHeight: "58vh", overflowY: "auto",
        padding: "1rem 1.1rem",
        display: "flex", flexDirection: "column", gap: "0.75rem",
      }}>
        {messages.length === 0 && !pending && (
          <div style={{ color: dim, fontSize: "0.85rem" }}>
            <div style={{ marginBottom: "0.5rem" }}>{L("Skús napríklad:", "Try one of these:")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {suggestedQuestions.map((q, i) => (
                <button key={i}
                  onClick={() => { setInput(q); inputRef.current?.focus(); }}
                  style={{
                    textAlign: "left", cursor: "pointer",
                    background: "transparent", border: `1px solid ${border}`,
                    color: "#c4c4cc", padding: "0.55rem 0.8rem",
                    borderRadius: 8, fontFamily: "inherit", fontSize: "0.82rem",
                    lineHeight: 1.4,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = green; e.currentTarget.style.color = text; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = "#c4c4cc"; }}
                >{q}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} lang={lang} />
        ))}

        {pending && (
          <div style={{ color: dim, fontFamily: mono, fontSize: "0.8rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: green, animation: "cb-pulse 1s ease-in-out infinite" }} />
            {L("AI píše odpoveď…", "Assistant is thinking…")}
            <style>{`@keyframes cb-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }`}</style>
          </div>
        )}

        {errBanner && (
          <div style={{ color: errBanner.kind === "limit" ? orange : red, fontSize: "0.82rem", fontFamily: mono }}>
            ⚠ {errBanner.text}
          </div>
        )}
      </div>

      {/* Input row */}
      <div style={{
        marginTop: "0.85rem",
        background: bg2, border: `1px solid ${border}`, borderRadius: 12,
        padding: "0.55rem 0.6rem",
        display: "flex", gap: "0.5rem", alignItems: "flex-end",
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={pending}
          placeholder={L("Tvoja otázka… (Enter pošle, Shift+Enter = nový riadok)", "Your question… (Enter sends, Shift+Enter = new line)")}
          rows={2}
          style={{
            flex: 1, minHeight: 44, maxHeight: 180,
            background: bg, border: `1px solid ${border}`, borderRadius: 8,
            color: text, fontFamily: "inherit", fontSize: "0.9rem",
            padding: "0.6rem 0.75rem", resize: "vertical",
            outline: "none",
          }}
        />
        <button
          onClick={send}
          disabled={pending || !input.trim()}
          style={{
            background: pending || !input.trim() ? "#2a2a30" : green,
            color: pending || !input.trim() ? dim : "#0a0a0c",
            border: "none", borderRadius: 8,
            padding: "0.7rem 1.1rem", fontWeight: 700, fontFamily: mono, fontSize: "0.82rem",
            cursor: pending || !input.trim() ? "not-allowed" : "pointer",
            transition: "background 0.15s, color 0.15s",
          }}
        >
          {pending ? "…" : L("Poslať", "Send")}
        </button>
      </div>

      {/* Footer controls */}
      <div style={{ marginTop: "0.6rem", display: "flex", alignItems: "center", gap: "0.75rem", color: dim, fontSize: "0.72rem", fontFamily: mono }}>
        {messages.length > 0 && (
          <button onClick={clearChat}
            style={{ background: "transparent", border: "none", color: dim, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", fontSize: "inherit", padding: 0 }}>
            {L("Vymazať konverzáciu", "Clear conversation")}
          </button>
        )}
        <span style={{ marginLeft: "auto" }}>
          {L("AI môže robiť chyby. Čísla v Analytics a Reports sú zdrojom pravdy.",
             "AI can err. Numbers in Analytics and Reports are the source of truth.")}
        </span>
      </div>
    </div>
  );
}

function MessageBubble({ msg, lang }) {
  const isUser = msg.role === "user";
  const isAssistant = msg.role === "assistant";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
    }}>
      <div style={{
        maxWidth: "80%",
        background: isUser ? "rgba(0,229,160,0.1)" : "transparent",
        border: `1px solid ${isUser ? "rgba(0,229,160,0.3)" : border}`,
        borderRadius: 12,
        padding: "0.6rem 0.85rem",
        fontSize: "0.88rem", lineHeight: 1.55, color: text,
      }}>
        <div style={{ fontFamily: mono, fontSize: "0.58rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.3rem" }}>
          {isUser ? (lang === "sk" ? "Ty" : "You") : (lang === "sk" ? "Residata AI" : "Residata AI")}
        </div>
        <div style={{ whiteSpace: "pre-wrap" }}>
          {isAssistant ? renderAssistantText(msg.content) : msg.content}
        </div>
        {msg.error && (
          <div style={{ marginTop: "0.35rem", color: red, fontSize: "0.74rem", fontFamily: mono }}>
            ⚠ {msg.error}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Render the assistant's plain-text answer, highlighting the
 * `[general knowledge, not Residata data]` / `[všeobecná znalosť,
 * nie dáta Residata]` disclosure marker in amber so the provenance
 * is visually obvious at a glance.
 */
function renderAssistantText(raw) {
  const s = String(raw || "");
  if (!s) return null;
  const re = /\[(všeobecná znalosť, nie dáta Residata|general knowledge, not Residata data)\]/gi;
  const out = [];
  let idx = 0, key = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > idx) out.push(<span key={key++}>{s.slice(idx, m.index)}</span>);
    out.push(
      <span key={key++} style={{
        display: "inline-block",
        fontFamily: mono, fontSize: "0.66rem",
        color: orange, background: "rgba(245,166,35,0.12)",
        border: "1px solid rgba(245,166,35,0.35)",
        padding: "1px 6px", borderRadius: 4,
        margin: "0 2px", letterSpacing: "0.04em",
      }}>⚠ {m[0].slice(1, -1)}</span>
    );
    idx = m.index + m[0].length;
  }
  if (idx < s.length) out.push(<span key={key++}>{s.slice(idx)}</span>);
  return out;
}
