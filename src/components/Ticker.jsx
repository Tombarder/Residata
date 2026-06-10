import { useMetrics } from "../lib/useData";
import { liveT } from "../lib/liveLang";
import { useCurrency } from "../lib/useCurrency";

/**
 * Bloomberg-terminal style ticker.
 * Sliding right-to-left, pause on hover, monospace, subtle.
 * Visible on every page, below nav.
 */
export default function Ticker({ lang = "en" }) {
  const t = liveT[lang] || liveT.en;
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
  const pickText = (m) => {
    if (lang === "en") {
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

  if (loading && !items.length) {
    return (
      <div style={styles.wrapper}>
        <div style={styles.fadeLeft} />
        <div style={{...styles.content, color: "#55555f"}}>{t.ticker_loading}</div>
        <div style={styles.fadeRight} />
      </div>
    );
  }

  return (
    <div style={styles.wrapper} aria-label="Live market ticker">
      <div style={styles.badge}>{t.live}</div>
      <div style={styles.fadeLeft} />
      <div style={styles.track}>
        <div style={styles.slide}>
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
    top: 72,                    // pod Nav (ktorý je ~72px fixed hore)
    left: 0,
    right: 0,
    zIndex: 99,
    height: 36,
    background: "#0e0e10",
    borderBottom: "1px solid #222228",
    borderTop: "1px solid #222228",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "0.75rem",
    color: "#c0c0c8",
  },
  badge: {
    flex: "0 0 auto",
    padding: "0 1rem",
    fontSize: "0.6rem",
    fontWeight: 700,
    letterSpacing: "0.15em",
    color: "#00e5a0",
    borderRight: "1px solid #222228",
    height: "100%",
    display: "flex",
    alignItems: "center",
    zIndex: 2,
    background: "#0e0e10",
  },
  track: {
    flex: 1,
    overflow: "hidden",
    position: "relative",
  },
  slide: {
    display: "inline-flex",
    whiteSpace: "nowrap",
    animation: "ticker-slide 120s linear infinite",
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
    background: "linear-gradient(to right, #0e0e10, transparent)",
    pointerEvents: "none",
    zIndex: 1,
  },
  fadeRight: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 40,
    background: "linear-gradient(to left, #0e0e10, transparent)",
    pointerEvents: "none",
    zIndex: 1,
  },
  // (F-254 fix: removed duplicate `content:` key — the earlier definition
  //  at the top of the styles object wins per object-literal semantics, so
  //  this italic-styled variant was never reachable. If italic for the
  //  loading state is intended, override inline at the call site instead.)
};
