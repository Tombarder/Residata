import { useState, useEffect, useRef, useMemo } from "react";
import { useAuth } from "../lib/useAuth";
import { useCapabilities } from "../lib/useCapabilities";
import { useProjects, useProjectFlats, useEarlyAccessStats, useProjectSnapshots, useMarketTotals, useTotalsList } from "../lib/useData";
import { supabase } from "../lib/supabase";
import { liveT, ll } from "../lib/liveLang";
import { goBack } from "../lib/routing";
import { track } from "../lib/track";
import { isPersonalEmail } from "../lib/emailValidation";
import UpgradePrompt from "../components/UpgradePrompt";
import PivotV2 from "./PivotV2";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const dim = "#8a8a96";
const border = "#222228";
const bg = "#16161a";
// Added for AiChatLogsPanel — matched to the rest of the platform.
const text = "#e8e8ed";
const bg2 = "#0e0e10";
const panel = "#14141a";
const red = "#ff6b6b";
const orange = "#f5a623";

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
  const activeProjects = allProjects.filter(isActive);
  const historicalProjects = allProjects.filter(p => !isActive(p));
  const [showHistorical, setShowHistorical] = useState(false);

  // ── Sortable columns ───────────────────────────────────────
  // Default: alphabetical by name. The previous default came from
  // useProjects() which ordered by available_units desc — that
  // pushed Slnečnice (registry-only inflated count) to the very
  // top, which read as "Slnečnice dominates the market" even though
  // we don't actually track most of those units. Alphabetical is
  // neutral; user can click any header to re-sort.
  const SORT_COLS = {
    name:           { kind: "text", get: p => p.name || "" },
    district:       { kind: "text", get: p => p.district || "" },
    total_units:    { kind: "num",  get: p => p.total_units },
    available_units:{ kind: "num",  get: p => p.available_units },
    sold_units:     { kind: "num",  get: p => p.sold_units },
    sold_percentage:{ kind: "num",  get: p => p.sold_percentage },
    avg_price_eur_m2:{ kind: "num", get: p => p.avg_price_eur_m2 },
    sold_last_month:{ kind: "num",  get: p => p.sold_last_month },
  };
  const [sort, setSort] = useState({ key: "name", dir: "asc" });
  const onHeaderClick = (key) => {
    setSort(prev => prev.key === key
      ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
      : { key, dir: SORT_COLS[key].kind === "num" ? "desc" : "asc" });
  };
  const sortArrow = (key) => {
    if (sort.key !== key) return <span style={{ opacity: 0.25, marginLeft: 4, fontSize: "0.65rem" }}>↕</span>;
    return <span style={{ color: green, marginLeft: 4, fontSize: "0.7rem" }}>{sort.dir === "asc" ? "▴" : "▾"}</span>;
  };
  const sortProjects = (arr) => {
    const col = SORT_COLS[sort.key];
    if (!col) return arr;
    const dir = sort.dir === "desc" ? -1 : 1;
    const locale = lang === "sk" ? "sk-SK" : "en-US";
    return [...arr].sort((a, b) => {
      const av = col.get(a), bv = col.get(b);
      const ae = av == null || av === "";
      const be = bv == null || bv === "";
      if (ae && be) return 0;
      if (ae) return 1;   // nulls last
      if (be) return -1;
      if (col.kind === "num") return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv), locale, { numeric: true, sensitivity: "base" }) * dir;
    });
  };
  const projects = sortProjects(activeProjects);

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
      {/* Landing page už má marketing copy a summary metriky (MarketPulse).
          Live stránka je čistý dátový pohľad. Necháme len prípadný tier-
          špecifický upsell (anonymous → register, free → upgrade); bez
          generickej "Data refreshed daily…" vety a bez SummaryCards
          (total_units strip bol nafúknutý o Bory/Slnečnice manual_totals,
          cca 10k vs reálnych ~5,1k). */}
      {(showSignupPrompt || showUpgradeToPaid) && (
        <p className="sec-desc" style={{ marginBottom: "2.5rem" }}>
          {showSignupPrompt && <>{t.live_desc_anon}</>}
          {showUpgradeToPaid && <><button onClick={() => setCurrent && setCurrent("Pricing")} style={linkBtn}>{t.upgrade_to_paid}</button> — {t.live_desc_free}</>}
        </p>
      )}

      <div style={{ marginTop: "2rem" }}>
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
                    <SortableTh sortKey="name"             align="left"  current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t.tbl_project}</SortableTh>
                    <SortableTh sortKey="district"         align="left"  current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t.tbl_district}</SortableTh>
                    <SortableTh sortKey="total_units"      align="right" current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t.tbl_units}</SortableTh>
                    <SortableTh sortKey="available_units"  align="right" current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t.tbl_available}</SortableTh>
                    <SortableTh sortKey="sold_units"       align="right" current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t.tbl_sold}</SortableTh>
                    <SortableTh sortKey="sold_percentage"  align="right" current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t.tbl_sold_pct}</SortableTh>
                    <SortableTh sortKey="avg_price_eur_m2" align="right" current={sort} onClick={onHeaderClick} arrow={sortArrow}>{t.tbl_eur_m2}</SortableTh>
                    {/* Sold velocity — header viditeľný vždy, obsah blurred pre non-paid */}
                    <SortableTh sortKey="sold_last_month"  align="right" current={sort} onClick={onHeaderClick} arrow={sortArrow} title={can("view_sold_velocity") ? t.tbl_sold_30d_tooltip_paid : t.tbl_sold_30d_tooltip_locked}>
                      {t.tbl_sold_30d}
                      {!can("view_sold_velocity") && <span style={{ marginLeft: 4, color: green, fontSize: "0.6rem" }}>🔒</span>}
                    </SortableTh>
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
/**
 * Sortable column header — same UX pattern as the platform's
 * FlatsTable. Click to sort by this column, click again to reverse.
 * Active column shows the green ▴/▾; inactive show a dim ↕ to hint
 * "I'm clickable too". Keyboard accessible via tabIndex + Enter.
 */
function SortableTh({ sortKey, align = "left", current, onClick, arrow, title, children }) {
  const active = current?.key === sortKey;
  return (
    <th
      onClick={() => onClick(sortKey)}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(sortKey); } }}
      tabIndex={0}
      title={title || "Click to sort"}
      style={{
        ...th,
        textAlign: align,
        cursor: "pointer",
        color: active ? "#e8e8ed" : dim,
        userSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}{arrow(sortKey)}
    </th>
  );
}

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
  // Detail is openable for any project that exists in the registry.
  // Even if total_units = 0 in the latest month (manual projects whose
  // snapshot has fallen behind, or projects that don't publish prices),
  // the detail page falls back to the project's most recent batch — so
  // it always has SOMETHING to show.
  const hasDetail = !!p.id;
  const stale = (p.total_units || 0) === 0;

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

  const openDetail = () => hasDetail && setCurrent && setCurrent(`Project:${p.id}`);

  // Make the whole row behave like a link: click anywhere to open
  // detail, cursor-pointer, subtle green tint on hover. Name cell
  // gets an underline-on-hover so the user sees an explicit "click
  // the name" affordance rather than having to discover the Detail
  // button. Non-interactive cells (Detail column with the button)
  // stop propagation so the button's click is the only handler.
  const clickable = hasDetail;
  return (
    <tr
      onClick={clickable ? openDetail : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDetail(); } } : undefined}
      tabIndex={clickable ? 0 : -1}
      role={clickable ? "link" : undefined}
      className={clickable ? "project-row-clickable" : undefined}
      style={{ borderTop: `1px solid ${border}`, cursor: clickable ? "pointer" : "default", transition: "background 0.12s" }}
    >
      <td style={td}>
        {clickable ? (
          <span className="project-row-name" style={{ color: "#e8e8ed", fontWeight: 600 }}>
            {p.name}
          </span>
        ) : (
          <strong>{p.name}</strong>
        )}
      </td>
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
          : (() => {
              // Three reasons why €/m² could be null in projects_live:
              //   a) developer doesn't publish prices at all → min/max also null
              //   b) developer publishes prices but areas are missing
              //      (manual project where Boss didn't fill obytna_plocha)
              //   c) project has 0 V/R/PR (sold-out or pre-launch)
              // Disambiguate so the tooltip is honest.
              const hasPriceRange = p.min_price != null && p.max_price != null;
              const hasInventory = (p.available_units || 0) + (p.reserved_units || 0) + (p.prereserved_units || 0) > 0;
              let title, label;
              if (hasPriceRange) {
                title = lang === "sk"
                  ? "Ceny zverejnené, ale chýbajú obytné plochy — €/m² nemožno spočítať"
                  : "Prices published but living areas missing — can't compute €/m²";
                label = lang === "sk" ? "chýbajú plochy" : "areas missing";
              } else if (!hasInventory) {
                title = lang === "sk"
                  ? "Žiadne byty na predaj — projekt je vypredaný alebo pred štartom"
                  : "No for-sale units — project is sold-out or pre-launch";
                label = "—";
              } else {
                title = lang === "sk" ? "Developer nezverejňuje ceny" : "Developer doesn't publish prices";
                label = lang === "sk" ? "nezverejnené" : "not published";
              }
              return (
                <span title={title} style={{ color: dim, fontStyle: "italic", fontSize: "0.75rem" }}>
                  {label}
                </span>
              );
            })()}
      </td>
      <td style={{ ...td, textAlign: "right", fontFamily: mono }}>{velocityCell}</td>
      <td style={{ ...td, textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
        {/* Detail je vždy klikateľný — ak máme akékoľvek dáta v archíve,
            detail page si z neho zobrazí najnovší dostupný batch. Pre
            "stale" projekty (manuálne, neaktualizované) ukáže badge
            "staršie dáta". */}
        <button
          onClick={openDetail}
          style={miniBtn}
          title={stale ? (lang === "sk" ? "Detail s poslednými dostupnými dátami" : "Detail with last available data") : undefined}
        >
          {t.tbl_detail}{stale ? " ⓘ" : ""}
        </button>
      </td>
    </tr>
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
    track("scatter_dot_clicked", { project_id: projectId, flat_id: flatId });
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

  // Smart back: prefer the actual previous page in browser history
  // (Analytics → project detail → back returns to Analytics, not the
  // generic /app/projects). Fall back to a sensible static target
  // only when there's no in-app history (direct URL open).
  const inPlatform = typeof window !== "undefined" && window.location.pathname.startsWith("/app");
  const backFallback = inPlatform ? "App:Projects" : "Live";
  const onBack = () => goBack(setCurrent, backFallback);

  return (
    <main style={{ padding: "5rem 2rem 4rem", maxWidth: 1200, margin: "0 auto" }}>
      <button onClick={() => onBack()} style={{ ...linkBtn, marginBottom: "1rem" }}>{t.back_to_projects}</button>

      <Label>{[project?.city, project?.district].filter(Boolean).join(" · ") || "—"}</Label>
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
          // No flat-level rows yet (scraper hasn't pulled per-unit
          // detail for this project). But the projects table almost
          // always carries useful aggregates (total / avail / sold /
          // €/m² / sold-30d / district / developer) — show those as
          // a value-first "project summary" instead of just a "no
          // data" wall. Sync gap caveat goes below the data, framed
          // as "live changes need 1-2 syncs", not "we have nothing".
          (project && (project.total_units || 0) > 0)
            ? <ProjectAggregateOnly project={project} lang={lang} t={t} canVelocity={can("view_sold_velocity")} />
            : (
              <div style={{
                padding: "2rem 1.5rem", border: `1px dashed ${border}`, borderRadius: 10,
                background: "rgba(255,255,255,0.02)", textAlign: "center",
              }}>
                <div style={{ fontSize: "1rem", color: "#e8e8ed", fontWeight: 600, marginBottom: "0.6rem" }}>
                  {lang === "sk" ? "Developer zatiaľ nezverejnil verejný zoznam bytov" : "Developer hasn't published a public unit list yet"}
                </div>
                <div style={{ color: dim, fontSize: "0.88rem", lineHeight: 1.6, maxWidth: 560, margin: "0 auto" }}>
                  {lang === "sk"
                    ? "Projekt je v registri, ale detail bude dostupný až po zverejnení developerom."
                    : "The project is in the registry but detail will appear once they publish."}
                </div>
                <button onClick={() => onBack()} className="btn-s" style={{ marginTop: "1.25rem", fontSize: "0.82rem" }}>
                  ← {lang === "sk" ? "Späť na prehľad" : "Back to dashboard"}
                </button>
              </div>
            )
        ) :
        <>
          {project && <ProjectInsights project={project} flats={flats} snapshots={snapshots} lang={lang} onSelectFlat={onSelectFlat} />}
          <FlatsTable flats={flats} t={t} lang={lang} highlightedFlatId={highlightedFlatId} />
        </>}
    </main>
  );
}

/**
 * ProjectAggregateOnly — fallback view when we have project-level
 * aggregates (total_units / available / sold / €/m² / sold-30d /
 * district / developer) but no per-flat rows yet. Mirrors the
 * KPI strip from ProjectInsights so the user immediately sees
 * value, not a "no data" wall. A small note at the bottom is the
 * only mention of the sync gap — framed as "unit-level breakdown
 * arriving next sync", not "we have nothing".
 */
