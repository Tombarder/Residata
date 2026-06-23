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
import AiBetaBanner from "./AiBetaBanner";

// Pulse animation for the pending indicator. Mounted ONCE at module load
// (idempotent — id="cb-pulse-anim" prevents duplicate insertion on HMR or
// repeat imports) instead of inside the pending-toggle JSX, where it was
// being re-attached every time AI started/finished a response. Same DOM
// outcome, fewer stylesheet writes.
if (typeof document !== "undefined" && !document.getElementById("cb-pulse-anim")) {
  const styleEl = document.createElement("style");
  styleEl.id = "cb-pulse-anim";
  styleEl.textContent = "@keyframes cb-pulse { 0%,100% { opacity: 0.3; } 50% { opacity: 1; } }";
  document.head.appendChild(styleEl);
}

const mono   = "'JetBrains Mono', monospace";
const green  = "#00e5a0";
const dim    = "#8a8a96";
const text   = "#e8e8ed";
const border = "#222228";
const bg     = "#0a0a0b";
const bg2    = "#0e0e10";
const orange = "#f5a623";
const red    = "#ff6b6b";

/* ChatProgress — the live "what's happening" view shown while an answer is
   pending. Visible by default; a small toggle hides it (the choice is persisted
   in useChat). Steps come from the endpoint's SSE `step` events — free, since
   they just surface the database lookups the assistant already runs. Shared by
   the full page and the floating widget. */
export function ChatProgress({ steps = [], showProgress, setShowProgress, lang = "sk", compact = false }) {
  const L = (sk, en) => (lang === "sk" ? sk : en);
  const fs = compact ? "0.72rem" : "0.8rem";
  const dot = { display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: green, animation: "cb-pulse 1s ease-in-out infinite", flexShrink: 0 };
  const toggle = (
    <button onClick={() => setShowProgress(!showProgress)}
      style={{ background: "transparent", border: "none", color: dim, cursor: "pointer", fontFamily: mono, fontSize: compact ? "0.56rem" : "0.6rem", textDecoration: "underline", padding: 0, marginLeft: "0.55rem" }}>
      {showProgress ? L("skryť", "hide") : L("zobraziť postup", "show steps")}
    </button>
  );
  if (!showProgress) {
    return (
      <div style={{ color: dim, fontFamily: mono, fontSize: fs, display: "flex", gap: "0.4rem", alignItems: "center" }}>
        <span aria-hidden style={dot} />{L("Pracujem…", "Working…")}{toggle}
      </div>
    );
  }
  const lines = steps.length ? steps : [L("Premýšľam…", "Thinking…")];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.28rem" }}>
      {lines.map((s, i) => {
        const isLast = i === lines.length - 1;
        return (
          <div key={i} style={{ display: "flex", gap: "0.4rem", alignItems: "center", color: isLast ? text : dim, fontFamily: mono, fontSize: fs, opacity: isLast ? 1 : 0.6 }}>
            {isLast
              ? <span aria-hidden style={dot} />
              : <span aria-hidden style={{ color: green, fontSize: "0.7rem", width: 8, flexShrink: 0, textAlign: "center" }}>✓</span>}
            <span>{s}</span>
            {isLast && toggle}
          </div>
        );
      })}
    </div>
  );
}

