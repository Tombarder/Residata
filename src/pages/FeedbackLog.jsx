/**
 * FeedbackLog — admin-only "Feedback / Spätná väzba" inbox.
 *
 * Shows every report submitted via the site-wide FeedbackWidget so the Boss can
 * read them, triage (new → in progress → resolved / won't-fix), add a private
 * note, and see the bigger picture (counts by status + category).
 *
 * Data via three admin-gated RPCs (public._require_admin → fails closed):
 *   admin_feedback_stats()                          → header counts
 *   admin_list_feedback(p_status, p_category)       → the list (jsonb, no row cap)
 *   admin_update_feedback(p_id, p_status, p_note)   → triage a row
 * Read + triage only; users' messages are never edited.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const green = "#00e5a0";
const amber = "#f5a623";
const blue = "#4a9eff";
const textLight = "#e8e8ed";
const dim = "#8a8a96";
const border = "#222228";
const bg = "#0a0a0b";
const bg2 = "#0e0e10";
const mono = "'JetBrains Mono', monospace";

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

// key · emoji · EN · SK  (keys match the DB + widget)
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
  const [notes, setNotes] = useState({});   // id -> draft note
  const [busy, setBusy] = useState({});      // id -> bool
  const [replyDraft, setReplyDraft] = useState({});  // id -> reply text
  const [replying, setReplying] = useState({});      // id -> bool

  const load = useCallback(() => {
    // setState only inside async callbacks (never synchronously in the effect).
    rpcDirect("admin_feedback_stats", {}).then(setStats).catch((e) => setErr(e.message));
    rpcDirect("admin_list_feedback", {
      p_status: fStatus || null,
      p_category: fCategory || null,
    }).then((rows) => { setItems(rows || []); setErr(null); }).catch((e) => setErr(e.message));
  }, [fStatus, fCategory]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id, status) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const updated = await rpcDirect("admin_update_feedback", { p_id: id, p_status: status });
      setItems((list) => (list || []).map((x) => (x.id === id ? { ...x, ...updated } : x)));
      rpcDirect("admin_feedback_stats", {}).then(setStats).catch(() => {});
    } catch (e) { setErr(e.message); }
    finally { setBusy((b) => ({ ...b, [id]: false })); }
  }
  async function saveNote(id) {
    const note = notes[id] ?? "";
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const updated = await rpcDirect("admin_update_feedback", { p_id: id, p_note: note });
      setItems((list) => (list || []).map((x) => (x.id === id ? { ...x, ...updated } : x)));
      setNotes((n) => { const c = { ...n }; delete c[id]; return c; });
    } catch (e) { setErr(e.message); }
    finally { setBusy((b) => ({ ...b, [id]: false })); }
  }
  async function viewShot(path) {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from("feedback-attachments").createSignedUrl(path, 600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    else if (error) setErr(error.message);
  }
  async function sendReply(id) {
    const txt = (replyDraft[id] || "").trim();
    if (txt.length < 2) return;
    setReplying((r) => ({ ...r, [id]: true })); setErr(null);
    try {
      const token = storedAccessToken();
      const r = await fetch("/api/feedback/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ feedback_id: id, reply: txt }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
      setItems((list) => (list || []).map((x) => (x.id === id ? { ...x, admin_reply: txt, replied_at: new Date().toISOString() } : x)));
      setReplyDraft((d) => { const c = { ...d }; delete c[id]; return c; });
    } catch (e) { setErr("Reply: " + e.message); }
    finally { setReplying((r) => ({ ...r, [id]: false })); }
  }

  const cat = (k) => CATEGORIES[k] || CATEGORIES.other;
  const st = (k) => STATUSES[k] || STATUSES.new;

  const card = { background: bg2, border: `1px solid ${border}`, borderRadius: 10, padding: "12px 14px" };
  const cardLabel = { fontSize: 11, color: dim, fontFamily: mono, textTransform: "uppercase", letterSpacing: 0.4 };
  const cardVal = { fontSize: 22, fontWeight: 600, color: textLight, marginTop: 4 };
  const selStyle = { marginTop: 5, padding: "9px 12px", background: bg2, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 14, outline: "none" };

  const byCat = stats?.by_category || {};
  const catChips = useMemo(() => Object.keys(CATEGORIES), []);

  return (
    <div style={{ minHeight: "100vh", background: bg, color: textLight, padding: "1.5rem 1.75rem" }}>
      <div style={{ marginBottom: 18, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{t("Feedback", "Spätná väzba")}</h1>
          <p style={{ margin: "4px 0 0", color: dim, fontSize: 13 }}>
            {t("Problem reports, questions and suggestions from users.",
               "Hlásenia problémov, otázky a návrhy od používateľov.")}
          </p>
        </div>
        <button onClick={load} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${border}`, background: "transparent", color: textLight, cursor: "pointer", fontSize: 13 }}>
          {t("Refresh", "Obnoviť")} ↻
        </button>
      </div>

      {err && <div style={{ ...card, borderColor: amber, color: amber, marginBottom: 14 }}>{err}</div>}

      {/* Stats */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(118px,1fr))", gap: 10, marginBottom: 16 }}>
          <div style={card}><div style={cardLabel}>{t("Total", "Spolu")}</div><div style={cardVal}>{stats.total ?? 0}</div></div>
          <div style={card}><div style={cardLabel}>{t("New", "Nové")}</div><div style={{ ...cardVal, color: amber }}>{stats.new ?? 0}</div></div>
          <div style={card}><div style={cardLabel}>{t("In progress", "Rieši sa")}</div><div style={{ ...cardVal, color: blue }}>{stats.in_progress ?? 0}</div></div>
          <div style={card}><div style={cardLabel}>{t("Resolved", "Vyriešené")}</div><div style={{ ...cardVal, color: green }}>{stats.resolved ?? 0}</div></div>
          <div style={card}><div style={cardLabel}>{t("Won't fix", "Nerieši sa")}</div><div style={cardVal}>{stats.wont_fix ?? 0}</div></div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 150 }}>
          <label style={cardLabel}>{t("Status", "Stav")}</label>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={selStyle}>
            <option value="">{t("All", "Všetky")}</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{t(st(s)[1], st(s)[2])}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column", minWidth: 170 }}>
          <label style={cardLabel}>{t("Type", "Typ")}</label>
          <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} style={selStyle}>
            <option value="">{t("All", "Všetky")}</option>
            {catChips.map((c) => <option key={c} value={c}>{cat(c)[0]} {t(cat(c)[1], cat(c)[2])}{byCat[c] ? ` (${byCat[c]})` : ""}</option>)}
          </select>
        </div>
        {(fStatus || fCategory) && (
          <button onClick={() => { setFStatus(""); setFCategory(""); }} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, background: "transparent", color: textLight, cursor: "pointer", fontSize: 12 }}>
            {t("Clear", "Zrušiť")}
          </button>
        )}
        {items && <span style={{ fontSize: 12, color: dim, fontFamily: mono, paddingBottom: 9 }}>{items.length} {t("items", "položiek")}</span>}
      </div>

      {!items && !err && <div style={{ color: dim, fontFamily: mono, fontSize: 13 }}>{t("Loading…", "Načítavam…")}</div>}
      {items && items.length === 0 && (
        <div style={{ ...card, color: dim, fontSize: 13 }}>
          {t("No feedback yet for this filter.", "Zatiaľ žiadna spätná väzba pre tento filter.")}
        </div>
      )}

      {/* List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(items || []).map((f) => {
          const c = cat(f.category), s = st(f.status);
          const noteDraft = notes[f.id] ?? (f.admin_note || "");
          const noteDirty = (notes[f.id] ?? null) !== null && noteDraft !== (f.admin_note || "");
          return (
            <div key={f.id} style={{ ...card, padding: "14px 16px" }}>
              {/* meta row */}
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: textLight, border: `1px solid ${border}`, borderRadius: 6, padding: "3px 8px" }}>
                  {c[0]} {t(c[1], c[2])}
                </span>
                <span style={{ fontSize: 11, fontFamily: mono, color: s[0], border: `1px solid ${s[0]}`, borderRadius: 100, padding: "2px 9px", textTransform: "uppercase", letterSpacing: 0.4 }}>
                  {t(s[1], s[2])}
                </span>
                <span style={{ fontSize: 12, color: dim, fontFamily: mono }}>{fmtDate(f.created_at)}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, color: dim, fontFamily: mono }}>
                  {(f.email || t("anonymous", "anonym"))}{f.user_tier ? ` · ${f.user_tier}` : ""}
                </span>
              </div>

              {/* message */}
              <div style={{ fontSize: 14, lineHeight: 1.6, color: textLight, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{f.message}</div>

              {/* context: project · page · screenshot */}
              {(f.project_name || f.page_path || f.attachment_path) && (
                <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 12, color: dim, fontFamily: mono }}>
                  {f.project_name && <span style={{ color: "#cdd0d6" }}>📍 {f.project_name}</span>}
                  {f.page_path && (f.page_url
                    ? <a href={f.page_url} target="_blank" rel="noopener noreferrer" style={{ color: dim }}>{f.page_path} ↗</a>
                    : <span>{f.page_path}</span>)}
                  {f.attachment_path && (
                    <button onClick={() => viewShot(f.attachment_path)}
                      style={{ background: "transparent", border: `1px solid ${border}`, color: green, borderRadius: 6, cursor: "pointer", padding: "3px 8px", fontSize: 12, fontFamily: mono }}>
                      📎 {t("View screenshot", "Zobraziť screenshot")}
                    </button>
                  )}
                </div>
              )}

              {/* triage row */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: `1px solid ${border}` }}>
                {STATUS_ORDER.map((sk) => {
                  const on = f.status === sk;
                  const col = STATUSES[sk][0];
                  return (
                    <button key={sk} disabled={busy[f.id] || on} onClick={() => setStatus(f.id, sk)}
                      style={{ padding: "5px 10px", fontSize: 12, borderRadius: 7, cursor: on ? "default" : "pointer",
                        border: `1px solid ${on ? col : border}`, color: on ? col : textLight,
                        background: on ? `${col}14` : "transparent", opacity: busy[f.id] && !on ? 0.5 : 1 }}>
                      {t(STATUSES[sk][1], STATUSES[sk][2])}
                    </button>
                  );
                })}
              </div>

              {/* admin note */}
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10 }}>
                <input
                  value={noteDraft}
                  onChange={(e) => setNotes((n) => ({ ...n, [f.id]: e.target.value }))}
                  placeholder={t("Private note (only admins)…", "Súkromná poznámka (len admin)…")}
                  style={{ flex: 1, minWidth: 0, padding: "8px 11px", background: bg, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 13, outline: "none" }}
                />
                <button disabled={busy[f.id] || !noteDirty} onClick={() => saveNote(f.id)}
                  style={{ padding: "8px 12px", fontSize: 12, borderRadius: 8, cursor: noteDirty ? "pointer" : "not-allowed",
                    border: `1px solid ${noteDirty ? green : border}`, color: noteDirty ? green : dim, background: "transparent", whiteSpace: "nowrap" }}>
                  {t("Save note", "Uložiť")}
                </button>
              </div>

              {/* reply to the user (only if we have an address) */}
              {f.email && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${border}` }}>
                  {f.admin_reply && (
                    <div style={{ fontSize: 12, color: dim, marginBottom: 8 }}>
                      <span style={{ color: green }}>↩ {t("Replied", "Odpovedané")}</span>
                      {f.replied_at ? ` · ${fmtDate(f.replied_at)}` : ""}
                      <div style={{ color: "#cdd0d6", marginTop: 3, whiteSpace: "pre-wrap" }}>{f.admin_reply}</div>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <textarea
                      value={replyDraft[f.id] ?? ""}
                      onChange={(e) => setReplyDraft((d) => ({ ...d, [f.id]: e.target.value }))}
                      placeholder={t(`Reply to ${f.email} (emails them)…`, `Odpovedať na ${f.email} (pošle e-mail)…`)}
                      rows={2}
                      style={{ flex: 1, minWidth: 0, padding: "8px 11px", background: bg, border: `1px solid ${border}`, borderRadius: 8, color: textLight, fontSize: 13, outline: "none", resize: "vertical", fontFamily: "inherit" }}
                    />
                    <button
                      disabled={replying[f.id] || (replyDraft[f.id] || "").trim().length < 2}
                      onClick={() => sendReply(f.id)}
                      style={{ padding: "8px 13px", fontSize: 12, borderRadius: 8, fontWeight: 600, whiteSpace: "nowrap",
                        border: `1px solid ${green}`, color: "#0a0a0c", background: green,
                        cursor: replying[f.id] || (replyDraft[f.id] || "").trim().length < 2 ? "not-allowed" : "pointer",
                        opacity: replying[f.id] || (replyDraft[f.id] || "").trim().length < 2 ? 0.45 : 1 }}>
                      {replying[f.id] ? t("Sending…", "Posielam…") : `↩ ${f.admin_reply ? t("Reply again", "Znova") : t("Reply", "Odpovedať")}`}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
