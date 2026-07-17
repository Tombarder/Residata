/**
 * FeedbackWidget — site-wide feedback launcher + panel, with CONVERSATIONS.
 *
 * Mounted once at the app root (App.jsx); appears on every page. Fixed
 * bottom-right (raised above the AI chat pill on marketing pages).
 *
 * Three views:
 *   · form   — write a NEW message (= a new conversation / topic)
 *   · mine   — logged-in users: list of their conversations
 *   · thread — one conversation in full (user + admin messages) + continue it
 *
 * New message → new conversation. Or open an existing one and continue it.
 * Logged-in callers attributed + ownership checked server-side.
 */
import { useRef, useState, useEffect } from "react";
import { useAuth } from "../lib/useAuth";
import { supabase } from "../lib/supabase";
import { cleanText, cleanEmail } from "../lib/sanitize";
import { getDiagnostics, capturePageScreenshot } from "../lib/diagnostics";

const mono   = "'JetBrains Mono', monospace";
const green  = "#00e5a0";
const amber  = "#f5a623";
const blue   = "#4a9eff";
const dim    = "var(--text-dim)";
const text   = "var(--text)";
const border = "var(--border)";
const bg     = "var(--bg)";
const bg2    = "var(--surface)";
const red    = "#ff6b6b";

const MAX_MESSAGE = 4000;
const MAX_SHOT_DATAURL = 3.6 * 1024 * 1024;

const CATEGORIES = [
  ["data",     "📊", "Kvalita dát",       "Data quality"],
  ["bug",      "🐞", "Chyba / nefunguje", "Bug / not working"],
  ["website",  "🖥️", "Web / zobrazenie",  "Website / display"],
  ["question", "❓", "Otázka",            "Question"],
  ["idea",     "💡", "Návrh / funkcia",   "Suggestion"],
  ["other",    "💬", "Iné",               "Other"],
];
const STATUS_META = {
  new:         [amber, "Nové",      "New"],
  in_progress: [blue,  "Rieši sa",  "In progress"],
  resolved:    [green, "Vyriešené", "Resolved"],
  wont_fix:    [dim,   "Zatvorené", "Closed"],
};

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
function detectProjectId() {
  if (typeof window === "undefined") return null;
  const p = window.location.pathname;
  const m = p.match(/^\/app\/projects\/([^/]+)/) || p.match(/^\/project\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
function downscaleImage(file, maxDim = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (Math.max(width, height) > maxDim) { const s = maxDim / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s); }
        const c = document.createElement("canvas"); c.width = width; c.height = height;
        c.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject; img.src = reader.result;
    };
    reader.onerror = reject; reader.readAsDataURL(file);
  });
}
const catMeta = (k) => CATEGORIES.find((x) => x[0] === k) || ["other", "💬", "Iné", "Other"];
const fmtDay = (s) => (s ? String(s).slice(0, 10) : "");

