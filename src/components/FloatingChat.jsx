/**
 * FloatingChat — bottom-right bubble on the marketing site that
 * opens a compact chat panel. Same endpoint + rate-limit stack as
 * the /app/ask page (via useChat hook). Conversation state is
 * shared with the full page via localStorage, keyed by user-id —
 * so a question a user types on the marketing bubble is still in
 * the full-page transcript after they sign in and open /app/ask.
 *
 * Tier behaviour:
 *   · anon users see the bubble, can ask 3 questions/day (server
 *     enforces the limit)
 *   · logged-in users also see an "Open in full view →" button on
 *     the panel header that routes them to /app/ask (where history
 *     continues because the localStorage key matches)
 *
 * Placement: only on marketing pages (App.jsx renders this component
 * outside the /app/* shell so the platform keeps its own sidebar
 * entry). Fixed position bottom-right, clears the footer gutter on
 * narrow viewports via a media-query-adjusted bottom offset.
 */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/useAuth";
import { useChat } from "../lib/useChat";
import { renderAssistantText } from "./ChatAssistant";
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

export default function FloatingChat({ lang = "sk", onNavigate }) {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const chat = useChat({ lang });
  const L = (sk, en) => lang === "sk" ? sk : en;

  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  // Auto-scroll the transcript whenever a new message lands.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.pending, open]);

  // Focus the input when the panel opens — small QoL so the user can
  // start typing immediately without an extra click.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 150);
      return () => clearTimeout(t);
    }
  }, [open]);

  const expandToFullPage = () => {
    setOpen(false);
    // Logged-in users get pushed to the dedicated page; for anon this
    // button isn't shown at all (gated at the render level below).
    if (onNavigate) onNavigate("App:Assistant");
    else { pushRoute("App:Assistant"); window.location.assign("/app/ask"); }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chat.send(); }
  };

  // ── Bubble ────────────────────────────────────────────────────
  // Not using position:fixed on the whole outer div so the shared
  // state can keep working even when the bubble isn't visible. The
  // two sub-elements are individually fixed-positioned.
  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label={L("Otvoriť AI asistenta", "Open AI assistant")}
          title={L("Opýtaj sa AI asistenta", "Ask the AI assistant")}
          className="residata-chat-bubble"
          style={{
            position: "fixed",
            right: 20, bottom: 20,
            width: 60, height: 60,
            borderRadius: "50%",
            border: "none",
            background: `radial-gradient(circle at 30% 30%, #00ffb7 0%, ${green} 55%, #009b6b 100%)`,
            boxShadow: "0 8px 28px rgba(0,229,160,0.35), 0 2px 8px rgba(0,0,0,0.4)",
            cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#0a0a0b",
            zIndex: 2000,
          }}
        >
          {/* Sparkle + chat-bubble glyph — drawn in the same green
              accent colour with a soft pulse so the eye finds it
              without the bubble screaming "notification!!1". */}
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
            {/* sparkle */}
            <path d="M12 8v3M12 15v0M9.5 9.5l1.8 1.8M14.5 14.5l-1.8-1.8M10 12h-1M15 12h-1" strokeWidth="1.6"/>
          </svg>
          <span style={{
            position: "absolute", top: 8, right: 10,
            width: 10, height: 10, borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 0 0 2px #00b488",
            animation: "rbs-dot 2.2s ease-in-out infinite",
          }} />
          <style>{`
            @keyframes rbs-dot { 0%,100% { opacity: 0.45; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.1); } }
            .residata-chat-bubble { transition: transform 0.2s, box-shadow 0.2s; }
            .residata-chat-bubble:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(0,229,160,0.5), 0 2px 10px rgba(0,0,0,0.5); }
            .residata-chat-bubble::after {
              content: "${L("Opýtaj sa AI", "Ask AI")}";
              position: absolute; right: 72px; top: 50%; transform: translateY(-50%);
              background: #0e0e10; color: #e8e8ed;
              border: 1px solid #222228; border-radius: 6px;
              padding: 0.4rem 0.7rem; font-size: 0.75rem; font-family: ${mono};
              white-space: nowrap; opacity: 0; pointer-events: none;
              transition: opacity 0.2s;
            }
            .residata-chat-bubble:hover::after { opacity: 1; }
            @media (max-width: 520px) {
              .residata-chat-bubble::after { display: none; }
            }
          `}</style>
        </button>
      )}

      {open && (
        <div style={{
          position: "fixed",
          right: 20, bottom: 20,
          width: "min(380px, calc(100vw - 32px))",
          height: "min(560px, calc(100vh - 40px))",
          background: bg2, border: `1px solid ${border}`, borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.65), 0 0 40px rgba(0,229,160,0.08)",
          display: "flex", flexDirection: "column",
          zIndex: 2000,
          animation: "rbs-panel 0.2s ease-out",
        }}>
          <style>{`
            @keyframes rbs-panel {
              from { opacity: 0; transform: translateY(12px); }
              to   { opacity: 1; transform: translateY(0); }
            }
            @keyframes rbs-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }
          `}</style>

          {/* Header */}
          <div style={{
            padding: "0.7rem 0.85rem",
            display: "flex", alignItems: "center", gap: "0.5rem",
            borderBottom: `1px solid ${border}`,
            background: "linear-gradient(180deg, rgba(0,229,160,0.08), transparent)",
            borderTopLeftRadius: 14, borderTopRightRadius: 14,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: green,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#0a0a0b",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 8v3M10 12h-1M15 12h-1M9.5 9.5l1.8 1.8M14.5 14.5l-1.8-1.8"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: text, fontWeight: 700, fontSize: "0.88rem", letterSpacing: "-0.01em" }}>
                Residata AI
              </div>
              <div style={{ color: dim, fontFamily: mono, fontSize: "0.6rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {L("odpovedá z našich dát", "answers from our data")}
              </div>
            </div>
            {user && (
              <button
                onClick={expandToFullPage}
                title={L("Otvoriť v plnom zobrazení", "Open in full view")}
                style={{
                  background: "transparent", border: `1px solid ${border}`,
                  color: dim, borderRadius: 6, cursor: "pointer",
                  padding: "0.3rem 0.55rem", fontSize: "0.7rem", fontFamily: mono,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = green; e.currentTarget.style.borderColor = green; }}
                onMouseLeave={e => { e.currentTarget.style.color = dim; e.currentTarget.style.borderColor = border; }}
              >⇱</button>
            )}
            <button
              onClick={() => setOpen(false)}
              title={L("Zavrieť", "Close")}
              aria-label={L("Zavrieť chat", "Close chat")}
              style={{
                background: "transparent", border: `1px solid ${border}`,
                color: dim, borderRadius: 6, cursor: "pointer",
                padding: "0.3rem 0.55rem", fontSize: "0.75rem", fontFamily: mono, lineHeight: 1,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = red; }}
              onMouseLeave={e => { e.currentTarget.style.color = dim; }}
            >✕</button>
          </div>

          {/* Transcript */}
          <div ref={scrollRef} style={{
            flex: 1, overflowY: "auto", padding: "0.75rem 0.85rem",
            display: "flex", flexDirection: "column", gap: "0.55rem",
          }}>
            {chat.messages.length === 0 && !chat.pending && (
              <div style={{ color: dim, fontSize: "0.8rem" }}>
                <div style={{ marginBottom: "0.45rem" }}>
                  {user
                    ? L("Ahoj. Opýtaj sa na čokoľvek o bratislavskom trhu novostavieb.", "Hi. Ask me anything about the Bratislava new-build market.")
                    : L("Opýtaj sa na bratislavský trh novostavieb. Pre plný prístup k projektom sa prihlás.", "Ask about the Bratislava new-build market. Sign in for per-project detail.")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {chat.suggestedQuestions.slice(0, 3).map((q, i) => (
                    <button key={i}
                      onClick={() => chat.send(q)}
                      style={{
                        textAlign: "left", cursor: "pointer",
                        background: "transparent", border: `1px solid ${border}`,
                        color: "#c4c4cc", padding: "0.45rem 0.65rem",
                        borderRadius: 7, fontFamily: "inherit", fontSize: "0.76rem",
                        lineHeight: 1.35,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = green; e.currentTarget.style.color = text; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = "#c4c4cc"; }}
                    >{q}</button>
                  ))}
                </div>
              </div>
            )}

            {chat.messages.map((m, i) => (
              <MiniBubble key={i} msg={m} lang={lang} />
            ))}

            {chat.pending && (
              <div style={{ color: dim, fontFamily: mono, fontSize: "0.72rem", display: "flex", gap: "0.35rem", alignItems: "center" }}>
                <span aria-hidden style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: green, animation: "rbs-pulse 1s ease-in-out infinite" }} />
                {L("AI píše…", "Thinking…")}
              </div>
            )}

            {chat.error && (
              <div style={{ color: chat.error.kind === "limit" ? orange : red, fontSize: "0.75rem", fontFamily: mono }}>
                ⚠ {chat.error.text}
              </div>
            )}
          </div>

          {/* Input */}
          <div style={{
            borderTop: `1px solid ${border}`,
            padding: "0.5rem 0.55rem",
            display: "flex", gap: "0.4rem", alignItems: "flex-end",
          }}>
            <textarea
              ref={inputRef}
              value={chat.input}
              onChange={e => chat.setInput(e.target.value)}
              onKeyDown={onKey}
              disabled={chat.pending}
              placeholder={L("Tvoja otázka…", "Your question…")}
              rows={1}
              style={{
                flex: 1, minHeight: 36, maxHeight: 120,
                background: bg, border: `1px solid ${border}`, borderRadius: 8,
                color: text, fontFamily: "inherit", fontSize: "0.85rem",
                padding: "0.45rem 0.6rem", resize: "none", outline: "none",
              }}
            />
            <button
              onClick={() => chat.send()}
              disabled={chat.pending || !chat.input.trim()}
              style={{
                background: chat.pending || !chat.input.trim() ? "#2a2a30" : green,
                color: chat.pending || !chat.input.trim() ? dim : "#0a0a0c",
                border: "none", borderRadius: 8,
                padding: "0.5rem 0.8rem", fontWeight: 700, fontFamily: mono, fontSize: "0.76rem",
                cursor: chat.pending || !chat.input.trim() ? "not-allowed" : "pointer",
              }}
            >
              {chat.pending ? "…" : L("Poslať", "Send")}
            </button>
          </div>

          {/* Footer */}
          <div style={{
            padding: "0.35rem 0.6rem 0.5rem",
            fontFamily: mono, fontSize: "0.6rem", color: dim,
            display: "flex", justifyContent: "space-between", gap: "0.5rem",
          }}>
            <span>
              {chat.remaining == null
                ? `${chat.dailyLimit} ${L("za deň", "per day")}`
                : `${chat.remaining.today}/${chat.dailyLimit} ${L("dnes", "today")}`}
            </span>
            {chat.messages.length > 0 && (
              <button onClick={chat.clear}
                style={{ background: "transparent", border: "none", color: dim, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", fontSize: "inherit", padding: 0 }}>
                {L("vymazať", "clear")}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function MiniBubble({ msg, lang }) {
  const isUser = msg.role === "user";
  const isAssistant = msg.role === "assistant";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth: "88%",
        background: isUser ? "rgba(0,229,160,0.12)" : "#14141a",
        border: `1px solid ${isUser ? "rgba(0,229,160,0.3)" : border}`,
        borderRadius: 10,
        padding: "0.45rem 0.65rem",
        fontSize: "0.82rem", lineHeight: 1.5, color: text,
        whiteSpace: "pre-wrap",
      }}>
        {isAssistant ? renderAssistantText(msg.content) : msg.content}
        {msg.error && (
          <div style={{ marginTop: "0.25rem", color: red, fontSize: "0.7rem", fontFamily: mono }}>
            ⚠ {msg.error}
          </div>
        )}
      </div>
    </div>
  );
}