export default function ChatAssistant({ lang = "sk", setCurrent }) {
  const chat = useChat({ lang });
  const L = (sk, en) => lang === "sk" ? sk : en;

  // SPA-nav helper. If parent passed setCurrent (Platform.jsx does), use it
  // — no page reload, no extra history entry. Falls back to window.location
  // for safety if rendered without setCurrent (e.g. future floating context).
  const navTo = (pageKey, fallbackPath) => {
    if (setCurrent) { setCurrent(pageKey); return; }
    if (typeof window !== "undefined") window.location.assign(fallbackPath);
  };

  const scrollRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages, chat.pending]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Percentage-based thresholds so paid (250/day) + free (25/day) +
  // anon (3/day) all get visually proportional warnings. Was absolute
  // counts (≤1 red, ≤3 orange) which fired too late for the paid tier
  // (red only at 1/250 = 0.4%) and too early for anon (orange at
  // 3/3 = 100%). Also keeps ≤1 fallback so the last call always reads red
  // regardless of dailyLimit (e.g. an admin-throttled user with 0 left).
  const quotaColor = (() => {
    if (chat.remaining == null) return dim;
    const left = chat.remaining.today;
    if (left <= 1) return red;
    const limit = chat.dailyLimit || 0;
    if (limit > 0) {
      const pct = left / limit;
      if (pct <= 0.1) return red;
      if (pct <= 0.25) return orange;
      return green;
    }
    // Fallback to absolute thresholds if dailyLimit unknown.
    if (left <= 3) return orange;
    return green;
  })();

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chat.send();
    }
  };

  return (
    <div style={{ padding: "1.25rem 1.5rem 2rem", maxWidth: 920, margin: "0 auto" }}>
      {/* Beta disclosure — scoped to this AI page (and the FloatingChat
          panel on marketing). Hidden when dismissed (7-day localStorage). */}
      <AiBetaBanner lang={lang} />

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
          <MessageBubble key={i} msg={m} lang={lang} onRate={chat.rateMessage} />
        ))}

        {chat.pending && (
          <ChatProgress
            steps={chat.steps}
            showProgress={chat.showProgress}
            setShowProgress={chat.setShowProgress}
            lang={lang}
          />
        )}

        {chat.error && (
          chat.error.kind === "limit" ? (
            <LimitBanner
              error={chat.error}
              lang={lang}
              /* SPA-nav when possible (Platform.jsx passes setCurrent —
                 keeps shell state + scroll). Falls back to full reload if
                 ChatAssistant is rendered without a navigator. */
              onSignIn={() => navTo("Home", "/")}
              onBilling={() => navTo("App:Billing", "/app/billing")}
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
          /* markTypingStart timestamps the moment the user starts
             interacting with this question — focus or first keystroke.
             useChat snapshots that on send() and ships user_typing_ms
             to ai_chat_log so we can analyze "deliberate vs throwaway"
             questions in the AI testing review. */
          onFocus={chat.markTypingStart}
          onChange={e => { chat.markTypingStart(); chat.setInput(e.target.value); }}
          onKeyDown={onKeyDown}
          disabled={chat.pending}
          aria-label={L("Otázka pre AI asistenta", "Question for the AI assistant")}
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

      <div style={{ marginTop: "0.6rem", display: "flex", alignItems: "center", gap: "0.75rem", color: dim, fontSize: "0.72rem", fontFamily: mono, flexWrap: "wrap" }}>
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
      {/* Persistent legal disclaimer. Always visible under the chat
          surface so every conversation is framed by the same guard-
          rail: we're an information service, not investment advice.
          Kept compact + in Residata's brand style so it reads as a
          product footer, not a scary modal. */}
      <div style={{
        marginTop: "0.85rem",
        padding: "0.65rem 0.85rem",
        background: "rgba(245,166,35,0.05)",
        border: "1px solid rgba(245,166,35,0.18)",
        borderRadius: 8,
        color: dim, fontSize: "0.72rem", lineHeight: 1.5,
      }}>
        <strong style={{ color: orange, fontFamily: mono, fontSize: "0.6rem", letterSpacing: "0.08em", textTransform: "uppercase", marginRight: "0.4rem" }}>
          {L("Právna poznámka", "Legal notice")}:
        </strong>
        {L(
          "Residata je informačná služba o trhu novostavieb. Odpovede AI asistenta nepredstavujú investičné, finančné ani právne poradenstvo. Pre konkrétne rozhodnutia o kúpe, predaji alebo investícii konzultuj s realitným alebo finančným poradcom.",
          "Residata is a market-information service for new-build residential real estate. AI answers do NOT constitute investment, financial or legal advice. For specific buying, selling or investment decisions consult a qualified real-estate or financial professional."
        )}
      </div>
    </div>
  );
}

function MessageBubble({ msg, lang, onRate }) {
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
        {/* 👍/👎 — assistant rows only, only when we have a log_id from the
            server (older clients without sessionId never get one, the row
            is anonymous in ai_chat_log so feedback would have nowhere to
            land). Optimistic toggle handled in useChat.rateMessage. */}
        {isAssistant && msg.log_id && onRate && (
          <FeedbackButtons msg={msg} onRate={onRate} lang={lang} />
        )}
      </div>
    </div>
  );
}

export function FeedbackButtons({ msg, onRate, lang }) {
  const tag = (active, color) => ({
    background: active ? `${color}1f` : "transparent",
    border: `1px solid ${active ? color : border}`,
    color: active ? color : dim,
    cursor: "pointer", padding: "0.18rem 0.42rem", borderRadius: 4,
    fontSize: "0.78rem", fontFamily: "inherit", lineHeight: 1,
    transition: "background 0.12s, border-color 0.12s, color 0.12s",
  });
  const isGood = msg.feedback === "good";
  const isBad  = msg.feedback === "bad";
  return (
    <div style={{
      display: "flex", gap: "0.35rem",
      marginTop: "0.5rem", paddingTop: "0.4rem",
      borderTop: `1px dashed ${border}`,
    }}>
      <button
        onClick={() => onRate(msg.log_id, "good")}
        title={lang === "sk" ? "Užitočné" : "Helpful"}
        aria-pressed={isGood}
        style={tag(isGood, green)}
      >
        👍
      </button>
      <button
        onClick={() => onRate(msg.log_id, "bad")}
        title={lang === "sk" ? "Nepresné / nepomohlo" : "Inaccurate / not helpful"}
        aria-pressed={isBad}
        style={tag(isBad, red)}
      >
        👎
      </button>
      {(isGood || isBad) && (
        <span style={{ fontSize: "0.66rem", color: dim, fontFamily: mono, alignSelf: "center", marginLeft: "0.2rem" }}>
          {lang === "sk" ? "ďakujeme za feedback" : "thanks for the feedback"}
        </span>
      )}
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