// ── Unread tracking (in-app "new reply" alert) ─────────────────────────────
// A conversation is "unread" when its last message is from admin and its
// activity timestamp is newer than the last time the user opened it. We persist
// the per-conversation "seen at" locally so the pill can show a badge WITHOUT a
// read-state column in the DB. Opening the thread marks it seen.
const FB_SEEN_KEY = "residata_fb_seen";
function loadSeen() { try { return JSON.parse(localStorage.getItem(FB_SEEN_KEY) || "{}"); } catch { return {}; } }
function markConvSeen(id, when) {
  if (!id) return;
  try { const s = loadSeen(); s[id] = when || new Date().toISOString(); localStorage.setItem(FB_SEEN_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
function countUnread(convs) {
  if (!Array.isArray(convs)) return 0;
  const seen = loadSeen();
  const ms = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) ? t : 0; };
  // Numeric compare — ISO "…Z" (our seen stamp) and Postgres timestamptz
  // "…+00:00" aren't safely string-comparable, so parse both to epoch ms.
  return convs.filter(c => c.last_sender === "admin" && (!seen[c.id] || ms(seen[c.id]) < ms(c.activity_at))).length;
}

export default function FeedbackWidget({ lang = "sk", raised = false }) {
  const L = (sk, en) => (lang === "sk" ? sk : en);
  const { user, profile, loading: authLoading } = useAuth();

  const [open, setOpen] = useState(false);
  const [view, setView] = useState("form");         // form | mine | thread
  const [category, setCategory] = useState(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [shotName, setShotName] = useState("");
  const [phase, setPhase] = useState("idle");        // idle | sending | done | error
  const [errorMsg, setErrorMsg] = useState("");
  const [mine, setMine] = useState(null);
  const [mineErr, setMineErr] = useState("");
  const [activeConv, setActiveConv] = useState(null);
  const [thread, setThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [continueMsg, setContinueMsg] = useState("");
  const [continuePhase, setContinuePhase] = useState("idle");
  const [continueErr, setContinueErr] = useState("");
  const [includeShot, setIncludeShot] = useState(true);  // auto page-screenshot + diagnostics
  const [unread, setUnread] = useState(0);               // # conversations with an unseen admin reply
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const pendingDeepLinkRef = useRef(null);   // ?feedback=<id> captured before auth resolves

  const accountEmail = user?.email || profile?.email || null;
  const loggedIn = !!user;
  // Offsets include the iOS home-bar / cutout inset so the pill + panel never
  // sit under the home indicator (env() is 0px on devices without a safe area).
  const bottom = raised ? "calc(78px + var(--safe-bottom))" : "calc(20px + var(--safe-bottom))";
  const msgLen = message.trim().length;

  function resetForm() { setCategory(null); setMessage(""); setEmail(""); setScreenshot(null); setShotName(""); setPhase("idle"); setErrorMsg(""); }
  function close() { setOpen(false); if (phase === "done") { resetForm(); setView("form"); } }
  function pickCategory(key) { setCategory(key); setTimeout(() => taRef.current?.focus(), 60); }

  // Recompute the pill's unread-reply badge from the user's conversations.
  async function refreshUnread() {
    if (!user || !supabase) { setUnread(0); return; }
    try {
      const { data } = await supabase.rpc("my_feedback");
      setUnread(countUnread(data));
    } catch { /* non-fatal — badge just stays as-is */ }
  }

  // Open the widget from ANYWHERE via window.dispatchEvent(new CustomEvent(
  // "residata:open-feedback", { detail: { category } })) — used by the Billing
  // "I have a question" button and any other in-app "ask us" affordance, so we
  // never fall back to an external mailto.
  useEffect(() => {
    function onOpenEvent(e) {
      setView("form"); setPhase("idle"); setOpen(true);
      const cat = e?.detail?.category;
      if (cat) { setCategory(cat); setTimeout(() => taRef.current?.focus(), 90); }
    }
    window.addEventListener("residata:open-feedback", onOpenEvent);
    return () => window.removeEventListener("residata:open-feedback", onOpenEvent);
  }, []);

  // Deep-link from the reply email: /app?feedback=<conversationId>. Capture it on
  // mount and strip the param, but DON'T open the thread yet — this is typically a
  // cold page load (the user just clicked an email link) where auth is still
  // hydrating, so my_conversation would run as anon and RLS would deny it. We open
  // it in the next effect, once auth has resolved.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const fid = p.get("feedback");
    if (!fid) return;
    setOpen(true);
    if (fid === "new") setView("form");
    else { setView("mine"); pendingDeepLinkRef.current = fid; }
    p.delete("feedback");
    const q = p.toString();
    window.history.replaceState({}, "", window.location.pathname + (q ? `?${q}` : "") + window.location.hash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open the captured deep-linked thread ONCE auth has settled — my_conversation
  // is RLS-gated to the owner, so it needs the resolved session. If auth finishes
  // with no user (link opened logged-out), drop to the form; the thread is still
  // reachable via "My conversations" after they log in.
  useEffect(() => {
    const fid = pendingDeepLinkRef.current;
    if (!fid || authLoading) return;
    pendingDeepLinkRef.current = null;
    if (user) openThread(fid);
    else setView("form");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  // Keep the unread badge fresh: on mount, when auth resolves, and whenever the
  // tab regains focus (that's when an admin reply most likely arrived).
  useEffect(() => {
    refreshUnread();
    const onFocus = () => refreshUnread();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function processImageFile(file) {
    if (!file || !file.type.startsWith("image/")) { setErrorMsg(L("Vyber prosím obrázok.", "Please pick an image.")); return; }
    try {
      const dataUrl = await downscaleImage(file);
      if (dataUrl.length > MAX_SHOT_DATAURL) { setErrorMsg(L("Obrázok je príliš veľký — skús menší výrez.", "Image too large — try a smaller area.")); return; }
      setScreenshot(dataUrl); setShotName(file.name || "screenshot.png"); setErrorMsg("");
    } catch { setErrorMsg(L("Obrázok sa nepodarilo načítať.", "Couldn't read that image.")); }
  }
  function onPickFile(e) { const f = e.target.files?.[0]; if (f) processImageFile(f); e.target.value = ""; }
  function onPaste(e) {
    const items = e.clipboardData?.items; if (!items) return;
    for (const it of items) { if (it.type && it.type.startsWith("image/")) { const f = it.getAsFile(); if (f) { e.preventDefault(); processImageFile(f); return; } } }
  }

  const canSend = !!category && cleanText(message, { max: MAX_MESSAGE }).length >= 2 && phase !== "sending";

  async function submit() {
    if (!canSend) return;
    setPhase("sending"); setErrorMsg("");
    const token = storedAccessToken();
    const payload = {
      category, message: cleanText(message, { max: MAX_MESSAGE }),
      page_path: typeof window !== "undefined" ? window.location.pathname : null,
      page_url: typeof window !== "undefined" ? window.location.href : null,
      app_lang: lang === "sk" ? "sk" : "en",
    };
    const pid = detectProjectId(); if (pid) payload.project_id = pid;
    if (screenshot) payload.screenshot = screenshot;
    if (!accountEmail) { const e = cleanEmail(email); if (e) payload.email = e; }
    let shot = { url: null, error: null };
    if (includeShot) shot = await capturePageScreenshot();
    payload.diagnostics = getDiagnostics(shot.error ? { screenshot_error: shot.error } : {});
    if (shot.url) payload.auto_screenshot = shot.url;
    try {
      const headers = { "Content-Type": "application/json" }; if (token) headers.Authorization = `Bearer ${token}`;
      const r = await fetch("/api/feedback/submit", { method: "POST", headers, body: JSON.stringify(payload) });
      if (r.status === 429) { setPhase("error"); setErrorMsg(L("Priveľa správ za chvíľu — skús o minútu.", "Too many messages — try again in a minute.")); return; }
      if (r.status === 413) { setPhase("error"); setErrorMsg(L("Príloha je príliš veľká.", "Attachment too large.")); return; }
      if (!r.ok) { setPhase("error"); setErrorMsg(L("Nepodarilo sa odoslať. Skús to znova.", "Couldn't send. Please try again.")); return; }
      setPhase("done");
    } catch { setPhase("error"); setErrorMsg(L("Nepodarilo sa odoslať. Skús to znova.", "Couldn't send. Please try again.")); }
  }
  function onMsgKey(e) { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }

  async function loadMine() {
    setView("mine"); setMine(null); setMineErr("");
    if (!supabase) { setMineErr(L("Nedostupné.", "Unavailable.")); return; }
    const { data, error } = await supabase.rpc("my_feedback");
    if (error) { setMineErr(error.message); setMine([]); } else setMine(Array.isArray(data) ? data : []);
  }
  async function openThread(id) {
    setActiveConv(id); setView("thread"); setThread(null); setThreadLoading(true); setContinueMsg(""); setContinueErr(""); setContinuePhase("idle");
    markConvSeen(id); setUnread((n) => Math.max(0, n - 1));   // opening it clears its unread state
    if (!supabase) { setThreadLoading(false); return; }
    const { data, error } = await supabase.rpc("my_conversation", { p_id: id });
    setThreadLoading(false);
    if (error) setContinueErr(error.message); else { setThread(data); refreshUnread(); }
  }
  async function sendContinue() {
    const txt = cleanText(continueMsg, { max: MAX_MESSAGE });
    if (txt.length < 2 || !activeConv) return;
    setContinuePhase("sending"); setContinueErr("");
    let shot = { url: null, error: null };
    if (includeShot) shot = await capturePageScreenshot();
    const payload = { conversation_id: activeConv, message: txt, app_lang: lang === "sk" ? "sk" : "en", page_path: typeof window !== "undefined" ? window.location.pathname : null, page_url: typeof window !== "undefined" ? window.location.href : null, diagnostics: getDiagnostics(shot.error ? { screenshot_error: shot.error } : {}) };
    if (shot.url) payload.auto_screenshot = shot.url;
    try {
      const token = storedAccessToken();
      const r = await fetch("/api/feedback/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      if (!r.ok) { setContinuePhase("error"); setContinueErr(L("Nepodarilo sa odoslať.", "Couldn't send.")); return; }
      setContinueMsg(""); setContinuePhase("idle");
      const { data } = await supabase.rpc("my_conversation", { p_id: activeConv });
      setThread(data);
    } catch { setContinuePhase("error"); setContinueErr(L("Nepodarilo sa odoslať.", "Couldn't send.")); }
  }

  // ── Launcher pill ──────────────────────────────────────────────
  if (!open) {
    return (
      <button onClick={() => { setOpen(true); if (unread > 0) loadMine(); }} aria-label={L("Nahlásiť problém alebo návrh", "Report a problem or suggestion")} className="residata-fb-pill" data-rbf-ignore
        style={{ position: "fixed", right: "calc(20px + var(--safe-right))", bottom, height: 40, padding: "0 14px 0 12px", borderRadius: 20, border: `1px solid rgba(0,229,160,0.55)`, background: bg2, color: text, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "0.5rem", fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 600, letterSpacing: "-0.005em", zIndex: "var(--z-pill)", animation: "rbf-glow 2.4s ease-in-out infinite" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={green} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        <span>{unread > 0 ? L("Nová odpoveď", "New reply") : L("Spätná väzba", "Feedback")}</span>
        {unread > 0 && (
          <span aria-label={L("nové odpovede", "new replies")} style={{
            position: "absolute", top: -7, right: -7, minWidth: 19, height: 19, padding: "0 5px",
            borderRadius: 10, background: "#ff4d4d", color: "#fff", fontSize: "0.64rem", fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono,
            border: "2px solid var(--surface)", lineHeight: 1,
          }}>{unread > 9 ? "9+" : unread}</span>
        )}
        <style>{`
          @keyframes rbf-glow { 0%,100% { box-shadow: 0 6px 18px rgba(0,0,0,0.4), 0 0 0 0 rgba(0,229,160,0); } 50% { box-shadow: 0 8px 22px rgba(0,0,0,0.45), 0 0 22px 3px rgba(0,229,160,0.45); } }
          .residata-fb-pill { transition: transform .18s, border-color .18s, background .18s; }
          .residata-fb-pill:hover { transform: translateY(-1px); border-color: ${green}; background: var(--surface-2); animation-play-state: paused; box-shadow: 0 10px 28px rgba(0,0,0,0.55), 0 0 28px 5px rgba(0,229,160,0.55), 0 0 0 1px rgba(0,229,160,0.3) inset; }
          @media (prefers-reduced-motion: reduce) { .residata-fb-pill { animation: none; box-shadow: 0 6px 18px rgba(0,0,0,0.4), 0 0 16px 2px rgba(0,229,160,0.35); } }
        `}</style>
      </button>
    );
  }

  // ── Panel ──────────────────────────────────────────────────────
  const stepLabel = { color: dim, fontFamily: mono, fontSize: "0.62rem", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" };
  const stepNum = { color: green, fontWeight: 700 };
  const tabStyle = (active) => ({ flex: 1, padding: "0.5rem 0.6rem", cursor: "pointer", background: "transparent", border: "none", color: active ? text : dim, fontFamily: "inherit", fontSize: "0.78rem", fontWeight: active ? 700 : 500, borderBottom: `2px solid ${active ? green : "transparent"}` });

  function Bubble({ m }) {
    const isUser = m.sender === "user";
    return (
      <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: "0.5rem" }}>
        <div style={{ maxWidth: "86%", background: isUser ? "rgba(0,229,160,0.1)" : "var(--surface-2)", border: `1px solid ${isUser ? "rgba(0,229,160,0.28)" : border}`, borderRadius: 10, padding: "0.5rem 0.65rem" }}>
          <div style={{ fontFamily: mono, fontSize: "0.56rem", color: isUser ? green : dim, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>
            {isUser ? L("Ty", "You") : "Residata"} · {(m.created_at || "").slice(5, 16).replace("T", " ")}
          </div>
          <div style={{ fontSize: "0.83rem", color: text, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
          {m.has_attachment && <div style={{ marginTop: 4, fontSize: "0.66rem", fontFamily: mono, color: dim }}>📎 screenshot</div>}
        </div>
      </div>
    );
  }

  return (
    <div onPaste={onPaste} data-rbf-ignore style={{ position: "fixed", right: "calc(20px + var(--safe-right))", bottom, width: "min(400px, calc(100vw - 32px))", maxHeight: "min(680px, calc(100svh - var(--nav-h, 72px) - var(--safe-bottom) - 40px))", background: bg2, border: `1px solid ${border}`, borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.65)", display: "flex", flexDirection: "column", zIndex: "var(--z-pill)", animation: "rbf-panel 0.2s ease-out" }}>
      <style>{`
        @keyframes rbf-panel { from {opacity:0; transform:translateY(12px);} to {opacity:1; transform:translateY(0);} }
        @keyframes rbf-pop { 0% {transform:scale(0.6); opacity:0;} 60% {transform:scale(1.08);} 100% {transform:scale(1); opacity:1;} }
        .rbf-cat { transition: border-color .15s, background .15s, color .15s, transform .12s; }
        .rbf-cat:hover { border-color: rgba(0,229,160,0.45) !important; transform: translateY(-1px); }
        .rbf-send:not(:disabled):hover { filter: brightness(1.08); }
        .rbf-conv:hover { border-color: rgba(0,229,160,0.4) !important; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "0.85rem 0.95rem", display: "flex", alignItems: "center", gap: "0.6rem", borderBottom: `1px solid ${border}`, background: "linear-gradient(180deg, rgba(0,229,160,0.08), transparent)", borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: green, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0a0a0b" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: text, fontWeight: 700, fontSize: "0.92rem", letterSpacing: "-0.01em" }}>{L("Spätná väzba", "Feedback")}</div>
          <div style={{ color: dim, fontSize: "0.7rem", lineHeight: 1.3 }}>{L("Pomôž nám zlepšiť Residatu", "Help us make Residata better")}</div>
        </div>
        <button onClick={close} title={L("Zavrieť", "Close")} aria-label={L("Zavrieť", "Close")} style={{ background: "transparent", border: `1px solid ${border}`, color: dim, borderRadius: 7, cursor: "pointer", padding: "0.3rem 0.55rem", fontSize: "0.75rem", fontFamily: mono, lineHeight: 1 }}
          onMouseEnter={e => { e.currentTarget.style.color = red; e.currentTarget.style.borderColor = red; }} onMouseLeave={e => { e.currentTarget.style.color = dim; e.currentTarget.style.borderColor = border; }}>✕</button>
      </div>

      {/* Tabs (logged-in) */}
      {loggedIn && phase !== "done" && (
        <div style={{ display: "flex", borderBottom: `1px solid ${border}` }}>
          <button style={tabStyle(view === "form")} onClick={() => setView("form")}>{L("Napísať", "Write")}</button>
          <button style={tabStyle(view === "mine" || view === "thread")} onClick={loadMine}>{L("Moje konverzácie", "My conversations")}</button>
        </div>
      )}

      {/* Body */}
      <div style={{ padding: "1rem 1rem 1.1rem", overflowY: "auto" }}>
        {view === "thread" ? (
          /* ── One conversation ─────────────────────────────────── */
          <>
            <button onClick={() => setView("mine")} style={{ background: "transparent", border: "none", color: dim, cursor: "pointer", fontSize: "0.76rem", fontFamily: mono, padding: 0, marginBottom: "0.7rem" }}>← {L("Späť na konverzácie", "Back to conversations")}</button>
            {threadLoading && <div style={{ color: dim, fontFamily: mono, fontSize: "0.78rem" }}>{L("Načítavam…", "Loading…")}</div>}
            {continueErr && <div style={{ color: amber, fontSize: "0.78rem", marginBottom: "0.5rem" }}>{continueErr}</div>}
            {thread && (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "0.8rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.76rem", color: "var(--text-2)" }}>{catMeta(thread.category)[1]} {L(catMeta(thread.category)[2], catMeta(thread.category)[3])}</span>
                  {(() => { const s = STATUS_META[thread.status] || STATUS_META.new; return <span style={{ fontSize: "0.6rem", fontFamily: mono, color: s[0], border: `1px solid ${s[0]}`, borderRadius: 100, padding: "1px 8px", textTransform: "uppercase", letterSpacing: 0.4 }}>{L(s[1], s[2])}</span>; })()}
                </div>
                <div style={{ marginBottom: "0.85rem" }}>
                  {(thread.messages || []).map((m, i) => <Bubble key={i} m={m} />)}
                </div>
                <textarea value={continueMsg} onChange={(e) => setContinueMsg(e.target.value.slice(0, MAX_MESSAGE))}
                  placeholder={L("Napíš ďalšiu správu…", "Write a follow-up…")} rows={2}
                  style={{ width: "100%", boxSizing: "border-box", background: bg, border: `1px solid ${border}`, borderRadius: 10, color: text, fontFamily: "inherit", fontSize: "0.84rem", lineHeight: 1.5, padding: "0.55rem 0.65rem", resize: "vertical", outline: "none" }} />
                <button className="rbf-send" onClick={sendContinue} disabled={continuePhase === "sending" || cleanText(continueMsg, { max: MAX_MESSAGE }).length < 2}
                  style={{ marginTop: "0.6rem", width: "100%", background: cleanText(continueMsg, { max: MAX_MESSAGE }).length >= 2 ? green : "var(--surface-3)", color: cleanText(continueMsg, { max: MAX_MESSAGE }).length >= 2 ? "#0a0a0c" : dim, border: "none", borderRadius: 10, padding: "0.6rem", fontWeight: 700, fontFamily: mono, fontSize: "0.8rem", cursor: cleanText(continueMsg, { max: MAX_MESSAGE }).length >= 2 ? "pointer" : "not-allowed" }}>
                  {continuePhase === "sending" ? L("Odosielam…", "Sending…") : `${L("Odoslať", "Send")} →`}
                </button>
              </>
            )}
          </>
        ) : view === "mine" ? (
          /* ── My conversations ─────────────────────────────────── */
          <>
            {mineErr && <div style={{ color: amber, fontSize: "0.8rem", marginBottom: "0.6rem" }}>{mineErr}</div>}
            {mine === null && <div style={{ color: dim, fontFamily: mono, fontSize: "0.78rem" }}>{L("Načítavam…", "Loading…")}</div>}
            {mine && mine.length === 0 && (
              <div style={{ color: dim, fontSize: "0.83rem", textAlign: "center", padding: "1.4rem 0.5rem" }}>
                {L("Zatiaľ žiadna konverzácia. Napíš nám čokoľvek!", "No conversations yet. Tell us anything!")}
              </div>
            )}
            {mine && mine.map((c) => {
              const cm = catMeta(c.category); const s = STATUS_META[c.status] || STATUS_META.new;
              const newForUser = c.last_sender === "admin";
              return (
                <button key={c.id} className="rbf-conv" onClick={() => openThread(c.id)}
                  style={{ display: "block", width: "100%", textAlign: "left", border: `1px solid ${border}`, borderRadius: 10, padding: "0.7rem 0.8rem", marginBottom: "0.6rem", background: bg, cursor: "pointer", transition: "border-color .15s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: "0.35rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.74rem", color: "var(--text-2)" }}>{cm[1]} {L(cm[2], cm[3])}</span>
                    <span style={{ fontSize: "0.58rem", fontFamily: mono, color: s[0], border: `1px solid ${s[0]}`, borderRadius: 100, padding: "1px 7px", textTransform: "uppercase", letterSpacing: 0.4 }}>{L(s[1], s[2])}</span>
                    {newForUser && <span style={{ fontSize: "0.58rem", fontFamily: mono, color: green }}>● {L("nová odpoveď", "new reply")}</span>}
                    <span style={{ marginLeft: "auto", fontSize: "0.6rem", fontFamily: mono, color: dim }}>{fmtDay(c.activity_at)}</span>
                  </div>
                  <div style={{ fontSize: "0.8rem", color: text, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {c.last_sender === "admin" ? "↩ " : ""}{c.last_body}
                  </div>
                  <div style={{ marginTop: "0.3rem", fontSize: "0.62rem", fontFamily: mono, color: dim }}>
                    {c.msg_count} {c.msg_count === 1 ? L("správa", "message") : L("správ", "messages")} · {L("otvoriť →", "open →")}
                  </div>
                </button>
              );
            })}
            <button onClick={() => setView("form")} style={{ marginTop: "0.3rem", width: "100%", background: green, border: "none", color: "#0a0a0c", borderRadius: 9, padding: "0.6rem", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700, fontFamily: mono }}>
              + {L("Nová správa", "New message")}
            </button>
          </>
        ) : phase === "done" ? (
          /* ── Success ───────────────────────────────────────────── */
          <div style={{ textAlign: "center", padding: "1.6rem 0.5rem 1.2rem" }}>
            <div style={{ width: 52, height: 52, borderRadius: "50%", background: "rgba(0,229,160,0.14)", border: `1px solid ${green}`, margin: "0 auto 0.85rem", display: "flex", alignItems: "center", justifyContent: "center", animation: "rbf-pop 0.35s ease-out" }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={green} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div style={{ color: text, fontWeight: 700, fontSize: "1rem", marginBottom: "0.4rem" }}>{L("Ďakujeme! 🙌", "Thank you! 🙌")}</div>
            <div style={{ color: dim, fontSize: "0.83rem", lineHeight: 1.55, marginBottom: "1.2rem", maxWidth: 280, marginLeft: "auto", marginRight: "auto" }}>
              {loggedIn
                ? L("Máme to. Odpoveď uvidíš tu v „Moje konverzácie“ aj e-mailom.", "Got it. You'll see our reply here under \"My conversations\" and by email.")
                : L("Máme to a pozrieme sa na to. Ak to bude treba, ozveme sa ti.", "We've got it and we'll take a look. We'll reach out if needed.")}
            </div>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
              <button onClick={resetForm} style={{ background: green, border: "none", color: "#0a0a0c", borderRadius: 9, padding: "0.55rem 1rem", cursor: "pointer", fontSize: "0.82rem", fontWeight: 700, fontFamily: mono }}>{L("Poslať ďalšiu", "Send another")}</button>
              {loggedIn && <button onClick={() => { resetForm(); loadMine(); }} style={{ background: "transparent", border: `1px solid ${border}`, color: text, borderRadius: 9, padding: "0.55rem 1rem", cursor: "pointer", fontSize: "0.82rem", fontFamily: "inherit" }}>{L("Moje konverzácie", "My conversations")}</button>}
            </div>
          </div>
        ) : (
          /* ── Form (new conversation) ───────────────────────────── */
          <>
            <div style={{ color: "var(--text-2)", fontSize: "0.84rem", lineHeight: 1.55, marginBottom: "1.1rem" }}>
              {L("Daj nám vedieť čokoľvek — ak niečo nefunguje, ak vieš o aktívnej novostavbe, ktorá nám chýba, alebo máš otázku či nápad na novú funkciu, ktorú by si uvítal. Tie najlepšie veľmi radi pridáme. 🙌",
                 "Tell us anything — if something's not working, if you know an active new-build we're missing, or if you have a question or a feature you'd love to see. We're always glad to add the best ones. 🙌")}
            </div>

            <div style={stepLabel}><span style={stepNum}>1</span> {L("O čom to je?", "What's it about?")}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "1.15rem" }}>
              {CATEGORIES.map(([key, emoji, sk, en]) => {
                const on = category === key;
                return (
                  <button key={key} className="rbf-cat" onClick={() => pickCategory(key)} aria-pressed={on}
                    style={{ display: "flex", alignItems: "center", gap: "0.5rem", textAlign: "left", padding: "0.62rem 0.65rem", borderRadius: 10, cursor: "pointer", border: `1px solid ${on ? green : border}`, background: on ? "rgba(0,229,160,0.1)" : bg, color: on ? green : "var(--text-2)", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: on ? 600 : 500 }}>
                    <span style={{ fontSize: "1.05rem", lineHeight: 1 }} aria-hidden="true">{emoji}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{L(sk, en)}</span>
                    {on && <span aria-hidden="true" style={{ color: green, fontSize: "0.8rem", fontWeight: 700 }}>✓</span>}
                  </button>
                );
              })}
            </div>

            <div style={stepLabel}><span style={stepNum}>2</span> {L("Tvoja správa", "Your message")}</div>
            <textarea ref={taRef} value={message} onChange={e => setMessage(e.target.value.slice(0, MAX_MESSAGE))} onKeyDown={onMsgKey}
              placeholder={L("Napíš nám, čo máš na srdci…", "Write us what's on your mind…")} rows={4}
              style={{ width: "100%", boxSizing: "border-box", minHeight: 92, maxHeight: 220, background: bg, border: `1px solid ${border}`, borderRadius: 10, color: text, fontFamily: "inherit", fontSize: "0.85rem", lineHeight: 1.5, padding: "0.6rem 0.7rem", resize: "vertical", outline: "none" }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(0,229,160,0.5)"; }} onBlur={e => { e.currentTarget.style.borderColor = border; }} />
            <div style={{ marginTop: "0.35rem", color: dim, fontSize: "0.62rem", fontFamily: mono, textAlign: "right" }}>{msgLen} / {MAX_MESSAGE}</div>

            <div style={{ ...stepLabel, marginTop: "0.85rem", marginBottom: "0.4rem" }}><span style={stepNum}>3</span> {L("Screenshot", "Screenshot")} · {L("nepovinné", "optional")}</div>
            {screenshot ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", border: `1px solid ${border}`, borderRadius: 10, padding: "0.5rem 0.6rem", background: bg }}>
                <img src={screenshot} alt="" style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 6, border: `1px solid ${border}` }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: "0.74rem", color: dim, fontFamily: mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shotName}</span>
                <button onClick={() => { setScreenshot(null); setShotName(""); }} title={L("Odstrániť", "Remove")} style={{ background: "transparent", border: `1px solid ${border}`, color: dim, borderRadius: 6, cursor: "pointer", padding: "0.25rem 0.5rem", fontSize: "0.72rem", fontFamily: mono }}>✕</button>
              </div>
            ) : (
              <>
                <button onClick={() => fileRef.current?.click()} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.45rem", background: bg, border: `1px dashed ${border}`, color: "var(--text-2)", borderRadius: 10, padding: "0.65rem", cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(0,229,160,0.5)"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = border; }}>
                  <span aria-hidden="true">📎</span> {L("Vložiť (Ctrl/⌘+V) alebo nahrať obrázok", "Paste (Ctrl/⌘+V) or upload an image")}
                </button>
                <input ref={fileRef} type="file" accept="image/*" onChange={onPickFile} style={{ display: "none" }} />
                <div style={{ marginTop: "0.45rem", color: dim, fontSize: "0.66rem", lineHeight: 1.5 }}>
                  {L("Screenshot nám veľmi pomôže. Ako naň:", "A screenshot helps us a lot. How to take one:")}<br />
                  <span style={{ fontFamily: mono }}>Mac: ⌘ + Shift + 4</span> · <span style={{ fontFamily: mono }}>Windows: ⊞ + Shift + S</span>
                </div>
              </>
            )}

            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", marginTop: "0.8rem", cursor: "pointer", color: dim, fontSize: "0.68rem", lineHeight: 1.5 }}>
              <input type="checkbox" checked={includeShot} onChange={e => setIncludeShot(e.target.checked)} style={{ marginTop: 2, accentColor: green }} />
              <span>{L("Automaticky priložiť screenshot tejto stránky + technické info (chyby, prehliadač) — pomôže nám rýchlo nájsť problém.", "Automatically attach a screenshot of this page + technical info (errors, browser) — helps us find the problem fast.")}</span>
            </label>

            {!accountEmail && (
              <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder={L("E-mail (nepovinné, ak chceš odpoveď)", "Email (optional, if you want a reply)")}
                style={{ width: "100%", boxSizing: "border-box", marginTop: "0.7rem", background: bg, border: `1px solid ${border}`, borderRadius: 10, color: text, fontFamily: "inherit", fontSize: "0.82rem", padding: "0.55rem 0.7rem", outline: "none" }} />
            )}

            {phase === "error" && <div style={{ marginTop: "0.7rem", color: red, fontSize: "0.78rem", fontFamily: mono, display: "flex", alignItems: "center", gap: "0.35rem" }}><span aria-hidden="true">⚠</span> {errorMsg}</div>}

            <button className="rbf-send" onClick={submit} disabled={!canSend}
              style={{ marginTop: "1rem", width: "100%", background: canSend ? green : "var(--surface-3)", color: canSend ? "#0a0a0c" : dim, border: "none", borderRadius: 10, padding: "0.7rem 0.8rem", fontWeight: 700, fontFamily: mono, fontSize: "0.82rem", cursor: canSend ? "pointer" : "not-allowed", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}>
              {phase === "sending" ? L("Odosielam…", "Sending…") : <>{L("Odoslať", "Send")} <span aria-hidden="true">→</span></>}
            </button>

            <div style={{ marginTop: "0.6rem", color: dim, fontSize: "0.64rem", fontFamily: mono, textAlign: "center", lineHeight: 1.5 }}>
              {accountEmail ? L(`Odosielaš ako ${accountEmail}`, `Sending as ${accountEmail}`) : L("Anonymné, ak nevyplníš e-mail", "Anonymous unless you add an email")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
