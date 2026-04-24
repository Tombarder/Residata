/**
 * Platform shell + sub-pages for logged-in users.
 *
 * Lives at /app, /app/projects, /app/projects/:id, /app/analytics, /app/reports,
 * /app/exports, /app/billing, /app/settings, /app/admin.
 *
 * Visual language stays the same as the marketing site (dark + green accent),
 * but layout flips from "hero + long-scroll marketing" to "sidebar + dense data".
 *
 * The sidebar shows all menu items to every logged-in user; tier-gated ones
 * render with a small 🔒 icon and clicking them lands on an upgrade card
 * instead of the actual feature. Admin-only items are hidden for non-admins.
 */
import { useState, useEffect } from "react";
import { useAuth } from "../lib/useAuth";
import { useCapabilities } from "../lib/useCapabilities";
import { useProjects, useMarketTotals } from "../lib/useData";
import { supabase } from "../lib/supabase";
import { pushRoute } from "../lib/routing";
import { track } from "../lib/track";
import {
  LiveDashboard, LiveProjectDetail, LiveAnalytics, LiveAdmin,
} from "./LivePages";
import ReportsPage from "./Reports";

const mono = "'JetBrains Mono', monospace";
const green = "#00e5a0";
const dim = "#8a8a96";
const textLight = "#e8e8ed";
const border = "#222228";
const bg = "#16161a";
const bg2 = "#0e0e10";
const SIDEBAR_W = 240;

// ─── Icons — inline SVG, same weight as HowItWorks ──────────────
const Icon = ({ d, size = 18, stroke = 1.6 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const IconHome = () => <Icon d="M3 12l9-9 9 9M5 10v10h14V10" />;
const IconGrid = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
    <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
  </svg>
);
const IconChart = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18"/><path d="M7 14l3-4 4 3 5-7"/>
  </svg>
);
const IconDoc = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>
  </svg>
);
const IconDownload = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>
  </svg>
);
const IconCard = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>
  </svg>
);
const IconSettings = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
);
const IconShield = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);
const IconLock = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);
const IconExternal = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

// ─── Nav definition ─────────────────────────────────────────────
// Each item: { page, label, icon, requires? (capability), adminOnly? }
// Pages: "App:Dashboard", "App:Projects", "App:Analytics", "App:Reports",
//        "App:Exports", "App:Billing", "App:Settings", "App:Admin"
const NAV = [
  { group: "main", items: [
    { page: "App:Dashboard", label: { en: "Dashboard",  sk: "Dashboard" }, Icon: IconHome },
    { page: "App:Projects",  label: { en: "Projects",   sk: "Projekty"  }, Icon: IconGrid },
    { page: "App:Analytics", label: { en: "Analytics",  sk: "Analytika" }, Icon: IconChart,    requires: "view_analytics" },
    { page: "App:Reports",   label: { en: "Reports",    sk: "Reporty"   }, Icon: IconDoc,      requires: "view_monthly_reports" },
    { page: "App:Exports",   label: { en: "Exports",    sk: "Exporty"   }, Icon: IconDownload, requires: "export_data" },
  ]},
  { group: "account", items: [
    { page: "App:Billing",  label: { en: "Billing & tier", sk: "Platba a tier" }, Icon: IconCard },
    { page: "App:Settings", label: { en: "Settings",       sk: "Nastavenia"   }, Icon: IconSettings },
  ]},
  { group: "admin", items: [
    { page: "App:Admin", label: { en: "Admin", sk: "Admin" }, Icon: IconShield, adminOnly: true },
  ]},
];

