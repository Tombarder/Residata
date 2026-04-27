/**
 * useChat — shared state + send-logic for Residata's grounded
 * chat assistant. Used by both the full /app/ask page and the
 * floating chat widget on the marketing site. Both surfaces talk
 * to the same /api/ai/chat endpoint so rate-limits, tier gating
 * and the ai_usage_log are consistent regardless of where the
 * user starts a conversation.
 *
 * Returns a stable API:
 *   { messages, input, setInput, pending, error, remaining,
 *     send, clear, suggestedQuestions }
 *
 * Persistence: messages live in localStorage per user-id so the
 * history survives tab close. The floating widget and the full
 * page read the same key — so if a user types a question in the
 * floating bubble then navigates to /app/ask, they see the same
 * conversation continue.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./useAuth";
import { useCapabilities } from "./useCapabilities";
import { track } from "./track";

// Mirror of server-side DAILY_LIMITS. If these get out of sync the
// UI will briefly show a stale quota label until the server's 429
// corrects it — still safe because the server is authoritative.
const DAILY_LIMIT_BY_TIER = { anon: 1, free: 3, paid: 30, admin: 100 };

function storageKey(userId)  { return `residata_chat_${userId || "anon"}`; }
function sessionKey(userId)  { return `residata_chat_session_${userId || "anon"}`; }

// RFC4122-ish UUID v4 — crypto.randomUUID is supported in modern browsers
// + Node 18+; fallback for older environments uses Math.random which is
// good enough for log grouping (we don't need cryptographic uniqueness).
function newSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getOrCreateSessionId(userId) {
  try {
    const k = sessionKey(userId);
    let s = localStorage.getItem(k);
    if (!s) {
      s = newSessionId();
      localStorage.setItem(k, s);
    }
    return s;
  } catch {
    return newSessionId();  // fallback for SSR / disabled storage
  }
}

function rotateSessionId(userId) {
  try { localStorage.removeItem(sessionKey(userId)); } catch (_) {}
  return getOrCreateSessionId(userId);
}

export function useChat({ lang = "sk" } = {}) {
  const { user } = useAuth();
  const { tier } = useCapabilities();
  const L = (sk, en) => lang === "sk" ? sk : en;

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
  const [remaining, setRemaining] = useState(null);
  const [error, setError] = useState(null);

  const cancelRef = useRef(false);

  // Session ID — UUID per "conversation". Created lazily on first
  // message + persisted in localStorage so a tab close → reload
  // continues the same session. clear() rotates it (= new session).
  const sessionIdRef = useRef(null);

  // User-typing timing — tracks how many ms elapsed between the user
  // FIRST starting to type this question (focus, or first keystroke
  // after the previous send) and pressing Send. Useful signal for
  // "deliberate question" vs "boilerplate test message". Reset on
  // every send. The Chat component is responsible for calling
  // markTypingStart() on focus / first keystroke.
  const typingStartRef = useRef(null);
  const markTypingStart = () => {
    if (typingStartRef.current == null) typingStartRef.current = Date.now();
  };

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(user?.id), JSON.stringify(messages.slice(-40)));
    } catch (_) {}
  }, [messages, user?.id]);

  // If the user logs in / out while the hook is mounted, reload
  // the conversation from THAT identity's history.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(user?.id));
      setMessages(raw ? (JSON.parse(raw) || []).slice(-40) : []);
    } catch { setMessages([]); }
  }, [user?.id]);

  const clear = () => {
    // Rotate session ID first so the optional "session_ended" log line
    // (if/when we add it) carries the OLD id; rotation kicks the next
    // send() into a fresh session.
    rotateSessionId(user?.id);
    sessionIdRef.current = null;
    setMessages([]); setError(null);
    try { localStorage.removeItem(storageKey(user?.id)); } catch (_) {}
    track("chat_cleared");
  };

  const send = async (textOverride) => {
    const q = (textOverride ?? input).trim();
    if (!q || pending) return;
    const nextMsgs = [...messages, { role: "user", content: q }];
    setMessages(nextMsgs);
    if (textOverride == null) setInput("");
    setPending(true);
    setError(null);
    track("chat_question", { tier, len: q.length });

    // Lazy-create session id on first message of a fresh chat.
    if (!sessionIdRef.current) {
      sessionIdRef.current = getOrCreateSessionId(user?.id);
    }
    // Snapshot typing duration BEFORE the network call so the value
    // sent to the server reflects user-side time only, not server
    // round-trip. Reset for the NEXT message.
    const typingMs = typingStartRef.current != null
      ? Math.max(0, Date.now() - typingStartRef.current)
      : null;
    typingStartRef.current = null;

    try {
      const headers = { "Content-Type": "application/json" };
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      } catch (_) {}

      const r = await fetch("/api/ai/chat", {
        method: "POST", headers,
        body: JSON.stringify({
          messages: nextMsgs.slice(-20),
          lang,
          sessionId: sessionIdRef.current,
          typingMs,
          pageUrl: typeof window !== "undefined" && window.location
            ? window.location.pathname + window.location.search
            : null,
        }),
      });
      if (r.status === 429) {
        const j = await r.json().catch(() => ({}));
        setError({
          kind: "limit",
          text: j.error || L("Dosiahnutý denný limit.", "Daily limit reached."),
          upgradeTo:     j.upgrade_to     || null,   // "free" | "paid" | null
          upgradeAction: j.upgrade_action || null,   // "sign_in" | "billing" | "contact"
          upgradeDaily:  j.upgrade_daily  || null,
          tier:          j.tier           || null,
        });
        setMessages(prev => prev.slice(0, -1));
        return;
      }
      if (r.status === 403) {
        setError({ kind: "auth", text: L("Prístup odmietnutý. Ak máš tier 'pending', počkaj na schválenie.", "Access denied. If your tier is 'pending', wait for approval.") });
        setMessages(prev => prev.slice(0, -1));
        return;
      }
      if (r.status === 501) {
        setError({ kind: "config", text: L("AI zatiaľ nie je zapnuté (chýba API kľúč).", "AI not yet enabled (API key missing).") });
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
      setError({ kind: "err", text: String(e?.message || e) });
      setMessages(prev => [...prev.slice(0, -1), { role: "user", content: q, error: String(e?.message || e) }]);
    } finally {
      setPending(false);
    }
  };

  const dailyLimit = DAILY_LIMIT_BY_TIER[tier] ?? 3;

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

  return {
    messages, input, setInput, pending, error, remaining,
    tier, dailyLimit, suggestedQuestions,
    send, clear, setError,
    // Chat UI calls this on textarea focus / first keystroke after
    // the previous send so we can measure user-side typing duration.
    markTypingStart,
  };
}

/** Regex used by UI layers to highlight the "general knowledge" disclosure marker. */
export const GENERAL_KNOWLEDGE_RE = /\[(všeobecná znalosť, nie dáta Residata|general knowledge, not Residata data)\]/gi;
