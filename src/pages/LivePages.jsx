import { useState, useEffect } from "react";
import { useAuth } from "../lib/useAuth";
import { useCapabilities } from "../lib/useCapabilities";
import { useProjects, useProjectFlats, useEarlyAccessStats } from "../lib/useData";
import { supabase } from "../lib/supabase";
import { liveT, ll } from "../lib/liveLang";
import { track } from "../lib/track";
import UpgradePrompt from "../components/UpgradePrompt";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const dim = "#8a8a96";
const border = "#222228";
const bg = "#16161a";

/* ───────────────────── LIVE DASHBOARD ───────────────────── */
export function LiveDashboard({ setCurrent, openLogin, lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const { can } = useCapabilities();
  const { projects, loading } = useProjects();
  // Ak má cap na "view_all_projects_list" → vidí všetkých. Inak top 20.
  const shown = can("view_all_projects_list") ? projects : projects.slice(0, 20);
  const showUpgradeToPaid = can("prompt_upgrade_to_paid");
  const showSignupPrompt = can("prompt_signup");

  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 1200, margin: "0 auto" }}>
      <Label>{t.live_label}</Label>
      <h1 className="sec-title">{t.live_title}</h1>
      <p className="sec-desc" style={{ marginBottom: "2.5rem" }}>
        {t.live_desc_base}{" "}
        {showSignupPrompt && <>{t.live_desc_anon}</>}
        {showUpgradeToPaid && <> <button onClick={() => setCurrent && setCurrent("Pricing")} style={linkBtn}>{t.upgrade_to_paid}</button> — {t.live_desc_free}</>}
      </p>

      <SummaryCards projects={projects} t={t} />

      <div style={{ marginTop: "3rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div style={labelStyle}>{t.projects_section_label}</div>
            <h2 style={{ fontSize: "1.6rem", fontWeight: 700 }}>
              {can("view_all_projects_list")
                ? ll(t.projects_title_all, { n: projects.length })
                : ll(t.projects_title_top, { n: Math.min(20, projects.length), total: projects.length })}
            </h2>
          </div>
          {showSignupPrompt && <button className="btn-p" onClick={openLogin}>{t.register_for_full}</button>}
        </div>

        {loading ? (
          <div style={{ color: dim, padding: "2rem", textAlign: "center" }}>{t.loading_generic}</div>
        ) : (
          <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead style={{ background: "#0e0e10" }}>
                  <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    <th style={th}>{t.tbl_project}</th>
                    <th style={th}>{t.tbl_district}</th>
                    <th style={{ ...th, textAlign: "right" }}>{t.tbl_units}</th>
                    <th style={{ ...th, textAlign: "right" }}>{t.tbl_available}</th>
                    <th style={{ ...th, textAlign: "right" }}>{t.tbl_sold}</th>
                    <th style={{ ...th, textAlign: "right" }}>{t.tbl_sold_pct}</th>
                    <th style={{ ...th, textAlign: "right" }}>{t.tbl_eur_m2}</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(p => {
                    // Ak projekt nezverejňuje predané (sold=0 AND reserved=0 AND prereserved=0),
                    // % predaných nie je zmysluplné — zobrazíme "n/a" namiesto nepravdivých 0%.
                    const soldDataUnavailable = (p.sold_units || 0) === 0 && (p.reserved_units || 0) === 0 && (p.prereserved_units || 0) === 0;
                    return (
                      <tr key={p.id} style={{ borderTop: `1px solid ${border}` }}>
                        <td style={td}><strong>{p.name}</strong></td>
                        <td style={{ ...td, color: dim }}>{p.district || "—"}</td>
                        <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{p.total_units}</td>
                        <td style={{ ...td, textAlign: "right", fontFamily: mono, color: green }}>{p.available_units}</td>
                        <td style={{ ...td, textAlign: "right", fontFamily: mono, color: soldDataUnavailable ? dim : "#f5a623" }}>
                          {soldDataUnavailable ? "—" : p.sold_units}
                        </td>
                        <td style={{ ...td, textAlign: "right", fontFamily: mono }}>
                          {soldDataUnavailable ? <span style={{ color: dim }}>n/a</span> : (p.sold_percentage != null ? `${p.sold_percentage}%` : "—")}
                        </td>
                        <td style={{ ...td, textAlign: "right", fontFamily: mono }}>
                          {p.avg_price_eur_m2
                            ? Math.round(p.avg_price_eur_m2).toLocaleString(lang === "sk" ? "sk-SK" : "en-US")
                            : <span title={lang === "sk" ? "Developer nezverejňuje ceny" : "Developer doesn't publish prices"} style={{ color: dim, fontStyle: "italic", fontSize: "0.75rem" }}>
                                {lang === "sk" ? "nezverejnené" : "not published"}
                              </span>}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          <button onClick={() => setCurrent && setCurrent(`Project:${p.id}`)} style={miniBtn}>{t.tbl_detail}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showSignupPrompt && projects.length > 20 && (
          <div style={{ textAlign: "center", padding: "1.5rem", color: dim, fontSize: "0.85rem" }}>
            {ll(t.hidden_projects, { n: projects.length - 20 })} <button onClick={openLogin} style={linkBtn}>{t.register_free}</button> {t.for_full_list}
          </div>
        )}
      </div>
    </main>
  );
}

function SummaryCards({ projects, t }) {
  const totals = projects.reduce((acc, p) => {
    acc.total += p.total_units || 0;
    acc.available += p.available_units || 0;
    acc.sold += p.sold_units || 0;
    return acc;
  }, { total: 0, available: 0, sold: 0 });
  const soldOut = projects.filter(p => p.sold_percentage === 100).length;
  const fmt = n => n.toLocaleString(t === liveT.sk ? "sk-SK" : "en-US");

  const Card = ({ label, value, sub }) => (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, background: bg, padding: "1.5rem" }}>
      <div style={{ fontFamily: mono, fontSize: "0.6rem", color: green, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.6rem" }}>{label}</div>
      <div style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.02em", fontFamily: mono }}>{value}</div>
      {sub && <div style={{ fontSize: "0.75rem", color: dim, marginTop: "0.35rem" }}>{sub}</div>}
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
      <Card label={t.card_projects} value={projects.length} sub={t.card_projects_sub} />
      <Card label={t.card_total_units} value={fmt(totals.total)} sub={t.card_total_units_sub} />
      <Card label={t.card_available} value={fmt(totals.available)} sub={t.card_available_sub} />
      <Card label={t.card_sold} value={fmt(totals.sold)} sub={`${t.card_sold_sub_prefix} ${soldOut}`} />
    </div>
  );
}

/* ───────────────────── PROJECT DETAIL (gated) ───────────────────── */
export function LiveProjectDetail({ projectId, setCurrent, openLogin, lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const { user, profile, loading: authLoading, reloadProfile } = useAuth();
  const { can } = useCapabilities();
  const { flats, loading, error } = useProjectFlats(projectId);
  const { projects } = useProjects();
  const project = projects.find(p => p.id === projectId);

  // Track project open
  useEffect(() => {
    if (projectId) track("project_view", { project_id: projectId, project_name: project?.name });
  }, [projectId, project?.name]);

  // Auth session still loading — show spinner, not gate
  if (authLoading || (user && !profile)) {
    return (
      <main style={{ padding: "6rem 2rem 4rem", textAlign: "center", color: dim }}>
        <div style={{ fontSize: "0.85rem", fontFamily: mono }}>Loading…</div>
      </main>
    );
  }

  // Anon → login prompt
  if (!user) {
    return (
      <GateMessage
        title={t.gate_login_title}
        body={t.gate_login_body}
        cta={t.gate_login_cta}
        backLabel={t.back_to_dashboard}
        onCta={openLogin}
        setCurrent={setCurrent}
      />
    );
  }

  // Paid / admin → plný prístup k akémukoľvek projektu
  // Free → detail iba svojho vybraného, inak ChooseProjectGate
  const canViewAnyDetail = can("view_any_project_detail");
  const canViewChosen = can("view_chosen_project_detail");
  const isOwnChosenProject = profile?.chosen_project_id === projectId;
  const canView = canViewAnyDetail || (canViewChosen && isOwnChosenProject);

  if (!canView) {
    // Free user a nevybral si ešte žiadny projekt → ponúkni výber tohto
    // Free user už vybral iný → locked state
    if (can("choose_project")) {
      return (
        <ChooseProjectGate
          projectId={projectId}
          projectName={project?.name || projectId}
          profile={profile}
          reloadProfile={reloadProfile}
          setCurrent={setCurrent}
          t={t}
          lang={lang}
        />
      );
    }
    // Inak (pending) — ale ten už bol odchytený vyššie, safety fallback
    return (
      <GateMessage
        title={t.gate_login_title}
        body={t.gate_login_body}
        cta={t.gate_login_cta}
        backLabel={t.back_to_dashboard}
        onCta={openLogin}
        setCurrent={setCurrent}
      />
    );
  }

  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 1200, margin: "0 auto" }}>
      <button onClick={() => setCurrent && setCurrent("Live")} style={{ ...linkBtn, marginBottom: "1rem" }}>{t.back_to_projects}</button>

      <Label>{project?.district || "Bratislava"}</Label>
      <h1 className="sec-title">{project?.name || projectId}</h1>
      <p className="sec-desc" style={{ marginBottom: "2rem" }}>
        {project ? `${project.total_units} ${t.tbl_units.toLowerCase()} · ${project.available_units} ${t.tbl_available.toLowerCase()} · ${project.sold_percentage ?? "?"}% ${t.tbl_sold.toLowerCase()}` : ""}
        {!can("view_historical_data") && <span style={{ display: "block", marginTop: "0.5rem", color: dim, fontSize: "0.85rem" }}>
          {t.snapshot_notice}{" "}
          <button onClick={() => setCurrent && setCurrent("Pricing")} style={linkBtn}>{t.paid_tier}</button>.
        </span>}
      </p>

      {loading ? <div style={{ color: dim }}>{t.loading_generic}</div> :
        error ? <div style={{ color: "#ff6b6b" }}>Error: {error.message}</div> :
        flats.length === 0 ? <div style={{ color: dim }}>{t.no_data}</div> :
        <FlatsTable flats={flats} t={t} lang={lang} />}
    </main>
  );
}

function FlatsTable({ flats, t, lang }) {
  const stavStyle = {
    V: { color: "#00e5a0", bg: "rgba(0,229,160,0.08)" },
    P: { color: "#f5a623", bg: "rgba(245,166,35,0.08)" },
    R: { color: "#888", bg: "rgba(136,136,136,0.08)" },
    PR: { color: "#aaa", bg: "rgba(170,170,170,0.08)" },
  };
  const locale = lang === "sk" ? "sk-SK" : "en-US";
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead style={{ background: "#0e0e10" }}>
            <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              <th style={th}>{t.tbl_flat}</th>
              <th style={th}>{t.tbl_building}</th>
              <th style={th}>{t.tbl_floor}</th>
              <th style={th}>{t.tbl_rooms}</th>
              <th style={{ ...th, textAlign: "right" }}>{t.tbl_interior}</th>
              <th style={{ ...th, textAlign: "right" }}>{t.tbl_exterior}</th>
              <th style={{ ...th, textAlign: "right" }}>{t.tbl_total}</th>
              <th style={{ ...th, textAlign: "right" }}>{t.tbl_price}</th>
              <th style={th}>{t.tbl_orientation}</th>
              <th style={th}>{t.tbl_handover}</th>
              <th style={th}>{t.tbl_status}</th>
            </tr>
          </thead>
          <tbody>
            {flats.map(f => (
              <tr key={f.id} style={{ borderTop: `1px solid ${border}` }}>
                <td style={td}><strong>{f.unit_detail || f.unit_id}</strong></td>
                <td style={{ ...td, color: dim }}>{f.budova || "—"}</td>
                <td style={{ ...td, fontFamily: mono }}>{f.poschodie ?? "—"}</td>
                <td style={{ ...td, fontFamily: mono }}>{f.izby ?? "—"}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{f.obytna_plocha ? `${f.obytna_plocha} m²` : "—"}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{f.exterier_plocha ?? "—"}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{f.celkova_plocha ?? "—"}</td>
                <td style={{ ...td, textAlign: "right", fontFamily: mono }}>
                  {f.cena_s_dph != null ? `${Math.round(f.cena_s_dph).toLocaleString(locale)} €` :
                    f.cena_s_dph_text ? <span style={{ color: dim }}>{f.cena_s_dph_text}</span> : "—"}
                </td>
                <td style={{ ...td, fontFamily: mono, color: dim }}>{f.orientacia || "—"}</td>
                <td style={{ ...td, fontFamily: mono, color: dim }}>{f.kolaudacia || "—"}</td>
                <td style={td}>
                  {f.stav && stavStyle[f.stav] ? (
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontFamily: mono, fontSize: "0.7rem", fontWeight: 600,
                      color: stavStyle[f.stav].color, background: stavStyle[f.stav].bg,
                    }}>{f.stav}</span>
                  ) : <span style={{ color: dim, fontSize: "0.75rem" }}>{f.stav || "—"}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChooseProjectGate({ projectId, projectName, profile, reloadProfile, setCurrent, t, lang }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const locked = profile?.chosen_project_id && profile.chosen_project_id !== projectId;
  const alreadyThis = profile?.chosen_project_id === projectId;

  const assign = async () => {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.from("user_profiles")
      .update({ chosen_project_id: projectId })
      .eq("id", profile.id)
      .select()
      .maybeSingle();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (!data) {
      setErr(lang === "sk"
        ? "Aktualizácia zlyhala — skús sa odhlásiť a prihlásiť znova."
        : "Update failed — try signing out and back in.");
      return;
    }
    await reloadProfile();
  };

  // Already chose a DIFFERENT project → locked, show explanation
  if (locked) {
    return (
      <main style={{ padding: "6rem 2rem 4rem", maxWidth: 560, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔒</div>
        <h1 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: "0.75rem" }}>
          {lang === "sk" ? "Projekt už vybraný" : "Project already chosen"}
        </h1>
        <p style={{ color: dim, lineHeight: 1.6, marginBottom: "0.75rem" }}>
          {lang === "sk"
            ? <>Tvoj free účet je napojený na projekt <strong style={{ color: green }}>{profile.chosen_project_id}</strong>. Tento výber je uzamknutý — jeden projekt, jeden snapshot.</>
            : <>Your free account is linked to project <strong style={{ color: green }}>{profile.chosen_project_id}</strong>. This choice is locked — one project, one snapshot.</>}
        </p>
        <p style={{ color: dim, fontSize: "0.85rem", marginBottom: "1.5rem" }}>
          {lang === "sk"
            ? <>Pre prístup ku všetkým 60 projektom potrebuješ <button onClick={() => setCurrent("Pricing")} style={linkBtn}>paid tier</button>.</>
            : <>For access to all 60 projects, <button onClick={() => setCurrent("Pricing")} style={linkBtn}>upgrade to paid</button>.</>}
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
          <button className="btn-p" onClick={() => setCurrent(`Project:${profile.chosen_project_id}`)}>
            {lang === "sk" ? "Ísť na môj projekt" : "Go to my project"}
          </button>
          <button className="btn-s" onClick={() => setCurrent("Live")}>{t.back_to_dashboard}</button>
        </div>
      </main>
    );
  }

  if (alreadyThis) {
    // Shouldn't normally reach here (canViewDetail would be true), but safety net
    return null;
  }

  // First assignment — allow
  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 640, margin: "0 auto" }}>
      <Label>{t.choose_label}</Label>
      <h1 className="sec-title">{t.choose_title}</h1>
      <p className="sec-desc" style={{ marginBottom: "1.25rem" }}>
        {lang === "sk"
          ? <>Free účet ti odomkne plný detail <strong style={{ color: green }}>1 projektu</strong>. Chceš sledovať <strong style={{ color: green }}>{projectName}</strong>?</>
          : <>Your free account unlocks full detail of <strong style={{ color: green }}>1 project</strong>. Do you want to track <strong style={{ color: green }}>{projectName}</strong>?</>}
      </p>
      <div style={{ padding: "1rem 1.25rem", background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.3)", borderRadius: 8, marginBottom: "1.25rem", fontSize: "0.85rem", color: "#e8e8ed" }}>
        <strong style={{ color: "#f5a623" }}>⚠ {lang === "sk" ? "Pozor" : "Heads up"}:</strong>{" "}
        {lang === "sk"
          ? "výber je po potvrdení uzamknutý. Budeš vidieť len tento jeden projekt. Pre viac projektov je potrebný paid tier."
          : "this choice is locked once confirmed. You'll only see this one project. More projects require paid tier."}
      </div>
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <button className="btn-p" onClick={assign} disabled={busy}>
          {busy ? t.saving : ll(t.choose_watch, { name: projectName })}
        </button>
        <button className="btn-s" onClick={() => setCurrent("Live")}>{t.choose_back}</button>
      </div>
      {err && <div style={{ color: "#ff6b6b", marginTop: "0.75rem" }}>{err}</div>}
      <p style={{ fontSize: "0.8rem", color: dim, marginTop: "2rem" }}>
        {t.choose_upgrade_hint} <button onClick={() => setCurrent("Pricing")} style={linkBtn}>{t.upgrade_to_paid}</button>.
      </p>
    </main>
  );
}

function GateMessage({ title, body, cta, backLabel, onCta, setCurrent }) {
  return (
    <main style={{ padding: "6rem 2rem 4rem", maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔒</div>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: "0.75rem" }}>{title}</h1>
      <p style={{ color: dim, fontSize: "1rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>{body}</p>
      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
        <button className="btn-p" onClick={onCta}>{cta}</button>
        <button className="btn-s" onClick={() => setCurrent && setCurrent("Live")}>{backLabel}</button>
      </div>
    </main>
  );
}

/* ───────────────────── ANALYTICS (paid only — guarded v App.jsx cez Feature) ───────────────────── */
export function LiveAnalytics({ setCurrent, openLogin, lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 1000, margin: "0 auto" }}>
      <Label>{t.analytics_label}</Label>
      <h1 className="sec-title">{t.analytics_title}</h1>
      <p className="sec-desc">{t.analytics_desc}</p>
      <div style={{ marginTop: "2rem", padding: "3rem", border: `1px dashed ${border}`, borderRadius: 12, textAlign: "center", color: dim }}>
        {t.analytics_placeholder}
      </div>
    </main>
  );
}

/* ───────────────────── ADMIN (guarded v App.jsx cez Feature) ───────────────────── */
export function LiveAdmin({ setCurrent, lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [activity, setActivity] = useState([]);
  const [premiumDomains, setPremiumDomains] = useState([]);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("users");   // users | activity | domains

  useEffect(() => {
    supabase.from("user_profiles").select("*").order("created_at", { ascending: false })
      .then(({ data, error }) => { setUsers(data || []); if (error) setErr(error.message); });
    supabase.from("events").select("*").like("event_type", "new_signup%").order("detected_at", { ascending: false }).limit(20)
      .then(({ data }) => setEvents(data || []));
    supabase.from("user_activity").select("*").order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => setActivity(data || []));
    supabase.from("premium_domains").select("*").order("domain")
      .then(({ data }) => setPremiumDomains(data || []));
  }, []);

  const premiumSet = new Set(premiumDomains.map(d => d.domain.toLowerCase()));

  // Smart approve: premium doména → paid, ostatní → free
  const approveSmart = async (user) => {
    const domain = (user.email_domain || "").toLowerCase();
    const premium = premiumDomains.find(d => d.domain.toLowerCase() === domain);
    const tier = premium?.default_tier || "free";
    await setTier(user.id, tier);
  };

  const setTier = async (id, tier) => {
    const patch = { tier };
    if (tier === "free" || tier === "paid") patch.approved_at = new Date().toISOString();
    const { error } = await supabase.from("user_profiles").update(patch).eq("id", id);
    if (error) alert(error.message); else setUsers(u => u.map(x => x.id === id ? { ...x, ...patch } : x));
  };

  const pending = users.filter(u => u.tier === "pending");
  const rest = users.filter(u => u.tier !== "pending");

  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 1100, margin: "0 auto" }}>
      <Label>{t.admin_label}</Label>
      <h1 className="sec-title">{t.admin_title}</h1>
      {err && <div style={{ color: "#ff6b6b" }}>{err}</div>}

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "2rem", borderBottom: `1px solid ${border}`, marginBottom: "1.5rem" }}>
        <TabBtn active={tab === "users"} onClick={() => setTab("users")}>Users {pending.length > 0 && <CountBadge n={pending.length} />}</TabBtn>
        <TabBtn active={tab === "activity"} onClick={() => setTab("activity")}>Activity</TabBtn>
        <TabBtn active={tab === "domains"} onClick={() => setTab("domains")}>Premium domains</TabBtn>
      </div>

      {tab === "users" && (
        <>
          <SectionHeader>{t.admin_pending_section} {pending.length > 0 && <CountBadge n={pending.length} />}</SectionHeader>
          {pending.length === 0 ? (
            <div style={{ color: dim, padding: "1rem", fontSize: "0.9rem" }}>{t.admin_no_pending}</div>
          ) : (
            <UserTable users={pending} setTier={setTier} approveSmart={approveSmart} showApprove t={t} lang={lang} premiumSet={premiumSet} />
          )}

          {events.length > 0 && (
            <>
              <SectionHeader>{t.admin_events_section}</SectionHeader>
              <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden", marginBottom: "2rem" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                  <thead style={{ background: "#0e0e10" }}>
                    <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      <th style={th}>When</th>
                      <th style={th}>Event</th>
                      <th style={th}>Email</th>
                      <th style={th}>Domain</th>
                      <th style={th}>Org count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map(e => (
                      <tr key={e.id} style={{ borderTop: `1px solid ${border}` }}>
                        <td style={{ ...td, color: dim, fontFamily: mono, fontSize: "0.75rem" }}>{e.detected_at?.slice(0, 16).replace("T", " ")}</td>
                        <td style={td}><EventBadge type={e.event_type} /></td>
                        <td style={td}>{e.new_value?.email || "—"}</td>
                        <td style={{ ...td, color: dim, fontFamily: mono }}>{e.new_value?.domain || "—"}</td>
                        <td style={{ ...td, fontFamily: mono, color: (e.new_value?.org_count || 0) > 3 ? "#f5a623" : dim }}>{e.new_value?.org_count ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <SectionHeader>{t.admin_new_section}</SectionHeader>
          <UserTable users={rest} setTier={setTier} t={t} lang={lang} premiumSet={premiumSet} />
        </>
      )}

      {tab === "activity" && <ActivityPanel activity={activity} users={users} />}
      {tab === "domains" && (
        <PremiumDomainsPanel
          domains={premiumDomains}
          reload={() => supabase.from("premium_domains").select("*").order("domain").then(({ data }) => setPremiumDomains(data || []))}
        />
      )}
    </main>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      background: "none", border: "none", padding: "0.6rem 1rem",
      cursor: "pointer", color: active ? "#e8e8ed" : dim,
      fontSize: "0.88rem", fontWeight: active ? 600 : 500,
      borderBottom: `2px solid ${active ? green : "transparent"}`,
      marginBottom: -1, fontFamily: "inherit",
      display: "inline-flex", alignItems: "center", gap: "0.4rem",
      transition: "color 0.15s",
    }}>{children}</button>
  );
}

function ActivityPanel({ activity, users }) {
  const userById = Object.fromEntries(users.map(u => [u.id, u]));
  // Group by session_id for readability
  return (
    <>
      <SectionHeader>Recent activity (last 100 events)</SectionHeader>
      <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead style={{ background: "#0e0e10" }}>
              <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                <th style={th}>When</th>
                <th style={th}>User</th>
                <th style={th}>Event</th>
                <th style={th}>Page</th>
                <th style={th}>Data</th>
              </tr>
            </thead>
            <tbody>
              {activity.map(e => {
                const u = e.user_id ? userById[e.user_id] : null;
                return (
                  <tr key={e.id} style={{ borderTop: `1px solid ${border}` }}>
                    <td style={{ ...td, color: dim, fontFamily: mono, fontSize: "0.72rem" }}>{e.created_at?.slice(5, 16).replace("T", " ")}</td>
                    <td style={td}>{u?.email || <span style={{ color: dim, fontSize: "0.75rem" }}>anon · {e.session_id?.slice(0, 8)}</span>}</td>
                    <td style={{ ...td, fontFamily: mono, fontSize: "0.72rem", color: "#e8e8ed" }}>{e.event_type}</td>
                    <td style={{ ...td, color: dim, fontFamily: mono, fontSize: "0.72rem" }}>{e.page_path || "—"}</td>
                    <td style={{ ...td, color: dim, fontSize: "0.7rem", fontFamily: mono, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {e.event_data ? JSON.stringify(e.event_data) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {activity.length === 0 && <div style={{ color: dim, padding: "1.5rem", textAlign: "center" }}>No activity yet.</div>}
    </>
  );
}

function PremiumDomainsPanel({ domains, reload }) {
  const [newDomain, setNewDomain] = useState("");
  const [newTier, setNewTier] = useState("paid");
  const [newNote, setNewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const add = async () => {
    if (!newDomain.trim()) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("premium_domains").insert({
      domain: newDomain.trim().toLowerCase(),
      default_tier: newTier,
      note: newNote.trim() || null,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else { setNewDomain(""); setNewNote(""); reload(); }
  };

  const remove = async (domain) => {
    if (!confirm(`Remove ${domain}?`)) return;
    const { error } = await supabase.from("premium_domains").delete().eq("domain", domain);
    if (error) alert(error.message); else reload();
  };

  return (
    <>
      <SectionHeader>Premium domains — auto-tier on approval</SectionHeader>
      <p style={{ color: dim, fontSize: "0.85rem", marginBottom: "1rem", lineHeight: 1.5 }}>
        When you approve a pending user, the system checks their email domain here. If found → auto-sets the chosen tier. Otherwise defaults to <code style={{ color: "#e8e8ed" }}>free</code>.
      </p>

      {/* Add form */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 1fr auto", gap: "0.5rem", alignItems: "center", marginBottom: "1.5rem" }}>
        <input placeholder="example.com" value={newDomain} onChange={e => setNewDomain(e.target.value)}
          style={{ padding: "0.55rem 0.75rem", background: "#0e0e10", border: `1px solid ${border}`, borderRadius: 6, color: "#e8e8ed", fontSize: "0.85rem", fontFamily: "inherit" }} />
        <select value={newTier} onChange={e => setNewTier(e.target.value)}
          style={{ padding: "0.55rem 0.75rem", background: "#0e0e10", border: `1px solid ${border}`, borderRadius: 6, color: "#e8e8ed", fontSize: "0.85rem" }}>
          <option value="paid">paid</option>
          <option value="free">free</option>
          <option value="admin">admin</option>
        </select>
        <input placeholder="note (e.g. Owner org)" value={newNote} onChange={e => setNewNote(e.target.value)}
          style={{ padding: "0.55rem 0.75rem", background: "#0e0e10", border: `1px solid ${border}`, borderRadius: 6, color: "#e8e8ed", fontSize: "0.85rem", fontFamily: "inherit" }} />
        <button onClick={add} disabled={busy || !newDomain.trim()} className="btn-p" style={{ fontSize: "0.8rem", padding: "0.55rem 1.25rem" }}>Add</button>
      </div>
      {err && <div style={{ color: "#ff6b6b", marginBottom: "1rem" }}>{err}</div>}

      {/* Existing */}
      <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead style={{ background: "#0e0e10" }}>
            <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              <th style={th}>Domain</th>
              <th style={th}>Default tier</th>
              <th style={th}>Note</th>
              <th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {domains.map(d => (
              <tr key={d.domain} style={{ borderTop: `1px solid ${border}` }}>
                <td style={{ ...td, fontFamily: mono, fontWeight: 600 }}>{d.domain}</td>
                <td style={td}><TierBadge tier={d.default_tier} /></td>
                <td style={{ ...td, color: dim }}>{d.note || "—"}</td>
                <td style={td}>
                  <button onClick={() => remove(d.domain)} style={{ background: "none", border: `1px solid ${border}`, color: "#ff6b6b", padding: "0.25rem 0.65rem", borderRadius: 4, fontSize: "0.72rem", cursor: "pointer" }}>Remove</button>
                </td>
              </tr>
            ))}
            {domains.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: "center", color: dim, padding: "1.5rem" }}>No premium domains yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function UserTable({ users, setTier, approveSmart, showApprove, t, lang, premiumSet = new Set() }) {
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden", marginBottom: "2rem" }}>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead style={{ background: "#0e0e10" }}>
            <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              <th style={th}>{t.admin_email}</th>
              <th style={th}>Name</th>
              <th style={th}>Company</th>
              <th style={th}>Position</th>
              <th style={th}>{t.admin_tier}</th>
              <th style={th}>{t.admin_project}</th>
              <th style={th}>{t.admin_created}</th>
              <th style={th}>{t.admin_actions}</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const domain = (u.email_domain || "").toLowerCase();
              const isPersonal = domain && ["gmail.com","outlook.com","hotmail.com","yahoo.com","icloud.com","proton.me","protonmail.com"].includes(domain);
              const isPremium = premiumSet.has(domain);
              const rowBg = isPremium ? "rgba(0,229,160,0.05)" : isPersonal ? "rgba(245,166,35,0.04)" : "transparent";
              return (
                <tr key={u.id} style={{ borderTop: `1px solid ${border}`, background: rowBg }}>
                  <td style={td}>
                    {u.email}{" "}
                    {isPremium && <span title="Premium domain → auto-paid on approve" style={{ color: green, fontSize: "0.7rem" }}>⭐</span>}
                    {isPersonal && <span title="Personal email" style={{ color: "#f5a623", fontSize: "0.7rem" }}>⚠</span>}
                  </td>
                  <td style={{ ...td, color: dim }}>{u.full_name || "—"}</td>
                  <td style={{ ...td, color: dim }}>{u.company || "—"}</td>
                  <td style={{ ...td, color: dim, fontFamily: mono, fontSize: "0.75rem" }}>{u.position || "—"}</td>
                  <td style={td}><TierBadge tier={u.tier} /></td>
                  <td style={{ ...td, color: dim, fontFamily: mono, fontSize: "0.75rem" }}>{u.chosen_project_id || "—"}</td>
                  <td style={{ ...td, color: dim, fontFamily: mono, fontSize: "0.75rem" }}>{u.created_at?.slice(0, 10)}</td>
                  <td style={td}>
                    {showApprove ? (
                      <button
                        className="btn-p"
                        style={{ padding: "0.3rem 0.75rem", fontSize: "0.75rem" }}
                        onClick={() => approveSmart ? approveSmart(u) : setTier(u.id, "free")}
                        title={isPremium ? "Premium domain → will set to paid" : "Will set to free"}
                      >
                        {isPremium ? "Approve → paid ⭐" : t.admin_approve}
                      </button>
                    ) : (
                      <select defaultValue={u.tier} onChange={e => setTier(u.id, e.target.value)}
                        style={{ background: "#0e0e10", color: "#e8e8ed", border: `1px solid ${border}`, padding: "0.3rem 0.5rem", borderRadius: 4, fontSize: "0.75rem" }}>
                        <option value="pending">pending</option>
                        <option value="free">free</option>
                        <option value="paid">paid</option>
                        <option value="admin">admin</option>
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SectionHeader({ children }) {
  return <h2 style={{ fontSize: "1rem", fontWeight: 600, color: "#8a8a96", letterSpacing: "0.04em", textTransform: "uppercase", marginTop: "2.5rem", marginBottom: "1rem", fontFamily: mono, display: "flex", alignItems: "center", gap: "0.6rem" }}>{children}</h2>;
}

function CountBadge({ n }) {
  return <span style={{ background: "#f5a623", color: "#0a0a0b", fontSize: "0.7rem", padding: "1px 7px", borderRadius: 10, fontWeight: 700 }}>{n}</span>;
}

function TierBadge({ tier }) {
  const map = {
    paid: "#00e5a0",
    admin: "#f5a623",
    pending: "#888",
    free: "#c0c0c8",
  };
  const c = map[tier] || dim;
  return <span style={{ fontFamily: mono, fontSize: "0.7rem", color: c, border: `1px solid ${c}`, padding: "2px 8px", borderRadius: 4, textTransform: "uppercase", fontWeight: 600 }}>{tier}</span>;
}

function EventBadge({ type }) {
  const m = {
    new_signup: { color: "#00e5a0", label: "NEW" },
    new_signup_personal_email: { color: "#f5a623", label: "PERSONAL EMAIL" },
    new_signup_suspicious_org: { color: "#ff6b6b", label: "SUSPICIOUS ORG" },
  };
  const x = m[type] || { color: dim, label: type };
  return <span style={{ fontFamily: mono, fontSize: "0.65rem", color: x.color, border: `1px solid ${x.color}`, padding: "1px 6px", borderRadius: 3, fontWeight: 700, letterSpacing: "0.05em" }}>{x.label}</span>;
}

/* ───────────────────── EARLY ACCESS BADGE ───────────────────── */
export function EarlyAccessBadge({ lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const { can } = useCapabilities();
  const { remaining_slots } = useEarlyAccessStats();
  // Skry pre paid/admin — nepotrebujú vidieť "early access" marketing.
  if (!can("see_early_access_badge")) return null;
  if (remaining_slots <= 0) return null;
  const tmpl = remaining_slots === 1 ? t.ea_badge_one : t.ea_badge;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: "0.5rem",
      padding: "0.4rem 0.9rem", background: "rgba(0,229,160,0.1)",
      border: "1px solid rgba(0,229,160,0.3)", borderRadius: 999,
      fontFamily: mono, fontSize: "0.7rem", color: green, fontWeight: 600,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: green }}></span>
      {ll(tmpl, { n: remaining_slots })}
    </div>
  );
}

/* ───────────────────── SHARED STYLES ───────────────────── */
function Label({ children }) {
  return <div style={{ ...labelStyle, marginBottom: "1rem" }}>{children}</div>;
}
const labelStyle = { fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.15em", textTransform: "uppercase" };
const th = { padding: "0.75rem 1rem", fontWeight: 600 };
const td = { padding: "0.75rem 1rem", color: "#e8e8ed" };
const linkBtn = { background: "none", border: "none", color: green, cursor: "pointer", padding: 0, fontSize: "inherit", fontFamily: "inherit", textDecoration: "underline" };
const miniBtn = { background: "transparent", border: `1px solid ${border}`, color: "#e8e8ed", padding: "0.35rem 0.75rem", borderRadius: 6, cursor: "pointer", fontSize: "0.75rem" };
