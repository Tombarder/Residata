import { useState, useEffect, useRef } from "react";
import { useAuth } from "../lib/useAuth";
import { useCapabilities } from "../lib/useCapabilities";
import { useProjects, useProjectFlats, useEarlyAccessStats, useProjectSnapshots } from "../lib/useData";
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

/* ── ProtectedData ─────────────────────────────────────────
   Wraps a data region (tables, pivot output, etc.) to discourage
   casual Ctrl+C scraping. This is NOT real DRM — determined users
   can still screenshot, open devtools, view source, etc. The goal
   is to raise the bar enough that competitors can't just paste the
   live dataset into Excel, and to nudge users to the proper CSV
   export channel which respects tier-based limits. Apply SPARINGLY,
   only to the actual data grids — never to nav / headings / KPIs,
   which would hurt legitimate usability. */
function ProtectedData({ children, lang = "en", style, ...rest }) {
  const [toast, setToast] = useState(false);
  const timerRef = useRef(null);
  const show = () => {
    setToast(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToast(false), 2800);
  };
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const block = (e) => { e.preventDefault(); show(); };
  return (
    <div
      onCopy={block}
      onCut={block}
      onDragStart={(e) => e.preventDefault()}
      style={{
        userSelect: "none",
        WebkitUserSelect: "none",
        MozUserSelect: "none",
        msUserSelect: "none",
        position: "relative",
        ...style,
      }}
      {...rest}
    >
      {children}
      {toast && (
        <div style={{
          position: "fixed", bottom: "1.5rem", left: "50%", transform: "translateX(-50%)",
          background: "#0e0e10", border: `1px solid ${green}`, color: "#e8e8ed",
          padding: "0.7rem 1.1rem", borderRadius: 8, fontSize: "0.82rem",
          boxShadow: `0 12px 32px rgba(0,0,0,0.75), 0 0 22px rgba(0,229,160,0.2)`,
          zIndex: 99999, fontFamily: "inherit",
          display: "flex", alignItems: "center", gap: "0.55rem",
          pointerEvents: "none",
          animation: "fadeInUp 0.2s ease",
        }}>
          <span style={{ color: green, fontWeight: 700, fontSize: "0.95rem" }}>⬇</span>
          <span>
            {lang === "sk"
              ? <>Dáta sú chránené. Pre Excel použi <strong style={{ color: green }}>CSV export</strong>.</>
              : <>Data is copy-protected. For Excel use the <strong style={{ color: green }}>CSV export</strong>.</>}
          </span>
          <style>{`@keyframes fadeInUp { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }`}</style>
        </div>
      )}
    </div>
  );
}

/* ───────────────────── LIVE DASHBOARD ───────────────────── */
const ANON_VISIBLE = 12;
const ANON_TEASER = 8;  // navyše zobrazíme blurred — dokopy 20 riadkov s blurom