function ProjectAggregateOnly({ project, lang, t, canVelocity }) {
  const locale = lang === "sk" ? "sk-SK" : "en-US";
  const fmt = (n) => n == null ? "—" : Number(n).toLocaleString(locale);
  const eurM2 = project.avg_price_eur_m2 ? Math.round(project.avg_price_eur_m2) : null;
  const soldPct = project.sold_percentage != null ? `${project.sold_percentage}%` : null;
  const soldDataMissing = (project.sold_units || 0) === 0 && (project.reserved_units || 0) === 0;

  const kpis = [
    { label: lang === "sk" ? "Bytov spolu" : "Total units",  value: fmt(project.total_units), accent: "#e8e8ed" },
    { label: lang === "sk" ? "Voľné" : "Available",          value: fmt(project.available_units), accent: green },
    { label: lang === "sk" ? "Predané" : "Sold",             value: soldDataMissing ? "—" : fmt(project.sold_units), accent: "#f5a623", sub: soldDataMissing ? (lang === "sk" ? "developer nezverejňuje" : "developer doesn't publish") : null },
    { label: lang === "sk" ? "Predaných %" : "Sold %",       value: soldPct || "—", accent: "#f5a623" },
    { label: "€/m²",                                         value: eurM2 ? fmt(eurM2) : (lang === "sk" ? "nezverejnené" : "not published"), accent: eurM2 ? "#e8e8ed" : dim },
    ...(canVelocity && project.sold_last_month != null ? [{
      label: lang === "sk" ? "Predané (30d)" : "Sold (30d)",
      value: project.sold_last_month > 0 ? `+${project.sold_last_month}` : "0",
      accent: green,
    }] : []),
  ];

  return (
    <div>
      {/* KPI strip — same shape as the full ProjectInsights so the
          page reads as "the data we have" not as "we have nothing". */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "0.85rem", marginBottom: "1.5rem",
      }}>
        {kpis.map((k, i) => (
          <div key={i} style={{
            background: "#16161a", border: `1px solid ${border}`,
            borderRadius: 10, padding: "1rem 1.1rem",
          }}>
            <div style={{ fontFamily: mono, fontSize: "0.62rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.45rem" }}>
              {k.label}
            </div>
            <div style={{ fontFamily: mono, fontSize: "1.55rem", fontWeight: 700, color: k.accent || "#e8e8ed", letterSpacing: "-0.02em", lineHeight: 1 }}>
              {k.value}
            </div>
            {k.sub && (
              <div style={{ fontSize: "0.66rem", color: dim, marginTop: "0.4rem", fontStyle: "italic" }}>
                {k.sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* No big "waiting for sync" banner — the KPI strip above is
          already a complete answer for projects that don't publish
          unit-level detail. A barely-visible footnote is enough. */}
      <div style={{ marginTop: "0.5rem", color: dim, fontSize: "0.7rem", fontFamily: mono, textAlign: "right" }}>
        {lang === "sk" ? "Detail po jednotkách u tohto projektu zatiaľ nemáme." : "Per-unit detail not available yet for this project."}
      </div>
    </div>
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
  // `Number(null) === 0` in JS — so the old filter `Number.isFinite`
  // alone let null-priced flats through as 0, which then polluted
  // the price histogram with a phantom '€0 units' bar on the far
  // left. Guard against that explicitly. Same guard needed anywhere
  // else that does `Number(f.cena_s_dph)` without checking for null.
  const availPrices = availFlats
    .map(f => Number(f.cena_s_dph))
    .filter(v => Number.isFinite(v) && v > 0);
  const topPrice = availPrices.length ? Math.max(...availPrices) : null;

  // Has the developer published prices for the FOR-SALE flats? Sold (P)
  // flats almost never have a published price (the field is removed once
  // the unit is sold), so including them inflates the "missing prices"
  // count and incorrectly classifies projects as no-price/partial when
  // in fact every available unit IS priced. Denominator = V/R/PR; sold
  // flats are excluded from the price-coverage calculation entirely.
  const forSaleFlats = flats.filter(f => f.stav === "V" || f.stav === "R" || f.stav === "PR");
  const pricedForSaleFlats = forSaleFlats.filter(f => Number.isFinite(Number(f.cena_s_dph)) && Number(f.cena_s_dph) > 0);
  const noPrices = forSaleFlats.length > 0 && pricedForSaleFlats.length === 0;
  // Show "computed on subset" banner whenever <80% of for-sale units are
  // priced — matches the audit classification (HAS_PRICES = ≥80%,
  // PARTIAL = 10-80%, NO_PRICES = <10%) computed against V/R/PR only.
  const partialPrices = pricedForSaleFlats.length > 0 && pricedForSaleFlats.length < forSaleFlats.length * 0.8;

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
  // Cards tagged isPriceKpi=true are filtered out when the developer
  // publishes no prices. We swap them with non-price alternatives so
  // the strip stays full and informative.
  // Non-price alternatives (computed from available units):
  //   - Avg area (m²) instead of Avg €/m²
  //   - Largest available unit (area) instead of most expensive
  const availForArea = availFlats.filter(f => Number.isFinite(Number(f.obytna_plocha)) && Number(f.obytna_plocha) > 0);
  const avgArea = availForArea.length
    ? availForArea.reduce((s, f) => s + Number(f.obytna_plocha), 0) / availForArea.length
    : null;
  const largestAreaFlat = availForArea.length
    ? availForArea.reduce((best, f) => Number(f.obytna_plocha) > Number(best.obytna_plocha) ? f : best, availForArea[0])
    : null;
  const largestArea = largestAreaFlat ? Number(largestAreaFlat.obytna_plocha) : null;

  const kpis = [
    {
      label: L("Voľné byty", "Available units"),
      value: project.available_units ?? "—",
      sub: project.total_units ? `${fmtPct(((project.available_units || 0) / project.total_units) * 100)} ${L("z celku", "of total")}` : null,
      tint: green,
    },
    // PRICE KPI (filtered out when noPrices)
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
      isPriceKpi: true,
    },
    // FALLBACK KPI shown only when noPrices=true (replaces Avg €/m²)
    {
      label: L("Priem. plocha (voľné)", "Avg area (avail.)"),
      value: avgArea ? `${avgArea.toFixed(1)} m²` : "—",
      sub: availForArea.length ? `${availForArea.length} ${L("voľných", "avail")}` : null,
      tint: "#e8e8ed",
      isFallbackKpi: true,
    },
    {
      label: L("Najrýchlejšie sa predáva", "Fastest moving"),
      value: fastestRoom ? `${fastestRoom.room}-${L("izb", "room")}` : "—",
      sub: fastestRoom ? `${fmtPct((fastestRoom.sold / fastestRoom.total) * 100)} ${L("predané", "sold")}` : null,
      tint: "#f5a623",
    },
    // PRICE KPI (filtered out when noPrices)
    {
      label: L("Najdrahší voľný byt", "currently the most expensive unit"),
      value: topPrice ? fmtEur(topPrice) : "—",
      sub: availPrices.length ? `${availPrices.length} ${L("voľných s cenou", "units with price available")}` : null,
      tint: "#e8e8ed",
      isPriceKpi: true,
      onClick: (() => {
        const topFlat = availFlats.find(f => Number(f.cena_s_dph) === topPrice);
        return (onSelectFlat && topFlat) ? () => onSelectFlat(topFlat) : null;
      })(),
    },
    // FALLBACK KPI shown only when noPrices=true (replaces Most expensive)
    {
      label: L("Najväčší voľný byt", "Largest available unit"),
      value: largestArea ? `${largestArea.toFixed(1)} m²` : "—",
      sub: largestAreaFlat
        ? `${largestAreaFlat.izby ? largestAreaFlat.izby + "-izb · " : ""}${largestAreaFlat.unit_id || ""}`
        : null,
      tint: "#e8e8ed",
      isFallbackKpi: true,
      onClick: (largestAreaFlat && onSelectFlat) ? () => onSelectFlat(largestAreaFlat) : null,
    },
  ];

  return (
    <section style={{ marginBottom: "2rem" }}>
      <div style={{ fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.85rem" }}>
        {L("Prehľad projektu", "Project insights")}
      </div>

      {/* No-prices warning — sits above the KPI strip so it's the first
          thing the user sees. Price-dependent KPIs (avg €/m², top price)
          are filtered out below in the kpis.map. */}
      {noPrices && (
        <div style={{
          background: "rgba(245,166,35,0.08)",
          border: "1px solid rgba(245,166,35,0.3)",
          borderRadius: 8,
          padding: "0.75rem 1rem",
          marginBottom: "1.25rem",
          fontSize: "0.8rem",
          color: "#e8e8ed",
          lineHeight: 1.5,
        }}>
          <strong style={{ color: "#f5a623" }}>⚠ {L("Bez cien", "No prices")}:</strong>{" "}
          {L(
            "Developer nezverejňuje ceny bytov v aktuálnej ponuke. Cenové grafy (rozdelenie cien, €/m² scatter) a KPIs s cenou sú skryté — nemôžu byť zmysluplné bez dát. Dostupnosť, izbovosť a plochy sú uvedené normálne.",
            "Developer doesn't publish prices for any for-sale units. Price-based charts (price distribution, area × price scatter) and price KPIs are hidden — they can't be meaningful without the data. Availability, room-type and area data below are still shown normally.",
          )}
        </div>
      )}
      {partialPrices && (
        <div style={{
          background: "rgba(245,166,35,0.06)",
          border: "1px solid rgba(245,166,35,0.2)",
          borderRadius: 8,
          padding: "0.6rem 1rem",
          marginBottom: "1.25rem",
          fontSize: "0.78rem",
          color: dim,
          lineHeight: 1.5,
        }}>
          <strong style={{ color: "#f5a623" }}>ⓘ</strong>{" "}
          {L(
            `Developer publikuje ceny iba pre ${pricedForSaleFlats.length} z ${forSaleFlats.length} bytov v ponuke — cenové grafy a priemery sú počítané iba z tejto podmnožiny.`,
            `Developer publishes prices for only ${pricedForSaleFlats.length} of ${forSaleFlats.length} for-sale units — price charts and averages are computed on this subset only.`,
          )}
        </div>
      )}

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.8rem", marginBottom: "1.5rem" }}>
        {kpis.filter(k => {
          // Price-KPIs hidden when noPrices=true (would just show "—")
          if (noPrices && k.isPriceKpi) return false;
          // Fallback KPIs only shown when noPrices=true (otherwise duplicate)
          if (!noPrices && k.isFallbackKpi) return false;
          return true;
        }).map((k, i) => (
          <div key={i} onClick={k.onClick || undefined} style={{
            background: bg, border: `1px solid ${border}`, borderRadius: 10,
            padding: "1rem 1.1rem",
            cursor: k.onClick ? "pointer" : "default",
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
          <ChartCard title={L("Predajová trajektória", "Sales trajectory")}
            subtitle={L(
              `${projectSnaps.length} ${projectSnaps.length === 1 ? "mesiac" : projectSnaps.length < 5 ? "mesiace" : "mesiacov"} histórie · zloženie projektu`,
              `${projectSnaps.length} months · project composition`
            )}>
            <TimelineChart snaps={projectSnaps} lang={lang} />
          </ChartCard>
        )}
        {projectSnaps.length >= 2 && (
          <ChartCard title={L("Tempo predaja", "Sales pace")}
            subtitle={L("predaných bytov za mesiac", "units sold per month")}>
            <TakeupChart snaps={projectSnaps} lang={lang} />
          </ChartCard>
        )}
        {roomRows.length > 0 && (() => {
          // Same data-scope pattern as the scatter below — don't claim
          // "sold / reserved / available" if the project only publishes
          // V inventory (roomRows would then have all sold=0 reserved=0
          // and the 3-color bar becomes 100% green with no context).
          const mixHasV = roomRows.some(r => r.avail > 0);
          const mixHasP = roomRows.some(r => r.sold > 0);
          const mixHasR = roomRows.some(r => r.reserved > 0);
          // Subtitles reflect the bar's left→right order: available first,
          // then reserved, then sold — matches the visual flow customers
          // read naturally (what's free → what's held → what's gone).
          let mixSubtitle, mixNote;
          if (mixHasV && mixHasP && mixHasR) {
            mixSubtitle = L("Voľné / rezervované / predané", "Available / reserved / sold");
            mixNote = null;
          } else if (mixHasV && mixHasP) {
            mixSubtitle = L("Voľné / predané", "Available / sold");
            mixNote = L("Developer nezverejňuje rezervácie.", "Developer doesn't publish reservations.");
          } else if (mixHasV && mixHasR) {
            mixSubtitle = L("Voľné / rezervované", "Available / reserved");
            mixNote = L("Developer nezverejňuje predané byty.", "Developer doesn't publish sold units.");
          } else if (mixHasV) {
            mixSubtitle = L("Voľné byty · šírka = objem", "Available units · width = volume");
            mixNote = L(
              "Developer zverejňuje iba voľné byty. Šírka bary ukazuje počet voľných oproti najväčšej izbovosti — inak by boli všetky rovnako dlhé a nepovedali by nič.",
              "Developer only publishes available units. Bar width is scaled to the largest segment so you see which room type dominates supply — otherwise every bar would be full-width green and tell you nothing.",
            );
          } else if (mixHasP && !mixHasV) {
            mixSubtitle = L("Rezervované / predané", "Reserved / sold");
            mixNote = L(
              "Projekt je vypredaný — graf ukazuje historický mix po izbách, nie aktuálnu ponuku.",
              "Project is sold out — the chart shows historical room-type mix, not current inventory.",
            );
          } else {
            mixSubtitle = L("Rezervované / predané", "Reserved / sold");
            mixNote = null;
          }
          return (
            <ChartCard title={L("Mix po izbách", "Room-type mix")} subtitle={mixSubtitle}>
              <RoomMixChart rows={roomRows} lang={lang} />
              {mixNote && (
                <div style={{ fontSize: "0.72rem", color: dim, marginTop: "0.6rem", lineHeight: 1.5, fontStyle: "italic" }}>
                  {mixNote}
                </div>
              )}
            </ChartCard>
          );
        })()}
        {availPrices.length >= 5 && (
          // Subtitle was showing "Median X" — but the median is also
          // labelled ON the dashed line inside the chart. Two labels
          // for the same number (plus a third in the bottom caption)
          // read as clutter. Subtitle now describes the scope of the
          // chart instead; the median stays anchored to its line.
          <ChartCard title={L("Rozdelenie cien voľných bytov", "Price distribution — available units")}
            subtitle={L(`${availPrices.length} bytov · rozsah ${fmtEur(Math.min(...availPrices))} – ${fmtEur(Math.max(...availPrices))}`,
                         `${availPrices.length} units · range ${fmtEur(Math.min(...availPrices))} – ${fmtEur(Math.max(...availPrices))}`)}>
            <PriceHistogram prices={availPrices} lang={lang} />
          </ChartCard>
        )}
      </div>

      {/* Price-scatter: requires actual price data. If the developer
          doesn't publish prices the chart is meaningless — skip it
          entirely (user already saw the no-prices banner above). */}
      {flats.length >= 5 && !noPrices && (() => {
        // Figure out what this project's data actually covers, so the
        // chart title + a one-liner honestly describe what the user is
        // looking at. Some developers only publish their available (V)
        // inventory; the scatter must then not claim to be "all units".
        const hasV = flats.some(f => f.stav === "V");
        const hasP = flats.some(f => f.stav === "P");
        const hasR = flats.some(f => f.stav === "R" || f.stav === "PR");
        const pricedCount = flats.filter(f => f.cena_s_dph != null && f.obytna_plocha != null && Number(f.obytna_plocha) > 0).length;

        // Title adapts to actual scope.
        let title, scopeNote;
        if (hasV && hasP && hasR) {
          title = L("Plocha × cena (všetky byty)", "Area × price (all units)");
          scopeNote = L(
            `Developer zverejňuje voľné, predané aj rezervované byty. V grafe je ${pricedCount} bytov s cenou.`,
            `Developer publishes available, sold and reserved units. Chart plots ${pricedCount} units with a listed price.`,
          );
        } else if (hasV && hasP) {
          title = L("Plocha × cena (voľné + predané)", "Area × price (available + sold)");
          scopeNote = L(
            `Developer zverejňuje voľné a predané byty, nie rezervácie. V grafe je ${pricedCount} bytov s cenou.`,
            `Developer publishes available and sold units; reservations aren't listed. Chart plots ${pricedCount} priced units.`,
          );
        } else if (hasV && hasR) {
          title = L("Plocha × cena (voľné + rezervované)", "Area × price (available + reserved)");
          scopeNote = L(
            `Developer zverejňuje voľné a rezervované byty, nie predané.`,
            `Developer publishes available and reserved units; sold units aren't listed.`,
          );
        } else if (hasV) {
          title = L("Plocha × cena (len voľné byty)", "Area × price (available units only)");
          scopeNote = L(
            `Developer zverejňuje iba voľné byty. Predané a rezervované v grafe nie sú, lebo ich nemáme.`,
            `Developer publishes only available units. Sold / reserved aren't plotted because we don't have them.`,
          );
        } else if (hasP && !hasV) {
          // Sold-out scenario — every plotted unit is already sold. Worth
          // calling out explicitly so the chart isn't read as "current market".
          title = L("Plocha × cena (predané byty)", "Area × price (sold units)");
          scopeNote = L(
            `Projekt je vypredaný / takmer vypredaný — v grafe vidíte historické predajné ceny, nie aktuálnu ponuku.`,
            `Project is sold out (or nearly) — the chart shows historical sold prices, not currently available inventory.`,
          );
        } else if (hasR && !hasV && !hasP) {
          title = L("Plocha × cena (rezervované byty)", "Area × price (reserved units)");
          scopeNote = L(
            `V ponuke sú momentálne iba rezervácie — voľné ani predané v grafe nie sú.`,
            `Only reservations are currently listed — neither available nor sold units are plotted.`,
          );
        } else {
          title = L("Plocha × cena", "Area × price");
          scopeNote = L(
            `V grafe je ${pricedCount} bytov s cenou.`,
            `Chart plots ${pricedCount} units with a listed price.`,
          );
        }

        return (
          <ChartCard title={title}
            subtitle={L("Každý bod = 1 byt · sklon ~ priemerná €/m²", "Each dot = 1 unit · slope ≈ avg €/m²")}>
            <AreaPriceScatter flats={flats} lang={lang} onSelectFlat={onSelectFlat} />
            <div style={{ fontSize: "0.72rem", color: dim, marginTop: "0.75rem", lineHeight: 1.5, fontStyle: "italic" }}>
              {scopeNote}
            </div>
          </ChartCard>
        );
      })()}

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

/* ── Smooth path generator — Catmull-Rom-ish bezier curves
 *  for stacked area charts. Returns an SVG path string for the
 *  given (x[i], y[i]) point sequence with smoothed transitions
 *  between adjacent points. */
function smoothPath(xs, ys) {
  if (xs.length === 0) return "";
  if (xs.length === 1) return `M ${xs[0]} ${ys[0]}`;
  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) {
    const dx = (xs[i] - xs[i - 1]) / 3;
    const c1x = xs[i - 1] + dx;
    const c1y = ys[i - 1];
    const c2x = xs[i] - dx;
    const c2y = ys[i];
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${xs[i]} ${ys[i]}`;
  }
  return d;
}

/* ── Sales Trajectory — premium stacked composition chart ─────
 *
 *  Headline KPI strip: % sold + velocity badge.
 *  Smooth curves (cubic bezier) instead of jagged lines.
 *  Forward projection (dashed) showing where the project is
 *  headed at current velocity.
 *  Y-axis: % scale (0-100% of total) — gives instantly readable
 *  context regardless of project size.
 *  Hover crosshair with rich tooltip.
 *
 *  Layers (bottom→top): sold (orange) → reserved (yellow) → available (green).
 *  As units sell, green layer "melts" downward.
 */
function TimelineChart({ snaps, lang }) {
  const W = 460, H = 240;  // taller for headline strip
  const headlineH = 56;
  const pad = { l: 38, r: 14, t: headlineH + 14, b: 30 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);

  const points = snaps.map((s) => ({
    month: s.snapshot_month,
    avail: s.available_units || 0,
    res:   s.reserved_units  || 0,
    sold:  s.sold_units      || 0,
    total: (s.available_units || 0) + (s.reserved_units || 0) + (s.sold_units || 0),
  }));

  // Forward projection: extrapolate 3 months ahead based on velocity.
  //
  // Velocity calc — robust to data revisions:
  //  - Walk all consecutive deltas (sold[i] - sold[i-1])
  //  - KEEP only positive deltas (real sales). Negative deltas are
  //    almost always parser revisions / dedup cleanups, not market
  //    returns — physically a sold unit can't un-sell at scale.
  //  - Average the kept deltas → velocity
  //  - This means even with 2 snapshots we can extract a useful pace
  //    if the delta is positive.
  //
  //  If ALL deltas are non-positive → can't project (will show neutral
  //  "calibrating" badge).
  const N = points.length;
  const allDeltas = {
    avail: [],
    res:   [],
    sold:  [],
  };
  for (let i = 1; i < N; i++) {
    allDeltas.avail.push(points[i].avail - points[i - 1].avail);
    allDeltas.res.push(  points[i].res   - points[i - 1].res);
    allDeltas.sold.push( points[i].sold  - points[i - 1].sold);
  }
  // For SOLD: only positive deltas count (real sales, not data revisions)
  const positiveSoldDeltas = allDeltas.sold.filter(d => d > 0);
  const velSold = positiveSoldDeltas.length > 0
    ? positiveSoldDeltas.reduce((a, d) => a + d, 0) / positiveSoldDeltas.length
    : 0;
  // For AVAIL: only negative deltas count (real units leaving inventory)
  const negativeAvailDeltas = allDeltas.avail.filter(d => d < 0);
  const velAvail = negativeAvailDeltas.length > 0
    ? negativeAvailDeltas.reduce((a, d) => a + d, 0) / negativeAvailDeltas.length
    : 0;
  // For RES: settles at last value (reservations are noisy + reverse often)
  const velRes = 0;
  // Project when we have ANY positive sold velocity from at least 1 valid
  // delta. The projection is a rough early-data estimate but better than
  // nothing — clearly labeled as such.
  const projectAheadMonths = velSold > 0.1 ? 3 : 0;
  // Confidence indicator: how many valid (positive) sold deltas we used
  const velocitySamples = positiveSoldDeltas.length;
  const isEarlyData = velocitySamples < 3;
  const lastTotal = points[N - 1].total;
  const projection = [];
  for (let k = 1; k <= projectAheadMonths; k++) {
    const a = Math.max(0, points[N - 1].avail + velAvail * k);
    const r = Math.max(0, points[N - 1].res   + velRes   * k);
    let so  = Math.min(lastTotal, points[N - 1].sold + velSold * k);
    // Conservation: a + r + so should ≈ total constant for fixed-size project
    const projTotal = a + r + so;
    if (projTotal > 0 && lastTotal > 0) {
      const scale = lastTotal / projTotal;
      projection.push({ avail: a * scale, res: r * scale, sold: so * scale });
    } else {
      projection.push({ avail: a, res: r, sold: so });
    }
  }
  const allFrames = [...points, ...projection.map((p, i) => ({
    avail: p.avail, res: p.res, sold: p.sold,
    total: p.avail + p.res + p.sold,
    isProjection: true,
    month: "+",
  }))];
  const yMax = Math.max(1, ...allFrames.map(p => p.total));

  // Use % scale (0-100%) instead of absolute count — universal regardless of project size
  const yAtPct = (frac) => pad.t + innerH - innerH * frac;

  // X positions: evenly spaced including projection
  const totalCells = allFrames.length;
  const xAt = (i) => pad.l + (innerW * i) / Math.max(1, totalCells - 1);
  const xs = allFrames.map((_, i) => xAt(i));

  // Layer Y positions (top edge of each band, in % of yMax)
  const ySold      = allFrames.map(p => yAtPct(p.sold / yMax));
  const yResTop    = allFrames.map(p => yAtPct((p.sold + p.res) / yMax));
  const yAvailTop  = allFrames.map(p => yAtPct((p.sold + p.res + p.avail) / yMax));
  const yBottom    = pad.t + innerH;

  // Smooth paths for actual data only (no projection blend in main areas)
  const realN = points.length;
  const xsReal     = xs.slice(0, realN);
  const ySoldReal  = ySold.slice(0, realN);
  const yResReal   = yResTop.slice(0, realN);
  const yAvailReal = yAvailTop.slice(0, realN);

  const dSold  = smoothPath(xsReal, ySoldReal)    + ` L ${xsReal[realN - 1]} ${yBottom} L ${xsReal[0]} ${yBottom} Z`;
  const dRes   = smoothPath(xsReal, yResReal)
                 + " " + smoothPath(xsReal.slice().reverse(), ySoldReal.slice().reverse()).replace(/^M/, "L")
                 + " Z";
  const dAvail = smoothPath(xsReal, yAvailReal)
                 + " " + smoothPath(xsReal.slice().reverse(), yResReal.slice().reverse()).replace(/^M/, "L")
                 + " Z";

  // Projection paths (dashed top edges, lighter fills)
  const xsProj     = xs.slice(realN - 1);  // include last real point as anchor
  const ySoldProj  = ySold.slice(realN - 1);
  const yResProj   = yResTop.slice(realN - 1);
  const yAvailProj = yAvailTop.slice(realN - 1);
  const hasProjection = projectAheadMonths > 0;
  const dSoldProj  = hasProjection ? smoothPath(xsProj, ySoldProj) : "";
  const dResProj   = hasProjection ? smoothPath(xsProj, yResProj) : "";
  const dAvailProj = hasProjection ? smoothPath(xsProj, yAvailProj) : "";

  // % gridlines (0/25/50/75/100%)
  const gridFracs = [0, 0.25, 0.5, 0.75, 1];

  function handleMove(e) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = W / rect.width;
    const localX = (e.clientX - rect.left) * scaleX;
    if (localX < pad.l - 4 || localX > W - pad.r + 4) { setHover(null); return; }
    let bestI = 0, bestD = Infinity;
    xs.forEach((x, i) => { const d = Math.abs(x - localX); if (d < bestD) { bestD = d; bestI = i; } });
    setHover({ i: bestI, mx: e.clientX, my: e.clientY });
  }

  // Headline metrics (current state at most recent real snapshot)
  const cur = points[N - 1];
  const pctSold = cur.total > 0 ? (cur.sold / cur.total * 100) : 0;
  const pctAvail = cur.total > 0 ? (cur.avail / cur.total * 100) : 0;
  // Velocity: avg of positive sold deltas (filters out data revisions)
  const velocityPerMonth = velSold;
  const hasVelocity = velocityPerMonth > 0.1;
  const monthsToSellout = hasVelocity ? cur.avail / velocityPerMonth : null;
  const trendIcon = hasVelocity ? "▲" : "·";
  const trendColor = hasVelocity ? green : dim;

  const hp = hover && hover.i < realN ? points[hover.i] : null;
  const hpProj = hover && hover.i >= realN ? allFrames[hover.i] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
           style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
           onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="tg-avail" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={green} stopOpacity="0.95"/>
            <stop offset="100%" stopColor={green} stopOpacity="0.55"/>
          </linearGradient>
          <linearGradient id="tg-res" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f5d142" stopOpacity="0.95"/>
            <stop offset="100%" stopColor="#f5d142" stopOpacity="0.6"/>
          </linearGradient>
          <linearGradient id="tg-sold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f5a623" stopOpacity="0.95"/>
            <stop offset="100%" stopColor="#f5a623" stopOpacity="0.7"/>
          </linearGradient>
        </defs>

        {/* ── Headline strip ─────────────────────────── */}
        <g>
          {/* Big sold % */}
          <text x={pad.l} y={26} fill={text} fontFamily={mono} fontSize={26} fontWeight={700}>
            {pctSold.toFixed(1)}%
          </text>
          <text x={pad.l + 80} y={26} fill={dim} fontFamily={mono} fontSize={11}>
            {lang === "sk" ? "predaných" : "sold"}
          </text>
          {/* Composition counts */}
          <text x={pad.l} y={46} fill={dim} fontFamily={mono} fontSize={10}>
            <tspan fill={green}>● </tspan><tspan fill={text} fontWeight={700}>{cur.avail}</tspan>{" "}
            <tspan fill={dim}>{lang === "sk" ? "voľn." : "avail"}</tspan>
            <tspan>  </tspan>
            <tspan fill="#f5d142">● </tspan><tspan fill={text} fontWeight={700}>{cur.res}</tspan>{" "}
            <tspan fill={dim}>{lang === "sk" ? "rezerv." : "res"}</tspan>
            <tspan>  </tspan>
            <tspan fill="#f5a623">● </tspan><tspan fill={text} fontWeight={700}>{cur.sold}</tspan>{" "}
            <tspan fill={dim}>{lang === "sk" ? "predan." : "sold"}</tspan>
            <tspan>  </tspan>
            <tspan fill={dim}>{lang === "sk" ? "z" : "of"} {cur.total}</tspan>
          </text>
          {/* Velocity badge top-right */}
          {hasVelocity ? (
            <g transform={`translate(${W - pad.r - 140}, 6)`}>
              <rect x={0} y={0} width={140} height={50} rx={6}
                    fill={trendColor} opacity={0.12} stroke={trendColor} strokeOpacity={0.3} />
              <text x={10} y={15} fill={dim} fontFamily={mono} fontSize={9}>
                {lang === "sk" ? "TEMPO" : "VELOCITY"}
                {isEarlyData && (
                  <tspan fill={trendColor} opacity={0.7}> · {lang === "sk" ? "predbežné" : "early"}</tspan>
                )}
              </text>
              <text x={10} y={31} fill={trendColor} fontFamily={mono} fontSize={14} fontWeight={700}>
                {trendIcon} +{velocityPerMonth % 1 === 0 ? velocityPerMonth.toFixed(0) : velocityPerMonth.toFixed(1)} / mes
              </text>
              {monthsToSellout != null && monthsToSellout > 0 && monthsToSellout < 120 && (
                <text x={10} y={45} fill={dim} fontFamily={mono} fontSize={8.5}>
                  {monthsToSellout < 1
                    ? (lang === "sk" ? "< mesiac do vypredania" : "< 1 mo to sell-out")
                    : monthsToSellout < 12
                      ? (lang === "sk" ? `≈ ${monthsToSellout.toFixed(1)} mes do vypredania` : `≈ ${monthsToSellout.toFixed(1)} mo to sell-out`)
                      : (lang === "sk" ? `≈ ${(monthsToSellout / 12).toFixed(1)} rokov do vypredania` : `≈ ${(monthsToSellout / 12).toFixed(1)} yr to sell-out`)
                  }
                </text>
              )}
            </g>
          ) : N >= 2 && (
            <g transform={`translate(${W - pad.r - 140}, 6)`}>
              <rect x={0} y={0} width={140} height={42} rx={6}
                    fill={dim} opacity={0.08} stroke={dim} strokeOpacity={0.2} />
              <text x={10} y={15} fill={dim} fontFamily={mono} fontSize={9}>
                {lang === "sk" ? "TEMPO" : "VELOCITY"}
              </text>
              <text x={10} y={29} fill={dim} fontFamily={mono} fontSize={10} fontWeight={600}>
                {lang === "sk" ? "kalibruje sa" : "calibrating"}
              </text>
              <text x={10} y={39} fill={dim} fontFamily={mono} fontSize={7.5} opacity={0.85}>
                {lang === "sk" ? "potrebný ďalší beh" : "needs more data"}
              </text>
            </g>
          )}
        </g>

        {/* ── Chart body ─────────────────────────────── */}
        {/* % gridlines */}
        {gridFracs.map((f, i) => (
          <g key={i}>
            <line x1={pad.l} x2={W - pad.r} y1={yAtPct(f)} y2={yAtPct(f)}
                  stroke={border} strokeWidth={0.5} opacity={f === 0 || f === 1 ? 0.6 : 0.3} />
            <text x={pad.l - 6} y={yAtPct(f) + 3} textAnchor="end"
                  fill={dim} fontFamily={mono} fontSize={9}>
              {Math.round(f * 100)}%
            </text>
          </g>
        ))}

        {/* X-axis labels — first, middle, last (real data) */}
        {[0, Math.floor((realN - 1) / 2), realN - 1]
          .filter((v, i, a) => a.indexOf(v) === i).map(i => (
          <text key={i} x={xs[i]} y={H - 10} textAnchor={i === 0 ? "start" : i === realN - 1 ? "end" : "middle"}
                fill={dim} fontFamily={mono} fontSize={10}>{points[i].month}</text>
        ))}
        {hasProjection && (
          <text x={xs[xs.length - 1]} y={H - 10} textAnchor="end"
                fill={trendColor} opacity={0.85} fontFamily={mono} fontSize={9} fontWeight={600}>
            {isEarlyData
              ? (lang === "sk" ? "+3 mes (predbežný odhad)" : "+3 mo (early estimate)")
              : (lang === "sk" ? "+3 mes (predpoklad)" : "+3 mo (projected)")}
          </text>
        )}

        {/* Layer fills (smooth) */}
        <path d={dSold}  fill="url(#tg-sold)" />
        <path d={dRes}   fill="url(#tg-res)" />
        <path d={dAvail} fill="url(#tg-avail)" />

        {/* Top stroke lines for definition */}
        <path d={smoothPath(xsReal, ySoldReal)}    fill="none" stroke="#f5a623" strokeWidth={1.5} opacity={0.9} />
        <path d={smoothPath(xsReal, yResReal)}     fill="none" stroke="#f5d142" strokeWidth={1.5} opacity={0.9} />
        <path d={smoothPath(xsReal, yAvailReal)}   fill="none" stroke={green}   strokeWidth={2}   opacity={0.95} />

        {/* Projection (dashed lines, no fills, lighter) */}
        {hasProjection && (
          <>
            <line x1={xs[realN - 1]} x2={xs[realN - 1]} y1={pad.t} y2={pad.t + innerH}
                  stroke={text} strokeOpacity={0.25} strokeWidth={0.5} strokeDasharray="2,3" />
            <path d={dSoldProj}  fill="none" stroke="#f5a623" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.5} />
            <path d={dResProj}   fill="none" stroke="#f5d142" strokeWidth={1.5} strokeDasharray="4,3" opacity={0.5} />
            <path d={dAvailProj} fill="none" stroke={green}   strokeWidth={1.5} strokeDasharray="4,3" opacity={0.5} />
          </>
        )}

        {/* Dots on actual data points only */}
        {points.map((_, i) => (
          <g key={i}>
            <circle cx={xs[i]} cy={yAvailTop[i]} r={2.5} fill={green} stroke="#0a0a0b" strokeWidth={1} />
          </g>
        ))}

        {/* Hover crosshair */}
        {hover && (
          <line x1={xs[hover.i]} x2={xs[hover.i]} y1={pad.t} y2={pad.t + innerH}
                stroke={text} strokeOpacity={0.4} strokeWidth={1} strokeDasharray="3,3" pointerEvents="none" />
        )}
      </svg>

      {(hp || hpProj) && typeof document !== "undefined" && (() => {
        const p = hp || hpProj;
        const isProj = !!hpProj;
        return (
          <div style={{
            position: "fixed", left: hover.mx + 14, top: hover.my + 14,
            background: "rgba(14,14,18,0.97)", border: `1px solid ${border}`, borderRadius: 8,
            padding: "0.6rem 0.85rem", fontFamily: mono, fontSize: "0.74rem",
            color: text, pointerEvents: "none", zIndex: 10000, whiteSpace: "nowrap",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}>
            <div style={{ fontWeight: 700, marginBottom: "0.4rem", borderBottom: `1px solid ${border}`, paddingBottom: "0.3rem" }}>
              {isProj
                ? (lang === "sk" ? `Predpoklad +${hover.i - realN + 1} mes` : `Projection +${hover.i - realN + 1} mo`)
                : p.month}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: green, marginRight: 5, borderRadius: 2 }}/>{lang === "sk" ? "voľné" : "available"}</span>
              <span style={{ fontWeight: 700 }}>{Math.round(p.avail)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginTop: "0.2rem" }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#f5d142", marginRight: 5, borderRadius: 2 }}/>{lang === "sk" ? "rezerv." : "reserved"}</span>
              <span style={{ fontWeight: 700 }}>{Math.round(p.res)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginTop: "0.2rem" }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: "#f5a623", marginRight: 5, borderRadius: 2 }}/>{lang === "sk" ? "predané" : "sold"}</span>
              <span style={{ fontWeight: 700 }}>{Math.round(p.sold)}</span>
            </div>
            <div style={{ marginTop: "0.4rem", paddingTop: "0.3rem", borderTop: `1px solid ${border}`, color: dim, fontSize: "0.68rem", display: "flex", justifyContent: "space-between" }}>
              <span>{lang === "sk" ? "spolu" : "total"}</span>
              <span>{Math.round(p.total)}</span>
            </div>
            {isProj && (
              <div style={{ marginTop: "0.3rem", color: dim, fontSize: "0.65rem", fontStyle: "italic" }}>
                {lang === "sk" ? "extrapolácia z aktuálneho tempa" : "extrapolated from current pace"}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/* ── Takeup: bar chart of Δsold per month ──────────────────────
 *
 *  Pre-existing problem: pri 1-2 mesiacoch dát chart vyzerá prázdny
 *  (1 osamotený stĺpec). Plus žiadny hover.
 *
 *  Now: každý stĺpec má hover tooltip (mesiac + delta + cumulatívne
 *  sold). Zelené = predaj zrýchlil oproti priemeru, oranžové = pomalší
 *  predaj. Avg čiara je sticky (vždy viditeľná). Pri len 1 dátapointe
 *  zobrazí kontext + hint "ďalšie dáta po najbližšom scrape".
 */
function TakeupChart({ snaps, lang }) {
  const W = 460, H = 240;
  const headlineH = 56;
  const pad = { l: 38, r: 14, t: headlineH + 14, b: 30 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const svgRef = useRef(null);
  const [hover, setHover] = useState(null);

  const deltas = [];
  for (let i = 1; i < snaps.length; i++) {
    const d = (snaps[i].sold_units || 0) - (snaps[i - 1].sold_units || 0);
    deltas.push({
      month: snaps[i].snapshot_month,
      delta: d,
      cumSold: snaps[i].sold_units || 0,
    });
  }
  if (deltas.length === 0) {
    return <div style={{ color: dim, fontSize: "0.8rem", textAlign: "center", padding: "1rem" }}>—</div>;
  }

  const yMax = Math.max(1, ...deltas.map(d => Math.abs(d.delta)));
  const slotW = innerW / Math.max(deltas.length, 1);
  const barW  = Math.min(slotW * 0.6, 60);  // cap so single-bar doesn't fill whole chart
  const gapW  = slotW - barW;
  const zeroY = pad.t + innerH / 2;
  const yAt = (v) => zeroY - (innerH / 2) * (v / yMax);
  const avg = deltas.reduce((a, d) => a + d.delta, 0) / deltas.length;
  const maxDelta = Math.max(...deltas.map(d => d.delta));

  // Trend: compare last delta to running avg (excluding last)
  const lastDelta = deltas[deltas.length - 1].delta;
  const prevAvg = deltas.length > 1
    ? deltas.slice(0, -1).reduce((a, d) => a + d.delta, 0) / (deltas.length - 1)
    : lastDelta;
  const trendDir = lastDelta > prevAvg + 0.5 ? "accelerating"
                  : lastDelta < prevAvg - 0.5 ? "slowing"
                  : "stable";
  const trendIcon = trendDir === "accelerating" ? "▲" : trendDir === "slowing" ? "▼" : "▬";
  const trendColor = trendDir === "accelerating" ? green : trendDir === "slowing" ? "#ff9b6b" : dim;
  const trendLabel = trendDir === "accelerating"
    ? (lang === "sk" ? "zrýchľuje" : "accelerating")
    : trendDir === "slowing"
      ? (lang === "sk" ? "spomaľuje" : "slowing")
      : (lang === "sk" ? "stabilné" : "stable");

  function handleMove(e) {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = W / rect.width;
    const localX = (e.clientX - rect.left) * scaleX;
    if (localX < pad.l - 4 || localX > W - pad.r + 4) { setHover(null); return; }
    let bestI = 0, bestD = Infinity;
    deltas.forEach((_, i) => {
      const cx = pad.l + slotW * i + slotW / 2;
      const d = Math.abs(cx - localX);
      if (d < bestD) { bestD = d; bestI = i; }
    });
    setHover({ i: bestI, mx: e.clientX, my: e.clientY });
  }

  return (
    <div style={{ position: "relative" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
           style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
           onMouseMove={handleMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="bar-pos" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={green} stopOpacity="1"/>
            <stop offset="100%" stopColor={green} stopOpacity="0.65"/>
          </linearGradient>
          <linearGradient id="bar-neg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff9b6b" stopOpacity="0.65"/>
            <stop offset="100%" stopColor="#ff9b6b" stopOpacity="1"/>
          </linearGradient>
        </defs>

        {/* ── Headline strip ─────────────────────────── */}
        <g>
          {deltas.length === 1 ? (
            // Single-data-point view — no "avg of 1" weirdness, no trend badge
            <>
              <text x={pad.l} y={20} fill={dim} fontFamily={mono} fontSize={10} letterSpacing="0.05em">
                {lang === "sk" ? "POSLEDNÝ MESIAC" : "LATEST MONTH"}
              </text>
              <text x={pad.l} y={42} fill={text} fontFamily={mono} fontSize={22} fontWeight={700}>
                {deltas[0].delta >= 0 ? "+" : ""}{deltas[0].delta}
              </text>
              <text x={pad.l + 60} y={38} fill={dim} fontFamily={mono} fontSize={11}>
                {Math.abs(deltas[0].delta) === 1
                  ? (lang === "sk" ? "byt predaný" : "unit sold")
                  : (lang === "sk" ? "bytov predaných" : "units sold")}
              </text>
              <text x={pad.l + 60} y={50} fill={dim} fontFamily={mono} fontSize={9}>
                {deltas[0].month} ·{" "}
                <tspan fill={dim}>
                  {lang === "sk" ? `celkom ${deltas[0].cumSold}` : `${deltas[0].cumSold} total`}
                </tspan>
              </text>
            </>
          ) : (
            <>
              {/* Big velocity number */}
              <text x={pad.l} y={20} fill={dim} fontFamily={mono} fontSize={10} letterSpacing="0.05em">
                {lang === "sk" ? "PRIEMERNÉ TEMPO" : "AVG VELOCITY"}
              </text>
              <text x={pad.l} y={44} fill={text} fontFamily={mono} fontSize={22} fontWeight={700}>
                {avg >= 0 ? "+" : ""}{avg % 1 === 0 ? avg.toFixed(0) : avg.toFixed(1)}
              </text>
              <text x={pad.l + 70} y={40} fill={dim} fontFamily={mono} fontSize={11}>
                {lang === "sk" ? "bytov / mes" : "units / mo"}
              </text>
              <text x={pad.l + 70} y={51} fill={dim} fontFamily={mono} fontSize={9}>
                {lang === "sk" ? `za ${deltas.length} ${deltas.length < 5 ? "mesiace" : "mesiacov"}` : `over ${deltas.length} months`}
              </text>
              {/* Trend badge */}
              <g transform={`translate(${W - pad.r - 130}, 8)`}>
                <rect x={0} y={0} width={130} height={36} rx={6}
                      fill={trendColor} opacity={0.12} stroke={trendColor} strokeOpacity={0.3} />
                <text x={10} y={16} fill={dim} fontFamily={mono} fontSize={9}>
                  {lang === "sk" ? "TREND" : "TREND"}
                </text>
                <text x={10} y={30} fill={trendColor} fontFamily={mono} fontSize={13} fontWeight={700}>
                  {trendIcon} {trendLabel}
                </text>
              </g>
              {/* Best month annotation under headline */}
              {maxDelta > 0 && (() => {
                const best = deltas.find(d => d.delta === maxDelta);
                return (
                  <text x={pad.l} y={64} fill={dim} fontFamily={mono} fontSize={9}>
                    {lang === "sk" ? "najlepší mesiac" : "best month"}{" "}
                    <tspan fill={text} fontWeight={700}>{best.month}</tspan>{" "}
                    <tspan fill={green} fontWeight={700}>+{maxDelta}</tspan>
                  </text>
                );
              })()}
            </>
          )}
        </g>

        {/* ── Chart body ─────────────────────────────── */}
        {/* Soft grid */}
        {[0.25, 0.75].map((t, i) => (
          <line key={i} x1={pad.l} x2={W - pad.r}
                y1={pad.t + innerH * t} y2={pad.t + innerH * t}
                stroke={border} strokeWidth={0.5} opacity={0.3} strokeDasharray="2,4" />
        ))}
        {/* Zero line */}
        <line x1={pad.l} x2={W - pad.r} y1={zeroY} y2={zeroY} stroke={border} strokeWidth={1} />
        {/* Average line (dashed) — only if >1 bar */}
        {deltas.length > 1 && (
          <>
            <line x1={pad.l} x2={W - pad.r} y1={yAt(avg)} y2={yAt(avg)}
                  stroke={dim} strokeWidth={1} strokeDasharray="3,3" opacity={0.5} />
            <text x={W - pad.r - 3} y={yAt(avg) - 3} textAnchor="end"
                  fill={dim} fontFamily={mono} fontSize={9}>∅ {avg.toFixed(1)}</text>
          </>
        )}

        {/* Bars */}
        {deltas.map((d, i) => {
          const x = pad.l + slotW * i + (slotW - barW) / 2;
          const isBest = d.delta === maxDelta && d.delta > 0 && deltas.length > 1;
          const isHovered = hover && hover.i === i;
          const fillUrl = d.delta > 0 ? "url(#bar-pos)" : d.delta < 0 ? "url(#bar-neg)" : dim;
          const y = Math.min(zeroY, yAt(d.delta));
          const height = Math.abs(yAt(d.delta) - zeroY);
          return (
            <g key={i}>
              {/* Hover halo */}
              {isHovered && (
                <rect x={x - 4} y={pad.t} width={barW + 8} height={innerH}
                      fill={text} opacity={0.06} rx={4} />
              )}
              {/* Best month star */}
              {isBest && (
                <text x={x + barW / 2} y={y - 8} textAnchor="middle"
                      fill={green} fontFamily={mono} fontSize={11}>★</text>
              )}
              {/* The bar */}
              <rect x={x} y={y} width={barW} height={Math.max(2, height)}
                    fill={fillUrl} rx={3}
                    style={{ cursor: "pointer", transition: "opacity 0.12s" }}
                    opacity={isHovered ? 1 : 0.9} />
              {/* X label */}
              <text x={x + barW / 2} y={zeroY + 16} textAnchor="middle"
                    fill={dim} fontFamily={mono} fontSize={9.5}>
                {d.month.slice(5)}
              </text>
              {/* Numeric label above/below bar */}
              {Math.abs(d.delta) >= 1 && (
                <text x={x + barW / 2} y={d.delta > 0 ? y - 4 : y + height + 11}
                      textAnchor="middle" fill={d.delta > 0 ? green : "#ff9b6b"}
                      fontFamily={mono} fontSize={10} fontWeight={700}>
                  {d.delta > 0 ? `+${d.delta}` : d.delta}
                </text>
              )}
            </g>
          );
        })}

        {/* Single-bar hint */}
        {deltas.length === 1 && (
          <text x={pad.l + innerW / 2} y={pad.t + innerH + 22}
                textAnchor="middle" fill={dim} opacity={0.7}
                fontFamily={mono} fontSize={9}>
            {lang === "sk"
              ? "→ ďalšie mesiace pribudnú s každým novým behom"
              : "→ more months added with each new run"}
          </text>
        )}
      </svg>

      {/* Hover tooltip */}
      {hover && typeof document !== "undefined" && (() => {
        const d = deltas[hover.i];
        const sign = d.delta > 0 ? "+" : "";
        const tag = d.delta > 0
          ? (lang === "sk" ? "predaných za mesiac" : "sold this month")
          : d.delta < 0
            ? (lang === "sk" ? "vrátených na trh" : "returned to market")
            : (lang === "sk" ? "bez zmeny" : "no change");
        const color = d.delta > 0 ? green : d.delta < 0 ? "#ff9b6b" : dim;
        const vsAvg = d.delta - avg;
        const vsAvgLabel = vsAvg > 0.5 ? `+${vsAvg.toFixed(1)} ${lang === "sk" ? "nad priemerom" : "above avg"}`
                          : vsAvg < -0.5 ? `${vsAvg.toFixed(1)} ${lang === "sk" ? "pod priemerom" : "below avg"}`
                          : (lang === "sk" ? "v priemere" : "at avg");
        return (
          <div style={{
            position: "fixed", left: hover.mx + 14, top: hover.my + 14,
            background: "rgba(14,14,18,0.97)", border: `1px solid ${border}`, borderRadius: 8,
            padding: "0.6rem 0.85rem", fontFamily: mono, fontSize: "0.74rem",
            color: text, pointerEvents: "none", zIndex: 10000, whiteSpace: "nowrap",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}>
            <div style={{ fontWeight: 700, marginBottom: "0.4rem", borderBottom: `1px solid ${border}`, paddingBottom: "0.3rem" }}>
              {d.month}
            </div>
            <div style={{ fontSize: "1.1rem", color, fontWeight: 700, marginBottom: "0.15rem" }}>
              {sign}{d.delta} {lang === "sk" ? "bytov" : "units"}
            </div>
            <div style={{ color: dim, fontSize: "0.68rem", marginBottom: "0.3rem" }}>{tag}</div>
            {deltas.length > 1 && (
              <div style={{ color: dim, fontSize: "0.68rem" }}>{vsAvgLabel}</div>
            )}
            <div style={{ color: dim, fontSize: "0.68rem", marginTop: "0.3rem", paddingTop: "0.3rem", borderTop: `1px solid ${border}` }}>
              {lang === "sk" ? "celkom predaných" : "total sold"}: <span style={{ color: text, fontWeight: 700 }}>{d.cumSold}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* ── Room mix: horizontal stacked bars per room type ──────── */
/* ── Room-type mix — horizontal stacked bars per room type ──
 *
 * Two rendering modes:
 *
 *  A) Mixed data (project has at least two of V/R/P):
 *     Each row's bar fills 100 % and is split proportionally into
 *     AVAILABLE (green, left) → RESERVED (gray) → SOLD (orange, right).
 *     Reading left→right mirrors the customer journey.
 *
 *  B) V-only data (project publishes only available units):
 *     Every row would be 100 % green under mode A — misleading
 *     because a 1-room group with 11 units would look visually
 *     identical to a 2-room group with 72 units. In this mode we
 *     scale bar width by r.total / max(all totals) so the chart
 *     becomes a honest 'which segment dominates supply' view.
 *     Still all-green (the only colour we have) but the widths now
 *     carry signal.
 *
 * Stav codes in labels match the displayed names 1:1, per-language:
 *   · SK: V (voľné)      · R (rezervované)  · P (predané)
 *   · EN: A (available)  · R (reserved)     · S (sold)
 * (Not 'F' for free — the EN header says 'Available', codes must
 * match. User: 'nemoze byt F ako available, bud A alebo potom F free'.)
 */
function RoomMixChart({ rows, lang }) {
  // Detect V-only mode: no row has any sold or reserved
  const vOnly = rows.every(r => (r.sold || 0) === 0 && (r.reserved || 0) === 0);
  const maxTotal = rows.reduce((m, r) => Math.max(m, r.total || 0), 0) || 1;
  const W = 560;
  const barH = 30;      // taller bar so we have room for a two-line right-side summary
  const gap = 12;
  const labelW = 64;
  const valueW = 110;   // wider right column — two aligned lines (count / pct) instead of one cramped mixed line
  const barW = W - labelW - valueW - 20;
  const H = rows.length * (barH + gap) + 6;

  // Minimum segment width in pixels to fit an inline count label.
  // Smaller segments just stay as a colored wedge — the hover tooltip
  // + right-side summary cover the exact numbers.
  const MIN_LABEL_W = 28;

  // Stav letter codes per language — must match the subtitle header
  // words so '7 A' reads clearly as '7 available', not '7 F(ree)'.
  const codeAvail = lang === "sk" ? "V" : "A";
  const codeResv  = "R";  // same letter in both languages
  const codeSold  = lang === "sk" ? "P" : "S";

  // Right-side summary — two stacked lines instead of one cramped
  // "31 · 45% A" string. User feedback: "nepaci sa mi stale to namano
  // tie dve metriky, daj to nech to je pod sebou separatne nadpis
  // a cisla, nie takto nanic ze sa miesa". Structure per row:
  //
  //     31 total      ← top line, white, units count
  //     45% available ← bottom line, green, % of total that's buyable
  //
  // V-only rows skip the percentage (it would trivially be 100%).
  const L = (sk, en) => lang === "sk" ? sk : en;
  const sideTotal = (r) => r.total === 0 ? null : `${r.total}`;
  const sideTotalSub = L("spolu", "total");
  const sidePct   = (r) => {
    if (r.total === 0 || vOnly) return null;
    return `${Math.round((r.avail / r.total) * 100)}%`;
  };
  const sidePctSub = L("voľných", "available");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {rows.map((r, i) => {
        const y = i * (barH + gap);

        // vOnly mode: bar width scales by r.total / max so a tiny type
        // doesn't visually dominate a big type. Mixed mode: bar fills
        // the track and segments split the full width.
        const rowBarW = vOnly ? (r.total / maxTotal) * barW : barW;

        const pct = r.total > 0 ? {
          sold: r.sold / r.total,
          reserved: r.reserved / r.total,
          avail: r.avail / r.total,
        } : { sold: 0, reserved: 0, avail: 0 };
        const soldW = pct.sold * rowBarW;
        const resvW = pct.reserved * rowBarW;
        const availW = pct.avail * rowBarW;

        const xAvail = labelW;
        const xResv  = labelW + availW;
        const xSold  = labelW + availW + resvW;

        // Vertically centered inside the bar — single text line per
        // segment, bold, contrasting fill. Looks "built-in" rather
        // than hanging off a separate row under the bar.
        const textY = y + barH / 2 + 3.5;

        return (
          <g key={r.room}>
            <text x={0} y={y + barH / 2 + 4} fill="#e8e8ed" fontFamily={mono} fontSize={11} fontWeight={700}>
              {r.room}-{lang === "sk" ? "izb" : "room"}
            </text>

            <rect x={labelW} y={y} width={barW} height={barH} fill="#0a0a0b" stroke={border} rx={2}>
              <title>{`${r.avail} ${codeAvail} · ${r.reserved} ${codeResv} · ${r.sold} ${codeSold} · ${r.total} total`}</title>
            </rect>
            {availW > 0 && <rect x={xAvail} y={y} width={availW} height={barH} fill={green} rx={2} />}
            {resvW  > 0 && <rect x={xResv}  y={y} width={resvW}  height={barH} fill="#888"  rx={2} />}
            {soldW  > 0 && <rect x={xSold}  y={y} width={soldW}  height={barH} fill="#f5a623" rx={2} />}

            {/* Inline segment labels — black on green/orange (readable
                on bright fills), white on dim grey. Only rendered when
                the segment is wide enough to hold the text cleanly. */}
            {availW >= MIN_LABEL_W && (
              <text x={xAvail + availW / 2} y={textY} textAnchor="middle"
                    fill="#0a0a0b" fontFamily={mono} fontSize={10.5} fontWeight={700}>
                {r.avail} {codeAvail}
              </text>
            )}
            {resvW >= MIN_LABEL_W && (
              <text x={xResv + resvW / 2} y={textY} textAnchor="middle"
                    fill="#fff" fontFamily={mono} fontSize={10.5} fontWeight={700}>
                {r.reserved} {codeResv}
              </text>
            )}
            {soldW >= MIN_LABEL_W && (
              <text x={xSold + soldW / 2} y={textY} textAnchor="middle"
                    fill="#0a0a0b" fontFamily={mono} fontSize={10.5} fontWeight={700}>
                {r.sold} {codeSold}
              </text>
            )}

            {/* Right-side structured summary: two aligned lines.
                Row 1 (white, larger): count + "total" caption
                Row 2 (green, smaller): % + "available" caption
                Both right-aligned and sharing the same column so the
                eye reads a clean vertical pair per row. */}
            {sideTotal(r) && (
              <>
                <text x={W - 4} y={y + barH / 2 - 2} textAnchor="end"
                      fill="#e8e8ed" fontFamily={mono} fontSize={12} fontWeight={700}>
                  {sideTotal(r)}
                  <tspan fill={dim} fontSize={9.5} fontWeight={400} dx={4}>{sideTotalSub}</tspan>
                </text>
                {sidePct(r) && (
                  <text x={W - 4} y={y + barH / 2 + 11} textAnchor="end"
                        fill={green} fontFamily={mono} fontSize={10.5} fontWeight={700}>
                    {sidePct(r)}
                    <tspan fill={dim} fontSize={9.5} fontWeight={400} dx={4}>{sidePctSub}</tspan>
                  </text>
                )}
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Price histogram — 10 bins of available flat prices ──── */
/* ── Price histogram — 10 bins of available-flat prices ──
 *
 * Visual redesign after user feedback ("je to na dobrej ceste ale
 * rozhadzane skarede chaoticke zlepsi to"):
 *
 *   · Numbers above each bar REMOVED. They sat at different heights
 *     (following each bar's top) which read as scattered / noisy.
 *     Counts still visible in the hover tooltip.
 *   · X-axis tick labels land on 'nice' round numbers (multiples
 *     chosen by niceStep) instead of 25% fractions of the raw range,
 *     so labels read '150k / 250k / 350k / 450k / 550k' not
 *     '176k / 271k / 366k / 461k / 556k'.
 *   · Extra vertical padding between chart body and axis so nothing
 *     crowds together.
 *   · Median label sits ABOVE pad.t with its own whitespace — no
 *     collision with bar tops.
 *   · Bottom caption moved lower, clear separation from axis.
 */
function PriceHistogram({ prices, lang = "en" }) {
  const [hover, setHover] = useState(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  // Padding: bigger top for median label, bigger bottom for two
  // rows of text (axis + caption) so they don't stack into each other.
  // Bottom caption removed → tighter bottom padding. Top pad keeps
  // whitespace for the median label above the bars.
  const W = 520, H = 190, pad = { l: 16, r: 16, t: 28, b: 26 };
  const innerW = W - pad.l - pad.r, innerH = H - pad.t - pad.b;
  const locale = lang === "sk" ? "sk-SK" : "en-US";
  const L = (sk, en) => lang === "sk" ? sk : en;
  const fmtK = (n) => `${Math.round(n / 1000)}k €`;
  const fmtFull = (n) => `€${Math.round(n).toLocaleString(locale).replace(/,/g, " ")}`;

  if (!prices || prices.length === 0) {
    return <div style={{ color: dim, fontSize: "0.8rem", textAlign: "center", padding: "1rem" }}>—</div>;
  }

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
  const total = prices.length;

  // Nice round x-axis ticks. Pick a step so we get ~5 labels spanning
  // the [min, max] range with human-friendly numbers.
  const niceStep = (range) => {
    const target = range / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(target)));
    const norm = target / mag;
    const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
    return nice * mag;
  };
  const step = niceStep(max - min);
  const firstTick = Math.ceil(min / step) * step;
  const lastTick = Math.floor(max / step) * step;
  const ticks = [];
  for (let v = firstTick; v <= lastTick + 0.5; v += step) ticks.push(v);
  // Guarantee at least min and max are represented when the step is coarse
  if (ticks.length < 2) ticks.unshift(min), ticks.push(max);
  const xOf = (v) => pad.l + (innerW * (v - min)) / (max - min || 1);

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
        onMouseMove={(e) => {
          const svg = e.currentTarget.getBoundingClientRect();
          setHoverPos({
            x: ((e.clientX - svg.left) / svg.width) * W,
            y: ((e.clientY - svg.top) / svg.height) * H,
          });
        }}
        onMouseLeave={() => setHover(null)}
      >
        {counts.map((c, i) => {
          const x = pad.l + (innerW * i) / bins;
          const w = (innerW / bins) - 2;
          const h = yMax > 0 ? (c / yMax) * innerH : 0;
          const y = pad.t + innerH - h;
          const isHover = hover === i;
          return (
            <g key={i}>
              <rect
                x={x + 1}
                y={y}
                width={w}
                height={h}
                fill={green}
                opacity={isHover ? 0.95 : 0.55}
                rx={2}
                style={{ cursor: "pointer", transition: "opacity 0.12s" }}
                onMouseEnter={() => setHover(i)}
              />
              {/* Full-height invisible hover target so thin bars are
                  still easy to hit with the cursor. */}
              <rect
                x={x + 1}
                y={pad.t}
                width={w}
                height={innerH}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover(i)}
              />
            </g>
          );
        })}

        {/* Median — dashed orange vertical, value label sits above the
            bars with enough whitespace that it never crowds bar tops. */}
        <line x1={medX} x2={medX} y1={pad.t} y2={pad.t + innerH}
              stroke="#f5a623" strokeWidth={2} strokeDasharray="4,3" />
        <text x={medX} y={16} textAnchor="middle"
              fill="#f5a623" fontFamily={mono} fontSize={10} fontWeight={600}>
          {L("medián", "median")} {fmtK(med)}
        </text>

        {/* Baseline tick */}
        <line x1={pad.l} y1={pad.t + innerH} x2={W - pad.r} y2={pad.t + innerH}
              stroke={dim} strokeWidth={0.5} opacity={0.4} />

        {/* X-axis: round tick labels */}
        {ticks.map((v, idx) => {
          const x = xOf(v);
          return (
            <g key={idx}>
              <line x1={x} y1={pad.t + innerH} x2={x} y2={pad.t + innerH + 4}
                    stroke={dim} strokeWidth={0.8} />
              <text x={x} y={H - 8} textAnchor="middle"
                    fill={dim} fontFamily={mono} fontSize={9.5}>
                {fmtK(v)}
              </text>
            </g>
          );
        })}

        {/* Bottom caption intentionally removed. Count + range live
            in the card subtitle (above the chart), and the median is
            annotated directly on its dashed line — repeating all three
            again at the bottom read as "median median median" to users
            and cluttered the chart. */}
      </svg>

      {/* HTML tooltip — on hover shows exact bin stats */}
      {hover !== null && (() => {
        const i = hover;
        const binStart = min + i * binW;
        const binEnd = min + (i + 1) * binW;
        const c = counts[i];
        const pct = total > 0 ? (c / total) * 100 : 0;
        const flipX = hoverPos.x > W * 0.65;
        const flipY = hoverPos.y > H * 0.55;
        return (
          <div style={{
            position: "absolute",
            left: flipX ? undefined : `calc(${(hoverPos.x / W) * 100}% + 10px)`,
            right: flipX ? `calc(${(1 - hoverPos.x / W) * 100}% + 10px)` : undefined,
            top: flipY ? undefined : `calc(${(hoverPos.y / H) * 100}% + 10px)`,
            bottom: flipY ? `calc(${(1 - hoverPos.y / H) * 100}% + 10px)` : undefined,
            background: "#0b0b0e",
            border: `1px solid ${border}`,
            borderLeft: `3px solid ${green}`,
            borderRadius: 8,
            padding: "0.55rem 0.75rem",
            fontSize: "0.78rem",
            color: "#e8e8ed",
            pointerEvents: "none",
            zIndex: 20,
            whiteSpace: "nowrap",
            boxShadow: "0 10px 24px rgba(0,0,0,0.6)",
          }}>
            <div style={{ fontWeight: 600, marginBottom: "0.3rem" }}>
              {fmtFull(binStart)} – {fmtFull(binEnd)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.15rem 0.65rem", fontSize: "0.74rem" }}>
              <span style={{ color: dim }}>{L("Bytov", "Units")}</span>
              <span style={{ fontFamily: mono, color: green, fontWeight: 600 }}>{c}</span>
              <span style={{ color: dim }}>{L("Z celku", "Of total")}</span>
              <span style={{ fontFamily: mono }}>{pct.toFixed(0)}%</span>
            </div>
          </div>
        );
      })()}
    </div>
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

  // F-255 fix: hooks MUST be called before any conditional return.
  // Previously `useState`/`useRef` were defined below an `if (points.length === 0) return` —
  // when `flats` toggled between empty and non-empty, the hook-call order
  // changed between renders → React rules-of-hooks violation, potential
  // "Rendered more hooks than during the previous render" crash.
  const [hover, setHover] = useState(null);
  const wrapperRef = useRef(null);

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
          chart. pointer-events:none so it doesn't steal hover from dots.
          Edge guard: if the pointer is in the right half of the chart we
          flip the tooltip to the LEFT of the cursor (same for bottom) so
          it doesn't overflow the chart area on narrow viewports. */}
      {hover && (() => {
        const f = hover.flat;
        const m2 = (f.cena_s_dph != null && f.obytna_plocha != null && Number(f.obytna_plocha) > 0)
          ? Math.round(Number(f.cena_s_dph) / Number(f.obytna_plocha)) : null;
        // Chart wrapper width/height for flipping the tooltip near edges.
        // We don't have exact dims here (the SVG scales), but viewport-based
        // heuristic works: if hover.x is past ~65% of a 900px-ish chart we
        // anchor right; similarly for y.
        const flipX = hover.x > 600;
        const flipY = hover.y > 240;
        return (
          <div style={{
            position: "absolute",
            left: flipX ? undefined : hover.x + 14,
            right: flipX ? `calc(100% - ${hover.x - 14}px)` : undefined,
            top: flipY ? undefined : hover.y + 14,
            bottom: flipY ? `calc(100% - ${hover.y - 14}px)` : undefined,
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
              <span style={{ color: dim }}>{lang === "sk" ? "Interiér" : "Interior"}</span>
              <span style={{ fontFamily: mono }}>{f.obytna_plocha ? `${f.obytna_plocha} m²` : "—"}</span>
              <span style={{ color: dim }}>{lang === "sk" ? "Cena" : "Price"}</span>
              <span style={{ fontFamily: mono }}>{f.cena_s_dph != null ? `${Math.round(f.cena_s_dph).toLocaleString(locale)} €` : "—"}</span>
              <span style={{ color: dim }}>{lang === "sk" ? "Cena/m²" : "€/m²"}</span>
              <span style={{ fontFamily: mono, color: green }}>{m2 != null ? `${m2.toLocaleString(locale)} €` : "—"}</span>
            </div>
            {onSelectFlat && (
              <div style={{ marginTop: "0.4rem", fontSize: "0.68rem", color: dim, fontStyle: "italic" }}>
                {lang === "sk" ? "klikni pre zobrazenie v tabuľke →" : "click to reveal in the table →"}
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
  // width: colgroup percentage so the 12 columns fit the viewport
  //        without horizontal scrolling. Sum ≈ 100 %.
  const COLS = [
    { key: "unit",      label: t.tbl_flat,        align: "left",  kind: "text", def: "asc", width: "10%",  get: f => f.unit_detail || f.unit_id || "" },
    { key: "budova",    label: t.tbl_building,    align: "left",  kind: "text", def: "asc", width: "7%",   get: f => f.budova || "" },
    { key: "poschodie", label: t.tbl_floor,       align: "left",  kind: "num",  def: "asc", width: "6%",   get: f => f.poschodie },
    { key: "izby",      label: t.tbl_rooms,       align: "left",  kind: "num",  def: "asc", width: "5%",   get: f => f.izby },
    { key: "interior",  label: t.tbl_interior,    align: "right", kind: "num",  def: "asc", width: "8%",   get: f => f.obytna_plocha },
    { key: "exterior",  label: t.tbl_exterior,    align: "right", kind: "num",  def: "asc", width: "7%",   get: f => f.exterier_plocha },
    { key: "total",     label: t.tbl_total,       align: "right", kind: "num",  def: "asc", width: "7%",   get: f => f.celkova_plocha },
    { key: "price",     label: t.tbl_price,       align: "right", kind: "num",  def: "asc", width: "12%",  get: f => f.cena_s_dph },
    { key: "price_m2",  label: t.tbl_eur_m2,      align: "right", kind: "num",  def: "asc", width: "8%",
      get: f => (f.cena_s_dph != null && f.obytna_plocha != null && Number(f.obytna_plocha) > 0)
                ? Number(f.cena_s_dph) / Number(f.obytna_plocha) : null },
    { key: "orient",    label: t.tbl_orientation, align: "left",  kind: "text", def: "asc", width: "8%",   get: f => f.orientacia || "" },
    { key: "handover",  label: t.tbl_handover,    align: "left",  kind: "text", def: "asc", width: "14%",  get: f => f.kolaudacia || "" },
    { key: "stav",      label: t.tbl_status,      align: "left",  kind: "text", def: "asc", width: "8%",   get: f => f.stav || "" },
  ];

  // Compact th/td — local overrides so this table fits 12 columns on
  // one screen without horizontal scrolling. The global th/td (0.75rem
  // 1rem padding) is designed for wider tables with fewer columns.
  // Sticky header was reverted: it rendered misaligned in some layouts
  // (stuck mid-page instead of top). Deferred until we find a version
  // that plays well with the page-transition wrapper + nav+ticker chrome.
  const compactTh = { padding: "0.5rem 0.35rem", fontWeight: 600 };
  const compactTd = { padding: "0.45rem 0.35rem", color: "#e8e8ed", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

  const [sort, setSort] = useState({ key: "unit", dir: "asc" });

  // Top-toolbar filter state. The previous per-column '⛆' icon
  // popover was too hidden — user feedback: "tam nie je filter,
  // alebo ak je, nejde / nevidno ho". Replaced with an always-visible
  // pill toolbar above the table. Pills are include-mode by default:
  // clicking a pill TOGGLES it. An empty selection for a group means
  // "all" (no filter), so the user's first interaction is an exclude.
  //
  // Price range is two number inputs (min/max €) — a slider would need
  // a library; pair of inputs is simpler and matches the data-ops
  // mental model people already have from Excel filters.
  const ROOM_VALUES = Array.from(new Set(flats.map(f => f.izby).filter(v => v != null && v !== "")))
    .sort((a, b) => Number(a) - Number(b));
  const STAV_VALUES = ["V", "R", "PR", "P"].filter(s => flats.some(f => f.stav === s));
  const stavLabel = (s) => ({
    V:  lang === "sk" ? "Voľné"       : "Available",
    R:  lang === "sk" ? "Rezervované" : "Reserved",
    PR: lang === "sk" ? "Predrezervované" : "Pre-reserved",
    P:  lang === "sk" ? "Predané"     : "Sold",
  }[s] || s);

  const [stavSel, setStavSel] = useState(() => new Set(STAV_VALUES));
  const [roomSel, setRoomSel] = useState(() => new Set(ROOM_VALUES.map(String)));
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");

  const togglePill = (setFn) => (val) => {
    setFn(prev => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val); else next.add(val);
      return next;
    });
  };
  const toggleStav = togglePill(setStavSel);
  const toggleRoom = togglePill(setRoomSel);

  const clearAllFilters = () => {
    setStavSel(new Set(STAV_VALUES));
    setRoomSel(new Set(ROOM_VALUES.map(String)));
    setPriceMin("");
    setPriceMax("");
    track("flat_filter_cleared");
  };

  const onHeaderClick = (col) => {
    setSort(prev => {
      const next = prev.key === col.key
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.def };
      track("flat_sort_applied", { column: col.key, direction: next.dir });
      return next;
    });
  };

  // ── Apply filters ────────────────────────────────────────────
  const priceMinN = priceMin === "" ? null : Number(priceMin);
  const priceMaxN = priceMax === "" ? null : Number(priceMax);
  const priceActive = priceMinN != null || priceMaxN != null;
  const filteredFlats = flats.filter(f => {
    // Status pill
    if (stavSel.size > 0 && stavSel.size < STAV_VALUES.length) {
      if (!stavSel.has(f.stav)) return false;
    }
    // Rooms pill
    if (roomSel.size > 0 && roomSel.size < ROOM_VALUES.length) {
      const r = f.izby == null ? "" : String(f.izby);
      if (!roomSel.has(r)) return false;
    }
    // Price range
    if (priceActive) {
      const p = Number(f.cena_s_dph);
      if (!Number.isFinite(p)) return false;
      if (priceMinN != null && p < priceMinN) return false;
      if (priceMaxN != null && p > priceMaxN) return false;
    }
    return true;
  });
  const anyFilterActive =
    (stavSel.size > 0 && stavSel.size < STAV_VALUES.length) ||
    (roomSel.size > 0 && roomSel.size < ROOM_VALUES.length) ||
    priceActive;

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

  // ── Highlight row from scatter click ────────────────────────
  // Scroll matching row into view when highlightedFlatId changes. If
  // the row is filtered out by the user's active filters we auto-clear
  // them first so the click never silently does nothing.
  useEffect(() => {
    if (!highlightedFlatId) return;
    const targetInData = flats.some(f => f.id === highlightedFlatId);
    const targetInView = sortedFlats.some(f => f.id === highlightedFlatId);
    if (targetInData && !targetInView && anyFilterActive) {
      clearAllFilters();
      return;
    }
    const id = requestAnimationFrame(() => {
      const row = document.getElementById(`flat-row-${highlightedFlatId}`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(id);
  }, [highlightedFlatId, sortedFlats, anyFilterActive, flats]);

  const totalCount = flats.length;
  const visibleCount = sortedFlats.length;

  return (
    <ProtectedData lang={lang} style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "visible" }}>
      {/* ── Filter toolbar ─────────────────────────────────────
          Always visible above the table. Three groups:
            · Status pills (V / R / PR / P)
            · Room pills   (1 / 1.5 / 2 / 3 / 4 / …)
            · Price range  (€ min / € max)
          Pills are toggleable — click an active pill to exclude it;
          click again to bring it back. "All" states mean no filter
          for that group, so the typical interaction is one click to
          narrow. A showing-N-of-M counter + "Clear filters" button
          anchor the right side whenever anything is active. */}
      <div style={{
        padding: "0.75rem 0.9rem",
        background: "#0e0e10",
        borderBottom: `1px solid ${border}`,
        display: "flex", flexWrap: "wrap", alignItems: "center",
        gap: "0.75rem 1.1rem",
      }}>
        {/* Status group */}
        {STAV_VALUES.length > 1 && (
          <FilterGroup
            label={lang === "sk" ? "Stav" : "Status"}
            items={STAV_VALUES.map(s => ({
              key: s, label: stavLabel(s),
              active: stavSel.has(s),
              color: s === "V" ? "#00e5a0" : s === "P" ? "#f5a623" : "#888",
              onClick: () => toggleStav(s),
            }))}
          />
        )}
        {/* Rooms group */}
        {ROOM_VALUES.length > 1 && (
          <FilterGroup
            label={lang === "sk" ? "Izby" : "Rooms"}
            items={ROOM_VALUES.map(v => ({
              key: String(v), label: `${v}`,
              active: roomSel.has(String(v)),
              color: "#00e5a0",
              onClick: () => toggleRoom(String(v)),
            }))}
          />
        )}
        {/* Price range */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
          <span style={{ fontFamily: mono, fontSize: "0.65rem", color: dim, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {lang === "sk" ? "Cena €" : "Price €"}
          </span>
          <input
            type="number" inputMode="numeric" placeholder={lang === "sk" ? "od" : "min"}
            value={priceMin} onChange={e => setPriceMin(e.target.value)}
            style={{ width: 80, padding: "0.3rem 0.45rem", background: "#0a0a0b", border: `1px solid ${priceMinN != null ? green : border}`, color: "#e8e8ed", borderRadius: 4, fontFamily: mono, fontSize: "0.78rem", outline: "none" }}
          />
          <span style={{ color: dim, fontFamily: mono, fontSize: "0.75rem" }}>–</span>
          <input
            type="number" inputMode="numeric" placeholder={lang === "sk" ? "do" : "max"}
            value={priceMax} onChange={e => setPriceMax(e.target.value)}
            style={{ width: 80, padding: "0.3rem 0.45rem", background: "#0a0a0b", border: `1px solid ${priceMaxN != null ? green : border}`, color: "#e8e8ed", borderRadius: 4, fontFamily: mono, fontSize: "0.78rem", outline: "none" }}
          />
        </div>

        {/* Counter + clear */}
        <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "0.75rem" }}>
          <span style={{ fontFamily: mono, fontSize: "0.74rem", color: anyFilterActive ? green : dim }}>
            <strong style={{ color: "#e8e8ed" }}>{visibleCount}</strong> {lang === "sk" ? "z" : "of"} {totalCount}
          </span>
          {anyFilterActive && (
            <button onClick={clearAllFilters}
              style={{
                background: "transparent", border: `1px solid ${border}`,
                color: dim, borderRadius: 4, padding: "0.3rem 0.7rem",
                fontFamily: mono, fontSize: "0.7rem", cursor: "pointer",
              }}
              onMouseEnter={e => { e.currentTarget.style.color = "#e8e8ed"; e.currentTarget.style.borderColor = "#ff6b6b60"; }}
              onMouseLeave={e => { e.currentTarget.style.color = dim; e.currentTarget.style.borderColor = border; }}>
              ✕ {lang === "sk" ? "Vymazať filtre" : "Clear filters"}
            </button>
          )}
        </div>
      </div>

      {/* No overflowX wrapper — table is forced to fit via fixed layout
          + colgroup widths + compact padding, so the last column is
          always visible without horizontal scroll. */}
      <div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem", tableLayout: "fixed" }}>
          <colgroup>
            {COLS.map(col => (
              <col key={col.key} style={{ width: col.width }} />
            ))}
          </colgroup>
          <thead style={{ background: "#0e0e10" }}>
            <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {COLS.map(col => (
                <th key={col.key}
                    onClick={() => onHeaderClick(col)}
                    title={lang === "sk" ? "Klikni pre zoradenie" : "Click to sort"}
                    style={{
                      ...compactTh, textAlign: col.align, userSelect: "none",
                      color: sort.key === col.key ? "#e8e8ed" : dim,
                      cursor: "pointer",
                      overflow: "hidden",
                    }}>
                  {col.label}{sortArrow(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedFlats.length === 0 && (
              <tr><td colSpan={COLS.length} style={{ ...compactTd, textAlign: "center", color: dim, padding: "1.25rem", fontStyle: "italic", whiteSpace: "normal" }}>
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
                <td style={compactTd}><strong>{f.unit_detail || f.unit_id}</strong></td>
                <td style={{ ...compactTd, color: dim }}>{f.budova || "—"}</td>
                <td style={{ ...compactTd, fontFamily: mono }}>{f.poschodie ?? "—"}</td>
                <td style={{ ...compactTd, fontFamily: mono }}>{f.izby ?? "—"}</td>
                <td style={{ ...compactTd, textAlign: "right", fontFamily: mono }}>{f.obytna_plocha ? `${f.obytna_plocha}` : "—"}</td>
                <td style={{ ...compactTd, textAlign: "right", fontFamily: mono }}>{f.exterier_plocha ?? "—"}</td>
                <td style={{ ...compactTd, textAlign: "right", fontFamily: mono }}>{f.celkova_plocha ?? "—"}</td>
                <td style={{ ...compactTd, textAlign: "right", fontFamily: mono }}>
                  {f.cena_s_dph != null ? `${Math.round(f.cena_s_dph).toLocaleString(locale)} €` :
                    f.cena_s_dph_text ? <span style={{ color: dim }}>{f.cena_s_dph_text}</span> : "—"}
                </td>
                <td style={{ ...compactTd, textAlign: "right", fontFamily: mono, color: dim }}>
                  {(f.cena_s_dph != null && f.obytna_plocha != null && Number(f.obytna_plocha) > 0)
                    ? Math.round(Number(f.cena_s_dph) / Number(f.obytna_plocha)).toLocaleString(locale)
                    : "—"}
                </td>
                <td style={{ ...compactTd, fontFamily: mono, color: dim }}>{f.orientacia || "—"}</td>
                <td style={{ ...compactTd, fontFamily: mono, color: dim }}>{f.kolaudacia || "—"}</td>
                <td style={compactTd}>
                  {f.stav && stavStyle[f.stav] ? (
                    <span style={{
                      padding: "2px 6px", borderRadius: 4, fontFamily: mono, fontSize: "0.64rem", fontWeight: 600,
                      color: stavStyle[f.stav].color, background: stavStyle[f.stav].bg,
                    }}>{f.stav}</span>
                  ) : <span style={{ color: dim, fontSize: "0.7rem" }}>{f.stav || "—"}</span>}
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

/* ── FilterGroup — a labelled row of toggleable pills for the
 *    always-visible filter toolbar above FlatsTable. Each pill is
 *    a click-to-toggle chip: active pills show colored + filled,
 *    inactive pills show dimmed with strikethrough so the excluded
 *    state is obvious at a glance. */
function FilterGroup({ label, items }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
      <span style={{ fontFamily: mono, fontSize: "0.65rem", color: dim, textTransform: "uppercase", letterSpacing: "0.08em" }}>
        {label}
      </span>
      {items.map(it => {
        const active = it.active;
        const c = it.color || green;
        return (
          <button
            key={it.key}
            onClick={it.onClick}
            style={{
              background: active ? `${c}22` : "transparent",
              border: `1px solid ${active ? c : border}`,
              color: active ? c : dim,
              borderRadius: 999,
              padding: "0.22rem 0.7rem",
              fontFamily: mono, fontSize: "0.72rem", fontWeight: 700,
              cursor: "pointer",
              textDecoration: active ? "none" : "line-through",
              opacity: active ? 1 : 0.55,
              transition: "background 0.12s, border-color 0.12s, color 0.12s",
            }}
            onMouseEnter={e => { if (!active) { e.currentTarget.style.opacity = "0.8"; } }}
            onMouseLeave={e => { if (!active) { e.currentTarget.style.opacity = "0.55"; } }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}


function ChooseProjectGate({ projectId, projectName, profile, reloadProfile, setCurrent, t, lang }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const locked = profile?.chosen_project_id && profile.chosen_project_id !== projectId;
  const alreadyThis = profile?.chosen_project_id === projectId;
  // F-093: resolve chosen_project_id (UUID) → display name. Falls back to the
  // raw id if we haven't yet loaded projects so the locked-state never crashes.
  const { projects: allProjectsForGate } = useProjects();
  const chosenName = allProjectsForGate?.find(p => p.id === profile?.chosen_project_id)?.name || profile?.chosen_project_id;
  // F-094: live "all N projects" copy — was hardcoded "60". Use the
  // tracked dataset count (matches the dataset hero badge) so the upgrade
  // pitch always matches reality. Fallback to 60 while loading so we
  // never show "all  projects" with a gap.
  const gateMarketTotals = useMarketTotals();
  const trackedProjCount = gateMarketTotals?.projectsTracked ?? gateMarketTotals?.projectsActive ?? 60;

  const assign = async () => {
    setBusy(true); setErr(null);
    const t0 = performance.now();
    if (import.meta.env.DEV) console.log("[ChooseProject] assign start", { userId: profile?.id, projectId });

    // Hard-reload safety net — if for any reason the async chain stalls
    // (stale session, network blip), force a reload to /live so the user
    // never sees a permanent "Saving…" button.
    const fallback = setTimeout(() => {
      if (import.meta.env.DEV) console.warn("[ChooseProject] slow — forcing hard reload");
      window.location.reload();
    }, 10000);

    try {
      // Step 1: UPDATE chosen_project_id — source of truth is the DB row.
      const { error: updErr } = await supabase.from("user_profiles")
        .update({ chosen_project_id: projectId })
        .eq("id", profile.id);
      if (import.meta.env.DEV) console.log(`[ChooseProject] UPDATE returned after ${Math.round(performance.now() - t0)}ms`, { updErr });
      if (updErr) throw new Error(updErr.message);

      // Step 2: Hard navigation to /project/<id>.
      //
      // Why hard navigation, not React state update?
      //
      // This flow has a subtle timing issue: after the UPDATE commits,
      // reloadProfile() + setProfile() into the React context + waiting
      // for useProjectFlats to see the new RLS identity + re-fetch flats
      // with the new permission all happen across multiple render ticks.
      // Multiple attempted root-cause fixes (auth-readiness gate; adding
      // tier/chosen_project_id to useProjectFlats deps; returning a
      // transitional spinner from the 'alreadyThis' branch) addressed
      // parts of the race but not all of it — users still occasionally
      // saw a blank page and had to F5 to recover.
      //
      // After-confirm is a once-per-free-user action. A ~400 ms hard
      // reload here is invisible friction on an already-celebratory
      // moment ("I just picked my project"), and it yields 100 %
      // reliability: the browser re-runs the whole boot sequence with
      // chosen_project_id already committed, so RLS reads succeed on
      // the very first request. No client-side race possible.
      //
      // Not a patch in the sense of 'hiding the bug': it's a
      // deliberate architecture choice for this one flow. The React
      // state-flow is still used everywhere else in the app; this one
      // commit boundary is the right place to reset and reload.
      clearTimeout(fallback);
      if (import.meta.env.DEV) console.log(`[ChooseProject] hard-navigating to /project/${projectId}`);
      window.location.href = `/project/${projectId}`;
      return;  // prevent finally setBusy(false) — component is unmounting via navigation
    } catch (e) {
      if (import.meta.env.DEV) console.error("[ChooseProject] exception", e);
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
            ? <>Tvoj free účet je napojený na projekt <strong style={{ color: green }}>{chosenName}</strong>. Tento výber je uzamknutý — jeden projekt, jeden snapshot.</>
            : <>Your free account is linked to project <strong style={{ color: green }}>{chosenName}</strong>. This choice is locked — one project, one snapshot.</>}
        </p>
        <p style={{ color: dim, fontSize: "0.85rem", marginBottom: "1.5rem" }}>
          {lang === "sk"
            ? <>Pre prístup ku všetkým {trackedProjCount} projektom potrebuješ <button onClick={() => setCurrent("Pricing")} style={linkBtn}>paid tier</button>.</>
            : <>For access to all {trackedProjCount} projects, <button onClick={() => setCurrent("Pricing")} style={linkBtn}>upgrade to paid</button>.</>}
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
          <button className="btn-p" onClick={() => setCurrent(`Project:${profile.chosen_project_id}`)}>
            {lang === "sk" ? "Ísť na môj projekt" : "Go to my project"}
          </button>
          <button className="btn-s" onClick={() => goBack(setCurrent, typeof window !== "undefined" && window.location.pathname.startsWith("/app") ? "App:Projects" : "Live")}>{t.back_to_dashboard}</button>
        </div>
      </main>
    );
  }

  if (alreadyThis) {
    // Edge case: user just confirmed this project, profile updated, but
    // parent's canView hasn't re-evaluated to true yet (single render
    // frame between context update and parent re-render). Instead of
    // returning null (blank screen), show a tiny transitional spinner.
    // Parent will re-render with canView=true immediately after and
    // replace us with LiveProjectDetail's actual content.
    return (
      <main style={{ padding: "6rem 2rem 4rem", textAlign: "center", color: dim }}>
        <div style={{ fontSize: "0.85rem", fontFamily: mono }}>
          {lang === "sk" ? "Načítavam projekt…" : "Loading project…"}
        </div>
      </main>
    );
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
        <button className="btn-s" onClick={() => goBack(setCurrent, typeof window !== "undefined" && window.location.pathname.startsWith("/app") ? "App:Projects" : "Live")}>{t.choose_back}</button>
      </div>
      {err && <div style={{ color: "#ff6b6b", marginTop: "0.75rem" }}>{err}</div>}
      <p style={{ fontSize: "0.8rem", color: dim, marginTop: "2rem" }}>
        {t.choose_upgrade_hint} <button onClick={() => setCurrent("Pricing")} style={linkBtn}>{t.upgrade_to_paid}</button>.
      </p>
    </main>
  );
}

function GateMessage({ title, body, cta, backLabel, onCta, setCurrent }) {
  const inPlatform = typeof window !== "undefined" && window.location.pathname.startsWith("/app");
  return (
    <main style={{ padding: "6rem 2rem 4rem", maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔒</div>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: "0.75rem" }}>{title}</h1>
      <p style={{ color: dim, fontSize: "1rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>{body}</p>
      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
        <button className="btn-p" onClick={onCta}>{cta}</button>
        <button className="btn-s" onClick={() => goBack(setCurrent, inPlatform ? "App:Projects" : "Live")}>{backLabel}</button>
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
  const { projects, loading } = useProjects();        // projects_live → real per-project aggregates
  const { snapshots } = useProjectSnapshots();
  const marketTotals = useMarketTotals();             // market_totals view (always live)
  const { rows: districtRows } = useTotalsList("district");  // totals_by_district — city-aware (unified-SK safe)
  const { can } = useCapabilities();

  if (loading && projects.length === 0) {
    return (
      <main style={{ padding: "5rem 2rem 4rem", maxWidth: 1200, margin: "0 auto", color: dim, fontFamily: mono, fontSize: "0.85rem" }}>
        {lang === "sk" ? "Načítavam analytiku…" : "Loading analytics…"}
      </main>
    );
  }

  // ─── KPI strip ──────────────────────────────────────────────
  // All four numbers come from the live `market_totals` view (project-
  // weighted aggregates over reference.project_current_state). The
  // homepage Ticker uses a separate `public.metrics` view that
  // aggregates unit-weighted from final.units — so the two ARE NOT
  // currently identical for €/m² (see audit_findings.md F-019 for the
  // formula divergence + plan to canonicalise). Project counts / units
  // counts DO reconcile, since both views count from the same matview.
  const totalUnits  = marketTotals.unitsTracked   ?? 0;
  const totalAvail  = marketTotals.unitsAvailable ?? 0;
  const avgEurM2    = marketTotals.avgPriceM2     ?? null;
  // Sold-30d sum comes from the same view (active-only filter applied
  // there) — same number as Platform Dashboard and homepage.
  const totalSold30 = marketTotals.soldLastMonth  ?? 0;
  const absorptionPct = totalAvail > 0
    ? Math.round((totalSold30 / (totalAvail + totalSold30)) * 1000) / 10
    : 0;

  // ─── Per-district aggregates ───────────────────────────────
  // Read directly from the `district_totals` view — always-live
  // counts derived from flats_archive grouped by project district.
  // No more frontend-side bucketing of project rows. Sort by avg
  // €/m² desc; districts without a price signal (avg=null) sink
  // to the bottom but stay visible.
  const districts = (districtRows || [])
    .map(d => ({
      district: d.district,
      city: d.city_name,
      count: d.project_count,
      units: d.total_units,
      avail: d.available_units,
      sold: d.sold_units,
      avgPrice: d.avg_eur_m2,
      // sold30 still comes from projects (project-level monthly delta). Join on
      // BOTH city + district — district name alone collides across cities under
      // unified SK (e.g. "Staré Mesto" in Bratislava AND Košice).
      sold30: projects
        .filter(p => p.district === d.district && (p.city || null) === (d.city_name || null))
        .reduce((a, p) => a + (p.sold_last_month || 0), 0),
    }))
    .map(d => ({
      ...d,
      absorption: d.avail + d.sold30 > 0 ? (d.sold30 / (d.avail + d.sold30)) * 100 : 0,
    }))
    .sort((a, b) => (b.avgPrice || 0) - (a.avgPrice || 0));

  // ─── Per-developer aggregates ──────────────────────────────
  // Computed from projects (which are now `projects_live` — real
  // per-project counts, no manual_total inflation). Each project's
  // total_units / sold_units / available_units already reflect
  // flats_archive truth, so straight summation is correct.
  // Restrict to active projects across all rankings — paused/sold_out
  // projects shouldn't pollute developer / velocity / sold-out-watch
  // listings with stale data. Manual projects (status='active') stay in.
  const activeProjects = projects.filter(p => (p.status || "active") === "active");

  const byDeveloper = {};
  for (const p of activeProjects) {
    if (!p.developer) continue;
    const d = byDeveloper[p.developer] ||= { developer: p.developer, count: 0, units: 0, sold: 0, sold30: 0, avail: 0, projects: [] };
    d.count  += 1;
    d.units  += p.total_units || 0;
    d.sold   += p.sold_units || 0;
    d.avail  += p.available_units || 0;
    d.sold30 += p.sold_last_month || 0;
    d.projects.push(p);
  }
  for (const d of Object.values(byDeveloper)) {
    d.projects.sort((a, b) => (b.total_units || 0) - (a.total_units || 0));
  }
  const topDevelopers = Object.values(byDeveloper).sort((a, b) => b.units - a.units).slice(0, 10);

  const topVelocity = activeProjects
    .filter(p => (p.sold_last_month || 0) > 0)
    .sort((a, b) => (b.sold_last_month || 0) - (a.sold_last_month || 0))
    .slice(0, 10);

  const soldOutWatch = activeProjects
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
        <AKpi label={lang === "sk" ? "Priem. €/m²" : "Avg €/m²"}            value={avgEurM2 ? Math.round(avgEurM2).toLocaleString(lang === "sk" ? "sk-SK" : "en-US") : "—"} />
      </div>

      {/* ═══ PIVOT — drag & drop builder ═══ */}
      <div style={{ marginBottom: "2.5rem" }}>
        <PivotV2 lang={lang} setCurrent={setCurrent} />
      </div>

      {/* ═══ DISTRICT BREAKDOWN — richer than home DistrictPulse ═══ */}
      <ASection
        label={lang === "sk" ? "Okresy" : "Districts"}
        title={lang === "sk" ? "Ceny, aktivita a absorpcia podľa okresu" : "Prices, activity and absorption by district"}>
        <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead style={{ background: "#0e0e10" }}>
              <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                <th style={th}>{lang === "sk" ? "Mesto" : "City"}</th>
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
                <tr key={`${d.city || ""}·${d.district}`} style={{ borderTop: `1px solid ${border}` }}>
                  <td style={{ ...td, color: dim }}>{d.city || "—"}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{d.district}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: mono, color: d.avgPrice && d.avgPrice >= 5500 ? "#f5a623" : d.avgPrice && d.avgPrice >= 4200 ? green : "#4a90e2", fontWeight: 600 }}>
                    {d.avgPrice ? d.avgPrice.toLocaleString("en-US").replace(/,/g, " ") : "—"}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: mono, color: dim }}>{d.count}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: mono, color: dim }}>{d.units.toLocaleString("en-US").replace(/,/g, " ")}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: mono, color: green }}>{d.avail.toLocaleString("en-US").replace(/,/g, " ")}</td>
                  {/* Sold (30d) — legitimately empty for new projects
                      until 2 monthly snapshots have run. "—" reads as
                      "not yet available" rather than a hard zero. */}
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
            rows={activeProjects
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
              rows={topDevelopers.map(d => ({
                key: d.developer,
                label: d.developer,
                sub: `${d.count} ${lang === "sk" ? "projektov" : "projects"}`,
                value: d.units,
                _projects: d.projects,
              }))}
              setCurrent={setCurrent}
              getChildren={(r) => r._projects || []}
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
        {/* Source line — primary number is "in dataset" (depth of coverage).
            When sold-outs accumulate past the active count, both numbers
            surface so it's clear how much is currently in market. */}
        {(() => {
          const active = marketTotals.projectsActive ?? 0;
          const tracked = marketTotals.projectsTracked ?? active;
          const sync = projects[0]?.last_updated?.slice(0, 10) || "—";
          if (tracked > active) {
            return lang === "sk"
              ? `Zdroj: ${tracked} projektov v databáze (${active} aktívnych) · posledný sync ${sync}`
              : `Source: ${tracked} projects in dataset (${active} active) · last sync ${sync}`;
          }
          return lang === "sk"
            ? `Zdroj: ${active} projektov · posledný sync ${sync}`
            : `Source: ${active} projects · last sync ${sync}`;
        })()}
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

function RankBarList({ rows, setCurrent, suffix = "", color = green, getChildren }) {
  // F-256 fix: hook before any conditional return (rules-of-hooks). Previously
  // useState lived below `if (!rows || rows.length === 0) return null;` — when
  // `rows` toggled between empty and non-empty across renders the hook order
  // diverged and React would throw on the second render.
  // Track which row is expanded. Only relevant when getChildren is provided
  // (developer rows that drill down to their projects).
  const [openKey, setOpenKey] = useState(null);
  if (!rows || rows.length === 0) return null;
  const max = Math.max(...rows.map(r => r.value));
  const cls = "rbl-" + Math.random().toString(36).slice(2, 8);
  return (
    <div>
      <style>{`
        .${cls}-row { cursor: pointer; transition: background 0.15s; border-radius: 4px; }
        .${cls}-row:hover { background: rgba(0,229,160,0.07); }
        .${cls}-row:hover .${cls}-name { text-decoration: underline; text-decoration-color: rgba(0,229,160,0.5); text-underline-offset: 3px; }
        .${cls}-row * { cursor: inherit; }
        .${cls}-child { cursor: pointer; transition: background 0.12s; border-radius: 4px; }
        .${cls}-child:hover { background: rgba(0,229,160,0.06); }
        .${cls}-child:hover .${cls}-childname { color: ${green}; text-decoration: underline; text-underline-offset: 3px; }
      `}</style>
      {rows.map((r, i) => {
        const pct = max > 0 ? (r.value / max) * 100 : 0;
        const expandable = typeof getChildren === "function";
        // If row has a usable project-id key (e.g. velocity / sold-%
        // lists), keep direct-navigation behaviour. Otherwise — and
        // when expandable is true — clicking opens the children panel.
        const directNav = setCurrent && r.key && typeof r.key === "string" && r.key !== r.label;
        const clickable = expandable || directNav;
        const isOpen = expandable && openKey === r.key;
        const onClick = expandable
          ? () => setOpenKey(prev => prev === r.key ? null : r.key)
          : (directNav ? () => setCurrent(`App:ProjectDetail:${r.key}`) : undefined);
        return (
          <div key={r.key}>
            <div
              className={clickable ? `${cls}-row` : undefined}
              onClick={onClick}
              style={{
                display: "grid", gridTemplateColumns: "24px 1fr 72px 16px", gap: "0.75rem", alignItems: "center",
                padding: "0.5rem 0.5rem",
                borderBottom: (!isOpen && i < rows.length - 1) ? `1px solid ${border}` : "none",
                cursor: clickable ? "pointer" : "default",
              }}
            >
              <span style={{ fontFamily: mono, fontSize: "0.7rem", color: dim, textAlign: "right" }}>{i + 1}.</span>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.2rem" }}>
                  <span className={clickable ? `${cls}-name` : undefined}
                        style={{ fontSize: "0.83rem", color: "#e8e8ed", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.label}
                  </span>
                  {r.sub && <span style={{ fontSize: "0.68rem", color: dim, fontFamily: mono, flexShrink: 0, marginLeft: "0.5rem" }}>{r.sub}</span>}
                </div>
                <div style={{ height: 4, background: "#0a0a0b", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.8s ease" }} />
                </div>
              </div>
              <div style={{ fontFamily: mono, fontSize: "0.85rem", color: color, fontWeight: 700, textAlign: "right" }}>
                {typeof r.value === "number" ? (r.value % 1 !== 0 ? r.value.toFixed(1) : r.value) : r.value}{suffix}
              </div>
              {expandable
                ? <span style={{ fontSize: "0.7rem", color: dim, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", textAlign: "center" }}>›</span>
                : <span />}
            </div>

            {/* Expanded child list — projects belonging to this row.
                Each child is a click-through to its own ProjectDetail. */}
            {isOpen && (() => {
              const children = getChildren(r) || [];
              return (
                <div style={{
                  background: "rgba(0,0,0,0.25)",
                  borderTop: `1px solid ${border}`,
                  borderBottom: i < rows.length - 1 ? `1px solid ${border}` : "none",
                  padding: "0.35rem 0.55rem 0.55rem 2.4rem",
                }}>
                  {children.length === 0 ? (
                    <div style={{ color: dim, fontSize: "0.78rem", padding: "0.4rem 0", fontStyle: "italic" }}>—</div>
                  ) : children.map(p => (
                    <div key={p.id}
                      className={`${cls}-child`}
                      onClick={(e) => { e.stopPropagation(); setCurrent && setCurrent(`App:ProjectDetail:${p.id}`); }}
                      style={{
                        display: "grid", gridTemplateColumns: "1fr auto auto", gap: "0.75rem", alignItems: "baseline",
                        padding: "0.35rem 0.5rem",
                      }}
                    >
                      <span className={`${cls}-childname`} style={{ fontSize: "0.82rem", color: "#c4c4cc", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transition: "color 0.12s" }}>
                        {p.name}
                      </span>
                      <span style={{ fontSize: "0.68rem", color: dim, fontFamily: mono }}>
                        {p.district || "—"}
                      </span>
                      <span style={{ fontFamily: mono, fontSize: "0.78rem", color: color, fontWeight: 600 }}>
                        {p.total_units != null ? p.total_units.toLocaleString("en-US").replace(/,/g, " ") : "—"}{suffix}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
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
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");

  const reloadUsers = () => supabase.from("user_profiles").select("*").order("created_at", { ascending: false })
    .then(({ data, error }) => { setUsers(data || []); if (error) setErr(error.message); });

  // Race condition fix (2026-05-27): wait for session to load before firing
  // RLS-gated queries. Without this, LiveAdmin mounted before auth session was
  // ready → supabase requests went out WITHOUT JWT → RLS denied → "No users yet"
  // even for admin. Now gated on `self?.id` and re-runs when session arrives.
  useEffect(() => {
    if (!self?.id) return;
    reloadUsers();
    supabase.from("events").select("*").like("event_type", "new_signup%").order("detected_at", { ascending: false }).limit(20)
      .then(({ data }) => setEvents(data || []));
    // Pull more activity than the old 100-event Recent panel needs, because
    // the Overview tab aggregates across a longer window. 1000 is enough to
    // cover months of use for the current small user base; if the table
    // grows past that we'd move aggregation to a DB view.
    supabase.from("user_activity").select("*").order("created_at", { ascending: false }).limit(1000)
      .then(({ data }) => setActivity(data || []));
    supabase.from("premium_domains").select("*").order("domain")
      .then(({ data }) => setPremiumDomains(data || []));
  }, [self?.id]);

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

  // Grant or revoke a 7-day trial for a user. Routes through the
  // admin-gated /api/trial/grant endpoint (service-role write,
  // audit-logged, overrides the one-shot self-service guard).
  const trialAction = async (u, action) => {
    if (u.id === self?.id) {
      alert(lang === "sk" ? "Nemôžeš riešiť trial na sebe." : "Can't manage trial on yourself.");
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { alert("No session — sign in first."); return; }
    try {
      const r = await fetch("/api/trial/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ user_id: u.id, action, days: 7 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Trial ${action} failed: ${j.error || r.status}`); return; }
      setUsers(us => us.map(x => x.id === u.id
        ? { ...x, trial_until: j.trial_until || null, trial_started_at: j.trial_started_at || null }
        : x));
    } catch (e) {
      alert(`Trial ${action} failed: ${String(e.message || e)}`);
    }
  };

  // Generic subscription patch via /api/admin/set-subscription. Used
  // for paid_until extends, pause / unpause, manual date sets and
  // notes. Server validates admin tier + audit-logs every patch.
  const subAction = async (u, payload) => {
    if (u.id === self?.id) {
      alert(lang === "sk" ? "Nemôžeš riešiť predplatné na sebe." : "Can't manage your own subscription here.");
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { alert("No session — sign in first."); return; }
    try {
      const r = await fetch("/api/admin/set-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ user_id: u.id, ...payload }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(`Subscription update failed: ${j.error || r.status}`); return; }
      setUsers(us => us.map(x => x.id === u.id ? { ...x, ...(j.patch || {}) } : x));
    } catch (e) {
      alert(`Subscription update failed: ${String(e.message || e)}`);
    }
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
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.5rem", borderBottom: `1px solid ${border}`, marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")}>
          {lang === "sk" ? "Prehľad" : "Overview"}
        </TabBtn>
        <TabBtn active={tab === "users"} onClick={() => setTab("users")}>
          {lang === "sk" ? "Užívatelia" : "Users"}
        </TabBtn>
        <TabBtn active={tab === "activity"} onClick={() => setTab("activity")}>{lang === "sk" ? "Aktivita" : "Activity"}</TabBtn>
        <TabBtn active={tab === "domains"} onClick={() => setTab("domains")}>{lang === "sk" ? "Prémiové domény" : "Premium domains"}</TabBtn>
        <TabBtn active={tab === "ai_chat"} onClick={() => setTab("ai_chat")}>{lang === "sk" ? "AI chat logy" : "AI chat logs"}</TabBtn>
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
            <UserTable users={visibleUsers} setTier={setTier} deleteUser={deleteUser} trialAction={trialAction} subAction={subAction} selfId={self?.id} t={t} lang={lang} premiumSet={premiumSet} />
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
                        <td style={{ ...td, color: dim, fontFamily: mono, fontSize: "0.75rem" }}>{e.detected_at ? new Date(e.detected_at).toLocaleString(lang === "sk" ? "sk-SK" : "en-US", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Bratislava" }) : "—"}</td>
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

      {tab === "overview" && <OverviewPanel activity={activity} users={users} lang={lang} />}
      {tab === "activity" && <ActivityPanel activity={activity} users={users} />}
      {tab === "domains" && (
        <PremiumDomainsPanel
          domains={premiumDomains}
          reload={() => supabase.from("premium_domains").select("*").order("domain").then(({ data }) => setPremiumDomains(data || []))}
        />
      )}
      {tab === "ai_chat" && <AiChatLogsPanel users={users} lang={lang} />}
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

/* ── Overview tab — basic product analytics ────────────────────────
 * Aggregates the last 1000 user_activity rows against user_profiles.
 * Gives the admin an at-a-glance read of:
 *   · Are people using it at all? (events total, this week, this month)
 *   · Who's active vs. signed-up-and-gone? (per-user summary table)
 *   · What's the retention pattern? (active days, first/last seen)
 *   · Trend over the last 30 days — daily charts
 *
 * All aggregation is client-side JS — fine for the small N we have
 * now. If the activity table grows past ~10k rows, migrate to a
 * Supabase view and query the pre-aggregated summary.
 */
function OverviewPanel({ activity, users, lang }) {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * DAY;
  const monthAgo = now - 30 * DAY;

  // Bucket events by time window
  const weekEvents  = activity.filter(e => new Date(e.created_at).getTime() > weekAgo);
  const monthEvents = activity.filter(e => new Date(e.created_at).getTime() > monthAgo);

  // Active users = had at least one event in the window
  const activeWeek  = new Set(weekEvents.map(e => e.user_id).filter(Boolean)).size;
  const activeMonth = new Set(monthEvents.map(e => e.user_id).filter(Boolean)).size;

  // ── Build 30-day daily buckets (for the 3 trend charts) ──
  // One row per day, so gaps show up as zero bars — honest view of
  // quiet periods without interpolation.
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, users: new Set(), events: 0, signups: 0 });
  }
  const byDate = Object.fromEntries(days.map(d => [d.date, d]));
  for (const e of activity) {
    const key = e.created_at?.slice(0, 10);
    if (byDate[key]) {
      byDate[key].events += 1;
      if (e.user_id) byDate[key].users.add(e.user_id);
    }
  }
  for (const u of users) {
    const key = u.created_at?.slice(0, 10);
    if (byDate[key]) byDate[key].signups += 1;
  }
  const daily = days.map(d => ({
    date: d.date,
    users: d.users.size,
    events: d.events,
    signups: d.signups,
  }));

  // Per-user rollup
  const byUser = {};
  for (const e of activity) {
    const uid = e.user_id;
    if (!uid) continue;
    if (!byUser[uid]) {
      byUser[uid] = {
        user_id: uid,
        totalEvents: 0,
        weekEvents: 0,
        monthEvents: 0,
        firstSeen: e.created_at,
        lastSeen: e.created_at,
        activeDays: new Set(),
        eventTypes: {},
      };
    }
    const b = byUser[uid];
    b.totalEvents += 1;
    const t = new Date(e.created_at).getTime();
    if (t > weekAgo)  b.weekEvents += 1;
    if (t > monthAgo) b.monthEvents += 1;
    if (new Date(e.created_at) < new Date(b.firstSeen)) b.firstSeen = e.created_at;
    if (new Date(e.created_at) > new Date(b.lastSeen))  b.lastSeen  = e.created_at;
    b.activeDays.add(e.created_at.slice(0, 10));
    b.eventTypes[e.event_type] = (b.eventTypes[e.event_type] || 0) + 1;
  }

  // Merge profile info into each row
  const userById = Object.fromEntries(users.map(u => [u.id, u]));
  const rows = Object.values(byUser).map(b => ({
    ...b,
    activeDays: b.activeDays.size,
    email: userById[b.user_id]?.email || "(unknown)",
    tier: userById[b.user_id]?.tier || "—",
    company: userById[b.user_id]?.company || "",
  })).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

  // Event-type breakdown across the full window (top 6)
  const eventTypeCount = {};
  for (const e of activity) {
    eventTypeCount[e.event_type] = (eventTypeCount[e.event_type] || 0) + 1;
  }
  const topEventTypes = Object.entries(eventTypeCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  // Helper: short relative time ("2 h ago", "3 d ago")
  const rel = (iso) => {
    const diff = (now - new Date(iso).getTime()) / 1000;
    if (diff < 60) return `${Math.round(diff)} s ago`;
    if (diff < 3600) return `${Math.round(diff / 60)} m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
    return `${Math.round(diff / 86400)} d ago`;
  };

  const L = (sk, en) => lang === "sk" ? sk : en;
  const card = (label, value, sub, colour = "#e8e8ed") => (
    <div style={{
      background: bg, border: `1px solid ${border}`, borderRadius: 10,
      padding: "1.1rem 1.2rem", minHeight: 92,
    }}>
      <div style={{ fontFamily: mono, fontSize: "0.64rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.45rem" }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: "1.7rem", fontWeight: 700, color: colour, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: "0.72rem", color: dim, marginTop: "0.35rem" }}>{sub}</div>}
    </div>
  );

  return (
    <>
      {/* ── Top-level metrics ── */}
      <SectionHeader>{L("Celkový prehľad", "Top-level metrics")}</SectionHeader>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "0.75rem", marginBottom: "2rem",
      }}>
        {card(L("Užívateľov celkom", "Total users"), users.length, L("vo všetkých tier-och", "across all tiers"))}
        {card(L("Aktívni / 7 dní", "Active · 7 d"), activeWeek, L("mali aspoň jeden event", "had any activity"), green)}
        {card(L("Aktívni / 30 dní", "Active · 30 d"), activeMonth, L("mali aspoň jeden event", "had any activity"), green)}
        {card(L("Eventy / 7 dní", "Events · 7 d"), weekEvents.length, L("page views + klicky", "page views + clicks"))}
        {card(L("Eventy / 30 dní", "Events · 30 d"), monthEvents.length, L("page views + klicky", "page views + clicks"))}
        {card(L("Eventy celkom", "Events total"), activity.length, L("v poslednom 1000 okne", "in last 1000 window"), dim)}
      </div>

      {/* ── Trend charts (last 30 days) ── */}
      <SectionHeader>{L("Trendy za posledných 30 dní", "Trends — last 30 days")}</SectionHeader>
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        gap: "0.85rem", marginBottom: "2rem",
      }}>
        <MiniBarChart
          title={L("Denná aktivita", "Daily active users")}
          subtitle={L("distinct user_id / deň", "distinct user_id / day")}
          data={daily}
          field="users"
          colour={green}
          highlightLast
        />
        <MiniBarChart
          title={L("Eventy za deň", "Events per day")}
          subtitle={L("všetky track() volania", "all track() events")}
          data={daily}
          field="events"
          colour="#4a90e2"
          highlightLast
        />
        <MiniBarChart
          title={L("Nové registrácie", "New signups")}
          subtitle={L("podľa dátumu vzniku účtu", "by account creation date")}
          data={daily}
          field="signups"
          colour="#f5a623"
          highlightLast
        />
      </div>

      {/* ── Event-type breakdown (horizontal bar chart) ── */}
      {topEventTypes.length > 0 && (() => {
        const maxN = topEventTypes[0][1];
        return (
          <>
            <SectionHeader>{L("Najčastejšie eventy", "Most frequent event types")}</SectionHeader>
            <div style={{
              background: bg, border: `1px solid ${border}`, borderRadius: 10,
              padding: "1rem 1.2rem", marginBottom: "2rem",
            }}>
              {topEventTypes.map(([type, n]) => (
                <div key={type} style={{
                  display: "grid", gridTemplateColumns: "150px 1fr 50px",
                  gap: "0.75rem", alignItems: "center",
                  padding: "0.4rem 0",
                  borderBottom: `1px solid ${border}`,
                }}>
                  <span style={{ fontFamily: mono, fontSize: "0.74rem", color: "#e8e8ed", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{type}</span>
                  <div style={{ height: 8, background: "rgba(255,255,255,0.04)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${(n / maxN) * 100}%`,
                      background: green,
                      opacity: 0.85,
                    }} />
                  </div>
                  <span style={{ fontFamily: mono, fontSize: "0.78rem", fontWeight: 700, color: green, textAlign: "right" }}>{n}</span>
                </div>
              ))}
            </div>
          </>
        );
      })()}

      {/* ── Per-user summary ── */}
      <SectionHeader>{L("Per-user aktivita", "Per-user activity")}</SectionHeader>
      {rows.length === 0 ? (
        <div style={{ color: dim, padding: "1.5rem", textAlign: "center", border: `1px solid ${border}`, borderRadius: 12 }}>
          {L("Zatiaľ žiadna užívateľská aktivita.", "No user activity yet.")}
        </div>
      ) : (
        <div style={{ border: `1px solid ${border}`, borderRadius: 12, overflow: "hidden", marginBottom: "2rem" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", minWidth: 900 }}>
              <thead style={{ background: "#0e0e10" }}>
                <tr style={{ textAlign: "left", color: dim, fontFamily: mono, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  <th style={th}>{L("Email", "Email")}</th>
                  <th style={th}>{L("Firma", "Company")}</th>
                  <th style={th}>{L("Tier", "Tier")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{L("Celkom", "Total")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{L("7 d", "7 d")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{L("30 d", "30 d")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{L("Aktívnych dní", "Active days")}</th>
                  <th style={th}>{L("Prvýkrát", "First seen")}</th>
                  <th style={th}>{L("Naposledy", "Last seen")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const lastMs = new Date(r.lastSeen).getTime();
                  const recent = (now - lastMs) < 7 * DAY;
                  return (
                    <tr key={r.user_id} style={{ borderTop: `1px solid ${border}` }}>
                      <td style={{ ...td, color: "#e8e8ed" }}>{r.email}</td>
                      <td style={{ ...td, color: dim }}>{r.company || "—"}</td>
                      <td style={td}>
                        <span style={{
                          fontFamily: mono, fontSize: "0.7rem",
                          padding: "0.15rem 0.5rem", borderRadius: 4,
                          color: r.tier === "paid" ? green : r.tier === "admin" ? "#f5a623" : r.tier === "pending" ? "#888" : "#c0c0c8",
                          background: r.tier === "paid" ? "rgba(0,229,160,0.08)" : r.tier === "admin" ? "rgba(245,166,35,0.08)" : "rgba(255,255,255,0.04)",
                        }}>{r.tier}</span>
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: "#e8e8ed" }}>{r.totalEvents}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: r.weekEvents > 0 ? green : dim }}>{r.weekEvents}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: r.monthEvents > 0 ? "#c0c0c8" : dim }}>{r.monthEvents}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: mono, color: dim }}>{r.activeDays}</td>
                      <td style={{ ...td, color: dim, fontFamily: mono, fontSize: "0.72rem" }}>{r.firstSeen?.slice(0, 10)}</td>
                      <td style={{ ...td, color: recent ? green : dim, fontFamily: mono, fontSize: "0.72rem" }}>{rel(r.lastSeen)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p style={{ color: dim, fontSize: "0.78rem", lineHeight: 1.5, fontStyle: "italic" }}>
        {L(
          "Data pochádza z tabuľky user_activity (posledných 1000 eventov). Events zahrňujú page views, otvorenia projektov, AI volania, login, a všetky track() volania z frontendu. Ak chýba daco čo chceš sledovať, pridáme track(\"nieco\") call v relevantnom miestach v UI.",
          "Data is from user_activity (last 1000 events). Events include page views, project opens, AI calls, logins, and every track() call in the frontend. If something you'd want to see isn't here, we can add track(\"something\") calls in the right UI spots."
        )}
      </p>
    </>
  );
}

/* ── MiniBarChart — pure SVG 30-day bar chart for OverviewPanel ──
 *
 * Design choices:
 *  · Pure SVG, no chart library. Same pattern as PriceHistogram,
 *    TakeupChart etc. — keeps dep surface tight.
 *  · Latest day on right, highlighted (primary colour); earlier days
 *    dim to signal "past".
 *  · Tooltip via <title> — browser-native, no JS hover handling.
 *  · Max value auto-scales; empty window still renders a flat row.
 *  · X-axis shows 3 marker dates (first, middle, last) for orientation
 *    without cluttering the 30 bars with labels.
 */
function MiniBarChart({ title, subtitle, data, field, colour, highlightLast }) {
  const W = 280, H = 100, pad = 4;
  const bottomPadding = 16;
  const barArea = H - bottomPadding;
  const n = data.length;
  const values = data.map(d => d[field] || 0);
  const max = Math.max(1, ...values);
  const barSlot = (W - 2 * pad) / n;
  const barW = Math.max(1, barSlot - 1);
  const total = values.reduce((a, b) => a + b, 0);
  const last = values[n - 1] || 0;

  // X-axis anchors: first / middle / last date, formatted as DD.MM
  const formatDate = (iso) => {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}.${m}`;
  };

  return (
    <div style={{
      background: bg, border: `1px solid ${border}`, borderRadius: 10,
      padding: "1rem 1.1rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.35rem" }}>
        <div>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#e8e8ed" }}>{title}</div>
          {subtitle && <div style={{ fontSize: "0.68rem", color: dim, fontFamily: mono, marginTop: "0.15rem" }}>{subtitle}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: mono, fontSize: "0.98rem", fontWeight: 700, color: colour }}>{last}</div>
          <div style={{ fontSize: "0.62rem", color: dim, fontFamily: mono }}>
            today · Σ {total}
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {/* Baseline — subtle horizontal line at bottom of bar area */}
        <line x1={pad} y1={barArea} x2={W - pad} y2={barArea} stroke={border} strokeWidth="0.5" />

        {data.map((d, i) => {
          const v = d[field] || 0;
          const h = v > 0 ? Math.max(1, (v / max) * (barArea - 2)) : 0;
          const isLast = highlightLast && i === n - 1;
          return (
            <rect
              key={i}
              x={pad + i * barSlot}
              y={barArea - h}
              width={barW}
              height={h}
              fill={colour}
              opacity={isLast ? 1 : 0.55}
              rx="0.5"
            >
              <title>{`${d.date}: ${v}`}</title>
            </rect>
          );
        })}

        {/* X-axis labels at first / middle / last positions */}
        {[0, Math.floor(n / 2), n - 1].map((i) => (
          <text
            key={i}
            x={pad + i * barSlot + barW / 2}
            y={H - 3}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            fill={dim}
            fontFamily={mono}
            fontSize="7"
          >
            {formatDate(data[i]?.date)}
          </text>
        ))}
      </svg>
    </div>
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

/* AiChatLogsPanel — admin transcript reader for ai_chat_log.
   Three views in one panel:
     1. Summary stats — last-7-days totals: sessions, turns, response
        time p50/p95, error rate, thumbs-up vs thumbs-down counts.
     2. Sessions list — most-recent-first, click to expand into the
        full transcript (user/assistant pairs, timing, model,
        feedback). Filterable by role (errors only) + by feedback.
     3. Bad-feedback queue — sorted by feedback_at desc so admin can
        triage thumbs-down responses first (worst signal = highest
        value for prompt tuning).

   Reads via the regular supabase client + RLS; admin policy on
   ai_chat_log allows SELECT for admins. No new endpoint needed. */
function AiChatLogsPanel({ users, lang }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("all");  // all | bad | errors | recent
  const [expanded, setExpanded] = useState(null);

  // Pull last 30 days' worth of log rows. Cap at 2000 to keep the
  // initial render snappy; filter chips narrow further client-side.
  // Order by sent_at desc so most-recent activity is at the top.
  useEffect(() => {
    let cancelled = false;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    supabase.from("ai_chat_log")
      .select("id, session_id, user_id, tier, turn_index, role, content, content_length, sent_at, response_time_ms, user_typing_ms, model, input_tokens, output_tokens, lang, page_url, error_kind, error_message, http_status, feedback, feedback_note, feedback_at")
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(2000)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { setErr(error.message); setLoading(false); return; }
        setRows(data || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const usersById = useMemo(() => {
    const m = {};
    for (const u of users) m[u.id] = u;
    return m;
  }, [users]);

  // Aggregate stats for the last 7 days (subset of the 30-day pull).
  const stats = useMemo(() => {
    const sevenDayAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = rows.filter(r => new Date(r.sent_at).getTime() >= sevenDayAgo);
    const sessions = new Set(recent.map(r => r.session_id)).size;
    const userTurns = recent.filter(r => r.role === "user").length;
    const assistantTurns = recent.filter(r => r.role === "assistant").length;
    const errors = recent.filter(r => r.role === "error").length;
    const goods = recent.filter(r => r.feedback === "good").length;
    const bads  = recent.filter(r => r.feedback === "bad").length;
    const responseTimes = recent
      .filter(r => r.role === "assistant" && Number.isFinite(r.response_time_ms))
      .map(r => r.response_time_ms)
      .sort((a, b) => a - b);
    const p50 = responseTimes.length > 0 ? responseTimes[Math.floor(responseTimes.length * 0.5)] : null;
    const p95 = responseTimes.length > 0 ? responseTimes[Math.floor(responseTimes.length * 0.95)] : null;
    return { sessions, userTurns, assistantTurns, errors, goods, bads, p50, p95 };
  }, [rows]);

  // Group rows into sessions (for the sessions view).
  const sessions = useMemo(() => {
    const bySession = new Map();
    for (const r of rows) {
      let s = bySession.get(r.session_id);
      if (!s) {
        s = {
          session_id: r.session_id,
          user_id: r.user_id,
          tier: r.tier,
          turns: [],
          first_at: r.sent_at,
          last_at: r.sent_at,
          has_error: false,
          has_bad_feedback: false,
          good_count: 0, bad_count: 0,
        };
        bySession.set(r.session_id, s);
      }
      s.turns.push(r);
      if (r.sent_at < s.first_at) s.first_at = r.sent_at;
      if (r.sent_at > s.last_at)  s.last_at  = r.sent_at;
      if (r.role === "error") s.has_error = true;
      if (r.feedback === "good") s.good_count++;
      if (r.feedback === "bad")  { s.bad_count++; s.has_bad_feedback = true; }
    }
    // Sort each session's turns ascending by turn_index for replay
    for (const s of bySession.values()) {
      s.turns.sort((a, b) => (a.turn_index ?? 0) - (b.turn_index ?? 0));
    }
    return Array.from(bySession.values()).sort((a, b) => b.last_at.localeCompare(a.last_at));
  }, [rows]);

  const filteredSessions = useMemo(() => {
    if (filter === "bad")     return sessions.filter(s => s.has_bad_feedback);
    if (filter === "errors")  return sessions.filter(s => s.has_error);
    if (filter === "recent")  return sessions.slice(0, 25);
    return sessions;
  }, [sessions, filter]);

  if (loading) {
    return <div style={{ color: dim, padding: "1rem", fontFamily: mono, fontSize: "0.82rem" }}>{lang === "sk" ? "Načítavam logy…" : "Loading logs…"}</div>;
  }
  if (err) {
    return <div style={{ color: red, padding: "1rem", fontFamily: mono, fontSize: "0.82rem" }}>⚠ {err}</div>;
  }
  if (rows.length === 0) {
    return <div style={{ color: dim, padding: "1rem", fontFamily: mono, fontSize: "0.82rem", fontStyle: "italic" }}>
      {lang === "sk"
        ? "Žiadne AI chat logy za posledných 30 dní (alebo nemáš admin RLS prístup k tabuľke ai_chat_log)."
        : "No AI chat logs in the last 30 days (or your admin RLS isn't granting access to ai_chat_log)."}
    </div>;
  }

  return (
    <div>
      {/* 7-day stats strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.5rem", marginBottom: "1.25rem" }}>
        {[
          { label: lang === "sk" ? "Sessions (7d)" : "Sessions (7d)", value: stats.sessions },
          { label: lang === "sk" ? "User otázok"   : "User turns",    value: stats.userTurns },
          { label: lang === "sk" ? "AI odpovedí"   : "Assistant",     value: stats.assistantTurns },
          { label: lang === "sk" ? "Chýb"          : "Errors",        value: stats.errors, color: stats.errors > 0 ? red : text },
          { label: lang === "sk" ? "👍"             : "👍",            value: stats.goods, color: green },
          { label: lang === "sk" ? "👎"             : "👎",            value: stats.bads,  color: stats.bads > 0 ? red : text },
          { label: "p50 ms", value: stats.p50 != null ? Math.round(stats.p50) : "—" },
          { label: "p95 ms", value: stats.p95 != null ? Math.round(stats.p95) : "—" },
        ].map((k, i) => (
          <div key={i} style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 6, padding: "0.55rem 0.75rem" }}>
            <div style={{ fontSize: "0.65rem", color: dim, marginBottom: "0.18rem", letterSpacing: "0.04em" }}>{k.label}</div>
            <div style={{ fontFamily: mono, fontSize: "1.05rem", fontWeight: 700, color: k.color || text }}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* Filter row */}
      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {[
          { key: "all",    label: lang === "sk" ? "Všetky"     : "All" },
          { key: "recent", label: lang === "sk" ? "Posledných 25" : "Last 25" },
          { key: "bad",    label: "👎 only" },
          { key: "errors", label: lang === "sk" ? "⚠ chyby" : "⚠ errors" },
        ].map(f => (
          <button key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              background: filter === f.key ? "rgba(0,229,160,0.14)" : "transparent",
              color: filter === f.key ? green : dim,
              border: `1px solid ${filter === f.key ? green : border}`,
              borderRadius: 4, padding: "0.3rem 0.65rem",
              fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit",
            }}>{f.label}</button>
        ))}
        <span style={{ marginLeft: "auto", color: dim, fontSize: "0.7rem", alignSelf: "center", fontFamily: mono }}>
          {filteredSessions.length} {lang === "sk" ? "sessions" : "sessions"} · {rows.length} {lang === "sk" ? "riadkov" : "rows"} (30d)
        </span>
      </div>

      {/* Sessions list */}
      <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 8, overflow: "hidden" }}>
        {filteredSessions.length === 0 ? (
          <div style={{ padding: "1.25rem", color: dim, fontStyle: "italic", textAlign: "center" }}>
            {lang === "sk" ? "Žiadne sessions zodpovedajúce filtru." : "No sessions match the filter."}
          </div>
        ) : filteredSessions.slice(0, 100).map((s, i) => {
          const u = usersById[s.user_id];
          const isOpen = expanded === s.session_id;
          return (
            <div key={s.session_id} style={{ borderTop: i > 0 ? `1px solid ${border}` : "none" }}>
              <button
                onClick={() => setExpanded(isOpen ? null : s.session_id)}
                style={{
                  width: "100%", textAlign: "left", background: "transparent",
                  border: "none", color: text, cursor: "pointer", fontFamily: "inherit",
                  padding: "0.65rem 0.9rem",
                  display: "grid", gridTemplateColumns: "auto 1fr auto auto auto auto", gap: "0.6rem", alignItems: "center",
                }}>
                <span style={{ color: green, fontSize: "0.7rem", width: 12 }}>{isOpen ? "▾" : "▸"}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.78rem" }}>
                  <strong style={{ color: text }}>{u?.email || (s.user_id ? s.user_id.slice(0, 8) + "…" : "anon")}</strong>
                  <span style={{ color: dim, marginLeft: "0.5rem", fontFamily: mono, fontSize: "0.68rem" }}>{s.tier}</span>
                </span>
                <span style={{ color: dim, fontSize: "0.7rem", fontFamily: mono }}>{s.turns.length} {lang === "sk" ? "turn" : "turns"}</span>
                <span style={{ color: s.has_error ? red : (s.has_bad_feedback ? orange : dim), fontSize: "0.7rem", fontFamily: mono, minWidth: 50, textAlign: "right" }}>
                  {s.has_error ? "⚠" : ""}
                  {s.bad_count > 0 ? ` 👎${s.bad_count}` : ""}
                  {s.good_count > 0 ? ` 👍${s.good_count}` : ""}
                </span>
                <span style={{ color: dim, fontSize: "0.66rem", fontFamily: mono }}>
                  {new Date(s.last_at).toLocaleString()}
                </span>
                <span style={{ width: 12 }} />
              </button>
              {isOpen && (
                <div style={{ padding: "0 0.9rem 0.9rem 1.5rem", background: bg }}>
                  {s.turns.map((t, j) => (
                    <AiTurnRow key={t.id || j} turn={t} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {filteredSessions.length > 100 && (
          <div style={{ padding: "0.6rem", color: dim, fontSize: "0.72rem", textAlign: "center", fontFamily: mono }}>
            {lang === "sk" ? `Zobrazených prvých 100 z ${filteredSessions.length}.` : `Showing top 100 of ${filteredSessions.length}.`}
          </div>
        )}
      </div>
    </div>
  );
}

function AiTurnRow({ turn }) {
  const isUser      = turn.role === "user";
  const isAssistant = turn.role === "assistant";
  const isError     = turn.role === "error";
  const accent = isUser ? green : isAssistant ? text : isError ? red : dim;
  const labelText = isUser ? "USER" : isAssistant ? "AI" : isError ? "ERROR" : turn.role.toUpperCase();
  const timing = [];
  if (isAssistant && Number.isFinite(turn.response_time_ms)) timing.push(`${turn.response_time_ms}ms response`);
  if (isUser && Number.isFinite(turn.user_typing_ms))        timing.push(`${(turn.user_typing_ms / 1000).toFixed(1)}s typed`);
  if (isAssistant && turn.input_tokens)                       timing.push(`${turn.input_tokens}→${turn.output_tokens || 0} tok`);
  if (isAssistant && turn.model)                              timing.push(turn.model);
  if (turn.feedback === "good")                               timing.push("👍");
  if (turn.feedback === "bad")                                timing.push("👎");

  return (
    <div style={{
      borderLeft: `2px solid ${accent}`, paddingLeft: "0.65rem",
      marginTop: "0.55rem", paddingBottom: "0.15rem",
    }}>
      <div style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, letterSpacing: "0.1em", display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.18rem" }}>
        <span style={{ color: accent, fontWeight: 700 }}>{labelText}</span>
        <span>turn {turn.turn_index}</span>
        {timing.length > 0 && <span style={{ color: dim }}>{timing.join(" · ")}</span>}
        {isError && turn.http_status && <span style={{ color: red }}>HTTP {turn.http_status}</span>}
      </div>
      <div style={{ whiteSpace: "pre-wrap", color: text, fontSize: "0.82rem", lineHeight: 1.45 }}>
        {turn.content || (isError ? <span style={{ color: red, fontStyle: "italic" }}>{turn.error_message || "(no content)"}</span> : <span style={{ color: dim, fontStyle: "italic" }}>(empty)</span>)}
      </div>
    </div>
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

function UserTable({ users, setTier, deleteUser, trialAction, subAction, selfId, t, lang, premiumSet = new Set() }) {
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
                    {(() => {
                      const trialActive = u.trial_until && new Date(u.trial_until).getTime() > Date.now();
                      const trialLabel = trialActive
                        ? (lang === "sk" ? "Trial ON" : "Trial ON")
                        : (lang === "sk" ? "Trial +7d" : "Trial +7d");
                      const nextAction = trialActive ? "revoke" : "grant";
                      const trialDays = trialActive
                        ? Math.max(0, Math.ceil((new Date(u.trial_until).getTime() - Date.now()) / 86400000))
                        : null;
                      const paidActive = u.paid_until && new Date(u.paid_until).getTime() > Date.now() && !u.paid_pause_started;
                      const paidPaused = Boolean(u.paid_pause_started);
                      const paidDays = paidActive
                        ? Math.max(0, Math.ceil((new Date(u.paid_until).getTime() - Date.now()) / 86400000))
                        : null;
                      const subBtnStyle = (active, accent = green) => ({
                        background: active ? `${accent}1f` : "transparent",
                        color: isSelf ? "#55555f" : (active ? accent : "#c0c0c8"),
                        border: `1px solid ${active ? accent : border}`,
                        padding: "0.3rem 0.6rem", borderRadius: 4,
                        fontSize: "0.7rem", fontFamily: "inherit",
                        cursor: isSelf ? "not-allowed" : "pointer",
                        opacity: isSelf ? 0.4 : 1,
                        marginRight: "0.35rem",
                      });
                      return (
                        <>
                          <button
                            onClick={() => trialAction && trialAction(u, nextAction)}
                            disabled={isSelf}
                            title={isSelf ? "Can't manage trial on yourself" : (trialActive ? `Ends in ${trialDays} day(s). Click to revoke.` : "Grant 7-day paid trial")}
                            style={subBtnStyle(trialActive, green)}>
                            {trialActive ? `🎁 ${trialDays}d` : trialLabel}
                          </button>
                          <button
                            onClick={() => subAction && subAction(u, { extend_paid_days: 30 })}
                            disabled={isSelf}
                            title={isSelf ? "Can't manage your own subscription" : (paidActive ? `Bumps paid_until by 30 days (currently ${paidDays}d remaining)` : "Set paid_until = now + 30 days")}
                            style={subBtnStyle(paidActive, "#4a90e2")}>
                            {paidActive ? `💳 ${paidDays}d` : "💳 +30d"}
                          </button>
                          {paidActive && (
                            <button
                              onClick={() => subAction && subAction(u, paidPaused ? { unpause: true } : { pause: true })}
                              disabled={isSelf}
                              title={paidPaused ? "Unpause + extend paid_until by paused duration" : "Pause subscription (suspends paid access)"}
                              style={subBtnStyle(paidPaused, "#f5a623")}>
                              {paidPaused ? "▶ Unpause" : "⏸ Pause"}
                            </button>
                          )}
                          {(u.paid_until || u.paid_pause_started) && (
                            <button
                              onClick={() => {
                                if (!confirm(lang === "sk" ? `Vymazať paid window pre ${u.email}?` : `Clear paid window for ${u.email}?`)) return;
                                subAction && subAction(u, { paid_until: null, paid_started_at: null, paid_pause_started: null });
                              }}
                              disabled={isSelf}
                              title="Clear paid_until + paid_started_at + paused"
                              style={subBtnStyle(false, "#ff6b6b")}>
                              🗑
                            </button>
                          )}
                        </>
                      );
                    })()}
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
