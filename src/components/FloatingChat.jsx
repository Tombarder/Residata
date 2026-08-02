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
import { renderAssistantText, ChatProgress } from "./ChatAssistant";
import AiBetaBanner from "./AiBetaBanner";
import { pushRoute } from "../lib/routing";

const mono   = "'JetBrains Mono', monospace";
const green  = "var(--accent)";
const dim    = "var(--text-dim)";
const text   = "var(--text)";
const border = "var(--border)";
const bg     = "var(--bg)";
const bg2    = "var(--surface-2)";
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
          className="residata-chat-pill"
          style={{
            position: "fixed",
            right: "calc(20px + var(--safe-right))", bottom: "calc(20px + var(--safe-bottom))",
            height: 44,
            padding: "0 16px 0 14px",
            borderRadius: 22,
            border: `1px solid color-mix(in srgb, var(--accent) 50%, transparent)`,
            background: "var(--surface-2)",
            color: text,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.55rem",
            fontFamily: "inherit",
            fontSize: "0.82rem",
            fontWeight: 600,
            letterSpacing: "-0.005em",
            boxShadow: "0 6px 20px rgba(0,0,0,0.45), 0 0 0 1px color-mix(in srgb, var(--accent) 6%, transparent) inset",
            zIndex: "var(--z-pill)",
          }}
        >
          {/* Sparkle glyph in the accent green. No notification dot,
              no speech-bubble icon — we're deliberately NOT looking
              like WhatsApp/Intercom. The explicit text label tells
              the user what this is (an AI prompt) without relying on
              icon recognition. */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2l2.2 5.8L20 10l-5.8 2.2L12 18l-2.2-5.8L4 10l5.8-2.2L12 2z" fill={green}/>
            <path d="M19 3l.9 2.4L22 6l-2.1.6L19 9l-.9-2.4L16 6l2.1-.6L19 3z" fill={green} opacity="0.65"/>
          </svg>
          <span>{L("Opýtaj sa AI", "Ask AI")}</span>
          <style>{`
            .residata-chat-pill { transition: transform 0.18s, border-color 0.18s, box-shadow 0.18s, background 0.18s; }
            .residata-chat-pill:hover {
              transform: translateY(-1px);
              border-color: ${green};
              background: var(--surface-2);
              box-shadow: 0 10px 28px rgba(0,0,0,0.55), 0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent) inset, 0 0 24px color-mix(in srgb, var(--accent) 18%, transparent);
            }
          `}</style>
        </button>
      )}

      {open && (
        <div style={{
          position: "fixed",
          right: "calc(20px + var(--safe-right))", bottom: "calc(20px + var(--safe-bottom))",
          width: "min(380px, calc(100vw - 32px))",
          // svh (smallest viewport) keeps the bottom-anchored panel STABLE when
          // the iOS toolbar expands — dvh would shrink and shove the panel's top
          // edge down mid-read. Subtract the nav height + home-bar inset so the
          // panel can never run under the top chrome or the home indicator.
          height: "min(560px, calc(100svh - var(--nav-h, 72px) - var(--safe-bottom) - 40px))",
          background: bg2, border: `1px solid ${border}`, borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.65), 0 0 40px color-mix(in srgb, var(--accent) 8%, transparent)",
          display: "flex", flexDirection: "column",
          zIndex: "var(--z-pill)",
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
            background: "linear-gradient(180deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent)",
            borderTopLeftRadius: 14, borderTopRightRadius: 14,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: green,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--bg)",
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

          {/* Beta disclosure — compact variant suited to the narrow
              floating panel. Renders only when the user opens the
              chat bubble (this whole block is gated by `open` above)
              + auto-hides for 7 days on dismiss. */}
          <AiBetaBanner lang={lang} compact />

          {/* Transcript */}
          <div ref={scrollRef} style={{
            flex: 1, overflowY: "auto", padding: "0.75rem 0.85rem",
            display: "flex", flexDirection: "column", gap: "0.55rem",
          }}>
            {chat.messages.length === 0 && !chat.pending && (
              <div style={{ color: dim, fontSize: "0.8rem" }}>
                <div style={{ marginBottom: "0.45rem" }}>
                  {user
                    ? L("Ahoj. Opýtaj sa na čokoľvek o trhu novostavieb.", "Hi. Ask me anything about the new-build market.")
                    : L("Opýtaj sa na trh novostavieb. Pre plný prístup k projektom sa prihlás.", "Ask about the new-build market. Sign in for per-project detail.")}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  {chat.suggestedQuestions.slice(0, 3).map((q, i) => (
                    <button key={i}
                      onClick={() => chat.send(q)}
                      style={{
                        textAlign: "left", cursor: "pointer",
                        background: "transparent", border: `1px solid ${border}`,
                        color: "var(--text-2)", padding: "0.45rem 0.65rem",
                        borderRadius: 7, fontFamily: "inherit", fontSize: "0.76rem",
                        lineHeight: 1.35,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = green; e.currentTarget.style.color = text; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = "var(--text-2)"; }}
                    >{q}</button>
                  ))}
                </div>
              </div>
            )}

            {chat.messages.map((m, i) => (
              <MiniBubble key={i} msg={m} lang={lang} onRate={chat.rateMessage} />
            ))}

            {chat.pending && (
              <ChatProgress
                steps={chat.steps}
                showProgress={chat.showProgress}
                setShowProgress={chat.setShowProgress}
                lang={lang}
                compact
              />
            )}

            {chat.error && (
              <LimitBanner
                error={chat.error}
                lang={lang}
                compact
                onSignIn={() => { setOpen(false); if (onNavigate) onNavigate("Home"); /* marketing Home opens login modal via nav */ }}
                onBilling={() => { setOpen(false); if (onNavigate) onNavigate("Pricing"); }}
              />
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
              onFocus={chat.markTypingStart}
              onChange={e => { chat.markTypingStart(); chat.setInput(e.target.value); }}
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
                color: chat.pending || !chat.input.trim() ? dim : "var(--bg)",
                border: "none", borderRadius: 8,
                padding: "0.5rem 0.8rem", fontWeight: 700, fontFamily: mono, fontSize: "0.76rem",
                cursor: chat.pending || !chat.input.trim() ? "not-allowed" : "pointer",
              }}
            >
              {chat.pending ? "…" : L("Poslať", "Send")}
            </button>
          </div>

          {/* Footer: quota + clear, then legal disclaimer row */}
          <div style={{
            padding: "0.35rem 0.6rem 0.2rem",
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
          {/* Persistent compact legal disclaimer — tiny but always
              visible so every conversation is framed by the same
              guardrail. Full wording is available in the /app/ask
              page; widget stays terse for screen-real-estate reasons. */}
          <div style={{
            padding: "0.3rem 0.6rem 0.55rem",
            borderTop: `1px solid ${border}`,
            fontFamily: mono, fontSize: "0.55rem", color: dim,
            lineHeight: 1.45, letterSpacing: "0.01em",
          }} title={L(
            "Residata je informačná služba. AI odpovede nepredstavujú investičné, finančné ani právne poradenstvo. Pre konkrétne rozhodnutia konzultuj s odborníkom.",
            "Residata is an information service. AI answers are not investment, financial or legal advice. Consult a professional for specific decisions."
          )}>
            <span style={{ color: orange }}>⚠ </span>
            {L(
              "Informačná služba, nie investičné poradenstvo.",
              "Information service — not investment advice."
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * LimitBanner — shown when the server returns 429 with an upgrade
 * CTA. Exported so ChatAssistant (full page) can reuse it instead
 * of rolling its own.
 */
export function LimitBanner({ error, lang, compact, onSignIn, onBilling }) {
  const L = (sk, en) => lang === "sk" ? sk : en;
  const action = error?.upgradeAction;   // "sign_in" | "billing" | "contact"
  const base = {
    marginTop: compact ? "0.25rem" : "0.75rem",
    padding: compact ? "0.55rem 0.7rem" : "0.85rem 1rem",
    borderRadius: 10,
    background: "rgba(245,166,35,0.08)",
    border: "1px solid rgba(245,166,35,0.35)",
    color: text, fontSize: compact ? "0.78rem" : "0.85rem", lineHeight: 1.5,
  };
  return (
    <div style={base}>
      <div style={{ color: orange, fontFamily: mono, fontSize: compact ? "0.6rem" : "0.65rem", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.3rem" }}>
        ⚠ {L("Denný limit vyčerpaný", "Daily limit reached")}
      </div>
      <div style={{ marginBottom: "0.55rem" }}>{error.text}</div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        {action === "sign_in" && onSignIn && (
          <button onClick={onSignIn} style={ctaBtn(green)}>
            {L("Prihlásiť sa (free)", "Sign in (free)")}
          </button>
        )}
        {(action === "sign_in" || action === "billing") && onBilling && (
          <button onClick={onBilling} style={ctaBtn("var(--bg)", green, "var(--bg)")}>
            {L("Upgrade na paid", "Upgrade to paid")}
          </button>
        )}
        {action === "contact" && (
          <a href="mailto:info@residata.eu" style={{ ...ctaBtn("var(--bg)", green, "var(--bg)"), textDecoration: "none", display: "inline-block" }}>
            {L("Napíš Residata", "Contact Residata")}
          </a>
        )}
      </div>
    </div>
  );
}

function ctaBtn(bg, fg, textColor) {
  return {
    background: bg || green,
    color: textColor || "var(--bg)",
    border: fg ? `1px solid ${fg}` : "none",
    borderRadius: 7,
    padding: "0.42rem 0.85rem",
    fontFamily: mono, fontSize: "0.74rem", fontWeight: 700,
    cursor: "pointer",
  };
}

function MiniBubble({ msg, lang, onRate }) {
  const isUser = msg.role === "user";
  const isAssistant = msg.role === "assistant";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div style={{
        maxWidth: "88%",
        background: isUser ? "color-mix(in srgb, var(--accent) 12%, transparent)" : "var(--surface)",
        border: `1px solid ${isUser ? "color-mix(in srgb, var(--accent) 30%, transparent)" : border}`,
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
        {/* 👍/👎 — same model as the full ChatAssistant: only assistant
            rows with a server-issued log_id get the affordance. */}
        {isAssistant && msg.log_id && onRate && (
          <FloatFeedback msg={msg} onRate={onRate} lang={lang} />
        )}
      </div>
    </div>
  );
}

function FloatFeedback({ msg, onRate, lang }) {
  const tag = (active, color) => ({
    background: active ? `${color}1f` : "transparent",
    border: `1px solid ${active ? color : border}`,
    color: active ? color : dim,
    cursor: "pointer", padding: "0.12rem 0.32rem", borderRadius: 4,
    fontSize: "0.72rem", fontFamily: "inherit", lineHeight: 1,
  });
  const isGood = msg.feedback === "good";
  const isBad  = msg.feedback === "bad";
  return (
    <div style={{
      display: "flex", gap: "0.3rem",
      marginTop: "0.4rem", paddingTop: "0.3rem",
      borderTop: `1px dashed ${border}`,
    }}>
      <button onClick={() => onRate(msg.log_id, "good")}
              title={lang === "sk" ? "Užitočné" : "Helpful"}
              aria-pressed={isGood} style={tag(isGood, green)}>👍</button>
      <button onClick={() => onRate(msg.log_id, "bad")}
              title={lang === "sk" ? "Nepresné" : "Inaccurate"}
              aria-pressed={isBad} style={tag(isBad, red)}>👎</button>
    </div>
  );
}
