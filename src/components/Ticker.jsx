import { useMetrics } from "../lib/useData";
import { getLiveT } from "../lib/liveLang";
import { useCurrency } from "../lib/useCurrency";

/**
 * Bloomberg-terminal style ticker.
 * Sliding right-to-left, pause on hover, monospace, subtle.
 * Visible on every page, below nav.
 */
export default function Ticker({ lang = "en" }) {
  const t = getLiveT(lang);
  const { metrics, loading } = useMetrics();
  // Currency toggle: in native (CZK) mode show the native-currency copy
  // (value_text_native / value_json.text_en_native). For Slovakia these equal
  // the € copy, so SK is unchanged. Consuming useCurrency() also re-renders the
  // ticker the instant the user flips the toggle.
  const { mode } = useCurrency();
  const native = mode === "native";

  // Language-aware ticker text. Each metric stores the SK copy in value_text and
  // an EN copy in value_json.text_en; the CZK-native variants are
  // value_text_native / value_json.text_en_native (the EN-native one is optional —
  // EN gracefully falls back to the € EN copy until it exists). EN falls back to SK.
  // SK is the only language with native code-level ticker copy (value_text).
  // Every other language (en, and cs until per-metric Czech copy exists) uses
  // the English copy as the universal fallback — same cs->en chain as getLiveT /
  // localizedCopy. Without this, a Czech visitor saw the SK ticker.
  const pickText = (m) => {
    if (lang !== "sk") {
      return (native && m.value_json && m.value_json.text_en_native)
        || (m.value_json && m.value_json.text_en)
        || m.value_text || null;
    }
    return (native && m.value_text_native) || m.value_text || null;
  };

  const items = (metrics.length > 0
    ? metrics.map(pickText).filter(Boolean)
    : [t.ticker_connecting]);

  const loopItems = [...items, ...items];

  // Constant visual scroll speed regardless of market/currency. The animation
  // scrolls exactly one copy of `items` (translateX -50%) over `durationS`. With
  // a FIXED duration the px/sec varied wildly with content width: "All" (6 short
  // items) crawled, CZ-in-CZK (huge Kč numbers) raced, SK happened to sit right.
  // Make the duration proportional to content width so px/sec is constant. The
  // ticker is monospace, so character count is an exact width proxy.
  // SECONDS_PER_CHAR is calibrated so the SK ticker keeps ~the speed it has today;
  // clamped so a tiny or huge set still scrolls sanely.
  const SECONDS_PER_CHAR = 0.15;
  const PAD_CHARS_PER_ITEM = 12; // dot + gaps + 1.75rem side padding, in mono chars
  const charUnits = items.reduce((n, s) => n + s.length + PAD_CHARS_PER_ITEM, 0);
  const durationS = Math.min(240, Math.max(24, Math.round(charUnits * SECONDS_PER_CHAR)));

  if (loading && !items.length) {
    return (
      <div style={styles.wrapper} aria-hidden="true">
        <div style={styles.fadeLeft} />
        <div style={{...styles.content, color: "var(--text-faint)"}}>{t.ticker_loading}</div>
        <div style={styles.fadeRight} />
      </div>
    );
  }

  return (
    <div style={styles.wrapper} aria-hidden="true">
      <div style={styles.badge}>{t.live}</div>
      <div style={styles.fadeLeft} />
      <div style={styles.track}>
        <div style={{ ...styles.slide, animationDuration: `${durationS}s` }}>
          {loopItems.map((text, i) => (
            <span key={i} style={styles.item}>
              <span style={styles.dot}>●</span>
              <span>{text}</span>
            </span>
          ))}
        </div>
      </div>
      <div style={styles.fadeRight} />
    </div>
  );
}

const styles = {
  wrapper: {
    position: "fixed",
    // Sit exactly at the nav's bottom edge. --nav-h is the nav's REAL measured
    // height (published by the marketing Nav, already includes its notch-inset
    // padding); the fallback reproduces the old hard-coded 72px + inset.
    top: "var(--nav-h, calc(72px + var(--safe-top)))",
    left: 0,
    right: 0,
    zIndex: "var(--z-ticker, 99)",
    height: 36,
    background: "var(--surface-2)",
    borderBottom: "1px solid var(--border)",
    borderTop: "1px solid var(--border)",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.75rem",
    color: "var(--text-2)",
  },
  badge: {
    flex: "0 0 auto",
    padding: "0 1rem",
    fontSize: "0.6rem",
    fontWeight: 700,
    letterSpacing: "0.15em",
    color: "#00e5a0",
    borderRight: "1px solid var(--border)",
    height: "100%",
    display: "flex",
    alignItems: "center",
    zIndex: 2,
    background: "var(--surface-2)",
  },
  track: {
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  slide: {
    display: "inline-flex",
    whiteSpace: "nowrap",
    // duration set inline (animationDuration) per content width for constant speed
    animationName: "ticker-slide",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  item: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0 1.75rem",
  },
  dot: {
    color: "#00e5a0",
    fontSize: "0.5rem",
  },
  content: {
    padding: "0 1rem",
  },
  fadeLeft: {
    position: "absolute",
    left: 60,
    top: 0,
    bottom: 0,
    width: 40,
    background: "linear-gradient(to right, var(--surface-2), transparent)",
    pointerEvents: "none",
    zIndex: 1,
  },
  fadeRight: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 40,
    background: "linear-gradient(to left, var(--surface-2), transparent)",
    pointerEvents: "none",
    zIndex: 1,
  },
  // (F-254 fix: removed duplicate `content:` key — the earlier definition
  //  at the top of the styles object wins per object-literal semantics, so
  //  this italic-styled variant was never reachable. If italic for the
  //  loading state is intended, override inline at the call site instead.)
};
