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

const DAILY_LIMIT_BY_TIER = { anon: 3, free: 10, paid: 30, admin: 100 };

function storageKey(userId) { return `residata_chat_${userId || "anon"}`; }

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

    try {
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
        setError({ kind: "limit", text: j.error || L("Dosiahnutý denný limit.", "Daily limit reached.") });
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
  };
}

/** Regex used by UI layers to highlight the "general knowledge" disclosure marker. */
export const GENERAL_KNOWLEDGE_RE = /\[(všeobecná znalosť, nie dáta Residata|general knowledge, not Residata data)\]/gi;
