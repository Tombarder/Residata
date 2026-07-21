/* PageHero — the shared "Normal-theme" hero band used at the top of platform
   pages: a tinted, theme-aware panel with a gradient top rule that separates
   the page header from the workspace below. Data pages inline their own hero;
   this component gives the simpler utility pages (Exports, Billing, Settings,
   Admin, Ask AI) the same treatment so the app reads as one system.

   Visual-only. All colours are theme tokens (var(--*)) so it works in both the
   Normal (light) and dark themes without per-theme branching. The background
   deliberately contains the literal string `var(--surface)` + `border-radius`
   so the light-theme card-shadow rule in index.css picks it up. */
export default function PageHero({ eyebrow, title, subtitle, right, children, style }) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 16,
        border: "1px solid var(--border)",
        padding: "1.4rem 1.6rem 1.5rem",
        marginBottom: "1.5rem",
        background:
          "radial-gradient(120% 140% at 2% -20%, rgba(18,185,129,0.13) 0%, transparent 46%), linear-gradient(135deg, color-mix(in srgb, var(--accent) 5%, var(--surface)) 0%, var(--bg) 75%)",
        ...style,
      }}
    >
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 3, background: "linear-gradient(90deg, var(--accent), #3b74e8 55%, #8b5cf6)" }} />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          {eyebrow && (
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: "0.62rem", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent-ink)", marginBottom: "0.5rem" }}>
              {eyebrow}
            </div>
          )}
          {title && <h1 style={{ margin: 0, fontSize: "1.6rem", fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>{title}</h1>}
          {subtitle && <p style={{ margin: "0.4rem 0 0", color: "var(--text-dim)", fontSize: "0.9rem", lineHeight: 1.55, maxWidth: 720 }}>{subtitle}</p>}
        </div>
        {right && <div style={{ flexShrink: 0 }}>{right}</div>}
      </div>
      {children}
    </div>
  );
}
