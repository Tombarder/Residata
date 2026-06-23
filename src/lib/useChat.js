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
const DAILY_LIMIT_BY_TIER = { anon: 1, free: 3, paid: 15, admin: 100 };

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

/* Get the access token without EVER hanging. supabase.auth.getSession() can
   deadlock on a stuck gotrue token-refresh (the documented "stuck loading until
   a full refresh" bug) — and chat awaited it before every send, so a deadlocked
   refresh meant the question never left the browser. We race getSession() against
   a short timeout and, on timeout, read the persisted session token straight from
   localStorage (no refresh, no hang). A slightly-stale token is fine: the server
   validates it and returns 401 if expired, which the UI already handles. */
async function getAccessTokenSafe() {
  try {
    const viaApi = supabase.auth.getSession()
      .then(r => r?.data?.session?.access_token || null)
      .catch(() => null);
    const timeout = new Promise(res => setTimeout(() => res("__timeout__"), 3000));
    const r = await Promise.race([viaApi, timeout]);
    if (r !== "__timeout__") return r;
  } catch (_) {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) {
        const v = JSON.parse(localStorage.getItem(k) || "null");
        return v?.access_token || v?.currentSession?.access_token || null;
      }
    }
  } catch (_) {}
  return null;
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

  // F-318 (DP-097): removed dead `cancelRef = useRef(false)` — it was
  // declared but never set or read anywhere. Was likely intended to gate
  // in-flight cancellation on unmount, but the post-unmount state-update
  // is harmless (React 18 suppresses the warning) and the fetch always
  // completes server-side regardless. If a future feature needs real
  // cancellation, use an AbortController in send() with signal passed
  // to fetch.

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

  // Persist + reload the conversation, keyed by user-id, in ONE effect so the
  // two can't race. The old two-effect version wiped the transcript on every
  // navigation: when the user identity resolves a moment after first paint (or
  // on remount), the save effect ran first and wrote the empty initial messages
  // over that user's stored history, then the reload read the now-empty key.
  // Here, when the identity CHANGES we reload that identity's history and do NOT
  // persist the stale messages; same-user message changes just save.
  const msgsUserRef = useRef(user?.id);
  useEffect(() => {
    if (msgsUserRef.current !== user?.id) {
      msgsUserRef.current = user?.id;
      try {
        const raw = localStorage.getItem(storageKey(user?.id));
        setMessages(raw ? (JSON.parse(raw) || []).slice(-40) : []);
      } catch { setMessages([]); }
      return; // don't overwrite the just-loaded history with pre-reload state
    }
    try {
      localStorage.setItem(storageKey(user?.id), JSON.stringify(messages.slice(-40)));
    } catch (_) {}
  }, [messages, user?.id]);

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
      const tokenSafe = await getAccessTokenSafe();   // never hangs (auth-deadlock guard)
      if (tokenSafe) headers.Authorization = `Bearer ${tokenSafe}`;

      // Abort guard: a hung request can never spin forever. 90s leaves margin
      // over the server's 60s budget; on timeout the catch shows a retry hint.
      const ac = new AbortController();
      const abortTimer = setTimeout(() => ac.abort(), 90000);
      let r;
      try {
        r = await fetch("/api/ai/chat", {
          method: "POST", headers, signal: ac.signal,
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
      } finally {
        clearTimeout(abortTimer);
      }
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
      // log_id ties this assistant message to its row in ai_chat_log
      // so the 👍/👎 buttons can PATCH /api/ai/chat-feedback with the
      // right id. Older clients without sessionId never get a log_id
      // (server skips the log row), feedback affordance hides itself.
      setMessages(prev => [...prev, {
        role: "assistant",
        content: j.text || "",
        log_id: j.log_id || null,
        feedback: null,
      }]);
      setRemaining(j.remaining || null);
      track("chat_answer", { tier: j.tier, remaining: j.remaining?.today ?? null });
    } catch (e) {
      const aborted = e?.name === "AbortError";
      const text = aborted
        ? L("Otázka trvala príliš dlho — skús to znova.", "That took too long — please try again.")
        : String(e?.message || e);
      setError({ kind: "err", text });
      setMessages(prev => [...prev.slice(0, -1), { role: "user", content: q, error: text }]);
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
    L("Koľko bytov je aktuálne na trhu?", "How many units are on the market right now?"),
    L("Ktorý okres je cenovo najdrahší?", "Which district is the most expensive?"),
  ] : [
    L("Koľko novostavbových bytov sa teraz sleduje?", "How many new-build units are currently tracked?"),
    L("Koľko projektov je v aktívnej ponuke?", "How many projects are actively selling?"),
    L("Ktorý okres je cenovo najvyšší?", "Which district has the highest prices?"),
  ];

  /* rateMessage — handles 👍/👎 clicks next to an assistant message.
     Optimistic UI: flips the local feedback state immediately, then
     fires the PATCH. On server failure we revert the local state and
     bubble a non-blocking warning so the user knows. Same rating
     re-clicked = clear (toggle off). */
  const rateMessage = async (logId, rating) => {
    if (!logId) return;
    if (rating !== "good" && rating !== "bad") return;
    // Snapshot previous state for rollback on server failure
    let prev = null;
    setMessages(curr => curr.map(m => {
      if (m.log_id !== logId) return m;
      prev = m.feedback;
      // Toggle: clicking the same rating clears it, otherwise replaces.
      const next = m.feedback === rating ? null : rating;
      return { ...m, feedback: next };
    }));
    const nextValue = prev === rating ? null : rating;
    try {
      const headers = { "Content-Type": "application/json" };
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      } catch (_) {}
      const r = await fetch("/api/ai/chat-feedback", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          log_id: logId,
          session_id: sessionIdRef.current || getOrCreateSessionId(user?.id),
          feedback: nextValue,   // null clears the rating
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      track("chat_feedback", { rating: nextValue, log_id: logId });
    } catch (e) {
      // Rollback the optimistic state
      setMessages(curr => curr.map(m => m.log_id === logId ? { ...m, feedback: prev } : m));
      console.warn("[useChat] rate failed, reverted:", e?.message || e);
    }
  };

  return {
    messages, input, setInput, pending, error, remaining,
    tier, dailyLimit, suggestedQuestions,
    send, clear, setError,
    // Chat UI calls this on textarea focus / first keystroke after
    // the previous send so we can measure user-side typing duration.
    markTypingStart,
    // Chat UI calls this on 👍/👎 click. Server PATCHes the row via
    // /api/ai/chat-feedback. Optimistic update + rollback on failure.
    rateMessage,
  };
}

/** Regex used by UI layers to highlight the "general knowledge" disclosure marker. */
export const GENERAL_KNOWLEDGE_RE = /\[(všeobecná znalosť, nie dáta Residata|general knowledge, not Residata data)\]/gi;
