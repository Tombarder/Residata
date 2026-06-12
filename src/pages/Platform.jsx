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
import { Component, useState, useEffect } from "react";
import { useAuth } from "../lib/useAuth";
import { useCapabilities } from "../lib/useCapabilities";
import { useProjects, useMarketTotals } from "../lib/useData";
import { moneyFromEur, moneySymbol } from "../lib/money";
import { useCurrency } from "../lib/useCurrency";
import { supabase } from "../lib/supabase";
import { pushRoute } from "../lib/routing";
import { track } from "../lib/track";
import { cleanText, cleanUrl, cleanPhone } from "../lib/sanitize";
import {
  LiveDashboard, LiveProjectDetail, LiveAnalytics, LiveAdmin,
} from "./LivePages";
import ReportsPage from "./Reports";
import UnitTracker from "./UnitTracker";
import ChatAssistant from "../components/ChatAssistant";
import CountrySwitcher from "../components/CountrySwitcher";
import CurrencySwitcher from "../components/CurrencySwitcher";
// AiBetaBanner moved into AI surfaces only (ChatAssistant + FloatingChat)
// after QA — was on every /app/* page which felt like noise on Dashboard /
// Reports / Pivot where AI doesn't show up at all.

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
const IconClock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <polyline points="12 6 12 12 16 14"/>
  </svg>
);
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
const IconSparkle = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>
  </svg>
);

