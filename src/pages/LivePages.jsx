import { useState, useEffect, useRef } from "react";
import { useAuth } from "../lib/useAuth";
import { useCapabilities } from "../lib/useCapabilities";
import { useProjects, useProjectFlats, useAllFlats, useEarlyAccessStats, useProjectSnapshots } from "../lib/useData";
import { supabase } from "../lib/supabase";
import { liveT, ll } from "../lib/liveLang";
import { track } from "../lib/track";
import { isPersonalEmail } from "../lib/emailValidation";
import UpgradePrompt from "../components/UpgradePrompt";
import PivotV2 from "./PivotV2";

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
        {/* Disable "Detail" when we know the project has no unit-level
            data to show (total_units === 0). Saves the user a round-trip
            to an empty detail page. */}
        {(p.total_units || 0) > 0 ? (
          <button onClick={() => setCurrent && setCurrent(`Project:${p.id}`)} style={miniBtn}>{t.tbl_detail}</button>
        ) : (
          <span style={{ color: dim, fontSize: "0.72rem", fontStyle: "italic" }} title={lang === "sk" ? "Pre tento projekt ešte nemáme detail" : "No unit-level data yet"}>
            —
          </span>
        )}
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

  // Scatter-plot → table handoff: clicking a dot in AreaPriceScatter
  // scrolls the matching row into view and flashes it briefly. The ID
  // is cleared after 3.5s so the glow animation doesn't linger.
  const [highlightedFlatId, setHighlightedFlatId] = useState(null);
  const onSelectFlat = (flatId) => {
    if (!flatId) return;
    setHighlightedFlatId(flatId);
    // Scroll the actual row into view (not the whole table) — handled
    // inside FlatsTable via its own useEffect on the ID.
    window.setTimeout(() => {
      setHighlightedFlatId(prev => prev === flatId ? null : prev);
    }, 3500);
  };

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
        flats.length === 0 ? (
          /* Three distinct empty-state reasons — don't just say "no data",
             tell the user why so they know whether to wait or move on. */
          <div style={{
            padding: "2rem 1.5rem", border: `1px dashed ${border}`, borderRadius: 10,
            background: "rgba(255,255,255,0.02)", textAlign: "center",
          }}>
            <div style={{ fontSize: "1rem", color: text, fontWeight: 600, marginBottom: "0.6rem" }}>
              {lang === "sk" ? "Pre tento projekt zatiaľ nemáme detail bytov" : "No unit-level data for this project yet"}
            </div>
            <div style={{ color: dim, fontSize: "0.88rem", lineHeight: 1.6, maxWidth: 560, margin: "0 auto" }}>
              {(() => {
                // Case 1: project claims N units but we have 0 in DB → sync gap
                if (project && (project.total_units || 0) > 0) {
                  return lang === "sk"
                    ? <>Projekt inzeruje <strong style={{ color: text }}>{project.total_units}</strong> bytov, ale zoznam sa ešte nezosynchronizoval do našej DB. Dáta pribudnú pri najbližšom mesačnom behu.</>
                    : <>The project lists <strong style={{ color: text }}>{project.total_units}</strong> units but the flat-level sync hasn't run yet. Data will appear on the next monthly sync.</>;
                }
                // Case 2: total_units is 0 — developer's public listing is empty
                return lang === "sk"
                  ? "Developer zatiaľ nezverejnil verejný zoznam bytov. Projekt je v registri, ale detail bude dostupný až po zverejnení developerom."
                  : "The developer hasn't published a public unit list yet. The project is in the registry but detail will appear once they publish.";
              })()}
            </div>
            <button onClick={() => setCurrent && setCurrent("Live")} className="btn-s" style={{ marginTop: "1.25rem", fontSize: "0.82rem" }}>
              ← {lang === "sk" ? "Späť na prehľad" : "Back to dashboard"}
            </button>
          </div>
        ) :
        <>
          {project && <ProjectInsights project={project} flats={flats} snapshots={snapshots} lang={lang} onSelectFlat={onSelectFlat} />}
          <FlatsTable flats={flats} t={t} lang={lang} highlightedFlatId={highlightedFlatId} />
        </>}
    </main>
  );
}

/* ═══ ProjectInsights ═══ Rich analytics on the per-project detail
   page. Renders a KPI strip + a set of inline-SVG charts computed
   client-side from whatever flats / snapshots we already load — no
   extra backend work. Every chart is self-contained (no deps, just
   React + SVG) so bundle stays small. */
