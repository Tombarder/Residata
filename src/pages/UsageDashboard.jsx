// UsageDashboard — admin-only product-usage view over public.user_activity.
//
// Reads PRE-AGGREGATED answers from server-side RPCs (admin_usage_summary /
// _daily / _features / _users / admin_user_timeline) instead of pulling raw
// rows to the browser, so it stays correct and fast as the event table grows
// (the old OverviewPanel capped at the last 1000 rows). All RPCs are admin-
// gated in the DB (current_user_is_admin()).
//
// Answers: are people using it, who, how much focused time, which features,
// active vs churned — plus a per-user drill-down timeline (what/where/how long).
import { useState, useEffect, useCallback } from "react";
import { supabaseData } from "../lib/supabase";
import { accent as green, dim, text, border, surface as bg, surfaceDark as bg2 } from "../lib/theme";

const mono = "'JetBrains Mono', monospace";
const red = "#ff6b6b";
const orange = "#f5a623";
const blue = "#4aa3ff";

const WINDOWS = [7, 30, 90];

// Friendly labels for the raw event_type slugs.
const EVENT_LABELS = {
  page_view:            { sk: "Zobrazenie stránky", en: "Page view" },
  page_leave:           { sk: "Opustenie stránky", en: "Page leave" },
  project_view:         { sk: "Zobrazenie projektu", en: "Project view" },
  csv_exported:         { sk: "Export CSV", en: "CSV export" },
  xlsx_exported:        { sk: "Export XLSX", en: "XLSX export" },
  chat_question:        { sk: "Otázka AI asistentovi", en: "AI question" },
  chat_answer:          { sk: "Odpoveď AI", en: "AI answer" },
  chat_feedback:        { sk: "Hodnotenie AI odpovede", en: "AI answer rating" },
  chat_cleared:         { sk: "Vyčistenie chatu", en: "Chat cleared" },
  country_switched:     { sk: "Prepnutie krajiny", en: "Country switched" },
  currency_switched:    { sk: "Prepnutie meny", en: "Currency switched" },
  language_switched:    { sk: "Prepnutie jazyka", en: "Language switched" },
  flat_sort_applied:    { sk: "Triedenie bytov", en: "Flat sort" },
  flat_filter_cleared:  { sk: "Vymazanie filtra", en: "Filter cleared" },
  scatter_dot_clicked:  { sk: "Klik v grafe", en: "Chart dot click" },
  settings_saved:       { sk: "Uloženie nastavení", en: "Settings saved" },
  profile_completed:    { sk: "Dokončenie profilu", en: "Profile completed" },
  platform_crash:       { sk: "Pád aplikácie", en: "App crash" },
  trial_banner_clicked: { sk: "Klik na trial banner", en: "Trial banner click" },
  trial_popup_shown:    { sk: "Zobrazenie trial popupu", en: "Trial popup shown" },
  trial_popup_clicked:  { sk: "Klik na trial popup", en: "Trial popup click" },
  trial_popup_dismissed:{ sk: "Zavretie trial popupu", en: "Trial popup dismissed" },
  login_code_requested: { sk: "Žiadosť o prihl. kód", en: "Login code requested" },
  login_code_submitted: { sk: "Odoslanie prihl. kódu", en: "Login code submitted" },
  login_code_success:   { sk: "Úspešné prihlásenie", en: "Login success" },
  login_code_error:     { sk: "Chyba prihl. kódu", en: "Login code error" },
  login_code_request_error: { sk: "Chyba žiadosti o kód", en: "Login code request error" },
  login_magic_link_requested: { sk: "Žiadosť o magic link", en: "Magic link requested" },
  login_magic_link_error: { sk: "Chyba magic linku", en: "Magic link error" },
  login_rejected_personal_email: { sk: "Odmietnutý osobný e-mail", en: "Personal e-mail rejected" },
  trial_banner_dismissed: { sk: "Zavretie trial banneru", en: "Trial banner dismissed" },
};
const evLabel = (t, lang) => (EVENT_LABELS[t]?.[lang]) || (t || "").replace(/_/g, " ");

const STATUS_COLOR = { active: green, idle: orange, churned: red };
const STATUS_LABEL = {
  active:  { sk: "aktívny", en: "active" },
  idle:    { sk: "utícha",  en: "idle" },
  churned: { sk: "odišiel", en: "churned" },
};
const TIER_COLOR = { admin: blue, paid: green, free: dim, pending: orange, trial: orange };

