import { useState, useEffect } from "react";
import { useAuth } from "../lib/useAuth";
import { useCapabilities } from "../lib/useCapabilities";
import { useProjects, useProjectFlats, useEarlyAccessStats } from "../lib/useData";
import { supabase } from "../lib/supabase";
import { liveT, ll } from "../lib/liveLang";
import { track } from "../lib/track";
import { isPersonalEmail } from "../lib/emailValidation";
import UpgradePrompt from "../components/UpgradePrompt";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const dim = "#8a8a96";
const border = "#222228";
const bg = "#16161a";

/* ───────────────────── LIVE DASHBOARD ───────────────────── */
const ANON_VISIBLE = 12;
const ANON_TEASER = 8;  // navyše zobrazíme blurred — dokopy 20 riadkov s blurom

export function LiveDashboard({ setCurrent, openLogin, lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const { can } = useCapabilities();
  const { user } = useAuth();
  const { projects, loading } = useProjects();
  const hasFullAccess = can("view_all_projects_list");
  // Anon: 12 plne, ďalších 8 blurred. Logged-in: všetko.
  const clearRows = hasFullAccess ? projects : projects.slice(0, ANON_VISIBLE);
  const blurredRows = hasFullAccess ? [] : projects.slice(ANON_VISIBLE, ANON_VISIBLE + ANON_TEASER);
  const showUpgradeToPaid = can("prompt_upgrade_to_paid");
  const showSignupPrompt = can("prompt_signup");
  // When a logged-in user lands on /live (the marketing teaser) they don't
  // need the teaser — push them into the platform via a small banner.
  const showPlatformHint = !!user && hasFullAccess;

  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 1200, margin: "0 auto" }}>
      {showPlatformHint && (
        <div style={{
          marginBottom: "1.25rem", padding: "0.85rem 1.1rem",
          background: "rgba(0,229,160,0.08)",
          border: "1px solid rgba(0,229,160,0.3)",
          borderRadius: 10,
          display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: "0.88rem", color: "#e8e8ed", flex: 1, lineHeight: 1.4 }}>
            {lang === "sk"
              ? <>Si prihlásený. Toto je verejný náhľad — tvoj plný dashboard je v platforme.</>
              : <>You're signed in. This is the public teaser — your full dashboard lives in the platform.</>}
          </span>
          <button onClick={() => setCurrent && setCurrent("App:Dashboard")} className="btn-p" style={{ fontSize: "0.82rem", padding: "0.55rem 1.1rem" }}>
            {lang === "sk" ? "Otvoriť platformu →" : "Open platform →"}
          </button>
        </div>
      )}
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
              {hasFullAccess
                ? ll(t.projects_title_all, { n: projects.length })
                : ll(t.projects_title_top, { n: ANON_VISIBLE, total: projects.length })}
            </h2>
          </div>
          {showSignupPrompt && <button className="btn-p" onClick={openLogin}>{t.register_for_full}</button>}
        </div>

        {loading ? (
          <div style={{ color: dim, padding: "2rem", textAlign: "center" }}>{t.loading_generic}</div>
        ) : (
          <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden", position: "relative" }}>
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
                    {/* Sold velocity — header viditeľný vždy, obsah blurred pre non-paid */}
                    <th style={{ ...th, textAlign: "right" }} title={can("view_sold_velocity") ? t.tbl_sold_30d_tooltip_paid : t.tbl_sold_30d_tooltip_locked}>
                      {t.tbl_sold_30d}
                      {!can("view_sold_velocity") && <span style={{ marginLeft: 4, color: green, fontSize: "0.6rem" }}>🔒</span>}
                    </th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {clearRows.map(p => <ProjectRow key={p.id} p={p} t={t} lang={lang} setCurrent={setCurrent} canVelocity={can("view_sold_velocity")} />)}

                  {/* Blurred teaser rows — anon only. Vyššia opacity + mäkkší blur,
                      nech je viditeľné že sú tam reálne dáta. */}
                  {blurredRows.length > 0 && blurredRows.map((p) => (
                    <tr key={`blur-${p.id}`} style={{
                      borderTop: `1px solid ${border}`,
                      filter: "blur(5px)",
                      opacity: 0.85,
                      userSelect: "none",
                      pointerEvents: "none",
                      transition: "filter 0.3s",
                    }} aria-hidden="true">
                      <td style={td}><strong>{p.name}</strong></td>
                      <td style={{ ...td, color: dim }}>{p.district || "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{p.total_units}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: green }}>{p.available_units}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: "#f5a623" }}>{p.sold_units}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{p.sold_percentage != null ? `${p.sold_percentage}%` : "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono }}>
                        {p.avg_price_eur_m2 ? Math.round(p.avg_price_eur_m2).toLocaleString("en-US") : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: green }}>+{Math.max(1, Math.min(18, Math.round((p.sold_units || 0) * 0.08) || 5))}</td>
                      <td style={{ ...td, textAlign: "right" }}>—</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Floating CTA card — bez tmavého full-height gradientu, nech je blur viditeľný */}
            {blurredRows.length > 0 && (
              <div style={{
                position: "absolute",
                left: "50%",
                bottom: "1.25rem",
                transform: "translateX(-50%)",
                pointerEvents: "auto",
                textAlign: "center",
                background: "rgba(16,16,18,0.92)",
                backdropFilter: "blur(8px)",
                border: `1px solid rgba(0,229,160,0.3)`,
                borderRadius: 12,
                padding: "1.15rem 1.75rem",
                boxShadow: "0 10px 40px rgba(0,0,0,0.6), 0 0 32px rgba(0,229,160,0.08)",
                maxWidth: "calc(100% - 2rem)",
              }}>
                <div style={{ fontSize: "0.95rem", color: "#e8e8ed", marginBottom: "0.4rem", fontWeight: 500 }}>
                  {lang === "sk"
                    ? <>🔒 Ďalších <strong style={{ color: green }}>{projects.length - ANON_VISIBLE}</strong> projektov po registrácii</>
                    : <>🔒 <strong style={{ color: green }}>{projects.length - ANON_VISIBLE}</strong> more projects with a free account</>}
                </div>
                <div style={{ fontSize: "0.75rem", color: dim, marginBottom: "0.85rem" }}>
                  {lang === "sk" ? "30 sekúnd. Žiadna kreditka." : "Takes 30 seconds. No credit card."}
                </div>
                <button onClick={openLogin} className="btn-p" style={{ fontSize: "0.85rem" }}>
                  {lang === "sk" ? "Zaregistrovať zadarmo →" : "Sign up for free →"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function ProjectRow({ p, t, lang, setCurrent, canVelocity }) {
  const soldDataUnavailable = (p.sold_units || 0) === 0 && (p.reserved_units || 0) === 0 && (p.prereserved_units || 0) === 0;

  // Sold velocity cell — paid vidí reálnu hodnotu, ostatní blurred placeholder
  // (detail pod blurom nemá význam čítať, preto len deterministicky-vyzerajúce číslo).
  // Deterministic fake = stabilné medzi renderingmi, nevznikajú novém čísla na refresh.
  const fakeVelocity = Math.max(1, Math.min(18, Math.round((p.sold_units || 0) * 0.08) || (p.id?.charCodeAt(0) % 12) + 2));
  const velocityCell = canVelocity
    ? (p.sold_last_month != null
        ? <span style={{ color: green, fontWeight: 600 }}>+{p.sold_last_month}</span>
        : <span style={{ color: dim, fontStyle: "italic", fontSize: "0.75rem" }} title={t.tbl_sold_30d_no_data_yet}>—</span>)
    : <span style={{
        filter: "blur(5px)",
        opacity: 0.85,
        userSelect: "none",
        pointerEvents: "none",
        color: green,
        fontWeight: 600,
        display: "inline-block",
      }} aria-hidden="true">+{fakeVelocity}</span>;

  return (
    <tr style={{ borderTop: `1px solid ${border}` }}>
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
      <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{velocityCell}</td>
      <td style={{ ...td, textAlign: "right" }}>
        <button onClick={() => setCurrent && setCurrent(`Project:${p.id}`)} style={miniBtn}>{t.tbl_detail}</button>
      </td>
    </tr>
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
/* Full analytics page — 100% live from Supabase `projects` table, refreshes
   automatically on the monthly sync run. No static/demo numbers anywhere. */
export function LiveAnalytics({ setCurrent, openLogin, lang = "en" }) {
  const { projects, loading } = useProjects();

  if (loading && projects.length === 0) {
    return (
      <main style={{ padding: "5rem 2rem 4rem", maxWidth: 1200, margin: "0 auto", color: dim, fontFamily: mono, fontSize: "0.85rem" }}>
        {lang === "sk" ? "Načítavam analytiku…" : "Loading analytics…"}
      </main>
    );
  }

  // ─── KPIs ────────────────────────────────────────────────
  const totalUnits  = projects.reduce((a, p) => a + (p.total_units || 0), 0);
  const totalAvail  = projects.reduce((a, p) => a + (p.available_units || 0), 0);
  const totalSold   = projects.reduce((a, p) => a + (p.sold_units || 0), 0);
  const totalSold30 = projects.reduce((a, p) => a + (p.sold_last_month || 0), 0);
  const priceEntries = projects.filter(p => p.avg_price_eur_m2 && p.total_units > 0);
  const weightedAvg = priceEntries.length > 0
    ? Math.round(priceEntries.reduce((a, p) => a + p.avg_price_eur_m2 * p.total_units, 0)
                 / priceEntries.reduce((a, p) => a + p.total_units, 0))
    : null;
  const soldOutCount = projects.filter(p => (p.sold_percentage || 0) >= 100).length;
  const absorptionPct = totalAvail > 0 ? Math.round((totalSold30 / (totalAvail + totalSold30)) * 1000) / 10 : 0;

  // ─── Aggregations ────────────────────────────────────────
  const byDistrict = {};
  for (const p of projects) {
    if (!p.district) continue;
    const d = byDistrict[p.district] ||= { district: p.district, count: 0, units: 0, avail: 0, sold: 0, sold30: 0, priceSum: 0, priceN: 0 };
    d.count += 1;
    d.units  += p.total_units || 0;
    d.avail  += p.available_units || 0;
    d.sold   += p.sold_units || 0;
    d.sold30 += p.sold_last_month || 0;
    if (p.avg_price_eur_m2) { d.priceSum += p.avg_price_eur_m2; d.priceN += 1; }
  }
  const districts = Object.values(byDistrict)
    .map(d => ({ ...d, avgPrice: d.priceN ? Math.round(d.priceSum / d.priceN) : null,
                 absorption: d.avail + d.sold30 > 0 ? (d.sold30 / (d.avail + d.sold30)) * 100 : 0 }))
    .sort((a, b) => (b.avgPrice || 0) - (a.avgPrice || 0));

  const byDeveloper = {};
  for (const p of projects) {
    if (!p.developer) continue;
    const d = byDeveloper[p.developer] ||= { developer: p.developer, count: 0, units: 0, sold: 0, sold30: 0, avail: 0 };
    d.count += 1;
    d.units  += p.total_units || 0;
    d.sold   += p.sold_units || 0;
    d.sold30 += p.sold_last_month || 0;
    d.avail  += p.available_units || 0;
  }
  const topDevelopers = Object.values(byDeveloper).sort((a, b) => b.units - a.units).slice(0, 10);

  const topVelocity = [...projects]
    .filter(p => (p.sold_last_month || 0) > 0)
    .sort((a, b) => (b.sold_last_month || 0) - (a.sold_last_month || 0))
    .slice(0, 10);

  const soldOutWatch = projects
    .filter(p => (p.sold_percentage || 0) >= 85 && (p.sold_percentage || 0) < 100 && (p.available_units || 0) > 0)
    .sort((a, b) => (b.sold_percentage || 0) - (a.sold_percentage || 0))
    .slice(0, 8);

  const byRooms = { "1": 0, "2": 0, "3": 0, "4+": 0 };
  // Projects don't store per-room breakdown directly; skip room-level chart
  // without fetching flats. Placeholder: can be added via a PostgreSQL view later.

  // ─── Render ──────────────────────────────────────────────
  return (
    <main style={{ padding: "1rem 2rem 4rem", maxWidth: 1240, margin: "0 auto" }}>
      <p style={{ color: dim, fontSize: "0.95rem", lineHeight: 1.65, marginTop: 0, marginBottom: "1.5rem", maxWidth: 760 }}>
        {lang === "sk"
          ? <>Všetko čo vidíš nižšie je <strong style={{ color: "#e8e8ed" }}>živé</strong> — tiahnuté zo Supabase projektového datasetu. Pri každom mesačnom behu pipeline sa čísla preklopia automaticky.</>
          : <>Everything below is <strong style={{ color: "#e8e8ed" }}>live</strong> from the Supabase project dataset. Every monthly pipeline run refreshes these numbers automatically.</>}
      </p>

      {/* ═══ KPI STRIP ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem", marginBottom: "2rem" }}>
        <AKpi label={lang === "sk" ? "Sledované byty" : "Units tracked"}   value={totalUnits.toLocaleString(lang === "sk" ? "sk-SK" : "en-US")} />
        <AKpi label={lang === "sk" ? "Voľné byty" : "Available"}            value={totalAvail.toLocaleString(lang === "sk" ? "sk-SK" : "en-US")} accent={green} />
        <AKpi label={lang === "sk" ? "Predané (30d)" : "Sold (30d)"}        value={totalSold30 ? `+${totalSold30}` : "—"} accent="#f5a623"
              sub={lang === "sk" ? `${absorptionPct}% absorpcia` : `${absorptionPct}% absorption`} />
        <AKpi label={lang === "sk" ? "Priem. €/m²" : "Avg €/m²"}            value={weightedAvg ? weightedAvg.toLocaleString(lang === "sk" ? "sk-SK" : "en-US") : "—"} />
        <AKpi label={lang === "sk" ? "Vypredané" : "Sold out"}              value={soldOutCount} accent="#ff6b6b"
              sub={lang === "sk" ? `z ${projects.length} projektov` : `of ${projects.length} projects`} />
      </div>

      {/* ═══ DISTRICT BREAKDOWN — richer than home DistrictPulse ═══ */}
      <ASection
        label={lang === "sk" ? "Okresy" : "Districts"}
        title={lang === "sk" ? "Ceny, aktivita a absorpcia podľa okresu" : "Prices, activity and absorption by district"}>
        <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead style={{ background: "#0e0e10" }}>
              <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                <th style={th}>{lang === "sk" ? "Okres" : "District"}</th>
                <th style={{ ...th, textAlign: "right" }}>€/m²</th>
                <th style={{ ...th, textAlign: "right" }}>{lang === "sk" ? "Projektov" : "Projects"}</th>
                <th style={{ ...th, textAlign: "right" }}>{lang === "sk" ? "Bytov" : "Units"}</th>
                <th style={{ ...th, textAlign: "right" }}>{lang === "sk" ? "Voľné" : "Avail"}</th>
                <th style={{ ...th, textAlign: "right" }}>{lang === "sk" ? "Predané 30d" : "Sold 30d"}</th>
                <th style={{ ...th, textAlign: "right" }}>{lang === "sk" ? "Absorpcia" : "Absorption"}</th>
              </tr>
            </thead>
            <tbody>
              {districts.map(d => (
                <tr key={d.district} style={{ borderTop: `1px solid ${border}` }}>
                  <td style={{ ...td, fontWeight: 600 }}>{d.district}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: mono, color: d.avgPrice && d.avgPrice >= 5500 ? "#f5a623" : d.avgPrice && d.avgPrice >= 4200 ? green : "#4a90e2", fontWeight: 600 }}>
                    {d.avgPrice ? d.avgPrice.toLocaleString("en-US").replace(/,/g, " ") : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: mono, color: dim }}>{d.count}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: mono, color: dim }}>{d.units.toLocaleString("en-US").replace(/,/g, " ")}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: mono, color: green }}>{d.avail.toLocaleString("en-US").replace(/,/g, " ")}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: mono, color: d.sold30 > 0 ? "#f5a623" : dim }}>
                    {d.sold30 > 0 ? `+${d.sold30}` : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: mono, color: d.absorption > 5 ? green : dim }}>
                    {d.absorption.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ASection>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(480px, 1fr))", gap: "1.25rem" }}>
        {/* ═══ TOP VELOCITY ═══ */}
        <ASection
          label={lang === "sk" ? "Rýchlosť predaja" : "Sales velocity"}
          title={lang === "sk" ? "Top 10 projektov · posledných 30 dní" : "Top 10 projects · last 30 days"}
          inline>
          {topVelocity.length === 0 ? (
            <div style={{ color: dim, fontSize: "0.85rem", padding: "0.5rem 0" }}>
              {lang === "sk" ? "Zatiaľ žiadne dáta o rýchlosti predaja (populujú sa pri ďalšom behu pipeline)." : "No velocity data yet (populates on the next pipeline run)."}
            </div>
          ) : (
            <RankBarList
              rows={topVelocity.map(p => ({ key: p.id, label: p.name, sub: p.district, value: p.sold_last_month }))}
              setCurrent={setCurrent}
              suffix={lang === "sk" ? " predaných" : " sold"}
              color={green}
            />
          )}
        </ASection>

        {/* ═══ TOP ABSORPTION (% sold) ═══ */}
        <ASection
          label={lang === "sk" ? "Vypredanosť" : "Sell-through"}
          title={lang === "sk" ? "Top 10 podľa % predaných" : "Top 10 by % sold"}
          inline>
          <RankBarList
            rows={[...projects]
              .filter(p => (p.sold_percentage || 0) > 0)
              .sort((a, b) => (b.sold_percentage || 0) - (a.sold_percentage || 0))
              .slice(0, 10)
              .map(p => ({ key: p.id, label: p.name, sub: p.district, value: p.sold_percentage, pct: p.sold_percentage, suffix: "%" }))}
            setCurrent={setCurrent}
            suffix="%"
            color="#f5a623"
          />
        </ASection>

        {/* ═══ TOP DEVELOPERS ═══ */}
        <ASection
          label={lang === "sk" ? "Developeri" : "Developers"}
          title={lang === "sk" ? "Top 10 podľa objemu" : "Top 10 by volume"}
          inline>
          {topDevelopers.length === 0 ? (
            <div style={{ color: dim, fontSize: "0.85rem", padding: "0.5rem 0" }}>
              {lang === "sk" ? "Pole 'developer' zatiaľ nie je vyplnené v DB." : "The `developer` field isn't populated in the DB yet."}
            </div>
          ) : (
            <RankBarList
              rows={topDevelopers.map(d => ({ key: d.developer, label: d.developer, sub: `${d.count} projektov`, value: d.units }))}
              suffix={lang === "sk" ? " bytov" : " units"}
              color="#4a90e2"
            />
          )}
        </ASection>

        {/* ═══ SOLD-OUT WATCH ═══ */}
        <ASection
          label={lang === "sk" ? "Dopredáva sa" : "Selling out"}
          title={lang === "sk" ? "85-99% predaných — posledná šanca" : "85-99% sold — last chance"}
          inline>
          {soldOutWatch.length === 0 ? (
            <div style={{ color: dim, fontSize: "0.85rem", padding: "0.5rem 0" }}>
              {lang === "sk" ? "Žiadny projekt nie je blízko vypredaniu (< 85%)." : "No project is close to sold-out (< 85%)."}
            </div>
          ) : (
            <div>
              {soldOutWatch.map(p => (
                <div key={p.id}
                  onClick={() => setCurrent && setCurrent(`App:ProjectDetail:${p.id}`)}
                  style={{
                    display: "grid", gridTemplateColumns: "1fr auto", gap: "1rem", alignItems: "center",
                    padding: "0.6rem 0.75rem", borderBottom: `1px solid ${border}`, cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,107,107,0.05)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <div>
                    <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "#e8e8ed" }}>{p.name}</div>
                    <div style={{ fontSize: "0.7rem", color: dim, fontFamily: mono, marginTop: 2 }}>
                      {p.district || "—"} · {p.available_units} {lang === "sk" ? "voľných z" : "left of"} {p.total_units}
                    </div>
                  </div>
                  <div style={{ fontFamily: mono, fontSize: "0.85rem", color: "#ff6b6b", fontWeight: 700 }}>
                    {p.sold_percentage.toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </ASection>
      </div>

      <p style={{ color: "#55555f", fontSize: "0.72rem", marginTop: "2rem", fontFamily: mono, textAlign: "center" }}>
        {lang === "sk"
          ? `Zdroj: ${projects.length} projektov · posledný sync ${projects[0]?.last_updated?.slice(0, 10) || "—"}`
          : `Source: ${projects.length} projects · last sync ${projects[0]?.last_updated?.slice(0, 10) || "—"}`}
      </p>
    </main>
  );
}

// ─── Analytics primitives ────────────────────────────────
function AKpi({ label, value, accent = "#e8e8ed", sub }) {
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: "1.1rem 1.2rem" }}>
      <div style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.4rem" }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: "1.8rem", fontWeight: 700, color: accent, letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: "0.7rem", color: dim, marginTop: "0.4rem" }}>{sub}</div>}
    </div>
  );
}

function ASection({ label, title, children, inline = false }) {
  return (
    <section style={{ marginBottom: inline ? 0 : "2rem" }}>
      <div style={{ marginBottom: "0.85rem" }}>
        <div style={{ fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</div>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#e8e8ed", margin: "0.2rem 0 0", letterSpacing: "-0.01em" }}>{title}</h2>
      </div>
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: "1rem 1.1rem" }}>
        {children}
      </div>
    </section>
  );
}

function RankBarList({ rows, setCurrent, suffix = "", color = green }) {
  if (!rows || rows.length === 0) return null;
  const max = Math.max(...rows.map(r => r.value));
  return (
    <div>
      {rows.map((r, i) => {
        const pct = max > 0 ? (r.value / max) * 100 : 0;
        const clickable = setCurrent && r.key && typeof r.key === "string" && r.key !== r.label;
        return (
          <div key={r.key}
            onClick={clickable ? () => setCurrent(`App:ProjectDetail:${r.key}`) : undefined}
            style={{
              display: "grid", gridTemplateColumns: "24px 1fr 72px", gap: "0.75rem", alignItems: "center",
              padding: "0.5rem 0", borderBottom: i < rows.length - 1 ? `1px solid ${border}` : "none",
              cursor: clickable ? "pointer" : "default",
            }}
          >
            <span style={{ fontFamily: mono, fontSize: "0.7rem", color: dim, textAlign: "right" }}>{i + 1}.</span>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.2rem" }}>
                <span style={{ fontSize: "0.83rem", color: "#e8e8ed", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</span>
                {r.sub && <span style={{ fontSize: "0.68rem", color: dim, fontFamily: mono, flexShrink: 0, marginLeft: "0.5rem" }}>{r.sub}</span>}
              </div>
              <div style={{ height: 4, background: "#0a0a0b", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.8s ease" }} />
              </div>
            </div>
            <div style={{ fontFamily: mono, fontSize: "0.85rem", color: color, fontWeight: 700, textAlign: "right" }}>
              {typeof r.value === "number" ? (r.value % 1 !== 0 ? r.value.toFixed(1) : r.value) : r.value}{suffix}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────── ADMIN (guarded v App.jsx cez Feature) ─────────────────────
   Freemium-era admin panel. Signups auto-approve to 'free' so the old
   "approve pending" workflow is mostly vestigial. This panel focuses on
   day-to-day ops:
     - Stats strip (total / free / paid / admin / pending)
     - Search (email / company / name / position)
     - Full user table with inline tier change + delete
     - Self-protection (can't tier-change or delete yourself from UI)
     - Premium domains + activity tabs unchanged from before
*/
export function LiveAdmin({ setCurrent, lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const { user: self } = useAuth();
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [activity, setActivity] = useState([]);
  const [premiumDomains, setPremiumDomains] = useState([]);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState("users");
  const [search, setSearch] = useState("");

  const reloadUsers = () => supabase.from("user_profiles").select("*").order("created_at", { ascending: false })
    .then(({ data, error }) => { setUsers(data || []); if (error) setErr(error.message); });

  useEffect(() => {
    reloadUsers();
    supabase.from("events").select("*").like("event_type", "new_signup%").order("detected_at", { ascending: false }).limit(20)
      .then(({ data }) => setEvents(data || []));
    supabase.from("user_activity").select("*").order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => setActivity(data || []));
    supabase.from("premium_domains").select("*").order("domain")
      .then(({ data }) => setPremiumDomains(data || []));
  }, []);

  const premiumSet = new Set(premiumDomains.map(d => d.domain.toLowerCase()));

  const setTier = async (id, tier) => {
    if (id === self?.id) {
      alert(lang === "sk" ? "Nemôžeš meniť svoj vlastný tier odtiaľto." : "Can't change your own tier from here.");
      return;
    }
    const patch = { tier };
    if (tier !== "pending") patch.approved_at = new Date().toISOString();
    const { error } = await supabase.from("user_profiles").update(patch).eq("id", id);
    if (error) alert(error.message);
    else setUsers(u => u.map(x => x.id === id ? { ...x, ...patch } : x));
  };

  const deleteUser = async (u) => {
    if (u.id === self?.id) {
      alert(lang === "sk" ? "Nemôžeš vymazať sám seba." : "Can't delete yourself.");
      return;
    }
    const confirmText = lang === "sk"
      ? `Vymazať ${u.email} natrvalo? Táto akcia je nezvratná — stratí účet aj všetky dáta.`
      : `Delete ${u.email} permanently? This can't be undone — the account and all their data go.`;
    if (!confirm(confirmText)) return;

    // Needs service-role on backend — calls /api/admin/delete-user with caller's bearer token
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      alert("No session — sign in first.");
      return;
    }
    try {
      const resp = await fetch("/api/admin/delete-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ user_id: u.id }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        alert(`Delete failed: ${json.error || resp.status}`);
        return;
      }
      setUsers(us => us.filter(x => x.id !== u.id));
    } catch (e) {
      alert(`Delete failed: ${String(e.message || e)}`);
    }
  };

  // Filter + stats (memoised via plain consts — small N)
  const q = search.trim().toLowerCase();
  const visibleUsers = !q ? users : users.filter(u => (
    (u.email || "").toLowerCase().includes(q) ||
    (u.full_name || "").toLowerCase().includes(q) ||
    (u.company || "").toLowerCase().includes(q) ||
    (u.position || "").toLowerCase().includes(q)
  ));
  const tierCount = users.reduce((a, u) => { a[u.tier] = (a[u.tier] || 0) + 1; return a; }, {});

  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 1200, margin: "0 auto" }}>
      <Label>{t.admin_label}</Label>
      <h1 className="sec-title">{t.admin_title}</h1>
      {err && <div style={{ color: "#ff6b6b" }}>{err}</div>}

      {/* Tier stats strip */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: "0.75rem", marginTop: "1.5rem", marginBottom: "1rem",
      }}>
        {[
          { k: "total",   label: lang === "sk" ? "Celkom" : "Total",   n: users.length,             color: "#e8e8ed" },
          { k: "free",    label: "Free",                               n: tierCount.free    || 0,    color: "#c0c0c8" },
          { k: "paid",    label: "Paid",                               n: tierCount.paid    || 0,    color: green },
          { k: "admin",   label: "Admin",                              n: tierCount.admin   || 0,    color: "#f5a623" },
          { k: "pending", label: "Pending",                            n: tierCount.pending || 0,    color: "#888" },
        ].map(s => (
          <div key={s.k} style={{
            background: bg, border: `1px solid ${border}`, borderRadius: 10,
            padding: "0.9rem 1.1rem",
          }}>
            <div style={{ fontFamily: mono, fontSize: "0.65rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.3rem" }}>{s.label}</div>
            <div style={{ fontFamily: mono, fontSize: "1.6rem", fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.n}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem", borderBottom: `1px solid ${border}`, marginBottom: "1.5rem" }}>
        <TabBtn active={tab === "users"} onClick={() => setTab("users")}>
          {lang === "sk" ? "Užívatelia" : "Users"}
        </TabBtn>
        <TabBtn active={tab === "activity"} onClick={() => setTab("activity")}>{lang === "sk" ? "Aktivita" : "Activity"}</TabBtn>
        <TabBtn active={tab === "domains"} onClick={() => setTab("domains")}>{lang === "sk" ? "Prémiové domény" : "Premium domains"}</TabBtn>
      </div>

      {tab === "users" && (
        <>
          {/* Search */}
          <div style={{ marginBottom: "1rem", display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={lang === "sk" ? "🔍 Hľadať podľa emailu, mena, firmy, pozície…" : "🔍 Search by email, name, company, position…"}
              style={{
                flex: 1, padding: "0.6rem 0.9rem", background: "#0e0e10",
                border: `1px solid ${border}`, borderRadius: 8, color: "#e8e8ed",
                fontSize: "0.85rem", fontFamily: "inherit", outline: "none",
              }}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{
                background: "transparent", color: dim, border: `1px solid ${border}`,
                borderRadius: 6, padding: "0.5rem 0.85rem", fontSize: "0.75rem",
                cursor: "pointer", fontFamily: "inherit",
              }}>
                {lang === "sk" ? "Zrušiť" : "Clear"}
              </button>
            )}
            <div style={{ fontSize: "0.75rem", color: dim, fontFamily: mono, whiteSpace: "nowrap" }}>
              {visibleUsers.length} / {users.length}
            </div>
          </div>

          {visibleUsers.length === 0 ? (
            <div style={{ color: dim, padding: "1.5rem", fontSize: "0.9rem", textAlign: "center", border: `1px solid ${border}`, borderRadius: 12 }}>
              {search
                ? (lang === "sk" ? `Nikto nevyhovuje hľadaniu "${search}".` : `No users match "${search}".`)
                : (lang === "sk" ? "Žiadni užívatelia zatiaľ." : "No users yet.")}
            </div>
          ) : (
            <UserTable users={visibleUsers} setTier={setTier} deleteUser={deleteUser} selfId={self?.id} t={t} lang={lang} premiumSet={premiumSet} />
          )}

          <p style={{ color: dim, fontSize: "0.78rem", marginTop: "1.25rem", lineHeight: 1.5, fontStyle: "italic" }}>
            {lang === "sk"
              ? "Freemium: noví užívatelia sa automaticky stanú free hneď po vyplnení profilu. Tento panel je hlavne na: bump free → paid, občasné vymazanie testovacích účtov, downgrade do pending (efektívny ban)."
              : "Freemium: new sign-ups auto-approve to free. This panel is mostly for: bumping free → paid, occasional test-account deletion, downgrading to pending (de-facto ban)."}
          </p>

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

function UserTable({ users, setTier, deleteUser, selfId, t, lang, premiumSet = new Set() }) {
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
              <th style={th}>{t.admin_created}</th>
              <th style={{ ...th, textAlign: "right" }}>{t.admin_actions}</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const domain = (u.email_domain || "").toLowerCase();
              const isPersonal = domain && isPersonalEmail(`x@${domain}`);
              const isPremium = premiumSet.has(domain);
              const isSelf = u.id === selfId;
              const rowBg = isSelf
                ? "rgba(245,166,35,0.08)"
                : isPremium ? "rgba(0,229,160,0.05)"
                : isPersonal ? "rgba(245,166,35,0.04)" : "transparent";
              return (
                <tr key={u.id} style={{ borderTop: `1px solid ${border}`, background: rowBg }}>
                  <td style={td}>
                    {u.email}{" "}
                    {isSelf && <span title="That's you" style={{ color: "#f5a623", fontSize: "0.7rem", marginLeft: 4, fontFamily: mono }}>YOU</span>}
                    {isPremium && !isSelf && <span title="Premium domain" style={{ color: green, fontSize: "0.7rem", marginLeft: 4 }}>⭐</span>}
                    {isPersonal && !isSelf && <span title="Personal email" style={{ color: "#f5a623", fontSize: "0.7rem", marginLeft: 4 }}>⚠</span>}
                  </td>
                  <td style={{ ...td, color: dim }}>{u.full_name || "—"}</td>
                  <td style={{ ...td, color: dim }}>{u.company || "—"}</td>
                  <td style={{ ...td, color: dim, fontFamily: mono, fontSize: "0.75rem" }}>{u.position || "—"}</td>
                  <td style={td}><TierBadge tier={u.tier} /></td>
                  <td style={{ ...td, color: dim, fontFamily: mono, fontSize: "0.75rem" }}>{u.created_at?.slice(0, 10)}</td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    <select
                      value={u.tier}
                      onChange={e => setTier(u.id, e.target.value)}
                      disabled={isSelf}
                      title={isSelf ? "Can't change your own tier" : ""}
                      style={{
                        background: "#0e0e10", color: "#e8e8ed",
                        border: `1px solid ${border}`, padding: "0.3rem 0.5rem",
                        borderRadius: 4, fontSize: "0.75rem", marginRight: "0.4rem",
                        opacity: isSelf ? 0.4 : 1, cursor: isSelf ? "not-allowed" : "pointer",
                      }}>
                      <option value="pending">pending</option>
                      <option value="free">free</option>
                      <option value="paid">paid</option>
                      <option value="admin">admin</option>
                    </select>
                    <button
                      onClick={() => deleteUser && deleteUser(u)}
                      disabled={isSelf}
                      title={isSelf ? "Can't delete yourself" : "Delete user (permanent)"}
                      style={{
                        background: "transparent",
                        color: isSelf ? "#55555f" : "#ff6b6b",
                        border: `1px solid ${isSelf ? border : "rgba(255,107,107,0.4)"}`,
                        padding: "0.3rem 0.65rem", borderRadius: 4,
                        fontSize: "0.75rem",
                        cursor: isSelf ? "not-allowed" : "pointer",
                        opacity: isSelf ? 0.4 : 1, fontFamily: "inherit",
                      }}>
                      {lang === "sk" ? "Vymazať" : "Delete"}
                    </button>
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