function ProjectInsights({ project, flats, snapshots, lang, onSelectFlat }) {
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
          <AreaPriceScatter flats={flats} lang={lang} onSelectFlat={onSelectFlat} />
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

/* ── Scatter: area_m² (X) × price_€ (Y), dot per unit ──────────
   Each dot carries its full flat object so hover shows a rich HTML
   tooltip (unit · interior · price · €/m²) and click propagates the
   flat ID up so LiveProjectDetail can scroll + highlight its row. */
function AreaPriceScatter({ flats, lang, onSelectFlat }) {
  const W = 940, H = 260, pad = { l: 50, r: 16, t: 12, b: 36 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const locale = lang === "sk" ? "sk-SK" : "en-US";

  const points = flats
    .map(f => ({
      x: Number(f.obytna_plocha || f.celkova_plocha),
      y: Number(f.cena_s_dph),
      stav: f.stav,
      flat: f,
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

  // Hover state for the rich tooltip — {flat, clientX, clientY} relative
  // to the <svg>'s bounding rect so we can position an HTML overlay.
  const [hover, setHover] = useState(null);
  const wrapperRef = useRef(null);

  const handleMove = (e, flat) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({
      flat,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
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
        {/* Points — clickable, hoverable, with visual feedback */}
        {points.map((p, i) => {
          const isHovered = hover?.flat?.id === p.flat.id;
          return (
            <circle
              key={p.flat.id || i}
              cx={xAt(p.x)} cy={yAt(p.y)}
              r={isHovered ? 7 : 4}
              fill={colorFor(p.stav)}
              opacity={hover && !isHovered ? 0.35 : 0.85}
              style={{ cursor: onSelectFlat ? "pointer" : "default", transition: "r 0.12s, opacity 0.12s" }}
              onMouseEnter={(e) => handleMove(e, p.flat)}
              onMouseMove={(e) => handleMove(e, p.flat)}
              onMouseLeave={() => setHover(null)}
              onClick={() => onSelectFlat && onSelectFlat(p.flat.id)}
            />
          );
        })}
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

      {/* HTML tooltip — richer than SVG <title>, styleable, follows cursor.
          Positioned via wrapper rect so it tracks the pointer inside the
          chart. pointer-events:none so it doesn't steal hover from dots. */}
      {hover && (() => {
        const f = hover.flat;
        const m2 = (f.cena_s_dph != null && f.obytna_plocha != null && Number(f.obytna_plocha) > 0)
          ? Math.round(Number(f.cena_s_dph) / Number(f.obytna_plocha)) : null;
        return (
          <div style={{
            position: "absolute",
            left: hover.x + 14, top: hover.y + 14,
            background: "#0b0b0e",
            border: `1px solid ${border}`,
            borderLeft: `3px solid ${colorFor(f.stav)}`,
            borderRadius: 8, padding: "0.55rem 0.75rem",
            fontSize: "0.8rem", color: "#e8e8ed",
            pointerEvents: "none", zIndex: 20, whiteSpace: "nowrap",
            boxShadow: "0 10px 24px rgba(0,0,0,0.6)",
            maxWidth: 280,
          }}>
            <div style={{ fontWeight: 600, marginBottom: "0.35rem" }}>
              {f.unit_detail || f.unit_id || "—"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.2rem 0.6rem", fontSize: "0.76rem" }}>
              <span style={{ color: dim }}>Interiér</span>
              <span style={{ fontFamily: mono }}>{f.obytna_plocha ? `${f.obytna_plocha} m²` : "—"}</span>
              <span style={{ color: dim }}>Cena</span>
              <span style={{ fontFamily: mono }}>{f.cena_s_dph != null ? `${Math.round(f.cena_s_dph).toLocaleString(locale)} €` : "—"}</span>
              <span style={{ color: dim }}>Cena/m²</span>
              <span style={{ fontFamily: mono, color: green }}>{m2 != null ? `${m2.toLocaleString(locale)} €` : "—"}</span>
            </div>
            {onSelectFlat && (
              <div style={{ marginTop: "0.4rem", fontSize: "0.68rem", color: dim, fontStyle: "italic" }}>
                klikni pre zobrazenie v tabuľke →
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function FlatsTable({ flats, t, lang, highlightedFlatId }) {
  const stavStyle = {
    V: { color: "#00e5a0", bg: "rgba(0,229,160,0.08)" },
    P: { color: "#f5a623", bg: "rgba(245,166,35,0.08)" },
    R: { color: "#888", bg: "rgba(136,136,136,0.08)" },
    PR: { color: "#aaa", bg: "rgba(170,170,170,0.08)" },
  };
  const locale = lang === "sk" ? "sk-SK" : "en-US";

  // ── Sortable + filterable columns ─────────────────────────────
  // kind: "num" → range filter (min/max)
  // kind: "text" → include-list filter (checkbox of distinct values)
  const COLS = [
    { key: "unit",      label: t.tbl_flat,        align: "left",  kind: "text", def: "asc",  get: f => f.unit_detail || f.unit_id || "" },
    { key: "budova",    label: t.tbl_building,    align: "left",  kind: "text", def: "asc",  get: f => f.budova || "" },
    { key: "poschodie", label: t.tbl_floor,       align: "left",  kind: "num",  def: "asc",  get: f => f.poschodie },
    { key: "izby",      label: t.tbl_rooms,       align: "left",  kind: "num",  def: "asc",  get: f => f.izby },
    { key: "interior",  label: t.tbl_interior,    align: "right", kind: "num",  def: "asc",  get: f => f.obytna_plocha },
    { key: "exterior",  label: t.tbl_exterior,    align: "right", kind: "num",  def: "asc",  get: f => f.exterier_plocha },
    { key: "total",     label: t.tbl_total,       align: "right", kind: "num",  def: "asc",  get: f => f.celkova_plocha },
    { key: "price",     label: t.tbl_price,       align: "right", kind: "num",  def: "asc",  get: f => f.cena_s_dph },
    { key: "price_m2",  label: t.tbl_eur_m2,      align: "right", kind: "num",  def: "asc",
      get: f => (f.cena_s_dph != null && f.obytna_plocha != null && Number(f.obytna_plocha) > 0)
                ? Number(f.cena_s_dph) / Number(f.obytna_plocha) : null },
    { key: "orient",    label: t.tbl_orientation, align: "left",  kind: "text", def: "asc",  get: f => f.orientacia || "" },
    { key: "handover",  label: t.tbl_handover,    align: "left",  kind: "text", def: "asc",  get: f => f.kolaudacia || "" },
    { key: "stav",      label: t.tbl_status,      align: "left",  kind: "text", def: "asc",  get: f => f.stav || "" },
  ];

  const [sort, setSort] = useState({ key: "unit", dir: "asc" });
  // columnFilters: { [colKey]: { values: Set<string> }  (text mode)
  //                           | { min: number|null, max: number|null }  (num mode) }
  const [columnFilters, setColumnFilters] = useState({});
  // Which column's filter popup is currently open (null = none).
  const [openFilterCol, setOpenFilterCol] = useState(null);

  const onHeaderClick = (col) => {
    setSort(prev => prev.key === col.key
      ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { key: col.key, dir: col.def });
  };

  // ── Apply filters ────────────────────────────────────────────
  const filteredFlats = flats.filter(f => {
    for (const col of COLS) {
      const cf = columnFilters[col.key];
      if (!cf) continue;
      const v = col.get(f);
      if (col.kind === "num") {
        if (v == null || !Number.isFinite(Number(v))) {
          // numeric filter with value missing → drop unless user opted in
          if (!cf.includeEmpty) return false;
          continue;
        }
        const n = Number(v);
        if (cf.min != null && n < cf.min) return false;
        if (cf.max != null && n > cf.max) return false;
      } else {
        if (!cf.values || cf.values.size === 0) continue;
        const key = v == null || v === "" ? "__empty__" : String(v);
        if (!cf.values.has(key)) return false;
      }
    }
    return true;
  });

  // ── Sort ─────────────────────────────────────────────────────
  const sortedFlats = (() => {
    const col = COLS.find(c => c.key === sort.key) || COLS[0];
    const dir = sort.dir === "desc" ? -1 : 1;
    const copy = [...filteredFlats];
    copy.sort((a, b) => {
      const av = col.get(a), bv = col.get(b);
      const ae = av == null || av === "";
      const be = bv == null || bv === "";
      if (ae && be) return 0;
      if (ae) return 1;
      if (be) return -1;
      if (col.kind === "num") return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv), locale, { numeric: true }) * dir;
    });
    return copy;
  })();

  const sortArrow = (col) => {
    if (sort.key !== col.key) return <span style={{ opacity: 0.25, marginLeft: 3, fontSize: "0.62rem" }}>↕</span>;
    return <span style={{ color: green, marginLeft: 3, fontSize: "0.7rem" }}>{sort.dir === "asc" ? "▴" : "▾"}</span>;
  };

  // Is this column currently filtered (effectively narrowing results)?
  const isFilterActive = (col) => {
    const cf = columnFilters[col.key];
    if (!cf) return false;
    if (col.kind === "num") return cf.min != null || cf.max != null;
    return cf.values && cf.values.size > 0;
  };

  const updateColumnFilter = (colKey, patch) => {
    setColumnFilters(prev => {
      const next = { ...prev };
      if (patch == null) delete next[colKey];
      else next[colKey] = patch;
      return next;
    });
  };

  // ── Highlight row from scatter click ────────────────────────
  // Scroll matching row into view when highlightedFlatId changes; the
  // pulse animation picks up via a className match in render.
  useEffect(() => {
    if (!highlightedFlatId) return;
    // defer by a frame so the row is rendered before we scroll
    const id = requestAnimationFrame(() => {
      const row = document.getElementById(`flat-row-${highlightedFlatId}`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [highlightedFlatId]);

  const totalCount = flats.length;
  const visibleCount = sortedFlats.length;

  return (
    <ProtectedData lang={lang} style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "visible" }}>
      {/* Filter summary bar — only shown when any filter is active */}
      {visibleCount !== totalCount && (
        <div style={{
          padding: "0.55rem 0.9rem", background: "rgba(0,229,160,0.04)",
          borderBottom: `1px solid ${border}`, fontSize: "0.78rem",
          display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap",
        }}>
          <span style={{ color: dim }}>
            {lang === "sk" ? "Zobrazuje sa" : "Showing"} <strong style={{ color: text }}>{visibleCount}</strong> {lang === "sk" ? "z" : "of"} {totalCount} {lang === "sk" ? "bytov" : "flats"}
          </span>
          <button onClick={() => setColumnFilters({})}
            style={{ marginLeft: "auto", background: "transparent", border: "none", color: dim, cursor: "pointer", fontSize: "0.74rem", textDecoration: "underline" }}>
            {lang === "sk" ? "vymazať filtre" : "clear filters"}
          </button>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead style={{ background: "#0e0e10" }}>
            <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {COLS.map(col => {
                const filterActive = isFilterActive(col);
                return (
                  <th key={col.key}
                      style={{
                        ...th, textAlign: col.align, userSelect: "none",
                        color: sort.key === col.key ? "#e8e8ed" : dim,
                        position: "relative",
                      }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>
                      <span onClick={() => onHeaderClick(col)}
                            style={{ cursor: "pointer" }}
                            title={lang === "sk" ? "Klikni pre zoradenie" : "Click to sort"}>
                        {col.label}{sortArrow(col)}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenFilterCol(openFilterCol === col.key ? null : col.key); }}
                        title={lang === "sk" ? "Filtrovať" : "Filter"}
                        style={{
                          background: filterActive ? "rgba(0,229,160,0.18)" : "transparent",
                          border: `1px solid ${filterActive ? green : "transparent"}`,
                          color: filterActive ? green : dim,
                          borderRadius: 3, cursor: "pointer", padding: "0 3px",
                          fontSize: "0.72rem", lineHeight: 1,
                        }}>
                        ⛆
                      </button>
                    </div>
                    {openFilterCol === col.key && (
                      <ColumnFilterMenu
                        col={col}
                        flats={flats}
                        filter={columnFilters[col.key]}
                        onApply={(patch) => { updateColumnFilter(col.key, patch); setOpenFilterCol(null); }}
                        onClose={() => setOpenFilterCol(null)}
                        lang={lang}
                        locale={locale}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedFlats.length === 0 && (
              <tr><td colSpan={COLS.length} style={{ ...td, textAlign: "center", color: dim, padding: "1.25rem", fontStyle: "italic" }}>
                {lang === "sk" ? "Žiadne byty neprešli filtrami." : "No flats match the filters."}
              </td></tr>
            )}
            {sortedFlats.map(f => {
              const isHl = f.id === highlightedFlatId;
              return (
              <tr key={f.id}
                  id={`flat-row-${f.id}`}
                  className={isHl ? "flat-row-flash" : ""}
                  style={{ borderTop: `1px solid ${border}` }}>
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
                <td style={{ ...td, textAlign: "right", fontFamily: mono, color: dim }}>
                  {(f.cena_s_dph != null && f.obytna_plocha != null && Number(f.obytna_plocha) > 0)
                    ? Math.round(Number(f.cena_s_dph) / Number(f.obytna_plocha)).toLocaleString(locale)
                    : "—"}
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
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Highlight pulse — 3s flash on the row matched by scatter click.
          Keyframes defined inline so FlatsTable is self-contained. */}
      <style>{`
        @keyframes flatRowFlash {
          0%   { background-color: rgba(0,229,160,0.35); box-shadow: inset 0 0 0 2px rgba(0,229,160,0.6); }
          60%  { background-color: rgba(0,229,160,0.12); box-shadow: inset 0 0 0 1px rgba(0,229,160,0.3); }
          100% { background-color: transparent; box-shadow: none; }
        }
        .flat-row-flash > td { animation: flatRowFlash 3s ease-out; }
      `}</style>
    </ProtectedData>
  );
}

/* ── Per-column filter menu — inline popover anchored under the TH.
      Text columns: checkbox list of distinct values + search.
      Number columns: min / max range with placeholder hints. */
function ColumnFilterMenu({ col, flats, filter, onApply, onClose, lang, locale }) {
  // Local draft so "použiť" commits, "zrušiť" discards.
  const isNum = col.kind === "num";

  // Distinct values + numeric stats derived once per open
  const { distinct, hasEmpty, numStats } = (() => {
    const seen = new Set();
    const strs = [];
    const nums = [];
    let empty = false;
    for (const f of flats) {
      const v = col.get(f);
      if (v == null || v === "") { empty = true; continue; }
      if (isNum) {
        const n = Number(v);
        if (Number.isFinite(n)) nums.push(n);
      } else {
        const s = String(v);
        const k = s.trim().toLowerCase();
        if (!seen.has(k)) { seen.add(k); strs.push(s); }
      }
    }
    strs.sort((a, b) => String(a).localeCompare(String(b), locale, { numeric: true }));
    let stats = null;
    if (nums.length) {
      const s = [...nums].sort((a, b) => a - b);
      stats = { min: s[0], max: s[s.length - 1] };
    }
    return { distinct: strs, hasEmpty: empty, numStats: stats };
  })();

  // Drafts
  const initSelected = filter?.values ? new Set(filter.values) : new Set();
  const [selected, setSelected] = useState(initSelected);
  const [minV, setMinV] = useState(filter?.min ?? "");
  const [maxV, setMaxV] = useState(filter?.max ?? "");
  const [search, setSearch] = useState("");

  // Close on outside click / Esc
  useEffect(() => {
    const onDown = (e) => {
      const pop = document.getElementById(`flats-col-filter-${col.key}`);
      if (pop && !pop.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [col.key, onClose]);

  const toggleVal = (v) => setSelected(prev => {
    const n = new Set(prev);
    if (n.has(v)) n.delete(v); else n.add(v);
    return n;
  });

  const commit = () => {
    if (isNum) {
      const min = minV === "" ? null : Number(minV);
      const max = maxV === "" ? null : Number(maxV);
      if (min == null && max == null) onApply(null);
      else onApply({ min, max });
    } else {
      if (selected.size === 0) onApply(null);
      else onApply({ values: selected });
    }
  };
  const clearAll = () => { onApply(null); };

  const q = search.trim().toLowerCase();
  const shown = q ? distinct.filter(v => String(v).toLowerCase().includes(q)) : distinct;

  return (
    <div id={`flats-col-filter-${col.key}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute", top: "100%", left: 0,
        marginTop: 4, width: 260, zIndex: 50,
        background: "#111116", border: `1px solid ${border}`,
        borderRadius: 8, padding: "0.7rem 0.8rem",
        boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
        color: "#e8e8ed", fontFamily: "inherit", letterSpacing: "normal",
        textTransform: "none", fontSize: "0.82rem",
      }}>
      <div style={{ fontWeight: 600, marginBottom: "0.55rem" }}>{col.label}</div>

      {isNum ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <span style={{ fontSize: "0.72rem", color: dim }}>od</span>
              <input type="number" value={minV} onChange={(e) => setMinV(e.target.value)}
                placeholder={numStats ? String(Math.round(numStats.min)) : ""}
                style={flatsFilterInp} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <span style={{ fontSize: "0.72rem", color: dim }}>do</span>
              <input type="number" value={maxV} onChange={(e) => setMaxV(e.target.value)}
                placeholder={numStats ? String(Math.round(numStats.max)) : ""}
                style={flatsFilterInp} />
            </label>
          </div>
          {numStats && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.72rem", color: dim }}>
              V dátach: <strong style={{ color: "#e8e8ed", fontWeight: 500 }}>{Math.round(numStats.min)}</strong> – <strong style={{ color: "#e8e8ed", fontWeight: 500 }}>{Math.round(numStats.max)}</strong>
            </div>
          )}
        </div>
      ) : (
        <div>
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === "sk" ? "Hľadať…" : "Search…"}
            style={{ ...flatsFilterInp, width: "100%", marginBottom: "0.4rem" }} />
          <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.35rem", fontSize: "0.72rem" }}>
            <button style={flatsFilterMini} onClick={() => {
              const all = [...distinct]; if (hasEmpty) all.push("__empty__"); setSelected(new Set(all));
            }}>všetko</button>
            <button style={flatsFilterMini} onClick={() => setSelected(new Set())}>nič</button>
            <button style={flatsFilterMini} onClick={() => {
              setSelected(prev => {
                const all = [...distinct]; if (hasEmpty) all.push("__empty__");
                const inv = new Set();
                for (const v of all) if (!prev.has(v)) inv.add(v);
                return inv;
              });
            }}>prevrátiť</button>
          </div>
          <div style={{
            maxHeight: 220, overflowY: "auto",
            border: `1px solid ${border}`, borderRadius: 5, background: "#0a0a0c",
            padding: "0.2rem",
          }}>
            {hasEmpty && (
              <label style={flatsFilterRow(selected.has("__empty__"))}>
                <input type="checkbox" checked={selected.has("__empty__")} onChange={() => toggleVal("__empty__")} style={{ accentColor: green }} />
                <span style={{ fontStyle: "italic", color: dim }}>(prázdne)</span>
              </label>
            )}
            {shown.length === 0 ? (
              <div style={{ padding: "0.5rem", color: dim, fontSize: "0.76rem", textAlign: "center" }}>Žiadne zhody.</div>
            ) : shown.map(v => (
              <label key={String(v)} style={flatsFilterRow(selected.has(String(v)))}>
                <input type="checkbox" checked={selected.has(String(v))} onChange={() => toggleVal(String(v))} style={{ accentColor: green }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(v)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.7rem" }}>
        <button onClick={clearAll}
          style={{ background: "transparent", border: "none", color: dim, cursor: "pointer", fontSize: "0.76rem", textDecoration: "underline", padding: "0.3rem 0" }}>
          vymazať
        </button>
        <div style={{ display: "flex", gap: "0.35rem" }}>
          <button onClick={onClose}
            style={{ background: "transparent", border: `1px solid ${border}`, color: "#e8e8ed", borderRadius: 5, padding: "0.35rem 0.7rem", cursor: "pointer", fontSize: "0.76rem" }}>
            zrušiť
          </button>
          <button onClick={commit}
            style={{ background: green, border: "none", color: "#0a0a0c", borderRadius: 5, padding: "0.35rem 0.9rem", cursor: "pointer", fontSize: "0.76rem", fontWeight: 600 }}>
            použiť
          </button>
        </div>
      </div>
    </div>
  );
}

const flatsFilterInp = {
  padding: "0.35rem 0.5rem",
  background: "#0a0a0c",
  border: `1px solid ${border}`,
  borderRadius: 5,
  color: "#e8e8ed",
  fontSize: "0.8rem",
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};
const flatsFilterMini = {
  background: "transparent",
  border: `1px solid ${border}`,
  color: "#8a8a96",
  padding: "0.22rem 0.5rem",
  borderRadius: 4,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: "0.72rem",
};
const flatsFilterRow = (checked) => ({
  display: "flex", alignItems: "center", gap: "0.45rem",
  padding: "0.28rem 0.45rem", cursor: "pointer", borderRadius: 3,
  fontSize: "0.8rem", color: checked ? "#e8e8ed" : "#c4c4cc",
});

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
  // Flats for the unit-level pivot surface. Lazy — cache kicks in on first
  // pivot open, no extra round-trip on page load. RLS gates visibility by
  // tier (anon=0, free=chosen_project only, paid/admin=all).
  const { flats: allFlats } = useAllFlats();

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

      {/* ═══ PIVOT — drag & drop builder ═══ */}
      <div style={{ marginBottom: "2.5rem" }}>
        <PivotV2 lang={lang} />
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