function fmtDateTime(iso, lang) {
  try { return new Date(iso).toLocaleString(lang === "sk" ? "sk-SK" : "en-GB", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
}
function relTime(iso, lang) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  const L = (sk, en) => (lang === "sk" ? sk : en);
  if (s < 60) return L("pred chvíľou", "just now");
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} d`;
}
const minsLabel = (m) => {
  // bigint/numeric come back from PostgREST as strings — coerce before comparing.
  const n = m == null ? null : Number(m);
  if (n == null || Number.isNaN(n)) return "—";
  if (n <= 0) return "0";
  if (n < 1) return "<1 min";
  if (n < 60) return `${Math.round(n)} min`;
  return `${(n / 60).toFixed(1)} h`;
};
// Thousands separator for counts (values may be strings from bigint columns).
const fmtN = (v, lang = "sk") => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString(lang === "sk" ? "sk-SK" : "en-GB") : (v ?? "—");
};

export default function UsageDashboard({ lang = "en" }) {
  const L = (sk, en) => (lang === "sk" ? sk : en);
  const num = (v) => fmtN(v, lang);   // locale follows the UI language
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState(null);
  const [daily, setDaily] = useState([]);
  const [features, setFeatures] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const [selUser, setSelUser] = useState(null);   // { user_id, email }
  const [timeline, setTimeline] = useState([]);
  const [tlLoading, setTlLoading] = useState(false);
  const [tlErr, setTlErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    // Each RPC is settled independently: a failure in one section must not blank
    // the others. supabaseData never rejects (it resolves {data,error}), but wrap
    // in case a token/network throw escapes.
    const call = (fn, args) => supabaseData.rpc(fn, args).then(r => r, e => ({ data: null, error: e }));
    const [s, d, f, u] = await Promise.all([
      call("admin_usage_summary", { p_days: days }),
      call("admin_usage_daily", { p_days: days }),
      call("admin_usage_features", { p_days: days }),
      call("admin_usage_users", { p_days: days }),
    ]);
    if (!s.error) setSummary(s.data || null);
    if (!d.error) setDaily(d.data || []);
    if (!f.error) setFeatures(f.data || []);
    if (!u.error) setUsers(u.data || []);
    const errs = [s.error, d.error, f.error, u.error].filter(Boolean);
    setErr(errs.length ? (errs[0].message || String(errs[0])) : null);
    setLoading(false);
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const openUser = useCallback(async (u) => {
    setSelUser(u); setTimeline([]); setTlErr(null); setTlLoading(true);
    try {
      // FULL history, no cap (Boss 2026-07-17). The RPC has no SQL LIMIT, but
      // PostgREST caps a single response at 1000 rows — so page through with
      // .range() until a short page. (Guard at 200 pages = 200k events so a bug
      // can't loop forever; far beyond any real user's activity.)
      const PAGE = 1000;
      const all = [];
      for (let from = 0, page = 0; page < 200; from += PAGE, page++) {
        const { data, error } = await supabaseData
          .rpc("admin_user_timeline", { p_user_id: u.user_id })
          .range(from, from + PAGE - 1);
        if (error) { setTlErr(error.message || String(error)); break; }
        all.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      setTimeline(all);
    } catch (e) { setTlErr(String(e?.message || e)); }
    setTlLoading(false);
  }, []);

  const maxDailyEvents = Math.max(1, ...daily.map(d => Number(d.events) || 0));
  const maxDailyUsers = Math.max(1, ...daily.map(d => Number(d.active_users) || 0));
  const maxFeat = Math.max(1, ...features.map(f => Number(f.events) || 0));

  return (
    <div style={{ padding: "1.5rem 1.75rem", maxWidth: 1200, margin: "0 auto", color: text }}>
      {/* Header + window selector */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", marginBottom: "0.35rem" }}>
        <div>
          <h1 style={{ fontFamily: mono, fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>
            {L("Používanie", "Usage")}
            {loading && summary && <span style={{ fontFamily: mono, fontSize: "0.72rem", fontWeight: 400, color: dim, marginLeft: "0.6rem" }}>· {L("aktualizujem…", "updating…")}</span>}
          </h1>
          <p style={{ color: dim, fontSize: "0.82rem", margin: "0.35rem 0 0" }}>
            {L("Kto platformu používa, ako často, ako dlho a čo v nej robí.", "Who uses the platform, how often, how long, and what they do.")}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <span style={{ fontSize: "0.7rem", color: dim, fontFamily: mono }}>{L("okno", "window")}</span>
          {WINDOWS.map(w => (
            <button key={w} onClick={() => setDays(w)} disabled={loading} style={{
              fontFamily: mono, fontSize: "0.75rem", padding: "0.35rem 0.7rem", borderRadius: 8, cursor: loading ? "default" : "pointer",
              border: `1px solid ${days === w ? green : border}`, background: days === w ? green : "transparent",
              color: days === w ? "#00120c" : text, fontWeight: days === w ? 700 : 400, opacity: loading && days !== w ? 0.5 : 1,
            }}>{w}{L("d", "d")}</button>
          ))}
          <button onClick={load} disabled={loading} title={L("obnoviť", "reload")} aria-label={L("obnoviť", "reload")} style={{ fontFamily: mono, fontSize: "0.75rem", padding: "0.35rem 0.7rem", borderRadius: 8, cursor: loading ? "default" : "pointer", border: `1px solid ${border}`, background: "transparent", color: dim, opacity: loading ? 0.5 : 1 }}>↻</button>
        </div>
      </div>

      {err && (
        <div style={{ background: "rgba(255,107,107,0.1)", border: `1px solid ${red}`, color: red, borderRadius: 8, padding: "0.7rem 0.9rem", fontFamily: mono, fontSize: "0.78rem", margin: "0.8rem 0" }}>
          {err}
        </div>
      )}

      {loading && !summary ? (
        <div style={{ color: dim, fontFamily: mono, fontSize: "0.8rem", padding: "2rem 0" }}>{L("Načítavam…", "Loading…")}</div>
      ) : (
        <>
          {/* KPI grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.7rem", margin: "1.1rem 0" }}>
            <Card label={L("Aktívni dnes", "Active today")} value={num(summary?.dau)} color={green} sub={L("prihlásení dnes", "signed-in today")} />
            <Card label={L("Aktívni (7 dní)", "Active (7d)")} value={num(summary?.wau)} sub={L("prihlásení používatelia", "signed-in users")} />
            {/* Only show the window-active card when the window is wider than 7d,
                otherwise it just duplicates the "Active (7d)" card above. */}
            {days > 7 && <Card label={L(`Aktívni (${days} dní)`, `Active (${days}d)`)} value={num(summary?.mau)} />}
            <Card label={L("Ø aktívny čas / relácia", "Ø active time / session")} value={minsLabel(summary?.avg_active_min)} sub={L("skutočne strávený čas", "real focused time")} />
            <Card label={L("Celkový aktívny čas", "Total active time")} value={summary?.active_hours != null ? `${num(summary.active_hours)} h` : "—"} />
            <Card label={L("Relácie", "Sessions")} value={num(summary?.total_sessions)} sub={L(`+ ${num(summary?.anon_sessions ?? 0)} anonymných`, `+ ${num(summary?.anon_sessions ?? 0)} anonymous`)} />
            <Card label={L("Exporty", "Exports")} value={num(summary?.exports)} />
            <Card label={L("Otázky AI", "AI questions")} value={num(summary?.ai_questions)} />
            <Card label={L("Noví používatelia", "New users")} value={num(summary?.new_users)} color={blue} />
            <Card label={L("Vracajúci sa", "Returning")} value={num(summary?.returning_users)} sub={L("aktívni ≥2 dni", "active ≥2 days")} />
            <Card label={L("Pády aplikácie", "App crashes")} value={num(summary?.crashes)} color={Number(summary?.crashes) > 0 ? red : text} />
          </div>

          {/* Daily trend */}
          <Section title={L("Denný trend", "Daily trend")}>
            {daily.length === 0 ? <Empty lang={lang} /> : (
              <div style={{ overflowX: "auto" }}>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 120, minWidth: Math.max(daily.length * 10, 300) }}>
                  {daily.map((d) => {
                    const ev = Number(d.events) || 0;
                    const h = (ev / maxDailyEvents) * 100;
                    const uh = (Number(d.active_users) / maxDailyUsers) * 100;
                    // Give any non-zero day a visible sliver so a quiet day next to a
                    // spike doesn't vanish (linear scale would round it to 0px).
                    const barH = ev > 0 ? `max(3px, ${h}%)` : "0%";
                    return (
                      <div key={d.day} title={`${d.day}\n${num(d.events)} ${L("udalostí", "events")}\n${num(d.active_users)} ${L("aktívnych", "active")}\n${num(d.new_users)} ${L("noví", "new")}`}
                        style={{ flex: 1, minWidth: 6, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", height: "100%", position: "relative" }}>
                        <div style={{ width: "100%", height: barH, background: bg2, borderTop: `2px solid ${blue}`, borderRadius: "2px 2px 0 0" }} />
                        {/* active-users dot on its OWN scale (was drawn at the events-bar
                            height, so it carried no active-users info despite the legend). */}
                        <div style={{ position: "absolute", bottom: `${uh}%`, width: 4, height: 4, borderRadius: "50%", background: green, opacity: uh > 0 ? 1 : 0, transform: "translateY(2px)" }} />
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: "1.2rem", marginTop: "0.5rem", fontSize: "0.68rem", color: dim, fontFamily: mono }}>
                  <span><span style={{ color: blue }}>▮</span> {L("udalosti / deň", "events / day")}</span>
                  <span><span style={{ color: green }}>●</span> {L("aktívni používatelia", "active users")}</span>
                  <span>{daily[0]?.day} → {daily[daily.length - 1]?.day}</span>
                </div>
              </div>
            )}
          </Section>

          {/* Feature adoption */}
          <Section title={L("Čo používajú (funkcie)", "What they use (features)")}>
            {features.length === 0 ? <Empty lang={lang} /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {features.map((f) => (
                  <div key={f.event_type} style={{ display: "grid", gridTemplateColumns: "minmax(140px,1.6fr) 3fr auto", alignItems: "center", gap: "0.7rem" }}>
                    <span style={{ fontSize: "0.78rem", color: text }}>{evLabel(f.event_type, lang)}</span>
                    <div style={{ background: bg2, borderRadius: 5, height: 16, overflow: "hidden" }}>
                      <div style={{ width: `${(Number(f.events) / maxFeat) * 100}%`, height: "100%", background: green, opacity: 0.75 }} />
                    </div>
                    <span style={{ fontFamily: mono, fontSize: "0.72rem", color: dim, whiteSpace: "nowrap" }}>
                      {num(f.events)} · {num(f.users)} {L("použ.", "usr")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* Per-user table */}
          <Section title={L("Používatelia", "Users")} sub={L(`za posledných ${days} dní · klikni na riadok pre denník aktivity`, `last ${days} days · click a row for the activity timeline`)}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                <thead>
                  <tr style={{ color: dim, fontFamily: mono, fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {[L("Používateľ", "User"), "Tier", L("Stav", "Status"), L("Relácie", "Sess."), L("Aktívny čas", "Active"), L("Dni", "Days"), L("Projekty", "Proj."), "Export", "AI", L("Naposledy", "Last seen")].map((h, i) => (
                      <th key={i} style={{ textAlign: i === 0 ? "left" : "right", padding: "0.5rem 0.6rem", borderBottom: `1px solid ${border}`, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.user_id} onClick={() => openUser(u)}
                      tabIndex={0} role="button"
                      aria-label={L(`Denník aktivity — ${u.email || u.user_id}`, `Activity timeline — ${u.email || u.user_id}`)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openUser(u); } }}
                      style={{ cursor: "pointer", borderBottom: `1px solid ${border}`, outlineOffset: -2 }}
                      onMouseEnter={e => e.currentTarget.style.background = bg2}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      onFocus={e => e.currentTarget.style.background = bg2}
                      onBlur={e => e.currentTarget.style.background = "transparent"}>
                      <td style={{ padding: "0.5rem 0.6rem", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {u.email || "(?)"}{u.company ? <span style={{ color: dim }}> · {u.company}</span> : null}
                      </td>
                      <td style={{ textAlign: "right", padding: "0.5rem 0.6rem", fontFamily: mono, fontSize: "0.72rem", color: TIER_COLOR[u.tier] || dim }}>{u.tier || "—"}</td>
                      <td style={{ textAlign: "right", padding: "0.5rem 0.6rem" }}>
                        <span style={{ fontFamily: mono, fontSize: "0.68rem", color: STATUS_COLOR[u.status] || dim }}>● {STATUS_LABEL[u.status]?.[lang] || u.status}</span>
                      </td>
                      <td style={{ textAlign: "right", padding: "0.5rem 0.6rem", fontFamily: mono }}>{num(u.sessions)}</td>
                      <td style={{ textAlign: "right", padding: "0.5rem 0.6rem", fontFamily: mono }}>{minsLabel(u.active_min)}</td>
                      <td style={{ textAlign: "right", padding: "0.5rem 0.6rem", fontFamily: mono }}>{num(u.days_active)}</td>
                      <td style={{ textAlign: "right", padding: "0.5rem 0.6rem", fontFamily: mono }}>{num(u.project_views)}</td>
                      <td style={{ textAlign: "right", padding: "0.5rem 0.6rem", fontFamily: mono }}>{num(u.exports)}</td>
                      <td style={{ textAlign: "right", padding: "0.5rem 0.6rem", fontFamily: mono }}>{num(u.ai_questions)}</td>
                      <td style={{ textAlign: "right", padding: "0.5rem 0.6rem", fontFamily: mono, fontSize: "0.72rem", color: dim, whiteSpace: "nowrap" }}>{u.last_seen ? relTime(u.last_seen, lang) : "—"}</td>
                    </tr>
                  ))}
                  {users.length === 0 && <tr><td colSpan={10} style={{ padding: "1rem", color: dim, textAlign: "center" }}>{L("Žiadni používatelia v okne.", "No users in window.")}</td></tr>}
                </tbody>
              </table>
            </div>
          </Section>

          <MaintenancePanel lang={lang} onDeleted={load} />
        </>
      )}

      {/* Drill-down drawer */}
      {selUser && (
        <UserTimeline user={selUser} rows={timeline} loading={tlLoading} err={tlErr} lang={lang} onClose={() => setSelUser(null)} />
      )}
    </div>
  );
}

// KPI card (module-level so it isn't recreated every render).
function Card({ label, value, sub, color = text }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "1rem 1.1rem", minHeight: 88 }}>
      <div style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.4rem" }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: "1.6rem", fontWeight: 700, color, lineHeight: 1 }}>{value ?? "—"}</div>
      {sub && <div style={{ fontSize: "0.7rem", color: dim, marginTop: "0.3rem" }}>{sub}</div>}
    </div>
  );
}

function Section({ title, sub, children }) {
  return (
    <div style={{ margin: "1.6rem 0" }}>
      <div style={{ marginBottom: "0.7rem" }}>
        <h2 style={{ fontFamily: mono, fontSize: "0.95rem", fontWeight: 700, margin: 0, color: text }}>{title}</h2>
        {sub && <div style={{ fontSize: "0.72rem", color: dim, marginTop: "0.2rem" }}>{sub}</div>}
      </div>
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "1rem 1.1rem" }}>{children}</div>
    </div>
  );
}

function Empty({ lang }) {
  return <div style={{ color: dim, fontFamily: mono, fontSize: "0.78rem" }}>{lang === "sk" ? "Žiadne dáta v tomto okne." : "No data in this window."}</div>;
}

// Per-user activity timeline, grouped by session (newest first).
function UserTimeline({ user, rows, loading, err, lang, onClose }) {
  const L = (sk, en) => (lang === "sk" ? sk : en);

  // Close on Escape + lock the page scroll behind the drawer.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  // Group by session_id (NOT by consecutive rows): a user can have overlapping
  // sessions (two tabs), so the same session_id appears non-contiguously in the
  // time-desc list — consecutive grouping would shatter one session into many.
  // Bucket by id, then order sessions by their most-recent event.
  const byId = new Map();
  for (const r of rows) {
    if (!byId.has(r.session_id)) byId.set(r.session_id, []);
    byId.get(r.session_id).push(r);
  }
  const groups = [...byId.entries()]
    .map(([session_id, rs]) => ({ session_id, rows: rs }))  // rows already time-desc from the RPC
    .sort((a, b) => new Date(b.rows[0].created_at) - new Date(a.rows[0].created_at));

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(560px, 100%)", height: "100%", background: bg, borderLeft: `1px solid ${border}`, overflowY: "auto", padding: "1.3rem 1.4rem", color: text }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "1rem" }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: "0.66rem", color: dim, textTransform: "uppercase", letterSpacing: "0.08em" }}>{L("Denník aktivity", "Activity timeline")}</div>
            <div style={{ fontFamily: mono, fontSize: "0.95rem", fontWeight: 700, marginTop: "0.25rem", wordBreak: "break-all" }}>{user.email || user.user_id}</div>
          </div>
          <button onClick={onClose} aria-label={L("Zavrieť", "Close")} title={L("Zavrieť", "Close")} style={{ background: "transparent", border: `1px solid ${border}`, color: dim, borderRadius: 8, cursor: "pointer", fontFamily: mono, fontSize: "0.9rem", padding: "0.2rem 0.6rem" }}>✕</button>
        </div>

        {loading ? (
          <div style={{ color: dim, fontFamily: mono, fontSize: "0.8rem" }}>{L("Načítavam…", "Loading…")}</div>
        ) : err ? (
          <div style={{ background: "rgba(255,107,107,0.1)", border: `1px solid ${red}`, color: red, borderRadius: 8, padding: "0.7rem 0.9rem", fontFamily: mono, fontSize: "0.76rem" }}>{err}</div>
        ) : rows.length === 0 ? (
          <div style={{ color: dim, fontFamily: mono, fontSize: "0.8rem" }}>{L("Žiadna aktivita.", "No activity.")}</div>
        ) : (
          <>
          <div style={{ fontFamily: mono, fontSize: "0.66rem", color: dim, marginBottom: "0.8rem" }}>
            {fmtN(rows.length, lang)} {L("udalostí · celá história", "events · full history")}
          </div>
          {groups.map((g, gi) => (
            <div key={gi} style={{ marginBottom: "1.2rem" }}>
              <div style={{ fontFamily: mono, fontSize: "0.64rem", color: dim, marginBottom: "0.4rem", borderBottom: `1px solid ${border}`, paddingBottom: "0.3rem" }}>
                {L("Relácia", "Session")} · {fmtDateTime(g.rows[g.rows.length - 1].created_at, lang)} → {fmtDateTime(g.rows[0].created_at, lang)}
              </div>
              {g.rows.map((r, ri) => {
                const active = r.active_ms != null ? Math.round(Number(r.active_ms) / 1000) : null;
                const dwell = r.dwell_ms != null ? Math.round(Number(r.dwell_ms) / 1000) : null;
                const dur = r.event_type === "page_leave" ? (active != null ? `${active}s ${L("aktívne", "active")}${dwell != null ? ` / ${dwell}s ${L("celkom", "total")}` : ""}` : null) : null;
                return (
                  <div key={ri} style={{ display: "flex", gap: "0.7rem", padding: "0.3rem 0", fontSize: "0.76rem", alignItems: "baseline" }}>
                    <span style={{ fontFamily: mono, fontSize: "0.66rem", color: dim, whiteSpace: "nowrap", minWidth: 52 }}>
                      {new Date(r.created_at).toLocaleTimeString(lang === "sk" ? "sk-SK" : "en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span style={{ color: text }}>{evLabel(r.event_type, lang)}</span>
                      {r.page && <span style={{ color: dim }}> · {r.page}</span>}
                      {dur && <span style={{ color: green, fontFamily: mono, fontSize: "0.68rem" }}> · {dur}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          </>
        )}
      </div>
    </div>
  );
}

// Manual retention control — the admin picks an age cutoff and explicitly deletes
// events older than it. NOTHING is automatic (Boss 2026-07-17). Preview count first,
// then a two-step confirm before the destructive call.
const CUTOFF_DAYS = [30, 90, 180, 365];
function MaintenancePanel({ lang, onDeleted }) {
  const L = (sk, en) => (lang === "sk" ? sk : en);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(180);
  const [count, setCount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [cutoffISO, setCutoffISO] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCount(null); setConfirm(false); setMsg(null); setErr(null);
    const iso = new Date(Date.now() - days * 86400000).toISOString();   // "now" read in the effect, not during render
    setCutoffISO(iso);
    supabaseData.rpc("admin_activity_count_before", { p_before: iso })
      .then(({ data, error }) => { if (!cancelled) { if (error) setErr(error.message || String(error)); else setCount(Number(data)); } });
    return () => { cancelled = true; };
  }, [open, days]);

  const doDelete = async () => {
    if (!cutoffISO) return;
    setBusy(true); setErr(null); setMsg(null);
    const { data, error } = await supabaseData.rpc("admin_delete_activity_before", { p_before: cutoffISO });
    setBusy(false); setConfirm(false);
    if (error) { setErr(error.message || String(error)); return; }
    setMsg(L(`Zmazaných ${fmtN(data, lang)} udalostí.`, `Deleted ${fmtN(data, lang)} events.`));
    setCount(0);
    onDeleted && onDeleted();
  };

  const cutoffLabel = cutoffISO ? new Date(cutoffISO).toLocaleDateString(lang === "sk" ? "sk-SK" : "en-GB", { dateStyle: "medium" }) : "—";

  return (
    <div style={{ margin: "1.6rem 0 0.5rem" }}>
      <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", color: dim, cursor: "pointer", fontFamily: mono, fontSize: "0.72rem", padding: "0.3rem 0" }}>
        {open ? "▾" : "▸"} {L("Údržba — mazanie starých udalostí", "Maintenance — delete old events")}
      </button>
      {open && (
        <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "1rem 1.1rem", marginTop: "0.5rem", maxWidth: 640 }}>
          <p style={{ color: dim, fontSize: "0.78rem", margin: "0 0 0.8rem" }}>
            {L("Nič sa nemaže automaticky. Vyber vek a zmaž len staršie udalosti — ručne, keď chceš.",
               "Nothing is deleted automatically. Pick an age and delete only older events — manually, when you want.")}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.76rem", color: text }}>{L("Zmazať udalosti staršie ako", "Delete events older than")}</span>
            <select value={days} onChange={e => setDays(Number(e.target.value))} disabled={busy}
              style={{ fontFamily: mono, fontSize: "0.76rem", padding: "0.3rem 0.5rem", borderRadius: 7, border: `1px solid ${border}`, background: bg2, color: text }}>
              {CUTOFF_DAYS.map(d => <option key={d} value={d}>{d} {L("dní", "days")}</option>)}
            </select>
            <span style={{ fontSize: "0.72rem", color: dim, fontFamily: mono }}>({L("pred", "before")} {cutoffLabel})</span>
          </div>

          <div style={{ marginTop: "0.8rem", fontSize: "0.8rem", color: text }}>
            {count == null ? <span style={{ color: dim }}>{L("počítam…", "counting…")}</span>
              : <span><strong style={{ color: count > 0 ? orange : dim }}>{fmtN(count, lang)}</strong> {L("udalostí na zmazanie", "events would be deleted")}</span>}
          </div>

          {err && <div style={{ color: red, fontFamily: mono, fontSize: "0.74rem", marginTop: "0.6rem" }}>{err}</div>}
          {msg && <div style={{ color: green, fontFamily: mono, fontSize: "0.74rem", marginTop: "0.6rem" }}>✓ {msg}</div>}

          <div style={{ marginTop: "0.9rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
            {!confirm ? (
              <button onClick={() => setConfirm(true)} disabled={busy || !count}
                style={{ fontFamily: mono, fontSize: "0.76rem", padding: "0.4rem 0.9rem", borderRadius: 8, cursor: (busy || !count) ? "default" : "pointer",
                  border: `1px solid ${count ? red : border}`, background: "transparent", color: count ? red : dim, opacity: (busy || !count) ? 0.5 : 1 }}>
                {L("Zmazať staré udalosti", "Delete old events")}
              </button>
            ) : (
              <>
                <span style={{ fontSize: "0.76rem", color: red }}>{L(`Naozaj zmazať ${fmtN(count, lang)} udalostí? Nedá sa vrátiť.`, `Really delete ${fmtN(count, lang)} events? This can't be undone.`)}</span>
                <button onClick={doDelete} disabled={busy}
                  style={{ fontFamily: mono, fontSize: "0.76rem", padding: "0.4rem 0.9rem", borderRadius: 8, cursor: "pointer", border: `1px solid ${red}`, background: red, color: "#fff", opacity: busy ? 0.6 : 1 }}>
                  {busy ? L("mažem…", "deleting…") : L("Áno, zmazať", "Yes, delete")}
                </button>
                <button onClick={() => setConfirm(false)} disabled={busy}
                  style={{ fontFamily: mono, fontSize: "0.76rem", padding: "0.4rem 0.9rem", borderRadius: 8, cursor: "pointer", border: `1px solid ${border}`, background: "transparent", color: dim }}>
                  {L("Zrušiť", "Cancel")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
