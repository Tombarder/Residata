/**
 * TrialBannerView — the trial banner's markup, and only that: no state, no hooks,
 * no imports beyond React. TrialBanner.jsx renders it with its state; the build
 * (scripts/prerender.mjs) renders it into pre-built pages, both languages, so the
 * banner a visitor sees before the app starts is the one the app then shows.
 */
export function TrialBannerView({ lang = "sk", bannerRef, onCta, onDismiss }) {
  const L = (sk, en) => lang === "sk" ? sk : en;
  return (
    <div ref={bannerRef} role="region" aria-label={L("Akcia", "Promotion")} className="rd-trial-banner" style={{
      position: "fixed",
      top: 0, left: 0, right: 0,
      zIndex: "var(--z-banner)",
      background: "linear-gradient(90deg, color-mix(in srgb, var(--accent) 18%, transparent), color-mix(in srgb, var(--accent) 8%, transparent) 60%, color-mix(in srgb, var(--accent) 4%, transparent))",
      borderBottom: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
      color: "var(--text)",
      fontSize: "0.78rem",
      // top inset clears the notch/status bar; side insets clear landscape cutouts
      padding: "calc(0.5rem + var(--safe-top)) max(1rem, var(--safe-right)) 0.5rem max(1rem, var(--safe-left))",
      // wrap so the Activate/✕ buttons drop below the text on a ~320px phone
      // instead of clipping past the edge.
      display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem 0.75rem", flexWrap: "wrap",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
    }}>
      <span style={{ fontSize: "0.95rem" }}>🎁</span>
      <span style={{ flex: "0 1 auto", textAlign: "center", lineHeight: 1.4 }}>
        <strong style={{ color: "var(--accent)", fontWeight: 700 }}>
          {L("7 dní zadarmo", "7 days free")}
        </strong>{" "}
        {/* full copy on wider screens, punchy short copy on phones (see responsive.css) */}
        <span className="trial-banner-long">— {L(
          "prístup k Residata Premium: pokročilá analytika, reporty, mapy, AI asistent. Bez potreby vyplniť platobné údaje.",
          "access to Residata Premium: advanced analytics, reports, maps, AI assistant. No payment details needed.",
        )}</span>
        <span className="trial-banner-short">— {L("plný prístup, bez karty.", "full access, no card.")}</span>
      </span>
      <button type="button" onClick={onCta}
        style={{
          background: "var(--accent)", color: "var(--bg)",
          border: "none", borderRadius: 6,
          padding: "0.3rem 0.85rem",
          fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fontSize: "0.7rem",
          cursor: "pointer",
          letterSpacing: "0.02em",
        }}>
        {L("Aktivovať", "Activate")}
      </button>
      <button type="button" onClick={onDismiss}
        aria-label={L("Zavrieť banner", "Dismiss banner")}
        title={L("Skryť na týždeň", "Hide for a week")}
        style={{
          background: "transparent", border: "none",
          color: "rgba(232,232,237,0.55)", cursor: "pointer",
          fontSize: "0.95rem", lineHeight: 1, padding: "0 0.25rem",
          fontFamily: "inherit",
        }}
        onMouseEnter={e => e.currentTarget.style.color = "var(--text)"}
        onMouseLeave={e => e.currentTarget.style.color = "rgba(232,232,237,0.55)"}
      >✕</button>
    </div>
  );
}
