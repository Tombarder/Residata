/**
 * FeedbackLog — admin-only "Feedback / Spätná väzba" inbox, now CONVERSATIONS.
 *
 * Two views:
 *   · list   — the log of conversations (newest activity first), each showing the
 *     latest message + a "needs reply" flag + message count. This is the "log of
 *     each new message" — a new message bumps its conversation to the top.
 *   · thread — open a conversation to see the whole back-and-forth in one + reply
 *     (the reply is emailed to the user and appended to the thread).
 *
 * RPCs (admin-gated via public._require_admin):
 *   admin_feedback_stats() · admin_list_feedback() · admin_conversation(id)
 *   admin_update_feedback(id,status,note)   reply via /api/feedback/reply
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import Picker from "../components/Picker";

import { accent as green, accentInk, orange as amber, blue, text as textLight, dim, border, bg, surfaceDark as bg2, mono } from "../lib/theme";
const red = "#ff6b6b";

// ── "Normal theme" shared visual helpers (visual-only) ──────────────
const eyebrowBar = <span style={{ display: "inline-block", width: 3, height: 12, borderRadius: 2, background: "var(--accent)", marginRight: "0.5rem", verticalAlign: "middle" }} />;
const cardBar = (color) => <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: color, opacity: 0.85 }} />;
const tintBg = (color) => `linear-gradient(180deg, color-mix(in srgb, ${color} 9%, var(--surface)) 0%, var(--surface) 46%)`;
const C_GREEN = "#10b981", C_BLUE = "#3b74e8", C_AMBER = "#e0940f", C_SLATE = "#64748b";

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

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
async function rpcDirect(fn, body, { timeoutMs = 30000 } = {}) {
  const token = storedAccessToken();
  if (!token) throw new Error("Couldn't read your session — reload the page and sign in again.");
  const ctrl = new AbortController();
  const killer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/${fn}`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Content-Type": "application/json", apikey: SUPA_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
    });
    if (r.status === 401) throw new Error("session-expired");
    if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => "")).slice(0, 160)}`);
    return await r.json();
  } finally { clearTimeout(killer); }
}

const CATEGORIES = {
  data:     ["📊", "Data quality",      "Kvalita dát"],
  bug:      ["🐞", "Bug / not working", "Chyba / nefunguje"],
  website:  ["🖥️", "Website / display", "Web / zobrazenie"],
  question: ["❓", "Question",          "Otázka"],
  idea:     ["💡", "Suggestion",        "Návrh / funkcia"],
  other:    ["💬", "Other",             "Iné"],
};
const STATUSES = {
  new:         [amber, "New",         "Nové"],
  in_progress: [blue,  "In progress", "Rieši sa"],
  resolved:    [green, "Resolved",    "Vyriešené"],
  wont_fix:    [dim,   "Won't fix",   "Nebude sa riešiť"],
};
const STATUS_ORDER = ["new", "in_progress", "resolved", "wont_fix"];
const fmtDate = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");

export default function FeedbackLog({ lang = "sk" }) {
  const t = (en, sk) => (lang === "sk" ? sk : en);

  const [stats, setStats] = useState(null);
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [fStatus, setFStatus] = useState("");
  const [fCategory, setFCategory] = useState("");
  const [busy, setBusy] = useState({});
  const [openConv, setOpenConv] = useState(null);
  const [conv, setConv] = useState(null);
  const [convLoading, setConvLoading] = useState(false);
  const [note, setNote] = useState("");
  const [replyDraft, setReplyDraft] = useState("");
  const [replying, setReplying] = useState(false);
  const [diagOpen, setDiagOpen] = useState({});
  const [shotUrls, setShotUrls] = useState({});   // storage path -> signed URL

  const load = useCallback(() => {
    rpcDirect("admin_feedback_stats", {}).then(setStats).catch((e) => setErr(e.message));
    rpcDirect("admin_list_feedback", { p_status: fStatus || null, p_category: fCategory || null })
      .then((rows) => { setItems(rows || []); setErr(null); }).catch((e) => setErr(e.message));
  }, [fStatus, fCategory]);
  useEffect(() => { load(); }, [load]);

  async function openConversation(id) {
    setOpenConv(id); setConv(null); setConvLoading(true); setReplyDraft(""); setErr(null); setShotUrls({});
    try {
      const data = await rpcDirect("admin_conversation", { p_id: id });
      setConv(data); setNote(data?.admin_note || "");
      // sign every screenshot path so they render inline (no popups / window.open)
      const paths = [];
      (data?.messages || []).forEach((m) => { if (m.attachment_path) paths.push(m.attachment_path); if (m.auto_screenshot_path) paths.push(m.auto_screenshot_path); });
      if (paths.length && supabase) {
        const { data: signed } = await supabase.storage.from("feedback-attachments").createSignedUrls(paths, 3600);
        const map = {}; (signed || []).forEach((s) => { if (s && s.signedUrl && s.path) map[s.path] = s.signedUrl; });
        setShotUrls(map);
      }
    } catch (e) { setErr(e.message); }
    finally { setConvLoading(false); }
  }
  function backToList() { setOpenConv(null); setConv(null); load(); }

  async function setStatus(id, status) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await rpcDirect("admin_update_feedback", { p_id: id, p_status: status });
      setItems((list) => (list || []).map((x) => (x.id === id ? { ...x, status } : x)));
      if (conv && conv.id === id) setConv((c) => ({ ...c, status }));
      rpcDirect("admin_feedback_stats", {}).then(setStats).catch(() => {});
    } catch (e) { setErr(e.message); }
    finally { setBusy((b) => ({ ...b, [id]: false })); }
  }
  async function saveNote(id) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      await rpcDirect("admin_update_feedback", { p_id: id, p_note: note });
      if (conv && conv.id === id) setConv((c) => ({ ...c, admin_note: note }));
    } catch (e) { setErr(e.message); }
    finally { setBusy((b) => ({ ...b, [id]: false })); }
  }
  async function sendReply() {
    const txt = (replyDraft || "").trim();
    if (txt.length < 2 || !openConv) return;
    setReplying(true); setErr(null);
    try {
      const token = storedAccessToken();
      const r = await fetch("/api/feedback/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ feedback_id: openConv, reply: txt }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
      setReplyDraft("");
      const data = await rpcDirect("admin_conversation", { p_id: openConv });
      setConv(data);
    } catch (e) { setErr("Reply: " + e.message); }
    finally { setReplying(false); }
  }
  const cat = (k) => CATEGORIES[k] || CATEGORIES.other;
  const st = (k) => STATUSES[k] || STATUSES.new;

  const card = { background: bg2, border: `1px solid ${border}`, borderRadius: 10, padding: "12px 14px" };
  const cardLabel = { fontSize: 11, color: dim, fontFamily: mono, textTransform: "uppercase", letterSpacing: 0.4 };
  const cardVal = { fontSize: 22, fontWeight: 600, color: textLight, marginTop: 4 };
  const selStyle = { marginTop: 5, padding: "9px 12px", background: bg2, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 14, outline: "none" };
  const byCat = stats?.by_category || {};
  const catChips = useMemo(() => Object.keys(CATEGORIES), []);

  const diagBtn = { background: "transparent", border: `1px solid ${border}`, color: accentInk, borderRadius: 6, cursor: "pointer", padding: "3px 8px", fontSize: 12, fontFamily: mono };
  function renderDiag(d) {
    if (!d) return null;
    const evs = d.events || [];
    return (
      <div style={{ marginTop: 8, background: bg, border: `1px solid ${border}`, borderRadius: 8, padding: "9px 11px", fontFamily: mono, fontSize: 11, color: dim, lineHeight: 1.7 }}>
        {d.screenshot_error && <div style={{ color: amber, marginBottom: 4 }}>⚠ {t("screenshot failed", "screenshot zlyhal")}: {d.screenshot_error}</div>}
        {d.page && <div><span style={{ color: "var(--text-2)" }}>page:</span> {d.url || d.page}</div>}
        {d.viewport && <div>viewport: {d.viewport.w}×{d.viewport.h}{d.dpr ? ` · dpr ${d.dpr}` : ""}{typeof d.online === "boolean" ? ` · online ${d.online}` : ""}{d.lang ? ` · ${d.lang}` : ""}</div>}
        {d.ua && <div style={{ wordBreak: "break-all" }}>browser: {d.ua}</div>}
        {evs.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            <div style={{ color: "var(--text-2)" }}>{t("errors / network", "chyby / sieť")} ({evs.length}):</div>
            {evs.map((ev, i) => {
              const isErr = /error|fail|reject/.test(ev.t || "");
              return <div key={i} style={{ color: isErr ? red : dim, marginTop: 2, wordBreak: "break-all" }}>· [{ev.t}] {ev.m}</div>;
            })}
          </div>
        ) : <div style={{ marginTop: 6, color: accentInk }}>{t("no errors recorded", "žiadne chyby")} ✓</div>}
      </div>
    );
  }

  function statusButtons(id, current) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {STATUS_ORDER.map((sk) => {
          const on = current === sk; const col = STATUSES[sk][0];
          return (
            <button key={sk} disabled={busy[id] || on} onClick={() => setStatus(id, sk)}
              style={{ padding: "5px 10px", fontSize: 12, borderRadius: 7, cursor: on ? "default" : "pointer", border: `1px solid ${on ? col : border}`, color: on ? col : textLight, background: on ? `${col}14` : "transparent", opacity: busy[id] && !on ? 0.5 : 1 }}>
              {t(STATUSES[sk][1], STATUSES[sk][2])}
            </button>
          );
        })}
      </div>
    );
  }

  // ── Thread view ────────────────────────────────────────────────
  if (openConv) {
    const c = conv ? cat(conv.category) : null;
    const s = conv ? st(conv.status) : null;
    return (
      <div style={{ minHeight: "100vh", background: bg, color: textLight, padding: "1.5rem 1.75rem" }}>
        <button onClick={backToList} style={{ background: "transparent", border: "none", color: dim, cursor: "pointer", fontFamily: mono, fontSize: 13, padding: 0, marginBottom: 14 }}>← {t("Back to all feedback", "Späť na zoznam")}</button>
        {err && <div style={{ ...card, borderColor: amber, color: amber, marginBottom: 14 }}>{err}</div>}
        {convLoading && <div style={{ color: dim, fontFamily: mono, fontSize: 13 }}>{t("Loading…", "Načítavam…")}</div>}
        {conv && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span style={{ fontSize: 14, color: textLight }}>{c[0]} {t(c[1], c[2])}</span>
              <span style={{ fontSize: 11, fontFamily: mono, color: s[0], border: `1px solid ${s[0]}`, borderRadius: 100, padding: "2px 9px", textTransform: "uppercase", letterSpacing: 0.4 }}>{t(s[1], s[2])}</span>
              <span style={{ fontSize: 12, color: dim, fontFamily: mono }}>{conv.email || t("anonymous", "anonym")}{conv.user_tier ? ` · ${conv.user_tier}` : ""}</span>
              {conv.project_name && <span style={{ fontSize: 12, color: "var(--text-2)", fontFamily: mono }}>📍 {conv.project_name}</span>}
              {conv.page_url && <a href={conv.page_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: dim, fontFamily: mono }}>{conv.page_path} ↗</a>}
            </div>

            <div style={{ ...card, marginBottom: 14 }}>
              <div style={{ ...cardLabel, marginBottom: 6 }}>{eyebrowBar}{t("Status", "Stav")}</div>
              {statusButtons(conv.id, conv.status)}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12 }}>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Private note (only admins)…", "Súkromná poznámka (len admin)…")}
                  style={{ flex: 1, minWidth: 0, padding: "8px 11px", background: bg, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 13, outline: "none" }} />
                <button disabled={busy[conv.id] || note === (conv.admin_note || "")} onClick={() => saveNote(conv.id)}
                  style={{ padding: "8px 12px", fontSize: 12, borderRadius: 8, cursor: note !== (conv.admin_note || "") ? "pointer" : "not-allowed", border: `1px solid ${note !== (conv.admin_note || "") ? green : border}`, color: note !== (conv.admin_note || "") ? green : dim, background: "transparent", whiteSpace: "nowrap" }}>
                  {t("Save note", "Uložiť")}
                </button>
              </div>
            </div>

            {/* messages */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
              {(conv.messages || []).map((m) => {
                const isUser = m.sender === "user";
                return (
                  <div key={m.id} style={{ display: "flex", justifyContent: isUser ? "flex-start" : "flex-end" }}>
                    <div style={{ maxWidth: "78%", background: isUser ? bg2 : "color-mix(in srgb, var(--accent) 8%, transparent)", border: `1px solid ${isUser ? border : "color-mix(in srgb, var(--accent) 30%, transparent)"}`, borderRadius: 10, padding: "10px 13px" }}>
                      <div style={{ fontFamily: mono, fontSize: 10, color: isUser ? dim : green, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
                        {isUser ? t("User", "Používateľ") : t("You (Residata)", "Ty (Residata)")} · {fmtDate(m.created_at)}
                      </div>
                      <div style={{ fontSize: 14, color: textLight, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
                      {m.attachment_path && shotUrls[m.attachment_path] && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11, color: dim, fontFamily: mono, marginBottom: 4 }}>📎 {t("Attached screenshot", "Priložený screenshot")}</div>
                          <a href={shotUrls[m.attachment_path]} target="_blank" rel="noopener noreferrer"><img src={shotUrls[m.attachment_path]} alt="" style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 8, border: `1px solid ${border}`, display: "block" }} /></a>
                        </div>
                      )}
                      {m.auto_screenshot_path && shotUrls[m.auto_screenshot_path] && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ fontSize: 11, color: dim, fontFamily: mono, marginBottom: 4 }}>🖼️ {t("Page screenshot (auto)", "Screenshot stránky (auto)")}</div>
                          <a href={shotUrls[m.auto_screenshot_path]} target="_blank" rel="noopener noreferrer"><img src={shotUrls[m.auto_screenshot_path]} alt="" style={{ maxWidth: "100%", maxHeight: 380, borderRadius: 8, border: `1px solid ${border}`, display: "block" }} /></a>
                        </div>
                      )}
                      {m.diagnostics && (
                        <div style={{ marginTop: 8 }}>
                          <button onClick={() => setDiagOpen((o) => ({ ...o, [m.id]: !o[m.id] }))} style={diagBtn}>🔧 {t("Diagnostics", "Diagnostika")} {diagOpen[m.id] ? "▲" : "▼"}</button>
                          {diagOpen[m.id] && renderDiag(m.diagnostics)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* reply box */}
            <div style={{ ...card }}>
              <div style={{ ...cardLabel, marginBottom: 6 }}>{eyebrowBar}{t("Reply", "Odpovedať")}{conv.email ? ` → ${conv.email}` : ""}</div>
              {conv.email ? (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <textarea value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)} placeholder={t("Write your reply (emails the user)…", "Napíš odpoveď (pošle e-mail používateľovi)…")} rows={3}
                    style={{ flex: 1, minWidth: 0, padding: "9px 12px", background: bg, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 14, outline: "none", resize: "vertical", fontFamily: "inherit" }} />
                  <button disabled={replying || replyDraft.trim().length < 2} onClick={sendReply}
                    style={{ padding: "9px 14px", fontSize: 13, borderRadius: 8, fontWeight: 600, whiteSpace: "nowrap", border: `1px solid ${green}`, color: "var(--bg)", background: green, cursor: replying || replyDraft.trim().length < 2 ? "not-allowed" : "pointer", opacity: replying || replyDraft.trim().length < 2 ? 0.45 : 1 }}>
                    {replying ? t("Sending…", "Posielam…") : `↩ ${t("Send reply", "Odoslať")}`}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: dim }}>{t("No email on file — can't reply to this one.", "Bez e-mailu — na túto sa nedá odpovedať.")}</div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: bg, color: textLight, padding: "1.5rem 1.75rem" }}>
      <div style={{ marginBottom: "1.5rem", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", overflow: "hidden", borderRadius: 16, border: "1px solid var(--border)", padding: "1.15rem 1.6rem", flex: "1 1 340px", background: "radial-gradient(120% 140% at 2% -20%, rgba(18,185,129,0.13) 0%, transparent 46%), linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, var(--surface)) 0%, var(--bg) 75%)" }}>
          <p style={{ margin: 0, color: dim, fontSize: 13 }}>{t("Conversations — newest activity first. Open one to see the full thread + reply.", "Konverzácie — najnovšie hore. Otvor konverzáciu pre celé vlákno + odpoveď.")}</p>
        </div>
        <button onClick={load} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${border}`, background: "transparent", color: textLight, cursor: "pointer", fontSize: 13 }}>{t("Refresh", "Obnoviť")} ↻</button>
      </div>

      {err && <div style={{ ...card, borderColor: amber, color: amber, marginBottom: 14 }}>{err}</div>}

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(118px,1fr))", gap: 10, marginBottom: 16 }}>
          <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_SLATE) }}>{cardBar(C_SLATE)}<div style={cardLabel}>{t("Total", "Spolu")}</div><div style={cardVal}>{stats.total ?? 0}</div></div>
          <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_AMBER) }}>{cardBar(C_AMBER)}<div style={cardLabel}>{t("New", "Nové")}</div><div style={{ ...cardVal, color: amber }}>{stats.new ?? 0}</div></div>
          <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_BLUE) }}>{cardBar(C_BLUE)}<div style={cardLabel}>{t("In progress", "Rieši sa")}</div><div style={{ ...cardVal, color: blue }}>{stats.in_progress ?? 0}</div></div>
          <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_GREEN) }}>{cardBar(C_GREEN)}<div style={cardLabel}>{t("Resolved", "Vyriešené")}</div><div style={{ ...cardVal, color: accentInk }}>{stats.resolved ?? 0}</div></div>
          <div style={{ ...card, position: "relative", overflow: "hidden", background: tintBg(C_SLATE) }}>{cardBar(C_SLATE)}<div style={cardLabel}>{t("Won't fix", "Nerieši sa")}</div><div style={cardVal}>{stats.wont_fix ?? 0}</div></div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 150 }}>
          <label style={cardLabel}>{eyebrowBar}{t("Status", "Stav")}</label>
          <Picker
            value={fStatus}
            onChange={(v) => setFStatus(v)}
            options={[{ value: "", label: t("All", "Všetky") }, ...STATUS_ORDER.map((s) => ({ value: s, label: t(st(s)[1], st(s)[2]) }))]}
            ariaLabel={t("Status", "Stav")}
            sk={lang === "sk"}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 170 }}>
          <label style={cardLabel}>{eyebrowBar}{t("Type", "Typ")}</label>
          <Picker
            value={fCategory}
            onChange={(v) => setFCategory(v)}
            options={[{ value: "", label: t("All", "Všetky") }, ...catChips.map((c) => ({ value: c, label: `${cat(c)[0]} ${t(cat(c)[1], cat(c)[2])}${byCat[c] ? ` (${byCat[c]})` : ""}` }))]}
            ariaLabel={t("Type", "Typ")}
            sk={lang === "sk"}
          />
        </div>
        {(fStatus || fCategory) && <button onClick={() => { setFStatus(""); setFCategory(""); }} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: "transparent", color: textLight, cursor: "pointer", fontSize: 12 }}>{t("Clear", "Zrušiť")}</button>}
        {items && <span style={{ fontSize: 12, color: dim, fontFamily: mono, paddingBottom: 9 }}>{items.length} {t("conversations", "konverzácií")}</span>}
      </div>

      {!items && !err && <div style={{ color: dim, fontFamily: mono, fontSize: 13 }}>{t("Loading…", "Načítavam…")}</div>}
      {items && items.length === 0 && <div style={{ ...card, color: dim, fontSize: 13 }}>{t("No feedback yet for this filter.", "Zatiaľ žiadna spätná väzba pre tento filter.")}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(items || []).map((f) => {
          const c = cat(f.category), s = st(f.status);
          return (
            <div key={f.id} style={{ ...card, padding: "14px 16px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: textLight, border: `1px solid ${border}`, borderRadius: 6, padding: "3px 8px" }}>{c[0]} {t(c[1], c[2])}</span>
                <span style={{ fontSize: 11, fontFamily: mono, color: s[0], border: `1px solid ${s[0]}`, borderRadius: 100, padding: "2px 9px", textTransform: "uppercase", letterSpacing: 0.4 }}>{t(s[1], s[2])}</span>
                {f.needs_reply && <span style={{ fontSize: 11, fontFamily: mono, color: accentInk }}>● {t("needs reply", "čaká na odpoveď")}</span>}
                <span style={{ fontSize: 12, color: dim, fontFamily: mono }}>{fmtDate(f.activity_at)}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: dim, fontFamily: mono }}>{f.email || t("anonymous", "anonym")}{f.user_tier ? ` · ${f.user_tier}` : ""}</span>
              </div>

              <div style={{ fontSize: 14, lineHeight: 1.55, color: textLight, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {f.last_sender === "admin" ? <span style={{ color: accentInk, fontFamily: mono, fontSize: 12 }}>↩ </span> : null}{f.last_body}
              </div>

              {(f.project_name || f.page_path) && (
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 12, color: dim, fontFamily: mono }}>
                  {f.project_name && <span style={{ color: "var(--text-2)" }}>📍 {f.project_name}</span>}
                  {f.page_path && (f.page_url ? <a href={f.page_url} target="_blank" rel="noopener noreferrer" style={{ color: dim }}>{f.page_path} ↗</a> : <span>{f.page_path}</span>)}
                </div>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${border}` }}>
                {statusButtons(f.id, f.status)}
                <button onClick={() => openConversation(f.id)}
                  style={{ marginLeft: "auto", padding: "6px 12px", fontSize: 12, borderRadius: 8, cursor: "pointer", border: `1px solid ${green}`, color: accentInk, background: "transparent", whiteSpace: "nowrap" }}>
                  💬 {t("Open conversation", "Otvoriť konverzáciu")} ({f.msg_count}) →
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