// ─── Platform Shell ─────────────────────────────────────────────
export default function PlatformShell({ page, projectId, lang = "en", setCurrent, openLogin }) {
  const auth = useAuth();
  const { can, tier } = useCapabilities();
  const [mobileOpen, setMobileOpen] = useState(false);

  // If somehow anon ended up on /app/*, kick them to home + open login modal.
  useEffect(() => {
    if (!auth.loading && !auth.user) {
      pushRoute("Home");
      setCurrent && setCurrent("Home");
      openLogin && openLogin();
    }
  }, [auth.loading, auth.user, setCurrent, openLogin]);

  if (auth.loading) {
    return (
      <main style={{ padding: "8rem 2rem 4rem", textAlign: "center", color: dim, fontFamily: mono, fontSize: "0.8rem" }}>
        Loading…
      </main>
    );
  }
  if (!auth.user) return null;  // redirecting

  const navigate = (p) => {
    // Rewrite shared-component navigation targets so clicks inside the
    // platform shell stay inside /app/* instead of bouncing out to the
    // marketing site. LiveDashboard / LiveProjectDetail / etc are used
    // both here and on /live, and by default they pass:
    //   · "Project:<id>"  → should become App:ProjectDetail:<id>
    //   · "Live"          → should become App:Projects (the platform
    //                        projects list; keeps the sidebar visible)
    //   · "Pricing"       → should become App:Billing (the in-platform
    //                        billing page handles upgrades natively)
    // Without these rewrites, back-buttons in shared components ("Späť
    // na prehľad", "Upgrade to paid") teleport the user out of the
    // platform shell — visually jarring and breaks the back-stack
    // (browser Back lands on /app/projects but the UI had already
    // switched to /live).
    // Extra bonus: keeping PlatformShell mounted across these nav events
    // means the page-fade happens inside the shell via its internal
    // key={page} remount. No cross-tree remount = no useProjectFlats
    // cancelled-flag race = no "stuck on loading" symptom on click.
    if (typeof p === "string") {
      if (p.startsWith("Project:"))        p = "App:ProjectDetail:" + p.slice("Project:".length);
      else if (p === "Live")                p = "App:Projects";
      else if (p === "Pricing")             p = "App:Billing";
      else if (p === "Analytics")           p = "App:Analytics";
    }
    setCurrent && setCurrent(p);
    pushRoute(p);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#0a0a0b" }}>
      <Sidebar
        page={page}
        lang={lang}
        can={can}
        tier={tier}
        email={auth.user.email}
        onNavigate={navigate}
        onSignOut={auth.signOut}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
        className="platform-hamburger"
        style={{
          display: "none",  // shown via media query in <style>
          position: "fixed", top: "1rem", left: "1rem", zIndex: 60,
          background: bg2, border: `1px solid ${border}`, color: textLight,
          borderRadius: 8, padding: "0.5rem 0.75rem", cursor: "pointer", fontSize: "0.9rem",
        }}>
        ☰
      </button>

      {/* Main content */}
      <div style={{
        flex: 1,
        marginLeft: SIDEBAR_W,
        minWidth: 0,
        display: "flex", flexDirection: "column",
      }} className="platform-main">
        <TopBar page={page} lang={lang} tier={tier} />

        {/* Content area. key={page} makes the fade animation replay on nav,
            but hook state (useProjects etc) survives remount via module-
            level cache — so we don't see the "zeros flash". */}
        <div style={{ flex: 1 }} key={page} className="page-transition">
          <PageContent
            page={page}
            projectId={projectId}
            lang={lang}
            setCurrent={navigate}
            openLogin={openLogin}
          />
        </div>
      </div>

      <style>{`
        @media (max-width: 840px) {
          .platform-sidebar { transform: translateX(-100%); transition: transform 0.25s ease; }
          .platform-sidebar.is-open { transform: translateX(0); }
          .platform-main { margin-left: 0 !important; }
          .platform-hamburger { display: inline-block !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────
function Sidebar({ page, lang, can, tier, email, onNavigate, onSignOut, mobileOpen, onCloseMobile }) {
  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={onCloseMobile}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 40,
          }}
        />
      )}

      <aside
        className={`platform-sidebar${mobileOpen ? " is-open" : ""}`}
        style={{
          position: "fixed", left: 0, top: 0, bottom: 0, width: SIDEBAR_W,
          background: "linear-gradient(180deg, #0e0e10 0%, #0a0a0b 100%)",
          borderRight: `1px solid ${border}`,
          display: "flex", flexDirection: "column",
          zIndex: 50,
        }}
      >
        {/* Logo */}
        <div style={{ padding: "1.25rem 1rem 1rem", display: "flex", alignItems: "center", gap: "0.55rem" }}>
          <div style={{
            width: 32, height: 32, borderRadius: 7, background: green,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, color: "#0a0a0b", fontFamily: mono, fontSize: 16,
          }}>R</div>
          <div>
            <div style={{ fontWeight: 600, color: textLight, fontSize: "1rem", letterSpacing: "-0.01em", lineHeight: 1 }}>Residata</div>
            <div style={{ fontFamily: mono, fontSize: "0.6rem", color: green, letterSpacing: "0.12em", marginTop: 2 }}>PLATFORM</div>
          </div>
        </div>

        {/* Nav groups */}
        <nav style={{ flex: 1, padding: "0.5rem 0.5rem", overflowY: "auto" }}>
          {NAV.map((group, gi) => {
            const visibleItems = group.items.filter(item => {
              if (item.adminOnly && tier !== "admin") return false;
              return true;
            });
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.group} style={{ marginBottom: gi < NAV.length - 1 ? "0.85rem" : 0 }}>
                {gi > 0 && <div style={{ height: 1, background: border, margin: "0.35rem 0.75rem 0.65rem" }} />}
                {visibleItems.map(item => {
                  const active = page === item.page;
                  const locked = item.requires && !can(item.requires);
                  return (
                    <button
                      key={item.page}
                      onClick={() => onNavigate(item.page)}
                      style={{
                        display: "flex", alignItems: "center", gap: "0.7rem",
                        width: "100%", padding: "0.6rem 0.85rem",
                        background: active ? "rgba(0,229,160,0.12)" : "transparent",
                        border: "none",
                        borderLeft: `3px solid ${active ? green : "transparent"}`,
                        color: active ? textLight : (locked ? "#55555f" : "#c0c0c8"),
                        cursor: "pointer",
                        fontSize: "0.88rem", fontFamily: "inherit",
                        textAlign: "left", borderRadius: 0,
                        transition: "background 0.15s, color 0.15s",
                      }}
                      onMouseEnter={e => !active && (e.currentTarget.style.background = "rgba(255,255,255,0.03)", e.currentTarget.style.color = textLight)}
                      onMouseLeave={e => !active && (e.currentTarget.style.background = "transparent", e.currentTarget.style.color = locked ? "#55555f" : "#c0c0c8")}
                    >
                      <span style={{ display: "inline-flex", alignItems: "center", color: active ? green : "inherit" }}><item.Icon /></span>
                      <span style={{ flex: 1 }}>{item.label[lang] || item.label.en}</span>
                      {locked && <span style={{ color: "#55555f" }}><IconLock /></span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Account card */}
        <div style={{ padding: "0.75rem", borderTop: `1px solid ${border}` }}>
          <div style={{
            background: bg2, border: `1px solid ${border}`, borderRadius: 8,
            padding: "0.65rem 0.75rem", marginBottom: "0.5rem",
          }}>
            <div style={{ fontSize: "0.72rem", color: textLight, fontFamily: mono, lineHeight: 1.3, wordBreak: "break-all" }}>
              {email}
            </div>
            <div style={{ marginTop: "0.35rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <TierBadgeSmall tier={tier} />
              <a href="/" onClick={e => { e.preventDefault(); window.location.assign("/"); }}
                style={{ marginLeft: "auto", fontSize: "0.68rem", color: dim, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "0.2rem" }}
                title="Back to marketing site">
                <IconExternal />
              </a>
            </div>
          </div>
          <button
            onClick={async () => {
              // Defensive: try the real sign-out, but fall back to a hard
              // navigation either way. That makes the button impossible to
              // "not work" — worst case the page just reloads anon.
              try { await onSignOut(); } catch (e) { console.error("signOut", e); }
              window.location.href = "/";
            }}
            style={{
              width: "100%", padding: "0.55rem", background: "transparent",
              border: `1px solid ${border}`, color: "#c0c0c8",
              fontSize: "0.78rem", borderRadius: 6, cursor: "pointer",
              fontFamily: "inherit",
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = "#ff6b6b60"}
            onMouseLeave={e => e.currentTarget.style.borderColor = border}
          >
            {lang === "sk" ? "Odhlásiť" : "Sign out"}
          </button>
        </div>
      </aside>
    </>
  );
}

function TierBadgeSmall({ tier }) {
  const palette = {
    free:    { c: "#c0c0c8", bg: "rgba(192,192,200,0.1)"  },
    paid:    { c: green,     bg: "rgba(0,229,160,0.12)"    },
    admin:   { c: "#f5a623", bg: "rgba(245,166,35,0.12)"   },
    pending: { c: "#888",    bg: "rgba(136,136,136,0.12)"  },
    anon:    { c: dim,       bg: "rgba(138,138,150,0.08)"  },
  };
  const p = palette[tier] || palette.anon;
  return (
    <span style={{
      fontFamily: mono, fontSize: "0.6rem", color: p.c, background: p.bg,
      border: `1px solid ${p.c}40`, padding: "1px 6px", borderRadius: 10,
      textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em",
    }}>{tier}</span>
  );
}

// ─── TopBar ─────────────────────────────────────────────────────
function TopBar({ page, lang, tier }) {
  const titles = {
    "App:Dashboard": { en: "Dashboard",       sk: "Dashboard"    },
    "App:Projects":  { en: "Projects",        sk: "Projekty"     },
    "App:Analytics": { en: "Analytics",       sk: "Analytika"    },
    "App:Reports":   { en: "Reports",         sk: "Reporty"      },
    "App:Exports":   { en: "Exports",         sk: "Exporty"      },
    "App:Billing":   { en: "Billing & tier",  sk: "Platba a tier"},
    "App:Settings":  { en: "Settings",        sk: "Nastavenia"   },
    "App:Admin":     { en: "Admin",           sk: "Admin"        },
  };
  const isProjectDetail = typeof page === "string" && page.startsWith("App:ProjectDetail:");
  const title = isProjectDetail
    ? (lang === "sk" ? "Detail projektu" : "Project detail")
    : (titles[page]?.[lang] || titles[page]?.en || "Residata");

  return (
    <header style={{
      padding: "1.25rem 2rem", display: "flex", alignItems: "center", justifyContent: "space-between",
      borderBottom: `1px solid ${border}`, background: "#0a0a0b",
      position: "sticky", top: 0, zIndex: 30,
    }} className="platform-topbar">
      <div style={{ paddingLeft: "2.5rem" /* leave room for mobile hamburger */ }} className="platform-topbar-inner">
        <div style={{ fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.2rem" }}>
          {lang === "sk" ? "Platforma · " : "Platform · "}{tier.toUpperCase()}
        </div>
        <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.02em", color: textLight }}>
          {title}
        </h1>
      </div>

      {/* Back-to-marketing button — always visible top-right of the platform.
          Uses a full navigation (window.location) so the marketing bundle
          loads cleanly without React trying to reconcile platform state. */}
      <a
        href="/"
        onClick={e => { e.preventDefault(); window.location.assign("/"); }}
        style={{
          display: "inline-flex", alignItems: "center", gap: "0.45rem",
          padding: "0.5rem 0.95rem", borderRadius: 8,
          background: "transparent", border: `1px solid ${border}`,
          color: "#c0c0c8", fontSize: "0.8rem", fontFamily: "inherit",
          textDecoration: "none", cursor: "pointer",
          transition: "border-color 0.15s, color 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = green; e.currentTarget.style.color = green; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = "#c0c0c8"; }}
        title={lang === "sk" ? "Otvoriť webstránku" : "Open website"}
      >
        <span style={{ fontSize: "0.9rem", lineHeight: 1 }}>←</span>
        <span>{lang === "sk" ? "Webstránka" : "Website"}</span>
      </a>

      <style>{`
        @media (min-width: 841px) {
          .platform-topbar-inner { padding-left: 0 !important; }
        }
      `}</style>
    </header>
  );
}

// ─── Page router ────────────────────────────────────────────────
function PageContent({ page, projectId, lang, setCurrent, openLogin }) {
  // Gated pages with an UpgradeCard fallback for users who lack the capability.
  if (page === "App:Dashboard")  return <PlatformDashboard lang={lang} setCurrent={setCurrent} />;
  if (page === "App:Projects")   return <PlatformProjects lang={lang} setCurrent={setCurrent} openLogin={openLogin} />;
  if (page === "App:Analytics")  return <Gated require="view_analytics"       lang={lang} setCurrent={setCurrent}><LiveAnalytics lang={lang} setCurrent={setCurrent} openLogin={openLogin} /></Gated>;
  if (page === "App:Reports")    return <Gated require="view_monthly_reports" lang={lang} setCurrent={setCurrent}><ReportsPage lang={lang} /></Gated>;
  if (page === "App:Exports")    return <Gated require="export_data"          lang={lang} setCurrent={setCurrent}><PlatformExports lang={lang} setCurrent={setCurrent} /></Gated>;
  if (page === "App:Billing")    return <PlatformBilling lang={lang} setCurrent={setCurrent} />;
  if (page === "App:Settings")   return <PlatformSettings lang={lang} />;
  if (page === "App:Admin")      return <Gated require="manage_users" lang={lang} setCurrent={setCurrent}><LiveAdmin lang={lang} setCurrent={setCurrent} /></Gated>;
  if (typeof page === "string" && page.startsWith("App:ProjectDetail:")) {
    const id = page.slice("App:ProjectDetail:".length);
    return <LiveProjectDetail projectId={id} lang={lang} setCurrent={setCurrent} openLogin={openLogin} />;
  }
  // Fallback
  return <PlatformDashboard lang={lang} setCurrent={setCurrent} />;
}

// ─── Gated wrapper ──────────────────────────────────────────────
function Gated({ require, children, lang, setCurrent }) {
  const { can, tier } = useCapabilities();
  if (can(require)) return children;
  return <UpgradeCard lang={lang} requiredFor={require} currentTier={tier} setCurrent={setCurrent} />;
}

function UpgradeCard({ lang, requiredFor, currentTier, setCurrent }) {
  const featureName = {
    view_analytics: lang === "sk" ? "Analytika a trendy" : "Analytics & trends",
    view_monthly_reports: lang === "sk" ? "Mesačné reporty" : "Monthly reports",
    export_data: lang === "sk" ? "Exporty (CSV / API)" : "Exports (CSV / API)",
    manage_users: "Admin",
  }[requiredFor] || requiredFor;

  return (
    <div style={{ padding: "3rem 2rem", display: "flex", justifyContent: "center" }}>
      <div style={{
        background: bg, border: `1px solid ${border}`, borderRadius: 16,
        padding: "2.5rem 2.25rem", maxWidth: 480, width: "100%", textAlign: "center",
      }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>🔒</div>
        <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
          {lang === "sk" ? "Platená funkcia" : "Paid feature"}
        </div>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.02em", color: textLight, margin: 0 }}>
          {featureName}
        </h2>
        <p style={{ color: dim, fontSize: "0.9rem", lineHeight: 1.6, marginTop: "0.75rem", marginBottom: "1.5rem" }}>
          {lang === "sk"
            ? <>Aktuálny tier: <strong style={{ color: textLight }}>{currentTier}</strong>. Upgrade na <strong style={{ color: green }}>paid</strong> a odomkni túto sekciu + všetky dáta, analytiku, históriu a exporty.</>
            : <>Current tier: <strong style={{ color: textLight }}>{currentTier}</strong>. Upgrade to <strong style={{ color: green }}>paid</strong> to unlock this section plus full data, analytics, history and exports.</>}
        </p>
        <button className="btn-p" onClick={() => setCurrent && setCurrent("App:Billing")}>
          {lang === "sk" ? "Upgrade na paid" : "Upgrade to paid"}
        </button>
      </div>
    </div>
  );
}

// ─── Dashboard page ─────────────────────────────────────────────
function PlatformDashboard({ lang, setCurrent }) {
  const { profile, tier } = useAuth();
  const { can } = useCapabilities();
  const { projects } = useProjects();
  const marketTotals = useMarketTotals();

  // KPI counts come from the published `metrics` table (same values
  // the ticker + marketing site show). Fall back to summing projects
  // when metrics haven't synced yet. `sold30` stays project-derived
  // because the metric doesn't exist at the per-month granularity.
  const rawTotals = projects.reduce((a, p) => ({
    units: a.units + (p.total_units || 0),
    avail: a.avail + (p.available_units || 0),
    sold:  a.sold  + (p.sold_units || 0),
    sold30: a.sold30 + (p.sold_last_month || 0),
  }), { units: 0, avail: 0, sold: 0, sold30: 0 });
  const totals = {
    units:  marketTotals.unitsTracked   != null ? marketTotals.unitsTracked   : rawTotals.units,
    avail:  marketTotals.unitsAvailable != null ? marketTotals.unitsAvailable : rawTotals.avail,
    sold:   marketTotals.unitsSold      != null ? marketTotals.unitsSold      : rawTotals.sold,
    sold30: rawTotals.sold30,
  };
  const eurM2Values = projects.map(p => p.avg_price_eur_m2).filter(Boolean);
  const avgEurM2 = eurM2Values.length ? Math.round(eurM2Values.reduce((a, b) => a + b, 0) / eurM2Values.length) : null;

  // Top 5 most active projects
  const top = [...projects]
    .sort((a, b) => (b.available_units || 0) - (a.available_units || 0))
    .slice(0, 5);

  const greeting = (() => {
    const hour = new Date().getHours();
    const name = (profile?.full_name || "").split(" ")[0] || "";
    const greetWord = lang === "sk"
      ? (hour < 11 ? "Dobré ráno" : hour < 17 ? "Ahoj" : "Dobrý večer")
      : (hour < 11 ? "Good morning" : hour < 17 ? "Hey" : "Good evening");
    return name ? `${greetWord}, ${name}.` : `${greetWord}.`;
  })();

  return (
    <div style={{ padding: "2rem 2rem 4rem", maxWidth: 1200 }}>
      <h2 style={{ fontSize: "1.5rem", fontWeight: 600, color: textLight, marginTop: 0, marginBottom: "0.25rem" }}>
        {greeting}
      </h2>
      <p style={{ color: dim, fontSize: "0.95rem", lineHeight: 1.6, marginBottom: "2rem" }}>
        {lang === "sk"
          ? <>Toto je tvoj Residata dashboard. Nižšie je aktuálny stav trhu — data refresh každý mesiac, posledný beh pipeline je <strong style={{ color: textLight }}>{new Date().toISOString().slice(0, 10)}</strong>.</>
          : <>This is your Residata dashboard. Current market state below — data refreshes monthly, last pipeline run was <strong style={{ color: textLight }}>{new Date().toISOString().slice(0, 10)}</strong>.</>}
      </p>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem", marginBottom: "2rem" }}>
        <KpiCard label={lang === "sk" ? "Sledované projekty" : "Projects tracked"} value={projects.length.toLocaleString(lang === "sk" ? "sk-SK" : "en-US")} />
        <KpiCard label={lang === "sk" ? "Voľné byty" : "Available units"} value={totals.avail.toLocaleString(lang === "sk" ? "sk-SK" : "en-US")} accent={green} />
        <KpiCard label={lang === "sk" ? "Predané (30 dní)" : "Sold (30 days)"} value={totals.sold30 ? `+${totals.sold30}` : "—"} accent="#f5a623"
          locked={!can("view_sold_velocity")} />
        <KpiCard label={lang === "sk" ? "Priem. €/m²" : "Avg €/m²"} value={avgEurM2 ? avgEurM2.toLocaleString(lang === "sk" ? "sk-SK" : "en-US") : "—"} />
      </div>

      {/* Market highlights — replaces the old duplicate-of-sidebar action
          buttons. Every card is a live data-driven "huh interesting"
          moment, computed from the same projects array. */}
      <MarketHighlights projects={projects} lang={lang} setCurrent={setCurrent} showUpgrade={!can("view_analytics")} />

      {/* Top projects */}
      <div>
        <div style={{ fontFamily: mono, fontSize: "0.7rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
          {lang === "sk" ? "Najaktívnejšie projekty" : "Most active projects"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.75rem" }}>
          {top.length === 0 ? (
            <div style={{ color: dim, fontSize: "0.85rem" }}>{lang === "sk" ? "Načítavam…" : "Loading…"}</div>
          ) : top.map(p => (
            <div key={p.id}
              onClick={() => setCurrent(`App:ProjectDetail:${p.id}`)}
              style={{
                background: bg, border: `1px solid ${border}`, borderRadius: 10,
                padding: "0.9rem 1rem", cursor: "pointer", transition: "border-color 0.15s, transform 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = green, e.currentTarget.style.transform = "translateY(-1px)")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = border, e.currentTarget.style.transform = "")}
            >
              <div style={{ fontWeight: 600, color: textLight, fontSize: "0.95rem", marginBottom: 2 }}>{p.name}</div>
              <div style={{ fontSize: "0.72rem", color: dim, fontFamily: mono, marginBottom: 8 }}>{p.district || "—"}</div>
              <div style={{ display: "flex", gap: "1rem", fontSize: "0.75rem" }}>
                <span><span style={{ color: green, fontFamily: mono, fontWeight: 700 }}>{p.available_units}</span> <span style={{ color: dim }}>{lang === "sk" ? "voľné" : "avail"}</span></span>
                {p.avg_price_eur_m2 && <span><span style={{ color: textLight, fontFamily: mono, fontWeight: 600 }}>{Math.round(p.avg_price_eur_m2).toLocaleString("en-US").replace(/,/g, " ")}</span> <span style={{ color: dim }}>€/m²</span></span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, accent = textLight, locked = false }) {
  return (
    <div style={{
      background: bg, border: `1px solid ${border}`, borderRadius: 10,
      padding: "1rem 1.1rem",
    }}>
      <div style={{ fontFamily: mono, fontSize: "0.62rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.4rem" }}>{label}</div>
      <div style={{
        fontFamily: mono, fontSize: "1.6rem", fontWeight: 700, color: accent,
        letterSpacing: "-0.02em", lineHeight: 1,
        filter: locked ? "blur(5px)" : "none",
        opacity: locked ? 0.5 : 1,
      }}>{value}</div>
      {locked && <div style={{ fontSize: "0.65rem", color: "#f5a623", marginTop: "0.35rem", fontFamily: mono }}>paid only</div>}
    </div>
  );
}

function ActionCard({ title, desc, onClick, accent = false }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left", cursor: "pointer", fontFamily: "inherit",
        background: accent ? "rgba(0,229,160,0.06)" : bg,
        border: `1px solid ${accent ? "rgba(0,229,160,0.35)" : border}`,
        borderRadius: 10, padding: "1rem 1.1rem",
        transition: "transform 0.15s, border-color 0.15s",
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = green, e.currentTarget.style.transform = "translateY(-1px)")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = accent ? "rgba(0,229,160,0.35)" : border, e.currentTarget.style.transform = "")}
    >
      <div style={{ fontSize: "0.95rem", fontWeight: 600, color: textLight, marginBottom: "0.25rem" }}>{title} <span style={{ color: green }}>→</span></div>
      <div style={{ fontSize: "0.78rem", color: dim, lineHeight: 1.45 }}>{desc}</div>
    </button>
  );
}

/**
 * MarketHighlights — 3 live-data cards that tell the user something
 * interesting the instant they land on the dashboard. No duplicate
 * navigation, no "go to X" buttons. Values are recomputed each time
 * projects changes.
 */
function MarketHighlights({ projects, lang, setCurrent, showUpgrade }) {
  if (!projects || projects.length === 0) return null;

  const withVelocity = projects.filter(p => (p.sold_last_month || 0) > 0);
  const topSeller = withVelocity.sort((a, b) => (b.sold_last_month || 0) - (a.sold_last_month || 0))[0];

  const soldOutSoon = projects
    .filter(p => (p.sold_percentage || 0) >= 85 && (p.sold_percentage || 0) < 100 && (p.available_units || 0) > 0)
    .sort((a, b) => (b.sold_percentage || 0) - (a.sold_percentage || 0))[0];

  const priciest = projects
    .filter(p => p.avg_price_eur_m2)
    .sort((a, b) => b.avg_price_eur_m2 - a.avg_price_eur_m2)[0];

  const cheapest = projects
    .filter(p => p.avg_price_eur_m2 && p.available_units > 0)
    .sort((a, b) => a.avg_price_eur_m2 - b.avg_price_eur_m2)[0];

  const cards = [];
  if (topSeller) cards.push({
    tag: lang === "sk" ? "Top predajca (30d)" : "Top seller (30d)",
    title: topSeller.name,
    sub: `${topSeller.district || "—"} · ${topSeller.avg_price_eur_m2 ? Math.round(topSeller.avg_price_eur_m2).toLocaleString("en-US").replace(/,/g, " ") + " €/m²" : "—"}`,
    stat: `+${topSeller.sold_last_month}`,
    statSub: lang === "sk" ? "predaných" : "sold",
    statColor: green,
    onClick: () => setCurrent(`App:ProjectDetail:${topSeller.id}`),
  });
  if (soldOutSoon) cards.push({
    tag: lang === "sk" ? "Dopredáva sa" : "Selling out",
    title: soldOutSoon.name,
    sub: `${soldOutSoon.district || "—"} · ${soldOutSoon.available_units} ${lang === "sk" ? "zostáva" : "left"}`,
    stat: `${Math.round(soldOutSoon.sold_percentage)}%`,
    statSub: lang === "sk" ? "predané" : "sold",
    statColor: "#ff6b6b",
    onClick: () => setCurrent(`App:ProjectDetail:${soldOutSoon.id}`),
  });
  if (showUpgrade) {
    cards.push({
      tag: lang === "sk" ? "Paid tier" : "Paid tier",
      title: lang === "sk" ? "Odomkni analytiku" : "Unlock analytics",
      sub: lang === "sk" ? "Trendy · exporty · reporty" : "Trends · exports · reports",
      stat: "⭐",
      statSub: lang === "sk" ? "upgrade" : "upgrade",
      statColor: "#f5a623",
      onClick: () => setCurrent("App:Billing"),
      accent: true,
    });
  } else if (priciest) {
    cards.push({
      tag: lang === "sk" ? "Najdrahší €/m²" : "Priciest €/m²",
      title: priciest.name,
      sub: `${priciest.district || "—"}`,
      stat: Math.round(priciest.avg_price_eur_m2).toLocaleString("en-US").replace(/,/g, " "),
      statSub: "€/m²",
      statColor: "#f5a623",
      onClick: () => setCurrent(`App:ProjectDetail:${priciest.id}`),
    });
  }

  return (
    <div style={{ marginBottom: "2rem" }}>
      <div style={{ fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.6rem" }}>
        {lang === "sk" ? "Aktuálne" : "Right now"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.85rem" }}>
        {cards.map((c, i) => (
          <button
            key={i}
            onClick={c.onClick}
            style={{
              textAlign: "left", cursor: "pointer", fontFamily: "inherit",
              background: c.accent ? "rgba(0,229,160,0.06)" : bg,
              border: `1px solid ${c.accent ? "rgba(0,229,160,0.35)" : border}`,
              borderRadius: 10, padding: "1rem 1.1rem",
              display: "flex", justifyContent: "space-between", gap: "0.75rem",
              transition: "transform 0.15s, border-color 0.15s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = green; e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = c.accent ? "rgba(0,229,160,0.35)" : border; e.currentTarget.style.transform = ""; }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.3rem" }}>{c.tag}</div>
              <div style={{ fontSize: "0.92rem", fontWeight: 600, color: textLight, marginBottom: "0.15rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>
              <div style={{ fontSize: "0.72rem", color: dim, fontFamily: mono }}>{c.sub}</div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontFamily: mono, fontSize: "1.35rem", fontWeight: 700, color: c.statColor, lineHeight: 1 }}>{c.stat}</div>
              <div style={{ fontFamily: mono, fontSize: "0.62rem", color: dim, marginTop: "0.3rem", letterSpacing: "0.08em" }}>{c.statSub}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Projects page ──────────────────────────────────────────────
// Reuses LiveDashboard. No change needed — the anon-teaser logic already hides
// itself once the viewer has capability 'view_all_projects_list', which every
// logged-in non-pending user has. For the rare case where someone with tier
// 'pending' lands here (edge case in freemium), LiveDashboard handles it.
function PlatformProjects({ lang, setCurrent, openLogin }) {
  return (
    <div style={{ padding: "1rem 2rem 4rem" }}>
      <LiveDashboard lang={lang} setCurrent={setCurrent} openLogin={openLogin} />
    </div>
  );
}

// ─── Billing page ───────────────────────────────────────────────
function PlatformBilling({ lang, setCurrent }) {
  const { tier } = useCapabilities();
  const { profile } = useAuth();

  const isFree = tier === "free";
  const isPaid = tier === "paid";
  const isAdmin = tier === "admin";

  const approvedAt = profile?.approved_at ? new Date(profile.approved_at).toISOString().slice(0, 10) : null;

  return (
    <div style={{ padding: "2rem", maxWidth: 760 }}>
      {/* Current tier card */}
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.75rem 2rem", marginBottom: "1.25rem" }}>
        <div style={{ fontFamily: mono, fontSize: "0.65rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.4rem" }}>
          {lang === "sk" ? "Tvoj aktuálny tier" : "Your current tier"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
          <TierBadgeSmall tier={tier} />
          <span style={{ fontSize: "1.35rem", fontWeight: 700, color: textLight, letterSpacing: "-0.02em" }}>
            {isFree && (lang === "sk" ? "Free" : "Free")}
            {isPaid && (lang === "sk" ? "Paid" : "Paid")}
            {isAdmin && "Admin"}
          </span>
          {approvedAt && <span style={{ fontSize: "0.75rem", color: dim, fontFamily: mono }}>
            {lang === "sk" ? "od" : "since"} {approvedAt}
          </span>}
        </div>
        <p style={{ color: "#c0c0c8", fontSize: "0.9rem", lineHeight: 1.65, margin: 0 }}>
          {isFree && (lang === "sk"
            ? "Ako free user vidíš zoznam všetkých projektov a plný detail 1 projektu podľa tvojho výberu. Analytika, reporty a exporty sú v paid tieri."
            : "As a free user you see the full project list and full detail of 1 project of your choice. Analytics, reports and exports are in the paid tier.")}
          {isPaid && (lang === "sk"
            ? "Máš plný prístup — všetky projekty, historická data, analytika, exporty, mesačné reporty."
            : "You have full access — every project, historical data, analytics, exports, monthly reports.")}
          {isAdmin && (lang === "sk"
            ? "Admin tier — plný prístup plus admin panel pre správu užívateľov."
            : "Admin tier — full access plus the admin panel for user management.")}
        </p>
      </div>

      {/* Upgrade CTA (free only) */}
      {isFree && (
        <div style={{
          background: "linear-gradient(135deg, rgba(0,229,160,0.1), rgba(0,229,160,0.02))",
          border: "1px solid rgba(0,229,160,0.3)", borderRadius: 12, padding: "1.75rem 2rem", marginBottom: "1.25rem",
        }}>
          <div style={{ fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            {lang === "sk" ? "Upgrade na paid" : "Upgrade to paid"}
          </div>
          <h3 style={{ fontSize: "1.2rem", fontWeight: 700, color: textLight, margin: 0, marginBottom: "0.65rem" }}>
            {lang === "sk" ? "Odomkni celý produkt za €349 / mesiac" : "Unlock the whole product for €349 / month"}
          </h3>
          <ul style={{ color: "#c0c0c8", fontSize: "0.88rem", lineHeight: 1.7, paddingLeft: "1.1rem", margin: "0.5rem 0 1.25rem" }}>
            <li>{lang === "sk" ? "Plný detail každého aktívneho projektu" : "Full detail of every active project"}</li>
            <li>{lang === "sk" ? "Analytika, trendy, heat mapy" : "Analytics, trends, district heat maps"}</li>
            <li>{lang === "sk" ? "Mesačné PDF reporty" : "Monthly PDF reports"}</li>
            <li>{lang === "sk" ? "CSV exporty + REST API" : "CSV exports + REST API"}</li>
            <li>{lang === "sk" ? "Historické snapshoty (mesiac-na-mesiac)" : "Historical snapshots (month-over-month)"}</li>
          </ul>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <a href="tel:+421911963909" className="btn-p">📞 Call +421 911 963 909</a>
            <a href="mailto:residata@proton.me?subject=Upgrade%20to%20paid" className="btn-s">✉️ Email us</a>
          </div>
          <p style={{ fontSize: "0.72rem", color: dim, marginTop: "1rem", fontFamily: mono }}>
            {lang === "sk"
              ? "Žiadne kreditky / formuláre. 5 min hovor, dohodneme sa, prístup máš hneď."
              : "No credit cards / forms. 5 min call, we agree, you're paid."}
          </p>
        </div>
      )}

      {/* Already paid — subscription info placeholder */}
      {isPaid && (
        <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.5rem 1.75rem" }}>
          <div style={{ fontFamily: mono, fontSize: "0.65rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            {lang === "sk" ? "Predplatné" : "Subscription"}
          </div>
          <p style={{ color: "#c0c0c8", fontSize: "0.9rem", lineHeight: 1.6, margin: 0 }}>
            {lang === "sk"
              ? "Self-service billing panel (faktúry, zmena platby, storno) pribudne čoskoro. Dovtedy napíš na "
              : "Self-service billing panel (invoices, payment changes, cancellations) is coming soon. For now email "}
            <a href="mailto:residata@proton.me" style={{ color: green }}>residata@proton.me</a>
            {lang === "sk" ? " a vybavíme manuálne." : " and we'll handle it manually."}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Settings page ──────────────────────────────────────────────
function PlatformSettings({ lang }) {
  const { user, profile, setProfile } = useAuth();
  const [form, setForm] = useState({
    full_name: profile?.full_name || "",
    company:   profile?.company || "",
    position:  profile?.position || "",
    linkedin_url: profile?.linkedin_url || "",
    phone:     profile?.phone || "",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const { data, error } = await supabase.from("user_profiles").update({
      full_name: form.full_name.trim() || null,
      company: form.company.trim() || null,
      position: form.position || null,
      linkedin_url: form.linkedin_url.trim() || null,
      phone: form.phone.trim() || null,
    }).eq("id", user.id).select();
    setSaving(false);
    if (error) {
      setMsg({ type: "err", text: error.message });
      return;
    }
    if (data?.[0]) setProfile(data[0]);
    track("settings_saved");
    setMsg({ type: "ok", text: lang === "sk" ? "Uložené ✓" : "Saved ✓" });
    setTimeout(() => setMsg(null), 2500);
  };

  const positions = [
    { v: "", label: lang === "sk" ? "— vyber —" : "— select —" },
    { v: "developer",  label: lang === "sk" ? "Developer / Sales" : "Developer / Sales" },
    { v: "investor",   label: lang === "sk" ? "Investor / PE"     : "Investor / PE" },
    { v: "bank",       label: lang === "sk" ? "Banka / Oceňovanie": "Bank / Valuer" },
    { v: "consultant", label: lang === "sk" ? "Konzultant / Analytik" : "Consultant / Analyst" },
    { v: "other",      label: lang === "sk" ? "Iné" : "Other" },
  ];

  return (
    <div style={{ padding: "2rem", maxWidth: 620 }}>
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.75rem 2rem" }}>
        <div style={{ fontFamily: mono, fontSize: "0.65rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.4rem" }}>
          {lang === "sk" ? "Účet" : "Account"}
        </div>
        <h3 style={{ fontSize: "1.15rem", fontWeight: 600, color: textLight, margin: 0, marginBottom: "1rem" }}>
          {user?.email}
        </h3>

        <form onSubmit={save}>
          <SettingsField label={lang === "sk" ? "Meno a priezvisko" : "Full name"}>
            <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })}
              style={inputStyle} />
          </SettingsField>
          <SettingsField label={lang === "sk" ? "Spoločnosť" : "Company"}>
            <input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })}
              style={inputStyle} />
          </SettingsField>
          <SettingsField label={lang === "sk" ? "Pozícia" : "Position"}>
            <select value={form.position} onChange={e => setForm({ ...form, position: e.target.value })}
              style={inputStyle}>
              {positions.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </SettingsField>
          <SettingsField label="LinkedIn URL">
            <input type="url" value={form.linkedin_url} onChange={e => setForm({ ...form, linkedin_url: e.target.value })}
              style={inputStyle} placeholder="https://linkedin.com/in/you" />
          </SettingsField>
          <SettingsField label={lang === "sk" ? "Telefón" : "Phone"}>
            <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
              style={inputStyle} placeholder="+421 …" />
          </SettingsField>

          {msg && (
            <div style={{
              fontSize: "0.82rem", marginTop: "0.5rem",
              color: msg.type === "ok" ? green : "#ff6b6b",
            }}>{msg.text}</div>
          )}

          <button type="submit" disabled={saving} className="btn-p" style={{ marginTop: "1.25rem", opacity: saving ? 0.6 : 1 }}>
            {saving ? (lang === "sk" ? "Ukladám…" : "Saving…") : (lang === "sk" ? "Uložiť zmeny" : "Save changes")}
          </button>
        </form>
      </div>

      {/* Read-only meta */}
      <div style={{ marginTop: "1.25rem", padding: "1rem 1.25rem", background: bg2, border: `1px solid ${border}`, borderRadius: 10, fontSize: "0.78rem", color: dim, fontFamily: mono, lineHeight: 1.7 }}>
        <div>user_id: {user?.id}</div>
        {profile?.created_at && <div>created: {profile.created_at.slice(0, 16).replace("T", " ")}</div>}
        <div>tier: {profile?.tier || "—"}</div>
      </div>
    </div>
  );
}

function SettingsField({ label, children }) {
  return (
    <div style={{ marginBottom: "0.85rem" }}>
      <label style={{ display: "block", fontSize: "0.7rem", color: dim, fontFamily: mono, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: "0.3rem" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "0.6rem 0.85rem",
  background: bg2, border: `1px solid ${border}`, borderRadius: 8,
  color: textLight, fontSize: "0.88rem", fontFamily: "inherit",
  boxSizing: "border-box", outline: "none",
};

// ─── Exports page — CSV downloads + API hint ──────────────
function PlatformExports({ lang }) {
  const { projects } = useProjects();
  const { user } = useAuth();

  const csvFromProjects = () => {
    const headers = ["id", "name", "district", "total_units", "available_units", "sold_units", "sold_last_month", "sold_percentage", "avg_price_eur_m2", "min_price", "max_price", "developer", "last_updated"];
    const rows = projects.map(p => headers.map(h => {
      const v = p[h]; if (v == null) return "";
      const s = String(v); return s.includes(",") || s.includes("\"") ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `residata-projects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const csvFromFlats = async () => {
    const { supabase } = await import("../lib/supabase");
    const { data, error } = await supabase.from("flats").select("*").limit(10000);
    if (error) { alert(`Export failed: ${error.message}`); return; }
    if (!data || data.length === 0) { alert("No flats available."); return; }
    const headers = Object.keys(data[0]);
    const rows = data.map(r => headers.map(h => {
      const v = r[h]; if (v == null) return "";
      const s = String(v); return s.includes(",") || s.includes("\"") ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `residata-flats-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div style={{ padding: "1rem 2rem 4rem", maxWidth: 720 }}>
      <p style={{ color: dim, fontSize: "0.9rem", lineHeight: 1.6, marginTop: 0, marginBottom: "1.5rem" }}>
        {lang === "sk"
          ? "Stiahni si celý dataset ako CSV, alebo ho ťahaj priamo cez REST API do tvojho stacku."
          : "Download the full dataset as CSV, or pull it via the REST API straight into your stack."}
      </p>

      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.5rem 1.75rem", marginBottom: "1rem" }}>
        <div style={{ fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.5rem" }}>CSV</div>
        <h3 style={{ fontSize: "1.05rem", fontWeight: 600, color: textLight, margin: 0, marginBottom: "1rem" }}>
          {lang === "sk" ? "Okamžitý export" : "Instant export"}
        </h3>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button onClick={csvFromProjects} className="btn-p" style={{ fontSize: "0.85rem" }}>
            ⬇ {lang === "sk" ? "Projekty" : "Projects"} ({projects.length})
          </button>
          <button onClick={csvFromFlats} className="btn-s" style={{ fontSize: "0.85rem" }}>
            ⬇ {lang === "sk" ? "Všetky byty" : "All flats"}
          </button>
        </div>
        <p style={{ color: dim, fontSize: "0.75rem", marginTop: "0.85rem", lineHeight: 1.5 }}>
          {lang === "sk"
            ? "CSV sa vytvorí v tvojom prehliadači — nič neodchádza mimo tvoj počítač. Pre Excel stačí dvojklik."
            : "CSV is generated in your browser — nothing leaves your machine. Double-click opens in Excel."}
        </p>
      </div>

      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.5rem 1.75rem" }}>
        <div style={{ fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.5rem" }}>API</div>
        <h3 style={{ fontSize: "1.05rem", fontWeight: 600, color: textLight, margin: 0, marginBottom: "0.75rem" }}>
          {lang === "sk" ? "REST API cez Supabase" : "REST API via Supabase"}
        </h3>
        <p style={{ color: "#c0c0c8", fontSize: "0.85rem", lineHeight: 1.6, marginBottom: "1rem" }}>
          {lang === "sk"
            ? "Dataset je dostupný priamo cez Supabase REST endpoint (gated cez tvoju session). Ak potrebuješ dedikovaný API kľúč pre server-to-server integráciu, napíš na "
            : "The dataset is available directly through Supabase REST (gated by your session). For a dedicated server-to-server API key, email "}
          <a href="mailto:residata@proton.me" style={{ color: green }}>residata@proton.me</a>.
        </p>
        <pre style={{
          margin: 0, padding: "0.75rem 1rem", background: bg2, borderRadius: 6,
          fontSize: "0.75rem", color: "#c0c0c8", fontFamily: mono, overflowX: "auto",
        }}>
{`GET https://mtclsrswxtjseewyrcbx.supabase.co/rest/v1/projects
  Headers:
    apikey: <anon key>
    Authorization: Bearer <your session token>`}
        </pre>
        {user && (
          <p style={{ fontSize: "0.72rem", color: dim, marginTop: "0.85rem", fontFamily: mono }}>
            user_id: {user.id}
          </p>
        )}
      </div>
    </div>
  );
}
