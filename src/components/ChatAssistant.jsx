/**
 * ChatAssistant — full-page chat for /app/ask.
 *
 * All state + networking lives in useChat() so the floating widget
 * on the marketing site can share the same conversation, tier
 * limits and /api/ai/chat endpoint with zero duplication.
 */
import { useEffect, useRef } from "react";
import { useChat, GENERAL_KNOWLEDGE_RE } from "../lib/useChat";
import { LimitBanner } from "./FloatingChat";
import { pushRoute } from "../lib/routing";

const mono   = "'JetBrains Mono', monospace";
const green  = "#00e5a0";
const dim    = "#8a8a96";
const text   = "#e8e8ed";
const border = "#222228";
const bg     = "#0a0a0b";
const bg2    = "#0e0e10";
const orange = "#f5a623";
const red    = "#ff6b6b";

export default function ChatAssistant({ lang = "sk" }) {
  const chat = useChat({ lang });
  const L = (sk, en) => lang === "sk" ? sk : en;

  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.pending]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const quotaColor = chat.remaining == null ? dim
    : chat.remaining.today <= 1 ? red
    : chat.remaining.today <= 3 ? orange
    : green;

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chat.send();
    }
  };

  return (
    <div style={{ padding: "1.25rem 1.5rem 2rem", maxWidth: 920, margin: "0 auto" }}>
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
            {chat.remaining == null ? `${chat.dailyLimit}` : `${chat.remaining.today} / ${chat.dailyLimit}`}
          </div>
          <div style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, marginTop: "0.1rem" }}>
            tier: <span style={{ color: text }}>{chat.tier}</span>
          </div>
        </div>
      </div>

      <div ref={scrollRef} style={{
        background: bg2, border: `1px solid ${border}`, borderRadius: 12,
        minHeight: 360, maxHeight: "58vh", overflowY: "auto",
        padding: "1rem 1.1rem",
        display: "flex", flexDirection: "column", gap: "0.75rem",
      }}>
        {chat.messages.length === 0 && !chat.pending && (
          <div style={{ color: dim, fontSize: "0.85rem" }}>
            <div style={{ marginBottom: "0.5rem" }}>{L("Skús napríklad:", "Try one of these:")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {chat.suggestedQuestions.map((q, i) => (
                <button key={i}
                  onClick={() => { chat.setInput(q); inputRef.current?.focus(); }}
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

        {chat.messages.map((m, i) => (
          <MessageBubble key={i} msg={m} lang={lang} />
        ))}

        {chat.pending && (
          <div style={{ color: dim, fontFamily: mono, fontSize: "0.8rem", display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <span aria-hidden style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: green, animation: "cb-pulse 1s ease-in-out infinite" }} />
            {L("AI píše odpoveď…", "Assistant is thinking…")}
            <style>{`@keyframes cb-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }`}</style>
          </div>
        )}

        {chat.error && (
          chat.error.kind === "limit" ? (
            <LimitBanner
              error={chat.error}
              lang={lang}
              onSignIn={() => { window.location.assign("/"); /* Home opens login modal */ }}
              onBilling={() => { pushRoute("App:Billing"); window.location.assign("/app/billing"); }}
            />
          ) : (
            <div style={{ color: red, fontSize: "0.82rem", fontFamily: mono }}>
              ⚠ {chat.error.text}
            </div>
          )
        )}
      </div>

      <div style={{
        marginTop: "0.85rem",
        background: bg2, border: `1px solid ${border}`, borderRadius: 12,
        padding: "0.55rem 0.6rem",
        display: "flex", gap: "0.5rem", alignItems: "flex-end",
      }}>
        <textarea
          ref={inputRef}
          value={chat.input}
          onChange={e => chat.setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={chat.pending}
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
          onClick={() => chat.send()}
          disabled={chat.pending || !chat.input.trim()}
          style={{
            background: chat.pending || !chat.input.trim() ? "#2a2a30" : green,
            color: chat.pending || !chat.input.trim() ? dim : "#0a0a0c",
            border: "none", borderRadius: 8,
            padding: "0.7rem 1.1rem", fontWeight: 700, fontFamily: mono, fontSize: "0.82rem",
            cursor: chat.pending || !chat.input.trim() ? "not-allowed" : "pointer",
            transition: "background 0.15s, color 0.15s",
          }}
        >
          {chat.pending ? "…" : L("Poslať", "Send")}
        </button>
      </div>

      <div style={{ marginTop: "0.6rem", display: "flex", alignItems: "center", gap: "0.75rem", color: dim, fontSize: "0.72rem", fontFamily: mono }}>
        {chat.messages.length > 0 && (
          <button onClick={chat.clear}
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
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth: "80%",
        background: isUser ? "rgba(0,229,160,0.1)" : "transparent",
        border: `1px solid ${isUser ? "rgba(0,229,160,0.3)" : border}`,
        borderRadius: 12,
        padding: "0.6rem 0.85rem",
        fontSize: "0.88rem", lineHeight: 1.55, color: text,
      }}>
        <div style={{ fontFamily: mono, fontSize: "0.58rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.3rem" }}>
          {isUser ? (lang === "sk" ? "Ty" : "You") : "Residata AI"}
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

// Shared renderer — highlights the general-knowledge disclosure chip.
// Placed here rather than in useChat so it can return real JSX without
// forcing useChat to depend on React elements.
export function renderAssistantText(raw) {
  const s = String(raw || "");
  if (!s) return null;
  const out = [];
  let idx = 0, key = 0, m;
  GENERAL_KNOWLEDGE_RE.lastIndex = 0;
  while ((m = GENERAL_KNOWLEDGE_RE.exec(s)) !== null) {
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
