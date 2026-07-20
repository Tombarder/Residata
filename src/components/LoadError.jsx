/**
 * Shown when a data fetch actually FAILED — as opposed to succeeding with no rows.
 * Before this, a network/backend/RLS error was swallowed and rendered as an innocent
 * "no data" empty state, so a failure looked like "the market is empty". This makes
 * the difference explicit and gives the user a way out (reload).
 */
export default function LoadError({ lang = "en", onRetry, compact = false }) {
  const sk = lang === "sk";
  return (
    <div style={{
      padding: compact ? "1.1rem 1rem" : "2.25rem 1.5rem",
      textAlign: "center", color: "var(--text-dim)",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <div style={{ fontSize: "1.4rem", marginBottom: "0.55rem" }}>⚠️</div>
      <div style={{ color: "var(--text)", fontWeight: 600, marginBottom: "0.3rem", fontSize: "0.95rem" }}>
        {sk ? "Dáta sa nepodarilo načítať" : "Couldn’t load the data"}
      </div>
      <div style={{ fontSize: "0.83rem", marginBottom: "1rem", lineHeight: 1.5 }}>
        {sk ? "Nešlo o prázdny trh — spojenie zlyhalo. Skús to znova." : "This isn’t an empty market — the request failed. Please try again."}
      </div>
      <button
        onClick={onRetry || (() => window.location.reload())}
        style={{
          background: "var(--accent)", color: "#06251a", border: 0, borderRadius: 8,
          padding: "0.55rem 1.15rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer",
          fontFamily: "inherit",
        }}>
        {sk ? "Skúsiť znova" : "Try again"}
      </button>
    </div>
  );
}