const NAV = [
  { group: "main", items: [
    { page: "App:Dashboard", label: { en: "Dashboard",  sk: "Dashboard" }, Icon: IconHome },
    { page: "App:Projects",  label: { en: "Projects",   sk: "Projekty"  }, Icon: IconGrid },
    { page: "App:Analytics", label: { en: "Analytics",  sk: "Analytika" }, Icon: IconChart,    requires: "view_analytics" },
    { page: "App:UnitTimeline", label: { en: "Unit timeline", sk: "Byt v čase" }, Icon: IconClock, requires: "view_analytics" },
    { page: "App:Reports",   label: { en: "Reports",    sk: "Reporty"   }, Icon: IconDoc,      requires: "view_monthly_reports" },
    { page: "App:Assistant", label: { en: "Ask AI",     sk: "AI asistent" }, Icon: IconSparkle },
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
export default function PlatformShell({ page, projectId, lang = "en", setLang, setCurrent, openLogin }) {
  const auth = useAuth();
  const { can, tier } = useCapabilities();
  const [mobileOpen, setMobileOpen] = useState(false);

  // If somehow anon ended up on /app/*, kick them to home + open login modal.
  // setCurrent is handleNav (App.jsx) which already pushes the route —
  // no need to double-push here.
  useEffect(() => {
    if (!auth.loading && !auth.user) {
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
    // setCurrent is handleNav from App.jsx, which itself calls
    // pushRoute. Calling pushRoute here too created TWO history
    // entries for one click — user had to press Back twice to
    // return. Removed the duplicate push; single source of truth
    // is handleNav.
    setCurrent && setCurrent(p);
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
        <TopBar page={page} lang={lang} setLang={setLang} tier={tier} />
        {/* AI beta banner is no longer mounted globally — it lives only
            on AI surfaces (ChatAssistant page + FloatingChat panel) so
            it doesn't yell at users on Dashboard / Reports / Pivot
            where there's no AI activity to disclose. */}

        {/* Content area. key={page} makes the fade animation replay on nav,
            but hook state (useProjects etc) survives remount via module-
            level cache — so we don't see the "zeros flash". Wrapped in
            ErrorBoundary so a render crash in any sub-page shows a
            readable error panel instead of a black screen. */}
        <div style={{ flex: 1 }} key={page} className="page-transition">
          <PlatformErrorBoundary lang={lang}>
            <PageContent
              page={page}
              projectId={projectId}
              lang={lang}
              setCurrent={navigate}
              openLogin={openLogin}
            />
          </PlatformErrorBoundary>
        </div>
      </div>

      <style>{`
        /* Content-area left edge (= sidebar width on desktop, 0 on mobile).
           Exposed as a CSS var so body-portaled overlays — e.g. the Analytics
           and Reports drill-down modals — can center over the CONTENT area
           instead of the whole viewport. Without it a fixed-width modal centred
           in the viewport sits ~14px from the sidebar with a big gap on the far
           side, where the dimmed page bleeds through (looks broken at wide widths). */
        :root { --platform-content-left: ${SIDEBAR_W}px; }
        @media (max-width: 840px) {
          :root { --platform-content-left: 0px; }
          .platform-sidebar { transform: translateX(-100%); transition: transform 0.25s ease; }
          .platform-sidebar.is-open { transform: translateX(0); }
          .platform-main { margin-left: 0 !important; }
          .platform-hamburger { display: inline-block !important; }
        }

        /* Preview mode for Gated pages (free users on Analytics /
           Reports / Exports). Approach: the wrapper stays sharp so
           section titles, column headers, sidebar and the upgrade
           banner are perfectly readable. Only concrete DATA VALUES
           are blurred so the user understands "what the feature
           shows" without getting the actual numbers. Selectors
           aren't perfect (no JSX-level class annotations exist yet)
           but cover the 95 % case:

             · svg (every chart body — histograms, scatters, pivot
               bar chart, heat maps)
             · table td with monospace font (numeric cells)
             · KPI-card value elements (identified by the large
               monospace font inline style)
             · elements with explicit .preview-blur class for any
               future fine-grained marking

           Headings (h1/h2/h3), th cells, select boxes, pivot chip
           labels, picker rows, section labels, and plain prose stay
           sharp — the user still reads structure + context.
         */
        .platform-preview-content { position: relative; }
        .platform-preview-content svg,
        .platform-preview-content td[style*="font-family"],
        .platform-preview-content td[style*="fontFamily"],
        .platform-preview-content [data-preview-blur],
        .platform-preview-content .preview-blur {
          filter: blur(5px) saturate(0.7);
          user-select: none;
          pointer-events: none;
        }
        /* Interactive chrome INSIDE the blurred wrapper must stay
           usable (pivot builder drags, filter toggles). Re-assert
           pointer-events on the outer control surfaces we want to
           keep clickable even in preview. */
        .platform-preview-content button,
        .platform-preview-content select,
        .platform-preview-content input,
        .platform-preview-content [role="button"] {
          pointer-events: auto;
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
function TopBar({ page, lang, setLang, tier }) {
  const titles = {
    "App:Dashboard": { en: "Dashboard",       sk: "Dashboard"    },
    "App:Projects":  { en: "Projects",        sk: "Projekty"     },
    "App:Analytics":    { en: "Analytics",     sk: "Analytika"    },
    "App:UnitTimeline": { en: "Unit timeline", sk: "Byt v čase"   },
    "App:Reports":      { en: "Reports",       sk: "Reporty"      },
    "App:Assistant": { en: "AI Assistant",    sk: "AI asistent"  },
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

      <div style={{ display: "inline-flex", alignItems: "center", gap: "0.6rem" }}>
        {/* Market (SK / CZ / All) + currency (native / €) switchers. The platform
            defaults to All; both read the shared context so a change here flows to
            every screen. CountrySwitcher self-hides when only one market exists. */}
        <CountrySwitcher lang={lang} />
        <CurrencySwitcher lang={lang} />
        {/* Language switcher — EN / SK pills. Same state that powers the
            marketing Nav switcher, so toggling here or on /live flips
            every SK/EN check-expression across the app consistently. */}
        {setLang && (
          <div style={{
            display: "inline-flex", alignItems: "center",
            border: `1px solid ${border}`, borderRadius: 8, padding: 2,
            background: "#0e0e10",
          }}>
            {["en", "sk"].map(code => {
              const active = lang === code;
              return (
                <button
                  key={code}
                  onClick={() => { if (lang !== code) { try { track("language_switched", { from: lang, to: code, surface: "platform" }); } catch (_) {} setLang(code); } }}
                  style={{
                    background: active ? "rgba(0,229,160,0.12)" : "transparent",
                    color: active ? green : dim,
                    border: "none",
                    padding: "0.35rem 0.65rem",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontFamily: mono,
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.color = textLight; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.color = dim; }}
                  title={code === "en" ? "English" : "Slovenčina"}
                >
                  {code.toUpperCase()}
                </button>
              );
            })}
          </div>
        )}

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
      </div>

      <style>{`
        @media (min-width: 841px) {
          .platform-topbar-inner { padding-left: 0 !important; }
        }
      `}</style>
    </header>
  );
}

/**
 * ErrorBoundary — catches a render-time exception in the platform
 * content area and shows a human-readable panel instead of a black
 * screen. Without this, an uncaught exception in any subtree (e.g.
 * a bad row from the DB, a stale cached value after a sync) unmounts
 * the tree silently and leaves the sidebar + an empty dark page.
 *
 * Reload button fully reloads the SPA — clears module-level caches,
 * re-reads auth, usually recovers. The explicit "go back to /" link
 * is a safety net in case something in /app/* is consistently broken.
 */
class PlatformErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    console.error("[PlatformErrorBoundary]", err, info);
    try { track && track("platform_crash", { message: String(err?.message || err).slice(0, 200) }); } catch (_) {}
  }
  render() {
    if (!this.state.err) return this.props.children;
    const msg = String(this.state.err?.message || this.state.err || "Unknown error");
    return (
      <div style={{ padding: "3rem 2rem", maxWidth: 680, margin: "0 auto", color: "#e8e8ed" }}>
        <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>⚠️</div>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginTop: 0, marginBottom: "0.6rem" }}>
          {this.props.lang === "sk" ? "Niečo sa pokazilo pri vykreslení tejto stránky" : "Something broke while rendering this page"}
        </h2>
        <p style={{ color: "#8a8a96", fontSize: "0.9rem", lineHeight: 1.6, marginBottom: "1rem" }}>
          {this.props.lang === "sk"
            ? "Pošli nám prosím screenshot a nápis nižšie — opravíme to. Medzitým skús obnoviť stránku, zväčša to stačí."
            : "Please send us a screenshot of the text below — we'll fix it. A reload usually helps in the meantime."}
        </p>
        <pre style={{ background: "#0e0e10", border: "1px solid #222228", borderRadius: 6, padding: "0.75rem 1rem", fontFamily: "'JetBrains Mono', monospace", fontSize: "0.75rem", color: "#ff9aa2", overflowX: "auto" }}>
{msg}
        </pre>
        <div style={{ display: "flex", gap: "0.6rem", marginTop: "1rem", flexWrap: "wrap" }}>
          <button onClick={() => window.location.reload()} className="btn-p" style={{ fontSize: "0.82rem" }}>
            {this.props.lang === "sk" ? "Obnoviť stránku" : "Reload page"}
          </button>
          <button onClick={() => window.location.assign("/")} className="btn-s" style={{ fontSize: "0.82rem" }}>
            {this.props.lang === "sk" ? "Domov" : "Home"}
          </button>
        </div>
      </div>
    );
  }
}

// ─── Page router ────────────────────────────────────────────────
function PageContent({ page, projectId, lang, setCurrent, openLogin }) {
  // Gated pages with an UpgradeCard fallback for users who lack the capability.
  if (page === "App:Dashboard")  return <PlatformDashboard lang={lang} setCurrent={setCurrent} />;
  if (page === "App:Projects")   return <PlatformProjects lang={lang} setCurrent={setCurrent} openLogin={openLogin} />;
  if (page === "App:Analytics")  return <Gated require="view_analytics"       lang={lang} setCurrent={setCurrent}><LiveAnalytics lang={lang} setCurrent={setCurrent} openLogin={openLogin} /></Gated>;
  if (page === "App:UnitTimeline") return <Gated require="view_analytics"     lang={lang} setCurrent={setCurrent}><UnitTracker lang={lang} setCurrent={setCurrent} /></Gated>;
  if (page === "App:Reports")    return <Gated require="view_monthly_reports" lang={lang} setCurrent={setCurrent}><ReportsPage lang={lang} /></Gated>;
  if (page === "App:Assistant")  return <ChatAssistant lang={lang} setCurrent={setCurrent} />;
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
// Previous behaviour: if the caller didn't have the capability we
// replaced the page with a plain UpgradeCard — structure invisible,
// paid-tier experience a mystery. User feedback: "nech uvidia
// strukturu celu a vsetky typy dat, len realne data budu rozmazane
// ako to mame na live". So: render the real page blurred, overlay
// a compelling upgrade CTA on top. Same marketing pattern we use for
// anonymous users on /live — "this is what you're paying for".
//
// The real page IS mounted and fetching data (RLS still scopes what
// the user can see — a free user only gets their chosen_project_id
// flats, paid gets everything). Blur is presentational; there's no
// leak of paid-tier rows because the client simply doesn't receive
// them. Pointer-events:none on the blurred layer stops accidental
// clicks; `inert` hides it from keyboard tab-order and screen readers.
function Gated({ require, children, lang, setCurrent }) {
  const { can, tier } = useCapabilities();
  if (can(require)) return children;
  return (
    <div className="platform-preview-root">
      <UpgradeOverlay lang={lang} requiredFor={require} currentTier={tier} setCurrent={setCurrent} />
      <div
        className="platform-preview-content"
        aria-label={lang === "sk" ? "Ukážka — dáta sú rozmazané, upgrade-ni pre prístup" : "Preview — data is blurred, upgrade to access"}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Slim horizontal banner at the top of the preview content — always
 * visible when the page loads, scrolls naturally with the rest (not
 * sticky / floating so it doesn't cover chart titles the user is
 * trying to read as a "preview"). The previous floating sticky card
 * overlapped and obscured the content users were supposed to be
 * seeing as preview.
 */
function UpgradeOverlay({ lang, requiredFor, currentTier, setCurrent }) {
  const featureMeta = {
    view_analytics: {
      title:  lang === "sk" ? "Analytika a trendy" : "Analytics & trends",
      sub:    lang === "sk"
        ? "Toto je ukážka paid sekcie. Pivot cez všetky byty, rebríčky okresov a developerov, rýchlosť predaja za posledný mesiac — odomkni reálne čísla upgradom."
        : "This is a preview of the paid section. Pivot across every unit, district & developer leaderboards, 30-day sales velocity — upgrade to see the real numbers.",
    },
    view_monthly_reports: {
      title:  lang === "sk" ? "Mesačné reporty" : "Monthly reports",
      sub:    lang === "sk"
        ? "Toto je ukážka paid reportov. PDF / CSV na každý scope — trh, mesto, časť mesta, projekt, developer — s historickým trendom. Upgrade-ni pre plný prístup."
        : "Preview of the paid reports. PDF / CSV for every scope — market, city, district, project, developer — with historical trend. Upgrade for full access.",
    },
    export_data: {
      title:  lang === "sk" ? "Exporty CSV / API" : "CSV / API exports",
      sub:    lang === "sk"
        ? "Stiahni celý dataset alebo ťahaj priamo cez REST API. Upgrade-ni pre prístup."
        : "Download the full dataset or pull via REST API. Upgrade for access.",
    },
    manage_users: {
      title: "Admin",
      sub: lang === "sk" ? "Administrátorská sekcia." : "Admin section.",
    },
  }[requiredFor] || { title: requiredFor, sub: "" };

  return (
    <div style={{
      margin: "1rem 1.5rem 1.25rem",
      background: "linear-gradient(90deg, rgba(0,229,160,0.07) 0%, rgba(0,229,160,0.02) 60%, transparent 100%)",
      border: `1px solid rgba(0,229,160,0.28)`,
      borderRadius: 10,
      padding: "0.85rem 1.1rem",
      display: "flex", alignItems: "center", gap: "0.85rem",
      flexWrap: "wrap",
    }}>
      <div style={{
        flexShrink: 0,
        width: 30, height: 30, borderRadius: 7,
        background: "rgba(0,229,160,0.15)", color: green,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.9rem",
      }}>🔒</div>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "0.55rem", flexWrap: "wrap" }}>
          <span style={{ fontFamily: mono, fontSize: "0.58rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700 }}>
            {lang === "sk" ? "Ukážka" : "Preview"}
          </span>
          <span style={{ color: textLight, fontWeight: 700, fontSize: "0.94rem", letterSpacing: "-0.01em" }}>
            {featureMeta.title}
          </span>
          <span style={{ fontFamily: mono, fontSize: "0.62rem", color: dim }}>
            {lang === "sk"
              ? <>tier <span style={{ color: textLight }}>{currentTier}</span></>
              : <>tier <span style={{ color: textLight }}>{currentTier}</span></>}
          </span>
        </div>
        <div style={{ color: "#c0c0c8", fontSize: "0.8rem", lineHeight: 1.45, marginTop: "0.2rem" }}>
          {featureMeta.sub}
        </div>
      </div>
      <button
        onClick={() => setCurrent && setCurrent("App:Billing")}
        style={{
          flexShrink: 0,
          background: green, color: "#0a0a0c",
          border: "none", borderRadius: 7,
          padding: "0.55rem 1.1rem",
          fontWeight: 700, fontFamily: mono, fontSize: "0.78rem",
          cursor: "pointer",
          transition: "transform 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 18px rgba(0,229,160,0.3)"; }}
        onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "none"; }}
      >
        {lang === "sk" ? "Upgrade → paid" : "Upgrade → paid"}
      </button>
    </div>
  );
}

/**
 * TrialOfferBanner — shown on Dashboard for free users who have
 * never started their 7-day trial. Non-blocking, dismissible-feel
 * gift framing (not desperate upsell). Opens Billing where the
 * actual "Start trial" button lives.
 */
function TrialOfferBanner({ lang, onOpenBilling }) {
  return (
    <div style={{
      background: "linear-gradient(90deg, rgba(0,229,160,0.14) 0%, rgba(0,229,160,0.04) 70%, transparent 100%)",
      border: `1px solid ${green}`,
      borderRadius: 12,
      padding: "0.95rem 1.2rem",
      marginBottom: "1.5rem",
      display: "flex", alignItems: "center", gap: "0.95rem", flexWrap: "wrap",
    }}>
      <div style={{
        flexShrink: 0,
        width: 34, height: 34, borderRadius: 8,
        background: "rgba(0,229,160,0.18)", color: green,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "1.05rem",
      }}>🎁</div>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ color: textLight, fontWeight: 700, fontSize: "0.95rem", letterSpacing: "-0.01em" }}>
          {lang === "sk" ? "7 dní plného Residata — zadarmo" : "7 days of the full Residata — on us"}
        </div>
        <div style={{ color: dim, fontSize: "0.8rem", marginTop: "0.15rem", lineHeight: 1.45 }}>
          {lang === "sk"
            ? "Všetky projekty, analytika, reporty, exporty. Bez karty. Aktivuješ si ho jedným klikom."
            : "Every project, analytics, reports, exports. No card required. One-click activation."}
        </div>
      </div>
      <button onClick={onOpenBilling} className="btn-p" style={{ fontSize: "0.82rem" }}>
        {lang === "sk" ? "Aktivovať trial" : "Activate trial"}
      </button>
    </div>
  );
}

/**
 * TrialRunningBanner — shown on Dashboard while the trial is active.
 * Displays the remaining days in green when >2 days left, amber when
 * the trial is ending. Click routes to Billing for upgrade/details.
 */
function TrialRunningBanner({ lang, daysLeft, onOpenBilling }) {
  const ending = daysLeft <= 2;
  const accent = ending ? "#f5a623" : green;
  const bgTint = ending ? "rgba(245,166,35,0.12)" : "rgba(0,229,160,0.12)";
  return (
    <div style={{
      background: bgTint,
      border: `1px solid ${accent}60`,
      borderRadius: 12,
      padding: "0.8rem 1.1rem",
      marginBottom: "1.5rem",
      display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap",
      fontSize: "0.85rem",
    }}>
      <span style={{ fontSize: "1.05rem" }}>🎁</span>
      <span style={{ color: textLight, fontWeight: 600 }}>
        {lang === "sk"
          ? <>Paid trial aktívny — <span style={{ color: accent }}>{daysLeft === 1 ? "posledný deň" : `${daysLeft} dní zostáva`}</span></>
          : <>Paid trial active — <span style={{ color: accent }}>{daysLeft === 1 ? "last day" : `${daysLeft} days left`}</span></>}
      </span>
      <span style={{ marginLeft: "auto", display: "inline-flex", gap: "0.55rem", alignItems: "center" }}>
        <span style={{ color: dim, fontSize: "0.78rem", fontFamily: mono }}>
          {lang === "sk" ? "žiadne strhávanie" : "no auto-charge"}
        </span>
        <button onClick={onOpenBilling}
          style={{
            background: "transparent", color: accent, border: `1px solid ${accent}`,
            borderRadius: 6, padding: "0.35rem 0.8rem",
            fontSize: "0.75rem", fontFamily: mono, fontWeight: 700, cursor: "pointer",
          }}>
          {lang === "sk" ? "Detail / upgrade" : "Details / upgrade"}
        </button>
      </span>
    </div>
  );
}

// ─── Dashboard page ─────────────────────────────────────────────
function PlatformDashboard({ lang, setCurrent }) {
  useCurrency(); // subscribe: re-render KPIs + highlights when currency toggles
  const { profile, tier } = useAuth();
  const caps = useCapabilities();
  const { can, baseTier, trialActive, trialDaysLeft } = caps;
  const { projects } = useProjects();
  const marketTotals = useMarketTotals();
  // F-026: gate on effective tier (caps.tier), not raw baseTier. Admin-granted
  // paid users have baseTier='free' but caps.tier='paid' — the old check
  // pitched a 7-day trial to people who already have permanent paid access.
  const showTrialOffer = caps.tier === "free" && !trialActive && !profile?.trial_started_at;

  // All headline KPIs read from the live `market_totals` view (same
  // source the homepage Ticker, MarketPulse, and /live/analytics use).
  // Single source of truth — every page on the platform shows the same
  // numbers as the public marketing surfaces, no chance of drift.
  //
  // sold30 stays project-derived because the per-month sold delta is a
  // per-project field computed by sync from stav transitions — not
  // derivable from the current snapshot alone.
  const totals = {
    units:  marketTotals.unitsTracked   ?? 0,
    avail:  marketTotals.unitsAvailable ?? 0,
    sold:   marketTotals.unitsSold      ?? 0,
    sold30: marketTotals.soldLastMonth  ?? 0,
  };
  const avgEurM2 = marketTotals.avgPriceM2 != null
    ? Math.round(marketTotals.avgPriceM2)
    : null;

  // Top 5 most active projects — filter to status='active' so paused/
  // sold_out projects with stale "available" don't pollute the ranking.
  const top = projects
    .filter(p => (p.status || "active") === "active")
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
      <p style={{ color: dim, fontSize: "0.95rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>
        {/* Posledný sync mesiac z market_totals view (MAX snapshot_month
            v archíve). Predtým tam bolo new Date() = dnes — mätúce, lebo
            user vidí "posledný beh: dnes" aj keď sync bežal pred týždňom. */}
        {lang === "sk"
          ? <>Toto je tvoj Residata dashboard. Nižšie je aktuálny stav trhu — data refresh každý mesiac, posledný beh pipeline za mesiac <strong style={{ color: textLight }}>{marketTotals.snapshotMonth || "—"}</strong>.</>
          : <>This is your Residata dashboard. Current market state below — data refreshes monthly, last pipeline run for month <strong style={{ color: textLight }}>{marketTotals.snapshotMonth || "—"}</strong>.</>}
      </p>

      {/* Trial CTA banner — appears for free users who haven't yet
          used their 7-day trial. Once started, banner flips to a
          running countdown ("trial day 3 of 7"). Once expired or
          used, banner disappears entirely. */}
      {showTrialOffer && (
        <TrialOfferBanner lang={lang} onOpenBilling={() => setCurrent("App:Billing")} />
      )}
      {trialActive && (
        <TrialRunningBanner lang={lang} daysLeft={trialDaysLeft} onOpenBilling={() => setCurrent("App:Billing")} />
      )}

      {/* KPI strip — every number reads from market_totals (live view).
          "V databáze" = projects with archive data (active + sold-out under
          tracking, monotonically growing). Subtitle shows the active subset
          — the count of projects currently in the market. When equal we
          omit the subtitle to keep the card clean. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.85rem", marginBottom: "2rem" }}>
        <KpiCard
          label={lang === "sk" ? "V databáze" : "In dataset"}
          value={(marketTotals.projectsTracked ?? marketTotals.projectsActive ?? 0).toLocaleString(lang === "sk" ? "sk-SK" : "en-US")}
          subtitle={(marketTotals.projectsTracked ?? 0) > (marketTotals.projectsActive ?? 0)
            ? (lang === "sk"
                ? `${(marketTotals.projectsActive ?? 0).toLocaleString("sk-SK")} aktívne v predaji`
                : `${(marketTotals.projectsActive ?? 0).toLocaleString("en-US")} active in market`)
            : (lang === "sk" ? "všetky aktívne v predaji" : "all active in market")}
        />
        <KpiCard label={lang === "sk" ? "Voľné byty" : "Available units"} value={totals.avail.toLocaleString(lang === "sk" ? "sk-SK" : "en-US")} accent={green} />
        <KpiCard label={lang === "sk" ? "Predané (30 dní)" : "Sold (30 days)"} value={totals.sold30 ? `+${totals.sold30}` : "—"} accent="#f5a623"
          locked={!can("view_sold_velocity")} />
        <KpiCard label={lang === "sk" ? `Priem. ${moneySymbol()}/m²` : `Avg ${moneySymbol()}/m²`} value={avgEurM2 ? Math.round(moneyFromEur(avgEurM2)).toLocaleString(lang === "sk" ? "sk-SK" : "en-US") : "—"} />
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
                {p.avg_price_eur_m2 && <span><span style={{ color: textLight, fontFamily: mono, fontWeight: 600 }}>{Math.round(moneyFromEur(p.avg_price_eur_m2)).toLocaleString("en-US").replace(/,/g, " ")}</span> <span style={{ color: dim }}>{moneySymbol()}/m²</span></span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, subtitle = null, accent = textLight, locked = false }) {
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
      {subtitle && (
        <div style={{
          fontFamily: mono, fontSize: "0.7rem", color: dim,
          marginTop: "0.4rem", letterSpacing: "0.02em",
        }}>{subtitle}</div>
      )}
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

  // Restrict to active projects so paused/sold_out ones don't surface
  // as "top seller" / "selling out" / "priciest" — their data is
  // last-known-stale and clicking the card would open a project the
  // user has stopped tracking. Manual projects (status='active',
  // is_manual=true) ARE included — they're alive market data.
  const activeProjects = projects.filter(p => (p.status || "active") === "active");

  const withVelocity = activeProjects.filter(p => (p.sold_last_month || 0) > 0);
  const topSeller = withVelocity.sort((a, b) => (b.sold_last_month || 0) - (a.sold_last_month || 0))[0];

  const soldOutSoon = activeProjects
    .filter(p => (p.sold_percentage || 0) >= 85 && (p.sold_percentage || 0) < 100 && (p.available_units || 0) > 0)
    .sort((a, b) => (b.sold_percentage || 0) - (a.sold_percentage || 0))[0];

  const priciest = activeProjects
    .filter(p => p.avg_price_eur_m2)
    .sort((a, b) => b.avg_price_eur_m2 - a.avg_price_eur_m2)[0];

  const cheapest = activeProjects
    .filter(p => p.avg_price_eur_m2 && p.available_units > 0)
    .sort((a, b) => a.avg_price_eur_m2 - b.avg_price_eur_m2)[0];

  const cards = [];
  if (topSeller) cards.push({
    tag: lang === "sk" ? "Top predajca (30d)" : "Top seller (30d)",
    title: topSeller.name,
    sub: `${topSeller.district || "—"} · ${topSeller.avg_price_eur_m2 ? Math.round(moneyFromEur(topSeller.avg_price_eur_m2)).toLocaleString("en-US").replace(/,/g, " ") + " " + moneySymbol() + "/m²" : "—"}`,
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
      tag: lang === "sk" ? `Najdrahší ${moneySymbol()}/m²` : `Priciest ${moneySymbol()}/m²`,
      title: priciest.name,
      sub: `${priciest.district || "—"}`,
      stat: Math.round(moneyFromEur(priciest.avg_price_eur_m2)).toLocaleString("en-US").replace(/,/g, " "),
      statSub: `${moneySymbol()}/m²`,
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
  const caps = useCapabilities();
  const { tier, baseTier, trialActive, trialDaysLeft, trialUntil,
          paidActive, paidPaused, paidWindowActive, paidDaysLeft, paidUntil, paidStartedAt } = caps;
  const { profile } = useAuth();

  // Display logic — the "effective" tier (badge shown) and the
  // "base" tier (raw column) can disagree:
  //   · base=free + trial active   → effective=paid, baseTier=free
  //   · base=paid + paid expired   → effective=free, baseTier=paid
  //   · base=paid + paused         → effective=free, baseTier=paid
  // We branch on the actual scenario, not just one of the labels.
  const isFree  = baseTier === "free";
  const isPaid  = baseTier === "paid";
  const isAdmin = baseTier === "admin";
  const paidExpired = isPaid && !paidActive && !paidPaused && paidUntil != null;
  const trialUsed = Boolean(profile?.trial_started_at);

  // fmtDate first (TDZ — const, not hoisted) so approvedAt can use it.
  const fmtDate = (ts) => ts ? new Date(ts).toLocaleDateString(lang === "sk" ? "sk-SK" : "en-US", { day: "numeric", month: "long", year: "numeric" }) : "—";
  const approvedAt = profile?.approved_at ? fmtDate(profile.approved_at) : null;

  const [trialBusy, setTrialBusy] = useState(false);
  const [trialMsg, setTrialMsg]   = useState(null);

  const startTrial = async () => {
    setTrialBusy(true); setTrialMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch("/api/trial/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: "{}",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setTrialMsg({ kind: "ok", text: lang === "sk" ? "Trial aktivovaný 🎉 Refresh stránku." : "Trial started 🎉 Refresh the page." });
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setTrialMsg({ kind: "err", text: String(e?.message || e) });
    } finally {
      setTrialBusy(false);
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 760 }}>
      {/* Current tier card */}
      <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: "1.75rem 2rem", marginBottom: "1.25rem" }}>
        <div style={{ fontFamily: mono, fontSize: "0.65rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.4rem" }}>
          {lang === "sk" ? "Tvoj aktuálny tier" : "Your current tier"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <TierBadgeSmall tier={tier} />
          <span style={{ fontSize: "1.35rem", fontWeight: 700, color: textLight, letterSpacing: "-0.02em" }}>
            {isFree && (trialActive ? (lang === "sk" ? "Free (trial: paid prístup)" : "Free (trial: paid access)") : (lang === "sk" ? "Free" : "Free"))}
            {isPaid && (lang === "sk" ? "Paid" : "Paid")}
            {isAdmin && "Admin"}
          </span>
          {trialActive && (
            <span style={{ fontSize: "0.75rem", color: green, fontFamily: mono, background: "rgba(0,229,160,0.12)", border: `1px solid ${green}`, borderRadius: 100, padding: "2px 10px" }}>
              🎁 {lang === "sk" ? `Trial · ${trialDaysLeft} dní zostáva` : `Trial · ${trialDaysLeft} days left`}
            </span>
          )}
          {approvedAt && <span style={{ fontSize: "0.75rem", color: dim, fontFamily: mono }}>
            {lang === "sk" ? "od" : "since"} {approvedAt}
          </span>}
        </div>
        <p style={{ color: "#c0c0c8", fontSize: "0.9rem", lineHeight: 1.65, margin: 0 }}>
          {trialActive && isFree && (lang === "sk"
            ? <>Máš počas trial-u plný paid prístup (analytika, reporty, exporty). Trial končí <strong style={{ color: textLight }}>{fmtDate(trialUntil)}</strong>. Bez karty — po skončení trial-u jednoducho padneš späť na free tier, nič ti nestrhneme.</>
            : <>You have full paid access during the trial (analytics, reports, exports). Trial ends <strong style={{ color: textLight }}>{fmtDate(trialUntil)}</strong>. No card required — when the trial ends you simply drop back to free, nothing is charged.</>)}
          {!trialActive && isFree && (lang === "sk"
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

      {/* 7-day free trial card — free users who haven't used the trial yet. */}
      {isFree && !trialUsed && (
        <div style={{
          background: "linear-gradient(135deg, rgba(0,229,160,0.14), rgba(0,229,160,0.03))",
          border: `1px solid ${green}`, borderRadius: 12, padding: "1.75rem 2rem", marginBottom: "1.25rem",
        }}>
          <div style={{ fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            🎁 {lang === "sk" ? "Darček pre teba" : "A gift for you"}
          </div>
          <h3 style={{ fontSize: "1.25rem", fontWeight: 700, color: textLight, margin: 0, marginBottom: "0.6rem", letterSpacing: "-0.01em" }}>
            {lang === "sk" ? "7 dní plného Residata — zadarmo" : "7 days of the full Residata — on us"}
          </h3>
          <p style={{ color: "#c0c0c8", fontSize: "0.9rem", lineHeight: 1.6, margin: "0 0 1rem" }}>
            {lang === "sk"
              ? <>Vyskúšaj Residata naplno týždeň. Všetky projekty, analytika, pivot, reporty, CSV + API exporty. <strong style={{ color: textLight }}>Bez karty, bez platby</strong> — kartu pýtame až keby si sa rozhodol pokračovať po trial-e.</>
              : <>Try the full Residata for a week. Every project, analytics, pivot, reports, CSV + API exports. <strong style={{ color: textLight }}>No card, no payment</strong> — we only ask for a card if you decide to continue after the trial.</>}
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={startTrial} disabled={trialBusy} className="btn-p" style={{ fontSize: "0.88rem" }}>
              {trialBusy ? "…" : (lang === "sk" ? "Spustiť 7-dňový trial" : "Start 7-day trial")}
            </button>
            <span style={{ fontSize: "0.72rem", color: dim, fontFamily: mono }}>
              {lang === "sk" ? "žiadna karta · žiadne strhávanie · jednorazovo" : "no card · no auto-charge · one-time"}
            </span>
          </div>
          {trialMsg && (
            <div style={{ marginTop: "0.6rem", fontSize: "0.82rem", color: trialMsg.kind === "ok" ? green : "#ff6b6b", fontFamily: mono }}>
              {trialMsg.text}
            </div>
          )}
        </div>
      )}

      {/* Upgrade CTA (free users — trial-ended OR still on trial).
          Pricing messaging highlights the welcome 50%-off-3-months
          gift to stay on-brand (founder offering value, not desperate
          for a sale). */}
      {isFree && (
        <div style={{
          background: "linear-gradient(135deg, rgba(0,229,160,0.08), rgba(0,229,160,0.02))",
          border: "1px solid rgba(0,229,160,0.3)", borderRadius: 12, padding: "1.75rem 2rem", marginBottom: "1.25rem",
        }}>
          <div style={{ fontFamily: mono, fontSize: "0.65rem", color: green, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            {lang === "sk" ? "Upgrade na paid" : "Upgrade to paid"}
          </div>
          <h3 style={{ fontSize: "1.2rem", fontWeight: 700, color: textLight, margin: 0, marginBottom: "0.4rem" }}>
            {lang === "sk" ? "Paid tier za €349 / mesiac" : "Paid tier · €349 / month"}
          </h3>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: "0.4rem",
            background: "rgba(245,166,35,0.14)", color: "#f5a623",
            border: "1px solid rgba(245,166,35,0.4)",
            fontFamily: mono, fontSize: "0.72rem", fontWeight: 700,
            padding: "4px 10px", borderRadius: 100,
            marginBottom: "0.85rem",
          }}>
            🎁 {lang === "sk" ? "Welcome gift · prvé 3 mesiace -50 %" : "Welcome gift · first 3 months 50% off"}
          </div>
          <ul style={{ color: "#c0c0c8", fontSize: "0.88rem", lineHeight: 1.7, paddingLeft: "1.1rem", margin: "0.2rem 0 1.25rem" }}>
            <li>{lang === "sk" ? "Plný detail každého aktívneho projektu" : "Full detail of every active project"}</li>
            <li>{lang === "sk" ? "Analytika, trendy, heat mapy" : "Analytics, trends, district heat maps"}</li>
            <li>{lang === "sk" ? "Mesačné PDF reporty" : "Monthly PDF reports"}</li>
            <li>{lang === "sk" ? "CSV exporty + REST API" : "CSV exports + REST API"}</li>
            <li>{lang === "sk" ? "AI asistent · 30 otázok / deň" : "AI assistant · 30 questions / day"}</li>
          </ul>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <a href="tel:+421911963909" className="btn-p">📞 +421 911 963 909</a>
            <a href="mailto:residata@proton.me?subject=Upgrade%20to%20paid" className="btn-s">✉️ residata@proton.me</a>
          </div>
          <p style={{ fontSize: "0.72rem", color: dim, marginTop: "1rem", fontFamily: mono }}>
            {lang === "sk"
              ? "Žiadne kreditky na webe. 5-min hovor, dohodneme sa, prístup máš hneď."
              : "No credit-card checkout. 5-min call, we agree, you're paid immediately."}
          </p>
        </div>
      )}

      {/* Paid subscription card — countdown + manage */}
      {isPaid && (paidActive || paidPaused) && (
        <SubscriptionCard
          lang={lang}
          paused={paidPaused}
          paidWindowActive={paidWindowActive}
          paidUntil={paidUntil}
          paidStartedAt={paidStartedAt}
          paidDaysLeft={paidDaysLeft}
          fmtDate={fmtDate}
        />
      )}

      {/* Paid expired — show resubscribe CTA prominently. */}
      {isPaid && paidExpired && (
        <div style={{
          background: "linear-gradient(135deg, rgba(245,166,35,0.1), rgba(245,166,35,0.02))",
          border: "1px solid rgba(245,166,35,0.4)", borderRadius: 12, padding: "1.75rem 2rem", marginBottom: "1.25rem",
        }}>
          <div style={{ fontFamily: mono, fontSize: "0.65rem", color: "#f5a623", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: "0.5rem", fontWeight: 700 }}>
            ⚠ {lang === "sk" ? "Predplatné vypršalo" : "Subscription expired"}
          </div>
          <h3 style={{ fontSize: "1.2rem", fontWeight: 700, color: textLight, margin: "0 0 0.5rem" }}>
            {lang === "sk" ? `Skončilo ${fmtDate(paidUntil)}` : `Ended on ${fmtDate(paidUntil)}`}
          </h3>
          <p style={{ color: "#c0c0c8", fontSize: "0.9rem", lineHeight: 1.6, margin: "0 0 1rem" }}>
            {lang === "sk"
              ? "Tvoj prístup teraz funguje na free úrovni. Môžeš pokračovať v paid prístupe — kontaktuj nás a obnovíme ti predplatné."
              : "Your access is now at the free tier. You can resume paid access — contact us and we'll renew immediately."}
          </p>
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            <a href="tel:+421911963909" className="btn-p">📞 +421 911 963 909</a>
            <a href="mailto:residata@proton.me?subject=Resubscribe" className="btn-s">✉️ {lang === "sk" ? "Obnoviť predplatné" : "Resubscribe"}</a>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Vercel/Linear-style subscription card. Top stripe shows the
 * status pill + countdown number; below it a row of meta dates
 * (started / renews) with a Manage button. Pause-state branch
 * inverts the colour scheme to amber so the user can't miss it.
 */
function SubscriptionCard({ lang, paused, paidWindowActive, paidUntil, paidStartedAt, paidDaysLeft, fmtDate }) {
  const accent = paused ? "#f5a623" : green;
  const pillBg = paused ? "rgba(245,166,35,0.12)" : "rgba(0,229,160,0.12)";
  const status = paused
    ? (lang === "sk" ? "Pozastavené" : "Paused")
    : paidWindowActive
      ? (lang === "sk" ? "Aktívne" : "Active")
      : (lang === "sk" ? "Aktívne (bez expirácie)" : "Active (no expiry)");
  const showCountdown = !paused && paidDaysLeft != null;

  return (
    <div style={{
      background: bg, border: `1px solid ${border}`, borderRadius: 12,
      padding: "1.5rem 1.75rem", marginBottom: "1.25rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "1.1rem", flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: "0.65rem", color: dim, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "0.4rem" }}>
            {lang === "sk" ? "Predplatné" : "Subscription"}
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem" }}>
            <span style={{
              fontFamily: mono, fontSize: "0.68rem", fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase",
              color: accent, background: pillBg,
              border: `1px solid ${accent}55`,
              borderRadius: 100, padding: "3px 10px",
            }}>
              {paused ? "⏸" : "●"} {status}
            </span>
            {showCountdown && (
              <span style={{ color: textLight, fontWeight: 700, fontSize: "1rem", letterSpacing: "-0.01em" }}>
                {paidDaysLeft === 1
                  ? (lang === "sk" ? "Posledný deň" : "Last day")
                  : (lang === "sk" ? `${paidDaysLeft} dní zostáva` : `${paidDaysLeft} days remaining`)}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <a href="mailto:residata@proton.me?subject=Subscription" className="btn-s" style={{ fontSize: "0.78rem" }}>
            {lang === "sk" ? "Spravovať" : "Manage"}
          </a>
        </div>
      </div>

      {/* Meta row — started + renewal dates, like a Stripe receipt. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.75rem", borderTop: `1px solid ${border}`, paddingTop: "1rem" }}>
        <div>
          <div style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.25rem" }}>
            {lang === "sk" ? "Začalo" : "Started"}
          </div>
          <div style={{ color: textLight, fontSize: "0.92rem", fontWeight: 600 }}>
            {fmtDate(paidStartedAt)}
          </div>
        </div>
        {paidUntil && (
          <div>
            <div style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.25rem" }}>
              {paused ? (lang === "sk" ? "Bolo do" : "Was until") : (lang === "sk" ? "Obnovenie" : "Renews")}
            </div>
            <div style={{ color: textLight, fontSize: "0.92rem", fontWeight: 600 }}>
              {fmtDate(paidUntil)}
            </div>
          </div>
        )}
        <div>
          <div style={{ fontFamily: mono, fontSize: "0.6rem", color: dim, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "0.25rem" }}>
            {lang === "sk" ? "Spôsob platby" : "Billing"}
          </div>
          <div style={{ color: "#c0c0c8", fontSize: "0.86rem" }}>
            {lang === "sk" ? "Manuálna fakturácia" : "Manual invoicing"}
          </div>
        </div>
      </div>

      {paused && (
        <div style={{
          marginTop: "1rem", padding: "0.65rem 0.9rem",
          background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.3)",
          borderRadius: 8, fontSize: "0.82rem", color: textLight,
        }}>
          ⏸ {lang === "sk"
            ? "Tvoje predplatné je pozastavené adminom. Kontaktuj nás pre obnovu."
            : "Your subscription is paused by admin. Contact us to resume."}
        </div>
      )}

      <p style={{ color: dim, fontSize: "0.78rem", lineHeight: 1.55, margin: "1rem 0 0", fontFamily: mono }}>
        {lang === "sk"
          ? <>Faktúry, zmena obdobia, zrušenie — napíš na <a href="mailto:residata@proton.me" style={{ color: green }}>residata@proton.me</a>.</>
          : <>Invoices, period changes, cancellation — email <a href="mailto:residata@proton.me" style={{ color: green }}>residata@proton.me</a>.</>}
      </p>
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
    // F-106: route through sanitize layer the same way CompleteProfile does.
    // Plain .trim() let users plant `<img onerror=…>` etc. via Settings,
    // bypassing the intake-clean discipline. cleanText strips HTML tag chars
    // + CSV-formula triggers, cleanUrl rejects non-http(s) schemes,
    // cleanPhone keeps only digit-shaped characters.
    const { data, error } = await supabase.from("user_profiles").update({
      full_name: cleanText(form.full_name, { max: 120 }) || null,
      company: cleanText(form.company, { max: 120 }) || null,
      position: cleanText(form.position, { max: 60 }) || null,
      linkedin_url: cleanUrl(form.linkedin_url, { max: 500 }) || null,
      phone: cleanPhone(form.phone, { max: 32 }) || null,
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

  // F-222: if the user's stored position isn't in the predefined dropdown
  // (e.g. legacy free-text like "Founder" or "CEO" from an earlier signup
  // flow), inject it as an extra option so the value is preserved across
  // saves. Without this, clicking the dropdown and picking any predefined
  // value silently overwrote their custom string. Boss's account has
  // `position='Founder'` — caught live during DP-071.
  const knownPositionValues = new Set(positions.map(p => p.v));
  const positionsRendered = form.position && !knownPositionValues.has(form.position)
    ? [
        positions[0],
        { v: form.position, label: form.position },
        ...positions.slice(1),
      ]
    : positions;

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
              {positionsRendered.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
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

      {/* Read-only meta. F-227: also show position so users can verify
          what the form is operating on (especially helpful for legacy
          values surfaced via F-222 fix). */}
      <div style={{ marginTop: "1.25rem", padding: "1rem 1.25rem", background: bg2, border: `1px solid ${border}`, borderRadius: 10, fontSize: "0.78rem", color: dim, fontFamily: mono, lineHeight: 1.7 }}>
        <div>user_id: {user?.id}</div>
        {profile?.created_at && <div>created: {new Date(profile.created_at).toLocaleString(lang === "sk" ? "sk-SK" : "en-US", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Bratislava" })}</div>}
        <div>tier: {profile?.tier || "—"}</div>
        <div>position: {profile?.position || "—"}</div>
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
// F-089 (Boss 2026-05-31, option b): paginated streaming CSV builder.
// Previously the flats export hard-capped at .limit(10000) — silently dropped
// rows above the cap. Now we page through Supabase REST using .range(start,
// end) in PAGE_SIZE batches, building CSV chunks as we go. No upper cap on
// total rows; sk-ba is ~16.7k current and grows monthly.
//
// PAGE SIZE = 1000. PostgREST on flats_current caps each request at 1000
// rows (visible in existing useData.js:461 which uses the same value).
// Asking for more (we tried 5000 first) just gets capped silently, which
// fooled the "got fewer rows than requested → done" exit and truncated
// the export at ~1000 rows. Live Boss test 2026-05-31 night caught this.
// 17 pages × 1000 rows is still fast enough; round-trip cost dominated by
// per-request overhead, not per-row.
//
// Why client-side and not a Vercel API streaming route: the existing pattern
// is browser-side (RLS already filters paid-tier rows for the user; nothing
// leaves the user's machine). Switching to server-side would require a new
// API endpoint + Vercel function memory tuning. Client-side paging is the
// minimal change that solves the truncation without changing the data path.
//
// ─── T-001 + T-002 (Boss live test 2026-05-31 night, post-F-089 ship) ───
// Boss opened the CSV and called the formatting "shit" — two problems:
//   T-001  cell formatting was raw DB strings — NUMERIC(12,2) came as
//          "339500.00" (Excel parses but with the trailing zeros), dates
//          came as ISO strings with timezone offsets, decimals locale-
//          inconsistent.
//   T-002  the export had `project_id` (slug like "stockerka") but no
//          human-readable project name, developer, district, or city —
//          a non-technical reader couldn't tell which row was which.
//
// Fix: explicit per-column formatting + client-side join with the projects
// data already loaded by useProjects(). Identity columns get front-loaded
// so a glance at the leftmost cells tells you what the row is. The
// internal `id` ROW_NUMBER column gets dropped (no business meaning, just
// adds noise).
//
// Tradeoff (explicit column list vs. Object.keys): if a new column lands
// in flats_current, it won't appear in the CSV until added here. That's
// deliberate — schema changes should be reviewed, not silently exported.
const CSV_PAGE_SIZE = 1000;

// Explicit column order for the flats CSV. Identity + enrichment up
// front (so you can read the row's meaning without scrolling right),
// then snapshot metadata, then per-unit fields in roughly DB-view order,
// then financing + audit at the end.
const FLATS_CSV_COLUMNS = [
  // Enrichment from projects (joined client-side from useProjects)
  "project_name", "developer", "district", "city",
  // Identity
  "project_id", "unit_id",
  // Snapshot context
  "snapshot_month", "batch_id", "batch_timestamp",
  // Unit metadata
  "typ", "etapa", "budova", "unit_detail", "poschodie",
  // Area (sq m)
  "izby", "obytna_plocha", "balkon_plocha", "loggia_plocha",
  "terasa_plocha", "zahrada_plocha", "exterier_plocha",
  "kobka_plocha", "celkova_plocha",
  // Pricing
  "cena_bez_dph", "cena_s_dph", "cena_s_dph_text", "cennikova_cena",
  // Status
  "stav", "kolaudacia", "orientacia",
  // Country
  "country", "currency",
  // Financing (NUMERIC(12,2) per migrations/2026-05-26_init_snapshot_model.sql)
  "fin_10_90", "fin_20_80", "fin_30_40_30",
  // Audit
  "created_at",
];

// Columns that should be re-emitted as plain numbers (no thousands sep,
// `.` as decimal, no trailing zeros). PostgREST returns NUMERIC as
// strings — leaving them as "339500.00" works in Excel but looks noisy;
// stripping the trailing zeros produces a clean "339500" / "48.61".
const FLATS_NUMBER_COLUMNS = new Set([
  "izby", "poschodie",
  "obytna_plocha", "balkon_plocha", "loggia_plocha", "terasa_plocha",
  "zahrada_plocha", "exterier_plocha", "kobka_plocha", "celkova_plocha",
  "cena_bez_dph", "cena_s_dph", "cennikova_cena",
  "fin_10_90", "fin_20_80", "fin_30_40_30",
]);

// Columns that come as ISO timestamps. Re-render in UTC as
// "YYYY-MM-DD HH:MM:SS" — Excel autodetects this as a date column,
// and the space separator (vs. T) reads naturally.
const FLATS_DATE_COLUMNS = new Set(["batch_timestamp", "created_at"]);

// Column sets for the smaller projects CSV (same idea, smaller surface).
const PROJECTS_CSV_COLUMNS = [
  "id", "name", "developer", "district", "city",
  "total_units", "available_units", "sold_units", "sold_last_month",
  "sold_percentage", "avg_price_eur_m2", "min_price", "max_price",
  "kolaudacia", "country", "status", "last_updated",
];
const PROJECTS_NUMBER_COLUMNS = new Set([
  "total_units", "available_units", "sold_units", "sold_last_month",
  "sold_percentage", "avg_price_eur_m2", "min_price", "max_price",
]);
const PROJECTS_DATE_COLUMNS = new Set(["last_updated"]);

function csvEscapeCell(v) {
  if (v == null) return "";
  const s = String(v);
  return s.includes(",") || s.includes("\"") || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// Number formatter — Excel-friendly: no thousands separator, `.` as
// decimal point, no trailing zeros. NaN/Infinity → blank (NOT the
// literal string "NaN" which would just confuse readers).
function formatCsvNumber(v) {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  // NUMERIC(12,2) precision — cap at 2 decimals, then trim trailing zeros.
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

// Date formatter — render any ISO/parseable timestamp as UTC
// "YYYY-MM-DD HH:MM:SS". Already-short strings pass through unchanged
// (e.g. snapshot_month is "2026-05" and shouldn't be re-parsed).
function formatCsvDate(v) {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(v)) {
    return v;
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// Per-column dispatch: number columns → formatCsvNumber, date columns →
// formatCsvDate, everything else → raw string. Then escape for CSV.
function formatCsvCell(numberCols, dateCols, column, value) {
  if (numberCols.has(column)) return csvEscapeCell(formatCsvNumber(value));
  if (dateCols.has(column))   return csvEscapeCell(formatCsvDate(value));
  return csvEscapeCell(value);
}

function PlatformExports({ lang }) {
  const { projects } = useProjects();
  const { user } = useAuth();
  // Export progress state: null = idle; { current, total, label } while
  // streaming. Disables the export button + shows a row counter so users
  // know the click did something even for large exports.
  const [exportProgress, setExportProgress] = useState(null);

  const csvFromProjects = () => {
    // T-001: numbers + dates get formatted (was raw DB strings before).
    // T-002 isn't needed here — projects CSV already has the friendly
    // `name` column; we just add `city` + `developer` ordering tweak so
    // identity columns sit next to each other on the left.
    const rows = projects.map(p =>
      PROJECTS_CSV_COLUMNS.map(h =>
        formatCsvCell(PROJECTS_NUMBER_COLUMNS, PROJECTS_DATE_COLUMNS, h, p[h])
      ).join(",")
    );
    const csv = [PROJECTS_CSV_COLUMNS.join(","), ...rows].join("\n");
    // UTF-8 BOM so Windows Excel auto-detects encoding and renders
    // "Petržalka" / "Staré Mesto" correctly instead of "Petr�alka".
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `residata-projects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    try { track("csv_exported", { type: "projects", row_count: projects.length }); } catch (_) {}
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const csvFromFlats = async () => {
    if (exportProgress) return;  // already in progress; ignore double-click
    const { supabase } = await import("../lib/supabase");
    setExportProgress({ current: 0, total: null, label: lang === "sk" ? "Sťahujem…" : "Downloading…" });
    try {
      // F-089 (revised 2026-05-31 night): the previous version blocked on a
      // `count: 'exact'` head query before fetching any pages. On views as
      // complex as flats_current (paid-tier join over final.units +
      // reference.projects + latest-snapshot filter), that count round-trip
      // can hang 60s+ via PostgREST. Worse, it's pure overhead — we know
      // we're done when a page comes back smaller than CSV_PAGE_SIZE.
      //
      // New approach: start paginating immediately. Show running row count
      // ("Downloading 10,000 rows…"). If we want the total later we can
      // fetch it lazily in the background, but the UX value is small and
      // the latency cost was huge.
      //
      // Also: kick off an `estimated` count in parallel — it's cheap (uses
      // planner stats, not an exact scan) and lets us upgrade the label
      // to "X / Y" if it returns reasonably. If it errors or hangs we just
      // continue with the running-count display.
      const estimatePromise = supabase
        .from("flats_current")
        .select("*", { count: "estimated", head: true })
        .then(r => (!r.error && r.count) ? r.count : null)
        .catch(() => null);

      // T-002: build project_id → { name, developer, district, city }
      // lookup once before paging. `projects` already lives in memory
      // (useProjects() hook on this component), so no extra round trip.
      // ~161 projects → Map build is sub-millisecond.
      const projectLookup = new Map();
      for (const p of projects) {
        projectLookup.set(p.id, {
          project_name: p.name || "",
          developer: p.developer || "",
          district: p.district || "",
          city: p.city || "",
        });
      }

      let total = null;  // populated lazily when estimate resolves
      const csvParts = [FLATS_CSV_COLUMNS.join(",")];  // header is fixed/explicit
      let from = 0;
      let pageRows = 0;
      let totalRows = 0;

      do {
        const to = from + CSV_PAGE_SIZE - 1;
        const { data, error } = await supabase
          .from("flats_current")
          .select("*")
          .range(from, to);
        if (error) throw error;
        pageRows = data?.length || 0;
        if (pageRows === 0) break;

        for (const row of data) {
          const enrichment = projectLookup.get(row.project_id) || {
            project_name: "",
            developer: "",
            district: "",
            city: "",
          };
          const cells = FLATS_CSV_COLUMNS.map(col => {
            // Enrichment columns come from the projects lookup, not from
            // the flats row itself.
            if (col === "project_name" || col === "developer" || col === "district" || col === "city") {
              return csvEscapeCell(enrichment[col]);
            }
            return formatCsvCell(FLATS_NUMBER_COLUMNS, FLATS_DATE_COLUMNS, col, row[col]);
          });
          csvParts.push(cells.join(","));
        }
        totalRows += pageRows;
        from += CSV_PAGE_SIZE;

        // After the first page returns, opportunistically read the parallel
        // estimate so the UI can show "X / Y" once it's available.
        if (total === null) {
          try {
            total = await Promise.race([estimatePromise, Promise.resolve(null)]);
          } catch (_) {}
        }

        setExportProgress({
          current: totalRows,
          total: total && total >= totalRows ? total : null,
          label: lang === "sk" ? "Sťahujem…" : "Downloading…",
        });
      } while (pageRows === CSV_PAGE_SIZE);  // short page = last page

      if (totalRows === 0) {
        alert(lang === "sk" ? "Žiadne byty na export." : "No flats available.");
        return;
      }

      // Build Blob + download. UTF-8 BOM stays so Windows Excel renders
      // SK diacritics correctly.
      const csv = csvParts.join("\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `residata-flats-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      try { track("csv_exported", { type: "flats", row_count: totalRows }); } catch (_) {}
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      // Surface error without ripping the whole page. alert() matches the
      // pre-fix UX; consider a toast in a future polish pass.
      alert((lang === "sk" ? "Export zlyhal: " : "Export failed: ") + (e?.message || String(e)));
    } finally {
      setExportProgress(null);
    }
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
          <button onClick={csvFromProjects} className="btn-p" style={{ fontSize: "0.85rem" }} disabled={!!exportProgress}>
            ⬇ {lang === "sk" ? "Projekty — všetky stavy" : "Projects — all statuses"} ({projects.length})
          </button>
          <button onClick={csvFromFlats} className="btn-s" style={{ fontSize: "0.85rem" }} disabled={!!exportProgress}>
            {exportProgress
              ? (exportProgress.total
                  ? `${exportProgress.label} ${exportProgress.current.toLocaleString(lang === "sk" ? "sk-SK" : "en-US")} / ${exportProgress.total.toLocaleString(lang === "sk" ? "sk-SK" : "en-US")}`
                  : exportProgress.current > 0
                    ? `${exportProgress.label} ${exportProgress.current.toLocaleString(lang === "sk" ? "sk-SK" : "en-US")}${lang === "sk" ? " riadkov" : " rows"}`
                    : exportProgress.label)
              : <>⬇ {lang === "sk" ? "Všetky byty" : "All flats"}</>}
          </button>
        </div>
        <p style={{ color: dim, fontSize: "0.75rem", marginTop: "0.85rem", lineHeight: 1.5 }}>
          {lang === "sk"
            ? "CSV sa vytvorí v tvojom prehliadači — nič neodchádza mimo tvoj počítač. Pre Excel stačí dvojklik. Veľké exporty môžu trvať pár sekúnd."
            : "CSV is generated in your browser — nothing leaves your machine. Double-click opens in Excel. Large exports may take a few seconds."}
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