export function LiveDashboard({ setCurrent, openLogin, lang = "en" }) {
  const t = liveT[lang] || liveT.en;
  const { can } = useCapabilities();
  const { projects: allProjects, loading } = useProjects();
  // Partition projects by status — active goes in the main table, the rest
  // (sold_out / paused / archived) drops into an expandable "Historické"
  // section below so live market numbers aren't diluted. Rows without a
  // status field (legacy) default to 'active' for backward compat with
  // pre-migration data.
  const isActive = (p) => (p.status || "active") === "active";
  const projects = allProjects.filter(isActive);
  const historicalProjects = allProjects.filter(p => !isActive(p));
  const [showHistorical, setShowHistorical] = useState(false);

  const hasFullAccess = can("view_all_projects_list");
  // Anon: 12 plne, ďalších 8 blurred. Logged-in: všetko.
  const clearRows = hasFullAccess ? projects : projects.slice(0, ANON_VISIBLE);
  const blurredRows = hasFullAccess ? [] : projects.slice(ANON_VISIBLE, ANON_VISIBLE + ANON_TEASER);
  const showUpgradeToPaid = can("prompt_upgrade_to_paid");
  const showSignupPrompt = can("prompt_signup");
  // (Previously we showed a "you're signed in, go to platform" banner here
  //  but it was noise — admin/paid users on /live already know they have
  //  access, and the nav already has an "Open platform →" button. If someone
  //  on /live wants the platform, they click that.)

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
          <ProtectedData lang={lang} style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden", position: "relative" }}>
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
          </ProtectedData>
        )}

        {/* Historical projects (sold_out / paused / archived) — collapsed by
            default so the live list stays the focus. Only show for users
            with full access (anon teaser doesn't need another wall). */}
        {hasFullAccess && historicalProjects.length > 0 && (
          <div style={{ marginTop: "1.25rem" }}>
            <button
              onClick={() => setShowHistorical(s => !s)}
              style={{
                width: "100%", padding: "0.7rem 1rem",
                background: "#0e0e10", border: `1px solid ${border}`,
                borderRadius: 8, color: dim, fontFamily: "inherit",
                fontSize: "0.82rem", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = dim; e.currentTarget.style.color = "#e8e8ed"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = dim; }}
            >
              <span>
                <span style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.08em", textTransform: "uppercase", marginRight: "0.75rem" }}>
                  {showHistorical ? "▾" : "▸"} {lang === "sk" ? "Historické" : "Historical"}
                </span>
                {(() => {
                  const so = historicalProjects.filter(p => p.status === "sold_out").length;
                  const pa = historicalProjects.filter(p => p.status === "paused").length;
                  const ar = historicalProjects.filter(p => p.status === "archived").length;
                  const parts = [];
                  if (so) parts.push(`${so} ${lang === "sk" ? "vypredané" : "sold out"}`);
                  if (pa) parts.push(`${pa} ${lang === "sk" ? "pozastavené" : "paused"}`);
                  if (ar) parts.push(`${ar} ${lang === "sk" ? "archív" : "archived"}`);
                  return parts.join(" · ");
                })()}
              </span>
              <span style={{ fontFamily: mono, fontSize: "0.72rem", color: dim }}>
                {historicalProjects.length} {lang === "sk" ? "projektov" : "projects"}
              </span>
            </button>
            {showHistorical && (
              <ProtectedData lang={lang} style={{
                marginTop: "0.6rem", border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden", opacity: 0.92,
              }}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                    <thead style={{ background: "#0e0e10" }}>
                      <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        <th style={th}>{t.tbl_project}</th>
                        <th style={th}>{lang === "sk" ? "Developer" : "Developer"}</th>
                        <th style={th}>{t.tbl_district}</th>
                        <th style={th}>Status</th>
                        <th style={{ ...th, textAlign: "right" }}>{t.tbl_units}</th>
                        <th style={{ ...th, textAlign: "right" }}>{t.tbl_sold_pct}</th>
                        <th style={{ ...th, textAlign: "right" }}>{t.tbl_eur_m2}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicalProjects.map(p => (
                        <tr key={p.id}
                          onClick={() => setCurrent && p.status !== "paused" && setCurrent(`Project:${p.id}`)}
                          style={{
                            borderTop: `1px solid ${border}`,
                            cursor: p.status !== "paused" ? "pointer" : "default",
                            color: dim,
                          }}>
                          <td style={td}><strong style={{ color: "#c4c4cc" }}>{p.name}</strong></td>
                          <td style={td}>{p.developer || "—"}</td>
                          <td style={td}>{p.district || "—"}</td>
                          <td style={td}>
                            <StatusBadge status={p.status} lang={lang} />
                          </td>
                          <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{p.total_units || "—"}</td>
                          <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{p.sold_percentage != null ? `${p.sold_percentage}%` : "—"}</td>
                          <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{p.avg_price_eur_m2 ? Math.round(p.avg_price_eur_m2).toLocaleString("en-US") : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ProtectedData>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/* StatusBadge — 3-state label (sold_out / paused / archived). Active gets no
   badge in the main table — that's the implicit default. Colours:
     sold_out = orange (signals "was live, now done")
     paused   = dim    (signals "data broken, we know about it")
     archived = red-ish (signals "removed from registry") */
function StatusBadge({ status, lang }) {
  const cfg = {
    sold_out: { bg: "rgba(245,166,35,0.12)", fg: "#f5a623", label: lang === "sk" ? "Vypredané" : "Sold out" },
    paused:   { bg: "rgba(138,138,150,0.12)", fg: "#a0a0aa", label: lang === "sk" ? "Pauza"     : "Paused" },
    archived: { bg: "rgba(255,107,107,0.10)", fg: "#ff6b6b", label: lang === "sk" ? "Archív"    : "Archived" },
    active:   { bg: "rgba(0,229,160,0.10)",   fg: green,     label: lang === "sk" ? "Aktívne"   : "Active" },
  };
  const c = cfg[status] || cfg.active;
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 4,
      fontFamily: mono, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.04em",
      color: c.fg, background: c.bg, border: `1px solid ${c.fg}33`,
    }}>{c.label}</span>
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
  // Snapshots drive the MoM time-series charts (timeline, takeup). Cached
  // at module level so nav-ing between projects doesn't refetch.
  const { snapshots } = useProjectSnapshots();
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
        <>
          {project && <ProjectInsights project={project} flats={flats} snapshots={snapshots} lang={lang} />}
          <FlatsTable flats={flats} t={t} lang={lang} />
        </>}
    </main>
  );
}

/* ═══ ProjectInsights ═══ Rich analytics on the per-project detail
   page. Renders a KPI strip + a set of inline-SVG charts computed
   client-side from whatever flats / snapshots we already load — no
   extra backend work. Every chart is self-contained (no deps, just
   React + SVG) so bundle stays small. */
function ProjectInsights({ project, flats, snapshots, lang }) {
  const locale = lang === "sk" ? "sk-SK" : "en-US";
  const fmtEur = (v) => v == null || !Number.isFinite(v) ? "—" : `${Math.round(v).toLocaleString("en-US").replace(/,/g, " ")} €`;
  const fmtPct = (v) => v == null || !Number.isFinite(v) ? "—" : `${(Math.round(v * 10) / 10).toFixed(1)}%`;
  const L = (sk, en) => lang === "sk" ? sk : en;

  // ── Data prep ─────────────────────────────────────────────────
  const projectSnaps = (snapshots || [])
    .filter(s => s.project_id === project.id)
    .sort((a, b) => String(a.snapshot_month).localeCompare(String(b.snapshot_month)));
  const latestSnap = projectSnaps.at(-1);
  const prevSnap = projectSnaps.length >= 2 ? projectSnaps.at(-2) : null;

  // Price-per-m² MoM delta (if we have ≥ 2 months)
  const pricemomDelta = latestSnap && prevSnap && latestSnap.avg_price_eur_m2 && prevSnap.avg_price_eur_m2
    ? latestSnap.avg_price_eur_m2 - prevSnap.avg_price_eur_m2 : null;

  // Flats numeric helpers
  const availFlats = flats.filter(f => f.stav === "V");
  const availPrices = availFlats.map(f => Number(f.cena_s_dph)).filter(Number.isFinite);
  const topPrice = availPrices.length ? Math.max(...availPrices) : null;

  // Room-type breakdown — group by izby, compute sold % per group.
  // "Fastest-moving" = highest sold/total ratio (signals market validation).
  const byRoom = {};
  for (const f of flats) {
    const k = f.izby == null ? "?" : String(f.izby);
    byRoom[k] = byRoom[k] || { room: k, total: 0, sold: 0, avail: 0, reserved: 0 };
    byRoom[k].total += 1;
    if (f.stav === "P")  byRoom[k].sold += 1;
    else if (f.stav === "V") byRoom[k].avail += 1;
    else if (f.stav === "R" || f.stav === "PR") byRoom[k].reserved += 1;
  }
  const roomRows = Object.values(byRoom)
    .filter(r => r.room !== "?" && r.total >= 2)
    .sort((a, b) => Number(a.room) - Number(b.room));
  const fastestRoom = [...roomRows]
    .filter(r => r.total >= 3)
    .sort((a, b) => (b.sold / b.total) - (a.sold / a.total))[0];

  // ── KPI strip ─────────────────────────────────────────────────
  const kpis = [
    {
      label: L("Voľné byty", "Available units"),
      value: project.available_units ?? "—",
      sub: project.total_units ? `${fmtPct(((project.available_units || 0) / project.total_units) * 100)} ${L("z celku", "of total")}` : null,
      tint: green,
    },
    {
      label: L("Priem. €/m²", "Avg €/m²"),
      value: project.avg_price_eur_m2 ? Math.round(project.avg_price_eur_m2).toLocaleString("en-US").replace(/,/g, " ") : "—",
      sub: pricemomDelta != null
        ? (pricemomDelta > 0
            ? <span style={{ color: "#f5a623" }}>+{Math.round(pricemomDelta)} €/m² {L("MoM", "MoM")}</span>
            : pricemomDelta < 0
              ? <span style={{ color: green }}>{Math.round(pricemomDelta)} €/m² {L("MoM", "MoM")}</span>
              : <span style={{ color: dim }}>{L("bez zmeny", "no change")} MoM</span>)
        : L("žiadna história", "no history yet"),
      tint: "#e8e8ed",
    },
    {
      label: L("Najrýchlejšie sa predáva", "Fastest moving"),
      value: fastestRoom ? `${fastestRoom.room}-${L("izb", "room")}` : "—",
      sub: fastestRoom ? `${fmtPct((fastestRoom.sold / fastestRoom.total) * 100)} ${L("predané", "sold")}` : null,
      tint: "#f5a623",
    },
    {
      label: L("Najdrahší voľný", "Priciest available"),
      value: topPrice ? fmtEur(topPrice) : "—",
      sub: availPrices.length ? `${availPrices.length} ${L("voľných s cenou", "with price")}` : null,
      tint: "#e8e8ed",
    },
  ];

  return (
    <section style={{ marginBottom: "2rem" }}>
      <div style={{ fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.85rem" }}>
        {L("Prehľad projektu", "Project insights")}
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.8rem", marginBottom: "1.5rem" }}>
        {kpis.map((k, i) => (
          <div key={i} style={{
            background: bg, border: `1px solid ${border}`, borderRadius: 10,
            padding: "1rem 1.1rem",
          }}>
            <div style={{ fontFamily: mono, fontSize: "0.58rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.45rem" }}>
              {k.label}
            </div>
            <div style={{ fontFamily: mono, fontSize: "1.65rem", fontWeight: 700, color: k.tint, letterSpacing: "-0.02em", lineHeight: 1 }}>
              {k.value}
            </div>
            {k.sub && <div style={{ fontSize: "0.72rem", color: dim, marginTop: "0.45rem" }}>{k.sub}</div>}
          </div>
        ))}
      </div>

      {/* Charts grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }} className="insights-grid">
        {projectSnaps.length >= 2 && (
          <ChartCard title={L("Timeline — voľné vs. predané", "Timeline — available vs sold")}
            subtitle={L(`${projectSnaps.length} mesiacov histórie`, `${projectSnaps.length} months of history`)}>
            <TimelineChart snaps={projectSnaps} lang={lang} />
          </ChartCard>
        )}
        {projectSnaps.length >= 2 && (
          <ChartCard title={L("Mesačná absorpcia (take-up)", "Monthly take-up")}
            subtitle={L("Δ predaných v každom mesiaci", "Δ sold units per month")}>
            <TakeupChart snaps={projectSnaps} lang={lang} />
          </ChartCard>
        )}
        {roomRows.length > 0 && (
          <ChartCard title={L("Mix po izbách", "Room-type mix")}
            subtitle={L("Predané / rezervované / voľné", "Sold / reserved / available")}>
            <RoomMixChart rows={roomRows} lang={lang} />
          </ChartCard>
        )}
        {availPrices.length >= 5 && (
          <ChartCard title={L("Rozdelenie cien voľných bytov", "Price distribution — available units")}
            subtitle={L(`Medián ${fmtEur(median(availPrices))}`, `Median ${fmtEur(median(availPrices))}`)}>
            <PriceHistogram prices={availPrices} lang={lang} />
          </ChartCard>
        )}
      </div>

      {flats.length >= 5 && (
        <ChartCard title={L("Plocha × cena (všetky byty)", "Area × price (all units)")}
          subtitle={L("Každý bod = 1 byt · sklon ~ priemerná €/m²", "Each dot = 1 unit · slope ≈ avg €/m²")}>
          <AreaPriceScatter flats={flats} lang={lang} />
        </ChartCard>
      )}

      <style>{`
        @media (max-width: 760px) { .insights-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </section>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <div style={{
      background: bg, border: `1px solid ${border}`, borderRadius: 10,
      padding: "1rem 1.1rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.85rem", gap: "0.5rem" }}>
        <div style={{ fontSize: "0.88rem", color: "#e8e8ed", fontWeight: 600 }}>{title}</div>
        {subtitle && <div style={{ fontSize: "0.7rem", color: dim, fontFamily: mono }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

/* ── Timeline: two lines over months (available ↓, sold ↑) ─── */
function TimelineChart({ snaps, lang }) {
  const W = 460, H = 180, pad = { l: 36, r: 10, t: 10, b: 28 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const xs = snaps.map(s => s.snapshot_month);
  const avail = snaps.map(s => s.available_units || 0);
  const sold = snaps.map(s => s.sold_units || 0);
  const yMax = Math.max(1, ...avail, ...sold);
  const xAt = (i) => pad.l + (innerW * i) / Math.max(1, snaps.length - 1);
  const yAt = (v) => pad.t + innerH - (innerH * v) / yMax;

  const lineAvail = avail.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(v)}`).join(" ");
  const lineSold  = sold.map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i)} ${yAt(v)}`).join(" ");
  const areaAvail = `${lineAvail} L ${xAt(snaps.length - 1)} ${pad.t + innerH} L ${xAt(0)} ${pad.t + innerH} Z`;

  // Y-axis ticks — 4 gridlines
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => ({
    y: pad.t + innerH - innerH * t,
    label: Math.round(yMax * t),
  }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={pad.l} x2={W - pad.r} y1={t.y} y2={t.y} stroke={border} strokeWidth={1} />
          <text x={pad.l - 6} y={t.y + 3} textAnchor="end" fill={dim} fontFamily={mono} fontSize={9}>{t.label}</text>
        </g>
      ))}
      {/* X-axis labels — first, middle, last */}
      {[0, Math.floor((snaps.length - 1) / 2), snaps.length - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => (
        <text key={i} x={xAt(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === snaps.length - 1 ? "end" : "middle"}
          fill={dim} fontFamily={mono} fontSize={10}>{xs[i]}</text>
      ))}
      {/* Area under available */}
      <path d={areaAvail} fill={green} opacity={0.08} />
      {/* Lines */}
      <path d={lineAvail} fill="none" stroke={green} strokeWidth={2} />
      <path d={lineSold}  fill="none" stroke="#f5a623" strokeWidth={2} />
      {/* Dots */}
      {avail.map((v, i) => (<circle key={`a${i}`} cx={xAt(i)} cy={yAt(v)} r={3} fill={green} />))}
      {sold.map((v, i) => (<circle key={`s${i}`} cx={xAt(i)} cy={yAt(v)} r={3} fill="#f5a623" />))}
      {/* Legend */}
      <g transform={`translate(${pad.l}, ${pad.t - 2})`}>
        <circle cx={4} cy={4} r={3} fill={green} /><text x={12} y={7} fill={dim} fontFamily={mono} fontSize={10}>{lang === "sk" ? "voľné" : "available"}</text>
        <circle cx={72} cy={4} r={3} fill="#f5a623" /><text x={80} y={7} fill={dim} fontFamily={mono} fontSize={10}>{lang === "sk" ? "predané" : "sold"}</text>
      </g>
    </svg>
  );
}

/* ── Takeup: bar chart of Δsold per month ──────────────────── */
function TakeupChart({ snaps, lang }) {
  const W = 460, H = 180, pad = { l: 36, r: 10, t: 10, b: 28 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  // Δ = sold[i] - sold[i-1] for i >= 1
  const deltas = [];
  for (let i = 1; i < snaps.length; i++) {
    const d = (snaps[i].sold_units || 0) - (snaps[i - 1].sold_units || 0);
    deltas.push({ month: snaps[i].snapshot_month, delta: d });
  }
  if (deltas.length === 0) return <div style={{ color: dim, fontSize: "0.8rem", textAlign: "center", padding: "1rem" }}>—</div>;
  const yMax = Math.max(1, ...deltas.map(d => Math.abs(d.delta)));
  const barW = innerW / deltas.length * 0.7;
  const gapW = innerW / deltas.length * 0.3;
  const zeroY = pad.t + innerH / 2;
  const yAt = (v) => zeroY - (innerH / 2) * (v / yMax);
  const avg = deltas.reduce((a, d) => a + d.delta, 0) / deltas.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
      {/* Zero line */}
      <line x1={pad.l} x2={W - pad.r} y1={zeroY} y2={zeroY} stroke={border} strokeWidth={1} />
      {/* Average line (dashed) */}
      <line x1={pad.l} x2={W - pad.r} y1={yAt(avg)} y2={yAt(avg)} stroke={dim} strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
      <text x={W - pad.r - 3} y={yAt(avg) - 3} textAnchor="end" fill={dim} fontFamily={mono} fontSize={9}>∅ {avg.toFixed(1)}</text>
      {/* Bars */}
      {deltas.map((d, i) => {
        const x = pad.l + (innerW * i) / deltas.length + gapW / 2;
        const isBest = d.delta === Math.max(...deltas.map(x => x.delta)) && d.delta > 0;
        const color = d.delta > 0 ? (isBest ? green : `${green}aa`) : d.delta < 0 ? "#ff9b6b" : dim;
        const y = Math.min(zeroY, yAt(d.delta));
        const height = Math.abs(yAt(d.delta) - zeroY);
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={Math.max(1, height)} fill={color} rx={2} />
            <text x={x + barW / 2} y={zeroY + 12} textAnchor="middle" fill={dim} fontFamily={mono} fontSize={8}>
              {d.month.slice(5)}
            </text>
            {Math.abs(d.delta) >= 2 && (
              <text x={x + barW / 2} y={d.delta > 0 ? y - 3 : y + height + 9} textAnchor="middle" fill={color} fontFamily={mono} fontSize={9} fontWeight={700}>
                {d.delta > 0 ? `+${d.delta}` : d.delta}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Room mix: horizontal stacked bars per room type ──────── */
function RoomMixChart({ rows, lang }) {
  const W = 460, rowH = 26, gap = 6, labelW = 60, valueW = 80;
  const barW = W - labelW - valueW - 20;
  const H = rows.length * (rowH + gap) + 8;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {rows.map((r, i) => {
        const y = i * (rowH + gap);
        const pct = r.total > 0 ? {
          sold: r.sold / r.total * 100,
          reserved: r.reserved / r.total * 100,
          avail: r.avail / r.total * 100,
        } : { sold: 0, reserved: 0, avail: 0 };
        const soldW = (pct.sold / 100) * barW;
        const resvW = (pct.reserved / 100) * barW;
        const availW = (pct.avail / 100) * barW;
        return (
          <g key={r.room}>
            <text x={0} y={y + rowH / 2 + 4} fill="#e8e8ed" fontFamily={mono} fontSize={11} fontWeight={700}>
              {r.room}-{lang === "sk" ? "izb" : "room"}
            </text>
            <rect x={labelW} y={y} width={barW} height={rowH} fill="#0a0a0b" stroke={border} />
            {soldW > 0 && <rect x={labelW} y={y} width={soldW} height={rowH} fill="#f5a623" />}
            {resvW > 0 && <rect x={labelW + soldW} y={y} width={resvW} height={rowH} fill="#888" />}
            {availW > 0 && <rect x={labelW + soldW + resvW} y={y} width={availW} height={rowH} fill={green} />}
            <text x={W - 4} y={y + rowH / 2 + 4} textAnchor="end" fill={dim} fontFamily={mono} fontSize={10}>
              {r.sold}/{r.total} · {Math.round(pct.sold)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── Price histogram — 10 bins of available flat prices ──── */
function PriceHistogram({ prices }) {
  const W = 460, H = 180, pad = { l: 36, r: 10, t: 10, b: 28 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const min = Math.min(...prices), max = Math.max(...prices);
  const bins = 10;
  const binW = (max - min) / bins || 1;
  const counts = Array(bins).fill(0);
  for (const p of prices) {
    const i = Math.min(bins - 1, Math.floor((p - min) / binW));
    counts[i] += 1;
  }
  const yMax = Math.max(...counts);
  const med = median(prices);
  const medX = pad.l + (innerW * (med - min)) / (max - min || 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
      {counts.map((c, i) => {
        const x = pad.l + (innerW * i) / bins;
        const w = (innerW / bins) - 2;
        const h = (c / yMax) * innerH;
        const y = pad.t + innerH - h;
        return <rect key={i} x={x + 1} y={y} width={w} height={h} fill={green} opacity={0.6} rx={2} />;
      })}
      {/* Median vertical line */}
      <line x1={medX} x2={medX} y1={pad.t} y2={pad.t + innerH} stroke="#f5a623" strokeWidth={2} strokeDasharray="4,3" />
      <text x={medX + 5} y={pad.t + 10} fill="#f5a623" fontFamily={mono} fontSize={10}>medián</text>
      {/* Axis labels */}
      <text x={pad.l} y={H - 8} fill={dim} fontFamily={mono} fontSize={10}>{`${Math.round(min / 1000)}k €`}</text>
      <text x={W - pad.r} y={H - 8} textAnchor="end" fill={dim} fontFamily={mono} fontSize={10}>{`${Math.round(max / 1000)}k €`}</text>
    </svg>
  );
}

/* ── Scatter: area_m² (X) × price_€ (Y), dot per unit ──── */
function AreaPriceScatter({ flats, lang }) {
  const W = 940, H = 260, pad = { l: 50, r: 16, t: 12, b: 36 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const points = flats
    .map(f => ({
      x: Number(f.obytna_plocha || f.celkova_plocha),
      y: Number(f.cena_s_dph),
      stav: f.stav,
    }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x > 0 && p.y > 0);
  if (points.length === 0) return <div style={{ color: dim, fontSize: "0.8rem", textAlign: "center", padding: "1rem" }}>—</div>;

  const xMin = Math.min(...points.map(p => p.x)), xMax = Math.max(...points.map(p => p.x));
  const yMin = Math.min(...points.map(p => p.y)), yMax = Math.max(...points.map(p => p.y));
  const xAt = (v) => pad.l + ((v - xMin) / (xMax - xMin || 1)) * innerW;
  const yAt = (v) => pad.t + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  // Fit: avg €/m² line — from (xMin, xMin * avg_per_m2) to (xMax, xMax * avg_per_m2)
  const sumPrice = points.reduce((a, p) => a + p.y, 0);
  const sumArea  = points.reduce((a, p) => a + p.x, 0);
  const avgPerM2 = sumArea > 0 ? sumPrice / sumArea : 0;

  const colorFor = (stav) => stav === "V" ? green : stav === "P" ? "#f5a623" : stav === "R" || stav === "PR" ? "#888" : dim;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}>
      {/* Grid: 3 vertical + 3 horizontal */}
      {[0.25, 0.5, 0.75].map((t, i) => (
        <g key={i}>
          <line x1={pad.l + innerW * t} x2={pad.l + innerW * t} y1={pad.t} y2={pad.t + innerH} stroke={border} strokeWidth={1} />
          <line x1={pad.l} x2={pad.l + innerW} y1={pad.t + innerH * t} y2={pad.t + innerH * t} stroke={border} strokeWidth={1} />
        </g>
      ))}
      {/* Fit line */}
      {avgPerM2 > 0 && (
        <line x1={xAt(xMin)} x2={xAt(xMax)} y1={yAt(xMin * avgPerM2)} y2={yAt(xMax * avgPerM2)}
          stroke="#e8e8ed" strokeWidth={1.5} strokeDasharray="5,4" opacity={0.5} />
      )}
      {/* Points */}
      {points.map((p, i) => (
        <circle key={i} cx={xAt(p.x)} cy={yAt(p.y)} r={4} fill={colorFor(p.stav)} opacity={0.75}>
          <title>{`${p.x} m² · ${Math.round(p.y).toLocaleString("en-US").replace(/,/g, " ")} € · ${p.stav || "?"}`}</title>
        </circle>
      ))}
      {/* Axis labels */}
      <text x={pad.l} y={H - 12} fill={dim} fontFamily={mono} fontSize={10}>{`${Math.round(xMin)} m²`}</text>
      <text x={W - pad.r} y={H - 12} textAnchor="end" fill={dim} fontFamily={mono} fontSize={10}>{`${Math.round(xMax)} m²`}</text>
      <text x={pad.l - 6} y={pad.t + 10} textAnchor="end" fill={dim} fontFamily={mono} fontSize={10} transform={`rotate(-90 ${pad.l - 6} ${pad.t + 10})`}>
        {`${Math.round(yMax / 1000)}k €`}
      </text>
      <text x={pad.l - 6} y={pad.t + innerH} textAnchor="end" fill={dim} fontFamily={mono} fontSize={10} transform={`rotate(-90 ${pad.l - 6} ${pad.t + innerH})`}>
        {`${Math.round(yMin / 1000)}k €`}
      </text>
      {/* Legend */}
      <g transform={`translate(${pad.l + 8}, ${pad.t + 12})`}>
        <circle cx={4} cy={4} r={3} fill={green} /><text x={12} y={7} fill={dim} fontFamily={mono} fontSize={10}>{lang === "sk" ? "voľné" : "available"}</text>
        <circle cx={72} cy={4} r={3} fill="#f5a623" /><text x={80} y={7} fill={dim} fontFamily={mono} fontSize={10}>{lang === "sk" ? "predané" : "sold"}</text>
        <circle cx={132} cy={4} r={3} fill="#888" /><text x={140} y={7} fill={dim} fontFamily={mono} fontSize={10}>{lang === "sk" ? "rezervované" : "reserved"}</text>
      </g>
    </svg>
  );
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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
    <ProtectedData lang={lang} style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
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
    </ProtectedData>
  );
}

function ChooseProjectGate({ projectId, projectName, profile, reloadProfile, setCurrent, t, lang }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const locked = profile?.chosen_project_id && profile.chosen_project_id !== projectId;
  const alreadyThis = profile?.chosen_project_id === projectId;

  const assign = async () => {
    setBusy(true); setErr(null);
    console.log("[ChooseProject] assign start", { userId: profile?.id, projectId });
    const t0 = performance.now();

    // Hard-reload safety net — if for any reason the async chain stalls
    // (stale session, network blip), force a reload to /live so the user
    // never sees a permanent "Saving…" button.
    const fallback = setTimeout(() => {
      console.warn("[ChooseProject] slow — forcing hard reload");
      window.location.reload();
    }, 10000);

    try {
      // Step 1: UPDATE. We deliberately DON'T chain .select().maybeSingle()
      // here — the SELECT back is an extra round-trip that can return null
      // under RLS / PostgREST edge cases even when the UPDATE succeeded,
      // and then the user sees a misleading "Update failed". Instead we
      // rely on reloadProfile() below to confirm the new state.
      const { error: updErr } = await supabase.from("user_profiles")
        .update({ chosen_project_id: projectId })
        .eq("id", profile.id);
      console.log(`[ChooseProject] UPDATE returned after ${Math.round(performance.now() - t0)}ms`, { updErr });
      if (updErr) throw new Error(updErr.message);

      // Step 2: Refresh profile from DB. This is the source of truth.
      //  - If chosen_project_id now matches, we're good → <LiveProjectDetail>
      //    re-renders with canView=true and ChooseProjectGate unmounts.
      //  - If it doesn't match, the UPDATE silently failed (RLS) and we
      //    surface that to the user instead of leaving them on a dead page.
      await reloadProfile();
      console.log(`[ChooseProject] done after ${Math.round(performance.now() - t0)}ms`);
      clearTimeout(fallback);
      // Hard redirect to /live — React should re-render ChooseProjectGate
      // into LiveProjectDetail automatically once profile state updates,
      // but in practice React's state propagation is occasionally slow
      // enough that the user sees a blank frame. Navigating explicitly
      // is cheap insurance.
      setCurrent && setCurrent(`Project:${projectId}`);
    } catch (e) {
      console.error("[ChooseProject] exception", e);
      clearTimeout(fallback);
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
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
/* Full analytics page — 100% live from Supabase, refreshes automatically
   on the monthly sync run. KPI strip + aggregate tables use projects
   (current snapshot). The Pivot builder uses project_snapshots so users
   can filter / group by month across the whole time-series. */
export function LiveAnalytics({ setCurrent, openLogin, lang = "en" }) {
  const { projects, loading } = useProjects();
  const { snapshots } = useProjectSnapshots();

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

      {/* ═══ PIVOT BUILDER — prominent, right after KPIs ═══ */}
      <AnalyticsPivot snapshots={snapshots} projects={projects} lang={lang} />

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

// ═════════════ PIVOT / QUERY BUILDER (FLEXIBLE) ═════════════
// "Any column for filter/group/measure" pivot over the projects table.
// Text columns → string ops (is / contains / in). Number columns → range
// and comparison ops. Derived "band" columns (price_band, sold_band,
// size_band) are computed at group time from the underlying numeric
// fields. Multiple group-bys stack into composite keys. CSV export
// always matches what the table shows.

const PIVOT_COLUMNS = {
  // Snapshot month — YYYY-MM. Defaults to latest; full history
  // automatically grows as monthly syncs append new rows.
  snapshot_month: { label: { en: "Month (snapshot)", sk: "Mesiac (snapshot)" }, type: "text" },
  // Status — active / sold_out / paused / archived. Defaults applied at
  // the top of AnalyticsPivot as a filter with value "active" so users
  // don't get KPI pollution from historical rows on first open.
  status:       { label: { en: "Status",           sk: "Status"           }, type: "text" },
  // Text
  district:     { label: { en: "District",         sk: "Okres"            }, type: "text" },
  sub_district: { label: { en: "Sub-district",     sk: "Mestská časť"     }, type: "text" },
  developer:    { label: { en: "Developer",        sk: "Developer"        }, type: "text" },
  kolaudacia:   { label: { en: "Completion",       sk: "Kolaudácia"       }, type: "text" },
  name:         { label: { en: "Project",          sk: "Projekt"          }, type: "text" },
  // Number
  total_units:       { label: { en: "Total units",       sk: "Celkom bytov"        }, type: "number" },
  available_units:   { label: { en: "Available",         sk: "Voľné"               }, type: "number" },
  sold_units:        { label: { en: "Sold (total)",      sk: "Predané (celkom)"    }, type: "number" },
  sold_last_month:   { label: { en: "Sold 30d",          sk: "Predané 30d"         }, type: "number" },
  avg_price_eur_m2:  { label: { en: "Avg €/m²",          sk: "Priem. €/m²"         }, type: "number" },
  min_price:         { label: { en: "Min price",         sk: "Min cena"            }, type: "number" },
  max_price:         { label: { en: "Max price",         sk: "Max cena"            }, type: "number" },
  sold_percentage:   { label: { en: "% sold",            sk: "% predané"           }, type: "number" },
  // Derived (computed)
  price_band:   { label: { en: "Price band",    sk: "Cenové pásmo"        }, type: "derived", from: "avg_price_eur_m2" },
  sold_band:    { label: { en: "% sold band",   sk: "% predaných pásmo"   }, type: "derived", from: "sold_percentage" },
  size_band:    { label: { en: "Size band",     sk: "Veľkostné pásmo"     }, type: "derived", from: "total_units" },
};

function bandFor(column, row) {
  if (column === "price_band") {
    const v = row.avg_price_eur_m2;
    if (v == null) return "—";
    if (v < 3500) return "< 3.5k €/m²";
    if (v < 4500) return "3.5–4.5k €/m²";
    if (v < 6000) return "4.5–6k €/m²";
    return "6k+ €/m²";
  }
  if (column === "sold_band") {
    const s = row.sold_percentage ?? 0;
    if (s < 25) return "0–25%";
    if (s < 50) return "25–50%";
    if (s < 75) return "50–75%";
    if (s < 100) return "75–99%";
    return "sold out (100%)";
  }
  if (column === "size_band") {
    const t = row.total_units ?? 0;
    if (t < 50) return "< 50";
    if (t < 100) return "50–100";
    if (t < 200) return "100–200";
    return "200+";
  }
  return null;
}

function cellValue(row, column) {
  if (PIVOT_COLUMNS[column]?.type === "derived") return bandFor(column, row);
  // snapshots store the project name in project_name, projects uses name —
  // alias so "name" column works regardless of source.
  if (column === "name") return row.name ?? row.project_name;
  return row[column];
}

/** Normalised group key for text / derived columns.
 *  - Trims whitespace so "YIT " and "YIT" merge
 *  - Preserves original case (user is source of truth for typography)
 *  - Empty / null / whitespace-only → "—" sentinel so NULLs cluster
 */
function normGroupKey(v) {
  if (v == null) return "—";
  const s = String(v).trim();
  return s === "" ? "—" : s;
}

// Filter evaluation
const FILTER_OPS_TEXT = ["is", "is not", "contains", "starts with", "ends with", "in", "not in", "is empty", "not empty"];
const FILTER_OPS_NUM  = ["=", "≠", "<", "≤", ">", "≥", "between", "is empty", "not empty"];

/* A filter is "incomplete" when the user picked an operator but hasn't
   supplied a value yet. This is the intermediate state right after
   clicking "Add filter" — we treat it as a no-op (pass every row through)
   so data doesn't vanish from under the user. The filter only starts
   excluding rows once it has something to match against. */
function isIncompleteFilter(f) {
  if (f.op === "is empty" || f.op === "not empty") return false;
  if (f.op === "between") {
    return (f.min == null || f.min === "") && (f.max == null || f.max === "");
  }
  if (f.op === "in" || f.op === "not in") {
    return !f.values || f.values.length === 0;
  }
  return f.value == null || f.value === "";
}

function matchesFilter(row, f) {
  // Pass-through for incomplete filters (see isIncompleteFilter comment)
  if (isIncompleteFilter(f)) return true;
  const v = cellValue(row, f.column);
  const colType = PIVOT_COLUMNS[f.column]?.type;
  if (f.op === "is empty") return v == null || v === "";
  if (f.op === "not empty") return v != null && v !== "";
  if (v == null || v === "") return false;

  if (colType === "number") {
    const num = Number(v);
    if (f.op === "=")  return num === +f.value;
    if (f.op === "≠")  return num !== +f.value;
    if (f.op === "<")  return num < +f.value;
    if (f.op === "≤")  return num <= +f.value;
    if (f.op === ">")  return num > +f.value;
    if (f.op === "≥")  return num >= +f.value;
    if (f.op === "between") {
      return num >= (+f.min || 0) && num <= (+f.max || Infinity);
    }
    return true;
  }
  // text + derived (bands are strings). Trim+lowercase for comparison so
  // "YIT " and "YIT" are equivalent, but display preserves original case.
  const s = String(v).trim().toLowerCase();
  const q = String(f.value || "").trim().toLowerCase();
  if (f.op === "is")           return s === q;
  if (f.op === "is not")       return s !== q;
  if (f.op === "contains")     return s.includes(q);
  if (f.op === "starts with")  return s.startsWith(q);
  if (f.op === "ends with")    return s.endsWith(q);
  if (f.op === "in") {
    const normValues = (f.values || []).map(x => String(x).trim().toLowerCase());
    return normValues.includes(s);
  }
  if (f.op === "not in") {
    const normValues = (f.values || []).map(x => String(x).trim().toLowerCase());
    return !normValues.includes(s);
  }
  return true;
}

/* ── Tree helpers (module scope) ───────────────────────────
   Pivot now supports arbitrary depth on the row axis. We build
   a true tree (recursive), where each intermediate node has a
   rollup computed from ITS OWN underlying records (via
   computeMeasure), so avg / min / max / median stay correct
   instead of being mechanical sums of sub-bucket values.

   Path keys use "‖" (double pipe, never appears in user data) as
   separator so pathKey equality is reliable even when labels
   contain "·" or "/". */
const TREE_SEP = "\u2016";

function buildRowTree(records, groupCols, computeMeasure) {
  const rec = (recs, depth, prefix) => {
    const col = groupCols[depth];
    const byKey = new Map();
    for (const r of recs) {
      const k = normGroupKey(cellValue(r, col));
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(r);
    }
    const out = [];
    for (const [k, kRecs] of byKey.entries()) {
      const path = [...prefix, k];
      const isLeaf = depth === groupCols.length - 1;
      out.push({
        level: depth,
        label: k,
        path,
        pathKey: path.join(TREE_SEP),
        records: kRecs,
        value: computeMeasure(kRecs),
        count: kRecs.length,
        children: isLeaf ? [] : rec(kRecs, depth + 1, path),
        isLeaf,
      });
    }
    return out;
  };
  if (groupCols.length === 0) return { children: [], value: computeMeasure(records), count: records.length, records };
  return {
    children: rec(records, 0, []),
    value: computeMeasure(records),
    count: records.length,
    records,
  };
}

function sortTree(nodes, sortCol, sortDir) {
  const cmp = (a, b) => {
    if (sortCol === "count") {
      const av = a.count || 0, bv = b.count || 0;
      return sortDir === "desc" ? bv - av : av - bv;
    }
    if (sortCol === "name") {
      return sortDir === "asc"
        ? String(a.label).localeCompare(String(b.label), undefined, { numeric: true })
        : String(b.label).localeCompare(String(a.label), undefined, { numeric: true });
    }
    // Default: value
    const av = Number.isFinite(a.value) ? a.value : 0;
    const bv = Number.isFinite(b.value) ? b.value : 0;
    return sortDir === "desc" ? bv - av : av - bv;
  };
  const sorted = [...nodes].sort(cmp);
  for (const n of sorted) {
    if (n.children.length) n.children = sortTree(n.children, sortCol, sortDir);
  }
  return sorted;
}

function flattenTree(nodes, collapsed, showSubtotals, hideEmpty) {
  const out = [];
  const walk = (n) => {
    if (hideEmpty && n.count === 0) return;
    const isCollapsed = collapsed.has(n.pathKey);
    const hasChildren = n.children.length > 0;
    // If subtotals off, only emit leaf rows (skip intermediate nodes).
    if (showSubtotals || n.isLeaf || isCollapsed) {
      out.push({ ...n, isCollapsed, hasChildren });
    }
    if (hasChildren && !isCollapsed) {
      for (const c of n.children) walk(c);
    }
  };
  for (const r of nodes) walk(r);
  return out;
}

function getAllPathKeys(nodes, { leavesToo = false } = {}) {
  const out = [];
  const walk = (n) => {
    if (leavesToo || !n.isLeaf) out.push(n.pathKey);
    for (const c of n.children) walk(c);
  };
  for (const n of nodes) walk(n);
  return out;
}

/* ── Tiny inline SVG icons, monochrome, inherit currentColor ───
   Using SVG instead of emoji so they visually match the dark/green
   theme (emoji render with their own garish color palette that clashes
   with everything else). 14×14 with 1.5px stroke reads crisp at
   dropdown row height. */
const svgProps = {
  width: 14, height: 14, viewBox: "0 0 14 14",
  fill: "none", stroke: "currentColor", strokeWidth: 1.5,
  strokeLinecap: "round", strokeLinejoin: "round",
  style: { flexShrink: 0 },
};
const IconTree  = () => (<svg {...svgProps}><path d="M3 2 L3 11 M3 4 L7 4 M3 7 L7 7 M3 10 L7 10 M7 4 L7 10 M7 4 L11 4 M7 10 L11 10" /></svg>);
const IconBars  = () => (<svg {...svgProps}><rect x="2" y="8" width="2.5" height="4" rx="0.3" fill="currentColor" opacity="0.8"/><rect x="5.75" y="5" width="2.5" height="7" rx="0.3" fill="currentColor" opacity="0.9"/><rect x="9.5" y="2" width="2.5" height="10" rx="0.3" fill="currentColor"/></svg>);
const IconSigma = () => (<svg {...svgProps}><path d="M11 2 L3 2 L7 7 L3 12 L11 12" /></svg>);
const IconHash  = () => (<svg {...svgProps}><path d="M4 2 L3 12 M10 2 L9 12 M2 5 L11 5 M2 9 L10 9" /></svg>);
const IconAZ    = () => (<svg {...svgProps}><path d="M2 12 L4 4 L6 12 M2.7 9 L5.3 9 M8 12 L12 4 M8 12 L12 12 M12 4 L8 4" /></svg>);
const IconArrUp = () => (<svg {...svgProps}><path d="M7 2 L7 12 M3 6 L7 2 L11 6" /></svg>);
const IconArrDn = () => (<svg {...svgProps}><path d="M7 2 L7 12 M3 8 L7 12 L11 8" /></svg>);

/* A tiny icon-label pair used inside StyledSelect option labels. */
const IconLabel = ({ icon, children }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}>
    <span style={{ display: "inline-flex", color: "currentColor", opacity: 0.85 }}>{icon}</span>
    <span>{children}</span>
  </span>
);

/* StyledCheckbox — replaces native <input type="checkbox"/> which renders as
   a stark white OS square that clashes with the dark theme. This version is
   a rounded dark square with a soft border and a green check when on. Click
   target is the whole label for easy targeting. */
function StyledCheckbox({ checked, onChange, label, warn, title, disabled }) {
  return (
    <label
      title={title}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.45rem",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: "0.76rem", color: checked ? green : "#e8e8ed",
        userSelect: "none", opacity: disabled ? 0.55 : 1,
        padding: "0.25rem 0.1rem",
      }}
    >
      <span
        role="checkbox"
        aria-checked={checked}
        onClick={(e) => { if (!disabled) { e.preventDefault(); onChange(!checked); } }}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 16, height: 16, borderRadius: 4,
          background: checked ? green : "#0e0e10",
          border: `1.5px solid ${checked ? green : "#3a3a44"}`,
          boxShadow: checked ? `0 0 0 2px rgba(0,229,160,0.15)` : "none",
          transition: "background 0.15s, border-color 0.15s, box-shadow 0.15s",
          flexShrink: 0,
        }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="#0a0a0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1.5 5.25 L4 7.75 L8.5 2.25" />
          </svg>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0 }}
      />
      <span>{label}</span>
      {warn && <span style={{ fontSize: "0.65rem", color: "#ff9b6b", marginLeft: "0.15rem" }} title={typeof warn === "string" ? warn : ""}>⚠</span>}
    </label>
  );
}

/* ── RowsZone — drop zone for the row-axis field chips ──────
   Supports native HTML5 drag-and-drop:
   - Drag a chip within the zone to reorder (changes hierarchy levels).
   - Drag a chip out (drop anywhere OUTSIDE, e.g. on the palette) to remove.
   - Drag a palette field in to add.
   Visual: a green drop indicator shows where the dragged chip will land. */
function RowsZone({
  chips, t, lang, dragState, setDragState,
  onReorder, onRemove, onDropFromPalette, onOpenFilter,
  activeFiltersByCol,
}) {
  const [dropIdx, setDropIdx] = useState(null);
  const isDragging = dragState != null;

  return (
    <div
      onDragOver={(e) => {
        if (!dragState) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        if (!dragState) return;
        const targetIdx = dropIdx == null ? chips.length : dropIdx;
        if (dragState.source === "palette") {
          onDropFromPalette(dragState.column, targetIdx);
        } else if (dragState.source === "rows") {
          const from = chips.indexOf(dragState.column);
          if (from >= 0 && from !== targetIdx && from !== targetIdx - 1) {
            onReorder(from, from < targetIdx ? targetIdx - 1 : targetIdx);
          }
        }
        setDropIdx(null);
        setDragState(null);
      }}
      onDragLeave={() => setDropIdx(null)}
      style={{
        background: isDragging ? "rgba(0,229,160,0.06)" : "rgba(255,255,255,0.025)",
        border: `1px dashed ${isDragging ? green : border}`,
        borderRadius: 6, padding: "0.7rem 0.75rem", minHeight: 64,
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: chips.length ? "0.5rem" : 0, flexWrap: "wrap" }}>
        <span style={{ fontFamily: mono, fontSize: "0.62rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700 }}>
          <span style={{ color: green, marginRight: "0.25rem" }}>↓</span>
          {lang === "sk" ? "Riadky (hierarchia zhora dolu)" : "Rows (hierarchy top → down)"}
        </span>
        <span style={{ fontSize: "0.62rem", color: dim, fontFamily: mono }}>· {chips.length}/6</span>
        {chips.length > 1 && (
          <span style={{ fontSize: "0.62rem", color: dim, fontFamily: mono, marginLeft: "auto" }}>
            {lang === "sk" ? "↔ ťahaj pre preusporiadanie" : "↔ drag to reorder"}
          </span>
        )}
      </div>
      {chips.length === 0 && (
        <div style={{ fontSize: "0.78rem", color: dim, fontStyle: "italic", padding: "0.5rem 0" }}>
          {lang === "sk"
            ? "Potiahni pole z palety nižšie → stane sa najvyššou úrovňou hierarchie."
            : "Drag a field from the palette below → it becomes the top hierarchy level."}
        </div>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.25rem", minHeight: 34 }}>
        {chips.map((g, i) => (
          <span key={g} style={{ display: "inline-flex" }}>
            {/* Drop indicator BEFORE this chip */}
            <DropCaret
              active={dropIdx === i && dragState && (dragState.source === "palette" || dragState.column !== g)}
              onDragOver={(e) => { if (dragState) { e.preventDefault(); setDropIdx(i); } }}
            />
            <DraggableChip
              column={g}
              label={t(PIVOT_COLUMNS[g]?.label)}
              level={i}
              hasFilter={activeFiltersByCol.has(g)}
              canMoveUp={i > 0}
              canMoveDown={i < chips.length - 1}
              onDragStart={() => setDragState({ source: "rows", column: g })}
              onDragEnd={() => { setDragState(null); setDropIdx(null); }}
              onDragOver={(e) => { if (dragState) { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); const mid = rect.left + rect.width / 2; setDropIdx(e.clientX < mid ? i : i + 1); } }}
              onRemove={() => onRemove(g)}
              onOpenFilter={(anchorEl) => onOpenFilter(g, anchorEl)}
              onMoveUp={() => onReorder(i, i - 1)}
              onMoveDown={() => onReorder(i, i + 1)}
              lang={lang}
            />
          </span>
        ))}
        {/* Trailing drop indicator (drop at end) */}
        <DropCaret
          active={dropIdx === chips.length && isDragging}
          onDragOver={(e) => { if (dragState) { e.preventDefault(); setDropIdx(chips.length); } }}
        />
      </div>
    </div>
  );
}

/* Small visual marker where a dragged chip will land. */
function DropCaret({ active, onDragOver }) {
  return (
    <span
      onDragOver={onDragOver}
      style={{
        display: "inline-block",
        width: active ? 4 : 6,
        minHeight: 26,
        margin: active ? "0 2px" : 0,
        background: active ? green : "transparent",
        borderRadius: 2,
        transition: "width 0.12s, background 0.12s",
        boxShadow: active ? `0 0 8px ${green}` : "none",
      }}
    />
  );
}

/* Draggable chip — supports drag + per-chip autofilter button + remove. */
function DraggableChip({ column, label, level, hasFilter, canMoveUp, canMoveDown, onDragStart, onDragEnd, onDragOver, onRemove, onOpenFilter, onMoveUp, onMoveDown, lang }) {
  const btnStyle = (enabled) => ({
    background: "transparent", border: "none",
    color: enabled ? green : "#2a2a30",
    cursor: enabled ? "pointer" : "not-allowed",
    padding: "0 2px", fontSize: "0.7rem", lineHeight: 1, fontFamily: "inherit",
  });
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        // Setting text/plain keeps Firefox happy.
        e.dataTransfer.setData("text/plain", column);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.3rem",
        padding: "0.3rem 0.4rem 0.3rem 0.55rem", borderRadius: 100,
        background: hasFilter ? "rgba(0,229,160,0.22)" : "rgba(0,229,160,0.12)",
        border: `1px solid ${hasFilter ? green : green + "cc"}`,
        color: green, fontSize: "0.74rem", fontFamily: mono, cursor: "grab",
        userSelect: "none",
      }}
      onMouseDown={(e) => e.currentTarget.style.cursor = "grabbing"}
      onMouseUp={(e) => e.currentTarget.style.cursor = "grab"}
      title={lang === "sk" ? `Level ${level + 1} hierarchie` : `Hierarchy level ${level + 1}`}
    >
      <span style={{ fontFamily: mono, fontSize: "0.62rem", opacity: 0.7 }}>L{level + 1}</span>
      <span style={{ fontWeight: 600 }}>{label}</span>
      {/* Reorder arrows (click-based — drag is bonus when it works) */}
      <button onClick={(e) => { e.stopPropagation(); canMoveUp && onMoveUp(); }} disabled={!canMoveUp}
        title={lang === "sk" ? "Posunúť hore (vyšší level)" : "Move up (higher level)"}
        style={btnStyle(canMoveUp)}>◂</button>
      <button onClick={(e) => { e.stopPropagation(); canMoveDown && onMoveDown(); }} disabled={!canMoveDown}
        title={lang === "sk" ? "Posunúť dole (nižší level)" : "Move down (lower level)"}
        style={btnStyle(canMoveDown)}>▸</button>
      {/* Filter icon — shows filled when an autofilter is active */}
      <button
        onClick={(e) => { e.stopPropagation(); onOpenFilter(e.currentTarget); }}
        title={lang === "sk" ? (hasFilter ? "Upraviť filter" : "Filtrovať hodnoty…") : (hasFilter ? "Edit filter" : "Filter values…")}
        style={{
          background: hasFilter ? green : "transparent",
          border: `1px solid ${hasFilter ? green : green + "66"}`,
          color: hasFilter ? "#0a0a0b" : green,
          borderRadius: 3, cursor: "pointer", padding: "2px 4px",
          fontSize: "0.68rem", lineHeight: 1, fontFamily: "inherit", marginLeft: "0.1rem",
        }}
      >⚑</button>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title={lang === "sk" ? "Odstrániť" : "Remove"}
        style={{ background: "transparent", border: "none", color: green, cursor: "pointer", padding: 0, fontSize: "0.95rem", lineHeight: 1 }}
      >×</button>
    </span>
  );
}

/* Palette — grid of fields not currently in rows. Each is a draggable
   button. Also acts as a drop zone: dropping a rows chip here REMOVES
   it (with a distinct red border to signal destructive drop). */
function FieldPalette({ available, chipsInRows, dragState, setDragState, onAdd, onRemove, lang, t }) {
  const isRemovalDrop = dragState?.source === "rows";
  return (
    <div
      onDragOver={(e) => { if (isRemovalDrop) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
      onDrop={(e) => {
        if (!dragState) return;
        e.preventDefault();
        if (dragState.source === "rows") onRemove(dragState.column);
        setDragState(null);
      }}
      style={{
        marginTop: "0.7rem", paddingTop: "0.6rem",
        borderTop: `1px dashed ${border}`,
        // When dragging a rows chip, palette becomes a "remove" drop zone
        background: isRemovalDrop ? "rgba(255,107,107,0.07)" : "transparent",
        border: isRemovalDrop ? `1px dashed #ff6b6b` : "none",
        borderRadius: 6, padding: isRemovalDrop ? "0.6rem 0.6rem" : "0.6rem 0",
        transition: "background 0.15s, border 0.15s",
      }}
    >
      <div style={{ fontFamily: mono, fontSize: "0.58rem", color: isRemovalDrop ? "#ff6b6b" : dim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.4rem" }}>
        {isRemovalDrop
          ? (lang === "sk" ? "↓ pusti sem na odstránenie" : "↓ drop here to remove")
          : (lang === "sk" ? "Dostupné polia · ťahaj do riadkov" : "Available fields · drag into rows")}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
        {available.length === 0 ? (
          <span style={{ color: dim, fontSize: "0.72rem", fontStyle: "italic" }}>
            {lang === "sk" ? "Všetky polia už používaš." : "All fields in use."}
          </span>
        ) : available.map(k => (
          <button
            key={k}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "copy";
              e.dataTransfer.setData("text/plain", k);
              setDragState({ source: "palette", column: k });
            }}
            onDragEnd={() => setDragState(null)}
            onClick={() => onAdd(k)}
            title={lang === "sk" ? "Pridať do riadkov (alebo ťahaj)" : "Add to rows (or drag)"}
            style={{
              fontFamily: "inherit", fontSize: "0.72rem",
              padding: "0.3rem 0.6rem", borderRadius: 100, cursor: "pointer",
              background: "transparent", border: `1px solid ${border}`, color: dim,
              display: "inline-flex", alignItems: "center", gap: "0.25rem",
              userSelect: "none",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = green; e.currentTarget.style.color = green; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = dim; }}
          >
            <span style={{ opacity: 0.7, fontFamily: mono, fontSize: "0.6rem" }}>+</span>
            {t(PIVOT_COLUMNS[k]?.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ColumnAutofilter — Excel-style per-column checkbox filter.
   Opens as a popover anchored to the chip. Select-all / Clear / search +
   scroll list. When user changes selection, updates the `filters` state
   with a synthetic `in`/`not in` filter (we prefer `in` when < half of
   values are selected so the semantic is "include only these"; otherwise
   `not in` with the unchecked ones for a smaller filter payload — but
   we always store `in` for simpler reasoning). Real-time: the filtered
   dataset recomputes as soon as state updates, so pivot redraws
   immediately. */
function ColumnAutofilter({ column, anchorEl, allValues, filter, onApply, onClear, onClose, lang }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => {
    if (filter && filter.op === "in") return new Set((filter.values || []).map(v => String(v).trim().toLowerCase()));
    // Default: all values selected (no filter applied)
    return new Set(allValues.map(v => String(v).trim().toLowerCase()));
  });
  // Re-sync if column/filter change (reopening for a different chip)
  useEffect(() => {
    if (filter && filter.op === "in") setSelected(new Set((filter.values || []).map(v => String(v).trim().toLowerCase())));
    else setSelected(new Set(allValues.map(v => String(v).trim().toLowerCase())));
  }, [column, filter?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click / Esc
  useEffect(() => {
    const onDown = (e) => {
      if (!anchorEl) return;
      const pop = document.getElementById("pivot-autofilter-pop");
      if (!pop) return;
      if (!pop.contains(e.target) && !anchorEl.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchorEl, onClose]);

  // Popup position — directly below anchor
  const rect = anchorEl?.getBoundingClientRect();
  const style = rect ? {
    position: "fixed",
    top: rect.bottom + 6,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)),
    zIndex: 1000,
  } : { display: "none" };

  const q = search.trim().toLowerCase();
  const shown = q ? allValues.filter(v => String(v).toLowerCase().includes(q)) : allValues;
  const allChecked = shown.every(v => selected.has(String(v).trim().toLowerCase()));

  const toggle = (v) => {
    const key = String(v).trim().toLowerCase();
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };
  const apply = () => {
    // If all selected → remove filter entirely.
    if (selected.size === allValues.length) { onClear(); onClose(); return; }
    // Store values preserving original casing (match against trimmed lowercase at filter eval time)
    const selectedOriginal = allValues.filter(v => selected.has(String(v).trim().toLowerCase()));
    onApply({ op: "in", values: selectedOriginal });
    onClose();
  };

  return (
    <div
      id="pivot-autofilter-pop"
      style={{
        ...style,
        width: 300,
        background: "#0b0b0e", border: `1px solid ${green}`, borderRadius: 8,
        boxShadow: "0 20px 48px rgba(0,0,0,0.9), 0 0 0 1px rgba(0,229,160,0.12)",
        padding: "0.7rem", fontFamily: "inherit", color: "#e8e8ed",
      }}
    >
      <div style={{ fontFamily: mono, fontSize: "0.62rem", color: green, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
        ⚑ {lang === "sk" ? "Filtrovať hodnoty" : "Filter values"}
      </div>
      <input
        autoFocus
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={lang === "sk" ? "hľadať…" : "search…"}
        style={{ ...pvtInput, marginTop: 0, padding: "0.4rem 0.55rem", fontSize: "0.8rem", marginBottom: "0.5rem" }}
      />
      <div style={{ display: "flex", gap: "0.35rem", marginBottom: "0.4rem" }}>
        <button
          onClick={() => setSelected(new Set(allValues.map(v => String(v).trim().toLowerCase())))}
          style={{ flex: 1, padding: "0.3rem 0.4rem", background: "transparent", border: `1px solid ${border}`, color: dim, borderRadius: 4, cursor: "pointer", fontSize: "0.7rem", fontFamily: "inherit" }}
        >
          {lang === "sk" ? "Vybrať všetko" : "Select all"}
        </button>
        <button
          onClick={() => setSelected(new Set())}
          style={{ flex: 1, padding: "0.3rem 0.4rem", background: "transparent", border: `1px solid ${border}`, color: dim, borderRadius: 4, cursor: "pointer", fontSize: "0.7rem", fontFamily: "inherit" }}
        >
          {lang === "sk" ? "Zrušiť výber" : "Clear"}
        </button>
        <button
          onClick={() => {
            // Invert
            setSelected(prev => {
              const inv = new Set();
              for (const v of allValues) {
                const k = String(v).trim().toLowerCase();
                if (!prev.has(k)) inv.add(k);
              }
              return inv;
            });
          }}
          style={{ flex: 1, padding: "0.3rem 0.4rem", background: "transparent", border: `1px solid ${border}`, color: dim, borderRadius: 4, cursor: "pointer", fontSize: "0.7rem", fontFamily: "inherit" }}
        >
          {lang === "sk" ? "Invertovať" : "Invert"}
        </button>
      </div>
      <div style={{ maxHeight: 260, overflowY: "auto", padding: "0.2rem 0.1rem", border: `1px solid ${border}`, borderRadius: 4, background: "#0a0a0b" }}>
        {shown.length === 0 ? (
          <div style={{ color: dim, fontSize: "0.72rem", padding: "0.4rem 0.5rem", textAlign: "center" }}>
            {lang === "sk" ? "Žiadne hodnoty." : "No values."}
          </div>
        ) : shown.map(v => {
          const key = String(v).trim().toLowerCase();
          const checked = selected.has(key);
          return (
            <label key={v} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.25rem 0.45rem", cursor: "pointer", fontSize: "0.78rem", color: checked ? "#e8e8ed" : dim, borderRadius: 3 }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <input type="checkbox" checked={checked} onChange={() => toggle(v)} style={{ accentColor: green, width: 13, height: 13 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={String(v)}>{String(v)}</span>
            </label>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.55rem", fontSize: "0.68rem", color: dim, fontFamily: mono }}>
        <span>{selected.size}/{allValues.length} {lang === "sk" ? "vybraných" : "selected"}</span>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          {filter && (
            <button onClick={() => { onClear(); onClose(); }}
              style={{ padding: "0.3rem 0.6rem", background: "transparent", border: `1px solid ${border}`, color: "#ff6b6b", borderRadius: 4, cursor: "pointer", fontSize: "0.72rem", fontFamily: "inherit" }}
            >
              {lang === "sk" ? "Zrušiť filter" : "Clear filter"}
            </button>
          )}
          <button onClick={apply} className="btn-s"
            style={{ padding: "0.3rem 0.8rem", fontSize: "0.74rem" }}
          >
            {lang === "sk" ? "Použiť" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AnalyticsPivot({ snapshots, projects, lang }) {
  const allMonths = Array.from(new Set((snapshots || []).map(s => s.snapshot_month).filter(Boolean))).sort().reverse();
  const latestMonth = allMonths[0] || null;
  const rawSource = snapshots && snapshots.length > 0 ? snapshots : projects;

  const [filters, setFilters] = useState([]);
  const [rowGroups, setRowGroups] = useState(["district"]);
  const [measure, setMeasure] = useState({ column: "__count__", agg: "count" });
  const [chartType, setChartType] = useState("table");  // default table — tree is the killer feature
  // Sort is now two-axis: WHICH column to sort by (value / count / name) + direction.
  // Gives the user the Excel pivot-experience: "sort by count ascending" is different
  // from "sort by measure value ascending" and we want both to be first-class.
  const [sortCol, setSortCol] = useState("value");   // "value" | "count" | "name"
  const [sortDir, setSortDir] = useState("desc");    // "desc" | "asc"
  const [monthScope, setMonthScope] = useState("latest");
  // Status scope — default is "active" so KPIs (avg price, total units, etc.)
  // don't get polluted by paused/sold_out projects on first load. User can
  // switch to "all" / "sold_out" / "paused" / "archived" to see historical
  // data. Mirrors monthScope — a lightweight top-level filter that doesn't
  // need a full FilterRow entry.
  const [statusScope, setStatusScope] = useState("active");
  const [topN, setTopN] = useState(0);
  const [percentOfTotal, setPercentOfTotal] = useState(false);
  // Tree state
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [showSubtotals, setShowSubtotals] = useState(true);
  const [hideEmpty, setHideEmpty] = useState(false);
  // DnD state (shared across RowsZone + palette)
  const [dragState, setDragState] = useState(null);
  // Per-column quick-filter popup anchor
  const [filterPopup, setFilterPopup] = useState(null); // { column, anchorEl }

  const t = (obj) => obj?.[lang] || obj?.en || "";

  // Kept for compatibility w/ existing code paths (legacy "groupBys" name)
  const groupBys = rowGroups;
  const MAX_LEVELS = 6;

  // ── Apply month scope then status scope then filters ──
  // Status scope is applied BEFORE user filters so the pivot's count of
  // "X / Y projects" matches the visible scope. Missing status values
  // (legacy rows from before the 2026-04 migration) default to 'active'.
  const scoped = (monthScope === "latest" && latestMonth)
    ? rawSource.filter(r => !r.snapshot_month || r.snapshot_month === latestMonth)
    : rawSource;
  const statusScoped = statusScope === "all"
    ? scoped
    : scoped.filter(p => (p.status || "active") === statusScope);
  const filtered = statusScoped.filter(p => filters.every(f => matchesFilter(p, f)));

  // ── Measure ──
  const computeMeasure = (rows) => {
    if (measure.column === "__count__" || measure.agg === "count") return rows.length;
    if (measure.agg === "count_distinct") {
      const set = new Set();
      for (const r of rows) {
        const v = cellValue(r, measure.column);
        if (v != null && v !== "") set.add(String(v).trim());
      }
      return set.size;
    }
    const nums = rows
      .map(r => Number(r[measure.column]))
      .filter(n => Number.isFinite(n));
    if (nums.length === 0) return 0;
    switch (measure.agg) {
      case "sum":    return nums.reduce((a, b) => a + b, 0);
      case "avg":    return nums.reduce((a, b) => a + b, 0) / nums.length;
      case "min":    return Math.min(...nums);
      case "max":    return Math.max(...nums);
      case "median": {
        const sorted = [...nums].sort((a, b) => a - b);
        const m = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
      }
      default: return 0;
    }
  };

  // ── Build tree ──
  const rawTree = buildRowTree(filtered, rowGroups, computeMeasure);
  let sortedTopNodes = sortTree(rawTree.children, sortCol, sortDir);
  // Top-N applies only at top level (Excel semantics — filter the axis, not sub-levels)
  const topNLimited = topN > 0 ? sortedTopNodes.slice(0, topN) : sortedTopNodes;

  // % of total — applied to values when rendering (don't mutate the tree).
  // Denominator = grand total of top-N-limited top-level nodes so percentages
  // add up visually to 100%.
  const grandValue = rawTree.value;  // full filtered rollup (ignoring Top-N) for display
  const topLevelSum = topNLimited.reduce((a, n) => a + (Number.isFinite(n.value) ? n.value : 0), 0);
  const pctDen = percentOfTotal && topLevelSum > 0 ? topLevelSum : 1;
  const pctOfTotalValid = ["count", "sum", "count_distinct"].includes(measure.agg) || measure.column === "__count__";

  const flatTreeRows = flattenTree(topNLimited, collapsed, showSubtotals, hideEmpty);

  // ── Display helpers ──
  const measureLabelText = (() => {
    let base;
    if (measure.column === "__count__") {
      base = lang === "sk" ? "Počet projektov" : "Count of projects";
    } else {
      const col = t(PIVOT_COLUMNS[measure.column]?.label);
      const ag = {
        count:          lang === "sk" ? "Počet"            : "Count",
        count_distinct: lang === "sk" ? "Počet unikátnych" : "Count distinct",
        sum:            lang === "sk" ? "Súčet"            : "Sum",
        avg:            lang === "sk" ? "Priem."           : "Avg",
        min:            "Min",
        max:            "Max",
        median:         lang === "sk" ? "Medián"           : "Median",
      }[measure.agg] || measure.agg;
      base = `${ag} · ${col}`;
    }
    return percentOfTotal ? `${base} · % z celku` : base;
  })();

  const rowLabelText = rowGroups.map(g => t(PIVOT_COLUMNS[g]?.label)).join(" › ");

  const fmtValue = (rawV) => {
    const v = percentOfTotal && pctDen > 0 ? (rawV / pctDen) * 100 : rawV;
    if (typeof v !== "number" || !Number.isFinite(v)) return "—";
    if (percentOfTotal) return (Math.round(v * 10) / 10).toFixed(1) + "%";
    if (measure.column === "avg_price_eur_m2" || measure.column === "min_price" || measure.column === "max_price") {
      return Math.round(v).toLocaleString("en-US").replace(/,/g, " ");
    }
    if (measure.column === "sold_percentage") {
      return (Math.round(v * 10) / 10).toFixed(1) + "%";
    }
    const intish = measure.agg === "count" || measure.agg === "sum" || measure.agg === "count_distinct" || measure.column === "__count__";
    return intish ? Math.round(v).toLocaleString("en-US").replace(/,/g, " ")
                  : (Math.round(v * 100) / 100).toLocaleString("en-US").replace(/,/g, " ");
  };

  // ── CSV export of current slice (tree-aware) ──
  const exportCSV = () => {
    const escape = (c) => {
      const s = String(c ?? "");
      return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      ...rowGroups.map(g => t(PIVOT_COLUMNS[g]?.label)),
      lang === "sk" ? "Projektov" : "Projects",
      measureLabelText,
    ];
    // Each row: one cell per level (blank above the node's own level), plus count + measure.
    // Leaves get filled in full (all levels). Intermediate nodes blank the deeper levels.
    const body = flatTreeRows.map(n => {
      const cols = rowGroups.map((_, i) => i <= n.level ? (n.path[i] ?? "") : "");
      const valOut = percentOfTotal && pctDen > 0 ? (n.value / pctDen) * 100 : n.value;
      return [...cols, n.count, Number.isFinite(valOut) ? valOut : ""];
    });
    // Grand total
    body.push([
      ...rowGroups.map((_, i) => i === 0 ? (lang === "sk" ? "Σ CELKOM" : "Σ TOTAL") : ""),
      rawTree.count,
      percentOfTotal ? 100 : grandValue,
    ]);
    const csv = [header, ...body].map(r => r.map(escape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    const name = [...rowGroups, measure.column].filter(x => x !== "__count__").join("-") || "pivot";
    a.download = `residata-pivot-${name}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ── UI helpers ──
  const numericColumnKeys = Object.keys(PIVOT_COLUMNS).filter(k => PIVOT_COLUMNS[k].type === "number");
  const groupableKeys = Object.keys(PIVOT_COLUMNS).filter(k => PIVOT_COLUMNS[k].type === "text" || PIVOT_COLUMNS[k].type === "derived");

  const addFilter = () => setFilters(fs => [...fs, { id: Math.random().toString(36).slice(2, 9), column: "district", op: "is", value: "", values: [] }]);
  const updateFilter = (id, patch) => setFilters(fs => fs.map(f => f.id === id ? { ...f, ...patch } : f));
  const removeFilter = (id) => setFilters(fs => fs.filter(f => f.id !== id));

  // DnD actions on rows
  const addRowAt = (col, targetIdx) => {
    if (rowGroups.includes(col)) return;
    setRowGroups(gs => {
      if (gs.length >= MAX_LEVELS) return gs;
      const n = [...gs];
      n.splice(Math.min(targetIdx, n.length), 0, col);
      return n;
    });
  };
  const removeRow = (col) => {
    if (rowGroups.length === 1 && rowGroups[0] === col) return;
    setRowGroups(gs => gs.filter(g => g !== col));
  };
  const reorderRow = (from, to) => {
    setRowGroups(gs => {
      const n = [...gs];
      const [x] = n.splice(from, 1);
      n.splice(to, 0, x);
      return n;
    });
  };

  // Collapse/expand handlers — memoised on pathKey
  const toggleNode = (pathKey) => setCollapsed(s => {
    const n = new Set(s); if (n.has(pathKey)) n.delete(pathKey); else n.add(pathKey); return n;
  });
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(getAllPathKeys(topNLimited)));

  // Per-chip quick-filter — updates/removes the `in` filter for the column.
  // This synthetic filter lives alongside any other filters the user set up
  // in the filter panel; they compose (AND).
  const quickFilterForCol = (col) => filters.find(f => f.column === col && f.op === "in");
  const applyQuickFilter = (col, patch) => {
    const existing = quickFilterForCol(col);
    if (existing) updateFilter(existing.id, patch);
    else setFilters(fs => [...fs, { id: Math.random().toString(36).slice(2, 9), column: col, ...patch, value: "" }]);
  };
  const clearQuickFilter = (col) => {
    const existing = quickFilterForCol(col);
    if (existing) removeFilter(existing.id);
  };
  const activeFiltersByCol = new Set(filters.map(f => f.column));

  // Distinct values for the popup — from the filtered-WITHOUT-this-filter
  // dataset, so the user always sees the full set of options (prevents the
  // "I unchecked YIT, now I can't re-check it because it was filtered out"
  // footgun that Excel itself has).
  const distinctForColumn = (col) => {
    const others = filters.filter(f => f.column !== col);
    const base = scoped.filter(p => others.every(f => matchesFilter(p, f)));
    const set = new Set();
    for (const p of base) {
      const v = cellValue(p, col);
      if (v != null && v !== "") set.add(String(v));
    }
    return Array.from(set).sort();
  };

  const maxLeafValue = Math.max(1, ...flatTreeRows.filter(r => r.isLeaf).map(r => Math.abs(r.value || 0)));
  const maxTopValue  = Math.max(1, ...topNLimited.map(r => Math.abs(r.value || 0)));

  return (
    <div style={{
      background: "linear-gradient(135deg, #16161a 0%, #0e0e10 100%)",
      border: `1px solid ${green}40`, borderRadius: 12, padding: "1.5rem",
      boxShadow: `0 0 32px rgba(0,229,160,0.04)`,
    }}>
      <div style={{ marginBottom: "1.25rem", display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.3rem" }}>
            <span style={{ padding: "2px 6px", background: green, color: "#0a0a0b", borderRadius: 3, fontWeight: 700 }}>PIVOT</span>
            {lang === "sk" ? "Query builder" : "Query builder"}
          </div>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#e8e8ed", margin: "0.2rem 0 0", letterSpacing: "-0.01em" }}>
            {lang === "sk" ? "Postav si vlastný pohľad na dáta" : "Compose your own view of the data"}
          </h2>
          <p style={{ color: dim, fontSize: "0.82rem", margin: "0.45rem 0 0", lineHeight: 1.55, maxWidth: 720 }}>
            {lang === "sk"
              ? <>Potiahni polia do <strong style={{ color: "#e8e8ed" }}>Riadkov</strong> — každé ďalšie je ďalší level hierarchie (6 úrovní max). Každý chip má vlastný autofilter (⚑). Vyber metriku + agregáciu, výsledky sa prepočítajú live. CSV export vráti presne ten slice vrátane subtotalov.</>
              : <>Drag fields into <strong style={{ color: "#e8e8ed" }}>Rows</strong> — each one adds a hierarchy level (6 max). Every chip has its own autofilter (⚑). Pick a measure + aggregation, results recompute live. CSV export grabs the exact slice including subtotals.</>}
          </p>
        </div>

        {/* Scope column — two top-level filters that gate the whole pivot
            (month + status). Applied BEFORE user filters, so "Filtered X/Y"
            reflects the scope too. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", alignItems: "flex-end" }}>
          {latestMonth && (
            <>
              <div style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                {lang === "sk" ? "Mesiac" : "Month"}
              </div>
              <div style={{ display: "inline-flex", background: "#0a0a0b", border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden" }}>
                <button onClick={() => setMonthScope("latest")}
                  style={{ padding: "0.35rem 0.7rem", fontSize: "0.72rem", cursor: "pointer", background: monthScope === "latest" ? green : "transparent", color: monthScope === "latest" ? "#0a0a0b" : dim, border: "none", fontFamily: "inherit", fontWeight: 600 }}>
                  {lang === "sk" ? `Najnovší (${latestMonth})` : `Latest (${latestMonth})`}
                </button>
                <button onClick={() => setMonthScope("all")}
                  style={{ padding: "0.35rem 0.7rem", fontSize: "0.72rem", cursor: "pointer", background: monthScope === "all" ? green : "transparent", color: monthScope === "all" ? "#0a0a0b" : dim, border: "none", fontFamily: "inherit", fontWeight: 600 }}>
                  {lang === "sk" ? `Všetky (${allMonths.length})` : `All (${allMonths.length})`}
                </button>
              </div>
            </>
          )}

          {/* Status scope — Active default, switchable to Sold out / Paused /
              Archived / All. Active-only default prevents polluted KPIs from
              dead projects on first load. */}
          <div style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginTop: "0.2rem" }}>
            {lang === "sk" ? "Status" : "Status"}
          </div>
          <div style={{ display: "inline-flex", background: "#0a0a0b", border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden", flexWrap: "wrap" }}>
            {[
              { v: "active",    sk: "Aktívne",    en: "Active" },
              { v: "sold_out",  sk: "Vypredané",  en: "Sold out" },
              { v: "paused",    sk: "Pozastavené",en: "Paused" },
              { v: "archived",  sk: "Archív",     en: "Archived" },
              { v: "all",       sk: "Všetko",     en: "All" },
            ].map(opt => {
              const active = statusScope === opt.v;
              return (
                <button key={opt.v} onClick={() => setStatusScope(opt.v)}
                  style={{ padding: "0.35rem 0.65rem", fontSize: "0.72rem", cursor: "pointer", background: active ? green : "transparent", color: active ? "#0a0a0b" : dim, border: "none", fontFamily: "inherit", fontWeight: 600 }}>
                  {lang === "sk" ? opt.sk : opt.en}
                </button>
              );
            })}
          </div>
          {statusScope !== "active" && (
            <div style={{ fontSize: "0.65rem", color: "#ff9b6b", fontFamily: mono, textAlign: "right", maxWidth: 220 }}>
              {lang === "sk" ? "⚠ Historické dáta — KPIs nemusia odrážať trh" : "⚠ Historical — KPIs may not reflect live market"}
            </div>
          )}
        </div>
      </div>

      {/* ── FILTERS (prominent card) ── */}
      <div style={{
        marginBottom: "1.1rem",
        background: filters.length > 0 ? "rgba(0,229,160,0.05)" : "#0a0a0b",
        border: `1px solid ${filters.length > 0 ? green + "55" : border}`,
        borderRadius: 8, padding: "0.85rem 1rem",
        transition: "background 0.2s, border-color 0.2s",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: filters.length > 0 ? "0.65rem" : "0.3rem", flexWrap: "wrap", gap: "0.5rem" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem" }}>
            <span style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              width: 22, height: 22, borderRadius: 4,
              background: filters.length > 0 ? green : "#16161a",
              color: filters.length > 0 ? "#0a0a0b" : dim,
              fontSize: "0.78rem", fontWeight: 700,
            }}>⚑</span>
            <span style={{ fontFamily: mono, fontSize: "0.72rem", color: filters.length > 0 ? green : "#e8e8ed", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700 }}>
              {lang === "sk" ? "FILTRE" : "FILTERS"}
            </span>
            <span style={{ fontFamily: mono, fontSize: "0.72rem", color: dim }}>
              {filters.length === 0
                ? (lang === "sk" ? "žiadne · zobrazuje sa všetko" : "none · showing everything")
                : (lang === "sk" ? `${filters.length} aktívny${filters.length > 1 ? "ch" : ""}` : `${filters.length} active`)}
            </span>
          </div>
          <button onClick={addFilter} style={{
            background: green, border: "none",
            color: "#0a0a0b", padding: "0.4rem 0.85rem", borderRadius: 5, cursor: "pointer",
            fontFamily: "inherit", fontSize: "0.76rem", fontWeight: 700,
            boxShadow: "0 2px 8px rgba(0,229,160,0.2)",
          }}
            onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.filter = "none"; }}>
            + {lang === "sk" ? "Pridať filter" : "Add filter"}
          </button>
        </div>
        {filters.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {filters.map(f => (
              <FilterRow key={f.id} f={f} projects={projects} lang={lang} t={t}
                onChange={(patch) => updateFilter(f.id, patch)}
                onRemove={() => removeFilter(f.id)} />
            ))}
          </div>
        )}
        {filters.length === 0 && (
          <div style={{ fontSize: "0.74rem", color: dim, lineHeight: 1.45 }}>
            {lang === "sk"
              ? <>Pridaj filter pre operátory (<code style={{ color: "#e8e8ed" }}>contains</code>, <code style={{ color: "#e8e8ed" }}>between</code>, <code style={{ color: "#e8e8ed" }}>≥</code>…) alebo klikni ⚑ na chipe v Riadkoch pre rýchly výber hodnôt.</>
              : <>Add a filter for operators (<code style={{ color: "#e8e8ed" }}>contains</code>, <code style={{ color: "#e8e8ed" }}>between</code>, <code style={{ color: "#e8e8ed" }}>≥</code>…) or click ⚑ on a chip in Rows for a quick value picker.</>}
          </div>
        )}
      </div>

      {/* ── ROWS (DnD) + MEASURE ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.25rem" }} className="pivot-grid">
        <div style={{ background: "#0a0a0b", border: `1px solid ${border}`, borderRadius: 8, padding: "0.9rem 1rem" }}>
          <RowsZone
            chips={rowGroups}
            t={t}
            lang={lang}
            dragState={dragState}
            setDragState={setDragState}
            onReorder={reorderRow}
            onRemove={removeRow}
            onDropFromPalette={addRowAt}
            onOpenFilter={(col, anchorEl) => setFilterPopup({ column: col, anchorEl })}
            activeFiltersByCol={activeFiltersByCol}
          />
          <FieldPalette
            available={groupableKeys.filter(k => !rowGroups.includes(k))}
            chipsInRows={rowGroups}
            dragState={dragState}
            setDragState={setDragState}
            onAdd={(col) => addRowAt(col, rowGroups.length)}
            onRemove={removeRow}
            lang={lang}
            t={t}
          />
        </div>

        {/* Measure panel */}
        <div style={{ background: "#0a0a0b", border: `1px solid ${border}`, borderRadius: 8, padding: "0.9rem 1rem" }}>
          <div style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.4rem" }}>
            {lang === "sk" ? "Metrika + agregácia" : "Measure + aggregation"}
          </div>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            <StyledSelect
              value={measure.agg}
              onChange={(v) => setMeasure(m => ({ ...m, agg: v }))}
              style={{ flex: "0 0 140px" }}
              options={[
                { value: "count",          label: "count" },
                { value: "count_distinct", label: "count distinct" },
                { value: "sum",            label: "sum" },
                { value: "avg",            label: "avg" },
                { value: "min",            label: "min" },
                { value: "max",            label: "max" },
                { value: "median",         label: "median" },
              ]}
            />
            <span style={{ color: dim, fontSize: "0.82rem" }}>{lang === "sk" ? "z" : "of"}</span>
            <StyledSelect
              value={measure.column}
              onChange={(v) => setMeasure(m => ({ ...m, column: v }))}
              style={{ flex: 1 }}
              options={[
                { value: "__count__", label: "* (all rows)" },
                ...(measure.agg === "count_distinct"
                    ? Object.keys(PIVOT_COLUMNS).map(k => ({ value: k, label: t(PIVOT_COLUMNS[k].label) }))
                    : numericColumnKeys.map(k => ({ value: k, label: t(PIVOT_COLUMNS[k].label) }))),
              ]}
            />
          </div>

          {/* Chart type — single row */}
          <div style={{ marginTop: "0.6rem" }}>
            <div style={{ fontSize: "0.62rem", color: dim, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.25rem" }}>
              {lang === "sk" ? "Zobrazenie" : "View"}
            </div>
            <StyledSelect
              value={chartType}
              onChange={setChartType}
              options={[
                { value: "table", label: <IconLabel icon={<IconTree/>}>{lang === "sk" ? "Tabuľka (strom s hierarchiou)" : "Table (tree with hierarchy)"}</IconLabel> },
                { value: "bar",   label: <IconLabel icon={<IconBars/>}>{lang === "sk" ? "Bar graf (top-level)"          : "Bar chart (top-level)"}</IconLabel> },
              ]}
            />
          </div>

          {/* Sort — two dropdowns: column + direction */}
          <div style={{ marginTop: "0.65rem" }}>
            <div style={{ fontSize: "0.62rem", color: dim, fontFamily: mono, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.25rem" }}>
              {lang === "sk" ? "Zoradenie" : "Sort"}
            </div>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <StyledSelect
                value={sortCol}
                onChange={setSortCol}
                style={{ flex: 1 }}
                options={[
                  { value: "value", label: <IconLabel icon={<IconSigma/>}>{lang === "sk" ? "Podľa hodnoty metriky" : "By measure value"}</IconLabel> },
                  { value: "count", label: <IconLabel icon={<IconHash/>}>{lang  === "sk" ? "Podľa počtu projektov" : "By project count"}</IconLabel> },
                  { value: "name",  label: <IconLabel icon={<IconAZ/>}>{lang    === "sk" ? "Podľa názvu skupiny"   : "By group name"}</IconLabel> },
                ]}
              />
              <StyledSelect
                value={sortDir}
                onChange={setSortDir}
                style={{ flex: "0 0 180px" }}
                options={sortCol === "name"
                  ? [
                      { value: "asc",  label: <IconLabel icon={<IconArrUp/>}>A → Z</IconLabel> },
                      { value: "desc", label: <IconLabel icon={<IconArrDn/>}>Z → A</IconLabel> },
                    ]
                  : [
                      { value: "desc", label: <IconLabel icon={<IconArrDn/>}>{lang === "sk" ? "Najväčšie prvé" : "Largest first"}</IconLabel> },
                      { value: "asc",  label: <IconLabel icon={<IconArrUp/>}>{lang === "sk" ? "Najmenšie prvé" : "Smallest first"}</IconLabel> },
                    ]}
              />
            </div>
          </div>

          {/* Top-N + checkboxes — grouped toggles row */}
          <div style={{
            marginTop: "0.75rem", paddingTop: "0.6rem",
            borderTop: `1px dashed ${border}`,
            display: "flex", gap: "0.65rem", alignItems: "center", flexWrap: "wrap",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span style={{ fontSize: "0.68rem", color: dim, fontFamily: mono, letterSpacing: "0.05em", textTransform: "uppercase" }}>Top-N</span>
              <StyledSelect
                value={topN}
                onChange={(v) => setTopN(Number(v))}
                style={{ flex: "0 0 90px" }}
                options={[
                  { value: 0,  label: lang === "sk" ? "Všetko" : "All" },
                  { value: 5,  label: "5" },
                  { value: 10, label: "10" },
                  { value: 20, label: "20" },
                  { value: 50, label: "50" },
                ]}
              />
            </div>
            <StyledCheckbox
              checked={percentOfTotal}
              onChange={setPercentOfTotal}
              label={lang === "sk" ? "% z celku" : "% of total"}
              warn={percentOfTotal && !pctOfTotalValid ? (lang === "sk" ? "Pre avg/min/max/medián nie je sčítateľné" : "Not additive for avg/min/max/median") : false}
              title={!pctOfTotalValid ? (lang === "sk" ? "Pre avg/min/max/medián nie je sčítateľné" : "Not additive for avg/min/max/median") : undefined}
            />
            <StyledCheckbox
              checked={showSubtotals}
              onChange={setShowSubtotals}
              label={lang === "sk" ? "Subtotaly" : "Subtotals"}
            />
            <StyledCheckbox
              checked={hideEmpty}
              onChange={setHideEmpty}
              label={lang === "sk" ? "Skryť prázdne" : "Hide empty"}
            />
          </div>
        </div>
      </div>

      {/* ── RESULTS HEADER ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div>
          <div style={{ fontSize: "0.78rem", color: dim, fontFamily: mono }}>
            {lang === "sk" ? "Filtered" : "Filtered"}: <strong style={{ color: "#e8e8ed" }}>{filtered.length}</strong>/{projects.length} {lang === "sk" ? "projektov" : "projects"} ·
            {" "}<strong style={{ color: "#e8e8ed" }}>{rawTree.children.length}</strong> {lang === "sk" ? "top skupín" : "top groups"}
            {" "}· {lang === "sk" ? "Σ" : "Σ"} <strong style={{ color: green }}>{fmtValue(grandValue)}</strong>
          </div>
          <div style={{ fontSize: "0.82rem", color: "#e8e8ed", marginTop: "0.15rem" }}>
            <span style={{ color: dim }}>{measureLabelText} · by {rowLabelText}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          {rowGroups.length >= 2 && (
            <>
              <button onClick={expandAll}
                style={{ background: "transparent", border: `1px solid ${border}`, color: dim, borderRadius: 4, padding: "0.35rem 0.6rem", cursor: "pointer", fontSize: "0.72rem", fontFamily: "inherit" }}
              >▾ {lang === "sk" ? "Rozbaliť všetko" : "Expand all"}</button>
              <button onClick={collapseAll}
                style={{ background: "transparent", border: `1px solid ${border}`, color: dim, borderRadius: 4, padding: "0.35rem 0.6rem", cursor: "pointer", fontSize: "0.72rem", fontFamily: "inherit" }}
              >▸ {lang === "sk" ? "Zbaliť" : "Collapse"}</button>
            </>
          )}
          <button onClick={exportCSV} className="btn-s" style={{ fontSize: "0.78rem", padding: "0.45rem 1rem" }}>
            ⬇ CSV
          </button>
        </div>
      </div>

      {/* ── CHART / TABLE ──
          Wrapped in ProtectedData so casual Ctrl+C → Excel doesn't work.
          CSV export button (above) is the legit path — it respects tier
          limits and sends the exact slice the user sees. */}
      <ProtectedData lang={lang}>
      {(() => {
        if (flatTreeRows.length === 0) {
          return (
            <div style={{ color: dim, fontSize: "0.85rem", padding: "2rem", textAlign: "center", border: `1px dashed ${border}`, borderRadius: 8 }}>
              {lang === "sk" ? "Žiadne výsledky pre aktuálny filter." : "No results for current filter."}
            </div>
          );
        }

        // Bar chart — always top-level (primary group) bars; users who want
        // drill-down go to the table view where the tree lives.
        if (chartType === "bar") {
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {topNLimited.map(r => (
                <div key={r.pathKey} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 240px) 1fr 140px", gap: "0.85rem", alignItems: "center" }}>
                  <div style={{ fontSize: "0.83rem", color: "#e8e8ed", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</div>
                  <div style={{ height: 22, background: "#0e0e10", borderRadius: 4, overflow: "hidden", border: `1px solid ${border}` }}>
                    <div style={{
                      width: `${maxTopValue > 0 ? (Math.abs(r.value) / maxTopValue) * 100 : 0}%`, height: "100%",
                      background: `linear-gradient(90deg, ${green}40, ${green})`,
                      transition: "width 0.5s ease",
                    }} />
                  </div>
                  <div style={{ fontFamily: mono, fontSize: "0.85rem", color: green, fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {fmtValue(r.value)}
                  </div>
                </div>
              ))}
            </div>
          );
        }

        // TABLE (tree) — one merged "group" column with indentation per level.
        // This keeps the table compact regardless of hierarchy depth (no empty
        // whitespace stretching across L1-L5 for leaf rows). Subtotals are
        // bolder / slightly tinted, leaves are regular. Each non-leaf node has
        // a chevron (▸/▾) to collapse/expand.
        return (
          <div style={{ border: `1px solid ${border}`, borderRadius: 8, overflow: "auto", maxHeight: 720 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead style={{ background: "#0e0e10", position: "sticky", top: 0, zIndex: 2 }}>
                <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.64rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  <th style={{ ...th, color: green }}>
                    {rowGroups.map((g, i) => (
                      <span key={g}>
                        {i > 0 && <span style={{ color: dim, opacity: 0.5, margin: "0 0.3rem" }}>›</span>}
                        <span style={{ color: i === 0 ? green : dim }}>{t(PIVOT_COLUMNS[g]?.label)}</span>
                      </span>
                    ))}
                  </th>
                  <th style={{ ...th, textAlign: "right", minWidth: 60, width: 80 }}>{lang === "sk" ? "Proj." : "Proj."}</th>
                  <th style={{ ...th, textAlign: "right", color: green, minWidth: 90, width: 140 }}>{measureLabelText}</th>
                </tr>
              </thead>
              <tbody>
                {flatTreeRows.map((n, idx) => {
                  const isSubtotal = !n.isLeaf;
                  const shadeForLevel = ["#12121a", "#0f0f14", "#0c0c0f", "#0a0a0c"][Math.min(n.level, 3)];
                  // Indentation: when subtotals are ON, we visualise hierarchy
                  // through indent + parent rows (context comes from above).
                  // When subtotals are OFF, we render leaves as a flat list
                  // with the FULL path inline ("District › Project") — so
                  // there's no need to indent deeper levels.
                  const indent = showSubtotals ? 0.4 + n.level * 0.75 : 0.4;
                  // Leaves without subtotals → show full path inline so user
                  // sees the context (district, developer, project) all in
                  // one cell. With subtotals ON, parent rows carry context,
                  // so just the leaf's own label is sufficient.
                  const displayText = (!showSubtotals && n.isLeaf && rowGroups.length > 1)
                    ? n.path.join(" › ")
                    : n.label;
                  return (
                    <tr
                      key={n.pathKey + "|" + idx}
                      style={{
                        background: isSubtotal ? shadeForLevel : (idx % 2 ? "transparent" : "rgba(255,255,255,0.015)"),
                        borderTop: n.level === 0 ? `1px solid ${border}` : `1px solid #16161a`,
                      }}
                    >
                      <td style={{
                        ...td,
                        paddingLeft: `${indent}rem`,
                        fontWeight: isSubtotal ? 700 : 400,
                        color: isSubtotal ? "#e8e8ed" : "#c4c4cc",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}>
                        {/* Level pill — tiny, only on subtotal rows as a visual anchor */}
                        {isSubtotal && (
                          <span style={{ fontFamily: mono, fontSize: "0.55rem", color: green, opacity: 0.7, marginRight: "0.4rem", padding: "1px 4px", border: `1px solid ${green}33`, borderRadius: 3, verticalAlign: "middle" }}>
                            L{n.level + 1}
                          </span>
                        )}
                        {n.hasChildren ? (
                          <button
                            onClick={() => toggleNode(n.pathKey)}
                            style={{ background: "transparent", border: "none", color: green, cursor: "pointer", padding: 0, marginRight: "0.35rem", fontSize: "0.7rem", width: 12, display: "inline-block", verticalAlign: "middle" }}
                            title={n.isCollapsed ? (lang === "sk" ? "Rozbaliť" : "Expand") : (lang === "sk" ? "Zbaliť" : "Collapse")}
                          >{n.isCollapsed ? "▸" : "▾"}</button>
                        ) : (
                          <span style={{ display: "inline-block", width: 12, marginRight: "0.35rem" }} />
                        )}
                        <span title={displayText}>{displayText}</span>
                        {isSubtotal && n.isCollapsed && (
                          <span style={{ marginLeft: "0.5rem", fontSize: "0.64rem", color: dim, fontFamily: mono, opacity: 0.7 }}>
                            ({n.children.length}{lang === "sk" ? " pod" : " sub"})
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: isSubtotal ? "#c4c4cc" : dim, fontWeight: isSubtotal ? 600 : 400 }}>
                        {n.count}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: green, fontWeight: isSubtotal ? 800 : 600 }}>
                        {isSubtotal && <span style={{ opacity: 0.5, marginRight: "0.3rem" }}>Σ</span>}
                        {fmtValue(n.value)}
                      </td>
                    </tr>
                  );
                })}
                {/* Grand total */}
                <tr style={{ background: "#0a0a0b", borderTop: `2px solid ${green}66` }}>
                  <td style={{ ...td, fontWeight: 800, color: green, fontFamily: mono, letterSpacing: "0.06em", textTransform: "uppercase", fontSize: "0.74rem" }}>
                    Σ {lang === "sk" ? "CELKOM" : "TOTAL"}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: mono, color: green, fontWeight: 700 }}>{rawTree.count}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: mono, color: green, fontWeight: 900, fontSize: "0.9rem" }}>
                    {percentOfTotal ? "100.0%" : fmtValue(grandValue)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })()}
      </ProtectedData>

      {/* ── Per-chip autofilter popup (portal-style absolute) ── */}
      {filterPopup && (
        <ColumnAutofilter
          column={filterPopup.column}
          anchorEl={filterPopup.anchorEl}
          allValues={distinctForColumn(filterPopup.column)}
          filter={quickFilterForCol(filterPopup.column)}
          onApply={(patch) => applyQuickFilter(filterPopup.column, patch)}
          onClear={() => clearQuickFilter(filterPopup.column)}
          onClose={() => setFilterPopup(null)}
          lang={lang}
        />
      )}

      <style>{`
        @media (max-width: 760px) { .pivot-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </div>
  );
}

/* FilterRow — one row in the multi-filter list. Column dropdown +
   operator dropdown (context-aware) + value input (context-aware). */
/* StyledSelect — a drop-in replacement for <select> that fully respects the
   dark theme. Native <select> drops back to the OS-rendered options list,
   which on macOS is a pale grey popover that clashes with everything. This
   custom component renders a button + a styled popover list, matching
   pvtInput exactly so the visual parity with other inputs is preserved.

   Options can be passed as strings or {value, label} pairs. onChange receives
   the raw value (not an event). Outside-click and Esc close the popover. */
function StyledSelect({ value, onChange, options, style = {}, disabled = false, title, placeholder, ariaLabel, flex }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const opts = (options || []).map(o => (typeof o === "string" || typeof o === "number") ? { value: o, label: String(o) } : o);
  const selected = opts.find(o => o.value === value);
  const displayLabel = selected?.label ?? placeholder ?? "";

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div style={{ position: "relative", flex, minWidth: 0, ...style }}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          ...pvtInput,
          marginTop: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
          textAlign: "left",
          width: "100%",
          color: "#e8e8ed",
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.borderColor = green + "88"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = border; }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayLabel}</span>
        <span style={{ color: green, fontSize: "0.62rem", opacity: 0.8, fontFamily: mono, flexShrink: 0 }}>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div
          ref={popRef}
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            minWidth: "100%",
            maxWidth: "min(420px, 85vw)",
            background: "#0b0b0e",
            border: `1px solid ${green}`,
            borderRadius: 6,
            boxShadow: "0 20px 48px rgba(0,0,0,0.9), 0 0 0 1px rgba(0,229,160,0.12)",
            maxHeight: 280,
            overflowY: "auto",
            zIndex: 500,
            padding: "0.25rem",
          }}
        >
          {opts.length === 0 ? (
            <div style={{ padding: "0.4rem 0.65rem", color: dim, fontSize: "0.78rem", fontStyle: "italic" }}>—</div>
          ) : opts.map(o => {
            const isSelected = o.value === value;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => { onChange(o.value); setOpen(false); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  textAlign: "left",
                  background: isSelected ? "rgba(0,229,160,0.14)" : "transparent",
                  border: "none",
                  borderLeft: `2px solid ${isSelected ? green : "transparent"}`,
                  color: isSelected ? green : "#e8e8ed",
                  padding: "0.4rem 0.65rem",
                  fontSize: "0.82rem",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  borderRadius: 3,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.background = "rgba(255,255,255,0.045)"; e.currentTarget.style.color = green; } }}
                onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#e8e8ed"; } }}
              >
                <span style={{ width: 14, display: "inline-block", marginRight: "0.25rem", color: green, fontSize: "0.75rem" }}>
                  {isSelected ? "✓" : ""}
                </span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* AutocompleteInput — combobox-style input for filter values.
   - Focus (or type) → dropdown appears with all / matching suggestions
   - Click suggestion → auto-fills and closes
   - Arrow keys navigate; Enter picks highlighted; Esc closes
   - Typing raw text still works (for patterns that don't match any value) */
function AutocompleteInput({ value, onChange, suggestions, placeholder, lang }) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef(null);
  const popRef = useRef(null);
  const inputRef = useRef(null);

  const q = String(value || "").trim().toLowerCase();
  const filtered = q === ""
    ? suggestions
    : suggestions.filter(s => String(s).toLowerCase().includes(q));

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      setOpen(false);
      setHighlight(-1);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Scroll the highlighted option into view on keyboard nav
  useEffect(() => {
    if (highlight < 0 || !popRef.current) return;
    const el = popRef.current.querySelector(`[data-ac-idx="${highlight}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const pick = (v) => {
    onChange(v);
    setOpen(false);
    setHighlight(-1);
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && highlight >= 0 && filtered[highlight] != null) {
        e.preventDefault();
        pick(String(filtered[highlight]));
      } else {
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  // Visual: split the option text around the matched substring to highlight it
  const renderLabel = (s) => {
    const str = String(s);
    if (!q) return str;
    const lower = str.toLowerCase();
    const idx = lower.indexOf(q);
    if (idx === -1) return str;
    return (
      <>
        {str.slice(0, idx)}
        <mark style={{ background: "rgba(0,229,160,0.28)", color: green, borderRadius: 2, padding: "0 1px" }}>
          {str.slice(idx, idx + q.length)}
        </mark>
        {str.slice(idx + q.length)}
      </>
    );
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <input
        ref={inputRef}
        value={value ?? ""}
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlight(-1); }}
        onFocus={() => { setOpen(true); setHighlight(-1); }}
        onKeyDown={onKey}
        placeholder={placeholder}
        autoComplete="off"
        style={{ ...pvtInput, marginTop: 0 }}
      />
      {open && (
        <div
          ref={popRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0, right: 0,
            background: "#0b0b0e",
            border: `1px solid ${green}`,
            borderRadius: 6,
            boxShadow: "0 20px 48px rgba(0,0,0,0.9), 0 0 0 1px rgba(0,229,160,0.12)",
            maxHeight: 240,
            overflowY: "auto",
            zIndex: 600,
            padding: "0.25rem",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: "0.45rem 0.6rem", color: dim, fontSize: "0.76rem", fontStyle: "italic" }}>
              {suggestions.length === 0
                ? (lang === "sk" ? "žiadne hodnoty v dátach" : "no values in data")
                : (lang === "sk" ? "žiadna zhoda — ale môžeš dopísať vlastnú hodnotu" : "no match — type a custom value")}
            </div>
          ) : (
            <>
              <div style={{ padding: "0.2rem 0.6rem 0.3rem", fontSize: "0.62rem", color: dim, fontFamily: mono, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {filtered.length > 100
                  ? (lang === "sk" ? `${filtered.length} možností · zobrazených prvých 100` : `${filtered.length} matches · showing first 100`)
                  : (lang === "sk" ? `${filtered.length} ${filtered.length === 1 ? "možnosť" : "možností"}` : `${filtered.length} ${filtered.length === 1 ? "match" : "matches"}`)}
              </div>
              {filtered.slice(0, 100).map((s, i) => {
                const str = String(s);
                const isExact = str.toLowerCase() === q && q !== "";
                const isHighlight = i === highlight;
                return (
                  <button
                    key={str + "|" + i}
                    data-ac-idx={i}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}  /* prevent input blur before click fires */
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(str)}
                    style={{
                      display: "flex", alignItems: "center", width: "100%",
                      textAlign: "left",
                      background: isHighlight ? "rgba(0,229,160,0.14)" : "transparent",
                      border: "none",
                      borderLeft: `2px solid ${isExact || isHighlight ? green : "transparent"}`,
                      color: isHighlight || isExact ? green : "#e8e8ed",
                      padding: "0.35rem 0.6rem",
                      fontSize: "0.82rem",
                      fontFamily: "inherit",
                      cursor: "pointer",
                      borderRadius: 3,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{renderLabel(str)}</span>
                    {isExact && <span style={{ marginLeft: "auto", color: green, fontSize: "0.68rem", fontFamily: mono, opacity: 0.8 }}>✓ exact</span>}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FilterRow({ f, projects, lang, t, onChange, onRemove }) {
  const col = PIVOT_COLUMNS[f.column] || {};
  const colType = col.type;
  const ops = colType === "number" ? FILTER_OPS_NUM : FILTER_OPS_TEXT;

  // For `in` / `not in` we offer a chip multi-select of distinct values.
  const distinctValues = (() => {
    if (colType !== "text" && colType !== "derived") return [];
    const set = new Set();
    for (const p of projects) {
      const v = cellValue(p, f.column);
      if (v != null && v !== "") set.add(String(v));
    }
    return Array.from(set).sort();
  })();

  const setCol = (column) => {
    // Reset op / value when column changes (types may differ)
    const newType = PIVOT_COLUMNS[column]?.type;
    const defaultOp = newType === "number" ? "=" : "is";
    onChange({ column, op: defaultOp, value: "", values: [], min: "", max: "" });
  };

  // Visual cue: filter is incomplete = no value yet = currently a no-op
  const incomplete = isIncompleteFilter(f);

  return (
    /* NOTE: we deliberately do NOT use CSS `opacity` on this container to
       signal "inactive" — `opacity` cascades to descendants, and the
       StyledSelect popups render inside this row, so the whole dropdown
       became translucent when the filter was inactive. Visual cue moved to
       the inactive/active badge + dim text color instead. */
    <div style={{
      display: "grid", gridTemplateColumns: "minmax(140px, 180px) minmax(90px, 120px) 1fr auto 28px",
      gap: "0.4rem", alignItems: "center",
    }}>
      {/* Column */}
      <StyledSelect
        value={f.column}
        onChange={setCol}
        options={Object.entries(PIVOT_COLUMNS).map(([k, c]) => ({ value: k, label: t(c.label) }))}
      />

      {/* Operator */}
      <StyledSelect
        value={f.op}
        onChange={(v) => onChange({ op: v })}
        options={ops.map(op => ({ value: op, label: op }))}
      />

      {/* Value(s) */}
      <div>
        {f.op === "is empty" || f.op === "not empty" ? (
          <div style={{ color: dim, fontSize: "0.8rem", padding: "0.5rem 0.25rem", fontStyle: "italic" }}>—</div>
        ) : f.op === "between" && colType === "number" ? (
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input type="number" value={f.min ?? ""} onChange={e => onChange({ min: e.target.value })}
              placeholder={lang === "sk" ? "od" : "from"} style={{ ...pvtInput, marginTop: 0 }} />
            <input type="number" value={f.max ?? ""} onChange={e => onChange({ max: e.target.value })}
              placeholder={lang === "sk" ? "do" : "to"} style={{ ...pvtInput, marginTop: 0 }} />
          </div>
        ) : (f.op === "in" || f.op === "not in") && (colType === "text" || colType === "derived") ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", maxHeight: 90, overflowY: "auto", padding: "0.25rem", border: `1px solid ${border}`, borderRadius: 6, background: "#0e0e10" }}>
            {distinctValues.length === 0 ? (
              <span style={{ color: dim, fontSize: "0.72rem" }}>{lang === "sk" ? "žiadne hodnoty v dátach" : "no values in data"}</span>
            ) : distinctValues.map(v => {
              const active = (f.values || []).includes(v);
              return (
                <button key={v}
                  onClick={() => {
                    const cur = f.values || [];
                    onChange({ values: active ? cur.filter(x => x !== v) : [...cur, v] });
                  }}
                  style={{
                    fontFamily: "inherit", fontSize: "0.68rem",
                    padding: "0.15rem 0.45rem", borderRadius: 100, cursor: "pointer",
                    background: active ? "rgba(0,229,160,0.15)" : "transparent",
                    border: `1px solid ${active ? green : border}`,
                    color: active ? green : dim,
                  }}>{v}</button>
              );
            })}
          </div>
        ) : colType === "number" ? (
          <input type="number" value={f.value ?? ""} onChange={e => onChange({ value: e.target.value })}
            style={{ ...pvtInput, marginTop: 0 }} />
        ) : (
          /* Text / derived value → combobox with autocomplete over distinct
             values from the current dataset. User can click to pick or type
             a custom value; both work for is / is not / contains / starts
             with / ends with. */
          <AutocompleteInput
            value={f.value ?? ""}
            onChange={(v) => onChange({ value: v })}
            suggestions={distinctValues}
            placeholder={lang === "sk" ? "klikni pre zoznam · alebo píš…" : "click for list · or type…"}
            lang={lang}
          />
        )}
      </div>

      {/* Status badge — explains why adding a blank filter doesn't hide data. */}
      {incomplete ? (
        <span style={{
          fontFamily: mono, fontSize: "0.6rem", color: dim,
          padding: "3px 7px", border: `1px solid ${border}`, borderRadius: 4,
          letterSpacing: "0.04em", textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
          title={lang === "sk" ? "Zadaj hodnotu, inak sa nič nefiltruje" : "Enter a value; otherwise nothing is filtered"}>
          {lang === "sk" ? "· neaktívny" : "· inactive"}
        </span>
      ) : (
        <span style={{
          fontFamily: mono, fontSize: "0.6rem", color: green,
          padding: "3px 7px", background: "rgba(0,229,160,0.1)",
          border: `1px solid ${green}55`, borderRadius: 4,
          letterSpacing: "0.04em", textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}>
          {lang === "sk" ? "✓ aktívny" : "✓ active"}
        </span>
      )}

      <button onClick={onRemove}
        title={lang === "sk" ? "Odstrániť filter" : "Remove filter"}
        style={{
          background: "transparent", border: `1px solid ${border}`, color: "#ff6b6b",
          borderRadius: 6, cursor: "pointer", padding: "0.35rem",
          fontSize: "0.85rem", lineHeight: 1,
        }}>×</button>
    </div>
  );
}

const pvtLabel = {
  display: "block", fontSize: "0.68rem", color: "#8a8a96",
  fontFamily: mono, letterSpacing: "0.04em", textTransform: "uppercase",
};
const pvtInput = {
  width: "100%", padding: "0.5rem 0.7rem",
  background: "#0e0e10", border: `1px solid ${border}`, borderRadius: 6,
  color: "#e8e8ed", fontSize: "0.85rem", fontFamily: "inherit",
  boxSizing: "border-box", outline: "none", marginTop: "0.3rem",
};

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
